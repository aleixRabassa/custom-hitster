/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Card } from './Card';
import { highConfidenceCard } from './__fixtures__/cards';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

/**
 * No `audio` and no `onExit`: the three controls left the card for `CardControls`, because a
 * pointer-up on a button inside a tappable card bubbles into the gesture handler and flips it.
 */
function renderCard(isFlipped: boolean) {
  return render(
    <Card card={highConfidenceCard} isFlipped={isFlipped} isYearPending={false} onFlip={vi.fn()} />,
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

  it('should keep the hidden side mounted while flipped', async () => {
    // Both faces must exist for the 3D transform to have anything to rotate.
    //
    // Asserted through the QR rather than through the controls, because the controls are no
    // longer on this face -- they moved to `CardControls` when the card became tappable, since
    // a pointer-up on a button inside the card was being read as a tap and flipping it.
    renderCard(true);

    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toContain(highConfidenceCard.id);
    expect(screen.getByTestId('card-hidden-face').textContent).not.toBe('');
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
