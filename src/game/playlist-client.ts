/**
 * The browser's side of `GET /api/playlist`: build the query, map the response onto a typed
 * outcome, and never throw.
 *
 * Structurally a twin of `year-client.ts`, on purpose (decision 7). A plain async function with
 * an injected `fetch`, an injected abort signal, and a discriminated result -- which is what
 * lets every branch below be a unit test in the NODE environment with no jsdom and no network,
 * exactly as the year client's sixteen are. `usePlaylist` is the thin React seam over it and
 * holds nothing worth testing.
 *
 * NEVER THROWS. A failed playlist fetch is the landing screen's normal error path, not an
 * exception: the player pasted a private playlist, or the link was an album, or they are
 * offline. All three are results.
 */

import type { Card, PlaylistErrorCode, PlaylistResult, PlaylistSummary } from '../../shared/types';

/**
 * `PlaylistErrorCode` plus the failures that have no server-side existence.
 *
 * Client-only, so they are defined here rather than widening the shared union -- the server can
 * produce none of them, and adding them there would force `api/playlist.ts`'s exhaustive status
 * table to handle cases that cannot happen.
 *
 * - `network`: the request never completed. DNS, a dropped connection, an abort.
 * - `offline`: the request was never ATTEMPTED, because the browser already knows there is no
 *   connection. Distinct from `network` on purpose -- see `isBrowserOnline` below.
 * - `empty-playlist`: a well-formed 200 describing a deck with no cards in it. A valid answer to
 *   a valid question, not a parse failure.
 * - `unknown-error`: it completed with a failure this client cannot name. Today that is the
 *   handler's two UNTYPED codes -- `method-not-allowed` (405) and `internal-error` (500), neither
 *   of which is in `PlaylistErrorCode` -- plus any status a future deployment invents.
 */
export type PlaylistClientErrorCode =
  PlaylistErrorCode | 'network' | 'offline' | 'empty-playlist' | 'unknown-error';

export type PlaylistOutcome =
  { ok: true; result: PlaylistResult } | { ok: false; code: PlaylistClientErrorCode };

/**
 * The minimum of `fetch` this module needs, kept structural so a test double stays a one-liner.
 * The real global `fetch` satisfies it.
 */
export type PlaylistFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<PlaylistFetchResponse>;

export interface PlaylistFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface FetchPlaylistOptions {
  fetchImpl: PlaylistFetch;
  /**
   * Aborts the request in flight. `usePlaylist` fires this on unmount and on a new submission,
   * so a slow first request cannot land after a second one has already been answered.
   */
  signal?: AbortSignal;
  /**
   * Whether the browser has a connection. Defaults to `isBrowserOnline`.
   *
   * INJECTED RATHER THAN READ, for the same reason `fetchImpl` is: this module's tests are NODE
   * tests with no jsdom and no network, and that property is what makes every status branch cheap
   * to cover. A bare `navigator.onLine` read in the module body would trade it away for one
   * boolean. It also mirrors `StorageLike` in `persistence.ts`, so it is the house style here
   * rather than a workaround.
   */
  isOnline?: () => boolean;
}

/**
 * The default online check: what the browser thinks of its own connectivity.
 *
 * ===========================================================================
 *  `navigator.onLine` REPORTS AN INTERFACE, NOT REACHABILITY.
 *
 *  A captive portal -- hotel Wi-Fi, a conference network, a train -- reports
 *  ONLINE and still fails every request. So this check can only ever be a fast
 *  path for the case the browser is certain about; it cannot be the only check.
 *  That is exactly why `network` stays as the fallback for a request that was
 *  attempted and failed, and why the two codes have different copy. Merging them
 *  would make one of them lie.
 *
 *  Exported so its own guard can be asserted directly. An ABSENT `navigator` is
 *  treated as online: this module runs under the node environment in every one of
 *  its tests, and refusing to fetch there because a DOM global is missing would
 *  be a false negative in the one environment that cannot be offline.
 * ===========================================================================
 */
export function isBrowserOnline(): boolean {
  // Read defensively rather than as `navigator.onLine`: node has a `navigator` with no `onLine`
  // at all, and older runtimes have no `navigator` whatsoever. Both mean "cannot tell", which
  // resolves to online.
  const candidate = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
  const onLine = candidate?.onLine;

  return typeof onLine === 'boolean' ? onLine : true;
}

/** The endpoint. Same-origin and relative, so preview deployments and production both just work. */
const PLAYLIST_ENDPOINT = '/api/playlist';

/**
 * Fallback status -> code mapping, used only when the response body carries no recognizable
 * `code`.
 *
 * ===========================================================================
 *  502 IS DELIBERATELY ABSENT FROM THIS TABLE.
 *
 *  `upstream-unavailable` and `unexpected-payload` BOTH map to 502
 *  (`api/playlist.ts`'s own table), and the two mean opposite things: the first
 *  is transient and worth retrying, the second means the embed scrape broke and
 *  no amount of retrying will help. They are distinguishable ONLY by the body's
 *  `code`, so guessing one from the status would be a coin flip presented to the
 *  player as a diagnosis. A bodyless 502 therefore degrades to `unknown-error`
 *  instead, whose copy promises nothing.
 *
 *  The year client faces the same problem with 500 and resolves it the same way,
 *  for the same reason. See `STATUS_FALLBACK` there.
 * ===========================================================================
 */
