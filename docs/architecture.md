# Architecture

Custom Hitster is a **client-heavy single-page app with a thin serverless backend**. The game itself — shuffle, flip, swipe, audio, progress — runs entirely in the browser. The backend exists only to do the three things a browser cannot: reach a CORS-blocked endpoint, set a custom `User-Agent`, and hold a cache shared across all users.

> **Implementation status: Phase 1 (skeleton).** Only the shell and one reference function exist today. Sections below are marked **[built]** or **[planned]** throughout; planned shapes come from [`plans/plan.md`](./plans/plan.md) §3 and are recorded here because they determine where new code belongs, not because they exist.

---

## 1. Components

| Component            | Technology                         | Location  | Status                   |
| -------------------- | ---------------------------------- | --------- | ------------------------ |
| Browser SPA          | Vite 8 + React 19 + Tailwind CSS 4 | `src/`    | **[built]** shell only   |
| Serverless functions | Vercel Functions (Node 24 runtime) | `api/`    | **[built]** `hello` only |
| Portable shared code | TypeScript, no platform APIs       | `shared/` | **[built]** one constant |
| Year cache           | Upstash Redis (REST)               | —         | **[planned]** Phase 2    |

There is **no database, no message broker, no background worker, and no container runtime** in this project, and none are planned. The only persistent stores are the Upstash Redis cache (planned, server-side) and `localStorage` (planned, client-side).

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
api/      Vercel Functions (Node).  MUST import shared/ by RELATIVE path. No DOM APIs.
shared/   Used by BOTH.             No DOM APIs, no Node APIs. Pure, portable code.
```

```
      ┌──────────┐                   ┌──────────┐
      │   src/   │                   │   api/   │
      │ (browser)│                   │  (Node)  │
      └────┬─────┘                   └────┬─────┘
           │  @/ alias OK                 │  RELATIVE path ONLY
           │  ../shared/… also OK         │  `@/…` breaks on deploy
           └───────────┐     ┌────────────┘
                       ▼     ▼
                   ┌─────────────┐
                   │   shared/   │   no DOM, no Node
                   └─────────────┘
```

- **`shared/` sits at the repository root, not under `src/`.** This keeps the boundary symmetrical: neither side reaches into the other's tree, and both reference `shared/` by plain relative path.
- **`api/` must never import via the `@/` alias.** Vercel's Node runtime documentation states that of the root `tsconfig.json`, _"Most options are supported aside from Path Mappings and Project References."_ An aliased import inside a function type-checks locally and then **fails to resolve at deploy time**. Use `../shared/…`; `api/hello.ts` is the reference shape.
- The `@/` alias is declared in `tsconfig.json` and mirrored in `vite.config.ts`. Vite resolves it at bundle time, which is why the client side is unaffected by Vercel's limitation.
- The boundary is enforced by `pnpm typecheck` running **twice**, once per narrowed config — see [`toolchain.md`](./toolchain.md) §2.

The relative-import side is proven in production (deploy of 2026-08-03). The aliased side has deliberately never been tried on Vercel — per Vercel's own docs it should not be. **Grep for `@/` under `api/` before deploying.**

---

## 3. Data flow

### Built today

```
Browser                                  Vercel Function
┌────────────────────┐                   ┌──────────────────────────┐
│ src/main.tsx       │                   │ api/hello.ts             │
│   └─ src/App.tsx   │   GET /api/hello  │   imports MAX_EMBED_TRACKS│
│      (placeholder) │ ─────────────────▶│   from ../shared/constants│
│                    │ ◀─────────────────│   returns {ok, message,   │
└────────────────────┘   JSON            │            maxEmbedTracks}│
                                         └──────────────────────────┘
```

`api/hello.ts` has no behaviour worth testing. It exists to pin down four things before Phase 2 depends on them: the default-export handler signature, the `@vercel/node` request/response types, the relative `shared/` import, and membership in `tsconfig.api.json`. The `maxEmbedTracks` field in its response is there to prove the shared constant genuinely **resolved and bundled** on the Node side rather than merely type-checking.

### Planned — the full loop

```
Browser (SPA)                          Serverless (Vercel Functions)
┌──────────────────────┐               ┌─────────────────────────────────┐
│ Paste URL → Start    │──────────────▶│ /api/playlist                   │
│                      │               │  · parse playlist id            │
│                      │               │  · fetch open.spotify.com/embed │
│                      │◀──────────────│  · extract trackList JSON       │
│                      │  normalized   │  · return {id,title,artist,     │
│                      │  cards        │     previewUrl?}                │
│                      │               ├─────────────────────────────────┤
│ progressive fill     │──────────────▶│ /api/year  (one per track)      │
│ (start on card 1)    │◀──────────────│  · MusicBrainz earliest release │
│                      │  year          │  · 1 req/s gate + cache        │
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

