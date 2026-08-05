/**
 * Types shared by the browser app (`src/`) and the serverless functions (`api/`).
 *
 * `api/` must import this module by RELATIVE path, never through the `@/` alias --
 * Vercel does not support tsconfig path mappings when compiling functions. A RUNTIME
 * import of this module from `api/` also needs an explicit `.js` extension (see
 * `shared/constants.ts`); `import type` erases entirely and is exempt, which is how
 * most consumers of this file import it.
 *
 * This file is checked by BOTH `tsconfig.app.json` and `tsconfig.api.json`, which is
 * the point: no DOM types and no Node types may appear here, so neither side can be
 * accidentally coupled to the other's platform.
 */

/**
 * Confidence in a resolved release year.
 *
 * Declared here rather than in `shared/year.ts` because `Card` references it, and
 * `Card` is this file's job. The rest of the year vocabulary lives here too, for the
 * same reason it always has: both sides read it.
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

// ===========================================================================
//  YEAR RESOLUTION
//
//  The vocabulary of plan.phase-2-year.md. The logic that produces these values
//  is in `shared/year.ts` (pure) and `api/_lib/musicbrainz.ts` (all the I/O).
// ===========================================================================

/**
 * Where a resolved year actually came from. Kept distinct from `YearConfidence`
 * because they answer different questions -- confidence says how much to trust it,
 * source says which signal produced it, and Phase 6's review screen wants both.
 *
 * - `release-group`: the release group's own `first-release-date`, i.e. the album's
 *   ORIGINAL release date. This is the strict pass, and the only signal that is right
 *   about reissues -- see the 2026-08-04 finding for why the release date inlined in
 *   the search response is not.
 * - `recording`: the recording's `first-release-date`, taken across every artist-matching
 *   recording without the studio-album filter. The relaxed pass; measurably off by a
 *   year or so on several tracks, which is exactly why it reports `low`.
 */
export type YearSource = 'release-group' | 'recording';

/**
 * Why no year could be resolved. Machine-readable because the two real cases point at
 * completely different fixes: `no-candidates` means the QUERY was wrong (a title the
 * cleaner did not handle, a misspelled artist), while `no-dated-candidates` means the
 * query was right and MusicBrainz's data is incomplete. Collapsing them into one string
 * would throw away the only diagnostic available to Phase 6's review screen.
 */
export type YearFailureReason =
  /** The search returned nothing, or nothing whose artist credit plausibly matched. */
  | 'no-candidates'
  /** Candidates existed, but not one carried a usable, plausible date. */
  | 'no-dated-candidates';

/**
 * The outcome of a year lookup, as a discriminated union on `year`.
 *
 * A union rather than `{year: number | null, confidence, reason?}` so the impossible
 * states cannot be written down: a resolved year can never carry `confidence: 'none'`,
 * and a null year always carries a reason.
 */
export type YearResult =
  | {
      year: number;
      confidence: 'high' | 'low';
      source: YearSource;
      /**
       * Set only when the year was found by a FALLBACK query against a rewritten title --
       * today that means a remix suffix was dropped and the underlying song was asked about
       * instead (`stripRemixSuffix()` in `shared/year.ts`).
       *
       * Present for exactly the reason `cleanedTitle` is (decision 18): when a year looks
       * wrong the first question is what was actually searched for, and "we asked about a
       * different title than the card shows" is the most important possible answer to that
       * question. Such a result always reports `confidence: 'low'`, so Phase 6 already flags
       * it as unconfirmed; this says WHY.
       */
      viaTitle?: string;
    }
  | { year: null; confidence: 'none'; reason: YearFailureReason };

/**
 * Which families of suffix `cleanTrackTitle()` removed.
 *
 * Purely DIAGNOSTIC -- surfaced in the `/api/year` response and useful in Phase 6's
 * review screen. They deliberately do NOT feed back into candidate selection: Hitster
 * asks when the SONG came out, so a playlist holding the live take of a 1975 song still
 * wants 1975, not the year that particular performance was released (decision 14).
 */
export interface TitleStripFlags {
  /** "- Remastered 2011", "- Remaster", "- 2009 Digital Remaster". */
  remaster: boolean;
  /** "- Live", "- Live at Wembley", "(Live)". */
  live: boolean;
  /** "(feat. X)", "(with X)". */
  feature: boolean;
  /** Everything else: "- Single Version", "- Radio Edit", "- Mono", "- Extended Mix", "[Explicit]". */
  version: boolean;
}

/** What `cleanTrackTitle()` returns: the query-safe title plus what it had to remove to get there. */
export interface CleanedTitle {
  /** The cleaned, query-safe title. Never empty for a non-empty input. */
  title: string;
  stripped: TitleStripFlags;
}

