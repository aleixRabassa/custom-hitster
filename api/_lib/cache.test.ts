import { describe, expect, it, vi } from 'vitest';

import {
  HIGH_CONFIDENCE_TTL_SECONDS,
  LOW_CONFIDENCE_TTL_SECONDS,
  NO_YEAR_TTL_SECONDS,
  PROVIDER_ANSWER_TTL_SECONDS,
  PROVISIONAL_EDGE_SECONDS,
  answerTtlFor,
  createCache,
  createMemoryCache,
  createUpstashCache,
  isProviderAnswer,
  providerAnswerKey,
  stagedEdgeMaxAgeSeconds,
  ttlFor,
  withAnswerCache,
} from './cache.js';
import type { FetchLike, SharedYearCache } from './cache.js';
import type { ProviderLookup, ProviderLookupInput, ProviderOutcome } from './provider-lookup.js';
import type { ProviderAnswer, YearProviderId, YearResult } from '../../shared/types.js';
import { cleanTrackTitle, yearCacheKey } from '../../shared/year.js';
import { providerCacheKey } from '../../shared/year-providers.js';

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

  it('should never let the edge outlive the entries an answer was built from', () => {
    // THE RULE THAT SETS THESE NUMBERS, restated for the staged path. An edge miss is free --
    // it falls through to Redis -- while a Redis miss costs requests against budgets that
    // are global across all users. The staged path recomputes the vote from its cache
    // entries on every call, so a FINAL answer with nothing skipped may be held at the edge
    // for at most the SHORTEST TTL among those entries; anything provisional, or final only
    // because a provider was skipped, gets the short window. An earlier two-tier version of
    // this file broke the old per-tier rule on `low`: 30 days in Redis against 1 day at the
    // edge.
    const entries: ProviderAnswer[] = [
      { provider: 'deezer', year: 1991, isrcYear: 1991 },
      { provider: 'musicbrainz', year: 1991, confidence: 'low', source: 'recording' },
      { provider: 'itunes', year: null },
    ];
    const ttls = entries.map((answer) => answerTtlFor(answer));

    for (let count = 1; count <= entries.length; count += 1) {
      const built = ttls.slice(0, count);
      const edge = stagedEdgeMaxAgeSeconds({
        final: true,
        skipped: false,
        sourceTtlsSeconds: built,
      });
      expect(edge).toBeLessThanOrEqual(Math.min(...built));
    }

    expect(stagedEdgeMaxAgeSeconds({ final: false, skipped: false, sourceTtlsSeconds: ttls })).toBe(
      PROVISIONAL_EDGE_SECONDS,
    );
    expect(stagedEdgeMaxAgeSeconds({ final: true, skipped: true, sourceTtlsSeconds: ttls })).toBe(
      PROVISIONAL_EDGE_SECONDS,
    );
    expect(stagedEdgeMaxAgeSeconds({ final: true, skipped: false, sourceTtlsSeconds: [] })).toBe(
      PROVISIONAL_EDGE_SECONDS,
    );
    // The short window is itself shorter than every entry it could be built from.
    expect(PROVISIONAL_EDGE_SECONDS).toBeLessThan(NO_YEAR_TTL_SECONDS);

    // The stage-less legacy path keeps its own per-tier table in `api/year.ts`, unchanged
    // byte for byte (`api/_lib/year-endpoint.test.ts` pins the header strings); the same rule holds there.
    const legacyEdgeSeconds = { high: 2_592_000, low: 86_400, none: 3_600 };
    expect(ttlFor(HIGH)).toBeGreaterThanOrEqual(legacyEdgeSeconds.high);
    expect(ttlFor(LOW)).toBeGreaterThanOrEqual(legacyEdgeSeconds.low);
    expect(ttlFor(NONE)).toBeGreaterThanOrEqual(legacyEdgeSeconds.none);
  });
});

const DEEZER_ANSWER: ProviderAnswer = { provider: 'deezer', year: 1975, isrcYear: 2011 };
const DEEZER_NULL: ProviderAnswer = { provider: 'deezer', year: null, isrcYear: null };
const ITUNES_ANSWER: ProviderAnswer = { provider: 'itunes', year: 1975 };
const ITUNES_NULL: ProviderAnswer = { provider: 'itunes', year: null };

const ARTIST = 'Queen';
const TITLE = 'Bohemian Rhapsody - Remastered 2011';
const CLEANED = cleanTrackTitle(TITLE);
const DEEZER_KEY = providerCacheKey('deezer', ARTIST, CLEANED.title);
const ITUNES_KEY = providerCacheKey('itunes', ARTIST, CLEANED.title);
const MB_KEY = yearCacheKey(ARTIST, CLEANED.title);

