import { describe, expect, it } from 'vitest';

import * as constants from './constants';
import { MAX_EMBED_TRACKS } from './constants';

describe('shared/constants', () => {
  it('should expose MAX_EMBED_TRACKS as 100', () => {
    // The Phase 0 spike established this by observing real truncation: a playlist
    // holding 200 tracks returned exactly 100 trackList entries.
    expect(MAX_EMBED_TRACKS).toBe(100);
  });

  it('should type MAX_EMBED_TRACKS as a number', () => {
    // Guards against a typo like `'100'`, which would silently break Phase 2's
    // `trackList.length === MAX_EMBED_TRACKS` truncation comparison.
    expect(typeof MAX_EMBED_TRACKS).toBe('number');
    expect(Number.isInteger(MAX_EMBED_TRACKS)).toBe(true);
  });

  it('should resolve imports from the shared directory inside a test', () => {
    // Covers the tsconfig/Vitest resolution wiring itself rather than any logic.
    // If this fails, every later phase's tests fail for the same reason, so it is
    // worth asserting explicitly instead of inferring it from the tests above.
    expect(constants).toBeTypeOf('object');
    expect(Object.hasOwn(constants, 'MAX_EMBED_TRACKS')).toBe(true);
  });
});
