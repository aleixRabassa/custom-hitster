/**
 * @vitest-environment jsdom
 *
 * The modal shell only. What is INSIDE it is `DeckActions.test.tsx`'s job; what these assert is the
 * part that makes mounting it over a live card safe -- Escape, the backdrop, the focus cycle, and
 * the fact that no card data comes along for the ride.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeckActionsDialog } from './DeckActionsDialog';
import { fixtureDeck } from './__fixtures__/cards';
import type { DeckActionsDialogProps } from './DeckActionsDialog';

function renderDialog(overrides: Partial<DeckActionsDialogProps> = {}) {
  const props: DeckActionsDialogProps = {
    playlistId: '37i9dQZF1DXcBWIGoYBM5M',
    playlistName: 'Rock Classics',
    seed: 'a1b2c3d4e5f60718',
    shareOrigin: 'https://hitster.example/',
    onSavePlaylist: vi.fn(),
    isPlaylistSaved: false,
    deck: fixtureDeck,
    onClose: vi.fn(),
    ...overrides,
  };

  return { ...render(<DeckActionsDialog {...props} />), props };
}

describe('DeckActionsDialog', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should announce itself as a modal dialog with a name', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Keep this deck')).not.toBeNull();
  });

  it('should focus the first action rather than the close button', () => {
    // The difference from `ExitConfirmDialog`, and it is deliberate: that dialog asks a question
    // whose wrong answer is irreversible, so the safe option takes focus. Nothing in here is
    // destructive, so making a keyboard player Tab past Close to reach what they opened the panel
    // for would be the only hostility on offer.
    renderDialog();

    expect(document.activeElement?.textContent).toMatch(/copy share link/i);
  });

  it('should close on Escape', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should close on a press on the backdrop but not inside the panel', () => {
    // Only a press on the backdrop ITSELF: a click that bubbled out of the panel would close the
    // dialog every time the player pressed one of its own buttons.
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('deck-actions-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should close on the close button', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /back to the game/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should cycle Tab inside the panel', () => {
    // ===================================================================
    //  `aria-modal` DOES NOT MAKE TAB SKIP THE PAGE.
    //
    //  Without the trap a keyboard player tabs straight out of the panel
    //  and onto the Play button behind the backdrop -- which they cannot
    //  see and cannot click. A real cycle rather than the exit dialog's
    //  two-element swap, because this panel has four controls and grows a
    //  fifth when the copy fallback appears.
    // ===================================================================
    renderDialog();

    const panel = screen.getByRole('dialog');
    const names = () => document.activeElement?.textContent ?? '';

    expect(names()).toMatch(/copy share link/i);

    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(names()).toMatch(/save this playlist/i);

    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(names()).toMatch(/print as pdf cards/i);

    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(names()).toMatch(/back to the game/i);

    // Wraps rather than escaping.
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(names()).toMatch(/copy share link/i);

    // And backwards from the first element lands on the last.
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(names()).toMatch(/back to the game/i);
  });

  it('should skip a disabled control in the cycle', () => {
    // The save button disables itself the moment it is pressed, which is why the focusable list is
    // queried at Tab time rather than captured on mount.
    renderDialog({ isPlaylistSaved: true });

    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Tab' });

    expect(document.activeElement?.textContent).toMatch(/print as pdf cards/i);
  });

  it('should give focus back to the opener when it unmounts', () => {
    // Without this, focus falls to `<body>` on close and a keyboard player has to tab in from the
    // top of the page to reach the control bar they were already on.
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderDialog();
    expect(document.activeElement).not.toBe(opener);

    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('should render no card data', () => {
    // It mounts OVER an unflipped card, so this is the same rule `CardControls` and
    // `ExitConfirmDialog` keep -- and here the component genuinely holds the deck.
    const { container } = renderDialog();
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
    }
  });
});
