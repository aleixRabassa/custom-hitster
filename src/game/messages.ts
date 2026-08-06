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
 * `Record<StartFailureCode, string>` is the type on purpose rather than a lookup with a fallback: a
 * new code added to the union then FAILS THE TYPECHECK here, instead of rendering an empty string in
 * the one place a player is already having a bad time.
 */

import type { PlaylistClientErrorCode } from './playlist-client';

/**
 * Every reason a player can end up on the landing screen unable to play, as one union.
 *
 * ===========================================================================
 *  WIDER THAN `PlaylistClientErrorCode`, AND THE EXTRA CODE IS NOT A FETCH FAILURE.
 *
 *  `no-years-found` is produced by the SESSION, not by the HTTP client: the
 *  playlist fetched perfectly, and then every card in it turned out to have no
 *  resolvable release year, so the deck emptied and there is no game to play.
 *  `fetchPlaylist` cannot return it and never will.
 *
 *  It is deliberately NOT added to `PlaylistClientErrorCode`. That union is the
 *  set of things the client returns, its tests enumerate exactly that, and
 *  widening it would make the client's own type claim a code it cannot produce.
 *  Widening the COPY map instead is the honest direction: this file owns every
 *  sentence the player reads, and "why you cannot play this playlist" is one
 *  question with one answer slot on the landing screen -- not two.
 * ===========================================================================
 */
export type StartFailureCode = PlaylistClientErrorCode | 'no-years-found';

export const PLAYLIST_ERROR_MESSAGES: Record<StartFailureCode, string> = {
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

  /**
   * A playlist that parsed, loaded, and turned out to have nothing to play.
   *
   * Two situations reach this and the copy has to fit both: a genuinely empty playlist, and one
   * whose every track was unplayable and therefore skipped (`skippedCount` reaching the raw track
   * count). Hence "no tracks this app can play" rather than "is empty" -- the second case's
   * playlist is not empty, and telling that player it is would send them to check a link that is
   * fine. Until Phase 7 both of these got `unexpected-payload`, i.e. "this is a problem on our
   * side", which was a confidently wrong diagnosis of a readable answer.
   */
  'empty-playlist':
    'That playlist has no tracks this app can play — it may be empty, or every track in it may be unavailable. Try another playlist.',

  /**
   * The deck was dealt, every year lookup came back empty, and the deck emptied.
   *
   * A card whose lookup finds nothing is REMOVED (`gameReducer`, `YEAR_RESOLVED`), because a Hitster
   * card is placed on a timeline by its year and there is nothing to play without one. When that
   * happens to every card there is no game, so the player is returned here rather than shown an end
   * screen reading "Deck finished — 0 cards", which is what they got before and which reads as a
   * completed game they never played.
   *
   * The copy says the years could not be found rather than that the playlist is bad, because the
   * playlist is usually fine — MusicBrainz simply does not know these recordings, and a very obscure
   * or very new playlist is the ordinary way to get here. It names the mainstream-music workaround,
   * since that is genuinely what fixes it.
   */
  'no-years-found':
    'No release years could be found for any track in that playlist, so there was nothing to play. This usually means the songs are too obscure or too new for the music database. Try a playlist with more widely released tracks.',

  /**
   * The browser knows there is no connection, so nothing was sent.
   *
   * DELIBERATELY NOT THE SAME SENTENCE AS `network`, and the difference is not cosmetic: here the
   * app is certain, so it says so and asks for one thing. `network` is a guess about why a real
   * request failed, so it hedges. `messages.test.ts` asserts the two are not identical, because
   * copy-pasting one into the other is the failure mode of adding a code.
   */
  offline: 'You appear to be offline. Reconnect and press Start again.',

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
export function playlistErrorMessage(code: StartFailureCode): string {
  return PLAYLIST_ERROR_MESSAGES[code] ?? PLAYLIST_ERROR_MESSAGES['unknown-error'];
}
