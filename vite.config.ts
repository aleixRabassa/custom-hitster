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
    // Node environment only. `jsdom` and Testing Library are deliberately NOT
    // installed yet -- this phase's tests are pure logic. The first component
    // test arrives in Phase 4, which is when a DOM environment should be added.
    environment: 'node',
    include: ['{src,shared,api}/**/*.{test,spec}.{ts,tsx}'],
  },
});
