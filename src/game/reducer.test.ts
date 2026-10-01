import { describe, expect, it } from 'vitest';

import {
  cardsPlayed,
  cardsRemaining,
  currentCard,
  gameReducer,
  initialGameState,
  isCurrentYearPending,
  pendingYearCount,
  resolvedCount,
  yearStateOf,
} from './reducer';
import { shuffleDeck } from './shuffle';
import type { GameState, PersistedSession } from './types';
import type { Card, PlaylistSummary } from '../../shared/types';

const PLAYLIST: PlaylistSummary = {
  id: '37i9dQZF1DWXRqgorJj26U',
  name: 'Rock Classics',
  owner: 'Spotify',
};

/** Two more, so a multi-playlist `START` and `RESUME` can be asserted in order. */
const SECOND_PLAYLIST: PlaylistSummary = { id: 'second-id', name: 'Second', owner: 'Someone' };
const THIRD_PLAYLIST: PlaylistSummary = { id: 'third-id', name: 'Third', owner: 'Someone Else' };

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

/**
 * The two values of `keepYearless` (plan.year-fetch-rework-game.md), named so a test that depends
 * on one says which. Every drop and index-shift test passes `DROPS_YEARLESS` explicitly, and each
 * shape has a `KEEPS_YEARLESS` counterpart; the helpers default to dropping, which is what every
 * session did before the option existed.
 */
const DROPS_YEARLESS = false;
const KEEPS_YEARLESS = true;

/** A dealt but ungated session: `preparing`, deck shuffled, nothing resolved. */
function preparing(cards: Card[] = CARDS, seed = SEED, keepYearless = DROPS_YEARLESS): GameState {
  return gameReducer(initialGameState, {
    type: 'START',
    cards,
    playlists: [PLAYLIST],
    seed,
    keepYearless,
    skipUnconfirmed: false,
  });
}

/**
 * A session past the card-1 gate: card 1 resolved, everything else still `undefined`. With
 * `KEEPS_YEARLESS` there is no gate -- `START` already went to `playing` -- and card 1 is resolved
 * anyway, so both modes hand a test the same deck.
 */
