/**
 * @vitest-environment jsdom
 *
 * ===========================================================================
 *  jsdom DOES NOT IMPLEMENT MEDIA PLAYBACK.
 *
 *  `HTMLMediaElement.play()` and `.pause()` exist as stubs that log
 *  "Error: Not implemented: HTMLMediaElement.prototype.play" to the console
 *  and do nothing -- so an unstubbed call fails as console noise plus a test
 *  that mysteriously never becomes "playing", not as a clean assertion error.
 *  Both are therefore stubbed on the PROTOTYPE below, which is also what makes
 *  call ordering assertable.
 *
 *  `currentTime` needs no stub (jsdom stores it), but it also never advances,
 *  which is why nothing here asserts on elapsed time.
 * ===========================================================================
 *
 * The hook returns a ref rather than creating an element, so these tests render a real
 * `<audio>` and attach it -- `renderHook` alone would leave `audioRef.current` null and
 * every control would be a no-op that trivially "passes".
 */

import { act, cleanup, render } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCardAudio } from './useCardAudio';
import type { CardAudioControls, UseCardAudioResult } from './useCardAudio';

import { highConfidenceCard, noPreviewCard } from '../components/__fixtures__/cards';

/** Every media call, in order, so the pause-then-reset-then-swap ordering is assertable. */
let calls: string[] = [];
let playImpl: () => Promise<void>;

/**
 * A test harness that renders the real `<audio>` element the hook expects and exposes the
 * hook's latest return value.
 *
 * `latest` is deliberately a mutable box rather than state: a test calls `latest.play()` and
 * then asserts on `latest.isPlaying`, and the box always holds the most recent render's
 * value.
 */
interface Harness {
  latest: UseCardAudioResult;
  element: HTMLAudioElement;
}

function renderAudioHook(previewUrl: string | undefined) {
  const box = {} as Harness;

  function Probe({ url }: { url: string | undefined }) {
    const result = useCardAudio(url);
    box.latest = result;

    // The element must exist before the hook's effects run, which is why it is rendered
    // here rather than created in the test.
    useEffect(() => {
      if (result.audioRef.current) box.element = result.audioRef.current;
    });

    return createElement('audio', { ref: result.audioRef, preload: 'none' });
  }

  const utils = render(createElement(Probe, { url: previewUrl }));

  return {
    box,
    /** Re-render with a different card's preview URL. */
    setUrl: (url: string | undefined) => utils.rerender(createElement(Probe, { url })),
    ...utils,
  };
}

/** Read the current controls without repeating the box lookup in every assertion. */
function controls(box: Harness): CardAudioControls {
  return box.latest;
}

/**
 * Set `document.hidden`, which jsdom exposes as a read-only getter.
 *
 * Redefined rather than assigned — `document.hidden = true` is silently ignored — and
 * `configurable` so successive calls in one test can flip it back. jsdom fires no
 * `visibilitychange` of its own, so the event is dispatched by hand beside this.
 */
