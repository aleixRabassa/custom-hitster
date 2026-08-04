# Claude Code Findings

This file is maintained by Claude Code. Append relevant discoveries, gotchas, implicit conventions, or non-obvious behaviors found while working in this repository.

## Instructions for Claude Code

- **Always include a date** (ISO 8601, e.g. `2026-03-03`) on each finding entry.
- **Record conclusions from any significant analysis** — if you investigated a non-trivial problem, traced an error, or explored an unfamiliar area of the codebase, summarize what you learned so future Claude Code sessions don't repeat the same work.
- Keep entries concise but self-contained: include enough context that a future Claude Code session can act on the finding without re-reading the full investigation.
- Entries may be edited or removed if the information is no longer valid, but **always confirm with the user first** before doing so.
- When adding a new finding, inform the user that you did so.

### Entry format

```
## YYYY-MM-DD — <short title>

<finding or conclusion>
```

---

<!-- Claude Code: append new findings below this line -->

## 2026-08-04 — Spotify embed payload re-verified live; Phase 0's inventory still holds

Re-confirmed the Phase 0 field inventory (`plan.md` §5) against the live endpoint before writing the
Phase 2 adapter, since the endpoint is unofficial and unversioned. Fetched
`open.spotify.com/embed/playlist/{id}` with a browser `User-Agent` for Today's Top Hits
(`37i9dQZF1DXcBWIGoYBM5M`), Rock Classics (`37i9dQZF1DWXRqgorJj26U`), and a deliberately nonexistent
but well-formed ID (`0000000000000000000000`). Everything Phase 2 depends on is unchanged:

- Payload still at `<script id="__NEXT_DATA__" type="application/json">` → `props.pageProps.state.data.entity`.
- **The 200-means-not-found trap is real and current.** The bogus ID returned **HTTP 200** with
  `pageProps` keys `status, title, description, links, rtl, …` and **no `state` key**
  (`status: 404`, `title: "Page not found"`). Branching on the HTTP status would hand the UI an empty
  deck for a bad link. This is the single most important thing in the adapter.
- Track-level keys identical to Phase 0: `uri, uid, title, subtitle, isExplicit, isNineteenPlus,
contentRatings, duration, isPlayable, playabilityReason, audioPreview, entityType`. Still **no album
  name and no release year at track level**, so MusicBrainz remains the only year source.
- Playlist-level keys now also include `authors`, `hasVideo`, `relatedEntityUri` and `type`, which
  Phase 0 did not list. Additive only — nothing the adapter reads has moved or changed. `releaseDate`
  is still `null`.
- Rock Classics still returns exactly **100** tracks (the cap) and Today's Top Hits **50**, so
  `MAX_EMBED_TRACKS = 100` and the truncation-flag approach still hold. Still no total/offset/`hasMore`.
- `audioPreview.url` present on 150/150 tracks sampled; `isPlayable` true on all 150.
- The anonymous bearer token is still at `state.settings.session.accessToken` — i.e. the payload must
  never be forwarded to the client, which is why `/api/playlist` returns only normalized cards.

## 2026-08-04 — ANSWERED: `api/_lib/` is **not** routed by Vercel

