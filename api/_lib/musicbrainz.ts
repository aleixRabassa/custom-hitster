/**
 * The MusicBrainz adapter — the only module that knows how MusicBrainz's JSON is shaped or
 * how many requests a lookup costs.
 *
 * It makes NO scoring decisions. It fetches, normalizes to `RecordingCandidate[]`, and
 * hands the result to `pickBestRecording()` in `shared/year.ts`. That separation is what
 * keeps every accuracy claim a unit test over fixtures rather than a live, rate-limited,
 * non-deterministic network call (decision 16).
 *
 * `fetch` and the rate-limit gate are both injected so the tests run offline and instantly.
 *
 * ===========================================================================
 *  A LOOKUP COSTS TWO REQUESTS, AND THE SECOND ONE IS WHERE THE ACCURACY IS.
 *
 *    1. recording search  -- finds candidate recordings and, inlined with them,
 *       every release they appear on with its release-group types and status.
 *    2. release-group search, BATCHED over every surviving candidate in one
 *       query -- fetches each release group's `first-release-date`.
 *
 *  Request 2 exists because the search inlines whichever RELEASE matched, which
 *  is nearly always a reissue: filtering to official original releases and
 *  taking the earliest inlined release date gives Billie Jean 2012, Bohemian
 *  Rhapsody 2001, Sweet Child O' Mine 2018. The release GROUP's
 *  first-release-date is the original release date and gets all three right.
 *
 *  Because request 2 is one batched query rather than one lookup per candidate,
 *  THE COUNT STAYS AT TWO however large the pool -- decision 19a, which exists
 *  because Phase 0 saw 707 candidates for "Like a Rolling Stone" and 842 for
 *  "Stairway to Heaven".
 *
 *  Measured 12 of 13 known-tricky tracks exact, rising to 14 of 14 with the
 *  `dur:` bound below. Baseline was ~6%. See docs/agent_findings.md 2026-08-04.
 * ===========================================================================
 */

import { primaryArtistGuess } from '../../shared/artists.js';
import { DURATION_TOLERANCE_MS, isOfficialOriginalRelease } from '../../shared/year.js';
import type { RecordingCandidate } from '../../shared/types.js';
import type { RateLimitGate } from './rate-limit.js';

const API_ROOT = 'https://musicbrainz.org/ws/2';

/**
 * The search page size, and **not a tuning knob**.
 *
 * 100 is the endpoint's maximum, and it is load-bearing. MusicBrainz ties dozens of
 * candidates at `score: 100` and returns them in no useful order, so the original studio
 * recording is frequently not near the top. Measured 2026-08-04: the same algorithm scores
 * **2 of 13** at `limit=25` and **12 of 13** at `limit=100`. The filters do the work, but
 * only over candidates that were actually returned.
 */
const SEARCH_LIMIT = 100;

/**
 * How many release groups the second request will ask about.
 *
 * A hard bound so the request stays ONE request: everything beyond this is dropped rather
 * than paged. Measured 2026-08-04 at 1-9 release groups for the worst pools; admitting
 * Singles and EPs on 2026-08-11 widened that, but not to anywhere near the cap — it is still
 * a backstop rather than a routine truncation. 50 UUIDs is roughly 1.8 kB of query string,
 * comfortably within limits. Raising it to 100 would still be one request, since
 * `SEARCH_LIMIT` is 100; the `console.warn` below is what says whether that is needed.
 */
const MAX_RELEASE_GROUPS = 50;

/**
 * Truncation order: albums first, then EPs, then singles.
 *
 * This is what makes the cap non-regressive by construction. Before Singles and EPs were
 * eligible, only Albums competed for the 50 slots; ordering them first guarantees that
 * every release group that survived the cap under the old rule still survives it, so the
 * widening can add answers but never take one away. Anything not in the map sorts last.
 */
const RELEASE_GROUP_PRIORITY: Record<string, number> = { album: 0, ep: 1, single: 2 };

