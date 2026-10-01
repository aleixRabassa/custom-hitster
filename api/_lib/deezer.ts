/**
 * The Deezer year provider: a keyless free-text search, then `track/{id}` for the verified
 * hits, answered as a `ProviderLookup`.
 *
 * BINDING, in the house decision/binding split. This file does HTTP and reads Deezer's JSON;
 * whether a row is the card's recording, and which row's date is the answer, is decided by
 * `shared/store-match.ts`, and what the answer is worth in the vote by
 * `shared/year-providers.ts`. Nothing here weighs a year.
 *
 * Registered by `api/year.ts` as `createDeezerLookup({ fetchImpl, gate })`, with Deezer's own
 * gate from `PROVIDER_GATES` (plan.year-fetch-rework-server.md, step 8) and wrapped in the
 * per-provider answer cache there, never here.
 *
 * ===========================================================================
 *  THE TWO REQUESTS, AND WHY EACH HAS THE SHAPE IT HAS
 *
 *  1. `GET /search?q=<primary artist> <cleaned title>&limit=10`. FREE TEXT. The
 *     advanced syntax `artist:"…" track:"…"` returned nothing for 540 of 542
 *     tracks (spike §4.1), so it is not a first attempt with a fallback -- it is
 *     simply not used. `limit=10` is what both spike harnesses sent.
 *  2. `GET /track/{id}` for the verified search rows, at most
 *     `DEEZER_TRACK_FETCH_LIMIT` of them, in Deezer's own relevance order. A
 *     search row has no release date (the inlined `album` carries none), so the
 *     date -- the whole answer -- costs one request per row. The ISRC is on both;
 *     it is read from the track body, falling back to the search row.
 *
 *  Verification happens on the SEARCH row, before any track is fetched, so an
 *  unverified row never costs a request.
 * ===========================================================================
 *
 * ===========================================================================
 *  THE OPEN QUESTION, SETTLED AT CAPTURE (2026-09-30): HOW MANY `track/{id}`?
 *
 *  Spike §4.1 said "one per verified hit"; §11.2 measured "2 requests per card".
 *  Both were true of the harness that produced them, and neither was a rule:
 *
 *  - §11.2's figure came from `latency.ts`, which fetched `track/{id}` for
 *    `data[0]` -- the first search row, VERIFIED OR NOT -- so it was search + 1
 *    by construction. A measurement artifact, not a verified-hit count.
 *  - The 542's data (`stores.ts`, the CSV) fetched the first FOUR search rows,
 *    verified or not, and verified afterwards (with contributors, see below).
 *  - The 22 ground-truth fixtures (`fixtures-check.ts`, spike §4.3) fetched every
 *    verified row of ten, unbounded.
 *
 *  The real cost is 1 + min(verified rows, bound). Measured:
 *
 *  - On the 542's recorded rows (verified within the top four): 18 cards have no
 *    verified row, 422 one, 80 two, 18 three, 4 four. Requests per card are 1.97
 *    at a bound of 1, 2.15 at 2, and 2.20 at 3 and at 4. Against the CSV's
 *    consensus year, the release-date year is exact on 382 / 385 / 389 / 389 of
 *    514, and the ISRC year on 379 / 381 / 381 / 381. (The consensus was itself
 *    built from those top-four rows, which flatters the deeper bounds a little;
 *    the direction -- more rows, earlier reissue dates -- is the one earliest-wins
 *    predicts.)
 *  - Live on 2026-09-30 over the 22 fixtures plus a seeded 30 of the 542: verified
 *    rows reach as deep as position 9 of 10, 0 to 4 per card, 1.40 on average; at
 *    this bound the adapter spent 122 Deezer requests on those 52 cards (2.35 each).
 *
 *  So the bound is 3: it takes every year the fourth fetch ever found on the
 *  542 (+7 exact over a bound of 1) for 0.23 of a request per card, and a fourth
 *  fetch bought nothing. "2 requests per card" is therefore a slight UNDERstatement
 *  of the adapter (~2.2-2.4 per card, and 1 when the search verifies nothing).
 * ===========================================================================
 *
 * TWO DEVIATIONS FROM THE 542's HARNESS, BOTH DELIBERATE AND BOTH CHEAPER:
 *
 * - **The credit is the search row's `artist.name` only.** The 542 matched the artist
 *   against `artist.name` AND the track body's `contributors`, which exist only after the
 *   fetch -- so it could only be done by fetching every row, which is the cost the bound
 *   exists to cap. The 22 fixtures' harness already verified on `artist.name` alone. On the
 *   seeded 30 of the 542, captured live, this adapter's release-date year equals the CSV's
 *   30 times of 30 and its ISRC year 29 times (the one miss is the ISRC pivot, not the
 *   credit: see `api/_lib/__fixtures__/deezer-payloads.ts`). The rows it can lose are
 *   collaborations where Spotify's first artist is only a Deezer contributor.
 * - **At most three rows are fetched, in relevance order**, where the 542 fetched the top
 *   four rows unverified and the fixtures every verified row of ten. See above.
 *
 * `excluded` is set for a row whose `type` Deezer reports as something other than `track`.
 * The search endpoint returns tracks only, so the flag has never fired on a capture; it is
 * there so a store-side shape change degrades to "no vote" rather than to a year read off an
 * album or an artist object.
 *
 * A LOOKUP WITH NO DURATION SENDS NOTHING. `shared/store-match.ts` verifies a row only when the
 * card's length is known too, so without one the search could only end in a null year; the
 * adapter answers that null directly, spending no permit and no request (`lookup`, step 0).
 *
 * FAILURE MAPPING. Deezer does not use HTTP status for its quota: a burst gets
 * `{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}` with **HTTP
 * 200** (spike §11.2; captured again 2026-09-30, 5 of 60 parallel searches). So the BODY is
 * read, on both requests, and code 4 is a `refused` skip (`quota error code 4`), as is an
 * HTTP 429 (`HTTP 429`) -- Deezer itself telling our shared egress IP to stop, which since
 * 2026-10-01 leaves Deezer out of the call rather than making it `busy` and retried
 * (`api/_lib/provider-lookup.ts` says why). Only a refused PERMIT from Deezer's own gate is
 * still `busy`. Code 700 (`SERVICE_BUSY` in Deezer's documented list) is refused too, by
 * name: it is the provider's own statement, and the one alternative, `unexpected-payload`,
 * would make it a transient failure -- retried, the very thing a refusal must not be. It has
 * never been observed. Code 800 (`DATA_NOT_FOUND`) on a track fetch drops that one row: the
 * track vanished between the two requests, and the other rows are still evidence. Any other
 * error body, or a body without a `data` array, is `unexpected-payload`. A failed, busy or
 * refused TRACK fetch ends the whole lookup with that outcome rather than answering from the
 * rows fetched so far: a partial answer could only be later than the full one, and it would
 * be cached for 30 days.
 */

