/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CardRevealSide } from './CardRevealSide';
import {
  highConfidenceCard,
  lowConfidenceCard,
  noYearCard,
  pendingYearCard,
} from './__fixtures__/cards';

describe('CardRevealSide', () => {
  // See the note in `QrCode.test.tsx`: Testing Library does not auto-clean without Vitest
  // globals, and stale renders otherwise leak into the next test's queries.
  afterEach(cleanup);

  it('should render the year plain for high confidence', () => {
    render(<CardRevealSide card={highConfidenceCard} isYearPending={false} />);

    expect(screen.queryByText('1975')).not.toBeNull();
    // No marker: this year is trusted, and hedging every year would make the marker
    // meaningless on the ones that need it.
    expect(screen.queryByText(/unconfirmed/i)).toBeNull();
    expect(screen.queryByText(/check this one/i)).toBeNull();
  });

  it('should render the year with an unconfirmed marker for low confidence', () => {
    // Showing a possibly-wrong year beats showing none -- but only while it is always
    // marked. The marker is the entire condition on which that decision was made.
    render(<CardRevealSide card={lowConfidenceCard} isYearPending={false} />);

    expect(screen.queryByText('1979')).not.toBeNull();
    expect(screen.queryByText(/unconfirmed/i)).not.toBeNull();
  });

  it('should prompt the player to check the year for none confidence', () => {
    // State 3, the one most likely to be collapsed into state 2. There is no year to mark
    // as unconfirmed -- there is no year at all.
    render(<CardRevealSide card={noYearCard} isYearPending={false} />);

    expect(screen.queryByText(/year unknown/i)).not.toBeNull();
    expect(screen.queryByText(/check this one yourself/i)).not.toBeNull();
    expect(screen.queryByText(/unconfirmed/i)).toBeNull();
  });

  it('should render a pending indicator when the year is undefined', () => {
    render(<CardRevealSide card={pendingYearCard} isYearPending={true} />);

    expect(screen.queryByText(/still looking up the year/i)).not.toBeNull();
    // And crucially NOT the `none` wording: this year is coming, so telling the player to go
    // and check it themselves would be wrong.
    expect(screen.queryByText(/check this one yourself/i)).toBeNull();
    expect(screen.queryByText(/year unknown/i)).toBeNull();
  });

  it('should not treat a null year as pending', () => {
    // `null` and `undefined` are different states, and `isYearPending` is false for `null`.
    // A component that tested `!card.year` would collapse them and show a spinner forever.
    render(<CardRevealSide card={noYearCard} isYearPending={false} />);

    expect(screen.queryByText(/still looking up the year/i)).toBeNull();
    expect(screen.queryByText(/year unknown/i)).not.toBeNull();
  });

  it('should render the artist string verbatim without splitting it', () => {
    // "Earth, Wind & Fire" is ONE artist containing both separators Spotify joins with.
    // Splitting it renders three artists and corrupts the reveal -- the exact bug
    // `shared/artists.ts` exists to prevent.
    render(<CardRevealSide card={lowConfidenceCard} isYearPending={false} />);

    expect(screen.queryByText('Earth, Wind & Fire')).not.toBeNull();
    expect(screen.queryByText('Earth')).toBeNull();
    expect(screen.queryByText('Wind')).toBeNull();
    expect(screen.queryByText('Fire')).toBeNull();
  });

  it('should render the title', () => {
    render(<CardRevealSide card={highConfidenceCard} isYearPending={false} />);

    expect(screen.queryByText('Bohemian Rhapsody')).not.toBeNull();
  });

  it('should announce the reveal politely when the card is flipped', () => {
    // ===================================================================
    //  THE ONE PLACE IN THE APP WHERE ANNOUNCING TRACK DATA IS CORRECT.
    //
    //  Before Phase 7 the flip was SILENT to assistive technology: a player
    //  pressed Space, this component mounted, and nothing was announced --
    //  so the payoff of the entire game was available to an eye and to
    //  nothing else.
    //
    //  It is safe here and nowhere else because this component is mounted
    //  ONLY while the card is flipped (`Card.tsx`). There is no unflipped
    //  card on which this region exists. `CardHiddenSide.test.tsx` asserts
    //  the negative half.
    //
    //  POLITE, not assertive: the reveal was asked for, so interrupting the
    //  screen reader mid-sentence to deliver it would be rude about news the
    //  player requested. `role="status"` carries `aria-live="polite"`
    //  implicitly, which is why there is no explicit `aria-live` to assert.
    // ===================================================================
    render(<CardRevealSide card={highConfidenceCard} isYearPending={false} />);

    const live = screen.getByRole('status');
    // One region carrying the WHOLE reveal, so it is announced as one thing rather than three.
    expect(live.textContent).toContain(highConfidenceCard.title);
    expect(live.textContent).toContain(highConfidenceCard.artist);
    expect(live.textContent).toContain(String(highConfidenceCard.year));
    // Not assertive. An `aria-live="assertive"` here would interrupt mid-card.
    expect(live.getAttribute('aria-live')).not.toBe('assertive');
  });

  it('should announce the year-unknown and pending states too', () => {
    // The live region wraps the year SLOT, not just a resolved year, so the two states that show
    // no number are announced as well. A region that only existed on a resolved year would leave a
    // screen-reader player with silence on a third of an ordinary deck.
    render(<CardRevealSide card={noYearCard} isYearPending={false} />);
    expect(screen.getByRole('status').textContent).toMatch(/year unknown/i);

    cleanup();

    render(<CardRevealSide card={pendingYearCard} isYearPending={true} />);
    expect(screen.getByRole('status').textContent).toMatch(/still looking up the year/i);
  });
});
