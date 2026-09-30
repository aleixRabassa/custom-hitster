/**
 * The player's remembered preferences (2026-09-30, plan.year-fetch-rework-ui.md step 3).
 *
 * Today there is one: the picker's "Keep cards with no year found" checkbox (spike §12.8). Built
 * exactly like `locale.ts` -- pure, framework-free, an injected `StorageLike` exactly as
 * `persistence.ts` takes one -- so every branch is a node-environment test and `App.tsx` is the
 * only file that touches the real `localStorage` for it.
 *
 * ## What it governs, and what it does NOT
 *
 * The value seeds the picker's checkbox and is handed to every NEW deal: the picker's Start, a
 * share link's deal, and "Play the shared deck". A share link therefore deals with the
 * RECIPIENT's remembered choice -- the link format never carries the sender's. A Restart or
 * "Play again" re-deals with the SESSION's own `GameState.keepYearless`, never with this, and a
 * resumed game keeps the value its save was written with.
 *
 * ## Validated on read, rebuilt on write
 *
 * A stored value is parsed and checked field by field: anything that is not a JSON object with a
 * boolean `keepYearless` reads as `DEFAULT_PREFS`, never as a crash and never as a truthy string.
 * The WRITE rebuilds the object from its known fields too, for the `playlist-library.ts` reason:
 * `Prefs` is a structural interface, TypeScript's excess-property check does not fire for a
 * spread, so `savePrefs(storage, { ...somethingLarger })` type-checks -- and a
 * `JSON.stringify(prefs)` would persist every extra field it carried.
 */

import type { StorageLike } from './persistence';

/**
 * The stored preferences. Shares the `jitster:` prefix with the session, library and locale keys.
 * A new key, never a renamed one: a renamed key is not read (the 2026-09-30 rename paid that once).
 */
export const PREFS_STORAGE_KEY = 'jitster:prefs:v1';

export interface Prefs {
  /** The picker's "Keep cards with no year found". Default OFF (the developer's choice). */
  readonly keepYearless: boolean;
}

export const DEFAULT_PREFS: Prefs = { keepYearless: false };

/**
 * The remembered preferences, or `DEFAULT_PREFS` when there are none, they are malformed, or the
 * storage throws. Never throws itself.
 */
export function loadPrefs(storage: StorageLike): Prefs {
  let raw: string | null;
  try {
    raw = storage.getItem(PREFS_STORAGE_KEY);
  } catch {
    return DEFAULT_PREFS;
  }
  if (raw === null) return DEFAULT_PREFS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_PREFS;

  const keepYearless = (parsed as Record<string, unknown>)['keepYearless'];

  return typeof keepYearless === 'boolean' ? { keepYearless } : DEFAULT_PREFS;
}

/**
 * Remembers the preferences, rebuilt field by field (see the header). A storage that throws
 * (private mode, quota) loses them silently: the choice still applies for this page load.
 */
export function savePrefs(storage: StorageLike, prefs: Prefs): void {
  const stored: Prefs = { keepYearless: prefs.keepYearless };

  try {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Not remembered, and nothing else to do about it.
  }
}
