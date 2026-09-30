/**
 * The share link, end to end below React: a SENDER deals a deck through the real merge and the real
 * reducer, a link is built from their state exactly as `DeckActions` builds it, and a RECIPIENT
 * parses it and deals their own fetch through the same two functions.
 *
 * Node environment, no docblock: every piece is pure. This file exists because each half was tested
 * alone and the PAIR never was (review of the shuffle system, 2026-09-29, §6 gaps 3 and 4) -- which
 * is how a link copied after "Play again" shipped dealing an unrelated order for as long as it did.
 *
 * ===========================================================================
 *  WHAT IS COMPARED IS THE ORDER OF TRACK IDS, NEVER WHOLE CARDS.
 *
 *  The sender's cards carry years the recipient's have not looked up yet, and a
 *  sender's deck has usually lost its yearless cards. The promise a link makes
 *  is about ORDER -- the sender's cards, in the sender's order -- so every
 *  assertion here is over ids, and "restricted to the sender's cards" is how a
 *  recipient's fuller deck is compared with a sender's shrunken one.
 * ===========================================================================
 */

import { describe, expect, it } from 'vitest';

import { buildDeckLink, parseDeckLink, type DeckLink } from './deck-link';
import { mergePlaylists, type MergedDeck } from './deck-merge';
import type { PlaylistOutcome } from './playlist-client';
import { currentCard, gameReducer, initialGameState } from './reducer';
import { shuffleDeck } from './shuffle';
import type { GameState } from './types';
import type { Card, PlaylistSummary } from '../../shared/types';

const ORIGIN = 'https://jitster.example/';

/** 16 lowercase hex characters -- the shape `generateSeed()` mints and `parseDeckLink` accepts. */
const SEED = 'a1b2c3d4e5f60718';

/** Two real-shaped 22-character playlist ids. */
const FIRST: PlaylistSummary = { id: '37i9dQZF1DXcBWIGoYBM5M', name: 'Today', owner: 'Spotify' };
const SECOND: PlaylistSummary = { id: '37i9dQZF1DX0XUsuxWHRQd', name: 'Rap', owner: 'Spotify' };

/**
 * `count` cards whose ids are 22 base62 characters, tagged by `tag` so a test can tell which
 * playlist a dealt card came from. Only the id matters to the deal; the rest is the minimum a
 * `Card` must carry.
 */
function tracks(tag: string, count: number, from = 0): Card[] {
  return Array.from({ length: count }, (_, i) => {
    const suffix = `${from + i}`.padStart(4, '0');
    const id = `${tag}${'x'.repeat(22 - tag.length - suffix.length)}${suffix}`;
    return {
      id,
      title: `Track ${id}`,
      artist: `Artist ${tag}`,
      durationMs: 200_000,
      isPlayable: true,
    };
  });
}

function outcome(playlist: PlaylistSummary, cards: Card[]): PlaylistOutcome {
  return { ok: true, result: { playlist, cards, truncated: false, skippedCount: 0 } };
}

/** A fetch of both playlists, folded exactly as `usePlaylist` folds one. */
function fetchDeck(first: Card[], second: Card[]): MergedDeck {
  const merged = mergePlaylists([outcome(FIRST, first), outcome(SECOND, second)]);
  if (!merged.ok) throw new Error(`fixture merge failed: ${merged.code}`);
  return merged.deck;
}

/** `START` over a fetched deck, the way `useGameSession.start()` dispatches it. */
function deal(deck: MergedDeck, options: { seed?: string; startCardId?: string } = {}): GameState {
  return gameReducer(initialGameState, {
    type: 'START',
    cards: deck.cards,
    playlists: deck.playlists,
    ...options,
  });
}

/** The link `DeckActions` builds from a state: the loaded playlists and the seed. */
function shareLink(state: GameState, cardId?: string): string {
  return buildDeckLink(
    ORIGIN,
    state.playlists.map((playlist) => playlist.id),
    state.seed,
    cardId === undefined ? {} : { cardId },
  );
}

/** What `App.tsx` gets back out of `location.search` for that link. */
function openLink(url: string): DeckLink {
  const link = parseDeckLink(url.slice(url.indexOf('?')));
  if (link === null) throw new Error(`the app built a link its own parser rejects: ${url}`);
  return link;
}

/** The recipient's deal: their own fetch, the link's seed and card. */
function dealFromLink(deck: MergedDeck, link: DeckLink): GameState {
  return deal(deck, {
    seed: link.seed,
    ...(link.cardId === null ? {} : { startCardId: link.cardId }),
  });
}

