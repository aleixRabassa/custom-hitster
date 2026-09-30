import { describe, expect, it, vi } from 'vitest';

import {
  NO_WOMAN_NO_CRY,
  OLVIDARNOS,
  OLVIDARNOS_QUERIES,
  emptyReleaseGroups,
  emptySearch,
  joinPhraseSearch,
  noWomanNoCryReleaseGroups,
  noWomanNoCrySearch,
  olvidarnosPhraseSearches,
  olvidarnosReleaseGroups,
  olvidarnosTokenisedSearch,
  undatedSearch,
} from './__fixtures__/musicbrainz-payloads.js';
import { SPENT_LOOKUP_MAX_WAIT_MS, fetchYearCandidates } from './musicbrainz.js';
import type { FetchLike, MusicBrainzDeps } from './musicbrainz.js';
import { MIN_REQUEST_INTERVAL_MS } from './rate-limit.js';
import type { RateLimitGate } from './rate-limit.js';
import { pickBestRecording } from '../../shared/year.js';

const USER_AGENT = 'custom-jitster/0.1.0 ( test@example.com )';

/**
 * The argument list of every `acquire()` call, in order. A rest parameter rather than a
 * named one, so `[]` (the gate's own default) and `[3500]` stay distinguishable -- a named
 * `maxWaitMs` would record `undefined` for both "no argument" and "explicitly undefined".
 */
type AcquireCalls = [maxWaitMs?: number][];

/** A gate that always admits, and counts how many permits were taken. */
function openGate(): RateLimitGate & { permits: number; calls: AcquireCalls } {
  const gate = {
    kind: 'instance' as const,
    permits: 0,
    calls: [] as AcquireCalls,
    acquire(...args: [maxWaitMs?: number]) {
      gate.permits += 1;
      gate.calls.push(args);
      return Promise.resolve({ ok: true as const });
    },
  };
  return gate;
}

/** A gate that admits the first `n` callers and then refuses. */
function gateAllowing(n: number): RateLimitGate & { calls: AcquireCalls } {
  let taken = 0;
  const calls: AcquireCalls = [];
  return {
    kind: 'redis',
    calls,
    acquire(...args: [maxWaitMs?: number]) {
      taken += 1;
      calls.push(args);
      return Promise.resolve(
        taken <= n ? { ok: true as const } : { ok: false as const, retryAfterMs: 1100 },
      );
    },
  };
}

/** The decoded Lucene `query` parameter of a request URL. */
function queryOf(url: string): string {
  return new URL(url).searchParams.get('query') ?? '';
}

/**
 * A fetch double that answers `recording` and `release-group` requests from the given
 * payloads and records every URL it was asked for.
 *
 * `recording` may also be a function of the decoded query text, which is how a test tells
 * the rungs of the query ladder apart: the phrase rungs and the tokenised rung all hit the
 * same endpoint, and only the query says which one is asking.
 */
function stubFetch(
  responses: { recording?: unknown; releaseGroup?: unknown },
  options: { status?: number; statuses?: number[] } = {},
): { fetch: FetchLike; urls: string[]; headers: Record<string, string>[] } {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  let call = 0;

  const fetch: FetchLike = (url, init) => {
    urls.push(url);
    headers.push(init.headers);

    const status = options.statuses?.[call] ?? options.status ?? 200;
    call += 1;

    const isReleaseGroup = url.includes('/release-group?');
    const body = isReleaseGroup
      ? responses.releaseGroup
      : typeof responses.recording === 'function'
        ? (responses.recording as (query: string) => unknown)(queryOf(url))
        : responses.recording;

    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body ?? {}),
    });
  };

  return { fetch, urls, headers };
}

function deps(fetchImpl: FetchLike, gate: RateLimitGate = openGate()): MusicBrainzDeps {
  // `sleep` is a no-op so the 503 retry does not really wait 1.2 seconds.
  return { fetchImpl, gate, userAgent: USER_AGENT, sleep: () => Promise.resolve() };
}

