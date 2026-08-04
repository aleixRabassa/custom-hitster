/**
 * The year lookup, orchestrated: clean the title, read the cache, gate the network, run the
 * strict pass, fall back to the relaxed pass, cache whatever came out.
 *
 * This lives beside the adapter rather than inside `api/year.ts` for the reason the plan
 * gives for keeping handlers thin — logic that grows in a handler is logic that cannot be
 * tested. Everything it depends on is injected, so the ordering guarantees below are
 * assertions in `api/_lib/resolve-year.test.ts` instead of prose. `api/year.ts` stays what
 * it should be: a method guard, input validation, and a status mapping.
 */

import { cleanTrackTitle, pickBestRecording, yearCacheKey } from '../../shared/year.js';
import { ttlFor } from './cache.js';
import { fetchYearCandidates } from './musicbrainz.js';
import type { YearCache } from './cache.js';
import type { MusicBrainzDeps, MusicBrainzErrorCode } from './musicbrainz.js';
import type { YearLookupResult, YearResult } from '../../shared/types.js';

export interface ResolveYearInput {
  /** The RAW title, exactly as Spotify supplied it. Cleaning happens here. */
  title: string;
  artist: string;
  durationMs?: number;
}

export interface ResolveYearDeps extends MusicBrainzDeps {
  cache: YearCache;
}

export type ResolveYearOutcome =
  | { ok: true; result: YearLookupResult }
  | { ok: false; code: MusicBrainzErrorCode; retryAfterMs?: number; cleanedTitle: string };

export async function resolveYear(
  input: ResolveYearInput,
  deps: ResolveYearDeps,
): Promise<ResolveYearOutcome> {
  const cleaned = cleanTrackTitle(input.title);

  // ---- Configuration is checked BEFORE the cache ------------------------------
  // The adapter guards this too, but a check there alone is reached only on a cache MISS,
  // so a deployment with no `MUSICBRAINZ_USER_AGENT` would serve warm tracks happily and
  // 500 on cold ones. That reads as an intermittent fault, which is precisely the
  // confusing-to-diagnose failure decision 17 exists to prevent. A misconfigured
  // deployment can resolve nothing new, so it should say so on every request.
  if (deps.userAgent.trim() === '') {
    return { ok: false, code: 'not-configured', cleanedTitle: cleaned.title };
  }

  const key = yearCacheKey(input.artist, cleaned.title);

  // ---- The cache comes FIRST, before the gate ---------------------------------
  // A cache hit must cost nothing and wait for nothing (decision 11). Once a playlist has
  // been played once, its whole deck should resolve at cache speed; gating hits would make
  // the common case as slow as the cold one for no benefit, since nothing leaves the
  // building. This ordering is the entire reason the gate is not simply the first line.
  const cached = await deps.cache.get(key);
  if (cached) {
    return { ok: true, result: present(cached, cleaned, true) };
  }

  const candidates = await fetchYearCandidates(
    { title: cleaned.title, artist: input.artist, durationMs: input.durationMs },
    deps,
  );

  if (!candidates.ok) {
    // Nothing is cached on an upstream failure: a 502 is a statement about MusicBrainz's
    // availability right now, not about the track, and caching it would poison the key for
    // a day for no reason.
    const failure: ResolveYearOutcome = {
      ok: false,
      code: candidates.code,
      cleanedTitle: cleaned.title,
    };
    if (candidates.retryAfterMs !== undefined) failure.retryAfterMs = candidates.retryAfterMs;
    return failure;
  }

  // ---- Tiered resolution: strict, then relaxed, then an explicit null ----------
  const scoringInput = { artist: input.artist, durationMs: input.durationMs };

  let result: YearResult = pickBestRecording(candidates.candidates, {
    ...scoringInput,
    mode: 'strict',
  });

  if (result.year === null) {
    result = pickBestRecording(candidates.candidates, { ...scoringInput, mode: 'relaxed' });
  }

  // Written in ALL THREE cases, negatives included (decision 9). A classic-rock miss costs a
  // full two-request round trip to re-derive and the next person with the same playlist will
  // ask for the same track — with a shorter TTL, since MusicBrainz data improves over time.
  await deps.cache.set(key, result, ttlFor(result));

  return { ok: true, result: present(result, cleaned, false) };
}

/** Shape a `YearResult` into the response body, adding what only the request knows. */
function present(
  result: YearResult,
  cleaned: { title: string; stripped: YearLookupResult['stripped'] },
  cached: boolean,
): YearLookupResult {
  const body: YearLookupResult = {
    year: result.year,
    confidence: result.confidence,
    cached,
    // Returned deliberately: when a year looks wrong, the first question is always what was
    // actually queried, and Phase 6's reveal-side year UI can show it (decision 18).
    cleanedTitle: cleaned.title,
    stripped: cleaned.stripped,
  };

  if (result.year === null) body.reason = result.reason;
  else body.source = result.source;

  return body;
}
