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
