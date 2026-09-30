/**
 * The cross-layer test: captured payloads -> the real adapters -> `shared/__fixtures__/year-votes.ts`.
 *
 * It lives in `api/_lib/` because it is the one test that needs both halves: the Node-side
 * captures (`__fixtures__/deezer-payloads.ts`, `itunes-payloads.ts`) and the `shared/` vote
 * fixture the vote-engine suite replays. `shared/` may not import `api/`, so the join is made
 * from this side. Three things are pinned here:
 *
 * 1. each store adapter, over each of the 22 captures, still produces exactly that track's row
 *    in `year-votes.ts` -- so an adapter change that moves an answer fails HERE, loudly,
 *    instead of silently changing what the vote suite measures;
 * 2. the MusicBrainz column is what `YEAR_TIER_ORDER` / `pickBestRecording` compute from
 *    `year-candidates.ts` (the walk `runTiers` does in `resolve-year.ts`);
 * 3. the store-match MUTATION GUARD: for each verification rule, at least one CAPTURED row
 *    where dropping that rule changes the year. Same shape, and same reason, as the
 *    `artistMatchesExact` guard in `shared/year.test.ts` -- without it "every rule is
 *    load-bearing" would be a claim. Run over EVERY captured row (the Deezer captures carry a
 *    track body for all ten search rows, not only the three the adapter fetches), because the
 *    guard is about the rules, not about the bound.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  YEAR_FIXTURES,
  YEAR_LIMITATION_FIXTURES,
} from '../../shared/__fixtures__/year-candidates.js';
import { YEAR_VOTE_FIXTURES } from '../../shared/__fixtures__/year-votes.js';
import { primaryArtistGuess } from '../../shared/artists.js';
import { STORE_MATCH_RULES, earliestVerifiedRow } from '../../shared/store-match.js';
import type { DatedStoreRow, StoreMatchRule, StoreTarget } from '../../shared/store-match.js';
import type { ProviderAnswer, YearResult } from '../../shared/types.js';
import { YEAR_TIER_ORDER, cleanTrackTitle, pickBestRecording } from '../../shared/year.js';
import { DEEZER_CAPTURES } from './__fixtures__/deezer-payloads.js';
import { ITUNES_CAPTURES } from './__fixtures__/itunes-payloads.js';
import { createDeezerLookup, deezerSearchRows, deezerTrackUrl } from './deezer.js';
import { createItunesLookup, itunesRows } from './itunes.js';
import type { ProviderLookupInput } from './provider-lookup.js';
import type { RateLimitGate } from './rate-limit.js';
import type { StoreFetch } from './store-http.js';

const FIXTURES = [...YEAR_FIXTURES, ...YEAR_LIMITATION_FIXTURES];

function fixtureFor(key: string) {
  const fixture = FIXTURES.find((f) => f.key === key);
  if (!fixture) throw new Error(`no fixture ${key}`);
  return fixture;
}

function inputFor(key: string): ProviderLookupInput {
  const fixture = fixtureFor(key);
  return {
    rawTitle: fixture.title,
    cleaned: cleanTrackTitle(fixture.title),
    rawArtist: fixture.artist,
    primaryArtist: primaryArtistGuess(fixture.artist),
    durationMs: fixture.durationMs,
  };
}

function targetFor(key: string): StoreTarget {
  const input = inputFor(key);
  return {
    rawTitle: input.rawTitle,
    primaryArtist: input.primaryArtist,
    durationMs: input.durationMs,
  };
}

function servingBodies(bodies: ReadonlyMap<string, unknown>): StoreFetch {
  return async (url: string) => {
    if (!bodies.has(url)) throw new Error(`unexpected request ${url}`);
    return { ok: true, status: 200, json: async () => bodies.get(url) };
  };
}

const gate: RateLimitGate = {
  kind: 'instance',
  acquire: vi.fn(async () => ({ ok: true as const })),
};

/** The MusicBrainz answer the ladder gives for one fixture: `runTiers`, over the fixture. */
function musicBrainzAnswer(key: string): ProviderAnswer {
  const fixture = fixtureFor(key);
  let result: YearResult = { year: null, confidence: 'none', reason: 'no-candidates' };
  for (const tier of YEAR_TIER_ORDER) {
    result = pickBestRecording(fixture.candidates, {
      artist: fixture.artist,
      durationMs: fixture.durationMs,
      tier,
    });
    if (result.year !== null) break;
  }
  if (result.year === null) return { provider: 'musicbrainz', year: null, confidence: 'none' };
  return {
    provider: 'musicbrainz',
    year: result.year,
    confidence: result.confidence,
    source: result.source,
    ...(result.viaTitle !== undefined ? { viaTitle: result.viaTitle } : {}),
  };
}

