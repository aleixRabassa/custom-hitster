/**
 * The year cache -- one store, two typed views, two adapters chosen at runtime.
 *
 * Upstash Redis in production, an in-memory map locally. That split is what keeps this
 * repo credential-free for a new contributor: `pnpm test` and `vercel dev` both work with
 * no Upstash account, and production switches over the moment the variables appear.
 *
 * BINDING, not decision, in the house split: nothing here decides a year. It stores what
 * `resolveYear()` and the store adapters produced, and validates it on the way back out.
 *
 * TWO VIEWS OVER ONE STORE (plan.year-fetch-rework-server.md step 9):
 *
 * - `YearCache`, unchanged: the MusicBrainz `YearResult` under `mbyear:<version>:…`, read and
 *   written by `resolveYear()` exactly as before.
 * - `ProviderAnswerCache`, new: one `ProviderAnswer` per store provider under
 *   `yearprov:<provider>:v1:…`, plus a batched read that fetches those keys AND the
 *   `mbyear:` key in ONE command, so a warm card costs one Redis round trip.
 *
 * ===========================================================================
 *  ONE OBJECT MUST BACK BOTH VIEWS. THIS IS THE LOAD-BEARING PART.
 *
 *  The batched read exists to see the `mbyear:` entry `resolveYear()` wrote.
 *  Two stores -- a second `Map` beside the first, say -- would type-check, pass
 *  every test that uses one view at a time, and make every warm card in memory
 *  mode re-ask MusicBrainz, because the batched read would be looking in a map
 *  nobody writes `mbyear:` into. So each adapter below is ONE object that
 *  implements both interfaces over ONE store, and `createCache()` returns it.
 * ===========================================================================
 *
 * `fetch` is injected into the Upstash adapter so its tests run offline, matching
 * `api/_lib/spotify-embed.ts`.
 */

import { isPlausibleYear } from '../../shared/year.js';
import { providerCacheKey } from '../../shared/year-providers.js';
import type { ProviderLookup, ProviderLookupInput } from './provider-lookup.js';
import type { ProviderAnswer, YearProviderId, YearResult } from '../../shared/types.js';

/**
 * Read and write the MusicBrainz year, and deliberately nothing else.
 *
 * No `delete`, no `has`. Every method here has a caller in `resolveYear()`. The batched read
 * the old comment here said to wait for now exists -- but on `ProviderAnswerCache`, which
 * needed it, rather than here, which still does not.
 */
export interface YearCache {
  /** The stored result, or `undefined` for a miss. Never throws -- see the note on failures. */
  get(key: string): Promise<YearResult | undefined>;
  /** Store with an expiry, in seconds. Never throws. */
  set(key: string, value: YearResult, ttlSeconds: number): Promise<void>;
  /** Which adapter this is, for the cold-start log line. */
  readonly kind: 'memory' | 'upstash';
}

/** One provider-answer slot of a batched read: which key, and which provider it must hold. */
export interface AnswerRead {
  readonly provider: YearProviderId;
  readonly key: string;
}

/** A batched read's result: one slot per `AnswerRead`, in order, and the `mbyear:` entry. */
export interface BatchedReadResult {
  /** `undefined` for a miss, an invalid value, or a value naming another provider. */
  answers: (ProviderAnswer | undefined)[];
  /** The MusicBrainz `YearResult` under `yearKey`, validated like `YearCache.get`. */
  year: YearResult | undefined;
}

/**
 * The per-provider answer cache.
 *
 * Each provider's answer is cached ON ITS OWN, and the vote is recomputed on every call
 * from a batched read (plan decision 3). That is what makes a reorder of the plan free: no
 * key encodes the order, so nothing needs a version bump, and no final vote reached while a
 * provider was skipped is ever pinned.
 */
