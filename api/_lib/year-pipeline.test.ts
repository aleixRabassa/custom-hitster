import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NO_WOMAN_NO_CRY,
  noWomanNoCryReleaseGroups,
  noWomanNoCrySearch,
} from './__fixtures__/musicbrainz-payloads.js';
import {
  HIGH_CONFIDENCE_TTL_SECONDS,
  LOW_CONFIDENCE_TTL_SECONDS,
  NO_YEAR_TTL_SECONDS,
  createMemoryCache,
  providerAnswerKey,
  withAnswerCache,
} from './cache.js';
import { createMusicBrainzLookup } from './musicbrainz-provider.js';
import { resetSkipWarnings, runStage } from './year-pipeline.js';
import type { SharedYearCache } from './cache.js';
import type { FetchLike } from './musicbrainz.js';
import type {
  ProviderLookup,
  ProviderLookupInput,
  ProviderOutcome,
  ProviderRegistry,
} from './provider-lookup.js';
import type { RateLimitGate } from './rate-limit.js';
import type { StageInput } from './year-pipeline.js';
import type { ProviderAnswer, YearProviderId, YearResult } from '../../shared/types.js';
import { cleanTrackTitle, yearCacheKey } from '../../shared/year.js';
import { YEAR_PROVIDER_PLAN } from '../../shared/year-providers.js';
import type { ProviderPlan } from '../../shared/year-providers.js';

const TRACK: StageInput = {
  title: NO_WOMAN_NO_CRY.title,
  artist: NO_WOMAN_NO_CRY.artist,
  durationMs: NO_WOMAN_NO_CRY.durationMs,
};
const CLEANED = cleanTrackTitle(TRACK.title);
const LOOKUP_INPUT: ProviderLookupInput = {
  rawTitle: TRACK.title,
  cleaned: CLEANED,
  rawArtist: TRACK.artist,
  primaryArtist: 'Bob Marley',
};
const MB_KEY = yearCacheKey(TRACK.artist, CLEANED.title);

/** One answer per provider, and a helper for each outcome kind. */
const deezer = (year: number | null, isrcYear: number | null = year): ProviderAnswer => ({
  provider: 'deezer',
  year,
  isrcYear,
});
const itunes = (year: number | null): ProviderAnswer => ({ provider: 'itunes', year });
const musicbrainz = (year: number, confidence: 'high' | 'low' = 'high'): ProviderAnswer => ({
  provider: 'musicbrainz',
  year,
  confidence,
  source: 'release-group',
});
const answered = (answer: ProviderAnswer): ProviderOutcome => ({
  kind: 'answer',
  answer,
  cached: false,
  requestCount: 1,
});
const FAILED: ProviderOutcome = { kind: 'failed', code: 'upstream-unavailable' };
const notConfigured = (missingVariable: string): ProviderOutcome => ({
  kind: 'skipped',
  reason: 'not-configured',
  missingVariable,
});
/** The provider ITSELF refused us (a 403/429, a quota body) -- never `busy`, which is our gate. */
const refused = (detail: string): ProviderOutcome => ({
  kind: 'skipped',
  reason: 'refused',
  detail,
});

type FakeLookup = ProviderLookup & { calls: number };

/**
 * A provider double. Each call takes the next scripted outcome (the last one repeats), or a
 * function, so a test can hold a call open with a deferred promise.
 */
function fake(
  id: YearProviderId,
  script: ProviderOutcome | ProviderOutcome[] | (() => Promise<ProviderOutcome>),
): FakeLookup {
  const lookup: FakeLookup = {
    id,
    calls: 0,
    lookup() {
      lookup.calls += 1;
      if (typeof script === 'function') return script();
      if (!Array.isArray(script)) return Promise.resolve(script);
      const outcome = script[Math.min(lookup.calls - 1, script.length - 1)];
      return outcome === undefined
        ? Promise.reject(new Error('empty script'))
        : Promise.resolve(outcome);
    },
  };
  return lookup;
}

/** A provider that must never be asked; asking it fails the test through its outcome. */
const never = (id: YearProviderId): FakeLookup =>
  fake(id, () => Promise.reject(new Error(`${id} should not have been asked`)));

