/**
 * The shareable deck link: `?playlist={id}[,{id}...]&seed={hex}[&v=2][&card={trackId}]`.
 *
 * Pure parse and build over STRINGS. No `window`, no `URL` construction against
 * `location`, no history API — the caller hands in a query string and an origin, which is what
 * keeps these tests in the node environment and what lets `App.test.tsx` drive the entry path
 * without touching `window.location`. `linkArrivalIntent` is the one DECISION the container makes
 * about a link, kept here for the same reason: it is a node-tested function over plain data.
 *
 * ===========================================================================
 *  WHAT THE LINK PROMISES: "SAME PLAYLISTS, SAME SHUFFLE, SAME CARD". STILL NOT
 *  "THE SAME DECK".
 *
 *  The seeded deal is exact -- `dealDeck` over the same cards with the same seed
 *  and the same version always deals the same order. What changed on 2026-09-29
 *  (review of the shuffle system, decisions D1 and D3) is how much of that
 *  survives when the INPUT differs:
 *
 *  - VERSION 2 (`v=2`, every link minted since): the deal is a hash sort, so a
 *    card's place relative to every other card depends only on the seed and the
 *    two ids. The ORDER NOW SURVIVES PLAYLIST DRIFT -- a track added or removed
 *    on the recipient's side is a card slotted in or a gap, never a
 *    re-randomised deck -- and a link copied after "Play again" reproduces the
 *    deck, because re-dealing an already-shuffled deck with a seed IS dealing
 *    the raw fetch with it.
 *  - VERSION 1 (no `v`, every link minted before): Fisher-Yates, kept exactly.
 *    A link in the wild must still deal the order its sender saw, and it still
 *    has Fisher-Yates' fragility: any change in length re-deals everything.
 *  - POSITION (`card`, mid-game links only): the sender's CURRENT card, by track
 *    id. An id rather than an index because the sender's deck has already shrunk
 *    by its yearless cards while the recipient's starts full, and because an id
 *    survives drift where an index silently points at a different card. An id
 *    the recipient's deck does not hold falls back to card 1.
 *
 *  The input to the deal is still not reproducible, for THREE independent
 *  reasons, and they now cost CARDS rather than the ORDER:
 *
 *  1. A card whose year lookup finds nothing is REMOVED from the deck
 *     (`gameReducer`, `YEAR_RESOLVED`, 2026-08-05), and which cards those are
 *     depends on what MusicBrainz answers at play time.
 *  2. An editorial playlist has its tracks refreshed by Spotify periodically, so
 *     even the fetched list can differ between two opens of the same link.
 *  3. A link can name up to five playlists, and one that has gone private or
 *     been deleted since the link was made is DROPPED with a notice rather than
 *     blocking the deal (multi-playlist decision 4). So the recipient can get a
 *     strictly smaller deck than the sender had, from fewer playlists, and
 *     nothing about that is an error state.
 *
 *  So the copy still never says "this exact deck". The only encoding that could
 *  pin the card set is every id in the URL, which is ~11.5 kB for five full
 *  playlists and a complete answer key before card 1 (every id resolves publicly
 *  at `open.spotify.com/track/{id}`).
 * ===========================================================================
 *
 * ===========================================================================
 *  `v` IS NEVER WRITTEN FOR VERSION 1, AND AN ABSENT `v` MEANS VERSION 1 FOREVER.
 *
 *  A version-1 deck (a game dealt from an old link, or resumed from an old save)
 *  shares a link BYTE-IDENTICAL to what a pre-2026-09-29 build minted, so it
 *  also deals correctly on a stale cached build. A `v` this build does not know
 *  (`v=3`, `v=`) rejects the WHOLE link: dealing a future version's seed with
 *  today's algorithm would deal a confident, wrong order.
 * ===========================================================================
 *
 * ## Why query params and not a hash fragment
 *
 * A hash is marginally more private (it never reaches a server) and is mangled by some chat
 * clients, which for a link people paste into WhatsApp is the deciding half. Query params are
 * also what `GameState.seed`'s own comment predicted: the seed is "accepted as an override on
 * `START`, so a Phase 8 shareable URL (playlist id + seed) is a caller change rather than a
 * reducer change". That held for the first version of the link; the version and the start card
 * (2026-09-29) are the two things the reducer had to learn, as `START`'s `shuffleVersion` and
 * `startCardId`.
 */

import { MAX_DECK_PLAYLISTS } from './deck-merge';
import type { ShuffleVersion } from './shuffle';
import type { GameState } from './types';
import { SPOTIFY_ID_PATTERN, parsePlaylistUrl } from '../../shared/spotify-url';

