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
  withoutTrailingPeriod,
} from './playlist-display-name';

describe('withoutTrailingPeriod', () => {
  it('should drop one trailing full stop, ignoring trailing whitespace', () => {
    expect(withoutTrailingPeriod('Openings Català.')).toBe('Openings Català');
    expect(withoutTrailingPeriod('Openings Català. ')).toBe('Openings Català');
  });

  it('should drop a stop added after an ordinary word, a number or a symbol', () => {
    expect(withoutTrailingPeriod('Hits 2024.')).toBe('Hits 2024');
    expect(withoutTrailingPeriod('Rock & Roll.')).toBe('Rock & Roll');
    expect(withoutTrailingPeriod('Èxits dels 80.')).toBe('Èxits dels 80');
  });

  it('should leave an ellipsis, an inner stop and a bare stop alone', () => {
    expect(withoutTrailingPeriod('Greatest Hits...')).toBe('Greatest Hits...');
    expect(withoutTrailingPeriod('Vol. 2')).toBe('Vol. 2');
    expect(withoutTrailingPeriod('.')).toBe('.');
  });

  it('should keep a stop that belongs to the name', () => {
    expect(withoutTrailingPeriod('Grandes Éxitos Vol.')).toBe('Grandes Éxitos Vol.');
    expect(withoutTrailingPeriod('Daft Punk feat.')).toBe('Daft Punk feat.');
    expect(withoutTrailingPeriod('Martin Luther King Jr.')).toBe('Martin Luther King Jr.');
    expect(withoutTrailingPeriod('Vitamin C.')).toBe('Vitamin C.');
    expect(withoutTrailingPeriod('Born in the U.S.A.')).toBe('Born in the U.S.A.');
    expect(withoutTrailingPeriod('Música Núm.')).toBe('Música Núm.');
  });
});

describe('playlistDisplayName', () => {
  it('should show the app label instead of the fetched title for an overridden id', () => {
    expect(playlistDisplayName({ id: JITSTER_OFFICIAL_PLAYLIST_ID, name: 'Hitser' })).toBe(
      PLAYLIST_NAME_OVERRIDES[JITSTER_OFFICIAL_PLAYLIST_ID],
    );
  });

  it('should show the fetched title for any other playlist', () => {
    expect(playlistDisplayName({ id: 'someOtherId', name: 'Rock Classics' })).toBe('Rock Classics');
  });

  it('should show the fetched title without its trailing full stop', () => {
    expect(playlistDisplayName({ id: 'someOtherId', name: 'Openings Català.' })).toBe(
      'Openings Català',
    );
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
