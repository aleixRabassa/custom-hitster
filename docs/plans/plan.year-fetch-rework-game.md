<!-- Plans for year-fetch-rework (in order):
  1. plan.year-fetch-rework-mb-fixes.md  — licence-clean MusicBrainz fixes: the cleaner bug, new cleaner families, no silent degradation, the tokenised rescue rung
  2. plan.year-fetch-rework-server.md    — the provider vote in shared/, the Deezer/iTunes adapters, per-provider gates and cache, /api/year stages
  3. plan.year-fetch-rework-game.md      — the game layer: provisional years, keepYearless, the two-lane resolver, persistence, the PDF gate  ← this file
  4. plan.year-fetch-rework-ui.md        — the reveal's year slot, the picker checkbox and its remembered preference, copy in three languages, the blank PDF year
-->

# Plan: year-fetch-rework — 3. Game layer: provisional years, keepYearless, two lanes

> **Source:** [`docs/spikes/spike.year-fetch-rework.md`](../spikes/spike.year-fetch-rework.md) §6.2, §12.1, §12.5, §12.6, §12.8
> **Date:** 2026-09-30
> **Author:** aleix.rabassa
> **Depends on:** [plan.year-fetch-rework-server.md](plan.year-fetch-rework-server.md) (hard). The client needs the `stage` parameter, the `final` flag and the per-stage back-pressure.

---

## Overview

Plan 2 makes a card's year arrive in up to two steps:

- a **provisional** year from the `resolve` stage;
- then a **final** answer from the `verify` stage. The final answer may be the same year, a different
  year, confirmed or unconfirmed, or no year at all.

This changes what a value **means** in the game layer, which is the shape the 2026-08-05 "dropping
yearless cards has a long tail" finding warns about. Four things change:

- **Pending means something new.** A `resolve` that found nothing leaves the card **pending** instead
  of dropping it. Only a **final** null drops it.
- **Provisional years are shown.** A provisional year is shown, and a final answer replaces it on
  every card, the current one included.
- **The option decides the gate and the drop.** The session option `keepYearless` (the picker's
  "Keep cards with no year found", spike §12.8) decides both the card-1 gate and whether a final null
  drops a card at all.
- **The client runs both stages.** It schedules both stages without ever delaying a card that settled
  on its first try.

This plan is everything below React. Two rules of this repo follow from that:

- the reducer, the resolver, persistence and the PDF selector stay framework-free and
  node-environment-testable;
- `src/App.tsx` stays the only caller of `useGameSession()`.

The picker checkbox, the reveal's new line and the copy are plan 4. This plan passes
`keepYearless: false` from `App.tsx` so the app compiles and plays exactly as before until plan 4
wires the control.

---

## Dependency Contract

### Requires from plan.year-fetch-rework-server

| Output                                                                                                            | Use                                                       |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `/api/year?stage=resolve\|verify`                                                                                 | `year-client.ts` always sends `stage`                     |
| `YearLookupResult.final`, required                                                                                | The only thing that decides pending, provisional or final |
| 429 + `retryAfterMs`, 502 `upstream-unavailable`, 500 `not-configured` (only when every provider is unconfigured) | The resolver's per-lane back-off and shutdown             |
| `YearStage`, the widened `YearSource`                                                                             | Types                                                     |

### Produces for plan.year-fetch-rework-ui

