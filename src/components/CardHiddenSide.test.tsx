/**
 * @vitest-environment jsdom
 *
 * `qrcode` is mocked for the reasons given in `QrCode.test.tsx` (jsdom has no canvas, and the
 * mock's output is inspectable). The leak test below walks EVERY attribute of EVERY element,
 * which is what makes mocking the QR safe here: a real data URL would be opaque noise, while
 * the mock's data URL carries its input and would expose a title if one were ever encoded.
 *
 * The control assertions that used to live here moved to `CardControls.test.tsx` along with the
 * buttons themselves -- see that file's header for why the buttons left the card.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CardHiddenSide } from './CardHiddenSide';
import { highConfidenceCard, noPreviewCard } from './__fixtures__/cards';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

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
    render(<CardHiddenSide card={noPreviewCard} />);

    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toContain(noPreviewCard.id);
  });

  it('should render no interactive element at all', async () => {
    // ===================================================================
    //  THE REGRESSION GUARD for the bug that moved the controls out.
    //
    //  `gestureProps.onPointerUp` is bound to the card's outer element, so
    //  a pointer-up anywhere inside it -- including on a button -- is
    //  judged as a possible tap. Any button re-added to this face would
    //  both activate itself and flip the card from one press, revealing
    //  the answer as a side effect of pressing Play.
    //
    //  This asserts the STRUCTURAL fix rather than a guard: there is
    //  nothing clickable inside the draggable surface.
    // ===================================================================
    const { container } = render(<CardHiddenSide card={highConfidenceCard} />);
    await screen.findByRole('img');

    expect(container.querySelectorAll('button, a, input, select, textarea').length).toBe(0);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('should not put a live region on the hidden side', async () => {
    // ===================================================================
    //  THE NEGATIVE HALF OF THE PHASE 7 REVEAL ANNOUNCEMENT.
    //
    //  `CardRevealSide` gained a polite live region, because the flip was
    //  silent to assistive technology and the payoff of the game was
    //  therefore invisible to it. That is correct exactly once -- after a
    //  flip the player asked for.
    //
    //  A live region on THIS face would announce a card the player is meant
    //  to be guessing, which is the same leak as printing the title on it.
    //  This face is mounted the entire time the card is unflipped, so the
    //  exposure is the whole game rather than a moment.
    //
    //  It joins the leak assertions below rather than replacing them: those
    //  cover what is SAID, this covers whether anything is said at all.
    // ===================================================================
    const { container } = render(<CardHiddenSide card={highConfidenceCard} />);
    await screen.findByRole('img');

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it('should not render the title, artist, or year anywhere in the DOM', async () => {
    // ===================================================================
    //  THE LEAK TEST. This is the automated defence of the product's
    //  central rule, and it deliberately checks two surfaces: text
    //  content, and every attribute of every element. A leak audit that
    //  only greps visible text misses an aria-label, and an aria-label
    //  leaks just as completely.
    // ===================================================================
    const card = highConfidenceCard;
    const { container } = render(<CardHiddenSide card={card} />);

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
});
