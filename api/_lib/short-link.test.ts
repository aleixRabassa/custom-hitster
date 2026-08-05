/**
 * Offline tests for the short-link resolver.
 *
 * `fetch` is a hand-written double that returns a scripted response per URL, which is what
 * makes the SSRF refusal below testable at all: a real redirect to `evil.example` is not
 * something a unit test can arrange, and it is the single most important behaviour in the file.
 *
 * The double also RECORDS every call, so the tests can assert on what the resolver asked for
 * rather than only on what it returned -- `should not follow redirects automatically` is
 * entirely an assertion about the `init` it passed.
 */

import { describe, expect, it, vi } from 'vitest';

import { resolveShortLink } from './short-link.js';
import type { RedirectFetchLike, RedirectResponseLike } from './short-link.js';

const SHORT_URL = 'https://spotify.link/aBcDeF12345';
const PLAYLIST_URL = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

/** A response with the fields the resolver reads and nothing else. */
function response(status: number, location?: string): RedirectResponseLike {
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' && location ? location : null),
    },
  };
}

interface FetchDouble {
  fetchImpl: RedirectFetchLike;
  calls: { url: string; init: { redirect: 'manual'; headers?: Record<string, string> } }[];
}

/**
 * A fetch double driven by a URL -> response map.
 *
 * A URL absent from the map REJECTS, which models a dead host and is also what makes an
 * unexpected request visible: a resolver that followed a URL it should have refused fails
 * loudly rather than quietly returning something plausible.
 */
function fetchDouble(routes: Record<string, RedirectResponseLike>): FetchDouble {
  const calls: FetchDouble['calls'] = [];

  const fetchImpl: RedirectFetchLike = (url, init) => {
    calls.push({ url, init });
    const scripted = routes[url] ?? routes[url.replace(/\/$/, '')];
    if (!scripted) return Promise.reject(new Error(`ENOTFOUND ${url}`));

    return Promise.resolve(scripted);
  };

  return { fetchImpl, calls };
}

