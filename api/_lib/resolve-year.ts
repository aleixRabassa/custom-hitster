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

import {
  cleanTrackTitle,
  pickBestRecording,
  stripRemixSuffix,
  yearCacheKey,
} from '../../shared/year.js';
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

  // ---- Third tier: ask about the underlying song of a remix --------------------
  if (result.year === null) {
    result = (await resolveViaRemixFallback(cleaned.title, input, deps)) ?? result;
  }

  // Written in ALL THREE cases, negatives included (decision 9). A classic-rock miss costs a
  // full two-request round trip to re-derive and the next person with the same playlist will
  // ask for the same track — with a shorter TTL, since MusicBrainz data improves over time.
  await deps.cache.set(key, result, ttlFor(result));

  return { ok: true, result: present(result, cleaned, false) };
}

/**
 * The remix fallback: when the title as given yields no year, drop a trailing remix segment
 * and ask about the underlying song instead.
 *
 * ===========================================================================
 *  WHY THIS IS WORTH TWO MORE REQUESTS AGAINST A GLOBAL 1 req/s BUDGET.
 *
 *  Measured 2026-08-05 on a real 42-track playlist: 15 cards resolved to NO
 *  year, and five of them carried an unstripped "- Remix". It was the single
 *  largest identifiable cause of a blank card, and this is the cheapest
 *  available fix for it.
 *
 *  The cost is bounded to exactly the tracks that were about to be blank
 *  anyway, because it runs ONLY after both the strict and relaxed passes have
 *  already failed. Nothing that resolves normally pays for it, and the result
 *  is cached under the ORIGINAL key like any other, so the second person to
 *  play that playlist pays nothing at all.
 * ===========================================================================
 *
 * TWO DELIBERATE CHOICES:
 *
 * 1. **`durationMs` is dropped.** A remix is not the same length as the song it remixes, so
 *    bounding the query by the remix's duration would exclude the very recording being looked
 *    for -- and the same value is passed to the scorer, where it would mis-rank the survivors.
 *    That makes this query unbounded, which `api/_lib/musicbrainz.ts` rung 2 already handles.
 *
 * 2. **A hit is always downgraded to `low`.** Even when the strict pass matched, the title had
 *    to be REWRITTEN to find it, which is exactly the "shown with an unconfirmed marker"
 *    situation `low` exists for -- and a remix genuinely can be a different song rather than a
 *    new take on one. Reporting `high` here would put a year on the card with no signal that a
 *    guess was involved.
 *
 * Returns `undefined` when there is nothing to try, or when trying it found nothing: the
 * caller then keeps the null result from the primary passes. An upstream FAILURE here is
 * swallowed for the same reason -- a definite "no year" must not turn into a 502 that makes
 * the client retry a card whose answer is already known.
 */
async function resolveViaRemixFallback(
  cleanedTitle: string,
  input: ResolveYearInput,
  deps: ResolveYearDeps,
): Promise<YearResult | undefined> {
  const baseTitle = stripRemixSuffix(cleanedTitle);
  if (baseTitle === undefined) return undefined;

  const fallback = await fetchYearCandidates({ title: baseTitle, artist: input.artist }, deps);
  if (!fallback.ok) return undefined;

  const scoringInput = { artist: input.artist };

  let result: YearResult = pickBestRecording(fallback.candidates, {
    ...scoringInput,
    mode: 'strict',
  });

  if (result.year === null) {
    result = pickBestRecording(fallback.candidates, { ...scoringInput, mode: 'relaxed' });
  }

  if (result.year === null) return undefined;

  return { year: result.year, confidence: 'low', source: result.source, viaTitle: baseTitle };
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

  if (result.year === null) {
    body.reason = result.reason;
  } else {
    body.source = result.source;
    // Carried through the cache too: `viaTitle` lives on the stored `YearResult`, so a cache
    // hit reports the rewritten title exactly as the original miss did.
    if (result.viaTitle !== undefined) body.viaTitle = result.viaTitle;
  }

  return body;
}
