/**
 * The back-press decision, exhaustively. A NODE test with no DOM: the module touches no history
 * API and no React, which is the entire reason it is a module.
 *
 * Four states, four assertions, and the truth table below is the whole state space -- which is
 * what makes "total" a checked property here rather than a claim in a comment.
 */

import { describe, expect, it } from 'vitest';

import { backNavigationAction } from './back-navigation';
import type { BackNavigationAction, BackNavigationState } from './back-navigation';

describe('backNavigationAction', () => {
  it('should request an exit when no dialog is open', () => {
    // ===================================================================
    //  THE CORE CASE, AND THE ONE WORD THAT MATTERS IS "REQUEST".
    //
    //  Back during play must produce the same request the Exit button
    //  produces -- never a direct exit. `END` clears the saved session, so
    //  a back press that ended the game outright would destroy the
    //  shuffle, the position in the deck and every resolved year, with no
    //  question asked and nothing in the app able to bring them back.
    //
    //  That is worse from a hardware gesture than from the button: an
    //  Android edge swipe is muscle memory aimed at nothing in particular.
    // ===================================================================
    expect(backNavigationAction({ isDeckActionsOpen: false, isExitConfirmOpen: false })).toBe(
      'request-exit',
    );
  });

  it('should close the deck-actions dialog when it is open', () => {
    expect(backNavigationAction({ isDeckActionsOpen: true, isExitConfirmOpen: false })).toBe(
      'close-deck-actions',
    );
  });

  it('should close the exit confirmation when it is open', () => {
    // Back inside the confirmation DISMISSES it. A back press that answered "yes" would be
    // strictly worse than no interception at all -- it would turn the reflexive gesture into the
    // destructive one, through the guard added to catch exactly that.
    expect(backNavigationAction({ isDeckActionsOpen: false, isExitConfirmOpen: true })).toBe(
      'close-exit-confirm',
    );
  });

  it('should resolve a defined action for every state combination', () => {
    // ===================================================================
    //  TOTALITY, INCLUDING THE STATE THAT CANNOT HAPPEN.
    //
    //  Both dialogs open is unreachable today -- each one's backdrop
    //  covers the control-bar button that opens the other -- but a
    //  function that returned nothing for a state is a crash waiting for
    //  the refactor that makes it reachable, and choosing the precedence
    //  deliberately costs one line.
    //
    //  The chosen precedence is DOM ORDER: `GameScreen` renders the exit
    //  confirmation first and the deck-actions panel second, so with both
    //  mounted the panel is the one painting on top, and back dismisses
    //  what the player can actually see. Swap that render order and this
    //  expectation is the thing that should change with it.
    // ===================================================================
    const actions: BackNavigationAction[] = [];

    for (const isDeckActionsOpen of [false, true]) {
      for (const isExitConfirmOpen of [false, true]) {
        const state: BackNavigationState = { isDeckActionsOpen, isExitConfirmOpen };
        const action = backNavigationAction(state);

        expect(['close-deck-actions', 'close-exit-confirm', 'request-exit']).toContain(action);
        actions.push(action);
      }
    }

    // All four states, in the loop's order: neither / exit-only / deck-only / both.
    expect(actions).toEqual([
      'request-exit',
      'close-exit-confirm',
      'close-deck-actions',
      'close-deck-actions',
    ]);
  });
});
