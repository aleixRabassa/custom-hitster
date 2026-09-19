/**
 * The web app manifest, as a plain typed module.
 *
 * ===========================================================================
 *  A MODULE RATHER THAN A LITERAL INSIDE `vite.config.ts`, AND THE REASON IS
 *  THE SAME ONE BEHIND EVERY OTHER SPLIT IN THIS REPO.
 *
 *  The fields an installability check actually requires -- a name, a
 *  `start_url`, a `display`, and icons at 192 and 512 -- are a FACT worth
 *  asserting, and a literal buried in a plugin call cannot be imported by a
 *  test. This is `src/game/gestures.ts` and `src/game/pdf-sheet.ts` again:
 *  the decision is a value over plain data, the binding is somewhere else, and
 *  the half that can be checked is checked. `manifest.test.ts` is a node test
 *  with no DOM and no build involved.
 *
 *  It lives in `src/` but is NEVER imported by the app -- only by
 *  `vite.config.ts` -- so it is not in the client bundle. The `import type`
 *  below erases, so importing a devDependency's types here adds no runtime
 *  dependency on `vite-plugin-pwa` either.
 * ===========================================================================
 *
 * ## `theme_color` is the THIRD copy of the page colour
 *
 * `--color-page` in `src/index.css` is the definition. `index.html`'s
 * `<meta name="theme-color">` is the second copy, and it exists because a `meta`
 * content attribute cannot hold a `var()`. This is the third, and it exists for the
 * same reason one level further out: a manifest is JSON, generated at build time,
 * with no access to a stylesheet's custom properties.
 *
 * **None of the three can derive from either of the others**, which is why the
 * duplication is documented rather than removed. What CAN be done is pin it, and
 * `manifest.test.ts` does: it asserts this value against the literal recorded here
 * as the page colour, so the two cannot drift silently. The remaining unpinnable gap
 * is `index.html`, whose value is checked by hand (Phase 8 plan 1, step 7 -- and
 * verified there by converting `oklch(14.5% 0 none)` to `#0a0a0a` rather than by
 * assuming it).
 */

import type { ManifestOptions } from 'vite-plugin-pwa';

/**
 * `--color-page`, `oklch(14.5% 0 none)`, converted to sRGB.
 *
 * Exported so the test can assert against it rather than repeating the literal, which
 * would only prove the file agrees with itself. **If `--color-page` ever moves, three
 * places change**: the token, `index.html`'s `theme-color`, and this constant.
 */
export const PAGE_COLOR = '#0a0a0a';

/**
 * The manifest.
 *
 * `Partial<ManifestOptions>` is the type `vite-plugin-pwa` accepts, and the partiality
 * is real -- the plugin fills in defaults for everything not named here.
 */
