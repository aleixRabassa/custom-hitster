/**
 * Which surface launched this page: the Android app (the TWA) or a plain web browser.
 *
 * Pure and framework-free. `App` reads `document.referrer` and `sessionStorage` and hands both in,
 * so every branch is a node test.
 *
 * ===========================================================================
 *  WHY A REFERRER, AND WHY SESSIONSTORAGE AND NEVER LOCALSTORAGE.
 *
 *  A TWA's launch navigation carries `document.referrer` =
 *  `android-app://<package id>/`. That is the only signal the page gets, and it exists ONLY on the
 *  launch navigation: a reload inside the same tab loses it. So the verdict is written to
 *  `sessionStorage`, which survives a reload in that tab and dies with it.
 *
 *  `localStorage` would be wrong, and wrong in the bad direction. The TWA and Chrome share
 *  `localStorage` on purpose (see `docs/decisions.md`), so a flag written there by the app would
 *  mark the browser as "the app" for ever, and the gate would never show on the web.
 *
 *  A start URL tail (`?source=twa`) was rejected instead: `start_url` is permanent and pinned.
 * ===========================================================================
 *
 * An unreadable storage reads as `web`, never as `play`: the failure that matters is the browser
 * being let through, and an app that cannot read its own tab storage still carries the referrer on
 * its launch navigation.
 */

/** The application id, also pinned against `android/twa-manifest.json` in `launcher.test.ts`. */
export const PLAY_PACKAGE_ID = 'aleixrabassa.playlistjitster';

/** The Play Store listing the gate links to. */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE_ID}`;

/** `sessionStorage` key holding the verdict for this tab. */
export const LAUNCHER_STORAGE_KEY = 'jitster:launcher:v1';

/**
 * The zero-based index of the first card a web player cannot reach: the second card.
 * Literal reading: a mid-game link landing on card 2 or later is gated at once.
 */
export const FIRST_GATED_CARD_INDEX = 1;

export type Launcher = 'play' | 'web';

const PLAY_REFERRER_PREFIX = `android-app://${PLAY_PACKAGE_ID}`;

/** `play` iff the referrer names this package exactly -- a look-alike host is `web`. */
export function launcherFromReferrer(referrer: string): Launcher {
  return referrer === PLAY_REFERRER_PREFIX || referrer.startsWith(`${PLAY_REFERRER_PREFIX}/`)
    ? 'play'
    : 'web';
}

/**
 * The launcher for this tab: the referrer if it says `play` (and remember it), else whatever this
 * tab remembered, else `web`. Every storage access is guarded.
 */
export function resolveLauncher({
  referrer,
  storage,
}: {
  referrer: string;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
}): Launcher {
  if (launcherFromReferrer(referrer) === 'play') {
    try {
      storage?.setItem(LAUNCHER_STORAGE_KEY, 'play');
    } catch {
      // Not remembered: a reload in this tab will read as `web`.
    }
    return 'play';
  }

  try {
    return storage?.getItem(LAUNCHER_STORAGE_KEY) === 'play' ? 'play' : 'web';
  } catch {
    return 'web';
  }
}

/**
 * Is the game closed to this player at this card? Derived, never stored. `devMode` (the hidden
 * triple-click toggle, `dev-mode.ts`) lifts the gate; it is its own input, never a faked `'play'`
 * launcher.
 */
export function isPlayGated({
  currentIndex,
  launcher,
  devMode,
}: {
  currentIndex: number;
  launcher: Launcher;
  devMode: boolean;
}): boolean {
  return launcher === 'web' && !devMode && currentIndex >= FIRST_GATED_CARD_INDEX;
}
