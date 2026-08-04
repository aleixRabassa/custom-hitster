# API — Vercel Functions (`api/`)

Every file under `api/` becomes a Vercel Function on the Node 24 runtime, routed at its path minus the extension (`api/hello.ts` → `/api/hello`). There is no router, no framework, and no middleware layer.

> **Status:** `/api/hello`, `/api/playlist` and `/api/year` are all **built**. Phase 2 is complete.

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

`maxEmbedTracks` echoes `MAX_EMBED_TRACKS` from `shared/constants.ts`. It is not informational — it is the assertion that the shared constant **resolved** on the Node side, rather than merely type-checking. After any deploy that touches the layout, confirm it still returns `100`; that is the check that the cross-directory import survived the real function build.

**And actually make the request.** On 2026-08-04 this endpoint was found returning `500 FUNCTION_INVOCATION_FAILED` — its import lacked the `.js` extension an ESM function needs — after a clean build and five green local checks. It had shipped that way since 2026-08-03 because nobody had requested it. See [`agent_findings.md`](./agent_findings.md).

### `GET /api/playlist` **[built]**

Turns a pasted Spotify playlist link into a normalized deck.

**Query parameters**

| Parameter | Required | Notes                                                                               |
| --------- | -------- | ----------------------------------------------------------------------------------- |
| `url`     | yes      | Any accepted form below. A repeated `?url=` is tolerated — the first value is used. |

Every one of these is accepted, and all of them yield the same playlist ID (`parsePlaylistUrl()` in `shared/spotify-url.ts`, which the Phase 6 landing form reuses unchanged):

```
https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=…&utm_source=…#frag
https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M   ← locale prefix
http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M/           ← http, trailing slash
open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M                   ← no scheme
spotify:playlist:37i9dQZF1DXcBWIGoYBM5M                            ← desktop-client URI
37i9dQZF1DXcBWIGoYBM5M                                             ← bare ID
```

Surrounding whitespace is trimmed. Host matching is **anchored**, so look-alikes (`open.spotify.com.evil.example`, `notopen.spotify.com`, `open.spotify.com@evil.example`) are rejected rather than fetched.

**Response** — `200 application/json`, with `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`:

```json
{
  "playlist": { "id": "37i9dQZF1DXcBWIGoYBM5M", "name": "Today’s Top Hits", "owner": "Spotify" },
  "cards": [
    {
      "id": "70pVCVMGjmIWPbWXDwf11e",
      "title": "petal",
      "artist": "Ariana Grande",
      "durationMs": 184248,
      "isPlayable": true,
      "previewUrl": "https://p.scdn.co/mp3-preview/30dc1adb…"
    }
  ],
  "truncated": false,
  "skippedCount": 0
}
```

- `cards[].artist` is the artist string **verbatim**, never split — the separators Spotify joins with also occur inside real artist names ("Earth, Wind & Fire"). See `shared/artists.ts`.
- `cards[].previewUrl` is **omitted** when Spotify supplies no preview (~0.5% of tracks). Phase 4 disables Play/Pause and Restart for such a card; the QR still works.
- `cards[].isPlayable: false` tracks are **kept** in the deck. The QR code always works, so an unplayable track is still a playable card.
- `cards[].year` / `yearConfidence` are **never set here** — the embed payload has no release date at track level. `/api/year` fills them.
- `truncated: true` means the deck **may** be incomplete (exactly `MAX_EMBED_TRACKS` came back). It cannot mean more than "may": there is no pagination signal to check against. Phase 6 renders a non-blocking warning.
- `skippedCount` counts payload entries too malformed to become a card (no track ID, or no title). Normally `0`. **Phase 6 surfaces it** (decided 2026-08-04) as a non-blocking note beside the `truncated` warning, shown only when non-zero — a silently shorter deck is indistinguishable from a shorter playlist, which is the same problem `truncated` exists to solve.
- The response never contains upstream HTML, and never the anonymous Spotify bearer token the embed payload carries at `state.settings.session.accessToken`.

**Errors** — `application/json` as `{ "code": …, "message": … }`:

