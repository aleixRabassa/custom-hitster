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

## 2026-08-05 — The fixture deck's `previewUrl`s are fake, so audio looks broken in the dev harness

Reported during Phase 4's manual verification: flip and next worked, **Play/Pause and Restart did
nothing.** Not a bug in `useCardAudio` — the fixture cards in
`src/components/__fixtures__/cards.ts` carry invented preview URLs like
`https://p.scdn.co/mp3-preview/bohemian`. A real Spotify preview URL ends in a long hash; these
resolve to nothing.

**The failure is silent by design, which is what makes it confusing.** The buttons are ENABLED,
because `canPlay` keys on the presence of a `previewUrl` and one is present. Clicking Play calls
`element.play()`, the source fails to load, the returned promise rejects, and `useCardAudio` catches
it — deliberately, because a blocked-autoplay rejection and an `AbortError` from a mid-playback `src`
swap arrive by the same path and must not surface as unhandled rejections. `isPlaying` goes back to
false and the button flips back to Play. Working exactly as specified, indistinguishable from broken.

The fake URLs are **correct for the unit tests** and were not changed: those tests stub
`HTMLMediaElement.play` on the prototype and assert on WHICH url the element was pointed at, so a
short recognisable value reads better in a failure message, and a fixture that reached the network
would not be a unit test.

The fix is in the harness, not the fixtures: `src/App.tsx` maps the deck through a substitution that
swaps every preview for **`public/dev-preview.wav`**, a generated 15-second ascending arpeggio (no
licensing question, no network, and audibly positional so Restart is distinguishable from Play).
`noPreviewCard` is deliberately left alone — it is the only card that proves the disabled-controls
path, and handing it a working URL would delete that check. Both the harness and the asset are Phase
4 scaffolding; `plan.phase-4-6-screens.md` removes them along with `App.tsx`.

**The general lesson: a fixture value good enough for a stubbed unit test can be actively misleading
in a browser.** Anything a manual check exercises for real — a media URL, an image source, a link —
needs a working value in the harness even when the test-side fixture is rightly fake.

## 2026-08-05 — `PanInfo` is not importable from `motion@12`, and the workaround is better than the import

Phase 5's gesture hook needs the type of the `info` argument Motion passes `onDragEnd`. That type is
`PanInfo`, and **there is no supported way to import it.**

The chain: `motion@12.43`'s `./react` subpath is `import * as fm from 'framer-motion'; export * from
'framer-motion'`. `framer-motion`'s own `index.d.ts` re-exports a long list of types from
`motion-dom` — and `PanInfo` is **not** on it. `PanInfo` is declared in and exported from
`motion-dom`, which is a **transitive** dependency: it is in `node_modules/.pnpm`, not in
`package.json`, and pnpm's strict linking is right to make importing it awkward.

Grepping `framer-motion/dist/index.d.ts` for `PanInfo` returns **nothing** — the only hit is inside a
`Reorder` component signature. The declaration is in
`node_modules/.pnpm/motion-dom@12.43.0/node_modules/motion-dom/dist/index.d.ts:17`.

**The fix, and why it is not a workaround so much as an improvement:** `src/hooks/useCardGestures.ts`
declares what it actually reads as local interfaces — `DragEndInfo` (`offset` and `velocity`, each
`{x, y}`) and `GesturePointer` (`clientX`, `clientY`, `timeStamp`). Both are structural
**supertypes** of what Motion passes, requiring strictly fewer fields, so under normal parameter
contravariance a handler typed against them is soundly assignable to Motion's own handler type. The
compiler checks exactly that where the props are spread onto `motion.div` in `Card.tsx`, so a Motion
upgrade that changed the shape would fail `pnpm typecheck` rather than fail silently.

Two side benefits worth keeping: the hook's public signature carries **no Motion types at all**, and
the handlers are callable from a plain-object test without constructing a Motion event.

**Do not "fix" this by adding `motion-dom` to `package.json`.** That pins a second version of
Motion's internals against the one `motion` resolves for itself, and the failure mode is a type-only
mismatch that appears after an unrelated upgrade.

## 2026-08-05 — Motion's drag cannot be exercised under jsdom, which is why gesture decisions are pure functions

**This is the constraint that shaped all of Phase 5, and it is worth stating plainly because the
resulting file layout looks like ceremony otherwise.**

Motion's drag handling reads element geometry — `getBoundingClientRect`, layout boxes, transform
matrices — and jsdom computes none of it: every box is 0×0. Dispatching a `pointerdown` →
`pointermove` → `pointerup` sequence at a `motion.div` under jsdom therefore does **not** exercise
the drag path. A test written that way passes while asserting nothing about the gesture; it asserts
that the test double works.

So the thresholds were pulled out of the React seam entirely. `src/game/gestures.ts` holds
`shouldCommitSwipe`, `swipeDirection` and `isTap` — pure functions over numbers, no React, no DOM, no
Motion — covered by 15 node-environment tests on **both sides of every boundary**.
`src/hooks/useCardGestures.ts` is left thin enough that reading it is sufficient review: it collects
coordinates into refs, asks, and dispatches.

This is the same split Phase 3 used for the resolver, and it is now the house style. The general
principle: **when a library owns a code path your test environment cannot reach, the decisions must
not live inside that path.** The alternative here was five magic numbers with no coverage at all.

Two consequences recorded so they are not rediscovered:

- **Pointer state is in refs, not state.** A drag emits a pointer event per frame; `useState` there
  would re-render the card on each one and fight Motion for the same transform it is animating.
  `exitDirection` is the one piece of state, because it is read during render.
- **`src/game/gestures.test.ts` has no `@vitest-environment` docblock, deliberately.** It is a node
  test. Anyone looking for "the swipe tests" in a component file will not find them.

## 2026-08-05 — A lost `pointerup` would have half-broken tap-to-flip, and it was not on the plan's risk list

Found while writing `useCardGestures`, not by a failing test — no test in this repo could have caught
it, and neither could a desktop mouse.

The plan specified: mark a recognised drag in a ref on `onDragStart`, and clear it after the
pointer-up decision. That is correct until the pointer is released **outside** the card — which is
the _normal_ case for a committed swipe, because the card has moved out from under the finger by
then. React's `onPointerUp` is attached to the card, so when the release lands on a different element
that handler never fires. `didDragRef` stays `true`, and the **next** genuine tap is rejected as "a
drag was recognised".

The symptom would have been **tap-to-flip working every other time** — attributed to a bad threshold,
or to the device, long before anyone suspected a stale ref.

The fix is to make `pointerdown` reset the entire gesture (start coordinates, drag flag, commit
latch) rather than only record the start, plus an `onPointerCancel` that clears it. Resetting at the
_beginning_ of a gesture is robust to any end event going missing; clearing only at the end assumes
the end always arrives. The plan's literal instruction is kept as well — both happen — since
resetting on down is a strict superset.

**Generalisable: any per-gesture flag cleared on the terminating event needs a reset on the
initiating one too.** Pointer capture, `pointercancel`, a release outside the element, and a
scroll-stolen gesture all mean the terminating event is not guaranteed.

## 2026-08-05 — Space on a focused button both activates it and flips the card

Cheap to fix, invisible until someone plays with a keyboard after clicking Play, and the reason
Phase 5's key handler has a guard that looks redundant.

Phase 5 puts a window-level `keydown` handler in `GameScreen` (the card is not a control and nobody's
hands are on it, so a focus-dependent handler would be dead most of the time). Space flips the card.
But **Space is also how a focused `<button>` is activated** — so after a player clicks Play with a
mouse, focus stays on that button, and one press of Space toggles the audio _and_ flips the card.

Pressing play reveals the answer. Which is the entire game.

The guard is `if (active instanceof HTMLButtonElement) return;` on the Space branch only —
`ArrowRight` does nothing to a focused button, so there is no double-action there, and disabling the
advance after the player has touched a control would be its own small hostility. Asserted by
`should ignore Space while focus is on a button` and by `should still advance on ArrowRight while
focus is on a button`, the pair being what pins the guard's scope.

**Focus is deliberately NOT moved off the control after a click**, which the plan floated as
belt-and-braces. Silently relocating a keyboard user's focus is a worse bug than the one it papers
over, and the guard already closes it.

The general shape, worth remembering for any app with a global key handler: **a global shortcut on a
key that also has a native activation meaning (Space, Enter) will double-fire against whatever is
focused.** Text inputs are the obvious case and get remembered; buttons are the one that gets missed.

## 2026-08-05 — Absolutely positioned siblings paint over an in-flow sibling, which broke the card stack

Small, purely visual, and cost more time than it should have because nothing errored.

`CardStack` renders 2 backs plus the current card. The backs are `absolute inset-0` so they stack
behind; the current card is `Card`, in normal flow, sized to match. Result: **the backs painted over
the card**, hiding the QR and the controls entirely.

The cause is CSS paint order, not a Tailwind or Motion issue: within a stacking context, positioned
elements (`z-index: auto`, `position: absolute`) paint in a **later layer** than non-positioned
in-flow content, regardless of DOM order. Putting the card last in the markup does not help.

The fix is `isolate` (`isolation: isolate`) on the container plus `-z-10` on the backs. `isolate`
matters: without a stacking context the negative z-index escapes upward and the backs disappear
behind the screen's own background instead. The alternative — giving the card a positive z-index —
was rejected because `Card`'s `className` belongs to `Card`, and the stack should not need to reach
into it to be layered correctly.

## 2026-08-05 — Phase 5's real-device touch verification was scoped and then waived

Process note, recorded because the absence is otherwise indistinguishable from an oversight.

`plan.md` §5 lists "verified on real iOS Safari + Android Chrome (touch is where this breaks)" as a
Phase 5 deliverable, and `plan.phase-4-6-gestures.md` step 6 spells out the checklist. **The
developer decided on 2026-08-05 that it will not be performed.** Phase 5 shipped without it.

What this means concretely, for whoever hits it next:

- The five threshold constants in `src/game/gestures.ts` — 96px commit distance, 500px·s⁻¹ flick,
  10px·x / 16px·y tap radius, 400ms tap duration — **have never met a thumb.** They are documented
  reasoning, not measurements.
- Three open questions in the plan stay open and are marked as such: the threshold values themselves,
  whether iOS needs `select-none` and long-press suppression (`select-none` was deliberately **not**
  added pre-emptively), and whether 2 backs or 3 looks right.
- Unverified mitigations: `touch-none` on the draggable surface and `overscroll-behavior: none` on
  `html, body` are both believed necessary and neither is confirmed to be sufficient.

The checklist is preserved in `docs/development.md` §5 rather than deleted, alongside the
`pnpm dev --host` procedure for reaching the dev server from a phone, and the gap is listed in that
file's §8 Known limitations. The plan's checkbox is left **unticked**, because it was not done.

**The reason this is worth an entry: the failure mode of a waived manual check is that the next
session reads green local checks as full coverage.** `pnpm typecheck && pnpm lint && pnpm test &&
pnpm build` all pass, and 310 tests pass, and none of that touches a drag.

---

## 2026-08-05 — A button inside a tappable card flips it: the pointer twin of the Space-on-a-button bug

**The bug, found by the developer playing the app rather than by any test.** Pressing Play, Pause,
Restart or Exit on the card's hidden face **also flipped the card**, revealing the answer as a side
effect of starting the audio.

The mechanism, which is worth understanding because it generalises:

- Phase 5 bound `gestureProps.onPointerUp` to the card's **outer** element (`Card.tsx`'s
  `motion.div`), which is correct — the drag has to live there, away from the flip transform.
- A pointer-up on a button _inside_ that element **bubbles into the same handler**.
- `isTap()` then sees precisely what a genuine tap looks like: a few pixels of movement over a couple
  of hundred milliseconds, with no drag recognised. So it returns true and `onFlip()` fires.

**This is the pointer twin of a bug Phase 5 already guarded against for the keyboard** — Space while
focus is on a button both activating the button and flipping the card. That guard was written,
documented, and tested. The pointer version was missed because **the two halves shipped in different
phases**: the buttons were harmless on the card in Phase 4, and Phase 5 made the card tappable without
revisiting what was already inside it. A guard written for one input modality is not a guard for the
other.

**The fix is structural, at the developer's instruction: the controls moved out of the card** to
`src/components/CardControls.tsx`, rendered by `GameScreen` beside the stack. The alternative — a
`closest('button')` check inside `useCardGestures` — would have worked and was rejected: moving them
out means **there is no interactive element inside the draggable surface at all**, so the class of bug
is gone rather than guarded. Two tests assert the absence (`CardHiddenSide.test.tsx`'s "should render
no interactive element at all" and `CardStack.test.tsx`'s button check), because re-adding a button to
the card face is exactly the kind of well-meaning change that would reintroduce it.

Consequences worth knowing:

- `Card`, `CardStack` and `CardHiddenSide` no longer take `audio` or `onExit` — the prop chain got
  shorter, and `GameScreen` (which already owned the `<audio>` element) now renders the controls itself.
- The card's hidden face is the QR code and one line of generic text. That is arguably the honest
  shape: the QR is the only part of a hidden card a player is meant to touch, and they touch it with a
  phone camera.
- **The plan said Exit lives on the card** (`plan.md` §5 and `plan.phase-4-6-screens.md` step 12 both
  say so, and the HUD's own test asserts the HUD has no Exit). That is now wrong about _where_, and
  still right about _how many_: there is exactly one Exit control, it is just beside the card rather
  than on it.
- The control bar is visible on both sides of the flip, where the hidden-face version was unreachable
  once flipped. Phase 4's stop-on-flip rule is unchanged; a player who deliberately presses Play after
  the reveal now gets audio, which is a reasonable thing to want.

---

## 2026-08-05 — `START` had to skip the card-1 gate for an already-resolved deck, or Restart hung forever

**A latent bug in Phase 3's reducer, unreachable until Phase 6 built Restart, and it hung the app.**

`gameReducer`'s `START` unconditionally set `status: 'preparing'`, and the card-1 gate opens only on a
`YEAR_RESOLVED` action naming `deck[0].id`. Meanwhile `resolver.ts` correctly refuses to look up a card
that already has a year — it goes straight into `settled` — which is exactly right, because
re-resolving would re-spend a globally shared MusicBrainz budget on work already done.

Put those together for a deck that arrives **pre-resolved** and nothing ever dispatches
`YEAR_RESOLVED`, so nothing ever opens the gate, so **the loading screen stays up forever.**

**Phase 6's Restart hits this every single time.** It re-deals `state.deck` (deliberately — that is
what makes Restart work after a resumed session and cost zero lookups), and a session can only have
_left_ `preparing` in the first place because card 1 resolved. So every restart deals a deck whose
card 1 has a year.

The fix is one condition in `START`: `deck[0]?.year === undefined ? 'preparing' : 'playing'`. It is
also the semantically correct model rather than a patch — the gate's own comment says it waits for card
1's lookup to **complete**, and `year !== undefined` _is_ a completed lookup. That is what the three
states of `Card.year` mean (`undefined` = not looked up, `null` = looked up and nothing found).

Three things worth carrying forward:

- **It was caught by an integration test, and could not have been caught by a unit test.** The bug
  lives in the interaction between the reducer (waits for an action), the resolver (declines to send
  one) and the container (deals a pre-resolved deck). Each component is individually correct.
  `src/App.test.tsx`'s "should restart from the current deck" is what found it.
- **`plan.phase-4-6-screens.md` listed any reducer change as Out of Scope**, and this was changed
  anyway. The out-of-scope clause exists to stop a _presentation_ concern reopening a finished phase
  (that is what the container's end-reason flag is for). This was not one: the reducer is the only place
  that can decide the gate, and the alternative would have been a fake `YEAR_RESOLVED` dispatched from
  the wiring layer to trick it.
- **`RESUME` was checked and does not need the same fix.** A save can only carry
  `status: 'preparing'` if it was written while card 1 was unresolved — the moment card 1 resolves, the
  same action flips the status to `playing`, and the save records that. On resume the resolver looks
  card 1 up again and the gate opens normally.

---

## 2026-08-05 — `pnpm dev` cannot exercise the playlist client, and now fails with a player-visible message

`docs/architecture.md` §5 has long recorded that Vite serves `api/` files as transpiled source with a
**200** status. Phase 6 gave that a **client-visible shape** for the first time, which is the finding.

Under `pnpm dev`, pressing Start on the landing screen fetches `/api/playlist` and receives the
transpiled source of `api/playlist.ts` — status 200, `text/javascript`. `response.json()` rejects,
`playlist-client.ts` catches it, and the outcome is `unexpected-payload`. So the app shows:

> Spotify returned something we could not read. This is a problem on our side, not with your link.

Which is **true and completely misleading about the cause.** The client is behaving exactly as
designed; the wrong dev server is running. `playlist-client.ts` handles this explicitly and says so in
a comment, and `playlist-client.test.ts` covers it ("should report unexpected-payload for a 200 whose
body is not JSON") — because the alternative was a raw `SyntaxError` surfacing from inside a promise
chain, which is strictly worse.

**Use `npx vercel dev` to play the game.** Recorded in `AGENTS.md`, `docs/development.md` §4 and §8,
and `docs/architecture.md` §5, because the symptom looks like an app bug rather than a setup problem
and the error copy actively points the reader at the wrong layer.

---

## 2026-08-05 — Following a redirect from a user-supplied URL is the repo's first SSRF surface

`api/_lib/short-link.ts` resolves `spotify.link` URLs, and it is **the first place in this repository
where user input decides an outbound request target.** That deserves stating plainly, because the
feature reads as trivial ("follow the redirect") and the security shape is not.

A Vercel Function has unrestricted outbound network access. "Follow the redirects on a URL the player
pasted" is, stated plainly, server-side request forgery: without a check, a crafted chain points the
function at a cloud metadata endpoint, an internal address, or any third-party host, and the response
returns through our own trusted origin.

Four guards, and the first is the one that makes the rest possible:

1. **`redirect: 'manual'`.** With automatic following, `fetch` walks the whole chain internally and the
   allow-list **never sees a single intermediate host**. This is not a preference; it is what makes the
   allow-list enforceable at all. `short-link.test.ts` asserts the `init` directly, because there is no
   other observable difference.
2. **An allow-list, matched on the exact host** — never a suffix or substring test. Enumerating what is
   safe is the only direction that fails closed. `URL.hostname` is what is compared, which also
   disposes of the userinfo trick (`https://spotify.link@evil.example/x` has hostname `evil.example`).
3. **http(s) only**, so `javascript:`, `file:` and `data:` targets are refused.
4. **A hop limit of 3**, which doubles as the loop guard — a chain can be infinite without ever
   repeating a URL, so a bound is strictly stronger than a visited-set.

The SSRF test scripts each forbidden target as **reachable**, so that a resolver which followed it
would _succeed_. A passing test therefore cannot be an accident of the double rejecting the request,
and it asserts two things: that the call was refused, **and that it was never made**.

Measured the same day, both through live requests:

- A real `spotify.link` chain is a **single 307** to `https://open.spotify.com/`. Not the multi-hop
  chain the plan anticipated.
- **`link.tospotify.com` no longer resolves** (ENOTFOUND). It is matched by the predicate and the
  allow-list anyway, deliberately: a legacy link genuinely _is_ a Spotify playlist link, so
  `upstream-unavailable` ("Spotify could not be reached") is a more honest answer than "that does not
  look like a Spotify link".

Short-link failures map onto **existing** `PlaylistErrorCode` values and add none — a dead host, a
refused hop, a hop-limit hit and a missing `Location` are all `upstream-unavailable`, and a short link
resolving to an album falls through `parsePlaylistUrl()` as `unsupported-entity` naturally. That is why
the resolver returns a **URL** rather than a playlist id, and why the client's message map needed no
new entry.

---

## 2026-08-05 — Exit and deck-exhaustion are indistinguishable in `GameState`, and the fix is a destination, not a reason

Recorded because the next person who wants to know _why_ a session ended will look here first.

Both paths produce `status: 'ended'` — `reducer.ts` line 127 (deck ran out) and line 137 (`END` from
Exit) — and **`currentIndex` cannot separate them either**, because `NEXT` past the last card leaves
the index _on_ the last card rather than one past the end. An Exit on the final card is therefore
byte-for-byte identical to finishing the deck.

The resolution (`plan.phase-4-6-screens.md` decision 2): **a container-local flag in `App.tsx`, not an
`endReason` field on `GameState`.** That keeps Phase 3's reducer, its types, its persistence format and
its test suite untouched for what is purely a presentation question — a phase declared complete does
not get reopened to decide which screen to show. It is ephemeral by design: `END` already clears the
saved session, so after a refresh there is nothing to resume and the landing screen is correct
whichever way the game ended.

**What the plan did not anticipate, and the reason this entry is longer than the decision:** the flag
was specified as `'exited' | 'finished' | null`, and a _reason_ turns out to be the wrong concept. The
end screen's "New playlist" button also has to reach the landing screen, and **the reducer has no
action that returns `ended` to `idle`** — deliberately, since there is nothing to un-end. So a reason
of `finished` would have had to mean two different destinations depending on a second piece of state.

It is therefore phrased as a **destination**: `type EndedView = 'end-screen' | 'landing'`. Exit and New
playlist both set `landing`; only a deck that ran out gets `end-screen`. Three paths, one concept.

A related trap in the same file, worth its own sentence: the guard for "has this fetch result already
been dealt?" **cannot be `state.status === 'idle'`**, which is the obvious version. After an Exit the
session sits at `ended` while the landing screen is on screen, so a playlist submitted from there would
never be dealt at all. `App.tsx` compares the **result object's identity** through a ref instead, which
is correct regardless of status and is also what makes the effect idempotent under StrictMode.

---

## 2026-08-05 — An unbound native `fetch` called as `options.fetchImpl(...)` throws "Illegal invocation", and both HTTP clients did it

**Symptom:** pressing Start showed _"Could not reach the server. Check your connection and try again."_
— the `network` code — with the dev server up and answering. Every Start in a real browser failed this
way, and every year lookup did too, so no card could ever have received a year.

**Cause, and it is a two-part cause.** `usePlaylist` passed the bare global `fetch` as `fetchImpl`, and
`fetchPlaylist` invoked it as `await options.fetchImpl(url, init)` — a **method call**, so the function
ran with `options` as its receiver. The browser's `fetch` is brand-checked: WebIDL resolves a
`null`/`undefined` receiver to the global (which is why `const f = fetch; f(url)` works fine) but
rejects any other object with

```
TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
```

The client's `try/catch` around the call — there to turn a genuine offline failure into a result rather
than an exception — swallowed that TypeError and reported `network`. So a call-site bug was presented to
the player as their own Wi-Fi. `year-client.ts` + `use-game-session.ts` had the identical pair.

**Why all five local checks passed, and would have kept passing.** Every `fetch` double in this repo is
a plain function or an arrow with no receiver check, and **the node environment's `fetch` is not
brand-checked either** — verified 2026-08-05. The bug existed only in a browser, i.e. only where nothing
in this repo runs. `App.test.tsx` drives the whole flow end to end through a stub and could not see it.

**Fix, applied at both layers deliberately.** The clients destructure (`const { fetchImpl } = options`)
so the call passes `undefined` as the receiver, and the two injection sites pass
`globalThis.fetch.bind(globalThis)`. Either alone is sufficient; both are cheap and the failure is
invisible until someone opens the app. `playlist-client.test.ts` and `year-client.test.ts` now each
carry a `brandCheckedFetch()` double that **throws unless its receiver is `undefined` or the global** —
a `function`, not an arrow, since an arrow has no `this` to inspect. Confirmed those tests fail against
the old call style before they were made to pass.

**The general rule for this repo:** a DOM built-in handed across a seam must be bound, and an injected
function must never be called as a property of its options bag. `api/_lib/musicbrainz.ts` uses the same
`deps.fetchImpl(...)` shape and is **not** affected — Node's `fetch` has no receiver brand check — but it
is the same pattern, so do not copy it into `src/`.

**Still not verified end to end:** that a full game now starts. That needs `npx vercel dev` in a real
browser — under `pnpm dev` the corrected fetch reaches Vite, which answers the function's transpiled
source with status 200, so Start now fails as `unexpected-payload` instead. Different message, same
unplayable dev server, exactly as `docs/development.md` §4 describes.

---

## 2026-08-05 — `vercel.json`'s SPA rewrite made the app blank under `npx vercel dev`, and that is why nobody had seen it run

Found while verifying the `fetch` fix above in a real browser. The page loaded, `<title>` was right, and
**`#root` stayed empty with no console error** — so the app had never actually been played locally at
all, under either dev server.

The rewrite was:

```json
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

**In production that is harmless**, because Vercel matches the filesystem BEFORE applying rewrites:
`dist/assets/index-*.js` is a real file, so it is served directly and the rewrite only catches unknown
routes. **Under `vercel dev` there is no `dist`** — Vite serves modules from source on demand, so
`/src/main.tsx` matches no static file, the catch-all fires, and the module script tag receives
`index.html`. The browser parses HTML as JavaScript, `main.tsx` never executes, and nothing mounts. No
error surfaces because the failure is a `<script type="module">` whose body is markup.

Confirmed directly: `curl http://localhost:3000/src/main.tsx` returned the full `index.html`
(`Content-Type: text/html`) before the fix and transpiled JS (`text/javascript`) after.

**Fix** — narrow the source so it cannot swallow dev-server paths:

```json
{ "source": "/((?!api/|@)[^.]*)", "destination": "/index.html" }
```

