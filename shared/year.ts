/**
 * Year resolution -- all of it that is pure.
 *
 * Title cleaning, cache-key normalization, and candidate scoring live here; every HTTP
 * concern lives in `api/_lib/musicbrainz.ts`. That split is the whole reason the accuracy
 * claims below are unit tests over fixtures instead of live, rate-limited, non-deterministic
 * network calls (plan.phase-2-year.md decision 16).
 *
 * Lives in `shared/` -- so no DOM and no Node APIs -- because Phase 6's review screen shows
 * the cleaned title that was actually queried, and must derive it the same way the server did.
 *
 * A RUNTIME import of this module from `api/` needs an explicit `.js` extension
 * (`'../shared/year.js'`); see `shared/constants.ts` for why.
 */

import type {
  CleanedTitle,
  RecordingCandidate,
  TitleStripFlags,
  YearFailureReason,
  YearResult,
  YearSource,
} from './types';

// ===========================================================================
//  TITLE CLEANING
// ===========================================================================

/**
 * ===========================================================================
 *  TITLE CLEANING IS MANDATORY. IT IS NOT AN OPTIMIZATION.
 *
 *  Phase 0 measured, and 2026-08-04 re-verified live, that a remaster suffix in
 *  the form Spotify actually presents it returns **zero** MusicBrainz results:
 *
 *      recording:"Bohemian Rhapsody - Remastered 2011" AND artist:"Queen"  ->  count: 0
 *      recording:"Bohemian Rhapsody"                   AND artist:"Queen"  ->  count: 224
 *
 *  The literal suffix does not merely rank badly -- it breaks the query outright.
 *  Deleting this module would not degrade year accuracy, it would zero it for
 *  every remastered track, which on a classic-rock playlist is most of the deck.
 * ===========================================================================
 */

/**
 * A trailing ` - tail`, ` (tail)`, or ` [tail]`.
 *
 * Only TRAILING segments are considered, and the dash form requires whitespace on both
 * sides. Both restrictions are what stop the cleaner mangling ordinary titles: "Anti-Hero"
 * has no spaced dash, and "(Don't Fear) The Reaper" has no trailing parenthetical. A title
 * that genuinely contains the word "Live" -- "Live and Let Die", "Live Forever" -- is
 * untouched for the same reason: the word is not in a trailing segment.
 */
const TRAILING_SEGMENT_PATTERN = /^(.*?)\s+(?:-\s+(.+)|\((.+)\)|\[(.+)\])$/;

/**
 * Which family a trailing segment belongs to, or `undefined` to keep it.
 *
 * Deliberately an allow-list of known suffix families rather than "strip anything in
 * parentheses". Over-eager stripping is the failure mode that silently changes which song
 * is being searched for -- "Sgt. Pepper's Lonely Hearts Club Band - Reprise" is a different
 * track from the title one, and "Paranoid Android" must survive intact.
 */
type StripFamily = keyof TitleStripFlags;

