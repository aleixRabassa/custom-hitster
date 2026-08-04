<!-- Plans for phase-2 (in order):
  1. plan.phase-2-playlist.md  — URL parsing, the Spotify embed adapter, and /api/playlist  ← this file
  2. plan.phase-2-year.md      — cache interface, MusicBrainz adapter, year resolution, and /api/year
-->

# Plan: phase-2 (playlist) — Playlist Ingestion

> **Task:** phase-2 — playlist ingestion half of the Data Layer
> **Date:** 2026-08-03
> **Author:** Aleix Rabassa
> **Source:** [plan.md](./plan.md) §5 — Phase 2, checkboxes 1–2

---

## Overview

Turn a pasted Spotify playlist link into a normalized, typed list of cards. This plan delivers
`parsePlaylistUrl()` as portable shared code, an isolated adapter around the unofficial Spotify embed
endpoint, and the `GET /api/playlist` function that composes them — plus the `Card` and `TrackRef`
types that the rest of Phase 2 and Phase 3 build on.

It covers exactly the first two Phase 2 checkboxes in [plan.md](./plan.md) §5. Year resolution, the
cache, and MusicBrainz are the sibling plan's job; this plan deliberately ships with **no cache
dependency** so it can be built, reviewed, and deployed on its own. The card returned here carries no
year at all — the field exists on the type and is left unresolved.

Phase 0 already did the research this plan rests on: the payload location, the field inventory, the
100-track cap, and the non-obvious error shape are all measured facts recorded in [plan.md](./plan.md)
§5 Phase 0, not assumptions to re-derive. Several of them look wrong until you read the finding, so
this plan cites them at the point of use.

---

## Dependency Contract

### Requires from earlier work

| Input                                      | Description                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `api/hello.ts`                             | The reference handler shape to copy — default export, `@vercel/node` types, relative `shared/` import |
| `shared/constants.ts` → `MAX_EMBED_TRACKS` | The 100-track cap, used for the truncation flag. Already exists; do not redefine the number           |
| `tsconfig.api.json` / `tsconfig.app.json`  | The Node/DOM typecheck split that decides which tree new files may live in                            |
| `vite.config.ts` `test.include`            | Already matches `{src,shared,api}/**/*.{test,spec}.{ts,tsx}` — no Vitest config change needed         |

### Produces for downstream plans

| Output                                               | Consumed by                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `TrackRef` type (title, artist, durationMs)          | [plan.phase-2-year.md](./plan.phase-2-year.md) — the input shape for a year lookup |
| `Card` type, with `year`/`yearConfidence` unresolved | plan.phase-2-year.md (fills them), Phase 3 (`GameState`), Phase 4 (card rendering) |
| `parsePlaylistUrl()` in `shared/`                    | Phase 6 landing-page input validation, reused unchanged                            |
| `PlaylistErrorCode` union                            | Phase 6 inline error states and the friendly private-playlist message in Phase 7   |
| `truncated` flag on the playlist response            | Phase 6 non-blocking "may have more than 100 tracks" warning banner                |
| `GET /api/playlist`                                  | Phase 3 progressive loading, Phase 6 Start flow                                    |

---

## Scope & Affected Areas

| Area                                  | Type     | Notes                                                                                                     |
| ------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `shared/types.ts`                     | New      | `Card`, `TrackRef`, `PlaylistSummary`, `PlaylistResult`, `PlaylistErrorCode`. Pure types, no DOM, no Node |
| `shared/spotify-url.ts`               | New      | `parsePlaylistUrl()` returning a discriminated union; no throwing                                         |
| `shared/spotify-url.test.ts`          | New      | The accepted-form matrix and every rejection case                                                         |
| `shared/artists.ts`                   | New      | `primaryArtistGuess()` and its separator-hazard handling                                                  |
| `shared/artists.test.ts`              | New      | The "names that contain separators" corpus                                                                |
| `api/_lib/spotify-embed.ts`           | New      | The embed adapter: fetch, extract, validate, normalize. `fetch` injected for testability                  |
| `api/_lib/spotify-embed.test.ts`      | New      | Adapter behaviour against fixtures; never touches the network                                             |
| `api/_lib/__fixtures__/`              | New      | Trimmed captured payloads: healthy playlist, 404-shaped body, malformed body, exactly-100 case            |
| `api/playlist.ts`                     | New      | `GET /api/playlist` — the only routed file this plan adds                                                 |
| `docs/api.md`                         | Modified | Replace the `[planned]` `/api/playlist` section with the built shape; fill in §5 Error handling           |
| `docs/architecture.md`                | Modified | Mark the playlist path `[built]`; add `api/_lib/` to the layout discussion                                |
| `docs/development.md`                 | Modified | How to exercise `/api/playlist` locally through `vercel dev`                                              |
| `docs/agent_findings.md`              | Modified | Dated entries for anything discovered during execution                                                    |
| `docs/plans/plan.md`                  | Modified | Tick Phase 2 checkboxes 1–2                                                                               |
| `docs/plans/plan.phase-2-playlist.md` | Modified | Tick steps as they complete                                                                               |

No dependency changes. Nothing in this plan needs a package that is not already installed.

---

## Chosen Approach

