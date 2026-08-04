/**
 * The browser's side of `GET /api/year`: build the query, map the response onto a typed
 * outcome, and never throw.
 *
 * `fetch` is injected exactly as it is into the Phase 2 adapters (`api/_lib/spotify-embed.ts`,
 * `api/_lib/cache.ts`), for the same reason: every status branch below -- including 429's
 * back-pressure contract, which the resolver's whole design rests on -- becomes an offline
 * unit test instead of a live, rate-limited, non-deterministic network call.
 *
 * NEVER THROWS, on purpose. The caller is a background loop walking a hundred cards; a
 * rejected promise mid-crawl is a much worse shape to program against than a discriminated
 * union, and a `network` failure genuinely is one of the expected outcomes rather than an
 * exception.
 */

import type { TrackRef, YearErrorCode, YearLookupResult } from '../../shared/types';

/**
 * `YearErrorCode` plus the one failure that has no HTTP status: the request never completed.
 *
 * Client-only, so it is defined here rather than widening the shared union -- the server can
 * never produce it, and adding it there would force every server-side switch to handle a case
 * that cannot happen.
 */
export type YearClientErrorCode = YearErrorCode | 'network';

export type YearLookupOutcome =
  | { ok: true; result: YearLookupResult }
  | {
      ok: false;
      code: YearClientErrorCode;
      /** Present on `rate-limited`: how long the resolver should wait before retrying this card. */
      retryAfterMs?: number;
    };

/**
 * The minimum of `fetch` this module needs, kept structural so a test double stays a
 * one-liner. The real global `fetch` satisfies it.
 */
export type YearFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<YearFetchResponse>;

export interface YearFetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface YearLookupOptions {
  fetchImpl: YearFetch;
  /**
   * Aborts the request in flight. Ending a session must cancel outstanding lookups rather than
   * let them resolve into a dead reducer -- `resolver.stop()` is what fires this.
   */
  signal?: AbortSignal;
}

/** The endpoint. Same-origin and relative, so preview deployments and production both just work. */
const YEAR_ENDPOINT = '/api/year';

/**
 * Fallback status -> code mapping, used only when the response body carries no recognizable
 * `code`.
 *
 * NOTE THE 500. `/api/year` returns 500 for exactly one designed reason
 * (`not-configured`) and one undesigned one (its catch-all `internal-error`), and the two
 * want opposite handling: `not-configured` stops the whole crawl, while an unexplained 500
 * should be retried and deferred like any other transient fault. So `not-configured` is
 * recognized ONLY from the body -- where the server always puts it -- and a bodyless 500
 * degrades to `upstream-unavailable`. Guessing the other way round would let one unexpected
 * 500 blank an entire deck that would otherwise have resolved.
 */
const STATUS_FALLBACK: Record<number, YearClientErrorCode> = {
  400: 'invalid-request',
  429: 'rate-limited',
  500: 'upstream-unavailable',
  502: 'upstream-unavailable',
};

/** Every code the server can send, as a runtime guard -- a response body is untrusted input. */
const SERVER_ERROR_CODES: readonly string[] = [
  'invalid-request',
  'rate-limited',
  'not-configured',
  'upstream-unavailable',
  'unexpected-payload',
];

/**
 * Resolve one track's year.
 *
 * ONE TRACK PER CALL, mirroring the endpoint (decision 4). The sequencing, the pacing and the
 * retries all belong to `resolver.ts`; this function does a single round trip and describes
 * what came back.
 */
