/**
 * Node environment, no docblock needed: `deck-merge.ts` touches no DOM, no `fetch` and no storage,
 * which is the whole reason it is a module in `src/game/` rather than logic inside `usePlaylist`.
 *
 * Every rule asserted here is invisible to a DOM test -- a wrong dedupe reads as a duplicate card
 * halfway through a deck, and a wrong label reads as a slightly odd heading.
 */

import { describe, expect, it } from 'vitest';

import { COPY } from './copy';
import { MAX_DECK_PLAYLISTS, deckLabel, mergePlaylists } from './deck-merge';
import type { PlaylistOutcome } from './playlist-client';
import type { Card, PlaylistSummary } from '../../shared/types';

function playlist(id: string, name = `Playlist ${id}`): PlaylistSummary {
  return { id, name, owner: 'Someone' };
}

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

/** One loaded playlist, as `fetchPlaylist` reports it. */
function loaded(
  id: string,
  cards: Card[],
  extras: { truncated?: boolean; skippedCount?: number; name?: string } = {},
): PlaylistOutcome {
  return {
    ok: true,
    result: {
      playlist: playlist(id, extras.name),
      cards,
      truncated: extras.truncated ?? false,
      skippedCount: extras.skippedCount ?? 0,
    },
  };
}

describe('mergePlaylists', () => {
  it('should merge two loaded playlists into one deck in row order', () => {
    const merged = mergePlaylists([
      loaded('one', [card('a'), card('b')]),
      loaded('two', [card('c')]),
    ]);

    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    // Concatenated in ROW ORDER. The shuffle makes it irrelevant to play, but a deterministic input
    // is what makes every assertion in this file exact.
    expect(merged.deck.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(merged.deck.playlists.map((p) => p.id)).toEqual(['one', 'two']);
    expect(merged.deck.failures).toEqual([]);
  });

  it('should drop a track that appears in two playlists', () => {
    // Two identical cards in one deck read as a bug, and the same track in two of someone's five
    // playlists is the ordinary case rather than the exotic one.
    const merged = mergePlaylists([
      loaded('one', [card('a', { title: 'From the first playlist' }), card('b')]),
      loaded('two', [card('a', { title: 'From the second playlist' }), card('c')]),
    ]);

    if (!merged.ok) throw new Error('expected a deck');

    expect(merged.deck.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    // FIRST OCCURRENCE WINS. Safe to keep either, in fact -- a card from `/api/playlist` carries no
    // year, so the copies differ in nothing the game reads -- but the rule is asserted so a later
    // "merge the fields" change has to be deliberate.
    expect(merged.deck.cards[0]?.title).toBe('From the first playlist');
  });

  it('should keep two different tracks that share a title', () => {
    // The dedupe key is the Spotify track ID, not the title: a playlist of covers, or the same song
    // in two masterings, is two cards.
    const merged = mergePlaylists([
      loaded('one', [card('a', { title: 'Blue Monday' })]),
      loaded('two', [card('b', { title: 'Blue Monday' })]),
    ]);

    if (!merged.ok) throw new Error('expected a deck');

    expect(merged.deck.cards.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('should report truncated when any playlist truncated', () => {
    // An OR, not an AND: one playlist at the embed cap means the DECK may be incomplete, and one
    // notice covers all of them (pagination is still out of scope).
    const merged = mergePlaylists([
      loaded('one', [card('a')], { truncated: false }),
      loaded('two', [card('b')], { truncated: true }),
    ]);

    if (!merged.ok) throw new Error('expected a deck');

    expect(merged.deck.truncated).toBe(true);
  });

  it('should sum skippedCount across playlists', () => {
    const merged = mergePlaylists([
      loaded('one', [card('a')], { skippedCount: 2 }),
      loaded('two', [card('b')], { skippedCount: 3 }),
      loaded('three', [card('c')]),
    ]);

    if (!merged.ok) throw new Error('expected a deck');

    expect(merged.deck.skippedCount).toBe(5);
  });

  it('should list the failures of the playlists that did not load', () => {
    // Decision 4: a playlist that fails is DROPPED WITH A COUNT, and only a total failure blocks
    // Start. One dead editorial playlist must not cost a five-playlist deck.
    const merged = mergePlaylists([
      { ok: false, code: 'not-found-or-private' },
      loaded('two', [card('b')]),
      { ok: false, code: 'upstream-unavailable' },
    ]);

    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    expect(merged.deck.failures).toEqual(['not-found-or-private', 'upstream-unavailable']);
    expect(merged.deck.playlists.map((p) => p.id)).toEqual(['two']);
    expect(merged.deck.cards.map((c) => c.id)).toEqual(['b']);
  });

  it('should return the first failure code when no playlist loaded', () => {
    // The landing screen has ONE error slot, so it describes the FIRST row that went wrong -- which
    // is also the only reason this function insists on row order.
    const merged = mergePlaylists([
      { ok: false, code: 'not-found-or-private' },
      { ok: false, code: 'offline' },
    ]);

    expect(merged).toEqual({ ok: false, code: 'not-found-or-private' });
  });

  it('should return empty-playlist when every playlist loaded empty', () => {
    // The guard that keeps an empty deck away from `START`, whose own comment says nothing above the
    // reducer owns that case. Not a parse failure -- the payloads were perfectly readable.
    expect(mergePlaylists([loaded('one', []), loaded('two', [])])).toEqual({
      ok: false,
      code: 'empty-playlist',
    });
  });

  it('should return empty-playlist for an empty outcome list', () => {
    // Not reachable from the landing screen -- an all-blank submit is rejected per row -- but a
    // merge over nothing has no honest deck to return.
    expect(mergePlaylists([])).toEqual({ ok: false, code: 'empty-playlist' });
  });

  it('should merge five playlists, which is the documented maximum', () => {
    const outcomes = Array.from({ length: MAX_DECK_PLAYLISTS }, (_, i) =>
      loaded(`p${i}`, [card(`c${i}`)]),
    );

    const merged = mergePlaylists(outcomes);
    if (!merged.ok) throw new Error('expected a deck');

    expect(merged.deck.playlists).toHaveLength(MAX_DECK_PLAYLISTS);
    expect(merged.deck.cards).toHaveLength(MAX_DECK_PLAYLISTS);
  });
});

describe('deckLabel', () => {
  it('should label a single playlist with its own name', () => {
    expect(deckLabel([playlist('one', 'Rock Classics')])).toBe('Rock Classics');
  });

  it('should label three playlists as the first plus a count', () => {
    // Short enough for the HUD, which already truncates, and it still names a deck the player
    // recognises -- which "3 playlists" would not.
    expect(
      deckLabel([playlist('one', 'Rock Classics'), playlist('two', 'Disco'), playlist('three')]),
    ).toBe(COPY.deck.label('Rock Classics', 2));
  });

  it('should label two playlists in the singular count', () => {
    expect(deckLabel([playlist('one', 'Rock Classics'), playlist('two', 'Disco')])).toBe(
      COPY.deck.label('Rock Classics', 1),
    );
  });

  it('should cut a long playlist name at twenty characters', () => {
    // 24 characters in, 20 plus an ellipsis out. A Spotify name can be 100, and before this only
    // the HUD limited it -- in CSS, which the PDF filename and the saved library never see.
    expect(deckLabel([playlist('one', 'Songs For The Long Drive')])).toBe(
      `Songs For The Long D${COPY.deck.nameEllipsis}`,
    );
  });

  it('should leave a name of exactly twenty characters alone', () => {
    // The boundary is inclusive: 20 fits, so nothing is lost and no ellipsis is added.
    const exactly = 'Twenty Characters!!!';
    expect(exactly).toHaveLength(20);
    expect(deckLabel([playlist('one', exactly)])).toBe(exactly);
  });

  it('should keep the count intact when the name is cut', () => {
    // The cap applies to the NAME, never to the finished label. A label that lost its "+2 more"
    // would claim a three-playlist deck is one playlist -- which is worse than a long string.
    expect(
      deckLabel([
        playlist('one', 'Songs For The Long Drive'),
        playlist('two', 'Disco'),
        playlist('three'),
      ]),
    ).toBe(COPY.deck.label(`Songs For The Long D${COPY.deck.nameEllipsis}`, 2));
  });

  it('should not leave a dangling space before the ellipsis', () => {
    // The cut lands exactly on a space here ("Chill Vibes For You |Now"), so a slice without the
    // `trimEnd` would render "Chill Vibes For You …" with a gap before the dots.
    expect(deckLabel([playlist('one', 'Chill Vibes For You Now')])).toBe(
      `Chill Vibes For You${COPY.deck.nameEllipsis}`,
    );
  });

  it('should return an empty string for no playlists', () => {
    // The `idle` case. This is what the dropped `playlist: null` sentinel used to cover, and a
    // caller rendering it gets `''` rather than a crash.
    expect(deckLabel([])).toBe('');
  });
});