**Pure logic in `shared/`, all I/O in an injected-`fetch` adapter under `api/_lib/`, and a thin
handler that only maps errors to status codes.** `parsePlaylistUrl()` and the artist helpers are
portable functions with no platform APIs, so they live in `shared/` where both the function and
Phase 6's landing form can use them and where they are trivially unit-testable. Everything that talks
to Spotify lives in one adapter module, which takes its `fetch` as a parameter so tests run against
captured fixtures with no network. `api/playlist.ts` itself contains no parsing and no extraction —
it validates the request, calls the two, and translates the typed error union into HTTP.

Chosen over **putting the extraction inline in the handler**, which is shorter but makes the riskiest
code in the repo untestable: [plan.md](./plan.md) §4 lists "embed endpoint changes/breaks" as a live
risk whose mitigation is explicitly _"isolate all scraping in one adapter module with its own tests"_.
An inline handler would also have to be exercised through `vercel dev` to test at all.

Chosen over **adding an HTML parser dependency** (`cheerio`, `node-html-parser`) to find the
`__NEXT_DATA__` script. The target is a single `<script>` tag with a known `id` whose content is JSON;
a non-greedy regex plus `JSON.parse` covers it, and Next.js escapes `</script>` inside embedded JSON
so the naive terminator is safe. A parser would add a runtime dependency and cold-start weight to a
function on a latency-sensitive path for no gain.

Chosen over **`POST /api/playlist` with a JSON body**: a GET with a query parameter is cacheable at
Vercel's edge, reproducible with `curl`, and easy to eyeball in the network tab. There is no payload
large enough to justify a body.

**Deliberately excluded from this plan:** the Redis playlist-snapshot cache sketched in
[plan.md](./plan.md) §3. Snapshot caching here is achieved with a `Cache-Control` response header, so
this plan has no dependency on the cache layer built in the sibling plan, and the two can be
implemented in either order.

---

## Implementation Steps

- [x] **Define the shared types in `shared/types.ts`** — the vocabulary everything downstream uses, so
      this lands first. No DOM and no Node types may appear in this file; it is checked by both
      tsconfigs, which is the point.
  - [x] `TrackRef` — the minimal input a year lookup needs: `title`, `artist`, `durationMs`. Kept
        separate from `Card` so the sibling plan's `/api/year` depends on a small stable shape rather
        than the whole card
  - [x] `Card` — `id` (Spotify track ID), `title`, `artist` (the raw joined string, see the artist
        step), `durationMs`, `previewUrl` optional, `isPlayable`, and `year` / `yearConfidence` left
        unresolved by this plan. Document in a comment that Phase 3 owns `GameState` and must not
        widen `Card` with game state
  - [x] `PlaylistSummary` — `id`, `name`, and the owner label from the embed's playlist-level
        `subtitle` field
  - [x] `PlaylistResult` — `playlist`, `cards`, `truncated`
  - [x] `PlaylistErrorCode` — a string-literal union: `invalid-url`, `unsupported-entity`,
        `not-found-or-private`, `upstream-unavailable`, `unexpected-payload`. Comment each with the
        HTTP status the handler maps it to, so the mapping is documented next to the codes themselves

  > **Execution note — three additions to what the step listed, each forced by another step.**
  > (1) `PlaylistResult` also carries `skippedCount`, because the adapter step requires the skipped
  > count to be reported rather than swallowed, and Open Question 5 assumes the response carries it.
  > (2) `YearConfidence` (`'high' | 'low' | 'none'`) is declared here rather than left to
  > [plan.phase-2-year.md](./plan.phase-2-year.md), since `Card.yearConfidence` has to reference
  > something and typing it as `string` would be worse; the sibling plan adds `YearResult` and
  > `RecordingCandidate` alongside it instead of redefining it. (3) `Card.year` is
  > `number | null | undefined`, not just optional: `undefined` means "not looked up yet" and `null`
  > means "looked up, nothing found", and Phase 3's progressive loading needs to tell those apart.
  > Also added `PlaylistErrorResult` for the error response body, so the handler has a typed shape.

- [x] **Write `parsePlaylistUrl()` in `shared/spotify-url.ts`** — returns a discriminated union
      (`{ok: true, id}` / `{ok: false, code}`) rather than throwing or returning `null`. The union is
      what lets Phase 6's landing form show a specific inline message per failure without duplicating
      any parsing, and it is why this is not a one-line regex.
  - [x] Accept `https://open.spotify.com/playlist/{id}`, tolerating `?si=`, `?utm_source=` and any
        other query parameters, a trailing slash, a URL fragment, `http`, and surrounding whitespace
  - [x] Accept **locale-prefixed paths** such as `open.spotify.com/intl-es/playlist/{id}`. Spotify
        really does serve these and a shared link copied from a localised client carries the prefix —
        easy to miss and a confusing failure for the developer's own locale
  - [x] Accept the `spotify:playlist:{id}` URI form
  - [x] Accept a bare ID with no URL around it
  - [x] Validate the ID as exactly 22 base62 characters and reject anything else as `invalid-url`
  - [x] Return `unsupported-entity` — distinct from `invalid-url` — for a well-formed Spotify URL
        pointing at an album, track, artist, show, or episode. This is a likely user mistake and
        deserves its own message, not "that is not a valid link"
  - [x] Reject non-Spotify hosts, and reject hosts that merely _contain_ `open.spotify.com` as a
        substring (a look-alike domain must not pass), as `invalid-url`
  - [x] Note in a comment that this function performs **no** network call and cannot tell whether the
        playlist exists — that is the adapter's job

  > **Execution note:** implemented with anchored regexes and **no use of the global `URL`**. `URL`
  > exists in both runtimes and would have type-checked under both tsconfigs, but `shared/` is the one
  > tree with no platform globals at all (see `eslint.config.js`), and keeping it literally
  > platform-free costs nothing here. Anchoring also settles the look-alike-host requirement directly:
  > a literal `/` or end-of-input must follow `open.spotify.com`, which rejects
  > `open.spotify.com.evil.example`, `notopen.spotify.com`, `evil.example/open.spotify.com/...` and the
  > userinfo trick `open.spotify.com@evil.example` — all four of which pass a naive `includes()`.
  > The entity is checked **before** the ID, so an album link reports `unsupported-entity` regardless
  > of whether its ID is well-formed. `user` and `collection` are treated as known non-playlist
  > entities alongside the five the step names, since a profile link deserves the same message.
  > The error code type is `Extract<PlaylistErrorCode, 'invalid-url' | 'unsupported-entity'>` rather
  > than a second hand-written union, so the two cannot drift.

