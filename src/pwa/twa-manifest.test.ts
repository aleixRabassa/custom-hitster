/**
 * A `node` test — this repo's default environment (`toolchain.md` §5). It reads one file
 * from disk and compares it with an imported module; there is no DOM, no build and no
 * Android toolchain involved, and there is deliberately no per-file environment docblock.
 * (As in `src/pwa/assetlinks.test.ts`, this header refers to that tag descriptively and
 * never writes it out: Vitest scans a file's leading comment for it and does not care
 * whether what it finds is a directive or a sentence about one.)
 *
 * ===========================================================================
 *  WHAT THIS FILE IS FOR: THE SHELL AND THE SITE ARE TWO DESCRIPTIONS OF ONE
 *  APP, AND NOTHING ELSE COMPARES THEM.
 *
 *  `android/twa-manifest.json` is Bubblewrap's record of the Trusted Web
 *  Activity: the origin it opens, the id it installs under, the name on the
 *  launcher, the colours behind the splash. `src/pwa/manifest.ts` is the web
 *  app manifest those values came from. They were reconciled ONCE, by hand,
 *  at the `bubblewrap init` prompts on 2026-09-20 -- and after that nothing
 *  keeps them together. This file is what notices when they drift.
 *
 *  Every failure it defends against has the same shape, which is why the
 *  tests are worth their weight: the build stays green, the app still
 *  installs, still launches and still works, and the damage shows up on a
 *  device -- as an address bar across the top, as a second app on the home
 *  screen instead of an update, or as a permission prompt the privacy policy
 *  says the app does not need.
 *
 *  WHY THAT FILE IS TRACKED AT ALL, when everything around it is not.
 *  `bubblewrap update` deletes and regenerates the rest of `android/` from
 *  this one file plus re-fetched icons (`DELETE_PROJECT_FILE_LIST`; the
 *  `.gitignore` block says so). So it is the whole reproducible description
 *  of a release, and it is also the SECOND home of the application id -- the
 *  first being `public/.well-known/assetlinks.json`.
 *
 *  WHAT THIS FILE CANNOT DO, the same ceiling as `assetlinks.test.ts`: it
 *  cannot tell you the shell was built from this manifest, that the APK
 *  installed, that Android verified the link, or that the URL bar is gone.
 *  Those are a device and a Play Console -- steps 7 and 12 of
 *  `docs/plans/plan.play-store-todo.md`.
 * ===========================================================================
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PAGE_COLOR, manifest } from './manifest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/**
 * The application id, DECIDED 2026-09-19 and permanent after the first publish. The same
 * literal is pinned in `assetlinks.test.ts`, deliberately duplicated rather than shared:
 * two independent copies are what make a drift between the two files visible. The
 * cross-file assertion that joins them lives in `assetlinks.test.ts` (2026-09-23).
 */
const PACKAGE_ID = 'aleixrabassa.playlistjitster';

/**
 * The production origin's host, pinned by `plan.google-play-shell.md` and permanent --
 * `manifest.id` resolves against the origin, so the origin sits inside the app's identity.
 */
const PRODUCTION_HOST = 'playlistjitster.vercel.app';

/**
 * The orientation values that LOCK the app to one axis. Asserting the absence of these,
 * rather than the presence of `default`, is deliberate: the property worth defending is
 * that the shell does not impose a rotation the web app never asked for, and `default`,
 * `any` and `natural` all satisfy it. Pinning the exact string would turn a harmless
 * future `any` into a red test while catching nothing extra.
 */
const LOCKING_ORIENTATIONS = [
  'portrait',
  'portrait-primary',
  'portrait-secondary',
  'landscape',
  'landscape-primary',
  'landscape-secondary',
];

interface TwaManifest {
  packageId?: unknown;
  host?: unknown;
  name?: unknown;
  launcherName?: unknown;
  startUrl?: unknown;
  themeColor?: unknown;
  backgroundColor?: unknown;
  orientation?: unknown;
  enableNotifications?: unknown;
}

