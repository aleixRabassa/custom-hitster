/**
 * The press-and-hold BINDING: collect pointer coordinates, run one timer, and tell the caller
 * whether the click it is about to receive has already been spent.
 *
 * ===========================================================================
 *  THIS FILE HOLDS NO THRESHOLDS AND MAKES NO DECISIONS.
 *
 *  `LONG_PRESS_DURATION_MS` and `exceedsLongPressMovement` are in
 *  `src/game/gestures.ts`, beside the tap bound they have to stay clear of, and
 *  they are tested there in the node environment. What is left here is a
 *  `setTimeout`, three refs and an unmount cleanup -- thin enough that reading
 *  it is sufficient review, which is the same bargain `useCardGestures` makes.
 * ===========================================================================
 *
 * ===========================================================================
 *  A TIMER, NOT ARITHMETIC OVER `event.timeStamp` -- AND THAT IS NOT A
 *  DEPARTURE FROM `useCardGestures`.
 *
 *  That hook measures a COMPLETED sequence: both ends exist by the time it has
 *  to answer, so it subtracts two event timestamps and never touches a clock.
 *  A hold has to answer while the finger is still down -- the whole point is
 *  that the suggestion highlights DURING the press, so the player learns the
 *  gesture worked without lifting -- and there is no second event to subtract.
 *
 *  So the timer is unavoidable, and it is the one thing in this file that needs
 *  cleaning up: it is cleared on pointer-up, on cancel, on leave, on a drift
 *  past the bound, and on unmount.
 * ===========================================================================
 *
 * ## The click that follows a hold has to be swallowed
 *
 * `click` fires AFTER `pointerup`, so a hold that has already selected would be followed by a
 * click that -- with nothing else selected -- starts a game. `consumeLongPress()` is how the
 * caller asks "was this click already spent", and it answers true exactly once per hold.
 *
 * The flag is reset by the next `pointerdown` rather than by the click, because a hold whose
 * pointer never produced a click (released off the button, or cancelled by a scroll) would
 * otherwise leave it set and swallow an unrelated press later.
 */

import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

import { LONG_PRESS_DURATION_MS, exceedsLongPressMovement } from '../game/gestures';

/** Everything the caller must spread onto the element. One object, so half of it cannot be taken. */
export interface LongPressProps {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}

export interface UseLongPressOptions {
  /** Fired once, while the pointer is still down, when the hold reaches the threshold. */
  onLongPress: () => void;
  /** False while the screen is busy. No timer is started and no hold can fire. */
  isEnabled: boolean;
}

export interface UseLongPressResult {
  pressProps: LongPressProps;
  /**
   * True exactly once after a hold fired, and false otherwise.
   *
   * Called FIRST in the element's own `onClick`, which must return immediately when it is true.
   */
  consumeLongPress: () => boolean;
}

export function useLongPress({ onLongPress, isEnabled }: UseLongPressOptions): UseLongPressResult {
  /*
    All three are refs and none is state, for the reason `useCardGestures` gives about its own:
    a press produces a pointer event per frame while the finger moves, and re-rendering the
    button on each one would be a lot of work to draw nothing new. Nothing here is read during
    render -- the SELECTED look comes from the rows, not from this hook.
  */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const hasFiredRef = useRef(false);

  const cancelPress = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  };

  // The one thing in this file that outlives an event. Without it a hold in flight when the
  // screen is replaced by the game fires into an unmounted component.
  useEffect(() => cancelPress, []);

  const pressProps: LongPressProps = {
    onPointerDown: (event) => {
      /*
        RESETS EVERYTHING, rather than only recording the start. Same rule, and the same reason,
        as `useCardGestures.handlePointerDown`: a pointer that went down here and came up
        somewhere else leaves this element's state behind, and the next press would then inherit
        it -- the gesture would appear to work every other time.
      */
      cancelPress();
      hasFiredRef.current = false;

      if (!isEnabled) return;

      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        hasFiredRef.current = true;
        onLongPress();
      }, LONG_PRESS_DURATION_MS);
    },

    onPointerMove: (event) => {
      const start = startRef.current;
      if (start === null) return;

      // A touch pointer is implicitly captured by the element it went down on, so these keep
      // arriving even once the finger has travelled off the button -- which is exactly the
      // sequence that must not select.
      if (
        exceedsLongPressMovement({
          deltaX: event.clientX - start.x,
          deltaY: event.clientY - start.y,
        })
      ) {
        cancelPress();
      }
    },

    onPointerUp: cancelPress,

    // A scroll starting under the finger cancels the pointer outright. That is the commonest way
    // a hold on this screen ends without selecting, because the suggestions live in the one
    // column of the app that is expected to scroll.
    onPointerCancel: cancelPress,

    // The mouse equivalent: a button pressed and then dragged off it. Touch does not need this
    // (see the implicit capture above), and it is harmless there because the pointer does not
    // leave until it is already up.
    onPointerLeave: cancelPress,

    /*
      Android raises a context menu at roughly this same threshold, and it would land on top of
      the selection the hold just made. Prevented rather than styled around, because a menu
      appearing mid-gesture is what makes a long press feel like it went wrong.

      The cost is the desktop right-click menu on these buttons, which is accepted: a `<button>`
      offers nothing in it that a player wants.
    */
    onContextMenu: (event) => {
      event.preventDefault();
    },
  };

  return {
    pressProps,
    consumeLongPress: () => {
      const hasFired = hasFiredRef.current;
      hasFiredRef.current = false;

      return hasFired;
    },
  };
}
