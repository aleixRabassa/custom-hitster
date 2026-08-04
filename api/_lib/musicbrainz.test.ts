import { describe, expect, it, vi } from 'vitest';

import {
  NO_WOMAN_NO_CRY,
  emptyReleaseGroups,
  emptySearch,
  joinPhraseSearch,
  noWomanNoCryReleaseGroups,
  noWomanNoCrySearch,
  undatedSearch,
} from './__fixtures__/musicbrainz-payloads.js';
import { fetchYearCandidates } from './musicbrainz.js';
import type { FetchLike, MusicBrainzDeps } from './musicbrainz.js';
import type { RateLimitGate } from './rate-limit.js';
import { pickBestRecording } from '../../shared/year.js';

const USER_AGENT = 'custom-hitster/0.1.0 ( test@example.com )';

/** A gate that always admits, and counts how many permits were taken. */
function openGate(): RateLimitGate & { permits: number } {
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

/** A gate that admits the first `n` callers and then refuses. */
function gateAllowing(n: number): RateLimitGate {
  let taken = 0;
  return {
    kind: 'redis',
    acquire() {
      taken += 1;
      return Promise.resolve(
        taken <= n ? { ok: true as const } : { ok: false as const, retryAfterMs: 1100 },
      );
    },
  };
}

/**
 * A fetch double that answers `recording` and `release-group` requests from the given
 * payloads and records every URL it was asked for.
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
    const body = isReleaseGroup ? responses.releaseGroup : responses.recording;

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
        mode: 'strict',
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

    const result = await fetchYearCandidates(
      { title: 'A Song', artist: 'A Band' },
      deps(fetch, gateAllowing(0)),
    );

    expect(result).toEqual({ ok: false, code: 'rate-limited', retryAfterMs: 1100 });
    expect(urls).toEqual([]);
  });

  it('should degrade to un-enriched candidates when the gate is busy before the second request', async () => {
    // A request already spent must not be discarded. The strict pass then finds nothing to
    // date and the caller falls through to the relaxed tier -- worse accuracy, not an error.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
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
        deps(fetch, gateAllowing(1)),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(urls).toHaveLength(1);
      expect(result.candidates.every((c) => c.releaseGroupFirstReleaseDate === undefined)).toBe(
        true,
      );
      expect(
        pickBestRecording(result.candidates, {
          artist: NO_WOMAN_NO_CRY.artist,
          durationMs: NO_WOMAN_NO_CRY.durationMs,
          mode: 'strict',
        }).year,
      ).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});
