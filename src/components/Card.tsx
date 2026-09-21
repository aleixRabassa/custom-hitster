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
import type { Variants } from 'motion/react';
import type { Ref } from 'react';

import { CardHiddenSide } from './CardHiddenSide';
import { CardRevealSide } from './CardRevealSide';
import type { CardGestureProps } from '../hooks/useCardGestures';
import type { DeckMovement } from '../game/gestures';
import type { Card as CardData } from '../../shared/types';

/**
 * How far a card travels as it leaves -- and, since 2026-09-21, how far away it COMES BACK FROM.
 *
 * In CSS pixels, comfortably off-screen. One constant for both because the backward animation is
 * the forward one run in reverse: a card returns from exactly where it was thrown to, and two
 * numbers that drifted apart would make the undo travel a different distance from the deal.
 */
const EXIT_DISTANCE_PX = 600;

/**
 * Where the OUTGOING card sits while a returning card slides in over it.
 *
 * ===========================================================================
 *  THIS NUMBER IS BOUNDED AT BOTH ENDS AND NEITHER BOUND IS ARBITRARY.
 *
 *  `mode="popLayout"` absolutises the outgoing card, and a positioned element
 *  paints ABOVE in-flow content -- which is exactly what the forward animation
 *  wants (the card flying away passes over the card it uncovers) and exactly
 *  wrong for the backward one, where the returning card has to land ON TOP.
 *  A negative z-index inside `CardStack`'s `isolate` puts the outgoing card
 *  back under in-flow content, which is where it belongs.
 *
 *  It must stay ABOVE the deck's preloaded back, which is `-z-10` on the same
 *  stacking context: go to -10 or lower and the card the player is stepping
 *  away from would sink behind the preload of itself.
 * ===========================================================================
 */
const BEHIND_INCOMING_Z_INDEX = -1;

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

/**
 * The exit, as a DYNAMIC variant that reads `AnimatePresence`'s `custom` -- and it has to be.
 *
 * ===========================================================================
 *  AN EXITING CHILD ANIMATES WITH THE PROPS IT HAD ON ITS LAST RENDER BEFORE
 *  REMOVAL, SO A DIRECTION PASSED AS A PLAIN PROP NEVER REACHES IT (2026-09-19).
 *
 *  This used to be `exit={{ x: exitDirection === 'left' ? -600 : 600 }}` with
 *  `exitDirection` a prop from the gesture hook's state. The drag path worked
 *  only because the hook set that state BEFORE dispatching, which forced one
 *  re-render with the new prop and then removed the card. A keyboard advance
 *  changes the index and removes the card in the SAME render, so the outgoing
 *  card never sees a fresh prop -- it animates with the stale one.
 *
 *  `custom` is Motion's answer: the presence context carries it to the child
 *  being removed on the very render that removes it, and the exit type resolves
 *  its target through `presenceContext.custom` rather than through the child's
 *  own props. So `CardStack` computes the movement from the index delta
 *  (`deckMovementFor`) and hands it to `<AnimatePresence custom>`, and this
 *  function reads it. Motion also refuses to re-resolve an exit that is already
 *  running, so a year landing mid-flight cannot redirect the card.
 *
 *  THE ENTRANCE BELOW IS THE OPPOSITE CASE and takes the opposite route -- see
 *  `movement` in `CardProps`. `custom` reaches ONLY the exit resolution
 *  (motion-dom's `animation-state.mjs` passes `presenceContext.custom` when
 *  `type === "exit"` and `undefined` otherwise), and the first-paint inline
 *  style is built by `use-visual-state.mjs` with no custom at all -- so an
 *  `initial` written as a dynamic variant would paint one frame in the WRONG
 *  branch. The incoming card is rendered fresh on the render that brings it in,
 *  so a plain prop is both available and correct for it.
 *
 *  The typed route is `variants` + `exit="exit"`: the `exit` prop's type does
 *  not admit a function, `Variant` does. Exported for `Card.test.tsx`, which
 *  can pin the resolved targets and nothing more -- jsdom paints nothing.
 * ===========================================================================
 *
 * ===========================================================================
 *  THE TWO MOVEMENTS ARE NO LONGER MIRROR IMAGES (2026-09-21). READ THIS
 *  BEFORE COLLAPSING THEM BACK INTO ONE SIGNED `x`.
 *
 *  They were: `forward` threw the card to +600, `backward` threw it to -600.
 *  Both therefore looked like the SAME event -- a card leaves, another is
 *  simply there -- and only the side of the screen it left by told you which
 *  had happened. That is the defect the developer reported: "la animacion de
 *  carta anterior tiene la misma animacion que la de siguiente".
 *
 *  A step back is now the deal PLAYED IN REVERSE. Forward is unchanged: the
 *  card flies off to the right, over the card it uncovers. Backward does not
 *  throw anything -- the card being returned to comes back IN from off the
 *  right edge, the way it left, and lands on top of a current card that simply
 *  stays put. So this variant handles only HALF of the backward animation. The
 *  visible half is the entrance, and it is an `initial`, not an `exit`.
 *
 *  What the backward branch below has to do is get the outgoing card OUT OF
 *  THE WAY WITHOUT MOVING IT: settle it back to x = 0 (it is wherever the drag
 *  left it) and drop it under the incoming card with `zIndex`. `popLayout`
 *  absolutises it, and a positioned element paints above in-flow content, so
 *  without the z-index the returning card would slide in UNDERNEATH the one it
 *  is supposed to be replacing -- the animation would run and look like
 *  nothing at all. See `BEHIND_INCOMING_Z_INDEX`.
 *
 *  `zIndex` is set with `{ type: false }` rather than animated: its computed
 *  value is the string `auto`, which has no numeric origin to interpolate
 *  from. Motion's `animateMotionValue` short-circuits a `type: false`
 *  transition to the final keyframe without reading the origin, which is
 *  exactly the write we want. It is spelled out on BOTH branches so the two
 *  resolve to the same shape -- a union with a missing key is a property
 *  access the tests cannot make.
 * ===========================================================================
 *
 * Total over `undefined`: a `Card` rendered outside any `AnimatePresence` (every `Card.test.tsx`
 * render) has no `custom`, and it must not throw for it. Forward is the deal, and the default.
 */
