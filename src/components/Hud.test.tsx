/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Hud } from './Hud';
import { fixtureDeck } from './__fixtures__/cards';

describe('Hud', () => {
  afterEach(cleanup);

  it('should render cards remaining', () => {
    render(<Hud cardsRemaining={17} playlistName="Rock Classics" />);

    expect(screen.getByTestId('hud').textContent).toContain('17 cards left');
  });

  it('should use the singular for one card left', () => {
    render(<Hud cardsRemaining={1} playlistName="Rock Classics" />);

    expect(screen.getByTestId('hud').textContent).toContain('1 card left');
  });

  it('should render zero on the last card rather than a fraction', () => {
    // `cardsRemaining` counts cards AFTER the current one, so the last card reads 0 -- and it must
    // not read "0 of 42", which looks like an error on a card the player is still holding.
    render(<Hud cardsRemaining={0} playlistName="Rock Classics" />);

    expect(screen.getByTestId('hud').textContent).toContain('0 cards left');
  });

  it('should render the playlist name', () => {
    // Playlist-level, so it is safe: the player chose this playlist and already knows its name.
    // The distinction between that and a track title is the whole leak rule in miniature.
    render(<Hud cardsRemaining={5} playlistName="Reggae Classics" />);

    expect(screen.queryByText('Reggae Classics')).not.toBeNull();
  });

  it('should not render an exit control', () => {
    // ===================================================================
    //  Exit lives in `CardControls`, beside the card, and there is exactly
    //  one of it. `plan.md` §5 is explicit that there is no separate End
    //  Game button.
    //
    //  Asserted because "the HUD should have a quit button" is a natural
    //  thing to want, and a second exit is how one of the two quietly stops
    //  being wired to anything.
    // ===================================================================
    render(<Hud cardsRemaining={5} playlistName="Rock Classics" />);

    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('should not render any track information', () => {
    // The HUD sits above an unflipped card for the ENTIRE game, which gives it the longest leak
    // exposure of any surface in the app. "Up next: Queen" is the kind of thing a HUD attracts.
    const { container } = render(<Hud cardsRemaining={5} playlistName="Rock Classics" />);
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
    }
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
