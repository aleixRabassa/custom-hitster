/**
 * The binding half of "Android's back button is an in-app control": one history entry, one
 * `popstate` listener, and no branching of its own.
 *
 * ===========================================================================
 *  WHY AN ENTRY HAS TO BE PUSHED AT ALL.
 *
 *  `App.tsx` never touches the address bar -- no `pushState`, no `replaceState`
 *  -- which is a recorded decision and correct for the web. Inside a Trusted Web
 *  Activity it has a consequence that is not: there is NO HISTORY ENTRY TO GO
 *  BACK TO, so Android's back gesture closes the activity outright. Mid-game a
 *  reflexive edge swipe therefore ended the game while bypassing
 *  `ExitConfirmDialog` -- and bypassed it INVISIBLY, because the session
 *  survives in `localStorage` and a relaunch resumes, so the player experiences
 *  it as the app randomly quitting rather than as a game they lost.
 *
 *  So this pushes exactly one entry for the back press to consume. The decision
 *  about what the press MEANS is `src/game/back-navigation.ts`; this file only
 *  collects the event and calls it, the same way `useCardGestures` collects
 *  coordinates and calls `gestures.ts`.
 * ===========================================================================
 *
 * ===========================================================================
 *  THE ENTRY IS REPLACED AFTER EVERY PRESS, SO THERE IS ALWAYS EXACTLY ONE.
 *
 *  A back press CONSUMES the entry. Without a replacement the interception would
 *  work once per game: press back, cancel the confirmation, press back again and
 *  the activity closes -- which is the original bug, delayed by one press and
 *  therefore harder to report. The invariant this file maintains is "while the
 *  game screen is mounted, exactly one of our entries is outstanding", and the
 *  replacement is pushed SYNCHRONOUSLY inside the handler so the invariant never
 *  has a gap an unmount could land in.
 *
 *  The visible URL never changes, so the player sees nothing and a mid-game
 *  reload still re-reads a shared link's query string (`pushState` with no URL
 *  argument keeps the current one in full, query and fragment included --
 *  measured, and pinned by a test).
 * ===========================================================================
 *
 * ===========================================================================
 *  THE CLEANUP ORDERING IS THE CENTRAL HAZARD. LISTENER FIRST, THEN NAVIGATE.
 *
 *  Undoing the pushed entry means navigating back, and that fires `popstate`.
 *  With the listener still attached, the cleanup would be read as a back press
 *  and the exit confirmation would open on a screen that is unmounting. So the
 *  cleanup removes the listener BEFORE it calls `history.back()`, always.
 *
 *  MEASURED CAVEAT (2026-08-12): the ordering cannot be caught by a behavioural
 *  test, and the test that pins it says so. The traversal is queued rather than
 *  synchronous, so BOTH orderings work today -- the listener is gone by the time
 *  the event lands either way, since both statements run in the same tick. The
 *  order is kept, and pinned as a CALL ORDER, because it is the only version
 *  that survives the cleanup gaining an `await`, an early return or a second
 *  statement between the two lines. Do not "simplify" it on the strength of a
 *  green suite.
 *
 *  It must undo the entry rather than remember having pushed one: a stray entry
 *  surviving the game means the first back press on the landing screen does
 *  nothing visible, which reads as a frozen back button -- a worse bug than the
 *  one being fixed, and one nobody would connect to the game screen.
 * ===========================================================================
 *
 * ===========================================================================
 *  THIS IS NOT TWA-ONLY, AND THE BROWSER-SIDE CHANGE IS ACCEPTED RATHER THAN
 *  SUPPRESSED (plan decision 9).
 *
 *  Nothing here asks whether it is running in a Trusted Web Activity, so the
 *  browser's own back button -- desktop and mobile Chrome alike -- now opens the
 *  exit confirmation during play instead of leaving the app. That is a
 *  behaviour change for existing web players, and it is deliberate on two
 *  counts: a mis-swiped back loses the game there too, and a rule that behaved
 *  differently depending on how the app was launched would be a second
 *  behaviour to reason about for no benefit to either audience. There is
 *  therefore no user-agent sniff and no `display-mode: standalone` check to add.
 * ===========================================================================
 *
 * ===========================================================================
 *  `pendingCleanupTraversals` IS THE STRICTMODE FIX, AND IT IS NOT THE REFLEX.
 *
 *  The reflex is an "already pushed" ref, and this repo has already measured
 *  what that costs: StrictMode's simulated unmount runs the CLEANUP for work the
 *  ref still records as done, which is precisely how the deck-link effect in
 *  `App.tsx` came to sit on the landing screen forever (see its header). A
 *  cleanup that genuinely undoes the push is the shape that survives -- but on
 *  its own it is not enough here, because the traversal is ASYNCHRONOUS:
 *
 *    1. effect runs      -> push A                      [base, A], at A
 *    2. cleanup runs     -> listener off, back() QUEUED
 *    3. effect runs again-> push B                      [base, A, B], at B
 *    4. the queued traversal finally lands, moving B -> A, and fires `popstate`
 *       at the listener the SECOND effect attached.
 *
 *  Step 4 is a phantom back press: in development the exit confirmation would
 *  appear by itself a few milliseconds after every game started. The counter
 *  below is incremented by the cleanup that queued the traversal and consumed by
 *  the handler, so a pop this file caused is never read as a pop the player
 *  caused. It is MODULE-LEVEL rather than per-hook because the two halves can
 *  belong to different mounts, which is exactly the case above.
 *
 *  Its one narrow hole is a genuine press landing between steps 2 and 4 of a
 *  remount -- a few milliseconds, in development only, on a screen that is being
 *  torn down. Accepted, and cheap to spot: it would show as a single ignored
 *  press, never as a lost game.
 *
 *  MEASURED CAVEAT (2026-08-12): jsdom CANNOT REPRODUCE STEP 4, so no test in
 *  this repo proves the counter is needed. A `pushState` that lands before a
 *  queued traversal DISCARDS that traversal there -- the sequence above ends at
 *  B with no `popstate` at all -- whereas the spec has the traversal re-resolve
 *  its delta against the session history when the task runs, which is what makes
 *  step 4 real in Chrome. So this guard is written against the platform rather
 *  than against the test environment, and it is inert under Vitest. Deleting it
 *  costs nothing locally and reintroduces a phantom dialog in `pnpm dev`.
 * ===========================================================================
 */

