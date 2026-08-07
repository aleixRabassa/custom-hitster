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
 *  So an entry is a LIST OF IDS, a NAME and a TIMESTAMP. Playing a saved entry
 *  re-fetches normally, which costs one `/api/playlist` call per id and
 *  re-resolves years from the shared cache. There is still exactly ONE resumable
 *  game -- multi-playlist widened what a deck is dealt from, not how many
 *  sessions exist.
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
 *  data only, exactly as `PlaylistSummary` is. `name` is a playlist title -- now
 *  a `deckLabel()` over up to five of them, which is the same class of data the
 *  suggested-playlist buttons already show -- and `ids` is up to five playlist
 *  ids. Neither can name a track, an artist or a year.
 *
 *  MULTI-PLAYLIST MADE THE WRITE-SIDE REBUILD MATTER MORE, not less: an ARRAY
 *  field is a new way to smuggle a larger object in, so `savePlaylist` rebuilds
 *  the ids ELEMENT BY ELEMENT rather than sharing the caller's array.
 * ===========================================================================
 */

import { MAX_DECK_PLAYLISTS } from './deck-merge';
import type { StorageLike } from './persistence';

/**
 * The storage key, versioned for the same reason `hitster:session:v1` is: when the shape changes
 * incompatibly, bumping this makes every existing entry unreachable in one edit rather than
 * half-loadable months later.
 */
export const LIBRARY_STORAGE_KEY = 'hitster:library:v1';

/**
 * Current payload version. Bump together with any incompatible shape change.
 *
 * ===========================================================================
 *  v2 IS MULTI-PLAYLIST, AND v1 IS READ BY LIFTING EACH ENTRY'S `id` INTO
 *  `[id]` (decision 7).
 *
 *  Same reasoning as `SESSION_VERSION`'s lift, and HERE IT MATTERS MORE. A
 *  version mismatch clears the whole store, so shipping v2 without the lift would
 *  silently empty a library the player CURATED -- on the landing screen, with no
 *  message, and with nothing to distinguish it from "you never saved anything".
 *  A lost session is one game; a lost library is every game they meant to keep.
 *
 *  Exact rather than a guess: a v1 entry described exactly one playlist.
 * ===========================================================================
 */
export const LIBRARY_VERSION = 2;

/** The version this module can still read, by lifting each entry's single id. See above. */
const LIBRARY_VERSION_LEGACY = 1;

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

/** One saved deck: 1..5 playlists. Playlist-level data only -- see the header block. */
export interface SavedPlaylist {
  /**
   * The Spotify playlist ids the deck was dealt from, as `PlaylistSummary.id`, in row order.
   *
   * Non-empty, and capped at `MAX_DECK_PLAYLISTS` on read. The DEDUPE KEY is `savedDeckKey()` over
   * this array, not the array itself -- see that function for why it sorts.
   */
  ids: string[];
  /** What to call the deck: `deckLabel()`'s output, as shown on the landing screen. */
  name: string;
  /** When it was saved, epoch milliseconds. Sorts the list; never rendered as a date. */
  savedAt: number;
}

interface LibraryPayload {
  version: number;
  entries: SavedPlaylist[];
}

/**
 * The identity of a saved deck: its ids, SORTED and joined.
 *
 * ===========================================================================
 *  SORTED, SO ROW ORDER DOES NOT CREATE A SECOND FAVOURITE (decision 11).
 *
 *  The same three playlists entered in a different order are ONE favourite. Left
 *  unsorted, saving them twice would produce two rows with the same `deckLabel()`
 *  and the same playlists, distinguishable only by their timestamps -- which is
 *  the "a bug that looks like data" this module's dedupe already exists to
 *  prevent, one dimension up.
 *
 *  DERIVED ON DEMAND AND NEVER STORED. A stored key is a second source of truth
 *  that can disagree with the ids sitting beside it, and the disagreement would
 *  only show up as a remove button that removes the wrong row.
 *
 *  It is also (plan 2) the React list key and the `removePlaylist` argument, so
 *  all three read one function.
 * ===========================================================================
 */
