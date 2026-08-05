import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
