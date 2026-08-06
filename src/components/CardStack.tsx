/**
 * The deck as the player sees it: the current card, draggable, directly over the next card --
 * which is the same size, exactly behind, and therefore invisible until the top card moves.
 *
 * Owns two things and nothing else -- WHEN a card leaves (presence and keying) and the
 * gesture wiring it needs. How a card looks and how its own element moves stay in `Card`.
 *
 * ===========================================================================
 *  THE BACK IS THE NEXT CARD'S HIDDEN FACE, AND THAT REVERSES WHAT THIS FILE
 *  SAID UNTIL 2026-08-06. READ THIS BEFORE "RESTORING" THE EMPTY DIVS.
 *
 *  Through Phase 8 the stack rendered TWO backs as empty divs, each scaled down
 *  4% and pushed 10px further down than the one above. Two things were wrong
 *  with that in a real browser:
 *
 *  1. Centre-origin `scale()` pulls a card's bottom edge UP by (H / 2) x step --
 *     8.96px at the 448px ceiling -- against a 10px push down. So the backs
 *     peeked by 1px and 2px at the bottom and were INSET on every other side. As
 *     soon as the top card was dragged aside, what appeared behind it was two
 *     concentric rectangles smaller than the card: "two cards, one inside the
 *     other". The geometry is measured in `docs/agent_findings.md` (2026-08-06).
 *
 *  2. An empty div is not what a player is looking for when they slide a card
 *     away. They are looking for the next card, and it arrived blank -- its QR
 *     could not begin generating until the advance had already happened.
 *
 *  So there is now ONE back, at `inset-0` with NO transform of any kind, holding
 *  the real next card's hidden face. At rest it is covered pixel for pixel by the
 *  card in front of it. During a drag it is revealed already complete, with its
 *  code generated; `src/game/qr-cache.ts` is what carries that code across the
 *  advance, when the back unmounts and a `Card` mounts in its place.
 *
 *  ===========================================================================
 *   WHAT DID NOT CHANGE IS THE PART THAT MATTERS: THE BACK CANNOT SHOW AN
 *   ANSWER. It renders `CardHiddenSide` and NOTHING ELSE -- this file does not
 *   import `CardRevealSide` and must not. No title, no artist, no year, no
 *   `aria-label`, in the DOM or in an attribute; a devtools search for the
 *   answer to any card still finds nothing, and `CardStack.test.tsx` asserts it
 *   over the back's `outerHTML`.
 *
 *   What IS now in the document for one card ahead is the track ID, because the
 *   QR encodes it. That was weighed and accepted when this changed: the id is 22
 *   opaque characters, the hidden face is a mystery BY CONSTRUCTION, and the
 *   card it belongs to is the one the player is in the act of dealing themselves.
 *   The cost is one extra `toDataURL()` per advance, one card ahead -- which is
 *   the whole point, since that work is what has moved off the critical path.
 *  ===========================================================================
 * ===========================================================================
 */

import { AnimatePresence } from 'motion/react';

import { Card } from './Card';
import { CardHiddenSide } from './CardHiddenSide';
import { useCardGestures } from '../hooks/useCardGestures';
import type { Card as CardData } from '../../shared/types';

export interface CardStackProps {
  /** The shuffled deck, straight from `GameState.deck`. */
  deck: CardData[];
  /** Index of the current card, straight from `GameState.currentIndex`. */
  currentIndex: number;
  isFlipped: boolean;
  isYearPending: boolean;
  onFlip: () => void;
  onNext: () => void;
  /** Passed through to `useCardGestures` — see `UseCardGesturesOptions.isEnabled`. */
  isEnabled: boolean;
}

