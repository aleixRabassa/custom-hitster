# Architecture

Custom Hitster is a **client-heavy single-page app with a thin serverless backend**. The game itself — shuffle, flip, swipe, audio, progress — runs entirely in the browser. The backend exists only to do the three things a browser cannot: reach a CORS-blocked endpoint, set a custom `User-Agent`, and hold a cache shared across all users.

> **Implementation status: Phase 1 (skeleton) complete; Phase 2 playlist ingestion built.** The shell, `/api/hello`, and the playlist path (`parsePlaylistUrl()`, the embed adapter, `/api/playlist`) exist today. Year resolution and the cache do not. Sections below are marked **[built]** or **[planned]** throughout; planned shapes come from [`plans/plan.md`](./plans/plan.md) §3 and are recorded here because they determine where new code belongs, not because they exist.

---

## 1. Components

| Component            | Technology                         | Location  | Status                                                    |
| -------------------- | ---------------------------------- | --------- | --------------------------------------------------------- |
| Browser SPA          | Vite 8 + React 19 + Tailwind CSS 4 | `src/`    | **[built]** shell only                                    |
| Serverless functions | Vercel Functions (Node 24 runtime) | `api/`    | **[built]** `hello`, `playlist`, `year`                   |
| Portable shared code | TypeScript, no platform APIs       | `shared/` | **[built]** types, URL parsing, artist helper, year logic |
| Year cache           | Upstash Redis (REST)               | —         | **[built]** behind `YearCache`; in-memory locally         |

There is **no database, no message broker, no background worker, and no container runtime** in this project, and none are planned. The only persistent stores are the Upstash Redis cache (built, server-side, optional) and `localStorage` (planned, client-side).

The Upstash dependency is **optional by design**: `createCache()` and `createRateLimitGate()` both fall back to per-instance implementations when the variables are absent, so the repo clones and runs with no accounts of any kind. Both log which mode they picked at cold start, because a silent fallback in production looks exactly like a cache that never hits.

### Ports

| Surface                   | Port   | Serves                                     |
| ------------------------- | ------ | ------------------------------------------ |
| `pnpm dev` (Vite)         | `5173` | SPA only — **not** `api/` (see §5)         |
| `vercel dev` (Vercel CLI) | `3000` | SPA **and** `api/` behind one origin       |
| `pnpm preview`            | `4173` | The built `dist/`, to sanity-check a build |

---

## 2. Import boundaries — which tree may import what

This is the single most consequential structural rule in the repo, because violating it fails **only at deploy time**.

```
src/      React SPA (browser).      May use the `@/` alias. May use DOM APIs.
api/      Vercel Functions (Node).  MUST import shared/ by RELATIVE path + `.js`. No DOM APIs.
shared/   Used by BOTH.             No DOM APIs, no Node APIs. Pure, portable code.
```

```
      ┌──────────┐                   ┌──────────┐
      │   src/   │                   │   api/   │
      │ (browser)│                   │  (Node)  │
      └────┬─────┘                   └────┬─────┘
           │  @/ alias OK                 │  RELATIVE path ONLY
           │  ../shared/… also OK         │  `@/…` breaks on deploy
           │                              │  …and the `.js` extension
           │                              │  is REQUIRED at runtime
           └───────────┐     ┌────────────┘
                       ▼     ▼
                   ┌─────────────┐
                   │   shared/   │   no DOM, no Node
                   └─────────────┘
```

