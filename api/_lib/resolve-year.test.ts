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

// ===========================================================================
//  THE REMIX FALLBACK
//
//  Measured 2026-08-05 on a real 42-track playlist: 15 cards resolved to no
//  year, and FIVE of them carried an unstripped "- Remix". This tier exists for
//  those five, and only ever runs after both other tiers have already failed.
// ===========================================================================

const REMIX_TITLE = `${NO_WOMAN_NO_CRY.title} - Remix`;

/** The `recording:"…"` phrase as it appears inside the built URL. */
function encodedRecordingPhrase(title: string): string {
  return encodeURIComponent(`recording:"${title}"`);
}

/**
 * A fetch double that answers the RECORDING search differently depending on WHICH TITLE was
 * queried -- the whole point of this tier is that the two queries return different things.
 *
 * Only a query for exactly `NO_WOMAN_NO_CRY.title` finds anything; every other title comes back
 * empty, which is what MusicBrainz actually did for all five measured "- Remix" tracks. Keying
 * on the exact phrase rather than on the word "remix" is what lets the same double prove the
 * NEGATIVE case too: a title whose tail must not be stripped stays unresolved.
 */
function titleAwareFetch(options: { baseSearch?: unknown } = {}): {
  fetch: FetchLike;
  urls: string[];
} {
  const urls: string[] = [];
  const basePhrase = encodedRecordingPhrase(NO_WOMAN_NO_CRY.title);

  const fetch: FetchLike = (url) => {
    urls.push(url);
    if (url.includes('/release-group?')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(noWomanNoCryReleaseGroups),
      });
    }

    const body = url.includes(basePhrase)
      ? (options.baseSearch ?? noWomanNoCrySearch)
      : emptySearch;

    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };

  return { fetch, urls };
}

