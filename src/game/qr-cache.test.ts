/**
 * Node-environment unit tests: the cache is a pure map over strings and touches no DOM, which is
 * why it lives in `src/game/` rather than beside `QrCode.tsx`.
 *
 * The behaviour that MATTERS here is the key, not the map. A key that folded `displaySize` in, or
 * dropped `size`, would serve a 160px bitmap to a card asking for 224px -- and a QR scaled UP
 * blurs exactly the module edges a phone camera is looking for. Everything else in this file is
 * the map doing what a map does.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { clearQrCache, qrCacheKey, readQrCache, writeQrCache } from './qr-cache';

describe('qr-cache', () => {
  beforeEach(clearQrCache);

  it('should distinguish two sizes of the same url', () => {
    // The Phase 7 split of generated size from displayed size is what this protects. `size` is
    // the bitmap and it must stay in the key.
    const url = 'https://open.spotify.com/track/3z8h0TU7ReDPLIbEnYhWZb';

    expect(qrCacheKey(url, 160)).not.toBe(qrCacheKey(url, 224));
  });

  it('should distinguish two urls at the same size', () => {
    expect(qrCacheKey('https://open.spotify.com/track/a', 224)).not.toBe(
      qrCacheKey('https://open.spotify.com/track/b', 224),
    );
  });

  it('should return null for a key that has never been generated', () => {
    // `null` rather than `undefined`, because `QrCode` treats it as one of two sources for the
    // same nullable value and mixing the two empties would need a second check at the use site.
    expect(readQrCache(qrCacheKey('https://open.spotify.com/track/x', 224))).toBeNull();
  });

  it('should return a written code back', () => {
    const key = qrCacheKey('https://open.spotify.com/track/x', 224);
    writeQrCache(key, 'data:image/png;base64,AAAA');

    expect(readQrCache(key)).toBe('data:image/png;base64,AAAA');
  });

  it('should empty on clear', () => {
    // Test-only, and the reason it is exported at all: Vitest isolates modules per FILE, so
    // every DOM test file that renders a card resets this between tests.
    const key = qrCacheKey('https://open.spotify.com/track/x', 224);
    writeQrCache(key, 'data:image/png;base64,AAAA');
    clearQrCache();

    expect(readQrCache(key)).toBeNull();
  });
});
