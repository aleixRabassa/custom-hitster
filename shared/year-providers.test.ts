import { describe, expect, it } from 'vitest';

import { YEAR_VOTE_FIXTURES, answersOf } from './__fixtures__/year-votes';
import type { ProviderAnswer, YearProviderId, YearStage } from './types';
import { yearCacheKey } from './year';
import {
  DEEZER_RECENT_SIGNATURE_FROM_YEAR,
  UNCONFIRMED_TRUST,
  YEAR_PROVIDER_PLAN,
  decideYear,
  deezerRecentSignature,
  findConfirmation,
  isrcYear,
  nextFrontier,
  providerCacheKey,
  validatePlan,
  voterYears,
  type ProviderPlan,
  type TrustTier,
} from './year-providers';

// ===========================================================================
//  ANSWER BUILDERS
//
//  The named shapes below (Killing In The Name, Men In Black, Pink Panther
//  Theme, A Whole New World, La Grange) carry the provider years recorded in
//  `docs/spikes/spike.year-fetch-rework.data.csv` and `...soundtracks.csv`.
//  Where a shape's year for one provider was not measured, the test says so
//  rather than inventing one.
// ===========================================================================

function deezer(year: number | null, isrc: number | null): ProviderAnswer {
  return { provider: 'deezer', year, isrcYear: isrc };
}

function itunes(year: number | null): ProviderAnswer {
  return { provider: 'itunes', year };
}

function mbHigh(year: number, viaTitle?: string): ProviderAnswer {
  return {
    provider: 'musicbrainz',
    year,
    confidence: 'high',
    source: 'release-group',
    ...(viaTitle !== undefined && { viaTitle }),
  };
}

function mbLow(year: number, viaTitle?: string): ProviderAnswer {
  return {
    provider: 'musicbrainz',
    year,
    confidence: 'low',
    source: 'recording',
    ...(viaTitle !== undefined && { viaTitle }),
  };
}

const MB_NONE: ProviderAnswer = { provider: 'musicbrainz', year: null, confidence: 'none' };

const NOTHING_EXCLUDED: ReadonlySet<YearProviderId> = new Set();

// ===========================================================================
//  THE CONSTANTS
// ===========================================================================

describe('YEAR_PROVIDER_PLAN', () => {
  it('should ask Deezer and MusicBrainz at resolve, then iTunes at verify', () => {
    // Spike §12.2 as amended by §13.12: Deezer (fast) ∥ MusicBrainz (coverage) → iTunes
    // (precision). No Discogs -- dropped on 2026-09-30 (§13.10-13.12).
    expect(YEAR_PROVIDER_PLAN).toStrictEqual([
      { provider: 'deezer', phase: 'fast', stage: 'resolve', finalWhenCertain: false },
      { provider: 'musicbrainz', phase: 'coverage', stage: 'resolve', finalWhenCertain: false },
      { provider: 'itunes', phase: 'precision', stage: 'verify', finalWhenCertain: false },
    ]);
  });

  it('should keep finalWhenCertain off on every shipped step', () => {
    // The dormant switch. A year is confirmed by TWO providers (§12.1 decision 2); turning
    // one on is a decision the developer has not taken, not a tuning knob.
    for (const step of YEAR_PROVIDER_PLAN) expect(step.finalWhenCertain).toBe(false);
  });
});

describe('UNCONFIRMED_TRUST', () => {
  it('should rank MusicBrainz high, then iTunes, then MusicBrainz low, then Deezer', () => {
    // §13.12, accepted by the developer: iTunes passes a `low` but never a `high`.
    expect(UNCONFIRMED_TRUST).toStrictEqual([
      'musicbrainz:high',
      'itunes',
      'musicbrainz:low',
      'deezer',
    ]);
  });
});

// ===========================================================================
//  validatePlan
// ===========================================================================

