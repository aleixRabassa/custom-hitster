/**
 * The background year crawl.
 *
 * ===========================================================================
 *  WHY THIS LOOP IS SEQUENTIAL, AND WHY A 429 IS NOT AN ERROR.
 *
 *  Measured in Phase 2 (docs/agent_findings.md, 2026-08-04):
 *
 *    * a COLD year lookup costs **1.3-3.6 s** (two MusicBrainz requests, paced);
 *    * a CACHED one costs ~**0 ms**;
 *    * the MusicBrainz budget is **1 req/s GLOBAL ACROSS EVERY USER OF THE APP**,
 *      not per user, not per session -- `api/_lib/rate-limit.ts` enforces it
 *      out-of-process in Redis precisely because it has to be shared.
 *
 *  So a cold 100-card deck is MINUTES of wall clock no matter what this file
 *  does, and `Promise.all(deck.map(lookupYear))` would not make it faster: it
 *  would fire ~100 requests at a gate that admits one per second, take ~99
 *  429s, and spend the deck's whole budget on rejections.
 *
 *  A 429 from `/api/year` is therefore the DESIGNED back-pressure signal
 *  (shared/types.ts, decision 12), carrying `retryAfterMs`. On one, this loop
 *  waits and retries THE SAME CARD -- it does not mark it resolved, does not
 *  skip it, and does not count it as a failure.
 *
 *  What makes the wait bearable is not throughput, it is ordering: the deck is
 *  crawled in PLAY order and Start waits on card 1 alone
 *  (`gameReducer`'s card-1 gate). Do not "optimise" this into a parallel fetch.
 * ===========================================================================
 *
 * Framework-free by construction -- it must NEVER import React. The lookup, the sleep and the
 * result callbacks are all injected, which is what makes the sequencing, the back-off and the
 * teardown guarantees assertable in `resolver.test.ts` under the node environment, with no
 * fake timers and no network.
 */

import type { Card, TrackRef, YearConfidence } from '../../shared/types';
import type { YearLookupOutcome } from './year-client';

/** One completed lookup, in the shape `gameReducer`'s `YEAR_RESOLVED` consumes. */
export interface ResolvedYear {
  cardId: string;
  year: number | null;
  confidence: YearConfidence;
}

/**
 * The single network dependency: resolve one track, never throw. `year-client.ts`'s
 * `lookupYear` is the production implementation; the signal comes from `stop()`.
 */
export type ResolverLookup = (track: TrackRef, signal: AbortSignal) => Promise<YearLookupOutcome>;

export interface ResolverDeps {
  lookup: ResolverLookup;
  /** Injected so back-off is a recorded number in a test rather than real elapsed time. */
  sleep: (ms: number) => Promise<void>;
  onResolved: (resolved: ResolvedYear) => void;
  /** Called at most once, on `not-configured`. The crawl is over when it fires. */
  onLookupsUnavailable: () => void;
  /** Jitter source. Injectable purely so tests can assert exact delays; defaults to `Math.random`. */
  random?: () => number;
}

export interface YearResolver {
  /** Begin crawling. Idempotent: a second call on the same instance does nothing. */
  start(): void;
  /**
   * Resolve this card next, ahead of the ordered walk -- the player has landed on a card whose
   * year has not arrived. A no-op for a card that is already resolved or not in this deck.
   */
  prioritize(cardId: string): void;
  /** Abort the request in flight and guarantee no further callbacks. Not restartable. */
  stop(): void;
}

/**
 * How many times one card is tried per pass before it is set aside.
 *
 * Three, not more: every attempt is a second or more of a globally shared budget, and a fault
 * that survives three tries inside a few seconds is not the kind a fourth try fixes. The
 * deferred pass gives each of these cards one more chance later, when the blip may have passed.
 */
const MAX_ATTEMPTS_PER_PASS = 3;

/** First transient back-off; doubles per attempt (500 -> 1000 -> 2000 ms). */
const TRANSIENT_BASE_DELAY_MS = 500;

/**
 * Bounds on the server's `retryAfterMs`, because it is input from outside this module: a
 * garbage 0 would busy-spin against the gate, and a garbage 600000 would stall the deck for
 * ten minutes. The gate's own default wait is 1500 ms, so the floor sits well below it and the
 * ceiling well above.
 */
const RETRY_AFTER_FLOOR_MS = 500;
const RETRY_AFTER_CEILING_MS = 10_000;

