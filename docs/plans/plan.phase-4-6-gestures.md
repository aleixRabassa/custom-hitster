<!-- Plans for phase-4-6 (in order):
  1. plan.phase-4-6-card-ui.md   — Phase 4: test environment, the card, QR, and audio
  2. plan.phase-4-6-gestures.md  — Phase 5: swipe, tap, stacked deck, keyboard  ← this file
  3. plan.phase-4-6-screens.md   — Phase 6: landing, playlist client, notices, HUD, end screen
-->

# Plan: phase-4-6 — Phase 5: Gestures

> **Task:** phase-4-6
> **Date:** 2026-08-05
> **Author:** Aleix Rabassa
> **Source:** [`plan.md`](./plan.md) §5 Phase 5
> **Depends on:** [plan.phase-4-6-card-ui.md](plan.phase-4-6-card-ui.md) — this plan makes the card from plan 1 draggable, tappable and keyboard-driven; it needs `Card`, `GameScreen`, `useCardAudio` and the jsdom test environment to exist first.

---

## Overview

Phase 5 makes the card respond to hands: swipe left/right to advance, tap to flip, and — for laptop
and tablet play — Space to flip and → to advance. It also adds the stacked-deck visual (2–3 cards
peeking behind the top one) and the exit animation that makes a swipe feel like dealing a card
rather than toggling a variable.

The whole phase turns on one distinction: **a tap and a drag begin with the identical pointer
event.** `plan.md`'s risk table calls this out and prescribes the mitigations — a movement threshold
in `onDragEnd`, `touch-action: none`, and pull-to-refresh disabled. Getting it wrong is not a
cosmetic bug: a tap misread as a swipe skips a card irrecoverably (there is no "previous card"), and
a swipe misread as a tap reveals the answer the player was about to guess.

The honest limitation to plan around: **jsdom cannot verify a drag.** Motion's drag handling reads
element geometry that jsdom does not compute, so a simulated pointer sequence in a test does not
exercise the real code path. This plan therefore pushes every decision a drag makes into pure
functions that are exhaustively unit-tested in the node environment, keeps jsdom for keyboard and
wiring, and treats real-device verification on iOS Safari and Android Chrome as a required step
rather than a nice-to-have — which is exactly what `plan.md` already says about touch.

---

## Dependency Contract

### Requires from plan.phase-4-6-card-ui

| Output | Description |
|---|---|
| `src/components/Card.tsx` | The flip shell. Exposes `onFlip` without deciding what triggers it — this plan supplies the trigger |
| `src/components/GameScreen.tsx` | Host for the card and the single `<audio>` element; gains the key handler and the stack here |
| `src/hooks/useCardAudio.ts` | `stop()`, called when a swipe commits, so audio never crosses a card boundary |
| `src/components/__fixtures__/cards.ts` | The shared fixture deck |
| jsdom + Testing Library, selected per file via docblock | Keyboard and wiring tests |
| `overscroll-behavior: none` in `src/index.css` | Already added in plan 1; vertical drag tolerance depends on it |

### Produces for downstream plans

| Output | Consumed by |
|---|---|
| `src/game/gestures.ts` — pure threshold decisions | plan 3 (nothing directly); the tests are the contract |
| `src/hooks/useCardGestures.ts` | plan 3 — `GameScreen` keeps using it unchanged |
| `src/components/CardStack.tsx` | plan 3 — rendered inside `GameScreen` beneath the HUD |
| Keyboard handling in `GameScreen` | plan 3 — must keep working once the landing screen's text input exists, which is why the guard against typing-in-inputs is written here |

---

## Scope & Affected Areas

