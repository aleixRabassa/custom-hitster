import { describe, expect, it } from 'vitest';

import { dealDeck, generateSeed, hashSeed, shuffleDeck, sortDeckByHash } from './shuffle';

/** Plain strings, not cards: nothing in `shuffle.ts` looks at what it is shuffling. */
const DECK = Array.from({ length: 52 }, (_, i) => `card-${i}`);

/** The smallest shape `sortDeckByHash` accepts: it reads `id` and nothing else. */
const CARDS = DECK.map((id) => ({ id }));

const TEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const TEN_CARDS = TEN.map((id) => ({ id }));

const ids = (cards: readonly { id: string }[]): string[] => cards.map((card) => card.id);

/**
 * How many distinct orders `deal` reaches for three cards over 2000 seeds. A uniform shuffle
 * reaches all 6 (each has a ~1e-158 chance of being missed). Sattolo's algorithm -- the `* i`
 * off-by-one the source warns about -- only produces single-cycle permutations, so it reaches 2.
 */
function distinctOrdersOfThree(deal: (seed: string) => string[]): number {
  const orders = new Set<string>();
  for (let i = 0; i < 2000; i++) orders.add(deal(`seed-${i}`).join(''));
  return orders.size;
}

/**
 * The mean number of cards of `TEN` left in their original place, over 1000 seeds. Expected 1 for
 * a uniform shuffle at any n, with a standard error of ~0.03 here, so 0.7-1.3 is ten standard
 * errors either side. Sattolo never leaves a card in place: its mean is exactly 0.
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
  it('should produce the same order for the same seed', () => {
    // Reproducibility is not a nicety -- resume replays the persisted seed, and the shareable deck
    // URL is (playlist ids + seed + shuffle version), with no card list in it.
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

  it('should keep dealing the exact orders it dealt before 2026-09-29', () => {
    // THIS IS A STORED FORMAT, NOT AN IMPLEMENTATION DETAIL. Seeds live in saved sessions and
    // share links, and a link minted before 2026-09-29 carries no `v=` -- it is dealt by this
    // function forever. Every other test in this block compares the shuffle with ITSELF, so
    // changing any FNV, avalanche or mulberry32 constant passed the whole suite while silently
    // re-dealing every such link. These literals are the promise that it still deals the order
    // its sender saw. If this fails, the fix is to revert the change, never to update the
    // literals: a new algorithm is a new `ShuffleVersion`.
    expect(shuffleDeck(TEN, 'a1b2c3d4e5f60718')).toEqual([
      'e',
      'g',
      'j',
      'h',
      'c',
      'd',
      'b',
      'f',
      'a',
      'i',
    ]);
    expect(shuffleDeck(TEN, '0f1e2d3c4b5a6978')).toEqual([
      'h',
      'd',
      'b',
      'a',
      'e',
      'c',
      'g',
      'f',
      'i',
      'j',
    ]);
  });

  it('should reach every order of three cards', () => {
    // The off-by-one the source warns about (`* i` instead of `* (i + 1)`) is Sattolo's
    // algorithm: it still returns a permutation with every card once, passes every check above,
    // and can only ever deal 2 of the 6 orders of three cards.
    expect(distinctOrdersOfThree((seed) => shuffleDeck(['a', 'b', 'c'], seed))).toBe(6);
  });

  it('should leave one card in place on average', () => {
    // The same off-by-one seen from the other side: Sattolo never leaves a card where it was,
    // so its mean is 0 where a uniform shuffle's is 1.
    const mean = meanFixedPointsOfTen((seed) => shuffleDeck(TEN, seed));

    expect(mean).toBeGreaterThan(0.7);
    expect(mean).toBeLessThan(1.3);
  });
});

describe('sortDeckByHash', () => {
  it('should keep dealing the exact orders it deals today', () => {
    // Version 2 is the default for every deal since 2026-09-29, and its output becomes a stored
    // format the moment the first `v=2` link is copied -- so it is pinned for the same reason
    // `shuffleDeck` is. Changing `hashSeed` or the `seed:id` key format fails here.
    expect(ids(sortDeckByHash(TEN_CARDS, 'a1b2c3d4e5f60718'))).toEqual([
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
    expect(ids(sortDeckByHash(TEN_CARDS, '0f1e2d3c4b5a6978'))).toEqual([
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
    expect(sortDeckByHash(CARDS, 'seed-a')).toEqual(sortDeckByHash(CARDS, 'seed-a'));
    expect(ids(sortDeckByHash(CARDS, 'seed-a'))).not.toEqual(ids(sortDeckByHash(CARDS, 'seed-b')));
  });

  it('should return a permutation containing every input card exactly once', () => {
    const sorted = ids(sortDeckByHash(CARDS, 'permutation'));

    expect(sorted).toHaveLength(DECK.length);
    expect([...sorted].sort()).toEqual([...DECK].sort());
  });

  it('should deal the same order whatever order the cards arrive in', () => {
    // THE reason version 2 exists: "Play again" re-deals an already-shuffled deck, and a fetch
    // may list the same tracks in a different order. Neither may change what a seed deals.
    const scrambled = shuffleDeck(CARDS, 'scramble');
    const reversed = [...CARDS].reverse();

    expect(ids(sortDeckByHash(scrambled, 'order'))).toEqual(ids(sortDeckByHash(CARDS, 'order')));
    expect(ids(sortDeckByHash(reversed, 'order'))).toEqual(ids(sortDeckByHash(CARDS, 'order')));
  });

  it('should keep every other card in the same relative order when one card is removed', () => {
    // An editorial playlist that drops a track between the sender's fetch and the recipient's
    // leaves a gap in the recipient's deck -- it must not re-randomise it.
    const full = ids(sortDeckByHash(CARDS, 'drift'));
    const withoutOne = ids(
      sortDeckByHash(
        CARDS.filter(({ id }) => id !== 'card-17'),
        'drift',
      ),
    );

    expect(withoutOne).toEqual(full.filter((id) => id !== 'card-17'));
  });

  it('should keep every other card in the same relative order when one card is added', () => {
    const full = ids(sortDeckByHash(CARDS, 'drift'));
    const withOneMore = ids(sortDeckByHash([...CARDS, { id: 'card-new' }], 'drift'));

    expect(withOneMore.filter((id) => id !== 'card-new')).toEqual(full);
  });

  it('should keep duplicate ids and deal them deterministically', () => {
    // Equal keys cannot be forced from outside, but a duplicate id hashes to the same key, which
    // exercises the tie-break path. The merge dedupes by id, so this is a guard, not a feature.
    const withDuplicate = [...TEN_CARDS, { id: 'c' }];
    const dealt = ids(sortDeckByHash(withDuplicate, 'duplicates'));

    expect(dealt).toHaveLength(11);
    expect(dealt.filter((id) => id === 'c')).toHaveLength(2);
    expect(ids(sortDeckByHash(withDuplicate, 'duplicates'))).toEqual(dealt);
  });

  it('should not mutate the input array', () => {
    const input = [...CARDS];
    sortDeckByHash(input, 'purity');

    expect(input).toEqual(CARDS);
  });

  it('should handle an empty deck and a single-card deck', () => {
    expect(sortDeckByHash([], 'empty')).toEqual([]);
    expect(ids(sortDeckByHash([{ id: 'only' }], 'single'))).toEqual(['only']);
  });

  it('should reach every order of three cards', () => {
    const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    expect(distinctOrdersOfThree((seed) => ids(sortDeckByHash(three, seed)))).toBe(6);
  });

  it('should leave one card in place on average', () => {
    const mean = meanFixedPointsOfTen((seed) => ids(sortDeckByHash(TEN_CARDS, seed)));

    expect(mean).toBeGreaterThan(0.7);
    expect(mean).toBeLessThan(1.3);
  });
});

describe('dealDeck', () => {
  it('should deal version 1 with shuffleDeck and version 2 with sortDeckByHash', () => {
    // The two algorithms disagree for this seed (see the pinned literals above), so a dispatch
    // that ignored `version` would fail one of the two lines.
    expect(dealDeck(TEN_CARDS, 'a1b2c3d4e5f60718', 1)).toEqual(
      shuffleDeck(TEN_CARDS, 'a1b2c3d4e5f60718'),
    );
    expect(dealDeck(TEN_CARDS, 'a1b2c3d4e5f60718', 2)).toEqual(
      sortDeckByHash(TEN_CARDS, 'a1b2c3d4e5f60718'),
    );
    expect(ids(dealDeck(TEN_CARDS, 'a1b2c3d4e5f60718', 1))).not.toEqual(
      ids(dealDeck(TEN_CARDS, 'a1b2c3d4e5f60718', 2)),
    );
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
    // Both shuffle versions are built on this function, so its output is as much a stored format
    // as theirs. Pinned directly so a failure names the hash rather than a deck.
    expect(hashSeed('')).toBe(2872998923);
    expect(hashSeed('a1b2c3d4e5f60718')).toBe(108832657);
    expect(hashSeed('game-1')).toBe(1122352814);
  });

  it('should change about half of its output bits when the last character changes', () => {
    // The avalanche step's job. Without it, FNV-1a over "game-…-0" and "game-…-1" differs in
    // barely any bits, so consecutive games deal near-identical first cards -- and version 2's
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
