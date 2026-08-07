<!-- Plans for multi-playlist (in order):
  1. plan.multi-playlist-core.md  — the merge, the state shape, persistence, the link and the library
  2. plan.multi-playlist-ui.md    — the landing rows, the fan-out hook, the container wiring and the labels  ← this file
-->

# Plan: multi-playlist — a deck from up to 5 playlists (UI: rows, fan-out, wiring)

> **Jira:** multi-playlist
> **Date:** 2026-08-07
> **Author:** Aleix Rabassa
> **Depends on:** [plan.multi-playlist-core.md](plan.multi-playlist-core.md) — every type, module and
> signature this plan consumes is built there. Do not start this plan until all four checks pass on
> that one.

---

## Overview

The visible half: a **"+" button** on the landing screen that adds playlist inputs up to five, a
`usePlaylist` that fans out over them, and a container that deals one combined deck, saves it, shares
it and prints it exactly as it does a single playlist today.

Nothing here decides anything. The merge, the dedupe, the deck label, the link format and both storage
formats are plan 1's, and every one of them is a pure function this plan calls — which is the point:
what a screen can be asserted about in jsdom is class names and text, so a rule that matters lives
below the component.

---

## Dependency Contract

### Requires from plan.multi-playlist-core

| Output                                                                | Description                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/game/deck-merge.ts` — `mergePlaylists()`                          | Folds N `PlaylistOutcome`s into one `MergedDeck` or one failure code             |
| `src/game/deck-merge.ts` — `MergedDeck`                                | `playlists`, `cards`, `truncated`, `skippedCount`, `failures`                    |
| `src/game/deck-merge.ts` — `deckLabel()`                               | The `"<first> +N more"` string the HUD, end screen, PDF and library row all show |
| `src/game/deck-merge.ts` — `MAX_DECK_PLAYLISTS`                        | 5. The row cap and the link cap read the same constant                          |
| `GameState.playlists`, `start(cards, playlists, seed?)`                | The widened session                                                             |
| `parseDeckLink()` → `playlistIds`, `buildDeckLink(origin, ids, seed)`  | The multi-id share link                                                         |
| `SavedPlaylist.ids`, `savedDeckKey()`, `removePlaylist(storage, key)`  | The multi-id library                                                            |

### Produces for downstream plans

(no downstream)

---

## Scope & Affected Areas

| Area                                       | Type     | Notes                                                                                            |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `src/hooks/usePlaylist.ts`                 | Modified | `request(urls)` fans out over up to 5 `fetchPlaylist` calls under one controller, then merges     |
| `src/components/LandingScreen.tsx`         | Modified | Row list, the "+" button, per-row remove and per-row validation                                   |
| `src/components/LandingScreen.test.tsx`    | Modified | Rows, the cap, per-row errors, the suggestion/saved submit path                                   |
| `src/App.tsx`                              | Modified | Deal from `MergedDeck`, multi-id link entry, save/remove by deck key, labels via `deckLabel()`     |
| `src/App.test.tsx`                         | Modified | Multi-playlist deal, partial failure, total failure, multi-id link entry, save/remove              |
| `src/components/NoticeBanner.tsx`          | Modified | Two new optional notices: playlists that failed, and the combined deck's size                      |
| `src/components/NoticeBanner.test.tsx`     | Modified | Both new lines, and that neither renders in the single-playlist case                               |
| `src/components/DeckActions.tsx`           | Modified | `playlistIds` replaces `playlistId`; the share caption pluralises                                  |
| `src/components/DeckActions.test.tsx`      | Modified | A multi-id link is copied; the leak test re-run against the new props                              |
| `src/components/DeckActionsDialog.tsx`     | Modified | Prop pass-through only                                                                             |
| `src/components/DeckActionsDialog.test.tsx` | Modified | Fixture props updated                                                                             |
| `src/components/EndScreen.tsx`             | Modified | `playlistIds`; the deck label in the count line; the full playlist list, which lives only here      |
| `src/components/EndScreen.test.tsx`        | Modified | The list, the label, and the existing "same deck" absence assertion                                 |
| `src/components/GameScreen.tsx`            | Modified | `playlistIds` pass-through to the dialog. `playlistName` stays a string — it receives the label     |
| `src/components/GameScreen.test.tsx`       | Modified | Fixture props updated; the deck-actions leak assertion re-run                                       |
| `src/components/Hud.tsx`                   | None     | Already takes one string and truncates it. The label is that string                                 |
| `docs/development.md`                      | Modified | §5: new manual verification rows; §8: the gaps this feature cannot close locally                    |
| `docs/architecture.md`                     | Modified | §3: the landing screen's row model and the fan-out; the notice list grows from three to five        |
| `docs/agent_findings.md`                   | Modified | Dated entry: what was measured (deck size after dedupe, request count, bundle delta)                |
| `AGENTS.md`                                | Modified | Extend plan 1's bullet with the UI consequences (the row cap, the two new notices, the labels)      |

---

## Chosen Approach

**The hook fans out, a pure module merges, and the container's shape does not change.**
`usePlaylist.request` takes an array of raw URLs, fires one `fetchPlaylist` per URL against the
existing `/api/playlist?url=` endpoint under a **single** `AbortController`, awaits them all, and hands
the outcomes to plan 1's `mergePlaylists()`. Its `loaded` state carries a `MergedDeck` instead of a
`PlaylistResult`; every other guard in the hook — the abort on a new submission, the mount check, the
stale-response check — is unchanged and now protects a batch instead of a request.

That keeps the hook as thin as its own header block demands: it gains a `Promise.all` and nothing else,
because the merge, the dedupe, the failure ordering and the label are all in `src/game/`. `App.tsx`
keeps its result-identity deal guard, its lazy link read, its notice ownership and its status switch
exactly as they are — the container change is which fields it reads, not how it works.

The landing screen becomes a list of rows over one array of strings, with the "+" disabled at
`MAX_DECK_PLAYLISTS` and a **per-row** error message, so "that is not a playlist link" points at the
box it is about. Chosen over one shared error slot because with five inputs a single message names none
of them, and over a chip/token input because a row is what the existing suggestion and saved-playlist
buttons already fill.

---

## Implementation Steps

- [ ] **Step 1 — Fan out in `src/hooks/usePlaylist.ts`.**
  - [ ] `request(urls: readonly string[])`. Abort the controller in flight, make one new controller for
        the whole batch, set `loading`, and fire one `fetchPlaylist` per URL with that one signal.
  - [ ] Await them all together, then call `mergePlaylists()` with the outcomes **in URL order**, so
        the failure the error slot reports is the first row's. Keep the two existing guards after the
        await — still mounted, still the current controller — unchanged and in the same order.
  - [ ] `PlaylistRequestState`'s `loaded` variant carries `MergedDeck`. The union's own comment about
        why it is a union rather than three booleans still stands verbatim.
  - [ ] Requests go out **in parallel**, not sequentially: five sequential embed fetches would put the
        card-1 gate behind the sum of them for no benefit. Say so in a comment, and say that the shared
        `AbortController` is what keeps "the player changed their mind" a single act.
  - [ ] Keep the `fetchImpl` binding note and the ref-read pattern exactly as they are — the brand-check
        failure they document is unrelated to this change and still real.
  - [ ] Do **not** add a per-URL retry, a partial-progress state or a per-row status here. The hook's
        rule is that logic belongs in the client or in `deck-merge.ts`; a progress readout is a
        follow-up, not this task.

- [ ] **Step 2 — Turn the landing form into rows in `src/components/LandingScreen.tsx`.**
  - [ ] Replace the single `value` state with an array of row values, starting as one empty row.
        `onSubmit` becomes `(urls: string[]) => void`.
  - [ ] Render one labelled input per row. The **first** row keeps the current visible label text; later
        rows are labelled with their position (e.g. "Playlist link 2") so each input's accessible name
        is unique. Keep the wrapping `<label>` and add **no** `aria-label` — the WCAG 2.5.3 failure
        documented in that file is exactly what an `aria-label` here would reintroduce.
  - [ ] Add the **"+" button** below the rows: `type="button"`, an accessible name of "Add another
        playlist" (the `+` glyph is `aria-hidden` decoration, the same split `NoticeBanner`'s Dismiss and
        the library's remove button already use), `touch-target`, `focus-visible:focus-ring`, and
        disabled at `MAX_DECK_PLAYLISTS` rows or while loading. When disabled, render a short hint that
        five is the maximum — a disabled control with no explanation reads as broken.
  - [ ] Add a per-row remove button, rendered only when there is more than one row, named for its row
        ("Remove playlist 3") for the same reason the library's remove button names its playlist.
        Removing a row must not renumber the values under the player's cursor — key the rows on a
        stable per-row id rather than on the index.
  - [ ] Per-row validation on submit, reusing the existing rules unchanged: ignore blank rows; a
        `spotify.link` short URL skips the client-side parse and goes to the server; everything else
        goes through `parsePlaylistUrl`. A row that fails gets **its own** message under it, with its
        own id wired to that input's `aria-describedby` and `aria-invalid`, and `role="alert"` so it is
        announced. Replace the module's single `ERROR_MESSAGE_ID` constant with a per-row id derived
        from the row's stable id, and update the comment that justified the single literal.
  - [ ] Submit only when **every** non-blank row parses. All-blank is itself a failure: report
        `invalid-url` on the first row rather than firing a request for nothing.
  - [ ] Clear a row's error when that row is edited, not all of them — the existing "an error about the
        previous value must not sit beside a half-typed new one" reasoning, applied per row.
  - [ ] The container-level `errorCode` prop keeps its single slot below the form, with its current
        `role="alert"` copy from `messages.ts`. It describes the request, not a row.
  - [ ] **Suggested and saved buttons keep submitting instantly.** A click replaces the rows with that
        pick's ids (one for a suggestion, up to five for a saved deck) and submits immediately, which is
        today's behaviour and the one-click demo path. Record in the comment that this **discards typed
        rows** and why that is acceptable: the screen is replaced by the game anyway, and the rows are
        visibly refilled with what was actually submitted before it is.
  - [ ] A saved entry's row now derives its React key and its remove argument from `savedDeckKey(saved)`
        rather than from `saved.id`. The row still renders the entry's `name` and **nothing else** — the
        leak rule and the "no second line" reasoning are unchanged.

- [ ] **Step 3 — Wire the container in `src/App.tsx`.**
  - [ ] `handleSubmit(urls: string[])` — still dropping the pending link seed first, for the reason
        already documented there.
  - [ ] The deal effect reads `result.playlists` and `result.cards` from the `MergedDeck` and calls
        `start(result.cards, result.playlists, seed?)`. `dealtResultRef` compares the merged object by
        identity exactly as before: the hook produces one merged object per batch, so the guard is as
        idempotent under StrictMode as it is today.
  - [ ] The notice state grows to carry `failures.length`, the deck's card count and the loaded playlist
        count alongside `truncated` and `skippedCount`. Dismissal stays container state, for the reason
        decision 9 already gives.
  - [ ] The link effect maps `deckLink.playlistIds` through `spotifyPlaylistUrl` into one array and
        passes it to `request`. **Leave the address bar alone** — no `pushState`, no `replaceState` — and
        **do not add an "already submitted" ref**: both rules are load-bearing and both are documented
        in that effect's header block. It stays a single effect with the same two stable dependencies.
  - [ ] `handleSavePlaylist` writes `{ ids: state.playlists.map(…id), name: deckLabel(state.playlists),
        savedAt: … }`. `isPlaylistSaved` compares `savedDeckKey` of the live deck against the saved
        entries' keys, so a partially-overlapping set is correctly **not** "saved".
  - [ ] `handleRemoveSaved(key)` takes the deck key.
  - [ ] `handleRestart` reads `state.playlists`. It still restarts from `state.deck` rather than from a
        remembered fetch — that decision is unaffected and is what makes a restart cost zero lookups.
  - [ ] Every `state.playlist?.name ?? ''` site becomes `deckLabel(state.playlists)`; every
        `state.playlist?.id ?? ''` site becomes the id array. The `??` fallbacks disappear with the
        `null` sentinel.
  - [ ] `deckCollapsed` is unchanged. Its condition is about the deck, not the playlist, and a
        five-playlist deck that resolves no years at all is exactly the same `no-years-found` case.

- [ ] **Step 4 — Add two notices to `src/components/NoticeBanner.tsx`.** Both optional, both count-only,
      neither gating Start — the header block's rule holds.
  - [ ] `failedPlaylistCount`: "1 playlist could not be loaded and was left out." / "N playlists could
        not be loaded and were left out.", pluralised properly. This is the visible half of decision 4:
        a private or deleted playlist among five costs a notice, not the deck.
  - [ ] The combined-deck line, rendered **only** when more than one playlist loaded: the deck's card
        count and the number of playlists it came from. This is the "say the size" half of the no-cap
        decision, and it is a count, so it is safe on a pre-reveal surface.
  - [ ] Update the header comment: "the three non-blocking notices" becomes five, and the new pair keeps
        the same `role="status"` (never `alert`) and the same dismissal.
  - [ ] Do **not** name which playlist failed. The name is safe data, but the failure list is ordered by
        row and the rows are gone by the time this renders, so a name here would be information the
        player cannot act on — and the count is what every other notice in this app reports.

- [ ] **Step 5 — Carry the ids through the deck actions.**
  - [ ] `DeckActions` takes `playlistIds: readonly string[]` and calls `buildDeckLink(shareOrigin,
        playlistIds, seed)` **inside the handler**, unchanged. The build-at-click rule is documented and
        still load-bearing: a restart deals a fresh seed.
  - [ ] The share caption pluralises: "Same playlists, same shuffle …" beyond one playlist. It must
        still **never** say "the same deck" — and it now has a third reason, since a playlist that has
        gone private since the link was made is dropped with a notice.
  - [ ] `exportDeck(deck, playlistName)` is unchanged; it receives the label, so the PDF filename follows
        for free.
  - [ ] `DeckActionsDialog` and `GameScreen` pass the ids through. `GameScreen`'s own props keep
        `playlistName` as a single string, so the HUD is untouched — it already truncates a long name.

- [ ] **Step 6 — The end screen is the one place the full playlist list appears.**
  - [ ] The count line uses the deck label.
  - [ ] Below it, list every playlist's name. This is post-game, so nothing can be spoiled, and it is
        the only surface where the full set is worth the space. Playlist names only — the screen's leak
        test asserts no track, artist or year reaches it, and that test does not change.
  - [ ] The second button still says "Home", and the assertion that "New playlist" is absent stays.

- [ ] **Step 7 — Update the tests below, then run the four checks.** `pnpm typecheck && pnpm lint &&
      pnpm test && pnpm build`, all four green.
  - [ ] Every DOM test file keeps its `afterEach(cleanup)` — Testing Library does not auto-clean here —
        and every file that renders a card keeps `clearQrCache()` in its `beforeEach`.
  - [ ] Measure and record: the bundle delta on the initial path (the landing screen gains rows and the
        `deck-merge` module), the number of `/api/playlist` requests a five-row submit makes under React
        19 StrictMode, and the card count a real five-playlist deck merges to after the dedupe.

---

## Unit Tests

`src/components/LandingScreen.test.tsx` — jsdom:

- [ ] `should start with one playlist row` — covers the default state
- [ ] `should add a row when the add button is pressed` — covers the "+"
- [ ] `should not add more rows than the maximum` — covers the cap and the disabled state
- [ ] `should explain why the add button is disabled at the maximum` — covers the hint
- [ ] `should remove a row without disturbing the other values` — covers the stable row keys
- [ ] `should not render a remove button when there is only one row` — covers the single-row case
- [ ] `should submit every non-blank row` — covers the array submit
- [ ] `should ignore blank rows` — covers the trimming rule
- [ ] `should report an error on the row that failed to parse` — covers per-row validation, asserting
      the message is associated with that input via `aria-describedby`
- [ ] `should not submit when any row is invalid` — covers the all-or-nothing submit
- [ ] `should report an error when every row is blank` — covers the all-blank case
- [ ] `should clear only the edited row's error` — covers the per-row clear
- [ ] `should submit a short link without parsing it` — covers that the existing `spotify.link` exception
      survived the rewrite