/**
 * One (recording x release) pair, flattened and normalized away from MusicBrainz's JSON.
 *
 * The scorer in `shared/year.ts` sees ONLY this shape, never a raw response. That is what
 * makes every accuracy claim in plan.phase-2-year.md a unit test over fixtures instead of
 * a live, rate-limited, non-deterministic network call (decision 16) -- and it confines a
 * MusicBrainz shape change to `api/_lib/musicbrainz.ts`.
 *
 * A recording that appears on five releases produces five candidates. That is deliberate:
 * the filters are per-release (`status`) and per-release-group (the types), so flattening
 * is what lets a single predicate express them.
 */
export interface RecordingCandidate {
  recordingId: string;
  /** The recording's own title, as MusicBrainz has it. Not compared against -- kept for debugging. */
  title: string;
  /** The full artist credit, joined exactly as MusicBrainz joins it ("Bob Marley & The Wailers"). */
  artistCredit: string;
  /** Recording length. Absent on a surprising number of search results, so the tie-break must tolerate it. */
  lengthMs?: number;
  /**
   * The recording's `first-release-date` (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`). The relaxed
   * pass's only signal.
   */
  recordingFirstReleaseDate?: string;
  releaseGroupId?: string;
  /** e.g. "Album", "Single", "EP", "Broadcast", "Other". */
  releaseGroupPrimaryType?: string;
  /** e.g. ["Compilation"], ["Live"], ["Compilation", "DJ-mix"]. Empty for a plain studio album. */
  releaseGroupSecondaryTypes: string[];
  /**
   * The release group's `first-release-date` -- the ALBUM's original release date, and the
   * strict pass's signal.
   *
   * Optional because the recording search does not return it: `api/_lib/musicbrainz.ts`
   * fills it in with a second, batched request. A candidate that still lacks it after that
   * is simply not eligible for the strict pass.
   */
  releaseGroupFirstReleaseDate?: string;
  /** e.g. "Official", "Promotion", "Bootleg", "Pseudo-Release". */
  releaseStatus?: string;
  /**
   * The individual release's date. NOT used by the strict pass -- it is the reissue date far
   * more often than the original (2026-08-04 finding) -- and kept only so a future session can
   * see that it was considered and rejected rather than overlooked.
   */
  releaseDate?: string;
}

/** The successful `GET /api/year` response body. */
export interface YearLookupResult {
  year: number | null;
  confidence: YearConfidence;
  /** Absent when `year` is null. */
  source?: YearSource;
  /** Absent when a year was resolved. */
  reason?: YearFailureReason;
  /** True when this came from the year cache and cost no MusicBrainz request. */
  cached: boolean;
  /**
   * The title actually queried, after cleaning. Returned deliberately: when a year looks
   * wrong the first question is always what was searched for (decision 18).
   *
   * This is the PRIMARY query's title, and it is also what the cache key is derived from, so
   * it reads the same on a cache hit as on a miss. When a remix fallback found the year, the
   * rewritten title it used is reported separately in `viaTitle`.
   */
  cleanedTitle: string;
  stripped: TitleStripFlags;
  /** See `YearResult.viaTitle`. Absent unless a fallback query found the year. */
  viaTitle?: string;
}

/**
 * Every way a year request can fail. The HTTP status each maps to is documented here,
 * beside the code, exactly as `PlaylistErrorCode` does:
 *
 * - `invalid-request`      -> 400. Missing, empty, or absurdly long `title`/`artist`.
 * - `rate-limited`         -> 429. The 1 req/s gate is busy. Carries `retryAfterMs`; Phase 3
 *                             backs off and retries that card later. NOT an error condition --
 *                             it is the designed back-pressure signal (decision 12).
 * - `not-configured`       -> 500. `MUSICBRAINZ_USER_AGENT` is unset. Deliberately loud and
 *                             deliberately a 500: it is a deployment fault, not a bad request,
 *                             and MusicBrainz's own rejection of an anonymous call is far
 *                             harder to diagnose (decision 17).
 * - `upstream-unavailable` -> 502. MusicBrainz failed, timed out, or answered non-200 after
 *                             the single 503 retry. Transient.
 * - `unexpected-payload`   -> 502. It answered 200 with something we could not parse. NOT
 *                             transient -- the adapter needs updating. Same split, same
 *                             reasoning, as the playlist codes above.
 */
export type YearErrorCode =
  | 'invalid-request'
  | 'rate-limited'
  | 'not-configured'
  | 'upstream-unavailable'
  | 'unexpected-payload';

/** The `GET /api/year` error response body. Never carries upstream text or the Upstash token. */
export interface YearErrorResult {
  code: YearErrorCode;
  message: string;
  /** Set only on `rate-limited`: how long Phase 3's loop should wait before retrying this card. */
  retryAfterMs?: number;
}
