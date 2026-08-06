<!-- Plans for Phase 8 (in order):
  1. plan.phase-8-look-and-shell.md  — neon-ring card design, contrast re-audit, PWA, icon set
  2. plan.phase-8-features.md        — shareable deck URL, saved-playlist library, PDF export, audio across the flip  ← this file
  3. plan.phase-8-added-by.md        — the "Added by" decision. No code.
-->

# Plan: Phase 8 (second of three) — Sharing, Saving, Printing, and One Reversal

> **Phase:** 8 — Nice-to-haves (`plan.md` §5)
> **Date:** 2026-08-06
> **Author:** Aleix Rabassa
> **Depends on:** [plan.phase-8-look-and-shell.md](plan.phase-8-look-and-shell.md) — **softly, and for
> two things only.** The PDF export consumes token _names_ rather than values (it deliberately prints
> on a light palette; see decision 6), and the new PDF dependency wants measuring against that plan's
> post-redesign Lighthouse baseline rather than Phase 7's. Every step below can be built before plan 1
> lands.

---

## Overview

Three of Phase 8's items — the **shareable deck URL**, **multiple decks / saved playlists**, and the
**printable PDF export** — plus one behaviour change the developer asked for on 2026-08-06 that is not
in `plan.md` at all: **the song must keep playing when the card is flipped, and stop only when the
player moves to the next card.**

That last one is a **reversal of a Phase 4 decision**, and it is listed first here because it is small,
it is the only item that changes existing behaviour rather than adding to it, and reversals in this
repo are documented rather than quietly applied. `GameScreen` currently carries two stop rules and
says so in its header: audio stops on flip and on card change. The flip rule was Phase 4's own
reasoning — "once the answer is on screen the preview has no job left" — and playing the game
disagrees with it. Hearing the song while reading the year is the point of the reveal. The rule's
second justification, that a lingering preview would bleed into the next card, is **already covered by
the card-change rule**, which is keyed on card id and is also what makes a swipe stop the audio. So
one effect is deleted and nothing replaces it.

The three features are independent of each other but two of them share a fact worth stating once:
**a deck is not perfectly reproducible from a playlist id and a seed.** A card whose year lookup finds
nothing is removed from the deck, and which cards those are depends on what MusicBrainz answers at play
time; an editorial playlist also has its tracks refreshed periodically. The seeded shuffle is exact —
the same seed over the same fetched track list always deals the same order — but the list itself, and
what survives year resolution, are not guaranteed to match. That is a copy problem rather than a
blocker: the link promises the same playlist shuffled the same way, not an identical deck.

The plan also carries the **real-device touch pass** that Phase 5 waived and Phase 7 left outstanding.
It belongs here rather than in plan 1 because the audio change is verifiable only on a device, the
five gesture thresholds have never met a thumb, and the same session can discharge the swipe check,
the QR scan and the Android lock-screen check that have been owed since Phase 4.

---

## Dependency Contract

### Requires from plan.phase-8-look-and-shell

| Output                             | Description                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The `@theme` token names           | The PDF's layout module reads token **names** for structure; its colour values are a separate print palette by decision 6. Soft — current names work today     |
| The post-redesign Lighthouse score | Consumed only by the PDF step's bundle check. If plan 1 has not landed, measure against Phase 7's Performance 99 / LCP 1.6 s and re-check afterwards           |

### Produces for downstream plans

| Output | Consumed by  |
| ------ | ------------ |
| —      | No downstream |

---

## Scope & Affected Areas