/** MusicBrainz answers 503 for rate-limit rejection; one retry, after a pause. */
const RETRY_DELAY_MS = 1_200;

/**
 * How long a permit may be waited for once this lookup has ALREADY SPENT a MusicBrainz
 * request -- every recording rung after the first, the release-group request, and the remix
 * fallback's first rung. The first request of a lookup keeps the gate's own 1.5 s default.
 *
 * ===========================================================================
 *  A REFUSAL IS FREE BEFORE THE FIRST REQUEST AND EXPENSIVE AFTER IT.
 *
 *  The client treats a 429 as free: it re-asks without counting an attempt,
 *  and the re-ask starts the lookup again FROM RUNG 1. Before anything has
 *  been spent that is exactly right, so the first permit keeps the short
 *  default and a refusal there is still `rate-limited` + `retryAfterMs`.
 *  After a rung has come back empty it is a loop: every free retry re-spends
 *  the requests that already missed, for as long as the gate stays busy --
 *  the same loop spike §8 P6 closed for the release-group request. So a
 *  spent lookup waits LONGER for its next permit instead, and if even that
 *  is refused it fails as `upstream-unavailable` with no `retryAfterMs`,
 *  which the client counts against its retry budget.
 * ===========================================================================
 *
 * WHY 3.5 s. The gate spaces permits `MIN_REQUEST_INTERVAL_MS` (1.1 s) apart, so 3.5 s
 * tolerates about three other lookups queued ahead of this one before giving up. The wait is
 * idle time inside the function, far below its 300 s timeout, and it is paid only by a COLD
 * card whose first query missed (or whose second request is due), and only while other
 * lookups are contending for the gate -- an uncontended gate admits immediately.
 *
 * Passed to `acquire(maxWaitMs)` rather than set on the gate: `rate-limit.ts`'s default stays
 * 1.5 s for every first request and for the two stores' gates.
 */
export const SPENT_LOOKUP_MAX_WAIT_MS = 3_500;

export type MusicBrainzErrorCode =
  /** `MUSICBRAINZ_USER_AGENT` is unset. A deployment fault, surfaced at the boundary. */
  | 'not-configured'
  /**
   * The 1 req/s gate is busy before the lookup's FIRST request. Carries `retryAfterMs`. Only
   * ever returned while nothing has been spent -- see `SPENT_LOOKUP_MAX_WAIT_MS`.
   */
  | 'rate-limited'
  /**
   * Network failure, or a non-200 that survived the 503 retry -- on EITHER request. Also a
   * gate still busy after `SPENT_LOOKUP_MAX_WAIT_MS` once any request of the lookup has been
   * spent: before a later recording rung, or before the release-group request (see
   * `attachReleaseGroupDates()`). Never carries `retryAfterMs`. Transient.
   */
  | 'upstream-unavailable'
  /** A 200 whose body was not the shape we parse. NOT transient — the adapter needs updating. */
  | 'unexpected-payload';

/**
 * Which rung of `buildAttempts()`'s query ladder returned the recordings, listed in ladder
 * order.
 *
 * Reported, never acted on: the adapter makes no scoring decisions (see the module header),
 * so it only says which query found the pool. Today NOTHING in production reads it -- its one
 * consumer was `api/_lib/resolve-year.ts`'s `low` cap on a `tokenised` hit, and that rung was
 * removed on 2026-10-01 (see `buildAttempts()`). It stays because it is cheap, because the
 * tests pin which rung answered, and because it is the first thing a measurement of the ladder
 * needs to read.
 */
export type MusicBrainzAttempt = 'duration-bounded' | 'artist-guess' | 'unbounded';

export type MusicBrainzResult =
  | {
      ok: true;
      candidates: RecordingCandidate[];
      requestCount: number;
      /** Absent when every rung came back empty, so the pool is empty too. */
      matchedAttempt?: MusicBrainzAttempt;
    }
  | { ok: false; code: MusicBrainzErrorCode; retryAfterMs?: number };