function registryOf(lookups: {
  deezer: ProviderLookup;
  musicbrainz: ProviderLookup;
  itunes: ProviderLookup;
}): ProviderRegistry {
  return lookups;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** The real MusicBrainz provider over fixture payloads, so the `mbyear:` entry is real too. */
function realMusicBrainz(cache: SharedYearCache): ProviderLookup & { fetches: number } {
  const openGate: RateLimitGate = {
    kind: 'instance',
    acquire: () => Promise.resolve({ ok: true }),
  };
  const state = { fetches: 0 };
  const fetchImpl: FetchLike = (url) => {
    state.fetches += 1;
    const body = url.includes('/release-group?') ? noWomanNoCryReleaseGroups : noWomanNoCrySearch;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  const lookup = createMusicBrainzLookup({
    cache,
    gate: openGate,
    fetchImpl,
    readUserAgent: () => 'custom-jitster/0.1.0 ( test@example.com )',
  });
  return {
    id: lookup.id,
    lookup: (input) => lookup.lookup(input),
    get fetches() {
      return state.fetches;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runStage: resolve', () => {
  it('should ask Deezer and MusicBrainz concurrently on a cold card', async () => {
    // The parallel pair falls out of `nextFrontier`, and the driver must actually run it in
    // parallel: both requests in flight before either answers.
    const deezerCall = deferred<ProviderOutcome>();
    const mbCall = deferred<ProviderOutcome>();
    const deezerLookup = fake('deezer', () => deezerCall.promise);
    const mbLookup = fake('musicbrainz', () => mbCall.promise);

    const pending = runStage(
      'resolve',
      TRACK,
      registryOf({ deezer: deezerLookup, musicbrainz: mbLookup, itunes: never('itunes') }),
      createMemoryCache(),
    );

    await vi.waitFor(() => {
      expect(deezerLookup.calls).toBe(1);
      expect(mbLookup.calls).toBe(1);
    });

    deezerCall.resolve(answered(deezer(1974)));
    mbCall.resolve(answered(musicbrainz(1974)));
    expect((await pending).ok).toBe(true);
  });

  it('should return a confirmation as final and never ask a verify provider', async () => {
    const itunesLookup = never('itunes');

    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1974, 2001))),
        musicbrainz: fake('musicbrainz', answered(musicbrainz(1974))),
        itunes: itunesLookup,
      }),
      createMemoryCache(),
    );

    expect(outcome).toEqual({
      ok: true,
      result: {
        year: 1974,
        confidence: 'high',
        source: 'vote',
        agreedBy: ['deezer', 'musicbrainz'],
        cached: false,
        cleanedTitle: CLEANED.title,
        stripped: CLEANED.stripped,
        final: true,
      },
      sourceTtlsSeconds: [HIGH_CONFIDENCE_TTL_SECONDS, HIGH_CONFIDENCE_TTL_SECONDS],
      transient: false,
    });
    expect(itunesLookup.calls).toBe(0);
  });

  it('should return an unconfirmed resolve as provisional', async () => {
    // iTunes has not been asked, so the lone-answer order's pick may still be overturned.
    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1990, 2010))),
        musicbrainz: fake('musicbrainz', answered(musicbrainz(1974))),
        itunes: never('itunes'),
      }),
      createMemoryCache(),
    );

    // Not final, but nothing transient either: the ordinary hand-off to `verify`, which the
    // edge may hold for its short window.
    expect(outcome).toMatchObject({
      ok: true,
      result: { year: 1974, confidence: 'low', source: 'release-group', final: false },
      transient: false,
    });
    if (!outcome.ok) return;
    expect(outcome.result.agreedBy).toBeUndefined();
    expect(outcome.result.skipped).toBeUndefined();
  });

  it('should return the final answer with zero provider requests when everything is cached', async () => {
    // What lets a warm deck cost one call per card: `resolve` decides the final answer
    // alone, from one batched read, when every provider's answer is already there.
    const cache = createMemoryCache();
    await cache.setAnswer(providerAnswerKey('deezer', LOOKUP_INPUT), deezer(1990, 2010), 60);
    await cache.setAnswer(providerAnswerKey('itunes', LOOKUP_INPUT), itunes(1976), 60);
    const mbYear: YearResult = { year: 1974, confidence: 'low', source: 'recording' };
    await cache.set(MB_KEY, mbYear, 60);

    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: never('deezer'),
        musicbrainz: never('musicbrainz'),
        itunes: never('itunes'),
      }),
      cache,
    );

    // Nobody agrees; iTunes goes before a MusicBrainz `low` in the trust order.
    expect(outcome).toMatchObject({
      ok: true,
      result: { year: 1976, confidence: 'low', source: 'itunes', final: true, cached: true },
      sourceTtlsSeconds: [
        HIGH_CONFIDENCE_TTL_SECONDS,
        LOW_CONFIDENCE_TTL_SECONDS,
        HIGH_CONFIDENCE_TTL_SECONDS,
      ],
    });
  });

  it('should not call MusicBrainz at all on an mbyear hit', async () => {
    const cache = createMemoryCache();
    await cache.set(MB_KEY, { year: 1974, confidence: 'high', source: 'release-group' }, 60);
    const mbLookup = never('musicbrainz');

    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1974))),
        musicbrainz: mbLookup,
        itunes: never('itunes'),
      }),
      cache,
    );

    expect(outcome).toMatchObject({ ok: true, result: { year: 1974, final: true } });
    expect(mbLookup.calls).toBe(0);
  });
});

