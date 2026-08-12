/**
 * @vitest-environment jsdom
 *
 * The wiring of the press-and-hold, at the one seam where it can be observed.
 *
 * The thresholds and the truth table are NOT tested here -- they are in `src/game/gestures.ts`
 * and `src/game/playlist-selection.ts`, asserted in the node environment with no DOM at all.
 * What is left for this file is the part that only exists once the two are bolted to an element:
 * that a hold fires the toggle rather than the start, that the click which follows a hold is
 * swallowed, and that every way a press can be abandoned actually abandons it.
 *
 * Two things here are firsts for `src/`, both deliberate:
 *
 * 1. **Fake timers.** Every other test in `src/` waits on a real `setTimeout`, which would cost
 *    half a second per case here. `api/_lib/cache.test.ts` is the house pattern, including the
 *    `finally` that restores real ones -- without it, a leaked fake clock breaks every file that
 *    runs after this one in the same worker.
 * 2. **Pointer events.** Nothing in this repo had ever fired one. jsdom has no `PointerEvent`
 *    constructor, so Testing Library falls back to a plain `Event` and copies `clientX`/`clientY`
 *    onto it -- which is all `useLongPress` reads, and the reason the hook reads nothing else.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SuggestionButton } from './SuggestionButton';
import { LONG_PRESS_DURATION_MS, LONG_PRESS_MAX_MOVEMENT_PX } from '../game/gestures';

const LABEL = 'Rock Party';
const BLURB = 'Rock';

function renderButton(
  props: { isSelected?: boolean; isSelecting?: boolean; disabled?: boolean } = {},
) {
  const onToggle = vi.fn();
  const onStart = vi.fn();

  const rendered = render(
    <SuggestionButton
      label={LABEL}
      blurb={BLURB}
      isSelected={props.isSelected ?? false}
      isSelecting={props.isSelecting ?? false}
      disabled={props.disabled ?? false}
      onToggle={onToggle}
      onStart={onStart}
    />,
  );

  return { ...rendered, onToggle, onStart, button: screen.getByRole('button') };
}

/** Press, hold past the threshold, release, and let the click that follows land. */
function holdAndRelease(button: HTMLElement, options: { moveTo?: { x: number; y: number } } = {}) {
  fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });

  if (options.moveTo) {
    fireEvent.pointerMove(button, { clientX: options.moveTo.x, clientY: options.moveTo.y });
  }

  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_DURATION_MS);
  });

  fireEvent.pointerUp(button);
  fireEvent.click(button);
}

