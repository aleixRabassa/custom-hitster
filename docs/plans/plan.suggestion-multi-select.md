<!-- Follows the two multi-playlist plans:
  1. plan.multi-playlist-core.md      — the merge, the state shape, persistence, the link and the library
  2. plan.multi-playlist-ui.md        — the landing rows, the fan-out hook, the container wiring
  3. plan.suggestion-multi-select.md  — holding a suggestion selects it  ← this file
-->

# Plan: hold a suggested playlist to select it

> **Jira:** suggestion-multi-select
> **Date:** 2026-08-12
> **Author:** Aleix Rabassa
> **Depends on:** [plan.multi-playlist-ui.md](plan.multi-playlist-ui.md) — the rows, the array
> `onSubmit` and the fan-out are all built there. **Built.**

---

## Overview

A deck has been 1..5 playlists since 2026-08-07, but the only way to reach more than one was pasting
links by hand. The suggestions — the one-click demo path a first-time visitor actually uses — could
only ever deal a single-playlist deck, and pressing one **replaced** whatever was typed.

**Holding a suggestion now selects it** instead of dealing a deck from it. It highlights, it appears
as a row in the form, and further suggestions join it with a single tap each, up to
`MAX_DECK_PLAYLISTS`. Start plays all of them. Pressing a selected one again, or pressing its row's
✕, removes it.

Nothing below React changed. `onSubmit` has taken an array since plan 2, so a five-suggestion deck is
the same call a five-row paste already made: no reducer action, no storage format, no link format, no
hook, no container change.

---

## Chosen Approach

**The selection is derived from the rows and is never stored.** A suggestion is lit exactly when some
row holds a link parsing to its id. That single fact makes three requirements disappear rather than be
built: the row's ✕ _is_ a deselect, a hand-pasted link lights the suggestion it names, and there is no
second copy of the truth to drift out of step with the boxes the player can see. Same shape as
`App.tsx` deriving `deckCollapsed` and `usePdfExport` deriving its wait.

**The decisions are a pure module and the press is a thin hook**, the house split, and here it is not
ceremony: a wrong cap deals a six-playlist deck and a wrong index empties a box the player typed into,
and neither is a rendering difference a jsdom assertion would notice.

Chosen over a "Play N selected" button (a second submit path, and the form already has one), over
checkboxes beside each suggestion (a second control per row on a screen whose whole job is one
action), and over making every press select (which spends the one-click demo path the suggestions
exist for).

---

## Decisions

| #   | Decision                                                                     | Rationale                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A press with nothing selected still deals a deck immediately.**            | Decision 5 of plan 2, unchanged, including that it replaces typed rows. It is the demo path and the reason the suggestions are on the screen. Developer's call.   |
| 2   | **Ctrl / Cmd / Shift + activate also toggles.**                              | The keyboard's ONLY route — a hold cannot be performed without a pointer, and Enter and Space carry modifier flags. Also the mouse's shortcut.                    |
| 3   | **"Selection mode" is scoped to the suggestions, not to any parseable row.** | The highlight is the only cue for which of two things a press does. Reading it as "any valid row" lets a typed link silently change every suggestion's behaviour. |
| 4   | **The selection is derived, never stored.**                                  | The ✕ deselects for free, a pasted link lights its suggestion for free, and the highlight cannot disagree with the form.                                          |
| 5   | **Suggestions only; the saved library keeps submitting instantly.**          | A saved entry is already 1..5 playlists, so combining two of them makes the cap arithmetic something the player cannot see. Developer's call.                     |
| 6   | **`LONG_PRESS_DURATION_MS` lives in `gestures.ts`, not its own module.**     | It must stay above `TAP_MAX_DURATION_MS`; nothing compares them at runtime and no rendering changes if they cross. Proximity plus one assertion is the guard.     |
| 7   | **A toggle fills the first blank row before appending.**                     | Otherwise the first selection leaves the empty starting row above a new one, and the form grows a hole per press.                                                 |
| 8   | **At the cap a selection is a silent no-op.**                                | The form already shows "N playlists is the maximum for one deck" in exactly that state. A second message about the same fact is noise.                            |
| 9   | **The row's ✕ now renders beside a lone FILLED row.**                        | The first selection lands in the single starting row; without this it would be the one selection the ✕ could not undo. Removing the last row substitutes a blank. |
| 10  | **`aria-pressed` is unconditional.**                                         | An attribute that appears and disappears changes the control's announced role halfway through the screen.                                                         |

