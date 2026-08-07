/**
 * `gameReducer` and the derived selectors: the whole of the game's state logic, and all of it
 * pure.
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
import type { GameAction, GameState } from './types';
import type { Card } from '../../shared/types';

/** A session that has not started. Phase 6's landing screen renders against this. */
export const initialGameState: GameState = {
  status: 'idle',
  playlists: [],
  seed: '',
  deck: [],
  currentIndex: 0,
  isFlipped: false,
  yearLookupsUnavailable: false,
};

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START': {
      // Shuffled HERE, synchronously, before anything can look at the deck -- see the block
      // comment in `shuffle.ts` for why the alternative ordering wastes the first lookup.
      const seed = action.seed ?? generateSeed();

      /*
        Yearless cards are filtered at ALL THREE entry points -- here, `YEAR_RESOLVED` and
        `RESUME` -- so "no card in a live deck holds `year: null`" is an invariant rather than a
        tendency (see `GameState.deck`).

        This one is the belt to the other two's braces: `action.cards` comes either from
        `/api/playlist`, where no card has a year yet, or from `state.deck` on a Restart, which
        the other two branches have already cleaned. It costs one pass over a hundred cards once
        per game and removes the question entirely.
      */
      const deck = shuffleDeck(
        action.cards.filter((card) => card.year !== null),
        seed,
      );

      // Nothing left to deal. Reachable two ways -- an empty `cards` argument, and a deck whose
      // every card was already known to be yearless -- and `preparing` would be a loading screen
      // waiting on a lookup that can never be dispatched.
      if (deck.length === 0) {
        return {
          status: 'ended',
          playlists: action.playlists,
          seed,
          deck,
          currentIndex: 0,
          isFlipped: false,
          yearLookupsUnavailable: false,
        };
      }

      // =======================================================================
      //  THE CARD-1 GATE IS SKIPPED WHEN CARD 1 IS ALREADY RESOLVED.
      //
      //  The gate waits for card 1's lookup to COMPLETE, and `year !== undefined`
      //  IS a completed lookup -- that is exactly what the three states of
      //  `Card.year` mean. So there is nothing to wait for and `preparing` would
      //  be a screen shown until the heat death of the universe.
      //
      //  This is not hypothetical: Phase 6's RESTART re-deals `state.deck`, and a
      //  session can only have left `preparing` in the first place BECAUSE card 1
      //  resolved. So every restart arrives here with a resolved card 1. The
      //  resolver correctly skips already-filled cards (`resolver.ts` adds them
      //  straight to `settled`), which means no `YEAR_RESOLVED` is ever dispatched
      //  and nothing else can open the gate. Restart hung on the loading screen,
      //  every time, until this branch existed.
      //
      //  Found 2026-08-05 by `App.test.tsx`'s restart test. It was unreachable
      //  before Phase 6 because nothing could deal a pre-resolved deck.
      // =======================================================================
      const status = deck[0]?.year === undefined ? 'preparing' : 'playing';

      // A wholesale replacement, deliberately: starting a new SET OF PLAYLISTS mid-game must not
      // merge into the old deck, keep the old index, or leave a stale `yearLookupsUnavailable`
      // from a previous deployment state. The merge that produced `action.cards` happened above
      // this reducer, in `deck-merge.ts`; nothing here folds two decks together.
      return {
        status,
        playlists: action.playlists,
        seed,
        deck,
        currentIndex: 0,
        isFlipped: false,
        yearLookupsUnavailable: false,
      };
    }

    case 'YEAR_RESOLVED': {
      // Late callbacks are expected, not exceptional: `stop()` guarantees no callback fires
      // after teardown, but a result already in flight when the reducer moved on has nowhere
      // useful to go.
      if (state.status !== 'preparing' && state.status !== 'playing') return state;

      // =======================================================================
      //  A LOOKUP THAT FINDS NO YEAR REMOVES ITS CARD FROM THE DECK.
      //
      //  DECISION REVERSAL, 2026-08-05, by the developer. `plan.md`'s
      //  `confidence: 'none'` follow-on had resolved the opposite way -- the card
      //  stayed and the revealed side rendered a "check this one yourself"
      //  prompt -- and this is the deliberate reversal of it, not a
      //  reinterpretation. A Hitster card is placed on a timeline BY its year;
      //  without one there is nothing to play, and the QR working is not enough
      //  to make it a card.
      //
      //  LOW CONFIDENCE IS UNAFFECTED. `low` still carries a real year and stays
      //  in the deck, flagged unconfirmed on the revealed side. The test is
      //  `year === null`, never the confidence.
      //
      //  Two consequences worth knowing before touching this branch:
      //
      //  1. THE DECK IS EXPECTED TO SHRINK, AND SUBSTANTIALLY. Phase 3 measured
      //     `none` on roughly a THIRD of a real 42-card playlist, so a deck of 42
      //     will settle around 28 as the crawl catches up. That is the decision
      //     working, not a bug -- but it is why the HUD's "cards left" now falls
      //     as well as rising.
      //  2. `null` DOES NOT ALWAYS MEAN "MUSICBRAINZ HAS NO YEAR". The resolver
      //     also settles at `null` on a 400 and on transient failures that
      //     survive its deferred pass, and `YEAR_RESOLVED` carries no reason. So
      //     a network blip drops cards. That is the honest trade: an unplayable
      //     card is unplayable whatever the cause, and the alternative -- a
      //     `reason` on the action so the reducer could keep "failed" cards --
      //     would put a yearless card back on the table, which is the thing this
      //     decision removes. The one blanket failure is already exempt:
      //     `not-configured` dispatches `YEAR_LOOKUPS_UNAVAILABLE` instead of a
      //     hundred nulls, so a deployment with no `MUSICBRAINZ_USER_AGENT`
      //     yields a yearless deck rather than an empty one.
      // =======================================================================
      const isYearless = action.year === null;

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
      /** Whether the card the player is looking at right now is one of the dropped ones. */
      let droppedCurrent = false;

      const deck: Card[] = [];
      state.deck.forEach((card, index) => {
        if (card.id !== action.cardId) {
          deck.push(card);
          return;
        }

        matched = true;

        if (isYearless) {
          if (index < state.currentIndex) droppedBeforeCurrent += 1;
          else if (index === state.currentIndex) droppedCurrent = true;

          return;
        }

        // Every other card keeps its identity, so a Phase 4 memoized card component
        // re-renders only for the one that actually changed.
        deck.push({ ...card, year: action.year, yearConfidence: action.confidence });
      });

      // A result for a card that is not in this deck -- a callback from a session that was
      // replaced by a second `START`. Dropping it is the correct answer.
      if (!matched) return state;

      // Every card in the deck turned out to be yearless. Only reachable when MusicBrainz
      // answers for every track and knows none of them, so it is rare rather than impossible --
      // and `ended` is the only honest destination, since there is nothing left to play.
      if (deck.length === 0) {
        return { ...state, deck, currentIndex: 0, isFlipped: false, status: 'ended' };
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

      // The current card was dropped and nothing followed it: the deck is exhausted, exactly as
      // `NEXT` past the last card is. Clamping instead would send the player BACKWARDS onto a
      // card they have already played, which the one-directional deck has no other way to do.
      if (droppedCurrent && shifted > deck.length - 1) {
        return { ...state, deck, currentIndex: deck.length - 1, isFlipped: false, status: 'ended' };
      }

      const currentIndex = Math.min(Math.max(shifted, 0), deck.length - 1);

      // =======================================================================
      //  THE CARD-1 GATE.
      //
      //  It waits for card 1's lookup to **COMPLETE**, and it is now expressed as
      //  a property of the deck -- "the first card has a year" -- rather than as
      //  "the resolved card was the first one". The two were equivalent until
      //  yearless cards started being dropped; they are not any more. When card 1
      //  resolves to `null` it LEAVES, and the gate has to keep waiting for
      //  whichever card takes its place, whose lookup has not happened yet.
      //
      //  Written against the NEXT deck for that reason. Reading `state.deck[0]`
      //  would ask about a card that is no longer in the game.
      //
      //  It also self-heals: any `YEAR_RESOLVED` opens the gate once the first
      //  card has a year, so a first card resolved out of order -- by a priority
      //  jump, or arriving already filled in a re-dealt deck -- cannot leave the
      //  session stuck on the loading screen. `START` has its own version of that
      //  guard for the same reason (see above).
      //
      //  Note it is card INDEX 0, not `state.currentIndex`: the gate is about the
      //  first card of the shuffled deck specifically, which is the one the
      //  resolver looks up first and the one the player is about to see.
      // =======================================================================
      const opensGate = state.status === 'preparing' && deck[0]?.year !== undefined;
      const status = opensGate ? 'playing' : state.status;

      return { ...state, deck, currentIndex, isFlipped, status };
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

    case 'END': {
      // From `idle` there is nothing to end. Exit only exists during a session.
      if (state.status === 'idle' || state.status === 'ended') return state;

      return { ...state, status: 'ended' };
    }

    case 'RESUME': {
      // The persisted session is trusted here because `loadSession()` has already validated
      // it -- version, shape, deck non-empty, index in range. This branch is the one place
      // that trust is spent, which is why the validation lives in `persistence.ts` and not
      // in a `useEffect` somewhere.
      const { session } = action;

      /*
        ===========================================================================
         YEARLESS CARDS ARE DROPPED HERE TOO, SO THE INVARIANT IS ABSOLUTE.

         Since the reversal above, no card in a live deck ever holds `year: null` --
         one is removed in the same dispatch that would have recorded it. A SAVE
         WRITTEN BEFORE THE REVERSAL is the one way such a card can still get in,
         and it would be permanent: the resolver marks every already-filled card
         settled, so it is never looked up again and never dispatched again. The
         card would sit in the deck showing "year unknown" for the rest of that
         game.

         Filtering rather than bumping `SESSION_VERSION` keeps the resolved years,
         which is the whole point of persisting the deck -- a version bump would
         discard a part-crawled deck and re-spend a globally shared budget on
         lookups already paid for.

         The index has to move with the deck for the same reason it does in
         `YEAR_RESOLVED`: `loadSession()` validated it against the SAVED deck, so
         after a filter it can be off the end, and it must not be left pointing at
         a different card than the player left off on.
        ===========================================================================
      */
      const deck = session.deck.filter((card) => card.year !== null);
      const droppedBefore = session.deck
        .slice(0, session.currentIndex)
        .filter((card) => card.year === null).length;
      const currentIndex =
        deck.length === 0
          ? 0
          : Math.min(Math.max(session.currentIndex - droppedBefore, 0), deck.length - 1);

      return {
        // A saved deck of nothing but yearless cards leaves nothing to resume.
        status: deck.length === 0 ? 'ended' : session.status,
        playlists: session.playlists,
        seed: session.seed,
        deck,
        currentIndex,
        isFlipped: session.isFlipped,
        // Re-derived by the next crawl rather than restored: it describes the server's
        // configuration, not the session (see `PersistedSession`).
        yearLookupsUnavailable: false,
      };
    }
  }
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
 * Whether the current card's year has not come back yet -- the ONE thing Phase 4 renders a
 * pending state for.
 *
 * `undefined` means "not looked up"; `null` means "looked up, nothing found" and is a
 * finished answer. Collapsing the two would spin a spinner forever on a `confidence: 'none'`
 * card, which is the exact bug the three-state `Card.year` exists to prevent.
 */
export function isCurrentYearPending(state: GameState): boolean {
  const card = currentCard(state);
  if (!card) return false;

  return card.year === undefined;
}

/** How many cards are still to come AFTER the current one. Zero on the last card. */
export function cardsRemaining(state: GameState): number {
  return Math.max(0, state.deck.length - state.currentIndex - 1);
}

/**
 * How many cards have a completed lookup, resolved or not.
 *
 * Count only, on purpose: Phase 6's `preparing` progress line may show a number but must
 * never name a track or a year, which would spoil the deck it is loading.
 */
export function resolvedCount(state: GameState): number {
  return state.deck.reduce((count, card) => (card.year === undefined ? count : count + 1), 0);
}

/**
 * How many cards are still waiting on a lookup. The complement of `resolvedCount`.
 *
 * ===========================================================================
 *  ZERO MEANS THE DECK IS PRINTABLE, AND THAT IS THE WHOLE REASON IT EXISTS.
 *
 *  A card whose lookup finds nothing is REMOVED from the deck (`YEAR_RESOLVED`),
 *  so every card that survives to a finished crawl carries a real year. That
 *  makes `pendingYearCount === 0` exactly equivalent to "every card in this deck
 *  can be printed" -- which is what the PDF export waits for (2026-08-07). A
 *  sheet exported earlier silently omits the cards whose year is still in flight,
 *  and the omission is discoverable only by counting a printed deck.
 *
 *  Expressed as the complement rather than as its own reduce, so the two
 *  selectors cannot drift into disagreeing about what `undefined` means.
 * ===========================================================================
 */
export function pendingYearCount(state: GameState): number {
  return state.deck.length - resolvedCount(state);
}