export interface ProviderAnswerCache {
  /**
   * Every key in ONE command (Upstash `MGET`): the provider-answer keys, and -- when given --
   * the MusicBrainz `mbyear:` key. Never throws: a read failure is a miss on every slot.
   */
  readMany(reads: readonly AnswerRead[], yearKey?: string): Promise<BatchedReadResult>;
  /** Store one provider's answer with an expiry, in seconds. Never throws. */
  setAnswer(key: string, answer: ProviderAnswer, ttlSeconds: number): Promise<void>;
  readonly kind: 'memory' | 'upstash';
}

/** What every adapter below returns: both views, over one store. */
export interface SharedYearCache extends YearCache, ProviderAnswerCache {}

/**
 * TTLs, one per confidence tier, with their reasoning attached because the numbers
 * themselves are a guess until there is usage data (an open question in the plan).
 *
 * ===========================================================================
 *  THE RULE THAT SETS THESE: **Redis TTL >= the edge TTL for the same answer.**
 *
 *  `api/year.ts` sets a `Cache-Control` as well, and the two caches are NOT
 *  interchangeable: an edge miss is free, because it falls through to Redis,
 *  while a Redis miss costs requests against budgets that are global across
 *  all users. So Redis must never expire first. For the staged path the rule
 *  is `stagedEdgeMaxAgeSeconds()` below; for the stage-less legacy path it is
 *  the per-tier table in `api/year.ts`.
 *
 *  An earlier version of this file had two tiers, not three, and violated the
 *  rule in the direction that matters: a `low` year was pinned in Redis for
 *  THIRTY DAYS while the edge held it for one.
 * ===========================================================================
 *
 * `high` gets thirty days: an album's original release year is a historical fact and does
 * not change. The bound exists only so a year computed from a MusicBrainz record that later
 * gets corrected eventually washes out. Note that a scoring change does not need to wait for
 * it -- that is what the `v1` segment in the key is for.
 *
 * `low` gets seven days, and this is the tier the rule above was written for. A `low` year is
 * shown to the player with an "unconfirmed" marker (decided 2026-08-04), so it is load-bearing
 * rather than a placeholder -- and it is also the tier most likely to be WRONG and most likely
 * to become a `high` as MusicBrainz's data improves. A month is too long to pin one; a day
 * would re-derive it for every replay of the same playlist within a week.
 *
 * `none` gets one day. A miss is worth caching at all -- it costs a full two-request round
 * trip to re-derive, and the next person to paste the same playlist will ask for the same
 * track -- but it is the result most likely to improve, so it gets the shortest window.
 */
export const HIGH_CONFIDENCE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const LOW_CONFIDENCE_TTL_SECONDS = 60 * 60 * 24 * 7; //  7 days
export const NO_YEAR_TTL_SECONDS = 60 * 60 * 24; //  1 day

/** Pick the TTL for a result. Negative results are cached too -- see decision 9. */
export function ttlFor(result: YearResult): number {
  if (result.year === null) return NO_YEAR_TTL_SECONDS;
  return result.confidence === 'high' ? HIGH_CONFIDENCE_TTL_SECONDS : LOW_CONFIDENCE_TTL_SECONDS;
}

/**
 * The two providers whose answers live in the provider-answer cache. MusicBrainz is not one:
 * its answers live under `mbyear:`, and its provider is never wrapped (see
 * `api/_lib/musicbrainz-provider.ts`).
 */
export type StoreProviderId = Exclude<YearProviderId, 'musicbrainz'>;

/**
 * Per-provider answer TTLs: 30 days for an answer with a year, 1 day for a null.
 *
 * A store's year has no confidence tier to split on -- the tiering happens in the vote, which
 * is recomputed on every call and never cached -- so a year gets MusicBrainz's `high` window
 * and a null its `none` window, for the same reasons: a store's release date for a verified
 * row does not change, and a miss is the answer most likely to improve (a catalogue gains the
 * track, a storefront licenses it). Per provider rather than one pair so a store that turns
 * out to churn can be shortened alone.
 */
