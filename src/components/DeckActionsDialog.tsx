/**
 * The game screen's way into `DeckActions`: a modal panel over the card.
 *
 * ===========================================================================
 *  A MODAL, AND THE BACKDROP IS THE FEATURE RATHER THAN THE DECORATION.
 *
 *  Plan 2's decision 7 kept these three actions off the game screen because a
 *  panel over a live card is an interaction conflict with the swipe. It is --
 *  unless the panel is modal. This one covers the viewport, so a pointer cannot
 *  reach the card, the deck or the control bar underneath, and `GameScreen`
 *  suspends its own window key handler for as long as this is open. Between the
 *  two, a press in here cannot flip a card, deal a card or start a drag.
 *
 *  That is exactly the treatment `ExitConfirmDialog` gets, and for exactly the
 *  same reason (its guard 4). The difference is what the dialog is for: that one
 *  asks a question, so Cancel takes focus and every ambiguous input resolves to
 *  "keep the game". This one offers three harmless actions, so the FIRST ACTION
 *  takes focus -- there is nothing here to protect the player from, and making
 *  them Tab past a Close button to reach what they opened the panel for is the
 *  only real hostility available.
 * ===========================================================================
 *
 * ## It is a pre-reveal surface, and it renders no card data
 *
 * This mounts over an UNFLIPPED card, so the leak rule applies in full. Every string in this file
 * is a literal, and `DeckActions` -- which does hold the deck, for the PDF -- renders only counts.
 * `DeckActionsDialog.test.tsx` and `DeckActions.test.tsx` both assert it against the fixture deck.
 */

import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { DeckActions } from './DeckActions';
import type { DeckActionsProps } from './DeckActions';

/** `KeyboardEvent.key` for the dismissal. */
const CLOSE_KEY = 'Escape';

/**
 * What Tab is allowed to land on inside the panel.
 *
 * Queried at Tab time rather than captured on mount, and that is not caution: the copy fallback
 * mounts a text input only AFTER a copy has failed, so a list taken at mount would trap focus in a
 * set that no longer matches what is on screen -- and the input is the whole point of that
 * fallback. `:not([disabled])` matters for the same reason in the other direction: the save button
 * disables itself the moment it is pressed.
 */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

export type DeckActionsDialogProps = DeckActionsProps & {
  /** Close and give focus back to whatever opened this. */
  onClose: () => void;
};

export function DeckActionsDialog({ onClose, ...deckActions }: DeckActionsDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Focus the first action, and put it back where it came from on the way out.
   *
   * The restore is what makes this usable twice: without it focus falls to `<body>` when this
   * unmounts, so a player who closes the panel has to tab in from the top of the page to reach the
   * control bar they were already on. Same line, same reasoning as `ExitConfirmDialog`.
   */
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  /**
   * Escape closes, at the window.
   *
   * `GameScreen`'s own window handler is disabled for as long as this is open, so the two cannot
   * both act on one keystroke -- and Space and ArrowRight cannot flip or advance the card sitting
   * behind the backdrop, which would otherwise be a player pressing Print and dealing themselves a
   * new card in the same keystroke.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === CLOSE_KEY) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  /**
   * Keep Tab inside the panel.
   *
   * `aria-modal` tells assistive technology that the rest of the page is inert; it does NOT make
   * Tab skip it, so without this a keyboard player tabs straight out and onto the Play button
   * behind the backdrop -- which they cannot see and cannot click.
   *
   * A real cycle rather than `ExitConfirmDialog`'s two-element swap, because this panel has four
   * controls and can grow a fifth (the copy fallback's input).
   */
  const handleTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;

    event.preventDefault();

    const current = focusable.indexOf(document.activeElement as HTMLElement);
    // `-1` (focus is somewhere unexpected) lands on the first element going forwards and the last
    // going back, which is what the arithmetic below does without a special case.
    const step = event.shiftKey ? -1 : 1;
    const next = (current + step + focusable.length) % focusable.length;

    focusable[next]?.focus();
  };

  return (
    <div
      /*
        The backdrop, and it is what makes this modal in fact rather than only in ARIA. `bg-page/80`
        rather than an opaque fill, matching the exit dialog: the player can still see the game they
        are half-way through.
      */
      className="fixed inset-0 z-50 flex items-center justify-center bg-page/80 p-6"
      data-testid="deck-actions-backdrop"
      onClick={(event) => {
        // Only a press on the backdrop ITSELF, never one that bubbled up out of the panel.
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleTab}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deck-actions-title"
        className="flex w-full max-w-content flex-col gap-4 rounded-lg border border-border-strong bg-surface p-5 text-fg"
      >
        <h2 id="deck-actions-title" className="text-lg font-semibold">
          Keep this deck
        </h2>

        <DeckActions {...deckActions} />

        {/*
          Close last in the DOM, so reading order, visual order and tab order are the same list --
          and so the first thing focus lands on is the first thing the player came here for.
        */}
        <button
          type="button"
          onClick={onClose}
          className="touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring"
        >
          Back to the game
        </button>
      </div>
    </div>
  );
}
