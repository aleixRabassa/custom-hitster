/**
 * The iTunes year provider: one keyless iTunes Search API request, answered as a
 * `ProviderLookup`.
 *
 * BINDING, in the house decision/binding split. This file does the HTTP and reads Apple's
 * JSON; `shared/store-match.ts` decides whether a row is the card's recording and which row's
 * date is the answer, and `shared/year-providers.ts` decides what that answer is worth. It is
 * the plan's PRECISION provider (plan.year-fetch-rework-server.md): asked only in the `verify`
 * stage, only when Deezer and MusicBrainz did not already agree, because it is the strongest
 * store on old catalogue (spike §4.2: 86% against MusicBrainz `high` before 2015, where Deezer
 * manages 40%) and the most expensive provider to ask (a 3 s gate, shared by every player).
 *
 * Registered by `api/year.ts` as `createItunesLookup({ fetchImpl, gate })`, with iTunes' own
 * gate from `PROVIDER_GATES` and wrapped in the per-provider answer cache there, never here.
 *
 * THE REQUEST: `GET /search?term=<primary artist> <cleaned title>&entity=song&limit=10&
 * country=ES` -- exactly what the spike's harnesses sent (§4.1, §9). Everything a verdict needs
 * is in that one response (title, credit, `trackTimeMillis`, `releaseDate`), so a lookup costs
 * ONE request, which is what §11.2 measured.
 *
 * `ITUNES_STOREFRONT` is a constant, not an environment variable (plan decision 9): the
 * storefront changes which EDITIONS are listed, and therefore the earliest date, so the answers
 * cached under `yearprov:itunes:` are only coherent for one storefront. Changing it is a
 * one-line edit that must come with the provider cache's version bump.
 *
 * `excluded` is set for a row whose `wrapperType` is not `track` or whose `kind` is not `song`.
 * `entity=song` already asks for songs only, so it has never fired on a capture (52 tracks,
 * 2026-09-30); it is there so a music video or an audiobook chapter that Apple ever mixes in
 * cannot supply a date.
 *
 * A row WITHOUT `trackTimeMillis` fails verification (the store-match rule), where the spike's
 * harness let it through. That changed no measured answer: none of the 3 795 iTunes rows the
 * 542 recorded, nor any of the 2026-09-30 captures, lacked a length. The same rule read from the
 * other side: a CARD without a length can verify no row, so such a lookup answers null at once
 * and sends nothing -- no permit, no request.
 *
 * FAILURE MAPPING. Apple documents about 20 requests a minute and answers excess with 403
 * (observed by the spike's harness, which then slept 30 s) or 429, and the developer's split
 * (2026-10-01) handles the two oppositely (`api/_lib/provider-lookup.ts` says why):
 *
 * - **429 is `busy`**, exactly as a refused permit from iTunes' own 3 s gate is: "too many
 *   requests, try again shortly", retried with no cap. It backs off by the `Retry-After`
 *   header when Apple sends a usable one and by `ITUNES_BUSY_RETRY_AFTER_MS` when it does not.
 * - **403 is a `refused` skip** (`HTTP 403`): Apple telling the egress IP every player shares
 *   to stop, so asking again is how a throttle becomes a block. iTunes is left out of this
 *   call and the vote decides without it, so a `verify` goes final at once on the answers it
 *   has -- typically the trust order's pick between Deezer and MusicBrainz, unconfirmed. A
 *   final answer reached with iTunes skipped gets the edge's short window, so the card heals
 *   within about a minute once Apple stops refusing.
 *
 * A body without a `results` array is `unexpected-payload`; network errors and 5xx are
 * transient `failed` (`api/_lib/store-http.ts`).
 */

import { earliestVerifiedRow } from '../../shared/store-match.js';
import type { DatedStoreRow, StoreTarget } from '../../shared/store-match.js';
import type { ProviderLookup, ProviderLookupInput, ProviderOutcome } from './provider-lookup.js';
import {
  asFiniteNumber,
  asRecord,
  asString,
  requestStoreJson,
  type StoreDeps,
} from './store-http.js';

export const ITUNES_API_ORIGIN = 'https://itunes.apple.com';

/** The storefront every request names. See the header before changing it. */
export const ITUNES_STOREFRONT = 'ES';

/** Rows per search. What the spike's harnesses sent. */
export const ITUNES_SEARCH_LIMIT = 10;

