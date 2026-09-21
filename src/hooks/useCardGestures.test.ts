/**
 * @vitest-environment jsdom
 *
 * The first tests this hook has ever had, and the scope is deliberately narrow.
 *
 * ===========================================================================
 *  THIS FILE DOES NOT TEST A DRAG, AND IT NEVER CAN. READ THIS BEFORE ADDING
 *  A `pointermove` SEQUENCE TO IT.
 *
 *  jsdom computes no layout, so Motion's drag handling -- which reads
 *  `getBoundingClientRect`, the layout box and transform matrices -- bails on
 *  every element in this environment. A simulated pointer sequence would
 *  exercise the test double, not the gesture, and it would pass just as
 *  happily against a hook that had the mapping backwards. That is the whole
 *  reason `src/game/gestures.ts` exists, and every decision worth asserting is
 *  asserted there, in the node environment, on both sides of every boundary.
 *
 *  What IS assertable here is the CONFIGURATION the hook hands Motion, and one
 *  of those numbers is now a feature rather than a tuning choice: the card must
 *  not travel left of its resting position (2026-09-21). `dragElastic` was the
 *  scalar `0.35` until then, which eased the card past its constraints in BOTH
 *  directions -- and nothing anywhere in this repo would have failed if it were
 *  put back, because the difference is a transform jsdom never computes and a
 *  feel no test has a thumb for.
 *
 *  So: props in, props out. The handlers are called directly with the shapes
 *  Motion would pass, never through the DOM.
 * ===========================================================================
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCardGestures } from './useCardGestures';
import type { CardGestureProps, UseCardGesturesOptions } from './useCardGestures';

import { SWIPE_COMMIT_DISTANCE_PX } from '../game/gestures';

/** The card's width in the tests below. `--card-width` at the phone size the thresholds suit. */
const CARD_WIDTH = 288;

/** The hook's latest return value, in a mutable box -- `useCardAudio.test.ts`'s shape. */
interface Harness {
  gestureProps: CardGestureProps;
  previousCardDisplay: () => string;
  previousCardX: () => string;
}

/**
 * Renders the hook over a real wrapper element with a stubbed `offsetWidth`.
 *
 * The width matters: it is the denominator of the 1:1 finger mapping, and jsdom reports 0 for
 * every element it lays out (which is to say, all of them). Without the stub every drag would
 * resolve to "no travel" and the peek assertions would pass against a hook that never moved
 * anything at all.
 */
function renderGestures(options: Partial<UseCardGesturesOptions> = {}) {
  const latest = {} as Harness;

  function Probe() {
    const { gestureProps, deckRef, previousCardStyle } = useCardGestures({
      onFlip: vi.fn(),
      onNext: vi.fn(),
      onPrevious: vi.fn(),
      hasPrevious: true,
      isEnabled: true,
      ...options,
    });

    latest.gestureProps = gestureProps;
    latest.previousCardDisplay = () => previousCardStyle.display.get();
    latest.previousCardX = () => previousCardStyle.x.get();

    return createElement('div', { ref: deckRef, 'data-testid': 'deck' });
  }

  const { getByTestId } = render(createElement(Probe));

  Object.defineProperty(getByTestId('deck'), 'offsetWidth', {
    value: CARD_WIDTH,
    configurable: true,
  });

  return latest;
}

/** A `PanInfo`-shaped end state, as Motion reports one. */
function drag(offsetX: number, velocityX = 0) {
  return { offset: { x: offsetX, y: 0 }, velocity: { x: velocityX, y: 0 } };
}