describe('runStage: verify', () => {
  it("should read resolve's answers from the cache and not ask Deezer or MusicBrainz again", async () => {
    // `verify` reads from Redis, never from the client. The MusicBrainz half is the REAL
    // provider, so the `mbyear:` entry `resolveYear()` wrote is what the batched read sees --
    // one store behind both cache views, end to end.
    const cache = createMemoryCache();
    const deezerLookup = fake('deezer', answered(deezer(1990, 2010)));
    const mb = realMusicBrainz(cache);
    const itunesLookup = fake('itunes', answered(itunes(1976)));
    const registry = registryOf({
      deezer: withAnswerCache(deezerLookup, cache),
      musicbrainz: mb,
      itunes: withAnswerCache(itunesLookup, cache),
    });

    const resolved = await runStage('resolve', TRACK, registry, cache);
    expect(resolved).toMatchObject({ ok: true, result: { final: false } });
    const fetchesAfterResolve = mb.fetches;

    const verified = await runStage('verify', TRACK, registry, cache);

    expect(deezerLookup.calls).toBe(1);
    expect(mb.fetches).toBe(fetchesAfterResolve);
    expect(itunesLookup.calls).toBe(1);
    expect(verified).toMatchObject({ ok: true, result: { final: true, cached: false } });
  });

  it('should return final whether or not iTunes agrees', async () => {
    const cache = createMemoryCache();
    await cache.setAnswer(providerAnswerKey('deezer', LOOKUP_INPUT), deezer(1990, 2010), 60);
    await cache.set(MB_KEY, { year: 1974, confidence: 'high', source: 'release-group' }, 60);
    const stores = { deezer: never('deezer'), musicbrainz: never('musicbrainz') };

    const agreeing = fake('itunes', answered(itunes(1974)));
    const confirmed = await runStage(
      'verify',
      TRACK,
      registryOf({ ...stores, itunes: agreeing }),
      cache,
    );
    expect(confirmed).toMatchObject({
      ok: true,
      result: {
        year: 1974,
        confidence: 'high',
        source: 'vote',
        agreedBy: ['musicbrainz', 'itunes'],
        final: true,
      },
    });
    expect(agreeing.calls).toBe(1);

    // Disagreeing: the trust order's single answer, a MusicBrainz `high`, final and `low`.
    const disagreeing = fake('itunes', answered(itunes(2001)));
    const kept = await runStage(
      'verify',
      TRACK,
      registryOf({ ...stores, itunes: disagreeing }),
      cache,
    );
    expect(kept).toMatchObject({
      ok: true,
      result: { year: 1974, confidence: 'low', source: 'release-group', final: true },
    });
    expect(disagreeing.calls).toBe(1);
  });

  it('should re-ask a resolve provider whose answer is not cached', async () => {
    // `vercel dev`, an expired entry, or a MusicBrainz that failed during `resolve`: the
    // stage the client treats as the last word must not be final over a provider nobody asked.
    const mbLookup = fake('musicbrainz', answered(musicbrainz(1974)));
    const outcome = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1990, 2010))),
        musicbrainz: mbLookup,
        itunes: fake('itunes', answered(itunes(2001))),
      }),
      createMemoryCache(),
    );

    expect(mbLookup.calls).toBe(1);
    expect(outcome).toMatchObject({ ok: true, result: { year: 1974, final: true } });
  });
});

