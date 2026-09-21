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

# The LEGACY path. Rejected as unsupported-entity until 2026-08-05; must now be a 200.
curl -s "http://localhost:3000/api/playlist?url=https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M" \
  | grep -o '"name":"[^"]*"' | head -1

# A SHORT LINK, which is the only one of these you cannot fake: it needs a real
# code from a phone's Spotify share sheet, because the redirect is what carries
# the playlist id. Share any playlist to yourself and paste the spotify.link URL.
curl -s "http://localhost:3000/api/playlist?url=https://spotify.link/YOUR_CODE_HERE" \
  | grep -o '"name":"[^"]*"' | head -1

# And the SSRF guard, which you can fake: a non-Spotify host is refused before
# any request is made, so this must be 502 upstream-unavailable and must NOT
# reach example.com. (The unit tests cover this properly; this is the eyeball.)
curl -i "http://localhost:3000/api/playlist?url=https://spotify.link.evil.example/abc"
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

### Exercising the client-side resolver (`src/game/`)

`src/game/resolver.ts` is the sequential crawl that drives `/api/year` for a whole deck. Its tests inject a fake `lookup` and a fake `sleep`, so they cover ordering, retries, back-off and the priority jump offline and instantly — **that is the normal way to work on it.** Only reach for a real deck when you are measuring something.

When you do, **configure Upstash first.** Without `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` nothing paces MusicBrainz across invocations, and a 50-card deck becomes ~100 unthrottled requests against a service that rate-limits to 1 req/s and blocks clients that ignore it. The per-instance fallback is enough for one-off `curl`s and not enough for a crawl.

**And do not measure through `vercel dev`** — the ~4 s per-invocation overhead above swamps the numbers, and the fresh process per request means the gate and cache never persist anyway. Phase 3's figures were taken by serving the real `api/playlist.ts` and `api/year.ts` over a plain `node:http` server and driving the reducer and resolver against them; the harness was thrown away, and the numbers are in [`agent_findings.md`](./agent_findings.md) (2026-08-05). Reference points for a cold 42-card deck: card-1 gate **6.06 s**, full crawl **153.0 s**, warm re-crawl **0 lookups**.

---

## 5. Running tests

```bash
pnpm test          # once
pnpm test:watch    # watch mode
```

Current suite: **456 tests across 34 files**, and **all of them offline** — no test touches the network. That is deliberate: a test that really called MusicBrainz would be rate-limited to 1 req/s, would drift as the database improves, and would fail for reasons unrelated to the code. All of them must pass before a commit (§6).

The suite runs green **with no environment variables set at all**, which is the new-contributor path. If you have to configure something to make tests pass, that is a bug.

The centre of gravity is `shared/year.test.ts`'s accuracy suite: it runs the scorer over captured candidates for fourteen Phase 0 known-tricky tracks and asserts each one's **known-correct** year, not whatever the code currently produces. Phase 0 measured a naive lookup at ~6% accurate; that suite is the evidence the pipeline beats it and the thing that catches a regression in scoring. Fixture provenance is documented in the headers of `shared/__fixtures__/year-candidates.ts` and `api/_lib/__fixtures__/musicbrainz-payloads.ts`.

Tests are discovered at `{src,shared,api}/**/*.{test,spec}.{ts,tsx}`. The **default environment is `node`**, and a test that needs a DOM opts in per file with a `/** @vitest-environment jsdom */` docblock — fifteen files do (the card components, the screens, the audio hook, and the container). Keeping `node` as the default is what makes a DOM API accidentally added to `shared/` fail here rather than at deploy time. Full detail, including why there is no `setupFiles`, why every DOM file needs its own `afterEach(cleanup)`, and why that tag must never appear in prose, is in [`toolchain.md`](./toolchain.md) §5.

**`src/index.css.test.ts` is a `node` test over the stylesheet's TEXT, and it is labelled a canary rather than a behaviour test.** jsdom evaluates no media queries, so there is no environment here in which `prefers-reduced-motion: reduce` can be made true and observed; the choice was between a text-level assertion that the block exists and names its three `data-motion` hooks, and no coverage at all for the reduced-motion work. The component-side halves are in `Card.test.tsx`, `PreparingScreen.test.tsx` and `QrCode.test.tsx`. What none of them can tell you is whether any of it works — that is §5's Phase 7 pass below.

**`src/App.test.tsx` is the integration seam of the whole app**, and the one place worth understanding before changing it. It drives the real reducer, the real resolver and the real screens from a stubbed storage and two independently stubbed fetches: the **playlist** client gets an injected `fetchImpl` prop, while the **year** resolver goes to a stubbed global `fetch`. The split is what makes the card-1 gate controllable — hang the year stub and the session stays on the preparing screen; answer it and the game screen appears. Stubbing out the resolver entirely would mean never reaching the game screen at all.

**`src/game/gestures.test.ts` is deliberately a `node` test, and it is where the swipe and tap thresholds are actually covered.** jsdom cannot exercise a drag at all — Motion's drag reads element geometry jsdom does not compute — so the decisions were pushed into pure functions that need no DOM. If you are looking for "the swipe tests", they are there, not in a component file. See [`architecture.md`](./architecture.md) §3.

### Manual card verification

**The Phase 4/5 fixture harness is gone.** `src/App.tsx` is the real container as of Phase 6, so manual verification now happens against a real playlist — which means **`npx vercel dev`, not `pnpm dev`** (§4: Vite cannot run `/api/playlist`, so Start fails with the `unexpected-payload` message). `public/dev-preview.wav`, the generated arpeggio the harness substituted for the fixture cards' invented preview URLs, was deleted with it: a real deck carries real 30-second previews, so there is nothing left to stand in for.

The fixture deck still exists at `src/components/__fixtures__/cards.ts` and is still the thing every component test renders from — it is only the _browser_ harness that is gone. To eyeball one specific card shape, the fastest route is now a component test in watch mode, not a page.

Six things about the card cannot be asserted from a test, and the last one cannot be checked on a desktop at all:

