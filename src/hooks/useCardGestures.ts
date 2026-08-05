/**
 * The React seam between Motion's drag mechanics and the pure decisions in
 * `src/game/gestures.ts`.
 *
 * Deliberately thin. Every threshold, every comparison, and both misreading risks live in
 * `gestures.ts`, where they are unit-tested on both sides of every boundary; this file only
 * collects coordinates, asks, and dispatches. If logic starts accumulating here it belongs
 * back in `gestures.ts` -- that is the whole point of the split, and the reason it exists is
 * that jsdom cannot exercise a drag at all.
 *
 * ===========================================================================
 *  POINTER STATE IS IN REFS, NOT STATE, AND THAT IS NOT AN OPTIMISATION.
 *
 *  A drag produces a pointer event per animation frame. Putting the start
 *  coordinates in `useState` would re-render the card on every one of them,
 *  which fights Motion for control of the same transform it is animating --
 *  visible as a stutter, and on a mid-range phone as a dropped gesture.
 *
 *  `exitDirection` IS state, because it is read during render (the exit
 *  animation needs it) and it changes exactly once per card, at commit.
 * ===========================================================================
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { isTap, shouldCommitSwipe, swipeDirection } from '../game/gestures';
import type { CommitDirection } from '../game/gestures';

/**
 * The part of Motion's `PanInfo` this hook reads.
 *
 * Declared locally rather than imported, because `PanInfo` is exported from `motion-dom` --
 * a TRANSITIVE dependency of `motion`, absent from `package.json` and not re-exported by
 * `motion/react`. Importing it would mean depending on a package we do not declare, and
 * pnpm's strict linking is right to make that awkward.
 *
 * This is a structural SUPERTYPE of `PanInfo` (it requires strictly fewer fields), so a
 * handler typed against it is soundly assignable to Motion's `onDragEnd` under normal
 * parameter contravariance -- the compiler checks that for us at the `Card` call site.
 */
export interface DragEndInfo {
  /** Distance from where the drag started, in CSS pixels. */
  offset: { x: number; y: number };
  /** Velocity at release, in CSS pixels/second. */
  velocity: { x: number; y: number };
}

/**
 * The part of a pointer event this hook reads -- likewise a supertype, of both
 * `React.PointerEvent` and the DOM's own `PointerEvent`.
 *
 * `timeStamp` is the event's OWN clock rather than a `Date.now()` call in the handler. Both
 * ends of the sequence are then measured on the same monotonic timeline, so the elapsed time
 * cannot be skewed by a slow frame between the event firing and React delivering it.
 */
export interface GesturePointer {
  clientX: number;
  clientY: number;
  timeStamp: number;
}

/**
 * Props to spread onto the draggable card element.
 *
 * Returned as one object so `Card` cannot accidentally take the drag props without the
 * pointer props: tap detection depends on `onPointerDown` having recorded a start, and a card
 * that drags but never flips is a plausible half-wiring.
 */
export interface CardGestureProps {
  drag: 'x';
  dragConstraints: { left: number; right: number };
  dragElastic: number;
  dragMomentum: boolean;
  onDragStart: () => void;
  onDragEnd: (event: unknown, info: DragEndInfo) => void;
  onPointerDown: (event: GesturePointer) => void;
  onPointerUp: (event: GesturePointer) => void;
  onPointerCancel: () => void;
}

export interface UseCardGesturesOptions {
  /** Called for a tap. */
  onFlip: () => void;
  /** Called for a committed swipe. */
  onNext: () => void;
  /**
   * False whenever the session is not playable -- `preparing`, `ended`, or mid-transition.
   *
   * Guards the LAST-CARD RACE: committing a swipe on the final card advances the deck to
   * `ended`, and a second callback arriving after that would act on a session that no longer
   * has a current card.
   */
  isEnabled: boolean;
}

