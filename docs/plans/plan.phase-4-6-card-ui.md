<!-- Plans for phase-4-6 (in order):
  1. plan.phase-4-6-card-ui.md   — Phase 4: test environment, the card, QR, and audio  ← this file
  2. plan.phase-4-6-gestures.md  — Phase 5: swipe, tap, stacked deck, keyboard
  3. plan.phase-4-6-screens.md   — Phase 6: landing, playlist client, notices, HUD, end screen
-->

# Plan: phase-4-6 — Phase 4: Card UI (flip, QR, audio)

> **Task:** phase-4-6
> **Date:** 2026-08-05
> **Author:** Aleix Rabassa
> **Source:** [`plan.md`](./plan.md) §5 Phase 4
> **Depends on:** Phase 3 (`src/game/`, already implemented in commit `43e59cc`) — this plan consumes `useGameSession()` and the `Card` type, and closes Phase 3's outstanding bookkeeping as step 0.

---

## Overview

Phase 4 turns the headless game layer built in Phase 3 into something visible: one card that flips
in CSS 3D, whose hidden side always renders a QR code plus the `[■ Exit] [▶ Play/Pause] [↺ Restart]`
controls, and whose revealed side shows title, artist and a prominent year. It also makes the
central non-negotiable of the whole product testable for the first time — **the hidden side must
leak nothing** — by adding the DOM test environment every document in the repo has deferred to
"the first component test in Phase 4".

Two things ride along because they are prerequisites rather than extras. First, Phase 3's code
landed without its bookkeeping: `plan.md` §5 Phase 3 is still entirely unticked, `AGENTS.md` still
announces Phase 3 as "next", and an untracked live-network test harness sits in the tree matched by
the Vitest include glob — so `pnpm test` is currently neither green-by-default nor offline. Second,
there is no screen yet from which to reach a card, so this plan mounts the card against a fixture
deck behind a temporary harness in `App.tsx`, which plan 3 replaces wholesale.

---

## Dependency Contract

### Requires from Phase 3 (`src/game/`)

| Output                                              | Description                                                                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/types.ts` → `Card`                          | `id` (bare 22-char track id), `title`, `artist` (one joined string), `durationMs`, `previewUrl?`, `isPlayable`, `year?` (three-state: `undefined` / `null` / number), `yearConfidence?` |
| `shared/types.ts` → `YearConfidence`                | `'high' \| 'low' \| 'none'` — drives the three-state year slot                                                                                                                          |
| `src/game/use-game-session.ts` → `useGameSession()` | `{ state, currentCard, isCurrentYearPending, cardsRemaining, resolvedCount, start, flip, next, end }`. `dispatch` is deliberately not exposed                                           |
| `src/game/reducer.ts` → `isCurrentYearPending`      | True only for `year === undefined`; the one thing the card renders a pending state for                                                                                                  |
| `src/game/persistence.ts` → `StorageLike`           | Injectable storage, so component tests need no real `localStorage`                                                                                                                      |

### Produces for downstream plans

| Output                                                                              | Consumed by                                                                            |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/components/Card.tsx`, `CardHiddenSide.tsx`, `CardRevealSide.tsx`, `QrCode.tsx` | plan 2 (wraps `Card` in drag/stack behaviour), plan 3 (renders it inside `GameScreen`) |
| `src/components/GameScreen.tsx`                                                     | plan 2 (keyboard handling, stacked deck), plan 3 (HUD, notices)                        |
| `src/hooks/useCardAudio.ts`                                                         | plan 2 (stop on swipe), plan 3 (stop on Exit from the container)                       |
| `src/components/__fixtures__/cards.ts`                                              | plans 2 and 3 — shared fixture deck for every component test                           |
| `shared/spotify-url.ts` → `spotifyTrackUrl()`                                       | plan 3 (nothing else), Phase 8 shareable links                                         |
| The jsdom + Testing Library test environment                                        | plans 2 and 3 — every component test in this task                                      |

---

## Scope & Affected Areas

