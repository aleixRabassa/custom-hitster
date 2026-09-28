/**
 * @vitest-environment jsdom
 *
 * The provider's three jobs: start in the right language on the FIRST render, keep
 * `<html lang>` in step with it, and remember a choice. Plus the one way it must never fail --
 * it sits outside `ErrorBoundary`, so a throw here is a white page.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from './LocaleProvider';
import { CATALOGUES } from '../game/i18n';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from '../game/locale';
import type { StorageLike } from '../game/persistence';
import { useLocale, type LocaleContextValue } from '../hooks/useLocale';

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

/** Renders nothing; hands the latest context value to the test. */
function renderWithProbe(props: { storage?: StorageLike; languages?: readonly string[] }) {
  const seen: { current: LocaleContextValue | null } = { current: null };

  function Probe() {
    seen.current = useLocale();
    return null;
  }

  render(
    <LocaleProvider {...props}>
      <Probe />
    </LocaleProvider>,
  );

  return seen;
}

describe('LocaleProvider', () => {
  afterEach(() => {
    cleanup();
    // The provider writes to the shared document; one test's `lang` must not leak into the next.
    document.documentElement.lang = '';
  });

  it('should detect the locale from the language list and set the document language', () => {
    const seen = renderWithProbe({ storage: memoryStorage(), languages: ['es-ES'] });

    expect(seen.current?.locale).toBe('es');
    expect(seen.current?.copy).toBe(CATALOGUES.es.copy);
    expect(seen.current?.errorMessages).toBe(CATALOGUES.es.errorMessages);
    expect(document.documentElement.lang).toBe('es');
  });

  it('should prefer a stored choice over the language list', () => {
    const seen = renderWithProbe({
      storage: memoryStorage({ [LOCALE_STORAGE_KEY]: 'ca' }),
      languages: ['es-ES'],
    });

    expect(seen.current?.locale).toBe('ca');
    expect(document.documentElement.lang).toBe('ca');
  });

  it('should switch, update the document language and remember the choice on setLocale', () => {
    const storage = memoryStorage();
    const seen = renderWithProbe({ storage, languages: ['es-ES'] });

    act(() => {
      seen.current?.setLocale('en');
    });

    expect(seen.current?.locale).toBe('en');
    expect(seen.current?.copy).toBe(CATALOGUES.en.copy);
    expect(document.documentElement.lang).toBe('en');
    expect(storage.map.get(LOCALE_STORAGE_KEY)).toBe('en');
  });

  describe('when reading localStorage itself throws', () => {
    // ===================================================================
    //  THE PROPERTY READ, NOT A METHOD CALL. `loadLocale`/`saveLocale`
    //  already swallow a throwing `getItem`/`setItem`; what they cannot
    //  guard is `window.localStorage` throwing before either is reached,
    //  which a browser blocking site data does. This provider is mounted
    //  OUTSIDE `ErrorBoundary`, so that throw would be a white page.
    // ===================================================================
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

    afterEach(() => {
      if (original) Object.defineProperty(window, 'localStorage', original);
    });

    it('should render in the detected language and forget the choice instead of throwing', () => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('SecurityError');
        },
      });

      const seen = renderWithProbe({ languages: ['fr'] });

      expect(seen.current?.locale).toBe(DEFAULT_LOCALE);
      expect(() =>
        act(() => {
          seen.current?.setLocale('ca');
        }),
      ).not.toThrow();
      expect(seen.current?.locale).toBe('ca');
    });
  });
});
