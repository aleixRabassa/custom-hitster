/**
 * What a back press MEANS on the game screen, as a pure function of what is on screen.
 *
 * ===========================================================================
 *  BACK IS A REQUEST, NEVER AN EXIT. THIS IS THE WHOLE POINT OF THE MODULE.
 *
 *  Ending a game is irreversible -- `END` clears the saved session, so the
 *  shuffle, the position in the deck and every resolved year go with it, and
 *  nothing in the app can bring them back. That is the entire reason
 *  `ExitConfirmDialog` exists, and a HARDWARE gesture is pressed far more
 *  reflexively than a 44px button two positions from Play: an Android edge swipe
 *  is muscle memory, aimed at nothing.
 *
 *  So a back press produces the same REQUEST the Exit button produces, and the
 *  same confirmation answers it. `'request-exit'` is deliberately not called
 *  `'exit'`: nothing in this file can end a game, and the day somebody wires
 *  this action straight to `onExit` the name is what should stop them.
 * ===========================================================================
 *
 * ===========================================================================
 *  WHY A PURE MODULE INSTEAD OF THREE LINES INSIDE THE HOOK.
 *
 *  The house split (`gestures.ts`, `resolver.ts`): the decision goes where it
 *  can be tested as a FUNCTION CALL, and the part that must touch a real
 *  browser API stays thin enough that reading it is sufficient review.
 *
 *  jsdom does dispatch `popstate` -- unlike a drag, which Motion reads from
 *  geometry jsdom never computes -- so this could in principle have been tested
 *  through the hook. It is not, for two reasons. The precedence question below
 *  is UNREACHABLE through the hook (no sequence of events opens both dialogs),
 *  so testing it there would mean testing a state the events cannot produce.
 *  And jsdom's traversal is asynchronous with a delay of roughly ten
 *  milliseconds (measured 2026-08-12), so every assertion routed through the
 *  hook has to wait on a timer -- a poor place to put an exhaustive truth table.
 * ===========================================================================
 */

/**
 * The three things a back press can mean on the game screen.
 *
 * A closed union rather than a boolean pair, so a caller has to handle each one by name and
 * `switch` exhaustiveness catches a fourth being added later.
 */
export type BackNavigationAction = 'close-deck-actions' | 'close-exit-confirm' | 'request-exit';

/** What is open on the game screen. Exactly `GameScreen`'s two dialog flags, in the same words. */
export interface BackNavigationState {
  /** `GameScreen`'s `isDeckActionsOpen` -- the share/save/print panel. */
  isDeckActionsOpen: boolean;
  /** `GameScreen`'s `isExitConfirmOpen` -- the "end this game?" confirmation. */
  isExitConfirmOpen: boolean;
}

/**
 * What should a back press do, given what is on screen?
 *
 * TOTAL by construction: every combination of the two flags returns an action, including the
 * both-open one that no sequence of presses can currently produce -- each dialog's backdrop
 * covers the button that opens the other. A function that returned nothing for a state would be
 * a crash waiting for the refactor that makes the state reachable, and the precedence costs one
 * line to choose deliberately.
 *
 * THE PRECEDENCE IS DOM ORDER, and it is not arbitrary: `GameScreen` renders the exit
 * confirmation first and the deck-actions panel second, so with both mounted the deck-actions
 * panel is the one painting on top. Back dismisses what the player can see, which is what every
 * Android app does. If that render order is ever swapped, this order follows it.
 *
 * Back inside a dialog CLOSES it and does nothing else -- it never answers it. A back press that
 * confirmed an exit would be strictly worse than not intercepting back at all: it would turn the
 * reflexive gesture into the destructive one, through the guard added to catch it.
 */
export function backNavigationAction({
  isDeckActionsOpen,
  isExitConfirmOpen,
}: BackNavigationState): BackNavigationAction {
  if (isDeckActionsOpen) return 'close-deck-actions';
  if (isExitConfirmOpen) return 'close-exit-confirm';

  return 'request-exit';
}
