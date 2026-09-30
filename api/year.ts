import type { VercelRequest, VercelResponse } from '@vercel/node';

// Relative imports with an explicit `.js` extension -- both halves are load-bearing. The
// `@/` alias does not work in Vercel functions (no tsconfig path mappings), and an
// extensionless specifier fails at RUNTIME under `"type": "module"`, after a build that
// logs nothing. See AGENTS.md and docs/agent_findings.md (2026-08-04).
import { createCache, stagedEdgeMaxAgeSeconds, withAnswerCache } from './_lib/cache.js';
import { createDeezerLookup } from './_lib/deezer.js';
import { createItunesLookup } from './_lib/itunes.js';
import { createMusicBrainzLookup } from './_lib/musicbrainz-provider.js';
import { PROVIDER_GATES, createRateLimitGate } from './_lib/rate-limit.js';
import { resolveYear } from './_lib/resolve-year.js';
import { runStage } from './_lib/year-pipeline.js';
import type { ProviderRegistry } from './_lib/provider-lookup.js';
import type {
  MusicBrainzLookupResult,
  YearErrorCode,
  YearErrorResult,
  YearStage,
} from '../shared/types.js';

/**
 * `GET /api/year?title=…&artist=…&durationMs=…[&stage=resolve|verify]`
 *
 * Resolves ONE track's original release year. Deliberately thin, like `api/playlist.ts`:
 * it guards the method, validates the query, delegates, and translates a typed error union
 * into HTTP. Two delegates, one per path:
 *
 * - **No `stage`**: `resolveYear()`, MusicBrainz alone, exactly as before the provider vote.
 *   All the ordering that matters there -- cache before gate, the tier ladder, negatives
 *   cached too -- lives in `api/_lib/resolve-year.ts`, where it is unit-tested.
 * - **`stage=resolve` or `stage=verify`**: `runStage()` in `api/_lib/year-pipeline.ts`, which
 *   asks the three providers of `YEAR_PROVIDER_PLAN` and returns the vote
 *   (plan.year-fetch-rework-server.md). `resolve` answers fast, possibly provisionally;
 *   `verify` asks the precision provider and is final unless a provider failed.
 *
 * If logic starts accumulating here, it belongs in one of those two modules or in `shared/`.
 *
 * ONE TRACK PER REQUEST, not a batch (decision 4). The client sequences the calls itself.
 * That keeps this endpoint trivial, makes every response individually edge-cacheable, needs
 * no job store, and fits Phase 3's progressive fill: card 1 resolves first and play can
 * begin. Its cost is that the server sees isolated invocations, so pacing has to be
 * out-of-process -- which is what `api/_lib/rate-limit.ts` is for.
 *
 * ONE ENDPOINT WITH A `stage` PARAMETER, not two handlers: a second function would be a
 * second cold start on the card that needs both. `verify` reads `resolve`'s answers from the
 * shared cache, never from the client, so no client can put a year into the cache.
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

/**
 * Safe, short, hand-written text per code, for the STAGE-LESS legacy path. Never raw upstream
 * output, never the Upstash token. Unchanged byte for byte: that path is MusicBrainz alone,
 * so "MusicBrainz" is still the accurate word in it.
 */
const ERROR_MESSAGE: Record<YearErrorCode, string> = {
  'invalid-request': 'A title and an artist are required.',
  'rate-limited': 'Too many year lookups at once. Retry shortly.',
  'not-configured': 'MUSICBRAINZ_USER_AGENT is not set on the server, so year lookups cannot run.',
  'upstream-unavailable': 'MusicBrainz could not be reached right now. Please try again.',
  'unexpected-payload': 'MusicBrainz returned something unexpected. This is a bug on our side.',
};

/** The codes the staged path can return. It never answers `unexpected-payload`: see below. */
type StagedErrorCode = Exclude<YearErrorCode, 'unexpected-payload'>;

/**
 * The same, for `?stage=`. Separate because three of the legacy sentences name MusicBrainz,
 * and on this path the code means something wider: `not-configured` is "EVERY provider is
 * unconfigured" and `upstream-unavailable` is "every provider that was asked failed". A
 * single provider's `unexpected-payload` is folded into the second (the driver treats it as
 * one more failure), so it has no entry here.
 */
const STAGED_ERROR_MESSAGE: Record<StagedErrorCode, string> = {
  'invalid-request': 'A title and an artist are required, and stage must be resolve or verify.',
  'rate-limited': 'Too many year lookups at once. Retry shortly.',
  'not-configured': 'No year provider is configured on the server, so year lookups cannot run.',
  'upstream-unavailable': 'No year provider could be reached right now. Please try again.',
};

const STAGES: readonly YearStage[] = ['resolve', 'verify'];