| Area                                       | Type     | Notes                                                                                                            |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/components/GameScreen.tsx`            | Modified | The stop-on-flip effect and `wasFlippedRef` are deleted; the header's "Two stop rules" block becomes one          |
| `src/components/GameScreen.test.tsx`       | Modified | The stop-on-flip test inverts; the stop-on-card-change and stop-on-exit tests stay exactly as they are            |
| `src/hooks/useCardAudio.ts`                | Modified | Comment only — `stop`'s doc line says "Called on flip, on card change, and on Exit" and one third of that is gone |
| `src/game/deck-link.ts`                    | New      | Pure parse/build for the share URL. Node tests, no DOM                                                            |
| `src/game/deck-link.test.ts`               | New      | Node environment                                                                                                  |
| `src/game/playlist-library.ts`             | New      | Pure, injected `StorageLike`, versioned key. Modelled on `persistence.ts`                                         |
| `src/game/playlist-library.test.ts`        | New      | Node environment                                                                                                  |
| `src/game/pdf-sheet.ts`                    | New      | Pure sheet geometry: grid, card positions, duplex column mirroring. Node tests                                    |
| `src/game/pdf-sheet.test.ts`               | New      | Node environment                                                                                                  |
| `src/hooks/usePdfExport.ts`                | New      | The binding half: the dynamic `import()`, QR generation per card, progress, the download                          |
| `src/App.tsx`                              | Modified | Reads the link params once; threads the seed into `start`; owns the library's storage calls                       |
| `src/App.test.tsx`                         | Modified | The link entry path, and that a saved session outranks a link                                                     |
| `src/components/LandingScreen.tsx`         | Modified | A "Your playlists" section beside `SUGGESTED_PLAYLISTS`, with a remove control per row                            |
| `src/components/LandingScreen.test.tsx`    | Modified | The new section, empty state, and removal                                                                         |
| `src/components/EndScreen.tsx`             | Modified | Three new affordances: copy link, save playlist, export PDF                                                       |
| `src/components/EndScreen.test.tsx`        | Modified | All three, plus the copy-failure path                                                                             |
| `package.json`                             | Modified | The PDF library as a **dependency** (it ships to the browser), pnpm only                                          |
| `docs/architecture.md`                     | Modified | §2 for the two new `src/game/` modules; §3 for the link entry, the library and the export chunk                   |
| `docs/development.md`                      | Modified | §5 manual rows including the device pass; §8 known limitations                                                    |
| `docs/agent_findings.md`                   | Modified | The reproducibility caveat, the PDF font gotcha, the device-pass results                                          |
| `docs/plans/plan.md`                       | Modified | §5 — three boxes, the Phase 4 audio reversal, and §6's two-tab open question restated                             |
| `AGENTS.md`                                | Modified | The audio reversal belongs in the dated-decisions block; the two new `src/game/` modules                          |
| `README.md`                                | Modified | Sharing, saving and printing, and what a shared link does and does not guarantee                                  |

---

## Chosen Approach

**The share link is query params read once on mount, fed through the path that already exists.**
`GameState.seed`'s own comment predicted this: it says the seed is "accepted as an override on `START`,
so a Phase 8 shareable URL (playlist id + seed) is a caller change rather than a reducer change", and
`useGameSession` already exposes `start(cards, playlist, seed?)`. So the reducer is untouched. `App.tsx`
reads `?playlist=` and `?seed=` on first render, submits the playlist through the same `request` the
landing form uses, holds the seed, and hands it to the `start` call the deal effect already makes.
**No router and no history push** — `App.tsx`'s header commits to exactly that, on the grounds that a
browser Back mid-deck is a transition the reducer never modelled.

Chosen over a hash fragment (marginally more private, mangled by some chat clients) and over a versioned
opaque token (the only encoding that could pin the exact card set, at the cost of an unreadable link and
an encoder nobody asked for). The reproducibility gap the token would have closed is handled by **honest
copy** instead — see decision 4.

**The library saves playlists, not sessions.** A new versioned `localStorage` key holding id, name and a
timestamp, validated field by field on read and never throwing, exactly as `persistence.ts` does. Playing
a saved entry re-fetches normally. Chosen over generalising `hitster:session:v1` into a keyed collection
of full mid-game decks, which would reopen persistence validation, `RESUME`, and localStorage quota — a
deck holds every card — and would make the known two-tab last-write-wins problem materially worse.

**The PDF is a lazy-loaded client-side library with the geometry in a pure module.** The same
decision/binding split the repo uses for gestures and the resolver: `src/game/pdf-sheet.ts` holds every
millimetre, the grid, and the duplex column mirror as pure functions over numbers, and a hook does the
dynamic `import()`, the per-card QR generation and the download. Chosen over a print stylesheet, which
costs no dependency but puts duplex alignment at the mercy of each browser's print dialog — and a Hitster
card is QR on one face and the year on the other, so misaligned duplex ruins the entire sheet rather than
looking slightly off. Server-side rendering in a function was rejected as far heavier than the problem.

**The audio change deletes an effect and adds nothing.** The card-change rule already covers the bleed
case the flip rule was half-justified by, and `CardControls` lives outside the card, so Play/Pause stays
reachable while the reveal is showing without any UI work.

---

## Implementation Steps

### A. The audio reversal

- [ ] **1. Delete the stop-on-flip effect in `GameScreen`.** Remove `wasFlippedRef` and the effect that
      calls `stop()` on the transition into flipped. Leave the card-change effect and the exit-confirm
      `stop()` untouched — they are the two rules that survive.
- [ ] **2. Rewrite the header comment.** "Two stop rules, both effects" becomes one rule, and it should
      say why the flip rule went: the bleed case is covered by the card-change rule, and hearing the song
      while reading the year is the reveal's point. A deleted rule with no explanation is a rule someone
      restores.
- [ ] **3. Fix `useCardAudio`'s `stop` doc line**, which claims it is "Called on flip, on card change,
      and on Exit". The function is unchanged; only the comment is wrong.
- [ ] **4. Invert the test.** `GameScreen.test.tsx`'s "should stop audio when the card is flipped"
      becomes an assertion that it does **not**, and it keeps the same call-order recording the file's
      other audio tests use. Confirm the card-change and exit-confirm tests still pass unmodified — if
      either breaks, the wrong effect was deleted.
- [ ] **5. Record the reversal.** This overturns a Phase 4 checkbox (`plan.md` §5, "Pause/stop audio on
      flip/next/restart") and Phase 4 is a completed phase. It goes in `plan.md` dated, in `AGENTS.md`'s
      dated-decisions block, and in `agent_findings.md` — the same treatment the five 2026-08-05
      decisions got.

### B. The shareable deck URL

- [ ] **6. Build `src/game/deck-link.ts` as pure functions.** A parser from a query string to
      `{ playlistId, seed }` or null, and a builder from an origin, an id and a seed to a URL string.
      No DOM, no `window` — the caller passes the string in. That is what keeps its tests in the node
      environment.
  - [ ] Validate the playlist id through the existing `shared/` URL parser rather than a new regex. A
        bare id is already one of the forms it accepts, so this is reuse, not a special case.
  - [ ] Validate the seed's shape and bound its length. The app generates the seed, so its alphabet is
        known; anything else is rejected and the link is treated as absent. An unvalidated seed goes
        into `hashSeed` and then into a persisted session.
  - [ ] A malformed link **falls back to the plain landing screen with no error**. Someone mangling a
        URL in a chat client is not a failure state worth a red banner.
- [ ] **7. Read the link once, in `App.tsx`, and never again.** A lazy state initialiser or a ref — not
      an effect that can re-run. Accept the query string as an optional prop the way `storage` and
      `fetchImpl` already are, so `App.test.tsx` drives it without touching `window.location`.
- [ ] **8. Decide and implement the precedence: a saved session outranks a link.** If there is a
      resumable session, resume it and ignore the params. Opening an old share link should not silently
      discard a game in progress, and `RESUME` already runs before anything else.
- [ ] **9. Thread the seed into the deal.** Hold it beside the pending request; the existing deal effect
      passes it as `start`'s third argument. The effect's identity guard on the result object must keep
      working — the seed rides along, it does not become a second trigger.
- [ ] **10. Leave the address bar alone.** No `pushState`, no `replaceState`. The params staying visible
      means a reload re-deals the same deck and the link can be copied again from the bar; stripping
      them would be the app's only history manipulation, for no gain.
- [ ] **11. Add the copy affordance to the end screen.** Built from `state.playlist.id` and
      `state.seed` **at click time** — Restart deals a fresh seed, so a link captured earlier would be
      the wrong one.
  - [ ] `navigator.clipboard.writeText` needs a secure context and can reject. Handle the failure with a
        visible fallback (the link as selectable text) rather than a silent no-op.
  - [ ] Confirm the copy in a `role="status"` region. Safe: the link names a playlist and a seed, never
        a track.
  - [ ] **The copy must not promise an identical deck.** "Same playlist, same shuffle" is true; "the same
        deck" is not — see decision 4.

### C. The saved-playlist library

- [ ] **12. Build `src/game/playlist-library.ts` on `persistence.ts`'s pattern.** A `hitster:library:v1`
      key, an injected `StorageLike`, read/write/remove, validated field by field, and **nothing throws**
      — a read failure is a miss, a write failure is a no-op, both logged.
  - [ ] Entry shape: playlist id, playlist name, saved-at timestamp. Playlist-level data only; a track
        title must never enter this store.
  - [ ] Dedupe by id, most-recent-first, and cap the list. A cap is what stops a quota error from
        becoming this feature's failure mode.
  - [ ] Reject the whole store on a malformed entry and clear the key, as `loadSession` does. A
        half-loaded library is worse than an empty one.
- [ ] **13. Save explicitly, not automatically.** An affordance on the end screen, so the player saves a
      playlist they actually played. Auto-saving every URL anyone pastes turns the landing screen into a
      history log nobody asked for.
- [ ] **14. Render the library on the landing screen**, above `SUGGESTED_PLAYLISTS` and in the same
      button shape, so clicking one submits exactly as a suggestion does. Each row gets a remove control.
  - [ ] Empty state: render nothing at all rather than a placeholder. A first-time visitor already has
        the suggestions.
  - [ ] Every interactive element gets `focus-visible:focus-ring` and `touch-target`, and consumes
        tokens rather than literals.
- [ ] **15. Note the two-tab hazard rather than solving it.** `plan.md` §6 already carries the open
      question for the session key; the library key inherits it. A `storage`-event guard remains the fix
      if it ever bites, and this plan does not build one.

### D. The printable PDF export

- [ ] **16. Choose the library and add it as a runtime dependency.** It ships to the browser, so it is a
      `dependency`, not a `devDependency`. pnpm only.
- [ ] **17. Build `src/game/pdf-sheet.ts` as pure geometry.** Page size, margins, card size, the grid,
      each card's position, and **the duplex column mirror** — the back sheet's columns reverse so front
      and back align when printed double-sided on the long edge. All of it functions over numbers, all of
      it node-tested. Getting the mirror wrong is the defect that wastes a whole ream, and it is exactly
      the kind of arithmetic a unit test pins and a person does not.
- [ ] **18. Build the binding in `src/hooks/usePdfExport.ts`.** The dynamic `import()`, one QR data URL
      per card, the document assembly, the download, and a progress readout.
  - [ ] Reuse the `qrcode` chunk already split out in Phase 7 rather than importing it statically here.
  - [ ] Generating a hundred codes is real work. Report progress, and keep the UI responsive — a frozen
        tab reads as a crash.
  - [ ] **Watch the font encoding.** A standard PDF font is WinAnsi-encoded and will throw on a glyph
        outside it. This deck's tracks come from real Spanish, Latin and international playlists, so
        this is a likely failure, not a hypothetical one. Either embed a Unicode-capable font, or
        sanitise unsupported characters and say in the docs that it happens.
- [ ] **19. Print on a light palette, not the screen's.** Decision 6. A near-black card with a neon ring
      is ink-expensive and, more importantly, **a QR scans on dark modules over a light field with a quiet
      zone** — inverting or tinting it is how a printed deck fails at the one job the QR has. Verify a
      printed code against a real phone.
- [ ] **20. Export only cards with a resolved year, and say how many were left out.** A yearless card is
      already removed from the deck by the reducer, so the only exclusion here is a card the resolver has
      not reached yet. A count is leak-free; a list of titles would not be.
- [ ] **21. Put the trigger on the end screen only.** Not the landing screen (there is no deck) and not
      the game screen (a progress dialog over a live card is a spoiler risk and an interaction conflict
      with the swipe).
- [ ] **22. Verify the chunk is absent from the landing screen.** Build, then confirm in the network log
      — not only in the build output — that neither the PDF library nor the QR chunk is requested before
      a deck exists. Phase 7 established this check; a new dependency is exactly when it earns its keep.

### E. Verification on real hardware

- [ ] **23. Run the touch pass that Phase 5 waived**, in one session on a real phone, covering everything
      no local check can reach:
  - [ ] The five thresholds in `src/game/gestures.ts` under a thumb. They are documented guesses and
        `SWIPE_COMMIT_DISTANCE_PX` is 52% of the card's width at its floor since the card went fluid.
        Retune only with a measurement, and record it.
  - [ ] **One swipe**, to confirm the next card sits behind the sliding one rather than rising from
        below. jsdom computes no layout, so Motion's `popLayout` measurement cannot be checked locally.
  - [ ] **The new audio behaviour:** the preview survives a flip and stops on a swipe.
  - [ ] **One QR scan** at the 14/18 size on the smallest card, where the code is about 144px — and one
        scan of a **printed** card from step 19.
  - [ ] **The Android lock-screen check.** The only leak vector no test in this repo can reach: play a
        preview, lock the phone, and confirm the media panel names nothing.
  - [ ] A devtools DOM search on an unflipped card, still owed since Phase 4.

---

## Unit Tests

- [ ] `should not stop audio when the card is flipped` — `src/components/GameScreen.test.tsx`. The
      inversion of the existing test, and the one assertion that proves the reversal landed.
- [ ] `should stop audio when the card changes` — `src/components/GameScreen.test.tsx`. Exists, must keep
      passing untouched; it is what covers the swipe.
- [ ] `should stop audio when exit is confirmed` — `src/components/GameScreen.test.tsx`. Exists, unchanged.
- [ ] `should parse a link carrying a playlist id and a seed` — `src/game/deck-link.test.ts`, node.
- [ ] `should reject a link with a malformed playlist id` — `src/game/deck-link.test.ts`.
- [ ] `should reject a seed outside the generated alphabet or over the length bound` — `src/game/deck-link.test.ts`.
- [ ] `should return null rather than throwing on a mangled query string` — `src/game/deck-link.test.ts`.
- [ ] `should build a link that round-trips through the parser` — `src/game/deck-link.test.ts`.
- [ ] `should deal with the seed from the link` — `src/App.test.tsx`, jsdom, with the query string
      injected as a prop.
- [ ] `should resume a saved session in preference to a link` — `src/App.test.tsx`. Step 8's precedence,
      and the one that protects a game in progress.
- [ ] `should read the link exactly once under StrictMode's double render` — `src/App.test.tsx`.
- [ ] `should save, list and remove a playlist` — `src/game/playlist-library.test.ts`, node.
- [ ] `should dedupe by playlist id and keep the most recent first` — `src/game/playlist-library.test.ts`.
- [ ] `should cap the stored list` — `src/game/playlist-library.test.ts`.
- [ ] `should return an empty library rather than throwing on a corrupt payload` — `src/game/playlist-library.test.ts`.
- [ ] `should clear the key after rejecting a corrupt payload` — `src/game/playlist-library.test.ts`.
- [ ] `should swallow a write failure` — `src/game/playlist-library.test.ts`, with a throwing stub.
- [ ] `should render saved playlists and submit one on click` — `src/components/LandingScreen.test.tsx`.
- [ ] `should render nothing when the library is empty` — `src/components/LandingScreen.test.tsx`.
- [ ] `should remove a saved playlist` — `src/components/LandingScreen.test.tsx`.
- [ ] `should place every card on the grid within the page margins` — `src/game/pdf-sheet.test.ts`, node.
- [ ] `should mirror the columns on the back sheet` — `src/game/pdf-sheet.test.ts`. The duplex assertion,
      and the most valuable test in this plan.
