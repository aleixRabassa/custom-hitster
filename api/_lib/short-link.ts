/**
 * Resolve a `spotify.link` short URL to the `open.spotify.com` URL it points at.
 *
 * ===========================================================================
 *  THIS IS THE FIRST PLACE IN THE REPO WHERE USER INPUT DECIDES AN OUTBOUND
 *  REQUEST TARGET, AND THAT IS WHY IT LOOKS SO PARANOID.
 *
 *  A Vercel Function has unrestricted outbound network access. "Follow the
 *  redirects on a URL the player pasted" is, stated plainly, server-side
 *  request forgery: without a check, a crafted chain could point the function
 *  at a cloud metadata endpoint, an internal address, or any third-party host,
 *  and the response would come back through our own trusted origin.
 *
 *  Three things close that, and all three are load-bearing:
 *
 *  1. `redirect: 'manual'` -- so the allow-list is consulted on EVERY hop.
 *     With automatic following, `fetch` walks the chain itself and the
 *     allow-list below never sees a single intermediate host.
 *  2. AN ALLOW-LIST, not a deny-list, matched on the exact host. Enumerating
 *     what is safe is the only direction that fails closed.
 *  3. A HARD HOP LIMIT, which also disposes of redirect loops without needing
 *     to track visited URLs.
 * ===========================================================================
 *
 * `fetch` is injected exactly as it is in `spotify-embed.ts` and `cache.ts`, for the same
 * reason: every branch below -- including the SSRF refusal, which is the most important
 * assertion in this file's tests -- becomes an offline unit test instead of a live redirect
 * chain nobody can reproduce.
 *
 * Lives under `api/_lib/`, which Vercel does not route (2026-08-04 finding), so this file is
 * not reachable as an endpoint. It cannot live in `shared/` either: it needs `fetch` and a
 * `User-Agent`, and `shared/` must stay free of both platforms' APIs.
 */

import type { PlaylistErrorCode } from '../../shared/types.js';

/**
 * The subset of `PlaylistErrorCode` this resolver can produce -- NO NEW CODES (decision 5).
 * Derived from the full union so the two cannot drift.
 *
 * There is a deliberate asymmetry between the two:
 *
 * - A dead host, a refused hop, a hop limit hit, or a missing `Location` are all
 *   `upstream-unavailable`. From the player's side they are one thing -- "that link could not
 *   be followed" -- and inventing a code per cause would put five new entries in the client's
 *   message map to say the same sentence five ways.
 * - A short link that resolves to a TRACK or an ALBUM needs no code here at all: the resolved
 *   URL goes back through `parsePlaylistUrl()` and comes out as `unsupported-entity` naturally.
 *   That is the whole reason this returns a URL rather than a playlist ID.
 */
export type ShortLinkErrorCode = Extract<PlaylistErrorCode, 'upstream-unavailable'>;

export type ShortLinkResult = { ok: true; url: string } | { ok: false; code: ShortLinkErrorCode };

/** The minimum of `Response` this resolver touches. The global `fetch` satisfies it. */
export interface RedirectResponseLike {
  status: number;
  headers: { get(name: string): string | null };
}

/** The minimum of `fetch` this resolver needs. Structural, so a test double stays a one-liner. */
export type RedirectFetchLike = (
  url: string,
  init: { redirect: 'manual'; headers?: Record<string, string> },
) => Promise<RedirectResponseLike>;

/**
 * Hosts a redirect may point at, matched EXACTLY -- no subdomain wildcard, no suffix test.
 *
 * `spotify.link` and `link.tospotify.com` are here because a chain can begin at one and pass
 * through the other; `open.spotify.com` is where a real chain ends. `www.spotify.com` and
 * `spotify.com` are included because a short link to something we do not handle sometimes
 * lands on the marketing site, and it is better to follow that to its end and let
 * `parsePlaylistUrl()` reject it clearly than to report the follow itself as a failure.
 *
 * Adding a host here widens what the server can be pointed at. Do not add one for
 * convenience.
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'spotify.link',
  'link.tospotify.com',
  'open.spotify.com',
  'www.open.spotify.com',
  'spotify.com',
  'www.spotify.com',
]);

/**
 * How many redirects to follow. Three is ample: a real `spotify.link` chain measured on
 * 2026-08-05 was a single 307 straight to `open.spotify.com`.
 *
 * This is also the loop guard. A chain that cycles simply runs out of hops, so there is no
 * visited-set to keep -- and a bounded walk is a stronger guarantee than a set anyway, since
 * a chain can be infinite without ever repeating a URL.
 */
const MAX_HOPS = 3;

