/**
 * @vitest-environment jsdom
 *
 * What is left here after the 2026-08-06 extraction is what belongs to the END SCREEN: the count,
 * the two ways onward, and the fact that it mounts the deck actions at all. The actions' own
 * behaviour -- the clipboard fallbacks, the seed trap, the sheet count, the export statuses -- is
 * tested once, in `DeckActions.test.tsx`, because the game screen mounts the same component and a
 * copy of those assertions here would only prove the copy still exists.
 */

import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EndScreen } from './EndScreen';
import { COPY } from '../game/copy';
import { fixtureDeck } from './__fixtures__/cards';
import type { EndScreenProps } from './EndScreen';
import type { PlaylistSummary } from '../../shared/types';

const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';
const SEED = 'a1b2c3d4e5f60718';
const ORIGIN = 'https://hitster.example/';

/** A three-playlist deck, and the label `deckLabel()` derives from it. */
const THREE_PLAYLISTS: PlaylistSummary[] = [
  { id: PLAYLIST_ID, name: 'Rock Classics', owner: 'Spotify' },
  { id: '2zmXlpkOMN92NlQaE2M62c', name: 'Summer Anthems', owner: 'Someone' },
  { id: '37i9dQZF1DX1HCSfq0nSal', name: 'Late Night Drive', owner: 'Someone else' },
];

/**
 * The share props are required, so every render needs them. Defaulted here rather than repeated in
 * a dozen renders -- a test that cares about one of them overrides just that one.
 */
function renderEnd(overrides: Partial<EndScreenProps> = {}) {
  const props: EndScreenProps = {
    cardsPlayed: 42,
    playlistName: 'Rock Classics',
    // The single-playlist default, which is the shape every assertion written before
    // multi-playlist was written against.
    playlists: [{ id: PLAYLIST_ID, name: 'Rock Classics', owner: 'Spotify' }],
    onRestart: vi.fn(),
    onHome: vi.fn(),
    playlistIds: [PLAYLIST_ID],
    seed: SEED,
    shareOrigin: ORIGIN,
    onSavePlaylist: vi.fn(),
    isPlaylistSaved: false,
    // A resolved deck, so the export has something to print.
    deck: fixtureDeck.filter((card) => typeof card.year === 'number'),
    pendingYearCount: 0,
    ...overrides,
  };

  return { ...render(<EndScreen {...props} />), props };
}