| Output                                                                                                                           | Consumed by                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Card.yearProvisional` (optional, `true` or absent) and `yearStateOf(card)` returning pending, provisional or final              | `CardRevealSide`'s year slot                                                  |
| `useGameSession().start(cards, playlists, { startCardId?, keepYearless })`, with `keepYearless` required in the options          | `App.tsx`: the picker and the link deal pass the remembered preference        |
| `GameState.keepYearless`                                                                                                         | `App.tsx` / `usePdfExport` (whether the PDF prints a blank year), and Restart |
| `selectPrintableCards(deck, { keepYearless })`, which keeps `year: null` cards when kept and always leaves provisional cards out | `usePdfExport`, `DeckActions`                                                 |

---

## Scope & Affected Areas

| Area                                                                | Type     | Notes                                                                                                                                                                |
| ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/types.ts`                                                   | Modified | `Card` doc comment: `yearProvisional` and what `year: null` means with `keepYearless`                                                                                |
| `src/game/types.ts`                                                 | Modified | `GameState.keepYearless`; `START.keepYearless`; `YEAR_RESOLVED` as a union of a final arm and a provisional arm                                                      |
| `src/game/reducer.ts`                                               | Modified | `START` filter and gate (≈ 60, 120), `YEAR_RESOLVED` drop and write (≈ 178, 216) and gate (≈ 310), `RESUME` filter (≈ 445), the selectors, and the new `yearStateOf` |
| `src/game/resolver.ts`                                              | Modified | Rewritten around two lanes, one slot per stage, with a per-card stage state and a pure picker                                                                        |
| `src/game/year-client.ts`                                           | Modified | A `stage` argument; `asLookupResult` requires a boolean `final`                                                                                                      |
| `src/game/use-game-session.ts`                                      | Modified | The dispatch carries the provisional flag; `start()` takes `keepYearless`; Restart passes the session's value                                                        |
| `src/game/persistence.ts`                                           | Modified | `validateCard` (≈ 336–359) copies `yearProvisional` only beside a numeric year; `PersistedSession.keepYearless` is optional and absent means `false`                 |
| `src/game/pdf-sheet.ts`                                             | Modified | `selectPrintableCards` (≈ 416)                                                                                                                                       |
| `src/App.tsx`                                                       | Modified | Passes `keepYearless: false` to every `start()`; `deckCollapsed` comment                                                                                             |
| `src/hooks/usePdfExport.ts`                                         | Modified | Passes `keepYearless: false` to `selectPrintableCards` (placeholder; plan 4 threads the real value)                                                                  |
| `src/game/*.test.ts`, `src/App.test.tsx`, `share-roundtrip.test.ts` | Modified | See Unit Tests                                                                                                                                                       |
| Comments that state the old invariants                              | Modified | See the Documentation Updates list                                                                                                                                   |

---

## Chosen Approach

**Storage: the spike's `Card.yearProvisional` flag, plus a derived `yearStateOf(card)` helper.**

- The flag is stored on the card, because Restart re-deals `state.deck` through `START`. A flag kept
  anywhere else would turn every provisional card final on a restart, and it would never be verified.
- The flag is additive: no save-format bump (the `startIndex` precedent), and the existing test
  fixtures don't change.
- The helper gives exhaustive three-way switches without a second stored copy of the state, which is
  the failure `reducer.ts`' own comment gives as the reason derived values are functions.
- A stored `yearStatus` field was rejected because it duplicates `year` and can disagree with it.
- A tagged union replacing `year` was rejected because it forces a save migration and changes ~100
  test sites.

**Scheduling: one `createYearResolver` running two lanes, one slot per stage.** It keeps the same
`start`, `prioritize` and `stop` API.

- **Why one slot per stage:** back-pressure lives per provider gate on the server.
- **Why not two independent workers:** that puts the hand-off from one stage to the other in the hook,
  which the hook's header forbids. It also needs two teardowns, and nothing would push the start card
  into verification while the loading screen waits.
- **Why not one queue with two slots:** both slots can take MusicBrainz jobs, so one client would have
  two MusicBrainz lookups in flight.

---

## Implementation Steps

- [x] **Step 1: types.**
  - [x] **`shared/types.ts`, `Card`:** add the optional `yearProvisional`. It is present only as
        `true`, only beside a numeric `year`, and written only by the reducer. Rewrite the doc
        comment's null rule: `year: null` is a final "no year", which a live deck holds only when the
        session keeps yearless cards.
  - [x] **`src/game/types.ts`, `GameState`:** gains `keepYearless`, a required boolean.
  - [x] **`src/game/types.ts`, `START`:** gains `keepYearless`, a required boolean.
  - [x] **`src/game/types.ts`, `YEAR_RESOLVED`:** becomes a union of two arms.
    - **The final arm** is today's payload unchanged: a numeric year or null, plus confidence. It has
      no `provisional` field, so the ~38 existing test literals still type-check.
    - **The provisional arm** is a numeric year, confidence `low` only (plan 2 never marks a
      provisional answer `high`), and `provisional: true`.
    - There is **no provisional null**. A `resolve` that found nothing dispatches nothing, and the card
      stays pending.
