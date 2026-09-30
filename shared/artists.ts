/**
 * Artist-string handling.
 *
 * Phase 0 found that a track's `subtitle` in the Spotify embed payload is the artist
 * name(s) as ONE joined string -- not a structured array -- and flagged it as needing
 * splitting. Splitting it is a trap, and this module is where the trap is contained.
 *
 * ============================================================================
 *  THE SEPARATORS SPOTIFY JOINS WITH ALSO OCCUR INSIDE REAL ARTIST NAMES.
 *
 *    "Earth, Wind & Fire"      -- one artist, one comma, one ampersand
 *    "Tyler, The Creator"      -- one artist, one comma
 *    "Simon & Garfunkel"       -- one artist, one ampersand
 *    "Florence + The Machine"  -- one artist, one plus
 *
 *  So the card's display `artist` is the raw subtitle VERBATIM. Never split it for
 *  display: rendering "Earth, Wind & Fire" as three artists would corrupt the reveal
 *  side of the card, which is the payoff of the entire game.
 * ============================================================================
 *
 * `primaryArtistGuess()` below exists for exactly one caller -- building a MusicBrainz
 * query in `api/_lib/musicbrainz.ts` -- and is deliberately lossy. How much that lossiness
 * costs depends on WHERE in the adapter's query ladder the guess sits, and since 2026-10-01
 * it sits second rather than last; see the note on the function itself.
 */

/**
 * Only `,` splits. `&` and `+` deliberately do NOT.
 *
 * This is a considered narrowing of the plan step, which also asked for a trailing
 * `&`-joined tail to be trimmed. "Justin Bieber & Ariana Grande" (two artists) and
 * "Simon & Garfunkel" (one artist) are the same string shape, so no rule can tell
 * them apart -- and trimming would mangle the real name, which the plan's own test
 * list holds up as a name that must survive intact. Leaving `&` alone keeps two of
 * the four hazard names above exactly correct and confines the lossiness to the
 * comma cases, which are then documented rather than silently wrong.
 */
const ARTIST_SEPARATOR = ',';

/**
 * A featured-artist tail: " feat. X", " ft X", " featuring X", " (with X)", "(feat. X)".
 *
 * Requires a whitespace/paren/bracket boundary before the keyword and real content
 * after it, so an artist whose name merely ends in "ft" is untouched. Featured
 * artists in the subtitle actively harm a MusicBrainz artist match, so removing them
 * from the query is worth the small risk of clipping a band genuinely named
 * "<something> with <something>".
 */
const FEATURED_TAIL_PATTERN = /[\s([]+(?:feat\.?|ft\.?|featuring|with)\s+\S.*$/i;

/**
 * A best-effort single artist name, for use as a MusicBrainz query term.
 *
 * KNOWN-WRONG for artists whose own name contains a comma: this returns "Earth" for
 * "Earth, Wind & Fire" and "Tyler" for "Tyler, The Creator". That is not a bug to be
 * fixed here -- it cannot be fixed without a lookup.
 *
 * ============================================================================
 *  THE GUESS IS QUERIED SECOND, AND THAT HAS A MEASURED, ACCEPTED COST.
 *
 *  Since 2026-10-01 `api/_lib/musicbrainz.ts` asks: (1) the FULL string with a
 *  `dur:` bound, when a duration is known; (2) this guess, unbounded, when it
 *  differs from the full string; (3) the full string unbounded. So the full
 *  string still goes first whenever there is a duration, but the guess is now
 *  reached before the full string has been asked WITHOUT a bound -- and on a
 *  track with no duration, before it has been asked at all.
 *
 *  WHY: of the cards that reach each query, the guess finds 68% and the
 *  unbounded full string 5%, because Spotify's ", " join rarely matches
 *  MusicBrainz's joinphrase. Over 782 cards that saved 15.7% of MusicBrainz
 *  requests and corrected four years (docs/agent_findings.md 2026-10-01).
 *
 *  THE COST: a probe of 13 comma-in-name artists with no duration found ONE
 *  wrong year -- "Teach Your Children" (Crosby, Stills, Nash & Young) 1970 ->
 *  1969, because the "Crosby" pool holds a Crosby, Stills & Nash recording
 *  that the exact artist matcher admits. It is reached only when the bounded
 *  query misses. The "Earth, Wind & Fire" shape this note used to guard
 *  against -- a guess pool that is non-empty but scores no year, pre-empting a
 *  full-string query that would have answered -- happened 0 times in 782.
 *
 *  Moving the guess EARLIER still (ahead of the bounded full-string query) is
 *  UNMEASURED and would put the truncation in front of every comma-in-name
 *  artist that has a duration -- measure it before making it.
 * ============================================================================
 *
 * Never throws, and never returns an empty string for a non-empty input.
 */
export function primaryArtistGuess(subtitle: string): string {
  if (typeof subtitle !== 'string') return '';

  const trimmed = subtitle.trim();
  if (trimmed === '') return '';

  const separatorIndex = trimmed.indexOf(ARTIST_SEPARATOR);
  const firstArtist = (separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex)).trim();
  if (firstArtist === '') return trimmed;

  const withoutFeature = firstArtist.replace(FEATURED_TAIL_PATTERN, '').trim();

  // Stripping must never consume the whole name -- a subtitle that is nothing but a
  // feature tail would otherwise yield an empty query term.
  return withoutFeature === '' ? firstArtist : withoutFeature;
}