import { earliestVerifiedRow, isVerifiedStoreRow } from '../../shared/store-match.js';
import type { DatedStoreRow, StoreRow, StoreTarget } from '../../shared/store-match.js';
import { isrcYear } from '../../shared/year-providers.js';
import type { ProviderLookup, ProviderLookupInput, ProviderOutcome } from './provider-lookup.js';
import {
  asFiniteNumber,
  asRecord,
  asString,
  refusedSkip,
  requestStoreJson,
  type StoreDeps,
} from './store-http.js';

export const DEEZER_API_ORIGIN = 'https://api.deezer.com';

/** Rows per search. What both spike harnesses sent; the answer rarely sits past row 4. */
export const DEEZER_SEARCH_LIMIT = 10;

/** The most `track/{id}` requests one lookup spends. Measured; see the header. */
export const DEEZER_TRACK_FETCH_LIMIT = 3;

/**
 * Deezer's documented error codes that mean "you are asking too much" rather than "wrong
 * request", each with the `refused` detail it is logged as: 4 (the quota, observed) and 700
 * (`SERVICE_BUSY`, never observed). See the header.
 */
const DEEZER_REFUSED_CODES: ReadonlyMap<number, string> = new Map([
  [4, 'quota error code 4'],
  [700, 'service-busy error code 700'],
]);

