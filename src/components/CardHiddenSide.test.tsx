/**
 * @vitest-environment jsdom
 *
 * `qrcode` is mocked for the reasons given in `QrCode.test.tsx` (jsdom has no canvas, and the
 * mock's output is inspectable). The leak test below walks EVERY attribute of EVERY element,
 * which is what makes mocking the QR safe here: a real data URL would be opaque noise, while
 * the mock's data URL carries its input and would expose a title if one were ever encoded.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CardHiddenSide } from './CardHiddenSide';
import { highConfidenceCard, noPreviewCard } from './__fixtures__/cards';
import type { CardAudioControls } from '../hooks/useCardAudio';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

/** A stub `useCardAudio` return value. `canPlay` is the only interesting axis here. */
function stubAudio(overrides: Partial<CardAudioControls> = {}): CardAudioControls {
  return {
    canPlay: true,
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    restart: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

describe('CardHiddenSide', () => {
  beforeEach(() => {
    toDataURLMock.mockReset();
    toDataURLMock.mockImplementation((text) =>
      Promise.resolve(`data:image/png;base64,QR(${text})`),
    );
  });

  afterEach(cleanup);

  it('should render the QR code even when the track has no preview', async () => {
    // The always-available fallback: audio is additive, the QR is the product.
    render(
      <CardHiddenSide
        card={noPreviewCard}
        audio={stubAudio({ canPlay: false })}
        onExit={vi.fn()}
      />,
    );

    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toContain(noPreviewCard.id);
  });

  it('should disable play/pause and restart when the track has no preview', () => {
    render(
      <CardHiddenSide
        card={noPreviewCard}
        audio={stubAudio({ canPlay: false })}
        onExit={vi.fn()}
      />,
    );

    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Restart' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('should keep exit enabled when the track has no preview', () => {
    // Exit and the QR are never affected by a missing preview -- and a card whose audio does
    // not work is exactly the card a player wants to leave.
    render(
      <CardHiddenSide
        card={noPreviewCard}
        audio={stubAudio({ canPlay: false })}
        onExit={vi.fn()}
      />,
    );

    expect((screen.getByRole('button', { name: 'Exit game' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('should enable play/pause and restart when the track has a preview', () => {
    render(<CardHiddenSide card={highConfidenceCard} audio={stubAudio()} onExit={vi.fn()} />);

    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: 'Restart' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('should not render the title, artist, or year anywhere in the DOM', async () => {
    // ===================================================================
    //  THE LEAK TEST. This is the automated defence of the product's
    //  central rule, and it deliberately checks three surfaces:
    //  text content, every attribute of every element, and the accessible
    //  names of the controls. A leak audit that only greps visible text
    //  misses an aria-label, and an aria-label leaks just as completely.
    // ===================================================================
    const card = highConfidenceCard;
    const { container } = render(
      <CardHiddenSide card={card} audio={stubAudio()} onExit={vi.fn()} />,
    );

    // Wait for the QR to resolve, so the assertion covers the settled DOM rather than the
    // placeholder -- the image and its attributes are part of what must not leak.
    await screen.findByRole('img');

    const forbidden = [card.title, card.artist, String(card.year), String(card.durationMs)];

    for (const value of forbidden) {
      expect(container.textContent ?? '').not.toContain(value);
      expect(screen.queryByText(value)).toBeNull();
    }

    for (const element of Array.from(container.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        for (const value of forbidden) {
          expect(attribute.value).not.toContain(value);
        }
      }
    }
  });

  it('should give the controls generic accessible names', () => {
    // The names are asserted EXACTLY, not merely "does not contain the title": a generic
    // name is the requirement, and an exhaustive list is what catches a well-meaning
    // "Play preview of …" edit.
    render(<CardHiddenSide card={highConfidenceCard} audio={stubAudio()} onExit={vi.fn()} />);

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);

    expect(names).toEqual(['Exit game', 'Play', 'Restart']);
  });

  it('should name the toggle Pause while playing', () => {
    render(
      <CardHiddenSide
        card={highConfidenceCard}
        audio={stubAudio({ isPlaying: true })}
        onExit={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('should invoke the exit callback on exit', () => {
    const onExit = vi.fn();
    render(<CardHiddenSide card={highConfidenceCard} audio={stubAudio()} onExit={onExit} />);

    screen.getByRole('button', { name: 'Exit game' }).click();

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('should invoke play, pause, and restart on their controls', () => {
    const audio = stubAudio();
    const { rerender } = render(
      <CardHiddenSide card={highConfidenceCard} audio={audio} onExit={vi.fn()} />,
    );

    screen.getByRole('button', { name: 'Play' }).click();
    expect(audio.play).toHaveBeenCalledTimes(1);

    screen.getByRole('button', { name: 'Restart' }).click();
    expect(audio.restart).toHaveBeenCalledTimes(1);

    const playing = stubAudio({ isPlaying: true });
    rerender(<CardHiddenSide card={highConfidenceCard} audio={playing} onExit={vi.fn()} />);
    screen.getByRole('button', { name: 'Pause' }).click();
    expect(playing.pause).toHaveBeenCalledTimes(1);
  });
});
