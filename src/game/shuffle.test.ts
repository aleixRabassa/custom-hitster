import { describe, expect, it } from 'vitest';

import { generateSeed, hashSeed, shuffleDeck } from './shuffle';

/** Plain strings, not cards: nothing in `shuffle.ts` looks at what it is shuffling. */
const DECK = Array.from({ length: 52 }, (_, i) => `card-${i}`);

describe('shuffleDeck', () => {
  it('should produce the same order for the same seed', () => {
    // Reproducibility is not a nicety -- resume replays the persisted seed, and Phase 8's
    // shareable deck URL is (playlist id + seed) and nothing else.
    expect(shuffleDeck(DECK, 'seed-a')).toEqual(shuffleDeck(DECK, 'seed-a'));
  });

  it('should produce a different order for a different seed', () => {
    // Guards against the seed being accepted and then ignored, which would look correct in
    // every other test here.
    expect(shuffleDeck(DECK, 'seed-a')).not.toEqual(shuffleDeck(DECK, 'seed-b'));
  });

  it('should produce a different order for two seeds differing in one character', () => {
    // The reason `hashSeed()` ends with an avalanche step: without it, "game-1" and "game-2"
    // differ only in low bits, so mulberry32's first outputs barely move and two consecutive
    // games deal near-identical opening cards.
    const a = shuffleDeck(DECK, 'game-1');
    const b = shuffleDeck(DECK, 'game-2');

    expect(a).not.toEqual(b);
    expect(a[0]).not.toEqual(b[0]);
  });

  it('should return a permutation containing every input card exactly once', () => {
    // The classic Fisher-Yates off-by-one does not crash: it silently duplicates or drops an
    // element, which in a card game looks like nothing at all.
    const shuffled = shuffleDeck(DECK, 'permutation');

    expect(shuffled).toHaveLength(DECK.length);
    expect([...shuffled].sort()).toEqual([...DECK].sort());
    expect(new Set(shuffled).size).toBe(DECK.length);
  });

  it('should not mutate the input array', () => {
    // The reducer hands `START`'s cards straight in, and Phase 6 may still be holding that
    // same array as its fetch result.
    const input = [...DECK];
    shuffleDeck(input, 'purity');

    expect(input).toEqual(DECK);
  });

  it('should handle an empty deck and a single-card deck', () => {
    expect(shuffleDeck([], 'empty')).toEqual([]);
    expect(shuffleDeck(['only'], 'single')).toEqual(['only']);
  });

  it('should not leave most cards in their original position', () => {
    // A coarse distribution check: a generator returning a constant, or a loop that never
    // swaps, still passes every test above. For 52 cards the expected number of fixed points
    // is 1, so a threshold of 10 is far outside noise and nowhere near flaky.
    const shuffled = shuffleDeck(DECK, 'distribution');
    const fixedPoints = shuffled.filter((card, index) => card === DECK[index]).length;

    expect(fixedPoints).toBeLessThan(10);
  });

  it('should spread cards across the deck rather than rotating it', () => {
    // A rotation is a permutation with no fixed points, so it would satisfy the check above
    // while dealing an entirely predictable deck. Ten different seeds must not all send card 0
    // to the same place.
    const positions = new Set(
      Array.from({ length: 10 }, (_, i) => shuffleDeck(DECK, `spread-${i}`).indexOf('card-0')),
    );

    expect(positions.size).toBeGreaterThan(5);
  });
});

describe('hashSeed', () => {
  it('should return a stable unsigned 32-bit value for a given seed', () => {
    const hash = hashSeed('stability');

    expect(hash).toBe(hashSeed('stability'));
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('generateSeed', () => {
  it('should generate distinct seeds on repeated calls', () => {
    const seeds = new Set(Array.from({ length: 100 }, () => generateSeed()));

    // A random seed per game (decision 7): a party game that deals the same order every time
    // for the same playlist is a worse game.
    expect(seeds.size).toBe(100);
  });

  it('should generate a hex string of a fixed length', () => {
    // It ends up in `localStorage` and, from Phase 8, in a URL -- so it must contain nothing
    // either of those can argue about.
    expect(generateSeed()).toMatch(/^[0-9a-f]{16}$/);
  });
});