describe('fetchYearCandidates', () => {
  it('should build a quoted recording query from the cleaned title and artist', async () => {
    const { fetch, urls } = stubFetch({
      recording: noWomanNoCrySearch,
      releaseGroup: noWomanNoCryReleaseGroups,
    });

    await fetchYearCandidates(
      { title: 'No Woman No Cry', artist: 'Bob Marley & The Wailers', durationMs: 255_000 },
      deps(fetch),
    );

    const query = decodeURIComponent(new URL(urls[0] ?? '').searchParams.get('query') ?? '');
    expect(query).toContain('recording:"No Woman No Cry"');
    expect(query).toContain('artist:"Bob Marley & The Wailers"');
    // The `dur:` bound is not a nicety. It collapses the pool below the 100-result page
    // limit, which is what puts the original studio recording in the results at all --
    // "Stairway to Heaven" is 842 candidates unbounded and 31 bounded, and only resolves
    // correctly in the second case (docs/agent_findings.md 2026-08-04).
    expect(query).toContain('dur:[245000 TO 265000]');
    expect(urls[0]).toContain('limit=100');
  });

  it('should send the configured User-Agent', async () => {
    // MusicBrainz blocks anonymous traffic. This is also why year lookups must run
    // server-side at all: a browser cannot set this header.
    const { fetch, headers } = stubFetch({ recording: emptySearch });

    await fetchYearCandidates({ title: 'A Song', artist: 'A Band' }, deps(fetch));

    expect(headers[0]?.['User-Agent']).toBe(USER_AGENT);
  });

  it('should fail clearly when the User-Agent variable is unset', async () => {
    // Loud at the boundary rather than a confusing remote rejection (decision 17). No
    // request is made at all.
    const { fetch, urls } = stubFetch({ recording: emptySearch });

    const result = await fetchYearCandidates(
      { title: 'A Song', artist: 'A Band' },
      { ...deps(fetch), userAgent: '   ' },
    );

    expect(result).toEqual({ ok: false, code: 'not-configured' });
    expect(urls).toEqual([]);
  });

  it('should normalize a response into candidates with release-group and status fields', async () => {
    const { fetch } = stubFetch({
      recording: noWomanNoCrySearch,
      releaseGroup: noWomanNoCryReleaseGroups,
    });

    const result = await fetchYearCandidates(
      {
        title: NO_WOMAN_NO_CRY.title,
        artist: NO_WOMAN_NO_CRY.artist,
        durationMs: NO_WOMAN_NO_CRY.durationMs,
      },
      deps(fetch),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One candidate per (recording, release) pair: `status` belongs to the release and the
    // types belong to the release group, so flattening is what lets one predicate filter.
    expect(result.candidates.length).toBeGreaterThan(noWomanNoCrySearch.recordings.length);

    const withGroup = result.candidates.find((candidate) => candidate.releaseGroupId);
    expect(withGroup?.releaseGroupPrimaryType).toBe('Album');
    expect(withGroup?.releaseStatus).toBeDefined();
    expect(withGroup?.artistCredit).toBe('Bob Marley & The Wailers');
  });

  it('should attach release-group first-release-dates from the second request', async () => {
    // The whole point of request 2. Without it the strict pass has nothing to date, because
    // the inlined release date is the reissue date.
    const { fetch, urls } = stubFetch({
      recording: noWomanNoCrySearch,
      releaseGroup: noWomanNoCryReleaseGroups,
    });

    const result = await fetchYearCandidates(
      {
        title: NO_WOMAN_NO_CRY.title,
        artist: NO_WOMAN_NO_CRY.artist,
        durationMs: NO_WOMAN_NO_CRY.durationMs,
      },
      deps(fetch),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('/release-group?');
    expect(decodeURIComponent(urls[1] ?? '')).toContain('rgid:(');
    expect(result.requestCount).toBe(2);
    expect(
      result.candidates.some((candidate) => candidate.releaseGroupFirstReleaseDate !== undefined),
    ).toBe(true);
  });

  it('should ask about single and EP release groups, albums first', async () => {
    // Two assertions in one, because they are two halves of the same 2026-08-11 change.
    //
    // ELIGIBILITY: a Single release group must reach request 2, or the top scoring rung has
    // no date for it and a song released as a single before its album still reports the
    // album's year -- the bug this whole change exists to fix.
    //
    // ORDER: albums first, so `MAX_RELEASE_GROUPS` truncation stays non-regressive. Every
    // release group that survived the cap when only Albums were eligible must still survive
    // it now that singles compete for the same 50 slots.
    const { fetch, urls } = stubFetch({
      recording: {
        recordings: [
          {
            id: 'rec-1',
            title: 'A Song',
            'artist-credit': [{ name: 'A Band' }],
            releases: [
              {
                status: 'Official',
                date: '1992-09-21',
                'release-group': { id: 'rg-single', 'primary-type': 'Single' },
              },
              {
                status: 'Official',
                date: '1993-02-22',
                'release-group': { id: 'rg-album', 'primary-type': 'Album' },
              },
              {
                status: 'Official',
                date: '1994-01-01',
                'release-group': { id: 'rg-ep', 'primary-type': 'EP' },
              },
              // Excluded by secondary type, so it must not appear at all.
              {
                status: 'Official',
                date: '1991-01-01',
                'release-group': {
                  id: 'rg-live',
                  'primary-type': 'Album',
                  'secondary-types': ['Live'],
                },
              },
            ],
          },
        ],
      },
      releaseGroup: { 'release-groups': [] },
    });

    const result = await fetchYearCandidates({ title: 'A Song', artist: 'A Band' }, deps(fetch));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const query = decodeURIComponent(new URL(urls[1] ?? '').searchParams.get('query') ?? '');
    expect(query).toBe('rgid:(rg-album OR rg-ep OR rg-single)');
  });

  it('should resolve the fixture track to its known-correct year end to end', async () => {
    // Adapter and scorer together, over a real captured response. This is the test that
    // fails if MusicBrainz changes shape -- the pure scoring tests would keep passing.
    const { fetch } = stubFetch({
      recording: noWomanNoCrySearch,
      releaseGroup: noWomanNoCryReleaseGroups,
    });

    const result = await fetchYearCandidates(
      {
        title: NO_WOMAN_NO_CRY.title,
        artist: NO_WOMAN_NO_CRY.artist,
        durationMs: NO_WOMAN_NO_CRY.durationMs,
      },
      deps(fetch),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      pickBestRecording(result.candidates, {
        artist: NO_WOMAN_NO_CRY.artist,
        durationMs: NO_WOMAN_NO_CRY.durationMs,
        tier: 'official-release',
      }),
    ).toEqual({ year: NO_WOMAN_NO_CRY.expectedYear, confidence: 'high', source: 'release-group' });
  });

  it('should rebuild an artist credit using joinphrase', async () => {
    // A fixed ", " separator would turn "Queen & David Bowie" into "Queen, David Bowie" and
    // stop it matching the string Spotify supplies.
    const { fetch } = stubFetch({ recording: joinPhraseSearch });

    const result = await fetchYearCandidates(
      { title: 'Under Pressure', artist: 'Queen' },
      deps(fetch),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.artistCredit).toBe('Queen & David Bowie');
  });

  it('should skip the release-group request when nothing is strict-eligible', async () => {
    // A track heading for the relaxed tier must not spend a request on the global 1 req/s
    // budget for an enrichment nothing will read (decision 21).
    const gate = openGate();
    const { fetch, urls } = stubFetch({
      recording: undatedSearch,
      releaseGroup: emptyReleaseGroups,
    });

    const result = await fetchYearCandidates(
      { title: 'A Song', artist: 'A Band' },
      deps(fetch, gate),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The one eligible release group here has no date, so the request IS made -- what must
    // not happen is a candidate coming back dated.
    expect(
      result.candidates.every((candidate) => candidate.releaseGroupFirstReleaseDate === undefined),
    ).toBe(true);
    expect(urls.length).toBeLessThanOrEqual(2);
  });

  it('should retry once on a 503 and succeed on the retry', async () => {
    // 503 is how MusicBrainz says "too fast" -- one was observed in ~40 paced requests on
    // 2026-08-04, so this is a measured need, not defensive coding.
    const { fetch, urls } = stubFetch({ recording: joinPhraseSearch }, { statuses: [503, 200] });

    const result = await fetchYearCandidates(
      { title: 'Under Pressure', artist: 'Queen' },
      deps(fetch),
    );

    expect(result.ok).toBe(true);
    expect(urls).toHaveLength(2);
  });

  it('should not retry a 400 or 404', async () => {
    for (const status of [400, 404]) {
      const { fetch, urls } = stubFetch({ recording: emptySearch }, { status });

      const result = await fetchYearCandidates({ title: 'A Song', artist: 'A Band' }, deps(fetch));

      expect(result).toEqual({ ok: false, code: 'upstream-unavailable' });
      // One attempt only: these are answers, not congestion.
      expect(urls).toHaveLength(1);
    }
  });

  it('should retry with the primary-artist guess when the full artist string returns zero results', async () => {
    // The ordering that makes `primaryArtistGuess()`'s known lossiness harmless.
    const { fetch, urls } = stubFetch({ recording: emptySearch });

    await fetchYearCandidates(
      { title: 'September', artist: 'Earth, Wind & Fire feat. Someone' },
      deps(fetch),
    );

    const queries = urls.map((url) =>
      decodeURIComponent(new URL(url).searchParams.get('query') ?? ''),
    );

    // The FULL string is tried first -- which is why "Earth, Wind & Fire" never gets
    // truncated to "Earth" on any track that MusicBrainz actually knows.
    expect(queries[0]).toContain('artist:"Earth, Wind & Fire feat. Someone"');
    expect(queries.at(-1)).toContain('artist:"Earth"');
  });

  it('should not retry with the guess when the full string returned candidates', async () => {
    // The normal path costs ONE search, not two, against a budget that is global across all
    // users (decision 21).
    const { fetch, urls } = stubFetch({
      recording: noWomanNoCrySearch,
      releaseGroup: noWomanNoCryReleaseGroups,
    });

    await fetchYearCandidates(
      {
        title: NO_WOMAN_NO_CRY.title,
        artist: NO_WOMAN_NO_CRY.artist,
        durationMs: NO_WOMAN_NO_CRY.durationMs,
      },
      deps(fetch),
    );

    const searches = urls.filter((url) => url.includes('/recording?'));
    expect(searches).toHaveLength(1);
  });

  it('should return a typed error rather than throwing when fetch rejects', async () => {
    const rejecting: FetchLike = () => Promise.reject(new Error('socket hang up'));

    await expect(
      fetchYearCandidates({ title: 'A Song', artist: 'A Band' }, deps(rejecting)),
    ).resolves.toEqual({ ok: false, code: 'upstream-unavailable' });
  });

  it('should return unexpected-payload when a 200 body is not JSON', async () => {
    // Kept distinct from `upstream-unavailable`: this one is not transient, it means the
    // endpoint changed shape and someone has to look at it.
    const badJson: FetchLike = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) });

    await expect(
      fetchYearCandidates({ title: 'A Song', artist: 'A Band' }, deps(badJson)),
    ).resolves.toEqual({ ok: false, code: 'unexpected-payload' });
  });

  it('should report rate-limited when no permit is available for the first request', async () => {
    const { fetch, urls } = stubFetch({ recording: emptySearch });
    const gate = gateAllowing(0);

    const result = await fetchYearCandidates(
      { title: 'A Song', artist: 'A Band' },
      deps(fetch, gate),
    );

    expect(result).toEqual({ ok: false, code: 'rate-limited', retryAfterMs: 1100 });
    expect(urls).toEqual([]);
    // Nothing spent yet, so the gate's OWN default wait: `acquire()` with no argument.
    expect(gate.calls).toEqual([[]]);
  });
});