function idsOf(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id);
}

/** `cards`' ids in their order, keeping only those in `keep` -- a fuller deck seen as a smaller one. */
function idsRestrictedTo(cards: readonly Card[], keep: readonly Card[]): string[] {
  const kept = new Set(idsOf(keep));
  return idsOf(cards).filter((id) => kept.has(id));
}

describe('a share link reproduces the sender deck', () => {
  it('should deal a recipient the sender order exactly, for a two-playlist deck', () => {
    // Several generated seeds rather than one literal, so a pass is not one lucky permutation.
    for (let game = 0; game < 25; game++) {
      const sender = deal(fetchDeck(tracks('a', 30), tracks('b', 20)));
      const link = openLink(shareLink(sender));

      // A separate fetch of the same playlists: new objects, the same content.
      const recipient = dealFromLink(fetchDeck(tracks('a', 30), tracks('b', 20)), link);

      expect(link.playlistIds).toEqual([FIRST.id, SECOND.id]);
      expect(idsOf(recipient.deck)).toEqual(idsOf(sender.deck));
    }
  });

  it('should still reproduce the deck after "Play again"', () => {
    // ===================================================================
    //  THE BUG THIS PINS (review §4a).
    //
    //  "Play again" re-deals `state.deck` -- already shuffled, already
    //  missing its yearless cards -- with a FRESH seed, and the link then
    //  carries that seed. The recipient applies it to the RAW fetch. Under
    //  the Fisher-Yates this app used until 2026-09-29, same seed over a
    //  different input list was an unrelated order; under the hash sort the
    //  input order is irrelevant, so the recipient's deck restricted to the
    //  sender's cards IS the sender's deck.
    // ===================================================================
    for (let game = 0; game < 25; game++) {
      const fetched = fetchDeck(tracks('a', 30), tracks('b', 20));
      let sender = deal(fetched);

      // A crawl: the first card gets a year, and every fourth card is found yearless and dropped.
      const firstId = sender.deck[0]!.id;
      sender = gameReducer(sender, {
        type: 'YEAR_RESOLVED',
        cardId: firstId,
        year: 1990,
        confidence: 'high',
      });
      for (const [index, card] of [...sender.deck].entries()) {
        if (index % 4 !== 3) continue;
        sender = gameReducer(sender, {
          type: 'YEAR_RESOLVED',
          cardId: card.id,
          year: null,
          confidence: 'none',
        });
      }
      expect(sender.deck.length).toBeLessThan(fetched.cards.length);

      // "Play again" exactly as `App.tsx`'s `handleRestart` deals it: the live deck and no seed --
      // so a fresh one.
      const restarted = gameReducer(sender, {
        type: 'START',
        cards: sender.deck,
        playlists: sender.playlists,
      });
      expect(restarted.seed).not.toBe(sender.seed);

      const link = openLink(shareLink(restarted));
      const recipient = dealFromLink(fetchDeck(tracks('a', 30), tracks('b', 20)), link);

      // The recipient has the dropped cards back (their crawl has not run), and every one of the
      // sender's cards sits in the sender's order among them.
      expect(recipient.deck.length).toBe(fetched.cards.length);
      expect(idsRestrictedTo(recipient.deck, restarted.deck)).toEqual(idsOf(restarted.deck));
    }
  });

  it('should deal a link as shuffleDeck over the raw merged fetch, with or without v=2', () => {
    // A link minted by the versioned build (104c1e2) carries `v=2`; the parser ignores it, so it
    // deals exactly what the same link without it deals -- which is `shuffleDeck` over the fetch.
    const bare = `${ORIGIN.slice(0, -1)}?playlist=${FIRST.id},${SECOND.id}&seed=${SEED}`;
    const fetched = fetchDeck(tracks('a', 30), tracks('b', 20));
    const expected = idsOf(shuffleDeck(fetched.cards, SEED));

    for (const url of [bare, `${bare}&v=2`]) {
      const recipient = dealFromLink(fetchDeck(tracks('a', 30), tracks('b', 20)), openLink(url));
      expect(idsOf(recipient.deck)).toEqual(expected);
    }
  });

  it('should never put a v in a shared link', () => {
    const sender = deal(fetchDeck(tracks('a', 30), tracks('b', 20)));

    expect(shareLink(sender)).not.toContain('v=');
    expect(shareLink(sender, sender.deck[0]!.id)).not.toContain('v=');
  });
});

