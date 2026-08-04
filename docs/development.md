# Development

---

## 1. Prerequisites

| Tool       | Version     | Notes                                                                                                                       |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | **24.x**    | Pinned in `.node-version` and `engines.node`. A newer local Node works but warns — see [`toolchain.md`](./toolchain.md) §4. |
| pnpm       | **10.29.2** | Pinned in `packageManager`. **pnpm is the only supported package manager.**                                                 |
| Vercel CLI | any recent  | Optional. Only needed to run the serverless functions locally, or to deploy.                                                |

There is **no Docker, no docker-compose, and no database to provision.** Setup is an install and a dev server.

---

## 2. First-time setup

```bash
pnpm install
cp .env.example .env.local   # optional in Phase 1 — nothing reads it yet
pnpm dev                     # http://localhost:5173
```

`pnpm install` should report **no `typescript-eslint` peer warning**. The only expected warning is `Unsupported engine` if your local Node is not 24.x, which is deliberate.

`pnpm dev` serves the React app only. It does **not** serve anything under `api/` — see §4, and read it before concluding a function is broken.

Environment variables are all consumed by Phase 2; nothing in Phase 1 reads them. The full reference is in [`api.md`](./api.md) §4.

---

## 3. Scripts

| Script               | What it does                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`           | Vite dev server with HMR on `:5173`. Client only; `api/` is not served.                                                                 |
| `pnpm build`         | Production build to `dist/`. **Does not typecheck** — run `pnpm typecheck` for that.                                                    |
| `pnpm preview`       | Serves the built `dist/` locally to sanity-check a production build.                                                                    |
| `pnpm typecheck`     | The real type gate. Runs `typecheck:app` **and** `typecheck:api`.                                                                       |
| `pnpm typecheck:app` | Typechecks `src/` + `shared/` with DOM libs, via `tsconfig.app.json`.                                                                   |
| `pnpm typecheck:api` | Typechecks `api/` + `shared/` with Node types and **no** DOM lib. This is what catches a browser API used inside a serverless function. |
| `pnpm test`          | Runs the Vitest suite once.                                                                                                             |
| `pnpm test:watch`    | Vitest in watch mode.                                                                                                                   |
| `pnpm lint`          | ESLint across `src/`, `api/`, and `shared/`.                                                                                            |
| `pnpm lint:fix`      | Same, applying autofixes.                                                                                                               |
| `pnpm format`        | Prettier `--write` across the repo.                                                                                                     |
| `pnpm format:check`  | Prettier in check mode; fails instead of rewriting.                                                                                     |
| `pnpm tsc:versions`  | Diagnostic. Prints both installed TypeScript versions (expect `6.0.3` then `7.0.2`).                                                    |

`build` and `typecheck` are separate **on purpose**: `build` must not run `tsc -b`, because this repo cannot use TypeScript project references. See [`toolchain.md`](./toolchain.md) §2.

---

## 4. Running the serverless functions locally

`pnpm dev` starts Vite, which has no concept of Vercel Functions. **`api/` is not executable through it, and what happens instead is misleading:** `GET /api/hello` returns the _transpiled source_ of `api/hello.ts` as `text/javascript` with a **`200`** status — it does not run the handler and does not fall through to the SPA. Full explanation in [`architecture.md`](./architecture.md) §5.

To actually exercise functions you need Vercel's own dev server:

```bash
vercel dev
```

That runs the Vite build _and_ the `api/` functions behind one origin, so relative `fetch('/api/…')` calls work exactly as they will in production.

```bash
curl http://localhost:3000/api/hello
# {"ok":true,"message":"custom-hitster api is alive","maxEmbedTracks":100}
```

Note that `vercel dev` runs functions on your **local** Node, while production runs 24.x.

---

## 5. Running tests

```bash
pnpm test          # once
pnpm test:watch    # watch mode
```

Current suite: **3 tests in 1 file** (`shared/constants.test.ts`), all passing. They cover the exported constant and — deliberately — the Vitest/TypeScript resolution wiring itself, so that a resolution failure is reported as one obvious broken test rather than as every future phase's suite failing for an unexplained reason.

Tests are discovered at `{src,shared,api}/**/*.{test,spec}.{ts,tsx}` in a **`node`** environment. There is no DOM environment yet: `jsdom` and Testing Library arrive with the first component test in Phase 4. Until then, keep tests to pure logic.

---

## 6. Before you commit

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass. **There are no pre-commit hooks and no CI workflow**, so nothing will run these for you.

---

## 7. Deploy

The Vercel project is **linked and deploys** (first deploy 2026-08-03; deploys can also run from a push to `main`, as the 2026-08-04 build log shows). `vercel.json` declares the build command, output directory, and the SPA rewrite that excludes `/api/*`.

```bash
vercel deploy
```

**After a deploy that touches the `src`/`api`/`shared` layout, confirm `/api/hello` really returns `maxEmbedTracks: 100`.** That single check verifies the relative `shared/` import resolved inside the real function — the one part of this layout that cannot be verified locally at all.

**Actually run it.** On 2026-08-04 this check was run for the first time and returned **500 `FUNCTION_INVOCATION_FAILED`**: the import had no `.js` extension, which a `"type": "module"` ESM function cannot resolve. The build log was clean, and `typecheck`, `lint`, `test`, `build` and `format:check` were all green. A deploy that "succeeded" is not evidence that a function runs — only a request is.

Two things to check before deploying, neither of which any local tool can see:

- **Grep for `@/` under `api/`.** An aliased import there type-checks locally and fails only at deploy time.
- **Check every relative import under `api/` ends in `.js`.** Same failure class, discovered the same way — see [`architecture.md`](./architecture.md) §2.

If a function returns `FUNCTION_INVOCATION_FAILED`, the Vercel **runtime** log (`vercel logs <deployment-url>`, or the dashboard's Runtime Logs) names the underlying error; the build log will not mention it. Retention is short, so request the failing route again to generate a fresh entry before looking.

---

## 8. Known limitations

Carried forward from the Phase 0 research; measurements and reasoning in [`plans/plan.md`](./plans/plan.md) §5.

- **Playlists are capped at 100 tracks, and the app cannot tell when it happened.** The Spotify embed endpoint returns at most 100 tracks and its payload contains **no pagination signal whatsoever** — no total, no offset, no `hasMore` — so a response of exactly 100 is indistinguishable from a playlist that genuinely holds 100. There is no way to page past track 100: the anonymous bearer token in the embed payload was tested against the Web API and returns `429 QUOTA_EXCEEDED` immediately, because its client ID is shared by every embed viewer on the internet. Phase 6 will show a non-blocking warning at exactly 100 tracks; a manual track-paste fallback is deferred past v1.
- **The embed endpoint is unofficial and may change or break without notice.** Reading it is outside Spotify's Developer Terms; this is an accepted risk for a personal project. All scraping is to be confined to a single adapter module so a breakage is contained, and the QR code is always rendered regardless of whether audio or metadata extraction works — so the deck degrades rather than dies.
- **Release years will sometimes be wrong.** MusicBrainz has no canonical "original studio recording" per song; famous tracks have hundreds of competing live, bootleg, and reissue entries. Phase 2 filters candidates by release-group type, and Phase 6 adds a year review/edit screen before the deck starts.
- **In-app audio covers ~99.5% of tracks, not all of them.** Measured across 398/400 tracks in Phase 0. For a track with no preview URL, Play/Pause and Restart are disabled; the QR code and Exit still work.