- [ ] `should submit a suggestion immediately as a single playlist` — covers the preserved demo path
- [ ] `should submit every id of a saved multi-playlist deck` — covers the saved-entry path
- [ ] `should remove a saved deck by its deck key` — covers the new remove argument
- [ ] `should not render a track title, artist or year` — the existing leak assertion, re-run against the
      new row markup

`src/App.test.tsx` — jsdom:

- [ ] `should deal one deck from two playlists` — covers the fan-out end to end from a stubbed fetch,
      asserting both requests were made and the deck holds both playlists' cards
- [ ] `should deduplicate a track that appears in both playlists` — covers the merge through the container
- [ ] `should play the remaining playlists when one fails, and say so` — covers decision 4 and the new
      notice line together
- [ ] `should show the error copy when every playlist fails` — covers the total-failure code reaching the
      landing screen's single slot
- [ ] `should deal from a share link naming two playlists` — covers the multi-id link entry path
- [ ] `should still deal from a single-id share link` — covers back-compat at the container
- [ ] `should ignore a share link when a game is already in progress` — the existing assertion, re-run
- [ ] `should save the whole set of playlists and show it on the landing screen` — covers save + library
      round trip through the stubbed storage
- [ ] `should report the combined deck's size when more than one playlist loaded` — covers the new notice
- [ ] `should not report a deck size for a single playlist` — covers that the single-playlist screen is
      unchanged

