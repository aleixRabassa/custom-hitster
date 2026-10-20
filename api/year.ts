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
import { runStage } from './_lib/year-pipeline.js';
import type { ProviderRegistry } from './_lib/provider-lookup.js';
import type { YearErrorCode, YearErrorResult, YearStage } from '../shared/types.js';

/**
 * `GET /api/year?title=…&artist=…&durationMs=…[&stage=resolve|verify]`
 *
 * Resolves ONE track's original release year. Deliberately thin, like `api/playlist.ts`:
 * it guards the method, validates the query, delegates, and translates a typed error union
 * into HTTP. The one delegate is `runStage()` in `api/_lib/year-pipeline.ts`, which asks the
 * providers of `YEAR_PROVIDER_PLAN` and returns the vote (plan.year-fetch-rework-server.md).
 * `resolve` answers fast, possibly provisionally; `verify` asks the precision provider and is
 * final unless a provider failed.
 *
 * A request with NO `stage` is the pre-vote client's URL. It gets a 500 `not-configured` stub
 * (see `STAGE_REQUIRED_MESSAGE`), not an answer; sunset 2026-12-01.
 *
 * If logic starts accumulating here, it belongs in `year-pipeline.ts` or in `shared/`.
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

/** The codes this endpoint can return. It never answers `unexpected-payload`: see below. */
type StagedErrorCode = Exclude<YearErrorCode, 'unexpected-payload'>;

/**
 * Safe, short, hand-written text per code. Never raw upstream output, never the Upstash
 * token. `not-configured` is "EVERY provider is unconfigured" and `upstream-unavailable` is
 * "every provider that was asked failed". A single provider's `unexpected-payload` is folded into the second (the driver treats it as
 * one more failure), so it has no entry here.
 */
const STAGED_ERROR_MESSAGE: Record<StagedErrorCode, string> = {
  'invalid-request': 'A title and an artist are required, and stage must be resolve or verify.',
  'rate-limited': 'Too many year lookups at once. Retry shortly.',
  'not-configured': 'No year provider is configured on the server, so year lookups cannot run.',
  'upstream-unavailable': 'No year provider could be reached right now. Please try again.',
};

/**
 * The body of the stage-less stub. The pre-vote client (git 104c1e2) settles `not-configured`
 * by stopping lookups and playing a yearless deck, but settles `invalid-request` as a final
 * null and drops EVERY card -- hence a 500, never a 400. Sunset 2026-12-01: after that it may
 * become a 400 (decisions.md, "The stage-less /api/year path is gone").
 */
const STAGE_REQUIRED_MESSAGE =
  'This endpoint needs stage=resolve or stage=verify. Reload the app to update it.';

const STAGES: readonly YearStage[] = ['resolve', 'verify'];

/**
 * Guards against a query string being used as an amplification vector. MusicBrainz would
 * reject an absurd query anyway; rejecting here costs nothing and never spends a permit.
 */
const MAX_FIELD_LENGTH = 300;

/** One day: the longest stale window an answer is ever granted. */
const MAX_STALE_WHILE_REVALIDATE_SECONDS = 86_400;

/**
 * The `Cache-Control` of an answer. The max-age comes from `stagedEdgeMaxAgeSeconds()` --
 * bounded by the shortest TTL of the entries a final answer was built from, ~60 s for a
 * provisional one or a final reached with a provider skipped, and `0` for a provisional one
 * built on a provider that failed or was busy this call. `0` is sent as `no-store`, never as
 * `s-maxage=0`: the client retries that answer on the same URL within a second or two, and
 * nothing anywhere -- edge or browser -- may hand a retry the body it is retrying. The stale
 * window is never longer than the max-age, never longer than a day. Every value must stay
 * <= the matching TTL in `api/_lib/cache.ts` (`cache.test.ts` checks it).
 */
function stagedCacheControl(maxAgeSeconds: number): string {
  if (maxAgeSeconds <= 0) return 'no-store';
  const stale = Math.min(maxAgeSeconds, MAX_STALE_WHILE_REVALIDATE_SECONDS);
  return `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${stale}`;
}

/**
 * Built once per cold start, not per request, so a warm instance reuses the in-memory cache
 * rather than throwing it away on every invocation -- which would make it useless -- and so
 * the "which adapter did we pick" lines are logged once instead of on every call.
 *
 * ONE cache object backs all three providers: `resolveYear()` inside the MusicBrainz
 * provider writes the `mbyear:` entry the batched read looks for (see `api/_lib/cache.ts`).
 */
