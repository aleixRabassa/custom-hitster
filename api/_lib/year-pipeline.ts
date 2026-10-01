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
 * failure this call -- when every provider of the plan has answered or is skipped (as
 * `not-configured` or as `refused`). For `verify` the second half holds whenever nothing
 * failed, because both stages' frontiers have run dry; for `resolve` it holds only when even
 * iTunes' answer was already cached. (The plan words the resolve case as "answered entirely from cache"; fresh
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
 * `busy` stops the loop at once. Whatever the same frontier did obtain is already cached --
 * by `withAnswerCache` for the stores and by `resolveYear()` for MusicBrainz -- so the next
 * call's batched read picks up from it. What the call then RETURNS depends on the stage:
 *
 * - **`resolve` with an answer in hand** (from this call or from the batched read, a
 *   `year: null` answer included): stop asking and DECIDE, a 200. The busy provider has no
 *   answer, so the stage is not settled and the answer is `final: false` -- unless the
 *   answers in hand already confirm a year, which is `high` and final by the stop rule. A
 *   429 there would throw away a year the client could show at once (Deezer answers in a
 *   quarter of a second; MusicBrainz is the provider usually queued at its gate). The client
 *   routes any non-final `resolve` to its verify lane, and `verify` re-runs `resolve`'s
 *   frontiers, so the busy provider is asked again there. The 200 still carries the busy
 *   provider's `retryAfterMs` (the longest, if several were busy) -- the wait the 429 would
 *   have carried -- so the client's resolve lane sleeps it before its next card rather than
 *   send a second lookup to a gate it was just told is full. (It cuts the waiters rather than
 *   guaranteeing one: the verify lane's re-ask usually meets the same full gate and sleeps about
 *   as long, so the two lanes can wake together.) A FINAL answer carries none. With NOTHING in
 *   hand it is still `rate-limited` with its `retryAfterMs`: there is nothing to show.
 * - **`verify`: always `rate-limited`**, answer in hand or not. The client counts a non-final
 *   `verify` 200 as one transient attempt and settles the card exhausted after a handful of
 *   them, while it sleeps on a 429 WITHOUT counting -- so the `resolve` rule applied here
 *   would turn contention at a gate into cards settled for good at their provisional year.
 *
 * `busy` is ONLY our own gate refusing a permit (other players hold the shared slot). A
 * provider's OWN refusal -- an iTunes 403/429, a Deezer quota body or 429 -- is not `busy`
 * since 2026-10-01: it is a `refused` skip, below, and never reaches this paragraph.
 *
 * Either way a busy provider is NOT listed in `skipped`, which means `not-configured`,
 * `refused` or failed; it is marked `transient`, below.
 *
 * `transient` (on the ok outcome, never in the body) says a provider FAILED or was BUSY on
 * this call. `api/year.ts` sends `no-store` for a non-final answer that carries it
 * (`stagedEdgeMaxAgeSeconds()`), because the client retries a non-final answer on the same
 * URL and an edge copy of a body built on a transient problem would answer every retry.
 *
 * SKIPPED PROVIDERS COUNT AS ABSENT, for either reason: listed in `skipped`, excluded from
 * every later frontier of the call (so never re-asked within it), warned about once per cold
 * start per provider AND reason, and a final can still be reached without them.
 *
 * - `not-configured`: the warning names the variable, never its value. Only when EVERY
 *   provider of the plan is `not-configured` is the stage `not-configured` -- the loud 500 the
 *   developer asked to keep for "nothing can run".
 * - `refused` (the developer's decision, 2026-10-01): the provider itself told us to stop.
 *   The warning names the provider and the adapter's safe detail (`HTTP 403`, `quota error
 *   code 4`), never a body. It is NOT `not-configured` -- a refusing provider is configured,
 *   so it never counts toward the 500 -- and NOT `failed`, so it neither makes the answer
 *   provisional nor `transient`, nor counts toward the 502. A `verify` with iTunes refused is
 *   therefore final at once, on the trust order's pick among the answers in hand. With
 *   NOTHING in hand and nothing failed -- every provider refused or unconfigured, at least one
 *   refused -- the answer is a final null, because "stop asking" leaves nobody to ask: that
 *   is the finality rule applied as written, not a special case. What heals all of these is
 *   `stagedEdgeMaxAgeSeconds()`'s existing rule that a final answer with a provider skipped
 *   is held for ~60 s, never a month, and `withAnswerCache` never writes a skip, so the next
 *   call after the provider stops refusing asks it again. A refusal is counted as a request,
 *   like a failure: the 403 was an answer the provider sent, and `cached` claims none was.
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
      /**
       * A provider FAILED or was BUSY on this call. With `final: false` it makes the edge hold
       * nothing (`stagedEdgeMaxAgeSeconds()`): the answer reflects the provider's state right
       * now, not the track's, and the client retries it on the same URL. Not in the body, for
       * the same reason as `sourceTtlsSeconds`.
       */
      transient: boolean;
    }
  | { ok: false; code: 'rate-limited'; retryAfterMs: number }
  | { ok: false; code: 'upstream-unavailable' }
  | { ok: false; code: 'not-configured' };

export interface StageOptions {
  /** The lone-answer order. Injectable for tests; production passes nothing. */
  trust?: readonly TrustTier[];
  /**
   * Which skips have already been warned about, as `skipWarningKey()` strings. Defaults to
   * one set per module instance, i.e. per cold start -- which is exactly "once per cold start".
   */
  warned?: Set<string>;
}

/**
 * Skips already warned about, for the life of this instance: one entry per provider AND
 * reason, so a provider warned about as `not-configured` is still warned about the first
 * time it `refused`, and the reverse.
 */
const warnedThisColdStart = new Set<string>();

/** The `warned` entry for one provider skipped for one reason. */
function skipWarningKey(provider: YearProviderId, reason: 'not-configured' | 'refused'): string {
  return `${provider}:${reason}`;
}

/**
 * Forget which skips were warned about. TEST-ONLY: production never calls it, because a cold
 * start is what resets the warning.
 */
export function resetSkipWarnings(): void {
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
  // The provider ITSELF refused us (a 403/429 or a quota body): absent like `notConfigured`,
  // but kept apart from it because it must never count toward the all-not-configured 500.
  const refused = new Set<YearProviderId>();
  const failed = new Set<YearProviderId>();
  // Set when a provider was busy on this call and `resolve` decided without it: the longest
  // wait any busy provider asked for (see the header). `undefined` means nobody was busy.
  let busyRetryAfterMs: number | undefined;
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
  // Labelled because a busy provider in a `resolve` that has an answer in hand stops the
  // ASKING, not just the current stage's rounds -- whatever `STAGES_RUN.resolve` holds.
  asking: for (const frontierStage of STAGES_RUN[stage]) {
    // Bounded by the plan's length: every frontier either settles at least one provider or
    // is `done`, so this is a guard against a planner bug, never a real limit.
    for (let round = 0; round <= plan.length; round += 1) {
      // A refused provider is excluded here, which is what "never retried within the call"
      // rests on: it has no answer, so without this every later round would ask it again.
      const excluded = new Set<YearProviderId>([...notConfigured, ...refused, ...failed]);
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
          case 'skipped': {
            const warningKey = skipWarningKey(id, outcome.reason);
            const firstWarning = !warned.has(warningKey);
            warned.add(warningKey);
            if (outcome.reason === 'not-configured') {
              notConfigured.add(id);
              // The variable's NAME only. The value is never read into this module, so it
              // cannot reach a shared log by accident.
              if (firstWarning) {
                console.warn(
                  `[year-pipeline] ${id} skipped: ${outcome.missingVariable} is not set on this deployment`,
                );
              }
            } else {
              refused.add(id);
              // The adapter's detail is built from a status or a code number, never a body.
              // Counted as a request for the reason `failed` is below: it reached the provider.
              requestCount += 1;
              if (firstWarning) {
                console.warn(
                  `[year-pipeline] ${id} skipped: the provider refused the request (${outcome.detail})`,
                );
              }
            }
            break;
          }
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
      // already cached, so the next call resumes from them. `verify`, and a `resolve` with
      // nothing in hand, return the 429 right here; a `resolve` with an answer in hand stops
      // asking and goes on to decide, keeping the wait for the body (both halves are in the
      // header).
      if (retryAfterMs !== undefined) {
        if (stage !== 'resolve' || answers.size === 0) {
          return { ok: false, code: 'rate-limited', retryAfterMs };
        }
        busyRetryAfterMs = retryAfterMs;
        break asking;
      }
    }
  }

  // ---- 3. Decide ------------------------------------------------------------------
  // `notConfigured` alone, never `refused`: a provider that refused us is configured, and
  // "nothing can run" is the only thing the 500 may say.
  if (providers.length > 0 && providers.every((provider) => notConfigured.has(provider))) {
    return { ok: false, code: 'not-configured' };
  }
  if (failed.size > 0 && answers.size === 0) return { ok: false, code: 'upstream-unavailable' };

  const ordered = inPlanOrder(providers, answers);
  const decision = decideYear(ordered, trust, plan);
  const settled = providers.every(
    (provider) => answers.has(provider) || notConfigured.has(provider) || refused.has(provider),
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
    (provider) => notConfigured.has(provider) || refused.has(provider) || failed.has(provider),
  );
  if (skipped.length > 0) result.skipped = skipped;
  // The back-off the 429 would have carried, on the 200 that replaced it -- so the client's
  // resolve lane still sleeps before its next card instead of queueing a second lookup at the
  // full gate. Never on a final answer: a card the answers in hand already confirm is done, and
  // nothing about it should wait.
  if (busyRetryAfterMs !== undefined && !final) result.retryAfterMs = busyRetryAfterMs;

  return {
    ok: true,
    result,
    sourceTtlsSeconds: ordered.map((answer) => answerTtlFor(answer)),
    transient: failed.size > 0 || busyRetryAfterMs !== undefined,
  };
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