`src/components/NoticeBanner.test.tsx` — jsdom:

- [ ] `should report one playlist that could not be loaded` — covers the singular copy
- [ ] `should report several playlists that could not be loaded` — covers the plural copy
- [ ] `should report the deck size and playlist count` — covers the combined-deck line
- [ ] `should render nothing for a single successful playlist` — covers that the common case still
      renders no banner at all
- [ ] `should not name a playlist that failed` — covers the count-only rule

`src/components/DeckActions.test.tsx` — jsdom:

- [ ] `should copy a link holding every playlist id` — covers the multi-id build at click time
- [ ] `should say playlists rather than playlist for a combined deck` — covers the pluralised caption
- [ ] `should never promise the same deck` — the existing assertion, re-run
- [ ] `should not render any card's title, artist or year` — the existing leak test, re-run with the new
      props

`src/components/EndScreen.test.tsx` — jsdom:

- [ ] `should list every playlist the deck came from` — covers step 6
- [ ] `should show the deck label in the count line` — covers the label
- [ ] `should not offer a button labelled New playlist` — the existing assertion, re-run
- [ ] `should not render any card's title, artist or year` — the existing leak test, re-run

`src/components/GameScreen.test.tsx` — jsdom:

- [ ] `should not leak the current card through the deck actions` — the existing assertion, re-run with
      the multi-id props