// ===========================================================================
//  P6: A FAILED RELEASE-GROUP REQUEST FAILS THE LOOKUP
//
//  These replace a test that asserted the opposite -- that a busy gate before
//  request 2 DEGRADED to un-enriched candidates. That degradation drew a `low`
//  year from inlined reissue dates on a card that was one retry away from
//  `high`, and cached it for seven days (spike §8 P6).
// ===========================================================================

const NWNC_INPUT = {
  title: NO_WOMAN_NO_CRY.title,
  artist: NO_WOMAN_NO_CRY.artist,
  durationMs: NO_WOMAN_NO_CRY.durationMs,
};

describe('fetchYearCandidates release-group failures', () => {
  it('should return upstream-unavailable when the release-group request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 500 is not retried, so this is exactly two requests: the recording search that
      // succeeded, and the release-group request that did not.
      const { fetch, urls } = stubFetch(
        { recording: noWomanNoCrySearch, releaseGroup: noWomanNoCryReleaseGroups },
        { statuses: [200, 500] },
      );

      const result = await fetchYearCandidates(NWNC_INPUT, deps(fetch));

      expect(result).toEqual({ ok: false, code: 'upstream-unavailable' });
      expect(urls).toHaveLength(2);
      expect(urls[1]).toContain('/release-group?');
    } finally {
      warn.mockRestore();
    }
  });

  it('should spend the single 503 retry on the release-group request before failing', async () => {
    // `getJson`'s one retry is unchanged, and it applies to request 2 like any other.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fetch, urls } = stubFetch(
        { recording: noWomanNoCrySearch, releaseGroup: noWomanNoCryReleaseGroups },
        { statuses: [200, 503, 503] },
      );

      const result = await fetchYearCandidates(NWNC_INPUT, deps(fetch));

      expect(result).toEqual({ ok: false, code: 'upstream-unavailable' });
      expect(urls).toHaveLength(3);
      expect(urls.slice(1).every((url) => url.includes('/release-group?'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('should return unexpected-payload when the release-group 200 is not JSON', async () => {
    // Passed through, not flattened into the transient code: a 200 that is not JSON means
    // the endpoint changed shape, and retrying will not fix that.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fetch: FetchLike = (url) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: url.includes('/release-group?')
            ? () => Promise.reject(new Error('bad json'))
            : () => Promise.resolve(noWomanNoCrySearch),
        });

      await expect(fetchYearCandidates(NWNC_INPUT, deps(fetch))).resolves.toEqual({
        ok: false,
        code: 'unexpected-payload',
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('should return upstream-unavailable when the gate is busy before the release-group request', async () => {
    // NOT `rate-limited`, and with no `retryAfterMs` -- `toEqual` fails on a stray one. The
    // client treats a 429 as free, so it would spend request 1 again, in a loop, for as long
    // as the gate stayed busy.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fetch, urls } = stubFetch({
        recording: noWomanNoCrySearch,
        releaseGroup: noWomanNoCryReleaseGroups,
      });

      const gate = gateAllowing(1);
      const result = await fetchYearCandidates(NWNC_INPUT, deps(fetch, gate));

      expect(result).toEqual({ ok: false, code: 'upstream-unavailable' });
      expect(urls).toHaveLength(1);
      // Refused only after the longer wait a spent lookup is given.
      expect(gate.calls).toEqual([[], [SPENT_LOOKUP_MAX_WAIT_MS]]);
    } finally {
      warn.mockRestore();
    }
  });
});

// ===========================================================================
//  A SPENT LOOKUP WAITS LONGER, AND NEVER ANSWERS A FREE 429
//
//  A busy gate before rung 2, 3 or 4 used to return `rate-limited`, which the
//  client re-asks for free -- from rung 1, re-spending every rung that had
//  already come back empty. Only the lookup's FIRST permit may still be
//  refused as `rate-limited`; every later one waits `SPENT_LOOKUP_MAX_WAIT_MS`
//  and is refused as `upstream-unavailable`, which the client counts.
// ===========================================================================

describe('fetchYearCandidates permits after a spent request', () => {
  it('should tolerate about three lookups queued ahead on the 1.1 s gate', () => {
    // The constant's derivation, pinned: three permits' spacing fits inside the wait.
    expect(SPENT_LOOKUP_MAX_WAIT_MS).toBe(3_500);
    expect(SPENT_LOOKUP_MAX_WAIT_MS).toBeGreaterThan(3 * MIN_REQUEST_INTERVAL_MS);
  });

  it('should return upstream-unavailable when the gate is busy before the second recording rung', async () => {
    // Rung 1 was spent and came back empty. `toEqual` fails on a stray `retryAfterMs`.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const gate = gateAllowing(1);
      const { fetch, urls } = stubFetch({ recording: emptySearch });

      const result = await fetchYearCandidates(
        { title: 'A Song Title', artist: 'A Band', durationMs: 200_000 },
        deps(fetch, gate),
      );

      expect(result).toEqual({ ok: false, code: 'upstream-unavailable' });
      // Exactly one recording request: the refused rung 2 sent nothing.
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('/recording?');
      // And it was refused only after the LONGER wait.
      expect(gate.calls).toEqual([[], [SPENT_LOOKUP_MAX_WAIT_MS]]);
    } finally {
      warn.mockRestore();
    }
  });

  it('should take the first permit with the gate default and every later one with the longer wait', async () => {
    // The whole ladder misses: four recording rungs, no release-group request.
    const missing = openGate();
    await fetchYearCandidates(
      { title: 'A Song Title', artist: 'A Band, Someone Else', durationMs: 200_000 },
      deps(stubFetch({ recording: emptySearch }).fetch, missing),
    );
    expect(missing.calls).toEqual([
      [],
      [SPENT_LOOKUP_MAX_WAIT_MS],
      [SPENT_LOOKUP_MAX_WAIT_MS],
      [SPENT_LOOKUP_MAX_WAIT_MS],
    ]);

    // Rung 1 misses, rung 2 hits, then the release-group request -- which waits longer too.
    const hitOnRungTwo = openGate();
    const { fetch, urls } = stubFetch({
      recording: (query: string) => (query.includes('dur:[') ? emptySearch : noWomanNoCrySearch),
      releaseGroup: noWomanNoCryReleaseGroups,
    });
    const result = await fetchYearCandidates(NWNC_INPUT, deps(fetch, hitOnRungTwo));
    expect(result.ok && result.matchedAttempt).toBe('unbounded');
    expect(urls.at(-1)).toContain('/release-group?');
    expect(hitOnRungTwo.calls).toEqual([
      [],
      [SPENT_LOOKUP_MAX_WAIT_MS],
      [SPENT_LOOKUP_MAX_WAIT_MS],
    ]);

    // A first-rung hit: the release-group request is still a spent lookup's second permit.
    const hitFirst = openGate();
    await fetchYearCandidates(
      NWNC_INPUT,
      deps(
        stubFetch({ recording: noWomanNoCrySearch, releaseGroup: noWomanNoCryReleaseGroups }).fetch,
        hitFirst,
      ),
    );
    expect(hitFirst.calls).toEqual([[], [SPENT_LOOKUP_MAX_WAIT_MS]]);
  });

  it('should treat the first rung as spent when the caller says requests were already spent', async () => {
    // The remix fallback's case: the primary ladder has already been spent, so a free 429
    // here would re-run it. Longer wait, then `upstream-unavailable`, never `rate-limited`.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const gate = gateAllowing(0);
      const { fetch, urls } = stubFetch({ recording: emptySearch });

      const result = await fetchYearCandidates(
        { title: 'A Song', artist: 'A Band' },
        deps(fetch, gate),
        { requestsAlreadySpent: true },
      );

      expect(result).toEqual({ ok: false, code: 'upstream-unavailable' });
      expect(urls).toEqual([]);
      expect(gate.calls).toEqual([[SPENT_LOOKUP_MAX_WAIT_MS]]);
    } finally {
      warn.mockRestore();
    }
  });
});

