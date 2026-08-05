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

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameScreen } from './GameScreen';
import { highConfidenceCard, lowConfidenceCard, noPreviewCard } from './__fixtures__/cards';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

let calls: string[] = [];

function renderScreen(props: {
  card?: typeof highConfidenceCard;
  isFlipped?: boolean;
  onExit?: () => void;
}) {
  const element = (
    <GameScreen
      card={props.card ?? highConfidenceCard}
      isFlipped={props.isFlipped ?? false}
      isYearPending={false}
      onFlip={vi.fn()}
      onNext={vi.fn()}
      onExit={props.onExit ?? vi.fn()}
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

  it('should stop audio when the card is flipped', () => {
    const { rerender } = render(renderScreen({}));

    screen.getByRole('button', { name: 'Play' }).click();
    expect(calls).toContain(`play:${highConfidenceCard.previewUrl}`);

    calls = [];
    rerender(renderScreen({ isFlipped: true }));

    // Once the answer is on screen the preview has no job left -- and leaving it running is
    // how the next card starts against the previous track's audio.
    expect(calls).toContain(`pause:${highConfidenceCard.previewUrl}`);
    const audio = screen.getByTestId('session-audio') as HTMLAudioElement;
    expect(audio.currentTime).toBe(0);
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

  it('should stop audio when exit is invoked', () => {
    const onExit = vi.fn();
    render(renderScreen({ onExit }));

    screen.getByRole('button', { name: 'Play' }).click();
    calls = [];

    screen.getByRole('button', { name: 'Exit game' }).click();

    expect(calls).toContain(`pause:${highConfidenceCard.previewUrl}`);
    expect(onExit).toHaveBeenCalledTimes(1);
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
