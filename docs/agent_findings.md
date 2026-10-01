# Claude Code Findings

Running log of discoveries, gotchas and measurements, one dated entry each. The rules for adding,
editing and removing entries are in [`AGENTS.md`](../AGENTS.md) § Findings; the reasoning behind each
standing rule is in [`decisions.md`](./decisions.md). Code and docs cite entries **by date**, so keep
the date of an entry when editing it.

Condensed on 2026-10-01: entries that a later entry or the code had overtaken were removed or folded
into their successor, and narrative was cut down to the conclusion and its evidence. The full text is
in git history (`git log -- docs/agent_findings.md`).

### Entry format

```
## YYYY-MM-DD — <short title>

<finding or conclusion>
```

---

<!-- Claude Code: append new findings below this line -->

## 2026-08-04 — Spotify embed payload re-verified live; Phase 0's inventory still holds

Fetched `open.spotify.com/embed/playlist/{id}` (browser `User-Agent`) for Today's Top Hits
(`37i9dQZF1DXcBWIGoYBM5M`), Rock Classics (`37i9dQZF1DWXRqgorJj26U`) and a well-formed bogus ID
(`0000000000000000000000`):

- Payload at `<script id="__NEXT_DATA__" type="application/json">` →
  `props.pageProps.state.data.entity`.
- **The 200-means-not-found trap is real.** The bogus ID returns **HTTP 200** with `pageProps` keys
  `status, title, description, links, rtl, …`, **no `state` key** (`status: 404`,
  `title: "Page not found"`). Branch on `state`, never on the HTTP status.
- Track keys: `uri, uid, title, subtitle, isExplicit, isNineteenPlus, contentRatings, duration,
isPlayable, playabilityReason, audioPreview, entityType`. **No album name and no release year at
  track level.** Playlist level additionally has `authors`, `hasVideo`, `relatedEntityUri`, `type`;
  `releaseDate` is `null`.
- Rock Classics returns exactly **100** tracks (the cap), Top Hits **50**; no total/offset/`hasMore`, so
  `MAX_EMBED_TRACKS = 100` plus a truncation flag.
- `audioPreview.url` and `isPlayable: true` on 150/150 tracks sampled.
- The anonymous bearer token sits at `state.settings.session.accessToken` — the payload must never
  reach the client; `/api/playlist` returns only normalized cards.

## 2026-08-04 — `api/_lib/` is **not** routed by Vercel; Vercel compiles `api/` with TS 6.0.3

Probe deploy: `GET /api/_lib/_probe -> 404, X-Vercel-Error: NOT_FOUND`, and the build passed, so a
named-export-only file under `api/_lib/` neither becomes a route nor breaks the build. A convention,
not a documented contract — revisit if a helper ever starts answering requests.

The build log says `Using TypeScript 6.0.3 (local user-provided)`: **deployed functions are compiled
by the 6.0.3 install** (which exists only for `typescript-eslint`), not the `typescript-7` that
`pnpm typecheck` runs. Avoid TS 7-only syntax in `api/`.

## 2026-08-04 — SOLVED: relative imports under `api/` need an explicit `.js` extension

`/api/hello` returned **500 `FUNCTION_INVOCATION_FAILED`** in production with a clean build log.
`"type": "module"` makes functions ESM, Vercel **transpiles rather than bundles**, and Node's ESM
resolver does not guess extensions, so `'../shared/constants'` throws at load time.

| Route              | Import                     | Result                           |
| ------------------ | -------------------------- | -------------------------------- |
| `/api/ping`        | none (type-only, erased)   | `200 {"probe":"ping"}`           |
| `/api/ping-shared` | `'../shared/constants.js'` | `200 {"maxEmbedTracks":100}`     |
| `/api/hello`       | `'../shared/constants'`    | `500 FUNCTION_INVOCATION_FAILED` |

After the fix: `GET /api/hello` → `200 {"ok":true,"message":"custom-hitster api is alive","maxEmbedTracks":100}`.
**All local checks pass either way** — none models Node's ESM resolution of the deployed output, and a
deploy that "succeeded" only proves the build. TypeScript and Vite both resolve a `.js` specifier back
to the `.ts` source, so the rule is safe for `shared/` code the browser also imports; type-only
imports are exempt. Rule: AGENTS.md § Key Rules (Layout and imports).

## 2026-08-04 — ANSWERED: the 22-character ID check is exact, not a convention

A Spotify ID is base62 of a 128-bit GID, left-padded with `0`: `ceil(128 / log2 62)` = `ceil(21.50)` =
**22**. Confirmed on editorial, algorithmic (Discover Weekly, Daily Mix), chart, viral and user
playlists. **Do not relax the length.**

The endpoint distinguishes "undecodable" from "missing" — both HTTP 200 with no `state`:

| ID                        | len | decodes to < 2^128 | `pageProps.status`         |
| ------------------------- | --- | ------------------ | -------------------------- |
| `37i9dQZF1DXcBWIGoYBM5M`  | 22  | yes                | _(none — `state` present)_ |
| `37i9dQZF1DXcBWIGoYBM5`   | 21  | —                  | **500**                    |
| `37i9dQZF1DXcBWIGoYBM5MA` | 23  | —                  | **500**                    |
| `0000000000000000000001`  | 22  | yes                | 404                        |
| `7000000000000000000000`  | 22  | yes                | 404                        |
| `8000000000000000000000`  | 22  | **no**             | **500**                    |
| `aaaaaaaaaaaaaaaaaaaaaa`  | 22  | **no**             | **500**                    |

So `pageProps.status` is not always 404 — another reason to branch on `state`. Only **~12.6%** of the
22-char base62 space (`2^128 / 62^22`, leading char `0`–`7`) is a valid GID; the rest pass the regex
and come back `not-found-or-private` (harmless; tightening via BigInt decode left undone).

When a valid link is rejected, suspect the URL shape, not the length: the legacy
`open.spotify.com/user/{user}/playlist/{id}` (answers `301`) and `spotify.link/…` short URLs (`307`)
— both now handled (`shared/spotify-url.ts`, `api/_lib/short-link.ts`).

## 2026-08-04 — ANSWERED: a year lookup costs **two** MusicBrainz requests, and the second is where the accuracy comes from

Measured live against `musicbrainz.org/ws/2`, 1 req/s. The recording search inlines everything the
filter needs (`releases[].status`, `date`, `release-group.primary-type`, `secondary-types`; recordings
also carry `first-release-date` and `length`). **The search ignores `inc=`** and always returns that
fixed shape; its inlined release list is complete (matched the `recording/{id}?inc=releases+release-groups`
lookup).

```
GET /ws/2/recording?query=recording:"<title>" AND artist:"<artist>"&fmt=json&limit=100
```

**Filtering the search alone gives a reissue year**: the search inlines whichever _release_ matched.

| Track                               | Correct | Earliest inlined official-album release |
| ----------------------------------- | ------- | --------------------------------------- |
| Billie Jean / Michael Jackson       | 1982    | **2012** (Bad 25)                       |
| Bohemian Rhapsody / Queen           | 1975    | **2001** (A Night at the Opera reissue) |
| Sweet Child O' Mine / Guns N' Roses | 1987    | **2018** (Appetite reissue)             |
| Hotel California / Eagles           | 1976    | **2001**                                |
| Layla / Derek and the Dominos       | 1970    | **1990**                                |

The fix is one batched request for the release groups' own `first-release-date`:

```
GET /ws/2/release-group?query=rgid:(<id> OR <id> OR …)&fmt=json&limit=100
```

Unquoted UUIDs work and return exactly the requested groups; 50 ids ≈ 1.8 kB of query string. Score:
**12 of 13** known-tricky tracks exact vs Phase 0's ~6% naive baseline (14/14 after the `dur:` bound,
next entry). Since 2026-08-11 Singles/EPs count too (see that entry).

**Not tuning knobs:**

1. **`limit=100` is load-bearing**: at `limit=25` the same algorithm scores **2 of 13** — MusicBrainz
   ties dozens at `score: 100` in no useful order. 100 is the maximum. Do not reduce it.
2. **Do NOT push the filters into the Lucene query** (`AND primarytype:album AND status:official …`):
   it shrinks Billie Jean's pool 124 → 9 but drops the right recordings, and returns **zero** for
   Hallelujah / Leonard Cohen. Filter client-side over a wide pool.
3. **The recording's own `first-release-date` is not a substitute** (10 of 13; Sweet Child 1988, No
   Woman No Cry 1973) — used only for the relaxed `low` tier.

Also: `"Bohemian Rhapsody - Remastered 2011"` → **`count: 0`** vs 224 for `"Bohemian Rhapsody"` (title
cleaning is a correctness requirement), and a **503 `"The MusicBrainz web server is currently
busy…"`** was hit once in ~40 paced requests (the retry is needed).

## 2026-08-04 — The year-review screen was a spoiler surface; there is no pre-Start year UI

The person pasting the playlist is a player (no host role), so any pre-Start list of
title/artist/year hands them the deck's answers. **"Leaks nothing" is a property of the whole app**:
loading screens, progress text, notices, `localStorage`, and OS media-session metadata are all leak
surfaces. Year-quality notices are **count-only**. `confidence` is consumed on the **revealed** side
only. (A pre-Start review would also have required the full ~100-year crawl up front.)

## 2026-08-04 — Year resolution, as built: `dur:` in the query took it from 12/13 to 14/14

```
recording:"<cleaned title>" AND artist:"<artist>" AND dur:[<durationMs-10000> TO <durationMs+10000>]
```

It fixes the **pool**, not the ranking: Stairway to Heaven 842 → **31** candidates, Like a Rolling Stone
707 → **82**, Smells Like Teen Spirit 527 → **74** — all under the 100-result page, so truncation stops
deciding the answer and results stop varying between runs (Like a Rolling Stone had returned 1966 and
1963). The local duration preference (same `DURATION_TOLERANCE_MS`) measured neutral on top; kept for
tracks without a duration.

**A configuration check belongs in front of the cache, not behind it.** With the
`MUSICBRAINZ_USER_AGENT` check only in the adapter, a deployment without it served cached tracks and
500'd only on cold ones — a hard failure that looks intermittent. The check moved ahead of the cache
read in `api/_lib/resolve-year.ts`.

**Latency:** **1.3–3.6 s per cold track** in-process (two requests at 1.1 s gate spacing + network),
**0 ms** on a cache hit; a cold 100-track deck is minutes, and the 1 req/s budget is global.

## 2026-08-04 — `vercel dev` runs a FRESH PROCESS per invocation, so module-scope state never persists locally

| Request | `pid` | `uptimeSec` | module counter | `globalThis` counter |
| ------- | ----- | ----------- | -------------- | -------------------- |
| 1       | 21656 | 5           | 1              | 1                    |
| 2       | 35004 | 4           | 1              | 1                    |
| 3       | 19788 | 4           | 1              | 1                    |

Not fixable in our code (`globalThis` dies with the process too). Production keeps warm instances, so
module scope persists there per instance. Consequences under `vercel dev` without Upstash:

1. **The in-memory year cache never hits** (`cached: false` every time; `[year-cache] using in-memory
cache` prints on every request).
2. **The per-instance rate-limit gate paces nothing** (`nextAllowedAt = 0` each time; five rapid
   requests → `200 200 200 200 200`). Local MusicBrainz traffic is **unpaced** — configure Upstash
   before resolving more than a handful of tracks; the Redis gate is cross-process.
3. **~4 s spawn cost per request**: unconfigured requests returned `500 not-configured` in
   **4.1–5.7 s** doing no work. Never measure wall clock through `vercel dev`; it is fine for
   correctness (405, `not-configured`, title cleaning, `year: null`, response shape).

Noise, not traced: on Windows/Node 25.9.0 `vercel dev` prints `Assertion failed: !(handle->flags &
UV_HANDLE_CLOSING), file src\win\async.c, line 76` without affecting responses.

## 2026-08-05 — Phase 3 against a real playlist: the wall clock, and a third of an ordinary deck had no year

Real `api/playlist.ts` + `api/year.ts` served over local `node:http`, driven by the reducer + resolver
through `src/game/year-client.ts`; playlist `5KFmETOxEWVEtpa1voRfDU` ("rabacumple", 42 tracks), cold
cache, per-instance gate, sequential crawl at 1.1 s.

| Measurement                             | Result                                             |
| --------------------------------------- | -------------------------------------------------- |
| Full cold crawl, 42 cards               | **153.0 s** (~3.64 s/card, so ~3 min for 50 cards) |
| **Card-1 gate** (`START` → `playing`)   | **6.06 s** — one lookup, not one deck              |
| Priority jump (player outran the crawl) | **5.67 s**                                         |
| `/api/playlist`                         | 514 ms                                             |
| Lookups issued for 42 cards             | 43 (one retry)                                     |
| Warm re-crawl over the resolved deck    | **0 lookups**                                      |

- Per-card cold latency **1.08–11.27 s**; the pre-Start wait is ~6 s, not ~2 s.
- Jumping to the last card made the resolver finish its in-flight card, resolve _that_ card next, then
  resume order (~145 s saved).
- **`high = 19 (45%) low = 8 (19%) none = 15 (36%)`** on an ordinary (Latin/Catalan/chart) playlist —
  the curated 14/14 set was not representative. Five misses were an unstripped `- Remix` (next entry).
- **Zero 429s in 43 lookups**: a single sequential client waits ~1.1 s, under the 1.5 s
  `DEFAULT_MAX_WAIT_MS`, so it gets the permit. 429 back-pressure is multi-user only — hence unit-tested.
- One genuine `502 upstream-unavailable` (`Sunflower - Spider-Man: Into the Spider-Verse`) was retried
  to `2018/low`.
- With `MUSICBRAINZ_USER_AGENT` deleted the deck still started and spent **exactly one** lookup before
  halting the crawl.

## 2026-08-05 — Two Vitest 4 gotchas that cost a whole 150 s harness run

1. **`--reporter=basic` no longer exists** — `Failed to load custom Reporter from basic`, nothing runs.
2. **The default reporter swallows stdout of a PASSING test.** For a harness whose output is the point,
   `writeFileSync` the results.
3. **Vitest does not put `.env.local` into `process.env`** (Vite exposes only `VITE_` values on
   `import.meta.env`); a harness needing `MUSICBRAINZ_USER_AGENT` must parse `.env.local` itself.

## 2026-08-05 — The remix fallback: a third resolution tier, measured at 3 of 5 recovered

`stripRemixSuffix()` (`shared/year.ts`) drops a trailing remix segment (`- Remix`, `(Bad Bunny Remix)`,
`- Bootleg`, `- VIP Mix`, `- Remix Version`). `resolveYear()` uses it **only when strict and relaxed
both returned `year: null`**, then re-queries with the base title. It is not part of
`cleanTrackTitle()` because a remix is often a separately credited recording MusicBrainz knows under
its full title. Pinned by tests:

1. **A fallback hit is always `confidence: 'low'`.**
2. **`durationMs` is dropped from the fallback query and scoring** — a remix is not the original's length.
3. **A fallback upstream failure is swallowed** — the primary already gave a definite "no year".

`viaTitle` is set only on a fallback hit and lives on the cached result; `cleanedTitle` still reports
the primary query's title (the cache key's). (The cache was bumped to v2 for this at the developer's
instruction — the rule is unconditional; the schema is now `v6`.)

| Card                      | Result                                         |
| ------------------------- | ---------------------------------------------- |
| `Pininfarina - Remix`     | **2020 / low** via "Pininfarina" (recording)   |
| `4 KISSUS - Remix`        | **2024 / low** via "4 KISSUS" (release-group)  |
| `Tumba la Casa - Remix`   | **2015 / low** via "Tumba la Casa" (recording) |
| `Ella No Es Tuya - Remix` | still `none` — MusicBrainz has neither form    |
| `Además de Mí - Remix`    | still `none` — same                            |

**A successful fallback took 13.5–16.0 s** (failing: 4.8–14.2 s), past Vercel's old 10 s default, so
`vercel.json` sets `functions: {"api/*.ts": {"maxDuration": 30}}`.

## 2026-08-05 — Validated against a real Vercel preview deployment (and, at the time, NO environment variables)

Vercel CLI installed globally (`npm install -g vercel`, never a dependency); preview deploys only.

- **`maxDuration: 30` is validated at build time**: `999999` fails with _"The value for maxDuration must
  be between 1 second and 300 seconds"_ — this account's ceiling is **300 s**.
- **The `api/*.ts` glob matches** (`vercel inspect` lists `λ api/hello`, `λ api/playlist`, `λ api/year`);
  a glob matching nothing is a build error.
- `/api/year` in the deployed runtime: `Levels - Radio Edit` / Avicii → `2013 / high`; `Tumba la Casa -
Remix` → `2015 / low`, `viaTitle: "Tumba la Casa"`; `Además de Mí - Remix` → `null / none`, 200, no 504.
- Edge cache works: a repeated `/api/playlist` logged `"source":"static"`, `"cache":"HIT"`.
- **`vercel curl` (through Deployment Protection) adds 10.5–16.5 s** of its own — useless for timing.
  Clean numbers need a **Protection Bypass for Automation** secret or protection disabled.
- As of 2026-08-05 `vercel env ls` → "No Environment Variables found": every year lookup 500'd
  `not-configured` (the preview used a one-off `vercel deploy -e MUSICBRAINZ_USER_AGENT=…`, which does
  not persist), and the cold-start logs showed `[year-cache] using in-memory cache (per-instance, not
shared)` / `[rate-limit] using per-instance pacing (does NOT enforce the global 1 req/s)`. **Do not
  crawl a deck against a deployment without both Upstash variables.**
- Noise: `(node:4) [DEP0169] DeprecationWarning: url.parse()` on every invocation comes from
  `@vercel/node` under Node 25, not this repo.

## 2026-08-05 — `backface-visibility` hides a card face visually and leaks every word of it

`backface-visibility: hidden` is a **painting** property: the text stays in the document for devtools,
Ctrl+F, the accessibility tree and screen readers. So `Card.tsx` **does not mount `CardRevealSide`
while unflipped** (the reveal face exists, empty). **A leak audit must cover attributes and accessible
names, not just visible text**: `aria-label`/`alt` (assert the exact list of names, not just the title's
absence), `durationMs` ("3:54" beside a QR identifies a track), and `navigator.mediaSession.metadata`
(lock screen; never set it — an omission someone will "fix"). `Card.id` in the QR is by design.
Rule: AGENTS.md § The card.

## 2026-08-05 — jsdom implements no media playback, and no canvas

`HTMLMediaElement.play()`/`.pause()` are stubs logging `Error: Not implemented:
HTMLMediaElement.prototype.play` — an unstubbed call is console noise plus a test that never becomes
"playing", not a clean failure. Stub **on the prototype**, recording the `src`, which makes ordering
assertable (pause against the outgoing `src` before setting the new one):

```ts
vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
  calls.push(`play:${this.getAttribute('src') ?? ''}`);
  return Promise.resolve();
});
```

- `currentTime` is stored but never advances.
- There is no `<canvas>`, so `qrcode` is mocked in tests (the card's QR is now SVG via `toString`; every
  double must mock `toString` explicitly — AGENTS.md § The card).
- `element.src = ''` resolves to the page URL and loads the page as media; use `removeAttribute('src')`.

## 2026-08-05 — How the DOM test environment is selected, and why `node` stayed the default

Vitest honours a per-file `@vitest-environment jsdom` docblock (must be first in the file). A global
jsdom would let a DOM reference in `shared/` pass tests and break at deploy time. Testing Library does
not auto-clean without Vitest `globals` (first symptom: "found multiple elements with the role img"),
so every DOM file has its own `afterEach(cleanup)`; no `setupFiles`, no `jest-dom`. React 19 does not
flush a state update made outside `act()` before the next line. jsdom costs several seconds of
`environment` time per file. Rules: AGENTS.md § Key Rules, `toolchain.md` §5.