/**
 * Guards against a query string being used as an amplification vector. MusicBrainz would
 * reject an absurd query anyway; rejecting here costs nothing and never spends a permit.
 */
const MAX_FIELD_LENGTH = 300;

/**
 * Edge caching for the STAGE-LESS path, tiered by how likely the answer is to change.
 *
 * A `high`-confidence year is a historical fact, so the edge can hold it for a long time and
 * absorb repeat requests ahead of both Redis and MusicBrainz. A `none` result is the one
 * most likely to improve as MusicBrainz's data does, so it gets a short window. `low` sits
 * between: correct often enough to cache, wrong often enough not to pin for a month.
 *
 * **Every value here must be <= the matching TTL in `api/_lib/cache.ts`.** An edge miss is
 * free -- it falls through to Redis -- while a Redis miss costs two requests against a
 * 1 req/s budget shared by every user, so Redis must never be the one to expire first.
 * `should never let the edge outlive the entries an answer was built from` in
 * `cache.test.ts` checks these values against the Redis TTLs. The staged path does not use
 * this table: its rule is `stagedEdgeMaxAgeSeconds()`, per answer.
 */
const CACHE_CONTROL: Record<'high' | 'low' | 'none', string> = {
  high: 'public, s-maxage=2592000, stale-while-revalidate=86400',
  low: 'public, s-maxage=86400, stale-while-revalidate=86400',
  none: 'public, s-maxage=3600, stale-while-revalidate=3600',
};

/** One day: the longest stale window the legacy table ever grants, kept as the staged cap. */
const MAX_STALE_WHILE_REVALIDATE_SECONDS = 86_400;

/**
 * The staged path's `Cache-Control`. The max-age comes from `stagedEdgeMaxAgeSeconds()` --
 * bounded by the shortest TTL of the entries a final answer was built from, ~60 s for a
 * provisional one or a final reached with a provider skipped. The stale window mirrors the
 * legacy table's shape: never longer than the max-age, never longer than a day.
 */
function stagedCacheControl(maxAgeSeconds: number): string {
  const stale = Math.min(maxAgeSeconds, MAX_STALE_WHILE_REVALIDATE_SECONDS);
  return `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${stale}`;
}

/**
 * Built once per cold start, not per request, so a warm instance reuses the in-memory cache
 * rather than throwing it away on every invocation -- which would make it useless -- and so
 * the "which adapter did we pick" lines are logged once instead of on every call.
 *
 * ONE cache object backs both paths and all three providers: `resolveYear()` writes the
 * `mbyear:` entry the staged path's batched read looks for (see `api/_lib/cache.ts`).
 * MusicBrainz's gate is likewise ONE object shared by both paths, because MusicBrainz counts
 * our requests, not our endpoints.
 */
const cache = createCache();
const gate = createRateLimitGate();
const deezerGate = createRateLimitGate(process.env, fetch, PROVIDER_GATES.deezer);
const itunesGate = createRateLimitGate(process.env, fetch, PROVIDER_GATES.itunes);

/** The User-Agent, read per request -- see the legacy call below for why. */
const readUserAgent = (): string => process.env['MUSICBRAINZ_USER_AGENT'] ?? '';

/**
 * The provider registry. A `Record<YearProviderId, ProviderLookup>`, so a plan step naming a
 * provider with no adapter here is a COMPILE error rather than a runtime `undefined` on the
 * first cold card (plan step 5).
 *
 * The two STORES are wrapped in the per-provider answer cache; MusicBrainz is not, because
 * `resolveYear()` inside it owns the `mbyear:` entry. Each provider paces through its OWN gate.
 * Neither store needs a key, so neither can be `not-configured`; MusicBrainz is, when
 * `MUSICBRAINZ_USER_AGENT` is unset, and is then skipped with a warning.
 */
const registry: ProviderRegistry = {
  deezer: withAnswerCache(createDeezerLookup({ fetchImpl: fetch, gate: deezerGate }), cache),
  musicbrainz: createMusicBrainzLookup({ cache, gate, fetchImpl: fetch, readUserAgent }),
  itunes: withAnswerCache(createItunesLookup({ fetchImpl: fetch, gate: itunesGate }), cache),
};