const STATUS_FALLBACK: Record<number, PlaylistClientErrorCode> = {
  400: 'invalid-url',
  404: 'not-found-or-private',
};

/** Every code the server can send, as a runtime guard -- a response body is untrusted input. */
const SERVER_ERROR_CODES: readonly string[] = [
  'invalid-url',
  'unsupported-entity',
  'not-found-or-private',
  'upstream-unavailable',
  'unexpected-payload',
];

/**
 * Fetch and validate a deck for one playlist URL.
 *
 * The URL is sent RAW, exactly as the player typed it, and the server owns every question about
 * what it means -- parsing, short-link resolution, entity checks. The landing screen validates
 * client-side too, but only to avoid a pointless round trip; it never rewrites what it sends,
 * because a client and server that each normalise a little are how the two drift apart.
 */
export async function fetchPlaylist(
  url: string,
  options: FetchPlaylistOptions,
): Promise<PlaylistOutcome> {
  /*
    ===========================================================================
     CHECKED BEFORE THE FETCH, AND SHORT-CIRCUITING IT.

     A request that cannot succeed should not be made: without this the player
     watches the Start button say "Loading…" for however long the browser takes
     to give up, and is then told to check a connection the browser already knew
     was missing. The answer is available synchronously, so waiting for it is
     pure latency.

     This does NOT make `network` redundant -- see `isBrowserOnline`.
    ===========================================================================
  */
  const isOnline = options.isOnline ?? isBrowserOnline;
  if (!isOnline()) return { ok: false, code: 'offline' };

  const query = new URLSearchParams({ url });

  /*
    ===========================================================================
     DESTRUCTURED BEFORE THE CALL, AND THAT IS LOAD-BEARING.

     `options.fetchImpl(...)` is a METHOD call, so the function runs with
     `options` as its receiver. The browser's native `fetch` is brand-checked:
     given a receiver that is not the global object it throws

       TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation

     ...which the `catch` below then reports as `network` -- "Could not reach the
     server" for a request that was never attempted. Every Start in a real
     browser failed that way. NOTHING in this repo could catch it: every test
     stub here is a plain function with no brand check, and the node
     environment's `fetch` has none either.

     A bare call passes `undefined`, which WebIDL resolves to the global, so this
     works for the real `fetch` and for any stub alike. The injection sites bind
     as well (`usePlaylist`, `use-game-session`) -- belt and braces, because the
     failure is invisible until someone opens the app.
    ===========================================================================
  */
  const { fetchImpl } = options;

  let response: PlaylistFetchResponse;
  try {
    const init = options.signal ? { signal: options.signal } : undefined;
    response = await fetchImpl(`${PLAYLIST_ENDPOINT}?${query.toString()}`, init);
  } catch {
    // A DNS failure, a dropped connection, a captive portal, or an abort. All of them are "the
    // request did not complete"; an abort is only ever caused by this app itself moving on, so it
    // needs no separate code.
    //
    // Still reachable with `isOnline()` true, which is the point of keeping both codes: the
    // predicate above knows about a missing interface, not about an unreachable server.
    return { ok: false, code: 'network' };
  }

  const body = await readJson(response);

  if (response.ok) {
    // =======================================================================
    //  A 200 THAT IS NOT JSON IS THE `pnpm dev` TRAP, AND IT IS NOT THEORETICAL.
    //
    //  Vite's dev server does not run functions -- it serves `api/playlist.ts`
    //  as a module, so the response is the TRANSPILED SOURCE of the handler
    //  with status 200. Anyone who runs `pnpm dev` instead of `npx vercel dev`
    //  hits exactly this, on their very first Start.
    //
    //  `readJson` swallows the parse failure and `parsePlaylistBody` rejects the
    //  `undefined`, so it surfaces as `unexpected-payload` -- a sentence the
    //  player can read -- rather than as a raw `SyntaxError` from deep inside a
    //  promise chain. See `docs/development.md`.
    // =======================================================================
    //
    // Returned as-is: the parse's own outcome is already a `PlaylistOutcome`, and its two failure
    // codes are the two different things a 200 can be wrong in.
    return parsePlaylistBody(body);
  }

  const code = errorCodeFrom(body) ?? STATUS_FALLBACK[response.status] ?? 'unknown-error';

  return { ok: false, code };
}

