/**
 * The real coverage of Phase 5.
 *
 * No docblock environment override, so this runs in the default NODE environment -- which is
 * the point. Every decision a swipe or a tap makes is asserted here, on both sides of every
 * boundary, with no DOM, no React, and no Motion involved. That is only possible because the
 * decisions were pulled out of the hook; jsdom cannot exercise a drag (see `gestures.ts`), so
 * if these thresholds were inline in `useCardGestures` they would be untested full stop.
 *
 * Boundary cases use `THRESHOLD` and `THRESHOLD - 1` rather than hand-written numbers, so
 * retuning a constant during the real-device pass does not invalidate the test that pins its
 * boundary.
 */

import { describe, expect, it } from 'vitest';

import {
  LONG_PRESS_DURATION_MS,
  LONG_PRESS_MAX_MOVEMENT_PX,
  SWIPE_COMMIT_DISTANCE_PX,
  SWIPE_COMMIT_VELOCITY_PX_PER_S,
  TAP_MAX_DURATION_MS,
  TAP_MAX_MOVEMENT_X_PX,
  TAP_MAX_MOVEMENT_Y_PX,
  exceedsLongPressMovement,
  isTap,
  shouldCommitSwipe,
  swipeDirection,
  swipeIntent,
} from './gestures';

describe('shouldCommitSwipe', () => {
  it('should commit when the horizontal offset exceeds the distance threshold', () => {
    // The slow deliberate drag: the player pushed the card a long way, but had let go of any
    // speed by the time they released. Velocity is 0 here, so distance is doing all the work.
    expect(shouldCommitSwipe({ offsetX: SWIPE_COMMIT_DISTANCE_PX + 20, velocityX: 0 })).toBe(true);
  });

  it('should commit when velocity exceeds the flick threshold even with a small offset', () => {
    // The fast flick, and the reason the rule is OR and not AND (decision 3). A phone gesture
    // is usually a short fast throw: requiring the distance threshold too would reject the
    // more common of the two gestures.
    expect(
      shouldCommitSwipe({ offsetX: 12, velocityX: SWIPE_COMMIT_VELOCITY_PX_PER_S + 100 }),
    ).toBe(true);
  });

  it('should not commit below both thresholds', () => {
    // Snap-back. The player moved the card and changed their mind, and Motion returns it to
    // the origin. Both values sit just under their bound, so this also proves neither
    // threshold is accidentally being read as the other.
    expect(
      shouldCommitSwipe({
        offsetX: SWIPE_COMMIT_DISTANCE_PX - 1,
        velocityX: SWIPE_COMMIT_VELOCITY_PX_PER_S - 1,
      }),
    ).toBe(false);
  });

  it('should commit for a left swipe and for a right swipe', () => {
    // Both directions COMMIT. Until 2026-09-18 both also advanced (Phase 5, decision 2); now the
    // direction chooses the action through `swipeIntent`, below -- but the commit rule itself is
    // symmetric, and snapping either direction back would read as a broken gesture.
    const distance = SWIPE_COMMIT_DISTANCE_PX + 20;

    expect(shouldCommitSwipe({ offsetX: -distance, velocityX: 0 })).toBe(true);
    expect(shouldCommitSwipe({ offsetX: distance, velocityX: 0 })).toBe(true);

    // And the same for a flick in either direction, since velocity is signed too.
    const speed = SWIPE_COMMIT_VELOCITY_PX_PER_S + 100;

    expect(shouldCommitSwipe({ offsetX: 0, velocityX: -speed })).toBe(true);
    expect(shouldCommitSwipe({ offsetX: 0, velocityX: speed })).toBe(true);
  });

  it('should treat exactly-at-threshold as committed', () => {
    // Pins the boundary. `>=` vs `>` is invisible in play and silently moves the threshold by
    // a pixel, so it is asserted rather than left to whoever next edits the comparison.
    expect(shouldCommitSwipe({ offsetX: SWIPE_COMMIT_DISTANCE_PX, velocityX: 0 })).toBe(true);
    expect(shouldCommitSwipe({ offsetX: 0, velocityX: SWIPE_COMMIT_VELOCITY_PX_PER_S })).toBe(true);

    // The other side of both boundaries, so the pair together prove where the line is.
    expect(shouldCommitSwipe({ offsetX: SWIPE_COMMIT_DISTANCE_PX - 1, velocityX: 0 })).toBe(false);
    expect(shouldCommitSwipe({ offsetX: 0, velocityX: SWIPE_COMMIT_VELOCITY_PX_PER_S - 1 })).toBe(
      false,
    );
  });
});

