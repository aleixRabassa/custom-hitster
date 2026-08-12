/**
 * The gesture DECISIONS, as pure functions: does this drag advance the card, was that pointer
 * sequence a tap, and has a press moved too far to still be a hold.
 *
 * ===========================================================================
 *  MOSTLY THE CARD, BUT NOT ONLY THE CARD: THE LAST TWO CONSTANTS ARE THE
 *  LANDING SCREEN'S, AND THEY LIVE HERE FOR THE INVARIANT.
 *
 *  `LONG_PRESS_DURATION_MS` must stay ABOVE `TAP_MAX_DURATION_MS`, or a press
 *  can be both a tap and a hold. Nothing enforces that but proximity and one
 *  assertion in `gestures.test.ts` -- and a separate `long-press.ts` module is
 *  exactly how someone lowers one of the two without ever seeing the other.
 *
 *  So the file is now "every press threshold in the app", and the card sections
 *  below say so where they used to say "this file".
 * ===========================================================================
 *
 * ===========================================================================
 *  WHY THIS FILE EXISTS AT ALL, INSTEAD OF THE LOGIC LIVING IN THE HOOK.
 *
 *  jsdom cannot exercise a drag. Motion's drag handling reads element geometry
 *  (`getBoundingClientRect`, layout box, transform matrices) that jsdom does not
 *  compute, so a simulated pointer sequence in a test asserts that the test
 *  double works -- not that the gesture does.
 *
 *  So the thresholds are pulled OUT of the React seam and into functions that
 *  take numbers and return booleans. Those are exhaustively testable in the node
 *  environment, on both sides of every boundary, and they are where every
 *  decision that matters actually lives. `useCardGestures` is then thin enough
 *  that reading it is sufficient review.
 *
 *  This is the same split Phase 3 chose for the resolver -- a framework-free
 *  decision core with a thin React seam -- and for the same reason.
 * ===========================================================================
 *
 * ===========================================================================
 *  A TAP AND A DRAG BEGIN WITH THE IDENTICAL POINTER EVENT, AND BOTH
 *  MISREADINGS ARE DESTRUCTIVE.
 *
 *  A tap misread as a swipe SKIPS A CARD IRRECOVERABLY: the deck is
 *  one-directional by design and there is no previous card, so the player has
 *  permanently lost a track they never saw.
 *
 *  A swipe misread as a tap FLIPS THE CARD, revealing the answer the player was
 *  in the middle of guessing -- which is the entire game.
 *
 *  Neither is a cosmetic bug, which is why the bounds below are separate named
 *  constants rather than inline numbers, and why `isTap` demands agreement from
 *  four independent signals before it says yes.
 * ===========================================================================
 */

/**
 * Which way a committed swipe went.
 *
 * Both directions ADVANCE (decision 2) -- this is only used to pick the exit animation, so
 * the card flies out the way it was thrown instead of always the same way. A right swipe that
 * snapped back would read as a broken gesture rather than a deliberate one, because there is
 * no previous card for it to mean.
 */
export type CommitDirection = 'left' | 'right';

/**
 * How far a drag must travel horizontally to advance, in CSS pixels.
 *
 * Chosen against a card 288px wide, which is what `w-72` was through Phases 5 and 6: a third of
 * its width -- far enough that a thumb resting and sliding slightly cannot reach it, short enough
 * that the player does not have to throw the card off-screen. Deliberately NOT a percentage of
 * the viewport: the gesture is against the card, not against the window.
 *
 * ===========================================================================
 *  PHASE 7 MADE THE CARD FLUID, AND 288px IS NO LONGER ANY OF ITS SIZES.
 *
 *  `--card-width` in `src/index.css` runs from 240px to 384px since the card
 *  became SQUARE on 2026-08-11 (it was 185px to 288px before that). So 96px is
 *  40% of the card at the narrow end and 25% at the wide one, and the intended
 *  third is reached at neither: a commit takes a visibly longer drag on a small
 *  screen than on a large one.
 *
 *  NOT retuned here, because retuning it would be guessing twice instead of
 *  once. All five thresholds in this file are documented starting values that
 *  have never met a thumb (`development.md` §5 and §8), and the fix for that is
 *  a real-device pass, not a second number chosen by eye. This block exists so
 *  that when the pass happens, whoever runs it knows the threshold is
 *  card-relative in intent and viewport-independent in fact.
 * ===========================================================================
 */
