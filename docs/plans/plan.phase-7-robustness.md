<!-- Plans for Phase 7 (in order):
  1. plan.phase-7-look.md         — @theme tokens, responsive layout, prefers-reduced-motion, focus/ARIA
  2. plan.phase-7-robustness.md   — empty/error/offline states, bundle splitting, Lighthouse, README + docs  ← this file
-->

# Plan: Phase 7 (second half) — Failure States, Bundle and Documentation

> **Phase:** 7 — Polish (`plan.md` §5)
> **Date:** 2026-08-05
> **Author:** Aleix Rabassa
> **Depends on:** [plan.phase-7-look.md](plan.phase-7-look.md) — **for the Lighthouse step only.** The Accessibility score is a measurement of that plan's output, so running Lighthouse first would produce a number that is obsolete before it is recorded. Every other step here is independent and can run in parallel with plan 1.

---

## Overview

Three of the four remaining Phase 7 checkboxes are about what happens when something is wrong, how much JavaScript the app ships, and whether the documentation still describes the app that exists. All three are in worse shape than the phase plan implies.

The failure surface has one genuine hole, found by reading the code rather than inferred from the plan: `src/game/playlist-client.ts` treats an **empty** `cards` array as a payload it cannot parse, so a public playlist with no tracks — or one whose every track was skipped — produces `unexpected-payload`, whose copy reads *"Spotify returned something we could not read. This is a problem on our side, not with your link."* That is a confident, wrong answer to a legitimate situation. Offline is the other gap: `navigator.onLine` is never consulted, so a player with no connection waits out a fetch to be told to check their connection. Meanwhile a render-time exception anywhere in the tree white-screens the app, because there is no error boundary.

The bundle is a single **368.53 kB** chunk, 118.55 kB gzipped, measured 2026-08-05 — no code splitting of any kind. `qrcode` is a static import in `QrCode.tsx` even though the landing screen never renders a QR code, and its own header comment already notes that lazy-loading it is a Phase 7 item.

The README claims *"Status: Phase 2 (data layer), half built… There is no game yet — `src/App.tsx` is a placeholder."* The app has been playable end to end since Phase 6.

Finally this plan resolves, rather than builds, the **"Added by" attribution** item: it re-checks whether the field Phase 0 could not find has appeared, records the answer, and relocates the item to Phase 8 with the evidence attached.

---

## Dependency Contract

### Requires from plan.phase-7-look

| Output                                            | Description                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The focus, contrast and ARIA fixes                | Consumed **only** by the Lighthouse step. Running the audit before them measures the old app; every other step here is unblocked.  |
| The `@theme` block in `src/index.css`             | The new error-boundary and empty-state copy should consume the same tokens rather than reintroducing literals. Soft dependency: if plan 1 has not landed, write literals and note them for plan 1's step 2 inventory. |

### Produces for downstream plans

| Output                                                          | Consumed by                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Recorded Lighthouse scores and bundle sizes                     | Any future performance work; `plan.phase-8` PWA item, which needs a baseline to justify itself        |
| The re-spike result for `added_by`                              | `plan.phase-8` — the item moves there with its evidence, or `plan.md` §2 is re-opened                 |
| A rewritten README and a current `development.md` §8            | Every future session; this is the file a new contributor reads first                                  |

---

## Scope & Affected Areas

