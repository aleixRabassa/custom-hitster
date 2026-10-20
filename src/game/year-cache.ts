/**
 * A browser-local cache of SERVER-FINAL years, keyed by Spotify track id (2026-10-20, the
 * developer's decision) -- so re-dealing a playlist already played (a new deal, the library, Play
 * again on another day) asks `/api/year` nothing for a known track, and works offline.
 *
 * It is the same shape as the bundled preloaded table (`preloaded-years.ts`): a versioned,
 * final-only, id-keyed store of the vote's answers, asked before any request. It is NOT a response
 * cache -- the service worker still never caches a raw `/api/year` response (`vite.config.ts`).
 *
 * ## Only what the server called final
 *
 * `withLocalYearCache` writes from the LOOKUP, never from the resolver's `onResolved`: the
 * resolver also settles a card from the client side (an exhausted resolve, an exhausted verify),
 * and `onResolved` cannot tell that from a server-final answer. The filter is the one
 * `scripts/preload-years.ts` uses -- `ok`, `final`, nothing skipped -- plus a numeric year: `null`
 * is NEVER stored (the server keeps "no year" for a day only, and it is the answer most likely to
 * improve). The entry keeps the REAL confidence, so `skipUnconfirmed` still drops a cached `low`.
 *
 * ## The signature is what makes a vote change invalidate every browser
 *
 * The server deliberately caches no final vote, because it would need a version bump on every
 * plan change; `YEAR_CACHE_SCHEMA_VERSION` covers MusicBrainz only. So the stored payload carries
 * a SIGNATURE built from that version, every `PROVIDER_CACHE_VERSION`, the provider plan and the
 * trust order. A payload whose signature differs from this build's is discarded whole, on read:
 * any change to the vote or a provider invalidates every browser's cache with no manual bump.
 *
 * ## Expiry mirrors Redis
 *
 * `high` 30 days, `low` 7 days, counted from `storedAt` (the server's TTLs for the same tiers). An
 * expired entry is ignored on read and dropped on the next write. At most `MAX_YEAR_CACHE_ENTRIES`
 * entries; a write beyond the cap evicts the oldest `storedAt`.
 *
 * ## Deliberately not here
 *
 * No deal-time stamp in `usePlaylist` (it has no storage injection): card 1 is answered by the
 * resolver from the in-memory map at once, so the card-1 gate passes anyway. The cache is loaded
 * once per session-hook instance and written through to storage synchronously on each new entry.
 * Two tabs are last-write-wins. The TWA shares this storage with the browser, by design.
 * `VITE_PRELOADED_YEARS=off` disables it entirely (no read, no write), or a load test measures
 * nothing. Ids and years only -- a track title must never enter this store.
 *
 * Pure and framework-free, with an injected `StorageLike` and clock, like `prefs.ts`.
 */

import { YEAR_CACHE_SCHEMA_VERSION } from '../../shared/year';
import {
  PROVIDER_CACHE_VERSION,
  UNCONFIRMED_TRUST,
  YEAR_PROVIDER_PLAN,
} from '../../shared/year-providers';
import type { ResolverLookup } from './resolver';
import type { StorageLike } from './persistence';

export const YEAR_CACHE_STORAGE_KEY = 'jitster:years:v1';

/** Mirrors the server's Redis TTLs for a confirmed (`high`) and an unconfirmed (`low`) answer. */
export const HIGH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const MAX_YEAR_CACHE_ENTRIES = 4000;

type CachedConfidence = 'high' | 'low';

export interface CachedYear {
  year: number;
  confidence: CachedConfidence;
  storedAt: number;
}

/** Everything the vote's answers depend on, as one string. See the header. */
export function yearCacheSignature(): string {
  return [
    YEAR_CACHE_SCHEMA_VERSION,
    JSON.stringify(PROVIDER_CACHE_VERSION),
    JSON.stringify(YEAR_PROVIDER_PLAN),
    JSON.stringify(UNCONFIRMED_TRUST),
  ].join('|');
}

export interface YearCache {
  /** The cached answer for a track, or `undefined` (absent, expired, or the cache is off). */
  get(trackId: string): { year: number; confidence: CachedConfidence } | undefined;
  /** Remember a server-final numeric answer. No-op when the cache is off or the answer is no entry. */
  set(trackId: string, year: number, confidence: string): void;
}

export interface YearCacheOptions {
  /** False disables the cache wholly: no read, no write, storage never touched. */
  enabled: boolean;
  now?: () => number;
}