const FAMILY_PATTERNS: { family: StripFamily; pattern: RegExp }[] = [
  // "Remastered 2011", "Remaster", "2013 Remaster", "2009 Digital Remaster",
  // "2011 Remastered Version", "Remastered Version".
  {
    family: 'remaster',
    pattern: /^(?:\d{4}\s+)?(?:digital\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?$/,
  },

  // "Live", "Live at Wembley", "Live in Paris, 1975", "Live from the Apollo",
  // "Live at The Lyceum, London/1975" -- the form Spotify actually uses.
  { family: 'live', pattern: /^live\b.*$/ },

  // "feat. Beyoncé", "ft Drake", "featuring Nas", "with Elton John".
  { family: 'feature', pattern: /^(?:feat\.?|ft\.?|featuring|with)\s+\S.*$/ },

  // Edition / edit / mix / version tails, and the soundtrack tail `From "Barbie"`.
  {
    family: 'version',
    pattern:
      /^(?:single|album|original|extended|radio|club|dance|acoustic|instrumental|orchestral|edited|deluxe|special|expanded)?\s*(?:version|edit|mix|cut)$/,
  },
  { family: 'version', pattern: /^\d{4}\s+(?:version|edit|mix)$/ },
  { family: 'version', pattern: /^(?:mono|stereo|explicit|clean|bonus\s+track|reissue)$/ },
  {
    family: 'version',
    pattern: /^.*\b(?:anniversary|deluxe|special|expanded|collector'?s)\s+(?:edition|version)$/,
  },
  { family: 'version', pattern: /^from\s+["“'].+$/ },
];

/**
 * Characters that would corrupt the Lucene query the adapter builds.
 *
 * The adapter wraps the title in double quotes (`recording:"…"`), so a title containing a
 * quote, a backslash, or a field-separator colon changes the query's STRUCTURE rather than
 * its terms. Replaced with a space rather than deleted, so "Song: Part II" stays two words.
 *
 * Apostrophes, question marks, ampersands and parentheses are deliberately NOT touched:
 * inside a quoted phrase they are ordinary characters, and stripping them would make
 * "Sweet Child O' Mine" and "Where Is My Mind?" worse queries, not better ones.
 */
const QUERY_BREAKING_CHARS = /["\\:[\]{}^~]+/g;

/** Every flag off. A fresh object each call -- callers own their result. */
function noFlags(): TitleStripFlags {
  return { remaster: false, live: false, feature: false, version: false };
}

/**
 * Strip Spotify's edition/version noise from a track title and report what was removed.
 *
 * Loops until nothing more matches, because a single title routinely carries two of them
 * ("Perfect (feat. Beyoncé) - Remastered 2011"), and a single pass would half-handle it.
 *
 * Never throws and never returns an empty title: if stripping would consume everything,
 * the original is kept. A title that is nothing BUT a suffix is a title we cannot improve,
 * and an empty query would return the whole database.
 */
export function cleanTrackTitle(rawTitle: string): CleanedTitle {
  const stripped = noFlags();

  if (typeof rawTitle !== 'string') return { title: '', stripped };

  const original = rawTitle.trim();
  let working = original;

  // Bounded rather than `while (true)`: the body always shortens `working`, so the loop
  // terminates on its own, but a bound makes that guarantee local and cheap to verify.
  for (let pass = 0; pass < 6; pass += 1) {
    const match = TRAILING_SEGMENT_PATTERN.exec(working);
    if (!match) break;

    const head = match[1] ?? '';
    const tail = (match[2] ?? match[3] ?? match[4] ?? '').trim().toLowerCase();
    const family = classifySegment(tail);

    // An unrecognised trailing segment stops the loop entirely rather than being skipped
    // over: segments nest right-to-left, so anything to its left is part of the real title.
    if (!family) break;
    if (head.trim() === '') break;

    stripped[family] = true;
    working = head.trim();
  }

  const neutralized = working.replace(QUERY_BREAKING_CHARS, ' ').replace(/\s+/g, ' ').trim();

  // The fallback chain, in order of decreasing preference: the cleaned title, the
  // uncleaned-but-neutralized title, then the input verbatim.
  if (neutralized !== '') return { title: neutralized, stripped };

  const fallback = original.replace(QUERY_BREAKING_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return { title: fallback !== '' ? fallback : original, stripped: noFlags() };
}

function classifySegment(tail: string): StripFamily | undefined {
  if (tail === '') return undefined;
  for (const { family, pattern } of FAMILY_PATTERNS) {
    if (pattern.test(tail)) return family;
  }
  return undefined;
}

/**
 * A trailing remix segment: "Remix", "Bad Bunny Remix", "Remix Version", "(VIP Mix)",
 * "- Bootleg".
 *
 * The optional leading `.+\s` is what makes "Bad Bunny Remix" and "Alan Walker Remix" work --
 * the remixer's name is part of the segment far more often than not. It is anchored at both
 * ends on purpose: "The Remix Album" and "Remixes" do NOT match, because those are the titles
 * of releases rather than version tails, and stripping them would change which song is being
 * searched for.
 */
const REMIX_SEGMENT_PATTERN =
  /^(?:.+\s)?(?:re-?mix|bootleg|refix|rework|vip(?:\s+mix)?)(?:\s+(?:version|edit))?$/;

/**
 * Drop a trailing remix segment, or return `undefined` when there is none.
 *
 * ===========================================================================
 *  DELIBERATELY NOT PART OF `cleanTrackTitle()`. IT IS A FALLBACK QUERY.
 *
 *  Every family in `FAMILY_PATTERNS` is stripped on the FIRST attempt, because
 *  the literal suffix breaks the query outright ("Bohemian Rhapsody -
 *  Remastered 2011" returns zero results). A remix is different: it is often a
 *  real, separately-credited recording that MusicBrainz knows under its full
 *  title, so stripping it up front would throw away the exact match and query
 *  a DIFFERENT song instead.
 *
 *  So the ladder is: try the title as given, and only if that yields no year at
 *  all, come back here and ask about the underlying song. That is what
 *  `api/_lib/resolve-year.ts` does, and it is why the result of a fallback hit
 *  reports `low` confidence -- the title had to be rewritten to find it.
 *
 *  WHY IT EXISTS AT ALL: measured 2026-08-05 on a real 42-track playlist, 15
 *  cards resolved to no year and FIVE of them carried an unstripped "- Remix"
 *  ("Ella No Es Tuya - Remix", "Pininfarina - Remix", "Tumba la Casa - Remix",
 *  "Además de Mí - Remix", "4 KISSUS - Remix"). It was the single largest
 *  identifiable cause of a blank card. See docs/agent_findings.md.
 * ===========================================================================
 *
 * Pure, and it never returns an empty string: a title that is nothing but a remix segment
 * ("- Remix") has no underlying song to ask about, so it returns `undefined` and the caller
 * spends no request on it.
 */
export function stripRemixSuffix(title: string): string | undefined {
  if (typeof title !== 'string') return undefined;

  const match = TRAILING_SEGMENT_PATTERN.exec(title.trim());
  if (!match) return undefined;

  const head = (match[1] ?? '').trim();
  const tail = (match[2] ?? match[3] ?? match[4] ?? '').trim().toLowerCase();

  if (head === '' || !REMIX_SEGMENT_PATTERN.test(tail)) return undefined;

  return head;
}

// ===========================================================================
//  CACHE KEY
// ===========================================================================

/**
 * The cache-key schema version. **Load-bearing -- bump it whenever the scoring logic
 * below changes.**
 *
 * Every cached year was computed by the logic that was current when it was written. With
 * no version segment, improved scoring would be masked indefinitely by stale entries and
 * the improvement would look like it did not work. Bumping this invalidates every cached
 * year in one edit, which is far cheaper than reasoning about which entries are poisoned.
 *
 * **v2 (2026-08-05):** the remix fallback in `api/_lib/resolve-year.ts` — a track whose title
 * carries a remix suffix can now resolve where it previously could not. Bumped on the rule
 * above rather than on necessity: the tier only affects entries that were `none`, and those
 * expire after a day anyway, so v1 would have washed out on its own within 24 h. The cost of
 * bumping is that every `high` entry (30-day TTL) is discarded too, so **the first play of any
 * playlist after this ships re-resolves its whole deck against a 1 req/s budget that is global
 * across all users.** Done deliberately, at the developer's instruction, to keep the rule
 * unconditional: a version that is only bumped when someone judges it necessary is a version
 * nobody can trust.
 *
 * **v3 (2026-08-11):** the tier ladder below. Singles and EPs now count toward the `high` tier,
 * so a song issued as a single before its album resolves to the single's year instead of the
 * album's, and the middle rung changed which candidates a `low` answer may be drawn from. Both
 * change the ANSWER for entries already cached at `high`, which is the 30-day tier — so unlike
 * v2 this bump is necessary rather than merely required by the rule. Same cost as before: the
 * first play of any playlist after this ships re-resolves its whole deck.
 *
 * **v4 (2026-08-11):** the loose artist-match fallback in `admitByArtist()`. Required by the
 * rule rather than necessary, and provably so: the fallback fires only when the exact pool is
 * EMPTY, so any entry cached with a year proves the exact pool was non-empty and its answer
 * cannot change. Only two classes can move — `none` entries (1-day TTL, which would wash out
 * on their own) and remix-fallback `low` entries (7-day), where a track may now resolve on its
 * ORIGINAL title before the remix rewrite is attempted. Bumped anyway, because a version that
 * is only bumped when someone judges it necessary is a version nobody can trust.
 */
export const YEAR_CACHE_SCHEMA_VERSION = 'v4';

/**
 * Lowercase, de-accent, drop punctuation, collapse whitespace.
 *
 * This is what makes the cache SHARED rather than per-user: two people whose playlists
 * spell the same song "Déjà Vu" and "Deja vu" must hit the same entry, or the cache only
 * ever helps the person who warmed it.
 *
 * Punctuation collapses to a SPACE, not to nothing -- otherwise "the beatles" and
 * "t-h-e beatles" are indistinguishable from "thebeatles", and word boundaries are the
 * only thing keeping genuinely different tracks in different keys.
 */
export function normalizeForCacheKey(value: string): string {
  if (typeof value !== 'string') return '';
  return (
    value
      .normalize('NFD')
      // Combining marks, i.e. the accents that NFD just split off.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Apostrophes are deleted rather than spaced, and every variant Spotify emits is
      // covered -- ASCII, the curly U+2019 it actually uses, and the modifier letter. An
      // apostrophe sits INSIDE a word, so spacing it would split "Don't Stop Me Now" into
      // "don t stop me now" and cache it separately from "Dont Stop Me Now", which is
      // exactly the cosmetic variation this function exists to collapse.
      .replace(/['\u2018\u2019\u02bc]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/**
 * The cache key for one (artist, title) pair.
 *
 * Built here rather than in `api/_lib/cache.ts` so the version segment and the
 * normalization are covered by the same pure test suite as the scoring they invalidate.
 * The title passed in should already be the CLEANED one -- caching under the raw title
 * would give "Bohemian Rhapsody" and "Bohemian Rhapsody - Remastered 2011" separate
 * entries for what is one lookup.
 */
export function yearCacheKey(artist: string, cleanedTitle: string): string {
  return `mbyear:${YEAR_CACHE_SCHEMA_VERSION}:${normalizeForCacheKey(artist)}|${normalizeForCacheKey(cleanedTitle)}`;
}

// ===========================================================================
//  CANDIDATE SELECTION
// ===========================================================================

/**
 * ===========================================================================
 *  THE TIER FILTERS ARE MEASURED, NOT ARBITRARY. DO NOT "SIMPLIFY" THEM.
 *
 *  Phase 0 measured a naive top-scored-recording lookup at **~6% accurate**
 *  (1 of 18): MusicBrainz has no canonical recording per song, and dozens of
 *  bootlegs, live takes and reissues tie at the maximum relevance score.
 *
 *  Biasing the pool toward official original releases -- no
 *  Live/Compilation/Remix/DJ-mix secondary type, release status Official --
 *  was correct in all 12 Phase 0 cases it was tried on, and the full pipeline
 *  measured **12 of 13** known-tricky tracks exact on 2026-08-04.
 *
 *  THREE CONSTRAINTS THAT LOOK OPTIONAL AND ARE NOT:
 *
 *  1. The filter must NEVER use an album name. The Spotify embed endpoint has
 *     no album name at track level, so an album-name-dependent approach cannot
 *     work in this codebase at all. Two of Phase 0's own batches quietly used
 *     the known-correct album title as a shortcut -- a shortcut only available
 *     with ground truth already in hand.
 *
 *  2. The year comes from the release GROUP's first-release-date, never from
 *     the release date inlined in the search response. See the earliest-date
 *     note below.
 *
 *  3. `Single` and `EP` are ELIGIBLE for the top tier, and that is a 2026-08-11
 *     reversal of `primary-type: Album` only. See the note on
 *     `ELIGIBLE_PRIMARY_TYPES`. Narrowing it back to Album is the single change
 *     that reintroduces the bug this ladder was built to fix.
 * ===========================================================================
 */

/**
 * Secondary types that disqualify a release group from the strict pass.
 *
 * Lowercased for comparison. Note what is ABSENT: `Soundtrack` is allowed, because for
 * plenty of songs the soundtrack IS the original release ("Stayin' Alive" on Saturday
 * Night Fever), and excluding it would replace a right answer with a later reissue.
 *
 * `Bootleg` is listed for completeness but is actually a release STATUS in MusicBrainz's
 * model, and is caught by the `Official` requirement below.
 */
const EXCLUDED_SECONDARY_TYPES = new Set([
  'live',
  'compilation',
  'remix',
  'dj-mix',
  'mixtape/street',
  'demo',
  'interview',
  'bootleg',
]);

/**
 * Release-group primary types the top tier will take a date from.
 *
 * ===========================================================================
 *  THIS WAS `'album'` ALONE UNTIL 2026-08-11, AND THAT WAS THE BUG.
 *
 *  A release group's `first-release-date` is the date of the ALBUM. For a song
 *  issued as a single before it appeared on one, the album date is the year the
 *  track was INCLUDED on a record, not the year the song came out:
 *
 *      Creep / Radiohead            single 1992-09  ->  Pablo Honey 1993-02
 *      Personal Jesus / Depeche Mode single 1989-08 ->  Violator    1990-03
 *      Mr. Brightside / The Killers  single 2003-09 ->  Hot Fuss    2004-06
 *
 *  Worse, a song that was never on a studio album at all ("Hey Jude") has NO
 *  eligible release group under an Album-only rule -- every one is either a
 *  Single (excluded here) or a compilation (excluded by secondary type) -- so it
 *  fell all the way to the unfiltered tier and reported `low` or nothing.
 *
 *  WHY WIDENING IS SAFE IN ONE DIRECTION ONLY: step 5 below is earliest-wins, so
 *  adding release groups to the pool can only move the answer EARLIER or leave
 *  it unchanged -- and earliest is the definition of "first release". A reissue
 *  single can never beat the album it postdates, which is why Billie Jean stays
 *  1982 despite its January 1983 single.
 * ===========================================================================
 */
const ELIGIBLE_PRIMARY_TYPES = new Set(['album', 'single', 'ep']);

const REQUIRED_RELEASE_STATUS = 'official';

/**
 * The one release status the middle tier still refuses.
 *
 * That tier drops the `Official` requirement so a promo pressing or an unmarked release can
 * still date a song -- but `Bootleg` is a status rather than a secondary type in
 * MusicBrainz's model, so without this the relaxation would quietly readmit exactly the
 * bootlegs `EXCLUDED_SECONDARY_TYPES` is written to keep out.
 */
const EXCLUDED_RELEASE_STATUS = 'bootleg';

/**
 * How far a candidate's recording length may sit from the track's own duration and still
 * count as the same performance.
 *
 * Ten seconds, from the Phase 0 observation that a ~3:42 studio "No Woman No Cry" and its
 * ~6:35 live counterpart need separating when the disambiguation text is unhelpful. Wide
 * enough to absorb the second or two that different masterings differ by, narrow enough to
 * separate an extended mix. It rests on one data point, so treat it as tunable.
 *
 * EXPORTED because `api/_lib/musicbrainz.ts` also spends it as a `dur:[lo TO hi]` bound in
 * the search query itself, which is where it does most of its work (see the note on the
 * duration preference below). The query bound and the local preference must mean the same
 * thing, so they share one constant rather than agreeing by coincidence.
 */
export const DURATION_TOLERANCE_MS = 10_000;

/** Nothing before the phonograph, and nothing announced further ahead than next year. */
const MIN_PLAUSIBLE_YEAR = 1900;

/**
 * How hard we had to work to believe a credit names the artist that was asked for.
 *
 * `exact` is the rule that has always been here; `loose` is the order-independent fallback
 * that runs only when `exact` admits nothing. See `admitByArtist()`.
 */
type ArtistMatch = 'exact' | 'loose';

/**
 * What each match strength can support. A loosened match can never report `high` -- the
 * credit did not say what was asked for, and the card should carry the unconfirmed marker.
 */
const ARTIST_MATCH_CONFIDENCE: Record<ArtistMatch, 'high' | 'low'> = {
  exact: 'high',
  loose: 'low',
};

/**
 * Articles that do not count toward the loose rule's two-token minimum.
 *
 * Multilingual because the playlists are: a Spanish or French definite article is exactly as
 * free a token as an English one, and the whole point of the minimum is that a match must
 * rest on two real words.
 */
const ARTIST_ARTICLES = new Set([
  'the',
  'a',
  'an',
  'el',
  'la',
  'los',
  'las',
  'le',
  'les',
  'der',
  'die',
  'das',
  'il',
  'lo',
]);

/** Real (non-article) words the shorter side must carry before a loose match is allowed. */
const MIN_LOOSE_ARTIST_TOKENS = 2;

/** Extra words the covering side may carry — one joinphrase, one middle name, and no more. */
const ARTIST_TOKEN_SLACK = 1;

// ---------------------------------------------------------------------------
//  THE TIER LADDER
// ---------------------------------------------------------------------------

export type YearTierId = 'official-release' | 'studio-release' | 'unfiltered';

/**
 * One rung: which candidates it will look at, where it reads a date from, and what it
 * reports when it finds one.
 *
 * Every rung shares steps 1, 4 and 5 of `pickBestRecording()` -- artist plausibility, the
 * duration preference and earliest-wins. Only the filter and the date source vary, which is
 * what keeps "which rung answered" a statement about EVIDENCE rather than about scoring.
 *
 * `maxConfidence` is a CEILING, not the reported value. Confidence is the weakest of every
 * evidence axis (see `weakest()`), and the rung is only one of them -- the artist match is
 * the other. The field is named for the ceiling rather than the answer so that a future
 * reader cannot mistake it for what gets returned.
 */
interface YearTier {
  readonly accepts: (candidate: RecordingCandidate) => boolean;
  readonly dateOf: (candidate: RecordingCandidate) => string | undefined;
  readonly maxConfidence: 'high' | 'low';
  readonly source: YearSource;
}

/**
 * The rungs in order. `api/_lib/resolve-year.ts` walks this array and stops at the first one
 * that yields a year.
 *
 * ===========================================================================
 *  THE LADDER COSTS NOTHING EXTRA. ALL THREE RUNGS READ THE SAME POOL.
 *
 *  `pickBestRecording()` is pure and the candidates are already fetched, so
 *  walking three rungs instead of two adds no MusicBrainz request. A lookup
 *  still costs exactly two (see api/_lib/musicbrainz.ts).
 *
 *  WHY THERE IS A MIDDLE RUNG (added 2026-08-11). Before it, the ladder went
 *  straight from "official original release" to NO FILTER AT ALL, and the
 *  unfiltered rung let live takes, compilations, remixes, demos and bootlegs
 *  compete on equal terms. That is why `low` answers were so often wrong: not
 *  because the evidence was thin, but because nothing was ruling out the
 *  evidence that is actively misleading. `studio-release` keeps the whole
 *  secondary-type exclusion and only relaxes the two requirements that make the
 *  top rung MISS -- the primary type and the Official status.
 * ===========================================================================
 */
export const YEAR_TIER_ORDER: readonly YearTierId[] = [
  'official-release',
  'studio-release',
  'unfiltered',
];

const YEAR_TIERS: Record<YearTierId, YearTier> = {
  'official-release': {
    accepts: isOfficialOriginalRelease,
    dateOf: officialReleaseDate,
    maxConfidence: 'high',
    source: 'release-group',
  },
  'studio-release': {
    accepts: isStudioRelease,
    dateOf: studioReleaseDate,
    maxConfidence: 'low',
    source: 'release-group',
  },
  unfiltered: {
    accepts: () => true,
    dateOf: unfilteredDate,
    maxConfidence: 'low',
    source: 'recording',
  },
};

export interface PickBestRecordingOptions {
  /** The requested artist, RAW as Spotify supplied it. Normalized internally. */
  artist: string;
  /** The track's duration. `0` or omitted means unknown, and disables the duration preference. */
  durationMs?: number;
  /** Which rung of `YEAR_TIER_ORDER` to run. */
  tier: YearTierId;
}

/**
 * Pick the original release year from a pool of normalized candidates.
 *
 * Pure: no network, no cache, no clock beyond the current year used as a sanity bound.
 * Returns a `YearResult` rather than throwing, so the handler's job stays a status mapping.
 */
export function pickBestRecording(
  candidates: readonly RecordingCandidate[],
  options: PickBestRecordingOptions,
): YearResult {
  const { artist, durationMs } = options;
  const tier = YEAR_TIERS[options.tier];

  // ---- 1. Artist plausibility -------------------------------------------------
  // Phase 0 measured this as reliable: 0 of 6 cover-versus-original lookups
  // cross-contaminated, so Cohen's "Hallelujah" and Buckley's stay apart. Applied on EVERY
  // rung -- a relaxed year off by a decade is recoverable, a year taken from a different
  // artist's song entirely is not.
  //
  // The artist filter sits OUTSIDE the ladder deliberately: it is the same pool on all three
  // rungs, which makes artist identity the outer loop and release quality the inner one. That
  // hierarchy is a hard invariant, not a sortable preference, which is why it is expressed as
  // structure rather than as another rung.
  const { pool: byArtist, match } = admitByArtist(candidates, normalizeForCacheKey(artist));

  if (byArtist.length === 0) return failure('no-candidates');

  // ---- 2. Tier filter ---------------------------------------------------------
  const filtered = byArtist.filter(tier.accepts);
  if (filtered.length === 0) return failure('no-dated-candidates');

  // ---- 3. Date extraction -----------------------------------------------------
  const dated: { candidate: RecordingCandidate; year: number; date: string }[] = [];
  for (const candidate of filtered) {
    const date = tier.dateOf(candidate);
    if (date === undefined) continue;
    const year = parseYear(date);
    // The implausibility guard doubles as the parse guard: a corrupt or unparseable date
    // yields NaN, which fails the range check like any other nonsense value.
    if (year === undefined || !isPlausibleYear(year)) continue;
    dated.push({ candidate, year, date });
  }

  if (dated.length === 0) return failure('no-dated-candidates');

  // ---- 4. Duration preference -------------------------------------------------
  // Applied BEFORE earliest-wins, and only when it does not empty the pool. That ordering
  // is the point: an extended or alternate take that happens to predate the studio release
  // would otherwise win on date alone. It can never override the release-group filter,
  // because it only ever narrows a set that filter already produced.
  //
  // Measured neutral on the 14-track suite (2026-08-04) -- and that is expected, because
  // the adapter already spends the same tolerance as a `dur:` bound in the search query,
  // where it is worth far more: it shrinks the candidate pool below the 100-result page
  // limit and so decides WHICH candidates exist at all. This pass is what covers the case
  // the query bound cannot: a track whose duration Spotify did not supply.
  const preferred = preferByDuration(dated, durationMs);

  // ---- 5. Earliest wins -------------------------------------------------------
  //
  // NOTE ON EMPTY DATES, and why this is not `Math.min` over every date present:
  // missing and empty `date` fields are common on bootleg and compilation releases, so a
  // bare minimum over whatever is there silently prefers the records with the worst data.
  // Filter first (steps 2-3), then compare -- that ordering is the bug guard.
  let best = preferred[0];
  if (!best) return failure('no-dated-candidates');
  for (const entry of preferred) {
    if (compareDates(entry, best) < 0) best = entry;
  }

  // Confidence is the WEAKEST of every evidence axis, never the rung's ceiling alone. Today
  // there are two axes; the plan's next idea (a recording-date disagreement detector) would
  // be a third, and adding it is adding an argument here rather than hunting return sites.
  return {
    year: best.year,
    confidence: weakest(tier.maxConfidence, ARTIST_MATCH_CONFIDENCE[match]),
    source: tier.source,
  };
}

/** The weakest of the confidences given. One axis says `low` -> the answer is `low`. */
function weakest(...values: readonly ('high' | 'low')[]): 'high' | 'low' {
  return values.includes('low') ? 'low' : 'high';
}

function failure(reason: YearFailureReason): YearResult {
  return { year: null, confidence: 'none', reason };
}

/**
 * The `official-release` rung's date: the release GROUP's first-release-date, and nothing else.
 *
 * ===========================================================================
 *  NOT `candidate.releaseDate`. This is the single most reversion-prone line
 *  in the module, because the release date is right there in the same object.
 *
 *  A release group holds every pressing of an album, and the recording search
 *  inlines whichever RELEASE matched -- nearly always a reissue. Measured
 *  2026-08-04, filtering to official studio albums and taking the earliest
 *  inlined release date gives:
 *
 *      Billie Jean          1982 -> 2012   (Bad 25)
 *      Bohemian Rhapsody    1975 -> 2001   (A Night at the Opera reissue)
 *      Sweet Child O' Mine  1987 -> 2018   (Appetite reissue)
 *      Hotel California     1976 -> 2001
 *      Layla                1970 -> 1990
 *
 *  The release group's own first-release-date is the album's original release
 *  date and gets all five right. It is the entire reason a lookup costs two
 *  requests instead of one (docs/agent_findings.md, 2026-08-04).
 * ===========================================================================
 */
function officialReleaseDate(candidate: RecordingCandidate): string | undefined {
  return nonEmpty(candidate.releaseGroupFirstReleaseDate);
}

/**
 * The `studio-release` rung's date: the release-group first-release-date where one was
 * fetched, then the recording's own, then the inlined release date.
 *
 * The release-group date still leads, because it is the only one of the three that means
 * "the album's original release" rather than "this pressing". But this rung accepts
 * candidates the adapter did not spend its second request on, so for most of them the field
 * is absent and the chain is what makes the rung useful at all.
 *
 * `releaseDate` sits LAST and is the reissue date the note above warns about. It is
 * reachable only when a candidate has no first-release-date of either kind, and only on a
 * rung that already reports `low` -- which is the honest place for a date this weak.
 */
function studioReleaseDate(candidate: RecordingCandidate): string | undefined {
  return (
    nonEmpty(candidate.releaseGroupFirstReleaseDate) ??
    nonEmpty(candidate.recordingFirstReleaseDate) ??
    nonEmpty(candidate.releaseDate)
  );
}

/**
 * The `unfiltered` rung's date: the recording's own first-release-date, falling back to the
 * release-group and release dates.
 *
 * The recording date comes first because this rung has, by definition, no release-group
 * filter to lean on, and a recording's first-release-date is at least anchored to that
 * specific performance. It is measurably worse than the top rung -- off by a year on several
 * Phase 0 tracks -- which is precisely what `low` confidence communicates to the reveal side.
 */
function unfilteredDate(candidate: RecordingCandidate): string | undefined {
  return (
    nonEmpty(candidate.recordingFirstReleaseDate) ??
    nonEmpty(candidate.releaseGroupFirstReleaseDate) ??
    nonEmpty(candidate.releaseDate)
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The `official-release` rung's filter, exported because `api/_lib/musicbrainz.ts` needs the
 * same predicate to decide which release groups are worth spending its second request on.
 *
 * One definition, two callers. If the adapter reimplemented this, it would enrich the wrong
 * release groups and the top rung would silently find nothing to date -- a failure that looks
 * exactly like MusicBrainz having no data.
 */
export function isOfficialOriginalRelease(candidate: RecordingCandidate): boolean {
  if (!ELIGIBLE_PRIMARY_TYPES.has((candidate.releaseGroupPrimaryType ?? '').toLowerCase()))
    return false;
  if ((candidate.releaseStatus ?? '').toLowerCase() !== REQUIRED_RELEASE_STATUS) return false;
  return hasNoExcludedSecondaryType(candidate);
}

/**
 * The `studio-release` rung's filter: the secondary-type exclusion, and nothing else except a
 * refusal to read a bootleg.
 *
 * What it deliberately does NOT require is a primary type or `Official` status, because those
 * two are what make the top rung miss: a song on an untyped release group, or one whose only
 * pressing is a promo, still has a real first release. What it deliberately DOES keep is the
 * live/compilation/remix/dj-mix/demo exclusion -- that is the difference between "thin
 * evidence" and "actively misleading evidence", and conflating them is what made `low`
 * answers unreliable before 2026-08-11.
 */
function isStudioRelease(candidate: RecordingCandidate): boolean {
  if ((candidate.releaseStatus ?? '').toLowerCase() === EXCLUDED_RELEASE_STATUS) return false;
  return hasNoExcludedSecondaryType(candidate);
}

function hasNoExcludedSecondaryType(candidate: RecordingCandidate): boolean {
  return !candidate.releaseGroupSecondaryTypes.some((type) =>
    EXCLUDED_SECONDARY_TYPES.has(type.trim().toLowerCase()),
  );
}

/**
 * Narrow to candidates whose recording length is within tolerance of the track, unless
 * that would leave nothing.
 *
 * Candidates with no `lengthMs` at all are neither preferred nor excluded on their own:
 * MusicBrainz omits the field often enough that dropping them would throw away good
 * candidates, so they only lose out when a length-carrying candidate actually matches.
 */
function preferByDuration<T extends { candidate: RecordingCandidate }>(
  entries: readonly T[],
  durationMs: number | undefined,
): readonly T[] {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return entries;
  }

  const close = entries.filter((entry) => {
    const length = entry.candidate.lengthMs;
    if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) return false;
    return Math.abs(length - durationMs) <= DURATION_TOLERANCE_MS;
  });

  return close.length > 0 ? close : entries;
}

/**
 * Order two dated candidates, earliest first.
 *
 * The year decides it. Within one year, a BARE year sorts before any more precise date in
 * that same year: "1975" means "some time in 1975", which is earlier-or-equal to
 * "1975-11-21", and treating it as later would make a coarsely-dated original lose to a
 * precisely-dated reissue from the same year.
 */
function compareDates(
  a: { year: number; date: string },
  b: { year: number; date: string },
): number {
  if (a.year !== b.year) return a.year - b.year;

  const precisionA = a.date.split('-').length;
  const precisionB = b.date.split('-').length;
  if (precisionA !== precisionB) return precisionA - precisionB;

  // Same year, same granularity: plain lexicographic order is chronological for
  // zero-padded `YYYY-MM-DD`.
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

/** `YYYY`, `YYYY-MM` and `YYYY-MM-DD` all yield their year; anything else yields `undefined`. */
function parseYear(date: string): number | undefined {
  const match = /^(\d{4})(?:-\d{2})?(?:-\d{2})?$/.exec(date.trim());
  if (!match?.[1]) return undefined;
  return Number.parseInt(match[1], 10);
}

/**
 * The final sanity guard against a corrupt date.
 *
 * The upper bound is next year rather than this one: albums are announced with a release
 * date ahead of time, and MusicBrainz carries those dates before the record ships.
 */
function isPlausibleYear(year: number): boolean {
  if (!Number.isInteger(year)) return false;
  return year >= MIN_PLAUSIBLE_YEAR && year <= new Date().getUTCFullYear() + 1;
}

/**
 * Does a MusicBrainz artist credit CERTAINLY refer to the artist we asked for?
 *
 * Containment in EITHER direction, on whole words. Both directions are needed and both are
 * load-bearing: Spotify says "Jimi Hendrix" where MusicBrainz says "The Jimi Hendrix
 * Experience", and Spotify says "Bob Marley & The Wailers" where a given credit may say
 * just "Bob Marley".
 *
 * Whole words rather than raw substring, so "Sting" does not match "Stingray". The residual
 * risk is a genuine prefix collision ("Queen" matching "Queen Latifah") on a track the two
 * both have a same-titled song for -- remote, and bounded by the fact that the search query
 * was already scoped by artist before these candidates existed.
 *
 * EXPORTED only so `shared/year.test.ts` can assert that no fixture in the accuracy suite
 * ever reaches `artistMatchesLoose()`. That assertion is what makes "this change cannot move
 * any of the known-good years" a test rather than a claim, so the export earns its keep.
 * Nothing in `src/` or `api/` calls it -- `pickBestRecording()` is the only production path.
 */
export function artistMatchesExact(normalizedRequest: string, artistCredit: string): boolean {
  if (normalizedRequest === '') return true;

  const credit = normalizeForCacheKey(artistCredit);
  if (credit === '') return false;
  if (credit === normalizedRequest) return true;

  return containsTokenRun(credit, normalizedRequest) || containsTokenRun(normalizedRequest, credit);
}

/** Is `needle`'s token sequence a contiguous run inside `haystack`'s? */
function containsTokenRun(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Admit the exactly-matching pool; only when it is EMPTY, admit the loosely-matching one.
 *
 * ===========================================================================
 *  A FALLBACK, NEVER A WIDENING. DO NOT "SIMPLIFY" INTO ONE UNION FILTER.
 *
 *  A union looks equivalent and is not. Step 5 is earliest-wins, so a single
 *  loosely-matched candidate with an older date would beat every exactly-matched
 *  one -- and step 4's duration preference is not monotone either (it narrows to
 *  length-matching candidates only when that set is non-empty, so one admission
 *  can collapse the pool to just it). A union can therefore move a year in BOTH
 *  directions. The fallback shape cannot: when the exact pool is non-empty the
 *  result is bit-identical to before this existed, and when it is empty every
 *  rung already returned `no-candidates` and the card was dropped from the deck.
 *  So this can only turn a null into a year -- never one year into another.
 * ===========================================================================
 */
function admitByArtist(
  candidates: readonly RecordingCandidate[],
  normalizedRequest: string,
): { pool: readonly RecordingCandidate[]; match: ArtistMatch } {
  const exact = candidates.filter((c) => artistMatchesExact(normalizedRequest, c.artistCredit));
  if (exact.length > 0) return { pool: exact, match: 'exact' };

  // May still be empty, which is the same `no-candidates` the caller already handled.
  return {
    pool: candidates.filter((c) => artistMatchesLoose(normalizedRequest, c.artistCredit)),
    match: 'loose',
  };
}

/**
 * The loose rule: the same tokens, in any order, with at most one word of slack.
 *
 * ===========================================================================
 *  WHY ORDER-INDEPENDENCE IS REQUIRED, MEASURED 2026-08-11.
 *
 *  Spotify joins collaborators with ", " and MusicBrainz joins them with a
 *  joinphrase, so the two disagree about both the CONNECTOR and the ORDER. The
 *  exact rule needs a contiguous run and fails on every shape below; all four
 *  were real cards dropped from a real deck:
 *
 *      Shakira, Burna Boy                 vs  Shakira x Burna Boy
 *      Dave, Tems                         vs  Dave feat. Tems
 *      Dave, Tems                         vs  Tems & Dave
 *      Xavi, De La Rose                   vs  De La Rose & Xavi
 *      Natanael Cano, Gabito Ballesteros  vs  Natanael Cano feat. Gabito Ballesteros
 *
 *  The cheaper fix of normalising join words away ("feat", "and", …) while
 *  KEEPING contiguity was measured against these and recovers only two of the
 *  four: it cannot touch reordering, which is half of the sample. Hence a token
 *  bag rather than a token run. The price is that "Alice Cooper" now matches
 *  "Cooper Alice", which is pinned as a test rather than pretended away.
 *
 *  Note what is NOT the reason: `normalizeForCacheKey` already maps "&", "+" and
 *  "," to spaces, so punctuation-only differences matched before this existed.
 *  Only WORD connectors and reordering were ever broken.
 * ===========================================================================
 *
 * Two guards keep it stingy, because this fires exactly when the requested artist is
 * unrecognisable in the pool -- so a false positive puts a plausible wrong year on a card
 * whose whole content is the year. Both were measured to cost none of the five recoveries:
 *
 * 1. **At least two non-article tokens on the shorter side.** Without it a two-token request
 *    like "The Band" degrades to one real word plus a free article and matches "The Steve
 *    Miller Band", "The E Street Band" and every other "The <Noun> Band". Costs nothing: a
 *    genuinely single-token request can never reach here anyway, because for one token a
 *    subset and a contiguous run are the same test, so the exact rule already answered.
 * 2. **At most one token of slack.** Modern credits reuse a tiny vocabulary -- "lil", "young",
 *    "big", "baby", "dj" -- so "Lil Baby" is a token subset of "Lil Durk, Lil Uzi Vert & Baby
 *    Keem". Bounding the extra words kills that while keeping "Kanye West" ~ "Kanye Omari
 *    West" and every joinphrase above, which add exactly one word.
 */
function artistMatchesLoose(normalizedRequest: string, artistCredit: string): boolean {
  if (normalizedRequest === '') return true;

  const request = normalizedRequest.split(' ').filter(Boolean);
  const credit = normalizeForCacheKey(artistCredit).split(' ').filter(Boolean);
  if (credit.length === 0) return false;

  const shorter = request.length <= credit.length ? request : credit;
  if (shorter.filter((token) => !ARTIST_ARTICLES.has(token)).length < MIN_LOOSE_ARTIST_TOKENS) {
    return false;
  }

  return coversWithinSlack(request, credit) || coversWithinSlack(credit, request);
}

/** Is every token of `needle` present in `haystack`, with at most `ARTIST_TOKEN_SLACK` spare? */
function coversWithinSlack(needle: readonly string[], haystack: readonly string[]): boolean {
  if (haystack.length - needle.length > ARTIST_TOKEN_SLACK) return false;
  return needle.every((token) => haystack.includes(token));
}
