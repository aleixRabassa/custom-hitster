/**
 * The background year crawl: two lanes, one request in flight PER STAGE.
 *
 * ===========================================================================
 *  WHY EACH LANE IS SEQUENTIAL, AND WHY A 429 IS NOT AN ERROR.
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
 *  Since 2026-09-30 a lookup has TWO stages (plan.year-fetch-rework-game.md,
 *  `/api/year?stage=resolve|verify`): `resolve` answers fast and possibly
 *  PROVISIONALLY, `verify` asks the precision provider and is final. Each stage
 *  sits behind its own provider gates on the server, so this file runs one
 *  LANE per stage and NEVER MORE THAN ONE REQUEST IN FLIGHT PER STAGE:
 *
 *    * one slot per stage, not one queue with two slots -- both slots of a
 *      shared queue could take `resolve` work at once, and one client would then
 *      hold two MusicBrainz lookups against a gate shared by every user as a
 *      matter of course. One slot per stage NORMALLY means one MusicBrainz lookup
 *      per client, not always: the server's `verify` re-runs `resolve`'s
 *      frontiers first (`STAGES_RUN` in api/_lib/year-pipeline.ts), so a card
 *      with no cached `mbyear:` answer -- its resolve-stage MusicBrainz lookup
 *      failed, MusicBrainz was BUSY during resolve (its gate full under
 *      contention), the entry was evicted, or always under `vercel dev`'s
 *      per-process cache -- has its verify request call MusicBrainz too, while
 *      the resolve lane may be calling it for another card. That brief second
 *      lookup was accepted (2026-10-01): skipping MusicBrainz in verify would
 *      lose its vote -- the best coverage of old catalogue and the only "first
 *      release" date -- on exactly the cards whose first try failed. The busy
 *      case is the one contention makes common: that 200 carries the gate's
 *      `retryAfterMs` and the resolve lane SLEEPS it (below) instead of firing
 *      its next card into the full gate. That cuts the waiters but does NOT
 *      guarantee one: the handed-off card's verify re-ask usually meets the same
 *      full gate, gets a 429 and sleeps about as long, so the two lanes can wake
 *      together and each send a lookup;
 *    * one resolver, not two independent workers -- the hand-off from resolve
 *      to verify would land in the React hook (whose header forbids logic),
 *      there would be two teardowns to get right, and nothing would push the
 *      START card into verification while the loading screen waits on it.
 *
 *  A 429 from `/api/year` is the DESIGNED back-pressure signal (shared/types.ts,
 *  decision 12), carrying `retryAfterMs`. On one, ONLY THAT LANE sleeps, and
 *  then it PICKS AGAIN rather than blindly retrying: a player who moved on
 *  while it slept is served first. The card is not marked resolved, not
 *  skipped, and not counted as a failure.
 *
 *  The same signal can also ride on a 200 (2026-10-01): a `resolve` that had a
 *  year in hand when a provider was busy answers with that year, NOT final,
 *  plus the `retryAfterMs` the 429 would have carried. The resolve lane treats
 *  the answer exactly as any non-final one -- the provisional year is reported
 *  and the card handed to verify -- and THEN sleeps that delay before its next
 *  pick, the same back-off a 429 gets and likewise counted as no attempt. The
 *  verify lane never receives the field: `verify` answers busy with the 429.
 *
 *  What makes the wait bearable is not throughput, it is ordering: the resolve
 *  lane crawls in PLAY order from the card the player starts on, the verify
 *  lane serves the card the player is on and the few just ahead of it first,
 *  and Start waits on the start card alone (`gameReducer`'s gate). Do not
 *  "optimise" either lane into a parallel fetch.
 * ===========================================================================
 *
 * ===========================================================================
 *  EVERY CARD IS IN EXACTLY ONE OF THREE STAGE STATES.
 *
 *    needs-resolve -> (resolve: final)                     -> final
 *    needs-resolve -> (resolve: provisional or nothing)    -> needs-verify
 *    needs-resolve -> (resolve: retries run out)           -> needs-verify
 *    needs-resolve -> (resolve: invalid-request)           -> final (null)
 *    needs-verify  -> (verify: final, or retries run out)  -> final
 *
 *  Seeded from the deck at creation: an undefined year needs resolve, a
 *  `yearProvisional` year needs verify (a resumed provisional card goes
 *  STRAIGHT to verification), and anything else -- a settled year or a final
 *  `null` -- is final. The seed used to be "has a year = done", which would
 *  have marked a resumed provisional card final and never verified it.
 *
 *  A card whose verify retries run out settles FINAL at the best single answer
 *  it has (spike §10.3): its provisional year at `low`, or `null` if resolve
 *  found nothing either, or never answered. Otherwise it would wait forever,
 *  and the PDF with it.
 *
 *  A card whose RESOLVE retries run out (both passes) is handed to verify
 *  exactly like a resolve that found nothing -- it does NOT settle null
 *  (2026-10-01, the developer's ruling, reversing plan 3 step 4's "the deferred
 *  pass settles null exactly as today"). The server's rule is that a transient
 *  failure is never a final "no year", and `verify` asks more providers
 *  (iTunes, plus another MusicBrainz try); with "Keep cards with no year
 *  found" OFF a final null DROPS the card, so settling one here would let a
 *  provider outage drop cards on the client that the server was built not to.
 *  The card carries no provisional year, so if verify runs out as well it
 *  settles final null -- the ONLY route to a null after transient failures.
 *  `invalid-request` still settles null at once: every retry, verify's
 *  included, would be the identical 400.
 * ===========================================================================
 *
 * Framework-free by construction -- it must NEVER import React. The lookup, the sleep and the
 * result callbacks are all injected, which is what makes the sequencing, the back-off and the
 * teardown guarantees assertable in `resolver.test.ts` under the node environment, with no
 * fake timers and no network. The verify lane's idle wait is a PROMISE the other lane settles,
 * never a timer, for the same reason.
 */

