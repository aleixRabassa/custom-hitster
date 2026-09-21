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
 *  POINTER STATE IS IN REFS AND MOTION VALUES, NEVER IN `useState`, AND THAT
 *  IS NOT AN OPTIMISATION.
 *
 *  A drag produces a pointer event per animation frame. Putting the start
 *  coordinates -- or, since 2026-09-21, the previous card's position -- in
 *  `useState` would re-render the card on every one of them, which fights
 *  Motion for control of the same transform it is animating: visible as a
 *  stutter, and on a mid-range phone as a dropped gesture.
 *
 *  That is why the previous card's travel is a `MotionValue` and why even its
 *  `display` is a `useTransform` off that value rather than a conditional
 *  render. The peek costs this component ZERO renders while the finger is
 *  down; React learns about the gesture exactly once, when it commits.
 *
 *  Until 2026-09-19 the exit direction WAS state (set at commit, read by the
 *  card's exit animation) -- and it was set ONLY by a drag, so a keyboard
 *  advance flew every card out the "back" way once left meant PREVIOUS. The
 *  animation now reads the index delta in `CardStack` (`deckMovementFor`),
 *  which drag and keyboard both move.
 * ===========================================================================
 *
 * ===========================================================================
 *  THE HOOK DOES HAVE SOMETHING TO SAY ABOUT HOW A CARD ARRIVES AGAIN
 *  (2026-09-21), AND THIS FILE SAID THE OPPOSITE UNTIL THEN.
 *
 *  A step back is no longer an animation the release PLAYS; it is an animation
 *  the finger PERFORMS and the release only finishes. So the hook owns the
 *  previous card's travel (`previousCardStyle`) and reports how far the drag
 *  got (`onPrevious(fromProgress)`), so the card that mounts in its place can
 *  pick the journey up rather than restart it.
 *
 *  What has NOT come back is a stored DIRECTION. Which way the deck moved is
 *  still `deckMovementFor` over the index delta in `CardStack`, so drag and
 *  keyboard still agree by construction -- see the long note there. This hook
 *  reports a distance, never a direction.
 * ===========================================================================
 */

import { animate, useMotionValue, useTransform } from 'motion/react';
import type { AnimationPlaybackControls, MotionValue } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

import {
  isTap,
  previousCardProgress,
  shouldCommitSwipe,
  swipeDirection,
  swipeIntent,
} from '../game/gestures';

/**
 * The part of Motion's `PanInfo` this hook reads.
 *
 * Declared locally rather than imported, because `PanInfo` is exported from `motion-dom` --
 * a TRANSITIVE dependency of `motion`, absent from `package.json` and not re-exported by
 * `motion/react`. Importing it would mean depending on a package we do not declare, and
 * pnpm's strict linking is right to make that awkward.
 *
 * This is a structural SUPERTYPE of `PanInfo` (it requires strictly fewer fields), so a
 * handler typed against it is soundly assignable to Motion's `onDrag` / `onDragEnd` under
 * normal parameter contravariance -- the compiler checks that for us at the `Card` call site.
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
  /** Per side, and the asymmetry is the feature -- see `DRAG_ELASTIC`. */
  dragElastic: { top: number; right: number; bottom: number; left: number };
  dragMomentum: boolean;
  onDragStart: () => void;
  onDrag: (event: unknown, info: DragEndInfo) => void;
  onDragEnd: (event: unknown, info: DragEndInfo) => void;
  onPointerDown: (event: GesturePointer) => void;
  onPointerUp: (event: GesturePointer) => void;
  onPointerCancel: () => void;
}

/**
 * The inline style for the previous card, driven entirely by the finger.
 *
 * Both values are `MotionValue`s derived from one source, so moving the card updates the
 * element without React rendering anything.
 */
