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
 * Phase 8's shareable deck URL is (playlist ids + seed + shuffle version) and nothing more.
 *
 * TWO ALGORITHMS, and both outputs are a STORED FORMAT: a seed in a saved session or a share
 * link is only meaningful together with the exact function that deals it, so changing any
 * constant below (FNV, the avalanche, mulberry32, the key format) re-deals every saved game and
 * every link in circulation with no error anywhere. `shuffle.test.ts` pins both outputs as
 * literals for exactly that reason. A new algorithm is a new `ShuffleVersion`, never an edit.
 *
 * Both are PURE: no `Math.random()`, no `Date.now()`, no `crypto`. The one browser API
 * involved lives in `generateSeed()`, alone, so it is obvious where the non-determinism
 * enters.
 */

/**
 * Hash a string seed down to the 32 bits the generator needs.
 *
 * FNV-1a, then a final avalanche step. The avalanche is load-bearing rather than decorative:
 * without it, seeds that differ in one low bit ("game-1" vs "game-2") produce hash values
 * that differ in one low bit, and mulberry32's first output would barely move -- so two
 * consecutive games would deal near-identical first cards. Version 2 leans on it harder still:
 * there `hashSeed` IS the shuffle, and the keys of two cards whose ids share a long prefix differ
 * only in the last few characters hashed. Exported for the tests, and for `sortDeckByHash`.
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
 * Version 1, FROZEN: Fisher-Yates, seeded, returning a NEW array.
 *
 * Not the default since 2026-09-29 (see `sortDeckByHash`), and kept byte-for-byte because its
 * output is a stored format: every share link minted before that date carries no `v=` and is
 * dealt by this function. Do not "fix" or tidy it -- `shuffle.test.ts` pins its output as a
 * literal, and a change that fails that test is a change that silently re-deals those links.
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

/**
 * Which algorithm dealt a deck. Travels WITH the seed -- in `GameState`, in the saved session and in
 * the share link's `v` param -- because a seed on its own does not say how to deal it.
 *
 * - `1`: `shuffleDeck`, the seeded Fisher-Yates every deck was dealt with until 2026-09-29. Kept,
 *   and kept exactly, because every share link minted before then carries no version and must
 *   still deal the order its sender saw.
 * - `2`: `sortDeckByHash`, the default for every new deal since 2026-09-29.
 */
export type ShuffleVersion = 1 | 2;

/** The algorithm every NEW deal uses. A link or a save without a version means `1`. */
export const CURRENT_SHUFFLE_VERSION: ShuffleVersion = 2;

/**
 * Version 2: order the cards by `hashSeed(seed + ':' + card.id)`, ties broken by id.
 *
 * ===========================================================================
 *  THE ORDER DEPENDS ONLY ON THE SET OF CARDS, NEVER ON THE ORDER THEY ARRIVE IN.
 *
 *  That is the whole reason it replaced Fisher-Yates as the default (review of
 *  the shuffle system, 2026-09-29, decision D1). Fisher-Yates applies one fixed
 *  permutation per (seed, length), so ONE track added to or removed from an
 *  editorial playlist re-randomises the entire deck for a link's recipient, and
 *  re-dealing an already-shuffled deck ("Play again") with a seed gives a
 *  different order from dealing the raw fetch with that same seed -- which is
 *  why a link copied after Play again never reproduced the deck. Here every card
 *  gets its own key, so a card's place relative to every other card is fixed by
 *  the seed alone: a missing card leaves a gap, an extra card slots in, and the
 *  input order is irrelevant by construction.
 *
 *  Uniform for the same reason a random-key sort always is: the keys are
 *  independent-looking 32-bit hashes, so every relative order is equally likely.
 *  Two cards collide on a key with probability ~n^2 / 2^33 (about 3e-5 at 500
 *  cards), and the id tie-break keeps even that deterministic. The comparison is
 *  `<` on the id strings, never `localeCompare`, which varies by runtime locale.
 * ===========================================================================
 *
 * Never mutates its input, exactly like `shuffleDeck`.
 */
export function sortDeckByHash<T extends { id: string }>(items: readonly T[], seed: string): T[] {
  const keyed = items.map((item) => ({ item, key: hashSeed(`${seed}:${item.id}`) }));

  keyed.sort((a, b) => {
    if (a.key !== b.key) return a.key - b.key;
    if (a.item.id < b.item.id) return -1;
    if (a.item.id > b.item.id) return 1;
    return 0;
  });

  return keyed.map(({ item }) => item);
}

/** Deal `items` with the algorithm `version` names. The one function the reducer calls. */
export function dealDeck<T extends { id: string }>(
  items: readonly T[],
  seed: string,
  version: ShuffleVersion,
): T[] {
  return version === 1 ? shuffleDeck(items, seed) : sortDeckByHash(items, seed);
}

/**
 * How many random bytes a generated seed carries. 8 bytes -> 16 hex chars.
 *
 * NOT 2^64 distinct decks under version 1: `shuffleDeck` folds the seed to 32 bits with `hashSeed`
 * and mulberry32 has 32 bits of state, so a given card list has at most 2^32 deals there. Every
 * property a player can observe (first card, a card's position, neighbours, fixed points) is still
 * uniform, and 4.3e9 deals is more games than anyone will play. Version 2 has no such fold -- each
 * card's key hashes the WHOLE seed string -- so it is bounded by the seed count and by n!. The full
 * 64 bits also matter where the seed is an IDENTITY rather than a shuffle input: a link and a save
 * store the whole string, and `linkArrivalIntent` compares it.
 */
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
