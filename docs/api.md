# API — Vercel Functions (`api/`)

Every file under `api/` becomes a Vercel Function on the Node 24 runtime, routed at its path minus the extension (`api/hello.ts` → `/api/hello`). There is no router, no framework, and no middleware layer.

> **Status: one reference endpoint exists.** `/api/playlist` and `/api/year` are Phase 2 work and are documented here as planned shapes only.

---

## 1. Endpoints

### `GET /api/hello` **[built]**

A hello-world function with no behaviour worth testing. It exists to establish the handler signature, the `@vercel/node` types, the relative `shared/` import, and `tsconfig.api.json` membership — **copy this shape for Phase 2 handlers.**

It ignores the request entirely (method, query, and body are all unread) and takes no parameters.

**Response** — `200 application/json`:

```json
{
  "ok": true,
  "message": "custom-hitster api is alive",
  "maxEmbedTracks": 100
}
```

`maxEmbedTracks` echoes `MAX_EMBED_TRACKS` from `shared/constants.ts`. It is not informational — it is the assertion that the shared constant **resolved and bundled** from the Node side, rather than merely type-checking. After any deploy that touches the layout, confirm it still returns `100`; that is the check that the cross-directory import survived the real function build.

### `/api/playlist` **[planned — Phase 2]**

Takes a playlist identifier, fetches the Spotify embed page server-side, extracts the track list, and returns normalized cards — `{ id, title, artist, previewUrl? }` per track — with **typed errors** for private / not-found / unsupported playlists. The HTTP method and exact request shape are not yet decided; `plan.md` specifies only the behaviour.

Two findings from Phase 0 constrain the implementation:

- **Error shape is not HTTP-status-based.** A nonexistent playlist ID still returns HTTP **200**; the JSON's `pageProps` carries `{status: 404, title: "Page not found", …}` instead of `{state: {…}}`. **The adapter must branch on the presence of `pageProps.state`, not on the response status code.**
- **Artist arrives as one joined string** in the track-level `subtitle` field, not a structured array — it needs splitting before it can be used in a MusicBrainz query.

Track-level fields available from the embed payload (union across 150 sampled tracks): `uri`, `uid`, `title`, `subtitle`, `isExplicit`, `isNineteenPlus`, `contentRatings.labels[]`, `duration` (ms), `isPlayable`, `playabilityReason`, `audioPreview.{format,url}`, `entityType`. **There is no album name and no release date at track level** — which is why the year must come from MusicBrainz.

### `/api/year` **[planned — Phase 2]**

MusicBrainz lookup with a cache in front, **one track per request** — the client sequences the calls, so progressive loading and "playable at card 1" fall out naturally. Returns the earliest official-album release year for that track.

**There is no Spotify-year fallback**, contrary to what earlier drafts of this file and `plan.md` said: the embed payload carries no release date at track level (see `/api/playlist` above). The fallback is three MusicBrainz tiers instead — a strict filtered pass (`confidence: 'high'`), a relaxed pass with the release-group filters dropped (`confidence: 'low'`), then no year at all (`confidence: 'none'`) for manual entry on the Phase 6 review screen.

Because each request is a separate function invocation, the 1 req/s budget **cannot** be held by an in-process queue. It is enforced by a short-lived shared lock in Redis, which holds across concurrent instances and users; when the lock cannot be acquired the endpoint returns **429 with `retryAfterMs`** so the client backs off rather than the function blocking. Without Redis configured the gate degrades to per-instance pacing only — adequate for local development, not a real guarantee.

Implementation constraints are measured, not assumed; see [`architecture.md`](./architecture.md) §4 and [`plans/plan.md`](./plans/plan.md) §5 Phase 0. In short: strip remaster/live/feat. suffixes from titles first, filter candidates by release-group type instead of trusting relevance score, always include the split artist name, use track `duration` as a tie-breaker, and guard against **missing or empty `date` fields** — common on bootleg and compilation releases, so a bare `min()` over all dates present is wrong.

---

## 2. Layout

```
api/
  hello.ts        GET /api/hello — reference shape, copy this
```

Files under `api/` are type-checked **only** by `tsconfig.api.json` (`pnpm typecheck:api`), which supplies Node types and **no DOM lib**. A new function is not covered by the app typecheck at all, so it must live under `api/` to be checked.

---

## 3. Handler conventions

`api/hello.ts` in full, as the canonical example:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { MAX_EMBED_TRACKS } from '../shared/constants';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    message: 'custom-hitster api is alive',
    maxEmbedTracks: MAX_EMBED_TRACKS,
  });
}
```

Rules this establishes:

| Rule                                                      | Why                                                                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Default-export a single `handler` function**            | Vercel's Node runtime entry contract.                                                                                             |
| **Type params as `VercelRequest` / `VercelResponse`**     | From `@vercel/node`, a dev dependency.                                                                                            |
| **Import `shared/` by RELATIVE path — never `@/`**        | Vercel does not support tsconfig path mappings for functions. An aliased import type-checks locally and **fails at deploy time**. |
| **Write imports extensionless** (`'../shared/constants'`) | Matches the dominant Vercel convention; `src/` is normalised the same way.                                                        |
| **No DOM APIs**                                           | `tsconfig.api.json` omits the DOM lib, so `document`/`window` fail with `TS2584`.                                                 |
| **Prefix unused params with `_`**                         | `noUnusedParameters` is on; `@typescript-eslint/no-unused-vars` also reports them.                                                |
| **Never put secrets in `api/` source**                    | The Vite dev server serves that source as transpiled text — see [`architecture.md`](./architecture.md) §5.                        |

Node globals (`process`, etc.) are available: `eslint.config.js` gives `api/**/*.ts` the Node globals block, and `tsconfig.api.json` supplies `@types/node`.

---

## 4. Configuration reference

All values are read server-side only. Copy `.env.example` to `.env.local` and fill it in; `.env*.local` is gitignored. **Nothing in Phase 1 reads any of these** — they are all consumed by Phase 2.

| Variable                   | Required           | Where to get it                                                                                                                                            |
| -------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | Production only    | Create a Redis database at [upstash.com](https://upstash.com/), or provision Upstash Redis through the Vercel Marketplace, which injects it automatically. |
| `UPSTASH_REDIS_REST_TOKEN` | Production only    | Same place — shown alongside the REST URL.                                                                                                                 |
| `MUSICBRAINZ_USER_AGENT`   | Local + production | You write it. Format `AppName/Version ( contact )`. MusicBrainz rate-limits to 1 req/s and blocks anonymous traffic.                                       |

Both cache variables are production-only because local development falls back to an in-memory cache. Upstash names were chosen over Vercel KV names deliberately: Vercel KV is now provisioned _as_ Upstash Redis through the Marketplace, so these names are the more durable choice.

**There are no Spotify credentials.** See [`architecture.md`](./architecture.md) §4 before adding any.

---

## 5. Error handling

There is nothing to document yet — `api/hello.ts` cannot fail. Phase 2 introduces the first real error surface, and the one non-obvious requirement is already known: **the embed endpoint signals "not found" inside a 200 response body**, so status-code-based error handling will silently treat a missing playlist as a success. Branch on `pageProps.state`.
