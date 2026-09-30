import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFS, PREFS_STORAGE_KEY, loadPrefs, savePrefs, type Prefs } from './prefs';
import type { StorageLike } from './persistence';

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

/** A storage whose every call throws, as private mode or a full quota can. */
const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('prefs', () => {
  it('should default to keepYearless false with nothing stored', () => {
    expect(loadPrefs(memoryStorage())).toEqual({ keepYearless: false });
    expect(DEFAULT_PREFS).toEqual({ keepYearless: false });
  });

  it('should reject malformed values', () => {
    const malformed = [
      'not json',
      '',
      'null',
      'true',
      '[]',
      '[true]',
      '{}',
      '{"keepYearless":"true"}',
      '{"keepYearless":1}',
      '{"keepYearless":null}',
      '{"keepyearless":true}',
    ];

    for (const raw of malformed) {
      expect(loadPrefs(memoryStorage({ [PREFS_STORAGE_KEY]: raw }))).toEqual(DEFAULT_PREFS);
    }

    // A storage that throws reads as the default too, rather than failing the render that seeds
    // the checkbox from it -- and a write to one is swallowed.
    expect(loadPrefs(throwingStorage)).toEqual(DEFAULT_PREFS);
    expect(() => {
      savePrefs(throwingStorage, { keepYearless: true });
    }).not.toThrow();
  });

  it('should round-trip', () => {
    const storage = memoryStorage();

    savePrefs(storage, { keepYearless: true });
    expect(loadPrefs(storage)).toEqual({ keepYearless: true });

    savePrefs(storage, { keepYearless: false });
    expect(loadPrefs(storage)).toEqual({ keepYearless: false });
  });

  it('should write only known fields', () => {
    // A VARIABLE, not a literal, so TypeScript's excess-property check stays out of the way --
    // which is exactly how a spread of something larger reaches `savePrefs` in real code.
    const larger = { keepYearless: true, deck: ['Bohemian Rhapsody'], seed: 'abc' };
    const prefs: Prefs = larger;
    const storage = memoryStorage();

    savePrefs(storage, prefs);

    expect(JSON.parse(storage.map.get(PREFS_STORAGE_KEY) ?? '{}')).toEqual({ keepYearless: true });
  });

  it('should use the jitster:prefs:v1 key', () => {
    expect(PREFS_STORAGE_KEY).toBe('jitster:prefs:v1');

    const storage = memoryStorage();
    savePrefs(storage, { keepYearless: true });

    expect([...storage.map.keys()]).toEqual(['jitster:prefs:v1']);
  });
});