- [ ] `should paginate a deck larger than one sheet` — `src/game/pdf-sheet.test.ts`.
- [ ] `should pair each front position with the matching back position` — `src/game/pdf-sheet.test.ts`.
- [ ] `should exclude cards whose year is still pending and report the count` — `src/game/pdf-sheet.test.ts`.
- [ ] `should offer copy, save and export on the end screen` — `src/components/EndScreen.test.tsx`.
- [ ] `should show the link as selectable text when the clipboard rejects` — `src/components/EndScreen.test.tsx`.
- [ ] `should build the share link from the current seed` — `src/components/EndScreen.test.tsx`, guarding
      the Restart-changes-the-seed trap in step 11.

---

## Documentation Updates

- [ ] `docs/plans/plan.md` §5 — tick the shareable-URL, saved-playlists and PDF-export boxes; add the
      **dated audio reversal** against the Phase 4 bullet it overturns, in the style of the 2026-08-05
      reversals; restate §6's two-tab open question as now covering two keys.
- [ ] `AGENTS.md` — the audio reversal in the dated-decisions block, worded so that "surely audio should
      stop on flip" is answered before anyone acts on it; the two new `src/game/` modules and which
      subtree rule put them there.
- [ ] `docs/architecture.md` §2 — `deck-link.ts`, `playlist-library.ts` and `pdf-sheet.ts` as `src/game/`
      members, and `usePdfExport` as the binding half; §3 — the link entry point, the library's storage
      key beside the session key, and the export chunk.
