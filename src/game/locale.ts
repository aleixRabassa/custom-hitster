/**
 * Which language the app speaks, and how that choice is made and remembered (2026-09-28).
 *
 * Pure and framework-free, like every other decision in `src/game/`: `matchLocale` takes the
 * browser's language list as an argument rather than reading `navigator`, and the storage pair
 * takes an injected `StorageLike` exactly as `persistence.ts` does -- so every branch is a
 * node-environment test.
 *
 * ## The order of precedence
 *
 * 1. A choice the player made with the selector, persisted under `LOCALE_STORAGE_KEY`.
 * 2. The first entry of `navigator.languages` whose primary subtag is a supported locale.
 * 3. `DEFAULT_LOCALE`.
 *
 * A stored value is validated on read: anything that is not one of `LOCALES` is ignored, never
 * trusted, so a hand-edited or future value falls through to detection instead of rendering an
 * app with no copy at all.
 */

import type { StorageLike } from './persistence';

/** Every language the app ships, in the order the selector shows them. */
export const LOCALES = ['en', 'es', 'ca'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Each language's own name, IN THAT LANGUAGE, and deliberately not part of any catalogue: a player
 * who landed in a language they cannot read must still recognise the button for theirs.
 */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  ca: 'Català',
};

/**
 * The stored choice. Shares the `jitster:` prefix with the session and library keys (all three
 * were `hitster:*` until 2026-09-30).
 */
export const LOCALE_STORAGE_KEY = 'jitster:locale:v1';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first supported locale in a browser's preference list, matched on the PRIMARY subtag only
 * (`es-AR` → `es`, `ca-ES` → `ca`), or `DEFAULT_LOCALE` when none matches.
 */
export function matchLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/** The persisted choice, or `null` when there is none, it is invalid, or storage throws. */
export function loadLocale(storage: StorageLike): Locale | null {
  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Remembers the choice. A storage that throws (private mode, quota) loses it silently. */
export function saveLocale(storage: StorageLike, locale: Locale): void {
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The choice still applies for this page load; it just is not remembered.
  }
}

/** The locale to start with: a remembered choice beats the browser's list. */
export function initialLocale(storage: StorageLike, languages: readonly string[]): Locale {
  return loadLocale(storage) ?? matchLocale(languages);
}
