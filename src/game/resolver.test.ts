import { describe, expect, it, vi } from 'vitest';

import { createYearResolver } from './resolver';
import type { ResolvedYear, ResolverLookup, YearResolver } from './resolver';
import type { YearLookupOutcome } from './year-client';
import type { Card } from '../../shared/types';

/**
 * The resolver's tests are the bulk of plan.phase-3.md's test surface, because the resolver is
 * where the phase's non-obvious guarantees live: strictly sequential lookups, a 429 that is
 * back-pressure rather than failure, a priority jump that does not restart the crawl, and a
 * teardown that lets nothing land in a dead reducer.
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

const OK: YearLookupOutcome = {
  ok: true,
  result: {
    year: 1975,
    confidence: 'high',
    source: 'release-group',
    cached: false,
    cleanedTitle: 'cleaned',
    stripped: { remaster: false, live: false, feature: false, version: false },
  },
};

function fail(code: 'rate-limited', retryAfterMs?: number): YearLookupOutcome;
function fail(
  code: 'not-configured' | 'invalid-request' | 'upstream-unavailable' | 'network',
): YearLookupOutcome;
function fail(code: string, retryAfterMs?: number): YearLookupOutcome {
  const outcome = { ok: false, code } as Extract<YearLookupOutcome, { ok: false }>;
  if (retryAfterMs !== undefined) outcome.retryAfterMs = retryAfterMs;

  return outcome;
}

/** What the fake lookup answers for a given card and attempt number (1-based). */
type Plan = (cardId: string, attempt: number) => YearLookupOutcome;

interface Harness {
  resolver: YearResolver;
  /** Every lookup, in order, by card id. Repeats mean retries. */
  calls: string[];
  /** Every back-off, in order, in ms. */
  sleeps: number[];
  resolved: ResolvedYear[];
  unavailableCount: number;
  maxInFlight: number;
  signals: AbortSignal[];
  /** Drain the microtask queue -- one macrotask tick is enough, since `sleep` is instant. */
  flush: () => Promise<void>;
}

interface HarnessOptions {
  /** Called with the harness on every lookup, so a test can prioritize or stop mid-crawl. */
  onLookup?: (cardId: string, harness: Harness) => void;
  onResolved?: (resolved: ResolvedYear) => void;
  /** A lookup that never settles until the signal aborts. */
  hang?: boolean;
}

