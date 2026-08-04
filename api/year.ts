import type { VercelRequest, VercelResponse } from '@vercel/node';

// Relative imports with an explicit `.js` extension -- both halves are load-bearing. The
// `@/` alias does not work in Vercel functions (no tsconfig path mappings), and an
// extensionless specifier fails at RUNTIME under `"type": "module"`, after a build that
// logs nothing. See AGENTS.md and docs/agent_findings.md (2026-08-04).
import { createCache } from './_lib/cache.js';
import { createRateLimitGate } from './_lib/rate-limit.js';
import { resolveYear } from './_lib/resolve-year.js';
import type { YearErrorCode, YearErrorResult, YearLookupResult } from '../shared/types.js';

/**
 * `GET /api/year?title=…&artist=…&durationMs=…`
 *
 * Resolves ONE track's original release year. Deliberately thin, like `api/playlist.ts`:
 * it guards the method, validates the query, delegates to `resolveYear()`, and translates a
 * typed error union into HTTP. All the ordering that matters -- cache before gate, strict
 * before relaxed, negatives cached too -- lives in `api/_lib/resolve-year.ts`, where it is
 * unit-tested. If logic starts accumulating here, it belongs there or in `shared/year.ts`.
 *
 * ONE TRACK PER REQUEST, not a batch (decision 4). The client sequences the calls itself.
 * That keeps this endpoint trivial, makes every response individually edge-cacheable, needs
 * no job store, and fits Phase 3's progressive fill: card 1 resolves first and play can
 * begin. Its cost is that the server sees isolated invocations, so pacing has to be
 * out-of-process -- which is what `api/_lib/rate-limit.ts` is for.
 */

/** Maps each typed failure to its status. The codes' own docs in `shared/types.ts` mirror this table. */
const ERROR_STATUS: Record<YearErrorCode, number> = {
  'invalid-request': 400,
  // Back-pressure, not an error: Phase 3 backs off and retries this card later.
  'rate-limited': 429,
  // A deployment fault, not a bad request -- hence 500 rather than 400.
  'not-configured': 500,
  'upstream-unavailable': 502,
  'unexpected-payload': 502,
};

/** Safe, short, hand-written text per code. Never raw upstream output, never the Upstash token. */
const ERROR_MESSAGE: Record<YearErrorCode, string> = {
  'invalid-request': 'A title and an artist are required.',
  'rate-limited': 'Too many year lookups at once. Retry shortly.',
  'not-configured': 'MUSICBRAINZ_USER_AGENT is not set on the server, so year lookups cannot run.',
  'upstream-unavailable': 'MusicBrainz could not be reached right now. Please try again.',
  'unexpected-payload': 'MusicBrainz returned something unexpected. This is a bug on our side.',
};

/**
 * Guards against a query string being used as an amplification vector. MusicBrainz would
 * reject an absurd query anyway; rejecting here costs nothing and never spends a permit.
 */
const MAX_FIELD_LENGTH = 300;

/**
 * Edge caching, tiered by how likely the answer is to change.
 *
 * A `high`-confidence year is a historical fact, so the edge can hold it for a long time and
 * absorb repeat requests ahead of both Redis and MusicBrainz. A `none` result is the one
 * most likely to improve as MusicBrainz's data does, so it gets a short window. `low` sits
 * between: correct often enough to cache, wrong often enough not to pin for a month.
 *
 * **Every value here must be <= the matching TTL in `api/_lib/cache.ts`.** An edge miss is
 * free -- it falls through to Redis -- while a Redis miss costs two requests against a
 * 1 req/s budget shared by every user, so Redis must never be the one to expire first.
 * `should never expire before the edge does, for any tier` in `cache.test.ts` mirrors this
 * table and fails if the two drift apart.
 */
const CACHE_CONTROL: Record<'high' | 'low' | 'none', string> = {
  high: 'public, s-maxage=2592000, stale-while-revalidate=86400',
  low: 'public, s-maxage=86400, stale-while-revalidate=86400',
  none: 'public, s-maxage=3600, stale-while-revalidate=3600',
};

/**
 * Built once per cold start, not per request, so a warm instance reuses the in-memory cache
 * rather than throwing it away on every invocation -- which would make it useless -- and so
 * the "which adapter did we pick" line is logged once instead of on every call.
 */
const cache = createCache();
const gate = createRateLimitGate();

function sendError(res: VercelResponse, code: YearErrorCode, retryAfterMs?: number): void {
  const body: YearErrorResult = { code, message: ERROR_MESSAGE[code] };

  if (retryAfterMs !== undefined) {
    body.retryAfterMs = retryAfterMs;
    // The standard header alongside the machine-readable field, so a plain HTTP client
    // behaves sensibly without knowing our body shape. Seconds, and at least 1.
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  }

  res.status(ERROR_STATUS[code]).json(body);
}

/** Vercel query values are `string | string[]` -- a repeated `?title=` yields an array. */
function firstValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Wrapped whole: an unexpected throw becomes a generic 500, never a stack trace -- which
  // could otherwise quote an upstream payload or the Upstash token.
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ code: 'method-not-allowed', message: 'Use GET.' });
      return;
    }

    const title = firstValue(req.query['title'])?.trim() ?? '';
    const artist = firstValue(req.query['artist'])?.trim() ?? '';

    if (title === '' || artist === '') {
      sendError(res, 'invalid-request');
      return;
    }
    if (title.length > MAX_FIELD_LENGTH || artist.length > MAX_FIELD_LENGTH) {
      sendError(res, 'invalid-request');
      return;
    }

    // Absent, zero or unparseable all mean "unknown", which disables the `dur:` bound rather
    // than failing the request -- the embed adapter itself defaults a missing duration to 0.
    const rawDuration = Number.parseInt(firstValue(req.query['durationMs']) ?? '', 10);
    const durationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;

    const outcome = await resolveYear(
      { title, artist, durationMs },
      {
        cache,
        gate,
        // The real global `fetch`; injected so the adapter's tests run offline.
        fetchImpl: fetch,
        // Read per request rather than at module scope so an unset variable is reported as a
        // clean 500 on every call, instead of throwing during cold start where the only
        // symptom is FUNCTION_INVOCATION_FAILED.
        userAgent: process.env['MUSICBRAINZ_USER_AGENT'] ?? '',
      },
    );

    if (!outcome.ok) {
      sendError(res, outcome.code, outcome.retryAfterMs);
      return;
    }

    // Built field by field rather than spread, so an added internal field can never leak.
    const body: YearLookupResult = {
      year: outcome.result.year,
      confidence: outcome.result.confidence,
      cached: outcome.result.cached,
      cleanedTitle: outcome.result.cleanedTitle,
      stripped: outcome.result.stripped,
    };
    if (outcome.result.source !== undefined) body.source = outcome.result.source;
    if (outcome.result.reason !== undefined) body.reason = outcome.result.reason;

    res.setHeader('Cache-Control', CACHE_CONTROL[body.confidence]);
    res.status(200).json(body);
  } catch {
    res.status(500).json({ code: 'internal-error', message: 'Something went wrong.' });
  }
}
