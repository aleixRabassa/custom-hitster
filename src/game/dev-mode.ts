/**
 * The hidden developer mode (2026-10-19): a triple click or tap on the logo turns it on, another
 * turns it off. While it is on, the web Play gate (`isPlayGated` in `launcher.ts`) is lifted, so the
 * developer can play past card 2 in a browser.
 *
 * Pure and framework-free, built like `prefs.ts`: an injected `StorageLike`, every access guarded,
 * so every branch is a node test; `App.tsx` is the only file that touches the real storage for it.
 *
 * ## `localStorage`, on purpose (the opposite of `launcher.ts`)
 *
 * The flag is the developer's, and it should survive new tabs and later visits on their device.
 * The TWA shares `localStorage` with the browser, which is harmless here: inside the Play app the
 * gate is already off, so a flag read there changes nothing.
 *
 * ## The click sequence is counted by hand, never from `event.detail`
 *
 * `detail` is the browser's own click count and is not dependable for touch input, so the sequence
 * is a count plus the time of the last click, decided by `registerLogoClick`.
 */

import type { StorageLike } from './persistence';

/** `localStorage` key. A new key under the `jitster:` prefix; only the exact literal `'on'` counts. */
export const DEV_MODE_STORAGE_KEY = 'jitster:devmode:v1';

const ON_VALUE = 'on';

/** Clicks on the logo that flip the mode. */
export const LOGO_CLICKS_TO_TOGGLE = 3;

/** The longest gap between two consecutive clicks that still counts as one sequence. */
export const LOGO_CLICK_WINDOW_MS = 500;

/** Is developer mode remembered as on? Anything but the exact literal, or a throwing storage, is off. */
export function loadDevMode(storage: StorageLike): boolean {
  try {
    return storage.getItem(DEV_MODE_STORAGE_KEY) === ON_VALUE;
  } catch {
    return false;
  }
}

/** Remembers the mode: `'on'` when on, the key removed when off. A throwing storage loses it silently. */
export function saveDevMode(storage: StorageLike, on: boolean): void {
  try {
    if (on) storage.setItem(DEV_MODE_STORAGE_KEY, ON_VALUE);
    else storage.removeItem(DEV_MODE_STORAGE_KEY);
  } catch {
    // Not remembered: the mode still applies for this page load.
  }
}

export interface LogoClickSequence {
  readonly count: number;
  readonly lastAtMs: number;
}

/**
 * Registers one click. The sequence restarts when the gap since the previous click exceeds the
 * window; the click that reaches `LOGO_CLICKS_TO_TOGGLE` triggers and resets the sequence to null.
 */
export function registerLogoClick(
  previous: LogoClickSequence | null,
  nowMs: number,
): { sequence: LogoClickSequence | null; triggered: boolean } {
  const continues = previous !== null && nowMs - previous.lastAtMs <= LOGO_CLICK_WINDOW_MS;
  const count = continues ? previous.count + 1 : 1;

  if (count >= LOGO_CLICKS_TO_TOGGLE) return { sequence: null, triggered: true };

  return { sequence: { count, lastAtMs: nowMs }, triggered: false };
}
