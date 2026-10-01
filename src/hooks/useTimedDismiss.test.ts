/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_DISMISS_AFTER_MS, NOTICE_FADE_MS, useTimedDismiss } from './useTimedDismiss';

/** Flip `document.hidden` and fire the event the hook listens for, as the browser would. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('useTimedDismiss', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    // Back to jsdom's own (visible) value, so no test inherits a hidden page.
    Reflect.deleteProperty(document, 'hidden');
  });

  it('should start fading after the delay and dismiss once the fade is over', () => {
    const target = { id: 1 };
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useTimedDismiss(target, onDismiss));

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS - 1);
    });
    expect(result.current.isFading).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isFading).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(NOTICE_FADE_MS);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith(target);
  });

  it('should do nothing with no target', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useTimedDismiss(null, onDismiss));

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS + NOTICE_FADE_MS);
    });
    expect(result.current.isFading).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should pause the clock while the page is hidden and resume with the time left', () => {
    // A locked phone or another app in front must not use up the 10 s (the developer's decision).
    const target = { id: 1 };
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useTimedDismiss(target, onDismiss));

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    setHidden(true);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.isFading).toBe(false);

    setHidden(false);
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS - 4_000 - 1);
    });
    expect(result.current.isFading).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isFading).toBe(true);
    act(() => {
      vi.advanceTimersByTime(NOTICE_FADE_MS);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('should not start the clock until a page that was hidden becomes visible', () => {
    // A deal can land in a background tab (a share link opened behind the current one).
    setHidden(true);
    // Hoisted: an inline literal would be a NEW target on every render, which restarts the clock.
    const target = { id: 1 };
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useTimedDismiss(target, onDismiss));

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS * 3);
    });
    expect(result.current.isFading).toBe(false);

    setHidden(false);
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS);
    });
    expect(result.current.isFading).toBe(true);
  });

  it('should cancel both timers when the target is dismissed by hand first', () => {
    // The manual ✕ sets the notice to null. The timer must not then fire for a banner that is gone.
    const onDismiss = vi.fn();
    const { result, rerender } = renderHook(
      ({ target }: { target: { id: number } | null }) => useTimedDismiss(target, onDismiss),
      { initialProps: { target: { id: 1 } as { id: number } | null } },
    );

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS);
    });
    expect(result.current.isFading).toBe(true);

    // Closed by hand in the middle of the fade.
    rerender({ target: null });
    expect(result.current.isFading).toBe(false);

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS + NOTICE_FADE_MS);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should restart the clock for a new target and never fade it early', () => {
    // A new deal is a new notice object, which must get its full 10 s.
    const onDismiss = vi.fn();
    const first = { id: 1 };
    const second = { id: 2 };
    const { result, rerender } = renderHook(
      ({ target }: { target: { id: number } }) => useTimedDismiss(target, onDismiss),
      { initialProps: { target: first } },
    );

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS - 100);
    });
    rerender({ target: second });

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isFading).toBe(false);

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_AFTER_MS + NOTICE_FADE_MS);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith(second);
  });

  it('should keep its clock across re-renders with the same target', () => {
    // App re-renders on every resolved year; that must not push the fade back.
    const target = { id: 1 };
    const onDismiss = vi.fn();
    const { rerender } = renderHook(() => useTimedDismiss(target, onDismiss));

    for (let elapsed = 0; elapsed < AUTO_DISMISS_AFTER_MS + NOTICE_FADE_MS; elapsed += 1_000) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      rerender();
    }
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
