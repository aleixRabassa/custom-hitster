/**
 * Node environment: `playlist-display-name.ts` is a lookup over data, with no DOM and no storage.
 *
 * The HUD, the end screen and the saved library all read through it, and none of them would show
 * a DOM-visible difference if the override silently stopped applying -- the deck would just read
 * "Hitser" again, which is exactly what reached the store screenshots before it existed.
 */

import { describe, expect, it } from 'vitest';

import {
  JITSTER_OFFICIAL_PLAYLIST_ID,
  PLAYLIST_NAME_OVERRIDES,
  playlistDisplayName,
} from './playlist-display-name';

describe('playlistDisplayName', () => {
  it('should show the app label instead of the fetched title for an overridden id', () => {
    expect(playlistDisplayName({ id: JITSTER_OFFICIAL_PLAYLIST_ID, name: 'Hitser' })).toBe(
      PLAYLIST_NAME_OVERRIDES[JITSTER_OFFICIAL_PLAYLIST_ID],
    );
  });

  it('should show the fetched title for any other playlist', () => {
    expect(playlistDisplayName({ id: 'someOtherId', name: 'Rock Classics' })).toBe('Rock Classics');
  });

  it('should keep the registered mark and its near-miss out of every override', () => {
    // A trademark guard over DATA, the same shape as the one over SUGGESTED_PLAYLISTS in
    // `LandingScreen.test.tsx`. `/hitst?er/` catches both "Hitster" and the Spotify title
    // "Hitser" this module exists to hide.
    for (const label of Object.values(PLAYLIST_NAME_OVERRIDES)) {
      expect(label).not.toMatch(/hitst?er/i);
    }
  });
});