| Area                                          | Type     | Notes                                                                                                             |
| --------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/game/playlist-client.ts`                 | Modified | Two new codes (`offline`, `empty-playlist`); an injected `isOnline` predicate                                      |
| `src/game/messages.ts`                        | Modified | Copy for the new codes. The exhaustive `Record` makes this a typecheck failure until done                          |
| `src/hooks/usePlaylist.ts`                    | Modified | Only if the online check needs wiring through; the aim is that it does not                                         |
| `src/components/ErrorBoundary.tsx`            | New      | A class component — `componentDidCatch` has no hook equivalent, and no new dependency is being added               |
| `src/main.tsx`                                | Modified | Wraps `<App />` in the boundary                                                                                    |
| `src/components/QrCode.tsx`                   | Modified | `qrcode` moves behind a dynamic `import()` inside the existing effect                                              |
| `index.html`                                  | Modified | `meta description` and `theme-color`, both Lighthouse items                                                        |
| `README.md`                                   | Modified | Substantially rewritten — status, env vars, deploy, known limitations                                              |
| `src/game/playlist-client.test.ts`            | Modified | New codes and the offline predicate, all in `node`                                                                 |
| `src/game/messages.test.ts`                   | Modified | Coverage for the new codes                                                                                         |
| `src/components/ErrorBoundary.test.tsx`       | New      | jsdom                                                                                                              |
| `src/components/QrCode.test.tsx`              | Modified | The dynamic import changes how the module is stubbed                                                                |
| `src/components/LandingScreen.test.tsx`       | Modified | The new error copy renders in the existing slot                                                                     |
| `docs/api.md`                                 | Modified | The new client-side codes, and that neither comes from the server                                                  |
| `docs/architecture.md`                        | Modified | §3 — the boundary's position, the offline check, the QR chunk split                                                |
| `docs/development.md`                         | Modified | §5 manual checks, §7 deploy, §8 known limitations                                                                   |
| `docs/agent_findings.md`                      | Modified | The empty-playlist defect, the bundle numbers, the Lighthouse scores, the `added_by` re-spike, the suite flake      |
| `docs/plans/plan.md`                          | Modified | §5 — three checkboxes, and the "Added by" item relocated to Phase 8                                                 |
| `AGENTS.md`                                   | Modified | Current-phase line; the boundary as a new structural fact                                                           |

---

## Chosen Approach

**Extend the mechanisms that already exist rather than add screens.** The error path in this app is already well shaped: `playlist-client.ts` is the single place that produces an error code, `messages.ts` owns every sentence and its `Record<PlaylistClientErrorCode, string>` type turns a new code into a typecheck failure until its copy is written, and the landing screen already has a `role="alert"` slot to render one in. So offline and empty-playlist become **two new codes** flowing through that machinery, and no new view is created. The alternative — a dedicated `ErrorScreen` plus a `useOnlineStatus` hook wired into `App.tsx` as a fifth view — was rejected because `App.tsx` is documented as knowing exactly four statuses, one per `GameState.status`, and a fifth view outside that model is the kind of second source of truth the container's header block exists to prevent.

The one genuinely new component is an **error boundary**, because React offers no other way to catch a render exception and there is nothing existing to extend.

For the bundle: **measure, then move the library, not the component.** `qrcode` goes behind a dynamic `import()` inside `QrCode.tsx`'s existing effect. This needs no `Suspense` and introduces **no second loading state**, because the component already renders a same-size placeholder for the window in which `toDataURL` is pending — the import simply joins that same await. `React.lazy` on the component was the alternative and would have stacked a Suspense fallback on top of a placeholder that already exists, inside one 176px square.

---

## Implementation Steps

- [ ] **1. Record the bundle baseline before changing anything.** `pnpm build` on 2026-08-05 produced one chunk: `368.53 kB` JS (118.55 kB gzip), `15.23 kB` CSS (4.00 kB gzip), 473 modules. Re-run to confirm, then break the total down per dependency (`react`/`react-dom`, `motion`, `qrcode`, app code) with a source-map or module-level inspection. **Do this before step 7** — "lazy-load QR/audio code" is only worth doing where the weight actually is, and `motion` is the plausible heavyweight.
  - [ ] Note in findings that there is currently **no** manual chunking and no vendor split, so the landing screen downloads the entire game.
- [ ] **2. Add an `offline` code, detected through an injected predicate.** The code joins `PlaylistClientErrorCode` in `src/game/playlist-client.ts`; `messages.ts` then fails the typecheck until its sentence exists, which is the intended mechanism.
  - [ ] **Inject the check, do not read `navigator` directly.** `playlist-client.test.ts` is a **`node`** test with no jsdom, and reading `navigator.onLine` in the module body would break the property AGENTS.md names as the reason both HTTP clients live in `src/game/` with an injected `fetch`. Add an optional `isOnline: () => boolean` alongside the existing `fetchImpl` injection, defaulting to the real `navigator.onLine` and treating an absent `navigator` as online.
  - [ ] The check runs **before** the fetch and short-circuits it. A request that cannot succeed should not be made.
  - [ ] Keep the existing `network` code. The two are different situations: `offline` means the browser knows there is no connection; `network` means the request itself failed, which also covers a reachable browser and an unreachable server. Copy must not make them sound like the same thing.
  - [ ] `navigator.onLine` reports the presence of a network interface, not reachability — a captive portal reports online. That is exactly why `network` stays as the fallback, and it belongs in a comment.
- [ ] **3. Add an `empty-playlist` code for the real defect.** `playlist-client.ts` line ~179 returns `undefined` for `rawCards.length === 0`, which becomes `unexpected-payload` — copy that blames our own parser for a public playlist that simply has no readable tracks.
  - [ ] Separate the two cases at the parse site: not an array is a malformed payload; an empty array is a valid payload describing an empty deck.
  - [ ] Copy should say the playlist has no tracks the app can play and suggest another — and it should mention that tracks may have been skipped, since `skippedCount` reducing a deck to zero reaches the same place.
  - [ ] Verify `api/playlist.ts` does not already reject an empty track list upstream with a different code; if it does, the client's branch is for a case the server never sends, and the plan should say which layer owns it. Check before writing the branch.
- [ ] **4. Verify the private-playlist message rather than rewriting it.** `plan.md` §5 asks for a "friendly message for private playlists"; Phase 6 already shipped `not-found-or-private` with copy that names all three possibilities (private, deleted, wrong link) and explains that only public playlists work. Read it, confirm it satisfies the item, and record that it was satisfied early rather than leaving the checkbox implying unbuilt work. Change it only if reading it in place shows a real problem.
- [ ] **5. Add the error boundary.** A new `src/components/ErrorBoundary.tsx`, wrapping `<App />` in `main.tsx` inside `StrictMode`.
  - [ ] **It must never render the caught error's `message` or stack.** Props and state flow through the tree it is catching, so an error string can contain a track title, artist or year — rendering it would leak the answer through the one surface nobody thought to audit. Generic copy only. This reasoning goes in the file's header block, in the style of the leak notes in `CardHiddenSide.tsx` and `Hud.tsx`, because "show the error so the user can report it" is the natural thing for the next person to add.
  - [ ] Log the error to the console for a developer, since that is not a rendered surface.
  - [ ] Two recovery actions, and the distinction matters: **Reload** for a transient failure, and **Start over**, which clears the saved session before reloading. A corrupt or unexpected persisted session is the most plausible cause of a crash that recurs on every reload, and without the second button that state is unescapable except through devtools. Reuse the existing clear-session path in `src/game/persistence.ts` rather than touching `localStorage` directly.
  - [ ] Make Start over's consequence explicit in its label or its adjacent line — it destroys a game in progress.
  - [ ] Place it around `<App />`, not inside it. Inside, the boundary would be unmounted by the very error that broke the tree it lives in.
- [ ] **6. Decide, and document, what happens when the connection drops mid-game — which is to add nothing.** Confirmed by reading `src/game/resolver.ts`: a `network` outcome is already classified as transient, retried with exponential backoff and jitter, and settled rather than crashing the crawl. So a mid-deck disconnect leaves the deck fully playable — the QR is a data URL and needs no network, the flip and swipe are local, and only audio previews and further year lookups stop.
  - [ ] Add **no** mid-game offline banner. `NoticeBanner` carries three notices, two derived from the fetch and one from game state, and a fourth from a live browser event would need either a reducer action (which `App.tsx` alone could dispatch) or connectivity state in the container. That is real complexity for a case where the deck keeps working.
  - [ ] Write the degradation into `development.md` §8 as a known limitation instead, in the "the deck degrades rather than dies" framing `plan.md` §4 already uses. A documented graceful degradation is a better answer here than an undocumented banner.
- [ ] **7. Move `qrcode` behind a dynamic import** in `QrCode.tsx`, inside the existing effect and awaited alongside `toDataURL`. Then re-measure.
  - [ ] The existing same-size placeholder covers the load window, so **no `Suspense` boundary and no second loading state**. Update the header comment, which currently states that lazy-loading here "would mean a second loading state for no measured gain" — the first half stops being true once the import joins the existing await, and step 1 supplies the second half.
  - [ ] The existing `.catch` already leaves the placeholder in place on failure, which now also covers a failed chunk fetch — a real case on a flaky connection, where the import fails rather than the generation. Confirm the generation-counter guard still drops a superseded result correctly when the import resolves late.
  - [ ] **Verify the win is the one intended:** the landing screen must not request the QR chunk at all. That is the actual benefit — the first screen a visitor sees no longer downloads a QR encoder — and it is checkable in the network tab.
  - [ ] Re-run `pnpm build` and record the new chunk list. If the split saves less than a few kilobytes gzipped, say so in findings and keep it anyway for the landing-screen win, or revert it and say that instead. Do not report a saving without the number.
- [ ] **8. Decide on `motion` from the step-1 measurement, not from intuition.** It is the largest non-React dependency and it is needed only by `Card` and `CardStack` — that is, only once a deck is dealt, exactly like `qrcode`.
  - [ ] If the measurement justifies it, the cleanest split is at `GameScreen` (via `React.lazy`), because that is the boundary where both `motion` and the card tree become necessary. That **does** need a `Suspense` fallback — and one exists in spirit already: the preparing screen. Consider whether the fallback can be that same screen.
  - [ ] If it does not justify it, write down the number and leave `motion` alone. "Measured, not worth it" is a result.
  - [ ] There is **no audio code to lazy-load** despite the phase plan's wording. `useCardAudio` is a hook over a native `<audio>` element with no dependency behind it; the element itself already carries `preload="none"`. Record this, because the checkbox says "QR/audio" and a future reader will look for the audio half.
- [ ] **9. Add the two `index.html` meta tags** — `description` and `theme-color`. Both are Lighthouse items and the second also fixes the browser chrome colour on a phone, where the near-black app currently sits under a default-coloured address bar. `lang="en"` and the viewport tag are already correct.
- [ ] **10. Run the Lighthouse pass, on a production build, after plan 1 has landed.** Serve with `pnpm build && pnpm preview` and audit the **landing screen** for all four categories.
  - [ ] **State the limit honestly: `vite preview` cannot reach the game screen.** It serves no `/api`, so Start fails with `unexpected-payload` — the same trap `development.md` §4 documents for `pnpm dev`. So a landing-screen audit is all a local run can produce, and the card and game screens must be audited against a **preview deployment**. Fold that into the already-owed step 15 verification (`plan.phase-4-6-screens.md`) rather than creating a second deploy errand.
  - [ ] Record all four scores with the date and what was audited. An unattributed score is not a measurement.
  - [ ] Fix what the audit finds and what is in scope. Anything it finds that belongs to Phase 8 (image formats, a service worker, caching headers) gets recorded, not fixed.
  - [ ] Treat the Accessibility score as a floor rather than a goal — an automated audit reaches a fraction of WCAG, and plan 1's screen-reader and keyboard passes are the real coverage.
- [ ] **11. Re-spike `added_by`, then relocate the item.** `plan.md` §5's attribution bullet is blocked on data, and the block is two months old.
  - [ ] Fetch the embed payload for two playlists and enumerate the **complete** track-level field union, the same method as the Phase 0 spike. Check playlist level too.
  - [ ] Confirm identity by `entity.uri` **and** `entity.name`, not by a 200 — Phase 0 records a write-race that had two agents reading the wrong playlist's data, and `LandingScreen.tsx` records the same discipline for the suggested playlists.
  - [ ] Record the result in `agent_findings.md` with the date and the playlists used, whichever way it comes out.
  - [ ] If the field is absent, as expected: move the bullet to Phase 8 in `plan.md` §5, keeping its existing reasoning and adding the re-spike as evidence. **Build no UI.**
  - [ ] If the field is present: do **not** build it here either. It re-opens the field inventory that three other decisions rest on, and it needs its own plan.
- [ ] **12. Rewrite the README.** It is the most out-of-date file in the repo and describes an app with no game in it.
  - [ ] Status: Phases 0–6 complete, Phase 7 in progress. Delete the "`src/App.tsx` is a placeholder" sentence and the "nothing in the browser calls the API" claim; both are false.
  - [ ] **Lead the Quickstart with `vercel dev`, not `pnpm dev`.** The current order tells a new contributor to run the one command under which the app cannot be played, and the failure looks like a bug in the app. Keep `pnpm dev` as what it is genuinely for — component work with HMR.
  - [ ] Environment variables: `MUSICBRAINZ_USER_AGENT`, and the two Upstash variables as a pair a deployment has both of or neither. Point at `docs/api.md` for the reference rather than duplicating it.
  - [ ] Deploy: the `/api/hello` check that returns `maxEmbedTracks: 100`, and why it is the one thing no local tool can verify.
  - [ ] Known limitations: summarise `development.md` §8 in a few lines and link it — the 100-track cap, years that are sometimes wrong, ~99.5% preview coverage, the unverified touch gestures, and the unverified progressive loading. A README that omits these oversells the app.
  - [ ] Update the test count and the docs table if `docs/` gained files.
- [ ] **13. Run the four checks** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — plus `pnpm format:check`. Confirm the new chunk count in the build output matches what step 7 and step 8 decided.

---

## Unit Tests

- [ ] `should return offline without attempting a fetch when the injected predicate says so` — covers step 2 in `src/game/playlist-client.test.ts` (**`node`**). The important half is that the fetch double is **never called**; a code returned after a pointless request is not the behaviour being built.
- [ ] `should default to online when no predicate is injected` — covers step 2's default in `playlist-client.test.ts`. Guards the real-app path, which passes nothing.
- [ ] `should treat an absent navigator as online` — covers step 2's guard in `playlist-client.test.ts`. This is the `node` environment's own case, so the test runs in the situation it describes.
- [ ] `should return empty-playlist for a well-formed response with zero cards` — covers step 3 in `playlist-client.test.ts`. The regression is `unexpected-payload`.
- [ ] `should still return unexpected-payload when cards is not an array` — covers step 3's other half in `playlist-client.test.ts`. Splitting one branch into two is exactly where the second case gets lost.
- [ ] `should have copy for every client error code` — extend the existing exhaustiveness coverage in `src/game/messages.test.ts` to the two new codes, and assert the offline and network sentences are **not identical**, since telling both situations the same thing is the failure mode of adding a code without new copy.
- [ ] `should render the new error copy in the landing screen's alert slot` — covers steps 2 and 3 end to end in `src/components/LandingScreen.test.tsx` (jsdom). One case is enough; the slot is shared.
- [ ] `should render fallback copy when a child throws` — covers step 5 in a new `src/components/ErrorBoundary.test.tsx` (jsdom). Render a deliberately throwing child. React logs a caught error to the console during this test; silence it locally in the test rather than globally.
- [ ] `should not render the error message or stack` — covers step 5's leak rule in `ErrorBoundary.test.tsx`. Throw an error whose message contains a recognisable track title and assert that string is absent from the document. This is the most important test in the file and it belongs to the same family as the existing hidden-side leak assertions.
- [ ] `should clear the saved session when Start over is pressed` — covers step 5 in `ErrorBoundary.test.tsx`, with an injected `StorageLike` in the shape `persistence.ts` already uses.
- [ ] `should not clear the saved session when Reload is pressed` — covers the distinction between the two actions. Without this, the two buttons can silently become one.
- [ ] `should render children unchanged when nothing throws` — covers the boundary's transparency in `ErrorBoundary.test.tsx`. Cheap, and it catches a boundary that renders its fallback unconditionally.
- [ ] `should generate a code after the library loads` — update `src/components/QrCode.test.tsx` for step 7. The existing module stub needs to satisfy a dynamic import; how the current test doubles `qrcode` decides whether this is a one-line change or a restructure, so check it before estimating.
- [ ] `should keep the placeholder when the library fails to load` — covers step 7's new failure mode in `QrCode.test.tsx`. A failed chunk fetch is a real case and it must land in the same place as a failed generation.
- [ ] `should drop a superseded result when the import resolves late` — covers step 7's interaction with the existing generation counter in `QrCode.test.tsx`. Extend the existing staleness test rather than writing a new one if it already covers the shape; the added latency of an import makes the race wider, not different.

