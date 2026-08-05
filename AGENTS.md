# AGENTS.md

Instructions for Claude Code and other agents working in this repository. **[`docs/`](./docs/) is the source of truth** — read the relevant file before changing code or configuration.

Several decisions in this repo look like mistakes and are not. If something seems obviously wrong, check `docs/toolchain.md` before "fixing" it.

---

## Documentation Index

| File                                                                               | What it covers                                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`docs/architecture.md`](./docs/architecture.md)                                   | Components, import boundaries between `src`/`api`/`shared`, data flow, external services, planned phases  |
| [`docs/api.md`](./docs/api.md)                                                     | The `api/` surface, handler conventions, environment variable reference                                   |
| [`docs/toolchain.md`](./docs/toolchain.md)                                         | The two TypeScript installs, the four tsconfigs, ESLint/Prettier, pnpm and the Node pin, Tailwind, Vitest |
| [`docs/development.md`](./docs/development.md)                                     | Setup, scripts, running functions locally, tests, deploy, known limitations                               |
| [`docs/agent_findings.md`](./docs/agent_findings.md)                               | Running log of discoveries and gotchas found while working here                                           |
| [`docs/plans/plan.md`](./docs/plans/plan.md)                                       | **Authoritative phase plan** — what belongs in which phase, plus all Phase 0 research findings            |
| [`docs/plans/plan.phase-1.md`](./docs/plans/plan.phase-1.md)                       | Phase 1 detail, decisions, and execution notes                                                            |
| [`docs/plans/plan.phase-2-playlist.md`](./docs/plans/plan.phase-2-playlist.md)     | Phase 2, first half — URL parsing, the embed adapter, `/api/playlist`                                     |
| [`docs/plans/plan.phase-2-year.md`](./docs/plans/plan.phase-2-year.md)             | Phase 2, second half — the cache, the MusicBrainz adapter, year resolution, `/api/year`                   |
| [`docs/plans/plan.phase-3.md`](./docs/plans/plan.phase-3.md)                       | Phase 3 — the reducer, seeded shuffle, persistence, and the progressive-loading resolver                  |
| [`docs/plans/plan.phase-4-6-card-ui.md`](./docs/plans/plan.phase-4-6-card-ui.md)   | Phase 4 — the DOM test environment, the flip card, the QR code, and card audio                            |
| [`docs/plans/plan.phase-4-6-gestures.md`](./docs/plans/plan.phase-4-6-gestures.md) | Phase 5 — swipe, tap-versus-drag, the stacked deck, keyboard controls                                     |
| [`docs/plans/plan.phase-4-6-screens.md`](./docs/plans/plan.phase-4-6-screens.md)   | Phase 6 — landing, the playlist client, notices, the HUD, the end screen, the session container           |

**Do not build ahead of the current phase.** The plan defers things deliberately. Current phase: **4 (card UI) is complete** — the CSS 3D flip card, the QR code, the three controls, the session-scoped `<audio>`, and the jsdom + Testing Library environment are all built, on top of Phase 3's game layer in `src/game/`. The QR scan was verified on a real phone (2026-08-05); the rest of its manual verification — the devtools DOM search on an unflipped card and the **Android lock-screen check** — is still outstanding, and the lock-screen one is the only leak vector no test in this repo can reach. **Phase 5 — swipe-to-next, tap-to-flip, the stacked deck, and keyboard controls — is next**, per [`docs/plans/plan.md`](./docs/plans/plan.md) §5 and [`plan.phase-4-6-gestures.md`](./docs/plans/plan.phase-4-6-gestures.md).

There is **no flip trigger and no swipe yet** — that is Phase 5, not an oversight. `src/App.tsx` is a temporary Phase 4 harness over the fixture deck, and [`plan.phase-4-6-screens.md`](./docs/plans/plan.phase-4-6-screens.md) replaces it wholesale.

---

## Key Rules

**Layout and imports** — details in [`docs/architecture.md`](./docs/architecture.md) §2