- [x] **Step 2: the reducer (`src/game/reducer.ts`).**
  - [x] **`START`:**
    - record `keepYearless`;
    - filter `year: null` cards out only when `keepYearless` is false;
    - **when `keepYearless` is true**, go straight to `playing`, since nothing waits for a year;
    - **when it is false**, open the gate only when the start card is **final**. A re-dealt deck whose
      start card is still provisional must stay in `preparing`.
  - [x] **`YEAR_RESOLVED`, provisional arm:**
    - write the year, the confidence and `yearProvisional: true`;
    - on a card that is already final, return the **same state object**, since an answer is never
      downgraded;
    - never drop the card and never open the gate when `keepYearless` is false.
  - [x] **`YEAR_RESOLVED`, final arm:**
    - with a number, write the year and confidence and remove `yearProvisional`. This replaces a
      provisional year on **every** card, the current one included;
    - with null and `keepYearless` false, drop the card exactly as today, with the same index shift;
    - with null and `keepYearless` true, keep the card with `year: null` and `confidence: 'none'`;
    - open the gate when the current card is final.
  - [x] **`RESUME`:**
    - read `keepYearless`, where absent means false;
    - filter null cards only when it is false;
    - keep `yearProvisional` cards as they are.
  - [x] **`yearStateOf(card)`**, beside the selectors: pending when `year` is undefined, provisional
        when the flag is set, final otherwise.
  - [x] **The three year selectors:**
    - `isCurrentYearPending` stays "year is undefined", because a provisional card shows its year;
    - `resolvedCount` now **excludes** provisional cards;
    - `pendingYearCount` therefore counts provisional cards as pending, so the PDF export waits for
      verification.
    - Rewrite the comment at ≈ 551–552: the two may now disagree **on purpose**. Say so there, so
      nobody "fixes" one to match the other.
- [x] **Step 3: the year client (`src/game/year-client.ts`).**
  - [x] `lookupYear` takes a `stage` and always sends it. The client never makes a stage-less request.
  - [x] `asLookupResult` rejects a 200 without a boolean `final` as `unexpected-payload`. That also
        guards against stage-less edge-cache bodies left over from the old client.
  - [x] It passes `final`, `agreedBy` and `skipped` through.
  - [x] Error codes are unchanged.
- [x] **Step 4: the resolver (`src/game/resolver.ts`).**
  - [x] **Per-card stage state** replaces today's settled/not-settled flag: `needs-resolve`,
        `needs-verify` or `final`. It is seeded from the deck when the resolver is created:
    - a card with an undefined year starts in `needs-resolve`;
    - a card with `yearProvisional` starts in `needs-verify`, which is how a resumed provisional card
      goes straight to verification;
    - any other card with a year starts `final`. This fixes the line at ≈ 169, which today marks every
      card with a year as done.
  - [x] **Resolve lane:** today's loop from the start card with wrap and its deferred pass, one request
        in flight, taking the current card first when it needs resolve.
    - A **final** answer settles the card, which never enters verify.
    - A **provisional** answer reports the year with the provisional flag and queues the card for
      verify.
    - A **found-nothing, not-final** answer reports nothing and queues the card for verify.
  - [x] **Verify lane:** one request in flight.
    - **Pick order:** the current card first, then cards needing verify within a small named window
      ahead of the current card, then the rest in first-in-first-out order (play order).
    - **The window** is computed on the resolver's own deck snapshot by card id, because dropping
      cards never reorders a deck.
    - **When there is nothing to do,** the lane waits on a promise that the resolve lane settles when
      it queues work. There are no timers, so it stays testable in node.
  - [x] **The urgent card:**
    - `prioritize(cardId)` routes by stage state, and the resolver remembers the urgent id;
    - when that card's resolve answer lands, it goes to the **front** of verify. This closes the
      card-1 gap: during `preparing` the start card goes provisional without `currentCardId` changing,
      so the hook's `prioritize` would never fire again;
    - `prioritize` on a `final` card does nothing, as today.
  - [x] **Back-off per lane:**
    - on a 429, only that lane sleeps for `retryAfterMs` and then picks again, so a player who moved
      on is served first;
    - the `upstream-unavailable` retry budget and backoff are unchanged, applied per lane.
  - [x] **Exhausted verify:** when a card's verify retries run out, report it **final**.
    - A provisional card becomes final with its provisional year and `low`, keeping the best single
      answer, as the spike's §10.3 rule says.
    - A card with nothing becomes final null.

    The resolve lane's deferred pass settles null exactly as today.

    > **Later, 2026-10-01: reversed by the branch review** (S1, the developer's ruling; see
    > [`review.year-fetch-rework.md`](../reviews/review.year-fetch-rework.md)). An exhausted
    > resolve now hands the card to verify instead of settling it null, so a provider outage cannot
    > drop a card before every stage has been asked. An exhausted verify is now the only route to a
    > null after transient failures. The same review added a resolve-lane sleep on a non-final
    > `resolve` 200 that carries `retryAfterMs` (W4). It also corrected the header's "one MusicBrainz
    > lookup per client": `verify` re-asking a cold `resolve` frontier can briefly make it two, and
    > that was accepted (W1).

  - [x] **Shutdown:** one `AbortController`, and one `stop()` ending both lanes. `not-configured` stops
        both lanes, and plan 2 returns it only when every provider is unconfigured.
  - [x] **The header:** rewrite it. "Do not optimise this into a parallel fetch" becomes "never more
        than one request in flight **per stage**", with the reason (one MusicBrainz lookup per client,
        and each stage behind its own gates).
