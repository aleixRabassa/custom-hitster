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
  playlist: null,
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
      const deck = shuffleDeck(action.cards, seed);

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

      // A wholesale replacement, deliberately: starting a new playlist mid-game must not
      // merge into the old deck, keep the old index, or leave a stale `yearLookupsUnavailable`
      // from a previous deployment state.
      return {
        status,
        playlist: action.playlist,
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

      // BY ID, never by index (decision 13). The resolver's priority jump makes its ordering
      // and the deck's ordering diverge routinely; an index write would corrupt the deck the
      // first time it did, by stamping one card's year onto another.
      //
      // EVERY card with that id, not just the first: a playlist may legitimately contain the
      // same track twice, and the resolver looks a given id up once. Updating one copy would
      // leave the other showing a pending year for the rest of the game.
      let matched = false;
      const deck = state.deck.map((card) => {
        if (card.id !== action.cardId) return card;
        matched = true;
        // Every other card keeps its identity, so a Phase 4 memoized card component
        // re-renders only for the one that actually changed.
        return { ...card, year: action.year, yearConfidence: action.confidence };
      });

      // A result for a card that is not in this deck -- a callback from a session that was
      // replaced by a second `START`. Dropping it is the correct answer.
      if (!matched) return state;

      // =======================================================================
      //  THE CARD-1 GATE.
      //
      //  It waits for card 1's lookup to **COMPLETE**, not to produce a year --
      //  a refinement of `plan.md` §5's "as soon as card 1 has a year"
      //  (decision 4). A `null` year IS a completed lookup, and its card is
      //  playable: the QR code always works, so a card MusicBrainz knows nothing
      //  about is still a card. Gating on "has a year" would hang the loading
      //  screen forever on a legitimately yearless track.
      //
      //  Note it is card INDEX 0, not `state.currentIndex`: the gate is about the
      //  first card of the shuffled deck specifically, which is the one the
      //  resolver looks up first and the one the player is about to see.
      // =======================================================================
      const opensGate = state.status === 'preparing' && state.deck[0]?.id === action.cardId;
      const status = opensGate ? 'playing' : state.status;

      return { ...state, deck, status };
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

      return {
        status: session.status,
        playlist: session.playlist,
        seed: session.seed,
        deck: session.deck,
        currentIndex: session.currentIndex,
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
