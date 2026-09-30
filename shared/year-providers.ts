/**
 * The provider vote -- all of it that is pure (plan.year-fetch-rework-server.md step 3).
 *
 * Three providers can answer "what year is this recording from": Deezer, MusicBrainz and
 * iTunes. This module decides WHICH of them to ask next, and WHAT their answers mean. It asks
 * nobody. It is the DECISION half of the house split, exactly as `shared/year.ts` is for
 * MusicBrainz's own scoring and `src/game/gestures.ts` is for the swipe:
 *
 * - decision (here): the plan constant, the trust order, the voter rule, the confirmation,
 *   the lone-answer fallback, the frontier, the ISRC reading and the cache key -- pure
 *   functions over `ProviderAnswer` values, node-tested with no HTTP;
 * - binding (`api/_lib/year-pipeline.ts`, `api/_lib/provider-lookup.ts` and the adapters):
 *   run the frontier this module returns, merge the outcomes, apply the caches. The driver
 *   holds no rule of its own, so every rule below is testable without a network.
 *
 * Lives in `shared/` -- so no DOM and no Node APIs -- because it is the vocabulary both halves
 * speak, and because a vote rule inlined in the driver would be tested only through fakes of
 * the adapters it calls. A RUNTIME import of this module from `api/` needs an explicit `.js`
 * extension (`'../../shared/year-providers.js'`); see `shared/constants.ts` for why.
 *
 * ===========================================================================
 *  THE ORDER IS TWO CONSTANTS AND NOTHING ELSE.
 *
 *  `YEAR_PROVIDER_PLAN` says who is asked and in which stage; `UNCONFIRMED_TRUST`
 *  says whose lone year is kept when nobody agrees. Reordering, adding or
 *  removing a provider is an edit to those two lists plus an entry in the
 *  registry `api/year.ts` builds (a `Record<YearProviderId, ...>`, so a missing
 *  adapter is a compile error) -- and nothing else. The parallel Deezer +
 *  MusicBrainz pair is not wired anywhere: it FALLS OUT of `nextFrontier`'s
 *  "no usable answer yet -> ask the next two" rule. `validatePlan` is what a
 *  test runs over any edit to either list.
 *
 *  DISCOGS IS ABSENT BY DECISION, NOT BY OMISSION (spike §13.10-13.12). It cost
 *  ~1.1 s on average and ~2.4 s at p90 for about 5 known-right years per ~780
 *  cards, and the developer dropped it on 2026-09-30. Re-adding it is a plan
 *  step, a trust tier, a `YearProviderId` member and its adapter; §11.1 records
 *  its query strategy and data-shape traps, and §13.10 its measured cost.
 *
 *  The licences of spike §10.1 still stand: Deezer and iTunes may not be used in
 *  a paid app. The developer set that aside because the app may be free.
 *  Dropping a provider is deleting its line from both constants.
 * ===========================================================================
 */

import { cleanTrackTitle, normalizeForCacheKey } from './year.js';
import type { MusicBrainzYearSource, ProviderAnswer, YearProviderId, YearStage } from './types.js';

/**
 * What a step is FOR, in the developer's words of spike §12.1: the fastest provider first,
 * then the one that covers the widest range of years, then precision. Descriptive only --
 * nothing branches on it -- but it is the reason each step sits where it does, kept on the
 * constant so a reorder has to say which phase it moved.
 */
export type ProviderPhase = 'fast' | 'coverage' | 'precision';

export interface ProviderPlanStep {
  readonly provider: YearProviderId;
  readonly phase: ProviderPhase;
  /** Which HTTP stage (`/api/year?stage=`) asks this provider. */
  readonly stage: YearStage;
  /** When on, this provider is asked ALONE and a certain answer from it is final. Off for all three. */
  readonly finalWhenCertain: boolean;
}

export type ProviderPlan = readonly ProviderPlanStep[];

