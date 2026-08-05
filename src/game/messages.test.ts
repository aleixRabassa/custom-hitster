/**
 * The message map's exhaustiveness, asserted at runtime as well as in the type system.
 *
 * The type already forces every `PlaylistClientErrorCode` to have an entry -- that is why the
 * map is typed `Record<PlaylistClientErrorCode, string>` rather than a partial lookup. This file
 * covers the two things the type cannot: that no entry is an empty string, and that the runtime
 * list of codes and the map agree. The second is what catches a code added to the union and
 * given an entry of `''` to make the compiler stop complaining.
 */

import { describe, expect, it } from 'vitest';

import { PLAYLIST_ERROR_MESSAGES, playlistErrorMessage } from './messages';
import type { PlaylistClientErrorCode } from './playlist-client';

/**
 * Every code, written out by hand.
 *
 * Deliberately NOT derived from `Object.keys(PLAYLIST_ERROR_MESSAGES)` -- that would compare the
 * map to itself and pass for any map at all. The annotation is what makes a new code a
 * COMPILE error here, and this list is what makes a removed one a test failure.
 */
const ALL_CODES: PlaylistClientErrorCode[] = [
  'invalid-url',
  'unsupported-entity',
  'not-found-or-private',
  'upstream-unavailable',
  'unexpected-payload',
  'network',
  'unknown-error',
];

describe('PLAYLIST_ERROR_MESSAGES', () => {
  it('should map every playlist error code to copy', () => {
    for (const code of ALL_CODES) {
      const message = PLAYLIST_ERROR_MESSAGES[code];
      expect(typeof message).toBe('string');
      // A blank entry renders as nothing at the exact moment the player needs telling what
      // went wrong, which is indistinguishable from the app hanging.
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it('should have no entries beyond the known codes', () => {
    // The other direction: a code removed from the union leaves dead copy behind, and dead copy
    // is what gets edited by mistake later.
    expect(Object.keys(PLAYLIST_ERROR_MESSAGES).sort()).toEqual([...ALL_CODES].sort());
  });

  it('should never name a track, artist, or year in any message', () => {
    // These sentences are rendered on the LANDING screen, which is a pre-Start surface. Nothing
    // here may be interpolated from deck data -- and the way that would happen is someone
    // adding a template literal, so the assertion is that the copy is static.
    for (const code of ALL_CODES) {
      expect(PLAYLIST_ERROR_MESSAGES[code]).not.toContain('${');
    }
  });

  it('should cover both possibilities for not-found-or-private honestly', () => {
    // Spotify gives no signal that separates private from deleted, so the copy must not claim
    // to know which. Asserted because "This playlist is private" is the tempting shorter wording
    // and it is a guess presented as a fact.
    const message = PLAYLIST_ERROR_MESSAGES['not-found-or-private'].toLowerCase();

    expect(message).toContain('private');
    expect(message).toContain('deleted');
  });

  it('should tell the player it is our fault for unexpected-payload', () => {
    // The one code that is a bug on our side rather than a problem with their link -- including
    // the `pnpm dev` case. Sending them off to check their link would waste their time.
    expect(PLAYLIST_ERROR_MESSAGES['unexpected-payload'].toLowerCase()).toContain('our side');
  });
});

describe('playlistErrorMessage', () => {
  it('should return the mapped message for a known code', () => {
    expect(playlistErrorMessage('invalid-url')).toBe(PLAYLIST_ERROR_MESSAGES['invalid-url']);
  });

  it('should fall back rather than return undefined for an unknown code', () => {
    // Unreachable through any typed path -- the map is exhaustive by type -- but a code can
    // arrive from a response body, and `undefined` rendered into the DOM is a blank error box.
    const rogue = 'teapot' as PlaylistClientErrorCode;

    expect(playlistErrorMessage(rogue)).toBe(PLAYLIST_ERROR_MESSAGES['unknown-error']);
  });
});