describe('a dealt deck mixes its playlists', () => {
  it('should interleave the cards of two playlists rather than concatenating them', () => {
    const state = deal(fetchDeck(tracks('a', 20), tracks('b', 20)), { seed: SEED });
    const sources = state.deck.map((card) => card.id[0]);

    // A concatenation has exactly one change of source. A shuffle of 20 + 20 has ~20.
    const changes = sources.filter((source, i) => i > 0 && source !== sources[i - 1]).length;
    expect(changes).toBeGreaterThan(10);
    // And both playlists reach the opening cards, rather than one playlist's block.
    expect(new Set(sources.slice(0, 10))).toEqual(new Set(['a', 'b']));
  });
});

describe('a link survives playlist drift', () => {
  it('should keep the sender cards in the sender order when a playlist gained a track', () => {
    // The editorial-refresh case: between the send and the open, Spotify added one track to the
    // first playlist. Under the old Fisher-Yates a length change re-dealt everything (review §4a).
    for (let game = 0; game < 25; game++) {
      const sender = deal(fetchDeck(tracks('a', 30), tracks('b', 20)));
      const link = openLink(shareLink(sender));

      const grown = [...tracks('a', 15), ...tracks('n', 1), ...tracks('a', 15, 15)];
      const recipient = dealFromLink(fetchDeck(grown, tracks('b', 20)), link);

      expect(recipient.deck.length).toBe(sender.deck.length + 1);
      expect(idsRestrictedTo(recipient.deck, sender.deck)).toEqual(idsOf(sender.deck));
    }
  });

  it('should keep the surviving cards in the sender order when a playlist lost a track', () => {
    for (let game = 0; game < 25; game++) {
      const sender = deal(fetchDeck(tracks('a', 30), tracks('b', 20)));
      const link = openLink(shareLink(sender));

      const shrunk = tracks('a', 30).filter((_, i) => i !== 12);
      const recipient = dealFromLink(fetchDeck(shrunk, tracks('b', 20)), link);

      expect(idsOf(recipient.deck)).toEqual(idsRestrictedTo(sender.deck, recipient.deck));
    }
  });
});

describe('a mid-game link carries the position', () => {
  it('should start the recipient on the sender current card, after the sender dropped cards', () => {
    // ===================================================================
    //  WHY AN ID AND NOT AN INDEX (review §4b).
    //
    //  The sender has lost yearless cards BEFORE their current one, so their
    //  index is smaller than the same card's index in the recipient's full
    //  deck. An index would land the recipient on a different card; the id
    //  lands them on the same one.
    // ===================================================================
    const fetched = fetchDeck(tracks('a', 30), tracks('b', 20));
    let sender = deal(fetched, { seed: SEED });

    // Play through the first eight cards, three of which turn out yearless and drop.
    for (const [index, card] of sender.deck.slice(0, 8).entries()) {
      const yearless = index === 2 || index === 4 || index === 6;
      sender = gameReducer(sender, {
        type: 'YEAR_RESOLVED',
        cardId: card.id,
        year: yearless ? null : 1980 + index,
        confidence: yearless ? 'none' : 'high',
      });
    }
    for (let step = 0; step < 4; step++) sender = gameReducer(sender, { type: 'NEXT' });

    const current = currentCard(sender)!;
    const link = openLink(shareLink(sender, current.id));
    const recipient = dealFromLink(fetchDeck(tracks('a', 30), tracks('b', 20)), link);

    expect(link.cardId).toBe(current.id);
    expect(currentCard(recipient)?.id).toBe(current.id);
    // The drops are exactly why the two indices differ.
    expect(recipient.currentIndex).toBeGreaterThan(sender.currentIndex);
    expect(idsRestrictedTo(recipient.deck, sender.deck)).toEqual(idsOf(sender.deck));
  });

  it('should start the recipient on card 1 when their deck does not hold the card', () => {
    // The playlist lost that track since it was shared: the order survives, the position cannot.
    const sender = deal(fetchDeck(tracks('a', 30), tracks('b', 20)), { seed: SEED });
    // A card from the FIRST playlist and not card 1, so removing it below is observable.
    const current = sender.deck.find((card, index) => index > 0 && card.id.startsWith('a'))!;
    const link = openLink(shareLink(sender, current.id));

    const without = tracks('a', 30).filter((card) => card.id !== current.id);
    const recipient = dealFromLink(fetchDeck(without, tracks('b', 20)), link);

    expect(recipient.currentIndex).toBe(0);
  });
});
