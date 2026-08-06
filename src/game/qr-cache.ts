/**
 * Generated QR codes, kept for the life of the page and shared by every `QrCode` element.
 *
 * ===========================================================================
 *  THIS EXISTS SO THE CARD BEHIND THE CURRENT ONE CAN PRELOAD ITS CODE, AND
 *  SO THAT PRELOAD SURVIVES THE ADVANCE.
 *
 *  `CardStack` renders the next card's hidden face behind the current one, and
 *  its QR is generated while the player is still looking at the card in front.
 *  When the current card is committed, though, that element is NOT the element
 *  that becomes the front card: the back is a plain div in `CardStack`, the
 *  front card is a `Card` inside an `AnimatePresence` keyed on card id, and the
 *  advance unmounts one and mounts the other. Without a cache the new front card
 *  starts generation from scratch and paints the pulsing placeholder for the
 *  length of a `toDataURL()` -- the exact flash the preload was added to remove.
 *
 *  So the cache is keyed on what a code is generated FOR (`size` and `url`,
 *  never `displaySize` -- see `QrCode.tsx`) rather than on which element asked
 *  for it, and `QrCode` reads it DURING RENDER. An effect would be a frame too
 *  late: `useEffect` runs after paint, so the placeholder would still be painted
 *  once on the advance.
 *
 *  NOTHING IS EVICTED. A deck is capped at `MAX_EMBED_TRACKS` (100) and a 224px
 *  code is a couple of kB of base64, so the ceiling is a few hundred kB for a
 *  session that has actually played every card -- and a page reload clears it.
 *  An LRU here would be a cache with a bug surface and no measured problem.
 * ===========================================================================
 *
 * Lives in `src/game/` rather than beside the component for the usual reason: it is a pure,
 * framework-free decision over strings, so it is testable without a DOM. `clearQrCache` exists
 * for tests only -- module state persists across the tests in a file (Vitest isolates per FILE,
 * not per test), so a file that asserts on generation counts or on the placeholder must start
 * from an empty cache or it asserts against whatever an earlier test left behind.
 */

const cache = new Map<string, string>();

/**
 * What a generated code belongs to.
 *
 * `size` is the BITMAP edge length and `displaySize` must never enter this — the two were one
 * prop until Phase 7 and keeping them apart is what stops a fluid card from re-encoding on
 * every frame of a resize. A key built from the displayed size would put them back together.
 */
export function qrCacheKey(url: string, size: number): string {
  return `${size}|${url}`;
}

/** The generated data URL for a key, or `null` if it has never been generated. */
export function readQrCache(key: string): string | null {
  return cache.get(key) ?? null;
}

/** Records a generated code. Called even for a superseded generation: the code is still valid. */
export function writeQrCache(key: string, dataUrl: string): void {
  cache.set(key, dataUrl);
}

/** Test-only. See the header: module state outlives a test, so a test file has to reset it. */
export function clearQrCache(): void {
  cache.clear();
}
