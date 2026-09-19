/**
 * A `node` test — this repo's default environment (`toolchain.md` §5). It imports a plain
 * object and reads one file as text; there is no DOM, no build and no worker involved,
 * and there is deliberately no per-file environment docblock. (As in
 * `src/index.css.test.ts`, this header refers to that tag descriptively and never writes
 * it out: Vitest scans a file's leading comment for it and does not care whether what it
 * finds is a directive or a sentence about one.)
 *
 * ===========================================================================
 *  WHAT THIS FILE IS FOR, AND WHAT IT CANNOT DO.
 *
 *  It cannot tell you the app is installable. Installability is a browser
 *  judgement made against a served manifest over HTTPS with a registered
 *  service worker, and nothing in this repo can stand in for it -- the real
 *  check is manual and is a row in `docs/development.md` §5.
 *
 *  What it CAN do is pin the fields whose absence makes that judgement fail,
 *  which is the whole reason the manifest is a module instead of a literal
 *  inside `vite.config.ts`. A missing `start_url` or a manifest with only a
 *  192px icon fails silently: the build succeeds, the page works, and the
 *  install prompt simply never appears with nothing anywhere saying why.
 * ===========================================================================
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PAGE_COLOR, manifest } from './manifest';

const here = dirname(fileURLToPath(import.meta.url));

describe('the web app manifest', () => {
  it('should declare the fields an installability check requires', () => {
    // A name of some kind, and BOTH are asserted because they serve different surfaces:
    // `name` is the install dialog and `short_name` is the label under the icon.
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();

    // A launcher truncates rather than wraps, so an over-long `short_name` is a silent
    // cosmetic failure on exactly the surface this whole plan is about.
    expect((manifest.short_name ?? '').length).toBeLessThanOrEqual(12);

    expect(manifest.start_url).toBe('/');

    // `browser` is the one value that makes an installed app not feel installed, and it
    // is also the default a partial manifest falls back to -- so this asserts the value
    // rather than merely that the field is set.
    expect(manifest.display).toBe('standalone');

    // The 192/512 pair. Chrome requires at least one icon of 192px or larger AND one of
    // 512px or larger; a manifest with only a 192 is the common way to fail this.
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');

    // Every icon must say what it is. A `src` with no `type` still installs, but a
    // missing `src` is the failure this catches.
    for (const icon of manifest.icons ?? []) {
      expect(icon.src).toMatch(/^\/[\w.-]+\.png$/);
      expect(icon.type).toBe('image/png');
    }
  });

  it('should declare a maskable icon that is a separate file from the full-bleed 512', () => {
    // ===================================================================
    //  THE ASSERTION THAT STOPS THE OBVIOUS SHORTCUT.
    //
    //  A maskable icon is cropped by the launcher to whatever shape the
    //  platform uses, so its artwork has to sit inside a safe circle of
    //  80% of the canvas. Declaring `purpose: 'any maskable'` on the
    //  full-bleed 512 -- or pointing the maskable entry at the same file --
    //  satisfies every validator and gets the artwork's edges cropped off
    //  on every round-icon Android launcher.
    //
    //  So this checks both halves: that a maskable entry exists, and that
    //  it is a DIFFERENT `src` from the `any` 512.
    // ===================================================================
    const icons = manifest.icons ?? [];

    const maskable = icons.filter((icon) => icon.purpose === 'maskable');
    expect(maskable).toHaveLength(1);
    expect(maskable[0]?.sizes).toBe('512x512');

    const fullBleed512 = icons.find((icon) => icon.sizes === '512x512' && icon.purpose === 'any');
    expect(fullBleed512).toBeDefined();
    expect(maskable[0]?.src).not.toBe(fullBleed512?.src);

    // And no entry hedges with the combined purpose, which is the other way to end up
    // with one cropped file doing two jobs.
    for (const icon of icons) {
      expect(icon.purpose).not.toBe('any maskable');
    }
  });

  it('should declare the fields Bubblewrap and the store read', () => {
    // These four are not installability fields -- a PWA installs without any of them -- so the
    // failure they guard against is a PACKAGING one, which happens on somebody's machine weeks
    // later and reports nothing back here. `bubblewrap init` prompts for a language and a
    // direction, and Play seeds the default listing language from the manifest; a missing value
    // means whoever runs the tool answers from memory, and a wrong answer is a listing in the
    // wrong language rather than an error.
    expect(manifest.id).toBe('/');
    expect(manifest.lang).toBe('en');
    expect(manifest.dir).toBe('ltr');

    // `games` first and `music` with it: the app is a game whose material is music. The values are
    // asserted rather than just the field's presence, because an unregistered category string is
    // ignored silently and reads exactly like a declared one from in here.
    expect(manifest.categories).toContain('games');
    expect(manifest.categories).toContain('music');
  });

  it('should keep id equal to start_url', () => {
    // ===================================================================
    //  THE STORE-IDENTITY INVARIANT, AND NOTHING ELSE IN THE TOOLCHAIN
    //  WOULD REPORT ITS VIOLATION.
    //
    //  `id` is what an app store and a browser use to decide whether an
    //  install is an UPDATE to something already there or a new thing. The
    //  spec defaults it to `start_url`, which is why it was implicit here
    //  for so long -- and why a future edit to `start_url` (a deep link, a
    //  tracking tail on the listing's URL) would have moved it silently.
    //
    //  A moved `id` does not fail a build, fail an install, or warn: the
    //  next Play release installs a SECOND app beside the first, and the
    //  installed PWA gets a second home-screen entry. So the equality is
    //  asserted here, where a diff can see it.
    //
    //  Both sides are also pinned to `/` so the test still fails if the two
    //  drift together to something that is not the root -- an equal pair
    //  pointing at a deep link is a different bug, not a passing one.
    // ===================================================================
    expect(manifest.id).toBe(manifest.start_url);
    expect(manifest.start_url).toBe('/');
  });

  it('should not declare an orientation', () => {
    // ===================================================================
    //  AN ASSERTION ABOUT AN ABSENCE, WHICH IS THE ONLY WAY THIS DECISION
    //  SURVIVES CONTACT WITH A PACKAGING TOOL.
    //
    //  No `orientation` is deliberate: `--card-height`'s clamp exists so a
    //  short wide viewport gets a SMALLER card rather than an overflowing
    //  one, which makes landscape a supported layout, and locking rotation
    //  would override a player who turned their phone on purpose.
    //
    //  The pressure that undoes it comes from outside this repo:
    //  `bubblewrap init` asks for an orientation interactively, and the
    //  obvious way to stop a tool asking is to answer it in the manifest.
    //  Adding it breaks nothing visible on a phone held upright, so nobody
    //  would find out.
    //
    //  `in` rather than `toBeUndefined()`, because `orientation: undefined`
    //  passes the second and is exactly what a half-applied edit leaves
    //  behind -- and it is a key a JSON serialiser drops today and a future
    //  plugin version might not.
    // ===================================================================
    expect('orientation' in manifest).toBe(false);
  });

  it('should point theme_color and background_color at the page colour', () => {
    expect(manifest.theme_color).toBe(PAGE_COLOR);
    // The same value, so a launcher's splash screen does not flash a different shade
    // before the first paint.
    expect(manifest.background_color).toBe(PAGE_COLOR);
  });

  it('should keep PAGE_COLOR in step with the --color-page token', () => {
    // ===================================================================
    //  THE ONLY ONE OF THE THREE COPIES A TEST CAN HOLD, and this is what
    //  makes it worth having rather than self-referential.
    //
    //  The page colour exists in three places and none can derive from
    //  another: `--color-page` in `src/index.css` is the definition,
    //  `index.html`'s `theme-color` meta cannot hold a `var()`, and a
    //  manifest is build-time JSON with no access to a stylesheet.
    //
    //  Asserting `manifest.theme_color === PAGE_COLOR` alone would only
    //  prove the module agrees with itself. So this reads the STYLESHEET
    //  and pins the token's literal value: if `--color-page` ever moves,
    //  this fails and names the two other places that have to move with
    //  it. `#0a0a0a` is `oklch(14.5% 0 none)` converted to sRGB -- computed,
    //  and recorded in `docs/agent_findings.md`.
    // ===================================================================
    const stylesheet = readFileSync(join(here, '..', 'index.css'), 'utf8');

    const declaration = /--color-page:\s*([^;]+);/.exec(stylesheet);
    expect(declaration).not.toBeNull();

    expect(declaration?.[1]?.trim()).toBe('oklch(14.5% 0 none)');
    expect(PAGE_COLOR).toBe('#0a0a0a');
  });
});
