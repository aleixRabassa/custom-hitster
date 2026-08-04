import { describe, expect, it } from 'vitest';

import {
  cardsRemaining,
  currentCard,
  gameReducer,
  initialGameState,
  isCurrentYearPending,
  resolvedCount,
} from './reducer';
import { shuffleDeck } from './shuffle';
import type { GameState, PersistedSession } from './types';
import type { Card, PlaylistSummary } from '../../shared/types';

const PLAYLIST: PlaylistSummary = {
  id: '37i9dQZF1DWXRqgorJj26U',
  name: 'Rock Classics',
  owner: 'Spotify',
};

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    durationMs: 200_000,
    isPlayable: true,
    ...overrides,
  };
}

/** Enough cards that a shuffle is observably a shuffle rather than a coincidence. */
const CARDS = Array.from({ length: 20 }, (_, i) => card(`t${i}`));

const SEED = 'reducer-test-seed';

/** A dealt but ungated session: `preparing`, deck shuffled, nothing resolved. */
function preparing(cards: Card[] = CARDS, seed = SEED): GameState {
  return gameReducer(initialGameState, { type: 'START', cards, playlist: PLAYLIST, seed });
}

/** A session past the card-1 gate: card 1 resolved, everything else still `undefined`. */
function playing(cards: Card[] = CARDS, seed = SEED): GameState {
  const state = preparing(cards, seed);

  return gameReducer(state, {
    type: 'YEAR_RESOLVED',
    cardId: firstCardId(state),
    year: 1975,
    confidence: 'high',
  });
}

function firstCardId(state: GameState): string {
  const first = state.deck[0];
  if (!first) throw new Error('deck is empty');

  return first.id;
}

// ===========================================================================
//  TRANSITIONS
// ===========================================================================