export function CardStack({
  deck,
  currentIndex,
  isFlipped,
  isYearPending,
  onFlip,
  onNext,
  isEnabled,
}: CardStackProps) {
  const { gestureProps, exitDirection } = useCardGestures({ onFlip, onNext, isEnabled });

  const currentCard = deck[currentIndex];

  /**
   * The card behind, or `undefined` on the last card of the deck.
   *
   * `noUncheckedIndexedAccess` makes that `undefined` explicit, which is exactly right here: a
   * back rendered for a card that does not exist would promise another card at the moment the
   * game is about to end. One `?` at the single use site below is the whole guard.
   */
  const nextCard = deck[currentIndex + 1];

  // Possibly-undefined for the same reason. The reducer clamps `currentIndex`, so it should not
  // happen -- but rendering nothing beats throwing.
  if (!currentCard) return null;

  return (
    /*
      `isolate` creates a stacking context so the back's `-z-10` stays behind the current card
      without escaping to sit behind the screen's own background. Without it the back is a
      positioned element and would paint OVER the in-flow card.

      That negative index is also what orders the three cards correctly during an exit: the back
      paints below in-flow content, the INCOMING card is in flow, and the outgoing card has been
      absolutised by `popLayout` and so paints above both. The card sliding away therefore
      uncovers the card that is replacing it, not the preload behind it.

      The size tokens are THE SAME PAIR `Card` uses, and that is the point of them: this wrapper
      and the card it holds carried `h-[28rem] w-72` separately until Phase 7, and the back is
      `absolute inset-0` on this element -- so the two literals had to agree or it would not line
      up with the card, with nothing enforcing it. `CardStack.test.tsx` asserts the classes match.
    */
    <div className="relative isolate h-(--card-height) w-(--card-width)">
      {nextCard ? (
        <div
          data-testid="card-back"
          /*
            DELIBERATELY UNKEYED. React reuses this one element as `nextCard` changes, so the
            `QrCode` inside keeps its state across an advance instead of remounting -- one fewer
            thing depending on the cache. Adjacent duplicate ids, which the `AnimatePresence` key
            below has to disambiguate, are a non-issue here for the same reason: there is no list
            and nothing to reconcile by identity.
          */

          /*
            Hidden from assistive technology, which is not a leak decision but a duplication one:
            this face carries the same generic "Scan to play the full song" line as the card in
            front of it, and announcing it twice per card says nothing about either. Sighted
            players get the preload; nobody gets a second copy of the same sentence.
          */
          aria-hidden="true"
          /*
            NO TRANSFORM AND NO OFFSET. `inset-0` on a wrapper sized from the same two tokens as
            the card means this is exactly the card's box -- which is the requirement: covered
            completely at rest, fully aligned the moment the top card starts to move. The 4%
            scale and 10px translate that used to be here are what produced the nested-rectangle
            look; see the header.

            `card-ring` (the full gradient band, not the old flat `card-ring-dim`) because this
            is now a real card face and must look like one when it is uncovered.
            `card-ring-quiet` suppresses ONLY the bloom: the glow is a `box-shadow` painted
            outside the element, so at rest this element's bloom would sit exactly on top of the
            front card's and composite to a brighter halo than the design was tuned for. The two
            utilities declare different properties and therefore do not race in the cascade --
            see the long note in `src/index.css`.

            `pointer-events-none` because a back is never a target: the drag belongs to the card
            in front, and the QR image inside here must not be able to start a native image drag
            of its own once a swipe has exposed it.
          */
          className="card-ring card-ring-quiet pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-card bg-surface"
        >
          {/*
            `CardHiddenSide`, and never `Card`. Not for the cost -- the whole point of this
            element is to pay the QR cost early -- but because `Card` mounts a reveal FACE, and
            a reveal face behind the current card is one `isFlipped` bug away from the answer
            being in the document. This subtree cannot show a year, because nothing that renders
            one is imported into this file.
          */}
          <CardHiddenSide card={nextCard} />
        </div>
      ) : null}

      {/*
        `initial={false}` so the first card of a session does not animate IN from nowhere --
        it is already there when the screen mounts. `popLayout` takes the outgoing card out of
        layout flow, so the incoming card keeps the slot the outgoing one is vacating instead of
        being laid out after it.

        ===========================================================================
         `popLayout` ONLY WORKS BECAUSE `Card` ACCEPTS A REF, AND IT FAILED SILENTLY
         FOR AS LONG AS IT DID NOT.

         Motion pops the outgoing child by cloning it with a ref of its own,
         measuring that element, and injecting a `position: absolute` rule for it.
         `Card` accepted no ref, so the clone's ref landed on nothing and every one
         of those steps bailed on a null `ref.current`. The mode was configured and
         documented and did nothing: both cards sat in normal flow, which put the
         INCOMING card a full card-height below the outgoing one -- off the bottom
         of the deck, generally off the screen -- for the length of the exit, and
         then snapped it up into place. It read as the next card rising from below.

         So `Card`'s `ref` prop is load-bearing for this element, and its own
         header carries the long version. Nothing in this repo can test the
         consequence: jsdom computes no layout, so Motion's measurement bails there
         no matter what, and the check is manual (a swipe, in a browser).
        ===========================================================================
      */}
      <AnimatePresence initial={false} mode="popLayout">
        <Card
          key={`${currentCard.id}:${currentIndex}`}
          card={currentCard}
          isFlipped={isFlipped}
          isYearPending={isYearPending}
          onFlip={onFlip}
          gestureProps={gestureProps}
          exitDirection={exitDirection}
        />
      </AnimatePresence>
    </div>
  );
}
