/**
 * `localStorage`, guarded -- the ONE copy of a read its callers used to keep privately, or not
 * guard at all.
 *
 * ===========================================================================
 *  READING THE PROPERTY CAN THROW, NOT JUST RETURN NULL.
 *
 *  `window.localStorage` itself -- the getter, before any `getItem` -- throws
 *  in Safari's private mode historically, and in a browser blocking site data
 *  today. Every module that takes a `StorageLike` already swallows a throwing
 *  `getItem`/`setItem`/`removeItem`; none of them can swallow a throw that
 *  happens before they are even handed the object. That is this function's
 *  whole job, and each caller has its own reason a throw would be worse than
 *  remembering nothing:
 *
 *  - `LocaleProvider` sits OUTSIDE `ErrorBoundary` in `main.tsx`, so a throw
 *    there is a white page with no crash screen at all.
 *  - `ErrorBoundary` reads it inside the Start over handler, on the error
 *    screen -- a throw there is an exception in the one component whose job is
 *    to prevent a white page. Failing to clear a save is the better outcome.
 *  - `App` reads it on the FIRST render, three times over: `useGameSession`
 *    for the saved game, the saved-playlist library, and (in a lazy state
 *    initialiser) the deal-option preferences. A throw in
 *    any of the three is a crash screen before the front door -- and a
 *    PERMANENT one, because the crash screen's Start over can clear nothing
 *    through a storage it cannot reach, so the reload crashes again. With all
 *    three guarded the player gets the front door and a game that is simply
 *    not saved. (Until 2026-10-01 only the preference was guarded and the
 *    other two read `localStorage` bare, so this bullet was not yet true.)
 *
 *  Any NEW first-render reader must come through here too: one bare
 *  `localStorage` read anywhere on that path reopens the permanent crash.
 * ===========================================================================
 *
 * The fallback is a storage that remembers nothing rather than `null`, so no caller has a null
 * branch to forget: a read is a miss, a write and a clear are no-ops -- exactly what each
 * `StorageLike` consumer already does with a storage whose methods throw, minus the warning. It is
 * one module-level object, so a caller holding it in a dependency list sees a stable identity.
 *
 * Browser-only, and no React: `src/game/` may touch the DOM (only `shared/` may not).
 */

import type { StorageLike } from './persistence';

/** What a caller reads from and writes to when `localStorage` itself is unreachable. */
export const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/** `localStorage`, or `NO_STORAGE` if reading the property throws. Never throws itself. */
export function readLocalStorage(): StorageLike {
  try {
    return window.localStorage;
  } catch {
    return NO_STORAGE;
  }
}
