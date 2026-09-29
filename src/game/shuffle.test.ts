import { describe, expect, it } from 'vitest';

import { generateSeed, hashSeed, shuffleDeck } from './shuffle';

const DECK = Array.from({ length: 52 }, (_, i) => `card-${i}`);

/** The smallest shape `shuffleDeck` accepts: it reads `id` and nothing else. */
const CARDS = DECK.map((id) => ({ id }));

const TEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const TEN_CARDS = TEN.map((id) => ({ id }));

const ids = (cards: readonly { id: string }[]): string[] => cards.map((card) => card.id);

/**
 * How many distinct orders `deal` reaches for three cards over 2000 seeds. A uniform shuffle
 * reaches all 6 (each has a ~1e-158 chance of being missed). A shuffle that can only produce
 * single-cycle permutations (Sattolo's algorithm, the classic swap-loop off-by-one) reaches 2, and
 * a sort whose keys ignore the seed or the id reaches 1.
 */
function distinctOrdersOfThree(deal: (seed: string) => string[]): number {
  const orders = new Set<string>();
  for (let i = 0; i < 2000; i++) orders.add(deal(`seed-${i}`).join(''));
  return orders.size;
}

/**
 * The mean number of cards of `TEN` left in their original place, over 1000 seeds. Expected 1 for
 * a uniform shuffle at any n, with a standard error of ~0.03 here, so 0.7-1.3 is ten standard
 * errors either side. A single-cycle shuffle never leaves a card in place: its mean is exactly 0.
 */
function meanFixedPointsOfTen(deal: (seed: string) => string[]): number {
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    total += deal(`fixed-${i}`).filter((card, index) => card === TEN[index]).length;
  }
  return total / 1000;
}

function popcount(value: number): number {
  let bits = 0;
  for (let v = value >>> 0; v !== 0; v >>>= 1) bits += v & 1;
  return bits;
}