/**
 * The provider order, decided 2026-09-30 (spike §12.2, as amended by §13.12).
 *
 * | Step | Phase     | Provider    | Stage     | Why here                                                     |
 * | ---: | --------- | ----------- | --------- | ------------------------------------------------------------ |
 * |    1 | fast      | Deezer      | `resolve` | ~2 requests and ~0.25 s a card: a year reaches the player almost at once |
 * |    2 | coverage  | MusicBrainz | `resolve` | the only source whose date means "first release" on old catalogue |
 * |    3 | precision | iTunes      | `verify`  | the most precise single source (19/19 fixtures), but ~20/min globally |
 *
 * Steps 1 and 2 are asked IN PARALLEL: with no usable answer yet, `nextFrontier` asks the
 * next two. When they agree, iTunes is never asked -- measured on the 24 of 804 cards where
 * iTunes disagrees with that pair, the pair was right 11 times and iTunes 4 (§13.12), and not
 * asking it spares iTunes' global limit on about half of all cards.
 *
 * `finalWhenCertain` is OFF for all three, because decision 2 of §12.1 says a year is
 * confirmed by two providers, never by one provider's self-signal. Turning Deezer's on (its
 * `deezerRecentSignature`) is the lever for the MusicBrainz saving §12.3 measured
 * (1 527 -> 751 requests), which the developer has not asked for.
 */
export const YEAR_PROVIDER_PLAN: ProviderPlan = [
  { provider: 'deezer', phase: 'fast', stage: 'resolve', finalWhenCertain: false },
  { provider: 'musicbrainz', phase: 'coverage', stage: 'resolve', finalWhenCertain: false },
  { provider: 'itunes', phase: 'precision', stage: 'verify', finalWhenCertain: false },
];

/** A lone answer's rank when nobody agrees. Tiers, not providers: MusicBrainz appears twice. */
export type TrustTier = 'musicbrainz:high' | 'musicbrainz:low' | 'itunes' | 'deezer';

/**
 * Whose lone year a card keeps when no two providers agree, strongest first. The card still
 * shows it, marked unconfirmed (§13.9); only "nobody answered" leaves a card without a year.
 *
 * ACCEPTED BY THE DEVELOPER 2026-09-30 (spike §13.12), replacing §12.2's
 * "MusicBrainz > iTunes > Deezer": 112/125 labelled cards exact against 110.
 *
 * - **iTunes goes BEFORE a MusicBrainz `low`.** It recovered A Whole New World (MusicBrainz
 *   `low` 2014 -> iTunes 1992) and (I've Had) The Time of My Life (2024 -> 1987), the two
 *   losses §13.10 charged to dropping Discogs. Its known cost: three Spanish dubs move to
 *   compilation or reissue dates (Hakuna Matata 1994 -> 2003, among others).
 * - **iTunes does NOT go before a MusicBrainz `high`.** That was measured and rejected: it made
 *   6 known years worse (Killing In The Name 1992 -> 2001, L'Empordà 1989 -> 2010, Whistle Stop
 *   1973 -> 2013, three dubs moved to compilation dates) against 2-3 better. Moving `itunes`
 *   one slot up is the edit to refuse.
 * - **Deezer is last, and counts only when its two dates agree** (see `decideYear`): a release
 *   date alone is too often a reissue's, and release-year-equals-ISRC-year is the signature
 *   of a fresh recording (§5.1 rule 3).
 */
export const UNCONFIRMED_TRUST: readonly TrustTier[] = [
  'musicbrainz:high',
  'itunes',
  'musicbrainz:low',
  'deezer',
];

/** The provider a trust tier ranks. */
export function trustTierProvider(tier: TrustTier): YearProviderId {
  switch (tier) {
    case 'musicbrainz:high':
    case 'musicbrainz:low':
      return 'musicbrainz';
    case 'itunes':
      return 'itunes';
    case 'deezer':
      return 'deezer';
  }
}

/**
 * Every problem with a plan + trust order; an empty array means valid. Test-time only.
 *
 * Never called at runtime: the shipped constants are checked by a test, so a broken edit
 * fails `pnpm test` instead of failing the first cold card in production. The rules are the
 * ones the driver silently relies on:
 *
 * - each provider appears in the plan at most once -- a provider listed twice would be asked
 *   twice and, worse, read as two voters;
 * - each trust tier names a provider of the plan, and no tier is listed twice -- a tier for a
 *   provider nobody asks is dead weight that reads as if it mattered;
 * - every provider of the plan has at least one tier -- otherwise its lone answer could never
 *   be kept, and it would silently count only as a second opinion;
 * - every `resolve` step comes before every `verify` step -- the plan is read in order, and
 *   `verify` builds on what `resolve` cached.
 */