describe('swipeDirection', () => {
  it('should report the direction the card was thrown', () => {
    expect(swipeDirection({ offsetX: -120, velocityX: -800 })).toBe('left');
    expect(swipeDirection({ offsetX: 120, velocityX: 800 })).toBe('right');
  });

  it('should fall back to velocity when a flick was released at zero offset', () => {
    // A hard flick can be released with the card back at (or through) its origin. The exit
    // animation still needs a direction, and the throw's direction is the honest answer.
    expect(swipeDirection({ offsetX: 0, velocityX: -900 })).toBe('left');
    expect(swipeDirection({ offsetX: 0, velocityX: 900 })).toBe('right');
  });

  it('should stay total for a motionless drag', () => {
    // `shouldCommitSwipe` would never have committed this, so the value is arbitrary -- but
    // the function must still return a direction so no caller needs a null branch.
    expect(swipeDirection({ offsetX: 0, velocityX: 0 })).toBe('left');
  });
});

describe('swipeIntent', () => {
  it('should advance on a right swipe and step back on a left swipe', () => {
    // ===================================================================
    //  THE ONE MAPPING THE WHOLE FEATURE RESTS ON (2026-09-18), and it is
    //  here rather than in the hook because jsdom cannot exercise a drag:
    //  written inline, a backwards mapping would turn every "next card" into
    //  "the card before" and no DOM test would notice. Right keeps the
    //  meaning it has always had -- Phase 5 already threw the card that way.
    // ===================================================================
    expect(swipeIntent('right')).toBe('next');
    expect(swipeIntent('left')).toBe('previous');
  });

  it('should agree with swipeDirection about a thrown card', () => {
    // End to end over the two pure functions: a card thrown right advances, thrown left steps back.
    expect(swipeIntent(swipeDirection({ offsetX: 120, velocityX: 800 }))).toBe('next');
    expect(swipeIntent(swipeDirection({ offsetX: -120, velocityX: -800 }))).toBe('previous');
  });
});