| Area                                                          | Type                               | Notes                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api/_lib/__live-harness.test.ts`                             | Deleted (or moved out of the repo) | Untracked, developer-authored scratch harness. Matched by the Vitest glob, does real network I/O and `readFileSync` on `.env.local`, so `pnpm test` currently fails without env vars. **Confirm with the developer before deleting** — moving it outside the repo or renaming it away from `*.test.ts` are equally valid |
| `package.json`                                                | Modified                           | Add devDeps: `jsdom`, `@testing-library/react`, `@testing-library/user-event`                                                                                                                                                                                                                                            |
| `vite.config.ts`                                              | Unmodified (verify only)           | Default stays `environment: 'node'`; component tests opt in per file. See decision 3                                                                                                                                                                                                                                     |
| `shared/spotify-url.ts`                                       | Modified                           | Add `spotifyTrackUrl(id)` — the `https://open.spotify.com/track/{id}` builder the QR needs. No helper exists anywhere today                                                                                                                                                                                              |
| `shared/spotify-url.test.ts`                                  | Modified                           | Cases for the new builder                                                                                                                                                                                                                                                                                                |
| `src/index.css`                                               | Modified                           | `overscroll-behavior: none` on the page root to kill pull-to-refresh (plan 2 depends on it). No `@theme` tokens — those stay Phase 7                                                                                                                                                                                     |
| `src/components/Card.tsx`                                     | New                                | The 3D flip shell; owns no state                                                                                                                                                                                                                                                                                         |
| `src/components/CardHiddenSide.tsx`                           | New                                | QR + Exit/Play-Pause/Restart                                                                                                                                                                                                                                                                                             |
| `src/components/CardRevealSide.tsx`                           | New                                | Title, artist, three-state year                                                                                                                                                                                                                                                                                          |
| `src/components/QrCode.tsx`                                   | New                                | Wraps the `qrcode` package (installed in Phase 1, still zero importers)                                                                                                                                                                                                                                                  |
| `src/components/GameScreen.tsx`                               | New                                | Hosts the single `<audio>` element and the card. Plan 3 adds HUD and notices here                                                                                                                                                                                                                                        |
| `src/components/__fixtures__/cards.ts`                        | New                                | Fixture cards covering: high/low/none confidence, pending year, missing `previewUrl`, `isPlayable: false`, duplicate id                                                                                                                                                                                                  |
| `src/hooks/useCardAudio.ts`                                   | New                                | The session-scoped audio machine                                                                                                                                                                                                                                                                                         |
| `src/App.tsx`                                                 | Modified                           | Temporary harness mount over the fixture deck; replaced wholesale by plan 3                                                                                                                                                                                                                                              |
| `src/components/*.test.tsx`, `src/hooks/useCardAudio.test.ts` | New                                | See Unit Tests                                                                                                                                                                                                                                                                                                           |
| `docs/plans/plan.md`                                          | Modified                           | Tick Phase 3 and Phase 4; annotate deviations                                                                                                                                                                                                                                                                            |
| `docs/plans/plan.phase-3.md`                                  | Modified                           | Tick its outstanding documentation steps                                                                                                                                                                                                                                                                                 |
| `AGENTS.md`                                                   | Modified                           | Current phase; new `src/` subtrees; the jsdom-per-file rule; index rows for these three plan files                                                                                                                                                                                                                       |
| `docs/architecture.md`                                        | Modified                           | `src/game` + `src/components` + `src/hooks` layout; §7 phase status; the DOM-leak invariant                                                                                                                                                                                                                              |
| `docs/toolchain.md`                                           | Modified                           | jsdom/Testing Library, and how the test environment is selected                                                                                                                                                                                                                                                          |
| `docs/development.md`                                         | Modified                           | Test counts, DOM environment, manual card checks                                                                                                                                                                                                                                                                         |
| `docs/agent_findings.md`                                      | Modified                           | New dated entries (see Documentation Updates)                                                                                                                                                                                                                                                                            |

---

## Chosen Approach

**Presentational components driven entirely by props, with one container calling `useGameSession()`,
plus dedicated hooks for the two stateful concerns (audio here, gestures in plan 2).** Every
component in `src/components/` receives plain data and callbacks and holds no session knowledge, so
a test renders it with a fixture card and asserts on the DOM — no session, no network, no fake
timers, no provider wrapper. This was chosen over a `GameProvider` context (which removes prop
threading from app code only to reintroduce it as a stub-provider wrapper in every single test, and
which Phase 3 deliberately declined to ship) and over one monolithic `Card.tsx` owning flip, drag,
audio and QR together (fastest to write, but the leak-nothing invariant, the audio stop rules and
the drag-vs-tap threshold would be interleaved in one file and none of them isolable).

Audio uses **one session-scoped `<audio>` element whose `src` swaps per card**, owned by
`GameScreen` through `useCardAudio` and passed down to `CardHiddenSide` as a small control object.
Phase 4's rule is that a track must never bleed into the next card or double up on itself; with a
single element that is structurally impossible rather than a guard that has to be maintained — and
plan 2 renders 2–3 stacked cards simultaneously, which is exactly the window where per-card
elements would overlap.

The one design decision this plan adds beyond `plan.md`: **the revealed side's text is not mounted
in the DOM while the card is unflipped.** `backface-visibility` hides a face visually, but the
title, artist and year would still be in the DOM — readable via devtools, find-in-page, the
accessibility tree, and a screen reader. Findings entry #6 states the leak requirement is "a
property of the whole app, not of the card component", and DOM presence is a leak. Mounting the
revealed content only when flipped costs nothing visually (the back face is invisible below 90° of
rotation anyway) and turns "leaks nothing" into an assertion a test can make.

---

## Implementation Steps

- [x] **Step 0a — Restore a green, offline test baseline.** ✅ **Already resolved 2026-08-05.** The
      untracked `api/_lib/__live-harness.test.ts` (matched by the Vitest include glob, real `fetch`
      calls to Spotify and MusicBrainz, `readFileSync` on `.env.local`) has been deleted from the
      working tree. Verified: `pnpm test` reports **14 files / 233 tests passing** in ~5 s, which is
      the committed offline set with no live harness in it.
  - [x] Re-verified green after `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` were added to
        `.env.local` on 2026-08-05 — Vitest loads `.env` files, and `api/_lib/cache.test.ts` and
        `rate-limit.test.ts` assert the Upstash-versus-in-memory branching, so their presence was a
        real risk to the suite. It is not: both suites manipulate the variables themselves