// ===========================================================================
//  THE TOKENISED RUNG
// ===========================================================================

/** Every decoded query a double was asked, in order. */
function queriesOf(urls: readonly string[]): string[] {
  return urls.map(queryOf);
}

const isTokenised = (query: string): boolean => query.startsWith('recording:(');

describe('fetchYearCandidates tokenised rung', () => {
  it('should append the tokenised attempt last and only once', async () => {
    // Every rung misses, so the whole ladder runs: the two full-artist phrase rungs, the
    // artist-guess phrase rung, and then -- once, last -- the tokenised one.
    const { fetch, urls } = stubFetch({ recording: emptySearch });

    const result = await fetchYearCandidates(
      { title: 'A Song Title', artist: 'A Band, Someone Else', durationMs: 200_000 },
      deps(fetch),
    );

    const queries = queriesOf(urls);
    expect(queries).toHaveLength(4);
    expect(queries.filter(isTokenised)).toHaveLength(1);
    expect(isTokenised(queries.at(-1) ?? '')).toBe(true);
    expect(queries.slice(0, -1).every((query) => query.startsWith('recording:"'))).toBe(true);
    // Nothing matched, so nothing is reported as having matched.
    expect(result).toEqual({ ok: true, candidates: [], requestCount: 4 });
  });

  it('should quote every token and skip the rung under two tokens', async () => {
    // Quoted, so a word that is a Lucene keyword or carries an operator is a literal; the
    // stray `)` has no letter or digit and is dropped rather than quoted into an empty phrase.
    // No duration here, so the rung carries no `dur:` bound.
    const quoted = stubFetch({ recording: emptySearch });
    await fetchYearCandidates(
      { title: 'Love AND Hate / Why? )', artist: 'A Band' },
      deps(quoted.fetch),
    );
    expect(queriesOf(quoted.urls).at(-1)).toBe(
      'recording:("Love" AND "AND" AND "Hate" AND "Why?") AND artist:"A Band"',
    );

    // One word, and one word left after the punctuation-only token is dropped: the rung
    // would be a guaranteed repeat of the unbounded phrase rung, so it is not built.
    for (const title of ['September', 'Hello )']) {
      const { fetch, urls } = stubFetch({ recording: emptySearch });
      await fetchYearCandidates({ title, artist: 'A Band' }, deps(fetch));
      expect(queriesOf(urls).some(isTokenised)).toBe(false);
    }
  });

  it('should not issue the tokenised request when an earlier rung returned recordings', async () => {
    // The rung loop stops at the first rung with results, so a first-try card still costs
    // exactly two requests: the recording search and the release-group enrichment.
    const { fetch, urls } = stubFetch({
      recording: noWomanNoCrySearch,
      releaseGroup: noWomanNoCryReleaseGroups,
    });

    const result = await fetchYearCandidates(NWNC_INPUT, deps(fetch));

    expect(urls).toHaveLength(2);
    expect(queriesOf(urls).some(isTokenised)).toBe(false);
    expect(result.ok && result.requestCount).toBe(2);
    expect(result.ok && result.matchedAttempt).toBe('duration-bounded');
  });

  it('should find the captured tokenised track on the last rung, with the captured requests', async () => {
    // Over the live capture. The exact query list is the request shape the fixture was
    // captured WITH, so a change to any rung's query text fails here rather than silently
    // leaving the fixture describing requests the adapter no longer makes.
    const { fetch, urls } = stubFetch({
      recording: (query: string) => {
        const index = OLVIDARNOS_QUERIES.indexOf(query);
        return index === 3 ? olvidarnosTokenisedSearch : olvidarnosPhraseSearches[index];
      },
      releaseGroup: olvidarnosReleaseGroups,
    });

    const result = await fetchYearCandidates(
      // The cleaned title, as the adapter receives it: the colon of `:)` is neutralised.
      {
        title: "Olvidarnos De To' )",
        artist: OLVIDARNOS.artist,
        durationMs: OLVIDARNOS.durationMs,
      },
      deps(fetch),
    );

    expect(queriesOf(urls)).toEqual(OLVIDARNOS_QUERIES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.matchedAttempt).toBe('tokenised');
    expect(result.requestCount).toBe(5);
    // The adapter reports; it does not score. The pool itself is good enough for `high` --
    // capping it is `api/_lib/resolve-year.ts`'s decision, not this module's.
    expect(
      pickBestRecording(result.candidates, {
        artist: OLVIDARNOS.artist,
        durationMs: OLVIDARNOS.durationMs,
        tier: 'official-release',
      }),
    ).toEqual({ year: OLVIDARNOS.expectedYear, confidence: 'high', source: 'release-group' });
  });
});