describe('isTap', () => {
  it('should recognise a still, brief pointer sequence as a tap', () => {
    expect(isTap({ deltaX: 1, deltaY: 2, elapsedMs: 90, didDrag: false })).toBe(true);
  });

  it('should not recognise a sequence as a tap when a drag was recognised', () => {
    // ===================================================================
    //  THE CORE DISAMBIGUATION.
    //
    //  Every distance here is well inside the tap bounds -- this is a
    //  drag that Motion recognised and that then ended below the commit
    //  threshold, so the card snapped back. It must NOT also flip.
    //
    //  The player repositioned the card and changed their mind. Answering
    //  that with the reveal is the worse of the two misreadings, because
    //  it destroys the guess they were in the middle of making.
    // ===================================================================
    expect(isTap({ deltaX: 1, deltaY: 1, elapsedMs: 90, didDrag: true })).toBe(false);
  });

  it('should not recognise a long press as a tap', () => {
    // A held finger is a player thinking, inspecting, or about to get the OS context menu --
    // not asking for the answer.
    expect(
      isTap({ deltaX: 0, deltaY: 0, elapsedMs: TAP_MAX_DURATION_MS + 1, didDrag: false }),
    ).toBe(false);

    // Exactly at the bound is still a tap.
    expect(isTap({ deltaX: 0, deltaY: 0, elapsedMs: TAP_MAX_DURATION_MS, didDrag: false })).toBe(
      true,
    );
  });

  it('should tolerate small vertical movement in a tap', () => {
    // A thumb tap on a phone is never perfectly still -- the thumb rolls as it presses. Being
    // strict on this axis is what makes tap-to-flip feel broken on the device the game is
    // actually played on. Vertical movement carries no swipe meaning, since the card drags
    // only on x.
    expect(
      isTap({ deltaX: 0, deltaY: TAP_MAX_MOVEMENT_Y_PX, elapsedMs: 120, didDrag: false }),
    ).toBe(true);
  });

  it('should not recognise large vertical movement as a tap', () => {
    // The other side of that bound: forgiving a wobble is not the same as forgiving a scroll
    // attempt.
    expect(
      isTap({ deltaX: 0, deltaY: TAP_MAX_MOVEMENT_Y_PX + 1, elapsedMs: 120, didDrag: false }),
    ).toBe(false);
  });

  it('should not recognise a horizontal move beyond the tap radius as a tap', () => {
    // The case that would otherwise reveal the answer the player was about to guess: movement
    // along the swipe axis, too small for Motion to have called it a drag yet, but too large
    // to be a tap. It must resolve to neither gesture.
    expect(
      isTap({ deltaX: TAP_MAX_MOVEMENT_X_PX + 1, deltaY: 0, elapsedMs: 120, didDrag: false }),
    ).toBe(false);

    // And symmetrically leftwards, since the bound is on the absolute value.
    expect(
      isTap({ deltaX: -(TAP_MAX_MOVEMENT_X_PX + 1), deltaY: 0, elapsedMs: 120, didDrag: false }),
    ).toBe(false);

    // Exactly at the bound is still a tap.
    expect(
      isTap({ deltaX: TAP_MAX_MOVEMENT_X_PX, deltaY: 0, elapsedMs: 120, didDrag: false }),
    ).toBe(true);
  });

  it('should leave a dead band between the tap radius and the commit distance', () => {
    // Not a boundary test -- an assertion that the two constants do not overlap. If a future
    // retune pushed `TAP_MAX_MOVEMENT_X_PX` past `SWIPE_COMMIT_DISTANCE_PX`, a single gesture
    // could be both a tap and a commit, and the card would flip AND advance: the answer
    // revealed on a card the player can never return to. Both misreadings at once.
    expect(TAP_MAX_MOVEMENT_X_PX).toBeLessThan(SWIPE_COMMIT_DISTANCE_PX);
  });
});

describe('the long press', () => {
  it('should require a longer hold than a tap is allowed to last', () => {
    // Not a boundary test -- an assertion that the two durations do not overlap, in the same
    // shape as the dead-band assertion above. They govern different elements, so nothing
    // compares them at runtime and no test but this one would notice them crossing. If they
    // did, one press would satisfy both readings and the winner would be event ordering.
    expect(LONG_PRESS_DURATION_MS).toBeGreaterThan(TAP_MAX_DURATION_MS);
  });

  it('should tolerate drift up to the bound on either axis', () => {
    // A thumb held on a button is never perfectly still. Exactly at the bound still holds, the
    // same inclusive tolerance `isTap` gives.
    expect(exceedsLongPressMovement({ deltaX: 0, deltaY: 0 })).toBe(false);
    expect(exceedsLongPressMovement({ deltaX: LONG_PRESS_MAX_MOVEMENT_PX, deltaY: 0 })).toBe(false);
    expect(exceedsLongPressMovement({ deltaX: 0, deltaY: LONG_PRESS_MAX_MOVEMENT_PX })).toBe(false);
  });

  it('should cancel once drift passes the bound on either axis', () => {
    // The scroll starting under the finger. The suggestions are in the one column of this app
    // that is expected to scroll, so this is the common case rather than the exotic one.
    expect(exceedsLongPressMovement({ deltaX: LONG_PRESS_MAX_MOVEMENT_PX + 1, deltaY: 0 })).toBe(
      true,
    );
    expect(exceedsLongPressMovement({ deltaX: 0, deltaY: LONG_PRESS_MAX_MOVEMENT_PX + 1 })).toBe(
      true,
    );
  });

  it('should measure drift on the absolute value in both directions', () => {
    // The bound is symmetric, unlike the card's per-axis pair: a button press has no
    // privileged axis, so up and left must cancel exactly as down and right do.
    expect(exceedsLongPressMovement({ deltaX: -(LONG_PRESS_MAX_MOVEMENT_PX + 1), deltaY: 0 })).toBe(
      true,
    );
    expect(exceedsLongPressMovement({ deltaX: 0, deltaY: -(LONG_PRESS_MAX_MOVEMENT_PX + 1) })).toBe(
      true,
    );
  });
});
