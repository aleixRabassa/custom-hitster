import { describe, expect, it } from 'vitest';

import {
  STORE_MATCH_RULES,
  earliestVerifiedRow,
  failedStoreRules,
  isVerifiedStoreRow,
  storeRowYear,
} from './store-match';
import type { DatedStoreRow, StoreTarget } from './store-match';
import { DURATION_TOLERANCE_MS } from './year';

// Synthetic rows: each test changes ONE field of a row that otherwise passes, so a failure
// names the rule rather than a coincidence. The captured-row mutation guard -- "dropping this
// rule changes a REAL answer" -- lives in `api/_lib/year-votes.test.ts`, because the captured
// payloads are Node-side fixtures a `shared/` test may not import.

const TARGET: StoreTarget = {
  rawTitle: 'Hotel California - 2013 Remaster',
  primaryArtist: 'Eagles',
  durationMs: 391_376,
};

function row(overrides: Partial<DatedStoreRow> = {}): DatedStoreRow {
  return {
    titles: ['Hotel California'],
    credit: 'Eagles',
    durationMs: 390_000,
    excluded: false,
    date: '1976-12-08',
    ...overrides,
  };
}

describe('failedStoreRules', () => {
  it('should verify a row that passes every rule', () => {
    expect(failedStoreRules(row(), TARGET)).toEqual([]);
    expect(isVerifiedStoreRow(row(), TARGET)).toBe(true);
  });

  describe('the title rule', () => {
    it('should compare CLEANED, normalised titles on both sides', () => {
      // The card's "- 2013 Remaster" and the store's "(Remastered)" both clean away, and case
      // and punctuation normalise, so these are the same song.
      expect(failedStoreRules(row({ titles: ['HOTEL CALIFORNIA (Remastered)'] }), TARGET)).toEqual(
        [],
      );
    });

    it('should reject a different title, including one that merely contains the card title', () => {
      expect(failedStoreRules(row({ titles: ['Hotel California Dreaming'] }), TARGET)).toEqual([
        'title',
      ]);
      expect(failedStoreRules(row({ titles: ['New Kid in Town'] }), TARGET)).toEqual(['title']);
    });

    it('should pass when ANY of the row titles matches (Deezer title and title_short)', () => {
      expect(
        failedStoreRules(row({ titles: ['Something Else Entirely', 'Hotel California'] }), TARGET),
      ).toEqual([]);
    });

    it('should never match a card whose title normalises to nothing', () => {
      const punctuation: StoreTarget = { ...TARGET, rawTitle: '!!!' };
      expect(failedStoreRules(row({ titles: ['???'] }), punctuation)).toContain('title');
    });
  });

  describe('the artist rule', () => {
    it('should pass when every token of the primary artist is in the credit, in any order', () => {
      expect(failedStoreRules(row({ credit: 'The Eagles' }), TARGET)).toEqual([]);

      const duo: StoreTarget = { ...TARGET, primaryArtist: 'Simon & Garfunkel' };
      expect(failedStoreRules(row({ credit: 'Garfunkel, Simon' }), duo)).toEqual([]);
    });

    it('should reject a credit missing any token of the primary artist', () => {
      // One-directional on purpose: the CREDIT must cover the artist. "Queen & David Bowie"
      // against a row credited "Queen" fails -- the Under Pressure null the spike measured.
      const collab: StoreTarget = { ...TARGET, primaryArtist: 'Queen & David Bowie' };
      expect(failedStoreRules(row({ credit: 'Queen' }), collab)).toEqual(['artist']);
      expect(failedStoreRules(row({ credit: 'Eagle' }), TARGET)).toEqual(['artist']);
    });

    it('should NOT treat a connector word as optional (Derek and the Dominos)', () => {
      // `&` normalises to a space, so "and" is never in a credit written with an ampersand.
      // Pinned rather than special-cased: it is the rule the spike measured (§4.1), and the
      // same null is in the captured Layla payloads.
      const derek: StoreTarget = { ...TARGET, primaryArtist: 'Derek and the Dominos' };
      expect(failedStoreRules(row({ credit: 'Derek & The Dominos' }), derek)).toEqual(['artist']);
    });

    it('should never match an artist that normalises to nothing', () => {
      const blank: StoreTarget = { ...TARGET, primaryArtist: '' };
      expect(failedStoreRules(row({ credit: 'Anyone' }), blank)).toEqual(['artist']);
    });
  });

  describe('the duration rule', () => {
    it('should pass at exactly the tolerance and fail one millisecond past it', () => {
      const at = TARGET.durationMs! + DURATION_TOLERANCE_MS;
      expect(failedStoreRules(row({ durationMs: at }), TARGET)).toEqual([]);
      expect(failedStoreRules(row({ durationMs: at + 1 }), TARGET)).toEqual(['duration']);
    });

    it('should fail a row without a duration', () => {
      // The spike's harness let a length-less iTunes row through; the plan does not.
      expect(failedStoreRules(row({ durationMs: undefined }), TARGET)).toEqual(['duration']);
    });

    it('should fail every row when the card has no duration', () => {
      expect(failedStoreRules(row(), { ...TARGET, durationMs: undefined })).toEqual(['duration']);
    });
  });

  describe('the excluded flag', () => {
    it('should fail an excluded row that otherwise passes', () => {
      expect(failedStoreRules(row({ excluded: true }), TARGET)).toEqual(['excluded']);
    });
  });

  it('should report every rule a row breaks', () => {
    expect(
      failedStoreRules(
        row({ titles: ['x'], credit: 'y', durationMs: undefined, excluded: true }),
        TARGET,
      ),
    ).toEqual(STORE_MATCH_RULES);
  });
});

