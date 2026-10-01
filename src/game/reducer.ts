/**
 * `gameReducer` and the derived selectors: the whole of the game's state logic, and all of it
 * pure -- with ONE known, accepted exception: `START` calls `generateSeed()` when the action
 * carries no seed (see that branch).
 *
 * Nothing here fetches, sleeps, or knows that a resolver exists. The reducer is a SINK for
 * lookups (`YEAR_RESOLVED`) and never a driver of them, which is what lets the entire
 * transition table -- including the card-1 gate that Start hangs on -- be asserted in
 * `reducer.test.ts` with no clock, no network and no React.
 *
 * Two rules hold throughout:
 *
 *   1. **Never mutate.** Every branch returns either a new object or the SAME REFERENCE.
 *   2. **An inapplicable action is a no-op, not a throw.** A `YEAR_RESOLVED` landing after
 *      `END` is normal -- the resolver is asynchronous and the player can Exit mid-lookup.
 *      Returning the identical reference is what keeps that free of re-renders.
 */

import { generateSeed, shuffleDeck } from './shuffle';
import type { GameAction, GameState, YearResolvedAction } from './types';
import type { Card } from '../../shared/types';

/** A session that has not started. Phase 6's landing screen renders against this. */
export const initialGameState: GameState = {
  status: 'idle',
  playlists: [],
  seed: '',
  deck: [],
  currentIndex: 0,
  startIndex: 0,
  isFlipped: false,
  keepYearless: false,
  skipUnconfirmed: false,
  yearLookupsUnavailable: false,
};

/** The two deal options that decide whether a FINAL answer removes its card. */
interface DropRules {
  keepYearless: boolean;
  skipUnconfirmed: boolean;
}

/**
 * Whether a card that already holds an answer is out of this session's deck -- the ONE rule
 * `START`, `RESUME` and `YEAR_RESOLVED` all apply, so the three entry points cannot disagree.
 *
 * - A final `null` is dropped unless the session keeps yearless cards (reversal 2026-08-05).
 * - A final year at `low` -- one no second provider confirmed -- is dropped when the session skips
 *   unconfirmed years (2026-10-01). NOT one marked `yearUnverified`: that year was never put to a
 *   second provider (verify ran out of retries and none came back with a year -- typically no
 *   connection), so it is unchecked
 *   rather than unconfirmed, and dropping it would delete cards for a network blip, permanently
 *   (the deck, the save and Restart all lose it).
 *
 * ONLY A FINAL ANSWER COUNTS, and the `yearProvisional` check is load-bearing: a provisional year is
 * always `low`, and Restart re-deals `state.deck` through `START`, so a confidence-only test would
 * make every card still awaiting `verify` vanish on a restart. A pending card (`year` undefined)
 * has nothing to judge yet.
 */
