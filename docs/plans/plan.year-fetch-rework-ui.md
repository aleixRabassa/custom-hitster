<!-- Plans for year-fetch-rework (in order):
  1. plan.year-fetch-rework-mb-fixes.md  — licence-clean MusicBrainz fixes: the cleaner bug, new cleaner families, no silent degradation, the tokenised rescue rung
  2. plan.year-fetch-rework-server.md    — the provider vote in shared/, the Deezer/iTunes adapters, per-provider gates and cache, /api/year stages
  3. plan.year-fetch-rework-game.md      — the game layer: provisional years, keepYearless, the two-lane resolver, persistence, the PDF gate
  4. plan.year-fetch-rework-ui.md        — the reveal's year slot, the picker checkbox and its remembered preference, copy in three languages, the blank PDF year  ← this file
-->

# Plan: year-fetch-rework — 4. UI: "Confirming year", the keep-yearless checkbox, the blank PDF year

> **Source:** [`docs/spikes/spike.year-fetch-rework.md`](../spikes/spike.year-fetch-rework.md) §12.5, §12.8
> **Date:** 2026-09-30
> **Author:** aleix.rabassa
> **Depends on:** [plan.year-fetch-rework-game.md](plan.year-fetch-rework-game.md) (hard). This plan needs `yearProvisional`, `yearStateOf`, `start({ keepYearless })`, `GameState.keepYearless` and the widened `selectPrintableCards`.

---

## Overview

This plan builds the three surfaces the player sees:

- **The reveal's year slot.** It gains a fourth state, a **provisional** year shown with a
  "Confirming year" notice (§12.5). The `none` branch ("Year unknown", "Check this one yourself")
  becomes a live branch again.
- **The picker checkbox.** "Keep cards with no year found" (§12.8), remembered per viewer. It is
  threaded into every deal, and a share link uses the **recipient's** remembered choice.
- **The PDF.** A kept yearless card prints with its title and artist in their usual places and the
  year area **left empty**, so the player can write the year by hand.

Every new sentence is a `COPY.*` key, translated in `copy.es.ts` and `copy.ca.ts`. Otherwise the
typecheck fails.

---

## Dependency Contract

### Requires from plan.year-fetch-rework-game

| Output                                                                                                                 | Use                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `yearStateOf(card)`, `Card.yearProvisional`                                                                            | `CardRevealSide`'s `YearSlot`                                                                                                |
| `start(cards, playlists, { startCardId?, keepYearless })`                                                              | `App.tsx` replaces the `keepYearless: false` placeholder                                                                     |
| `GameState.keepYearless`                                                                                               | `usePdfExport`'s `drawBack`                                                                                                  |
| `selectPrintableCards(deck, { keepYearless })`, which keeps null-year cards when kept and leaves provisional cards out | Plan 3 calls it with a `false` placeholder in `usePdfExport`. This plan threads the session's value and draws the blank year |

### Produces for downstream plans

(no downstream)

---

## Scope & Affected Areas

