/**
 * The one HTTP step both store adapters share: take a permit, make one GET, and turn every
 * way it can go wrong into a `ProviderOutcome` arm instead of an exception.
 *
 * BINDING, in the house decision/binding split, and deliberately the thinnest possible: it
 * knows nothing about Deezer's or iTunes' payloads, and it decides nothing about years. It
 * exists so the two adapters cannot disagree about the parts of the contract that are the
 * same for both -- `api/_lib/provider-lookup.ts` promises the driver that an adapter NEVER
 * throws for an upstream problem, that a refused PERMIT and the store's own "too fast, try
 * again shortly" are both `busy`, that the store's own "stop asking" is a `refused` skip, and
 * that a network error or a 5xx is a transient `failed`. Written twice, those promises drift.
 *
 * What maps to what, and why:
 *
 * - **Aborted signal** (before the permit, after it, or mid-request): `failed` /
 *   `upstream-unavailable`, and no further request. The driver only aborts a lookup whose
 *   answer it no longer wants, so the arm chosen barely matters -- but it must not be
 *   `answer`, which would be cached, and it must not throw.
 * - **Gate refusal** (our own gate, `api/_lib/rate-limit.ts`, full because other players hold
 *   the slot): `busy` with the gate's own `retryAfterMs`, so back-pressure reaches the client
 *   from whichever provider's gate was full (plan step 8). Waiting is what a full queue asks
 *   for, and the client retries it with no cap.
 * - **Network error**: `failed` / `upstream-unavailable`.
 * - **A status the adapter names as busy** (`busyStatuses`: Deezer's 429, iTunes' 429):
 *   `busy`, exactly as a full gate is, with the `Retry-After` header when the store sent a
 *   usable number of seconds, else the adapter's `busyRetryAfterMs`. A 429 is the store's
 *   own "too many requests, try again shortly" -- the message our gate gives, so it gets the
 *   gate's treatment: retried with no cap (the developer's split, 2026-10-01).
 * - **A status the adapter names as a refusal** (`refusedStatuses`: iTunes' 403):
 *   `skipped` / `refused`, with `HTTP <status>` as the detail -- NOT `busy` (the same split).
 *   That is the store telling our shared egress IP to stop, and every player leaves from that
 *   IP: retrying is how a short throttle becomes a long block. So the provider is left out of
 *   this call, as an unconfigured one is, and the vote decides without it. No header is read
 *   for it -- nothing waits on a refusal.
 * - **5xx**: `failed` / `upstream-unavailable` -- transient, so never a final "no year".
 * - **Any other non-2xx, or a body that is not JSON**: `failed` / `unexpected-payload`. The
 *   request itself was wrong or the store changed shape; either way retrying the same URL
 *   will not help, and caching a null would hide it for a day.
 *
 * The busy list is checked before the refused one, so a status in both would be busy and its
 * refusal entry dead. No adapter lists one status twice.
 */

import type { ProviderOutcome } from './provider-lookup.js';
import type { RateLimitGate } from './rate-limit.js';

/**
 * The minimum of `fetch` the store adapters need. `headers` is optional so a test double can
 * omit it; only `Retry-After` is ever read, and only on a `busyStatuses` status.
 */
export type StoreFetch = (
  url: string,
  init: { signal?: AbortSignal; headers: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: { get: (name: string) => string | null };
}>;

/** Everything a store adapter needs injected. */
export interface StoreDeps {
  fetchImpl: StoreFetch;
  /** This provider's own gate (`PROVIDER_GATES` in `rate-limit.ts`), never MusicBrainz's. */
  gate: RateLimitGate;
}

type NotAnAnswer = Exclude<ProviderOutcome, { kind: 'answer' }>;

export type StoreResponse = { kind: 'ok'; body: unknown } | NotAnAnswer;

const UNAVAILABLE: NotAnAnswer = { kind: 'failed', code: 'upstream-unavailable' };
const UNEXPECTED: NotAnAnswer = { kind: 'failed', code: 'unexpected-payload' };

/**
 * Seconds in a `Retry-After` header, as milliseconds. The HTTP-date form, a zero, and anything
 * that is not a plain integer are ignored: the adapter's own back-off applies instead.
 */
function retryAfterFrom(
  headers: { get: (name: string) => string | null } | undefined,
): number | undefined {
  const raw = headers?.get('retry-after')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * The `refused` skip for a store's own "stop asking". The detail is built from a number only
 * -- a status or an error code -- so nothing a store sends can reach the warning it is logged
 * in. Shared with the Deezer adapter, whose quota error arrives in a 200 body.
 */
export function refusedSkip(detail: string): NotAnAnswer {
  return { kind: 'skipped', reason: 'refused', detail };
}

/**
 * One gated GET. Never throws.
 *
 * The three options are the adapter's: `busyStatuses`, the statuses that store uses for "too
 * fast, try again shortly" (each becomes `busy`, retried); `busyRetryAfterMs`, how long to
 * back off when it sends no usable `Retry-After`; and `refusedStatuses`, the statuses it uses
 * for "stop asking" (each becomes a `refused` skip, never a retry).
 */
export async function requestStoreJson(
  deps: StoreDeps,
  url: string,
  options: {
    signal?: AbortSignal;
    busyStatuses: readonly number[];
    busyRetryAfterMs: number;
    refusedStatuses: readonly number[];
  },
): Promise<StoreResponse> {
  const { signal } = options;
  if (signal?.aborted) return UNAVAILABLE;

  const permit = await deps.gate.acquire();
  if (!permit.ok) return { kind: 'busy', retryAfterMs: permit.retryAfterMs };

  // The permit wait can be long enough for the caller to have given up.
  if (signal?.aborted) return UNAVAILABLE;

  let response: Awaited<ReturnType<StoreFetch>>;
  try {
    response = await deps.fetchImpl(url, {
      ...(signal ? { signal } : {}),
      headers: { Accept: 'application/json' },
    });
  } catch {
    return UNAVAILABLE;
  }

  if (options.busyStatuses.includes(response.status)) {
    return {
      kind: 'busy',
      retryAfterMs: retryAfterFrom(response.headers) ?? options.busyRetryAfterMs,
    };
  }
  if (options.refusedStatuses.includes(response.status)) {
    return refusedSkip(`HTTP ${response.status}`);
  }
  if (response.status >= 500) return UNAVAILABLE;
  if (!response.ok) return UNEXPECTED;

  try {
    return { kind: 'ok', body: await response.json() };
  } catch {
    // An abort mid-body lands here too; it is still not an answer.
    return signal?.aborted ? UNAVAILABLE : UNEXPECTED;
  }
}

/** A plain object, for tolerant field reads. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
