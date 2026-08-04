import { describe, expect, it, vi } from 'vitest';

import {
  HIGH_CONFIDENCE_TTL_SECONDS,
  LOW_CONFIDENCE_TTL_SECONDS,
  NO_YEAR_TTL_SECONDS,
  createCache,
  createMemoryCache,
  createUpstashCache,
  ttlFor,
} from './cache.js';
import type { FetchLike } from './cache.js';
import type { YearResult } from '../../shared/types.js';

const HIGH: YearResult = { year: 1975, confidence: 'high', source: 'release-group' };
const LOW: YearResult = { year: 1966, confidence: 'low', source: 'recording' };
const NONE: YearResult = { year: null, confidence: 'none', reason: 'no-candidates' };

const UPSTASH = { url: 'https://example.upstash.io', token: 'secret-token' };

/** A fetch double that answers every command with `{result}` and records the request bodies. */
function stubFetch(result: unknown): { fetch: FetchLike; bodies: unknown[][] } {
  const bodies: unknown[][] = [];
  const fetch: FetchLike = (_url, init) => {
    bodies.push(JSON.parse(init.body) as unknown[]);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result }) });
  };
  return { fetch, bodies };
}

describe('createMemoryCache', () => {
  it('should round-trip a value through the in-memory adapter', async () => {
    const cache = createMemoryCache();
    await cache.set('mbyear:v1:queen|bohemian rhapsody', HIGH, HIGH_CONFIDENCE_TTL_SECONDS);

    expect(await cache.get('mbyear:v1:queen|bohemian rhapsody')).toEqual(HIGH);
  });

  it('should return a miss for an unknown key', async () => {
    // `undefined` rather than null, because `api/year.ts` branches on it and a cached
    // NEGATIVE result is a legitimate stored value that must not read as a miss.
    const cache = createMemoryCache();

    expect(await cache.get('mbyear:v1:nobody|nothing')).toBeUndefined();
  });

  it('should preserve confidence and source through a round trip', async () => {
    // Storing a bare year would silently upgrade every cached card to high confidence and
    // defeat Phase 6's reveal-side year UI (decision 9).
    const cache = createMemoryCache();
    await cache.set('low', LOW, LOW_CONFIDENCE_TTL_SECONDS);
    await cache.set('none', NONE, NO_YEAR_TTL_SECONDS);

    expect(await cache.get('low')).toEqual(LOW);
    expect(await cache.get('none')).toEqual(NONE);
  });

  it('should expire an entry once its TTL has elapsed', async () => {
    // Expiry is enforced on READ, not by a timer: a serverless instance can be frozen
    // between invocations, so `setTimeout` is not a usable clock here.
    vi.useFakeTimers();
    try {
      const cache = createMemoryCache();
      await cache.set('key', HIGH, 60);

      vi.advanceTimersByTime(59_000);
      expect(await cache.get('key')).toEqual(HIGH);

      vi.advanceTimersByTime(2_000);
      expect(await cache.get('key')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createUpstashCache', () => {
  it('should send a set-with-expiry command to Upstash', async () => {
    const { fetch, bodies } = stubFetch('OK');
    const cache = createUpstashCache(UPSTASH, fetch);

    await cache.set('mbyear:v1:queen|bohemian rhapsody', HIGH, 900);

    // `SET … EX` in ONE command, not SET followed by EXPIRE: one round trip, and no window
    // in which the key exists without an expiry.
    expect(bodies).toEqual([
      ['SET', 'mbyear:v1:queen|bohemian rhapsody', JSON.stringify(HIGH), 'EX', 900],
    ]);
  });

  it('should read a stored result back', async () => {
    const { fetch, bodies } = stubFetch(JSON.stringify(LOW));
    const cache = createUpstashCache(UPSTASH, fetch);

    expect(await cache.get('mbyear:v1:bob dylan|like a rolling stone')).toEqual(LOW);
    expect(bodies).toEqual([['GET', 'mbyear:v1:bob dylan|like a rolling stone']]);
  });

  it('should treat a Redis null as a miss rather than an error', async () => {
    const { fetch } = stubFetch(null);
    const cache = createUpstashCache(UPSTASH, fetch);

    expect(await cache.get('absent')).toBeUndefined();
  });

  it('should handle keys containing spaces and punctuation', async () => {
    // Precisely why commands go in the request BODY rather than the URL path: normalized
    // artist-title keys are full of spaces, pipes and punctuation, and path-encoding them
    // is a subtle-bug generator.
    const key = "mbyear:v1:guns n roses|sweet child o' mine (feat. someone)";
    const { fetch, bodies } = stubFetch('OK');
    const cache = createUpstashCache(UPSTASH, fetch);

    await cache.set(key, HIGH, 60);

    expect(bodies[0]?.[1]).toBe(key);
  });

  it('should treat an Upstash read failure as a miss', async () => {
    // The cache is a latency optimisation; MusicBrainz is the source of truth. An outage
    // must make the app slow, not broken.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rejecting: FetchLike = () => Promise.reject(new Error('ECONNRESET'));
      const failingStatus: FetchLike = () =>
        Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });

      await expect(createUpstashCache(UPSTASH, rejecting).get('k')).resolves.toBeUndefined();
      await expect(createUpstashCache(UPSTASH, failingStatus).get('k')).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('should treat an Upstash write failure as a no-op', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rejecting: FetchLike = () => Promise.reject(new Error('ECONNRESET'));

      // Resolves rather than rejecting: `api/year.ts` deliberately has no try/catch here.
      await expect(
        createUpstashCache(UPSTASH, rejecting).set('k', HIGH, 60),
      ).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('should treat an unparseable stored value as a miss', async () => {
    // A stored value that no longer matches `YearResult` means the shape changed without
    // the key version being bumped. A wrong year is worse than a slow one.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        createUpstashCache(UPSTASH, stubFetch('not json').fetch).get('k'),
      ).resolves.toBeUndefined();
      await expect(
        createUpstashCache(UPSTASH, stubFetch('{"year":1975}').fetch).get('k'),
      ).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('createCache', () => {
  it('should select the in-memory adapter when no Upstash URL is configured', async () => {
    // The new-contributor path: no credentials, working cache, tests pass.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(createCache({}).kind).toBe('memory');
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('should select the Upstash adapter when the URL is configured', async () => {
    // The other branch, so production cannot silently run on the per-instance cache.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const cache = createCache(
        { UPSTASH_REDIS_REST_URL: UPSTASH.url, UPSTASH_REDIS_REST_TOKEN: UPSTASH.token },
        stubFetch('OK').fetch,
      );

      expect(cache.kind).toBe('upstash');
    } finally {
      log.mockRestore();
    }
  });

  it('should fall back to memory with a warning when the URL is set but the token is not', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(createCache({ UPSTASH_REDIS_REST_URL: UPSTASH.url }).kind).toBe('memory');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('ttlFor', () => {
  it('should pick a TTL per confidence tier', () => {
    expect(ttlFor(HIGH)).toBe(HIGH_CONFIDENCE_TTL_SECONDS);
    expect(ttlFor(LOW)).toBe(LOW_CONFIDENCE_TTL_SECONDS);
    expect(ttlFor(NONE)).toBe(NO_YEAR_TTL_SECONDS);
  });

  it('should order the tiers by how likely the answer is to change', () => {
    // Negatives ARE cached (a miss costs a full two-request round trip and the next user
    // with the same playlist will ask again) -- but they are the result most likely to
    // improve, and a `low` year is the one most likely to be wrong, so both expire sooner
    // than a `high` year, which is a historical fact.
    expect(NO_YEAR_TTL_SECONDS).toBeLessThan(LOW_CONFIDENCE_TTL_SECONDS);
    expect(LOW_CONFIDENCE_TTL_SECONDS).toBeLessThan(HIGH_CONFIDENCE_TTL_SECONDS);
  });

  it('should never expire before the edge does, for any tier', () => {
    // THE RULE THAT SETS THESE NUMBERS. An edge miss is free -- it falls through to Redis --
    // while a Redis miss costs two requests against a budget that is global across all
    // users. So Redis must outlive the edge on every tier. An earlier two-tier version of
    // this file broke the rule on `low`: 30 days in Redis against 1 day at the edge.
    //
    // Mirrors CACHE_CONTROL in `api/year.ts`. If that table changes, this must too.
    const edgeSeconds = { high: 2_592_000, low: 86_400, none: 3_600 };

    expect(ttlFor(HIGH)).toBeGreaterThanOrEqual(edgeSeconds.high);
    expect(ttlFor(LOW)).toBeGreaterThanOrEqual(edgeSeconds.low);
    expect(ttlFor(NONE)).toBeGreaterThanOrEqual(edgeSeconds.none);
  });
});
