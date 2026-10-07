# Prompt audit — custom-hitster (Playlist Jitster) — 2026-10-07

## Assumptions

- **Scope**: the whole working directory's prompt and documentation surface. Skipped: `node_modules/`, `dist/`,
  `android/` (Bubblewrap output; only `android/twa-manifest.json` is tracked), `.claude/settings*.json`, `.env*`
  (only `.env.example` was grepped), and user-level configuration under `~/.claude/`.
- **Target models**: the instruction files, the project skill and the docs were audited against `claude-opus-5-5`.
  There are no application prompts, because the repo has no LLM request code.
- **Rubric**: claude-api `shared/prompt-audit.md` (Claude Code 2.1.292).
- **Non-Anthropic providers found**: none in code. `docs/spikes/spike.ai-year-fetch.md` names Gemini and OpenAI
  models for an unbuilt design. That is recorded only; no provider switch is proposed.

## Status

The audit found 74 findings in 44 files (2 root instruction files, 41 docs and 1 project skill). **The 64
non-flag findings were applied on 2026-10-07 and deleted from this report**, which now lists only what is still
open. Nothing is open now. The applied edits are the record (see the diff of the change that adds this file). They were:

- **`AGENTS.md`**:
  - the Google Play status cell;
  - the non-pure files in `src/game/`;
  - the recording-year exception;
  - the live-region wording;
  - two dated bullets and one migration-relative phrase.
- **`.claude/skills/unlighthouse/SKILL.md`**: retargeted from another project to `playlistjitster.vercel.app`
  (`/`, a share link, `/privacy.html`). It now uses `pnpm`, keeps its results in the scratchpad and writes a dated
  review in `docs/reviews/`.
- **The docs were caught up with the code**:
  - the card-1 gate rule (`keepYearless && !skipUnconfirmed`);
  - `card-ring-quiet` in place of `card-ring-dim`;
  - Google Play status deferred to `plan.play-store-todo.md`;
  - `linkArrivalIntent`;
  - the language selector on the picker;
  - Restart song removed;
  - the `main.tsx` provider order;
  - stale commands (`npx vercel deploy`, the rate-limit log line);
  - stale paths, counts and tester-facing notes.
- **These docs were edited**:
  - `README.md`;
  - `docs/{api,architecture,decisions,development,toolchain}.md`;
  - five plans, both spikes and `review.year-fetch-rework.md`;
  - `visual-assets/{listing,tester-notes}.md`.

The listing's full description was recounted at 2,212 characters.

All four checks pass after the edits: `pnpm typecheck`, `pnpm lint`, `pnpm test` (74 files, 1,592 tests, run with
`--maxWorkers=4` after the known jsdom worker-start flake) and `pnpm build`.

## Resolved after the report (2026-10-07, the developer's decisions)

- **Paid price vs provider licences (F3)**: the app is **free** on Play (plan 3 decision 17). A paid version, if
  ever, ships as a new app with a new package name, without Deezer and iTunes. Step 9a and the testers' €1
  question are moot; the listing, tester notes, `decisions.md` and `AGENTS.md:151` say so.
- **"Do not build ahead of the current phase" (F1)**: deleted from `AGENTS.md`, `decisions.md` and
  `architecture.md`.
- **The minor items (F2, F4–F9)**:
  - the `tokenised` sentence is removed;
  - the `yearUnverified` note is added to plan 3;
  - "five checks", "five screens" and "thirteen interactive elements" are corrected;
  - the language fraction is now "about half of the thirteen";
  - the listing quotes the current suggestion row.
- **F10** (non-Anthropic model names in the AI spike) is a record, not a defect, and stays as written.
- **The three stale code comments** are fixed:
  - `reducer.ts`: no deferred pass, and `not-configured` only fires when no provider is configured;
  - `index.css`: `card-ring-quiet`;
  - `GameScreen.tsx`: `docs/decisions.md`.
- **Seventeen fully built plans were deleted** (phases 1–8, multi-playlist ×2, year accuracy, suggestion
  multi-select, year-fetch rework plan 1). Any check or open question they still owed moved to
  `development.md` §5/§8 first. Links to them now name the file and point at git history.
- **Superseded entries in `docs/agent_findings.md` were deleted**, with the developer's confirmation, as
  `AGENTS.md` requires.

## Worth a second look in the applied edits

- **`AGENTS.md:219`**: the HUD's count `role="status"` is now named as the existing exception. Confirm that the HUD
  region is meant to stay (`Hud.tsx:55–62`).
- **`AGENTS.md:193`**: `qrcode-loader.ts` is listed with the non-pure exceptions. If you consider a chunk-loading
  import pure, as `decisions.md` argues for the preloaded loader, drop it from that list.
- **`AGENTS.md:147`**: manual preloaded entries that carry the film's or season's year are described as
  intended, which `decisions.md:628` and `spike.ai-year-fetch.md:326` both say.
- **The `unlighthouse` skill**: dry-run one route with its manual command, using the share URL and a scratchpad
  output path, to confirm that the `finalDisplayedUrl` check passes on a query-string URL.

## Next step

Run `/doctor prompt-audit` yourself as a cross-check. A skill cannot invoke built-in commands, and it also
covers the user-level configuration this audit leaves out.