function playing(cards: Card[] = CARDS, seed = SEED, keepYearless = DROPS_YEARLESS): GameState {
  const state = preparing(cards, seed, keepYearless);

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

/** The id of the card at `index` in a dealt deck, failing loudly rather than returning ''. */
function idAt(state: GameState, index: number): string {
  const found = state.deck[index];
  if (!found) throw new Error(`no card at index ${index}`);

  return found.id;
}

/** A `preparing` session dealt from a shared mid-game link that names `startCardId`. */
function preparingFrom(startCardId: string, cards: Card[] = CARDS, seed = SEED): GameState {
  return gameReducer(initialGameState, {
    type: 'START',
    cards,
    playlists: [PLAYLIST],
    seed,
    startCardId,
    keepYearless: DROPS_YEARLESS,
    skipUnconfirmed: false,
  });
}

/** The id the shuffle puts at `index` for `cards` and `seed` -- what a sender would share. */
function dealtIdAt(index: number, cards: Card[] = CARDS, seed = SEED): string {
  return idAt(preparing(cards, seed), index);
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
    expect(state.playlists).toEqual([PLAYLIST]);
    expect(state.currentIndex).toBe(0);
    expect(state.startIndex).toBe(0);
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
      playlists: [PLAYLIST],
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    });

    expect(state.seed).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should generate a different seed for each seedless START', () => {
    // Requirement 2 of the shuffle review ("a different order every game") rests on this, and the
    // format check above cannot see it: a seed cached anywhere between two deals would pass it.
    const deal = () =>
      gameReducer(initialGameState, {
        type: 'START',
        cards: CARDS,
        playlists: [PLAYLIST],
        keepYearless: DROPS_YEARLESS,
        skipUnconfirmed: false,
      }).seed;

    expect(deal()).not.toBe(deal());
  });

  it('should use an explicitly supplied seed on START', () => {
    // The forward-compatibility hook for Phase 8's shareable deck URL: the same playlist and
    // the same seed must deal the same deck, with no reducer change needed then.
    const state = preparing(CARDS, 'shared-deck-seed');

    expect(state.seed).toBe('shared-deck-seed');
    // Compared with the shuffle function rather than with a literal: pinning the algorithm's
    // OUTPUT is `shuffle.test.ts`'s job. This asserts which algorithm the reducer picks.
    expect(state.deck).toEqual(shuffleDeck(CARDS, 'shared-deck-seed'));
  });

  it('should deal with shuffleDeck, whatever order the cards arrive in', () => {
    // The reducer adds nothing to the shuffle: the deck is exactly `shuffleDeck` over the cards.
    // The reversed input is what "Play again" and a re-ordered fetch look like, and it must deal
    // the same deck from the same seed -- the property a share link's reproducibility rests on.
    const state = preparing();
    const reversed = gameReducer(initialGameState, {
      type: 'START',
      cards: [...CARDS].reverse(),
      playlists: [PLAYLIST],
      seed: SEED,
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    });

    expect(state.deck).toEqual(shuffleDeck(CARDS, SEED));
    expect(reversed.deck).toEqual(state.deck);
  });

  it('should start on the named card when START carries a startCardId', () => {
    // Decision D3: a mid-game link names the TRACK the sender was on, and the recipient starts on it.
    // Both indices land on it: nothing before it has been played by this player yet.
    const target = dealtIdAt(7);
    const state = preparingFrom(target);

    expect(state.currentIndex).toBe(7);
    expect(state.startIndex).toBe(7);
    expect(currentCard(state)?.id).toBe(target);
    // Same deck as a deal without the id -- the position changes, never the order.
    expect(state.deck).toEqual(preparing().deck);
  });

  it('should start on card 1 when the startCardId is not in the deck', () => {
    // The playlist changed since it was shared, or that card was already known yearless. The order is
    // still the sender's; only the position is lost, so the deal goes ahead from the top.
    const state = preparingFrom('not-in-this-deck');

    expect(state.currentIndex).toBe(0);
    expect(state.startIndex).toBe(0);
    expect(state.status).toBe('preparing');
  });

  it('should replace an existing session when START is dispatched again', () => {
    // Starting a new playlist mid-game must not merge into the old deck or keep the old index.
    const first = gameReducer(playing(), { type: 'NEXT' });
    const otherCards = [card('other-1'), card('other-2')];

    const second = gameReducer(first, {
      type: 'START',
      cards: otherCards,
      playlists: [{ id: 'other', name: 'Other', owner: 'Someone' }],
      seed: 'second',
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    });

    expect(second.status).toBe('preparing');
    expect(second.currentIndex).toBe(0);
    expect(second.deck.map((c) => c.id).sort()).toEqual(['other-1', 'other-2']);
    expect(second.playlists.map((p) => p.id)).toEqual(['other']);
  });

  it('should carry every playlist into state on START', () => {
    // The widened action (multi-playlist decision 2). The MERGE happened above the reducer, in
    // `deck-merge.ts`; all this branch does is record which playlists the deck came from, in row
    // order, so `deckLabel()` and the share link read the same list the player entered.
    const state = gameReducer(initialGameState, {
      type: 'START',
      cards: CARDS,
      playlists: [PLAYLIST, SECOND_PLAYLIST, THIRD_PLAYLIST],
      seed: SEED,
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    });

    expect(state.playlists).toEqual([PLAYLIST, SECOND_PLAYLIST, THIRD_PLAYLIST]);
  });

  it('should replace the playlists wholesale when START runs mid-game', () => {
    // The wholesale-replacement rule, now that the field is a list: a new SET of playlists must not
    // union with the old one. Three in, one out -- not four.
    const first = gameReducer(initialGameState, {
      type: 'START',
      cards: CARDS,
      playlists: [PLAYLIST, SECOND_PLAYLIST, THIRD_PLAYLIST],
      seed: SEED,
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    });

    const second = gameReducer(first, {
      type: 'START',
      cards: [card('other-1')],
      playlists: [SECOND_PLAYLIST],
      seed: 'second',
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    });

    expect(second.playlists).toEqual([SECOND_PLAYLIST]);
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
    const state = playing(CARDS, SEED, DROPS_YEARLESS);
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
    const state = playing([card('dup'), card('dup'), card('other')], 'dup-seed', DROPS_YEARLESS);

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
    let state = playing(CARDS, SEED, DROPS_YEARLESS);
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
    let state = playing(CARDS, SEED, DROPS_YEARLESS);
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
    let state = playing(CARDS, SEED, DROPS_YEARLESS);
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
    // played without their asking -- stepping back is the player's move (`PREVIOUS`, since
    // 2026-09-18), never the resolver's. `NEXT` past the last card ends the session; so does losing
    // the last card.
    let state = playing([card('a'), card('b')], 'two', DROPS_YEARLESS);
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
    const state = preparing([card('only')], 'one', DROPS_YEARLESS);
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

  it('should step back one card and reset the flip on PREVIOUS', () => {
    // The left swipe (2026-09-18). Reset the flip exactly as `NEXT` does: `isFlipped` describes the
    // CURRENT card and nothing remembers which earlier cards were revealed, so carrying it over
    // would hand the previous card's year to a player who may never have flipped it.
    let state = gameReducer(playing(), { type: 'NEXT' });
    state = gameReducer(state, { type: 'FLIP' });

    const previous = gameReducer(state, { type: 'PREVIOUS' });

    expect(previous.currentIndex).toBe(0);
    expect(previous.isFlipped).toBe(false);
    expect(previous.status).toBe('playing');
    // The deck itself is untouched: stepping back re-deals nothing and drops nothing.
    expect(previous.deck).toBe(state.deck);
  });

  it('should be a no-op on the first card for PREVIOUS', () => {
    // The SAME object, not an equal one: the gesture hook has already latched its commit, so the
    // reducer declining is what leaves the card on screen -- and it must never end the session or
    // wrap round to the last card.
    const state = playing();

    expect(gameReducer(state, { type: 'PREVIOUS' })).toBe(state);
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
    expect(gameReducer(initialGameState, { type: 'PREVIOUS' })).toBe(initialGameState);
    expect(gameReducer(initialGameState, { type: 'END' })).toBe(initialGameState);

    const prepared = preparing();
    expect(gameReducer(prepared, { type: 'FLIP' })).toBe(prepared);
    expect(gameReducer(prepared, { type: 'NEXT' })).toBe(prepared);
    expect(gameReducer(prepared, { type: 'PREVIOUS' })).toBe(prepared);

    const ended = gameReducer(playing(), { type: 'END' });
    expect(gameReducer(ended, { type: 'END' })).toBe(ended);
    expect(gameReducer(ended, { type: 'YEAR_LOOKUPS_UNAVAILABLE' })).toBe(ended);
  });

  it('should restore a full session on RESUME', () => {
    const session: PersistedSession = {
      version: 2,
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: [card('a', { year: 1975, yearConfidence: 'high' }), card('b'), card('c')],
      currentIndex: 2,
      startIndex: 1,
      isFlipped: true,
      status: 'playing',
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state).toEqual({
      status: 'playing',
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: session.deck,
      currentIndex: 2,
      startIndex: 1,
      isFlipped: true,
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
      // Re-derived by the next crawl rather than restored: it describes the server's
      // configuration, not the session.
      yearLookupsUnavailable: false,
    });
  });

  it('should restore every playlist on RESUME', () => {
    // A resumed multi-playlist deck has to come back knowing all of them, or the HUD label, the
    // share link and the save button would all describe a smaller deck than the one on screen.
    const session: PersistedSession = {
      version: 2,
      playlists: [PLAYLIST, SECOND_PLAYLIST, THIRD_PLAYLIST],
      seed: 'persisted-seed',
      deck: [card('a', { year: 1975, yearConfidence: 'high' })],
      currentIndex: 0,
      startIndex: 0,
      isFlipped: false,
      status: 'playing',
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state.playlists).toEqual([PLAYLIST, SECOND_PLAYLIST, THIRD_PLAYLIST]);
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
      version: 2,
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: [
        card('a', { year: 1975, yearConfidence: 'high' }),
        card('gone', { year: null, yearConfidence: 'none' }),
        card('b', { year: 1969, yearConfidence: 'low' }),
        card('c'),
      ],
      currentIndex: 2,
      startIndex: 0,
      isFlipped: false,
      status: 'playing',
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state.deck.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    // Still card `b`, which is where the player was -- index 2 became index 1.
    expect(state.currentIndex).toBe(1);
    expect(currentCard(state)?.id).toBe('b');
  });

  it('should end a resumed session whose every card was yearless', () => {
    const session: PersistedSession = {
      version: 2,
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: [card('x', { year: null, yearConfidence: 'none' })],
      currentIndex: 0,
      startIndex: 0,
      isFlipped: false,
      status: 'playing',
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state.deck).toHaveLength(0);
    expect(state.status).toBe('ended');
    expect(state.currentIndex).toBe(0);
    expect(state.startIndex).toBe(0);
  });
});

// ===========================================================================
//  THE START INDEX (2026-09-29)
//
//  The lowest index the player has been on. Zero for a deal from the top; the
//  link's card for a deal from a shared mid-game link. Always <= currentIndex,
//  and moved by dropped cards exactly as currentIndex is.
// ===========================================================================