import type { Card, TrackRef, YearConfidence, YearStage } from '../../shared/types';
import type { YearLookupOutcome } from './year-client';

/**
 * One report, in a shape assignable to either arm of `gameReducer`'s `YEAR_RESOLVED`
 * (`YearResolvedAction` in `types.ts`):
 *
 * - the FINAL arm: a number or null, plus its confidence. No later report can change it;
 * - the PROVISIONAL arm: a `resolve`-stage year that `verify` has not answered yet. Always a
 *   number and always `low`. There is no provisional null -- a resolve that found nothing
 *   reports nothing, and the card simply stays pending.
 */
export type ResolvedYear =
  | { cardId: string; year: number | null; confidence: YearConfidence; unverified?: true }
  | { cardId: string; year: number; confidence: 'low'; provisional: true };

/**
 * The single network dependency: run one stage for one track, never throw. `year-client.ts`'s
 * `lookupYear` is the production implementation; the signal comes from `stop()`.
 */
export type ResolverLookup = (
  track: TrackRef,
  stage: YearStage,
  signal: AbortSignal,
) => Promise<YearLookupOutcome>;

export interface ResolverDeps {
  lookup: ResolverLookup;
  /** Injected so back-off is a recorded number in a test rather than real elapsed time. */
  sleep: (ms: number) => Promise<void>;
  onResolved: (resolved: ResolvedYear) => void;
  /** Called at most once, on `not-configured`. Both lanes are over when it fires. */
  onLookupsUnavailable: () => void;
  /** Jitter source. Injectable purely so tests can assert exact delays; defaults to `Math.random`. */
  random?: () => number;
  /**
   * The deck index the player starts on (2026-09-29); defaults to 0. The resolve lane walks from
   * here to the end of the deck and THEN wraps round to the cards before it -- see `order` below
   * -- and this card is the verify lane's first "current card". Anything that is not an integer
   * inside the deck is treated as 0.
   */
  startIndex?: number;
}

