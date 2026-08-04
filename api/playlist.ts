import type { VercelRequest, VercelResponse } from '@vercel/node';

// Relative imports with an explicit `.js` extension -- both halves are load-bearing.
// The `@/` alias does not work in Vercel functions (no tsconfig path mappings), and an
// extensionless specifier fails at RUNTIME under `"type": "module"`, after a build that
// logs nothing. Both were learned from real deploys; see AGENTS.md and
// docs/agent_findings.md (2026-08-04) before "tidying" either.
import { fetchPlaylistFromEmbed } from './_lib/spotify-embed.js';
import { parsePlaylistUrl } from '../shared/spotify-url.js';
import type { PlaylistErrorCode, PlaylistErrorResult, PlaylistResult } from '../shared/types.js';

/**
 * `GET /api/playlist?url=…`
 *
 * Turns a pasted Spotify playlist link into a normalized deck. Deliberately thin: it
 * validates the request, delegates to `parsePlaylistUrl()` and the embed adapter, and
 * translates their typed error union into HTTP. It contains no parsing and no
 * extraction, which is why it has no unit tests of its own -- if logic accumulates here,
 * it belongs in `shared/` or the adapter instead.
 *
 * A GET with a query parameter rather than a POST with a body: cacheable at Vercel's
 * edge, reproducible with `curl`, and readable in the network tab. No payload is large
 * enough to need a body.
 */

/** Maps each typed failure to its status. The codes' own docs in `shared/types.ts` mirror this table. */
const ERROR_STATUS: Record<PlaylistErrorCode, number> = {
  'invalid-url': 400,
  'unsupported-entity': 400,
  'not-found-or-private': 404,
  // Transient: the embed endpoint failed or answered non-200.
  'upstream-unavailable': 502,
  // Not transient: the request worked but the payload was not the shape we parse, i.e.
  // the scrape broke and the adapter needs updating. Same status, different meaning --
  // which is exactly why the two codes stay distinct in the body.
  'unexpected-payload': 502,
};

/**
 * Safe, short, human-readable text per code. Deliberately hand-written: the response must
 * never carry the raw upstream HTML or a parse error, both because they are unbounded and
 * because the embed payload contains an anonymous Spotify bearer token (Phase 0 found one
 * at `state.settings.session.accessToken`) that must not be forwarded to the client.
 */
const ERROR_MESSAGE: Record<PlaylistErrorCode, string> = {
  'invalid-url': 'That does not look like a Spotify playlist link.',
  'unsupported-entity': 'That is a Spotify link, but not to a playlist.',
  'not-found-or-private':
    'No public playlist was found for that link. It may be private or deleted.',
  'upstream-unavailable': 'Spotify could not be reached right now. Please try again.',
  'unexpected-payload': 'Spotify returned something unexpected. This is a bug on our side.',
};

/**
 * Short edge-cache window. This is the "playlist snapshot cache" from `plan.md` §3, done
 * with a response header instead of Redis -- which keeps this endpoint free of any
 * dependency on the year plan's cache layer.
 *
 * Kept SHORT on purpose: a playlist's contents change, and Phase 6's suggested editorial
 * playlists are refreshed on Spotify's own schedule, so a long window would serve a deck
 * that no longer matches the link. `stale-while-revalidate` makes a repeated Start feel
 * instant without extending how stale a deck can actually be.
 */
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';

function sendError(res: VercelResponse, code: PlaylistErrorCode): void {
  const body: PlaylistErrorResult = { code, message: ERROR_MESSAGE[code] };
  res.status(ERROR_STATUS[code]).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Wrapped whole: an unexpected throw becomes a generic 500, never a stack trace. A
  // stack trace here could quote the upstream payload, token and all.
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ code: 'method-not-allowed', message: 'Use GET.' });
      return;
    }

    // Vercel's query values are `string | string[]` -- a repeated `?url=` yields an
    // array, so this cannot just be read as a string.
    const rawUrl = req.query['url'];
    const url = typeof rawUrl === 'string' ? rawUrl : Array.isArray(rawUrl) ? rawUrl[0] : undefined;
    if (typeof url !== 'string' || url.trim() === '') {
      sendError(res, 'invalid-url');
      return;
    }

    const parsed = parsePlaylistUrl(url);
    if (!parsed.ok) {
      sendError(res, parsed.code);
      return;
    }

    // The real global `fetch`; the adapter takes it as a parameter so its tests can run
    // offline against fixtures.
    const result = await fetchPlaylistFromEmbed(parsed.id, fetch);
    if (!result.ok) {
      sendError(res, result.code);
      return;
    }

    // Built field by field rather than spread from `result`, so an added internal field
    // in the adapter can never leak into the response by accident.
    const body: PlaylistResult = {
      playlist: result.playlist,
      cards: result.cards,
      truncated: result.truncated,
      skippedCount: result.skippedCount,
    };

    res.setHeader('Cache-Control', CACHE_CONTROL);
    res.status(200).json(body);
  } catch {
    res.status(500).json({ code: 'internal-error', message: 'Something went wrong.' });
  }
}
