import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CATALOGUES } from '../game/i18n';
import { initialLocale, saveLocale, type Locale } from '../game/locale';
import type { StorageLike } from '../game/persistence';
import { LocaleContext, type LocaleContextValue } from '../hooks/useLocale';

export interface LocaleProviderProps {
  children: ReactNode;
  /** Injected by tests; the real app falls back to `localStorage`, as `App.tsx` does. */
  storage?: StorageLike;
  /** Injected by tests; the real app reads `navigator.languages`. */
  languages?: readonly string[];
}

/** What the provider reads and writes when `localStorage` itself is unreachable. */
const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * `localStorage`, or a storage that remembers nothing.
 *
 * Reading the PROPERTY can throw rather than return null (Safari private mode has historically; a
 * browser blocking site data does today), and this provider sits OUTSIDE `ErrorBoundary` -- so a
 * throw here is a white page with no crash screen at all. Same guard as `ErrorBoundary.tsx`'s own
 * `readLocalStorage()`. A module-level fallback, so `setLocale`'s dependency is stable.
 */
function readLocalStorage(): StorageLike {
  try {
    return window.localStorage;
  } catch {
    return NO_STORAGE;
  }
}

/**
 * Holds the active language and hands its catalogue to everything below (2026-09-28).
 *
 * The starting locale is computed in `useState`'s LAZY initializer, so the very first render is
 * already in the right language -- no English frame before a Spanish one.
 *
 * `document.documentElement.lang` follows the locale. That is NOT cosmetic: the reveal's live
 * region is how a screen-reader user hears the year, and a Spanish sentence announced under
 * `lang="en"` is read with English pronunciation. `index.html` ships `lang="en"` as bytes and this
 * corrects it on mount; an effect is right here because it synchronises React state OUT to the DOM
 * and sets no state.
 */
export function LocaleProvider({ children, storage, languages }: LocaleProviderProps) {
  const [fallbackStorage] = useState(readLocalStorage);
  const localeStorage = storage ?? fallbackStorage;
  const [locale, setLocaleState] = useState<Locale>(() =>
    initialLocale(localeStorage, languages ?? navigator.languages ?? []),
  );

  const setLocale = useCallback(
    (next: Locale) => {
      saveLocale(localeStorage, next);
      setLocaleState(next);
    },
    [localeStorage],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, ...CATALOGUES[locale], setLocale }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