/** The minimum of `Response` this adapter touches. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<FetchResponseLike>;

export interface MusicBrainzDeps {
  fetchImpl: FetchLike;
  gate: RateLimitGate;
  /**
   * From `MUSICBRAINZ_USER_AGENT`. MusicBrainz blocks anonymous traffic, which is also the
   * reason year lookups must run server-side at all: a browser cannot set this header.
   */
  userAgent: string;
  /** Injectable purely so the 503-retry test does not actually wait 1.2 seconds. */
  sleep?: (ms: number) => Promise<void>;
}

export interface YearLookupInput {
  /** The CLEANED title. Passing a raw remaster-suffixed title returns zero results. */
  title: string;
  /** The raw joined artist string, exactly as Spotify supplied it. */
  artist: string;
  /** `0` or absent disables the `dur:` bound. */
  durationMs?: number;
}

/** How this call relates to the rest of the lookup it belongs to. */
export interface FetchYearCandidatesOptions {
  /**
   * `true` when the SAME lookup has already spent MusicBrainz requests before this call --
   * today only `api/_lib/resolve-year.ts`'s remix fallback, which re-enters this function
   * after the primary title's ladder came back empty. It makes the FIRST rung wait up to
   * `SPENT_LOOKUP_MAX_WAIT_MS` like every later one, and fail as `upstream-unavailable`
   * rather than `rate-limited`, because a free client retry would re-run the primary ladder
   * too. Absent or `false`: this call is the lookup's first, and its first rung keeps the
   * gate's default wait and the free 429.
   */
  requestsAlreadySpent?: boolean;
}

/**
 * Fetch and normalize the candidate pool for one track.
 *
 * Returns a typed error union rather than throwing, matching `api/_lib/spotify-embed.ts`,
 * so the caller's job stays a code-to-status mapping.
 */
export async function fetchYearCandidates(
  input: YearLookupInput,
  deps: MusicBrainzDeps,
  options: FetchYearCandidatesOptions = {},
): Promise<MusicBrainzResult> {
  if (deps.userAgent.trim() === '') return { ok: false, code: 'not-configured' };

  const attempts = buildAttempts(input);
  let requestCount = 0;
  let recordings: unknown[] = [];
  let matchedAttempt: MusicBrainzAttempt | undefined;

  // Attempts run in order and stop at the first one that returns ANYTHING. Each costs a
  // request against the global budget, so each exists only to rescue a total miss.
  for (const { kind, query } of attempts) {
    const spent = options.requestsAlreadySpent === true || requestCount > 0;
    // The first request calls `acquire()` with NO argument, so it keeps whatever default the
    // gate was built with -- not a copy of 1.5 s that could drift from `rate-limit.ts`.
    const permit = spent
      ? await deps.gate.acquire(SPENT_LOOKUP_MAX_WAIT_MS)
      : await deps.gate.acquire();
    if (!permit.ok) {
      if (!spent) {
        // Nothing has been spent, so nothing is half-done: the client's free retry costs
        // MusicBrainz nothing it has not already been asked.
        return { ok: false, code: 'rate-limited', retryAfterMs: permit.retryAfterMs };
      }
      // An earlier rung (or, for the remix fallback, the primary ladder) has been spent and
      // came back empty. `upstream-unavailable` with no `retryAfterMs`, for the reason given
      // at `SPENT_LOOKUP_MAX_WAIT_MS`: a free 429 would re-spend those misses in a loop.
      console.warn(`[musicbrainz] gate busy before the ${kind} rung; failing the lookup`);
      return { ok: false, code: 'upstream-unavailable' };
    }

    const response = await getJson(searchUrl('recording', query), deps);
    requestCount += 1;
    if (!response.ok) return response;

    recordings = asArray(asRecord(response.body)?.['recordings']);
    if (recordings.length > 0) {
      matchedAttempt = kind;
      break;
    }
  }

  const candidates = normalizeRecordings(recordings);
  const enriched = await attachReleaseGroupDates(candidates, deps);
  if (!enriched.ok) return enriched;

  const result: MusicBrainzResult = {
    ok: true,
    candidates: enriched.candidates,
    requestCount: requestCount + enriched.requests,
  };
  if (matchedAttempt !== undefined) result.matchedAttempt = matchedAttempt;
  return result;
}