- [x] **Step 0b — Close Phase 3's bookkeeping**, so Phases 4–6 are built against docs that describe
      reality rather than announcing Phase 3 as upcoming work.
  - [x] ⚠️ **Re-read the working tree before ticking anything here.** As of 2026-08-05 there is
        uncommitted work from outside the session these plans were written in: a remix-suffix
        fallback in year resolution (`stripRemixSuffix()` in `shared/year.ts`, an optional
        `viaTitle` on `YearResult` and `YearLookupResult`, `api/year.ts` passing it through),
        `maxDuration: 30` in `vercel.json`, ~229 new lines in `docs/agent_findings.md`, and edits
        to `docs/plans/plan.phase-3.md`. Some of the documentation items below may already be
        done — check rather than duplicating. None of it changes the contracts these three plans
        depend on: `Card`, `YearConfidence`, `PlaylistResult` and every error union are unchanged,
        and `viaTitle` is additive, optional, and not carried on `Card`, so no UI surface consumes
        it (a fallback result is `confidence: 'low'`, which the year slot already marks unconfirmed)
        — **checked: the working tree was clean at the start of execution. All of that work is
        committed in `f6ca112`, and none of it changed a contract this plan consumes**
  - [x] Tick all seven Phase 3 checkboxes in `docs/plans/plan.md` §5 and add the short execution
        annotation the Phase 2 block has (code complete in `43e59cc`; real-deployment verification
        of progressive loading deferred to plan 3's manual verification, where a real UI exists to
        do it through)
  - [x] Tick the outstanding documentation steps in `docs/plans/plan.phase-3.md`, and note there
        that the deployment verification moved into plan 3. **This meant doing the work first, not
        just ticking**: the `src/game/` section in `docs/architecture.md`, the reference-client note
        in `docs/api.md`, and the resolver subsection in `docs/development.md` did not exist
  - [x] Update `AGENTS.md`: current phase is now 4, Phase 3 is complete, and add index rows for the
        three `plan.phase-4-6-*.md` files — plus a row for `plan.phase-3.md`, which was also missing
  - [x] Update `docs/architecture.md`: §7 phase status, and a short description of the `src/game/`
        subtree that Phase 3 added but never documented
  - [x] Resolve `plan.md` §6's follow-on question about `confidence: 'none'` cards — it is already
        answered in two places (the card stays in the deck and is playable; the revealed side
        prompts the player to check that one). Mark it resolved rather than leaving a decided
        question open
- [x] **Step 1 — Add the DOM test environment.** Install `jsdom`, `@testing-library/react` and
      `@testing-library/user-event` as devDependencies. **Installed: `jsdom` 30.0.1,
      `@testing-library/react` 16.3.2, `@testing-library/user-event` 14.6.3.**
  - [x] Leave `vite.config.ts`'s `test.environment: 'node'` as the default and opt individual test
        files into jsdom with a per-file `@vitest-environment jsdom` docblock comment. This keeps
        node the default, so a DOM API accidentally added to `shared/` still fails a test run —
        which is half of what the node default was protecting
  - [x] Prove the mechanism with one throwaway assertion (a test file that asserts `document` is
        defined) before writing real components against it, and fall back to Vitest 4's
        `test.projects` if the docblock is not honoured. See Open Questions — **verified honoured
        under Vitest 4.1.10; the probe also rendered a component through Testing Library, and was
        deleted. `test.projects` was not needed.** Noted in passing: booting jsdom costs ~15 s of
        `environment` time on the first such file, so DOM tests are visibly slower than node ones
  - [x] Do not add `@testing-library/jest-dom`: three devDeps is already the cost ceiling here, and
        plain assertions on `queryBy*` results and element properties cover every case this plan
        needs without a `setupFiles` entry
  - [x] Update the inline comment in `vite.config.ts` that currently says jsdom arrives in Phase 4,
        so it describes the mechanism actually chosen
- [x] **Step 2 — Add `spotifyTrackUrl(id)` to `shared/spotify-url.ts`.** Builds
      `https://open.spotify.com/track/{id}` from a bare `Card.id`. It belongs beside
      `parsePlaylistUrl` — pure, DOM-free, needed by the browser and available to Phase 8 — and no
      such helper exists in the repo today (only the extraction regex in the embed adapter).
- [x] **Step 3 — Build the fixture deck** in `src/components/__fixtures__/cards.ts`: one card per
      interesting shape — `high` confidence, `low` confidence, `none` (`year: null`), pending
      (`year: undefined`), no `previewUrl`, `isPlayable: false`, and a duplicate-id pair. Every
      component test in all three plans renders from this, so the shapes only get enumerated once.
      **Two shape decisions made while building it:** `unplayableCard` carries a working
      `previewUrl` (so a test can prove the UI keys off `previewUrl`, not off `isPlayable`), and two
      cards use `shared/artists.ts`'s own hazard names ("Earth, Wind & Fire", "Tyler, The Creator")
      so the render-verbatim rule has something to fail against.
