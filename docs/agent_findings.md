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

## 2026-08-04 — ANSWERED: a year lookup costs **two** MusicBrainz requests, and the second one is where the accuracy comes from

Step 1 of [`plan.phase-2-year.md`](./plans/plan.phase-2-year.md), measured live against
`musicbrainz.org/ws/2` with `User-Agent: custom-hitster/0.1.0 ( … )`, 1 req/s, 2026-08-04.
Ground truth is the Phase 0 track list in [`plan.md`](./plans/plan.md) §5.

**All four fields the strict filter needs ARE inlined in the recording search**, so the search alone
would be enough on paper:

```
GET /ws/2/recording?query=recording:"<title>" AND artist:"<artist>"&fmt=json&limit=100
```

Each `recordings[].releases[]` carries `status` and `date`, and its `release-group` carries
`primary-type` and `secondary-types`. **No `inc=` parameter is involved** — the search endpoint ignores
`inc=` and always returns this fixed shape. The inlined release list is also **complete, not partial**:
for two recordings checked against `GET /ws/2/recording/{id}?inc=releases+release-groups`, the lookup
returned exactly the same releases (1 and 5 respectively). Recordings additionally carry
`first-release-date` and `length`.

**But filtering the search response alone gives the wrong year, and this is the trap.** A release-group
holds every pressing of an album, and the search inlines whichever _release_ matched — usually a
reissue. Filtering to official studio albums and taking the earliest inlined release date yields:

| Track                               | Correct | Earliest inlined official-album release |
| ----------------------------------- | ------- | --------------------------------------- |
| Billie Jean / Michael Jackson       | 1982    | **2012** (Bad 25)                       |
| Bohemian Rhapsody / Queen           | 1975    | **2001** (A Night at the Opera reissue) |
| Sweet Child O' Mine / Guns N' Roses | 1987    | **2018** (Appetite reissue)             |
| Hotel California / Eagles           | 1976    | **2001**                                |
| Layla / Derek and the Dominos       | 1970    | **1990**                                |

**The fix is a second request against the release-group index**, which exposes the field the search
never returns — the release group's own `first-release-date`, i.e. the album's original release date:

```
GET /ws/2/release-group?query=rgid:(<id> OR <id> OR …)&fmt=json&limit=100
```

One batched query covers every surviving candidate, so **the request count stays at two regardless of
pool size** (decision 19a). 50 IDs is ~1.8 kB of query string; comfortably within limits.

**Measured accuracy of `search(limit=100)` → strict filter → batched release-group `first-release-date`:
12 of 13 known-tricky tracks exact**, against Phase 0's ~6% naive baseline. Correct on Billie Jean 1982,
Sweet Child O' Mine 1987, Hotel California 1976, Free Bird 1973, No Woman No Cry 1974, Wish You Were
Here 1975, Stairway to Heaven 1971, Bohemian Rhapsody 1975, Hallelujah/Buckley 1994,
Hallelujah/Cohen 1984, All Along the Watchtower/Hendrix 1968, Layla 1970, Smells Like Teen Spirit 1991,
Imagine 1971.

**Three things that look like tuning knobs and are not:**

1. **`limit=100` is load-bearing, not a page-size preference.** The plan asked for "a modest candidate
   limit". At `limit=25` the same algorithm scores **2 of 13** — the original studio recording is simply
   absent from the first page, because MusicBrainz ties dozens of candidates at `score: 100` and returns
   them in no useful order. 100 is the endpoint's maximum. **Do not reduce it.**
2. **Do NOT push the filters into the Lucene query.** `AND primarytype:album AND status:official AND
-secondarytype:compilation …` looks like the obvious optimisation and collapses the pool from 124 to
   9 for Billie Jean — but it drops the right recordings too, and returns **zero** results for
   Hallelujah / Leonard Cohen, which resolves correctly without it. Filter client-side, over a wide pool.
3. **The recording's own `first-release-date` is not a substitute.** Taking the minimum across
   artist-matching recordings scores 10 of 13 and is off by a year on several (Sweet Child 1988, No
   Woman No Cry 1973). It is used only for the relaxed second tier, where `low` confidence is honest.

**Decision 20 resolved, one way each.** **Free Bird generalises** (1973, exact). **Like a Rolling Stone
does not**: it is the single failure. Its pool is 707 candidates, the top 100 contain no official studio
album release at all, so the strict pass finds zero release-groups and it falls through to the relaxed
tier — which returned 1966 on one run and 1963 on another, since which 100 of 707 come back is not
stable. Correct answer 1965. This is exactly the case the tiered design exists for; it resolves with
`confidence: 'low'`. A query-level-filtered retry _does_ surface Highway 61 Revisited and would fix it,
but it is a third request on the global 1 req/s budget (decision 21) and it breaks other tracks — see
point 2. Deferred deliberately.

**Two other confirmations.** `"Bohemian Rhapsody - Remastered 2011"` returns **`count: 0`** while
`"Bohemian Rhapsody"` returns 224 — the Phase 0 title-cleaning requirement re-verified verbatim, and it
is a correctness requirement, not an optimisation. And a **503 with `{"error": "The MusicBrainz web
server is currently busy…"}` was hit once during ~40 paced requests**, so the single 503 retry the plan
specifies is a real need, not defensive coding.

