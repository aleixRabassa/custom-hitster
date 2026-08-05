# Toolchain

Several decisions in this repo look like mistakes and are not. This file records why, so nobody "cleans them up." Verified state as of 2026-08-03: `pnpm typecheck`, `pnpm lint`, `pnpm test` (3/3), and `pnpm build` all pass.

---

## 1. The two TypeScript installs — do not delete either one

`package.json` contains two TypeScript entries. **This is intentional. Neither is a leftover, and removing either breaks something.**

```json
"typescript": "6.0.3",                    // ← what typescript-eslint loads
"typescript-7": "npm:typescript@7.0.2"    // ← what actually compiles this project
```

| Entry                                   | Version | Purpose                                                            |
| --------------------------------------- | ------- | ------------------------------------------------------------------ |
| `typescript`                            | 6.0.3   | **Only** so `typescript-eslint` can run. Nothing compiles with it. |
| `typescript-7` (`npm:typescript@7.0.2`) | 7.0.2   | The actual project compiler. All `typecheck` scripts use it.       |

**Why both are required:** `typescript-eslint` declares a peer range of `>=4.8.4 <6.1.0` and loads `typescript` by **bare specifier**, so it resolves whatever occupies `node_modules/typescript`. Given 7.x it does not degrade — it **throws at module load** (`"typescript-eslint does not support TS 7.0"`) and ESLint silently lints nothing.

Rules that follow:

- **Do not delete either entry.** One is not a leftover of the other.
- **Do not flip the direction.** 6.x must be the plain `typescript` entry; 7.x must be the alias. Aliasing 6 would put 7 back in the linter's load path and reintroduce the throw.
- **Never call bare `tsc` in a script.** Both packages ship a `tsc` binary, so `node_modules/.bin/tsc` is a real collision and pnpm does not document which package wins it. Scripts invoke compilers by explicit path (`node node_modules/typescript-7/bin/tsc …`). Relying on the bin slot would make typechecking silently depend on install order.
- **`pnpm tsc:versions` prints both** so you can check rather than assume. Expect `6.0.3` then `7.0.2`.
- **A new TypeScript-aware dev tool will resolve to the 6.0.3 copy**, not 7. Nothing in the current dependency set is affected — Vite and Vitest transpile via esbuild/Rolldown and never load the `typescript` package — but think about it before adding one.
- **`pnpm install` must report no `typescript-eslint` peer warning.** One would mean the arrangement is wired backwards. The only expected warning is `Unsupported engine` from the deliberate Node pin (§4).

### Editor setup

TypeScript 7 is the **native Go port** and ships **no `tsserver.js`** anywhere — its `lib/` holds only `getExePath.js`, `tsc.js`, and `version.cjs`, and the `tsc` bin execs a platform binary. `typescript.tsdk` requires a directory containing `tsserver.js`, so pointing it at TS 7 makes VS Code show an error and **silently fall back to its own bundled TypeScript** — the exact failure it would be set to prevent.

So `.vscode/settings.json` (committed) does two things:

- `typescript.experimental.useTsgo: true` activates the native TS 7 language server, supplied by the **`TypeScriptTeam.native-preview`** extension recommended in `.vscode/extensions.json`.
- `typescript.tsdk` points at the repo's TypeScript **6.0.3** as a fallback, so a contributor without that extension gets the repo's own pinned version rather than an arbitrary bundled one. `useTsgo` wins when the extension is present, so the two do not conflict.

If the fallback is what's active, **your editor diagnostics are TS 6 and may differ from `pnpm typecheck`.** The scripts are the source of truth. Note also that the extension supplies its own native build, so editor TS 7 and the pinned CLI 7.0.2 can drift by patch.

### This whole arrangement is temporary

`typescript-eslint` is tracking TypeScript 7 support (targeting TS ≥ 7.1; their issue 10940). When it lands, the cleanup is **one commit**: drop the `typescript` 6.0.3 entry, promote the alias to plain `typescript`, simplify the scripts back to bare `tsc`, and delete the `typescript.tsdk` editor setting.

