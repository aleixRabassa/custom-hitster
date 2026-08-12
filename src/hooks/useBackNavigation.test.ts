/**
 * @vitest-environment jsdom
 *
 * ===========================================================================
 *  WHAT jsdom ACTUALLY DOES HERE, MEASURED 2026-08-12 RATHER THAN ASSUMED.
 *
 *  1. `history.back()` DOES fire `popstate`. Unlike a drag -- which Motion
 *     reads from geometry jsdom never computes -- the traversal is really
 *     implemented, so these tests exercise the hook's own listener rather than
 *     a double.
 *
 *  2. It fires ASYNCHRONOUSLY, and NOT within one macrotask: a `setTimeout(0)`
 *     is too early, and the event was observed at roughly 10ms. Every assertion
 *     that follows a traversal therefore waits on a real timer (`settle`), and
 *     that delay is also what makes the cleanup-ordering hazard REAL rather than
 *     theoretical -- there is a window in which a removed-too-late listener
 *     would still be attached.
 *
 *  3. `history.length` IS NOT AN INSTRUMENT, in jsdom or in a browser. Going
 *     back does not shorten it -- the forward entry is retained -- so a stray
 *     entry and a cleanly removed one both read as the same number. The plan
 *     asked for a length assertion; what it wanted was "no entry left behind",
 *     and the honest way to check that is WHERE THE CURRENT ENTRY IS: a sentinel
 *     is written into the base entry's state, and after unmount the current
 *     entry must be that sentinel again rather than one of the hook's.
 * ===========================================================================
 */

import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetBackNavigationTraversals, useBackNavigation } from './useBackNavigation';

/** Marks the entry the hook must always come back to. Nothing in the app writes history state. */
const BASE_STATE = { base: 'test-base' };

interface Handlers {
  onCloseDeckActions: ReturnType<typeof vi.fn>;
  onCloseExitConfirm: ReturnType<typeof vi.fn>;
  onRequestExit: ReturnType<typeof vi.fn>;
}

function makeHandlers(): Handlers {
  return {
    onCloseDeckActions: vi.fn(),
    onCloseExitConfirm: vi.fn(),
    onRequestExit: vi.fn(),
  };
}

interface ProbeProps extends Handlers {
  isDeckActionsOpen?: boolean;
  isExitConfirmOpen?: boolean;
}

/** The smallest possible host: the hook renders nothing, so neither does this. */
function Probe({ isDeckActionsOpen = false, isExitConfirmOpen = false, ...handlers }: ProbeProps) {
  useBackNavigation({ isDeckActionsOpen, isExitConfirmOpen, ...handlers });

  return null;
}

/**
 * Wait long enough for a queued traversal to land, inside `act` so any state update it causes is
 * flushed before the assertion. 50ms against a measured ~10ms -- generous on purpose, because the
 * failure mode of being too quick is a flaky suite that reads as a hook bug.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** A back press, as the platform delivers it: a real traversal, then the wait for `popstate`. */
async function pressBack() {
  window.history.back();
  await settle();
}