## 2026-08-05 — `PanInfo` is not importable from `motion@12`, and the workaround is better than the import

`motion@12.43`'s `./react` re-exports `framer-motion`, whose `index.d.ts` does not re-export `PanInfo`;
it lives in the transitive `motion-dom`
(`node_modules/.pnpm/motion-dom@12.43.0/node_modules/motion-dom/dist/index.d.ts:17`).
`src/hooks/useCardGestures.ts` declares local structural supertypes instead — `DragEndInfo` (`offset`,
`velocity`) and `GesturePointer` (`clientX`, `clientY`, `timeStamp`) — which the typecheck verifies
against Motion's handler types where the props are spread onto `motion.div`, and which keep Motion types
out of the hook's signature. **Do not add `motion-dom` to `package.json`** (a second pinned copy of
Motion's internals breaks after an unrelated upgrade).

## 2026-08-05 — Motion's drag cannot be exercised under jsdom, which is why gesture decisions are pure functions

jsdom computes no geometry (every box 0×0), so a dispatched pointer sequence at a `motion.div` does not
exercise the drag path — such a test asserts only that its double works. Thresholds live in
`src/game/gestures.ts` (node tests, both sides of each boundary); `useCardGestures` only collects and
dispatches. Pointer state is in **refs**, not state (a per-frame `useState` fights Motion's transform).
`gestures.test.ts` is a node test, deliberately. Rule: AGENTS.md § Gestures and Key Rules.

## 2026-08-05 — A lost `pointerup` would have half-broken tap-to-flip

A committed swipe is normally released **outside** the card (it moved away), so the card's
`onPointerUp` never fires and `didDragRef` stays `true` — the next real tap is rejected
(tap-to-flip working every other time). Fix: `pointerdown` resets the whole gesture (start, drag flag,
commit latch), plus `onPointerCancel`. **Any per-gesture flag cleared on the terminating event needs a
reset on the initiating one too** — capture, `pointercancel`, release outside and scroll-stolen
gestures all lose the end event.

## 2026-08-05 — Space on a focused button both activates it and flips the card

`GameScreen`'s window `keydown` flips on Space, but Space also activates the focused `<button>` — so
after clicking Play, one Space plays audio _and_ reveals the answer. Guard:
`if (active instanceof HTMLButtonElement) return;` on the Space branch only (ArrowRight still advances;
both pinned by tests). Focus is deliberately not moved off the control. **A global shortcut on a key
with a native activation meaning (Space, Enter) double-fires against whatever is focused.**

## 2026-08-05 — Absolutely positioned siblings paint over an in-flow sibling (card stack)

Positioned elements (`position: absolute`, `z-index: auto`) paint in a later layer than in-flow
content regardless of DOM order, so the stack's backs covered the in-flow card. Fix: `isolate` on the
container plus `-z-10` on the back(s); without `isolate` the negative z-index escapes and the back
vanishes behind the screen background. Still how `CardStack.tsx` is layered.

## 2026-08-05 — A button inside a tappable card flips it: the pointer twin of the Space-on-a-button bug

A pointer-up on a button inside the card bubbles into the card's `onPointerUp`, and `isTap()` sees a
genuine tap → Play also revealed the answer. A guard written for one input modality is not a guard for
the other. Fixed structurally: the controls moved to `src/components/CardControls.tsx` beside the stack,
and tests assert the card holds no interactive element. Rule: AGENTS.md § The card ("Nothing
interactive inside `Card`").

## 2026-08-05 — `START` had to skip the card-1 gate for an already-resolved deck, or Restart hung forever

The gate opens only on a `YEAR_RESOLVED` for card 1, and the resolver never looks up a card that already
has a year — so a pre-resolved deck (every Restart) stayed on the loading screen forever. `START` now
decides the status from card 1's state (today:
`dropsNothing || yearStateOf(deck[startIndex]) === 'final' ? 'playing' : 'preparing'`). Each piece was
individually correct; only an integration test (`App.test.tsx`, restart from the current deck) could
find it. `RESUME` does not need it: a save is `preparing` only if card 1 was unresolved when written.

## 2026-08-05 — `pnpm dev` cannot exercise the playlist client

Under `pnpm dev` `/api/*` is not a function: the client gets a 200 that is not JSON, and reports
`unexpected-payload` ("Spotify returned something we could not read…"), which points at the wrong
layer. Correct behaviour, covered by `playlist-client.test.ts`. **Play under `npx vercel dev`.** (Under
Vite 8.2 the body is `index.html`, not the transpiled source — see 2026-09-18.)

## 2026-08-05 — Following a redirect from a user-supplied URL is the repo's first SSRF surface

`api/_lib/short-link.ts` resolves `spotify.link` URLs — user input choosing an outbound target from an
unrestricted Vercel Function. Four guards:

1. **`redirect: 'manual'`** — with automatic following the allow-list never sees an intermediate host
   (asserted on the `init` directly).
2. **Exact-host allow-list** on `URL.hostname`, never suffix/substring (also defeats
   `https://spotify.link@evil.example/x`).
3. **http(s) only.**
4. **Hop limit 3**, which is also the loop guard.

The SSRF tests script each forbidden target as **reachable**, and assert both refusal and that the call
was never made. Live: a real `spotify.link` is a **single 307** to `https://open.spotify.com/`;
**`link.tospotify.com` no longer resolves** (ENOTFOUND) but stays allow-listed so it reports
`upstream-unavailable`. Short-link failures map onto existing `PlaylistErrorCode`s; the resolver returns
a URL, so an album link falls through `parsePlaylistUrl()` as `unsupported-entity`.

## 2026-08-05 — Exit and deck-exhaustion are indistinguishable in `GameState`; the fix is a destination

Both are `status: 'ended'`, and `currentIndex` cannot separate them (`NEXT` past the last card stays on
it). So `App.tsx` keeps a container-local `EndedView` (`'end-screen' | 'landing'`) — a **destination**,
not a reason, because the end screen's second button must also leave `ended` and the reducer has no
`ended → idle` action. The "already dealt?" guard cannot be `state.status === 'idle'` (after an Exit
the status is `ended` while the picker shows); `App.tsx` compares object identity through a ref
(`dealtDeckRef`), which is also StrictMode-safe.

## 2026-08-05 — An unbound native `fetch` called as `options.fetchImpl(...)` throws "Illegal invocation"

A method call passes `options` as the receiver, and the browser's brand-checked `fetch` throws

```
TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
```

which the client's `try/catch` reported as `network` ("Could not reach the server…") — every Start and
every year lookup failed in a real browser. Node's `fetch` is not brand-checked, nor is any test double,
so all checks passed. Fix at both layers: clients destructure (`const { fetchImpl } = options`) and the
injection sites pass `globalThis.fetch.bind(globalThis)`; `brandCheckedFetch()` doubles (a `function`,
not an arrow) throw unless the receiver is `undefined` or the global. **A DOM built-in handed across a
seam must be bound; never call an injected function as a property of its options bag.**
`api/_lib/musicbrainz.ts`'s `deps.fetchImpl(...)` is safe under Node only — do not copy it into `src/`.

## 2026-08-05 — `vercel.json`'s SPA rewrite made the app blank under `npx vercel dev`

`{ "source": "/((?!api/).*)", "destination": "/index.html" }` is harmless in production (filesystem
first), but under `vercel dev` there is no `dist`, so `/src/main.tsx` got `index.html` as a module
script: `#root` empty, **no console error**. Fix:

```json
{ "source": "/((?!api/|@)[^.]*)", "destination": "/index.html" }
```

`[^.]*` excludes any path with an extension; `@` excludes `/@vite/client` and `/@react-refresh`.
Production is unchanged (app routes are extensionless). Check: `curl http://localhost:3000/src/main.tsx`
must return `text/javascript`. The dot exclusion is also what keeps `assetlinks.json` out of the
fallback (AGENTS.md § Google Play).

First real-browser end to end the same day (Chrome, `npx vercel dev`): Rock Classics → 100 cards,
`truncated: true`, card-1 gate opened, QR rendered, and the unflipped card's text carried no title,
artist or year.

## 2026-08-06 — Measured contrast ratios for every colour pair in the app (re-audited for the Phase 8 ring)

This table **replaced** Phase 7's 2026-08-05 table (one table, one build). Computed by converting the
`oklch()` tokens to sRGB and applying the WCAG 2.x relative-luminance formula; the calculator
reproduced all 16 of Phase 7's ratios to the digit first.

> **Method trap:** alpha compositing (`--opacity-disabled` on text, `warning-surface/40` on the
> notice) must be done on **gamma-encoded sRGB**, as CSS does. Compositing in linear light gave
> `--color-fg` at `--opacity-disabled` over `--color-surface-raised` **8.72:1** against the true
> **5.94:1** — an error that makes a failure look like a pass.

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

Since this table, "Scan to play" moved off the hidden face to below the card in `text-fg-muted` on
the page (the 6.12 row); the accent-as-text pair is in the 2026-08-12 entry (5.13:1).

- **Focus ring on danger, 2.65:1, is exempt, and the obvious fix is wrong.** `focus-ring` is a 2px
  outline at `outline-offset: 2px`, so it is painted in the gap outside the button, over the dialog's
  `--color-surface` (16.42:1); the danger fill is never adjacent. The ring is one colour app-wide, and
  no colour clears 3:1 on both a near-black page and a light red fill. Same reasoning covers the
  3.36:1 accent row. Found only because every pair was recomputed, not just the changed ones.
- **`--color-fg-decorative` 1.94:1** stays exempt: the `····` pending glyph only, `aria-hidden`.
- **The backs' border was 1.31:1** (`border-border`, nearly invisible, covered by neither 1.4.3 nor
  1.4.11); `--color-ring-dim` puts it at 4.23:1.
- **Why three values are what they are:** `--color-fg-muted: oklch(65% 0 none)` must clear 4.5:1 on
  page, card face and control surface; Tailwind's neutral scale jumps 55.6% → 70.8%, and the minimum
  passing lightness is **60% on `neutral-900`, 64.5% on `neutral-800`**. `--color-on-accent:
oklch(14.5% 0 none)` replaces white on the unchanged emerald buttons (white on `emerald-700` passes
  at 5.37 but forces the hover darker than rest). `--opacity-disabled: 0.6` gives 5.94 (`0.5` passes
  at 4.59 with no margin). The focus ring is `oklch(97% 0 none)`; an emerald ring would vanish on the
  emerald button.
- **Phase 7's corrected failures, for the record:** placeholder `neutral-600` on `neutral-900`
  **2.30:1**, white on `emerald-600` **3.67:1**, `neutral-100` at `opacity-40` on `neutral-800`
  **3.46:1**, `neutral-500` on `neutral-950` **4.18:1** at `text-xs`.

## 2026-08-05 — `aria-label` on an input with a visible label is a WCAG 2.5.3 failure

`aria-label` is **not additive**: it overrides the visible `<label>`, so the URL input's accessible
name was "Spotify playlist link" while the visible text said "Playlist link" — a 2.5.3 (Label in
Name) failure that also breaks speech control ("click Playlist link" matches nothing). `aria-label`
belongs only on controls with **no** visible text. Ten test queries asserting the wrong name failed
when it was removed — tests written against the same misconception. Fixed alongside: `aria-invalid`
now has an `aria-describedby`, so the error's reason is reachable after the one-shot `role="alert"`.
Rule for this repo's checkboxes: AGENTS.md § Deal options (`OptionCheckbox`, no `aria-label`).

## 2026-08-05 — The card flip was silent to assistive technology

The reveal announced nothing, so the game was unplayable by screen reader. The fix, a polite
`role="status"` around year/title/artist in `CardRevealSide`, is **the one correct place to announce
track data**, because `Card` mounts that face only while flipped — the leak rule is about DOM
presence while unflipped, enforced by that conditional mount. Polite, not assertive: the player asked
for it. `CardHiddenSide.test.tsx` asserts no live region on the hidden face. Rule: AGENTS.md § Key
Rules (live region).

## 2026-08-05 — jsdom 30 has no `window.matchMedia` at all, and Motion 12 does not care

`window.matchMedia` is `undefined` under jsdom 30 / Vitest 4.1 (not partial — absent). Motion 12.43's
`MotionConfig reducedMotion="user"` tolerates it and resolves "not set", so **no stub is needed
anywhere** (and no global `setupFiles`, deliberately absent). `Card.test.tsx` pins this, because
nothing renders `main.tsx`, where `MotionConfig` lives. Consequence: **no jsdom test can observe
reduced-motion behaviour**; `src/index.css.test.ts` is a text canary for that reason.

## 2026-08-05 — Two ways of reading a sibling file inside Vite both fail, and the tidier one fails silently

- `import css from './index.css?raw'` returns **`''`** — Vitest's `test.css` defaults to `false`, so
  CSS (including `?raw`) is stubbed. Assertions over `''` pass vacuously.
- `readFileSync(new URL('./index.css', import.meta.url))` throws **`TypeError: The URL must be of
scheme file`** — Vite rewrites the `new URL(<literal>, import.meta.url)` pattern into an asset URL.
  A bare `import.meta.url` is untouched.

What works:

```ts
readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');
```

`node:*` imports typecheck under `tsconfig.app.json` despite `"types": ["vite/client"]` (that option
limits globals, not explicit imports).

## 2026-08-05 — Tailwind v4 harvests utility class names out of prose

Automatic content detection scans every non-gitignored file, Markdown included, so class-shaped words
in prose generate real CSS (`.select-none`, `.ring`, `.filter`, `.container`, `.w-72`, plain English
like "transition", "hidden", "table"…). Comments in `src/` naming old utilities keep dead rules alive
the same way.

| Build                           | CSS      | gzip    |
| ------------------------------- | -------- | ------- |
| as committed (Phase 6)          | 16.90 kB | 4.24 kB |
| with `@source not "../**/*.md"` | 15.18 kB | 3.98 kB |

**Deliberately not fixed** (still no `@source not` in `src/index.css`): the one-liner reclaims ~10%
of the stylesheet if bundle size ever matters.

## 2026-08-05 — Vitest's per-file environment tag is matched in PROSE

A header comment that merely _mentions_ the jsdom docblock tag — even "this is not a jsdom test", even
quoting it — makes the file a jsdom test (`typeof window === 'object'`, ~3 s `environment`). The
literal token must be **absent**; describe it instead. This silently defeats the `node` default that
makes a DOM API leaking into `shared/` fail a test (`toolchain.md` §5). Consequences: `grep -rl` for
the tag over-reports jsdom files; the honest per-file check is the `environment` timing in
`--reporter=verbose` (`0ms` = node), or an `expect(window).toBeUndefined()` canary.

## 2026-08-05 — An unknown Tailwind colour utility emits nothing, and all four checks pass either way

`text-text-muted` (a call site missed when `--color-text-muted` became `--color-fg-muted`) emitted no
rule, and the hidden face's only text fell back to near-black on a near-black card. typecheck, lint,
test and build were all green. Mitigations: (1) grep the built CSS after adding/renaming a token —
`grep -o '\.text-fg-muted{[^}]*}' dist/assets/*.css`; (2) assert the class name in the component's
test; (3) rename tokens and call sites in one pass. Applies to every custom-token family (`bg-surface*`,
`border-*`, `text-fg*`, `max-w-content`, `text-year*`) and the `@utility` composites. Rule: AGENTS.md §
Conventions.

## 2026-08-05 — `AnimatePresence mode="popLayout"` needs its child to accept a ref

Symptom: a swiped card's replacement rose from below the screen. Motion's `PopChild` clones the child
with a ref, measures it in `getSnapshotBeforeUpdate` and injects `[data-motion-pop-id] { position:
absolute !important }` — all guarded by `ref.current`. `Card` accepted no ref, so `popLayout` was
silently inert and the incoming card laid out a full `--card-height` below the outgoing one until it
unmounted. Fix: `Card` takes `ref?: Ref<HTMLDivElement>` on the outer `motion.div` (React 19, no
`forwardRef`). `Card.test.tsx` pins only that the ref reaches the outer element; the rest is
browser-only (jsdom computes no layout, so Motion bails before setting `data-motion-pop-id`). General:
any Motion feature that touches an `AnimatePresence` child's DOM node needs that child to forward a
ref. Rule: AGENTS.md § The card.

## 2026-08-05 — `.click()` on a button whose handler sets React state does not flush before the next line

`element.click()` dispatches outside `act()`, so a `setState` may not be committed when the next line
queries the DOM (the exit dialog "was not there"). `fireEvent.click` wraps in `act()`. **Use
`fireEvent` for anything that changes React state**; `.click()` only for handlers whose whole effect is
a call on a mock or ref (the audio presses).

## 2026-08-05 — Dropping yearless cards is a reducer change with a long tail

A card whose lookup finds no year is removed from the deck (now optional: `keepYearless`, AGENTS.md §
Deal options). What it took:

1. **The card-1 gate is a property of the deck** — `deck[0]?.year !== undefined` on the NEXT deck —
   not "the resolved card was `deck[0]`", or a drop opens the gate onto an unresolved card.
2. ~~Transient failures settling at `null` drop cards~~ — superseded by the year-fetch rework: a
   transient failure is never a final "no year" (AGENTS.md § Year resolution). Still true:
   `not-configured` dispatches `YEAR_LOOKUPS_UNAVAILABLE`, so a deploy without
   `MUSICBRAINZ_USER_AGENT` yields a yearless deck, not an empty one.
3. **Removal is an index problem.** Drops behind the player move `currentIndex` back; a dropped
   CURRENT card keeps the index but **must reset `isFlipped`** (else the next card mounts revealed — a
   leak); a dropped current card with nothing after it ends the session.
4. **Grep the test doubles when a value's meaning changes.** `stubYearApi()` answered `year: null`,
   which now deleted the deck and failed eight tests; it returns a real year, with
   `stubDroppingYearApi` for the drop path.

## 2026-08-06 — A suggested-playlist label with a bracket in it breaks a test that renders fine

`new RegExp(playlist.label, 'i')` turned "This is Duki (all songs)" into a capture group, so
`getByRole` threw on a button that renders. An exact string doesn't work either (the accessible name
is label + blurb). `LandingScreen.test.tsx`'s `suggestionButton()` escapes the label. Any `RegExp`
built from content has this bug latent.

## 2026-08-06 — Re-verifying a playlist id needs `entity.name`, and four of the nine hit the track cap

Verify a suggestion id against `https://open.spotify.com/embed/playlist/{id}` → `__NEXT_DATA__` →
`props.pageProps.state.data.entity`, by `uri` **and** `name`. On that day's set of nine: counts 100,
40, 100, 100, 50, 100, 50, 50, 50 (four hit `MAX_EMBED_TRACKS`, so four raise the truncation notice by
design); preview-less tracks 2/100 (Electro Latino) and 8/100 (This is Duki), so `noPreviewCard` is a
real path, not a 0.5% edge. The one-off script is deliberately not kept.

## 2026-08-06 — An empty playlist told the player it was our bug

The server does not catch it: `api/_lib/spotify-embed.ts` requires only that `entity.trackList` be an
array, and `cards` is a filter of it, so `cards: []` with `ok: true` is legitimate (an empty playlist,
or every track unplayable). The client owns the case: `empty-playlist`, copy "no tracks this app can
play" (not "is empty", which would be wrong for the second input). Previously it fell into
`unexpected-payload` ("a problem on our side").

## 2026-08-06 — `motion` was a third of the bundle, and the landing screen downloaded all of it

**Attribution method** (no analyser dependency): build with `--sourcemap`, decode the VLQ `mappings`,
charge generated bytes between segments to the source the first names, aggregate by package.

The single 373.39 kB chunk before the split:

| bucket                                                         |         kB |     share |
| -------------------------------------------------------------- | ---------: | --------: |
| `react-dom`                                                    |     178.16 |     48.0% |
| **`motion-dom` + `framer-motion` + `motion-utils` + `motion`** | **125.16** | **33.7%** |
| **`qrcode` + `dijkstrajs`**                                    |  **23.28** |  **6.3%** |
| `src/components/`                                              |      15.49 |      4.2% |
| `src/game/`                                                    |      12.57 |      3.4% |
| `react` + `scheduler`                                          |      11.38 |      3.0% |
| `src/hooks/`, `src/` root, `shared/`                           |       5.30 |      1.4% |