const INPUT: ProviderLookupInput = {
  rawTitle: TITLE,
  cleaned: CLEANED,
  rawArtist: ARTIST,
  primaryArtist: ARTIST,
  durationMs: 354_000,
};

/** An Upstash double over a real key-value map, so SET, GET and MGET agree with each other. */
function fakeUpstash(): { fetch: FetchLike; commands: unknown[][] } {
  const values = new Map<string, string>();
  const commands: unknown[][] = [];
  const fetch: FetchLike = (_url, init) => {
    const args = JSON.parse(init.body) as (string | number)[];
    commands.push(args);
    let result: unknown = 'OK';
    if (args[0] === 'SET') values.set(String(args[1]), String(args[2]));
    if (args[0] === 'GET') result = values.get(String(args[1])) ?? null;
    if (args[0] === 'MGET') result = args.slice(1).map((key) => values.get(String(key)) ?? null);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result }) });
  };
  return { fetch, commands };
}

/** Both adapters, so every provider-cache behaviour is asserted of each. */
const ADAPTERS: [string, () => SharedYearCache][] = [
  ['memory', () => createMemoryCache()],
  ['upstash', () => createUpstashCache(UPSTASH, fakeUpstash().fetch)],
];

describe.each(ADAPTERS)('the provider answer cache (%s)', (_name, make) => {
  it('should round-trip each answer shape', async () => {
    const cache = make();
    const shapes: [YearProviderId, string, ProviderAnswer][] = [
      ['deezer', 'with a year', DEEZER_ANSWER],
      ['deezer', 'null', DEEZER_NULL],
      ['itunes', 'with a year', ITUNES_ANSWER],
      ['itunes', 'null', ITUNES_NULL],
    ];

    for (const [provider, title, answer] of shapes) {
      const key = providerCacheKey(provider, ARTIST, title);
      await cache.setAnswer(key, answer, answerTtlFor(answer));
      expect((await cache.readMany([{ provider, key }])).answers).toEqual([answer]);
    }
  });

  it('should return hits and misses in order, and the mbyear entry beside them', async () => {
    const cache = make();
    await cache.setAnswer(ITUNES_KEY, ITUNES_ANSWER, 60);
    await cache.set(MB_KEY, HIGH, 60);

    const read = await cache.readMany(
      [
        { provider: 'deezer', key: DEEZER_KEY },
        { provider: 'itunes', key: ITUNES_KEY },
      ],
      MB_KEY,
    );

    expect(read).toEqual({ answers: [undefined, ITUNES_ANSWER], year: HIGH });
  });

  it('should see an mbyear entry written through the YearCache view', async () => {
    // ONE store behind both views. Two would type-check and pass every single-view test,
    // and every warm card in memory mode would re-ask MusicBrainz.
    const cache = make();
    await cache.set(MB_KEY, LOW, LOW_CONFIDENCE_TTL_SECONDS);

    expect((await cache.readMany([], MB_KEY)).year).toEqual(LOW);
    expect(await cache.get(MB_KEY)).toEqual(LOW);
  });

  it('should reject a stored answer that names another provider', async () => {
    // Otherwise one iTunes answer read back under Deezer's key would vote twice.
    const cache = make();
    await cache.setAnswer(DEEZER_KEY, ITUNES_ANSWER, 60);

    expect((await cache.readMany([{ provider: 'deezer', key: DEEZER_KEY }])).answers).toEqual([
      undefined,
    ]);
  });
});