describe('useBackNavigation', () => {
  beforeEach(() => {
    // Module state outlives a test -- Vitest isolates per FILE. An armed counter would swallow the
    // next test's first back press, which is exactly the failure this reset exists to prevent.
    resetBackNavigationTraversals();
    // Whatever entry the previous test finished on becomes this test's base. Assertions are
    // relative to it, so the tests do not care how deep jsdom's stack has grown.
    window.history.replaceState(BASE_STATE, '');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should push exactly one history entry on mount', async () => {
    // ===================================================================
    //  "EXACTLY ONE" IS A NET, AND UNDER STRICTMODE IT IS NOT ONE CALL.
    //
    //  React runs mount -> cleanup -> mount in development, so the hook
    //  pushes twice and traverses back once. Counting `pushState` calls
    //  alone would therefore assert the wrong thing; the number that
    //  matters is pushes minus traversals, which must be 1 in both modes.
    //  If it were 2, back would need two presses to reach the game -- the
    //  naive-implementation bug this test exists for.
    // ===================================================================
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const backSpy = vi.spyOn(window.history, 'back');
    const handlers = makeHandlers();

    render(createElement(StrictMode, null, createElement(Probe, handlers)));
    await settle();

    expect(pushSpy.mock.calls.length - backSpy.mock.calls.length).toBe(1);
    // And the entry is really the current one, so there is something for a press to consume.
    expect(window.history.state).not.toEqual(BASE_STATE);
    // The double-mount must not have been read as a back press -- see the phantom-pop block in the
    // hook. WEAK ON PURPOSE, and labelled rather than trusted: jsdom DISCARDS a queued traversal
    // when a `pushState` beats it to the tick (measured 2026-08-12), so the phantom this asserts
    // against cannot occur here at all and `pendingCleanupTraversals` could be deleted with the
    // suite still green. It is Chrome that re-resolves the traversal and fires the phantom.
    expect(handlers.onRequestExit).not.toHaveBeenCalled();
  });

  it('should leave no history entry behind after unmount', async () => {
    // ===================================================================
    //  THE STRAY-ENTRY TEST. On a device the failure presents as a back
    //  button that does nothing: the player exits the game properly, lands
    //  on the landing screen, presses back, and the app does not close --
    //  because a leftover entry silently absorbs the press. That is a
    //  worse bug than the one this whole feature fixes, and nobody would
    //  connect it to the game screen.
    //
    //  Asserted as a POSITION rather than as `history.length`, which
    //  cannot see it -- see the file header.
    // ===================================================================
    const handlers = makeHandlers();
    const { unmount } = render(createElement(Probe, handlers));
    await settle();

    expect(window.history.state).not.toEqual(BASE_STATE);

    unmount();
    await settle();

    expect(window.history.state).toEqual(BASE_STATE);
  });

  it('should not run the decision when cleanup removes its own entry', async () => {
    // ===================================================================
    //  THE OUTCOME HALF OF THE CLEANUP HAZARD: a teardown must never be
    //  read as a back press, or the exit confirmation opens on a screen
    //  that is unmounting.
    //
    //  HONEST ABOUT ITS OWN STRENGTH -- this passes with the hook's two
    //  cleanup lines in EITHER order, verified 2026-08-12 by swapping
    //  them. The traversal is queued rather than synchronous, so the
    //  listener is gone before the event lands whichever line runs first.
    //  What it does catch is a cleanup that runs the decision directly, or
    //  one that navigates without removing the listener at all. The
    //  ordering itself is pinned by the next test.
    // ===================================================================
    const handlers = makeHandlers();
    const { unmount } = render(createElement(Probe, handlers));
    await settle();

    unmount();
    await settle();

    expect(handlers.onRequestExit).not.toHaveBeenCalled();
    expect(handlers.onCloseExitConfirm).not.toHaveBeenCalled();
    expect(handlers.onCloseDeckActions).not.toHaveBeenCalled();
  });

  it('should remove the listener before it navigates on cleanup', async () => {
    // ===================================================================
    //  THE ORDERING, AS A CALL ORDER, BECAUSE THE BEHAVIOUR CANNOT SEE IT.
    //
    //  A white-box assertion is the wrong default and the right answer
    //  here: the two orderings are behaviourally identical for as long as
    //  both statements sit in one synchronous block, so the only way to
    //  stop the safe one being "simplified" away is to assert it directly.
    //  It stops being identical the moment the cleanup grows an `await`,
    //  an early return between the lines, or a second listener -- at which
    //  point the navigation would be read as a back press on a screen that
    //  is unmounting.
    // ===================================================================
    const order: string[] = [];
    // The real method, captured BEFORE the spy replaces it. Reaching for
    // `EventTarget.prototype.removeEventListener.call(window, …)` instead throws in jsdom -- its
    // `window` is not a plain `EventTarget` instance, so the branded IDL check rejects it.
    const realRemove = window.removeEventListener.bind(window);
    const removeSpy = vi
      .spyOn(window, 'removeEventListener')
      .mockImplementation((type, listener, options) => {
        if (type === 'popstate') order.push('remove-listener');

        realRemove(type, listener, options);
      });
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {
      order.push('navigate');
    });

    const { unmount } = render(createElement(Probe, makeHandlers()));
    await settle();

    unmount();

    expect(order).toEqual(['remove-listener', 'navigate']);

    removeSpy.mockRestore();
    backSpy.mockRestore();

    // `back` was stubbed, so the entry the hook pushed is still current. Put the history back where
    // the next test expects it rather than leaving this one's mess behind.
    window.history.back();
    await settle();
  });

  it('should preserve the query string', async () => {
    // A shared deck link is `?playlist=…&seed=…`. `App.tsx` reads it in a lazy initialiser that has
    // long since run by the time a game is on screen, so clobbering it would not break the deal --
    // it would break a mid-game RELOAD, and it would also break copying the link out of the address
    // bar, which is what the params are left visible for.
    window.history.replaceState(BASE_STATE, '', '/?playlist=37i9dQZF1DXcBWIGoYBM5M&seed=a1b2c3d4');
    const before = window.location.href;

    const handlers = makeHandlers();
    const { unmount } = render(createElement(Probe, handlers));
    await settle();

    expect(window.location.href).toBe(before);
    expect(window.location.search).toBe('?playlist=37i9dQZF1DXcBWIGoYBM5M&seed=a1b2c3d4');

    // Including across a press, which pushes a replacement entry, and across the teardown.
    await pressBack();
    expect(window.location.href).toBe(before);

    unmount();
    await settle();
    expect(window.location.href).toBe(before);
  });

  it('should request an exit on a back press', async () => {
    const handlers = makeHandlers();
    render(createElement(Probe, handlers));
    await settle();

    await pressBack();

    expect(handlers.onRequestExit).toHaveBeenCalledTimes(1);
    expect(handlers.onCloseDeckActions).not.toHaveBeenCalled();
    expect(handlers.onCloseExitConfirm).not.toHaveBeenCalled();
  });

  it('should keep intercepting after a press has consumed the entry', async () => {
    // ===================================================================
    //  THE RE-PUSH INVARIANT: EXACTLY ONE ENTRY OUTSTANDING, ALWAYS.
    //
    //  A press consumes the entry. Without a replacement the interception
    //  would work once per game -- press back, cancel the confirmation,
    //  press back again, and the activity closes. That is the original bug
    //  delayed by one press, which makes it harder to report rather than
    //  less severe.
    // ===================================================================
    const handlers = makeHandlers();
    const { unmount } = render(createElement(Probe, handlers));
    await settle();

    await pressBack();
    await pressBack();
    await pressBack();

    expect(handlers.onRequestExit).toHaveBeenCalledTimes(3);

    // And the accounting still balances: three presses and three replacements leave exactly one
    // entry, so the teardown lands back on the base.
    unmount();
    await settle();
    expect(window.history.state).toEqual(BASE_STATE);
  });

  it('should read the dialog flags from the latest render', async () => {
    // ===================================================================
    //  THE LISTENER IS ATTACHED ONCE AND NEVER RE-ATTACHED, WHICH IS WHY
    //  THIS TEST EXISTS.
    //
    //  Putting the flags in the effect's dependency array is the obvious
    //  implementation, and it would push a fresh entry every time a dialog
    //  opened -- so a game would accumulate one entry per press and back
    //  would take as many presses to leave as the player had opened
    //  panels. The latest-ref pattern is what avoids that, and this is the
    //  assertion that it actually sees the new flags.
    // ===================================================================
    const handlers = makeHandlers();
    const { rerender } = render(createElement(Probe, handlers));
    await settle();

    rerender(createElement(Probe, { ...handlers, isDeckActionsOpen: true }));
    await pressBack();

    expect(handlers.onCloseDeckActions).toHaveBeenCalledTimes(1);
    expect(handlers.onRequestExit).not.toHaveBeenCalled();

    rerender(createElement(Probe, { ...handlers, isExitConfirmOpen: true }));
    await pressBack();

    expect(handlers.onCloseExitConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onRequestExit).not.toHaveBeenCalled();
  });
});
