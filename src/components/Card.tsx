/**
 * The 3D flip shell. Owns no state: `isFlipped` comes in as a prop and `onFlip` goes out.
 *
 * ===========================================================================
 *  THE REVEALED SIDE IS NOT MOUNTED WHILE THE CARD IS UNFLIPPED.
 *
 *  This is the single most important line in the component, and it looks like
 *  an animation bug waiting to happen -- so here is why it is not negotiable.
 *
 *  `backface-visibility: hidden` is a VISUAL property. It stops a face from
 *  being painted; it does not remove its text from the document. An unflipped
 *  card whose reveal side is mounted still hands the title, artist and year to
 *  devtools, to find-in-page (Ctrl+F), to the accessibility tree, and to any
 *  screen reader -- while the player is looking at a card that is supposed to
 *  be a mystery. The leak requirement is a property of the whole app, not of
 *  one component (findings entry #6), and DOM presence is a leak.
 *
 *  It costs nothing visually: below 90 degrees of rotation the back face is
 *  invisible anyway, so there is nothing to see during the half of the
 *  transition when the reveal side is absent.
 *
 *  If a future change needs the reveal side mounted early for a smoother
 *  animation, that is a product decision about weakening the game's central
 *  rule -- not a refactor.
 * ===========================================================================
 *
 * Styling uses Tailwind v4's built-in 3D transform utilities (`perspective-*`,
 * `transform-3d`, `backface-hidden`, `rotate-y-*`). `plan.md` asks for plain CSS 3D with no
 * library, and these compile to exactly that -- no custom stylesheet, and no `@theme` tokens,
 * which are Phase 7's job.
 *
 * **This component does not flip itself on click.** Distinguishing a tap from a drag is
 * plan 2's problem and needs the gesture state that plan 2 owns, so the trigger is the
 * caller's to supply.
 */

import { CardHiddenSide } from './CardHiddenSide';
import { CardRevealSide } from './CardRevealSide';
import type { CardAudioControls } from '../hooks/useCardAudio';
import type { Card as CardData } from '../../shared/types';

export interface CardProps {
  card: CardData;
  isFlipped: boolean;
  /** True only for `year === undefined` — see `CardRevealSide`. */
  isYearPending: boolean;
  audio: CardAudioControls;
  /**
   * Part of the contract, and deliberately NOT read in this file.
   *
   * The prop exists so that plan 2 can attach it to the pointer handler it builds without
   * changing this component's signature, and so a caller cannot forget that a card needs a
   * flip trigger from somewhere. In Phase 4 the trigger is a button in `App.tsx`'s harness.
   */
  onFlip: () => void;
  onExit: () => void;
}

export function Card({ card, isFlipped, isYearPending, audio, onExit }: CardProps) {
  return (
    <div className="perspective-distant h-[28rem] w-72">
      <div
        data-testid="card-inner"
        data-flipped={isFlipped ? 'true' : 'false'}
        className={`relative h-full w-full transition-transform duration-500 transform-3d ${
          isFlipped ? 'rotate-y-180' : ''
        }`}
      >
        {/* The hidden face stays mounted throughout -- a 3D flip needs both faces to exist. */}
        <div
          data-testid="card-hidden-face"
          className="absolute inset-0 overflow-hidden rounded-2xl bg-neutral-900 backface-hidden"
        >
          <CardHiddenSide card={card} audio={audio} onExit={onExit} />
        </div>

        <div
          data-testid="card-reveal-face"
          className="absolute inset-0 overflow-hidden rounded-2xl bg-neutral-800 backface-hidden rotate-y-180"
        >
          {isFlipped ? <CardRevealSide card={card} isYearPending={isYearPending} /> : null}
        </div>
      </div>
    </div>
  );
}