import { useEffect, useRef } from 'react';

import { backNavigationAction } from '../game/back-navigation';
import type { BackNavigationState } from '../game/back-navigation';

/**
 * What is written into the pushed entry's state.
 *
 * DIAGNOSTIC ONLY, and it must stay that way. Reading it back to decide whether a pop is ours is
 * the obvious next step and it is wrong: `history.state` survives a RELOAD, so a player who
 * reloads mid-game leaves a marked entry behind that this hook did not push, and any logic keyed
 * on the marker would then ignore a genuine press -- the frozen-back-button failure. The
 * behaviour is driven by `pendingCleanupTraversals` and by nothing else.
 */
const BACK_ENTRY_STATE = { customHitsterBackEntry: true } as const;

/**
 * Traversals this hook queued in a cleanup and has not yet seen land.
 *
 * Module-level on purpose -- see the header. Never negative: only the handler decrements it, and
 * only when it is positive.
 */
let pendingCleanupTraversals = 0;

/**
 * Test-only, and for the same reason `clearQrCache` exists: module state outlives a test, because
 * Vitest isolates modules per FILE rather than per test. A test that unmounts without waiting for
 * the queued traversal would otherwise leave the counter armed and the NEXT test's first back
 * press would be swallowed.
 */
export function resetBackNavigationTraversals(): void {
  pendingCleanupTraversals = 0;
}

export interface UseBackNavigationOptions extends BackNavigationState {
  /** Close the deck-actions panel. `GameScreen`'s own `setIsDeckActionsOpen(false)`. */
  onCloseDeckActions: () => void;
  /** Dismiss the exit confirmation without ending the game -- the same path as "Keep playing". */
  onCloseExitConfirm: () => void;
  /**
   * ASK to exit: the same handler the Exit button calls, so the confirmation is shared rather
   * than duplicated. Never `onExit` itself -- see `back-navigation.ts`.
   */
  onRequestExit: () => void;
}

/**
 * Make the platform back press an in-app control for as long as the calling component is mounted.
 *
 * MOUNTING IS THE SCOPING. `GameScreen` is rendered exactly while `state.status` is `playing`, so
 * the interception's lifetime is the game's, and every other screen keeps the platform's default
 * behaviour by construction rather than by an exclusion list somebody has to remember to update.
 * There is deliberately no status argument here for the same reason.
 */
export function useBackNavigation(options: UseBackNavigationOptions): void {
  /**
   * The latest flags and callbacks, for a listener that is attached exactly once.
   *
   * The effect below CANNOT depend on the dialog flags: a dependency array containing them would
   * tear the listener down and push a fresh entry every time a dialog opened, so a game would
   * accumulate one entry per press. The standard latest-ref pattern instead, written in an effect
   * rather than during render so nothing mutates a ref in a render pass.
   */
  const latestRef = useRef(options);

  useEffect(() => {
    latestRef.current = options;
  });

  useEffect(() => {
    /**
     * Is one of our entries currently outstanding? Local to the mount, and read by the cleanup.
     *
     * False whenever the push failed. `pushState` can throw -- a sandboxed frame, an opaque
     * origin -- and the degradation is deliberate: no entry means back does what it did before
     * this hook existed (the platform closes the app), which is a behaviour the player already
     * has rather than a broken one, and the cleanup then navigates nowhere and leaves no stray.
     */
    let hasEntry = pushBackEntry();

    const handlePopState = () => {
      // A traversal this hook's own cleanup queued, not a press. Never runs the decision.
      if (pendingCleanupTraversals > 0) {
        pendingCleanupTraversals -= 1;
        return;
      }

      // The entry has just been consumed by the press. Replace it FIRST, so the invariant holds
      // even if the action below unmounts this screen in the same tick.
      hasEntry = pushBackEntry();

      const latest = latestRef.current;

      switch (backNavigationAction(latest)) {
        case 'close-deck-actions':
          latest.onCloseDeckActions();
          return;
        case 'close-exit-confirm':
          latest.onCloseExitConfirm();
          return;
        case 'request-exit':
          latest.onRequestExit();
          return;
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      // ORDER IS LOAD-BEARING. See the header: the navigation below fires `popstate`, and a
      // listener still attached would read this teardown as a back press.
      window.removeEventListener('popstate', handlePopState);

      if (!hasEntry) return;
      hasEntry = false;

      // Armed BEFORE the call, because the traversal can land on another mount's listener.
      pendingCleanupTraversals += 1;
      window.history.back();
    };
  }, []);
}

/**
 * Push the one entry, and report whether it is there.
 *
 * No URL argument, which is what leaves the address bar untouched: the entry carries the current
 * href in full, so a shared deck link's `?playlist=…&seed=…` survives and a mid-game reload still
 * works. Passing `location.href` explicitly would do the same thing today and would be one
 * refactor away from dropping the query.
 */
function pushBackEntry(): boolean {
  try {
    window.history.pushState(BACK_ENTRY_STATE, '');
    return true;
  } catch {
    return false;
  }
}