/**
 * The query ladder, in order. Each rung costs one request and only runs when the previous
 * rung returned zero results -- so a card the first rung finds still costs exactly two
 * requests, however long the ladder grows.
 *
 *   1. `duration-bounded` -- quoted title, full artist, `dur:` bound (only with a duration)
 *   2. `artist-guess`     -- quoted title, the primary-artist guess, no bound (only when the
 *                            guess differs from the full string)
 *   3. `unbounded`        -- quoted title, full artist, no bound
 *
 * ===========================================================================
 *  THE ORDER IS MEASURED, NOT PRINCIPLED (developer's decision, 2026-10-01).
 *
 *  Until 2026-10-01 the ladder was duration-bounded, unbounded, artist-guess,
 *  tokenised. Over 782 real cards (the spike's 542 plus the soundtrack decks),
 *  this order spends 15.7% fewer MusicBrainz requests -- 2.735 -> 2.306 a
 *  card -- because the guess finds 68% of the cards that reach it and the
 *  unbounded full-artist query only 5%. On MusicBrainz alone 774 answers are
 *  unchanged, 3 lost and 5 moved: the 3 lost are all ex-`tokenised` hits that
 *  Deezer already answers, so under the provider vote no shown year changes;
 *  4 of the 5 moves are corrections (Get Lucky x2 2021 -> 2013, Up Where We
 *  Belong 1997 -> 1982, You're The One That I Want 2021 -> 1978) and 1 is
 *  wrong both ways (Somebody That I Used To Know -- an artist-matcher defect,
 *  not a ladder one). See docs/agent_findings.md 2026-10-01.
 * ===========================================================================
 *
 * WHY THE `tokenised` RUNG WAS REMOVED. Every title word quoted and ANDed, it was spike §3.3's
 * most productive rewrite for broken phrases (an emoticon's stray `)`, a reordered or
 * re-apostrophed title). In the measured run it answered 5 cards, all `low`, and every one of
 * them was a year Deezer already had -- so under the provider vote it changed no shown year
 * while costing a request on every total miss. Inside the remix fallback it rescued 0. With it
 * went the `low` cap `api/_lib/resolve-year.ts` applied to its hits. The captured track it was
 * built for is now pinned as a miss (`OLVIDARNOS` in `__fixtures__/musicbrainz-payloads.ts`).
 */