describe('resolveYear remix fallback', () => {
  it('should retry without the remix suffix when nothing else found a year', async () => {
    const cache = recordingCache();
    const { fetch } = titleAwareFetch();

    const outcome = await resolveYear(
      {
        title: REMIX_TITLE,
        artist: NO_WOMAN_NO_CRY.artist,
        durationMs: NO_WOMAN_NO_CRY.durationMs,
      },
      { cache, fetchImpl: fetch, gate: countingGate(), userAgent: USER_AGENT },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result).toMatchObject({
      year: NO_WOMAN_NO_CRY.expectedYear,
      // Downgraded even though the STRICT pass matched: the title had to be rewritten to find
      // it, which is exactly what `low` (and Phase 6's unconfirmed marker) is for.
      confidence: 'low',
      viaTitle: NO_WOMAN_NO_CRY.title,
      // The primary query's title, and what the cache key is derived from -- so it reads the
      // same on a hit as on a miss.
      cleanedTitle: REMIX_TITLE,
    });
  });

  it('should drop durationMs from the fallback query', async () => {
    // A remix is not the same length as the song it remixes, so bounding by the remix's
    // duration would exclude the very recording being looked for. This is the assertion that
    // stops someone "tidying up" the fallback by reusing the primary scoring input.
    const { fetch, urls } = titleAwareFetch();

    await resolveYear(
      {
        title: REMIX_TITLE,
        artist: NO_WOMAN_NO_CRY.artist,
        durationMs: NO_WOMAN_NO_CRY.durationMs,
      },
      { cache: createMemoryCache(), fetchImpl: fetch, gate: countingGate(), userAgent: USER_AGENT },
    );

    const fallbackQueries = urls.filter(
      (url) => !url.includes('/release-group?') && !url.toLowerCase().includes('remix'),
    );

    expect(fallbackQueries.length).toBeGreaterThan(0);
    expect(fallbackQueries.every((url) => !url.includes('dur%3A'))).toBe(true);
  });

  it('should not run the fallback when the primary passes already found a year', async () => {
    // The cost is bounded to tracks that were about to be blank anyway: nothing that resolves
    // normally spends a request here.
    const { fetch, urls } = titleAwareFetch();

    const outcome = await resolveYear(TRACK, {
      cache: createMemoryCache(),
      fetchImpl: fetch,
      gate: countingGate(),
      userAgent: USER_AGENT,
    });

    expect(outcome.ok && outcome.result.confidence).toBe('high');
    expect(outcome.ok && outcome.result.viaTitle).toBeUndefined();
    // Two requests: the recording search and the release-group enrichment. No third.
    expect(urls).toHaveLength(2);
  });

  it('should not strip a trailing segment that is not a remix', async () => {
    // The end-to-end guard against over-eager stripping, which is the failure mode that
    // silently changes which SONG is being asked about: "…- Reprise" is a different track from
    // the title one. If the fallback fired here it would query the bare title and confidently
    // return 1974 for the wrong recording, so a null is the pass condition.
    const { fetch, urls } = titleAwareFetch();

    const outcome = await resolveYear(
      { title: `${NO_WOMAN_NO_CRY.title} - Reprise`, artist: NO_WOMAN_NO_CRY.artist },
      { cache: createMemoryCache(), fetchImpl: fetch, gate: countingGate(), userAgent: USER_AGENT },
    );

    expect(outcome.ok && outcome.result.year).toBeNull();
    expect(outcome.ok && outcome.result.viaTitle).toBeUndefined();
    // And no query was ever made for the bare title.
    const basePhrase = encodedRecordingPhrase(NO_WOMAN_NO_CRY.title);
    expect(urls.some((url) => url.includes(basePhrase))).toBe(false);
  });

  it('should keep the null result when the fallback also finds nothing', async () => {
    const cache = recordingCache();
    const { fetch } = titleAwareFetch({ baseSearch: emptySearch });

    const outcome = await resolveYear(
      { title: REMIX_TITLE, artist: NO_WOMAN_NO_CRY.artist },
      { cache, fetchImpl: fetch, gate: countingGate(), userAgent: USER_AGENT },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result).toMatchObject({ year: null, confidence: 'none' });
    expect(outcome.result.viaTitle).toBeUndefined();
    // Still cached, and still under the original key: the answer for THIS title is known.
    expect(cache.writes).toHaveLength(1);
    expect(cache.writes[0]?.key).toBe(yearCacheKey(NO_WOMAN_NO_CRY.artist, REMIX_TITLE));
    expect(cache.writes[0]?.ttl).toBe(NO_YEAR_TTL_SECONDS);
  });

  it('should not turn a fallback upstream failure into a request failure', async () => {
    // A definite "no year" must not become a 502 that makes the client retry a card whose
    // answer is already known -- the fallback is an optimisation, not a dependency.
    let call = 0;
    const fetch: FetchLike = (url) => {
      call += 1;
      // Everything the primary ladder asks for succeeds (and finds nothing); the first
      // fallback query fails.
      if (!url.toLowerCase().includes('remix')) {
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(emptySearch) });
    };

    const outcome = await resolveYear(
      { title: REMIX_TITLE, artist: NO_WOMAN_NO_CRY.artist },
      { cache: createMemoryCache(), fetchImpl: fetch, gate: countingGate(), userAgent: USER_AGENT },
    );

    expect(call).toBeGreaterThan(1);
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.ok && outcome.result.year).toBeNull();
  });

  it('should carry viaTitle through the cache', async () => {
    // It lives on the stored `YearResult`, so a cache hit explains itself exactly as the
    // original miss did. Storing only the year and confidence would lose the one field that
    // says "we asked about a different title than the card shows".
    const cache = createMemoryCache();
    const { fetch } = titleAwareFetch();
    const track = { title: REMIX_TITLE, artist: NO_WOMAN_NO_CRY.artist };
    const deps = { cache, fetchImpl: fetch, gate: countingGate(), userAgent: USER_AGENT };

    await resolveYear(track, deps);
    const second = await resolveYear(track, deps);

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.result).toMatchObject({
      cached: true,
      confidence: 'low',
      viaTitle: NO_WOMAN_NO_CRY.title,
    });
  });
});
