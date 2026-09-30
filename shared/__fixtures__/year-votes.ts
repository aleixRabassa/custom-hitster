/**
 * One answer per provider for each of the 22 ground-truth tracks: the vote's input, pinned.
 *
 * The 21 `YEAR_FIXTURES` and Personal Jesus from `year-candidates.ts`, keyed by the same
 * `key`, each with its ground truth (`expectedYear`, copied from there) and what each provider
 * answers about it. This is what `shared/year-providers.test.ts` replays the vote over -- the
 * "21/22 exact" row and the confirmed-at-step counts -- without HTTP, and without `shared/`
 * importing from `api/`.
 *
 * WHERE EACH COLUMN COMES FROM, AND WHAT KEEPS IT HONEST:
 *
 * - `deezer` and `itunes`: the REAL adapters (`api/_lib/deezer.ts`, `api/_lib/itunes.ts`) run
 *   over the payloads captured live on 2026-09-30 (`api/_lib/__fixtures__/deezer-payloads.ts`
 *   and `itunes-payloads.ts`, whose headers carry the provenance and every drift against the
 *   spike). Pinned here as literals, and `api/_lib/year-votes.test.ts` re-runs both adapters
 *   over those payloads and asserts they still equal these rows -- so an adapter change that
 *   moves an answer fails a test instead of silently changing the vote's input.
 * - `musicbrainz`: NOT captured for this file. It is computed from `year-candidates.ts`'s
 *   candidates through `YEAR_TIER_ORDER` and `pickBestRecording` (the walk `runTiers` does in
 *   `api/_lib/resolve-year.ts`), and pinned; the same test recomputes it and asserts equality.
 *   `viaTitle` is absent on every row because the fixture titles are already clean, so no
 *   remix fallback runs. All 22 are `high`, including Personal Jesus at its known-wrong 1990
 *   (`YEAR_LIMITATION_FIXTURES` explains why).
 *
 * Differences from the spike's own run over the same 22 (§4.3), all explained in the
 * payload headers: `sweetChild`'s Deezer answer is now 2016 / ISRC 1929 (it was 1988 / 1987 --
 * the catalogue moved, and a `GBSMU` bootleg ISRC reads as 1929 under `isrcYear()`'s pivot),
 * and `bohemianRhapsody`'s Deezer ISRC year is now 2003 (it was 2001). Every iTunes answer is
 * unchanged. `sweetChild`'s `isrcYear: 1929` is what `isrcYear()` read on the capture day:
 * it pivots on next year's two digits, so from 2028-01-01 the same `GBSMU2955085` would read
 * 2029. The literal here cannot move, and the cross-layer test that recomputes it freezes
 * `Date` at 2026-09-30, so neither goes red on a calendar date. The 1929 masks a correct 1987
 * code on the same track, which is why `sweetChild` confirms at `verify` below and did at
 * `resolve` in the spike; it is not floored away, for the reason `isrcYear()` records.
 *
 * Re-capturing is the only legitimate way to change a store row; editing one by hand to make
 * the vote come out differently is exactly the drift the cross-layer test exists to refuse.
 */

import type { ProviderAnswer } from '../types';

type AnswerOf<P extends ProviderAnswer['provider']> = Extract<ProviderAnswer, { provider: P }>;

export interface YearVoteFixture {
  /** The `year-candidates.ts` key. */
  key: string;
  /** Ground truth, from `year-candidates.ts`. Not what any provider says. */
  expectedYear: number;
  deezer: AnswerOf<'deezer'>;
  musicbrainz: AnswerOf<'musicbrainz'>;
  itunes: AnswerOf<'itunes'>;
}

/** The three answers in the shape the vote consumes. Order carries no meaning. */
export function answersOf(fixture: YearVoteFixture): ProviderAnswer[] {
  return [fixture.deezer, fixture.musicbrainz, fixture.itunes];
}