function buildAttempts(input: YearLookupInput): { kind: MusicBrainzAttempt; query: string }[] {
  const title = escapePhrase(input.title);
  const artist = escapePhrase(input.artist);
  const base = `recording:"${title}" AND artist:"${artist}"`;
  const durationBound =
    typeof input.durationMs === 'number' && input.durationMs > DURATION_TOLERANCE_MS
      ? `dur:[${input.durationMs - DURATION_TOLERANCE_MS} TO ${input.durationMs + DURATION_TOLERANCE_MS}]`
      : undefined;

  const attempts: { kind: MusicBrainzAttempt; query: string }[] = [];

  // 1. Duration-bounded. Almost always the only rung that runs, and the reason the whole
  //    pipeline is accurate: `dur:` collapses the pool below the 100-result page limit, so
  //    the original studio recording is actually IN the results rather than ranked out of
  //    them. "Stairway to Heaven" is 842 candidates unbounded and 31 bounded, and it only
  //    resolves correctly in the second case.
  if (durationBound !== undefined) {
    attempts.push({ kind: 'duration-bounded', query: `${base} AND ${durationBound}` });
  }

  // 2. The lossy single-artist guess, SECOND -- ahead of the unbounded full-artist query, and
  //    behind the duration-bounded one. Spotify joins collaborators with ", " and MusicBrainz
  //    with a joinphrase ("Cano & Justin Quiles", "Daft Punk feat. Pharrell Williams"), so a
  //    multi-artist phrase that missed WITH the bound rarely matches WITHOUT it either: of the
  //    cards that reach each query, the guess finds 68% and the unbounded full string 5%. And
  //    when the full string does match unbounded, it is often an unofficial remix credited in
  //    Spotify's own comma form -- which is how Get Lucky and You're The One That I Want used
  //    to read 2021.
  //
  //    THE KNOWN COST of putting it here: an artist whose OWN name contains a comma
  //    (`shared/artists.ts`) is now queried under a truncation of that name before the full
  //    string is asked without a bound. A probe of 13 comma-in-name artists run WITH NO
  //    DURATION -- so query 1 never ran, the worst case -- found one wrong year: "Teach Your
  //    Children" (Crosby, Stills, Nash & Young) 1970 -> 1969, because the "Crosby" guess pool
  //    holds a Crosby, Stills & Nash recording that the exact artist matcher admits. It is
  //    reached only when query 1 misses (or there is no duration). The feared "Earth, Wind &
  //    Fire" shape -- a guess pool that is non-empty yet scores no year, stealing the stop from
  //    a full-string query that would have answered -- happened 0 times in 782.
  //
  //    Still UNBOUNDED, deliberately: the duration was already asked about at rung 1, and a
  //    `dur:`-bounded guess, measured in the same run, lost 6 answers to this order's 3 and
  //    moved 9 to this order's 5 -- including the one real steal of the run, The Imperial
  //    March, whose bounded guess pool was non-empty and scored no year. `pickBestRecording()`
  //    still filters the pool against the FULL artist, whichever query found it.
  const guess = primaryArtistGuess(input.artist);
  if (guess !== '' && guess !== input.artist) {
    attempts.push({
      kind: 'artist-guess',
      query: `recording:"${title}" AND artist:"${escapePhrase(guess)}"`,
    });
  }

  // 3. Unbounded full artist, LAST: for a track whose Spotify duration disagrees with every
  //    MusicBrainz length (a radio edit in the playlist, say), for a track with no duration at
  //    all, and for a single-artist track, which has no guess -- for which this is rung 2.
  attempts.push({ kind: 'unbounded', query: base });

  return attempts;
}

/**
 * The second request: one batched release-group search for every candidate the top scoring
 * rung would accept.
 *
 * Skipped entirely when nothing is eligible — a track heading for a lower rung should not
 * spend a request on it.
 *
 * ===========================================================================
 *  A FAILED SECOND REQUEST IS A FAILED LOOKUP. IT DOES NOT DEGRADE.
 *
 *  Until 2026-09-30 a busy gate or a failed request here handed the candidates
 *  back un-enriched, so the `official-release` rung found nothing to date and
 *  the ladder fell through to `studio-release` or `unfiltered` -- a `low` year
 *  drawn from inlined REISSUE dates, on a card that would have been `high` a
 *  second later. That was a precision leak dressed as resilience ("losing
 *  accuracy beats discarding a request already spent"), and it was CACHED for
 *  seven days as though it were the track's real answer. Spike §8 P6; one case
 *  in the spike's 542-track run.
 *
 *  So both branches now fail the lookup, and every layer above already treats
 *  `upstream-unavailable` as transient: `resolve-year.ts` caches nothing,
 *  `/api/year` answers 502, and the client retries later. The request already
 *  spent IS discarded -- that is the price, and it buys never caching a
 *  degraded year. See docs/plans/plan.year-fetch-rework-mb-fixes.md step 5.
 * ===========================================================================
 */
async function attachReleaseGroupDates(
  candidates: RecordingCandidate[],
  deps: MusicBrainzDeps,
): Promise<
  | { ok: true; candidates: RecordingCandidate[]; requests: number }
  | { ok: false; code: MusicBrainzErrorCode }