/**
 * The query parameter carrying the playlists.
 *
 * Its value is a COMMA-SEPARATED LIST of anything `parsePlaylistUrl` accepts, and a single id is
 * simply the one-element case -- so every link shared before multi-playlist parses identically and
 * needs no back-compat branch (decision 8).
 */
export const PLAYLIST_PARAM = 'playlist';

/**
 * The separator between ids in the `playlist` value.
 *
 * A comma is a legal query-VALUE character (RFC 3986 puts it in `sub-delims`), so neither the
 * builder nor `URLSearchParams` has to escape it, and the link stays readable in a chat client.
 */
const ID_SEPARATOR = ',';

/** The query parameter carrying the shuffle seed. */
export const SEED_PARAM = 'seed';

/**
 * The query parameter naming the algorithm that dealt the deck (`ShuffleVersion`). Absent means
 * `1`; see the header block for why the builder never writes `v=1`.
 */
export const SHUFFLE_VERSION_PARAM = 'v';

/**
 * The query parameter carrying the sender's current card, as a 22-character Spotify track id.
 *
 * Only a MID-GAME link carries it. At the end of a deck `currentIndex` stays clamped on the last
 * card, so an end-screen link with a position would drop its recipient on the final card of a deck
 * they have never played.
 */
export const CARD_PARAM = 'card';

/**
 * The alphabet and length a generated seed can have.
 *
 * ===========================================================================
 *  THE SEED IS VALIDATED BECAUSE IT IS PERSISTED AND HASHED, NOT BECAUSE IT IS
 *  DANGEROUS ON ITS OWN.
 *
 *  `generateSeed()` produces exactly 16 lowercase hex characters (8 random
 *  bytes), so the app's own alphabet is known and narrow. An unvalidated seed
 *  goes into `hashSeed()` -- which happily hashes a megabyte of anything -- and
 *  then into `toPersistedSession`, where it becomes part of a `localStorage`
 *  payload that survives reloads. So the bound is on what gets STORED, and the
 *  cheapest correct answer is to accept only what this app can mint.
 *
 *  Case-insensitive on read and lowercased on build: hex is hex, and a link that
 *  survived a shouty chat client should still work. THE `card` PARAM IS THE
 *  OPPOSITE CASE: a track id is base62, where `a` and `A` are different digits,
 *  so it is matched exactly and never lowercased.
 * ===========================================================================
 */
const SEED_PATTERN = /^[0-9a-f]{16}$/i;

/** A link that named 1..5 playlists and a seed this app could have produced. */
export interface DeckLink {
  /**
   * Bare 22-character Spotify playlist ids, each already through `parsePlaylistUrl`.
   *
   * Ordered as the link listed them and deduped, so it is directly the row order the fan-out and
   * the merge want. Never empty, and never longer than `MAX_DECK_PLAYLISTS`.
   */
  playlistIds: string[];
  /** Lowercased hex, exactly as `generateSeed()` mints it. */
  seed: string;
  /** 1 when the link has no `v` param. */
  shuffleVersion: ShuffleVersion;
  /** The `card` param: a 22-char Spotify track id, case preserved. null when absent. */
  cardId: string | null;
}

/** What a link carries beyond its playlists and seed. */
export interface DeckLinkOptions {
  /**
   * The version that dealt the deck. REQUIRED, never defaulted: a forgotten version would silently
   * mint a version-1 link for a version-2 deck, and the recipient would be dealt a different order
   * with nothing on either screen to say so.
   */
  shuffleVersion: ShuffleVersion;
  /** The sender's current card. Only a mid-game link passes it (see `CARD_PARAM`). */
  cardId?: string;
}

/**
 * Read a deck link out of a query string, or `null`.
 *
 * ===========================================================================
 *  A MALFORMED LINK IS `null`, AND `null` MEANS THE PLAIN LANDING SCREEN WITH NO
 *  ERROR (step 6).
 *
 *  Someone whose chat client ate half a URL is not in a failure state worth a red
 *  banner -- they are a visitor who should see the form. Every rejection here
 *  therefore looks identical to "no link at all": a bad seed, an album link, a
 *  missing parameter, a mangled `%`-escape, an unknown `v` and a malformed `card`
 *  all return `null`.
 *
 *  `playlist` and `seed` are REQUIRED. A playlist with no seed would deal a random
 *  order, which is what the landing form already does and not what the link
 *  promised; a seed with no playlist addresses nothing. `v` and `card` are
 *  optional, but PRESENT-AND-MALFORMED is a rejection rather than an absence --
 *  the same one-bad-element rule the playlist list follows, so a mangled position
 *  cannot quietly deal from card 1 as if the sender had sent none.
 * ===========================================================================
 *
 * ===========================================================================
 *  A LINK NAMING MORE THAN `MAX_DECK_PLAYLISTS` IS REJECTED, NOT TRUNCATED
 *  (decision 9).
 *
 *  Truncating would deal a deck the link did not describe -- silently, and with a
 *  seed that makes it look deliberate. Rejecting is also the CHEAPER answer to
 *  explain, because every other rejection in this module already looks identical
 *  to "no link at all": the plain landing screen, no error, the params still in
 *  the address bar.
 *
 *  The DEDUPE RUNS FIRST, so a link that repeats one id is not punished for it --
 *  six entries naming five distinct playlists is a five-playlist link.
 * ===========================================================================
 *
 * @param search a `location.search`-shaped string. A leading `?` is optional, `''` is a miss.
 */