- [x] **Step 4 — Build `QrCode.tsx`.** Props: the URL to encode and a size. Generate a data URL
      with the `qrcode` package inside an effect and render it as an `<img>` — asynchronous, so
      hold a placeholder of the same dimensions until it resolves to avoid a layout jump.
  - [x] The `alt` text must be generic ("Scan to play in Spotify") and must never contain the
        track title or artist — an alt attribute is a leak surface exactly like body text
  - [x] Regenerate when the URL prop changes; ignore a resolved result for a superseded URL so a
        fast card advance cannot paint the previous card's QR — a generation counter in a ref
  - [x] Keep the `qrcode` import static here; lazy-loading it is an explicit Phase 7 item
  - [x] **A NAMED import, not a default one**: `@types/qrcode` declares named exports only and
        `verbatimModuleSyntax` is on with no `esModuleInterop`, so the `import QRCode from 'qrcode'`
        form every example online uses does not typecheck in this repo
- [x] **Step 5 — Build `useCardAudio.ts`**, the session-scoped audio machine. It takes the current
      card's `previewUrl` (possibly absent) and returns a ref to attach to the single `<audio>`
      element plus `{ canPlay, isPlaying, play, pause, restart, stop }`.
  - [x] `canPlay` is false when `previewUrl` is absent — the ~0.5% of tracks measured in Phase 0.
        Play/Pause and Restart are disabled in that case; Exit and the QR are unaffected. The
        controls are also **inert**, not merely disabled in the UI, so plan 2's keyboard shortcuts
        cannot reach around a disabled button
  - [x] `play()` must call the element's `play()` synchronously within the click handler's call
        stack — the browser autoplay gesture requirement, already the plan's approach
  - [x] Catch the rejected `play()` promise (an `AbortError` is normal when the `src` swaps
        mid-playback) so it never surfaces as an unhandled rejection
  - [x] On card change: pause, reset `currentTime` to 0, then swap `src`. In that order — swapping
        first can leave a frame of the previous track audible. **A card with no preview gets
        `removeAttribute('src')`, not `src = ''`**: an empty string resolves against the document
        URL, so the element would try to load the page itself as media
  - [x] `restart()` seeks to 0 and plays; it never advances the card
  - [x] `stop()` pauses and resets to 0; the container calls it on flip, on card change and on Exit
  - [x] Playback runs to its natural end: no auto-stop timer, no auto-advance (decided 2026-08-04).
        Track the `ended` event only to reset `isPlaying`
  - [x] **Never set `navigator.mediaSession.metadata`** — it would put the title and artist on the
        OS lock screen and notification shade, which is a leak that on-page hiding cannot prevent.
        Say so in a comment in the file, because it is an omission and omissions get "fixed"
  - [x] Use `preload="none"` on the element: nothing should be fetched until the player asks
        (set in `GameScreen`, which owns the element)
- [x] **Step 6 — Build `CardRevealSide.tsx`.** Title, artist (the joined string, rendered verbatim —
      `shared/artists.ts` documents that splitting it is lossy and forbidden for display), and the
      year rendered prominently as the card's key value.
  - [x] The year slot is **three-state and must not collapse to two**: a plain year for `high`; the
        year plus an explicit "unconfirmed" marker for `low`; and a "check this one yourself" prompt
        for `none` (`year: null`). A fourth visual state covers `isCurrentYearPending`
        (`year: undefined`) — a pending indicator in the year slot only. **Answering the fourth open
        question: the pending state is visually distinct, not just differently worded.** It renders
        a dimmed placeholder plus "Still looking up the year…", while `none` renders "Year unknown"
        at full weight plus an amber "Check this one yourself" — because one of them is an
        instruction to the player and the other explicitly is not
  - [x] No year-editing affordance. Marking only, per the decision recorded below
- [x] **Step 7 — Build `CardHiddenSide.tsx`.** The QR code, always rendered, plus the three
      controls as real `<button>` elements.
  - [x] **Every accessible name must be generic** — "Play", "Pause", "Restart", "Exit game". An
        `aria-label` naming the track would leak to a screen reader the same way visible text
        leaks to an eye. The test asserts the exact list, not just the absence of the title
  - [x] Play/Pause and Restart are `disabled` when `canPlay` is false; Exit and the QR never are
  - [x] Nothing on this side may derive from `title`, `artist`, `year`, or `durationMs` — not text,
        not attributes, not a key, not a tooltip. `Card.id` is fine: it is opaque, and the QR
        encodes it by design. **`durationMs` is included in the leak test's forbidden list**: a
        "3:54" next to a QR is enough to identify a track, and it is exactly the kind of thing
        that gets added later as a helpful progress bar
