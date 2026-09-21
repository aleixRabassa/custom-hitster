/**
 * The deck as the player sees it: the current card, draggable, directly over the next card --
 * which is the same size, exactly behind, and therefore invisible until the top card moves.
 *
 * Owns four things and nothing else -- WHEN a card leaves (presence and keying), HOW THE DECK
 * MOVED (the index delta, handed to both animation channels -- see `DeckMovementLatch`), WHERE A
 * DRAGGED STEP BACK GOT TO (`dragEntrance`, the handoff between the peek and the real card), and
 * the gesture wiring all of that needs. How a card looks and how its own element moves stay in
 * `Card`.
 *
 * ===========================================================================
 *  IT RENDERS THREE CARD FACES FROM CARD 2 ON, NOT TWO (2026-09-21).
 *
 *  The current card, the NEXT card's hidden face behind it (the preload, see
 *  below), and -- new -- the PREVIOUS card's hidden face parked one card-width
 *  off to the right, which a left drag pulls in one for one with the finger.
 *  All three are `CardHiddenSide` except the card in play, so the leak rule is
 *  unchanged and `CardStack.test.tsx` audits both extra faces the same way.
 * ===========================================================================
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

import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useState } from 'react';

import { Card } from './Card';
import { CardHiddenSide } from './CardHiddenSide';
import { useCardGestures } from '../hooks/useCardGestures';
import { deckMovementFor } from '../game/gestures';
import type { DeckMovement } from '../game/gestures';
import type { Card as CardData } from '../../shared/types';

/**
 * The `AnimatePresence` key for the card in play: WHICH CARD IT IS, never where it sits.
 *
 * ===========================================================================
 *  THIS USED TO BE `${card.id}:${currentIndex}` AND THAT KEYED THE EXIT
 *  ANIMATION TO THE YEAR CRAWL. DO NOT PUT THE INDEX BACK.
 *
 *  A lookup that finds no year REMOVES its card from the deck (`gameReducer`,
 *  `YEAR_RESOLVED`), and when the dropped card sat BEHIND the player the
 *  reducer shifts `currentIndex` back so the player keeps looking at the same
 *  card. Nothing the player can see has changed -- but a key built from the
 *  index changed, so `AnimatePresence` saw one child leave and another arrive:
 *  the card flew 600px off the screen and an IDENTICAL card took its place,
 *  in whichever direction the last swipe happened to set. Mid-game, on a real
 *  playlist where roughly a third of the cards resolve yearless, that fires
 *  every few seconds and reads as the deck sliding away on its own.
 *
 *  The occurrence ordinal is what replaces the index, and it is stable across
 *  exactly the thing the index was not: `YEAR_RESOLVED` drops EVERY card
 *  carrying the resolved id, never one copy of it. So if the current card is
 *  still here, no card sharing its id was dropped, and the number of them in
 *  front of it cannot have changed. A drop anywhere else in the deck leaves
 *  this string untouched, which is the whole point.
 *
 *  It still does the job the index was added for -- see the duplicate-id test
 *  in `CardStack.test.tsx`. A playlist may hold the same track twice, so two
 *  ADJACENT cards can share an id, and a key of the bare id would let React
 *  reuse one element for both: advancing from copy A to copy B would be a
 *  no-op with no exit animation, and the flip state could survive the advance
 *  and hand the player the answer. Two copies of one id are `X:0` and `X:1`.
 * ===========================================================================
 */
function cardPresenceKey(deck: CardData[], currentIndex: number, currentCard: CardData): string {
  let occurrence = 0;

  for (let index = 0; index < currentIndex; index += 1) {
    if (deck[index]?.id === currentCard.id) occurrence += 1;
  }

  return `${currentCard.id}:${occurrence}`;
}