- **`shared/` sits at the repository root, not under `src/`.** This keeps the boundary symmetrical: neither side reaches into the other's tree, and both reference `shared/` by plain relative path.
- **`api/` must never import via the `@/` alias.** Vercel's Node runtime documentation states that of the root `tsconfig.json`, _"Most options are supported aside from Path Mappings and Project References."_ An aliased import inside a function type-checks locally and then **fails to resolve at deploy time**. Use `../shared/…`; `api/hello.ts` is the reference shape.
- **The `.js` extension on those relative imports is mandatory, not cosmetic** — `'../shared/constants.js'`. `package.json` declares `"type": "module"`, so a deployed function is ESM, and Node's ESM resolver does not guess extensions the way CommonJS does. Vercel **transpiles** functions rather than bundling them, so the specifier reaches Node verbatim. The rule covers all of `api/` and any `shared/`→`shared/` **runtime** import; type-only imports erase and are exempt. TypeScript resolves the `.js` specifier back to the `.ts` source, and so does Vite, so the identical form works in the browser build and under Vitest.
- The `@/` alias is declared in `tsconfig.json` and mirrored in `vite.config.ts`. Vite resolves it at bundle time, which is why the client side is unaffected by Vercel's limitation.
- The boundary is enforced by `pnpm typecheck` running **twice**, once per narrowed config — see [`toolchain.md`](./toolchain.md) §2.
- **Server-only helpers live in `api/_lib/`, and cannot live in `shared/`.** That is a hard gate, not a preference: `tsconfig.app.json` supplies only `vite/client` types and includes `shared/`, so a single `process.env` reference there fails `pnpm typecheck:app`. Anything needing env access, a Node API, or knowledge of an upstream wire format belongs under `api/_lib/` — which Vercel does not route, since `_`-prefixed paths are excluded (probe-verified 2026-08-04, see [`agent_findings.md`](./agent_findings.md)). Tests and fixtures sit there too, beside the code they cover. "Just put it in `shared/`" is the obvious wrong move.

Both halves of the `api/`→`shared/` rule are now proven in production, and the extension half was learned the hard way. **Correction to what this section previously claimed:** the 2026-08-03 deploy proved only that the build _succeeded_ — `/api/hello` was never actually requested, and when it finally was (2026-08-04) it returned **500 `FUNCTION_INVOCATION_FAILED`** because of the missing extension. A pair of throwaway probe functions differing only in that extension settled it: extensionless → 500, `.js` → `200 {"maxEmbedTracks":100}`. Full detail in [`agent_findings.md`](./agent_findings.md).

The aliased side has deliberately never been tried on Vercel — per Vercel's own docs it should not be. **Grep for `@/` under `api/` before deploying, and check that every relative import there ends in `.js`.** Neither `typecheck`, `lint`, `test`, `build`, nor `format:check` can see either mistake.

---

## 3. Data flow

### Built today

```
Browser                                  Vercel Function
┌────────────────────┐                   ┌──────────────────────────────┐
│ src/main.tsx       │                   │ api/hello.ts                 │
│   └─ src/App.tsx   │   GET /api/hello  │   imports MAX_EMBED_TRACKS    │
│      (placeholder) │ ─────────────────▶│   from ../shared/constants.js │
│                    │ ◀─────────────────│   returns {ok, message,       │
└────────────────────┘   JSON            │            maxEmbedTracks}    │
                                         └──────────────────────────────┘
```

Playlist ingestion, as built. No caller exists yet — Phase 6 wires the landing page to it:

```
                       GET /api/playlist?url=<any accepted form>
                                    │
                                    ▼
                     ┌──────────────────────────────────────┐
                     │ api/playlist.ts                      │
                     │  · guard method (405 + Allow)        │
                     │  · read `url` (may be string[])      │
                     │  · parsePlaylistUrl()  → shared/     │
                     │  · map error code → HTTP status      │
                     └───────────────┬──────────────────────┘
                                     │ playlist id + global fetch
                                     ▼
                     ┌──────────────────────────────────────┐
                     │ api/_lib/spotify-embed.ts            │
                     │  · GET open.spotify.com/embed/…      │  ──▶ Spotify
                     │    with a browser User-Agent          │      (anonymous)
                     │  · extract <script __NEXT_DATA__>    │  ◀── HTTP 200 HTML
                     │  · BRANCH ON pageProps.state,        │
                     │    NOT on the HTTP status            │
                     │  · assert entity.uri === requested   │
                     │  · normalize trackList → Card[]      │
                     └───────────────┬──────────────────────┘
                                     ▼
        200 {playlist, cards[], truncated, skippedCount}
        + Cache-Control: s-maxage=300, stale-while-revalidate=600
        (edge snapshot cache — no Redis dependency)
```

`api/hello.ts` has no behaviour worth testing. It exists to pin down four things before Phase 2 depends on them: the default-export handler signature, the `@vercel/node` request/response types, the relative `shared/` import, and membership in `tsconfig.api.json`. The `maxEmbedTracks` field in its response is there to prove the shared constant genuinely **resolved and bundled** on the Node side rather than merely type-checking.

