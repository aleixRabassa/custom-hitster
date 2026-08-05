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

## 2026-08-04 — `vercel dev` runs a FRESH PROCESS per invocation, so module-scope state never persists locally

Measured, not inferred. A temporary `api/probe-tmp.ts` reporting `process.pid`, `process.uptime()`,
a module-scope counter and a `globalThis` counter, hit three times through `vercel dev`:

| Request | `pid` | `uptimeSec` | module counter | `globalThis` counter |
| ------- | ----- | ----------- | -------------- | -------------------- |
| 1       | 21656 | 5           | 1              | 1                    |
| 2       | 35004 | 4           | 1              | 1                    |
| 3       | 19788 | 4           | 1              | 1                    |

Different PID every time. **This is not fixable in our code** — `globalThis` was tested precisely
because it is the usual workaround for module reload, and it does not survive a new process either.
Production is different: Vercel keeps a warm Lambda instance across invocations, so module scope does
persist there (within one instance, which is what `api/_lib/cache.ts` already documents).

**Two consequences that make local behaviour differ from production in ways that look like bugs:**

1. **The in-memory year cache never hits under `vercel dev`.** Requesting the same track twice returns
   `cached: false` both times. The `[year-cache] using in-memory cache` line printing on _every_ request
   rather than once is the visible tell.
2. **The per-instance rate-limit gate paces nothing under `vercel dev`.** Each invocation constructs a
   gate with `nextAllowedAt = 0`, so every request is admitted immediately. Five rapid requests returned
   `200 200 200 200 200` where the gate should have produced 429s.

**The dangerous one is #2, and it is the reason this entry exists.** Without Upstash configured, local
development sends MusicBrainz requests **completely unpaced** — two per lookup, as fast as the client
issues them, against a service whose published limit is 1 req/s and which blocks clients that ignore it.
A 50-track measurement run is ~100 unthrottled requests. **Configure Upstash before running anything
that resolves more than a handful of tracks locally**; the Redis gate is cross-process and works fine
under `vercel dev` precisely because it does not rely on process state.

**It also means the 50-track wall-clock measurement is only valid with Upstash configured.** Ungated,
the number is far too optimistic and does not reflect production at all, since production wall clock is
dominated by the 1.1 s gate spacing. `docs/development.md` §4 has been corrected accordingly — it
previously told the reader to expect `cached: true` on a repeat request and 429s under rapid fire, both
of which are unobservable in the default local setup.

**Third consequence, and the one that rules `vercel dev` out for performance work entirely: spawning
that process costs about four seconds per request.** Measured the same day, from a run where
`MUSICBRAINZ_USER_AGENT` was deliberately unset: every request returned `500 not-configured` in
**4.1-5.7 s** despite touching no network and doing no work at all. The probe above agrees —
`process.uptime()` was 4-5 s on arrival every time.

So a wall-clock measurement taken through `vercel dev` measures the dev server, not the resolver, and no
amount of Upstash configuration fixes that. **Take that measurement against a real deployment.** The
in-process figure of 1.3-3.6 s per cold track (recorded in the entry above) remains the honest number
for the resolver itself: it includes the 1.1 s gate spacing and both MusicBrainz round trips, and
excludes only function invocation overhead.

What `vercel dev` IS good for here: correctness. The 405, the `not-configured` 500, title cleaning,
`year: null` handling and the response shape were all verified through it successfully.

Seen in the same session, and consistent with the per-invocation process churn: `vercel dev` on Windows
with Node 25.9.0 printed `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c,
line 76` mid-run, more than once, without affecting any response. Not traced further, and no evidence it
involves this repo's code.

## 2026-08-05 — Phase 3 driven against a real playlist: the numbers Phase 2 owed, and a third of an ordinary deck has no year

Ran the Phase 3 game layer end to end against a real personal playlist
(`5KFmETOxEWVEtpa1voRfDU`, "rabacumple", 42 tracks, no truncation, no skipped entries) using a
throwaway harness that served the REAL `api/playlist.ts` and `api/year.ts` handlers over a local
`node:http` server and drove `src/game`'s reducer + resolver against them through
`src/game/year-client.ts`. So the whole path was exercised — HTTP, status mapping, sequencing,
retries — not a stub of it. Deck cold (empty memory cache), gate in per-instance mode, one process,
sequential crawl, so MusicBrainz was paced at 1.1 s throughout.

