/**
 * @vitest-environment jsdom
 *
 * One thing matters on this screen: nothing about the deck appears on it. It is the surface
 * findings #6 names explicitly as the one people forget.
 *
 * The count assertions that used to lead this file are gone with the "N of M years found" line
 * itself -- it read as a progress bar that had to fill, when the wait is a single lookup. What
 * replaces them is the negative: no count, and no number at all.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { COPYRIGHT_NOTICE } from './Footer';
import { PreparingScreen } from './PreparingScreen';
import { COPY } from '../game/copy';
import { fixtureDeck } from './__fixtures__/cards';

describe('PreparingScreen', () => {
  afterEach(cleanup);

  it('should render no progress count', () => {
    // The removed line, asserted as absent rather than merely deleted: a resolved/total readout is
    // the obvious thing to add back to a loading screen, and the reason it went is not visible from
    // the component -- "0 of 42" reads as a bar that has to fill, while the gate is ONE lookup.
    render(<PreparingScreen />);

    // No count in any phrasing, asserted as the absence of a DIGIT rather than of a wording:
    // "N of M years found" is the line that went, and every rewrite of it has a number in it.
    expect(screen.getByRole('status').textContent ?? '').not.toMatch(/\d/);
  });

  it('should say the game starts before the deck is fully resolved', () => {
    // The card-1 gate waits for ONE lookup, not the whole deck -- and with the count gone this is
    // the only line that says so, which makes it the whole of the screen's honesty about the wait.
    render(<PreparingScreen />);

    expect(screen.getByRole('status').textContent).toContain(COPY.preparing.detail);
  });

  it('should host the footer: positioned, with the bottom band reserved', () => {
    // The screen's half of `Footer`'s contract -- the footer is `absolute bottom-8`, so this `<main>`
    // must be `relative` and must reserve `pb-20`. This is also the screen that made the textbook
    // `mt-auto` sticky footer unusable: its content is a spinner and two lines, so an auto margin
    // eating the free space would leave them clinging to the top of an otherwise empty viewport.
    const { container } = render(<PreparingScreen />);
    const main = container.querySelector('main');

    expect(main?.className).toContain('relative');
    expect(main?.className).toContain('pb-20');
    // And the column still centres its content, which is what the positioning bought.
    expect(main?.className).toContain('justify-center');
  });

  it('should render the notice it is given', () => {
    // Notices appear HERE as well as on the game screen: `preparing` can be shorter than the time
    // it takes to read a sentence, and the container owns the dismissal so it survives the
    // transition (decision 9).
    render(<PreparingScreen notice={<p data-testid="test-notice">a notice</p>} />);

    expect(screen.queryByTestId('test-notice')).not.toBeNull();
  });

  it('should hide the spinner rather than freeze it under reduced motion', () => {
    // ===================================================================
    //  ONLY HALF OF THIS IS TESTABLE HERE, AND THIS IS THE HALF.
    //
    //  The mechanism is pure CSS -- a `display: none` in the
    //  `prefers-reduced-motion: reduce` block of `src/index.css`, keyed on
    //  `data-motion="spinner"`. jsdom evaluates no media query, so nothing
    //  in this repo can assert the rule APPLIES; that is what the canary in
    //  `src/index.css.test.ts` exists for.
    //
    //  What this asserts is the component's side of the contract: the hook
    //  attribute the stylesheet selects on is actually rendered, and it is
    //  on the spinner rather than on the status region around it. Rename the
    //  attribute in one file and not the other and reduced motion silently
    //  stops working -- that is the regression, and it is this test's.
    //
    //  HIDDEN and not merely stopped, per decision 7: a stationary spinner
    //  is a dead grey circle that reads as a hung app.
    // ===================================================================
    const { container } = render(<PreparingScreen />);

    const spinner = container.querySelector('[data-motion="spinner"]');
    expect(spinner).not.toBeNull();
    // Already `aria-hidden`, which is what makes hiding it lossless for a screen-reader player.
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    // And it is a decoration, not a container: hiding it can take nothing else with it.
    expect(spinner?.textContent).toBe('');
    expect(spinner?.className).toContain('animate-spin');
  });

  it('should still render both status lines under reduced motion', () => {
    // The information-preservation claim behind decision 7, tested by doing to the DOM what
    // `display: none` does to the picture: remove the spinner, then assert the screen still says
    // everything it said before. If either line ever moved inside the spinner -- or the spinner
    // became the wrapper -- hiding it would take the whole progress report with it and the screen
    // would go blank on exactly the players who asked for less motion.
    //
    // Decision 7 originally rested partly on the resolved/total count carrying the spinner's
    // meaning. With the count gone the claim rests on "Dealing your deck…", which is the sentence
    // that says work is in progress -- so the surviving two lines are what this now pins.
    const { container } = render(<PreparingScreen />);

    container.querySelector('[data-motion="spinner"]')?.remove();

    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toContain(COPY.preparing.heading);
    expect(status).toContain(COPY.preparing.detail);
  });

  it('should not render any track title, artist, or year', () => {
    // ===================================================================
    //  THE PREPARING SCREEN'S LEAK ASSERTION.
    //
    //  A loading screen is a leak surface exactly as a card face is, and it
    //  is the one most likely to be forgotten -- "Looking up Bohemian
    //  Rhapsody…" is the natural, helpful thing to write, and it spoils the
    //  first card before the game starts. findings #6 names loading screens
    //  and progress text explicitly for this reason.
    //
    //  Note this component takes no `Card` at all, which is what makes the
    //  rule cheap to keep. The assertion exists so that adding one to be
    //  helpful fails a test.
    // ===================================================================
    const { container } = render(<PreparingScreen />);

    /*
      ===================================================================
       THE COPYRIGHT LINE IS SUBTRACTED, NOT TOLERATED, AND THAT MATTERS.

       The footer added on 2026-08-11 contains "2026-present", so the
       year-shaped-number proxy below started failing on it -- correctly: a
       four-digit year appeared on a pre-reveal surface. It is not a leak
       (nothing about it derives from a card; it is a module constant), but
       the right response is to remove the one string that is KNOWN not to
       be a year and keep the proxy absolute for everything else, rather
       than to loosen the pattern so that any 20xx passes.

       Removing it by exact-string match is what keeps that narrow: if the
       footer ever renders something other than this constant, the
       subtraction stops matching and the assertion goes back to seeing
       every digit on the screen.
      ===================================================================
    */
    const text = (container.textContent ?? '').replace(COPYRIGHT_NOTICE, '');

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
      if (typeof card.year === 'number') expect(text).not.toContain(String(card.year));
    }

    // No year-shaped number anywhere -- and since the count went there is no number on this screen
    // at all, so any digits appearing here would be new and would have come from a card.
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
