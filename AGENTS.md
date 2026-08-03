# AGENTS.md — repo conventions

Conventions for anyone (human or agent) working in this repo. Read this before adding files or changing configuration; several decisions here look like mistakes and are not.

The authoritative source for _what_ belongs in which phase is [`docs/plans/plan.md`](./docs/plans/plan.md), with per-phase detail in `docs/plans/plan.<phase>.md`. Don't build ahead of the current phase — the plan deliberately defers things.

---

## 1. Layout: which tree may import what

```
src/      React SPA (browser).       May use the `@/` alias. May use DOM APIs.
api/      Vercel Functions (Node).   MUST import shared/ by RELATIVE path. No DOM APIs.
shared/   Used by BOTH.              No DOM APIs, no Node APIs. Pure, portable code.
```

- **`shared/` sits at the repository root, not under `src/`.** This keeps the boundary symmetrical: neither side reaches into the other's tree, and both reference `shared/` by plain relative path.
- **`api/` must never import via the `@/` alias.** Vercel's Node runtime documentation states that of the root `tsconfig.json`, _"Most options are supported aside from Path Mappings and Project References."_ An aliased import inside a function type-checks locally and then **fails to resolve at deploy time**. Use `../shared/…`. `api/hello.ts` is the reference shape — copy it.
- The `@/` alias is declared in `tsconfig.json` and mirrored in `vite.config.ts`. It is for `src/` only. Vite resolves it at bundle time, which is why the client side is unaffected by Vercel's limitation.
- Grep for `@/` under `api/` before deploying. This asymmetry is the one part of the layout that cannot be fully verified without a real deploy.

## 2. The two TypeScript installs — do not "clean up" either one

`package.json` contains two TypeScript entries and this is intentional:

| Entry                                   | Version | Purpose                                                            |
| --------------------------------------- | ------- | ------------------------------------------------------------------ |
| `typescript`                            | 6.0.3   | **Only** so `typescript-eslint` can run. Nothing compiles with it. |
| `typescript-7` (`npm:typescript@7.0.2`) | 7.0.2   | The actual project compiler. All `typecheck` scripts use it.       |

Why both are required: `typescript-eslint` declares a peer range of `>=4.8.4 <6.1.0` and loads `typescript` by **bare specifier**, so it resolves whatever occupies `node_modules/typescript`. On 7.x it does not degrade — it **throws at module load** and ESLint silently lints nothing.

Rules that follow from this:

- **Do not delete either entry.** One is not a leftover of the other.
- **Do not flip the direction.** 6.x must be the plain `typescript` entry; 7.x must be the alias. Aliasing 6 would put 7 back in the linter's load path and reintroduce the throw.
- **Never call bare `tsc` in a script.** Both packages ship a `tsc` binary, so `node_modules/.bin/tsc` is a real collision and pnpm does not document which package wins it. Scripts invoke compilers by explicit path (`node node_modules/typescript-7/bin/tsc …`). `pnpm tsc:versions` prints both so you can check rather than assume.
- **Adding a new TypeScript-aware dev tool?** It will resolve to the **6.0.3** copy, not 7. Nothing in the current dependency set is affected (Vite and Vitest transpile via esbuild/Rolldown and never load the `typescript` package), but think about it before adding one.
- **Editor:** TypeScript 7 is the native Go port and ships **no `tsserver.js`**, so `typescript.tsdk` cannot point at it — doing so makes VS Code error and fall back to its own bundled TypeScript. TS 7 IntelliSense comes from the `TypeScriptTeam.native-preview` extension via `typescript.experimental.useTsgo`; `typescript.tsdk` intentionally points at the **6.0.3** copy as a fallback for contributors without that extension. Both settings are committed in `.vscode/`.

This whole arrangement is temporary — `typescript-eslint` is tracking TS ≥ 7.1 support. Removing it is a single commit; see README.

## 3. TypeScript configs — no project references, ever

Four configs, and the root one is load-bearing in a non-obvious way:

