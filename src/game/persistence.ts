/**
 * The `localStorage` session save.
 *
 * ===========================================================================
 *  PERSISTENCE IS A CONVENIENCE, NEVER A CORRECTNESS DEPENDENCY.
 *
 *  Same principle as the year cache (`api/_lib/cache.ts`): a read failure is a
 *  MISS, a write failure is a NO-OP, and both are logged. Nothing here throws.
 *  A corrupt save should cost the player one game, not the whole app -- so
 *  `loadSession()` validates before it trusts, and discards anything it cannot
 *  fully account for.
 * ===========================================================================
 *
 * WHY THE WHOLE DECK IS SAVED, years included (decision 8): a mid-game reload then costs ZERO
 * MusicBrainz requests against a budget shared by every user of the app. Persisting only the
 * seed and the index would look tidier and re-resolve the entire deck -- and would silently
 * deal a different deck if the playlist changed in the meantime.
 *
 * `Storage` is injected rather than reaching for the global: it is what lets these tests run
 * under the node environment with a plain in-memory stub, keeping jsdom a Phase 4 decision.
 */

import type { GameState, PersistedSession } from './types';
import type { Card, PlaylistSummary, YearConfidence } from '../../shared/types';

/**
 * The storage key.
 *
 * The `v1` segment is the same deliberate invalidation lever as the `mbyear:v1:` prefix in
 * `api/_lib/cache.ts`: when the persisted shape changes incompatibly, bump it and every
 * existing save becomes unreachable in one edit -- instead of crashing, or worse half-loading,
 * a resume path months later. `version` inside the payload is the belt to this braces: it
 * catches a shape change someone forgot to bump the key for.
 */
export const SESSION_STORAGE_KEY = 'hitster:session:v1';

/**
 * Current payload version. Must be bumped together with any incompatible shape change.
 *
 * ===========================================================================
 *  v2 IS MULTI-PLAYLIST, AND v1 IS READ BY LIFTING ITS SINGLE `playlist` INTO A
 *  ONE-ELEMENT ARRAY (decision 7).
 *
 *  This is the ONE migration this module permits, and it is allowed only because
 *  it is EXACT rather than a guess: a v1 save described exactly one playlist, so
 *  `[playlist]` is not an interpretation of it -- it is the same fact in the new
 *  shape. The header block's "a version mismatch is not corruption, but guessing
 *  at a migration is how a wrong year ends up on a card" still holds for
 *  everything else, including any future v3: **a v3 drops this lift** rather
 *  than chaining a second one.
 *
 *  Without it, deploying multi-playlist would silently discard every game in
 *  progress. The key's own `v1` segment is deliberately NOT bumped alongside
 *  this, because bumping it is exactly how you make those saves unreachable --
 *  which is the opposite of what the lift is for.
 * ===========================================================================
 */
export const SESSION_VERSION = 2;

/** The version this module can still read, by lifting its single playlist. See above. */
const SESSION_VERSION_LEGACY = 1;

/**
 * The slice of `Storage` this module uses, kept structural so a test double is three lines and
 * so nothing here depends on the DOM's `Storage` class.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * ===========================================================================
 *  THE SAVED DECK IS READABLE IN DEVTOOLS. THAT IS ACCEPTED (decision 14).
 *
 *  It holds every title, every artist and every year resolved so far, so a
 *  player who opens Application -> Local Storage can read the whole deck ahead
 *  of the game. Obfuscating it would buy nothing real: the in-memory deck the
 *  app is playing from has exactly the same exposure, and so does the network
 *  tab. Written down here rather than left to be discovered, because "the app
 *  leaks nothing" is a property someone will otherwise assume (2026-08-04
 *  finding).
 * ===========================================================================
 */

/** Shape a live session for storage. Returns null while there is nothing worth saving. */
export function toPersistedSession(state: GameState): PersistedSession | null {
  if (state.status === 'idle' || state.playlists.length === 0 || state.deck.length === 0) {
    return null;
  }

  return {
    version: SESSION_VERSION,
    // Copied into a fresh array rather than shared: `GameState.playlists` is `readonly`, and the
    // persisted shape is mutable and structurally separate on purpose (see `PersistedSession`).
    playlists: [...state.playlists],
    seed: state.seed,
    deck: state.deck,
    currentIndex: state.currentIndex,
    isFlipped: state.isFlipped,
    status: state.status,
  };
}

/**
 * Write the session, swallowing any failure.
 *
 * Quota exhaustion and private-mode restrictions both surface as a throw from `setItem`, and
 * neither is a reason to interrupt a game in progress.
 *
 * A card whose `year` is still `undefined` loses the field entirely to `JSON.stringify` -- which
 * is exactly right: absent reads back as `undefined`, i.e. "not looked up yet", and the resolver
 * picks it up again on resume.
 */
export function saveSession(state: GameState, storage: StorageLike): void {
  const session = toPersistedSession(state);
  if (!session) return;

  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn('[session] could not save, continuing without persistence:', describe(error));
  }
}

/**
 * Read a session back, or null.
 *
 * Every rejection also CLEARS the key. A payload that failed validation once will fail it every
 * time, so leaving it in place would mean re-parsing and re-rejecting it on every load, and
 * would keep a stale resume affordance alive in Phase 6 for a session that can never load.
 */
export function loadSession(storage: StorageLike): PersistedSession | null {
  let raw: string | null;
  try {
    raw = storage.getItem(SESSION_STORAGE_KEY);
  } catch (error) {
    // Reading can throw too -- Safari in private mode has historically done so.
    console.warn('[session] could not read:', describe(error));
    return null;
  }

  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearSession(storage);
    return null;
  }

  const session = validateSession(parsed);
  if (!session) {
    clearSession(storage);
    return null;
  }

  return session;
}

