/**
 * Store-hit verification: is a row a music store returned the SAME RECORDING as the card,
 * and which verified row's date is the store's answer?
 *
 * The DECISION half of the two store adapters (`api/_lib/deezer.ts`, `api/_lib/itunes.ts`),
 * in the house decision/binding split. An adapter does the HTTP and turns each store row into
 * a `StoreRow`; everything that decides whether the row counts, and which year it gives, is a
 * pure function here. It lives in `shared/` rather than beside the adapters for the reason the
 * MusicBrainz scorer does: a wrong verification rule reads as a plausible WRONG year on a card
 * whose whole content is the year, which no status-code test would ever notice, so it must be
 * node-testable with no HTTP at all (plan.year-fetch-rework-server.md, step 4).
 *
 * ===========================================================================
 *  THESE ARE THE RULES THE SPIKE MEASURED. DO NOT SWAP IN `artistMatchesExact`.
 *
 *  A row counts only when ALL FOUR hold (spike §4.1):
 *
 *    title     -- `normalizeForCacheKey(cleanTrackTitle(..).title)` is equal on
 *                 both sides. EQUAL, not "contains": a store's "Hallelujah" must
 *                 not verify a card titled "Hallelujah I Love Her So".
 *    artist    -- every token of the primary Spotify artist appears somewhere in
 *                 the store's credit. Order-blind and one-directional, which is
 *                 NOT the MusicBrainz rule: `artistMatchesExact` wants a contiguous
 *                 run in either direction, and its loose fallback caps a year at
 *                 `low`. A store answer is one voter among three, so the stricter
 *                 fallback machinery buys nothing here, and the token rule is the
 *                 one the §12.4 live run matched 151 of 151 times.
 *    duration  -- within `DURATION_TOLERANCE_MS`, and a row WITHOUT a length
 *                 FAILS. The harness behind spike §4 let a length-less iTunes row
 *                 through; the plan closes that, because an unmeasured row is
 *                 exactly the one that can be a live take or an extended mix.
 *                 (The "duration optional" switch existed only for Discogs and
 *                 went with it.)
 *    excluded  -- the adapter did not flag the row as something that is not a
 *                 purchasable/streamable recording of the song (see each adapter
 *                 for what sets it).
 *
 *  THE ANSWER IS THE EARLIEST VERIFIED ROW, by the same `compareDates` that
 *  `pickBestRecording` uses. Same reason too: a store's errors are REISSUES
 *  (remasters, compilations, deluxe editions), and a reissue is always later
 *  than the original, so earliest-wins can only discard the error direction.
 * ===========================================================================
 *
 * Verification and selection are two functions, not one, because Deezer's date arrives in a
 * SECOND request: its search rows carry no release date, so the adapter must verify undated
 * rows first (that is what decides which `track/{id}` to fetch) and pick the earliest only
 * once the dated rows are back. iTunes has everything in one response and simply calls both.
 *
 * `rules` is a parameter on both functions for TEST callers only -- chiefly the mutation guard in
 * `api/_lib/year-votes.test.ts`, which re-runs selection over the CAPTURED rows with each rule
 * dropped in turn and asserts the year moves. That is what makes "every rule is load-bearing"
 * a test rather than a claim -- the same shape as `artistMatchesExact`'s export. Production
 * callers never pass it. The guard lives in `api/_lib/` rather than in `store-match.test.ts`
 * because the captured payloads are Node-side fixtures (`api/_lib/__fixtures__/`), and a
 * `shared/` test importing from `api/` would drag them into the browser typecheck.
 *
 * Pure: no DOM, no Node API, no clock beyond `isPlausibleYear`'s "next year" bound.
 */

import {
  DURATION_TOLERANCE_MS,
  cleanTrackTitle,
  compareDates,
  isPlausibleYear,
  normalizeForCacheKey,
  parseYear,
} from './year.js';

/** One store row, as an adapter normalised it. Nothing store-specific survives into here. */
export interface StoreRow {
  /**
   * Every title the store gives the row; the title rule passes if ANY of them does. Deezer
   * sends `title` and `title_short` (the title without its `title_version` tail), and the
   * spike's harness accepted either; iTunes sends one `trackName`.
   */
  titles: readonly string[];
  /** The store's artist credit for the row, verbatim. */
  credit: string;
  /** The row's length in milliseconds, or `undefined` when the store did not give one. */
  durationMs: number | undefined;
  /** Set by the adapter for a row that is not a recording of the song at all. */
  excluded: boolean;
}