export const manifest: Partial<ManifestOptions> = {
  /**
   * Renamed from "Playlist Hitster" on 2026-08-11 at the developer's request.
   *
   * A pure STRING change with no install consequence worth fearing: an installed PWA picks up a
   * changed `name`/`short_name` when the manifest is re-fetched, and the icons, `start_url`, scope
   * and `id` are untouched — so this is the same installed app under a
   * new label rather than a second entry on the home screen. (`id` was implicit when this was
   * written, defaulting to `start_url`; it is written out below as of 2026-09-19, which changes the
   * wording here and nothing about the argument.) What it does NOT touch is anything
   * persisted: `hitster:session:v1` and `hitster:library:v1` keep their names deliberately, because
   * renaming a storage key silently empties a player's saved game and curated library.
   */
  name: 'Playlist Jitster',

  /**
   * Seven characters, and the length is the whole point of the field: `short_name` is
   * what a home-screen launcher has room for under an icon, and a label that overflows
   * is truncated with an ellipsis rather than wrapped. "Playlist Jitster" would not fit.
   */
  short_name: 'Jitster',

  description:
    'Deal a deck of cards from any public Spotify playlist, scan a card to hear the song, then guess the year it came out.',

  /**
   * The root, and it must stay the root even though a shared deck link carries a query
   * string: `start_url` is where the INSTALLED app opens, which is a fresh start rather
   * than somebody else's deck. `App.tsx` reads the link from `location` at runtime, so
   * a link opened from a browser still works -- it simply is not what launching the
   * installed icon does.
   */
  start_url: '/',

  /**
   * THE STORE'S IDENTITY FOR THIS APP, written out rather than left implicit — and writing it
   * changes nothing today, which is the point.
   *
   * The spec already defaults `id` to `start_url`, so this line is the value the browser has been
   * computing all along. What it buys is a FAILURE: `manifest.test.ts` asserts the two are equal, so
   * a future edit to `start_url` (the obvious one being a deep link, or a `?utm_source=` tail for the
   * store listing) has to decide about `id` explicitly instead of moving it as a side effect.
   *
   * The consequence of moving it silently is the one nothing else in the toolchain would report: a
   * changed `id` is a DIFFERENT application, so a Play update installs a second entry beside the
   * first rather than replacing it, and the installed PWA does the same on the home screen. There is
   * no build error, no install failure, and no warning anywhere — just two apps.
   */
  id: '/',

  /**
   * `standalone`, not `fullscreen`. The game is a card at arm's length on a phone and a
   * player needs the clock and the battery; `fullscreen` also removes the status bar that
   * `theme_color` colours, which would make that field pointless.
   *
   * No `orientation` field, deliberately (open question 4, decided 2026-08-06). Phase 7's
   * `--card-height` clamp -- `clamp(15rem, min(62dvh, 80vw), 24rem)` since the card became
   * square -- exists precisely so a short
   * wide viewport gets a smaller card instead of an overflowing one, so landscape is a
   * supported layout rather than a tolerated one -- and locking it would override a player
   * who rotated their phone on purpose.
   *
   * **That absence is PINNED BY A TEST as of 2026-09-19** (`should not declare an orientation`),
   * because it stopped being a thing only a reader could undo. `bubblewrap init` ASKS for an
   * orientation as one of its interactive prompts, and the natural way to make a packaging tool stop
   * asking is to answer the manifest instead — so the pressure arrives from outside this repo, at a
   * keyboard, from somebody who is not thinking about the card clamp. Answer that prompt with the
   * any/default option; do not resolve it here. The test asserts the KEY is absent, not merely
   * undefined, so `orientation: undefined` fails too.
   */
  display: 'standalone',

  /**
   * The colour a launcher paints BEFORE the app has rendered, and the colour of the status
   * bar once it has. Both are the page colour, so there is no flash of a different shade
   * between the splash screen and the first paint.
   */
  background_color: PAGE_COLOR,
  theme_color: PAGE_COLOR,

  /**
   * The listing's language, and the two halves are NOT in the same state today.
   *
   * `lang` is already in the built `manifest.webmanifest` — `vite-plugin-pwa` carries `lang: 'en'` in
   * its own default manifest (verified 2026-09-19 by reading the plugin's defaults and the built
   * output, not by trusting the `@default` tag), so writing it out pins a value the plugin happens to
   * supply. `dir` is genuinely new: the plugin emits nothing, and a reader falls back to the spec's
   * `auto`.
   *
   * Both are here because `bubblewrap init` prompts for them and Play seeds the default LISTING
   * language from what the manifest says. Every player-visible string in the app is English — the
   * whole copy surface is `src/game/copy.ts` and it is English end to end — so an app that let the
   * store guess would be guessing at a fact this repo already knows. `ltr` follows from that; it is
   * not a claim about what a translation would need, and translating the app means changing both.
   */
  lang: 'en',
  dir: 'ltr',

  /**
   * Both, in that order, because the app is a GAME whose content is music rather than a music app.
   * Play and the other catalogues that read a manifest use these to place a listing, and the pair is
   * the honest description: the thing a player does is guess, and the material they guess about is
   * their own playlist. Lowercase, from the W3C's registered category list — an unrecognised string
   * is silently ignored, so an invented category is the same as no category at all.
   */
  categories: ['games', 'music'],

  /**
   * Four entries from three files, and each one is load-bearing:
   *
   * - **192 and 512, `purpose: 'any'`** — the pair an installability check requires. 512 is
   *   also what Android scales the splash-screen image from.
   * - **512 `purpose: 'maskable'`** — a SEPARATE file, not the same one relabelled. Android
   *   crops a maskable icon to whatever shape the launcher uses, so the artwork is drawn at
   *   **72%** of the canvas with the rest as background — re-measured on 2026-08-12, when new
   *   artwork replaced the old: its bloom reaches 109.4% of the half-edge, so its content radius
   *   is 200.5px against a 204.8px safe radius (the 80% safe circle). Relabelling the full-bleed
   *   512 would get its edges cropped on every round-icon launcher.
   *
   * PNG throughout, not the WebP the favicon uses: manifest icon support for WebP is not
   * universal, and iOS ignores the manifest's icons entirely in favour of the
   * `apple-touch-icon` link in `index.html` — which is why that fourth 180×180 file exists
   * outside this list.
   */
  icons: [
    { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: '/pwa-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};