describe('shuffleDeck', () => {
  it('should keep dealing the exact orders it deals today', () => {
    // THIS IS A STORED FORMAT, NOT AN IMPLEMENTATION DETAIL. Seeds live in saved sessions and
    // share links, and there is no version beside them to say which algorithm dealt them -- so
    // the output of this function IS the meaning of every seed in circulation. Every other test
    // here compares the shuffle with ITSELF, so changing `hashSeed`, the `seed:id` key format or
    // the tie-break would pass the rest of the suite while silently re-dealing every saved game
    // and every link. If this fails, the fix is to revert the change, never to update the literals.
    expect(ids(shuffleDeck(TEN_CARDS, 'a1b2c3d4e5f60718'))).toEqual([
      'e',
      'c',
      'h',
      'b',
      'i',
      'f',
      'a',
      'g',
      'd',
      'j',
    ]);
    expect(ids(shuffleDeck(TEN_CARDS, '0f1e2d3c4b5a6978'))).toEqual([
      'a',
      'i',
      'b',
      'f',
      'e',
      'd',
      'h',
      'j',
      'c',
      'g',
    ]);
  });

  it('should produce the same order for the same seed and a different one for another', () => {
    // Reproducibility is not a nicety -- resume replays the persisted seed, and the shareable deck
    // URL is (playlist ids + seed), with no card list in it. The second line guards against the
    // seed being accepted and then ignored, which would look correct in every other test here.
    expect(shuffleDeck(CARDS, 'seed-a')).toEqual(shuffleDeck(CARDS, 'seed-a'));
    expect(ids(shuffleDeck(CARDS, 'seed-a'))).not.toEqual(ids(shuffleDeck(CARDS, 'seed-b')));
  });

  it('should produce a different opening for two seeds differing in one character', () => {
    // The reason `hashSeed()` ends with an avalanche step: without it, "game-1:card-0" and
    // "game-2:card-0" differ only in low bits, so two consecutive games could deal
    // near-identical opening cards.
    const a = ids(shuffleDeck(CARDS, 'game-1'));
    const b = ids(shuffleDeck(CARDS, 'game-2'));

    expect(a).not.toEqual(b);
    expect(a[0]).not.toEqual(b[0]);
  });

  it('should spread one card across the deck over different seeds', () => {
    // A constant key, or one that ignores the seed, still returns a valid permutation. Ten
    // different seeds must not all send card 0 to the same place.
    const positions = new Set(
      Array.from({ length: 10 }, (_, i) =>
        ids(shuffleDeck(CARDS, `spread-${i}`)).indexOf('card-0'),
      ),
    );

    expect(positions.size).toBeGreaterThan(5);
  });

  it('should return a permutation containing every input card exactly once', () => {
    const sorted = ids(shuffleDeck(CARDS, 'permutation'));

    expect(sorted).toHaveLength(DECK.length);
    expect([...sorted].sort()).toEqual([...DECK].sort());
  });

  it('should deal the same order whatever order the cards arrive in', () => {
    // THE reason the hash sort replaced Fisher-Yates: "Play again" re-deals an already-shuffled
    // deck, and a fetch may list the same tracks in a different order. Neither may change what a
    // seed deals.
    const scrambled = shuffleDeck(CARDS, 'scramble');
    const reversed = [...CARDS].reverse();

    expect(ids(shuffleDeck(scrambled, 'order'))).toEqual(ids(shuffleDeck(CARDS, 'order')));
    expect(ids(shuffleDeck(reversed, 'order'))).toEqual(ids(shuffleDeck(CARDS, 'order')));
  });

  it('should keep every other card in the same relative order when one card is removed', () => {
    // An editorial playlist that drops a track between the sender's fetch and the recipient's
    // leaves a gap in the recipient's deck -- it must not re-randomise it.
    const full = ids(shuffleDeck(CARDS, 'drift'));
    const withoutOne = ids(
      shuffleDeck(
        CARDS.filter(({ id }) => id !== 'card-17'),
        'drift',
      ),
    );

    expect(withoutOne).toEqual(full.filter((id) => id !== 'card-17'));
  });

  it('should keep every other card in the same relative order when one card is added', () => {
    const full = ids(shuffleDeck(CARDS, 'drift'));
    const withOneMore = ids(shuffleDeck([...CARDS, { id: 'card-new' }], 'drift'));

    expect(withOneMore.filter((id) => id !== 'card-new')).toEqual(full);
  });

  it('should keep duplicate ids and deal them deterministically', () => {
    // Equal keys cannot be forced from outside, but a duplicate id hashes to the same key, which
    // exercises the tie-break path. The merge dedupes by id, so this is a guard, not a feature.
    const withDuplicate = [...TEN_CARDS, { id: 'c' }];
    const dealt = ids(shuffleDeck(withDuplicate, 'duplicates'));

    expect(dealt).toHaveLength(11);
    expect(dealt.filter((id) => id === 'c')).toHaveLength(2);
    expect(ids(shuffleDeck(withDuplicate, 'duplicates'))).toEqual(dealt);
  });

  it('should not mutate the input array', () => {
    const input = [...CARDS];
    shuffleDeck(input, 'purity');

    expect(input).toEqual(CARDS);
  });

  it('should handle an empty deck and a single-card deck', () => {
    expect(shuffleDeck([], 'empty')).toEqual([]);
    expect(ids(shuffleDeck([{ id: 'only' }], 'single'))).toEqual(['only']);
  });

  it('should reach every order of three cards', () => {
    const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    expect(distinctOrdersOfThree((seed) => ids(shuffleDeck(three, seed)))).toBe(6);
  });

  it('should leave one card in place on average', () => {
    const mean = meanFixedPointsOfTen((seed) => ids(shuffleDeck(TEN_CARDS, seed)));

    expect(mean).toBeGreaterThan(0.7);
    expect(mean).toBeLessThan(1.3);
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

  it('should keep hashing to the exact values it hashes to today', () => {
    // Every card's sort key is this function's output, so it is as much a stored format as the
    // deck order. Pinned directly so a failure names the hash rather than a deck.
    expect(hashSeed('')).toBe(2872998923);
    expect(hashSeed('a1b2c3d4e5f60718')).toBe(108832657);
    expect(hashSeed('game-1')).toBe(1122352814);
  });

  it('should change about half of its output bits when the last character changes', () => {
    // The avalanche step's job. Without it, FNV-1a over "game-…-0" and "game-…-1" differs in
    // barely any bits, so consecutive games deal near-identical first cards -- and the shuffle's
    // `seed:id` keys, which differ only in their final characters, would barely move apart.
    const pairs = 200;
    let changedBits = 0;
    for (let i = 0; i < pairs; i++) {
      changedBits += popcount(hashSeed(`game-${i}-0`) ^ hashSeed(`game-${i}-1`));
    }
    const mean = changedBits / pairs;

    expect(mean).toBeGreaterThan(12);
    expect(mean).toBeLessThan(20);
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

  it('should generate two different well-formed seeds for two deals', () => {
    // The smallest form of "a different order every game": two seeds, both valid, not equal.
    const first = generateSeed();
    const second = generateSeed();

    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(second).toMatch(/^[0-9a-f]{16}$/);
    expect(first).not.toBe(second);
  });
});