describe('gameReducer startIndex', () => {
  /** A link-started game, past its gate: started on dealt index 5, that card resolved. */
  function playingFromFive(): GameState {
    const state = preparingFrom(dealtIdAt(5));

    return gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, 5),
      year: 1980,
      confidence: 'high',
    });
  }

  it('should leave startIndex alone on NEXT', () => {
    const state = gameReducer(playingFromFive(), { type: 'NEXT' });

    expect(state.currentIndex).toBe(6);
    expect(state.startIndex).toBe(5);
  });

  it('should lower startIndex when PREVIOUS steps below it', () => {
    // Stepping back past a link's start card shows the player cards they had not seen, so from
    // then on those count as played.
    let state = gameReducer(playingFromFive(), { type: 'PREVIOUS' });

    expect(state.currentIndex).toBe(4);
    expect(state.startIndex).toBe(4);

    state = gameReducer(state, { type: 'NEXT' });
    state = gameReducer(state, { type: 'NEXT' });
    state = gameReducer(state, { type: 'PREVIOUS' });

    // Back to 5 from 6: still above the lowest point, so the lowest point stays.
    expect(state.currentIndex).toBe(5);
    expect(state.startIndex).toBe(4);
  });

  it('should move startIndex back when a card before it is dropped', () => {
    const state = playingFromFive();
    const startId = idAt(state, 5);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, 2),
      year: null,
      confidence: 'none',
    });

    expect(next.startIndex).toBe(4);
    expect(next.currentIndex).toBe(4);
    // Still the same CARD, which is what the index is standing in for.
    expect(idAt(next, next.startIndex)).toBe(startId);
  });

  it('should leave startIndex alone when a card after it is dropped', () => {
    const state = gameReducer(playingFromFive(), { type: 'NEXT' });
    expect(state.currentIndex).toBe(6);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, 9),
      year: null,
      confidence: 'none',
    });

    expect(next.startIndex).toBe(5);
    expect(next.currentIndex).toBe(6);
  });

  it('should point startIndex at the following card when the start card itself is dropped', () => {
    // The player moved on to 7; the card they started on (5) then resolves yearless. The array
    // closes up: the player's index moves back by one to stay on their card, and the unchanged
    // start index now names the card that followed the dropped one.
    let state = gameReducer(playingFromFive(), { type: 'NEXT' });
    state = gameReducer(state, { type: 'NEXT' });
    const startId = idAt(state, 5);
    const followingId = idAt(state, 6);

    // A literal rather than a dispatch, because the start card has already resolved to a year in
    // `playingFromFive` and a second result for it cannot be produced through the reducer's inputs.
    const withPendingStart: GameState = {
      ...state,
      deck: state.deck.map((c) => (c.id === startId ? card(c.id) : c)),
    };

    const next = gameReducer(withPendingStart, {
      type: 'YEAR_RESOLVED',
      cardId: startId,
      year: null,
      confidence: 'none',
    });

    expect(next.startIndex).toBe(5);
    expect(idAt(next, next.startIndex)).toBe(followingId);
    expect(next.currentIndex).toBe(6);
    expect(next.startIndex).toBeLessThanOrEqual(next.currentIndex);
  });

  it('should keep startIndex within currentIndex when the last card drops mid-game', () => {
    // The case that would otherwise write an unloadable save: both indices on the last card, that
    // card drops, the deck shrinks under both.
    const cards = [card('a'), card('b'), card('c')];
    const lastId = dealtIdAt(2, cards, 'three');
    let state = preparingFrom(lastId, cards, 'three');
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: lastId,
      year: 1990,
      confidence: 'high',
    });
    expect(state.status).toBe('playing');

    const withPendingLast: GameState = {
      ...state,
      deck: state.deck.map((c) => (c.id === lastId ? card(c.id) : c)),
    };

    const next = gameReducer(withPendingLast, {
      type: 'YEAR_RESOLVED',
      cardId: lastId,
      year: null,
      confidence: 'none',
    });

    expect(next.status).toBe('ended');
    expect(next.currentIndex).toBe(1);
    expect(next.startIndex).toBe(1);
  });

  it('should restore startIndex on RESUME and move it back past dropped cards', () => {
    const session: PersistedSession = {
      version: 2,
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: [
        card('gone-1', { year: null, yearConfidence: 'none' }),
        card('a'),
        card('gone-2', { year: null, yearConfidence: 'none' }),
        card('start', { year: 1980, yearConfidence: 'high' }),
        card('here', { year: 1990, yearConfidence: 'high' }),
      ],
      currentIndex: 4,
      startIndex: 3,
      isFlipped: false,
      status: 'playing',
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state.deck.map((c) => c.id)).toEqual(['a', 'start', 'here']);
    expect(currentCard(state)?.id).toBe('here');
    expect(idAt(state, state.startIndex)).toBe('start');
  });

  it('should clamp a restored startIndex under the restored currentIndex', () => {
    // Both on the same yearless card: the player lands on the card that followed it, and the start
    // index must follow rather than pointing past the player.
    const session: PersistedSession = {
      version: 2,
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: [card('a'), card('gone', { year: null, yearConfidence: 'none' })],
      currentIndex: 1,
      startIndex: 1,
      isFlipped: false,
      status: 'playing',
      keepYearless: DROPS_YEARLESS,
      skipUnconfirmed: false,
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state.currentIndex).toBe(0);
    expect(state.startIndex).toBe(0);
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
    const state = preparing(CARDS, SEED, DROPS_YEARLESS);
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
    let state = preparing(CARDS, SEED, DROPS_YEARLESS);

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

  it('should skip preparing entirely when card 1 is already final', () => {
    // ===================================================================
    //  THE RESTART CASE, and it was a hang before this branch existed.
    //
    //  Phase 6's Restart re-deals `state.deck`, and a session can only have
    //  LEFT `preparing` because card 1's answer arrived -- so most restarts
    //  arrive with a resolved card 1. The resolver correctly refuses to look
    //  up a card whose answer is already final, which means no `YEAR_RESOLVED`
    //  is ever dispatched and nothing else can open the gate. The loading
    //  screen stayed up forever. Found 2026-08-05 via `App.test.tsx`'s
    //  restart test.
    //
    //  The premise is narrower since the provider vote: a FINAL year means
    //  there is nothing to wait for; a PROVISIONAL one does not (see "should
    //  keep gating while the start card is only provisional").
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

    const state = preparing(resolved, SEED, DROPS_YEARLESS);

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

    const state = preparing(mixed, 'mixed-seed', DROPS_YEARLESS);

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

  it('should wait on the start card rather than card 1 for a link-started deal', () => {
    // A mid-game link starts the player on the sender's card, so THAT is the card the gate waits on.
    // Card 1 resolving first must not open it onto a pending year.
    const state = preparingFrom(dealtIdAt(6));

    const afterFirst = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: firstCardId(state),
      year: 1970,
      confidence: 'high',
    });
    expect(afterFirst.status).toBe('preparing');

    const afterStart = gameReducer(afterFirst, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, 6),
      year: 1985,
      confidence: 'high',
    });
    expect(afterStart.status).toBe('playing');
    expect(afterStart.currentIndex).toBe(6);
  });

  it('should skip preparing when the start card is already resolved, even if card 1 is not', () => {
    const startId = dealtIdAt(3);
    const cards = CARDS.map((c) =>
      c.id === startId ? { ...c, year: 1975, yearConfidence: 'high' as const } : c,
    );

    expect(preparingFrom(startId, cards).status).toBe('playing');
  });

  it('should gate on the start card even when card 1 is already resolved', () => {
    const firstId = dealtIdAt(0);
    const cards = CARDS.map((c) =>
      c.id === firstId ? { ...c, year: 1975, yearConfidence: 'high' as const } : c,
    );

    expect(preparingFrom(dealtIdAt(3), cards).status).toBe('preparing');
  });

  it('should not end a game that never started when its last-card start is dropped', () => {
    // ===================================================================
    //  "DECK FINISHED" FOR A GAME THAT NEVER STARTED (review §4b).
    //
    //  A link whose card is last in this deck starts the player there; if
    //  that card turns out yearless while `preparing`, `playing`'s rule --
    //  nothing follows, so the deck is exhausted -- would end a game with
    //  every other card still in it. Nothing has been played, so the player
    //  is clamped to the new last card and the gate waits on that one.
    // ===================================================================
    const lastIndex = CARDS.length - 1;
    const state = preparingFrom(dealtIdAt(lastIndex));
    const newLastId = idAt(state, lastIndex - 1);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, lastIndex),
      year: null,
      confidence: 'none',
    });

    expect(next.status).toBe('preparing');
    expect(next.deck).toHaveLength(CARDS.length - 1);
    expect(next.currentIndex).toBe(lastIndex - 1);
    expect(next.startIndex).toBe(lastIndex - 1);
    expect(currentCard(next)?.id).toBe(newLastId);
    expect(next.isFlipped).toBe(false);
  });

  it('should open the gate at once when the new last card is already resolved', () => {
    // The same clamp, landing on a card whose year is already in: nothing left to wait for.
    const lastIndex = CARDS.length - 1;
    let state = preparingFrom(dealtIdAt(lastIndex));
    const newLastId = idAt(state, lastIndex - 1);

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: newLastId,
      year: 1999,
      confidence: 'high',
    });
    expect(state.status).toBe('preparing');

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, lastIndex),
      year: null,
      confidence: 'none',
    });

    expect(next.status).toBe('playing');
    expect(currentCard(next)?.id).toBe(newLastId);
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
    // Dispatched through a session that KEEPS yearless cards, which is how a live deck comes to
    // hold one again (plan.year-fetch-rework-game.md). Between the 2026-08-05 reversal and the
    // option this had to be a state literal, since every null result dropped its card.
    let state = gameReducer(playing(CARDS, SEED, KEEPS_YEARLESS), { type: 'NEXT' });
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: currentCard(state)?.id ?? '',
      year: null,
      confidence: 'none',
    });

    expect(currentCard(state)?.year).toBeNull();
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
    // It went uncalled from the 2026-08-05 removal of the preparing screen's "N of M years found"
    // line until 2026-08-07, when `pendingYearCount` -- its complement -- became the PDF export's
    // gate. Kept exported through that gap for exactly the reason that happened: a progress readout
    // is an obvious thing for a later phase to want back, from here rather than reinvented.
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
    const state = playing(CARDS, SEED, DROPS_YEARLESS);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: state.deck[7]?.id ?? '',
      year: null,
      confidence: 'none',
    });

    expect(resolvedCount(next)).toBe(1);
    expect(next.deck).toHaveLength(state.deck.length - 1);
  });

  it('should count the lookups still in flight', () => {
    // The complement of `resolvedCount`, and the PDF export's gate: zero means every card in the
    // deck carries a real year, because a lookup that finds nothing removes its card.
    let state = playing();
    expect(pendingYearCount(state)).toBe(state.deck.length - 1);

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: state.deck[7]?.id ?? '',
      year: 1984,
      confidence: 'high',
    });

    expect(pendingYearCount(state)).toBe(state.deck.length - 2);
  });

  it('should reach zero pending when a lookup finds nothing, because the card leaves', () => {
    // The case that makes the gate terminate. A null result does not linger as a pending card --
    // it takes the card with it -- so a deck MusicBrainz can only partly place still finishes.
    let state = playing([card('a'), card('b')], 'two', DROPS_YEARLESS);
    expect(pendingYearCount(state)).toBe(1);

    // By POSITION, not by id: `playing` resolves whichever card the shuffle put first, and which
    // of the two that is depends on the seed.
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: state.deck[1]?.id ?? '',
      year: null,
      confidence: 'none',
    });

    expect(pendingYearCount(state)).toBe(0);
    expect(state.deck).toHaveLength(1);
  });

  it('should count the whole deck as played for a deal from the top', () => {
    // `startIndex === 0`, so this is exactly the `deck.length` the end screen used to show.
    let state = playing([card('a'), card('b'), card('c')], 'three');
    state = gameReducer(state, { type: 'NEXT' });
    state = gameReducer(state, { type: 'NEXT' });
    state = gameReducer(state, { type: 'NEXT' });

    expect(state.status).toBe('ended');
    expect(cardsPlayed(state)).toBe(3);
  });

  it('should count only from the start card for a link-started deal', () => {
    // Review §4b: `deck.length` over-counted a mid-deck start by every card before it.
    const state = preparingFrom(dealtIdAt(15));

    expect(cardsPlayed(state)).toBe(CARDS.length - 15);
  });

  it('should count the cards a link-started player stepped back to', () => {
    let state = preparingFrom(dealtIdAt(15));
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, 15),
      year: 1980,
      confidence: 'high',
    });
    state = gameReducer(state, { type: 'PREVIOUS' });
    state = gameReducer(state, { type: 'PREVIOUS' });

    expect(cardsPlayed(state)).toBe(CARDS.length - 13);
  });

  it('should be safe on an empty deck', () => {
    expect(currentCard(initialGameState)).toBeUndefined();
    expect(isCurrentYearPending(initialGameState)).toBe(false);
    expect(cardsRemaining(initialGameState)).toBe(0);
    expect(cardsPlayed(initialGameState)).toBe(0);
    expect(resolvedCount(initialGameState)).toBe(0);
    expect(pendingYearCount(initialGameState)).toBe(0);
  });
});