---

## 2. TypeScript configs — no project references, ever

Four configs, and the root one is load-bearing in a non-obvious way:

| File                 | Read by                                                | Purpose                                                                                                                        |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `tsconfig.json`      | **Vercel** (to compile `api/`) + the editor's fallback | A real config with real `compilerOptions`. Permissive: carries both DOM and Node types so `src/` and `api/` are both editable. |
| `tsconfig.app.json`  | `pnpm typecheck:app` only                              | `src/` + `shared/`, DOM libs, Vite client types.                                                                               |
| `tsconfig.api.json`  | `pnpm typecheck:api` only                              | `api/` + `shared/`, Node types, **no DOM lib**.                                                                                |
| `tsconfig.node.json` | explicit invocation / editor                           | `vite.config.ts` and other build-time files. Not wired into `pnpm typecheck`.                                                  |

**Hard rules:**

- **`tsconfig.json` must stay a real config and must never become a solution file** (`{"files": [], "references": [...]}`). Vercel reads it to compile `api/`, and project references are unsupported — a references-only root leaves the function build with **no compiler options at all**, and **the failure appears only at deploy time**.

  This is the single most reversion-prone decision in the repo: the Vite `react-ts` template ships exactly the forbidden shape, and most tutorials show it too. Note that a naive grep for `references` gives a **false positive** here, because the file's own warning comment contains the word.

- **No `references` and no `composite` anywhere in the repo.** Likewise `build` must never become `tsc -b && vite build`. This is why `build` and `typecheck` are separate scripts — `pnpm build` does **not** typecheck.
- **The DOM-vs-Node boundary is enforced by `pnpm typecheck` running twice**, once per narrowed config — not by the root. A single-config typecheck would exit green while missing a whole tree. Proven by probe: a `document.title` reference in `api/hello.ts` fails `typecheck:api` with `TS2584` while `typecheck:app` still passes, because `api/` is outside its `include`.
- **New files must land in the right project.** A file under `api/` is only checked by `typecheck:api`; a file under `src/` only by `typecheck:app`. `shared/` is checked by both, which is the point.
- **TypeScript 7 removed `baseUrl`** (`TS5102`) and rejects non-relative `paths` targets (`TS5090`). Path mappings are written as `"@/*": ["./src/*"]` with **no `baseUrl`**. Don't paste a TS 6-era tsconfig snippet in.