export interface PreviousCardStyle {
  /**
   * `100%` parked (one card-width to the right), `0%` home.
   *
   * A PERCENTAGE, not pixels: the element is `absolute inset-0` on a wrapper sized from
   * `--card-width`, so `100%` IS one card-width at every viewport, with nothing to keep in
   * step with the CSS clamp.
   */
  x: MotionValue<string>;
  /**
   * `none` until the drag engages the card, `block` from the first pixel.
   *
   * ===========================================================================
   *  IT MUST BE `display`, NOT `opacity` AND NOT `visibility`.
   *
   *  The previous card parks one full card-width to the RIGHT of the deck, and
   *  an element that is merely transparent or merely invisible is still LAID
   *  OUT: it would extend the page by a card width past the deck on every
   *  screen of the game, which on a phone is a permanent horizontal scroll.
   *  `display: none` is the one of the three that takes the element out of
   *  layout entirely.
   *
   *  It is also why this is a `MotionValue` rather than a conditional render.
   *  `{isPeeking ? <card /> : null}` needs React state, and the only place to
   *  set it is the per-frame drag handler -- the exact thing the header above
   *  refuses.
   * ===========================================================================
   */
  display: MotionValue<string>;
}

export interface UseCardGesturesOptions {
  /** Called for a tap. */
  onFlip: () => void;
  /** Called for a committed RIGHT swipe. */
  onNext: () => void;
  /**
   * Called for a committed LEFT swipe (2026-09-18). The mapping is `swipeIntent` in `gestures.ts`.
   *
   * `fromProgress` is how far the finger had already brought the previous card back in, on
   * `previousCardProgress`'s 0..1 scale, at the moment of release. The caller hands it to the
   * card that mounts in its place so the entrance CONTINUES the drag instead of restarting it
   * from off-screen -- see `dragEntrance` in `CardStack`.
   */
  onPrevious: (fromProgress: number) => void;
  /**
   * Whether there is a card before this one. False on card 1.
   *
   * Only the peek reads it: with no previous card there is nothing to pull in, so a left drag
   * does nothing at all rather than dragging an empty rectangle onto the screen. The COMMIT is
   * deliberately NOT guarded by it -- `onPrevious` is still called and the reducer still
   * declines, returning the same state object on card 1. One owner of that rule is enough.
   */
  hasPrevious: boolean;
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
   * Goes on the deck wrapper, and it is MEASURED rather than observed.
   *
   * The 1:1 finger mapping needs the card's width in CSS pixels, and the card is fluid
   * (`--card-width` is a `clamp()` over three viewport terms, so no constant here could be
   * right). `offsetWidth` is read ONCE per gesture, at drag start, into a ref -- reading it per
   * pointer move would force a layout recalculation on every frame of the drag, which is the
   * one thing a gesture cannot afford.
   */
  deckRef: RefObject<HTMLDivElement | null>;
  previousCardStyle: PreviousCardStyle;
}

/**
 * Snap-back resistance while dragging BEYOND the constraints. 0 = rigid, 1 = no resistance.
 *
 * ===========================================================================
 *  APPLIED TO THE RIGHT ONLY, AND THE `left: 0` BESIDE IT IS A FEATURE REQUEST
 *  RATHER THAN A TUNING CHOICE (2026-09-21).
 *
 *  The card used to be elastic on both sides, so a left drag pulled it left --
 *  and then, on release, dropped it back and played a step-back animation.
 *  Two objects moved for one gesture: the card the finger was on went one way
 *  and came back, and the card that actually arrived was a third one the
 *  player had never touched.
 *
 *  The developer's instruction is that the card "nunca pasara el limite
 *  izquierdo de su posicion inicial". `dragElastic.left = 0` against
 *  `dragConstraints.left = 0` is exactly that and nothing more: Motion clamps
 *  the element AT the constraint instead of easing past it. Rightward travel
 *  is untouched, so a right drag still feels the way it always has, and a
 *  player can still pull right and slide back to rest without releasing.
 *
 *  Note what this does NOT change: `info.offset` is the POINTER's offset from
 *  where the drag began, not the element's transform. So `shouldCommitSwipe`
 *  and `swipeDirection` see the full leftward travel and commit exactly as
 *  they did -- the finger is still measured even though the card is pinned.
 * ===========================================================================
 */
const DRAG_ELASTIC = 0.35;