export async function lookupYear(
  track: TrackRef,
  options: YearLookupOptions,
): Promise<YearLookupOutcome> {
  const query = new URLSearchParams({
    title: track.title,
    // The RAW joined artist string, unmodified. `shared/artists.ts` explains why it is never
    // split, and the server owns the cleaning and the primary-artist fallback -- doing any of
    // that here would let the client's idea of a query drift from the server's cache key.
    artist: track.artist,
  });

  // Absent, zero or negative all mean "unknown" to the server, which drops the `dur:` bound
  // rather than failing -- so there is nothing to send.
  if (Number.isFinite(track.durationMs) && track.durationMs > 0) {
    query.set('durationMs', String(Math.round(track.durationMs)));
  }

  let response: YearFetchResponse;
  try {
    const init = options.signal ? { signal: options.signal } : undefined;
    response = await options.fetchImpl(`${YEAR_ENDPOINT}?${query.toString()}`, init);
  } catch {
    // Offline, DNS failure, or an abort from `resolver.stop()`. All three are "the request did
    // not happen"; the resolver already ignores everything after a stop, so they need no
    // distinction here.
    return { ok: false, code: 'network' };
  }

  const body = await readJson(response);

  if (response.ok) {
    const result = asLookupResult(body);
    // A 200 that is not the shape we parse means the endpoint changed under us -- the same
    // meaning `unexpected-payload` has server-side, so it reuses the code. NOT transient, but
    // the resolver still retries it a couple of times before giving up, which costs little and
    // covers a truncated response.
    return result ? { ok: true, result } : { ok: false, code: 'unexpected-payload' };
  }

  const code = errorCodeFrom(body) ?? STATUS_FALLBACK[response.status] ?? 'upstream-unavailable';
  const outcome: YearLookupOutcome = { ok: false, code };

  if (code === 'rate-limited') {
    const retryAfterMs = retryAfterFrom(body, response);
    if (retryAfterMs !== undefined) outcome.retryAfterMs = retryAfterMs;
  }

  return outcome;
}

/** A body that will not parse is not an error here -- the status still carries the meaning. */
async function readJson(response: YearFetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Validate a 200 body before handing it on.
 *
 * Only the fields Phase 3 and Phase 4 actually read are checked -- `year`, `confidence`,
 * `cached`, `cleanedTitle` -- because the point is to catch "this is not a year response at
 * all" (an HTML error page, a rewritten route), not to re-implement the server's types.
 */
function asLookupResult(body: unknown): YearLookupResult | undefined {
  const record = asRecord(body);
  if (!record) return undefined;

  const year = record['year'];
  if (year !== null && typeof year !== 'number') return undefined;

  const confidence = record['confidence'];
  if (confidence !== 'high' && confidence !== 'low' && confidence !== 'none') return undefined;

  // The impossible combinations the shared `YearResult` union rules out server-side. Trusting
  // a `{year: 1975, confidence: 'none'}` would put a year on the card and simultaneously tell
  // Phase 6 not to show one.
  if (year === null && confidence !== 'none') return undefined;
  if (year !== null && confidence === 'none') return undefined;

  return record as unknown as YearLookupResult;
}

/** The body's `code`, when it is one the server is known to send. */
function errorCodeFrom(body: unknown): YearErrorCode | undefined {
  const record = asRecord(body);
  const code = record?.['code'];
  if (typeof code !== 'string' || !SERVER_ERROR_CODES.includes(code)) return undefined;

  return code as YearErrorCode;
}

/**
 * How long to wait after a 429.
 *
 * The BODY's `retryAfterMs` is the primary contract (`shared/types.ts`, decision 12); the
 * `Retry-After` header is the safety net for the case where the body never arrived -- an edge
 * or proxy 429 in front of the function would have the header and nothing else. Header values
 * are in SECONDS, so they are scaled up here.
 */
function retryAfterFrom(body: unknown, response: YearFetchResponse): number | undefined {
  const fromBody = asRecord(body)?.['retryAfterMs'];
  if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody >= 0) {
    return fromBody;
  }

  const header = Number.parseFloat(response.headers.get('Retry-After') ?? '');
  if (Number.isFinite(header) && header >= 0) return header * 1000;

  // Neither present. The resolver has its own default -- inventing one here would put the same
  // number in two places.
  return undefined;
}