describe('EndScreen', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should host the footer: positioned, with the bottom band reserved', () => {
    // The screen's half of `Footer`'s contract. The footer is `absolute bottom-8`, so this `<main>`
    // has to be `relative` (or the line anchors to the viewport instead of to this screen) and has
    // to reserve `pb-20` (or the line lands on top of the deck actions). jsdom computes no layout,
    // so the classes are the only observable end of it -- and both are easy to lose to a tidy-up of
    // the class string, which is why they are asserted here rather than trusted.
    //
    // `pb-20` rather than the old `pb-12` since 2026-08-12: the band is now the same on all four
    // screens and is sized so the line has equal air above and below it. See `Footer.tsx`.
    const { container } = renderEnd();
    const main = container.querySelector('main');

    expect(main?.className).toContain('relative');
    expect(main?.className).toContain('pb-20');
    expect(container.querySelector('footer')).not.toBeNull();
  });

  it('should render cards played and both actions', () => {
    renderEnd();

    expect(screen.getByText(COPY.end.cardsPlayed(42, 'Rock Classics'))).not.toBeNull();
    expect(screen.queryByRole('button', { name: COPY.end.restart })).not.toBeNull();
    expect(screen.queryByRole('button', { name: COPY.end.home })).not.toBeNull();
  });

  it('should use the singular for a one-card deck', () => {
    renderEnd({ cardsPlayed: 1 });

    expect(screen.getByText(COPY.end.cardsPlayed(1, 'Rock Classics'))).not.toBeNull();
  });

  it('should invoke restart and home callbacks', () => {
    const onRestart = vi.fn();
    const onHome = vi.fn();
    renderEnd({ onRestart, onHome });

    fireEvent.click(screen.getByRole('button', { name: COPY.end.restart }));
    expect(onRestart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: COPY.end.home }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('should say that a restart reshuffles', () => {
    // A player who has just heard forty songs wants to know whether "play again" means the same
    // order. It does not -- `start` with no seed generates a fresh one.
    const { container } = renderEnd();

    expect(container.textContent ?? '').toContain(COPY.end.restartDetail);
  });

  it('should mount the deck actions', () => {
    // Presence only. That these three work is `DeckActions.test.tsx`'s job; what this pins is that
    // the end screen still OFFERS them -- the natural way to break that now is an edit that drops
    // the child while the two navigation buttons keep working.
    renderEnd();

    expect(screen.queryByRole('button', { name: COPY.deckActions.copyLink })).not.toBeNull();
    expect(screen.queryByRole('button', { name: COPY.deckActions.save })).not.toBeNull();
    expect(screen.queryByRole('button', { name: COPY.deckActions.print })).not.toBeNull();
  });

  it('should give every action a focus-visible style', () => {
    // Class-name level, with the caveat given in full in `LandingScreen.test.tsx`. The count is
    // asserted as well, so a button added without a ring fails here.
    renderEnd();

    const buttons = screen.getAllByRole('button');
    // Play again, Home, Copy share link, Save this playlist, Print as PDF cards.
    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button.className).toContain('focus-visible:focus-ring');
    }
  });

  it('should show the deck label in the count line', () => {
    /*
      ONE LABEL, EVERY SURFACE (decision 8 of plan 2, decision 6 of plan 1). The count line reads
      whatever `deckLabel()` produced, so this screen, the HUD and the PDF filename cannot disagree
      about what the deck is called. The `"+N more"` shape is the label's, not this screen's -- it
      arrives as a string.
    */
    renderEnd({
      playlistName: 'Rock Classics +2 more',
      playlists: THREE_PLAYLISTS,
      playlistIds: THREE_PLAYLISTS.map((playlist) => playlist.id),
    });

    expect(screen.getByText(COPY.end.cardsPlayed(42, 'Rock Classics +2 more'))).not.toBeNull();
  });

  it('should list every playlist the deck came from', () => {
    /*
      THE ONLY SCREEN THAT GETS THE FULL LIST (decision 9). Post-game, so nothing can be spoiled by
      it, and it is the one surface with room for five names. Everywhere else -- the HUD, the
      preparing screen, the PDF filename, the saved-library row -- gets the label.
    */
    renderEnd({
      playlistName: 'Rock Classics +2 more',
      playlists: THREE_PLAYLISTS,
      playlistIds: THREE_PLAYLISTS.map((playlist) => playlist.id),
    });

    for (const playlist of THREE_PLAYLISTS) {
      expect(screen.getByText(playlist.name)).not.toBeNull();
    }
  });

  it('should not list a single playlist under its own label', () => {
    // For one playlist the label above IS its name, so a list under it would say the same thing
    // twice. The single-playlist screen is unchanged by the whole feature.
    const { container } = renderEnd();

    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('should not render any track information', () => {
    // The deck is over, so this is the ONE screen where a leak would cost nothing -- and the
    // assertion is here anyway, because "here is what you played" is the obvious thing to add and
    // Restart deals the same tracks again immediately afterwards. A track list on this screen would
    // spoil the rematch.
    //
    // Re-run with the full playlist list on screen, which is the one thing multi-playlist added
    // here: a `PlaylistSummary` carries an id and a name and no track data, so the list is safe --
    // but it is a new place a card could be rendered from if anyone widened that type.
    const { container } = renderEnd({
      deck: fixtureDeck,
      playlistName: 'Rock Classics +2 more',
      playlists: THREE_PLAYLISTS,
      playlistIds: THREE_PLAYLISTS.map((playlist) => playlist.id),
    });
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
      if (typeof card.year === 'number') expect(text).not.toContain(String(card.year));
    }
  });
});