| Check                                                                                                                                        | Status                          |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Flip and Next                                                                                                                                | **Verified 2026-08-05 — works** |
| Play, pause, restart; audio stops on flip and on advance                                                                                     | Pending — needs a real deck     |
| **Devtools DOM search on an UNFLIPPED card** for the current track's title, artist and year — all three must be absent, not merely invisible | Pending                         |
| **Scan the QR with a real phone** and confirm it opens the right track in Spotify                                                            | **Verified 2026-08-05 — works** |
| A preview-less track disables Play/Pause and Restart while Exit and the QR stay live (rare — ~0.5% of tracks; Reggae Classics has two)       | Pending                         |
| The four year states render distinctly (plain / unconfirmed / "check this one yourself" / still looking up)                                  | Pending                         |
| **On Android (or Chrome's media panel): start playback and confirm the notification and lock screen show no track title or artist**          | Pending — needs real hardware   |

The last row is the one that matters most and the only leak vector no automated test in this repo can reach: nothing on the page can retract metadata once the OS media session has it. The code side is settled — a test asserts the app never writes `navigator.mediaSession.metadata` — but whether a browser populates that panel from a bare MP3 on its own is a question only a device answers.

**Do not measure timings through `vercel dev`** for any of this. Nothing in the card path needs a function, and the ~4 s per-invocation overhead makes every number meaningless (§4).

### Gesture verification on a real device — scoped, then waived

**Decided 2026-08-05: this pass will not be performed.** Phase 5 shipped without it. The checklist is kept here rather than deleted because it is the only way the gesture thresholds ever get validated, and because someone hitting bad touch behaviour later needs to know that this was a known gap rather than a tested-and-fine path.

To reach the dev server from a phone on the same network:

```bash
pnpm dev --host          # prints a Network: http://192.168.x.x:5173 URL
```

Open that URL on the phone. A preview deploy (`vercel deploy`) works too and is the better option for iOS, which is stricter about non-HTTPS origins for some APIs. Nothing in the card path needs a serverless function, so `vercel dev` is not required.

What was never checked:

| Check                                                                                                    | Why it matters                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| iOS Safari: tap-to-flip fires reliably, and a tap is never read as a swipe                               | A tap misread as a swipe skips a card, or since 2026-09-18 steps back onto one — either way the guess is lost    |
| iOS Safari + Android Chrome: a deliberate slow drag of ~⅓ the card's width commits                       | `SWIPE_COMMIT_DISTANCE_PX` is a guess at 96px                                                                    |
| Both: a fast flick advances, and a drag released below threshold snaps back                              | The offset-**or**-velocity rule, and the dead band between the two thresholds                                    |
| Both: a swipe is never misread as a tap                                                                  | That reveals the answer the player was mid-guess on                                                              |
| Both: no rubber-band scroll or pull-to-refresh steals the gesture, especially near the top of the screen | `overscroll-behavior: none` + `touch-none` are the mitigations; neither is confirmed                             |
| iOS Safari: no accidental text selection and no long-press context menu on the card                      | Open question — `select-none` was **not** added pre-emptively, pending this check                                |
| iOS Safari: audio still starts from the **first** tap                                                    | iOS is strictest about the user-gesture requirement, and the gesture layer now sits between the tap and `play()` |
| iOS Safari: the layout does not shift as the toolbar shows/hides                                         | The card is viewport-sized and `dvh` behaves differently there                                                   |
| ~~By eye: is 2 backs right, or 3?~~ **Closed 2026-08-06 — the answer is one, and it is the next card**   | `VISIBLE_BACKS` is gone; see the three rows below                                                                |
| Sliding the card aside uncovers the next card **aligned**, not a smaller rectangle inside it             | The old centre-origin `scale()` inset every edge; the back is now `inset-0` with no transform at all             |
| The next card's **QR is already there** when it is uncovered — no pulsing placeholder, mid-drag or after | The point of the preload, and of `src/game/qr-cache.ts` carrying the code across the advance                     |
| At rest the back is **completely invisible**, and the ring's glow is no brighter than before             | Two identical blooms would composite; `card-ring-quiet` suppresses the back's. Compare against a Phase 8 capture |

If any of this turns out to be wrong in the field, **the five constants in `src/game/gestures.ts` are the first place to look** — they are named, documented, and designed to be retuned by someone who did not write them. Changing them requires no change to the hook or to Motion.

The three back rows are jsdom-proof in the usual way: it computes no layout, so `CardStack.test.tsx` can pin the class names and the **absence** of a transform and nothing more. One drag in a browser is the whole check.

### Playing a real game, and the progressive-loading verification

**`npx vercel dev`, then paste a playlist link.** `pnpm dev` cannot do this at all: pressing Start returns the transpiled source of `api/playlist.ts` with a 200, which `playlist-client.ts` correctly reports as `unexpected-payload` — so the app shows _"Spotify returned something we could not read"_ and you may reasonably think the client is broken when it is doing its job.

**Configure Upstash before playing a full deck**, for the reason in §4: without it nothing paces MusicBrainz across invocations, and a 50-card deck becomes ~100 unthrottled requests against a service that rate-limits to 1 req/s and blocks clients that ignore it.

The end-to-end checks worth running by hand, each pinning a decision:

| Check                                                                                            | Status  |
| ------------------------------------------------------------------------------------------------ | ------- |
| Every suggested playlist loads and deals a deck (re-run whenever the set is edited)              | Pending |
| A `spotify.link` URL from a phone's share sheet loads the right playlist                         | Pending |
| A legacy `/user/{user}/playlist/{id}` URL loads instead of erroring                              | Pending |
| A private/deleted playlist and a track URL each produce their inline error copy                  | Pending |
| The truncation notice appears for a 100-track playlist and **never blocks Start**                | Pending |
| Exit returns to the landing screen; finishing the deck reaches the end screen                    | Pending |
| **Restart re-deals with a fresh order and costs no lookups** — watch the network tab stay silent | Pending |
| Reload mid-deck and confirm the session resumes on the same card                                 | Pending |

**Step 15 of [`plan.phase-4-6-screens.md`](./plans/plan.phase-4-6-screens.md) is owed and needs a preview deployment**, not a dev server — it is Phase 3's progressive-loading verification, deferred until there was a UI to exercise it through. Deploy a preview **with Upstash configured** (the cache and the gate are backed by the same two variables) and confirm:

- Start waits on **one** lookup on a cold deck, not the whole deck.
- Cards 2..n fill during play, and flip / swipe / QR / audio / Exit never block on a pending year.
- The priority jump: advance rapidly past the resolver and watch the current card get served next.
- A 429 backs off rather than failing a card.
- The **50-track cold-deck wall clock** — owed since Phase 2 and still unmeasured.
- **Exactly one `/api/year` request per card under React 19 StrictMode**, by counting requests in the network tab rather than assuming. `use-game-session.ts` has a double-crawl guard that nothing tests.

**Do not take timings through `vercel dev`** — the ~4 s per-invocation overhead swamps them, and the fresh process per request means the gate and cache never persist (§4).

### Phase 7 look-and-access verification — nothing here is closed, and no local check can close it

Phase 7's first half landed the `@theme` tokens, the fluid card, `prefers-reduced-motion`, focus
states and the ARIA/contrast fixes. **Every behavioural claim it makes is unverified**, because the
whole class of behaviour is outside what this repo's tests can reach: jsdom evaluates no media
queries and has no `window.matchMedia` at all, computes no layout, and has no accessibility-tree
consumer. What is automated is both ends of each contract — a component renders a hook, the
stylesheet names it — and the middle is these four passes.

Use `npx vercel dev` for anything that needs a real deck (§4).

**Reduced motion.** Set the preference at the **OS** level as well as via devtools emulation
(Chrome: Rendering panel → _Emulate CSS prefers-reduced-motion_) — they exercise the same media query
but only the OS path proves the app sees the real thing.

| Check                                                                               | Status  |
| ----------------------------------------------------------------------------------- | ------- |
| The flip is instant: the face changes without travelling                            | Pending |
| The preparing spinner is **gone**, not frozen — a still spinner reads as a hung app | Pending |
| "Dealing your deck…" and the first-card line are both still there without it        | Pending |
| The QR placeholder is a static grey box, same size, no pulse                        | Pending |
| A committed card **fades** instead of flying 600px                                  | Pending |
| **The drag still works** — direct manipulation is not an animation                  | Pending |

The last row is the regression `MotionConfig reducedMotion="user"` could plausibly introduce, and it
is the one worth checking first: if the drag is dead under the preference, the game is unplayable by
touch for exactly the users who asked for less motion.

**Phase 8's ring adds no row here, and that is the point of it not animating.** A pulsing bloom or a
rotating conic gradient was the reference aesthetic and was rejected precisely so this table would not
grow a seventh row and the media query would not grow a fourth rule. The ring is static, so this pass
covers exactly what it covered before — it is **not** invalidated by the redesign.

**Three widths.** 320px, a tablet, and a wide desktop, across every screen.

| Check                                                                             | Status                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------- |
| At 320px the card **and** its control bar both fit, with the HUD still on screen  | Pending                                     |
| The back stays exactly aligned with the card at all three widths                  | Pending — **rebuilt 2026-08-06**, see below |
| The HUD and the notice banner line up with the card's width when wide             | Pending                                     |
| A long user-created playlist name truncates without pushing the count off the row | Pending                                     |
| The landing screen's suggestions are all usable at 320px                          | Pending                                     |
| A phone in **landscape**: the card fits the short viewport                        | Pending                                     |
| The card is **square** at all three widths, not merely square on a desktop        | Pending — **new 2026-08-11**, see below     |
| The three control gaps read as EQUAL to the gaps at the card's edges              | Pending — **new 2026-08-11**, see below     |
| The enlarged QR fits the face on the **240px floor card**, uncropped              | Pending — **new 2026-08-11**, see below     |
| The scan caption sits under the card and is legibly dim, not invisible            | Pending — **new 2026-08-11**, see below     |
| The footer sits at the bottom on a short screen and at the end of a long scroll   | Pending — **new 2026-08-11**, see below     |
| Start to the suggestions reads as a normal margin, not a void                     | Pending — **new 2026-08-12**, see below     |
| The copyright line has visibly EQUAL air above and below it                       | Pending — **new 2026-08-12**, see below     |
| The **game screen** still fits a short phone without scrolling                    | Pending — **new 2026-08-12**, see below     |

The landscape row is what the `62dvh` term in `--card-height` exists for; without it a landscape
phone gets a card taller than its viewport ([`architecture.md`](./architecture.md) §3).

> **The last five rows are 2026-08-11's, and every one of them is arithmetic until somebody looks.**
> The card is square because `--card-width` is `var(--card-height)`, the four gaps are equal because the
> control row is `w-(--card-width)` with `justify-evenly`, and the QR fits because 3/4 of the 240px floor
> card is 180px inside a 192px padded box. jsdom computes no layout, so none of that is observed
> anywhere — and **the QR row is the one with a silent failure mode**: the face is `overflow-hidden`, so a
> code that does not fit is **cropped rather than overflowing**, and a cropped QR does not scan while
> looking almost right. Scan it, do not just look at it — and scan it at the FLOOR size, which is where
> the enlargement has the least margin.
>
> The caption row is about a contrast token doing its job on a surface it was not measured against:
> `--color-fg-muted` is recorded at 6.12:1 on `--color-page`, but it sits directly under a card with a
> neon bloom around it, and glow beside small dim text is a legibility question a ratio does not answer.
> The footer row has **two cases and they are different code paths in effect**: on the preparing and
> end screens the column is shorter than the viewport, so `<main>` is exactly `min-h-dvh` and the
> absolutely positioned line lands at the bottom of the screen; on the landing screen at 320px the
> column outgrows the viewport, so `<main>` stretches and the line lands at the end of the scroll
> instead. Check both, and check that it never sits ON the last suggestion — the reserved band
> (`pb-20`, the same on all five screens — four since 2026-08-12, the welcome screen since 2026-09-18) is the
> only thing separating them, and jsdom cannot see a pixel of it.
>
> **The three 2026-08-12 rows are the same shape: arithmetic that nothing here executes.** The gap
> row is the removal of the hero's `min-h-[88dvh]` — the suite asserts the class is absent and cannot
> see the distance that replaced it. The copyright row is `bottom-8` inside `pb-20`, i.e. 32px above
> and 32px below a ~16px line; the two numbers are paired and a `bottom-4` sneaking back leaves every
> check green. **The game-screen row is the one with a real failure mode**: the footer's band costs
> that column 56px it did not spend before, and that column is a height budget (`--card-height` exists
> so the HUD, card, caption and controls fit a phone). If it overflows, the fix is the `62dvh` term,
> **not** removing the footer from that screen — see [`architecture.md`](./architecture.md) §3.

> **The backs row was a measured failure and the geometry has now been replaced rather than retuned.**
> At the card's 448px ceiling the two peeking backs peeked by **1.04px** and **2.08px** at the bottom and
> were inset on every other side: `scale()` is centre-origin and lifted the bottom edge by
> `(H / 2) × BACK_SCALE_STEP` (8.96px) while `translateY` pushed it down only 10px. That inset is also
> what a player saw as "two cards, one inside the other" when they slid the top card aside.
>
> Since 2026-08-06 there is **one back, at `inset-0`, with no transform of any kind**, holding the next
> card's hidden face with its QR preloaded — so there is no peek to tune and no depth cue at rest. The
> row above is therefore about **exact alignment**, and the interesting widths are the ends of the
> card's clamp. Written up in [`agent_findings.md`](./agent_findings.md); the two constants are gone.

**Keyboard only.** No mouse, no touch — Tab, Space and →.

| Check                                                                                                     | Status  |
| --------------------------------------------------------------------------------------------------------- | ------- |
| Every one of the thirteen interactive elements shows a visible ring on Tab                                | Pending |
| The ring is legible on the page, on a card face, on a control, and on the emerald button                  | Pending |
| A **mouse click** leaves no ring behind — that is what `focus-visible` buys                               | Pending |
| Tab order through the landing screen is sensible, and Enter submits                                       | Pending |
| Space flips and → advances through several cards                                                          | Pending |
| **Space on a focused button does not also flip the card** — Phase 5 guards it, Phase 7 restyled around it | Pending |
| Exit is reachable and works                                                                               | Pending |

**Screen reader.** VoiceOver, NVDA or Narrator over one flip. This is the pass that matters most,
because Phase 7 added the app's only live region and the whole point of it is audible.

| Check                                                                              | Status  |
| ---------------------------------------------------------------------------------- | ------- |
| Flipping a card **announces** the year, title and artist                           | Pending |
| An **unflipped** card announces nothing about its track                            | Pending |
| The announcement is polite — it does not interrupt mid-sentence                    | Pending |
| The landing input's accessible name is "Playlist link", matching its visible label | Pending |
| A submission error is announced, **and** reachable again by focusing the field     | Pending |
| The HUD's card count is announced as it changes                                    | Pending |

A live region that mounts already-populated is the known soft spot: screen readers differ on whether
they announce content present at insertion versus content changed afterwards. If the flip turns out
silent in practice, that is the mechanism to look at — not the role.

> **Phase 8 plan 1 carried this pass and did NOT discharge it — every row above is still Pending, and
> no reader has been named.** The plan listed it as its own step 16 on the grounds that it is the
> highest-value outstanding check in the phase and that the card was being rebuilt around the very
> component it tests. The rebuild happened and the pass did not.
>
> What the redesign did do is leave it testing exactly what it was written for: `CardRevealSide` still
> mounts **only while the card is flipped**, its `role="status"` is untouched, and the single edit to that
> component was the year's colour. So nothing above needs rewording — it needs running, with the reader
> and platform recorded. "It worked" without naming NVDA, VoiceOver or Narrator is not a result anyone
> can build on.

#### The before/after screenshot comparison

Step 12 of [`plan.phase-7-look.md`](./plans/plan.phase-7-look.md) is **owed**. The plan's success
condition was that tokenising changed nothing visible, so the comparison is the check on that claim.
The pre-Phase-7 tree is commit `89f40f4`.

**At a desktop width and height the card resolves to exactly 288 × 448 — its pre-Phase-7 size — so the
card, the QR and every layout should be pixel-identical there.** That makes desktop the clean place to
ask "did tokenising change anything it should not have", and the three-width pass above the place to
check the geometry.

Seven changes **are** expected to be visible. Anything else is an accident:

| Change                                           | Where                                          | Why it is sanctioned         |
| ------------------------------------------------ | ---------------------------------------------- | ---------------------------- |
| Muted text lighter (`#737373` → `#8f8f8f`)       | HUD, five other lines, the input placeholder   | Contrast — 4.18:1 and 2.30:1 |
| Primary button labels near-black, not white      | Start, Play again                              | Contrast — 3.67:1            |
| Disabled controls less dim (40%/50% → 60%)       | Play/Pause, Restart, input, Start, suggestions | Contrast — 3.46:1            |
| A visible focus ring on Tab                      | all thirteen interactive elements              | There was none               |
| HUD and notice narrower on a wide screen         | game and preparing screens                     | They never lined up          |
| Round controls and Dismiss larger                | `CardControls`, `NoticeBanner`                 | 44px minimum                 |
| The card shrinks below ~723px of viewport height | game screen                                    | The geometry clamp           |

Measured ratios for all of it are in [`agent_findings.md`](./agent_findings.md).

### Phase 7 failure-state and bundle verification

Five checks from [`plan.phase-7-robustness.md`](./plans/plan.phase-7-robustness.md). Unlike the four
above, these are cheap and three of them need only devtools — but all five are **Pending**, and every
one covers a path whose automated test necessarily stubs the very thing being checked.

| #   | Check                                                                                                                                                                                                                                                                                                                   | Status                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Offline.** Devtools → Network → Offline, then press Start. The message must appear **immediately** and **no request may be made** — check the network tab is empty. A code that arrives after a request that timed out is the behaviour this replaced.                                                                | Pending                                                                                                                                                                                                                                                                                                                          |
| 2   | **The error boundary, both paths.** Force a throw (temporarily, in a component), then: **Reload** must keep a game in progress resumable, and **Start over** must clear it — confirm `hitster:session:v1` disappears from Application → Local Storage. Also confirm the screen shows **no error message and no stack**. | Pending                                                                                                                                                                                                                                                                                                                          |
| 3   | **The QR chunk is absent from the landing screen.** Load with a clean network tab: `browser-*.js` must not be requested. Deal a deck and it must arrive. Same for `GameScreen-*.js`. Verified once in Lighthouse's network log; this is the check that it stays true.                                                   | **Done 2026-08-06** — re-run after jsPDF landed, in Chrome against `vite preview`. Six requests on the landing screen, none of them `browser-*.js` or `GameScreen-*.js`. See the Phase 8 rows below for the full list and the chunk-name trap. The "deal a deck and it arrives" half still needs `vercel dev` and is **Pending** |
| 4   | **A mid-game disconnect.** Go offline mid-deck: flip, swipe, the QR and Exit must all keep working, and only audio and further year lookups stop. This is the documented degradation in §8 and nothing signals it, so it is worth seeing once.                                                                          | Pending                                                                                                                                                                                                                                                                                                                          |
| 5   | **The empty-playlist copy against a real playlist**, if one can be made. **Cannot be claimed from the test suite** — the unit test stubs a `cards: []` response. Note that the second route in, a playlist whose every track is unplayable, cannot be constructed on demand at all.                                     | Pending                                                                                                                                                                                                                                                                                                                          |

**The `no-years-found` path is worth one live look too**, and it is the awkward one: it needs a real
playlist obscure enough that MusicBrainz places none of its tracks, which cannot be arranged reliably.
`App.test.tsx` covers it end to end through the container with a stubbed `/api/year` that answers
`null` for everything, which is the honest substitute.

### Phase 8 sharing, saving and printing

Nine checks from [`plan.phase-8-features.md`](./plans/plan.phase-8-features.md), plus three added on
2026-08-06 when the same three actions became reachable mid-game and one on 2026-08-07 when the PDF
export gained its year gate. The unit tests cover every branch
of the link parser, the library's storage validation and the sheet geometry; what they cannot cover
is a clipboard, a `localStorage` shared between tabs, a printer, a phone camera — and, for rows
10-13, a laid-out modal on a real screen and a crawl running at its real pace.

| #   | Check                                                                                                                                                                                                                                                                | Status                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A share link in a clean profile deals the deck with no interaction** — paste the copied URL into a private window and confirm the form is never touched.                                                                                                           | Pending                                                                                                                                                                                                                 |
| 2   | **A share link does NOT discard a game in progress.** Start a deck, then open a link in the same tab: the game must survive and the params must be ignored.                                                                                                          | Pending                                                                                                                                                                                                                 |
| 3   | **Copy actually copies.** `navigator.clipboard` needs a secure context, so check on the deployment as well as on `localhost` — and confirm the fallback field appears (not a dead button) where it rejects.                                                          | Pending                                                                                                                                                                                                                 |
| 4   | **Two playlists saved, reload, play one, remove the other.** The library is read once on mount, so the reload is the half that matters.                                                                                                                              | Pending                                                                                                                                                                                                                 |
| 5   | **Export a real deck, print it double-sided on the LONG edge, and check front/back alignment.** Hold a sheet to a light: the cut outlines must coincide. If they do not, the printer used short-edge binding — which is not supported, and which no code can detect. | Pending                                                                                                                                                                                                                 |
| 6   | **Scan a printed QR with a phone.** The printed palette is light and the code has a 6 mm paper quiet zone plus one module of its own; both exist for this check.                                                                                                     | Pending                                                                                                                                                                                                                 |
| 7   | **Export a deck with a Cyrillic or CJK title** and confirm the `?` placeholders are the only damage — the year and the QR must be intact. This is the documented cost of sanitising instead of embedding a font (§8).                                                | Pending                                                                                                                                                                                                                 |
| 8   | **Export a 100-card deck** and watch the progress count climb rather than the tab freezing. Nine sheets, ~1200 QR modules per card.                                                                                                                                  | Pending                                                                                                                                                                                                                 |
| 9   | **Neither the PDF library nor the QR encoder is fetched before a deck exists.**                                                                                                                                                                                      | **Done 2026-08-06.** Chrome against `vite preview`, hard reload of the landing screen: exactly six requests — the document, `index-*.js`, `rolldown-runtime-*.js`, `preload-helper-*.js`, `qrcode-loader-*.js`, the CSS |

| 10 | **The deck-actions panel fits a 360px screen** — open it mid-game on a phone, then force the copy fallback (an insecure origin will do it) so the share-link input is showing too. Nothing local computes layout, so this is the only check on the panel's height. | Pending |
| 11 | **The backdrop leaves the card legible.** `bg-page/80` is meant to reassure the player the game is still there. If the card behind it reads as a spoiler risk or as visual noise, the fill is the thing to change — not the panel. | Pending |
| 12 | **Four control buttons still clear 44px each and do not crowd the swipe.** The bar gained a fourth target on the surface a thumb swipes; `touch-target` is asserted at class-name level only, and jsdom measures nothing. | Pending |
| 13 | **Watch the print wait against a real crawl.** Press Print mid-game on a 50-card deck: the shared 1 req/s gate makes the wait roughly a minute, and the only question is whether the spinner plus "N cards are still looking up a year" reads as working rather than hung. Confirm the export starts **by itself** when the count reaches zero, and that Cancel puts the three actions back. | Pending |
| 13a | **Press "Print so far" mid-crawl and count the paper.** The partial export's whole justification is that the omission is stated rather than silent, so check the excluded count on screen matches the cards missing from the PDF. Then confirm the wait is **still running** afterwards and that the complete deck downloads a second time when the last year lands — two files is the intended behaviour, not a bug. | Pending |

**Row 9 comes with a trap worth knowing before you run it again: `qrcode-loader-*.js` is React's JSX
runtime, not the QR encoder.** Rolldown named the shared vendor chunk after `src/game/qrcode-loader.ts`
(six lines), which is now shared between the entry chunk and the `GameScreen` chunk. The encoder is
`browser-*.js` and jsPDF is `jspdf.es.min-*.js`; neither is requested, and nor are jsPDF's optional
`html2canvas-*.js`, `purify.es-*.js` and `index.es-*.js`. Preloaded bytes went from 12.58 kB to
12.90 kB. **Read the network log, not the build output — the build output cannot tell an emitted chunk
from a preloaded one.**

### Phase 8 the card's look and the installable shell — all of it Pending

Seven checks from [`plan.phase-8-look-and-shell.md`](./plans/plan.phase-8-look-and-shell.md). The unit
tests cover the token names, the ring utilities' presence at every call site and the manifest's
installability fields. **What they cannot cover is whether anything paints, whether the browser agrees
the app is installable, and what a redeploy does to a running tab.**

For anything needing a real deck, use `npx vercel dev` (§4). Rows 1–4 need a **deployment**, because a
service worker needs HTTPS or `localhost` and installability is judged against a served manifest.

| #   | Check                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Install it on a real phone.** Check the home-screen icon, the splash screen, and that `theme_color` matches the page so there is no seam at the status bar. Confirm the **maskable crop** on a round-icon launcher — nothing of the wordmark may be cut.                                                                                                                                                       | Pending                                                                                                                                                                                                                      |
| 2   | **Airplane mode, three outcomes.** The shell loads; a **saved session resumes and is playable** without audio; pressing Start shows Phase 7's `offline` copy rather than hanging. If all three hold this closes with no code change.                                                                                                                                                                             | Pending                                                                                                                                                                                                                      |
| 3   | **Redeploy with a game in progress, then reload.** The old worker must keep serving until every tab is closed, and **the next card must not be a missing-chunk error**. This is the whole reason the update strategy waits instead of calling `skipWaiting`.                                                                                                                                                     | Pending                                                                                                                                                                                                                      |
| 4   | **Confirm no worker is registered in development.** `pnpm dev` and `npx vercel dev` both: Application → Service Workers must be empty. `devOptions` is deliberately absent.                                                                                                                                                                                                                                      | Pending                                                                                                                                                                                                                      |
| 5   | **Lighthouse on the landing screen, production build, all four categories.** The number to protect is **Performance 99 / LCP 1.6 s**. Aim it at **paint**, not layout: the ring adds no layout (a `border-box` border plus a `box-shadow`, card still 288 × 448), so the new risk is two blooms and a masked pseudo-element on a 3D-transformed element. Record beside Phase 7's so the comparison is one table. | Pending — Lighthouse is not installed in the repo                                                                                                                                                                            |
| 6   | **The ring at three widths**, and once with the OS reduced-motion preference set. See the note under the Phase 7 three-widths table — one of its rows is now known to fail.                                                                                                                                                                                                                                      | Pending                                                                                                                                                                                                                      |
| 7   | **The ring paints at all**: a gradient border following the corners on both faces, a visible bloom, and the year in neon green.                                                                                                                                                                                                                                                                                  | **Done 2026-08-06 — partially.** Verified in Chrome against a throwaway static page reproducing `Card`'s and `CardStack`'s exact class strings, since jsdom renders none of it. One viewport, one browser, no OS preferences |

**Row 7 is why the glow's values are what they are.** At the first pair (`0.3` alpha, `1.25rem` blur)
the bloom was barely perceptible against the near-black page, so `--color-ring-glow` went to `0.45`
and `--ring-glow-blur` to `1.75rem`. It is the one value in the ring's token set set by looking rather
than by measuring — and the only kind of value that should be.

**Row 7 also found a defect it was not looking for, and it is recorded rather than fixed:** the two
peeking backs do not render at all on a full-height card. Measured with `getBoundingClientRect`, back 1
peeks **1.04px** below the card and back 2 **2.08px**, both inset on every other side, and the card's
own 2px ring covers even that. `scale()` is centre-origin, so it lifts the bottom edge by
`(H / 2) × 0.04` = 8.96px at H = 448 while `translateY` only pushes it down 10px. It is pre-existing
from Phase 5 — see §8 and [`agent_findings.md`](./agent_findings.md).

### The real-device pass — RUN 2026-08-06, and it found one defect

**This is the pass Phase 5 scoped and waived and Phase 7 left outstanding.** It was finally run on
2026-08-06, on **Android**. Four of the six checks are now closed, one found a real defect, and one was
not reported. Everything in it is a thing no test in this repo can reach.

Reach the dev server from a phone with `pnpm dev --host`, or use a preview deploy — better for iOS,
which is stricter about non-HTTPS origins. Only the year lookups need a function, so `vercel dev` is
required just for dealing a deck.

| #   | Check                                                                                                                                                                                                                                                      | Status                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The five thresholds in `src/game/gestures.ts` under a thumb.** They were documented guesses, and `SWIPE_COMMIT_DISTANCE_PX` (96px) is **52% of the card's width at its floor** since the card went fluid. Retune only with a measurement, and record it. | **Done 2026-08-06** — "gestures work fine". **No retune**, so the five constants are now validated on one device rather than unvalidated guesses. The 52% arithmetic stands as documented and is evidently acceptable |
| 2   | **One swipe**, to confirm the next card sits behind the sliding one rather than rising from below. jsdom computes no layout, so Motion's `popLayout` measurement cannot be checked locally at all.                                                         | **Done 2026-08-06** — covered by the gesture pass; nothing reported wrong with the stack                                                                                                                              |
| 3   | **The 2026-08-06 audio behaviour: the preview survives a flip, and stops on a swipe.** The reversal's only real verification — the unit test proves no `pause()` is called, not that sound continues.                                                      | **Done 2026-08-06** — "audio sounds good". The reversal is confirmed on hardware                                                                                                                                      |
| 4   | **One QR scan at the 14/18 size on the smallest card**, where the code is about 144px.                                                                                                                                                                     | **Done 2026-08-06** — "QR scans right". The **printed** scan is a separate row above and is still Pending                                                                                                             |
| 5   | **The Android lock-screen check.** Play a preview, lock the phone, and confirm the media panel names nothing. The only leak vector no test in this repo can reach, owed since Phase 4.                                                                     | **DEFECT FOUND 2026-08-06, fixed the same day. Needs ONE re-check** — see below                                                                                                                                       |
| 6   | **A devtools DOM search on an unflipped card**, owed since Phase 4: no title, artist or year anywhere in the document.                                                                                                                                     | Pending — not reported                                                                                                                                                                                                |

**Row 5 is the one that earned the whole session.** The preview **kept playing with the phone locked**.
Android keeps a playing `<audio>` element alive across a lock, so the song went on to a locked screen
with a media notification in the shade — for a game whose entire premise is that the phone reveals
nothing about the current card. `navigator.mediaSession.metadata` is still never set, so the panel
could not name the track and the leak rule itself held; playing at all was the wrong behaviour.

`useCardAudio` now pauses on `visibilitychange` when `document.hidden`, which also covers switching
apps and switching tabs. **Pause rather than stop**, so the position survives and unlocking then
pressing Play continues; and deliberately **no auto-resume** on becoming visible, because a page that
starts making noise as a phone unlocks is worse than one that waits to be asked. Three tests in
`useCardAudio.test.ts` cover it.

**The re-check is a minute of work and is not done:** play a preview, lock the phone, confirm silence,
unlock, confirm Play continues from where it was rather than restarting.

The full Phase 5 checklist above (iOS tap-versus-swipe, pull-to-refresh, `select-none`, the toolbar
reflow) still belongs to a session of its own — **this pass was on Android**, so nothing in the
iOS-specific column is closed by it.

### The Android back press — built 2026-08-12, and NONE of it can be checked in Chrome

Seven checks from [`plan.google-play-back-button.md`](./plans/plan.google-play-back-button.md).
**Every row needs an installed TWA from
[`plan.google-play-shell.md`](./plans/plan.google-play-shell.md)** — a browser supplies its own back
affordance and its own history entries, so a Chrome tab observes a different system and a green result
there proves nothing about the device. Two builds, and which rows run on which (rewritten 2026-09-19;
the plan's code landed 2026-08-12, so the "land it inside the closed test" window this paragraph used
to describe never applied): rows 1–6 run first on plan 1's **step 9 URL-bar build** — the unverified
shell is a Custom Tab with what should be the same history stack, so the history behaviour should not
depend on asset-link verification; if those rows behave differently there, re-run on the verified
build before concluding anything — and all seven run again on the **step 12 asset-link-verified
build**, which is the one testers and the store get.

**Those builds are now nearer than they have ever been: as of 2026-09-19 the Android toolchain is
installed on this machine** (§9), so what stands between these seven rows and a device is
`bubblewrap init`, a keystore and an install — not a machine to set up. Two things to plan around.
**Row 7 runs before the AAB that goes to closed testing is final**, because it is the only row whose
remedy lives in `android/`, and a shell change after a track is published is a new release rather than
an edit. And **rows 1–6 are worth running on the step-9 build even though it shows a URL bar** — that
build exists days before the verified one, and a history bug found there is found for free.

What the unit tests do cover: the decision's full truth table, the entry count, the cleanup's
call order, the query string, and that a press reaches the confirmation instead of `onExit`. What they
**cannot** cover is that Android's gesture arrives as a `popstate` at all — jsdom's history is a model,
not Chrome's.

| #   | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | **Start a game, press back.** The confirmation appears, the deck is intact, and cancelling returns to the same card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Passed 2026-09-21 — re-runs at step 12                                      |
| 2   | **Open the deck-actions dialog, press back.** The dialog closes and the game is untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Passed 2026-09-21 — re-runs at step 12                                      |
| 3   | **Open the exit confirmation, press back.** It closes without exiting — a back press must never answer the question.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Passed 2026-09-21 — re-runs at step 12                                      |
| 4   | **Back is NOT intercepted on welcome, landing, preparing or end.** One press closes the app. This is the mounting-is-scoping claim on real hardware — and the welcome screen is the front door since 2026-09-18, so it is the first surface a back press meets on a cold launch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Passed 2026-09-21 — re-runs at step 12                                      |
| 5   | **Exit properly, land on the landing screen, press back once → the app closes.** A second press being needed means the cleanup left an entry behind, which presents as a frozen back button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Passed 2026-09-21 — one press, no stray entry                               |
| 6   | **The edge-swipe gesture as well as the on-screen button.** Same event, different animation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Passed 2026-09-21 — re-runs at step 12                                      |
| 7   | **Android 13+ predictive back.** Confirm the OS does not preview the app peeling away while the web app is in fact handling the press — that looks broken even though nothing is wrong. _2026-09-21: **not run — and the shell-side worry this row was written around is ANSWERED, from Android's own docs rather than from memory.** The generated `AndroidManifest.xml` sets no `android:enableOnBackInvokedCallback` at all, and the doc's rule is that predictive back is **enabled by default** — the attribute exists to opt OUT (`"false"`), not in. So the shell has NOT kept the legacy behaviour and no change in `android/` is indicated. What remains is purely observational, and HOW to observe it depends on the device's OS: on **Android 15+** the developer option is gone and the system animations appear for opted-in apps automatically; on **Android 13 or 14** they sit behind Settings → System → Developer options → **Predictive back animations**. Read from `developer.android.com/guide/navigation/custom-back/predictive-back-gesture`, 2026-09-21._ | Pending — shell-side concern answered; needs the OS-appropriate observation |

**Row 7 was the one that could send this back to plan 1, and as of 2026-09-21 it cannot.** The worry
was that the generated shell might opt into the legacy back behaviour, leaving the predictive animation
and the intercepted press to disagree — a fix that would live in `android/` rather than in any of this
code. It does not: the generated manifest sets no `android:enableOnBackInvokedCallback`, and that
attribute is an opt-**out**, so the default applies. The row is still Pending, but it is now an
observation to make rather than a risk to the plan. Row 1 was the one to run first — it is the whole
feature — and it passed.

**One consequence is checkable in a browser and is a behaviour change rather than a bug:** during play,
the browser's own back button now opens the exit confirmation, on desktop and in mobile Chrome. That is
accepted deliberately (a mis-swiped back loses the game there too) and there is no user-agent sniff, so
seeing it is the code working.

### The welcome screen, the year-cards PDF and the left swipe — built 2026-09-18, all of it Pending

Two developer requests outside any plan. The unit tests cover the container flag (welcome first, picker
after one press, the picker after an exit and the welcome screen again after Back, skipped by a share
link), the download link's `href` and
`download`, the footer contract on the fifth host, the leak proxy with the printed range subtracted, the
`swipeIntent` mapping, the `PREVIOUS` reducer case, ArrowLeft end to end through the HUD count, and (2026-09-19) the `custom` value the stack hands `AnimatePresence` for every index move. What
they cannot cover is a service worker, a browser's download behaviour, a laid-out screen and a thumb.

| #   | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Download the PDF from a tab the service worker controls** — on the deployment, second visit, so `sw.js` is active. The file must save (or open in the browser's viewer) and the app must NOT reload to the welcome screen. That is the `/\.pdf(\?                                                                                                                                                                                                           | $)/`entry in`navigateFallbackDenylist`doing its job, and nothing local can show it. Try it once more with`?v=1` appended to the href — the query case is the one that was broken until 2026-09-19. Note that the first check on a deployment built after 2026-09-19 lands on the corrected PDF blob, so a clean result does not retroactively clear the earlier deployments. | Pending |
| 2   | **Open the saved PDF and confirm it is the year cards, all 20 pages.** The repo only ever read the file's page count and producer; nobody in a session has looked at a page.                                                                                                                                                                                                                                                                                  | Pending                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | **Welcome screen at 320px**: logo, tagline, the big button and the first step visible without the decorative card (it is `hidden sm:flex`), the footer at the end of the scroll and not on the download link.                                                                                                                                                                                                                                                 | Pending                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | **Welcome screen on a desktop**: the three steps in one row, the decorative card's ring and bloom painting beside the text, and the `?` in the year colour — the same paint checks the card itself owed in Phase 8.                                                                                                                                                                                                                                           | Pending                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | **A share link skips the welcome screen** and a reload after an exit shows it again — the two ends of the container flag.                                                                                                                                                                                                                                                                                                                                     | Pending                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | **Swipe LEFT on a phone steps back; swipe RIGHT advances.** The mapping is unit-tested; whether the thumb agrees with it is not. Also confirm the previous card arrives UNFLIPPED and silent, and that a left swipe on card 1 snaps back rather than doing anything else.                                                                                                                                                                                     | Pending                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | **ArrowLeft on a keyboard steps back, and does nothing while either dialog is open.**                                                                                                                                                                                                                                                                                                                                                                         | Pending                                                                                                                                                                                                                                                                                                                                                                      |
| 8   | **Back on the picker returns to the welcome screen from all three routes** — fresh visit, after Exit, after Home — and the welcome button returns to the picker with the typed rows GONE (the picker remounts; that is accepted).                                                                                                                                                                                                                             | Pending                                                                                                                                                                                                                                                                                                                                                                      |
| 9   | **The outgoing card leaves the way the deck moved, from every input (2026-09-19).** On a phone a right swipe flies the card out to the RIGHT and a left swipe out to the LEFT. On a keyboard ArrowRight flies right and ArrowLeft flies left — before this every keyboard advance flew left. On card 1 a left swipe or ArrowLeft snaps back with no exit at all. Also: press → quickly while a card is still leaving; the first card must keep its direction. | Pending                                                                                                                                                                                                                                                                                                                                                                      |

### The Trusted Web Activity shell — nothing here has been built yet, and no browser can stand in for it

Seven checks from [`plan.google-play-shell.md`](./plans/plan.google-play-shell.md), which packages the
deployed PWA as a Trusted Web Activity. The release process, the pinned origin and the installed
toolchain are in **§9**. **Not one of these rows can be run in a browser or under any dev server** —
every one of them is about what Android does _around_ the web app, and Chrome does none of it.

There are two builds and the distinction matters: the plan's **step 9** build (installed locally,
asset links not yet complete) and its **step 12** build (both certificate fingerprints published, which
is the build testers and the store get). Row 1 and row 6 run on both. Everything else runs on step 12.

