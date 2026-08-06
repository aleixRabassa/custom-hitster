/**
 * The deck as the player sees it: the current card, draggable, over 2 static backs that make
 * it look like there is more to come.
 *
 * Owns two things and nothing else -- WHEN a card leaves (presence and keying) and the
 * gesture wiring it needs. How a card looks and how its own element moves stay in `Card`.
 *
 * ===========================================================================
 *  THE BACKS RENDER NO CARD DATA. NOT THE TITLE, NOT THE YEAR, NOT A QR CODE,
 *  NOT AN `id`, NOT AN `aria-label`. THEY ARE EMPTY DIVS.
 *
 *  Two independent reasons, either of which alone would be enough:
 *
 *  LEAK. A card behind the top one has no reason for its data to be in the
 *  document at all. The whole game rests on the next card being a mystery, and
 *  `backface-visibility` does not remove text from the DOM -- so the only safe
 *  version of "a card peeking out from behind" is one that has nothing to read.
 *  A devtools search on a live game must find ONE card's worth of data.
 *
 *  COST. Every QR code is an asynchronous `qrcode.toDataURL()` render. Reusing
 *  `Card` for the backs would triple that work per advance, for two cards nobody
 *  can see the face of -- and `plan.md` lazy-loads QR generation in Phase 7
 *  precisely because it is not free.
 *
 *  So: do not "just reuse `Card`" for the backs. `CardStack.test.tsx` asserts
 *  against exactly that refactor.
 * ===========================================================================
 */

import { AnimatePresence } from 'motion/react';

import { Card } from './Card';
import { useCardGestures } from '../hooks/useCardGestures';
import type { Card as CardData } from '../../shared/types';

/**
 * How many backs peek out behind the current card.
 *
 * `plan.md` says "2-3 cards peeking" and leaves the choice to the eye during real-device
 * verification. 2 is the starting value: at 3 the offsets below either grow the stack's
 * footprint on a phone or compress until the third back is indistinguishable from the second.
 */
const VISIBLE_BACKS = 2;

/**
 * Vertical offset per back, in CSS pixels. Each back sits slightly lower than the one above.
 *
 * DELIBERATELY STILL ABSOLUTE after Phase 7 made the card fluid, which was an open question
 * (plan 1, question 2). A fixed 10px is a larger proportion of a 288px-tall card than of a
 * 448px one -- but the offset's job is to be PERCEPTIBLE, and 10px is close to the minimum
 * that reads as "there is another card behind this one" at all. Scaling it down to ~6px on the
 * smallest card would make the depth cue faintest exactly where the stack is already tightest,
 * which is the wrong direction. Like every other number in this file it was chosen by eye and
 * has never been seen on a phone.
 */
const BACK_OFFSET_PX = 10;

/**
 * Scale reduction per back. Small: the backs suggest depth, they do not perform it.
 *
 * This one needed no Phase 7 decision -- `scale()` is proportional by construction, so 4% of a
 * smaller card is already a smaller absolute inset.
 */
const BACK_SCALE_STEP = 0.04;

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
   * The cards behind. `slice` is what makes the tail of the deck correct for free: on the last
   * card it returns `[]`, so there are no backs and no phantom back for a card that does not
   * exist. Reading `deck[currentIndex + 1]` instead would hand `noUncheckedIndexedAccess` an
   * `undefined` to guard at every use site.
   */
  const backs = deck.slice(currentIndex + 1, currentIndex + 1 + VISIBLE_BACKS);

  // `noUncheckedIndexedAccess` makes this genuinely possibly-undefined. The reducer clamps
  // `currentIndex`, so it should not happen -- but rendering nothing beats throwing.
  if (!currentCard) return null;

  return (
    /*
      `isolate` creates a stacking context so the backs' `-z-10` stays behind the current card
      without escaping to sit behind the screen's own background. Without it the backs are
      positioned elements and would paint OVER the in-flow card.

      The size tokens are THE SAME PAIR `Card` uses, and that is the point of them: this wrapper
      and the card it holds carried `h-[28rem] w-72` separately until Phase 7, and the backs are
      `absolute inset-0` on this element -- so the two literals had to agree or the peeking backs
      misaligned, with nothing enforcing it. `CardStack.test.tsx` asserts the class strings match.
    */
    <div className="relative isolate h-(--card-height) w-(--card-width)">
      {backs.map((back, offset) => (
        <div
          /*
            Keyed on id PLUS deck index. A playlist may legitimately contain the same track
            twice -- Phase 3's reducer handles duplicate ids explicitly for exactly that
            reason -- and a bare-id key collides between two adjacent copies, which React
            resolves by reusing one element for both. The index is what disambiguates.
          */
          key={`${back.id}:${currentIndex + 1 + offset}`}
          data-testid="card-back"
          /*
            Hidden from assistive technology as well as empty of data: a back is a visual
            depth cue, and announcing two blank groups before every card is noise.
          */
          aria-hidden="true"
          /*
            `card-ring-dim` is Phase 8's dimmed ring, and it REPLACED `border border-border` --
            which measured 1.31:1 against the page, so the cue telling a player there is more deck
            was very nearly invisible. It is a flat border rather than a dimmed gradient because a
            back is a sliver a few pixels tall once it is scaled and offset; see `src/index.css`.

            IT IS STILL A CLASS ON AN EMPTY ELEMENT. The ring must not become a reason to render
            anything in here -- no content, no QR, no id, no `aria-label`. Two assertions in
            `CardStack.test.tsx` cover that, and the header block above says why.
          */
          className="card-ring-dim absolute inset-0 -z-10 rounded-card bg-surface"
          style={{
            transform: `translateY(${(offset + 1) * BACK_OFFSET_PX}px) scale(${
              1 - (offset + 1) * BACK_SCALE_STEP
            })`,
          }}
        />
      ))}

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
