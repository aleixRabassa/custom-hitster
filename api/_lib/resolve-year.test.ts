import { describe, expect, it } from 'vitest';

import {
  NO_WOMAN_NO_CRY,
  emptySearch,
  noWomanNoCryReleaseGroups,
  noWomanNoCrySearch,
  undatedSearch,
} from './__fixtures__/musicbrainz-payloads.js';
import { HIGH_CONFIDENCE_TTL_SECONDS, NO_YEAR_TTL_SECONDS, createMemoryCache } from './cache.js';
import { resolveYear } from './resolve-year.js';
import type { FetchLike } from './musicbrainz.js';
import type { RateLimitGate } from './rate-limit.js';
import type { YearCache } from './cache.js';
import type { YearResult } from '../../shared/types.js';
import { yearCacheKey } from '../../shared/year.js';

const USER_AGENT = 'custom-hitster/0.1.0 ( test@example.com )';

function countingGate(): RateLimitGate & { permits: number } {
  const gate = {
    kind: 'instance' as const,
    permits: 0,
    acquire() {
      gate.permits += 1;
      return Promise.resolve({ ok: true as const });
    },
  };
  return gate;
}

function stubFetch(responses: { recording?: unknown; releaseGroup?: unknown }): {
  fetch: FetchLike;
  calls: number;
} {
  const state = { calls: 0 };
  const fetch: FetchLike = (url) => {
    state.calls += 1;
    const body = url.includes('/release-group?') ? responses.releaseGroup : responses.recording;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body ?? {}) });
  };
  return {
    fetch,
    get calls() {
      return state.calls;
    },
  };
}

/** Records every write, so the negative-caching contract can be asserted. */
function recordingCache(): YearCache & {
  writes: { key: string; value: YearResult; ttl: number }[];
} {
  const inner = createMemoryCache();
  const writes: { key: string; value: YearResult; ttl: number }[] = [];
  return {
    kind: 'memory',
    writes,
    get: (key) => inner.get(key),
    async set(key, value, ttl) {
      writes.push({ key, value, ttl });
      await inner.set(key, value, ttl);
    },
  };
}

const TRACK = {
  title: NO_WOMAN_NO_CRY.title,
  artist: NO_WOMAN_NO_CRY.artist,
  durationMs: NO_WOMAN_NO_CRY.durationMs,
};

const HEALTHY = { recording: noWomanNoCrySearch, releaseGroup: noWomanNoCryReleaseGroups };

