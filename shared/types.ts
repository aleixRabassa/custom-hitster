/**
 * Types shared by the browser app (`src/`) and the serverless functions (`api/`).
 *
 * `api/` must import this module by RELATIVE path, never through the `@/` alias --
 * Vercel does not support tsconfig path mappings when compiling functions.
 *
 * This file is checked by BOTH `tsconfig.app.json` and `tsconfig.api.json`, which is
 * the point: no DOM types and no Node types may appear here, so neither side can be
 * accidentally coupled to the other's platform.
 */

/**
 * Confidence in a resolved release year.
 *
 * Declared here rather than in `shared/year.ts` because `Card` references it, and
 * `Card` is this file's job. Year resolution itself -- and the `YearResult` /
 * `RecordingCandidate` shapes that go with it -- belongs to plan.phase-2-year.md,
 * which adds them alongside this union rather than redefining it.
 *
 * - `high`: the strict MusicBrainz pass (official studio album, filtered) matched.
 * - `low`:  only the relaxed pass matched. Phase 6's review screen flags these.
 * - `none`: no year could be resolved; the user fills it in manually.
 */
export type YearConfidence = 'high' | 'low' | 'none';

/**
 * The minimal input a year lookup needs.
 *
 * Kept as its own type rather than folded into `Card` so that `/api/year`
 * (plan.phase-2-year.md) depends on a small stable shape instead of the whole card.
 * A `Card` is structurally a valid `TrackRef`, so callers can pass one directly.
 *
 * `artist` is the RAW joined artist string exactly as Spotify supplied it -- see
 * `shared/artists.ts` for why it is never split for display, and why the year
 * lookup queries this full string before it falls back to a single-artist guess.
 */
export interface TrackRef {
  title: string;
  artist: string;
  durationMs: number;
}

/**
 * One card in the deck: a single track, normalized away from Spotify's payload shape.
 *
 * TWO THINGS THIS TYPE DELIBERATELY DOES NOT DO:
 *
 * 1. `year` and `yearConfidence` are declared here but NEVER set by
 *    plan.phase-2-playlist.md -- the Spotify embed endpoint carries no release date
 *    at track level (Phase 0), so a year can only come from MusicBrainz. The fields
 *    exist now so Phase 3 and Phase 4 have a stable shape to build against.
 *
 * 2. It carries no game state. Phase 3 owns `GameState` (which card is current,
 *    which are flipped, the shuffle seed) and must NOT widen `Card` with any of it:
 *    a `Card` is playlist data and stays cacheable and comparable as such.
 */
export interface Card {
  /** Spotify track ID -- 22 base62 chars, derived from the payload's `spotify:track:{id}` URI. */
  id: string;
  title: string;
  /**
   * The artist name(s) as ONE joined string, verbatim from Spotify. Never split --
   * the separators Spotify joins with also occur inside real artist names. See
   * `shared/artists.ts`.
   */
  artist: string;
  durationMs: number;
  /**
   * 30-second MP3 preview, when Spotify supplies one. Phase 0 measured 99.5%
   * coverage, so absence is rare but real: Phase 4 disables Play/Pause and Restart
   * for such a card and leaves the QR and Exit fully functional.
   */
  previewUrl?: string;
  /**
   * Spotify's own playability flag. `false` does NOT remove the card from the deck:
   * the QR code is always rendered and always works, so an unplayable track is still
   * a playable card (plan.md §2, non-negotiable).
   */
  isPlayable: boolean;
  /**
   * Original release year, filled in by plan.phase-2-year.md. Three states, and the
   * difference between the last two matters to Phase 3's progressive loading:
   * `undefined` = not looked up yet, `null` = looked up and nothing found,
   * a number = resolved (check `yearConfidence` before trusting it).
   */
  year?: number | null;
  yearConfidence?: YearConfidence;
}

/** Playlist-level metadata, for showing the player what deck they are about to play. */
export interface PlaylistSummary {
  /** Spotify playlist ID, echoed back from the payload's own `entity.id`. */
  id: string;
  name: string;
  /**
   * The embed payload's playlist-level `subtitle`, which is the owner label
   * (e.g. "Spotify" for editorial playlists, a display name for personal ones).
   */
  owner: string;
}

/** The successful `GET /api/playlist` response body. */
export interface PlaylistResult {
  playlist: PlaylistSummary;
  cards: Card[];
  /**
   * True when the track list came back at exactly `MAX_EMBED_TRACKS`, which means the
   * deck MAY be incomplete. It cannot mean more than "may": Phase 0 established that
   * the payload carries no total, no offset and no `hasMore`, so a 100-track response
   * is indistinguishable from a playlist that genuinely holds 100 tracks. Phase 6
   * renders a non-blocking warning; pagination is deferred past v1.
   */
  truncated: boolean;
  /**
   * How many payload entries were dropped because they could not yield a usable card
   * at all (no track ID or no title). Reported rather than swallowed so a shrinking
   * deck is visible instead of mysterious. Whether Phase 6 surfaces it is that
   * phase's call.
   */
  skippedCount: number;
}

/**
 * Every way a playlist request can fail, as a closed union so the handler's status
 * mapping and Phase 6's inline error messages both stay exhaustive.
 *
 * The HTTP status each one maps to is documented right here, next to the code, so
 * the mapping cannot drift out of sight in `api/playlist.ts`:
 *
 * - `invalid-url`          -> 400. Not parseable as a Spotify playlist reference at all.
 * - `unsupported-entity`   -> 400. A valid Spotify link, but to an album/track/artist/
 *                            show/episode. Deliberately distinct from `invalid-url`
 *                            because it is a likely user mistake that deserves its own
 *                            message ("that's an album, not a playlist").
 * - `not-found-or-private` -> 404. Spotify has no such public playlist. Private and
 *                            deleted collapse into this one code on purpose: Spotify
 *                            gives no observable signal that distinguishes them, and
 *                            inventing a `private` code would be a lie in the type
 *                            system. Phase 7 words the message to cover both.
 * - `upstream-unavailable` -> 502. The embed request failed or returned non-200.
 *                            Transient; retrying may work.
 * - `unexpected-payload`   -> 502. The request succeeded but the payload was not the
 *                            shape we parse. NOT transient -- it means the scrape
 *                            broke and the adapter needs updating. Kept separate from
 *                            `upstream-unavailable` for exactly that reason.
 */
export type PlaylistErrorCode =
  | 'invalid-url'
  | 'unsupported-entity'
  | 'not-found-or-private'
  | 'upstream-unavailable'
  | 'unexpected-payload';

/** The `GET /api/playlist` error response body. Never carries upstream text -- see `api/playlist.ts`. */
export interface PlaylistErrorResult {
  code: PlaylistErrorCode;
  /** A short, safe, human-readable summary. Never raw upstream HTML or a parse error. */
  message: string;
}