function isDroppedAnswer(
  card: Pick<Card, 'year' | 'yearConfidence' | 'yearProvisional' | 'yearUnverified'>,
  rules: DropRules,
): boolean {
  if (card.yearProvisional === true || card.year === undefined) return false;
  if (card.year === null) return !rules.keepYearless;
  if (card.yearUnverified === true) return false;

  return rules.skipUnconfirmed && card.yearConfidence === 'low';
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START': {
      // Shuffled HERE, synchronously, before anything can look at the deck -- see the block
      // comment in `shuffle.ts` for why the alternative ordering wastes the first lookup.
      //
      // `generateSeed()` here is the one impure call in this file, and it is ACCEPTED rather than
      // fixed (review of the shuffle system, 2026-09-29, §3 "Minor"). StrictMode calls a reducer
      // twice in development and each call draws a different seed, but the seed and the deck it
      // dealt come out of the same call and land as ONE state object, so nothing can observe a
      // mismatch. Moving it into `start()` would restore purity at the cost of a second place
      // that knows what an absent seed means.
      const seed = action.seed ?? generateSeed();

      /*
        Yearless cards are filtered at ALL THREE entry points -- here, `YEAR_RESOLVED` and
        `RESUME` -- so, WHILE THE SESSION DROPS THEM (`keepYearless` false), "no card in a live
        deck holds `year: null`" is an invariant rather than a tendency (see `GameState.deck`).
        A session that keeps them (plan.year-fetch-rework-game.md) filters nothing anywhere: a
        final null is a card it chose to keep.

        This one is the belt to the other two's braces: `action.cards` comes either from
        `/api/playlist`, where no card has a year yet, or from `state.deck` on a Restart, which
        the other two branches have already cleaned. It costs one pass over a hundred cards once
        per game and removes the question entirely.
      */
      const deck = shuffleDeck(
        action.cards.filter((card) => !isDroppedAnswer(card, action)),
        seed,
      );

      // Nothing left to deal. Reachable two ways -- an empty `cards` argument, and (only while the
      // session drops cards) a deck whose every card already held an answer `isDroppedAnswer` drops --
      // and `preparing` would be a loading screen waiting on a lookup that can never be
      // dispatched.
      if (deck.length === 0) {
        return {
          status: 'ended',
          playlists: action.playlists,
          seed,
          deck,
          currentIndex: 0,
          startIndex: 0,
          isFlipped: false,
          keepYearless: action.keepYearless,
          skipUnconfirmed: action.skipUnconfirmed,
          yearLookupsUnavailable: false,
        };
      }

      /*
        Where the player starts. Card 1 for every deal except one from a shared mid-game link
        (decision D3, 2026-09-29), whose `card` param names the TRACK the sender was on -- an id,
        never an index, because the sender's deck has already shrunk by its yearless cards and the
        recipient's has not.

        An id that is not in this deck (the playlist changed since it was shared, or that card was
        already known yearless and filtered above) falls back to card 1 rather than failing the
        deal: the order is still the sender's, only the position is lost. `startIndex` starts equal
        to `currentIndex`, and only `PREVIOUS` lowers it.
      */
      const startIndex =
        action.startCardId === undefined
          ? 0
          : Math.max(
              0,
              deck.findIndex((card) => card.id === action.startCardId),
            );

      // =======================================================================
      //  THE GATE IS SKIPPED WHEN THE START CARD'S ANSWER IS ALREADY FINAL --
      //  AND ALWAYS WHEN THE SESSION CAN DROP NOTHING (see the end of this block).
      //
      //  The gate waits for the CURRENT card's answer to be FINAL -- card 1 for
      //  every deal except one from a mid-game link, which starts the player on
      //  the sender's card (2026-09-29; see the `YEAR_RESOLVED` gate below).
      //  `yearStateOf()` is the one reading of that: a number without
      //  `yearProvisional`, or a (kept) null. When the start card already holds
      //  one there is nothing to wait for, and `preparing` would be a screen
      //  shown until the heat death of the universe.
      //
      //  This is not hypothetical: Phase 6's RESTART re-deals `state.deck`, and a
      //  session can only have left `preparing` in the first place BECAUSE its
      //  start card's answer arrived, so a re-dealt deck is mostly resolved. The
      //  resolver correctly skips already-final cards, which means no
      //  `YEAR_RESOLVED` is ever dispatched for them and nothing else can open
      //  the gate. Restart hung on the loading screen, every time, until this
      //  branch existed. Found 2026-08-05 by `App.test.tsx`'s restart test; it
      //  was unreachable before Phase 6 because nothing could deal a
      //  pre-resolved deck.
      //
      //  PROVISIONAL IS NOT FINAL (plan.year-fetch-rework-game.md). A re-dealt
      //  deck whose start card is still awaiting `verify` STAYS in `preparing`:
      //  the resolver sends that card straight to verification, and its final
      //  answer -- which may still drop it -- is what opens the gate.
      //
      //  WHEN THE SESSION CAN DROP NOTHING, NOTHING GATES AT ALL. The gate exists
      //  so the player never lands on a card that is about to be dropped; a
      //  session that keeps yearless cards AND keeps unconfirmed years drops
      //  nothing, so it starts at once and the year slot shows its pending state
      //  like on any card the crawl has not reached. `keepYearless` alone is not
      //  enough since 2026-10-01: with `skipUnconfirmed`, the start card's
      //  provisional year may still settle at `low` and take it away.
      // =======================================================================
      const dropsNothing = action.keepYearless && !action.skipUnconfirmed;
      const status =
        dropsNothing || yearStateOf(deck[startIndex]) === 'final' ? 'playing' : 'preparing';

      // A wholesale replacement, deliberately: starting a new SET OF PLAYLISTS mid-game must not
      // merge into the old deck, keep the old index, or leave a stale `yearLookupsUnavailable`
      // from a previous deployment state. The merge that produced `action.cards` happened above
      // this reducer, in `deck-merge.ts`; nothing here folds two decks together.
      return {
        status,
        playlists: action.playlists,
        seed,
        deck,
        currentIndex: startIndex,
        startIndex,
        isFlipped: false,
        keepYearless: action.keepYearless,
        skipUnconfirmed: action.skipUnconfirmed,
        yearLookupsUnavailable: false,
      };
    }

    case 'YEAR_RESOLVED': {
      // Late callbacks are expected, not exceptional: `stop()` guarantees no callback fires
      // after teardown, but a result already in flight when the reducer moved on has nowhere
      // useful to go.
      if (state.status !== 'preparing' && state.status !== 'playing') return state;

      // The `resolve` stage's answer, still awaiting `verify`. Its own function, because it can
      // never drop a card, never move an index and never open the gate -- see there.
      if ('provisional' in action) return recordProvisionalYear(state, action);

      // =======================================================================
      //  A FINAL "NO YEAR" REMOVES ITS CARD FROM THE DECK -- UNLESS THE SESSION
      //  KEEPS YEARLESS CARDS.
      //
      //  `keepYearless` (plan.year-fetch-rework-game.md, spike §12.8) is the
      //  picker's opt-out from everything below: with it on, a final null is
      //  recorded as `year: null, confidence: 'none'`, the card stays and no
      //  index moves. With it off, the rest of this block holds unchanged. And
      //  only a FINAL null ever reaches here: a `resolve` that found nothing
      //  dispatches nothing (there is no provisional null), so its card simply
      //  stays pending until `verify` answers.
      //
      //  DECISION REVERSAL, 2026-08-05, by the developer. `plan.md`'s
      //  `confidence: 'none'` follow-on had resolved the opposite way -- the card
      //  stayed and the revealed side rendered a "check this one yourself"
      //  prompt -- and this is the deliberate reversal of it, not a
      //  reinterpretation. A Hitster card is placed on a timeline BY its year;
      //  without one there is nothing to play, and the QR working is not enough
      //  to make it a card.
      //
      //  LOW CONFIDENCE IS UNAFFECTED BY THIS RULE. `low` still carries a real
      //  year and stays in the deck, flagged unconfirmed on the revealed side --
      //  UNLESS the session skips unconfirmed years (`skipUnconfirmed`,
      //  2026-10-01), a second, independent rule that removes a final `low` card
      //  exactly as this one removes a final null: same index arithmetic, same
      //  gate. Both live in `isDroppedAnswer`, which `START` and `RESUME` share.
      //
      //  Two consequences worth knowing before touching this branch:
      //
      //  1. THE DECK IS EXPECTED TO SHRINK, AND SUBSTANTIALLY. Phase 3 measured
      //     `none` on roughly a THIRD of a real 42-card playlist, so a deck of 42
      //     will settle around 28 as the crawl catches up. That is the decision
      //     working, not a bug -- but it is why the HUD's "cards left" now falls
      //     as well as rising.
      //  2. `null` DOES NOT ALWAYS MEAN "NO PROVIDER HAS A YEAR". The resolver
      //     also settles at `null` on a 400, on transient failures that survive
      //     its deferred pass, and on a card whose `verify` retries ran out with
      //     nothing found -- and `YEAR_RESOLVED` carries no reason. So
      //     a network blip drops cards. That is the honest trade: an unplayable
      //     card is unplayable whatever the cause, and the alternative -- a
      //     `reason` on the action so the reducer could keep "failed" cards --
      //     would put a yearless card back on the table, which is the thing this
      //     decision removes. The one blanket failure is already exempt:
      //     `not-configured` dispatches `YEAR_LOOKUPS_UNAVAILABLE` instead of a
      //     hundred nulls, so a deployment with no `MUSICBRAINZ_USER_AGENT`
      //     yields a yearless deck rather than an empty one. A YEAR settled the
      //     same way is different since 2026-10-01: when no verify call ever came
      //     back with a year it arrives `unverified`, and `isDroppedAnswer` keeps
      //     it even when the session skips unconfirmed years -- there is a year to
      //     play, it just could not be checked. When some verify DID answer, it is
      //     an ordinary unconfirmed year (the resolver's `verifyAnswered`).
      // =======================================================================
      // Honoured only beside a numeric `low` year -- the one shape `Card.yearUnverified` may take,
      // and the one `validateCard` accepts back from a save.
      const isUnverified =
        action.unverified === true &&
        typeof action.year === 'number' &&
        action.confidence === 'low';
      const isDropped = isDroppedAnswer(
        {
          year: action.year,
          yearConfidence: action.confidence,
          ...(isUnverified ? { yearUnverified: true as const } : {}),
        },
        state,
      );

      // BY ID, never by index (decision 13). The resolver's priority jump makes its ordering
      // and the deck's ordering diverge routinely; an index write would corrupt the deck the
      // first time it did, by stamping one card's year onto another.
      //
      // EVERY card with that id, not just the first: a playlist may legitimately contain the
      // same track twice, and the resolver looks a given id up once. Updating one copy would
      // leave the other showing a pending year for the rest of the game -- and, now, dropping
      // one copy would leave the other in the deck with no year at all.
      let matched = false;
      /** Dropped cards sitting BEFORE the current one: the amount `currentIndex` moves back by. */
      let droppedBeforeCurrent = 0;
      /** Dropped cards sitting BEFORE `startIndex`: the amount it moves back by, same rule. */
      let droppedBeforeStart = 0;
      /** Whether the card the player is looking at right now is one of the dropped ones. */
      let droppedCurrent = false;

      const deck: Card[] = [];
      state.deck.forEach((card, index) => {
        if (card.id !== action.cardId) {
          deck.push(card);
          return;
        }

        matched = true;

        if (isDropped) {
          if (index < state.currentIndex) droppedBeforeCurrent += 1;
          else if (index === state.currentIndex) droppedCurrent = true;

          if (index < state.startIndex) droppedBeforeStart += 1;

          return;
        }

        // Every other card keeps its identity, so a Phase 4 memoized card component
        // re-renders only for the one that actually changed.
        //
        // A final answer replaces a provisional one on EVERY card, the current one included --
        // even a revealed one, whose year then changes in front of the player. The flag goes with
        // it, so the card reads as final. A kept null lands here too, beside its `none`.
        const updated: Card = { ...card, year: action.year, yearConfidence: action.confidence };
        delete updated.yearProvisional;
        delete updated.yearUnverified;
        if (isUnverified) updated.yearUnverified = true;
        deck.push(updated);
      });

      // A result for a card that is not in this deck -- a callback from a session that was
      // replaced by a second `START`. Dropping it is the correct answer.
      if (!matched) return state;

      // Every card in the deck turned out to be dropped -- yearless, or (with `skipUnconfirmed`)
      // unconfirmed. Only reachable while the session drops cards, and only when every track got a
      // dropped answer, so it is rare rather than impossible -- and `ended` is the only honest
      // destination, since there is nothing left to play.
      if (deck.length === 0) {
        return {
          ...state,
          deck,
          currentIndex: 0,
          startIndex: 0,
          isFlipped: false,
          status: 'ended',
        };
      }

      /*
        The player's position, after the shrink. Cards dropped from BEHIND the player move it
        back; cards dropped from ahead of it do not touch it at all.

        When the CURRENT card is the one dropped, the unchanged index already points at the card
        that followed it -- the array closed up around it -- so the next card slides into place
        under the player. `isFlipped` must be reset with it: the flag belongs to the card that
        just left, and carrying it over would hand the new card's year straight to the player.
        That is a leak, not a cosmetic glitch.
      */
      const shifted = state.currentIndex - droppedBeforeCurrent;
      const isFlipped = droppedCurrent ? false : state.isFlipped;

      /*
        The current card was dropped and nothing followed it.

        WHILE `playing`, the deck is exhausted, exactly as `NEXT` past the last card is. Clamping
        instead would send the player BACKWARDS onto a card they have already played without their
        asking -- `PREVIOUS` exists since 2026-09-18, but it is the player's move, never the
        resolver's.

        WHILE `preparing`, it is NOT the end, and ending would be a bug (2026-09-29). The only way
        to be on the last card before the game has started is a shared mid-game link whose card
        happens to be last in this deck; if that card turns out yearless, `ended` would put "Deck
        finished" on screen for a game that never started, over a deck that still holds every other
        card. Nothing has been played, so there is nothing to protect by refusing to step back: the
        player is clamped to the new last card (the clamp below does exactly that, and `isFlipped`
        is already reset because `droppedCurrent` is set), and the gate then opens or keeps waiting
        on THAT card like on any other.
      */
      const isExhausted = droppedCurrent && shifted > deck.length - 1;

      const currentIndex = Math.min(Math.max(shifted, 0), deck.length - 1);

      // Moved back by the cards dropped before it, exactly like `currentIndex`; if the start card
      // itself was dropped, the unchanged value already points at the card that followed it. The
      // clamp keeps `startIndex <= currentIndex` through the clamp above -- a save holding a
      // `startIndex` past its `currentIndex` would be rejected by `loadSession` on the next reload.
      const startIndex = Math.min(Math.max(state.startIndex - droppedBeforeStart, 0), currentIndex);

      if (isExhausted && state.status === 'playing') {
        return { ...state, deck, currentIndex, startIndex, isFlipped: false, status: 'ended' };
      }

      // =======================================================================
      //  THE GATE: "THE CURRENT CARD'S ANSWER IS FINAL".
      //
      //  It waits for the answer for the card the player is about to see to be
      //  **FINAL** -- a provisional year is not enough, because its `verify`
      //  answer may still be null and take the card away -- and it is expressed
      //  as a property of the deck rather than as "the resolved card was the one
      //  being waited on". The two were equivalent until yearless cards started
      //  being dropped; they are not any more. When the awaited card resolves to
      //  `null` it LEAVES, and the gate has to keep waiting for whichever card
      //  takes its place, whose lookup has not happened yet.
      //
      //  Only ever open while the session can drop a card: one that keeps
      //  yearless cards and keeps unconfirmed years is never `preparing`,
      //  because its `START` goes straight to `playing`.
      //
      //  Written against the NEXT deck and the index AFTER the shrink for that
      //  reason. Reading `state.deck` would ask about a card that is no longer in
      //  the game.
      //
      //  It is `deck[currentIndex]` and no longer `deck[0]` since 2026-09-29: a
      //  shared mid-game link starts the player on the sender's card, so the card
      //  on screen when the gate opens need not be card 1 -- and waiting on card 1
      //  would either hold the loading screen for a card nobody is looking at, or
      //  open it onto a pending year. For every other deal the current card IS
      //  card 1 while `preparing` (nothing moves the index before the gate
      //  opens), so for them this is the same card-1 gate it always was.
      //
      //  It also self-heals: any final `YEAR_RESOLVED` opens the gate once the
      //  current card's answer is final, so a current card resolved out of
      //  order -- by a priority jump, or arriving already final in a re-dealt
      //  deck -- cannot leave the session stuck on the loading screen. `START`
      //  has its own version of that guard for the same reason (see above).
      // =======================================================================
      const opensGate = state.status === 'preparing' && yearStateOf(deck[currentIndex]) === 'final';
      const status = opensGate ? 'playing' : state.status;

      return { ...state, deck, currentIndex, startIndex, isFlipped, status };
    }

    case 'YEAR_LOOKUPS_UNAVAILABLE': {
      if (state.status !== 'preparing' && state.status !== 'playing') return state;

      // Transition out of `preparing` ANYWAY. A deployment with no `MUSICBRAINZ_USER_AGENT`
      // fails identically for every card, so waiting for card 1 would wait forever: the deck
      // is still playable, just yearless (Phase 6 words the notice).
      const status = state.status === 'preparing' ? 'playing' : state.status;

      return { ...state, status, yearLookupsUnavailable: true };
    }

    case 'FLIP': {
      // NEVER gated on the year having arrived. The pending state belongs to the year slot
      // alone (`isCurrentYearPending`); flip, audio, QR and Exit are always available. This
      // is the invariant `plan.md` §5 warns regresses silently.
      if (state.status !== 'playing') return state;

      return { ...state, isFlipped: !state.isFlipped };
    }

    case 'NEXT': {
      if (state.status !== 'playing') return state;

      // Past the last card the session ends, and `currentIndex` STAYS on the last card rather
      // than pointing one past the end: `currentCard()` must never be undefined for a deck
      // that has cards, or Phase 6's end screen would have nothing to show behind itself.
      if (state.currentIndex >= state.deck.length - 1) {
        return { ...state, status: 'ended', isFlipped: false };
      }

      return { ...state, currentIndex: state.currentIndex + 1, isFlipped: false };
    }

    case 'PREVIOUS': {
      /*
        ===========================================================================
         THE DECK STOPPED BEING ONE-DIRECTIONAL ON 2026-09-18, AND THIS IS THE
         WHOLE OF WHAT CHANGED BELOW REACT.

         A left swipe (and ArrowLeft) steps back to the card before this one; a
         right swipe still advances exactly as it always did. Three things to know.

         IT NEVER ENDS THE SESSION AND NEVER LEAVES THE DECK: on card 1 it is a
         no-op that returns the SAME state object, so the hook's commit latch
         fires, the reducer declines, and Motion snaps the card back to its
         constraints -- the card stays on screen because its id did not change.

         THE FLIP IS RESET, exactly as `NEXT` resets it. `isFlipped` describes the
         CURRENT card and nothing remembers which earlier cards were revealed, so
         carrying it over would hand the previous card's year straight to a
         player who never flipped it -- e.g. when `YEAR_RESOLVED` had already
         slid the deck under them. Coming back to a card the player DID reveal
         costs them one tap; that is the cheaper error.

         IT DOES NOT TOUCH THE CRAWL. Until 2026-09-29 this said every card before
         `currentIndex` already had a year; that stopped being true when a shared
         link could start the player mid-deck. Stepping back from a link's start
         card lands on a card the rotated crawl (`resolver.ts`) reaches LAST, so
         its year may well be pending. That is not a crash and needs nothing
         here: the year slot renders its pending state, exactly as it does for a
         player who outruns the crawl going forwards, and the priority jump in
         `use-game-session.ts` moves that card to the front of the queue the
         moment it becomes current. `RESUME`'s "count the yearless cards before
         the index" rule is unaffected -- it counts `null`s, and an unresolved
         card is `undefined` (a provisional one holds a number).

         IT LOWERS `startIndex` when it steps below it, which only a link-started
         game can do: that is how the end screen's count (`cardsPlayed`) learns
         about the cards the player went back to.
        ===========================================================================
      */
      if (state.status !== 'playing') return state;
      if (state.currentIndex === 0) return state;

      const currentIndex = state.currentIndex - 1;

      return {
        ...state,
        currentIndex,
        startIndex: Math.min(state.startIndex, currentIndex),
        isFlipped: false,
      };
    }

    case 'END': {
      // From `idle` there is nothing to end. Exit only exists during a session.
      if (state.status === 'idle' || state.status === 'ended') return state;

      return { ...state, status: 'ended' };
    }

    case 'RESUME': {
      // The persisted session is trusted here because `loadSession()` has already validated
      // it -- version, shape, deck non-empty, both indices in range. This branch is the one place
      // that trust is spent, which is why the validation lives in `persistence.ts` and not
      // in a `useEffect` somewhere.
      const { session } = action;

      /*
        ===========================================================================
         YEARLESS CARDS ARE DROPPED HERE TOO -- WHEN THE SAVE DROPS THEM.

         A session that KEEPS yearless cards (`keepYearless`; absent from a save
         written before the option existed, and read as false) resumes with its
         nulls exactly as it saved them, and nothing below applies. Provisional
         cards resume as they are in both modes: the resolver sends them straight
         to `verify`.

         Otherwise, since the reversal above, no card in a live deck ever holds
         `year: null` -- one is removed in the same dispatch that would have
         recorded it. A SAVE WRITTEN BEFORE THE REVERSAL is the one way such a
         card can still get in, and it would be permanent: the resolver treats
         every already-final card as done, so it is never looked up again and
         never dispatched again. The card would sit in the deck showing "year
         unknown" for the rest of that game.

         Filtering rather than bumping `SESSION_VERSION` keeps the resolved years,
         which is the whole point of persisting the deck -- a version bump would
         discard a part-crawled deck and re-spend a globally shared budget on
         lookups already paid for.

         The index has to move with the deck for the same reason it does in
         `YEAR_RESOLVED`: `loadSession()` validated it against the SAVED deck, so
         after a filter it can be off the end, and it must not be left pointing at
         a different card than the player left off on.

         What moves it is the count of DROPPED cards before it (`isDroppedAnswer`:
         a final null, or a final `low` with `skipUnconfirmed`), and only those.
         Since 2026-09-29 the cards before the index are not necessarily resolved
         -- a shared link can start the player mid-deck, and the crawl reaches the
         cards before the start card last -- but an unresolved card is
         `undefined`, is not filtered, and so moves nothing. `startIndex` moves by
         the same rule and is clamped under the new `currentIndex`, so the
         `startIndex <= currentIndex` invariant survives the filter.
        ===========================================================================
      */
      // `=== true` rather than a truthiness read: `loadSession()` already turns an absent field into
      // `false`, and this keeps a hand-built session that lacks it on the same side of the line.
      //
      // `skipUnconfirmed` (2026-10-01) filters through the same rule: a save holds its final `low`
      // cards only if it was written while they were kept, so this is normally a no-op for it too.
      const rules: DropRules = {
        keepYearless: session.keepYearless === true,
        skipUnconfirmed: session.skipUnconfirmed === true,
      };
      const deck = session.deck.filter((card) => !isDroppedAnswer(card, rules));
      const droppedBefore = (index: number): number =>
        session.deck.slice(0, index).filter((card) => isDroppedAnswer(card, rules)).length;
      const currentIndex =
        deck.length === 0
          ? 0
          : Math.min(
              Math.max(session.currentIndex - droppedBefore(session.currentIndex), 0),
              deck.length - 1,
            );
      const startIndex = Math.min(
        Math.max(session.startIndex - droppedBefore(session.startIndex), 0),
        currentIndex,
      );

      return {
        // A saved deck of nothing but yearless cards leaves nothing to resume.
        status: deck.length === 0 ? 'ended' : session.status,
        playlists: session.playlists,
        seed: session.seed,
        deck,
        currentIndex,
        startIndex,
        isFlipped: session.isFlipped,
        keepYearless: rules.keepYearless,
        skipUnconfirmed: rules.skipUnconfirmed,
        // Re-derived by the next crawl rather than restored: it describes the server's
        // configuration, not the session (see `PersistedSession`).
        yearLookupsUnavailable: false,
      };
    }
  }
}