function isFresh(entry: CachedYear, now: number): boolean {
  const ttl = entry.confidence === 'high' ? HIGH_TTL_MS : LOW_TTL_MS;

  return now - entry.storedAt < ttl;
}

/** Entries that are valid in shape and not expired; anything else is dropped, never thrown on. */
function readEntries(storage: StorageLike, now: number): Map<string, CachedYear> {
  const entries = new Map<string, CachedYear>();

  let raw: string | null;
  try {
    raw = storage.getItem(YEAR_CACHE_STORAGE_KEY);
  } catch {
    return entries;
  }
  if (raw === null) return entries;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return entries;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return entries;

  const payload = parsed as Record<string, unknown>;
  if (payload.signature !== yearCacheSignature()) return entries;

  const stored = payload.entries;
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return entries;

  for (const [id, value] of Object.entries(stored)) {
    if (typeof value !== 'object' || value === null) continue;
    const { year, confidence, storedAt } = value as Record<string, unknown>;
    if (typeof year !== 'number' || !Number.isInteger(year)) continue;
    if (confidence !== 'high' && confidence !== 'low') continue;
    if (typeof storedAt !== 'number' || !Number.isFinite(storedAt)) continue;

    const entry: CachedYear = { year, confidence, storedAt };
    if (isFresh(entry, now)) entries.set(id, entry);
  }

  return entries;
}

const OFF: YearCache = { get: () => undefined, set: () => {} };

/**
 * One cache over `storage`, loaded now. Never throws: a storage that throws on read is an empty
 * cache, and on write it costs the persistence but not the in-memory entry.
 */
export function createYearCache(storage: StorageLike, options: YearCacheOptions): YearCache {
  if (!options.enabled) return OFF;

  const now = options.now ?? Date.now;
  const entries = readEntries(storage, now());

  return {
    get(trackId) {
      const entry = entries.get(trackId);
      if (entry === undefined || !isFresh(entry, now())) return undefined;

      return { year: entry.year, confidence: entry.confidence };
    },

    set(trackId, year, confidence) {
      if (!Number.isInteger(year) || (confidence !== 'high' && confidence !== 'low')) return;

      const at = now();
      // Dropped on write, not on read: expired entries leave the store here.
      for (const [id, entry] of entries) {
        if (!isFresh(entry, at)) entries.delete(id);
      }
      entries.delete(trackId);
      entries.set(trackId, { year, confidence, storedAt: at });

      while (entries.size > MAX_YEAR_CACHE_ENTRIES) {
        let oldestId: string | undefined;
        let oldestAt = Infinity;
        for (const [id, entry] of entries) {
          if (entry.storedAt < oldestAt) {
            oldestAt = entry.storedAt;
            oldestId = id;
          }
        }
        if (oldestId === undefined) break;
        entries.delete(oldestId);
      }

      // Rebuilt field by field: nothing else an entry carried can reach storage.
      const out: Record<string, CachedYear> = {};
      for (const [id, entry] of entries) {
        out[id] = { year: entry.year, confidence: entry.confidence, storedAt: entry.storedAt };
      }

      try {
        storage.setItem(
          YEAR_CACHE_STORAGE_KEY,
          JSON.stringify({ signature: yearCacheSignature(), entries: out }),
        );
      } catch (error) {
        console.warn(
          '[years] could not save the year cache, continuing without it:',
          error instanceof Error ? error.message : 'unknown error',
        );
      }
    },
  };
}

/**
 * The resolver's lookup with the local cache between the preloaded table and the network: a hit
 * answers FINAL with the cached (real) confidence and sends nothing; a miss calls through and
 * remembers only an answer the server marked final, unskipped, with a numeric year.
 */
export function withLocalYearCache(lookup: ResolverLookup, cache: YearCache): ResolverLookup {
  return async (track, stage, signal) => {
    const hit = cache.get(track.id);
    if (hit !== undefined) {
      return {
        ok: true,
        result: {
          year: hit.year,
          confidence: hit.confidence,
          cached: true,
          cleanedTitle: track.title,
          stripped: { remaster: false, live: false, feature: false, version: false },
          final: true,
        },
      };
    }

    const outcome = await lookup(track, stage, signal);
    if (
      outcome.ok &&
      outcome.result.final === true &&
      outcome.result.skipped === undefined &&
      typeof outcome.result.year === 'number'
    ) {
      cache.set(track.id, outcome.result.year, outcome.result.confidence);
    }

    return outcome;
  };
}
