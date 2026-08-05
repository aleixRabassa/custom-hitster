<!-- Plans for phase-4-6 (in order):
  1. plan.phase-4-6-card-ui.md   — Phase 4: test environment, the card, QR, and audio
  2. plan.phase-4-6-gestures.md  — Phase 5: swipe, tap, stacked deck, keyboard
  3. plan.phase-4-6-screens.md   — Phase 6: landing, playlist client, notices, HUD, end screen  ← this file
-->

# Plan: phase-4-6 — Phase 6: Game Flow Screens

> **Task:** phase-4-6
> **Date:** 2026-08-05
> **Author:** Aleix Rabassa
> **Source:** [`plan.md`](./plan.md) §5 Phase 6
> **Depends on:** [plan.phase-4-6-card-ui.md](plan.phase-4-6-card-ui.md) and [plan.phase-4-6-gestures.md](plan.phase-4-6-gestures.md) — this plan wires the finished card into a real app: the screens around it, the client that fetches a playlist, and the container that owns the session.

---

## Overview

Phase 6 is what makes the app usable by someone who is not holding a fixture deck: a landing screen
with URL validation, inline errors and five ready-to-try suggested playlists; the `/api/playlist`
client that no one has written yet; a count-only loading screen for the card-1 gate; the two
non-blocking notices (`truncated`, `skippedCount`); an in-game HUD showing cards remaining; and an
end screen offering restart or a new playlist. It also replaces `App.tsx` — still the Phase 1
placeholder plus plan 1's temporary harness — with the real container, the single place in the app
that calls `useGameSession()`.

Two pieces of scope come from findings rather than from `plan.md`'s checklist. Findings entry #4
recorded two live Spotify link shapes that carry a valid playlist id and still fail today, and
flagged both "for Phase 6 to decide": the legacy `open.spotify.com/user/{user}/playlist/{id}` form,
which is rejected as `unsupported-entity` and which the findings call "the clearest real bug this
spike found", and `spotify.link/…` short URLs — the shape the mobile share sheet produces, which is
to say the most likely way a phone user obtains a link at all. **Both get fixed here.** The first is
a pure change in `shared/`; the second needs a redirect followed server-side, so it lands in `api/`.

This plan also carries Phase 3's outstanding real-deployment verification of progressive loading. It
was deferred here on purpose: verifying that Start waits on one lookup and that cards 2..n fill
during play is enormously easier through a UI that exists than through a throwaway harness.

---

## Dependency Contract

### Requires from plans 1 and 2

| Output | Description |
|---|---|
| `src/components/GameScreen.tsx` | Hosts the card, the audio element, the stack and the keyboard handler. Gains the HUD and the notice banner here |
| `src/components/CardStack.tsx`, `Card.tsx`, `CardHiddenSide.tsx`, `CardRevealSide.tsx`, `QrCode.tsx` | Rendered, not modified |
| `src/hooks/useCardAudio.ts` | `stop()` is called on Exit from the container |
| `src/components/__fixtures__/cards.ts` | Fixture deck for the container and screen tests |
| jsdom + Testing Library, per-file docblock | Every component test here |
| `shared/spotify-url.ts` → `spotifyTrackUrl()` | Added in plan 1; used by the card only |
| Keyboard guard against typing in inputs (plan 2) | The landing screen's text input depends on it |

### Requires from Phase 3

| Output | Description |
|---|---|
| `useGameSession()` | The single entry point. `start(cards, playlist, seed?)`, `flip()`, `next()`, `end()`, plus `state`, `currentCard`, `isCurrentYearPending`, `cardsRemaining`, `resolvedCount` |
| `GameStatus` | `idle` / `preparing` / `playing` / `ended` — the four screens, one per status |
| `state.yearLookupsUnavailable` | Drives the "years unavailable on this deployment" notice |
| `shared/spotify-url.ts` → `parsePlaylistUrl()` | Client-side validation on the landing screen, using the same codes the server returns |
| `shared/constants.ts` → `MAX_EMBED_TRACKS` | Wording for the truncation notice |

### Produces for downstream plans

