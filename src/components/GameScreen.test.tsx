/**
 * @vitest-environment jsdom
 *
 * These are the integration tests of Phase 4: the real `useCardAudio` against a real
 * `<audio>` element, driven through the real card. Only two things are faked -- `qrcode`
 * (jsdom has no canvas) and `HTMLMediaElement.play`/`pause` (jsdom implements neither, see
 * `useCardAudio.test.ts`).
 *
 * The stubs record calls in order, because every assertion below is about WHEN audio stops,
 * not about whether a function exists.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameScreen } from './GameScreen';
import { highConfidenceCard, lowConfidenceCard, noPreviewCard } from './__fixtures__/cards';
import { clearQrCache } from '../game/qr-cache';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

let calls: string[] = [];

/**
 * The helper still speaks in terms of ONE card, even though `GameScreen` now takes a deck and
 * an index (Phase 5's stack needs to see what is coming next). It wraps the card in a
 * single-card deck: every assertion below is about the audio element, and a one-card deck is
 * the shape that renders no backs and so keeps those assertions about exactly one thing.
 */
function renderScreen(props: {
  card?: typeof highConfidenceCard;
  isFlipped?: boolean;
  onExit?: () => void;
  onFlip?: () => void;
  onNext?: () => void;
  onSavePlaylist?: () => void;
  isPlayable?: boolean;
}) {
  const element = (
    <GameScreen
      deck={[props.card ?? highConfidenceCard]}
      currentIndex={0}
      isFlipped={props.isFlipped ?? false}
      isYearPending={false}
      onFlip={props.onFlip ?? vi.fn()}
      onNext={props.onNext ?? vi.fn()}
      onExit={props.onExit ?? vi.fn()}
      isPlayable={props.isPlayable ?? true}
      // HUD props, arbitrary here: every assertion in this file is about the audio element or the
      // key handler, and the HUD is covered on its own in `Hud.test.tsx`.
      cardsRemaining={0}
      playlistName="Test Playlist"
      // The deck-actions props. Arbitrary too -- what they DO is `DeckActions.test.tsx`'s job, and
      // what this file cares about is that opening the panel suspends the game's own controls.
      playlistId="37i9dQZF1DXcBWIGoYBM5M"
      seed="a1b2c3d4e5f60718"
      shareOrigin="https://hitster.example/"
      onSavePlaylist={props.onSavePlaylist ?? vi.fn()}
      isPlaylistSaved={false}
    />
  );

  return element;
}