/**
 * `YEAR_RESOLVED`'s provisional arm: a `resolve`-stage year that `verify` has not answered yet
 * (plan.year-fetch-rework-game.md step 2). The status guard has already run in the caller.
 *
 * Written onto every copy of the id, exactly like a final answer -- with `yearProvisional: true`,
 * and always at `low`, which is the only confidence the action can carry. Three things it never
 * does:
 *
 * - **Downgrade a final answer.** A copy whose answer is already final is skipped, and when that
 *   leaves nothing to write the SAME state object comes back. The two stages run in separate lanes
 *   and their order is not guaranteed after a resume or a retry, so a late provisional year is
 *   normal rather than exceptional -- and it must never un-verify a card.
 * - **Drop a card.** There is no provisional null; a `resolve` that found nothing dispatches
 *   nothing, so only a final answer can remove a card.
 * - **Move the gate.** A provisional year may still turn into a final null, so the card-1 gate
 *   keeps waiting for the final answer. No index changes, so nothing else can open it either.
 */
function recordProvisionalYear(
  state: GameState,
  action: Extract<YearResolvedAction, { provisional: true }>,
): GameState {
  let changed = false;

  const deck = state.deck.map((card): Card => {
    if (card.id !== action.cardId || yearStateOf(card) === 'final') return card;

    changed = true;

    return { ...card, year: action.year, yearConfidence: action.confidence, yearProvisional: true };
  });

  // Covers both "no card has that id" (a callback from a replaced session) and "every copy is
  // already final" with one exit.
  return changed ? { ...state, deck } : state;
}

