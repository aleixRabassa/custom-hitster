# Plan: phase-1 — Project Skeleton

> **Task:** phase-1
> **Date:** 2026-08-03
> **Author:** Aleix Rabassa
> **Source:** [plan.md](./plan.md) §5 — Phase 1 (Project Skeleton)

---

## Overview

Stand up the empty repository as a working Vite + React 19 + TypeScript single-page app with Tailwind CSS v4, Motion, and `qrcode` installed; wire up ESLint, Prettier, Vitest, and a Vercel-ready serverless function directory. The repo today contains only `plan.md` and the mockup PNG — there is no `package.json`, no source tree, and no toolchain. This phase produces the scaffold that Phases 2–7 build inside, and ends with a repo where `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all succeed and a hello-world function exists under `api/` ready for a manual Vercel deploy.

No game logic, no playlist fetching, no year resolution, and no card UI are in scope — those are Phases 2–4. The deliverable is infrastructure only.

---

## Dependency Contract

### Requires from earlier work

Nothing. Phase 0 produced research findings recorded in `plan.md` only — no code artifacts exist to consume.

### Produces for downstream plans

| Output                                                                                                                                   | Consumed by                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `package.json` scripts + locked dependency set                                                                                           | All later phases                                                       |
| `api/` directory recognised as Vercel Node functions, with `api/hello.ts` as the working reference shape                                 | Phase 2 (`/api/playlist`, `/api/year`)                                 |
| `shared/` directory importable from both `src/` and `api/`, with both tsconfigs including it                                             | Phase 2 (`Card` type, typed error unions), Phase 3 (`GameState` types) |
| `shared/constants.ts` carrying `MAX_EMBED_TRACKS` (100, from the Phase 0 finding)                                                        | Phase 2 (truncation warning), Phase 6 (warning banner copy)            |
| `tsconfig.api.json` (Node types) vs `tsconfig.app.json` (DOM types) typecheck split, layered over a Vercel-readable root `tsconfig.json` | Phase 2 onward — determines where new files must be listed             |
| Vitest configuration and the first passing test                                                                                          | Phase 2 (URL parsing, year resolution), Phase 3 (shuffle, reducer)     |
| Tailwind v4 CSS-first entry point (`src/index.css`)                                                                                      | Phase 4 (card styling), Phase 7 (design tokens)                        |
| `vercel.json` with SPA fallback rewrite that excludes `/api/*`                                                                           | Phase 6 (screens), manual deploy                                       |

---

## Scope & Affected Areas

| Area                         | Type     | Notes                                                                                                                                                                                                         |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`               | New      | Deps, scripts, `packageManager: pnpm@10.29.2`, `engines.node` pinned to a Vercel-supported LTS major                                                                                                          |
| `pnpm-lock.yaml`             | New      | Generated; must be committed so Vercel installs the same tree                                                                                                                                                 |
| `index.html`                 | New      | From the Vite `react-ts` scaffold; set the document title and language                                                                                                                                        |
| `vite.config.ts`             | New      | React plugin, Tailwind v4 plugin, `@/` alias for `src/`, Vitest `test` block                                                                                                                                  |
| `tsconfig.json`              | New      | The config **Vercel reads** when building `api/`. A real config with `compilerOptions`, **not** a solution file — project references are unsupported by Vercel. Covers `src/`, `api/`, `shared/`              |
| `tsconfig.app.json`          | New      | Typecheck-only: extends the root, narrows to `src/` + `shared/` with DOM libs. Never read by Vercel                                                                                                           |
| `tsconfig.api.json`          | New      | Typecheck-only: extends the root, narrows to `api/` + `shared/` with no DOM lib. Never read by Vercel                                                                                                         |
| `tsconfig.node.json`         | New      | Covers `vite.config.ts` and other build-time config files                                                                                                                                                     |
| `.vscode/settings.json`      | New      | ~~Points `typescript.tsdk` at the aliased TypeScript 7 lib~~ → **superseded:** enables `typescript.experimental.useTsgo` for TS 7, with `tsdk` pointing at TS **6** as fallback (TS 7 ships no `tsserver.js`) |
| `.vscode/extensions.json`    | New      | Added during execution. Recommends `TypeScriptTeam.native-preview`, which is the only supported way to get TS 7 IntelliSense                                                                                  |
| `eslint.config.js`           | New      | Flat config; separate blocks for browser (`src/`) and Node (`api/`) globals                                                                                                                                   |
| `.prettierrc`                | New      | Formatting rules                                                                                                                                                                                              |
| `.prettierignore`            | New      | Exclude `dist/`, `pnpm-lock.yaml`, `.vercel/`, the mockup PNG                                                                                                                                                 |
| `.gitignore`                 | New      | `node_modules/`, `dist/`, `.vercel/`, `.env*.local`, `coverage/`                                                                                                                                              |
| `.node-version`              | New      | Pins Node 24 for `fnm`/`nvm`-style managers, mirroring the `engines.node` value                                                                                                                               |
| `src/main.tsx`               | New      | React 19 root mount                                                                                                                                                                                           |
| `src/App.tsx`                | New      | Placeholder shell proving Tailwind classes render — **not** the landing page (Phase 6)                                                                                                                        |
| `src/index.css`              | New      | Single Tailwind v4 import; no `tailwind.config.js` needed in v4                                                                                                                                               |
| `src/vite-env.d.ts`          | New      | Vite client types, from scaffold                                                                                                                                                                              |
| `shared/constants.ts`        | New      | `MAX_EMBED_TRACKS = 100`; the one real value Phase 0 established                                                                                                                                              |
| `shared/constants.test.ts`   | New      | The phase's passing test                                                                                                                                                                                      |
| `api/hello.ts`               | New      | Hello-world Vercel Node function; reference shape for Phase 2 handlers                                                                                                                                        |
| `vercel.json`                | New      | Build command, output directory, SPA fallback rewrite excluding `/api/*`                                                                                                                                      |
| `.env.example`               | New      | Documented variable names, no values                                                                                                                                                                          |
| `README.md`                  | New      | Setup, scripts, env vars, deploy pointer, known limitations                                                                                                                                                   |
| `AGENTS.md`                  | New      | Repo conventions for future contributors and agent-assisted work                                                                                                                                              |
| `plan.md`                    | Modified | Tick the four Phase 1 checkboxes; annotate the Vercel one as config-only                                                                                                                                      |
| `docs/plans/plan.phase-1.md` | Modified | Tick steps as they complete                                                                                                                                                                                   |

---

## Chosen Approach

**Option A — Vite SPA at the repository root with a sibling `api/` folder of Vercel Node functions**, a single `package.json`, and a root-level `shared/` directory imported by both sides via relative paths. This is the stack `plan.md` §3 already committed to. It keeps the dependency tree minimal, gives instant HMR while tuning the flip and swipe animations by eye in Phases 4–5, and ships no framework machinery the game never uses. Its one real cost is a second TypeScript project for the Node-side functions (roughly fifteen lines of config) and needing `vercel dev` rather than the Vite dev server to exercise functions locally.

Chosen over **Option B (Next.js 15 App Router)** because Next's value — routing, SSR/RSC, streaming — is entirely unused by a one-screen client-side game whose whole state is `useReducer` plus localStorage. Adopting it would mean marking nearly every component written in Phases 3–5 as a client component, carrying a larger first-load framework payload on a critical path that already waits on a playlist fetch plus MusicBrainz lookups, and overriding a stack decision `plan.md` had justified — all to save one tsconfig during Phase 1 alone. Chosen over **Option C (pnpm workspaces monorepo)** because three endpoints do not need package boundaries; it front-loads wiring and a fiddlier Vercel configuration for no Phase 2 benefit.

`shared/` sits at the repository root rather than under `src/` so neither side imports "into" the other's tree, and both reference it by plain relative path — deliberately avoiding reliance on TypeScript path-alias resolution inside the function bundler, which is the fragile part of this layout.

---

## Implementation Steps

- [x] **Scaffold the Vite app at the repository root** — initialise with the Vite `react-ts` template using pnpm, targeting the existing directory so `plan.md`, the mockup PNG, and `.git` survive untouched. Verify nothing tracked was overwritten before continuing.
  - [x] Set `packageManager` to the pnpm version in use so Vercel selects pnpm at build time
  - [x] Set `engines.node` to `24.x` — Vercel's default and newest available function runtime. Do **not** mirror local Node 25.x, which is a non-LTS "Current" line Vercel does not offer (see decision 13).
  - [x] Set the app name and a private flag in `package.json`
  - [x] Trim the scaffold's demo content from `src/App.tsx` down to a minimal placeholder shell; delete the Vite/React demo assets and default CSS
  - [x] Set the document title and `lang` attribute in `index.html`

  > **Execution note:** scaffolded into a temp directory and copied in, rather than running
  > `create-vite` against the repo root, so the existing tracked files could not be clobbered.
  > Two deviations from the Vite 8 `react-ts` template, both required by decisions already in
  > this plan: (1) the template now ships **oxlint** and `.oxlintrc.json` instead of ESLint —
  > dropped, since ESLint + Prettier is decision 3; (2) the template's root `tsconfig.json` is a
  > **solution file** (`files: []` + `references`) — not copied, per decision 14. The template no
  > longer emits `src/vite-env.d.ts`; Vite client types now come from `"types": ["vite/client"]`
  > in the tsconfig, so that file is intentionally absent.

- [x] **Install TypeScript 7 side-by-side with TypeScript 6** — the project compiles with TypeScript 7 (latest); TypeScript 6 is present _only_ so `typescript-eslint` can run at all. Verified empirically during planning: `typescript-eslint` does a bare module load of `typescript` and **throws outright** on 7.x ("typescript-eslint does not support TS 7.0"), so ESLint lints nothing. The arrangement below was tested end to end and works.
  - [x] Declare `typescript` at 6.0.3 as a direct dev dependency — this is the copy `typescript-eslint` resolves, and it must be the _unaliased_ `typescript` entry because the load is a bare specifier. Aliasing 6 instead would not work.
  - [x] Declare TypeScript 7 under an alias (`typescript-7` mapping to `npm:typescript@7.0.2`) — this is the compiler used for real typechecking
  - [x] **Call both compilers by explicit path in `package.json` scripts, never as bare `tsc`.** Both packages ship a `tsc` binary, so `node_modules/.bin/tsc` is a genuine collision — in the probe install the alias won the slot and bare `tsc` reported 7.0.2, but which package wins is not documented and must not be relied on. The `typecheck` script must invoke the aliased TypeScript 7 binary directly.
  - [x] ~~Add `.vscode/settings.json` setting `typescript.tsdk` to the aliased TypeScript 7 `lib` directory~~ — **premise falsified during execution; see the correction below.** Intent (editor on TS 7) achieved by a different mechanism.
  - [x] Confirm `pnpm install` reports **no** unmet peer warnings for `typescript-eslint` — with root `typescript` at 6.0.3 the peer range is satisfied, so any warning here means the arrangement is wired wrong _(verified at the ESLint step, once `typescript-eslint` was actually installed)_
  - [x] Document the whole arrangement in `AGENTS.md` and `README.md` so neither TypeScript entry is "cleaned up" by someone who assumes one is a leftover

  > **Correction to decision 5c — `typescript.tsdk` cannot point at TypeScript 7.**
  > TypeScript 7.0.2 is the **native Go port**. Verified by inspecting the installed package: it
  > ships **no `tsserver.js` anywhere** (`lib/` holds only `getExePath.js`, `tsc.js`,
  > `version.cjs`; the `tsc` bin execs a platform binary from
  > `@typescript/typescript-win32-x64`). `typescript.tsdk` requires a directory containing
  > `tsserver.js`, so pointing it at TS 7 makes VS Code show an error and **silently fall back to
  > its own bundled TypeScript** — the exact failure mode decision 5c was written to prevent.
  > TS 6.0.3 does ship `lib/tsserver.js`.
  >
  > Replacement (developer-approved during execution): `.vscode/extensions.json` recommends
  > **`TypeScriptTeam.native-preview`**, and `.vscode/settings.json` sets
  > **`typescript.experimental.useTsgo: true`** to put the native TS 7 language server behind
  > IntelliSense, _plus_ `typescript.tsdk` → `node_modules/typescript/lib` (TS **6.0.3**) as a
  > deliberate fallback. The two do not conflict: `useTsgo` wins when the extension is present,
  > and the `tsdk` fallback means a contributor without the extension gets the repo's own pinned
  > 6.0.3 rather than an arbitrary bundled version. Caveat: the extension supplies its own native
  > build, so editor TS 7 and the pinned CLI 7.0.2 can drift by patch.
  >
  > Also note `pnpm tsc:versions`, added to satisfy the manual-verification requirement that both
  > compilers be checked explicitly rather than through the contested `node_modules/.bin/tsc`
  > slot. It reports 6.0.3 then 7.0.2.

- [x] **Install and wire Tailwind CSS v4** — add `tailwindcss` and `@tailwindcss/vite`, register the plugin in `vite.config.ts`, and replace `src/index.css` with the single v4 import. No `tailwind.config.js` is created: v4 is CSS-first and design tokens are a Phase 7 concern.
  - [x] Prove it works by styling the placeholder shell with a couple of utility classes and confirming they apply in the browser _(tailwindcss + @tailwindcss/vite 4.3.3; the emitted CSS bundle went 0.00 kB → 7.18 kB and `min-h-dvh`, `bg-neutral-950`, `tracking-tight`, `justify-center` are all present in `dist`, which distinguishes "plugin registered" from "package merely installed"; visually confirmed in the browser in the final verification pass)_
- [x] **Install the remaining runtime dependencies** — `motion` for gestures and deck animations (Phase 5), `qrcode` plus `@types/qrcode` for the hidden-side QR (Phase 4; the package ships no bundled types). Install them now so Phase 1 locks one coherent dependency tree, even though neither is imported yet.
- [x] **Set up the TypeScript configs without project references** — Vercel's Node runtime documentation states that of the root `tsconfig.json` options, _"Most options are supported aside from Path Mappings and Project References."_ Vercel reads the root `tsconfig.json` when compiling `api/`, so the Vite scaffold's default solution-style root (references only, no `compilerOptions`) must **not** be kept — it would leave Vercel with no usable compiler options for the functions, and the failure would only appear at deploy time.
  - [x] Make root `tsconfig.json` a real config with actual `compilerOptions`, strict mode on, `include` covering `src/`, `api/`, and `shared/`. This is the file Vercel reads and the file the editor falls back to. Do not add a `references` array; do not set `composite`.
  - [x] Add `tsconfig.app.json` and `tsconfig.api.json` as **typecheck-only** configs that each `extends` the root and narrow `include` and `lib` — app gets DOM libs and `src/` + `shared/`, api gets Node types, no DOM lib, and `api/` + `shared/`. `extends` is not on Vercel's unsupported list, and neither file is read by Vercel regardless.
  - [x] Add `tsconfig.node.json` covering `vite.config.ts` and other build-time config files
  - [x] Add a `typecheck` script that runs the aliased TypeScript 7 binary **twice**, once per narrowed config, rather than a `tsc -b` solution build. This preserves the DOM-versus-Node isolation at the point it matters (the gate that fails a bad import) while keeping project references out of the repo entirely. A single-config typecheck would silently skip one side.
  - [x] Keep the `@/` alias declared in root `tsconfig.json` and mirrored in `vite.config.ts`, used from `src/` only. Vite resolves it at bundle time, so Vercel's lack of path-mapping support does not apply — but this is the one remaining unverified interaction in the layout, so confirm on the first real deploy that no `api/` file has picked up an aliased import.

  > **TypeScript 7 removed `baseUrl`.** The first `pnpm typecheck` run failed with
  > `TS5102: Option 'baseUrl' has been removed` plus `TS5090: Non-relative paths are not allowed`.
  > The `@/` alias is therefore declared with no `baseUrl` and a **relative** target
  > (`"@/*": ["./src/*"]`). Worth knowing before Phase 2 copies any tsconfig snippet from a
  > TS 6-era tutorial.

- [x] **Create the `shared/` directory with `constants.ts`** — export `MAX_EMBED_TRACKS` set to 100, with a comment citing the Phase 0 finding that the embed endpoint caps at 100 tracks with no pagination signal. This is a real value Phase 2 consumes for the truncation warning, not filler.
- [x] **Configure ESLint flat config and Prettier** — one config file with distinct blocks: `src/` gets browser globals plus the React Hooks rules; `api/` gets Node globals; `shared/` gets neither DOM nor Node assumptions. Chain `eslint-config-prettier` last so formatting rules never conflict. Add `lint` and `format` scripts.
  - [x] Confirm a deliberate violation in `api/` is reported with Node globals recognised, then remove it — proves both blocks are actually active

  > **Both blocks probed, then the probes deleted.** `api/_lint-probe.ts` used `process.env`
  > alongside an unused const: the unused const was reported
  > (`@typescript-eslint/no-unused-vars`) and `process` was **not** flagged. `src/_lint-probe.tsx`
  > called `useState` conditionally and used `window`: the hook misuse was reported
  > (`react-hooks/rules-of-hooks`) and `window` was **not** flagged. Both files removed;
  > `pnpm lint` now exits 0.
  >
  > Caveat on what the `globals` blocks actually buy: `typescript-eslint`'s recommended config
  > **disables `no-undef`** for TypeScript files (TypeScript itself does that job better), so the
  > per-directory `globals` are largely belt-and-braces rather than the real enforcement. The
  > genuine DOM-vs-Node gate is `pnpm typecheck:api`, which was verified by probe — see the
  > verification-pass note below.
  >
  > Also: the React Hooks flat configs are at `reactHooks.configs.flat['recommended-latest']`.
  > The top-level `configs['recommended-latest']` is still eslintrc-shaped and ESLint 10 rejects
  > it outright ("A config object has a 'plugins' key defined as an array of strings").

- [x] **Configure Vitest** — put the `test` block inside `vite.config.ts` rather than adding a separate config file, defaulting to the Node environment. `jsdom` and Testing Library are **not** installed yet; the phase's tests are pure logic, matching `plan.md` §3's "Vitest for pure logic" note. Add `test` and watch-mode scripts.
- [x] **Write the first passing test** — cover `shared/constants.ts` (see Unit Tests below). Confirm the suite passes and that a test importing from `shared/` resolves correctly under the app tsconfig.
- [x] **Add the hello-world Vercel function at `api/hello.ts`** — typed with `@vercel/node`'s request/response types, returning a small JSON payload. Its purpose is to establish the handler signature, the import style, and the tsconfig membership that Phase 2's `/api/playlist` and `/api/year` will copy.
  - [x] Add a relative import of `MAX_EMBED_TRACKS` from `shared/` into the function and include it in the response, proving cross-directory imports type-check and bundle from the Node side before Phase 2 depends on it

  > Imports are written **extensionless** (`'../shared/constants'`) rather than with an explicit
  > `.ts`, matching the dominant Vercel convention, and `src/main.tsx` was normalised the same way
  > for consistency. Type-checks under `tsconfig.api.json`; the bundle half stays unproven until a
  > real deploy (decision 4).

- [x] **Add `vercel.json`** — declare the build command, the `dist` output directory, and a fallback rewrite sending unmatched paths to `index.html` so client routing works, while leaving `/api/*` unrewritten. Note that `vercel.json` must be strict JSON, so the rationale for the rewrite belongs in `README.md`, not in a comment.
- [x] **Add `.node-version` pinning Node 24** — mirrors the `engines.node` value so `fnm`/`nvm`-style managers select the same major locally that Vercel runs in production. One line; makes the pin effective on both sides.
- [x] **Add `.env.example`, `.gitignore`, and `.prettierignore`** — `.env.example` lists variable names with an explanatory comment line each and no values: the cache connection variables Phase 2 needs and the MusicBrainz `User-Agent` string. Explicitly note that **no Spotify credentials are required**, which is a direct consequence of the Phase 0 decision to use the public embed endpoint with no login.
- [x] **Write `README.md`** — see Documentation Updates for required content.
- [x] **Write `AGENTS.md`** — see Documentation Updates for required content.
- [x] **Run the full local verification pass** — clean install from the lockfile, then dev server, build, typecheck, lint, and test in sequence; all must pass. Confirm `dist/` is produced and gitignored.

  > **Results.** `node_modules/` and `dist/` deleted, then `pnpm install --frozen-lockfile`:
  > 334 packages, no peer-dependency errors, and **no `typescript-eslint` peer warning** — the
  > only warning is the expected `Unsupported engine` from the deliberate 24.x pin. Then
  > `typecheck` (both configs), `lint`, `test` (3/3), `build`, and `format:check` — all pass.
  >
  > Layout invariants checked mechanically, not by eye: root `tsconfig.json` parsed after
  > comment-stripping has top-level keys `compilerOptions, include` only — **no `references`, no
  > `files`, no `composite`** (a naive grep gives a false positive here, because the file's own
  > warning comment contains the word "references"); no `api/` file imports via `@/`; no `tsc -b`
  > in any script; no `tailwind.config.*`; `vercel.json` parses as strict JSON with source
  > `/((?!api/).*)`; `dist/` and `node_modules/` both git-ignored; and `dist/` contains only
  > `index.html` + two assets, with the `api/` handler absent from the client bundle.
  >
  > **DOM-vs-Node isolation proven by probe.** A `document.title` reference temporarily added to
  > `api/hello.ts` made `typecheck:api` fail with `TS2584: Cannot find name 'document'` while
  > `typecheck:app` still passed (`api/` is outside its `include`). That is the direct evidence
  > the plan asked for that the typecheck genuinely runs twice — a single-config gate would have
  > exited green. Probe reverted.
  >
  > **Dev server, and a correction to this plan's premise.** `pnpm dev` serves the shell with
  > `<title>Custom Hitster</title>`, `lang="en"`, and Tailwind utilities present in the served CSS
  > (8,924 bytes). But the plan and the README draft both assumed a request to `/api/hello` would
  > "fall through to the SPA" — **it does not.** Vite treats any file under the project root as a
  > transformable module, so `GET /api/hello` returns the **transpiled source** of `api/hello.ts`
  > as `text/javascript` with status `200`, inline sourcemap included. It neither runs the handler
  > nor serves `index.html`. Consequences now documented in the README: a `200` from the Vite dev
  > server is not evidence a function works, `fetch('/api/…')` in dev fails at JSON-parse rather
  > than 404, and `api/` source is readable over the dev server — so secrets belong in env vars,
  > never in that source.

- [x] **Update `plan.md`** — tick the four Phase 1 checkboxes, annotating the Vercel one to record that the configuration is committed but the linking and deploy are performed manually by the developer, so the checkbox is not silently overclaiming a verified deploy.

  > Done in `docs/plans/plan.md`. The Vercel checkbox is marked `[~]`, not `[x]`, since half of it
  > ("confirm a hello-world function deploys") is genuinely unverified.
  >
  > **Note:** `plan.md` and the mockup PNG were relocated from the repository root into
  > `docs/plans/` partway through execution, not by this plan's steps. Content is intact (the
  > mockup is byte-identical; `plan.md` differs only by Prettier's Markdown normalisation, with
  > every checkbox preserved). Adapted to: this file's `Source:` link now points at `./plan.md`,
  > `.prettierignore` targets the new mockup path, and README/AGENTS reference
  > `docs/plans/plan.md`.

---

## Unit Tests

Phase 1 introduces almost no logic by design, so this list is deliberately short — its purpose is proving the test harness genuinely works end to end, not manufacturing coverage. The substantive suites arrive in Phase 2.

- [x] `should expose MAX_EMBED_TRACKS as 100` — covers the exported constant in `shared/constants.ts`, asserting the Phase 0 embed cap is encoded correctly, in `shared/constants.test.ts`
- [x] `should type MAX_EMBED_TRACKS as a number` — covers that the constant is a usable numeric value rather than a string, guarding against a typo that would break Phase 2's length comparison, in `shared/constants.test.ts`
- [x] `should resolve imports from the shared directory inside a test` — covers the tsconfig/Vitest resolution wiring itself; if this fails, every later phase's tests fail for the same reason, in `shared/constants.test.ts`

All three pass (`pnpm test` → 1 file, 3 tests).

---

## Documentation Updates

- [x] `README.md` (new) — must contain: what the app is in two or three sentences; prerequisites (Node major, pnpm version); install and run instructions; a table of every `package.json` script and what it does; a short "Why there are two TypeScript versions" note aimed at a newcomer who opens `package.json` and assumes it is a mistake; how to run the serverless functions locally with `vercel dev` and why the plain Vite dev server cannot serve them; the environment variables and where to get their values; a deploy section stating the repo is deploy-ready and the developer performs linking and deployment manually; why the `vercel.json` rewrite must exclude `/api/*`; and a Known Limitations section carrying forward the Phase 0 findings — the 100-track embed cap with no pagination signal, and the note from `plan.md` §2 that the embed endpoint is unofficial and may change without notice.
- [x] `AGENTS.md` (new) — repo conventions for future contributors: the Vite-SPA-plus-`api/` layout and what belongs in `src/` vs `api/` vs `shared/`; the rule that `api/` imports `shared/` by relative path and must not rely on the `@/` alias; the two-tsconfig split and the requirement to add new files to the right project; **the two side-by-side TypeScript installs** — which entry is which, that the project compiles with 7 and 6 exists only to keep `typescript-eslint` running, that neither may be deleted as a supposed leftover, and that scripts must call compilers by explicit path because the `tsc` bin slot is contested; pnpm as the only supported package manager; that no Spotify credentials exist or are needed; and a pointer to `plan.md` as the source of phase scope.
- [x] `.env.example` (new) — each variable name preceded by a comment explaining its purpose and whether it is required for local development or production only. _(Cache variables use the **Upstash Redis** names — developer decision during execution; see Open Questions.)_
- [x] `plan.md` (modified) — tick the four Phase 1 checkboxes; annotate the Vercel checkbox with the config-only reality.
- [x] `docs/plans/plan.phase-1.md` (modified) — tick implementation steps as they are completed.
- [x] Inline comment in `shared/constants.ts` — cite the Phase 0 spike as the source of the 100 value so the number is never mistaken for an arbitrary choice.
- [x] Inline comment header in `tsconfig.json` — state that it must remain a real config with `compilerOptions` and must never become a solution file with `references`, because Vercel reads it to build `api/` and does not support project references. This is the single most reversion-prone decision in the phase: every Vite scaffold and most tutorials do the opposite.
- [x] Inline comment header in `tsconfig.api.json` — one or two lines stating that it exists for typechecking only (Node types instead of DOM types) and is never read by Vercel, since this is the least obvious part of the layout.
- [x] `AGENTS.md` — additionally record the `engines.node` 24.x pin and that it deliberately does not match local Node, so nobody "fixes" it to 25.x.
- [x] _Added beyond the plan:_ `.vscode/settings.json` and `.vscode/extensions.json` carry inline comments explaining why `typescript.tsdk` points at TypeScript **6** rather than 7, since that looks backwards without the explanation.

---

## Testing Strategy

- **Unit tests:** the three assertions above, covering the only exported value in the phase and validating that Vitest, TypeScript resolution, and the `shared/` directory work together.
- **Integration tests:** none in this phase. There is no logic to integrate — the hello-world function exists to establish a shape, not behaviour. Phase 2 introduces the first integration-worthy surface (`/api/playlist` against the embed adapter).
- **Manual verification:**
  - Clean install from the committed lockfile succeeds with no unresolved peer-dependency errors. Optional peers reported for the React plugin (`@rolldown/plugin-babel`, `babel-plugin-react-compiler`) are genuinely optional and need no action unless React Compiler is adopted later. There must be **no** `typescript-eslint` peer warning — one would mean the side-by-side TypeScript arrangement is wired backwards.
  - The two TypeScript installs resolve as intended: `node_modules/typescript` reports 6.0.3 and the aliased package reports 7.0.2. Check both explicitly rather than trusting bare `tsc`, whose bin slot is contested between them.
  - ESLint runs and reports findings. If it aborts with "typescript-eslint does not support TS 7.0", the root `typescript` entry is 7.x and must be corrected — this is a hard failure, not a warning, so a silent pass here is impossible.
  - The editor reports TypeScript 7 as its active version (VS Code's TypeScript version indicator), confirming the `typescript.tsdk` setting took effect rather than falling back to the side-by-side 6.
  - Dev server starts and serves the placeholder shell with Tailwind utility classes visibly applied — confirms the Tailwind v4 Vite plugin is registered, not merely installed.
  - Production build completes and emits `dist/`.
  - Typecheck passes for **both** the app and api configs — confirm it is genuinely running twice, since a script that silently checks only one side would still exit green.
  - Root `tsconfig.json` contains real `compilerOptions` and **no** `references` array. If the Vite scaffold left a solution-style root in place, the `api/` build breaks on Vercel and nothing locally will tell you.
  - No file under `api/` imports via the `@/` alias — grep for it before deploying, since this is the one layout interaction that cannot be verified without a real deploy.
  - Lint passes across `src/`, `api/`, and `shared/`.
  - Test suite passes.
  - Optionally, `vercel dev` serves `api/hello` and returns the expected JSON including the shared constant. This is the one check that requires the Vercel CLI; it is optional here because the developer owns deployment, but running it is the only way to catch a broken cross-directory import before the real deploy.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                                                                                                                                                                  | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Option A: Vite SPA at root plus sibling `api/` folder**, chosen over Option B (Next.js 15 App Router) and Option C (pnpm workspaces monorepo)                                                                                                                        | Matches the stack `plan.md` §3 committed to. The game is one screen with zero SSR benefit, so Next's router/RSC machinery would be permanent overhead — and would require marking nearly every Phase 3–5 component as client-only — in exchange for saving one tsconfig in Phase 1 only. A monorepo front-loads wiring and a fiddlier Vercel setup for three endpoints. Developer confirmed.                                                                                                                                                                                                                                                                                                         |
| 2   | **pnpm** as package manager, version recorded in `packageManager`                                                                                                                                                                                                      | Developer's choice. The `packageManager` field is required for Vercel to select pnpm at build time rather than defaulting to npm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | **Lean tooling: ESLint and Prettier only** — no husky, no lint-staged, no CI workflow                                                                                                                                                                                  | Developer's choice; matches the `plan.md` Phase 1 checkbox literally. Hooks and CI can be added later without rework.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | **Vercel configuration is committed, but no Vercel CLI command is run as part of this phase**                                                                                                                                                                          | Developer will perform linking and deployment themselves after implementation completes. Consequence: the `plan.md` Vercel checkbox is annotated rather than claimed as a verified deploy, and the "hello-world function deploys" half of it remains unproven until the developer deploys.                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | **TypeScript 7.0.2 (latest) is the project compiler**, with TypeScript 6.0.3 installed side-by-side solely to keep `typescript-eslint` operational                                                                                                                     | Developer requirement: latest TypeScript. Empirically verified during planning that `typescript-eslint@8.66.0` does not degrade on TS 7 — it **throws at module load** and ESLint lints nothing, so simply ignoring the peer range is not an option. The side-by-side arrangement was tested end to end: with root `typescript` at 6.0.3 the linter runs normally (reported both a core `no-var` and a `@typescript-eslint/no-unused-vars` error), while the aliased TypeScript 7 binary typechecks the project. Trade-off accepted knowingly: two compilers in the dependency tree, justified by the developer's note that ESLint is aesthetic and therefore must not dictate the compiler version. |
| 5a  | Root `typescript` must be the **6.0.3** entry and TypeScript 7 must be the **aliased** one, not the reverse                                                                                                                                                            | `typescript-eslint` loads `typescript` by bare specifier, so it always gets whatever occupies `node_modules/typescript`. Aliasing 6 while leaving 7 as the root entry would put 7 back in the linter's path and reintroduce the hard throw. The arrangement only works in this direction.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5b  | `package.json` scripts invoke both compilers by **explicit path**, never bare `tsc`                                                                                                                                                                                    | Both packages ship a `tsc` binary, so `node_modules/.bin/tsc` is a real collision. In the probe install the alias won and bare `tsc` reported 7.0.2, but pnpm does not document which package wins a bin conflict, so relying on it would make typechecking silently version-dependent on install order.                                                                                                                                                                                                                                                                                                                                                                                             |
| 5c  | `.vscode/settings.json` sets `typescript.tsdk` to the aliased TypeScript 7 lib                                                                                                                                                                                         | Otherwise the editor loads `node_modules/typescript` (6.0.3) and the developer would get TS 6 diagnostics while CI-style scripts use TS 7 — the worst possible split, and precisely contrary to the requirement that motivated this arrangement.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | **`shared/` lives at the repository root, not under `src/`**, and `api/` imports it by relative path                                                                                                                                                                   | Keeps the client/function boundary symmetrical — neither tree reaches into the other — and avoids depending on TypeScript path-alias resolution inside the Vercel function build. Now confirmed by Vercel's own documentation, which lists "Path Mappings" as unsupported in the root `tsconfig.json`: an aliased import from `api/` would fail to resolve at deploy time. The `@/` alias is therefore usable from `src/` only.                                                                                                                                                                                                                                                                      |
| 7   | **Tailwind v4 via the official Vite plugin, no `tailwind.config.js`**                                                                                                                                                                                                  | v4 is CSS-first; a config file is unnecessary until design tokens are defined, which is Phase 7 work (and gated on the open card-art-direction question in `plan.md` §6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | **Vitest configured with the Node environment only; `jsdom` and Testing Library deferred**                                                                                                                                                                             | `plan.md` §3 scopes Vitest to pure logic (URL parsing, shuffle, year resolution). The first component test does not appear until Phase 4, which is when a DOM environment should be added — installing it now would be unused weight.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | **`motion` and `qrcode` are installed in this phase despite having no importers yet**                                                                                                                                                                                  | The phase's job is to lock one coherent, verified dependency tree. Both are named in `plan.md` §3, and resolving their peer compatibility now is cheaper than discovering a conflict mid-Phase-4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 10  | **Vitest config lives in `vite.config.ts` rather than a separate `vitest.config.ts`**                                                                                                                                                                                  | One fewer config file, and Vitest reads the `test` key from the Vite config directly. Split it out only if the app and test configs later need to diverge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 11  | **`src/App.tsx` is a throwaway placeholder, not an early landing page**                                                                                                                                                                                                | The landing screen with URL input and suggested playlists is Phase 6 work with its own validation and error states. Building it now would pre-empt that phase and invite half-finished UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 12  | Full stack compatibility verified against the registry at planning time: Vite 8.x, React 19.2.x, Tailwind 4.3.x, Motion 12.x, Vitest 4.1.x, ESLint 10.x, and the Vercel Node types all have overlapping supported ranges                                               | Prevents the phase from stalling on a peer-dependency conflict discovered mid-install. The only conflict found in the whole set is the TypeScript one in decision 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 13  | **`engines.node` is set to `24.x`, not the local Node version**                                                                                                                                                                                                        | Vercel Functions offer only three majors — 24.x (default), 22.x, 20.x — and only majors, with minor/patch rolled out by Vercel. Local Node is 25.9.0, an odd-numbered "Current" line that never becomes LTS and is therefore not on the menu; `engines.node` selects from that fixed list rather than requesting a build. 24.x is the newest available and the closest match to local. Vite's own requirement (`^20.19.0 \|\| >=22.12.0`) is satisfied.                                                                                                                                                                                                                                              |
| 13a | Accepted consequence: `vercel dev` runs functions on **local** Node 25 while production runs 24                                                                                                                                                                        | A Node 25-only API would pass locally and fail in production. Practically negligible for `api/` code that only does `fetch`, JSON parsing, and a rate-limit queue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 13b | A `.node-version` file pins Node 24 in the repo alongside `engines.node`                                                                                                                                                                                               | `engines.node` is only read by Vercel at build time; `.node-version` is what `fnm` and `nvm`-style managers read locally, so the pin applies on both sides from one commit. Costs one line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 13c | **Separately actionable (outside this plan's scope): local Node 25.9.0 reached end-of-life on 2026-06-01** and is installed machine-wide from the winget _Current_-line package (`OpenJS.NodeJS`) rather than the LTS package (`OpenJS.NodeJS.LTS`, currently 24.18.1) | Not a Phase 1 deliverable — it is a developer-machine concern — but recorded here because it is the reason the `engines.node` pin cannot match local, and because moving to Node 24 LTS simultaneously restores security patching (supported to 2028-04-30), matches the pin, and closes the `vercel dev` gap in 13a. Note that a plain `winget upgrade` moves to 26.x (Current until 2026-10-28), which is also not a Vercel runtime.                                                                                                                                                                                                                                                               |
| 14  | **No TypeScript project references anywhere in the repo**, and the root `tsconfig.json` is a real config rather than the Vite scaffold's solution file                                                                                                                 | Vercel's Node runtime docs state that of the root `tsconfig.json`, _"Most options are supported aside from Path Mappings and Project References."_ Vercel reads that file to compile `api/`, so a references-only root would leave the function build without compiler options — and the failure surfaces only at deploy time, after this phase ends. The DOM-versus-Node isolation is preserved instead through two `extends`-based typecheck configs invoked separately, which Vercel never reads.                                                                                                                                                                                                 |

---

## Open Questions

- [x] ~~**Which Node major to pin in `engines.node`?**~~ **Resolved during planning: `24.x`** — confirmed against Vercel's supported-versions documentation (24.x default, 22.x, 20.x; majors only). See decision 13.
- [x] ~~**Which cache provider will Phase 2 use — Upstash Redis or Vercel KV?**~~ **Resolved during execution: Upstash Redis.** Developer's choice. `.env.example` documents `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, both marked production-only with an in-memory fallback for local dev. Rationale recorded: Vercel KV is now provisioned as Upstash Redis through the Vercel Marketplace, so these names are the more durable choice. Phase 2 owns the actual cache interface.
- [ ] **Should the `@/` alias exist at all, given `api/` cannot use it?** Decided yes, app-scoped — but if the asymmetry causes confusion in Phase 2, dropping it in favour of relative imports everywhere is a cheap reversal while the codebase is still this small.
- [ ] **How should the editor track TypeScript 7 going forward?** New question raised by execution. The `typescript.tsdk` mechanism decision 5c assumed turned out not to apply at all — TypeScript 7 is the native Go port and ships no `tsserver.js` (see the correction under the TypeScript step). The repo now depends on the `TypeScriptTeam.native-preview` extension plus the experimental `typescript.experimental.useTsgo` setting, which means: editor TS 7 comes from the extension's own bundled native build rather than the pinned `typescript-7@7.0.2`, so the two can drift by patch; the setting is explicitly experimental and may be renamed; and a contributor without the extension silently gets TS **6** diagnostics from the `tsdk` fallback. Revisit when the native language server stabilises — it resolves at the same time as the question below.
- [ ] **When does `typescript-eslint` support TypeScript 7?** Their tracking issue targets TS ≥7.1 support (`typescript-eslint` issue 10940, surfaced in the error message the probe produced). Once it lands, the cleanup is a single commit: drop the `typescript` 6.0.3 entry, promote the aliased TypeScript 7 to the plain `typescript` name, simplify the scripts back to bare `tsc`, and delete the `typescript.tsdk` editor setting. Worth tracking so the side-by-side arrangement does not quietly become permanent.
- [ ] **Does anything else in the toolchain load `typescript` by bare specifier?** Nothing in the current dependency set does — Vite and Vitest transpile via esbuild/Rolldown and never load the package — but any future dev tool added to the repo will resolve to the 6.0.3 copy, not 7. Worth a moment's thought whenever a new TypeScript-aware tool is introduced.

---

## Out of Scope

- Any playlist parsing, embed fetching, or year resolution — Phase 2. `api/hello.ts` establishes the handler shape and nothing more.
- The cache layer and its interface — Phase 2, though `.env.example` anticipates its variables.
- Game state, the reducer, seeded shuffle, and localStorage persistence — Phase 3.
- The card component, CSS 3D flip, QR rendering, and audio playback — Phase 4. `qrcode` and `motion` are installed but unused.
- Gestures, swipe thresholds, and keyboard controls — Phase 5.
- The landing page, suggested playlists, loading state, year review screen, HUD, and end screen — Phase 6.
- Visual design, design tokens, responsive work, accessibility, and Lighthouse passes — Phase 7.
- **Running `vercel link`, `vercel deploy`, or any other Vercel CLI command** — the developer performs these manually after this phase. `vercel dev` is offered as an optional local check only.
- Provisioning the Upstash or Vercel KV instance itself.
- Pre-commit hooks, GitHub Actions CI, and Playwright end-to-end tests — explicitly declined for this phase; addable later without rework.
- A DOM test environment (`jsdom`) and Testing Library — deferred to Phase 4, when the first component test exists.
- Everything in `plan.md` §5 Phase 8.