/**
 * What the stack remembers between renders so it can say which way the deck MOVED.
 *
 * ===========================================================================
 *  THE MOVEMENT IS DERIVED FROM THE INDEX DELTA AND LATCHED IN STATE
 *  (2026-09-19). READ THIS BEFORE MOVING IT INTO A REF OR BACK INTO THE HOOK.
 *
 *  It used to be `useCardGestures` state, set by a drag and defaulting to
 *  `left`. Once a left swipe meant PREVIOUS that told three lies -- every
 *  keyboard advance flew out the "back" way, an ArrowLeft after a right swipe
 *  flew the card out the "advance" way, and a declined step back on card 1
 *  latched `left`. The delta cannot lie: a right throw calls `onNext`, the
 *  index rises, the deck moved forward. Drag and keyboard agree by construction.
 *
 *  Why STATE and not a ref: the previous index has to be READ during render
 *  (the value goes into a prop), and a ref read during render is what the
 *  `react-hooks/refs` rule forbids. The sanctioned shape is "store what the
 *  previous render knew in state and adjust it when the props disagree" --
 *  the guarded `setState` below, which React applies before committing.
 *
 *  Why the PRESENCE KEY and not the index alone: an exit fires exactly when
 *  the key changes, and the two can move apart. A yearless card dropped from
 *  BEHIND the player lowers the index under the SAME card (see
 *  `cardPresenceKey`) -- no exit, but an index-only latch would record
 *  `backward` and hand it to the next card that does leave. And the CURRENT
 *  card being dropped changes the key with the index unchanged -- an exit with
 *  no delta, which `deckMovementFor` resolves to `forward` because the deck
 *  moved on. So the movement is recomputed only when the key changes, from the
 *  last index the stack saw, and the stored index tracks every change.
 *
 *  The latch is also why a re-render mid-flight is harmless: the movement does
 *  not change until the next card leaves, and Motion in any case refuses to
 *  re-resolve an exit that is already running.
 * ===========================================================================
 *
 * ===========================================================================
 *  SINCE 2026-09-21 THE LATCHED VALUE FEEDS TWO CHANNELS, NOT ONE, AND THEY
 *  MUST BE THE SAME VALUE.
 *
 *  A backward step is now the deal played in reverse: the outgoing card settles
 *  under the incoming one (the exit, via `AnimatePresence custom`) while the
 *  incoming one flies back in from off the right edge (the entrance, via
 *  `Card`'s `movement` prop). Two channels because Motion only routes `custom`
 *  to the child it is REMOVING -- `Card`'s `movement` doc block has the full
 *  reasoning. Feed them from two different expressions and a step back becomes
 *  half an animation, which looks like a bug in whichever half you did not
 *  change.
 * ===========================================================================
 */
interface DeckMovementLatch {
  /** The `AnimatePresence` key the stack last rendered. */
  key: string;
  /** The `currentIndex` the stack last rendered. */
  index: number;
  /** How the card that last left went -- what both animation channels carry. */
  movement: DeckMovement;
}