/** Only these mean "look at `Location`". Anything else ends the walk. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * The same descriptive agent `spotify-embed.ts` sends, for the same reason: nothing here has
 * been measured against an absent or default `User-Agent`, and a link shortener is exactly the
 * kind of service that behaves differently for an unidentified client.
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Follow `shortUrl` until it stops redirecting, and return where it landed.
 *
 * Returns the RESOLVED URL, not a playlist ID: the caller feeds it straight back through
 * `parsePlaylistUrl()`, which is what makes "the short link pointed at an album" report
 * `unsupported-entity` with no extra code and no extra branch.
 *
 * Never throws -- a discriminated result, matching every other adapter in `api/_lib/`.
 */
export async function resolveShortLink(
  shortUrl: string,
  fetchImpl: RedirectFetchLike,
): Promise<ShortLinkResult> {
  // The FIRST hop is checked against the allow-list too, not just the redirect targets. The
  // caller checks `isSpotifyShortLink()` before getting here, so this is belt and braces --
  // but it is the belt that makes this function safe on its own terms rather than safe only
  // because of what its one caller happens to do.
  let current = normalize(shortUrl);
  if (!current) return { ok: false, code: 'upstream-unavailable' };

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let response: RedirectResponseLike;

    try {
      response = await fetchImpl(current, {
        // NOT negotiable. See the header block: automatic following would walk the chain
        // inside `fetch` and the allow-list would never be consulted.
        redirect: 'manual',
        headers: { 'User-Agent': BROWSER_USER_AGENT },
      });
    } catch {
      // DNS failure, socket reset, timeout. `link.tospotify.com` lands here today -- the host
      // stopped resolving -- and "Spotify could not be reached" is the honest thing to say
      // about a link whose shortener is gone.
      return { ok: false, code: 'upstream-unavailable' };
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      // The end of the chain. A 200 means the short link itself served the page; anything else
      // (404 on a dead code, 5xx) is not something we can turn into a playlist, but the URL we
      // have is still the best answer available -- `parsePlaylistUrl()` will reject it if it
      // is not a playlist link, which is exactly the right division of labour.
      return response.status === 200 ? { ok: true, url: current } : okOrUpstream(current, response);
    }

    const location = response.headers.get('Location');
    // A redirect status with no target. Nothing to follow.
    if (!location) return { ok: false, code: 'upstream-unavailable' };

    const next = normalize(resolveAgainst(location, current));
    // The allow-list refusal. `normalize` returns undefined for a disallowed host, an
    // unparseable target, and a non-http(s) scheme alike -- `javascript:`, `file:` and
    // `data:` are all rejected here, and so is any host not in `ALLOWED_HOSTS`.
    if (!next) return { ok: false, code: 'upstream-unavailable' };

    current = next;
  }

  // Out of hops: either a genuinely long chain or a loop.
  return { ok: false, code: 'upstream-unavailable' };
}

/**
 * A non-redirect, non-200 status at the end of the chain.
 *
 * Split out only so the branch above reads as one line. A 3xx already went to `Location`, so
 * anything here is a dead end -- but if the URL we are holding is already an
 * `open.spotify.com` link, handing it back lets `parsePlaylistUrl()` and then the embed
 * adapter produce their own, better-informed answer (`not-found-or-private` for a deleted
 * playlist) instead of collapsing everything into "unavailable".
 */
function okOrUpstream(url: string, response: RedirectResponseLike): ShortLinkResult {
  if (response.status >= 400 && response.status < 500) return { ok: true, url };

  return { ok: false, code: 'upstream-unavailable' };
}

/**
 * Parse a URL, require http(s), and require an allow-listed host. `undefined` means "refuse".
 *
 * One function for all three checks on purpose: every place a URL enters this walk has to pass
 * all three, and separating them is how one call site ends up missing one.
 *
 * `URL` is used freely here -- this is `api/`, which is Node. `shared/spotify-url.ts` avoids it
 * deliberately, for portability it does not need.
 */
function normalize(candidate: string): string | undefined {
  let url: URL;
  try {
    url = new URL(
      candidate.trim().startsWith('http') ? candidate.trim() : `https://${candidate.trim()}`,
    );
  } catch {
    return undefined;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  // `URL.hostname` excludes the port and the userinfo, which is what makes this comparison
  // safe: `https://spotify.link@evil.example/x` has hostname `evil.example`, so the userinfo
  // trick that fools a string test fails here.
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return undefined;

  return url.toString();
}

/**
 * Resolve a `Location` value, which may be relative, against the URL it came from.
 *
 * Relative redirects are legal and real (`Location: /playlist/abc`). Treating one as absolute
 * would produce a garbage URL that then fails the allow-list -- a confusing failure for a
 * perfectly ordinary response.
 */
function resolveAgainst(location: string, base: string): string {
  try {
    return new URL(location, base).toString();
  } catch {
    // Unparseable even relative to a valid base. `normalize` will refuse it.
    return location;
  }
}
