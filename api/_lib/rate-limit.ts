/**
 * The outbound rate-limit gates: one per year provider, keyed, each with its own interval.
 *
 * BINDING, not decision. Nothing here chooses which provider to ask or what an answer means
 * (that is `shared/year-providers.ts`); a gate only says "you may send one request now" or
 * "come back in N ms". It began as the MusicBrainz 1 req/s gate, and MusicBrainz's defaults
 * are still the defaults, byte for byte: `mbgate:v1`, 1.1 s, a 1.5 s wait.
 *
 * ===========================================================================
 *  TWO MODES, TWO DIFFERENT GUARANTEES. THIS IS THE POINT OF THE MODULE.
 *
 *    Redis-backed  -- genuinely enforces the interval across concurrent function
 *                     instances and concurrent users. This is what MusicBrainz's
 *                     policy actually requires, and the only mode that satisfies it.
 *    Per-instance  -- spaces calls within ONE warm serverless instance and
 *                     nothing more. Two instances, or two users, pace
 *                     independently and aggregate straight past the limit.
 *                     A LOCAL-DEVELOPMENT STAND-IN, not an equivalent.
 *
 *  Do not let the shared interface suggest the two are interchangeable in
 *  production. `kind` is exported so the handler can log which one is live.
 * ===========================================================================
 *
 * WHY THE GATE IS HERE RATHER THAN AN IN-PROCESS QUEUE. `/api/year` resolves one track per
 * request (decision 4), so the server only ever sees isolated invocations: there is no
 * long-lived process in which a queue could pace anything. A single client paces itself by
 * sequencing its calls, but several concurrent users each pacing correctly still aggregate
 * past 1 req/s. Only a shared, out-of-process lock can enforce the real policy -- hence
 * Redis, and hence the honest label on the fallback.
 *
 * WHY EVERY GATE IS GLOBAL, INCLUDING THE TWO STORES' (plan.year-fetch-rework-server.md
 * step 8). Deezer and iTunes publish no per-application limit the way MusicBrainz does; what
 * they enforce is a per-IP one. It would be natural to conclude that a per-player limit is
 * therefore enough, and it is not: every request leaves from VERCEL'S egress IPs, which are
 * shared by every invocation of this function and by other tenants besides. A per-IP limit
 * seen from the provider's side is effectively ONE limit across all of our players, so the
 * gate that keeps us under it has to be global too -- one Redis key per provider, not one
 * per client.
 */

import type { YearProviderId } from '../../shared/types.js';

/**
 * The minimum spacing between two MusicBrainz requests.
 *
 * A little over one second rather than exactly one: MusicBrainz measures at its end, and a
 * gate that aims for exactly 1000 ms will drift into violations on clock skew and network
 * jitter. The 100 ms of headroom costs ~10% throughput and buys not being blocked.
 */
export const MIN_REQUEST_INTERVAL_MS = 1_100;

/**
 * How long to wait between attempts while a Redis permit is unavailable -- or the gate's own
 * interval, when that is shorter. Polling a 120 ms gate every 200 ms would wait out more than
 * a whole window between looks; polling a 1.1 s one every 200 ms is what MusicBrainz always
 * had, so its behaviour is unchanged.
 */
const RETRY_DELAY_MS = 200;

/**
 * Default ceiling on how long `acquire()` will block before giving up.
 *
 * Deliberately short. Waiting inside the function burns wall-clock on a metered invocation
 * and edges toward the function timeout, when the client is already sequencing and can
 * simply come back (decision 12). Giving up quickly with a `retryAfterMs` makes the
 * back-pressure VISIBLE to Phase 3 instead of hiding it in latency.
 */
const DEFAULT_MAX_WAIT_MS = 1_500;

/**
 * The lock key MusicBrainz has always used.
 *
 * Versioned like the cache key, for the same reason: if the spacing or the locking scheme
 * changes, a stale key left by the previous scheme should not be honoured by the new one.
 */
const MUSICBRAINZ_GATE_KEY = 'mbgate:v1';