export function validatePlan(plan: ProviderPlan, trust: readonly TrustTier[]): string[] {
  const problems: string[] = [];

  const stepCounts = new Map<YearProviderId, number>();
  for (const step of plan) stepCounts.set(step.provider, (stepCounts.get(step.provider) ?? 0) + 1);
  for (const [provider, count] of stepCounts) {
    if (count > 1) problems.push(`provider "${provider}" appears ${count} times in the plan`);
  }

  const seenTiers = new Set<TrustTier>();
  const tieredProviders = new Set<YearProviderId>();
  for (const tier of trust) {
    if (seenTiers.has(tier)) problems.push(`trust tier "${tier}" is listed more than once`);
    seenTiers.add(tier);
    const provider = trustTierProvider(tier);
    tieredProviders.add(provider);
    if (!stepCounts.has(provider)) {
      problems.push(`trust tier "${tier}" names provider "${provider}", which is not in the plan`);
    }
  }
  for (const provider of stepCounts.keys()) {
    if (!tieredProviders.has(provider)) {
      problems.push(`provider "${provider}" has no trust tier`);
    }
  }

  const lastResolve = plan.findLastIndex((step) => step.stage === 'resolve');
  const firstVerify = plan.findIndex((step) => step.stage === 'verify');
  if (firstVerify !== -1 && firstVerify < lastResolve) {
    problems.push(
      `verify step "${plan[firstVerify]?.provider}" comes before resolve step "${plan[lastResolve]?.provider}"`,
    );
  }

  return problems;
}

/**
 * The years one provider contributes as ONE voter.
 *
 * ===========================================================================
 *  DEEZER'S TWO DATES ARE ONE VOTER. iTUNES AND DEEZER ARE TWO.
 *
 *  Deezer's release-date year and its ISRC year come from the same catalogue
 *  row, so they are one provider's evidence: either may agree with another
 *  provider, but they can never confirm each other. That is what keeps Killing
 *  In The Name at 1992 -- Deezer's 20th-anniversary edition says 2012 twice.
 *
 *  iTunes and Deezer BOTH carry the record label's metadata, and counting them
 *  as ONE voter was measured and REJECTED (spike §13.11, developer's decision
 *  2026-09-30). The consensus figure could not see the cards it changes; checked
 *  one by one, it undid three corrections §5.3 had verified by hand on the 542
 *  (H.I.E.L.O. 2020 -> 2010, Happy Together 1967 -> 1966, Iris 1998 -> 2017),
 *  moved Abracadabra further from its 1984, and cost requests and ~0.5 s: net
 *  -4 known-right years on the 542 for +2 on the soundtrack decks. The
 *  correlated-reissue failure it targets is real (Pink Panther Theme is pinned
 *  wrong for it in the test) and was accepted as the cheaper error. Merging the
 *  two stores here is the edit to refuse.
 * ===========================================================================
 *
 * A `null` year contributes nothing: the provider was asked and found nothing, which is not
 * a vote for anything.
 */
export function voterYears(answer: ProviderAnswer): number[] {
  switch (answer.provider) {
    case 'deezer': {
      const years: number[] = [];
      if (answer.year !== null) years.push(answer.year);
      if (answer.isrcYear !== null && answer.isrcYear !== answer.year) years.push(answer.isrcYear);
      return years;
    }
    case 'itunes':
    case 'musicbrainz':
      return answer.year === null ? [] : [answer.year];
  }
}

export interface Confirmation {
  year: number;
  /** The two providers, in plan order when more than two agree. */
  agreedBy: readonly [YearProviderId, YearProviderId];
}

/** A provider's position in the shipped plan; one not in it sorts last, stably. */
function planRank(provider: YearProviderId): number {
  const index = YEAR_PROVIDER_PLAN.findIndex((step) => step.provider === provider);
  return index === -1 ? YEAR_PROVIDER_PLAN.length : index;
}

/**
 * The EARLIEST year on which two different providers agree, or null.
 *
 * Earliest, not "the first pair asked", because the vote is recomputed from every answer on
 * every call (the per-provider cache, plan decision 3): the result must not depend on which
 * answer happened to arrive first, and an earlier year is the likelier original release
 * where two pairs disagree (§5.1 rule 1). Voters are collected per PROVIDER in a set, which
 * is what makes Deezer's two dates one voter even if a caller passed its answer twice.
 */