describe('validatePlan', () => {
  const deezerStep = YEAR_PROVIDER_PLAN[0]!;
  const mbStep = YEAR_PROVIDER_PLAN[1]!;
  const itunesStep = YEAR_PROVIDER_PLAN[2]!;

  it('should accept the shipped plan and trust order', () => {
    expect(validatePlan(YEAR_PROVIDER_PLAN, UNCONFIRMED_TRUST)).toStrictEqual([]);
  });

  it('should reject a provider listed twice', () => {
    const problems = validatePlan([deezerStep, deezerStep, mbStep, itunesStep], UNCONFIRMED_TRUST);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/deezer/);
  });

  it('should reject a trust tier naming a provider outside the plan', () => {
    const problems = validatePlan([deezerStep, mbStep], UNCONFIRMED_TRUST);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/itunes/);
  });

  it('should reject a provider with no trust tier', () => {
    const trust: TrustTier[] = ['musicbrainz:high', 'itunes', 'musicbrainz:low'];
    const problems = validatePlan(YEAR_PROVIDER_PLAN, trust);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/deezer/);
  });

  it('should accept MusicBrainz with only one of its two tiers', () => {
    // "At least one tier" per provider, not both: a plan may choose to trust only a `high`.
    expect(
      validatePlan(YEAR_PROVIDER_PLAN, ['musicbrainz:high', 'itunes', 'deezer']),
    ).toStrictEqual([]);
  });

  it('should reject a trust tier listed twice', () => {
    const problems = validatePlan(YEAR_PROVIDER_PLAN, [...UNCONFIRMED_TRUST, 'itunes']);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/itunes/);
  });

  it('should reject a verify step before a resolve step', () => {
    const problems = validatePlan([deezerStep, itunesStep, mbStep], UNCONFIRMED_TRUST);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/verify/);
  });
});

// ===========================================================================
//  VOTERS AND CONFIRMATION
// ===========================================================================

describe('voterYears', () => {
  it("should give Deezer's two distinct years as one voter's evidence", () => {
    expect(voterYears(deezer(2002, 1997))).toStrictEqual([2002, 1997]);
    expect(voterYears(deezer(2012, 2012))).toStrictEqual([2012]);
    expect(voterYears(deezer(null, 2005))).toStrictEqual([2005]);
    expect(voterYears(deezer(null, null))).toStrictEqual([]);
  });

  it('should give nothing for a null answer', () => {
    expect(voterYears(itunes(null))).toStrictEqual([]);
    expect(voterYears(MB_NONE)).toStrictEqual([]);
    expect(voterYears(itunes(1992))).toStrictEqual([1992]);
    expect(voterYears(mbLow(2014))).toStrictEqual([2014]);
  });
});

describe('findConfirmation', () => {
  it("should not confirm on Deezer's release year and ISRC year alone", () => {
    // The Killing In The Name shape (data.csv): Deezer's 20th-anniversary edition says 2012
    // for its release date AND its ISRC. One catalogue row, one voter -- so MusicBrainz's
    // correct 1992 and iTunes' 2001 are not outvoted by it.
    expect(findConfirmation([deezer(2012, 2012)])).toBeNull();
    expect(findConfirmation([deezer(2012, 2012), mbHigh(1992), itunes(2001)])).toBeNull();
  });

  it('should confirm when either Deezer year agrees with another provider', () => {
    expect(findConfirmation([deezer(2005, 2003), mbHigh(2003)])).toStrictEqual({
      year: 2003,
      agreedBy: ['deezer', 'musicbrainz'],
    });
    expect(findConfirmation([deezer(2005, 2003), itunes(2005)])).toStrictEqual({
      year: 2005,
      agreedBy: ['deezer', 'itunes'],
    });
  });

  it("should take the earliest year when Deezer's two years each agree with a different provider", () => {
    // Release date 1999 agrees with iTunes, ISRC 1997 with MusicBrainz: two confirmations,
    // and the earlier is the likelier original release (§5.1 rule 1).
    expect(findConfirmation([deezer(1999, 1997), mbHigh(1997), itunes(1999)])).toStrictEqual({
      year: 1997,
      agreedBy: ['deezer', 'musicbrainz'],
    });
  });

  it('should take the earliest year when two separate pairs agree', () => {
    // The EARLIER pair here is the one LATER in plan order, and the answers arrive in reverse
    // plan order: neither decides it. Only the year does.
    expect(findConfirmation([itunes(1998), mbLow(2001), deezer(2001, 1998)])).toStrictEqual({
      year: 1998,
      agreedBy: ['deezer', 'itunes'],
    });
  });

  it('should name the first two providers in plan order when all three agree', () => {
    expect(findConfirmation([itunes(1983), mbHigh(1983), deezer(1983, 1983)])).toStrictEqual({
      year: 1983,
      agreedBy: ['deezer', 'musicbrainz'],
    });
  });

  it('should not count one provider answering twice as two voters', () => {
    expect(findConfirmation([itunes(1990), itunes(1990)])).toBeNull();
  });
});