- [x] **Write the artist helper in `shared/artists.ts`** — Phase 0 found that track `subtitle` is the
      artist name(s) as **one joined string**, not a structured array, and flagged it as needing
      splitting. Splitting it is a trap, so this step is where the trap is documented and contained.
  - [x] Keep the raw `subtitle` verbatim as the card's display `artist`. Do **not** split for display:
        the separators Spotify joins with (`, ` and `&`) also occur _inside_ real artist names, so
        splitting would render "Earth, Wind & Fire" as three artists
  - [x] Provide `primaryArtistGuess()`, used only to build a MusicBrainz query in the sibling plan.
        Take the segment before the first `, ` and ~~trim a leading/trailing `&`-joined tail~~ —
        **deliberately narrowed during execution; see the note below**
  - [x] Comment explicitly that the guess is **lossy and known-wrong** for comma-containing artist
        names, and that the sibling plan's contract is therefore to query the full string first and
        fall back to the guess only on zero results. That ordering is what makes the lossiness safe
  - [x] Strip a `feat.` / `featuring` / `with` tail from the guess if present, since a featured artist
        in the subtitle harms the MusicBrainz match

  > **Deviation — the `&`-joined tail is NOT trimmed.** The step asked for it, but it contradicts this
  > plan's own test list, which holds "Simon & Garfunkel" up as a name that must survive intact. Both
  > are the same string shape — "X & Y" is either two artists or one artist's real name — so no rule
  > can separate them, and trimming corrupts the real name. Splitting on `,` only means two of the four
  > hazard names ("Simon & Garfunkel", "Florence + The Machine") come out exactly right and the
  > lossiness is confined to the comma cases, which the tests then assert and document. The guess is a
  > second-attempt query term only ([plan.phase-2-year.md](./plan.phase-2-year.md) decision 15), so a
  > slightly wider term is the safer failure direction. Recorded here because a future reader comparing
  > code to plan will notice the difference.

- [ ] **Capture the test fixtures into `api/_lib/__fixtures__/`** — do this before the adapter so the
      adapter is written against real payload shapes rather than remembered ones.
  - [ ] A healthy playlist payload, **trimmed to a handful of tracks** — a full 100-track page is
        large enough to make the test suite unpleasant to read and slow to diff. Keep at least one
        track with `audioPreview` absent and one with `isPlayable: false`, since those are the branches
        that matter
  - [ ] The **404-shaped** payload: HTTP 200 with `pageProps` carrying `{status: 404, …}` and no
        `state` key. This is the fixture that proves the non-obvious error branch
  - [ ] A malformed payload: valid HTML, `__NEXT_DATA__` present, but the `trackList` path missing
  - [ ] A page with no `__NEXT_DATA__` script at all — what a Spotify redesign or a captcha wall would
        look like
  - [ ] An exactly-100-track payload (may be synthesised by repeating a fixture track) to exercise the
        truncation flag at its boundary
  - [ ] Record in a fixture README, or a header comment, **when and from which playlist ID** each
        fixture was captured. Unofficial payloads drift; a fixture with no provenance cannot be
        re-verified later

