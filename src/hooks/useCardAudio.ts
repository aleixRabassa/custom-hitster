/**
 * The session-scoped audio machine: ONE `<audio>` element for the whole game, whose `src`
 * swaps as the card changes.
 *
 * ===========================================================================
 *  WHY ONE ELEMENT AND NOT ONE PER CARD
 *
 *  Phase 4's rule is that a track never bleeds into the next card and never
 *  doubles up on itself. With a single element that is STRUCTURALLY impossible
 *  rather than a guard somebody has to keep maintaining. Plan 2 (gestures)
 *  renders 2-3 stacked cards at once, which is exactly the window where
 *  per-card elements would overlap and play together.
 *
 *  The element lives in `GameScreen`, which owns this hook and passes the
 *  returned controls down to the card. A card never touches the element.
 * ===========================================================================
 *
 * ===========================================================================
 *  NEVER SET `navigator.mediaSession.metadata`.
 *
 *  This is an OMISSION, and omissions get "fixed" by the next person who
 *  notices the OS media notification says nothing useful -- so it is written
 *  down here rather than left to inference.
 *
 *  Setting it would publish the track's title and artist to the phone's lock
 *  screen and notification shade. That is a leak the card's hidden side cannot
 *  do anything about: no amount of on-page hiding removes text from the OS
 *  media panel. It defeats the entire game with the card still face down.
 *  Decided in Phase 0 (plan.md §5), and it is the reason nothing in this file
 *  touches `navigator.mediaSession` at all.
 * ===========================================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface CardAudioControls {
  /**
   * False when the card has no `previewUrl` -- the ~0.5% of tracks Phase 0 measured (2 of
   * 400). Play/Pause and Restart are disabled in that case; Exit and the QR are not.
   */
  canPlay: boolean;
  isPlaying: boolean;
  /** MUST be called from within a click handler's own call stack -- see below. */
  play: () => void;
  pause: () => void;
  /** Seek to 0 and play. Never advances the card -- that is what Next is for. */
  restart: () => void;
  /**
   * Pause and reset to 0. Called on card change and on a confirmed Exit -- NOT on a flip any
   * more (2026-08-06): the preview deliberately survives the reveal, because hearing the song
   * while reading the year is the point of it. `GameScreen`'s header block has the reversal.
   */
  stop: () => void;
}

export interface UseCardAudioResult extends CardAudioControls {
  /** Attach to the single `<audio>` element. */
  audioRef: RefObject<HTMLAudioElement | null>;
}

/**
 * @param previewUrl the current card's `previewUrl`, or `undefined` when it has none.
 */
export function useCardAudio(previewUrl: string | undefined): UseCardAudioResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const canPlay = previewUrl !== undefined && previewUrl !== '';

  /**
   * Swap the source when the card changes.
   *
   * THE ORDER IS LOAD-BEARING: pause, reset `currentTime`, *then* set `src`. Setting `src`
   * first can leave a frame of the previous track audible while the element tears down the
   * old stream -- and "a frame of the previous track" on a game about guessing the track is
   * not a cosmetic defect.
   */
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;

    element.pause();
    element.currentTime = 0;
    setIsPlaying(false);

    if (canPlay && previewUrl !== undefined) {
      element.src = previewUrl;
    } else {
      // `removeAttribute` rather than `src = ''`: an empty string resolves against the
      // document URL, so the element would try to load the PAGE as media and log an error.
      element.removeAttribute('src');
    }
  }, [previewUrl, canPlay]);

  /**
   * Pause when the document goes hidden -- a locked phone, a switched app, a switched tab.
   *
   * ===========================================================================
   *  FOUND ON A REAL DEVICE, 2026-08-06, AND IT IS THE ONLY THING THE DEVICE PASS
   *  FOUND WRONG.
   *
   *  Android keeps a playing `<audio>` element alive when the screen locks, so the
   *  preview went on playing to a locked phone. Three reasons that is wrong, and
   *  the third is this app's own rule:
   *
   *  1. Nobody is listening. The player locked the phone.
   *  2. It is a background media session, so the OS puts a notification in the
   *     shade with transport controls -- for a game whose entire premise is that
   *     the phone reveals nothing about the current card. Nothing here sets
   *     `navigator.mediaSession.metadata`, so the panel cannot name the track,
   *     but the honest fix is not to be playing at all.
   *  3. The 30-second preview would run out while locked, so unlocking would
   *     show a Play button and a card the player thought was mid-preview.
   *
   *  PAUSE, NOT STOP: the position is kept, so unlocking and pressing Play
   *  continues rather than restarting. And deliberately NO AUTO-RESUME on becoming
   *  visible again -- a page that starts making noise as a phone unlocks is worse
   *  than one that waits to be asked, and the autoplay grant from the original tap
   *  is long gone by then anyway.
   *
   *  `visibilitychange` rather than `blur`/`pagehide`: `blur` fires when focus
   *  merely leaves the window (a devtools click would pause the game), and
   *  `pagehide` is about unloading. `document.hidden` is exactly "not on screen".
   * ===========================================================================
   */
  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) return;

      const element = audioRef.current;
      if (!element) return;

      element.pause();
      setIsPlaying(false);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  /**
   * Playback runs to its natural end -- no auto-stop timer and no auto-advance (decided
   * 2026-08-04). The `ended` event is tracked for one reason only: to put the button back to
   * "Play" when the 30 seconds are up.
   */
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;

    const onEnded = () => setIsPlaying(false);
    const onPause = () => setIsPlaying(false);
    const onPlaying = () => setIsPlaying(true);

    element.addEventListener('ended', onEnded);
    element.addEventListener('pause', onPause);
    element.addEventListener('playing', onPlaying);

    return () => {
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('playing', onPlaying);
    };
  }, []);

  const play = useCallback(() => {
    const element = audioRef.current;
    if (!element || !canPlay) return;

    /**
     * `element.play()` is called SYNCHRONOUSLY here, inside the click handler's own call
     * stack. Browsers grant autoplay permission on the strength of a user gesture, and that
     * permission does not survive an `await` -- moving this behind a promise or a `setTimeout`
     * turns it into a blocked-autoplay rejection on mobile Safari.
     *
     * The returned promise is caught rather than ignored: an `AbortError` is NORMAL whenever
     * the `src` swaps or the element pauses mid-load, and an uncaught rejection there would
     * surface as an unhandled promise rejection in the console (and fail a test run).
     */
    setIsPlaying(true);
    void element.play().catch(() => {
      setIsPlaying(false);
    });
  }, [canPlay]);

  const pause = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;

    element.pause();
    setIsPlaying(false);
  }, []);

  const restart = useCallback(() => {
    const element = audioRef.current;
    if (!element || !canPlay) return;

    element.currentTime = 0;
    setIsPlaying(true);
    void element.play().catch(() => {
      setIsPlaying(false);
    });
  }, [canPlay]);

  const stop = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;

    element.pause();
    element.currentTime = 0;
    setIsPlaying(false);
  }, []);

  return { audioRef, canPlay, isPlaying, play, pause, restart, stop };
}