describe('runStage: busy, failed and skipped providers', () => {
  it('should decide a resolve with an answer in hand when a provider is busy, and resume next call', async () => {
    // Deezer answered in the same parallel frontier MusicBrainz was busy in: a 429 would throw
    // that year away. The busy provider has no answer, so the stage is not settled -- not
    // final -- and it is transient, so the edge must not hold it. It is NOT `skipped`. The
    // body carries the wait the 429 would have, so the client's resolve lane still backs off.
    const cache = createMemoryCache();
    const deezerLookup = fake('deezer', answered(deezer(1990, 1990)));
    const mbLookup = fake('musicbrainz', [
      { kind: 'busy', retryAfterMs: 1_100 },
      answered(musicbrainz(1990)),
    ]);
    const registry = registryOf({
      deezer: withAnswerCache(deezerLookup, cache),
      musicbrainz: mbLookup,
      itunes: never('itunes'),
    });

    const first = await runStage('resolve', TRACK, registry, cache);
    expect(first).toMatchObject({
      ok: true,
      result: {
        year: 1990,
        confidence: 'low',
        source: 'deezer',
        final: false,
        retryAfterMs: 1_100,
      },
      transient: true,
    });
    if (first.ok) expect(first.result.skipped).toBeUndefined();

    // Deezer's answer was cached, so the next call asks only MusicBrainz.
    const second = await runStage('resolve', TRACK, registry, cache);
    expect(deezerLookup.calls).toBe(1);
    expect(mbLookup.calls).toBe(2);
    expect(second).toMatchObject({
      ok: true,
      result: { year: 1990, confidence: 'high', agreedBy: ['deezer', 'musicbrainz'], final: true },
      transient: false,
    });
    if (second.ok) expect(second.result).not.toHaveProperty('retryAfterMs');
  });

  it('should carry no retryAfterMs on a confirmation reached beside a busy provider', async () => {
    // iTunes' answer is already cached and agrees with Deezer's fresh one, so the card is
    // confirmed -- final -- although MusicBrainz was busy. A final card is done: nothing about
    // it should make the client wait, so the busy provider's back-off is not passed on.
    const cache = createMemoryCache();
    await cache.setAnswer(providerAnswerKey('itunes', LOOKUP_INPUT), itunes(1990), 60);

    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1990, 1990))),
        musicbrainz: fake('musicbrainz', { kind: 'busy', retryAfterMs: 1_100 }),
        itunes: never('itunes'),
      }),
      cache,
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { year: 1990, confidence: 'high', agreedBy: ['deezer', 'itunes'], final: true },
    });
    if (outcome.ok) expect(outcome.result).not.toHaveProperty('retryAfterMs');
  });

  it('should carry the longest wait when both providers of the frontier are busy', async () => {
    // The answer in hand is a cached iTunes NULL -- a year would make `nextFrontier` ask one
    // provider, a null still leaves "no usable answer, ask the next two" -- so Deezer and
    // MusicBrainz are both busy in the one parallel frontier. The 429 would have carried the
    // longer wait, so the 200 does too.
    const cache = createMemoryCache();
    await cache.setAnswer(providerAnswerKey('itunes', LOOKUP_INPUT), itunes(null), 60);
    const deezerLookup = fake('deezer', { kind: 'busy', retryAfterMs: 120 });
    const mbLookup = fake('musicbrainz', { kind: 'busy', retryAfterMs: 1_100 });

    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({ deezer: deezerLookup, musicbrainz: mbLookup, itunes: never('itunes') }),
      cache,
    );

    expect([deezerLookup.calls, mbLookup.calls]).toEqual([1, 1]);

    expect(outcome).toMatchObject({
      ok: true,
      result: { year: null, final: false, retryAfterMs: 1_100 },
      transient: true,
    });
  });

  it('should decide a resolve whose only answer in hand is a null, rather than 429', async () => {
    // A recorded choice, not an accident: "an answer in hand" includes `year: null`, as it
    // does everywhere in the vote. The client routes any non-final resolve to its verify
    // lane, and `verify` re-runs resolve's frontiers, so MusicBrainz is asked again there.
    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(null, null))),
        musicbrainz: fake('musicbrainz', { kind: 'busy', retryAfterMs: 1_100 }),
        itunes: never('itunes'),
      }),
      createMemoryCache(),
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { year: null, confidence: 'none', final: false, retryAfterMs: 1_100 },
      transient: true,
    });
  });

  it('should still be rate-limited when a resolve has nothing in hand', async () => {
    expect(
      await runStage(
        'resolve',
        TRACK,
        registryOf({
          deezer: fake('deezer', { kind: 'busy', retryAfterMs: 120 }),
          musicbrainz: fake('musicbrainz', { kind: 'busy', retryAfterMs: 1_100 }),
          itunes: never('itunes'),
        }),
        createMemoryCache(),
      ),
    ).toEqual({ ok: false, code: 'rate-limited', retryAfterMs: 1_100 });
  });

  it('should keep verify rate-limited on any busy provider, answers in hand or not', async () => {
    // The client counts a non-final verify 200 as a transient attempt and settles the card
    // after a handful, but sleeps on a 429 without counting: under contention the resolve
    // rule would settle cards for good at their provisional year.
    const busyItunes = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1990, 2010))),
        musicbrainz: fake('musicbrainz', answered(musicbrainz(1974))),
        itunes: fake('itunes', { kind: 'busy', retryAfterMs: 3_000 }),
      }),
      createMemoryCache(),
    );
    expect(busyItunes).toEqual({ ok: false, code: 'rate-limited', retryAfterMs: 3_000 });

    // The same holds inside resolve's frontier when it runs as part of a `verify` call.
    const busyMusicBrainz = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1990, 1990))),
        musicbrainz: fake('musicbrainz', { kind: 'busy', retryAfterMs: 1_100 }),
        itunes: never('itunes'),
      }),
      createMemoryCache(),
    );
    expect(busyMusicBrainz).toEqual({ ok: false, code: 'rate-limited', retryAfterMs: 1_100 });
  });

  it('should not make an answer final when a provider failed transiently', async () => {
    // A final null drops the card; an outage must not.
    const outcome = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(null, null))),
        musicbrainz: fake('musicbrainz', FAILED),
        itunes: fake('itunes', answered(itunes(null))),
      }),
      createMemoryCache(),
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { year: null, confidence: 'none', final: false, skipped: ['musicbrainz'] },
      transient: true,
    });
  });

  it('should still be final on a confirmation beside a failure', async () => {
    const outcome = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1974, 2001))),
        musicbrainz: fake('musicbrainz', FAILED),
        itunes: fake('itunes', answered(itunes(1974))),
      }),
      createMemoryCache(),
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { year: 1974, agreedBy: ['deezer', 'itunes'], final: true, skipped: ['musicbrainz'] },
    });
  });

  it('should return upstream-unavailable when every asked provider failed', async () => {
    expect(
      await runStage(
        'resolve',
        TRACK,
        registryOf({
          deezer: fake('deezer', FAILED),
          musicbrainz: fake('musicbrainz', FAILED),
          itunes: never('itunes'),
        }),
        createMemoryCache(),
      ),
    ).toEqual({ ok: false, code: 'upstream-unavailable' });
  });

  it('should map an adapter that throws, or answers as another provider, to a failure', async () => {
    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', () => Promise.reject(new Error('boom'))),
        musicbrainz: fake('musicbrainz', answered(itunes(1974))),
        itunes: never('itunes'),
      }),
      createMemoryCache(),
    );

    expect(outcome).toEqual({ ok: false, code: 'upstream-unavailable' });
  });

  it('should skip a not-configured provider, list it, and still reach a final without it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const outcome = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1990, 2001))),
        musicbrainz: fake('musicbrainz', notConfigured('MUSICBRAINZ_USER_AGENT')),
        itunes: fake('itunes', answered(itunes(1985))),
      }),
      createMemoryCache(),
      YEAR_PROVIDER_PLAN,
      { warned: new Set() },
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { year: 1985, source: 'itunes', final: true, skipped: ['musicbrainz'] },
    });
  });

  it('should return not-configured when every provider is not-configured', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const skipped = notConfigured('SOME_VARIABLE');

    const outcome = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', skipped),
        musicbrainz: fake('musicbrainz', skipped),
        itunes: fake('itunes', skipped),
      }),
      createMemoryCache(),
      YEAR_PROVIDER_PLAN,
      { warned: new Set() },
    );

    expect(outcome).toEqual({ ok: false, code: 'not-configured' });
  });

  it('should warn once per provider per cold start, naming the variable and never a value', async () => {
    resetSkipWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secret = 'super-secret-user-agent-value';
    // The adapter holds a secret in its closure; nothing it returns may carry it.
    const mbLookup = fake('musicbrainz', () => {
      void secret;
      return Promise.resolve(notConfigured('MUSICBRAINZ_USER_AGENT'));
    });
    const registry = registryOf({
      deezer: fake('deezer', answered(deezer(1990, 2001))),
      musicbrainz: mbLookup,
      itunes: fake('itunes', answered(itunes(1985))),
    });

    await runStage('resolve', TRACK, registry, createMemoryCache());
    await runStage('verify', TRACK, registry, createMemoryCache());

    expect(mbLookup.calls).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls.flat().join(' ');
    expect(line).toContain('musicbrainz');
    expect(line).toContain('MUSICBRAINZ_USER_AGENT');
    expect(line).not.toContain(secret);
    resetSkipWarnings();
  });
});