- `src/` = browser (may use the `@/` alias and DOM APIs) · `api/` = Node · `shared/` = both, so **no DOM and no Node APIs**.
- **`src/` has four subtrees, and which one a file belongs in is a real decision.** `src/game/` = the session (reducer, shuffle, resolver, persistence) — pure and framework-free apart from one hook. `src/components/` = presentational React, props in and callbacks out, no session knowledge. `src/hooks/` = the stateful concerns a component should not own (audio today, gestures in Phase 5). `src/components/__fixtures__/` = the shared fixture deck every component test renders from. Logic that starts accumulating in a component belongs in a hook or in `src/game/`.
- **`api/` must import `shared/` by RELATIVE path, never via `@/`.** Vercel does not support tsconfig path mappings for functions — an aliased import type-checks locally and **fails at deploy time**. Grep for `@/` under `api/` before deploying. `api/hello.ts` is the minimal reference shape; `api/playlist.ts` is the reference for a real endpoint (method guard, query handling, typed-error-to-status mapping).
- **Every relative import that can end up inside a function bundle needs an explicit `.js` extension** — `'../shared/constants.js'`, not `'../shared/constants'`. That covers all of `api/` and any `shared/`→`shared/` **runtime** import (type-only imports erase, so they are exempt). `"type": "module"` makes the deployed function ESM, and Node's ESM resolver does not guess extensions; Vercel transpiles rather than bundles, so the specifier reaches Node verbatim. Getting this wrong yields `FUNCTION_INVOCATION_FAILED` at runtime after a build that logs **no error**, and **all five local checks pass either way** — measured on a real deploy 2026-08-04, see [`docs/agent_findings.md`](./docs/agent_findings.md). TypeScript and Vite both resolve the `.js` specifier back to the `.ts` source, so the same form works in the browser build and under Vitest.
- New files must land in the right tree, because that determines which typecheck config covers them.

**TypeScript** — details in [`docs/toolchain.md`](./docs/toolchain.md) §1–2

- **Two TypeScript installs exist on purpose.** `typescript` (6.0.3) is there _only_ so `typescript-eslint` can load; `typescript-7` (7.0.2) is the real compiler. Don't delete either, don't flip which one is aliased.
- **Never call bare `tsc`** in a script — the bin slot is contested. Invoke compilers by explicit path.
- **Root `tsconfig.json` must never become a solution file** (`files: []` + `references`). Vercel reads it to compile `api/`; a references-only root breaks the function build **at deploy time only**. No `references` and no `composite` anywhere. `build` must never become `tsc -b && vite build`.
- No `baseUrl` (removed in TS 7); `paths` targets must be relative.

**Conventions**

- **pnpm only.** Don't add `package-lock.json` or `yarn.lock`; keep `pnpm-lock.yaml` committed.
- **`engines.node` is `24.x` and deliberately does not match local Node.** Don't "fix" it. The `Unsupported engine` install warning is expected.
- **Prettier owns formatting.** No hand-formatting, no stylistic ESLint rules.
- **Tailwind v4 is CSS-first** — no `tailwind.config.js`; `@theme` tokens are Phase 7.
- Vitest config lives in the `test` key of `vite.config.ts`. **The default environment is `node` and stays that way** — it is what makes a DOM API accidentally added to `shared/` (which must stay portable to `api/`) fail a test run. A test needing a DOM opts in **per file** with a `/** @vitest-environment jsdom */` docblock as the first thing in the file. Do not globalise jsdom.
- **Testing Library does not clean up between tests here.** Its auto-`afterEach(cleanup)` only registers when Vitest `globals` are on, and this repo imports `describe`/`it`/`expect` explicitly — so every DOM test file needs its own `afterEach(cleanup)`. Without it, a test queries a DOM still holding every previous render, and the failure reads as a component bug.
- **The hidden side of a card must leak nothing, and the audit covers more than visible text.** Attributes, `aria-label`s, `alt` text, and the OS media session are all leak surfaces. Never set `navigator.mediaSession.metadata`. See [`docs/architecture.md`](./docs/architecture.md) §3.
- **Never put secrets in `api/` source** — the Vite dev server serves it as readable text.

**No Spotify credentials exist or are needed.** Spotify's Feb 2026 API changes mean no credentialed path can serve "anyone with a public link", so the app reads the public embed endpoint anonymously. Before adding a `SPOTIFY_CLIENT_ID`, read [`docs/plans/plan.md`](./docs/plans/plan.md) §2 — **it is a product decision, not an oversight.**

**Before committing:**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass. There are no pre-commit hooks and no CI — the checks are yours to run.

---

## Findings

Append discoveries, gotchas, implicit conventions, and non-obvious behaviours to [`docs/agent_findings.md`](./docs/agent_findings.md).

- **Always date each entry** (ISO 8601).
- **Record conclusions from any significant analysis** — if you traced an error or explored an unfamiliar area, write down what you learned so a future session doesn't repeat the work.
- **Tell the user** when you add a finding.
- **Confirm with the user first** before editing or removing an existing entry.