export function findConfirmation(answers: readonly ProviderAnswer[]): Confirmation | null {
  const votersByYear = new Map<number, Set<YearProviderId>>();
  for (const answer of answers) {
    for (const year of voterYears(answer)) {
      const voters = votersByYear.get(year) ?? new Set<YearProviderId>();
      voters.add(answer.provider);
      votersByYear.set(year, voters);
    }
  }

  let best: Confirmation | null = null;
  for (const [year, voters] of votersByYear) {
    if (voters.size < 2 || (best !== null && year >= best.year)) continue;
    const [first, second] = [...voters].sort((a, b) => planRank(a) - planRank(b));
    if (first === undefined || second === undefined) continue;
    best = { year, agreedBy: [first, second] };
  }
  return best;
}

export type YearDecision =
  | {
      year: number;
      confidence: 'high';
      source: 'vote';
      agreedBy: readonly [YearProviderId, YearProviderId];
    }
  | {
      year: number;
      confidence: 'low';
      /** The kept provider: MusicBrainz reports its own source, the stores their id. */
      source: MusicBrainzYearSource | 'deezer' | 'itunes';
      /** Carried from a MusicBrainz answer found via a rewritten title. */
      viaTitle?: string;
    }
  | { year: null; confidence: 'none' };

/** The decision a single trust tier yields over these answers, or null when the tier is absent. */
function keptByTier(
  tier: TrustTier,
  answers: readonly ProviderAnswer[],
): Extract<YearDecision, { confidence: 'low' }> | null {
  for (const answer of answers) {
    switch (answer.provider) {
      case 'musicbrainz':
        if (answer.confidence === 'none' || tier !== `musicbrainz:${answer.confidence}`) break;
        return {
          year: answer.year,
          confidence: 'low',
          source: answer.source,
          ...(answer.viaTitle !== undefined && { viaTitle: answer.viaTitle }),
        };
      case 'itunes':
        if (tier !== 'itunes' || answer.year === null) break;
        return { year: answer.year, confidence: 'low', source: 'itunes' };
      case 'deezer':
        // A lone Deezer counts ONLY when its release-date year equals its ISRC year: the
        // fresh-recording signature (§5.1 rule 3). A release date alone is too often a
        // reissue's, and a lone ISRC year is not a release date at all.
        if (tier !== 'deezer' || answer.year === null || answer.year !== answer.isrcYear) break;
        return { year: answer.year, confidence: 'low', source: 'deezer' };
    }
  }
  return null;
}

/**
 * Confirmed -> `high`, source `vote`; else the first `UNCONFIRMED_TRUST` tier present ->
 * `low`, with that provider's source; else no year.
 *
 * A MusicBrainz `high` alone is `low` here: since 2026-09-30 it is one voter, no longer the
 * final word (§12.1 decision 4), and its tier only makes it the strongest lone answer. A kept
 * MusicBrainz year reports ITS OWN source (`release-group` / `recording`) and `viaTitle`,
 * because "which signal produced this" is the diagnostic §2 and Phase 6 rely on.
 *
 * It does NOT decide finality. Whether this is the last word depends on whether a provider
 * is left to ask and whether one failed transiently -- facts only the driver has.
 */
export function decideYear(
  answers: readonly ProviderAnswer[],
  trust: readonly TrustTier[] = UNCONFIRMED_TRUST,
): YearDecision {
  const confirmation = findConfirmation(answers);
  if (confirmation !== null) {
    return {
      year: confirmation.year,
      confidence: 'high',
      source: 'vote',
      agreedBy: confirmation.agreedBy,
    };
  }
  for (const tier of trust) {
    const kept = keptByTier(tier, answers);
    if (kept !== null) return kept;
  }
  return { year: null, confidence: 'none' };
}

/**
 * The first year from which Deezer's recent-release signature fires. Below it, an ISRC year
 * equal to the release year is as likely a remaster's fresh code as a new song's (§11.3), and
 * the signature only exists to spare MusicBrainz requests on new music.
 */
export const DEEZER_RECENT_SIGNATURE_FROM_YEAR = 2015;