// ===========================================================================
//  PROVISIONAL YEARS (plan.year-fetch-rework-game.md)
//
//  `/api/year`'s `resolve` stage may answer before its `verify` stage. The
//  reducer shows that year, flags it `yearProvisional`, and lets the final
//  answer replace it -- on every card, the current and revealed one included.
// ===========================================================================

/** The provisional arm of `YEAR_RESOLVED`: always a number, always `low`. */
function provisional(cardId: string, year: number) {
  return { type: 'YEAR_RESOLVED', cardId, year, confidence: 'low', provisional: true } as const;
}

describe('gameReducer provisional years', () => {
  it('should write a provisional year and mark it provisional', () => {
    const state = playing();
    const targetId = idAt(state, 5);

    const next = gameReducer(state, provisional(targetId, 1969));

    expect(next.deck.find((c) => c.id === targetId)).toMatchObject({
      year: 1969,
      yearConfidence: 'low',
      yearProvisional: true,
    });
  });

  it('should mark a provisional year that verify answered, and keep the mark on a later one', () => {
    // `yearVerifyAnswered` is what lets a reload remember that some verify came back with a year.
    // A later report without it -- a late resolve answer -- must not un-say that.
    const state = playing();
    const targetId = idAt(state, 5);

    const marked = gameReducer(state, { ...provisional(targetId, 1969), verifyAnswered: true });
    const later = gameReducer(marked, provisional(targetId, 1970));

    expect(marked.deck.find((c) => c.id === targetId)).toMatchObject({ yearVerifyAnswered: true });
    expect(later.deck.find((c) => c.id === targetId)).toMatchObject({
      year: 1970,
      yearProvisional: true,
      yearVerifyAnswered: true,
    });
  });

  it('should clear the verify mark with the provisional flag on a final answer', () => {
    const state = playing();
    const targetId = idAt(state, 5);

    const marked = gameReducer(state, { ...provisional(targetId, 1969), verifyAnswered: true });
    const next = gameReducer(marked, {
      type: 'YEAR_RESOLVED',
      cardId: targetId,
      year: 1969,
      confidence: 'high',
    });

    const settled = next.deck.find((c) => c.id === targetId);
    expect(settled).not.toHaveProperty('yearProvisional');
    expect(settled).not.toHaveProperty('yearVerifyAnswered');
  });

  it('should not drop a card on a provisional answer', () => {
    // A provisional answer always carries a year, so it can never take a card away -- only the
    // final answer can. Nothing else moves either: no index, no flip, no status.
    let state = gameReducer(playing(CARDS, SEED, DROPS_YEARLESS), { type: 'NEXT' });
    state = gameReducer(state, { type: 'FLIP' });

    const next = gameReducer(state, provisional(idAt(state, 1), 1984));

    expect(next.deck).toHaveLength(state.deck.length);
    expect(next.currentIndex).toBe(state.currentIndex);
    expect(next.isFlipped).toBe(true);
    expect(next.status).toBe('playing');
  });

  it('should update every copy of a duplicated id with the provisional year', () => {
    const state = playing([card('dup'), card('dup'), card('other')], 'dup-seed');

    const next = gameReducer(state, provisional('dup', 1991));

    expect(
      next.deck.filter((c) => c.id === 'dup').every((c) => c.year === 1991 && c.yearProvisional),
    ).toBe(true);
  });

  it('should replace a provisional year with a different final year on the current card', () => {
    // The revealed case: the player flipped a card showing its provisional year, and verification
    // then disagreed. The year changes in front of them -- plan 4's "confirming" line is what
    // warns them it might -- and the flip survives, because the card did not change.
    let state = gameReducer(playing(), { type: 'NEXT' });
    const currentId = currentCard(state)?.id ?? '';
    state = gameReducer(state, provisional(currentId, 1983));
    state = gameReducer(state, { type: 'FLIP' });

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: currentId,
      year: 1982,
      confidence: 'high',
    });

    expect(currentCard(next)?.id).toBe(currentId);
    expect(currentCard(next)?.year).toBe(1982);
    expect(currentCard(next)?.yearConfidence).toBe('high');
    expect(currentCard(next)).not.toHaveProperty('yearProvisional');
    expect(next.isFlipped).toBe(true);
  });

  it('should replace a provisional year with the same final year and clear the flag', () => {
    const base = playing();
    const targetId = idAt(base, 4);
    const state = gameReducer(base, provisional(targetId, 1977));

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: targetId,
      year: 1977,
      confidence: 'low',
    });

    const updated = next.deck.find((c) => c.id === targetId);
    expect(updated).toMatchObject({ year: 1977, yearConfidence: 'low' });
    // Absent, not `false`: the flag exists only as `true`, which is what a save validates.
    expect(updated).not.toHaveProperty('yearProvisional');
    expect(yearStateOf(updated)).toBe('final');
  });

  it('should ignore a provisional answer for a card that is already final', () => {
    // The two stages run in separate lanes, and after a resume or a retry their answers can land in
    // either order. A late provisional year must never un-verify a card -- and declining returns the
    // SAME object, so it costs no re-render.
    const state = playing();

    expect(gameReducer(state, provisional(firstCardId(state), 1999))).toBe(state);
  });

  it('should ignore a provisional answer for a card whose kept null is final', () => {
    let state = playing(CARDS, SEED, KEEPS_YEARLESS);
    const targetId = idAt(state, 3);
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: targetId,
      year: null,
      confidence: 'none',
    });

    expect(gameReducer(state, provisional(targetId, 1999))).toBe(state);
  });

  it('should ignore a provisional answer for an unknown card id or after END', () => {
    const state = playing();
    expect(gameReducer(state, provisional('not-in-this-deck', 1999))).toBe(state);

    const ended = gameReducer(state, { type: 'END' });
    expect(gameReducer(ended, provisional(idAt(ended, 2), 1999))).toBe(ended);
  });
});

