/**
 * The year cache -- one small interface, two adapters, chosen at runtime.
 *
 * Upstash Redis in production, an in-memory map locally. That split is what keeps this
 * repo credential-free for a new contributor: `pnpm test` and `vercel dev` both work with
 * no Upstash account, and production switches over the moment the variables appear.
 *
 * `fetch` is injected into the Upstash adapter so its tests run offline, matching
 * `api/_lib/spotify-embed.ts`.
 */

import type { YearResult } from '../../shared/types.js';

/**
 * Read and write, and deliberately nothing else.
 *
 * No `delete`, no `mget`, no `has`. Every method here has a caller in `api/year.ts`; a
 * wider interface would be two more Upstash commands to write, test and get wrong for no
 * present benefit. Widen it when something actually needs it.
 */
export interface YearCache {
  /** The stored result, or `undefined` for a miss. Never throws -- see the note on failures. */
  get(key: string): Promise<YearResult | undefined>;
  /** Store with an expiry, in seconds. Never throws. */
  set(key: string, value: YearResult, ttlSeconds: number): Promise<void>;
  /** Which adapter this is, for the cold-start log line. */
  readonly kind: 'memory' | 'upstash';
}

/**
 * TTLs, one per confidence tier, with their reasoning attached because the numbers
 * themselves are a guess until there is usage data (an open question in the plan).
 *
 * ===========================================================================
 *  THE RULE THAT SETS THESE: **Redis TTL >= the edge TTL for the same tier.**
 *
 *  `api/year.ts` sets a `Cache-Control` per tier as well, and the two caches
 *  are NOT interchangeable: an edge miss is free, because it falls through to
 *  Redis, while a Redis miss costs two requests against a 1 req/s budget that
 *  is global across all users. So Redis must never expire first.
 *
 *  An earlier version of this file had two tiers, not three, and violated the
 *  rule in the direction that matters: a `low` year was pinned in Redis for
 *  THIRTY DAYS while the edge held it for one.
 * ===========================================================================
 *
 * `high` gets thirty days: an album's original release year is a historical fact and does
 * not change. The bound exists only so a year computed from a MusicBrainz record that later
 * gets corrected eventually washes out. Note that a scoring change does not need to wait for
 * it -- that is what the `v1` segment in the key is for.
 *
 * `low` gets seven days, and this is the tier the rule above was written for. A `low` year is
 * shown to the player with an "unconfirmed" marker (decided 2026-08-04), so it is load-bearing
 * rather than a placeholder -- and it is also the tier most likely to be WRONG and most likely
 * to become a `high` as MusicBrainz's data improves. A month is too long to pin one; a day
 * would re-derive it for every replay of the same playlist within a week.
 *
 * `none` gets one day. A miss is worth caching at all -- it costs a full two-request round
 * trip to re-derive, and the next person to paste the same playlist will ask for the same
 * track -- but it is the result most likely to improve, so it gets the shortest window.
 */
export const HIGH_CONFIDENCE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const LOW_CONFIDENCE_TTL_SECONDS = 60 * 60 * 24 * 7; //  7 days
export const NO_YEAR_TTL_SECONDS = 60 * 60 * 24; //  1 day

/** Pick the TTL for a result. Negative results are cached too -- see decision 9. */
export function ttlFor(result: YearResult): number {
  if (result.year === null) return NO_YEAR_TTL_SECONDS;
  return result.confidence === 'high' ? HIGH_CONFIDENCE_TTL_SECONDS : LOW_CONFIDENCE_TTL_SECONDS;
}

/**
 * ===========================================================================
 *  A CACHE FAILURE MUST NEVER FAIL A LOOKUP.
 *
 *  Every method below swallows its errors: a read error is a MISS, a write
 *  error is a NO-OP, and both are logged. The cache is a latency optimisation;
 *  MusicBrainz is the source of truth. An Upstash outage should make the app
 *  slow, not broken.
 *
 *  This is why nothing here rethrows and why `api/year.ts` has no try/catch
 *  around its cache calls.
 * ===========================================================================
 */

/**
 * Development cache over a module-scope map.
 *
 * ITS REAL LIMITATION, stated plainly because "the cache is working" is easy to believe
 * here: it lives only as long as one warm serverless instance. Vercel may run several
 * instances concurrently and will discard them when idle, so entries are neither shared
 * between users nor durable. It is a development convenience and a safe default, not a
 * production cache -- which is exactly why `createCache()` logs which one it picked.
 */