`GameScreen` went behind `React.lazy` (fallback = the preparing screen) and `qrcode` behind a dynamic
`import()`. **Landing: 373.39 → 218.52 kB raw, 119.92 → 70.27 kB gzip (−41.4%).** `MotionConfig` in
`main.tsx` keeps only a few framer-motion context modules eager — don't "finish the job" by moving it.
There is no audio code to lazy-load (`useCardAudio` is a hook over native `<audio preload="none">`).

## 2026-08-06 — Two concurrent `import()` calls for the same module: the second continuation never runs

With two `import('qrcode')` calls in flight (a card superseded before its code resolved), the second
`.then` never ran and the new card kept its placeholder. Fixed by memoizing at module scope
(`loadQrcode()`, now `src/game/qrcode-loader.ts`, shared with `usePdfExport`); a rejected load stays
cached on purpose (no retry loop on a flaky connection). **Test consequence:** a settled promise cannot
be un-settled, and `vi.resetModules()` + a flag silently asserts against a working library — the
load-failure case lives in its own file, `QrCode.load-failure.test.tsx`. `vi.mock` intercepts by
specifier, not import form.

## 2026-08-06 — A `React.lazy` boundary can turn Vite's first-time transform cost into a test flake

The first `App.test.tsx` test to reach `playing` paid Vite's cold transform of ~250 `motion` modules
inside a 1 s `waitFor` — order-dependent. Fix: `beforeAll(async () => { await
import('./components/GameScreen') })`, with an explicit `60_000` budget (see the `beforeAll` entry
below). Any future `lazy` boundary above a heavy dependency needs the same warm-up in its suite.

## 2026-08-06 — First Lighthouse pass, and a 1.26 MB favicon nobody was looking for

Landing screen under `vite preview`, Lighthouse 12.8.2: Performance 75, LCP 7.8 s, TBT 0, CLS 0.

