/**
 * @vitest-environment jsdom
 *
 * The front door's job is to explain the game, hand the player to the picker on one press, offer the
 * printable year cards -- and say nothing about any deck. All four are asserted below; none of them
 * knows what the screen SAYS, because every sentence comes from `COPY.welcome`.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COPYRIGHT_NOTICE } from './Footer';
import { WelcomeScreen, YEAR_CARDS_PDF_PATH } from './WelcomeScreen';
import { COPY } from '../game/copy';
import { auditableText } from './__fixtures__/auditable-text';
import { fixtureDeck } from './__fixtures__/cards';

function renderWelcome() {
  const onStart = vi.fn();
  const rendered = render(<WelcomeScreen onStart={onStart} />);

  return { ...rendered, onStart };
}

describe('WelcomeScreen', () => {
  afterEach(cleanup);

  it('should hand the player to the picker on one press', () => {
    // The screen's one job. The button's name is `COPY.welcome.enter`, which is deliberately NOT
    // `COPY.landing.start`: the two must stay distinct so no test -- and no player -- ever meets two
    // buttons called "Start" in one session.
    const { onStart } = renderWelcome();

    fireEvent.click(screen.getByRole('button', { name: COPY.welcome.enter }));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(COPY.welcome.enter).not.toBe(COPY.landing.start);
  });

  it('should name the app in its heading', () => {
    // The `<h1>` is the logo, so its accessible name is the `alt` -- and that has to be the app's
    // name, or the document's one top-level heading is nameless (see `LandingScreen`).
    renderWelcome();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('');
    expect(screen.getByRole('img', { name: COPY.welcome.logoAlt })).not.toBeNull();
  });

  it('should explain the game in three ordered steps', () => {
    // An `<ol>` because the order is the game's order. Asserted against the copy constants so the
    // steps can be reworded freely; what is pinned is that all three are on screen, in this order.
    renderWelcome();

    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    const steps = [
      COPY.welcome.steps.pick.title,
      COPY.welcome.steps.play.title,
      COPY.welcome.steps.guess.title,
    ];

    expect(items).toHaveLength(3);
    steps.forEach((title, index) => {
      expect(items[index]).toContain(title);
    });
  });

  it('should offer the printable year cards as a download of the static PDF', () => {
    // ===================================================================
    //  A LINK, NOT A BUTTON, AND BOTH ATTRIBUTES ARE LOAD-BEARING.
    //
    //  `href` is the asset under `public/`; `download` is what asks the browser
    //  to save the file rather than navigate to it, and its value is the name
    //  the player sees in their downloads list -- so it is copy. No
    //  `target="_blank"`: a same-origin download opens nothing.
    // ===================================================================
    renderWelcome();

    const link = screen.getByRole('link', { name: COPY.welcome.printCards });

    expect(link.getAttribute('href')).toBe(YEAR_CARDS_PDF_PATH);
    expect(link.getAttribute('download')).toBe(COPY.welcome.yearCardsFileName);
    expect(link.getAttribute('target')).toBeNull();
    // Both ends agree it is a PDF: the served path and the saved name.
    expect(YEAR_CARDS_PDF_PATH).toMatch(/\.pdf$/);
    expect(COPY.welcome.yearCardsFileName).toMatch(/\.pdf$/);
  });

  it('should give every interactive element a focus-visible style and a touch target', () => {
    // Class-name level, which is the ceiling here (jsdom paints nothing) and which catches the
    // regression that actually happens: a control added without a ring. The download link is the
    // app's second `<a>`, so the rule the footer applied by hand has to be applied here too.
    const { container } = renderWelcome();

    // The footer's author link is excluded: it has its own tests and deliberately no touch target.
    const interactive = [...container.querySelectorAll('button, main > section a')];
    expect(interactive).toHaveLength(2);

    for (const element of interactive) {
      expect(element.className).toContain('focus-visible:focus-ring');
      expect(element.className).toContain('touch-target');
    }
  });

  it('should host the footer: positioned, with the bottom band reserved', () => {
    // The screen's half of `Footer`'s contract -- the footer is `absolute bottom-8`, so this `<main>`
    // must be `relative` and must reserve `pb-20`. Same contract as the other four hosts.
    const { container } = renderWelcome();
    const main = container.querySelector('main');

    expect(main?.className).toContain('relative');
    expect(main?.className).toContain('pb-20');
    expect(container.querySelector('footer')?.textContent).toBe(COPYRIGHT_NOTICE);
  });

  it('should position the decorative card itself, because the ring utility does not', () => {
    // `card-ring` paints an `absolute` pseudo-element and deliberately declares no `position`
    // (`src/index.css` has the cascade reasoning). Every other call site is `absolute inset-0`; this
    // is the first that is not, so the contract has to be met with `relative` -- and the band
    // inherits the radius, so `rounded-card` goes with it. Both ends pinned, as for `Card`.
    const { container } = renderWelcome();
    const decoration = container.querySelector('.card-ring');

    expect(decoration).not.toBeNull();
    expect(decoration?.className).toContain('relative');
    expect(decoration?.className).toContain('rounded-card');
    expect(decoration?.getAttribute('aria-hidden')).toBe('true');
    // It draws a `?`, never a number: a year on a pre-start surface is a leak whatever its source.
    expect(decoration?.textContent ?? '').not.toMatch(/\d/);
  });

  it('should not render any track title, artist, or year', () => {
    // ===================================================================
    //  THE FRONT DOOR'S LEAK ASSERTION. The screen takes no `Card`, so this
    //  exists to make adding one -- "here is what a card looks like", with a
    //  real card -- fail a test.
    //
    //  FIVE STRINGS ARE SUBTRACTED, NOT TOLERATED, each by EXACT string, so
    //  the proxy stays absolute for everything else: reword any of them and
    //  it still matches; add a year anywhere else and it fails.
    //
    //  - `COPYRIGHT_NOTICE` ("2026-present") and `COPY.footer.authorUrl`, as
    //    on every screen that hosts the footer. The URL carries no year today;
    //    it is subtracted so the audit describes every string on the screen
    //    rather than tolerating the ones that happen to pass.
    //  - `COPY.welcome.printDetail`, which names the first printed year.
    //  - `COPY.welcome.yearCardsFileName` and `YEAR_CARDS_PDF_PATH`, which is
    //    WHERE THE PRINTED RANGE "1970-2033" ACTUALLY IS: the link's
    //    `download` attribute and its `href`. Until 2026-09-19 neither
    //    attribute was audited, so this test passed by OMISSION -- the range
    //    was believed subtracted and was in fact never read. The audit now
    //    reads both (see `__fixtures__/auditable-text.ts`), so the range has
    //    to be removed here, by name, from both of the strings it lives in.
    //
    //  `String.replace` with a string removes the FIRST occurrence, and each
    //  of the five appears once. Neither range string contains the other (one
    //  starts with `/`, the other with `jitster-`), so the order is free.
    // ===================================================================
    const { container } = renderWelcome();
    const audited = auditableText(container);

    // The subtraction is load-bearing only if the audit READS the two attributes: this is what
    // fails if `download` or `href` ever drops out of the shared list and the proxy goes back to
    // passing by omission.
    expect(audited).toContain(COPY.welcome.yearCardsFileName);
    expect(audited).toContain(YEAR_CARDS_PDF_PATH);

    const text = audited
      .replace(COPYRIGHT_NOTICE, '')
      .replace(COPY.footer.authorUrl, '')
      .replace(COPY.welcome.printDetail, '')
      .replace(COPY.welcome.yearCardsFileName, '')
      .replace(YEAR_CARDS_PDF_PATH, '');

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
      if (typeof card.year === 'number') expect(text).not.toContain(String(card.year));
    }
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
