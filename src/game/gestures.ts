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
 *  A tap misread as a swipe SKIPS A CARD -- or, since 2026-09-18, steps back
 *  onto one. A left swipe can undo the first, which is new; what it cannot undo
 *  is the second, because a step back resets the flip and the audio, so the
 *  guess in progress is lost either way.
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
 * Which way a committed swipe went -- and, since 2026-09-19, which way the deck MOVED.
 *
 * Until 2026-09-18 both directions ADVANCED (Phase 5, decision 2) and this only picked the exit
 * animation. It now picks the ACTION, through `swipeIntent` below. The exit animation no longer
 * reads the swipe at all: it reads `exitDirectionFor` on the index delta, so a thrown card still
 * flies out the way it was thrown (right → next → right) and a keyboard advance flies the same way.
 */
export type CommitDirection = 'left' | 'right';

/** What a committed swipe asks the session to do. */
export type SwipeIntent = 'next' | 'previous';

/**
 * Which action a committed swipe in `direction` means.
 *
 * ===========================================================================
 *  RIGHT ADVANCES, LEFT STEPS BACK (2026-09-18). A DECISION, HERE, FOR THE
 *  REASON EVERYTHING ELSE IN THIS FILE IS HERE.
 *
 *  jsdom cannot exercise a drag, so a mapping written inline in
 *  `useCardGestures` would be untested full stop -- and getting it backwards
 *  is invisible to every DOM test while turning every "next card" into "the
 *  card before". The mapping is the developer's call: right is the direction
 *  the game has always advanced in (Phase 5's exit animation already threw
 *  the card that way), so it keeps its meaning, and left is the direction
 *  that was free.
 *
 *  Keyboard mirrors it in `GameScreen`: ArrowRight advances, ArrowLeft steps
 *  back. The two are kept in step by reading THIS function's output in the
 *  gesture tests and the key names in the screen's.
 * ===========================================================================
 */
export function swipeIntent(direction: CommitDirection): SwipeIntent {
  return direction === 'right' ? 'next' : 'previous';
}

/**
 * Which way the outgoing card leaves, given where the deck WAS and where it now IS.
 *
 * ===========================================================================
 *  THE EXIT IS DERIVED FROM THE INDEX DELTA, NEVER FROM THE GESTURE (2026-09-19).
 *
 *  Until then the direction was hook state set by the last drag and defaulting
 *  to `left`. That was fine while both directions advanced. Once left meant
 *  PREVIOUS, direction carried meaning and the sticky state told three lies: a
 *  keyboard ArrowRight flew every card out the LEFT ("back") way, an ArrowLeft
 *  after a right swipe flew the card out to the RIGHT while the deck stepped
 *  back, and a declined PREVIOUS on card 1 latched `left` for whatever came next.
 *
 *  Reading the delta makes drag and keyboard agree by construction: a right
 *  throw calls `onNext`, the index rises, and this says `right` -- the same
 *  thing the throw said. There is nothing to keep in step.
 *
 *  Total, and equal indices resolve to `right`: the one way a card leaves with
 *  the index unchanged is a yearless CURRENT card being dropped and replaced in
 *  place by the next one, which is the deck moving on, not stepping back.
 * ===========================================================================
 */
export function exitDirectionFor(previousIndex: number, nextIndex: number): CommitDirection {
  return nextIndex < previousIndex ? 'left' : 'right';
}

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
 * Which way a committed drag went, for `swipeIntent` to turn into an action.
 *
 * It chose the exit animation until 2026-09-19; that is now `exitDirectionFor` over the index
 * delta, so this function's only reader is the hook deciding between `onNext` and `onPrevious`.
 *
 * Offset decides, and velocity is the tiebreak for the flick case: a fast flick can be
 * released with a near-zero offset (thrown and let go almost immediately), and the action is
 * better wrong-by-convention than driven off a meaningless sign. With both at
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