- **SEO 91 was a `vite preview` artifact**: it answers every path, `/robots.txt` included, with the SPA
  shell at 200. Production 404s dotted paths (`vercel.json`'s `/((?!api/|@)[^.]*)`).
  `public/robots.txt` was added anyway (and disallows `/api/`, whose MusicBrainz budget is shared).
  **Don't treat `vite preview` as production for anything outside `/assets/`.**
- **LCP was the favicon, not the architecture.** `public/logo.png` was 1,262,175 bytes (1254×1254) —
  6× the landing JS. No audit flags a favicon, but it saturated simulated slow 4G. Replacing it with a
  small WebP took the page to **Performance 99 / LCP 1.6 s**, transfer ~1.36 MB → 98.7 kB, no code
  touched. The first conclusion ("LCP gated on React mounting, needs prerendering") was wrong; read
  the network log before blaming the architecture.
- The favicon is a WebP with no PNG fallback (today `logo.webp`, 384×384, 13 kB — regenerated
  2026-08-12). If a fallback is ever needed, add a _small_ one. Rule: AGENTS.md § PWA and `index.html`.

## 2026-08-06 — A yearless deck showed "Deck finished" over a count of zero

When every card drops, the session reaches `ended` with an empty deck, which rendered the end screen
over `cardsPlayed = 0`. Fixed in the container: `deckCollapsed = status === 'ended' && deck.length ===
0`, checked **before** `endedView`. Exact, not heuristic: every other route to `ended` leaves played
cards in the deck. Covers `YEAR_RESOLVED`, `START` with nothing dealable, and `RESUME` of a
pre-reversal save. `no-years-found` lives in `messages.ts`'s `StartFailureCode =
PlaylistClientErrorCode | 'no-years-found'`, never in the client's union (whose test enumerates what
the client can return). Test note: await the **alert**, not the input — the picker is already mounted
at `idle`, so a picker query resolves on frame one. Rule: AGENTS.md § Screens.

## 2026-08-06 — Re-spike: the embed payload still has no attribution field

Playlists `37i9dQZF1DX0XUsuxWHRQd` (RapCaviar, editorial, 50 tracks) and `2wJx2AIytvpaSJLsc2wy3V`
(Radio Brianper, user-owned, 100 tracks). **Track-level union, identical on both:** `uid`, `uri`,
`title`, `subtitle`, `duration`, `isExplicit`, `isPlayable`, `isNineteenPlus`, `playabilityReason`,
`entityType`, `contentRatings{labels}`, `audioPreview{url,format}`. No attribution field; the raw
payload contains none of `added_by`, `addedBy`, `addedAt`, `added_at`. Playlist level has 18 fields;
the only attribution-shaped one, **`authors`, is `null` on both**. Building "Added by" would need a new
auth path, which re-opens `plan.md` §2's no-credentials decision — resolved won't-build. Suggestion
labels are readable renderings, not Spotify's titles verbatim; verify by `entity.uri` **and**
`entity.name` against the playlist, never against the label.

### The procedure, so the third check is a re-run and not a redesign

**Re-run these five steps before re-opening the item**, not a fresh investigation.

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

## 2026-08-06 — The suite flake: `Errors` with zero failed tests means the jsdom files never ran

Signature, seen 2026-08-05 and twice on 2026-08-06:

| Run                  | Files        | Tests                | Errors | `environment` time | `import` time |
| -------------------- | ------------ | -------------------- | -----: | -----------------: | ------------: |
| Bad run (2026-08-06) | 21 of 36 ran | 339 passed, 0 failed | **15** |         **12.2 s** |        13.6 s |
| Healthy runs (×6)    | 36 of 36     | 497 passed           |      0 |          337–378 s |     104–113 s |
| Bad run (2026-08-05) | 19 of 32 ran | (not recorded)       | **13** |                  — |             — |

**Zero tests fail** (the files never ran) and **`environment` time collapses** (~28× lower): a per-file
jsdom initialisation failure, always ~15 of the 17 jsdom files. Refuted triggers: CPU load (six
concurrent builds alongside a test run) and a cold transform cache. Only lead: both occurrences ran
`pnpm test` chained with `pnpm build` in one shell invocation. **Re-run before investigating, and read
the file and test counts — a green exit code alone does not prove the jsdom half ran.** Later flake
shapes: the `beforeAll` entry below, 2026-08-06 "third flake shape", 2026-09-19 and 2026-09-29
(`App.test.tsx`).

## 2026-08-06 — Phase 4's stop-on-flip audio rule reversed: the preview now survives the reveal

Audio stops on a **card change** and a **confirmed Exit**, no longer on flip — hearing the song while
reading the year is the point of the reveal. The other justification (bleed into the next card) is
already covered by the card-change effect, keyed on `currentCard.id` (covers duplicated tracks and
swipes, so `useCardGestures` knows nothing about audio). `wasFlippedRef` was deleted; nothing added.
`GameScreen.test.tsx`'s `should not stop audio when the card is flipped` pins it. Rule: AGENTS.md §
The game session.

## 2026-08-06 — A mount-lifetime "already submitted" ref breaks the share link under StrictMode

```ts
if (deckLink === null || linkSubmittedRef.current) return;
linkSubmittedRef.current = true;
request(spotifyPlaylistUrl(deckLink.playlistId));
```

Under React 19 StrictMode this deals nothing: the simulated unmount's cleanup in `usePlaylist`
**aborts** the request, the re-run sees the ref set, and `requestState` sticks at `loading` forever
(dev only). **An effect that starts work another hook cancels on cleanup must not be guarded by a ref
that survives the cleanup** — reset it in the effect's own cleanup, or have none (what `App.tsx` does:
both dependencies are stable, so the body runs once per mount; StrictMode makes two requests, the first
aborted). Regression test: `App.test.tsx`'s `should read the link exactly once under StrictMode double
rendering` asserts the deal and bounds fetches at two. Rule: AGENTS.md § Decks.

## 2026-08-06 — The saved-playlist library leaked on the WRITE side, not the read side

TypeScript's excess-property check does not fire for a spread or a variable, so `savePlaylist(storage,
{ ...somethingLarger })` type-checked and wrote every extra field to `localStorage`, read on a
pre-start screen. Caught by `should store nothing beyond id, name and timestamp`. **Validating only on
read is not enough when the store is the leak surface** — rebuild field by field on write too. Rule:
AGENTS.md § Decks.

## 2026-08-06 — PDF text: WinAnsi already covers Spanish, and the two cases that still bite

All in `src/game/pdf-text.ts`:

- **WinAnsi covers every Spanish, Portuguese, French, German and Italian glyph** (`á é í ó ú ü ñ ¡ ¿ ç
ã õ`), so the common case is a no-op. Embedding a 200–400 kB font would fix Polish/Turkish and still
  fail Cyrillic/CJK — the wrong trade.
- **Stroked letters don't decompose under NFD**: `ł`, `đ`, `ı`, `ħ`, `ŧ`, `œ` have no combining mark and
  printed as `?` (`Zaz?c`). A small hand-written fallback map covers them; anything needing a language
  judgement stays `?`.
- **The filename needs a second, stricter pass**: `sanitizeForPdf` keeps `É`, then the `[^a-z0-9]` slug
  deleted it ("Éxitos Verano" → `jitster-xitos-verano.pdf`). `pdfFileName` strips marks before slugging.

Cyrillic/CJK titles print as `?`; year and QR are unaffected (`development.md` §8).

## 2026-08-06 — `dist/assets/qrcode-loader-*.js` is React glue, NOT the QR encoder

Rolldown named the shared vendor chunk after `qrcode-loader.ts`: 10.81 kB, `modulepreload`ed on the
landing screen, containing React's JSX runtime (formerly `preload-helper-*.js`, 11.68 kB). No
`toDataURL`/`toString`, no `dijkstra`, no encoder. Real network log on a hard reload of the landing
screen: exactly the document, `index-*.js`, `rolldown-runtime-*.js`, `preload-helper-*.js`,
`qrcode-loader-*.js` and the CSS. **Not** requested: `jspdf.es.min-*.js` (399.95 kB / 129.95 kB gzip),
`html2canvas-*.js` (199.49 kB), `purify.es-*.js`, `index.es-*.js`, `browser-*.js` (the QR encoder,
23.47 kB), `GameScreen-*.js`. **Re-check in a network log after any new dependency** — the build output
cannot tell a `modulepreload` from a name.

## 2026-08-06 — A `beforeAll` that times out SKIPS the whole file, and reads as a failure

`pnpm test` reported `1 failed | 39 passed` with `src/App.test.tsx (27 tests | 27 skipped)` while the
file passed alone: the `GameScreen` warm-up hook exceeded the default 10 s hook timeout under a full
parallel run. Fixed with an explicit `60_000` (a ceiling, not a wait). **Two "not a real failure"
shapes:** `Errors` with zero failed tests = jsdom workers never started (re-run); `N skipped` in one
file = a hook timed out.

## 2026-08-06 — The real-device pass (Android): gestures/audio/QR fine, one lock-screen defect

Run on **Android only** (`plan.phase-8-features.md` step 23). "Gestures work fine" — so the
constants in `src/game/gestures.ts` (incl. `SWIPE_COMMIT_DISTANCE_PX` 96px, 52% of the card's width
at its floor) are validated on one device. "Audio sounds good" — the keep-playing-on-flip rule
confirmed on hardware. "QR scans right" on screen (~144px); the **printed** scan is separate.

**Defect: the preview kept playing with the phone locked** (Android keeps a playing `<audio>` alive;
`mediaSession.metadata` was never set, so nothing was named — the problem was playing at all).
`useCardAudio` now pauses on `visibilitychange` when `document.hidden` (also covers app/tab switch).
`visibilitychange`, not `blur` (a devtools click would pause) or `pagehide` (unload); **pause, not
stop** (`currentTime` survives); **no auto-resume**. It lives in the hook, not `GameScreen`, because
it is a property of the document, not the card. Rule: decisions.md § The game session.

Gotcha found writing the test: `useCardAudio.test.ts` had no `afterEach(cleanup)`, so every earlier
test's `<audio>` and its listener were still mounted. **A missing `cleanup()` is invisible until a
test observes something global** (a document-level listener).

Still owed: devtools DOM search on an unflipped card, printed-QR scan, lock-screen re-check, all of
iOS.

## 2026-08-06 — `public/logo.png` and `public/logo.webp` were DIFFERENT ARTWORK

Commit `5e178f6` (2026-08-06) deleted `public/logo.png` (1,262,175 bytes, 1254×1254, added in
`667b974`, 2026-08-03) and added `public/logo.webp` (20,610 bytes, 240×240). Different marks: the PNG
was a rounded **card stack** (equaliser bars, "PLAYLIST / HITSTER", "TU PLAYLIST, TU JUEGO", a vinyl);
the WebP a **circular** neon "HITSTER" wordmark. Phase 7's "replaced a 1.26 MB PNG costing 6.2 s of
LCP" note was true about bytes and silent about artwork. The developer chose the card-stack source for
everything. (The whole identity was regenerated again from a new master on 2026-08-12 — see that
entry; the master lives in `visual-assets/logo-master/`.)

Byte sizes as generated that day:

| File                       |              Size | Note                                                      |
| -------------------------- | ----------------: | --------------------------------------------------------- |
| `logo.webp`                |            10,376 | Smaller than the 20,610 it replaced; on the critical path |
| `pwa-192x192.png`          |            26,361 |                                                           |
| `apple-touch-icon.png`     |            23,526 | 180×180. iOS ignores manifest icons and uses only this    |
| `pwa-512x512.png`          |           131,461 |                                                           |
| `pwa-maskable-512x512.png` |           103,328 |                                                           |
|                            | **284,676 added** | None fetched before first paint                           |

PNGs palette-quantised to 256 colours (≈ halves them; the 512 was 227,819 truecolour), no visible
banding. **Never restore a large icon to the favicon slot.** Maskable sized by measurement: artwork's
max content radius is 95.1% of half-width, so drawing it at **84%** of the canvas puts content at
204.9px vs the 204.8px safe radius of the 80% circle. A renamed full-bleed 512, or one entry with
`purpose: 'any maskable'`, validates cleanly and gets cropped on round launchers — `manifest.test.ts`
asserts against it.

## 2026-08-06 — The two peeking backs never rendered (historical; cited by `CardStack.tsx`)

`BACK_OFFSET_PX = 10`, `BACK_SCALE_STEP = 0.04`, measured at the 448px ceiling: back 1 peeked
**1.04px**, back 2 **2.08px**, inset 5.76 / 11.52px on every other side. `scale()` is centre-origin,
pulling the bottom edge up by `(H / 2) × step` (8.96px) against a 10px push. Condition for any
visible peek: `offset > (H / 2) × step`; jsdom cannot test it. **Resolved the same day by deleting
both constants** — see "The deck's back is now the next card" below.

## 2026-08-06 — Lightning CSS prefixes `mask-composite` itself; a ring utility must not declare `position`

1. **Don't hand-write `-webkit-mask-*`.** Lightning CSS expands the two-line `mask` shorthand into
   the full longhand set with `-webkit-mask-image/-clip/-origin` and `-webkit-mask-composite: xor`
   (verified by grepping built CSS).
2. **`position: relative` inside the ring utility would be a bug**: the callers are `absolute inset-0`,
   so two custom utilities would collide in one layer and order would decide. Contract: **the caller
   is positioned**, pinned in `index.css.test.ts` (no `position` in either ring utility) and in the
   component tests (`absolute` beside the ring class). Rule: AGENTS.md § The card.

The ring adds no layout (border inside `border-box` + `box-shadow` glow), so CLS is unaffected; aim
Lighthouse at paint.

## 2026-08-06 — `includeAssets` plus a matching `globPatterns` silently duplicates precache entries

Five duplicated entries in `dist/sw.js` (both 512s, the 192, favicon, apple-touch-icon). Causes:
`includeAssets` is only for files `globPatterns` does **not** match (`public/` is copied to the build
root), and `vite-plugin-pwa` adds manifest icons itself. Fix: `globIgnores: ['pwa-*.png']`; **do not
ignore `apple-touch-icon.png`** (referenced from `index.html`, not the manifest — the glob is its only
route). Identical revisions meant workbox deduped silently; differing revisions would have been a
build-time `add-to-cache-list-conflicting-entries` throw. 19 entries after, no duplicates.

Adjacent: `vite.config.ts` imports `./src/pwa/manifest.ts` with an explicit **`.ts`** — Vite's native
config loader rejects extensionless imports, and this is resolved by Vite, never by Node, so the
`api/` `.js` rule does not apply.

## 2026-08-06 — A third `pnpm test` flake shape: a named assertion timeout under load

Signature: `Tests 1 failed` in `src/App.test.tsx`, a named assertion at a named line, **a different
test each run** (seen: `findByText(/deck finished/i)` at `App.test.tsx:566`; "should reset the end
reason…" timed out after 1101 ms). File alone and the next full run passed; failing runs showed more
cumulative `environment` time (462 s / 352 s vs 386–391 s). **The signal is reproducibility**: re-run
the file alone, then the suite. The file's root causes were later fixed — see 2026-09-19 and
2026-09-29.

## 2026-08-06 — The deck's back is now the next card, preloaded; two documented rules reversed

Players saw "two cards, one inside the other" while dragging: the centre-scaled empty backs. Now
**one back, `inset-0`, no transform, rendering the next card's real `CardHiddenSide`** — covered at
rest, revealed complete (QR included) during a drag. Reversed: the backs are no longer empty divs
(the leak half survives: `CardStack` never imports `CardRevealSide`; only the track id reaches the DOM
early, because the QR encodes it), and **`card-ring-dim` / `--color-ring-dim` are gone** — the back
takes `card-ring` plus `card-ring-quiet`.

- **`card-ring-quiet` sets a custom property, not `box-shadow`.** Two identical blooms would composite
  (0.45 over 0.45 ≈ 0.70 alpha); `box-shadow: none` beside `card-ring` would be two same-specificity
  declarations of one property. `card-ring` reads `var(--ring-glow-color, var(--color-ring-glow))`.
- **The QR cache (`src/game/qr-cache.ts`) is module-level and read during render.** Back and front are
  different elements, so per-element state loses the preload; reading in an effect paints one frame of
  placeholder.
- **Every DOM test that renders a card needs `clearQrCache()` in `beforeEach`** — Vitest isolates
  modules per file, and a warm cache makes placeholder assertions fail as if the component were too
  eager.

(Since then the card's QR became an SVG, so the "extra `toDataURL()` per advance" cost no longer
applies.) Rules: AGENTS.md § The card. Geometry unverifiable in jsdom (development.md §5).

## 2026-08-06 — The deck actions moved to the game screen; plan 2's decision 7 half reversed

End screen's second button is **"Home"** (prop `onHome`); `EndedView` was already a destination
(`'end-screen' | 'landing'`), not a reason, so the rename cost no state. Share/save/PDF are reachable
**mid-game** via `DeckActionsDialog`, because the only other route (the end screen) required `END`,
which clears the saved session — the price of a share link was the deck. Spoiler answered by
`DeckActions` rendering only counts (asserted in `DeckActions.test.tsx`, `DeckActionsDialog.test.tsx`,
`GameScreen.test.tsx`); swipe answered by the modal backdrop and **guard 4** (an OR over dialog flags —
a new dialog must join it). Rules: AGENTS.md § Deck actions, § The game session.

- `DeckActions` is shared by both screens and tested once, in `DeckActions.test.tsx`.
- The dialog focuses the **first action**, not Close (unlike `ExitConfirmDialog`'s Cancel); its focus
  trap is a real cycle, with the focusable list queried at Tab time (the copy-fallback input mounts
  late, Save disables itself).
- Bundle at the time: `index` 216.41 → 209.98 kB plus a shared 17.28 kB `DeckActions` chunk, **+4.8 kB
  gzip on the initial path** (68.24 → 73.06). Lever if needed: make `EndScreen` lazy (needs a Suspense
  fallback decision).

Unverified on a phone: panel fit at 360px with the copy fallback, `bg-page/80` legibility, control-row
crowding.

## 2026-08-07 — The PDF export waits for the year crawl; the link and the save do not

A link (ids + seed) and a save (ids + name) are complete once a deck exists; the PDF is finished when
made, and an export mid-crawl is quietly short. So Print **waits**. Rule and current gate (provisional
cards count as pending): AGENTS.md / decisions.md § Deck actions and the PDF export.

1. **The wait is derived**: `isWaitingForYears = hasAskedToPrint && pendingYearCount > 0`. A stored
   flag cleared by an effect is rejected by `react-hooks/set-state-in-effect`, correctly.
2. **`hasAutoExportedRef` is needed** because `hasAskedToPrint` stays true and `deck` changes identity
   on every resolved year; reset in `handlePrint`.
3. `excludedCount` and `nothing-to-print` are live branches (`selectPrintableCards` also drops
   `year === null`).
4. `Spinner` exists for its `data-motion` hook — a hand-rolled copy can miss the reduced-motion
   selector and nothing fails.

## 2026-08-07 — Multi-playlist plan 1: the version lifts, the `savedDeckKey` sort, and a plan that could not go green

1. **A plan that renames a type in plan 1 and updates consumers in plan 2 cannot have "all four checks
   green" as plan 1's exit.** Resolved with temporary n=1 shims (since deleted by plan 2).
2. **Both `localStorage` payloads went to v2 and read v1; the KEYS were deliberately not bumped** —
   bumping the key makes existing payloads unreachable (a library version mismatch clears the store
   silently). Lifts are exact because a v1 payload described exactly one playlist. **A v3 drops the
   v1 lift rather than chaining.**
3. **`savedDeckKey` must copy before sorting** (`[...ids].sort()`): `isPlaylistSaved` calls it on the
   arrays rendered by the landing screen. Tested for no mutation.
4. **A field-by-field rebuild is only as strong as its weakest field; a container field needs
   rebuilding element by element** — `ids` is filtered to non-empty strings on write.
5. `pdfFileName` collapses `[^a-z0-9]+` → `-`, so a `+` never reaches a filesystem. (The
   `format:check` CRLF note from this entry is superseded by 2026-09-19.)

## 2026-08-07 — Multi-playlist plan 2: three measurements (bundle, request count, deck size)

Step 7 of [`plan.multi-playlist-ui.md`](./plans/plan.multi-playlist-ui.md), measured on the build day:

- **Bundle, initial path: +3.10 kB raw / +0.77 kB gzip** on `index-*.js` (210.00 → 213.10 kB;
  65.94 → 66.71 kB gzip), plus **+0.16 kB raw / +0.04 kB gzip** of CSS — both plans together against
  the pre-multi-playlist `HEAD` (rows, the two notices, the fan-out, `deck-merge.ts`, both v2 migrations,
  the comma link). No new dependency.
- **A five-row submit makes exactly 5 `/api/playlist` requests under React 19 StrictMode**, all in
  flight together. No doubling: the submit is an event handler, and StrictMode double-invokes render
  and effects, not handlers — so the link path's double-fetch hazard (absorbed by `usePlaylist`'s
  abort) does not exist on the form path.
- **A real five-playlist deck: 390 raw tracks → 365 after the dedupe** (25 duplicates, 6.4%), over five
  then-current Spanish-chart/hits suggestions at 100 / 40 / 100 / 100 / 50 tracks. Three hit
  `MAX_EMBED_TRACKS`, so a deck like this raises the truncation notice. At the 2026-08-07 drop rate
  roughly a third more went to `no-years-found` at play time (~240 cards played); the year-fetch rework
  of 2026-09-30 has since cut that loss. Decision 12's "no cap" on deck size is not yet stress-tested
  against the HUD.

Not measurable locally, so owed to a deployment (`development.md` §5 "Multi-playlist" and §8): the wall
clock of a ~500-card crawl, and whether five parallel `/api/playlist` requests are ever queued or
rate-limited in a real browser.

## 2026-08-07 — The landing "+" is unmounted at the cap; a test helper became unsafe past five rows

The add-row button renders only while `canAddRow` (still `disabled={isLoading}`); the cap hint
(`COPY` `atMaxRows`) stays, because a control that vanishes unexplained reads as broken. **Swapping
`disabled` for unmounting turns a no-op interaction into a query failure**: `pressAdd()` throws in
`getByRole` on the sixth press, so loops must stop at `MAX_DECK_PLAYLISTS`
(`for (let i = 1; i < MAX_DECK_PLAYLISTS; i += 1)`).

The button is a full-width dashed ghost row (`rounded-lg px-3 py-2`, `hover:bg-surface` — no new
contrast pair). With visible text the `aria-label` was removed (WCAG 2.5.3); the test asserts
`hasAttribute('aria-label') === false` explicitly, because a role query passes identically with it.

## 2026-08-07 — "Print so far": the gate refuses a _silent_ short deck, not a short deck

The fix is disclosure: "PDF downloaded — N cards left out, no year yet" is the **whole** disclosure
(a caption was written and cut on review) — dropping the count reopens the silent short deck.

1. It does not touch `hasAskedToPrint` — **two files, both asked for**; `hasAutoExportedRef` is reset
   only in `handlePrint`, so the later auto-export still fires.
2. **`role="status"` wraps only the two wait sentences**: the button's climbing `Building PDF… n/m`
   inside a live region is one announcement per card. A live region should wrap the sentences that
   change, not the view.
3. **Focus on Cancel** (this action spends paper; focus arrives unchosen).
4. Reaching the export's `done` in tests needs `qrcode` **and** `jspdf` doubled via `vi.mock` by
   specifier (serves dynamic imports); the jsPDF double only implements `splitTextToSize` and `save`.
   Earlier tests all stopped at `nothing-to-print`, published before either `import()`.

A padded child inside a `gap`-ed flex column is spacing declared twice (`py-2` + `gap-4` gave 24px
where the panel uses 16px). Nothing has been printed.

## 2026-08-11 — The Play button's "first click does nothing" was a `pause` EVENT, not a missing await

**Do not await or `readyState`-gate `play()`** — it is called synchronously in the click handler
because the autoplay grant does not survive an `await`. Two compounding faults: `preload="none"`
means a cold fetch with no feedback, and `onPause` cleared `isPlaying` unconditionally while the fetch
was in flight, so the second press was a PAUSE that aborted the load (**pressing twice made it
worse** — the identifying detail).

Fix: `wantsPlayRef` (intent) separate from `isPlaying`; `onPause` returns early while intent is true;
every deliberate stop (`pause()`, `stop()`, visibility pause, `ended`) **lowers the ref first** —
lowering it after `element.pause()` races the event. `isLoading` is driven by media events
(`playing` clears, `waiting` sets, `error` clears) — `playing`, not the `play()` promise, which
resolves before the first sample. `restart()` and the Restart button removed; `ended` rewinds
`currentTime` to 0 so Play doubles as replay with no second fetch.

## 2026-08-11 — Reduced motion `display: none`s a spinner, so it must never be the only thing in its box

`[data-motion='spinner'] { display: none }` removes the element from layout (unlike
`qr-placeholder`, which only drops its animation); jsdom evaluates no media query. So a spinner-only
button is an empty circle (`CardControls` keeps the icon underneath, spinner `absolute inset-0
pointer-events-none`), and a slot sized by its spinner collapses (the year spinner sits in a
`size-(--size-year-spinner)` box, 3rem). Test by `.remove()`ing the spinner and asserting what
survives. **No `role="status"` on a spinner inside `CardRevealSide`** — the reveal is already one live
region. `--color-fg-decorative` (WCAG exemption at 1.94:1 valid only for `aria-hidden` decoration)
and `--text-year-pending` were left unreferenced, kept with comments.

## 2026-08-11 — Playlist names are truncated in the string, not in CSS

`truncatePlaylistName()` caps a name at `MAX_PLAYLIST_NAME_CHARS` (20) with a real `…`, because the
string also becomes a PDF filename and a library entry, where CSS cannot reach; the HUD's `truncate`
stays. The cap applies to the **name**, never to the finished label (a `+2 more` must survive).
`trimEnd()` before `…`; `sanitizeForPdf` maps `…` to "..." and `pdfFileName` to a hyphen. (The
library now stores the base name — see AGENTS.md § Decks.)

## 2026-08-11 — The deck slid away by itself mid-game: the `AnimatePresence` key

The key was `` `${id}:${currentIndex}` ``; `YEAR_RESOLVED` removing a card **behind** the player shifts
`currentIndex` back, so the same card got a new key and played its exit (direction from the sticky
`exitDirection`). Fix: `cardPresenceKey()` → `` `${id}:${occurrence}` `` (count of same-id cards before
the current one), invariant because `YEAR_RESOLVED` drops **every** copy of an id; still separates
adjacent duplicates (a bare-id key reuses one element across an advance and leaks the flip state).
When the player's **own** card is dropped, a different card arrives and the exit plays — left alone
deliberately. Tests assert element **identity** across the rerender.

## 2026-08-11 — The card became square, and every number downstream of the 9/14 ratio moved

`--card-width: var(--card-height)`. Everything quietly measured in the ratio had to move:

- **Clamp terms** (they govern HEIGHT): floor `18rem → 15rem` (a 320px phone has 272px after `p-6`),
  ceiling `28rem → 24rem` (area within 15% of the old 288 × 448), `124vw → 80vw` (same rule restated).
- **`--qr-display-size`'s constraint changed axis** to height shared with the caption; with
  `overflow-hidden` on the face an over-large ratio **crops the QR silently**. (Now `3/4` with
  `QR_BITMAP_SIZE = 288` since the caption moved off the face — next entry.)
- `--ring-width` deliberately fixed at 2px (a derived ring goes sub-pixel and blurs); `62dvh`
  unchanged.
- **Control spacing**: row `w-(--card-width)` with **`justify-evenly`** (four equal gaps by
  construction; a `gap-*` only sets inner gaps). `--size-control-button: max(3.5rem, calc(var(--card-width) / 5))`
  makes every gap `card / 10`; `max()` not `clamp()` (an upper term at 76.8px is unreachable). Icon and
  spinner sizes derive from the button (spinner = `button - 1rem`).

Hazards: `--container-content` (24rem) equals the card's ceiling only at the ceiling — swapping one for
the other reintroduces the overhang on every phone. `index.css.test.ts` pins the width with **no
multiplier** and `button = card / 5`; `CardControls.test.tsx` pins the width, `justify-evenly` and the
**absence** of `gap-*`. Owed: one look at three widths, one QR scan on the floor card.

## 2026-08-11 — The year was the album's, not the song's: `primary-type: Album` was the bug

A release group's `first-release-date` is the **record's** date, so Album-only gave the year a single
was included on an album, and songs never on a studio album ("Hey Jude") had no eligible group. The
relaxed pass had no filter at all. **Built:** the three-rung ladder (`YEAR_TIER_ORDER`): ①
`official-release` = Album/Single/EP, Official, no excluded secondary → `high`; ② `studio-release` =
secondary exclusion + not Bootleg → `low`; ③ `unfiltered` → `low`. Free (same pool). **Widening ①
cannot overshoot** because earliest-wins runs after the filter (Billie Jean: Jan 1983 single, Nov 1982
album → 1982, asserted).

**Measured live 2026-08-11: 21 of 22 exact** (all 14 Phase 0 tracks unchanged):

| Track                                | Single  | Album   | Was               | Now      |
| ------------------------------------ | ------- | ------- | ----------------- | -------- |
| Creep / Radiohead                    | 1992-09 | 1993-02 | 1993              | **1992** |
| Relax / Frankie Goes to Hollywood    | 1983-10 | 1984-10 | 1984              | **1983** |
| Under Pressure / Queen & David Bowie | 1981-10 | 1982-05 | 1982              | **1981** |
| Firestarter / The Prodigy            | 1996-03 | 1997-06 | 1997              | **1996** |
| Mr. Brightside / The Killers         | 2003-09 | 2004-06 | 2004              | **2003** |
| Rolling in the Deep / Adele          | 2010-11 | 2011-01 | 2011              | **2010** |
| Hey Jude / The Beatles               | 1968-08 | (none)  | no eligible group | **1968** |

**"Personal Jesus" (Depeche Mode) is a structural limitation — do not filter your way to it.** Resolves
1990 (Violator) vs the 1989-08-29 single, which MusicBrainz has; resolution is **recording**-scoped and
the single carries a 3:46 edit (separate MBID) vs the 4:55 album recording — the `dur:` bound is not
what hides it. Needs **work-level** resolution. Pinned wrong in `YEAR_LIMITATION_FIXTURES`.

- `MAX_RELEASE_GROUPS = 50`: ids sorted **Album → EP → Single before the cap**, so truncation is
  non-regressive.
- All 22 fixtures had to be re-captured (old ones lacked Singles' `releaseGroupFirstReleaseDate`);
  the suite passed **before** re-capture — a fixture that cannot represent the new evidence cannot
  catch a regression in it.
- The recording's own `first-release-date` measures 10/13 and is wrong-early on "No Woman No Cry"
  (1973 vs 1974); not used to override ①.

Since changed: cache is now `v6`, and the "no second provider" call was reversed by the provider vote
(2026-09-30). Rules: AGENTS.md § Year resolution: MusicBrainz.

## 2026-08-11 — Five UI changes, and three things the repo did not know

1. **The caption was the QR's ceiling.** Moving "Scan to play" below the card left padding as the only
   limit (`r × 240 + 48 ≤ 240` → 0.8); chose **3/4** (288px ceiling / 180px floor) because
   `overflow-hidden` crops an over-large code. `QR_BITMAP_SIZE` 224 → 288 (encoding below display size
   blurs module edges). It also removed the sentence being in the DOM twice per card (the back mounts
   `CardHiddenSide` too).
2. **A copyright footer is a year-shaped number on a pre-reveal surface.** Leak proxies
   (`not.toMatch(/\b(19|20)\d{2}\b/)`) failed on "Copyright © 2026-present"; the fix is
   `.replace(COPYRIGHT_NOTICE, '')` by exact string, **never loosening the regex**.
3. **Testing Library maps `<footer>` to `contentinfo` regardless of ancestry** (HTML-AAM says only when
   its nearest sectioning ancestor is body). `queryByRole('contentinfo')).toBeNull()` inside a `<main>`
   fails against a correct component; `Footer.test.tsx` asserts no explicit `role` instead. Don't "fix"
   it by adding `role="contentinfo"`.
4. **An auto margin beats `justify-content`**: `mt-auto` in a `min-h-dvh flex flex-col justify-center`
   column packs the content to the top. The footer is out of flow in a band the host reserves, not
   `fixed`. (Placement was later extended to every screen but the crash screen — see 2026-08-12; rule
   in AGENTS.md § Screens.)

The "Playlist Jitster" rename boundary: see 2026-09-30 and AGENTS.md § The name (storage keys were
later renamed to `jitster:*` with no migration). `KeepDeckIcon` is a three-node share glyph (nodes
(6.5,12), (17,6), (17,18), r=2.5, links stopping 2.5 short of centres) using `ControlIcon`'s `filled`
variant, so **its two link paths need `fill="none"`** or it paints a solid wedge; pinned in
`CardControls.test.tsx`.

## 2026-08-11 — Where blank cards come from: coverage, not scoring (and one artist-matching bug)

Whole pipeline over two real 50-track playlists:

|                           | Today's Top Hits | Viva Latino |
| ------------------------- | ---------------- | ----------- |
| `high`                    | 46               | 33          |
| `low`                     | 1                | 2           |
| **`none` — card DROPPED** | **3**            | **14**      |

Of 18 failures: **10 MusicBrainz coverage gaps** (pool of zero, all 2025–26 regional Mexican / Latin
urban — no algorithm change can touch these), **5 artist matching**, 1 `no-dated-candidates`, 2
transient.

**The matching bug**: `artistMatches` required a contiguous whole-token run; Spotify joins with `", "`,
MusicBrainz with a joinphrase, and order differs — a mismatch discarded the whole pool.

| Spotify                             | MusicBrainz             | exact | join-word fix | token bag |
| ----------------------------------- | ----------------------- | ----- | ------------- | --------- |
| `Shakira, Burna Boy`                | `Shakira x Burna Boy`   | ✗     | ✗             | ✓         |
| `Dave, Tems`                        | `Dave feat. Tems`       | ✗     | ✓             | ✓         |
| `Dave, Tems`                        | `Tems & Dave`           | ✗     | ✗             | ✓         |
| `Xavi, De La Rose`                  | `De La Rose & Xavi`     | ✗     | ✗             | ✓         |
| `Natanael Cano, Gabito Ballesteros` | `Natanael Cano feat. …` | ✗     | ✓             | ✓         |

Not punctuation (`normalizeForCacheKey` already maps `&`, `+`, `,` to spaces); the join-word-only fix
recovers 2 of 4. **Built:** `admitByArtist()` — exact pool, or only when it is **empty** the loose pool
(same tokens any order, ≤1 word slack, ≥2 non-article tokens on the shorter side). `maxConfidence` is
a ceiling; `weakest(tier.maxConfidence, ARTIST_MATCH_CONFIDENCE[match])`. **A fallback, never a
widening**: a union lets earliest-wins pick a loose older candidate, and `preferByDuration` is not
monotone, so a union can move a year **both** ways; the fallback can only turn a null into a year.

**Test trap**: the accuracy fixtures reject 0 of 227 candidates by artist, so the suite passes with
the rule reverted; `artistMatchesExact` is exported for the one guard test (every fixture has a
non-empty exact pool). Verified live: the four dropped cards resolved (2026/2025/2026/2025, `low`).
Retrying the bounded query unbounded on scoring failure recovered zero. iTunes and Deezer had 17/18 of
the failing tracks — the seed of the 2026-09-30 provider vote. Rules: AGENTS.md § Year resolution:
MusicBrainz.

## 2026-08-12 — Landing redesign and the icon identity regenerated from a new master

- **`justify-content` only spends free space.** The landing `<main>` read `justify-center` for two
  phases and centred nothing, because the suggestions always push the column past the viewport. A
  hero with `min-h-[88dvh]` was tried the same day and removed (next entry).
- **`<h1><img alt="" /></h1>` renders identically to the correct thing** and leaves the page's one
  top-level heading with no accessible name — assert the name, not the element.
- **No check in this repo opens an image.** The rename to Jitster (2026-08-11) assumed the icons
  carried no wordmark; they read "PLAYLIST HITSTER" until the developer's new artwork landed.
- **The master stays out of `public/`** (everything there is copied to `dist/` and precached — a
  1.2 MB master is the same file that cost 6.2 s of LCP in Phase 7). It now lives in
  `visual-assets/logo-master/`. Derivatives are `LANCZOS` downscales, each PNG written RGB-optimised
  and 256-colour and the smaller kept; totals in `architecture.md` §3.
- **The maskable scale is measured per artwork, never inherited.** The old 84% fitted the old art;
  on this one the neon bloom reaches 109.4% of the half-edge, so the square scales to **73.1%** to
  keep every lit pixel inside the 80% safe circle.
- **Two defects review agents caught that the four checks could not:**
  1. The maskable icon clamped the canvas to the page colour but pasted an **unclamped** resize: a
     hard 374 × 374 `#010101` square inside a `#0a0a0a` frame, its seam 187 px from centre — inside
     the 204.8 px safe circle, so visible on a round launcher on an OLED phone in the dark. Fixed by
     pasting the clamped resize (file 80,511 → 40,070 bytes — a flat backdrop quantises to one
     palette entry; that size drop is the tell).
  2. **Tailwind's mask stops are a fraction of the FULL axis.** `mask-x-from-90%` fades the outer 20%
     of the half-edge, not 10%; on the 384 px logo the frame took alpha 0.44 (corner ~0.3),
     asymmetrically because the art is off-centre in its canvas. Removed.
