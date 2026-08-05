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
 *    none     -> `year: null`. No year exists; prompt the player to check this
 *                one themselves. A third of an ordinary deck lands here (15 of
 *                42 measured), so this is a common card, not an edge case.
 *    pending  -> `year: undefined`. The lookup has not come back yet. It WILL.
 *
 *  The last two are the pair most likely to be merged, because both are "no
 *  year on screen" -- but one resolves and the other never will, and telling a
 *  player to go and check a year that is about to arrive is a bug.
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
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-6 text-center">
      <YearSlot card={card} isYearPending={isYearPending} />

      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold text-neutral-100">{card.title}</p>
        {/*
          The artist string is rendered VERBATIM. `shared/artists.ts` documents why splitting
          it is forbidden for display: the separators Spotify joins with also occur inside
          real artist names, so "Earth, Wind & Fire" would render as three artists and corrupt
          the reveal -- the payoff of the entire game.
        */}
        <p className="text-base text-neutral-400">{card.artist}</p>
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
        <p className="text-5xl font-bold text-neutral-600" aria-hidden="true">
          ····
        </p>
        <p className="text-sm text-neutral-400">Still looking up the year…</p>
      </div>
    );
  }

  if (card.year === null || card.year === undefined) {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-3xl font-bold text-neutral-300">Year unknown</p>
        <p className="text-sm text-amber-300">Check this one yourself</p>
      </div>
    );
  }

  const isUnconfirmed = card.yearConfidence === 'low';

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-6xl font-bold tracking-tight text-neutral-50">{card.year}</p>
      {isUnconfirmed ? <p className="text-sm text-amber-300">Unconfirmed year</p> : null}
    </div>
  );
}