- [x] **Step 8 — Build `Card.tsx`**, the flip shell. Props: the card, `isFlipped`, and `onFlip`.
  - [x] Use Tailwind v4's native 3D transform utilities (perspective on the wrapper, `preserve-3d`
        on the rotating element, `backface-hidden` on both faces, a 180° Y rotation when flipped).
        No custom CSS and no `@theme` tokens — Tailwind v4 ships these utilities and Phase 7 owns
        design tokens
  - [x] **Mount `CardRevealSide` only while `isFlipped` is true**, per the DOM-leak reasoning above.
        The hidden face stays mounted throughout
  - [x] Do not attach a click handler that flips here — plan 2 owns tap-versus-drag disambiguation
        and will supply it. Expose `onFlip` and let the caller decide what triggers it
- [x] **Step 9 — Build `GameScreen.tsx`.** Renders the single `<audio>` element (via the ref from
      `useCardAudio`), the card, and wires the control callbacks. Props are the current card,
      `isFlipped`, `isYearPending`, and `onFlip` / `onNext` / `onExit` callbacks.
  - [x] Call `stop()` when `isFlipped` becomes true and when the card id changes — the Phase 4 rule
        that audio never bleeds across a flip or a card boundary
  - [x] Keep it presentational: it receives callbacks, it does not call `useGameSession()`
- [x] **Step 10 — Mount the temporary harness in `App.tsx`.** Render `GameScreen` over the fixture
      deck with local `useState` for the flip and index, so the card is reachable in `pnpm dev`
      before plan 3 exists. Its own comment must say it is a Phase 4 harness that plan 3 replaces
      wholesale — `App.tsx` already carries a comment of exactly that kind from Phase 1.
- [x] **Step 11 — Add `overscroll-behavior: none`** to the page root in `src/index.css` to disable
      pull-to-refresh, which plan 2's vertical-drag tolerance depends on. Plain CSS, not a token.
- [x] **Step 12 — Run the full gate**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
      Note that `noUncheckedIndexedAccess` makes every fixture-deck index access possibly-undefined
      and `noUnusedParameters` bites on unused event arguments; both are expected, not surprises.

---

## Unit Tests

**Pure logic (node environment, no docblock needed):**

- [x] `spotifyTrackUrl builds an open.spotify.com track URL from a bare id` — covers
      `spotifyTrackUrl` in `shared/spotify-url.test.ts`
- [x] `spotifyTrackUrl output round-trips through parsePlaylistUrl as unsupported-entity` — covers
      that the two helpers agree about what a track link is, in `shared/spotify-url.test.ts`

**`useCardAudio` (jsdom, `src/hooks/useCardAudio.test.ts`, via Testing Library's `renderHook`):**

- [x] `should report canPlay false when the card has no previewUrl` — covers the disabled-controls
      path for the ~0.5% of tracks without a preview
- [x] `should call play on the element synchronously when play is invoked` — covers the autoplay
      gesture requirement
- [x] `should pause, reset currentTime, then set the new src when the card changes` — covers the
      no-bleed rule and the ordering
- [x] `should not have two sources playing across a card change` — covers the single-element
      invariant that motivated the design
- [x] `should reset currentTime to zero and play again on restart, without advancing` — covers
      Restart's distinction from Next
- [x] `should pause and reset on stop` — covers the flip/next/exit path
- [x] `should clear isPlaying when the element emits ended` — covers natural end with no
      auto-advance
- [x] `should swallow a rejected play promise` — covers the `AbortError` on a mid-playback src swap
- [x] `should never set navigator.mediaSession.metadata` — covers the OS lock-screen leak vector
      explicitly, since this is an omission and nothing else would catch its removal

**`QrCode` (jsdom, `src/components/QrCode.test.tsx`):**

- [x] `should render an image whose source encodes the given URL` — covers QR generation
- [x] `should not include the track title or artist in any attribute` — covers the alt-text leak
      surface
- [x] `should regenerate when the url prop changes` — covers card advance
- [x] `should ignore a resolved code for a superseded url` — covers the fast-advance race

**`CardRevealSide` (jsdom, `src/components/CardRevealSide.test.tsx`):**

- [x] `should render the year plain for high confidence` — covers state 1 of the year slot
- [x] `should render the year with an unconfirmed marker for low confidence` — covers state 2
- [x] `should prompt the player to check the year for none confidence` — covers state 3, the one
      most likely to be collapsed into state 2
- [x] `should render a pending indicator when the year is undefined` — covers the pending case, and
      that `null` is not treated as pending
- [x] `should render the artist string verbatim without splitting it` — covers the "Earth, Wind &
      Fire" class of bug that `shared/artists.ts` warns about

**`CardHiddenSide` (jsdom, `src/components/CardHiddenSide.test.tsx`):**

- [x] `should render the QR code even when the track has no preview` — covers the always-available
      fallback
- [x] `should disable play/pause and restart when the track has no preview` — covers the Phase 0
      coverage gap
- [x] `should keep exit enabled when the track has no preview` — covers the "Exit and QR are never
      affected" rule
- [x] `should not render the title, artist, or year anywhere in the DOM` — **the leak test.** Query
      by text and by every attribute value for the fixture card's title, artist and year
- [x] `should give the controls generic accessible names` — covers the `aria-label` leak surface
- [x] `should invoke the exit callback on exit` — covers the control wiring

**`Card` (jsdom, `src/components/Card.test.tsx`):**

- [x] `should not mount the revealed side while unflipped` — the DOM-presence leak invariant, and
      the single most important assertion in this plan
- [x] `should mount the revealed side when flipped` — covers the flip
- [x] `should keep the hidden side mounted while flipped` — covers the 3D flip's requirement that
      both faces exist
- [x] `should apply the flipped transform only when flipped` — covers the visual state

**`GameScreen` (jsdom, `src/components/GameScreen.test.tsx`):**

- [x] `should stop audio when the card is flipped` — covers the Phase 4 stop rule
- [x] `should stop audio when the card changes` — covers the no-bleed rule at the integration level
- [x] `should render exactly one audio element regardless of deck size` — covers the session-scoped
      ownership decision
- [x] `should stop audio when exit is invoked` — covers the Exit path

---

## Documentation Updates

- [ ] `docs/plans/plan.md` — tick Phase 3 (all seven) and Phase 4 (all six); annotate that the
      revealed side's unconfirmed-year marking is implemented here rather than in Phase 6 (same
      component, same file — see decision 8), and that Phase 3's real-deployment verification moved
      to plan 3
