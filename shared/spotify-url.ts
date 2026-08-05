/**
 * Parsing of the many shapes a "Spotify playlist link" arrives in.
 *
 * Lives in `shared/` -- and therefore uses no DOM and no Node APIs, not even the
 * global `URL` -- because both sides need it: the serverless functions parse what the
 * client sent, and Phase 6's landing form validates the input box as the user types.
 * One implementation, one set of accepted forms, no duplicated regexes.
 *
 * This module performs NO network call. It can tell you that a string is a
 * well-formed playlist reference; it cannot tell you whether that playlist exists,
 * is public, or has any tracks. That is `api/_lib/spotify-embed.ts`'s job, and the
 * distinction is why a valid parse can still be followed by a 404.
 */

import type { PlaylistErrorCode } from './types';

/**
 * The subset of `PlaylistErrorCode` this function can produce. Derived from the full
 * union rather than declared separately so the two can never drift apart.
 */
export type PlaylistUrlErrorCode = Extract<PlaylistErrorCode, 'invalid-url' | 'unsupported-entity'>;

/**
 * A discriminated union rather than `string | null` or a thrown error, on purpose:
 * Phase 6 renders a DIFFERENT inline message for "that isn't a Spotify link" and
 * "that's an album, not a playlist", and it does so without duplicating a single
 * character of parsing. That requirement is the whole reason this is not a one-liner.
 */
export type ParsePlaylistUrlResult =
  { ok: true; id: string } | { ok: false; code: PlaylistUrlErrorCode };

/**
 * Spotify IDs are 22 base62 characters. **22 is arithmetic, not a convention** (spike of
 * 2026-08-04, docs/agent_findings.md): an ID is the base62 encoding of a 128-bit GID,
 * left-padded with `0`, and `ceil(128 / log2 62)` is exactly 22. No valid ID of any
 * other length can exist, so DO NOT relax this length if a real link is ever rejected --
 * the cause will be the legacy `/user/{u}/playlist/{id}` path or a `spotify.link` short
 * URL, both of which carry a perfectly good 22-character ID.
 *
 * This is deliberately a little too LOOSE rather than too strict: only ~12.6% of the
 * 22-char base62 space decodes to a value below 2^128 (the leading character must be
 * `0`-`7`). The rest are well-formed here, get forwarded to Spotify, and come back as
 * `not-found-or-private` -- one wasted round trip on a typo, which is the cheap direction
 * to be wrong in. Rejecting them here would need a BigInt decode for a better error.
 */
const SPOTIFY_ID_PATTERN = /^[0-9A-Za-z]{22}$/;

/**
 * Host matching is ANCHORED, never a `includes('open.spotify.com')`. A look-alike
 * domain must not pass, and several plausible-looking ones would sail through a
 * substring test: `open.spotify.com.evil.example`, `notopen.spotify.com`,
 * `evil.example/open.spotify.com/playlist/...`, and the userinfo trick
 * `open.spotify.com@evil.example`. All four fail this pattern because a literal `/`
 * (or end of input) must follow the host.
 *
 * The scheme is optional and `http` is accepted because people paste what they have.
 * The `i` flag is safe for the ID too: base62 already spans both cases.
 */
const SPOTIFY_WEB_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?open\.spotify\.com(\/\S*)?$/i;

/** The desktop client's "Copy Spotify URI" form: `spotify:playlist:{id}`. */
const SPOTIFY_URI_PATTERN = /^spotify:([A-Za-z]+):(\S+)$/;

/**
 * The short-link hosts, anchored exactly as `SPOTIFY_WEB_URL_PATTERN` is and for the same
 * reason -- a look-alike domain must not pass, and `spotify.link@evil.example` is the trick
 * a substring test waves through.
 *
 * A path segment is REQUIRED. `https://spotify.link` on its own carries no code, so there is
 * nothing for the server to resolve and it is better reported as `invalid-url` immediately
 * than sent on a round trip that can only fail.
 *
 * `link.tospotify.com` is Spotify's older branch-style short domain. Measured 2026-08-05: it
 * **no longer resolves at all** (ENOTFOUND), so `spotify.link` is the only host the share
 * sheet emits today. It is matched anyway, deliberately: a legacy link is genuinely a Spotify
 * playlist link, so `upstream-unavailable` ("Spotify could not be reached") is a more honest
 * answer than "that does not look like a Spotify link", and the cost is one alternation here
 * plus one entry in the resolver's allow-list.
 */