## 2026-08-04 — The year-review screen was a spoiler surface; there is no pre-Start year UI

Developer decision closing `plan.md` §6's last open question ("mandatory or skippable year review before
Start?"): **neither — the screen does not exist.** The reasoning generalizes beyond this one screen and is
worth remembering when building Phase 3/6 UI:

- **The person pasting the playlist is a player.** There is no host role in this app. So any pre-Start
  screen listing title/artist/**year** hands that player the answers to the entire deck — the same leak
  §1's non-negotiable forbids on the hidden side, just relocated off the card.
- **Treat "leaks nothing" as a property of the whole app, not of the card component.** Loading screens,
  progress text, notices, `localStorage` inspection, and OS media-session metadata (already flagged in
  the Phase 0 playback decision) are all leak surfaces. Notices about year quality must be **count-only**
  — "n years could not be confirmed", never which tracks or what years.
- **Where `confidence` is consumed instead:** the card's **revealed** side, marking a `low` year as
  unconfirmed. Any year-correction affordance lives there too, post-reveal, where the player has already
  seen the value. Nothing in Phase 2's contract changes — the three tiers are still exactly what that UI
  needs.
- **Side benefit:** this removes a conflict nobody had noticed. A mandatory pre-Start review would have
  required all ~100 years up front, which at 1 req/s means waiting out the full MusicBrainz crawl and
  silently deleting the progressive-loading design (`plan.md` §3).
- **Left open deliberately:** what happens to a `confidence: 'none'` card. It can no longer be fixed
  before Start, so it is either dropped from the deck with a count-only notice or revealed as "year
  unknown". Recorded as a follow-on question in §6.

Docs synced: `plan.md` §2/§4/Phase 6/§6, `plan.phase-2-year.md` (open question + consumer table),
`architecture.md`, `development.md`, `api.md`, `plan.phase-1.md`.

## 2026-08-04 — Year resolution, as built: `dur:` in the query is what took it from 12/13 to 14/14

Follow-up to the entry above, from executing [`plan.phase-2-year.md`](./plans/plan.phase-2-year.md).
The previous entry's conclusion still holds; this records what changed once the code existed.

**Adding a duration bound to the search query is the single highest-value change of the whole plan**, and
the plan did not call for it — it treated duration only as a local tie-breaker:

```
recording:"<cleaned title>" AND artist:"<artist>" AND dur:[<durationMs-10000> TO <durationMs+10000>]
```

Spotify gives an exact `durationMs` per track, so this costs nothing. It works because it fixes the
**pool**, not the ranking: "Stairway to Heaven" is 842 candidates unbounded and **31** bounded, "Like a
Rolling Stone" 707 and **82**, "Smells Like Teen Spirit" 527 and **74**. Every measured track drops below
the 100-result page limit, so truncation stops deciding the answer and the result stops varying between
runs. Score went from 12/13 to **14/14**, and it is what fixed Stairway to Heaven and stabilised Like a
Rolling Stone (which had returned 1966 on one run and 1963 on another).

The **local** duration preference the plan specified is implemented too and measured **neutral** on top
of the query bound — kept because it covers the one case the bound cannot, a track whose duration
Spotify did not supply. Both spend the same exported `DURATION_TOLERANCE_MS`.

**`limit=100` is load-bearing and the plan's "request a modest candidate limit" was wrong.** Same
algorithm, same tracks: **2 of 13** at `limit=25`, **12 of 13** at `limit=100`. MusicBrainz ties dozens of
candidates at `score: 100` and orders them arbitrarily, so a smaller page is not a smaller version of the
same answer — it is a different, worse one. 100 is the endpoint's maximum. Do not reduce it.

**A guard that only runs on a cache miss makes a hard failure look intermittent.** Found by the live
check, not by any unit test: with the `MUSICBRAINZ_USER_AGENT` check living only in the adapter, a
deployment with no user agent served every **cached** track happily and returned 500 only on cold ones.
That is the confusing-to-diagnose failure the loud-failure decision exists to prevent, so the check moved
ahead of the cache read in `api/_lib/resolve-year.ts`. **General lesson for anything else added behind
this cache: a configuration check belongs in front of it, not behind it.**

**Measured latency, which Phase 3 has to design against.** Eight tracks through the real pipeline against
live MusicBrainz: **1.3–3.6 s per cold track** (two requests paced at 1.1 s plus network), **0 ms** on a
cache hit. A cold 100-track deck is therefore several minutes. Per-user only while nobody else is
resolving a cold playlist — the 1 req/s budget is global.

**Strict-versus-relaxed hit rate, on the known-tricky set only:** 14/14 strict, so the relaxed tier never
fired. That set is curated for difficulty, not representative, and the real ratio needs an ordinary
playlist to measure — still open. What is now known is that the relaxed tier is measurably worse when it
does fire (off by a year on Sweet Child O' Mine and No Woman No Cry in earlier measurements), which is
what `confidence: 'low'` is for.

**Two smaller shape notes.** The recording search **ignores `inc=`** — it always returns the same fixed
shape, so there is no way to ask it for more. And `release-group?query=rgid:(a OR b OR …)` accepts
unquoted UUIDs and returns exactly the requested groups; 50 ids is ~1.8 kB of query string and well
within limits.