describe('gameReducer transitions', () => {
  it('should shuffle the deck on START and enter preparing', () => {
    // Shuffling happens HERE, before any resolution: the resolver walks the deck in play order,
    // so a shuffle afterwards would spend the first (slowest) lookup on a card that then lands
    // somewhere random (decision 15).
    const state = preparing();

    expect(state.status).toBe('preparing');
    expect(state.playlist).toEqual(PLAYLIST);
    expect(state.currentIndex).toBe(0);
    expect(state.isFlipped).toBe(false);
    expect(state.yearLookupsUnavailable).toBe(false);
    expect(state.deck).toHaveLength(CARDS.length);
    expect([...state.deck].map((c) => c.id).sort()).toEqual(CARDS.map((c) => c.id).sort());
    expect(state.deck.map((c) => c.id)).not.toEqual(CARDS.map((c) => c.id));
  });

  it('should generate a seed when START does not supply one', () => {
    const state = gameReducer(initialGameState, {
      type: 'START',
      cards: CARDS,
      playlist: PLAYLIST,
    });

    expect(state.seed).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should use an explicitly supplied seed on START', () => {
    // The forward-compatibility hook for Phase 8's shareable deck URL: the same playlist and
    // the same seed must deal the same deck, with no reducer change needed then.
    const state = preparing(CARDS, 'shared-deck-seed');

    expect(state.seed).toBe('shared-deck-seed');
    expect(state.deck).toEqual(shuffleDeck(CARDS, 'shared-deck-seed'));
  });

  it('should replace an existing session when START is dispatched again', () => {
    // Starting a new playlist mid-game must not merge into the old deck or keep the old index.
    const first = gameReducer(playing(), { type: 'NEXT' });
    const otherCards = [card('other-1'), card('other-2')];

    const second = gameReducer(first, {
      type: 'START',
      cards: otherCards,
      playlist: { id: 'other', name: 'Other', owner: 'Someone' },
      seed: 'second',
    });

    expect(second.status).toBe('preparing');
    expect(second.currentIndex).toBe(0);
    expect(second.deck.map((c) => c.id).sort()).toEqual(['other-1', 'other-2']);
    expect(second.playlist?.id).toBe('other');
  });

  it('should record a resolved year on the matching card by id', () => {
    const state = playing();
    const targetId = state.deck[5]?.id ?? '';

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: targetId,
      year: 1969,
      confidence: 'low',
    });

    expect(next.deck.find((c) => c.id === targetId)).toMatchObject({
      year: 1969,
      yearConfidence: 'low',
    });
  });

  it('should not disturb other cards when one year resolves', () => {
    const state = playing();
    const targetId = state.deck[3]?.id ?? '';

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: targetId,
      year: 1984,
      confidence: 'high',
    });

    expect(next.deck).toHaveLength(state.deck.length);
    next.deck.forEach((updated, index) => {
      // Identity, not equality: an untouched card keeps its reference, so a memoized Phase 4
      // card component re-renders only for the one that actually changed.
      if (updated.id === targetId) return;
      expect(updated).toBe(state.deck[index]);
    });
  });

  it('should update every copy of a duplicated card id', () => {
    // A playlist may legitimately hold the same track twice, and the resolver looks a given id
    // up ONCE. Updating only the first copy would leave the second pending forever.
    const state = playing([card('dup'), card('dup'), card('other')], 'dup-seed');

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: 'dup',
      year: 1991,
      confidence: 'high',
    });

    expect(next.deck.filter((c) => c.id === 'dup').every((c) => c.year === 1991)).toBe(true);
  });

  it('should ignore a YEAR_RESOLVED for an unknown card id', () => {
    // A stale callback from a session that a second START replaced.
    const state = playing();

    expect(
      gameReducer(state, {
        type: 'YEAR_RESOLVED',
        cardId: 'not-in-this-deck',
        year: 1999,
        confidence: 'high',
      }),
    ).toBe(state);
  });

  it('should toggle isFlipped on FLIP', () => {
    const state = playing();
    const flipped = gameReducer(state, { type: 'FLIP' });

    expect(flipped.isFlipped).toBe(true);
    expect(gameReducer(flipped, { type: 'FLIP' }).isFlipped).toBe(false);
  });

  it('should advance the index and reset the flip on NEXT', () => {
    const state = gameReducer(playing(), { type: 'FLIP' });
    const next = gameReducer(state, { type: 'NEXT' });

    expect(next.currentIndex).toBe(1);
    expect(next.isFlipped).toBe(false);
    expect(next.status).toBe('playing');
  });

  it('should enter ended when NEXT is dispatched on the last card', () => {
    let state = playing([card('a'), card('b')], 'two-cards');
    state = gameReducer(state, { type: 'NEXT' });

    expect(state.currentIndex).toBe(1);

    const ended = gameReducer(state, { type: 'NEXT' });

    expect(ended.status).toBe('ended');
    // Left ON the last card, not one past the end: `currentCard()` must never be undefined for
    // a deck that has cards.
    expect(ended.currentIndex).toBe(1);
    expect(currentCard(ended)).toBeDefined();
  });

  it('should enter ended on END', () => {
    // The Exit button's action. Phase 6 redirects on it.
    expect(gameReducer(playing(), { type: 'END' }).status).toBe('ended');
    expect(gameReducer(preparing(), { type: 'END' }).status).toBe('ended');
  });

  it('should treat a YEAR_RESOLVED arriving after END as a no-op returning the same reference', () => {
    // Normal rather than exceptional: the player can Exit while a lookup is in flight.
    const ended = gameReducer(playing(), { type: 'END' });

    const after = gameReducer(ended, {
      type: 'YEAR_RESOLVED',
      cardId: firstCardId(ended),
      year: 1977,
      confidence: 'high',
    });

    expect(after).toBe(ended);
  });

  it('should treat inapplicable actions as no-ops returning the same reference', () => {
    // Returning the identical object is what keeps a no-op free of re-renders.
    expect(gameReducer(initialGameState, { type: 'FLIP' })).toBe(initialGameState);
    expect(gameReducer(initialGameState, { type: 'NEXT' })).toBe(initialGameState);
    expect(gameReducer(initialGameState, { type: 'END' })).toBe(initialGameState);

    const prepared = preparing();
    expect(gameReducer(prepared, { type: 'FLIP' })).toBe(prepared);
    expect(gameReducer(prepared, { type: 'NEXT' })).toBe(prepared);

    const ended = gameReducer(playing(), { type: 'END' });
    expect(gameReducer(ended, { type: 'END' })).toBe(ended);
    expect(gameReducer(ended, { type: 'YEAR_LOOKUPS_UNAVAILABLE' })).toBe(ended);
  });

  it('should restore a full session on RESUME', () => {
    const session: PersistedSession = {
      version: 1,
      playlist: PLAYLIST,
      seed: 'persisted-seed',
      deck: [card('a', { year: 1975, yearConfidence: 'high' }), card('b'), card('c')],
      currentIndex: 1,
      isFlipped: true,
      status: 'playing',
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state).toEqual({
      status: 'playing',
      playlist: PLAYLIST,
      seed: 'persisted-seed',
      deck: session.deck,
      currentIndex: 1,
      isFlipped: true,
      // Re-derived by the next crawl rather than restored: it describes the server's
      // configuration, not the session.
      yearLookupsUnavailable: false,
    });
  });
});

// ===========================================================================
//  THE CARD-1 GATE
//
//  Start waits on ONE lookup, never on the deck. A cold lookup is 1.3-3.6 s and
//  the MusicBrainz budget is global across all users, so a gate on the whole
//  deck would be minutes of loading screen.
// ===========================================================================

