/**
 * Dismiss the notice banner on a timer, with a fade first (2026-10-01, the developer's request:
 * the banner fades out 10 s after it appears, whatever it says, unless the player has already
 * closed it).
 *
 * The timer lives here, called from `App.tsx`, and NOT inside `NoticeBanner`, because the banner is
 * REMOUNTED between the preparing screen and the game screen: `App.tsx` builds one element and
 * hands it to whichever screen is showing, and the two screens are different parents. A timer
 * owned by the banner would restart from zero on that hand-off, so a slow card-1 gate would show
 * the notice for longer than 10 s.
 *
 * THE CLOCK PAUSES WHILE THE PAGE IS HIDDEN (the developer's decision): a phone locked, or another
 * app or tab in front. Otherwise a player who deals and puts the phone down returns to find the
 * notice gone, unread. Only the visible 10 s are paused; a fade already under way finishes. Same
 * signal `useCardAudio` pauses the preview on (`visibilitychange` + `document.hidden`).
 *
 * Two phases, both timers rather than a `transitionend`, on purpose. jsdom fires no
 * `transitionend`, and in a browser one is not guaranteed either (a hidden tab, an element that
 * leaves the layout). If the event were missed, the banner would stay mounted at opacity 0, with
 * an invisible ✕ under the thumb.
 *
 * `target` is the thing being dismissed, compared BY IDENTITY: a new notice object (a new deal)
 * restarts the clock, and the fade belongs to the object it started on, so it is DERIVED rather
 * than reset by an effect (`react-hooks/set-state-in-effect`). A manual dismiss sets the target to
 * null, which clears every timer and the listener through the effect's cleanup, so the two routes
 * cannot both fire.
 *
 * `onDismiss` MUST BE STABLE (a `useCallback`). It is an effect dependency, so an inline arrow
 * would restart the clock on every render, and a re-rendering screen (every resolved year
 * re-renders `App`) would then never fade at all. It receives the target it was started for, so
 * it never needs the latest closure.
 */

import { useEffect, useState } from 'react';

/** How long the notice stays fully visible (counting visible time only) before it fades. */
export const AUTO_DISMISS_AFTER_MS = 10_000;

/**
 * How long the fade takes. Mirrors `--duration-notice-fade` in `src/index.css`, which the banner's
 * transition reads, and `src/index.css.test.ts` asserts the two agree. Change them together, the
 * same pairing as `Card.tsx`'s exit constant and `--duration-card-exit`.
 */
export const NOTICE_FADE_MS = 500;

export interface TimedDismiss {
  /** True from the moment the fade starts until the target is dismissed. */
  isFading: boolean;
}

export function useTimedDismiss<T extends object>(
  target: T | null,
  onDismiss: (target: T) => void,
): TimedDismiss {
  const [fadingTarget, setFadingTarget] = useState<T | null>(null);

  useEffect(() => {
    if (target === null) return;

    let remainingMs = AUTO_DISMISS_AFTER_MS;
    let runningSince: number | undefined;
    let visibleTimer: ReturnType<typeof setTimeout> | undefined;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;

    const startFade = () => {
      visibleTimer = undefined;
      runningSince = undefined;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      setFadingTarget(target);
      fadeTimer = setTimeout(() => {
        onDismiss(target);
      }, NOTICE_FADE_MS);
    };

    const resume = () => {
      if (visibleTimer !== undefined) return;
      runningSince = Date.now();
      visibleTimer = setTimeout(startFade, remainingMs);
    };

    const pause = () => {
      if (visibleTimer === undefined || runningSince === undefined) return;
      clearTimeout(visibleTimer);
      visibleTimer = undefined;
      remainingMs = Math.max(0, remainingMs - (Date.now() - runningSince));
      runningSince = undefined;
    };

    function onVisibilityChange() {
      if (document.hidden) pause();
      else resume();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    // A deal can land while the page is already hidden (a share link opened in a background tab).
    if (!document.hidden) resume();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (visibleTimer !== undefined) clearTimeout(visibleTimer);
      if (fadeTimer !== undefined) clearTimeout(fadeTimer);
    };
  }, [target, onDismiss]);

  return { isFading: target !== null && fadingTarget === target };
}