/** Used when a 429 carries neither a body field nor a `Retry-After` header. */
const DEFAULT_RETRY_AFTER_MS = 1_500;

/**
 * Added to every back-off.
 *
 * Two tabs (or two players in the same room) that both hit the gate will otherwise wait the
 * same reported interval and collide again on the next tick, forever -- a small random offset
 * is what breaks the resonance.
 */
const JITTER_MS = 250;

/**
 * Create a resolver for ONE session's deck.
 *
 * Single-use: `stop()` is final, and the hook creates a new resolver per `START`. The deck is a
 * snapshot -- the resolver never reads game state back, which is what keeps it free of React
 * and free of the reducer.
 */
export function createYearResolver(deck: readonly Card[], deps: ResolverDeps): YearResolver {
  const random = deps.random ?? Math.random;

  /** Every distinct card, by id. A duplicated track is looked up ONCE and reported once. */
  const byId = new Map<string, Card>();
  /** Ids still needing a lookup, in DECK order -- i.e. play order (see `shuffle.ts`). */
  const order: string[] = [];
  /** Ids that will never be looked up again: reported, or given up on. */
  const settled = new Set<string>();
  /** Ids set aside by a transient failure, for one more pass after the main crawl. */
  const deferred: string[] = [];
  /** Ids the player is waiting on, newest last. */
  const priority: string[] = [];

  for (const card of deck) {
    if (byId.has(card.id)) continue;
    byId.set(card.id, card);

    // A resumed session arrives with most of the deck already filled (persistence.ts keeps the
    // years for exactly this reason). Re-resolving those would re-spend a globally shared
    // budget on work that is already done.
    if (card.year !== undefined) {
      settled.add(card.id);
      continue;
    }

    order.push(card.id);
  }

  /** Position in `order`. Never rewound -- a priority jump must not restart the crawl. */
  let cursor = 0;
  let started = false;
  let stopped = false;
  /** Set by `not-configured`: the one error that ends the whole crawl rather than one card. */
  let halted = false;

  // One controller for the resolver's lifetime. `stop()` aborts it, which cancels the request
  // in flight instead of leaving it to resolve into a reducer that has already ended.
  const controller = new AbortController();

  function start(): void {
    // Idempotent on purpose. React 19's StrictMode invokes an effect twice; the first resolver
    // is stopped by the effect's cleanup and this guard covers a double `start()` on the same
    // instance. Exactly one crawl runs either way.
    if (started || stopped) return;
    started = true;

    void crawl().catch((error: unknown) => {
      // `crawl()` handles every outcome it knows about, so this is a genuine bug (or an
      // injected `sleep` that rejected). Logged rather than swallowed silently.
      console.warn('[year-resolver] crawl stopped unexpectedly:', describe(error));
    });
  }

  function prioritize(cardId: string): void {
    if (stopped || halted) return;
    // Already resolved, or not part of this deck: nothing to jump the queue for. This is the
    // COMMON case, not an edge case -- the crawl usually stays ahead of the player.
    if (settled.has(cardId) || !byId.has(cardId)) return;
    if (priority.includes(cardId)) return;

    priority.push(cardId);
  }

  function stop(): void {
    stopped = true;
    controller.abort();
  }

  async function crawl(): Promise<void> {
    // ---- Main pass: the whole deck, in play order -------------------------------
    while (!stopped && !halted) {
      const cardId = takePriority() ?? takeNext();
      if (cardId === undefined) break;

      await attempt(cardId, false);
    }

    // ---- Deferred pass: one more try for cards a blip took out -------------------
    // Run ONCE, after the crawl, so a MusicBrainz hiccup does not permanently blank a third of
    // the deck. Only here does a failing card settle at `null` / `none`.
    while (!stopped && !halted) {
      const cardId = takePriority() ?? deferred.shift();
      if (cardId === undefined) break;

      await attempt(cardId, true);
    }
  }

  /** The next card the player is actually waiting on, skipping any that resolved meanwhile. */
  function takePriority(): string | undefined {
    while (priority.length > 0) {
      const cardId = priority.shift();
      if (cardId === undefined || settled.has(cardId)) continue;

      // If it was waiting in the deferred queue, take it out: it is being attempted right now.
      const waiting = deferred.indexOf(cardId);
      if (waiting !== -1) deferred.splice(waiting, 1);

      return cardId;
    }

    return undefined;
  }

  /** The next card in deck order. `cursor` only ever moves forward. */
  function takeNext(): string | undefined {
    while (cursor < order.length) {
      const cardId = order[cursor++];
      if (cardId === undefined) continue;
      // Serviced out of turn by a priority jump, or already set aside for the deferred pass.
      if (settled.has(cardId) || deferred.includes(cardId)) continue;

      return cardId;
    }

    return undefined;
  }

  /**
   * Resolve one card, retrying in place.
   *
   * `final` marks the deferred pass: a card that has run out of attempts settles at
   * `null` / `none` there, whereas in the main pass it is deferred instead.
   */
  async function attempt(cardId: string, final: boolean): Promise<void> {
    const card = byId.get(cardId);
    if (!card) return;

    let attempts = 0;

    while (!stopped && !halted) {
      const outcome = await lookupOnce(card);
      // Checked immediately after every await: `stop()` may have fired while the request was in
      // flight, and nothing may be reported into a dead reducer.
      if (stopped) return;

      if (outcome.ok) {
        settle(cardId, outcome.result.year, outcome.result.confidence);
        return;
      }

      switch (outcome.code) {
        case 'rate-limited':
          // BACK-PRESSURE, NOT FAILURE. Same card, no attempt consumed, nothing settled -- see
          // the block comment at the top of this file.
          await deps.sleep(retryAfterDelay(outcome.retryAfterMs));
          continue;

        case 'not-configured':
          // A deployment fault (`MUSICBRAINZ_USER_AGENT` unset) that will fail identically for
          // every remaining card. Hammering the other 99 with guaranteed 500s helps nobody, so
          // this is the ONE error that ends the crawl. The deck stays playable, just yearless.
          halted = true;
          report(() => {
            deps.onLookupsUnavailable();
          });
          return;

        case 'invalid-request':
          // The request itself is wrong, so every retry produces the identical 400. Settle this
          // card and carry on with the deck.
          settle(cardId, null, 'none');
          return;

        default: {
          // `upstream-unavailable`, `unexpected-payload`, `network`: transient enough to be
          // worth a retry, systematic enough not to be worth many.
          attempts++;
          if (attempts < MAX_ATTEMPTS_PER_PASS) {
            await deps.sleep(transientDelay(attempts));
            continue;
          }

          if (final) settle(cardId, null, 'none');
          else defer(cardId);
          return;
        }
      }
    }
  }

  /** One round trip. An injected lookup that rejects is treated as the network failure it is. */
  async function lookupOnce(card: Card): Promise<YearLookupOutcome> {
    try {
      // A `Card` is structurally a valid `TrackRef` (shared/types.ts), so it goes straight in.
      return await deps.lookup(card, controller.signal);
    } catch {
      return { ok: false, code: 'network' };
    }
  }

  function settle(cardId: string, year: number | null, confidence: YearConfidence): void {
    settled.add(cardId);
    report(() => {
      deps.onResolved({ cardId, year, confidence });
    });
  }

  function defer(cardId: string): void {
    if (!deferred.includes(cardId)) deferred.push(cardId);
  }

  /**
   * Invoke a consumer callback without letting it kill the crawl.
   *
   * A `dispatch` that throws is a bug in the consumer, and the honest response is to log it and
   * keep resolving the other 99 cards -- silently losing the rest of the deck to someone else's
   * exception would be a much harder fault to find.
   */
  function report(callback: () => void): void {
    if (stopped) return;

    try {
      callback();
    } catch (error) {
      console.warn('[year-resolver] result callback threw, continuing:', describe(error));
    }
  }

  function retryAfterDelay(retryAfterMs: number | undefined): number {
    const requested = retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
    const bounded = Math.min(Math.max(requested, RETRY_AFTER_FLOOR_MS), RETRY_AFTER_CEILING_MS);

    return bounded + jitter();
  }

  function transientDelay(attempt: number): number {
    const backoff = TRANSIENT_BASE_DELAY_MS * 2 ** (attempt - 1);

    return Math.min(backoff, RETRY_AFTER_CEILING_MS) + jitter();
  }

  function jitter(): number {
    return Math.floor(random() * JITTER_MS);
  }

  return { start, prioritize, stop };
}

/** A short, safe description of a thrown value -- never a stack trace, never a payload. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
