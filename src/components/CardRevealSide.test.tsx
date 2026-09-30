/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CardRevealSide } from './CardRevealSide';
import { COPY } from '../game/copy';
import { yearStateOf } from '../game/reducer';
import type { Card } from '../../shared/types';
import {
  highConfidenceCard,
  lowConfidenceCard,
  noYearCard,
  pendingYearCard,
} from './__fixtures__/cards';

/**
 * A `resolve`-stage year the `verify` stage has not confirmed yet. Built here rather than in the
 * shared fixture deck because only this file renders the provisional face.
 */
const provisionalCard: Card = { ...highConfidenceCard, yearProvisional: true };

/** The reserved line under a year: the year's next sibling, present in every year-number state. */
function noticeLine(year: string): HTMLElement | null {
  return screen.getByText(year).nextElementSibling as HTMLElement | null;
}

describe('CardRevealSide', () => {
  // See the note in `QrCode.test.tsx`: Testing Library does not auto-clean without Vitest
  // globals, and stale renders otherwise leak into the next test's queries.
  afterEach(cleanup);

  it('should render the year plain for high confidence', () => {
    render(<CardRevealSide card={highConfidenceCard} />);

    expect(screen.queryByText('1975')).not.toBeNull();
    // No marker: this year is trusted, and hedging every year would make the marker
    // meaningless on the ones that need it.
    expect(screen.queryByText(COPY.card.yearUnconfirmed)).toBeNull();
    expect(screen.queryByText(COPY.card.yearUnknownDetail)).toBeNull();
  });

  it('should render the year with an unconfirmed marker for low confidence', () => {
    // Showing a possibly-wrong year beats showing none -- but only while it is always
    // marked. The marker is the entire condition on which that decision was made.
    render(<CardRevealSide card={lowConfidenceCard} />);

    expect(screen.queryByText('1979')).not.toBeNull();
    expect(screen.queryByText(COPY.card.yearUnconfirmed)).not.toBeNull();
  });

  it('should prompt the player to check the year for none confidence', () => {
    // State 3, the one most likely to be collapsed into state 2. There is no year to mark
    // as unconfirmed -- there is no year at all.
    render(<CardRevealSide card={noYearCard} />);

    expect(screen.queryByText(COPY.card.yearUnknown)).not.toBeNull();
    expect(screen.queryByText(COPY.card.yearUnknownDetail)).not.toBeNull();
    expect(screen.queryByText(COPY.card.yearUnconfirmed)).toBeNull();
  });

  it('should render a pending indicator when the year is undefined', () => {
    render(<CardRevealSide card={pendingYearCard} />);

    expect(screen.queryByText(COPY.card.yearPending)).not.toBeNull();
    // And crucially NOT the `none` wording: this year is coming, so telling the player to go
    // and check it themselves would be wrong.
    expect(screen.queryByText(COPY.card.yearUnknownDetail)).toBeNull();
    expect(screen.queryByText(COPY.card.yearUnknown)).toBeNull();
  });

  it('should draw the pending year as a spinner that survives reduced motion', () => {
    // Replaced the static `····` glyph on 2026-08-11: the one state on this face that is actually
    // in progress was the only one drawn as something inert.
    //
    // Two things are pinned beyond its presence, and both are invisible to jsdom otherwise:
    //
    // 1. NO SECOND LIVE REGION. The whole reveal is already one `role="status"`; a nested one
    //    would announce the card twice. `getAllByRole` is exhaustive on purpose.
    // 2. THE SLOT KEEPS ITS HEIGHT. Reduced motion `display: none`s the spinner, so the sized
    //    wrapper -- not the spinner -- is what stops the card jumping between pending and
    //    resolved. Removing the node is how the other spinner callers test the same rule.
    const { container } = render(<CardRevealSide card={pendingYearCard} />);

    const spinner = container.querySelector('[data-motion="spinner"]');
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');

    expect(screen.getAllByRole('status')).toHaveLength(1);

    const box = spinner?.parentElement;
    spinner?.remove();
    expect(box?.className).toContain('size-(--size-year-spinner)');

    // The announcement is untouched by any of it -- this line is the whole pending announcement.
    expect(screen.getByRole('status').textContent).toContain(COPY.card.yearPending);
  });

  it('should not treat a null year as pending', () => {
    // `null` and `undefined` are different states, and `yearStateOf` reads `null` as final, never pending.
    // A component that tested `!card.year` would collapse them and show a spinner forever.
    render(<CardRevealSide card={noYearCard} />);

    expect(screen.queryByText(COPY.card.yearPending)).toBeNull();
    expect(screen.queryByText(COPY.card.yearUnknown)).not.toBeNull();
  });

  it('should render the artist string verbatim without splitting it', () => {
    // "Earth, Wind & Fire" is ONE artist containing both separators Spotify joins with.
    // Splitting it renders three artists and corrupts the reveal -- the exact bug
    // `shared/artists.ts` exists to prevent.
    render(<CardRevealSide card={lowConfidenceCard} />);

    expect(screen.queryByText('Earth, Wind & Fire')).not.toBeNull();
    expect(screen.queryByText('Earth')).toBeNull();
    expect(screen.queryByText('Wind')).toBeNull();
    expect(screen.queryByText('Fire')).toBeNull();
  });

  it('should render the title', () => {
    render(<CardRevealSide card={highConfidenceCard} />);

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
    render(<CardRevealSide card={highConfidenceCard} />);

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
    render(<CardRevealSide card={noYearCard} />);
    expect(screen.getByRole('status').textContent).toContain(COPY.card.yearUnknown);

    cleanup();

    render(<CardRevealSide card={pendingYearCard} />);
    expect(screen.getByRole('status').textContent).toContain(COPY.card.yearPending);
  });
  describe('the provisional state (plan.year-fetch-rework-ui.md)', () => {
    it('should show the provisional year with COPY.card.yearProvisional', () => {
      expect(yearStateOf(provisionalCard)).toBe('provisional');
      render(<CardRevealSide card={provisionalCard} />);

      // The year exactly as a final year renders -- the same node, the same classes.
      const year = screen.getByText(String(provisionalCard.year));
      expect(year.className).toContain('text-year');
      expect(year.className).toContain('text-fg-year');

      expect(screen.queryByText(COPY.card.yearProvisional)).not.toBeNull();
      expect(screen.queryByText(COPY.card.yearPending)).toBeNull();
      expect(screen.queryByText(COPY.card.yearUnconfirmed)).toBeNull();
      expect(screen.queryByText(COPY.card.yearUnknown)).toBeNull();
    });

    it('should show "confirming", not "unconfirmed", for a provisional low year', () => {
      // One slot, one notice: the confidence is not final until the card is.
      render(<CardRevealSide card={{ ...lowConfidenceCard, yearProvisional: true }} />);

      expect(screen.queryByText(COPY.card.yearProvisional)).not.toBeNull();
      expect(screen.queryByText(COPY.card.yearUnconfirmed)).toBeNull();
    });

    it('should show a final high year with no notice', () => {
      expect(yearStateOf(highConfidenceCard)).toBe('final');
      render(<CardRevealSide card={highConfidenceCard} />);

      expect(screen.queryByText('1975')).not.toBeNull();
      expect(screen.queryByText(COPY.card.yearProvisional)).toBeNull();
      expect(screen.queryByText(COPY.card.yearUnconfirmed)).toBeNull();
    });

    it('should show a final low year with COPY.card.yearUnconfirmed', () => {
      expect(yearStateOf(lowConfidenceCard)).toBe('final');
      render(<CardRevealSide card={lowConfidenceCard} />);

      expect(screen.queryByText('1979')).not.toBeNull();
      expect(screen.queryByText(COPY.card.yearUnconfirmed)).not.toBeNull();
      expect(screen.queryByText(COPY.card.yearProvisional)).toBeNull();
    });

    it('should show COPY.card.yearUnknown for a kept yearless card', () => {
      // A session dealt with `keepYearless` keeps a final null: this branch is live again.
      expect(yearStateOf(noYearCard)).toBe('final');
      render(<CardRevealSide card={noYearCard} />);

      expect(screen.queryByText(COPY.card.yearUnknown)).not.toBeNull();
      expect(screen.queryByText(COPY.card.yearUnknownDetail)).not.toBeNull();
      expect(screen.queryByText(COPY.card.yearProvisional)).toBeNull();
    });

    it("should keep the notice inside the reveal's status region", () => {
      // Inside the ONE polite region, so a provisional-to-final change is announced -- and no
      // second region anywhere, which would announce the card twice.
      render(<CardRevealSide card={provisionalCard} />);

      expect(screen.getAllByRole('status')).toHaveLength(1);
      const live = screen.getByRole('status');
      expect(live.contains(screen.getByText(COPY.card.yearProvisional))).toBe(true);
      expect(live.textContent).toContain(COPY.card.yearProvisional);
      expect(live.textContent).toContain(String(provisionalCard.year));
    });

    it('should render the provisional notice with the fg-secondary token', () => {
      // The silent-colour canary: an unknown colour utility emits no rule and fails nothing else.
      // Progress, not a warning -- and a token, never an opacity modifier.
      render(<CardRevealSide card={provisionalCard} />);

      const notice = screen.getByText(COPY.card.yearProvisional);
      expect(notice.className).toContain('text-fg-secondary');
      expect(notice.className).toContain('text-sm');
      expect(notice.className).not.toContain('text-warning');
      expect(notice.className).not.toMatch(/opacity|\/\d/);
    });

    it("should replace the provisional year when the card's year changes", () => {
      const { rerender } = render(<CardRevealSide card={provisionalCard} />);
      expect(screen.queryByText('1975')).not.toBeNull();

      // `verify` answered with a different year, final.
      rerender(<CardRevealSide card={{ ...highConfidenceCard, year: 1976 }} />);

      expect(screen.queryByText('1975')).toBeNull();
      expect(screen.queryByText('1976')).not.toBeNull();
      expect(screen.queryByText(COPY.card.yearProvisional)).toBeNull();
      expect(screen.getByRole('status').textContent).toContain('1976');
    });

    it('should reserve the notice line in every year-number state so the card does not jump', () => {
      // jsdom computes no layout, so the height is pinned the only way it can be: the SAME line
      // node, with the same height-reserving class, exists in all three states. A high year's
      // line is empty and hidden from assistive technology.
      const cases: Array<[Card, string]> = [
        [provisionalCard, '1975'],
        [lowConfidenceCard, '1979'],
        [highConfidenceCard, '1975'],
      ];

      for (const [card, year] of cases) {
        render(<CardRevealSide card={card} />);
        const line = noticeLine(year);
        expect(line?.tagName, card.id).toBe('P');
        expect(line?.className, card.id).toContain('min-h-lh');
        expect(line?.className, card.id).toContain('text-sm');
        cleanup();
      }

      render(<CardRevealSide card={highConfidenceCard} />);
      const empty = noticeLine('1975');
      expect(empty?.textContent).toBe('');
      expect(empty?.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