describe('gameReducer card-1 gate', () => {
  it('should stay preparing until card 1 resolves', () => {
    expect(preparing().status).toBe('preparing');
  });

  it('should enter playing when card 1 resolves, even with a null year', () => {
    // The refinement of `plan.md`'s "as soon as card 1 has a year" (decision 4): the gate waits
    // for the lookup to COMPLETE. A null year is a completed lookup, and its card is playable --
    // gating on "has a year" would hang forever on a legitimately yearless track.
    const state = preparing();

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: firstCardId(state),
      year: null,
      confidence: 'none',
    });

    expect(next.status).toBe('playing');
    expect(next.deck[0]?.year).toBeNull();
  });

  it('should stay preparing when a card other than card 1 resolves first', () => {
    // The gate is card 1 specifically, not "any year": the resolver's priority jump means
    // results can arrive out of deck order.
    const state = preparing();
    const otherId = state.deck[4]?.id ?? '';

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: otherId,
      year: 1971,
      confidence: 'high',
    });

    expect(next.status).toBe('preparing');
  });

  it('should enter playing on YEAR_LOOKUPS_UNAVAILABLE while preparing', () => {
    // A deployment with no `MUSICBRAINZ_USER_AGENT` fails identically for every card, so
    // waiting for card 1 would wait forever. The deck is yearless but playable.
    const next = gameReducer(preparing(), { type: 'YEAR_LOOKUPS_UNAVAILABLE' });

    expect(next.status).toBe('playing');
    expect(next.yearLookupsUnavailable).toBe(true);
  });

  it('should record YEAR_LOOKUPS_UNAVAILABLE mid-game without changing status', () => {
    const next = gameReducer(playing(), { type: 'YEAR_LOOKUPS_UNAVAILABLE' });

    expect(next.status).toBe('playing');
    expect(next.yearLookupsUnavailable).toBe(true);
  });

  it('should be fully playable while cards 2..n are still undefined', () => {
    // ===================================================================
    //  THE INVARIANT `plan.md` §5 SINGLES OUT AS REGRESSING SILENTLY,
    //  because a deck of cached years resolves fast enough to hide a
    //  blocking implementation in local testing. Flip, next and end must
    //  all work with exactly ONE resolved card in the deck.
    // ===================================================================
    let state = playing();

    expect(state.status).toBe('playing');
    expect(state.deck.slice(1).every((c) => c.year === undefined)).toBe(true);

    state = gameReducer(state, { type: 'FLIP' });
    expect(state.isFlipped).toBe(true);

    state = gameReducer(state, { type: 'NEXT' });
    expect(state.currentIndex).toBe(1);
    expect(state.status).toBe('playing');

    // Card 2 has no year at all, and flipping it is still allowed: the pending state belongs to
    // the year slot alone.
    state = gameReducer(state, { type: 'FLIP' });
    expect(state.isFlipped).toBe(true);
    expect(currentCard(state)?.year).toBeUndefined();

    state = gameReducer(state, { type: 'NEXT' });
    expect(state.currentIndex).toBe(2);

    state = gameReducer(state, { type: 'END' });
    expect(state.status).toBe('ended');
  });

  it("should report the current card's year as pending when it is undefined", () => {
    const state = gameReducer(playing(), { type: 'NEXT' });

    expect(isCurrentYearPending(state)).toBe(true);
  });

  it('should not report pending for a card resolved to a null year', () => {
    // "Not looked up yet" (`undefined`) versus "looked up, nothing found" (`null`). Collapsing
    // the two would spin a spinner forever on a `confidence: 'none'` card.
    const state = preparing();

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: firstCardId(state),
      year: null,
      confidence: 'none',
    });

    expect(isCurrentYearPending(next)).toBe(false);
  });
});

// ===========================================================================
//  DERIVED SELECTORS
// ===========================================================================

describe('gameReducer selectors', () => {
  it('should report the current card and how many remain', () => {
    const state = gameReducer(playing(), { type: 'NEXT' });

    expect(currentCard(state)).toBe(state.deck[1]);
    expect(cardsRemaining(state)).toBe(CARDS.length - 2);
  });

  it('should report no remaining cards on the last card', () => {
    let state = playing([card('a'), card('b')], 'two');
    state = gameReducer(state, { type: 'NEXT' });

    expect(cardsRemaining(state)).toBe(0);
  });

  it('should count completed lookups, resolved or not', () => {
    // Count only, deliberately: Phase 6's `preparing` progress line may show a number but must
    // never name a track or a year, which would spoil the deck it is loading.
    let state = playing();
    expect(resolvedCount(state)).toBe(1);

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: state.deck[7]?.id ?? '',
      year: null,
      confidence: 'none',
    });

    // A null year is a COMPLETED lookup and counts.
    expect(resolvedCount(state)).toBe(2);
  });

  it('should be safe on an empty deck', () => {
    expect(currentCard(initialGameState)).toBeUndefined();
    expect(isCurrentYearPending(initialGameState)).toBe(false);
    expect(cardsRemaining(initialGameState)).toBe(0);
    expect(resolvedCount(initialGameState)).toBe(0);
  });
});
