import { describe, expect, it, vi } from 'vitest';

import {
  SESSION_STORAGE_KEY,
  SESSION_VERSION,
  clearSession,
  loadSession,
  saveSession,
  toPersistedSession,
} from './persistence';
import { MAX_DECK_PLAYLISTS } from './deck-merge';
import { gameReducer, initialGameState } from './reducer';
import type { StorageLike } from './persistence';
import type { GameState, PersistedSession } from './types';
import type { Card, PlaylistSummary } from '../../shared/types';

const PLAYLIST: PlaylistSummary = {
  id: '37i9dQZF1DWXRqgorJj26U',
  name: 'Rock Classics',
  owner: 'Spotify',
};

/** Two more, so the v2 format's list can be asserted as a list rather than as a wrapped single. */
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

/**
 * A `Storage`-shaped stub, which is the whole reason `persistence.ts` takes its storage
 * injected: no jsdom, no globals, and the tests run under the node environment (jsdom stays a
 * Phase 4 decision).
 */
function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();

  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/**
 * A session state holding all three states of `Card.year` at once: resolved, looked up and
 * yearless, and not looked up yet.
 *
 * ===========================================================================
 *  A STATE LITERAL, AND IT USED TO BE BUILT THROUGH `RESUME`.
 *
 *  It cannot be any more. Since the 2026-08-05 reversal a yearless card is
 *  REMOVED from a live deck, and `RESUME` filters like every other entry point --
 *  so a state built through the reducer can no longer hold the middle of the
 *  three year states, and these tests would be asserting the format round-trips
 *  something it never sees.
 *
 *  The format's job is unchanged, though, and it is the thing under test here:
 *  `saveSession` / `loadSession` must round-trip whatever a deck holds, including
 *  a `null` year. `Card.year` is the shape of a lookup RESULT, which is a
 *  different question from what a PLAYABLE deck may contain -- and a save written
 *  before the reversal is exactly the payload `RESUME` has to cope with. Keeping
 *  the null card here is what keeps both halves honest.
 *
 *  Written out in deck order rather than shuffled, for the original reason: a
 *  shuffle would make "which card ended up with the null year" depend on a seed.
 * ===========================================================================
 */
function session(): GameState {
  return {
    status: 'playing',
    playlists: [PLAYLIST],
    seed: 'persistence-seed',
    deck: [
      card('a', { year: 1975, yearConfidence: 'high', previewUrl: 'https://p.scdn.co/mp3/a' }),
      card('b', { year: null, yearConfidence: 'none' }),
      card('c'),
    ],
    currentIndex: 1,
    isFlipped: true,
    yearLookupsUnavailable: false,
  };
}

/** Write an arbitrary payload straight into storage, bypassing `saveSession`'s shaping. */
function seed(storage: StorageLike, payload: unknown): void {
  storage.setItem(
    SESSION_STORAGE_KEY,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  );
}

function validPayload(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    version: SESSION_VERSION,
    playlists: [PLAYLIST],
    seed: 'persisted-seed',
    deck: [card('a', { year: 1975, yearConfidence: 'high' }), card('b')],
    currentIndex: 1,
    isFlipped: false,
    status: 'playing',
    ...overrides,
  };
}