- [ ] **Write the embed adapter in `api/_lib/spotify-embed.ts`** — the one module allowed to know that
      the track source is a scraped HTML page. Everything Phase 0 measured about the endpoint is
      encoded here and nowhere else, so a future Spotify change has exactly one blast radius.
  - [ ] Export a single function taking the playlist ID plus an injected `fetch`-shaped function, and
        returning the same discriminated union style as the parser (`{ok: true, …}` / `{ok: false, code}`).
        The injection is what makes every test below run offline
  - [ ] Request `open.spotify.com/embed/playlist/{id}` with a normal browser `User-Agent`. Phase 0
        used one and got HTTP 200; do not assume a default or absent agent behaves the same
  - [ ] Extract the payload with a non-greedy match on the `<script id="__NEXT_DATA__"
type="application/json">` element and `JSON.parse` its content. Comment that Next.js escapes
        `</script>` inside embedded JSON, which is why the naive terminator is safe here — otherwise
        this looks like a bug waiting to happen
  - [ ] **Branch on the presence of `props.pageProps.state`, never on the HTTP status code.** Phase 0
        established that a nonexistent playlist ID still returns **HTTP 200**, with `pageProps`
        carrying `{status: 404, …}` instead of `state`. Status-based error handling would treat a
        missing playlist as a success and hand the UI an empty deck. Map this case to
        `not-found-or-private`
  - [ ] Map a genuinely failed request or a non-200 response to `upstream-unavailable`, and a
        200 whose payload is present but structurally wrong to `unexpected-payload`. Keeping these
        distinct matters operationally: the first is transient, the second means the scrape broke
  - [ ] Read tracks from `props.pageProps.state.data.entity.trackList` and the playlist summary from
        the same `entity` (`name`/`title`, `id`, `subtitle` as the owner label)
  - [ ] **Verify `entity.uri` matches the requested playlist ID** and return `unexpected-payload` if
        not. Phase 0 hit exactly this class of bug during its own spike — parallel agents overwrote a
        shared scratch file and two of them silently analysed the wrong playlist. A cheap identity
        assertion turns a silent wrong-deck into a loud error
  - [ ] Normalize each entry to a `Card`: derive `id` from the track `uri` (`spotify:track:{id}`),
        `title` from `title`, `artist` from `subtitle` verbatim, `durationMs` from `duration`,
        `previewUrl` from `audioPreview.url` when present, and `isPlayable` from `isPlayable`
  - [ ] **Keep unplayable tracks in the deck** rather than filtering them out. The QR code is always
        rendered and always works (a [plan.md](./plan.md) §2 non-negotiable), so an unplayable track is
        still a fully playable _card_ — only Phase 4's Play/Pause and Restart buttons are affected
  - [ ] Skip only entries that cannot yield a usable card at all — no track ID or no title — and count
        how many were skipped so the response can report it rather than quietly shrinking the deck
  - [ ] Set `truncated` when `trackList.length === MAX_EMBED_TRACKS`, importing the constant from
        `../shared/constants` by relative path. Do not re-litigate the number here: Phase 0 established
        the cap by observing real truncation, and that there is **no pagination signal of any kind** in
        the payload, which is why a boolean flag is the honest maximum this layer can report

- [ ] **Write the `GET /api/playlist` handler in `api/playlist.ts`** — copy the shape of `api/hello.ts`
      exactly: default-export `handler`, `VercelRequest`/`VercelResponse` from `@vercel/node`,
      extensionless **relative** imports of `shared/`. This is the pattern the 2026-08-03 deploy
      validated in production; the `@/` alias must not appear anywhere under `api/`.
  - [ ] Guard the method — anything but `GET` returns 405 with an `Allow` header
  - [ ] Read the `url` query parameter, handle it being absent or repeated (Vercel's query values can
        be arrays), and return 400 `invalid-url` if unusable
  - [ ] Run `parsePlaylistUrl()`, returning 400 with the typed code on failure
  - [ ] Call the adapter with the real global `fetch`, and map its error union to statuses: 404 for
        `not-found-or-private`, 502 for `upstream-unavailable`, 502 for `unexpected-payload`
  - [ ] On success return the `PlaylistResult` with a `Cache-Control` response header carrying a short
        `s-maxage` plus `stale-while-revalidate`, giving playlist-snapshot caching at Vercel's edge
        with **no Redis dependency**. Keep the window short — a playlist's contents can change, and
        Phase 6's suggested editorial playlists change on Spotify's own schedule
  - [ ] Never include the raw upstream HTML or the parse error text in the response body. It is
        unbounded, and the embed payload contains an anonymous Spotify bearer token (Phase 0 found one
        at `state.settings.session.accessToken`) that must not be forwarded to the client
  - [ ] Wrap the whole handler so an unexpected throw becomes a 500 with a generic body rather than a
        stack trace