| Area                                                                                                   | Type     | Notes                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/game/copy.ts`                                                                                     | Modified | `COPY.card.yearProvisional`; `COPY.landing.keepYearless` and `COPY.landing.keepYearlessHint`                                                                                        |
| `src/game/copy.es.ts`, `src/game/copy.ca.ts`                                                           | Modified | The same three keys, translated                                                                                                                                                     |
| `src/game/prefs.ts` (+ test)                                                                           | **New**  | Pure: `PREFS_STORAGE_KEY = 'jitster:prefs:v1'`, `loadPrefs(storage)` validated on read, `savePrefs(storage, prefs)`                                                                 |
| `src/components/CardRevealSide.tsx` (+ test)                                                           | Modified | `YearSlot` switches on `yearStateOf`; the header's "vestigial `none` branch" rewritten                                                                                              |
| `src/components/LandingScreen.tsx` (+ test)                                                            | Modified | The checkbox between the playlist rows and Start; controlled `keepYearless` / `onKeepYearlessChange` props                                                                          |
| `src/App.tsx` (+ test)                                                                                 | Modified | Holds the preference seeded from `prefs.ts`, writes it on change, passes it to every `start()`                                                                                      |
| `src/hooks/usePdfExport.ts` (+ test)                                                                   | Modified | Takes `keepYearless` and passes it to `selectPrintableCards`, replacing plan 3's placeholder; `drawBack` draws the title and artist for a `year: null` card and skips only the year |
| `src/components/DeckActions.tsx`, `DeckActionsDialog.tsx`, `GameScreen.tsx`, `EndScreen.tsx` (+ tests) | Modified | Thread `keepYearless` from `App.tsx`'s `state.keepYearless` down to `usePdfExport`. Presentational props only                                                                       |
| `src/components/__fixtures__/auditable-text.ts` and the leak tests                                     | Checked  | New copy must not trip the leak proxies. The checkbox label is not year-shaped, so it should pass untouched                                                                         |

---

## Chosen Approach

**The components stay presentational and the container owns the state.**

- **`LandingScreen`** gets a controlled checkbox (a value and a change callback) rather than widening
  `onSubmit`. The same value then reaches the picker's Start and the share link's deal, which never
  passes through the picker.
- **`App.tsx`** seeds the value from a new pure `src/game/prefs.ts`, built exactly like `locale.ts`:
  an injected `StorageLike`, a new never-renamed key, validation on read, and a guarded
  `localStorage` access.
- **`CardRevealSide`** switches on plan 3's `yearStateOf`, so the four states are one exhaustive
  switch.
- **The PDF** reuses `backLayout()` unchanged and just skips the year's `text` call, so the print
  palette and geometry are untouched.

The alternatives were rejected for these reasons:

- **Widening `onSubmit`** would leave the link deal without a value.
- **A context provider for one boolean** would be a second place to learn where the preference lives.
- **Drawing a box to write in** was not asked for. It is a one-line addition if the developer wants it
  later.

---

## Implementation Steps

- [x] **Step 1: copy.**
  - [x] In `src/game/copy.ts`, add three keys:
    - `card.yearProvisional`: "Confirming year";
    - `landing.keepYearless`: "Keep cards with no year found", the developer's own wording;
    - `landing.keepYearlessHint`: "Useful to print the whole deck and write missing years by hand".
  - [x] In `copy.es.ts`, add "Confirmando año", "Mantener cartas sin año" and "Útil para imprimir la
        baraja entera y escribir a mano los años que falten".
  - [x] In `copy.ca.ts`, add "Confirmant l'any", "Mantenir cartes sense any" and "Útil per imprimir la
        baralla sencera i escriure a mà els anys que faltin".
  - [x] The Spanish and Catalan strings are **proposals**. Their comments say they have not been read
        by a native speaker, and they join the existing row in `docs/development.md` §5.
- [x] **Step 2: the reveal's year slot (`src/components/CardRevealSide.tsx`).** `YearSlot` switches on
      `yearStateOf(card)`, with an exhaustive `never` check:
  - [x] **pending:** the existing spinner in its fixed-size box, plus `copy.card.yearPending`,
        unchanged;
  - [x] **provisional:** the year exactly as a final year renders, plus `copy.card.yearProvisional` in
        the same slot and style as the unconfirmed notice (`text-sm`). Its colour token is
        `text-fg-secondary` rather than `text-warning`, because it is progress, not a warning. It is a
        token, never an opacity modifier;
  - [x] **final, `high`:** the year, no notice, unchanged;
  - [x] **final, `low`:** the year plus `copy.card.yearUnconfirmed`, unchanged;
  - [x] **final, `year: null`:** the existing "Year unknown" and "Check this one yourself" branch,
        unchanged markup. Rewrite the header: the branch is **live** again for sessions that keep
        yearless cards, and still covers pre-reversal saves.
  - [x] **The live region.** The notice sits **inside** the reveal's existing polite `role="status"`,
        so a provisional-to-final change is announced. Add no second live region anywhere, since
        `CardHiddenSide` must stay free of one. `Card.tsx` still mounts this component only while the
        card is flipped, which is what makes announcing track data safe.
  - [x] **The slot's size.** The notice line reserves the same height as the unconfirmed line, so the
        card does not jump when "Confirming year" disappears on a confirmed final. Check this
        against the existing `justify-center` column.
- [x] **Step 3: the preference module (`src/game/prefs.ts`).**
  - [x] Export `PREFS_STORAGE_KEY` (`jitster:prefs:v1`) and a `Prefs` type holding `keepYearless`.
  - [x] `loadPrefs(storage)` validates on read, and anything malformed reads as the default
        (`keepYearless: false`).
  - [x] `savePrefs(storage, prefs)` rebuilds the object field by field on write, following the
        `playlist-library.ts` leak rule that a spread must not persist extra fields.
  - [x] It is node-tested with an injected `StorageLike`, like `locale.ts`.
- [x] **Step 4: the picker checkbox (`src/components/LandingScreen.tsx`).**
  - [x] Add required props `keepYearless` and `onKeepYearlessChange`.
  - [x] Render a native `<input type="checkbox">` inside its `<label>`, between the playlist rows and
        Start, with `focus-visible:focus-ring` and `touch-target`. The `text-sm` sits on the caption
        span, not on the label, which is the preflight trap recorded for this screen's inputs.
  - [x] Render the hint as a second line tied to the input with `aria-describedby`.
  - [x] Disable it while a request is loading, as the rows are.
  - [x] It uses tokens only, with no literal colours.
  - [x] The `pt-8` equal-height contract with the welcome screen, the `gap-8` and the Back button are
        untouched. The existing tests that pin them keep passing.
- [x] **Step 5: the container (`src/App.tsx`).**
  - [x] Hold `keepYearless` in `useState`, seeded lazily from `loadPrefs` through the guarded storage
        access `LocaleProvider` already uses (`readLocalStorage()`).
  - [x] On change, update the state and call `savePrefs`, inside a try/catch-guarded write.
  - [x] Pass the value to `LandingScreen` and to **every** `start()`: the picker's submit, the link's
        deal effect, and "Play the shared deck" from `ReplaceSessionPrompt`. This replaces plan 3's
        `false` placeholder.
  - [x] Restart and "Play again" keep the **session's** `state.keepYearless`, already done in plan 3,
        not the current preference.
  - [x] A resumed game uses the save's value.
  - [x] The share link format is unchanged. It never carries the sender's choice, and
        `linkArrivalIntent` is untouched.
- [x] **Step 6a: thread the option to the export.** Add a required `keepYearless` prop to
      `DeckActions` and pass it into `usePdfExport`, which forwards it to `selectPrintableCards` and
      removes plan 3's `false` placeholder. `DeckActions` is shared by both screens, so its tests live
      once, in `DeckActions.test.tsx`. Thread it through `DeckActionsDialog` and `GameScreen` (the
      mid-game dialog) and `EndScreen`, each receiving it from `App.tsx`'s `state.keepYearless`. It is
      the session's value, never the picker's current preference.
- [x] **Step 6b: the PDF blank year (`src/hooks/usePdfExport.ts`).** In `drawBack`:
  - [x] Draw the title and artist for any card that reaches it. Only the year's `text` call is skipped
        when `year` is null. The early return at ≈ line 267 becomes a check on whether there is a card
        at all.
  - [x] Use `backLayout()` unchanged, draw no box and no line, and leave the print palette unchanged.
  - [x] `selectPrintableCards` (plan 3) already decides which cards get this far.
- [x] **Step 7: check the leak proxies.** Run the pre-start surface audits. The three new strings
      contain no year-shaped text, so they should pass. If one fails, fix the copy, not the pattern.
- [x] **Step 8: grep the built CSS** (`dist/assets/*.css`) for every token utility the new markup uses
      (`text-fg-secondary` and any other), per the silent-no-op rule.
- [x] **Step 9: run the four checks:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 10: preview deployment.**
  - [ ] **Option ON:** the game starts without a loading screen. A card flipped at once shows the
        spinner, then the year with "Confirming year", then the final state.
  - [ ] **Option ON:** a yearless card stays and prints blank.
  - [ ] **Option OFF:** exactly as after plan 3.
  - [ ] The checkbox is remembered across reloads, and a share link opened in a fresh profile deals
        with the option OFF.

---

## Unit Tests

**`src/components/CardRevealSide.test.tsx`**

- [x] `should show the provisional year with COPY.card.yearProvisional`.
- [x] `should show a final high year with no notice`, and `should show a final low year with COPY.card.yearUnconfirmed`: both unchanged, re-asserted through `yearStateOf`.
- [x] `should show COPY.card.yearUnknown for a kept yearless card`.
- [x] `should keep the notice inside the reveal's status region`.
- [x] `should render the provisional notice with the fg-secondary token`: the silent-colour canary.
- [x] `should replace the provisional year when the card's year changes`: a re-render with a final card of a different year.

**`src/game/prefs.test.ts`**

- [x] `should default to keepYearless false with nothing stored`.
- [x] `should reject malformed values`.
- [x] `should round-trip`.
- [x] `should write only known fields`: a spread with an extra field is not persisted.
- [x] `should use the jitster:prefs:v1 key`.

**`src/components/LandingScreen.test.tsx`**

- [x] `should render the checkbox with COPY.landing.keepYearless and the hint`.
- [x] `should call onKeepYearlessChange when toggled`.
- [x] `should reflect the keepYearless prop`.
- [x] `should disable the checkbox while loading`.
- [x] `should carry focus-visible:focus-ring and touch-target`.
- [x] `should keep pt-8 and gap-8`: the existing pins still pass.

**`src/App.test.tsx`**

- [x] `should deal with keepYearless from the checkbox`.
- [x] `should remember the checkbox across a remount`.
- [x] `should deal a share link with the recipient's remembered choice`.
- [x] `should restart with the session's keepYearless even after the checkbox changed`.
- [x] `should start straight on the game screen when keepYearless is on`: no preparing screen.

**`src/hooks/usePdfExport.test.ts`, with jsPDF doubled**

- [x] `should draw title and artist but no year for a kept yearless card`. Lives in `DeckActions.test.tsx`: there is no `usePdfExport.test.ts`, and that file already doubles `jspdf`, whose `text` calls it records.
- [x] `should draw the year for a final card as before`. Also `DeckActions.test.tsx`.
- [x] `should pass keepYearless through to selectPrintableCards`: a kept yearless card is exported on ON and counted as excluded on OFF (`DeckActions.test.tsx`, with `qrcode` and `jspdf` doubled as that file already does).
- [x] `should hand the session's keepYearless to DeckActions from both screens`: `GameScreen.test.tsx` and `EndScreen.test.tsx`.

**`src/game/i18n.test.ts`**

- [x] The three new keys exist in every catalogue. The typecheck enforces this already; the test keeps "every key has a non-empty string".

---

## Documentation Updates

- [x] `AGENTS.md` Documentation Index: mark this plan's row **Built**, with the date, once it lands. Plan 1 adds the row.
- [x] `AGENTS.md`:
  - [x] Add a block on the "Keep cards with no year found" option: what it changes (the gate, the drop,
        the PDF), that it is remembered under `jitster:prefs:v1`, that a share link uses the
        recipient's choice and Restart the session's, and that the residual when OFF is accepted.
  - [x] Update the `CardRevealSide` live-region rule: the region now also announces "Confirming year"
        and a changed year.
  - [x] Add the three `COPY` keys to the copy notes where relevant.
- [x] `docs/architecture.md` §3: the reveal's four year states, the preference module, and the PDF's
      blank year.
- [x] `docs/development.md` §5, new manual rows:
  - [x] the checkbox's position and wording at 320 px;
  - [x] a screen reader over a provisional-to-final change, joining the existing screen-reader row;
  - [x] a printed blank year, and whether it needs a guide to write on;
  - [x] a native speaker's read of the Spanish and Catalan strings.
- [x] `docs/agent_findings.md`: a dated entry if the leak proxies or the CSS grep turn up anything.
- [x] `README.md`: one line about the option, if the README describes the picker's controls.
- [x] **Do not regenerate** the store screenshots or any visual asset. The picker now looks different,
      so **tell the developer** the listing screenshots are stale (the 2026-09-24 rule).

---

## Testing Strategy

- **Unit tests:** `prefs.ts` in the node environment; the components under jsdom with their own
  `afterEach(cleanup)` and `clearQrCache()` where a card renders.
- **Integration tests:** `App.test.tsx` for the preference reaching every deal, and the option-ON
  start.
- **Manual verification:** step 10, plus the §5 rows. jsdom computes no layout and has no
  accessibility tree, so the 320 px fit and the announcement are manual.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                  | Rationale                                                                                          |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | The preference is remembered under `jitster:prefs:v1`, default OFF                     | Developer's choice                                                                                 |
| 2   | A share link uses the recipient's remembered choice; Restart uses the session's        | Spike §12.8. The link format stays unchanged                                                       |
| 3   | English source strings "Confirming year", "Keep cards with no year found" and the hint | The label is the developer's wording. "Confirming year" pairs with the existing "Unconfirmed year" |
| 4   | The provisional notice uses `text-fg-secondary`, not `text-warning`                    | It is progress, and the amber marker must keep meaning "unconfirmed"                               |
| 5   | A controlled checkbox in `LandingScreen`, state in `App.tsx`                           | One value reaches both the picker deal and the link deal. Components stay presentational           |
| 6   | No box or line on a blank PDF year                                                     | Not asked for, and it keeps the print palette unchanged                                            |

---

## Open Questions

- [ ] Do the Spanish and Catalan strings read naturally? Ask a native speaker.
- [ ] Does the checkbox plus its hint push Start below the fold on a 320 px phone? It is a manual row.
      If it does, dropping the hint is the first lever.

---

## Out of Scope

- A "Confirming year" line on the loading screen.
- A write-in guide on the PDF.
- Carrying the sender's option in the share link.
- Regenerating any visual asset.
- Anything below React (plans 2 and 3).
