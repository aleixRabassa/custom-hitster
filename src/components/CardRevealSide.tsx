/**
 * The revealed side of a card: title, artist, and the year -- which is the whole point of
 * Hitster, so it is the largest thing on the face.
 *
 * This component is mounted ONLY while the card is flipped (see `Card.tsx`). That is not an
 * optimisation: `backface-visibility` hides a face visually while leaving its text in the
 * DOM, where devtools, find-in-page, and the accessibility tree all still read it. Mounting
 * on flip is what makes "the hidden side leaks nothing" an assertable property.
 *
 * ===========================================================================
 *  THE YEAR SLOT HAS FOUR STATES AND MUST NOT COLLAPSE TO TWO.
 *
 *    high     -> the year, plain. Trust it.
 *    low      -> the year, plus an explicit "unconfirmed" marker. Showing a
 *                possibly-wrong year beats showing none, PROVIDED it is always
 *                marked (plan.md §5, decided 2026-08-04).
 *    none     -> `year: null`. No year exists. **A card in this state no longer
 *                REACHES a live deck** -- see below -- and this branch is kept
 *                for the one payload that can still carry one.
 *    pending  -> `year: undefined`. The lookup has not come back yet. It WILL.
 *
 *  The last two are the pair most likely to be merged, because both are "no
 *  year on screen" -- but one resolves and the other never will, and telling a
 *  player to go and check a year that is about to arrive is a bug.
 * ===========================================================================
 *
 * ## `none` is now a vestigial state, and it stays anyway
 *
 * It was a COMMON card until 2026-08-05 -- a third of an ordinary deck, 15 of 42 measured -- and
 * that day the developer reversed the decision behind it: a card whose lookup finds no year is
 * removed from the deck rather than played without one, because a Hitster card is placed on a
 * timeline BY its year. `gameReducer` filters at all three entry points, so no card in a live deck
 * holds `year: null` any more.
 *
 * The branch below is not dead code, though. `Card.year` still models the shape of a lookup
 * RESULT, and a session SAVED BEFORE the reversal is a real payload that can hold a yearless card;
 * `RESUME` filters those, but this is the display that would be correct if one ever slipped
 * through, and it is asserted in this component's tests. Deleting it would trade a documented
 * fallback for a blank year slot.
 *
 * ===========================================================================
 *  THIS IS THE ONE PLACE IN THE APP WHERE ANNOUNCING TRACK DATA IS CORRECT.
 *
 *  The `role="status"` below is a POLITE LIVE REGION, and it looks exactly like
 *  the leak the rest of the app is built to avoid. It is the opposite of one.
 *
 *  Before Phase 7 the flip was SILENT to assistive technology: a player pressed
 *  Space, this component mounted, and nothing was announced. The payoff of the
 *  entire game -- the year -- was available to an eye and to nothing else. A
 *  card with a QR code and no audible reveal is not a game a screen-reader user
 *  can play.
 *
 *  Why it cannot leak: this component is mounted ONLY while the card is flipped
 *  (`Card.tsx`, and that is the DOM-presence rule, not an optimisation). There
 *  is no unflipped card on which this region exists, so there is nothing for it
 *  to announce early. That is also why the region belongs HERE and nowhere else:
 *  `CardHiddenSide`, `CardStack`'s backs and the HUD are all live on an
 *  unflipped card, and a live region on any of them would announce a card the
 *  player is meant to be guessing. `CardHiddenSide.test.tsx` asserts the
 *  absence.
 *
 *  POLITE, not assertive. The reveal is expected and was asked for; interrupting
 *  whatever the screen reader is mid-sentence on would be rude about news the
 *  player already requested. `role="status"` carries `aria-live="polite"`
 *  implicitly and is the smaller declaration.
 * ===========================================================================
 */

import type { Card } from '../../shared/types';

export interface CardRevealSideProps {
  card: Card;
  /**
   * From `isCurrentYearPending` in `src/game/reducer.ts` — true only for `year === undefined`.
   * Passed in rather than derived here so the component stays presentational and the reducer
   * stays the single definition of "pending".
   */
  isYearPending: boolean;
}

export function CardRevealSide({ card, isYearPending }: CardRevealSideProps) {
  return (
    // The live region wraps the year, the title AND the artist, so one announcement carries the
    // whole reveal rather than three. See the header block for why this is safe here and nowhere
    // else in the app.
    <div
      role="status"
      className="flex h-full w-full flex-col items-center justify-center gap-6 p-6 text-center"
    >
      <YearSlot card={card} isYearPending={isYearPending} />

      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold text-fg">{card.title}</p>
        {/*
          The artist string is rendered VERBATIM. `shared/artists.ts` documents why splitting
          it is forbidden for display: the separators Spotify joins with also occur inside
          real artist names, so "Earth, Wind & Fire" would render as three artists and corrupt
          the reveal -- the payoff of the entire game.
        */}
        <p className="text-base text-fg-secondary">{card.artist}</p>
      </div>
    </div>
  );
}

function YearSlot({ card, isYearPending }: CardRevealSideProps) {
  // Pending is checked FIRST: `year` is `undefined` here, and every branch below would
  // otherwise have to special-case it.
  if (isYearPending) {
    return (
      <div className="flex flex-col items-center gap-2">
        {/*
          `aria-hidden` decoration, and the one colour in the app deliberately left below 4.5:1
          (1.94:1, measured). It is not content: the line beneath it carries the whole meaning, so
          WCAG 1.4.3 exempts it and raising it would be a visual change Phase 8 owns.
        */}
        <p className="text-year-pending font-bold text-fg-decorative" aria-hidden="true">
          ····
        </p>
        <p className="text-sm text-fg-secondary">Still looking up the year…</p>
      </div>
    );
  }

  if (card.year === null || card.year === undefined) {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-year-none font-bold text-fg-heading">Year unknown</p>
        <p className="text-sm text-warning">Check this one yourself</p>
      </div>
    );
  }

  const isUnconfirmed = card.yearConfidence === 'low';

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-year font-bold tracking-tight text-fg-strong">{card.year}</p>
      {isUnconfirmed ? <p className="text-sm text-warning">Unconfirmed year</p> : null}
    </div>
  );
}
