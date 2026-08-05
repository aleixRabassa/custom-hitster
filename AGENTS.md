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

**Do not build ahead of the current phase.** The plan defers things deliberately. Current phase: **7, first half complete** ([`plan.phase-7-look.md`](./docs/plans/plan.phase-7-look.md)) — the app is playable end to end and now has a design surface. `src/App.tsx` is the **real container** and the only caller of `useGameSession()`; the four screens, the notices, `src/game/playlist-client.ts`, `src/game/messages.ts` and `src/hooks/usePlaylist.ts` are built, and Phases 3–6 are complete beneath them. Phase 7's first half added the **`@theme` token layer, a fluid card, `prefers-reduced-motion`, focus states and the ARIA/contrast fixes**. **Next is Phase 7's second half — error/offline states, an error boundary, the Lighthouse pass, lazy-loading the QR and audio code, and the README** — per [`plan.phase-7-robustness.md`](./docs/plans/plan.phase-7-robustness.md) and [`docs/plans/plan.md`](./docs/plans/plan.md) §5.

**Phase 7's first half is verified only at the ends of each contract, never in the middle**, and that is a property of the environment rather than of the effort: jsdom evaluates no media queries, has **no `window.matchMedia` at all**, computes no layout, and has no accessibility-tree consumer. So a component asserts it renders a `data-motion` hook and `src/index.css.test.ts` asserts the stylesheet names it — and nothing checks that reduced motion, the responsive clamp, the focus rings or the reveal's live region actually work. Four manual passes are scoped row by row in [`docs/development.md`](./docs/development.md) §5, all Pending. **The screen-reader pass matters most:** the reveal's live region is the phase's most valuable single change (before it, a flip was silent and the year was unreachable without sight) and nothing local confirms it announces.

**The app is only playable under `npx vercel dev`, never `pnpm dev`.** Vite serves `api/playlist.ts` as transpiled source with status 200, so pressing Start under `pnpm dev` shows the `unexpected-payload` error copy ("Spotify returned something we could not read"). That is the client behaving exactly as designed, not a bug — see [`docs/development.md`](./docs/development.md) §4.

**The three controls are NOT on the card** (`src/components/CardControls.tsx`, rendered by `GameScreen` beside the stack), and putting them back would reintroduce a real bug: `gestureProps.onPointerUp` is bound to the card's outer element, so a pointer-up on a button inside the card is read as a tap and flips it — pressing Play revealed the answer. **Nothing interactive may be rendered inside `Card`.** Two tests assert the absence.

**Manual verification outstanding, and no local check will ever close it:**

- Phase 4: the QR scan was verified on a real phone (2026-08-05). The **devtools DOM search on an unflipped card** and the **Android lock-screen check** are still owed — the lock-screen one is the only leak vector no test in this repo can reach.
- Phase 5: the **real-device touch pass was deliberately not performed** (decided 2026-08-05). The five gesture thresholds in `src/game/gestures.ts` are documented starting guesses that have never met a thumb. If touch input misbehaves, **those constants are the first place to look** — not the hook, and not Motion. The checklist that was never run is preserved in [`docs/development.md`](./docs/development.md) §5, and the gap is listed in its §8 Known limitations.
- Phase 6: **progressive loading against a real preview deployment with Upstash configured** (step 15 of [`plan.phase-4-6-screens.md`](./docs/plans/plan.phase-4-6-screens.md), carried over from Phase 3) is not done. Nothing local models it: the shared cache and the 1 req/s gate are both backed by the Upstash variables, and without them the gate paces nothing. It also owes the **50-track cold-deck wall clock**, unmeasured since Phase 2, and a **count of `/api/year` requests under React 19 StrictMode** — `use-game-session.ts` has a double-crawl guard that nothing tests.
- Phase 7 (first half): **all four behavioural passes are outstanding** — reduced motion with the OS preference set, three widths, keyboard-only, and a screen reader over one flip — plus the before/after screenshot comparison. The environment is the reason, not the effort: jsdom has no media queries, no `matchMedia`, no layout and no a11y tree, so class-name assertions are the ceiling. **Prioritise the screen reader.** Checklists in [`docs/development.md`](./docs/development.md) §5, gaps in its §8.

**The Phase 4/5 fixture harness is gone**, and so is `public/dev-preview.wav`, the generated audio file that stood in for the fixture cards' invented preview URLs. The fixture deck itself stays at `src/components/__fixtures__/cards.ts` — it is what every component test renders from. To look at one specific card shape, run a component test in watch mode; there is no longer a page that walks the deck.

---

## Key Rules

**Layout and imports** — details in [`docs/architecture.md`](./docs/architecture.md) §2

