/**
 * The real coverage of the suggestion multi-select.
 *
 * No docblock environment override, so this runs in the default NODE environment -- which is the
 * point. Every rule the feature has is asserted here, with no DOM, no React and no pointer: what a
 * component test could see is a highlight and a box, and both of those are downstream of these
 * three functions. See the header of `playlist-selection.ts` for why that split is the design.
 *
 * The IDs below are real 22-character Spotify ids so `parsePlaylistUrl` accepts them, and they are
 * deliberately NOT imported from `SUGGESTED_PLAYLISTS`: that array is edited on request, and a
 * test that moved with it would stop pinning anything. Nothing here depends on them naming a
 * playlist that exists.
 */

import { describe, expect, it } from 'vitest';

import { planSelectionToggle, selectedPlaylistIds, suggestionIntent } from './playlist-selection';
import { spotifyPlaylistUrl } from '../../shared/spotify-url';

const ID_A = '34cIJlWIX9TEoA8bpI2UBu';
const ID_B = '0Bq6Ofk5drHQKzevbnPzW2';
const ID_C = '4wZA7zbfDuTi9yqZy8WY4y';

const URL_A = spotifyPlaylistUrl(ID_A);
const URL_B = spotifyPlaylistUrl(ID_B);

describe('selectedPlaylistIds', () => {
  it('should find nothing in an empty form', () => {
    // The pristine landing screen: one blank row. `isSelecting` is false here, which is what
    // keeps the one-click demo path alive.
    expect(selectedPlaylistIds([''])).toEqual(new Set());
  });

  it('should find the playlist a canonical row holds', () => {
    expect(selectedPlaylistIds([URL_A])).toEqual(new Set([ID_A]));
  });

  it('should recognise every form a player can paste', () => {
    // The reason this parses instead of string-comparing against `spotifyPlaylistUrl(id)`. Each
    // of these names ID_A, and none of them is that canonical string -- the `?si=` tail is what
    // Spotify's own share button produces, so it is the COMMONEST paste of all.
    const pasted = [
      `https://open.spotify.com/playlist/${ID_A}?si=abc123`,
      `https://open.spotify.com/intl-es/playlist/${ID_A}`,
      `spotify:playlist:${ID_A}`,
      ID_A,
    ];

    for (const value of pasted) {
      expect(selectedPlaylistIds([value])).toEqual(new Set([ID_A]));
    }
  });

  it('should ignore blank, whitespace and unparseable rows', () => {
    // None of these is a playlist, and none of them may highlight a suggestion. The Apple Music
    // link is the shape a player actually pastes by mistake.
    expect(
      selectedPlaylistIds(['', '   ', 'https://music.apple.com/playlist/whatever', 'not a url']),
    ).toEqual(new Set());
  });

  it('should not recognise a spotify.link short URL', () => {
    // It carries no playlist id at all -- only the server's redirect can resolve one -- so the
    // honest answer is "not selected". The row still submits and still deals a deck; it is the
    // HIGHLIGHT that cannot be known here, and guessing would be worse than leaving it off.
    expect(selectedPlaylistIds(['https://spotify.link/aBcDeF12345'])).toEqual(new Set());
  });

  it('should find every playlist across several rows', () => {
    expect(selectedPlaylistIds([URL_A, 'typed nonsense', URL_B])).toEqual(new Set([ID_A, ID_B]));
  });
});