| `code`                 | Status | When                                                                              |
| ---------------------- | ------ | --------------------------------------------------------------------------------- |
| `invalid-url`          | 400    | `url` missing, empty, or not parseable as a Spotify playlist reference            |
| `unsupported-entity`   | 400    | A valid Spotify link to an album/track/artist/show/episode/user — not a playlist  |
| `not-found-or-private` | 404    | No public playlist for that ID. Private and deleted are indistinguishable (below) |
| `upstream-unavailable` | 502    | The embed request failed or returned non-200. **Transient** — a retry may work    |
| `unexpected-payload`   | 502    | The request worked but the payload was not the shape we parse. **Not transient**  |
| `method-not-allowed`   | 405    | Anything but `GET`. Sends an `Allow: GET` header                                  |
| `internal-error`       | 500    | An unexpected throw. Body is generic — never a stack trace                        |

**The trap, and the single most reversion-prone line in this codebase:** a nonexistent playlist ID returns **HTTP 200** from Spotify, with `pageProps` carrying `{status: 404, title: "Page not found", …}` and **no `state` key**. The adapter therefore branches on the **presence of `pageProps.state`, never on the response status**. Status-based handling would report a missing playlist as a successful fetch of an empty deck — silently, all the way to the player. Measured in Phase 0, re-confirmed live 2026-08-04, and covered by the most important test in `api/_lib/spotify-embed.test.ts`.

`private` and `not-found` deliberately collapse into one code: Spotify gives no observable signal that separates them (it avoids leaking existence), so a `private` code would be a lie in the type system.

Track-level fields available from the embed payload (union across 150 sampled tracks): `uri`, `uid`, `title`, `subtitle`, `isExplicit`, `isNineteenPlus`, `contentRatings.labels[]`, `duration` (ms), `isPlayable`, `playabilityReason`, `audioPreview.{format,url}`, `entityType`. **There is no album name and no release date at track level** — which is why the year must come from MusicBrainz.

### `GET /api/year` **[built]**

Resolves ONE track's original release year from MusicBrainz, with a cache in front. The client sequences the calls, so progressive loading and "playable at card 1" fall out naturally.

**Query parameters**