- **Moving the name from text into `alt` narrowed a leak proxy silently.** Landing leak tests now
  audit text **plus** `alt`, `aria-label`, `title`, `placeholder`, `value` (later also `download`,
  `href` — see 2026-09-19); a saved playlist's name reaches an `aria-label` too.

## 2026-08-12 — Android's back button became an in-app control; four jsdom history facts

Rule: AGENTS.md / decisions.md § Google Play. What jsdom actually does:

- **jsdom fires `popstate`, but not within one macrotask.** After `history.back()` a `setTimeout(0)`
  sees nothing (reads like "not implemented"); the event lands at ~11 ms. Every post-traversal
  assertion waits on a real timer (50 ms) inside `act`.
- **`history.length` cannot see a stray entry** — going back never shortens it, in jsdom or a
  browser. Tests assert a **position** instead (a sentinel stamped into the base entry's state).
- **"Remove the listener before navigating" is not observable**: the traversal is queued, so the
  obvious test passes with the lines in either order (verified by swapping). It is pinned as a
  **call order** through spies.
- **jsdom discards a queued traversal that a `pushState` beats.** StrictMode's push A → cleanup
  `back()` → push B ends at B with no `popstate` in jsdom; Chrome re-resolves the delta, lands on A
  and fires a phantom back press at the second effect's listener. `pendingCleanupTraversals` guards
  that, and **the suite stays green with it removed** — do not delete it for being untested.
- `pushState(state, '')` with no URL keeps href, search and hash (a shared link's
  `?playlist=…&seed=…` survives a mid-game reload).
- `EventTarget.prototype.removeEventListener.call(window, …)` **throws** in jsdom (branded IDL check):
  capture the bound original before `vi.spyOn` replaces it.
- The entry is **re-pushed after every press**; otherwise interception works once per game and the
  second back closes the activity.

## 2026-08-12 — The footer on every screen, a symmetric band, and the hero minimum removed

- **A viewport-sized minimum sets a remainder, not a distance.** The hero's `min-h-[88dvh]` (one day)
  made the Start→suggestions gap `88dvh − content`: nothing on a phone, hundreds of px on desktop.
  `LandingScreen.test.tsx` pins the absence of any `min-h-[…dvh]` by pattern, and the old centring
  test became an **order** test (`compareDocumentPosition`).
- **Footer geometry is one number split in two**: `bottom-8` inside `pb-20` (80 px band, 32 px
  offset, ~16 px line → 32 px above and below). The old `bottom-4` in `pb-12`/`pb-20` was never
  centred and jsdom could not tell. Rule: AGENTS.md / decisions.md § Screens.
- **The game screen's footer costs 56 px of the card's height budget** (`pb-20` vs the old `p-6`);
  accepted, and the lever if it overflows a short phone is `--card-height`'s `62dvh`. Rendered
  before the dialogs (tab order); the crash screen stays excluded (`role="alert"` announces its whole
  subtree).
- **Build log:** `Footer` imported by both the eager and lazy paths moved into the existing shared
  chunk, which got renamed from `DeckActions` to `Footer` (+0.10 kB gzip, no new request) — a rename,
  not a regression.

## 2026-08-12 — The suggested-playlist set is deliberately undocumented; a duplicate id is invisible

- `SUGGESTED_PLAYLISTS` in `src/components/LandingScreen.tsx` is the **only** enumeration of the set;
  docs neither name nor count rows, because a stale note about a verified id reads as evidence
  (editorial playlists refresh, owners re-point or hide personal ones). Tests sample
  `SUGGESTED_PLAYLISTS[0]` and assert a floor, never an exact length.
- **A duplicate id is invisible on screen** (both buttons render, submit and deal the same deck) and
  arrived on the first edit. Pinned by `should suggest each playlist only once` (id **and** label —
  two identical labels also make `getByRole` throw).
- **Verification procedure:** a throwaway Node script over `https://open.spotify.com/embed/playlist/{id}`
  with a browser `User-Agent`, reading `__NEXT_DATA__` → `props.pageProps.state.data.entity`. Per id
  check `uri === spotify:playlist:{id}`, `name`, `subtitle` (the owner), `trackList.length` and
  entries lacking `audioPreview.url`. Verify by `uri` and `name`, never by a 200; any row can hit
  `MAX_EMBED_TRACKS`.
- Labels are readable renderings of titles (titles carry emoji, punctuation, typos). Most rows are
  user-owned: an owner going private means `not-found-or-private` on a row the app suggested, so
  re-verification is a recurring chore.

## 2026-08-12 — Copy centralised into `src/game/copy.ts`; six pure-wording assertions deleted

Rule: AGENTS.md / decisions.md § Copy and languages. ~200 wording assertions across 18 test files were
converted; the suite passed identically. Patterns for non-mechanical conversions:

1. **A count read back from a rendered line**: `cardsLeftInHud()` asks `COPY.hud.cardsLeft(n)` which
   `n` produces the line — counting **down** from 500, since "2 cards left" is a substring of "12
   cards left".
2. **"Is the export running?"** asks the button's identity: still wearing `COPY.deckActions.print`
   means no export started. Where two labels are acceptable, `name` takes a predicate over both.
3. **"The banner names no failed playlist"** is an equality over the `<li>` list against the
   constants (which take only numbers).

**Deleted, not converted** (wording no constant can express):

- `DeckActions.test.tsx` — two `not.toMatch(/same deck/i)` on the share caption (rule now a comment on
  `COPY.deckActions.shareCaption`).
- `EndScreen.test.tsx` — `{ name: /new playlist/i }` absent (`{ name: COPY.end.home }` remains).
- `CardControls.test.tsx` — `{ name: 'Restart' }` absent (the exhaustive name list covers it).
- `LandingScreen.test.tsx` — `not.toContain('our side')` → the `empty-playlist` and
  `unexpected-payload` messages are asserted to be different strings.
- `messages.test.ts` — seven substring checks → `new Set(messages).size === ALL_CODES.length` ("every
  code has a sentence of its own"; two-codes-one-sentence shipped once).

## 2026-08-12 — `getByText` reads only DIRECT text-node children

Splitting the author name into its own element broke `getByText(COPYRIGHT_NOTICE)`: Testing
Library's `getNodeText()` concatenates only direct child text nodes. Assert on `textContent` instead.
The leak proofs survived because they read `container.textContent` and the footer's parts join with
**no separator** — a stray space would make the `COPYRIGHT_NOTICE` subtraction miss and fail three
screens as a false leak. `Footer.test.tsx`'s first test pins that.

## 2026-08-12 — The accent as text: 5.13:1

`--color-accent` (`oklch(59.6% 0.145 163.225)`) as text on `--color-page` (`#0a0a0a`): luminance
0.2223 vs 0.00304 → **5.13:1**, past the 4.5:1 floor for the 12 px footer. This is the usage that fails
first if the accent darkens; jsdom computes no colour, so only the class name is asserted. Full table:
the 2026-08-06 contrast entry.

## 2026-08-12 — The footer author link: the app's first `<a>`

`<a className="font-bold text-accent focus-visible:focus-ring" href={copy.footer.authorUrl}
target="_blank" rel="noreferrer noopener">`. There was no prior anchor in `src/`, so focus ring and
`rel` hygiene had to be applied by hand. Both dialogs trap Tab, so it is unreachable behind a modal.
**The URL is in `copy.ts` but not in `notice`**: the notice is subtracted by exact string in the leak
proxies, and an `href` is not part of the sentence. `font-bold` is the link affordance (colour alone is
not). **`@testing-library/jest-dom` is not set up here** — `toHaveAttribute` fails with
`Invalid Chai property`; use `getAttribute()`.

## 2026-08-12 — Suggestion multi-select: first pointer event and first fake clock in `src/`

Rule: AGENTS.md / decisions.md § Decks.

1. **jsdom has no `PointerEvent`, and `fireEvent.pointerDown` works anyway**: Testing Library falls
   back to `Event` and copies init properties (`clientX`/`clientY`) onto it. `useLongPress` must read
   nothing else (`pointerId`, `pressure`, `getCoalescedEvents()` would not survive the fallback).
2. **`vi.useFakeTimers()` works in `src/`** with `act(() => vi.advanceTimersByTime(...))`. Restore real
   timers in a `finally`, never only `afterEach` — jsdom files share a worker and a leaked fake clock
   breaks the next file.
3. **The click after a hold** would deal a single-playlist deck: `consumeLongPress()` must be first in
   `onClick`, and the flag is cleared by the next `pointerdown`, not by the click (a hold released off
   the button produces no click).
4. **Tailwind v4 scans files, not the module graph**: stashing the importing component left the CSS
   byte-identical while the unimported component sat on disk. Isolate CSS deltas by removing the file.
   JS delta: `index-*.js` 213.00 → 215.05 kB raw, 66.63 → 67.40 kB gzip.
5. `--color-accent` as a selected border: **5.26:1** on `--color-page`, **4.76:1** on `--color-surface`
   (3:1 non-text floor). The tick is required — a border colour alone fails WCAG 1.4.1;
   `aria-pressed` covers assistive tech.
6. `LONG_PRESS_DURATION_MS` sits beside `TAP_MAX_DURATION_MS` in `gestures.ts` because nothing compares
   them at runtime and nothing would render differently if they crossed.

## 2026-09-18 — Welcome screen, a static PDF behind a service worker, the first step backwards

Rules: AGENTS.md / decisions.md § Screens and § Gestures. Still-useful facts (the PDF denylist regex and
the year-range leak-proxy fix were revised on 2026-09-19, below):

- **`generateSW` defaults `navigateFallback` to `index.html`** for any uncached navigation, so a
  non-precached PDF needs a `navigateFallbackDenylist` entry or a click reloads the app. The `download`
  attribute is not the fix (whether `<a download>` is a `navigate` request varies by browser).
  Unobservable under any dev server; check the built `dist/sw.js`.
- **`vercel.json`'s `/((?!api/|@)[^.]*)` rewrite excludes any path with a dot**, so static files with
  an extension need no configuration.
- **`card-ring` declares no `position`**: the in-flow welcome card must carry `relative`, or the
  gradient anchors to `<main>` and rings the whole screen.
- **`PREVIOUS` resets the flip as a leak rule**: `YEAR_RESOLVED` can slide the deck, so the previous
  card may be one the player never revealed. On card 1 it returns the same state object.
- **Direction is a decision in `gestures.ts`** (`swipeIntent`), node-tested, because jsdom cannot
  drag and a reversed inline mapping would go unnoticed.

## 2026-09-18 — The picker's Back button and the `hasEnteredPicker` flag

Rule and seed: AGENTS.md / decisions.md § Screens. Two facts from the build:

- The `ended` branches that show the picker must honour the flag, or Back after an Exit is a dead
  button. Keeping a `deckLink === null` guard in the `idle` branch was wrong in two reachable states
  (a failed link fetch showed an enabled Back that did nothing; a link-dealt deck collapsing to zero
  skipped the `no-years-found` warning) — hence "no branch checks `deckLink`".
- **Welcome → Back → welcome button remounts `LandingScreen` and loses typed rows.** Accepted; keeping
  them would mean lifting the rows into `App.tsx` (development.md §5 welcome row 8).

## 2026-09-18 — Under Vite 8.2 `GET /api/playlist` returns `index.html`

Under `pnpm dev`, Vite 8.2.0 answers `/api/playlist?url=…` with the SPA fallback (`index.html`,
`text/html`, 200), not the handler's transpiled source as older docs said (`vercel.json`'s rewrite is
read by Vercel only). The client outcome is the same — non-JSON 200 → `unexpected-payload` — and the
prescription is unchanged: `npx vercel dev`. Two traps there: it refuses to start with "The specified
token is not valid" until `vercel login`, and "Worker timed out after 10 seconds / write EPIPE" is the
CLI's update check, not the failure.

## 2026-09-19 — Review findings on the welcome-screen and left-swipe work

1. **The committed PDF blob was corrupt and the working tree was not.** Git's binary heuristic is a NUL
   in the first 8000 bytes; the PDFsharp file is ASCII there, so `core.autocrlf=true` stripped 23 CRs
   inside an uncompressed XMP stream (blob 239331 bytes vs working tree 239354; `startxref` missed by
   23). Readers rebuild the xref, so the download still opened — but the reverse conversion on a
   Windows checkout would have corrupted FlateDecode streams irrecoverably. Fix: `.gitattributes` with
   exactly `*.pdf binary` (no `* text=auto`, which would renormalise unrelated files here), then
   `git rm --cached` + `git add` (a bare `git add` skips a stat-clean file). `i/mixed` afterwards is
   expected. **Any NUL-free binary format needs the same line.**
2. **Workbox's denylist runs over `url.pathname + url.search`** (`workbox-routing@7.4.1`
   `NavigationRoute._match`, never the hash), so `/\.pdf$/` missed `…pdf?v=2`. Now `/\.pdf(\?|$)/`; the
   literal is closed over inside the `VitePWA` call, so the check is a regex table plus `dist/sw.js`.
3. **A resumed session that collapsed to zero reached the welcome screen with no warning** — the seed
   read `deckLink` only. Now `useState(deckLink !== null || state.status !== 'idle')`, which works only
   because `RESUME` runs in `useReducer`'s lazy initializer; the pre-reversal test asserts on the first
   render so it fails if `RESUME` moves into an effect.
4. **Exit direction must travel through `AnimatePresence custom`** (now `deckMovementFor`, latched in
   `CardStack`). Motion 12.43.0 facts from source: an exiting child animates with its **last** render's
   props; `animation-state.mjs` reads the exit's custom from `presenceContext.custom` of the removing
   render; a running exit is never re-resolved. Motion's `exit` prop type allows no function, so use
   `variants` + `exit="exit"`. `react-hooks` 7's `refs` rule forbids `ref.current` in render, so the
   latch is a `useState` adjust-in-render, keyed on the presence key, not the index.
5. **A leak proxy that subtracts a string it never reads passes by omission.** The year range moved to
   the download link's `download`/`href`, which `auditableText` did not read. Now shared
   (`src/components/__fixtures__/auditable-text.ts`) with `download` and `href` in its list, and
   `WelcomeScreen.test.tsx` asserts `toContain` on both strings before subtracting them. Adding `href`
   means subtracting `COPY.footer.authorUrl` on every audited screen.
6. **A 20 s per-test timeout was hiding cost**: the per-suggestion test rendered 13 landing screens; it
   now checks `parsePlaylistUrl(spotifyPlaylistUrl(id))` for every entry with no render. "Render once,
   click each" does not work — after the first press `isSelecting` flips and the next press toggles.

## 2026-09-19 — Reviewing the two Google Play plans against the repo

Decisions taken in that review (current rules in AGENTS.md / decisions.md § Google Play):

- **Origin `https://playlistjitster.vercel.app`**; the old `custom-hitster.vercel.app` `307`s to it, so
  the TWA must bind to the new host (a redirecting bound origin is a URL bar).
- **Application id `aleixrabassa.playlistjitster`.** `playlist-jitster` is invalid (no hyphens, needs
  two dot-separated segments); Bubblewrap's default reverses the host into `app.vercel.…`, a namespace
  the developer does not own.
- **A Chrome TWA shares `localStorage` with Chrome on the same origin** — a game started in the app
  resumes in the browser and vice versa. A property, not a defect; testers will otherwise report a
  ghost game.
- The picker's on-screen Back returns to the welcome screen while Android's back closes the app there;
  deliberately not unified (it would be a second `pushState`).
- `vite-plugin-pwa`'s `ManifestOptions` already types `id`, `lang`, `dir` and `categories`.

## 2026-09-19 — Vite copies `public/.well-known/` into `dist/`; asset links stay out of the precache

- `public/.well-known/assetlinks.json` lands byte for byte at `dist/.well-known/assetlinks.json` under
  Vite 8.2 — dot-directories are copied, no workaround needed.
- It is **absent from the precache** because `globPatterns` (`js,css,html,webp,png,svg,woff2`) has no
  `json`; `manifest.webmanifest` is added by the plugin. Correct: asset-link verification is done by
  Android, never by the webview. **`public/privacy.html` IS precached** (matches `html`) — harmless.
- `src/pwa/assetlinks.test.ts` asserts `vercel.json`'s rewrite `source` keeps the `[^.]*` dot exclusion
  as a string, deliberately not by re-implementing path-to-regexp.

## 2026-09-19 — The Android toolchain installs, but neither half works the way Bubblewrap documents

- **Bubblewrap cannot run from an agent's shell until `~/.bubblewrap/config.json` exists**: first run
  prompts to install a JDK, so even `bubblewrap --version` dies with
  `ERR_USE_AFTER_CLOSE: readline was closed` on a null stdin. Write the file by hand. **`init` and
  `build` stay interactive** (id, colours, keystore passwords) — the developer's to run, passwords
  never in shell history.
- **The config needs forward slashes**: a Windows path fails with
  `Bad escaped character in JSON at position 15` (the `\U` of `C:\Users`).
- **cmdline-tools 23.0 (`commandlinetools-win-16111833`) retired `sdkmanager`**: the shim splits on the
  semicolon (`Package build-tools not found. Package 36.1.0 not found.`) and `--licenses` is a no-op.
  Use `android.exe sdk --sdk=C:/Android/sdk install "build-tools;36.1.0" "platform-tools" "platforms;android-36"`
  (licences accepted as part of it).
- **Bubblewrap rejects a modern SDK**: `AndroidSdkTools.validatePath` wants `tools/` or `bin/` at the SDK
  root, and `bubblewrap doctor` says `The androidSdkPath isn't correct ... contains the folder "build"`.
  Fix with two junctions:

  ```
  New-Item -ItemType Junction -Path "C:\Android\sdk\bin" -Target "C:\Android\sdk\cmdline-tools\latest\bin"
  New-Item -ItemType Junction -Path "C:\Android\sdk\lib" -Target "C:\Android\sdk\cmdline-tools\latest\lib"
  ```

- **Build-tools must be exactly the version Bubblewrap hard-codes** (1.25.0: `BUILD_TOOLS_VERSION =
'36.1.0'`, called by literal path). Read it from
  `@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/androidSdk/AndroidSdkTools.js` when the CLI
  version changes.
