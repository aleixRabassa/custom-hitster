import { describe, expect, it } from 'vitest';

import {
  NO_WOMAN_NO_CRY,
  emptyReleaseGroups,
  emptySearch,
  noWomanNoCryReleaseGroups,
  noWomanNoCrySearch,
} from './__fixtures__/musicbrainz-payloads.js';
import { createMemoryCache } from './cache.js';
import { createMusicBrainzLookup, musicBrainzAnswerFrom } from './musicbrainz-provider.js';
import { MIN_REQUEST_INTERVAL_MS } from './rate-limit.js';
import type { YearCache } from './cache.js';
import type { FetchLike } from './musicbrainz.js';
import type { ProviderLookupInput } from './provider-lookup.js';
import type { RateLimitGate } from './rate-limit.js';
import type { YearResult } from '../../shared/types.js';
import { cleanTrackTitle, yearCacheKey } from '../../shared/year.js';

const USER_AGENT = 'custom-jitster/0.1.0 ( test@example.com )';

const openGate: RateLimitGate = {
  kind: 'instance',
  acquire: () => Promise.resolve({ ok: true }),
};

/** Answers the recording search and the release-group lookup from two fixed bodies. */
function stubFetch(responses: { recording: unknown; releaseGroup: unknown }): FetchLike {
  return (url) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          url.includes('/release-group?') ? responses.releaseGroup : responses.recording,
        ),
    });
}

/** Records every key written, which is how "never wrapped in the store cache" is observable. */
function recordingCache(): YearCache & { writtenKeys: string[] } {
  const inner = createMemoryCache();
  const writtenKeys: string[] = [];
  return {
    kind: 'memory',
    writtenKeys,
    get: (key) => inner.get(key),
    async set(key, value, ttl) {
      writtenKeys.push(key);
      await inner.set(key, value, ttl);
    },
  };
}