Notable strictness flags in the root config, inherited by all three others: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`.

---

## 3. Linting and formatting

**ESLint flat config, split by directory** (`eslint.config.js`):

| Files               | Gets                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `**/*.{ts,tsx}`     | `js.configs.recommended` + `tseslint.configs.recommended`            |
| `src/**/*.{ts,tsx}` | Browser globals + React Hooks rules                                  |
| `api/**/*.ts`       | Node globals                                                         |
| `*.config.{ts,js}`  | Node globals                                                         |
| `shared/**`         | **Neither** — so nothing environment-specific leaks into shared code |

- `eslint-config-prettier` is chained **last** so formatting rules never fight Prettier.
- The React Hooks flat configs live at **`reactHooks.configs.flat['recommended-latest']`**. The top-level `configs['recommended-latest']` is still eslintrc-shaped in v7 and ESLint 10 rejects it outright (`"A config object has a 'plugins' key defined as an array of strings"`).
- Ignored: `dist/`, `coverage/`, `.vercel/`, `node_modules/`.
- **What the `globals` blocks actually buy is less than it looks:** `typescript-eslint`'s recommended config **disables `no-undef`** for TypeScript files, since TypeScript does that job better. The per-directory globals are belt-and-braces; the genuine DOM-vs-Node gate is `pnpm typecheck:api` (§2).

**Prettier owns formatting.** Don't hand-format and don't add stylistic ESLint rules. Settings (`.prettierrc`): single quotes, semicolons, trailing commas everywhere, `printWidth: 100`, 2-space tabs, always-parenthesised arrow params, LF line endings.

---

## 4. Package manager and Node version

- **pnpm is the only supported package manager.** The version is pinned in `packageManager` (`pnpm@10.29.2`), which is also what tells Vercel to use pnpm instead of defaulting to npm. Do not add `package-lock.json` or `yarn.lock`. `pnpm-lock.yaml` is committed and must stay committed so Vercel installs the same tree.
- **`engines.node` is `24.x` and deliberately does not match local Node.** Vercel Functions offer only majors 24 (default) / 22 / 20 — and only majors. Odd-numbered Node releases (25, 27, …) are "Current" lines that never become LTS and are not on Vercel's menu. **Do not update this to match your machine.**
- **`.node-version` mirrors it** (`24`) so `fnm`/`nvm`-style managers pick 24 locally, making one pin effective on both sides.
- A local Node newer than 24 produces an `Unsupported engine` warning on install — **expected and harmless**. The one real consequence is that `vercel dev` executes functions on your local Node while production runs 24. Negligible for `api/` code that only does `fetch`, JSON parsing, and rate limiting, but worth remembering before reaching for a brand-new Node API. Installing Node 24 LTS locally closes the gap and silences the warning.

---

## 5. Build, styling, and tests

- **Vite 8** with `@vitejs/plugin-react` and `@tailwindcss/vite`. The `@/` alias is declared in `vite.config.ts` mirroring `tsconfig.json`, and is for `src/` only.
- **Tailwind CSS v4, CSS-first.** There is **no `tailwind.config.js`** and one should not be added just to exist. The single `@import 'tailwindcss'` in `src/index.css` is the entry point — it replaces the v3 `@tailwind base/components/utilities` trio. **The design surface is the `@theme static` block in that same file**, which is where a v3 reader would expect the config: every colour, dimension, duration and interaction minimum in the app is named there, and components consume tokens rather than literals. Shape and reasoning in [`architecture.md`](./architecture.md) §3; the four things that make it work are below.

### Tailwind v4 — four behaviours that bite

- **`@theme static`, not `@theme`.** A plain `@theme` emits only the variables some generated utility references. Tokens consumed through an arbitrary-value utility (`h-(--card-height)`), through an `@utility` composite, or from inside a media query do not count as a use, so they get tree-shaken and resolve to nothing. `static` emits all of them. Check the built CSS rather than assuming: `grep -o -- '--card-height:[^;]*' dist/assets/*.css`.
- **An unknown colour utility is a SILENT no-op, and no local check catches it.** `text-text-muted` against a theme that defines `--color-fg-muted` emits **no rule at all** — not a warning, not a build error. It shipped once during Phase 7: the only text on the card's hidden face lost its colour and rendered in the UA's near-black default on a near-black card, while `typecheck`, `lint`, `build` and every existing test stayed green. There is nothing in the toolchain that will tell you; the mitigation is a class-name assertion in the component's test (`CardHiddenSide.test.tsx` has one) and reading the built CSS when adding a token.
- **Two `@utility` composites exist, and variants compose with them.** `focus-ring` and `touch-target` are declared once in `src/index.css` and used as `focus-visible:focus-ring` — Tailwind applies its variants to a custom utility exactly as to a built-in one. That is what lets thirteen interactive elements share one definition and one assertable class name.
- **Tailwind scans prose, including markdown, and generates CSS from it.** Automatic content detection covers every non-gitignored file, and the extractor takes any candidate-shaped token — so a utility name written in a sentence emits a real rule. Measured on the Phase 6 baseline: **1.72 kB of the stylesheet, ~10%, came from `AGENTS.md` and `docs/`** and was referenced by no component. Ordinary English words that happen to be utilities ("transition", "transform", "visible", "hidden", "block", "static", "table", "inline", "grow", "shrink") contribute too. A one-line `@source not "../**/*.md";` reclaims it; it is deliberately not applied yet — bundle size belongs to [`plans/plan.phase-7-robustness.md`](./plans/plan.phase-7-robustness.md), and this repo's comments are worth more than the kilobyte. Detail in [`agent_findings.md`](./agent_findings.md).
- **Vitest config lives in the `test` key of `vite.config.ts`**, not a separate `vitest.config.ts`. Split it out only if the app and test configs later need to diverge.
- **The DEFAULT test environment is `node`**; include pattern is `{src,shared,api}/**/*.{test,spec}.{ts,tsx}`. See below for how a test opts into a DOM.