describe('useCardGestures', () => {
  afterEach(cleanup);

  it('should pin the card at its resting position against a left drag', () => {
    // ===================================================================
    //  "LA CARTA NUNCA PASARA EL LIMITE IZQUIERDO DE SU POSICION INICIAL"
    //  -- the developer's first request, 2026-09-21, and it is one number.
    //
    //  `dragElastic.left = 0` against `dragConstraints.left = 0` makes
    //  Motion clamp the element AT the constraint instead of easing past
    //  it. Every side is spelled out because Motion reads the object per
    //  side and defaults a missing key to 0 -- so a partial object would
    //  silently pin the RIGHT as well, which is the half that must keep
    //  its give.
    // ===================================================================
    const { gestureProps } = renderGestures();

    expect(gestureProps.dragConstraints).toEqual({ left: 0, right: 0 });
    expect(gestureProps.dragElastic.left).toBe(0);
    expect(gestureProps.dragElastic.right).toBeGreaterThan(0);
  });

  it('should keep the previous card out of the layout until a drag engages it', () => {
    // ===================================================================
    //  `display`, AND NOT `opacity` OR `visibility`.
    //
    //  The previous card parks one full card-width to the RIGHT of the
    //  deck. An element that is merely transparent is still laid out, so it
    //  would extend the page a card's width past the deck on every screen
    //  of the game -- a permanent horizontal scroll on a phone, present for
    //  a card nobody has asked for yet.
    // ===================================================================
    const { previousCardDisplay } = renderGestures();

    expect(previousCardDisplay()).toBe('none');
  });

  it('should report how far the finger got when a left drag commits', async () => {
    // ===================================================================
    //  THE HANDOFF'S FIRST HALF. `CardStack` records this against the key
    //  the returned-to card is about to render under, and `Card` spends it
    //  as the entrance's start position -- so the card the thumb was
    //  pulling in CONTINUES rather than jumping back off-screen for a fresh
    //  250ms.
    //
    //  The width is the denominator and it comes from the wrapper's
    //  `offsetWidth`, sampled once at drag start. The arithmetic itself is
    //  `previousCardProgress`'s and is tested in the node environment; what
    //  is pinned here is that the hook measures the element it says it
    //  measures, moves the card while the finger is down, and hands the
    //  same figure to the caller at the end.
    // ===================================================================
    const onPrevious = vi.fn();
    const { gestureProps, previousCardDisplay, previousCardX } = renderGestures({ onPrevious });

    act(() => {
      gestureProps.onPointerDown({ clientX: 0, clientY: 0, timeStamp: 0 });
      gestureProps.onDragStart();
      gestureProps.onDrag(null, drag(-CARD_WIDTH / 2));
    });

    /*
      `waitFor` and not a bare assertion, and the reason is worth knowing before writing another
      test against these two values: a `useTransform` output is a COMPUTED motion value, and
      Motion recomputes one on its frame loop rather than synchronously inside the `.set()` that
      invalidated it. Nothing here renders and no frame runs inside the `act()`, so the derived
      value is still the old one the instant the handler returns.

      It is NOT a frame of lag in the browser: `preRender` runs after `update` and before `render`
      in the same frame, and `useCombineMotionValues` recomputes synchronously during any React
      render as well -- so the peek tracks the finger, and is already parked on the render that
      `onPrevious` triggers. The `waitFor` is a property of this environment, not of the feature.
    */
    await waitFor(() => {
      // Half a card of drag is half a card of travel, and the card is on the screen.
      expect(previousCardDisplay()).toBe('block');
      expect(previousCardX()).toBe('50%');
    });

    act(() => {
      gestureProps.onDragEnd(null, drag(-SWIPE_COMMIT_DISTANCE_PX));
    });

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledWith(SWIPE_COMMIT_DISTANCE_PX / CARD_WIDTH);

    // Parked on a commit rather than animated home: a real `Card` is mounting at the spot this
    // element is leaving, and a slide-out here would drag a ghost of it along beside the real one.
    await waitFor(() => {
      expect(previousCardDisplay()).toBe('none');
      expect(previousCardX()).toBe('100%');
    });
  });

  it('should still advance on a right swipe, with the previous card untouched', () => {
    // The peek belongs to one direction only. An advance must not so much as show the card the
    // player has already answered.
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const { gestureProps, previousCardDisplay } = renderGestures({ onNext, onPrevious });

    act(() => {
      gestureProps.onPointerDown({ clientX: 0, clientY: 0, timeStamp: 0 });
      gestureProps.onDragStart();
      gestureProps.onDrag(null, drag(SWIPE_COMMIT_DISTANCE_PX));
      gestureProps.onDragEnd(null, drag(SWIPE_COMMIT_DISTANCE_PX));
    });

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).not.toHaveBeenCalled();
    expect(previousCardDisplay()).toBe('none');
  });

  it('should not step back for a drag released below the thresholds', async () => {
    // ===================================================================
    //  Snap-back, and the previous card goes home with the current one --
    //  the gesture is undone in full rather than half-committed.
    //
    //  The `onDrag` below is what makes this test worth anything. Without
    //  it the peek never leaves `PEEK_PARKED`, `parkPeek` early-returns
    //  before it reaches `animate()`, and the ONLY imperative animation in
    //  this hook goes unexecuted by the whole suite -- a wrong argument or
    //  a broken import there would ship green.
    // ===================================================================
    const onPrevious = vi.fn();
    const { gestureProps, previousCardDisplay, previousCardX } = renderGestures({ onPrevious });

    act(() => {
      gestureProps.onPointerDown({ clientX: 0, clientY: 0, timeStamp: 0 });
      gestureProps.onDragStart();
      gestureProps.onDrag(null, drag(-CARD_WIDTH / 2));
    });

    await waitFor(() => {
      expect(previousCardDisplay()).toBe('block');
    });

    act(() => {
      gestureProps.onDragEnd(null, drag(-(SWIPE_COMMIT_DISTANCE_PX - 1)));
    });

    expect(onPrevious).not.toHaveBeenCalled();

    // Animated home rather than snapped, which is the branch a commit does NOT take.
    await waitFor(() => {
      expect(previousCardDisplay()).toBe('none');
      expect(previousCardX()).toBe('100%');
    });
  });

  it('should ignore a drag while the session is not playable', () => {
    // The last-card race, unchanged by any of this: a commit arriving after the deck has ended
    // would act on a session with no current card.
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const { gestureProps } = renderGestures({ onNext, onPrevious, isEnabled: false });

    act(() => {
      gestureProps.onPointerDown({ clientX: 0, clientY: 0, timeStamp: 0 });
      gestureProps.onDragStart();
      gestureProps.onDragEnd(null, drag(-SWIPE_COMMIT_DISTANCE_PX));
      gestureProps.onDragEnd(null, drag(SWIPE_COMMIT_DISTANCE_PX));
    });

    expect(onPrevious).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('should leave the previous card alone when there is none', () => {
    // Card 1. Nothing to pull in, so a left drag moves nothing at all -- but the commit still
    // happens and the reducer still declines it, which is where that rule has one owner.
    const onPrevious = vi.fn();
    const { gestureProps, previousCardDisplay } = renderGestures({
      onPrevious,
      hasPrevious: false,
    });

    act(() => {
      gestureProps.onPointerDown({ clientX: 0, clientY: 0, timeStamp: 0 });
      gestureProps.onDragStart();
      gestureProps.onDrag(null, drag(-SWIPE_COMMIT_DISTANCE_PX));
    });

    expect(previousCardDisplay()).toBe('none');

    act(() => {
      gestureProps.onDragEnd(null, drag(-SWIPE_COMMIT_DISTANCE_PX));
    });

    expect(onPrevious).toHaveBeenCalledTimes(1);
  });
});