export const PROVIDER_ANSWER_TTL_SECONDS: Readonly<
  Record<StoreProviderId, { readonly year: number; readonly none: number }>
> = {
  deezer: { year: HIGH_CONFIDENCE_TTL_SECONDS, none: NO_YEAR_TTL_SECONDS },
  itunes: { year: HIGH_CONFIDENCE_TTL_SECONDS, none: NO_YEAR_TTL_SECONDS },
};

/**
 * The TTL of the cache entry an answer lives in, for any provider.
 *
 * For a store it is `PROVIDER_ANSWER_TTL_SECONDS`; for MusicBrainz it is `ttlFor()` of the
 * `mbyear:` entry the answer came from, which is the same tiering read off the answer's own
 * confidence. One function for both, because the edge rule below needs "the shortest TTL
 * among the entries this answer was built from" and must not care which family each is in.
 */
export function answerTtlFor(answer: ProviderAnswer): number {
  if (answer.provider === 'musicbrainz') {
    if (answer.year === null) return NO_YEAR_TTL_SECONDS;
    return answer.confidence === 'high' ? HIGH_CONFIDENCE_TTL_SECONDS : LOW_CONFIDENCE_TTL_SECONDS;
  }
  const ttl = PROVIDER_ANSWER_TTL_SECONDS[answer.provider];
  return answer.year === null ? ttl.none : ttl.year;
}

/**
 * The edge's hold on a provisional staged answer, or on a final one reached while a provider
 * was skipped. A guess (the plan's open question): short enough that a card whose `verify`
 * lands, or whose skipped provider comes back, is re-derived within a minute; long enough to
 * absorb a burst of players dealing the same playlist at once.
 */
export const PROVISIONAL_EDGE_SECONDS = 60;

/**
 * How long the edge may hold a staged (`?stage=`) answer.
 *
 * - **Final, nothing skipped**: at most the SHORTEST TTL among the cache entries it was built
 *   from. That is the "Redis outlives the edge" rule restated per answer: the vote is
 *   recomputed from those entries on every call, so the edge must not keep serving a vote
 *   after the first entry under it could have expired and changed it.
 * - **Provisional, or final with a provider skipped**: `PROVISIONAL_EDGE_SECONDS`. A
 *   provisional answer is by definition about to change, and a final reached without a
 *   provider is final only for as long as that provider stays skipped -- pinning it for a
 *   month would keep the degraded answer long after the configuration is fixed. This is the
 *   failure the rejected `yearfinal:` key would have had, moved to the edge.
 *
 * `sourceTtlsSeconds` empty (no entry at all) takes the short branch too: there is nothing
 * for the edge to be bounded by.
 */
export function stagedEdgeMaxAgeSeconds(answer: {
  final: boolean;
  skipped: boolean;
  sourceTtlsSeconds: readonly number[];
}): number {
  if (!answer.final || answer.skipped || answer.sourceTtlsSeconds.length === 0) {
    return PROVISIONAL_EDGE_SECONDS;
  }
  return Math.min(...answer.sourceTtlsSeconds);
}

/**
 * ===========================================================================
 *  A CACHE FAILURE MUST NEVER FAIL A LOOKUP.
 *
 *  Every method below swallows its errors: a read error is a MISS, a write
 *  error is a NO-OP, and both are logged. The cache is a latency optimisation;
 *  the providers are the source of truth. An Upstash outage should make the app
 *  slow, not broken.
 *
 *  This is why nothing here rethrows and why neither `resolveYear()` nor the
 *  driver has a try/catch around its cache calls.
 * ===========================================================================
 */

