import { describe, expect, it, vi } from 'vitest';

import {
  MIN_REQUEST_INTERVAL_MS,
  PROVIDER_GATES,
  createInstanceGate,
  createRateLimitGate,
  createRedisGate,
} from './rate-limit.js';
import type { FetchLike, GateOptions } from './rate-limit.js';

const CONFIG = { url: 'https://example.upstash.io', token: 'secret-token' };

/**
 * A fetch double backing a real keyed store with per-key expiry, so `SET … NX PX` behaves the
 * way Redis actually does rather than the way the test wishes it would -- including for two
 * gates with different keys, which must not share one lock.
 */
function fakeRedis(): { fetch: FetchLike; commands: unknown[][] } {
  const heldUntil = new Map<string, number>();
  const commands: unknown[][] = [];

  const fetch: FetchLike = (_url, init) => {
    const args = JSON.parse(init.body) as unknown[];
    commands.push(args);

    const key = String(args[1]);
    const now = Date.now();
    const free = (heldUntil.get(key) ?? 0) <= now;
    if (free) heldUntil.set(key, now + Number(args[5]));

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

describe('keyed gates', () => {
  const DEEZER = PROVIDER_GATES.deezer;
  const ITUNES = PROVIDER_GATES.itunes;

  it('should not let gates with different keys block each other', async () => {
    // One lock per provider. A shared key would make a Deezer search wait out MusicBrainz's
    // 1.1 s window -- and would let iTunes' 3 s window stall the whole `resolve` stage.
    const { fetch, commands } = fakeRedis();
    const musicbrainz = createRedisGate(CONFIG, fetch);
    const deezer = createRedisGate(CONFIG, fetch, DEEZER);
    const itunes = createRedisGate(CONFIG, fetch, ITUNES);

    expect(await musicbrainz.acquire()).toEqual({ ok: true });
    expect(await deezer.acquire(0)).toEqual({ ok: true });
    expect(await itunes.acquire(0)).toEqual({ ok: true });

    // ...while each still blocks a second caller on its OWN key.
    expect((await deezer.acquire(0)).ok).toBe(false);
    expect((await itunes.acquire(0)).ok).toBe(false);

    expect(commands.map((command) => command[1])).toEqual([
      'mbgate:v1',
      DEEZER.key,
      ITUNES.key,
      DEEZER.key,
      ITUNES.key,
    ]);
    // Each key's lock lives exactly as long as its own interval.
    expect(commands[1]?.[5]).toBe(DEEZER.minIntervalMs);
    expect(commands[2]?.[5]).toBe(ITUNES.minIntervalMs);
  });

  it('should not let two per-instance gates share one slot', async () => {
    const musicbrainz = createInstanceGate();
    const itunes = createInstanceGate(ITUNES);

    expect(await musicbrainz.acquire()).toEqual({ ok: true });
    expect(await itunes.acquire(0)).toEqual({ ok: true });
  });

  it('should derive the refusal retryAfterMs from the gate', async () => {
    // The 429's `retryAfterMs` is the client's per-lane back-off. A refused iTunes permit
    // reporting MusicBrainz's 1.1 s would have the client come back while the key is still
    // held for another ~2 s, and spend a request to learn nothing.
    const { fetch } = fakeRedis();
    const itunes = createRedisGate(CONFIG, fetch, ITUNES);
    await itunes.acquire();

    expect(await itunes.acquire(0)).toEqual({ ok: false, retryAfterMs: ITUNES.minIntervalMs });

    // The instance gate reports the wait until its own next slot, which is its interval.
    vi.useFakeTimers();
    try {
      const instance = createInstanceGate(ITUNES);
      await instance.acquire();
      expect(await instance.acquire(0)).toEqual({ ok: false, retryAfterMs: ITUNES.minIntervalMs });
    } finally {
      vi.useRealTimers();
    }
  });

  it("should default to the gate's maximum wait when the caller passes none", async () => {
    // A gate willing to wait longer than its interval admits a second caller after the
    // interval, without the caller knowing anything about it.
    const patient: GateOptions = { key: 'test:v1', minIntervalMs: 50, maxWaitMs: 1_000 };
    vi.useFakeTimers();
    try {
      const gate = createInstanceGate(patient);
      await gate.acquire();

      const pending = gate.acquire();
      await vi.advanceTimersByTimeAsync(60);
      expect(await pending).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('should keep the MusicBrainz defaults unchanged', async () => {
    // The stage-less legacy path and the staged path share this one budget, so the defaults
    // every factory falls back to are MusicBrainz's, and they are exactly what they were.
    expect(PROVIDER_GATES.musicbrainz).toEqual({
      key: 'mbgate:v1',
      minIntervalMs: 1_100,
      maxWaitMs: 1_500,
    });
    expect(MIN_REQUEST_INTERVAL_MS).toBe(1_100);

    const { fetch, commands } = fakeRedis();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const gate = createRateLimitGate(
        { UPSTASH_REDIS_REST_URL: CONFIG.url, UPSTASH_REDIS_REST_TOKEN: CONFIG.token },
        fetch,
      );
      await gate.acquire();
    } finally {
      log.mockRestore();
    }
    expect(commands[0]).toEqual(['SET', 'mbgate:v1', '1', 'NX', 'PX', 1_100]);
  });

  it('should pin the two store gates', () => {
    // Deezer's quota is 50 requests per 5 s; iTunes' is ~20 per minute (spike §6.3).
    expect(DEEZER.minIntervalMs).toBe(120);
    expect(ITUNES.minIntervalMs).toBe(3_000);
    expect(new Set(Object.values(PROVIDER_GATES).map((gate) => gate.key)).size).toBe(3);
  });

  it('should name the gate in the per-instance fallback line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(createRateLimitGate({}, fakeRedis().fetch, ITUNES).kind).toBe('instance');
      expect(String(log.mock.calls[0]?.[0])).toContain(ITUNES.key);
    } finally {
      log.mockRestore();
    }
  });
});