| Parameter    | Required | Notes                                                                                      |
| ------------ | -------- | ------------------------------------------------------------------------------------------ |
| `title`      | yes      | The track title as Spotify gives it, suffixes and all. Cleaned server-side. Max 300 chars. |
| `artist`     | yes      | The raw joined artist string (the card's `artist`). **Do not split it.** Max 300 chars.    |
| `durationMs` | no       | The card's `durationMs`. Absent, `0` or unparseable means "unknown" and is not an error.   |

`durationMs` is optional but **strongly recommended**: it becomes a `dur:` bound on the MusicBrainz query, and that bound is what makes the lookup accurate. It collapses the candidate pool below the 100-result page limit, so the original studio recording is actually in the results rather than ranked out of them — "Stairway to Heaven" is 842 candidates unbounded and 31 bounded, and it only resolves correctly in the second case.

**Response** — `200 application/json`:

```json
{
  "year": 1982,
  "confidence": "high",
  "source": "release-group",
  "cached": false,
  "cleanedTitle": "Billie Jean",
  "stripped": { "remaster": false, "live": false, "feature": false, "version": false }
}
```

| Field          | Notes                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `year`         | The original release year, or `null` when nothing could be resolved. Phase 6 lets the player fill a null in by hand.                                                        |
| `confidence`   | `high` (strict pass), `low` (relaxed pass — worth checking), `none` (no year). Consumed on the card's revealed side in Phase 6.                                             |
| `source`       | `release-group` for `high`, `recording` for `low`. **Omitted** when `year` is null.                                                                                         |
| `reason`       | `no-candidates` (the query matched nothing) or `no-dated-candidates` (matches existed, none dated). **Omitted** when a year was resolved. The two point at different fixes. |
| `cached`       | `true` when the answer came from the year cache and cost no MusicBrainz request.                                                                                            |
| `cleanedTitle` | The title actually queried, after suffix stripping. Returned deliberately: when a year looks wrong, the first question is always what was searched for.                     |
| `stripped`     | Which suffix families were removed. **Diagnostic only** — a live-labelled track still resolves to the song's original year, because Hitster asks when the SONG came out.    |

**Both caches are tiered by confidence**, since a `high` year is a historical fact while a `none` is the result most likely to improve:

| Tier   | Edge `s-maxage` | Redis TTL |
| ------ | --------------- | --------- |
| `high` | 30 days         | 30 days   |
| `low`  | 1 day           | 7 days    |
| `none` | 1 hour          | 1 day     |

**Redis is never shorter than the edge, on any tier**, and that rule is what sets the numbers: an edge miss is free because it falls through to Redis, while a Redis miss costs two MusicBrainz requests against a budget shared by every user. A test in `api/_lib/cache.test.ts` mirrors the edge column and fails if the two drift apart.

**There is no Spotify-year fallback**, contrary to what earlier drafts of this file and `plan.md` said: the embed payload carries no release date at track level (see `/api/playlist` above). The fallback is three MusicBrainz tiers instead — a strict filtered pass (`confidence: 'high'`), a relaxed pass with the release-group filters dropped (`confidence: 'low'`), then no year at all (`confidence: 'none'`). There is deliberately **no pre-Start year review screen** — the player pastes the playlist, so listing years before Start would spoil the deck; `confidence` is consumed on the card's revealed side in Phase 6 instead (see [`plans/plan.md`](./plans/plan.md) §6).

**A lookup costs two MusicBrainz requests, and the second one is where the accuracy comes from.** The recording search inlines whichever _release_ matched, which is nearly always a reissue — filtering to official studio albums and taking the earliest inlined release date gives Billie Jean **2012**, Bohemian Rhapsody **2001**, Sweet Child O' Mine **2018**. The second request is one **batched** `release-group?query=rgid:(… OR …)` lookup for each surviving group's `first-release-date`, which is the album's original release date and gets all three right. Because it is batched, the count stays at two however large the candidate pool. Measured 14 of 14 known-tricky tracks exact against a ~6% naive baseline; see [`agent_findings.md`](./agent_findings.md) (2026-08-04) for the full method and the two things that look like tuning knobs and are not.

Because each request is a separate function invocation, the 1 req/s budget **cannot** be held by an in-process queue. It is enforced by a short-lived shared lock in Redis, which holds across concurrent instances and users; when the lock cannot be acquired the endpoint returns **429 with `retryAfterMs`** so the client backs off rather than the function blocking. Without Redis configured the gate degrades to per-instance pacing only — adequate for local development, not a real guarantee. **A cache hit skips the gate entirely**, so a replayed deck resolves at cache speed rather than at one track per two seconds.

**Errors** — `application/json` as `{ "code": …, "message": … }`:

| `code`                 | Status | When                                                                                                 |
| ---------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `invalid-request`      | 400    | `title` or `artist` missing, empty, or over 300 characters                                           |
| `rate-limited`         | 429    | The 1 req/s gate is busy. Carries `retryAfterMs` and a `Retry-After` header. **Expected under load** |
| `not-configured`       | 500    | `MUSICBRAINZ_USER_AGENT` is unset. A deployment fault, reported on **every** request including hits  |
| `upstream-unavailable` | 502    | MusicBrainz failed or returned non-200 after the single 503 retry. **Transient**                     |
| `unexpected-payload`   | 502    | It answered 200 with something we could not parse. **Not transient** — the adapter needs updating    |
| `method-not-allowed`   | 405    | Anything but `GET`. Sends an `Allow: GET` header                                                     |
| `internal-error`       | 500    | An unexpected throw. Body is generic — never a stack trace                                           |

A `429` is **not a bug**. It is the designed back-pressure signal: the client is expected to wait `retryAfterMs` and retry that card later.

---

## 2. Layout

```
api/
  hello.ts                      GET /api/hello    — reference shape, copy this
  playlist.ts                   GET /api/playlist — playlist ingestion
  year.ts                       GET /api/year     — year resolution
  _lib/                         NOT routed — server-only helpers
    spotify-embed.ts              the embed adapter (all scraping lives here)
    musicbrainz.ts                the MusicBrainz adapter (all HTTP + response shape)
    resolve-year.ts               cache -> gate -> strict -> relaxed, orchestrated
    cache.ts                      YearCache interface, memory + Upstash adapters
    rate-limit.ts                 the 1 req/s gate, Redis-backed or per-instance
    *.test.ts
    __fixtures__/                 trimmed captured payloads + provenance headers
```

Files under `api/` are type-checked **only** by `tsconfig.api.json` (`pnpm typecheck:api`), which supplies Node types and **no DOM lib**. A new function is not covered by the app typecheck at all, so it must live under `api/` to be checked.

**`_`-prefixed paths are not routed.** `api/_lib/` holds server-only helpers, tests and fixtures beside the function that uses them without any of it becoming an endpoint. This is a Vercel convention rather than something this repo can verify locally — `typecheck`, `lint`, `test` and `build` all pass whether or not it holds — so it was settled by a throwaway probe deploy on 2026-08-04: a named-export-only file at `api/_lib/_probe.ts` returned **404 `NOT_FOUND`** and did not break the function build. Recorded in [`agent_findings.md`](./agent_findings.md); the documented fallback, if this ever changes, is a root-level `server/` tree added to `tsconfig.api.json`'s `include`.

Server-only helpers **cannot** live in `shared/`: `tsconfig.app.json` supplies only `vite/client` types, so any `process.env` reference there fails `pnpm typecheck:app`. "Just put it in shared" is the obvious wrong move.

---

## 3. Handler conventions

`api/hello.ts` in full, as the canonical example:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// The `.js` is required, not stylistic -- see the rule table below.
import { MAX_EMBED_TRACKS } from '../shared/constants.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    message: 'custom-hitster api is alive',
    maxEmbedTracks: MAX_EMBED_TRACKS,
  });
}
```

Rules this establishes:

| Rule                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default-export a single `handler` function**                   | Vercel's Node runtime entry contract.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Type params as `VercelRequest` / `VercelResponse`**            | From `@vercel/node`, a dev dependency.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Import `shared/` by RELATIVE path — never `@/`**               | Vercel does not support tsconfig path mappings for functions. An aliased import type-checks locally and **fails at deploy time**.                                                                                                                                                                                                                                                                                                                                       |
| **End relative imports with `.js`** (`'../shared/constants.js'`) | **Corrected 2026-08-04 — this table previously said the opposite.** `"type": "module"` makes a deployed function ESM, and Node's ESM resolver does not guess extensions; Vercel transpiles rather than bundles, so the specifier reaches Node verbatim. Extensionless gives `FUNCTION_INVOCATION_FAILED` at runtime after a clean build, and **no local check catches it** — that is precisely how `/api/hello` shipped broken. Type-only imports erase and are exempt. |
| **No DOM APIs**                                                  | `tsconfig.api.json` omits the DOM lib, so `document`/`window` fail with `TS2584`.                                                                                                                                                                                                                                                                                                                                                                                       |
| **Prefix unused params with `_`**                                | `noUnusedParameters` is on; `@typescript-eslint/no-unused-vars` also reports them.                                                                                                                                                                                                                                                                                                                                                                                      |
| **Never put secrets in `api/` source**                           | The Vite dev server serves that source as transpiled text — see [`architecture.md`](./architecture.md) §5.                                                                                                                                                                                                                                                                                                                                                              |

Node globals (`process`, etc.) are available: `eslint.config.js` gives `api/**/*.ts` the Node globals block, and `tsconfig.api.json` supplies `@types/node`.

---

## 4. Configuration reference

All values are read server-side only. Copy `.env.example` to `.env.local` and fill it in; `.env*.local` is gitignored. All three are consumed by `/api/year`; nothing else reads any of them.

| Variable                   | Required           | Where to get it                                                                                                                                            |
| -------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | Production only    | Create a Redis database at [upstash.com](https://upstash.com/), or provision Upstash Redis through the Vercel Marketplace, which injects it automatically. |
| `UPSTASH_REDIS_REST_TOKEN` | Production only    | Same place — shown alongside the REST URL.                                                                                                                 |
| `MUSICBRAINZ_USER_AGENT`   | Local + production | You write it. Format `AppName/Version ( contact )`. MusicBrainz rate-limits to 1 req/s and blocks anonymous traffic.                                       |

**What actually happens when each one is missing** — this is the table to read before concluding something is broken:

| Missing                         | Runtime consequence                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MUSICBRAINZ_USER_AGENT`        | Every `/api/year` call returns **500 `not-configured`** with an explicit message — including calls that would have hit the cache, so the fault is consistent rather than intermittent. Nothing is sent to MusicBrainz.                     |
| Both Upstash variables          | The cache falls back to **in-memory** and the gate to **per-instance pacing**, both logged once at cold start. Lookups still work. This is the intended local setup; in production it means a cache that never shares and no real 1 req/s. |
| `UPSTASH_REDIS_REST_URL` only   | Same in-memory fallback, but logged as a **warning** rather than an info line, since a half-configured deployment is almost certainly a mistake.                                                                                           |
| `UPSTASH_REDIS_REST_TOKEN` only | Ignored entirely — selection keys on the URL.                                                                                                                                                                                              |