/**
 * Development cache over a closure-scope map.
 *
 * ITS REAL LIMITATION, stated plainly because "the cache is working" is easy to believe
 * here: it lives only as long as one warm serverless instance. Vercel may run several
 * instances concurrently and will discard them when idle, so entries are neither shared
 * between users nor durable. It is a development convenience and a safe default, not a
 * production cache -- which is exactly why `createCache()` logs which one it picked.
 *
 * AND UNDER `vercel dev` IT NEVER HITS AT ALL. Measured 2026-08-04: the local dev server
 * runs a fresh PROCESS per invocation (three requests, three PIDs), so this map is rebuilt
 * empty every time and `cached` is always false. `globalThis` does not rescue it either --
 * that was tested. Nothing to fix here; it is how `vercel dev` works, and a warm production
 * instance behaves as described above. Configure Upstash if you need the cache locally.
 * See docs/agent_findings.md (2026-08-04). The consequence for the staged path: `verify`
 * under `vercel dev` finds none of `resolve`'s answers and asks every provider again.
 *
 * Values are held as `unknown` and VALIDATED ON READ, exactly as the Upstash adapter does,
 * so the memory cache under `vercel dev` behaves the same as production rather than
 * trusting whatever was put in -- and so the two views cannot read each other's shapes.
 */
