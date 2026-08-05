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
 * library, and these compile to exactly that -- no custom stylesheet.
 *
 * ## The card's size comes from `--card-height` / `--card-width`, and so does `CardStack`'s
 *
 * Both files carried `h-[28rem] w-72` until Phase 7, and the two literals were REQUIRED to
 * match: the stack's peeking backs are `absolute inset-0` on a wrapper sized by the second
 * pair, so a change here and not there silently misaligned the deck, and nothing enforced it.
 * The pair now comes from two tokens in `src/index.css`, whose header explains the clamp.
 * `CardStack.test.tsx` asserts the two elements carry the same class string.
 *
 * **This component does not decide what a flip is.** Distinguishing a tap from a drag is
 * Phase 5's problem and lives in `src/game/gestures.ts` behind `useCardGestures`; this file
 * receives the resulting handlers as `gestureProps` and spreads them. `onFlip` remains part
 * of the contract for the same reason it always was -- a caller must not be able to forget
 * that a card needs a flip trigger from somewhere.
 *
 * ## Two transforms, two elements (Phase 5)
 *
 * The drag lives on the OUTER element and the flip rotation on the inner face wrapper, and
 * they must stay that way. Both are CSS transforms on the same axis of the same box if they
 * share an element: Motion writes `transform: translateX(...)` from the drag while Tailwind's
 * `rotate-y-180` writes its own, and the last writer wins -- so a mid-flip drag would snap
 * the rotation away, or the flip would cancel the drag offset. Separate elements compose
 * instead of competing.
 *
 * ## Nothing interactive may be rendered inside this element
 *
 * `gestureProps.onPointerUp` is bound to the outer element, and a pointer-up anywhere inside
 * bubbles into it and is judged as a possible tap. A button in here therefore both activates
 * itself and flips the card from one press -- which is exactly the bug that moved Exit,
 * Play/Pause and Restart out to `CardControls`. Keep this subtree non-interactive: the QR image
 * and text, and nothing that can be clicked.
 */

import { motion } from 'motion/react';

import { CardHiddenSide } from './CardHiddenSide';
import { CardRevealSide } from './CardRevealSide';
import type { CardGestureProps } from '../hooks/useCardGestures';
import type { CommitDirection } from '../game/gestures';
import type { Card as CardData } from '../../shared/types';

/** How far a committed card travels as it leaves, in CSS pixels. Comfortably off-screen. */
const EXIT_DISTANCE_PX = 600;

/**
 * How long that exit takes, in SECONDS -- Motion's unit, not CSS's.
 *
 * The same value is named `--duration-card-exit: 250ms` in `src/index.css` so Phase 8 has one
 * place to look, but it cannot be READ from there: Motion's `transition.duration` is a number of
 * seconds handed to a JS animation, and a CSS custom property is a string resolved by the
 * browser at paint time. So the two are deliberately duplicated and must be changed together.
 *
 * Under `prefers-reduced-motion` this animation is not shortened -- `MotionConfig
 * reducedMotion="user"` in `src/main.tsx` makes Motion animate opacity instead of the transform,
 * so the card fades over the same 250ms rather than flying 600px.
 */
const EXIT_DURATION_S = 0.25;

export interface CardProps {
  card: CardData;
  isFlipped: boolean;
  /** True only for `year === undefined` — see `CardRevealSide`. */
  isYearPending: boolean;
  /**
   * Part of the contract, and deliberately NOT read in this file.
   *
   * Phase 5 routes the flip through `gestureProps.onPointerUp` instead, because deciding
   * whether a pointer sequence was a tap needs state this component has no business owning.
   * The prop stays so that a caller cannot wire up a card without saying what a flip does.
   */
  onFlip: () => void;
  /**
   * From `useCardGestures`. Optional: `Card` renders and flips perfectly well without it,
   * which is what lets the Phase 4 card tests stay free of gesture setup.
   */
  gestureProps?: CardGestureProps;
  /**
   * Which way this card leaves when it is committed, from `useCardGestures`.
   *
   * The card exits the way it was thrown rather than always the same way. Only meaningful
   * inside an `AnimatePresence` (see `CardStack`); harmless elsewhere.
   */
  exitDirection?: CommitDirection;
}

export function Card({
  card,
  isFlipped,
  isYearPending,
  gestureProps,
  exitDirection = 'left',
}: CardProps) {
  return (
    /*
      `touch-none` is `touch-action: none`, and on a touch device it is the difference between
      a working swipe and no swipe at all: without it the browser claims the gesture for its
      own scroll handling and Motion never sees the pointer move. Paired with the
      `overscroll-behavior: none` in `src/index.css`, which stops the vertical component of a
      swipe from triggering pull-to-refresh.
    */
    <motion.div
      className="perspective-distant h-(--card-height) w-(--card-width) touch-none"
      {...gestureProps}
      exit={{
        x: exitDirection === 'left' ? -EXIT_DISTANCE_PX : EXIT_DISTANCE_PX,
        opacity: 0,
        transition: { duration: EXIT_DURATION_S },
      }}
    >
      <div
        data-testid="card-inner"
        data-flipped={isFlipped ? 'true' : 'false'}
        /*
          `data-motion="flip"` is the reduced-motion hook, and it is an ATTRIBUTE rather than a
          class because it is a contract with the `@media (prefers-reduced-motion: reduce)` block
          in `src/index.css` -- which collapses this duration so the face changes instantly
          without travelling. No component in this app reads the preference itself (decision 3).
        */
        data-motion="flip"
        className={`relative h-full w-full transition-transform duration-(--duration-flip) transform-3d ${
          isFlipped ? 'rotate-y-180' : ''
        }`}
      >
        {/* The hidden face stays mounted throughout -- a 3D flip needs both faces to exist. */}
        <div
          data-testid="card-hidden-face"
          className="absolute inset-0 overflow-hidden rounded-2xl bg-surface backface-hidden"
        >
          <CardHiddenSide card={card} />
        </div>

        <div
          data-testid="card-reveal-face"
          className="absolute inset-0 overflow-hidden rounded-2xl bg-surface-raised backface-hidden rotate-y-180"
        >
          {isFlipped ? <CardRevealSide card={card} isYearPending={isYearPending} /> : null}
        </div>
      </div>
    </motion.div>
  );
}