// ===========================================================================
//  DERIVED SELECTORS
//
//  Plain functions over `GameState`, deliberately NOT fields on it. Storing
//  them would mean four more things to keep in step on every action, and the
//  failure mode of a stale derived field ("the year slot still says pending")
//  is invisible until someone plays a whole deck.
// ===========================================================================

/** The card the player is looking at. `undefined` only for an empty deck. */
export function currentCard(state: GameState): Card | undefined {
  return state.deck[state.currentIndex];
}

/**
 * Where one card's year stands (plan.year-fetch-rework-game.md). What `yearStateOf` returns.
 *
 * - `pending`:     no answer yet (`year` undefined). Nothing to show.
 * - `provisional`: a `resolve`-stage year, SHOWN, whose `verify` answer may still change it or
 *                  (with the option off) drop the card.
 * - `final`:       nothing can change it any more -- a verified or unconfirmed year, or a kept
 *                  `null`.
 */
export type YearState = 'pending' | 'provisional' | 'final';

/**
 * The one three-way reading of `Card.year` and `Card.yearProvisional`, so a switch over it is
 * exhaustive and no caller re-derives the combination. A function rather than a stored
 * `yearStatus` field for the reason this file's selectors are functions: a second stored copy of
 * the year's state is a thing that can disagree with the first.
 *
 * Takes `undefined` so the gates can ask about `deck[index]` directly; a missing card reads as
 * `pending`, which is what keeps an empty or out-of-range slot from ever opening a gate.
 */