export function savedDeckKey(entry: Pick<SavedPlaylist, 'ids'>): string {
  return [...entry.ids].sort().join(',');
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
 * Save a deck, most-recent-first, deduped by `savedDeckKey` and capped.
 *
 * Re-saving a deck already in the library MOVES it to the front with a new timestamp rather
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

     `ids` IS REBUILT ELEMENT BY ELEMENT, not spread. An array field is a new way
     to smuggle a larger object in -- `[...entry.ids]` would happily copy across
     whatever a caller had put in it -- so each element is checked and coerced to
     a plain string, and anything that is not one is dropped.
    ===========================================================================
  */
  const clean: SavedPlaylist = {
    ids: entry.ids
      .filter((id): id is string => typeof id === 'string' && id !== '')
      .slice(0, MAX_DECK_PLAYLISTS),
    name: entry.name,
    savedAt: entry.savedAt,
  };

  const key = savedDeckKey(clean);
  const existing = loadLibrary(storage).filter((saved) => savedDeckKey(saved) !== key);
  const entries = [clean, ...existing].slice(0, LIBRARY_MAX_ENTRIES);

  writeLibrary(storage, entries);

  return entries;
}

/**
 * Drop one saved deck by its `savedDeckKey`. Returns the remaining list.
 *
 * Keyed rather than id-based because an entry is now a SET of playlists: removing "the deck with
 * this id in it" would take out every deck that happens to share one playlist. Removing an absent
 * key is a no-op write.
 */
export function removePlaylist(storage: StorageLike, key: string): SavedPlaylist[] {
  const entries = loadLibrary(storage).filter((saved) => savedDeckKey(saved) !== key);

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
  // equally unusable, and guessing at a migration is how a wrong name ends up on a button. The ONE
  // exception is v1, whose single id per entry lifts exactly (see `LIBRARY_VERSION`).
  const version = record['version'];
  if (version !== LIBRARY_VERSION && version !== LIBRARY_VERSION_LEGACY) return null;
  const isLegacy = version === LIBRARY_VERSION_LEGACY;

  const rawEntries = record['entries'];
  if (!Array.isArray(rawEntries)) return null;

  const entries: SavedPlaylist[] = [];
  const seen = new Set<string>();
  for (const candidate of rawEntries) {
    const entry = isLegacy ? liftLegacyEntry(candidate) : validateEntry(candidate);
    if (!entry) return null;
    // A duplicate deck is corruption rather than data: `savePlaylist` cannot produce one.
    const key = savedDeckKey(entry);
    if (seen.has(key)) return null;
    seen.add(key);
    entries.push(entry);
  }

  // The cap is enforced on READ as well as on write, so a payload written by a build with a larger
  // cap cannot put an unbounded list on the landing screen.
  return entries.slice(0, LIBRARY_MAX_ENTRIES);
}

function validateEntry(value: unknown): SavedPlaylist | null {
  const record = asRecord(value);
  if (!record) return null;

  const { ids, name, savedAt } = record;
  if (typeof name !== 'string') return null;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;

  const validIds = validateIds(ids);
  if (!validIds) return null;

  return { ids: validIds, name, savedAt };
}

/**
 * A non-empty array of non-empty strings, CAPPED AT `MAX_DECK_PLAYLISTS` on read.
 *
 * ===========================================================================
 *  CAPPED HERE, UNLIKE A STORED SESSION, AND THE ASYMMETRY IS THE POINT
 *  (decision 10).
 *
 *  A library entry is INPUT to a future fetch: pressing it fires one
 *  `/api/playlist` request per id. So a payload written by a build with a larger
 *  cap -- or edited by hand -- must not be able to fan out past what this build
 *  allows. `persistence.ts` deliberately does the opposite, because a stored
 *  session describes a deck that already exists.
 *
 *  Truncated rather than rejected, matching how `validateLibrary` already caps
 *  the entry COUNT on read: an over-long entry is still recognisably the deck the
 *  player saved.
 * ===========================================================================
 */
function validateIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || id === '') return null;
    ids.push(id);
  }

  return ids.slice(0, MAX_DECK_PLAYLISTS);
}

/** A v1 entry, whose single `id` becomes `[id]`. Every other field is validated unchanged. */
function liftLegacyEntry(value: unknown): SavedPlaylist | null {
  const record = asRecord(value);
  if (!record) return null;

  const { id } = record;
  if (typeof id !== 'string' || id === '') return null;

  return validateEntry({ ...record, ids: [id] });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** A short, safe description of a thrown value. Never a stack trace. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