- [ ] `docs/development.md` §5 — the device-pass rows from step 23, each individually tickable; the
      printed-QR scan; the landing-chunk check after the new dependency.
- [ ] `docs/development.md` §8 — that a shared link reproduces a shuffle rather than a deck; that the
      library shares the session key's two-tab hazard; the PDF's font limitation if step 18 sanitises
      rather than embeds.
- [ ] `docs/agent_findings.md` — the reproducibility analysis, the PDF font encoding gotcha, the measured
      cost of the new dependency, and the device-pass results including any retuned threshold. Date every
      entry, and tell the developer they were added.
- [ ] `README.md` — sharing, saving and printing, and plainly what a shared link does and does not
      guarantee.
- [ ] Inline: `GameScreen`'s header block (step 2) and `useCardAudio`'s `stop` doc line (step 3). Both are
      wrong the moment step 1 lands.

---

## Testing Strategy

- **Unit tests:** every pure module in the node environment — the link parser, the library, the sheet
  geometry. This is the repo's decision/binding split applied three more times, and it is what keeps the
  duplex arithmetic and the storage validation out of jsdom.
- **Integration tests:** `App.test.tsx` drives the link entry and the session-outranks-link precedence
  from a stubbed fetch, a stubbed storage and an injected query string — the same shape it already uses.
