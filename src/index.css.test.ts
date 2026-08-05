/**
 * ===========================================================================
 *  THIS IS A CANARY, NOT A BEHAVIOUR TEST. Phase 7 plan 1, decision 6.
 *
 *  It reads `src/index.css` as TEXT and asserts that the reduced-motion block
 *  exists and names all three surfaces it is supposed to cover. It proves
 *  nothing whatsoever about whether those rules apply, or look right, or fire at
 *  all.
 *
 *  It cannot. jsdom does not evaluate media queries, so there is no environment
 *  in this repo in which `prefers-reduced-motion: reduce` can be made true and
 *  observed. The genuine choice here was between a text-level canary and NO
 *  COVERAGE AT ALL for the reduced-motion work -- four animation surfaces,
 *  landed and then guarded by nothing.
 *
 *  What it therefore catches is exactly one class of regression, and it is the
 *  likely one: somebody edits a component, renames or drops a `data-motion`
 *  hook, and the stylesheet quietly selects nothing. The matching component-side
 *  assertions live in `Card.test.tsx`, `PreparingScreen.test.tsx` and
 *  `QrCode.test.tsx`; between them and this file, both ends of each contract are
 *  pinned even though the middle is untestable.
 *
 *  The real check is manual, with the OS preference actually set as well as via
 *  devtools emulation: `docs/development.md` §5.
 * ===========================================================================
 *
 * A `node` test, with no `@vitest-environment jsdom` docblock. It inspects a string and needs no
 * DOM, and `node` is this repo's default environment (`toolchain.md` §5).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
  ===========================================================================
   TWO OBVIOUS WAYS TO GET THIS TEXT BOTH FAIL, AND ONE OF THEM FAILS SILENTLY.

   `import stylesheet from './index.css?raw'` returns an EMPTY STRING. Vitest's
   `test.css` option defaults to false, so every CSS module -- `?raw` included --
   is replaced with an empty stub. Most of the assertions below would then pass
   vacuously against `''`; only the `not.toBeNull()` pair failed, which is the
   sole reason it was caught rather than shipped as a green test checking
   nothing.

   `readFileSync(new URL('./index.css', import.meta.url))` throws
   `TypeError: The URL must be of scheme file`. Vite has a dedicated transform
   for the `new URL(<string literal>, import.meta.url)` pattern: it treats it as
   an ASSET REFERENCE and rewrites it to the asset's served URL, which is not a
   `file:` one. The pattern is the standard ESM way to find a sibling file and it
   is the one thing that cannot be used inside a Vite project.

   A bare `import.meta.url` is untouched, so taking it apart with `node:path`
   works. Verbose, and the verbosity is the point -- shortening it back to either
   form above reintroduces one of the two failures.
  ===========================================================================

  Reading the SOURCE rather than the bundle is deliberate too: the built
  stylesheet has been through Tailwind and Lightning CSS, which rewrites
  `[data-motion='flip']` to `[data-motion=flip]` and strips every comment, so
  assertions over `dist/` would pin the compiler's formatting instead of the
  author's intent.
*/
const stylesheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

/**
 * The reduced-motion block's body.
 *
 * Matched by brace counting rather than by a regex over the whole block: the block contains nested
 * rules, so a lazy `\{([^}]*)\}` would stop at the first inner closing brace and the assertions
 * would pass on a fragment.
 */
function reducedMotionBlock(css: string): string | null {
  const start = css.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/);
  if (start === -1) return null;

  const open = css.indexOf('{', start);
  let depth = 0;

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }

  return null;
}

describe('src/index.css', () => {
  it('should declare a prefers-reduced-motion block covering the flip, the spinner and the placeholder', () => {
    const block = reducedMotionBlock(stylesheet);
    expect(block).not.toBeNull();

    const body = block ?? '';

    // The FLIP: collapsed, not removed. It is a state toggle rather than decoration, so the face
    // still has to change -- it just must not travel.
    expect(body).toContain("[data-motion='flip']");
    expect(body).toMatch(/transition-duration:\s*var\(--duration-flip-reduced\)/);

    // The SPINNER: hidden rather than stopped (decision 7). A stationary spinner reads as a hung
    // app, and it is `aria-hidden` beside a status line that carries all of its information.
    expect(body).toContain("[data-motion='spinner']");
    expect(body).toMatch(/display:\s*none/);

    // The QR PLACEHOLDER: the pulse goes, the box stays. Its job is holding the card's layout while
    // `toDataURL` resolves, and it does that just as well while still.
    expect(body).toContain("[data-motion='qr-placeholder']");
    expect(body).toMatch(/animation:\s*none/);
  });

  it('should not disable transitions indiscriminately', () => {
    // A blanket `* { transition: none }` was the alternative and is the thing to guard against: it
    // is indiscriminate, and it would also kill transitions that carry meaning -- the flip above is
    // exactly one of those. Scoped selectors are the decision (plan 1, step 4).
    const body = reducedMotionBlock(stylesheet) ?? '';

    expect(body).not.toMatch(/^\s*\*\s*[,{]/m);
    expect(body).not.toMatch(/\*\s*\{[^}]*transition/);
  });

  it('should define the card geometry as one derived pair rather than two independent clamps', () => {
    // The duplication this plan removed was `h-[28rem] w-72` written out in both `Card.tsx` and
    // `CardStack.tsx`. The token version must not reintroduce the same hazard in a new place: if
    // width and height were each clamped independently, the 9:14 ratio would hold at the two ends
    // and drift everywhere between them. Deriving the width from the height is what makes the ratio
    // exact at every viewport, and it is the one property of the pair a future edit could silently
    // lose.
    expect(stylesheet).toMatch(/--card-height:\s*clamp\(/);
    expect(stylesheet).toMatch(/--card-width:\s*calc\(\s*var\(--card-height\)/);
    // A viewport-height term, which open question 4 resolved as necessary: without one, a phone in
    // landscape gets a 448px card in a 375px viewport.
    expect(stylesheet).toMatch(/--card-height:[^;]*dvh/);
  });
});
