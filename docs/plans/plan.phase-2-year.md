<!-- Plans for phase-2 (in order):
  1. plan.phase-2-playlist.md  — URL parsing, the Spotify embed adapter, and /api/playlist
  2. plan.phase-2-year.md      — cache interface, MusicBrainz adapter, year resolution, and /api/year  ← this file
-->

# Plan: phase-2 (year) — Year Resolution & Cache

> **Task:** phase-2 — year-resolution half of the Data Layer
> **Date:** 2026-08-03
> **Author:** Aleix Rabassa
> **Source:** [plan.md](./plan.md) §5 — Phase 2, checkboxes 3–5
> **Depends on:** [plan.phase-2-playlist.md](./plan.phase-2-playlist.md) — supplies the `TrackRef` shape a lookup takes and the artist helper used to build a query

---

## Overview

Resolve each track's **original** release year. Spotify reports the album edition's date, so a 2011
remaster of Bohemian Rhapsody reads as a 2011 song — useless for Hitster, where the year _is_ the game.
MusicBrainz's earliest release date for a recording is the right value, which makes this a core
component rather than an enrichment pass.

This plan delivers the cache behind an interface (Upstash Redis in production, in-memory locally), an
adapter around the MusicBrainz recording search, the tiered resolution logic, and `GET /api/year`. It
covers Phase 2 checkboxes 3–5 in [plan.md](./plan.md) §5.

Two things make this the harder half. First, Phase 0 measured that a naive top-scored-recording lookup
is **~6% accurate** — 1 of 18 tricky tracks — because MusicBrainz has no canonical recording per song
and dozens of bootlegs, live takes, and reissues tie at the maximum relevance score. The fix is
measured and verified, and this plan encodes it precisely. Second, MusicBrainz allows **1 request per
second**, so resolution is inherently slow and the whole design bends around caching and progressive
loading.

**This plan also corrects a contradiction in [plan.md](./plan.md).** §2 and §4 both state the fallback
is "use the year from the Spotify embed data", but the Phase 0 spike recorded in the same document
established that the embed carries **no release date and no album name at track level**, with
playlist-level `releaseDate` null. That fallback is unimplementable. It is replaced by a tiered
strategy — see Chosen Approach — and the false statement is corrected in `plan.md` as part of this plan.

---

## Dependency Contract

### Requires from [plan.phase-2-playlist.md](./plan.phase-2-playlist.md)

| Input                                         | Description                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TrackRef` in `shared/types.ts`               | The lookup input: `title`, `artist` (raw joined string), `durationMs`                                                                                                                                   |
| `Card.year` / `Card.yearConfidence`           | The fields this plan fills; declared but never set by the playlist plan                                                                                                                                 |
| `primaryArtistGuess()` in `shared/artists.ts` | The lossy single-artist derivation, used **only** as a second attempt after the full string fails                                                                                                       |
| `api/_lib/` convention                        | Where server-only helpers live. The playlist plan's **probe deploy** settles whether Vercel routes `_`-prefixed paths; if it does, both plans move their helpers to a root-level `server/` tree instead |

If the playlist plan has not landed yet, this plan can still be built against a locally declared
`TrackRef`; only the import path changes. The two are order-independent.

### Also requires from earlier work

| Input                                                   | Description                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `api/hello.ts`                                          | The reference handler shape to copy                                                |
| `.env.example` → `MUSICBRAINZ_USER_AGENT`               | Already documented; this plan is the first consumer                                |
| `.env.example` → `UPSTASH_REDIS_REST_URL` / `..._TOKEN` | Already documented as production-only, with an in-memory fallback promised locally |

### Produces for downstream plans

| Output                                       | Consumed by                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/year`, one track per request       | Phase 3 progressive loading — background fill, playable at card 1             |
| `yearConfidence` (`high` / `low` / `none`)   | Phase 6 year review/edit screen, to mark which years need checking            |
| `retryAfterMs` on a 429                      | Phase 3's back-off loop when the rate-limit gate is busy                      |
| `cleanTrackTitle()` in `shared/year.ts`      | Phase 6 review screen, to show the cleaned title actually used for the lookup |
| `YearCache` interface in `api/_lib/cache.ts` | Any later server-side caching need (a playlist snapshot cache, for instance)  |

---

## Scope & Affected Areas

| Area                              | Type     | Notes                                                                                                              |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `shared/year.ts`                  | New      | All pure logic: title cleaning, cache-key normalization, candidate filtering and scoring, earliest-year extraction |
| `shared/year.test.ts`             | New      | The bulk of this plan's test surface                                                                               |
| `shared/types.ts`                 | Modified | Add `YearResult`, `YearConfidence`, and the normalized `RecordingCandidate` shape the scorer operates on           |
| `api/_lib/cache.ts`               | New      | `YearCache` interface, in-memory adapter, Upstash REST adapter, and `createCache()` selection                      |
| `api/_lib/cache.test.ts`          | New      | Both adapters, with an injected fetch for the Upstash one                                                          |
| `api/_lib/musicbrainz.ts`         | New      | Query construction, `User-Agent`, 503 retry, and raw response → `RecordingCandidate[]` normalization               |
| `api/_lib/musicbrainz.test.ts`    | New      | Adapter behaviour against captured fixtures; never touches the network                                             |
| `api/_lib/__fixtures__/`          | Modified | Add captured MusicBrainz responses for the known-tricky tracks Phase 0 already identified                          |
| `api/_lib/rate-limit.ts`          | New      | The 1 req/s gate: Redis-backed when configured, per-instance otherwise                                             |
| `api/_lib/rate-limit.test.ts`     | New      | Both gate modes                                                                                                    |
| `api/year.ts`                     | New      | `GET /api/year` — the only routed file this plan adds                                                              |
| `docs/api.md`                     | Modified | Replace the `[planned]` `/api/year` section; correct the year-fallback sentence; extend §5 Error handling          |
| `docs/architecture.md`            | Modified | Mark the year path `[built]`; correct the §4 fallback claim; update the data-flow diagram (per-track, not batched) |
| `docs/development.md`             | Modified | How to run year lookups locally, and that no Upstash credentials are needed to do so                               |
| `docs/agent_findings.md`          | Modified | Dated entries — especially the `inc=` question and any MusicBrainz response-shape surprise                         |
| `docs/plans/plan.md`              | Modified | Tick Phase 2 checkboxes 3–5; **correct the "fall back to the Spotify year" claims in §2 and §4**                   |
| `docs/plans/plan.phase-2-year.md` | Modified | Tick steps as they complete                                                                                        |