describe('planSelectionToggle', () => {
  it('should fill the blank starting row rather than appending beside it', () => {
    // The very first selection on a pristine screen. Appending here would leave the empty
    // starting row above the new one, and the form would grow a hole per press.
    expect(planSelectionToggle([''], ID_A, 5)).toEqual({
      action: 'add',
      url: URL_A,
      intoIndex: 0,
    });
  });

  it('should fill the FIRST blank row when there are several', () => {
    expect(planSelectionToggle([URL_A, '', '  '], ID_B, 5)).toEqual({
      action: 'add',
      url: URL_B,
      intoIndex: 1,
    });
  });

  it('should append when every row is spoken for', () => {
    // `intoIndex: null` is the append instruction. The typed row is untouched, which is the
    // promise the whole feature rests on.
    expect(planSelectionToggle(['https://open.spotify.com/playlist/' + ID_C], ID_A, 5)).toEqual({
      action: 'add',
      url: URL_A,
      intoIndex: null,
    });
  });

  it('should remove the row holding a playlist that is already selected', () => {
    // Pressing a selected suggestion again is one of the two documented ways to deselect; the
    // other is the row's own ✕, which needs no plan because the selection is derived.
    expect(planSelectionToggle([URL_B, URL_A], ID_A, 5)).toEqual({
      action: 'remove',
      atIndex: 1,
    });
  });

  it('should remove a playlist pasted in a non-canonical form', () => {
    // Deselecting has to recognise exactly what selecting recognised, or a suggestion becomes
    // highlighted and unremovable.
    expect(
      planSelectionToggle([`https://open.spotify.com/playlist/${ID_A}?si=xyz`], ID_A, 5),
    ).toEqual({ action: 'remove', atIndex: 0 });
  });

  it('should remove the first of two rows naming the same playlist', () => {
    expect(planSelectionToggle([URL_A, URL_A], ID_A, 5)).toEqual({ action: 'remove', atIndex: 0 });
  });

  it('should refuse to add beyond the cap', () => {
    // At the cap with no blank row there is nowhere for the selection to go. The landing screen
    // is already showing its "N playlists is the maximum for one deck" hint in this state, which
    // is why this returns a no-op rather than a message.
    expect(planSelectionToggle([URL_A, URL_B], ID_C, 2)).toEqual({ action: 'at-cap' });
  });

  it('should still add at one row below the cap', () => {
    // The other side of the same boundary, so an off-by-one in either direction fails a test.
    expect(planSelectionToggle([URL_A], ID_C, 2)).toEqual({
      action: 'add',
      url: spotifyPlaylistUrl(ID_C),
      intoIndex: null,
    });
  });

  it('should fill a blank row even at the cap', () => {
    // The cap counts ROWS, and question 2 runs before question 3: a player holding five rows
    // with one still empty can select into it. Appending is what the cap forbids, not selecting.
    expect(planSelectionToggle([URL_A, ''], ID_C, 2)).toEqual({
      action: 'add',
      url: spotifyPlaylistUrl(ID_C),
      intoIndex: 1,
    });
  });

  it('should always allow a deselect at the cap', () => {
    // Otherwise a full form is a trap: nothing can be removed and nothing can be added.
    expect(planSelectionToggle([URL_A, URL_B], ID_B, 2)).toEqual({
      action: 'remove',
      atIndex: 1,
    });
  });
});

describe('suggestionIntent', () => {
  it('should start a game on a plain press with nothing selected', () => {
    // The one-click demo path, and the only combination that produces `start`.
    expect(suggestionIntent({ wasLongPress: false, hasModifier: false, isSelecting: false })).toBe(
      'start',
    );
  });

  it('should toggle for each of the three explicit signals on its own', () => {
    const signals = ['wasLongPress', 'hasModifier', 'isSelecting'] as const;

    for (const signal of signals) {
      expect(
        suggestionIntent({
          wasLongPress: false,
          hasModifier: false,
          isSelecting: false,
          [signal]: true,
        }),
      ).toBe('toggle');
    }
  });

  it('should toggle for every combination of the three signals', () => {
    // The full truth table, minus the all-false row asserted above: seven of eight inputs mean
    // "select". Written as a sweep rather than seven cases so a fourth signal cannot be added
    // without this failing.
    for (let bits = 1; bits < 8; bits += 1) {
      expect(
        suggestionIntent({
          wasLongPress: (bits & 1) !== 0,
          hasModifier: (bits & 2) !== 0,
          isSelecting: (bits & 4) !== 0,
        }),
      ).toBe('toggle');
    }
  });
});
