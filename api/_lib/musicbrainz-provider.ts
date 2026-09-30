/**
 * MusicBrainz as one `ProviderLookup` among three (plan.year-fetch-rework-server.md step 7).
 *
 * BINDING, not decision. This module decides nothing about a year: `resolveYear()` in
 * `api/_lib/resolve-year.ts` still owns the whole MusicBrainz lookup -- cleaning, the
 * cache-before-gate ordering, the tier ladder, the remix fallback and the `mbyear:` entry --
 * and `shared/year-providers.ts` decides what its answer is worth in the vote. All this file
 * does is translate one `ResolveYearOutcome` into one `ProviderOutcome`.
 *
 * ===========================================================================
 *  `resolveYear()` IS WRAPPED WHOLE, WITH THE RAW TITLE. DO NOT UNPICK IT.
 *
 *  It cleans the title itself and owns the `mbyear:` cache entry, so handing it
 *  a pre-cleaned title (or re-implementing its steps here) would be a second
 *  copy of logic that `resolve-year.test.ts` pins -- and the stage-less legacy
 *  `/api/year` path still calls it directly. That test file is untouched by
 *  this plan, which is the proof its behaviour did not change.
 * ===========================================================================
 *
 * AND IT IS NEVER WRAPPED IN THE STORE ANSWER CACHE (`withAnswerCache` in `cache.ts`).
 * MusicBrainz already caches under `mbyear:<version>:…`, with confidence-tiered TTLs and a
 * schema version that plan 1 bumped to `v5`; a `yearprov:musicbrainz:` key beside it would be
 * a second, independently-expiring copy of the same answer. The driver reads the `mbyear:`
 * key directly in its batched read instead (`api/_lib/year-pipeline.ts`).
 *
 * The outcome mapping:
 *
 * | `resolveYear()`          | `ProviderOutcome`                                            |
 * | ------------------------ | ------------------------------------------------------------ |
 * | `ok: true`               | `answer`, with its tier confidence, `source` and `viaTitle`  |
 * | `upstream-unavailable`   | `failed` (transient: never a final "no year")                |
 * | `unexpected-payload`     | `failed`                                                     |
 * | `rate-limited`           | `busy`, carrying the gate's `retryAfterMs`                   |
 * | `not-configured`         | `skipped`, naming `MUSICBRAINZ_USER_AGENT` -- NOT a 500      |
 *
 * The last row is the developer's decision (2026-09-30): every provider is skippable with a
 * warning, MusicBrainz included, and only "every provider failed" is loud. The stage-less
 * legacy path keeps its 500 on purpose -- see `api/year.ts`.
 */

import { resolveYear } from './resolve-year.js';
import { MIN_REQUEST_INTERVAL_MS } from './rate-limit.js';
import type { YearCache } from './cache.js';
import type { FetchLike } from './musicbrainz.js';
import type { ProviderLookup, ProviderOutcome } from './provider-lookup.js';
import type { RateLimitGate } from './rate-limit.js';
import type { MusicBrainzYearSource, ProviderAnswer, YearConfidence } from '../../shared/types.js';

/** The variable a skipped MusicBrainz names. Its VALUE is never logged anywhere. */
export const MUSICBRAINZ_USER_AGENT_VARIABLE = 'MUSICBRAINZ_USER_AGENT';