export const CARD_VARIANTS = {
  exit: (movement: DeckMovement | undefined) =>
    movement === 'backward'
      ? {
          // Settles back to the deck's centre from wherever the drag left it, and goes under.
          x: 0,
          opacity: 1,
          zIndex: BEHIND_INCOMING_Z_INDEX,
          transition: { duration: EXIT_DURATION_S, zIndex: { type: false } },
        }
      : {
          x: EXIT_DISTANCE_PX,
          opacity: 0,
          // Above the card it uncovers, which is what `popLayout` already gives it.
          zIndex: 0,
          transition: { duration: EXIT_DURATION_S, zIndex: { type: false } },
        },
} satisfies Variants;

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
   * A ref to the card's OUTER element, and it is not a convenience -- the deck's exit animation
   * is broken without it.
   *
   * ===========================================================================
   *  `AnimatePresence mode="popLayout"` REACHES THE OUTGOING CARD THROUGH THIS
   *  REF, AND IT FAILS SILENTLY WHEN THERE IS NONE.
   *
   *  `CardStack` uses `popLayout` so a committed card is taken OUT OF LAYOUT FLOW
   *  while it flies off, leaving the next card the flow slot it is vacating.
   *  Motion implements that by cloning its child with a ref of its own
   *  (`PopChild`), measuring the element in `getSnapshotBeforeUpdate`, and
   *  injecting a `position: absolute` rule for it in a `useInsertionEffect`.
   *
   *  Every one of those steps is guarded by `ref.current`. This component was a
   *  plain function component that accepted no ref, so the clone's ref landed on
   *  nothing, `ref.current` stayed null, and the effect returned early: the card
   *  was NEVER popped. Both cards then sat in normal flow -- the outgoing one at
   *  the top of the stack, the incoming one a full card-height BELOW it, off the
   *  bottom of the deck and usually off the screen -- until the exit finished and
   *  the incoming card snapped up into place. That is the "the next card rises
   *  from below the screen" bug, and there was no error anywhere: `popLayout` was
   *  configured, documented, and doing nothing.
   *
   *  Accepting the ref also restores the PAINT order the animation needs. Once
   *  popped, the outgoing card is a positioned element and so paints in a later
   *  layer than the in-flow card beneath it -- which is what makes the next card
   *  appear BEHIND the one sliding away rather than over it. Explicit z-indexes
   *  are not needed and would be the wrong fix.
   *
   *  React 19 passes `ref` to function components as an ordinary prop, so no
   *  `forwardRef` is involved. `Card.test.tsx` pins that the ref reaches the
   *  outer element; that it then makes `popLayout` work is browser behaviour no
   *  test in this repo can reach, because jsdom computes no layout and Motion's
   *  measurement bails on a `getComputedStyle().height` of `auto`.
   * ===========================================================================
   */
  ref?: Ref<HTMLDivElement>;
  /**
   * Which way the deck moved to put this card here -- the ENTRANCE half of the animation.
   *
   * ===========================================================================
   *  A PLAIN PROP, DELIBERATELY, WHERE THE EXIT IS `AnimatePresence custom`.
   *  THE ASYMMETRY IS CORRECT AND IT IS NOT AN OVERSIGHT (2026-09-21).
   *
   *  The two channels answer two different questions. An EXITING card is being
   *  removed on the render that decides the movement, so it can only ever read
   *  a prop from BEFORE that decision -- hence `custom`, which Motion routes
   *  through the presence context to the child it is removing. An INCOMING
   *  card is mounted BY that same render, so its props are already the fresh
   *  ones, and `custom` is the channel that does NOT reach it: motion-dom
   *  resolves `presenceContext.custom` only for `type === "exit"`, and the
   *  first-paint inline style comes from framer-motion's `makeLatestValues`,
   *  which resolves `initial` with no custom whatsoever. An `initial` written
   *  as a dynamic variant would therefore paint its first frame at x = 0 and
   *  only then jump to 600 -- a flash of the card at rest before it flies out
   *  to come back in.
   *
   *  `CardStack` hands the same latched value to both channels, so they cannot
   *  disagree.
   * ===========================================================================
   *
   * Optional, because a `Card` outside a deck (every `Card.test.tsx` render) has no movement to
   * speak of. Absent behaves as `forward`: mounted where it belongs, with nothing to animate.
   */
  movement?: DeckMovement;
}