describe('isVerifiedStoreRow', () => {
  it('should ignore a rule that is not in the rule list', () => {
    const liveTake = row({ durationMs: 600_000 });
    expect(isVerifiedStoreRow(liveTake, TARGET)).toBe(false);
    expect(
      isVerifiedStoreRow(
        liveTake,
        TARGET,
        STORE_MATCH_RULES.filter((rule) => rule !== 'duration'),
      ),
    ).toBe(true);
  });
});

describe('storeRowYear', () => {
  it('should read the year of every date shape and reject corrupt or implausible dates', () => {
    expect(storeRowYear('1976-12-08')).toBe(1976);
    expect(storeRowYear('1976-12')).toBe(1976);
    expect(storeRowYear('1976')).toBe(1976);
    expect(storeRowYear('0000-00-00')).toBeUndefined();
    expect(storeRowYear('')).toBeUndefined();
    expect(storeRowYear('1976-12-08T08:00:00Z')).toBeUndefined();
  });
});

describe('earliestVerifiedRow', () => {
  it('should take the EARLIEST verified row, not the first', () => {
    const remaster = row({ date: '2013-03-11' });
    const original = row({ date: '1976-12-08' });
    const result = earliestVerifiedRow([remaster, original], TARGET);

    expect(result?.year).toBe(1976);
    expect(result?.row).toBe(original);
  });

  it('should skip an earlier row that fails verification', () => {
    const cover = row({ credit: 'Gipsy Kings', date: '1990-01-01' });
    expect(earliestVerifiedRow([cover, row({ date: '2013-03-11' })], TARGET)?.year).toBe(2013);
  });

  it('should order a bare year before a precise date in the same year (compareDates)', () => {
    const precise = row({ date: '1976-12-08' });
    const bare = row({ date: '1976' });
    expect(earliestVerifiedRow([precise, bare], TARGET)?.row).toBe(bare);
  });

  it('should skip a verified row with a corrupt date rather than failing the answer', () => {
    expect(
      earliestVerifiedRow([row({ date: '0000-00-00' }), row({ date: '2013-03-11' })], TARGET)?.year,
    ).toBe(2013);
  });

  it('should return null when nothing verifies or nothing is dated', () => {
    expect(earliestVerifiedRow([], TARGET)).toBeNull();
    expect(earliestVerifiedRow([row({ excluded: true })], TARGET)).toBeNull();
    expect(earliestVerifiedRow([row({ date: '' })], TARGET)).toBeNull();
  });

  it('should let an excluded row win once the excluded rule is dropped', () => {
    // No captured row has ever carried the flag (see api/_lib/year-votes.test.ts), so this
    // synthetic case is the only proof the rule is wired into selection at all.
    const flagged = row({ excluded: true, date: '1970-01-01' });
    const rows = [flagged, row({ date: '1976-12-08' })];

    expect(earliestVerifiedRow(rows, TARGET)?.year).toBe(1976);
    expect(
      earliestVerifiedRow(
        rows,
        TARGET,
        STORE_MATCH_RULES.filter((rule) => rule !== 'excluded'),
      )?.year,
    ).toBe(1970);
  });
});