| Area | Type | Notes |
|------|------|-------|
| `src/game/gestures.ts` | New | Pure decisions: does this drag commit, and was that pointer sequence a tap. No React, no DOM — node-testable. Lives beside the other pure game logic |
| `src/game/gestures.test.ts` | New | Exhaustive threshold coverage |
| `src/hooks/useCardGestures.ts` | New | Binds the pure decisions to Motion's drag callbacks and to pointer events |
| `src/components/Card.tsx` | Modified | Becomes a Motion element with `drag="x"`; receives gesture props |
| `src/components/CardStack.tsx` | New | The top card plus 2 static backs; owns the `AnimatePresence` exit animation |
| `src/components/GameScreen.tsx` | Modified | Renders `CardStack` instead of a bare `Card`; adds the keyboard handler |
| `src/index.css` | Modified | `touch-action: none` on the draggable surface if a utility class does not cover it; confirm the `overscroll-behavior` rule from plan 1 is in effect |
| `src/components/CardStack.test.tsx`, `src/components/GameScreen.test.tsx` | New / Modified | See Unit Tests |
| `docs/plans/plan.md` | Modified | Tick Phase 5; annotate the drag-testability limitation |
| `AGENTS.md` | Modified | Current phase → 5 |
| `docs/architecture.md` | Modified | §7 Phase 5 built; note that `motion` now has its first importer |
| `docs/development.md` | Modified | Real-device verification procedure (LAN dev server or preview deploy) |
| `docs/agent_findings.md` | Modified | New dated entries — see Documentation Updates |

---

## Chosen Approach

**Push every gesture decision into pure functions, then bind them with the thinnest possible hook.**
`src/game/gestures.ts` answers two questions with no DOM involved: given a drag's horizontal offset
and velocity, does it commit to the next card; and given a pointer-down/pointer-up pair (delta x,
delta y, elapsed ms, and whether a drag was recognised), was that a tap. `useCardGestures` then
wires those answers to Motion's `onDragEnd` and to pointer handlers, and `Card` becomes a Motion
element with `drag="x"`.

This is the same shape Phase 3 chose for the resolver — a framework-free decision core with a thin
React seam — and for the same reason: it is the only way these thresholds get tested at all. Motion
is used for what it is genuinely good at (`drag="x"`, `dragConstraints`, snap-back, and
`AnimatePresence` for the exit animation) and not for the decisions.

The stacked deck renders the top card as a full `Card` and the next 2 as **static backs with no
content, no QR and no audio**. That is both a leak decision (a card behind the top one has no reason
to have its data in the DOM) and a cost decision (QR generation is asynchronous work per card, and
`plan.md` puts QR lazy-loading in Phase 7 precisely because it is not free).

Keyboard controls live in `GameScreen` as a window-level handler rather than on a focused element,
because the card is not a focusable control and the player's hands are not on it. The handler guards
against three things that would otherwise make it hostile: keystrokes while focus is in a text input
(plan 3 adds one on the landing screen), auto-repeat held keys, and — the subtle one — **Space while
focus is on the Play/Pause button**, which would otherwise both toggle audio and flip the card from
a single press.

---

## Implementation Steps

- [x] **Step 1 — Build `src/game/gestures.ts`** with two pure functions and their tuning constants.
  - [x] A commit decision from a drag's horizontal offset and velocity: commit when the offset
        exceeds a distance threshold **or** the velocity exceeds a flick threshold, so both a slow
        deliberate drag and a fast flick advance. Below both, the caller snaps back
  - [x] A tap decision from delta x, delta y, elapsed time, and whether Motion recognised a drag:
        a tap requires movement under a small radius (both axes), a short duration, and no
        recognised drag. Vertical tolerance matters — a thumb tap on a phone is never perfectly
        still, which is why `overscroll-behavior: none` was set in plan 1
  - [x] Export the constants named and documented, with the reasoning for each number in a comment.
        These are the values the real-device pass will tune, and an unnamed magic number is a value
        nobody dares change later
  - [x] Decide direction handling explicitly: **both** left and right advance (there is no previous
        card, and a right-swipe that snapped back would read as a broken gesture). Record it
- [x] **Step 2 — Build `useCardGestures.ts`.** Returns the props to spread onto the Motion card
      (drag axis, constraints, elastic, the `onDragEnd` handler) plus pointer handlers for tap
      detection, and takes `onFlip` / `onNext` callbacks.
  - [x] Track pointer-down coordinates and timestamp in a ref; decide on pointer-up via the pure
        function. Use a ref, not state — a re-render per pointer move would fight the drag
  - [x] Mark a recognised drag in a ref on `onDragStart` and clear it after the pointer-up decision,
        so a drag that ends below threshold does not also register as a tap
  - [x] On commit: call `onNext`. `GameScreen` already stops audio on card change (plan 1), so
        nothing extra is needed here — verify that rather than duplicating the call
  - [x] Guard against a commit firing twice for one gesture (a fast flick can produce overlapping
        callbacks), and against a commit on the last card racing the transition to `ended`