- **Manual verification:**
  - Open a share link in a clean profile and confirm the deck deals without touching the form.
  - Open one with a game in progress and confirm the game survives.
  - Save two playlists, reload, play one from the library, remove the other.
  - Export a real deck, print it double-sided on the long edge, and check that front and back line up.
  - Scan a printed QR with a phone.
  - The full device pass in step 23.
  - Re-check the landing screen's network log for the new chunk.

---

## Assumptions & Decisions

| #  | Assumption / Decision                                                                     | Rationale                                                                                                                                                        |
| -- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Audio survives a flip and stops on a card change                                           | Developer decision, 2026-08-06. Reverses Phase 4. The bleed case the flip rule cited is already covered by the card-change rule, so an effect is deleted, not moved |
| 2  | The share link is query params, read once, no history manipulation                         | `GameState.seed` already accepts an override on `START` and `App.tsx` commits to entering it that way. Chosen over a hash fragment and an opaque token             |
| 3  | A saved session outranks a share link                                                      | Opening an old link must not discard a game in progress                                                                                                            |
| 4  | The link promises "same playlist, same shuffle", never "the same deck"                     | Yearless cards are removed at play time and editorial playlists refresh. The shuffle is exact; the input to it is not. Handled in copy rather than by an encoder    |
| 5  | The library stores playlists, not sessions                                                 | Chosen over a keyed collection of full decks, which would reopen persistence validation, `RESUME`, quota, and worsen the two-tab hazard                            |
| 6  | The PDF prints on a light palette regardless of the screen redesign                        | Ink cost, and a QR scans on dark modules over a light field with a quiet zone. This is why plan 1 is a soft dependency rather than a hard one                       |
| 7  | The PDF library is lazy-loaded and triggered from the end screen only                      | No deck exists on the landing screen, and a progress dialog over a live card conflicts with the swipe                                                              |
| 8  | Sheet geometry is pure and node-tested; the library call is a thin binding                 | The house split. Duplex mirroring is arithmetic a test pins and a person does not                                                                                  |
| 9  | Only cards with a resolved year are exported, with a count of the rest                     | A count is leak-free; a list of excluded titles is not                                                                                                             |
| 10 | Saving is explicit                                                                         | Auto-saving every pasted URL turns the landing screen into a history log                                                                                           |
| 11 | The two-tab hazard is inherited and documented, not fixed                                  | Already an accepted v1 limitation in `plan.md` §6; the library adds a second key under the same caveat                                                             |
| 12 | The touch pass rides with this plan                                                        | The audio change is only verifiable on a device, and the same session discharges the swipe, QR and lock-screen checks owed since Phases 4 and 5                    |

