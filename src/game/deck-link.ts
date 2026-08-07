/**
 * The shareable deck link: `?playlist={id}[,{id}...]&seed={hex}`.
 *
 * Pure parse and build over STRINGS. No `window`, no `URL` construction against
 * `location`, no history API — the caller hands in a query string and an origin, which is what
 * keeps these tests in the node environment and what lets `App.test.tsx` drive the entry path
 * without touching `window.location`.
 *
 * ===========================================================================
 *  WHAT THE LINK PROMISES: "SAME PLAYLISTS, SAME SHUFFLE". NOT "THE SAME DECK".
 *
 *  The seeded shuffle is exact -- `shuffleDeck` over the same fetched track list
 *  with the same seed always deals the same order. The INPUT to it is not
 *  reproducible, for THREE independent reasons:
 *
 *  1. A card whose year lookup finds nothing is REMOVED from the deck
 *     (`gameReducer`, `YEAR_RESOLVED`, 2026-08-05), and which cards those are
 *     depends on what MusicBrainz answers at play time.
 *  2. An editorial playlist has its tracks refreshed by Spotify periodically, so
 *     even the fetched list can differ between two opens of the same link.
 *  3. NEW WITH MULTI-PLAYLIST: a link can name up to five playlists, and one that
 *     has gone private or been deleted since the link was made is DROPPED with a
 *     notice rather than blocking the deal (decision 4). So the recipient can get
 *     a strictly smaller deck than the sender had, from fewer playlists, and
 *     nothing about that is an error state.
 *
 *  This is a COPY problem rather than a blocker (decision 4), and the copy on the
 *  end screen is where it is handled -- never "share this exact deck". The only
 *  encoding that could pin the card set is a versioned opaque token carrying every
 *  id, which costs an unreadable link and an encoder nobody asked for.
 * ===========================================================================
 *
 * ## Why query params and not a hash fragment
 *
 * A hash is marginally more private (it never reaches a server) and is mangled by some chat
 * clients, which for a link people paste into WhatsApp is the deciding half. Query params are
 * also what `GameState.seed`'s own comment predicted: the seed is "accepted as an override on
 * `START`, so a Phase 8 shareable URL (playlist id + seed) is a caller change rather than a
 * reducer change". Nothing in the reducer changes for this feature.
 */

import { MAX_DECK_PLAYLISTS } from './deck-merge';
import { parsePlaylistUrl } from '../../shared/spotify-url';

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
 *  survived a shouty chat client should still work.
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
 *  missing parameter and a mangled `%`-escape all return `null`.
 *
 *  Both parameters are REQUIRED. A playlist with no seed would deal a random
 *  order, which is what the landing form already does and not what the link
 *  promised; a seed with no playlist addresses nothing.
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

  return { playlistIds, seed: seed.toLowerCase() };
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
 * The ids and the seed are NOT validated here. Both come from live `GameState` -- the ids from
 * playlists the server resolved, the seed from `generateSeed()` or from a link this same module
 * already validated -- and a builder that could fail would push an error branch into a click
 * handler. Interpolation is safe: a Spotify id is 22 base62 characters and a seed is hex, so
 * neither can escape a query value.
 *
 * The ids are joined with a LITERAL COMMA and nothing is escaped, because nothing needs to be: a
 * comma is a legal query-value character (see `ID_SEPARATOR`), and it keeps the link readable in
 * the chat clients this app's links get pasted into.
 */
export function buildDeckLink(
  origin: string,
  playlistIds: readonly string[],
  seed: string,
): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const ids = playlistIds.join(ID_SEPARATOR);

  return `${base}?${PLAYLIST_PARAM}=${ids}&${SEED_PARAM}=${seed}`;
}