/**
 * The day the Deezer and iTunes payloads were captured. The adapter's ISRC reading pivots on
 * the CURRENT year (`isrcYear()` in `shared/year-providers.ts`: a two-digit value at or below
 * next year's reads 20xx), so `sweetChild`'s `GBSMU2955085` reads 1929 today and would read
 * 2029 from 2028-01-01 -- and this suite would go red on a calendar date with no code change.
 */
const CAPTURE_DAY = new Date('2026-09-30T12:00:00Z');

describe('year-votes.ts against the captures', () => {
  // Freeze the clock at the capture day, rather than threading a `now` through
  // `createDeezerLookup`. The pinned rows describe what these bytes produced on that day, and
  // the pivot's own behaviour over time is already tested with an explicit `now` in
  // `shared/year-providers.test.ts`. A `now` dependency on the adapter would widen a
  // production signature for one test, where faking `Date` alone touches nothing else:
  // `toFake: ['Date']` leaves timers and microtasks real, so the async adapter runs as-is.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(CAPTURE_DAY);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('should cover exactly the 22 ground-truth tracks, in both captures', () => {
    const keys = FIXTURES.map((f) => f.key).sort();
    expect(YEAR_VOTE_FIXTURES.map((f) => f.key).sort()).toEqual(keys);
    expect(DEEZER_CAPTURES.map((c) => c.key).sort()).toEqual(keys);
    expect(ITUNES_CAPTURES.map((c) => c.key).sort()).toEqual(keys);
    expect(keys).toHaveLength(22);

    for (const vote of YEAR_VOTE_FIXTURES) {
      expect(vote.expectedYear, vote.key).toBe(fixtureFor(vote.key).expectedYear);
    }
  });

  it.each(YEAR_VOTE_FIXTURES.map((vote) => [vote.key, vote] as const))(
    '%s: the Deezer adapter over its capture equals the pinned row',
    async (key, vote) => {
      const capture = DEEZER_CAPTURES.find((c) => c.key === key)!;
      const bodies = new Map<string, unknown>([
        [capture.search.url, capture.search.body],
        ...capture.tracks.map((t) => [t.url, t.body] as [string, unknown]),
      ]);
      const outcome = await createDeezerLookup({ fetchImpl: servingBodies(bodies), gate }).lookup(
        inputFor(key),
      );

      expect(outcome).toMatchObject({ kind: 'answer', answer: vote.deezer, cached: false });
    },
  );

  it.each(YEAR_VOTE_FIXTURES.map((vote) => [vote.key, vote] as const))(
    '%s: the iTunes adapter over its capture equals the pinned row',
    async (key, vote) => {
      const capture = ITUNES_CAPTURES.find((c) => c.key === key)!;
      const bodies = new Map<string, unknown>([[capture.search.url, capture.search.body]]);
      const outcome = await createItunesLookup({ fetchImpl: servingBodies(bodies), gate }).lookup(
        inputFor(key),
      );

      expect(outcome).toEqual({
        kind: 'answer',
        answer: vote.itunes,
        cached: false,
        requestCount: 1,
      });
    },
  );

  it('should pin the MusicBrainz column as the tier ladder computes it', () => {
    for (const vote of YEAR_VOTE_FIXTURES) {
      expect(vote.musicbrainz, vote.key).toEqual(musicBrainzAnswer(vote.key));
    }
  });

  it('should spend 56 Deezer requests over the 22 captures (the track-fetch bound, measured)', async () => {
    // Recorded in deezer.ts's header as the reconciliation of spike §11.2's "2 per card".
    let total = 0;
    for (const capture of DEEZER_CAPTURES) {
      const bodies = new Map<string, unknown>([
        [capture.search.url, capture.search.body],
        ...capture.tracks.map((t) => [t.url, t.body] as [string, unknown]),
      ]);
      const outcome = await createDeezerLookup({ fetchImpl: servingBodies(bodies), gate }).lookup(
        inputFor(capture.key),
      );
      if (outcome.kind !== 'answer') throw new Error(`${capture.key}: ${outcome.kind}`);
      total += outcome.requestCount;
    }
    expect(total).toBe(56);
  });
});