describe('runStage: a provider that refuses us', () => {
  // The developer's decision (2026-10-01): an iTunes 403/429 or a Deezer quota body is the
  // provider telling our shared egress IP to stop. It is a SKIP -- absent for finality, listed
  // in `skipped`, never re-asked within the call -- and neither `busy` (no 429, no back-off),
  // `failed` (no provisional answer, no 502) nor `not-configured` (no 500).

  it('should go final at once on a verify whose iTunes refuses, by the trust order', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = createMemoryCache();
    await cache.setAnswer(providerAnswerKey('deezer', LOOKUP_INPUT), deezer(1990, 2010), 60);
    await cache.set(MB_KEY, { year: 1974, confidence: 'high', source: 'release-group' }, 60);
    const itunesLookup = fake('itunes', refused('HTTP 403'));

    const outcome = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: never('deezer'),
        musicbrainz: never('musicbrainz'),
        itunes: itunesLookup,
      }),
      cache,
      YEAR_PROVIDER_PLAN,
      { warned: new Set() },
    );

    // The cached pair disagrees; with iTunes absent the trust order keeps MusicBrainz's `high`,
    // unconfirmed. `toEqual`, so a stray `retryAfterMs` or `agreedBy` fails it. `cached` is
    // false: the 403 was a request that reached Apple.
    expect(outcome).toEqual({
      ok: true,
      result: {
        year: 1974,
        confidence: 'low',
        source: 'release-group',
        cached: false,
        cleanedTitle: CLEANED.title,
        stripped: CLEANED.stripped,
        final: true,
        skipped: ['itunes'],
      },
      sourceTtlsSeconds: [HIGH_CONFIDENCE_TTL_SECONDS, HIGH_CONFIDENCE_TTL_SECONDS],
      transient: false,
    });
    expect(itunesLookup.calls).toBe(1);
  });

  it('should decide a resolve without a refusing Deezer, and never ask it twice', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deezerLookup = fake('deezer', refused('quota error code 4'));

    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: deezerLookup,
        musicbrainz: fake('musicbrainz', answered(musicbrainz(1974))),
        itunes: never('itunes'),
      }),
      createMemoryCache(),
      YEAR_PROVIDER_PLAN,
      { warned: new Set() },
    );

    // MusicBrainz's lone `high`, unconfirmed. NOT final, because iTunes -- the other stage --
    // is still unasked; and NOT transient, because nothing failed: the ordinary hand-off to
    // `verify`, with no back-off for the client to sleep.
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        year: 1974,
        confidence: 'low',
        source: 'release-group',
        final: false,
        skipped: ['deezer'],
      },
      transient: false,
    });
    if (outcome.ok) expect(outcome.result).not.toHaveProperty('retryAfterMs');
    expect(deezerLookup.calls).toBe(1);
  });

  it('should not re-ask a refused resolve provider in the later frontiers of a verify', async () => {
    // The verify call runs resolve's frontiers first. Deezer refuses in the first one; the
    // second round and the verify stage must not reach it again (`excluded`).
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deezerLookup = fake('deezer', refused('quota error code 4'));

    const outcome = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: deezerLookup,
        musicbrainz: fake('musicbrainz', answered(musicbrainz(1974))),
        itunes: fake('itunes', answered(itunes(1974))),
      }),
      createMemoryCache(),
      YEAR_PROVIDER_PLAN,
      { warned: new Set() },
    );

    expect(deezerLookup.calls).toBe(1);
    expect(outcome).toMatchObject({
      ok: true,
      result: {
        year: 1974,
        confidence: 'high',
        agreedBy: ['musicbrainz', 'itunes'],
        final: true,
        skipped: ['deezer'],
      },
      transient: false,
    });
  });

  it('should answer a final null, not the not-configured 500, when every provider is refused or unconfigured', async () => {
    // "Stop asking" with nobody left to ask and nothing failed: the finality rule as written
    // makes it a final null. The 500 is only for "nothing is configured" -- a refusing provider
    // is configured -- and the 502 only for a failure. The edge holds it ~60 s because a
    // provider is skipped (`api/_lib/year-endpoint.test.ts`), which is what lets it heal.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const expected = {
      ok: true,
      result: {
        year: null,
        confidence: 'none',
        cached: false,
        cleanedTitle: CLEANED.title,
        stripped: CLEANED.stripped,
        final: true,
        skipped: ['deezer', 'musicbrainz', 'itunes'],
      },
      sourceTtlsSeconds: [],
      transient: false,
    };

    // The shape the shipped registry can reach: MusicBrainz's own refusals are `failed`, so it
    // is skipped only when unconfigured.
    const mixed = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', refused('quota error code 4')),
        musicbrainz: fake('musicbrainz', notConfigured('MUSICBRAINZ_USER_AGENT')),
        itunes: fake('itunes', refused('HTTP 429')),
      }),
      createMemoryCache(),
      YEAR_PROVIDER_PLAN,
      { warned: new Set() },
    );
    expect(mixed).toEqual(expected);

    const allRefused = await runStage(
      'verify',
      TRACK,
      registryOf({
        deezer: fake('deezer', refused('HTTP 429')),
        musicbrainz: fake('musicbrainz', refused('HTTP 403')),
        itunes: fake('itunes', refused('HTTP 403')),
      }),
      createMemoryCache(),
      YEAR_PROVIDER_PLAN,
      { warned: new Set() },
    );
    expect(allRefused).toEqual(expected);
  });

  it('should warn once per provider and reason per cold start, naming the detail only', async () => {
    resetSkipWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = registryOf({
      deezer: fake('deezer', answered(deezer(1990, 2001))),
      musicbrainz: fake('musicbrainz', notConfigured('MUSICBRAINZ_USER_AGENT')),
      itunes: fake('itunes', refused('HTTP 403')),
    });

    await runStage('verify', TRACK, registry, createMemoryCache());
    await runStage('verify', TRACK, registry, createMemoryCache());

    // Two skips, two reasons, two lines -- once each across both calls.
    expect(warn).toHaveBeenCalledTimes(2);
    const lines = warn.mock.calls.map((args) => args.join(' '));
    expect(lines.filter((line) => line.includes('itunes'))).toHaveLength(1);
    expect(lines.find((line) => line.includes('itunes'))).toContain('HTTP 403');
    expect(lines.filter((line) => line.includes('MUSICBRAINZ_USER_AGENT'))).toHaveLength(1);
    resetSkipWarnings();
  });

  it('should warn about the same provider again for a different reason', async () => {
    // The keys are per provider AND reason: a provider already warned about as unconfigured is
    // not silenced when it later refuses, and the reverse.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const warned = new Set<string>();
    const answers = {
      deezer: fake('deezer', answered(deezer(1990, 2001))),
      itunes: fake('itunes', answered(itunes(1985))),
    };

    await runStage(
      'resolve',
      TRACK,
      registryOf({
        ...answers,
        musicbrainz: fake('musicbrainz', notConfigured('MUSICBRAINZ_USER_AGENT')),
      }),
      createMemoryCache(),
      YEAR_PROVIDER_PLAN,
      { warned },
    );
    await runStage(
      'resolve',
      TRACK,
      registryOf({ ...answers, musicbrainz: fake('musicbrainz', refused('HTTP 403')) }),
      createMemoryCache(),
      YEAR_PROVIDER_PLAN,
      { warned },
    );

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.flat().join(' ')).toContain('HTTP 403');
  });
});

