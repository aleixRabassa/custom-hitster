# Custom Hitster

Turn any public Spotify playlist link into a playable digital [Hitster](https://hitstergame.com/) deck. Paste a playlist URL, press Start, and get a shuffled deck of cards you play in the browser: each card shows only a QR code, and you tap to reveal the title, artist, and — the part the game is actually about — the song's **original** release year.

Release years come from MusicBrainz rather than Spotify, because Spotify reports the _album edition's_ date, which turns a 2011 remaster of Bohemian Rhapsody into a 2011 song.

> **Status: Phase 1 (project skeleton).** The toolchain, serverless function directory, and test harness are in place. There is no game yet — `src/App.tsx` is a placeholder. See [`docs/plans/plan.md`](./docs/plans/plan.md) for the full phase plan.

---

## Prerequisites

| Tool       | Version     | Notes                                                                                                        |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Node.js    | **24.x**    | Pinned in `.node-version` and `engines.node`. See [A note on the Node version](#a-note-on-the-node-version). |
| pnpm       | **10.29.2** | Pinned in `packageManager`. pnpm is the only supported package manager — see `AGENTS.md`.                    |
| Vercel CLI | any recent  | Optional. Only needed to run the serverless functions locally.                                               |

## Install and run

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

`pnpm dev` serves the React app only. It does **not** serve anything under `api/` — see [Running the serverless functions locally](#running-the-serverless-functions-locally).

## Scripts

| Script               | What it does                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Vite dev server with HMR. Client only; `api/` is not served.                                                                                                     |
| `pnpm build`         | Production build to `dist/`. Does **not** typecheck — run `pnpm typecheck` for that.                                                                             |
| `pnpm preview`       | Serves the built `dist/` locally to sanity-check a production build.                                                                                             |
| `pnpm typecheck`     | The real type gate. Runs `typecheck:app` **and** `typecheck:api`.                                                                                                |
| `pnpm typecheck:app` | Typechecks `src/` + `shared/` with DOM libs, via `tsconfig.app.json`.                                                                                            |
| `pnpm typecheck:api` | Typechecks `api/` + `shared/` with Node types and **no** DOM lib, via `tsconfig.api.json`. This is what catches a browser API used inside a serverless function. |
| `pnpm test`          | Runs the Vitest suite once.                                                                                                                                      |
| `pnpm test:watch`    | Vitest in watch mode.                                                                                                                                            |
| `pnpm lint`          | ESLint across `src/`, `api/`, and `shared/`.                                                                                                                     |
| `pnpm lint:fix`      | Same, applying autofixes.                                                                                                                                        |
| `pnpm format`        | Prettier `--write` across the repo.                                                                                                                              |
| `pnpm format:check`  | Prettier in check mode; fails instead of rewriting.                                                                                                              |
| `pnpm tsc:versions`  | Diagnostic. Prints both installed TypeScript versions (expect `6.0.3` then `7.0.2`).                                                                             |

Note that `build` and `typecheck` are separate on purpose: `build` must not run `tsc -b`, because this repo cannot use TypeScript project references (see below).

## Why there are two TypeScript versions

`package.json` lists TypeScript twice. **This is deliberate. Neither entry is a leftover, and deleting either one breaks something.**

```json
"typescript": "6.0.3",                    // ← what typescript-eslint loads
"typescript-7": "npm:typescript@7.0.2"    // ← what actually compiles this project
```

- **The project compiles with TypeScript 7.0.2**, installed under the alias `typescript-7`. Every `typecheck` script invokes it.
- **TypeScript 6.0.3 exists only so ESLint can run at all.** `typescript-eslint` declares a peer range of `>=4.8.4 <6.1.0` and loads `typescript` by _bare specifier_ — so it always gets whatever occupies `node_modules/typescript`. Given 7.x it does not degrade gracefully; it **throws at module load** ("typescript-eslint does not support TS 7.0") and ESLint lints nothing at all.

Two consequences worth knowing before you touch anything here:

1. **The direction cannot be flipped.** TypeScript 6 must be the plain `typescript` entry and 7 must be the aliased one. Aliasing 6 instead would put 7 back in the linter's load path and reintroduce the hard throw.
2. **Scripts call each compiler by explicit path, never bare `tsc`.** Both packages ship a `tsc` binary, so `node_modules/.bin/tsc` is a genuine collision and pnpm does not document which package wins it. Relying on the bin slot would make typechecking silently depend on install order.

This is temporary. `typescript-eslint` is tracking TypeScript 7 support (targeting TS ≥ 7.1). When it lands, the cleanup is one commit: drop the `typescript` 6.0.3 entry, rename the alias to plain `typescript`, simplify the scripts back to bare `tsc`, and remove the editor settings below.

### Editor setup

TypeScript 7 is the **native Go port** and ships no `tsserver.js`, so the classic `typescript.tsdk` setting cannot load it — point `tsdk` at TS 7 and VS Code shows an error and silently falls back to its own bundled TypeScript. Getting TS 7 into the editor requires the native language server instead:

- Install the recommended **TypeScript (Native Preview)** extension (`TypeScriptTeam.native-preview`); VS Code will prompt via `.vscode/extensions.json`.
- `.vscode/settings.json` sets `typescript.experimental.useTsgo: true` to activate it, and additionally points `typescript.tsdk` at the repo's TypeScript **6.0.3** as a fallback so that a contributor _without_ the extension at least gets the repo's own pinned version rather than an arbitrary bundled one.

If the fallback is what's active, your editor diagnostics are TS 6 and may differ slightly from `pnpm typecheck`. The scripts are the source of truth.

## Running the serverless functions locally

`pnpm dev` starts Vite, which serves `index.html` and everything under `src/`. It has no concept of Vercel Functions, so **`api/` is not executable through it.**

Be aware of what actually happens if you request one anyway, because it is misleading: Vite treats any file under the project root as a transformable module, so `GET /api/hello` returns the **transpiled source** of `api/hello.ts` as `text/javascript` (complete with an inline sourcemap of the original), with a `200` status. It does not run the handler and it does not fall through to the SPA. So a `fetch('/api/hello')` in dev fails at JSON parsing rather than 404-ing, which is easy to misread as a broken function. Two implications: don't treat a `200` from the Vite dev server as evidence a function works, and remember `api/` source is readable over the dev server — keep secrets in environment variables, never in that source.

To actually exercise functions locally you need Vercel's own dev server:

```bash
vercel dev
```

That runs the Vite build _and_ the `api/` functions behind one origin, so relative `fetch('/api/…')` calls work exactly as they will in production.

```bash
curl http://localhost:3000/api/hello
# {"ok":true,"message":"custom-hitster api is alive","maxEmbedTracks":100}
```

`api/hello.ts` exists only as a reference shape for Phase 2. The `maxEmbedTracks` field in its response is there to prove that a serverless function can import from `shared/` and have it resolve and bundle correctly — worth re-checking on the first real deploy, since it is the one part of this layout that cannot be fully verified locally.

## Environment variables

Copy `.env.example` to `.env.local` and fill it in. All of these are consumed by Phase 2; nothing in Phase 1 reads them.

| Variable                   | Where to get it                                                                                                                                             | Required           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `UPSTASH_REDIS_REST_URL`   | Create a Redis database at [upstash.com](https://upstash.com/) (or provision Upstash Redis through the Vercel Marketplace, which injects it automatically). | Production only    |
| `UPSTASH_REDIS_REST_TOKEN` | Same place — shown alongside the REST URL.                                                                                                                  | Production only    |
| `MUSICBRAINZ_USER_AGENT`   | You write it. MusicBrainz requires a descriptive `AppName/Version ( contact )` string and rate-limits to 1 req/s; anonymous traffic gets blocked.           | Local + production |

**There are no Spotify credentials, and none are needed.** That is a direct consequence of the Phase 0 research: Spotify's February 2026 API changes mean Client Credentials can no longer read playlist items, and new Development Mode apps are capped at 5 invited users — so no credentialed path can serve "anyone with a public link". The app reads the public embed endpoint with no login instead.

## Deploy

The repo is **deploy-ready but not linked**. `vercel.json` declares the build command, output directory, and routing; linking and deploying are done manually:

```bash
vercel link
vercel deploy
```

After the first deploy, confirm `/api/hello` returns `maxEmbedTracks: 100` — that verifies the `shared/` import resolved inside the real function bundle.

### Why the `vercel.json` rewrite excludes `/api/*`

`vercel.json` must be strict JSON and cannot carry comments, so the reasoning lives here:

```json
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

A single-page app needs a catch-all rewrite so that any unmatched path returns `index.html` and client-side routing works. But a naive catch-all (`/(.*)` → `/index.html`) would swallow the API routes too: a request to `/api/playlist` would be handed the HTML shell instead of reaching the function. The negative lookahead `(?!api/)` makes the rewrite skip anything under `/api/`, leaving those paths to the Vercel Functions in `api/`.

## Known limitations

- **Playlists are capped at 100 tracks, and the app cannot tell when it happened.** The Spotify embed endpoint returns at most 100 tracks, and its payload contains **no pagination signal whatsoever** — no total, no offset, no `hasMore`. A response of exactly 100 tracks is therefore indistinguishable from a playlist that genuinely holds 100. There is no way to page past track 100: the anonymous bearer token in the embed payload was tested against the Web API and returns `429 QUOTA_EXCEEDED` immediately, because its client ID is shared by every embed viewer on the internet. Phase 6 will show a non-blocking warning whenever a playlist comes back with exactly 100 tracks. A manual track-paste fallback is deferred past v1.
- **The embed endpoint is unofficial and may change or break without notice.** Reading it is outside Spotify's Developer Terms; this is an accepted risk for a personal project. All scraping is confined to a single adapter module so a breakage is contained, and the QR code is always rendered regardless of whether audio or metadata extraction works — so the deck degrades rather than dies.
- **Release years will sometimes be wrong.** MusicBrainz has no canonical "original studio recording" per song; famous tracks have hundreds of competing live, bootleg, and reissue entries. Phase 2 filters candidates by release-group type, and Phase 6 adds a year review/edit screen before the deck starts.
- **In-app audio covers ~99.5% of tracks, not all of them.** Measured across 398/400 tracks in Phase 0. For a track with no preview URL, Play/Pause and Restart are disabled; the QR code and Exit still work.

## A note on the Node version

`engines.node` is `24.x` and does not match a typical local install, on purpose. Vercel Functions offer only three Node majors — 24.x (default), 22.x, 20.x — and only majors. Node 25.x is an odd-numbered "Current" release that never becomes LTS and is not on Vercel's menu, so `engines.node` cannot name it. **Do not "fix" this to match your local Node.**

Running a newer local Node than 24 is fine; `pnpm` will print an `Unsupported engine` warning on install, which is expected and harmless. The one real consequence is that `vercel dev` executes functions on your local Node while production runs 24 — negligible for `api/` code that only does `fetch`, JSON parsing, and rate limiting, but worth remembering before reaching for a brand-new Node API. Installing Node 24 LTS locally closes that gap and silences the warning.

## Project layout

```
api/        Vercel serverless functions. Node runtime. Imports shared/ by RELATIVE path.
shared/     Code used by BOTH src/ and api/. No DOM, no Node-specific APIs.
src/        The React SPA. May use the @/ alias.
docs/plans/ The phase plan and per-phase implementation plans.
```

Conventions, and the rules about which tree may import what, are in [`AGENTS.md`](./AGENTS.md).