describe('the provider answer cache in memory', () => {
  it('should expire an answer once its TTL has elapsed, inside a batched read too', async () => {
    vi.useFakeTimers();
    try {
      const cache = createMemoryCache();
      await cache.setAnswer(DEEZER_KEY, DEEZER_ANSWER, 60);
      await cache.set(MB_KEY, HIGH, 30);

      vi.advanceTimersByTime(31_000);
      expect(await cache.readMany([{ provider: 'deezer', key: DEEZER_KEY }], MB_KEY)).toEqual({
        answers: [DEEZER_ANSWER],
        year: undefined,
      });

      vi.advanceTimersByTime(30_000);
      expect((await cache.readMany([{ provider: 'deezer', key: DEEZER_KEY }])).answers).toEqual([
        undefined,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the provider answer cache over Upstash', () => {
  it('should read every key, the mbyear one included, in ONE MGET', async () => {
    // A warm card costs one Redis command. That is the whole reason for the batched read.
    const { fetch, commands } = fakeUpstash();
    const cache = createUpstashCache(UPSTASH, fetch);

    await cache.readMany(
      [
        { provider: 'deezer', key: DEEZER_KEY },
        { provider: 'itunes', key: ITUNES_KEY },
      ],
      MB_KEY,
    );

    expect(commands).toEqual([['MGET', DEEZER_KEY, ITUNES_KEY, MB_KEY]]);
  });

  it('should send no command at all for an empty read', async () => {
    const { fetch, commands } = fakeUpstash();

    expect(await createUpstashCache(UPSTASH, fetch).readMany([])).toEqual({
      answers: [],
      year: undefined,
    });
    expect(commands).toEqual([]);
  });

  it('should write an answer with SET … EX in one command', async () => {
    const { fetch, commands } = fakeUpstash();

    await createUpstashCache(UPSTASH, fetch).setAnswer(DEEZER_KEY, DEEZER_ANSWER, 900);

    expect(commands).toEqual([['SET', DEEZER_KEY, JSON.stringify(DEEZER_ANSWER), 'EX', 900]]);
  });

  it('should reject invalid stored values slot by slot', async () => {
    // A corrupt slot is a miss on ITS slot only; the valid neighbour still reads.
    const stored = [
      'not json',
      JSON.stringify({ provider: 'deezer', year: '1975', isrcYear: null }),
      JSON.stringify({ provider: 'itunes', year: 3000 }),
      JSON.stringify(ITUNES_ANSWER),
      JSON.stringify({ year: 1975 }),
    ];
    const cache = createUpstashCache(UPSTASH, stubFetch(stored).fetch);

    const read = await cache.readMany(
      [
        { provider: 'deezer', key: 'a' },
        { provider: 'deezer', key: 'b' },
        { provider: 'itunes', key: 'c' },
        { provider: 'itunes', key: 'd' },
      ],
      'e',
    );

    expect(read).toEqual({
      answers: [undefined, undefined, undefined, ITUNES_ANSWER],
      year: undefined,
    });
  });

  it('should treat a failed batched read as a miss on every slot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rejecting: FetchLike = () => Promise.reject(new Error('ECONNRESET'));
      const cache = createUpstashCache(UPSTASH, rejecting);

      await expect(
        cache.readMany([{ provider: 'deezer', key: DEEZER_KEY }], MB_KEY),
      ).resolves.toEqual({ answers: [undefined], year: undefined });
      // A short MGET answer is not trusted either: a slot must never shift onto a neighbour.
      await expect(
        createUpstashCache(UPSTASH, stubFetch([null]).fetch).readMany(
          [{ provider: 'deezer', key: DEEZER_KEY }],
          MB_KEY,
        ),
      ).resolves.toEqual({ answers: [undefined], year: undefined });
      await expect(cache.setAnswer(DEEZER_KEY, DEEZER_ANSWER, 60)).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('isProviderAnswer', () => {
  it('should accept every arm and reject malformed ones', () => {
    expect(isProviderAnswer(DEEZER_ANSWER, 'deezer')).toBe(true);
    expect(isProviderAnswer(ITUNES_NULL, 'itunes')).toBe(true);
    expect(
      isProviderAnswer(
        { provider: 'musicbrainz', year: 1975, confidence: 'high', source: 'release-group' },
        'musicbrainz',
      ),
    ).toBe(true);
    expect(
      isProviderAnswer({ provider: 'musicbrainz', year: null, confidence: 'none' }, 'musicbrainz'),
    ).toBe(true);

    expect(isProviderAnswer({ provider: 'deezer', year: 1975 }, 'deezer')).toBe(false);
    expect(isProviderAnswer({ provider: 'itunes', year: 1975.5 }, 'itunes')).toBe(false);
    expect(isProviderAnswer({ provider: 'itunes', year: 1200 }, 'itunes')).toBe(false);
    expect(
      isProviderAnswer({ provider: 'musicbrainz', year: 1975, confidence: 'high' }, 'musicbrainz'),
    ).toBe(false);
    expect(
      isProviderAnswer({ provider: 'musicbrainz', year: null, confidence: 'low' }, 'musicbrainz'),
    ).toBe(false);
    expect(isProviderAnswer(null, 'itunes')).toBe(false);
  });
});

describe('answerTtlFor', () => {
  it('should give a store answer 30 days with a year and 1 day for a null', () => {
    expect(answerTtlFor(DEEZER_ANSWER)).toBe(60 * 60 * 24 * 30);
    expect(answerTtlFor(ITUNES_ANSWER)).toBe(60 * 60 * 24 * 30);
    expect(answerTtlFor(DEEZER_NULL)).toBe(60 * 60 * 24);
    expect(answerTtlFor(ITUNES_NULL)).toBe(60 * 60 * 24);
    expect(PROVIDER_ANSWER_TTL_SECONDS.itunes).toEqual({
      year: HIGH_CONFIDENCE_TTL_SECONDS,
      none: NO_YEAR_TTL_SECONDS,
    });
  });

  it('should give a MusicBrainz answer the TTL of the mbyear entry it came from', () => {
    // So the edge rule can take one minimum over entries of both families.
    expect(
      answerTtlFor({
        provider: 'musicbrainz',
        year: 1975,
        confidence: 'high',
        source: 'release-group',
      }),
    ).toBe(ttlFor(HIGH));
    expect(
      answerTtlFor({ provider: 'musicbrainz', year: 1966, confidence: 'low', source: 'recording' }),
    ).toBe(ttlFor(LOW));
    expect(answerTtlFor({ provider: 'musicbrainz', year: null, confidence: 'none' })).toBe(
      ttlFor(NONE),
    );
  });
});

/** A store lookup double that answers one fixed outcome and counts its calls. */
function fixedLookup(
  id: YearProviderId,
  outcome: ProviderOutcome,
): ProviderLookup & { calls: number } {
  const lookup = {
    id,
    calls: 0,
    lookup() {
      lookup.calls += 1;
      return Promise.resolve(outcome);
    },
  };
  return lookup;
}

/** Records every `setAnswer`, so the TTL each answer is written with can be asserted. */
function recordingAnswerCache(): SharedYearCache & {
  writes: { key: string; answer: ProviderAnswer; ttl: number }[];
} {
  const inner = createMemoryCache();
  const writes: { key: string; answer: ProviderAnswer; ttl: number }[] = [];
  return {
    kind: 'memory',
    writes,
    get: (key) => inner.get(key),
    set: (key, value, ttl) => inner.set(key, value, ttl),
    readMany: (reads, yearKey) => inner.readMany(reads, yearKey),
    async setAnswer(key, answer, ttl) {
      writes.push({ key, answer, ttl });
      await inner.setAnswer(key, answer, ttl);
    },
  };
}

describe('withAnswerCache', () => {
  it('should ask once, write the answer with its TTL, and serve the next call from cache', async () => {
    const cache = recordingAnswerCache();
    const inner = fixedLookup('itunes', {
      kind: 'answer',
      answer: ITUNES_ANSWER,
      cached: false,
      requestCount: 1,
    });
    const wrapped = withAnswerCache(inner, cache);

    expect(wrapped.id).toBe('itunes');
    expect(await wrapped.lookup(INPUT)).toMatchObject({ kind: 'answer', cached: false });
    expect(await wrapped.lookup(INPUT)).toEqual({
      kind: 'answer',
      answer: ITUNES_ANSWER,
      cached: true,
      requestCount: 0,
    });

    expect(inner.calls).toBe(1);
    expect(cache.writes).toEqual([
      { key: ITUNES_KEY, answer: ITUNES_ANSWER, ttl: 60 * 60 * 24 * 30 },
    ]);
  });

  it('should cache a null answer for a day', async () => {
    const cache = recordingAnswerCache();
    const wrapped = withAnswerCache(
      fixedLookup('deezer', {
        kind: 'answer',
        answer: DEEZER_NULL,
        cached: false,
        requestCount: 1,
      }),
      cache,
    );

    await wrapped.lookup(INPUT);

    expect(cache.writes).toEqual([{ key: DEEZER_KEY, answer: DEEZER_NULL, ttl: 60 * 60 * 24 }]);
  });

  it('should pass skipped, failed and busy through without caching them', async () => {
    // Each is a statement about the provider right now, not about the track.
    const outcomes: ProviderOutcome[] = [
      { kind: 'skipped', reason: 'not-configured', missingVariable: 'X' },
      { kind: 'failed', code: 'upstream-unavailable' },
      { kind: 'busy', retryAfterMs: 3_000 },
    ];

    for (const outcome of outcomes) {
      const cache = recordingAnswerCache();
      const inner = fixedLookup('itunes', outcome);
      const wrapped = withAnswerCache(inner, cache);

      expect(await wrapped.lookup(INPUT)).toEqual(outcome);
      expect(await wrapped.lookup(INPUT)).toEqual(outcome);
      expect(inner.calls).toBe(2);
      expect(cache.writes).toEqual([]);
    }
  });

  it('should key by the raw artist and the cleaned title, as the batched read does', () => {
    expect(providerAnswerKey('deezer', INPUT)).toBe(DEEZER_KEY);
    expect(providerAnswerKey('itunes', { ...INPUT, primaryArtist: 'Someone Else' })).toBe(
      ITUNES_KEY,
    );
  });
});
