import { describe, expect, it, vi } from 'vitest';

import { createYearResolver } from './resolver';
import type { ResolvedYear, ResolverLookup, YearResolver } from './resolver';
import type { YearLookupOutcome } from './year-client';
import type { Card, YearLookupResult, YearStage } from '../../shared/types';

/**
 * The resolver's tests are the bulk of plan.phase-3.md's test surface, because the resolver is
 * where the phase's non-obvious guarantees live: one request in flight per stage, a 429 that is
 * back-pressure rather than failure, a priority jump that does not restart the crawl, and a
 * teardown that lets nothing land in a dead reducer. Since 2026-09-30 it also owns the two-stage
 * lifecycle (plan.year-fetch-rework-game.md): a card is pending, provisional-awaiting-verify or
 * final, and only a FINAL answer ends its lifecycle.
 *
 * None of them touch the network or a real clock. `lookup` and `sleep` are injected, so a
 * back-off is a recorded NUMBER rather than elapsed time -- the suite runs in milliseconds.
 */

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    durationMs: 200_000,
    isPlayable: true,
    ...overrides,
  };
}

/** A resumed card whose year came from `resolve` and still owes its `verify`. */
function provisionalCard(id: string, year = 1980): Card {
  return card(id, { year, yearConfidence: 'low', yearProvisional: true });
}

const BODY = {
  cached: false,
  cleanedTitle: 'cleaned',
  stripped: { remaster: false, live: false, feature: false, version: false },
};

function answer(year: number | null, final: boolean, confidence: 'high' | 'low' = 'high') {
  const result: YearLookupResult =
    year === null
      ? { ...BODY, year: null, confidence: 'none', final }
      : { ...BODY, year, confidence, source: 'release-group', final };

  return { ok: true, result } satisfies YearLookupOutcome;
}

/** A final, confirmed 1975: the answer that ends a card's lifecycle in one request. */
const OK: YearLookupOutcome = answer(1975, true);
/** `resolve`'s unconfirmed year: shown, but still owed a `verify`. */
const PROVISIONAL: YearLookupOutcome = answer(1980, false, 'low');
/** `resolve` found nothing YET: not a final null, so the card goes on to `verify`. */
const NOTHING_YET: YearLookupOutcome = answer(null, false);
const FINAL_NULL: YearLookupOutcome = answer(null, true);

function fail(code: 'rate-limited', retryAfterMs?: number): YearLookupOutcome;
function fail(
  code: 'not-configured' | 'invalid-request' | 'upstream-unavailable' | 'network',
): YearLookupOutcome;
function fail(code: string, retryAfterMs?: number): YearLookupOutcome {
  const outcome = { ok: false, code } as Extract<YearLookupOutcome, { ok: false }>;
  if (retryAfterMs !== undefined) outcome.retryAfterMs = retryAfterMs;

  return outcome;
}

/** What the fake lookup answers for a given card, attempt number (1-based, PER STAGE) and stage. */
type Plan = (cardId: string, attempt: number, stage: YearStage) => YearLookupOutcome;

interface Harness {
  resolver: YearResolver;
  /** Every lookup, in order, by card id, across both stages. Repeats mean retries. */
  calls: string[];
  /** Every lookup of ONE stage, in order, by card id. */
  callsIn: (stage: YearStage) => string[];
  /** Every back-off, in order, in ms, across both lanes. */
  sleeps: number[];
  resolved: ResolvedYear[];
  unavailableCount: number;
  /** The most requests of one stage ever in flight at once. */
  maxInFlight: Record<YearStage, number>;
  /** The most requests of EITHER stage in flight at once -- 2 proves the lanes really overlap. */
  maxInFlightTotal: number;
  signals: { cardId: string; stage: YearStage; signal: AbortSignal }[];
  /** Let every sleep parked by `holdSleeps` return, in order. */
  releaseSleeps: () => void;
  /** Drain the microtask queue -- one macrotask tick is enough, since `sleep` is instant. */
  flush: () => Promise<void>;
}

interface HarnessOptions {
  /** Called with the harness on every lookup, so a test can prioritize or stop mid-crawl. */
  onLookup?: (cardId: string, harness: Harness, stage: YearStage) => void;
  onResolved?: (resolved: ResolvedYear) => void;
  /** Lookups that never settle until the signal aborts: every one, or the ones matched. */
  hang?: boolean | ((cardId: string, stage: YearStage) => boolean);
  /** Sleeps that do not return until `releaseSleeps()` -- a lane visibly parked in back-off. */
  holdSleeps?: boolean;
  /** Passed straight through as `ResolverDeps.startIndex`. */
  startIndex?: number;
}