// ===========================================================================
//  THE CARD-1 GATE WAITS FOR A FINAL ANSWER (option OFF)
// ===========================================================================

describe('gameReducer card-1 gate and provisional years', () => {
  it('should keep gating while the start card is only provisional', () => {
    // A provisional year may still turn into a final null and take the card away, so the player
    // must not land on it yet. This is the premise the old "skip preparing when card 1 is already
    // resolved" test no longer has: a year is not enough, it has to be final.
    const state = preparing(CARDS, SEED, DROPS_YEARLESS);

    const next = gameReducer(state, provisional(firstCardId(state), 1975));

    expect(next.status).toBe('preparing');
    expect(currentCard(next)?.year).toBe(1975);
  });

  it('should keep gating a re-dealt deck whose start card is still provisional', () => {
    // Restart re-deals `state.deck`, and a card still awaiting `verify` keeps its flag on the way
    // through START. Without this, a restart would skip the gate onto a card that may yet drop.
    const firstId = firstCardId(preparing());
    const redealt = CARDS.map((c) =>
      c.id === firstId
        ? { ...c, year: 1975, yearConfidence: 'low' as const, yearProvisional: true as const }
        : { ...c, year: 1980, yearConfidence: 'high' as const },
    );

    const state = preparing(redealt, SEED, DROPS_YEARLESS);

    expect(firstCardId(state)).toBe(firstId);
    expect(state.status).toBe('preparing');
  });

  it("should open the gate when the start card's answer becomes final", () => {
    let state = preparing(CARDS, SEED, DROPS_YEARLESS);
    const firstId = firstCardId(state);
    state = gameReducer(state, provisional(firstId, 1975));

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: firstId,
      year: 1975,
      confidence: 'high',
    });

    expect(next.status).toBe('playing');
  });

  it("should move the gate to the next card when the start card's final answer is null", () => {
    let state = preparing(CARDS, SEED, DROPS_YEARLESS);
    const firstId = firstCardId(state);
    const secondId = idAt(state, 1);
    state = gameReducer(state, provisional(firstId, 1975));

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: firstId,
      year: null,
      confidence: 'none',
    });

    // Verification found nothing after all: the card leaves and the gate waits on its successor.
    expect(state.status).toBe('preparing');
    expect(firstCardId(state)).toBe(secondId);

    state = gameReducer(state, provisional(secondId, 1990));
    expect(state.status).toBe('preparing');

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: secondId,
      year: 1990,
      confidence: 'low',
    });
    expect(state.status).toBe('playing');
  });
});