describe('saveSession / loadSession', () => {
  it('should round-trip a full session', () => {
    const storage = memoryStorage();
    const state = session();

    saveSession(state, storage);
    const loaded = loadSession(storage);

    expect(loaded).toEqual({
      version: SESSION_VERSION,
      playlists: state.playlists,
      seed: state.seed,
      deck: state.deck,
      currentIndex: state.currentIndex,
      isFlipped: state.isFlipped,
      status: state.status,
    });
    // And it re-enters through `RESUME` cleanly -- the actual point of the format.
    //
    // MINUS the yearless card, and that difference is the reversal working end to end: the format
    // carries every year state, and `RESUME` is where a card with no year stops being playable.
    // The index moves with it, so the player lands on the card they were on rather than on
    // whatever index 1 happens to be afterwards.
    const resumed = gameReducer(initialGameState, { type: 'RESUME', session: loaded! });
    expect(resumed.deck).toEqual(state.deck.filter((c) => c.year !== null));
    expect(resumed.status).toBe('playing');
    // The player was on `b`, which has gone; index 1 is now `c`, the card that followed it.
    expect(resumed.deck[resumed.currentIndex]?.id).toBe('c');
  });

  it('should preserve resolved years and confidences through a round trip', () => {
    // The reason persistence exists at all (decision 8): a reload must cost ZERO MusicBrainz
    // requests for work already done, against a budget shared by every user of the app. Losing
    // the confidences would also make every restored card look `high`.
    const storage = memoryStorage();
    const state = session();

    saveSession(state, storage);
    const deck = loadSession(storage)?.deck ?? [];

    expect(deck.map((c) => [c.year, c.yearConfidence])).toEqual(
      state.deck.map((c) => [c.year, c.yearConfidence]),
    );
    // All three states of `Card.year` survive, including the difference between "looked up and
    // nothing found" (null) and "not looked up yet" (undefined).
    expect(deck.some((c) => c.year === null)).toBe(true);
    expect(deck.some((c) => c.year === undefined)).toBe(true);
  });

  it('should keep a still-unresolved card resolvable after a reload', () => {
    // `JSON.stringify` drops a `year: undefined` field entirely, which is exactly right: absent
    // reads back as `undefined`, so the resolver picks that card up again.
    const storage = memoryStorage();
    saveSession(session(), storage);

    const raw = storage.data.get(SESSION_STORAGE_KEY) ?? '';

    expect(raw).not.toContain('"year":undefined');
    expect(loadSession(storage)?.deck.find((c) => c.id === 'c')?.year).toBeUndefined();
  });

  it('should not save an idle session', () => {
    const storage = memoryStorage();
    saveSession(initialGameState, storage);

    expect(storage.data.size).toBe(0);
    expect(toPersistedSession(initialGameState)).toBeNull();
  });

  it('should return null when nothing is stored', () => {
    expect(loadSession(memoryStorage())).toBeNull();
  });

  it('should return null and clear the key on a version mismatch', () => {
    // The `v1` invalidation lever: a save from a different build is not corruption, but it is
    // equally unusable, and guessing at a migration is how a wrong year ends up on a card.
    const storage = memoryStorage();
    seed(storage, validPayload({ version: SESSION_VERSION + 1 }));

    expect(loadSession(storage)).toBeNull();
    // Cleared, so it is not re-parsed and re-rejected on every load, and Phase 6 shows no stale
    // resume affordance for a session that can never load.
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it('should return null on unparseable JSON rather than throwing', () => {
    const storage = memoryStorage();
    seed(storage, '{"version": 1, "deck": [');

    expect(loadSession(storage)).toBeNull();
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it('should return null when the deck is missing or empty', () => {
    for (const deck of [undefined, [], 'not-an-array', [{ id: 'a' }]]) {
      const storage = memoryStorage();
      seed(storage, { ...validPayload(), deck, currentIndex: 0 });

      expect(loadSession(storage)).toBeNull();
    }
  });

  it('should return null when currentIndex is out of range', () => {
    // The validation most likely to earn its keep: an out-of-range index is the one corruption
    // that would crash the card renderer on the very first frame after a resume.
    for (const currentIndex of [-1, 2, 99, 1.5, '1']) {
      const storage = memoryStorage();
      seed(storage, validPayload({ currentIndex: currentIndex as number }));

      expect(loadSession(storage)).toBeNull();
    }
  });

  it('should return null on a missing or unusable field', () => {
    const cases: Partial<Record<keyof PersistedSession, unknown>>[] = [
      { playlists: undefined },
      { playlists: [{ id: '', name: 'x', owner: 'y' }] },
      { seed: '' },
      { seed: 42 },
      { isFlipped: 'yes' },
      { status: 'idle' },
      { status: 'unknown-status' },
    ];

    for (const override of cases) {
      const storage = memoryStorage();
      seed(storage, { ...validPayload(), ...override });

      expect(loadSession(storage)).toBeNull();
    }
  });

  it('should reject a deck containing one bad card', () => {
    // One bad card invalidates the whole save: a deck silently missing a card would break the
    // reproducibility the seed exists for and leave `currentIndex` pointing somewhere else.
    const storage = memoryStorage();
    const payload = validPayload();
    seed(storage, { ...payload, deck: [payload.deck[0], { id: 'b', title: 'b' }] });

    expect(loadSession(storage)).toBeNull();
  });

  it('should not copy unknown fields out of a stored payload', () => {
    // Rebuilt field by field rather than cast, so a payload from a future version cannot smuggle
    // anything unvalidated into the reducer.
    const storage = memoryStorage();
    seed(storage, { ...validPayload(), somethingElse: 'nope' });

    expect(loadSession(storage)).not.toHaveProperty('somethingElse');
    expect(loadSession(storage)?.deck[0]).not.toHaveProperty('somethingElse');
  });

  it('should swallow and log a write failure', () => {
    // Quota exhaustion and private-mode restrictions both surface as a throw from `setItem`, and
    // neither is a reason to interrupt a game in progress: persistence is a convenience, never a
    // correctness dependency.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const storage: StorageLike = {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('QuotaExceededError');
        },
        removeItem: () => {},
      };

      expect(() => {
        saveSession(session(), storage);
      }).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('should return null instead of throwing when reading fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const storage: StorageLike = {
        getItem: () => {
          throw new DOMException('SecurityError');
        },
        setItem: () => {},
        removeItem: () => {},
      };

      expect(loadSession(storage)).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// ===========================================================================
//  THE v2 FORMAT AND THE v1 LIFT
//
//  `SESSION_VERSION` went to 2 for multi-playlist, and v1 is still read by
//  lifting its single `playlist` into `[playlist]` -- the one migration this
//  module permits, because it is exact rather than a guess.
// ===========================================================================

describe('the multi-playlist session format', () => {
  it('should round-trip a session with three playlists', () => {
    const storage = memoryStorage();
    const state: GameState = {
      ...session(),
      playlists: [PLAYLIST, SECOND_PLAYLIST, THIRD_PLAYLIST],
    };

    saveSession(state, storage);

    // In ROW ORDER, because that is the order the share link and the deck label read.
    expect(loadSession(storage)?.playlists).toEqual([PLAYLIST, SECOND_PLAYLIST, THIRD_PLAYLIST]);
    // And it re-enters through `RESUME` with all three still attached.
    const resumed = gameReducer(initialGameState, {
      type: 'RESUME',
      session: loadSession(storage)!,
    });
    expect(resumed.playlists).toHaveLength(3);
  });

  it('should read a v1 payload by lifting its single playlist', () => {
    // ===================================================================
    //  WITHOUT THIS, DEPLOYING MULTI-PLAYLIST DISCARDS EVERY GAME IN
    //  PROGRESS.
    //
    //  A v1 save described exactly ONE playlist, so `[playlist]` is the same
    //  fact in the new shape rather than an interpretation of it -- which is
    //  why this is the one migration the module's "guessing at a migration is
    //  how a wrong year ends up on a card" rule allows.
    // ===================================================================
    const storage = memoryStorage();
    const { playlists, ...rest } = validPayload();
    seed(storage, { ...rest, version: 1, playlist: playlists[0] });

    const loaded = loadSession(storage);

    expect(loaded?.playlists).toEqual([PLAYLIST]);
    // Reported as the CURRENT version, so the next save writes it back as a v2 payload.
    expect(loaded?.version).toBe(SESSION_VERSION);
    // And nothing of the old shape survives the rebuild.
    expect(loaded).not.toHaveProperty('playlist');
  });

  it('should reject a payload whose playlists array is empty', () => {
    // A session with no playlists could not name its own deck: the HUD, the share link and the save
    // button all read that list, and an empty one is not a smaller deck, it is an unusable save.
    for (const playlists of [[], 'nope', {}, undefined]) {
      const storage = memoryStorage();
      seed(storage, { ...validPayload(), playlists });

      expect(loadSession(storage)).toBeNull();
    }
  });

  it('should reject a payload whose playlists array holds a malformed summary', () => {
    // One bad summary invalidates the whole save, the same call `validateDeck` makes about one bad
    // card -- a deck silently missing the playlist it came from would mis-label itself everywhere.
    const storage = memoryStorage();
    seed(storage, { ...validPayload(), playlists: [PLAYLIST, { id: 'x', name: 'y' }] });

    expect(loadSession(storage)).toBeNull();
  });

  it('should not cap the playlists on read', () => {
    // ===================================================================
    //  THE DELIBERATE ASYMMETRY WITH THE LIBRARY (decision 10).
    //
    //  `MAX_DECK_PLAYLISTS` governs what the landing screen accepts as INPUT.
    //  A stored session describes a deck that ALREADY EXISTS and is already
    //  shuffled, so capping it would throw away a game in progress the moment
    //  the cap moved -- and truncating would leave the deck's cards attributed
    //  to playlists no longer listed beside them.
    // ===================================================================
    const storage = memoryStorage();
    const many = Array.from({ length: MAX_DECK_PLAYLISTS + 3 }, (_, i) => ({
      id: `over-${i}`,
      name: `Over ${i}`,
      owner: 'Someone',
    }));
    seed(storage, { ...validPayload(), playlists: many });

    expect(loadSession(storage)?.playlists).toHaveLength(MAX_DECK_PLAYLISTS + 3);
  });
});

describe('clearSession', () => {
  it('should remove the key on clearSession', () => {
    // Called on `END`, and before a `START` that replaces an existing session.
    const storage = memoryStorage();
    saveSession(session(), storage);

    clearSession(storage);

    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(loadSession(storage)).toBeNull();
  });

  it('should use a versioned key', () => {
    // Same deliberate invalidation lever as the `mbyear:v1:` prefix in `api/_lib/cache.ts`.
    expect(SESSION_STORAGE_KEY).toBe('hitster:session:v1');
  });
});