function createHarness(deck: Card[], plan: Plan, options: HarnessOptions = {}): Harness {
  const idByTitle = new Map(deck.map((c) => [c.title, c.id]));
  const attempts = new Map<string, number>();
  const inFlight: Record<YearStage, number> = { resolve: 0, verify: 0 };
  const heldSleeps: (() => void)[] = [];
  const staged: { cardId: string; stage: YearStage }[] = [];

  const harness = {
    calls: [] as string[],
    callsIn: (stage: YearStage) => staged.filter((c) => c.stage === stage).map((c) => c.cardId),
    sleeps: [] as number[],
    resolved: [] as ResolvedYear[],
    unavailableCount: 0,
    maxInFlight: { resolve: 0, verify: 0 },
    maxInFlightTotal: 0,
    signals: [] as Harness['signals'],
    releaseSleeps: () => {
      for (const release of heldSleeps.splice(0)) release();
    },
    flush: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  } as Harness;

  const lookup: ResolverLookup = (track, stage, signal) => {
    // Resolved through the title rather than by casting `track` back to a `Card`: the resolver's
    // contract is that it passes a `TrackRef`, and the test should hold it to exactly that.
    const cardId = idByTitle.get(track.title) ?? track.title;

    harness.calls.push(cardId);
    staged.push({ cardId, stage });
    harness.signals.push({ cardId, stage, signal });
    inFlight[stage]++;
    harness.maxInFlight[stage] = Math.max(harness.maxInFlight[stage], inFlight[stage]);
    harness.maxInFlightTotal = Math.max(
      harness.maxInFlightTotal,
      inFlight.resolve + inFlight.verify,
    );

    const key = `${stage}:${cardId}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    options.onLookup?.(cardId, harness, stage);

    const hang = typeof options.hang === 'function' ? options.hang(cardId, stage) : options.hang;
    if (hang) {
      return new Promise<YearLookupOutcome>((resolve) => {
        signal.addEventListener('abort', () => {
          inFlight[stage]--;
          resolve(fail('network'));
        });
      });
    }

    // Deliberately asynchronous: a `Promise.all` implementation would start every lookup before
    // any of them settled, which is exactly what `maxInFlight` is watching for.
    return Promise.resolve().then(() => {
      inFlight[stage]--;
      return plan(cardId, attempt, stage);
    });
  };

  harness.resolver = createYearResolver(deck, {
    lookup,
    sleep: (ms) => {
      harness.sleeps.push(ms);
      if (!options.holdSleeps) return Promise.resolve();

      return new Promise<void>((resolve) => {
        heldSleeps.push(resolve);
      });
    },
    onResolved: (resolved) => {
      harness.resolved.push(resolved);
      options.onResolved?.(resolved);
    },
    onLookupsUnavailable: () => {
      harness.unavailableCount++;
    },
    // Zero jitter, so every asserted delay is the exact number the code computed.
    random: () => 0,
    ...(options.startIndex === undefined ? {} : { startIndex: options.startIndex }),
  });

  return harness;
}

const DECK = [card('a'), card('b'), card('c'), card('d'), card('e')];

const alwaysOk: Plan = () => OK;

/** Resolve answers provisionally, verify confirms: every card makes exactly one call per stage. */
const twoStage: Plan = (_cardId, _attempt, stage) => (stage === 'resolve' ? PROVISIONAL : OK);

/** Eight resumed provisional cards: resolve has nothing to do, so verify's pick order is visible. */
const PROVISIONAL_DECK = Array.from({ length: 8 }, (_, i) => provisionalCard(`t${i}`));

describe('createYearResolver ordering', () => {
  it('should resolve cards in deck order', async () => {
    // Deck order IS play order (`shuffle.ts` runs first), which is the whole reason the crawl is
    // ordered at all: the start card -- card 1, with no `startIndex` -- must be the first lookup,
    // because Start waits on it.
    const harness = createHarness(DECK, alwaysOk);
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(harness.resolved.map((r) => r.cardId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('should never have more than one request in flight per stage', async () => {
    // Directly guards against `Promise.all(deck.map(lookup))`, which would fire 100 requests at
    // a gate that admits one per second and take ~99 429s -- and, since 2026-09-30, against a
    // shared two-slot queue, which could hold two MusicBrainz lookups at once. The two LANES do
    // overlap (the total reaches 2); no single stage ever does.
    const harness = createHarness(
      Array.from({ length: 25 }, (_, i) => card(`t${i}`)),
      twoStage,
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.maxInFlight).toEqual({ resolve: 1, verify: 1 });
    expect(harness.maxInFlightTotal).toBe(2);
    expect(harness.callsIn('resolve')).toHaveLength(25);
    expect(harness.callsIn('verify')).toHaveLength(25);
  });

  it('should skip only final cards on creation', async () => {
    // The resumed-session path: persistence keeps every resolved year precisely so a reload does
    // not re-spend a budget that is global across all users. But "has a year" is not "done" any
    // more -- a provisional year still owes its verify.
    const deck = [
      card('a', { year: 1969, yearConfidence: 'high' }),
      card('b'),
      card('c', { year: null, yearConfidence: 'none' }),
      provisionalCard('d'),
    ];
    const harness = createHarness(deck, alwaysOk);
    harness.resolver.start();
    await harness.flush();

    // `c` is skipped too: `year: null` is a FINAL "no year", not a pending one.
    expect(harness.callsIn('resolve')).toEqual(['b']);
    expect(harness.callsIn('verify')).toEqual(['d']);
  });

  it('should send a resumed provisional card straight to verify', async () => {
    // The reload-mid-verification path. Seeding it as "has a year, done" was the pre-2026-09-30
    // line that would have left a resumed provisional year provisional for ever.
    const harness = createHarness([provisionalCard('a', 1980)], alwaysOk);
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('resolve')).toEqual([]);
    expect(harness.callsIn('verify')).toEqual(['a']);
    expect(harness.resolved).toEqual([{ cardId: 'a', year: 1975, confidence: 'high' }]);
  });

  it('should look a duplicated card id up only once', async () => {
    const harness = createHarness([card('dup'), card('other'), card('dup')], alwaysOk);
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['dup', 'other']);
  });

  it('should never request a card twice in the same stage', async () => {
    // Duplicated ids across BOTH stages: the dedupe happens once, at creation, and the stage
    // state is per distinct id, so neither lane can pick a duplicate up a second time.
    const deck = [
      card('dup'),
      card('other'),
      card('dup'),
      provisionalCard('p'),
      provisionalCard('p'),
    ];
    const harness = createHarness(deck, twoStage);
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('resolve')).toEqual(['dup', 'other']);
    expect([...harness.callsIn('verify')].sort()).toEqual(['dup', 'other', 'p']);
  });

  it('should do nothing when the whole deck is already final', async () => {
    const deck = [card('a', { year: 1975, yearConfidence: 'high' })];
    const harness = createHarness(deck, alwaysOk);
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual([]);
  });

  it('should look the start card up first when the deck starts mid-way', async () => {
    // A shared mid-game link starts the player on the sender's card, and the gate waits on THAT
    // card -- so it is the first lookup, not card 1.
    const harness = createHarness(DECK, alwaysOk, { startIndex: 2 });
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls[0]).toBe('c');
  });

  it('should walk to the end of the deck and then wrap round to the cards before the start', async () => {
    // Forwards first, because that is the direction the player is going; the cards before the
    // start are only reached by stepping back, so they go last.
    const harness = createHarness(DECK, alwaysOk, { startIndex: 2 });
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['c', 'd', 'e', 'a', 'b']);
  });

  it('should still dedupe and skip resolved cards in the rotated order', async () => {
    const deck = [
      card('a'),
      card('dup'),
      card('b', { year: 1980, yearConfidence: 'high' }),
      card('dup'),
      card('c'),
    ];
    const harness = createHarness(deck, alwaysOk, { startIndex: 2 });
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['dup', 'c', 'a']);
  });

  it('should fall back to deck order for a start index outside the deck', async () => {
    for (const startIndex of [-1, 5, 99, 1.5]) {
      const harness = createHarness(DECK, alwaysOk, { startIndex });
      harness.resolver.start();
      await harness.flush();

      expect(harness.calls).toEqual(['a', 'b', 'c', 'd', 'e']);
    }
  });

  it('should ignore a second start on the same instance', async () => {
    // React 19's StrictMode invokes an effect twice. The hook's cleanup stops the first resolver,
    // and this guard covers a double `start()` on the same one: exactly one pair of lanes.
    const harness = createHarness(DECK, twoStage);
    harness.resolver.start();
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('resolve')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(harness.callsIn('verify')).toHaveLength(5);
  });
});

describe('createYearResolver stages', () => {
  it('should settle a card whose resolve answer is final without a verify request', async () => {
    // The warm-card path, and the promise the two-stage design makes: a card that settles on its
    // first try is never delayed by a second request.
    const harness = createHarness([card('a'), card('b')], (cardId) =>
      cardId === 'a' ? OK : FINAL_NULL,
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual([]);
    expect(harness.resolved).toEqual([
      { cardId: 'a', year: 1975, confidence: 'high' },
      { cardId: 'b', year: null, confidence: 'none' },
    ]);
  });

  it('should queue a provisional card for verify and report the provisional year', async () => {
    const harness = createHarness([card('a')], twoStage);
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'a']);
    expect(harness.callsIn('verify')).toEqual(['a']);
    // The provisional year first, then the final one replacing it -- and the final report is the
    // plain final arm, with no `provisional` field at all.
    expect(harness.resolved).toEqual([
      { cardId: 'a', year: 1980, confidence: 'low', provisional: true },
      { cardId: 'a', year: 1975, confidence: 'high' },
    ]);
  });

  it('should report a provisional year at low whatever confidence the body claims', async () => {
    // The provisional arm is `low` by type, and a provisional card must never read as confirmed.
    const harness = createHarness([card('a')], (_cardId, _attempt, stage) =>
      stage === 'resolve' ? answer(1980, false, 'high') : OK,
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.resolved[0]).toEqual({
      cardId: 'a',
      year: 1980,
      confidence: 'low',
      provisional: true,
    });
  });

  it('should queue a card whose resolve found nothing for verify and report nothing', async () => {
    // There is no provisional null: a resolve that found nothing leaves the card PENDING, and
    // only verify's final answer -- here a null -- is reported.
    const harness = createHarness([card('a'), card('b')], (cardId, _attempt, stage) => {
      if (stage === 'resolve') return NOTHING_YET;
      return cardId === 'a' ? FINAL_NULL : OK;
    });
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual(['a', 'b']);
    expect(harness.resolved).toEqual([
      { cardId: 'a', year: null, confidence: 'none' },
      { cardId: 'b', year: 1975, confidence: 'high' },
    ]);
  });

  it('should retry a non-final verify answer and show its year provisionally', async () => {
    // A verify that is not final means a provider failed transiently. Its year is the best
    // answer so far, so it is shown; the card is retried like any transient fault.
    const harness = createHarness([card('a')], (_cardId, attempt, stage) => {
      if (stage === 'resolve') return NOTHING_YET;
      return attempt === 1 ? answer(1983, false, 'low') : OK;
    });
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual(['a', 'a']);
    expect(harness.sleeps).toEqual([500]);
    expect(harness.resolved).toEqual([
      { cardId: 'a', year: 1983, confidence: 'low', provisional: true },
      { cardId: 'a', year: 1975, confidence: 'high' },
    ]);
  });

  it('should settle an exhausted provisional card final at its provisional year, low', async () => {
    // Otherwise the card waits for ever, and the PDF with it. The best single answer is kept
    // (spike §10.3), reported on the FINAL arm so the reducer clears the flag.
    const harness = createHarness([card('a')], (_cardId, _attempt, stage) =>
      stage === 'resolve' ? PROVISIONAL : fail('upstream-unavailable'),
    );
    harness.resolver.start();
    await harness.flush();

    // The same budget the one-stage crawl had: three attempts, then one more pass of three.
    expect(harness.callsIn('verify')).toHaveLength(3 + 3);
    expect(harness.resolved).toEqual([
      { cardId: 'a', year: 1980, confidence: 'low', provisional: true },
      { cardId: 'a', year: 1980, confidence: 'low' },
    ]);
  });

  it('should settle an exhausted resumed provisional card at its own year', async () => {
    const harness = createHarness([provisionalCard('a', 1966)], () => fail('network'));
    harness.resolver.start();
    await harness.flush();

    expect(harness.resolved).toEqual([{ cardId: 'a', year: 1966, confidence: 'low' }]);
  });

  it('should settle an exhausted empty card final at null', async () => {
    const harness = createHarness([card('a')], (_cardId, _attempt, stage) =>
      stage === 'resolve' ? NOTHING_YET : fail('network'),
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toHaveLength(6);
    expect(harness.resolved).toEqual([{ cardId: 'a', year: null, confidence: 'none' }]);
  });

  it('should settle a verify invalid-request at the best answer without retrying', async () => {
    const harness = createHarness([card('a')], (_cardId, _attempt, stage) =>
      stage === 'resolve' ? PROVISIONAL : fail('invalid-request'),
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual(['a']);
    expect(harness.resolved.at(-1)).toEqual({ cardId: 'a', year: 1980, confidence: 'low' });
  });

  it('should defer an exhausted verify card behind the rest of the queue', async () => {
    // The verify lane's deferred pass: a blip on one card must not hold up the others.
    // `a` is the start card, so `b` and `c` are both inside its look-ahead window. Once `b` has
    // spent its first pass the window no longer picks it, or the deferral would be a no-op for
    // exactly the cards nearest the player.
    const harness = createHarness(
      [provisionalCard('a'), provisionalCard('b'), provisionalCard('c')],
      (cardId, attempt) => (cardId === 'b' && attempt <= 3 ? fail('upstream-unavailable') : OK),
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual(['a', 'b', 'b', 'b', 'c', 'b']);
    expect(harness.resolved.map((r) => r.cardId)).toEqual(['a', 'c', 'b']);
    expect(harness.resolved.at(-1)).toEqual({ cardId: 'b', year: 1975, confidence: 'high' });
  });
});

describe('createYearResolver verify pick order', () => {
  it('should verify the current card first', async () => {
    // The player is reading this card's provisional year, so it is the verify lane's first pick
    // from the moment `prioritize` names it.
    const harness = createHarness(PROVISIONAL_DECK, alwaysOk, {
      onLookup: (cardId, h) => {
        if (cardId === 't0') h.resolver.prioritize('t6');
      },
    });
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')[1]).toBe('t6');
  });

  it('should verify within the window before the rest', async () => {
    // Current card, then the next `VERIFY_LOOKAHEAD_CARDS` (3) ahead of it, then FIFO -- which,
    // for a resumed deck, is play order from the start card.
    const harness = createHarness(PROVISIONAL_DECK, alwaysOk);
    harness.resolver.prioritize('t3');
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual(['t3', 't4', 't5', 't6', 't0', 't1', 't2', 't7']);
  });

  it('should anchor the window on a current card that is already final', async () => {
    // `prioritize` on a final card queues no request, but it still moves the window: "the cards
    // ahead of the player" is wherever the player is, and they are usually on a final card.
    const deck = PROVISIONAL_DECK.map((c) =>
      c.id === 't4' ? card('t4', { year: 1990, yearConfidence: 'high' }) : c,
    );
    const harness = createHarness(deck, alwaysOk);
    harness.resolver.prioritize('t4');
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual(['t5', 't6', 't7', 't0', 't1', 't2', 't3']);
  });

  it('should move the urgent start card to the front of verify when its resolve answer lands', async () => {
    // THE CARD-1 GAP. During `preparing` the start card goes provisional without the current
    // card changing, so the hook's `prioritize` never fires again. The verify lane is already
    // busy with a resumed card (`x`) when the start card's resolve lands; the start card must
    // come next, ahead of `y`, which was queued first. `startIndex` alone names it: nothing
    // calls `prioritize` at all in this test.
    const deck = [provisionalCard('x'), provisionalCard('y'), card('start')];
    const harness = createHarness(deck, twoStage, { startIndex: 2 });
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('resolve')).toEqual(['start']);
    expect(harness.callsIn('verify')).toEqual(['x', 'start', 'y']);
  });

  it('should wait for the resolve lane rather than finish early', async () => {
    // The verify lane starts with nothing to do; it must wait on the resolve lane rather than
    // conclude there is no work, and it must still finish once the resolve lane has.
    const harness = createHarness([card('a'), card('b'), card('c')], twoStage);
    harness.resolver.start();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual(['a', 'b', 'c']);
    expect(harness.resolved.filter((r) => !('provisional' in r))).toHaveLength(3);
  });
});

describe('createYearResolver priority jump', () => {
  it('should resolve a prioritized card next', async () => {
    // The player has outrun the crawl and is looking at a card with no year yet. Only the year
    // slot waits, and it waits for ONE lookup rather than a queue drain.
    const harness = createHarness(DECK, alwaysOk, {
      onLookup: (cardId, h) => {
        if (cardId === 'a') h.resolver.prioritize('d');
      },
    });
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls[1]).toBe('d');
  });

  it('should resume ordered walking after servicing a priority', async () => {
    // A priority must not restart the crawl from the beginning, and must not lose its place:
    // after `d`, the walk continues at `b`.
    const harness = createHarness(DECK, alwaysOk, {
      onLookup: (cardId, h) => {
        if (cardId === 'a') h.resolver.prioritize('d');
      },
    });
    harness.resolver.start();
    await harness.flush();

    // `d` is not looked up twice when the cursor reaches it.
    expect(harness.calls).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('should ignore a priority for a card that is already final', async () => {
    // The COMMON case, not an edge case: the crawl usually stays ahead of the player, so most
    // `prioritize()` calls are for a card that already has its year.
    const harness = createHarness(DECK, alwaysOk, {
      onLookup: (cardId, h) => {
        if (cardId === 'c') h.resolver.prioritize('a');
      },
    });
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('should ignore a priority for a card that is not in the deck', async () => {
    const harness = createHarness(DECK, alwaysOk);
    harness.resolver.prioritize('not-here');
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('createYearResolver back-pressure', () => {
  it('should wait the reported retryAfterMs and retry the same card on 429', async () => {
    const harness = createHarness([card('a'), card('b')], (cardId, attempt) =>
      cardId === 'a' && attempt === 1 ? fail('rate-limited', 1_100) : OK,
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.sleeps).toEqual([1_100]);
    expect(harness.calls).toEqual(['a', 'a', 'b']);
  });

  it('should serve a card the player moved to while the lane slept', async () => {
    // A 429 is followed by a fresh PICK, not a blind retry: a player who moved on is served
    // first, and the interrupted card is picked up again straight after.
    let moved = false;
    const harness = createHarness(
      DECK,
      (cardId, attempt) => (cardId === 'a' && attempt === 1 ? fail('rate-limited', 1_100) : OK),
      {
        onLookup: (cardId, h) => {
          // The player swipes to `d` while `a`'s request is out and about to come back 429.
          if (cardId === 'a' && !moved) {
            moved = true;
            h.resolver.prioritize('d');
          }
        },
      },
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.sleeps).toEqual([1_100]);
    expect(harness.calls).toEqual(['a', 'd', 'a', 'b', 'c', 'e']);
  });

  it('should back off only the lane that got a 429', async () => {
    // Each stage has its own provider gates: a busy verify gate says nothing about resolve's, so
    // the resolve lane keeps crawling while the verify lane is parked in its back-off.
    const deck = [provisionalCard('p'), card('a'), card('b'), card('c')];
    const harness = createHarness(
      deck,
      (_cardId, attempt, stage) =>
        stage === 'verify' && attempt === 1 ? fail('rate-limited', 1_100) : OK,
      { holdSleeps: true },
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.sleeps).toEqual([1_100]);
    expect(harness.callsIn('verify')).toEqual(['p']);
    expect(harness.callsIn('resolve')).toEqual(['a', 'b', 'c']);

    harness.releaseSleeps();
    await harness.flush();

    expect(harness.callsIn('verify')).toEqual(['p', 'p']);
    expect(harness.resolved.map((r) => r.cardId)).toEqual(['a', 'b', 'c', 'p']);
  });

  it('should not mark a card resolved because of a 429', async () => {
    // The single most likely misreading of the Phase 2 contract: a 429 is the DESIGNED
    // back-pressure signal, so the card is neither settled nor skipped.
    const harness = createHarness([card('a')], (_cardId, attempt) =>
      attempt <= 3 ? fail('rate-limited', 900) : OK,
    );
    harness.resolver.start();
    await harness.flush();

    // Four attempts, one resolution, and it carries the real year rather than a null.
    expect(harness.calls).toEqual(['a', 'a', 'a', 'a']);
    expect(harness.resolved).toEqual([{ cardId: 'a', year: 1975, confidence: 'high' }]);
  });

  it('should not count a 429 against the transient retry budget', async () => {
    // Otherwise a card unlucky enough to hit the gate three times would be deferred and end up
    // yearless, which is precisely the outcome back-pressure exists to avoid.
    const harness = createHarness([card('a')], (_cardId, attempt) =>
      attempt <= 5 ? fail('rate-limited', 1_100) : OK,
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.resolved[0]?.year).toBe(1975);
  });

  it('should clamp an implausible retryAfterMs into a sane range', async () => {
    // `retryAfterMs` is input from outside the module: a 0 would busy-spin against the gate and
    // a 600000 would stall the deck for ten minutes.
    const harness = createHarness([card('a'), card('b')], (cardId, attempt) => {
      if (attempt > 1) return OK;
      return cardId === 'a' ? fail('rate-limited', 0) : fail('rate-limited', 600_000);
    });
    harness.resolver.start();
    await harness.flush();

    expect(harness.sleeps).toEqual([500, 10_000]);
  });

  it('should use a default wait when a 429 carries no retry hint', async () => {
    const harness = createHarness([card('a')], (_cardId, attempt) =>
      attempt === 1 ? fail('rate-limited') : OK,
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.sleeps).toEqual([1_500]);
  });

  it('should add jitter so two tabs do not resynchronise onto the same gate', async () => {
    // The harness pins `random` to 0 everywhere else so delays are exact; here it is 1 to prove
    // the jitter is actually wired in.
    const deck = [card('a')];
    const sleeps: number[] = [];
    let attempt = 0;

    const resolver = createYearResolver(deck, {
      lookup: () => {
        attempt++;
        return Promise.resolve(attempt === 1 ? fail('rate-limited', 1_100) : OK);
      },
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      onResolved: () => {},
      onLookupsUnavailable: () => {},
      random: () => 0.999,
    });
    resolver.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sleeps[0]).toBeGreaterThan(1_100);
    expect(sleeps[0]).toBeLessThan(1_400);
  });
});

describe('createYearResolver error handling', () => {
  it('should retry a transient upstream error with exponential back-off', async () => {
    const harness = createHarness([card('a')], () => fail('upstream-unavailable'));
    harness.resolver.start();
    await harness.flush();

    // Three attempts in the main pass, so two back-offs: 500 then 1000.
    expect(harness.calls.filter((id) => id === 'a')).toHaveLength(3 + 3);
    expect(harness.sleeps.slice(0, 2)).toEqual([500, 1_000]);
  });

  it('should defer a persistently failing card and retry it after the crawl', async () => {
    // A transient MusicBrainz blip must not permanently blank part of the deck, so the card is
    // set aside and given one more pass once the rest of the deck is done.
    const harness = createHarness([card('a'), card('b'), card('c')], (cardId, attempt) => {
      if (cardId !== 'a') return OK;
      // Fails all three main-pass attempts, succeeds on the deferred pass.
      return attempt <= 3 ? fail('upstream-unavailable') : OK;
    });
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'a', 'a', 'b', 'c', 'a']);
    // `a` resolves LAST, after the cards that came after it -- and with a real year, not a null.
    expect(harness.resolved.map((r) => r.cardId)).toEqual(['b', 'c', 'a']);
    expect(harness.resolved.at(-1)).toEqual({ cardId: 'a', year: 1975, confidence: 'high' });
  });

  it('should not lose an urgent deferred card that a 429 interrupted after the player moved on', async () => {
    // `a` is deferred, then made urgent; its retry hits the gate and, while it sleeps, the player
    // moves to `c`. `a` must still be reached by the deferred pass -- taken out of the deferred
    // queue for its urgent attempt, it would be behind the cursor and in no queue at all.
    let aLookups = 0;
    const harness = createHarness(
      [card('a'), card('b'), card('c')],
      (cardId, attempt) => {
        if (cardId !== 'a') return OK;
        if (attempt <= 3) return fail('upstream-unavailable');
        return attempt === 4 ? fail('rate-limited', 1_100) : OK;
      },
      {
        onLookup: (cardId, h) => {
          if (cardId === 'b') h.resolver.prioritize('a');
          if (cardId === 'a' && ++aLookups === 4) h.resolver.prioritize('c');
        },
      },
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'a', 'a', 'b', 'a', 'c', 'a']);
    expect(harness.resolved.at(-1)).toEqual({ cardId: 'a', year: 1975, confidence: 'high' });
  });

  it('should settle a card at null/none after the resolve deferred pass also fails', async () => {
    // Exactly as before the two stages: a card resolve could not reach at all settles final null
    // and never enters verify -- a transient failure is never sent on as "found nothing".
    const harness = createHarness([card('a'), card('b')], (cardId) =>
      cardId === 'a' ? fail('network') : OK,
    );
    harness.resolver.start();
    await harness.flush();

    // Three attempts in each pass, and only then does it settle -- terminally.
    expect(harness.calls.filter((id) => id === 'a')).toHaveLength(6);
    expect(harness.callsIn('verify')).toEqual([]);
    expect(harness.resolved).toContainEqual({ cardId: 'a', year: null, confidence: 'none' });
  });

  it('should stop the whole crawl on not-configured', async () => {
    // Every provider unconfigured fails identically for every remaining card, so hammering the
    // rest of the deck with guaranteed 500s helps nobody. This is the one error that ends the
    // loop.
    const harness = createHarness(DECK, (cardId) => (cardId === 'b' ? fail('not-configured') : OK));
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'b']);
    expect(harness.unavailableCount).toBe(1);
    expect(harness.resolved.map((r) => r.cardId)).toEqual(['a']);
    // Not retried either: it is not a transient fault.
    expect(harness.sleeps).toEqual([]);
  });

  it('should ignore a priority after the crawl has halted', async () => {
    const harness = createHarness(DECK, () => fail('not-configured'));
    harness.resolver.start();
    await harness.flush();

    harness.resolver.prioritize('d');
    await harness.flush();

    expect(harness.calls).toEqual(['a']);
  });

  it('should not retry an invalid-request', async () => {
    // The input is wrong, so every retry produces the identical 400. Settle that card and move
    // on rather than spending three attempts proving it.
    const harness = createHarness([card('a'), card('b')], (cardId) =>
      cardId === 'a' ? fail('invalid-request') : OK,
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'b']);
    expect(harness.sleeps).toEqual([]);
    expect(harness.resolved).toContainEqual({ cardId: 'a', year: null, confidence: 'none' });
  });

  it('should continue the crawl when a result callback throws', async () => {
    // A consumer bug must not silently kill the crawl for the rest of the deck.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const harness = createHarness(DECK, alwaysOk, {
        onResolved: (resolved) => {
          if (resolved.cardId === 'a') throw new Error('dispatch blew up');
        },
      });
      harness.resolver.start();
      await harness.flush();

      expect(harness.calls).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('createYearResolver teardown', () => {
  it('should emit no further callbacks after stop()', async () => {
    // Guarantees nothing lands in a dead reducer: the player can hit Exit while a lookup is in
    // flight, and a late `YEAR_RESOLVED` must not resurrect an ended session.
    const harness = createHarness(DECK, alwaysOk, {
      onLookup: (cardId, h) => {
        if (cardId === 'b') h.resolver.stop();
      },
    });
    harness.resolver.start();
    await harness.flush();

    // `a` resolved before the stop; `b`'s result arrived after it and was dropped.
    expect(harness.resolved.map((r) => r.cardId)).toEqual(['a']);
    expect(harness.calls).toEqual(['a', 'b']);
  });

  it('should abort the in-flight request on stop()', async () => {
    // Cancellation, not merely ignoring: the request should stop occupying the gate and the
    // browser's connection pool.
    const harness = createHarness(DECK, alwaysOk, { hang: true });
    harness.resolver.start();
    await harness.flush();

    expect(harness.signals[0]?.signal.aborted).toBe(false);

    harness.resolver.stop();

    expect(harness.signals[0]?.signal.aborted).toBe(true);
  });

  it('should stop both lanes on stop()', async () => {
    // `a` goes provisional at once; then `b`'s resolve and `a`'s verify both hang. One `stop()`
    // must abort BOTH, and neither lane may report or request anything after it.
    const harness = createHarness([card('a'), card('b')], () => PROVISIONAL, {
      hang: (cardId, stage) => cardId === 'b' || stage === 'verify',
    });
    harness.resolver.start();
    await harness.flush();

    // One request out in EACH lane: `a`'s resolve came back, `b`'s resolve and `a`'s verify hang.
    expect(harness.callsIn('resolve')).toEqual(['a', 'b']);
    expect(harness.callsIn('verify')).toEqual(['a']);
    expect(harness.signals.some((s) => s.signal.aborted)).toBe(false);

    harness.resolver.stop();
    await harness.flush();

    expect(harness.signals.every((s) => s.signal.aborted)).toBe(true);
    expect(harness.resolved).toEqual([
      { cardId: 'a', year: 1980, confidence: 'low', provisional: true },
    ]);
    expect(harness.calls).toHaveLength(3);
  });

  it('should stop both lanes on not-configured', async () => {
    // Plan 2 returns `not-configured` only when EVERY provider is unconfigured, so it ends both
    // stages -- here raised by verify while resolve has a request in flight.
    const harness = createHarness(
      [provisionalCard('p'), card('a'), card('b')],
      () => fail('not-configured'),
      { hang: (_cardId, stage) => stage === 'resolve' },
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.unavailableCount).toBe(1);
    expect(harness.signals.every((s) => s.signal.aborted)).toBe(true);
    expect(harness.callsIn('resolve')).toEqual(['a']);
    expect(harness.callsIn('verify')).toEqual(['p']);
    expect(harness.resolved).toEqual([]);
  });

  it('should not start after stop()', async () => {
    const harness = createHarness(DECK, alwaysOk);
    harness.resolver.stop();
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual([]);
  });
});
