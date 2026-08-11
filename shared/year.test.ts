import { describe, expect, it } from 'vitest';

import { YEAR_FIXTURES, YEAR_LIMITATION_FIXTURES } from './__fixtures__/year-candidates';
import {
  YEAR_CACHE_SCHEMA_VERSION,
  YEAR_TIER_ORDER,
  artistMatchesExact,
  cleanTrackTitle,
  normalizeForCacheKey,
  pickBestRecording,
  stripRemixSuffix,
  yearCacheKey,
} from './year';
import type { RecordingCandidate } from './types';

// ===========================================================================
//  TITLE CLEANING
// ===========================================================================

describe('cleanTrackTitle', () => {
  it('should strip a "- Remastered YYYY" suffix', () => {
    // The exact form Phase 0 measured returning ZERO MusicBrainz results, re-verified
    // live 2026-08-04: `recording:"Bohemian Rhapsody - Remastered 2011"` -> count 0,
    // `recording:"Bohemian Rhapsody"` -> count 224. This is a correctness requirement.
    const result = cleanTrackTitle('Bohemian Rhapsody - Remastered 2011');

    expect(result.title).toBe('Bohemian Rhapsody');
    expect(result.stripped.remaster).toBe(true);
  });

  it('should strip "- Remaster", "- YYYY Remaster", and digital-remaster variants', () => {
    // The suffix FAMILY, not just the one sampled form -- Spotify uses all of these.
    for (const raw of [
      'Stairway to Heaven - Remaster',
      'Hotel California - 2013 Remaster',
      'Sun King - 2019 Digital Remaster',
      'Wish You Were Here - 2011 Remastered Version',
      'Layla - Remastered',
    ]) {
      const result = cleanTrackTitle(raw);
      expect(result.stripped.remaster, raw).toBe(true);
      expect(result.title, raw).not.toMatch(/remaster/i);
    }
  });

  it('should strip live suffixes including "- Live at …"', () => {
    expect(cleanTrackTitle('Comfortably Numb - Live').title).toBe('Comfortably Numb');
    expect(cleanTrackTitle('No Woman No Cry - Live At The Lyceum, London/1975').title).toBe(
      'No Woman No Cry',
    );
    expect(cleanTrackTitle('Hey Jude - Live in Toronto').title).toBe('Hey Jude');
    expect(cleanTrackTitle('Purple Rain (Live)').stripped.live).toBe(true);
  });

  it('should strip "(feat. …)" and "(with …)"', () => {
    expect(cleanTrackTitle('Perfect (feat. Beyoncé)').title).toBe('Perfect');
    expect(cleanTrackTitle('Wonderful Tonight (with Eric Clapton)').title).toBe(
      'Wonderful Tonight',
    );
    expect(cleanTrackTitle('Forever - feat. Drake').stripped.feature).toBe(true);
  });

  it('should strip edition, edit, and mix suffixes', () => {
    expect(cleanTrackTitle('Born to Run - Single Version').title).toBe('Born to Run');
    expect(cleanTrackTitle('Blinding Lights - Radio Edit').title).toBe('Blinding Lights');
    expect(cleanTrackTitle('Strawberry Fields Forever - Mono').title).toBe(
      'Strawberry Fields Forever',
    );
    expect(cleanTrackTitle('Blue Monday - Extended Mix').title).toBe('Blue Monday');
    expect(cleanTrackTitle('Thriller - 25th Anniversary Edition').title).toBe('Thriller');
    expect(cleanTrackTitle('Barbie World - From "Barbie The Album"').title).toBe('Barbie World');
    expect(cleanTrackTitle('Song 2 [Explicit]').stripped.version).toBe(true);
  });

  it('should strip multiple suffixes from one title', () => {
    // Single-pass stripping half-handles this, leaving a title that still returns zero
    // results. Segments nest right-to-left, so the cleaner must loop.
    const result = cleanTrackTitle('Perfect Duet (feat. Beyoncé) - Remastered 2017');

    expect(result.title).toBe('Perfect Duet');
    expect(result.stripped.feature).toBe(true);
    expect(result.stripped.remaster).toBe(true);
  });

  it('should leave a clean title untouched', () => {
    for (const raw of [
      'Billie Jean',
      'Smells Like Teen Spirit',
      "Sweet Child O' Mine",
      'Where Is My Mind?',
      'Anti-Hero',
    ]) {
      const result = cleanTrackTitle(raw);
      expect(result.title, raw).toBe(raw);
      expect(result.stripped, raw).toEqual({
        remaster: false,
        live: false,
        feature: false,
        version: false,
      });
    }
  });

  it('should not strip a suffix-like phrase that is part of the real title', () => {
    // The false-positive risk, stated directly. "Live" and "Mix" are ordinary words; only
    // a TRAILING dash- or bracket-delimited segment is a suffix.
    expect(cleanTrackTitle('Live and Let Die').title).toBe('Live and Let Die');
    expect(cleanTrackTitle('Live Forever').title).toBe('Live Forever');
    expect(cleanTrackTitle('(Don’t Fear) The Reaper').title).toBe('(Don’t Fear) The Reaper');
    // An unrecognised trailing segment is kept -- the Reprise is a genuinely different track
    // from the title one, so stripping it would search for the wrong song.
    expect(cleanTrackTitle("Sgt. Pepper's Lonely Hearts Club Band - Reprise").title).toBe(
      "Sgt. Pepper's Lonely Hearts Club Band - Reprise",
    );
  });

  it('should never return an empty title', () => {
    // Stripping that would consume everything keeps the original: an empty query would
    // match the entire database, which is worse than a bad query.
    expect(cleanTrackTitle('Live').title).toBe('Live');
    expect(cleanTrackTitle('- Remastered 2011').title).not.toBe('');
    expect(cleanTrackTitle('(feat. Someone)').title).not.toBe('');
    expect(cleanTrackTitle('   ').title).toBe('');
  });

  it('should report which suffix families were stripped', () => {
    // The diagnostic flags the /api/year response and Phase 6's reveal-side year UI consume.
    // They deliberately do NOT feed back into scoring (decision 14).
    expect(cleanTrackTitle('Bohemian Rhapsody - Remastered 2011').stripped).toEqual({
      remaster: true,
      live: false,
      feature: false,
      version: false,
    });
    expect(cleanTrackTitle('Hey Jude - Live at Wembley').stripped).toEqual({
      remaster: false,
      live: true,
      feature: false,
      version: false,
    });
    expect(cleanTrackTitle('Perfect (feat. Beyoncé) - Radio Edit').stripped).toEqual({
      remaster: false,
      live: false,
      feature: true,
      version: true,
    });
  });

  it('should neutralise query-breaking characters', () => {
    // The adapter wraps the title in double quotes inside a Lucene query, so a quote, a
    // backslash or a field-separator colon changes the query's STRUCTURE, not its terms.
    const result = cleanTrackTitle('Symphony No. 5: "Fate" [movement]');

    expect(result.title).not.toMatch(/["\\:[\]{}^~]/);
    expect(result.title).toContain('Symphony No. 5');
    expect(result.title).toContain('Fate');
  });
});

// ===========================================================================
//  THE REMIX FALLBACK TITLE
//
//  Not part of `cleanTrackTitle()` on purpose -- a remix is often a real,
//  separately-credited recording, so the FIRST query must keep the full title.
//  This produces the SECOND query, used only when the first found no year at
//  all. See the block comment on `stripRemixSuffix()`.
// ===========================================================================

describe('stripRemixSuffix', () => {
  it('should strip the "- Remix" tail Spotify actually uses', () => {
    // All five measured 2026-08-05 on a real playlist, where each of them resolved to NO year
    // with the suffix left on. This was the single largest identifiable cause of a blank card.
    expect(stripRemixSuffix('Ella No Es Tuya - Remix')).toBe('Ella No Es Tuya');
    expect(stripRemixSuffix('Pininfarina - Remix')).toBe('Pininfarina');
    expect(stripRemixSuffix('Tumba la Casa - Remix')).toBe('Tumba la Casa');
    expect(stripRemixSuffix('Además de Mí - Remix')).toBe('Además de Mí');
    expect(stripRemixSuffix('4 KISSUS - Remix')).toBe('4 KISSUS');
  });

  it('should strip a named remixer', () => {
    // The remixer's name is part of the segment more often than not, which is what the
    // optional leading group in the pattern is for.
    expect(stripRemixSuffix('Faded - Alan Walker Remix')).toBe('Faded');
    expect(stripRemixSuffix('Dákiti (Bad Bunny Remix)')).toBe('Dákiti');
    expect(stripRemixSuffix('Levels - Skrillex Remix Edit')).toBe('Levels');
  });

  it('should strip the parenthesised and bracketed forms', () => {
    expect(stripRemixSuffix('Titanium (Remix)')).toBe('Titanium');
    expect(stripRemixSuffix('Titanium [Remix]')).toBe('Titanium');
  });

  it('should strip the neighbouring version families it is named for', () => {
    expect(stripRemixSuffix('Animals - Bootleg')).toBe('Animals');
    expect(stripRemixSuffix('Animals - VIP Mix')).toBe('Animals');
    expect(stripRemixSuffix('Animals - Re-Mix')).toBe('Animals');
    expect(stripRemixSuffix('Animals - Remix Version')).toBe('Animals');
  });

  it('should be case-insensitive about the tail', () => {
    expect(stripRemixSuffix('Song - REMIX')).toBe('Song');
    expect(stripRemixSuffix('Song - remix')).toBe('Song');
  });

  it('should return undefined for a title with no remix tail', () => {
    // The caller spends a whole MusicBrainz request on a non-undefined answer, so a false
    // positive here costs a request against a budget shared by every user of the app.
    expect(stripRemixSuffix('Bohemian Rhapsody')).toBeUndefined();
    expect(stripRemixSuffix('No Woman No Cry')).toBeUndefined();
    expect(stripRemixSuffix('Levels - Radio Edit')).toBeUndefined();
    expect(stripRemixSuffix('Sgt. Pepper - Reprise')).toBeUndefined();
  });

  it('should not strip a release name that merely contains the word', () => {
    // "The Remix Album" and "Remixes" name RELEASES, not version tails. Stripping them would
    // change which song is being searched for, which is the failure mode the whole allow-list
    // approach in this module exists to avoid.
    expect(stripRemixSuffix('Song - The Remix Album')).toBeUndefined();
    expect(stripRemixSuffix('Song - Remixes')).toBeUndefined();
  });

  it('should not strip a word that is part of the title itself', () => {
    // No trailing segment at all: the pattern requires a separator, exactly as
    // `cleanTrackTitle()` does for "Live and Let Die".
    expect(stripRemixSuffix('Remix')).toBeUndefined();
    expect(stripRemixSuffix('Remix Culture')).toBeUndefined();
    expect(stripRemixSuffix('Anti-Remix')).toBeUndefined();
  });

  it('should return undefined when the title is nothing but a remix tail', () => {
    // There is no underlying song to ask about, so no request should be spent on it.
    expect(stripRemixSuffix('- Remix')).toBeUndefined();
    expect(stripRemixSuffix('(Remix)')).toBeUndefined();
  });

  it('should tolerate a non-string input', () => {
    expect(stripRemixSuffix(undefined as unknown as string)).toBeUndefined();
  });
});

// ===========================================================================
//  CACHE KEY
// ===========================================================================

describe('normalizeForCacheKey', () => {
  it('should produce the same key for titles differing only by case, punctuation, or whitespace', () => {
    // This is what makes the cache SHARED. Without it the cache only ever helps the person
    // who warmed it.
    const expected = normalizeForCacheKey('Dont Stop Me Now');

    expect(normalizeForCacheKey("Don't Stop Me Now")).toBe(expected);
    expect(normalizeForCacheKey('DONT   STOP  ME NOW')).toBe(expected);
    expect(normalizeForCacheKey('  don’t stop me now!  ')).toBe(expected);
  });

  it('should produce the same key for titles differing only by diacritics', () => {
    expect(normalizeForCacheKey('Déjà Vu')).toBe(normalizeForCacheKey('Deja Vu'));
    expect(normalizeForCacheKey('Beyoncé')).toBe(normalizeForCacheKey('Beyonce'));
    expect(normalizeForCacheKey('Sinéad O’Connor')).toBe(normalizeForCacheKey('Sinead OConnor'));
  });

  it('should produce different keys for genuinely different tracks', () => {
    // The guard against over-normalization. Punctuation collapses to a SPACE, not to
    // nothing, so word boundaries survive and distinct songs stay distinct.
    expect(normalizeForCacheKey('Hallelujah')).not.toBe(normalizeForCacheKey('Hallelujah II'));
    expect(normalizeForCacheKey('The Beatles')).not.toBe(normalizeForCacheKey('Thebeatles'));
    expect(normalizeForCacheKey('One')).not.toBe(normalizeForCacheKey('One More Time'));
  });

  it('should include the schema version segment', () => {
    // Load-bearing: when the scoring logic changes, every cached year was computed by the
    // old logic. Bumping this one segment invalidates them all in a single edit.
    const key = yearCacheKey('Queen', 'Bohemian Rhapsody');

    expect(key).toBe(`mbyear:${YEAR_CACHE_SCHEMA_VERSION}:queen|bohemian rhapsody`);
    // Pinned literally as well, so a bump has to be a DELIBERATE two-line change rather than
    // something that slips through because every assertion interpolated the constant.
    expect(key.startsWith('mbyear:v4:')).toBe(true);
  });
});

// ===========================================================================
//  CANDIDATE SELECTION
// ===========================================================================

/** Build a candidate with sane studio-album defaults, so each test states only what it varies. */
function candidate(overrides: Partial<RecordingCandidate> = {}): RecordingCandidate {
  return {
    recordingId: 'rec-1',
    title: 'A Song',
    artistCredit: 'A Band',
    releaseGroupId: 'rg-1',
    releaseGroupPrimaryType: 'Album',
    releaseGroupSecondaryTypes: [],
    releaseGroupFirstReleaseDate: '1975',
    releaseStatus: 'Official',
    ...overrides,
  };
}

const OFFICIAL = { artist: 'A Band', tier: 'official-release' } as const;
const STUDIO = { artist: 'A Band', tier: 'studio-release' } as const;
const UNFILTERED = { artist: 'A Band', tier: 'unfiltered' } as const;

describe('pickBestRecording', () => {
  it('should prefer an official studio album over a live release', () => {
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'live',
          releaseGroupId: 'rg-live',
          releaseGroupSecondaryTypes: ['Live'],
          releaseGroupFirstReleaseDate: '1970',
        }),
        candidate({ recordingId: 'studio', releaseGroupFirstReleaseDate: '1975' }),
      ],
      OFFICIAL,
    );

    // The live release is EARLIER and still loses -- the filter runs before the date compare.
    expect(result.year).toBe(1975);
  });

  it('should prefer an official studio album over a compilation', () => {
    // The Billie Jean / Hotel California class of failure: a compilation reissue outranks
    // the original album in MusicBrainz's relevance ordering.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'comp',
          releaseGroupId: 'rg-comp',
          releaseGroupSecondaryTypes: ['Compilation'],
          releaseGroupFirstReleaseDate: '1968',
        }),
        candidate({ recordingId: 'studio', releaseGroupFirstReleaseDate: '1982' }),
      ],
      OFFICIAL,
    );

    expect(result.year).toBe(1982);
  });

  it('should exclude remix and bootleg release groups', () => {
    // Built from the Stairway-to-Heaven-bootleg case that produced a 2025 year in Phase 0.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'remix',
          releaseGroupId: 'rg-remix',
          releaseGroupSecondaryTypes: ['Remix'],
          releaseGroupFirstReleaseDate: '1960',
        }),
        candidate({
          recordingId: 'bootleg',
          releaseGroupId: 'rg-boot',
          releaseStatus: 'Bootleg',
          releaseGroupFirstReleaseDate: '1961',
        }),
        candidate({
          recordingId: 'djmix',
          releaseGroupId: 'rg-dj',
          releaseGroupSecondaryTypes: ['Compilation', 'DJ-mix'],
          releaseGroupFirstReleaseDate: '1962',
        }),
        candidate({ recordingId: 'studio', releaseGroupFirstReleaseDate: '1971' }),
      ],
      OFFICIAL,
    );

    expect(result.year).toBe(1971);
  });

  it('should exclude non-official releases', () => {
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'promo',
          releaseGroupId: 'rg-promo',
          releaseStatus: 'Promotion',
          releaseGroupFirstReleaseDate: '1965',
        }),
        candidate({
          recordingId: 'pseudo',
          releaseGroupId: 'rg-pseudo',
          releaseStatus: 'Pseudo-Release',
          releaseGroupFirstReleaseDate: '1966',
        }),
        candidate({ recordingId: 'studio', releaseGroupFirstReleaseDate: '1976' }),
      ],
      OFFICIAL,
    );

    expect(result.year).toBe(1976);
  });

  it('should take the earliest date among surviving candidates', () => {
    // The whole reason MusicBrainz is used instead of Spotify's own album date.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'a',
          releaseGroupId: 'rg-a',
          releaseGroupFirstReleaseDate: '2011-05-04',
        }),
        candidate({
          recordingId: 'b',
          releaseGroupId: 'rg-b',
          releaseGroupFirstReleaseDate: '1975-11-21',
        }),
        candidate({
          recordingId: 'c',
          releaseGroupId: 'rg-c',
          releaseGroupFirstReleaseDate: '1991-09-24',
        }),
      ],
      OFFICIAL,
    );

    expect(result.year).toBe(1975);
  });

  it('should ignore candidates with a missing or empty date rather than treating them as earliest', () => {
    // Directly guards the most likely silent bug in the whole plan. Missing and empty
    // `date` fields are common on bootleg and compilation releases, so a bare minimum over
    // whatever is present quietly prefers the records with the worst data.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'undated',
          releaseGroupId: 'rg-u',
          releaseGroupFirstReleaseDate: undefined,
        }),
        candidate({
          recordingId: 'empty',
          releaseGroupId: 'rg-e',
          releaseGroupFirstReleaseDate: '',
        }),
        candidate({
          recordingId: 'blank',
          releaseGroupId: 'rg-b',
          releaseGroupFirstReleaseDate: '   ',
        }),
        candidate({
          recordingId: 'dated',
          releaseGroupId: 'rg-d',
          releaseGroupFirstReleaseDate: '1987-07-21',
        }),
      ],
      OFFICIAL,
    );

    expect(result.year).toBe(1987);
    expect(result.confidence).toBe('high');
  });

  it('should compare dates of differing granularity correctly', () => {
    // A bare "1975" means "some time in 1975" and is earlier-or-equal to "1975-11-21".
    // Treating it as later would let a precisely-dated reissue beat a coarsely-dated original.
    const coarseFirst = pickBestRecording(
      [
        candidate({
          recordingId: 'precise',
          releaseGroupId: 'rg-p',
          releaseGroupFirstReleaseDate: '1975-11-21',
        }),
        candidate({
          recordingId: 'coarse',
          releaseGroupId: 'rg-c',
          releaseGroupFirstReleaseDate: '1975',
        }),
      ],
      OFFICIAL,
    );
    expect(coarseFirst.year).toBe(1975);

    const acrossYears = pickBestRecording(
      [
        candidate({
          recordingId: 'early',
          releaseGroupId: 'rg-e',
          releaseGroupFirstReleaseDate: '1969-12',
        }),
        candidate({
          recordingId: 'late',
          releaseGroupId: 'rg-l',
          releaseGroupFirstReleaseDate: '1970',
        }),
      ],
      OFFICIAL,
    );
    expect(acrossYears.year).toBe(1969);
  });

  it('should use duration to break a tie between studio and extended versions', () => {
    // The ~3:42 studio versus ~6:35 live "No Woman No Cry" case. The extended take is the
    // EARLIER release here, so without the duration preference it would win on date alone.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'extended',
          releaseGroupId: 'rg-ext',
          lengthMs: 395_000,
          releaseGroupFirstReleaseDate: '1973',
        }),
        candidate({
          recordingId: 'studio',
          releaseGroupId: 'rg-studio',
          lengthMs: 222_000,
          releaseGroupFirstReleaseDate: '1974',
        }),
      ],
      { artist: 'A Band', durationMs: 225_000, tier: 'official-release' },
    );

    expect(result.year).toBe(1974);
  });

  it('should not let duration override the release-group filter', () => {
    // Precedence: the duration preference only ever NARROWS a set the filter already
    // produced, so a perfectly-matching bootleg cannot beat a correctly filtered album.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'bootleg',
          releaseGroupId: 'rg-boot',
          releaseStatus: 'Bootleg',
          lengthMs: 225_000,
          releaseGroupFirstReleaseDate: '1970',
        }),
        candidate({
          recordingId: 'studio',
          releaseGroupId: 'rg-studio',
          lengthMs: 400_000,
          releaseGroupFirstReleaseDate: '1974',
        }),
      ],
      { artist: 'A Band', durationMs: 225_000, tier: 'official-release' },
    );

    expect(result.year).toBe(1974);
  });

  it('should exclude candidates whose artist credit does not match', () => {
    // The cover-versus-original separation Phase 0 measured as reliable (0 of 6 lookups
    // cross-contaminated), using the Hallelujah pair.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'cohen',
          artistCredit: 'Leonard Cohen',
          releaseGroupId: 'rg-cohen',
          releaseGroupFirstReleaseDate: '1984',
        }),
        candidate({
          recordingId: 'buckley',
          artistCredit: 'Jeff Buckley',
          releaseGroupId: 'rg-buckley',
          releaseGroupFirstReleaseDate: '1994',
        }),
      ],
      { artist: 'Jeff Buckley', tier: 'official-release' },
    );

    expect(result.year).toBe(1994);
  });

  it('should match a collaboration credit whose connector or order differs', () => {
    // THE 2026-08-11 FIX. All four shapes are real credits from cards that were DROPPED from
    // a real deck: Spotify joins collaborators with ", " while MusicBrainz uses a joinphrase,
    // so the two disagree about the connector AND the order. Every one of these fails the
    // exact rule's contiguous-run test.
    //
    // Note the last two are pure REORDERING, which is why normalising join words away while
    // keeping contiguity was measured and rejected — it recovers only the middle two.
    for (const [artist, credit] of [
      ['Shakira, Burna Boy', 'Shakira x Burna Boy'],
      ['Dave, Tems', 'Dave feat. Tems'],
      ['Natanael Cano, Gabito Ballesteros', 'Natanael Cano feat. Gabito Ballesteros'],
      ['Dave, Tems', 'Tems & Dave'],
      ['Xavi, De La Rose', 'De La Rose & Xavi'],
    ] as const) {
      const result = pickBestRecording([candidate({ artistCredit: credit })], {
        artist,
        tier: 'official-release',
      });

      expect(result.year, `${artist} | ${credit}`).toBe(1975);
      // Capped at `low` even on the top rung: the credit did not say what was asked for.
      expect(result.confidence, `${artist} | ${credit}`).toBe('low');
    }
  });

  it('should never report high confidence on any rung when the artist match was loosened', () => {
    // Loops the exported ladder rather than naming rungs, so a fourth rung added later
    // inherits the cap without anyone remembering to come back here.
    for (const tier of YEAR_TIER_ORDER) {
      const result = pickBestRecording([candidate({ artistCredit: 'Shakira feat. Burna Boy' })], {
        artist: 'Shakira, Burna Boy',
        tier,
      });

      expect(result.confidence, tier).not.toBe('high');
    }
  });

  it('should treat the loose artist match as a fallback, never as a widening', () => {
    // THE TEST THAT STOPS THE OBVIOUS SIMPLIFICATION. Collapsing `admitByArtist` into one
    // union filter looks equivalent and is not: step 5 is earliest-wins, so the loose-only
    // candidate's 1984 would beat the exact match's 1994 and the year would move.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'exact',
          releaseGroupId: 'rg-exact',
          artistCredit: 'Jeff Buckley',
          releaseGroupFirstReleaseDate: '1994',
        }),
        candidate({
          recordingId: 'loose',
          releaseGroupId: 'rg-loose',
          artistCredit: 'Buckley Jeff',
          releaseGroupFirstReleaseDate: '1984',
        }),
      ],
      { artist: 'Jeff Buckley', tier: 'official-release' },
    );

    expect(result).toEqual({ year: 1994, confidence: 'high', source: 'release-group' });
  });

  it('should keep the loose artist match stingy', () => {
    // The fallback fires exactly when the requested artist is unrecognisable in the pool, so
    // a false positive puts a plausible WRONG year on a card whose whole content is the year.
    // Both guards were measured to cost none of the five real recoveries above.
    for (const [artist, credit, why] of [
      // Guard 1 — two real words. "The <Noun>" is one word plus a free article.
      ['The Band', 'The Steve Miller Band', 'article does not count toward the minimum'],
      ['The Band', 'The E Street Band', 'article does not count toward the minimum'],
      // Guard 2 — at most one word of slack. Modern credits reuse a tiny vocabulary.
      ['Lil Baby', 'Lil Durk, Lil Uzi Vert & Baby Keem', 'scattered tokens in a long credit'],
      ['Young Thug', 'Young Dolph, Key Glock & Slim Thug', 'scattered tokens in a long credit'],
      // Still disjoint, so still excluded — the cover-versus-original guarantee is untouched.
      ['Jeff Buckley', 'Leonard Cohen', 'token-disjoint names can never bridge'],
    ] as const) {
      const result = pickBestRecording([candidate({ artistCredit: credit })], {
        artist,
        tier: 'unfiltered',
      });

      expect(result, `${artist} | ${credit} — ${why}`).toEqual({
        year: null,
        confidence: 'none',
        reason: 'no-candidates',
      });
    }
  });

  it('should pin that the loose artist match is order-blind', () => {
    // The accepted trade-off, asserted as CURRENT BEHAVIOUR rather than pretended away: a
    // token bag cannot tell "Alice Cooper" from "Cooper Alice". Pinned so that an
    // order-sensitive rewrite announces itself by failing here instead of silently changing
    // accuracy. It is bounded — it fires only for a card that was about to be dropped, and
    // the answer is capped at `low`.
    const result = pickBestRecording([candidate({ artistCredit: 'Cooper Alice' })], {
      artist: 'Alice Cooper',
      tier: 'official-release',
    });

    expect(result.year).toBe(1975);
    expect(result.confidence).toBe('low');
  });

  it('should never reach the loose artist match on any accuracy fixture', () => {
    // THE SAFETY PROPERTY, as a test rather than a claim. The loose pass runs only when the
    // exact pool is empty, so proving every fixture has a non-empty exact pool proves this
    // change cannot move any of the known-good years.
    //
    // Worth knowing WHY that is not circular: the fixtures were trimmed keeping candidates
    // per accepted release group plus representatives of distinct EXCLUSION reasons, and
    // "excluded by artist credit" was never one of them — so the accuracy suite is
    // structurally blind to artist matching and cannot be the evidence here. This can.
    for (const fixture of [...YEAR_FIXTURES, ...YEAR_LIMITATION_FIXTURES]) {
      const requested = normalizeForCacheKey(fixture.artist);
      const exact = fixture.candidates.filter((c) => artistMatchesExact(requested, c.artistCredit));

      expect(exact.length, `${fixture.key}: exact pool must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('should match an artist credit that merely contains the requested name', () => {
    // Both containment directions are load-bearing: Spotify says "Jimi Hendrix" where
    // MusicBrainz says "The Jimi Hendrix Experience".
    const result = pickBestRecording(
      [
        candidate({
          artistCredit: 'The Jimi Hendrix Experience',
          releaseGroupFirstReleaseDate: '1968',
        }),
      ],
      { artist: 'Jimi Hendrix', tier: 'official-release' },
    );

    expect(result.year).toBe(1968);
  });

  it('should take a single release group over the album that later carried the song', () => {
    // THE 2026-08-11 FIX, stated as directly as it can be. This is the Creep / Personal Jesus
    // / Mr. Brightside shape: the song came out as a single first, and the album's
    // first-release-date is the year the track was INCLUDED on a record, not the year it was
    // released. Under `primary-type: Album` alone the single was invisible and this returned
    // 1993.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'single',
          releaseGroupId: 'rg-single',
          releaseGroupPrimaryType: 'Single',
          releaseGroupFirstReleaseDate: '1992-09-21',
        }),
        candidate({
          recordingId: 'album',
          releaseGroupId: 'rg-album',
          releaseGroupFirstReleaseDate: '1993-02-22',
        }),
      ],
      OFFICIAL,
    );

    expect(result).toEqual({ year: 1992, confidence: 'high', source: 'release-group' });
  });

  it('should accept an EP release group', () => {
    const result = pickBestRecording(
      [candidate({ releaseGroupPrimaryType: 'EP', releaseGroupFirstReleaseDate: '1979' })],
      OFFICIAL,
    );

    expect(result.year).toBe(1979);
    expect(result.confidence).toBe('high');
  });

  it('should not let a reissue single beat the album it postdates', () => {
    // The other half of the widening, and the reason it is safe: earliest-wins means a later
    // single can never win. Billie Jean's single is January 1983 over a November 1982 album,
    // and the fixture suite pins that it still resolves to 1982.
    const result = pickBestRecording(
      [
        candidate({
          recordingId: 'album',
          releaseGroupId: 'rg-album',
          releaseGroupFirstReleaseDate: '1982-11-30',
        }),
        candidate({
          recordingId: 'single',
          releaseGroupId: 'rg-single',
          releaseGroupPrimaryType: 'Single',
          releaseGroupFirstReleaseDate: '1983-01-02',
        }),
      ],
      OFFICIAL,
    );

    expect(result.year).toBe(1982);
  });

  it('should return high confidence from the official-release tier', () => {
    const result = pickBestRecording([candidate()], OFFICIAL);

    expect(result).toEqual({ year: 1975, confidence: 'high', source: 'release-group' });
  });

  it('should return low confidence from the unfiltered tier', () => {
    // What lets the reveal-side year UI flag a year as worth checking.
    const result = pickBestRecording(
      [candidate({ recordingFirstReleaseDate: '1975', releaseGroupFirstReleaseDate: undefined })],
      UNFILTERED,
    );

    expect(result).toEqual({ year: 1975, confidence: 'low', source: 'recording' });
  });

  it('should fall through to a lower tier when the official filters exclude everything', () => {
    // The tier transition -- the case the non-existent Spotify-year fallback was supposed
    // to handle. This is the "Like a Rolling Stone" shape.
    const candidates = [
      candidate({
        releaseGroupSecondaryTypes: ['Live'],
        recordingFirstReleaseDate: '1966',
        releaseGroupFirstReleaseDate: '1966',
      }),
    ];

    expect(pickBestRecording(candidates, OFFICIAL)).toEqual({
      year: null,
      confidence: 'none',
      reason: 'no-dated-candidates',
    });
    // The middle rung refuses it too -- a Live release group is misleading evidence, not thin
    // evidence, and that distinction is the whole reason the rung exists.
    expect(pickBestRecording(candidates, STUDIO)).toEqual({
      year: null,
      confidence: 'none',
      reason: 'no-dated-candidates',
    });
    expect(pickBestRecording(candidates, UNFILTERED)).toEqual({
      year: 1966,
      confidence: 'low',
      source: 'recording',
    });
  });

  it('should keep the secondary-type exclusion on the studio-release tier', () => {
    // THE FIX FOR UNRELIABLE `low` ANSWERS. Before the middle rung existed, the ladder went
    // straight from "official original release" to NO FILTER, so a live take or a compilation
    // dated the card whenever the top rung missed. Each of these is EARLIER than the studio
    // release and each must still lose.
    const candidates = [
      candidate({
        recordingId: 'live',
        releaseGroupId: 'rg-live',
        releaseGroupSecondaryTypes: ['Live'],
        recordingFirstReleaseDate: '1969',
      }),
      candidate({
        recordingId: 'comp',
        releaseGroupId: 'rg-comp',
        releaseGroupSecondaryTypes: ['Compilation'],
        recordingFirstReleaseDate: '1968',
      }),
      candidate({
        recordingId: 'boot',
        releaseGroupId: 'rg-boot',
        releaseStatus: 'Bootleg',
        recordingFirstReleaseDate: '1967',
      }),
      candidate({
        recordingId: 'studio',
        releaseGroupId: 'rg-studio',
        // No release-group date: this candidate is exactly the kind the adapter did not spend
        // its second request on, which is why the rung reads the recording date as well.
        releaseGroupFirstReleaseDate: undefined,
        releaseStatus: 'Promotion',
        recordingFirstReleaseDate: '1971',
      }),
    ];

    expect(pickBestRecording(candidates, STUDIO)).toEqual({
      year: 1971,
      confidence: 'low',
      source: 'release-group',
    });

    // And the proof that the rung is doing the work: unfiltered takes the bootleg's 1967.
    expect(pickBestRecording(candidates, UNFILTERED).year).toBe(1967);
  });

  it('should let the studio-release tier date a candidate the official tier refuses', () => {
    // A promo pressing with no primary type at all. The top rung requires both, so before the
    // middle rung this went straight to the unfiltered pass.
    const result = pickBestRecording(
      [
        candidate({
          releaseGroupPrimaryType: undefined,
          releaseStatus: 'Promotion',
          releaseGroupFirstReleaseDate: '1984',
        }),
      ],
      STUDIO,
    );

    expect(result).toEqual({ year: 1984, confidence: 'low', source: 'release-group' });
  });

  it('should return a null year with a reason when no candidate has a date', () => {
    // The reason must distinguish "nothing matched at all" from "things matched but none
    // were dated" -- the two point at completely different fixes.
    expect(pickBestRecording([], UNFILTERED)).toEqual({
      year: null,
      confidence: 'none',
      reason: 'no-candidates',
    });

    expect(
      pickBestRecording([candidate({ artistCredit: 'Someone Else Entirely' })], UNFILTERED),
    ).toEqual({ year: null, confidence: 'none', reason: 'no-candidates' });

    expect(
      pickBestRecording(
        [
          candidate({
            recordingFirstReleaseDate: undefined,
            releaseGroupFirstReleaseDate: undefined,
            releaseDate: undefined,
          }),
        ],
        UNFILTERED,
      ),
    ).toEqual({ year: null, confidence: 'none', reason: 'no-dated-candidates' });
  });

  it('should reject an implausible year', () => {
    // The final sanity guard against a corrupt date. Note the upper bound is NEXT year,
    // not this one: MusicBrainz carries announced release dates before the record ships.
    const nextYear = new Date().getUTCFullYear() + 1;

    expect(
      pickBestRecording([candidate({ releaseGroupFirstReleaseDate: '1832' })], OFFICIAL).year,
    ).toBeNull();
    expect(
      pickBestRecording([candidate({ releaseGroupFirstReleaseDate: '2999' })], OFFICIAL).year,
    ).toBeNull();
    expect(
      pickBestRecording([candidate({ releaseGroupFirstReleaseDate: 'not-a-date' })], OFFICIAL).year,
    ).toBeNull();
    expect(
      pickBestRecording([candidate({ releaseGroupFirstReleaseDate: String(nextYear) })], OFFICIAL)
        .year,
    ).toBe(nextYear);
  });

  it('should ignore the inlined release date, which is the reissue date', () => {
    // The single most reversion-prone rule in the module: the release date sits in the same
    // object as the release-group date and is wrong by decades. Measured 2026-08-04 --
    // Billie Jean 1982 -> 2012, Bohemian Rhapsody 1975 -> 2001, Layla 1970 -> 1990.
    const result = pickBestRecording(
      [candidate({ releaseGroupFirstReleaseDate: '1982-11-30', releaseDate: '2012-09-18' })],
      OFFICIAL,
    );

    expect(result.year).toBe(1982);
  });

  it('should resolve each known-tricky track to its verified year', () => {
    // THE ACCURACY TEST. Phase 0 measured a naive top-scored lookup at ~6% (1 of 18); this
    // suite is the evidence that the pipeline beats it, and the thing that catches a
    // regression in scoring. Expected years are ground truth, not code output.
    //
    // Every one resolves on the TOP rung, which is the second claim being made here: the
    // seven single-before-album tracks are not rescued by a lower rung reporting `low`, they
    // are answered with `high` confidence from a release group's own first-release-date.
    const failures: string[] = [];

    for (const fixture of YEAR_FIXTURES) {
      const result = pickBestRecording(fixture.candidates, {
        artist: fixture.artist,
        durationMs: fixture.durationMs,
        tier: 'official-release',
      });

      if (result.year !== fixture.expectedYear || result.confidence !== 'high') {
        failures.push(
          `${fixture.title} — ${fixture.artist}: expected ${fixture.expectedYear} (high), got ${result.year} (${result.confidence})`,
        );
      }
    }

    expect(failures).toEqual([]);
    expect(YEAR_FIXTURES).toHaveLength(21);
  });

  it('should pin the year a recording-scoped lookup cannot reach', () => {
    // NOT an aspiration. `resolvesTo` is what the ladder returns today and `expectedYear` is
    // the truth it provably cannot get to: the 1989 single carries a different RECORDING from
    // the album version, so no filter widening and no duration bound can put the two in one
    // pool. See the block comment on `LimitationFixture`.
    //
    // Pinned so that a future work-level lookup announces itself by failing this test, rather
    // than quietly agreeing with a number nobody re-checked.
    for (const fixture of YEAR_LIMITATION_FIXTURES) {
      const result = pickBestRecording(fixture.candidates, {
        artist: fixture.artist,
        durationMs: fixture.durationMs,
        tier: 'official-release',
      });

      expect(result.year, fixture.key).toBe(fixture.resolvesTo);
      expect(fixture.resolvesTo, fixture.key).not.toBe(fixture.expectedYear);
    }

    expect(YEAR_LIMITATION_FIXTURES).toHaveLength(1);
  });
});
