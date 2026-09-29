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
 * Phase 8's shareable deck URL is (playlist ids + seed) and nothing more.
 *
 * ===========================================================================
 *  THE OUTPUT IS A STORED FORMAT, AND THERE IS NO VERSION TO PROTECT A CHANGE.
 *
 *  A seed in a saved session or a share link is only meaningful together with
 *  the exact function that deals it, so changing any constant below (FNV, the
 *  avalanche, the key format, the tie-break) re-deals every saved game and every
 *  link in circulation, with no error anywhere. `shuffle.test.ts` pins the
 *  output as literals for exactly that reason: a failing pin is fixed by
 *  reverting, never by updating the literal.
 *
 *  Until 2026-09-29 there were two algorithms and a `v` param saying which one
 *  dealt a link: the seeded Fisher-Yates every deck used before that day, and
 *  this one. The developer removed Fisher-Yates the same day, with no saved games
 *  to protect, accepting that a link minted before 2026-09-29 now deals a
 *  different order. So a FUTURE algorithm change has no lever left: it has to
 *  bring a version back (in the link, the save and `GameState`) or accept the
 *  same re-deal knowingly. Links minted while the version existed carry `v=2`,
 *  and `parseDeckLink` ignores it.
 * ===========================================================================
 *
 * PURE: no `Math.random()`, no `Date.now()`, no `crypto`. The one browser API involved lives in
 * `generateSeed()`, alone, so it is obvious where the non-determinism enters.
 */

/**
 * Hash a string to 32 bits: FNV-1a, then a final avalanche step.
 *
 * The avalanche is load-bearing rather than decorative. `hashSeed` IS the shuffle -- every card's
 * sort key is `hashSeed(seed + ':' + id)` -- and without the avalanche two keys whose strings share
 * a long prefix (the same seed, ids that differ only near the end) would differ only in their low
 * bits, which is a visible pattern in the order. Exported for the tests.
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
 * Shuffle `items` by sorting them on `hashSeed(seed + ':' + item.id)`, ties broken by id.
 *
 * ===========================================================================
 *  THE ORDER DEPENDS ONLY ON THE SET OF CARDS, NEVER ON THE ORDER THEY ARRIVE IN.
 *
 *  That is why it replaced a seeded Fisher-Yates (review of the shuffle system,
 *  2026-09-29, decision D1). Fisher-Yates applies one fixed permutation per
 *  (seed, length), so ONE track added to or removed from an editorial playlist
 *  re-randomised the entire deck for a link's recipient, and re-dealing an
 *  already-shuffled deck ("Play again") with a seed gave a different order from
 *  dealing the raw fetch with that same seed -- which is why a link copied after
 *  Play again never reproduced the deck. Here every card gets its own key, so a
 *  card's place relative to every other card is fixed by the seed alone: a
 *  missing card leaves a gap, an extra card slots in, and the input order is
 *  irrelevant by construction -- for DISTINCT ids, which `deck-merge.ts`
 *  guarantees. Two cards sharing an id get equal keys and equal tie-breaks, so
 *  the stable sort keeps them in input order.
 *
 *  Uniform for the same reason a random-key sort always is: the keys are
 *  independent-looking 32-bit hashes, so every relative order is equally likely.
 *  Two cards collide on a key with probability ~n^2 / 2^33 (about 3e-5 at 500
 *  cards), and the id tie-break keeps even that deterministic. The comparison is
 *  `<` on the id strings, never `localeCompare`, which varies by runtime locale.
 * ===========================================================================
 *
 * Never mutates its input: the reducer treats the cards handed to `START` as data it does not own,
 * and the playlist hook may well be holding the same array in its own fetch state.
 */
export function shuffleDeck<T extends { id: string }>(items: readonly T[], seed: string): T[] {
  const keyed = items.map((item) => ({ item, key: hashSeed(`${seed}:${item.id}`) }));

  keyed.sort((a, b) => {
    if (a.key !== b.key) return a.key - b.key;
    if (a.item.id < b.item.id) return -1;
    if (a.item.id > b.item.id) return 1;
    return 0;
  });

  return keyed.map(({ item }) => item);
}

/**
 * How many random bytes a generated seed carries. 8 bytes -> 16 hex chars.
 *
 * Each card's key hashes the WHOLE seed string, so the number of distinct deals is bounded by the
 * seed count and by n!, not by a 32-bit PRNG state. The full 64 bits also matter where the seed is
 * an IDENTITY rather than a shuffle input: a link and a save store the whole string, and
 * `linkArrivalIntent` compares it.
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