function hide(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

/**
 * Invoke a control inside `act()`.
 *
 * Required, and the failure mode is confusing without it: every control sets state, and
 * React 19 does not flush a state update made outside `act()` before the test's next line.
 * `box.latest` then still holds the PREVIOUS render's value, so `isPlaying` reads `false`
 * immediately after a successful `play()` and the component looks broken when the test is.
 */
function run(action: () => void): void {
  act(action);
}

describe('useCardAudio', () => {
  beforeEach(() => {
    calls = [];
    playImpl = () => Promise.resolve();

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      calls.push(`play:${this.getAttribute('src') ?? ''}`);
      return playImpl();
    });

    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      calls.push(`pause:${this.getAttribute('src') ?? ''}`);
    });
  });

  afterEach(() => {
    /*
      ===========================================================================
       `cleanup()` WAS MISSING FROM THIS FILE UNTIL 2026-08-06, AND THE
       VISIBILITY TEST IS WHAT EXPOSED IT.

       Testing Library's auto-`afterEach(cleanup)` only registers when Vitest
       `globals` are on, and this repo imports `describe`/`it`/`expect`
       explicitly -- so every DOM test file needs its own (AGENTS.md says so).
       Without it, every `<audio>` element rendered by an earlier test stays
       mounted, and every one of those hooks keeps its own
       `visibilitychange` listener. One dispatched event therefore paused a
       dozen elements and `calls` held a dozen entries.

       The tests that came before it all act on their OWN element through the
       harness box, so they never noticed. A document-level listener is the
       first thing here that could.
      ===========================================================================
    */
    cleanup();
    vi.restoreAllMocks();
  });

  it('should report canPlay false when the card has no previewUrl', () => {
    const { box } = renderAudioHook(noPreviewCard.previewUrl);

    expect(controls(box).canPlay).toBe(false);

    // And the controls must be inert, not merely disabled in the UI: a keyboard shortcut in
    // plan 2 could reach them without going through a disabled button.
    run(() => controls(box).play());
    expect(calls.filter((call) => call.startsWith('play'))).toEqual([]);
    expect(controls(box).isPlaying).toBe(false);
  });

  it('should report canPlay true and set the src when the card has a previewUrl', () => {
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);

    expect(controls(box).canPlay).toBe(true);
    expect(box.element.getAttribute('src')).toBe(highConfidenceCard.previewUrl);
  });

  it('should call play on the element synchronously when play is invoked', () => {
    // The autoplay gesture requirement: the browser grants permission on the strength of the
    // click, and that permission does not survive an await. So the call must already have
    // happened by the time `play()` returns -- no microtask, no timer.
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);

    run(() => controls(box).play());

    expect(calls).toContain(`play:${highConfidenceCard.previewUrl}`);
    expect(controls(box).isPlaying).toBe(true);
  });

  it('should pause, reset currentTime, then set the new src when the card changes', () => {
    const { box, setUrl } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());

    box.element.currentTime = 12;
    calls = [];

    const next = 'https://p.scdn.co/mp3-preview/next-card';
    setUrl(next);

    // Pause happens against the OLD src -- that is the assertion. Swapping first can leave a
    // frame of the previous track audible.
    expect(calls[0]).toBe(`pause:${highConfidenceCard.previewUrl}`);
    expect(box.element.currentTime).toBe(0);
    expect(box.element.getAttribute('src')).toBe(next);
    expect(controls(box).isPlaying).toBe(false);
  });

  it('should not have two sources playing across a card change', () => {
    // The single-element invariant that motivated the whole design. One element cannot hold
    // two sources, so the check is that exactly one element exists and it carries only the
    // new card's src -- and that nothing was played without an explicit request.
    const { box, setUrl, container } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());

    const next = 'https://p.scdn.co/mp3-preview/next-card';
    setUrl(next);

    expect(container.querySelectorAll('audio')).toHaveLength(1);
    expect(box.element.getAttribute('src')).toBe(next);
    expect(calls.filter((call) => call.startsWith('play:'))).toEqual([
      `play:${highConfidenceCard.previewUrl}`,
    ]);
  });

  it('should rewind to zero on ended so the next play replays the track', () => {
    // ===================================================================
    //  THIS IS THE RESTART BUTTON'S BEHAVIOUR, MOVED (2026-08-11).
    //
    //  `restart()` was removed with the button it served. Play is now the
    //  only way to hear a track twice, and a `play()` on an element parked
    //  at the end of its media relies on the browser's implicit "seek to 0
    //  first" convention to do anything at all -- which jsdom does not
    //  implement and which is not worth depending on. Rewinding on `ended`
    //  makes the replay explicit.
    //
    //  The src is deliberately untouched: this is the ONE rewind that is
    //  not also a stop, so the loaded media stays and the replay costs no
    //  second fetch.
    // ===================================================================
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());
    box.element.currentTime = 20;
    calls = [];

    run(() => {
      box.element.dispatchEvent(new Event('ended'));
    });

    expect(box.element.currentTime).toBe(0);
    expect(box.element.getAttribute('src')).toBe(highConfidenceCard.previewUrl);
    expect(controls(box).isPlaying).toBe(false);

    // And the replay itself works from there.
    run(() => controls(box).play());
    expect(calls).toEqual([`play:${highConfidenceCard.previewUrl}`]);
    expect(controls(box).isPlaying).toBe(true);
  });

  it('should pause and reset on stop', () => {
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());
    box.element.currentTime = 8;
    calls = [];

    run(() => controls(box).stop());

    expect(calls).toEqual([`pause:${highConfidenceCard.previewUrl}`]);
    expect(box.element.currentTime).toBe(0);
    expect(controls(box).isPlaying).toBe(false);
  });

  it('should pause when the document becomes hidden', () => {
    // ===================================================================
    //  THE ONLY DEFECT THE REAL-DEVICE PASS FOUND (2026-08-06).
    //
    //  Android keeps a playing element alive when the screen locks, so the
    //  preview went on playing to a locked phone -- with a media
    //  notification in the shade, for a game whose whole premise is that
    //  the phone reveals nothing about the current card.
    //
    //  PAUSE, not stop: `currentTime` survives, so unlocking and pressing
    //  Play continues instead of restarting.
    // ===================================================================
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());
    box.element.currentTime = 8;
    calls = [];

    hide(true);
    run(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(calls).toEqual([`pause:${highConfidenceCard.previewUrl}`]);
    expect(controls(box).isPlaying).toBe(false);
    // The position is kept, which is the difference between this and `stop()`.
    expect(box.element.currentTime).toBe(8);
  });

  it('should not resume when the document becomes visible again', () => {
    // Deliberately no auto-resume: a page that starts making noise as a phone unlocks is worse
    // than one that waits to be asked, and the autoplay grant from the original tap is gone.
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());

    hide(true);
    run(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    calls = [];

    hide(false);
    run(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(calls).toEqual([]);
    expect(controls(box).isPlaying).toBe(false);
  });

  it('should ignore a visibility change that makes the document visible', () => {
    // The event fires in both directions, and the handler must do nothing on the way back --
    // pausing an element the player just started would be a race with their own tap.
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    hide(false);
    run(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    run(() => controls(box).play());
    expect(controls(box).isPlaying).toBe(true);
  });

  it('should clear isPlaying when the element emits ended', () => {
    // Natural end, no auto-advance: the 30 seconds run out and the button goes back to Play.
    // Nothing else happens -- the card does not change.
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());
    expect(controls(box).isPlaying).toBe(true);

    run(() => {
      box.element.dispatchEvent(new Event('ended'));
    });

    expect(controls(box).isPlaying).toBe(false);
    expect(box.element.getAttribute('src')).toBe(highConfidenceCard.previewUrl);
  });

  it('should report loading from the press until sound actually starts', () => {
    // `preload="none"` means the first press starts a cold fetch. jsdom leaves `readyState` at 0,
    // which is exactly the cold case, so the spinner is expected here.
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);

    expect(controls(box).isLoading).toBe(false);

    run(() => controls(box).play());
    expect(controls(box).isLoading).toBe(true);
    // Intent is optimistic, so the button flips to Pause immediately -- the two are different
    // facts, and the gap between them is the whole reason `isLoading` exists.
    expect(controls(box).isPlaying).toBe(true);

    // `playing` is the ONLY event that means audio is coming out. Not the play() promise, which
    // resolves before the first sample on a cold element.
    run(() => {
      box.element.dispatchEvent(new Event('playing'));
    });

    expect(controls(box).isLoading).toBe(false);
    expect(controls(box).isPlaying).toBe(true);
  });

  it('should ignore a pause event that arrives while a requested play is still loading', () => {
    // ===================================================================
    //  THIS IS THE "FIRST CLICK ON PLAY DOES NOTHING" REGRESSION TEST.
    //
    //  A `pause` event can land while a cold fetch is in flight -- the
    //  element settling after a `src` swap, or a load being interrupted.
    //  The handler used to clear `isPlaying` unconditionally, so the button
    //  snapped back to "Play" while the audio was genuinely on its way. The
    //  player pressed again, that second press was now a PAUSE, and the two
    //  cancelled out -- which is why pressing twice made it worse.
    //
    //  Inverting the `wantsPlayRef` guard puts the bug straight back, and
    //  nothing else in this suite would notice.
    // ===================================================================
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());

    run(() => {
      box.element.dispatchEvent(new Event('pause'));
    });

    expect(controls(box).isPlaying).toBe(true);
    expect(controls(box).isLoading).toBe(true);
  });

  it('should honour a pause event once the player has asked to stop', () => {
    // The other half of the guard: a DELIBERATE pause lowers the intent first, so the same event
    // is acted on. A guard that ignored every pause would leave the button stuck on "Pause".
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());
    run(() => controls(box).pause());

    run(() => {
      box.element.dispatchEvent(new Event('pause'));
    });

    expect(controls(box).isPlaying).toBe(false);
    expect(controls(box).isLoading).toBe(false);
  });

  it('should clear loading when the media errors rather than spinning forever', () => {
    // A preview URL that 404s emits `error` and never `playing`. Without this the spinner would
    // run for the rest of the card.
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());

    run(() => {
      box.element.dispatchEvent(new Event('error'));
    });

    expect(controls(box).isLoading).toBe(false);
    expect(controls(box).isPlaying).toBe(false);
  });

  it('should show loading again when playback rebuffers mid-track', () => {
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());
    run(() => {
      box.element.dispatchEvent(new Event('playing'));
    });
    expect(controls(box).isLoading).toBe(false);

    run(() => {
      box.element.dispatchEvent(new Event('waiting'));
    });

    expect(controls(box).isLoading).toBe(true);
  });

  it('should not report loading for a waiting event nobody asked for', () => {
    // `waiting` can fire while the element is idle. A spinner on a button the player has not
    // pressed is a lie about what the app is doing.
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);

    run(() => {
      box.element.dispatchEvent(new Event('waiting'));
    });

    expect(controls(box).isLoading).toBe(false);
  });

  it('should clear loading on stop and on a card change', () => {
    const { box, setUrl } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());
    expect(controls(box).isLoading).toBe(true);

    run(() => controls(box).stop());
    expect(controls(box).isLoading).toBe(false);

    run(() => controls(box).play());
    expect(controls(box).isLoading).toBe(true);

    setUrl('https://p.scdn.co/mp3-preview/next-card');
    expect(controls(box).isLoading).toBe(false);
  });

  it('should clear loading when the document goes hidden', () => {
    // The lock-screen rule from 2026-08-06. A phone locked mid-fetch must not come back to a
    // spinning button.
    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());

    hide(true);
    run(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(controls(box).isLoading).toBe(false);
    expect(controls(box).isPlaying).toBe(false);
  });

  it('should swallow a rejected play promise', async () => {
    // An AbortError is NORMAL when the src swaps mid-load, and blocked autoplay rejects too.
    // An uncaught rejection here would surface as an unhandled rejection rather than a
    // handled state change.
    const rejection = new DOMException('The play() request was interrupted', 'AbortError');
    playImpl = () => Promise.reject(rejection);

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const { box } = renderAudioHook(highConfidenceCard.previewUrl);
    await act(async () => {
      controls(box).play();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(controls(box).isPlaying).toBe(false);
  });

  it('should never set navigator.mediaSession.metadata', () => {
    // Covered explicitly BECAUSE it is an omission. Nothing else in the suite would notice if
    // a future change started publishing the title and artist to the OS lock screen -- which
    // is a leak no amount of on-page hiding can undo.
    const setMetadata = vi.fn();
    const fakeMediaSession = {
      get metadata() {
        return null;
      },
      set metadata(value: unknown) {
        setMetadata(value);
      },
      setActionHandler: vi.fn(),
    };
    Object.defineProperty(navigator, 'mediaSession', {
      value: fakeMediaSession,
      configurable: true,
      writable: true,
    });

    const { box, setUrl } = renderAudioHook(highConfidenceCard.previewUrl);
    run(() => controls(box).play());
    run(() => controls(box).pause());
    setUrl('https://p.scdn.co/mp3-preview/next-card');
    run(() => controls(box).stop());

    expect(setMetadata).not.toHaveBeenCalled();
    expect(fakeMediaSession.setActionHandler).not.toHaveBeenCalled();
  });
});