**Why progressive loading is structural, not polish:** MusicBrainz at 1 req/s means a 100-track playlist takes ~100 s worst case. Years resolve in the background, the game starts as soon as **card 1** is ready, and it only blocks if the player outruns the resolver.

---

## 4. External dependencies

| Service                                                | Access                            | Auth                 | Notes                                                                                                    |
| ------------------------------------------------------ | --------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| Spotify embed (`open.spotify.com/embed/playlist/{id}`) | Server-side `fetch` **[planned]** | **None** — anonymous | Unofficial. Parse `<script id="__NEXT_DATA__">`; tracks at `props.pageProps.state.data.entity.trackList` |
| MusicBrainz (`/ws/2/recording`)                        | Server-side `fetch` **[planned]** | `User-Agent` string  | 1 req/s; supplies the **original** release year                                                          |
| Upstash Redis                                          | REST **[planned]**                | URL + token          | Production only; in-memory fallback locally                                                              |

### There are no Spotify credentials, and none are needed

Not in `.env.example`, not in Vercel. Spotify's February 2026 Web API changes mean **no credentialed path can serve "anyone with a public link"**: Client Credentials can no longer read playlist `items`, and new Development Mode apps are capped at 5 invited users. The app therefore reads the public embed endpoint with no login at all.

If you are about to add a `SPOTIFY_CLIENT_ID`, read [`plans/plan.md`](./plans/plan.md) §2 first — **the constraint is a product decision, not an oversight.**

### Why the year comes from MusicBrainz and not Spotify

Spotify reports the _album edition's_ date, which turns a 2011 remaster of Bohemian Rhapsody into a 2011 song. MusicBrainz's earliest release date for a recording is exactly the value Hitster needs. This makes year resolution a **core component**, not an enrichment pass.

Phase 0 measured that a naive "top-scored recording" lookup is **~6% accurate** (1 of 18 tricky tracks), because MusicBrainz has no canonical recording per song — every bootleg, live take, and reissue is its own entity, and dozens tie at the maximum relevance score. The verified fix (correct in all 12 cases tried) is to bias the candidate pool toward `release-group` entries with `primary-type: Album`, no Live/Compilation/Remix/Bootleg `secondary-types`, and release `status: Official`. Two hard constraints on implementing it:

- **Titles must be stripped** of `- Remastered YYYY` / `- Remaster` / `- Live` / `(feat. X)` suffixes before querying. Remaster-suffixed titles returned **zero** results in every case tested — mandatory, not an optimization.
- **The fix must not depend on the album name.** The embed endpoint carries no album name at track level, so filtering must use MusicBrainz-side signals only.

Full measurements are in [`plans/plan.md`](./plans/plan.md) §5 Phase 0.

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

Everything below is **not built**. The authoritative source for what belongs in which phase is [`plans/plan.md`](./plans/plan.md) §5 — **do not build ahead of the current phase.**

| Phase | Adds                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | `parsePlaylistUrl()`, `/api/playlist`, `/api/year`, cache behind an interface, year-resolution logic                                     |
| 3     | `Card` / `GameState` types, reducer (`START`/`FLIP`/`NEXT`/`END`), seeded Fisher–Yates shuffle, localStorage resume, progressive loading |
| 4     | Card component with CSS 3D flip, QR rendering, `previewUrl` + `<audio>` playback                                                         |
| 5     | Swipe-to-next, tap-to-flip, stacked-deck visuals, keyboard controls                                                                      |
| 6     | Landing page, suggested playlists, loading state, **year review/edit screen**, HUD, end screen                                           |
| 7     | Visual design, `@theme` design tokens, error/offline states, responsive, a11y, Lighthouse                                                |
| 8     | Out of v1: shareable deck URL, PWA, PDF export, difficulty filters, multiplayer scoring                                                  |

Two dependencies are already installed with **no importers yet**, deliberately, so Phase 1 locks one coherent dependency tree: `motion` (Phase 5 gestures) and `qrcode` + `@types/qrcode` (Phase 4 QR).

### Design decisions already locked by Phase 0

- **In-app audio uses `previewUrl` + `<audio>`**, not the Spotify iFrame API. Preview coverage measured **398/400 tracks (99.5%)**. The iFrame API is disqualified on Terms-of-Service grounds: Spotify's embed terms forbid obfuscating or altering the widget, which is exactly what a hidden/covered iframe does.
- **Do not set `navigator.mediaSession.metadata`** on the audio element — it would leak title and artist to the OS lock screen, defeating the hidden side of the card.
- **The QR code is always rendered**, regardless of whether audio or metadata extraction works, so the deck degrades rather than dies.
- **The embed endpoint caps at 100 tracks with no pagination signal** — no total, no offset, no `hasMore`. `shared/constants.ts` encodes this as `MAX_EMBED_TRACKS`. A response of exactly 100 is indistinguishable from a playlist that genuinely holds 100, so Phase 6 shows a non-blocking warning rather than silently presenting an incomplete deck. A manual-paste fallback is deferred past v1.