- `src/` = browser (may use the `@/` alias and DOM APIs) · `api/` = Node · `shared/` = both, so **no DOM and no Node APIs**.
- **`src/` has four subtrees, and which one a file belongs in is a real decision.** `src/game/` = the session (reducer, shuffle, resolver, persistence, gesture _decisions_, the playlist client, the error-copy map) — pure and framework-free apart from one hook. `src/components/` = presentational React, props in and callbacks out, no session knowledge. `src/hooks/` = the stateful concerns a component should not own (audio, gesture _binding_, the playlist request). `src/components/__fixtures__/` = the shared fixture deck every component test renders from. Logic that starts accumulating in a component belongs in a hook or in `src/game/`.
- **`src/App.tsx` is the ONLY caller of `useGameSession()`**, and the only file that knows all four statuses exist. Screens receive plain data and callbacks. `dispatch` is deliberately not exposed by the hook, so a screen cannot invent a transition the reducer's tests never considered — if a screen seems to need a fifth action, add it to the reducer with its tests.
- **Both HTTP clients live in `src/game/` and take an injected `fetch`** (`year-client.ts`, `playlist-client.ts`), with a thin hook over each. That is what keeps every status branch a **node-environment** unit test with no jsdom and no network. Anything that accumulates in the hook belongs in the client instead.
- **The decision/binding split is the house style, and it exists because of what cannot be tested.** Phase 3 did it for the resolver; Phase 5 did it for gestures. `src/game/gestures.ts` holds every threshold and comparison as pure functions over numbers; `src/hooks/useCardGestures.ts` only collects coordinates and dispatches. The reason is specific: **jsdom cannot exercise a drag** — Motion's drag reads element geometry jsdom does not compute, so a simulated pointer sequence tests the double, not the gesture. Thresholds left inline in the hook would be untested full stop. When adding gesture behaviour, the decision goes in `src/game/`, not the hook.
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
- **Tailwind v4 is CSS-first** — no `tailwind.config.js`. **The design surface is the `@theme static` block in `src/index.css`**, which is where a v3 reader would look for that config file: every colour, dimension, duration and interaction minimum in the app is named there. **A new component consumes tokens rather than inventing literals** — a colour written as `bg-neutral-900` instead of `bg-surface` is the thing to catch in review, because Phase 8 redesigns by changing token values and a stray literal is invisible to that. `focus-ring` and `touch-target` are `@utility` composites in the same file; every interactive element gets `focus-visible:focus-ring`.
- **An unknown Tailwind colour utility is a SILENT no-op, and all four checks pass either way.** `text-text-muted` against a theme defining `--color-fg-muted` emits **no rule at all** — no warning, no build error. It shipped once: the only text on the card's hidden face lost its colour and rendered near-black on a near-black card while typecheck, lint, test and build stayed green. When adding or renaming a token, grep the built CSS (`dist/assets/*.css`) for the utility, and prefer a class-name assertion in the component's test — `CardHiddenSide.test.tsx` has one.
- **`@theme static`, not bare `@theme`.** A plain `@theme` tree-shakes any token no generated utility references, which silently kills the ones consumed only through `h-(--card-height)`-style arbitrary values, through an `@utility`, or from inside the `prefers-reduced-motion` block.
- Vitest config lives in the `test` key of `vite.config.ts`. **The default environment is `node` and stays that way** — it is what makes a DOM API accidentally added to `shared/` (which must stay portable to `api/`) fail a test run. A test needing a DOM opts in **per file** with a `/** @vitest-environment jsdom */` docblock as the first thing in the file. Do not globalise jsdom.
- **Testing Library does not clean up between tests here.** Its auto-`afterEach(cleanup)` only registers when Vitest `globals` are on, and this repo imports `describe`/`it`/`expect` explicitly — so every DOM test file needs its own `afterEach(cleanup)`. Without it, a test queries a DOM still holding every previous render, and the failure reads as a component bug.
- **The hidden side of a card must leak nothing, and the audit covers more than visible text.** Attributes, `aria-label`s, `alt` text, live regions, and the OS media session are all leak surfaces. Never set `navigator.mediaSession.metadata`. See [`docs/architecture.md`](./docs/architecture.md) §3.
- **`CardRevealSide`'s live region is the ONE place announcing track data is correct, and it is not a bug.** Phase 7 gave the reveal a polite `role="status"` because the flip was otherwise silent to assistive technology — the year, the payoff of the whole game, was reachable by sight only. It is safe because `Card.tsx` mounts that component **only while the card is flipped**, so the region cannot exist on a card that is still a mystery. **Do not add one to `CardHiddenSide`, to `CardStack`'s backs, or to the HUD** beyond the `role="status"` already on the count; `CardHiddenSide.test.tsx` asserts the absence. If you are about to file the reveal's region as a leak, you are reasoning from the rule without its mounting condition.
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