export interface YearResolver {
  /** Begin both lanes. Idempotent: a second call on the same instance does nothing. */
  start(): void;
  /**
   * The player has landed on this card. It becomes the verify lane's "current card" (served
   * first, and the anchor of the look-ahead window); if its year has not even been resolved, it
   * also jumps the resolve lane's ordered walk. Queues no request for a card that is already
   * final, and ignores a card that is not in this deck.
   */
  prioritize(cardId: string): void;
  /** Abort both lanes' requests in flight and guarantee no further callbacks. Not restartable. */
  stop(): void;
}

type StageState = 'needs-resolve' | 'needs-verify' | 'final';

/**
 * How many times one card is tried per pass before it is set aside.
 *
 * Three, not more: every attempt is a second or more of a globally shared budget, and a fault
 * that survives three tries inside a few seconds is not the kind a fourth try fixes. Each lane
 * gives a card that ran out one more pass later, when the blip may have passed -- so a card gets
 * at most `MAX_ATTEMPTS_PER_PASS * PASSES_PER_STAGE` transient failures per stage, exactly the
 * budget the one-stage crawl had.
 */
const MAX_ATTEMPTS_PER_PASS = 3;
const PASSES_PER_STAGE = 2;

/** First transient back-off; doubles per attempt. With three attempts a pass, that is 500 then 1000 ms. */
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
 * How many cards AHEAD of the current one the verify lane serves before falling back to its
 * first-in-first-out queue (plan.year-fetch-rework-game.md, Open Question 1 -- answered
 * 2026-09-30 with 3).
 *
 * Three because it is roughly how many cards a quick table plays while one cold verify round
 * trip and its retries are outstanding: the next few cards are the ones whose provisional year
 * the player is about to read, and anything further out has the whole of those cards' play time
 * to be verified in FIFO order anyway. Larger buys little -- the resolve lane queues cards in
 * play order, so FIFO is already close to "nearest first" -- and smaller stops covering a
 * player who swipes two cards in a row. The number is a guess to be tuned on a device, not a
 * measurement; the comment is here so nobody mistakes it for one.
 *
 * Counted FORWARD only, with no wrap: stepping back is rare, and a card behind the player
 * that they did step back to is the current card, which is served first regardless.
 */
const VERIFY_LOOKAHEAD_CARDS = 3;

/**
 * Create a resolver for ONE session's deck.
 *
 * Single-use: `stop()` is final, and the hook creates a new resolver per `START`. The deck is a
 * snapshot -- the resolver never reads game state back, which is what keeps it free of React
 * and free of the reducer. Dropping cards never reorders a deck, so positions in the snapshot
 * stay a faithful map of "ahead of the player" for the whole session.
 */
