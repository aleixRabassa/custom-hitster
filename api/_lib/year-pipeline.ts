/**
 * The driver: one `/api/year?stage=` call, from the batched cache read to the response body
 * (plan.year-fetch-rework-server.md step 10).
 *
 * BINDING, and deliberately thin. Every rule it applies is somebody else's: WHICH providers
 * to ask next is `nextFrontier()` and WHAT their answers mean is `decideYear()`, both pure in
 * `shared/year-providers.ts`; HOW a provider is asked is its adapter behind the
 * `ProviderLookup` contract; WHERE answers live is `api/_lib/cache.ts`. What is left here is
 * the part no pure function can do -- run a frontier concurrently, merge the four kinds of
 * outcome, and turn "what happened this call" into finality. If a rule starts to grow here,
 * it belongs in `shared/year-providers.ts`, where it can be node-tested without fakes.
 *
 * THE SHAPE OF ONE CALL:
 *
 * 1. **Read first.** ONE batched read of every provider's cached answer, the MusicBrainz
 *    `mbyear:` entry included (the same `yearCacheKey()` `resolveYear()` writes under). On an
 *    `mbyear:` hit the MusicBrainz provider is not called at all; on a miss `resolveYear()`
 *    runs and repeats its own check, so a cold card pays one extra GET and a warm card costs
 *    exactly one Redis command. If the cached answers already confirm, or no provider is left
 *    to ask, the call ends here without a provider request.
 * 2. **Ask.** Loop: `nextFrontier()`, run that frontier with `Promise.all`, merge. Stops at a
 *    confirmation or when the stage has nobody left.
 * 3. **Decide.** `decideYear()` over every answer, then finality (below).
 *
 * `verify` RUNS `resolve`'S FRONTIERS FIRST, and that is not a second copy of the resolve
 * stage: with a warm cache every `resolve` provider is already answered by step 1, so those
 * frontiers are empty and `verify` asks only iTunes. It matters when the cache does NOT hold
 * them -- `vercel dev` (whose memory cache never hits), an expired or evicted entry, or a
 * `resolve` whose MusicBrainz failed transiently. `verify` is the stage the client treats as
 * the last word, so it must not be final over a provider nobody asked; re-asking is the
 * behaviour spike §12.4 describes ("under `vercel dev` ... it simply asks again").
 * `nextFrontier()` itself still never returns a provider of the other stage.
 *
 * FINALITY. An answer is final when a confirmation was reached, or -- with NO transient
 * failure this call -- when every provider of the plan has answered or is skipped as
 * `not-configured`. For `verify` the second half holds whenever nothing failed, because both
 * stages' frontiers have run dry; for `resolve` it holds only when even iTunes' answer was
 * already cached. (The plan words the resolve case as "answered entirely from cache"; fresh
 * answers from this very call settle a provider just as well, so the test is on settlement.)
 *
 * ===========================================================================
 *  A TRANSIENT FAILURE NEVER PRODUCES A FINAL "NO YEAR".
 *
 *  A final null drops the card from the deck (or keeps it yearless). An outage
 *  of one provider must not do that, so any `failed` outcome without a
 *  confirmation makes the answer provisional and the client asks again later.
 *  When NOTHING answered and something failed, the stage is
 *  `upstream-unavailable` (a 502): there is not even a provisional year to
 *  show. A failure beside an answer in hand is NOT a 502 -- that would throw
 *  away a year the client could show while it retries.
 * ===========================================================================
 *
 * `busy` stops the loop at once and is returned with its `retryAfterMs`. Whatever the same
 * frontier did obtain is already cached -- by `withAnswerCache` for the stores and by
 * `resolveYear()` for MusicBrainz -- so the next call's batched read picks up from it.
 *
 * `not-configured` providers count as ABSENT: skipped, listed in `skipped`, warned about once
 * per cold start per provider (naming the variable, never its value), and a final can still
 * be reached without them. Only when EVERY provider of the plan is `not-configured` is the
 * stage `not-configured` -- the loud 500 the developer asked to keep for "nothing can run".
 *
 * ONE KNOWN CONSEQUENCE OF READING `mbyear:` HERE: a deployment with no
 * `MUSICBRAINZ_USER_AGENT` still uses MusicBrainz answers that are already cached, where the
 * stage-less path answers 500 even for warm tracks (`resolve-year.ts`, "Configuration is
 * checked BEFORE the cache"). That rule existed to stop a misconfiguration looking
 * intermittent; here the skip is logged and listed in `skipped`, so it is visible either way,
 * and a correct cached answer is not thrown away to make the point.
 */