export function Card({ card, isFlipped, isYearPending, gestureProps, movement, ref }: CardProps) {
  /*
    The entrance, and it exists for ONE of the two movements.

    Forward deals a card into a slot the outgoing card is vacating -- it is already where it
    belongs, and animating it would be inventing motion the player did not ask for. Backward
    UNDEALS: the card comes back from off the right edge, exactly as far away as a thrown card
    goes, so the two halves of a step read as one action reversed.

    `AnimatePresence initial={false}` in `CardStack` does not disable this. Framer Motion renders
    `<PresenceChild initial={!isInitialRender.current || initial}>`, so the flag blocks only the
    session's FIRST card -- which is the one that must not animate in, because nothing dealt it.

    Under `prefers-reduced-motion` the card does not crawl in and does not get stuck off-screen
    either: `MotionConfig reducedMotion="user"` makes motion-dom pass `{ type: false }` for
    positional keys, so `x` JUMPS from 600 to 0 on the first frame. Same treatment the exit gets
    (see `EXIT_DURATION_S`), and it has to be checked in a browser -- jsdom has no media queries.
  */
  const entersFromOffscreen = movement === 'backward';

  return (
    /*
      `touch-none` is `touch-action: none`, and on a touch device it is the difference between
      a working swipe and no swipe at all: without it the browser claims the gesture for its
      own scroll handling and Motion never sees the pointer move. Paired with the
      `overscroll-behavior: none` in `src/index.css`, which stops the vertical component of a
      swipe from triggering pull-to-refresh.
    */
    <motion.div
      // The OUTER element, which is the one `popLayout` has to be able to measure and absolutise.
      ref={ref}
      className="perspective-distant h-(--card-height) w-(--card-width) touch-none"
      {...gestureProps}
      /*
        `initial` is a plain object and `animate` is a constant target, both by design.

        Motion compares RESOLVED VALUES, not object identity, so `animate` re-resolving to the
        same `x: 0` on every render starts no animation -- which is what keeps this clear of the
        drag. The drag writes the `x` motion value directly and `dragConstraints: {left: 0,
        right: 0}` is what snaps it back; this target agrees with that snap-back rather than
        competing with it.
      */
      initial={entersFromOffscreen ? { x: EXIT_DISTANCE_PX } : undefined}
      animate={{ x: 0, transition: { duration: EXIT_DURATION_S } }}
      // The movement comes from `AnimatePresence custom`, not from a prop -- see `CARD_VARIANTS`.
      variants={CARD_VARIANTS}
      exit="exit"
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
        {/*
          The hidden face stays mounted throughout -- a 3D flip needs both faces to exist.

          `card-ring` is Phase 8's neon ring and it goes on EACH FACE rather than on the outer
          element, which is the only place it can go: the outer element is the perspective
          container and does not rotate, so a ring there would sit still while the card turned
          inside it. On the faces it is `backface-hidden` like everything else, so the bloom flips
          with the card and only the front face's glow is ever visible.

          `absolute` is load-bearing for the ring, not just for the layout. `card-ring` sets no
          `position` on purpose -- see the long note in `src/index.css` -- so its `::before` needs
          this element to be the positioned ancestor. `Card.test.tsx` asserts the pair together.
        */}
        <div
          data-testid="card-hidden-face"
          className="card-ring absolute inset-0 overflow-hidden rounded-card bg-surface backface-hidden"
        >
          <CardHiddenSide card={card} />
        </div>

        <div
          data-testid="card-reveal-face"
          className="card-ring absolute inset-0 overflow-hidden rounded-card bg-surface-raised backface-hidden rotate-y-180"
        >
          {isFlipped ? <CardRevealSide card={card} isYearPending={isYearPending} /> : null}
        </div>
      </div>
    </motion.div>
  );
}