- [x] **Step 5: the session hook (`src/game/use-game-session.ts`).**
  - [x] The resolver's report dispatches either arm of `YEAR_RESOLVED`.
  - [x] `start()` options gain `keepYearless`, required.
  - [x] Restart (`handleRestart` in `App.tsx`, ≈ line 578) re-deals with the session's
        `state.keepYearless`.
  - [x] The StrictMode cleanup is unchanged. Record in its comment that the double-crawl guard now
        covers two lanes and is still untested (the existing `docs/development.md` row).
- [x] **Step 6: persistence (`src/game/persistence.ts`).**
  - [x] `validateCard` copies `yearProvisional` only when it is `true` and `year` is a number, and
        **rejects** it otherwise, following the module's rule of rejecting what it cannot account for.
        Without this, a resumed provisional card silently reads as final and is never verified.
  - [x] `PersistedSession` gains an optional `keepYearless`, where absent means false. There is no
        format bump.
  - [x] `toPersistedSession` writes both fields.
- [x] **Step 7: the PDF selector (`src/game/pdf-sheet.ts`).** `selectPrintableCards(deck, { keepYearless })`:
  - [x] a provisional card is **left out and counted** in `excludedCount`. This also covers
        "Print so far", by the developer's decision, so nothing printed can still change;
  - [x] a `year: null` card is kept when `keepYearless` is true and left out otherwise;
  - [x] `nothing-to-print` is unchanged when the option is false;
  - [x] the one call site, in `src/hooks/usePdfExport.ts`, passes `keepYearless: false` for now, the
        same placeholder shape as `App.tsx`. Threading the session's value down through `GameScreen`,
        `DeckActionsDialog`, `EndScreen` and `DeckActions` is React prop work, so it belongs to plan 4,
        which also draws the blank year.
- [x] **Step 8: the container (`src/App.tsx`).**
  - [x] Every `start()` call passes `keepYearless: false` until plan 4 replaces it with the remembered
        preference.
  - [x] `deckCollapsed` keeps its check. Its comment says it can only fire when yearless cards are
        dropped.
  - [x] No new status and no new action beyond the widened ones.
- [x] **Step 9: update the stale comments** listed under Documentation Updates, in the same change,
      so no sentence in `src/` still says a null always removes the card or that the gate is
      unconditional.
- [x] **Step 10: run the four checks:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 11: preview deployment smoke test** with the option OFF:
  - [ ] a recent-heavy deck plays;
  - [ ] a provisional year changes on a revealed card when its final answer differs;
  - [ ] the PDF waits for verification;
  - [ ] a reload mid-verification resumes and verifies.

---

## Unit Tests

**`src/game/reducer.test.ts`**