---

## Documentation Updates

- [ ] `docs/architecture.md` §3 — the landing screen's row model, the parallel fan-out and its single
      `AbortController`, and the notice list going from three notices to five.
- [ ] `docs/development.md` §5 — a new **"Multi-playlist"** table in the same shape as the Phase 8 one,
      every row Pending, with at least: five real playlists dealt on a deployment; one private playlist
      among five (the notice, not a block); a five-playlist share link pasted into a clean profile; a
      saved multi-deck surviving a reload and playing; a multi-playlist PDF's filename and header; the
      rows and the "+" on a 360 px screen; and the keyboard path through five rows, the add and the
      removes. jsdom computes no layout and has no accessibility tree, so the last two cannot be closed
      locally by anything.
- [ ] `docs/development.md` §8 — add what this feature cannot verify locally: the real wall clock of a
      ~500-card year crawl, and whether five parallel `/api/playlist` requests are ever rate-limited or
      queued in a real browser.
- [ ] `docs/agent_findings.md` — a dated (2026-08-07) entry with the three measurements from step 7 and
      anything that surprised the implementer.
- [ ] `AGENTS.md` — extend plan 1's bullet with the UI half: the row cap, the two new notices, that the
      HUD/end screen/PDF all read one `deckLabel()`, and that a suggestion or saved deck still submits
      instantly and therefore replaces typed rows.