Both cache variables are production-only because local development falls back to an in-memory cache. The two log lines at cold start (`[year-cache] …` and `[rate-limit] …`) exist precisely so this fallback is never silent: an in-memory cache in production looks exactly like a correctly wired cache that simply never hits.

Upstash names were chosen over Vercel KV names deliberately: Vercel KV is now provisioned _as_ Upstash Redis through the Marketplace, so these names are the more durable choice.

**There are no Spotify credentials.** See [`architecture.md`](./architecture.md) §4 before adding any.

---

## 5. Error handling

**Lead with the trap: the embed endpoint signals "not found" inside a 200 response body.** A request for a playlist that does not exist returns HTTP **200** whose `pageProps` carries `{status: 404, …}` and no `state` key. Status-code-based error handling therefore treats a missing or private playlist as a _success_ and hands the UI an empty deck — silently, with no error anywhere. Always branch on the presence of `pageProps.state`. This is measured (Phase 0, re-confirmed live 2026-08-04), it reads like a bug to anyone who has not seen the payload, and it is guarded by a dedicated test.

### The shape

Every failure is a typed `code` — `PlaylistErrorCode` or `YearErrorCode`, both closed unions in `shared/types.ts` — sent as `{ "code": …, "message": … }`. Each union is closed so that the handler's status mapping and Phase 6's inline messages both stay exhaustive; each member is documented next to its HTTP status in that file. Per-endpoint tables are under §1.

