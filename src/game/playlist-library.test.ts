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
} from './playlist-library';
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

function entry(id: string, overrides: Partial<SavedPlaylist> = {}): SavedPlaylist {
  return { id, name: `Playlist ${id}`, savedAt: 1_000, ...overrides };
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
    expect(loadLibrary(storage).map((saved) => saved.id)).toEqual(['b', 'a']);

    const remaining = removePlaylist(storage, 'a');
    expect(remaining.map((saved) => saved.id)).toEqual(['b']);
    expect(loadLibrary(storage).map((saved) => saved.id)).toEqual(['b']);
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
    expect(entries[0]).toEqual({ id: 'a', name: 'Renamed', savedAt: 3_000 });
    expect(entries[1]?.id).toBe('b');
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
    expect(entries[0]?.id).toBe(`id-${LIBRARY_MAX_ENTRIES + 4}`);
    expect(entries.some((saved) => saved.id === 'id-0')).toBe(false);
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
      JSON.stringify({ version: LIBRARY_VERSION, entries: [{ id: 'a', name: 'x' }] }),
      JSON.stringify({ version: LIBRARY_VERSION, entries: [{ id: '', name: 'x', savedAt: 1 }] }),
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

  it('should store nothing beyond id, name and timestamp', () => {
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
    expect(Object.keys(loadLibrary(storage)[0] ?? {}).sort()).toEqual(['id', 'name', 'savedAt']);
  });

  it('should leave an absent id alone on removal', () => {
    const storage = memoryStorage();
    savePlaylist(storage, entry('a'));

    expect(removePlaylist(storage, 'nope').map((saved) => saved.id)).toEqual(['a']);
  });

  it('should clear the whole library', () => {
    const storage = memoryStorage();
    savePlaylist(storage, entry('a'));

    clearLibrary(storage);

    expect(loadLibrary(storage)).toEqual([]);
  });
});