### Year resolution — built

```
GET /api/year?title=…&artist=…&durationMs=…
        │
        ▼
┌──────────────────────────────────────┐
│ api/_lib/resolve-year.ts             │
│  1. cleanTrackTitle()                │   "… - Remastered 2011" returns ZERO
│                                      │   results verbatim, so this is mandatory
│  2. cache.get(mbyear:v1:artist|title)│──▶ HIT: return, cached:true
│                                      │        NO gate, NO request
│  3. MISS ▼                           │
└──────────┬───────────────────────────┘
           ▼
┌──────────────────────────────────────┐
│ api/_lib/musicbrainz.ts              │
│  gate.acquire() ─── busy ────────────┼──▶ 429 + retryAfterMs
│  ① recording?query=… AND dur:[±10s]  │──▶ MusicBrainz  (limit=100)
│     └ flatten rec → release → group  │
│  gate.acquire()                      │
│  ② release-group?query=rgid:(a OR b) │──▶ MusicBrainz  (ONE batched call)
│     └ attach first-release-date      │      — the ALBUM's original date
└──────────┬───────────────────────────┘
           ▼
┌──────────────────────────────────────┐
│ shared/year.ts  pickBestRecording()  │
│  strict  → official studio album,    │──▶ high / release-group
│            earliest group date       │
│  relaxed → no group filter,          │──▶ low  / recording
│            recording first-release   │
│  neither → year: null + reason       │──▶ none
└──────────┬───────────────────────────┘
           ▼
   cache.set(…) — ALL THREE outcomes, one TTL per tier (30d / 7d / 1d)
   200 {year, confidence, source?, reason?, cached, cleanedTitle, stripped}
   + Cache-Control tiered by confidence (30d / 1d / 1h)
```

Three orderings in that diagram are load-bearing and easy to "tidy" into bugs. **The cache is read before the gate**, so a replayed deck costs nothing and waits for nothing. **The second MusicBrainz call is batched**, so the request count is two regardless of whether the pool held 12 candidates or 842. **The year comes from the release GROUP's `first-release-date`, never from the release date inlined in the search response** — the latter is the reissue date and is wrong by decades (Billie Jean 2012, Bohemian Rhapsody 2001).

### Planned — the rest of the loop

```
Browser (SPA)                          Serverless (Vercel Functions)
┌──────────────────────┐               ┌─────────────────────────────────┐
│ Paste URL → Start    │──────────────▶│ /api/playlist          [built]  │
│                      │◀──────────────│                                 │
│                      │  normalized   ├─────────────────────────────────┤
│ progressive fill     │──────────────▶│ /api/year  (one per track)      │
│ (start on card 1)    │◀──────────────│                        [built]  │
│  · back off on 429   │  year          │  · 1 req/s gate + cache        │
├──────────────────────┤               └─────────────────────────────────┘
│ shuffle (seeded)     │                              ↓
│ flip / swipe / audio │                     Upstash Redis (year cache)
│ localStorage resume  │
└──────────────────────┘
```

**Why a serverless backend at all**, when the game is pure client-side:

1. **CORS** — the Spotify embed endpoint cannot be fetched from the browser.
2. **`User-Agent`** — MusicBrainz requires a descriptive one and browsers cannot set that header. It also rate-limits to 1 req/s.
3. **Shared cache** — a year cache across all users makes repeat playlists instant.

**Why progressive loading is structural, not polish:** a lookup costs two paced MusicBrainz requests, so a cold 100-track playlist takes **~3-5 minutes** — measured 1.3-3.6 s per track on 2026-08-04, against a warm cache 0 ms. Years resolve in the background, the game starts as soon as **card 1** is ready, and it only blocks if the player outruns the resolver. Two invariants fall out of that, both easy to violate without any test failing: **shuffle runs before resolution** (so the resolver walks the deck in play order and card 1 is genuinely the card the player sees first), and the resolver is a **sequential loop, not a fan-out** — a `Promise.all` over 100 cards turns the shared 1 req/s gate into ~99 429s. See [`plans/plan.md`](./plans/plan.md) §1 and §3.