import { primaryArtistGuess } from '../../shared/artists.js';
import { cleanTrackTitle, yearCacheKey } from '../../shared/year.js';
import {
  UNCONFIRMED_TRUST,
  YEAR_PROVIDER_PLAN,
  decideYear,
  nextFrontier,
} from '../../shared/year-providers.js';
import { answerTtlFor, providerAnswerKey } from './cache.js';
import { musicBrainzAnswerFrom } from './musicbrainz-provider.js';
import type { AnswerRead, ProviderAnswerCache } from './cache.js';
import type { ProviderLookupInput, ProviderOutcome, ProviderRegistry } from './provider-lookup.js';
import type { ProviderPlan, TrustTier } from '../../shared/year-providers.js';
import type {
  ProviderAnswer,
  YearLookupResult,
  YearProviderId,
  YearStage,
} from '../../shared/types.js';

/** One card, as `/api/year` received it. The title is RAW; cleaning happens here, once. */
export interface StageInput {
  title: string;
  artist: string;
  durationMs?: number;
  signal?: AbortSignal;
}

export type StageOutcome =
  | {
      ok: true;
      result: YearLookupResult;
      /**
       * The TTL of every cache entry the answer was built from, one per answering provider.
       * `api/year.ts` bounds the edge by the shortest (`stagedEdgeMaxAgeSeconds()`); the body
       * cannot carry it, because the body must not grow internal fields.
       */
      sourceTtlsSeconds: number[];
    }
  | { ok: false; code: 'rate-limited'; retryAfterMs: number }
  | { ok: false; code: 'upstream-unavailable' }
  | { ok: false; code: 'not-configured' };

export interface StageOptions {
  /** The lone-answer order. Injectable for tests; production passes nothing. */
  trust?: readonly TrustTier[];
  /**
   * Which providers have already been warned about. Defaults to one set per module
   * instance, i.e. per cold start -- which is exactly "once per cold start".
   */
  warned?: Set<YearProviderId>;
}

/** Providers already warned about as `not-configured`, for the life of this instance. */
const warnedThisColdStart = new Set<YearProviderId>();

/**
 * Forget which providers were warned about. TEST-ONLY: production never calls it, because a
 * cold start is what resets the warning.
 */
export function resetNotConfiguredWarnings(): void {
  warnedThisColdStart.clear();
}

/** Which stages' frontiers a call runs, in order. See the header for why `verify` runs both. */
const STAGES_RUN: Record<YearStage, readonly YearStage[]> = {
  resolve: ['resolve'],
  verify: ['resolve', 'verify'],
};