export const SWIPE_COMMIT_DISTANCE_PX = 96;

/**
 * How fast a flick must be moving to advance regardless of distance, in CSS pixels/second.
 *
 * This is the OR half of the commit rule (decision 3). A phone gesture is usually a short
 * fast flick, not a long deliberate drag: requiring the distance threshold alone would reject
 * the more common of the two. 500px/s is roughly "a definite throw" -- a slow reposition sits
 * an order of magnitude below it.
 */
export const SWIPE_COMMIT_VELOCITY_PX_PER_S = 500;

/**
 * How far a pointer may move HORIZONTALLY and still count as a tap, in CSS pixels.
 *
 * Tight, because this is the bound that protects the answer: horizontal movement is the axis
 * the swipe lives on, so anything beyond a wobble here is a drag that Motion may not have
 * recognised yet. Sits far below `SWIPE_COMMIT_DISTANCE_PX`, leaving a dead band in between
 * where a gesture neither flips nor advances -- that gap is intentional, not a coverage hole.
 */
export const TAP_MAX_MOVEMENT_X_PX = 10;

/**
 * How far a pointer may move VERTICALLY and still count as a tap, in CSS pixels.
 *
 * Looser than the horizontal bound on purpose. A thumb tap on a phone is never perfectly
 * still -- the thumb rolls as it presses -- and vertical drift carries no swipe meaning here,
 * because the card only drags on x. Being strict on this axis makes tap-to-flip feel broken
 * on exactly the device the game is played on.
 *
 * This tolerance is what `overscroll-behavior: none` in `src/index.css` pays for: without it,
 * the vertical component we are choosing to forgive is the same movement that triggers the
 * browser's pull-to-refresh.
 */
export const TAP_MAX_MOVEMENT_Y_PX = 16;

/**
 * How long a press may last and still count as a tap, in milliseconds.
 *
 * Bounds the long-press: a finger held on the card is a player thinking, inspecting, or about
 * to open the OS context menu -- not asking for the answer. 400ms is comfortably above a
 * deliberate tap (~80-150ms) and below the ~500ms at which mobile browsers start treating a
 * press as a long-press.
 */
export const TAP_MAX_DURATION_MS = 400;

/**
 * How long a press must be held before it selects a suggested playlist, in milliseconds.
 *
 * The landing screen's, not the card's. 500ms is the platform convention -- it is what Android
 * and iOS themselves use to enter a selection mode -- and the constant above already names it as
 * the point "at which mobile browsers start treating a press as a long-press". Matching the OS
 * rather than beating it is what makes the gesture feel like the one the player already knows.
 *
 * ===========================================================================
 *  THIS MUST STAY ABOVE `TAP_MAX_DURATION_MS`, AND THAT IS WHY THE TWO ARE
 *  ADJACENT.
 *
 *  They govern different elements, so nothing in the app compares them at
 *  runtime and no rendering would change if they crossed. What would change is
 *  that a single press could satisfy both readings, and the thing that decides
 *  which one wins would be event ordering rather than intent.
 *
 *  `gestures.test.ts` asserts the ordering, because it is the only place it can
 *  be asserted at all.
 * ===========================================================================
 *
 * Unlike every other threshold in this file, this one is spent by a TIMER rather than measured
 * across a completed sequence: the highlight has to appear while the finger is still down, so
 * `useLongPress` cannot wait for the pointer-up that would let it do the arithmetic.
 */
export const LONG_PRESS_DURATION_MS = 500;

/**
 * How far a pointer may drift during a hold and still be selecting, in CSS pixels.
 *
 * ONE symmetric bound rather than the per-axis pair above, because a press on a button has no
 * privileged axis: the card's asymmetry exists because a swipe lives on x, and there is no swipe
 * here. 10px matches the tighter of the two card bounds -- a hold that has travelled further than
 * that is a scroll starting under the finger, and the suggestions sit in the one column of this
 * app that is expected to scroll.
 *
 * Misreading in this direction is cheap in a way the card's never is: a cancelled hold falls back
 * to a plain press, which either starts a game or toggles, both of which the player can undo.
 */
export const LONG_PRESS_MAX_MOVEMENT_PX = 10;

/** How far a press has drifted from where it started. Signed, in CSS pixels. */
export interface PressMovement {
  deltaX: number;
  deltaY: number;
}

