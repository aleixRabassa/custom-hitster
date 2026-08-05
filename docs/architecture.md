# Architecture

Custom Hitster is a **client-heavy single-page app with a thin serverless backend**. The game itself — shuffle, flip, swipe, audio, progress — runs entirely in the browser. The backend exists only to do the three things a browser cannot: reach a CORS-blocked endpoint, set a custom `User-Agent`, and hold a cache shared across all users.

> **Implementation status: Phases 1–6 complete — the app is playable end to end.** All three functions (`/api/hello`, `/api/playlist`, `/api/year`), the year cache, the client-side game layer (`src/game/`), the card UI, the gestures, and the game flow screens (landing, preparing, HUD, notices, end screen) plus the real `src/App.tsx` container all exist today. What does not: Phase 7's polish — responsive breakpoints, `@theme` tokens, a11y beyond accessible names, error/offline states, the Lighthouse pass, and lazy-loading the QR and audio code. Sections below are marked **[built]** or **[planned]** throughout; planned shapes come from [`plans/plan.md`](./plans/plan.md) §3 and are recorded here because they determine where new code belongs, not because they exist.
>
> **One thing is owed rather than planned:** progressive loading has never been verified against a real deployment (step 15 of [`plans/plan.phase-4-6-screens.md`](./plans/plan.phase-4-6-screens.md)). See [`development.md`](./development.md) §8.
>
> **One caveat carried forward from Phase 5:** the gesture thresholds have never been verified on a real touch device — see [§3 The gestures](#the-gestures-srcgamegesturests--srchooksusecardgesturests--built) and `docs/development.md` §8 Known limitations.

---

## 1. Components

| Component            | Technology                         | Location                        | Status                                                    |
| -------------------- | ---------------------------------- | ------------------------------- | --------------------------------------------------------- |
| Browser SPA          | Vite 8 + React 19 + Tailwind CSS 4 | `src/`                          | **[built]** game layer + card; no screens, no gestures    |
| Client game layer    | Pure TS + one React hook           | `src/game/`                     | **[built]** reducer, shuffle, resolver, persistence       |
| Card UI              | React 19 + Tailwind 3D transforms  | `src/components/`, `src/hooks/` | **[built]** flip card, QR, audio                          |
| Serverless functions | Vercel Functions (Node 24 runtime) | `api/`                          | **[built]** `hello`, `playlist`, `year`                   |
| Portable shared code | TypeScript, no platform APIs       | `shared/`                       | **[built]** types, URL parsing, artist helper, year logic |
| Year cache           | Upstash Redis (REST)               | —                               | **[built]** behind `YearCache`; in-memory locally         |

There is **no database, no message broker, no background worker, and no container runtime** in this project, and none are planned. The only persistent stores are the Upstash Redis cache (built, server-side, optional) and `localStorage` (built, client-side — `src/game/persistence.ts`).

The Upstash dependency is **optional by design**: `createCache()` and `createRateLimitGate()` both fall back to per-instance implementations when the variables are absent, so the repo clones and runs with no accounts of any kind. Both log which mode they picked at cold start, because a silent fallback in production looks exactly like a cache that never hits.

### Ports

| Surface                   | Port   | Serves                                     |
| ------------------------- | ------ | ------------------------------------------ |
| `pnpm dev` (Vite)         | `5173` | SPA only — **not** `api/` (see §5)         |
| `vercel dev` (Vercel CLI) | `3000` | SPA **and** `api/` behind one origin       |
| `pnpm preview`            | `4173` | The built `dist/`, to sanity-check a build |

---

## 2. Import boundaries — which tree may import what

This is the single most consequential structural rule in the repo, because violating it fails **only at deploy time**.

```
src/      React SPA (browser).      May use the `@/` alias. May use DOM APIs.
api/      Vercel Functions (Node).  MUST import shared/ by RELATIVE path + `.js`. No DOM APIs.
shared/   Used by BOTH.             No DOM APIs, no Node APIs. Pure, portable code.
```

```
      ┌──────────┐                   ┌──────────┐
      │   src/   │                   │   api/   │
      │ (browser)│                   │  (Node)  │
      └────┬─────┘                   └────┬─────┘
           │  @/ alias OK                 │  RELATIVE path ONLY
           │  ../shared/… also OK         │  `@/…` breaks on deploy
           │                              │  …and the `.js` extension
           │                              │  is REQUIRED at runtime
           └───────────┐     ┌────────────┘
                       ▼     ▼
                   ┌─────────────┐
                   │   shared/   │   no DOM, no Node
                   └─────────────┘
```

- **`shared/` sits at the repository root, not under `src/`.** This keeps the boundary symmetrical: neither side reaches into the other's tree, and both reference `shared/` by plain relative path.
- **`api/` must never import via the `@/` alias.** Vercel's Node runtime documentation states that of the root `tsconfig.json`, _"Most options are supported aside from Path Mappings and Project References."_ An aliased import inside a function type-checks locally and then **fails to resolve at deploy time**. Use `../shared/…`; `api/hello.ts` is the reference shape.
- **The `.js` extension on those relative imports is mandatory, not cosmetic** — `'../shared/constants.js'`. `package.json` declares `"type": "module"`, so a deployed function is ESM, and Node's ESM resolver does not guess extensions the way CommonJS does. Vercel **transpiles** functions rather than bundling them, so the specifier reaches Node verbatim. The rule covers all of `api/` and any `shared/`→`shared/` **runtime** import; type-only imports erase and are exempt. TypeScript resolves the `.js` specifier back to the `.ts` source, and so does Vite, so the identical form works in the browser build and under Vitest.
- The `@/` alias is declared in `tsconfig.json` and mirrored in `vite.config.ts`. Vite resolves it at bundle time, which is why the client side is unaffected by Vercel's limitation.
- The boundary is enforced by `pnpm typecheck` running **twice**, once per narrowed config — see [`toolchain.md`](./toolchain.md) §2.
- **Server-only helpers live in `api/_lib/`, and cannot live in `shared/`.** That is a hard gate, not a preference: `tsconfig.app.json` supplies only `vite/client` types and includes `shared/`, so a single `process.env` reference there fails `pnpm typecheck:app`. Anything needing env access, a Node API, or knowledge of an upstream wire format belongs under `api/_lib/` — which Vercel does not route, since `_`-prefixed paths are excluded (probe-verified 2026-08-04, see [`agent_findings.md`](./agent_findings.md)). Tests and fixtures sit there too, beside the code they cover. "Just put it in `shared/`" is the obvious wrong move.

Both halves of the `api/`→`shared/` rule are now proven in production, and the extension half was learned the hard way. **Correction to what this section previously claimed:** the 2026-08-03 deploy proved only that the build _succeeded_ — `/api/hello` was never actually requested, and when it finally was (2026-08-04) it returned **500 `FUNCTION_INVOCATION_FAILED`** because of the missing extension. A pair of throwaway probe functions differing only in that extension settled it: extensionless → 500, `.js` → `200 {"maxEmbedTracks":100}`. Full detail in [`agent_findings.md`](./agent_findings.md).

The aliased side has deliberately never been tried on Vercel — per Vercel's own docs it should not be. **Grep for `@/` under `api/` before deploying, and check that every relative import there ends in `.js`.** Neither `typecheck`, `lint`, `test`, `build`, nor `format:check` can see either mistake.

---

## 3. Data flow

### Built today

```
Browser                                  Vercel Function
┌────────────────────┐                   ┌──────────────────────────────┐
│ src/main.tsx       │                   │ api/hello.ts                 │
│   └─ src/App.tsx   │   GET /api/hello  │   imports MAX_EMBED_TRACKS    │
│      (placeholder) │ ─────────────────▶│   from ../shared/constants.js │
│                    │ ◀─────────────────│   returns {ok, message,       │
└────────────────────┘   JSON            │            maxEmbedTracks}    │
                                         └──────────────────────────────┘
```

Playlist ingestion, as built. No caller exists yet — Phase 6 wires the landing page to it:

```
                       GET /api/playlist?url=<any accepted form>
                                    │
                                    ▼
                     ┌──────────────────────────────────────┐
                     │ api/playlist.ts                      │
                     │  · guard method (405 + Allow)        │
                     │  · read `url` (may be string[])      │
                     │  · parsePlaylistUrl()  → shared/     │
                     │  · map error code → HTTP status      │
                     └───────────────┬──────────────────────┘
                                     │ playlist id + global fetch
                                     ▼
                     ┌──────────────────────────────────────┐
                     │ api/_lib/spotify-embed.ts            │
                     │  · GET open.spotify.com/embed/…      │  ──▶ Spotify
                     │    with a browser User-Agent          │      (anonymous)
                     │  · extract <script __NEXT_DATA__>    │  ◀── HTTP 200 HTML
                     │  · BRANCH ON pageProps.state,        │
                     │    NOT on the HTTP status            │
                     │  · assert entity.uri === requested   │
                     │  · normalize trackList → Card[]      │
                     └───────────────┬──────────────────────┘
                                     ▼
        200 {playlist, cards[], truncated, skippedCount}
        + Cache-Control: s-maxage=300, stale-while-revalidate=600
        (edge snapshot cache — no Redis dependency)
```

`api/hello.ts` has no behaviour worth testing. It exists to pin down four things before Phase 2 depends on them: the default-export handler signature, the `@vercel/node` request/response types, the relative `shared/` import, and membership in `tsconfig.api.json`. The `maxEmbedTracks` field in its response is there to prove the shared constant genuinely **resolved and bundled** on the Node side rather than merely type-checking.

### Year resolution — built

```
GET /api/year?title=…&artist=…&durationMs=…
        │
        ▼
┌──────────────────────────────────────┐
│ api/_lib/resolve-year.ts             │
│  1. cleanTrackTitle()                │   "… - Remastered 2011" returns ZERO
│                                      │   results verbatim, so this is mandatory
│  2. cache.get(mbyear:v1:artist|title)│──▶ HIT: return, cached:true
│                                      │        NO gate, NO request
│  3. MISS ▼                           │
└──────────┬───────────────────────────┘
           ▼
┌──────────────────────────────────────┐
│ api/_lib/musicbrainz.ts              │
│  gate.acquire() ─── busy ────────────┼──▶ 429 + retryAfterMs
│  ① recording?query=… AND dur:[±10s]  │──▶ MusicBrainz  (limit=100)
│     └ flatten rec → release → group  │
│  gate.acquire()                      │
│  ② release-group?query=rgid:(a OR b) │──▶ MusicBrainz  (ONE batched call)
│     └ attach first-release-date      │      — the ALBUM's original date
└──────────┬───────────────────────────┘
           ▼
┌──────────────────────────────────────┐
│ shared/year.ts  pickBestRecording()  │
│  strict  → official studio album,    │──▶ high / release-group
│            earliest group date       │
│  relaxed → no group filter,          │──▶ low  / recording
│            recording first-release   │
│  neither → year: null + reason       │──▶ none
└──────────┬───────────────────────────┘
           ▼
   cache.set(…) — ALL THREE outcomes, one TTL per tier (30d / 7d / 1d)
   200 {year, confidence, source?, reason?, cached, cleanedTitle, stripped}
   + Cache-Control tiered by confidence (30d / 1d / 1h)
```

Three orderings in that diagram are load-bearing and easy to "tidy" into bugs. **The cache is read before the gate**, so a replayed deck costs nothing and waits for nothing. **The second MusicBrainz call is batched**, so the request count is two regardless of whether the pool held 12 candidates or 842. **The year comes from the release GROUP's `first-release-date`, never from the release date inlined in the search response** — the latter is the reissue date and is wrong by decades (Billie Jean 2012, Bohemian Rhapsody 2001).

### The client game layer (`src/game/`) — built

Phase 3's whole session lives in one subtree, and only one file in it knows about React:

```
src/game/
  types.ts            GameState, GameAction, PersistedSession. Browser-only, so NOT in shared/
  reducer.ts          Pure. Every transition, plus the derived selectors (currentCard,
                      isCurrentYearPending, cardsRemaining, resolvedCount)
  shuffle.ts          Seeded Fisher-Yates + hashSeed()/mulberry32. Pure, reproducible
  year-client.ts      The only /api/year caller. Maps status + body onto a typed result
  resolver.ts         The sequential crawl: ordering, retries, back-off, priority jump.
                      Framework-free — lookup, sleep and callbacks are all injected
  persistence.ts      The localStorage format, behind an injectable StorageLike
  use-game-session.ts The ONLY React file. Effect wiring, no game logic
```

Three properties of that split are load-bearing:

- **The reducer is pure and the resolver is framework-free**, so both are tested as plain functions with no DOM and no timers of their own. `use-game-session.ts` is deliberately thin enough to go untested — and the rule that keeps that honest is written at the top of the file: any logic accumulating there belongs in the reducer or the resolver instead.
- **`YEAR_RESOLVED` matches by card id, never by index.** The priority jump makes the resolver's order and the deck's order diverge routinely, and a duplicated track (legal in a playlist) must have **every** copy updated, not the first match.
- **`src/game/` is browser code.** It may use DOM APIs and the `@/` alias; nothing under `api/` may ever import it, and `GameState` must not migrate into `shared/types.ts` — see §2.

**The card-1 gate is an invariant of the app, not an implementation detail.** `START` waits for **one** year lookup to _complete_ — where a `null` year is a completed lookup — and never for the deck. Cards 2..n filling in during play is normal, not a loading state. This is the single most likely thing to be "simplified" into a wait-for-everything by someone who only ever tested a playlist whose years were all cached, because a warm deck resolves fast enough to hide the difference. Measured on a real 42-card cold deck (2026-08-05): the gate cleared in **6.06 s**, the full crawl took **153.0 s**. Those two numbers are the whole argument.

### The card UI (`src/components/`, `src/hooks/`) — built

Phase 4's shape is **presentational components driven entirely by props, with the stateful concerns extracted into hooks.** There is no context and no provider: a component receives plain data and callbacks and holds no session knowledge, which is why a test renders one with a fixture card and asserts on the DOM — no session, no network, no provider wrapper. It matches `src/game/`'s own posture, which shipped a hook and explicitly no context.

```
src/components/
  GameScreen.tsx        The integration seam. Owns THE session <audio> element, the
                        stop-on-flip / stop-on-card-change rules, and the window-level
                        keyboard handler. Still presentational: it takes callbacks and
                        does NOT call useGameSession(). Takes `deck` + `currentIndex`,
                        matching GameState's own shape
  CardStack.tsx         The current card over 2 EMPTY backs. Owns AnimatePresence and
                        the keying; calls useCardGestures
  Card.tsx              The 3D flip shell, and the draggable element. Owns no state;
                        both faces live here. NOTHING INTERACTIVE may go inside it
  CardHiddenSide.tsx    The QR code and one line of generic text. Leaks nothing
  CardControls.tsx      [Exit] [Play/Pause] [Restart], BESIDE the card — see below
  CardRevealSide.tsx    Title, artist, and the four-state year slot
  QrCode.tsx            Wraps `qrcode`; async generation with a stale-result guard
  __fixtures__/cards.ts One card per interesting SHAPE. Every component test renders
                        from this, so the shapes are enumerated exactly once
src/hooks/
  useCardAudio.ts       The audio machine: one element, src swapped per card
  useCardGestures.ts    Binds gestures.ts's decisions to Motion's drag callbacks
```

**The three controls are outside the card, and that placement is a bug fix rather than a layout preference.** They were on the hidden face through Phase 4. Phase 5 then made the card tap-to-flip with `gestureProps.onPointerUp` bound to the card's **outer** element — and a pointer-up on a button inside the card bubbles into that handler, where `isTap()` sees exactly what a genuine tap looks like: a few pixels of movement over a couple of hundred milliseconds with no drag recognised. So **pressing Play both started the audio and revealed the answer.** This is the pointer twin of the Space-on-a-focused-button double-action Phase 5 already guarded against for the keyboard, and it was missed because the two halves shipped in different phases: the buttons were harmless until the card became tappable.

It could have been patched with a `closest('button')` check inside the gesture hook. Moving the controls out is the structural fix instead: **there is no interactive element inside the draggable surface at all**, so the class of bug is gone rather than guarded. `CardHiddenSide.test.tsx` and `CardStack.test.tsx` both assert that nothing clickable is in there. The card's face is now the QR code and one line of generic text, which is also the honest shape — the QR is the only part of a hidden card a player is meant to touch, and they touch it with a phone camera.

**One `<audio>` element per session, not per card.** It lives in `GameScreen` and its `src` swaps as the card changes. The rule it enforces — a track never bleeds into the next card and never doubles up on itself — is then structurally impossible to violate rather than a guard that has to be maintained. Phase 5's `CardStack` now renders 3 cards simultaneously, which is precisely the window where per-card elements would overlap and play together — and briefly 4 during an exit animation, since `AnimatePresence` keeps the outgoing card mounted while it leaves.

**The revealed side is NOT MOUNTED while the card is unflipped, and this is an architectural rule rather than a component detail.** `backface-visibility: hidden` is a visual property: it stops a face being painted, and leaves every word of it in the document — where devtools, find-in-page, the accessibility tree and any screen reader still read it. An unflipped card whose reveal side is mounted hands the player the answer through four channels at once. Mounting on flip costs nothing visually (below 90° of rotation the back face is invisible anyway) and turns "the hidden side leaks nothing" into something a test can assert. **It is written down here because the obvious reason to undo it is animation smoothness, which makes it a plausible-looking refactor rather than an obvious regression.** If it is ever undone, that is a product decision about weakening the game's central rule.

Three corollaries, all of them things a leak audit that greps only for visible text would miss:

- **Attributes and accessible names are leak surfaces.** An `aria-label` of "Play Bohemian Rhapsody" leaks to a screen-reader user exactly as body text leaks to an eye, and an `alt` attribute is read aloud and shown when an image fails. Every control name on the hidden side is generic.
- **`durationMs` is as much of a leak as the title.** "3:54" beside a QR code identifies a track, and a playback progress bar is exactly the sort of helpful addition that would introduce it.
- **The OS media session is a leak surface the page cannot claw back.** Setting `navigator.mediaSession.metadata` publishes title and artist to the phone's lock screen and notification shade, where no amount of on-page hiding reaches. Nothing in the app touches it, a test asserts as much, and `useCardAudio.ts` says so in a comment — because it is an omission, and omissions get "fixed".

### The gestures (`src/game/gestures.ts` + `src/hooks/useCardGestures.ts`) — built

Phase 5 splits gestures the same way Phase 3 split the resolver: **a framework-free decision core with a thin React seam.** The reason is specific and worth stating, because the split looks like ceremony otherwise.

**jsdom cannot exercise a drag.** Motion's drag handling reads element geometry — `getBoundingClientRect`, layout boxes, transform matrices — that jsdom does not compute. A simulated pointer sequence in a test therefore asserts that the test double works, not that the gesture does. So every threshold and every comparison lives in `src/game/gestures.ts` as pure functions over numbers, which the node environment tests exhaustively on both sides of every boundary; `useCardGestures` is left thin enough that reading it is sufficient review.

| Lives in                       | What it owns                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/game/gestures.ts`         | `shouldCommitSwipe`, `swipeDirection`, `isTap`, and 5 named threshold constants. No React, no DOM, no Motion |
| `src/hooks/useCardGestures.ts` | Refs for pointer state, Motion's drag props, the commit latch. Returns `gestureProps` + `exitDirection`      |
| `src/components/CardStack.tsx` | Calls the hook (it is where `exitDirection` is consumed), owns `AnimatePresence` and the keys                |
| `src/components/Card.tsx`      | Spreads `gestureProps` onto its outer `motion.div`; owns its own exit variant                                |

Four things about this are load-bearing:

- **A tap and a drag begin with the identical pointer event, and both misreadings are destructive.** A tap misread as a swipe skips a card _irrecoverably_ — the deck is one-directional and there is no previous card. A swipe misread as a tap reveals the answer the player was mid-guess on. This is why `isTap` requires four independent signals to agree, and why the tap radius and the commit distance are asserted not to overlap.
- **The drag transform and the flip transform are on different elements, and must stay that way.** Both are CSS transforms on the same box if they share an element: Motion writes `translateX` from the drag while Tailwind's `rotate-y-180` writes its own, and the last writer wins. Drag on the outer element, rotation on the inner face wrapper.
- **The stacked backs are empty divs — no content, no QR, no id, no `aria-label`.** Both a leak decision (a card behind the top one has no reason for its data to be in the document; the next card is supposed to be a mystery) and a cost decision (each QR is an async `toDataURL()`, and Phase 7 lazy-loads it precisely because it is not free). `CardStack.test.tsx` asserts against the "just reuse `Card` for the backs" refactor.
- **`AnimatePresence` keys are card id _plus_ deck index.** A playlist may legitimately hold the same track twice — Phase 3's reducer handles duplicate ids explicitly for that reason — so two adjacent cards can share an id, and a bare-id key makes React reuse one element for both.

**Keyboard controls are a window-level handler in `GameScreen`, not a handler on a focused card.** The card is not a control and nobody's hands are on it; a focus-dependent handler would be dead most of the time, and "the keyboard works only after you click the card first" is indistinguishable from broken. The cost is that the handler sees keystrokes meant for other things, hence four guards — auto-repeat, text-entry focus, `isPlayable`, and **Space while focus is on a button**, which would otherwise make one press both activate Play/Pause and flip the card.

**The gesture thresholds have never met a thumb.** Real-device verification on iOS Safari and Android Chrome was scoped for Phase 5 and then **deliberately not performed** (decided 2026-08-05). The constants in `gestures.ts` are documented starting guesses, and they are the first thing to look at if touch input misbehaves in the field. See `docs/development.md` §8 Known limitations.

### The game flow screens (`src/App.tsx` + the screens) — built

Phase 6 closed the loop: there is now a real container, a real client, and four screens.

```
src/App.tsx             THE container. The only caller of useGameSession(). Switches
                        on state.status; holds the ended-destination flag and the
                        notice-dismissal state. No router
src/components/
  LandingScreen.tsx     URL input, inline validation, 5 suggested playlists
  PreparingScreen.tsx   The card-1 gate. COUNT-ONLY
  Hud.tsx               Cards remaining + playlist name. Counts only, no Exit
  NoticeBanner.tsx      truncated / skippedCount / yearLookupsUnavailable
  EndScreen.tsx         Cards played, Play again, New playlist
src/game/
  playlist-client.ts    /api/playlist client. Injected fetch, never throws
  messages.ts           One error-code → copy map. The server's `message` is unused
src/hooks/
  usePlaylist.ts        Thin request state over the client; aborts in flight
```

**The playlist client mirrors `year-client.ts` exactly** — a plain async function with an injected `fetch`, an injected abort signal, and a discriminated result that never throws — with a thin `usePlaylist` hook over it. That is what lets every status branch be a unit test in the **node** environment with no jsdom and no network, which is the same trade `year-client.ts` made for its own sixteen. Anything that accumulates in the hook instead belongs in the client.

Three things in the client are not obvious:

- **502 is deliberately absent from its status-fallback table.** `upstream-unavailable` and `unexpected-payload` both map to 502 and mean opposite things — transient versus "the scrape broke". Only the body's `code` separates them, so a bodyless 502 degrades to a code whose copy promises nothing rather than guessing one of two opposite diagnoses.
- **A 200 whose body is not JSON is `unexpected-payload`, and that is the `pnpm dev` case.** Vite serves `api/playlist.ts` as a transpiled module with status 200, so anyone running `pnpm dev` instead of `npx vercel dev` hits exactly this on their first Start.
- **The deck is validated card by card**, unlike the year client's single result: `START` shuffles this array and every card in it reaches a render, so one malformed entry would surface as a blank card mid-game, a long way from its cause. An empty deck is rejected outright.

**Four statuses, four screens, no router.** `GameState.status` already models exactly `idle` / `preparing` / `playing` / `ended`, one per screen. A router would add a dependency plus a second source of truth to keep in sync — and a browser Back mid-deck is a transition the reducer never modelled, so the two would disagree the first time anyone pressed it.

**Exit and deck-exhaustion are indistinguishable in `GameState`, so the container carries the distinction.** Both produce `status: 'ended'` and `currentIndex` cannot separate them either — an Exit on the last card looks identical to finishing. A container-local flag resolves it rather than an `endReason` field on `GameState`, which keeps Phase 3's reducer, types, persistence format and tests untouched for what is purely a presentation question. It is phrased as a **destination** (`'end-screen' | 'landing'`) rather than as a reason, because "New playlist" from the end screen also has to reach the landing screen and the reducer has no action that returns `ended` to `idle` — deliberately, since there is nothing to un-end.

**Every pre-reveal surface is count-only.** The landing screen, the preparing screen, the HUD and the notices all report numbers and never a title, artist or year. The preparing screen is the one most easily forgotten — "Looking up Bohemian Rhapsody…" is the natural, helpful thing to write, and it spoils the first card before the game starts. Each of those four components has a leak assertion in its own test file, and none of them takes a `Card` at all.

```
Browser (SPA)                          Serverless (Vercel Functions)
┌──────────────────────┐               ┌─────────────────────────────────┐
│ Paste URL → Start    │──────────────▶│ /api/playlist          [built]  │
│  · client-side parse │◀──────────────│  · resolves spotify.link first  │
│  · playlist-client   │  normalized   ├─────────────────────────────────┤
│ progressive fill     │──────────────▶│ /api/year  (one per track)      │
│ (start on card 1)    │◀──────────────│                        [built]  │
│  · back off on 429   │  year          │  · 1 req/s gate + cache        │
├──────────────────────┤               └─────────────────────────────────┘
│ shuffle (seeded)     │  [built]                     ↓
│ localStorage resume  │  [built]            Upstash Redis (year cache)
│ flip / swipe / audio │  [built]
│ 4 screens, no router │  [built]
└──────────────────────┘
```

**Why a serverless backend at all**, when the game is pure client-side:

1. **CORS** — the Spotify embed endpoint cannot be fetched from the browser.
2. **`User-Agent`** — MusicBrainz requires a descriptive one and browsers cannot set that header. It also rate-limits to 1 req/s.
3. **Shared cache** — a year cache across all users makes repeat playlists instant.

**Why progressive loading is structural, not polish:** a lookup costs two paced MusicBrainz requests, so a cold 100-track playlist takes **~3-5 minutes** — measured 1.3-3.6 s per track on 2026-08-04, against a warm cache 0 ms. Years resolve in the background, the game starts as soon as **card 1** is ready, and it only blocks if the player outruns the resolver. Two invariants fall out of that, both easy to violate without any test failing: **shuffle runs before resolution** (so the resolver walks the deck in play order and card 1 is genuinely the card the player sees first), and the resolver is a **sequential loop, not a fan-out** — a `Promise.all` over 100 cards turns the shared 1 req/s gate into ~99 429s. See [`plans/plan.md`](./plans/plan.md) §1 and §3.

---

## 4. External dependencies

| Service                                                 | Access                          | Auth                 | Notes                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spotify embed (`open.spotify.com/embed/playlist/{id}`)  | Server-side `fetch` **[built]** | **None** — anonymous | Unofficial. Parse `<script id="__NEXT_DATA__">`; tracks at `props.pageProps.state.data.entity.trackList`. All of it confined to `api/_lib/spotify-embed.ts`. **A missing playlist returns HTTP 200** — branch on `pageProps.state` |
| MusicBrainz (`/ws/2/recording` + `/ws/2/release-group`) | Server-side `fetch` **[built]** | `User-Agent` string  | 1 req/s, globally across all users. **Two** requests per lookup — a search plus one batched release-group call. All of it confined to `api/_lib/musicbrainz.ts`                                                                    |
| Upstash Redis                                           | REST **[built]**                | URL + token          | Production only, and **optional everywhere**: backs both the year cache and the 1 req/s gate, with per-instance fallbacks locally                                                                                                  |

### There are no Spotify credentials, and none are needed

Not in `.env.example`, not in Vercel. Spotify's February 2026 Web API changes mean **no credentialed path can serve "anyone with a public link"**: Client Credentials can no longer read playlist `items`, and new Development Mode apps are capped at 5 invited users. The app therefore reads the public embed endpoint with no login at all.

If you are about to add a `SPOTIFY_CLIENT_ID`, read [`plans/plan.md`](./plans/plan.md) §2 first — **the constraint is a product decision, not an oversight.**

### Why the year comes from MusicBrainz and not Spotify

Spotify reports the _album edition's_ date, which turns a 2011 remaster of Bohemian Rhapsody into a 2011 song. MusicBrainz's earliest release date for a recording is exactly the value Hitster needs. This makes year resolution a **core component**, not an enrichment pass.

Phase 0 measured that a naive "top-scored recording" lookup is **~6% accurate** (1 of 18 tricky tracks), because MusicBrainz has no canonical recording per song — every bootleg, live take, and reissue is its own entity, and dozens tie at the maximum relevance score. The verified fix is to bias the candidate pool toward `release-group` entries with `primary-type: Album`, no Live/Compilation/Remix/DJ-mix `secondary-types`, and release `status: Official`. Two hard constraints on implementing it:

- **Titles must be stripped** of `- Remastered YYYY` / `- Remaster` / `- Live` / `(feat. X)` suffixes before querying. Remaster-suffixed titles returned **zero** results in every case tested — mandatory, not an optimization.
- **The fix must not depend on the album name.** The embed endpoint carries no album name at track level, so filtering must use MusicBrainz-side signals only.

As built, the filter is that fix plus three things Phase 0 did not have, all measured on 2026-08-04 and all necessary to reach **14 of 14** on the known-tricky set:

- **The year comes from the release group's `first-release-date`, not the release date the search inlines.** A release group holds every pressing; the search returns whichever one matched, which is nearly always a reissue. This is what the second request buys.
- **`limit=100` and a `dur:[±10s]` bound on the query.** MusicBrainz ties dozens of candidates at the maximum score and orders them arbitrarily, so the original recording is often not on page one. At `limit=25` the same algorithm scores 2 of 13; the duration bound shrinks most pools below 100 outright.
- **The filters run client-side, never in the Lucene query.** Pushing `primarytype:album AND status:official` into the query looks like the obvious optimisation and returns **zero** results for Hallelujah / Leonard Cohen.

**Three confidence tiers, not one answer.** The strict pass reports `high`. When it finds nothing — 1 track in 14, always a huge candidate pool — a relaxed pass drops the release-group filters and reports `low`, which Phase 6 marks as unconfirmed on the card's revealed side. Only when that also fails does a card get `year: null` for manual entry. There is **no Spotify-year fallback**; the embed payload has no release date at track level, and earlier drafts of this file said otherwise in error.

**Cache keys carry a `v1` schema segment** (`mbyear:v1:{artist}|{title}`) precisely so a change to any of the above can invalidate every previously cached year in one edit. Without it, improved scoring would be masked indefinitely by entries computed under the old logic.

Full measurements are in [`plans/plan.md`](./plans/plan.md) §5 Phase 0 and [`agent_findings.md`](./agent_findings.md) (2026-08-04).

---

## 5. Local execution model, and a trap

`pnpm dev` starts Vite, which serves `index.html` and everything under `src/`. It has no concept of Vercel Functions, so **`api/` is not executable through it** — and what happens instead is actively misleading.

Vite treats any file under the project root as a transformable module, so `GET /api/hello` returns the **transpiled source** of `api/hello.ts` as `text/javascript`, with an inline sourcemap and a **`200` status**. It does not run the handler and does not fall through to the SPA. Three consequences:

1. A `200` from the Vite dev server is **not** evidence a function works.
2. `fetch('/api/…')` in dev fails at JSON parsing rather than 404-ing — easy to misread as a broken function.
3. **`api/` source is readable over the dev server**, so secrets belong in environment variables, never in that source.

Since Phase 6 this has a **player-visible shape**, not just a developer-visible one: the app is unplayable under `pnpm dev`, because pressing Start returns the transpiled source of `api/playlist.ts` with status 200. `playlist-client.ts` turns that into `unexpected-payload`, so what a developer actually sees is the inline message _"Spotify returned something we could not read. This is a problem on our side"_ — which is true, and is not the same sentence as "you are running the wrong dev server". **Use `npx vercel dev` to play the game.**

Use `vercel dev` (port 3000) to exercise functions for real. See [`development.md`](./development.md) §4.

---

## 6. Routing and deployment topology

`vercel.json` declares the build command, the `dist` output directory, and one rewrite:

```json
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

An SPA needs a catch-all rewrite so unmatched paths return `index.html` and client-side routing works. A naive catch-all (`/(.*)`) would swallow the API routes too — a request to `/api/playlist` would receive the HTML shell instead of reaching the function. The negative lookahead `(?!api/)` makes the rewrite skip everything under `/api/`, leaving those paths to the functions.

`vercel.json` must be strict JSON and cannot carry comments, which is why this rationale lives here.

---

## 7. Planned components

Everything below is **not built**, except where a row says otherwise. The authoritative source for what belongs in which phase is [`plans/plan.md`](./plans/plan.md) §5 — **do not build ahead of the current phase.**

| Phase | Adds                                                                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | ~~`parsePlaylistUrl()`, `/api/playlist`, `/api/year`, the `YearCache` interface, the 1 req/s gate, year-resolution logic~~ **[built] — phase complete**                                                                                                                                                        |
| 3     | ~~`GameState`, reducer, seeded Fisher–Yates shuffle, localStorage resume, progressive loading~~ **[built] — phase complete**, in `src/game/` (see §3). `Card` was never widened with game state                                                                                                                |
| 4     | ~~Card component with CSS 3D flip, QR rendering, `previewUrl` + `<audio>` playback~~ **[built] — phase complete** (see §3), plus the jsdom + Testing Library test environment                                                                                                                                  |
| 5     | ~~Swipe-to-next, tap-to-flip, stacked-deck visuals, keyboard controls~~ **[built] — phase complete** (see §3), with real-device touch verification deliberately not performed                                                                                                                                  |
| 6     | ~~Landing page, suggested playlists, loading state, HUD, end screen, notices, the real `App.tsx` container~~ **[built] — phase complete** (see §3). The reveal-side unconfirmed-year marking shipped early, in Phase 4's year slot. Only the real-deployment verification of progressive loading is still owed |
| 7     | Visual design, `@theme` design tokens, error/offline states, responsive, a11y, Lighthouse                                                                                                                                                                                                                      |
| 8     | Out of v1: shareable deck URL, PWA, PDF export, difficulty filters, multiplayer scoring                                                                                                                                                                                                                        |

**Every installed dependency now has an importer.** Phase 1 deliberately installed `motion` and `qrcode` with none, so one coherent dependency tree could be locked up front. `qrcode` acquired its importer in Phase 4 — `src/components/QrCode.tsx`, which imports it **by name** (`import { toDataURL }`), because `@types/qrcode` declares named exports only and this repo runs `verbatimModuleSyntax` without `esModuleInterop`. `motion` acquired its first two in Phase 5: `Card.tsx` (`motion`) and `CardStack.tsx` (`AnimatePresence`), both from the `motion/react` subpath.

One trap in `motion@12`, found the hard way: **`PanInfo` — the type of the `info` argument Motion hands `onDragEnd` — is not importable.** `motion` re-exports `framer-motion`, which does _not_ re-export `PanInfo`; it lives in `motion-dom`, a **transitive** dependency absent from `package.json`, which pnpm's strict linking is right to make awkward to reach. `useCardGestures.ts` therefore declares `DragEndInfo` and `GesturePointer` locally as structural **supertypes** of what Motion passes (strictly fewer required fields), which parameter contravariance makes soundly assignable — verified by the compiler at the `Card` call site. Side benefit: the hook's signature carries no Motion types at all. Do not "fix" this by adding `motion-dom` to `package.json`.

### Design decisions already locked by Phase 0

- **In-app audio uses `previewUrl` + `<audio>`**, not the Spotify iFrame API. Preview coverage measured **398/400 tracks (99.5%)**. The iFrame API is disqualified on Terms-of-Service grounds: Spotify's embed terms forbid obfuscating or altering the widget, which is exactly what a hidden/covered iframe does.
- **Do not set `navigator.mediaSession.metadata`** on the audio element — it would leak title and artist to the OS lock screen, defeating the hidden side of the card.
- **The QR code is always rendered**, regardless of whether audio or metadata extraction works, so the deck degrades rather than dies.
- **The embed endpoint caps at 100 tracks with no pagination signal** — no total, no offset, no `hasMore`. `shared/constants.ts` encodes this as `MAX_EMBED_TRACKS`. A response of exactly 100 is indistinguishable from a playlist that genuinely holds 100, so Phase 6 shows a non-blocking warning rather than silently presenting an incomplete deck. A manual-paste fallback is deferred past v1.