// ===========================================================================
//  decideYear
// ===========================================================================

describe('decideYear', () => {
  it('should confirm Personal Jesus at 1990 at step 2 and never ask iTunes', () => {
    // The stop rule, and its accepted price. MusicBrainz says 1990 (`high`, pinned wrong in
    // YEAR_LIMITATION_FIXTURES: the 1989 single is a separate 3:46 recording) and Deezer
    // agrees on 1990, so the card is confirmed at `resolve` and iTunes' CORRECT 1989 is never
    // asked for. Spike §13.12: when MusicBrainz and Deezer agree against iTunes, the pair was
    // right 11 times to iTunes' 4 -- this is one of the 4. Deezer's years are the captured
    // ones (`year-votes.ts`: release 1990, ISRC 2006 -- a reissue's code, which agrees with
    // nobody); the confirmation is on the release-date year.
    const resolved = [deezer(1990, 2006), mbHigh(1990)];

    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'verify', { answers: resolved, excluded: NOTHING_EXCLUDED }),
    ).toStrictEqual({ kind: 'done' });
    expect(decideYear(resolved)).toStrictEqual({
      year: 1990,
      confidence: 'high',
      source: 'vote',
      agreedBy: ['deezer', 'musicbrainz'],
    });
  });

  it('should keep the MusicBrainz and Deezer year when iTunes disagrees', () => {
    // The Men In Black shape (soundtracks.csv), decided with EVERY answer present so the rule
    // and not the stop is what is pinned: MusicBrainz `high` 1997, Deezer 2002 with ISRC 1997,
    // iTunes 1988. The pair meets on Deezer's ISRC year; iTunes' earlier 1988 has no partner.
    expect(decideYear([deezer(2002, 1997), mbHigh(1997), itunes(1988)])).toStrictEqual({
      year: 1997,
      confidence: 'high',
      source: 'vote',
      agreedBy: ['deezer', 'musicbrainz'],
    });
  });

  it('should count iTunes and Deezer as two voters', () => {
    // The Pink Panther Theme shape (soundtracks.csv): MusicBrainz `high` 1963, iTunes 2006,
    // Deezer 2006 with ISRC 2007. The two stores confirm 2006 over MusicBrainz's right 1963.
    //
    // THIS IS A KNOWN WRONG ANSWER, PINNED ON PURPOSE. Counting the stores as one voter would
    // fix it, and was measured and rejected (spike §13.11): on the 542 it undid three
    // hand-verified corrections, net -4 known-right years there for +2 on the soundtracks.
    // If this test fails because Pink Panther now reads 1963, the voter rule changed -- read
    // §13.11 before accepting that.
    expect(decideYear([deezer(2006, 2007), mbHigh(1963), itunes(2006)])).toStrictEqual({
      year: 2006,
      confidence: 'high',
      source: 'vote',
      agreedBy: ['deezer', 'itunes'],
    });
  });

  it('should ignore a skipped or null provider and still ask the next one', () => {
    // Deezer skipped (not configured): resolve still asks MusicBrainz.
    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'resolve', { answers: [], excluded: new Set(['deezer']) }),
    ).toStrictEqual({ kind: 'ask', providers: ['musicbrainz'] });

    // Deezer asked and found nothing: its null is an ANSWER (never re-asked), but not a vote,
    // so verify still asks iTunes, and iTunes' agreement is what confirms.
    const answers = [deezer(null, null), mbLow(2008)];
    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'verify', { answers, excluded: NOTHING_EXCLUDED }),
    ).toStrictEqual({ kind: 'ask', providers: ['itunes'] });
    expect(decideYear([...answers, itunes(2008)])).toStrictEqual({
      year: 2008,
      confidence: 'high',
      source: 'vote',
      agreedBy: ['musicbrainz', 'itunes'],
    });
    expect(decideYear([...answers, itunes(null)])).toStrictEqual({
      year: 2008,
      confidence: 'low',
      source: 'recording',
    });
  });

  it('should return no year when every answer is null', () => {
    expect(decideYear([deezer(null, null), MB_NONE, itunes(null)])).toStrictEqual({
      year: null,
      confidence: 'none',
    });
    expect(decideYear([])).toStrictEqual({ year: null, confidence: 'none' });
  });

  it('should fall back in the order MusicBrainz high, iTunes, MusicBrainz low, Deezer', () => {
    // A lone MusicBrainz `high` beats a lone iTunes: the Killing In The Name shape (data.csv),
    // MusicBrainz 1992 `high`, iTunes 2001, Deezer 2012/2012. iTunes-over-a-`high` was
    // measured and rejected: it is exactly this card, 1992 -> 2001 (§13.12).
    expect(decideYear([deezer(2012, 2012), mbHigh(1992), itunes(2001)])).toStrictEqual({
      year: 1992,
      confidence: 'low',
      source: 'release-group',
    });

    // A lone iTunes beats a MusicBrainz `low`: the A Whole New World shape (soundtracks.csv),
    // MusicBrainz 2014 `low`, iTunes 1992, Deezer 1997 with ISRC 2005. 2014 -> 1992 is the
    // recovery that put iTunes above a `low`.
    expect(decideYear([deezer(1997, 2005), mbLow(2014), itunes(1992)])).toStrictEqual({
      year: 1992,
      confidence: 'low',
      source: 'itunes',
    });

    // A MusicBrainz `low` beats a lone Deezer, even one whose two dates agree.
    expect(decideYear([deezer(2019, 2019), mbLow(2018)])).toStrictEqual({
      year: 2018,
      confidence: 'low',
      source: 'recording',
    });
  });

  it('should follow a trust order passed in, not the shipped one', () => {
    expect(decideYear([mbHigh(1992), itunes(2001)], ['itunes', 'musicbrainz:high'])).toStrictEqual({
      year: 2001,
      confidence: 'low',
      source: 'itunes',
    });
  });

  it('should carry a kept MusicBrainz viaTitle, and omit it when absent', () => {
    expect(decideYear([mbLow(2004, 'Mr Brightside')])).toStrictEqual({
      year: 2004,
      confidence: 'low',
      source: 'recording',
      viaTitle: 'Mr Brightside',
    });
    expect(decideYear([mbHigh(2004)])).not.toHaveProperty('viaTitle');
  });

  it('should accept a lone Deezer only when its two years agree', () => {
    expect(decideYear([deezer(2021, 2021)])).toStrictEqual({
      year: 2021,
      confidence: 'low',
      source: 'deezer',
    });
    expect(decideYear([deezer(2021, 2020)])).toStrictEqual({ year: null, confidence: 'none' });
    expect(decideYear([deezer(2021, null)])).toStrictEqual({ year: null, confidence: 'none' });
    expect(decideYear([deezer(null, 2021)])).toStrictEqual({ year: null, confidence: 'none' });
  });

  it('should not confirm a MusicBrainz high alone', () => {
    // One voter since 2026-09-30 (§12.1 decision 4): the strongest LONE answer, never a
    // confirmation.
    expect(findConfirmation([mbHigh(1992)])).toBeNull();
    expect(decideYear([mbHigh(1992)])).toStrictEqual({
      year: 1992,
      confidence: 'low',
      source: 'release-group',
    });
  });

  it('should confirm a MusicBrainz low with one agreeing provider', () => {
    expect(decideYear([mbLow(2014), itunes(2014)])).toStrictEqual({
      year: 2014,
      confidence: 'high',
      source: 'vote',
      agreedBy: ['musicbrainz', 'itunes'],
    });
  });
});

