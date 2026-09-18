/**
 * @vitest-environment jsdom
 *
 * The copyright line's own tests. Each one guards a different way this small component could go
 * quietly wrong -- and none of them knows what the line SAYS: the wording comes from
 * `COPY.footer`, so it is the developer's to reword without touching this file.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Footer } from './Footer';
import { COPY } from '../game/copy';

describe('Footer', () => {
  // Not automatic in this repo: Testing Library only registers its own `afterEach(cleanup)` when
  // Vitest globals are on, and this project imports `describe`/`it`/`expect` explicitly.
  afterEach(cleanup);

  it('should render the whole copyright notice as one uninterrupted string', () => {
    // ===================================================================
    //  ASSERTED AGAINST `COPY.footer.notice`, NEVER AGAINST A LITERAL. The
    //  wording, the year range and the author are the developer's to change
    //  in `src/game/copy.ts` without a test standing in the way.
    //
    //  WHAT THIS STILL PINS IS THE THING THE 2026-08-12 SPLIT COULD BREAK.
    //  The line is no longer one text node: the author's name was pulled into
    //  its own `<span>` to carry the accent colour, so the element now has
    //  three children. The property that must survive that is that they
    //  CONCATENATE with no separator -- `textContent` is still exactly the
    //  notice, character for character, including the `©` and the spaces
    //  either side of the name.
    //
    //  It is not a cosmetic concern. Three leak proofs (`PreparingScreen`,
    //  `EndScreen`, `LandingScreen`) subtract this exact string from a
    //  screen's `textContent` before asserting no year-shaped number is left,
    //  and "2026-present" is year-shaped. A stray space between the parts
    //  makes that subtraction miss and the proofs fail somewhere else
    //  entirely, reading as a leak in a screen that has none.
    //
    //  `getByText` CANNOT CHECK THIS and was the assertion here until the
    //  split: its default matcher reads only an element's DIRECT text-node
    //  children, so it saw "Copyright © 2026-present . All rights reserved."
    //  with the name missing. Measured -- it is why this reads `textContent`.
    // ===================================================================
    const { container } = render(<Footer />);

    expect(container.querySelector('footer')?.textContent).toBe(COPY.footer.notice);
  });

  it('should render the author bold, in the accent colour, inside the same line', () => {
    // ===================================================================
    //  THE ONE PLACE `--color-accent` IS USED AS TEXT RATHER THAN AS A FILLED
    //  BACKGROUND, asked for on 2026-08-12 ("the standard green of the app").
    //
    //  `text-accent` is asserted for the reason every colour class in this
    //  repo is: an unknown Tailwind colour utility emits NO rule at all and
    //  fails silently -- `text-accent-green` or `text-emerald` would leave the
    //  name rendering in the inherited `text-fg-muted` with all four checks
    //  green. That shipped once already, on the card's hidden face.
    //
    //  The measurement that made this safe is in `Footer.tsx`: 5.13:1 on
    //  `--color-page`, which clears the 4.5:1 floor for 12px text. jsdom
    //  computes no colour, so the class name is the whole of the grip.
    //
    //  `font-bold` is the other half of the same 2026-08-12 request, and it
    //  is not merely cosmetic: colour alone is not an affordance, so the
    //  weight is what marks the name as a link for anyone who cannot tell
    //  the green from the grey around it.
    // ===================================================================
    const { container } = render(<Footer />);

    const author = container.querySelector('footer a');
    expect(author?.textContent).toBe(COPY.footer.author);
    expect(author?.className).toContain('text-accent');
    expect(author?.className).toContain('font-bold');
  });

  it("should link the author's name to their site, safely and focusably", () => {
    // ===================================================================
    //  THE APP'S FIRST ANCHOR, added 2026-08-12 (the welcome screen's PDF download
    //  is the second, since 2026-09-18) -- so none of the habits the
    //  rest of the app has for interactive elements were already in place
    //  here, and each one is asserted rather than assumed.
    //
    //  `focus-visible:focus-ring` is the repo-wide rule for anything
    //  focusable, and this element is now in the tab order of all five
    //  screens. `rel` must carry `noopener`: without it the opened page can
    //  reach back through `window.opener` into a tab that is holding a game.
    //
    //  The URL is read from `COPY.footer.authorUrl`, never written here --
    //  same rule as the wording, so the developer can repoint it in one file.
    // ===================================================================
    const { container } = render(<Footer />);

    const author = container.querySelector('footer a');
    expect(author?.getAttribute('href')).toBe(COPY.footer.authorUrl);
    expect(author?.getAttribute('target')).toBe('_blank');
    expect(author?.getAttribute('rel')).toContain('noopener');
    expect(author?.className).toContain('focus-visible:focus-ring');
  });

  it('should render as a footer element with a colour that exists', () => {
    // `text-fg-muted` and not a literal grey or an `opacity-*`: an unknown Tailwind colour utility
    // in this app emits NO rule at all and fails silently -- it shipped once, and the only text on
    // the card's hidden face rendered near-black on a near-black card while all four checks passed.
    // `--color-fg-muted` is also the audited dimmest text at 6.12:1 on `--color-page`, which a
    // token plus an opacity modifier would drop under the 4.5:1 floor with no number recorded.
    const { container } = render(<Footer />);

    const footer = container.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer?.className).toContain('text-fg-muted');
    expect(footer?.className).toMatch(/(?:^|\s)text-fg(?:-|\s|$)/);
  });

  it('should pin itself to the bottom of its host rather than sitting in the flow', () => {
    // ===================================================================
    //  THE FOOTER'S HALF OF A TWO-ENDED CONTRACT: this element positions
    //  itself, and its host supplies `relative pb-20`. Each screen's own test
    //  holds the other end -- all five of them (four since 2026-08-12, the welcome screen since
    //  2026-09-18).
    //
    //  `bottom-8` AND `pb-20` ARE ONE NUMBER SPLIT IN TWO: 80px of band, a 32px
    //  offset and a ~16px line put exactly 32px above the copyright and 32px
    //  below it, which is the symmetry the developer asked for. Asserting the
    //  class here is the only grip the suite has on it, because jsdom computes
    //  no layout -- a `bottom-4` sneaking back would leave the line 16px off the
    //  edge under 48px of air with every test still green.
    //
    //  Out of flow rather than the textbook `mt-auto` sticky footer, and
    //  the reason is specific to this app: every screen is a `min-h-dvh
    //  flex flex-col justify-center` column, and an auto margin BEATS
    //  `justify-content` -- the first `mt-auto` swallows the free space and
    //  the screen's content stops being centred. `Footer.tsx` has the full
    //  account.
    //
    //  jsdom computes no layout, so this cannot see where the line lands;
    //  what it catches is somebody "simplifying" the positioning away,
    //  which puts the footer back under the content in the middle of the
    //  screen -- exactly the state the developer asked to change.
    // ===================================================================
    const { container } = render(<Footer />);

    const footer = container.querySelector('footer');
    expect(footer?.className).toContain('absolute');
    expect(footer?.className).toContain('bottom-8');
    // Full width, so `text-center` centres against the screen rather than against the text's own box.
    expect(footer?.className).toContain('inset-x-0');
    expect(footer?.className).toContain('text-center');
  });

  it('should carry no explicit role of its own', () => {
    // ===================================================================
    //  A `<footer>` IS `contentinfo` ONLY WHEN ITS NEAREST SECTIONING
    //  ANCESTOR IS THE BODY -- and this one is always inside a screen's own
    //  `<main>`, so in a real browser it is NOT a landmark. That is the
    //  intended outcome rather than an oversight: a copyright line in the
    //  landmark list a screen-reader user navigates by is noise.
    //
    //  THIS TEST CANNOT ASSERT THAT, AND THE REASON IS WORTH WRITING DOWN
    //  BECAUSE IT LOOKS LIKE A BUG IN THE CODE INSTEAD. Testing Library
    //  resolves `footer` to `contentinfo` regardless of ancestry, so
    //  `queryByRole('contentinfo')` FINDS this element even wrapped in a
    //  `<main>` -- it was written as a `toBeNull()` first and failed
    //  against a component that is correct. Measured 2026-08-11.
    //
    //  So what is asserted is the property the repo can actually keep: no
    //  explicit `role` attribute. That is the edit that would make the
    //  landmark real in a browser, and it must not be added -- three
    //  screens render this component, and `role="contentinfo"` inside a
    //  `<main>` is both invalid and the thing the spec rule above avoids.
    // ===================================================================
    const { container } = render(
      <main>
        <Footer />
      </main>,
    );

    const footer = container.querySelector('footer');
    expect(footer?.hasAttribute('role')).toBe(false);
    expect(footer?.hasAttribute('aria-label')).toBe(false);
  });
});