function inputFor(title: string, artist: string, durationMs?: number): ProviderLookupInput {
  return {
    rawTitle: title,
    cleaned: cleanTrackTitle(title),
    rawArtist: artist,
    primaryArtist: artist,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

const TRACK = inputFor(NO_WOMAN_NO_CRY.title, NO_WOMAN_NO_CRY.artist, NO_WOMAN_NO_CRY.durationMs);
const HEALTHY = { recording: noWomanNoCrySearch, releaseGroup: noWomanNoCryReleaseGroups };

describe('createMusicBrainzLookup', () => {
  it('should map a resolved year to an answer with its confidence, source and request count', async () => {
    const lookup = createMusicBrainzLookup({
      cache: createMemoryCache(),
      gate: openGate,
      fetchImpl: stubFetch(HEALTHY),
      readUserAgent: () => USER_AGENT,
    });

    expect(lookup.id).toBe('musicbrainz');
    expect(await lookup.lookup(TRACK)).toEqual({
      kind: 'answer',
      answer: {
        provider: 'musicbrainz',
        year: NO_WOMAN_NO_CRY.expectedYear,
        confidence: 'high',
        source: 'release-group',
      },
      cached: false,
      // One recording search, one release-group lookup -- counted at the fetch seam.
      requestCount: 2,
    });
  });

  it('should report a cache hit as cached with zero requests', async () => {
    // `resolveYear()` still owns cache-before-gate: the second lookup never reaches fetch.
    const cache = createMemoryCache();
    const lookup = createMusicBrainzLookup({
      cache,
      gate: openGate,
      fetchImpl: stubFetch(HEALTHY),
      readUserAgent: () => USER_AGENT,
    });

    await lookup.lookup(TRACK);
    const second = await lookup.lookup(TRACK);

    expect(second).toMatchObject({ kind: 'answer', cached: true, requestCount: 0 });
  });

  it('should map a lookup that found nothing to a null answer, not a failure', async () => {
    // A null from MusicBrainz is an ANSWER -- the vote can still be decided without it --
    // where a failure is not. Conflating the two would let an outage drop cards.
    const lookup = createMusicBrainzLookup({
      cache: createMemoryCache(),
      gate: openGate,
      fetchImpl: stubFetch({ recording: emptySearch, releaseGroup: emptyReleaseGroups }),
      readUserAgent: () => USER_AGENT,
    });

    expect(await lookup.lookup(inputFor('Nothing Like This', 'Nobody'))).toMatchObject({
      kind: 'answer',
      answer: { provider: 'musicbrainz', year: null, confidence: 'none' },
    });
  });

  it('should map upstream-unavailable to a transient failure', async () => {
    const rejecting: FetchLike = () => Promise.reject(new Error('socket hang up'));
    const lookup = createMusicBrainzLookup({
      cache: createMemoryCache(),
      gate: openGate,
      fetchImpl: rejecting,
      readUserAgent: () => USER_AGENT,
    });

    expect(await lookup.lookup(TRACK)).toEqual({ kind: 'failed', code: 'upstream-unavailable' });
  });

  it('should map an unexpected payload to a failure', async () => {
    // The adapter's `unexpected-payload` is a 200 whose body is not JSON at all.
    const notJson: FetchLike = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      });
    const lookup = createMusicBrainzLookup({
      cache: createMemoryCache(),
      gate: openGate,
      fetchImpl: notJson,
      readUserAgent: () => USER_AGENT,
    });

    expect(await lookup.lookup(TRACK)).toEqual({ kind: 'failed', code: 'unexpected-payload' });
  });

  it('should map a busy gate to busy with the gate retry delay', async () => {
    const closedGate: RateLimitGate = {
      kind: 'redis',
      acquire: () => Promise.resolve({ ok: false, retryAfterMs: 900 }),
    };
    const lookup = createMusicBrainzLookup({
      cache: createMemoryCache(),
      gate: closedGate,
      fetchImpl: stubFetch(HEALTHY),
      readUserAgent: () => USER_AGENT,
    });

    expect(await lookup.lookup(TRACK)).toEqual({ kind: 'busy', retryAfterMs: 900 });
    // The fallback when a refusal carries no delay is the gate's own interval. Pinned as a
    // number so it cannot silently become 0, which would make the client spin.
    expect(MIN_REQUEST_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('should skip a missing User-Agent as not-configured rather than failing', async () => {
    // The developer's decision (2026-09-30): every provider is skippable with a warning,
    // MusicBrainz included. Only the stage-less legacy path still turns this into a 500.
    let fetched = false;
    const lookup = createMusicBrainzLookup({
      cache: createMemoryCache(),
      gate: openGate,
      fetchImpl: () => {
        fetched = true;
        return Promise.reject(new Error('should not be called'));
      },
      readUserAgent: () => '   ',
    });

    expect(await lookup.lookup(TRACK)).toEqual({
      kind: 'skipped',
      reason: 'not-configured',
      missingVariable: 'MUSICBRAINZ_USER_AGENT',
    });
    expect(fetched).toBe(false);
  });

  it('should read the User-Agent on every lookup, not once', async () => {
    let userAgent = '';
    const lookup = createMusicBrainzLookup({
      cache: createMemoryCache(),
      gate: openGate,
      fetchImpl: stubFetch(HEALTHY),
      readUserAgent: () => userAgent,
    });

    expect((await lookup.lookup(TRACK)).kind).toBe('skipped');
    userAgent = USER_AGENT;
    expect((await lookup.lookup(TRACK)).kind).toBe('answer');
  });

  it('should write only its own mbyear entry and never a provider answer key', async () => {
    // "Never wrapped in the store cache", made observable: MusicBrainz caches under
    // `mbyear:` with its own tiered TTLs, and a `yearprov:musicbrainz:` twin would be a
    // second, independently-expiring copy of the same answer.
    const cache = recordingCache();
    const lookup = createMusicBrainzLookup({
      cache,
      gate: openGate,
      fetchImpl: stubFetch(HEALTHY),
      readUserAgent: () => USER_AGENT,
    });

    await lookup.lookup(TRACK);

    expect(cache.writtenKeys).toEqual([
      yearCacheKey(NO_WOMAN_NO_CRY.artist, cleanTrackTitle(NO_WOMAN_NO_CRY.title).title),
    ]);
    expect(cache.writtenKeys.some((key) => key.startsWith('yearprov:'))).toBe(false);
  });

  it('should pass the RAW title to resolveYear, which cleans it itself', async () => {
    // A remaster suffix left on the title returns zero MusicBrainz results; the answer
    // proves the cleaning still happened inside `resolveYear()`.
    const lookup = createMusicBrainzLookup({
      cache: createMemoryCache(),
      gate: openGate,
      fetchImpl: stubFetch(HEALTHY),
      readUserAgent: () => USER_AGENT,
    });

    const outcome = await lookup.lookup(
      inputFor(
        `${NO_WOMAN_NO_CRY.title} - Remastered 2001`,
        NO_WOMAN_NO_CRY.artist,
        NO_WOMAN_NO_CRY.durationMs,
      ),
    );

    expect(outcome).toMatchObject({ kind: 'answer', answer: { year: 1974 } });
  });
});

describe('musicBrainzAnswerFrom', () => {
  it('should carry viaTitle only when the year was found through a rewrite', () => {
    const viaRemix: YearResult = {
      year: 1999,
      confidence: 'low',
      source: 'recording',
      viaTitle: 'Song',
    };
    const plain: YearResult = { year: 1975, confidence: 'high', source: 'release-group' };

    expect(musicBrainzAnswerFrom(viaRemix)).toEqual({
      provider: 'musicbrainz',
      year: 1999,
      confidence: 'low',
      source: 'recording',
      viaTitle: 'Song',
    });
    expect(musicBrainzAnswerFrom(plain)).toEqual({
      provider: 'musicbrainz',
      year: 1975,
      confidence: 'high',
      source: 'release-group',
    });
  });

  it('should reject an inconsistent shape rather than invent an answer', () => {
    expect(musicBrainzAnswerFrom({ year: 1975, confidence: 'high' })).toBeUndefined();
    expect(musicBrainzAnswerFrom({ year: 1975, confidence: 'none' })).toBeUndefined();
    expect(musicBrainzAnswerFrom({ year: null, confidence: 'high' })).toBeUndefined();
    expect(musicBrainzAnswerFrom({ year: null, confidence: 'none' })).toEqual({
      provider: 'musicbrainz',
      year: null,
      confidence: 'none',
    });
  });
});
