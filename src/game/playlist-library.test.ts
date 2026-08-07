/**
 * Node environment: the whole module is pure over an injected `StorageLike`, which is what a
 * three-line in-memory stub satisfies. The same call `persistence.test.ts` makes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LIBRARY_MAX_ENTRIES,
  LIBRARY_STORAGE_KEY,
  LIBRARY_VERSION,
  clearLibrary,
  loadLibrary,
  removePlaylist,
  savePlaylist,
  savedDeckKey,
} from './playlist-library';
import { MAX_DECK_PLAYLISTS } from './deck-merge';
import type { SavedPlaylist } from './playlist-library';
import type { StorageLike } from './persistence';

/** An in-memory `StorageLike` whose map is exposed so a test can seed or inspect the raw payload. */
function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();

  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** A one-playlist entry -- the `n = 1` case every pre-multi-playlist test in here is about. */
function entry(id: string, overrides: Partial<SavedPlaylist> = {}): SavedPlaylist {
  return { ids: [id], name: `Playlist ${id}`, savedAt: 1_000, ...overrides };
}

/** The first id of an entry, which is all the single-playlist assertions ever cared about. */
function firstId(saved: SavedPlaylist): string | undefined {
  return saved.ids[0];
}

describe('playlist-library', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should save, list and remove a playlist', () => {
    const storage = memoryStorage();

    expect(loadLibrary(storage)).toEqual([]);

    savePlaylist(storage, entry('a'));
    expect(loadLibrary(storage)).toEqual([entry('a')]);

    savePlaylist(storage, entry('b', { savedAt: 2_000 }));
    expect(loadLibrary(storage).map(firstId)).toEqual(['b', 'a']);

    const remaining = removePlaylist(storage, 'a');
    expect(remaining.map(firstId)).toEqual(['b']);
    expect(loadLibrary(storage).map(firstId)).toEqual(['b']);
  });

  it('should dedupe by playlist id and keep the most recent first', () => {
    // A player who plays a favourite twice has ONE favourite. Two rows with the same name and
    // different timestamps is a bug that looks like data.
    const storage = memoryStorage();

    savePlaylist(storage, entry('a', { savedAt: 1_000 }));
    savePlaylist(storage, entry('b', { savedAt: 2_000 }));
    savePlaylist(storage, entry('a', { savedAt: 3_000, name: 'Renamed' }));

    const entries = loadLibrary(storage);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ ids: ['a'], name: 'Renamed', savedAt: 3_000 });
    expect(firstId(entries[1]!)).toBe('b');
  });

  it('should cap the stored list', () => {
    // The cap is what stops a quota error from becoming this feature's failure mode: a swallowed
    // write failure would read as "saving silently stopped working".
    const storage = memoryStorage();

    for (let i = 0; i < LIBRARY_MAX_ENTRIES + 5; i++) {
      savePlaylist(storage, entry(`id-${i}`, { savedAt: i }));
    }

    const entries = loadLibrary(storage);
    expect(entries).toHaveLength(LIBRARY_MAX_ENTRIES);
    // The newest survived and the oldest were dropped, not the other way round.
    expect(firstId(entries[0]!)).toBe(`id-${LIBRARY_MAX_ENTRIES + 4}`);
    expect(entries.some((saved) => firstId(saved) === 'id-0')).toBe(false);
  });

  it('should return an empty library rather than throwing on a corrupt payload', () => {
    // Every one of these is a real localStorage state: hand-edited JSON, a payload from a future
    // build, a truncated write, and an entry missing a field.
    for (const raw of [
      'not json at all',
      '[]',
      'null',
      JSON.stringify({ version: LIBRARY_VERSION + 1, entries: [entry('a')] }),
      JSON.stringify({ version: LIBRARY_VERSION, entries: 'nope' }),
      JSON.stringify({ version: LIBRARY_VERSION, entries: [{ ids: ['a'], name: 'x' }] }),
      JSON.stringify({ version: LIBRARY_VERSION, entries: [{ ids: [''], name: 'x', savedAt: 1 }] }),
      JSON.stringify({ version: LIBRARY_VERSION, entries: [{ ids: [], name: 'x', savedAt: 1 }] }),
      JSON.stringify({ version: LIBRARY_VERSION, entries: [{ ids: 'a', name: 'x', savedAt: 1 }] }),
      JSON.stringify({ version: LIBRARY_VERSION, entries: [{ ids: [7], name: 'x', savedAt: 1 }] }),
      // Two entries naming the same SET of playlists, in a different order: one deck, so a store
      // holding both is corruption -- `savePlaylist` cannot produce it.
      JSON.stringify({
        version: LIBRARY_VERSION,
        entries: [entry('a', { ids: ['a', 'b'] }), entry('a', { ids: ['b', 'a'] })],
      }),
      JSON.stringify({ version: LIBRARY_VERSION, entries: [entry('a'), entry('a')] }),
    ]) {
      const storage = memoryStorage();
      storage.map.set(LIBRARY_STORAGE_KEY, raw);

      expect(() => loadLibrary(storage)).not.toThrow();
      expect(loadLibrary(storage)).toEqual([]);
    }
  });

  it('should clear the key after rejecting a corrupt payload', () => {
    // A payload that failed validation once fails every time, so leaving it in place means
    // re-parsing and re-rejecting it on every landing-screen render. Same call `loadSession` makes.
    const storage = memoryStorage();
    storage.map.set(LIBRARY_STORAGE_KEY, '{ broken');

    loadLibrary(storage);

    expect(storage.map.has(LIBRARY_STORAGE_KEY)).toBe(false);
  });

  it('should swallow a write failure', () => {
    // Quota exhaustion and private-mode restrictions both surface as a throw from `setItem`, and
    // neither is a reason to interrupt a screen whose next action is "Play again".
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };

    // It still reports the list it tried to write, so the in-memory view matches what the player did.
    expect(() => savePlaylist(storage, entry('a'))).not.toThrow();
    expect(savePlaylist(storage, entry('a'))).toEqual([entry('a')]);
    expect(warn).toHaveBeenCalled();
  });

  it('should swallow a read failure', () => {
    // Reading can throw too -- Safari in private mode has historically done so.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    };

    expect(loadLibrary(storage)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('should write a versioned payload', () => {
    // The `v1` in the key is the invalidation lever; `version` inside the payload is the belt to
    // that braces, and it only works if it is actually written.
    const storage = memoryStorage();

    savePlaylist(storage, entry('a'));

    const raw = JSON.parse(storage.map.get(LIBRARY_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(raw['version']).toBe(LIBRARY_VERSION);
  });

  it('should not write any field beyond ids, name and savedAt', () => {
    // ===================================================================
    //  THE LEAK GUARD. This store is read on the LANDING SCREEN, which is a
    //  pre-start surface -- the one place where a leak costs the whole game
    //  before it begins. A future caller passing a spread of something larger
    //  (a `PlaylistResult`, a deck) fails here.
    // ===================================================================
    const storage = memoryStorage();

    savePlaylist(storage, {
      ...entry('a'),
      // Deliberately smuggled in past the type, the way a spread would.
      ...({ cards: [{ title: 'Bohemian Rhapsody' }] } as unknown as SavedPlaylist),
    });

    const raw = storage.map.get(LIBRARY_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('Bohemian');
    expect(Object.keys(loadLibrary(storage)[0] ?? {}).sort()).toEqual(['ids', 'name', 'savedAt']);
  });

  it('should not write anything smuggled into the ids array', () => {
    // The array field is the NEW way to smuggle something in: `[...entry.ids]` would copy whatever
    // a caller had put in it, so `savePlaylist` rebuilds element by element and drops non-strings.
    const storage = memoryStorage();

    savePlaylist(storage, {
      ...entry('a'),
      ids: ['a', { title: 'Bohemian Rhapsody' }, '', 'b'] as unknown as string[],
    });

    const raw = storage.map.get(LIBRARY_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('Bohemian');
    expect(loadLibrary(storage)[0]?.ids).toEqual(['a', 'b']);
  });

  it('should leave an absent id alone on removal', () => {
    const storage = memoryStorage();
    savePlaylist(storage, entry('a'));

    expect(removePlaylist(storage, 'nope').map(firstId)).toEqual(['a']);
  });

  it('should clear the whole library', () => {
    const storage = memoryStorage();
    savePlaylist(storage, entry('a'));

    clearLibrary(storage);

    expect(loadLibrary(storage)).toEqual([]);
  });
});

// ===========================================================================
//  AN ENTRY IS 1..5 PLAYLISTS
//
//  `LIBRARY_VERSION` went to 2, and v1 is read by lifting each entry's single
//  `id` into `[id]` -- which matters MORE here than it does for a session: a
//  version mismatch clears the whole store, so shipping without the lift would
//  silently empty a library the player curated, on the landing screen, with no
//  message.
// ===========================================================================

describe('the multi-playlist library', () => {
  it('should save an entry holding several ids', () => {
    const storage = memoryStorage();

    savePlaylist(storage, { ids: ['a', 'b', 'c'], name: 'Rock Classics +2 more', savedAt: 1_000 });

    // In ROW ORDER on the entry itself -- only the KEY is sorted.
    expect(loadLibrary(storage)).toEqual([
      { ids: ['a', 'b', 'c'], name: 'Rock Classics +2 more', savedAt: 1_000 },
    ]);
  });

  it('should dedupe an entry whose ids match an existing one in a different order', () => {
    // ===================================================================
    //  `savedDeckKey` SORTS, so the same three playlists entered in a
    //  different order are ONE favourite (decision 11). Left unsorted this
    //  would be two rows with the same label and the same playlists,
    //  distinguishable only by their timestamps.
    // ===================================================================
    const storage = memoryStorage();

    savePlaylist(storage, { ids: ['a', 'b', 'c'], name: 'First', savedAt: 1_000 });
    savePlaylist(storage, { ids: ['c', 'a', 'b'], name: 'Second', savedAt: 2_000 });

    const entries = loadLibrary(storage);
    expect(entries).toHaveLength(1);
    // The newer save wins outright, ROW ORDER INCLUDED: it is what the player just did.
    expect(entries[0]).toEqual({ ids: ['c', 'a', 'b'], name: 'Second', savedAt: 2_000 });

    // A PARTIALLY overlapping set is a different deck, though, and gets its own row.
    savePlaylist(storage, { ids: ['a', 'b'], name: 'Third', savedAt: 3_000 });
    expect(loadLibrary(storage)).toHaveLength(2);
  });

  it('should remove an entry by its deck key', () => {
    const storage = memoryStorage();
    savePlaylist(storage, { ids: ['a', 'b'], name: 'Pair', savedAt: 1_000 });
    savePlaylist(storage, entry('c', { savedAt: 2_000 }));

    // The key is sorted-and-joined, so it does not depend on the order the entry stores.
    const remaining = removePlaylist(storage, savedDeckKey({ ids: ['b', 'a'] }));

    expect(remaining.map((saved) => saved.ids)).toEqual([['c']]);
    // And removing by a single id that merely APPEARS in a deck must not take the deck out.
    savePlaylist(storage, { ids: ['c', 'd'], name: 'Other pair', savedAt: 3_000 });
    expect(removePlaylist(storage, 'c').map((saved) => saved.ids)).toEqual([['c', 'd']]);
  });

  it('should read a v1 library by lifting each entry id', () => {
    const storage = memoryStorage();
    storage.map.set(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { id: 'a', name: 'Rock Classics', savedAt: 2_000 },
          { id: 'b', name: 'Disco', savedAt: 1_000 },
        ],
      }),
    );

    expect(loadLibrary(storage)).toEqual([
      { ids: ['a'], name: 'Rock Classics', savedAt: 2_000 },
      { ids: ['b'], name: 'Disco', savedAt: 1_000 },
    ]);
    // The lift REBUILDS rather than renaming in place, so the old field cannot ride along.
    expect(loadLibrary(storage)[0]).not.toHaveProperty('id');
  });

  it('should reject a v1 library whose entry is malformed', () => {
    // The lift is a migration, not an amnesty: every other field is validated exactly as it is for
    // a v2 payload, and one bad entry still invalidates the whole store.
    const storage = memoryStorage();
    storage.map.set(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: [{ id: 'a', name: 'x' }] }),
    );

    expect(loadLibrary(storage)).toEqual([]);
  });

  it('should reject an entry whose ids array is empty', () => {
    const storage = memoryStorage();
    storage.map.set(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({ version: LIBRARY_VERSION, entries: [{ ids: [], name: 'x', savedAt: 1 }] }),
    );

    expect(loadLibrary(storage)).toEqual([]);
  });

  it('should cap the ids of a stored entry on read', () => {
    // ===================================================================
    //  CAPPED HERE, UNLIKE A STORED SESSION (decision 10).
    //
    //  A library entry is INPUT to a future fetch -- pressing it fires one
    //  `/api/playlist` request per id -- so a payload written by a build with
    //  a larger cap, or edited by hand, must not fan out past what this build
    //  allows. `persistence.ts` deliberately does the opposite.
    // ===================================================================
    const storage = memoryStorage();
    const many = Array.from({ length: MAX_DECK_PLAYLISTS + 3 }, (_, i) => `over-${i}`);
    storage.map.set(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: LIBRARY_VERSION,
        entries: [{ ids: many, name: 'Too many', savedAt: 1 }],
      }),
    );

    expect(loadLibrary(storage)[0]?.ids).toEqual(many.slice(0, MAX_DECK_PLAYLISTS));
  });

  it('should cap the ids of an entry on write', () => {
    const storage = memoryStorage();
    const many = Array.from({ length: MAX_DECK_PLAYLISTS + 3 }, (_, i) => `over-${i}`);

    expect(savePlaylist(storage, { ids: many, name: 'Too many', savedAt: 1 })[0]?.ids).toHaveLength(
      MAX_DECK_PLAYLISTS,
    );
  });
});

describe('savedDeckKey', () => {
  it('should not depend on the order the ids are stored in', () => {
    expect(savedDeckKey({ ids: ['c', 'a', 'b'] })).toBe(savedDeckKey({ ids: ['a', 'b', 'c'] }));
  });

  it('should distinguish decks that merely overlap', () => {
    expect(savedDeckKey({ ids: ['a', 'b'] })).not.toBe(savedDeckKey({ ids: ['a', 'b', 'c'] }));
  });

  it('should not mutate the entry it reads', () => {
    // `[...ids].sort()`, not `ids.sort()`: `Array.sort` is in place, so the un-copied version would
    // silently reorder the entry it was called on -- including the live `state.playlists` mapping.
    const ids = ['c', 'a', 'b'];
    savedDeckKey({ ids });

    expect(ids).toEqual(['c', 'a', 'b']);
  });
});