// ===========================================================================
//  DEEZER'S RECENT-RELEASE SIGNATURE (dormant: finalWhenCertain is off)
// ===========================================================================

describe('deezerRecentSignature', () => {
  it('should fire the recent-release signature only from 2015 and without a remaster or live suffix', () => {
    // La Grange (data.csv): Deezer 2019 with ISRC 2019 -- a remaster's fresh code on a 1973
    // song. The RAW title's suffix is what stops it firing.
    const laGrange = { provider: 'deezer', year: 2019, isrcYear: 2019 } as const;
    expect(deezerRecentSignature(laGrange, 'La Grange - 2005 Remaster')).toBe(false);
    expect(deezerRecentSignature(laGrange, 'La Grange - Live')).toBe(false);
    expect(deezerRecentSignature(laGrange, 'La Grange')).toBe(true);

    const from = DEEZER_RECENT_SIGNATURE_FROM_YEAR;
    expect(from).toBe(2015);
    expect(deezerRecentSignature({ provider: 'deezer', year: from, isrcYear: from }, 'Song')).toBe(
      true,
    );
    expect(
      deezerRecentSignature({ provider: 'deezer', year: from - 1, isrcYear: from - 1 }, 'Song'),
    ).toBe(false);
    expect(deezerRecentSignature({ provider: 'deezer', year: 2019, isrcYear: 2018 }, 'Song')).toBe(
      false,
    );
    expect(deezerRecentSignature({ provider: 'deezer', year: null, isrcYear: 2019 }, 'Song')).toBe(
      false,
    );
  });

  it('should fire on a feature or version suffix', () => {
    // Only remaster and live mark a re-issue of an older recording; a "(feat. X)" or a
    // "- Radio Edit" on a 2021 single is still a 2021 recording.
    const answer = { provider: 'deezer', year: 2021, isrcYear: 2021 } as const;
    expect(deezerRecentSignature(answer, 'Song (feat. Someone)')).toBe(true);
    expect(deezerRecentSignature(answer, 'Song - Radio Edit')).toBe(true);
  });
});