---

## Documentation Updates

- [ ] `README.md` — the rewrite in step 12. The largest single documentation task in this plan.
- [ ] `docs/api.md` — add `offline` and `empty-playlist` to the error-code reference, marked clearly as **client-side only**: the server never sends either, and a reader comparing the two lists will otherwise assume `api/playlist.ts` is missing them.
- [ ] `docs/architecture.md` §3 — the error boundary's position around `<App />` and why it cannot be inside; the offline check's position in the client and why it is injected rather than read; the QR chunk split and any `GameScreen` split from step 8.
- [ ] `docs/development.md` §5 — manual checks: the error boundary's two recovery paths, an offline submission (devtools offline throttling), the empty-playlist copy, and the QR chunk being absent from the landing screen's network tab.
- [ ] `docs/development.md` §7 — that the Lighthouse pass for the game screen needs a preview deployment, folded into the step 15 checklist rather than listed separately.
- [ ] `docs/development.md` §8 — the mid-game offline degradation from step 6, and the Lighthouse coverage limit (landing screen audited locally, game screen owed).
- [ ] `docs/agent_findings.md` — dated entries for: the **empty-playlist defect** and how reading the parse site surfaced it; the bundle baseline and the post-split numbers; the Lighthouse scores; the `added_by` re-spike result; the finding that there is no audio code to lazy-load despite the checkbox's wording; and the **test-suite flake observed 2026-08-05**, where the first `pnpm test` run reported 13 errors with only 19 of 32 files completing — consistent with the jsdom-environment files failing to initialise — then passed clean at 32 files / 408 tests on two consecutive re-runs. Environment setup time varied from 56s to 345s across those runs. Nobody should have to rediscover that a single red run may not be real. Tell the developer these were added.
- [ ] `docs/plans/plan.md` §5 — tick the empty/error/offline, Lighthouse and README checkboxes; relocate the "Added by" bullet to Phase 8 with the re-spike evidence; add a Phase 7 completion note in the style of Phases 3–6, naming what was deferred.
- [ ] `AGENTS.md` — current-phase line, the error boundary as a new structural fact, and the rule that its fallback must never render an error message.