const SPOTIFY_SHORT_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?(?:spotify\.link|link\.tospotify\.com)\/[^/?#\s]+(?:[/?#]\S*)?$/i;

/**
 * The legacy path's first segment: `open.spotify.com/user/{user}/playlist/{id}`.
 *
 * Spotify emitted this form for years and still serves it, and links of that vintage are
 * sitting in chat logs and bookmarks. Before 2026-08-05 it was rejected as
 * `unsupported-entity` -- the parser saw `user` in the entity position and stopped -- which
 * the 2026-08-04 findings called the clearest real bug that spike found. The `{user}` segment
 * carries no meaning for us: the playlist ID that follows is the whole address.
 */
const LEGACY_USER_SEGMENT = 'user';

/**
 * Locale-prefixed paths -- `open.spotify.com/intl-es/playlist/{id}`. Spotify really
 * serves these, and a link copied from a localised client carries the prefix, so a
 * parser that only knows the unprefixed form fails for anyone not using English. Easy
 * to miss precisely because it works fine in the developer's own locale.
 */
const LOCALE_SEGMENT_PATTERN = /^intl-[a-z]{2}(?:-[a-z]{2})?$/i;

const PLAYLIST_ENTITY = 'playlist';

/**
 * Spotify entity types that are recognisably Spotify but are not a playlist. Matching
 * these is what separates `unsupported-entity` from `invalid-url`: pasting an album
 * link is a likely mistake with an obvious fix, and it deserves to be told apart from
 * pasting a random string.
 */
const KNOWN_NON_PLAYLIST_ENTITIES = new Set([
  'album',
  'track',
  'artist',
  'show',
  'episode',
  'user',
  'collection',
]);

/**
 * Build the public web URL for a track from a bare `Card.id`.
 *
 * This is what the QR code on the card's hidden side encodes, and it is the ONLY link
 * that gets a player to the whole song: `Card.previewUrl` is a 30-second MP3 and the app
 * has no Spotify playback session (plan.md §2). Phase 8's shareable-deck work needs the
 * same builder.
 *
 * It lives here rather than in `src/` for the reason the rest of this module does: it is
 * pure, DOM-free, and the counterpart to `parsePlaylistUrl()` — one file owns the shape of
 * a Spotify link in both directions. Note that `parsePlaylistUrl()` rejects this output as
 * `unsupported-entity`, which is correct and asserted in the tests: a track link is a valid
 * Spotify link and emphatically not a playlist.
 *
 * The ID is NOT validated. A `Card.id` came from the embed payload's own
 * `spotify:track:{id}` URI, so there is nothing here to guard against, and a builder that
 * could fail would push a pointless error branch into every caller — including the QR
 * component's render path. Interpolation is safe because a Spotify ID is 22 base62
 * characters: nothing in that alphabet can escape the path segment.
 */
export function spotifyTrackUrl(id: string): string {
  return `https://open.spotify.com/track/${id}`;
}

/**
 * Is this a Spotify short link -- the shape the mobile share sheet produces?
 *
 * A separate predicate rather than a third `ParsePlaylistUrlResult` variant (decision 4). The
 * return type of `parsePlaylistUrl()` is consumed by `api/playlist.ts`'s exhaustive code-to-status
 * mapping and by every existing test; a new variant would ripple through both to express
 * something a caller can simply ask about.
 *
 * The two callers want opposite things from the answer, which is the point:
 *
 * - **The landing screen** treats a short link as SUBMITTABLE. It contains no playlist ID --
 *   only a redirect does -- so client-side validation cannot possibly parse it, and showing
 *   "that does not look like a Spotify link" for the commonest way a phone user obtains a link
 *   would be the app's most visible bug.
 * - **`api/playlist.ts`** resolves it first (`api/_lib/short-link.ts`) and feeds the resolved
 *   URL back through `parsePlaylistUrl()` unchanged.
 *
 * Never throws, and takes `unknown`-safe input for the same reason `parsePlaylistUrl()` does:
 * it is called on a text input's value.
 */
export function isSpotifyShortLink(input: string): boolean {
  if (typeof input !== 'string') return false;

  return SPOTIFY_SHORT_URL_PATTERN.test(input.trim());
}

/**
 * Turn any of the accepted forms into a bare playlist ID.
 *
 * Accepted:
 * - `https://open.spotify.com/playlist/{id}`, with any query parameters (`?si=`,
 *   `?utm_source=`, ...), a trailing slash, a `#fragment`, `http`, `www.`, and
 *   surrounding whitespace
 * - `open.spotify.com/intl-es/playlist/{id}` and other locale prefixes
 * - `open.spotify.com/user/{user}/playlist/{id}` -- the legacy path, and the two prefixes
 *   combined (`/intl-es/user/{user}/playlist/{id}`)
 * - `spotify:playlist:{id}`
 * - a bare 22-character ID (what Phase 6's suggested-playlist buttons pass)
 *
 * NOT accepted, and it cannot be: a `spotify.link` short URL. It carries no playlist ID at all,
 * so only a redirect can resolve it. `isSpotifyShortLink()` is how a caller recognises one, and
 * `api/_lib/short-link.ts` is what turns it into a URL this function can then parse.
 *
 * Never throws, for any input: Phase 6 calls this on every keystroke.
 */
export function parsePlaylistUrl(input: string): ParsePlaylistUrlResult {
  // Runtime guard, not redundant with the type: this is reached from a query
  // parameter and from a text input, neither of which TypeScript can vouch for.
  if (typeof input !== 'string') return { ok: false, code: 'invalid-url' };

  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, code: 'invalid-url' };

  // A bare ID, e.g. from the suggested-playlist buttons.
  if (SPOTIFY_ID_PATTERN.test(trimmed)) return { ok: true, id: trimmed };

  const uriMatch = SPOTIFY_URI_PATTERN.exec(trimmed);
  if (uriMatch) return fromEntity(uriMatch[1], uriMatch[2]);

  const urlMatch = SPOTIFY_WEB_URL_PATTERN.exec(trimmed);
  if (!urlMatch) return { ok: false, code: 'invalid-url' };

  // Query string and fragment are noise here -- `?si=` is appended by Spotify's own
  // share button, so the commonest pasted form carries one.
  const path = (urlMatch[1] ?? '').split('#')[0] ?? '';
  const segments = (path.split('?')[0] ?? '').split('/').filter((segment) => segment !== '');

  // Drop a leading locale prefix if present, leaving the same [entity, id] shape.
  if (segments.length > 0 && LOCALE_SEGMENT_PATTERN.test(segments[0] ?? '')) segments.shift();

  // Then drop a legacy `user/{user}` prefix, leaving that same [entity, id] shape again. Done
  // AFTER the locale strip, not before, because the two combine: a localised client copying an
  // old link produces `/intl-es/user/{user}/playlist/{id}`.
  //
  // The length guard is what keeps `open.spotify.com/user/{user}` -- a profile link, and a real
  // thing to paste by mistake -- reporting `unsupported-entity` instead of being stripped down
  // to nothing. Three segments is the minimum that can carry an entity after the prefix.
  if (segments.length >= 3 && (segments[0] ?? '').toLowerCase() === LEGACY_USER_SEGMENT) {
    segments.splice(0, 2);
  }

  return fromEntity(segments[0], segments[1]);
}

/**
 * Shared tail of both the URI and the URL paths.
 *
 * The entity is checked BEFORE the ID: for `open.spotify.com/album/{id}` the useful
 * complaint is "that's an album", regardless of whether the ID that follows is
 * well-formed.
 */
function fromEntity(entity: string | undefined, id: string | undefined): ParsePlaylistUrlResult {
  const normalizedEntity = (entity ?? '').toLowerCase();

  if (normalizedEntity !== PLAYLIST_ENTITY) {
    return {
      ok: false,
      code: KNOWN_NON_PLAYLIST_ENTITIES.has(normalizedEntity)
        ? 'unsupported-entity'
        : 'invalid-url',
    };
  }

  const candidateId = id ?? '';
  if (!SPOTIFY_ID_PATTERN.test(candidateId)) return { ok: false, code: 'invalid-url' };

  return { ok: true, id: candidateId };
}