- Installed: `@bubblewrap/cli` 1.25.0 (global), Microsoft OpenJDK 17.0.10, build-tools 36.1.0,
  platform-tools 37.0.1, platforms;android-36, cmdline-tools 23.0. `platform-tools` is needed for
  `adb shell pm get-app-links aleixrabassa.playlistjitster` (the verifier's own verdict).

## 2026-09-19 — `bubblewrap update` regenerates the whole Gradle project, so `android/` needs no tracking — with one trap

Read from the CLI 1.25.0 source: `update` → `updateProject()` (`cmds/shared.js`) runs
`removeTwaProject()` — deleting `settings.gradle`, `gradle.properties`, `build.gradle`, `gradlew`,
`gradlew.bat`, `store_icon.png`, `gradle/`, `app/` — then `generateTwaProject()` from the CLI's
templates, `twa-manifest.json` and icons **re-fetched over the network** from `iconUrl`. So
`android/twa-manifest.json` alone is the release record.

**The trap:** `app/build.gradle` is in `TEMPLATE_FILE_LIST`, so a hand-edited `targetSdkVersion` is
silently discarded on the next `update`, and the symptom is a Play upload rejected months later.
Express SDK bumps in `twa-manifest.json`. Also: `update` needs the origin reachable (icon re-fetch),
and it writes a checksum file beside the manifest, which is how `build` notices a manifest edited
without a following `update`.

## 2026-09-19 — `pnpm format:check` fails on ~31 files: a line-ending artifact

`core.autocrlf=true` checks files out CRLF while `.prettierrc` says `"endOfLine": "lf"`, so Prettier
flags untouched, correctly formatted files. Proof:

```
git show HEAD:src/App.tsx | pnpm exec prettier --check --stdin-filepath src/App.tsx   # clean
```

Files written by a tool rather than checked out are LF and pass, which is why the set looks arbitrary.
`format:check` is not one of the four gate checks. Check only the files you touched
(`pnpm exec prettier --check <paths>`); **never run `pnpm format` repo-wide** (a pure line-ending diff
over untouched files).

## 2026-09-19 — Asset links measured live: an EMPTY fingerprint list reads as MALFORMED

`https://playlistjitster.vercel.app/.well-known/assetlinks.json` answers 200,
`application/json; charset=utf-8`, the file byte for byte (not `index.html`) — so the `[^.]*` rewrite
exclusion holds in production. `/privacy.html` answers 200 `text/html`. Google's checker:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://playlistjitster.vercel.app&relation=delegate_permission/common.handle_all_urls
```

returned, for the placeholder `sha256_cert_fingerprints: []`:

```json
{
  "maxAge": "599.999999859s",
  "debugString": "* Error: invalid_argument: Could not parse statement list (must contain at least one certificate): []\n [0] while fetching Web statements from https://playlistjitster.vercel.app./.well-known/assetlinks.json ...",
  "errorCode": ["ERROR_CODE_MALFORMED_CONTENT"]
}
```

An empty list is **malformed content**, not "reachable but delegating to nobody" — there is no
in-between state. Caveats: the checker caches for **~600 s** (wait that long after a redeploy before
concluding anything), and the trailing-dot host in `debugString` is normal DNS-root form.

## 2026-09-19 — The first suggested playlist is really called "Hitser"

The embed payload (fetched with `api/_lib/spotify-embed.ts`'s `BROWSER_USER_AGENT`) for
`spotify:playlist:34cIJlWIX9TEoA8bpI2UBu`: `entity.name` **`Hitser`**, `subtitle` `arich97`, `authors`
`null`, 100 tracks. The app's tidied label "Hitster" introduced the registered mark itself; the row is
now "Jitster official", applied on read through `src/game/playlist-display-name.ts`, id unchanged.
**A playlist's owner is in `entity.subtitle`**, never in `authors`; `og:description` on the
`open.spotify.com` page is not a reliable fallback. Guarded by
`should keep the registered mark out of every suggestion label and blurb` (case-insensitive, every
row), since the realistic regression is a new row named after its Spotify title.

## 2026-09-19 — The `App.test.tsx` flakiness was the FILE, and it failed in isolation too

Seven different `App.test.tsx` tests failed across eight full runs (five a bare
`Test timed out in 5000ms`, two a read taken mid-transition; never a wrong value), and the file
failed alone 1 in 3 runs and at a stashed `HEAD` (`git stash push -u`) 1 in 4 — so the races were in
the tests, with parallel load as an amplifier. A loaded machine also produces
`[vitest-pool-runner]: Timeout waiting for worker to respond` errors with files never collected,
naming no test. **The stash run is the check that separates a flake from a regression.** The cause
and fix are the next entry; the lost-keypress remainder is 2026-09-29.

## 2026-09-19 — `App.test.tsx` is fixed: integration budgets, one assertion that raced a passive effect, and a refuted theory

Commit `e3cc801`; its message claims a cross-test race that a probe disproved, so read this entry
instead. (A later, separate cause — a lost keypress — is the 2026-09-29 entry.)

- **The timeouts were unit budgets on an integration file.** Idle, the first test to reach `playing`
  took **907–1124 ms** and a synchronous welcome-screen render **714–874 ms**, against Testing
  Library's **1 s** `asyncUtilTimeout` and Vitest's **5 s** test timeout. A fully parallel run (15
  jsdom forks, 16 cores, `environment 1079s` across 52 files) stretched them past both.
- **Fix 1:** `configure({ asyncUtilTimeout: 5_000 })` and `vi.setConfig({ testTimeout: 30_000 })` at
  the top of the file — per file, nothing leaks into unit suites. **Proven to apply**: a throwaway `it`
  sleeping 7 s and a `waitFor` first true at 2.5 s both passed, which neither could under defaults.
- **Fix 2:** the back-press test read `window.history.state` once right after `waitFor` saw the HUD,
  but the entry is pushed by `useBackNavigation`'s **passive** mount effect, flushed separately from the
  commit. Now `await waitFor(() => expect(window.history.state).not.toEqual(base))`.
- **Refuted — do not re-propose:** "the unmount's `history.back()` lands in the next test as a real
  back press". jsdom (30) discards a queued traversal that a `pushState` beats
  (`History-impl.js` `_sharedPushAndReplaceState` → `clearHistoryTraversalTasks()`, push branch line 97),
  and the next game screen pushes. Probed: no dialog, ArrowRight reached the end screen. The
  **replace** branch (line 107) does NOT clear the queue, so a test's `replaceState(base)` can still see
  the previous test's traversal.
- **`afterEach` awaits `flushHistoryTraversal()`** (two `setTimeout(0)` hops inside `act`, after
  `cleanup()`) — hygiene, not a timeout fix; deterministic because Node fires equal-delay timers in
  insertion order. The hook removes its `popstate` listener before `history.back()`, so the swallow
  counter stays at 1: **`resetBackNavigationTraversals()` in `beforeEach` is still load-bearing.** Fixed
  50 ms sleeps were replaced by the drain plus the poll, not by longer sleeps.
- The double `ArrowRight` in `should save the whole set of playlists…` is not a race (`fireEvent` is
  `act`-wrapped; the reducer reads state).

Acceptance: the file 10/10 isolated, full suite 3/3 (867 tests, 58–64 s) after eight red runs.

## 2026-09-20 — `bubblewrap init`: notifications on by default, the checksum file, a relative keystore path

`android/` exists from this step; only `android/twa-manifest.json` is tracked (`.gitignore` explains
each line).

- **`enableNotifications` defaults to `true` and Bubblewrap 1.25.0 never prompts for it.** It adds
  `POST_NOTIFICATIONS`, a `DelegationService` and notification drawables, for an app that sends none
  and whose `public/privacy.html` declares none. Set to `false`; guarded by
  `should decline notification delegation` in `src/pwa/twa-manifest.test.ts`. **Re-check after every
  `init`/`update`.** The shortcuts and Custom Tabs fallback prompts never appear either (correctly
  defaulted).
- **`bubblewrap update --skipVersionUpgrade`** is the non-interactive form (no version-name prompt;
  version code untouched) — use it for configuration-only regenerations.
- **`android/manifest-checksum.txt` is a SHA-1 of `twa-manifest.json`**, read by `bubblewrap build`:
  absent → "would you like to regenerate your project?", stale → prompt to update. It is **ignored on
  purpose**: on a fresh clone (only `twa-manifest.json`) a tracked matching checksum would skip the
  regeneration and then fail on a missing `gradlew`. **Answer yes to that prompt** — it rebuilds what
  the clone lacks.
- **`signingKey.path` was written as an absolute Windows path** in a tracked file; changed to
  `./android.keystore`. The CLI passes it verbatim to `jarsigner`/`apksigner`, so **always build from
  inside `android/`** (`cd android && bubblewrap build`), never `--directory android` from the root.
- Open cosmetic question for the developer: `navigationColor`, `navigationDividerColor` and the three
  `*Dark` fields default to `#000000` against a `#0a0a0a` page.

## 2026-09-21 — Play's target API: 36 for new apps, exactly what Bubblewrap emitted

From **31 August 2026** new apps and updates must target **API 36** (existing apps 35 to stay visible
to new users; Wear OS/Automotive 35, TV/XR 34; extension to 1 November 2026 on request). Bubblewrap
1.25.0 emits `targetSdkVersion 36` / `compileSdkVersion 36`, so no bump. Read from
`developer.android.com/google/play/requirements/target-sdk` because the Console's policy pages are per
app and the app did not exist yet, and `support.google.com/...answer/11926878` answered a fetch with a
`302` to a captcha. **If the Console disagrees, the Console wins.** A bump goes in
`android/twa-manifest.json`, never `app/build.gradle` (see `docs/development.md` §9).

## 2026-09-21 — First sideload, asset links deployed, URL bar gone (upload key only)

- **`adb` never worked on this machine**: `adb devices` empty and `Get-PnpDevice` showed no Android
  device at all — a charge-only cable. The APK was sideloaded through the file manager. `adb` is first
  needed at step 12 (`pm get-app-links`).
- **"El paquete no es válido" was the transfer, not the build.** `apksigner verify --verbose
--print-certs` showed v1/v2/v3 valid, one signer `CN=Aleix Rabassa`, RSA 2048; re-sending installed
  it. Verify the artefact at source before debugging the device.
- **Take the fingerprint from `apksigner verify --print-certs` on the APK**, not `keytool` on the
  keystore. Upload key SHA-256:
  `BA:A4:32:03:3C:D9:B4:AC:07:FE:7D:03:88:23:E5:69:42:1B:BC:80:99:2D:F9:1D:FA:9A:D2:92:96:D2:21:75`.
- `bubblewrap fingerprint add <sha256> --name=upload` writes `twa-manifest.json`'s `fingerprints` and
  **implicitly runs `generateAssetLinks`**, producing `android/assetlinks.json` (git-ignored: output).
  Its content is copied to `public/.well-known/assetlinks.json`. Play's app-signing key is still to be
  **added beside** it at step 11.
- **Vercel's edge served the OLD statement on the bare URL for ~41 min** (`X-Vercel-Cache: HIT`,
  `Age: 2454`, 223 bytes) while `?cb=<epoch>` got the new one (`MISS`, 336 bytes). The verifier asks
  for the bare URL: **fetch both ways** when checking a redeploy.
- **Google's checker caches a VALID statement for 3600 s** (`maxAge: 3599.998301537s`); the 600 s
  measured 2026-09-19 belonged to the `ERROR_CODE_MALFORMED_CONTENT` answer for an empty list.
- **A clean reinstall of the same APK** after the deploy launched with no address bar (build, key and
  package id held constant — only the statement changed). Chrome caches TWA verification **per
  install**: a relaunch is not a test. This says nothing about the Play-signed build, which presents a
  different certificate; §5 TWA rows 1 and 6 are half passed until step 12.
- **The fingerprint-count test is deliberately unwritten**: asserting one would go red on step 11's
  correct change. Write it when Play's key lands, asserting two (`src/pwa/assetlinks.test.ts` checks
  only non-empty today).

## 2026-09-21 — Step 7's device pass on the sideloaded build

TWA rows 1, 2, 3, 4, 6 and back-press rows 1–6 passed (upload-key build; rows 1 and 6 re-run on the
Play-signed build at step 12). The app plays end to end inside the TWA: the API path, audio from a tap
and the cold-launch welcome screen all work there.

- **Row 2 counts only on a later launch**: on a first launch the service worker answers nothing, so the
  `.pdf` SPA-fallback denylist is not exercised.
- **Row 3** (a shared link opens the app with its query string) ran early because the upload key's
  statement delivered App Link verification. The failure mode is a bare `/` and a plain welcome screen.
- **Row 5 — accepted deviation.** Lock → silence, as designed. Unlock + Play **restarts the preview
  from 0:00** although `useCardAudio` calls `pause()`, which keeps `currentTime`. Presumed (unverified)
  cause: Chrome releases the media resource of a backgrounded TWA activity. The developer accepted it;
  recorded in §5 and the hook's comment — **do not fix without asking** (a seek-back would be new
  behaviour).

## 2026-09-21 — Back-press row 7 (predictive back) FAILED and was accepted as cosmetic

On the Android 15+ device, pressing back mid-game shows **the app shrinking and minimising** before
the exit confirmation appears. An earlier same-day note had called the risk retired, reasoning that
the generated `AndroidManifest.xml` sets no `android:enableOnBackInvokedCallback` and that attribute
is an opt-**out** (predictive back is on by default; Android 15+ shows it automatically, 13–14 need
Developer options → Predictive back animations). Every premise was true; the conclusion was wrong —
being on the predictive path is what makes the system animate.

- **The obvious remedy is probably inert**: `enableOnBackInvokedCallback="false"` on `<application>`
  governs the shell's own activities (`LauncherActivity`, `FocusActivity`, `WebViewFallbackActivity`,
  the delegation service), while the web content is rendered by an activity **declared in Chrome's
  manifest**. Reasoned, not measured (`adb shell dumpsys activity activities` was never available).