function createHarness(deck: Card[], plan: Plan, options: HarnessOptions = {}): Harness {
  const idByTitle = new Map(deck.map((c) => [c.title, c.id]));
  const attempts = new Map<string, number>();
  let inFlight = 0;

  const harness = {
    calls: [] as string[],
    sleeps: [] as number[],
    resolved: [] as ResolvedYear[],
    unavailableCount: 0,
    maxInFlight: 0,
    signals: [] as AbortSignal[],
    flush: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  } as Harness;

  const lookup: ResolverLookup = (track, signal) => {
    // Resolved through the title rather than by casting `track` back to a `Card`: the resolver's
    // contract is that it passes a `TrackRef`, and the test should hold it to exactly that.
    const cardId = idByTitle.get(track.title) ?? track.title;

    harness.calls.push(cardId);
    harness.signals.push(signal);
    inFlight++;
    harness.maxInFlight = Math.max(harness.maxInFlight, inFlight);

    const attempt = (attempts.get(cardId) ?? 0) + 1;
    attempts.set(cardId, attempt);
    options.onLookup?.(cardId, harness);

    if (options.hang) {
      return new Promise<YearLookupOutcome>((resolve) => {
        signal.addEventListener('abort', () => {
          inFlight--;
          resolve(fail('network'));
        });
      });
    }

    // Deliberately asynchronous: a `Promise.all` implementation would start every lookup before
    // any of them settled, which is exactly what `maxInFlight` is watching for.
    return Promise.resolve().then(() => {
      inFlight--;
      return plan(cardId, attempt);
    });
  };

  harness.resolver = createYearResolver(deck, {
    lookup,
    sleep: (ms) => {
      harness.sleeps.push(ms);
      return Promise.resolve();
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
  });

  return harness;
}

const DECK = [card('a'), card('b'), card('c'), card('d'), card('e')];

const alwaysOk: Plan = () => OK;

describe('createYearResolver ordering', () => {
  it('should resolve cards in deck order', async () => {
    // Deck order IS play order (`shuffle.ts` runs first), which is the whole reason the crawl is
    // ordered at all: card 1 must be the first lookup, because Start waits on it.
    const harness = createHarness(DECK, alwaysOk);
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(harness.resolved.map((r) => r.cardId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('should never have more than one lookup in flight', async () => {
    // Directly guards against `Promise.all(deck.map(lookup))`, which would fire 100 requests at
    // a gate that admits one per second and take ~99 429s.
    const harness = createHarness(
      Array.from({ length: 25 }, (_, i) => card(`t${i}`)),
      alwaysOk,
    );
    harness.resolver.start();
    await harness.flush();

    expect(harness.maxInFlight).toBe(1);
    expect(harness.calls).toHaveLength(25);
  });

  it('should skip cards that already have a resolved year', async () => {
    // The resumed-session path: persistence keeps every resolved year precisely so a reload does
    // not re-spend a budget that is global across all users.
    const deck = [
      card('a', { year: 1969, yearConfidence: 'high' }),
      card('b'),
      card('c', { year: null, yearConfidence: 'none' }),
      card('d'),
    ];
    const harness = createHarness(deck, alwaysOk);
    harness.resolver.start();
    await harness.flush();

    // Note `c` is skipped too: `year: null` is a COMPLETED lookup, not a pending one.
    expect(harness.calls).toEqual(['b', 'd']);
  });

  it('should look a duplicated card id up only once', async () => {
    const harness = createHarness([card('dup'), card('other'), card('dup')], alwaysOk);
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['dup', 'other']);
  });

  it('should do nothing when the whole deck is already resolved', async () => {
    const deck = [card('a', { year: 1975, yearConfidence: 'high' })];
    const harness = createHarness(deck, alwaysOk);
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual([]);
  });

  it('should ignore a second start on the same instance', async () => {
    // React 19's StrictMode invokes an effect twice. The hook's cleanup stops the first resolver,
    // and this guard covers a double `start()` on the same one: exactly one crawl either way.
    const harness = createHarness(DECK, alwaysOk);
    harness.resolver.start();
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual(['a', 'b', 'c', 'd', 'e']);
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

  it('should ignore a priority for a card that is already resolved', async () => {
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

  it('should settle a card at null/none after the deferred pass also fails', async () => {
    const harness = createHarness([card('a'), card('b')], (cardId) =>
      cardId === 'a' ? fail('network') : OK,
    );
    harness.resolver.start();
    await harness.flush();

    // Three attempts in each pass, and only then does it settle -- terminally.
    expect(harness.calls.filter((id) => id === 'a')).toHaveLength(6);
    expect(harness.resolved).toContainEqual({ cardId: 'a', year: null, confidence: 'none' });
  });

  it('should stop the whole crawl on not-configured', async () => {
    // A deployment fault (`MUSICBRAINZ_USER_AGENT` unset) fails identically for every remaining
    // card, so hammering the rest of the deck with guaranteed 500s helps nobody. This is the one
    // error that ends the loop.
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

    expect(harness.signals[0]?.aborted).toBe(false);

    harness.resolver.stop();

    expect(harness.signals[0]?.aborted).toBe(true);
  });

  it('should not start after stop()', async () => {
    const harness = createHarness(DECK, alwaysOk);
    harness.resolver.stop();
    harness.resolver.start();
    await harness.flush();

    expect(harness.calls).toEqual([]);
  });
});
