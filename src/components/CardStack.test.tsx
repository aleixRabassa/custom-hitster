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

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
import { clearQrCache } from '../game/qr-cache';
import type { Card } from '../../shared/types';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

function renderStack(deck: Card[], currentIndex: number) {
  return render(
    <CardStack
      deck={deck}
      currentIndex={currentIndex}
      isFlipped={false}
      isYearPending={false}
      onFlip={vi.fn()}
      onNext={vi.fn()}
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
    /*
      Generated codes are cached at MODULE level (`src/game/qr-cache.ts`), which is what carries
      the back's preloaded code across an advance. Vitest isolates modules per FILE, not per test,
      so without this every test after the first renders the fixture deck against a warm cache --
      the generation counts below would read 0 and the placeholder would never appear.
    */
    clearQrCache();
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

    /*
      ONE image in the accessibility tree, though there are two in the DOM: the back is
      `aria-hidden`, and a role query skips an aria-hidden subtree. That is the assertion worth
      making -- the back exists for the eye during a swipe, and a screen reader must not be read
      the same generic "Scan to play in Spotify" twice per card.
    */
    expect(screen.getAllByRole('img')).toHaveLength(1);
    // And no interactive element anywhere in the stack -- the controls live outside the
    // draggable surface, because a pointer-up on a button inside it reads as a tap and flips
    // the card. See `CardControls`.
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('should render exactly one back, however much deck is left', () => {
    // One, not two and not seven. Two was the Phase 5 shape and it is what produced the
    // "two cards, one inside the other" look once the top card was dragged aside: each back
    // was scaled from its CENTRE, so both were inset on every side rather than peeking.
    // With the back at the card's exact size there is nothing for a second one to add.
    expect(
      renderStack(fixtureDeck, 0).container.querySelectorAll('[data-testid="card-back"]'),
    ).toHaveLength(1);

    cleanup();

    // And the same one card from the other end of the deck.
    expect(
      renderStack(fixtureDeck, fixtureDeck.length - 2).container.querySelectorAll(
        '[data-testid="card-back"]',
      ),
    ).toHaveLength(1);
  });

  it('should render no back on the last card', async () => {
    // The tail of the deck. A phantom back for a card that does not exist would be a promise
    // of another card at the exact moment the game is about to end.
    const { container } = renderStack(fixtureDeck, fixtureDeck.length - 1);

    expect(container.querySelectorAll('[data-testid="card-back"]')).toHaveLength(0);
    // And the current card is still there -- "no back" must not mean "nothing rendered".
    expect(await screen.findByRole('img')).not.toBeNull();
  });

  it('should preload the next card on the back, with its QR', async () => {
    // ===================================================================
    //  THE POINT OF THE BACK, and a reversal of what this file asserted
    //  until 2026-08-06 (it used to pin `toHaveBeenCalledTimes(1)`).
    //
    //  An empty div is not what a player is looking for when they slide a
    //  card away -- they are looking for the next card, and it used to
    //  arrive blank because its QR could not begin generating until the
    //  advance had already happened. Generating it one card early is the
    //  cost this deliberately pays, and it pays it off the critical path.
    // ===================================================================
    const { container } = renderStack([highConfidenceCard, lowConfidenceCard, noYearCard], 0);

    await waitFor(() => {
      expect(toDataURLMock).toHaveBeenCalledTimes(2);
    });

    const encoded = toDataURLMock.mock.calls.map(([text]) => text);
    expect(encoded.some((text) => text.includes(highConfidenceCard.id))).toBe(true);
    expect(encoded.some((text) => text.includes(lowConfidenceCard.id))).toBe(true);
    // TWO cards ahead is not preloaded. The back caps the cost at one extra code per advance.
    expect(encoded.some((text) => text.includes(noYearCard.id))).toBe(false);

    // The back's code is really in the back, painted and ready before any swipe happens.
    const back = container.querySelector('[data-testid="card-back"]');
    await waitFor(() => {
      expect(back?.querySelector('img')?.getAttribute('src')).toContain(lowConfidenceCard.id);
    });
  });

  it('should never render an answer on the back, or a card two ahead', async () => {
    // ===================================================================
    //  THE LEAK ASSERTION. It survived the back becoming a real card face
    //  unchanged in the part that matters, and it is the one that stops a
    //  later "reuse `Card` for the back so the flip is smoother" refactor.
    //
    //  The whole game rests on a card being a mystery until it is flipped,
    //  and `backface-visibility` does not remove text from the DOM. So the
    //  back may render `CardHiddenSide` and nothing else: no title, no
    //  artist, no year, in body text or in any attribute, in devtools, in
    //  Ctrl+F or in the a11y tree.
    //
    //  The track ID is the one thing that IS now in the document a card
    //  early, because the QR encodes it -- 22 opaque characters, on a face
    //  that is a mystery by construction, for the card the player is in the
    //  act of dealing themselves. That was weighed and accepted; the answer
    //  was not.
    // ===================================================================
    const { container } = renderStack([highConfidenceCard, lowConfidenceCard, noYearCard], 0);

    const back = container.querySelector('[data-testid="card-back"]');
    expect(back).not.toBeNull();

    // Wait for the code so the assertion runs against the FULL back, not a placeholder.
    await waitFor(() => {
      expect(back?.querySelector('img')).not.toBeNull();
    });

    // `outerHTML` rather than `textContent`: an `aria-label`, a `title` or a `data-*` is a leak
    // surface exactly as body text is, and only the markup catches those.
    const backHtml = back?.outerHTML ?? '';
    expect(backHtml).not.toContain(lowConfidenceCard.title);
    expect(backHtml).not.toContain(lowConfidenceCard.artist);
    expect(backHtml).not.toContain(String(lowConfidenceCard.year));
    // No reveal face at all, mounted or empty. `CardStack` does not import `CardRevealSide`,
    // and this is the assertion that keeps it that way.
    expect(back?.querySelector('[data-testid="card-reveal-face"]')).toBeNull();
    expect(back?.querySelector('[role="status"]')).toBeNull();

    // And the card AFTER the back is not in the document in any form -- not its answer, not
    // even its id. The preload is one card deep.
    const html = container.innerHTML;
    expect(html).not.toContain(noYearCard.title);
    expect(html).not.toContain(noYearCard.artist);
    expect(html).not.toContain(String(noYearCard.year));
    expect(html).not.toContain(noYearCard.id);
  });

  it("should place the back at the card's exact size and position, with no transform", () => {
    // ===================================================================
    //  THE FIX FOR "TWO CARDS, ONE INSIDE THE OTHER".
    //
    //  The backs used to carry `translateY(10px) scale(0.96)`. `scale()` is
    //  CENTRE-origin, so it pulled the bottom edge UP by (H / 2) x step --
    //  8.96px at the card's 448px ceiling -- against a 10px push down. The
    //  net was a 1px peek at the bottom and an INSET on every other side,
    //  so what a swipe uncovered was a smaller concentric rectangle rather
    //  than the next card. Measured in `docs/agent_findings.md`.
    //
    //  `inset-0` with no transform is the whole fix: the back is the card's
    //  box exactly, hidden at rest and aligned the instant the top card
    //  moves. jsdom computes no layout, so this pins the DECLARATIONS --
    //  the geometry itself is a browser check.
    // ===================================================================
    const { container } = renderStack(fixtureDeck, 0);

    const back = container.querySelector('[data-testid="card-back"]') as HTMLElement;
    expect(back.className).toContain('inset-0');
    expect(back.style.transform).toBe('');
    // No Tailwind transform utility sneaking the same thing back in through a class.
    expect(back.className).not.toMatch(/(?:^|\s)(?:scale|translate)-/);
  });

  it('should size the stack wrapper from the same token as the card', () => {
    // ===================================================================
    //  THE POINT OF THIS TEST IS THAT THE TWO CANNOT DRIFT.
    //
    //  This wrapper and the card inside it each carried `h-[28rem] w-72`
    //  through Phase 6, and the two literals were REQUIRED to agree: the
    //  peeking backs are `absolute inset-0` on this wrapper, so a card
    //  resized without the wrapper leaves the backs the old size and the
    //  deck stops lining up. NOTHING enforced it -- there was no test, and
    //  the two values lived in different files.
    //
    //  So the assertion is on EQUALITY of the size classes, not merely on
    //  each being a token. A future change that retokenises one and not the
    //  other fails here.
    // ===================================================================
    const { container } = renderStack(fixtureDeck, 0);

    const wrapper = container.firstElementChild;
    // The card's outer element is `card-inner`'s parent -- `Card` puts the drag on the outside and
    // the rotation on the inner wrapper, and it is the OUTER one that carries the size.
    const cardOuter = container.querySelector('[data-testid="card-inner"]')?.parentElement;

    const sizeClasses = (element: Element | null | undefined) =>
      (element?.className ?? '')
        .split(/\s+/)
        .filter((name) => name.startsWith('h-') || name.startsWith('w-'))
        .sort()
        .join(' ');

    expect(sizeClasses(wrapper)).toBe('h-(--card-height) w-(--card-width)');
    expect(sizeClasses(cardOuter)).toBe(sizeClasses(wrapper));
  });

  it('should give the back the full ring with the bloom suppressed', () => {
    // ===================================================================
    //  The silent-no-op guard for the back, and the bloom decision beside
    //  it. Both classes REPLACED `card-ring-dim` on 2026-08-06.
    //
    //  `card-ring`, because the back is a real card face now and has to
    //  look like one the moment a swipe uncovers it -- the old flat dimmed
    //  border was chosen when a back was a two-pixel sliver.
    //
    //  `card-ring-quiet`, because a `box-shadow` paints OUTSIDE the element
    //  and this element's box is pixel-for-pixel the front card's: two
    //  identical blooms composite to a halo half again as bright as the one
    //  the design was tuned for, on every card of every game. It suppresses
    //  the glow through a custom property rather than a second `box-shadow`
    //  declaration, so the two utilities cannot race in the cascade.
    //
    //  An unknown Tailwind utility emits NO RULE AT ALL and fails every
    //  check silently, which is why the class names are pinned here and the
    //  utilities themselves in `src/index.css.test.ts`.
    //
    //  `absolute` is asserted for the same reason as on the faces: neither
    //  ring utility sets `position`, by design.
    // ===================================================================
    const { container } = renderStack(fixtureDeck, 0);

    const back = container.querySelector('[data-testid="card-back"]') as HTMLElement;

    // Word-boundary matches: `card-ring` is a prefix of `card-ring-quiet`, so a `toContain`
    // for the first would pass on the second alone and vice versa.
    expect(back.className).toMatch(/(?:^|\s)card-ring(?:\s|$)/);
    expect(back.className).toMatch(/(?:^|\s)card-ring-quiet(?:\s|$)/);
    expect(back.className).toContain('absolute');
    expect(back.className).toContain('rounded-card');
    // The removed utility, so a revert has to be deliberate rather than a merge artefact.
    expect(back.className).not.toContain('card-ring-dim');
    expect(back.className).not.toContain('border-border');
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
        onFlip={vi.fn()}
        onNext={vi.fn()}
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
