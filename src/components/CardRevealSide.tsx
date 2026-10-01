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
 *  THE YEAR SLOT HAS FIVE STATES AND MUST NOT COLLAPSE TO FEWER.
 *
 *    pending      -> `year: undefined`. The lookup has not come back yet. It WILL.
 *    provisional  -> `yearProvisional: true`. The fast `resolve` stage answered and
 *                    the year is SHOWN, exactly as a final year is, with a
 *                    "Confirming year" line beneath it: the `verify` stage may
 *                    still change it. Progress, not a warning -- so the line is
 *                    `text-fg-secondary`, never the amber `text-warning`, which
 *                    must keep meaning "unconfirmed" (plan.year-fetch-rework-ui.md
 *                    decision 4).
 *    high         -> final. The year, plain. Trust it.
 *    low          -> final. The year, plus an explicit "unconfirmed" marker.
 *                    Showing a possibly-wrong year beats showing none, PROVIDED it
 *                    is always marked (plan.md §5, decided 2026-08-04). A `low`
 *                    year marked `yearUnverified` (verify could not be asked --
 *                    an outage or no connection, 2026-10-01) says "Year could not
 *                    be checked" instead, in the same amber: unchecked, not
 *                    doubtful.
 *    none         -> final, `year: null`. Every provider was asked. Reaches a live
 *                    deck when the session keeps yearless cards -- see below.
 *
 *  The first three are `yearStateOf()` in `src/game/reducer.ts`, the ONE
 *  three-way reading of `year` and `yearProvisional`; `YearSlot` switches on it
 *  with an exhaustive `never` check, so a fourth state added there fails the
 *  typecheck here. It is the first import from `game/reducer` in a component and
 *  that is fine: it is a pure function of the `Card` this component already
 *  receives, not session state.
 *
 *  `pending` and `none` are the pair most likely to be merged, because both are
 *  "no year on screen" -- but one resolves and the other never will, and telling
 *  a player to go and check a year that is about to arrive is a bug.
 *
 *  A provisional card whose `yearConfidence` is `low` shows "Confirming year",
 *  NOT "Unconfirmed year": one slot, one notice, and the confidence is not final
 *  until the card is, so calling it unconfirmed would be premature.
 *
 *  THE NOTICE LINE IS RESERVED IN ALL THREE YEAR-NUMBER STATES, including `high`,
 *  where it is EMPTY (`min-h-lh`, one `text-sm` line, `aria-hidden`). That is a
 *  deliberate change to every final-high card's geometry (2026-09-30): the
 *  reveal is a `justify-center` column, so a line that vanished when a
 *  provisional year was confirmed `high` would recentre the whole face -- the
 *  card would jump at the one moment the player is reading it. With the line
 *  always there, provisional -> high / low changes the text in it and nothing
 *  else. Pending -> provisional still resizes the slot (spinner box vs year);
 *  that transition predates this and is not what the reservation is for.
 * ===========================================================================
 *
 * ## `none` is LIVE again, behind an option -- and still covers pre-reversal saves
 *
 * It was a COMMON card until 2026-08-05 -- a third of an ordinary deck, 15 of 42 measured -- and
 * that day the developer reversed the decision behind it: a card whose lookup finds no year is
 * removed from the deck rather than played without one, because a Hitster card is placed on a
 * timeline BY its year. From then until the provider vote, `gameReducer` filtered at all three
 * entry points, so no card in a live deck held `year: null` and this branch was vestigial, kept
 * only for a resumed save taken before that reversal.
 *
 * It is reachable in ordinary play again (plan.year-fetch-rework-game.md, spike §12.8): a session
 * dealt with `keepYearless` -- the picker's "Deal cards with no year found" ticked (first "Keep cards with no year found", then briefly the inverted "Skip ...", on 2026-10-01) -- keeps a card whose
 * FINAL answer is null, and this is the face it shows. With the option off the reducer still drops
 * those cards, and the branch still serves a pre-reversal save. Its markup is unchanged: it is the
 * display that is correct for a yearless card wherever one comes from, and it is asserted in this
 * component's tests.
 *
 * The live region below now also announces "Confirming year" and, when the `verify` stage changes
 * a provisional year, the new year: the notice sits INSIDE the one region, so the update is read
 * out with no second region anywhere.
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

import { useCopy } from '../hooks/useLocale';
import { yearStateOf } from '../game/reducer';
import { Spinner } from './Spinner';
import type { Card } from '../../shared/types';

export interface CardRevealSideProps {
  card: Card;
}