// ===========================================================================
//  THE MUTATION GUARD
// ===========================================================================

type CapturedRows = { store: 'deezer' | 'itunes'; key: string; rows: DatedStoreRow[] };

/** Every captured row, dated: Deezer's search rows joined to their track bodies. */
function capturedRows(): CapturedRows[] {
  const out: CapturedRows[] = [];
  for (const capture of DEEZER_CAPTURES) {
    const bodies = new Map(capture.tracks.map((t) => [t.url, t.body]));
    const rows = deezerSearchRows(capture.search.body as Record<string, unknown>)!.map((row) => {
      const body = bodies.get(deezerTrackUrl(row.id)) as { release_date?: string } | undefined;
      return { ...row, date: body?.release_date ?? '' };
    });
    out.push({ store: 'deezer', key: capture.key, rows });
  }
  for (const capture of ITUNES_CAPTURES) {
    out.push({ store: 'itunes', key: capture.key, rows: itunesRows(capture.search.body)! });
  }
  return out;
}

/** The captures where dropping `rule` changes the earliest verified year. */
function bitesOf(rule: StoreMatchRule): string[] {
  const without = STORE_MATCH_RULES.filter((r) => r !== rule);
  return capturedRows()
    .filter(({ key, rows }) => {
      const target = targetFor(key);
      const withAll = earliestVerifiedRow(rows, target)?.year ?? null;
      const withoutRule = earliestVerifiedRow(rows, target, without)?.year ?? null;
      return withAll !== withoutRule;
    })
    .map(({ store, key }) => `${store}:${key}`);
}

describe('store-match mutation guard, over captured rows', () => {
  it.each(['title', 'artist', 'duration'] as const)(
    'should change a captured year when the %s rule is dropped',
    (rule) => {
      expect(bitesOf(rule).length, `no captured row depends on the ${rule} rule`).toBeGreaterThan(
        0,
      );
    },
  );

  it('should pin where each rule bites, so a re-capture that loses a bite is visible', () => {
    // Snapshot-style, but written out: which tracks each rule is the ONLY thing protecting.
    expect({
      title: bitesOf('title'),
      artist: bitesOf('artist'),
      duration: bitesOf('duration'),
    }).toMatchInlineSnapshot(`
      {
        "artist": [
          "deezer:layla",
          "deezer:underPressure",
          "deezer:heyJude",
          "itunes:layla",
          "itunes:creep",
        ],
        "duration": [
          "deezer:billieJean",
          "deezer:hotelCalifornia",
          "deezer:sweetChild",
          "deezer:freeBird",
          "deezer:smellsLikeTeenSpirit",
          "deezer:creep",
          "deezer:relax",
          "deezer:firestarter",
          "itunes:noWomanNoCry",
          "itunes:hallelujahCohen",
          "itunes:personalJesus",
        ],
        "title": [
          "itunes:noWomanNoCry",
        ],
      }
    `);
  });

  it('should have NO captured bite for the excluded rule, by construction', () => {
    // Stated rather than hidden: neither store has ever flagged a captured row (entity=song on
    // iTunes, tracks-only search on Deezer), so no captured year depends on the rule. Its only
    // proof of wiring is the synthetic case in shared/store-match.test.ts. If a re-capture
    // ever carries a flagged row, this fails -- and that row should replace the synthetic one.
    expect(bitesOf('excluded')).toEqual([]);
    expect(capturedRows().some(({ rows }) => rows.some((row) => row.excluded))).toBe(false);
  });
});