- [x] **Step 3 — Make `Card` draggable.** Convert the flip shell's outer element to a Motion element
      with `drag="x"`, constrained, with snap-back below threshold and an exit animation on commit.
  - [x] `touch-action: none` on the draggable surface — a Tailwind utility if one covers it,
        otherwise a plain rule in `src/index.css`. Without it, the browser's own scroll handling
        steals the gesture on touch devices
  - [x] Keep the flip transform and the drag transform from fighting each other: the rotation
        belongs to the inner face wrapper (plan 1's structure), the drag to the outer element
  - [x] Do not let a drag in progress trigger a flip — that is what the tap decision is for
- [x] **Step 4 — Build `CardStack.tsx`.** The current card on top, plus up to 2 backs behind it at
      small offsets and scales to suggest a deck.
  - [x] Backs render **no card content, no QR, and no audio** — a placeholder back face only. They
        exist to be seen, not read
  - [x] Wrap the top card in `AnimatePresence` so the committed card animates out while the next
        card takes its place, keyed by card id
  - [x] Handle the tail of the deck: with one card left there are no backs, and the stack must not
        render a phantom back for a card that does not exist. `noUncheckedIndexedAccess` will make
        this explicit
  - [x] Handle the duplicate-id case from the fixture deck: a playlist may legitimately contain the
        same track twice, so an `AnimatePresence` key of the bare card id can collide between
        adjacent cards. Key on id plus deck index
- [x] **Step 5 — Add keyboard controls to `GameScreen`**: Space flips, → advances.
  - [x] Attach at the window level in an effect, cleaned up on unmount
  - [x] `preventDefault()` on Space so the page does not scroll
  - [x] Ignore the event when the active element is an input, textarea, or has `contenteditable` —
        plan 3 adds a text input to the landing screen and this handler must not eat its spaces
  - [x] **Ignore Space when the active element is a button** — otherwise one press both activates
        the focused Play/Pause button and flips the card. Consider moving focus off the control
        after a click as a belt-and-braces measure
  - [x] Ignore auto-repeat (held-key) events, so leaning on → does not deal the whole deck
  - [x] Only handle keys while the game is actually playable; the container passes that in
- [ ] **Step 6 — Verify on real devices.** `plan.md` says plainly that touch is where this breaks,
      and jsdom cannot substitute. Use `pnpm dev --host` over the LAN or a preview deploy.
  - [ ] iOS Safari: tap-to-flip reliability, swipe-to-advance, no rubber-band scroll or
        pull-to-refresh stealing the gesture, no accidental text selection or long-press menu on the
        card, and that audio still starts from the first tap (iOS is strictest about the gesture
        requirement)
  - [ ] Android Chrome: the same, plus that pull-to-refresh is genuinely disabled
  - [ ] Both: that a tap near the card's edge is not read as a drag, and that a deliberate slow drag
        of half the card's width commits
  - [ ] Tune the constants from step 1 against what the devices actually do, and record the final
        values and what was wrong with the first guesses
  - [ ] Check the layout does not shift on the iOS Safari toolbar show/hide — the card is
        viewport-sized, and `dvh` behaves differently from `vh` there. Full responsive work is
        Phase 7, but a card that cannot be reached is a Phase 5 problem
- [x] **Step 7 — Run the full gate**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
      Note `eslint-plugin-react-hooks` is active on `src/**` and will flag a ref or callback used in
      an effect without the right dependencies.

---

## Unit Tests

**Pure gesture decisions (node environment, `src/game/gestures.test.ts`) — the real coverage:**

- [x] `should commit when the horizontal offset exceeds the distance threshold` — covers the slow
      deliberate drag
- [x] `should commit when velocity exceeds the flick threshold even with a small offset` — covers
      the fast flick
- [x] `should not commit below both thresholds` — covers snap-back
- [x] `should commit for a left swipe and for a right swipe` — covers the both-directions decision
- [x] `should treat exactly-at-threshold as committed` — pins the boundary so a later refactor
      cannot flip it silently
- [x] `should recognise a still, brief pointer sequence as a tap` — covers tap-to-flip
- [x] `should not recognise a sequence as a tap when a drag was recognised` — the core
      disambiguation
- [x] `should not recognise a long press as a tap` — covers the duration bound
- [x] `should tolerate small vertical movement in a tap` — covers the thumb-tap-is-never-still case
- [x] `should not recognise large vertical movement as a tap` — covers the other side of that bound
- [x] `should not recognise a horizontal move beyond the tap radius as a tap` — the case that
      would otherwise reveal the answer the player was about to guess

**Keyboard and wiring (jsdom, `src/components/GameScreen.test.tsx`):**

- [x] `should flip on Space` — covers the keyboard flip
- [x] `should advance on ArrowRight` — covers the keyboard advance
- [x] `should prevent default on Space` — covers page-scroll suppression
- [x] `should ignore Space while focus is in a text input` — covers plan 3's landing input
- [x] `should ignore Space while focus is on a button` — covers the double-action bug on Play/Pause
- [x] `should ignore auto-repeat key events` — covers a held → dealing the deck
- [x] `should not handle keys when the game is not playable` — covers the guard
- [x] `should remove the key handler on unmount` — covers the effect cleanup

**Stack rendering (jsdom, `src/components/CardStack.test.tsx`):**

- [x] `should render the current card on top` — covers the basic case
- [x] `should render up to two backs behind the current card` — covers the stacked visual
- [x] `should render no backs on the last card` — covers the tail of the deck
- [x] `should not render title, artist, year, or a QR code for the backs` — the leak-and-cost
      decision, and the assertion that stops a later "just reuse Card for the backs" refactor
- [x] `should give adjacent duplicate-id cards distinct keys` — covers the duplicate-track case,
      using the fixture deck's duplicate pair

**Not covered by automated tests, deliberately:** the drag path itself. Motion's drag reads element
geometry jsdom does not compute, so a simulated pointer sequence would assert that the test double
works rather than that the gesture does. This is stated here so nobody later reads the absence as an
oversight and writes a test that passes without exercising anything.

---

## Documentation Updates

- [ ] `docs/plans/plan.md` — tick Phase 5 (all five); annotate that swipe itself is verified on real
      devices rather than in jsdom, and record the final threshold values
- [ ] `docs/plans/plan.phase-4-6-gestures.md` — this file: tick steps, add Execution Notes with the
      tuned constants and whatever the devices did that the first guesses did not predict
- [ ] `AGENTS.md` — current phase → 5
- [ ] `docs/architecture.md` — §7 Phase 5 built; note that `motion` now has its first importer
      (Phase 1 installed it with none, deliberately), and where the gesture split lives (pure
      decisions in `src/game/gestures.ts`, binding in `src/hooks/useCardGestures.ts`)
- [ ] `docs/development.md` — how to reach the dev server from a phone on the LAN, and the
      device-verification checklist from step 6, so the next person does not reinvent it
- [ ] `docs/agent_findings.md` — new dated entries, and **tell the developer** they were added:
  - [ ] Motion's drag cannot be exercised under jsdom, and why the pure-decision split is what makes
        the thresholds testable at all — the same shape Phase 3 used for the resolver
  - [ ] The Space-on-a-focused-button double-action: one press activating a control *and* flipping
        the card. Cheap to fix, invisible until someone plays with a keyboard after clicking Play
  - [ ] Whatever the real-device pass turns up — this is the entry most likely to be worth
        something later, because it is the part no local check models. Include the tuned threshold
        values and the platform each was wrong on
  - [ ] The `AnimatePresence` key collision for a playlist containing the same track twice, if it
        materialises

---

## Testing Strategy

- **Unit tests:** exhaustive on the pure gesture decisions (node), including both sides of every
  boundary. Keyboard handling and stack composition in jsdom.
- **Integration tests:** `GameScreen` covers keyboard-to-callback wiring and that a committed
  advance stops audio (the plan 1 behaviour must not regress once a swipe can trigger it).
- **Manual verification:** step 6 in full, on both platforms, before ticking the phase. Specifically
  including: a tap that must flip and not advance, a flick that must advance and not flip, a drag
  released below threshold that must snap back, pull-to-refresh at the top of the card, and audio
  starting from the very first tap on iOS.

---

## Assumptions & Decisions

| # | Assumption / Decision | Rationale |
|---|---|---|
| 1 | Gesture *decisions* are pure functions in `src/game/gestures.ts`; Motion only supplies the mechanics | The only way the thresholds get tested, since jsdom cannot exercise a drag. Mirrors Phase 3's framework-free-core-plus-thin-seam split, which is the house style now |
| 2 | Both left and right swipes advance | There is no previous card, so a right swipe has nothing to mean. Snapping it back would read as a broken gesture rather than a deliberate one |
| 3 | Commit on offset **or** velocity | A slow deliberate drag and a fast flick are both clear intent; requiring both would reject the flick, which is the more common phone gesture |
| 4 | The stacked backs render no content, no QR, and no audio | Leak: a card behind the top one has no reason to be in the DOM. Cost: QR generation is async work per card, and Phase 7 lazy-loads it precisely because it is not free |
| 5 | `AnimatePresence` keys are card id **plus** deck index | A playlist may legitimately contain the same track twice; Phase 3's reducer already handles duplicate ids explicitly, and a bare-id key would collide between adjacent cards |
| 6 | Keyboard handling is a window-level handler in `GameScreen`, not on a focusable card | The card is not a control and the player's hands are not on it. A focus-dependent handler would be dead most of the time |
| 7 | Space is ignored when focus is on a button, an input, or a contenteditable element | Otherwise one Space both activates Play/Pause and flips the card, and plan 3's landing input would lose its spaces to the flip handler |
| 8 | Auto-repeat key events are ignored | Leaning on → would otherwise deal the entire deck with no way back |
| 9 | Drag itself is verified on real devices, not in tests, and that is stated in the plan | An honest gap beats a test that passes without exercising the code path. `plan.md` already treats real-device verification as a Phase 5 deliverable |
| 10 | `prefers-reduced-motion` is left to Phase 7 | It is on Phase 7's a11y checklist. Motion has first-class support for it, so this is a deferral, not a debt |
| 11 | Threshold constants are named, documented, and expected to change during step 6 | They are guesses until a thumb touches glass; naming them is what makes them tunable by someone who did not write them |

---

## Open Questions

- [ ] What are the right threshold values? Starting points only until step 6 — expect the tap radius
      and the vertical tolerance to be the two that need real-device tuning.
- [ ] Should a committed swipe animate out in the swipe's direction, or always the same way? Directional
      is more natural but means the exit animation depends on gesture state that the stack does not
      currently receive.
- [ ] Does the card need `user-select: none` and long-press suppression on iOS, or does
      `touch-action: none` cover it in practice? Answer in step 6 rather than pre-emptively.
- [ ] Should ← do anything? It has no meaning today (no previous card), but a player will press it.
      Ignoring it silently is the safe default; a brief "no going back" hint is a Phase 7 call.
- [ ] Is 2 backs right, or 3? `plan.md` says "2–3 cards peeking". Pick by eye during step 6.

---

## Out of Scope

- Everything in plan 1 (the card, QR, audio, the test environment) and everything in plan 3 (landing,
  playlist client, notices, HUD, end screen, the container).
- A "previous card" gesture or any undo. The deck is one-directional by design; adding history would
  change Phase 3's reducer, which this task does not touch.
- `prefers-reduced-motion`, focus-visible styling, responsive breakpoints, and the Lighthouse pass —
  Phase 7.
- Playwright or any end-to-end automation. `plan.md` lists it as optional, and the gap it would close
  here is real-device touch behaviour, which a headless browser does not model either.
- Card art direction and the neon-ring aesthetic — Phase 8.