export function CardRevealSide({ card }: CardRevealSideProps) {
  return (
    // The live region wraps the year, the title AND the artist, so one announcement carries the
    // whole reveal rather than three. See the header block for why this is safe here and nowhere
    // else in the app.
    <div
      role="status"
      className="flex h-full w-full flex-col items-center justify-center gap-6 p-6 text-center"
    >
      <YearSlot card={card} />

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

function YearSlot({ card }: { card: Card }) {
  const copy = useCopy();
  const state = yearStateOf(card);

  switch (state) {
    case 'pending':
      return (
        <div className="flex flex-col items-center gap-2">
          {/*
            ===================================================================
             A SPINNER SINCE 2026-08-11. IT WAS FOUR STATIC DOTS -- `····` --
             at `--text-year-pending`, which said "empty" rather than "working":
             the one state on this face that is genuinely IN PROGRESS was the
             only one drawn as something inert.

             THE WRAPPER IS SIZED AND THE SPINNER IS NOT WHAT HOLDS THE SLOT
             OPEN. `prefers-reduced-motion: reduce` HIDES the spinner outright
             (`display: none` -- `Spinner` has the reasoning), so a bare spinner
             here would collapse this slot to just the line below it and the
             card's layout would jump between pending and resolved for those
             players only. jsdom evaluates no media query, so nothing local
             would catch that. The box keeps the height either way; it is the
             `qr-placeholder` convention -- reserve the space, drop the motion.

             NO `role="status"` ON EITHER NODE. The whole reveal is already one
             live region (see the wrapper above), and a nested second one would
             announce this card twice. `DeckActions` wraps its spinner in
             `role="status"` because it is not inside one -- do not copy that
             pattern here.

             The announcement is unchanged: the spinner is `aria-hidden` exactly
             as the dots were, so the line below remains the entire pending
             announcement. It is asserted, and rewording it is the one edit that
             breaks the app's only live region.
            ===================================================================
          */}
          <div className="flex size-(--size-year-spinner) items-center justify-center">
            <Spinner sizeClassName="size-(--size-year-spinner)" />
          </div>
          <p className="text-sm text-fg-secondary">{copy.card.yearPending}</p>
        </div>
      );

    case 'provisional':
    case 'final': {
      // `yearStateOf` does not narrow `card.year` for the type checker, and a provisional card
      // carries a number by construction (the reducer sets the flag only beside one), so the one
      // null guard both cases share lands a stray null on the correct `none` face rather than
      // rendering an empty year.
      if (card.year === null || card.year === undefined) {
        return (
          <div className="flex flex-col items-center gap-2">
            <p className="text-year-none font-bold text-fg-heading">{copy.card.yearUnknown}</p>
            <p className="text-sm text-warning">{copy.card.yearUnknownDetail}</p>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center gap-2">
          {/*
            `text-fg-year` is the one text colour Phase 8 changed, and it is the ring's green rather
            than the near-white `--color-fg-strong` it replaced: the year is the payoff of the game
            and the mockup gives it the same neon as the card's edge. 11.30:1 on this face, against
            a 3:1 large-text floor.

            FLAT, not the ring's gradient, and that is the audit's decision rather than a shortcut
            -- `background-clip: text` needs `color: transparent`, so a gradient that fails to paint
            renders the year invisible, and a gradient has no single ratio to record either way.
            The token's own comment in `src/index.css` carries the full argument.

            A provisional year renders through THIS SAME node: "exactly as a final year" is a
            property of the markup, not of two copies that happen to match.
          */}
          <p className="text-year font-bold tracking-tight text-fg-year">{card.year}</p>
          <YearNotice card={card} isProvisional={state === 'provisional'} />
        </div>
      );
    }

    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/**
 * The one line under a year: "Confirming year", "Unconfirmed year", "Year could not be checked", or
 * nothing -- but always the
 * same `<p>` with `min-h-lh`, so the line's height is reserved in every year-number state and a
 * provisional year confirmed as `high` does not recentre the face (see the header). The empty
 * case is `aria-hidden` so the reserved line is not an empty node in the live region.
 *
 * Colour is a TOKEN in both non-empty cases, never an opacity modifier: `text-fg-secondary` for
 * progress, `text-warning` for a year that must be marked.
 */
function YearNotice({ card, isProvisional }: { card: Card; isProvisional: boolean }) {
  const copy = useCopy();

  if (isProvisional) {
    return <p className="min-h-lh text-sm text-fg-secondary">{copy.card.yearProvisional}</p>;
  }
  if (card.yearConfidence === 'low') {
    return (
      <p className="min-h-lh text-sm text-warning">
        {card.yearUnverified === true ? copy.card.yearUnverified : copy.card.yearUnconfirmed}
      </p>
    );
  }

  return <p aria-hidden="true" className="min-h-lh text-sm" />;
}