/**
 * Has this press moved too far to still count as a hold?
 *
 * Strictly `>`, so a press sitting exactly ON the bound survives -- the same inclusive tolerance
 * `isTap` gives, and for the same reason: at-threshold resolves to the reading that does not
 * cancel what the player was doing.
 */
export function exceedsLongPressMovement({ deltaX, deltaY }: PressMovement): boolean {
  return (
    Math.abs(deltaX) > LONG_PRESS_MAX_MOVEMENT_PX || Math.abs(deltaY) > LONG_PRESS_MAX_MOVEMENT_PX
  );
}

/** One drag's end state, as Motion reports it in `PanInfo` (x axis only -- the card drags on x). */
export interface DragEnd {
  /** Horizontal distance from where the drag started, in CSS pixels. Signed. */
  offsetX: number;
  /** Horizontal velocity at release, in CSS pixels/second. Signed. */
  velocityX: number;
}

/**
 * Does this drag advance the card?
 *
 * Commit on distance **OR** velocity (decision 3), and on the ABSOLUTE value of each, because
 * both directions advance (decision 2). Below both thresholds the caller lets Motion snap the
 * card back.
 *
 * The comparison is `>=`, so a value exactly at a threshold COMMITS. That is pinned by a test
 * rather than left to whoever next edits this line: flipping it to `>` is invisible in play
 * and silently moves the boundary.
 */
export function shouldCommitSwipe({ offsetX, velocityX }: DragEnd): boolean {
  return (
    Math.abs(offsetX) >= SWIPE_COMMIT_DISTANCE_PX ||
    Math.abs(velocityX) >= SWIPE_COMMIT_VELOCITY_PX_PER_S
  );
}

/**
 * Which way a committed drag went, for the exit animation only.
 *
 * Offset decides, and velocity is the tiebreak for the flick case: a fast flick can be
 * released with a near-zero offset (thrown and let go almost immediately), and an exit
 * animation is better wrong-by-convention than driven off a meaningless sign. With both at
 * zero -- which `shouldCommitSwipe` would never have committed -- it falls through to `left`,
 * so the return type stays total and no caller needs a null branch.
 */
export function swipeDirection({ offsetX, velocityX }: DragEnd): CommitDirection {
  if (offsetX !== 0) return offsetX > 0 ? 'right' : 'left';
  if (velocityX !== 0) return velocityX > 0 ? 'right' : 'left';

  return 'left';
}

/** One pointer-down/pointer-up pair, plus what Motion made of the movement in between. */
export interface PointerSequence {
  /** Horizontal distance between pointer-down and pointer-up, in CSS pixels. Signed. */
  deltaX: number;
  /** Vertical distance between pointer-down and pointer-up, in CSS pixels. Signed. */
  deltaY: number;
  /** How long the pointer was down, in milliseconds. */
  elapsedMs: number;
  /**
   * Whether Motion recognised a drag during the sequence (i.e. `onDragStart` fired).
   *
   * THE LOAD-BEARING SIGNAL. The distance bounds are a backstop for movement too small for
   * Motion to call a drag; this flag is the authoritative answer whenever Motion did call it,
   * including for a drag that then ended below the commit threshold and snapped back. Such a
   * drag must not ALSO register as a tap -- the player repositioned the card and changed their
   * mind, and rewarding that with the answer is the worse of the two misreadings.
   */
  didDrag: boolean;
}

/**
 * Was that pointer sequence a tap (and therefore a flip)?
 *
 * All four signals must agree: no recognised drag, movement within the per-axis bounds, and a
 * short press. The axes have SEPARATE bounds rather than a single radius -- see
 * `TAP_MAX_MOVEMENT_X_PX` and `TAP_MAX_MOVEMENT_Y_PX` for why a thumb needs more vertical
 * slack than horizontal.
 *
 * Bounds are inclusive (`<=`), matching `shouldCommitSwipe`'s inclusive commit: at-threshold
 * resolves to the *less* destructive reading on each side.
 */
export function isTap({ deltaX, deltaY, elapsedMs, didDrag }: PointerSequence): boolean {
  if (didDrag) return false;

  return (
    Math.abs(deltaX) <= TAP_MAX_MOVEMENT_X_PX &&
    Math.abs(deltaY) <= TAP_MAX_MOVEMENT_Y_PX &&
    elapsedMs <= TAP_MAX_DURATION_MS
  );
}