describe('SuggestionButton', () => {
  afterEach(cleanup);

  describe('without timers', () => {
    it('should render the playlist title and its blurb, and nothing else', () => {
      const { button } = renderButton();

      expect(button.textContent).toContain(LABEL);
      expect(button.textContent).toContain(BLURB);
    });

    it('should report its selected state as a pressed toggle', () => {
      // Unconditional, not only while selecting: an `aria-pressed` that appears and disappears
      // changes the control's announced role halfway through the screen.
      expect(renderButton({ isSelected: false }).button.getAttribute('aria-pressed')).toBe('false');
      cleanup();
      expect(renderButton({ isSelected: true }).button.getAttribute('aria-pressed')).toBe('true');
    });

    it('should start a game on a plain click with nothing selected', () => {
      // The one-click demo path, unchanged since Phase 6. This is the assertion that fails if
      // someone decides every press should select.
      const { button, onStart, onToggle } = renderButton();

      fireEvent.click(button);

      expect(onStart).toHaveBeenCalledOnce();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('should toggle on a plain click once something is selected', () => {
      // Picks two through five are a single tap each, which is the whole point of a selection
      // mode.
      const { button, onStart, onToggle } = renderButton({ isSelecting: true });

      fireEvent.click(button);

      expect(onToggle).toHaveBeenCalledOnce();
      expect(onStart).not.toHaveBeenCalled();
    });

    it('should toggle on Ctrl, Meta or Shift click', () => {
      // The keyboard path as much as the mouse one: a hold cannot be performed without a
      // pointer, and Enter and Space carry these same flags.
      for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey'] as const) {
        const { button, onStart, onToggle } = renderButton();

        fireEvent.click(button, { [modifier]: true });

        expect(onToggle).toHaveBeenCalledOnce();
        expect(onStart).not.toHaveBeenCalled();
        cleanup();
      }
    });

    it('should prevent the context menu the platform would raise mid-hold', () => {
      const { button } = renderButton();

      // `fireEvent` returns false when a handler called `preventDefault()`.
      expect(fireEvent.contextMenu(button)).toBe(false);
    });

    it('should not act at all while disabled', () => {
      const { button, onStart, onToggle } = renderButton({ disabled: true });

      fireEvent.click(button);

      expect(onStart).not.toHaveBeenCalled();
      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  describe('the hold', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should toggle rather than start, and swallow the click that follows', () => {
      // ===================================================================
      //  THE CORE OF THE FEATURE, AND THE BUG IT IS ONE LINE AWAY FROM.
      //
      //  `click` fires after `pointerup`. Without `consumeLongPress()` the
      //  hold would select the playlist and the click a millisecond later
      //  would deal a deck from it -- so the gesture that exists to BUILD a
      //  multi-playlist deck would instead start a single-playlist game and
      //  throw the selection away.
      // ===================================================================
      vi.useFakeTimers();
      const { button, onStart, onToggle } = renderButton();

      holdAndRelease(button);

      expect(onToggle).toHaveBeenCalledOnce();
      expect(onStart).not.toHaveBeenCalled();
    });

    it('should start a game when the press is released before the threshold', () => {
      // The other side of the same boundary. One millisecond short is still a plain press.
      vi.useFakeTimers();
      const { button, onStart, onToggle } = renderButton();

      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_DURATION_MS - 1);
      });
      fireEvent.pointerUp(button);
      fireEvent.click(button);

      expect(onStart).toHaveBeenCalledOnce();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it('should not fire once the pointer has drifted past the bound', () => {
      // A scroll starting under the finger. The suggestions sit in the one column of this app
      // that is expected to scroll, so this is the common case, not the exotic one.
      vi.useFakeTimers();
      const { button, onStart, onToggle } = renderButton();

      holdAndRelease(button, { moveTo: { x: 100, y: 100 + LONG_PRESS_MAX_MOVEMENT_PX + 1 } });

      expect(onToggle).not.toHaveBeenCalled();
      expect(onStart).toHaveBeenCalledOnce();
    });

    it('should survive drift up to the bound', () => {
      // A thumb held on a button is never perfectly still, and cancelling on a wobble is what
      // makes a hold feel broken on the device the game is played on.
      vi.useFakeTimers();
      const { button, onToggle } = renderButton();

      holdAndRelease(button, { moveTo: { x: 100 + LONG_PRESS_MAX_MOVEMENT_PX, y: 100 } });

      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('should not fire after the pointer is cancelled', () => {
      vi.useFakeTimers();
      const { button, onToggle } = renderButton();

      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      fireEvent.pointerCancel(button);
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_DURATION_MS);
      });

      expect(onToggle).not.toHaveBeenCalled();
    });

    it('should not fire after the pointer leaves the button', () => {
      // The mouse case: pressed here, dragged off, released elsewhere.
      vi.useFakeTimers();
      const { button, onToggle } = renderButton();

      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      fireEvent.pointerLeave(button);
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_DURATION_MS);
      });

      expect(onToggle).not.toHaveBeenCalled();
    });

    it('should not fire after the button is unmounted mid-press', () => {
      // A hold in flight when the screen is replaced by the game would otherwise call a
      // handler belonging to a component that no longer exists.
      vi.useFakeTimers();
      const { button, onToggle, unmount } = renderButton();

      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      unmount();
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_DURATION_MS);
      });

      expect(onToggle).not.toHaveBeenCalled();
    });

    it('should not swallow the click of a later, ordinary press', () => {
      // The flag is cleared by the next `pointerdown`, not by the click, because a hold whose
      // pointer never produced a click -- released off the button, or cancelled by a scroll --
      // would otherwise leave it set and eat an unrelated press much later.
      vi.useFakeTimers();
      const { button, onStart, onToggle } = renderButton();

      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_DURATION_MS);
      });
      fireEvent.pointerCancel(button);
      expect(onToggle).toHaveBeenCalledOnce();

      // A fresh, ordinary press. It must reach `onStart`.
      fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
      fireEvent.pointerUp(button);
      fireEvent.click(button);

      expect(onStart).toHaveBeenCalledOnce();
    });

    it('should not start a hold while disabled', () => {
      vi.useFakeTimers();
      const { button, onToggle } = renderButton({ disabled: true });

      holdAndRelease(button);

      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