export function yearStateOf(card: Card | undefined): YearState {
  if (card?.year === undefined) return 'pending';
  if (card.yearProvisional === true) return 'provisional';

  return 'final';
}

/**
 * Whether the current card's year has not come back yet -- the ONE thing Phase 4 renders a
 * pending state for.
 *
 * `undefined` means "not looked up"; `null` means "looked up, nothing found" and is a
 * finished answer. Collapsing the two would spin a spinner forever on a `confidence: 'none'`
 * card, which is the exact bug the three-state `Card.year` exists to prevent.
 *
 * STILL "YEAR IS UNDEFINED", AND A PROVISIONAL CARD IS NOT PENDING HERE: it has a year to show,
 * and showing it is the point of the `resolve` stage. That makes this selector and
 * `pendingYearCount` disagree about a provisional card ON PURPOSE -- see there.
 */
export function isCurrentYearPending(state: GameState): boolean {
  const card = currentCard(state);
  if (!card) return false;

  return card.year === undefined;
}

/**
 * How many cards this player has had in front of them this game: from `startIndex` to the end of
 * the deck. What the end screen reports (2026-09-29).
 *
 * `deck.length` was the old answer, and it is still exactly the answer for every deal that starts
 * on card 1 -- that is `startIndex === 0`. A game started from a shared mid-game link begins partway
 * in, and counting the cards before its start card would credit the player with cards they never
 * saw. Stepping back past the start card with `PREVIOUS` lowers `startIndex`, so those cards count
 * once they HAVE been seen.
 *
 * Meant for the end screen, i.e. after the deck ran out, which is what makes "to the end of the
 * deck" the cards played. Like every total here it shrinks with the deck as yearless cards drop --
 * when the session drops them; with `keepYearless` the deck never shrinks.
 */