export function createMemoryCache(): SharedYearCache {
  const store = new Map<string, { value: unknown; expiresAt: number }>();

  /** One key, with expiry enforced here -- the single place both views read through. */
  function read(key: string): unknown {
    const entry = store.get(key);
    if (!entry) return undefined;

    // Expiry is enforced on read rather than by a timer: a serverless instance can be
    // frozen between invocations, so a `setTimeout` is not a reliable clock here.
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  function write(key: string, value: unknown, ttlSeconds: number): void {
    store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  return {
    kind: 'memory',

    get(key) {
      const value = read(key);
      return Promise.resolve(isYearResult(value) ? value : undefined);
    },

    set(key, value, ttlSeconds) {
      write(key, value, ttlSeconds);
      return Promise.resolve();
    },

    readMany(reads, yearKey) {
      return Promise.resolve(
        validateBatch(
          reads,
          reads.map((slot) => read(slot.key)),
          yearKey === undefined ? undefined : read(yearKey),
        ),
      );
    },

    setAnswer(key, answer, ttlSeconds) {
      write(key, answer, ttlSeconds);
      return Promise.resolve();
    },
  };
}

/** The minimum of `fetch` the Upstash adapter needs. Structural, so test doubles stay one-liners. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface UpstashConfig {
  url: string;
  token: string;
}

/**
 * Upstash Redis over its REST API, using the global `fetch`.
 *
 * No client library, on purpose (decision 6): the operations needed are GET, MGET and a
 * SET-with-expiry, and a dependency would add cold-start weight to a latency-sensitive
 * function for no capability gain.
 *
 * COMMANDS GO IN THE POST BODY as a JSON array, never built into the URL path. Upstash
 * supports both, and the path form is the one every example shows -- but our keys are
 * normalized artist-title pairs, so they contain spaces, pipes and punctuation. Encoding
 * those into a path is a subtle-bug generator; a JSON body has no such problem.
 */
export function createUpstashCache(config: UpstashConfig, fetchImpl: FetchLike): SharedYearCache {
  async function command(args: (string | number)[]): Promise<unknown> {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) throw new Error(`upstash responded ${response.status}`);
    return await response.json();
  }

  async function setJson(label: string, key: string, value: unknown, ttlSeconds: number) {
    try {
      // `EX` rather than a separate EXPIRE: one round trip, and no window in which a key
      // exists with no expiry at all.
      await command(['SET', key, JSON.stringify(value), 'EX', ttlSeconds]);
    } catch (error) {
      console.warn(`[${label}] write failed, continuing without caching:`, describe(error));
    }
  }

  return {
    kind: 'upstash',

    async get(key) {
      try {
        const body = await command(['GET', key]);
        const parsed = parseStored(extractResult(body));
        // A stored value that no longer parses as a `YearResult` means the shape changed
        // without the key version being bumped. Treated as a miss rather than trusted --
        // a wrong year is worse than a slow one.
        return isYearResult(parsed) ? parsed : undefined;
      } catch (error) {
        // Never the token, never the response body: this line ends up in a shared log.
        console.warn('[year-cache] read failed, treating as a miss:', describe(error));
        return undefined;
      }
    },

    async set(key, value, ttlSeconds) {
      await setJson('year-cache', key, value, ttlSeconds);
    },

    async readMany(reads, yearKey) {
      const keys = reads.map((slot) => slot.key);
      if (yearKey !== undefined) keys.push(yearKey);
      if (keys.length === 0) return { answers: [], year: undefined };

      try {
        // ONE command for every slot -- the whole point of the batched read. Upstash answers
        // `{"result": [value-or-null, …]}` in key order; a missing key is `null`, which is a
        // hit-or-miss per slot, not an error.
        const body = await command(['MGET', ...keys]);
        const raw = extractResult(body);
        if (!Array.isArray(raw) || raw.length !== keys.length) {
          throw new Error('upstash MGET answered an unexpected shape');
        }
        // Parsed slot by slot, so one corrupt value is a miss on ITS slot and not on all.
        const values = raw.map((value: unknown) => parseStoredOrMiss(value));
        return validateBatch(
          reads,
          values.slice(0, reads.length),
          yearKey === undefined ? undefined : values[reads.length],
        );
      } catch (error) {
        console.warn('[answer-cache] batched read failed, treating as misses:', describe(error));
        return { answers: reads.map(() => undefined), year: undefined };
      }
    },

    async setAnswer(key, answer, ttlSeconds) {
      await setJson('answer-cache', key, answer, ttlSeconds);
    },
  };
}

/**
 * Select an adapter from the environment, and say which one out loud.
 *
 * The log line is not decoration. Silently falling back to the in-memory adapter in
 * production would look exactly like a cache that is wired up correctly and simply never
 * hits -- a slow app with no error anywhere and nothing to grep for.
 *
 * Keyed on the URL alone, with the token checked alongside it, so a half-configured
 * deployment (URL set, token missing) degrades to in-memory with a warning rather than
 * failing every write.
 */
export function createCache(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): SharedYearCache {
  const url = env['UPSTASH_REDIS_REST_URL']?.trim();
  const token = env['UPSTASH_REDIS_REST_TOKEN']?.trim();

  if (url && token) {
    console.log('[year-cache] using Upstash Redis');
    return createUpstashCache({ url, token }, fetchImpl);
  }

  if (url && !token) {
    console.warn('[year-cache] UPSTASH_REDIS_REST_URL is set but the token is not; using memory');
  } else {
    console.log('[year-cache] using in-memory cache (per-instance, not shared)');
  }

  return createMemoryCache();
}

/**
 * The key a store provider's answer for one card lives under -- the ONE place both the
 * wrapper below and the driver's batched read build it, so they cannot disagree.
 *
 * Keyed by the RAW joined artist, not the primary artist the stores search with, for the
 * same reason `yearCacheKey` is: two different collaborations must never share an entry, and
 * a key more specific than the answer strictly needs costs only an occasional duplicate.
 */
export function providerAnswerKey(provider: YearProviderId, input: ProviderLookupInput): string {
  return providerCacheKey(provider, input.rawArtist, input.cleaned.title);
}

/**
 * Wrap a STORE adapter in the answer cache: read before asking, write every answer after.
 *
 * Applied to Deezer and iTunes only, never to MusicBrainz (whose `resolveYear()` owns its own
 * `mbyear:` entry). The key never encodes the plan, so the plan's order never touches a key.
 *
 * Only an `answer` is written -- a `year: null` one included, with the shorter TTL, because
 * "asked and found nothing" is worth not asking again for a day. `skipped`, `failed` and
 * `busy` pass straight through uncached: each is a statement about the provider right now,
 * not about the track, and caching one would poison the key.
 *
 * The driver has usually just read this key in its batched read, so a cold card pays one
 * extra single-key read here. Accepted, as `resolveYear()` repeating its own check is: it
 * keeps the wrapper correct on its own, and a warm card never reaches it.
 */
export function withAnswerCache(
  lookup: ProviderLookup,
  cache: ProviderAnswerCache,
): ProviderLookup {
  return {
    id: lookup.id,

    async lookup(input) {
      const key = providerAnswerKey(lookup.id, input);
      const { answers } = await cache.readMany([{ provider: lookup.id, key }]);
      const hit = answers[0];
      if (hit !== undefined) return { kind: 'answer', answer: hit, cached: true, requestCount: 0 };

      const outcome = await lookup.lookup(input);
      if (outcome.kind === 'answer') {
        await cache.setAnswer(key, outcome.answer, answerTtlFor(outcome.answer));
      }
      return outcome;
    },
  };
}

/** Upstash answers `{"result": …}`; anything else is not a shape we understand. */
function extractResult(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)['result'];
}