export function parseDeckLink(search: string): DeckLink | null {
  // Runtime guard rather than a redundant type check: this value comes from `location.search`
  // through a prop, and the test suite is entitled to pass anything a URL bar can hold.
  if (typeof search !== 'string' || search === '' || search === '?') return null;

  let params: URLSearchParams;
  try {
    // `URLSearchParams` and not a hand-rolled split: it handles `+`-as-space and percent escapes,
    // and it is available in every browser this app targets. It is also the one place a mangled
    // escape can throw, which is why the whole construction sits in a `try`.
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    return null;
  }

  /*
    `getAll`, not `get`: the canonical form the builder emits is ONE `playlist` param holding a
    comma list, but repeated `playlist` params are accepted too and flattened into the same list.
    That is one line of tolerance for a link a chat client, a URL shortener or a future build
    reshaped -- and because the builder only ever emits the comma form, the round trip stays exact.
  */
  const playlistParams = params.getAll(PLAYLIST_PARAM);
  const seedParam = params.get(SEED_PARAM);
  if (playlistParams.length === 0 || seedParam === null) return null;

  const playlistIds: string[] = [];
  for (const param of playlistParams) {
    for (const element of param.split(ID_SEPARATOR)) {
      const trimmed = element.trim();
      // An empty element is what a trailing comma or a doubled one produces. Dropped rather than
      // failed: it is punctuation, not a playlist somebody meant to name.
      if (trimmed === '') continue;

      // EVERY element goes through the SHARED parser, not a new regex. A bare id is already one of
      // the forms it accepts, so this is reuse rather than a special case -- and it means a link
      // carrying a full `open.spotify.com/playlist/...` URL is judged by exactly the same code the
      // landing form and `api/playlist.ts` use, in every position.
      const parsed = parsePlaylistUrl(trimmed);
      // One bad element fails the WHOLE link, so an album link buried at position four cannot deal
      // a quietly smaller deck than the sender described.
      if (!parsed.ok) return null;

      if (!playlistIds.includes(parsed.id)) playlistIds.push(parsed.id);
    }
  }

  // Nothing usable: `?playlist=` on its own, or a value of nothing but commas.
  if (playlistIds.length === 0) return null;
  // Deduped above, so this counts DISTINCT playlists (see the header block).
  if (playlistIds.length > MAX_DECK_PLAYLISTS) return null;

  const seed = seedParam.trim();
  if (!SEED_PATTERN.test(seed)) return null;

  // `get`, not `getAll`: the builder writes each of these at most once, and a repeated one is a
  // reshaped link whose first value is as good a reading as any.
  const shuffleVersion = parseShuffleVersion(params.get(SHUFFLE_VERSION_PARAM));
  if (shuffleVersion === null) return null;

  const cardParam = params.get(CARD_PARAM);
  let cardId: string | null = null;
  if (cardParam !== null) {
    const trimmed = cardParam.trim();
    // The SHARED id pattern, so a track id is judged by the same rule as a playlist id. Never
    // lowercased: base62 is case-sensitive, and a lowercased id names a different track (or none).
    if (!SPOTIFY_ID_PATTERN.test(trimmed)) return null;
    cardId = trimmed;
  }

  return { playlistIds, seed: seed.toLowerCase(), shuffleVersion, cardId };
}

/**
 * The `v` param as a `ShuffleVersion`: absent is `1`, and anything but the exact strings this build
 * can deal is `null`. Matched as strings rather than through `Number()`, so `v=2.0`, `v=02` and
 * `v=0x2` are the unknown versions they look like rather than a `2` nobody wrote.
 */
function parseShuffleVersion(value: string | null): ShuffleVersion | null {
  if (value === null) return 1;

  switch (value.trim()) {
    case '1':
      return 1;
    case '2':
      return 2;
    default:
      return null;
  }
}