`[^.]*` excludes anything with a file extension (`/src/main.tsx`, `/node_modules/.vite/deps/*.js`,
`/logo.png`, and production's `/assets/*.js`), and the `@` alternation excludes Vite's own `/@vite/client`
and `/@react-refresh`, which carry no dot. Extensionless paths — the only shape an app route can have —
still fall through to `index.html`, so **production behaviour is unchanged**: every path that reached the
SPA fallback before still reaches it.

Worth knowing that this app has no client-side router at all (`App.tsx`'s status switch, decision 1), so
the fallback currently protects exactly one route, `/`. It is kept because Phase 8's shareable deck URL
is the first thing that could need it.

**End-to-end verification, finally done (2026-08-05, Chrome, `npx vercel dev`):** clicking the Rock
Classics suggestion filled the box with the full `open.spotify.com/playlist/...` link, `/api/playlist`
returned 100 cards with `truncated: true` (so the truncation notice fired, as documented), the preparing
screen counted years, the card-1 gate opened into the game screen with "99 cards left", the QR rendered,
and a flip revealed a year with its confidence label. **The unflipped card's text content carried no
title, artist or year** — the leak assertion holds in a real browser, not just in jsdom.

One quality observation, not a defect and not fixed: the first card resolved "Psycho Killer - 2005
Remaster" to **2025** with `low` confidence, which the UI correctly labels "Unconfirmed year". The real
release is 1977 — MusicBrainz matched a recent reissue. The confidence plumbing behaved exactly as
designed; the ranking is a separate question and belongs with the year-resolution work, not here.

---

## 2026-08-06 — Measured contrast ratios for every colour pair in the app (re-audited for the Phase 8 ring)

**This table REPLACES the one Phase 7 recorded on 2026-08-05, and replacing it rather than appending
a second one is deliberate** (Phase 8 plan 1, step 6): two tables describing different builds is
worse than one, because the reader cannot tell which build they are looking at. The Phase 7
narrative below the table survives intact, because **not one token Phase 7 introduced changed value**
— what changed is that there are now more of them.

Computed by converting the `oklch()` token values to sRGB and applying the WCAG 2.x
relative-luminance formula — not eyeballed, and not read off a devtools panel. The calculator was
validated by reproducing **all 16** of Phase 7's independently-computed ratios to the last recorded
digit before any new value was measured with it.

> **One thing about the method is worth writing down, because getting it wrong is optimistic rather
> than merely wrong.** Alpha compositing — `--opacity-disabled` on text, `warning-surface/40` on the
> notice — must be done on **gamma-encoded sRGB** channel values, which is what CSS does. Compositing
> in linear light instead put `--color-fg` at `--opacity-disabled` over `--color-surface-raised` at
> **8.72:1** against the true **5.94:1**. That is a two-and-a-half-stop error in the direction that
> makes a failure look like a pass, and Phase 7's recorded numbers are what caught it.

| Foreground                             | Background                     | Ratio    | Verdict                                |
| -------------------------------------- | ------------------------------ | -------- | -------------------------------------- |
| _1.4.3 — text on the page_             |                                |          |                                        |
| `--color-fg`                           | `--color-page`                 | 18.15    | pass                                   |
| `--color-fg-secondary`                 | `--color-page`                 | 7.63     | pass                                   |
| `--color-fg-muted` (HUD, hints)        | `--color-page`                 | 6.12     | pass                                   |
| `--color-danger` (landing error)       | `--color-page`                 | 6.84     | pass                                   |
| _1.4.3 — text on a control surface_    |                                |          |                                        |
| `--color-fg` (input, buttons)          | `--color-surface`              | 16.42    | pass                                   |
| `--color-fg-muted` (placeholder)       | `--color-surface`              | 5.54     | pass                                   |
| `--color-fg` at `--opacity-disabled`   | `--color-surface`              | 6.54     | pass                                   |
| `--color-fg` at `--opacity-disabled`   | `--color-surface-raised`       | 5.94     | pass                                   |
| _1.4.3 — the HIDDEN card face_         |                                |          |                                        |
| `--color-fg` ("Scan to play…")         | `--color-surface`              | 16.42    | pass                                   |
| _1.4.3 — the REVEAL card face_         |                                |          |                                        |
| **`--color-fg-year` (the year, 60px)** | `--color-surface-raised`       | 11.30    | pass — **new**, needs 3:1 (large)      |
| `--color-fg` (title, 20px semibold)    | `--color-surface-raised`       | 13.86    | pass                                   |
| `--color-fg-secondary` (artist, 16px)  | `--color-surface-raised`       | 5.83     | pass                                   |
| `--color-fg-heading` ("Year unknown")  | `--color-surface-raised`       | 10.20    | pass                                   |
| `--color-warning` ("Unconfirmed year") | `--color-surface-raised`       | 10.45    | pass                                   |
| `--color-fg-decorative` (`····`)       | `--color-surface-raised`       | 1.94     | **exempt** — `aria-hidden` decoration  |
| _1.4.3 — filled controls_              |                                |          |                                        |
| `--color-on-accent`                    | `--color-accent`               | 5.40     | pass                                   |
| `--color-on-accent`                    | `--color-accent-hover`         | 8.03     | pass                                   |
| `--color-on-danger`                    | `--color-danger`               | 6.84     | pass                                   |
| `--color-on-danger`                    | `--color-danger-hover`         | 10.30    | pass                                   |
| `--color-danger` (exit glyph)          | `--color-surface-raised`       | 5.23     | pass                                   |
| _1.4.3 — the notice banner_            |                                |          |                                        |
| `--color-warning-text`                 | `warning-surface/40` over page | 14.71    | pass                                   |
| `--color-warning-glyph` (Dismiss ✕)    | `warning-surface/40` over page | 10.68    | pass                                   |
| _1.4.11 — the focus ring, needs 3:1_   |                                |          |                                        |
| `--color-focus-ring`                   | `--color-page`                 | 18.15    | pass                                   |
| `--color-focus-ring`                   | `--color-surface`              | 16.42    | pass                                   |
| `--color-focus-ring`                   | `--color-surface-raised`       | 13.86    | pass                                   |
| `--color-focus-ring`                   | `--color-border-strong`        | 9.53     | pass                                   |
| `--color-focus-ring`                   | `--color-accent`               | 3.36     | pass — narrowly                        |
| `--color-focus-ring`                   | `--color-danger` (End game)    | **2.65** | **exempt** — see below. Newly surfaced |
| _1.4.11 — the neon ring, decoration_   |                                |          |                                        |
| `--color-ring-from` (green)            | `--color-surface`              | 13.39    | pass                                   |
| `--color-ring-via` (cyan)              | `--color-surface`              | 11.84    | pass                                   |
| `--color-ring-to` (magenta)            | `--color-surface`              | 4.90     | pass                                   |
| `--color-ring-from` (green)            | `--color-surface-raised`       | 11.30    | pass                                   |
| `--color-ring-via` (cyan)              | `--color-surface-raised`       | 9.99     | pass                                   |
| `--color-ring-to` (magenta)            | `--color-surface-raised`       | 4.13     | pass — the worst of the three stops    |
| `--color-ring-dim` (the backs)         | `--color-page`                 | 4.23     | pass — was **1.31**, see below         |

**The audit found one pair nobody had measured, and it is the same lesson Phase 7 recorded.** Phase 7
wrote "two of the four failures were not on the plan's list… that is the argument for computing
everything". This time the pair is **`--color-focus-ring` on `--color-danger` at 2.65:1** — the
focused state of `ExitConfirmDialog`'s filled **End game** button. It is not a Phase 8 regression: the
filled danger button landed with the exit-confirmation work on **2026-08-05**, _after_ Phase 7's table
was computed, so nothing had ever measured it. Recomputing every pair rather than only the changed
ones is what surfaced it.

**Why it is exempt rather than fixed.** `focus-ring` is `outline: 2px solid …` with
`outline-offset: 2px`, so the outline is painted **entirely in the 2px gap outside the button's border
box** — and that gap shows the dialog panel's `--color-surface`, against which the ring is 16.42:1.
The danger fill is not adjacent to the outline; a 2px band of the panel colour separates them, which
is what WCAG 1.4.11 asks for. The 2.65:1 figure is a pair that **is never rendered adjacently**. The
same reasoning is what Phase 7 already noted for the 3.36:1 accent row, which passed anyway.
**This is worth stating rather than leaving implicit, because the obvious "fix" is wrong:** the ring
is one colour app-wide by decision, and no single colour can clear 3:1 against both a near-black page
and a light red fill — darkening it to pass on danger would fail it on all three surfaces, which is
where the ring actually spends its time.

**`--color-fg-decorative` re-confirmed at 1.94:1.** Step 6 required re-checking the exemption under
the new palette rather than assuming it. It holds, and trivially: the exemption depends on
`--color-surface-raised`, which did not move, so the ratio is unchanged to the digit. It remains the
`····` pending glyph only, `aria-hidden`, beside a text line that carries the whole meaning.

**One row IMPROVED without being a listed target.** The stack's peeking backs were
`border border-border` — `oklch(26.9%)` on the page, **1.31:1**. The cue telling a player there is
more deck to come was very nearly invisible, and it had never been measured because a decorative
border is not something 1.4.3 covers and 1.4.11 does not reach either. `--color-ring-dim` puts it at
4.23:1. Nothing required this; the audit simply made it visible.

**The Phase 7 narrative, still accurate, on why three of these values are what they are:**

- **`--color-fg-muted: oklch(65% 0 none)`** replaces both `neutral-500` and the `neutral-600`
  placeholder. One token, because the two roles share the binding constraint: it has to clear 4.5:1 on
  the page (6.12), on a card face (5.54) **and** on a control surface (4.67). Tailwind's neutral scale
  jumps 55.6% to 70.8% with nothing between, and `neutral-500` fails on `neutral-900` (3.79) while
  `neutral-400` is as bright as the label text it sits under — so this is a custom lightness rather than
  a palette shade. **The minimum passing lightness is 60% on `neutral-900` and 64.5% on `neutral-800`**;
  65% is the first round number clearing both.
- **`--color-on-accent: oklch(14.5% 0 none)`** (the value of `neutral-950`) replaces `text-white` on the
  primary buttons: 5.40:1 at rest, 8.03:1 on the `emerald-500` hover. The **backgrounds are unchanged**,
  which is what makes this the smallest possible fix — `emerald-700` with white would have passed too
  (5.37) but would have forced the hover state _darker_ than the resting one to keep passing, which is
  backwards.
- **`--opacity-disabled: 0.6`** replaces `disabled:opacity-40`: 5.94:1. `0.5` also passes (4.59) but with
  no margin.

**The focus ring** is one colour for the whole app, `oklch(97% 0 none)`, picked against the lightest
surface it must clear. An emerald ring was the obvious alternative and is wrong for exactly one
reason: it would be nearly invisible on the emerald button.

**The four values Phase 7 corrected, for the record**, since the failing ratios no longer appear
above: the placeholder was `neutral-600` on `neutral-900` at **2.30:1** (the worst in the app),
`white` on `emerald-600` was **3.67:1** on the primary action, `neutral-100` at `opacity-40` on
`neutral-800` was **3.46:1**, and `neutral-500` on `neutral-950` was **4.18:1** at `text-xs`.

---

## 2026-08-05 — `aria-label` on an input with a visible label is a WCAG 2.5.3 failure, not a belt-and-braces improvement

The landing screen's URL input carried **both** a wrapping `<label>` with a visible `Playlist link` span
**and** `aria-label="Spotify playlist link"`. That looks like redundant helpfulness. It is a defect:

- **`aria-label` wins.** It overrides the label element entirely, so the accessible name was
  "Spotify playlist link" while the visible text said "Playlist link".
- **That fails WCAG 2.5.3 (Label in Name)**, which requires the accessible name to contain the visible
  label text.
- **It breaks speech control outright.** "Click Playlist link" matches nothing, because the only name the
  browser knows is one the user cannot see.

**The general trap, worth carrying beyond this repo:** `aria-label` is not additive. Reaching for it on an
element that already has a visible label _removes_ information rather than adding it. The rule of thumb is
that `aria-label` belongs only on controls with **no** visible text — which in this app is exactly the
three icon-only card controls and the notice's dismiss glyph, all of which correctly have one.

The fix was deleting the attribute; the wrapping label already supplied a correct name. **Ten test queries
across `LandingScreen.test.tsx` and `App.test.tsx` used `getByLabelText('Spotify playlist link')` and all
ten failed**, which is the shape this defect takes when it is fixed: the tests had been asserting the
wrong name because they were written against the same misconception.

Related and fixed at the same time: `aria-invalid` was set with no `aria-describedby`, so the _reason_ for
the error was announced once by `role="alert"` and then unreachable. A player who tabbed back to the field
heard "invalid" and no explanation.

---

## 2026-08-05 — The card flip was silent to assistive technology, and the fix looks exactly like the leak the app forbids

Found while auditing Phase 6's components. A keyboard or screen-reader player pressed Space,
`CardRevealSide` mounted, and **nothing was announced**. The payoff of the entire game — the year — was
available to an eye and to nothing else. A card with a QR code and no audible reveal is not a game a
screen-reader user can play at all.

The fix is a polite live region (`role="status"`) wrapping the year, title and artist. **This is the one
place in the app where announcing track data is correct**, and it is worth stating plainly because it
superficially resembles the leak every other surface is built to avoid:

- `CardRevealSide` is mounted **only** while the card is flipped (`Card.tsx`'s DOM-presence rule). There
  is no unflipped card on which the region exists, so there is nothing for it to announce early.
- Anywhere else it would be the leak. `CardHiddenSide`, `CardStack`'s backs and the HUD are all live
  _while the card is a mystery_. `CardHiddenSide.test.tsx` now asserts the absence of any live region for
  that reason, alongside the existing text-and-attribute leak assertions.
- Polite, not assertive: the reveal was requested, so interrupting the screen reader mid-sentence would be
  rude about news the player asked for.

**The generalisable point:** the leak rule is about _DOM presence while the card is unflipped_, and it is
`Card.tsx`'s conditional mount that enforces it. Once that is understood, "announce the reveal" and "leak
nothing" stop being in tension. A future reader who files this live region as a bug will be reasoning from
the rule without the mounting condition.

---

## 2026-08-05 — jsdom 30 has no `window.matchMedia` at all, and Motion 12 does not care

Phase 7 plan 1's first open question was whether `<MotionConfig reducedMotion="user">` needs a
`matchMedia` stub under jsdom. The plan assumed "jsdom does implement it; whether Motion's listener
registration is happy with jsdom's implementation is the thing to check". Measured:

- **`window.matchMedia` is `undefined`** under jsdom 30 / Vitest 4.1. Not a partial implementation — the
  property does not exist. (`window === globalThis` there, and neither has it.)
- **Motion 12.43 tolerates its absence.** `MotionConfig reducedMotion="user"` wrapping a `motion.div`
  with `drag` inside an `AnimatePresence` renders without throwing; Motion guards the lookup and resolves
  the preference as "not set".
- **So no stub is needed anywhere** — not in `Card.test.tsx`, not in the other jsdom files, and
  emphatically not in a global `setupFiles`, which `toolchain.md` §5 records as deliberately absent.

`Card.test.tsx` carries a focused test asserting both halves, because `src/main.tsx` is where
`MotionConfig` lives and **nothing in this repo renders `main.tsx`** — `App.test.tsx` renders `<App />`
directly. Without that test a Motion or jsdom upgrade turning tolerance into a throw would be discovered
in a browser.

**The consequence to remember:** because the preference can never read as "reduce", **no jsdom test in
this repo can observe reduced-motion behaviour**. That is the same wall the CSS side hits — jsdom
evaluates no media queries — and it is why `src/index.css.test.ts` is a labelled text canary rather than a
behaviour test.

---

## 2026-08-05 — Two ways of reading a sibling file inside Vite both fail, and the tidier one fails silently

Hit while writing the reduced-motion CSS canary, which needs `src/index.css` as text. Both obvious
approaches are wrong, and the failure modes are worth knowing before the next test needs a fixture file.

**`import css from './index.css?raw'` returns an empty string.** Vitest's `test.css` option defaults to
`false`, so CSS modules are replaced with empty stubs — `?raw` included. Assertions over `''` mostly pass
vacuously; only a `not.toBeNull()` pair failed, which is the sole reason this was caught rather than
committed as a green test checking nothing.

**`readFileSync(new URL('./index.css', import.meta.url))` throws `TypeError: The URL must be of scheme file`.**
Vite has a dedicated transform for the `new URL(<string literal>, import.meta.url)` pattern: it treats it
as an **asset reference** and rewrites it to the asset's served URL, which is not a `file:` one. This is
the standard ESM idiom for locating a sibling file, and it is precisely the one that cannot be used inside
a Vite project. Note that a **bare** `import.meta.url` is untouched and is a normal `file:///…` URL — it
is the literal-first-argument form that triggers the rewrite.

**What works:** take the bare URL apart with `node:path`.

```ts
readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');
```

`node:*` imports typecheck fine under `tsconfig.app.json` despite its `"types": ["vite/client"]` — that
option limits automatically-included _global_ declarations, not explicit module resolution.

---

## 2026-08-05 — Tailwind v4 harvests utility class names out of prose, and this repo's comments are enormous

Discovered while accounting for the CSS bundle's growth in Phase 7 plan 1 step 13. Tailwind v4's automatic
content detection scans every non-gitignored file, **markdown included**, and its extractor takes any
candidate-shaped token — so a class name written in a sentence generates real CSS.

Measured on the Phase 6 baseline, with no source changes at all:

| Build                           | CSS      | gzip    |
| ------------------------------- | -------- | ------- |
| as committed                    | 16.90 kB | 4.24 kB |
| with `@source not "../**/*.md"` | 15.18 kB | 3.98 kB |

**1.72 kB — about 10% of the stylesheet — was generated purely from prose in `AGENTS.md` and `docs/`.**
The utilities it produces are unreferenced by any component: `.select-none`, `.ring`, `.filter`,
`.underline`, `.collapse`, `.resize`, `.container`, `.max-w-sm`, `.w-72`, `.duration-500` and so on. Some
come from documentation genuinely discussing utilities; others from ordinary English words that happen to
be Tailwind utility names ("transition", "transform", "visible", "hidden", "block", "static", "table",
"inline", "grow", "shrink").

The same effect operates inside `src/` — the Phase 7 comments that name the _old_ utilities they replaced
each keep a dead rule alive, and drag the default theme variables they reference along with them.

**Deliberately not fixed.** A one-line `@source not "../**/*.md";` in `src/index.css` reclaims the 1.72 kB
and was measured to work, but CSS bundle size belongs to `plan.phase-7-robustness.md` (bundle splitting
and the Lighthouse pass), and this repo's house style values those comments highly enough that mangling
them to dodge a scanner would be the wrong trade. **Recorded so plan 2 starts with the number rather than
the investigation** — and so nobody reads the Phase 7 CSS growth as being entirely tokens.

---

## 2026-08-05 — Vitest's per-file environment tag is matched in PROSE, so a comment saying "not a jsdom test" makes it one

Found while documenting the Phase 7 test layout. `src/index.css.test.ts` was written as a `node` test —
it reads a stylesheet as text and needs no DOM — and its header said so explicitly:

> A `node` test, with no `@vitest-environment jsdom` docblock.

**That sentence made it a jsdom test.** Measured: `typeof window` was `object` inside it, and the
`environment` timing was 3.08 s. Vitest locates the per-file environment by scanning the file's leading
comment for the tag and does not care whether what it finds is a directive or a description of one.

**A rewrite that merely _quoted_ the old wording did not fix it either** — the explanation of the bug
reintroduced the bug, because the literal token was still in the comment. The token has to be **absent**;
refer to the tag descriptively instead. After that, `typeof window` is `undefined` and `environment` is
`0ms`.

**Why this matters beyond three wasted seconds.** The `node` default is deliberate and load-bearing: it
is what makes a DOM API accidentally added to `shared/` — which is compiled into Vercel Functions — fail
a test run instead of breaking at deploy time (`toolchain.md` §5). A comment is enough to defeat that,
silently, in a repo whose house style is very large header blocks.

Two practical consequences:

- **`grep -rl` for the tag over-reports the jsdom file count.** It matched 16 files when 15 had a real
  docblock.
- **The honest way to check one file is the `environment` timing** in `--reporter=verbose`: `0ms` for
  node, seconds for jsdom. Or assert it — `expect(window).toBeUndefined()` in a node file is a one-line
  canary if it ever matters.

---

## 2026-08-05 — An unknown Tailwind colour utility emits nothing, and all four checks pass either way

Shipped during Phase 7 and caught by eye afterwards, not by tooling. `CardHiddenSide.tsx` read:

```tsx
<p className="text-xs text-text-muted">Scan to play the full song</p>
```

The token had been renamed from `--color-text-muted` to `--color-fg-muted` partway through the work (so
the utility would read `text-fg-muted`), and the rename was applied to `src/index.css` by script while
this one call site kept the old name.

**Tailwind emitted no rule for `text-text-muted`.** Not a warning, not a build error — an unrecognised
utility is simply skipped. With no colour set anywhere up the chain (a `bg-surface` face, no `text-*` on
`GameScreen`'s `<main>`), the only text on the card's hidden face fell back to the UA's near-black
default **on a near-black card**. Effectively invisible.

**Every local check was green**: `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. There is
nothing in this toolchain that can catch it — a class name is a string as far as TypeScript and ESLint
are concerned, and no test asserted a colour on that element.

**Mitigations, in order of usefulness:**

1. **Grep the built CSS after adding or renaming a token.** `grep -o '\.text-fg-muted{[^}]*}' dist/assets/*.css`
   — an absent rule is the whole signal. This is also how `@theme static` was verified to emit the
   un-namespaced tokens.
2. **Assert the class family in the component's test.** `CardHiddenSide.test.tsx` now asserts the note
   carries a `text-fg*` utility, which is the one property distinguishing a real token from a
   plausible-looking string. Weak, and the only automatable guard.
3. **Rename tokens and call sites in one pass**, never a script over the stylesheet plus manual edits to
   components. The failure here was exactly that split.

The same hazard applies to every custom-token utility family in this repo — `bg-surface*`, `border-*`,
`text-fg*`, `max-w-content`, `text-year*` — and to the two `@utility` composites, though those at least
tend to be visibly missing rather than invisibly wrong.

---

## 2026-08-05 — `AnimatePresence mode="popLayout"` needs its child to accept a ref, and does nothing at all without one

The reported symptom was that a swiped card's replacement **rose up from below the screen** instead
of already sitting behind it. `CardStack` looked correct and said so in a comment:

```tsx
<AnimatePresence initial={false} mode="popLayout">
  <Card key={`${currentCard.id}:${currentIndex}`} ... />
</AnimatePresence>
```

`popLayout` exists to take the outgoing child **out of layout flow** so the incoming one keeps the
slot it is vacating. Motion implements it in `PopChild`:

1. `React.cloneElement(children, { ref: composedRef })` — it needs a handle on the DOM node;
2. `getSnapshotBeforeUpdate` measures `offsetTop` / `offsetLeft` / computed width and height;
3. a `useInsertionEffect` injects `[data-motion-pop-id] { position: absolute !important; ... }`.

Steps 2 and 3 are both guarded by `ref.current`. **`Card` was a plain function component that
accepted no ref**, so the cloned ref landed on nothing, `ref.current` stayed null, and the effect
returned early. No warning, no error, no visible configuration problem — `popLayout` was declared,
documented, and inert.

What that produced: the stack container is `position: relative` with a fixed size, and both cards
were then ordinary in-flow block children. The outgoing card sat at the top; **the incoming card was
laid out a full `--card-height` below it**, off the bottom of the deck and usually off the viewport,
until the exit animation finished and the old card unmounted — at which point the new one snapped up
into place.

The fix is one prop: `Card` accepts `ref?: Ref<HTMLDivElement>` and puts it on the outer
`motion.div`. React 19 passes `ref` to function components as an ordinary prop, so no `forwardRef`
is involved. It also restores the **paint order** the animation needs for free: once popped, the
outgoing card is a positioned element and so paints in a later layer than the in-flow card beneath
it, which is what puts the next card _behind_ the one sliding away rather than over it. No z-index
needed.

**Testability.** `Card.test.tsx` now pins the necessary half — the ref reaches the OUTER element,
not the inner flip wrapper. The sufficient half is unreachable in this repo: jsdom computes no
layout, so `getComputedStyle(el).height` is `auto`, `parseFloat` gives `NaN`, and Motion's own
measurement bails before it ever sets `data-motion-pop-id`. Any `AnimatePresence mode="popLayout"`
regression of this kind is a **browser check only**.

**Generalisation worth remembering:** every Motion feature that has to touch the DOM node of an
`AnimatePresence` child (`popLayout`, and layout animations through a wrapper component) requires
that child to forward a ref. A function component in between silently disables it.

---

## 2026-08-05 — `.click()` on a button whose handler sets React state does not flush before the next line

Four new `GameScreen` tests failed on `getByRole('button', { name: 'Keep playing' })` — the exit
confirmation dialog simply was not in the DOM — while the assertions around them were right.

The cause is which helper opens it. `element.click()` dispatches a real DOM event **outside**
Testing Library's `act()` wrapper, so a `setState` in the handler is scheduled but not necessarily
committed by the time the next statement queries the DOM. `fireEvent.click(element)` wraps the
dispatch in `act()` and the re-render has happened when it returns.

The existing audio presses in the same file use `.click()` and are fine, which is what made this
confusing: `play` / `pause` / `restart` go through a ref to the media element and change **no React
state**, so there is nothing to flush.

**Rule of thumb for this repo:** `fireEvent` for anything that changes React state; `.click()` is
only safe for a handler whose entire effect is a call on a mock or a ref.

---

## 2026-08-05 — Dropping yearless cards is a reducer change with a long tail, and a shared test stub hid most of it

The developer reversed the `confidence: 'none'` decision (see `plan.md` §6): a card whose lookup
finds no year is now REMOVED from the deck rather than played without one. The reducer edit is
contained; the consequences were not, and they are worth knowing before touching this again.

**1. The card-1 gate had to be rephrased.** It opened on "the resolved card WAS `deck[0]`". With
drops that condition opens the gate onto a _brand new_ first card whose lookup has not been
dispatched, so the player lands on the pending `····` slot. It is now a property of the deck —
`deck[0]?.year !== undefined`, evaluated against the NEXT deck — which also self-heals the
already-resolved-first-card hang that `START` needed its own guard for.

**2. `year: null` is not only "MusicBrainz has no year".** `resolver.ts` also settles at `null` on a
400 (`invalid-request`) and on transient failures that survive its deferred pass, and
`YEAR_RESOLVED` carries no reason. So a network blip now drops cards. Accepted deliberately: an
unplayable card is unplayable whatever the cause. The one blanket failure is exempt because it was
already modelled separately — `not-configured` dispatches `YEAR_LOOKUPS_UNAVAILABLE`, so a
deployment with no `MUSICBRAINZ_USER_AGENT` yields a yearless deck rather than an **empty** one.
That exemption is the difference between a misconfigured deploy being playable and being a blank
end screen, and it is asserted.

**3. Removing an element from the deck is an index problem, not a filter problem.** Cards dropped
from behind the player move `currentIndex` back; a dropped CURRENT card leaves the index alone (the
array closes up under it) but **must reset `isFlipped`** — that flag belongs to the card that left,
and carrying it over mounts the incoming card already revealed, which is a leak rather than a
glitch. A dropped current card with nothing after it ends the session, because clamping would send
the player backwards onto a card they have already played.

**4. A shared test stub turned one decision into eight failures.** `App.test.tsx`'s `stubYearApi()`
answered every lookup with `year: null` — chosen originally as "the minimum response that opens the
gate without inventing years". Post-reversal that stub _deletes the deck_: the session went straight
to `ended` and every test that only wanted to reach the game screen found the end screen. The stub
now returns a real year, with `stubDroppingYearApi` beside it for the drop path. When a decision
changes what a value MEANS, grep the test doubles for that value before assuming the failures are
regressions.

---

## 2026-08-06 — A suggested-playlist label with a bracket in it breaks a test that renders fine

`LandingScreen.test.tsx` queried each suggestion with `new RegExp(playlist.label, 'i')`. That was
safe for exactly as long as every label was alphanumeric. The replacement set added **"This is Duki
(all songs)"**, and the parentheses became a capture group: the pattern matched `This is Duki all
songs`, which appears nowhere, so `getByRole` threw on a button that renders perfectly. The failure
reads as a missing button and is not one.

A plain string is not the fix — the accessible name of a suggestion is the label **and** the blurb
concatenated, so an exact-string `name` never matches either. The test now escapes the label before
building the pattern, via a `suggestionButton()` helper. Any test that builds a `RegExp` out of
**content** rather than out of a literal has this bug latent in it; the labels are the only content
in this repo a user is likely to change.

## 2026-08-06 — Re-verifying a playlist id needs `entity.name`, and four of the nine hit the track cap

The nine ids now in `SUGGESTED_PLAYLISTS` were verified against
`https://open.spotify.com/embed/playlist/{id}` by parsing `__NEXT_DATA__` and reading
`props.pageProps.state.data.entity` — `uri` and `name`, per the discipline `plan.md` §5 sets. All
nine resolve to the intended playlist. Two things worth recording:

**1. Four of the nine return exactly `MAX_EMBED_TRACKS`.** Éxitos Verano, Radio BrianPer, Electro
Latino and This is Duki all come back with 100 tracks, so four of the suggestions raise the
truncation notice by design — up from three under the Phase 0 set. Counts in list order: 100, 40,
100, 100, 50, 100, 50, 50, 50.

**2. Preview coverage is worse than the Phase 0 sample.** Electro Latino is missing
`audioPreview.url` on 2 of 100 and This is Duki on 8 of 100 — 10 preview-less tracks across the set
against Phase 0's 2 in 400. The `noPreviewCard` path is a card a player will now actually meet
rather than a 0.5% edge case.

The one-off script is not kept: it is twenty lines against a documented shape, and a stale copy in
the repo would be re-run against a payload it no longer matches.

## 2026-08-06 — An empty playlist told the player it was our bug, and no layer upstream owned the case

`src/game/playlist-client.ts` rejected an empty `cards` array in the same branch as a malformed one:
`if (!Array.isArray(rawCards) || rawCards.length === 0) return undefined`, which became
`unexpected-payload` — _"Spotify returned something we could not read. This is a problem on our side,
not with your link."_ The payload was perfectly readable and said, correctly, that there is nothing to
play. A confidently wrong diagnosis, which is worse than a vague one.

**It is reachable in production, and this is the part worth recording**, because the tempting
assumption is that the server would have caught it. It does not.
`api/_lib/spotify-embed.ts:168` requires only that `entity.trackList` be an **array** — an empty one
passes — and then builds `cards` by filtering it, so `cards: []` with `ok: true` is a legitimate
adapter result. `api/playlist.ts` copies the adapter's four fields into a 200 with no length check.
Two real inputs land there: a genuinely empty public playlist, and one whose every track was
unplayable, since `skippedCount` reaching the raw track count leaves `cards` empty too. **The client
owns the case, and it is the only layer that does.**

Fixed by splitting the branch and giving the empty case its own code (`empty-playlist`). The copy has
to fit both inputs, so it says "no tracks this app can play" rather than "is empty" — telling the
second player their playlist is empty sends them to check a link that is fine.

## 2026-08-06 — `motion` was a third of the bundle, and the landing screen downloaded all of it

Attribution method, since the repo has no bundle analyser and adding one was not worth a dependency:
build with `--sourcemap`, decode the VLQ `mappings`, and charge the generated bytes between one
segment and the next to the source the first segment names. Aggregating by package gives a
module-level breakdown out of the build's own output.

The single 373.39 kB chunk, measured before any change:

| bucket                                                         |         kB |     share |
| -------------------------------------------------------------- | ---------: | --------: |
| `react-dom`                                                    |     178.16 |     48.0% |
| **`motion-dom` + `framer-motion` + `motion-utils` + `motion`** | **125.16** | **33.7%** |
| **`qrcode` + `dijkstrajs`**                                    |  **23.28** |  **6.3%** |
| `src/components/`                                              |      15.49 |      4.2% |
| `src/game/`                                                    |      12.57 |      3.4% |
| `react` + `scheduler`                                          |      11.38 |      3.0% |
| `src/hooks/`, `src/` root, `shared/`                           |       5.30 |      1.4% |

`motion` is imported by exactly two files, `Card.tsx` and `CardStack.tsx`, both below `GameScreen` —
so a third of the JavaScript on the landing screen was an animation library for cards that had not
been dealt. Split at `GameScreen` with `React.lazy`, fallback = the preparing screen (`playing` is
only ever entered from `preparing`, so a chunk in flight leaves the player on the screen they are
already looking at). `qrcode` went behind a dynamic `import()` inside `QrCode.tsx`'s existing effect,
which needed no `Suspense` because the same-size placeholder already covered an async window.

**Landing screen: 373.39 kB → 218.52 kB raw, 119.92 → 70.27 kB gzip (−41.4%).** Verified in
Lighthouse's own network log that neither the `GameScreen` chunk nor the qrcode chunk is requested on
the landing screen — the entry HTML preloads only the runtime and a shared helper.

Note that `MotionConfig` in `main.tsx` keeps a handful of framer-motion **context** modules eager
(they are most of the 11.68 kB `preload-helper` chunk), but the 177-module `motion-dom` animation
engine moved. Verified per chunk from the source maps rather than inferred from the totals — so do
not "finish the job" by moving `MotionConfig` into `GameScreen`; there is almost nothing left to win
and plan 1 put it around the whole tree deliberately.

**There is no audio code to lazy-load**, despite the checkbox reading "lazy-load QR/audio code".
`useCardAudio` is a hook over a native `<audio>` element with no dependency behind it, and the
element already carries `preload="none"`. Recorded because the wording will send the next reader
looking for the audio half.

## 2026-08-06 — Two concurrent `import()` calls for the same module: the second continuation never runs

Found while moving `qrcode` behind a dynamic import. `QrCode.tsx`'s effect re-runs per card, so a
bare `import('qrcode')` in its body issues a fresh import call per advance — and two overlap whenever
a card is superseded before its code resolves, which is exactly the fast-advance race the component's
generation counter exists for.

With two imports in flight at once, **the second one's `.then` never ran.** Symptom: the new card
kept the previous card's placeholder forever. The existing staleness test failed in a way that looked
nothing like the cause — it rendered a **real** QR PNG from an unmocked `qrcode`, while every other
test in the same file got the mock. Reduced to a minimal probe: two renders, one
`mockImplementationOnce` returning a pending promise, and `toDataURL` was called **once**, for the
first URL only.

Fixed by memoizing the import at module scope (`loadQrcode()`), which is better production code
regardless: one shared promise for every card instead of one call per advance. A rejected load stays
cached deliberately — a chunk that failed to fetch will fail again, and retrying per advance would be
a request loop on the flaky connection that broke it.

**The consequence for tests:** a settled promise cannot be un-settled, so the library-fails-to-load
case cannot live in a file whose other tests load the library successfully. Flipping a flag plus
`vi.resetModules()` **silently asserts against a working library** — the mocker hands back the module
it already built, the import succeeds, and the test passes for the wrong reason. It now has its own
file, `QrCode.load-failure.test.tsx`, whose mock factory always throws.

Separately: `vi.mock` intercepts by specifier rather than by import **form**, so the existing module
doubles needed no restructure for the move to `import()`. Only timing changed — generation no longer
begins synchronously inside the effect, so `CardStack.test.tsx` had to await a
`toHaveBeenCalledTimes(1)` that used to read correctly on the same tick.

## 2026-08-06 — A `React.lazy` boundary can turn Vite's first-time transform cost into a test flake

`App.test.tsx` failed on exactly one of sixteen tests after `GameScreen` went behind `React.lazy` —
the **first** one to reach `playing`. The fifteen after it passed. The failure was a `waitFor` timeout
on the HUD, which reads as a broken game screen and is not one: that first test pays Vite's
first-time transform of ~250 `motion` modules **inside** a `waitFor` whose default timeout is one
second, and every later test runs against the now-warm module cache.

Two things make this worth recording. It is **order-dependent** — it would have moved to whichever
test happened to run first — and the suite's own timings show why the margin is thin: `import` time
across a full run is measured in the **hundreds of seconds** (104–113 s observed this session), and
environment setup has been seen to vary from 56 s to 345 s.

Fix: `beforeAll(async () => { await import('./components/GameScreen') })`. It moves the cost outside
every timeout, asserts nothing, and is not a substitute for the real check — that the chunk is
**absent** from the landing screen, which is verified in the build output and in Lighthouse's network
log. Any future `lazy` boundary above a heavy dependency needs the same warm-up in whichever suite
drives it.

## 2026-08-06 — First Lighthouse pass, and a 1.26 MB favicon nobody was looking for

Landing screen, production build under `vite preview`, Lighthouse 12.8.2, headless Chrome:
**Performance 75 · Accessibility 100 · Best Practices 100 · SEO 100.** FCP 1.5 s, LCP 7.8 s, TBT
0 ms, CLS 0. The game screen was **not** audited and cannot be locally — `vite preview` serves no
`/api`, so Start fails with `unexpected-payload` and the screen is unreachable.

Three conclusions:

**1. SEO was 91 for a finding that was a `vite preview` artifact.** "robots.txt is not valid", with
the parser choking on `<!doctype html>`: the preview server answers every unmatched path with the SPA
shell at 200 `text/html`, including `/robots.txt`. Production would not have — `vercel.json`'s
rewrite is `/((?!api/|@)[^.]*)` and the `[^.]*` excludes any dotted path, so production 404s it,
which is valid to a crawler. Added `public/robots.txt` anyway, since it makes the two environments
agree and lets `/api/` be disallowed (a crawler hitting `/api/year` spends MusicBrainz budget shared
by every user of the app). **The general lesson: do not treat `vite preview` as production for
anything served outside `/assets/`.**

**2. Performance 75 is entirely LCP.** TBT is 0 ms and CLS is 0. The LCP element is the landing
tagline, which cannot paint until React mounts, so under simulated slow 4G it is gated on the entry
chunk. Prerendering or an inline static shell is the fix and both are Phase 8.

**3. `public/logo.png` is 1,262,175 bytes at 1254×1254, served as the favicon on every visit.** That
is **6× the entire JS payload** of the landing screen and **50× the saving** from the qrcode chunk
split. **No audit fails on it**, because a favicon is not render-blocking — which is precisely why it
survived seven phases unnoticed, and why the bundle work above looks more significant than it is next
to one unoptimised image.

> **CORRECTION, same day — and the correction matters more than the finding.** Point 2 above was
> **wrong**, and it was wrong in a way worth studying: it concluded that LCP 7.8 s was architectural
> (the tagline cannot paint until React mounts, so prerendering, so Phase 8) and recorded the favicon
> separately as a Phase 8 asset item. The two were the same problem. On developer instruction the PNG
> was replaced with a **240×240 WebP of 20,610 bytes** — a 98.4% reduction, **no code touched** — and
> the same page went from **Performance 75 / LCP 7.8 s** to **Performance 99 / LCP 1.6 s**, with total
> transfer down from ~1.36 MB to **98.7 kB**. The 1.26 MB favicon had been saturating the simulated
> slow-4G link and delaying every paint behind it, LCP element included.
>
> **The transferable lesson: "LCP is gated on React mounting" is a conclusion that sounds correct for
> any client-rendered SPA**, which is exactly what made it easy to accept without reading the rest of
> the network log. The log was already in hand — the favicon is in the request list quoted above,
> 1,262,446 bytes, right there next to the JS. Read what is on the wire before blaming the
> architecture. Prerendering and a static shell are Phase 8 ideas again, not owed fixes.
>
> The icon is now `public/logo.webp` with `type="image/webp"` and **no PNG fallback**: every browser
> that can run this app reads a WebP favicon, and a second `<link>` would add a request whose only
> purpose is a tab icon elsewhere. If one is ever needed, add a _small_ PNG.

## 2026-08-06 — A yearless deck showed "Deck finished" over a count of zero

Developer instruction, after Phase 7 plan 2 closed: an empty playlist **or** a playlist where no card's
year could be found must warn and return to the landing screen.

The empty-playlist half needed nothing — `empty-playlist` is a fetch failure, so the session never
starts and the landing screen renders the warning in its existing slot. The other half was a real
defect. A card whose year lookup finds nothing is **removed** from the deck (the 2026-08-05 reversal),
so a playlist MusicBrainz cannot place drains to zero and `YEAR_RESOLVED` moves the session to `ended`.
That was correct. What was wrong is that `ended` meant the **end screen**, which rendered
**"Deck finished"** over `cardsPlayed={state.deck.length}` — i.e. **0**. A completed game announced to
somebody who never saw a single card, with no hint as to why.

Fixed in the container, not the reducer: `deckCollapsed = status === 'ended' && deck.length === 0`.

**The condition is exact rather than heuristic, which is what makes it safe:** every other route to
`ended` leaves the played cards in the deck — natural exhaustion stops **on** the last card and Exit
does not empty anything — so an empty deck at `ended` can only mean there was never anything to play.
It is checked **before** `endedView`, which is still `'end-screen'` from the `START` that dealt the deck
and is not a destination the player chose. All three of the reducer's empty-deck exits land there:
`YEAR_RESOLVED`, `START` with nothing dealable, and `RESUME` of a pre-reversal save.

**The type decision is the part to preserve.** The warning needed a code, and `no-years-found` is
produced by the **session**, not by `fetchPlaylist`. It is deliberately **not** added to
`PlaylistClientErrorCode`: that union is the set of things the HTTP client returns and
`playlist-client.test.ts` enumerates exactly that, so widening it would make the client's own type
claim a code it cannot produce. Instead `messages.ts` — which already owns every sentence — owns
**`StartFailureCode = PlaylistClientErrorCode | 'no-years-found'`**, and the landing screen's one slot
takes that. One question ("why can't I play this playlist"), one answer slot, one copy map, no second
notice channel and no fifth view in `App.tsx`.

Two test notes. `App.test.tsx`'s existing case asserted `/deck finished/i` for exactly this scenario,
so **the old behaviour was pinned** — the test was rewritten, not added to. And both new container
tests must await the **alert**, not the landing input: the landing screen is already mounted at `idle`,
so `findByLabelText('Playlist link')` resolves on frame one and every assertion after it passes against
the pre-Start screen for the wrong reason. That cost one debugging cycle.

## 2026-08-06 — Re-spike: the embed payload still has no attribution field, two months on

Closing out `plan.md` §5's "Added by" bullet, which was blocked on data availability. Method as the
Phase 0 spike: fetch `https://open.spotify.com/embed/playlist/{id}`, parse `__NEXT_DATA__`, and
enumerate the **complete** field union across every `trackList` entry rather than reading the first
one. Identity confirmed by `entity.uri` **and** `entity.name`, not by a 200.

Playlists: `37i9dQZF1DX0XUsuxWHRQd` (RapCaviar, editorial, 50 tracks) and `2wJx2AIytvpaSJLsc2wy3V`
(Radio Brianper, user-owned, 100 tracks) — deliberately one of each, since an editorial playlist has
no meaningful "added by" and a user-owned one would.

**Track-level union is 15 fields and identical across both:** `uid`, `uri`, `title`, `subtitle`,
`duration`, `isExplicit`, `isPlayable`, `isNineteenPlus`, `playabilityReason`, `entityType`,
`contentRatings{labels}`, `audioPreview{url,format}`. **No attribution field of any shape**, and the
raw payload string contains none of `added_by`, `addedBy`, `addedAt`, `added_at`. Playlist level has
18 fields whose only attribution-shaped one is **`authors`, and it is `null` on both**.

So Phase 0's inventory holds. The bullet moved to Phase 8 with this evidence attached; **no UI was
built**, because building it requires a new auth path and that re-opens §2's no-credentials decision
— a product question about the audience, not a UI task.

Incidental, and **superseded on 2026-08-12** — the row it described has since left the set, and
`SUGGESTED_PLAYLISTS` labels are now explicitly readable renderings of Spotify's titles rather than
the titles verbatim, so a label that does not match `entity.name` character for character is the
design. Verify by `entity.uri` **and** `entity.name` against the _playlist_, never against the label.

### The procedure, so the third check is a re-run and not a redesign

Written out because this spike has now been run twice (Phase 0, then here) with the same answer, and
the thing that made the second run cost anything was that the first was recorded as a conclusion.
`plan.phase-8-added-by.md` resolves the item on this evidence; **re-run these five steps before
re-opening it**, not a fresh investigation.

1. **Pick two playlist ids: one editorial, one user-owned.** Not one of each _kind of music_ — one of
   each _kind of ownership_. An editorial playlist has no meaningful "added by" (Spotify added
   everything), so an absence there proves nothing on its own; a user-owned playlist is where the field
   would appear if it existed. A single sample is what makes this look answered when it is not.
2. **Fetch `https://open.spotify.com/embed/playlist/{id}` with a normal browser `User-Agent`** and pull
   the JSON out of `<script id="__NEXT_DATA__">`. Tracks are at
   `props.pageProps.state.data.entity.trackList`.
3. **Identity-confirm each fetch by `entity.uri` AND `entity.name`, never by the HTTP status.** A
   nonexistent id returns **200** with `pageProps.status: 404` and no `state`, and Phase 0's parallel
   fan-out silently read the wrong playlist twice by trusting the status code plus a shared filename.
   If the fetches are parallelised, give each one its own output filename.
4. **Enumerate the field union over EVERY `trackList` entry, then diff the two playlists' unions** —
   do not read entry `[0]`, and do not grep for one field name. The question is "what fields exist",
   not "does `added_by` exist"; a targeted search cannot see an attribution field under a name nobody
   guessed. Record the union, not a verdict.
5. **Also grep the raw payload string for the absence list**, as a second independent check that the
   parse did not drop something: `added_by`, `addedBy`, `added_at`, `addedAt`. All four absent
   2026-08-06. Then check playlist level for `authors` — present, and `null` on both playlists, which
   is the one field that could plausibly turn non-null without any API change.

**The result is only interesting if step 4's union grows or `authors` is non-null.** Anything else is
this same entry, and the item stays resolved on the grounds in `plan.md` §5 — which are about auth,
not about the payload.

## 2026-08-06 — The suite flake IS real and it reproduced: 15 files error, zero tests fail

Plan 2 recorded a red `pnpm test` run on 2026-08-05 — 13 errors with only 19 of 32 files completing —
then clean on two re-runs, and asked whether it was reproducible. **It is.** It happened once during
this session's step 13, and the shape matches almost exactly.

**The observed failure, and the signature to recognise it by:**

| Run                  | Files        | Tests                | Errors | `environment` time | `import` time |
| -------------------- | ------------ | -------------------- | -----: | -----------------: | ------------: |
| Bad run (2026-08-06) | 21 of 36 ran | 339 passed, 0 failed | **15** |         **12.2 s** |        13.6 s |
| Healthy runs (×6)    | 36 of 36     | 497 passed           |      0 |          337–378 s |     104–113 s |
| Bad run (2026-08-05) | 19 of 32 ran | (not recorded)       | **13** |                  — |             — |

**Two things identify it unambiguously, and both matter because the console output is alarming:**

1. **Zero tests FAIL.** The count is "errors", not failures — the files never ran, so nothing in them
   was asserted. A real regression names an assertion and a line; this names neither.
2. **`environment` time COLLAPSES** — 12 s against a healthy 340 s, roughly 28× lower. The jsdom
   environments did not run slowly and time out; they never initialised at all. That is why it looks
   catastrophic and takes 74 s instead of 45 s.

There are **17 jsdom files and 19 node-only files** of the 36. The 15 errors are most-but-not-all of
the jsdom set, and every completed file in the bad run was consistent with the node ones plus a
couple of jsdom stragglers — so it is a **per-file jsdom environment initialisation failure**, not a
resource ceiling hit at a fixed point, and not anything to do with the tests' content.

**It happened TWICE on 2026-08-06**, hours apart, with near-identical numbers — 21 of 36 files and 15
errors both times, 339 then 340 tests passing, zero failing on either. So the 19/32-and-13 shape from
2026-08-05 was not a one-off, and the ratio is stable: it is always the same ~15 files.

**Two hypotheses were tested and neither reproduced it**, which is worth recording so nobody repeats
the experiments:

- **CPU load.** Six concurrent `pnpm build` runs alongside a full `pnpm test`: clean, 36/36.
- **A cold transform cache.** The first occurrence came immediately after Prettier rewrote ten source
  files, which made "first run after a mass rewrite" the obvious suspect. Touching every `.ts`/`.tsx`
  under `src/` to invalidate the cache and running: clean, 36/36.

**One correlation survives both occurrences and is offered as a lead, not a cause:** each happened in a
shell invocation that ran `pnpm test` **chained with `pnpm build`** in the same command block, while ten
consecutive runs of `pnpm test` on its own — including four immediately after each failure — were clean.
That is consistent with build tooling and vitest's environment setup contending for something
process-wide, and it is _not_ the same thing as the CPU-load test above, which ran the builds as a
detached background job rather than in the same invocation. **Nobody should treat this as established
from two samples**; it is where to look next.

So the trigger is still unidentified, and the practical guidance is what it was — but now with real
evidence behind it rather than a single anecdote:

> **A red `pnpm test` whose summary shows `Errors` and zero failed tests is probably not real.
> Re-run before investigating.** Check the `environment` figure: if it is seconds rather than
> minutes, the jsdom files never started and nothing was actually tested.

The corollary is the uncomfortable one: **a green run does not prove the jsdom half ran.** It does
here, because the file and test counts are checked (36 and 497), but a `pnpm test` glanced at for its
exit code alone would have passed 339 tests and skipped every component test in the repo. The counts
are the thing to read.

## 2026-08-06 — Phase 4's stop-on-flip audio rule reversed: the preview now survives the reveal

Developer decision, executed as step 1 of
[`plan.phase-8-features.md`](./plans/plan.phase-8-features.md). **`GameScreen` had two stop rules and
now has one.** Audio stops when the CARD CHANGES and when Exit is confirmed; it no longer stops when
the card is flipped.

Why it is a deletion rather than a move — the part worth keeping, because a deleted rule with no
explanation is a rule someone restores:

- The flip rule's first justification was Phase 4's own: "once the answer is on screen the preview has
  no job left." Playing the game disagrees. **Hearing the song while reading the year is the point of
  the reveal**, and a flip that killed the music turned the payoff into silence.
- Its second justification — a lingering preview bleeding into the next card — is **already covered by
  the card-change effect**, which keys on `currentCard.id` rather than on `previewUrl` (so a
  duplicated track in the deck is covered too) and fires before the new `src` is set. That effect is
  also what makes a SWIPE stop the audio, which is why `useCardGestures` still knows nothing about
  audio.

So `wasFlippedRef` and its effect are gone, `useRef` left `GameScreen`'s import list, and **nothing
was added anywhere**. `CardControls` renders outside the card (the Phase 5 pointer-up bug fix), so
Play/Pause is reachable while the reveal is showing without any UI work — a player who wants silence
has a button for it.

Two things carry the reversal forward for the next session: `GameScreen.test.tsx`'s
`should not stop audio when the card is flipped` asserts `calls` is empty **and** that the `src` is
untouched, and the header block in `GameScreen.tsx` says why the rule went. The
stop-on-card-change and stop-on-exit tests passed unmodified, which is what confirms the right effect
was deleted.

**Not verifiable locally:** that the preview is actually still audible after a flip on a device. It
rides with the step 23 touch pass.

## 2026-08-06 — A mount-lifetime "already submitted" ref breaks the share link under StrictMode

Found while building the shareable deck URL (`plan.phase-8-features.md` step 7). The first version of
`App.tsx`'s link effect had the obvious guard:

```ts
if (deckLink === null || linkSubmittedRef.current) return;
linkSubmittedRef.current = true;
request(spotifyPlaylistUrl(deckLink.playlistId));
```

**Under React 19 StrictMode this deals no deck at all.** The sequence: effects run, the request goes
out and the ref is set; StrictMode then simulates an unmount, and `usePlaylist`'s own mount cleanup
**aborts the controller and nulls it**, so the in-flight response is later discarded by its own
staleness guard; effects re-run, the ref says "already submitted", and the app sits on the landing
screen forever with `requestState` stuck at `loading`. Development only, which is the worst place for
it — every local run of a shared link would look broken.

**The rule this yields:** in this codebase, an effect that starts work another hook cancels on cleanup
must not be guarded by a ref that survives the cleanup. Either reset the guard in the effect's own
cleanup, or have no guard at all — which is what `App.tsx` does now, because both of that effect's
dependencies (`deckLink` from a lazy state initialiser, `request` from a `useCallback([])`) are stable
by construction, so the body runs exactly once per mount. Production: one request. StrictMode: two,
with the first aborted — the same shape as the year resolver's double mount.

`App.test.tsx`'s `should read the link exactly once under StrictMode double rendering` is the
regression test, and note what it can and cannot assert: `parseDeckLink` is pure, so the number of
PARSES is unobservable and irrelevant. It asserts the deal — the deck arrives, with the link's seed —
and bounds the fetch count at two.

## 2026-08-06 — The saved-playlist library leaked on the WRITE side, not the read side

`savePlaylist(storage, entry)` originally stored the caller's object verbatim. `SavedPlaylist` is a
structural interface, and TypeScript's excess-property check **does not fire for a spread or for a
variable** — so `savePlaylist(storage, { ...somethingLarger })` type-checked and wrote every extra
field to `localStorage`. The store is read on the **landing screen**, which is the app's one
pre-start surface, so a caller who later passed a `PlaylistResult` would have put track titles one
devtools panel away from a player who had not started yet.

Caught by the module's own leak test (`should store nothing beyond id, name and timestamp`), which
smuggles a `cards` array past the type the way a spread would. The fix is a three-field rebuild at
the write, mirroring what `validateEntry` does at the read — the same reason `persistence.ts`'s
`validateSession` rebuilds instead of casting. **Validating only on read is not enough when the
store itself is the leak surface.**

## 2026-08-06 — PDF text: WinAnsi already covers Spanish, and the two cases that still bite

Measurements behind the sanitise-rather-than-embed decision (`plan.phase-8-features.md` step 18, open
question 3), all in `src/game/pdf-text.ts`:

- **WinAnsi (Latin-1 plus a punctuation block) covers every Spanish, Portuguese, French, German and
  Italian glyph** — `á é í ó ú ü ñ ¡ ¿ ç ã õ` all pass through untouched. Four of the nine suggested
  playlists are Spanish or Latin, so the common case is a **no-op**. That is what made embedding a
  200–400 kB font the wrong trade: it would fix Polish and Turkish while still failing on Cyrillic and
  CJK, which need a much larger font again.
- **A stroked or barred letter does not decompose.** `ż` → NFD → `z` + dot above, so stripping marks
  works. `ł`, `đ`, `ı`, `ħ`, `ŧ`, `œ` have **no combining mark at all**, so they fell through to `?`
  and printed Polish as `Zaz?c`. Fixed with a short hand-written fallback map; anything needing a
  judgement about a language stays `?`.
- **The filename needed a SECOND, stricter pass.** `sanitizeForPdf` correctly KEEPS `É` — WinAnsi can
  draw it — but a filename cannot, and the `[^a-z0-9]` slug filter then deleted it: "Éxitos Verano"
  became `hitster-xitos-verano.pdf`, silently missing the playlist's first letter. `pdfFileName` now
  strips marks before slugging.

What the player loses, and it is in `development.md` §8: a Cyrillic or CJK title prints as `?`
placeholders. **The year and the QR are unaffected** — digits are ASCII and the QR is an image — so
such a card still plays and still scans to the right track.

## 2026-08-06 — `dist/assets/qrcode-loader-*.js` is React glue, NOT the QR encoder

Step 22 verification, and a trap worth naming because the chunk's name invites exactly the wrong
conclusion. After `loadQrcode` moved to its own module (`src/game/qrcode-loader.ts`, shared by
`QrCode.tsx` and `usePdfExport`), Rolldown named the **shared vendor chunk** after it. That chunk is
10.81 kB, is `modulepreload`ed on the landing screen, and contains **React's JSX runtime** — it is
what used to be emitted as `preload-helper-*.js` (11.68 kB, likewise preloaded). It contains no
`toDataURL`, no `dijkstra` and no encoder. Preloaded bytes before: 12.58 kB; after: 12.90 kB.

**Verified in a real network log, not only in the build output** (Chrome against `vite preview`, hard
reload of the landing screen). Exactly six requests: the document, `index-*.js`,
`rolldown-runtime-*.js`, `preload-helper-*.js`, `qrcode-loader-*.js` and the CSS. **Not** requested:
`jspdf.es.min-*.js` (399.95 kB / 129.95 kB gzip), `html2canvas-*.js` (199.49 kB), `purify.es-*.js`,
`index.es-*.js`, `browser-*.js` (the QR encoder, 23.47 kB) and `GameScreen-*.js`.

So jsPDF's optional dependencies are split out and stay unfetched, and the export path costs one
chunk. Re-run this check the same way after any new dependency: the build output alone cannot tell a
`modulepreload` from a name.

## 2026-08-06 — A `beforeAll` that times out SKIPS the whole file, and reads as a failure

`pnpm test` reported `1 failed | 39 passed` with `src/App.test.tsx (27 tests | 27 skipped)`, while
`pnpm vitest run src/App.test.tsx` passed 27/27 on its own. The cause is the warm-up hook that awaits
`import('./components/GameScreen')` to move Vite's first-time transform of ~250 `motion` modules
outside every `waitFor`: it had moved that cost **into the default 10 s hook timeout** instead, which
a fully parallel run of a suite grown to 40 files exceeds. A timed-out `beforeAll` skips every test in
the file, so the summary blames the file rather than the clock.

Fixed by giving the hook an explicit `60_000` budget — a ceiling, not a duration anything waits.
**Two summary shapes now mean "not a real failure", and they are different:** `Errors` with zero
failed tests means the jsdom workers never started (re-run; see the 2026-08-05 entry), and `N skipped`
in one file means a hook timed out.

## 2026-08-06 — The real-device pass, finally run: gestures/audio/QR fine, and one defect on the lock screen

The pass Phase 5 scoped then waived and Phase 7 left outstanding was run on **Android** on 2026-08-06
(`plan.phase-8-features.md` step 23). Results, verbatim where they were reported that way:

- **"Gestures work fine."** No retune. So the five constants in `src/game/gestures.ts` — including
  `SWIPE_COMMIT_DISTANCE_PX` at 96px, which is **52% of the card's width at its floor** since the card
  went fluid — are now _validated on one device_ rather than documented guesses. The arithmetic warning
  in that file stands as a warning; the numbers are evidently acceptable.
- **"Audio sounds good."** The 2026-08-06 stop-on-flip reversal is confirmed on hardware, which was the
  only place it could be: the unit test proves no `pause()` is called, not that sound continues.
- **"QR scans right."** The 14/18 on-screen size at ~144px is closed. The **printed** scan is separate
  and still owed, since nothing has been printed yet.
- **The Android lock-screen check found a real defect:** the preview **kept playing while the phone was
  locked**.

**The defect and the fix.** Android keeps a playing `<audio>` element alive across a screen lock, so
the song continued to a locked phone with a media notification in the shade — for a game whose entire
premise is that the phone reveals nothing about the current card. Note precisely what was and was not
wrong: `navigator.mediaSession.metadata` has never been set, so the panel **could not name the track**
and the Phase 0 leak rule held. What was wrong was playing at all.

`useCardAudio` now pauses on `visibilitychange` when `document.hidden` — which also covers switching
apps and switching tabs, deliberately. Three choices inside that, each with a reason:

- **`visibilitychange`, not `blur` or `pagehide`.** `blur` fires when focus merely leaves the window, so
  a click into devtools would pause the game; `pagehide` is about unloading. `document.hidden` is
  exactly "not on screen".
- **Pause, not stop.** `currentTime` survives, so unlocking and pressing Play continues rather than
  restarting from 0:00.
- **No auto-resume on becoming visible.** A page that starts making noise as a phone unlocks is worse
  than one that waits to be asked, and the autoplay grant from the original tap is long gone anyway.

**It lives in the HOOK, not in `GameScreen`**, which owns the other pause rules. The distinction is
that this one is a property of the DOCUMENT rather than of the card: no card changed and the session is
exactly where the player left it.

**A latent test-file bug fell out of writing the test for it.** `useCardAudio.test.ts` had **no
`afterEach(cleanup)`** — the repo-wide gotcha AGENTS.md warns about, since Testing Library's automatic
cleanup only registers when Vitest `globals` are on. Every earlier test's `<audio>` element was still
mounted, each with its own `visibilitychange` listener, so one dispatched event paused a dozen elements
and the call log held a dozen entries. Every test before it acted on its own element through the
harness box and so never noticed: **a document-level listener is the first thing in that file capable
of exposing a missing cleanup.** Worth remembering as a general property — a missing `cleanup()` is
invisible until a test observes something global.

Still owed from the same session: the **devtools DOM search on an unflipped card** (not reported), the
**printed-QR scan**, one **re-check of the lock screen** now that the fix is in, and the whole **iOS**
column of the Phase 5 checklist — this pass was Android only.

---

## 2026-08-06 — `public/logo.png` and `public/logo.webp` are DIFFERENT ARTWORK, not two encodings of one image

Found while executing Phase 8 plan 1 step 10, whose instruction — recover the pre-deletion source
"rather than upscaling `logo.webp`" — assumes the WebP is a re-encode of the PNG. **It is not.**

Commit **`5e178f6`** (2026-08-06) deleted `public/logo.png` (1,262,175 bytes, 1254×1254, added in
**`667b974`**, 2026-08-03) and added `public/logo.webp` (20,610 bytes, 240×240) in the **same
commit**. The two images are different marks:

| File                 | Artwork                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `logo.png` (deleted) | Rounded **card stack**: equaliser bars, "PLAYLIST / HITSTER", "TU PLAYLIST, TU JUEGO", a vinyl record |
| `logo.webp` (added)  | A **circular** neon "HITSTER" wordmark over concentric arcs                                           |

Only those two image assets have ever been committed, plus `docs/plans/custom-hitster-mockup.png`.

**Why this was worth an entry rather than a shrug:** Phase 7's note that the favicon "replaced a
1.26 MB PNG which was costing 6.2 s of LCP" is entirely true about the bytes and completely silent
about the artwork, so **nothing anywhere recorded that the brand mark had changed**. A later session
reading that note reasonably concludes the two files are the same picture at two sizes — which is what
step 10 assumed, and it is why the step's "recover the original source" would silently have shipped a
home-screen icon that did not match the browser tab.

**Resolved by the developer, 2026-08-06: one identity everywhere, from the card-stack source.** All
four PWA icons and a regenerated `logo.webp` now come from the recovered 1254×1254 PNG, which is also
the mark `docs/plans/custom-hitster-mockup.png` draws in its own header — so the icon set matches the
design language Phase 8 is implementing. The app name became **"Playlist Hitster"** to match.

**Bytes, because the 1.26 MB lesson is two weeks old:**

| File                       |              Size | Note                                                                              |
| -------------------------- | ----------------: | --------------------------------------------------------------------------------- |
| `logo.webp`                |            10,376 | **Smaller** than the 20,610 it replaced. Still the only icon on the critical path |
| `pwa-192x192.png`          |            26,361 |                                                                                   |
| `apple-touch-icon.png`     |            23,526 | 180×180. iOS ignores the manifest's icons and uses only this                      |
| `pwa-512x512.png`          |           131,461 |                                                                                   |
| `pwa-maskable-512x512.png` |           103,328 |                                                                                   |
|                            | **284,676 added** | None of the four is fetched before first paint                                    |

All PNGs are palette-quantised to 256 colours, which roughly halves them (the 512 was 227,819 bytes
as truecolour) with no banding visible in a side-by-side at full size. **Never restore a large icon to
the favicon slot** — that constraint is unchanged and is the one that actually cost LCP.

**The maskable variant was sized by measurement, not by a guessed padding.** The artwork's maximum
content radius is **95.1%** of the source's half-width, so drawing the whole square at **84%** of the
canvas puts its content at a 204.9px radius against the 204.8px safe radius of the 80% circle. Checked
by compositing the result under a simulated circular mask: nothing clips. A maskable icon that is the
full-bleed 512 renamed — or one entry carrying `purpose: 'any maskable'` — validates cleanly and gets
its edges cropped on every round-icon Android launcher, which is what `manifest.test.ts` asserts
against.

---

## 2026-08-06 — The two peeking backs of the deck do not render at all on a full-height card

**Pre-existing, from Phase 5, and found only because the stack was rendered in a real browser for the
first time.** `AGENTS.md` already says `CardStack`'s constants were "chosen by eye" and "have never
been seen on a phone". They have now been seen and the depth cue does not work.

`BACK_OFFSET_PX = 10` and `BACK_SCALE_STEP = 0.04`, measured with `getBoundingClientRect` at the
card's 448px ceiling:

| Element | Height | Peek below the card | Inset on every other side |
| ------- | -----: | ------------------: | ------------------------: |
| back 1  | 430.08 |          **1.04px** |                    5.76px |
| back 2  | 412.16 |          **2.08px** |                   11.52px |

**The cause is that `scale()` is centre-origin.** It pulls the bottom edge _up_ by
`(H / 2) × step` — 8.96px at H = 448 — while `translateY` pushes it _down_ by only 10px. The net peek
is 1px and 2px, on the bottom edge alone, and the card's own 2px ring covers even that. Every other
edge is inset, i.e. behind the card.

**The cue degrades as the card grows, which is backwards.** At the 288px floor the inset is 5.76px
against the same absolute 10px offset, so back 1 peeks by a marginal 4.24px — visible-ish on a phone,
gone on a laptop. Phase 7 open question 2 decided to keep the offset absolute _because_ a fixed 10px
is "close to the minimum that reads as another card behind this one"; that reasoning is sound and the
scale term silently cancels it.

**The condition for any visible peek is `BACK_OFFSET_PX > (H / 2) × BACK_SCALE_STEP`,** and nothing
enforces or tests it — jsdom computes no layout, so no test in this repo can.

**Not fixed.** It is outside Phase 8 plan 1's steps, and the fix is a deck-feel decision with real
options (raise the offset, drop the scale step to zero, or make the offset proportional to
`--card-height`) rather than a mechanical correction. The consequence to know about: `card-ring-dim`,
added by that plan to take the backs from 1.31:1 to 4.23:1 against the page, **is currently inert at
desktop card sizes** because there is nothing of the backs to see. The colour correction is right; the
geometry is a separate decision.

---

## 2026-08-06 — Lightning CSS prefixes `mask-composite` on its own; and a ring utility must not declare `position`

Two things learned building Phase 8's `card-ring` gradient border.

**1. Do not hand-write `-webkit-mask-*` prefixes.** The gradient band is the standard two-layer mask
subtraction (a `content-box` layer excluded from a `border-box` layer, leaving the
`padding: var(--ring-width)` ring). `mask-composite: exclude` is the declaration with the least
uniform support, so the built CSS was grepped rather than trusted — and Lightning CSS expands the
authored two-line `mask` shorthand into the full longhand set with `-webkit-mask-image`,
`-webkit-mask-clip`, `-webkit-mask-origin` and `-webkit-mask-composite: xor` beside every standard
property. Adding prefixes by hand would duplicate what the pipeline already emits.

**2. `position: relative` inside the utility would be a bug, not a safeguard.** The band is a
`position: absolute` `::before`, so it needs a positioned ancestor and the reflex is to guarantee one
in the utility itself. Both call sites are **already** `absolute inset-0` — the two faces in
`Card.tsx` and the backs in `CardStack.tsx` — so the two declarations would collide in the same
cascade layer, and which won would depend on the order Tailwind emitted two custom utilities in. If
`relative` won, both card faces would leave absolute positioning and stack in flow.

The contract is therefore **the caller is positioned**, pinned at both ends the way this repo pins
anything whose middle is untestable: `index.css.test.ts` asserts neither ring utility declares a
`position`, and the two component tests assert `absolute` sits beside the ring class.

**Also worth recording:** the ring adds **no layout**. `--ring-width` is a border inside a
`border-box` element and the glow is a `box-shadow`, so the card's measured box is 288×448 exactly as
before — CLS should be unaffected, and the risk a Lighthouse run should be aimed at is _paint_
instead.

---

## 2026-08-06 — `includeAssets` plus a matching `globPatterns` silently duplicates precache entries

Verifying that Phase 8's service worker precached the lazy chunks (it does — all seven) turned up
**five duplicated entries** in `dist/sw.js`: both 512 icons, the 192, the favicon and the
apple-touch-icon, each listed twice.

Two overlapping causes:

- **`includeAssets` is only for files `globPatterns` does not match.** `public/` is copied to the root
  of the build output and the glob covered `png`/`webp`, so everything named in `includeAssets` was
  already included.
- **`vite-plugin-pwa` adds every manifest-declared icon itself**, which the glob then matched a second
  time. `globIgnores: ['pwa-*.png']` leaves those three to the plugin. `apple-touch-icon.png` must
  **not** be ignored — it is referenced from `index.html` rather than from the manifest, so the glob is
  the only thing that precaches it.

**Why it was worth fixing rather than tolerating:** the duplicate entries carried _identical_
revisions, so workbox deduplicated them silently instead of throwing
`add-to-cache-list-conflicting-entries`. It was invisible — and it would have become a **build-time
throw** the first time the two paths disagreed about a revision. 19 entries afterwards, no duplicates,
nothing missing.

**Unrelated but adjacent:** Vite's native config loader rejects an extensionless relative import and
warns on every build. `vite.config.ts` imports the manifest as `./src/pwa/manifest.ts` with an
explicit **`.ts`** — deliberately _not_ the `.js` form `AGENTS.md` mandates for `api/`, because the two
rules have opposite causes: `api/`'s `.js` specifiers exist so Node's ESM resolver can find a file it
will never transpile, whereas this one is resolved by Vite's own TypeScript-aware loader and never
reaches Node.

---

## 2026-08-06 — A THIRD `pnpm test` flake shape: one genuine assertion timeout under load

Two shapes are already recorded above and both mean "not a real failure": **`Errors` with zero failed
tests** (the jsdom workers never started) and **`N skipped` in one file** (a `beforeAll` timed out).
This is a third and it is neither.

**Observed twice in one session, and it named a DIFFERENT test each time** — which is the detail that
identifies it. Both runs reported `Test Files 1 failed | 40 passed (41)`,
`Tests 1 failed | 587 passed (588)`, always in `src/App.test.tsx`:

| Run | Test blamed                                               | Failing line                                       |
| --- | --------------------------------------------------------- | -------------------------------------------------- |
| 1   | _should return to the landing screen from the end screen_ | `findByText(/deck finished/i)`, `App.test.tsx:566` |
| 2   | _should reset the end reason when a new game starts_      | timed out after 1101 ms                            |

A **named assertion at a named line** is exactly the signature the first entry offers as the way to
tell a real regression from an environment failure. Here it is a false positive, and the fact that the
name **moves between runs** is what gives it away: a regression breaks the same test every time.

Neither was real. `pnpm vitest run src/App.test.tsx` passed 27/27 immediately after each, and the next
full `pnpm test` passed **588/588** both times. The failing runs reported 462 s and 352 s of cumulative
`environment` time against 386–391 s on the clean ones, so the file is being **starved of wall clock
under parallel load** rather than asserting anything wrong.

**Why this file specifically:** `App.test.tsx` is the one that warms up Vite's first-time transform of
~250 `motion` modules (see the `beforeAll` entry above). That hook now has a 60 s budget so it no
longer skips the file — but the cost did not go away, it just moved, and it now lands inside individual
`waitFor`/`findBy*` timeouts instead.

**So the distinguishing signal is no longer the summary shape — it is reproducibility.** Before
treating a single named failure in `App.test.tsx` as a regression, re-run the file alone and then the
suite. Both passing means the clock, not the code, and a different test name on a second occurrence
confirms it. This does not weaken the two entries above; it adds a case where their "a real regression
names an assertion and a line" test gives a false positive under parallel load.

---

## 2026-08-06 — The deck's back is now the next card, preloaded; two documented rules reversed

**A player reported the deck "showing two cards, one inside the other" while sliding the current card
away.** That is the geometry measured in the 2026-08-06 entry above ("The two peeking backs of the deck
do not render at all on a full-height card") seen from the other side: the backs were centre-scaled to
96% and 92%, so they were inset on every edge, and the only moment they were visible at all was while
the top card was off to one side — where two concentric smaller rectangles is exactly what an inset
back looks like. **That entry's open geometry decision is now closed**, and not by retuning the two
constants: both were deleted.

**The new shape is ONE back, at `inset-0` with no transform, holding the next card's real hidden face.**
At rest it is covered pixel for pixel by the card in front. During a drag it is revealed already
complete, QR included.

**Two things that were written down as rules were reversed, so they are recorded here rather than
quietly changed:**

**1. The backs are no longer empty divs.** `CardStack.tsx`, `architecture.md` §3 and
`plan.phase-8-look-and-shell.md` all said no content, no QR, no id. The **leak** half of that
justification survives intact and is still asserted: the back renders `CardHiddenSide` and this file
does not import `CardRevealSide`, so no title, artist or year can reach the document a card early, in
text or in an attribute. What is now in the document one card ahead is the **track id**, because the QR
encodes it — 22 opaque characters on a face that is a mystery by construction, for the card the player
is in the act of dealing themselves. The **cost** half was the actual trade: one extra `toDataURL()`
per advance, which is the point rather than a side effect, because that work has moved off the moment
the card changes.

**2. `card-ring-dim` and `--color-ring-dim` are gone.** A flat dark border was the right call for a
two-pixel sliver and the wrong one for a full-size card face. The back takes the same `card-ring` as the
faces, plus a new `card-ring-quiet`.

**`card-ring-quiet` sets a custom property; it does not declare `box-shadow`.** The glow is a
`box-shadow`, which paints OUTSIDE the element — and the back's box is now pixel-for-pixel the front
card's, so two identical blooms would composite (0.45 over 0.45 ≈ 0.70 alpha) into a halo half again as
bright as the tuned one, on every card of every game. Suppressing it with `box-shadow: none` beside
`card-ring` on the same element would be **two rules declaring the same property at the same
specificity in the same layer**, which is the identical cascade-order hazard the entry above records
for `position: relative`. `card-ring` therefore reads
`var(--ring-glow-color, var(--color-ring-glow))` and the quiet utility declares only that variable: two
different properties, order-independent.

**The preload needed a module-level cache to be worth anything, and the cache has to be read during
render.** `src/game/qr-cache.ts` is new. The back and the front card are **different elements** — a
plain div in `CardStack` versus a `Card` inside an `AnimatePresence` keyed on card id — so an advance
unmounts the element holding the preloaded code and mounts a fresh one. Per-element state throws the
code away at exactly the moment it was preloaded for. Reading the shared cache in an **effect** does not
fix it either: `useEffect` runs after paint, so the new front card still paints one frame of the pulsing
placeholder. `QrCode` reads the cache in its render body, which is the standard write-once resource-cache
shape.

**The consequence for tests: every DOM test file that renders a card now needs `clearQrCache()` in its
`beforeEach`.** Vitest isolates modules per **file**, not per test, so the cache outlives a test — and
four tests in `QrCode.test.tsx` render the same url and size and assert on a **placeholder**. Warm, they
find a finished image instead, and the failure reads as the component painting too eagerly rather than
as shared module state. This is the same class of trap as the missing `afterEach(cleanup)` recorded
earlier in this file, and it now applies to six files: `QrCode`, `Card`, `CardHiddenSide`, `CardStack`,
`GameScreen`, `App`.

**Still unverified, and no local check reaches it:** jsdom computes no layout, so nothing here can prove
the back is actually aligned, actually covered at rest, or that the QR is really painted before the
swipe rather than during it. The class names and the absence of a transform are pinned; the geometry is
one drag in a browser. Added to `docs/development.md` §5.

## 2026-08-06 — The deck actions moved to the game screen; plan 2's decision 7 is half reversed

Two user-requested changes, one trivial and one that overturns a written decision.

**The rename.** The end screen's second button is now **"Home"** rather than "New playlist". The
landing screen is also where the saved-playlist library lives and where a shared link is pasted, so
the old label named one of three reasons to press it — and it was the only one the button does not
actually do. It cost nothing in state, and _why_ it cost nothing is worth recording: `App.tsx`'s
`EndedView` was already phrased as the **destination** (`'end-screen' | 'landing'`) rather than as
the plan's `'exited' | 'finished' | null` **reason**, precisely because a reason could not express
"the player wants to go back". A flag named after where a press goes survives the press being
renamed. The prop went `onNewPlaylist` → `onHome` with it, and `EndScreen.test.tsx` asserts the old
label is gone.

**The reversal.** The share link, the save and the PDF export are now reachable **mid-game**, from a
fourth `CardControls` button that opens `DeckActionsDialog`. Plan 2's decision 7 had put them on the
end screen and _nowhere else_, with two stated reasons — "a progress dialog over a live card is a
spoiler risk" and "an interaction conflict with the swipe" — and both were sound. What the decision
never weighed is the **cost of the only route to them**: reaching the end screen means ending the
game, `END` clears the saved session, and nothing in the app can bring the deck back. So the price
of copying a share link was the deck. That is the argument that reverses it, and it is worth
separating from "it would be convenient" — the feature was not missing, it was _behind an
irreversible action_.

Both objections are answered rather than waived, and each answer is pinned by a test:

- **Spoiler.** `DeckActions` holds the whole deck (the PDF needs it) and renders only counts. The
  export's messages are `completed/total` and an excluded **count**; the sheet line is a count; the
  share link is a playlist id and a seed. `DeckActions.test.tsx` asserts no fixture title or artist
  reaches the text _or any attribute_; `DeckActionsDialog.test.tsx` and `GameScreen.test.tsx` assert
  the same thing through the real screen with the panel open.
- **Swipe.** It mounts in a modal whose backdrop takes the pointer, and `GameScreen`'s **guard 4**
  now suspends the window key handler for _either_ dialog. That guard is an OR over two flags now,
  and a third dialog has to be added to it. Nothing interactive went inside `Card`, so the Phase 5
  tap-is-a-flip bug stays structurally impossible rather than newly guarded.

**Three things a future session should know before editing any of it.**

1. **`DeckActions` is shared by both screens**, so a copy change lands in two places at once. Its
   behaviour is tested once, in `DeckActions.test.tsx`; `EndScreen.test.tsx` keeps only a presence
   check, because a second copy of those assertions would prove only that the copy still exists.
2. **The dialog focuses the first ACTION, not the close button** — deliberately different from
   `ExitConfirmDialog`, which focuses Cancel. That dialog asks an irreversible question, so every
   ambiguous input must resolve to "keep the game"; this one offers three harmless actions, so
   focusing Close would just make a keyboard player Tab past it. Its focus trap is a real **cycle**
   rather than the exit dialog's two-element swap, and the focusable list is queried **at Tab time**
   because the copy fallback mounts an input only after a copy has failed and the save button
   disables itself the moment it is pressed.
3. **The bundle cost is real and was measured**: `index` 216.41 kB → 209.98 kB, plus a new shared
   `DeckActions` chunk of 17.28 kB, so **+4.8 kB gzip on the initial path** (68.24 → 73.06 kB gzip).
   The chunk is shared because `EndScreen` is imported eagerly while `GameScreen` is lazy. No code is
   duplicated across chunks — checked by grepping the built assets for the sheet-count copy, which
   appears exactly once. If this ever needs recovering, the lever is making `EndScreen` lazy too,
   which would take both it and `DeckActions` off the landing path entirely; that was not done here
   because it needs its own Suspense-fallback decision.

**Unverified, and it needs the same manual pass everything else on this screen does.** Nothing local
can tell whether a modal panel over a live card is _usable_ on a phone — whether the panel fits at
360px with the copy fallback's input showing, whether the backdrop's `bg-page/80` leaves the card
legible enough to be reassuring rather than distracting, and whether the fourth control button
crowds the bar's touch targets on the surface a thumb swipes. jsdom computes no layout, so all four
are class-name assertions here. Add them to the iOS/Android checklist in `docs/development.md` §5.

## 2026-08-07 — The PDF export waits for the year crawl; the link and the save do not

Follow-up to yesterday's mid-game deck actions. The three actions are **not** equally safe to offer
early, and the asymmetry is the finding:

- **A share link is (playlist id + seed) and a save is (id + name).** Both are complete the moment a
  deck exists, and both survive the years arriving afterwards, because whoever opens the link looks
  the years up again from scratch.
- **The PDF is the one artefact that is finished when it is made.** `selectPrintableCards` drops
  every card without a year, so an export taken mid-crawl prints a deck that is quietly short — and
  the omission is discoverable only by counting a stack of printed paper, after the ink. The old
  `excludedCount` message named the count _after_ the download, which is the wrong side of the
  press.

So Print now **waits** rather than exporting or refusing. `pendingYearCount === 0` is the gate, and
it is exactly equivalent to "every card in this deck can be printed" **because a lookup that finds
nothing removes its card** (the 2026-08-05 reversal) rather than leaving it yearless — so the gate
terminates even for a playlist MusicBrainz can only partly place.

**Four things worth knowing before touching it.**

1. **The wait is DERIVED, not stored.** The obvious shape is an `isWaiting` flag an effect clears
   when the last year lands, and `react-hooks/set-state-in-effect` rejects it — correctly, since
   clearing state from an effect is a cascading render and the state was redundant. What is stored
   is `hasAskedToPrint`; `isWaitingForYears = hasAskedToPrint && pendingYearCount > 0`. The wait
   therefore **ends by itself** on the render where the count reaches zero. The lint rule found a
   real simplification, not a false positive.
2. **The auto-export effect needs a ref guard, and for a non-obvious reason.** `hasAskedToPrint`
   stays true after the handoff (nothing clears it), and `deck` is a new array identity on every
   resolved year — so without `hasAutoExportedRef` a later re-render would export a second time.
   Reset in `handlePrint` when a new wait begins.
3. **`excludedCount` and `nothing-to-print` are still live branches**, not dead code left behind by
   the gate. The gate waits for `year === undefined` to clear; `selectPrintableCards` also drops
   `year === null`. A live deck holds no null years, but a **resumed pre-reversal save** does, so
   the two conditions are not the same condition.
4. **`Spinner` was extracted for the `data-motion` hook, not for the four class names.** A
   hand-rolled second copy of that markup is one typo away from an element the reduced-motion block
   does not match, and **nothing would fail** — jsdom evaluates no media query, so the miss is
   invisible to every local check. `resolvedCount` also finally has a caller, through its new
   complement `pendingYearCount`; it had been exported with tests and no consumer since 2026-08-05,
   on the bet that a later phase would want a progress readout from the selector rather than
   reinvent one in a component. That bet paid.

**Unverified.** Nobody has watched the wait against a real crawl. The 1 req/s shared gate means a
50-card deck is on the order of a minute, and whether that reads as "working" or as "hung" is a
judgement no local test can make — it is the same class of question the preparing screen's
"the rest fill in while you play" line exists to answer. Added to `docs/development.md` §5 as row 13.

---

## 2026-08-07 — Multi-playlist plan 1: the two version lifts, the `savedDeckKey` sort, and a plan that could not go green as written

Plan 1 of `plan.multi-playlist-core.md` built everything below React for a 1..5-playlist deck. Six
things worth carrying forward.

**1. The plan's own step 8 was unsatisfiable as written, and this is a shape to expect from any
two-plan split that renames a type.** Step 8 demands all four checks green while the scope table
excludes every component; but renaming `GameState.playlist` → `playlists`, `SavedPlaylist.id` →
`ids`, `DeckLink.playlistId` → `playlistIds`, and changing `removePlaylist` / `buildDeckLink` /
`start` breaks `App.tsx`, `DeckActions.tsx`, `LandingScreen.tsx` and six test files at compile time.
Step 8's own sub-bullet ("confirm every remaining hit is in plan 2's files") reads as if hits were
expected to remain, which contradicts a green typecheck. Resolved with the developer: **minimal n=1
shims in the plan-2 files, each carrying a comment naming plan 2 as its replacement.** The lesson for
a future split: **a plan that renames a type in plan 1 and updates its consumers in plan 2 cannot
have "all four checks green" as plan 1's exit criterion** — either the rename moves to plan 2, or
plan 1 owns mechanical shims and says so up front.

**2. One shim has a behavioural edge worth knowing: `App.tsx`'s link effect IGNORES a link naming
several playlists** rather than dealing its first. Unreachable today — this build's `buildDeckLink`
only ever emits one id — and it was chosen over "deal the first" because dealing a deck the link did
not describe is exactly what `deck-link.ts`'s over-cap rejection exists to refuse. Plan 2 deletes it.

**3. Both `localStorage` payloads went to v2 and both read v1, and the KEYS were deliberately not
bumped.** The reflex on a shape change in this repo is to bump the `v1` segment of the key, because
that is the documented invalidation lever. Here it is the wrong lever: bumping the key makes existing
payloads unreachable, which is precisely what the lift is preventing. The library case is the
sharper one — a version mismatch clears the whole store, so shipping v2 without the lift would
**silently empty a library the player curated, on the landing screen, with no message**. A lost
session costs one game; a lost library costs every game they meant to keep. Both lifts are exact
rather than guesses (a v1 payload described exactly one playlist), which is the only reason this
module's "guessing at a migration is how a wrong year ends up on a card" rule tolerates them. **A v3
drops the v1 lift rather than chaining a second one.**

**4. `savedDeckKey` must copy before it sorts, and the copy is load-bearing rather than hygiene.**
`Array.prototype.sort` is in place, so `entry.ids.sort().join(',')` would reorder the array it was
called on. `App.tsx` computes the key from `state.playlists.map(p => p.id)` — a fresh array, so that
call site is safe — but `isPlaylistSaved` also calls it on every entry in the library state, and
those are the arrays rendered on the landing screen. `[...ids].sort()`, with a test asserting the
input is unmutated.

**5. The write-side leak rebuild needed extending for an array field, and the existing test did not
catch it.** `savePlaylist` already rebuilt three named fields because a spread defeats TypeScript's
excess-property check. An array field is a **new** smuggling route that the field rebuild does not
close: `ids: [...entry.ids]` copies whatever the caller put in it. Now filtered element by element
to non-empty strings, with its own test. The general rule: **a field-by-field rebuild is only as
strong as its weakest field, and a container field needs rebuilding element by element.**

**6. `pnpm format:check` fails repo-wide and always has.** `core.autocrlf=true` and no
`.gitattributes`, so every file checks out CRLF while Prettier's `endOfLine` default is `lf` — 18
files fail, including ones untouched for weeks (`docs/plans/plan.phase-8-added-by.md`). It is not one
of the four gate checks and `pnpm lint` is unaffected (`eslint-config-prettier` disables stylistic
rules), so nothing is broken. Two consequences: **do not read a `format:check` failure as evidence
your change is unformatted**, and **`git stash` round-trips flip edited files from LF to CRLF**,
which makes the failure list grow for reasons that have nothing to do with the diff.

**Not measured here, and still owed by plan 2:** what a real five-playlist deck merges to after the
dedupe, the number of `/api/playlist` requests a five-row submit makes under React 19 StrictMode, and
the bundle delta. All three need the UI. Plan 1's own open question 1 IS resolved:
`pdfFileName("Rock Classics +2 more")` → `hitster-rock-classics-2-more.pdf`, because the existing
`[^a-z0-9]+` → `-` collapse eats the `+` before it can reach a filesystem.

---

## 2026-08-07 — The landing screen's "+" is now unmounted at the cap, and one test helper became unsafe past five rows

The add-playlist button was `disabled={!canAddRow || isLoading}`; it is now rendered only while
`canAddRow`, still `disabled={isLoading}`. The cap hint stays and its justification shifts rather
than disappearing: **a control that vanishes with no explanation reads as broken exactly as a dead
one does**, so the sentence "5 playlists is the maximum for one deck." is the half that must not be
dropped along with the button. `plan.multi-playlist-ui.md` step 2's checkbox said "disabled at
`MAX_DECK_PLAYLISTS` rows" and is amended in place.

**The gotcha is in the tests, not the component.** `LandingScreen.test.tsx`'s `pressAdd()` helper is
`fireEvent.click(getByRole('button', { name: 'Add another playlist' }))`. While the button was merely
disabled, over-pressing it was harmless — `fireEvent` on a disabled button dispatches nothing and the
row count simply stopped growing, which is how "should not add more rows than the maximum" was
written: press `MAX + 3` times, then assert five textboxes. With the button unmounted, the sixth
`pressAdd()` throws in `getByRole` instead, and **the failure names a missing button rather than the
cap the test is about**. Every loop that walks the form to its maximum must now stop exactly at it
(`for (let i = 1; i < MAX_DECK_PLAYLISTS; i += 1)`, from the one row the form starts with). Two such
loops exist — the cap test and the leak assertion, which deliberately re-runs against a fully grown
form.

General shape worth remembering: **swapping `disabled` for unmounting turns a no-op interaction into
a query failure**, so any test that relied on pressing a dead control has to be re-read, and the
four checks will not point at the reason.

**Follow-up the same day — the "+" is also a full-width ghost row now, and that is what let the
`aria-label` go.** The button was `self-start` with `px-3 py-1` and a bare `+`: a third width in a
column whose only other width is the full-bleed inputs, sitting in its own slot between the rows and
Start and belonging to neither. It is now `w-full` with a **dashed** border and the input's own
`rounded-lg px-3 py-2`, so it occupies the slot shape of a playlist row and reads as the next box the
player can create. `hover:bg-surface` is deliberate: `--color-surface` is the inputs' own background,
so hovering fills the ghost in as a real box, and it introduces **no new contrast pair** (`text-fg` on
`bg-surface` is what every input already renders).

The accessibility half is the part worth keeping: the sentence is now **visible text**, so the
accessible name comes from the text content and the `aria-label` was removed. A name of "+" is
useless to anyone not looking at the screen and an `aria-label` duplicating visible text is exactly
the redundancy the inputs above were fixed for (WCAG 2.5.3). `LandingScreen.test.tsx` gains
`hasAttribute('aria-label') === false` beside a `textContent` check, because **every existing query
was by accessible name and would pass identically with the attribute back** — the role query alone
cannot tell the two shapes apart, which is why the negative attribute assertion has to be explicit.
Same pattern as that file's existing input-label test.

---

## 2026-08-07 — "Print so far": the year gate refuses a _silent_ short deck, not a short deck

Follow-up to this morning's year gate, from a complaint about the wait: the gate is right that an
export taken mid-crawl prints a deck that is **quietly** short, and wrong if it is read as "a short
deck is never wanted". Somebody who wants to start playing with 40 of 60 cards while the rest look up
is making a trade. **What the gate actually protects is the player's knowledge of the omission**, and
the fix is therefore disclosure rather than a lifted gate: the excluded **count** after the press,
which the export already reported and which is now the ordinary case rather than a residue.

A caption above the buttons ("prints only the cards that already have a year — the wait keeps
running") was written first and then **cut on review the same day**. Worth recording as a judgement
rather than a fact: the button's label already says what it prints, the wait already carries two
sentences, and a third made the panel read as an explanation of itself. The consequence is that
"PDF downloaded — N cards left out, no year yet" is the **whole** of the disclosure — so that line is
the one not to weaken, and a future edit that drops the count for a bare "PDF downloaded" takes the
feature back to the silent short deck the gate exists to prevent.

So the wait has a second button, and four things fell out of adding it.

1. **It does not touch `hasAskedToPrint`, and that is the requested behaviour rather than a bug.** The
   wait survives its own export, so the full deck still exports itself when the last year lands —
   **two files, both asked for.** `hasAutoExportedRef` is untouched by the press (it is reset only in
   `handlePrint`), which is exactly why the later auto-export still fires.
2. **`role="status"` had to move off the wait's outer element.** The new button's label carries
   `Building PDF… n/m`, and that count climbing **inside** a live region is one announcement per card
   — a hundred on a full deck. The region now wraps only the two sentences that are the wait; the
   buttons and the export's outcome sit outside it, and the outcome brings the separate region it
   already had in the resolved view. The general shape: **a live region should wrap the sentences that
   change, not the view that contains them**, because anything else that changes inside it is
   conscripted into the announcement.
3. **Focus stays on Cancel**, against `DeckActionsDialog`'s own "the first action takes focus"
   convention. That convention was justified by the three actions being harmless; this one spends
   paper, and focus arrives here without the player choosing it (the wait replaces the view under
   their cursor). Cancel is the reversible target and Print is one Tab away.
4. **The export's happy path was untestable and nobody had noticed why.** Every export test written
   before today stopped at `nothing-to-print` — which is the one outcome `usePdfExport` publishes
   **before** either dynamic `import()` runs, so the suite had a full set of assertions that all
   happened to stop at the same line. Reaching `done` needs `qrcode` doubled (its browser build draws
   through a `<canvas>` jsdom does not implement) **and** `jspdf` doubled (it hands a download to a
   browser that is not there). Both go through `vi.mock` by specifier, which serves the dynamic
   imports unchanged — the finding `QrCode.test.tsx` records, now used a second time. The jsPDF double
   is a class whose only working methods are the two that **return** anything, `splitTextToSize` and
   `save`.

One smaller thing: the `excludedCount` and `nothing-to-print` branches were documented in the gate's
own entry as live-but-residual, reachable only through a resumed pre-reversal save. Under "Print so
far" they are both **ordinary** — a press on card 1 hits `nothing-to-print` as the normal answer.

**Also fixed in the same pass:** the wait's container carried `py-2`, which stacked with
`DeckActionsDialog`'s `gap-4` to put 24px between Cancel and "Back to the game" where every other
view of the panel has 16px. Removed, so the panel's own gap is the only spacing in play — the general
lesson being that a padded child inside a `gap`-ed flex column is spacing declared in two places.

**Unverified.** Nothing here has been printed. A partial export's honesty is a claim about paper, and
row 13 of `docs/development.md` §5 (watch the wait against a real crawl) now also covers pressing
"Print so far" mid-crawl and counting what comes out.

## 2026-08-11 — The Play button's "first click does nothing" was a `pause` EVENT, not a missing await

Reported as "the first click on Play is often not detected". The reflex diagnosis is that
`element.play()` needs awaiting, or that the element is not ready — both wrong, and the second one
is a trap: `useCardAudio.play()` deliberately calls `play()` synchronously inside the click
handler's own call stack, because the autoplay grant does not survive an `await`. Adding a
`readyState` gate or a promise chain there would have broken mobile Safari to fix nothing.

The actual mechanism is two separate faults that compounded:

1. **No feedback for the cold fetch.** The element is `preload="none"` (deliberately — a 100-card
   deck must not pull 100 previews), so the first press on any card starts a network fetch.
   `setIsPlaying(true)` flipped the icon to Pause instantly and then nothing happened, audibly or
   visually, for the length of the fetch. The press read as ignored.
2. **`onPause` cleared the state unconditionally.** A `pause` event can arrive while that fetch is
   in flight. The old handler set `isPlaying` false on any pause, so the button snapped back to
   "Play" while the audio was genuinely still coming. The player then pressed again — and because
   the toggle is `isPlaying ? pause : play`, that second press was a PAUSE, which aborted the
   in-flight load. **This is why pressing twice made it worse rather than better**, which is the
   detail that identifies the bug: a pure latency problem gets better when you wait or press again.

Fix is `wantsPlayRef` (intent) held separately from `isPlaying` (state). `onPause` returns early
while intent is true, so a pause nobody asked for is ignored; every deliberate stop — `pause()`,
`stop()`, the visibility pause, `ended` — lowers the ref FIRST, which is what keeps those paths
working. **The ordering is load-bearing**: lowering the ref after `element.pause()` races the event
and leaves the button stuck on Pause.

`isLoading` is now a separate returned value driven by real media events (`playing` clears it,
`waiting` sets it, `error` clears it so a dead URL cannot spin forever). It is deliberately not
`!isPlaying`: intent and audibility are different facts and the gap between them is the whole bug.
Note `playing`, not the `play()` promise — the promise resolves before the first sample on a cold
element, so gating the spinner on it would hide the spinner exactly when it is needed.

Also removed: `restart()` and the Restart button. Its behaviour moved into the `ended` handler,
which now rewinds `currentTime` to 0 so Play doubles as replay rather than depending on the
browser's implicit seek-to-0-at-end convention. `src` is untouched there — the one rewind in the
hook that is not also a stop, so the replay costs no second fetch.

## 2026-08-11 — Reduced motion `display: none`s a spinner, so a spinner must never be the only thing in its box

Two new `Spinner` call sites landed (the Play button's buffering state, and the pending-year slot on
the reveal face) and both hit the same trap, which is worth stating as a rule because **nothing local
can catch it**: jsdom evaluates no media query, so a component whose reduced-motion appearance is
broken passes every check.

`[data-motion='spinner'] { display: none }` removes the element from layout entirely — unlike
`[data-motion='qr-placeholder']`, which only drops its `animation` and keeps its box. So:

- A **button** whose only content is a spinner renders as a completely empty circle. `CardControls`
  keeps the Play/Pause icon rendered underneath and overlays the spinner (`absolute inset-0`,
  `pointer-events-none`), so a glyph is always present.
- A **slot** whose height came from the spinner collapses. The pending-year spinner replaced a 3rem
  `····` glyph, so it sits inside a `size-(--size-year-spinner)` box — the token is 3rem precisely
  because `--text-year-pending` was, and the two must move together or the card changes height on
  every reveal.

Both are tested by `.remove()`ing the spinner node and asserting what survives, which is the pattern
`PreparingScreen.test.tsx` and `DeckActions.test.tsx` already used.

Second trap, specific to the year slot: **do not put `role="status"` on a spinner inside
`CardRevealSide`.** The whole reveal is already one live region, and a nested second one announces
the card twice. `DeckActions` wraps its spinner in `role="status"` only because it is not inside
one. The pending announcement is unchanged by the swap — the `····` was already `aria-hidden`, so
the "Still looking up the year…" line was and remains the entire announcement.

Side effect worth knowing: `--color-fg-decorative` and `--text-year-pending` are now **unreferenced**.
Both are kept (`@theme static` does not tree-shake) with comments saying so — `--color-fg-decorative`
carried a documented WCAG 1.4.3 exemption at 1.94:1 that applied _because_ its one consumer was
`aria-hidden` decoration, and that exemption does not travel to a new consumer.

## 2026-08-11 — Playlist names are truncated in the string, not in CSS

`deckLabel()` now caps the first playlist's name at 20 characters via `truncatePlaylistName()`
(`MAX_PLAYLIST_NAME_CHARS`). CSS truncation was rejected: only the HUD had `truncate`, and the other
three consumers of this string have no width to overflow at all — it becomes a **PDF filename**
through `pdfFileName()` and is written **verbatim into `localStorage`** by the saved-playlist
library. A `text-ellipsis` fixes neither, and jsdom computes no layout so nothing local could prove
it worked. A real `…` character is testable.

The cap applies to the NAME, never to the finished label: a label that lost its `+2 more` would
claim a three-playlist deck is one playlist. The HUD's `truncate` stays — 20 characters is a cap,
not a width, and a narrow phone can still be too narrow for 20 glyphs.

`trimEnd()` before appending `…` matters: a cut landing on a space renders "Chill Vibes For You …"
with a visible gap. `…` survives the PDF path safely — `sanitizeForPdf` maps it to "..." for WinAnsi
and `pdfFileName` then strips it to a hyphen.

**The saved library stores `deckLabel()`'s output**, so entries are truncated on write and existing
long entries in `localStorage` are left alone. Truncating those again at render would cut the
`+N more` suffix off the end, which is the failure the cap is designed to avoid.

## 2026-08-11 — The deck slid away by itself mid-game, and the cause was the `AnimatePresence` key

**Symptom:** partway through a game, cards were seen sliding off to the right for no reason. The
player had not swiped and nothing about their card changed.

**Cause:** `CardStack` keyed its `AnimatePresence` child on `` `${currentCard.id}:${currentIndex}` ``.
`YEAR_RESOLVED` **removes** a card whose lookup found no year, and when the dropped card sat _behind_
the player the reducer shifts `currentIndex` back (`droppedBeforeCurrent`) so the player keeps
looking at the same card. Same card, lower index — so the key changed, `AnimatePresence` read it as
one child leaving and another arriving, and the card flew `EXIT_DISTANCE_PX` off the screen while an
identical one mounted in its place. The direction is whatever the last swipe left in `exitDirection`
(sticky state in `useCardGestures`), which is why it reads as "sliding to the right" for a player who
swipes right. On a real playlist roughly a third of cards resolve yearless, so this fires every few
seconds for the whole session.

**Fix:** the key is now identity, never position — `cardPresenceKey()` returns
`` `${id}:${occurrence}` ``, where `occurrence` is how many cards _before_ the current one share its
id. That is invariant under exactly the thing the index was not: `YEAR_RESOLVED` drops **every** card
carrying the resolved id, never one copy, so a surviving card cannot have lost a same-id copy from in
front of it. Drops anywhere else leave the string untouched. It still separates adjacent duplicate
ids (`X:0` / `X:1`), which is the bug the index was added for — a bare-id key lets React reuse one
element across an advance, and the flip state surviving that hands the player the answer.

**Not fixed, and it is a different case:** when the player's _own_ card is the one dropped, the deck
closes up under them and a genuinely different card arrives, so the key changes and the exit
animation plays. Suppressing that needs `AnimatePresence`'s `custom` prop plus a dynamic exit variant
on `Card` (a removed child's props can no longer be updated), and it is arguable that the animation
is honest feedback there. Left alone deliberately.

**Testing note:** jsdom cannot see the slide, so the regression tests in `CardStack.test.tsx` assert
element **identity** across the rerender instead — the same element means no child left, which means
no exit animation. Both fail against the old key.

## 2026-08-11 — The card became square, and every number downstream of the 9/14 ratio had to move

**What was asked:** three bigger control buttons, spaced so the gap between them equals the gap from
the outer two to the card's sides, and a **square** card instead of a rectangular one.

**The square card is one token, and it is the only part of the change that is one token.**
`--card-width: calc(var(--card-height) * 9 / 14)` became `var(--card-height)`. What is worth writing
down is everything that was quietly measured in that ratio:

- **All three clamp terms.** The clamp governs the HEIGHT, so under 9/14 every term was implicitly a
  width term divided by 0.643 — reuse them and the card is 1.56× wider than each was tuned for. The
  floor went `18rem → 15rem` (18rem of _width_ is 288px, and a 320px phone has 272px once `<main>`'s
  `p-6` is paid, so the old floor would have overflowed the viewport it exists to fit); the ceiling
  went `28rem → 24rem` (keeps the area within 15% of the old 288 × 448); and `124vw → 80vw` is the
  same rule restated, because 124vw of height _was_ 80vw of width once the ratio was applied.
- **`--qr-display-size`, and its constraint changed AXIS.** On the 9/14 card the cap was horizontal:
  `CardHiddenSide` is `p-6`, so 15/18 of the width was the widest square that fitted. A square face
  has width to spare and the code shares the HEIGHT with the caption instead — `p-6` + `gap-6` + a
  12px line take a fixed ~88px, so the ratio must satisfy `r * 240 + 88 <= 240` at the floor card.
  **14/18 overflows the floor card by ~35px, and `overflow-hidden` on the face would have clipped the
  QR rather than shown the overflow** — an unscannable card with no visible symptom. It is now 7/12,
  picked so the displayed size is the same 224px (ceiling) and ~140px (floor) it always was, which is
  also why `QR_BITMAP_SIZE` did not have to move: 7/12 × 384 = 224 exactly.
- **`--ring-width` deliberately did NOT move** (fixed 2px: a width-derived ring goes sub-pixel on the
  small card and blurs into its own bloom), and neither did `62dvh`, which now does _less_ work than
  before — a square card of a given height is narrower than the 9/14 card was tall, so short
  viewports gain room rather than losing it.

**The spacing request could not be met with a gap utility, and that is the interesting half.** `gap-3`
sets the two INNER gaps and says nothing about the outer two, which were whatever centring a
hug-width row inside the screen happened to leave — a number with no relation to the card at all. The
row is now `w-(--card-width)` with **`justify-evenly`**, which splits the leftover width into four
equal parts: the requirement holds by construction, at every viewport, and keeps holding when the
button size changes.

**So the button size decides how much leftover there is, and a literal cannot do it.**
`--size-control-button: max(3.5rem, calc(var(--card-width) / 5))` makes each of the four gaps exactly
`card / 10` — half a button — at every card size, where a fixed 3.5rem leaves 42px gaps at the ceiling
and 18px at the floor, i.e. a different design at each end. `max()` rather than `clamp()`: the floor is
what the buttons already measured so they can never get smaller, and `card / 5` at the card's ceiling is
76.8px, so an upper term would be unreachable decoration. `--size-control-icon` and
`--size-control-spinner` are now derived from the button for the same reason — a fixed 28px glyph
rattles around inside a 77px circle — with the spinner as `button - 1rem` rather than a fraction,
because what has to hold is the constant 8px of button visible outside the ring.

**Two hazards this created for a future reader:**

1. **`--container-content` (24rem) and the card's ceiling (24rem) are now the same number**, so `Hud`,
   `NoticeBanner` and the control row look like they could take the reading measure instead of
   `--card-width`. They agree at the ceiling and nowhere else — the card shrinks with the viewport and
   the reading measure does not — so the swap silently reintroduces the overhang on every phone.
2. **Nothing local can see any of this.** jsdom computes no layout, so the four equal gaps, the square,
   and the QR's fit inside the floor card are all arithmetic here and class names in the tests.
   `index.css.test.ts` pins the width as `var(--card-height)` with **no multiplier** (a
   `calc(... * 9 / 14)` passes a naive "derives from the height" check while being the exact thing that
   was asked to change) and pins `button = card / 5`; `CardControls.test.tsx` pins the row's width,
   `justify-evenly`, and the ABSENCE of a `gap-*`. **Owed manually: one look at the square card at
   three widths, and one QR scan on the floor card**, where the code is ~140px.

## 2026-08-11 — The year was the album's, not the song's: `primary-type: Album` was the bug

Reported symptom: "a menudo el año es incorrecto, porque MusicBrainz devuelve el año de inclusión en
el álbum, pero me interesa la primera fecha de salida", plus "los unconfirmed year también suelen
fallar". Both had a precise cause and both were fixable inside MusicBrainz — no second provider, no
new secret, and **no change to the two-requests-per-lookup cost**.

**Cause 1, the wrong `high` years.** `shared/year.ts` filtered the strict pass to release groups with
`primary-type: Album`. But a release group's `first-release-date` is the date of the RECORD, so for a
song issued as a single first, the album date is the year the track was _included_ on an album. The
release-group filter was doing exactly what it was written to do and the answer was still wrong.
Worse: a song never issued on a studio album had **no eligible release group at all** — every one was
either a Single (excluded here) or a compilation (excluded by secondary type) — so it fell to the
unfiltered pass. "Hey Jude" is that case.

**Cause 2, the unreliable `low` years.** The relaxed pass applied **no release-group filter
whatsoever**. Live takes, compilations, remixes, demos and bootlegs competed on equal terms. There
was nothing between "official studio album" and "anything at all", so whenever the strict pass
missed, the most misleading candidate in the pool was as eligible as the best one.

**Built:** a three-rung ladder in `shared/year.ts` (`YEAR_TIER_ORDER`), walked by
`api/_lib/resolve-year.ts`. Rung ① `official-release` = `primary-type` ∈ **Album / Single / EP**,
`status: Official`, no excluded secondary type, dated by release-group `first-release-date` → `high`.
Rung ② `studio-release` = the secondary-type exclusion and `status` ≠ Bootleg, nothing else → `low`.
Rung ③ `unfiltered` = the old relaxed pass verbatim → `low`. All three are pure functions over the
same already-fetched pool, so the ladder is free.

**Why widening rung ① cannot overshoot.** Earliest-wins runs after the filter, so admitting more
release groups can only move the answer earlier — which is the definition of "first release". A
reissue single can never beat the album it postdates. Billie Jean has a January **1983** single over
a November **1982** album and still resolves to 1982; that is asserted, not assumed.

**Measured live against MusicBrainz, 2026-08-11 — 21 of 22 exact.** All 14 Phase 0 tracks unchanged
(so the widening cost nothing), and 7 of the 8 new single-before-album tracks now correct where every
one of them was previously off by a year or worse:

| Track                                | Single  | Album   | Was               | Now      |
| ------------------------------------ | ------- | ------- | ----------------- | -------- |
| Creep / Radiohead                    | 1992-09 | 1993-02 | 1993              | **1992** |
| Relax / Frankie Goes to Hollywood    | 1983-10 | 1984-10 | 1984              | **1983** |
| Under Pressure / Queen & David Bowie | 1981-10 | 1982-05 | 1982              | **1981** |
| Firestarter / The Prodigy            | 1996-03 | 1997-06 | 1997              | **1996** |
| Mr. Brightside / The Killers         | 2003-09 | 2004-06 | 2004              | **2003** |
| Rolling in the Deep / Adele          | 2010-11 | 2011-01 | 2011              | **2010** |
| Hey Jude / The Beatles               | 1968-08 | (none)  | no eligible group | **1968** |

**The twenty-second is a structural limitation, not a tuning failure — do not try to filter your way
to it.** Depeche Mode's "Personal Jesus" resolves to 1990 (Violator) where the truth is the
1989-08-29 single. MusicBrainz _has_ that single release group, correctly dated. The pipeline cannot
reach it because resolution is **recording**-scoped: the album version is 4:55 and the 1989 single
carries a **3:46 edit**, a separate recording MBID. Verified by querying the recording search
unbounded — the album recording never appears beside that release group, so the `dur:` bound is not
what hides it and removing the bound would not help. Reaching it needs **work-level** resolution
(MusicBrainz `work` relationships group every recording of one song), which is a much larger change.
Pinned as `YEAR_LIMITATION_FIXTURES` with the wrong year asserted, so a future work-level lookup
announces itself by failing that test.

**Two mechanical things that were easy to miss.**

1. `MAX_RELEASE_GROUPS = 50` truncates the second request, and Singles/EPs enlarge the pool competing
   for those slots. The ids are now **sorted Album → EP → Single before the cap**, which makes
   truncation non-regressive by construction: everything that survived the cap under the old rule
   still survives it. The cap was left at 50 and its `console.warn` is what would say otherwise.
2. **The fixtures had to be re-captured, all 22 of them.** The old captures carried Single candidates
   with no `releaseGroupFirstReleaseDate`, because under the Album-only rule nothing had ever fetched
   one. A fixture that cannot represent the new evidence cannot catch a regression in it — the
   14-track suite passed _before_ the re-capture, which is exactly the false comfort to watch for.

`YEAR_CACHE_SCHEMA_VERSION` bumped **v2 → v3**. Necessary rather than merely required by the rule
this time: the change alters answers already cached at `high`, which is the 30-day tier. Expect the
first play of any playlist after deploy to re-resolve its whole deck against the global 1 req/s
budget.

**Not done, and deliberately.** No second provider — iTunes and Deezer report the album edition's
date (the same disease as Spotify, useful for coverage but harmful for accuracy), and Discogs and
Wikidata carry the right semantic but cost a new secret, adapter and rate limit. Also not done:
using the recording's own `first-release-date` to override rung ①. It measures 10 of 13 alone and is
wrong-_early_ on "No Woman No Cry" (1973 vs 1974), so a blind `min()` trades one error for another.
The open idea worth trying next is using it as a **disagreement detector** that downgrades confidence
rather than changes the year.

## 2026-08-11 — Five UI changes, and three of them exposed something the repo did not know

Asked for in one message: move the card's scan caption below the card and dim it, centre and enlarge
the QR, redraw the deck-actions icon from a supplied reference, add a copyright footer, rename the app
to **"Playlist Jitster"**. Four of the five are ordinary. What is worth recording is the three
discoveries.

**1. The caption was the QR's ceiling, and moving it is what made the code bigger.** While "Scan to
play the full song" was on the hidden face, the code shared the card's HEIGHT with it: `p-6` + `gap-6`

- a 12px line is a fixed ~88px, so on the 240px floor card the ratio could not exceed 0.633 no matter
  how much width was spare. With one child on the face the only limit is the padding, on both axes
  equally (`r × 240 + 48 ≤ 240`, i.e. 0.8), so `--qr-display-size` went 7/12 → **3/4** — 288px at the
  card's ceiling, 180px at its floor, against 224/140 before. **3/4 rather than the 0.8 the arithmetic
  allows**, because the face is `overflow-hidden`: an over-large ratio CROPS the code rather than
  spilling it, and a cropped QR does not scan while still looking almost right. `QR_BITMAP_SIZE` had to
  go 224 → 288 with it (encoding below the displayed size upscales a QR and blurs the module edges a
  camera reads) and it is the one number in the app that multiplies by deck size — `qr-cache.ts` never
  evicts, and a deck is capped at 100 cards.

The move also fixed a duplication nobody had counted: `CardStack` mounts `CardHiddenSide` a second
time for the next card's back, so the sentence was in the document **twice per card**. That is now
structurally impossible rather than hidden behind the back's `aria-hidden`, which still earns its
place for the QR's `alt`.

**2. A copyright footer is a year-shaped number on a pre-reveal surface, and three leak proxies caught
it.** `LandingScreen.test.tsx` (twice) and `PreparingScreen.test.tsx` assert
`not.toMatch(/\b(19|20)\d{2}\b/)` over the whole screen's text — a proxy for "no card's year can
appear here" — and "Copyright © 2026-present" fails it. **The tests were right and the fix is not to
loosen the pattern.** They now `.replace(COPYRIGHT_NOTICE, '')` before asserting, by exact string
imported from the component: the one string known to be a constant is subtracted, and the proxy stays
absolute for everything else. Loosening the regex to tolerate any `20xx` would have retired a leak
check to accommodate a legal line.

**3. Testing Library maps `<footer>` to `contentinfo` regardless of ancestry, so the spec rule cannot
be asserted with a role query.** Per HTML-AAM a `<footer>` is `contentinfo` only when its nearest
sectioning ancestor is the body; ours is always inside a screen's own `<main>`, so in a browser it is
**not** a landmark — which is what we want, since a copyright line in the landmark list is noise. A
test written as `expect(queryByRole('contentinfo')).toBeNull()` inside a `<main>` **fails against that
correct component**. `Footer.test.tsx` now asserts the property the repo can keep — no explicit `role`
attribute — and records the discrepancy, because the natural response to the failing query is to
"fix" the component by adding `role="contentinfo"`, which would make the landmark real on three
different screens.

**Where the footer goes, and the two screens it is kept off.** There is no shell: every screen is its
own `min-h-dvh justify-center` column, so a footer rendered once in `App.tsx` or `main.tsx` is a
sibling of a full-viewport column and gives every screen a permanent scrollbar. It is therefore the
last child of `<main>` on the **landing, preparing and end** screens.

**4. "Put it at the bottom" could not be done with `mt-auto`, because AN AUTO MARGIN BEATS
`justify-content`.** The footer first shipped in flow, which put it directly under the centred content
— in the middle of the screen. The textbook sticky footer is `mt-auto` on the last child, and in a
`min-h-dvh flex flex-col justify-center` column that margin consumes ALL the free space before
`justify-content` sees any, so the content stops being centred and packs to the top. Most visible on
the preparing screen (a spinner and two lines clinging to the top of an empty viewport). Making it work
needs a second auto margin on the first child of every screen — fragile, since the preparing screen's
first child is a **conditional** notice — or a wrapper around all of each screen's children, which
changes their `gap-*` semantics.

The answer was to take the footer OUT OF FLOW: `absolute inset-x-0 bottom-4`, riding in a `pb-12` band
the host reserves, with `relative` on the host. Content centring is then untouched, there is no overlap
(48px of padding against a ~16px line), and on the landing screen — the one column that outgrows the
viewport — `<main>` stretches past `min-h-dvh` and the footer travels to the end of the scroll. **Not
`fixed`**, which is the other reading of "always at the bottom of the screen": a copyright line
hovering over the suggestions a player is scrolling costs more than it gives. It is the same
caller-is-positioned contract as `card-ring`, and it is asserted at both ends for the same reason —
drop `relative` from one screen and the line silently anchors to the viewport instead. **Not the game screen** — that
column is a height budget (`--card-height` is sized against the viewport so the HUD, card, caption and
controls fit a phone), a footer costs ~40px of it, and the `mt-auto` variant is worse because auto
margins beat `justify-center` and the card would stop being centred. **Not the crash screen** — the
fallback is a `role="alert"`, so its whole subtree is announced and the copyright would be read out to
someone being told the game crashed.

**The rename's boundary is the interesting part of the rename.** "Playlist Hitster" → "Playlist
Jitster" in `index.html`'s `<title>`, `manifest.name`/`short_name`, `LandingScreen`'s `<h1>` and
README's heading. Renamed as well, because it is user-visible: **`pdfFileName`'s prefix**,
`hitster-*.pdf` → `jitster-*.pdf`. Deliberately NOT renamed:

- **`hitster:session:v1` and `hitster:library:v1`.** A renamed storage key is not read, so it silently
  discards a saved game and a curated library — the exact failure the v1 lifts exist to avoid.
- **Every "Hitster" that means the BOARD GAME** — `pdf-sheet.ts`'s 65 mm card, `reducer.ts` and
  `messages.ts` on why a yearless card is dropped, `CardRevealSide`, README's "shop-bought Hitster
  cards". Renaming those corrupts the reasoning rather than the branding.
- **`custom-hitster`**: the package name, the repo directory, `MUSICBRAINZ_USER_AGENT`, `api/hello`'s
  message, and the `https://hitster.example` origins in tests. None is user-visible branding and the
  user agent is a string MusicBrainz has seen.

**The icon.** `KeepDeckIcon` is now the three-node share glyph (nodes at (6.5,12), (17,6), (17,18),
r=2.5; links stopping 2.5 units short of each centre so they meet the disc edge) instead of the
export-arrow-out-of-a-tray. It uses `ControlIcon`'s `filled` variant because the reference's nodes are
solid and three outlined rings read as noise at 20px — which means **the two link paths need an
explicit `fill="none"`**, or the filled `<svg>` paints the triangle their four endpoints imply and the
mark becomes a solid wedge. That is what `CardControls.test.tsx` pins, along with the shape counts.

**Two unrelated observations while running the suite,** neither created by this work and both left in
place. An untracked **`diag.json`** sits in the repo root — a dump of card titles, artists and
durations — and its mtime advances during a test run, though nothing in the repo greps for that name;
worth chasing before it is committed by accident, since it holds track data. And an untracked
**`api/_lib/artistmatch.tmp.test.ts`** is present but is NOT collected by `vitest` (46 files, 748
tests, with and without it), so it is a spike file rather than part of the suite. Neither is in
`.gitignore`, which is why both show up in `git status`.

## 2026-08-11 — Where blank cards actually come from: coverage, not scoring (and one real matching bug)

Diagnosed the `none` population by running the whole pipeline over two real 50-track playlists via
the embed endpoint. The split is genre-correlated and decisive:

|                                         | Today's Top Hits | Viva Latino |
| --------------------------------------- | ---------------- | ----------- |
| `high`                                  | 46               | 33          |
| `low`                                   | 1                | 2           |
| **`none` — card DROPPED from the deck** | **3**            | **14**      |

The 36% blank rate recorded on 2026-08-05 reproduces on Latin/urban and nearly vanishes on
anglophone chart pop. Of the 18 failures across both:

- **10 were MusicBrainz coverage gaps** — a candidate pool of literally **zero**. All 2025–26
  regional Mexican / Latin urban. MusicBrainz is a volunteer archive and nobody has entered them.
  **No algorithm change can touch these**, which is the single most useful thing this measurement
  established.
- **5 were artist matching**, and that is a real bug (below).
- 1 `no-dated-candidates`, 2 transient upstream errors.

### The matching bug

`artistMatches` requires one credit to be a contiguous whole-token RUN of the other. Spotify joins
collaborators with `", "`; MusicBrainz uses a joinphrase. So the two disagree about the connector
**and** the order, and a mismatch discards the _entire_ pool — 22 perfectly good candidates for
"Dai Dai", after which the card is removed from the deck.

Real credits, measured live:

| Spotify                             | MusicBrainz             | exact | join-word fix | token bag |
| ----------------------------------- | ----------------------- | ----- | ------------- | --------- |
| `Shakira, Burna Boy`                | `Shakira x Burna Boy`   | ✗     | ✗             | ✓         |
| `Dave, Tems`                        | `Dave feat. Tems`       | ✗     | ✓             | ✓         |
| `Dave, Tems`                        | `Tems & Dave`           | ✗     | ✗             | ✓         |
| `Xavi, De La Rose`                  | `De La Rose & Xavi`     | ✗     | ✗             | ✓         |
| `Natanael Cano, Gabito Ballesteros` | `Natanael Cano feat. …` | ✗     | ✓             | ✓         |

**Two things that look true and are not.** First, this is _not_ a punctuation problem:
`normalizeForCacheKey` already maps `&`, `+` and `,` to spaces, so `"Shakira, Burna Boy"` ~
`"Shakira & Burna Boy"` matched before any of this. Only **word** connectors and **reordering** were
ever broken. Second, the obvious cheap fix — normalise join words away while KEEPING contiguity,
which introduces no new false positives — **was measured and recovers only 2 of 4**, because half the
sample is pure reordering. That is the whole reason a token bag was necessary rather than merely
convenient.

### Built

`admitByArtist()` in `shared/year.ts`: exact pool, or — only when it is **empty** — the loose pool
(same tokens, any order, ≤1 word of slack, ≥2 non-article tokens on the shorter side).
`YearTier.confidence` became **`maxConfidence`**, a ceiling; the single success return computes
`weakest(tier.maxConfidence, ARTIST_MATCH_CONFIDENCE[match])`, so a loosened match can never report
`high`. Cache version v3 → v4.

**A fallback, never a widening — and the reason is not the obvious one.** Merging the rules into a
single filter fails because earliest-wins would hand the answer to any loosely-matched candidate with
an older date, _and_ because **`preferByDuration` is not monotone**: it narrows to length-matching
candidates only when that set is non-empty, so one extra admission can collapse the pool to just it.
A union can therefore move a year in **both** directions — the "widening can only move it earlier"
argument that justified the Singles/EP change earlier the same day **does not transfer to the artist
filter**. The fallback shape provably can only turn a null into a year.

### The test-coverage trap, again

**The 22-fixture accuracy suite is structurally blind to artist matching.** The current filter rejects
**0 of 227** candidates across every fixture, because the trimming policy kept representatives of
distinct _exclusion reasons_ and "excluded by artist credit" was never one of them. So `pnpm test`
passes identically with the whole artist rule reverted — the same false-comfort shape as the
pre-re-capture fixtures, and the same shape as the unknown-Tailwind-utility and missing-`.js`
findings. `artistMatchesExact` is exported for exactly one test: that every accuracy fixture has a
non-empty exact pool. That assertion is what turns the safety argument into a test.

### Verified live

All four previously-dropped cards resolve: 2026 / 2025 / 2026 / 2025, all `low`. Every year agrees
with what **iTunes and Deezer independently report**.

### The dominant cause is still open, and the earlier "no second provider" call deserves revisiting

10 of 18 failures were coverage. Measured: of those 18 tracks, **iTunes had 17 and Deezer had 17**,
both keyless. The objection recorded earlier the same day — stores report the album edition's date —
is real for old catalogue and **irrelevant for exactly the tracks MusicBrainz misses**, because a
2026 single has no reissue history. The two sources fail in opposite directions: MusicBrainz is an
archive (strong on old catalogue, weak on new), a store is a catalogue of what is currently sold.
**Caveat measured, not assumed:** the probe took the first search result without verifying it, and
three tracks got conflicting years between the two stores (`MATCHA` — iTunes 2023 vs Deezer 2026),
so some hits are the wrong song. Any implementation needs normalised title+artist verification and
must report `low`.

**Also measured and NOT worth building:** retrying the duration-bounded query unbounded when scoring
fails. Recovered zero tracks.

---

## 2026-08-12 — The landing screen's redesign, and the icon identity regenerated from a new master

Two developer requests, one session. Neither changed any behaviour: no reducer action, no prop, no
storage format, no request.

### `justify-center` on the landing `<main>` had been doing NOTHING for two phases

The developer asked for the inputs and Start to sit in the middle of the screen. `<main>` already
read `min-h-dvh flex flex-col justify-center` — and centred nothing, because **`justify-content`
only spends free space and this column has never had any**: nine suggestions plus a saved library
push it past the viewport on every device. The class was true, load-bearing-looking, and inert.

Fixed by giving the centring to a **hero `<section>` with its own viewport-sized minimum**
(`min-h-[88dvh]`, holding the logo, the sentence and the form) and removing `justify-center` from
`<main>`. The vertical padding moved with it — `px-6` on `<main>`, `py-6` on the hero — so the
hero's minimum is the viewport exactly rather than the viewport plus 3rem it cannot see.

**`88dvh`, not `100dvh`, is a deliberate 12% of nothing:** at a full viewport the next section
starts exactly at the fold, so on a desktop there is no evidence anything is below it — and the
suggestions are the one-click demo path for a visitor with no playlist of their own, i.e. the thing
that must not become undiscoverable when it stops being a main element. At 88 the next heading
peeks. `LandingScreen.test.tsx` pins the arrangement, including the **absence** of `justify-center`
on `<main>`, because putting it back looks harmless and would centre nothing.

The suggestions themselves went from nine full-width `bg-surface` rows to a two-column grid
(one column on a phone) with no filled surface and `text-xs`. What a press does is unchanged.

### The `<h1>` is an image now, and the `alt` is the half that can silently break

`<h1><img alt="" /></h1>` renders identically to the correct thing and leaves the document's one
top-level heading with **no accessible name**. So the test asserts the name, not the element.

### The logo said HITSTER while the app was called Jitster

Found while wiring the image in: `public/logo.webp` still carried the **"PLAYLIST HITSTER"**
wordmark, from the 2026-08-06 "one identity everywhere" resolution — and the app was renamed to
**Playlist Jitster** on 2026-08-11, a rename whose recorded boundary said "the PWA artwork is
unaffected: the icons carry no wordmark". **They do.** Nobody had looked at the picture; the rename
was reasoned about as a string change and the artwork was assumed to be the card stack alone. This
is the 2026-08-06 finding's exact shape (`logo.png` and `logo.webp` were different artwork and
nothing recorded it) recurring in the other direction, and it survived a day because **no check in
this repo has ever opened an image**.

Overtaken by events rather than fixed in code: the developer supplied new artwork the same day,
twice, and the second version is what shipped. It carries the JITSTER wordmark, so the `alt`, the
`<title>`, `manifest.name` and the picture finally all say one thing.

### The whole icon identity was regenerated, and the master is deliberately not in `public/`

`docs/assets/logo.png` (1254 × 1254, 1,285,649 bytes) is the master; `logo.webp` 384,
`pwa-192x192`, `pwa-512x512`, `pwa-maskable-512x512` and `apple-touch-icon` are all `LANCZOS`
downscales of it, each PNG written twice (RGB-optimised, and 256-colour palette) with the smaller
kept. Totals in [`architecture.md`](./architecture.md) §3.

**Why `docs/` and not `public/`:** everything in `public/` is copied to `dist/` **and precached by
the service worker**, so a 1.2 MB master there is downloaded by every install. That is the same
file at the same size as the `public/logo.png` that cost **6.2 s of LCP** in Phase 7. Keeping it in
the repo at all is the other half of the lesson: the previous master survived only in git history,
and recovering it was a whole step of Phase 8 plan 1.

**The maskable scale is measured, not inherited.** The old value (84% of the canvas) was correct for
the old artwork. On this one the lit content reaches **109.4%** of the half-edge — the neon bloom
runs past the card into the corners — so the square scales to **73.1%** for every lit pixel to fall
inside the 80% safe circle. Copying the 84% forward would have cropped the glow on every round-icon
launcher, and no local check would have said so.

### Still unverified, and not verifiable here

Nothing in this repo renders a pixel: jsdom applies no stylesheet and computes no layout, so the
centring, the 88dvh peek, the two-column grid and the logo's legibility at 192px are all
**class-name assertions only**. The "three widths" row in [`development.md`](./development.md) §5
now also owes: the hero centred at 320 / 768 / 1280, the suggestions grid at each, and one look at
the icon on a real home screen (the maskable crop is the part a desktop cannot show).

---

## 2026-08-12 — Android's back button became an in-app control, and four assumptions about jsdom's history turned out to be wrong

Built from [`plan.google-play-back-button.md`](./plans/plan.google-play-back-button.md): a pure
decision (`src/game/back-navigation.ts`), a thin binding hook (`src/hooks/useBackNavigation.ts`) and
one call in `GameScreen`. The bug it fixes is that a Trusted Web Activity has **no history entry to
go back to**, so Android's back gesture closed the activity outright — bypassing `ExitConfirmDialog`
_invisibly_, because the session survives in `localStorage` and a relaunch resumes. The player reads
that as the app quitting at random rather than as a game they lost.

The design is written up in [`architecture.md`](./architecture.md) §3. What belongs here is the
measurement, because the plan asked for the answer rather than a guess and the answer moved two
tests and one comment.

### jsdom fires `popstate`, and not within one macrotask

`history.back()` really traverses — unlike a drag, which Motion reads from geometry jsdom never
computes — so the hook's own listener is exercised rather than a double. But a `setTimeout(0)` is
**too early**: the first probe saw no event and an unchanged `history.state`, which reads exactly
like "jsdom does not implement this". At 50 ms it fires; the event landed at ~11 ms. Every assertion
after a traversal in `useBackNavigation.test.ts`, `GameScreen.test.tsx` and `App.test.tsx` therefore
waits on a real timer inside `act`.

### `history.length` cannot see the failure it was supposed to catch

The plan asked for "should leave the history length unchanged after unmount". **Going back does not
shorten `history.length`** — the forward entry is retained — in jsdom _and_ in a browser, so a stray
entry and a cleanly removed one read as the same number. The test is written as a **position**
instead: a sentinel is stamped into the base entry's state, and after unmount the current entry must
be that sentinel again. Worth knowing generally: `history.length` is close to useless as an
assertion, because it counts entries in both directions and never decreases on traversal.

### The cleanup ordering is real, and NOT observable — so it is pinned as a call order

"Remove the listener before navigating" is the plan's central hazard, and the obvious test for it
**passes with the two lines in either order** (verified by swapping them). The traversal is queued
rather than synchronous, so the listener is gone before the event lands whichever line runs first.
A second test asserts the **call order** through spies, which is the only instrument that can see
it, and that one does go red on a swap. The order stays because it is the only version that survives
the cleanup gaining an `await`, an early return, or a second statement between the lines — but the
honest label is on the test, not implied by a green suite.

### jsdom DISCARDS a queued traversal that a `pushState` beats, which hides the StrictMode phantom

The interesting one. React's double-invoke gives: push A → cleanup queues `back()` → push B. In
Chrome the queued traversal re-resolves its delta when the task runs, moves B → A, and fires
`popstate` at the listener the **second** effect attached — a phantom back press that would open the
exit confirmation by itself a few milliseconds into every game in development. In jsdom the same
sequence ends at B with **no `popstate` at all**: the intervening push cancels the traversal.

Consequence to know before deleting anything: `pendingCleanupTraversals` — the module-level count of
traversals the hook itself queued — guards a failure **no local test can reproduce**, and the suite
is green with it removed. It is written against the platform rather than against the test
environment, and its test says so in its own comment.

Two smaller measurements from the same session. `pushState(state, '')` with **no URL argument**
keeps the href, search and hash in full, which is what leaves a shared deck link's
`?playlist=…&seed=…` intact for a mid-game reload. And `EventTarget.prototype.removeEventListener
.call(window, …)` **throws** in jsdom — its `window` fails the branded IDL check — so a spy that
needs to delegate must capture the bound original before `vi.spyOn` replaces it.

### One decision beyond the plan, because the plan's version worked only once

**The entry is re-pushed after every press.** A back press consumes it; without a synchronous
replacement inside the handler the interception works exactly once per game — press back, cancel the
confirmation, press back again, and the activity closes. That is the original bug delayed by one
press, which makes it harder to report rather than less severe. The invariant is "exactly one
outstanding entry for the life of the game", and the accounting is asserted end to end: three
presses, three replacements, and the teardown still lands on the base entry.

### Still unverified, and not verifiable here

Whether Android's gesture arrives as a `popstate` at all. jsdom's history is a model, not Chrome's,
and every device row in [`development.md`](./development.md) §5 needs the installed TWA — a browser
supplies its own back affordance and its own entries, so a green result in Chrome proves nothing.
The Android 13+ predictive-back animation is the one that could send this back to the shell plan.

### Two defects a fan-out caught that no check in this repo could

Both were found by review agents rather than by `pnpm test`, and both are the same shape: a number
that looked measured and was not.

**1. The maskable icon shipped with the clamp applied to the CANVAS but not to the ARTWORK PASTED
INTO IT.** `Image.new(...BACKDROP)` was clamped, `master.resize(...)` was not, so the file held a
hard-edged 374 x 374 square of `#010101` inside a `#0a0a0a` frame -- 46% of its pixels below the
floor, with a 1px step from mean luminance 10.00 to 1.08. The seam's edge midpoints sit **187px from
centre, INSIDE the 204.8px safe circle**, so a round launcher would have shown all four sides of it
while cropping only the corners. Invisible to every automated check here and probably invisible in a
bright room; **perceptible on an OLED phone in the dark**. Fixed by pasting the clamped resize. The
file also dropped 80,511 -> 40,070 bytes, which is the tell in hindsight: a flat backdrop quantises
to one palette entry, and the un-clamped one could not.

**2. THE CSS EDGE FADE WAS REASONING IN THE WRONG UNITS, AND IT DIMMED THE THING IT WAS PROTECTING.**
`mask-x-from-90%` was added to soften the logo's edges; its comment justified the 90% stop against a
neon frame "at ~89.5% of the half-edge". **Tailwind's mask stops are a fraction of the FULL axis**,
so 90% fades the outer 10% of the width = the outer **20%** of the half-edge, twice the assumed band.
Measured on the shipped 384px file: bright pixels span 11.0%..95.8% horizontally, the frame's right
edge took mask alpha **0.44** and the bottom-right corner ~**0.3** -- and the attenuation was
**asymmetric**, because the artwork is not centred in its own canvas. It was also pointless: from
96.6% outward every pixel is already exactly the page colour, so there was nothing left to dissolve.
Removed. The seam it was meant to soften is fixed in the asset instead, which needs no CSS and
degrades to nothing.

**The lesson both share is the one this repo keeps relearning**: `pnpm typecheck && pnpm lint &&
pnpm test && pnpm build` passed on every version of both. Nothing here opens an image, evaluates a
mask, or computes a layout.

### One leak proxy narrowed silently on the same day

Making the `<h1>` an `<img>` moved the app's name out of `textContent` and into an `alt`. Both landing
leak tests audit `container.textContent`, so their coverage shrank with no assertion changing and no
test failing -- while AGENTS.md lists `alt` text and `aria-label`s as leak surfaces in their own
right. `LandingScreen.test.tsx` now audits text **plus** `alt`, `aria-label`, `title`, `placeholder`
and `value`. Note what this catches that the old proxy could not: a saved playlist's name reaches an
`aria-label` ("Remove X from your playlists") as well as its button's text.

---

## 2026-08-12 — The footer went to every screen, its band became symmetric, and the landing hero's one-day viewport minimum came back out

Three developer requests in one session, all layout, none of them touching behaviour: no reducer
action, no prop, no storage format, no request.

### The hero's `min-h-[88dvh]` lasted one day, and the thing it optimised for is what it broke

The centring fix recorded earlier the same day (see the entry above) gave the landing screen's logo,
sentence and form their own viewport-sized hero. The developer's next note was that there is too much
space between Start and the suggestions.

Both are true, and they are the same class: **a viewport-sized minimum does not set a distance, it
sets a remainder.** The gap between the form and "Or try one of these" became `88dvh − (however tall
the hero's contents are)`, which on a phone with five rows is nearly nothing and on a desktop is
several hundred pixels of empty page — and empty page below a form reads as the page having ended,
which is precisely the failure mode `88dvh` was chosen (over `100dvh`) to avoid. It bought a peek at
the next heading and paid for it with a void above that heading.

Removed. The hero is now its own natural height and `<main>`'s `gap-8` separates it from the
suggestions like any other pair — one standard margin, the same at every viewport. `justify-center`
stays off `<main>` (it was inert, for the reason the earlier entry gives), and `py-6` moved off the
hero to `pt-6` on `<main>`: the hero's own padding would have stacked on the gap and made its two
neighbours unequal.

`LandingScreen.test.tsx` pins the **absence** of any `min-h-[…dvh]` on every descendant, matched on
the pattern rather than on the one literal — the way this regresses is somebody reaching for a
slightly different number. The old "centre the form in the viewport" test lost its subject and was
rewritten as an **order** test (form first, suggestions in a later section, asserted with
`compareDocumentPosition`), which is the half of it that was load-bearing all along: demoting the
suggestions was always supposed to be weight and order, not a screenful of nothing.

### `bottom-4` in a `pb-12`/`pb-20` band was never centred in it, and nothing could see that

The developer asked for the copyright line to have as much room below it as above it. It had
**16px below and 16–48px above**, depending on which screen: the offset (`bottom-4`) and the band
(`pb-12` on preparing/end, `pb-20` on landing) had been chosen independently, and the line's own
height was in neither.

The fix is to treat them as one number: **`bottom-8` inside `pb-20`, on every host.** 80px of band, a
32px offset and a ~16px line put exactly 32px above and 32px below. The contract in `Footer.tsx` now
says so, and every host's test asserts `pb-20` rather than "at least `pb-12`" — a minimum was the
right shape when only the top gap mattered and is the wrong shape now that the two ends are paired.

**Nothing in this repo can check the result**, which is the reason the arithmetic is written down
rather than left implied: jsdom computes no layout, so a `bottom-4` sneaking back leaves the suite
entirely green.

### The game screen's exclusion was overruled, not refuted, and it costs 56px of the card's budget

The footer was deliberately off the game screen; `Footer.tsx` gave two reasons and both still hold.
The developer asked for the line to be visible at all times, mid-game included.

What that costs is specific and worth having in one place. `Footer` is `absolute`, so it takes no row
in the column — but its `pb-20` band is **56px more than the `p-6`** that screen used to have, and
that column is a height budget rather than a page: `--card-height` is
`clamp(15rem, min(62dvh, 80vw), 24rem)` precisely so the HUD, the notice, the card, its caption and
the control bar fit a phone without scrolling. On a short viewport the extra 56px is what makes it
overflow. **Accepted, and the lever if it hurts on a real device is `--card-height`'s `62dvh` term,
not deleting the footer from that one screen.** How it is placed there did not change: still
`absolute`, never `mt-auto`, because an auto margin beats `justify-content` and the card would stop
being centred.

Two details that are easy to get wrong. It is rendered **before** the two dialogs, which is the tab
order — painting is unaffected either way, since both are `fixed z-50`, but a copyright line after a
modal's buttons is a surprise for a keyboard user. And the crash screen is **still** excluded:
`ErrorBoundary`'s fallback is a `role="alert"`, so its whole subtree is announced, and that is the one
place where adding text has a cost beyond layout.

### The build tells one small truth about this

`Footer` is now imported by both the eager landing path and the lazy `GameScreen` chunk, so rolldown
moved it into the **existing** shared chunk — the one that was named `DeckActions` and is now named
`Footer`. Measured both ways: 19.62 kB / 7.84 kB gzip before, 19.84 kB / 7.94 kB gzip after. **No new
request and +0.10 kB gzip**, i.e. the chunk was renamed rather than created, which is worth knowing
before reading the build log as a regression.

### Still unverified, and not verifiable here

Every one of these is a class-name assertion. The **"three widths" row** in
[`development.md`](./development.md) §5 now also owes: that the gap between Start and the suggestions
reads as a normal margin at 320 / 768 / 1280, that the copyright line sits with visibly equal air
above and below it, and — the one with a real failure mode — **that the game screen still fits a short
phone without scrolling** now that 56px of its height budget is gone.

---

## 2026-08-12 — The suggested-playlist set is deliberately undocumented, and a duplicate id is invisible

The developer replaced most of `SUGGESTED_PLAYLISTS` and then asked for every reference to the
individual playlists to come out of the docs, "no es relevante ya que puede ir cambiando". Both
halves are worth recording, because the second one has a failure mode.

**1. The set is now recorded in exactly one place, and that is a rule rather than an omission.**
`SUGGESTED_PLAYLISTS` in `src/components/LandingScreen.tsx` is the only enumeration; `README.md`,
`docs/architecture.md`, `docs/development.md`, `plan.md` §5, `plan.phase-4-6-screens.md`,
`plan.phase-2-playlist.md` and `plan.multi-playlist-ui.md` were all edited to stop naming rows or
counting them. The reasoning is not tidiness: **a stale note about a _verified_ id is worse than no
note, because it reads as evidence.** Spotify refreshes an editorial playlist's tracks and an owner
can re-point, empty or hide a personal one, so a recorded track count or preview-coverage figure
decays silently while still looking like a measurement someone took. What survives beside the array
is only what outlives any edit — verify before shipping, verify by `entity.uri` **and**
`entity.name`, verify the survivors too, and expect any row to be able to hit `MAX_EMBED_TRACKS`.
Dated spike records elsewhere in this file that used a playlist as a measurement **subject** were
left alone: there the name is the experiment's traceability, not documentation of the set.

Two consequences already visible. Docs that counted the rows ("eight suggestions", "nine suggested
playlists") were wrong at three different numbers across four files, which is what the count-free
phrasing prevents. And `LandingScreen.test.tsx` stopped naming rows: the exact-length assertion
became a floor (`>= 5`), and the two tests that clicked a hard-coded label now sample
`SUGGESTED_PLAYLISTS[0]` — an exact count turns a routine edit into a failing test that says nothing.

**2. A duplicate id in the set is invisible on the screen, and it arrived on the first try.** The
requested additions included two rows under different names carrying the **same** link, which
resolves to one playlist. Nothing would have caught it: both buttons render, both submit, both deal
the same deck, and every existing assertion (`toHaveLength`, the per-row submit loop, the leak
proxies) passes. It is the natural failure of a list maintained by pasting links — one pasted twice
under two names looks exactly like two additions. Now pinned by
`should suggest each playlist only once`, which asserts uniqueness of **both** id and label; the
label half matters too, since `suggestionButton()` is a `getByRole` and two identical names make it
throw.

**3. Verification method, so the next one is a re-run.** A throwaway Node script over
`https://open.spotify.com/embed/playlist/{id}` with a browser `User-Agent`, extracting
`__NEXT_DATA__` and reading `props.pageProps.state.data.entity` — the same path
`api/_lib/spotify-embed.ts` takes. Per id it reports `uri === spotify:playlist:{id}`, `name`,
`subtitle` (the owner), `trackList.length` and how many entries lack `audioPreview.url`. Every id in
the set passed, including the replacement for the duplicate above — which the same script confirmed
is a genuinely different playlist rather than a second name for one already listed. **Labels are now readable renderings of the titles, not the titles verbatim**, because
real titles carry emoji, trailing punctuation and the occasional typo — so a label that differs from
`entity.name` is the design, and this supersedes the two older "label capitalisation mismatch" notes
above.

**4. A personal playlist is a weaker promise than an editorial one, and the set is now mostly
personal.** On 2026-08-12 one row was removed precisely for being user-owned; later the same day six
user-owned rows were added at the developer's request. The trade is accepted, not overlooked: an
owner can make one private at any time and the player then meets `not-found-or-private` on a row the
app itself suggested. That is what makes the re-verification a recurring chore rather than a one-off.

## 2026-08-12 — Copy was centralised into `src/game/copy.ts`; six pure-wording assertions were deleted rather than converted

The developer asked for the app's text to be freely editable without breaking tests ("elimina todos
los tests que checkean textos concretos o usa variables globales para ellos"). Every user-facing
string in `src/` now lives in `src/game/copy.ts` as `COPY.*`, components render it, and the tests
assert against the same constants.

**Scale, for anyone wondering whether it was worth it.** Before this, the wording was pinned in
roughly 200 assertions across eighteen test files — whole sentences (`toContain('1 playlist could
not be loaded and was left out.')`), accessible names (`{ name: /copy share link/i }`), aria-labels
(`'Dismiss notice'`), and format-coupled regexes (`/\d+ cards? left/` with the number extracted back
out of the match). The suite passed identically before and after, which is the point: none of those
assertions was about behaviour, and all of them made rewording expensive.

**Three conversions that were not mechanical, and are the pattern for the next one:**

1. **A count read back out of a rendered line.** `App.test.tsx` extracted the HUD's remaining count
   with `/(\d+) cards? left/`. That regex IS the copy. It is now `cardsLeftInHud()`, which asks
   `COPY.hud.cardsLeft(n)` which `n` produces the line on screen — counting **downward** from 500,
   because `cardsLeft(2)` ("2 cards left") is a substring of `cardsLeft(12)`.
2. **"Is the export running?"** was `queryByText(/building pdf/i)`. The label is
   `COPY.deckActions.printing(done, total)`, whose counts a caller does not know. Rewritten as a
   question about the **button's identity** instead: a button still wearing `COPY.deckActions.print`
   is exactly the claim "no export started", with no sentence pinned anywhere. Where both labels are
   acceptable, the `name` option takes a **predicate over the two strings** rather than a regex
   alternation.
3. **"The banner names no failed playlist."** Was the absence of a quote mark and of `'left out:'`.
   Now an **equality over the `<li>` list** against the copy constants: a name cannot appear in a
   set of lines that are exactly those constants, and the constants take only numbers.

**Six assertions were DELETED, because they check wording that no constant can express.** Recorded
here because each was load-bearing enough to be written up in `AGENTS.md`, and deleting them is the
part of this change that loses something:

- `DeckActions.test.tsx` — the two `not.toMatch(/same deck/i)` checks on the share caption. The rule
  ("a link promises the same playlist and shuffle, never the same deck") is now a comment block on
  `COPY.deckActions.shareCaption`.
- `EndScreen.test.tsx` — `{ name: /new playlist/i }` absent. The Home button's own
  `{ name: COPY.end.home }` query fails on any rename, which is the half worth keeping.
- `CardControls.test.tsx` — `{ name: 'Restart' }` absent. The exhaustive `expect(names).toEqual([...])`
  above it already fails if a fourth control appears.
- `LandingScreen.test.tsx` — `not.toContain('our side')` on the `empty-playlist` message. Replaced by
  asserting the two messages are **not the same string**, which is what the bug actually was.
- `messages.test.ts` — seven substring checks (`'private'`, `'deleted'`, `'no tracks'`, `'our side'`,
  `'years'`, `'try a playlist'`, `'offline'`). Replaced by **"every code has a sentence of its own"**
  (`new Set(messages).size === ALL_CODES.length`), which is the property they were defending —
  `empty-playlist` rendering the `unexpected-payload` apology is exactly a two-codes-one-sentence bug,
  and it shipped once.

**Two things that stayed out of the module and should stay out.** `messages.ts` keeps the error map:
`Record<StartFailureCode, string>` makes a new code fail the typecheck, and that exhaustiveness is
what a loose object would cost. `index.html` and `src/pwa/manifest.ts` cannot import it at all — the
first is shipped bytes on the critical path, the second is read by `vite.config.ts` at build time.

## 2026-08-12 — `getByText` reads only an element's DIRECT text-node children, which is why the split footer needed `textContent`

Pulling "Aleix Rabassa" into its own `<span>` (to carry the accent colour) broke
`screen.getByText(COPYRIGHT_NOTICE)` — Testing Library's default matcher runs over `getNodeText()`,
which concatenates only the **direct** child text nodes, so the `<footer>` matched
`"Copyright © 2026-present . All rights reserved."` with the name missing. `textContent` (which does
descend) is what `Footer.test.tsx` now asserts on.

Worth knowing beyond the footer: **the leak proofs were unaffected**, because they already read
`container.textContent`. So the three screens that subtract `COPYRIGHT_NOTICE` from their text before
asserting no year-shaped number remains kept working — but only because the three parts concatenate
with **no separator**. A stray space between them would make that subtraction miss and the proofs
would fail on `PreparingScreen`/`EndScreen`/`LandingScreen`, reading as a leak in a screen that has
none. That is the property `Footer.test.tsx`'s first test now pins.

## 2026-08-12 — The accent is now used as TEXT in one place; contrast measured at 5.13:1

`--color-accent` (`oklch(59.6% 0.145 163.225)`, emerald-600) had only ever been a filled background,
with `--color-on-accent` existing precisely because white on it measured 3.67:1. The footer's author
name is the first place it is a text colour. Computed on `--color-page` (`#0a0a0a`): the accent's
relative luminance is 0.2223 against the page's 0.00304, giving **5.13:1** — past the 4.5:1 floor
that applies, since the footer is `text-xs` (12px, so not large text).

Two consequences. This is the usage that **fails first** if the accent token is ever darkened, and
nothing in the repo would catch it — jsdom computes no colour, so `Footer.test.tsx` can only assert
the class name. And the class name assertion is not padding: an unknown Tailwind colour utility in
this app emits **no rule at all**, so `text-accent-green` or `text-emerald` would leave the name
rendering in the inherited `text-fg-muted` with all four checks green. Verified in the built CSS —
`dist/assets/*.css` contains `.text-accent{color:var(--color-accent)}`.

## 2026-08-12 — The footer's author name became the app's first and only `<a>`, which is a set of conventions this repo had never had to apply

Asked for as "make it bold and a link". The `<span>` became
`<a className="font-bold text-accent focus-visible:focus-ring" href={COPY.footer.authorUrl}
target="_blank" rel="noreferrer noopener">`. Four things the change surfaced, none of them obvious
from the request:

1. **There was no prior anchor anywhere in `src/`** (grepped `href=` and `<a `: zero hits), so every
   habit the app has for interactive elements — the focus ring, the `rel` hygiene — existed only on
   `<button>`s and had to be re-derived here. `focus-visible:focus-ring` matters more than usual
   because this component renders on **all four screens**, so the link is in the tab order mid-game
   too.
2. **Both dialogs trap Tab**, so the link is unreachable behind an open modal. That is what keeps the
   pre-existing "footer before the dialogs in the DOM" ordering sufficient rather than merely tidy —
   a focusable footer after a modal's buttons would otherwise have been reachable.
3. **The URL went into `copy.ts` but NOT into `notice`.** `COPY.footer.notice` is subtracted by exact
   string from three screens' `textContent` in the year-shaped-number leak proxies; an `href` is not
   part of the sentence a player reads, and folding it in would have broken that subtraction. It is
   also not picked up by `LandingScreen.test.tsx`'s `auditableText`, whose spoken-attribute list is
   `alt`/`aria-label`/`title`/`placeholder`/`value` — checked, because the proxies are the app's
   cheapest guard against a pre-reveal leak.
4. **`font-bold` is doing a11y work, not only what was asked**: colour alone is not a link
   affordance, and this is the app's smallest (12px) and dimmest line. Verified in the built CSS that
   both `.font-bold` and `.focus-visible\:focus-ring:focus-visible` emit rules — same silent-no-op
   check the accent colour got, since an unrecognised utility here produces nothing at all.

Unrelated, noted while running the suite: `src/components/SuggestionButton.test.tsx` (untracked,
work in progress from another session) fails with `Invalid Chai property: toHaveAttribute` — this
repo does not set up `@testing-library/jest-dom`, so that matcher does not exist here. Use
`getAttribute()` instead. Pre-existing and unrelated to the footer change.

## 2026-08-12 — Suggestion multi-select: `src/` fires its first pointer event and uses its first fake clock, and both work

Built holding-to-select on the landing screen's suggested playlists (`src/game/playlist-selection.ts`,
`src/hooks/useLongPress.ts`, `src/components/SuggestionButton.tsx`; thresholds added to
`src/game/gestures.ts`). Six things learned, and the first two reverse assumptions that were written
into the plan as risks.

1. **jsdom has no `PointerEvent` constructor, and `fireEvent.pointerDown` works anyway.**
   `@testing-library/dom` falls back to a plain `Event` and copies the init properties — including
   `clientX`/`clientY` — straight onto the object. `useLongPress` reads nothing else from the event,
   which is now a deliberate constraint rather than a coincidence: read `pointerId`, `pressure` or
   `getCoalescedEvents()` and the fallback stops carrying it. This was scoped as "verify early, and
   fall back to asserting wiring only if it does not hold". It held.
2. **`vi.useFakeTimers()` is fine in `src/`, which had never used it.** Every other waiting test in
   `src/` awaits a real `setTimeout`; at a 500 ms threshold that would have cost ~5 s across the
   suite. `act(() => vi.advanceTimersByTime(...))` drives the timer and flushes React together. The
   `api/_lib/cache.test.ts` pattern — restore real timers in a `finally`, never only in an
   `afterEach` — matters more here than there, because these files share a worker with other jsdom
   files and a leaked fake clock breaks whatever runs next.
3. **The click that follows a hold is the bug this feature is one line away from.** `click` fires
   after `pointerup`, so without `consumeLongPress()` the hold selects the playlist and the click a
   millisecond later deals a single-playlist deck from it — i.e. the gesture that exists to BUILD a
   multi-playlist deck would instead start a game and discard the selection. The flag is cleared by
   the next `pointerdown`, **not** by the click: a hold whose pointer produced no click (released off
   the button, or cancelled by a scroll) would otherwise leave it set and swallow an unrelated press
   much later.
4. **Deriving the selection from the rows made two requirements disappear instead of being built.**
   "Pressing the ✕ deselects" and "a pasted link lights its suggestion" are both free once a
   suggestion is lit exactly when a row parses to its id. The only code the ✕ needed was a _rendering_
   change — it used to appear only when `rows.length > 1`, so a lone selected row had none, and the
   first selection on a pristine screen lands in exactly that row.
5. **Tailwind's source scan sees an unimported component, so a CSS delta cannot be isolated by
   reverting the import.** Building with `LandingScreen.tsx` stashed produced a byte-identical
   stylesheet (same content hash), because `SuggestionButton.tsx` was still on disk and Tailwind v4
   scans files rather than the module graph. The JS delta isolates cleanly: **213.00 → 215.05 kB raw,
   66.63 → 67.40 kB gzip (+2.05 / +0.77)** on `index-*.js`. Same trap as the "utility class names
   harvested out of prose" finding: what generates CSS here is not what the bundler imports.
6. **`--color-accent` as a selected border measures 5.26:1 on `--color-page` and 4.76:1 on
   `--color-surface`**, both clear of the 3:1 non-text floor (WCAG 1.4.11) — so no new token was
   introduced. The tick beside the label is not decoration: a border colour is colour alone, which
   1.4.1 forbids as the only differentiator, and `aria-pressed` covers the non-visual half.

Two smaller notes. The `toHaveAttribute` failure recorded in the footer entry above was this work in
progress and is fixed — the assertions use `getAttribute()`, and it stands as a good reminder that
`@testing-library/jest-dom` is not set up here. And `LONG_PRESS_DURATION_MS` deliberately lives in
`gestures.ts` beside `TAP_MAX_DURATION_MS` rather than in a module of its own: it must stay above it,
nothing compares them at runtime, and **no rendering would change if they crossed** — a press would
merely satisfy both readings with event ordering picking the winner. Proximity plus one assertion is
the entire enforcement.

## 2026-09-18 — A welcome screen in front of the picker, a static PDF behind a service worker, and the deck's first step backwards

Two developer requests, both outside any plan: an explanatory front door with a big Start button (and a
button downloading a supplied PDF of year cards for playing on a table), and a left swipe that steps back
a card while a right swipe keeps advancing. Findings, in the order they bit:

1. **The service worker's SPA fallback would have served the app in place of the PDF.** `generateSW`
   defaults `navigateFallback` to `index.html` for any navigation the precache does not hold, and the PDF
   is deliberately not precached (`globPatterns` has no `pdf`; 240 kB on every install for a file most
   players never download). So a click on the link in a worker-controlled tab would have been a
   navigation to an uncached URL — i.e. the welcome screen reloading. Fixed by adding `/\.pdf$/` to
   `navigateFallbackDenylist`, next to `/^\/api\//`. The `download` attribute is NOT the fix: whether
   an `<a download>` request even reaches the worker as a `navigate`-mode request differs by browser.
   Verified in the built `dist/sw.js` (the denylist carries `pdf$`, and `year-cards` appears nowhere in
   the precache manifest); **unobservable under `pnpm dev` or `vercel dev`**, since `devOptions` is absent.
2. **`vercel.json`'s rewrite already lets the file through.** Its source is `/((?!api/|@)[^.]*)` — any
   path with a dot is excluded from the SPA rewrite — so `public/year-cards-1970-2033.pdf` needs no
   configuration to be served. Worth knowing before adding a second static asset with an extension.
3. **The leak proxies fire on a printed year range, and the right response is the footer's.** The welcome
   copy says "year cards from 1970 to 2033", which matches `\b(19|20)\d{2}\b` twice. It derives from a
   PDF on disk rather than from any deck, so it is not a leak — and the pattern was NOT loosened. The
   sentence lives in ONE constant (`COPY.welcome.printDetail`) and `WelcomeScreen.test.tsx` subtracts it
   by exact string, exactly as every pre-start proof subtracts `COPYRIGHT_NOTICE`. Putting the range in a
   second string would silently escape the proxy's subtraction and fail the test — which is the intended
   failure.
4. **`card-ring` met its first caller that is not `absolute inset-0`.** The welcome screen's decorative
   card is in flow, so it has to carry `relative` itself — the utility deliberately declares no `position`
   (the cascade-order reasoning is in `index.css`), and without it the gradient band anchors to `<main>`
   and draws a 2px ring around the whole screen. Its test pins `relative`, `rounded-card`, `aria-hidden`
   and "no digit", the same both-ends shape as `Card.test.tsx`.
5. **The welcome screen is a container flag, and the three edge cases fell out of one condition.**
   `idle && deckLink === null && !hasEnteredPicker` — a share link never sees the welcome screen, a saved
   session resumes past it, and Exit/Home land on the picker. One documented behaviour did change: a
   **malformed** link now shows the welcome screen rather than the picker, still with no error, because
   `parseDeckLink` returns `null` for it. `App.test.tsx`'s test and AGENTS.md's sentence were updated
   rather than papered over. In `App.test.tsx` the walk-through is a CONDITIONAL `enterPicker()` inside
   the two `start*` helpers, because not every path starts at the front door.
6. **`PREVIOUS` resets the flip, and that is a leak rule rather than a preference.** `isFlipped` describes
   the current card and nothing records which earlier cards were revealed; `YEAR_RESOLVED` can slide the
   deck under the player, so "the card before this one" may be a card they never flipped, and carrying the
   flag over would show its year. Resetting costs a player who DID reveal it one tap. On card 1 the action
   returns the SAME state object, which is what lets the hook's latched commit end as a Motion snap-back
   rather than as anything the reducer has to model.
7. **Direction became a decision, so it moved into `gestures.ts`.** `swipeDirection` used to pick only the
   exit animation (both directions advanced — Phase 5 decision 2). `swipeIntent(direction)` now also picks
   the action, as a pure function with node tests, because jsdom cannot exercise a drag and an inline
   mapping in `useCardGestures` would be untested full stop — while a backwards one turns every "next"
   into "previous" with no DOM test noticing. Every "the deck is one-directional" sentence in `src/`, `README.md` and the top-level `docs/` was rewritten with it; `docs/plans/` (Phase 5 decision 2 and its neighbours) records what was decided at the time and was left alone.
8. **`LandingScreen.test.tsx > should submit a full URL for every suggestion` needed its own timeout, and the numbers say load rather than a defect.** It renders THIRTEEN full landing screens in one test. In this tree it failed **2 of 2** full runs against Vitest's 5 s default (8.7 s, then 7.2 s); a full run of the untouched last commit, in a worktree sharing the same `node_modules`, passed it at 386 ms; and in isolation it measured anywhere from 281 ms to 1.4 s in EITHER tree depending on whether the transform cache was warm. `LandingScreen` and its test were not otherwise changed, so the likeliest cause is scheduling -- a 51st jsdom file and a longer `App.test.tsx` moving this file alongside the `motion` transform. Fixed the way the 2026-08-06 `beforeAll` finding fixed the same shape: `{ timeout: 20_000 }` on that one test, with the measurements in its comment. Not a behavioural change to anything the test asserts.

## 2026-09-18 — The picker got a Back button, and "Exit lands on the picker" survived it as a flag set from three places

The welcome screen went in front of the picker earlier today with no way back to it short of a reload.
The developer asked for a Back button on the picker (`COPY.landing.backToWelcome`, a ghost `<button>`
top-left, disabled while a request is loading). Three findings:

1. **The flag is set by three things and cleared by one, and the `ended` branches had to honour it.**
   Entry 5 above explained "Exit and Home land on the picker" as a consequence of those paths going
   through `ended`. That stopped being the reason today: `hasEnteredPicker` is now set true by the
   welcome button AND by Exit AND by Home, and set false by Back — and the two `ended` branches that show
   the landing screen (`deckCollapsed`, and `endedView === 'landing'`) render the welcome screen instead
   while the flag is false. Without that second half, Back after an Exit would have been a dead button:
   the status is still `ended`, the branch would have kept returning the picker whatever the flag said,
   and the only way to the front door would have stayed a reload. The `idle` branch first kept its
   `deckLink === null` guard, and that was wrong in two reachable states, both found in review: a link
   whose fetch FAILED showed the picker with an ENABLED Back that did nothing (the flag was already
   false, the guard still refused), and a link-dealt deck collapsing to zero reached the front door
   instead of the `no-years-found` warning. The fix is `useState(deckLink !== null)` — a link counts as
   having pressed through — after which every picker-showing branch reads the one flag and no branch
   consults `deckLink`. `App.test.tsx` pins the failed-link case. Exit and Home still land on the picker; they do it by setting the flag,
   which is what the heading of this entry means.
2. **Returning to the picker from the welcome screen remounts `LandingScreen`, so typed rows are lost.**
   The rows live in the picker's own state, and the container switches components rather than hiding
   one, so a welcome → Back → welcome-button round trip starts from a blank row. The loss is accepted, not
   persisted; the button is disabled while a request is loading, so nothing in flight can be lost, only
   text that was typed. Anyone wanting to keep the rows would have to lift them out of `LandingScreen`
   (into `App.tsx` or a storage shadow), which widens the one file that knows all the statuses. Recorded
   as row 8 of `development.md` §5's welcome-screen table.
3. **The lead sentence under the tagline was cut, and the copy rule made it a one-line change.**
   `COPY.welcome.lead` restated the three "How it works" steps in one breath, so the hero is now the logo,
   one tagline and the button. Deleting the constant and its one render site touched no test, because no
   test ever knew what the sentence said — the property `src/game/copy.ts`'s header promises, cashed in.
   The tagline was reworded in the same pass; likewise nothing to update outside `copy.ts`.

## 2026-09-18 — Under Vite 8.2 `GET /api/playlist` returns `index.html`, not the handler's transpiled source

Reproduced the `pnpm dev` trap while diagnosing a "Spotify returned something we could not read" on Start
with a suggested playlist selected. `docs/development.md` §4 and the comment above `parsePlaylistBody`'s
caller in `src/game/playlist-client.ts` both describe Vite serving `api/playlist.ts` as **transpiled
source** with `text/javascript`. On Vite 8.2.0 the observed response to
`http://localhost:5173/api/playlist?url=…` is the **SPA fallback** — `index.html`, `text/html`, status
`200`. The `vercel.json` rewrite that excludes `api/` from the fallback is read by Vercel only, so Vite
knows nothing about it. The client's outcome is identical either way: a 200 whose body is not JSON, so
`readJson` yields `undefined` and the player reads `unexpected-payload`. Not a bug, and the prescription
is unchanged — `npx vercel dev`. Confirmed the app side is healthy the same day: the real `api/playlist.ts`
served over a throwaway `node:http` wrapper (`tsx`) returned the full 100-card deck for the "Hitster"
suggestion and a 200 for "Top 50 Global", and the live embed page still carries `__NEXT_DATA__` with the
exact `props.pageProps.state.data.entity.trackList` shape the adapter parses. One more trap met on the
way: `vercel dev` itself refused to start with "The specified token is not valid" until `vercel login`,
and the preceding "Worker timed out after 10 seconds / write EPIPE" lines are the CLI's update check,
not the failure.

## 2026-09-19 — Eight review findings on the welcome-screen and left-swipe work, and what each turned out to be

A `/code-review` of `develop` against `main` produced eight findings; all eight were acted on the same day.
What follows is what was measured, not what the review claimed. Existing dated entries above that
describe the 2026-09-18 state (`/\.pdf$/`, the `printDetail` range, the 20 s test timeout, the
link-only seed) are left as history and are superseded here.

1. **The committed PDF blob really was corrupt, and the working tree was not — both facts at once.**
   `git cat-file -s HEAD:public/year-cards-1970-2033.pdf` = 239331 bytes; the working tree = 239354.
   Git's binary heuristic is a NUL in the first 8000 bytes; this PDFsharp file is pure ASCII there, so
   with `core.autocrlf=true` and no `.gitattributes` the add stripped every CR — all 23 of them inside
   object 28, an uncompressed XMP metadata stream (`/Length 1446`, first divergent byte 237161). Both
   files say `startxref 238571`; the working tree's `xref` is at 238571, the blob's at 238548, and the
   blob's `/Length` overstates its stream by 23. Every PNG/WebP in `public/` is `i/-text w/-text`
   (their headers hold NULs), so this was the only file exposed. Why the deployed download still opened:
   readers rebuild the xref when `startxref` misses and tolerate an overlong `/Length` on an
   uncompressed stream. The worse latent hazard was the OTHER direction: the blob is 100% LF, so any
   Windows checkout rewriting the path would have CRLF-converted every LF, including inside the
   FlateDecode streams, which is not recoverable. Fix: `.gitattributes` with exactly `*.pdf binary` (no
   `* text=auto` — on this Windows checkout that would renormalise unrelated files on the next add),
   then `git rm --cached` + `git add` on the path — a bare `git add` skips a stat-clean file. After:
   `attr/-text` (the `i/mixed` reading is git's content heuristic and is expected for a NUL-free
   binary-by-attribute file), staged blob = 239354 bytes, `cmp` identical to the working tree. Any
   future NUL-free binary format needs the same attribute line.

2. **The service-worker PDF denylist failed on any query string.** `workbox-routing@7.4.1`'s
   `NavigationRoute._match` runs the denylist over `const pathnameAndSearch = url.pathname + url.search`
   (and never reads `url.hash`), so `/\.pdf$/` did not match `/year-cards-1970-2033.pdf?v=2` and the
   worker would have served `index.html` for the download. Fixed to `/\.pdf(\?|$)/`; `dist/sw.js` now
   carries `denylist:[/^\/api\//,/\.pdf(\?|$)/]` and `year-cards` still appears nowhere in it. The
   literal is closed over inside the `VitePWA` plugin call and is not importable by any test, so the
   check is a regex table plus the built worker. Accepted corner: a URL whose _query_ ends in `.pdf` is
   also exempted; no such route exists.

3. **A resumed session that collapsed to zero reached the welcome screen with no warning.**
   `hasEnteredPicker` was seeded from `deckLink` alone, which is `null` for any non-link resume. A save
   taken during the card-1 gate (`persistence.ts` accepts `preparing`) whose every remaining lookup finds
   nothing, or a pre-reversal save of all-null years (which `RESUME` filters to empty on the spot),
   landed on `deckCollapsed` with the flag false. Fix: `useState(deckLink !== null || state.status !==
'idle')`. The discriminating fact was hydration timing: `useGameSession` runs `RESUME` inside
   `useReducer`'s lazy initializer (`use-game-session.ts:101`), so `state.status` on App's first render is
   already the restored status — the same fact `deckLink`'s own initializer relied on. Had `RESUME` been an
   effect the seed would read `idle` and be a no-op. Rejected: making `deckCollapsed` force the picker
   (a dead Back button — Back clears the flag while the collapsed state persists) and any `deckLink`
   check in a branch. Two `App.test.tsx` tests pin it; the pre-reversal one asserts synchronously on the
   first render, so it is the one that fails if `RESUME` ever moves into an effect. The three
   `hasEnteredPicker ? landing : welcome` branches collapsed into one `picker` constant.

4. **The exit animation contradicted the deck once left meant "previous".** `exitDirection` was hook
   state only a drag ever set, defaulting to `'left'`, so every keyboard advance flew left and an
   ArrowLeft after a right swipe flew right. Now `exitDirectionFor(previousIndex, nextIndex)` in
   `gestures.ts` (pure, node-tested; equal → `'right'`), latched in `CardStack` and handed to
   `<AnimatePresence custom>`, read by `CARD_VARIANTS.exit(direction)` in `Card.tsx`. Three Motion facts
   from the installed source (motion-dom / framer-motion 12.43.0) make `custom` the only correct channel:
   an exiting child animates with the props of its LAST render, and a keyboard advance changes the index
   and removes the card in the same render, so a plain prop never reaches it; `animation-state.mjs` ~36
   reads `type === "exit"`'s custom from `visualElement.presenceContext?.custom`, i.e. the
   `AnimatePresence` prop of the render that removes the child; and lines ~138–150 never re-resolve an
   exit already running, so a year landing or a second fast swipe cannot redirect a leaving card. Two
   type/lint constraints shaped the code: Motion's `exit` prop type is `TargetAndTransition |
VariantLabels` (no function), so `variants` + `exit="exit"` is the typed route to a dynamic exit;
   and `eslint-plugin-react-hooks` 7's `refs` rule forbids reading `ref.current` in render, so the
   previous index is a `useState` latch (adjust-state-in-render shape, one discarded render per index
   change) rather than a ref. The latch tracks the presence KEY, not the index: a yearless card dropped
   from behind lowers the index under the same card with no exit, and the current card dropped yearless
   changes the key with a zero delta. Card-1 decline: the reducer returns the same object, `useReducer`
   bails, the key does not change, nothing exits. jsdom cannot see which way a card flies; row 9 of
   `development.md` §5 is the manual check.

5. **A leak proxy that subtracts a string it never reads is indistinguishable from one that works.**
   `COPY.welcome.printDetail` no longer carries "1970 to 2033" (it says "from 1970"); the range lives in
   the download link's `download` (`COPY.welcome.yearCardsFileName`) and `href` (`YEAR_CARDS_PDF_PATH`),
   neither of which the `auditableText` attribute list read, so the year proxy passed by omission. Fix:
   the helper moved to the shared `src/components/__fixtures__/auditable-text.ts` (both copies were
   verbatim), its list gained `download` and `href`, and `WelcomeScreen.test.tsx` asserts `toContain` on
   both strings BEFORE subtracting them — that assertion is what fails if an attribute drops out of the
   list. Adding `href` costs subtracting `COPY.footer.authorUrl` on every screen that runs the audit.
   `PreparingScreen.test.tsx` still audits `textContent` alone (it renders no audited attribute today).

6. **The 20 s test timeout was hiding cost, not defending behaviour.** The per-suggestion submission
   test rendered thirteen full landing screens; what it defended is the round-trip
   `parsePlaylistUrl(spotifyPlaylistUrl(id))` for every entry of `SUGGESTED_PLAYLISTS`, which now runs
   with no render in 0 ms. The "render once, click each in turn" alternative does not work: after the
   first press the row is lit, `isSelecting` flips, and the next press toggles selection instead.

7. Copy: `COPY.landing.intro` was reworded at the developer's request to "Paste or select up to 5
   Spotify playlists to deal a deck and start playing." — one value, no test touched.

Under concurrent edits to the game-screen chunk, `App.test.tsx` showed 1–2 timeouts (~1.1–1.3 s against
the 1 s default) on 3 of 8 runs, each a different pre-existing test, never on a quiet tree. Re-run before
trusting a red result from a tree that is changing under Vite's transform cache.

## 2026-09-19 — Reviewing the two Google Play plans against the repo: one was finished but unticked, the other was never started and had gone stale in four places

Neither [`plan.google-play-shell.md`](./plans/plan.google-play-shell.md) nor
[`plan.google-play-back-button.md`](./plans/plan.google-play-back-button.md) had ever been added to
`AGENTS.md`'s Documentation Index, which is how a built plan and an unstarted one came to be reviewed
together five weeks after they were written. Both are corrected in place; what follows is what the
review found, so the next reader of either does not re-derive it.

**Plan 2 (the back button) was complete except for its device rows, and looked half-done.** Steps 1–4
and every unit test were ticked on 2026-08-12, but all five Documentation Updates were still `[ ]`
while every one of them had landed — the AGENTS.md block, the `architecture.md` §3 subsection, the
seven `development.md` §5 rows, the findings entry above, both file headers. Ticked now, each with a
pointer to where it landed. The plan also predates the welcome screen (2026-09-18): its
"landing, preparing or end" lists gained "welcome", and it gained an open question the front door
created — the picker's on-screen Back button returns to the welcome screen while Android's back
gesture closes the app, so the two "back" affordances now disagree on that screen. Not built, and
deliberately: it would be the app's second `pushState`.

**Plan 1 (the shell) has not been started — no `android/`, no `.well-known/`, no `privacy.html`, no
`docs/store/`, no JDK, no SDK, no Bubblewrap on this machine — and four of its statements were wrong
or stale by the time anyone read it:**

1. **"The PWA icons carry no wordmark" was false when written and is false now for a different
   reason.** They read "PLAYLIST HITSTER" on 2026-08-11 (AGENTS.md records that nobody opened the
   image) and "PLAYLIST JITSTER" since the 2026-08-12 artwork. The plan's conclusion — the rename
   invalidated no artwork — happened to come true by regeneration, not by the reason it gave.
2. **The trademark pass has one concrete player-visible hit the plan did not name**:
   `SUGGESTED_PLAYLISTS[0].label === 'Hitster'` in `LandingScreen.tsx`, a button on the picker. It is
   a rendering of the Spotify playlist's own title, but it is also what a listing screenshot shows.
   Left in place and recorded as the plan's open question; renaming it is the developer's call.
3. **Its sequencing note planned for plan 2 to land inside the fourteen-day closed test.** Plan 2
   landed before plan 1 started, so the note is rewritten: plan 2's seven device rows run on plan 1's
   step 9 (URL-bar) and step 12 (verified) installs, and the plan says so at both steps.
4. **Its unit tests were sequenced to be red for eight steps.** "Should list two fingerprints" and
   the `twa-manifest.json` cross-pin cannot pass between step 4 (placeholder file, empty list, no
   `android/`) and step 12 (fingerprints known). Split into two batches.

Three things the review added rather than corrected. The **two download paths** the shell has to
prove — the welcome screen's static `<a download>` (a navigation the service worker must not answer
with `index.html`; its denylist entry is unobservable under any dev server) and jsPDF's `doc.save()` —
are step 9 rows. **A Chrome TWA shares `localStorage` with Chrome on the same origin**, so
`hitster:session:v1` is one store seen from two launchers; a game started in the installed app
resumes in the browser and vice versa. Documented as a property, not a defect, because a tester who
does not know it will report a ghost game. And **Bubblewrap's default application id** reverses the
origin's host, which for a `*.vercel.app` origin puts the app under `app.vercel.…` — a namespace
the developer does not own, frozen into the one string that can never change. The plan now says
developer-owned reverse-DNS; the value is still open.

Later the same day the origin was decided: **`https://playlistjitster.vercel.app`**. Measured with
`curl`: it answers `200` from Vercel and serves the manifest at its root, and the old
`custom-hitster.vercel.app` — which this log recorded as the deployment origin on 2026-08-04 —
now `307`-redirects to it. The TWA must therefore bind to the new host and never the old one: a
TWA whose bound origin redirects is a URL bar. The developer's first application id,
`playlist-jitster`, is not a valid one (no hyphens; at least two dot-separated segments); the
decided value is **`aleixrabassa.playlistjitster`** — the developer's name as namespace, since no
domain is owned. Both permanent strings are now in the plan's step 1 and step 6.

Three adjacent staleness fixes made in passing, all in files the plans point at. `architecture.md`
§6 quoted the SPA rewrite as `/((?!api/).*)`; the file has been `/((?!api/|@)[^.]*)` for some time,
and the `[^.]*` is exactly what plan 1's steps 3 and 4 rely on to keep `/privacy.html` and
`/.well-known/assetlinks.json` out of the shell. `plan.md`'s Post-Phase-8 entry still called the
multi-playlist UI plan "not built" — it was built 2026-08-07, as AGENTS.md has said since 2026-08-12.
And `development.md` §5's back-press table said every row needed the asset-link-VERIFIED build and
repeated the superseded landing window; it now says which rows run on which of plan 1's two installs.
One wording rule the review applied to itself: "rows 1–6 can run on the URL-bar build" rests on a
Custom Tab having the same history stack as a verified TWA, which is expected and not yet observed,
so every place that says it now says so.

Measured for the plan rather than remembered: `@bubblewrap/cli` is at **1.25.0**, published
2026-09-16 (`npm view`); `vite-plugin-pwa`'s `ManifestOptions` already types `id`, `lang`,
`dir: 'ltr' | 'rtl'` and `categories: string[]`, so step 2 is a value change with no type work; and
the Vercel CLI is not installed here, so the production alias is confirmed in the dashboard.

## 2026-09-19 — Vite copies `public/.well-known/` into `dist/`, and the asset-links file stays out of the precache manifest

Step 4 of [`plan.google-play-shell.md`](./plans/plan.google-play-shell.md) asked for three things to
be **measured rather than assumed**. Two of them can be measured locally and were; the third needs a
deploy and there was none in this session.

**The dot-directory is copied.** `public/.well-known/assetlinks.json` (223 bytes) lands at
`dist/.well-known/assetlinks.json` byte for byte after `pnpm build` under Vite 8.2. This was worth
checking rather than trusting: `publicDir` copying has historically skipped dotfiles in some
versions, and the failure would have been a 404 on the one path Android fetches — with a green build,
a working app and no message anywhere. It is copied, so no `viteStaticCopy` workaround or rename is
needed, and the `.well-known` path can stay where the spec requires it.

**It is absent from the precache manifest, as intended.** `dist/sw.js` holds **20** precache entries
and none of them is the asset-links file: `grep assetlinks dist/sw.js dist/workbox-*.js` returns
nothing, and neither does `well-known`. The reason is `globPatterns` in `vite.config.ts`, which lists
`js,css,html,webp,png,svg,woff2` and deliberately not `json` — the one `.json`-shaped entry in the
list is `manifest.webmanifest`, which the plugin adds itself. This is the right outcome rather than a
lucky one: **asset-link verification is performed by the Android system, not by the webview**, so a
browser-local copy could never be the one that is read, and a stale cached statement would be a
liability with no upside. It is the same reasoning that keeps `year-cards-1970-2033.pdf` out of the
glob.

One thing the same build output shows in passing: **`public/privacy.html` IS precached**, because it
matches the `html` pattern. That is harmless — it is a static page with no freshness story — but it
is worth knowing that the two new static files this plan adds are treated differently by the worker,
and that the difference comes from their extensions rather than from any decision about them.

**The third finding is not available here.** "Deploy, then fetch the file from the production origin
and confirm it returns the JSON with a JSON content type and is not rewritten to `index.html`" needs
a deployment; none was made in this session, so that sub-bullet is left unticked in the plan. The
local half of that concern is now pinned by `src/pwa/assetlinks.test.ts`'s
`should keep the SPA rewrite away from the well-known path and the policy`, which asserts
`vercel.json`'s one rewrite `source` still contains the `[^.]*` dot exclusion — a string assertion,
because re-implementing path-to-regexp's semantics in a test would produce a second answer that could
disagree with Vercel's, and a wrong test is worse than the manual fetch it would be pretending to
replace.

`src/pwa/assetlinks.test.ts` carries four tests, and its header names the **two it deliberately does
not carry** — `should list two colon-separated SHA-256 fingerprints` and `should agree with
android/twa-manifest.json about the package id`. Both belong to step 12: the fingerprint list is
empty until a keystore exists and `android/` does not exist at all, so writing them now would put two
red tests in the suite for eight steps, which is how a suite stops being trusted.

## 2026-09-19 — The Android toolchain installs, but neither half of it works the way Bubblewrap documents

Step 5 of [`plan.google-play-shell.md`](./plans/plan.google-play-shell.md) reads as three installs.
It is three installs and two traps, both of which present as "your SDK is broken" and neither of
which is. Written down because the next release runs against whatever the machine has then, and both
traps are in the tooling rather than in this repo — so they will still be there.

**Bubblewrap cannot be driven by an agent's shell, and `--version` proves it.** On first run it
prompts `Do you want Bubblewrap to install the JDK (recommended)?` before doing anything else, so
with stdin on the null device even `bubblewrap --version` dies with
`ERR_USE_AFTER_CLOSE: readline was closed`. The prompt is not specific to `init`; it is the CLI
noticing `~/.bubblewrap/config.json` is empty. Writing that file by hand is what makes every later
command non-interactive. **`init` and `build` remain interactive regardless** — they ask for the
application id, the colours and the keystore passwords — so those two are the developer's to run, and
the passwords must not reach a shell history either way.

**`~/.bubblewrap/config.json` must use forward slashes.** It holds `jdkPath` and `androidSdkPath` as
plain JSON strings, so a pasted Windows path fails with
`Bad escaped character in JSON at position 15` — position 15 being the `\U` of `C:\Users`. Forward
slashes work on Windows for both Java and Node, and avoid the double-escaping entirely.

**The current command-line tools have retired `sdkmanager`, and the shim does not forward package
names.** `commandlinetools-win-16111833` (cmdline-tools 23.0, the newest in Google's
`repository2-3.xml`) replaces `sdkmanager` with a new `android` CLI. The old binary still exists and
still runs, but `sdkmanager "build-tools;36.1.0"` answers `Package build-tools not found. Package
36.1.0 not found.` — it splits the argument on the semicolon. It also prints
`Warning: The --licenses option is no longer needed`, so the familiar `yes | sdkmanager --licenses`
does nothing. The invocation that works is
`android.exe sdk --sdk=C:/Android/sdk install "build-tools;36.1.0" "platform-tools" "platforms;android-36"`,
and licences are accepted as part of it.

**Bubblewrap then rejects a correctly installed SDK.** `AndroidSdkTools.validatePath` requires the
SDK root to contain a `tools/` **or** a `bin/` directory — it is looking for the pre-2020 layout where
the command-line tools unzipped flat into the SDK root. A modern SDK puts them at
`cmdline-tools/latest/bin`, so `bubblewrap doctor` reports
`The androidSdkPath isn't correct ... such that the folder of the path contains the folder "build"`,
which names neither the directory it actually checked nor the one it wants. Two NTFS junctions fix it
without a second copy of the 168 MB `lib/`:

```
New-Item -ItemType Junction -Path "C:\Android\sdk\bin" -Target "C:\Android\sdk\cmdline-tools\latest\bin"
New-Item -ItemType Junction -Path "C:\Android\sdk\lib" -Target "C:\Android\sdk\cmdline-tools\latest\lib"
```

After that, `bubblewrap doctor` reports `Your jdkpath and androidSdkPath are valid.`

**The build-tools version is not a free choice.** Bubblewrap 1.25.0 hard-codes
`BUILD_TOOLS_VERSION = '36.1.0'` and calls `zipalign` and `apksigner` from
`<sdk>/build-tools/36.1.0/` by that literal path, so a newer or older revision installed instead is
simply not found. Read the constant out of
`@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/androidSdk/AndroidSdkTools.js` when the CLI
version changes rather than guessing from the SDK manager's "latest".

Installed and verified this session: `@bubblewrap/cli` 1.25.0 (global), Microsoft OpenJDK 17.0.10
(`17.0.10+7-LTS`), Android build-tools 36.1.0, platform-tools 37.0.1, platforms;android-36,
cmdline-tools 23.0. `platform-tools` is not optional despite Bubblewrap never calling it: `adb` is
the only instrument step 12 has for
`adb shell pm get-app-links aleixrabassa.playlistjitster`, which is how the Android verifier's own
verdict is read rather than inferred from a missing URL bar.

## 2026-09-19 — `bubblewrap update` regenerates the whole Gradle project, so `android/` does not need tracking — with one trap

Decision 5 of [`plan.google-play-shell.md`](./plans/plan.google-play-shell.md) left it open whether
the generated Gradle project must be committed beside `android/twa-manifest.json`, and made the
answer depend on whether `bubblewrap update` can rebuild it from that file alone. **It can.** Read
out of the installed CLI (1.25.0) rather than run, because `android/` does not exist yet:

`update.js` calls `updateProject()` in `cmds/shared.js`, which loads `TwaManifest.fromFile()` and
then does exactly two things in order — `twaGenerator.removeTwaProject(targetDirectory)` and
`generateTwaProject(...)`. `removeTwaProject` deletes `DELETE_PROJECT_FILE_LIST`, which is
`settings.gradle`, `gradle.properties`, `build.gradle`, `gradlew`, `gradlew.bat`, `store_icon.png`,
`gradle/` and `app/` — the entire generated project. Everything put back comes from templates shipped
inside the CLI package, from `twa-manifest.json`, and from the icons it **re-fetches over the
network** from `iconUrl` (which it validates, and throws if absent).

**So `android/twa-manifest.json` alone is the release record, and the generated project can be
ignored** — which is what decision 5 hoped for and what `.gitignore`'s new block is already shaped
for (`android/build/`, `android/app/build/`, `android/.gradle/`, never `android/` itself).

**The trap is step 8.** That step says to read `targetSdkVersion` in the generated Gradle files and
bump it if Bubblewrap's default is behind Play's current minimum. `app/build.gradle` is in
`TEMPLATE_FILE_LIST`, so it is regenerated from the manifest on every `update` — **a hand-edit there
is silently discarded the next time anybody runs one**, and the symptom arrives months later as a
Play upload rejected for a target SDK that the repo appears to have fixed. Any such bump has to be
expressed in `twa-manifest.json` (or in a newer Bubblewrap), never in the generated file.

Two smaller consequences worth knowing before the first release. `update` re-fetches and re-validates
the icon URLs, so it needs the origin reachable and is not a purely local operation. And
`updateProject` writes a checksum file beside the manifest (`generateManifestChecksumFile`), which is
how `bubblewrap build` notices a `twa-manifest.json` edited without a following `update` — so the two
commands are a pair, and editing the manifest by hand without running `update` is a state the tooling
will complain about rather than silently accept.

## 2026-09-19 — `App.test.tsx`'s "should reset the end reason when a new game starts" is FLAKY, and it pre-dates this session

Observed while running the commit gate for
[`plan.google-play-shell.md`](./plans/plan.google-play-shell.md): the suite failed **twice in eight
runs** on one test and passed the other six, with no code change between runs.

```
FAIL  src/App.test.tsx > App > should reset the end reason when a new game starts
TestingLibraryElementError: Unable to find an element with the text: Deck finished
```

**It is not caused by that work.** `src/App.tsx` and `src/App.test.tsx` are untouched — `git status`
lists neither — and the plan that was being executed changes no application code by design. The
printed DOM shows why it is a race rather than a wrong assertion: the query runs while the **game
screen** is still mounted (the dump has the `session-audio` element and the HUD with its card count),
so the test is asserting on the end screen before the deck has finished advancing to it. It is a
missing wait, not a broken reducer, which is also why it passes most of the time.

**Two things to know before chasing a red suite here.** First, this one is **timing-dependent, so a
green run is not evidence a change is safe** and a single red run is not evidence a change broke
something — re-run before concluding anything. Second, a **loaded machine makes it much worse**: the
first run of the session, taken while an Android SDK was unzipping and three agents were working,
produced **15 `[vitest-pool-runner]: Timeout waiting for worker to respond` errors** alongside 572
passing tests in 37 files, and reported far fewer files than the 52 a clean run collects. That is the
pool giving up on workers under CPU pressure rather than anything about the tests, and it is worth
recognising because the output looks alarming and names no test.

Not fixed here — it is outside the google-play plans, which touch no application code. The fix is a
`findBy*`/`waitFor` on the end-screen assertion rather than a `getBy*`.

## 2026-09-19 — `pnpm format:check` fails on 31 files in this checkout, and it is a line-ending artifact rather than a regression

Worth recording so the next session does not chase it. `pnpm format:check` (`prettier --check .`)
reports **31 files** with "code style issues", almost all of them files nobody has edited —
`src/App.tsx`, `src/game/copy.ts`, `vite.config.ts`, most of `src/components/`.

**They are formatted correctly; they are just CRLF on disk.** `git config core.autocrlf` is `true`
here, so git writes CRLF into the working tree while storing LF, and `.prettierrc`'s
`"endOfLine": "lf"` makes Prettier flag every line. The proof is that the same content passes
straight from the object store:

```
git show HEAD:src/App.tsx | pnpm exec prettier --check --stdin-filepath src/App.tsx   # clean
```

`src/App.tsx` is clean at `HEAD`, carries CR bytes in the working tree, and is not listed by
`git status` — all three at once, which is only possible for a line-ending difference. Files written
directly by a tool rather than checked out by git are LF and pass, which is why the failing set looks
arbitrary.

**One file genuinely is unformatted at `HEAD`:** `docs/plans/plan.multi-playlist-core.md` fails the
same check when piped from the object store, so that one is real and predates this session.

**This does not make the repo's gate red.** `AGENTS.md`'s "Before committing" is
`pnpm typecheck && pnpm lint && pnpm test && pnpm build` — `format:check` is not one of the four, and
those four pass. Check formatting per-file on the files you actually touched
(`pnpm exec prettier --check <paths>`) rather than repo-wide, or the signal is drowned. Do **not**
"fix" it by running `pnpm format` across the repo: that would rewrite 30 untouched files and commit a
diff that is pure line endings.

## 2026-09-19 — The third asset-links finding, measured live: an EMPTY fingerprint list reads as MALFORMED, not as "reachable"

The entry above ("Vite copies `public/.well-known/` into `dist/`") closes with "the third finding is
not available here" — it needed a deploy and there was none in that session. Commit `8801190` was
pushed afterwards, Vercel deployed it, and the three fetches were re-run from this machine. This is
that third finding, and it is step 2 of
[`plan.play-store-todo.md`](./plans/plan.play-store-todo.md).

**`https://playlistjitster.vercel.app/.well-known/assetlinks.json`** answers `200`,
`Content-Type: application/json; charset=utf-8`, `Content-Length: 223`, `Server: Vercel`,
`X-Vercel-Cache: HIT`. The body is the statement list byte for byte — one statement, the
`android_app` namespace, `aleixrabassa.playlistjitster`, `sha256_cert_fingerprints: []` — and **not**
`index.html`. So `vercel.json`'s `/((?!api/|@)[^.]*)` rewrite does let the dot-directory through in
production, which until now was only pinned by a string assertion over the rewrite `source`. The
same fetch also confirms the file is served from `public/` untouched by the build.

**`https://playlistjitster.vercel.app/privacy.html`** answers `200`, `text/html; charset=utf-8`,
9,525 bytes. The listing's privacy-policy URL (step 14) resolves.

**Google's own checker is the finding worth writing down.** Fetching

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://playlistjitster.vercel.app&relation=delegate_permission/common.handle_all_urls
```

returns

```json
{
  "maxAge": "599.999999859s",
  "debugString": "* Error: invalid_argument: Could not parse statement list (must contain at least one certificate): []\n [0] while fetching Web statements from https://playlistjitster.vercel.app./.well-known/assetlinks.json ...",
  "errorCode": ["ERROR_CODE_MALFORMED_CONTENT"]
}
```

**That verdict is CORRECT for the placeholder, and it is worth more than a `200` would be.** It
proves the verifier's own fetch path end to end — right host, no SPA rewrite, a content type it
accepts, a document it parsed far enough to complain about its contents — while telling us something
the shape tests cannot: an empty `sha256_cert_fingerprints` list is read as **malformed content**,
not as "a reachable file that happens to delegate to nobody". So there is no in-between state to
mistake for progress: until step 11 writes both fingerprints, the only two readings of this URL are
`ERROR_CODE_MALFORMED_CONTENT` and a parsed statement list. A future session that sees this error
before step 11 should read it as the expected state, not as a bug in the file.

**Two caveats for anyone using the checker as an instrument.** The response carries
`maxAge: ~600s`, so Google caches its fetch for ten minutes — after the step-11 redeploy, wait at
least that long before concluding the new statement did not take, rather than looping on redeploys.
And the `debugString` shows it canonicalises the host with a trailing dot
(`playlistjitster.vercel.app.`) before fetching; that is normal DNS-root form and not a
misconfiguration to chase.

Both caveats are recorded beside the instrument in [`docs/development.md`](./development.md) §5 and
§9.

## 2026-09-19 — The first suggested playlist is really called "Hitser", and the mark existed only in our own label

Step 3 of [`plan.play-store-todo.md`](./plans/plan.play-store-todo.md) relabels
`SUGGESTED_PLAYLISTS[0]` from `'Hitster'` to `'Jitster official'` so that a screenshot of the picker
can reach the Google Play Console. `src/components/LandingScreen.tsx`'s own rule 1 says to verify
before shipping **any** change to that array, by `entity.uri` **and** `entity.name` in the embed
payload and never by a 200, so the verification was re-run rather than carried over.

**Fetched with the adapter's own request shape** — `https://open.spotify.com/embed/playlist/<id>`
with `api/_lib/spotify-embed.ts`'s `BROWSER_USER_AGENT`, because a bare curl UA is not what that
endpoint is measured against — and parsed out of `__NEXT_DATA__`:

| Field              | Value                                     |
| ------------------ | ----------------------------------------- |
| `entity.uri`       | `spotify:playlist:34cIJlWIX9TEoA8bpI2UBu` |
| `entity.name`      | **`Hitser`**                              |
| `entity.subtitle`  | `arich97`                                 |
| `entity.authors`   | `null`                                    |
| `trackList.length` | 100                                       |

**The playlist's real title is "Hitser" — one `t`.** So the label the picker had been rendering,
`'Hitster'`, was not a quotation of anything: it was this app's own tidied rendering of a typo, and
in tidying it we introduced the registered mark ourselves. That reframes the relabel completely. It
is not a departure from the array's "labels are readable renderings of Spotify's own titles" rule to
dodge a legal problem — the rule, applied literally, is what produced the problem, and the closest
faithful rendering available was always going to be the mark or the typo. The header comment now
says that the first row is labelled for the app rather than for its Spotify title, with the reason
and the date, so the rule and the array agree instead of the array quietly contradicting it.

**The owner question has an answer, and it is not in the field you would reach for.** The plan asked
who owns the playlist, because a personal playlist is a weaker promise than an editorial one and
"official" makes a promise of its own. `authors` is `null` — which is what AGENTS.md records at
playlist level and what both "added by" spikes found — but the owner **is** in the payload, as
`entity.subtitle`: `arich97`. The developer confirmed on the day that this is their own account, so
"Jitster official" is a claim this project is entitled to make. Worth knowing for the next time
something needs a playlist's owner: `subtitle` carries it, `authors` never has, and the `open.spotify.com`
page's `og:description` is not a reliable fallback (it returned nothing here).

**The id did not change**, and neither did the blurb. The relabel is invisible to the rest of the
suite by construction: eleven sites in `LandingScreen.test.tsx` read `SUGGESTED_PLAYLISTS[0]!.label`
symbolically and not one holds the literal, which is the design the file's header describes. What
was added is a guard — `should keep the registered mark out of every suggestion label and blurb`,
case-insensitive over both fields of every row — because the realistic way the word returns is not
an edit to this row but a NEW row named after whatever Spotify calls it. It is a leak-proxy-shaped
assertion over data rather than an assertion about `COPY.*` wording, which is what keeps it inside
the 2026-08-12 copy rule: the array is third-party playlist data the rule never covered, and the
trademark constraint is enforced by a store rather than chosen as a phrasing.

## 2026-09-19 — The `App.test.tsx` flakiness is the FILE, not the one test that was named, and it fails in isolation too

The 2026-09-19 entry above pins one flaky test —
`should reset the end reason when a new game starts` — and says a loaded machine makes the pool give
up on workers. Running the commit gate for [`plan.play-store-todo.md`](./plans/plan.play-store-todo.md)
step 3 reproduced all of that and widened it in two ways worth writing down, because the entry above
names a single test and the natural reading is that any OTHER red test in that file is real.

**Seven different tests in `src/App.test.tsx` failed across eight full-suite runs, no two runs the
same, and never more than three in a run:**

| Failure                                                                      | Shape                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `should not intercept a back press outside the game screen`                  | `expect(window.history.state).not.toEqual(base)` — state not yet pushed |
| `should save the whole set of playlists and show it on the landing screen`   | `Test timed out in 5000ms`                                              |
| `should save a played playlist and offer it on the landing screen`           | assertion, mid-transition                                               |
| `should render the welcome screen when idle, and the picker once entered`    | `Test timed out in 5000ms`                                              |
| `should not show the welcome screen again after an exit`                     | `Test timed out in 5000ms`                                              |
| `should reach the welcome screen with Back after an exit`                    | `Test timed out in 5000ms`                                              |
| (plus runs where only the pool errors appeared and 15 files never collected) | `Timeout waiting for worker to respond`                                 |

**Five of the seven are a bare `Test timed out in 5000ms`** and the other two are the shape the
entry above diagnoses for its single test: a `getBy*` or a synchronous read taken while the app is
still transitioning, which a slow machine loses. Not one of them is an assertion about a value being
wrong. So **treat a
red `App.test.tsx` as unproven rather than as a regression, whichever test it names.**

**It also fails in ISOLATION, which the earlier entry did not establish.** `pnpm vitest run
src/App.test.tsx` alone — 47 tests, no other file competing — failed **once in three runs**. So the
pool and the parallel load are an amplifier, not the cause; the races are in the tests themselves.

**Proven pre-existing, by the only check that settles it.** The working tree was stashed
(`git stash push -u`) and the same isolated run repeated **four times at `HEAD`**: it failed once, on
a **third** test again (`should save a played playlist and offer it on the landing screen`). Nothing
in the step-3 change is even reachable from these assertions — it is one label string in
`SUGGESTED_PLAYLISTS`, a comment, and a new pure test over that array — but "the change cannot have
caused it" is an argument, and a red run at `HEAD` is evidence. Do the stash run before concluding
anything about a red `App.test.tsx`; it costs two minutes and it is the only thing that distinguishes
a flake from a regression.

**Fixed later the same day — and the diagnosis in this paragraph was WRONG in the way that matters.**
It said the remedy was `findBy*` over `getBy*` plus a longer timeout. The failing tests already used
`findBy*`; what expired was Testing Library's own 1 s ceiling on it, which nothing in the repo had
ever raised. The entry below has the measurements, the fix, and one mechanism that was proposed,
probed and REFUTED on the way.

## 2026-09-19 — `App.test.tsx` is fixed: the ceilings were unit budgets on an integration file, one assertion raced a passive effect, and the "stray traversal opens the dialog" theory was probed and refuted

The two entries above record the symptom — seven distinct tests, timeouts and mid-transition reads,
reproducible at `HEAD` — and the second ends with "the remedy is `findBy*` and a longer timeout".
Half right: the failing tests **already used `findBy*`**. Commit `e3cc801` is the fix; its message
and the first draft of this entry claimed a cross-test race that a probe then disproved, so read
this entry rather than that message.

### What was measured before touching anything

Six isolated runs of the file with `--reporter=verbose`, one at a time on an idle machine, all
green. The slowest tests: `should not show the welcome screen again after an exit` — the first test
to reach `playing` — at **907–1124 ms**, and `should render the welcome screen when idle…`, whose
body is SYNCHRONOUS, at **714–874 ms** for one render. Testing Library gives every
`waitFor`/`findBy*` **1 s** (`asyncUtilTimeout`) and Vitest gives every test **5 s**. A fully
parallel run — fifteen jsdom forks on sixteen cores — reported `environment 1079s` across 52 files,
i.e. ~20 s per file just to set up jsdom, and stretched every one of those numbers by a small
multiple. That is the whole timeout family: `Unable to find an element with the text …` is `findBy*`
giving up at 1 s (the recorded "end reason" failure, and `× … 1275ms` at `HEAD`), and
`Test timed out in 5000ms` on the synchronous test — whose error block was never captured, so this
is inferred from its idle cost, not observed — is one render taking five seconds. Nothing to race.

### Fix 1 — integration budgets, per file, and PROVEN to be in effect

`configure({ asyncUtilTimeout: 5_000 })` from `@testing-library/react` and
`vi.setConfig({ testTimeout: 30_000 })`, both at the top of the file. The longest test waits four
times in sequence, so 4 × 5 s plus slack. Both are per file — Vitest isolates modules per file — so
nothing leaks into the unit suites. **Proven rather than assumed**, because a green run on a quieter
machine is consistent with "top-level `vi.setConfig` silently ignored": a throwaway `it` that slept
7 s passed, and a throwaway `waitFor` whose predicate first held after 2.5 s passed. Neither could
under the defaults. A green test never sees either number; a genuinely broken one fails in 5 s
instead of 1 s, which is the whole cost.

### Fix 2 — the `history.state` assertion polls instead of reading once

`should not intercept a back press outside the game screen` read `window.history.state` once,
synchronously, right after `waitFor` saw the HUD. The entry is pushed by `useBackNavigation`'s
mount effect — a PASSIVE effect, and the HUD arrives through a state update the year stub's promise
triggers outside `act`, so React commits the HUD and flushes the effect in separate steps. `waitFor`
observes the commit; under load the read landed in the gap. It is now
`await waitFor(() => expect(window.history.state).not.toEqual(base))`, which reports the entry
rather than a coincidence of timing.

### What was proposed, probed and REFUTED — recorded so nobody re-proposes it

The tempting story: `useBackNavigation`'s cleanup calls `history.back()` when `GameScreen` unmounts
in `afterEach`, jsdom queues that as **two nested `setTimeout(0)` hops** (jsdom 30,
`living/window/SessionHistory.js` lines 50 and 62), `beforeEach` resets the swallow counter while
the hops are still queued, so under load the traversal lands inside the NEXT test's game screen as
a real back press → exit dialog → guard 4 disables ArrowRight → the deck never finishes → timeout.
It fits every symptom and it is **wrong**, for the reason the 2026-08-12 entry already recorded:
**jsdom discards a queued traversal that a `pushState` beats** —
`History-impl.js`'s `_sharedPushAndReplaceState` calls `clearHistoryTraversalTasks()` on the push
branch (line 97), and the next game screen's mount pushes. A probe that reached `playing`, called
`cleanup()` and `resetBackNavigationTraversals()` exactly as the hooks do, reached `playing` again,
drained two hops and looked: **no dialog, `history.state` still the back entry, ArrowRight reached
the end screen.** Note the asymmetry that made the back-press test the one exception: the `replace`
branch (line 107) does NOT clear the queue, so a `replaceState(base)` in a test can still see the
previous test's traversal move the entry under it.

### What the drain in `afterEach` is, honestly

`afterEach` now awaits `flushHistoryTraversal()` — two `setTimeout(0)` hops inside `act` — after
`cleanup()`, so the previous test's traversal lands inside the test that caused it. Deterministic
rather than probabilistic, because jsdom's window timers are Node timers and Node fires equal-delay
timers in insertion order. It is **hygiene**, not the fix for any timeout: it keeps a traversal from
landing during the next test's pre-game phase, where a `replaceState` would let it move the entry.
Two things it does NOT do. The hook's cleanup removes its `popstate` listener BEFORE calling
`history.back()`, so when the drained traversal lands nothing is listening and **the swallow counter
stays at 1 — `resetBackNavigationTraversals()` in `beforeEach` is still load-bearing**, and deleting
it on the strength of the drain would reintroduce the swallowed first press it was added for. And
the two fixed 50 ms sleeps the back-press test used to have were what a loaded machine defeats (a
0 ms timer inserted late has a LATER expiry than an earlier 50 ms one), so they are replaced by the
drain plus the poll above, not by a longer sleep.

### Checked and found not to be a race

The double `ArrowRight` in `should save the whole set of playlists…`: RTL's `fireEvent` is
`act`-wrapped so each dispatch commits before the next line, `onNext` dispatches to the reducer,
which reads state rather than a closure over the index, and two `NEXT`s on two cards reach `ended`.
Left as it was.

### Acceptance

The isolated file green **10 of 10** consecutive runs, then the full suite green **3 of 3**
(867/867, 58–64 s each, `environment` 482–536 s) — after eight consecutive red full runs before the
change on the same day. A quieter machine than the red runs, which is why the budget probes above
exist: the green runs alone could not distinguish "budgets applied" from "drain plus idle machine".

## 2026-09-20 — Play account and device: both of step 1's long waits are running, and the emulator question is moot

`plan.play-store-todo.md` step 1 asked for two things that cost calendar time and for the decision
that follows from them. All three are now answerable.

**Play developer account: registered 2026-09-20, fee paid, identity verification SUBMITTED the same
day and pending.** That date is the one to measure the wait from — it is what step 9 (create the
Console app) blocks on, and therefore what steps 10–12 and gate M2 block on transitively. Nothing
between here and step 8 needs it, so the local shell path (steps 4–7) runs in parallel by design.

**Device: a physical Android 13-or-newer phone, obtained 2026-09-20.** This closes the open question
"which rows may an emulator satisfy" as **moot rather than answered** — the question existed only for
the case where no physical device was available, and the plan's own caution was that an
emulator-only verdict is doubtful on exactly two rows (lock-screen audio, and Android 13+ predictive
back, row 7) with predictive back being the one whose remedy would live in `android/`. With real
hardware at 13+, **every row in `docs/development.md` §5 is satisfiable on the real target**, and the
closed-testing AAB (final after gate M2, step 12) will not rest on an emulator verdict for anything.
An emulator stays permissible only where `docs/store/listing.md` §4 already allowed it: screenshots.

**What is still unrecorded about the device, deliberately:** the model and the exact Android release.
Neither was read from the hardware, and guessing either into this file would be the sort of claim the
repo's rules exist to prevent. Capture both at step 7, when `adb` is in play anyway and the answer
comes from the device rather than from memory — `C:\Android\sdk\platform-tools\adb.exe shell getprop
ro.build.version.release` and `... ro.product.model`. Row 7's precondition is the release number, so
it is worth having written down before the row is marked passed.

**Consequence for sequencing:** the critical path is now identity verification, and it is already
running. Steps 4–7 (init the shell, keystore, target SDK, first build with the URL bar expected) need
no account and no Console, so they should proceed immediately rather than waiting on the mail.

## 2026-09-20 — `bubblewrap init` run: one silent defect, one inverted heuristic, and the checksum file identified

Step 4 of `plan.play-store-todo.md`. `android/` now exists. Five things worth keeping, the first of
which is a defect the plan could not have anticipated because it assumed a prompt that does not exist.

### `enableNotifications` defaults to TRUE and is never prompted for

Both the plan and `docs/development.md` §9 said to "decline notification delegation" at the `init`
prompts. **Bubblewrap 1.25.0 never asks.** The field is written as `true` by default, and the
generated `android/app/src/main/AndroidManifest.xml` then carries
`<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>` plus a `DelegationService`
and a set of `ic_notification_icon` drawables. An Android 13+ user would be asked to allow
notifications for an app that sends none, and `public/privacy.html` — which the Data safety form at
step 14 is filled from — enumerates what leaves the device and mentions no notifications at all.

Fixed by setting `"enableNotifications": false` in `android/twa-manifest.json` and regenerating;
`POST_NOTIFICATIONS` is gone from the regenerated manifest, verified by grep. The durable guard is
`should decline notification delegation` in the new `src/pwa/twa-manifest.test.ts`. **Re-check the
field after every future `init` or `update`** — nothing prompts for it, so only the test will say.

Two other prompts also never appeared, both correctly defaulted: **shortcuts** (only offered when the
web manifest declares a `shortcuts` section, and ours does not) and the **Custom Tabs fallback**.

### `bubblewrap update --skipVersionUpgrade` is the non-interactive form

`update` prompts for a version name when `appVersionName` and the previous `appVersionCode` disagree
(`dist/lib/cmds/shared.js`), and bumps the code otherwise. With `--skipVersionUpgrade` there is no
prompt on any path and the first upload stays at version code 1, which is why it is the form to use
for a regeneration that is fixing configuration rather than shipping a release. Read from the CLI
source, then run: it completed non-interactively and left `twa-manifest.json` byte-identical.

### `android/manifest-checksum.txt` — identified, and the plan's rule for it inverts here

The open question asked for its name and whether `build` reads it. It is a **SHA-1 of
`twa-manifest.json`** (not of the web manifest), written by `init` and `update`. `bubblewrap build`
reads it in `dist/lib/cmds/build.js`: **absent**, it prompts "would you like to regenerate your
project?"; **present but stale**, it prompts to update.

The plan said "if `build` warns when it is absent, track it". It does warn — and tracking it is still
wrong, because **every file that checksum certifies is ignored**. On a fresh clone (which has
`twa-manifest.json` and nothing else of `android/`) a tracked, matching checksum would make `build`
_skip_ the regeneration prompt and then fail on a missing `gradlew`. Absent, the prompt fires and
rebuilds exactly what the clone lacks. **So the prompt is the recovery path, not a warning to
silence**, and the file is ignored. The reasoning is written into the `.gitignore` block itself,
because that is where someone would go to "fix" it.

Consequence worth knowing at step 7, and it differs by machine. **On this one** the regeneration
above rewrote the checksum, so the first `bubblewrap build` finds it matching and does **not** prompt.
**On any fresh clone** the file is absent by design — it is ignored — so the first `build` there
prompts "would you like to regenerate your project?", and the right answer is **yes**: that prompt is
what rebuilds the `app/` and `gradlew` the clone does not have. A later hand-edit of
`twa-manifest.json` makes it prompt on either machine, and the answer is yes there too.

### `signingKey.path` was written as an absolute Windows path

`init` recorded `C:\repos\custom-hitster\android\android.keystore` in a file that **is tracked**.
Changed to `./android.keystore`. The path is passed verbatim to `jarsigner`/`apksigner` with no
`path.resolve` anywhere in the CLI, and the build's own input and output file names are plain
relative names — so the working directory is the project directory, and the relative form resolves.
**The constraint that comes with it: always build from inside `android/`** (`cd android &&
bubblewrap build`), never `bubblewrap build --directory android` from the repo root. Survived the
regeneration unchanged. It is empirically confirmed at step 7 either way: a wrong keystore path fails
the build loudly, before anything is published.

### Target SDK, and one open cosmetic question

Bubblewrap emitted `targetSdkVersion 36`, `compileSdkVersion 36`, `minSdkVersion 21` — the newest API
level available, so no bump is plausible. **Play's own minimum for new apps is still owed** and must
be read from the Console policy page on the day (step 6); it is not recorded here because it was not
read, and a remembered number is exactly what that step forbids.

Not a defect, left for the developer: `navigationColor`, `navigationDividerColor` and the three
`*Dark` colour fields all default to **`#000000`**, while the page is `#0a0a0a`. It is the same 4%
luminance step that made the logo's pure-black backdrop read as a pasted square at 192px, and the
remedy would be the same — raise the floor to `#0A0A0A`. Whether it is visible at the navigation bar
is a judgement to make on the device at step 7, not from a colour value.

## 2026-09-21 — Play's target API minimum read: 36 for new apps, which is exactly what Bubblewrap emitted

Closes the half of step 6 that 2026-09-20 left open, and it closes it **without** the Console page
the step names — for a reason worth recording, because the same obstacle will recur at every step
written as "read it in the Console".

**The requirement.** From **31 August 2026**, a new app (and any update) must target **Android 16,
API level 36**, or higher. An app already on the store must target **API 35** to stay available to
new users. The exceptions are all form factors this app is not: Wear OS and Automotive at 35, TV and
XR at 34. An extension to **1 November 2026** can be requested from the Console.

**So no bump is needed and none is possible.** Bubblewrap 1.25.0 emitted `targetSdkVersion 36` /
`compileSdkVersion 36`, which is the requirement exactly and also the newest level there is. The
step's conditional half — express a bump in `android/twa-manifest.json`, never in the regenerated
`android/app/build.gradle` — did not fire, and the rule stands unused for the next August.

**Where it was read, and why not the Console.** The app does not exist in the Console yet — that is
step 9 — and the policy pages the step means are **per app**, so there is nothing to open. The
account-level "Policy center" (`Centro de políticas` in Spanish) reports the status of apps you have,
not the table of requirements. `support.google.com/googleplay/android-developer/answer/11926878`
answered a fetch with a `302` to Google's captcha interstitial, so the value comes from
**`developer.android.com/google/play/requirements/target-sdk`**, which is the canonical page the
Console's own help links to and the one Google updates each August.

**The step's "do not carry over a remembered number" rule was honoured** — this was fetched today,
not recalled — but note what is now on record and what is not: the requirement is read from Google's
developer site, and the Console has still never been opened on this subject. If the Console shows a
different number at step 9 or at the first upload, **the Console wins** and this entry is the thing
to correct.

---

## 2026-09-21 — The first sideloaded install worked, and the URL bar was removed ahead of schedule with the upload key alone

Three things happened in one session: step 7's build turned out to have already been run, the APK
installed and played, and the developer asked for the Chrome URL bar to go — which decided an open
question the plan had parked for a trigger that never came.

**The install path, because `adb` never entered it.** `adb devices` listed nothing and
`Get-PnpDevice` showed no Android device on USB at all — not an unauthorised one, not a driver
problem, nothing enumerated — which is the signature of a charge-only cable. The APK was transferred
to the phone and opened from the file manager instead. **`adb` is not needed before step 12**, where
`pm get-app-links` is the instrument; it is worth knowing that the whole of step 7 runs without it.

**"El paquete no es válido" was the transport, not the build.** A first sideload attempt was refused
with that message. Verified locally before touching anything:
`apksigner verify --verbose --print-certs` reports the APK verifies under v1, v2 **and** v3 schemes,
one signer, `CN=Aleix Rabassa`, RSA 2048. The file in `android/` was never the problem. Re-sending it
installed it. **The lesson is the diagnostic order**: verify the artefact at source before debugging
the device, because "invalid package" names the file and means the copy.

**The fingerprint's source is `apksigner`, not `keytool`.** The open question proposed
`keytool -list -v` on the keystore. `apksigner verify --print-certs` is strictly better and was free
here — it prints the certificate **on the APK the phone installed**, rather than a keystore entry
believed to be the one that signed it. Value:
`BA:A4:32:03:3C:D9:B4:AC:07:FE:7D:03:88:23:E5:69:42:1B:BC:80:99:2D:F9:1D:FA:9A:D2:92:96:D2:21:75`.

**What was deployed and what is still owed.** `bubblewrap fingerprint add <sha256> --name=upload`
writes the value into `android/twa-manifest.json`'s `fingerprints` array — the record — and
**implicitly runs `generateAssetLinks`**, which drops `android/assetlinks.json` beside the config.
That file is git-ignored as of today: it is output, and a statement with two homes is exactly the
disagreement a URL bar reports. The generated statement was copied to
`public/.well-known/assetlinks.json` and Prettier-formatted. **Play's app-signing fingerprint is
still missing and that is now the single reason the file is incomplete** — it verifies every local
sideload and nothing a tester installs from the store, so step 11 **adds** Google's beside it and
never replaces it.

**Two arguments in the open question did not survive contact.** It said the batch-B count test
"would pin it red" — that test has never been written, so the objection was hypothetical. And it
framed the cost as "a deliberately half-right deployed file"; the concrete cost turned out to be two
stale prose sentences (`AGENTS.md`, `docs/architecture.md` §3) and two stale comments in
`src/pwa/assetlinks.test.ts`, all rewritten in the same commit as the fingerprint.

**The count test is still unwritten, and the reason inverted.** Before today it would have been red
because the list was empty. Now a test asserting **two** is red against a deliberately half-complete
file, and a test asserting **one** would go red at step 11 on the correct change — which is worse,
because it teaches that finishing the file is a regression. Write it when Play's fingerprint lands,
asserting two.

**Not yet verified**: that the bar actually disappears. That needs the deploy, Google's ten-minute
`maxAge` to expire, and a **reinstall** — Chrome caches TWA verification per install, so a relaunch
alone can keep showing the bar and read as a failure that is not one.

---

## 2026-09-21 — The asset-links deploy landed, and two cache windows were mismeasured

Both were read off live responses after the fingerprint commit deployed, and each would have been
read as a failed deploy by someone waiting the documented time.

**Vercel's edge served the OLD statement on the bare URL for ~41 minutes after the deploy.** A fetch
of `https://playlistjitster.vercel.app/.well-known/assetlinks.json` came back `X-Vercel-Cache: HIT`,
`Age: 2454`, 223 bytes, empty fingerprint list — while the same path with a `?cb=<epoch>` tail came
back `MISS`, 336 bytes, the new statement. Same deploy, two answers, and **the bare URL is the one
the Android verifier asks for**. The bare URL refreshed on its own shortly after. The practical rule:
when checking a redeployed statement, fetch it **both** ways — a cache-busted fetch tells you whether
the deploy happened, and only the bare fetch tells you what the verifier will see. Confirming with
the query string alone would have declared success over a stale file.

**Google's checker caches a VALID statement for 3600 s, not 600.** The `maxAge: 600s` recorded on
2026-09-19 belonged to the `ERROR_CODE_MALFORMED_CONTENT` response for the empty list; the successful
response measured today carries `maxAge: 3599.998301537s`. The plan's step 11 said "wait at least 600
seconds" on the strength of the error figure and has been corrected to 3600. This matters exactly
once more, at step 11 proper: after Play's fingerprint is added, the checker can keep serving today's
**one**-fingerprint statement for a full hour, which looks identical to a deploy that did not take.

**Where verification stands.** The checker now returns the statement with the upload key and no
error. The URL bar has **not** been observed gone — that needs an uninstall and a clean reinstall on
the phone, because Chrome caches TWA verification per install.

---

## 2026-09-21 — The URL bar is gone, and the experiment that removed it is better than the one the plan designed

A clean reinstall of the **same** sideloaded APK, after the upload key's statement deployed, launches
with no Chrome address bar. Before the deploy the same APK showed one. **The build, the signing key
and the package id were all held constant; only the deployed statement changed** — which is a
stronger attribution than the plan's own design, where the before came from a step-9 build and the
after from a differently-built step-12 one. Everything in the chain is now confirmed end to end: the
statement is reachable and un-rewritten, its content type is right, Google's checker parses it, and
Android's verifier accepted it.

**What this does NOT establish, and the distinction is the whole reason the file is still
incomplete.** Play re-signs uploads with its own app-signing key, so the certificate a tester's
install presents is **not** the one just verified. Today's evidence says nothing about that build.
`docs/development.md` §5 TWA row 1 is marked half passed and re-runs in full at step 12.

**The reinstall was necessary, not cautious.** Chrome caches TWA verification per install; a
relaunch of the already-installed app is not a test of a redeployed statement. This is worth
remembering at step 11, where the same reflex will be to relaunch and conclude the second fingerprint
did not take.

**Method note.** `adb` was never available in any of this — no device ever enumerated over USB. The
whole of step 7 up to this point ran on a file-manager sideload, and the instruments were
`apksigner`, `curl` against the origin, and Google's checker. `adb` first becomes necessary at step
12's `pm get-app-links`, which is the one check that reads the verifier's own verdict rather than
inferring it from the absent bar.

---

## 2026-09-21 — The app plays end to end inside the TWA, and this is the first time the shell has been exercised as a game

§5 TWA row 6, passed on the sideloaded build: a cold launch lands on the welcome screen, the button
enters the picker, a suggested playlist deals a deck, a preview plays and a card flips. **Every other
device row assumes this one**, so until today none of them was worth running.

**Three things it incidentally confirms**, none of which had ever been observed outside jsdom and a
desktop browser. The welcome screen really is what a cold launch shows — the 2026-09-18 decision not
to persist a "seen it" flag, seen from the launcher rather than from a reload. The `/api/playlist`
and `/api/year` path works from inside a TWA, which nothing had tried: the shell renders in Chrome's
profile but the deployment is the same origin, so there was no reason to expect otherwise and also no
evidence. And audio starts from a tap inside the activity, which is the autoplay-policy question that
only a real launcher can answer.

**Scope, same as row 1.** Rows 1 and 6 are the two that run on both builds. This is the sideloaded
half; the Play-signed build is a different signing key and its half is owed at step 12. Both rows are
marked `Half passed 2026-09-21` rather than passed, and the distinction is not pedantry — a TWA that
fails verification still plays perfectly, so "it works" is exactly the observation that does not
transfer.

**Still outstanding in step 7**: rows 2 (both PDF downloads, the static one on the second launch), 4
(storage shared with Chrome, both directions) and 5 (lock-screen audio), plus the back-press rows
1-6 and an attempt at 7. Row 3 (a shared deck link opens the app with its query string intact) was
scheduled for step 12 and became runnable today, for the same reason row 1 did.

---

## 2026-09-21 — Step 7's device pass: eleven rows answered, one accepted deviation, one worry retired

Run on the sideloaded, upload-key-verified build. **Rows 1, 2, 3, 4 and 6 of the TWA table passed**,
as did **back-press rows 1–6**. Three of those are worth more than a tick.

**Row 2 counted only because the static PDF was pressed on a LATER launch.** On a first launch the
service worker is not answering anything, so the `.pdf` denylist — the whole reason the row exists —
is not exercised. Both files landed and opened.

**Row 3 ran two steps early and for free.** It was scheduled for step 12 because it needs App Link
verification; the upload key's deploy delivered that. The link opened the app rather than Chrome and
the deck dealt, so the query string survived the hand-off — the failure mode here is a bare `/` and a
welcome screen with no error at all.

**Row 5 half passed, and the other half is a DEVIATION THE DEVELOPER ACCEPTED.** Locking produced
silence, as designed. Unlocking and pressing Play **restarted the preview from 0:00** rather than
continuing. This contradicts `useCardAudio`'s own documented contract — it calls `element.pause()`,
which preserves `currentTime`, and the comment says so. Nothing in the hook changed and nothing in it
is wrong; the reading is that **Chrome releases the media resource for a backgrounded TWA activity**,
so the later `play()` re-fetches from the start. **That mechanism is unverified** and is not
reproducible in any local environment. Shown the behaviour, the developer judged it acceptable and
asked for no fix. It is therefore recorded as accepted, in §5 and in the hook's own comment, with an
explicit "do not fix without asking" — a seek-back to the remembered position would be **new**
behaviour traded against an accepted one.

**Row 7 (predictive back) was not run, but the thing that made it risky is retired.** The row was
written around the possibility that the generated shell keeps the legacy back behaviour, in which
case the fix would live in `android/` and a shell already published would need a new release. Read
today from `developer.android.com/guide/navigation/custom-back/predictive-back-gesture`: predictive
back is **enabled by default**, and `android:enableOnBackInvokedCallback` is an opt-**out**. The
generated `AndroidManifest.xml` sets it nowhere, so the default applies and **no `android/` change is
indicated**. What is left is only how to observe the animation, which depends on the OS: Android 15+
shows it automatically (the developer option was removed), while Android 13 and 14 keep it behind
Settings → System → Developer options → **Predictive back animations**.

**What this pass is worth, stated precisely.** Every row here ran on a build signed with the UPLOAD
key. Play re-signs, so the store build presents a different certificate; rows 1 and 6 run on both
builds by design and the rest re-run at step 12. A TWA that fails verification still plays perfectly,
which is exactly why "it all works" is the observation that does not transfer.

---

## 2026-09-21 — Identity verification cleared, and the whole Console half of the plan unblocked at once

Registered and submitted 2026-09-20, **verified 2026-09-21** along with every other profile check —
one day, against a wait the plan budgeted days for and deliberately started on day 0 for that reason.
Step 1's gamble paid: nothing between steps 2 and 8 needed the account, so the local shell path ran
in parallel and is finished.

**What this releases is not one step but the rest of the critical path.** Step 9 (create the app), 10
(upload to internal testing and read both fingerprints), 11 (publish the second fingerprint) and 12
(gate M2) were all blocked transitively on this, and each is a prerequisite of the next. Steps 13–17
follow behind them.

**The AAB does not need rebuilding.** Step 10 uploads the one step 7 already produced,
`android/app-release-bundle.aab` from 2026-09-21. Nothing about the shell changed after it was built,
and rebuilding would produce a differently-signed artefact for no reason.

**Two things to carry into step 10 that are easy to get wrong there rather than here.** The Console
binds the package id `aleixrabassa.playlistjitster` from the **first uploaded bundle**, not from any
field at app creation — so `AGENTS.md`'s permanence rule bites at step 10, and there is nothing to
type wrong at step 9. And the app-signing page then shows **two** SHA-256 fingerprints; the upload key
is already deployed (see today's earlier entry), so step 11 adds **Google's app-signing key** beside
it. Taking only one is the mistake that presents as a URL bar on exactly half the installs.

**Still open going in**, all in `docs/store/listing.md` §5 and the plan's Open Questions, none of them
blocking app creation: whether the content-rating questionnaire's user-generated-content question
applies to arbitrary track titles, whether Vercel's access-log IP retention must be declared in Data
safety, and where the twelve testers come from.

---

## 2026-09-21 — Back-press row 7 FAILED, and the inference that said it could not is the more useful half

Reported by the developer on the Android 15+ device: pressing back during a game shows **the app
shrinking and minimising** before the exit confirmation appears. That is exactly the disagreement
`plan.google-play-back-button.md` wrote row 7 to catch — the OS previewing the app leaving while the
web app is in fact handling the press.

**An entry made hours earlier said the shell-side risk was retired. It was wrong, and the way it was
wrong is worth more than the result.** The reasoning: the generated `AndroidManifest.xml` sets no
`android:enableOnBackInvokedCallback`; that attribute is an opt-**out**; therefore the shell is on the
modern predictive-back path and nothing in `android/` needs changing. Every clause is true, sourced
from Android's own documentation fetched the same day, and the conclusion still does not follow —
being _on_ the predictive-back path is what makes the system animate, and the system animating is the
defect. **A correct premise chain reasoned to the opposite of what the device shows.** The row existed
because nobody could check this locally, and it earned its place.

**The obvious remedy looks inert, which is the second finding.** `android:enableOnBackInvokedCallback="false"`
on `<application>` is the one-attribute opt-out — but the generated manifest declares only
`LauncherActivity`, `FocusActivity`, `WebViewFallbackActivity` and the delegation service. **The
activity rendering the web content belongs to Chrome**: a TWA launches it into this app's task, while
it is declared in Chrome's manifest and runs in Chrome's process. An attribute on this
`<application>` therefore governs the launcher shell, not the activity Android is animating. This is
**reasoned, not measured** — confirming which activity is resumed needs `adb shell dumpsys activity
activities`, and no device has ever enumerated over USB on this machine.

**Bubblewrap offers no lever regardless.** `@bubblewrap/cli` 1.25.0 contains no
`enableOnBackInvokedCallback` anywhere — not as a `twa-manifest.json` field, not in
`@bubblewrap/core`'s `template_project` manifest. So even the inert edit would be a hand-edit to a
file `bubblewrap update` regenerates, which is the trap already documented for `targetSdkVersion`.

**The decision is the developer's, and the options are:**

1. **Accept it as cosmetic.** The confirmation still appears, the deck is intact, nothing is lost —
   the row's own wording is "looks broken even though nothing is wrong". Cost: the first-time
   impression on the gesture Android users make most often. Same shape as row 5's accepted deviation.
2. **Try the opt-out anyway.** Cheap to attempt, likely inert for the reason above, and if it works it
   needs a post-`bubblewrap update` checklist entry in `docs/development.md` §9 plus a test that greps
   the generated manifest — a test that fails after every regeneration until the edit is reapplied,
   which is the honest shape for a hand-edit that must survive.
3. **Register a real `OnBackInvokedCallback` in the shell.** Out of scope for this plan: Java in a
   generated project, no test surface, and it would duplicate the web app's decision in a second
   language — and it is unclear it can even see a press Chrome's activity is handling.

**Timing, which is load-bearing exactly here.** The row exists to run _before_ the closed-testing AAB
is final, and it still is: `android/app-release-bundle.aab` is built and **not uploaded**. A shell
change costs a rebuild today and a whole new release after step 16. Step 9 (create the Console app) is
unaffected either way and can proceed now.

---

## 2026-09-21 — Row 7 decided: accepted as cosmetic, which closes step 7 and makes the built AAB final

The developer chose option 1 the same day the row failed. **Predictive back's preview animation stays
as it is**, and the reasoning is that the alternatives buy nothing: the one-attribute opt-out is
likely inert because the animated activity is Chrome's rather than this shell's, Bubblewrap exposes no
field for it, and applying it anyway would mean a hand-edit to a file `bubblewrap update` regenerates
— a fragile edit traded for an effect the analysis says will not occur. The confirmation dialog still
appears, the deck survives, and nothing is lost but a first impression.

**Three consequences, and the third is the one with a deadline attached.**

It is now written into `docs/store/tester-notes.md` under "Things that are expected", in the plain
language that file is written in. That is what makes accepting it different from ignoring it: twelve
people are about to press back during a game, and the ones who do not know will file it. The note also
invites them to say if it bothers them, which keeps the decision reversible on evidence rather than
closing it.

**Row 7 does not re-run at step 12**, unlike rows 1–6. Play's signature changes the certificate the
verifier compares, not the back animation, so a second observation would cost a device pass and tell
us nothing new. This is the one row in either table whose re-run is deliberately cancelled.

**Step 7 closes, and with it the window this row existed to protect.** The row was scheduled before
the closed-testing AAB is final precisely so a shell-side remedy could still be cheap; the decision
not to make one means `android/app-release-bundle.aab`, built 2026-09-21, is **final and uploadable as
it stands**. Step 10 uses that artefact. Gate M2a is reached — with the caveat already recorded that
M2a's own wording ("the URL bar is present") was overtaken when the fingerprint deployed early, so the
milestone is passed in both directions on one build and step 12 still owes the same evidence against
the Play-signed one.

---

## 2026-09-21 — The app is paid (€1.00), and the order this was decided in is what saves the package id

Developer's decision, reversing "Free" in the plan, `listing.md` §5 and plan 1 before it. The number
is the least interesting part.

**Google allows paid → free and refuses free → paid.** Verbatim from
`support.google.com/googleplay/android-developer/answer/6334373`, fetched today: "Once your app has
been offered for free, the app can't be changed to paid. If you want to charge for the app, you need
to create a new app with a new package name and set a price." So the irreversible answer was **Free**,
and it would have been irreversible in the one currency this project cannot spend —
`aleixrabassa.playlistjitster`, `manifest.id` and `start_url` are permanent after first publish, and a
new package name discards all three plus the asset-links statement built on them. **Deciding this
before step 9 rather than after is worth more than the decision itself**; a week later it would have
been a rebuild of the store identity.

**It creates a new calendar wait, which is why it became its own step 9a rather than a note.** Google's
sequence is "set up a payments profile → review the price ranges → enter a price". A payments profile
is a merchant account: bank details, tax residency, its own verification. **The original plan never
needed one**, so step 1 — whose entire purpose was starting long waits on day 0 — did not start it.
It does not gate app creation, so step 9 runs in parallel, but it gates the App pricing page and
therefore any release that charges.

**Two numbers are deliberately NOT in this repo.** Whether €1.00 clears Play's EUR minimum was not
sourced and is not guessed; and what €1.00 nets after Play's service fee, and whether the €1 is
VAT-inclusive because Google is merchant of record in Spain, was not verified. Both are read off the
payments profile at step 9a. Writing a remembered number here is exactly the mistake the target-SDK
entry avoided on 2026-09-21.

**A new question with a deadline at step 16: how do twelve testers get a paid app without paying?**
Play's license testing is the candidate and is configured per account rather than per track. Until it
is settled, `docs/store/tester-notes.md`'s "How to join" is knowingly stale — it says "install it as
you would any other app" and mentions no price — and now carries a visible internal note saying so,
to be deleted when step 16 rewrites it.

**One concern was raised and the developer reaffirmed the decision, so it is recorded rather than
re-argued.** The same game is free and public at `https://playlistjitster.vercel.app`, an origin this
plan pins as permanent; a €1 listing is compared against that by reviewers, and a paid thin wrapper of
a free site sits closer to Play's minimum-functionality scrutiny than a free one does. No product
change was made or proposed in response — that was not asked for.

## 2026-09-21 — How to read the year-cards template's geometry, and what it actually is

The developer asked for the deck's printable PDF to use the same card size and position as
`public/year-cards-1970-2033.pdf`. The template is a developer-supplied binary with no generator
script in this repo (`grep -rniE "reportlab|year-cards|year_cards"` finds only prose), so its
numbers had to be read out of the file. The procedure, recorded because the next person to touch
`pdf-sheet.ts` will need it and because getting it wrong is a wasted ream:

```python
import re, zlib, base64
data = open('public/year-cards-1970-2033.pdf','rb').read()
def stream(objnum):                      # content streams are ASCII85 + Flate, in that order
    m = re.search(rb'\n%d 0 obj\n(.*?)stream\r?\n' % objnum, data, re.S)
    hdr, s = m.group(1), m.end()
    raw = data[s:data.find(b'endstream', s)].strip(b'\r\n')
    if b'ASCII85Decode' in hdr: raw = base64.a85decode(raw, adobe=True)
    if b'FlateDecode'  in hdr: raw = zlib.decompress(raw)
    return raw
```

`zlib.decompress` alone fails with `incorrect header check` — **the ASCII85 layer has to come off
first**, and `/Filter [ /ASCII85Decode /FlateDecode ]` is in the stream dictionary saying so. That
one-line trap is why this is written down.

**What the file is.** `%PDF-1.3`, produced by ReportLab and re-saved by PDFsharp 6.2.4 (the XMP in
the last object names both, which is why an earlier note in `AGENTS.md` calls it a PDFsharp file and
`architecture.md` calls it ReportLab — both are half right). MediaBox `0 0 595.2756 841.8898`, i.e.
exactly A4. **Ten pages, not twenty** as `architecture.md` §3 said: page objects `4..11` carry the
year cards and `13, 14` carry a repeated decorative back XObject
(`/FormXob.ded6de700d43b284586ed35b52eb9b90`, drawn once per slot). 8 × 16 = 128 = 64 years × 2
copies, 1970 through 2033.

**The grid, identical on every page.** First slot: `n 20 559.7638 138.8189 138.8189 re S`. Column x
origins `20, 158.8189, 297.6378, 436.4567`; row y origins (PDF is bottom-up) `559.7638, 420.9449,
282.126, 143.3071`. So **4 × 4 = 16 slots**, a **138.8189 pt = 48.9722 mm square**, side margins
20 pt = 7.0556 mm and top/bottom margins 143.3071 pt = 50.5556 mm — centred on both axes, which is
what lets `pdf-sheet.ts` keep deriving its margins and keep the duplex-mirror identity
`xFront + xBack === PAGE_WIDTH_MM - CARD_SIZE_MM`. The year is `/F2 28 Tf` (Helvetica-Bold) centred
in both axes: baseline 619.1732 against a card spanning 559.7638..698.5827 is the card centre less
~10 pt, and the x origin is exactly half the string's width left of centre.

**The one thing NOT to copy from it.** The template is not a per-sheet duplex interleave — it is
eight front pages followed by two back pages. The deck export's `planSheets` interleaves front sheet
_n_ with back sheet _n_ because each of its cards has a QR on one face and an answer on the other,
which the year cards do not. Matching the template's page ORDER would pair every printed card with
the wrong answer. Size and position were the request; the pagination was not.

## 2026-09-21 — Motion's `custom` reaches EXIT only, and four more facts that decided the reverse-step animation

Making a step back play the deal in reverse — the returning card slides in from off the right edge
instead of the current one being thrown to the left — meant animating an INCOMING child for the first
time in this app. Five things were traced in `motion@12.43.0`/`framer-motion@12.43.0` before any code
was written. All five are load-bearing and none is obvious from the public docs.

1. **`<AnimatePresence custom>` feeds the exit variant and nothing else.** motion-dom's
   `render/utils/animation-state.mjs` resolves each active type with
   `type === "exit" ? visualElement.presenceContext?.custom : undefined`, and
   `resolveVariantFromProps` then falls back to `props.custom`. So an `initial`/`animate` function
   variant never sees the presence custom — it sees the component's own `custom` prop.
2. **Worse, the first-paint inline style sees no custom at all.** framer-motion's
   `motion/utils/use-visual-state.mjs` → `makeLatestValues` calls `resolveVariantFromProps(props,
list[i])` with the custom argument omitted entirely. A dynamic `initial` would therefore resolve
   its default branch for the first painted frame and only jump to the right one once the visual
   element mounted and re-resolved (`VisualElement.mjs:516` does pass `presenceContext?.custom`).
   **That is why the entrance is driven by a plain `movement` prop on `Card` while the exit keeps
   reading `custom`** — two channels for one value, fed from the same latch in `CardStack`.
3. **`AnimatePresence initial={false}` blocks only the FIRST render.** It renders
   `<PresenceChild initial={!isInitialRender.current || initial}>`, so every later entering child
   animates normally. The prop still does its one job — the session's first card does not fly in —
   and it did not have to be removed to add an entrance.
4. **Reduced motion JUMPS, it does not skip.** `animation/interfaces/visual-element-target.mjs`
   passes `{ type: false }` instead of the transition when `shouldReduceMotion && positionalKeys.has(key)`.
   So a card that mounts at `x: 600` under `prefers-reduced-motion` lands at 0 on the first frame
   rather than being stranded off-screen — which was the one way this feature could have broken an
   accessibility preference outright.
5. **`x: 0` renders `transform: none`, and this app never auto-sets `will-change`.**
   `render/html/utils/build-transform.mjs` emits the literal `none` when every transform term is at
   its default, and `addValueToWillChange` is a no-op unless `MotionGlobalConfig.WillChange` has been
   registered — which nothing in `framer-motion`'s or `motion`'s entry points does. **Both facts are
   what keep the FORWARD animation byte-identical to before.** The forward-entering card gets an
   `animate={{ x: 0 }}` it did not have, but it stays a non-positioned, non-transformed, no-stacking-
   context box, so the `popLayout`-absolutised card flying off it still paints on top (CSS painting
   step 8 over step 4). Give that card a `will-change: transform`, a non-zero forward `initial`, or a
   `position` class, and it is promoted to a stacking context — at which point DOM order decides and
   the outgoing card slides out from BEHIND the new one. Silently, with every test green.

The backward exit's `zIndex: -1` follows from the same painting rules: the outgoing card is
`position: absolute` (that is what `popLayout` does) and would otherwise cover the returning card, so
it is pushed to painting step 3, which is still above the deck's `-z-10` preload inside `CardStack`'s
`isolate`. It is applied with `transition: { zIndex: { type: false } }` because the computed origin
is the string `auto`, which is not a number to animate from.

**What no local check can reach.** jsdom computes no layout and no stacking context, and nothing
drives Motion's animation loop there, so two further behaviours were discovered only by reading:
a card that mounted at 600 px is still at 600 px on the next render (so the entrance has to be
asserted before the step back, not after), and `AnimatePresence` **re-enters** a child whose exit has
not finished rather than remounting it (`ExitAnimationFeature`, the `isPresent && prevIsPresent ===
false` branch) — in jsdom no exit ever finishes, so stepping 1→2→1 never remounts card 1 and
`initial` never applies. `CardStack.test.tsx` steps back two cards to get a real mount. In a browser
that same branch is a real 250 ms window, and it is harmless: a step back inside it re-enters the
leaving card, which lands at `x: 0` either way.

## 2026-09-21 — A type scale on a `<label>` sizes the `<input>` inside it, because preflight sets `font: inherit`

Matching `LandingScreen`'s component sizes to `WelcomeScreen`'s meant enlarging the playlist inputs
(`px-3 py-2 → px-4 py-3`). The first attempt left the row's `<label className="... text-sm">` alone
and the box stayed small-typed: **Tailwind's preflight gives every form control `font: inherit`**, so
a `text-sm` anywhere up the tree is the input's font size too — a `<label>` wrapper is not a
text-only element the way it reads. The fix is to move the scale onto the caption `<span>`, which is
the label's only other child, so nothing else changes. Worth knowing generally: in this repo a size
class on a wrapper around a control is a size class on the control.

Two more things from the same pass, both recorded because they are invisible locally:

- **The logo's top edge is exactly `<main>`'s top padding on both the welcome screen and the
  picker**, because the picker's Back button is `absolute` and the welcome screen has nothing above
  its hero. So "the logo at the same height on both screens" reduces to one class matching one class
  (`pt-8`), which is why it is asserted at both ends rather than once. There is no layout in jsdom to
  check the real thing against.
- **`git status` showed `MM src/game/copy.ts`** while none of the sessions in the transcript history
  had written to it: the unstaged hunk (`welcome.tagline` gaining the word "now") was **hand-edited by
  the developer**, and the Play-listing session that ran afterwards read the live value and aligned
  `docs/store/listing.md`'s Alternate B to it. Checked before touching either — an odd-reading string
  in the copy surface is not automatically a slip by a previous session.

## 2026-09-21 — A finger-driven step back: three things that decide whether it is visible at all

The developer asked for the left swipe to stop moving the current card and start moving the
**previous** one, one for one with the thumb, with the release only finishing the journey. Three
findings from building it, all of them invisible to `pnpm test`:

- **`EXIT_DISTANCE_PX` (600) is the wrong parking spot for a card the finger drags in, and the
  number says so.** A 360px viewport renders a 288px card inside `<main>`'s `p-6`, so the card
  spans x = 36..324 — and a peek parked at `x: 600` has its **left edge 276px past the right edge
  of the viewport**. The swipe commits at 96px, so the player would release before the card had
  entered the screen at all: the feature would be unobservable on the device it is for, with every
  test passing. The peek parks **one card-width out** instead (its left edge on the current card's
  right edge), which also makes the mapping 1:1 in CSS pixels by construction. 600 survives as the
  **keyboard** step back's entrance, where there is no finger and nothing on screen to continue
  from.
- **A `useTransform` output updates on Motion's frame loop, not synchronously inside the `.set()`
  that invalidated it.** Measured: after `peekProgress.set(0.5)`, reading the derived `display`
  motion value in the same tick still returns the old `'none'`; after one `setTimeout(0)` it is
  `'block'`. So a test against a derived value needs `waitFor`. **It is NOT a frame of lag in the
  browser, and an earlier version of this entry said it was** — `useCombineMotionValues`
  subscribes with `frame.preRender(updateValue, false, true)`, and Motion's frame steps run
  `read → resolveKeyframes → preUpdate → update → preRender → render`: the pan session writes the
  source value in `update`, the derived value recomputes in `preRender`, and the DOM is written in
  `render`, all in one frame. The same function also calls `updateValue()` **synchronously during
  render**, which is what makes the value already correct on the React render a commit triggers.
  The deferral is observable only where nothing renders and no frame runs between the `.set()` and
  the read — which is to say, in a test.
- **`MotionValue` is invariant in its type parameter**, so `useTransform(v, (p) => p > 0 ? 'block'
: 'none')` infers `MotionValue<'block' | 'none'>` and does **not** assign to a
  `MotionValue<string>` field. The fix is a return annotation on the transform callback
  (`(progress): string =>`), not a widened interface — the error is four levels deep in
  `PassiveEffect` and reads like a Motion bug.

Two smaller ones from the same pass:

- **`display` is the only one of the three hiding mechanisms that works here.** `opacity: 0` and
  `visibility: hidden` both leave the element laid out, and this element sits a full card-width to
  the right of the deck — the game would carry a permanent horizontal scroll on a phone for a card
  nobody has asked for. That is also why the peek's visibility is a `MotionValue` rather than a
  conditional render: a conditional needs React state, and the only place to set it is the
  per-frame drag handler.
- **Motion emits `transform: none`, not `translateX(0%)`,** once every transform term is at its
  default — so a test pinning the "dragged all the way home before releasing" entrance asserts
  `transform: none`. It is the correct end of the ramp, not a missing style.
