import { describe, expect, it, vi } from 'vitest';

import {
  HIGH_TTL_MS,
  LOW_TTL_MS,
  MAX_YEAR_CACHE_ENTRIES,
  YEAR_CACHE_STORAGE_KEY,
  createYearCache,
  withLocalYearCache,
  yearCacheSignature,
} from './year-cache';
import type { StorageLike } from './persistence';
import type { ResolverLookup } from './resolver';
import type { YearLookupOutcome } from './year-client';
import type { Card, YearLookupResult } from '../../shared/types';

function memoryStorage(seed: Record<string, string> = {}): StorageLike & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const NOW = 1_800_000_000_000;

function payload(entries: Record<string, unknown>, signature = yearCacheSignature()): string {
  return JSON.stringify({ signature, entries });
}

function storedEntries(storage: { map: Map<string, string> }): Record<string, unknown> {
  const stored = JSON.parse(storage.map.get(YEAR_CACHE_STORAGE_KEY) ?? '{}') as {
    entries: Record<string, unknown>;
  };

  return stored.entries;
}

describe('createYearCache', () => {
  it('should read a stored entry with its real confidence', () => {
    const storage = memoryStorage({
      [YEAR_CACHE_STORAGE_KEY]: payload({
        a: { year: 1984, confidence: 'low', storedAt: NOW - 1000 },
      }),
    });

    const cache = createYearCache(storage, { enabled: true, now: () => NOW });

    expect(cache.get('a')).toEqual({ year: 1984, confidence: 'low' });
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should drop bad entries and keep good ones', () => {
    const storage = memoryStorage({
      [YEAR_CACHE_STORAGE_KEY]: payload({
        good: { year: 1990, confidence: 'high', storedAt: NOW },
        nullYear: { year: null, confidence: 'high', storedAt: NOW },
        fraction: { year: 1990.5, confidence: 'high', storedAt: NOW },
        none: { year: 1990, confidence: 'none', storedAt: NOW },
        noTime: { year: 1990, confidence: 'high' },
        notObject: 7,
      }),
    });

    const cache = createYearCache(storage, { enabled: true, now: () => NOW });

    expect(cache.get('good')).toEqual({ year: 1990, confidence: 'high' });
    for (const id of ['nullYear', 'fraction', 'none', 'noTime', 'notObject']) {
      expect(cache.get(id)).toBeUndefined();
    }
  });

  it('should discard everything when the signature differs', () => {
    const storage = memoryStorage({
      [YEAR_CACHE_STORAGE_KEY]: payload(
        { a: { year: 1984, confidence: 'high', storedAt: NOW } },
        'an older vote',
      ),
    });

    expect(createYearCache(storage, { enabled: true, now: () => NOW }).get('a')).toBeUndefined();
  });

  it('should survive garbage in storage', () => {
    for (const raw of ['not json', '[]', 'null', '{"signature":1}']) {
      const storage = memoryStorage({ [YEAR_CACHE_STORAGE_KEY]: raw });
      expect(createYearCache(storage, { enabled: true }).get('a')).toBeUndefined();
    }
  });

  it('should expire a high entry after 30 days and a low one after 7', () => {
    let now = NOW;
    const cache = createYearCache(memoryStorage(), { enabled: true, now: () => now });
    cache.set('h', 1980, 'high');
    cache.set('l', 1981, 'low');

    now = NOW + LOW_TTL_MS - 1;
    expect(cache.get('l')).toBeDefined();
    now = NOW + LOW_TTL_MS;
    expect(cache.get('l')).toBeUndefined();
    expect(cache.get('h')).toBeDefined();
    now = NOW + HIGH_TTL_MS;
    expect(cache.get('h')).toBeUndefined();
  });

  it('should ignore expired entries on read and drop them on the next write', () => {
    const storage = memoryStorage({
      [YEAR_CACHE_STORAGE_KEY]: payload({
        old: { year: 1970, confidence: 'low', storedAt: NOW - LOW_TTL_MS },
      }),
    });
    const cache = createYearCache(storage, { enabled: true, now: () => NOW });
    expect(cache.get('old')).toBeUndefined();

    cache.set('new', 2001, 'high');

    expect(Object.keys(storedEntries(storage))).toEqual(['new']);
  });

  it('should never store a null year, a fraction or a none confidence', () => {
    const storage = memoryStorage();
    const cache = createYearCache(storage, { enabled: true, now: () => NOW });

    cache.set('a', null as unknown as number, 'high');
    cache.set('b', 1990.5, 'high');
    cache.set('c', 1990, 'none');

    expect(storage.map.has(YEAR_CACHE_STORAGE_KEY)).toBe(false);
    expect(cache.get('a')).toBeUndefined();
  });

  it('should evict the oldest entry beyond the cap', () => {
    let now = NOW;
    const storage = memoryStorage();
    const cache = createYearCache(storage, { enabled: true, now: () => now });

    for (let i = 0; i <= MAX_YEAR_CACHE_ENTRIES; i += 1) {
      now = NOW + i;
      cache.set(`t${i}`, 2000, 'high');
    }

    expect(cache.get('t0')).toBeUndefined();
    expect(cache.get('t1')).toBeDefined();
    expect(cache.get(`t${MAX_YEAR_CACHE_ENTRIES}`)).toBeDefined();
    expect(Object.keys(storedEntries(storage))).toHaveLength(MAX_YEAR_CACHE_ENTRIES);
  });

  it('should rebuild stored entries field by field', () => {
    const storage = memoryStorage({
      [YEAR_CACHE_STORAGE_KEY]: payload({
        a: { year: 1984, confidence: 'high', storedAt: NOW, title: 'Secret', extra: 1 },
      }),
    });
    const cache = createYearCache(storage, { enabled: true, now: () => NOW });

    cache.set('b', 1999, 'low');

    expect(JSON.parse(storage.map.get(YEAR_CACHE_STORAGE_KEY) ?? '')).toEqual({
      signature: yearCacheSignature(),
      entries: {
        a: { year: 1984, confidence: 'high', storedAt: NOW },
        b: { year: 1999, confidence: 'low', storedAt: NOW },
      },
    });
  });

  it('should survive a storage that throws and still answer from memory', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = createYearCache(throwingStorage, { enabled: true, now: () => NOW });

    expect(cache.get('a')).toBeUndefined();
    expect(() => {
      cache.set('a', 1984, 'high');
    }).not.toThrow();
    expect(cache.get('a')).toEqual({ year: 1984, confidence: 'high' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('should touch nothing when disabled', () => {
    const storage = memoryStorage({
      [YEAR_CACHE_STORAGE_KEY]: payload({ a: { year: 1984, confidence: 'high', storedAt: NOW } }),
    });
    const getItem = vi.spyOn(storage, 'getItem');
    const cache = createYearCache(storage, { enabled: false, now: () => NOW });

    cache.set('b', 1999, 'high');

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(getItem).not.toHaveBeenCalled();
    expect(Object.keys(storedEntries(storage))).toEqual(['a']);
  });
});

const card = { id: 'trk', title: 'Song', artist: 'Band' } as Card;
const signal = new AbortController().signal;

function result(overrides: Partial<YearLookupResult>): YearLookupOutcome {
  return {
    ok: true,
    result: {
      year: 1984,
      confidence: 'high',
      cached: false,
      cleanedTitle: 'Song',
      stripped: { remaster: false, live: false, feature: false, version: false },
      final: true,
      ...overrides,
    } as YearLookupResult,
  };
}

function wrapped(outcome: YearLookupOutcome, enabled = true) {
  const storage = memoryStorage();
  const cache = createYearCache(storage, { enabled, now: () => NOW });
  const network = vi.fn<ResolverLookup>(() => Promise.resolve(outcome));

  return { storage, network, lookup: withLocalYearCache(network, cache) };
}

describe('withLocalYearCache', () => {
  it('should write a final answer and answer it later with its real confidence and no request', async () => {
    const { network, lookup } = wrapped(result({ confidence: 'low' }));

    await lookup(card, 'resolve', signal);
    const second = await lookup(card, 'verify', signal);

    expect(network).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      ok: true,
      result: { year: 1984, confidence: 'low', final: true },
    });
  });

  it('should call through on a miss and return the outcome unchanged', async () => {
    const outcome = result({ final: false });
    const { network, lookup } = wrapped(outcome);

    expect(await lookup(card, 'resolve', signal)).toBe(outcome);
    expect(network).toHaveBeenCalledWith(card, 'resolve', signal);
  });

  it.each([
    ['not final', result({ final: false })],
    ['skipped', result({ skipped: ['itunes'] })],
    ['a null year', result({ year: null, confidence: 'none' })],
    ['an error', { ok: false, code: 'network' } as YearLookupOutcome],
  ])('should never write an answer that is %s', async (_name, outcome) => {
    const { storage, network, lookup } = wrapped(outcome);

    await lookup(card, 'resolve', signal);
    await lookup(card, 'resolve', signal);

    expect(network).toHaveBeenCalledTimes(2);
    expect(storage.map.has(YEAR_CACHE_STORAGE_KEY)).toBe(false);
  });

  it('should neither read nor write when the cache is off', async () => {
    const { storage, network, lookup } = wrapped(result({}), false);

    await lookup(card, 'resolve', signal);
    await lookup(card, 'resolve', signal);

    expect(network).toHaveBeenCalledTimes(2);
    expect(storage.map.has(YEAR_CACHE_STORAGE_KEY)).toBe(false);
  });
});
