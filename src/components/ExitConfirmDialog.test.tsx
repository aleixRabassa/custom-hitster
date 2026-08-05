/**
 * @vitest-environment jsdom
 *
 * The confirmation dialog's tests, and most of them are about the ASYMMETRY between the two
 * answers: every accidental or ambiguous input has to resolve to keeping the game, and the only
 * path to ending it is a deliberate press on the button that says so.
 *
 * No `qrcode` mock: this component renders no card and takes no card data at all, which is also
 * what makes the leak assertion at the bottom cheap to keep true.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExitConfirmDialog } from './ExitConfirmDialog';
import { fixtureDeck } from './__fixtures__/cards';

describe('ExitConfirmDialog', () => {
  afterEach(cleanup);

  it('should expose itself as a modal dialog with a name and a description', () => {
    // `role="dialog"` plus `aria-modal` is what tells assistive technology the rest of the page is
    // inert; the labelled title and described body are what it reads out when focus lands inside.
    render(<ExitConfirmDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('exit-confirm-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('exit-confirm-description');
    expect(document.getElementById('exit-confirm-title')?.textContent).toMatch(/end the game/i);
  });

  it('should say what is lost rather than only asking whether the player is sure', () => {
    // The whole reason to interrupt somebody is to tell them something they did not already know.
    // `END` clears the saved session, so the shuffle, the position in the deck and every resolved
    // year go with it -- and there is no undo anywhere in the app.
    render(<ExitConfirmDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const body = document.getElementById('exit-confirm-description')?.textContent ?? '';
    expect(body).toMatch(/lost/i);
    expect(body).toMatch(/start screen/i);
  });

  it('should confirm only on the confirm button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ExitConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />);

    screen.getByRole('button', { name: 'End game' }).click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('should cancel on the cancel button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ExitConfirmDialog onConfirm={onConfirm} onCancel={onCancel} />);

    screen.getByRole('button', { name: 'Keep playing' }).click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('should cancel on Escape', () => {
    // At the WINDOW, because focus is on a button inside the dialog rather than on the panel -- a
    // handler bound to the panel would only see Escape if the panel itself were focused.
    const onCancel = vi.fn();
    render(<ExitConfirmDialog onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should cancel on a press on the backdrop but not on one inside the panel', () => {
    // The second half is the one that would break in practice: a click anywhere in the panel
    // bubbles up to the backdrop's handler, so without the target check, pressing the title text --
    // or missing a button by a pixel -- would dismiss the dialog.
    const onCancel = vi.fn();
    render(<ExitConfirmDialog onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('exit-confirm-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should put the initial focus on cancel', () => {
    // ===================================================================
    //  NOT ON CONFIRM, AND THIS IS A REAL FAILURE MODE RATHER THAN A
    //  PREFERENCE.
    //
    //  The dialog can be opened from the keyboard -- Space or Enter on the
    //  focused Exit button. If Confirm took the focus, a player who holds
    //  that key a beat too long, or presses it twice out of habit, ends the
    //  game with a single intended action and never sees the question.
    //  Cancel is the safe target and it is also the answer a player
    //  usually wants.
    // ===================================================================
    render(<ExitConfirmDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep playing' }));
  });

  it('should keep Tab inside the dialog', () => {
    // `aria-modal` makes the page inert to assistive technology; it does NOT make Tab skip it. So
    // without the trap a keyboard player tabs out onto the Play button behind the backdrop, which
    // they can neither see nor click.
    render(<ExitConfirmDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const cancel = screen.getByRole('button', { name: 'Keep playing' });
    const confirm = screen.getByRole('button', { name: 'End game' });

    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(confirm);

    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
  });

  it('should return focus to the trigger when it closes', () => {
    // Without the restore, focus falls to `<body>` on a cancel and the player has to tab in from
    // the top of the page to get back to the control bar they were already on.
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<ExitConfirmDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement).not.toBe(trigger);

    unmount();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('should not name any track', () => {
    // It renders OVER an unflipped card, so it is a leak surface exactly as `CardControls` is. The
    // component takes no card at all -- this exists so that adding "you are on track 7 of 42",
    // or the current title, fails a test.
    const { container } = render(<ExitConfirmDialog onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
      if (typeof card.year === 'number') expect(text).not.toContain(String(card.year));
    }

    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