/** A row whose release date is known. `date` is `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
export interface DatedStoreRow extends StoreRow {
  date: string;
}

/** What the card says about itself. */
export interface StoreTarget {
  /** The title exactly as Spotify gave it. Cleaned here, the same way on both sides. */
  rawTitle: string;
  /** `primaryArtistGuess(rawArtist)`. */
  primaryArtist: string;
  /** The track's length, or `undefined` when unknown -- in which case NO row verifies. */
  durationMs: number | undefined;
}

export type StoreMatchRule = 'title' | 'artist' | 'duration' | 'excluded';

/** Every rule, in the order the header documents them. The production default. */
export const STORE_MATCH_RULES: readonly StoreMatchRule[] = [
  'title',
  'artist',
  'duration',
  'excluded',
];

/** The comparable form of a title: cleaned, then normalised exactly as the cache key is. */
function comparableTitle(title: string): string {
  return normalizeForCacheKey(cleanTrackTitle(title).title);
}

function tokens(value: string): string[] {
  return normalizeForCacheKey(value).split(' ').filter(Boolean);
}

/**
 * Which of the rules a row breaks against a target. Empty means verified. Exported for the
 * adapters' tests and the mutation guard, which need to know WHY a row failed.
 */
export function failedStoreRules(row: StoreRow, target: StoreTarget): StoreMatchRule[] {
  const failed: StoreMatchRule[] = [];

  // ---- title --------------------------------------------------------------
  // A target that normalises to nothing (a title of pure punctuation) would otherwise
  // "equal" every other punctuation-only row, so an empty comparable title never matches.
  const want = comparableTitle(target.rawTitle);
  const titleOk = want !== '' && row.titles.some((title) => comparableTitle(title) === want);
  if (!titleOk) failed.push('title');

  // ---- artist -------------------------------------------------------------
  // `every` over an empty list is vacuously true, so an artist that normalises to nothing
  // must fail explicitly -- otherwise a blank subtitle would verify every row in the store.
  const required = tokens(target.primaryArtist);
  const credit = new Set(tokens(row.credit));
  const artistOk = required.length > 0 && required.every((token) => credit.has(token));
  if (!artistOk) failed.push('artist');

  // ---- duration -----------------------------------------------------------
  // Both lengths must be KNOWN. A missing length on either side is not "close enough"; it is
  // unverifiable, and an unverifiable store row must not vote.
  const durationOk =
    row.durationMs !== undefined &&
    target.durationMs !== undefined &&
    Number.isFinite(row.durationMs) &&
    Math.abs(row.durationMs - target.durationMs) <= DURATION_TOLERANCE_MS;
  if (!durationOk) failed.push('duration');

  // ---- excluded -----------------------------------------------------------
  if (row.excluded) failed.push('excluded');

  return failed;
}

/**
 * Does a row pass every rule in `rules`? Used on UNDATED rows by Deezer, to choose which
 * `track/{id}` requests to spend.
 */
export function isVerifiedStoreRow(
  row: StoreRow,
  target: StoreTarget,
  rules: readonly StoreMatchRule[] = STORE_MATCH_RULES,
): boolean {
  return failedStoreRules(row, target).every((rule) => !rules.includes(rule));
}

/** The year of a row's date, or `undefined` when it does not parse or is implausible. */
export function storeRowYear(date: string): number | undefined {
  const year = parseYear(date);
  return year !== undefined && isPlausibleYear(year) ? year : undefined;
}

/**
 * The earliest verified, plausibly dated row, and its year -- or `null` when no row both
 * verifies and carries a usable date.
 *
 * A row with a corrupt date (Deezer's `0000-00-00`, a missing iTunes `releaseDate`) is
 * skipped rather than failing the whole answer: the other verified rows are still evidence.
 * Ties go to the first row in input order, i.e. the store's own relevance order, which only
 * matters for which row a test can point at -- the year is the same either way.
 */
export function earliestVerifiedRow<R extends DatedStoreRow>(
  rows: readonly R[],
  target: StoreTarget,
  rules: readonly StoreMatchRule[] = STORE_MATCH_RULES,
): { row: R; year: number } | null {
  let best: { row: R; year: number } | null = null;

  for (const row of rows) {
    if (!isVerifiedStoreRow(row, target, rules)) continue;
    const year = storeRowYear(row.date);
    if (year === undefined) continue;

    if (
      best === null ||
      compareDates({ year, date: row.date }, { year: best.year, date: best.row.date }) < 0
    ) {
      best = { row, year };
    }
  }

  return best;
}