// ===========================================================================
//  nextFrontier
// ===========================================================================

describe('nextFrontier', () => {
  const allResolve: ProviderPlan = YEAR_PROVIDER_PLAN.map((step) => ({
    ...step,
    stage: 'resolve',
  }));

  it('should ask Deezer and MusicBrainz together when nothing is answered', () => {
    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'resolve', { answers: [], excluded: NOTHING_EXCLUDED }),
    ).toStrictEqual({ kind: 'ask', providers: ['deezer', 'musicbrainz'] });
  });

  it('should ask only the next provider once one answer carries a year', () => {
    // A test plan with all three in `resolve`, so "the next two" and "the next one" differ.
    expect(
      nextFrontier(allResolve, 'resolve', {
        answers: [deezer(2001, 2001)],
        excluded: NOTHING_EXCLUDED,
      }),
    ).toStrictEqual({ kind: 'ask', providers: ['musicbrainz'] });
  });

  it('should still ask the next two when the only answers are null', () => {
    expect(
      nextFrontier(allResolve, 'resolve', {
        answers: [deezer(null, null)],
        excluded: NOTHING_EXCLUDED,
      }),
    ).toStrictEqual({ kind: 'ask', providers: ['musicbrainz', 'itunes'] });
  });

  it('should ask a finalWhenCertain provider alone', () => {
    const deezerFinal: ProviderPlan = YEAR_PROVIDER_PLAN.map((step) => ({
      ...step,
      finalWhenCertain: step.provider === 'deezer',
    }));

    expect(
      nextFrontier(deezerFinal, 'resolve', { answers: [], excluded: NOTHING_EXCLUDED }),
    ).toStrictEqual({
      kind: 'ask',
      providers: ['deezer'],
    });
  });

  it('should not pair a provider with a finalWhenCertain one behind it', () => {
    const mbFinal: ProviderPlan = YEAR_PROVIDER_PLAN.map((step) => ({
      ...step,
      finalWhenCertain: step.provider === 'musicbrainz',
    }));

    expect(
      nextFrontier(mbFinal, 'resolve', { answers: [], excluded: NOTHING_EXCLUDED }),
    ).toStrictEqual({
      kind: 'ask',
      providers: ['deezer'],
    });
  });

  it('should never return a provider from the other stage', () => {
    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'verify', { answers: [], excluded: NOTHING_EXCLUDED }),
    ).toStrictEqual({ kind: 'ask', providers: ['itunes'] });
    // Resolve exhausted with no confirmation: done, NOT iTunes -- that is verify's call.
    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'resolve', {
        answers: [deezer(2012, 2012), mbHigh(1992)],
        excluded: NOTHING_EXCLUDED,
      }),
    ).toStrictEqual({ kind: 'done' });
  });

  it('should never ask a provider already answered or excluded', () => {
    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'resolve', {
        answers: [deezer(2001, 2001)],
        excluded: new Set(['musicbrainz']),
      }),
    ).toStrictEqual({ kind: 'done' });
    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'verify', {
        answers: [mbHigh(1992)],
        excluded: new Set(['itunes']),
      }),
    ).toStrictEqual({ kind: 'done' });
    expect(
      nextFrontier(YEAR_PROVIDER_PLAN, 'verify', {
        answers: [mbHigh(1992), itunes(null)],
        excluded: NOTHING_EXCLUDED,
      }),
    ).toStrictEqual({ kind: 'done' });
  });

  it('should return done on a confirmation, even with providers left to ask', () => {
    expect(
      nextFrontier(allResolve, 'resolve', {
        answers: [deezer(1997, 1997), mbHigh(1997)],
        excluded: NOTHING_EXCLUDED,
      }),
    ).toStrictEqual({ kind: 'done' });
  });
});

