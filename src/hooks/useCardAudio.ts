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
   * 400). Play/Pause is disabled in that case; Exit and the QR are not.
   */
  canPlay: boolean;
  isPlaying: boolean;
  /**
   * The player has asked for sound and there is not any yet -- a cold `preload="none"` fetch,
   * or a mid-track rebuffer. Drives the spinner in the Play button.
   *
   * It is deliberately NOT `!isPlaying`: intent and audibility are different facts, and the gap
   * between them is exactly the bug this was added for (2026-08-11).
   */
  isLoading: boolean;
  /** MUST be called from within a click handler's own call stack -- see below. */
  play: () => void;
  pause: () => void;
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
  const [isLoading, setIsLoading] = useState(false);

  /**
   * The player's INTENT, as opposed to what the element is doing.
   *
   * ===========================================================================
   *  THIS REF IS THE FIX FOR "THE FIRST CLICK ON PLAY DOES NOTHING" (2026-08-11).
   *
   *  The element is `preload="none"`, so the first press on a card starts a cold
   *  network fetch. Two things then went wrong, and only the second one was
   *  visible:
   *
   *  1. There was no feedback for the fetch. `setIsPlaying(true)` flipped the icon
   *     to Pause instantly and then nothing happened for as long as the preview
   *     took to arrive, so the press read as ignored. That half is now `isLoading`
   *     and the spinner `CardControls` draws over the button.
   *
   *  2. A `pause` EVENT can arrive while that fetch is still in flight -- the
   *     element settling after a `src` swap, or the load being interrupted. The
   *     old `onPause` handler cleared `isPlaying` unconditionally, so the button
   *     snapped straight back to "Play" while the audio was genuinely on its way.
   *     The player pressed again, that second press was now a PAUSE, and the two
   *     presses cancelled out. That is the "first click is not detected" report,
   *     and it is why pressing twice made it worse rather than better.
   *
   *  So `onPause` now ignores a pause it did not ask for. Every deliberate stop --
   *  `pause()`, `stop()`, the visibility pause, `ended` -- lowers this ref FIRST,
   *  which is what keeps those paths working: the handler runs for them because
   *  the intent is already gone by the time the event lands.
   * ===========================================================================
   */
  const wantsPlayRef = useRef(false);

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

    wantsPlayRef.current = false;
    element.pause();
    element.currentTime = 0;
    setIsPlaying(false);
    setIsLoading(false);

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
   *  THE "CONTINUES RATHER THAN RESTARTING" HALF IS FALSE INSIDE THE ANDROID TWA,
   *  MEASURED 2026-09-21, AND IS AN ACCEPTED DEVIATION RATHER THAN A BUG TO FIX.
   *  The silence half holds. But unlocking the phone and pressing Play restarts the
   *  preview from 0:00 on a real device in the installed shell. Nothing here changed
   *  and nothing here is wrong: `pause()` preserves `currentTime`, which is why the
   *  claim was true when it was written and is still true in a desktop browser. The
   *  reading is that Chrome releases the media resource for a backgrounded TWA
   *  activity, so the later `play()` re-fetches from the start -- UNVERIFIED, and not
   *  reproducible anywhere local. The developer was shown the behaviour and judged it
   *  acceptable, asking for no change, so DO NOT "fix" this without asking: a seek-back
   *  to the remembered position would be new behaviour bought against an accepted one.
   *  §5's lock-screen row carries the same note.
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

      // Intent down BEFORE the pause, so `onPause` treats the event as deliberate.
      wantsPlayRef.current = false;
      element.pause();
      setIsPlaying(false);
      setIsLoading(false);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  /**
   * Playback runs to its natural end -- no auto-stop timer and no auto-advance (decided
   * 2026-08-04).
   *
   * ===========================================================================
   *  `ended` REWINDS TO 0:00, AND THAT IS THE RESTART BUTTON'S JOB MOVING HOUSE.
   *
   *  It used to only put the button back to "Play". The button bar lost its
   *  dedicated Restart control on 2026-08-11, so Play is now the ONLY way to hear
   *  a track a second time -- and a `play()` on an element parked at the end of
   *  its media depends on the browser's implicit "seek to 0 first" convention to
   *  do anything at all. Rewinding here makes the replay explicit rather than
   *  conventional, and it is done on `ended` rather than inside `play()` so the
   *  position is reset at the moment it stops being meaningful. Note this is the
   *  ONE rewind that is not also a stop: `src` is untouched, so the loaded media
   *  is still there and the replay costs no second fetch.
   * ===========================================================================
   *
   * The other four listeners split "the player wants sound" from "there is sound", which is
   * what `isLoading` is. `playing` is the only event that means audio is actually coming out;
   * `waiting` is a rebuffer; `error` is a preview that will never arrive, and without it a dead
   * URL would spin forever.
   */
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;

    const onEnded = () => {
      wantsPlayRef.current = false;
      element.currentTime = 0;
      setIsPlaying(false);
      setIsLoading(false);
    };

    // Ignores a pause nobody asked for -- see `wantsPlayRef`. This is the swallowed-first-click
    // guard, and inverting it puts that bug straight back.
    const onPause = () => {
      if (wantsPlayRef.current) return;

      setIsPlaying(false);
      setIsLoading(false);
    };

    const onPlaying = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };

    const onWaiting = () => {
      if (!wantsPlayRef.current) return;

      setIsLoading(true);
    };

    const onError = () => {
      wantsPlayRef.current = false;
      setIsPlaying(false);
      setIsLoading(false);
    };

    element.addEventListener('ended', onEnded);
    element.addEventListener('pause', onPause);
    element.addEventListener('playing', onPlaying);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('error', onError);

    return () => {
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('waiting', onWaiting);
      element.removeEventListener('error', onError);
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
    wantsPlayRef.current = true;
    setIsPlaying(true);

    /*
     * `HAVE_FUTURE_DATA`. Below it the element cannot start on this frame, so the press is
     * going to be followed by a wait and the spinner is honest. At or above it playback is
     * immediate and a spinner would be a flash of noise -- and either way `playing` clears it,
     * so this only decides whether the spinner appears AT ALL, never how long it lasts.
     */
    if (element.readyState < 3) setIsLoading(true);

    void element.play().catch(() => {
      wantsPlayRef.current = false;
      setIsPlaying(false);
      setIsLoading(false);
    });
  }, [canPlay]);

  const pause = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;

    // Intent down FIRST: this is a deliberate pause, so `onPause` must act on it. Lowering it
    // after `element.pause()` would race the event and leave the button stuck on "Pause".
    wantsPlayRef.current = false;
    element.pause();
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  const stop = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;

    wantsPlayRef.current = false;
    element.pause();
    element.currentTime = 0;
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  return { audioRef, canPlay, isPlaying, isLoading, play, pause, stop };
}
