/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EndScreen } from './EndScreen';
import { fixtureDeck } from './__fixtures__/cards';

describe('EndScreen', () => {
  afterEach(cleanup);

  it('should render cards played and both actions', () => {
    render(
      <EndScreen
        cardsPlayed={42}
        playlistName="Rock Classics"
        onRestart={vi.fn()}
        onNewPlaylist={vi.fn()}
      />,
    );

    expect(screen.getByText(/42 cards played/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /play again/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /new playlist/i })).not.toBeNull();
  });

  it('should use the singular for a one-card deck', () => {
    render(
      <EndScreen
        cardsPlayed={1}
        playlistName="Rock Classics"
        onRestart={vi.fn()}
        onNewPlaylist={vi.fn()}
      />,
    );

    expect(screen.getByText(/1 card played/i)).not.toBeNull();
  });

  it('should invoke restart and new-playlist callbacks', () => {
    const onRestart = vi.fn();
    const onNewPlaylist = vi.fn();
    render(
      <EndScreen
        cardsPlayed={42}
        playlistName="Rock Classics"
        onRestart={onRestart}
        onNewPlaylist={onNewPlaylist}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /new playlist/i }));
    expect(onNewPlaylist).toHaveBeenCalledTimes(1);
  });

  it('should say that a restart reshuffles', () => {
    // A player who has just heard forty songs wants to know whether "play again" means the same
    // order. It does not -- `start` with no seed generates a fresh one.
    const { container } = render(
      <EndScreen
        cardsPlayed={42}
        playlistName="Rock Classics"
        onRestart={vi.fn()}
        onNewPlaylist={vi.fn()}
      />,
    );

    expect(container.textContent ?? '').toMatch(/new order/i);
  });

  it('should give both actions a focus-visible style', () => {
    // Class-name level, with the caveat given in full in `LandingScreen.test.tsx`. These two are
    // the only interactive elements on the screen, so the count is asserted as well: a third
    // button added without a ring fails here.
    render(
      <EndScreen
        cardsPlayed={42}
        playlistName="Rock Classics"
        onRestart={vi.fn()}
        onNewPlaylist={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.className).toContain('focus-visible:focus-ring');
    }
  });

  it('should not render any track information', () => {
    // The deck is over, so this is the ONE screen where a leak would cost nothing -- and the
    // assertion is here anyway, because "here is what you played" is the obvious thing to add and
    // Restart deals the same tracks again immediately afterwards. A track list on this screen would
    // spoil the rematch.
    const { container } = render(
      <EndScreen
        cardsPlayed={42}
        playlistName="Rock Classics"
        onRestart={vi.fn()}
        onNewPlaylist={vi.fn()}
      />,
    );
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
    }
  });
});