// ===========================================================================
//  isrcYear
// ===========================================================================

describe('isrcYear', () => {
  const now = new Date('2026-09-30T12:00:00Z');

  it('should read characters 6-7 with the pivot at next year', () => {
    expect(isrcYear('USRC17607839', now)).toBe(1976);
    expect(isrcYear('GBAYE0601498', now)).toBe(2006);
    expect(isrcYear('ESA011200001', now)).toBe(2012);
    expect(isrcYear('USAT20000001', now)).toBe(2000);
    // The pivot: 27 is next year's two digits and reads 20xx; 28 reads 19xx.
    expect(isrcYear('USAT22700001', now)).toBe(2027);
    expect(isrcYear('USAT22800001', now)).toBe(1928);
    expect(isrcYear('USAT29900001', now)).toBe(1999);
  });

  it('should move the pivot with now', () => {
    expect(isrcYear('USAT22800001', new Date('2027-06-01T00:00:00Z'))).toBe(2028);
  });

  it('should keep a back-coded catalogue year before 1986', () => {
    // ISO 3901 dates from 1986, but major registrants back-code catalogue with the ORIGINAL
    // recording year, and those years are right: 28 verified rows of the spike's 804 cards
    // decode to 1964-1984, and each card's minimum is its recording's year or within one. A
    // "before 1986 -> null" floor was measured and refused; these are real captured codes.
    expect(isrcYear('USFI86900065', now)).toBe(1969); // Fortunate Son
    expect(isrcYear('SEAYD7601020', now)).toBe(1976); // Dancing Queen
    expect(isrcYear('AUAP08000046', now)).toBe(1980); // Back In Black
    expect(isrcYear('USMC17301722', now)).toBe(1973); // Free Bird, in year-votes.ts
  });

  it("should read a GBSMU bootleg's nonsense year literally", () => {
    // Pinned as KNOWN behaviour, not endorsed: the registrant writes what look like sequence
    // digits in the year field. The value is inert in the vote (it can only confirm if a
    // second provider names 1929) and costs Sweet Child O' Mine one iTunes request, because
    // as Deezer's minimum it masks that track's correct 1987 code.
    expect(isrcYear('GBSMU2955085', now)).toBe(1929);
    // ...and it is clock-dependent like any 28-99 code: from 2028 it reads 2029.
    expect(isrcYear('GBSMU2955085', new Date('2028-01-01T00:00:00Z'))).toBe(2029);
  });

  it('should tolerate display hyphens', () => {
    expect(isrcYear('US-RC1-76-07839', now)).toBe(1976);
  });

  it('should give null for a malformed ISRC', () => {
    for (const malformed of [
      '',
      'USRC1760783', // one digit short
      'USRC176078390', // one digit long
      'U1RC17607839', // a digit in the country code
      'USRC1AB07839', // letters where the year goes
      'USRC17607A39', // a letter in the designation
      'US RC1 76 07839', // spaces are not the display separator
    ]) {
      expect(isrcYear(malformed, now)).toBeNull();
    }
  });
});

// ===========================================================================
//  THE 22 GROUND-TRUTH FIXTURES, THROUGH BOTH STAGES
// ===========================================================================

/**
 * The driver's loop without HTTP: each stage asks what `nextFrontier` returns until it says
 * done, from a pool holding every provider's answer. That is `runStage`'s ask loop
 * (`api/_lib/year-pipeline.ts`) with the adapters replaced by a lookup, so what is measured is
 * the plan, the stop rule and the vote -- nothing the network could change.
 */