// ===========================================================================
//  keepYearless (plan.year-fetch-rework-game.md, spike §12.8)
//
//  The picker's "Keep cards with no year found". ON: nothing gates, and a
//  final null keeps its card. Most tests here are the ON counterpart of a
//  drop or index-shift shape above.
// ===========================================================================

describe('gameReducer with keepYearless', () => {
  it('should record keepYearless on START, both ways', () => {
    expect(preparing(CARDS, SEED, KEEPS_YEARLESS).keepYearless).toBe(true);
    expect(preparing(CARDS, SEED, DROPS_YEARLESS).keepYearless).toBe(false);
    expect(initialGameState.keepYearless).toBe(false);
  });

  it('should go straight to playing when keepYearless is true', () => {
    // The gate exists so the player never lands on a card about to be dropped. Nothing is ever
    // dropped here, so there is nothing to wait for -- the year slot shows its pending state.
    const state = preparing(CARDS, SEED, KEEPS_YEARLESS);

    expect(state.status).toBe('playing');
    expect(currentCard(state)?.year).toBeUndefined();
  });

  it('should go straight to playing from a link start card when keepYearless is true', () => {
    const state = gameReducer(initialGameState, {
      type: 'START',
      cards: CARDS,
      playlists: [PLAYLIST],
      seed: SEED,
      startCardId: dealtIdAt(6),
      keepYearless: KEEPS_YEARLESS,
      skipUnconfirmed: false,
    });

    expect(state.status).toBe('playing');
    expect(state.currentIndex).toBe(6);
  });

  it('should keep a card whose final answer is null when keepYearless is true', () => {
    const state = playing(CARDS, SEED, KEEPS_YEARLESS);
    const targetId = idAt(state, 5);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: targetId,
      year: null,
      confidence: 'none',
    });

    expect(next.deck).toHaveLength(state.deck.length);
    expect(next.deck.find((c) => c.id === targetId)).toMatchObject({
      year: null,
      yearConfidence: 'none',
    });
    expect(next.currentIndex).toBe(state.currentIndex);
  });

  it('should keep a provisional card whose final answer is null, and clear its flag', () => {
    let state = playing(CARDS, SEED, KEEPS_YEARLESS);
    const targetId = idAt(state, 5);
    state = gameReducer(state, provisional(targetId, 1988));

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: targetId,
      year: null,
      confidence: 'none',
    });

    const kept = next.deck.find((c) => c.id === targetId);
    expect(kept?.year).toBeNull();
    expect(kept).not.toHaveProperty('yearProvisional');
    expect(yearStateOf(kept)).toBe('final');
  });

  it('should keep every copy of a duplicated id whose final answer is null', () => {
    const state = playing([card('dup'), card('dup'), card('other')], 'dup-seed', KEEPS_YEARLESS);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: 'dup',
      year: null,
      confidence: 'none',
    });

    const copies = next.deck.filter((c) => c.id === 'dup');
    expect(copies).toHaveLength(2);
    expect(copies.every((c) => c.year === null)).toBe(true);
  });

  it('should leave the current index alone when a null lands behind the player', () => {
    let state = playing(CARDS, SEED, KEEPS_YEARLESS);
    state = gameReducer(state, { type: 'NEXT' });
    state = gameReducer(state, { type: 'NEXT' });
    const currentId = currentCard(state)?.id;

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, 0),
      year: null,
      confidence: 'none',
    });

    expect(next.currentIndex).toBe(2);
    expect(currentCard(next)?.id).toBe(currentId);
  });

  it('should keep the current card and its flip when its final answer is null', () => {
    // With the option off, this card leaves and the flip is reset so the incoming card is not
    // revealed for free. With it on, the card stays: the player keeps looking at it, revealed, now
    // saying no year was found.
    let state = playing(CARDS, SEED, KEEPS_YEARLESS);
    state = gameReducer(state, { type: 'NEXT' });
    state = gameReducer(state, { type: 'FLIP' });
    const currentId = currentCard(state)?.id ?? '';

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: currentId,
      year: null,
      confidence: 'none',
    });

    expect(currentCard(next)?.id).toBe(currentId);
    expect(currentCard(next)?.year).toBeNull();
    expect(next.isFlipped).toBe(true);
  });

  it('should keep playing when the current last card gets a null', () => {
    let state = playing([card('a'), card('b')], 'two', KEEPS_YEARLESS);
    state = gameReducer(state, { type: 'NEXT' });

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: currentCard(state)?.id ?? '',
      year: null,
      confidence: 'none',
    });

    expect(next.status).toBe('playing');
    expect(next.deck).toHaveLength(2);
  });

  it('should not end a one-card deck whose only card gets a null', () => {
    const state = preparing([card('only')], 'one', KEEPS_YEARLESS);

    const next = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: 'only',
      year: null,
      confidence: 'none',
    });

    expect(next.deck).toHaveLength(1);
    expect(next.status).toBe('playing');
  });

  it('should leave startIndex alone when a card before it gets a null', () => {
    let state = gameReducer(initialGameState, {
      type: 'START',
      cards: CARDS,
      playlists: [PLAYLIST],
      seed: SEED,
      startCardId: dealtIdAt(5),
      keepYearless: KEEPS_YEARLESS,
      skipUnconfirmed: false,
    });
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, 2),
      year: null,
      confidence: 'none',
    });

    expect(state.startIndex).toBe(5);
    expect(state.currentIndex).toBe(5);
  });

  it('should deal yearless cards rather than filtering them when keepYearless is true', () => {
    // The START counterpart of "should filter yearless cards out of a re-dealt deck": a Restart of a
    // session that kept its nulls re-deals them.
    const mixed = [
      card('keep-1', { year: 1975, yearConfidence: 'high' }),
      card('null-1', { year: null, yearConfidence: 'none' }),
      card('keep-2', { year: 1969, yearConfidence: 'low' }),
    ];

    const state = preparing(mixed, 'mixed-seed', KEEPS_YEARLESS);

    expect(state.deck.map((c) => c.id).sort()).toEqual(['keep-1', 'keep-2', 'null-1']);
    expect(state.status).toBe('playing');
  });

  it('should deal a deck of nothing but yearless cards when keepYearless is true', () => {
    const yearless = CARDS.map((c) => ({ ...c, year: null, yearConfidence: 'none' as const }));

    const state = preparing(yearless, SEED, KEEPS_YEARLESS);

    expect(state.deck).toHaveLength(CARDS.length);
    expect(state.status).toBe('playing');
  });

  it("should restart with the session's keepYearless", () => {
    // `App.tsx`'s `handleRestart` re-deals `state.deck` with `state.keepYearless`. The option must
    // survive (a kept null stays kept), and so must a provisional flag, or every card still
    // awaiting `verify` would turn final on a restart and never be verified.
    let state = playing(CARDS, SEED, KEEPS_YEARLESS);
    const keptId = idAt(state, 2);
    const provisionalId = idAt(state, 3);
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: keptId,
      year: null,
      confidence: 'none',
    });
    state = gameReducer(state, provisional(provisionalId, 1966));

    const restarted = gameReducer(state, {
      type: 'START',
      cards: state.deck,
      playlists: state.playlists,
      keepYearless: state.keepYearless,
      skipUnconfirmed: state.skipUnconfirmed,
    });

    expect(restarted.keepYearless).toBe(true);
    expect(restarted.deck).toHaveLength(state.deck.length);
    expect(restarted.deck.find((c) => c.id === keptId)?.year).toBeNull();
    expect(restarted.deck.find((c) => c.id === provisionalId)?.yearProvisional).toBe(true);

    // And the other way round: a dropping session restarts as a dropping session.
    const dropping = playing(CARDS, SEED, DROPS_YEARLESS);
    const redealt = gameReducer(dropping, {
      type: 'START',
      cards: dropping.deck,
      playlists: dropping.playlists,
      keepYearless: dropping.keepYearless,
      skipUnconfirmed: dropping.skipUnconfirmed,
    });
    expect(redealt.keepYearless).toBe(false);
  });
});

