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
  name: 'Playlist Hitster',

  /**
   * Seven characters, and the length is the whole point of the field: `short_name` is
   * what a home-screen launcher has room for under an icon, and a label that overflows
   * is truncated with an ellipsis rather than wrapped. "Playlist Hitster" would not fit.
   */
  short_name: 'Hitster',

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
   * `standalone`, not `fullscreen`. The game is a card at arm's length on a phone and a
   * player needs the clock and the battery; `fullscreen` also removes the status bar that
   * `theme_color` colours, which would make that field pointless.
   *
   * No `orientation` field, deliberately (open question 4, decided 2026-08-06). Phase 7's
   * `--card-height: clamp(18rem, min(62dvh, 124vw), 28rem)` exists precisely so a short
   * wide viewport gets a smaller card instead of an overflowing one, so landscape is a
   * supported layout rather than a tolerated one -- and locking it would override a player
   * who rotated their phone on purpose.
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
   * Four entries from three files, and each one is load-bearing:
   *
   * - **192 and 512, `purpose: 'any'`** — the pair an installability check requires. 512 is
   *   also what Android scales the splash-screen image from.
   * - **512 `purpose: 'maskable'`** — a SEPARATE file, not the same one relabelled. Android
   *   crops a maskable icon to whatever shape the launcher uses, so the artwork is drawn at
   *   84% of the canvas with the rest as background: its content radius is 204.9px against a
   *   204.8px safe radius (the 80% safe circle). Relabelling the full-bleed 512 would get its
   *   edges cropped on every round-icon launcher.
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