export interface CardStackProps {
  /** The shuffled deck, straight from `GameState.deck`. */
  deck: CardData[];
  /** Index of the current card, straight from `GameState.currentIndex`. */
  currentIndex: number;
  isFlipped: boolean;
  isYearPending: boolean;
  onFlip: () => void;
  /** A right swipe. */
  onNext: () => void;
  /** A left swipe -- the card before this one (2026-09-18). */
  onPrevious: () => void;
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
  onPrevious,
  isEnabled,
}: CardStackProps) {
  /**
   * The card a left drag pulls in, or `undefined` on card 1.
   *
   * Rendered UNCONDITIONALLY when it exists, and kept off the screen by `display: none` rather
   * than by a conditional -- mounting it mid-gesture is what a conditional would mean, and the
   * flag that decided it would have to be set from the per-frame drag handler. See
   * `PreviousCardStyle.display`.
   *
   * It is a card the player has already played, so there is nothing here to leak: it renders
   * `CardHiddenSide` for the same reason the back does, and the same test covers both. Its QR is
   * normally a cache hit (it was generated when this card was the current one, and again as the
   * back behind it), with one exception worth knowing: after a `RESUME` mid-deck nothing has
   * rendered it this page, so the first drag back can catch the placeholder. Off-screen, and one
   * `toDataURL()` later it is warm for the rest of the session.
   */
  const previousCard = deck[currentIndex - 1];

  /**
   * The presence key that card will render under once a step back lands, or `null` on card 1.
   *
   * Computed here rather than inside `handlePrevious` so the callback can depend on a STRING
   * instead of on `deck`. `YEAR_RESOLVED` hands this component a new `deck` array on every
   * resolved year, and a `deck` dependency would rebuild `handlePrevious`, `gestureProps` and
   * all six handlers on each one -- dozens of times over a cold 50-track crawl, while the
   * player is dragging. The key only changes when the previous card actually changes, which is
   * the thing the handoff is keyed on anyway (`PREVIOUS` is exactly `currentIndex - 1` over the
   * same deck -- see `gameReducer`).
   */
  const previousPresenceKey = previousCard
    ? cardPresenceKey(deck, currentIndex - 1, previousCard)
    : null;

  /**
   * What a committed drag left behind: which card it was, and how far the finger got.
   *
   * Keyed on the PRESENCE KEY the returned-to card will render under, and cleared in the same
   * render-phase guard that latches the movement below -- on the first card change that is not
   * the one it was recorded for. Letting it merely go stale is NOT enough: the key is the same
   * string every time the deck is on that card, so a later ArrowLeft back onto it would inherit
   * a thumb position from a drag two moves ago. The guard is the sanctioned shape for this
   * (adjust state during render when the props disagree); an effect would be the
   * `set-state-in-effect` this repo's lint rejects.
   */
  const [dragEntrance, setDragEntrance] = useState<{ key: string; fromProgress: number } | null>(
    null,
  );

  /*
    The handoff's other end. `useCardGestures` reports how far it had pulled the previous card
    in; this records it against the key that card is ABOUT to be rendered under, and then lets
    the step back happen exactly as it always did. `onPrevious` upward stays a bare `() => void`,
    so nothing outside the deck learns that a gesture has a position.
  */
  const handlePrevious = useCallback(
    (fromProgress: number) => {
      if (previousPresenceKey !== null) {
        setDragEntrance({ key: previousPresenceKey, fromProgress });
      }

      onPrevious();
    },
    [onPrevious, previousPresenceKey],
  );

  const { gestureProps, deckRef, previousCardStyle } = useCardGestures({
    onFlip,
    onNext,
    onPrevious: handlePrevious,
    hasPrevious: previousPresenceKey !== null,
    isEnabled,
  });

  const currentCard = deck[currentIndex];
  const presenceKey = currentCard ? cardPresenceKey(deck, currentIndex, currentCard) : null;

  // See `DeckMovementLatch`. Dealing is the default, and nothing has left yet.
  const [lastMove, setLastMove] = useState<DeckMovementLatch>({
    key: presenceKey ?? '',
    index: currentIndex,
    movement: 'forward',
  });

  const deckMovement =
    presenceKey !== null && presenceKey !== lastMove.key
      ? deckMovementFor(lastMove.index, currentIndex)
      : lastMove.movement;

  if (presenceKey !== null && (presenceKey !== lastMove.key || currentIndex !== lastMove.index)) {
    // Guarded, so React re-renders once with the new value before committing rather than looping.
    setLastMove({ key: presenceKey, index: currentIndex, movement: deckMovement });

    /*
      And the drag's recorded entrance is spent HERE, on the first card change that is not the
      one it was recorded for.

      Letting it simply go stale is not enough, and the reason is a sequence a session actually
      produces: drag back from card 5 to card 4, press ArrowRight to 5, press ArrowLeft to 4.
      The presence key is the same string both times -- same id, same occurrence -- so the
      KEYBOARD step back would mount at the thumb's old position instead of coming the full
      distance. The card would appear a third of the way in and barely move.

      The commit's own render is not affected: it arrives with the key the entry names, so the
      condition below is false and the entry survives exactly the one render that needs it.
      Reachable only through a real drag, so nothing in jsdom can catch it going wrong again.
    */
    if (dragEntrance !== null && dragEntrance.key !== presenceKey) setDragEntrance(null);
  }

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
  if (!currentCard || presenceKey === null) return null;

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
    <div
      /*
        The ref is the 1:1 drag mapping's only input from the DOM: `useCardGestures` reads this
        element's `offsetWidth` once per gesture, because `--card-width` is a `clamp()` and no
        constant in JS could be right at every viewport. See `UseCardGesturesResult.deckRef`.
      */
      ref={deckRef}
      className="relative isolate h-(--card-height) w-(--card-width)"
    >
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
            this face holds a QR whose `alt` is the same generic "Scan to play in Spotify" as the
            card in front of it, and announcing it twice per card says nothing about either.
            Sighted players get the preload; nobody gets a second copy of the same sentence.

            It used to be TWO duplicated strings -- the caption "Scan to play the full song" was on
            this face as well until 2026-08-11, when it moved out to sit below the card. That half of
            the duplication is now structurally gone rather than hidden, which is the better fix;
            this attribute still earns its place for the `alt`.
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

        `custom` is HOW THE MOVEMENT REACHES THE OUTGOING CARD, and a prop on `Card` cannot
        do the job: an exiting child animates with the props of its last render before removal,
        and a keyboard advance changes the index and removes the card in the same render. The
        presence context carries `custom` to the child on the render that removes it, and the
        card's exit variant reads it -- see `CARD_VARIANTS` in `Card.tsx` and the latch above.

        The `movement` PROP below is the same value taking the other road, and the two are not
        interchangeable: `custom` reaches only the child being REMOVED, and the incoming card
        needs the movement to know whether to fly back in from off-screen. One expression feeds
        both, which is the only thing keeping the two halves of a step back in agreement.

        `initial={false}` still blocks the SESSION'S FIRST card from animating in -- it is
        already there when the screen mounts, and nothing dealt it. It does not block the rest:
        framer-motion renders `<PresenceChild initial={!isInitialRender.current || initial}>`,
        so every later entrance is live. That is what the backward animation rides on.
      */}
      <AnimatePresence initial={false} mode="popLayout" custom={deckMovement}>
        <Card
          // Identity, not position -- see `cardPresenceKey`. An index here is what made a
          // resolved year elsewhere in the deck throw the player's own card off the screen.
          key={presenceKey}
          card={currentCard}
          isFlipped={isFlipped}
          isYearPending={isYearPending}
          onFlip={onFlip}
          gestureProps={gestureProps}
          movement={deckMovement}
          entranceFromProgress={
            dragEntrance?.key === presenceKey ? dragEntrance.fromProgress : undefined
          }
        />
      </AnimatePresence>

      {/*
        ===========================================================================
         THE CARD A LEFT DRAG PULLS IN, AND IT IS THE LAST CHILD ON PURPOSE.

         A step back is now performed by the finger rather than played on
         release (2026-09-21): the current card is pinned at its resting
         position (`dragElastic.left` is 0) and every pixel of leftward travel
         moves THIS element instead, one for one, from one card-width out to
         home. On release the real `Card` mounts in its place and finishes
         whatever is left -- see `handlePrevious` above.

         Last in DOM order because it has to land ON TOP. The current card is in
         flow and this one is positioned, so source order is what puts it above;
         `z-10` says so out loud, inside the wrapper's own `isolate` so it can
         reach nothing outside the deck. Being above is the entire illusion --
         underneath it, the animation runs and looks like nothing at all, which
         is the same failure `BEHIND_INCOMING_Z_INDEX` in `Card.tsx` exists to
         prevent from the other side.

         `card-ring` full and NOT `card-ring-quiet`: unlike the back, this face
         is never covered by the card in front of it, so there are no two blooms
         to composite. It is a card arriving at the front of the deck and has to
         look like one.

         `pointer-events-none` because the drag belongs to the card underneath.
         A pointer-up landing on this element instead would be judged as a tap
         on nothing, and the QR image inside could start a native image drag.
         `aria-hidden` for the reason the back carries it: a screen reader would
         otherwise get a second copy of the same generic QR `alt`, mid-gesture.
        ===========================================================================
      */}
      {previousCard ? (
        <motion.div
          data-testid="card-previous-peek"
          aria-hidden="true"
          style={previousCardStyle}
          className="card-ring pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-card bg-surface"
        >
          <CardHiddenSide card={previousCard} />
        </motion.div>
      ) : null}
    </div>
  );
}