/**
 * Deezer's recent-release signature: release-date year equals ISRC year, the year is at least
 * `DEEZER_RECENT_SIGNATURE_FROM_YEAR`, and the RAW Spotify title carries no remaster or live
 * suffix. The suffix check reads the raw title because the cleaned one has already lost it:
 * `La Grange - 2005 Remaster` is Deezer 2019 / ISRC 2019, a remaster's fresh code on a 1973
 * song, and must not fire.
 *
 * Read only by `finalWhenCertain`, which is off: dormant but tested.
 */
export function deezerRecentSignature(
  answer: Extract<ProviderAnswer, { provider: 'deezer' }>,
  rawTitle: string,
): boolean {
  if (answer.year === null || answer.year !== answer.isrcYear) return false;
  if (answer.year < DEEZER_RECENT_SIGNATURE_FROM_YEAR) return false;
  const { stripped } = cleanTrackTitle(rawTitle);
  return !stripped.remaster && !stripped.live;
}

/**
 * A well-formed ISRC once its display hyphens are gone: a two-letter country code, a
 * three-character alphanumeric registrant, the two-digit year of reference, and a five-digit
 * designation (ISO 3901).
 */
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}(\d{2})\d{5}$/;

/**
 * Characters 6-7 of an ISRC as a year, two-digit pivot at `now`'s two-digit year + 1.
 * Malformed -> null.
 *
 * The pivot reads a two-digit value at or below next year's as 20xx and anything above as
 * 19xx (plan decision 10). The +1 absorbs a code minted for a release dated next January;
 * the cost is that a code carrying `27` for 1927 would read 2027. `now` is injectable so the
 * pivot is testable; read in UTC so the answer does not depend on the server's timezone.
 *
 * ===========================================================================
 *  THERE IS DELIBERATELY NO 1986 FLOOR (measured 2026-09-30).
 *
 *  ISO 3901 dates from 1986 and defines the field as the year the code was
 *  ASSIGNED, so "a year before 1986 is impossible -> null" reads like an obvious
 *  sanity check. It is refuted by the data: major registrants BACK-CODE their
 *  catalogue with the ORIGINAL recording year. On the spike's recorded rows,
 *  28 verified Deezer rows (19 of the 542, 9 of the 240 soundtrack tracks)
 *  decode to 1964-1984, and on every card the MINIMUM over them is the
 *  recording's real year or within one of it (a later back-code, such as
 *  `AUAP08300037` 1983 on a 1980 AC/DC take, loses to the min) --
 *  `AUAP08000046` Back In Black 1980, `SEAYD7601020` Dancing Queen
 *  1976, `USFI86900065` Fortunate Son 1969, `USMC17251835` the Godfather theme
 *  1972, `USMC17301722` Free Bird 1973. Replayed through this module
 *  (`.scratch/plan2/replay/replay.ts`, git-ignored), a floor turns 4 of the
 *  542's confirmations into lone answers (474 -> 470) and costs a labelled card
 *  (112 -> 111 of 125: Lay All Your Love On Me 1980 -> 1977), where it fixes
 *  no shown year anywhere. Adding it is the edit to refuse.
 *
 *  The garbage it was meant to stop is real, and narrower: the `GBSMU`
 *  registrant (FM-broadcast bootlegs dated `2016-01-01` / `2017-01-01`) fills
 *  the field with what look like sequence digits -- 26, 29, 34, 39, 46, 64
 *  across the 2026-09-30 captures -- so `GBSMU2955085` reads 1929. Because the
 *  adapter keeps the MINIMUM over its rows, such a value MASKS a correct code:
 *  on Sweet Child O' Mine it hides `USGF18714809` (1987), so the card confirms
 *  at `verify` (iTunes) instead of at `resolve`. That costs one iTunes request
 *  and changes no year -- a nonsense ISRC year can only confirm if a second
 *  provider names the same nonsense year. No such code appears in the spike's
 *  804 recorded cards (the spike's `> 40 -> 19xx` pivot and this one agree on
 *  every one of them), so there is nothing measured to tune a narrower rule on.
 * ===========================================================================
 */