export interface MusicBrainzProviderDeps {
  cache: YearCache;
  gate: RateLimitGate;
  fetchImpl: FetchLike;
  /**
   * Read on EVERY lookup, not once at cold start, for the same reason `api/year.ts` has
   * always read it per request: a variable set (or unset) on a live deployment should be
   * reported on the next call, not after the next cold start.
   */
  readUserAgent: () => string;
  /** Injectable so a test of the 503 retry does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The fields of a MusicBrainz year that the vote reads, in either of the two shapes that
 * carry them: the cached `YearResult` (read straight out of `mbyear:` by the driver's batched
 * read) and the `MusicBrainzLookupResult` body `resolveYear()` returns.
 */
export interface MusicBrainzYearFields {
  year: number | null;
  confidence: YearConfidence;
  source?: MusicBrainzYearSource;
  viaTitle?: string;
}

/**
 * ONE mapping from a MusicBrainz year to its `ProviderAnswer`, shared by this adapter and by
 * the driver's `mbyear:` hit path. Two copies would drift, and a drift here is invisible: it
 * reads as a vote that is subtly different on a warm card than on a cold one.
 *
 * Returns `undefined` for an inconsistent shape -- a year without a source, a `none` with a
 * year, a `high` with no year. `resolveYear()` never produces one; the guard exists because
 * the cached value crossed a JSON boundary, and a wrong year is worse than a missing one.
 */
export function musicBrainzAnswerFrom(fields: MusicBrainzYearFields): ProviderAnswer | undefined {
  if (fields.year === null) {
    return fields.confidence === 'none'
      ? { provider: 'musicbrainz', year: null, confidence: 'none' }
      : undefined;
  }

  if (fields.confidence === 'none' || fields.source === undefined) return undefined;

  const answer: ProviderAnswer = {
    provider: 'musicbrainz',
    year: fields.year,
    confidence: fields.confidence,
    source: fields.source,
  };
  // Carried only when present, so an answer that never had a rewrite compares equal to one
  // built by hand in a test.
  if (fields.viaTitle !== undefined) answer.viaTitle = fields.viaTitle;
  return answer;
}

export function createMusicBrainzLookup(deps: MusicBrainzProviderDeps): ProviderLookup {
  return {
    id: 'musicbrainz',

    async lookup(input): Promise<ProviderOutcome> {
      const userAgent = deps.readUserAgent();

      // Checked here as well as inside `resolveYear()` so the skip is explicit rather than an
      // inference from an error code -- and so the missing VARIABLE is what the outcome
      // carries. `resolveYear()` would answer `not-configured` too; that branch is mapped
      // below as a backstop.
      if (userAgent.trim() === '') return notConfigured();

      // `resolveYear()` reports whether it hit its cache, not how many requests it spent, and
      // the contract wants the count. Counting at the fetch seam gets it without widening
      // `resolveYear()`'s return value, which `resolve-year.test.ts` pins with `toEqual`.
      let requestCount = 0;
      const countingFetch: FetchLike = (url, init) => {
        requestCount += 1;
        return deps.fetchImpl(url, init);
      };

      // `input.signal` is NOT passed on: MusicBrainz's `FetchLike` takes no signal, and
      // threading one through would change the adapter this plan promised not to touch. The
      // driver aborts nothing mid-stage today, so nothing is lost.
      const outcome = await resolveYear(
        { title: input.rawTitle, artist: input.rawArtist, durationMs: input.durationMs },
        {
          cache: deps.cache,
          gate: deps.gate,
          fetchImpl: countingFetch,
          userAgent,
          ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
        },
      );

      if (!outcome.ok) {
        switch (outcome.code) {
          case 'not-configured':
            return notConfigured();
          case 'rate-limited':
            // `retryAfterMs` is optional on the failure arm. Every path that produces
            // `rate-limited` today sets it from the gate; the fallback is the gate's own
            // interval, which is the soonest a retry could possibly succeed.
            return { kind: 'busy', retryAfterMs: outcome.retryAfterMs ?? MIN_REQUEST_INTERVAL_MS };
          case 'upstream-unavailable':
          case 'unexpected-payload':
            return { kind: 'failed', code: outcome.code };
        }
      }

      const answer = musicBrainzAnswerFrom(outcome.result);
      // Unreachable for a result `resolveYear()` built; mapped to a failure rather than thrown,
      // because the contract says an adapter never throws.
      if (answer === undefined) return { kind: 'failed', code: 'unexpected-payload' };

      return { kind: 'answer', answer, cached: outcome.result.cached, requestCount };
    },
  };
}

function notConfigured(): ProviderOutcome {
  return {
    kind: 'skipped',
    reason: 'not-configured',
    missingVariable: MUSICBRAINZ_USER_AGENT_VARIABLE,
  };
}
