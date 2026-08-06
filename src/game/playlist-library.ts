/**
 * The saved-playlist library: the handful of playlists a player wants back on the landing screen.
 *
 * ===========================================================================
 *  IT SAVES PLAYLISTS, NOT SESSIONS (decision 5).
 *
 *  The obvious alternative was to generalise `hitster:session:v1` into a keyed
 *  collection of full mid-game decks -- "multiple decks" read literally. That
 *  reopens persistence validation, `RESUME`, and the localStorage quota (a deck
 *  holds every card, with every resolved year), and it makes the known two-tab
 *  last-write-wins problem materially worse by multiplying what a clobber costs.
 *
 *  So an entry is an ID, a NAME and a TIMESTAMP. Playing a saved entry re-fetches
 *  normally, which costs one `/api/playlist` call and re-resolves years from the
 *  shared cache. There is still exactly ONE resumable game.
 * ===========================================================================
 *
 * Modelled on `persistence.ts` deliberately, down to the shape of the validators: same injected
 * `StorageLike`, same versioned key, same "a read failure is a MISS, a write failure is a NO-OP,
 * nothing throws" contract, same field-by-field rebuild rather than a cast. Two storage modules
 * that behave differently under corruption would be two things to remember instead of one.
 *
 * ===========================================================================
 *  A TRACK TITLE MUST NEVER ENTER THIS STORE.
 *
 *  It is read on the LANDING SCREEN, which is a pre-start surface -- the one place
 *  in the app where a leak costs the whole game before it begins. Playlist-level
 *  data only, exactly as `PlaylistSummary` is. `name` is a playlist title, which
 *  is the same class of data the suggested-playlist buttons already show.
 * ===========================================================================
 */

import type { StorageLike } from './persistence';

/**
 * The storage key, versioned for the same reason `hitster:session:v1` is: when the shape changes
 * incompatibly, bumping this makes every existing entry unreachable in one edit rather than
 * half-loadable months later.
 */
export const LIBRARY_STORAGE_KEY = 'hitster:library:v1';

/** Current payload version. Bump together with any incompatible shape change. */
export const LIBRARY_VERSION = 1;

/**
 * How many entries are kept, most-recent-first.
 *
 * ===========================================================================
 *  THE CAP IS WHAT STOPS A QUOTA ERROR FROM BECOMING THIS FEATURE'S FAILURE
 *  MODE.
 *
 *  An uncapped list grows every time somebody presses Save, and a `setItem` that
 *  throws on quota is swallowed here by design -- so the visible symptom would be
 *  "saving silently stopped working", with no way for the player to know why.
 *  Twenty playlist summaries are a couple of kilobytes; the number is a product
 *  judgement (a landing-screen list nobody scrolls) rather than a storage limit.
 * ===========================================================================
 */
export const LIBRARY_MAX_ENTRIES = 20;

/** One saved playlist. Playlist-level data only -- see the header block. */
export interface SavedPlaylist {
  /** The Spotify playlist id, as `PlaylistSummary.id`. The dedupe key. */
  id: string;
  /** The playlist's own title, as shown on the landing screen. */
  name: string;
  /** When it was saved, epoch milliseconds. Sorts the list; never rendered as a date. */
  savedAt: number;
}

interface LibraryPayload {
  version: number;
  entries: SavedPlaylist[];
}

/**
 * Read the library, or an empty array.
 *
 * Every rejection also CLEARS the key, exactly as `loadSession` does: a payload that failed
 * validation once fails it every time, so leaving it in place means re-parsing and re-rejecting it
 * on every landing-screen render, and a half-loaded library is worse than an empty one.
 *
 * Returns `[]` rather than null for a miss, because every caller wants a list to map over and none
 * of them distinguishes "no library" from "an empty one".
 */
export function loadLibrary(storage: StorageLike): SavedPlaylist[] {
  let raw: string | null;
  try {
    raw = storage.getItem(LIBRARY_STORAGE_KEY);
  } catch (error) {
    // Reading can throw -- Safari in private mode has historically done so.
    console.warn('[library] could not read:', describe(error));
    return [];
  }

  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearLibrary(storage);
    return [];
  }

  const entries = validateLibrary(parsed);
  if (!entries) {
    clearLibrary(storage);
    return [];
  }

  return entries;
}