- [ ] **Settle the `api/_lib/` routing question with a throwaway probe deploy, as the FIRST step of
      execution** — before any real helper exists. Vercel's convention is that `_`-prefixed paths under
      `api/` are excluded from function routing, which is the entire reason the directory is named that
      way. It is only observable on a real deploy: `typecheck`, `lint`, `test`, and `build` all pass
      either way, because none of them know what Vercel's router does. This repo has already been bitten
      twice by exactly this class of failure — the solution-file `tsconfig.json` and the path-alias
      limitation — so probing it early costs minutes and finding out late costs a migration.
  - [x] Add a trivial `api/_lib/_probe.ts` that exports a **named** function and no default export —
        the shape that would break if Vercel tried to build it as a handler
  - [x] Deploy, then confirm two things: the function build **succeeded** (a routed helper with no
        default export is the failure mode), and `/api/_lib/_probe` returns **404** rather than 200 or 500
  - [ ] Delete the probe and record the result in `docs/agent_findings.md` with the date. This
        probe-then-revert pattern is the repo's established habit — Phase 1 used it for the ESLint
        globals blocks and for the DOM-vs-Node typecheck isolation
        — **result recorded; probe file deliberately still present, see below**

  > **Execution note — ANSWERED 2026-08-04: `api/_lib/` is not routed.** The probe deployed (commit
  > `d577a5f`): the function build completed with no error and `GET /api/_lib/_probe` returned **404**
  > with `X-Vercel-Error: NOT_FOUND`. So decision 3 stands, helpers stay under `api/_lib/`, and the
  > root-level `server/` fallback is not needed. Worth what it cost: all five local checks
  > (`typecheck`, `lint`, `test`, `build`, `format:check`) were green either way, so nothing short of a
  > deploy could have told us.
  >
  > **The same deploy exposed an unrelated, more serious bug, now fixed:** `/api/hello` returned **500
  > `FUNCTION_INVOCATION_FAILED`**. Cause was the extensionless specifier `'../shared/constants'` — a
  > `"type": "module"` function is ESM, Node's ESM resolver does not guess extensions, and Vercel
  > transpiles rather than bundles. Settled with two more throwaway functions differing only in the
  > extension (`.js` → 200 with `maxEmbedTracks: 100`, extensionless → 500). **This changes how every
  > file in the rest of this plan imports:** `api/playlist.ts` → `./_lib/spotify-embed.js`,
  > `api/_lib/spotify-embed.ts` → `../../shared/constants.js`, and so on. `docs/api.md` had actively
  > prescribed the wrong form, and `docs/architecture.md` claimed the relative-import path was "proven
  > in production" when only the _build_ had ever been proven. Both corrected, along with `AGENTS.md`
  > and `docs/development.md`. All three probe files are now deleted. Full detail in
  > `docs/agent_findings.md`.
  - [ ] **Documented fallback if it IS routed:** move the helpers to a root-level `server/` directory
        and add it to `tsconfig.api.json`'s `include`. Unambiguously outside `api/` and therefore never
        routed, relying on no convention at all — at the cost of a fourth top-level tree and two more
        import rules to document in `AGENTS.md` and `docs/architecture.md` §2. Cheap to adopt on day one
        if the probe fails; tedious once ten files import each other

