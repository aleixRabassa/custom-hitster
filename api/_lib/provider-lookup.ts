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
 * upstream problem to one of these four kinds.
 *
 * - `answer`  -- the provider was asked (or its cached answer read) and answered, possibly
 *                with `year: null`. `requestCount` is the outbound requests THIS call made,
 *                0 on a cache hit.
 * - `skipped` -- the provider is left out of THIS call, for one of two reasons. Both count
 *                as ABSENT: the vote may still reach a final answer without it, it is listed
 *                in the response's `skipped`, and it is never asked again within the call.
 *   - `not-configured` -- a variable it needs is unset on this deployment. Carries the
 *                variable's NAME (never its value). Only this reason counts toward "every
 *                provider in the plan is not-configured", the loud 500.
 *   - `refused` -- the PROVIDER ITSELF told us to stop: an iTunes 403 or a Deezer quota
 *                body (`{"error":{"code":4}}`, served with HTTP 200). Carries
 *                a short SAFE `detail` (`HTTP 403`, `quota error code 4`) built from a status
 *                or a code number, never from body text. Not a `failed`: it does not make the
 *                answer provisional and it does not count toward the 502. Never cached
 *                either -- like every arm but `answer`, it is about the provider right now.
 * - `failed`  -- transient or adapter-level failure. Never read as "no year": an answer
 *                that depended on a failed provider is not final.
 * - `busy`    -- "try again shortly": OUR OWN gate (`api/_lib/rate-limit.ts`) refused the
 *                permit because other players hold the shared slot, or the provider said the
 *                same thing itself -- an HTTP 429 from Deezer or iTunes, or Deezer's
 *                `SERVICE_BUSY` body (code 700, HTTP 200). Carries the back-pressure (the
 *                gate's, the 429's `Retry-After`, or the adapter's constant), and the client
 *                retries it with no cap. Never a provider's "stop asking", which is
 *                `skipped` / `refused` (the developer's split, 2026-10-01).
 *
 * WHY "TRY AGAIN SHORTLY" AND "STOP ASKING" ARE HANDLED OPPOSITELY. A full gate is a queue we
 * run: waiting is exactly what it asks for, and the next permit comes within a gate interval
 * or two. A 429 or `SERVICE_BUSY` says the same of the provider's own queue, so it gets the
 * same treatment. An iTunes 403 or a Deezer quota error is the provider saying our shared
 * egress IP has asked too much -- and every player leaves from that IP, so retrying it is
 * what turns a short throttle into a long block. The vote is built to decide without any one
 * provider, so leaving the refusing one out and answering at once is the cheaper of the two
 * errors there.
 */
export type ProviderOutcome =
  | { kind: 'answer'; answer: ProviderAnswer; cached: boolean; requestCount: number }
  | { kind: 'skipped'; reason: 'not-configured'; missingVariable: string }
  | { kind: 'skipped'; reason: 'refused'; detail: string }
  | { kind: 'failed'; code: 'upstream-unavailable' | 'unexpected-payload' }
  | { kind: 'busy'; retryAfterMs: number };

export interface ProviderLookup {
  readonly id: YearProviderId;
  lookup(input: ProviderLookupInput): Promise<ProviderOutcome>;
}

export type ProviderRegistry = Record<YearProviderId, ProviderLookup>;
