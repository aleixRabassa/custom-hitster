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
import type { CardAudioControls } from '../hooks/useCardAudio';
import type { Card as CardData } from '../../shared/types';

/**
 * How many backs peek out behind the current card.
 *
 * `plan.md` says "2-3 cards peeking" and leaves the choice to the eye during real-device
 * verification. 2 is the starting value: at 3 the offsets below either grow the stack's
 * footprint on a phone or compress until the third back is indistinguishable from the second.
 */
const VISIBLE_BACKS = 2;

/** Vertical offset per back, in CSS pixels. Each back sits slightly lower than the one above. */
const BACK_OFFSET_PX = 10;

/** Scale reduction per back. Small: the backs suggest depth, they do not perform it. */
const BACK_SCALE_STEP = 0.04;

export interface CardStackProps {
  /** The shuffled deck, straight from `GameState.deck`. */
  deck: CardData[];
  /** Index of the current card, straight from `GameState.currentIndex`. */
  currentIndex: number;
  isFlipped: boolean;
  isYearPending: boolean;
  audio: CardAudioControls;
  onFlip: () => void;
  onNext: () => void;
  onExit: () => void;
  /** Passed through to `useCardGestures` — see `UseCardGesturesOptions.isEnabled`. */
  isEnabled: boolean;
}

export function CardStack({
  deck,
  currentIndex,
  isFlipped,
  isYearPending,
  audio,
  onFlip,
  onNext,
  onExit,
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
    */
    <div className="relative isolate h-[28rem] w-72">
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
          className="absolute inset-0 -z-10 rounded-2xl border border-neutral-800 bg-neutral-900"
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
        layout flow, so the incoming card does not get pushed sideways while it leaves.
      */}
      <AnimatePresence initial={false} mode="popLayout">
        <Card
          key={`${currentCard.id}:${currentIndex}`}
          card={currentCard}
          isFlipped={isFlipped}
          isYearPending={isYearPending}
          audio={audio}
          onFlip={onFlip}
          onExit={onExit}
          gestureProps={gestureProps}
          exitDirection={exitDirection}
        />
      </AnimatePresence>
    </div>
  );
}
