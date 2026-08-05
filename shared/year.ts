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
 */
export const YEAR_CACHE_SCHEMA_VERSION = 'v2';

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
 *  THE STRICT FILTER IS MEASURED, NOT ARBITRARY. DO NOT "SIMPLIFY" IT.
 *
 *  Phase 0 measured a naive top-scored-recording lookup at **~6% accurate**
 *  (1 of 18): MusicBrainz has no canonical recording per song, and dozens of
 *  bootlegs, live takes and reissues tie at the maximum relevance score.
 *
 *  Biasing the pool toward official studio albums -- primary type Album, no
 *  Live/Compilation/Remix/DJ-mix secondary type, release status Official --
 *  was correct in all 12 Phase 0 cases it was tried on, and the full pipeline
 *  measured **12 of 13** known-tricky tracks exact on 2026-08-04.
 *
 *  TWO CONSTRAINTS THAT LOOK OPTIONAL AND ARE NOT:
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

const REQUIRED_PRIMARY_TYPE = 'album';
const REQUIRED_RELEASE_STATUS = 'official';

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

export interface PickBestRecordingOptions {
  /** The requested artist, RAW as Spotify supplied it. Normalized internally. */
  artist: string;
  /** The track's duration. `0` or omitted means unknown, and disables the duration preference. */
  durationMs?: number;
  /**
   * `strict` -- official studio albums only, dated by release-group first-release-date,
   * reports `high`. `relaxed` -- no release-group filter, dated by recording
   * first-release-date, reports `low`.
   */
  mode: 'strict' | 'relaxed';
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
  const { artist, durationMs, mode } = options;

  // ---- 1. Artist plausibility -------------------------------------------------
  // Phase 0 measured this as reliable: 0 of 6 cover-versus-original lookups
  // cross-contaminated, so Cohen's "Hallelujah" and Buckley's stay apart. Applied in BOTH
  // modes -- a relaxed year off by a decade is recoverable, a year taken from a different
  // artist's song entirely is not.
  const requested = normalizeForCacheKey(artist);
  const byArtist = candidates.filter((candidate) =>
    artistMatches(requested, candidate.artistCredit),
  );

  if (byArtist.length === 0) return failure('no-candidates');

  // ---- 2. Mode filter ---------------------------------------------------------
  const filtered = mode === 'strict' ? byArtist.filter(isOfficialStudioAlbum) : byArtist;
  if (filtered.length === 0) return failure('no-dated-candidates');

  // ---- 3. Date extraction -----------------------------------------------------
  const dated: { candidate: RecordingCandidate; year: number; date: string }[] = [];
  for (const candidate of filtered) {
    const date = mode === 'strict' ? strictDate(candidate) : relaxedDate(candidate);
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

  return {
    year: best.year,
    confidence: mode === 'strict' ? 'high' : 'low',
    source: mode === 'strict' ? 'release-group' : 'recording',
  };
}

function failure(reason: YearFailureReason): YearResult {
  return { year: null, confidence: 'none', reason };
}

/**
 * The strict pass's date: the release GROUP's first-release-date, and nothing else.
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
function strictDate(candidate: RecordingCandidate): string | undefined {
  return nonEmpty(candidate.releaseGroupFirstReleaseDate);
}

/**
 * The relaxed pass's date: the recording's own first-release-date, falling back to the
 * release-group and release dates.
 *
 * The recording date comes first because the relaxed pass has, by definition, no
 * release-group filter to lean on, and a recording's first-release-date is at least
 * anchored to that specific performance. It is measurably worse than the strict pass --
 * off by a year on several Phase 0 tracks -- which is precisely what `low` confidence
 * communicates to Phase 6's review screen.
 */
function relaxedDate(candidate: RecordingCandidate): string | undefined {
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
 * The strict pass's release filter, exported because `api/_lib/musicbrainz.ts` needs the
 * same predicate to decide which release groups are worth spending its second request on.
 *
 * One definition, two callers. If the adapter reimplemented this, it would enrich the wrong
 * release groups and the strict pass would silently find nothing to date -- a failure that
 * looks exactly like MusicBrainz having no data.
 */
export function isOfficialStudioAlbum(candidate: RecordingCandidate): boolean {
  if ((candidate.releaseGroupPrimaryType ?? '').toLowerCase() !== REQUIRED_PRIMARY_TYPE)
    return false;
  if ((candidate.releaseStatus ?? '').toLowerCase() !== REQUIRED_RELEASE_STATUS) return false;
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
 * Does a MusicBrainz artist credit plausibly refer to the artist we asked for?
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
 */
function artistMatches(normalizedRequest: string, artistCredit: string): boolean {
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
