/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'motion/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Card } from './Card';
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