/** "No such object" -- a track that vanished between the search and the fetch. */
const DEEZER_NOT_FOUND_CODE = 800;

/** The search URL, exactly as the adapter requests it. Exported for the tests and the capture. */
export function deezerSearchUrl(primaryArtist: string, cleanedTitle: string): string {
  const query = encodeURIComponent(`${primaryArtist} ${cleanedTitle}`);
  return `${DEEZER_API_ORIGIN}/search?q=${query}&limit=${DEEZER_SEARCH_LIMIT}`;
}

/** The track URL for one search row's id. */
export function deezerTrackUrl(id: number): string {
  return `${DEEZER_API_ORIGIN}/track/${id}`;
}

/** One search row, normalised: a `StoreRow` plus what the second request needs. */
export interface DeezerSearchRow extends StoreRow {
  id: number;
  isrc: string | undefined;
}

type DeezerBody =
  { kind: 'ok'; record: Record<string, unknown> } | { kind: 'error'; code: number | undefined };

/** Split a parsed body into "an object" and "an `{error}` envelope". */
function readBody(body: unknown): DeezerBody | undefined {
  const record = asRecord(body);
  if (!record) return undefined;
  const error = asRecord(record['error']);
  if (error) return { kind: 'error', code: asFiniteNumber(error['code']) };
  return { kind: 'ok', record };
}

/** The detail is a fixed string per code; the body's `message` text never reaches a log. */
function refusedOrUnexpected(code: number | undefined): ProviderOutcome {
  const detail = code === undefined ? undefined : DEEZER_REFUSED_CODES.get(code);
  return detail !== undefined
    ? refusedSkip(detail)
    : { kind: 'failed', code: 'unexpected-payload' };
}

/**
 * Normalise a search body's `data` array. Tolerant: a row without a numeric id or any title
 * is skipped, and a missing duration becomes `undefined` (which then fails verification --
 * the rule, not this parser, decides). Returns `undefined` when there is no `data` array.
 */
export function deezerSearchRows(record: Record<string, unknown>): DeezerSearchRow[] | undefined {
  const data = record['data'];
  if (!Array.isArray(data)) return undefined;

  const rows: DeezerSearchRow[] = [];
  for (const item of data) {
    const row = asRecord(item);
    if (!row) continue;
    const id = asFiniteNumber(row['id']);
    const titles = [asString(row['title']), asString(row['title_short'])].filter(
      (title): title is string => title !== undefined && title !== '',
    );
    if (id === undefined || titles.length === 0) continue;

    const seconds = asFiniteNumber(row['duration']);
    const type = asString(row['type']);
    rows.push({
      id,
      titles,
      credit: asString(asRecord(row['artist'])?.['name']) ?? '',
      durationMs: seconds === undefined ? undefined : seconds * 1000,
      excluded: type !== undefined && type !== 'track',
      isrc: asString(row['isrc']),
    });
  }
  return rows;
}

/** The answer's two years from the dated rows. The ISRC year is the EARLIEST over them. */
function answerFrom(
  dated: readonly (DatedStoreRow & { isrc: string | undefined })[],
  target: StoreTarget,
): { year: number | null; isrcYear: number | null } {
  const earliest = earliestVerifiedRow(dated, target);

  // The minimum over every fetched verified row, independent of which row gave the
  // release-date year -- the spike's rule (§4.2's "Deezer ISRC year" row was computed this
  // way). An old recording's ISRC is usually assigned at a reissue, so it mostly errs late --
  // but NOT only late: a `GBSMU` bootleg code decodes to 1929 and, being the minimum, masks a
  // correct back-coded 1987 on Sweet Child O' Mine. Why that is left alone rather than floored
  // at 1986 is measured in `isrcYear`'s comment. A malformed code is null and dropped here, so
  // it never becomes the minimum.
  const isrcYears = dated
    .map((row) => (row.isrc === undefined ? null : isrcYear(row.isrc)))
    .filter((year): year is number => year !== null);

  return {
    year: earliest?.year ?? null,
    isrcYear: isrcYears.length > 0 ? Math.min(...isrcYears) : null,
  };
}