- [x] `should write a provisional year and mark it provisional`, and `should not drop a card on a provisional answer`.
- [x] `should replace a provisional year with a different final year on the current card`, and `…with the same final year and clear the flag`.
- [x] `should ignore a provisional answer for a card that is already final`: the same state object is returned.
- [x] `should keep gating while the start card is only provisional` (option OFF). This replaces the premise of the test at ≈ 950, "skip preparing when card 1 is already resolved".
- [x] `should open the gate when the start card's answer becomes final`, and `should move the gate to the next card when the start card's final answer is null` (option OFF).
- [x] `should go straight to playing when keepYearless is true`.
- [x] `should keep a card whose final answer is null when keepYearless is true`: `year: null`, `confidence: 'none'`, index unchanged.
- [x] Give each existing drop and index-shift test (≈ 286–445 and 748–840) an explicit `keepYearless: false`, and add one ON counterpart per shape.
- [x] `should keep yearless cards on resume when the save keeps them`, and `should read a save without keepYearless as false`.
- [x] `yearStateOf`: all three states.
- [x] `resolvedCount` / `pendingYearCount`: a provisional card counts as pending, and `isCurrentYearPending` is false for a provisional card.
- [x] `should restart with the session's keepYearless`.

**`src/game/resolver.test.ts`**

- [x] `should never have more than one request in flight per stage`. This replaces `maxInFlight === 1`.
- [x] `should settle a card whose resolve answer is final without a verify request`.
- [x] `should queue a provisional card for verify and report the provisional year`.
- [x] `should queue a card whose resolve found nothing for verify and report nothing`.
- [x] `should verify the current card first`, and `should verify within the window before the rest`.
- [x] `should move the urgent start card to the front of verify when its resolve answer lands`: the card-1 gap.
- [x] `should send a resumed provisional card straight to verify`, and `should skip only final cards on creation`.
- [x] `should back off only the lane that got a 429`: resolve keeps crawling while verify sleeps.
- [x] `should settle an exhausted provisional card final at its provisional year, low`, and `…an exhausted empty card final at null`.
- [x] `should stop both lanes on stop() and on not-configured`.
- [x] `should never request a card twice in the same stage`: duplicated ids.
- [x] Update the existing tests that assumed one call per card, or that a null ends a card's lifecycle.

**`src/game/year-client.test.ts`**

- [x] `should send the stage`.
- [x] `should reject a 200 without a boolean final as unexpected-payload`.
- [x] `should pass agreedBy and skipped through`.

**`src/game/persistence.test.ts`**

- [x] `should round-trip yearProvisional`.
- [x] `should reject yearProvisional without a numeric year`.
- [x] `should round-trip keepYearless`, and `should load a save without it as false`.

**`src/game/pdf-sheet.test.ts`**

- [x] `should leave provisional cards out and count them`.
- [x] `should keep null-year cards only when keepYearless is true`.
- [x] The existing ≈ 341–344 case is pinned with the option OFF.

**`src/App.test.tsx` and `share-roundtrip.test.ts`**

- [x] The existing drop-and-collapse cases (≈ 204–213, 239, 598 and share-roundtrip ≈ 14, 146, 260) pass with the option OFF.
- [x] One case: a provisional year shows, then changes on a revealed card when the final answer differs (with a stub year client). Built with the option ON so card 1 is the subject: `App.test.tsx`, "should show a provisional year and change it on a revealed card when the final answer differs".

---

## Documentation Updates

- [x] `AGENTS.md` Documentation Index: mark this plan's row **Built**, with the date, once it lands. Plan 1 adds the row.
- [x] **`AGENTS.md`:**
  - the 2026-08-05 block "A card whose year lookup finds nothing is REMOVED" becomes "…a **final**
    null removes it, unless the session keeps yearless cards";
  - "no card in a live deck holds `year: null`" gains the same exception;
  - the card-1 gate sentences ("the first card has a year", "the CURRENT card has a year") become
    "the current card's answer is **final**", and only when the option is OFF;
  - the PDF block ("waits for `year === undefined`") becomes "waits for undefined **and provisional**";
  - the `CardRevealSide` `none` branch "kept for pre-reversal saves only" becomes live again;
  - add a block on `yearProvisional`, `yearStateOf`, the two lanes and why each has one slot, and the
    exhausted-verify rule.
- [x] **`docs/architecture.md` §3:** the resolver's two lanes and their pick order, the provisional
      flag's lifecycle, the persistence rules, and `keepYearless` across `START`, `RESUME`, Restart and
      the save.