describe('gameReducer RESUME and keepYearless', () => {
  /** A save holding a null before the player's card, and a provisional card. */
  function savedSession(keepYearless: boolean): PersistedSession {
    return {
      version: 2,
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: [
        card('a', { year: 1975, yearConfidence: 'high' }),
        card('kept', { year: null, yearConfidence: 'none' }),
        card('maybe', { year: 1980, yearConfidence: 'low', yearProvisional: true }),
        card('here'),
      ],
      currentIndex: 3,
      startIndex: 0,
      isFlipped: false,
      status: 'playing',
      keepYearless,
      skipUnconfirmed: false,
    };
  }

  it('should keep yearless cards on resume when the save keeps them', () => {
    const state = gameReducer(initialGameState, {
      type: 'RESUME',
      session: savedSession(KEEPS_YEARLESS),
    });

    expect(state.keepYearless).toBe(true);
    expect(state.deck.map((c) => c.id)).toEqual(['a', 'kept', 'maybe', 'here']);
    expect(state.currentIndex).toBe(3);
    expect(currentCard(state)?.id).toBe('here');
  });

  it('should drop yearless cards on resume when the save drops them, keeping provisional ones', () => {
    const state = gameReducer(initialGameState, {
      type: 'RESUME',
      session: savedSession(DROPS_YEARLESS),
    });

    expect(state.keepYearless).toBe(false);
    expect(state.deck.map((c) => c.id)).toEqual(['a', 'maybe', 'here']);
    expect(currentCard(state)?.id).toBe('here');
    // Resumed exactly as saved, so the resolver sends it straight to `verify`.
    expect(state.deck.find((c) => c.id === 'maybe')?.yearProvisional).toBe(true);
  });

  it('should read a save without keepYearless as false', () => {
    // `loadSession()` supplies the default; this pins that the reducer lands on the same side when
    // handed a session that lacks the field anyway.
    const legacy: Record<string, unknown> = { ...savedSession(KEEPS_YEARLESS) };
    delete legacy['keepYearless'];

    const state = gameReducer(initialGameState, {
      type: 'RESUME',
      session: legacy as unknown as PersistedSession,
    });

    expect(state.keepYearless).toBe(false);
    expect(state.deck.some((c) => c.year === null)).toBe(false);
  });

  it('should not end a resumed all-yearless session that keeps its yearless cards', () => {
    const session: PersistedSession = {
      ...savedSession(KEEPS_YEARLESS),
      deck: [card('x', { year: null, yearConfidence: 'none' })],
      currentIndex: 0,
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });

    expect(state.deck).toHaveLength(1);
    expect(state.status).toBe('playing');
  });
});

describe('yearStateOf and the year selectors', () => {
  it('should read all three states', () => {
    expect(yearStateOf(card('a'))).toBe('pending');
    expect(
      yearStateOf(card('b', { year: 1980, yearConfidence: 'low', yearProvisional: true })),
    ).toBe('provisional');
    expect(yearStateOf(card('c', { year: 1980, yearConfidence: 'high' }))).toBe('final');
    // A kept null is final: every provider was asked.
    expect(yearStateOf(card('d', { year: null, yearConfidence: 'none' }))).toBe('final');
    // A missing card is pending, which is what keeps an empty slot from opening a gate.
    expect(yearStateOf(undefined)).toBe('pending');
  });

  it('should count a provisional card as pending, but not report the current card pending', () => {
    // ===================================================================
    //  THE TWO SELECTORS DISAGREE HERE ON PURPOSE.
    //
    //  The year slot SHOWS a provisional year, so it is not pending there;
    //  the PDF must wait for verification, so it is pending in the count.
    // ===================================================================
    let state = gameReducer(playing(), { type: 'NEXT' });
    const currentId = currentCard(state)?.id ?? '';
    const before = pendingYearCount(state);

    state = gameReducer(state, provisional(currentId, 1988));

    expect(isCurrentYearPending(state)).toBe(false);
    expect(pendingYearCount(state)).toBe(before);
    expect(resolvedCount(state)).toBe(1);

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: currentId,
      year: 1988,
      confidence: 'high',
    });

    expect(pendingYearCount(state)).toBe(before - 1);
    expect(resolvedCount(state)).toBe(2);
  });

  it('should count a kept null as resolved', () => {
    let state = playing(CARDS, SEED, KEEPS_YEARLESS);

    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: idAt(state, 7),
      year: null,
      confidence: 'none',
    });

    expect(resolvedCount(state)).toBe(2);
    expect(pendingYearCount(state)).toBe(CARDS.length - 2);
  });
});

// ===========================================================================
//  skipUnconfirmed (2026-10-01): the picker's "Deal cards with an unconfirmed
//  year", UNTICKED. A FINAL `low` year drops its card by the same rule as a final null;
//  a PROVISIONAL year (always `low`) never does.
// ===========================================================================