---

## Testing Strategy

- **Unit tests:** as listed. The offline and empty-playlist work stays entirely in **`node`** tests, which is the property that makes both clients cheap to cover and the reason the online check is injected rather than read from a global.
- **Integration tests:** `src/App.test.tsx` needs no new case — neither new code reaches the container, since both are rendered by the landing screen it already drives. Re-run it as the guard that the boundary wrapping `<App />` changed nothing about the flow.
- **Manual verification:**
  - Offline: devtools offline throttling, then press Start. The message must appear immediately and no request may be made.
  - An empty or fully-skipped playlist. Constructing one may not be possible with a real public playlist; if not, verify at the client level with a stubbed response and say so rather than claiming a live check.
  - The error boundary: force a throw (temporarily, in a component), then exercise both Reload and Start over, confirming that Start over clears the saved session and Reload preserves it.
  - The QR chunk: load the landing screen with a clean network tab and confirm the chunk is absent, then deal a deck and confirm it arrives.
  - Lighthouse on `pnpm preview`, all four categories, scores recorded.
  - A mid-game disconnect: confirm the deck stays playable — flip, swipe, QR and Exit all work; only audio and further years stop.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                                                                                                                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **New error codes on the existing union, plus one error boundary. No new screen.** Considered: (a) codes + boundary; (b) a dedicated `ErrorScreen` and a `useOnlineStatus` hook as a fifth view; (c) boundary only. **Chose (a)**, developer-confirmed 2026-08-05.                     | `App.tsx` is documented as knowing exactly four statuses, one per `GameState.status`, and a fifth view outside that model is the second source of truth its header block exists to prevent. `messages.ts`'s exhaustive `Record` also means a new code cannot ship without copy — the machinery is already better than a new screen would be. (c) leaves a disconnected player waiting out a timeout. |