/** Which gate, how far apart its permits are, and how long a caller will wait for one. */
export interface GateOptions {
  /** The Redis key. Two gates with different keys never block each other. */
  readonly key: string;
  /** Minimum spacing between two permits, in ms. Also the Redis refusal's `retryAfterMs`. */
  readonly minIntervalMs: number;
  /** How long `acquire()` blocks by default before refusing. */
  readonly maxWaitMs: number;
}

/**
 * MusicBrainz's gate, and the default for every factory below -- so a caller that passes no
 * options gets exactly the gate this module has always built.
 */
const MUSICBRAINZ_GATE: GateOptions = {
  key: MUSICBRAINZ_GATE_KEY,
  minIntervalMs: MIN_REQUEST_INTERVAL_MS,
  maxWaitMs: DEFAULT_MAX_WAIT_MS,
};

/**
 * One gate per provider (plan.year-fetch-rework-server.md step 8). Global, all three -- see
 * the module header for why a per-player limit would not be one.
 *
 * - **MusicBrainz**: its published policy, 1 req/s, plus the 100 ms of headroom above.
 *   Unchanged, so the stage-less legacy path and the staged path share ONE budget through
 *   one key -- as they must, since MusicBrainz counts requests, not endpoints.
 * - **Deezer**: 120 ms, i.e. ~8 req/s. Deezer's documented quota is 50 requests per 5 s,
 *   i.e. 10 req/s, and it enforces it by answering HTTP 200 with a `{"error":{"code":4}}`
 *   body (spike §11.2) -- a refusal `api/_lib/deezer.ts` has to read out of the body, so
 *   staying under it is cheaper than detecting it. The 20% of headroom is the same idea as
 *   MusicBrainz's 100 ms.
 * - **iTunes**: 3 s, i.e. 20 req/min, the figure Apple's Search API documentation gives. It
 *   is the tightest budget of the three by far, and part of why `verify` is a separate,
 *   later stage rather than part of every card's first request.
 *
 * `maxWaitMs` is today's 1.5 s default for all three, deliberately. For iTunes that is SHORTER
 * than the interval, so a second concurrent caller is refused with a 429 rather than held for
 * up to 3 s -- which is the intended outcome: the back-pressure reaches the client's per-lane
 * back-off, where it is visible, instead of sitting inside a metered invocation.
 */
export const PROVIDER_GATES: Readonly<Record<YearProviderId, GateOptions>> = {
  musicbrainz: MUSICBRAINZ_GATE,
  deezer: { key: 'deezergate:v1', minIntervalMs: 120, maxWaitMs: DEFAULT_MAX_WAIT_MS },
  itunes: { key: 'itunesgate:v1', minIntervalMs: 3_000, maxWaitMs: DEFAULT_MAX_WAIT_MS },
};

export type PermitResult = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimitGate {
  /**
   * Take a permit for exactly one outbound request to this gate's provider.
   *
   * Blocks for up to `maxWaitMs` (the gate's own default when omitted) while another caller
   * holds the permit, then gives up and reports how long to wait. Never throws.
   */
  acquire(maxWaitMs?: number): Promise<PermitResult>;
  readonly kind: 'redis' | 'instance';
}

/** The minimum of `fetch` the Redis gate needs -- same shape the cache adapter uses. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface RedisGateConfig {
  url: string;
  token: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The real gate: a short-lived exclusive key in Redis.
 *
 * `SET key 1 NX PX <interval>` is the whole mechanism. Whoever wins the set-if-not-exists
 * may call the provider; everyone else waits for the key to expire. It needs no explicit
 * release, which is what makes it safe: a function that crashes mid-request cannot leave
 * the gate held, because the expiry does the releasing.
 */