| File                 | Read by                                                | Purpose                                                                                                                        |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `tsconfig.json`      | **Vercel** (to compile `api/`) + the editor's fallback | A real config with real `compilerOptions`. Permissive: carries both DOM and Node types so `src/` and `api/` are both editable. |
| `tsconfig.app.json`  | `pnpm typecheck:app` only                              | `src/` + `shared/`, DOM libs, Vite client types.                                                                               |
| `tsconfig.api.json`  | `pnpm typecheck:api` only                              | `api/` + `shared/`, Node types, **no DOM lib**.                                                                                |
| `tsconfig.node.json` | explicit invocation / editor                           | `vite.config.ts` and other build-time files.                                                                                   |

**Hard rules:**

- **`tsconfig.json` must stay a real config and must never become a solution file** (`{"files": [], "references": [...]}`). Vercel reads it to compile `api/`, and project references are unsupported — a references-only root leaves the function build with no compiler options, and **the failure appears only at deploy time**. This is the single most reversion-prone decision in the repo: the Vite `react-ts` template ships exactly the forbidden shape, and most tutorials show it too.
- **No `references` and no `composite` anywhere in the repo.** Likewise `build` must never become `tsc -b && vite build`.
- The DOM-vs-Node boundary is enforced by `pnpm typecheck` running **twice**, once per narrowed config — not by the root. A single-config typecheck would exit green while missing a whole tree.
- **New files must land in the right project.** A file under `api/` is only checked by `typecheck:api`; a file under `src/` only by `typecheck:app`. `shared/` is checked by both, which is the point.
- **TypeScript 7 removed `baseUrl`** (`TS5102`) and rejects non-relative `paths` targets (`TS5090`). Path mappings are written as `"@/*": ["./src/*"]` with no `baseUrl`. Don't paste a TS 6-era tsconfig snippet in.

## 4. Tooling

- **pnpm is the only supported package manager.** The version is pinned in `packageManager`, which is also what tells Vercel to use pnpm instead of defaulting to npm. Do not add `package-lock.json` or `yarn.lock`. `pnpm-lock.yaml` is committed and must stay committed so Vercel installs the same tree.
- **`engines.node` is `24.x` and deliberately does not match local Node.** Vercel Functions offer only majors 24 / 22 / 20. Odd-numbered Node releases (25, 27, …) are "Current" lines that never become LTS and are not on Vercel's menu. **Do not update this to match your machine.** `.node-version` mirrors it so `fnm`/`nvm`-style managers pick 24 locally. A local Node newer than 24 produces an `Unsupported engine` warning on install — expected and harmless.
- **ESLint flat config, split by directory:** `src/` gets browser globals plus React Hooks rules, `api/` gets Node globals, `shared/` gets **neither** so nothing environment-specific leaks into shared code. `eslint-config-prettier` is chained last. Note the React Hooks flat configs live at `reactHooks.configs.flat[…]`; the top-level `configs[…]` are still eslintrc-shaped and ESLint 10 rejects them.
- **Prettier owns formatting.** Don't hand-format or add stylistic ESLint rules.
- **Tailwind CSS v4, CSS-first.** There is no `tailwind.config.js` and one should not be added just to exist. The single `@import 'tailwindcss'` in `src/index.css` is the entry point; design tokens (`@theme`) are Phase 7 work.
- **Vitest config lives in the `test` key of `vite.config.ts`**, not a separate `vitest.config.ts`. Environment is `node`; `jsdom` and Testing Library are intentionally absent until the first component test in Phase 4.

## 5. No Spotify credentials

There are none in this repo and none are needed — not in `.env.example`, not in Vercel. Spotify's February 2026 API changes mean no credentialed path can serve "anyone with a public link", so the app reads the public embed endpoint anonymously. If you are about to add a `SPOTIFY_CLIENT_ID`, read `docs/plans/plan.md` §2 first: the constraint is a product decision, not an oversight.

## 6. Before you commit

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass. There are no pre-commit hooks and no CI workflow — this is a deliberate lean-tooling choice, so the checks are yours to run.
