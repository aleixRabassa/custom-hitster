import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  initialLocale,
  loadLocale,
  matchLocale,
  saveLocale,
} from './locale';
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

describe('matchLocale', () => {
  it('should match on the primary subtag', () => {
    expect(matchLocale(['es-AR'])).toBe('es');
    expect(matchLocale(['ca-ES'])).toBe('ca');
    expect(matchLocale(['en-GB'])).toBe('en');
  });

  it('should take the FIRST supported entry, skipping unsupported ones', () => {
    expect(matchLocale(['fr', 'es'])).toBe('es');
    expect(matchLocale(['fr-FR', 'ca', 'es'])).toBe('ca');
  });

  it('should fall back to the default when nothing matches, or nothing is listed', () => {
    expect(matchLocale(['fr'])).toBe(DEFAULT_LOCALE);
    expect(matchLocale([])).toBe(DEFAULT_LOCALE);
  });

  it('should tolerate odd casing, an underscore separator and whitespace', () => {
    expect(matchLocale(['CA_es'])).toBe('ca');
    expect(matchLocale(['  ES-mx '])).toBe('es');
  });
});

describe('loadLocale', () => {
  it('should return a stored supported locale', () => {
    expect(loadLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: 'ca' }))).toBe('ca');
  });

  it('should ignore a stored value that is not a supported locale', () => {
    // Validated on read, never trusted: a hand-edited or future value falls through to detection.
    expect(loadLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: 'fr' }))).toBeNull();
    expect(loadLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: 'ES' }))).toBeNull();
  });

  it('should return null when nothing is stored', () => {
    expect(loadLocale(memoryStorage())).toBeNull();
  });

  it('should return null rather than throw when storage throws', () => {
    expect(loadLocale(throwingStorage)).toBeNull();
  });
});

describe('saveLocale', () => {
  it('should write the locale under its key', () => {
    const storage = memoryStorage();

    saveLocale(storage, 'es');

    expect(storage.map.get(LOCALE_STORAGE_KEY)).toBe('es');
    expect(loadLocale(storage)).toBe('es');
  });

  it('should not throw when storage throws', () => {
    expect(() => saveLocale(throwingStorage, 'ca')).not.toThrow();
  });
});

describe('initialLocale', () => {
  it('should prefer a stored choice over the browser list', () => {
    expect(initialLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: 'ca' }), ['es-ES'])).toBe('ca');
  });

  it('should detect from the browser list when nothing valid is stored', () => {
    expect(initialLocale(memoryStorage(), ['es-ES'])).toBe('es');
    expect(initialLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: 'fr' }), ['ca'])).toBe('ca');
    expect(initialLocale(throwingStorage, ['es'])).toBe('es');
  });

  it('should fall back to the default when neither source names a supported locale', () => {
    expect(initialLocale(memoryStorage(), ['fr'])).toBe(DEFAULT_LOCALE);
  });
});
