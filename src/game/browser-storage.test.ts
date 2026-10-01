/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NO_STORAGE, readLocalStorage } from './browser-storage';

describe('readLocalStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return window.localStorage when the property is readable', () => {
    expect(readLocalStorage()).toBe(window.localStorage);
  });

  it('should return the no-op storage, not throw, when reading the property throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(readLocalStorage()).toBe(NO_STORAGE);
  });
});

describe('NO_STORAGE', () => {
  it('should remember nothing and never throw', () => {
    expect(() => {
      NO_STORAGE.setItem('key', 'value');
      NO_STORAGE.removeItem('key');
    }).not.toThrow();
    expect(NO_STORAGE.getItem('key')).toBeNull();
  });
});
