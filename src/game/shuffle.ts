/**
 * The seeded deck shuffle.
 *
 * ===========================================================================
 *  THE SHUFFLE MUST RUN **BEFORE** YEAR RESOLUTION. NOT AFTER.
 *
 *  `plan.md` §3 spends a paragraph on this because the two are easy to get
 *  backwards, and getting them backwards is not a cosmetic mistake:
 *
 *  Resolution walks the deck in PLAY order, one lookup at a time, because a
 *  cold lookup costs 1.3-3.6 s against a budget that is global across every
 *  user of the app (see `resolver.ts`). If the deck were shuffled AFTER the
 *  first lookup, that first -- and slowest -- request would have been spent on
 *  a track that then lands somewhere random in the deck, leaving the actual
 *  card 1 unresolved and Start blocked on a lookup that already finished for a
 *  card nobody is looking at.
 *
 *  So `gameReducer`'s `START` shuffles synchronously, and the resolver is only
 *  ever handed an already-shuffled deck (decision 15). The shuffle is pure and
 *  instant, so there is no reason to defer it.
 * ===========================================================================
 *
 * WHY IT IS SEEDED AT ALL, rather than just calling `Math.random()`: the seed is what makes
 * a dealt deck reproducible, and three things rest on that -- a reload restores the same
 * order from the persisted seed, the same deck can be re-dealt without re-fetching, and
 * Phase 8's shareable deck URL is (playlist id + seed) and nothing more.
 *
 * `shuffleDeck()` is therefore PURE: no `Math.random()`, no `Date.now()`, no `crypto`. The
 * one browser API involved lives in `generateSeed()`, alone, so it is obvious where the
 * non-determinism enters.
 */

/**
 * Hash a string seed down to the 32 bits the generator needs.
 *
 * FNV-1a, then a final avalanche step. The avalanche is load-bearing rather than decorative:
 * without it, seeds that differ in one low bit ("game-1" vs "game-2") produce hash values
 * that differ in one low bit, and mulberry32's first output would barely move -- so two
 * consecutive games would deal near-identical first cards. Exported for the tests.
 */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;

  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;

  return h >>> 0;
}

/**
 * mulberry32: a 32-bit PRNG in six lines, good enough to shuffle a hundred cards.
 *
 * Hand-written rather than pulled from a package (plan.phase-3.md: no new dependencies). The
 * requirement here is "reproducible and not visibly patterned", not cryptographic quality --
 * `generateSeed()` is where real entropy belongs.
 */
function createRandom(state: number): () => number {
  let a = state >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates, seeded, returning a NEW array.
 *
 * Never mutates its input: the reducer treats the cards handed to `START` as data it does not
 * own, and Phase 6 may well be holding the same array in its own fetch state.
 *
 * Generic rather than `Card[]`-specific because nothing here looks at a card -- and a
 * `shuffleDeck<T>` is trivially testable with plain strings.
 */
export function shuffleDeck<T>(items: readonly T[], seed: string): T[] {
  const shuffled = [...items];
  const random = createRandom(hashSeed(seed));

  // Downwards, and the swap index is `random() * (i + 1)` -- INCLUSIVE of `i`. The classic
  // off-by-one here (`* i`, or looping to `i > 0` with an exclusive bound) is not a crash: it
  // silently biases the permutation, which is exactly the kind of bug a card game hides well.
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    // `noUncheckedIndexedAccess` makes these `T | undefined`, so read them out first: both
    // indices are provably in range, and asserting on the destructured values reads better
    // than four non-null assertions inline.
    const a = shuffled[i] as T;
    const b = shuffled[j] as T;
    shuffled[i] = b;
    shuffled[j] = a;
  }

  return shuffled;
}

/** How many random bytes a generated seed carries. 8 bytes -> 16 hex chars, ~2^64 decks. */
const SEED_BYTES = 8;

/**
 * A fresh random seed, and the ONLY non-deterministic thing in this module.
 *
 * Kept out of `shuffleDeck()` so the shuffle itself stays pure and the browser API sits in
 * exactly one named place. Hex rather than base64url because a seed ends up in a URL and in
 * `localStorage`, and hex has no characters either of those can argue about.
 *
 * A random seed per game, NOT a seed derived from the playlist id (decision 7): a party game
 * that deals the same order every time for the same playlist is a worse game.
 */
export function generateSeed(): string {
  const bytes = new Uint8Array(SEED_BYTES);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
