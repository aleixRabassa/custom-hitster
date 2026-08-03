import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config, deliberately split by directory so each tree gets only the globals
 * it actually has at runtime:
 *
 *   src/     -> browser globals + React Hooks rules
 *   api/     -> Node globals (serverless functions)
 *   shared/  -> NEITHER, so nothing DOM- or Node-specific can leak into code that
 *               both sides import
 *
 * Note this linter runs on TypeScript **6.0.3** (`node_modules/typescript`), not the
 * 7.0.2 the project compiles with -- `typescript-eslint` loads `typescript` by bare
 * specifier and throws outright on 7.x. See AGENTS.md before touching either entry.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', '.vercel/**', 'node_modules/**'],
  },

  // --- Baseline for all TypeScript in the repo -------------------------------
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },

  // --- Browser: the React app ------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    // NOTE: must be `configs.flat[...]`. The top-level `configs['recommended-latest']`
    // is still eslintrc-shaped in v7 and ESLint 10 rejects it ("plugins" as an array).
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // --- Node: the Vercel serverless functions ---------------------------------
  {
    files: ['api/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // --- Node: build-time config files ----------------------------------------
  {
    files: ['*.config.{ts,js}', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // `shared/` intentionally has no globals block: it is imported by both sides,
  // so DOM and Node globals must both be undefined there.

  // Must stay LAST so formatting-related rules never fight Prettier.
  prettier,
);