### Rules

- **Typed codes, not free text.** Phase 6 renders a different message per code — "that's an album, not a playlist" is a different screen from "that isn't a Spotify link" — so a collapsed error type would degrade the landing page.
- **Separate transient from broken.** `upstream-unavailable` (retry may help) and `unexpected-payload` (the scrape broke, someone must look) share status 502 but never share a code. That distinction is operational, and it is the reason both exist.
- **Never echo upstream content.** Not the raw HTML (unbounded), not a parse error, and above all not the anonymous Spotify bearer token the embed payload carries at `state.settings.session.accessToken`. Messages are hand-written constants in the handler; an adapter test asserts the token never reaches the output.
- **Adapters return unions, handlers map to status.** `parsePlaylistUrl()`, the embed adapter, the MusicBrainz adapter and `resolveYear()` all return `{ok: true, …} | {ok: false, code}` and never throw, so the handler is a pure translation layer. Every handler is also wrapped so an unexpected throw becomes a generic 500 rather than a stack trace.
- **Guard the method.** Anything but the documented verb gets 405 with an `Allow` header.

### Two rules the year endpoint adds

- **429 is a signal, not a failure.** `rate-limited` means the shared 1 req/s gate was busy, which is the _expected_ outcome when several cards resolve at once. It carries `retryAfterMs` and a `Retry-After` header, and Phase 3's loop is built to back off on it. Treating it as an error state in the UI would surface normal operation as breakage.
- **Fail loudly on misconfiguration, degrade quietly on infrastructure.** A missing `MUSICBRAINZ_USER_AGENT` is a 500 on every request, because nothing can work without it and a remote rejection from MusicBrainz is far harder to diagnose. A missing or broken cache, by contrast, degrades silently to a miss and a broken rate-limit gate fails **open** — the cache is a latency optimisation and MusicBrainz is the source of truth, so an Upstash outage must make the app slow, not broken.