function sendError(
  res: VercelResponse,
  code: YearErrorCode,
  message: string,
  retryAfterMs?: number,
): void {
  const body: YearErrorResult = { code, message };

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

    // `undefined` means the parameter is ABSENT, which selects the legacy path. Present but
    // not one of the two stages -- an empty `?stage=` included -- is a bad request, never a
    // silent fall back to the legacy path, which answers a different body.
    const rawStage = firstValue(req.query['stage']);
    const stage = STAGES.find((candidate) => candidate === rawStage);
    if (rawStage !== undefined && stage === undefined) {
      sendError(res, 'invalid-request', STAGED_ERROR_MESSAGE['invalid-request']);
      return;
    }
    const invalidRequestMessage =
      stage === undefined
        ? ERROR_MESSAGE['invalid-request']
        : STAGED_ERROR_MESSAGE['invalid-request'];

    const title = firstValue(req.query['title'])?.trim() ?? '';
    const artist = firstValue(req.query['artist'])?.trim() ?? '';

    if (title === '' || artist === '') {
      sendError(res, 'invalid-request', invalidRequestMessage);
      return;
    }
    if (title.length > MAX_FIELD_LENGTH || artist.length > MAX_FIELD_LENGTH) {
      sendError(res, 'invalid-request', invalidRequestMessage);
      return;
    }

    // Absent, zero or unparseable all mean "unknown", which disables the `dur:` bound rather
    // than failing the request -- the embed adapter itself defaults a missing duration to 0.
    const rawDuration = Number.parseInt(firstValue(req.query['durationMs']) ?? '', 10);
    const durationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;

    if (stage !== undefined) {
      await handleStage(res, stage, { title, artist, durationMs });
      return;
    }

    // ---- The stage-less LEGACY path: MusicBrainz alone, byte for byte ------------------
    // Kept for tabs still running the client from before the provider vote: the service
    // worker WAITS rather than calling `skipWaiting` (see `vite.config.ts`), so such a tab
    // lives until every tab of the app is closed, and it keeps calling this URL with no
    // `stage`. That client drops any card that comes back `null` and has never read `final`,
    // so it must keep getting exactly the body, headers and 30-day edge cache it always got.
    //
    // THIS PATH STILL ANSWERS THE LOUD `not-configured` 500 ON A MISSING
    // `MUSICBRAINZ_USER_AGENT`, ON PURPOSE, while the staged path skips MusicBrainz with a
    // warning. Both follow the same rule -- only "every provider skipped" is loud -- and this
    // path HAS only one provider, so skipping it is every provider skipped. Do not "fix" one
    // path to match the other.
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
        userAgent: readUserAgent(),
      },
    );

    if (!outcome.ok) {
      sendError(res, outcome.code, ERROR_MESSAGE[outcome.code], outcome.retryAfterMs);
      return;
    }

    // Built field by field rather than spread, so an added internal field can never leak.
    const body: MusicBrainzLookupResult = {
      year: outcome.result.year,
      confidence: outcome.result.confidence,
      cached: outcome.result.cached,
      cleanedTitle: outcome.result.cleanedTitle,
      stripped: outcome.result.stripped,
    };
    if (outcome.result.source !== undefined) body.source = outcome.result.source;
    if (outcome.result.reason !== undefined) body.reason = outcome.result.reason;
    // Set only when a fallback query against a rewritten title found the year -- today, a
    // dropped remix suffix. Always accompanied by `confidence: 'low'`.
    if (outcome.result.viaTitle !== undefined) body.viaTitle = outcome.result.viaTitle;

    res.setHeader('Cache-Control', CACHE_CONTROL[body.confidence]);
    res.status(200).json(body);
  } catch {
    res.status(500).json({ code: 'internal-error', message: 'Something went wrong.' });
  }
}

/**
 * The staged path: `runStage()` and its status mapping.
 *
 * | `runStage()`             | HTTP                                           |
 * | ------------------------ | ---------------------------------------------- |
 * | `ok`                     | 200, `Cache-Control` per `stagedCacheControl`  |
 * | `rate-limited`           | 429 + `retryAfterMs` + `Retry-After`           |
 * | `upstream-unavailable`   | 502 (every provider asked failed, none answered) |
 * | `not-configured`         | 500 (every provider in the plan unconfigured)  |
 *
 * The body is built by the driver field by field; nothing is added or spread here.
 */
async function handleStage(
  res: VercelResponse,
  stage: YearStage,
  input: { title: string; artist: string; durationMs: number | undefined },
): Promise<void> {
  const outcome = await runStage(
    stage,
    {
      title: input.title,
      artist: input.artist,
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    },
    registry,
    cache,
  );

  if (!outcome.ok) {
    const retryAfterMs = outcome.code === 'rate-limited' ? outcome.retryAfterMs : undefined;
    sendError(res, outcome.code, STAGED_ERROR_MESSAGE[outcome.code], retryAfterMs);
    return;
  }

  const maxAge = stagedEdgeMaxAgeSeconds({
    final: outcome.result.final,
    skipped: outcome.result.skipped !== undefined,
    sourceTtlsSeconds: outcome.sourceTtlsSeconds,
  });
  res.setHeader('Cache-Control', stagedCacheControl(maxAge));
  res.status(200).json(outcome.result);
}