/** A body that will not parse is not an error here -- the status still carries the meaning. */
async function readJson(response: PlaylistFetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * The 200-body parse, as an outcome rather than a `PlaylistResult | undefined`.
 *
 * Two DIFFERENT things can be wrong with a 200 and they need different sentences, which a single
 * `undefined` return could not express -- see the empty-deck branch below.
 */
type PlaylistBodyOutcome =
  | { ok: true; result: PlaylistResult }
  | { ok: false; code: 'unexpected-payload' | 'empty-playlist' };

/** Every malformed-body exit goes through this, so the common case reads as one word. */
const MALFORMED: PlaylistBodyOutcome = { ok: false, code: 'unexpected-payload' };

/**
 * Validate a 200 body before handing it to the reducer.
 *
 * The point is to catch "this is not a playlist response at all" -- transpiled source, an HTML
 * error page, a rewritten route -- not to re-implement the server's types. But the deck itself
 * IS validated card by card, unlike the year client's single result, because `START` shuffles
 * this array and every card in it reaches a render: one malformed entry would surface as a blank
 * card mid-game, a long way from its cause.
 *
 * ===========================================================================
 *  AN EMPTY DECK IS STILL REJECTED -- BUT AS ITS OWN CODE, NOT AS A PARSE FAILURE.
 *
 *  It has to be rejected: `START` would deal a deck whose `currentCard` is
 *  undefined on the very first frame. But through Phase 6 it was rejected as
 *  `unexpected-payload`, whose copy reads "Spotify returned something we could
 *  not read. This is a problem on our side, not with your link." That is a
 *  confident, wrong answer -- the payload was perfectly readable and said,
 *  correctly, that the playlist has nothing playable in it.
 *
 *  IT IS REACHABLE IN PRODUCTION, not just through a stub. Verified by reading
 *  the whole path 2026-08-06: `api/_lib/spotify-embed.ts` accepts an empty
 *  `trackList` (it only requires an ARRAY), and `api/playlist.ts` forwards
 *  whatever the adapter returns. So an empty public playlist -- or one whose
 *  every track was skipped, which `skippedCount` reaching the raw length also
 *  produces -- arrives here as a 200 with `cards: []`. NO layer above this one
 *  owns the case.
 * ===========================================================================
 */
function parsePlaylistBody(body: unknown): PlaylistBodyOutcome {
  const record = asRecord(body);
  if (!record) return MALFORMED;

  const playlist = asPlaylistSummary(record['playlist']);
  if (!playlist) return MALFORMED;

  const rawCards = record['cards'];
  // Not an array is a MALFORMED payload; an array with nothing in it is a well-formed payload
  // describing an empty deck. Collapsing the two is the defect this split exists to fix, so the
  // two conditions stay on separate lines with separate returns.
  if (!Array.isArray(rawCards)) return MALFORMED;
  if (rawCards.length === 0) return { ok: false, code: 'empty-playlist' };

  const cards: Card[] = [];
  for (const entry of rawCards) {
    const card = asCard(entry);
    if (!card) return MALFORMED;
    cards.push(card);
  }

  if (typeof record['truncated'] !== 'boolean') return MALFORMED;

  const skippedCount = record['skippedCount'];
  if (typeof skippedCount !== 'number' || !Number.isFinite(skippedCount)) return MALFORMED;

  return { ok: true, result: { playlist, cards, truncated: record['truncated'], skippedCount } };
}

function asPlaylistSummary(value: unknown): PlaylistSummary | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const { id, name, owner } = record;
  if (typeof id !== 'string' || id === '') return undefined;
  if (typeof name !== 'string' || typeof owner !== 'string') return undefined;

  return { id, name, owner };
}

/**
 * Rebuilt field by field rather than cast, exactly as `persistence.ts` does it and for the same
 * reason: copying a response's extra fields into live state wholesale is how a "validated"
 * object smuggles something unvalidated into the reducer.
 *
 * `year` is never expected here -- `/api/playlist` cannot know one, since the embed payload
 * carries no release date -- but the three-state shape is honoured anyway rather than dropped,
 * so a future server that did fill it in would not have its answer silently discarded.
 */
function asCard(value: unknown): Card | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const { id, title, artist, durationMs, isPlayable, previewUrl, year, yearConfidence } = record;

  if (typeof id !== 'string' || id === '') return undefined;
  if (typeof title !== 'string' || typeof artist !== 'string') return undefined;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return undefined;
  if (typeof isPlayable !== 'boolean') return undefined;
  if (previewUrl !== undefined && typeof previewUrl !== 'string') return undefined;
  if (year !== undefined && year !== null && typeof year !== 'number') return undefined;
  if (
    yearConfidence !== undefined &&
    yearConfidence !== 'high' &&
    yearConfidence !== 'low' &&
    yearConfidence !== 'none'
  ) {
    return undefined;
  }

  const card: Card = { id, title, artist, durationMs, isPlayable };
  // Left ABSENT rather than set to undefined: `Card.year`'s three states distinguish a missing
  // key from a null, and `isCurrentYearPending` reads exactly that difference.
  if (previewUrl !== undefined) card.previewUrl = previewUrl;
  if (year !== undefined) card.year = year;
  if (yearConfidence !== undefined) card.yearConfidence = yearConfidence;

  return card;
}

/** The body's `code`, when it is one the server is known to send. */
function errorCodeFrom(body: unknown): PlaylistErrorCode | undefined {
  const code = asRecord(body)?.['code'];
  if (typeof code !== 'string' || !SERVER_ERROR_CODES.includes(code)) return undefined;

  return code as PlaylistErrorCode;
}
