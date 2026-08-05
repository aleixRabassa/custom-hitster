/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Card } from './Card';
import { highConfidenceCard } from './__fixtures__/cards';
import type { CardAudioControls } from '../hooks/useCardAudio';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

function stubAudio(): CardAudioControls {
  return {
    canPlay: true,
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    restart: vi.fn(),
    stop: vi.fn(),
  };
}

function renderCard(isFlipped: boolean) {
  return render(
    <Card
      card={highConfidenceCard}
      isFlipped={isFlipped}
      isYearPending={false}
      audio={stubAudio()}
      onFlip={vi.fn()}
      onExit={vi.fn()}
    />,
  );
}

describe('Card', () => {
  beforeEach(() => {
    toDataURLMock.mockReset();
    toDataURLMock.mockImplementation((text) =>
      Promise.resolve(`data:image/png;base64,QR(${text})`),
    );
  });

  afterEach(cleanup);

  it('should not mount the revealed side while unflipped', () => {
    // ===================================================================
    //  THE DOM-PRESENCE LEAK INVARIANT -- the single most important
    //  assertion in this plan.
    //
    //  `backface-visibility` would hide the reveal side visually while
    //  leaving every word of it in the document, readable through
    //  devtools, Ctrl+F, and the accessibility tree. So the assertion is
    //  about MOUNTING, not about visibility: the title, artist and year
    //  must not exist in the DOM at all.
    // ===================================================================
    const { container } = renderCard(false);

    expect(screen.queryByText(highConfidenceCard.title)).toBeNull();
    expect(screen.queryByText(highConfidenceCard.artist)).toBeNull();
    expect(screen.queryByText(String(highConfidenceCard.year))).toBeNull();
    expect(container.textContent ?? '').not.toContain(highConfidenceCard.title);
    expect(container.textContent ?? '').not.toContain(String(highConfidenceCard.year));

    // The face itself exists (a 3D flip needs it) -- it is empty.
    const revealFace = screen.getByTestId('card-reveal-face');
    expect(revealFace.textContent).toBe('');
  });

  it('should mount the revealed side when flipped', () => {
    renderCard(true);

    expect(screen.queryByText(highConfidenceCard.title)).not.toBeNull();
    expect(screen.queryByText(highConfidenceCard.artist)).not.toBeNull();
    expect(screen.queryByText(String(highConfidenceCard.year))).not.toBeNull();
  });

  it('should keep the hidden side mounted while flipped', () => {
    // Both faces must exist for the 3D transform to have anything to rotate. Unmounting the
    // hidden face on flip would also destroy the audio controls mid-playback.
    renderCard(true);

    expect(screen.queryByRole('button', { name: 'Exit game' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeNull();
  });

  it('should apply the flipped transform only when flipped', () => {
    const { container } = renderCard(false);
    const unflipped = container.querySelector('[data-testid="card-inner"]');
    expect(unflipped?.className).not.toContain('rotate-y-180');
    expect(unflipped?.getAttribute('data-flipped')).toBe('false');

    cleanup();

    const flipped = renderCard(true).container.querySelector('[data-testid="card-inner"]');
    expect(flipped?.className).toContain('rotate-y-180');
    expect(flipped?.getAttribute('data-flipped')).toBe('true');
  });

  it('should render exactly one QR code, on the hidden face', async () => {
    renderCard(true);

    const images = await screen.findAllByRole('img');
    expect(images).toHaveLength(1);
    expect(screen.getByTestId('card-hidden-face').contains(images[0] ?? null)).toBe(true);
  });
});