- [ ] `docs/plans/plan.phase-3.md` — tick the outstanding documentation steps; record where the
      deployment verification went
- [x] `docs/plans/plan.phase-4-6-card-ui.md` — this file: tick steps as they land, and add an
      Execution Notes section for what differed — **done 2026-08-05**
- [ ] `AGENTS.md` — current phase 4 (then 5, 6 as plans land); doc-index rows for the three new
      plan files; the new `src/components/` and `src/hooks/` trees under the layout rules; and a new
      **Conventions** bullet: component tests opt into jsdom with a per-file
      `@vitest-environment jsdom` docblock, because the default environment stays `node`
- [ ] `docs/architecture.md` — describe the `src/` subtree (`game/`, `components/`, `hooks/`); mark
      Phase 3 and Phase 4 built in §7; and record the DOM-leak invariant (the revealed side is not
      mounted while unflipped) as an architectural rule rather than a component detail, since it is
      the kind of thing a later refactor would undo for animation smoothness
- [ ] `docs/toolchain.md` — the three new devDependencies; that the Vitest default environment is
      still `node` and how a test opts into jsdom; that `@testing-library/jest-dom` was deliberately
      not added, so no `setupFiles` entry exists; and that jsdom does not implement media playback,
      so audio tests stub the element's `play`/`pause`
- [ ] `docs/development.md` — updated test counts and file counts; the DOM environment; and a
      manual card-verification checklist (flip, QR scan on a real phone, disabled controls on a
      preview-less card, devtools inspection of the hidden side, and the OS lock-screen check)
- [ ] `docs/agent_findings.md` — new dated entries (2026-08-05), and **tell the developer** each was
      added, per `AGENTS.md`:
  - [ ] `backface-visibility` hides a face visually but leaves its text in the DOM — devtools,
        find-in-page and the accessibility tree all read it, so the revealed side is mounted only
        when flipped. Include the wider rule: every leak audit must cover attributes and accessible
        names, not just visible text
  - [ ] jsdom does not implement `HTMLMediaElement.play`/`pause` — audio tests must stub them on the
        prototype, and an unstubbed call surfaces as a "Not implemented" console error rather than a
        clean failure
  - [ ] How the DOM environment is selected per file, and why the node default was kept (it is what
        makes a DOM API in `shared/` fail)
  - [ ] The Phase 3 bookkeeping gap itself: code landed in `43e59cc` with plan.md, AGENTS.md and
        architecture.md untouched, so three documents disagreed with the tree for a day. Worth
        recording as a process note

---

## Testing Strategy

- **Unit tests:** as enumerated. Pure helpers stay in the node environment; components and the
  audio hook opt into jsdom per file. The leak assertions (`CardHiddenSide` and `Card`) are the ones
  that matter most — they are the only automated defence of the product's central rule.
- **Integration tests:** `GameScreen` is the integration seam covered here (audio lifecycle against
  card changes and flips). Full session integration — landing through end screen against a stubbed
  fetch — belongs to plan 3, where the container exists.
