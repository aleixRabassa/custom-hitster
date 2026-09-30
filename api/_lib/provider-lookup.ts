/**
 * The contract every year provider implements -- the one seam between the pure vote in
 * `shared/year-providers.ts` and the I/O in the three adapters.
 *
 * It is the BINDING half of the decision/binding split: nothing here decides a year. An
 * adapter turns one provider's HTTP into one `ProviderOutcome`; `api/_lib/year-pipeline.ts`
 * collects outcomes and asks `nextFrontier()` / `decideYear()` what they mean. Keeping the
 * outcome a closed union is what lets the driver stay a thin, exhaustive switch.
 *
 * The registry is a `Record<YearProviderId, ProviderLookup>` rather than an array or a map,
 * so a plan step naming a provider with no adapter is a COMPILE error in `api/year.ts`, not
 * a runtime `undefined` on the first cold card.
 */

import type { CleanedTitle, ProviderAnswer, YearProviderId } from '../../shared/types.js';

export interface ProviderLookupInput {
  /** The title exactly as Spotify supplied it. MusicBrainz cleans it itself. */
  rawTitle: string;
  /** `cleanTrackTitle(rawTitle)`, computed once by the driver. */
  cleaned: CleanedTitle;
  /** The joined artist string, verbatim from Spotify. */
  rawArtist: string;
  /** `primaryArtistGuess(rawArtist)`: what the store adapters search and verify against. */
  primaryArtist: string;
  /** Track length, or `undefined` when unknown. */
  durationMs?: number;
  /** Aborts every request the adapter has in flight. */
  signal?: AbortSignal;
}

/**
 * What one provider said about one track. Never an exception: an adapter maps every
 * upstream problem to one of these four arms.
 *
 * - `answer`  -- the provider was asked (or its cached answer read) and answered, possibly
 *                with `year: null`. `requestCount` is the outbound requests THIS call made,
 *                0 on a cache hit.
 * - `skipped` -- the provider is not configured on this deployment. Counts as ABSENT: the
 *                vote may still reach a final answer without it.
 * - `failed`  -- transient or adapter-level failure. Never read as "no year": an answer
 *                that depended on a failed provider is not final.
 * - `busy`    -- the provider's gate (or the provider itself) refused. Carries back-pressure.
 */
export type ProviderOutcome =
  | { kind: 'answer'; answer: ProviderAnswer; cached: boolean; requestCount: number }
  | { kind: 'skipped'; reason: 'not-configured'; missingVariable: string }
  | { kind: 'failed'; code: 'upstream-unavailable' | 'unexpected-payload' }
  | { kind: 'busy'; retryAfterMs: number };

export interface ProviderLookup {
  readonly id: YearProviderId;
  lookup(input: ProviderLookupInput): Promise<ProviderOutcome>;
}

export type ProviderRegistry = Record<YearProviderId, ProviderLookup>;