| 2   | **The online check is an injected predicate, not a direct `navigator.onLine` read.**                                                                                                                                                                                                | `playlist-client.test.ts` is a `node` test with no jsdom, and AGENTS.md names "every status branch is a node-environment unit test with no jsdom and no network" as the reason both clients take an injected `fetch`. A bare global read would break that for one boolean. It also mirrors the existing `fetchImpl` and `StorageLike` injections, so it is the house style, not a workaround.       |
| 3   | **`offline` and `network` stay distinct codes.**                                                                                                                                                                                                                                    | `navigator.onLine` reports an interface, not reachability, so a captive portal reports online and still fails. `network` remains the fallback that catches it, and merging the two would make one of them lie.                                                                                                                                                                        |
| 4   | **An empty `cards` array becomes its own code rather than continuing to report `unexpected-payload`.**                                                                                                                                                                              | The current copy blames our parser for a valid response. It is a small defect with a confidently wrong message, and confidently wrong is worse than vague.                                                                                                                                                                                                                           |
| 5   | **The error boundary never renders the error's message or stack.**                                                                                                                                                                                                                  | Props flow through the tree it catches, so an error string can contain a track title, artist or year. This is the same leak rule the card faces, the HUD and the preparing screen already carry — applied to the one surface that only exists when something has already gone wrong, which is precisely when nobody is auditing.                                                        |
| 6   | **Two recovery actions, and Start over clears the saved session.**                                                                                                                                                                                                                  | A corrupt persisted session is the most plausible cause of a crash that recurs on every reload, and Reload alone cannot escape it. Two buttons make the distinction explicit instead of guessing which the player needs.                                                                                                                                                              |
| 7   | **A mid-game disconnect gets no banner.** Verified, not assumed: `resolver.ts` already classifies `network` as transient and retries it with backoff and jitter.                                                                                                                     | The deck stays playable — the QR is a data URL, the flip and swipe are local. A fourth notice would need connectivity state in the container or a new reducer action for a case that already degrades gracefully. Documented in `development.md` §8 instead.                                                                                                                          |
| 8   | **Measure the bundle first, then move the library — not the component.** Considered: (a) measure then dynamic `import()`; (b) `React.lazy` on components; (c) both. **Chose (a)**, developer-confirmed 2026-08-05.                                                                    | The dynamic import joins an await that already exists, so it needs no `Suspense` and adds no second loading state — the same-size placeholder already covers the window. (b) would stack a Suspense fallback on a placeholder inside one 176px square. Measuring first is what stops the phase from splitting a 20 kB library while a larger one ships eagerly.                        |
| 9   | **There is no audio code to lazy-load, despite the checkbox saying "QR/audio".**                                                                                                                                                                                                     | `useCardAudio` is a hook over a native `<audio>` element with no dependency behind it, and the element already carries `preload="none"`. Recorded rather than silently skipped, because the wording will send the next reader looking.                                                                                                                                                |
| 10  | **The local Lighthouse pass covers the landing screen only.**                                                                                                                                                                                                                        | `vite preview` serves no `/api`, so Start fails with `unexpected-payload` and the game screen is unreachable — the same trap `development.md` §4 documents for `pnpm dev`. The game-screen audit attaches to the already-owed preview-deployment verification rather than becoming a second deploy errand.                                                                             |
| 11  | **"Added by" is re-spiked and relocated, never built.** Considered: (a) re-spike then move to Phase 8; (b) move without checking; (c) build it. **Chose (a)**, developer-confirmed 2026-08-05.                                                                                        | Phase 0's field inventory is two months old and three other decisions rest on it, so re-checking is cheap insurance. Building it requires re-opening `plan.md` §2's no-credentials decision, which is a product decision about the audience, not a UI task.                                                                                                                          |
| 12  | **The README is rewritten rather than patched.**                                                                                                                                                                                                                                     | Its status paragraph, its "no game yet" claim and its Quickstart ordering are all wrong now. Patching a file whose premise has changed produces a document that contradicts itself in places nobody reads carefully.                                                                                                                                                                 |

