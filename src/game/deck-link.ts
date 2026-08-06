/**
 * The shareable deck link: `?playlist={id}&seed={hex}`.
 *
 * Pure parse and build over STRINGS. No `window`, no `URL` construction against
 * `location`, no history API — the caller hands in a query string and an origin, which is what
 * keeps these tests in the node environment and what lets `App.test.tsx` drive the entry path
 * without touching `window.location`.
 *
 * ===========================================================================
 *  WHAT THE LINK PROMISES: "SAME PLAYLIST, SAME SHUFFLE". NOT "THE SAME DECK".
 *
 *  The seeded shuffle is exact -- `shuffleDeck` over the same fetched track list
 *  with the same seed always deals the same order. The INPUT to it is not
 *  reproducible, for two independent reasons:
 *
 *  1. A card whose year lookup finds nothing is REMOVED from the deck
 *     (`gameReducer`, `YEAR_RESOLVED`, 2026-08-05), and which cards those are
 *     depends on what MusicBrainz answers at play time.
 *  2. An editorial playlist has its tracks refreshed by Spotify periodically, so
 *     even the fetched list can differ between two opens of the same link.
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

import { parsePlaylistUrl } from '../../shared/spotify-url';

/** The query parameter carrying the playlist. Its value is anything `parsePlaylistUrl` accepts. */
export const PLAYLIST_PARAM = 'playlist';

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

/** A link that named a playlist and a seed this app could have produced. */
export interface DeckLink {
  /** A bare 22-character Spotify playlist id, already through `parsePlaylistUrl`. */
  playlistId: string;
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

  const playlistParam = params.get(PLAYLIST_PARAM);
  const seedParam = params.get(SEED_PARAM);
  if (playlistParam === null || seedParam === null) return null;

  // Validated through the SHARED parser, not a new regex (step 6). A bare id is already one of the
  // forms it accepts, so this is reuse rather than a special case -- and it means a link carrying a
  // full `open.spotify.com/playlist/...` URL, or an album link, is judged by exactly the same code
  // the landing form and `api/playlist.ts` use.
  const parsed = parsePlaylistUrl(playlistParam.trim());
  if (!parsed.ok) return null;

  const seed = seedParam.trim();
  if (!SEED_PATTERN.test(seed)) return null;

  return { playlistId: parsed.id, seed: seed.toLowerCase() };
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
 * The id and the seed are NOT validated here. Both come from live `GameState` -- the id from a
 * playlist the server resolved, the seed from `generateSeed()` or from a link this same module
 * already validated -- and a builder that could fail would push an error branch into a click
 * handler. Interpolation is safe: a Spotify id is 22 base62 characters and a seed is hex, so
 * neither can escape a query value.
 */
export function buildDeckLink(origin: string, playlistId: string, seed: string): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;

  return `${base}?${PLAYLIST_PARAM}=${playlistId}&${SEED_PARAM}=${seed}`;
}
