import { describe, expect, it, vi } from 'vitest';

import {
  MIN_REQUEST_INTERVAL_MS,
  createInstanceGate,
  createRateLimitGate,
  createRedisGate,
} from './rate-limit.js';
import type { FetchLike } from './rate-limit.js';

const CONFIG = { url: 'https://example.upstash.io', token: 'secret-token' };

/**
 * A fetch double backing a real single-key store with an expiry, so `SET … NX PX` behaves
 * the way Redis actually does rather than the way the test wishes it would.
 */
function fakeRedis(): { fetch: FetchLike; commands: unknown[][] } {
  let heldUntil = 0;
  const commands: unknown[][] = [];

  const fetch: FetchLike = (_url, init) => {
    const args = JSON.parse(init.body) as unknown[];
    commands.push(args);

    const now = Date.now();
    const free = heldUntil <= now;
    if (free) heldUntil = now + Number(args[5]);

    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ result: free ? 'OK' : null }),
    });
  };

  return { fetch, commands };
}

describe('createRedisGate', () => {
  it('should allow one call and block a concurrent second within the window', async () => {
    // The gate's core behaviour, and the only mode that enforces MusicBrainz's actual
    // policy across concurrent function instances and concurrent users.
    const { fetch, commands } = fakeRedis();
    const gate = createRedisGate(CONFIG, fetch);

    expect(await gate.acquire()).toEqual({ ok: true });
    // `maxWaitMs: 0` so the loser gives up immediately instead of waiting out the window.
    expect(await gate.acquire(0)).toEqual({ ok: false, retryAfterMs: MIN_REQUEST_INTERVAL_MS });

    // SET … NX PX, in one command: no window in which the key exists without an expiry, and
    // nothing to release, so a crashed function cannot leave the gate held.
    expect(commands[0]).toEqual(['SET', 'mbgate:v1', '1', 'NX', 'PX', MIN_REQUEST_INTERVAL_MS]);
  });

  it('should allow a second call after the window elapses', async () => {
    // Release is by EXPIRY, never by an explicit unlock — that is what makes a mid-request
    // crash safe.
    vi.useFakeTimers();
    try {
      const gate = createRedisGate(CONFIG, fakeRedis().fetch);

      expect(await gate.acquire()).toEqual({ ok: true });
      await vi.advanceTimersByTimeAsync(MIN_REQUEST_INTERVAL_MS + 10);
      expect(await gate.acquire(0)).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('should report a retry delay when the permit cannot be acquired', async () => {
    // The value the 429 response carries and Phase 3's loop backs off on.
    const gate = createRedisGate(CONFIG, fakeRedis().fetch);
    await gate.acquire();

    const denied = await gate.acquire(0);

    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('should fail open when Redis itself is unreachable', async () => {
    // A gate outage must not make year lookups impossible. Failing CLOSED would turn a
    // cache outage into a total feature outage; MusicBrainz answers overload with a 503 the
    // adapter already retries, so the cost of being wrong here is bounded.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rejecting: FetchLike = () => Promise.reject(new Error('ECONNRESET'));

      expect(await createRedisGate(CONFIG, rejecting).acquire()).toEqual({ ok: true });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('createInstanceGate', () => {
  it('should fall back to per-instance pacing when Redis is unavailable', async () => {
    // The local stand-in, with its DELIBERATELY WEAKER guarantee: it spaces calls within one
    // warm instance and does not enforce the global 1 req/s at all.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(createRateLimitGate({}).kind).toBe('instance');
      expect(createRateLimitGate({ UPSTASH_REDIS_REST_URL: CONFIG.url }).kind).toBe('instance');
      expect(
        createRateLimitGate({
          UPSTASH_REDIS_REST_URL: CONFIG.url,
          UPSTASH_REDIS_REST_TOKEN: CONFIG.token,
        }).kind,
      ).toBe('redis');
    } finally {
      log.mockRestore();
    }
  });

  it('should space successive calls by the minimum interval', async () => {
    vi.useFakeTimers();
    try {
      const gate = createInstanceGate();

      expect(await gate.acquire()).toEqual({ ok: true });

      // The second caller is willing to wait, so it is admitted — after the interval.
      const pending = gate.acquire(MIN_REQUEST_INTERVAL_MS * 2);
      await vi.advanceTimersByTimeAsync(MIN_REQUEST_INTERVAL_MS + 10);
      expect(await pending).toEqual({ ok: true });

      // A third caller unwilling to wait is turned away with a delay to report.
      const denied = await gate.acquire(0);
      expect(denied.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should reserve a distinct slot for each of two overlapping callers', async () => {
    // The slot is reserved BEFORE the wait. JavaScript's single thread makes that atomic, so
    // two overlapping callers cannot both measure the same "now" and collide.
    vi.useFakeTimers();
    try {
      const gate = createInstanceGate();
      const generous = MIN_REQUEST_INTERVAL_MS * 5;

      const results = Promise.all([
        gate.acquire(generous),
        gate.acquire(generous),
        gate.acquire(generous),
      ]);

      // The third caller's slot is two intervals out, so this is exactly enough for all
      // three and no more.
      await vi.advanceTimersByTimeAsync(MIN_REQUEST_INTERVAL_MS * 2 + 10);

      expect(await results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
      // All three were admitted, but a fourth still has to wait out the third's interval —
      // proof the reservations stacked rather than three callers all claiming the same slot.
      expect((await gate.acquire(0)).ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
