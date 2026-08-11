/**
 * @vitest-environment jsdom
 *
 * The copyright line's own tests. Three of them, and each one guards a different way this
 * two-line component could go quietly wrong.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Footer, COPYRIGHT_NOTICE } from './Footer';

describe('Footer', () => {
  // Not automatic in this repo: Testing Library only registers its own `afterEach(cleanup)` when
  // Vitest globals are on, and this project imports `describe`/`it`/`expect` explicitly.
  afterEach(cleanup);

  it('should render the copyright notice exactly as specified', () => {
    // ===================================================================
    //  ASSERTED CHARACTER FOR CHARACTER, INCLUDING THE `©` AND THE
    //  "2026-present".
    //
    //  A copyright line is the one string in the app where a well-meaning
    //  edit is a legal change rather than a copy change -- "(c)" for "©",
    //  a hardcoded single year, or a rephrased "All rights reserved" all
    //  look like tidying. The literal `©` is also the only non-ASCII
    //  character on these screens, so this doubles as the canary for an
    //  encoding regression in the build.
    // ===================================================================
    render(<Footer />);

    expect(
      screen.getByText('Copyright © 2026-present Aleix Rabassa. All rights reserved.'),
    ).not.toBeNull();
    // The constant and the rendered text cannot drift, which is the point of exporting it.
    expect(COPYRIGHT_NOTICE).toBe('Copyright © 2026-present Aleix Rabassa. All rights reserved.');
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