This is the same **in-process** setup the 2026-08-04 entry above calls "the honest number for the
resolver itself": it includes the gate spacing and both MusicBrainz round trips and excludes only
Vercel invocation overhead, the Redis round trips and the edge. A preview deployment will be somewhat
slower per card; it will not be slower in a way that changes any conclusion below, because the 1.1 s
gate spacing dominates.

**The wall clock Phase 2 could not measure:**

| Measurement                             | Result                                             |
| --------------------------------------- | -------------------------------------------------- |
| Full cold crawl, 42 cards               | **153.0 s** (~3.64 s/card, so ~3 min for 50 cards) |
| **Card-1 gate** (`START` → `playing`)   | **6.06 s** — one lookup, not one deck              |
| Priority jump (player outran the crawl) | **5.67 s**                                         |
| `/api/playlist`                         | 514 ms                                             |
| Lookups issued for 42 cards             | 43 (one retry)                                     |
| Warm re-crawl over the resolved deck    | **0 lookups**                                      |

Per-card cold latency ranged **1.08–11.27 s**, wider than the 1.3–3.6 s Phase 2 measured on its
curated set. Card 1 alone cost 6.0 s, so **the pre-Start wait is ~6 s in practice, not ~2 s** — worth
knowing before Phase 6 words the loading screen.

**The progressive-loading invariants all hold, measured rather than assumed.** Card 1 became playable
after one completed lookup with 1/42 cards resolved; flip worked immediately; jumping to the LAST card
(index 41) made the resolver finish its in-flight card and then resolve _that_ card next (11.7 s mark,
deck 3/42 resolved) before resuming the ordered walk at index 2. Waiting in deck order would have cost
~145 s instead of 5.7 s.

**The answer to plan.phase-3.md's open question about the relaxed tier, and it is not good news:**

```
high = 19  (45%)    low = 8  (19%)    none = 15  (36%)
```

Phase 2's "14/14 strict" was measured on a set curated for classic-rock difficulty. On an **ordinary
personal playlist** — Latin/reggaeton, Catalan pop, current chart tracks, a couple of novelty tracks —
**a third of the deck resolves to no year at all**, and only 45% reaches `high`. Phase 6 must therefore
treat "no year" as a NORMAL card state, not an edge case: a manual-entry affordance on the revealed
side is load-bearing, not a nicety. It also confirms decision 5 (a `confidence: 'none'` card stays in
the deck) was the only workable choice — dropping them would delete a third of this playlist.

**Five of the 15 misses share one unstripped suffix: `- Remix`** (`Ella No Es Tuya - Remix`,
`Pininfarina - Remix`, `Tumba la Casa - Remix`, `Además de Mí - Remix`, `4 KISSUS - Remix`).
`FAMILY_PATTERNS` in `shared/year.ts` strips `- Live`, `- Remaster`, `- Radio Edit`, `- Extended Mix`
and so on, but nothing matches a bare `Remix` — the `version` family's `(?:version|edit|mix|cut)`
alternation is anchored, so "remix" does not match "mix". Adding it would be consistent with decision
14 (Hitster asks when the SONG came out, so a remix should report the original's year, exactly as a
live take does) and is the single highest-value change available to the year resolver. **Not made here:
it is Phase 2 code and a product decision.** Untested guess at the ceiling: up to 5 of 42 cards on this
deck, i.e. `none` 36% → ~24%.

**Zero 429s in 43 lookups.** A single sequential client never trips its own gate: `acquire()` waits
~1.1 s, which is under the 1.5 s `DEFAULT_MAX_WAIT_MS`, so it gets the permit instead of a 429. **429
back-pressure is a multi-user phenomenon and is therefore unobservable in single-client testing** —
which is exactly why the resolver's 429 path is unit-tested rather than trusted to manual verification.
The real 429 rate still needs a deployment with concurrent players.

**The transient-retry policy earned its keep on the very first real deck.** One genuine
`502 upstream-unavailable` occurred (`Sunflower - Spider-Man: Into the Spider-Verse`, at the 87.6 s
mark); the resolver backed off and retried, and the retry returned `2018/low`. Without the retry that
card would have been deferred and possibly blanked. 43 lookups for 42 cards is the whole cost of that
policy on a healthy run.