- [ ] `docs/plans/plan.md` §5 — tick the multi-playlist item once both plans are done, in the same voice
      as the existing Phase 8 entries, and name what is left as manual.

---

## Testing Strategy

- **Unit tests:** the jsdom component tests above. They assert markup, text, roles and associations —
  what jsdom can actually see. Nothing about layout, focus rings, media queries or announcement order is
  asserted here, because this environment evaluates none of it; that is what §5's manual rows are for.
- **Integration tests:** `App.test.tsx` is the integration layer, driving the whole path from a stubbed
  `fetch` and a stubbed `StorageLike` through the landing rows, the fan-out, the deal, the notice, the
  save and the share link. It is the only place the fan-out and the merge are exercised together with
  real React.
- **Manual verification:** the new §5 table. The load-bearing ones are the **private playlist among
  five** (the only check that the partial-failure path is a notice and not a dead end), the **five-row
  keyboard pass** (nothing local checks focus order through a dynamic list), and a **multi-playlist PDF
  on paper**, which inherits every Phase 8 printing check that is still Pending.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                      | Rationale                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The hook fans out in parallel under one `AbortController`.**                                              | Five sequential embed fetches would put the card-1 gate behind their sum. One controller keeps "the player changed their mind" a single act, and the existing stale-response guards protect a batch unchanged. |
