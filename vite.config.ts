import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/*
  An EXPLICIT `.ts` extension, and it is required rather than tidy: Vite's native config
  loader (planned to become the default) rejects an extensionless relative import and warns
  on every build without it. `.ts` rather than the `.js` form AGENTS.md mandates for `api/`,
  because the two rules have opposite causes -- `api/`'s `.js` specifiers exist so Node's ESM
  resolver can find a file it will never transpile, whereas this specifier is resolved by
  Vite's own TypeScript-aware loader and never reaches Node. `allowImportingTsExtensions` is
  already on in the root tsconfig.

  This module is imported ONLY here, so it is not in the client bundle.
*/
import { manifest } from './src/pwa/manifest.ts';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    /*
      ===========================================================================
       THE SERVICE WORKER. Phase 8 plan 1, steps 9 and 12.

       `generateSW`, which is the default mode: workbox writes the whole worker
       from the config below and there is no custom worker source to maintain.
       `injectManifest` would be the choice if the worker needed logic of its own,
       and it does not -- everything interesting here is a decision NOT to cache.

       The manifest is imported rather than written inline so its
       installability-critical fields can be asserted in a node test. See
       `src/pwa/manifest.ts`.
      ===========================================================================
    */
    VitePWA({
      /*
        THE UPDATE STRATEGY, and it is the waiting default rather than `autoUpdate`.

        `registerType: 'prompt'` means a new worker installs and then WAITS until
        every tab of the app is closed before it activates. `autoUpdate` calls
        `skipWaiting` and takes over immediately, and that is a real failure here
        rather than a preference: this app code-splits `GameScreen` and the `qrcode`
        chunk behind dynamic imports, so a worker that activates mid-game after a
        redeploy leaves the running tab asking for a chunk hash that no longer
        exists. The player advances one card and the app breaks.

        The cost is a delayed update. The benefit is a session that cannot break
        underneath itself, and there is no prompt UI wired up -- `prompt` without a
        caller is exactly "wait quietly", which is the behaviour wanted.
      */
      registerType: 'prompt',

      manifest,

      /*
        NO `includeAssets`, and that is a correction rather than an oversight.

        `includeAssets` exists for files in `public/` that `globPatterns` does not
        match. The glob below matches `png` and `webp`, and `public/` is copied to the
        root of the build output, so every icon is already covered -- listing them
        again put FIVE DUPLICATE ENTRIES in the precache manifest (both 512s, the 192,
        the favicon and the apple-touch-icon). Their revisions were identical, so
        workbox deduplicated them rather than throwing
        `add-to-cache-list-conflicting-entries` -- which is precisely why this was
        worth removing rather than leaving: it was invisible, and it would have become
        a build-time throw the moment the two paths disagreed about a revision.
      */
      workbox: {
        /*
          Precache the BUILD OUTPUT and nothing else. `js`/`css`/`html` cover the
          app and every code-split chunk; the image and font extensions cover the
          icons.

          The code-split chunks (`GameScreen`, `qrcode-loader`, and the jspdf/
          html2canvas chunks the PDF export pulls in) are hashed build output, so
          they land here too -- which is deliberate and worth stating, because a
          chunk that is FETCHED lazily and PRECACHED eagerly looks like a
          contradiction. It is not: lazy loading is about what the landing screen
          must download before it paints, and precaching is about what is available
          with the network off. Step 12 verifies they are actually listed rather
          than assuming it.
        */
        globPatterns: ['**/*.{js,css,html,webp,png,svg,woff2}'],

        /*
          The three manifest icons, and ONLY those three, because the plugin puts every
          icon named in the manifest into the precache list itself. Leaving them to the
          glob as well listed each one twice. `apple-touch-icon.png` is deliberately NOT
          ignored -- it is referenced from `index.html` rather than from the manifest, so
          the glob is the only thing that precaches it.
        */
        globIgnores: ['pwa-*.png'],

        /*
          ===========================================================================
           NO RUNTIME CACHING FOR `/api/playlist` OR `/api/year`. THIS IS A
           DECISION, NOT AN OMISSION -- do not "complete" it by adding one.

           A cached `/api/playlist` response deals a deck that no longer matches the
           real playlist: an editorial playlist refreshes its tracks, and the player
           would get yesterday's deck with no way to tell. And `/api/year`'s
           freshness story is the Upstash cache on the SERVER side, which has its own
           TTL and is shared between players; a second, unmanaged copy sitting in one
           browser is not an extension of that design, it is a hole in it.

           So offline means: the shell loads, and a SAVED SESSION stays playable
           minus audio and minus further year lookups. Pressing Start offline
           produces Phase 7's `offline` error copy, which already refuses a request
           that cannot succeed and says so in its own sentence -- so this composes
           with work that exists rather than needing anything new.
          ===========================================================================
        */
        runtimeCaching: [],

        /*
          The SPA fallback must never be served in place of a function response. Without
          this denylist, an offline (or merely failed) `/api/year` request would resolve
          with `index.html` and a 200, and the year client would try to parse a page of
          HTML as JSON -- which surfaces as `unexpected-payload`, the single most
          confusing error this app can show, because it is the same code `pnpm dev`
          produces for a completely different reason.
        */
        navigateFallbackDenylist: [/^\/api\//],
      },

      /*
        `devOptions` is deliberately absent, so no worker is served by `pnpm dev` OR by
        `npx vercel dev`. A service worker in development is a caching-bug generator, and
        this repo's dev story is delicate enough already -- `pnpm dev` cannot run the
        functions at all (see `docs/development.md` §4), and a worker caching that
        failure would make the difference between the two dev servers even harder to see.
      */
    }),
  ],
  resolve: {
    alias: {
      // Mirrors the `paths` entry in tsconfig.json. Usable from `src/` ONLY --
      // Vercel does not support path mappings when it compiles `api/`, so
      // functions must import `shared/` by relative path. See AGENTS.md.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Vitest reads its config from this key, so no separate vitest.config.ts exists.
  // Split it out only if the app and test configs later need to diverge.
  test: {
    // `node` is the DEFAULT, not the only environment. jsdom and Testing Library
    // arrived in Phase 4, and a test that needs a DOM opts in PER FILE with a
    //
    //   /** @vitest-environment jsdom */
    //
    // docblock as the first thing in the file (verified honoured under Vitest 4.1
    // on 2026-08-05; `test.projects` was the fallback and proved unnecessary).
    //
    // Keeping node as the default is deliberate: it is what makes a DOM API
    // accidentally added to `shared/` -- which must stay portable to `api/` --
    // fail a test run instead of passing quietly. Do not globalise jsdom here.
    environment: 'node',
    include: ['{src,shared,api}/**/*.{test,spec}.{ts,tsx}'],
  },
});