| Output | Consumed by |
|---|---|
| `src/game/playlist-client.ts` | (no downstream in this task) Phase 7's error/offline states |
| `api/_lib/short-link.ts` | (no downstream) |
| The real `src/App.tsx` container | Phase 7 (responsive, a11y, error states), Phase 8 (shareable deck URL enters through `start`'s optional seed) |

---

## Scope & Affected Areas

| Area | Type | Notes |
|------|------|-------|
| `shared/spotify-url.ts` | Modified | Accept the legacy `/user/{user}/playlist/{id}` path; add an exported short-link predicate. `parsePlaylistUrl`'s return type is **unchanged** — see decision 4 |
| `shared/spotify-url.test.ts` | Modified | New cases for both |
| `api/_lib/short-link.ts` | New | Resolve a `spotify.link` URL by following redirects, with a host allow-list and a hop limit. Server-only, so it cannot live in `shared/` (it needs `fetch` and a `User-Agent`) |
| `api/_lib/short-link.test.ts` | New | Injected fetch; offline |
| `api/playlist.ts` | Modified | Resolve a short link before parsing. Remember: relative imports need the explicit `.js` extension, and no `@/` under `api/` |
| `src/game/playlist-client.ts` | New | `/api/playlist` client with injected `fetch`, mirroring `year-client.ts` exactly — so it is testable in the node environment |
| `src/game/playlist-client.test.ts` | New | Node environment, offline |
| `src/game/messages.ts` | New | One map from error code to player-facing copy, shared by client-side parse failures and server codes |
| `src/hooks/usePlaylist.ts` | New | Thin hook over the client: request state, abort on unmount, no logic |
| `src/components/LandingScreen.tsx` | New | URL input, inline validation, suggested playlists |
| `src/components/PreparingScreen.tsx` | New | Count-only progress for the card-1 gate |
| `src/components/Hud.tsx` | New | Cards remaining. No Exit button — Exit lives on the card |
| `src/components/NoticeBanner.tsx` | New | The non-blocking notices, dismissible |
| `src/components/EndScreen.tsx` | New | Cards played, restart, new playlist |
| `src/components/GameScreen.tsx` | Modified | Renders the HUD and the notice banner around the stack |
| `src/App.tsx` | Rewritten | The real container: `useGameSession()`, the status switch, the end-reason flag. Replaces plan 1's harness wholesale |
| `src/components/*.test.tsx`, `src/App.test.tsx` | New | See Unit Tests |
| `docs/plans/plan.md` | Modified | Tick Phase 6; resolve the remaining §6 open questions |
| `docs/api.md` | Modified | Short-link resolution and the new accepted URL forms |
| `AGENTS.md` | Modified | Current phase → 6 complete, Phase 7 next |
| `docs/architecture.md` | Modified | Data flow now includes a real client; §7 Phase 6 built |
| `docs/development.md` | Modified | That the app needs `npx vercel dev` (not `pnpm dev`) to be playable; manual checks; the Upstash warning |
| `docs/agent_findings.md` | Modified | New dated entries — see Documentation Updates |

---

## Chosen Approach

**Screens are selected by `GameState.status`, with no router.** The reducer already models exactly
four states and they map one-to-one onto the four screens, so a router would add a dependency and a
second source of truth that has to be kept in sync — including a browser Back mid-deck, which is a
transition Phase 3's reducer never modelled. Exit becomes `end()` plus a container flag, and "new
playlist" returns to `idle`.

**Exit and deck-exhaustion are distinguished by a container-local flag**, not by a reducer change.
Both currently produce `status: 'ended'` (`reducer.ts` lines 127 and 137) and `currentIndex` cannot
tell them apart either, since Exit on the last card looks identical to finishing. The container sets
a local `'exited' | 'finished' | null` immediately before calling `end()` from its own Exit handler;
deck-exhaustion leaves it null. This keeps Phase 3's reducer, its `GameState` type, its persistence
format and its 89 passing tests untouched — a phase declared complete does not get reopened for a
presentation concern. The flag is deliberately ephemeral: after a refresh the saved session is
already cleared by `END`, so the landing page is the correct destination either way.

**The `/api/playlist` client mirrors `year-client.ts` structurally** — a plain async function with an
injected `fetch` and a discriminated result — with a thin `usePlaylist` hook over it. That is what
lets it be tested exhaustively in the node environment with no jsdom and no network, exactly as the
year client is today, and it keeps the hook free of logic worth testing.

**Restart re-deals from `state.deck` rather than from a remembered fetch result.** Reshuffling an
already-shuffled deck with a fresh seed is just as random, and it means Restart works after a resumed
session too — where the original `/api/playlist` response no longer exists in memory. It also removes
a container state field that would otherwise need keeping in step.

---

## Implementation Steps

- [ ] **Step 1 — Fix the legacy `/user/{user}/playlist/{id}` path in `shared/spotify-url.ts`.** It is
      a real playlist link rejected as `unsupported-entity` today. Pure change, no network.
  - [ ] Keep the 22-character base62 id check exactly as strict — findings entry #4 established that
        22 is arithmetic, not convention, and explicitly says not to relax it
  - [ ] Keep locale prefixes working in combination with the new form
- [ ] **Step 2 — Add a short-link predicate to `shared/spotify-url.ts`.** A small exported function
      that recognises a `spotify.link` URL. `parsePlaylistUrl`'s return type stays as it is: adding
      a third variant would ripple into `api/playlist.ts`'s exhaustive handling for no benefit.
  - [ ] The landing screen uses it to treat a short link as submittable rather than showing an
        inline "invalid link" error, since only the server can resolve it
  - [ ] Cover the sibling host `link.tospotify.com` if a quick check shows Spotify still emits it
- [ ] **Step 3 — Build `api/_lib/short-link.ts`.** Given a short URL and an injected fetch, follow
      redirects manually and return the resolved URL or a typed failure.
  - [ ] **Host allow-list on every hop** — only Spotify-owned hosts. Following a redirect to an
        arbitrary host from a user-supplied URL is a server-side request forgery vector, and this
        function runs in a Vercel Function with outbound network access
  - [ ] Hard hop limit (3 is ample) and no redirect loops
  - [ ] Read the target from `Location` with `redirect: 'manual'`; do not let `fetch` follow
        automatically, or the allow-list never gets consulted
  - [ ] Send the same descriptive `User-Agent` the embed adapter uses; short links may behave
        differently for an unidentified client
  - [ ] Return failures that map onto **existing** `PlaylistErrorCode` values — a network problem is
        `upstream-unavailable`, and a link that resolves to something that is not a playlist falls
        through to `parsePlaylistUrl` and comes back as `unsupported-entity` naturally. No new error
        codes, so the client contract is unchanged
  - [ ] `api/_lib/` is not routed by Vercel (findings entry #2), so this file is safe there
- [ ] **Step 4 — Wire short-link resolution into `api/playlist.ts`.** If the `url` query value is a
      short link, resolve it first, then feed the result through the existing `parsePlaylistUrl` path
      unchanged.
  - [ ] Relative imports need the explicit `.js` extension — this is the failure that produces a
        `FUNCTION_INVOCATION_FAILED` at runtime after a build that logs no error, and that all five
        local checks pass either way (findings entry #3)
  - [ ] No `@/` imports under `api/`
  - [ ] Leave the success-path cache headers as they are; a resolved short link is the same playlist
- [ ] **Step 5 — Build `src/game/playlist-client.ts`.** Async function, injected `fetch`, injected
      abort signal, discriminated result — the same shape as `year-client.ts`.
  - [ ] Map the body's `code` first, then fall back to the HTTP status, mirroring the year client's
        `STATUS_FALLBACK` approach. Note that `upstream-unavailable` and `unexpected-payload` share
        status 502 and are only distinguishable by `code`, and that `method-not-allowed` /
        `internal-error` are untyped codes the union does not contain
  - [ ] Validate the 200 body's shape before trusting it (`playlist`, `cards` as an array,
        `truncated`, `skippedCount`) and return `unexpected-payload` otherwise
  - [ ] **Handle a 200 whose body is not JSON as `unexpected-payload`.** This is not theoretical: the
        Vite dev server returns the *transpiled source* of `api/playlist.ts` with status 200, so
        anyone running `pnpm dev` instead of `npx vercel dev` hits exactly this. A clear error beats
        a raw parse exception
  - [ ] Never throw — return a result, like the year client
- [ ] **Step 6 — Build `src/game/messages.ts`**, one map from error code to player-facing copy.
  - [ ] Cover every `PlaylistErrorCode`, the client-side `network` case, and an unknown-code fallback
  - [ ] The client owns the copy; the server's `message` field is not rendered. One wording source,
        and client-side parse failures have no server message to use anyway
  - [ ] Friendly wording for `not-found-or-private` specifically — Spotify gives no signal that
        separates the two, so the copy must cover both honestly ("private, deleted, or not found")
- [ ] **Step 7 — Build `usePlaylist.ts`**: request state (idle / loading / error / result) over the
      client, aborting in flight on unmount and on a new submission. No logic beyond that — anything
      that accumulates here belongs in the client, which is tested.
- [ ] **Step 8 — Build `LandingScreen.tsx`.**
  - [ ] Text input with validation via `parsePlaylistUrl` on submit; a short link passes validation
        and is submitted for the server to resolve
  - [ ] Inline error states from the message map, both for client-side parse failures and for server
        codes
  - [ ] A disabled/loading submit state while the request is in flight
  - [ ] **Suggested playlists** — the five Phase 0 ids from `plan.md` §5 (Today's Top Hits, Rock
        Classics, RapCaviar, Reggae Classics, All Out 80s). Clicking one fills and submits the input
        exactly as if pasted
  - [ ] Suggested-playlist labels are genre/era names, not track information — the landing screen is
        a pre-Start surface and must leak nothing about any deck
- [ ] **Step 9 — Re-verify the five suggested playlist ids before shipping.** `plan.md` says to check
      `entity.uri` in the embed JSON rather than just a 200 response, because editorial playlists get
      refreshed by Spotify. Record the date verified alongside the ids.
- [ ] **Step 10 — Build `PreparingScreen.tsx`** for the card-1 gate. This is the **only** status a
      loading screen may render for.
  - [ ] **Count-only.** No track titles, no artists, no years — findings entry #6 lists loading
        screens and progress text as leak surfaces explicitly. Wording along the lines of "dealing
        your deck" plus an optional resolved/total count from `resolvedCount` and `deck.length`
  - [ ] Set expectations honestly: one lookup is 1.3–3.6 s cold, 0 ms cached, and the gate waits on
        exactly one card
  - [ ] Handle `yearLookupsUnavailable` arriving during `preparing`: the reducer moves to `playing`
        anyway, so this screen must not assume it will only ever leave on a resolved year
- [ ] **Step 11 — Build `NoticeBanner.tsx`** and the notice logic. All notices are non-blocking and
      none may ever gate Start.
  - [ ] `truncated` → "this playlist may have more tracks than shown — only the first
        `MAX_EMBED_TRACKS` could be loaded"
  - [ ] `skippedCount > 0` → "n tracks could not be read and were left out". Normally 0, so nothing
        renders in the common case
  - [ ] `yearLookupsUnavailable` → years are unavailable for this deployment; the deck is still
        playable. This is the one notice derived from game state rather than from the fetch
  - [ ] Rendered on the preparing screen **and** retained on the game screen until dismissed, since
        `preparing` can last barely over a second and a notice nobody can read is not a notice
  - [ ] Dismissible, and dismissal is container state — it must not reappear on every card
- [ ] **Step 12 — Build `Hud.tsx`**: cards remaining, from `cardsRemaining`. No Exit button — Exit
      lives on the card itself, per Phase 4. Counts only; no track information.
- [ ] **Step 13 — Build `EndScreen.tsx`**: cards played, plus Restart and New playlist.
  - [ ] Cards played comes from the deck length for a natural finish; the container supplies it
  - [ ] Restart re-deals the same tracks with a fresh seed via `start(state.deck, state.playlist)` —
        works after a resumed session too, because it needs no remembered fetch result. Already-resolved
        years travel with the cards, so a restart costs zero lookups
  - [ ] New playlist returns to `idle`
- [ ] **Step 14 — Rewrite `src/App.tsx` as the real container.** The only caller of
      `useGameSession()`.
  - [ ] Switch on `state.status`: `idle` → landing, `preparing` → preparing screen, `playing` →
        game screen, `ended` → end screen or landing depending on the end-reason flag
  - [ ] Hold the end-reason flag (`'exited' | 'finished' | null`); set `'exited'` in the Exit handler
        immediately before calling `end()`; reset it to null in the start handler
  - [ ] On a successful playlist fetch, call `start(result.cards, result.playlist)` and keep the
        notices from the result in container state
  - [ ] Stop audio on Exit (plan 1 exposes `stop()`; `GameScreen` already stops on card change and
        flip)
  - [ ] Do not reach for `dispatch` — it is deliberately not exposed, so a screen cannot invent a
        transition the reducer's tests never considered
  - [ ] Delete plan 1's temporary harness comment and mount
  - [ ] Resume works for free: `useGameSession` restores a persisted session in its lazy initializer,
        so a reload lands directly on the game screen. Verify it, and verify Restart from a resumed
        session
- [ ] **Step 15 — Verify progressive loading against a real deployment** (carried over from Phase 3,
      whose plan left this unticked).
  - [ ] Deploy a preview with Upstash configured — the shared cache and the rate-limit gate are both
        backed by the same variables, and without them the gate paces nothing
  - [ ] Confirm Start waits on **one** lookup on a cold deck, not the whole deck
  - [ ] Confirm cards 2..n fill during play, and that flip / swipe / QR / audio / Exit never block on
        a pending year
  - [ ] Confirm the priority jump: advance rapidly past the resolver and watch the current card get
        served next
  - [ ] Confirm a 429 backs off rather than failing a card
  - [ ] Measure the 50-track cold-deck wall clock — owed since Phase 2 and still unmeasured
  - [ ] Confirm exactly one `/api/year` request per card under React 19 StrictMode by counting
        requests in the network tab, not by assuming — `use-game-session.ts` has a guard for this
        that nothing tests
- [ ] **Step 16 — Run the full gate**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus
      the two pre-deploy greps (`@/` under `api/`, and `.js` extensions on relative imports under
      `api/`), then confirm `/api/hello` responds after deploying.

---

## Unit Tests

**Pure and node-environment (no jsdom):**

- [ ] `should accept a legacy /user/{user}/playlist/{id} URL` — covers step 1 in
      `shared/spotify-url.test.ts`
- [ ] `should accept the legacy path with a locale prefix and query params` — covers the combination
- [ ] `should still reject a legacy path whose id is not 22 base62 characters` — covers that the
      strict id check survived the change
- [ ] `should recognise a spotify.link URL as a short link` — covers step 2
- [ ] `should not recognise an open.spotify.com URL as a short link` — the negative case
- [ ] `should resolve a short link through one redirect` — covers `api/_lib/short-link.test.ts`
- [ ] `should follow up to the hop limit and then fail` — covers the loop guard
- [ ] `should refuse a redirect to a non-Spotify host` — **the SSRF guard**, the most important test
      in this file
- [ ] `should report upstream-unavailable when the fetch rejects` — covers the network path
- [ ] `should not follow redirects automatically` — covers that `redirect: 'manual'` is in force, so
      the allow-list is actually consulted
- [ ] `should return the playlist result for a 200 body` — covers `src/game/playlist-client.test.ts`
- [ ] `should map each typed error code to a result` — one case per `PlaylistErrorCode`
- [ ] `should distinguish upstream-unavailable from unexpected-payload on a 502` — covers the shared
      status
- [ ] `should fall back to the status when the body has no recognisable code` — covers the untyped
      `method-not-allowed` / `internal-error` cases
- [ ] `should report unexpected-payload for a 200 whose body is not JSON` — **covers the `pnpm dev`
      trap**, where Vite returns transpiled function source with status 200
- [ ] `should report unexpected-payload for a 200 missing cards or playlist` — covers shape
      validation
- [ ] `should report network when the fetch rejects` — covers offline
- [ ] `should pass the abort signal through and honour it` — covers cancellation
- [ ] `should map every playlist error code to copy` — covers `src/game/messages.ts`, asserting the
      map is exhaustive so a future code addition fails a test rather than rendering blank

**jsdom component tests:**

- [ ] `should show an inline error for an unparseable URL without submitting` — covers
      `LandingScreen.test.tsx` validation
- [ ] `should submit a valid playlist URL` — covers the happy path
- [ ] `should submit a spotify.link URL instead of rejecting it` — covers the short-link decision
- [ ] `should render server error copy from the error code` — covers the message map wiring
- [ ] `should disable the submit control while loading` — covers double-submit
- [ ] `should render five suggested playlists` — covers the section
- [ ] `should submit the corresponding URL when a suggestion is clicked` — covers fill-and-submit
- [ ] `should not render any track information` — the landing screen's leak assertion
- [ ] `should render a count-only progress line` — covers `PreparingScreen.test.tsx`
- [ ] `should not render any track title, artist, or year` — the preparing screen's leak assertion,
      which findings #6 names explicitly as a surface
- [ ] `should render the truncation notice only when truncated` — covers `NoticeBanner.test.tsx`
- [ ] `should render the skipped-track notice only when the count is above zero` — covers the common
      no-op case
- [ ] `should render the years-unavailable notice from game state` — covers the misconfigured
      deployment
- [ ] `should stay dismissed once dismissed` — covers the dismissal state living in the container
- [ ] `should render cards remaining` — covers `Hud.test.tsx`
- [ ] `should not render an exit control` — covers that Exit stays on the card
- [ ] `should render cards played and both actions` — covers `EndScreen.test.tsx`
- [ ] `should invoke restart and new-playlist callbacks` — covers the wiring

**Container tests (jsdom, `src/App.test.tsx`, with a stubbed `StorageLike` and a stubbed fetch):**

- [ ] `should render the landing screen when idle` — covers the status switch
- [ ] `should render the preparing screen while preparing` — covers the card-1 gate screen
- [ ] `should render the game screen while playing` — covers the main path
- [ ] `should render the end screen when the deck runs out` — covers `'finished'`
- [ ] `should render the landing screen after exit` — **covers the end-reason flag**, the decision
      this plan made instead of touching the reducer
- [ ] `should reset the end reason when a new game starts` — covers the flag not leaking into the
      next session
- [ ] `should keep the game playable while cards 2..n have no year` — the invariant `plan.md` warns
      regresses silently, now asserted at the UI level as well as in the reducer
- [ ] `should resume a persisted session on mount` — covers the resume path through the container
- [ ] `should restart from the current deck` — covers Restart working after a resume, with no
      remembered fetch result

---

## Documentation Updates

- [ ] `docs/plans/plan.md` — tick Phase 6 (all seven); record the two URL-form fixes; note that the
      revealed-side unconfirmed-year marking shipped in plan 1; and close §6's open questions — the
      `confidence: 'none'` follow-on (the card stays in the deck and reveals a "check this yourself"
      prompt) and anything the suggested-playlist re-verification turns up
- [ ] `docs/plans/plan.phase-3.md` — tick its "verify progressive loading against a real playlist"
      step with the measurements from step 15, including the 50-track cold wall clock
- [ ] `docs/plans/plan.phase-4-6-screens.md` — this file: tick steps, add Execution Notes
- [ ] `docs/api.md` — short-link resolution in `/api/playlist` (allow-list, hop limit, which existing
      error codes a failure maps to), and the newly accepted URL forms. The contract mirror there is
      currently accurate and should stay that way
- [ ] `AGENTS.md` — Phase 6 complete, Phase 7 next; the new `src/components/` and `src/hooks/`
      contents; and that `src/App.tsx` is now the real container rather than a placeholder
- [ ] `docs/architecture.md` — the data-flow diagram now has a real browser-side client; §7 Phase 6
      built; where the client/hook/screen split lives and why the client takes an injected `fetch`
- [ ] `docs/development.md` — **that the app is only playable end-to-end under `npx vercel dev`, not
      `pnpm dev`**, because Vite serves `api/` source as text with status 200; the Upstash warning
      before playing a full deck locally (an unpaced deck sends ~2 requests per track at MusicBrainz's
      1 req/s limit); manual curl checks for a short link and a legacy `/user/` link; and refreshed
      test counts
- [ ] `docs/agent_findings.md` — new dated entries, and **tell the developer** they were added:
  - [ ] Exit and deck-exhaustion are indistinguishable in `GameState` — both are `status: 'ended'`
        and `currentIndex` does not separate them either. Record the container-flag resolution and
        why the reducer was left alone, since the next person to want an end reason will look here
  - [ ] `pnpm dev` cannot exercise the playlist client at all: Vite returns transpiled function
        source with status 200, so the failure surfaces as a JSON parse error rather than a 404. The
        client turns it into `unexpected-payload`. This is already noted for `api/` in
        `development.md`; the finding is that it now has a *client-visible* shape
  - [ ] The short-link resolver's SSRF consideration — following a redirect from a user-supplied URL
        needs a host allow-list, and this is the first place in the repo where user input decides an
        outbound request target
  - [ ] Whatever step 15 measures: the 50-track cold wall clock, the StrictMode request count, and
        whether the priority jump behaves as designed under real latency. This is the entry with the
        longest shelf life, because none of it can be measured locally

---

## Testing Strategy

- **Unit tests:** the URL forms, the short-link resolver, the playlist client and the message map are
  all pure or injectable and are tested exhaustively in the node environment, offline. Screens are
  tested in jsdom with fixture data.
- **Integration tests:** `src/App.test.tsx` is the real integration seam — a stubbed fetch and a
  stubbed storage drive the whole flow from landing through preparing, playing, and both ways out.
  The "playable while cards 2..n are unresolved" assertion belongs here as well as in the reducer,
  because that is the invariant `plan.md` says regresses silently and a UI-level guard is what
  catches a screen that decides to wait for a year.
- **Manual verification:**
  - `npx vercel dev`, then paste a real playlist URL and play through several cards. `pnpm dev`
    cannot do this — the playlist request returns function source.
  - Each of the five suggested playlists loads and deals a deck.
  - A `spotify.link` URL from a phone's Spotify share sheet loads the right playlist.
  - A legacy `/user/{user}/playlist/{id}` URL loads instead of erroring.
  - A private/deleted playlist and a track URL each produce their inline error copy.
  - The truncation notice appears for a playlist at exactly 100 tracks and never blocks Start.
  - Exit returns to the landing screen; finishing the deck reaches the end screen; Restart re-deals
    with a fresh order and costs no lookups.
  - Reload mid-deck and confirm the session resumes on the same card.
  - Step 15 in full, against a preview deployment with Upstash configured. Do not take timings
    through `vercel dev` — it adds ~4 s per request.

---

## Assumptions & Decisions

| # | Assumption / Decision | Rationale |
|---|---|---|
| 1 | **Status-driven screen switch, no router** | Chosen by the developer over `react-router` and over a hash-only deep link. `GameState.status` already models exactly the four screens; a router adds a dependency plus a second source of truth, and a browser Back mid-deck is a transition the reducer never modelled. No screen in v1 is worth linking to |
| 2 | **Exit vs deck-exhaustion resolved with a container-local flag**, not a reducer change | Chosen by the developer over adding an `endReason` field to `GameState`. Both paths produce `status: 'ended'` (`reducer.ts` 127 and 137) and `currentIndex` cannot separate them. The flag keeps Phase 3's reducer, types, persistence format and 89 tests untouched. It is ephemeral by design: `END` already clears the saved session, so a refresh belongs on the landing page regardless |
| 3 | **Both findings-#4 URL gaps are fixed**: legacy `/user/` path and `spotify.link` short links | Chosen by the developer over fixing only the legacy path. The share sheet is how a phone user gets a link, so short links are the common case, not an edge case. The legacy path is a pure `shared/` fix; short links need a server-side redirect follow |
| 4 | `parsePlaylistUrl`'s return type is unchanged; a separate predicate recognises short links | A third result variant would ripple into `api/playlist.ts`'s exhaustive handling and into every existing test, to express something the caller can ask about directly |
| 5 | Short-link resolution adds **no new `PlaylistErrorCode`** | A network failure is already `upstream-unavailable`; a link resolving to a track falls through `parsePlaylistUrl` as `unsupported-entity`. Keeping the union stable means the client's message map needs no new entry |
| 6 | The resolver follows redirects manually with a **Spotify host allow-list** and a hop limit | User input decides an outbound request target for the first time in this repo. `redirect: 'manual'` is what makes the allow-list enforceable — automatic following would consult nothing |
| 7 | The playlist client mirrors `year-client.ts`: plain function, injected `fetch`, discriminated result, never throws; the hook is thin | It is why the year client has 16 offline tests and no jsdom. Anything that accumulates in the hook instead belongs in the client — the same rule `use-game-session.ts` states about itself |
| 8 | Error copy lives in one client-side map keyed by code; the server's `message` is not rendered | One wording source, and a client-side parse failure has no server message. An exhaustiveness test means a new code fails a test rather than rendering an empty string |
| 9 | Notices render on the preparing screen **and** persist on the game screen until dismissed | `preparing` can be shorter than the time it takes to read a sentence — the card-1 gate is one lookup. A notice nobody can read is not a notice |
| 10 | **Restart re-deals from `state.deck`** rather than a remembered fetch result | Reshuffling a shuffled deck with a new seed is equally random, it works after a resumed session where the fetch result is gone, and it removes a container field that could go stale. Resolved years travel with the cards, so Restart costs zero lookups |
| 11 | Phase 3's real-deployment verification of progressive loading is carried out here | It needs a UI to exercise; this plan is what produces one. Doing it in Phase 3 would have meant building a harness to throw away |
| 12 | The preparing screen, the landing screen and the HUD are **count-only** | Findings #6 names loading screens, progress text and notices as leak surfaces. The person pasting the playlist is a player; there is no host role in this app |
| 13 | No year editing, and no pre-Start year review of any kind | Decided for this task in plan 1, and `plan.md` §6 resolved the pre-Start question outright: any screen listing years before Start hands a player the answers to the whole deck |
| 14 | Suggested-playlist ids are re-verified via `entity.uri` before shipping, with the date recorded | `plan.md` requires it: editorial playlists get refreshed by Spotify, and a 200 response is not evidence the id still means the same playlist |
| 15 | Styling stays minimal; responsive, focus, a11y and offline states are Phase 7 | `plan.md` assigns them to Phase 7, and `AGENTS.md` forbids building ahead of the current phase |

---

## Open Questions

- [ ] Does `link.tospotify.com` still appear alongside `spotify.link` in current share-sheet output?
      Check quickly in step 2; covering both costs one extra host in the allow-list.
- [ ] Should the preparing screen show a resolved/total count at all, or only a status line? The count
      is leak-free, but on a cached playlist the screen may appear for well under a second, and a
      number that flashes reads as jitter.
- [ ] What should the end screen report as "cards played" if the player exits early? The container
      routes an exit to the landing screen, so the case may never arise — confirm during step 14
      rather than designing for it.
- [ ] Should Restart keep the same seed (identical order, for a rematch) or take a fresh one (a new
      shuffle)? The plan assumes fresh; a rematch is arguably the more useful behaviour and is one
      argument away, since `start` already accepts an optional seed.
- [ ] Does a resumed session re-attempt `confidence: 'none'` cards? Phase 3 left this open and
      defaulted to no. Worth confirming it still looks right once a real deck has been played.
- [ ] Two tabs share one `localStorage` key and the last write wins, silently clobbering the other
      game. Phase 3 accepted this for v1; a `storage`-event guard is the fix if it ever bites.

---

## Out of Scope

- Everything in plans 1 and 2 — the card, QR, audio, the test environment, gestures, the stacked
  deck, keyboard controls.
- Any change to Phase 3's reducer, resolver, persistence format, or types. Decision 2 exists
  specifically to keep that true.
- Pagination past 100 tracks and the manual track-paste fallback. Phase 0 deferred both past v1; the
  truncation notice is what substitutes for them.
- Empty/offline/error-state polish, responsive breakpoints, focus styling, ARIA beyond accessible
  names, `prefers-reduced-motion`, the Lighthouse pass, and lazy-loading the QR and audio code —
  Phase 7.
- The shareable deck URL (playlist id + seed), saved decks, PWA, and PDF export — Phase 8. `start`'s
  optional `seed` parameter is the door Phase 3 left open for the first of those.
- Any credentialed Spotify path. `plan.md` §2 is explicit that this is a product decision, not an
  oversight.