/**
 * Build the Deezer `ProviderLookup`. `deps.gate` must be Deezer's own gate: every request
 * (the search and each track fetch) takes one permit from it.
 */
export function createDeezerLookup(deps: StoreDeps): ProviderLookup {
  const request = (url: string, signal: AbortSignal | undefined) =>
    requestStoreJson(deps, url, {
      ...(signal ? { signal } : {}),
      // Deezer signals its quota in the body; a 429 would still mean the same thing.
      refusedStatuses: [429],
    });

  return {
    id: 'deezer',

    async lookup(input: ProviderLookupInput): Promise<ProviderOutcome> {
      const { primaryArtist } = input;
      const target: StoreTarget = {
        rawTitle: input.rawTitle,
        primaryArtist,
        durationMs: input.durationMs,
      };
      let requestCount = 0;

      // ---- 0. no length, no lookup ------------------------------------------
      // `failedStoreRules` in `shared/store-match.ts` passes a row only when BOTH lengths are
      // known, so a target without one can verify nothing and the answer is null before a byte is
      // sent. Spending the search (and a permit from a gate every player shares) would buy exactly
      // this answer. Built as the "searched and nothing verified" answer is below -- both years
      // null, `cached: false` -- so the driver cannot tell the two apart, and must not: they mean
      // the same thing. `withAnswerCache` refuses to write it either (its key has no duration).
      // If store-match ever learns to verify a length-less target, this line goes with that rule.
      if (input.durationMs === undefined) {
        return {
          kind: 'answer',
          answer: { provider: 'deezer', year: null, isrcYear: null },
          cached: false,
          requestCount: 0,
        };
      }

      // ---- 1. search ------------------------------------------------------
      const search = await request(
        deezerSearchUrl(primaryArtist, input.cleaned.title),
        input.signal,
      );
      if (search.kind !== 'ok') return search;
      requestCount += 1;

      const searchBody = readBody(search.body);
      if (!searchBody) return { kind: 'failed', code: 'unexpected-payload' };
      if (searchBody.kind === 'error') return refusedOrUnexpected(searchBody.code);

      const rows = deezerSearchRows(searchBody.record);
      if (!rows) return { kind: 'failed', code: 'unexpected-payload' };

      const toFetch = rows
        .filter((row) => isVerifiedStoreRow(row, target))
        .slice(0, DEEZER_TRACK_FETCH_LIMIT);

      // ---- 2. track/{id}, sequentially ------------------------------------
      // Sequential rather than `Promise.all`: every fetch waits on the same gate anyway, and
      // stopping at the first busy/refused/failed one spends no permit on a lookup already lost.
      const dated: (DatedStoreRow & { isrc: string | undefined })[] = [];
      for (const row of toFetch) {
        const track = await request(deezerTrackUrl(row.id), input.signal);
        if (track.kind !== 'ok') return track;
        requestCount += 1;

        const trackBody = readBody(track.body);
        if (!trackBody) return { kind: 'failed', code: 'unexpected-payload' };
        if (trackBody.kind === 'error') {
          if (trackBody.code === DEEZER_NOT_FOUND_CODE) continue;
          return refusedOrUnexpected(trackBody.code);
        }

        dated.push({
          ...row,
          date: asString(trackBody.record['release_date']) ?? '',
          isrc: asString(trackBody.record['isrc']) ?? row.isrc,
        });
      }

      const { year, isrcYear: isrc } = answerFrom(dated, target);
      return {
        kind: 'answer',
        answer: { provider: 'deezer', year, isrcYear: isrc },
        cached: false,
        requestCount,
      };
    },
  };
}
