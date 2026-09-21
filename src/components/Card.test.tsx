/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'motion/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CARD_VARIANTS, Card } from './Card';
import { highConfidenceCard } from './__fixtures__/cards';
import { clearQrCache } from '../game/qr-cache';

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
    // Generated codes are cached at module level (`src/game/qr-cache.ts`) so the deck's preload
    // survives a card advance. Vitest isolates modules per FILE, so every test here would
    // otherwise render against whatever the previous one generated. Same reason as `cleanup`.
    clearQrCache();
  });

  afterEach(cleanup);

  it('should attach a forwarded ref to its outer element', () => {
    // ===================================================================
    //  THE HALF OF THE EXIT ANIMATION THAT IS TESTABLE, AND IT IS THE
    //  HALF THAT SILENTLY WENT MISSING.
    //
    //  `CardStack` runs `AnimatePresence mode="popLayout"` so a committed
    //  card is taken out of layout flow while it flies off. Motion does
    //  that by CLONING this component with a ref, measuring the element,
    //  and injecting a `position: absolute` rule for it -- and every step
    //  is guarded by `ref.current`. With no ref prop the clone's ref
    //  landed on nothing, so the pop never happened, the incoming card was
    //  laid out a full card-height below the outgoing one, and it appeared
    //  to rise from below the screen when the exit finished. No error, no
    //  warning: `popLayout` was configured and inert.
    //
    //  It must be the OUTER element specifically. That is the one in flow,
    //  the one Motion measures, and the one that carries the drag; a ref
    //  pointed at the inner flip wrapper would satisfy Motion's null check
    //  and then absolutise the wrong box.
    //
    //  What happens NEXT -- that the popped card really leaves the flow --
    //  is not reachable here: jsdom computes no layout, so Motion's own
    //  measurement bails on a `getComputedStyle().height` of `auto`
    //  whatever this component does. That end is manual, in a browser.
    // ===================================================================
    const ref = createRef<HTMLDivElement>();

    const { container } = render(
      <Card
        card={highConfidenceCard}
        isFlipped={false}
        isYearPending={false}
        onFlip={vi.fn()}
        ref={ref}
      />,
    );

    const outer = container.querySelector('[data-testid="card-inner"]')?.parentElement;
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(outer);
  });

  it('should deal a card out to the right and undeal one without moving it', () => {
    // ===================================================================
    //  THE HALF OF THE EXIT THAT IS TESTABLE (2026-09-19, rewritten
    //  2026-09-21 when the two movements stopped being mirror images).
    //
    //  An exiting child animates with the props of its LAST render before
    //  removal, and a keyboard advance changes the index and removes the
    //  card in the same render -- so a movement passed as a plain prop
    //  never reaches it. The exit is therefore a dynamic variant reading
    //  `AnimatePresence custom`, which Motion carries to the child on the
    //  very render that removes it.
    //
    //  What is pinned is the RESOLVER. `forward` throws the card off to
    //  the right and fades it. `backward` does NOT throw it anywhere: the
    //  returning card is the thing that moves, and all this one has to do
    //  is settle back to the deck's centre and get UNDER the card landing
    //  on top of it. That is why `x` is 0 and the z-index is negative --
    //  `popLayout` absolutises the outgoing card, and a positioned element
    //  would otherwise paint over the in-flow one.
    //
    //  That Motion reads `custom` into it, and what the eye then sees, are
    //  browser checks -- jsdom paints nothing.
    // ===================================================================
    const forward = CARD_VARIANTS.exit('forward');
    const backward = CARD_VARIANTS.exit('backward');
    const none = CARD_VARIANTS.exit(undefined);

    expect(forward.x).toBeGreaterThan(0);
    expect(forward.opacity).toBe(0);

    // It stays put and stays visible: the entrance covers it, so fading it would show through.
    expect(backward.x).toBe(0);
    expect(backward.opacity).toBe(1);

    // No movement at all (a `Card` outside any `AnimatePresence`, as every render in this file
    // is) still resolves, and resolves to the deal.
    expect(none).toEqual(forward);
  });

  it('should drop the outgoing card under the incoming one but above the deck preload', () => {
    // ===================================================================
    //  THE BOUND THAT MAKES THE BACKWARD ANIMATION VISIBLE AT ALL.
    //
    //  `CardStack` renders the next card's hidden face at `-z-10` inside
    //  an `isolate`. The outgoing card has to sit BELOW the returning card
    //  (so the return is seen) and ABOVE that preload (so the player does
    //  not watch the card they are leaving sink behind a copy of itself).
    //  Both ends are arithmetic a test can hold; which one the eye sees is
    //  a browser check.
    // ===================================================================
    const backward = CARD_VARIANTS.exit('backward');

    expect(backward.zIndex).toBeLessThan(0);
    expect(backward.zIndex).toBeGreaterThan(-10);
    // A deal keeps the card on top, which is what `popLayout` already gives a positioned element.
    expect(CARD_VARIANTS.exit('forward').zIndex).toBe(0);
  });

  it('should bring a card back from off-screen only when the deck stepped back', () => {
    // ===================================================================
    //  THE ENTRANCE, AND WHY IT IS A PLAIN PROP (2026-09-21).
    //
    //  `custom` reaches only the child being REMOVED -- motion-dom
    //  resolves it for `type === "exit"` and nothing else, and the
    //  first-paint inline style is built with no custom at all. The
    //  incoming card is mounted by the render that decides the movement,
    //  so a prop is both available and correct for it. Getting this wrong
    //  is not a crash: it is one frame of the card at rest before it jumps
    //  off-screen to fly back in.
    //
    //  jsdom cannot see the animation, so what is pinned is the START
    //  POSITION Motion writes into the element's inline style, and that it
    //  is the same distance the deal throws a card.
    // ===================================================================
    const { container: back } = render(
      <Card
        card={highConfidenceCard}
        isFlipped={false}
        isYearPending={false}
        onFlip={vi.fn()}
        movement="backward"
      />,
    );
    const returning = back.querySelector('[data-testid="card-inner"]')?.parentElement;
    expect(returning?.getAttribute('style')).toContain(
      `translateX(${CARD_VARIANTS.exit('forward').x}px)`,
    );

    cleanup();

    // Forward, and no movement at all, both mount the card where it belongs: a dealt card is
    // already in the slot the outgoing one is vacating, and animating it in would be motion the
    // player never asked for.
    for (const movement of ['forward', undefined] as const) {
      const { container } = render(
        <Card
          card={highConfidenceCard}
          isFlipped={false}
          isYearPending={false}
          onFlip={vi.fn()}
          movement={movement}
        />,
      );
      const dealt = container.querySelector('[data-testid="card-inner"]')?.parentElement;
      expect(dealt?.getAttribute('style') ?? '').not.toContain('translateX');
      cleanup();
    }
  });

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
    // Asserted through the QR IMAGE, and as of 2026-08-11 that is the only way left: this face
    // holds the code and nothing else. It was asserted through the controls until they moved to
    // `CardControls` (a pointer-up on a button inside the card read as a tap and flipped it), then
    // through `textContent !== ''` until the "Scan to play the full song" caption moved out to below
    // the card -- which is what let the QR be enlarged to 3/4 of the card. There is no text on this
    // face to fall back to, so the image's presence INSIDE the hidden face is the assertion.
    renderCard(true);

    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toContain(highConfidenceCard.id);
    expect(screen.getByTestId('card-hidden-face').contains(image)).toBe(true);
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

  it('should render the card at the token-backed size rather than a literal', () => {
    // The regression this guards is a card sized by a hardcoded pair again. `CardStack` holds the
    // OTHER half of what used to be `h-[28rem] w-72` written out twice, and its own test asserts
    // that the two elements carry the same string -- which is only meaningful if this one is a
    // token. A class-name assertion proves the utility is present and nothing about the rendered
    // size; jsdom computes no layout, so that is the whole of what is available here.
    const { container } = render(
      <Card card={highConfidenceCard} isFlipped={false} isYearPending={false} onFlip={vi.fn()} />,
    );

    const outer = container.firstElementChild;
    expect(outer?.className).toContain('h-(--card-height)');
    expect(outer?.className).toContain('w-(--card-width)');
    expect(outer?.className).not.toMatch(/\bh-\[|\bw-\d/);
  });

  it('should apply the ring utility to both faces, beside the positioning it depends on', () => {
    // ===================================================================
    //  THE SILENT-NO-OP GUARD for Phase 8's ring, plus the component end
    //  of a contract whose middle jsdom cannot reach.
    //
    //  TWO separate things are asserted here and they fail for different
    //  reasons:
    //
    //  1. `card-ring` is present. An unknown Tailwind utility emits NO
    //     RULE AT ALL -- silently, with typecheck, lint, test and build all
    //     green. That has shipped once in this repo (`text-text-muted` on
    //     this very card) and the symptom was near-black text on a
    //     near-black face. `CardHiddenSide.test.tsx` has the original.
    //
    //  2. `absolute` is present ON THE SAME ELEMENT. `card-ring` sets no
    //     `position`, deliberately -- putting `position: relative` in the
    //     utility would collide with this `absolute` in the same cascade
    //     layer, and if `relative` won, both faces would leave absolute
    //     positioning and the card would come apart. So the utility's
    //     `::before` depends on the CALLER being positioned, and this is
    //     that half of it. `index.css.test.ts` holds the stylesheet half.
    //
    //  Whether the ring then PAINTS is not reachable: jsdom computes no
    //  layout and evaluates no `mask-composite`. A class-name assertion is
    //  the ceiling, and the visual check is manual.
    // ===================================================================
    renderCard(false);

    for (const testId of ['card-hidden-face', 'card-reveal-face']) {
      const face = screen.getByTestId(testId);
      expect(face.className).toContain('card-ring');
      expect(face.className).toContain('absolute');
      // The radius is a token too, because the ring's `::before` inherits it: a face rounded
      // differently from its ring shows the gradient cutting a corner.
      expect(face.className).toContain('rounded-card');
      expect(face.className).not.toContain('rounded-2xl');
    }
  });

  it('should take the flip duration from the token and expose the reduced-motion hook', () => {
    // Two halves of one contract with `src/index.css`. The duration must come from
    // `--duration-flip`, and `data-motion="flip"` is the selector the
    // `prefers-reduced-motion: reduce` block collapses that duration through. jsdom evaluates no
    // media query, so the CSS half is covered by the canary in `src/index.css.test.ts` -- this is
    // the component half, which is the part a component change can break.
    const { container } = renderCard(false);
    const inner = container.querySelector('[data-testid="card-inner"]');

    expect(inner?.getAttribute('data-motion')).toBe('flip');
    expect(inner?.className).toContain('duration-(--duration-flip)');
  });

  it('should render inside a reducedMotion MotionConfig despite jsdom having no matchMedia', () => {
    // ===================================================================
    //  THE `matchMedia` CANARY, and the only automated evidence for what
    //  was an open question of this plan. The answer had two halves and the
    //  first one contradicted the plan's own assumption.
    //
    //  1. jsdom 30 DOES NOT IMPLEMENT `window.matchMedia`. It is
    //     `undefined`, not a quirky implementation -- measured 2026-08-05.
    //     The plan said "jsdom does implement it; whether Motion's listener
    //     registration is happy with jsdom's implementation is the thing to
    //     check". There is no implementation to be happy with.
    //
    //  2. MOTION TOLERATES ITS ABSENCE ANYWAY, so NO STUB IS NEEDED -- not
    //     here and not in any of the other jsdom files. Motion 12.43 guards
    //     the lookup internally and resolves the preference as "not set".
    //
    //  This test exists because `src/main.tsx` wraps the app in
    //  `<MotionConfig reducedMotion="user">` and NOTHING in this repo renders
    //  `main.tsx` -- `App.test.tsx` renders `<App />` directly. Without this,
    //  a jsdom or Motion upgrade that turned (2) into a throw would be
    //  discovered in a browser rather than in the suite.
    //
    //  If it ever does break, the stub goes in the individual jsdom files --
    //  NOT in a global `setupFiles`, which `toolchain.md` §5 records as
    //  deliberately absent.
    //
    //  THE COST, which is worth being explicit about: because the preference
    //  can never read as "reduce" here, no jsdom test in this repo can
    //  observe reduced-motion BEHAVIOUR. That is the same wall the CSS side
    //  hits, and it is why `src/index.css.test.ts` is a text canary.
    // ===================================================================
    expect(window.matchMedia).toBeUndefined();

    const { container } = render(
      <MotionConfig reducedMotion="user">
        <Card card={highConfidenceCard} isFlipped={false} isYearPending={false} onFlip={vi.fn()} />
      </MotionConfig>,
    );

    expect(container.querySelector('[data-testid="card-inner"]')).not.toBeNull();
  });
});