---

## Open Questions

- [ ] **Does the share link belong anywhere other than the end screen?** Mid-game is safe — the URL names
      no track — but it adds a control to a screen deliberately kept to three.
- [ ] **What card size does the printed sheet use?** The reference repo prints A4; the physical card size
      drives the grid, and matching real Hitster cards may matter to whoever prints these.
- [ ] **Embed a Unicode font or sanitise?** Embedding adds weight to a chunk that is already the largest
      new thing in the app; sanitising quietly corrupts a title. Step 18 decides, and the answer should be
      measured rather than assumed.
- [ ] **Should a saved playlist remember its last seed?** It would let "play that deck again" mean the
      same order. It also conflicts with Restart's deliberate fresh shuffle, so it is a real design fork
      rather than a free field.
- [ ] **Does the library need an import/export of its own**, given the share link already moves one
      playlist between devices? Probably not for v1, but it is the obvious next request.

---

## Out of Scope

- **The neon-ring redesign, the contrast re-audit, the PWA and the icon set** — all
  `plan.phase-8-look-and-shell.md`.
- **The "Added by" item** — `plan.phase-8-added-by.md`, and it writes no code.
- **Multiple concurrent mid-game sessions.** Decision 5. The library saves playlists; there is still
  exactly one resumable game.
- **A `storage`-event guard for the two-tab clobber.** Still an accepted v1 limitation.
- **Pinning the exact card set in a share link.** Decision 4 handles the gap with copy; an opaque
  versioned token remains the option if it ever matters.
- **Server-side PDF rendering.** Rejected as far heavier than the problem.
- **Retuning gesture thresholds without a measurement.** Step 23 may produce one; absent that, the
  documented guesses stand.
- **The preview-deployment verification of progressive loading** and the **game-screen Lighthouse
  audit**. Still owed, still need a deployment with Upstash configured, and neither Phase 8 plan
  discharges them.