export function createRedisGate(
  config: RedisGateConfig,
  fetchImpl: FetchLike,
  options: GateOptions = MUSICBRAINZ_GATE,
): RateLimitGate {
  const retryDelayMs = Math.min(RETRY_DELAY_MS, options.minIntervalMs);

  async function tryAcquire(): Promise<boolean> {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', options.key, '1', 'NX', 'PX', options.minIntervalMs]),
    });

    if (!response.ok) throw new Error(`upstash responded ${response.status}`);

    const body = (await response.json()) as Record<string, unknown> | null;
    // Redis answers "OK" when the key was set and null when it already existed.
    return body?.['result'] === 'OK';
  }

  return {
    kind: 'redis',

    async acquire(maxWaitMs = options.maxWaitMs) {
      const deadline = Date.now() + maxWaitMs;

      for (;;) {
        try {
          if (await tryAcquire()) return { ok: true };
        } catch (error) {
          // FAIL OPEN, and say so. A Redis outage must not make year lookups impossible;
          // the cost of being wrong here is bounded, because MusicBrainz answers overload
          // with a 503 that the adapter already retries, and the two stores' adapters map
          // their own refusals to `busy`. Failing CLOSED would turn a cache outage into a
          // total feature outage, which is the worse trade.
          console.warn(
            `[rate-limit] ${options.key} unavailable, allowing the request:`,
            error instanceof Error ? error.message : 'unknown error',
          );
          return { ok: true };
        }

        if (Date.now() + retryDelayMs >= deadline) {
          // No fairness guarantee: a caller that loses may lose again. Acceptable for a
          // personal project with client-side retry -- see the plan's open questions. The
          // delay reported is THIS gate's interval: the key expires within one.
          return { ok: false, retryAfterMs: options.minIntervalMs };
        }

        await sleep(retryDelayMs);
      }
    },
  };
}

/**
 * The local stand-in: a closure-scope timestamp, one per gate.
 *
 * DOES NOT ENFORCE THE GLOBAL POLICY. It spaces calls within one warm instance only, so
 * two Vercel instances -- or two developers -- will happily exceed the interval between them.
 * Never a substitute for the Redis gate.
 *
 * AND IT IS **NOT** GOOD ENOUGH FOR `vercel dev`, which an earlier version of this comment
 * claimed. Measured 2026-08-04: the local dev server runs a fresh PROCESS per invocation, so
 * `nextAllowedAt` is 0 on arrival every time and EVERY request is admitted immediately --
 * five rapid requests returned five 200s where the gate should have produced 429s. Local
 * development therefore sends MusicBrainz -- and, since 2026-09-30, iTunes -- completely
 * unpaced traffic unless Upstash is configured, which matters because both enforce their
 * limits by blocking clients. Fine for a few curl commands; configure Upstash before
 * resolving a whole deck locally. It remains correct under tests, which hold one process.
 * See docs/agent_findings.md.
 *
 * The slot is reserved BEFORE the wait, not after. JavaScript's single thread makes that
 * reservation atomic, so two overlapping callers get two different slots instead of both
 * measuring the same "now" and colliding.
 */
export function createInstanceGate(options: GateOptions = MUSICBRAINZ_GATE): RateLimitGate {
  let nextAllowedAt = 0;

  return {
    kind: 'instance',

    async acquire(maxWaitMs = options.maxWaitMs) {
      const now = Date.now();
      const waitMs = Math.max(0, nextAllowedAt - now);

      if (waitMs > maxWaitMs) return { ok: false, retryAfterMs: waitMs };

      nextAllowedAt = Math.max(now, nextAllowedAt) + options.minIntervalMs;
      if (waitMs > 0) await sleep(waitMs);

      return { ok: true };
    },
  };
}

/**
 * Select a gate from the environment.
 *
 * Same variables as the cache, and deliberately the same decision: a deployment either has
 * Upstash and gets both a shared cache and real gates, or it has neither. Splitting them
 * would allow the confusing half-state of a shared cache with per-instance pacing.
 *
 * Called once per gate at cold start, so the fallback line names the gate it is about.
 */
export function createRateLimitGate(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
  options: GateOptions = MUSICBRAINZ_GATE,
): RateLimitGate {
  const url = env['UPSTASH_REDIS_REST_URL']?.trim();
  const token = env['UPSTASH_REDIS_REST_TOKEN']?.trim();

  if (url && token) return createRedisGate({ url, token }, fetchImpl, options);

  console.log(
    `[rate-limit] ${options.key}: using per-instance pacing (does NOT enforce the global limit)`,
  );
  return createInstanceGate(options);
}