describe('resolveYear', () => {
  it('should resolve a track to a high-confidence year and cache it', async () => {
    const cache = recordingCache();
    const { fetch } = stubFetch(HEALTHY);

    const outcome = await resolveYear(TRACK, {
      cache,
      fetchImpl: fetch,
      gate: countingGate(),
      userAgent: USER_AGENT,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result).toEqual({
      year: NO_WOMAN_NO_CRY.expectedYear,
      confidence: 'high',
      source: 'release-group',
      cached: false,
      cleanedTitle: NO_WOMAN_NO_CRY.title,
      stripped: { remaster: false, live: false, feature: false, version: false },
    });

    expect(cache.writes).toHaveLength(1);
    expect(cache.writes[0]?.ttl).toBe(HIGH_CONFIDENCE_TTL_SECONDS);
  });

  it('should not consume a permit when the caller had a cache hit', async () => {
    // Decision 11, and the reason the cache read comes BEFORE the gate rather than after.
    // Once a playlist has been played, the whole deck must resolve at cache speed; gating
    // hits would make the common case as slow as the cold one, for nothing -- no request
    // leaves the building.
    const cache = createMemoryCache();
    const gate = countingGate();
    const { fetch, calls } = stubFetch(HEALTHY);

    const first = await resolveYear(TRACK, {
      cache,
      fetchImpl: fetch,
      gate,
      userAgent: USER_AGENT,
    });
    const permitsAfterMiss = gate.permits;
    const requestsAfterMiss = calls;

    const second = await resolveYear(TRACK, {
      cache,
      fetchImpl: fetch,
      gate,
      userAgent: USER_AGENT,
    });

    expect(first.ok && first.result.cached).toBe(false);
    expect(second.ok && second.result.cached).toBe(true);
    expect(second.ok && second.result.year).toBe(NO_WOMAN_NO_CRY.expectedYear);

    // The load-bearing assertions: the second lookup took NO permit and made NO request.
    expect(gate.permits).toBe(permitsAfterMiss);
    expect(calls).toBe(requestsAfterMiss);
  });

  it('should preserve confidence and source across a cache hit', async () => {
    // Storing a bare year would silently report `high` for everything and defeat Phase 6's
    // reveal-side year UI.
    const cache = createMemoryCache();
    const key = yearCacheKey(TRACK.artist, TRACK.title);
    await cache.set(key, { year: 1966, confidence: 'low', source: 'recording' }, 60);

    const outcome = await resolveYear(TRACK, {
      cache,
      fetchImpl: stubFetch(HEALTHY).fetch,
      gate: countingGate(),
      userAgent: USER_AGENT,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.confidence).toBe('low');
    expect(outcome.result.source).toBe('recording');
    expect(outcome.result.cached).toBe(true);
  });

  it('should clean the title before querying and report what it cleaned', async () => {
    // The remaster suffix returns ZERO results verbatim, so this is a correctness
    // requirement. `cleanedTitle` is echoed back so a wrong year can be diagnosed.
    const cache = recordingCache();

    const outcome = await resolveYear(
      { ...TRACK, title: `${NO_WOMAN_NO_CRY.title} - Remastered 2001` },
      { cache, fetchImpl: stubFetch(HEALTHY).fetch, gate: countingGate(), userAgent: USER_AGENT },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.cleanedTitle).toBe(NO_WOMAN_NO_CRY.title);
    expect(outcome.result.stripped.remaster).toBe(true);
    // Cached under the CLEANED title, so the suffixed and unsuffixed forms share one entry.
    expect(cache.writes[0]?.key).toBe(yearCacheKey(TRACK.artist, NO_WOMAN_NO_CRY.title));
  });

  it('should fall through to the relaxed tier when the strict pass finds nothing', async () => {
    // The tier transition -- the case the non-existent Spotify-year fallback was meant to
    // handle. `low` is what marks it for review rather than pretending it is solid.
    const cache = recordingCache();
    const search = {
      ...undatedSearch,
      recordings: [
        {
          ...undatedSearch.recordings[0],
          'first-release-date': '1966',
        },
      ],
    };

    const outcome = await resolveYear(
      { title: 'A Song With No Dates', artist: 'A Band' },
      {
        cache,
        fetchImpl: stubFetch({ recording: search, releaseGroup: { 'release-groups': [] } }).fetch,
        gate: countingGate(),
        userAgent: USER_AGENT,
      },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({ year: 1966, confidence: 'low', source: 'recording' });
  });

  it('should cache a negative result with the shorter TTL', async () => {
    // Negatives ARE cached (decision 9): a miss costs a full two-request round trip and the
    // next person with the same playlist asks for the same track. Shorter, because
    // MusicBrainz data improves.
    const cache = recordingCache();

    const outcome = await resolveYear(
      { title: 'Zzzqqq Nonexistent Song', artist: 'Nobody At All' },
      {
        cache,
        fetchImpl: stubFetch({ recording: emptySearch }).fetch,
        gate: countingGate(),
        userAgent: USER_AGENT,
      },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result).toMatchObject({
      year: null,
      confidence: 'none',
      reason: 'no-candidates',
    });
    expect(cache.writes[0]?.ttl).toBe(NO_YEAR_TTL_SECONDS);
  });

  it('should not cache an upstream failure', async () => {
    // A 502 is a statement about MusicBrainz's availability right now, not about the track.
    // Caching it would poison the key for a day for no reason.
    const cache = recordingCache();
    const rejecting: FetchLike = () => Promise.reject(new Error('socket hang up'));

    const outcome = await resolveYear(TRACK, {
      cache,
      fetchImpl: rejecting,
      gate: countingGate(),
      userAgent: USER_AGENT,
    });

    expect(outcome).toMatchObject({ ok: false, code: 'upstream-unavailable' });
    expect(cache.writes).toEqual([]);
  });

  it('should surface a rate-limit refusal with its retry delay', async () => {
    const closedGate: RateLimitGate = {
      kind: 'redis',
      acquire: () => Promise.resolve({ ok: false, retryAfterMs: 1100 }),
    };

    const outcome = await resolveYear(TRACK, {
      cache: createMemoryCache(),
      fetchImpl: stubFetch(HEALTHY).fetch,
      gate: closedGate,
      userAgent: USER_AGENT,
    });

    expect(outcome).toMatchObject({ ok: false, code: 'rate-limited', retryAfterMs: 1100 });
  });

  it('should report not-configured when the User-Agent is missing', async () => {
    const outcome = await resolveYear(TRACK, {
      cache: createMemoryCache(),
      fetchImpl: stubFetch(HEALTHY).fetch,
      gate: countingGate(),
      userAgent: '',
    });

    expect(outcome).toMatchObject({ ok: false, code: 'not-configured' });
  });

  it('should report not-configured even when the answer is already cached', async () => {
    // Found by the live check on 2026-08-04: with the guard only in the adapter, a warm
    // cache served the track happily and only cold tracks 500'd, so a deployment with no
    // MUSICBRAINZ_USER_AGENT looked INTERMITTENTLY broken. That is exactly the
    // confusing-to-diagnose failure decision 17 exists to prevent, so the check runs before
    // the cache read.
    const cache = createMemoryCache();
    await cache.set(
      yearCacheKey(TRACK.artist, TRACK.title),
      { year: 1974, confidence: 'high', source: 'release-group' },
      60,
    );

    const outcome = await resolveYear(TRACK, {
      cache,
      fetchImpl: stubFetch(HEALTHY).fetch,
      gate: countingGate(),
      userAgent: '',
    });

    expect(outcome).toMatchObject({ ok: false, code: 'not-configured' });
  });
});