- [ ] **Run the full local verification pass** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`,
      all four green, plus the manual checks in Testing Strategy below. Grep for `@/` under `api/`
      before any deploy.

- [ ] **Update the documentation** — see Documentation Updates. `docs/` is the source of truth per
      `AGENTS.md`, so this is a step, not a postscript.

- [ ] **Tick Phase 2 checkboxes 1–2 in `docs/plans/plan.md`** — and only those two. The remaining three
      belong to the sibling plan.

---

## Unit Tests

All tests run under Vitest's Node environment with no new dependencies. Import `describe`/`it`/`expect`
explicitly from `vitest`, matching `shared/constants.test.ts` — globals are off. `vite.config.ts`
already includes `api/**` and `shared/**` test files, and `tsconfig.api.json` already covers `api/`, so
no configuration changes are needed.

### `shared/spotify-url.test.ts`

- [x] `should parse a plain open.spotify.com playlist URL` — covers the base accepted form
- [x] `should parse a URL carrying an ?si= share parameter` — covers the form users actually paste,
      since Spotify's own share button appends it
- [x] `should ignore additional query parameters and a URL fragment` — covers `?utm_source=` and `#…`
- [x] `should parse a locale-prefixed path` — covers `open.spotify.com/intl-es/playlist/{id}`
- [x] `should parse a URL with a trailing slash, http scheme, and surrounding whitespace` — covers
      normalization of sloppy paste input
- [x] `should parse a spotify:playlist: URI` — covers the desktop-client copy form
- [x] `should parse a bare 22-character ID` — covers the form the Phase 6 suggested-playlist buttons use
- [x] `should reject an album, track, artist, and show URL as unsupported-entity` — covers the
      wrong-entity branch, asserting the code is `unsupported-entity` and **not** `invalid-url`,
      because Phase 6 renders a different message for each
- [x] `should reject a non-Spotify host as invalid-url` — covers host validation
- [x] `should reject a look-alike host containing open.spotify.com as a substring` — covers that host
      matching is not a naive `includes`
- [x] `should reject an ID of the wrong length or with non-base62 characters` — covers ID validation
- [x] `should reject empty and whitespace-only input` — covers the landing form's initial state
- [x] `should never throw for arbitrary input` — covers the union-return contract across a list of
      junk inputs, since Phase 6 calls this on every keystroke

### `shared/artists.test.ts`

- [x] `should return the sole artist unchanged for a single-artist subtitle` — covers the common case
- [x] `should take the first artist from a comma-joined subtitle` — covers the multi-artist case
- [x] `should not split artist names that themselves contain a separator` — covers the hazard, with
      "Earth, Wind & Fire", "Simon & Garfunkel", "Tyler, The Creator", and "Florence + The Machine".
      This test documents a **known limitation** for the comma-containing names: it asserts the
      guess's actual behaviour and carries a comment pointing at the sibling plan's full-string-first
      query order, which is what makes the limitation harmless
- [x] `should strip a feat./with tail from the guess` — covers featured-artist removal
- [x] `should handle an empty subtitle without throwing` — covers the degenerate input

### `api/_lib/spotify-embed.test.ts`

- [ ] `should normalize a healthy payload into cards` — covers the happy path end to end against the
      trimmed fixture: card count, and `id`/`title`/`artist`/`durationMs` mapping
- [ ] `should derive the track id from the spotify:track: uri` — covers ID extraction specifically,
      since the payload has no bare `id` at track level
- [ ] `should keep the joined subtitle verbatim as the display artist` — covers the deliberate
      no-splitting decision, guarding against a future "improvement"
- [ ] `should set previewUrl when audioPreview is present and leave it undefined when absent` — covers
      the optional-audio branch that Phase 4's disabled Play/Pause depends on
- [ ] `should keep tracks whose isPlayable is false` — covers the decision not to filter them, since
      the QR still works for those cards
- [ ] `should skip entries with no track id or no title and report the skipped count` — covers
      defensive normalization without silent deck shrinkage
- [ ] `should return not-found-or-private for a 200 response whose pageProps has no state key` —
      **the most important test in this plan.** Covers the Phase 0 finding that a missing playlist
      arrives as HTTP 200. If this regresses, a bad link produces an empty deck instead of an error
- [ ] `should return upstream-unavailable for a non-200 response` — covers transient upstream failure
- [ ] `should return upstream-unavailable when fetch itself rejects` — covers the network-error branch
- [ ] `should return unexpected-payload when the __NEXT_DATA__ script is absent` — covers a redesign
      or captcha wall
- [ ] `should return unexpected-payload when the trackList path is missing` — covers a payload shape
      change
- [ ] `should return unexpected-payload when entity.uri does not match the requested id` — covers the
      identity assertion, i.e. the wrong-playlist class of bug Phase 0 hit in its own spike
- [ ] `should set truncated when the track list length equals MAX_EMBED_TRACKS` — covers the boundary
      at exactly 100
- [ ] `should leave truncated false below the cap` — covers the other side of the boundary, so the
      warning cannot fire on every playlist
- [ ] `should send a browser User-Agent header` — covers the request-shaping requirement Phase 0
      relied on, asserted against the injected fetch
- [ ] `should not include the upstream access token anywhere in its result` — covers that the anonymous
      bearer token Phase 0 found in the payload is not leaked outward

`api/playlist.ts` itself is left to manual verification and is deliberately thin for that reason: it
contains only a method guard, a query read, two calls, and an error-code-to-status mapping. If it grows
logic worth testing, that logic belongs in the adapter instead.

---

## Documentation Updates

- [ ] `docs/api.md` — replace the `[planned — Phase 2]` `/api/playlist` section with the built endpoint:
      method, the `url` query parameter and every accepted input form, the success body, and a table
      mapping each `PlaylistErrorCode` to its HTTP status. Add `api/playlist.ts` and the `api/_lib/`
      helper directory to the §2 layout listing, noting that `_`-prefixed paths are not routed. Fill in
      §5 Error handling, which currently says only that there is nothing to document yet — and lead with
      the 200-means-not-found trap
- [ ] `docs/architecture.md` — flip the playlist path from `[planned]` to `[built]` in §1 and §7,
      update the §3 data-flow diagram to show the real request shape, and add a line to §2 about where
      server-only helper modules live and why they cannot live in `shared/` (env access fails
      `typecheck:app`)
- [ ] `docs/development.md` — a short section on exercising `/api/playlist` locally: use `vercel dev`
      on port 3000, **not** `pnpm dev`, and restate why a 200 from Vite proves nothing. Include a
      sample invocation and the expected shape of a failure
- [ ] `docs/agent_findings.md` — dated (ISO 8601) entries for: whether `api/_lib/` is routed by Vercel,
      any drift found between the Phase 0 payload description and what the endpoint returns today, and
      the resolution of the ID-length assumption if a 22-character check turns out to be too strict.
      Tell the developer when an entry is added, per `AGENTS.md`
- [ ] `docs/plans/plan.md` — tick Phase 2 checkboxes 1–2. The §2 and §4 Spotify-year-fallback
      corrections were **already applied at planning time (2026-08-03)** and are owned by
      [plan.phase-2-year.md](./plan.phase-2-year.md); nothing about them is left to do here.
- [ ] `docs/plans/plan.phase-2-playlist.md` — tick implementation steps as they complete, and append
      execution notes where reality differed from the plan, matching the style of
      [plan.phase-1.md](./plan.phase-1.md)
- [ ] Inline comment in `shared/artists.ts` — state the separator hazard and name the four failing
      artist names, so the "obvious" split is never introduced later
- [ ] Inline comment in `api/_lib/spotify-embed.ts` — cite the Phase 0 finding for the 200-with-404-body
      error shape directly above the branch that handles it. This is the single most reversion-prone
      line in the plan: it reads like a mistake to anyone who has not read the finding
- [ ] Inline comment in `shared/types.ts` — note that `Card` carries `year`/`yearConfidence` that this
      plan never fills, and that Phase 3 owns `GameState` and must not widen `Card` with game state
- [ ] Fixture provenance note in `api/_lib/__fixtures__/` — which playlist ID and what date each
      fixture came from, and that they are trimmed rather than verbatim captures

---

## Testing Strategy

- **Unit tests:** everything listed above. The adapter is the priority — [plan.md](./plan.md) §4 names
  the embed endpoint breaking as a live risk and prescribes tests around the adapter as the mitigation.
  Coverage of the error branches matters more than coverage of the happy path, because the happy path
  fails loudly and the error branches fail silently.
- **Integration tests:** none automated. A test that really fetches from Spotify would be
  non-deterministic, rate-limited, and would break the suite whenever Spotify changed something — which
  is exactly the event the adapter's fixtures are designed to make debuggable rather than mysterious.
  A single **manual** live check against a real playlist replaces it, run deliberately.
- **Manual verification:**
  - `vercel dev` on port 3000, then request `/api/playlist` with a real public playlist URL and confirm
    the card count, that titles and artists look right, and that `previewUrl` is present on most tracks.
    **Do not use `pnpm dev` for this** — it returns the transpiled source of `api/playlist.ts` with a
    200 status and never runs the handler (`docs/architecture.md` §5)
  - Request with a nonexistent-but-well-formed playlist ID and confirm a **404**, not a 200 with an
    empty deck. This is the manual counterpart of the most important unit test
  - Request with an album URL and confirm 400 `unsupported-entity`; with junk and confirm 400
    `invalid-url`
  - Request one of the Phase 6 suggested playlists known to hold more than 100 tracks (Rock Classics,
    `37i9dQZF1DWXRqgorJj26U`) and confirm `truncated` is true with exactly 100 cards
  - Confirm the response carries no upstream HTML and no `accessToken` anywhere
  - Grep for `@/` under `api/` before deploying — the one layout rule that cannot be verified locally
  - After deploying, confirm `/api/hello` still returns `maxEmbedTracks: 100`, which is the standing
    check that cross-directory `shared/` imports survived the function build, and confirm
    `/api/_lib/spotify-embed` is not a live route

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Phase 2 is split into two plans**, this one and [plan.phase-2-year.md](./plan.phase-2-year.md)                                                  | Developer's choice. The two halves touch different external services, share only a small type, and could be built by different people or in either order. A combined plan would be ~30 steps spanning two unrelated failure domains.                                                                                                                                                                                                                                 |
| 2   | **Pure logic in `shared/`, I/O in `api/_lib/`**, with `fetch` injected into the adapter                                                           | `shared/` is checked by both tsconfigs and may use no platform APIs, which makes it the right home for the parser and the artist helper — and lets Phase 6 reuse the parser unchanged. Injection is what allows the adapter's error branches to be tested offline against fixtures.                                                                                                                                                                                  |
| 3   | **Helpers live under `api/_lib/`**, relying on Vercel not routing `_`-prefixed paths                                                              | Standard Vercel convention and keeps server-only code beside the function that uses it. Chosen over pre-emptively adopting a root-level `server/` tree, which is risk-free but permanently adds a fourth top-level directory and two import rules to a repo whose docs lean hard on the three-tree `src`/`api`/`shared` story.                                                                                                                                       |
| 3a  | **The convention is settled by a throwaway probe deploy as the first step of execution** (developer-accepted 2026-08-04), not verified at the end | Only observable on a real deploy — `typecheck`, `lint`, `test`, and `build` all pass either way. Before any helper exists the fallback is a directory rename; after ten files import each other it is a migration plus doc rewrites. Matches the repo's established probe-then-revert habit (Phase 1 did this for the ESLint globals blocks and the DOM-vs-Node typecheck split), and this repo has already lost time to two failures that passed every local check. |
| 4   | **Server-only code cannot live in `shared/`**                                                                                                     | Not a preference — a hard gate. `tsconfig.app.json` supplies only `vite/client` types and includes `shared/`, so any `process.env` reference there fails `pnpm typecheck:app`. Worth recording, because "just put it in shared" is the obvious wrong move.                                                                                                                                                                                                           |
| 5   | **`GET` with a `url` query parameter**, not `POST` with a body                                                                                    | Cacheable at Vercel's edge, trivially reproducible with `curl`, readable in the network tab. No payload is large enough to need a body.                                                                                                                                                                                                                                                                                                                              |
| 6   | **Regex extraction of `__NEXT_DATA__`, no HTML-parser dependency**                                                                                | One `<script>` tag with a known `id` containing JSON. Next.js escapes `</script>` inside embedded JSON, so the naive terminator is safe. A parser would add a runtime dependency and cold-start cost on a latency-sensitive path for no benefit.                                                                                                                                                                                                                     |
| 7   | **Branch on `pageProps.state`, never on HTTP status**                                                                                             | Phase 0 measured that a nonexistent playlist ID returns HTTP **200** with `pageProps: {status: 404, …}`. Status-based handling would present a missing playlist as an empty deck. Non-negotiable, and commented at the branch because it looks like a bug.                                                                                                                                                                                                           |
| 8   | **`private` and `not-found` collapse into one code, `not-found-or-private`**                                                                      | A deliberate deviation from [plan.md](./plan.md)'s "private / not-found / unsupported" wording. Phase 0 never tested a private playlist and noted the shape is likely identical, since Spotify avoids leaking existence. Inventing a `private` code that no observable signal supports would be a lie in the type system. Revisit if a distinguishing signal is ever found.                                                                                          |
| 9   | **The artist string is never split for display**; only a lossy `primaryArtistGuess()` is derived, for MusicBrainz                                 | The separators Spotify joins with occur inside real artist names — "Earth, Wind & Fire", "Simon & Garfunkel", "Tyler, The Creator". Splitting for display would corrupt the reveal side, which is the payoff of the whole game. The guess is safe only because the sibling plan queries the full string first.                                                                                                                                                       |
| 10  | **Unplayable tracks stay in the deck**                                                                                                            | The QR code is always rendered and always works ([plan.md](./plan.md) §2, non-negotiable), so an unplayable track is still a playable card. Only Phase 4's Play/Pause and Restart are affected. Filtering them would shrink decks for no reason.                                                                                                                                                                                                                     |
| 11  | **`truncated` is a boolean flag; this layer does not attempt pagination**                                                                         | Phase 0 established the 100 cap and that the payload carries **no** total, offset, or `hasMore`, and separately that the leaked anonymous token is quota-exhausted and unusable for paging. A boolean is the honest maximum this layer can report. Phase 6 renders the warning; a real fallback is deferred past v1.                                                                                                                                                 |
| 12  | **Playlist snapshot caching via a `Cache-Control` edge header, not Redis**                                                                        | Keeps this plan free of any dependency on the sibling plan's cache layer, so the two are independently shippable and order-independent. A short window because playlist contents change — and Phase 6's suggested editorial playlists are refreshed on Spotify's own schedule.                                                                                                                                                                                       |
| 13  | **The card's `year` is left unresolved here**                                                                                                     | Year resolution is the sibling plan. The field exists on the type so Phase 3 and Phase 4 have a stable shape to build against, but nothing in this plan sets it.                                                                                                                                                                                                                                                                                                     |
| 14  | **The embed `entity.uri` is asserted against the requested ID**                                                                                   | Cheap insurance against the exact bug Phase 0 hit during its own spike, where two parallel agents silently analysed the wrong playlist because of a shared-file write race. Turns a silent wrong-deck into a loud error.                                                                                                                                                                                                                                             |
| 15  | **Track IDs are assumed to be 22 base62 characters**                                                                                              | True of every Spotify ID observed, and a useful early rejection. Recorded as an assumption rather than a fact because it is a format convention, not a documented guarantee — if a valid link is ever rejected, this is the first thing to relax.                                                                                                                                                                                                                    |

---

## Open Questions

- [ ] **Is `api/_lib/` really excluded from Vercel's function routing?** Still genuinely unknown — it is
      only observable on a real deploy. What is **no longer open is how it gets answered**: keep
      `api/_lib/` and settle it with a throwaway probe deploy as the first step of execution
      (developer-accepted 2026-08-04; see decisions 3 and 3a, and step 1 of Implementation Steps). This
      entry stays unticked only until the probe runs, and the answer belongs in
      `docs/agent_findings.md`.
- [ ] **Is the 22-character base62 ID check too strict?** No counter-example is known, and rejecting
      early gives a better error than a 404 from Spotify. If a user ever reports a valid link being
      rejected, relax to a permissive base62 length range.
- [ ] **How long should the `s-maxage` window be?** Long enough to make a repeated Start instant, short
      enough that editing a playlist and retrying reflects the change. Start conservative — a few
      minutes — and revisit in Phase 6 when the real Start flow exists and the trade-off is observable.
- [x] ~~**Does the embed payload still match the Phase 0 field inventory?**~~ **Re-confirmed live
      2026-08-04, before the adapter was written: yes, with no drift that touches this plan.** Checked
      Today's Top Hits, Rock Classics, and a nonexistent-but-well-formed ID. The `__NEXT_DATA__`
      location, the `entity.trackList` path, every track-level field, the 100-track cap, the absent
      year/album at track level, the `accessToken` leak, and — critically — the **HTTP 200 with no
      `pageProps.state`** error shape are all exactly as Phase 0 recorded. The only difference is
      additive: playlist-level `authors`, `hasVideo`, `relatedEntityUri` and `type` are present and were
      not in Phase 0's list. Full detail in `docs/agent_findings.md`.
- [ ] **Should the skipped-track count surface in the UI?** The response reports it, but whether Phase 6
      shows it is that phase's call. Deliberately left undecided rather than pre-empted.

---

## Out of Scope

- **MusicBrainz, year resolution, the cache layer, and `/api/year`** — all of it is
  [plan.phase-2-year.md](./plan.phase-2-year.md). This plan sets no `year` value.
- **The Redis playlist-snapshot cache** sketched in [plan.md](./plan.md) §3 — replaced here by an edge
  `Cache-Control` header. Revisit only if the edge cache proves insufficient.
- **Pagination past 100 tracks and any manual track-paste fallback** — Phase 0 explicitly deferred both
  past v1 ([plan.md](./plan.md) §5 and §6). This plan only reports `truncated`.
- **Rendering the truncation warning**, the landing page, URL input, and inline error states — Phase 6.
  This plan produces the codes those screens will render.
- **`GameState`, the reducer, seeded shuffle, localStorage resume, and progressive loading** — Phase 3.
- **The card component, CSS 3D flip, QR rendering, and audio playback** — Phase 4. This plan only
  carries `previewUrl` and `isPlayable` through.
- **Any Spotify authentication** — there is none and none is needed; see [plan.md](./plan.md) §2 before
  reconsidering.
- **Retry, backoff, or circuit-breaking around the embed endpoint** — one attempt, mapped to a typed
  error. Add it only if real failures justify it.
- **Running `vercel link` or `vercel deploy`** — the developer performs deploys manually, as in Phase 1.