export async function runStage(
  stage: YearStage,
  input: StageInput,
  registry: ProviderRegistry,
  cache: ProviderAnswerCache,
  plan: ProviderPlan = YEAR_PROVIDER_PLAN,
  options: StageOptions = {},
): Promise<StageOutcome> {
  const trust = options.trust ?? UNCONFIRMED_TRUST;
  const warned = options.warned ?? warnedThisColdStart;

  const cleaned = cleanTrackTitle(input.title);
  const lookupInput: ProviderLookupInput = {
    rawTitle: input.title,
    cleaned,
    rawArtist: input.artist,
    primaryArtist: primaryArtistGuess(input.artist),
  };
  if (input.durationMs !== undefined) lookupInput.durationMs = input.durationMs;
  if (input.signal !== undefined) lookupInput.signal = input.signal;

  const providers = plan.map((step) => step.provider);
  const answers = new Map<YearProviderId, ProviderAnswer>();
  const notConfigured = new Set<YearProviderId>();
  const failed = new Set<YearProviderId>();
  let requestCount = 0;

  // ---- 1. Read first: ONE batched read, the `mbyear:` key included ---------------
  const reads: AnswerRead[] = providers
    .filter((provider) => provider !== 'musicbrainz')
    .map((provider) => ({ provider, key: providerAnswerKey(provider, lookupInput) }));
  const yearKey = providers.includes('musicbrainz')
    ? yearCacheKey(input.artist, cleaned.title)
    : undefined;

  const cachedRead = await cache.readMany(reads, yearKey);
  reads.forEach((slot, index) => {
    const answer = cachedRead.answers[index];
    if (answer !== undefined) answers.set(slot.provider, answer);
  });
  if (cachedRead.year !== undefined) {
    // The same mapper the MusicBrainz provider uses, so a warm card and a cold one vote alike.
    const answer = musicBrainzAnswerFrom(cachedRead.year);
    if (answer !== undefined) answers.set('musicbrainz', answer);
  }

  // ---- 2. Ask: frontier by frontier, each one concurrently ------------------------
  for (const frontierStage of STAGES_RUN[stage]) {
    // Bounded by the plan's length: every frontier either settles at least one provider or
    // is `done`, so this is a guard against a planner bug, never a real limit.
    for (let round = 0; round <= plan.length; round += 1) {
      const excluded = new Set<YearProviderId>([...notConfigured, ...failed]);
      const frontier = nextFrontier(plan, frontierStage, {
        answers: inPlanOrder(providers, answers),
        excluded,
      });
      if (frontier.kind === 'done') break;

      const outcomes = await Promise.all(
        frontier.providers.map((id) => askSafely(registry, id, lookupInput)),
      );

      let retryAfterMs: number | undefined;
      frontier.providers.forEach((id, index) => {
        const outcome = outcomes[index];
        if (outcome === undefined) return;

        switch (outcome.kind) {
          case 'answer':
            answers.set(id, outcome.answer);
            requestCount += outcome.requestCount;
            break;
          case 'skipped':
            notConfigured.add(id);
            if (!warned.has(id)) {
              warned.add(id);
              // The variable's NAME only. The value is never read into this module, so it
              // cannot reach a shared log by accident.
              console.warn(
                `[year-pipeline] ${id} skipped: ${outcome.missingVariable} is not set on this deployment`,
              );
            }
            break;
          case 'failed':
            failed.add(id);
            // Counted as a request: it may well have reached the provider, and `cached` is a
            // claim that this call cost nothing.
            requestCount += 1;
            break;
          case 'busy':
            retryAfterMs = Math.max(retryAfterMs ?? 0, outcome.retryAfterMs);
            break;
        }
      });

      // Busy stops the call, AFTER the rest of the frontier was merged -- their answers are
      // already cached, so the next call resumes from them.
      if (retryAfterMs !== undefined) return { ok: false, code: 'rate-limited', retryAfterMs };
    }
  }

  // ---- 3. Decide ------------------------------------------------------------------
  if (providers.length > 0 && providers.every((provider) => notConfigured.has(provider))) {
    return { ok: false, code: 'not-configured' };
  }
  if (failed.size > 0 && answers.size === 0) return { ok: false, code: 'upstream-unavailable' };

  const ordered = inPlanOrder(providers, answers);
  const decision = decideYear(ordered, trust);
  const settled = providers.every(
    (provider) => answers.has(provider) || notConfigured.has(provider),
  );
  const final = decision.confidence === 'high' || (failed.size === 0 && settled);

  // Built field by field rather than spread, so an internal field can never leak.
  const result: YearLookupResult = {
    year: decision.year,
    confidence: decision.confidence,
    cached: requestCount === 0,
    cleanedTitle: cleaned.title,
    stripped: cleaned.stripped,
    final,
  };
  if (decision.year !== null) result.source = decision.source;
  if (decision.confidence === 'high') result.agreedBy = decision.agreedBy;
  // `decideYear()` sets `viaTitle` only on a kept MusicBrainz year found through a rewrite,
  // which is exactly when the body promises it.
  if (decision.confidence === 'low' && decision.viaTitle !== undefined) {
    result.viaTitle = decision.viaTitle;
  }
  const skipped = providers.filter(
    (provider) => notConfigured.has(provider) || failed.has(provider),
  );
  if (skipped.length > 0) result.skipped = skipped;

  return { ok: true, result, sourceTtlsSeconds: ordered.map((answer) => answerTtlFor(answer)) };
}

/** Answers in plan order, so "in plan order when more than two agree" holds downstream. */
function inPlanOrder(
  providers: readonly YearProviderId[],
  answers: ReadonlyMap<YearProviderId, ProviderAnswer>,
): ProviderAnswer[] {
  return providers.flatMap((provider) => {
    const answer = answers.get(provider);
    return answer === undefined ? [] : [answer];
  });
}

/**
 * Ask one provider, and hold it to the contract: an adapter never throws, and an answer is
 * about the provider that gave it. A breach of either is mapped to a failure rather than
 * allowed to take the whole stage down with a 500 -- or, worse, to let one provider's answer
 * vote under another's id, which would turn one answer into a confirmation.
 */
async function askSafely(
  registry: ProviderRegistry,
  id: YearProviderId,
  input: ProviderLookupInput,
): Promise<ProviderOutcome> {
  try {
    const outcome = await registry[id].lookup(input);
    if (outcome.kind === 'answer' && outcome.answer.provider !== id) {
      return { kind: 'failed', code: 'unexpected-payload' };
    }
    return outcome;
  } catch {
    return { kind: 'failed', code: 'upstream-unavailable' };
  }
}
