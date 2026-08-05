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

  it('should drop a card whose lookup found no year', () => {
    // ===================================================================
    //  THE 2026-08-05 REVERSAL, asserted at its source.
    //
    //  `plan.md`'s `confidence: 'none'` follow-on had resolved the other
    //  way -- the card stayed and the revealed side offered a "check this
    //  one yourself" prompt. A Hitster card is placed on a timeline BY its
    //  year, so a card without one has nothing to play; the QR working is
    //  not enough to make it a card.
    // ===================================================================
    const state = playing();
    const targetId = state.deck[5]?.id ?? '';

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: targetId,
      year: null,
      confidence: 'none',
    });

    expect(next.deck.some((c) => c.id === targetId)).toBe(false);
    expect(next.deck).toHaveLength(state.deck.length - 1);
    // And no other card moved: the array closed up around the one that left.
    expect(next.deck.map((c) => c.id)).toEqual(
      state.deck.filter((c) => c.id !== targetId).map((c) => c.id),
    );
  });

  it('should keep a low-confidence card in the deck', () => {
    // The reversal tests `year === null`, NEVER the confidence. A `low` year is a real year --
    // MusicBrainz found it with the release-group filters dropped -- and it is playable, flagged
    // unconfirmed on the revealed side. Dropping these would empty a third of the deck for a
    // caveat rather than for a missing answer.
    const state = playing();
    const targetId = state.deck[4]?.id ?? '';

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
    expect(next.deck).toHaveLength(state.deck.length);
  });

  it('should drop every copy of a duplicated yearless card id', () => {
    // The mirror of "should update every copy": the resolver looks a duplicated id up once, so
    // dropping only the first copy would leave a yearless card in the deck for the rest of the
    // game -- the exact thing the reversal removes.
    const state = playing([card('dup'), card('dup'), card('other')], 'dup-seed');

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: 'dup',
      year: null,
      confidence: 'none',
    });

    expect(next.deck.some((c) => c.id === 'dup')).toBe(false);
  });

  it('should move the current index back when a dropped card sits behind the player', () => {
    // The player must stay on the same CARD, not on the same index. Without the shift, dropping a
    // card from behind them silently skips the one they were about to see.
    let state = playing();
    state = gameReducer(state, { type: 'NEXT' });
    state = gameReducer(state, { type: 'NEXT' });

    const droppedId = state.deck[0]?.id ?? '';
    const currentId = state.deck[state.currentIndex]?.id;
    expect(state.currentIndex).toBe(2);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: droppedId,
      year: null,
      confidence: 'none',
    });

    expect(next.currentIndex).toBe(1);
    expect(currentCard(next)?.id).toBe(currentId);
  });

  it('should leave the current index alone when a dropped card is still ahead', () => {
    // The common case by far: the crawl runs ahead of the player, so almost every drop happens to
    // a card nobody has reached.
    let state = playing();
    state = gameReducer(state, { type: 'NEXT' });

    const currentId = currentCard(state)?.id;

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: state.deck[7]?.id ?? '',
      year: null,
      confidence: 'none',
    });

    expect(next.currentIndex).toBe(1);
    expect(currentCard(next)?.id).toBe(currentId);
  });

  it('should slide the next card in and reset the flip when the CURRENT card is dropped', () => {
    // ===================================================================
    //  THE LEAK IN THIS BRANCH IS `isFlipped`, NOT THE CARD SWAP.
    //
    //  A player who outruns the crawl sits on an unresolved card, so its
    //  lookup completing under them is normal rather than exotic. The
    //  index does not move -- the array closed up, so it already points at
    //  the card that followed -- but the flip flag belongs to the card
    //  that just left. Carried over, the incoming card would mount already
    //  revealed and hand the player its year for free.
    // ===================================================================
    let state = playing();
    state = gameReducer(state, { type: 'NEXT' });
    state = gameReducer(state, { type: 'FLIP' });

    const droppedId = currentCard(state)?.id ?? '';
    const followingId = state.deck[2]?.id;
    expect(state.isFlipped).toBe(true);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: droppedId,
      year: null,
      confidence: 'none',
    });

    expect(next.currentIndex).toBe(1);
    expect(currentCard(next)?.id).toBe(followingId);
    expect(next.isFlipped).toBe(false);
  });

  it('should end the session when the dropped current card was the last one', () => {
    // Clamping the index instead would send the player BACKWARDS onto a card they have already
    // played, which nothing else in this one-directional deck can do. `NEXT` past the last card
    // ends the session; so does losing the last card.
    let state = playing([card('a'), card('b')], 'two');
    state = gameReducer(state, { type: 'NEXT' });

    const lastId = currentCard(state)?.id ?? '';

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: lastId,
      year: null,
      confidence: 'none',
    });

    expect(next.status).toBe('ended');
    expect(next.deck.some((c) => c.id === lastId)).toBe(false);
  });

  it('should end the session when the last remaining card is dropped', () => {
    // A whole deck of tracks MusicBrainz knows nothing about. Rare, not impossible -- and there is
    // nothing to play, so `ended` is the only honest destination. Left in `preparing` it would be a
    // loading screen waiting on a lookup that can never arrive.
    const state = preparing([card('only')], 'one');
    const preparedId = state.deck[0]?.id ?? '';

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: preparedId,
      year: null,
      confidence: 'none',
    });

    expect(next.deck).toHaveLength(0);
    expect(next.status).toBe('ended');
    expect(next.currentIndex).toBe(0);
  });

  it('should not drop anything on YEAR_LOOKUPS_UNAVAILABLE', () => {
    // ===================================================================
    //  THE EXEMPTION THAT KEEPS A MISCONFIGURED DEPLOYMENT PLAYABLE.
    //
    //  No `MUSICBRAINZ_USER_AGENT` on the server fails identically for
    //  every card. If that arrived as a hundred `year: null` results the
    //  reversal above would delete the entire deck; it arrives as ONE
    //  action instead, and this asserts that action still keeps every card.
    //  The deck is yearless rather than gone -- which is what the Phase 6
    //  notice says out loud.
    // ===================================================================
    const state = playing();

    const next = gameReducer(state, { type: 'YEAR_LOOKUPS_UNAVAILABLE' });

    expect(next.deck).toHaveLength(state.deck.length);
    expect(next.yearLookupsUnavailable).toBe(true);
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

  it('should drop yearless cards from a resumed session and move the index with them', () => {
    // ===================================================================
    //  A SAVE WRITTEN BEFORE THE 2026-08-05 REVERSAL IS THE ONE WAY A
    //  YEARLESS CARD CAN STILL GET INTO A DECK -- AND IT WOULD BE
    //  PERMANENT.
    //
    //  `resolver.ts` marks every already-filled card settled, so it is
    //  never looked up again and never dispatched again: the card would sit
    //  in the deck showing "year unknown" for the whole of that game, which
    //  is exactly what the reversal removes.
    //
    //  Filtering rather than bumping `SESSION_VERSION` keeps the resolved
    //  years, which is the entire point of persisting the deck -- a version
    //  bump would discard a part-crawled deck and re-spend a globally
    //  shared MusicBrainz budget on lookups already paid for.
    //
    //  The index moves with the deck because `loadSession()` validated it
    //  against the SAVED deck: after a filter it can be off the end, and it
    //  must not end up pointing at a different card than the player left on.
    // ===================================================================
    const session: PersistedSession = {
      version: 1,
      playlist: PLAYLIST,
      seed: 'persisted-seed',
      deck: [
        card('a', { year: 1975, yearConfidence: 'high' }),
        card('gone', { year: null, yearConfidence: 'none' }),
        card('b', { year: 1969, yearConfidence: 'low' }),
        card('c'),
      ],
      currentIndex: 2,
      isFlipped: false,
      status: 'playing',
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state.deck.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    // Still card `b`, which is where the player was -- index 2 became index 1.
    expect(state.currentIndex).toBe(1);
    expect(currentCard(state)?.id).toBe('b');
  });

  it('should end a resumed session whose every card was yearless', () => {
    const session: PersistedSession = {
      version: 1,
      playlist: PLAYLIST,
      seed: 'persisted-seed',
      deck: [card('x', { year: null, yearConfidence: 'none' })],
      currentIndex: 0,
      isFlipped: false,
      status: 'playing',
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state.deck).toHaveLength(0);
    expect(state.status).toBe('ended');
    expect(state.currentIndex).toBe(0);
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

  it('should keep gating when card 1 is dropped for having no year', () => {
    // ===================================================================
    //  THE GATE HAD TO BE REPHRASED FOR THE 2026-08-05 REVERSAL, AND THIS
    //  IS WHY.
    //
    //  It used to open on "the resolved card WAS card 1", because a null
    //  year was a completed lookup and its card was playable. Now card 1
    //  resolving to `null` LEAVES the deck -- so that condition would open
    //  the gate onto a brand new first card whose lookup has not even been
    //  dispatched, and the player would land on the pending `····` slot
    //  instead of a card that is ready.
    //
    //  Expressed as a property of the deck instead: the gate opens when the
    //  first card HAS a year.
    // ===================================================================
    const state = preparing();
    const droppedId = firstCardId(state);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: droppedId,
      year: null,
      confidence: 'none',
    });

    expect(next.status).toBe('preparing');
    expect(next.deck.some((c) => c.id === droppedId)).toBe(false);
    expect(next.deck).toHaveLength(CARDS.length - 1);
  });

  it('should open the gate once the replacement first card resolves', () => {
    // The other half: the wait after a dropped card 1 is one more lookup, not an indefinite one.
    let state = preparing();

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: firstCardId(state),
      year: null,
      confidence: 'none',
    });

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: firstCardId(state),
      year: 1975,
      confidence: 'high',
    });

    expect(state.status).toBe('playing');
  });

  it('should open the gate on any resolution once the first card already has a year', () => {
    // The self-healing half of the rephrased gate. A first card that resolved OUT OF ORDER -- via a
    // priority jump, or filled in already by a re-dealt deck -- used to be able to leave the
    // session on the loading screen forever, because the only action that could open the gate was
    // one naming card 1 and it had already been and gone.
    const state = preparing();
    const first = state.deck[0];
    if (!first) throw new Error('deck is empty');

    const withResolvedFirst: GameState = {
      ...state,
      deck: [{ ...first, year: 1975, yearConfidence: 'high' }, ...state.deck.slice(1)],
    };

    const next = gameReducer(withResolvedFirst, {
      type: 'YEAR_RESOLVED',
      cardId: withResolvedFirst.deck[3]?.id ?? '',
      year: 1984,
      confidence: 'high',
    });

    expect(next.status).toBe('playing');
  });

  it('should skip preparing entirely when card 1 is already resolved', () => {
    // ===================================================================
    //  THE RESTART CASE, and it was a hang before this branch existed.
    //
    //  Phase 6's Restart re-deals `state.deck`, and a session can only have
    //  LEFT `preparing` because card 1 resolved -- so every restart arrives
    //  with a resolved card 1. `resolver.ts` correctly refuses to look up a
    //  card that already has a year (it goes straight into `settled`), which
    //  means no `YEAR_RESOLVED` is ever dispatched and nothing else can open
    //  the gate. The loading screen stayed up forever.
    //
    //  `year !== undefined` IS a completed lookup -- that is what the three
    //  states of `Card.year` mean -- so there is nothing for the gate to wait
    //  for. Found 2026-08-05 via `App.test.tsx`'s restart test.
    // ===================================================================
    const resolved = CARDS.map((c) => ({ ...c, year: 1975, yearConfidence: 'high' as const }));

    expect(preparing(resolved).status).toBe('playing');
  });

  it('should end rather than deal a deck of nothing but yearless cards', () => {
    // The START side of the reversal. This deck used to be dealt and played, yearless; now every
    // card is filtered out at the door, and a session with no cards has to be `ended` -- left
    // `preparing` it would be a loading screen waiting on a lookup that can never be dispatched,
    // and left `playing` it would be a game screen with no card to render.
    const resolved = CARDS.map((c) => ({ ...c, year: null, yearConfidence: 'none' as const }));

    const state = preparing(resolved);

    expect(state.deck).toHaveLength(0);
    expect(state.status).toBe('ended');
  });

  it('should filter yearless cards out of a re-dealt deck without losing the rest', () => {
    // The realistic version of the case above, and the reason START filters at all: a deck handed
    // back to START by Restart, or dealt from a save written before the reversal, can hold a few
    // yearless cards among resolved ones. The resolver marks every already-filled card settled, so
    // nothing would ever dispatch for them again and they would sit in the deck all game.
    const mixed = [
      card('keep-1', { year: 1975, yearConfidence: 'high' }),
      card('drop-1', { year: null, yearConfidence: 'none' }),
      card('keep-2', { year: 1969, yearConfidence: 'low' }),
      card('drop-2', { year: null, yearConfidence: 'none' }),
    ];

    const state = preparing(mixed, 'mixed-seed');

    expect(state.deck.map((c) => c.id).sort()).toEqual(['keep-1', 'keep-2']);
    // Card 1 of the filtered deck is resolved, so there is nothing to gate on.
    expect(state.status).toBe('playing');
  });

  it('should still gate when only a later card is already resolved', () => {
    // The gate is card 1 SPECIFICALLY. A partially resolved deck -- which is what a Restart after an
    // early Exit produces -- must still wait if the card that landed first has no year.
    //
    // The seed is fixed, so which card the shuffle puts first is deterministic: assert on the
    // dealt deck rather than on the input order, because the shuffle is what decides card 1.
    const dealt = preparing();
    const unresolvedFirstId = firstCardId(dealt);
    const partiallyResolved = CARDS.map((c) =>
      c.id === unresolvedFirstId ? c : { ...c, year: 1975, yearConfidence: 'high' as const },
    );

    expect(preparing(partiallyResolved).status).toBe('preparing');
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

  it('should not report pending for a card holding a null year', () => {
    // "Not looked up yet" (`undefined`) versus "looked up, nothing found" (`null`). Collapsing the
    // two would spin the pending slot forever on a card that has its final answer.
    //
    // Built as a state LITERAL rather than by dispatching a null result, because since the
    // 2026-08-05 reversal a dispatch cannot produce this deck -- the card is dropped instead. The
    // selector's contract is unchanged and still worth pinning: `CardRevealSide` keeps its third
    // state, and this is the shape it renders for.
    const base = playing();
    const state: GameState = {
      ...base,
      deck: [card('yearless', { year: null, yearConfidence: 'none' })],
      currentIndex: 0,
    };

    expect(isCurrentYearPending(state)).toBe(false);
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

  it('should count completed lookups', () => {
    // Count only, deliberately: it may show a number but must never name a track or a year.
    //
    // No caller renders it since the preparing screen's "N of M years found" line was removed on
    // 2026-08-05, and it stays exported with its tests because a progress readout is an obvious
    // thing for a later phase to want back -- from here rather than reinvented in a component.
    let state = playing();
    expect(resolvedCount(state)).toBe(1);

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: state.deck[7]?.id ?? '',
      year: 1984,
      confidence: 'high',
    });

    expect(resolvedCount(state)).toBe(2);
  });

  it('should not count a lookup that found no year, because its card is gone', () => {
    // The selector still treats a `null` year as a completed lookup -- that is its contract, and a
    // deck holding one would count it. But since the 2026-08-05 reversal a null result REMOVES the
    // card, so the count does not move and the deck shrinks by one instead.
    const state = playing();

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: state.deck[7]?.id ?? '',
      year: null,
      confidence: 'none',
    });

    expect(resolvedCount(next)).toBe(1);
    expect(next.deck).toHaveLength(state.deck.length - 1);
  });

  it('should be safe on an empty deck', () => {
    expect(currentCard(initialGameState)).toBeUndefined();
    expect(isCurrentYearPending(initialGameState)).toBe(false);
    expect(cardsRemaining(initialGameState)).toBe(0);
    expect(resolvedCount(initialGameState)).toBe(0);
  });
});
