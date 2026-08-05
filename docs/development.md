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
| iOS Safari: tap-to-flip fires reliably, and a tap is never read as a swipe                               | A tap misread as a swipe skips a card **irrecoverably** — there is no previous card                              |
| iOS Safari + Android Chrome: a deliberate slow drag of ~⅓ the card's width commits                       | `SWIPE_COMMIT_DISTANCE_PX` is a guess at 96px                                                                    |
| Both: a fast flick advances, and a drag released below threshold snaps back                              | The offset-**or**-velocity rule, and the dead band between the two thresholds                                    |
| Both: a swipe is never misread as a tap                                                                  | That reveals the answer the player was mid-guess on                                                              |
| Both: no rubber-band scroll or pull-to-refresh steals the gesture, especially near the top of the screen | `overscroll-behavior: none` + `touch-none` are the mitigations; neither is confirmed                             |
| iOS Safari: no accidental text selection and no long-press context menu on the card                      | Open question — `select-none` was **not** added pre-emptively, pending this check                                |
| iOS Safari: audio still starts from the **first** tap                                                    | iOS is strictest about the user-gesture requirement, and the gesture layer now sits between the tap and `play()` |
| iOS Safari: the layout does not shift as the toolbar shows/hides                                         | The card is viewport-sized and `dvh` behaves differently there                                                   |
| By eye: is 2 backs right, or 3?                                                                          | `VISIBLE_BACKS` in `CardStack.tsx`; `plan.md` says "2–3 cards peeking"                                           |

If any of this turns out to be wrong in the field, **the five constants in `src/game/gestures.ts` are the first place to look** — they are named, documented, and designed to be retuned by someone who did not write them. Changing them requires no change to the hook or to Motion. Note that `CardStack.test.tsx` asserts "up to two backs", so raising `VISIBLE_BACKS` means updating two test expectations as well.

### Playing a real game, and the progressive-loading verification

**`npx vercel dev`, then paste a playlist link.** `pnpm dev` cannot do this at all: pressing Start returns the transpiled source of `api/playlist.ts` with a 200, which `playlist-client.ts` correctly reports as `unexpected-payload` — so the app shows _"Spotify returned something we could not read"_ and you may reasonably think the client is broken when it is doing its job.

**Configure Upstash before playing a full deck**, for the reason in §4: without it nothing paces MusicBrainz across invocations, and a 50-card deck becomes ~100 unthrottled requests against a service that rate-limits to 1 req/s and blocks clients that ignore it.

The end-to-end checks worth running by hand, each pinning a decision:

| Check                                                                                            | Status  |
| ------------------------------------------------------------------------------------------------ | ------- |
| Each of the five suggested playlists loads and deals a deck                                      | Pending |
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

**Three widths.** 320px, a tablet, and a wide desktop, across every screen.

| Check                                                                             | Status  |
| --------------------------------------------------------------------------------- | ------- |
| At 320px the card **and** its control bar both fit, with the HUD still on screen  | Pending |
| The peeking backs stay aligned with the card at all three widths                  | Pending |
| `BACK_OFFSET_PX` (10px) still reads as depth on the smallest card                 | Pending |
| The HUD and the notice banner line up with the card's width when wide             | Pending |
| A long user-created playlist name truncates without pushing the count off the row | Pending |
| The landing screen's five suggestions are usable at 320px                         | Pending |
| A phone in **landscape**: the card fits the short viewport                        | Pending |

The landscape row is what the `62dvh` term in `--card-height` exists for; without it a landscape
phone gets a 448px card in a 375px viewport ([`architecture.md`](./architecture.md) §3).

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

Mostly carried forward from the Phase 0 research; measurements and reasoning in [`plans/plan.md`](./plans/plan.md) §5. The last three are execution gaps rather than research findings — things this repo cannot check about itself.

