# Architecture

Custom Hitster is a **client-heavy single-page app with a thin serverless backend**. The game itself — shuffle, flip, swipe, audio, progress — runs entirely in the browser. The backend exists only to do the three things a browser cannot: reach a CORS-blocked endpoint, set a custom `User-Agent`, and hold a cache shared across all users.

> **Implementation status: Phases 1–7 complete — the app is playable end to end, has a design surface, and fails legibly.** All three functions (`/api/hello`, `/api/playlist`, `/api/year`), the year cache, the client-side game layer (`src/game/`), the card UI, the gestures, and the game flow screens (landing, preparing, HUD, notices, end screen) plus the real `src/App.tsx` container all exist today. So does the **token layer** — `@theme` tokens, fluid card geometry, `prefers-reduced-motion`, focus states and the ARIA/contrast fixes ([`plans/plan.phase-7-look.md`](./plans/plan.phase-7-look.md)) — and the **failure surface**: the `offline` and `empty-playlist` codes, the collapsed-deck redirect, the error boundary, and the two chunk splits ([`plans/plan.phase-7-robustness.md`](./plans/plan.phase-7-robustness.md)). **Nothing in Phase 8 is built or planned.** Sections below are marked **[built]** or **[planned]** throughout; planned shapes come from [`plans/plan.md`](./plans/plan.md) §3 and are recorded here because they determine where new code belongs, not because they exist.
>
> **One thing is owed rather than planned:** progressive loading has never been verified against a real deployment (step 15 of [`plans/plan.phase-4-6-screens.md`](./plans/plan.phase-4-6-screens.md)). See [`development.md`](./development.md) §8.
>
> **One caveat carried forward from Phase 5, and Phase 7 sharpened it:** the gesture thresholds have never been verified on a real touch device — and now that the card is fluid, `SWIPE_COMMIT_DISTANCE_PX` is a third of its width at the ceiling and over half at the floor. See [§3 The gestures](#the-gestures-srcgamegesturests--srchooksusecardgesturests--built) and `docs/development.md` §8 Known limitations.
>
> **One caveat new in Phase 7:** none of the reduced-motion, responsive or screen-reader behaviour can be verified by any test in this repo — jsdom evaluates no media queries and has no `window.matchMedia` at all. What is automated is both ends of each contract; the middle is a manual pass. See §3 The token layer and `docs/development.md` §5.

---

## 1. Components

| Component            | Technology                         | Location                        | Status                                                    |
| -------------------- | ---------------------------------- | ------------------------------- | --------------------------------------------------------- |
| Browser SPA          | Vite 8 + React 19 + Tailwind CSS 4 | `src/`                          | **[built]** container, 4 screens, gestures, token layer   |
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
  ── Phase 8 (2026-08-06) ─────────────────────────────────────────────────────
  deck-link.ts        Parse/build for the share URL. Strings in, strings out — no
                      window, no location, no history
  playlist-library.ts The saved-playlist store. persistence.ts's pattern, second key
  pdf-sheet.ts        Printable-sheet geometry: the grid, the margins, the DUPLEX
                      COLUMN MIRROR, and the printable-card selection
  pdf-text.ts         WinAnsi sanitising for a standard PDF font, plus the filename
  qrcode-loader.ts    The one memoized import('qrcode'), shared by QrCode and the export
  qr-cache.ts         Generated codes by size+url, so the deck's preloaded QR survives the
                      element that generated it. Read during RENDER, not in an effect
```

Three properties of that split are load-bearing:

- **The reducer is pure and the resolver is framework-free**, so both are tested as plain functions with no DOM and no timers of their own. `use-game-session.ts` is deliberately thin enough to go untested — and the rule that keeps that honest is written at the top of the file: any logic accumulating there belongs in the reducer or the resolver instead.
- **`YEAR_RESOLVED` matches by card id, never by index.** The priority jump makes the resolver's order and the deck's order diverge routinely, and a duplicated track (legal in a playlist) must have **every** copy updated, not the first match.
- **`src/game/` is browser code.** It may use DOM APIs and the `@/` alias; nothing under `api/` may ever import it, and `GameState` must not migrate into `shared/types.ts` — see §2.

**Phase 8's four new modules are here rather than in a component or a hook for one reason each, and the reason is always "what could not otherwise be tested".** `deck-link.ts` takes a query STRING instead of reading `location`, so its rejection cases are node tests rather than jsdom ones. `playlist-library.ts` takes an injected `StorageLike`, exactly as `persistence.ts` does, so a corrupt-payload test is a three-line stub. `pdf-sheet.ts` holds every millimetre as arithmetic over numbers because **getting the duplex mirror wrong pairs every card with the wrong answer and is discoverable only by printing and cutting** — the same decision/binding split as `gestures.ts` and `resolver.ts`, applied a third time. `pdf-text.ts` is string rules, and string rules in a hook are string rules nothing covers. The binding halves are `App.tsx` (the link), `EndScreen.tsx` (the two buttons) and `src/hooks/usePdfExport.ts` (the imports, the QR loop, the download).

**The card-1 gate is an invariant of the app, not an implementation detail.** `START` waits for **one** year lookup to _complete_ — where a `null` year is a completed lookup — and never for the deck. Cards 2..n filling in during play is normal, not a loading state. This is the single most likely thing to be "simplified" into a wait-for-everything by someone who only ever tested a playlist whose years were all cached, because a warm deck resolves fast enough to hide the difference. Measured on a real 42-card cold deck (2026-08-05): the gate cleared in **6.06 s**, the full crawl took **153.0 s**. Those two numbers are the whole argument.

### The card UI (`src/components/`, `src/hooks/`) — built

Phase 4's shape is **presentational components driven entirely by props, with the stateful concerns extracted into hooks.** There is no context and no provider: a component receives plain data and callbacks and holds no session knowledge, which is why a test renders one with a fixture card and asserts on the DOM — no session, no network, no provider wrapper. It matches `src/game/`'s own posture, which shipped a hook and explicitly no context.

```
src/components/
  GameScreen.tsx        The integration seam. Owns THE session <audio> element, the
                        stop-on-card-change rule (the ONLY one since 2026-08-06 — see
                        below), and the window-level keyboard handler. Still
                        presentational: it takes callbacks and
                        does NOT call useGameSession(). Takes `deck` + `currentIndex`,
                        matching GameState's own shape
  CardStack.tsx         The current card over ONE back, which is the next card's HIDDEN
                        face at the same size, exactly behind. Owns AnimatePresence and
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

**The four controls are outside the card, and that placement is a bug fix rather than a layout preference.** They were on the hidden face through Phase 4. Phase 5 then made the card tap-to-flip with `gestureProps.onPointerUp` bound to the card's **outer** element — and a pointer-up on a button inside the card bubbles into that handler, where `isTap()` sees exactly what a genuine tap looks like: a few pixels of movement over a couple of hundred milliseconds with no drag recognised. So **pressing Play both started the audio and revealed the answer.** This is the pointer twin of the Space-on-a-focused-button double-action Phase 5 already guarded against for the keyboard, and it was missed because the two halves shipped in different phases: the buttons were harmless until the card became tappable.

It could have been patched with a `closest('button')` check inside the gesture hook. Moving the controls out is the structural fix instead: **there is no interactive element inside the draggable surface at all**, so the class of bug is gone rather than guarded. `CardHiddenSide.test.tsx` and `CardStack.test.tsx` both assert that nothing clickable is in there. The card's face is now the QR code and one line of generic text, which is also the honest shape — the QR is the only part of a hidden card a player is meant to touch, and they touch it with a phone camera.

**The deck actions are reachable mid-game, and the modal is what makes that safe** (reversal of half of plan 2's decision 7, 2026-08-06). The share link, the save and the PDF export used to be on the end screen and **nowhere else** — and the only way to reach the end screen is to **end the game**, which clears the saved session and cannot be undone. So copying a link cost the player their deck. `CardControls` now has a fourth button that opens `DeckActionsDialog`, which mounts the same `DeckActions` the end screen renders.

Decision 7's two objections are answered rather than dropped. **The spoiler objection** is answered by `DeckActions` itself: it takes the deck (the PDF needs it) and renders only counts — `completed/total`, an excluded **count**, a sheet count — with no title, artist or year in text or in an attribute, asserted against the whole fixture deck in three files. **The swipe objection** is answered by where it mounts: the dialog's backdrop covers the card, and `GameScreen`'s guard 4 suspends its window key handler while it is open, so a → cannot deal a card behind it. Guard 4 is now an **OR over two flags**, and a third dialog must be added to it. Nothing interactive was added inside `Card`, so the Phase 5 tap-is-a-flip class of bug stays structurally impossible.

The cost was measured on 2026-08-06: **+4.8 kB gzip on the initial path**, because `DeckActions` becomes a chunk shared between `index` (via `EndScreen`, which is eager) and the lazy `GameScreen` chunk instead of living inside `index`. The alternative was duplicating the component, which is worse for a surface whose leak rules have to hold identically in both places.

**Audio survives the flip, and stops on exactly two things: the card changing, and a confirmed Exit** (reversal of a Phase 4 decision, 2026-08-06). Phase 4 also stopped it on the flip — "once the answer is on screen the preview has no job left" — and playing the game disagreed: **hearing the song while reading the year is the point of the reveal.** The bleed case that rule also cited was already covered by the card-change effect, which keys on `currentCard.id` (so a duplicated track in the deck is covered too) and fires before the new `src` is set — and which is also what makes a swipe stop the audio, so `useCardGestures` still knows nothing about audio. The effect was therefore **deleted with nothing put in its place**; `CardControls` is outside the card, so Play/Pause stays reachable during the reveal for a player who does want silence. `GameScreen.test.tsx` asserts the **non**-stop, because "surely it should stop on flip" is the obvious thing to re-add.

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
- **The back is ONE card, the next one, and it renders its HIDDEN face and nothing else — reversed 2026-08-06.** It used to be two empty divs, centre-scaled to 96% / 92% and offset 10px, and that produced "two cards, one inside the other" the moment a drag uncovered them: a centre-origin `scale()` insets every edge, so what showed was two concentric rectangles smaller than the card. It is now `absolute inset-0` with **no transform** — covered pixel for pixel at rest, and revealed complete, with its QR already generated, the instant the top card moves. **The leak rule is unchanged and still asserted:** the back mounts `CardHiddenSide`, `CardStack` does not import `CardRevealSide`, and no title, artist or year reaches the document a card early in text or in any attribute. The track **id** does, because the QR encodes it — accepted deliberately: 22 opaque characters, on a face that is a mystery by construction, for the card the player is in the act of dealing themselves. The cost is one extra `toDataURL()` per advance, which is the feature. `CardStack.test.tsx` still asserts against the "just reuse `Card` for the back" refactor, because `Card` mounts a reveal face.
- **A generated QR outlives the element that generated it (`src/game/qr-cache.ts`).** Without it the preload buys nothing: the back is a plain div in `CardStack` and the front card is a `Card` inside `AnimatePresence`, so an advance unmounts the element holding the code and mounts a new one. The cache is read **during render** rather than in an effect, because `useEffect` runs after paint and would still show one frame of the placeholder. Test consequence: every DOM test file that renders a card calls `clearQrCache()` in `beforeEach` — Vitest isolates modules per file, not per test.
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
  LandingScreen.tsx     URL input, inline validation, 9 suggested playlists, and
                        "Your playlists" — the saved library, above the suggestions
  PreparingScreen.tsx   The card-1 gate. COUNT-ONLY
  Hud.tsx               Cards remaining + playlist name. Counts only, no Exit
  NoticeBanner.tsx      truncated / skippedCount / yearLookupsUnavailable
  EndScreen.tsx         Cards played, Play again, Home — plus <DeckActions>
  DeckActions.tsx       The three things a deck can become: a link, a saved playlist,
                        a PDF. SHARED — the game screen mounts it too. Counts only
  DeckActionsDialog.tsx The game screen's modal shell around it. Backdrop, Escape,
                        focus cycle. Mounts over an unflipped card, so: no card data
src/game/
  playlist-client.ts    /api/playlist client. Injected fetch, never throws
  messages.ts           One error-code → copy map. The server's `message` is unused
src/hooks/
  usePlaylist.ts        Thin request state over the client; aborts in flight
  usePdfExport.ts       The export's binding half: import('jspdf'), the QR loop,
                        progress, the download
```

**The playlist client mirrors `year-client.ts` exactly** — a plain async function with an injected `fetch`, an injected abort signal, and a discriminated result that never throws — with a thin `usePlaylist` hook over it. That is what lets every status branch be a unit test in the **node** environment with no jsdom and no network, which is the same trade `year-client.ts` made for its own sixteen. Anything that accumulates in the hook instead belongs in the client.

Three things in the client are not obvious:

- **502 is deliberately absent from its status-fallback table.** `upstream-unavailable` and `unexpected-payload` both map to 502 and mean opposite things — transient versus "the scrape broke". Only the body's `code` separates them, so a bodyless 502 degrades to a code whose copy promises nothing rather than guessing one of two opposite diagnoses.
- **A 200 whose body is not JSON is `unexpected-payload`, and that is the `pnpm dev` case.** Vite serves `api/playlist.ts` as a transpiled module with status 200, so anyone running `pnpm dev` instead of `npx vercel dev` hits exactly this on their first Start.
- **The deck is validated card by card**, unlike the year client's single result: `START` shuffles this array and every card in it reaches a render, so one malformed entry would surface as a blank card mid-game, a long way from its cause. An empty deck is rejected outright.

**Four statuses, four screens, no router.** `GameState.status` already models exactly `idle` / `preparing` / `playing` / `ended`, one per screen. A router would add a dependency plus a second source of truth to keep in sync — and a browser Back mid-deck is a transition the reducer never modelled, so the two would disagree the first time anyone pressed it.

**Exit and deck-exhaustion are indistinguishable in `GameState`, so the container carries the distinction.** Both produce `status: 'ended'` and `currentIndex` cannot separate them either — an Exit on the last card looks identical to finishing. A container-local flag resolves it rather than an `endReason` field on `GameState`, which keeps Phase 3's reducer, types, persistence format and tests untouched for what is purely a presentation question. It is phrased as a **destination** (`'end-screen' | 'landing'`) rather than as a reason, because "Home" from the end screen also has to reach the landing screen and the reducer has no action that returns `ended` to `idle` — deliberately, since there is nothing to un-end. That phrasing is also why renaming the button from "New playlist" to "Home" on 2026-08-06 touched no state: the flag was already named after where the press **goes** rather than after what the player was assumed to want next.

**An `ended` session with an EMPTY deck is not a finished game, and the container sends it back to the landing screen.** A card whose year lookup finds nothing is removed from the deck, so a playlist MusicBrainz knows nothing about drains to zero and the reducer answers `ended` — correctly, since there is nothing to play. Until Phase 7 that reached the end screen, which read **"Deck finished"** over `cardsPlayed={0}`: a completed game announced to somebody who never saw a card, with no explanation. `App.tsx` now derives `deckCollapsed` from `status === 'ended' && deck.length === 0` and renders the landing screen with a `no-years-found` warning instead.

The condition is exact rather than approximate: **every other route to `ended` leaves the played cards in the deck** — natural exhaustion stops on the last card and Exit does not empty it — so an empty deck at `ended` can only mean there was never anything to play. It is checked **before** `endedView`, which is still `'end-screen'` from the `START` that dealt the deck and is not a destination the player chose. All three of the reducer's empty-deck exits land there: `YEAR_RESOLVED` (the common one), `START` with nothing dealable, and `RESUME` of a pre-reversal save whose every card was yearless. Derived in the container rather than added to `GameState` for the same reason `endedView` is, above.

**The landing screen's message slot takes a union wider than the HTTP client's, and the widening is deliberate.** `messages.ts` owns `StartFailureCode = PlaylistClientErrorCode | 'no-years-found'`. The extra code is produced by the session, not by a fetch, and it is **not** added to `PlaylistClientErrorCode` because that union is the set of things `fetchPlaylist` returns and its tests enumerate exactly that — widening it would make the client's own type claim a code it cannot produce. Widening the copy map is the honest direction: "why you cannot play this playlist" is one question with one answer slot, not two, so there is no second notice channel and no fifth view. The `Record<StartFailureCode, string>` still makes shipping a code without copy a typecheck failure.

**The offline check is injected, not read from `navigator`.** `fetchPlaylist` takes an optional `isOnline: () => boolean` defaulting to `isBrowserOnline()`, and short-circuits **before** the fetch — a request that cannot succeed is not made, so the player is told immediately instead of watching a spinner time out. It is injected for the property that makes both clients cheap to test: every status branch is a **node** unit test with no jsdom, and a bare global read would trade that away for one boolean. `network` stays as a separate code because `navigator.onLine` reports a network _interface_ rather than reachability — a captive portal reports online and still fails.

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

### Sharing, saving and printing (Phase 8) — built

Three features that add to the app without changing how a game is played, and all three are **caller changes**: the reducer, `GameState` and the persistence format are untouched.

```
                    ?playlist=<id>&seed=<16 hex>
                                │  read ONCE, in a lazy state initialiser
                                ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ App.tsx                                                        │
  │  · a saved session OUTRANKS a link → resume, ignore params     │
  │  · otherwise: request(spotifyPlaylistUrl(id)) — the SAME       │
  │    fetch path the landing form uses                            │
  │  · the seed rides in a REF into start(cards, playlist, seed)    │
  │  · the address bar is never touched: no pushState              │
  └───────────────────────────────────────────────────────────────┘

  hitster:session:v1   one resumable game        (persistence.ts)
  hitster:library:v1   ≤20 saved playlists       (playlist-library.ts)
                       id + name + savedAt only
```

**The link is (playlist id + seed) and nothing more, which `GameState.seed`'s own comment predicted:** the seed is accepted as an override on `START`, so this is a caller change rather than a reducer change. Query params rather than a hash fragment — a hash is marginally more private but is mangled by some chat clients, and this is a link people paste into WhatsApp.

**It promises "same playlist, same shuffle", never "the same deck", and that is a copy decision standing in for an encoder.** The seeded shuffle is exact; its INPUT is not, for two independent reasons — a card whose year lookup finds nothing is removed from the deck, and which cards those are depends on what MusicBrainz answers at play time; and an editorial playlist has its tracks refreshed by Spotify. The only encoding that could pin the card set is a versioned opaque token carrying every id, at the cost of an unreadable link. The end screen's caption says so, and `EndScreen.test.tsx` asserts that the phrase "same deck" is absent.

**A saved session outranks a link**, because opening an old link must not silently discard a game in progress. `useGameSession`'s own lazy initialiser has already run when `App` reads the params, so `state.status === 'idle'` is exactly "there was nothing to resume".

**A malformed link is `null`, and `null` is the plain landing screen with no error.** Someone whose chat client ate half a URL is a visitor, not a failure state. The playlist id is validated through `shared/spotify-url.ts` — reuse, so a link is judged by the same code the form and `api/playlist.ts` use — and the seed is bounded to `generateSeed`'s own 16-hex alphabet, because an accepted seed is hashed and then **persisted**.

**The library stores playlists, not sessions** (id, name, timestamp; deduped, capped at 20). The alternative — generalising the session key into a keyed collection of full mid-game decks — reopens persistence validation, `RESUME` and the localStorage quota, and makes the known two-tab clobber materially worse. There is still exactly one resumable game. The store is read on the **landing screen**, which is a pre-start surface, so it is rebuilt field by field on the **write** as well as on the read: `SavedPlaylist` is a structural interface and TypeScript's excess-property check does not fire for a spread, so a caller passing something larger would otherwise put track data one devtools panel away from a player who has not started.

**Both keys share the two-tab hazard `plan.md` §6 already accepts.** Last write wins; a `storage`-event guard remains the fix if it ever bites, and v1 does not build one.

**The PDF prints on a light palette regardless of the screen's**, which is the one place the print path deliberately ignores the `@theme` layer. Two reasons, and the second is the real one: ink cost, and **a QR scans as dark modules on a light field with a quiet zone** — inverting or tinting it is how a printed deck fails at the one job the QR has. The geometry is in millimetres and answers to A4 and a pair of scissors, so nothing in CSS could consume it either: **65 mm square cards, 3 × 4 = 12 per sheet**, which is the real Hitster card size, so a printed deck shuffles into a bought one.

**Front and back sheets are interleaved and the BACK's columns are mirrored.** Long-edge duplex flips the paper about its vertical centre line, so a back sheet laid out in reading order pairs every card with the wrong answer — twelve cards wrong per sheet, discoverable only after printing and cutting. Because the grid is centred, the correction is exactly a reflection (`xFront + xBack === PAGE_WIDTH_MM - CARD_SIZE_MM`), which is what `pdf-sheet.test.ts` asserts rather than three literal positions. **Short-edge binding would mirror the rows instead and is not supported**: the app cannot read a printer setting, so the docs and the end screen name the setting instead of the code guessing at it.

**Only cards with a resolved year are exported, and the count of the rest is reported — never a list.** The end screen is one press from re-dealing the same deck, so naming an excluded title would spoil the rematch. In practice the only exclusion is a card the resolver has not reached yet.

**A standard PDF font is WinAnsi-encoded, so titles are sanitised rather than a font embedded.** Measured before deciding: WinAnsi already covers every Spanish, Portuguese, French, German and Italian glyph, and four of the nine suggested playlists are Spanish or Latin — so the transformation is a no-op on the decks this app is built for. The gap is Cyrillic, Greek, CJK and a few Latin extras, and embedding a Latin-Extended font would cost 200–400 kB in the export chunk to fix Polish and Turkish while still failing on the rest. A Cyrillic or CJK title prints as `?` placeholders; **the year and the QR are unaffected**, so the card still plays and still scans. Listed in [`development.md`](./development.md) §8.

---

### The error boundary and the chunk layout — built

```
src/main.tsx
  <StrictMode>
    <ErrorBoundary>            ← OUTSIDE <App />, and that position is the point
      <MotionConfig>
        <App />
```

**`ErrorBoundary` wraps `<App />` from `main.tsx`, never from inside it.** A boundary catches only what is **below** it, so one rendered inside `App` would be unmounted by the very exception it exists to catch — a throw in `App`'s own render passes straight through a boundary that same render produced. Out here its render depends on nothing the game touches, so there is nothing left in it to break. It sits outside `MotionConfig` too, so a crash in Motion's own tree is caught.

It is the **only class component in the app**, by necessity: `componentDidCatch` and `getDerivedStateFromError` have no hook equivalent, and the alternative was a dependency for thirty lines.

**Its fallback must never render the caught error's message or stack, and that is a leak rule.** Every prop and every piece of state in the app flows through the tree it catches, and the deck is in there — so an error string can quote a track title, an artist or a year, and a stack can carry a serialized prop. `"Invalid year 1975 for Bohemian Rhapsody"` is the answer to the card the player is looking at. **"Show the error so the player can report it" is the natural next change and it is the one that turns a crash screen into a spoiler.** The detail goes to `console.error`, which is not a rendered surface, so a developer keeps everything they need. State holds a **boolean**, not the `Error`, so the leak is unavailable rather than merely avoided; `ErrorBoundary.test.tsx` throws an error containing a fixture card's title, artist and year and asserts all three are absent from the document.

**Two recovery actions, and they are not the same button.** Reload preserves the saved session, for a transient failure. **Start over clears it first** — a corrupt or unexpected persisted session is the most plausible cause of a crash that recurs on _every_ reload, and without that button the state is inescapable except through devtools. Clearing goes through `persistence.ts`'s own `clearSession`, which owns the key and already swallows a storage that throws. Both `storage` and `reload` are injectable, the latter because jsdom implements no navigation.

#### The bundle is split at three boundaries, all measured

The landing screen was downloading the entire game. Attribution by decoding the build's own source map (2026-08-06) put **`motion` at 125.16 kB of a 373.39 kB single chunk — 33.7%** — and `qrcode` at 23.28 kB. Both are needed only once a deck has been dealt.

| Boundary                                                 | How                                                | Why that mechanism                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GameScreen` (and with it `motion`, `Card`, `CardStack`) | `React.lazy` in `App.tsx`                          | `motion` is used as JSX by two components, which cannot be awaited in place, so it needs a boundary. **The `Suspense` fallback is the preparing screen** — `playing` is only ever entered from `preparing`, so a chunk in flight leaves the player on the screen they are already looking at, notice and all. No loading state was invented. |
| `qrcode`                                                 | dynamic `import()` via `src/game/qrcode-loader.ts` | A loading state **already existed**: generation was always async and a same-size placeholder always covered it, so the import joins an await already there. `React.lazy` here would have stacked a `Suspense` fallback on a placeholder inside one 176px square.                                                                             |
| `jspdf` (and with it `html2canvas`, `purify`)            | dynamic `import()` inside `usePdfExport.ts`        | 399.95 kB / 129.95 kB gzip — **larger than the entire rest of the app**, for a button most players never press. Its optional dependencies split out again and stay unfetched unless jsPDF's own HTML path is used, which this app never calls. The awaited progress readout is the loading state, so no fallback was invented here either.   |

**Result: the landing screen went from 373.39 kB / 119.92 kB gzip of JavaScript to 218.52 kB / 70.27 kB — 41% less gzipped.** Verified in Lighthouse's own network log, not only in the build output: the entry HTML preloads the runtime and one shared helper, and neither deferred chunk is requested.

**Re-verified after adding jsPDF (2026-08-06), in Chrome against `vite preview`.** The landing screen makes exactly **six** requests: the document, `index-*.js`, `rolldown-runtime-*.js`, `preload-helper-*.js`, `qrcode-loader-*.js` and the CSS. Absent: `jspdf.es.min-*.js`, `html2canvas-*.js`, `purify.es-*.js`, `index.es-*.js`, `browser-*.js` (the QR encoder) and `GameScreen-*.js`. **Do this check in a network log rather than in the build output after any new dependency — the build output cannot distinguish an emitted chunk from a preloaded one.**

**One trap in the output, because the name says the opposite of the truth: `dist/assets/qrcode-loader-*.js` is React's JSX runtime, not the QR encoder.** Rolldown names a shared chunk after one of its modules, and `qrcode-loader.ts` — six lines — is now shared between the entry chunk (via `usePdfExport`) and the `GameScreen` chunk (via `QrCode`). So a chunk called "qrcode-loader" is `modulepreload`ed on the landing screen; it contains no `toDataURL` and no encoder, and it is what used to be emitted as `preload-helper-*.js`. Preloaded bytes before the change: 12.58 kB. After: 12.90 kB.

**That loader memoizes the import at module scope, and it is a bug fix rather than tidiness.** `QrCode`'s effect re-runs per card, so a bare `import()` in its body issues a fresh call per advance and two overlap whenever a card is superseded before its code resolves — the exact fast-advance race the generation counter exists for. Measured: with two imports in flight, the second one's continuation never ran and the new card kept the old card's placeholder forever. A rejected load stays cached deliberately, so a broken chunk is not re-fetched on every advance. **It moved out of `QrCode.tsx` into `src/game/qrcode-loader.ts` when the PDF export became a second consumer** — two files each holding their own `let module: Promise | null` would load the chunk twice and make "a rejected load stays rejected" true per file rather than per app. There is **no audio code to lazy-load** despite the phase checkbox saying "QR/audio": `useCardAudio` wraps a native element that already carries `preload="none"`.

#### `index.html` carries three tags and one rule about itself

Comments in that file are **shipped bytes** — it is the blocking request on the critical path and nothing strips it, unlike comments in `src/`. So the reasoning lives here and the file keeps one-line pointers.

- **`meta description`** — a Lighthouse SEO item and the text a link preview shows. It describes what the app does and names the one constraint a visitor needs in advance: the playlist has to be public.
- **`meta theme-color`, `#0a0a0a`** — colours the browser chrome on a phone, which is the device this game is played on; without it the near-black app sits under a light grey address bar. It is **the one duplicated colour literal in the app**, because `index.html` is not processed by Tailwind and a `meta` content attribute cannot hold a `var()`. It must be updated by hand when `--color-page` changes, which Phase 8's redesign will do.
- **`link rel="icon"`, a 240×240 WebP of 20,610 bytes** — replacing a 1254×1254 PNG of **1,262,175 bytes**, which was downloaded on every visit and was six times the entire JavaScript payload. **That single asset was costing 6.2 s of LCP** (see `development.md` §8). There is deliberately no PNG fallback: every browser that can run this app reads a WebP favicon, and a second `<link>` would reintroduce a request whose only purpose is a tab icon elsewhere. If one is ever needed, add a _small_ PNG.

### The token layer and the motion strategy (`src/index.css`) — built

Phase 7's first half gave the app a design surface. Before it, every colour, dimension and duration
in `src/` was an inline Tailwind utility, and the card's size was a literal pair written out twice.

```
src/index.css           THE design surface. One `@theme static` block, four
                        `@utility` composites, one prefers-reduced-motion block
src/main.tsx            <MotionConfig reducedMotion="user"> — the JS half of
                        the motion strategy
src/index.css.test.ts   The reduced-motion canary, the token canary and the
                        ring-utility canary. A `node` test over the
                        stylesheet's TEXT
```

**A v3 reader looking for `tailwind.config.js` should read the `@theme` block instead.** There is no
config file and one should not be added; the block is where colours, card geometry, the content
column, the year type scale, motion durations and the interaction minimums are named. Components
consume tokens and do not invent literals.

**Phase 8's card redesign proved that out.** It was meant to be a change of values _there_ rather than
a hunt across nine components, and it was: the neon ring cost ten new tokens, two new `@utility`
composites, and **four class-string edits across three components** — three `rounded-2xl` → `rounded-card`,
one `border border-border` → `card-ring-dim`, plus `card-ring` on the two faces and one text colour on
the year. No component grew logic, and no surface value moved at all.

Five things about it are load-bearing:

- **`@theme static`, not `@theme`.** `static` emits every variable whether or not a generated utility
  references it. Several tokens (`--card-height`, `--card-width`, `--qr-display-size`, the flip
  durations, the focus-ring and touch-target values) are consumed only through arbitrary-value
  utilities like `h-(--card-height)`, through the two `@utility` composites, or from inside the
  media query — and Tailwind counts none of those as a use, so a plain `@theme` would tree-shake them
  away.
- **Values are literal `oklch()`, not `var(--color-neutral-900)`.** The indirection looks tidier and
  is a trap: Tailwind emits only the default theme variables some utility actually references, so a
  token defined in terms of a palette shade resolves to nothing once the last direct use of that
  shade disappears — which is what this phase did to most of them. Provenance lives in a comment
  beside each value.
- **Colours are named by role, never by hue** — `page`, `surface`, `surface-raised`, `border*`,
  `fg*`, `accent*`, `on-accent`, `warning*`, `danger*`, `focus-ring`. Phase 8 changes hues without
  renaming anything. `fg-` rather than `text-` for the foreground family only because
  `--color-text-muted` would yield the utility `text-text-muted`.
- **`focus-ring`, `touch-target`, `card-ring` and `card-ring-dim` are `@utility` composites, not
  repeated utilities.** Thirteen interactive elements need an outline and a 44px minimum; declaring
  them once means one place to change and one class name for a test to assert. Written as `@utility`
  rather than a plain class so Tailwind's variants still compose — components write
  `focus-visible:focus-ring`. The two ring utilities are Phase 8's and have a subsection of their own
  below.
- **Two tokens cap a column, and which one a component takes is a real decision.**
  `--container-content` (24rem) is a reading measure for the landing, end and preparing screens.
  `--card-width` caps `Hud` and `NoticeBanner`, because those two sit directly above the card and are
  supposed to line up with it — at `max-w-sm` against an 18rem card they never did.

#### The card's geometry is one derived pair, and that fixed a latent bug

`Card.tsx` and `CardStack.tsx` each carried `h-[28rem] w-72`, and the two literals were **required**
to match: the stack's peeking backs are `absolute inset-0` on a wrapper sized by the second pair, so
a card resized without its wrapper leaves the backs the old size and the deck stops lining up.
Nothing enforced it.

```css
--card-height: clamp(18rem, min(62dvh, 124vw), 28rem);
--card-width: calc(var(--card-height) * 9 / 14);
```

**Height is the primary term and width is derived from it**, which is the opposite of the obvious
arrangement and matters twice. Height is what actually runs out — the card shares a `min-h-dvh`
column with the HUD, the notice and the control bar — and deriving the width holds the 9:14 ratio the
Phase 6 pair implied (288 × 448) at _every_ viewport, where clamping each axis independently would
preserve it at the two ends and drift everywhere between.

The `62dvh` term exists because a clamp on width alone puts a 448px card in a landscape phone's
375px viewport; `dvh` rather than `vh` also survives a collapsing mobile address bar. The `124vw`
term guards the narrow-but-tall case (124vw of height is 80vw of width once the ratio is applied) and
sits **inside `min()`** rather than as a second clamp so the ratio still holds when it wins.

It resolves to exactly 288 × 448 — the pre-Phase-7 values — on every desktop and on most phones. Only
below roughly 723px of viewport height does the card shrink at all. `CardStack.test.tsx` asserts the
two elements carry the same token string; `src/index.css.test.ts` asserts the derivation and the
`dvh` term.

**One consequence reaches outside presentation.** `SWIPE_COMMIT_DISTANCE_PX` (96px) was chosen as a
third of a 288px card. 288px is now only the card's ceiling, so at the floor the same 96px is 52% of
its width — a commit takes a longer drag on a small screen. It is deliberately **not** retuned; see
§3's gesture subsection and [`development.md`](./development.md) §8.

#### Reduced motion is two declarations for four animation surfaces

There are four animated surfaces and **no presentational component reads the preference**:

| Surface                        | Handled by                                              |
| ------------------------------ | ------------------------------------------------------- |
| The card flip (CSS transition) | `src/index.css`, `[data-motion='flip']`                 |
| The preparing spinner (CSS)    | `src/index.css`, `[data-motion='spinner']`              |
| The QR placeholder pulse (CSS) | `src/index.css`, `[data-motion='qr-placeholder']`       |
| Motion's `drag` and card exit  | `<MotionConfig reducedMotion="user">` in `src/main.tsx` |

The alternative was `useReducedMotion()` in three components, and it was rejected for a specific
reason rather than a stylistic one: it puts a preference read into three files and **silently misses
whatever animation the next phase adds**, where the CSS block is the obvious place to add a fourth
line.

Three details that look like oversights and are not:

- **The block is scoped to three selectors, not a blanket `* { transition: none }`.** A blanket rule
  is indiscriminate and would kill transitions that carry meaning — the flip is exactly one. The flip
  is therefore _collapsed_ (`--duration-flip-reduced`), not removed: the reveal still has to happen,
  it just must not travel.
- **The spinner is hidden, not stopped.** A stationary spinner is a dead grey circle that reads as a
  hung app. It is already `aria-hidden`, and the screen's status lines carry everything it conveys.
- **The hooks are `data-motion` attributes rather than class names**, because they are a contract
  between the stylesheet and three components. An attribute says that out loud where a bare class
  looks like a utility somebody forgot to delete.

**Nothing in this repo can test that any of it works, and that is why the canary exists.** jsdom
evaluates no media queries, and it has no `window.matchMedia` at all — so the preference can never
read as "reduce" in a test, on either the CSS or the JS side. What _is_ pinned is both ends of each
contract: `src/index.css.test.ts` asserts the block exists and names all three hooks, and each
component asserts it renders its own. The middle is manual — [`development.md`](./development.md) §5.

Motion tolerates the missing `matchMedia` without a stub (measured 2026-08-05, in
[`agent_findings.md`](./agent_findings.md)), and `Card.test.tsx` carries the canary for that, because
`MotionConfig` lives in `main.tsx` and nothing in this repo renders `main.tsx`.

#### What the accessibility pass actually changed

Four defects, all found by reading Phase 6's components rather than by a tool:

- **The flip was silent to assistive technology.** `CardRevealSide` now carries a polite
  `role="status"` region around the year, title and artist. **This is the only place in the app where
  announcing track data is correct**, and it is safe precisely because that component is mounted only
  while the card is flipped — see §3's leak rule. `CardHiddenSide.test.tsx` asserts the absence of any
  live region on the hidden face.
- **The landing input's `aria-label` overrode its own visible label**, so the accessible name did not
  match the visible text — a WCAG 2.5.3 failure that breaks speech control. Removed; the wrapping
  `<label>` already supplied a correct name.
- **`aria-invalid` was set with no `aria-describedby`**, so the _reason_ for an error was announced
  once and then unreachable on focus.
- **No interactive element had a focus style**, so all thirteen fell back to the browser default over
  a near-black page.

Contrast was computed rather than eyeballed, and four pairs failed 1.4.3 — including `text-white` on
the primary action at 3.67:1, which the plan had not listed. All four are fixed by token value, so no
call site carries a corrected literal. **The table has since been recomputed for Phase 8 and
replaced** — see the ring subsection below and [`agent_findings.md`](./agent_findings.md).

### The neon ring (Phase 8) — built, and it is utilities rather than a component

The card's visual design, drawn from `docs/plans/custom-hitster-mockup.png`: a green → cyan → magenta
gradient border with a soft outer bloom, on the near-black faces. Ten tokens and two `@utility`
composites in `src/index.css`, applied as class names.

| Utility         | Where                                    | What it is                                                       |
| --------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `card-ring`     | Both faces in `Card.tsx`                 | Masked gradient `::before` + a `box-shadow` bloom on the element |
| `card-ring-dim` | The two peeking backs in `CardStack.tsx` | A flat `--color-ring-dim` border. No pseudo-element, no glow     |

**No new component, and that was the decision rather than the lazy option.** A `NeonRing`/`CardFrame`
component buys expressive range this design does not need and costs three things: a component plus its
tests, a decorative `aria-hidden` **node inside the one subtree where "leak nothing" is a hard rule**,
and a fourth animation surface `prefers-reduced-motion` would have to be taught about in a second
place. The gradient therefore lives in the utility's own `::before`; nothing was added to the card's
DOM.

**A second accent family is now deliberate.** `--color-accent` (emerald) stays the **action** colour —
Start, Play again, the Play control — and the ring is **decoration that never conveys state**. That is
the condition making two families acceptable rather than confusing. If the ring is ever made to
indicate something, it needs a contrast budget and a row in the 1.4.11 list.

Four things about it are load-bearing:

- **The ring does not animate.** A slow pulse or rotating conic gradient is the reference aesthetic and
  was rejected: it would be a fourth animation surface, a fourth `prefers-reduced-motion` rule, and a
  continuously compositing paint behind the one element a player is holding a phone camera over. So the
  reduced-motion block still covers exactly three surfaces.
- **Neither utility sets `position`, and adding it would break the card.** The gradient band is a
  `position: absolute` `::before`, so the reflex is `position: relative` on the utility — but both call
  sites are already `absolute inset-0`, the declarations would collide in one cascade layer, and if
  `relative` won, both faces would drop out of absolute positioning and stack in flow. The contract is
  **the caller is positioned**, pinned at both ends: `index.css.test.ts` asserts neither utility
  declares a `position`, and the component tests assert `absolute` beside the ring class.
- **The ring is on the FACES, not on the card's outer element.** The outer element is the perspective
  container and does not rotate, so a ring there would sit still while the card turned inside it.
- **It adds no layout.** `--ring-width` is a border inside a `border-box` element and the bloom is a
  `box-shadow`, so the card's measured box is 288 × 448 exactly as before — the redesign is a paint
  change, not a layout one.

**Contrast was recomputed for every pair in the app, not only the changed ones, and the table in
[`agent_findings.md`](./agent_findings.md) REPLACED Phase 7's** rather than sitting beside it. It found
one pair nothing had ever measured — the focus ring on the filled danger button at 2.65:1, which
postdates Phase 7's audit and is exempt because `outline-offset: 2px` puts the whole outline on the
panel surface behind the button. It also improved one nobody had asked about: the stack's backs were
`border-border` at **1.31:1**, and `--color-ring-dim` is 4.23:1.

**One caveat is recorded rather than fixed:** the two peeking backs turn out not to render at all at
the card's full height — `scale()` is centre-origin and cancels the 10px offset — so `card-ring-dim` is
currently inert on a desktop-sized card. Pre-existing from Phase 5, measured, and written up in
[`agent_findings.md`](./agent_findings.md); the geometry is a deck-feel decision, not a mechanical fix.

### The installable shell (Phase 8) — built

The app is a PWA. `vite-plugin-pwa` in **`generateSW`** mode, so workbox writes the whole worker and
there is no custom worker source to maintain.

```
src/pwa/manifest.ts        The manifest, as a typed module. Imported by
                           vite.config.ts and by nothing in the app
src/pwa/manifest.test.ts   A `node` test over the installability-critical fields
vite.config.ts             VitePWA(...) — workbox options and the update strategy
public/pwa-*.png           192, 512 and a separate 512 maskable
public/apple-touch-icon.png  180. iOS ignores the manifest's icons entirely
```

**The manifest is a module, not a literal in the plugin call**, for the same reason as every other
split in this repo: the fields whose absence makes an install prompt silently never appear are a fact
worth asserting, and a literal buried in a config cannot be imported. It lives in `src/` but is
imported only by `vite.config.ts`, so it is not in the client bundle.

Four decisions carry the design:

- **The precache is the build output and NOTHING else.** `runtimeCaching` is empty, and that is a
  decision rather than an omission: a cached `/api/playlist` response deals a deck that no longer
  matches the real playlist (editorial playlists refresh their tracks), and `/api/year`'s freshness
  story is the shared Upstash cache on the server — a second unmanaged copy in one browser is a hole in
  that design, not an extension of it. **Offline therefore means the shell loads and a saved session
  stays playable**, minus audio and minus further year lookups; pressing Start produces Phase 7's
  `offline` copy, which already refuses a request that cannot succeed.
- **The update strategy WAITS rather than `skipWaiting`.** `registerType: 'prompt'` with no prompt UI
  wired up is exactly "wait quietly". The app code-splits `GameScreen`, `qrcode` and the PDF chunks, so
  a worker activating mid-game after a redeploy would leave a running tab asking for a chunk hash that
  no longer exists — the player advances one card and the app breaks. The cost is a delayed update; the
  benefit is a session that cannot break underneath itself.
- **A navigation-fallback denylist covers `^/api/`.** Without it an offline or failed `/api/year` would
  resolve with `index.html` and a 200, and the year client would try to parse a page of HTML as JSON —
  surfacing as `unexpected-payload`, the same code `pnpm dev` produces for an entirely different
  reason.
- **`devOptions` is absent**, so neither `pnpm dev` nor `npx vercel dev` registers a worker. A service
  worker in development is a caching-bug generator, and this repo's dev story (§5) is delicate enough.

**The icon set comes from the pre-`5e178f6` `logo.png`**, the 1254 × 1254 card-stack wordmark, which is
also the mark the design mockup draws in its header. `logo.webp` was regenerated from the same source
so the browser tab and the home screen are one identity; it came out at 10,376 bytes, **smaller** than
the 20,610 it replaced. The four PNGs add 278 kB and none is fetched before first paint. **The maskable
variant is its own file**, with the artwork at 84% of the canvas so its content radius (204.9px) sits
inside the 80% safe circle (204.8px) — a full-bleed 512 relabelled `maskable` validates cleanly and
gets cropped on every round-icon launcher. Provenance and byte counts are in
[`agent_findings.md`](./agent_findings.md); **never restore a large icon to the favicon slot.**

`vercel.json` needed no change: the SPA rewrite's `[^.]*` term cannot match a path containing a dot, so
`/sw.js`, `/manifest.webmanifest`, `/registerSW.js` and the icons all serve as files. That was checked
against the actual pattern rather than assumed.

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
