/**
 * Every playlist failure, as one sentence a player can act on.
 *
 * ===========================================================================
 *  THE CLIENT OWNS THIS COPY. THE SERVER'S `message` FIELD IS NEVER RENDERED.
 *
 *  `api/playlist.ts` does send a `message` per error, and it is deliberately
 *  ignored here. Two reasons, and the second is the one that settles it:
 *
 *  1. ONE WORDING SOURCE. Two places writing the same sentence is two places
 *     to change it, and the one nobody remembers is the one the player sees.
 *  2. A CLIENT-SIDE PARSE FAILURE HAS NO SERVER MESSAGE AT ALL. When the
 *     landing screen rejects a URL through `parsePlaylistUrl()` there was no
 *     request, so there is no body to read a message out of. Rendering
 *     server text where it exists and client text where it does not would
 *     give the same failure two different voices depending on whether a round
 *     trip happened.
 *
 *  The server's `message` still earns its keep as a `curl`-readable
 *  explanation; it is just not what the UI shows.
 * ===========================================================================
 *
 * `Record<PlaylistClientErrorCode, string>` is the type on purpose rather than a lookup with a
 * fallback: a new code added to the union then FAILS THE TYPECHECK here, instead of rendering an
 * empty string in the one place a player is already having a bad time.
 */

import type { PlaylistClientErrorCode } from './playlist-client';

export const PLAYLIST_ERROR_MESSAGES: Record<PlaylistClientErrorCode, string> = {
  'invalid-url':
    'That does not look like a Spotify playlist link. Paste the link from Spotify’s Share menu.',

  'unsupported-entity':
    'That is a Spotify link, but not to a playlist — an album, track, or artist link will not work. Open a playlist and share that instead.',

  /**
   * Private and deleted collapse into one code because Spotify gives no observable signal that
   * separates them (`shared/types.ts`), so the copy has to cover both honestly rather than
   * guessing at one. Naming all three possibilities is what stops the player retrying a link
   * that will never work while also not accusing them of pasting a dead one.
   */
  'not-found-or-private':
    'No public playlist was found for that link. It may be private, deleted, or the link may be wrong — only public playlists can be played.',

  'upstream-unavailable': 'Spotify could not be reached right now. Please try again in a moment.',

  /**
   * The "this is our bug" case, and it is the one a `pnpm dev` run produces on the very first
   * Start -- Vite serves the function's transpiled source with status 200 (see
   * `playlist-client.ts`). Saying "try again later" would be a lie: nothing about waiting fixes
   * either cause.
   */
  'unexpected-payload':
    'Spotify returned something we could not read. This is a problem on our side, not with your link.',

  network: 'Could not reach the server. Check your connection and try again.',

  /** Deliberately promises nothing: this code exists precisely for failures we cannot name. */
  'unknown-error': 'Something went wrong loading that playlist. Please try again.',
};

/**
 * The message for a code.
 *
 * A function rather than direct indexing so a code arriving from outside the type system -- a
 * response body, a persisted value -- cannot render `undefined` into the DOM. The map above is
 * exhaustive by type, so this fallback is unreachable through any typed path, and that is the
 * intent: it is a runtime backstop, not a substitute for exhaustiveness.
 */
export function playlistErrorMessage(code: PlaylistClientErrorCode): string {
  return PLAYLIST_ERROR_MESSAGES[code] ?? PLAYLIST_ERROR_MESSAGES['unknown-error'];
}