/**
 * How long the previous card takes to slide back OUT when a drag is released below the
 * threshold, in seconds.
 *
 * The same number as `EXIT_DURATION_S` in `Card.tsx`, and duplicated for the same reason that
 * one is duplicated from `--duration-card-exit`: there is no import that carries a duration
 * across these three layers. Arriving and giving up should take the same time.
 *
 * It is the SHORT duration, and that is the right one here: a cancelled peek retreats over
 * whatever the finger pulled in, which is the same sort of distance a dragged step back has
 * left to cover. `Card.tsx`'s `TRAVEL_DURATION_S` -- the one a card crossing the whole screen
 * takes since 2026-09-22 -- would make giving up take ~781ms, three times the drag it undoes.
 *
 * One caveat, documented rather than fixed: this is an IMPERATIVE `animate()`, so it does not
 * read `MotionConfig reducedMotion="user"` from `src/main.tsx` the way a declarative animation
 * does. A cancelled peek therefore still slides out under `prefers-reduced-motion: reduce`. It
 * is 250ms of a card the player was themselves dragging a moment earlier, so it is a row in
 * `development.md` §5 rather than a blocker -- and no component in this app reads the
 * preference itself (Phase 7, decision 3), which is why it is not simply branched on here.
 */
const PEEK_RETURN_DURATION_S = 0.25;

/** Parked: one whole card-width to the right, its left edge on the current card's right edge. */
const PEEK_PARKED = 0;