- **Bubblewrap 1.25.0 has no lever** (`enableOnBackInvokedCallback` appears nowhere in the CLI or
  `@bubblewrap/core`'s template), so any edit would be a hand-edit to a regenerated file.
- Options were: (1) accept as cosmetic, (2) try the opt-out with a post-`update` checklist and a test
  grepping the generated manifest, (3) a real `OnBackInvokedCallback` in Java in the shell.
  **Decided: option 1.** Written into `visual-assets/tester-notes.md` under "expected"; **row 7 does not
  re-run at step 12** (Play's signature changes the certificate, not the animation). The AAB built
  2026-09-21 was declared final for upload.

## 2026-09-21 — The app is paid (€1.00): paid → free is allowed, free → paid is not

`support.google.com/googleplay/android-developer/answer/6334373`: "Once your app has been offered for
free, the app can't be changed to paid. If you want to charge for the app, you need to create a new app
with a new package name and set a price." Free would have been the irreversible choice, costing the
permanent package id, `manifest.id`, `start_url` and the asset-links statement. Charging needs a
**payments profile** (merchant account with its own verification), added as step 9a; it gates the
pricing page, not app creation. The developer reaffirmed the price after the concern that the same
game is free at `https://playlistjitster.vercel.app`. Testers: see 2026-09-23.

## 2026-09-21 — How to read the year-cards template's geometry, and what it actually is

`public/year-cards-1970-2033.pdf` is a developer-supplied binary with no generator in the repo. Decode:

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

`zlib.decompress` alone fails with `incorrect header check` — **the ASCII85 layer comes off first**
(`/Filter [ /ASCII85Decode /FlateDecode ]`).

- `%PDF-1.3`, produced by ReportLab and re-saved by PDFsharp 6.2.4. MediaBox `0 0 595.2756 841.8898`
  (A4). **Ten pages**: objects `4..11` are year cards, `13, 14` repeat a decorative back XObject
  (`/FormXob.ded6de700d43b284586ed35b52eb9b90`). 8 × 16 = 128 = 64 years × 2 copies, 1970–2033.
- **Grid, identical on every page.** First slot `n 20 559.7638 138.8189 138.8189 re S`. Column x
  origins `20, 158.8189, 297.6378, 436.4567`; row y origins (bottom-up) `559.7638, 420.9449, 282.126,
143.3071`. **4 × 4 slots, 138.8189 pt = 48.9722 mm square**, side margins 20 pt = 7.0556 mm,
  top/bottom 143.3071 pt = 50.5556 mm — centred on both axes, so `pdf-sheet.ts` keeps deriving its
  margins and the duplex identity `xFront + xBack === PAGE_WIDTH_MM - CARD_SIZE_MM`. Year is
  `/F2 28 Tf` (Helvetica-Bold), centred (baseline 619.1732 ≈ card centre − 10 pt).
- **Do not copy its page order**: it is eight fronts then two backs; the deck export interleaves front
  sheet _n_ with back sheet _n_ because each card has a QR face and an answer face. Copying the order
  pairs every card with the wrong answer.

## 2026-09-21 — Motion's `custom` reaches EXIT only, and four more facts behind the reverse-step animation

Traced in `motion@12.43.0` / `framer-motion@12.43.0`; none is obvious from the docs.

1. **`<AnimatePresence custom>` feeds only the exit variant.** motion-dom's
   `render/utils/animation-state.mjs`: `type === "exit" ? visualElement.presenceContext?.custom :
undefined`, then `resolveVariantFromProps` falls back to the component's own `custom` prop.
2. **The first-paint inline style sees no custom at all** (`use-visual-state.mjs` → `makeLatestValues`
   omits it), so a dynamic `initial` would paint its default branch for one frame. **Hence the entrance
   reads a plain `movement` prop on `Card` and the exit reads `custom`**, both fed by `CardStack`'s latch.
3. **`AnimatePresence initial={false}` blocks only the first render**
   (`<PresenceChild initial={!isInitialRender.current || initial}>`).
4. **Reduced motion jumps, it does not skip** (`visual-element-target.mjs` passes `{ type: false }` for
   positional keys), so a card mounting at `x: 600` lands at 0 instead of being stranded.
5. **`x: 0` renders `transform: none`** (`build-transform.mjs`), and `will-change` is never auto-set
   (`MotionGlobalConfig.WillChange` is never registered). Give the forward-entering card a
   `will-change`, a non-zero `initial` or a `position` class and it becomes a stacking context. (The
   `perspective` on the card already does — see "SOLVED" below; that is why both exits name a z-index.)

The backward exit's `zIndex: -1` puts the absolutised outgoing card below the returning one but above
the `-z-10` preload inside `CardStack`'s `isolate`; it uses `transition: { zIndex: { type: false } }`
because the origin is the string `auto`.

**jsdom gotchas:** a card mounted at 600 px is still at 600 px next render (assert the entrance
before stepping back), and `AnimatePresence` **re-enters** a child whose exit has not finished
(`ExitAnimationFeature`, `isPresent && prevIsPresent === false`) — in jsdom no exit finishes, so 1→2→1
never remounts card 1; `CardStack.test.tsx` steps back two cards. In a browser this is a harmless
250 ms window.

## 2026-09-21 — A type scale on a `<label>` sizes the `<input>` inside it (preflight's `font: inherit`)

Tailwind's preflight gives every form control `font: inherit`, so `text-sm` on a wrapping `<label>`
shrinks the input too. Put the scale on the caption `<span>`. In this repo a size class on a wrapper
around a control is a size class on the control. (Rule and the `pt-8` logo contract: AGENTS.md
§ Screens.)

Also: an unexplained unstaged hunk in `src/game/copy.ts` turned out to be the **developer's own
hand-edit** — check before "fixing" an odd string in the copy surface.

## 2026-09-21 — A finger-driven step back: three things that decide whether it is visible at all

- **The peek parks one card-width out, not at `EXIT_DISTANCE_PX` (600).** On a 360px viewport the
  288px card spans x = 36..324, so a peek at 600 starts 276px past the viewport edge and the 96px
  commit fires before it ever appears. One card-width out also makes the mapping 1:1 in CSS px. 600
  stays the **keyboard** step back's entrance.
- **A `useTransform` output is deferred only in tests.** After `peekProgress.set(0.5)` the derived
  `display` still reads `'none'` in the same tick and `'block'` after one `setTimeout(0)` — so tests
  need `waitFor`. In a browser it is the same frame (`useCombineMotionValues` subscribes on
  `frame.preRender`; source written in `update`, derived in `preRender`, DOM in `render`), and it also
  updates synchronously during render.
- **`MotionValue` is invariant**: `useTransform(v, (p) => p > 0 ? 'block' : 'none')` infers
  `MotionValue<'block' | 'none'>` and will not assign to `MotionValue<string>`. Annotate the callback's
  return (`(progress): string =>`); the error surfaces four levels deep in `PassiveEffect`.
- **Only `display` hides the peek without a horizontal scroll** — `opacity`/`visibility` keep it laid
  out a card-width to the right. It is a `MotionValue` because the only place to set it is the per-frame
  drag handler.
- Motion emits `transform: none` (not `translateX(0%)`) at rest, so the dragged-home entrance test
  asserts `transform: none`.

## 2026-09-21 — SOLVED: a right-swiped card slid out UNDER its replacement, and `perspective` is why

The thrown card was occluded by the incoming one for the whole exit. `popLayout` absolutises the
outgoing card, but **every card's outer element has `perspective-distant` (`perspective: 1200px`),
which makes it a stacking context**. A non-positioned stacking context paints in the same step as
positioned `z-index: 0`/`auto` elements, by **tree order**, and framer-motion splices the exiting child
_before_ the present one (`nextChildren.splice(i, 0, child)`), so the incoming card always won. Not a
`d59ec84` regression (`zIndex: 0` and `auto` paint in the same step), not a transform issue, not a
`popLayout` failure; live since `eead1c0` (2026-08-05), missed by the 2026-08-06 device pass because
the occluded part is only a sliver on a phone.

Measured in **headless Chrome** (`--headless=new --dump-dom`) with a four-element reduction
(`relative isolate` parent; `absolute; perspective: 1200px; translateX(120px)` first child; static
`perspective: 1200px` second child), probed with `elementFromPoint` in the overlap:

| outgoing `z-index` | incoming `perspective` | on top |
| ------------------ | ---------------------- | ------ |
| `0`                | `1200px`               | IN     |
| `1`                | `1200px`               | OUT    |
| `0`                | `none`                 | OUT    |

**Fix:** `ABOVE_INCOMING_Z_INDEX = 1` on the forward exit (above the incoming card's 0, below the
peek's `z-10`), beside `BEHIND_INCOMING_Z_INDEX = -1`; `Card.test.tsx` asserts sign and bound. Rule:
AGENTS.md § Gestures and deck animation.

**General lesson:** `perspective`, `opacity < 1`, `filter`, `will-change` and `transform` all create
stacking contexts, and any of them on the in-flow sibling cancels "positioned paints on top". This
**corrects the 2026-08-05 entry's** "regardless of DOM order" rule: an absolute first child versus an
in-flow `perspective` second child, no z-index — the in-flow card wins. That entry's `isolate` +
`-z-10` fix still stands.

## 2026-09-22 — The two swipe animations were matched on DURATION, which is why they did not match

Both ran 250 ms over different distances:

| release                            | distance left                                                               | duration | rate           |
| ---------------------------------- | --------------------------------------------------------------------------- | -------- | -------------- |
| left swipe at the commit threshold | 288 − 96 = **192px**                                                        | 0.25 s   | **768 px/s**   |
| right swipe                        | ~566px of `EXIT_DISTANCE_PX` (the card rests at `DRAG_ELASTIC × 96` ≈ 34px) | 0.25 s   | **~2260 px/s** |

The developer wanted the (slower) left swipe. Derived, nothing written down:

```
TRAVEL_SPEED_PX_PER_S = (REFERENCE_CARD_WIDTH_PX - SWIPE_COMMIT_DISTANCE_PX) / EXIT_DURATION_S  // 768
TRAVEL_DURATION_S     = EXIT_DISTANCE_PX / TRAVEL_SPEED_PX_PER_S                                // ~0.781
```

The commit-threshold release is the left swipe's fastest point, so it is the conservative target.
Cost: ~3× the old wall clock per advance; the lever is the speed. `TRAVEL_DURATION_S` covers **both**
full-distance journeys (forward exit and the keyboard's backward entrance from 600px) — slow only the
throw and ArrowLeft becomes 2400 px/s. `EXIT_DURATION_S` is now the SHORT duration (backward exit's
settle, the dragged backward entrance, `PEEK_RETURN_DURATION_S`). No test pins either number;
`--duration-card-exit` names the short one and the derived one has deliberately no token.

## 2026-09-23 — A paid app's CLOSED testers pay; promo codes are the candidate

`support.google.com/googleplay/android-developer/answer/9845334`: internal testers install free, but
"testers must purchase paid apps when participating in open or closed tests" — and the closed track is
the one the twelve-testers / fourteen-days rule counts. **License testing does not help** (in-app
purchases only). **Promo codes**: up to 500 per quarter (`answer/6321495`), unused codes lapse at
quarter end, one Play-generated code per tester (custom strings are subscriptions-only). **Unverified:
whether a code redeems for an app only on a closed track** — check in Monetize → Promo codes; fallback
is reimbursing testers. Recorded in `visual-assets/tester-notes.md` and `plan.play-store-todo.md`.

Developer decisions the same day (in `plan.play-store-todo.md` Open Questions and
`visual-assets/listing.md`): content-rating UGC question **No**; Vercel access-log IP retention **is
declared** in Data safety; "Playlist Jitster" needs no more distance from the Hitster mark; net after
fees/VAT not relevant. Testers: recommended a Console email list and recruiting ~15.

`assetlinks.test.ts` gained the cross-file package-id pin and a fingerprint format/equality test
against `android/twa-manifest.json`.

## 2026-09-24 — Store assets: the 512 icon is a palette PNG, Playwright and Canva gotchas

Play listing graphics and screenshots (inventory in `visual-assets/listing.md` §4a) were made with
Playwright against the deployed app, plus Canva.

- **`public/pwa-512x512.png` is a palette PNG (PIL mode `P`)**. It stays so on purpose: RGBA is ~173 kB
  against 67.5 kB in every precache, and Bubblewrap's launcher mipmaps do not need 32-bit. Only the
  Play store icon does: `visual-assets/assets/graphics/play-icon-512.png`, an RGBA regeneration from the
  master, uploaded by hand.
- **Playwright PNG screenshots are RGBA; Play wants no alpha** — the script writes JPEG q95.
  Playwright runs from a scratch dir, never `devDependencies`; invocation in
  `visual-assets/screenshots.mjs`, which defaults the game shots to "Rock Party".
- A `sed`-then-Python edit once turned a regex `\b` into a literal backspace (0x08), silently breaking
  a filter — check with `od -c` if a filter "never fires".
- **Canva MCP:** `create-design` hit `quota_exceeded` after three designs in one session and
  `resize-design` had one trial use; `edit-design`'s `add_page` takes its own `width`/`height` (one
  design can hold every format) and costs no generation quota. `create-design`'s `format` ignored
  "Custom 1024x500 px" (returned 1264×1264). Generated backgrounds can carry a faint baked copy of their
  headline — cover with a solid shape. Local files reach Canva via `create-upload-url` + a raw-bytes
  POST; `upload-asset-from-url` cannot read undeployed files.

## 2026-09-24 — Store copy and visual assets live in `visual-assets/`

Final layout after three same-day moves: `visual-assets/listing.md`, `tester-notes.md`,
`screenshots.mjs`, `assets/{graphics,play-phone,social}` (tracked) and
`assets/play-tablet-chromebook/` (git-ignored, regenerated by the script); the logo master is
**`visual-assets/logo-master/logo.png`, tracked**. Older entries' `docs/store/` and `docs/assets/`
paths mean these.

## 2026-09-24 — "Hitser" fixed in the HUD through `playlist-display-name.ts`

The first suggestion's real Spotify title is **"Hitser"**, and the HUD showed it via `deckLabel()`.
`src/game/playlist-display-name.ts` maps that id → "Jitster official", read by `deckLabel()` (HUD,
end-screen count, PDF filename, library saves), `EndScreen`'s multi-playlist list and `loadLibrary`
(rebuilds the name from `ids[0]` plus "+N more"). **Applied on read, never on write**, which heals old
saves without a migration. Only labels for the APP belong in the map — overriding the other suggestions
would make the HUD disagree with what the QR opens. The guard in `LandingScreen.test.tsx` is
`/hitst?er/i`. **Not fixable here:** Spotify still shows "Hitser" after a scan; renaming the playlist
is the developer's action.

## 2026-09-24 — Play automatic protection requires `minSdkVersion` 24

Console warning on the first AAB: "La protección automática de Play requiere que la versión del SDK sea
24 o una posterior" (Bubblewrap 1.25.0 defaults to 21; a fresh `init` emits 21 again). Fixed in
`android/twa-manifest.json` (`minSdkVersion: 24`) with `appVersionCode` 1 → 2 (code 1 was already
used), regenerated with `bubblewrap update --skipVersionUpgrade`. **That `update` also rewrote the root
`package.json` `version` to the `appVersionName` (`1.0.0`)** — reverted. Run `git status` after every
`bubblewrap update`.

## 2026-09-28 — Three languages: what the migration found

Rule: AGENTS.md / decisions.md § Copy and languages.

- **`type Copy` is `COPY` with every literal widened to `string`**, and the translations are
  `satisfies Copy`. A plain `typeof COPY` would reject every translated string, because `as const`
  makes each value its own literal type.
- **The saved library used to store a FINISHED label** (English "+N more" included), so a language
  switch would have left English suffixes forever. It now stores the base name; the legacy suffix is
  matched against a frozen literal, not `COPY.deck.label`, because it describes bytes already in
  storage.
- **`usePdfExport`'s `exportDeck` depends on the active copy**, so a language switch changes its
  identity and re-runs `DeckActions`' auto-export effect. `hasAutoExportedRef` prevents a second
  export — a second reason for that ref to exist.
- **The catalogues are bundled into the shared `gestures` chunk** (about +5.4 kB gzip). All three
  languages ship to every player; lazy-loading one would put a network round-trip in front of first
  paint.
- A `localStorage` getter can throw, so every first-render read goes through
  `src/game/browser-storage.ts` (see the 2026-10-01 edge-cache entry for why `App.tsx` needed it too).

## 2026-09-29 — The share-link route's long task was the QR's PNG encode, and how to see inside a Lighthouse task

- **The share-link route scored Performance 84 (79–84), ~620 ms TBT, against production; home and
  privacy scored 100.** One ~970 ms (simulated 4× CPU) long task per run, a 174 ms `RunMicrotasks` in
  the trace. It was entirely `qrcode.toDataURL` (~85% canvas render + PNG encode); both QR codes (the
  card and the preloaded back) continue off the same memoized `loadQrcode()` promise, so they run in
  one microtask checkpoint. Fixed with `toString({ type: 'svg' })`: cold, two codes, 4× CPU, ~105 ms
  PNG vs ~42 ms SVG. Before/after in `docs/review.unlighthouse.md`.
- **A Lighthouse trace has no CPU samples by default.** `--save-assets` gives only task boundaries.
  Add `--additional-trace-categories=disabled-by-default-v8.cpu_profiler` for the renderer's
  `Profile`/`ProfileChunk` events, and map their `callFrame`s through a `vite build --sourcemap` of
  the SAME commit (chunk hashes come out identical). Filter to the page's renderer — Chrome's WebUI
  renderers (omnibox, top-chrome) carry plausible-looking long tasks that are not the app's.
- **On Windows, Lighthouse 13.5.0 exits non-zero after EVERY run** (`EPERM … rmSync …
lighthouse.<n>` from chrome-launcher's temp cleanup) after the report is written. Judge a run by its
  report file, not the exit code.
- **`.claude/skills/unlighthouse/SKILL.md` was copied from another project** (its routes and base URL
  are `calculadorapatrimonio.vercel.app`'s). The procedure applies; the targets do not. Routes used
  here: `/`, a share link (`/?playlist=…&seed=…`), `/privacy.html`.
- **The share route can be audited locally only with `/api` proxied** (`vite preview` has no
  functions): a small Node server serving `dist/` with the SPA fallback and forwarding `/api/*` to
  production. Its numbers compare only with each other.

## 2026-09-29 — The shuffle review, implemented (and the version removed the same day)

The shuffle is the hash sort, with no version — rule: AGENTS.md / decisions.md § Decks. A
`shuffleVersion`/Fisher-Yates split was built and removed within hours (no saved games to protect).
Accepted cost: **a link minted before 2026-09-29 deals a different order than its sender saw.** The
`v` param is ignored, not rejected (links from `104c1e2` carry `v=2`); a save carrying
`shuffleVersion` still loads because `validateSession` rebuilds field by field. What still holds:

- **The output is pinned as literals in `shuffle.test.ts`.** Before that, changing an FNV or
  mulberry32 constant passed the whole suite. An off-by-one variant (Sattolo) fails three of the new
  tests (the pin, "all 6 orders at n = 3", mean fixed points ≈ 1) and passed all the old ones.
- **"Independent of input order" holds only for distinct ids** — equal ids get equal keys and fall
  back to the stable sort's input order. `deck-merge.ts` dedupes by id.
- **A mid-deck start (`&card=`) broke three things that assumed card 1**: the card-1 gate (now "the
  current card has a year"); the resolver's first lookup (it took `deck[0]` before the priority effect
  ran — the order is now rotated from the start index); and `YEAR_RESOLVED`'s "current card dropped,
  nothing follows → ended", which during `preparing` would show "Deck finished" (it now clamps to the
  new last card and keeps waiting).
- **`startIndex` must be clamped to `[0, currentIndex]` on every reducer exit**, or a save is written
  that `loadSession`'s validator rejects on reload.
- **The "same link" check is a subset check on playlist ids, not equality** — a recipient whose
  five-playlist link lost one to a private playlist has four in the save. The 64-bit seed is the real
  identity; the card is never compared.
- **`satisfies Copy` cannot enforce a new function PARAMETER**: a translation of `shareCaption` that
  ignores `fromCurrentCard` still fits. A per-locale test (`shareCaption(n, true) !==
shareCaption(n, false)`) is the guard.
- **Accepting the replace prompt must not call `end()`** — `END` clears the save, so a failing fetch
  would cost the kept game.

## 2026-09-29 — `App.test.tsx` still flaked after the 2026-09-19 fix: a LOST keypress, now closed by a layout effect

- **The shape**: a test presses → right after `await waitFor(hud)` and uses the whole 5 s, with
  nothing moving (seen on "should reset the end reason…", "should return to the landing screen from
  the end screen", "should deal the link again from card 1 on a reload after the game ended", and once
  "should step back to the previous card on ArrowLeft").
- **The cause, measured**: a probe counting window `keydown` listeners at every press — across twelve
  loaded runs, 203 presses found `GameScreen`'s listener; the one that found ZERO was the failing
  test. The listener was attached in a PASSIVE effect; the HUD arrives from a commit outside `act`,
  and under load the press ran before React flushed the effect.
- **The fix: `useLayoutEffect` for that subscription** (`GameScreen.tsx`), so "HUD in the document"
  implies "listener attached". Eighteen loaded runs after: 306 presses, 0 of 1,026 tests failed.
  **Do not raise `asyncUtilTimeout` for this shape** — a press with no listener is lost however long
  the test waits.
- **Rejected**: waiting on `history.state` (a remounted game screen can still see the first mount's
  entry, because the cleanup's `history.back()` is queued), and an extra `setImmediate` /
  `await act(async () => {})` (both depend on the Scheduler's task landing first).
- **Not exposed**: the dialogs' Escape listeners and `useBackNavigation`'s `popstate` listener — every
  test reaches them inside `act`.
- **A second flake fixed alongside**: `useBackNavigation.test.ts`'s `settle()` and
  `GameScreen.test.tsx`'s `pressBack()` waited a fixed 50 ms for jsdom's traversal; under a stalled
  loop the timer fires before jsdom's second hop is queued. Both now drain two ordered
  `setTimeout(0)` hops inside `act`, like `flushHistoryTraversal`. 20 loaded runs: 880 tests, 0
  failures.

## 2026-09-29 — Restart from the exit dialog: the screen does not unmount

Rule: AGENTS.md / decisions.md § The game session. Two details beyond the rule:

- **Without a remount the stack plays a restart as a step back** (card N → card 1 reads as
  `backward`). `CardStack` is keyed on `seed`, which only `START` changes; the key is on the stack
  rather than `GameScreen` so the back-navigation hook's history entry is not torn down and re-pushed.
- **The dialog's Tab trap is a cycle in DOM order** (Shift+Tab backwards); the old two-button swap
  would have skipped Restart.

## 2026-09-29 — Year-fetch spike: 21% of real cards get no year, title work cannot fix it, a store vote can

Headline numbers; full write-up in [`docs/spikes/spike.year-fetch-rework.md`](./spikes/spike.year-fetch-rework.md).

- **115 of 542 cards (21%) got no year; ~109 had an EMPTY MusicBrainz pool** — coverage (new
  Latin/urban, Catalan catalogue). Openings Català lost 44 of 47, Trap Argentino 29 of 100, Rock
  Party 0 of 100.
- **Every title rewrite and query alternative together recovers 8 of the 115.**
- **MusicBrainz `high` is ≤ ~96.7% precise on real decks** (≥ 13 of 394 confidently wrong: Self Esteem
  2002, Dark Horse 2016, Bad Romance 2008 …); 8 of 33 `low` answers wrong.
- **Deezer's `release_date` is an edition date** (40% exact before 2015, 94% after); **iTunes is strong
  on old catalogue** (86%; 19/19 fixtures, Personal Jesus 1989). Deezer's `artist:"…" track:"…"`
  syntax returned nothing for 540 of 542 — use free text.
- **A vote needing two INDEPENDENT providers** (Deezer's release date and ISRC year count as one) takes
  dropped cards 115 → 18: 21 confident corrections, 0 known regressions. Letting Deezer's two fields
  confirm each other produced the only regressions (Killing In The Name → 2012, Hypnotize → 2007).
- **46 of 542 lookups hit a MusicBrainz `503` at 1.1 s spacing** (10–16% of requests in later runs).
- A harness must never share the production Upstash cache; two harness processes with per-instance
  gates together exceed MusicBrainz's 1 req/s.

## 2026-09-29 — Licences: Deezer and iTunes are out for a paid app, and the public MusicBrainz API is non-commercial

Full table and quotes in the spike §10.1. Not legal advice.

- **Deezer API**: "strictly limited for a non-commercial purpose". **iTunes Search API**: promotional
  use only, never "for independent entertainment value". Both excluded for a paid app.
- **MusicBrainz web service**: non-commercial use free; commercial needs a plan (Bronze from
  $100/month; the $0 Stealth tier is only for services not yet public). **This affects the current
  app.** The data is CC0 and a self-hosted mirror is allowed commercially, but the prebuilt search
  indexes are CC BY-NC-SA, so a mirror must build its own.
- **Discogs**: charging for an app integrating its content needs written permission; dumps are CC0.
- **Wikidata** (CC0): useless — a lookup by Spotify track id (`P2207`) dated 9 of 542, none of the 115
  misses.
- **Dead end**: batching several cards into ONE MusicBrainz recording search loses 33–40% of years
  (the shared 100-result page fills with the popular songs). Only the release-group id lookup batches
  safely.

## 2026-09-29 — Discogs measured, and Deezer's "recent release" signature is the fastest certain year source

Spike §11. Discogs is dropped by decision (spike §13.12); the traps are kept in case it returns.

- **Discogs: 21 of 22 fixtures exact, but 60% coverage and 9 of the 115 misses.** `database/search`
  needs the undocumented `sort=year&sort_order=asc`; a master's `year` is its main release's; singles
  need a `type=release&release_title=` query; `track=` is fuzzy. Git Bash rewrites `/masters/...` into
  a Windows path — set `MSYS_NO_PATHCONV=1`.
- **Deezer's quota error comes back with HTTP 200**:
  `{"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}`. A client trusting the
  status reads an empty result.
- **A Deezer result whose release-date year equals its ISRC year, ≥ 2015, with no remaster/live
  suffix, agreed with consensus 129 of 129 times** (44% of a real deck, ~0.25 s a card) — the basis of
  the lone-Deezer rule.

## 2026-09-30 — The internal `hitster` identifiers were renamed to `jitster`, keys included, with no migration

Rule: AGENTS.md / decisions.md § The name. Renamed: the three `localStorage` keys, the package name
(`custom-jitster`), the `MUSICBRAINZ_USER_AGENT` example/test values, `api/hello`'s message, the
`https://jitster.example` test origins, `useBackNavigation`'s `customJitsterBackEntry` state, and
`docs/plans/custom-jitster-mockup.png` (older docs still name the old path). Anything saved under
`hitster:*` is no longer read. The deployed `MUSICBRAINZ_USER_AGENT` in Vercel is set outside the
repo and was not changed.

## 2026-09-30 — On soundtrack decks every year provider dates the RECORDING, not the film

Spike §13. On Mejores BSO, Disney top 100 and Openings Català, only 76% (BSO) and 54% (Disney) of the
years the vote shows match the film, and 52 of 53 misses are **later**: Spanish dubs are dated by the
compilation that sells them (iTunes dates the Peter Pan songs 2002). iTunes and Deezer are **not
independent** on these decks (both carry the label's date). The title cleaner leaves the Spanish
`- de "…"/Banda Sonora Original` tail and `''…''` quotes in place.

## 2026-09-30 — An LLM guesses past its knowledge cutoff; Gemini's free tier cuts streams mid-response

For [`docs/spikes/spike.ai-year-fetch.md`](./spikes/spike.ai-year-fetch.md). Nothing built.

- **Abstention does not happen**: with "return null rather than guess", **40 of 40** post-cutoff tracks
  got a year, all wrong, nearly all `confidence: "high"`.
- **Free tier: 20 requests a day per model**; under load most calls are `503`.
- **A `503` can arrive INSIDE a stream that began with HTTP 200** (6 of 8 `streamGenerateContent?alt=sse`
  legs) — read the body for an error object.
- **In NDJSON mode the response schema is not enforced** (`"confidence":"medium"` came back outside the
  enum). Thinking at `low` billed zero tokens.
- The Windows `node` assertion `!(handle->flags & UV_HANDLE_CLOSING)` after `process.exit()` with a
  fetch body open is harmless harness noise.

## 2026-09-30 — MusicBrainz fixes built: the cleaner's lazy head and the live acceptance diff

From [`plan.year-fetch-rework-mb-fixes.md`](./plans/plan.year-fetch-rework-mb-fixes.md) (commit
`4197322`). The `tokenised` rung this plan also built was removed on 2026-10-01 (see below).

- **The lazy head was the bug**: `X (REMIX) (feat. Y)` matched as ONE segment that no family
  recognised. The head is now greedy, so the LAST segment is examined first; the old lazy pattern
  stays as a fallback and the old loop as a floor keeping the shorter result (without the floor,
  `Song (Live) Foo (Mono)` would strip LESS than before).
- **`stripRemixSuffix` changed silently through the same constant**: `A - B - Remix` now strips to
  `A - B`, not `A`.
- **The 22 accuracy fixtures cannot see the cleaner**: `pickBestRecording` reads `fixture.candidates`
  and never calls `cleanTrackTitle`. Its own tests and the live diff guard it.
- **Live acceptance diff (255 tracks, 977 requests, 10.6% 503s): 0 moved or lost, 17 null → year**
  (16 from the code, 1 from data drift). Two wrong recoveries are the scorer's: Disney originals
  credited "Julie Andrews, Dick Van Dyke and Pearlies" / "Mandy Moore and Zachary Levi" fail the exact
  artist rule, so a later recording answers at `low`. `Pobres Almas En Desgracia – De "La Sirenita"`
  gives 1994 `high` (the only Spanish recording) where iTunes says 1989.
- **Ruled 2026-09-30: a `Re-Recorded` title resolves to the ORIGINAL** (Flashdance 1983 `high` is
  correct) — the one exception to the recording-year rule.
- Harness and raw responses: `.scratch/plan1/` (git-ignored; `inspect.ts` replays a track offline).

## 2026-09-30 — The provider vote rebuilt; the replay reproduces the spike; back-coded ISRCs are real and a 1986 floor was refused

From [`plan.year-fetch-rework-server.md`](./plans/plan.year-fetch-rework-server.md).

- **The spike's §12.7 provider files were lost** (an uncommitted working tree) and rebuilt from the
  plan, without `discogs.ts`. Replay scripts live in the git-ignored `.scratch/`.
- **The replay reproduces §13.10 and §13.12 to the digit** (`.scratch/plan2/replay/replay.ts`,
  offline): on the 542, 474 confirmed, 63 unconfirmed, 5 without a year (346 at `resolve`, 128 at
  `verify`), 342/343 vs consensus; 21/22 fixtures; 112/125 labelled cards.
- **Back-coded ISRCs are routine and CORRECT** — majors code old catalogue with the original year. 28
  verified Deezer rows decode to 1964–1984 (`AUAP08000046` Back In Black 1980, `SEAYD7601020` Dancing
  Queen 1976, `USMC17301722` Free Bird 1973). A 1986 floor lost 4 confirmations (474 → 470), moved Lay
  All Your Love On Me 1980 → 1977, took labelled 112 → 111 and fixed nothing. Refused.
- **The GBSMU registrant writes nonsense year digits** (26, 29, 34, 39, 46, 64) on "Legendary FM
  Broadcasts" bootlegs. The ISRC year is the minimum over rows, so `GBSMU2955085` (1929) hides Sweet
  Child O' Mine's `USGF18714809` (1987); the card confirms at `verify` instead, one iTunes request, no
  year changed. Exclusion not built (see 2026-10-01).
- **Deezer costs 2.35 requests per card**: one search plus `track/{id}` per VERIFIED hit, capped at
  `DEEZER_TRACK_FETCH_LIMIT` = 3 (389 of 514 release years exact vs 382 at a cap of 1).
- **Drift**: iTunes 22/22; Deezer differs on two fixtures (`sweetChild` now 2016 / ISRC 1929;
  `bohemianRhapsody`'s ISRC year 2001 → 2003).
- **`api/year.test.ts` would deploy as a function** (`vercel.json` routes every `api/*.ts`); endpoint
  tests live in `api/_lib/year-endpoint.test.ts`.
- **The cross-layer test freezes `Date`** (`vi.useFakeTimers({ toFake: ['Date'] })`), because
  `isrcYear`'s pivot moves with the clock and GBSMU's `29` reads 2029 from 2028 on.

## 2026-09-30 — Provisional years and keepYearless: two places a resumed card silently became final, and a flaky full-suite run

Rule: AGENTS.md / decisions.md § provisional years and the client resolver. Beyond the rule:

- **The card-1 gap closed itself in the resolver, not the hook**: during `preparing` the start card
  goes provisional without `currentCardId` changing, so `prioritize` never fires again. The resolver
  tracks the current card itself (seeded from `deck[startIndex]`).
- **A 200 without a boolean `final` is `unexpected-payload`** (also guards against stage-less
  edge-cached bodies). `App.test.tsx`'s year stubs need `final: true`, or every gate hangs rather than
  fails.
- **A deferred card made urgent, hit by a 429 and then left behind dropped out of every queue** and
  stayed pending forever. Fixed and pinned by a test.
- **The checkbox's `touch-target` sits on the `<label>`** (on the input it draws a 44 px native box);
  the hint sits OUTSIDE the label, tied by `aria-describedby`, or it joins the accessible name.
- **`pnpm test` "15 errors" with every test passing** = `[vitest-pool]: Failed to start forks worker …
Timeout waiting for worker to respond` under machine load (also seen with parallel agents running
  the suite). `pnpm test -- --maxWorkers=4` ran clean. Read the error text before calling it a
  failure.

## 2026-10-01 — Deezer's ISRC year earns its place; a GBSMU exclusion changes nothing on the recorded data

Offline, `.scratch/plan2/replay/replay-noisrc.ts`, with the shipped `UNCONFIRMED_TRUST`:

| On the 542                           | confirmed | unconfirmed | no year | vs consensus | labelled (125) | iTunes asked |
| ------------------------------------ | --------- | ----------- | ------- | ------------ | -------------- | ------------ |
| ISRC kept (shipped)                  | 474       | 63          | 5       | 342/343      | 112            | 196          |
| No ISRC, a lone Deezer never counts  | 457       | 46          | 39      | 335/343      | 106            | 259          |
| No ISRC, a lone Deezer always counts | 457       | 83          | 2       | 335/343      | 106            | 259          |
| GBSMU codes excluded                 | 474       | 63          | 5       | 342/343      | 112            | 196          |

- **Why the ISRC helps**: Deezer's release date is often a compilation/remaster date (Billie Jean
  2009, Free Bird 2001) while the ISRC keeps the original (Free Bird 1973) — the older date lets
  Deezer agree with MusicBrainz at `resolve`. Without it 63 more cards wait for iTunes.
- **The GBSMU exclusion is invisible on the spike's data** (no GBSMU code); on the 2026-09-30 captures
  it moves only Sweet Child O' Mine from `verify` to `resolve`. Not built.

## 2026-10-01 — FIXED: a busy MusicBrainz gate inside the recording-query loop no longer returns `rate-limited`

Rule: AGENTS.md § Year resolution: MusicBrainz ("every permit after the lookup's first spent
request…").

- **The bug**: a busy gate before rungs 2+ returned `rate-limited`; the client treats a 429 as free,
  re-asks without counting an attempt, and the lookup restarts from rung 1, spending the empty rungs
  again.
- **The fix**: rung 1 keeps the gate's default 1.5 s wait and still returns `rate-limited` (nothing
  spent). Every later permit (later rungs, release-group, the remix fallback's first query) waits up
  to ~3.5 s (`SPENT_LOOKUP_MAX_WAIT_MS`, about three queued lookups at 1.1 s spacing), then returns
  `upstream-unavailable` (502, counted against the retry budget). Waiting rather than failing at once
  keeps the answer equal to an uncontended lookup; a deliberate exception to `rate-limit.ts`'s "never
  wait long inside a function".
- **Cost unmeasured**: idle function time on contended cold cards — `development.md` §5, "The
  three-provider year vote", row 1.

## 2026-10-01 — The recording-query ladder reordered: the artist guess before the full-artist unbounded query, and the tokenised rung removed

Rule: AGENTS.md / decisions.md § Year resolution: MusicBrainz. Harness and raw responses in
`.scratch/plan5/` (git-ignored; summary `.scratch/plan5/report.txt`). Reverses the 2026-09-30
`tokenised` rung and Phase 2's decision 15.

- **The change**: `duration-bounded` → `unbounded` → `artist-guess` → `tokenised` became
  **`duration-bounded` → `artist-guess` (no `dur:`) → `unbounded`**. `tokenised` is gone everywhere
  (ladder, remix fallback, its `low` cap). `YEAR_CACHE_SCHEMA_VERSION` `v5` → `v6` (Get Lucky was
  cached at 2021 `low`). A guess equal to the full string is skipped, so a single-artist card asks
  rungs 1 and 3.
- **Why**: in the spike baseline the guess found a year for **68%** of cards reaching it (108 of 159),
  the unbounded full string **5%** (11 of 235).
- **Live diff, 782 cards** (the 542 + 240 soundtracks), shipped variant `v1notok` vs the old order:

  | Cards               | Requests before → after | Per card          | Change     |
  | ------------------- | ----------------------- | ----------------- | ---------- |
  | The 542             | 1454 → 1255             | 2.683 → 2.315     | −13.7%     |
  | The 240 soundtracks | 685 → 548               | 2.854 → 2.283     | −20.0%     |
  | **All 782**         | **2139 → 1803**         | **2.735 → 2.306** | **−15.7%** |

  MusicBrainz's own answer: 774 unchanged, 3 lost, 5 moved.

- **The 3 lost are ex-tokenised hits Deezer already has** (Olvidarnos De To' :), La Plena (W Sound 05)
  twice); 0 shown years change under the vote. Inside the remix fallback `tokenised` rescued 0.
- **The 5 moved — 4 better, 1 wrong both ways**:

  | Track                              | Old (unbounded) | New (guess) | Truth |
  | ---------------------------------- | --------------- | ----------- | ----- |
  | Get Lucky (Radio Edit), Daft Punk  | 2021 `low`      | 2013 `high` | 2013  |
  | Get Lucky, Daft Punk (second card) | 2021 `low`      | 2013 `high` | 2013  |
  | Up Where We Belong                 | 1997 `low`      | 1982 `high` | 1982  |
  | You're The One That I Want         | 2021 `low`      | 1978 `high` | 1978  |
  | Somebody That I Used To Know       | 2012 `low`      | 2017 `high` | 2011  |

  The unbounded full-artist query matched one to three stray recordings credited with Spotify's comma
  list (mostly remixes); the guess pool holds the original.

- **Known cost**: a 13-artist comma-in-name probe with no duration found 1 wrong year — "Teach Your
  Children" (Crosby, Stills, Nash & Young) **1969** instead of 1970, via a Crosby, Stills & Nash
  recording the exact matcher admits. Earth, Wind & Fire ×3, Tyler, The Creator ×3 and the rest are
  unchanged; Boogie Wonderland (2013) and Leaving on a Jet Plane (1972) are wrong under both orders.
- **The feared steal** (a non-empty guess pool scoring no year) happened 0 times in 782.
- **Rejected: a duration-bounded guess** — 6 lost, 9 moved, and one real steal: The Imperial March's
  bounded guess pool held two non-scoring recordings, so 2017 `low` became null.
- **OPEN: the exact artist matcher rejects "Gotye feat. Kimbra" for "Gotye, Kimbra"** (7 recordings in
  the guess pool), so Somebody That I Used To Know is wrong in both orders. Under the vote it still
  shows 2011 (iTunes + Deezer); the wrong year shows on the stage-less path and wherever the stores are
  silent.

## 2026-10-01 — FIXED: an edge-cached non-final `verify` answer turned a two-second outage into a dropped card

Found by `docs/reviews/review.year-fetch-rework.md` (B1). Rule: AGENTS.md § the provider vote
("a non-final answer built on a failure or a busy provider is `Cache-Control: no-store`").

- **The bug**: every non-final 200 was `public, s-maxage=60, stale-while-revalidate=60`. The verify
  lane retries **the same URL** (no cache-buster, no `cache:` option in `year-client.ts`) after ~0.5 s
  and ~1 s, then its second pass — all six hit Vercel's edge copy, so `settleExhausted` ran ~4 s after
  a 2 s blip. Nothing local can see it; no test runs behind a CDN.
- **The fix**: keep the 60 s for a plain provisional answer; `no-store` when non-final AND a provider
  failed or was busy (`transient` on `runStage`'s ok outcome, read by `stagedEdgeMaxAgeSeconds`).
  **Lesson: an edge `Cache-Control` on a response the client is designed to retry must be decided by
  whether the client will retry it**, not only by how stale it may get.
- **Same review, by developer ruling** (all now rules in AGENTS.md): a `resolve` with an answer in hand
  no longer turns one busy provider into a 429 (`verify` keeps the 429, because the client counts a
  non-final verify 200 as an attempt); an exhausted resolve hands the card to verify; a store lookup
  with no `durationMs` sends no request and is never written; `busy` (our gate, Deezer `code: 700`, a
  Deezer/iTunes 429) is retried with no cap, `refused` (iTunes 403, Deezer `code: 4`) is a skip. Before
  that, a long Apple throttle would have left every card provisional forever.
- **Correction to the 2026-09-28 entry**: a throwing `localStorage` getter in `App.tsx` was not
  survivable — it crashed on every reload, and Start over could not clear storage it could not reach.
  Every first-render read now goes through `src/game/browser-storage.ts`, and `App.test.tsx` renders
  the app with a throwing getter.
- The resolver header's "one client never holds two MusicBrainz lookups" was corrected, not enforced:
  `verify` re-running a cold `resolve` frontier is by design.

## 2026-10-01 — The picker's options: final wording DEALS when ticked; the model kept `keepYearless`

The pair was relabelled twice the same day ("Keep…" → "Skip…" → "Deal…"); the final state is "Deal
cards with no year found" (`keepYearless`) / "Deal cards with an unconfirmed year"
(`!skipUnconfirmed`, inverted in `App.tsx` only). Rule: AGENTS.md / decisions.md § Deal options.
What still matters:

- **"Unconfirmed" = a FINAL year at `low`.** A provisional year is always `low`, and Restart re-deals
  through `START`, so a confidence-only filter would delete every card awaiting `verify`.
  `isDroppedAnswer` checks `yearProvisional` first; `reducer.test.ts` pins the restart case.
- **`loadPrefs` is per-field**: the old "no boolean `keepYearless` → `DEFAULT_PREFS`" rule would have
  reset every record lacking a new key.
- **Print always opens a "Print this deck" view** because the blank-years box could not live in the
  wait alone (the wait renders only while years are pending). The heading is passed as
  `renderHeading(view)`; a lifted `isPrintViewOpen` would have forced a stateful wrapper on every
  `DeckActions` test.
- `OptionCheckbox.tsx` is a native input with `appearance-none`; its utilities were confirmed in the
  built CSS (`peer-checked:block`, `checked:bg-accent`, `group-hover:*`, `has-disabled:*`,
  `divide-border`). Its look has not been seen in a browser (`development.md` §5).

## 2026-10-01 — `/favicon.ico` answered 404 in production; added a small ICO

`/favicon.ico` returned **404**, and tools that do not parse the HTML (Vercel's dashboard) ask for that
path. `public/favicon.ico` is a 16/32/48 ICO (6,938 bytes) from `visual-assets/logo-master/logo.png`,
black floor raised to `#0a0a0a` (`point(lambda v: max(v, 10))`). No `<link>` names it (browsers keep the
WebP) and `globPatterns` has no `ico` (not precached). The other icons were already byte-identical to a
fresh downscale of the master. Whether Vercel's dashboard picks it up is unverified.

## 2026-10-01 — An exhausted verify's year is "unchecked", not "unconfirmed"

Rule: AGENTS.md / decisions.md § provisional years ("an exhausted verify settles final…"). Final state
after three same-day iterations:

- `settleExhausted` used to report a plain final `low`, so with "Deal cards with an unconfirmed year"
  unticked an offline blip (six transient failures, seconds) dropped every card in flight —
  permanently. Now a card is `Card.yearUnverified` ("Year could not be checked", exempt from
  `isDroppedAnswer`) **only when no verify ever answered with a year**.
- **"Some verify answered" needs no server help**: a NON-FINAL 200 carrying a year already says a
  provider was reached and nothing confirmed it. A non-final 200 with a NULL year does not count. Cost,
  accepted: a pure iTunes outage yields unconfirmed years, which a skipping session drops.
- **It is saved on the card** (`Card.yearVerifyAnswered`), or a reload offline turned unconfirmed into
  unchecked. Written by the reducer, validated by `validateCard` (only `true`, only beside
  `yearProvisional`), cleared by any final answer, seeded back by the resolver on resume. Trap: the
  resolver reported a non-final verify year only when it DIFFERED from the provisional one; it now
  reports once more when the mark is new.
- **Still open**: a null settled the same way drops while yearless cards are dropped — the remaining
  offline loss. iTunes over MusicBrainz `high` was proposed and NOT built (`UNCONFIRMED_TRUST` was
  measured against it: 6 known years worse, 2–3 better).

## 2026-10-01 — Preloaded years for the suggested playlists: what the provider vote gets wrong

Rule: AGENTS.md / decisions.md § Decks ("the suggested playlists' years are preloaded"). `pnpm preload-years`
over the 13 suggested playlists (1,000 distinct tracks, ~55 min cold through the shared gates) kept **all 1,000**
as final answers with nothing skipped: 805 `high`, 164 `low`, 31 `none`. A hand review then corrected **144**
(`source: "manual"`), and the pattern is worth knowing before trusting the vote on similar decks:

- **Soundtracks are the vote's blind spot, by construction.** It returns the recording's year, so a dub, a
  re-recording, a cover orchestra or a compilation reissue gets the reissue's year: 43 of 47 Catalan openings
  (SX3 compilations, 1992–2002) and 51 of 100 Disney songs (Spanish dub albums, 2002/2006/2010), plus 31 film
  scores. 23 of the 31 nulls were soundtrack covers no provider knows. The developer's rule is the film's or
  season's year, which no provider can answer.
- **Elsewhere the vote is good**: 25 corrections across ~750 tracks, all verified on the web — remasters on a
  later compilation (Lemon Tree 2009→1995, Zombie 1993→1994), single-before-album (Centuries 2015→2014), and
  album-dated singles (Something Just Like This 2015→2017). The other 8 nulls all had a findable year.
- **A fixture id is a real track id.** `noYearCard`'s id is "Smells Like Teen Spirit", which is in Rock Party, so
  `App.test.tsx` mocks `loadPreloadedYears` to an empty table it controls; without that, seven tests broke.
- **The JSON must be a dynamic import**: statically it took the entry chunk from 226 kB to 395 kB.