describe('runStage: the response body', () => {
  it('should carry viaTitle only when the kept year is MusicBrainz via a rewrite', async () => {
    const viaRemix: ProviderAnswer = {
      provider: 'musicbrainz',
      year: 1999,
      confidence: 'low',
      source: 'recording',
      viaTitle: 'Song',
    };

    const kept = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(null, null))),
        musicbrainz: fake('musicbrainz', answered(viaRemix)),
        itunes: never('itunes'),
      }),
      createMemoryCache(),
    );
    expect(kept).toMatchObject({ ok: true, result: { year: 1999, viaTitle: 'Song' } });

    // Confirmed by another provider: the year is the vote's, so no rewrite marker.
    const voted = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(1999, 2003))),
        musicbrainz: fake('musicbrainz', answered(viaRemix)),
        itunes: never('itunes'),
      }),
      createMemoryCache(),
    );
    expect(voted).toMatchObject({ ok: true, result: { source: 'vote' } });
    if (voted.ok) expect(voted.result.viaTitle).toBeUndefined();
  });

  it('should report the TTL of every entry the answer was built from', async () => {
    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: fake('deezer', answered(deezer(null, null))),
        musicbrainz: fake('musicbrainz', answered(musicbrainz(1974, 'low'))),
        itunes: never('itunes'),
      }),
      createMemoryCache(),
    );

    expect(outcome).toMatchObject({
      ok: true,
      sourceTtlsSeconds: [NO_YEAR_TTL_SECONDS, LOW_CONFIDENCE_TTL_SECONDS],
    });
  });

  it('should follow the plan it is given rather than a hard-wired order', async () => {
    // A plan with only iTunes and MusicBrainz in `resolve`: the pair is asked together, and
    // Deezer -- not in the plan -- is never asked. iTunes comes FIRST, the reverse of the
    // shipped plan, so `agreedBy` following this plan rather than the shipped one is visible.
    const plan: ProviderPlan = [
      { provider: 'itunes', phase: 'precision', stage: 'resolve', finalWhenCertain: false },
      { provider: 'musicbrainz', phase: 'coverage', stage: 'resolve', finalWhenCertain: false },
    ];
    const outcome = await runStage(
      'resolve',
      TRACK,
      registryOf({
        deezer: never('deezer'),
        musicbrainz: fake('musicbrainz', answered(musicbrainz(1974))),
        itunes: fake('itunes', answered(itunes(1974))),
      }),
      createMemoryCache(),
      plan,
      { trust: ['musicbrainz:high', 'itunes', 'musicbrainz:low'] },
    );

    expect(outcome).toMatchObject({
      ok: true,
      result: { year: 1974, agreedBy: ['itunes', 'musicbrainz'], final: true },
    });
  });
});
