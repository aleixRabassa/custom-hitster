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

Incidental: `SUGGESTED_PLAYLISTS` labels that playlist **"Radio BrianPer"** while Spotify's
`entity.name` is **"Radio Brianper"**. Capitalisation in a label, not a functional problem, but noted
so the next re-verification does not read it as a mismatch.

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