No dependency changes. Upstash is reached over plain HTTP with the global `fetch`, so no client library
is installed — see decision 6.

---

## Chosen Approach

**Tiered resolution — a strict filtered pass, then a relaxed pass marked low-confidence, then an
explicit null — with all decision logic as pure functions in `shared/` and every I/O concern isolated
in injectable adapters under `api/_lib/`.**

The strict pass is the fix Phase 0 verified: instead of trusting the recording search's relevance
score, bias the candidate pool toward `release-group` entries with `primary-type: Album`, **no**
Live/Compilation/Remix/Bootleg `secondary-types`, and release `status: Official`, then take the earliest
non-empty date, using the track's duration as a tie-breaker. That was correct in all 12 cases it was
tried on, including every compilation-era track, every famous-live-version track, and all six
cover-versus-original lookups. Critically, it uses **only MusicBrainz-side signals** — Phase 0 flagged
that two of its own batches cheated by querying with the known album title, which the embed endpoint
cannot supply.

The relaxed second pass exists because the fallback [plan.md](./plan.md) documents does not exist. With
no Spotify year available, a strict-only design would leave blank cards on exactly the classic-rock
catalogue where the strict filters most often find nothing. The relaxed pass drops the filters, still
requires a non-empty date, and returns `confidence: 'low'` so Phase 6's review screen can flag it as
worth checking. Only when that also fails does the card get `year: null` for manual entry.

Chosen over **strict-pass-only**, which never shows a wrong year but produces visibly blank decks —
Phase 0 measured that unfiltered candidate pools are dominated by bootlegs and reissues, so "no strict
match" is common, not rare. Chosen over **adding a second metadata source** (iTunes Search, Deezer),
which would raise coverage but adds an unplanned third-party dependency, another rate limit, and
another adapter to test — widening Phase 2 beyond what [plan.md](./plan.md) scoped. Deferred, not
rejected: if low-confidence years prove unhelpful in real play, that is the next thing to try.

**One request per track** was chosen for the client-facing protocol: `GET /api/year` resolves a single
track, and the client sequences calls itself. It keeps the endpoint trivial, makes every response
individually cacheable at the edge, needs no job store or polling machinery, and fits Phase 3's
progressive fill naturally — card 1 resolves first and play can begin. Its real cost is that the server
sees isolated invocations, so an in-process queue cannot pace anything and the 1 req/s budget has to be
enforced out-of-process. That is what `api/_lib/rate-limit.ts` is for, and the plan states plainly where
that guarantee holds and where it does not.

---

## Implementation Steps

- [ ] **Map what the MusicBrainz recording search returns, and design for a two-request lookup** —
      **a second request per track is explicitly acceptable** (developer decision 2026-08-04: a player
      spends well over two seconds on a card, so the resolver stays ahead of play at one track per two
      seconds). This step therefore shapes the adapter rather than gating the design, but it still comes
      first, because "how many requests and which ones" is the adapter's core structure.
  - [ ] Issue a recording search for one known-tricky track with releases and release-groups requested,
        and inspect whether each embedded release carries its `release-group`'s `primary-type` **and**
        `secondary-types`, plus the release's own `status` and `date`
  - [ ] If all four are present: a **single** search may be enough for most tracks. Prefer it when it
        works — a spare request is permitted, not free, because the 1 req/s budget is **global across all
        users** (see decision 21)
  - [ ] If any of the four is missing, or the search's inlined release list looks partial, use the
        **two-request shape**: search to pick the best candidate recording, then one follow-up that
        returns that recording's full release list with release-groups attached. Prefer a single
        browse-style call keyed on the chosen recording over per-candidate detail fetches — the point of
        a fixed two-request budget is that it stays two regardless of how many candidates tied
  - [ ] **Never let the request count scale with the candidate pool.** Phase 0 saw 706 candidates for
        "Like a Rolling Stone" and 842 for "Stairway to Heaven"; a per-candidate detail fetch would be
        minutes per track. Bound it at two, or at a small constant
  - [ ] Note the upside, since the extra request is now affordable: filtering on a recording's **full**
        release list is more reliable than filtering on whatever the search chose to inline, so the
        second request buys accuracy rather than merely working around a missing field
  - [ ] Write the answer into `docs/agent_findings.md` with the date and the exact queries used, so no
        future session has to re-measure it
  - [ ] Respect 1 req/s while doing this, with a descriptive `User-Agent` — the same rules the code
        will follow

- [ ] **Add the year types to `shared/types.ts`** — `YearConfidence` as `'high' | 'low' | 'none'`;
      `YearResult` as a discriminated union carrying either a year with its confidence and source, or a
      null year with a machine-readable reason; and `RecordingCandidate` as the **normalized** shape the
      scorer works on — release-group primary type, secondary types, release status, release date,
      recording length, and artist credit. Normalizing before scoring is what keeps every scoring test
      free of raw MusicBrainz JSON.

