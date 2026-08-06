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
import { fixtureDeck } from './__fixtures__/cards';
import type { EndScreenProps } from './EndScreen';

const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';
const SEED = 'a1b2c3d4e5f60718';
const ORIGIN = 'https://hitster.example/';

/**
 * The share props are required, so every render needs them. Defaulted here rather than repeated in
 * a dozen renders -- a test that cares about one of them overrides just that one.
 */
function renderEnd(overrides: Partial<EndScreenProps> = {}) {
  const props: EndScreenProps = {
    cardsPlayed: 42,
    playlistName: 'Rock Classics',
    onRestart: vi.fn(),
    onHome: vi.fn(),
    playlistId: PLAYLIST_ID,
    seed: SEED,
    shareOrigin: ORIGIN,
    onSavePlaylist: vi.fn(),
    isPlaylistSaved: false,
    // A resolved deck, so the export has something to print.
    deck: fixtureDeck.filter((card) => typeof card.year === 'number'),
    ...overrides,
  };

  return { ...render(<EndScreen {...props} />), props };
}

describe('EndScreen', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should render cards played and both actions', () => {
    renderEnd();

    expect(screen.getByText(/42 cards played/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /play again/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^home$/i })).not.toBeNull();
  });

  it('should name the way back "Home" rather than after a playlist', () => {
    // Renamed on 2026-08-06. The landing screen is also where the saved-playlist library is and
    // where a shared link is pasted, so "New playlist" named one of three reasons to press it --
    // and it was the only reason the button did NOT create.
    renderEnd();

    expect(screen.queryByRole('button', { name: /new playlist/i })).toBeNull();
  });

  it('should use the singular for a one-card deck', () => {
    renderEnd({ cardsPlayed: 1 });

    expect(screen.getByText(/1 card played/i)).not.toBeNull();
  });

  it('should invoke restart and home callbacks', () => {
    const onRestart = vi.fn();
    const onHome = vi.fn();
    renderEnd({ onRestart, onHome });

    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^home$/i }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('should say that a restart reshuffles', () => {
    // A player who has just heard forty songs wants to know whether "play again" means the same
    // order. It does not -- `start` with no seed generates a fresh one.
    const { container } = renderEnd();

    expect(container.textContent ?? '').toMatch(/new order/i);
  });

  it('should mount the deck actions', () => {
    // Presence only. That these three work is `DeckActions.test.tsx`'s job; what this pins is that
    // the end screen still OFFERS them -- the natural way to break that now is an edit that drops
    // the child while the two navigation buttons keep working.
    renderEnd();

    expect(screen.queryByRole('button', { name: /copy share link/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /save this playlist/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /print as pdf cards/i })).not.toBeNull();
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

  it('should not render any track information', () => {
    // The deck is over, so this is the ONE screen where a leak would cost nothing -- and the
    // assertion is here anyway, because "here is what you played" is the obvious thing to add and
    // Restart deals the same tracks again immediately afterwards. A track list on this screen would
    // spoil the rematch.
    const { container } = renderEnd({ deck: fixtureDeck });
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
    }
  });
});