function readTwaManifest(): TwaManifest {
  const raw = readFileSync(join(repoRoot, 'android', 'twa-manifest.json'), 'utf8');

  return JSON.parse(raw) as TwaManifest;
}

/**
 * Hex colours are compared case-insensitively on purpose. Bubblewrap echoed the value back
 * as `#0A0A0A` where `manifest.ts` holds `#0a0a0a`; they are the same colour, Android
 * parses both, and a test that failed on the difference would be reporting nothing.
 */
function sameColour(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
}

describe('the TWA shell manifest', () => {
  it('should bind the shell to the pinned production host', () => {
    // A per-deployment Vercel URL or the old `custom-hitster.vercel.app` alias here is the
    // most expensive silent failure available: the alias 307-redirects to this host, and a
    // TWA whose origin redirects has left the verified origin -- which is an address bar.
    expect(readTwaManifest().host).toBe(PRODUCTION_HOST);
  });

  it('should start at the root, like the web manifest', () => {
    // `start_url` and `id` are both `/`, and `id` DEFAULTS to `start_url` in the spec --
    // so a deep link or a `?utm_source=` tail added here would move the app's store
    // identity as a side effect and install a second app instead of an update.
    expect(readTwaManifest().startUrl).toBe(manifest.start_url);
  });

  it('should carry the same name, short name and colours as the web manifest', () => {
    const twa = readTwaManifest();

    expect(twa.name).toBe(manifest.name);

    // Bubblewrap calls it `launcherName`, not `shortName`. Same field, same twelve-character
    // launcher constraint that made "Playlist Jitster" unusable there.
    expect(twa.launcherName).toBe(manifest.short_name);

    // ===================================================================
    //  THE PAGE COLOUR NOW LIVES IN FOUR PLACES AND NONE DERIVES FROM
    //  ANOTHER: `--color-page` in `src/index.css` is the definition,
    //  `index.html`'s `theme-color` is a hand-kept copy, `PAGE_COLOR` is
    //  the third (a manifest is JSON generated at build time), and this is
    //  the fourth -- typed at a Bubblewrap prompt into a file no build step
    //  reads. Only the last two can be pinned against each other, so they
    //  are.
    // ===================================================================
    expect(sameColour(twa.themeColor, PAGE_COLOR)).toBe(true);
    expect(sameColour(twa.backgroundColor, PAGE_COLOR)).toBe(true);
  });

  it('should not lock the orientation', () => {
    // `bubblewrap init` asks for an orientation outright, which is exactly the pressure
    // that puts a lock here. The web manifest declares none, `manifest.test.ts` pins that
    // absence, and it cannot see this file.
    expect(LOCKING_ORIENTATIONS).not.toContain(readTwaManifest().orientation);
  });

  it('should decline notification delegation', () => {
    // ===================================================================
    //  THIS ONE CAUGHT A REAL DEFECT ON THE DAY IT WAS WRITTEN.
    //
    //  Bubblewrap 1.25.0 NEVER ASKS about notification delegation at
    //  `init` -- the plan expected a prompt and there is none -- and the
    //  field defaults to TRUE. The generated `AndroidManifest.xml` then
    //  carries `POST_NOTIFICATIONS`, so the app asks Android 13+ users for
    //  a notification permission it never uses, while `public/privacy.html`
    //  enumerates what leaves the device and mentions none.
    //
    //  Flipped by hand on 2026-09-20 and regenerated with `bubblewrap
    //  update`. Check the field after every future `init` and `update`,
    //  because nothing prompts for it.
    // ===================================================================
    expect(readTwaManifest().enableNotifications).toBe(false);
  });

  it('should name the committed package id', () => {
    // The default Bubblewrap proposed was `app.vercel.playlistjitster`, which reverses the
    // origin's host and puts the app under a namespace the developer does not own. It was
    // typed over at the prompt; this is what keeps it typed over.
    expect(readTwaManifest().packageId).toBe(PACKAGE_ID);
  });
});