export const YEAR_VOTE_FIXTURES: readonly YearVoteFixture[] = [
  {
    key: 'billieJean',
    expectedYear: 1982,
    deezer: { provider: 'deezer', year: 2009, isrcYear: 1999 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1982,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1982 },
  },
  {
    key: 'hotelCalifornia',
    expectedYear: 1976,
    deezer: { provider: 'deezer', year: 2017, isrcYear: 2013 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1976,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1976 },
  },
  {
    key: 'sweetChild',
    expectedYear: 1987,
    deezer: { provider: 'deezer', year: 2016, isrcYear: 1929 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1987,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1987 },
  },
  {
    key: 'noWomanNoCry',
    expectedYear: 1974,
    deezer: { provider: 'deezer', year: 1997, isrcYear: 1997 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1974,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: null },
  },
  {
    key: 'wishYouWereHere',
    expectedYear: 1975,
    deezer: { provider: 'deezer', year: 1975, isrcYear: 2011 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1975,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1975 },
  },
  {
    key: 'stairwayToHeaven',
    expectedYear: 1971,
    deezer: { provider: 'deezer', year: 1971, isrcYear: 2013 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1971,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1971 },
  },
  {
    key: 'bohemianRhapsody',
    expectedYear: 1975,
    deezer: { provider: 'deezer', year: 1975, isrcYear: 2003 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1975,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1975 },
  },
  {
    key: 'hallelujahBuckley',
    expectedYear: 1994,
    deezer: { provider: 'deezer', year: 1994, isrcYear: 1994 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1994,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1994 },
  },
  {
    key: 'hallelujahCohen',
    expectedYear: 1984,
    deezer: { provider: 'deezer', year: 2002, isrcYear: 2000 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1984,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1984 },
  },
  {
    key: 'freeBird',
    expectedYear: 1973,
    deezer: { provider: 'deezer', year: 2001, isrcYear: 1973 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1973,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1973 },
  },
  {
    key: 'likeARollingStone',
    expectedYear: 1965,
    deezer: { provider: 'deezer', year: 1965, isrcYear: 1999 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1965,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1965 },
  },
  {
    key: 'layla',
    expectedYear: 1970,
    deezer: { provider: 'deezer', year: null, isrcYear: null },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1970,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: null },
  },
  {
    key: 'allAlongTheWatchtower',
    expectedYear: 1968,
    deezer: { provider: 'deezer', year: 2010, isrcYear: 2009 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1968,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1968 },
  },
  {
    key: 'smellsLikeTeenSpirit',
    expectedYear: 1991,
    deezer: { provider: 'deezer', year: 2011, isrcYear: 1999 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1991,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1991 },
  },
  {
    key: 'creep',
    expectedYear: 1992,
    deezer: { provider: 'deezer', year: 1993, isrcYear: 1992 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1992,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: null },
  },
  {
    key: 'relax',
    expectedYear: 1983,
    deezer: { provider: 'deezer', year: 2018, isrcYear: 2001 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1983,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1983 },
  },
  {
    key: 'underPressure',
    expectedYear: 1981,
    deezer: { provider: 'deezer', year: null, isrcYear: null },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1981,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1981 },
  },
  {
    key: 'firestarter',
    expectedYear: 1996,
    deezer: { provider: 'deezer', year: 1996, isrcYear: 1997 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1996,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1996 },
  },
  {
    key: 'mrBrightside',
    expectedYear: 2003,
    deezer: { provider: 'deezer', year: 2007, isrcYear: 2004 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 2003,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 2003 },
  },
  {
    key: 'rollingInTheDeep',
    expectedYear: 2010,
    deezer: { provider: 'deezer', year: 2011, isrcYear: 2010 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 2010,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 2010 },
  },
  {
    key: 'heyJude',
    expectedYear: 1968,
    deezer: { provider: 'deezer', year: 2015, isrcYear: 2009 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1968,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1968 },
  },
  {
    key: 'personalJesus',
    expectedYear: 1989,
    deezer: { provider: 'deezer', year: 1990, isrcYear: 2006 },
    musicbrainz: {
      provider: 'musicbrainz',
      year: 1990,
      confidence: 'high',
      source: 'release-group',
    },
    itunes: { provider: 'itunes', year: 1989 },
  },
];