/**
 * Back-off after a 429 that carries no usable `Retry-After`. Thirty seconds is what the
 * spike's capture harness slept after a throttle and then succeeded; Apple publishes no
 * figure. The client's resolver clamps any wait it is given to 10 s
 * (`RETRY_AFTER_CEILING_MS` in `src/game/resolver.ts`), so it never sleeps this whole -- and
 * the 3 s gate paces whoever asks next anyway.
 */
export const ITUNES_BUSY_RETRY_AFTER_MS = 30_000;

/** The search URL, exactly as the adapter requests it. Exported for the tests and the capture. */
export function itunesSearchUrl(primaryArtist: string, cleanedTitle: string): string {
  const term = encodeURIComponent(`${primaryArtist} ${cleanedTitle}`);
  return (
    `${ITUNES_API_ORIGIN}/search?term=${term}&entity=song` +
    `&limit=${ITUNES_SEARCH_LIMIT}&country=${ITUNES_STOREFRONT}`
  );
}

/**
 * `releaseDate` is an ISO instant (`1982-11-29T12:00:00Z`); the store-match date is its
 * calendar date. Anything that does not start with `YYYY-MM-DD` becomes `''`, which the
 * selection skips as undated.
 */
function calendarDate(value: string | undefined): string {
  const match = value === undefined ? null : /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? '';
}

/**
 * Normalise a search body's `results`. Tolerant: a row without a `trackName` is skipped;
 * missing lengths and dates survive as `undefined` / `''` for the rules to reject.
 * Returns `undefined` when there is no `results` array.
 */
export function itunesRows(body: unknown): DatedStoreRow[] | undefined {
  const results = asRecord(body)?.['results'];
  if (!Array.isArray(results)) return undefined;

  const rows: DatedStoreRow[] = [];
  for (const item of results) {
    const row = asRecord(item);
    const title = asString(row?.['trackName']);
    if (!row || title === undefined || title === '') continue;

    const wrapperType = asString(row['wrapperType']);
    const kind = asString(row['kind']);
    rows.push({
      titles: [title],
      credit: asString(row['artistName']) ?? '',
      durationMs: asFiniteNumber(row['trackTimeMillis']),
      excluded:
        (wrapperType !== undefined && wrapperType !== 'track') ||
        (kind !== undefined && kind !== 'song'),
      date: calendarDate(asString(row['releaseDate'])),
    });
  }
  return rows;
}

/** Build the iTunes `ProviderLookup`. `deps.gate` must be iTunes' own gate. */
export function createItunesLookup(deps: StoreDeps): ProviderLookup {
  return {
    id: 'itunes',

    async lookup(input: ProviderLookupInput): Promise<ProviderOutcome> {
      const target: StoreTarget = {
        rawTitle: input.rawTitle,
        primaryArtist: input.primaryArtist,
        durationMs: input.durationMs,
      };

      // No length, no lookup. `failedStoreRules` in `shared/store-match.ts` passes a row only
      // when BOTH lengths are known, so without the card's own the search could only answer the
      // null below -- and it would spend a permit from the 3 s gate every player shares to learn
      // it. Shaped exactly as the "searched and nothing verified" answer at the end (`cached:
      // false`), because the two mean the same thing; `requestCount` is the one difference, and
      // the true one. `withAnswerCache` refuses to write it either (its key has no duration). If
      // store-match ever learns to verify a length-less target, this check goes with that rule.
      if (input.durationMs === undefined) {
        return {
          kind: 'answer',
          answer: { provider: 'itunes', year: null },
          cached: false,
          requestCount: 0,
        };
      }

      const response = await requestStoreJson(
        deps,
        itunesSearchUrl(input.primaryArtist, input.cleaned.title),
        {
          ...(input.signal ? { signal: input.signal } : {}),
          busyStatuses: [429],
          busyRetryAfterMs: ITUNES_BUSY_RETRY_AFTER_MS,
          refusedStatuses: [403],
        },
      );
      if (response.kind !== 'ok') return response;

      const rows = itunesRows(response.body);
      if (!rows) return { kind: 'failed', code: 'unexpected-payload' };

      return {
        kind: 'answer',
        answer: { provider: 'itunes', year: earliestVerifiedRow(rows, target)?.year ?? null },
        cached: false,
        requestCount: 1,
      };
    },
  };
}