- [x] **`docs/development.md` §5:** manual rows for a provisional year changing under a revealed card,
      a reload mid-verification, and the double-crawl guard now covering two lanes.
- [x] **`docs/agent_findings.md`:** a dated entry on the resolver line that marked every card with a
      year as done, and `validateCard`'s field copy, the two places a resumed provisional card would
      have silently become final.
- [x] **Inline comments that go stale**, updated in step 9 (line numbers from the investigation, to be
      re-checked):
  - `reducer.ts`: 49–52, 64–66, 105–107, 144–177, 223–225, 281–310, 378–380, 414–425, 516–517,
    528–535, 541–553;
  - `src/game/types.ts`: 18–23, 72–93, 148;
  - `shared/types.ts`: 81–86;
  - `CardRevealSide.tsx`: 11–39 (the header's "vestigial" claim; plan 4 changes the markup);
  - `pdf-sheet.ts`: 409–413;
  - `DeckActions.tsx`: 148–153, 186–190;
  - `App.tsx`: 161–162, 636–660;
  - `use-game-session.ts`: 75–76;
  - `resolver.ts`: 166–169 and the header;
  - `CardStack.tsx`: 81–90;
  - `deck-link.ts`: 39–41;
  - `src/components/__fixtures__/cards.ts`: 77.

---

## Testing Strategy

- **Unit tests:** the reducer, the resolver (with its injected sleep and the stub `ResolverLookup`,
  which gains `stage` so the harness can count requests in flight per stage), persistence and the PDF
  selector. All run in the node environment.
- **Integration tests:** `App.test.tsx` under jsdom with a stubbed year client, covering the whole
  provisional-to-final path on screen.
- **Manual verification:** step 11 on a preview deployment. The option-ON paths are verified after
  plan 4 lands.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                  | Rationale                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | `Card.yearProvisional` plus the derived `yearStateOf`                                                  | Developer's choice among the three models. It survives Restart, needs no save bump, and leaves the fixtures unchanged    |
| 2   | One resolver, two lanes, one slot per stage                                                            | Developer's choice. It preserves one MusicBrainz lookup per client and keeps all the logic in a node-testable module     |
| 3   | No provisional null in `YEAR_RESOLVED`                                                                 | A `resolve` that found nothing leaves the card pending. That is only expressible if the action cannot carry it           |
| 4   | A provisional answer never downgrades a final card                                                     | Ordering between lanes is not guaranteed after a resume or retry                                                         |
| 5   | Provisional cards are left out of every PDF, "Print so far" included, and counted                      | Developer's decision. Nothing printed can still change                                                                   |
| 6   | Exhausted verify retries settle the card final: provisional becomes `low`, empty becomes null          | Otherwise a card waits forever, and the PDF with it. Keeping the best single answer is the §10.3 rule                    |
| 7   | `keepYearless` is required on `START` and in `GameState`, optional in the save                         | Required where it is decided, so no call site can forget it. Optional where old bytes exist (the `startIndex` precedent) |
| 8   | `App.tsx` passes `false` until plan 4                                                                  | This plan ships behaviour-neutral for the option                                                                         |
| 9   | The residual "a later card dropped under the player" when OFF is accepted, and nothing is built for it | Developer's decision (spike §12.8)                                                                                       |

---

## Open Questions

- [x] The size of the verify look-ahead window. It is a named constant, and a small number of cards
      is enough to start.
      **Answered 2026-09-30: 3** (`VERIFY_LOOKAHEAD_CARDS` in `src/game/resolver.ts`) -- roughly
      the cards a quick table plays during one cold verify round trip. A guess to tune on a
      device, and the constant's comment says so; counted forward only, with no wrap.
- [ ] Whether the end screen's played count or the HUD needs any wording change when the option is ON
      and the deck never shrinks. Nothing measured suggests it does.

---

## Out of Scope

- The picker checkbox, the remembered preference, the reveal's "Confirming year" line, the copy and
  the blank PDF year (plan 4).
- A "Confirming year" line on the loading screen (spike §12.8: possible, not asked for).
- Keeping a yearless card once the player has reached it with the option OFF.
- Any server change (plan 2).