describe('GameScreen', () => {
  beforeEach(() => {
    calls = [];
    toDataURLMock.mockReset();
    toDataURLMock.mockImplementation((text) =>
      Promise.resolve(`data:image/png;base64,QR(${text})`),
    );
    // Generated codes are cached at module level (`src/game/qr-cache.ts`) so the deck's preload
    // survives a card advance. Vitest isolates modules per FILE, so every test here would
    // otherwise render against whatever the previous one generated. Same reason as `cleanup`.
    clearQrCache();

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      calls.push(`play:${this.getAttribute('src') ?? ''}`);
      return Promise.resolve();
    });

    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      calls.push(`pause:${this.getAttribute('src') ?? ''}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should render exactly one audio element regardless of deck size', () => {
    // The session-scoped ownership decision. One element is what makes bleed-across-cards
    // structurally impossible, and it is also what plan 2's stack of 2-3 visible cards
    // depends on -- per-card elements would overlap there.
    const { container, rerender } = render(renderScreen({}));

    expect(container.querySelectorAll('audio')).toHaveLength(1);

    rerender(renderScreen({ card: lowConfidenceCard }));
    rerender(renderScreen({ card: noPreviewCard }));

    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });

  it('should not stop audio when the card is flipped', () => {
    // ===================================================================
    //  THE 2026-08-06 REVERSAL, AND THE ONE ASSERTION THAT PINS IT.
    //
    //  This test used to assert the opposite. Phase 4 stopped the preview on
    //  the flip -- "once the answer is on screen the preview has no job
    //  left" -- and playing the game disagreed: hearing the song while
    //  reading the year is the point of the reveal.
    //
    //  The bleed case that rule also cited is covered by the card-change
    //  test below, which is why the effect was deleted rather than moved. If
    //  a stop-on-flip is ever re-added, this fails first.
    // ===================================================================
    const { rerender } = render(renderScreen({}));

    screen.getByRole('button', { name: 'Play' }).click();
    expect(calls).toContain(`play:${highConfidenceCard.previewUrl}`);

    calls = [];
    rerender(renderScreen({ isFlipped: true }));

    // Same call-order recording as every other audio test here: nothing paused the element, and
    // nothing re-started it either -- the flip is simply not an audio event any more.
    expect(calls).toEqual([]);
    // And the source is untouched, so playback is still where the player left it.
    const audio = screen.getByTestId('session-audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe(highConfidenceCard.previewUrl);
  });

  it('should stop audio when the card changes', () => {
    const { rerender } = render(renderScreen({}));

    screen.getByRole('button', { name: 'Play' }).click();
    calls = [];

    rerender(renderScreen({ card: lowConfidenceCard }));

    // The pause is recorded against the OUTGOING src: the previous track is silenced before
    // the new one is loaded, never after.
    expect(calls).toContain(`pause:${highConfidenceCard.previewUrl}`);
    expect(calls.filter((call) => call.startsWith('play:'))).toEqual([]);

    const audio = screen.getByTestId('session-audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe(lowConfidenceCard.previewUrl);
  });

  it('should stop audio when exit is confirmed', () => {
    // The stop is on the CONFIRM, not on the press that opens the dialog. Order still matters for
    // the same reason it always did: `onExit` unmounts this screen, and a pending play() on a
    // disappearing element is how a stray sound outlives its card.
    const onExit = vi.fn();
    render(renderScreen({ onExit }));

    screen.getByRole('button', { name: 'Play' }).click();
    calls = [];

    // `fireEvent`, not `.click()`, for anything that opens or answers the dialog: opening it is a
    // React state change, and only `fireEvent` wraps the dispatch in `act()` so the re-render has
    // flushed by the next line. The audio presses above stay on `.click()` -- they run through a
    // ref to the media element and change no React state.
    fireEvent.click(screen.getByRole('button', { name: 'Exit game' }));
    fireEvent.click(screen.getByRole('button', { name: 'End game' }));

    expect(calls).toContain(`pause:${highConfidenceCard.previewUrl}`);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('should not end the game on the exit press itself', () => {
    // ===================================================================
    //  EXIT IS IRREVERSIBLE, AND THE BUTTON IS TWO POSITIONS FROM PLAY.
    //
    //  `END` clears the saved session, so the shuffle, the position in the
    //  deck and every year resolved so far go with it, and nothing in the
    //  app can bring them back -- the deck is one-directional and "Play
    //  again" reshuffles rather than restores. This asserts the press only
    //  ASKS.
    //
    //  The audio assertion is the second half and it is deliberate: the
    //  preview keeps playing while the question is on screen, because the
    //  player may well say no and stopping it would be a change they did
    //  not ask for.
    // ===================================================================
    const onExit = vi.fn();
    render(renderScreen({ onExit }));

    screen.getByRole('button', { name: 'Play' }).click();
    calls = [];

    fireEvent.click(screen.getByRole('button', { name: 'Exit game' }));

    expect(onExit).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('should return to the game when the exit is cancelled', () => {
    const onExit = vi.fn();
    render(renderScreen({ onExit }));

    fireEvent.click(screen.getByRole('button', { name: 'Exit game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));

    expect(onExit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    // And the game is still operable rather than left in a half-exited state.
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeNull();
  });

  it('should ignore the game keys while the exit dialog is open', () => {
    // ===================================================================
    //  GUARD 4, AND IT IS THE ONE THE OTHER THREE DO NOT COVER.
    //
    //  The key handler is at the WINDOW, so it fires while a modal is up.
    //  Guard 3 catches Space -- focus is on a dialog button -- but nothing
    //  catches →, and → deals the next card. That would mean a player
    //  answering "end the game?" and losing a card to the same keystroke,
    //  behind a backdrop where they cannot see it happen.
    //
    //  Fixed as the effect's own condition rather than as a fourth check
    //  inside the handler: while the dialog is open this screen has no
    //  keyboard interface at all, and Escape belongs to the dialog.
    // ===================================================================
    const onFlip = vi.fn();
    const onNext = vi.fn();
    render(renderScreen({ onFlip, onNext }));

    fireEvent.click(screen.getByRole('button', { name: 'Exit game' }));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });

    expect(onNext).not.toHaveBeenCalled();
    expect(onFlip).not.toHaveBeenCalled();

    // And they work again once the dialog is gone -- the guard is a suspension, not a teardown.
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('should open the deck actions without touching the game', () => {
    // ===================================================================
    //  THE 2026-08-06 REVERSAL OF HALF OF PLAN 2'S DECISION 7.
    //
    //  The share link, the save and the PDF used to be reachable only by
    //  ENDING THE GAME -- which is irreversible, so the price of copying a
    //  link was the deck. They are on the control bar now, behind a modal
    //  panel, and the panel is what answers the decision's own objection
    //  that this would conflict with the swipe.
    //
    //  Opening it must change NOTHING: no audio event, no flip, no advance.
    // ===================================================================
    const onFlip = vi.fn();
    const onNext = vi.fn();
    render(renderScreen({ onFlip, onNext }));

    screen.getByRole('button', { name: 'Play' }).click();
    calls = [];

    fireEvent.click(screen.getByRole('button', { name: 'Keep this deck' }));

    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /copy share link/i })).not.toBeNull();
    // The preview keeps playing: the player is sharing a deck, not leaving the game.
    expect(calls).toEqual([]);
    expect(onFlip).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('should ignore the game keys while the deck actions are open', () => {
    // Guard 4 again, and it covers BOTH dialogs. Without it a → pressed while the panel is up would
    // deal the next card behind the backdrop -- a player pressing Print and losing a card in the
    // same keystroke, where they cannot see it happen.
    const onFlip = vi.fn();
    const onNext = vi.fn();
    render(renderScreen({ onFlip, onNext }));

    fireEvent.click(screen.getByRole('button', { name: 'Keep this deck' }));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });

    expect(onNext).not.toHaveBeenCalled();
    expect(onFlip).not.toHaveBeenCalled();

    // And they work again once it is closed -- the guard is a suspension, not a teardown.
    fireEvent.click(screen.getByRole('button', { name: /back to the game/i }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('should close the deck actions on Escape and leave the game playable', () => {
    render(renderScreen({}));

    fireEvent.click(screen.getByRole('button', { name: 'Keep this deck' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeNull();
  });

  it('should not leak the current card through the deck actions', () => {
    // ===================================================================
    //  THE PANEL HOLDS THE WHOLE DECK, FOR THE PDF, AND MOUNTS OVER AN
    //  UNFLIPPED CARD. That combination is the one plan 2 called a spoiler
    //  risk, and this is the assertion that answers it end to end rather
    //  than component by component: the real screen, the real card, the
    //  panel open.
    // ===================================================================
    const { container } = render(renderScreen({}));

    fireEvent.click(screen.getByRole('button', { name: 'Keep this deck' }));

    const text = container.textContent ?? '';
    for (const value of [
      highConfidenceCard.title,
      highConfidenceCard.artist,
      String(highConfidenceCard.year),
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it('should leave the audio element sourceless for a card with no preview', () => {
    // Not `src=""`: an empty string resolves against the document URL, so the element would
    // try to load the page itself as media.
    render(renderScreen({ card: noPreviewCard }));

    const audio = screen.getByTestId('session-audio') as HTMLAudioElement;
    expect(audio.hasAttribute('src')).toBe(false);
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('should not preload media', () => {
    // A 100-card deck must not fetch 100 previews for cards nobody reaches.
    render(renderScreen({}));

    expect(screen.getByTestId('session-audio').getAttribute('preload')).toBe('none');
  });
});

/**
 * Phase 5's keyboard controls.
 *
 * These are the ONLY gesture tests that can exist in jsdom. Motion's drag reads element
 * geometry jsdom does not compute, so a simulated pointer sequence would prove nothing about
 * the swipe; the thresholds are covered in `src/game/gestures.test.ts` and the drag itself on
 * real devices. Keyboard handling has no such problem -- it is a window listener and a few
 * conditionals, and every one of those conditionals is a real bug it prevents.
 *
 * Events are dispatched at `window` rather than at an element, because that is where the
 * handler lives: the card is not a control and nobody's hands are on it, so a focus-dependent
 * handler would be dead most of the time.
 */
describe('GameScreen keyboard controls', () => {
  beforeEach(() => {
    toDataURLMock.mockReset();
    toDataURLMock.mockImplementation((text) =>
      Promise.resolve(`data:image/png;base64,QR(${text})`),
    );

    // jsdom implements neither method, and `GameScreen`'s stop-on-mount effect calls `pause()`
    // for every render below. Stubbed only to keep "Not implemented" out of the output --
    // nothing here asserts on audio, which is what the first describe block is for.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should flip on Space', () => {
    const onFlip = vi.fn();
    render(renderScreen({ onFlip }));

    fireEvent.keyDown(window, { key: ' ' });

    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it('should advance on ArrowRight', () => {
    const onNext = vi.fn();
    render(renderScreen({ onNext }));

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('should prevent default on Space', () => {
    // Space scrolls the page by default and the card is viewport-sized, so an unprevented
    // press would flip the card and scroll it out of view in the same gesture.
    // `fireEvent` returns false when the event was cancelled.
    const onFlip = vi.fn();
    render(renderScreen({ onFlip }));

    const wasNotCancelled = fireEvent.keyDown(window, { key: ' ' });

    expect(wasNotCancelled).toBe(false);
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it('should not prevent default on ArrowRight', () => {
    // The converse, so the `preventDefault` above is provably scoped to Space rather than
    // applied to everything the handler sees. ArrowRight has no default worth suppressing.
    render(renderScreen({}));

    expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(true);
  });

  it('should ignore Space while focus is in a text input', () => {
    // Plan 3 puts a playlist-URL input on the landing screen. Without this guard, typing a URL
    // with a space in it would silently flip cards -- and the input would lose the space.
    const onFlip = vi.fn();
    render(renderScreen({ onFlip }));

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    try {
      fireEvent.keyDown(window, { key: ' ' });
      expect(onFlip).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it('should ignore Space while focus is on a button', () => {
    // ===================================================================
    //  THE DOUBLE-ACTION BUG, and the reason it is worth a test: it is
    //  invisible until someone plays with a keyboard after clicking Play.
    //
    //  Space is how a focused button is activated. Without this guard one
    //  press would BOTH toggle the audio and flip the card -- so pressing
    //  play would reveal the answer as a side effect.
    // ===================================================================
    const onFlip = vi.fn();
    render(renderScreen({ onFlip }));

    screen.getByRole('button', { name: 'Play' }).focus();

    fireEvent.keyDown(window, { key: ' ' });

    expect(onFlip).not.toHaveBeenCalled();
  });

  it('should still advance on ArrowRight while focus is on a button', () => {
    // The button guard is scoped to Space on purpose: ArrowRight does nothing to a focused
    // button, so there is no double-action, and disabling the advance after the player has
    // touched a control would be its own small hostility.
    const onNext = vi.fn();
    render(renderScreen({ onNext }));

    screen.getByRole('button', { name: 'Play' }).focus();

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('should ignore auto-repeat key events', () => {
    // Leaning on the arrow key would otherwise deal the entire deck, and the deck is
    // one-directional -- there is no way back from that.
    const onFlip = vi.fn();
    const onNext = vi.fn();
    render(renderScreen({ onFlip, onNext }));

    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
    fireEvent.keyDown(window, { key: ' ', repeat: true });

    expect(onNext).not.toHaveBeenCalled();
    expect(onFlip).not.toHaveBeenCalled();
  });

  it('should not handle keys when the game is not playable', () => {
    // `preparing` and `ended` both land here. Advancing past the end of the deck, or flipping
    // a card that has not been dealt yet, are both states the reducer should never be asked
    // about in the first place.
    const onFlip = vi.fn();
    const onNext = vi.fn();
    render(renderScreen({ onFlip, onNext, isPlayable: false }));

    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(onFlip).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('should ignore ArrowLeft', () => {
    // There is no previous card -- the deck is one-directional by design -- so the safe
    // response to a player pressing it is nothing at all. Asserted rather than left implicit,
    // because "back" is exactly the behaviour someone will later add without reading Phase 3.
    const onFlip = vi.fn();
    const onNext = vi.fn();
    render(renderScreen({ onFlip, onNext }));

    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    expect(onFlip).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('should remove the key handler on unmount', () => {
    // A window listener outlives the component that added it. Plan 3 unmounts this screen on
    // Exit and on the end of the deck, and a surviving handler would keep dispatching FLIP and
    // NEXT into a session that has already ended.
    const onFlip = vi.fn();
    const onNext = vi.fn();
    const { unmount } = render(renderScreen({ onFlip, onNext }));

    unmount();

    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(onFlip).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });
});