---

## What was built

| File                                       | Type | Notes                                                                              |
| ------------------------------------------ | ---- | ---------------------------------------------------------------------------------- |
| `src/game/playlist-selection.ts`           | New  | `selectedPlaylistIds`, `planSelectionToggle`, `suggestionIntent`. Pure             |
| `src/game/playlist-selection.test.ts`      | New  | Node environment. Every rule, every branch, both sides of the cap                  |
| `src/game/gestures.ts`                     | Mod  | `LONG_PRESS_DURATION_MS`, `LONG_PRESS_MAX_MOVEMENT_PX`, `exceedsLongPressMovement` |
| `src/game/gestures.test.ts`                | Mod  | The drift bounds, and that the hold outlasts the tap                               |
| `src/hooks/useLongPress.ts`                | New  | One timer, three refs, `consumeLongPress()`. No thresholds                         |
| `src/components/SuggestionButton.tsx`      | New  | One suggestion. Its own component because a hook cannot be called in a `.map()`    |
| `src/components/SuggestionButton.test.tsx` | New  | jsdom. Real pointer sequences against a fake clock                                 |
| `src/components/LandingScreen.tsx`         | Mod  | Derives the selection, applies the plan, and the ✕'s new case                      |
| `src/components/LandingScreen.test.tsx`    | Mod  | A `the suggestion selection` block; every pre-existing assertion unchanged         |

Everything else is documentation. **`App.tsx`, `usePlaylist.ts`, `deck-merge.ts`, `deck-link.ts`,
`playlist-library.ts`, the reducer and every downstream screen are untouched.**

---

## Traps

- **`consumeLongPress()` must stay FIRST in the button's `onClick`, and must return.** `click` fires
  after `pointerup`, so without it a hold selects the playlist and the click a millisecond later
  deals a single-playlist deck from it — the gesture that exists to build a multi-playlist deck
  would instead start a game and discard the selection.
- **The flag is cleared by the next `pointerdown`, not by the click.** A hold whose pointer produced
  no click (released off the button, cancelled by a scroll) would otherwise leave it set and swallow
  an unrelated press much later.
- **`useLongPress` reads only `clientX`/`clientY` off the event, and that is now a constraint.**
  jsdom has no `PointerEvent`; Testing Library falls back to a plain `Event` and copies the init
  props on. Read `pointerId` or `getCoalescedEvents()` and every pointer test stops working.
- **`select-none`, `touch-manipulation` and `[-webkit-touch-callout:none]` are asserted by nothing.**
  A synthetic pointer cannot raise a platform text-selection callout. They are three class names that
  either work on a real finger or do not — see the manual rows.
- **A CSS delta cannot be isolated by reverting the import.** Tailwind v4 scans files, not the module
  graph, so an unimported component still generates its utilities.

---

## Checks

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, all four green.
**Run 2026-08-12: 50 files / 829 tests.** Bundle, initial path: **213.00 → 215.05 kB raw, 66.63 →
67.40 kB gzip (+2.05 / +0.77)**, isolated against the same tree with the feature stashed.

---

## Manual verification

Eight rows in [`docs/development.md`](../development.md) §5, all Pending. The load-bearing ones are
the **two callout rows** (nothing local can raise one), the **scroll row** (the suggestions live in
the one column that outgrows the viewport, so a drifting hold is the ordinary case), and the
**screen-reader row** — `aria-pressed` is the only thing that makes this feature exist without sight,
since the highlight and the tick are both visual and a hold needs a pointer.

The 360px row is [`plan.multi-playlist-ui.md`](plan.multi-playlist-ui.md)'s first Open Question, which
this feature makes far easier to reach: five rows used to mean pasting five links and is now five
taps. Its recorded remedy still applies — collapse the suggestions rather than shrink the rows.

---

## Out of Scope

- The saved-playlist library (decision 5).
- Reordering the selection, or a count on the Start button.
- Any change below React, to `api/`, or to `shared/`.
- A pre-Start deck preview or per-playlist track count. The landing screen stays count-free and
  name-only.