> {
  const eligible = candidates.filter(
    (candidate) => isOfficialOriginalRelease(candidate) && candidate.releaseGroupId,
  );

  // Sorted BEFORE the dedupe so the priority decides which copy of a repeated id is kept
  // first, and `Set` insertion order carries that ordering through to the cap below.
  const ids = [
    ...new Set(
      [...eligible]
        .sort((a, b) => releaseGroupPriority(a) - releaseGroupPriority(b))
        .map((candidate) => candidate.releaseGroupId as string),
    ),
  ];

  if (ids.length === 0) return { ok: true, candidates, requests: 0 };

  const capped = ids.slice(0, MAX_RELEASE_GROUPS);
  if (capped.length < ids.length) {
    // Never truncate silently: a dropped release group could have been the earliest one.
    console.warn(
      `[musicbrainz] ${ids.length} eligible release groups, asking about the first ${capped.length}`,
    );
  }

  // Always a spent lookup by now -- at least one recording rung has run -- so the longer wait.
  const permit = await deps.gate.acquire(SPENT_LOOKUP_MAX_WAIT_MS);
  if (!permit.ok) {
    // `upstream-unavailable`, NOT `rate-limited`, and deliberately with no `retryAfterMs`.
    // The client treats a 429 as free -- it re-asks without counting an attempt -- which is
    // right for a refusal that cost nothing and wrong here: request 1 has been spent, and a
    // free retry would spend it again, in a loop, for as long as the gate stays busy. A
    // transient failure is counted, so the client's retry budget bounds it. Reached only
    // after `SPENT_LOOKUP_MAX_WAIT_MS` of waiting, not the gate's 1.5 s default.
    console.warn('[musicbrainz] gate busy before the release-group request; failing the lookup');
    return { ok: false, code: 'upstream-unavailable' };
  }

  const response = await getJson(searchUrl('release-group', `rgid:(${capped.join(' OR ')})`), deps);
  if (!response.ok) {
    // `getJson` has already spent its one 503 retry. Its code passes through unchanged:
    // `upstream-unavailable` for a network failure or a non-200, `unexpected-payload` for a
    // 200 that was not JSON. The second is not transient, and must not be dressed up as if
    // it were.
    console.warn(
      `[musicbrainz] release-group request failed (${response.code}); failing the lookup`,
    );
    return { ok: false, code: response.code };
  }

  const dates = new Map<string, string>();
  for (const entry of asArray(asRecord(response.body)?.['release-groups'])) {
    const group = asRecord(entry);
    const id = group?.['id'];
    const date = group?.['first-release-date'];
    if (typeof id === 'string' && typeof date === 'string' && date !== '') dates.set(id, date);
  }

  return {
    ok: true,
    candidates: candidates.map((candidate) => {
      const date = candidate.releaseGroupId ? dates.get(candidate.releaseGroupId) : undefined;
      return date ? { ...candidate, releaseGroupFirstReleaseDate: date } : candidate;
    }),
    requests: 1,
  };
}

/**
 * Flatten recording → releases → release-group into one candidate per (recording, release).
 *
 * A recording on five releases becomes five candidates. That is deliberate: `status` is a
 * property of the release and the types are properties of the release group, so flattening
 * is what lets a single predicate express the filter.
 */