The probe deploy landed (commit `d577a5f`, deployment `custom-hitster.vercel.app`, identity confirmed by
the `index-nPNkNnAa.js` bundle hash matching that build's output):

```
GET /api/_lib/_probe  ->  404, X-Vercel-Error: NOT_FOUND
```

The function build also completed with no error, so a named-export-only file under `api/_lib/` neither
becomes a route nor breaks the build. **The `api/_lib/` convention is safe** — server-only helpers may
live there, and the root-level `server/` fallback (decision 3's alternative) is not needed. Note this is
a convention, not a contract Vercel documents in this repo's terms, so if the helper directory ever
starts answering requests, this is the finding to revisit.

Related, from the same build log: **Vercel compiles `api/` with the local TypeScript 6.0.3**, not the
aliased `typescript-7` the project typechecks with (`Using TypeScript 6.0.3 (local user-provided)`).
The 6.0.3 install exists only so `typescript-eslint` can load (see `docs/toolchain.md` §1), so the
compiler that produces the deployed functions is not the one `pnpm typecheck` runs. Worth knowing before
using a TS 7-only syntax feature in `api/`.

## 2026-08-04 — SOLVED: relative imports under `api/` need an explicit `.js` extension

`/api/hello` returned **500 `FUNCTION_INVOCATION_FAILED`** in production while the SPA served fine and
the build log was clean. **Cause: the extensionless specifier `'../shared/constants'`.** `package.json`
declares `"type": "module"`, so a deployed function is ESM; Node's ESM resolver does not guess
extensions the way CommonJS does, and Vercel **transpiles** functions rather than bundling them, so the
specifier reaches Node verbatim and the import throws at load time.

Proven by two throwaway functions differing in exactly one character sequence, deployed together:

| Route              | Import                     | Result                           |
| ------------------ | -------------------------- | -------------------------------- |
| `/api/ping`        | none (type-only, erased)   | `200 {"probe":"ping"}`           |
| `/api/ping-shared` | `'../shared/constants.js'` | `200 {"maxEmbedTracks":100}`     |
| `/api/hello`       | `'../shared/constants'`    | `500 FUNCTION_INVOCATION_FAILED` |

So the cross-directory `shared/` import is fine; only the extension was missing. `api/hello.ts` is
fixed, all three probe files are deleted, and the fix is **confirmed in production**: after redeploying,
`GET /api/hello` returns `200 {"ok":true,"message":"custom-hitster api is alive","maxEmbedTracks":100}`.
That is the first time `docs/development.md` §7's standing check has actually passed.

**Why this went unnoticed for a day, and why it matters more than the bug itself:**

- `docs/api.md` §3 actively prescribed the wrong thing — a rule row reading _"Write imports
  extensionless — matches the dominant Vercel convention"_. Corrected in place.
- `docs/architecture.md` §2 claimed the relative-import side was _"proven in production (deploy of
  2026-08-03)"_. It was not: that deploy proved only that the **build** succeeded. `/api/hello` had
  never actually been requested. A deploy that "succeeded" is not evidence that a function runs.
- **All five local checks pass either way** — `typecheck`, `lint`, `test`, `build`, `format:check` —
  because none of them model Node's ESM resolution of the deployed output. This is now the **third**
  deploy-time-only failure in this repo (after the solution-file `tsconfig.json` and the path-mapping
  limitation), and the pattern is identical every time: a local green build proving nothing about
  production.

Verified that TypeScript (both narrowed configs) and Vite both resolve a `.js` specifier back to the
`.ts` source, so the rule is safe for `shared/` code that the browser also imports — checked with a
throwaway `shared/` module and Vitest run, since `shared/`→`shared/` runtime imports need the extension
too. Type-only imports erase and are exempt. Rule recorded in `AGENTS.md`, `docs/architecture.md` §2,
`docs/api.md` §3 and `docs/development.md` §7.

## 2026-08-04 — ANSWERED: the 22-character ID check is **not** too strict — 22 is exact, not a convention

Spike of the last open question in [`plan.phase-2-playlist.md`](./plans/plan.phase-2-playlist.md).
Verdict: **do not relax it.** The plan's own guidance — _"if a valid link is ever rejected, relax to a
permissive base62 length range"_ — was wrong, and is now corrected in the plan, in decision 15, and in
the comment above `SPOTIFY_ID_PATTERN` in `shared/spotify-url.ts`.

**22 is arithmetic, not a habit.** A Spotify ID is the base62 encoding of a 128-bit GID, left-padded
with `0`. `ceil(128 / log2 62)` = `ceil(21.50)` = **22**, and the padding removes the only way a shorter
one could arise. No valid Spotify ID of any other length can exist, so no length relaxation can ever
rescue a real link. Confirmed against seven real playlists spanning every provenance that might have
differed — editorial, algorithmic (Discover Weekly, Daily Mix), chart, viral, and user-created — all
exactly 22.

**The endpoint distinguishes "undecodable" from "missing", and the spike found a second error status.**
Probing `open.spotify.com/embed/playlist/{id}` with deliberately malformed IDs:

| ID                        | len | decodes to < 2^128 | `pageProps.status`         |
| ------------------------- | --- | ------------------ | -------------------------- |
| `37i9dQZF1DXcBWIGoYBM5M`  | 22  | yes                | _(none — `state` present)_ |
| `37i9dQZF1DXcBWIGoYBM5`   | 21  | —                  | **500**                    |
| `37i9dQZF1DXcBWIGoYBM5MA` | 23  | —                  | **500**                    |
| `0000000000000000000001`  | 22  | yes                | 404                        |
| `7000000000000000000000`  | 22  | yes                | 404                        |
| `8000000000000000000000`  | 22  | **no**             | **500**                    |
| `aaaaaaaaaaaaaaaaaaaaaa`  | 22  | **no**             | **500**                    |

Decodability predicted 404-vs-500 in every case. **`pageProps.status` is therefore not always 404** —
Phase 0 only ever observed that value and the adapter's comment names it specifically. Both shapes are
HTTP 200 with **no `state` key**, so `api/_lib/spotify-embed.ts` already handles both correctly and needs
no change. This is a second, independent vindication of decision 7 (**branch on `state`, never on the
status**): a handler keying on `status === 404` would have missed the 500 case entirely.

**If anything the regex is too loose, not too strict.** Only **~12.6%** of the 22-char base62 space
decodes to a valid 128-bit GID (`2^128 / 62^22`); the leading character must be `0`–`7`. The other ~87%
pass `/^[0-9A-Za-z]{22}$/`, get forwarded to Spotify, and come back as `not-found-or-private`. That is
honest and harmless — just one wasted upstream round trip on a typo. Tightening is **optional** and left
undone: it would return 400 `invalid-url` instead of 404 and skip the fetch, at the cost of a BigInt
decode in `shared/`.

**What to actually suspect when a valid link is rejected** — it will not be the length. Two live shapes
carry a perfectly good 22-char ID and still fail today:

- **Legacy `open.spotify.com/user/{user}/playlist/{id}`** — still served: it answers `301` to
  `/playlist/{id}`. `parsePlaylistUrl()` sees entity `user` and returns **`unsupported-entity`**, so a
  link that genuinely is a playlist gets told it is not one. The clearest real bug this spike found,
  though still only reachable via old shared links.
- **`spotify.link/…` short URLs** (what the mobile share sheet produces) — a `307` to the real URL.
  Rejected as `invalid-url`, and unfixable inside `shared/` by design, since resolving one needs a
  network call.

Neither is in this plan's scope; both are recorded here so Phase 6 can decide whether to handle them.
