/**
 * The one HTTP step both store adapters share: take a permit, make one GET, and turn every
 * way it can go wrong into a `ProviderOutcome` arm instead of an exception.
 *
 * BINDING, in the house decision/binding split, and deliberately the thinnest possible: it
 * knows nothing about Deezer's or iTunes' payloads, and it decides nothing about years. It
 * exists so the two adapters cannot disagree about the parts of the contract that are the
 * same for both -- `api/_lib/provider-lookup.ts` promises the driver that an adapter NEVER
 * throws for an upstream problem, that a refused permit is `busy`, and that a network error
 * or a 5xx is a transient `failed`. Written twice, those promises drift.
 *
 * What maps to what, and why:
 *
 * - **Aborted signal** (before the permit, after it, or mid-request): `failed` /
 *   `upstream-unavailable`, and no further request. The driver only aborts a lookup whose
 *   answer it no longer wants, so the arm chosen barely matters -- but it must not be
 *   `answer`, which would be cached, and it must not throw.
 * - **Gate refusal**: `busy` with the gate's own `retryAfterMs`, so back-pressure reaches the
 *   client from whichever provider's gate was full (plan step 8).
 * - **Network error**: `failed` / `upstream-unavailable`.
 * - **A status the adapter names as busy** (iTunes' 403 and 429; Deezer's 429): `busy`, with
 *   the `Retry-After` header when the store sent a usable one, else the adapter's constant.
 * - **5xx**: `failed` / `upstream-unavailable` -- transient, so never a final "no year".
 * - **Any other non-2xx, or a body that is not JSON**: `failed` / `unexpected-payload`. The
 *   request itself was wrong or the store changed shape; either way retrying the same URL
 *   will not help, and caching a null would hide it for a day.
 */

import type { ProviderOutcome } from './provider-lookup.js';
import type { RateLimitGate } from './rate-limit.js';

/**
 * The minimum of `fetch` the store adapters need. `headers` is optional so a test double can
 * omit it; only `Retry-After` is ever read.
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

/** Seconds in a `Retry-After` header, as milliseconds. The HTTP-date form is ignored. */
function retryAfterFrom(
  headers: { get: (name: string) => string | null } | undefined,
): number | undefined {
  const raw = headers?.get('retry-after')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * One gated GET. Never throws.
 *
 * `busyStatuses` and `busyRetryAfterMs` are the adapter's: which statuses that store uses for
 * "slow down", and how long to back off when it does not say.
 */
export async function requestStoreJson(
  deps: StoreDeps,
  url: string,
  options: {
    signal?: AbortSignal;
    busyStatuses: readonly number[];
    busyRetryAfterMs: number;
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