---

## 4. External dependencies

| Service                                                 | Access                          | Auth                 | Notes                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spotify embed (`open.spotify.com/embed/playlist/{id}`)  | Server-side `fetch` **[built]** | **None** — anonymous | Unofficial. Parse `<script id="__NEXT_DATA__">`; tracks at `props.pageProps.state.data.entity.trackList`. All of it confined to `api/_lib/spotify-embed.ts`. **A missing playlist returns HTTP 200** — branch on `pageProps.state` |
| MusicBrainz (`/ws/2/recording` + `/ws/2/release-group`) | Server-side `fetch` **[built]** | `User-Agent` string  | 1 req/s, globally across all users. **Two** requests per lookup — a search plus one batched release-group call. All of it confined to `api/_lib/musicbrainz.ts`                                                                    |
| Upstash Redis                                           | REST **[built]**                | URL + token          | Production only, and **optional everywhere**: backs both the year cache and the 1 req/s gate, with per-instance fallbacks locally                                                                                                  |

### There are no Spotify credentials, and none are needed

Not in `.env.example`, not in Vercel. Spotify's February 2026 Web API changes mean **no credentialed path can serve "anyone with a public link"**: Client Credentials can no longer read playlist `items`, and new Development Mode apps are capped at 5 invited users. The app therefore reads the public embed endpoint with no login at all.

If you are about to add a `SPOTIFY_CLIENT_ID`, read [`plans/plan.md`](./plans/plan.md) §2 first — **the constraint is a product decision, not an oversight.**

### Why the year comes from MusicBrainz and not Spotify

Spotify reports the _album edition's_ date, which turns a 2011 remaster of Bohemian Rhapsody into a 2011 song. MusicBrainz's earliest release date for a recording is exactly the value Hitster needs. This makes year resolution a **core component**, not an enrichment pass.

Phase 0 measured that a naive "top-scored recording" lookup is **~6% accurate** (1 of 18 tricky tracks), because MusicBrainz has no canonical recording per song — every bootleg, live take, and reissue is its own entity, and dozens tie at the maximum relevance score. The verified fix is to bias the candidate pool toward `release-group` entries with `primary-type: Album`, no Live/Compilation/Remix/DJ-mix `secondary-types`, and release `status: Official`. Two hard constraints on implementing it:

- **Titles must be stripped** of `- Remastered YYYY` / `- Remaster` / `- Live` / `(feat. X)` suffixes before querying. Remaster-suffixed titles returned **zero** results in every case tested — mandatory, not an optimization.
- **The fix must not depend on the album name.** The embed endpoint carries no album name at track level, so filtering must use MusicBrainz-side signals only.

As built, the filter is that fix plus three things Phase 0 did not have, all measured on 2026-08-04 and all necessary to reach **14 of 14** on the known-tricky set:

- **The year comes from the release group's `first-release-date`, not the release date the search inlines.** A release group holds every pressing; the search returns whichever one matched, which is nearly always a reissue. This is what the second request buys.
- **`limit=100` and a `dur:[±10s]` bound on the query.** MusicBrainz ties dozens of candidates at the maximum score and orders them arbitrarily, so the original recording is often not on page one. At `limit=25` the same algorithm scores 2 of 13; the duration bound shrinks most pools below 100 outright.
- **The filters run client-side, never in the Lucene query.** Pushing `primarytype:album AND status:official` into the query looks like the obvious optimisation and returns **zero** results for Hallelujah / Leonard Cohen.

**Three confidence tiers, not one answer.** The strict pass reports `high`. When it finds nothing — 1 track in 14, always a huge candidate pool — a relaxed pass drops the release-group filters and reports `low`, which Phase 6 marks as unconfirmed on the card's revealed side. Only when that also fails does a card get `year: null` for manual entry. There is **no Spotify-year fallback**; the embed payload has no release date at track level, and earlier drafts of this file said otherwise in error.

**Cache keys carry a `v1` schema segment** (`mbyear:v1:{artist}|{title}`) precisely so a change to any of the above can invalidate every previously cached year in one edit. Without it, improved scoring would be masked indefinitely by entries computed under the old logic.