---

## Open Questions

- [ ] **Does `api/playlist.ts` already reject an empty track list, and with what code?** Decides whether step 3's client branch is reachable in production or only through a stub. Check before writing it; if the server owns the case, the plan says so and the client branch stays as a guard with a comment saying it is one.
- [ ] **How much of the 368.53 kB is `motion`?** Step 8 is entirely contingent on the step-1 answer. If it is a small fraction, the honest outcome is to record the number and stop.
- [ ] **Does the existing `QrCode` test double survive a dynamic import?** Determines whether step 7's test work is one line or a restructure. Read `QrCode.test.tsx` before estimating.
- [ ] **Can a genuinely empty public Spotify playlist be created and read through the embed endpoint** for a live check of the new copy, or does that case only exist behind a stub? Affects what the manual checklist can honestly claim.
- [ ] **Is the jsdom-environment flake from 2026-08-05 reproducible, and does it correlate with machine load?** Recorded in findings either way. It matters beyond this phase: a red suite that goes green on a re-run erodes the value of the pre-commit checks, and both plan 1 and this plan add jsdom files.

---

## Out of Scope

- **`@theme` tokens, responsive layout, `prefers-reduced-motion`, focus states and ARIA** — all in [`plan.phase-7-look.md`](plan.phase-7-look.md).
- **Building "Added by" attribution.** Step 11 re-spikes and relocates it. No UI, and no re-opening of `plan.md` §2.
- **A mid-game offline banner.** Decision 7, with the reasoning recorded rather than the work deferred.
- **The step 15 progressive-loading verification itself** (`plan.phase-4-6-screens.md`) — still owed, still needs a preview deployment with Upstash configured, and still carries the 50-track cold-deck wall clock and the StrictMode request count. This plan **adds** the game-screen Lighthouse audit to that errand; it does not discharge it.
- **The real-device touch pass and the Android lock-screen check.** Waived and owed respectively, per `development.md` §5. Neither is a Phase 7 item.
- **PWA, offline caching, a service worker.** Phase 8, and an offline-capable app is a different product decision from an app that fails clearly when offline.
- **CI, pre-commit hooks, or automating the four checks.** The repo deliberately has none; adding them is not a polish item.
- **Retrying a failed playlist fetch automatically.** The player has a Start button; a silent retry loop against an endpoint outside Spotify's terms is not a thing to add.