**A THIRD state appeared on 2026-09-21 and row 1 was answered from it, so read the row's Status with
this in mind.** Note the numbering first, because two plans count differently and the same APK has two
names: the locally installed build is **plan 1's step 9 and plan 3's step 7** — one build, and plan 3
is the executable file. The upload key's fingerprint was deployed alone, ahead of the plan's order, so
that **sideloaded build** showed the bar before the deploy and lost it after — same APK,
same signing key, only the deployed statement changed. That is a cleaner experiment than the plan
designed, because the build is held constant. What it does **not** touch is the step-12 build: Play
re-signs with its own app-signing key, so the certificate the verifier compares against is a
different one and none of today's evidence carries over. **Row 1 re-runs at step 12, in full.**

What the unit tests cover: the manifest's store fields, the deliberate absence of `orientation`, the
asset-links file's shape, and that the SPA rewrite still excludes dotted paths. What they cannot cover
is whether Android's verifier accepted anything, whether the AAB installs, or whether a single one of
these behaviours survives the shell.

| #   | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | **A URL bar on the step-9 build, and NO URL bar on the step-12 build.** Launch the step-9 install first and confirm Chrome's address bar _is_ across the top; then launch the step-12 install and confirm it is gone. Seeing it before is the whole point — a shell that never showed one is not evidence that verification worked. _2026-09-21: both halves observed on the **sideloaded step-7 build**, either side of the upload key's deploy — bar present with the empty statement, gone after a clean reinstall with the statement published. The before/after is therefore **already banked**, and what remains is the same check against the **Play-signed** build, whose certificate is not this one._                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Half passed 2026-09-21 — re-runs at step 12                   |
| 2   | **Both PDF downloads, inside the shell.** The welcome screen's static `<a download>` of `year-cards-1970-2033.pdf`, and a deck's **Print as PDF cards** (jsPDF's `doc.save()`). Two different mechanisms: the static one is a navigation the service worker must not answer with `index.html`, which is the `.pdf` denylist entry no dev server can exercise; the export is a blob. Run the static one on the **second** launch, once `sw.js` controls the page — on the first launch the worker is not answering anything. A pass is a file that lands in Downloads and opens; a silently missing file is the failure mode, and neither path shows an error. _2026-09-21: passed. Both files landed in Downloads and opened; the static one was pressed on a LATER launch, with `sw.js` controlling the page, which is the condition that makes it a test of the `.pdf` denylist at all._                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Half passed 2026-09-21 — re-runs at step 12                   |
| 3   | **A shared deck link opens the installed app as an App Link, query string intact.** Send yourself `<origin>/?playlist=<ids>&seed=<hex>` and tap it from another app. A pass is the **app** opening rather than Chrome, _and_ the deck dealing immediately. `App.tsx` reads `location.search` in a lazy initialiser on the first render, so a link that arrives stripped to a bare `/` shows the welcome screen with no error at all — which reads as "the link did nothing". _2026-09-21: passed, EARLY. This row was scheduled for step 12 because it needs App Link verification; the upload key's deploy delivered that ahead of time. The app opened rather than Chrome and the deck dealt immediately, so the query string survived. Re-runs on the Play-signed build._                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Half passed 2026-09-21 — re-runs at step 12                   |
| 4   | **Storage shared with Chrome, confirmed in both directions.** Start a game in the installed app, leave it mid-deck, open the same origin in the Chrome browser and confirm it resumes on the same card; then the reverse. Both directions passing is the expected result, not a defect — see §8. _2026-09-21: passed in both directions, which is the expected result and not a defect — see §8._                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Half passed 2026-09-21 — re-runs at step 12                   |
| 5   | **The lock-screen audio check, re-run inside the shell.** Play a preview, lock the phone, confirm **silence**; unlock and confirm Play continues from where it was rather than restarting. The 2026-08-06 fix was verified in Chrome and rests on `visibilitychange` firing for a hidden document — whether a TWA activity reports that the same way is exactly what a shell can change. This is the re-check the real-device pass above owes, run where it now counts. _2026-09-21: **HALF passed, and the other half is a real deviation the developer ACCEPTED rather than a pass.** Locking the phone produced silence, as designed. But unlocking and pressing Play **restarted the preview from 0:00** instead of continuing from where it stopped. That contradicts the hook's own stated contract — `useCardAudio` calls `element.pause()`, which preserves `currentTime`, and its comment says so in as many words — so something outside the hook is releasing the media resource while the activity is backgrounded, and a `play()` on a released element re-fetches from the start. **The mechanism is UNVERIFIED**; the reading is that Chrome drops the media resource for a hidden TWA activity, which nothing local can reproduce. Decision 2026-09-21: the developer judged the restart acceptable and asked for NO fix, so this is a known, accepted behaviour on Android rather than an open defect. Do not 'fix' it without asking; do re-check it on the Play-signed build, in case the answer differs._ | Silence passed, resume deviates — accepted 2026-09-21, no fix |
| 6   | **The app plays, end to end, in the shell.** A cold launch lands on the **welcome screen** — every launch, by the 2026-09-18 decision, since there is no "seen it" flag — the button enters the picker, a suggested playlist deals a deck, a preview plays and a card flips. Run this first on the step-9 build: every row below assumes the app works at all. _2026-09-21: passed on the sideloaded build — welcome screen on a cold launch, into the picker, a suggested playlist dealt a deck, a preview played and a card flipped. Like row 1 it runs on both builds, so it re-runs on the Play-signed one._                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Half passed 2026-09-21 — re-runs at step 12                   |
| 7   | **`adb shell pm get-app-links aleixrabassa.playlistjitster` lists the origin's host as `verified`.** This is the instrument; the missing URL bar is not, because a bar can be absent for reasons unrelated to the statement file. After a redeploy the system re-checks on its own schedule, so force a fresh attempt with `adb shell pm verify-app-links --re-verify aleixrabassa.playlistjitster`. Without a device, Google's checker shows what the verifier fetches: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://playlistjitster.vercel.app&relation=delegate_permission/common.handle_all_urls` — where a wrong content type, or a rewrite back to `index.html`, is visible with no phone at all. **Two caveats, measured 2026-09-19.** An EMPTY `sha256_cert_fingerprints` list comes back as `ERROR_CODE_MALFORMED_CONTENT` ("must contain at least one certificate"), **not** as "reachable with no certificates" — so before the fingerprints are published that error is the expected state and is itself evidence the fetch path works. And the response carries `maxAge: ~600s`: Google caches its fetch for ten minutes, so wait that long after a redeploy before concluding the new statement did not take.                                                                                                                                                                                                                                                           | Pending                                                       |

`adb` ships with the Android SDK's platform-tools (§9) and lives at `C:\Android\sdk\platform-tools\adb.exe`. It was **not** on the PATH after the 2026-09-19 install — checked, not assumed — so invoke it by path or add that directory first.

---

## 6. Before you commit

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must pass. **There are no pre-commit hooks and no CI workflow**, so nothing will run these for you.

---

### The suggestion multi-select — built 2026-08-12, and the gesture itself is the part nothing local runs

Holding a suggested playlist (or Ctrl/Cmd/Shift-activating it) puts it in the form instead of dealing
a deck from it, so up to `MAX_DECK_PLAYLISTS` can be combined and Start plays all of them.

**What IS covered locally, so do not re-check it by hand.** `playlist-selection.test.ts` pins every
rule about rows and the cap in the node environment; `gestures.test.ts` pins the 500 ms threshold, the
10px drift bound and — importantly — that the threshold stays above `TAP_MAX_DURATION_MS`;
`SuggestionButton.test.tsx` fires real pointer sequences against a fake clock and covers the swallowed
click, the drift cancel, the pointer cancel, the leave and the unmount. This is the first place in
`src/` that has ever fired a pointer event or used `vi.useFakeTimers()`, and both work.

**What is left is everything a synthetic pointer is not.**

| Check                                                                                              | Status  |
| -------------------------------------------------------------------------------------------------- | ------- |
| Android Chrome: a real 500 ms hold selects, with **no text-selection callout and no context menu** | Pending |
| iOS Safari: the same, and specifically that the **iOS callout** stays suppressed                   | Pending |
| Both: a hold that turns into a **scroll** does not select, and the page scrolls normally           | Pending |
| Both: a hold with a normal thumb wobble **does** select — i.e. 10px is usable, not merely present  | Pending |
| Both: the tick and the accent border are distinguishable from hover and from the focus ring        | Pending |
| 360px: five selected rows still leave Start reachable above the suggestions                        | Pending |
| Keyboard: Ctrl+Enter selects, Enter adds the next, Enter on a selected one removes it              | Pending |
| Screen reader: the suggestion is announced as a **pressed toggle**, and the pressed state changes  | Pending |

> **The first four rows are the gesture, and jsdom has no opinion about any of them.** A synthetic
> `pointerdown` cannot raise a platform text-selection callout, so `select-none`,
> `touch-manipulation` and `[-webkit-touch-callout:none]` on `SuggestionButton` are asserted by
> nothing at all — they are three class names that either work on a real finger or do not. The
> `preventDefault` on `contextmenu` **is** tested, but only that it happens, not that it was the
> thing the platform was about to do.
>
> **The scroll row is the one with a real failure mode.** The suggestions live in the one column of
> this app that outgrows the viewport, so a hold that drifts is the ordinary case rather than the
> exotic one. The mechanism that saves it on touch is `pointercancel`, fired by the browser when it
> takes the gesture for scrolling — and the drift bound is the backstop for when it does not.
>
> **The 360px row is `plan.multi-playlist-ui.md`'s first Open Question, and this feature makes it far
> easier to reach.** Five rows used to mean pasting five links; it is now five taps. If it does not
> fit, that plan already records the intended remedy: collapse the suggestions rather than shrink the
> rows.
>
> The last row matters because `aria-pressed` is the only thing that makes this feature exist for a
> screen-reader user at all — the highlight and the tick are both visual, and a hold is unreachable
> without a pointer. Run it with the reveal's screen-reader pass above, and **name the reader**.

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

### What the next preview deployment owes

One errand, four questions — deliberately one trip rather than four. Step 15 of
[`plan.phase-4-6-screens.md`](./plans/plan.phase-4-6-screens.md), carried over from Phase 3, needs a
preview deployment **with both Upstash variables configured**, because nothing local models the shared
cache or the 1 req/s gate: without them the gate paces nothing and any number measured is meaningless.

While there, collect all four:

1. **Progressive loading against a real deck** — the original errand.
2. **The 50-track cold-deck wall clock**, unmeasured since Phase 2.
3. **A count of `/api/year` requests under React 19 StrictMode.** `use-game-session.ts` has a
   double-crawl guard that nothing tests, so the number is the only evidence it works.
4. **Lighthouse on the game screen and the card**, added by Phase 7. It cannot be done locally at all
   — `vite preview` serves no `/api`, so Start fails and the game screen is unreachable (§8). The
   landing screen has been audited; these two have not.

---

## 8. Known limitations

Mostly carried forward from the Phase 0 research; measurements and reasoning in [`plans/plan.md`](./plans/plan.md) §5. Several are execution gaps rather than research findings — things this repo cannot check about itself — and three are deliberate decisions whose reasoning is recorded here instead of being deferred as work.

- **Playlists are capped at 100 tracks, and the app cannot tell when it happened.** The Spotify embed endpoint returns at most 100 tracks and its payload contains **no pagination signal whatsoever** — no total, no offset, no `hasMore` — so a response of exactly 100 is indistinguishable from a playlist that genuinely holds 100. There is no way to page past track 100: the anonymous bearer token in the embed payload was tested against the Web API and returns `429 QUOTA_EXCEEDED` immediately, because its client ID is shared by every embed viewer on the internet. Phase 6 will show a non-blocking warning at exactly 100 tracks; a manual track-paste fallback is deferred past v1.
- **The embed endpoint is unofficial and may change or break without notice.** Reading it is outside Spotify's Developer Terms; this is an accepted risk for a personal project. All scraping is to be confined to a single adapter module so a breakage is contained, and the QR code is always rendered regardless of whether audio or metadata extraction works — so the deck degrades rather than dies.
- **Release years will sometimes be wrong.** MusicBrainz has no canonical "original studio recording" per song; famous tracks have hundreds of competing live, bootleg, and reissue entries. As built, the strict pass resolved **14 of 14** known-tricky tracks exactly (2026-08-04) against a ~6% naive baseline — but that is a curated set, not a random one, and a track the strict filters cannot place falls through to a relaxed pass that is measurably off by a year or so. Those come back as `confidence: 'low'`, and Phase 6 marks them unconfirmed on the card's revealed side. There is no pre-Start review of years — the player pastes the playlist, so that would spoil the deck.
- **Year resolution is slow the first time, and the 1 req/s budget is shared by everyone.** A lookup costs two paced MusicBrainz requests, so a cold 100-track playlist takes several minutes. The cache means only genuinely new songs ever pay it — but the budget is global, so two people resolving cold playlists at once each get half the throughput. Acceptable for a personal project; the number to watch if the app is ever shared widely.
- **In-app audio covers ~99.5% of tracks, not all of them.** Measured across 398/400 tracks in Phase 0. For a track with no preview URL, Play/Pause and Restart are disabled; the QR code and Exit still work.
- **A mid-game disconnect degrades the deck rather than killing it, and nothing tells the player.** This is a decision (Phase 7, plan 2, decision 7), not an oversight. Verified by reading `src/game/resolver.ts`: a `network` outcome is already classified as transient alongside `upstream-unavailable` and `unexpected-payload`, retried with exponential backoff and jitter (500 → 1000 → 2000 ms), and settled rather than allowed to crash the crawl. So losing connectivity mid-deck leaves the game **fully playable** — the QR is a data URL and needs no network, the flip and the swipe are local, the years already resolved travel with the cards, and Exit works. Only two things stop: audio previews, and year lookups for cards not yet resolved. **There is deliberately no offline banner.** `NoticeBanner` carries three notices, two derived from the fetch and one from game state; a fourth driven by a live browser event would need either a new reducer action (which only `App.tsx` could dispatch) or connectivity state in the container, and that is real complexity for a case where the deck keeps working. A documented graceful degradation is the better answer, in the same "degrades rather than dies" framing `plan.md` §4 uses for the embed endpoint. What is **not** silent is a disconnect at the moment of Start: that is the `offline` code, which short-circuits the request and says so immediately.
- **Lighthouse has only ever been run against the landing screen.** Scores on a production build under `vite preview`, Lighthouse 12.8.2, headless Chrome, **2026-08-06 after the favicon fix: Performance 99 · Accessibility 100 · Best Practices 100 · SEO 100** (FCP 1.5 s, LCP 1.6 s, TBT 0 ms, CLS 0; 98.7 kB transferred in total). Two limits remain on those numbers:
  - **The game screen and the card were not audited and cannot be locally.** `vite preview` serves no `/api`, so Start fails with `unexpected-payload` — the same trap as `pnpm dev` above — and the game screen is unreachable. That audit is folded into the preview-deployment errand below rather than being a second one.
  - **Accessibility 100 is a floor, not a result.** An automated audit reaches a fraction of WCAG and this one ran over a static landing screen. The four Phase 7 passes in §5 are the real coverage and every row is still Pending.
- **One 1.26 MB image was costing 6.2 seconds of LCP, and the first diagnosis of it was wrong.** Worth reading before trusting any performance reasoning in this repo. `public/logo.png` was 1,262,175 bytes at 1254×1254, served as the favicon on every visit — 6× the entire JavaScript payload. The first audit scored **Performance 75 with LCP 7.8 s**, and that was written up as architectural: the LCP element is the landing tagline, it cannot paint until React mounts, so the fix must be prerendering and therefore Phase 8. **That was wrong.** Replacing the file with a 240×240 WebP of 20,610 bytes — a 98.4% reduction, no code touched — took the same page to **Performance 99, LCP 1.6 s**. The favicon was saturating the simulated slow-4G link and delaying the paint of everything behind it, including the LCP element.
  - Two lessons, and the second is the useful one. **A favicon is not render-blocking, so no audit fails on it** — which is exactly how it survived seven phases unnoticed, and why the 8.4 kB the chunk split fought for looked more significant than the 1.24 MB sitting next to it. And **"LCP is gated on React mounting" is a conclusion that sounds right for any SPA**, which is what made it easy to accept without checking what else was on the wire. Read the network log before blaming the architecture.
  - Nothing further is owed here: prerendering and an inline static shell are **not** needed for the landing screen's score, and both remain unbuilt Phase 8 ideas rather than outstanding fixes.
- **The app cannot be played under `pnpm dev` — only under `npx vercel dev` or a deployment.** Vite serves `api/playlist.ts` as transpiled source with status 200, so the playlist client reports `unexpected-payload` and the landing screen shows an error that reads like an app bug. This is not fixable without a dev-server plugin that runs functions, which `vercel dev` already is.
- **Progressive loading has never been verified against a real deployment.** Step 15 of the Phase 6 plan, carried over from Phase 3, is still owed — including the 50-track cold-deck wall clock (unmeasured since Phase 2) and the StrictMode request count. Nothing local models it: the shared cache and the 1 req/s gate are both backed by the Upstash variables, so without them the gate paces nothing and the numbers mean nothing. Checklist in §5.
- **None of Phase 7's reduced-motion, responsive, keyboard or screen-reader behaviour has been verified, and no test in this repo can verify it.** The token layer, the fluid card, the `prefers-reduced-motion` block, the focus states and the ARIA fixes all landed with both ends of each contract asserted — a component renders a `data-motion` hook or a `focus-visible:focus-ring` class, and `src/index.css.test.ts` asserts the stylesheet names it — and **nothing in between**. jsdom evaluates no media queries, has no `window.matchMedia` at all, computes no layout, and has no accessibility-tree consumer, so a class-name assertion is the ceiling of what is automatable. The four passes are scoped in §5 and every row is Pending. **The screen-reader pass is the one to prioritise**: Phase 7 added the app's only live region, on the card's reveal, and the entire point of it is that a flip becomes audible — a player using a screen reader had no way to learn the year before it, and no local check confirms they do now. A live region that mounts already-populated is the known soft spot, since readers differ on announcing content present at insertion.
- **The before/after screenshot comparison for Phase 7 was never run.** Step 12 of [`plan.phase-7-look.md`](./plans/plan.phase-7-look.md). The plan's success condition was that naming the existing values changed nothing visible except four measured contrast corrections, so the comparison is the check on that claim and it is outstanding. §5 lists the seven changes that _are_ expected to be visible, which makes it a checklist rather than a hunt.
- **A shared link reproduces a SHUFFLE, not a deck.** `?playlist=&seed=` is the whole link, and the seeded shuffle is exact — but its input is not, for two independent reasons: a card whose year lookup finds nothing is removed from the deck, and which cards those are depends on what MusicBrainz answers at play time; and an editorial playlist has its tracks refreshed by Spotify periodically. So two people opening the same link get the same playlist dealt in the same order, and may not get the same cards. This is handled in **copy** rather than by an encoder (decision 4): the end screen says "same playlist, same shuffle" and `EndScreen.test.tsx` asserts the phrase "same deck" is absent. The only fix would be a versioned opaque token carrying every card id, which trades a readable link for a guarantee nobody asked for.
- **The saved-playlist library shares the session key's two-tab hazard.** `hitster:library:v1` sits beside `hitster:session:v1` under the same accepted v1 limitation (`plan.md` §6): two tabs of the app last-write-wins, so saving a playlist in one tab and removing one in another can lose an edit. A `storage`-event guard remains the fix if it ever bites. The library is deliberately small and re-creatable — 1..5 playlist ids, a name, a timestamp — so the cost of a clobber is a row somebody re-saves, not a game.
- **The PDF export sanitises titles it cannot draw, so a Cyrillic or CJK title prints as `?` placeholders.** A standard PDF font is WinAnsi-encoded. Measured before choosing (2026-08-06): WinAnsi already covers **every Spanish, Portuguese, French, German and Italian glyph**, and six of the eight suggested playlists are Spanish or Latin — so on the decks this app is built for the transformation is a no-op. Diacritics outside the encoding are stripped (`ș` → `s`) and a short hand-written map covers stroked letters that do not decompose (`ł` → `l`), but Cyrillic, Greek, CJK and emoji have no Latin fallback and become `?` per character. **The year and the QR are unaffected** — digits are ASCII and the QR is an image — so such a card still plays and still scans to the right track. Embedding a Latin-Extended font was rejected: 200–400 kB in the export chunk to fix Polish and Turkish while still failing on Cyrillic and CJK. `src/game/pdf-text.ts` carries the reasoning and the tests.
- **The printed sheet assumes LONG-EDGE duplex, and nothing can detect otherwise.** `pdf-sheet.ts` mirrors the back sheet's columns because long-edge duplex flips the paper about its vertical centre line; short-edge binding would mirror the rows instead, and a sheet printed that way pairs every card with the wrong answer. The app cannot read a printer setting, so the end screen and §5 name the setting rather than the code guessing at it. The arithmetic itself is pinned by `pdf-sheet.test.ts` as a reflection identity, which is the part a person cannot check without printing and cutting.
- **Nothing about the export has been verified on paper.** The geometry, the pagination and the mirror are unit-tested; the printer, the cut and a phone camera against a printed code are not. Six sharing/printing checks and a printed-QR scan are scoped in §5, all Pending.
- **Audio pauses when the document is hidden, and that rule exists because a real phone found it missing.** Verified on Android 2026-08-06: a playing preview survived the screen lock and went on playing, with a media notification in the shade. `useCardAudio` now pauses on `visibilitychange`. Two consequences worth knowing rather than rediscovering: **there is no auto-resume** — unlocking leaves the preview paused where it was, and the player presses Play — and **switching tabs or apps pauses too**, which is deliberate rather than a side effect. The leak rule itself was never breached: `navigator.mediaSession.metadata` has never been set, so the panel could not name the track.
- **Offline covers the SHELL and a saved session, and deliberately not the API.** The service worker
  precaches the build output only — `runtimeCaching` is empty, and that is a decision rather than an
  unfinished corner. Caching `/api/playlist` would deal a deck that no longer matches the real playlist,
  because an editorial playlist has its tracks refreshed by Spotify; and `/api/year`'s freshness story is
  the shared Upstash cache on the server, so a second unmanaged copy in one browser is a hole in that
  design rather than an extension of it. **What works offline:** the app loads, and a saved session
  resumes and stays fully playable — the QR is a data URL, the flip and the swipe are local, and resolved
  years travel with the cards. **What does not:** audio previews, year lookups for unresolved cards, and
  starting a new deck (which produces Phase 7's `offline` copy immediately rather than hanging). This is
  the same graceful degradation as the mid-game-disconnect bullet above, now also true with the network
  off entirely. **None of the three has been observed** — it is what the configuration implies; see §5.
- **An update lands only after every tab of the app is closed, and that delay is deliberate.** The worker
  uses the waiting default rather than `skipWaiting`, so a redeploy does not take effect in a running
  tab. The reason is specific: the app code-splits `GameScreen`, the QR encoder and the PDF chunks, so a
  worker that activated mid-game would leave the open tab requesting a chunk hash that no longer exists —
  the player advances one card and the app breaks. **The trade is a stale tab against a session that
  cannot break underneath itself**, and for a game played in one sitting the stale tab costs nothing.
  There is no update prompt: `registerType: 'prompt'` with no prompt UI wired up is exactly "wait
  quietly". Verified only by reading the generated worker — the redeploy check in §5 is Pending.
- **The deck's two peeking backs do not render at all on a full-height card.** Measured 2026-08-06 with
  `getBoundingClientRect` at the 448px ceiling: back 1 peeks **1.04px** below the card, back 2 **2.08px**,
  and both are inset on every other side — so the depth cue that tells a player there is more deck is
  invisible, and the card's own 2px ring covers even that. `scale()` is centre-origin, so it lifts the
  bottom edge by `(H / 2) × BACK_SCALE_STEP` (8.96px at H = 448) while `translateY` pushes it down only
  10px. **It gets worse as the card grows:** at the 288px floor the inset is 5.76px, so back 1 peeks by a
  marginal 4.24px. Pre-existing from Phase 5 and found only when the stack was first rendered in a
  browser, while verifying the Phase 8 ring. **Not fixed**, because the remedy is a deck-feel decision
  with real options — raise `BACK_OFFSET_PX`, drop `BACK_SCALE_STEP` to zero, or make the offset
  proportional to `--card-height` — rather than a mechanical correction, and Phase 7 open question 2
  explicitly resolved to keep the offset absolute. One consequence to know: `card-ring-dim`, which took
  the backs from 1.31:1 to 4.23:1 against the page, is **currently inert at desktop card sizes**. The
  colour correction is right; the geometry is a separate decision. Arithmetic in
  [`agent_findings.md`](./agent_findings.md).
- **Nothing about Phase 8's card redesign has been verified beyond one browser render, and Lighthouse has
  not been re-run since it landed.** The ring's tokens and both `@utility` composites are pinned by the
  canary, and every call site has a class-name assertion — but jsdom evaluates no `mask-composite`,
  computes no layout and paints nothing, so that is the automated ceiling. What _was_ done is one Chrome
  screenshot of a throwaway static page reproducing `Card`'s and `CardStack`'s exact class strings, which
  confirmed the gradient, the bloom and the neon year and produced the backs finding above. **It is one
  viewport, one browser, no OS preferences and no assistive technology.** The post-redesign Lighthouse
  re-measure is owed and should be aimed at **paint rather than layout**: the ring is a `border-box`
  border plus a `box-shadow`, so the card's measured box is unchanged at 288 × 448 and CLS should not
  move, while two blooms and a masked pseudo-element on a 3D-transformed element are new work for the
  compositor. The number to protect is **Performance 99 / LCP 1.6 s**. Checklist in §5.
- **The Android back press is intercepted mid-game as of 2026-08-12, and NOTHING about it has been observed on a device — including whether the gesture reaches the webview as a `popstate` at all.** That is the load-bearing assumption of the whole feature and it cannot be checked in Chrome, which supplies its own back affordance and its own history entries. The seven checks are in §5 and every one needs the installed TWA. Three limits on what the tests are worth, all measured rather than assumed: jsdom fires `popstate` on `history.back()` **asynchronously** (~10 ms), so the wiring really is exercised; **`history.length` cannot see a stray entry** in jsdom or in a browser, because going back retains the forward entry, so the tests assert the current entry's identity instead; and **the StrictMode phantom pop cannot be reproduced locally at all** — a `pushState` that beats a queued traversal discards it in jsdom, where the spec has the traversal re-resolve its delta when the task runs, so `pendingCleanupTraversals` guards a Chrome-only failure that no green suite can vouch for. The most consequential unknown is **Android 13+ predictive back**: if the generated shell keeps the legacy behaviour, the OS may animate the app peeling away while the web app is in fact handling the press, which looks broken even though nothing is. The remedy for that would be in the Android shell, not in this code. One behaviour change **is** visible in a browser and is deliberate: during play, the browser's own back button now opens the exit confirmation.
- **The welcome screen shows on every fresh load, and the PDF's service-worker path has never been observed.** Both are 2026-09-18 decisions rather than gaps: a persisted "seen it" flag was not asked for and costs a returning player one press, and the `.pdf` denylist plus the not-precached asset are what the configuration says — §5 has the rows. **The left swipe has met no thumb either**: `swipeIntent` is exact in the node tests, and the first device pass will say whether stepping back on a left swipe feels like the right assignment.
- **Touch gestures were verified on ONE Android device (2026-08-06) and on no iPhone. The thresholds are no longer unvalidated, but they are validated by one thumb.** The pass reported "gestures work fine" with **no retune**, so the five constants in `src/game/gestures.ts` stand as measured-acceptable rather than as guesses — including `SWIPE_COMMIT_DISTANCE_PX` at **52% of the card's width at its floor**, which the arithmetic below predicted might feel long and evidently does not. What is still open is the entire iOS column of §5's Phase 5 checklist: tap-versus-swipe under Safari's stricter gesture handling, whether pull-to-refresh is genuinely suppressed, whether the card needs `select-none`, and whether audio still starts from the first tap. **If touch misbehaves on an iPhone, those five constants remain the first place to look** — not the hook, and not Motion. Historical note, kept because the reasoning is still the right shape: `SWIPE_COMMIT_DISTANCE_PX` (96px) was chosen as a third of a fixed 288px card; the card is now fluid and 288px is only its ceiling, so at the floor the same 96px is **52%** of the card's width and a commit takes a visibly longer drag on a small screen. It is deliberately not retuned — a second number chosen by eye is not an improvement on the first, and the velocity half of the commit rule (500px/s, card-size-independent) still catches the flick most phone gestures actually are. The comment in `src/game/gestures.ts` records the arithmetic so whoever runs the device pass knows which end of the range to test at. Decided 2026-08-05: the Phase 5 real-device pass was scoped and then waived. `plan.md` names touch as the place this breaks, and jsdom cannot substitute — Motion's drag reads geometry it does not compute. What _is_ covered is every threshold decision, exhaustively, in `src/game/gestures.test.ts` (node), plus the keyboard path in jsdom; what is not is whether those numbers feel right under a thumb, whether pull-to-refresh is genuinely suppressed, and whether iOS needs `select-none` on the card. The five constants in `src/game/gestures.ts` are the retuning surface. Full checklist in §5.
- **The installed Android app and the Chrome browser share one `localStorage`, and that is how a Chrome TWA works rather than a defect.** A Trusted Web Activity renders inside Chrome's own profile, so `hitster:session:v1` and `hitster:library:v1` on the origin are **one store seen from two launchers**: a game started in the browser resumes in the installed app, a playlist saved in the app appears in the browser's library, and clearing Chrome's site data for the origin empties both. This is the persistence design doing what it was built to do — one origin, one saved session — and there is no code that could separate them, nor any reason to add one. **It belongs in the tester notes, because a tester who does not know it will file it as a bug**, in the shape "the app remembered a game I never played in it" or "it lost my deck when I cleared my browser". §5's TWA row 4 confirms it in both directions, which makes that row a confirmation rather than a defect hunt. The two-tab last-write-wins hazard already recorded for those keys applies across the two launchers too, for the same reason and at the same accepted cost.

---

## 9. The Android release (Google Play)

**This section is written from [`plan.google-play-shell.md`](./plans/plan.google-play-shell.md), not from a release that has happened.** Steps 1–5 of that plan are done — the origin is pinned, the manifest and the privacy policy are in place, the placeholder asset-links file is committed, and the toolchain below is installed and passing `bubblewrap doctor`. **Steps 6–18 have not been run at all.** Everything after "The toolchain" is therefore a plan-derived skeleton: the order is right, the prompts and the Console steps are as the plan describes them, and nobody has typed any of it. The plan's own step 18 is to come back and correct this section from the first real release — do that rather than treating it as a tested procedure.

**Two of these steps cannot be driven by an agent's shell.** `bubblewrap init` and `bubblewrap build` are interactive: they prompt for the application id, the colours, the orientation, the notification/billing/geolocation questions and — on every build — the keystore passwords. A non-interactive shell either hangs or answers with defaults, and a default is wrong in the one place that is permanent (the application id, below). **Keystore passwords must never reach a shell history**, which is a second reason the build is typed by a person.

### The production origin

```
https://playlistjitster.vercel.app
```

**This is the one value every later step reads.** Bubblewrap binds the shell to it permanently, the Digital Asset Links statement is fetched from it by the Android verifier, and an App Link is matched against it. It is a stable production alias, never a per-deployment URL — a deployment URL changes on the next push, and a TWA bound to one breaks with no error a player could interpret.

Measured 2026-09-19:

- It answers `200`, and serves `manifest.webmanifest` at its **root** with `Content-Type: application/manifest+json` — name "Playlist Jitster", `start_url: '/'`, `display: standalone`.
- `index.html` carries the two things `vite-plugin-pwa` injects rather than anything written by hand: `<link rel="manifest" href="/manifest.webmanifest">` and `<script id="vite-plugin-pwa:register-sw" src="/registerSW.js">`.
- Both `/registerSW.js` and `/sw.js` return `200`.
- The older **`custom-hitster.vercel.app` 307-redirects to it.** So the shell must be bound to the new host and never the old one: a TWA whose origin redirects is treated as having navigated **away from the verified origin**, and what the player gets is a URL bar. The verifier only ever fetches the statement file from the new host, so the old alias needs nothing.

`.vercel/repo.json` still links this checkout to the Vercel project named `custom-hitster`. That is the project's internal name, it is not an origin, and none of the above is affected by it — do not "fix" it.

### The toolchain — installed on this machine 2026-09-19

The versions are written down because **the next release will be run against whatever the machine has then**, and a difference is the first thing to suspect when a step below behaves differently.

| Tool                       | Version                             | Where / how                                                                                                                    |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@bubblewrap/cli`          | **1.25.0**                          | Installed **globally** with `npm i -g @bubblewrap/cli`. **Never a project dependency** — see below                             |
| Microsoft OpenJDK          | **17.0.10** (`build 17.0.10+7-LTS`) | `C:\Users\AleixRabassa\AppData\Local\Programs\Microsoft\jdk-17.0.10.7-hotspot`, via `winget install --id Microsoft.OpenJDK.17` |
| Android SDK build-tools    | **36.1.0**                          | `C:\Android\sdk`. The exact version Bubblewrap 1.25.0 hard-codes as `BUILD_TOOLS_VERSION` — not a free choice                  |
| Android SDK platform-tools | **37.0.1**                          | Same root. **This is where `adb` comes from**, which §5's TWA row 7 needs                                                      |
| Android platform           | **android-36**                      | Same root (`platforms;android-36`)                                                                                             |
| Android cmdline-tools      | **23.0** (build 16111833)           | Same root. See the `sdkmanager` trap below                                                                                     |

**`@bubblewrap/cli` is global-only, and that is an explicit exception to the pnpm-only rule rather than a violation of it.** As a project dependency it would pull an Android toolchain into `devDependencies` and `pnpm-lock.yaml`, and not one of the four pre-commit checks needs it.

Bubblewrap's own config lives at `~/.bubblewrap/config.json` and holds `jdkPath` and `androidSdkPath`. **Write both as forward-slash paths.** A Windows path with backslashes is invalid JSON escaping, and Bubblewrap fails with `Bad escaped character in JSON` — which reads as a corrupt install rather than as a path you typed.

**Two things cost real time during the install and will cost it again.** Both were measured on 2026-09-19 and are recorded verbatim because neither is guessable:

1. **Command-line tools build 16111833 deprecates `sdkmanager`** in favour of a new `android` CLI, and the shim does not accept the old package syntax — `sdkmanager "build-tools;36.1.0"` is rejected with `Package build-tools not found`, which reads as a wrong package name rather than as a deprecated tool. The invocation that works is:

   ```bash
   android.exe sdk --sdk=C:/Android/sdk install "build-tools;36.1.0" "platform-tools" "platforms;android-36"
   ```

2. **Bubblewrap's `validatePath` requires the SDK root to contain a `bin/` or a `tools/` directory**, and the modern `cmdline-tools/latest/...` layout provides neither. So `bubblewrap doctor` reports `The androidSdkPath isn't correct` against a perfectly good SDK. Resolved here by junctioning `C:\Android\sdk\bin` and `C:\Android\sdk\lib` at `cmdline-tools\latest\bin` and `cmdline-tools\latest\lib`. After that:

   ```
   Your jdkpath and androidSdkPath are valid.
   ```

   That line is the check that the toolchain is usable. A green `winget` and a successful package install are not.

### The release process — step 1, the shell generation and the target-SDK check are RUN; steps 7 to 18 are not

1. **Generate the shell.** `bubblewrap init` against the deployed manifest URL, inside `android/`. At the prompts: the **application id is `aleixrabassa.playlistjitster`** — type it, and do not accept Bubblewrap's host-derived default (`app.vercel.playlistjitster`), which puts the app in a namespace nobody here owns and is **permanent after first publish**. Keep the manifest's name and short name, standalone display, the page colour for theme and background, and the 512 icon as the splash source. Answer the **orientation** prompt with the any/default option — the absence of `orientation` in `src/pwa/manifest.ts` is a decision pinned by a test, and this prompt is the thing that threatens it. **Decline Play Billing and the geolocation permission**, keep the default **Custom Tabs fallback**, and leave the shortcuts list empty.
   - **RUN 2026-09-20, and one instruction above was wrong.** Bubblewrap 1.25.0 **never asks about notification delegation** — there is no prompt to decline, and `enableNotifications` defaults to **`true`**, which puts `POST_NOTIFICATIONS` in the generated `AndroidManifest.xml`. Set it to `false` in `android/twa-manifest.json` by hand and regenerate. `should decline notification delegation` in `src/pwa/twa-manifest.test.ts` is what now catches it; **re-check the field after every future `init` or `update`**, because nothing will ever prompt for it. It also never asked about shortcuts (only offered when the web manifest declares a `shortcuts` section, and ours does not) or about the fallback; both defaulted correctly.
   - **Regenerate with `bubblewrap update --skipVersionUpgrade`.** Without the flag it bumps `appVersionCode`, and it prompts for a version name whenever `appVersionName` and the previous code disagree — with the flag there is no prompt at all, and the first upload stays at version code 1.
   - **What the shell opens on:** `startUrl` is `/`, so every **cold launch shows the welcome screen**, by the 2026-09-18 decision — the flag that skips it is `useState` in `App.tsx` and is deliberately not persisted. Testers should expect it; `docs/store/tester-notes.md` says so.
   - **`android/manifest-checksum.txt` is a SHA-1 of `twa-manifest.json`**, and `bubblewrap build` reads it: absent, it offers to regenerate the project; present but stale, it offers to update. It is **ignored** rather than tracked, and the `.gitignore` block explains why the obvious reading is backwards — everything the checksum certifies is ignored too, so on a fresh clone a tracked checksum would _suppress_ the regeneration a clone needs and the build would fail on a missing `gradlew`.
2. **Keystore.** Generated outside the repo, or inside it and ignored — never tracked; passwords in a password manager. With Play App Signing enabled, a lost _upload_ key is a Play Console support round-trip rather than the end of the app's update path. Back it up anyway.
3. **Check `targetSdkVersion`** — Bubblewrap 1.25.0 emitted **`targetSdkVersion 36`** with `compileSdkVersion 36` and `minSdkVersion 21` on 2026-09-20, which is the newest API level available, and on 2026-09-21 that was confirmed to be exactly what Play requires: **API 36 for new apps and for updates from 31 August 2026** (existing apps 35 to stay available to new users; an extension to 1 November 2026 can be requested from the Console). So no bump was needed. The requirement advances every August, so **re-read it before every release** — and read it, never remember it. It was read from `developer.android.com/google/play/requirements/target-sdk` rather than from the Console, because the Console's policy pages are per app and the app did not exist yet; once it does, prefer the Console, which wins on any disagreement. The bump, if one is ever needed, goes in **`android/twa-manifest.json`** and never in `android/app/build.gradle`, which `bubblewrap update` deletes and regenerates.
4. **`bubblewrap build`** — an AAB and an APK. **Install the APK on a real device and expect a URL bar.** Asset links are not complete yet, so that is the correct intermediate state, and seeing it is what makes its later absence mean something (§5, TWA row 1).
5. **Play Console.** Pay the one-time registration fee, complete identity verification, create the app, upload the AAB to internal testing, then read **two** SHA-256 fingerprints from the app signing page: the **app signing key** (Google's, used for what users install) and the **upload key** (yours, used for local installs).
6. **Complete the asset links.** `bubblewrap fingerprint add <sha256>` for each, then `bubblewrap fingerprint generateAssetLinks`, and copy the output into `public/.well-known/assetlinks.json` rather than hand-editing two files. **Both fingerprints, always** — either one alone is a perfectly valid file that produces a URL bar on exactly half the installs. Redeploy, reinstall, and prove verification with §5's TWA rows 1 and 7 rather than by eye. **Read Google's checker with the two caveats measured 2026-09-19** (row 7 states them): an empty fingerprint list answers `ERROR_CODE_MALFORMED_CONTENT` rather than "reachable", and the response's `maxAge` is ~600 s, so wait ten minutes after the redeploy before concluding the statement did not take — a redeploy loop inside that window measures the cache.
7. **Listing, policy declarations and the pre-launch report** — the listing copy lives in `docs/store/` so it is reviewable. Then the **closed test**: twelve or more testers, opted in and kept opted in for **fourteen continuous days**, which is the calendar critical path on a personal account. Then apply for production access and roll out **staged**, never at 100%.

**A redeploy of the web app updates every install with no new release** — the store build is the deployed site, not a copy of it. A new Play release is needed only for something in `android/`: the application id, the target SDK, the icons and splash, or a shell-side fix such as the back-press row 7 in §5.