**A misconfigured deployment behaves as designed.** With `MUSICBRAINZ_USER_AGENT` deleted, the deck
started, went straight to `playing`, set `yearLookupsUnavailable`, and spent **exactly one** lookup
before halting the crawl — not one per card.

**Still not verified locally, and still needs a real deployment:** the React 19 StrictMode
single-resolver check (needs a React runtime, so Phase 4's jsdom decision), a genuine mid-game browser
reload through `useGameSession`, and the 429 rate under concurrency.

## 2026-08-05 — Two Vitest 4 gotchas that cost a whole 150 s harness run

1. **`--reporter=basic` no longer exists in Vitest 4** and fails as `Failed to load custom Reporter
from basic` — a startup error, not a warning, so nothing runs.
2. **Vitest 4's default reporter swallows test stdout on a PASSING test.** A 153 s live harness ran
   green and printed only the summary; every `console.log` was lost. For any harness whose OUTPUT is
   the point, write results to a file with `writeFileSync` instead of logging them.

Also: **Vitest does not put `.env.local` into `process.env`.** Vite only exposes `VITE_`-prefixed
values, and on `import.meta.env`. Since `api/year.ts` reads `process.env['MUSICBRAINZ_USER_AGENT']` per
request, a harness that needs it must parse `.env.local` itself.

## 2026-08-05 — The remix fallback: a third resolution tier, measured at 3 of 5 recovered

Acting on the finding above (five of one playlist's fifteen yearless cards carried an unstripped
`- Remix`), `/api/year` now has a third tier. Built and verified the same day.

**How it works.** `stripRemixSuffix()` in `shared/year.ts` is a new pure export that drops a trailing
remix segment (`- Remix`, `(Bad Bunny Remix)`, `- Bootleg`, `- VIP Mix`, `- Remix Version`).
`resolveYear()` calls it ONLY when the strict and relaxed passes have both returned `year: null`, then
re-queries MusicBrainz with the base title and runs strict-then-relaxed again over those candidates.

**Why it is a fallback rather than part of `cleanTrackTitle()`.** Every family in `FAMILY_PATTERNS` is
stripped on the first attempt because the literal suffix breaks the query outright ("Bohemian Rhapsody

- Remastered 2011" returns zero results). A remix is different: it is often a real, separately-credited
  recording that MusicBrainz knows under its full title, so stripping it up front would throw away the
  exact match and ask about a _different_ song. Try the title as given; only then ask about the
  underlying song.

**Three deliberate choices, each with a test that pins it:**

1. **A hit is always downgraded to `confidence: 'low'`,** even when the strict pass matched. The title
   had to be rewritten to find it, which is exactly the "show with an unconfirmed marker" case `low`
   exists for — and a remix genuinely can be a different song rather than a new take on one.
2. **`durationMs` is dropped from the fallback query and from its scoring.** A remix is not the same
   length as the song it remixes, so the `dur:` bound would exclude the very recording being looked
   for. Reusing the primary scoring input is the obvious "tidy-up" that would break this, hence the
   test named for it.
3. **A fallback upstream failure is swallowed.** The primary passes already produced a definite "no
   year"; turning that into a 502 would make the client retry a card whose answer is known.

`YearResult` and `YearLookupResult` gained an optional **`viaTitle`**, set only on a fallback hit, for
the reason `cleanedTitle` exists (decision 18): when a year looks wrong, "we asked about a different
title than the card shows" is the most important possible answer to "what was searched for". It lives
on the cached `YearResult`, so a cache hit explains itself exactly as the original miss did.
`cleanedTitle` still reports the PRIMARY query's title — the one the cache key is derived from — so it
reads the same either way. It reaches the browser through `year-client.ts` untouched; Phase 3 does not
store it on the `Card`, so Phase 6 must read it from the response if it wants to show it.

**`YEAR_CACHE_SCHEMA_VERSION` was deliberately NOT bumped**, despite the module's own rule about
bumping it when resolution changes. This tier can only improve tracks that previously resolved to
`none`, and `none` entries have a **1-day** TTL, so the masking is bounded at 24 h and self-healing. A
bump would additionally invalidate every 30-day `high` entry that this change cannot affect — strictly
worse.

**Measured live against the same playlist (`5KFmETOxEWVEtpa1voRfDU`), all 5 remix cards:**

| Card                      | Result                                         |
| ------------------------- | ---------------------------------------------- |
| `Pininfarina - Remix`     | **2020 / low** via "Pininfarina" (recording)   |
| `4 KISSUS - Remix`        | **2024 / low** via "4 KISSUS" (release-group)  |
| `Tumba la Casa - Remix`   | **2015 / low** via "Tumba la Casa" (recording) |
| `Ella No Es Tuya - Remix` | still `none` — MusicBrainz has neither form    |
| `Además de Mí - Remix`    | still `none` — same                            |

**3 of 5 recovered**, so this deck goes from 15 yearless cards to 12 (36% → 29%). The two remaining
misses are genuine data gaps, not query problems. Spot-checking the three: "Tumba la Casa" is correctly
2015 (the remix itself is 2016), and the other two are plausible.

**The latency consequence is the important operational finding: a successful fallback took 13.5–16.0 s**
(vs 4.8–14.2 s for a failing one), because it runs after the primary ladder has already spent up to
three gated requests. That is **past Vercel's default 10 s Node function limit** — and the 2026-08-05
measurement above already showed a plain lookup peaking at 11.3 s, so the limit was a latent problem
before this change rather than one it introduced. **`vercel.json` now sets `functions: {"api/*.ts":
{"maxDuration": 30}}`.** That value is unverified against a real deployment (no Vercel CLI here) and is
the one change in this batch that can only be validated by deploying.

## 2026-08-05 — Validated against a real Vercel preview deployment, and the project has NO environment variables

Installed the Vercel CLI (`npm install -g vercel`, 58.5.1 — global, so `package.json` and the pnpm
lockfile are untouched; the CLI does not belong in the deployed dependency set) and deployed a
**preview** (never `--prod`) of the working tree. Auth was already present for `aleix-rabassa`, and the
repo is linked through `.vercel/repo.json`.

**What the deployment proves.**

- **`maxDuration: 30` is valid and in force.** Not inferred from a silent success: setting it to
  `999999` and deploying fails the build with _"The value for maxDuration must be between 1 second and
  300 seconds"_. So Vercel validates the field at build time, this account's ceiling is **300 s**, and
  30 passed. Plenty of headroom remains if the remix fallback ever needs more.
- **The `functions: {"api/*.ts": …}` glob matches.** `vercel inspect` lists `λ api/hello`,
  `λ api/playlist`, `λ api/year`; a pattern matching nothing is a build error, not a warning.
- **`/api/year` runs correctly in the deployed runtime**, which is the only place the `.js`-extension
  import discipline can be verified (AGENTS.md: an extensionless specifier builds clean and fails at
  runtime). The new `stripRemixSuffix` import is fine — no `FUNCTION_INVOCATION_FAILED`.
  - `Levels - Radio Edit` / Avicii → `2013 / high`, `cleanedTitle: "Levels"`, `version: true`.
  - **`Tumba la Casa - Remix` → `2015 / low`, `viaTitle: "Tumba la Casa"`.** The remix fallback works
    end to end on real Vercel.
  - `Además de Mí - Remix` (the slowest local case at 14.2 s) → `null / none`, HTTP 200, no 504.
- **The edge cache tier works:** a repeated `/api/playlist` was served with `"source":"static"`,
  `"cache":"HIT"` in the runtime logs.

**What it does NOT prove: function duration.** `vercel curl` (the supported way through Deployment
Protection) has its own overhead of **10.5–16.5 s**, sampled three times on `/api/hello`, which is the
same magnitude as the requests being measured. Wall clocks came out at 13.8 s for a normal lookup and
16.2–16.9 s for the two remix lookups, and the noise swallows the signal entirely. Getting clean numbers
needs a **Protection Bypass for Automation** secret (a project setting, so the developer has to create
it) or protection disabled for the preview. The in-process figures from earlier today remain the honest
per-lookup numbers.

**THE OPERATIONAL FINDING, and it is the important one: the Vercel project has ZERO environment
variables** (`vercel env ls` → "No Environment Variables found"). Two consequences, both visible in the
preview's cold-start logs:

```
[year-cache] using in-memory cache (per-instance, not shared)
[rate-limit] using per-instance pacing (does NOT enforce the global 1 req/s)
```

1. **`MUSICBRAINZ_USER_AGENT` is unset, so a real deployment 500s `not-configured` on every year
   lookup.** The preview above only worked because the value was passed as a one-off
   `vercel deploy -e MUSICBRAINZ_USER_AGENT=…`, which does not persist to the project.
2. **Without Upstash there is no shared cache and no global gate.** Per-instance pacing does not
   enforce MusicBrainz's 1 req/s across concurrent invocations, so a deployed multi-user session can
   aggregate past the published limit — the thing that gets clients blocked. **Do not drive a whole
   deck against a deployment until `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set.** For the same reason
   the validation above was deliberately four hand-spaced requests, not a crawl.

Unrelated noise seen in the logs, recorded so it is not re-investigated: `(node:4) [DEP0169]
DeprecationWarning: url.parse()` on every invocation. It comes from `@vercel/node`'s own request
handling under Node 25, not from this repo's code.

## 2026-08-05 — YEAR_CACHE_SCHEMA_VERSION bumped to v2

Bumped at the developer's instruction, superseding the "deliberately NOT bumped" note in the remix
fallback entry above. The rule in `shared/year.ts` is unconditional — bump when resolution logic
changes — and the remix fallback changes it, so v1 → **v2**.

The reasoning for the earlier hesitation still stands as a description of the cost, and it is worth
knowing: the new tier can only improve entries that were `none`, and those carry a 1-day TTL, so v1
would have washed out by itself within 24 h. Bumping additionally discards every `high` entry, which
has a 30-day TTL. **So the first play of any playlist after this ships re-resolves its whole deck
against a 1 req/s budget shared by every user** — with the measured cost of ~3.6 s per cold card, that
is ~3 minutes of crawl for a 50-card deck that would otherwise have been instant. The trade taken is
that a version segment only bumped when someone judges it necessary is a version nobody can trust.

Currently zero-cost in practice: with no Upstash configured (see the entry above) nothing is shared or
durable anyway, so there are no production entries to invalidate yet.

## 2026-08-05 — `backface-visibility` hides a card face visually and leaks every word of it

The card's hidden side must leak nothing — it is the whole game — and the obvious CSS 3D flip does
not deliver that on its own. `backface-visibility: hidden` is a **painting** property: it stops a
face being drawn and leaves its text in the document, where **devtools, find-in-page (Ctrl+F), the
accessibility tree and any screen reader all still read it**. A player looking at a face-down card
can read the answer four different ways.

So `src/components/Card.tsx` **does not mount `CardRevealSide` while `isFlipped` is false.** The
reveal FACE exists throughout (a 3D flip needs both faces to rotate); it is empty. This costs nothing
visually, because below 90° of rotation the back face is invisible anyway, and it converts "leaks
nothing" from a claim into an assertion — `Card.test.tsx`'s `should not mount the revealed side while
unflipped` is the most important test in the phase.

**The wider rule, which is the reusable part: a leak audit must cover attributes and accessible
names, not just visible text.** Three surfaces that a `grep` for the title would miss entirely:

- **`aria-label` and `alt`.** "Play Bohemian Rhapsody" leaks to a screen-reader user exactly as body
  text leaks to an eye, and `alt` is also shown when an image fails. Every control on the hidden side
  has a generic name, and `CardHiddenSide.test.tsx` asserts the exact list rather than merely the
  absence of the title — an exhaustive list is what catches a well-meaning "Play preview of …" edit.
- **`durationMs`.** Added to the forbidden list during execution: "3:54" beside a QR code identifies
  a track, and a playback progress bar is precisely the sort of helpful addition that introduces it.
- **The OS media session.** `navigator.mediaSession.metadata` publishes title and artist to the
  phone's lock screen and notification shade, which no amount of on-page hiding can retract. Nothing
  in the app touches it, `useCardAudio.test.ts` asserts as much, and the file says so in a comment —
  because it is an OMISSION, and omissions get "fixed" by whoever notices the media panel says
  nothing useful.

`Card.id` is not a leak and is encoded in the QR by design: 22 opaque base62 characters, and scanning
is how a player reaches the full song.

## 2026-08-05 — jsdom implements no media playback, and no canvas

`HTMLMediaElement.play()` and `.pause()` exist in jsdom as stubs that log
`Error: Not implemented: HTMLMediaElement.prototype.play` and do nothing. An unstubbed call therefore
produces console noise plus a test that mysteriously never becomes "playing" — never a clean
assertion failure, which is what makes it worth writing down.

Audio tests stub both **on the prototype**, which is also what makes call ordering assertable:

```ts
vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
  calls.push(`play:${this.getAttribute('src') ?? ''}`);
  return Promise.resolve();
});
```

Recording the `src` with each call is what lets `useCardAudio.test.ts` prove the ordering that
matters: on a card change the element is paused **against the outgoing `src`** before the new one is
set. Swapping first can leave a frame of the previous track audible.

Two related jsdom gaps found the same day:

- **`currentTime` is stored but never advances.** Fine for asserting seeks to 0; useless for anything
  about elapsed time, so nothing asserts on that.
- **There is no `<canvas>`.** The `qrcode` browser build draws through one, so `QrCode` tests mock
  the module rather than exercising it — a real call fails for a reason unrelated to the component.
  The mock encodes its input into the fake data URL, which makes "the image source encodes the given
  URL" a literal assertion instead of a proxy for one.

Also: `element.src = ''` is not how you clear a source. An empty string resolves against the document
URL, so the element tries to load the **page itself** as media. Use `removeAttribute('src')`.

## 2026-08-05 — How the DOM test environment is selected, and why `node` stayed the default

Vitest 4.1.10 **does** honour a per-file `@vitest-environment jsdom` docblock (verified with a
throwaway probe before any component was written; the fallback of a two-project `test.projects`
config proved unnecessary). The docblock must be the first thing in the file.

**`vite.config.ts` keeps `environment: 'node'` as the default, and globalising jsdom would be a real
regression rather than a convenience.** The node default is half of what keeps `shared/` portable:
that tree is compiled into Vercel Functions, so a `document` or `window` reference in it must fail a
test run. Under a global jsdom it passes quietly and breaks at deploy time instead — the exact
failure mode this repo works hardest to avoid, and the same class of problem as the missing `.js`
extension.

Two consequences that cost time on the first component test, both now in `toolchain.md` §5:

1. **Testing Library does not clean up between tests here.** Its automatic `afterEach(cleanup)`
   registers only when Vitest's `globals` are enabled; this repo imports `describe`/`it`/`expect`
   from `vitest` explicitly, so nothing unmounts and every render accumulates in `document.body`.
   The first symptom was "found multiple elements with the role img" in a file rendering one image —
   it reads as a component bug. **Every DOM test file carries its own `afterEach(cleanup)`.** No
   `setupFiles` was added; `@testing-library/jest-dom` was deliberately not installed either, so that
   slot stays empty and `setup` is always `0ms`.
2. **Control calls that set state must be wrapped in `act()`.** React 19 does not flush an update
   made outside `act()` before the test's next line, so a value read immediately afterwards is the
   previous render's — `isPlaying` reads `false` right after a successful `play()`.

Cost: booting jsdom is several seconds of `environment` time per file, versus ~0 ms for a node file.
The full suite still runs in well under a minute.

## 2026-08-05 — Process note: Phase 3's code shipped a day ahead of its documentation

Phase 3 landed complete and tested in `43e59cc`, with `plan.md`, `AGENTS.md` and `architecture.md`
untouched. For a day, **three documents told a reader that Phase 3 was upcoming work while it was
sitting in `src/game/`** — and `AGENTS.md` names `docs/` as the source of truth, so anyone (human or
agent) starting from the docs would have set out to build what already existed.

Two things made it worse than a stale sentence. `architecture.md` had no description of `src/game/`
at all, so the tree's largest new subsystem was undocumented; and `plan.phase-3.md`'s own
Documentation Updates checklist was unticked, which correctly recorded the gap but only for someone
already reading that file.

Closed on 2026-08-05 as step 0b of `plan.phase-4-6-card-ui.md`, deliberately **before** any Phase 4
UI was built on top of those documents. Ticking the boxes meant doing the work first: the `src/game/`
section in `architecture.md`, the reference-client note in `api.md`, and the resolver subsection in
`development.md` all had to be written.

**The lesson is about sequencing, not diligence.** The documentation pass was scheduled as a separate
step at the end of the phase, which is exactly where a step gets dropped when the code is green and
the phase feels finished. Phase 4 was executed with its doc updates as numbered steps in the same
plan instead.