export function createYearResolver(deck: readonly Card[], deps: ResolverDeps): YearResolver {
  const random = deps.random ?? Math.random;

  /** Every distinct card, by id. A duplicated track is looked up ONCE per stage and reported once. */
  const byId = new Map<string, Card>();
  /** Each distinct id's FIRST position in the snapshot deck -- what the look-ahead window reads. */
  const indexById = new Map<string, number>();
  /** Which stage each distinct card still needs. See the second block at the top of the file. */
  const stageOf = new Map<string, StageState>();
  /**
   * The latest provisional year per card: what an exhausted verify settles at. Seeded from a
   * resumed provisional card's own year, and updated by every provisional report.
   */
  const provisionalYear = new Map<string, number>();

  /**
   * Ids needing resolve, in PLAY order starting from `startIndex`: deck indices
   * `startIndex..n-1`, then `0..startIndex-1`. For every deal that starts on card 1 that is
   * plain deck order (see `shuffle.ts`).
   *
   * ===========================================================================
   *  ROTATED, NOT DECK ORDER, SINCE 2026-09-29 -- because a shared mid-game link
   *  starts the player on the sender's card.
   *
   *  Plain deck order would spend the first lookup on card 1 (the gate would
   *  wait on a card nobody is looking at until the priority jump caught up), and
   *  because `cursor` never rewinds, a player starting at card 20 would outrun
   *  the crawl on every single advance. Walking from the start card keeps the
   *  crawl ahead of the player in the direction they are actually going; the
   *  cards before it are the ones they reach only by stepping BACK, so they go
   *  last, and the priority jump covers a player who steps back before the crawl
   *  gets there. A resumed session passes its `currentIndex` here for the same
   *  reason.
   * ===========================================================================
   */
  const order: string[] = [];
  /** Ids the resolve lane set aside after a transient failure, for its deferred pass. */
  const resolveDeferred: string[] = [];
  /** Transient failures of the card's CURRENT pass, per lane. Cleared on settle and on defer. */
  const resolveAttempts = new Map<string, number>();
  const verifyAttempts = new Map<string, number>();

  /**
   * Ids needing verify, first in first out. Seeded with resumed provisional cards in play order;
   * the resolve lane appends in the order it finishes, which is play order too. A card that ran
   * out of verify attempts once is moved to the BACK -- the verify lane's deferred pass.
   */
  const verifyQueue: string[] = [];
  /** Completed verify passes per card: reaching `PASSES_PER_STAGE` settles it final. */
  const verifyPasses = new Map<string, number>();
  /**
   * Cards for which some `verify` came back with a year, even a non-final one: the server took the
   * vote (over live or cached answers) without a confirmation. In memory only, so a resumed card
   * starts without it. What decides, on exhaustion, between
   * an UNCONFIRMED year and an UNVERIFIED one -- see `settleExhausted`.
   */
  const verifyAnswered = new Set<string>();

  const requestedStart = deps.startIndex ?? 0;
  const startIndex =
    Number.isInteger(requestedStart) && requestedStart >= 0 && requestedStart < deck.length
      ? requestedStart
      : 0;
  const rotated = [...deck.slice(startIndex), ...deck.slice(0, startIndex)];

  deck.forEach((card, index) => {
    if (!indexById.has(card.id)) indexById.set(card.id, index);
  });

  for (const card of rotated) {
    if (byId.has(card.id)) continue;
    byId.set(card.id, card);

    // A resumed session arrives with most of the deck already filled (persistence.ts keeps the
    // years for exactly this reason), and re-running a stage already done would re-spend a
    // globally shared budget. But "has a year" is NOT "done" any more: a provisional year still
    // owes its verify, and marking it final here would leave it provisional for ever.
    if (card.year === undefined) {
      stageOf.set(card.id, 'needs-resolve');
      order.push(card.id);
    } else if (card.year !== null && card.yearProvisional === true) {
      stageOf.set(card.id, 'needs-verify');
      provisionalYear.set(card.id, card.year);
      verifyQueue.push(card.id);
    } else {
      stageOf.set(card.id, 'final');
    }
  }

  /**
   * The card the player is on: served first by BOTH lanes, and the anchor of the verify lane's
   * look-ahead window. Seeded with the start card, because the loading screen waits on it
   * before the hook's `prioritize` has anything to say -- and during `preparing` the current
   * card never changes, so a `prioritize` that fired once would never fire again. Keeping the
   * current card HERE is what closes that "card-1 gap": the moment its resolve answer lands
   * provisional, it is the verify lane's first pick.
   */
  let currentId: string | undefined = rotated[0]?.id;
  /**
   * A one-shot jump of the resolve lane's walk, set by `prioritize` for a card still needing
   * resolve. One-shot (cleared when the card leaves its attempt) rather than "current first
   * forever", because a current card that keeps failing would otherwise be retried in a loop
   * instead of being deferred like any other.
   */
  let resolveUrgent: string | undefined;

  /** Position in `order`. Never rewound -- a priority jump must not restart the crawl. */
  let cursor = 0;
  let resolvePhase: 'main' | 'deferred' = 'main';
  let resolveDone = false;
  let started = false;
  let stopped = false;
  /** Set by `not-configured`: the one error that ends both lanes rather than one card. */
  let halted = false;

  /** Wakes an idle verify lane. Replaced on every wake, so each wait gets a fresh promise. */
  let wakeVerify: (() => void) | undefined;

  // One controller for the resolver's lifetime, shared by both lanes. `stop()` aborts it, which
  // cancels both requests in flight instead of leaving them to resolve into a reducer that has
  // already ended.
  const controller = new AbortController();

  function start(): void {
    // Idempotent on purpose. React 19's StrictMode invokes an effect twice; the first resolver
    // is stopped by the effect's cleanup and this guard covers a double `start()` on the same
    // instance. Exactly one pair of lanes runs either way.
    if (started || stopped) return;
    started = true;

    runLane('resolve', resolveLane);
    runLane('verify', verifyLane);
  }

  function runLane(stage: YearStage, lane: () => Promise<void>): void {
    void lane().catch((error: unknown) => {
      // Each lane handles every outcome it knows about, so this is a genuine bug (or an
      // injected `sleep` that rejected). Logged rather than swallowed silently.
      console.warn(`[year-resolver] ${stage} lane stopped unexpectedly:`, describe(error));
    });
  }

  function prioritize(cardId: string): void {
    if (stopped || halted) return;
    // Not part of this deck: nothing to serve.
    const stage = stageOf.get(cardId);
    if (stage === undefined) return;

    // The anchor moves even for a FINAL card -- the COMMON case, since the lanes usually stay
    // ahead of the player -- because the look-ahead window is "the cards ahead of wherever the
    // player is". A final card still queues no request of its own.
    currentId = cardId;

    // A card needing verify needs nothing more: "current card first" is the verify lane's own
    // first rule, and that lane is only ever idle when there is no verify work at all.
    if (stage === 'needs-resolve') resolveUrgent = cardId;
  }

  function stop(): void {
    stopped = true;
    controller.abort();
    notifyVerify();
  }

  function halt(): void {
    // `not-configured`: plan 2 returns it only when EVERY provider is unconfigured, so it fails
    // identically for every remaining card in BOTH stages. Hammering the rest of the deck with
    // guaranteed 500s helps nobody, so this is the ONE error that ends both lanes. The deck
    // stays playable, just yearless. The other lane's request in flight is aborted with it.
    if (halted) return;
    halted = true;
    controller.abort();
    notifyVerify();
    report(() => {
      deps.onLookupsUnavailable();
    });
  }

  function isOver(): boolean {
    return stopped || halted;
  }

  // ---- Resolve lane -----------------------------------------------------------

  async function resolveLane(): Promise<void> {
    try {
      while (!isOver()) {
        const cardId = pickResolve();
        if (cardId === undefined) break;

        await resolveOnce(cardId);
      }
    } finally {
      // However the lane ended, an idle verify lane must learn that no more work is coming --
      // otherwise it waits on a promise nobody will ever settle.
      resolveDone = true;
      notifyVerify();
    }
  }

  /**
   * The next card to resolve: the urgent card, then the ordered walk, then -- once the walk is
   * exhausted -- the deferred pass. Re-evaluated before EVERY request, so a card interrupted by a
   * 429 is simply picked again unless the player has moved to one that needs resolving.
   */
  function pickResolve(): string | undefined {
    if (resolveUrgent !== undefined) {
      // A deferred card that is urgent is attempted now but deliberately LEFT in the deferred
      // queue: if a 429 interrupts it and the player then moves on, the queue is what still
      // remembers it -- taken out, it would sit behind the cursor and in no queue at all, pending
      // for ever. Running out again leaves it deferred (or, in the deferred pass, hands it to
      // verify).
      if (stageOf.get(resolveUrgent) === 'needs-resolve') return resolveUrgent;

      resolveUrgent = undefined;
    }

    if (resolvePhase === 'main') {
      while (cursor < order.length) {
        const cardId = order[cursor];
        // Serviced out of turn by a priority jump, or already set aside for the deferred pass.
        // `cursor` only advances past a card once it is no longer this pass's business, so a
        // card interrupted mid-attempt is picked again rather than skipped.
        if (
          cardId !== undefined &&
          stageOf.get(cardId) === 'needs-resolve' &&
          !resolveDeferred.includes(cardId)
        ) {
          return cardId;
        }
        cursor++;
      }

      // ---- Deferred pass: one more try for cards a blip took out -------------------
      // Run ONCE, after the crawl, so a hiccup does not permanently blank a third of the deck.
      // A card that fails here too is handed to verify, never settled null -- see the second
      // block at the top of the file.
      resolvePhase = 'deferred';
    }

    while (resolveDeferred.length > 0) {
      const cardId = resolveDeferred[0];
      if (cardId !== undefined && stageOf.get(cardId) === 'needs-resolve') return cardId;
      resolveDeferred.shift();
    }

    return undefined;
  }

  /** One `resolve` request for one card, and what it means for that card's stage. */
  async function resolveOnce(cardId: string): Promise<void> {
    const card = byId.get(cardId);
    if (!card) return;

    const outcome = await lookupOnce(card, 'resolve');
    // Checked immediately after every await: `stop()` may have fired while the request was in
    // flight, and nothing may be reported into a dead reducer.
    if (isOver()) return;

    if (outcome.ok) {
      resolveAttempts.delete(cardId);
      const { result } = outcome;

      if (result.final) {
        // Settled on the first try: this card NEVER enters verify, and so is never delayed.
        settleFinal(cardId, result.year, result.confidence);
        return;
      }

      // Not final: a provisional year, or nothing yet. Either way the card owes a verify, and it
      // is marked so BEFORE the verify lane is woken -- that lane's first rule is "current card
      // first", which is how the start card goes straight to the front during `preparing`.
      if (result.year !== null) reportProvisional(cardId, result.year);
      // A resolve that found nothing reports NOTHING: there is no provisional null, and the card
      // stays pending until verify answers.
      handOffToVerify(cardId);
      // Decided beside a BUSY provider: back off before the next pick, exactly as on a 429 (see
      // the block comment at the top of this file). AFTER the hand-off, so the verify lane has
      // already been woken for this card while this lane sleeps.
      if (result.retryAfterMs !== undefined) {
        await deps.sleep(retryAfterDelay(result.retryAfterMs));
      }
      return;
    }

    switch (outcome.code) {
      case 'rate-limited':
        // BACK-PRESSURE, NOT FAILURE. Only this lane sleeps; no attempt is consumed and nothing
        // is settled, and the next pick may serve a card the player moved to meanwhile -- see
        // the block comment at the top of this file.
        await deps.sleep(retryAfterDelay(outcome.retryAfterMs));
        return;

      case 'not-configured':
        halt();
        return;

      case 'invalid-request':
        // The request itself is wrong, so every retry -- and the verify stage's request, which
        // carries the same track -- produces the identical 400. Settle this card and carry on.
        settleFinal(cardId, null, 'none');
        return;

      default: {
        // `upstream-unavailable`, `unexpected-payload`, `network`: transient enough to be
        // worth a retry, systematic enough not to be worth many.
        const attempts = (resolveAttempts.get(cardId) ?? 0) + 1;
        if (attempts < MAX_ATTEMPTS_PER_PASS) {
          resolveAttempts.set(cardId, attempts);
          await deps.sleep(transientDelay(attempts));
          return;
        }

        resolveAttempts.delete(cardId);
        if (resolveUrgent === cardId) resolveUrgent = undefined;

        // Out of attempts on the deferred pass: NOT a final null. The card goes on to verify,
        // exactly as a resolve that found nothing does, and reports nothing -- a transient failure
        // is never a "no year" (the server's own rule), and a null here would drop the card from
        // a deck that is not keeping yearless ones. Only an exhausted verify settles it null.
        if (resolvePhase === 'deferred') handOffToVerify(cardId);
        else if (!resolveDeferred.includes(cardId)) resolveDeferred.push(cardId);
        return;
      }
    }
  }

  /**
   * The resolve-to-verify hand-off, shared by a non-final answer and an exhausted resolve. The
   * stage is set BEFORE the verify lane is woken -- that lane's first rule is "current card
   * first", which is how the start card goes straight to the front during `preparing`. Called
   * only from the resolve lane while it is still running, so `resolveDone` cannot already be set
   * and the verify lane always drains the queue before it can finish.
   */
  function handOffToVerify(cardId: string): void {
    stageOf.set(cardId, 'needs-verify');
    verifyQueue.push(cardId);
    notifyVerify();
  }

  // ---- Verify lane ------------------------------------------------------------

  async function verifyLane(): Promise<void> {
    while (!isOver()) {
      const cardId = pickVerify();

      if (cardId === undefined) {
        // Nothing to verify yet. Done only once the resolve lane can queue nothing more;
        // otherwise wait for it to queue something (or to finish). No timer: the resolve lane
        // settles this promise, so the wait is exact and node-testable.
        if (resolveDone) return;

        await new Promise<void>((resolve) => {
          wakeVerify = resolve;
        });
        continue;
      }

      await verifyOnce(cardId);
    }
  }

  function notifyVerify(): void {
    const wake = wakeVerify;
    wakeVerify = undefined;
    wake?.();
  }

  /**
   * The next card to verify, re-evaluated before EVERY request:
   *
   * 1. the current card, if it needs verify -- the player is reading its provisional year;
   * 2. the nearest card needing verify within `VERIFY_LOOKAHEAD_CARDS` ahead of it, by position
   *    in the resolver's own deck snapshot (matched by id, never by the live deck's index);
   * 3. otherwise the head of the first-in-first-out queue.
   */
  function pickVerify(): string | undefined {
    if (currentId !== undefined && stageOf.get(currentId) === 'needs-verify') return currentId;

    const currentIndex = currentId === undefined ? undefined : indexById.get(currentId);
    if (currentIndex !== undefined) {
      for (let offset = 1; offset <= VERIFY_LOOKAHEAD_CARDS; offset++) {
        const cardId = deck[currentIndex + offset]?.id;
        // A card already on its deferred pass waits its turn at the back of the queue: picking it
        // through the window again at once would make the deferral a no-op for exactly the cards
        // nearest the player, and one blip would then hold up the rest of the window.
        if (
          cardId !== undefined &&
          stageOf.get(cardId) === 'needs-verify' &&
          !verifyPasses.has(cardId)
        ) {
          return cardId;
        }
      }
    }

    while (verifyQueue.length > 0) {
      const cardId = verifyQueue[0];
      if (cardId !== undefined && stageOf.get(cardId) === 'needs-verify') return cardId;
      verifyQueue.shift();
    }

    return undefined;
  }

  /** One `verify` request for one card. Every path either settles it, retries it, or defers it. */
  async function verifyOnce(cardId: string): Promise<void> {
    const card = byId.get(cardId);
    if (!card) return;

    const outcome = await lookupOnce(card, 'verify');
    if (isOver()) return;

    if (outcome.ok && outcome.result.final) {
      verifyAttempts.delete(cardId);
      verifyAnswered.delete(cardId);
      settleFinal(cardId, outcome.result.year, outcome.result.confidence);
      return;
    }

    if (outcome.ok) {
      // A NON-final verify: the server's "a provider failed transiently, so this is not the last
      // word" (plan.year-fetch-rework-server.md step 10). Its year, if it has one, is the best
      // answer so far and is shown provisionally; the card is then retried like any transient.
      if (outcome.result.year !== null) {
        verifyAnswered.add(cardId);
        if (provisionalYear.get(cardId) !== outcome.result.year) {
          reportProvisional(cardId, outcome.result.year);
        }
      }
    } else {
      switch (outcome.code) {
        case 'rate-limited':
          // Only this lane sleeps, and then it picks again -- the resolve lane keeps crawling.
          await deps.sleep(retryAfterDelay(outcome.retryAfterMs));
          return;

        case 'not-configured':
          halt();
          return;

        case 'invalid-request':
          // Every retry would be the identical 400: settle at the best answer there is.
          settleExhausted(cardId);
          return;

        default:
          // `upstream-unavailable`, `unexpected-payload`, `network`: counted below.
          break;
      }
    }

    const attempts = (verifyAttempts.get(cardId) ?? 0) + 1;
    if (attempts < MAX_ATTEMPTS_PER_PASS) {
      verifyAttempts.set(cardId, attempts);
      await deps.sleep(transientDelay(attempts));
      return;
    }

    verifyAttempts.delete(cardId);
    const passes = (verifyPasses.get(cardId) ?? 0) + 1;
    verifyPasses.set(cardId, passes);

    if (passes >= PASSES_PER_STAGE) {
      settleExhausted(cardId);
      return;
    }

    // The verify lane's deferred pass: to the back of the queue, behind every card that is
    // waiting, so a blip on one card does not hold up the rest. (The CURRENT card is picked first
    // regardless, so a player sitting on it spends its second pass straight away.)
    const queued = verifyQueue.indexOf(cardId);
    if (queued !== -1) verifyQueue.splice(queued, 1);
    verifyQueue.push(cardId);
  }

  /**
   * A card whose verify will never answer: final at the best single answer it has -- its
   * provisional year at `low`, or a final null if resolve found nothing either (or never answered
   * at all -- an exhausted resolve hands its card here with no provisional year).
   *
   * Which of the two a year is depends on whether verify was ever ANSWERED (2026-10-01, the
   * developer's two rulings):
   *
   * - **Some verify came back with a year** (a non-final 200): the server took the vote -- possibly
   *   over `resolve`'s cached answers alone, with every live provider failing -- and nothing
   *   confirmed it: iTunes failed, or it answered and nobody agreed. The
   *   year is the vote's best unconfirmed answer (the next provider in `UNCONFIRMED_TRUST`), and it
   *   settles as an ordinary UNCONFIRMED year, which a session that skips those drops.
   * - **No verify ever came back with a year** (every call failed, 502'd or was refused as a bad
   *   request): we could not ask -- typically a device that lost its connection, which exhausts
   *   every card in flight within seconds. The year is reported `unverified`, so a session that
   *   skips unconfirmed years does not drop it for good over a network blip.
   *
   * The client cannot see which provider failed, and does not need to: the server already folded
   * that into the year it sent. The null keeps its old meaning, and its old accepted cost
   * (`reducer.ts`'s gate notes).
   */
  function settleExhausted(cardId: string): void {
    const year = provisionalYear.get(cardId);
    if (year === undefined) settleFinal(cardId, null, 'none');
    else settleFinal(cardId, year, 'low', !verifyAnswered.has(cardId));
    verifyAnswered.delete(cardId);
  }

  // ---- Shared -----------------------------------------------------------------

  /** One round trip. An injected lookup that rejects is treated as the network failure it is. */
  async function lookupOnce(card: Card, stage: YearStage): Promise<YearLookupOutcome> {
    try {
      // A `Card` is structurally a valid `TrackRef` (shared/types.ts), so it goes straight in.
      return await deps.lookup(card, stage, controller.signal);
    } catch {
      return { ok: false, code: 'network' };
    }
  }

  function settleFinal(
    cardId: string,
    year: number | null,
    confidence: YearConfidence,
    unverified = false,
  ): void {
    stageOf.set(cardId, 'final');
    // A null is always `none`, whatever the body said: the final arm must never carry a
    // null with a confidence the reveal would read as a year. Nor an `unverified` mark.
    const resolved: ResolvedYear =
      year === null
        ? { cardId, year: null, confidence: 'none' }
        : { cardId, year, confidence, ...(unverified ? { unverified: true as const } : {}) };
    report(() => {
      deps.onResolved(resolved);
    });
  }

  function reportProvisional(cardId: string, year: number): void {
    provisionalYear.set(cardId, year);
    // `low` LITERALLY, never the body's confidence: plan 2 never marks a provisional answer
    // `high`, and if it ever did, a provisional card must still not read as confirmed.
    report(() => {
      deps.onResolved({ cardId, year, confidence: 'low', provisional: true });
    });
  }

  /**
   * Invoke a consumer callback without letting it kill a lane.
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