const cache = createCache();
const gate = createRateLimitGate();
const deezerGate = createRateLimitGate(process.env, fetch, PROVIDER_GATES.deezer);
const itunesGate = createRateLimitGate(process.env, fetch, PROVIDER_GATES.itunes);

/**
 * The User-Agent, read per request rather than at module scope so an unset variable is a
 * skipped provider on every call, instead of a throw during cold start where the only symptom
 * is FUNCTION_INVOCATION_FAILED.
 */
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

    // `undefined` means the parameter is ABSENT, answered by the stub below. Present but not
    // one of the two stages -- an empty `?stage=` included -- is a bad request.
    const rawStage = firstValue(req.query['stage']);
    const stage = STAGES.find((candidate) => candidate === rawStage);
    if (rawStage !== undefined && stage === undefined) {
      sendError(res, 'invalid-request', STAGED_ERROR_MESSAGE['invalid-request']);
      return;
    }
    // Explicit on purpose: a handler that fell off the `try` here would hang to the function
    // timeout instead of answering. Checked before the title and artist, so the stub is
    // answered whatever else the query carries.
    if (stage === undefined) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(ERROR_STATUS['not-configured']).json({
        code: 'not-configured',
        message: STAGE_REQUIRED_MESSAGE,
      } satisfies YearErrorResult);
      return;
    }

    const title = firstValue(req.query['title'])?.trim() ?? '';
    const artist = firstValue(req.query['artist'])?.trim() ?? '';

    if (title === '' || artist === '') {
      sendError(res, 'invalid-request', STAGED_ERROR_MESSAGE['invalid-request']);
      return;
    }
    if (title.length > MAX_FIELD_LENGTH || artist.length > MAX_FIELD_LENGTH) {
      sendError(res, 'invalid-request', STAGED_ERROR_MESSAGE['invalid-request']);
      return;
    }

    // Absent, zero or unparseable all mean "unknown", which disables the `dur:` bound rather
    // than failing the request -- the embed adapter itself defaults a missing duration to 0.
    const rawDuration = Number.parseInt(firstValue(req.query['durationMs']) ?? '', 10);
    const durationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;

    await handleStage(res, stage, { title, artist, durationMs });
  } catch {
    res.status(500).json({ code: 'internal-error', message: 'Something went wrong.' });
  }
}

/**
 * `runStage()` and its status mapping.
 *
 * | `runStage()`                         | HTTP                                             |
 * | ------------------------------------ | ------------------------------------------------ |
 * | `ok`, final, nothing skipped         | 200, `s-maxage` = shortest source TTL            |
 * | `ok`, final with a provider skipped  | 200, `s-maxage=60`                               |
 * | `ok`, provisional, nothing transient | 200, `s-maxage=60` (`resolve`'s hand-off)        |
 * | `ok`, provisional and `transient`    | 200, `no-store` (a provider failed or was busy)  |
 * | `rate-limited`                       | 429 + `retryAfterMs` + `Retry-After`             |
 * | `upstream-unavailable`               | 502 (every provider asked failed, none answered) |
 * | `not-configured`                     | 500 (every provider in the plan unconfigured)    |
 *
 * `resolve` answers `rate-limited` only when a provider was busy AND nothing answered; with
 * an answer in hand it is the `ok`-and-`transient` row, and that body carries the busy
 * provider's `retryAfterMs` -- in the BODY only, no `Retry-After` header on a 200 -- unless the
 * answer is final. `verify` answers it on any busy provider (`api/_lib/year-pipeline.ts` says
 * why the two differ). "Busy" means "try again shortly": OUR gate refused a permit, or the
 * provider said so itself (a Deezer or iTunes 429, Deezer's `SERVICE_BUSY` body). A provider's
 * "stop asking" (an iTunes 403, a Deezer quota body) is never a 429 here. It is a
 * skip, as an unconfigured provider is -- a 200 listing it in `skipped`, held `s-maxage=60`
 * whether final or not (a refusal alone is not `transient`, so it never makes the body
 * `no-store`) -- and never counts toward the 500.
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
    transient: outcome.transient,
    sourceTtlsSeconds: outcome.sourceTtlsSeconds,
  });
  res.setHeader('Cache-Control', stagedCacheControl(maxAge));
  res.status(200).json(outcome.result);
}