export interface UseCardGesturesResult {
  gestureProps: CardGestureProps;
  /**
   * Which way the last committed swipe went, for the exit animation.
   *
   * Sticky rather than transient: `AnimatePresence` reads it while the outgoing card is
   * still animating, which is after the commit that set it. Defaults to `left` so a keyboard
   * advance -- which has no direction -- exits consistently.
   */
  exitDirection: CommitDirection;
}

/** Snap-back resistance while dragging against the constraints. 0 = rigid, 1 = no resistance. */
const DRAG_ELASTIC = 0.35;

export function useCardGestures({
  onFlip,
  onNext,
  isEnabled,
}: UseCardGesturesOptions): UseCardGesturesResult {
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const didDragRef = useRef(false);
  /** Per-gesture latch. See `handleDragEnd`. */
  const hasCommittedRef = useRef(false);
  const [exitDirection, setExitDirection] = useState<CommitDirection>('left');

  /**
   * Pointer-down RESETS the whole gesture, rather than only recording the start.
   *
   * Resetting here as well as on pointer-up is what makes a LOST pointer-up survivable. If
   * the player releases outside the card -- having dragged it away from under their finger,
   * which is the normal case for a big swipe -- React's `onPointerUp` on this element never
   * fires, and `didDragRef` would stay true. The next genuine tap would then be rejected as
   * "a drag was recognised", and tap-to-flip would appear to work only every other time.
   */
  const handlePointerDown = useCallback((event: GesturePointer) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    didDragRef.current = false;
    hasCommittedRef.current = false;
  }, []);

  const handleDragStart = useCallback(() => {
    didDragRef.current = true;
  }, []);

  const handleDragEnd = useCallback(
    (_event: unknown, info: DragEndInfo) => {
      const drag = { offsetX: info.offset.x, velocityX: info.velocity.x };

      if (!shouldCommitSwipe(drag)) return; // Motion snaps the card back to the constraints.
      // The latch: a fast flick can produce overlapping end callbacks, and advancing twice
      // costs the player a card they never saw -- there is no way back.
      if (hasCommittedRef.current) return;
      if (!isEnabled) return;

      hasCommittedRef.current = true;
      setExitDirection(swipeDirection(drag));
      // No `stop()` on the audio here: `GameScreen` already stops on card change (Phase 4),
      // keyed on card id, so it covers a swipe for free. Verified rather than duplicated --
      // two owners of one stop rule is how one of them quietly stops being called.
      onNext();
    },
    [isEnabled, onNext],
  );

  const handlePointerUp = useCallback(
    (event: GesturePointer) => {
      const start = pointerStartRef.current;
      const didDrag = didDragRef.current;

      // Cleared before the decision, so an early return cannot leave stale state behind.
      pointerStartRef.current = null;
      didDragRef.current = false;

      if (start === null || !isEnabled) return;
      // A committed swipe is never also a tap. `didDrag` almost always catches this already;
      // the latch covers the case where Motion's end callback ran first.
      if (hasCommittedRef.current) return;

      const isFlip = isTap({
        deltaX: event.clientX - start.x,
        deltaY: event.clientY - start.y,
        elapsedMs: event.timeStamp - start.t,
        didDrag,
      });

      if (isFlip) onFlip();
    },
    [isEnabled, onFlip],
  );

  const handlePointerCancel = useCallback(() => {
    pointerStartRef.current = null;
    didDragRef.current = false;
  }, []);

  const gestureProps = useMemo<CardGestureProps>(
    () => ({
      drag: 'x',
      // Constrained to the origin on both axes of travel, which is what gives snap-back for
      // free: released below threshold, Motion animates the card back to 0 itself.
      dragConstraints: { left: 0, right: 0 },
      dragElastic: DRAG_ELASTIC,
      // No momentum: a card that keeps coasting after release would still be moving when the
      // next card mounts underneath it.
      dragMomentum: false,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    }),
    [handleDragStart, handleDragEnd, handlePointerDown, handlePointerUp, handlePointerCancel],
  );

  return { gestureProps, exitDirection };
}