describe('resolveShortLink', () => {
  it('should resolve a short link through one redirect', async () => {
    // The shape measured live on 2026-08-05: a single 307 straight to open.spotify.com.
    const { fetchImpl } = fetchDouble({
      [SHORT_URL]: response(307, PLAYLIST_URL),
      [PLAYLIST_URL]: response(200),
    });

    expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({ ok: true, url: PLAYLIST_URL });
  });

  it('should follow a chain of two redirects', async () => {
    // Through the sibling short host, which is why it is on the allow-list.
    const middle = 'https://link.tospotify.com/xyz';
    const { fetchImpl } = fetchDouble({
      [SHORT_URL]: response(302, middle),
      [middle]: response(307, PLAYLIST_URL),
      [PLAYLIST_URL]: response(200),
    });

    expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({ ok: true, url: PLAYLIST_URL });
  });

  it('should follow a relative Location against the URL it came from', async () => {
    // `Location: /playlist/…` is legal and real. Treated as absolute it would produce garbage
    // that then failed the allow-list -- a confusing failure for an ordinary response.
    const { fetchImpl } = fetchDouble({
      [SHORT_URL]: response(307, 'https://open.spotify.com/x'),
      'https://open.spotify.com/x': response(302, '/playlist/37i9dQZF1DXcBWIGoYBM5M'),
      [PLAYLIST_URL]: response(200),
    });

    expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({ ok: true, url: PLAYLIST_URL });
  });

  it('should follow up to the hop limit and then fail', async () => {
    // A cycle between two allow-listed hosts: every hop is individually legitimate, so only
    // the bound stops it. This is the loop guard, and it is why no visited-set is needed --
    // a chain can be infinite without ever repeating a URL.
    const a = 'https://spotify.link/a';
    const b = 'https://spotify.link/b';
    const { fetchImpl, calls } = fetchDouble({
      [a]: response(307, b),
      [b]: response(307, a),
    });

    expect(await resolveShortLink(a, fetchImpl)).toEqual({
      ok: false,
      code: 'upstream-unavailable',
    });
    // Bounded, and the bound is what the assertion is about: an unbounded walk would hang the
    // function until Vercel's timeout rather than fail.
    expect(calls.length).toBe(3);
  });

  it('should refuse a redirect to a non-Spotify host', async () => {
    // ===================================================================
    //  THE SSRF GUARD -- the most important test in this file.
    //
    //  A Vercel Function has unrestricted outbound network access, and the
    //  URL being followed came from a text box. Without the allow-list, a
    //  crafted chain aims the server at a metadata endpoint or an internal
    //  address and returns the result through our own trusted origin.
    //
    //  The assertion has two halves, and the second matters as much as the
    //  first: it must REFUSE, and it must never have made the request.
    // ===================================================================
    for (const target of [
      'https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/internal',
      'http://127.0.0.1/',
      // Look-alikes that a suffix or substring test would wave through.
      'https://open.spotify.com.evil.example/playlist/x',
      'https://notspotify.link/x',
      // The userinfo trick: the real host is evil.example.
      'https://open.spotify.com@evil.example/x',
      // Non-http schemes.
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      const { fetchImpl, calls } = fetchDouble({
        [SHORT_URL]: response(307, target),
        // Deliberately scripted as reachable: if the resolver followed it, it would SUCCEED,
        // so a passing test cannot be an accident of the double rejecting the request.
        [target]: response(200),
      });

      expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({
        ok: false,
        code: 'upstream-unavailable',
      });

      // Only the first, allow-listed hop was ever requested.
      expect(calls.map((call) => call.url)).toEqual([SHORT_URL]);
    }
  });

  it('should refuse a first URL that is not an allow-listed host', async () => {
    // The caller checks `isSpotifyShortLink()` first, so this is belt and braces -- but it is
    // what makes this function safe on its own terms rather than safe only because of what its
    // one caller happens to do today.
    const { fetchImpl, calls } = fetchDouble({
      'https://evil.example/x': response(200),
    });

    expect(await resolveShortLink('https://evil.example/x', fetchImpl)).toEqual({
      ok: false,
      code: 'upstream-unavailable',
    });
    expect(calls).toEqual([]);
  });

  it('should not follow redirects automatically', async () => {
    // `redirect: 'manual'` is what makes the allow-list enforceable at all: with automatic
    // following, `fetch` walks the chain itself and no intermediate host is ever checked.
    // Asserted on the `init` because there is no other observable difference.
    const { fetchImpl, calls } = fetchDouble({
      [SHORT_URL]: response(307, PLAYLIST_URL),
      [PLAYLIST_URL]: response(200),
    });

    await resolveShortLink(SHORT_URL, fetchImpl);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.init.redirect).toBe('manual');
    }
  });

  it('should send a descriptive User-Agent on every hop', async () => {
    // Short links are exactly the kind of service that behaves differently for an
    // unidentified client, and nothing here has been measured without one.
    const { fetchImpl, calls } = fetchDouble({
      [SHORT_URL]: response(307, PLAYLIST_URL),
      [PLAYLIST_URL]: response(200),
    });

    await resolveShortLink(SHORT_URL, fetchImpl);

    for (const call of calls) {
      expect(call.init.headers?.['User-Agent'] ?? '').toContain('Mozilla/5.0');
    }
  });

  it('should report upstream-unavailable when the fetch rejects', async () => {
    // A dead host, which is `link.tospotify.com`'s state as of 2026-08-05.
    const fetchImpl = vi.fn<RedirectFetchLike>(() => Promise.reject(new Error('ENOTFOUND')));

    expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({
      ok: false,
      code: 'upstream-unavailable',
    });
  });

  it('should report upstream-unavailable for a redirect with no Location', async () => {
    const { fetchImpl } = fetchDouble({ [SHORT_URL]: response(307) });

    expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({
      ok: false,
      code: 'upstream-unavailable',
    });
  });

  it('should return the URL it is holding for a 4xx at the end of the chain', async () => {
    // A dead short code, or a deleted playlist. Handing the resolved URL back lets
    // `parsePlaylistUrl()` and then the embed adapter give their own better-informed answer
    // (`unsupported-entity`, `not-found-or-private`) instead of collapsing into "unavailable".
    const { fetchImpl } = fetchDouble({
      [SHORT_URL]: response(307, PLAYLIST_URL),
      [PLAYLIST_URL]: response(404),
    });

    expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({ ok: true, url: PLAYLIST_URL });
  });

  it('should report upstream-unavailable for a 5xx at the end of the chain', async () => {
    // Transient, and distinguishable from the 4xx case above precisely because retrying may
    // work -- there is nothing useful to hand on.
    const { fetchImpl } = fetchDouble({
      [SHORT_URL]: response(307, PLAYLIST_URL),
      [PLAYLIST_URL]: response(503),
    });

    expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({
      ok: false,
      code: 'upstream-unavailable',
    });
  });

  it('should resolve to a non-playlist URL rather than judging it', async () => {
    // Decision 5: no new error code for "the short link pointed at an album". The resolver
    // returns the URL and `parsePlaylistUrl()` reports `unsupported-entity` from it, which is
    // why this function returns a URL rather than a playlist id.
    const albumUrl = 'https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M';
    const { fetchImpl } = fetchDouble({
      [SHORT_URL]: response(307, albumUrl),
      [albumUrl]: response(200),
    });

    expect(await resolveShortLink(SHORT_URL, fetchImpl)).toEqual({ ok: true, url: albumUrl });
  });

  it('should never throw for arbitrary input', async () => {
    const fetchImpl = vi.fn<RedirectFetchLike>(() => Promise.resolve(response(200)));

    for (const input of ['', '   ', 'not a url', 'https://', '://', 'spotify.link']) {
      await expect(resolveShortLink(input, fetchImpl)).resolves.toBeDefined();
    }
  });
});
