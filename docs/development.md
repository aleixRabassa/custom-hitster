# Development

---

## 1. Prerequisites

| Tool       | Version     | Notes                                                                                                                                                                                                                                                             |
| ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | **24.x**    | Pinned in `.node-version` and `engines.node`. A newer local Node works but warns — see [`toolchain.md`](./toolchain.md) §4.                                                                                                                                       |
| pnpm       | **10.29.2** | Pinned in `packageManager`. **pnpm is the only supported package manager.**                                                                                                                                                                                       |
| Vercel CLI | any recent  | Optional, and **needs no install** — run it as `npx vercel …`. Only needed to run the serverless functions locally, or to deploy. Deliberately not a devDependency: it is a large tree for something most sessions never touch, and Phase 1 locked a minimal one. |

There is **no Docker, no docker-compose, and no database to provision.** Setup is an install and a dev server.

---

## 2. First-time setup

```bash
pnpm install
cp .env.example .env.local   # set MUSICBRAINZ_USER_AGENT if you want /api/year
pnpm dev                     # http://localhost:5173
```

`pnpm install` should report **no `typescript-eslint` peer warning**. The only expected warning is `Unsupported engine` if your local Node is not 24.x, which is deliberate.

`pnpm dev` serves the React app only. It does **not** serve anything under `api/` — see §4, and read it before concluding a function is broken.

Environment variables are all consumed by `/api/year`. **Only `MUSICBRAINZ_USER_AGENT` matters locally** — put your own contact address in it. The two Upstash variables are production-only; without them the year cache and the rate-limit gate both fall back to per-instance implementations and everything still works. The full reference, including what breaks when each one is missing, is in [`api.md`](./api.md) §4.

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

To actually exercise functions you need Vercel's own dev server. **There is nothing to install** — `npx` fetches the CLI on demand, and a bare `vercel` will just report `command not found`:

```bash
npx vercel link    # once per clone, interactive
npx vercel dev
```

That runs the Vite build _and_ the `api/` functions behind one origin, so relative `fetch('/api/…')` calls work exactly as they will in production. `vercel dev` reads `.env.local` automatically, so **restart it after editing that file** — the year endpoint reads its configuration at cold start.

```bash
curl http://localhost:3000/api/hello
# {"ok":true,"message":"custom-hitster api is alive","maxEmbedTracks":100}
```

Note that `vercel dev` runs functions on your **local** Node, while production runs 24.x.

### Exercising `/api/playlist`

**Use `npx vercel dev`, not `pnpm dev`.** Through Vite this endpoint returns the transpiled source of `api/playlist.ts` with a `200` — a response that looks like success and proves nothing.

```bash
curl "http://localhost:3000/api/playlist?url=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
```

Expect `{"playlist":{…},"cards":[…],"truncated":false,"skippedCount":0}` — 50 cards for that playlist, titles and artists that look right, and `previewUrl` present on nearly all of them.

The checks worth running by hand, because each pins a decision rather than a value:

```bash
# A well-formed but nonexistent ID must be 404 — NOT a 200 with an empty deck.
curl -i "http://localhost:3000/api/playlist?url=0000000000000000000000"

# An album link is a distinct error from junk: 400 unsupported-entity vs 400 invalid-url.
curl -i "http://localhost:3000/api/playlist?url=https://open.spotify.com/album/0000000000000000000000"
curl -i "http://localhost:3000/api/playlist?url=nonsense"

# A playlist over the cap: exactly 100 cards and truncated=true (Rock Classics).
curl -s "http://localhost:3000/api/playlist?url=37i9dQZF1DWXRqgorJj26U" | grep -o '"truncated":[a-z]*'

# Wrong verb: 405 with an Allow header.
curl -i -X POST "http://localhost:3000/api/playlist?url=37i9dQZF1DXcBWIGoYBM5M"
```

Also confirm the response carries **no** upstream HTML and **no** `accessToken` — the embed payload contains an anonymous Spotify bearer token that must never reach the client. An adapter test asserts this, but it is worth eyeballing once.

A failure body is always `{"code":…,"message":…}` with a typed code; the full table is in [`api.md`](./api.md) §1.

> Adapter behaviour itself does **not** need `vercel dev` — `api/_lib/spotify-embed.test.ts` covers every branch offline against captured fixtures, which is why the manual list above is short and about the handler.

### Exercising `/api/year`

**Use `npx vercel dev`, not `pnpm dev`** — same trap as above.

Set `MUSICBRAINZ_USER_AGENT` in `.env.local` first, with a real contact address.

> **Read this before resolving more than a handful of tracks locally.** `vercel dev` runs a **fresh
> process per invocation** — measured 2026-08-04, three requests gave three different PIDs. Nothing in
> module scope survives, and `globalThis` does not help. So with no Upstash credentials configured:
>
> - **the in-memory cache never hits** — the same track twice returns `cached: false` both times, and
>   the `[year-cache] …` line printing on _every_ request rather than once is the tell;
> - **the rate-limit gate paces nothing** — each invocation builds a gate with `nextAllowedAt = 0`, so
>   every request is admitted and five rapid ones return `200 200 200 200 200`.
>
> The second one matters: your machine is then sending MusicBrainz **completely unpaced** traffic, two
> requests per lookup, against a published limit of 1 req/s that they enforce by blocking. Single curl
> commands are fine. **A 50-track run is ~100 unthrottled requests — configure Upstash first.** The
> Redis gate is cross-process and works correctly under `vercel dev` for exactly that reason.
>
> Production is unaffected: Vercel keeps a warm instance, so module scope persists and both fallbacks
> behave as documented.