Full measurements are in [`plans/plan.md`](./plans/plan.md) §5 Phase 0 and [`agent_findings.md`](./agent_findings.md) (2026-08-04).

---

## 5. Local execution model, and a trap

`pnpm dev` starts Vite, which serves `index.html` and everything under `src/`. It has no concept of Vercel Functions, so **`api/` is not executable through it** — and what happens instead is actively misleading.

Vite treats any file under the project root as a transformable module, so `GET /api/hello` returns the **transpiled source** of `api/hello.ts` as `text/javascript`, with an inline sourcemap and a **`200` status**. It does not run the handler and does not fall through to the SPA. Three consequences:

1. A `200` from the Vite dev server is **not** evidence a function works.
2. `fetch('/api/…')` in dev fails at JSON parsing rather than 404-ing — easy to misread as a broken function.
3. **`api/` source is readable over the dev server**, so secrets belong in environment variables, never in that source.

Use `vercel dev` (port 3000) to exercise functions for real. See [`development.md`](./development.md) §4.

---

## 6. Routing and deployment topology

`vercel.json` declares the build command, the `dist` output directory, and one rewrite:

```json
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

An SPA needs a catch-all rewrite so unmatched paths return `index.html` and client-side routing works. A naive catch-all (`/(.*)`) would swallow the API routes too — a request to `/api/playlist` would receive the HTML shell instead of reaching the function. The negative lookahead `(?!api/)` makes the rewrite skip everything under `/api/`, leaving those paths to the functions.

`vercel.json` must be strict JSON and cannot carry comments, which is why this rationale lives here.

---

## 7. Planned components

Everything below is **not built**, except where a row says otherwise. The authoritative source for what belongs in which phase is [`plans/plan.md`](./plans/plan.md) §5 — **do not build ahead of the current phase.**

| Phase | Adds                                                                                                                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | ~~`parsePlaylistUrl()`, `/api/playlist`, `/api/year`, the `YearCache` interface, the 1 req/s gate, year-resolution logic~~ **[built] — phase complete**                                                                                       |
| 3     | `GameState`, reducer (`START`/`FLIP`/`NEXT`/`END`), seeded Fisher–Yates shuffle, localStorage resume, progressive loading (sequential, backing off on 429). The `Card` type itself is **[built]** — Phase 3 must not widen it with game state |
| 4     | Card component with CSS 3D flip, QR rendering, `previewUrl` + `<audio>` playback                                                                                                                                                              |
| 5     | Swipe-to-next, tap-to-flip, stacked-deck visuals, keyboard controls                                                                                                                                                                           |
| 6     | Landing page, suggested playlists, loading state, **reveal-side unconfirmed-year marking**, HUD, end screen                                                                                                                                   |
| 7     | Visual design, `@theme` design tokens, error/offline states, responsive, a11y, Lighthouse                                                                                                                                                     |
| 8     | Out of v1: shareable deck URL, PWA, PDF export, difficulty filters, multiplayer scoring                                                                                                                                                       |

Two dependencies are already installed with **no importers yet**, deliberately, so Phase 1 locks one coherent dependency tree: `motion` (Phase 5 gestures) and `qrcode` + `@types/qrcode` (Phase 4 QR).

### Design decisions already locked by Phase 0

- **In-app audio uses `previewUrl` + `<audio>`**, not the Spotify iFrame API. Preview coverage measured **398/400 tracks (99.5%)**. The iFrame API is disqualified on Terms-of-Service grounds: Spotify's embed terms forbid obfuscating or altering the widget, which is exactly what a hidden/covered iframe does.
- **Do not set `navigator.mediaSession.metadata`** on the audio element — it would leak title and artist to the OS lock screen, defeating the hidden side of the card.
- **The QR code is always rendered**, regardless of whether audio or metadata extraction works, so the deck degrades rather than dies.
- **The embed endpoint caps at 100 tracks with no pagination signal** — no total, no offset, no `hasMore`. `shared/constants.ts` encodes this as `MAX_EMBED_TRACKS`. A response of exactly 100 is indistinguishable from a playlist that genuinely holds 100, so Phase 6 shows a non-blocking warning rather than silently presenting an incomplete deck. A manual-paste fallback is deferred past v1.