/**
 * A stored Redis string, parsed. A Redis miss is `null`, which is a successful response,
 * not an error; so is an empty string. Throws on unparseable JSON, which each caller maps to
 * a miss.
 */
function parseStored(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw === '') return undefined;
  return JSON.parse(raw) as unknown;
}

/** `parseStored`, with an unparseable value read as a miss instead of thrown. */
function parseStoredOrMiss(raw: unknown): unknown {
  try {
    return parseStored(raw);
  } catch {
    return undefined;
  }
}

/** Validate every slot of a batched read. Shared by both adapters, so they cannot differ. */
function validateBatch(
  reads: readonly AnswerRead[],
  answerValues: readonly unknown[],
  yearValue: unknown,
): BatchedReadResult {
  return {
    answers: reads.map((slot, index) => {
      const value = answerValues[index];
      return isProviderAnswer(value, slot.provider) ? value : undefined;
    }),
    year: isYearResult(yearValue) ? yearValue : undefined,
  };
}

/**
 * Validate a value round-tripped through JSON.
 *
 * The whole `YearResult` is stored, not a bare year (decision 9): storing only the number
 * would make every cache hit report `high` confidence and quietly defeat Phase 6's
 * reveal-side year UI. This guard is what makes reading it back safe.
 */
export function isYearResult(value: unknown): value is YearResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  if (record['year'] === null) return record['confidence'] === 'none';
  return (
    typeof record['year'] === 'number' &&
    (record['confidence'] === 'high' || record['confidence'] === 'low')
  );
}

/** A year field of a stored answer: `null`, or a plausible integer year. */
function isYearOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && isPlausibleYear(value));
}

/**
 * Validate a stored `ProviderAnswer`, AND that it is the provider the key belongs to.
 *
 * The second half is what stops a value written under one provider's key from voting as
 * another provider -- which would turn one answer into a confirmation. Every arm is checked
 * in full, including the MusicBrainz ones, so a future caller storing those gets the same
 * guard; today only the two stores' answers are written here.
 */
export function isProviderAnswer(
  value: unknown,
  provider: YearProviderId,
): value is ProviderAnswer {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['provider'] !== provider) return false;

  switch (provider) {
    case 'deezer':
      return isYearOrNull(record['year']) && isYearOrNull(record['isrcYear']);
    case 'itunes':
      return isYearOrNull(record['year']);
    case 'musicbrainz': {
      if (record['year'] === null) return record['confidence'] === 'none';
      const viaTitle = record['viaTitle'];
      return (
        typeof record['year'] === 'number' &&
        isPlausibleYear(record['year']) &&
        (record['confidence'] === 'high' || record['confidence'] === 'low') &&
        (record['source'] === 'release-group' || record['source'] === 'recording') &&
        (viaTitle === undefined || typeof viaTitle === 'string')
      );
    }
  }
}

/** A short, safe description of a thrown value. Never a stack trace and never a payload. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