| 2   | **`usePlaylist` gains a `Promise.all` and nothing else.**                                                   | Its own header block says any logic accumulating there is logic nothing tests. The merge, the failure ordering and the label are plan 1's pure module.                            |
| 3   | **Per-row error messages, not one shared slot.**                                                            | With five inputs, one message names none of them. Each row's message is wired to its own input via `aria-describedby`, which is also what makes the assertion meaningful.          |
| 4   | **The container-level error keeps its single slot.**                                                         | It describes the request, not a row: a total failure, or `no-years-found` from the session. `StartFailureCode` is unchanged.                                                       |
| 5   | **A suggestion or saved deck still submits instantly, replacing whatever was typed.**                        | It is today's one-click demo path and the reason the suggestions exist. The rows are refilled with what was actually submitted before the screen is replaced, so nothing is lost silently. |
| 6   | **Rows are keyed on a stable per-row id, not on the index.**                                                 | Removing a middle row with index keys renumbers the inputs under the cursor and moves focus and error associations to the wrong box.                                               |
| 7   | **The two new notices are counts, and neither names a playlist.**                                            | Every pre-reveal surface in this app reports counts. The row a failure belonged to is gone by the time the banner renders, so a name is information the player cannot act on.       |
| 8   | **`GameScreen`, `Hud` and `PreparingScreen` keep taking one `playlistName` string.**                          | The label IS that string. Pushing the array down to the HUD would buy nothing and would make a truncation rule into a layout decision.                                             |
| 9   | **The end screen is the only place the full playlist list is rendered.**                                      | Post-game, so nothing can be spoiled, and it is the one screen with room. Every other surface gets the label.                                                                      |
| 10  | **No per-playlist progress UI while the batch is in flight.**                                                 | Start already shows one loading state and the batch is bounded at five parallel requests. A per-row spinner is a follow-up, not this task.                                          |

---

## Open Questions

- [ ] Does a five-row form still fit a 360 px screen above the saved and suggested sections, or does the
      landing screen need to scroll? Nothing local computes layout — resolve on the device pass (§5) and,
      if it does not fit, the remedy is collapsing the suggestions rather than shrinking the rows.
- [ ] Do five parallel `/api/playlist` requests ever get queued or throttled in a real browser or by
      Vercel? Measured in step 7; if they do, the fix is a small concurrency limit inside the hook, which
      changes no type.
- [ ] Should the "+" also appear when a share link deals a deck, i.e. should a link's playlists be
      editable before Start? Assumed **no** for this task — a link deals immediately, exactly as today.

---

## Out of Scope

- Any change to `api/`, to `shared/`, or to the `/api/playlist` contract.
- Everything plan 1 owns: the merge, the dedupe, the label, the link format, both storage formats.
- Per-playlist progress, per-playlist retry, and reordering rows by drag.
- A pre-Start deck preview or track count per playlist. The landing screen is a pre-start surface and
  stays count-free and name-only.
- Multiple resumable sessions. There is still exactly one saved game.
