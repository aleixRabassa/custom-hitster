/**
 * The MusicBrainz 1 req/s gate.
 *
 * ===========================================================================
 *  TWO MODES, TWO DIFFERENT GUARANTEES. THIS IS THE POINT OF THE MODULE.
 *
 *    Redis-backed  -- genuinely enforces 1 req/s across concurrent function
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
 */

/**
 * The minimum spacing between two MusicBrainz requests.
 *
 * A little over one second rather than exactly one: MusicBrainz measures at its end, and a
 * gate that aims for exactly 1000 ms will drift into violations on clock skew and network
 * jitter. The 100 ms of headroom costs ~10% throughput and buys not being blocked.
 */
export const MIN_REQUEST_INTERVAL_MS = 1_100;

/** How long to wait between attempts while a permit is unavailable. */
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

export type PermitResult = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimitGate {
  /**
   * Take a permit for exactly one outbound MusicBrainz request.
   *
   * Blocks for up to `maxWaitMs` while another caller holds the permit, then gives up and
   * reports how long to wait. Never throws.
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

/**
 * The lock key.
 *
 * Versioned like the cache key, for the same reason: if the spacing or the locking scheme
 * changes, a stale key left by the previous scheme should not be honoured by the new one.
 */
const GATE_KEY = 'mbgate:v1';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The real gate: a short-lived exclusive key in Redis.
 *
 * `SET key 1 NX PX <interval>` is the whole mechanism. Whoever wins the set-if-not-exists
 * may call MusicBrainz; everyone else waits for the key to expire. It needs no explicit
 * release, which is what makes it safe: a function that crashes mid-request cannot leave
 * the gate held, because the expiry does the releasing.
 */
export function createRedisGate(config: RedisGateConfig, fetchImpl: FetchLike): RateLimitGate {
  async function tryAcquire(): Promise<boolean> {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', GATE_KEY, '1', 'NX', 'PX', MIN_REQUEST_INTERVAL_MS]),
    });

    if (!response.ok) throw new Error(`upstash responded ${response.status}`);

    const body = (await response.json()) as Record<string, unknown> | null;
    // Redis answers "OK" when the key was set and null when it already existed.
    return body?.['result'] === 'OK';
  }

  return {
    kind: 'redis',

    async acquire(maxWaitMs = DEFAULT_MAX_WAIT_MS) {
      const deadline = Date.now() + maxWaitMs;

      for (;;) {
        try {
          if (await tryAcquire()) return { ok: true };
        } catch (error) {
          // FAIL OPEN, and say so. A Redis outage must not make year lookups impossible;
          // the cost of being wrong here is bounded, because MusicBrainz answers overload
          // with a 503 that the adapter already retries. Failing CLOSED would turn a cache
          // outage into a total feature outage, which is the worse trade.
          console.warn(
            '[rate-limit] gate unavailable, allowing the request:',
            error instanceof Error ? error.message : 'unknown error',
          );
          return { ok: true };
        }

        if (Date.now() + RETRY_DELAY_MS >= deadline) {
          // No fairness guarantee: a caller that loses may lose again. Acceptable for a
          // personal project with client-side retry -- see the plan's open questions.
          return { ok: false, retryAfterMs: MIN_REQUEST_INTERVAL_MS };
        }

        await sleep(RETRY_DELAY_MS);
      }
    },
  };
}

/**
 * The local stand-in: a module-scope timestamp.
 *
 * DOES NOT ENFORCE THE GLOBAL POLICY. It spaces calls within one warm instance only, so
 * two Vercel instances -- or two developers -- will happily exceed 1 req/s between them.
 * Good enough for `vercel dev` and for tests; never a substitute for the Redis gate.
 *
 * The slot is reserved BEFORE the wait, not after. JavaScript's single thread makes that
 * reservation atomic, so two overlapping callers get two different slots instead of both
 * measuring the same "now" and colliding.
 */
export function createInstanceGate(): RateLimitGate {
  let nextAllowedAt = 0;

  return {
    kind: 'instance',

    async acquire(maxWaitMs = DEFAULT_MAX_WAIT_MS) {
      const now = Date.now();
      const waitMs = Math.max(0, nextAllowedAt - now);

      if (waitMs > maxWaitMs) return { ok: false, retryAfterMs: waitMs };

      nextAllowedAt = Math.max(now, nextAllowedAt) + MIN_REQUEST_INTERVAL_MS;
      if (waitMs > 0) await sleep(waitMs);

      return { ok: true };
    },
  };
}

/**
 * Select a gate from the environment.
 *
 * Same variables as the cache, and deliberately the same decision: a deployment either has
 * Upstash and gets both a shared cache and a real gate, or it has neither. Splitting them
 * would allow the confusing half-state of a shared cache with per-instance pacing.
 */
export function createRateLimitGate(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): RateLimitGate {
  const url = env['UPSTASH_REDIS_REST_URL']?.trim();
  const token = env['UPSTASH_REDIS_REST_TOKEN']?.trim();

  if (url && token) return createRedisGate({ url, token }, fetchImpl);

  console.log('[rate-limit] using per-instance pacing (does NOT enforce the global 1 req/s)');
  return createInstanceGate();
}