- [ ] **Write `cleanTrackTitle()` in `shared/year.ts`** — mandatory, not an optimization. Phase 0 found
      that remaster-suffixed titles as Spotify actually presents them ("Bohemian Rhapsody - Remastered
      2011") returned **zero** MusicBrainz results in every case tested. The literal suffix breaks the
      query outright.
  - [ ] Strip trailing remaster suffixes: `- Remastered YYYY`, `- Remaster`, `- YYYY Remaster`,
        `- YYYY Digital Remaster`, and similar variants
  - [ ] Strip trailing version suffixes: `- Live`, `- Live at …`, `- Live in …`, `- Single Version`,
        `- Album Version`, `- Radio Edit`, `- Mono`, `- Stereo`, `- Extended Mix`,
        `- Anniversary Edition`
  - [ ] Strip parenthesised and bracketed `(feat. …)`, `(with …)`, `[Explicit]`, `(Remastered)`,
        `(Live)`, and `- From "…"` soundtrack tails
  - [ ] Return the cleaned title **plus flags** for what was stripped (remaster, live, feature). The
        flags are diagnostic, surfaced in the response and useful in the Phase 6 review screen; they do
        **not** relax the studio-album filter, because the value Hitster wants is the song's original
        year even when the playlist holds a live take
  - [ ] Handle the suffix appearing more than once, and never return an empty string — if stripping
        would empty the title, keep the original
  - [ ] Escape or strip characters that would break a Lucene-style query (quotes, colons, brackets),
        since the search query wraps the title in quotes

- [ ] **Write `normalizeForCacheKey()` in `shared/year.ts`** — lowercase, strip diacritics, collapse
      whitespace, drop punctuation, applied to the cleaned title and the artist. A stable key is what
      makes the shared cache actually hit across users who paste playlists containing the same song with
      cosmetically different titles.

- [ ] **Write `pickBestRecording()` in `shared/year.ts`** — the heart of the plan, and pure: it takes
      `RecordingCandidate[]` plus the track's duration and a mode, and returns a `YearResult`. No
      network, no cache, no env — so every accuracy claim below is unit-testable.
  - [ ] **Strict mode:** keep only candidates whose release-group `primary-type` is `Album`, that carry
        **no** `secondary-types` of Live, Compilation, Remix, or Bootleg, and whose release `status` is
        `Official`. This is the combination Phase 0 verified correct in all 12 cases it was tried on
  - [ ] **Never filter on album name.** The embed endpoint has no album name at track level (Phase 0),
        and two of Phase 0's own batches used a known album title as a shortcut only available with
        ground truth on hand. Any implementation that needs an album name is wrong for this codebase
  - [ ] Among survivors, take the **earliest non-empty** release date. Phase 0 found missing and empty
        `date` fields are common on bootleg and compilation releases, so a bare minimum over all dates
        present is wrong — filter first, then compare
  - [ ] Handle date granularity: values arrive as `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Compare on the
        year, and treat a bare year as earlier-or-equal to any dated value in the same year
  - [ ] Use the track's `durationMs` as a **tie-breaker within the filtered set**, preferring the
        candidate whose recording length is closest, with a tolerance of roughly ten seconds. Phase 0
        found this reliably separates a ~3:42 studio "No Woman No Cry" from its ~6:35 live counterpart
        when the disambiguation text is absent or unhelpful
  - [ ] Ignore candidates whose artist credit does not plausibly match the requested artist. Phase 0
        measured artist filtering as reliable — 0 of 6 cover-versus-original lookups cross-contaminated
        — so this is a safe, high-value filter
  - [ ] **Relaxed mode:** drop the release-group and status filters entirely, still require a non-empty
        date and a plausible artist, still prefer the closest duration, and take the earliest year.
        Return `confidence: 'low'`
  - [ ] Return `{year: null, confidence: 'none', reason}` when even relaxed mode finds nothing, with the
        reason distinguishing "no candidates at all" from "candidates but none dated" — the two point at
        different fixes
  - [ ] Reject implausible years (before roughly 1900, or in the future) as a final sanity guard

- [ ] **Write the cache layer in `api/_lib/cache.ts`** — one small interface, two adapters, selected at
      runtime. The interface is what [plan.md](./plan.md) checkbox 4 asks for, and it is what keeps
      local development credential-free.
  - [ ] Define `YearCache` with `get` and `set` (the latter taking a TTL in seconds). Deliberately
        minimal — no `delete`, no `mget`, nothing this plan does not use
  - [ ] In-memory adapter over a module-scope map. Comment its real limitation: it lives only as long as
        one warm serverless instance, so it is a development convenience and not a production cache
  - [ ] Upstash adapter over the REST API using the global `fetch`, sending commands as a JSON array in
        a POST body rather than building them into the URL path. The body form avoids URL-encoding
        problems with keys that contain spaces or punctuation, which normalized artist–title keys will
  - [ ] `createCache()` returns the Upstash adapter when `UPSTASH_REDIS_REST_URL` is set and the
        in-memory one otherwise. Log which one was selected once per cold start — silently falling back
        to in-memory in production would look like a cache that simply never hits
  - [ ] **A cache failure must never fail a lookup.** Treat a read error as a miss and a write error as
        a no-op, both logged. The cache is a latency optimisation; MusicBrainz is the source of truth
  - [ ] Key format `mbyear:v1:{normalizedArtist}|{normalizedTitle}`. The `v1` segment is load-bearing:
        when the scoring logic changes, every previously cached year was computed by the old logic, and
        bumping the version invalidates them all in one edit instead of poisoning results indefinitely
  - [ ] Store the whole `YearResult` as JSON, not a bare year, so confidence and source survive a cache
        hit — otherwise every cached card would report high confidence
  - [ ] **Cache negative results too**, with a shorter TTL. A classic-rock miss costs a full MusicBrainz
        round trip to re-derive and will be requested again by the next user with the same playlist
  - [ ] TTLs: long for positive results (an original release year does not change), short for negatives
        (MusicBrainz data improves over time). Put both in named constants with the reasoning beside them

- [ ] **Write the rate-limit gate in `api/_lib/rate-limit.ts`** — the direct consequence of the
      one-request-per-track protocol, and the piece most likely to be misunderstood later, so its two
      modes and their differing guarantees are documented in the module itself.
  - [ ] **With Redis configured:** acquire a short-lived exclusive key with set-if-not-exists and an
        expiry just over one second. Whoever acquires it may call MusicBrainz. This genuinely enforces
        1 req/s across concurrent function instances and concurrent users, which is what MusicBrainz's
        policy actually requires
  - [ ] If the key cannot be acquired, wait briefly and retry a small number of times, then give up and
        let the handler return **429 with `retryAfterMs`**. Do not queue inside the function — that
        burns wall-clock on a metered invocation and risks the function timeout for no benefit when the
        client can simply come back
  - [ ] **Without Redis:** a module-scope timestamp gate that spaces calls within a single warm
        instance. Comment plainly that this is per-instance only and does **not** enforce the global
        policy — it is a local-development stand-in
  - [ ] **Cache hits must skip the gate entirely.** Once a playlist has been seen, the whole deck should
        resolve at cache speed with no pacing at all; gating cache hits would make the common case as
        slow as the cold one

- [ ] **Write the MusicBrainz adapter in `api/_lib/musicbrainz.ts`** — all HTTP and all response-shape
      knowledge, with `fetch` injected so tests run offline.
  - [ ] Build the recording search query from the cleaned title and the artist, quoting both fields, and
        request JSON with releases and release-groups included per the step-1 finding
  - [ ] Send `User-Agent` from `MUSICBRAINZ_USER_AGENT`. MusicBrainz blocks anonymous traffic and this
        is also the reason year lookups must run server-side at all — browsers cannot set the header.
        Fail loudly if the variable is unset rather than sending a default
  - [ ] Request a modest candidate limit. Phase 0 saw 706 matching recordings for "Like a Rolling Stone"
        and 842 for "Stairway to Heaven"; the filters do the work, not the page size, and a large page
        just costs transfer and parse time
  - [ ] **Try the full joined artist string first, and `primaryArtistGuess()` only if that returns zero
        results.** This ordering is what makes the guess's known lossiness harmless for artists whose
        names contain a comma — "Earth, Wind & Fire" matches on the full string and never reaches the
        guess. Count the retry against the rate-limit budget
  - [ ] Normalize the response into `RecordingCandidate[]` — flattening recording → releases →
        release-group — and hand it to `pickBestRecording()`. The adapter makes **no** scoring decisions;
        that separation is what keeps the accuracy logic testable
  - [ ] Retry once, after a short delay, on 503 — MusicBrainz uses it for rate-limit rejection. Do not
        retry 400 or 404
  - [ ] Return a typed error union rather than throwing, matching the style of the playlist plan's
        adapter

- [ ] **Write the `GET /api/year` handler in `api/year.ts`** — copy the `api/hello.ts` shape: default
      export, `@vercel/node` types, extensionless **relative** `shared/` imports, never the `@/` alias.
  - [ ] Accept `title`, `artist`, and `durationMs` as query parameters. Guard the method (405 with an
        `Allow` header) and validate inputs (400 when title or artist is missing or absurdly long)
  - [ ] Clean the title, build the cache key, and **check the cache first**. On a hit, return
        immediately with `cached: true` and no rate-limit involvement — this is the path most requests
        take once a playlist has been played once
  - [ ] On a miss, acquire the rate-limit permit; if unavailable, return **429 with `retryAfterMs`** so
        Phase 3 backs off and retries that card later
  - [ ] Run the strict pass, then the relaxed pass, then fall through to a null year — writing the
        result to the cache in all three cases, negatives included
  - [ ] Return `{year, confidence, source, cached, cleanedTitle}` and the strip flags. `cleanedTitle` is
        included deliberately: when a year looks wrong, the first question is always what was actually
        queried, and Phase 6's review screen can show it
  - [ ] Set a long `Cache-Control` header on successful high-confidence responses so the edge absorbs
        repeat requests ahead of both Redis and MusicBrainz. Keep it short for `none` results, which are
        the ones most likely to improve
  - [ ] Return **500 with an explicit message when `MUSICBRAINZ_USER_AGENT` is unset**, rather than
        letting MusicBrainz reject the call in a way that is confusing to diagnose
  - [ ] Wrap the handler so an unexpected throw becomes a 500 with a generic body, and never echo raw
        upstream payloads or the Upstash token

- [ ] **Capture MusicBrainz fixtures into `api/_lib/__fixtures__/`** — reuse the tracks Phase 0 already
      established ground truth for, so the tests assert against known-correct years rather than
      whatever the code currently produces.
  - [ ] A compilation-era track (Billie Jean, Sweet Child O' Mine, or Hotel California — all three
        resolved correctly under the verified fix)
  - [ ] A famous-live-version track (Wish You Were Here, No Woman No Cry, or Layla)
  - [ ] A cover-versus-original pair (Hallelujah by Cohen and by Buckley, or All Along the Watchtower by
        Dylan and by Hendrix), to pin artist disambiguation
  - [ ] One of the two tracks the fix was **never re-verified on** — Free Bird or Like a Rolling Stone.
        Phase 0 expected the fix to generalise but did not confirm it. Whatever the fixture shows is a
        genuine finding either way, and belongs in `docs/agent_findings.md`
  - [ ] A remaster-suffixed title returning zero results, to pin the title-cleaning requirement
  - [ ] A response whose releases have empty or missing `date` fields, to pin the null guard
  - [ ] Trim each fixture to the fields the adapter reads, and record which query and date produced it

- [ ] **Verify the accuracy claim end to end** — the point of the plan is a correct year, and Phase 0's
      6%-accurate baseline is the thing being beaten. Run the fixture-backed suite and confirm each
      known-tricky track resolves to its known-correct year, then check a handful of live lookups
      against real MusicBrainz through `vercel dev`. If a track that Phase 0 verified now fails, treat
      it as a real regression in the logic, not a fixture problem.

- [ ] **Run the full local verification pass** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`,
      all four green, plus the manual checks below. Confirm the suite passes with **no** Upstash
      credentials present, since that is how a new contributor will run it.

- [ ] **Update the documentation** — see Documentation Updates, including the two `plan.md` corrections.

- [ ] **Tick Phase 2 checkboxes 3–5 in `docs/plans/plan.md`** — and adjust the wording of checkbox 5,
      which currently promises the Spotify-year fallback that does not exist.

---

## Unit Tests

Vitest, Node environment, no new dependencies. Import `describe`/`it`/`expect` from `vitest` explicitly,
matching `shared/constants.test.ts`. `vite.config.ts` already includes `shared/**` and `api/**` test
files and `tsconfig.api.json` already covers `api/`, so no configuration changes are needed.

### `shared/year.test.ts` — title cleaning

- [ ] `should strip a "- Remastered YYYY" suffix` — covers the exact form Phase 0 measured returning
      **zero** MusicBrainz results, using "Bohemian Rhapsody - Remastered 2011"
- [ ] `should strip "- Remaster", "- YYYY Remaster", and digital-remaster variants` — covers the suffix
      family, not just the one sampled form
- [ ] `should strip live suffixes including "- Live at …"` — covers live-version titles
- [ ] `should strip "(feat. …)" and "(with …)"` — covers featured-artist noise in the title
- [ ] `should strip edition, edit, and mix suffixes` — covers Single Version, Radio Edit, Mono, Extended Mix
- [ ] `should strip multiple suffixes from one title` — covers a title carrying both a feature and a
      remaster tag, which single-pass stripping would half-handle
- [ ] `should leave a clean title untouched` — guards against over-eager stripping mangling ordinary titles
- [ ] `should not strip a suffix-like phrase that is part of the real title` — covers the false-positive
      risk directly (a song genuinely titled with the word "Live" in it)
- [ ] `should never return an empty title` — covers the degenerate case where stripping would consume
      everything
- [ ] `should report which suffix families were stripped` — covers the diagnostic flags the response and
      the Phase 6 review screen consume
- [ ] `should neutralise query-breaking characters` — covers quotes and colons that would corrupt the
      search query

### `shared/year.test.ts` — cache-key normalization

- [ ] `should produce the same key for titles differing only by case, punctuation, or whitespace` —
      covers the shared cache actually hitting across cosmetic variation
- [ ] `should produce the same key for titles differing only by diacritics` — covers accented artist
      and track names
- [ ] `should produce different keys for genuinely different tracks` — covers that normalization is not
      so aggressive it collides distinct songs
- [ ] `should include the schema version segment` — covers that a logic change can invalidate the cache
      wholesale

### `shared/year.test.ts` — candidate selection

- [ ] `should prefer an official studio album over a live release` — covers the core strict filter,
      built from the live-version case Phase 0 verified
- [ ] `should prefer an official studio album over a compilation` — covers the `secondary-types`
      Compilation exclusion, i.e. the Billie Jean / Hotel California class of failure
- [ ] `should exclude remix and bootleg release groups` — covers the remaining excluded secondary types,
      built from the Stairway-to-Heaven-bootleg case that produced a 2025 year
- [ ] `should exclude non-official releases` — covers the release `status` filter
- [ ] `should take the earliest date among surviving candidates` — covers the earliest-release rule that
      is the whole point of using MusicBrainz over Spotify
- [ ] `should ignore candidates with a missing or empty date rather than treating them as earliest` —
      covers the Phase 0 finding that a bare minimum over all dates present is wrong. Directly guards
      the most likely silent bug in the plan
- [ ] `should compare dates of differing granularity correctly` — covers `YYYY` against `YYYY-MM-DD`
- [ ] `should use duration to break a tie between studio and extended versions` — covers the ~3:42
      versus ~6:35 "No Woman No Cry" case Phase 0 identified
- [ ] `should not let duration override the release-group filter` — covers precedence, so a
      closer-duration bootleg cannot beat a correctly filtered album
- [ ] `should exclude candidates whose artist credit does not match` — covers the cover-versus-original
      separation Phase 0 measured as reliable, using the Hallelujah pair
- [ ] `should return high confidence from strict mode` — covers the confidence contract
- [ ] `should return low confidence from relaxed mode` — covers the tiered fallback's marking, which is
      what lets Phase 6 flag a year as worth checking
- [ ] `should return relaxed results when the strict filters exclude everything` — covers the tier
      transition, the case the missing Spotify-year fallback was supposed to handle
- [ ] `should return a null year with a reason when no candidate has a date` — covers the third tier,
      asserting the reason distinguishes "no candidates" from "none dated"
- [ ] `should reject an implausible year` — covers the sanity guard against a corrupt date
- [ ] `should resolve each known-tricky Phase 0 track to its verified year` — the accuracy test, run
      over the captured fixtures. This is the test that demonstrates the plan beat the measured
      6%-accurate baseline, and the one that would catch a regression in scoring

### `api/_lib/cache.test.ts`

- [ ] `should round-trip a value through the in-memory adapter` — covers the local path
- [ ] `should return a miss for an unknown key` — covers the miss contract the handler branches on
- [ ] `should preserve confidence and source through a round trip` — covers storing the whole result
      rather than a bare year, which would silently upgrade every cached card to high confidence
- [ ] `should send a set-with-expiry command to Upstash` — covers the REST adapter's write, asserted
      against an injected fetch
- [ ] `should handle keys containing spaces and punctuation` — covers why commands go in the request
      body rather than the URL
- [ ] `should treat an Upstash read failure as a miss` — covers cache-failure isolation
- [ ] `should treat an Upstash write failure as a no-op` — same, on the write path
- [ ] `should select the in-memory adapter when no Upstash URL is configured` — covers `createCache()`
      selection, i.e. that a contributor with no credentials gets a working cache
- [ ] `should select the Upstash adapter when the URL is configured` — covers the other branch, so
      production does not silently run on the in-memory cache

### `api/_lib/rate-limit.test.ts`

- [ ] `should allow one call and block a concurrent second within the window` — covers the gate's core
      behaviour
- [ ] `should allow a second call after the window elapses` — covers release by expiry
- [ ] `should report a retry delay when the permit cannot be acquired` — covers the value the 429
      response carries and Phase 3 backs off on
- [ ] `should fall back to per-instance pacing when Redis is unavailable` — covers the local mode,
      including the documented weaker guarantee
- [ ] `should not consume a permit when the caller had a cache hit` — covers that the common path is
      never paced

### `api/_lib/musicbrainz.test.ts`

- [ ] `should build a quoted recording query from the cleaned title and artist` — covers query
      construction against an injected fetch
- [ ] `should send the configured User-Agent` — covers the requirement MusicBrainz enforces by blocking
      anonymous traffic
- [ ] `should fail clearly when the User-Agent variable is unset` — covers the loud-failure decision
- [ ] `should normalize a response into candidates with release-group and status fields` — covers the
      flattening the scorer depends on
- [ ] `should retry once on a 503 and succeed on the retry` — covers rate-limit rejection handling
- [ ] `should not retry a 400 or 404` — covers that only the transient status is retried
- [ ] `should retry with the primary-artist guess when the full artist string returns zero results` —
      covers the two-attempt ordering that makes the lossy guess safe
- [ ] `should not retry with the guess when the full string returned candidates` — covers that the
      normal path costs one request, not two, against the rate-limit budget
- [ ] `should return a typed error rather than throwing when fetch rejects` — covers the error contract

`api/year.ts` is left to manual verification, like the playlist handler: it is a method guard, a cache
read, a gate acquisition, two calls to already-tested code, and a status mapping. Logic that grows there
should move into the adapter or `shared/year.ts` instead.

---

## Documentation Updates

- [x] `docs/plans/plan.md` — **the two false-fallback corrections, done at planning time (2026-08-03)**
      rather than deferred, because leaving a known-untrue statement in the authoritative plan is worse
      than a small overlap between planning and execution. §2's Decisions-taken bullet and §4's
      risk-table mitigation both promised "use the year from the Spotify embed data", which the Phase 0
      spike in the same document contradicts — no release date and no album name at track level, and a
      null playlist-level `releaseDate`. Both now describe the tiered strategy, keeping the "mark as
      unconfirmed in the review screen" intent that the `low` confidence value serves. Phase 2
      checkbox 5 is reworded the same way, checkbox 3 no longer says "batch endpoint", and a pointer to
      both phase-2 plan files was added. **Still to do during execution: tick checkboxes 3–5.**
- [ ] `docs/api.md` — the `/api/year` section's **fallback and batching claims are already corrected**
      (2026-08-03): it now states one-track-per-request, the three confidence tiers, that no Spotify
      year exists, and the 429 + `retryAfterMs` back-pressure contract with its Redis-versus-local
      caveat. Still to do during execution: flip the section from `[planned — Phase 2]` to `[built]`,
      document the actual query parameters and response fields (including `cleanedTitle`), extend §4's
      configuration table with the runtime consequence of omitting each variable, and add the year
      endpoint's error table to §5
- [ ] `docs/architecture.md` — the §3 data-flow diagram **already says one-per-track and "1 req/s gate"**
      (corrected 2026-08-03; it previously showed a batched endpoint and an in-process queue). Still to
      do during execution: mark the year cache and the year path `[built]` in §1 and §7, and extend §4 —
      which already documents the verified release-group fix accurately — with the relaxed second tier,
      the three confidence values, and a note that cache-key versioning exists so a scoring change can
      invalidate previously cached years
- [ ] `docs/development.md` — how to exercise `/api/year` through `vercel dev`, that
      `MUSICBRAINZ_USER_AGENT` is required locally while Upstash credentials are not, what the log line
      naming the selected cache adapter means, and that a 429 is expected behaviour under load rather
      than a bug
- [ ] `docs/agent_findings.md` — dated (ISO 8601) entries for: the step-1 answer about which fields the
      recording search returns and therefore whether a lookup costs one request or two; whether the
      verified fix generalises to Free Bird and Like a Rolling Stone, which Phase 0 expected but never
      confirmed; any MusicBrainz response-shape surprise; and the real-world hit rate of the strict pass
      versus the relaxed pass once a few playlists have been run. Tell the developer when an entry is
      added, per `AGENTS.md`
- [ ] `docs/plans/plan.phase-2-year.md` — tick implementation steps as they complete and append
      execution notes where reality differed, in the style of [plan.phase-1.md](./plan.phase-1.md)
- [ ] Inline comment in `shared/year.ts` above the strict filter — cite the Phase 0 measurement (naive
      lookup ~6% accurate, 1 of 18; the filter correct in all 12 cases tried) and state explicitly that
      the filter **must not** use an album name because the embed provides none. Without this, the
      filter looks like arbitrary over-engineering and is a prime candidate for "simplification"
- [ ] Inline comment in `shared/year.ts` above the earliest-date logic — cite the finding that missing
      and empty `date` fields are common on bootleg and compilation releases, so a bare minimum over
      present dates is wrong
- [ ] Inline comment in `shared/year.ts` above the title cleaner — record that remaster-suffixed titles
      returned **zero** results in every Phase 0 case, so this is mandatory rather than a nicety
- [ ] Inline comment in `api/_lib/rate-limit.ts` — state the two modes and their **different**
      guarantees: Redis-backed enforces 1 req/s globally, per-instance pacing does not. Also record why
      one-request-per-track puts the gate here instead of in an in-process queue
- [ ] Inline comment in `api/_lib/cache.ts` — explain the `v1` key segment as a deliberate invalidation
      lever, and note that the in-memory adapter survives only within one warm instance
- [ ] `.env.example` — no new variables, but confirm the existing comments still describe reality now
      that the code reads them, and note that a missing `MUSICBRAINZ_USER_AGENT` produces a 500 with an
      explicit message rather than a confusing upstream rejection

---

## Testing Strategy

- **Unit tests:** everything above, with the accuracy suite in `shared/year.test.ts` as the centre of
  gravity. Phase 0 measured a 6%-accurate baseline and verified a specific fix; those tracks and their
  known-correct years are the regression suite for the one thing this plan exists to get right. The
  scorer being pure and fixture-driven is what makes that possible without network flakiness.
- **Integration tests:** none automated. A test that really called MusicBrainz would be rate-limited to
  1 req/s, non-deterministic as the database improves, and would fail for reasons unrelated to the code.
  The fixtures pin the shape; a deliberate manual live check covers the rest.
- **Manual verification:**
  - `vercel dev` on port 3000, then request `/api/year` for a handful of the Phase 0 tricky tracks and
    confirm the years match the known-correct values. **Not `pnpm dev`** — it returns the transpiled
    source of `api/year.ts` with a 200 status and never runs the handler (`docs/architecture.md` §5)
  - Request the same track twice and confirm the second response reports `cached: true` and returns
    noticeably faster, which is the only real proof the cache is wired rather than merely present
  - Run with no Upstash credentials and confirm the in-memory adapter is selected and logged, and that
    lookups still succeed — this is the new-contributor path
  - Unset `MUSICBRAINZ_USER_AGENT` and confirm a 500 with the explicit message, not a confusing upstream
    failure
  - Fire several requests in rapid succession and confirm a 429 with `retryAfterMs` rather than a
    request that hangs or a MusicBrainz 503 leaking through
  - Request a track with a remaster suffix in its title and confirm both that a year comes back and that
    `cleanedTitle` shows the suffix was stripped
  - Request a deliberately nonsensical title and confirm `year: null` with `confidence: 'none'` and a
    reason, rather than a wrong year or a 500
  - Watch the wall-clock cost of resolving a real 50-track playlist end to end, sequenced by a client
    loop. This is the number Phase 3's progressive loading has to design around, so measure it rather
    than estimate it
  - After deploying, confirm `/api/hello` still returns `maxEmbedTracks: 100`, and that
    `/api/_lib/musicbrainz` is not a live route

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Tiered resolution: strict → relaxed (low confidence) → null.** Chosen over strict-only, and over adding a second metadata source                                                                 | Developer's choice, forced by a real contradiction: [plan.md](./plan.md) §2/§4 promise a Spotify-embed-year fallback, but Phase 0 in the same document established the embed has no year at track level. Strict-only would leave visibly blank decks on exactly the classic-rock catalogue where strict filters most often find nothing. A second source (iTunes, Deezer) would raise coverage but adds an unplanned dependency, rate limit, and adapter — deferred, not rejected.   |
| 2   | **The strict filter is Phase 0's verified fix, unchanged:** release-group `primary-type: Album`, no Live/Compilation/Remix/Bootleg secondary types, release `status: Official`, duration tie-break | Measured, not guessed: a naive top-scored lookup was ~6% accurate (1 of 18), while this filter was correct in all 12 cases tried — every compilation-era track, every live-version track, and all six cover-versus-original lookups. Reimplementing it differently means re-earning that evidence.                                                                                                                                                                                   |
| 3   | **The filter must never depend on an album name**                                                                                                                                                  | Phase 0 flagged that two of its own batches queried release-groups by the known-correct album title — a shortcut only available with ground truth on hand. The embed endpoint has no album name at track level, so any album-name-dependent approach cannot work in this codebase.                                                                                                                                                                                                   |
| 4   | **One `/api/year` request per track**, sequenced client-side, rather than a batch, a chunked batch, or a polling job                                                                               | Developer's choice. Keeps the endpoint trivial, makes each response individually edge-cacheable, needs no job store, and fits Phase 3's progressive fill naturally. Accepted cost, handled explicitly by decision 5: the server sees isolated invocations, so pacing must be out-of-process, and each track pays a function invocation.                                                                                                                                              |
| 5   | **The 1 req/s guarantee comes from a Redis-backed gate, not an in-process queue** — and is per-instance only when Redis is absent                                                                  | A direct consequence of decision 4. A single client paces itself by sequencing, but several concurrent users pacing independently aggregate past MusicBrainz's limit. Only a shared out-of-process lock enforces the real policy. The local fallback is honestly labelled a stand-in rather than presented as equivalent.                                                                                                                                                            |
| 6   | **Upstash is reached over plain REST with the global `fetch`; no client library is installed**                                                                                                     | The operations needed are a get and a set-with-expiry. A dependency would add cold-start weight to a latency-sensitive function for no capability gain, and Phase 1 deliberately locked a minimal dependency tree.                                                                                                                                                                                                                                                                   |
| 7   | **Commands go in a POST body as a JSON array, not built into the URL path**                                                                                                                        | Normalized artist–title keys contain spaces and punctuation. Path-encoded commands make that a source of subtle encoding bugs; a body does not.                                                                                                                                                                                                                                                                                                                                      |
| 8   | **Cache keys carry a `v1` schema segment**                                                                                                                                                         | When the scoring logic changes, every cached year was computed by the old logic. Bumping one segment invalidates them all in a single edit; without it, improved logic would be masked indefinitely by stale entries.                                                                                                                                                                                                                                                                |
| 9   | **The whole result is cached, not a bare year, and negatives are cached too**                                                                                                                      | Storing only the year would make every cache hit report high confidence, quietly defeating the Phase 6 review screen. Negatives are cached because a miss costs a full round trip and the next user with the same playlist will ask again — with a shorter TTL, since MusicBrainz data improves.                                                                                                                                                                                     |
| 10  | **A cache failure degrades to a miss and never fails a lookup**                                                                                                                                    | The cache is a latency optimisation; MusicBrainz is the source of truth. An Upstash outage should make the app slow, not broken.                                                                                                                                                                                                                                                                                                                                                     |
| 11  | **Cache hits bypass the rate-limit gate**                                                                                                                                                          | Once a playlist has been played, the whole deck should resolve at cache speed. Gating hits would make the common case as slow as the cold one for no benefit — nothing leaves the building.                                                                                                                                                                                                                                                                                          |
| 12  | **When the gate is busy, respond 429 with `retryAfterMs` instead of queueing inside the function**                                                                                                 | Queueing burns wall-clock on a metered invocation and risks the function timeout, when the client is already sequencing and can simply come back. It also makes back-pressure visible to Phase 3 rather than hidden in latency.                                                                                                                                                                                                                                                      |
| 13  | **Title cleaning is mandatory and happens before every query**                                                                                                                                     | Phase 0: remaster-suffixed titles as Spotify presents them returned **zero** results in every case tested. This is a correctness requirement, not an optimization.                                                                                                                                                                                                                                                                                                                   |
| 14  | **Strip flags are diagnostic and do not relax the studio-album filter** — a live-labelled track still resolves to the song's original year                                                         | Hitster asks when the song came out, not when this particular take was recorded. Keeping the flags separate from the filter keeps that intent explicit rather than emergent.                                                                                                                                                                                                                                                                                                         |
| 15  | **The full joined artist string is queried first; `primaryArtistGuess()` is a second attempt only**                                                                                                | This ordering is what makes the guess's known lossiness harmless: "Earth, Wind & Fire" matches on the full string and never reaches a guess that would truncate it. Phase 0 measured artist filtering as reliable (0 of 6 cover lookups cross-contaminated), so including the artist is always worth the cost.                                                                                                                                                                       |
| 16  | **Scoring is pure and operates on a normalized candidate shape, never on raw MusicBrainz JSON**                                                                                                    | Every accuracy claim in this plan is then a unit test over fixtures, with no network and no rate limit. It also confines a MusicBrainz shape change to the adapter.                                                                                                                                                                                                                                                                                                                  |
| 17  | **A missing `MUSICBRAINZ_USER_AGENT` fails loudly with a 500**                                                                                                                                     | MusicBrainz blocks anonymous traffic, so a default or absent agent produces a remote rejection that is confusing to diagnose. Failing at the boundary names the actual problem.                                                                                                                                                                                                                                                                                                      |
| 18  | **`cleanedTitle` is returned to the client**                                                                                                                                                       | When a year looks wrong, the first question is always what was actually queried. Cheap to include, and Phase 6's review screen can show it.                                                                                                                                                                                                                                                                                                                                          |
| 19  | **Up to two MusicBrainz requests per track is acceptable** — a search plus one follow-up for the chosen recording's full release list                                                              | Developer decision, 2026-08-04: a player spends well over two seconds on a card, so a resolver running at one track per two seconds stays ahead of play, and card 1 is still ready within about two seconds of Start. This removes what was the plan's main open risk — the lookup shape no longer has to be settled before the design can proceed. The extra request also **buys accuracy**: filtering a recording's full release list beats filtering whatever the search inlined. |
| 19a | **But the request count must never scale with the candidate pool** — bounded at two, or a small constant                                                                                           | Phase 0 saw 706 candidates for "Like a Rolling Stone" and 842 for "Stairway to Heaven". A per-candidate detail fetch would be minutes per track, which is a different order of problem from two seconds and is not covered by decision 19.                                                                                                                                                                                                                                           |
| 20  | **Assumed: the fix generalises to Free Bird and Like a Rolling Stone**                                                                                                                             | Phase 0 stated the same release-group signals were present for both but did **not** re-verify them. Recorded as an assumption, and a fixture is captured specifically to test it — whatever it shows is a real finding.                                                                                                                                                                                                                                                              |
| 21  | **The 1 req/s budget is global across all users, so doubling requests per track halves everyone's throughput — accepted, with the cache as the mitigation**                                        | The reasoning behind decision 19 is about a **single** player's pace, which is sound. What it does not cover is contention: two people resolving cold playlists at two requests each get one track per four seconds. Acceptable for a personal project, and the shared year cache means only genuinely new songs ever pay — but this, not single-user latency, is the real cost of the second request, and it is the number to watch if the app is ever shared widely.               |

---

## Open Questions

- [x] ~~**Does one MusicBrainz request per lookup suffice, or are two needed?**~~ **Closed 2026-08-04:
      two is acceptable** — see decision 19. Step 1 still maps what the search returns, because that
      shapes the adapter, but it is no longer a decision gate. Phase 3 should design its progressive
      loading against **one track per two seconds**, and note decision 21: that figure is per-user only
      when nobody else is resolving a cold playlist at the same time.
- [ ] **What are the real TTLs?** Long for positives and short for negatives is the shape; the actual
      values are a guess until there is usage data. Start generous on positives, conservative on
      negatives, and revisit.
- [ ] **Is a low-confidence year better than no year in actual play?** The premise of decision 1, and it
      cannot be settled by reasoning. If low-confidence years turn out to be wrong often enough to
      annoy, the answer is either a stricter relaxed pass or the second metadata source deferred above.
      Phase 6's review screen is where this becomes observable.
- [ ] **Should the review screen be mandatory before Start?** Already open in [plan.md](./plan.md) §6 and
      still Phase 6's call — but the tiered confidence values are what make a good answer possible, so
      it is worth revisiting once real hit rates exist for `high`, `low`, and `none`.
- [ ] **Is the ten-second duration tolerance right?** Derived from a single Phase 0 example (~3:42 studio
      versus ~6:35 live). Wide enough to tolerate edition differences, narrow enough to separate an
      extended mix — but it is one data point, so treat it as tunable.
- [ ] **How should a `year: null` card behave in the deck before Phase 6 exists?** Phase 3 has to decide
      whether such a card is playable, skipped, or blocking. Flagged here because the null case is
      created by this plan and consumed by that one.
- [ ] **Does the Redis gate need to be fair?** As specified, a losing caller retries and may lose again,
      so a heavily loaded moment could starve one client. Acceptable for a personal project with
      client-side retry; revisit only if it shows up in practice.

---

## Out of Scope

- **URL parsing, the embed adapter, and `/api/playlist`** — [plan.phase-2-playlist.md](./plan.phase-2-playlist.md).
  This plan consumes `TrackRef` and fills `Card.year`; it never fetches a track list.
- **A second metadata source** (iTunes Search, Deezer, Discogs) for tracks MusicBrainz cannot resolve —
  considered and deferred; see decision 1. Revisit only if low-confidence years prove unhelpful.
- **The client-side sequencing loop, progressive fill, and blocking when the player outruns the
  resolver** — Phase 3. This plan provides the per-track endpoint and the 429 back-off signal that loop
  is built on.
- **The year review/edit screen and the "unconfirmed year" UI** — Phase 6. This plan produces the
  `confidence` value those screens render.
- **A playlist snapshot cache in Redis** — the playlist plan uses an edge `Cache-Control` header instead.
  The `YearCache` interface is available if a later phase wants one.
- **Provisioning the Upstash instance** — the developer's call, whenever they like. The code works
  without it and switches over as soon as the variables are present.
- **Batching, job queues, or polling endpoints** — one request per track is the chosen protocol
  (decision 4). Revisit only if per-invocation cost or wall-clock measurably hurts.
- **Persisting user-edited years** — Phase 6 owns the edit UI, and any persistence beyond the current
  session is Phase 8 territory.
- **Rewriting Phase 0's accuracy research** — the findings in [plan.md](./plan.md) §5 are the inputs to
  this plan, not something to re-measure. Only the two explicitly unverified tracks (decision 20) get
  fresh checks.
- **Running `vercel link` or `vercel deploy`** — the developer performs deploys manually, as in Phase 1.