- **Playlists are capped at 100 tracks, and the app cannot tell when it happened.** The Spotify embed endpoint returns at most 100 tracks and its payload contains **no pagination signal whatsoever** — no total, no offset, no `hasMore` — so a response of exactly 100 is indistinguishable from a playlist that genuinely holds 100. There is no way to page past track 100: the anonymous bearer token in the embed payload was tested against the Web API and returns `429 QUOTA_EXCEEDED` immediately, because its client ID is shared by every embed viewer on the internet. Phase 6 will show a non-blocking warning at exactly 100 tracks; a manual track-paste fallback is deferred past v1.
- **The embed endpoint is unofficial and may change or break without notice.** Reading it is outside Spotify's Developer Terms; this is an accepted risk for a personal project. All scraping is to be confined to a single adapter module so a breakage is contained, and the QR code is always rendered regardless of whether audio or metadata extraction works — so the deck degrades rather than dies.
- **Release years will sometimes be wrong.** MusicBrainz has no canonical "original studio recording" per song; famous tracks have hundreds of competing live, bootleg, and reissue entries. As built, the strict pass resolved **14 of 14** known-tricky tracks exactly (2026-08-04) against a ~6% naive baseline — but that is a curated set, not a random one, and a track the strict filters cannot place falls through to a relaxed pass that is measurably off by a year or so. Those come back as `confidence: 'low'`, and Phase 6 marks them unconfirmed on the card's revealed side. There is no pre-Start review of years — the player pastes the playlist, so that would spoil the deck.
- **Year resolution is slow the first time, and the 1 req/s budget is shared by everyone.** A lookup costs two paced MusicBrainz requests, so a cold 100-track playlist takes several minutes. The cache means only genuinely new songs ever pay it — but the budget is global, so two people resolving cold playlists at once each get half the throughput. Acceptable for a personal project; the number to watch if the app is ever shared widely.
- **In-app audio covers ~99.5% of tracks, not all of them.** Measured across 398/400 tracks in Phase 0. For a track with no preview URL, Play/Pause and Restart are disabled; the QR code and Exit still work.
- **The app cannot be played under `pnpm dev` — only under `npx vercel dev` or a deployment.** Vite serves `api/playlist.ts` as transpiled source with status 200, so the playlist client reports `unexpected-payload` and the landing screen shows an error that reads like an app bug. This is not fixable without a dev-server plugin that runs functions, which `vercel dev` already is.
- **Progressive loading has never been verified against a real deployment.** Step 15 of the Phase 6 plan, carried over from Phase 3, is still owed — including the 50-track cold-deck wall clock (unmeasured since Phase 2) and the StrictMode request count. Nothing local models it: the shared cache and the 1 req/s gate are both backed by the Upstash variables, so without them the gate paces nothing and the numbers mean nothing. Checklist in §5.
- **None of Phase 7's reduced-motion, responsive, keyboard or screen-reader behaviour has been verified, and no test in this repo can verify it.** The token layer, the fluid card, the `prefers-reduced-motion` block, the focus states and the ARIA fixes all landed with both ends of each contract asserted — a component renders a `data-motion` hook or a `focus-visible:focus-ring` class, and `src/index.css.test.ts` asserts the stylesheet names it — and **nothing in between**. jsdom evaluates no media queries, has no `window.matchMedia` at all, computes no layout, and has no accessibility-tree consumer, so a class-name assertion is the ceiling of what is automatable. The four passes are scoped in §5 and every row is Pending. **The screen-reader pass is the one to prioritise**: Phase 7 added the app's only live region, on the card's reveal, and the entire point of it is that a flip becomes audible — a player using a screen reader had no way to learn the year before it, and no local check confirms they do now. A live region that mounts already-populated is the known soft spot, since readers differ on announcing content present at insertion.
- **The before/after screenshot comparison for Phase 7 was never run.** Step 12 of [`plan.phase-7-look.md`](./plans/plan.phase-7-look.md). The plan's success condition was that naming the existing values changed nothing visible except four measured contrast corrections, so the comparison is the check on that claim and it is outstanding. §5 lists the seven changes that _are_ expected to be visible, which makes it a checklist rather than a hunt.
- **Touch gestures have never been verified on a real device, and the thresholds are unvalidated guesses. Phase 7 made this worse rather than better.** `SWIPE_COMMIT_DISTANCE_PX` (96px) was chosen as a third of a fixed 288px card; the card is now fluid and 288px is only its ceiling, so at the floor the same 96px is **52%** of the card's width and a commit takes a visibly longer drag on a small screen. It is deliberately not retuned — a second number chosen by eye is not an improvement on the first, and the velocity half of the commit rule (500px/s, card-size-independent) still catches the flick most phone gestures actually are. The comment in `src/game/gestures.ts` records the arithmetic so whoever runs the device pass knows which end of the range to test at. Decided 2026-08-05: the Phase 5 real-device pass was scoped and then waived. `plan.md` names touch as the place this breaks, and jsdom cannot substitute — Motion's drag reads geometry it does not compute. What _is_ covered is every threshold decision, exhaustively, in `src/game/gestures.test.ts` (node), plus the keyboard path in jsdom; what is not is whether those numbers feel right under a thumb, whether pull-to-refresh is genuinely suppressed, and whether iOS needs `select-none` on the card. The five constants in `src/game/gestures.ts` are the retuning surface. Full checklist in §5.