function normalizeRecordings(recordings: readonly unknown[]): RecordingCandidate[] {
  const candidates: RecordingCandidate[] = [];

  for (const entry of recordings) {
    const recording = asRecord(entry);
    if (!recording) continue;

    const recordingId = recording['id'];
    if (typeof recordingId !== 'string') continue;

    const base: RecordingCandidate = {
      recordingId,
      title: typeof recording['title'] === 'string' ? recording['title'] : '',
      artistCredit: joinArtistCredit(recording['artist-credit']),
      releaseGroupSecondaryTypes: [],
    };

    const length = recording['length'];
    if (typeof length === 'number' && Number.isFinite(length) && length > 0) base.lengthMs = length;

    const firstRelease = recording['first-release-date'];
    if (typeof firstRelease === 'string' && firstRelease !== '') {
      base.recordingFirstReleaseDate = firstRelease;
    }

    const releases = asArray(recording['releases']);
    // A recording with no inlined release is still a relaxed-tier candidate: its own
    // first-release-date is the signal that tier uses.
    if (releases.length === 0) {
      candidates.push(base);
      continue;
    }

    for (const releaseEntry of releases) {
      const release = asRecord(releaseEntry);
      if (!release) continue;

      const group = asRecord(release['release-group']);
      const candidate: RecordingCandidate = {
        ...base,
        releaseGroupSecondaryTypes: asArray(group?.['secondary-types']).filter(
          (type): type is string => typeof type === 'string',
        ),
      };

      if (typeof group?.['id'] === 'string') candidate.releaseGroupId = group['id'];
      if (typeof group?.['primary-type'] === 'string') {
        candidate.releaseGroupPrimaryType = group['primary-type'];
      }
      if (typeof release['status'] === 'string') candidate.releaseStatus = release['status'];
      if (typeof release['date'] === 'string' && release['date'] !== '') {
        candidate.releaseDate = release['date'];
      }

      candidates.push(candidate);
    }
  }

  return candidates;
}

function releaseGroupPriority(candidate: RecordingCandidate): number {
  const type = (candidate.releaseGroupPrimaryType ?? '').toLowerCase();
  return RELEASE_GROUP_PRIORITY[type] ?? Object.keys(RELEASE_GROUP_PRIORITY).length;
}

/**
 * Rebuild the credit string MusicBrainz displays, honouring `joinphrase`.
 *
 * Joining with a fixed separator instead would turn "Bob Marley & The Wailers" into
 * "Bob Marley, The Wailers" and stop it matching the string Spotify supplies.
 */
function joinArtistCredit(value: unknown): string {
  return asArray(value)
    .map((entry) => {
      const part = asRecord(entry);
      const name = part?.['name'];
      const join = part?.['joinphrase'];
      return (typeof name === 'string' ? name : '') + (typeof join === 'string' ? join : '');
    })
    .join('');
}

function searchUrl(entity: 'recording' | 'release-group', query: string): string {
  return `${API_ROOT}/${entity}?query=${encodeURIComponent(query)}&fmt=json&limit=${SEARCH_LIMIT}`;
}

/**
 * Neutralise the two characters that would break a quoted Lucene phrase.
 *
 * `cleanTrackTitle()` already does this for titles, but the ARTIST string arrives raw from
 * Spotify and never passes through it, so the escape has to live here too.
 */
function escapePhrase(value: string): string {
  return value.replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

type JsonResponse = { ok: true; body: unknown } | { ok: false; code: MusicBrainzErrorCode };

/**
 * One GET, with the required `User-Agent`, retried exactly once on a 503.
 *
 * 503 is how MusicBrainz says "you are going too fast" — and one was observed in ~40 paced
 * requests on 2026-08-04, so the retry is a measured need rather than defensive coding.
 * 400 and 404 are NOT retried: they are answers, not congestion.
 */
async function getJson(url: string, deps: MusicBrainzDeps): Promise<JsonResponse> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: FetchResponseLike;
    try {
      response = await deps.fetchImpl(url, {
        headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' },
      });
    } catch {
      return { ok: false, code: 'upstream-unavailable' };
    }

    if (response.ok) {
      try {
        return { ok: true, body: await response.json() };
      } catch {
        // A 200 that is not JSON means the endpoint changed shape. Someone has to look at
        // it, so it stays distinct from the transient code.
        return { ok: false, code: 'unexpected-payload' };
      }
    }

    if (response.status === 503 && attempt === 0) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    return { ok: false, code: 'upstream-unavailable' };
  }

  return { ok: false, code: 'upstream-unavailable' };
}

/** Narrow an unknown to an indexable object, excluding arrays and `null`. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