export function cardsPlayed(state: GameState): number {
  return Math.max(0, state.deck.length - state.startIndex);
}

/** How many cards are still to come AFTER the current one. Zero on the last card. */
export function cardsRemaining(state: GameState): number {
  return Math.max(0, state.deck.length - state.currentIndex - 1);
}

/**
 * How many cards have a FINAL answer, a year or (kept) not.
 *
 * A provisional card is NOT counted (plan.year-fetch-rework-game.md): its year may still change,
 * so its lookup is not finished in the sense this count -- and the PDF gate built on its
 * complement -- cares about.
 *
 * Count only, on purpose: Phase 6's `preparing` progress line may show a number but must
 * never name a track or a year, which would spoil the deck it is loading.
 */
export function resolvedCount(state: GameState): number {
  return state.deck.reduce((count, card) => (yearStateOf(card) === 'final' ? count + 1 : count), 0);
}

/**
 * How many cards are still waiting on a FINAL answer -- pending AND provisional. The complement
 * of `resolvedCount`.
 *
 * ===========================================================================
 *  ZERO MEANS THE DECK IS PRINTABLE, AND THAT IS THE WHOLE REASON IT EXISTS.
 *
 *  With the option off, a card whose final answer is "no year" is REMOVED from
 *  the deck (`YEAR_RESOLVED`), so every card that survives to a finished crawl
 *  carries a real, final year; with it on, the survivors also include kept nulls,
 *  which `selectPrintableCards` prints with a blank year. Either way
 *  `pendingYearCount === 0` is exactly "nothing printed can still change" --
 *  which is what the PDF export waits for (2026-08-07). A sheet exported earlier
 *  silently omits the cards still in flight, and the omission is discoverable
 *  only by counting a printed deck.
 *
 *  THIS AND `isCurrentYearPending` NOW DISAGREE ABOUT A PROVISIONAL CARD, ON
 *  PURPOSE -- do not "fix" one to match the other. The year slot shows a
 *  provisional year (so it is not pending THERE), while the PDF must wait for
 *  its verification (so it is pending HERE). Two questions, two answers.
 *
 *  Expressed as the complement rather than as its own reduce, so this and
 *  `resolvedCount` cannot drift into disagreeing about what "final" means.
 * ===========================================================================
 */
export function pendingYearCount(state: GameState): number {
  return state.deck.length - resolvedCount(state);
}