- **Manual verification:**
  - `pnpm dev`, then step through the fixture deck in the temporary harness: flip, play, pause,
    restart, and confirm audio stops on flip and on advance.
  - Open devtools on the unflipped card and search the DOM for the fixture title, artist and year —
    all three must be absent.
  - Scan the QR with a real phone and confirm it opens the right track in Spotify.
  - On an Android device (or Chrome's media panel), start playback and confirm the notification /
    lock-screen entry shows no track title or artist. This is the leak that only shows up on real
    hardware.
  - Confirm a preview-less fixture card disables Play/Pause and Restart while Exit and the QR stay
    live.
  - Do **not** measure timings through `vercel dev` — findings entry #8 records ~4 s of
    process-spawn overhead per request, and nothing in this plan needs a function anyway.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                    | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **jsdom + `@testing-library/react` + `@testing-library/user-event`** as the test environment                             | Options weighed: (a) this; (b) jsdom alone, rendering by hand with `act()`; (c) stay node-only and test only extracted pure logic. Chosen (a) by the developer. The behaviours that regress silently here — the hidden side leaking, audio doubling up, controls not disabling, the year slot collapsing to two states — are all DOM-observable and nothing else can assert them. `user-event` also matters for plan 2's pointer sequences |
| 2   | `@testing-library/jest-dom` deliberately not added                                                                       | Its matchers are convenience; `queryBy*` results and element properties assert the same things without a `setupFiles` entry. Keeps the new dependency count at three                                                                                                                                                                                                                                                                       |
| 3   | The Vitest default environment stays `node`; component tests opt in with a per-file `@vitest-environment jsdom` docblock | A global jsdom default would silently permit a DOM API in `shared/`, which is half of what the node default protects. A per-file docblock also needs no `vite.config.ts` change at all. `test.projects` is the fallback if the docblock is not honoured under Vitest 4                                                                                                                                                                     |
| 4   | **Presentational components + one container**, with hooks for stateful concerns                                          | Chosen by the developer over a `GameProvider` context and over a monolithic `Card`. Tests render a component with props — no provider wrapper, no session stub. It also matches Phase 3's own posture: it shipped a hook and explicitly no context                                                                                                                                                                                         |
| 5   | **One session-scoped `<audio>` element, `src` swapped per card**, owned by `GameScreen`                                  | Chosen by the developer over per-card elements and over a module-level singleton. Phase 4 forbids audio bleeding into the next card or doubling up; with one element that is structurally impossible. Plan 2 stacks 2–3 cards, which is precisely where per-card elements would overlap                                                                                                                                                    |
| 6   | **The revealed side is not mounted in the DOM while the card is unflipped**                                              | `backface-visibility` is a visual property. Title, artist and year would otherwise be readable via devtools, find-in-page, and the accessibility tree. Findings #6: the leak requirement is a property of the whole app. Costs nothing visually — the back face is invisible below 90° of rotation                                                                                                                                         |
| 7   | Accessible names and `alt` text on the hidden side must be generic                                                       | An `aria-label` of "Play Bohemian Rhapsody" leaks to a screen reader exactly as visible text leaks to an eye. Same reasoning as the mediaSession decision from Phase 0                                                                                                                                                                                                                                                                     |
| 8   | The revealed side's unconfirmed-year marking is built here, not deferred to Phase 6                                      | `plan.md` lists it under Phase 6, but it is the same component and the same file as Phase 4's "year prominent" item. Splitting one element's rendering across two plans would mean writing the year slot twice. Plan 3 keeps the _count-only load-time wording_, which is genuinely its own concern                                                                                                                                        |
| 9   | **No year-editing affordance**                                                                                           | Chosen by the developer over in-session editing and over persisted corrections. Editing implies validation, a new reducer action (and Phase 3 deliberately does not expose `dispatch`), and a decision about surviving resume — real scope for something nobody has asked to use mid-game                                                                                                                                                  |
| 10  | Phase 3's bookkeeping and the stray live harness are closed as step 0                                                    | Chosen by the developer. `pnpm test` is currently neither green-by-default nor offline, and three documents announce Phase 3 as upcoming work. Neither is safe ground to build a UI on                                                                                                                                                                                                                                                     |
| 11  | Phase 3's real-deployment verification of progressive loading moves to plan 3                                            | It needs a UI to exercise, and plan 3 is what produces one. Doing it here would mean building a throwaway harness for it                                                                                                                                                                                                                                                                                                                   |
| 12  | Styling stays minimal utility classes; no `@theme` tokens, no visual design pass                                         | `plan.md` puts design tokens, responsive work and a11y in Phase 7 and card art direction in Phase 8, and `AGENTS.md` forbids building ahead of the current phase                                                                                                                                                                                                                                                                           |
| 13  | Tailwind v4's built-in 3D transform utilities are used instead of custom CSS                                             | v4 ships perspective, `preserve-3d`, `backface-hidden` and axis rotations. `plan.md` calls for "plain CSS 3D, no library", which these are                                                                                                                                                                                                                                                                                                 |

---

## Open Questions

- [x] Does Vitest 4 honour the `@vitest-environment jsdom` docblock, or has per-file selection moved
      entirely to `test.projects`? Verify with the throwaway assertion in step 1 before writing
      components; the fallback is a two-project config in `vite.config.ts`. — **Answered 2026-08-05:
      yes, honoured under Vitest 4.1.10.** A throwaway file asserting `document` was defined and
      rendering a component through Testing Library passed, and was deleted. `test.projects` was not
      needed and `vite.config.ts` keeps `environment: 'node'` as its only environment setting.
- [ ] Which QR rendering form works out best — a data URL in an `<img>` (the plan's choice), an
      inline SVG string, or a canvas? The `<img>` avoids `dangerouslySetInnerHTML` and scales with
      CSS; revisit only if the async paint is visibly late on a slow phone. **Still open — the
      `<img>` is built and correct, and only a real slow phone can answer this.**
- [ ] Does any target browser populate the OS media-session entry from a bare MP3 without the page
      setting `mediaSession.metadata`? The page title ("Custom Hitster") is safe either way, but
      confirm on a real Android device rather than assuming. **Still open — it is on the manual
      verification list and needs real hardware.** What is settled is the code side: a test asserts
      the app never writes `mediaSession.metadata` or an action handler.
- [x] Should the pending-year indicator be visually distinct from the `none` prompt, or is the
      wording enough? Both are "no year on screen", but one resolves and one will not. — **Answered
      2026-08-05: visually distinct.** Pending renders a dimmed placeholder plus "Still looking up
      the year…"; `none` renders "Year unknown" at full weight plus an amber "Check this one
      yourself". Wording alone was rejected because one of the two is an INSTRUCTION to the player
      and acting on it while the lookup is still in flight is wasted effort.

---

## Out of Scope

- All gestures — swipe-to-next, tap-to-flip, drag thresholds, the stacked deck, keyboard controls,
  and real-device touch verification. Plan 2.
- The landing screen, the `/api/playlist` client, the `spotify.link` and legacy `/user/` URL fixes,
  the `truncated` / `skippedCount` notices, the preparing screen, the HUD, the end screen, and the
  container that calls `useGameSession()`. Plan 3.
- Design tokens (`@theme`), responsive layout, focus styling, `prefers-reduced-motion`, the
  Lighthouse pass, and lazy-loading the QR and audio code — Phase 7.
- Card art direction, the shareable deck URL, PWA, and PDF export — Phase 8.
- Any change to Phase 3's reducer, resolver, persistence format, or their tests. Plan 3's container
  handles the Exit-versus-finished distinction with local state precisely so that this stays true.
- Full-track playback. `previewUrl` is a 30-second MP3 and the app has no Spotify playback session;
  the QR is what gets a player to the whole song.

---

## Execution Notes

Written 2026-08-05, after every implementation step and unit test landed. All twelve steps went in
as planned and nothing in the Chosen Approach needed revisiting. What follows is the part that was
not in the plan.

### Deviations and additions

1. **Testing Library does not clean up between tests in this repo, and the failure looks like a
   component bug.** Its auto-`afterEach(cleanup)` registers only when Vitest's `globals` are on;
   this repo imports `describe`/`it`/`expect` from `vitest` explicitly, so every render stays in
   `document.body` and the next test queries a DOM containing all its predecessors. The first
   symptom was "found multiple elements with the role img" in a file that renders one image.
   **Every DOM test file therefore carries an explicit `afterEach(cleanup)`.** No `setupFiles` was
   added — decision 2 keeps that slot empty, and one line per file is a fair price for it.
2. **Control calls in tests must be wrapped in `act()`.** Each control sets state, and React 19 does
   not flush an update made outside `act()` before the test's next line, so `isPlaying` reads stale
   immediately after a successful `play()`. `useCardAudio.test.ts` has a `run()` helper that does
   nothing else.
3. **`QrCode` derives staleness instead of clearing it.** The plan's shape — clear the code in the
   effect, then set it when generation resolves — is an ESLint error here
   (`react-hooks/set-state-in-effect`, cascading renders). The component stores the generated code
   **together with the key it was generated for** and compares during render, which is both
   lint-clean and strictly better: the placeholder appears on the very first render of a new URL
   rather than one render later. The generation counter stayed, and is not redundant — without it a
   late, superseded promise would overwrite a newer correct result, and the derived check would then
   fall back to the placeholder rather than keeping the code that was already right.
4. **`qrcode` must be imported by NAME.** `@types/qrcode` declares named exports only, and this repo
   runs `verbatimModuleSyntax` with no `esModuleInterop`, so the `import QRCode from 'qrcode'` form
   every example online uses does not typecheck.
5. **A card with no preview gets `removeAttribute('src')`, not `src = ''`.** An empty string resolves
   against the document URL, so the element would try to load the page itself as media.
6. **`GameScreen` stops audio on `card.id`, not on `previewUrl`.** `useCardAudio`'s own swap effect
   keys on the URL, and two cards can legitimately share one — a duplicated track, which Phase 3
   handles explicitly because playlists really do that. The ID-keyed effect is what covers it.
7. **`durationMs` was added to the leak test's forbidden list**, alongside title, artist and year.
   "3:54" beside a QR code is enough to identify a track, and a playback progress bar is exactly the
   kind of helpful addition that would introduce it.
8. **`Card.onFlip` and `GameScreen.onNext` are declared and deliberately unread.** Both triggers are
   plan 2's (tap-versus-drag, swipe). They are in the signatures now so plan 2 adds handlers rather
   than props, and both carry a comment saying so — an unused prop otherwise reads as an oversight.

### Verification status

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass. The suite is **278 tests across
20 files**, up from 233 across 14 — 45 new tests, 37 of them in the six new jsdom files. Everything
is still offline and still runs green with no environment variables set.

**Not yet done, and it needs a person:** the whole Manual Verification list under Testing Strategy —
scanning the QR with a real phone, the devtools DOM search on an unflipped card, and above all the
**Android lock-screen check**, which is the one leak vector no automated test in this repo can
reach. The Documentation Updates checklist below is also outstanding.