/**
 * Build the shareable link for a dealt deck.
 *
 * The origin is passed in rather than read from `location`, for the same reason the parser takes a
 * string: this module stays pure and node-testable. `EndScreen` passes `window.location.origin`
 * plus `pathname`, so an app served from a sub-path keeps it.
 *
 * A trailing slash on `origin` is tolerated and normalised, because `location.origin +
 * location.pathname` produces one for a root-served app.
 *
 * The ids, the seed and the card id are NOT validated here. All three come from live `GameState`
 * -- the ids from playlists the server resolved, the seed from `generateSeed()` or from a link this
 * same module already validated, the card id from the embed payload's own track URI -- and a
 * builder that could fail would push an error branch into a click handler. Interpolation is safe:
 * a Spotify id is 22 base62 characters and a seed is hex, so none of them can escape a query value.
 *
 * The ids are joined with a LITERAL COMMA and nothing is escaped, because nothing needs to be: a
 * comma is a legal query-value character (see `ID_SEPARATOR`), and it keeps the link readable in
 * the chat clients this app's links get pasted into.
 *
 * `v` is appended for every version BUT 1, so a version-1 deck's link is byte-identical to what
 * every build before 2026-09-29 minted (see the header block); `card` comes last, and only when
 * given. The test is `!== 1` rather than `=== 2` so that a future version cannot mint an
 * unversioned link -- the same forgotten-version failure `DeckLinkOptions` refuses, one step later.
 */
export function buildDeckLink(
  origin: string,
  playlistIds: readonly string[],
  seed: string,
  options: DeckLinkOptions,
): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const ids = playlistIds.join(ID_SEPARATOR);

  let link = `${base}?${PLAYLIST_PARAM}=${ids}&${SEED_PARAM}=${seed}`;
  if (options.shuffleVersion !== 1) link += `&${SHUFFLE_VERSION_PARAM}=${options.shuffleVersion}`;
  if (options.cardId !== undefined) link += `&${CARD_PARAM}=${options.cardId}`;

  return link;
}

/**
 * What opening a link should do, given the session the app booted with.
 *
 * - `'deal'`:   there is no game to protect; deal the link.
 * - `'resume'`: the link describes the saved game itself; resume it and ignore the link.
 * - `'ask'`:    the link describes a DIFFERENT deck than the saved game; ask the player whether to
 *               replace their game with it (decision D4).
 */
export type LinkArrival = 'deal' | 'resume' | 'ask';

/**
 * The container's one decision about a link on arrival (review of the shuffle system, D2 and D4).
 *
 * ===========================================================================
 *  A RELOAD NEVER MODIFIES A GAME, AND THAT IS WHY `'resume'` EXISTS.
 *
 *  A tab opened from a link keeps the link in its address bar for the whole game
 *  (`App.tsx` never touches the address bar), so every mid-game RELOAD of that
 *  tab arrives with a saved session AND a link at once. Asking "replace your
 *  game?" there would be asking the player about their own game on every reload,
 *  which the developer's rule forbids: "si el enlace es el mismo, nunca se debe
 *  modificar la partida". So a link that describes the saved deck resumes
 *  silently, and only a DIFFERENT deck is worth a question.
 * ===========================================================================
 *
 * ===========================================================================
 *  "DESCRIBES THE SAVED DECK" IS SAME SEED, SAME VERSION, AND THE SAVED
 *  PLAYLISTS A SUBSET OF THE LINK'S -- AND NEVER THE CARD.
 *
 *  - THE SEED is 64 random bits, so it is the real identity: two unrelated games
 *    do not share one.
 *  - THE VERSION, because the same seed dealt by the other algorithm is a
 *    different order, i.e. a different deck.
 *  - A SUBSET, NOT EQUALITY: a recipient whose link named five playlists, one of
 *    which failed to load, has four in state (`GameState.playlists` holds only
 *    the playlists that LOADED). Their reload must still resume silently.
 *    Order is not compared for the same reason -- the ids are the set of
 *    playlists, and the seed already pins the deal.
 *  - THE CARD IS NOT COMPARED, deliberately: it is where the SENDER was when
 *    they copied the link, and a reloader has moved on since. Comparing it would
 *    make every reload after the first swipe a prompt, and honouring it would
 *    move the reloader off their own card.
 * ===========================================================================
 *
 * `idle` and `ended` are `'deal'`: after End or Exit the game no longer exists and the save is
 * cleared, so a reload deals the link again from the top (D2, rule 4). Only `preparing` and
 * `playing` -- the statuses a restored save can hold -- have a game to protect.
 */
export function linkArrivalIntent(
  link: DeckLink,
  session: Pick<GameState, 'status' | 'playlists' | 'seed' | 'shuffleVersion'>,
): LinkArrival {
  if (session.status === 'idle' || session.status === 'ended') return 'deal';

  const describesSavedDeck =
    session.seed === link.seed &&
    session.shuffleVersion === link.shuffleVersion &&
    session.playlists.every((playlist) => link.playlistIds.includes(playlist.id));

  return describesSavedDeck ? 'resume' : 'ask';
}