describe('gameReducer with skipUnconfirmed', () => {
  function deal(
    cards: Card[],
    options: { keepYearless?: boolean; skipUnconfirmed?: boolean } = {},
  ): GameState {
    return gameReducer(initialGameState, {
      type: 'START',
      cards,
      playlists: [PLAYLIST],
      seed: SEED,
      keepYearless: options.keepYearless ?? DROPS_YEARLESS,
      skipUnconfirmed: options.skipUnconfirmed ?? true,
    });
  }

  it('should record skipUnconfirmed on START, and default it off', () => {
    expect(deal(CARDS).skipUnconfirmed).toBe(true);
    expect(deal(CARDS, { skipUnconfirmed: false }).skipUnconfirmed).toBe(false);
    expect(initialGameState.skipUnconfirmed).toBe(false);
  });

  it('should drop a card whose final answer is low, moving the index like a null does', () => {
    let state = deal(CARDS, { keepYearless: KEEPS_YEARLESS });
    // Kept yearless + skipping unconfirmed can still drop, so this deal must NOT skip the gate...
    expect(state.status).toBe('preparing');

    // ...and a final `low` on the start card drops it, so the gate keeps waiting on the next one.
    const first = firstCardId(state);
    const second = idAt(state, 1);
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: first,
      year: 1980,
      confidence: 'low',
    });
    expect(state.deck.some((c) => c.id === first)).toBe(false);
    expect(state.deck).toHaveLength(CARDS.length - 1);
    expect(state.status).toBe('preparing');
    expect(currentCard(state)?.id).toBe(second);

    // A `high` answer opens it.
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: second,
      year: 1981,
      confidence: 'high',
    });
    expect(state.status).toBe('playing');

    // A kept null stays: skipping unconfirmed years does not touch the yearless rule.
    const third = idAt(state, 1);
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: third,
      year: null,
      confidence: 'none',
    });
    expect(state.deck.find((c) => c.id === third)?.year).toBeNull();
  });

  it('should keep a final low card when skipUnconfirmed is off', () => {
    let state = deal(CARDS, { skipUnconfirmed: false });
    const first = firstCardId(state);
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: first,
      year: 1980,
      confidence: 'low',
    });

    expect(state.deck.find((c) => c.id === first)?.yearConfidence).toBe('low');
    expect(state.status).toBe('playing');
  });

  it('should never drop a provisional year, which is always low', () => {
    let state = deal(CARDS);
    const first = firstCardId(state);
    state = gameReducer(state, provisional(first, 1980));

    expect(state.deck.find((c) => c.id === first)?.yearProvisional).toBe(true);
    expect(state.deck).toHaveLength(CARDS.length);
    // Still gated: the provisional year may yet settle at `low`.
    expect(state.status).toBe('preparing');
  });

  it('should filter final low cards on START but keep provisional ones (a Restart re-deal)', () => {
    const cards = [
      card('confirmed', { year: 1975, yearConfidence: 'high' }),
      card('unconfirmed', { year: 1979, yearConfidence: 'low' }),
      card('verifying', { year: 1983, yearConfidence: 'low', yearProvisional: true }),
      card('pending'),
    ];

    const skipping = deal(cards);
    expect(skipping.deck.map((c) => c.id).sort()).toEqual(['confirmed', 'pending', 'verifying']);

    const keeping = deal(cards, { skipUnconfirmed: false });
    expect(keeping.deck).toHaveLength(4);
  });

  it('should go straight to playing only when the session can drop nothing', () => {
    expect(deal(CARDS, { keepYearless: true, skipUnconfirmed: false }).status).toBe('playing');
    expect(deal(CARDS, { keepYearless: true, skipUnconfirmed: true }).status).toBe('preparing');
    expect(deal(CARDS, { keepYearless: false, skipUnconfirmed: false }).status).toBe('preparing');
  });

  it('should filter final low cards on RESUME and move the index past them', () => {
    const session: PersistedSession = {
      version: 2,
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: [
        card('a', { year: 1975, yearConfidence: 'high' }),
        card('unconfirmed', { year: 1979, yearConfidence: 'low' }),
        card('verifying', { year: 1983, yearConfidence: 'low', yearProvisional: true }),
        card('here'),
      ],
      currentIndex: 3,
      startIndex: 0,
      isFlipped: false,
      status: 'playing',
      keepYearless: false,
      skipUnconfirmed: true,
    };

    const state = gameReducer(initialGameState, { type: 'RESUME', session });
    expect(state.skipUnconfirmed).toBe(true);
    expect(state.deck.map((c) => c.id)).toEqual(['a', 'verifying', 'here']);
    expect(currentCard(state)?.id).toBe('here');

    const kept = gameReducer(initialGameState, {
      type: 'RESUME',
      session: { ...session, skipUnconfirmed: false },
    });
    expect(kept.deck).toHaveLength(4);
    expect(currentCard(kept)?.id).toBe('here');
  });

  // =========================================================================
  //  An UNVERIFIED year (2026-10-01): verify ran out of retries and none came
  //  back with a year -- typically no connection -- so it was never put to a
  //  second provider. It is
  //  unchecked, not unconfirmed, and skipping unconfirmed years must not drop it.
  // =========================================================================

  it('should keep an unverified low year and mark the card', () => {
    let state = deal(CARDS, { keepYearless: KEEPS_YEARLESS });
    const first = firstCardId(state);
    state = gameReducer(state, provisional(first, 1980));
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: first,
      year: 1980,
      confidence: 'low',
      unverified: true,
    });

    const kept = state.deck.find((c) => c.id === first);
    expect(kept).toMatchObject({ year: 1980, yearConfidence: 'low', yearUnverified: true });
    expect(kept).not.toHaveProperty('yearProvisional');
    expect(state.deck).toHaveLength(CARDS.length);
    // Final, so the gate opens on it.
    expect(state.status).toBe('playing');
  });

  it('should ignore the unverified mark on a null, which keeps its old rule', () => {
    // The null case is unchanged: a final null still drops while yearless cards are dropped, and
    // the card never carries the mark.
    let state = deal(CARDS);
    const first = firstCardId(state);
    state = gameReducer(state, {
      type: 'YEAR_RESOLVED',
      cardId: first,
      year: null,
      confidence: 'none',
      unverified: true,
    });
    expect(state.deck.some((c) => c.id === first)).toBe(false);

    let keeping = deal(CARDS, { keepYearless: KEEPS_YEARLESS });
    const id = firstCardId(keeping);
    keeping = gameReducer(keeping, {
      type: 'YEAR_RESOLVED',
      cardId: id,
      year: null,
      confidence: 'none',
      unverified: true,
    });
    expect(keeping.deck.find((c) => c.id === id)).not.toHaveProperty('yearUnverified');
  });

  it('should keep unverified cards through a Restart re-deal and a RESUME', () => {
    const cards = [
      card('unconfirmed', { year: 1979, yearConfidence: 'low' }),
      card('unchecked', { year: 1981, yearConfidence: 'low', yearUnverified: true }),
      card('pending'),
    ];
    expect(
      deal(cards)
        .deck.map((c) => c.id)
        .sort(),
    ).toEqual(['pending', 'unchecked']);

    const session: PersistedSession = {
      version: 2,
      playlists: [PLAYLIST],
      seed: 'persisted-seed',
      deck: cards,
      currentIndex: 1,
      startIndex: 0,
      isFlipped: false,
      status: 'playing',
      keepYearless: false,
      skipUnconfirmed: true,
    };
    const resumed = gameReducer(initialGameState, { type: 'RESUME', session });
    expect(resumed.deck.map((c) => c.id)).toEqual(['unchecked', 'pending']);
    expect(currentCard(resumed)?.id).toBe('unchecked');
  });
});