### The DOM test environment — opt-in per file

Phase 4 added three devDependencies, and nothing else: **`jsdom`** (30.0.1), **`@testing-library/react`** (16.3.2), and **`@testing-library/user-event`** (14.6.3). `user-event` has no importer yet — it is there for Phase 5's pointer sequences, which is the one thing raw `fireEvent` handles badly.

A test that needs a DOM opts in with a docblock as the **first thing in the file**:

```ts
/**
 * @vitest-environment jsdom
 */
```

Verified honoured under Vitest 4.1.10 on 2026-08-05 with a throwaway probe (the fallback, a two-project `test.projects` config, proved unnecessary and was not added).

**Never write that tag in prose — a sentence saying a file is _not_ a jsdom test will make it one.** Vitest finds the environment by scanning the file's leading comment for the tag and does not care whether what it finds is a directive or a description of one. `src/index.css.test.ts` shipped with a header reading "a `node` test, with no `@vitest-environment jsdom` docblock" and ran in **jsdom** because of it (`typeof window` was `object`; measured 2026-08-05). A rewrite that merely _quoted_ the old wording did not fix it either — the token has to be absent, so refer to the tag descriptively. The cost here was three seconds of wasted boot, but the mechanism matters more than this instance: the `node` default is what makes a DOM API accidentally added to `shared/` fail, and a comment is enough to defeat it.

Two consequences for reading the suite: `grep -rl` for the tag over-reports the jsdom file count, and the honest way to check one file is the `environment` timing in `--reporter=verbose` (`0ms` for node, seconds for jsdom).

**The `node` default is deliberate and should not be globalised to jsdom.** It is half of what keeps `shared/` portable: that tree is compiled into Vercel Functions, so a `document` or `window` reference in it must fail. Under a global jsdom it would pass quietly and only break at deploy time, which is the failure mode this repo works hardest to avoid.

Three consequences worth knowing before writing a component test:

- **`@testing-library/jest-dom` was deliberately not added**, so **no `setupFiles` entry exists** and the `setup` column in Vitest's output is always `0ms`. Its matchers are convenience; `queryBy*` results and plain element properties (`.disabled`, `.getAttribute(…)`) assert the same things. If you find yourself wanting `toBeInTheDocument()`, `expect(queryByText(…)).not.toBeNull()` is the house style.
- **Testing Library does not clean up between tests here.** Its automatic `afterEach(cleanup)` registers only when Vitest's `globals` are enabled, and this repo imports `describe`/`it`/`expect` from `vitest` explicitly — so **every DOM test file needs its own `afterEach(cleanup)`**. Without it each render accumulates in `document.body` and the next test queries a DOM containing all its predecessors; the symptom ("found multiple elements with the role img") reads as a component bug.
- **State-changing calls must be wrapped in `act()`.** React 19 does not flush an update made outside `act()` before the test's next line, so a value read straight afterwards is the previous render's.

**jsdom implements no media playback.** `HTMLMediaElement.play()` and `.pause()` exist as stubs that log `Not implemented: HTMLMediaElement.prototype.play` and do nothing, so audio tests stub both on the **prototype** (`vi.spyOn(HTMLMediaElement.prototype, 'play')`). An unstubbed call is console noise plus a test that never becomes "playing" — not a clean failure. jsdom also has no `<canvas>`, which is why `qrcode` is mocked rather than exercised for real.

**DOM tests are visibly slower**: booting jsdom costs several seconds of `environment` time per file, against ~0 ms for a node file. The whole suite still runs in well under a minute.

---

## 6. No hooks, no CI

There are **no pre-commit hooks and no CI workflow** — a deliberate lean-tooling choice — so the checks are yours to run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass before you commit. Add hooks or CI later if wanted; nothing in the current setup would need rework.