/** Drop the save. Called on `END`, and before a `START` that replaces an existing session. */
export function clearSession(storage: StorageLike): void {
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.warn('[session] could not clear:', describe(error));
  }
}

/**
 * Validate a parsed payload into a `PersistedSession`, or reject it.
 *
 * Rebuilt field by field rather than cast: a payload written by a future version could carry
 * extra fields, and copying them into live state wholesale is how a "validated" object smuggles
 * something unvalidated into the reducer.
 *
 * `currentIndex` is the check most likely to earn its keep -- an out-of-range index is the one
 * corruption that would crash the card renderer on the very first frame after a resume.
 */
function validateSession(value: unknown): PersistedSession | null {
  const record = asRecord(value);
  if (!record) return null;

  // The version gate. A mismatch is not corruption -- it is a save from a different build of
  // the app -- but it is equally unusable, and guessing at a migration is how a wrong year ends
  // up on a card. The ONE exception is v1, whose single playlist lifts exactly (see
  // `SESSION_VERSION`); everything else is still a rejection.
  const version = record['version'];
  if (version !== SESSION_VERSION && version !== SESSION_VERSION_LEGACY) return null;

  const playlists =
    version === SESSION_VERSION_LEGACY
      ? liftLegacyPlaylist(record['playlist'])
      : validatePlaylists(record['playlists']);
  if (!playlists) return null;

  const seed = record['seed'];
  if (typeof seed !== 'string' || seed === '') return null;

  const deck = validateDeck(record['deck']);
  if (!deck) return null;

  const currentIndex = record['currentIndex'];
  if (typeof currentIndex !== 'number' || !Number.isInteger(currentIndex)) return null;
  if (currentIndex < 0 || currentIndex >= deck.length) return null;

  const isFlipped = record['isFlipped'];
  if (typeof isFlipped !== 'boolean') return null;

  const status = record['status'];
  // `idle` is excluded deliberately: `toPersistedSession()` never writes one, so its presence
  // means the payload did not come from this code.
  if (status !== 'preparing' && status !== 'playing' && status !== 'ended') return null;

  // Always reported as the CURRENT version, whichever version came in: a lifted v1 payload is a
  // valid v2 session, and the next `saveSession` writes it back as one.
  return {
    version: SESSION_VERSION,
    playlists,
    seed,
    deck,
    currentIndex,
    isFlipped,
    status,
  };
}

/**
 * Validate the v2 `playlists` field: a NON-EMPTY array of summaries.
 *
 * ===========================================================================
 *  DELIBERATELY NOT CAPPED AT `MAX_DECK_PLAYLISTS`, UNLIKE THE LIBRARY
 *  (decision 10).
 *
 *  The cap governs what the landing screen accepts as INPUT. A stored session
 *  describes a deck that ALREADY EXISTS and is already shuffled -- rejecting or
 *  truncating it would throw away a game in progress the moment the cap ever
 *  moved, and truncating would leave the deck's cards attributed to playlists
 *  that are no longer listed beside them.
 *
 *  `playlist-library.ts` caps on read for the opposite reason: an entry there IS
 *  input to a future fetch.
 * ===========================================================================
 */
function validatePlaylists(value: unknown): PlaylistSummary[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const playlists: PlaylistSummary[] = [];
  for (const entry of value) {
    // One bad summary invalidates the whole save, the same call `validateDeck` makes about one bad
    // card: a deck silently missing the playlist it came from would mis-label itself everywhere.
    const playlist = validatePlaylist(entry);
    if (!playlist) return null;
    playlists.push(playlist);
  }

  return playlists;
}

/** A v1 payload's single `playlist`, as the one-element array a v2 payload would have held. */
function liftLegacyPlaylist(value: unknown): PlaylistSummary[] | null {
  const playlist = validatePlaylist(value);

  return playlist ? [playlist] : null;
}

function validatePlaylist(value: unknown): PlaylistSummary | null {
  const record = asRecord(value);
  if (!record) return null;

  const { id, name, owner } = record;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof name !== 'string' || typeof owner !== 'string') return null;

  return { id, name, owner };
}

/** An empty deck is a rejection, not an empty game: there is nothing to resume into. */
function validateDeck(value: unknown): Card[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const deck: Card[] = [];
  for (const entry of value) {
    const card = validateCard(entry);
    // One bad card invalidates the whole save. A deck silently missing a card would break the
    // reproducibility the seed exists for, and would leave `currentIndex` pointing somewhere
    // other than where the player was.
    if (!card) return null;
    deck.push(card);
  }

  return deck;
}

function validateCard(value: unknown): Card | null {
  const record = asRecord(value);
  if (!record) return null;

  const { id, title, artist, durationMs, isPlayable, previewUrl, year, yearConfidence } = record;

  if (typeof id !== 'string' || id === '') return null;
  if (typeof title !== 'string' || typeof artist !== 'string') return null;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return null;
  if (typeof isPlayable !== 'boolean') return null;
  if (previewUrl !== undefined && typeof previewUrl !== 'string') return null;

  // The three states of `Card.year`, and all three are legal in a save: absent (never looked
  // up), null (looked up, nothing found) and a number.
  if (year !== undefined && year !== null && typeof year !== 'number') return null;
  if (yearConfidence !== undefined && !isConfidence(yearConfidence)) return null;

  const card: Card = { id, title, artist, durationMs, isPlayable };
  if (previewUrl !== undefined) card.previewUrl = previewUrl;
  if (year !== undefined) card.year = year;
  if (yearConfidence !== undefined) card.yearConfidence = yearConfidence;

  return card;
}

function isConfidence(value: unknown): value is YearConfidence {
  return value === 'high' || value === 'low' || value === 'none';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** A short, safe description of a thrown value. Never a stack trace. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