```bash
curl "http://localhost:3000/api/year?title=Billie%20Jean&artist=Michael%20Jackson&durationMs=293826"
# {"year":1982,"confidence":"high","source":"release-group","cached":false,
#  "cleanedTitle":"Billie Jean","stripped":{…}}
```

Pass `durationMs` whenever you have it. It becomes a `dur:` bound on the MusicBrainz query, and that bound is what makes the answer accurate rather than merely plausible — see [`api.md`](./api.md) §1.

Watch the cold-start log lines. They tell you which mode you are in, and they exist because a silent fallback is indistinguishable from a cache that never hits:

```
[year-cache] using in-memory cache (per-instance, not shared)
[rate-limit] using per-instance pacing (does NOT enforce the global 1 req/s)
```

The checks worth running by hand, because each pins a decision rather than a value. **These four work with no Upstash:**

```bash
# A remaster suffix must be stripped AND still resolve — verbatim it returns zero results.
curl -s ".../api/year?title=Bohemian%20Rhapsody%20-%20Remastered%202011&artist=Queen&durationMs=354320"
# expect year 1975 and cleanedTitle "Bohemian Rhapsody"

# Nonsense must be year:null / confidence:none with a reason — not a wrong year, not a 500.
curl -s ".../api/year?title=Zzzqqq%20Nope&artist=Nobody%20At%20All"

# Unset MUSICBRAINZ_USER_AGENT and restart: every call must be 500 not-configured,
# including ones that would have hit the cache.
curl -i ".../api/year?title=Billie%20Jean&artist=Michael%20Jackson"

# Wrong verb: 405 with an Allow header.
curl -i -X POST ".../api/year?title=Imagine&artist=John%20Lennon"
```

**These two need Upstash configured**, because both depend on state surviving between requests, which under `vercel dev` it does not (see the warning above). Without it the first prints `cached:false` twice and the second prints five `200`s — that is the dev server, not a bug:

```bash
# Same track twice: the second must report cached:true and return instantly.
curl -s ".../api/year?title=Billie%20Jean&artist=Michael%20Jackson&durationMs=293826" | grep -o '"cached":[a-z]*'

# Several at once: expect a 429 with retryAfterMs, not a hang and not a MusicBrainz 503.
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code} " ".../api/year?title=Imagine&artist=John%20Lennon&durationMs=$((187000+i))"; done
```

**A 429 is expected behaviour under load, not a bug.** MusicBrainz allows 1 request per second and a lookup costs two, so a client firing several cards at once will be told to come back. It carries `retryAfterMs` and a `Retry-After` header; Phase 3's progressive loading is built to back off on exactly this.

Expect **1.3-3.6 s per cold track** (measured 2026-08-04 in-process, with the gate active) and effectively 0 ms once cached. A cold 100-track playlist is therefore several minutes — which is why progressive loading is structural rather than polish.

**Do not take timings through `vercel dev`.** It adds roughly **four seconds per request** spawning that per-invocation process — a request returning a 500 with no network access at all still took 4-5 s. Any wall-clock number measured through it is the dev server, not the resolver, and Upstash does not change that. Measure against a real deployment when you need a figure Phase 3 can design against.

> As with the embed adapter, none of the resolution logic needs `vercel dev`: `shared/year.test.ts`, `api/_lib/musicbrainz.test.ts` and `api/_lib/resolve-year.test.ts` cover it offline against captured fixtures, including a fixture-backed accuracy suite over the Phase 0 known-tricky tracks.

---

## 5. Running tests

```bash
pnpm test          # once
pnpm test:watch    # watch mode
```

Current suite: **118 tests across 9 files**, all passing, and **all of them offline** — no test touches the network. That is deliberate: a test that really called MusicBrainz would be rate-limited to 1 req/s, would drift as the database improves, and would fail for reasons unrelated to the code.

The suite runs green **with no environment variables set at all**, which is the new-contributor path. If you have to configure something to make tests pass, that is a bug.

The centre of gravity is `shared/year.test.ts`'s accuracy suite: it runs the scorer over captured candidates for fourteen Phase 0 known-tricky tracks and asserts each one's **known-correct** year, not whatever the code currently produces. Phase 0 measured a naive lookup at ~6% accurate; that suite is the evidence the pipeline beats it and the thing that catches a regression in scoring. Fixture provenance is documented in the headers of `shared/__fixtures__/year-candidates.ts` and `api/_lib/__fixtures__/musicbrainz-payloads.ts`.

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
- **Release years will sometimes be wrong.** MusicBrainz has no canonical "original studio recording" per song; famous tracks have hundreds of competing live, bootleg, and reissue entries. As built, the strict pass resolved **14 of 14** known-tricky tracks exactly (2026-08-04) against a ~6% naive baseline — but that is a curated set, not a random one, and a track the strict filters cannot place falls through to a relaxed pass that is measurably off by a year or so. Those come back as `confidence: 'low'`, and Phase 6 marks them unconfirmed on the card's revealed side. There is no pre-Start review of years — the player pastes the playlist, so that would spoil the deck.
- **Year resolution is slow the first time, and the 1 req/s budget is shared by everyone.** A lookup costs two paced MusicBrainz requests, so a cold 100-track playlist takes several minutes. The cache means only genuinely new songs ever pay it — but the budget is global, so two people resolving cold playlists at once each get half the throughput. Acceptable for a personal project; the number to watch if the app is ever shared widely.
- **In-app audio covers ~99.5% of tracks, not all of them.** Measured across 398/400 tracks in Phase 0. For a track with no preview URL, Play/Pause and Restart are disabled; the QR code and Exit still work.