export function isrcYear(isrc: string, now: Date = new Date()): number | null {
  if (typeof isrc !== 'string') return null;
  const match = ISRC_PATTERN.exec(isrc.trim().replace(/-/g, '').toUpperCase());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const twoDigit = Number(digits);
  const pivot = (now.getUTCFullYear() % 100) + 1;
  return twoDigit <= pivot ? 2000 + twoDigit : 1900 + twoDigit;
}

export type Frontier = { kind: 'ask'; providers: YearProviderId[] } | { kind: 'done' };

export interface FrontierState {
  /** Every answer obtained so far, from either stage (cached or fresh). */
  answers: readonly ProviderAnswer[];
  /** Providers never to ask again in this call: skipped, failed or busy. */
  excluded: ReadonlySet<YearProviderId>;
}

/**
 * Which providers of `stage` to ask next, concurrently; `done` on a confirmation or when the
 * stage has none left.
 *
 * - A confirmation over ALL answers (either stage) is `done`: two providers agreeing is the
 *   stop rule (§12.1 decision 2), and it is why a MusicBrainz + Deezer agreement at `resolve`
 *   means `verify` never asks iTunes.
 * - The candidates are this stage's steps, in plan order, whose provider has no answer
 *   (a `year: null` answer is still an answer) and is not excluded. A provider of the OTHER
 *   stage is never returned: `verify` reads `resolve`'s answers from the cache, and `resolve`
 *   must not spend the precision provider's global limit.
 * - A candidate with `finalWhenCertain` is asked ALONE, because its answer may end the card
 *   by itself and a parallel request would be spent for nothing. That holds for the SECOND
 *   candidate too: the pair below never drags one along.
 * - With no USABLE answer yet (none carrying a year), ask the next TWO: nothing can confirm
 *   with fewer than two, so asking them together is free latency. This is where the parallel
 *   Deezer + MusicBrainz pair comes from.
 * - With at least one usable answer, ask ONE: a single agreeing provider now confirms, and
 *   asking two could spend a request the stop rule would have saved.
 */
export function nextFrontier(plan: ProviderPlan, stage: YearStage, state: FrontierState): Frontier {
  if (findConfirmation(state.answers) !== null) return { kind: 'done' };

  const answered = new Set(state.answers.map((answer) => answer.provider));
  const candidates = plan.filter(
    (step) =>
      step.stage === stage && !answered.has(step.provider) && !state.excluded.has(step.provider),
  );

  const [first, second] = candidates;
  if (first === undefined) return { kind: 'done' };
  if (first.finalWhenCertain) return { kind: 'ask', providers: [first.provider] };

  const usable = state.answers.filter((answer) => voterYears(answer).length > 0).length;
  if (usable === 0 && second !== undefined && !second.finalWhenCertain) {
    return { kind: 'ask', providers: [first.provider, second.provider] };
  }
  return { kind: 'ask', providers: [first.provider] };
}

/**
 * The answer-cache key version, PER PROVIDER. A change to one adapter's matching logic bumps
 * only that provider's entry, and discards only that provider's cached answers -- the others,
 * and the vote recomputed over them, are untouched. Reordering the plan needs no bump at all,
 * because no key encodes the order.
 *
 * MusicBrainz has an entry for completeness only: its answers live under the `mbyear:` key
 * `resolveYear` owns (`yearCacheKey` in `shared/year.ts`), and the MusicBrainz provider is
 * never wrapped in this cache.
 */
export const PROVIDER_CACHE_VERSION: Readonly<Record<YearProviderId, string>> = {
  deezer: 'v1',
  musicbrainz: 'v1',
  itunes: 'v1',
};

/**
 * `yearprov:<provider>:v1:` + normalizeForCacheKey of each part.
 *
 * Joined with `|`, exactly as `yearCacheKey` joins the MusicBrainz key, so the two key
 * families read alike in Redis and a separator cannot occur inside a normalised part (which
 * holds only `[a-z0-9 ]`). The title passed in should already be the CLEANED one, for the
 * reason `yearCacheKey` gives.
 */
export function providerCacheKey(
  provider: YearProviderId,
  artist: string,
  cleanedTitle: string,
): string {
  return `yearprov:${provider}:${PROVIDER_CACHE_VERSION[provider]}:${normalizeForCacheKey(artist)}|${normalizeForCacheKey(cleanedTitle)}`;
}