/**
 * Save a playlist, most-recent-first, deduped by id and capped.
 *
 * Re-saving a playlist already in the library MOVES it to the front with a new timestamp rather
 * than adding a second row -- a player who plays a favourite twice has one favourite, and a list
 * with two identical rows and different timestamps is a bug that looks like data.
 *
 * Returns the list as written, so a caller can put it straight into state without a second read.
 * A write failure returns the list it TRIED to write: the in-memory view stays consistent with what
 * the player just did, and the next successful write repairs the store.
 */
export function savePlaylist(storage: StorageLike, entry: SavedPlaylist): SavedPlaylist[] {
  /*
    ===========================================================================
     REBUILT FIELD BY FIELD ON THE WAY IN, NOT JUST ON THE WAY OUT.

     `savePlaylist({ ...somethingLarger })` type-checks against a structural
     interface, and TypeScript's excess-property check does not fire for a spread
     or for a variable. So a caller handing over a `PlaylistResult`, or a summary
     that gains a `tracks` field later, would write the whole thing to
     localStorage -- on a store the LANDING SCREEN reads. Measured by this
     module's own leak test, which failed against the first version of this
     function.

     Three named fields make the leak UNAVAILABLE rather than merely avoided,
     which is the same reason `validateSession` rebuilds instead of casting.
    ===========================================================================
  */
  const clean: SavedPlaylist = { id: entry.id, name: entry.name, savedAt: entry.savedAt };

  const existing = loadLibrary(storage).filter((saved) => saved.id !== clean.id);
  const entries = [clean, ...existing].slice(0, LIBRARY_MAX_ENTRIES);

  writeLibrary(storage, entries);

  return entries;
}

/** Drop one playlist by id. Returns the remaining list. Removing an absent id is a no-op write. */
export function removePlaylist(storage: StorageLike, id: string): SavedPlaylist[] {
  const entries = loadLibrary(storage).filter((saved) => saved.id !== id);

  writeLibrary(storage, entries);

  return entries;
}

/** Drop the whole library. Called on a rejected payload, and by nothing else. */
export function clearLibrary(storage: StorageLike): void {
  try {
    storage.removeItem(LIBRARY_STORAGE_KEY);
  } catch (error) {
    console.warn('[library] could not clear:', describe(error));
  }
}

/**
 * Write, swallowing any failure.
 *
 * Quota exhaustion and private-mode restrictions both surface as a throw from `setItem`, and
 * neither is a reason to interrupt anything: the player pressed Save on a screen whose next action
 * is "Play again".
 */
function writeLibrary(storage: StorageLike, entries: SavedPlaylist[]): void {
  const payload: LibraryPayload = { version: LIBRARY_VERSION, entries };

  try {
    storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('[library] could not save, continuing without it:', describe(error));
  }
}

/**
 * Validate a parsed payload into entries, or reject the WHOLE store.
 *
 * One bad entry invalidates everything, which is the same call `validateDeck` makes about one bad
 * card. A library silently missing a row would have the player believe they removed something they
 * did not, and rebuilding field by field is what stops a payload from a future version smuggling an
 * unvalidated field into a component's props.
 */
function validateLibrary(value: unknown): SavedPlaylist[] | null {
  const record = asRecord(value);
  if (!record) return null;

  // A version mismatch is not corruption -- it is a payload from a different build -- but it is
  // equally unusable, and guessing at a migration is how a wrong name ends up on a button.
  if (record['version'] !== LIBRARY_VERSION) return null;

  const rawEntries = record['entries'];
  if (!Array.isArray(rawEntries)) return null;

  const entries: SavedPlaylist[] = [];
  const seen = new Set<string>();
  for (const candidate of rawEntries) {
    const entry = validateEntry(candidate);
    if (!entry) return null;
    // A duplicate id is corruption rather than data: `savePlaylist` cannot produce one.
    if (seen.has(entry.id)) return null;
    seen.add(entry.id);
    entries.push(entry);
  }

  // The cap is enforced on READ as well as on write, so a payload written by a build with a larger
  // cap cannot put an unbounded list on the landing screen.
  return entries.slice(0, LIBRARY_MAX_ENTRIES);
}

function validateEntry(value: unknown): SavedPlaylist | null {
  const record = asRecord(value);
  if (!record) return null;

  const { id, name, savedAt } = record;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof name !== 'string') return null;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;

  return { id, name, savedAt };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** A short, safe description of a thrown value. Never a stack trace. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
