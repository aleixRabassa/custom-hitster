/**
 * @vitest-environment jsdom
 *
 * Composition tests for the stack. Deliberately NOT drag tests -- Motion's drag reads element
 * geometry jsdom does not compute, so a simulated pointer sequence here would assert that the
 * test double works rather than that the gesture does. The gesture decisions are covered
 * exhaustively in `src/game/gestures.test.ts` instead, and the drag itself on real devices.
 *
 * `qrcode` is faked because jsdom has no canvas; that fake is also what makes the leak
 * assertion below meaningful, since a rendered QR would otherwise be an unreadable `<img>`.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CardStack } from './CardStack';
import {
  duplicateIdCardA,
  duplicateIdCardB,
  fixtureDeck,
  highConfidenceCard,
  lowConfidenceCard,
  noYearCard,
} from './__fixtures__/cards';
import type { CardAudioControls } from '../hooks/useCardAudio';
import type { Card } from '../../shared/types';

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

function renderStack(deck: Card[], currentIndex: number) {
  return render(
    <CardStack
      deck={deck}
      currentIndex={currentIndex}
      isFlipped={false}
      isYearPending={false}
      audio={stubAudio()}
      onFlip={vi.fn()}
      onNext={vi.fn()}
      onExit={vi.fn()}
      isEnabled
    />,
  );
}

describe('CardStack', () => {
  beforeEach(() => {
    toDataURLMock.mockReset();
    toDataURLMock.mockImplementation((text) =>
      Promise.resolve(`data:image/png;base64,QR(${text})`),
    );
  });

  // Testing Library does NOT auto-clean up here: its `afterEach(cleanup)` only registers when
  // Vitest `globals` are on, and this repo imports `describe`/`it`/`expect` explicitly. Without
  // this line a later test queries a DOM still holding every earlier render.
  afterEach(cleanup);

  it('should render the current card on top', async () => {
    // Card 3 of the fixture deck, so there is a card behind AND in front -- proving the stack
    // reads `currentIndex` rather than always showing the head of the deck.
    renderStack(fixtureDeck, 2);

    // The QR encodes the current card's id, which is how we identify WHICH card is on top
    // without reading anything the hidden side is forbidden to show.
    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toContain(noYearCard.id);

    // Exactly one card has a face: the backs are empty divs, so there is one QR and one set of
    // controls, not three.
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(1);
  });

  it('should render up to two backs behind the current card', () => {
    const { container } = renderStack(fixtureDeck, 0);

    // Two, not seven: the stack is a depth cue, so it caps regardless of how much deck is
    // left. A 100-card playlist must not mount 100 divs.
    expect(container.querySelectorAll('[data-testid="card-back"]')).toHaveLength(2);
  });

  it('should render no backs on the last card', () => {
    // The tail of the deck. A phantom back for a card that does not exist would be a promise
    // of another card at the exact moment the game is about to end.
    const { container } = renderStack(fixtureDeck, fixtureDeck.length - 1);

    expect(container.querySelectorAll('[data-testid="card-back"]')).toHaveLength(0);
    // And the current card is still there -- "no backs" must not mean "nothing rendered".
    expect(screen.getByRole('button', { name: 'Play' })).not.toBeNull();
  });

  it('should render exactly one back with one card left behind the current one', () => {
    // The other end of the `slice`: one remaining card is one back, not two and not zero.
    const { container } = renderStack(fixtureDeck, fixtureDeck.length - 2);

    expect(container.querySelectorAll('[data-testid="card-back"]')).toHaveLength(1);
  });

  it('should not render title, artist, year, or a QR code for the backs', () => {
    // ===================================================================
    //  THE LEAK-AND-COST ASSERTION, and the one that stops a later
    //  "just reuse Card for the backs" refactor.
    //
    //  LEAK: the whole game rests on the next card being a mystery.
    //  `backface-visibility` does not remove text from the DOM, so the
    //  only safe version of a card peeking out from behind is one with
    //  nothing to read -- in devtools, in Ctrl+F, or in the a11y tree.
    //
    //  COST: every QR is an async `toDataURL()` render. Reusing `Card`
    //  would triple that work per advance for two faces nobody can see.
    // ===================================================================
    const { container } = renderStack([highConfidenceCard, lowConfidenceCard, noYearCard], 0);

    const backs = [...container.querySelectorAll('[data-testid="card-back"]')];
    expect(backs).toHaveLength(2);

    // Nothing at all inside a back -- not text, not an element.
    for (const back of backs) {
      expect(back.textContent).toBe('');
      expect(back.children).toHaveLength(0);
    }

    // And nothing about the upcoming cards anywhere in the tree, including in attributes --
    // `outerHTML` catches an `aria-label` or a `data-*` that `textContent` would miss.
    const html = container.innerHTML;
    for (const upcoming of [lowConfidenceCard, noYearCard]) {
      expect(html).not.toContain(upcoming.title);
      expect(html).not.toContain(upcoming.artist);
      expect(html).not.toContain(String(upcoming.year));
      // Not even the id: it is what the QR encodes, and a scannable next card is a leak.
      expect(html).not.toContain(upcoming.id);
    }

    // The QR was generated once, for the current card only.
    expect(toDataURLMock).toHaveBeenCalledTimes(1);
    expect(toDataURLMock.mock.calls[0]?.[0]).toContain(highConfidenceCard.id);
  });

  it('should give adjacent duplicate-id cards distinct keys', () => {
    // ===================================================================
    //  A playlist may legitimately contain the same track twice, and
    //  Phase 3's reducer handles duplicate ids explicitly for exactly
    //  that reason. So two ADJACENT cards can share an id.
    //
    //  An `AnimatePresence` key of the bare card id then collides between
    //  them, and React reuses one element for both: advancing from copy A
    //  to copy B would be a no-op with no exit animation, and -- because
    //  the element is reused rather than remounted -- the flip state
    //  could survive the advance and show the answer immediately.
    //
    //  Keying on id PLUS deck index is what prevents it. This test proves
    //  the advance actually remounts.
    // ===================================================================
    const deck = [duplicateIdCardA, duplicateIdCardB];

    const { rerender, container } = renderStack(deck, 0);
    const firstInner = container.querySelector('[data-testid="card-inner"]');

    rerender(
      <CardStack
        deck={deck}
        currentIndex={1}
        isFlipped={false}
        isYearPending={false}
        audio={stubAudio()}
        onFlip={vi.fn()}
        onNext={vi.fn()}
        onExit={vi.fn()}
        isEnabled
      />,
    );

    // The keys differ, so the incoming card is a NEW element rather than the previous one
    // reused. Both may be present at once while the outgoing card animates out, which is why
    // this asserts on identity rather than on a count.
    const inners = [...container.querySelectorAll('[data-testid="card-inner"]')];
    expect(inners.some((inner) => inner !== firstInner)).toBe(true);
  });
});