function playBothStages(answers: readonly ProviderAnswer[]) {
  const pool = new Map(answers.map((answer) => [answer.provider, answer]));
  const got: ProviderAnswer[] = [];
  let confirmedAt: YearStage | undefined;
  for (const stage of ['resolve', 'verify'] as const) {
    for (;;) {
      const frontier = nextFrontier(YEAR_PROVIDER_PLAN, stage, {
        answers: got,
        excluded: NOTHING_EXCLUDED,
      });
      if (frontier.kind === 'done') break;
      for (const provider of frontier.providers) got.push(pool.get(provider)!);
    }
    confirmedAt ??= findConfirmation(got) === null ? undefined : stage;
  }
  return { decision: decideYear(got), confirmedAt, asked: got.map((answer) => answer.provider) };
}

describe('the 22 ground-truth fixtures', () => {
  it('should come out 21/22 exact over the 22 fixtures', () => {
    const played = YEAR_VOTE_FIXTURES.map((fixture) => ({
      fixture,
      ...playBothStages(answersOf(fixture)),
    }));

    // The one miss is Personal Jesus, confirmed wrong at `resolve`: MusicBrainz and Deezer
    // both say 1990, so iTunes' correct 1989 is never asked for (the stop rule's accepted
    // price, pinned above). Spike §13.10's "without Discogs" row: 21/22.
    const misses = played
      .filter(({ fixture, decision }) => decision.year !== fixture.expectedYear)
      .map(({ fixture, decision }) => [fixture.key, decision.year]);
    expect(misses).toStrictEqual([['personalJesus', 1990]]);

    // Where each card was decided. A REORDER OF THE PLAN IS MEANT TO MOVE THESE -- that is
    // what they are pinned for; re-pin deliberately, with the reason. Against the spike's own
    // run over the same 22 (11 at resolve, 9 at verify), exactly one card moved: sweetChild,
    // because Deezer's catalogue moved (1988 / ISRC 1987 then, 2016 / ISRC 1929 now -- a
    // GBSMU bootleg code masking the correct 1987), not because a rule changed.
    const confirmedAt = (stage: YearStage) =>
      played.filter((p) => p.confirmedAt === stage).map((p) => p.fixture.key);
    expect({
      resolve: confirmedAt('resolve').length,
      verify: confirmedAt('verify').length,
      unconfirmed: played
        .filter((p) => p.decision.confidence === 'low')
        .map((p) => [p.fixture.key, p.decision.year]),
      noYear: played.filter((p) => p.decision.confidence === 'none').length,
    }).toStrictEqual({
      resolve: 10,
      verify: 10,
      // Both kept as a lone MusicBrainz `high` (right on both): nobody else answered 1974 for
      // No Woman No Cry, and neither store verified a Layla row (the "and"/"&" credit).
      unconfirmed: [
        ['noWomanNoCry', 1974],
        ['layla', 1970],
      ],
      noYear: 0,
    });
    // iTunes is asked exactly for the cards `resolve` could not confirm.
    expect(played.filter((p) => p.asked.includes('itunes'))).toHaveLength(12);
  });
});

// ===========================================================================
//  providerCacheKey
// ===========================================================================

describe('providerCacheKey', () => {
  it('should prefix each provider with its own versioned namespace', () => {
    expect(providerCacheKey('deezer', 'Queen', 'Bohemian Rhapsody')).toBe(
      'yearprov:deezer:v1:queen|bohemian rhapsody',
    );
    expect(providerCacheKey('itunes', 'Queen', 'Bohemian Rhapsody')).toBe(
      'yearprov:itunes:v1:queen|bohemian rhapsody',
    );
    expect(providerCacheKey('musicbrainz', 'Queen', 'Bohemian Rhapsody')).toBe(
      'yearprov:musicbrainz:v1:queen|bohemian rhapsody',
    );
  });

  it('should normalise both parts the way the MusicBrainz key does', () => {
    expect(providerCacheKey('itunes', 'Beyoncé', 'Don’t  Stop — Me Now!')).toBe(
      'yearprov:itunes:v1:beyonce|dont stop me now',
    );
    expect(providerCacheKey('deezer', 'Déjà Vu', 'X')).toBe(
      providerCacheKey('deezer', 'deja vu', 'x'),
    );
  });

  it('should never collide with the MusicBrainz year-cache key', () => {
    expect(providerCacheKey('musicbrainz', 'Queen', 'Bohemian Rhapsody')).not.toBe(
      yearCacheKey('Queen', 'Bohemian Rhapsody'),
    );
  });
});