export function useCardGestures({
  onFlip,
  onNext,
  onPrevious,
  hasPrevious,
  isEnabled,
}: UseCardGesturesOptions): UseCardGesturesResult {
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const didDragRef = useRef(false);
  /** Per-gesture latch. See `handleDragEnd`. */
  const hasCommittedRef = useRef(false);
  /** The deck's width in CSS pixels, sampled at drag start. See `deckRef`. */
  const cardWidthRef = useRef(0);
  const deckRef = useRef<HTMLDivElement | null>(null);
  /** The running slide-out, so a new drag can interrupt one still in flight. */
  const peekReturnRef = useRef<AnimationPlaybackControls | null>(null);

  /**
   * How far the previous card has been pulled in, 0..1. THE ONE SOURCE for both style values.
   *
   * A fraction rather than pixels, so the derived values stay resolution-independent and the
   * card's fluid width never has to be written down twice -- see `PreviousCardStyle.x`.
   */
  const peekProgress = useMotionValue(PEEK_PARKED);
  const peekX = useTransform(peekProgress, (progress) => `${(1 - progress) * 100}%`);
  // The return annotation is load-bearing: `MotionValue` is invariant in its parameter, so an
  // inferred `MotionValue<'block' | 'none'>` is not assignable to the `MotionValue<string>` the
  // style interface declares -- and widening it at the interface would be the wrong end to fix.
  const peekDisplay = useTransform(peekProgress, (progress): string =>
    progress > PEEK_PARKED ? 'block' : 'none',
  );

  /**
   * Send the previous card back out of the way.
   *
   * `animated` is the difference between GIVING UP and HANDING OVER. A drag released below the
   * threshold slides the card back out over `PEEK_RETURN_DURATION_S`; a committed step back
   * parks it INSTANTLY, because a real `Card` is about to mount at the exact spot it is
   * leaving and an animation here would drag a ghost of it home alongside the real one.
   */
  const parkPeek = useCallback(
    (animated: boolean) => {
      peekReturnRef.current?.stop();
      peekReturnRef.current = null;

      if (peekProgress.get() === PEEK_PARKED) return;

      if (!animated) {
        peekProgress.set(PEEK_PARKED);

        return;
      }

      peekReturnRef.current = animate(peekProgress, PEEK_PARKED, {
        duration: PEEK_RETURN_DURATION_S,
      });
    },
    [peekProgress],
  );

  /*
    The hook's only effect, and it does nothing but stop the slide-out on the way out.

    `animate()` is imperative and outlives the component that started it -- so a peek released
    below the threshold on the LAST card, where the commit ends the session and unmounts the deck
    mid-slide, would leave an animation driving a motion value nobody reads. Harmless today and
    cheap to make impossible.
  */
  useEffect(
    () => () => {
      peekReturnRef.current?.stop();
    },
    [],
  );

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
    // Sampled once per gesture: `offsetWidth` forces a layout, and a drag is a frame budget.
    cardWidthRef.current = deckRef.current?.offsetWidth ?? 0;
    // A drag beginning while the last peek is still sliding out takes that card over.
    peekReturnRef.current?.stop();
    peekReturnRef.current = null;
  }, []);

  /**
   * The previous card follows the finger. THE ONLY PER-FRAME WORK IN THIS HOOK.
   *
   * Writes a `MotionValue` and nothing else -- no `setState`, no render. See the header.
   */
  const handleDrag = useCallback(
    (_event: unknown, info: DragEndInfo) => {
      if (!isEnabled || !hasPrevious) return;

      peekProgress.set(previousCardProgress(info.offset.x, cardWidthRef.current));
    },
    [hasPrevious, isEnabled, peekProgress],
  );

  const handleDragEnd = useCallback(
    (_event: unknown, info: DragEndInfo) => {
      const drag = { offsetX: info.offset.x, velocityX: info.velocity.x };

      if (!shouldCommitSwipe(drag)) {
        // Motion snaps the card back to the constraints; the previous card slides back out.
        parkPeek(true);

        return;
      }
      // The latch: a fast flick can produce overlapping end callbacks, and advancing twice
      // costs the player a card they never saw -- there is no way back.
      if (hasCommittedRef.current) return;

      if (!isEnabled) {
        parkPeek(true);

        return;
      }

      hasCommittedRef.current = true;

      // No `stop()` on the audio here: `GameScreen` already stops on card change (Phase 4),
      // keyed on card id, so it covers a swipe in EITHER direction for free. Verified rather than
      // duplicated -- two owners of one stop rule is how one of them quietly stops being called.
      //
      // And no animation direction recorded here either: the deal is played FORWARD or in
      // REVERSE according to how the DECK moved, which `CardStack` derives from the index
      // (`deckMovementFor`). A right throw calls `onNext`, the index rises, and the card flies
      // out right; a left throw calls `onPrevious`, the index falls, and the card the finger has
      // been pulling in finishes its journey. Nothing to keep in step, and nothing for a
      // keyboard advance to miss.
      //
      // Which way is which is `swipeIntent`'s decision, not this file's -- see `gestures.ts`.
      if (swipeIntent(swipeDirection(drag)) === 'next') {
        parkPeek(false);
        onNext();

        return;
      }

      /*
        THE HANDOFF, AND THE ORDER OF THESE THREE LINES IS THE WHOLE OF IT.

        Read where the finger left the previous card, park the peek INSTANTLY, and only then
        tell the session. `onPrevious` lowers the index, which mounts the returned-to card as
        the deck's current card, and `fromProgress` is what lets that card start where the peek
        stopped instead of jumping back off-screen for a fresh 250ms -- which is precisely the
        seam the player would read as the animation restarting under their thumb.
      */
      const fromProgress = previousCardProgress(info.offset.x, cardWidthRef.current);

      parkPeek(false);
      onPrevious(fromProgress);
    },
    [isEnabled, onNext, onPrevious, parkPeek],
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
    // A cancelled pointer never reaches `onDragEnd`, so this is the peek's only way home.
    parkPeek(true);
  }, [parkPeek]);

  const gestureProps = useMemo<CardGestureProps>(
    () => ({
      drag: 'x',
      // Constrained to the origin on both axes of travel, which is what gives snap-back for
      // free: released below threshold, Motion animates the card back to 0 itself.
      dragConstraints: { left: 0, right: 0 },
      // Rigid to the LEFT, elastic to the right -- see `DRAG_ELASTIC`. Every side is spelled
      // out because Motion reads this object per side and defaults a missing one to 0, so a
      // partial object would be a silent decision rather than a stated one.
      dragElastic: { top: 0, right: DRAG_ELASTIC, bottom: 0, left: 0 },
      // No momentum: a card that keeps coasting after release would still be moving when the
      // next card mounts underneath it.
      dragMomentum: false,
      onDragStart: handleDragStart,
      onDrag: handleDrag,
      onDragEnd: handleDragEnd,
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    }),
    [
      handleDragStart,
      handleDrag,
      handleDragEnd,
      handlePointerDown,
      handlePointerUp,
      handlePointerCancel,
    ],
  );

  const previousCardStyle = useMemo<PreviousCardStyle>(
    () => ({ x: peekX, display: peekDisplay }),
    [peekX, peekDisplay],
  );

  return { gestureProps, deckRef, previousCardStyle };
}
