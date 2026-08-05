/**
 * The exit confirmation: the one modal in the app, and the one place a modal is right.
 *
 * ===========================================================================
 *  WHY THIS IS A MODAL WHEN `NoticeBanner` ARGUES AGAINST THEM.
 *
 *  That file's header says a notice may never gate Start, and that a modal
 *  would turn a footnote into an obstacle. Both still hold -- the difference is
 *  what is being interrupted and what it costs.
 *
 *  A notice describes a deck that is already playable, so it has nothing to
 *  ask. Exit DESTROYS one: `END` clears the saved session, so the shuffle, the
 *  position in the deck and every year resolved so far are gone, and there is
 *  no undo anywhere in the app -- the deck is one-directional by design and
 *  "Play again" reshuffles rather than restores. The button that does it is a
 *  44px round target three positions from Play, on the surface a thumb is
 *  swiping. That is the case for a confirm step: an irreversible action, one
 *  mis-press away.
 * ===========================================================================
 *
 * Presentational like every other component here -- two callbacks in, nothing about a session
 * known. `GameScreen` owns whether it is open, because "is the confirm dialog showing" is screen
 * state rather than session state: the reducer has no `CONFIRM_EXIT` action and does not want one.
 *
 * ## Nothing here may leak, and this is a pre-reveal surface
 *
 * It renders OVER an unflipped card, so it is a leak surface exactly as `CardControls` is. Every
 * string below is a literal and the component takes no `Card` at all, which is what makes the rule
 * cheap to keep -- "End the game? You are on Bohemian Rhapsody" is the sort of helpful thing that
 * would spoil the card underneath.
 *
 * ## Cancel is the safe default, in three separate ways
 *
 * Cancel takes the initial focus, Escape cancels, and a press on the backdrop cancels. The
 * asymmetry is the point: every accidental or ambiguous input resolves to keeping the game, and
 * the only path to ending it is a deliberate press on the one button that says so.
 */

import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** `KeyboardEvent.key` for the dismissal. */
const CANCEL_KEY = 'Escape';

export interface ExitConfirmDialogProps {
  /** The player confirmed. The caller stops the audio and ends the session. */
  onConfirm: () => void;
  /** The player backed out -- via the button, Escape, or the backdrop. Just close. */
  onCancel: () => void;
}

export function ExitConfirmDialog({ onConfirm, onCancel }: ExitConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  /**
   * Focus lands on Cancel, not on the panel and not on Confirm -- and goes back where it came from
   * when the dialog closes.
   *
   * On the panel would mean a keyboard player has to Tab before they can answer; on Confirm would
   * mean a Space or an Enter left over from the keypress that opened this dialog ends the game.
   * Cancel is both the safe target and the one a player usually wants.
   *
   * The restore in the cleanup is what a cancel needs: without it focus falls to `<body>` when this
   * unmounts, so a keyboard player who backs out has to tab in from the top of the page to reach
   * the control bar they were already on. On a CONFIRM the trigger is unmounting with the whole
   * screen, and `focus()` on a detached element does nothing -- so the same line is correct for
   * both exits without having to know which one happened.
   */
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    cancelRef.current?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  /**
   * Escape cancels, at the window.
   *
   * `GameScreen`'s own window handler is disabled for as long as this dialog is open, so the two
   * cannot both act on one keystroke -- and Space and ArrowRight cannot flip or advance the card
   * sitting behind the backdrop, which would otherwise be a player answering a modal and dealing
   * themselves a new card at the same time.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === CANCEL_KEY) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  /**
   * Keep Tab inside the dialog.
   *
   * `aria-modal` tells assistive technology that the rest of the page is inert; it does NOT make
   * Tab skip it, so without this a keyboard player tabs straight out of the dialog and onto the
   * Play button behind the backdrop -- which they cannot see and cannot click. Two focusable
   * elements makes the trap a swap rather than a cycle through a queried list.
   */
  const handleTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    event.preventDefault();
    const target = event.target === cancelRef.current ? confirmRef.current : cancelRef.current;
    target?.focus();
  };

  return (
    <div
      /*
        The backdrop, and it is what makes the dialog modal in fact rather than only in ARIA: it
        covers the viewport, so a pointer cannot reach the card, the deck or the control bar
        underneath. `bg-page/80` rather than an opaque fill so the player can still see the game
        they are being asked about.
      */
      className="fixed inset-0 z-50 flex items-center justify-center bg-page/80 p-6"
      data-testid="exit-confirm-backdrop"
      onClick={(event) => {
        // Only a press on the backdrop ITSELF, never one that bubbled up out of the panel.
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={handleTab}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-confirm-title"
        aria-describedby="exit-confirm-description"
        className="flex w-full max-w-content flex-col gap-4 rounded-lg border border-border-strong bg-surface p-5 text-fg"
      >
        <h2 id="exit-confirm-title" className="text-lg font-semibold">
          End the game?
        </h2>

        {/*
          Says what is actually lost, in the player's terms. "Are you sure?" is the version that
          tells somebody nothing they did not already know -- the reason to stop and read is that
          the deck does not come back.
        */}
        <p id="exit-confirm-description" className="text-sm text-fg-secondary">
          This ends the game and returns you to the start screen. The deck, your place in it and the
          years found so far are all lost — there is no way back into this session.
        </p>

        {/*
          Cancel first in the DOM, so reading order, visual order and tab order are the same list
          in every direction -- a column on a phone, a row from `sm` up. The destructive button is
          last in all three, which is also where a player's eye stops.
        */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring"
          >
            Keep playing
          </button>

          {/* Red and FILLED, unlike the exit glyph: this is the press that actually destroys the
              deck, so it is the one place in the app red carries weight rather than a warning. */}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="flex-1 touch-target rounded-lg bg-danger px-4 py-2 font-medium text-on-danger hover:bg-danger-hover focus-visible:focus-ring"
          >
            End game
          </button>
        </div>
      </div>
    </div>
  );
}
