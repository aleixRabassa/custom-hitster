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
  it('should default both options to false with nothing stored', () => {
    expect(loadPrefs(memoryStorage())).toEqual({ keepYearless: false, skipUnconfirmed: false });
    expect(DEFAULT_PREFS).toEqual({ keepYearless: false, skipUnconfirmed: false });
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
      '{"skipUnconfirmed":"true"}',
      '{"skipUnconfirmed":1}',
    ];

    for (const raw of malformed) {
      expect(loadPrefs(memoryStorage({ [PREFS_STORAGE_KEY]: raw }))).toEqual(DEFAULT_PREFS);
    }

    // A storage that throws reads as the default too, rather than failing the render that seeds
    // the checkbox from it -- and a write to one is swallowed.
    expect(loadPrefs(throwingStorage)).toEqual(DEFAULT_PREFS);
    expect(() => {
      savePrefs(throwingStorage, { keepYearless: true, skipUnconfirmed: true });
    }).not.toThrow();
  });

  it('should default each field on its own', () => {
    // A record written before `skipUnconfirmed` existed holds only `keepYearless`, and must keep
    // the choice it records rather than reset for lacking the newer key.
    const legacy = memoryStorage({ [PREFS_STORAGE_KEY]: '{"keepYearless":true}' });
    expect(loadPrefs(legacy)).toEqual({ keepYearless: true, skipUnconfirmed: false });

    // And one malformed field does not cost the other.
    const halfBad = memoryStorage({
      [PREFS_STORAGE_KEY]: '{"keepYearless":"yes","skipUnconfirmed":true}',
    });
    expect(loadPrefs(halfBad)).toEqual({ keepYearless: false, skipUnconfirmed: true });
  });

  it('should round-trip', () => {
    const storage = memoryStorage();

    for (const keepYearless of [true, false]) {
      for (const skipUnconfirmed of [true, false]) {
        savePrefs(storage, { keepYearless, skipUnconfirmed });
        expect(loadPrefs(storage)).toEqual({ keepYearless, skipUnconfirmed });
      }
    }
  });

  it('should write only known fields', () => {
    // A VARIABLE, not a literal, so TypeScript's excess-property check stays out of the way --
    // which is exactly how a spread of something larger reaches `savePrefs` in real code.
    const larger = {
      keepYearless: true,
      skipUnconfirmed: true,
      deck: ['Bohemian Rhapsody'],
      seed: 'abc',
    };
    const prefs: Prefs = larger;
    const storage = memoryStorage();

    savePrefs(storage, prefs);

    expect(JSON.parse(storage.map.get(PREFS_STORAGE_KEY) ?? '{}')).toEqual({
      keepYearless: true,
      skipUnconfirmed: true,
    });
  });

  it('should use the jitster:prefs:v1 key', () => {
    expect(PREFS_STORAGE_KEY).toBe('jitster:prefs:v1');

    const storage = memoryStorage();
    savePrefs(storage, { keepYearless: true, skipUnconfirmed: false });

    expect([...storage.map.keys()]).toEqual(['jitster:prefs:v1']);
  });
});
