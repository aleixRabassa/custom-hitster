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
import type { StartFailureCode } from './messages';

/**
 * Every code, written out by hand.
 *
 * Deliberately NOT derived from `Object.keys(PLAYLIST_ERROR_MESSAGES)` -- that would compare the
 * map to itself and pass for any map at all. The annotation is what makes a new code a
 * COMPILE error here, and this list is what makes a removed one a test failure.
 */
const ALL_CODES: StartFailureCode[] = [
  'invalid-url',
  'unsupported-entity',
  'not-found-or-private',
  'upstream-unavailable',
  'unexpected-payload',
  'empty-playlist',
  'network',
  'offline',
  'unknown-error',
  // Not a fetch failure and not producible by `fetchPlaylist` -- the session produces it when every
  // card's year lookup comes back empty. See `StartFailureCode`.
  'no-years-found',
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

  it('should not give offline and network the same sentence', () => {
    // ===================================================================
    //  THE FAILURE MODE OF ADDING A CODE IS COPY-PASTING ITS COPY.
    //
    //  The two describe genuinely different situations -- `offline` means the
    //  browser is certain there is no connection and nothing was sent;
    //  `network` means a request was made and did not complete, which
    //  includes a captive portal that reports itself as online. Identical
    //  copy would make the new code pointless while still passing the
    //  exhaustiveness tests above, since both would be non-empty strings.
    // ===================================================================
    expect(PLAYLIST_ERROR_MESSAGES['offline']).not.toBe(PLAYLIST_ERROR_MESSAGES['network']);
  });

  it('should give every code a sentence of its own', () => {
    // ===================================================================
    //  THE GENERAL FORM OF THE TEST ABOVE, AND WHAT REPLACED SEVEN
    //  WORDING ASSERTIONS.
    //
    //  Those seven each pinned a phrase -- "private", "deleted", "no
    //  tracks", "our side", "try a playlist" -- which made the sentences
    //  expensive to reword and therefore rarely reworded. The property they
    //  were really defending is this one: a code exists BECAUSE it is a
    //  distinct situation, so two codes sharing one sentence means one of
    //  them is telling the player something that is not about their case.
    //  `empty-playlist` rendering the `unexpected-payload` apology is
    //  exactly that bug, and it shipped.
    //
    //  This holds through any rewrite. What each sentence SAYS is the
    //  developer's, and `messages.ts` carries the reasoning per code.
    // ===================================================================
    const messages = ALL_CODES.map((code) => PLAYLIST_ERROR_MESSAGES[code]);

    expect(new Set(messages).size).toBe(ALL_CODES.length);
  });
});

describe('playlistErrorMessage', () => {
  it('should return the mapped message for a known code', () => {
    expect(playlistErrorMessage('invalid-url')).toBe(PLAYLIST_ERROR_MESSAGES['invalid-url']);
  });

  it('should fall back rather than return undefined for an unknown code', () => {
    // Unreachable through any typed path -- the map is exhaustive by type -- but a code can
    // arrive from a response body, and `undefined` rendered into the DOM is a blank error box.
    const rogue = 'teapot' as StartFailureCode;

    expect(playlistErrorMessage(rogue)).toBe(PLAYLIST_ERROR_MESSAGES['unknown-error']);
  });
});