export function createMemoryCache(): YearCache {
  const store = new Map<string, { value: YearResult; expiresAt: number }>();

  return {
    kind: 'memory',

    get(key) {
      const entry = store.get(key);
      if (!entry) return Promise.resolve(undefined);

      // Expiry is enforced on read rather than by a timer: a serverless instance can be
      // frozen between invocations, so a `setTimeout` is not a reliable clock here.
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return Promise.resolve(undefined);
      }

      return Promise.resolve(entry.value);
    },

    set(key, value, ttlSeconds) {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return Promise.resolve();
    },
  };
}

/** The minimum of `fetch` the Upstash adapter needs. Structural, so test doubles stay one-liners. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface UpstashConfig {
  url: string;
  token: string;
}

/**
 * Upstash Redis over its REST API, using the global `fetch`.
 *
 * No client library, on purpose (decision 6): the two operations needed are a GET and a
 * SET-with-expiry, and a dependency would add cold-start weight to a latency-sensitive
 * function for no capability gain.
 *
 * COMMANDS GO IN THE POST BODY as a JSON array, never built into the URL path. Upstash
 * supports both, and the path form is the one every example shows -- but our keys are
 * normalized artist-title pairs, so they contain spaces, pipes and punctuation. Encoding
 * those into a path is a subtle-bug generator; a JSON body has no such problem.
 */
export function createUpstashCache(config: UpstashConfig, fetchImpl: FetchLike): YearCache {
  async function command(args: (string | number)[]): Promise<unknown> {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) throw new Error(`upstash responded ${response.status}`);
    return await response.json();
  }

  return {
    kind: 'upstash',

    async get(key) {
      try {
        const body = await command(['GET', key]);
        const raw = extractResult(body);
        // A Redis miss is `{"result": null}`, which is a successful response, not an error.
        if (typeof raw !== 'string' || raw === '') return undefined;

        const parsed: unknown = JSON.parse(raw);
        // A stored value that no longer parses as a `YearResult` means the shape changed
        // without the key version being bumped. Treated as a miss rather than trusted --
        // a wrong year is worse than a slow one.
        return isYearResult(parsed) ? parsed : undefined;
      } catch (error) {
        // Never the token, never the response body: this line ends up in a shared log.
        console.warn('[year-cache] read failed, treating as a miss:', describe(error));
        return undefined;
      }
    },

    async set(key, value, ttlSeconds) {
      try {
        // `EX` rather than a separate EXPIRE: one round trip, and no window in which a key
        // exists with no expiry at all.
        await command(['SET', key, JSON.stringify(value), 'EX', ttlSeconds]);
      } catch (error) {
        console.warn('[year-cache] write failed, continuing without caching:', describe(error));
      }
    },
  };
}

/**
 * Select an adapter from the environment, and say which one out loud.
 *
 * The log line is not decoration. Silently falling back to the in-memory adapter in
 * production would look exactly like a cache that is wired up correctly and simply never
 * hits -- a slow app with no error anywhere and nothing to grep for.
 *
 * Keyed on the URL alone, with the token checked alongside it, so a half-configured
 * deployment (URL set, token missing) degrades to in-memory with a warning rather than
 * failing every write.
 */
export function createCache(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): YearCache {
  const url = env['UPSTASH_REDIS_REST_URL']?.trim();
  const token = env['UPSTASH_REDIS_REST_TOKEN']?.trim();

  if (url && token) {
    console.log('[year-cache] using Upstash Redis');
    return createUpstashCache({ url, token }, fetchImpl);
  }

  if (url && !token) {
    console.warn('[year-cache] UPSTASH_REDIS_REST_URL is set but the token is not; using memory');
  } else {
    console.log('[year-cache] using in-memory cache (per-instance, not shared)');
  }

  return createMemoryCache();
}

/** Upstash answers `{"result": …}`; anything else is not a shape we understand. */
function extractResult(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)['result'];
}

/**
 * Validate a value round-tripped through JSON.
 *
 * The whole `YearResult` is stored, not a bare year (decision 9): storing only the number
 * would make every cache hit report `high` confidence and quietly defeat Phase 6's
 * reveal-side year UI. This guard is what makes reading it back safe.
 */
function isYearResult(value: unknown): value is YearResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  if (record['year'] === null) return record['confidence'] === 'none';
  return (
    typeof record['year'] === 'number' &&
    (record['confidence'] === 'high' || record['confidence'] === 'low')
  );
}

/** A short, safe description of a thrown value. Never a stack trace and never a payload. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
