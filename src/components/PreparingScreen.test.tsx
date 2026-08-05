/**
 * @vitest-environment jsdom
 *
 * Two things matter on this screen: the count is a count, and nothing else about the deck appears.
 * The second is the one findings #6 names explicitly as a surface people forget.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PreparingScreen } from './PreparingScreen';
import { fixtureDeck } from './__fixtures__/cards';

describe('PreparingScreen', () => {
  afterEach(cleanup);

  it('should render a count-only progress line', () => {
    render(<PreparingScreen resolvedCount={3} totalCount={42} />);

    expect(screen.getByRole('status').textContent).toContain('3 of 42');
  });

  it('should render the count at zero rather than omitting the line', () => {
    // Rendered even at 0, so the line does not appear a moment later and shift the layout under a
    // player who is already looking at it.
    render(<PreparingScreen resolvedCount={0} totalCount={42} />);

    expect(screen.getByRole('status').textContent).toContain('0 of 42');
  });

  it('should say the game starts before the deck is fully resolved', () => {
    // The card-1 gate waits for ONE lookup, not the whole deck. Without this line the count reads
    // as a progress bar that has to reach the total, which makes a one-second wait feel stalled at
    // step 3 of 42.
    render(<PreparingScreen resolvedCount={3} totalCount={42} />);

    expect(screen.getByRole('status').textContent).toMatch(/first card/i);
  });

  it('should render the notice it is given', () => {
    // Notices appear HERE as well as on the game screen: `preparing` can be shorter than the time
    // it takes to read a sentence, and the container owns the dismissal so it survives the
    // transition (decision 9).
    render(
      <PreparingScreen
        resolvedCount={0}
        totalCount={42}
        notice={<p data-testid="test-notice">a notice</p>}
      />,
    );

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
    const { container } = render(<PreparingScreen resolvedCount={3} totalCount={42} />);

    const spinner = container.querySelector('[data-motion="spinner"]');
    expect(spinner).not.toBeNull();
    // Already `aria-hidden`, which is what makes hiding it lossless for a screen-reader player.
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    // And it is a decoration, not a container: hiding it can take nothing else with it.
    expect(spinner?.textContent).toBe('');
    expect(spinner?.className).toContain('animate-spin');
  });

  it('should still render the count and the status line under reduced motion', () => {
    // The information-preservation claim behind decision 7, tested by doing to the DOM what
    // `display: none` does to the picture: remove the spinner, then assert the screen still says
    // everything it said before. If the count or the status line ever moved inside the spinner --
    // or the spinner became the wrapper -- hiding it would take the progress report with it and
    // the screen would go blank on exactly the players who asked for less motion.
    const { container } = render(<PreparingScreen resolvedCount={3} totalCount={42} />);

    container.querySelector('[data-motion="spinner"]')?.remove();

    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toContain('3 of 42');
    expect(status).toMatch(/dealing your deck/i);
    expect(status).toMatch(/first card/i);
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
    const { container } = render(<PreparingScreen resolvedCount={7} totalCount={42} />);
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
      if (typeof card.year === 'number') expect(text).not.toContain(String(card.year));
    }

    // No year-shaped number anywhere. The counts are small integers, so a four-digit number here
    // could only be a year.
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
