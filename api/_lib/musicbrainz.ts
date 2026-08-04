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
 *  is nearly always a reissue: filtering to official studio albums and taking
 *  the earliest inlined release date gives Billie Jean 2012, Bohemian Rhapsody
 *  2001, Sweet Child O' Mine 2018. The release GROUP's first-release-date is
 *  the album's original release date and gets all three right.
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
import { DURATION_TOLERANCE_MS, isOfficialStudioAlbum } from '../../shared/year.js';
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
 * than paged. In practice the strict filter leaves 1-9 release groups even for the worst
 * pools, so the cap has never been reached on any measured track — it is a backstop, not a
 * routine truncation. 50 UUIDs is roughly 1.8 kB of query string, comfortably within limits.
 */
const MAX_RELEASE_GROUPS = 50;

/** MusicBrainz answers 503 for rate-limit rejection; one retry, after a pause. */
const RETRY_DELAY_MS = 1_200;

export type MusicBrainzErrorCode =
  /** `MUSICBRAINZ_USER_AGENT` is unset. A deployment fault, surfaced at the boundary. */
  | 'not-configured'
  /** The 1 req/s gate is busy. Carries `retryAfterMs`. */
  | 'rate-limited'
  /** Network failure, or a non-200 that survived the 503 retry. Transient. */
  | 'upstream-unavailable'
  /** A 200 whose body was not the shape we parse. NOT transient — the adapter needs updating. */
  | 'unexpected-payload';

export type MusicBrainzResult =
  | { ok: true; candidates: RecordingCandidate[]; requestCount: number }
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

/**
 * Fetch and normalize the candidate pool for one track.
 *
 * Returns a typed error union rather than throwing, matching `api/_lib/spotify-embed.ts`,
 * so the caller's job stays a code-to-status mapping.
 */
export async function fetchYearCandidates(
  input: YearLookupInput,
  deps: MusicBrainzDeps,
): Promise<MusicBrainzResult> {
  if (deps.userAgent.trim() === '') return { ok: false, code: 'not-configured' };

  const attempts = buildAttempts(input);
  let requestCount = 0;
  let recordings: unknown[] = [];

  // Attempts run in order and stop at the first one that returns ANYTHING. Each costs a
  // request against the global budget, so each exists only to rescue a total miss.
  for (const query of attempts) {
    const permit = await deps.gate.acquire();
    if (!permit.ok) {
      // Only reachable before any request has been made, because a later attempt only runs
      // when the earlier one returned zero results — so nothing is half-done here.
      return { ok: false, code: 'rate-limited', retryAfterMs: permit.retryAfterMs };
    }

    const response = await getJson(searchUrl('recording', query), deps);
    requestCount += 1;
    if (!response.ok) return response;

    recordings = asArray(asRecord(response.body)?.['recordings']);
    if (recordings.length > 0) break;
  }

  const candidates = normalizeRecordings(recordings);
  const enriched = await attachReleaseGroupDates(candidates, deps);

  return {
    ok: true,
    candidates: enriched.candidates,
    requestCount: requestCount + enriched.requests,
  };
}

/**
 * The query ladder, in order. Each rung costs one request and only runs when the previous
 * rung returned zero results.
 */
function buildAttempts(input: YearLookupInput): string[] {
  const title = escapePhrase(input.title);
  const artist = escapePhrase(input.artist);
  const base = `recording:"${title}" AND artist:"${artist}"`;

  const attempts: string[] = [];

  // 1. Duration-bounded. Almost always the only rung that runs, and the reason the whole
  //    pipeline is accurate: `dur:` collapses the pool below the 100-result page limit, so
  //    the original studio recording is actually IN the results rather than ranked out of
  //    them. "Stairway to Heaven" is 842 candidates unbounded and 31 bounded, and it only
  //    resolves correctly in the second case.
  if (typeof input.durationMs === 'number' && input.durationMs > DURATION_TOLERANCE_MS) {
    const low = input.durationMs - DURATION_TOLERANCE_MS;
    const high = input.durationMs + DURATION_TOLERANCE_MS;
    attempts.push(`${base} AND dur:[${low} TO ${high}]`);
  }

  // 2. Unbounded, for a track whose Spotify duration disagrees with every MusicBrainz
  //    length (a radio edit in the playlist, say), and for tracks with no duration at all.
  attempts.push(base);

  // 3. The lossy single-artist guess, LAST — which is what makes its lossiness harmless.
  //    "Earth, Wind & Fire" matches on the full string at rung 2 and never reaches a guess
  //    that would truncate it to "Earth". Reversing this order makes the guess a source of
  //    wrong years (see `shared/artists.ts`).
  const guess = primaryArtistGuess(input.artist);
  if (guess !== '' && guess !== input.artist) {
    attempts.push(`recording:"${title}" AND artist:"${escapePhrase(guess)}"`);
  }

  return attempts;
}

/**
 * The second request: one batched release-group search for every strict-eligible candidate.
 *
 * Skipped entirely when nothing is eligible — a track heading for the relaxed tier should
 * not spend a request on it. If the gate is busy this DEGRADES rather than failing: the
 * candidates come back un-enriched, the strict pass finds nothing to date, and the caller
 * falls through to the relaxed tier. Losing accuracy beats discarding a request already
 * spent.
 */
async function attachReleaseGroupDates(
  candidates: RecordingCandidate[],
  deps: MusicBrainzDeps,
): Promise<{ candidates: RecordingCandidate[]; requests: number }> {
  const ids = [
    ...new Set(
      candidates
        .filter((candidate) => isOfficialStudioAlbum(candidate) && candidate.releaseGroupId)
        .map((candidate) => candidate.releaseGroupId as string),
    ),
  ];

  if (ids.length === 0) return { candidates, requests: 0 };

  const capped = ids.slice(0, MAX_RELEASE_GROUPS);
  if (capped.length < ids.length) {
    // Never truncate silently: a dropped release group could have been the earliest one.
    console.warn(
      `[musicbrainz] ${ids.length} eligible release groups, asking about the first ${capped.length}`,
    );
  }

  const permit = await deps.gate.acquire();
  if (!permit.ok) {
    console.warn(
      '[musicbrainz] gate busy before the release-group request; falling back to relaxed',
    );
    return { candidates, requests: 0 };
  }

  const response = await getJson(searchUrl('release-group', `rgid:(${capped.join(' OR ')})`), deps);
  if (!response.ok) {
    console.warn('[musicbrainz] release-group request failed; falling back to relaxed');
    return { candidates, requests: 1 };
  }

  const dates = new Map<string, string>();
  for (const entry of asArray(asRecord(response.body)?.['release-groups'])) {
    const group = asRecord(entry);
    const id = group?.['id'];
    const date = group?.['first-release-date'];
    if (typeof id === 'string' && typeof date === 'string' && date !== '') dates.set(id, date);
  }

  return {
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
