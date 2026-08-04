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
fixed, and all three probe files are deleted.

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

## 2026-08-04 — `/api/hello` returns 500 FUNCTION_INVOCATION_FAILED in production (superseded — solved above)

Found while running the probe checks above, on the same deployment:

```
GET /api/hello  ->  500, X-Vercel-Error: FUNCTION_INVOCATION_FAILED
GET /           ->  200  (the SPA serves normally)
```

`api/hello.ts` is unchanged since Phase 1, when the same request was verified returning
`maxEmbedTracks: 100` (2026-08-03). The build log for this deploy shows no error and no warning about
`api/`. So the function is built and routed but throws at invocation — which means the cause is a
runtime module/resolution problem, not a compile problem, and it is invisible to all five local checks.

**The standing check in `docs/development.md` §7 is therefore currently red, and any manual verification
of `/api/playlist` through a deploy is untrustworthy until this is understood.** Leading hypothesis to
test first: the extensionless relative import `'../shared/constants'` resolving under
`"type": "module"` — if the function is transpiled rather than bundled, ESM requires the file
extension and Node throws `ERR_MODULE_NOT_FOUND` at import time. That is unconfirmed. The Vercel
**runtime** log for the failed invocation names the actual error in one line and is the next thing to
read. Do not delete `api/_lib/_probe.ts` until this is dated: it is the only file added under `api/`
between the working deploy and the failing one, so it is the cheapest thing to rule in or out.

Two throwaway diagnostics were added to settle it in one deploy without depending on log retention:
`api/ping.ts` (no runtime imports at all) and `api/ping-shared.ts` (identical to `hello.ts` except the
specifier carries an explicit `.js` extension). Reading all three responses together identifies the
cause: `ping` alone failing means the runtime or builder, `ping-shared` succeeding where `hello` fails
means the extensionless ESM specifier, and both `shared`-importing functions failing means
cross-directory imports are broken regardless of extension. **Delete all three probe files once the
answer is recorded here.** Note also that Phase 1's claim of a working deploy may be weaker than it
reads: `plan.md` says only "reported successful", which is consistent with the build succeeding and
`/api/hello` never actually having been requested — in which case this was never a regression at all,
and `docs/development.md` §7's standing check has simply never passed.

`api/_lib/_probe.ts` was added as a throwaway probe: a **named** export with **no default**, which is
the shape that breaks if Vercel builds it as a function. The whole `api/_lib/` helper convention
(`plan.phase-2-playlist.md` decisions 3/3a) depends on `_`-prefixed paths being excluded from function
routing, and **no local check can tell**: `typecheck`, `lint`, `test`, `build` and `format:check` are
all green either way, because none of them know what Vercel's router does. Answer expected from the
developer's next deploy — the two things to confirm are that the function build succeeded and that
`/api/_lib/_probe` returns 404 (not 200, not 500). **This entry must be updated with the result, and
the probe file deleted, once the deploy has run.** If it turns out to be routed, the documented
fallback is a root-level `server/` tree added to `tsconfig.api.json`'s `include`.
