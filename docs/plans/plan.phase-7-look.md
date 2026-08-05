<!-- Plans for Phase 7 (in order):
  1. plan.phase-7-look.md         — @theme tokens, responsive layout, prefers-reduced-motion, focus/ARIA  ← this file
  2. plan.phase-7-robustness.md   — empty/error/offline states, bundle splitting, Lighthouse, README + docs
-->

# Plan: Phase 7 (first half) — Look, Layout and Access

> **Phase:** 7 — Polish (`plan.md` §5)
> **Date:** 2026-08-05
> **Author:** Aleix Rabassa
> **Covers:** the "Responsive: phone, tablet, desktop" and "Basic a11y" checkboxes of `plan.md` §5, plus the `@theme` token work that AGENTS.md, `src/index.css` and `Card.tsx` all defer to Phase 7 by name.

---

## Overview

Phase 6 left the app playable end to end and visually provisional. Every colour, dimension and duration is an inline Tailwind utility; the card is a fixed `h-[28rem] w-72` written out **twice**, in `Card.tsx` and `CardStack.tsx`, where the two must agree or the peeking backs misalign; there is not a single responsive variant anywhere in `src/`; and four separate animation surfaces run regardless of whether the player has asked their OS to reduce motion.

This plan does three things and deliberately not a fourth. It **names** the values that already exist as `@theme` tokens, changing nothing by eye. It makes the card and every screen's content column **fluid** off those tokens, so one clamp covers phone through desktop with no breakpoints to keep matched. And it closes the concrete accessibility gaps that a reading of the current components turns up — a card whose reveal is announced to nobody, an input whose `aria-label` overrides its own visible label, an error message not associated with the field it describes, focus rings left entirely to the browser on a near-black background, and placeholder text at a contrast ratio that fails outright.

The fourth thing — actually redesigning the card — is Phase 8's "card visual design" item and stays there. The test of this plan is that a screenshot before and after is close to indistinguishable, while the values behind it have moved into one block and the app now responds to the viewport, the keyboard and the reduced-motion preference.

---

## Dependency Contract

### Requires from earlier phases

Nothing outstanding. Phases 3–6 are complete and this plan touches only presentation.

### Produces for downstream plans

| Output                                                                       | Consumed by                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The `@theme` block in `src/index.css`                                        | `plan.phase-8` card visual design — it redesigns by changing token values, not by hunting utilities across nine components      |
| Focus, contrast and ARIA fixes across every screen                           | `plan.phase-7-robustness.md` step "Lighthouse pass" — the Accessibility score is measured **after** this plan, not before       |
| A card sized from a token rather than from two hardcoded utility pairs        | `plan.phase-8` and any future layout work                                                                                       |

---

## Scope & Affected Areas

| Area                                    | Type     | Notes                                                                                                        |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `src/index.css`                         | Modified | The `@theme` block, and the global `prefers-reduced-motion` block. Grows from 24 lines to the app's one design surface |
| `src/main.tsx`                          | Modified | Wraps `<App />` in Motion's `MotionConfig` with reduced motion following the user preference                  |
| `src/components/Card.tsx`               | Modified | Card dimensions from tokens; flip duration from a token                                                       |
| `src/components/CardStack.tsx`          | Modified | The same dimension tokens — this is the duplication being removed                                             |
| `src/components/CardHiddenSide.tsx`     | Modified | QR display size decoupled from QR generation size (see decision 4)                                           |
| `src/components/QrCode.tsx`             | Modified | Accepts a display size independent of the generated bitmap size                                              |
| `src/components/CardRevealSide.tsx`     | Modified | The reveal becomes an announced region; year type scale from tokens                                           |
| `src/components/CardControls.tsx`       | Modified | Touch-target minimum, focus-visible ring, disabled-state contrast                                            |
| `src/components/LandingScreen.tsx`      | Modified | Label/`aria-label` conflict, `aria-describedby` on the error, focus rings, fluid content column               |
| `src/components/PreparingScreen.tsx`    | Modified | Spinner respects reduced motion by being absent, not by being still                                          |
| `src/components/EndScreen.tsx`          | Modified | Focus rings, fluid content column                                                                            |
| `src/components/Hud.tsx`                | Modified | Fluid content column, matched to the card's width                                                            |
| `src/components/NoticeBanner.tsx`       | Modified | Dismiss-button focus ring and touch target                                                                   |
| `src/components/*.test.tsx`             | Modified | Assertions that currently name `w-72` or a literal size; new a11y assertions                                 |
| `src/index.css.test.ts`                 | New      | The reduced-motion canary (decision 6) — a `node` test, no DOM                                               |
| `docs/architecture.md`                  | Modified | §3 gains the token layer and the reduced-motion strategy                                                     |
| `docs/toolchain.md`                     | Modified | §Tailwind — `@theme` exists now, and the "no `tailwind.config.js`" note needs the token block beside it       |
| `docs/development.md`                   | Modified | §5 gains the manual checks this plan cannot close locally                                                    |
| `docs/agent_findings.md`                | Modified | The contrast measurements and the jsdom/`matchMedia` finding                                                 |
| `docs/plans/plan.md`                    | Modified | §5 Phase 7 checkboxes for responsive and a11y                                                                |
| `AGENTS.md`                             | Modified | The "`@theme` tokens are Phase 7" rule becomes a statement of where tokens live                               |

---

## Chosen Approach

**Fluid tokens over breakpoints, and declarative reduced motion over per-component branching** — both chosen because they put the decision in one place that cannot drift.

For sizing: a single `@theme` token pair for the card, expressed with `clamp()` against viewport units, consumed by both `Card.tsx` and `CardStack.tsx`. Breakpoint variants were the alternative and were rejected for a specific reason rather than a stylistic one: they would have to be written out in both files and kept identical, which is the exact duplication that already exists and is the one thing here that can silently break the stack's alignment. Container queries were rejected because the stack has no constraining parent today, so they would require inventing a layout wrapper for no other purpose.

For motion: one `@media (prefers-reduced-motion: reduce)` block in `src/index.css` covering the three CSS animations (the card flip's `transition-transform`, the preparing spinner's `animate-spin`, the QR placeholder's `animate-pulse`), plus `MotionConfig` with `reducedMotion="user"` in `main.tsx` for the drag and the 600px directional exit. Two declarations for four surfaces, and no presentational component gains a media query — which matters because the alternative, reading `useReducedMotion()` in three components, silently misses whatever animation the next phase adds.

---

## Implementation Steps

- [x] **1. Inventory the values before naming any of them.** Grep `src/components/` and `src/index.css` for every colour utility (`neutral-*`, `emerald-*`, `amber-*`, `red-*`), every arbitrary dimension (`h-[28rem]`, `w-72`, `max-w-sm`, `max-w-xs`, `size-8`), every duration (`duration-500`) and the two JS-side pixel constants (`DEFAULT_QR_SIZE` in `CardHiddenSide.tsx`, `EXIT_DISTANCE_PX` in `Card.tsx`, `BACK_OFFSET_PX` and `BACK_SCALE_STEP` in `CardStack.tsx`). Write the list into the plan's own notes as the checklist for step 2, so "extract existing values only" can be verified as complete rather than assumed. → **[Execution note 1](#1-the-inventory-step-1)**
  - [x] Note which values appear more than once — those are the ones a token actually protects. The card dimensions are the known case; check whether `max-w-sm` on five screens is genuinely one concept or two. → **Two concepts.** See [Execution note 2](#2-max-w-sm-is-two-concepts-not-one-step-1).
- [ ] **2. Add the `@theme` block to `src/index.css`.** Name only values that already exist, and change no rendered value in this step. Tokens to define, grouped:
  - [ ] **Card geometry** — the card's width and height. Sized with `clamp()`: a floor that fits a 320px-wide phone with the control bar and HUD still on screen, a fluid middle in viewport units, and a ceiling near today's `18rem × 28rem` so a desktop card does not become a billboard. The aspect ratio the current pair implies (`288 × 448`, roughly 9:14) is the thing to preserve while both ends move.
  - [ ] **Content column** — one token replacing `max-w-sm` across `LandingScreen`, `EndScreen`, `Hud`, `NoticeBanner` and `PreparingScreen`, so the HUD and the notice line up with the card at every viewport instead of at one.
  - [ ] **Surface and text colours** — the neutral ramp actually in use (`950` page, `900`/`800` card faces and controls, `100`/`400`/`500` text), plus the three accents (`emerald` for the primary action, `amber` for notices and unconfirmed years, `red` for errors). Named by role, not by hue, because Phase 8 will change the hue and must not have to rename anything.
  - [ ] **Motion durations** — the flip's 500ms and the card exit's 250ms, so the reduced-motion block in step 4 and Phase 8 have one place to reach for.
  - [ ] **Interaction minimums** — a touch-target minimum and a focus-ring width, both consumed in step 6.
- [ ] **3. Switch the card to the geometry tokens, removing the duplication.** Replace the `h-[28rem] w-72` pair in `Card.tsx` (the `motion.div`) and the identical pair in `CardStack.tsx` (the `relative isolate` wrapper) with the token-backed utilities. This is the step that fixes a latent bug: the two literals are required to match and nothing enforces it.
  - [ ] Verify the backs still align by eye at three widths — the backs are `absolute inset-0` on the stack wrapper, so they follow the wrapper automatically once the wrapper is fluid.
  - [ ] Re-check `BACK_OFFSET_PX` (10px) and `BACK_SCALE_STEP` (0.04) against the smallest card: a fixed 10px offset is a larger proportion of a 240px-tall card than of a 448px one. Decide whether either becomes relative; record the decision either way, because `CardStack`'s header block documents these as chosen by eye.
- [ ] **4. Add the global reduced-motion block to `src/index.css`.** One `@media (prefers-reduced-motion: reduce)` block, scoped to the three surfaces rather than a blanket `* { transition: none }`, because a blanket rule is indiscriminate and would also disable state changes that carry meaning.
  - [ ] The **flip**: collapse its transition duration so the face changes instantly. The flip is a state toggle, not decoration — the reveal must still happen, just not travel.
  - [ ] The **spinner** in `PreparingScreen`: do not merely stop it. A stationary spinner is a dead grey circle that reads as broken. Hide it — it is already `aria-hidden="true"`, and the screen's "Dealing your deck…" line plus the resolved/total count carry all of the information, so nothing is lost. Update that component's header comment, which currently states outright that reduced motion is Phase 7's job and not handled there.
  - [ ] The **QR placeholder pulse** in `QrCode.tsx`: drop the pulse, keep the same-size grey box. The box exists to hold layout, and it keeps doing that.
- [ ] **5. Wrap the app in `MotionConfig` with `reducedMotion="user"`** in `src/main.tsx`, inside `StrictMode` and around `<App />`. This covers what CSS cannot: Motion's `drag` and the directional `exit` in `Card.tsx`. With the preference set, Motion animates opacity instead of transforms, so a committed card fades rather than flying 600px — and the **drag itself keeps working**, because direct manipulation is not an animation.
  - [ ] Confirm jsdom's `window.matchMedia` satisfies Motion. jsdom does implement it; whether Motion's listener registration is happy with jsdom's implementation is the thing to check, not assume. If a stub turns out to be needed, it goes in the individual jsdom test files that render `main.tsx`'s tree — **not** in a global `setupFiles`, which `toolchain.md` §5 records as deliberately absent.
  - [ ] Record the outcome in `agent_findings.md` either way. "It worked without a stub" is exactly the kind of thing the next session would otherwise re-derive.
- [ ] **6. Focus states across every interactive element.** There are eleven: the URL input, the Start button, five suggested-playlist buttons, Exit, Play/Pause, Restart, and the notice's Dismiss. None has an explicit focus style today, so all eleven fall back to the browser default over a `neutral-950` background.
  - [ ] Use `focus-visible`, not `focus`, so a mouse click does not leave a ring behind. The suggested-playlist buttons are the case that makes this visible.
  - [ ] The ring must be legible against both `neutral-950` (the page) and `neutral-900`/`neutral-800` (the card faces and control buttons) — a single ring colour has to clear all three, so pick against the lightest.
  - [ ] Apply the touch-target minimum token to the three round `CardControls` buttons and to the Dismiss button. `px-4 py-2` around a single glyph is roughly 40px tall and narrower than that wide; Dismiss is `px-1` around an `✕` and is the smallest target in the app, on the surface a player is most likely to hit while swiping.
- [ ] **7. Fix the two ARIA defects on the landing screen.**
  - [ ] The input carries both a visible label (the `Playlist link` span inside the wrapping `<label>`) **and** `aria-label="Spotify playlist link"`. The `aria-label` wins, so the accessible name does not match the visible text — which breaks speech control ("click Playlist link" matches nothing) and is a WCAG 2.5.3 failure. Remove the `aria-label`; the wrapping label already provides the name.
  - [ ] `aria-invalid` is set on the input when there is an error, but the `<p role="alert">` carrying the message is not associated with it. Give the message an id and point `aria-describedby` at it while it exists, so the reason is available on focus and not only at the moment it is announced.
- [ ] **8. Make the reveal announce itself.** Today a keyboard or screen-reader player presses Space, `CardRevealSide` mounts, and nothing announces it — the flip is silent to assistive technology, so the payoff of the entire game is invisible to it. Give the reveal's content a polite live region so mounting announces the title, artist and year.
  - [ ] Polite, not assertive: the reveal is expected and requested, not an interruption.
  - [ ] This is the one place in the app where announcing track data is **correct**, and the reasoning must be written into the component's header beside the existing leak block, or the next reader will file it as the leak bug it superficially resembles. The face is mounted only while flipped (`Card.tsx`), so the live region cannot exist on an unflipped card.
  - [ ] Do **not** add a live region to `CardHiddenSide`, to `CardStack`'s backs, or to the HUD beyond the `role="status"` already on the count.
- [ ] **9. Audit and fix text contrast, with measured ratios.** Compute each pair rather than eyeballing it, and record the numbers in `agent_findings.md` so a Phase 8 palette change has a baseline to beat.
  - [ ] `placeholder:text-neutral-600` on `bg-neutral-900` in the URL input — the known failure, well under 4.5:1. Placeholder text is content.
  - [ ] `text-neutral-500` on `bg-neutral-950`, used for the HUD, the "Same tracks, new order" line, the "No preview available" note and the preparing screen's explanatory line. Borderline at normal size and used at `text-xs` in three of those four places, where the large-text allowance does not apply.
  - [ ] `disabled:opacity-40` on Play/Pause and Restart — a disabled control still has to be readable, and 40% of `neutral-100` on `neutral-800` is the app's dimmest text.
  - [ ] `text-amber-200` on the notice banner's `bg-amber-950/40`, and `text-amber-300` for the unconfirmed-year and "check this one yourself" markers on `bg-neutral-800`.
  - [ ] Fix by moving the token, not by patching the utility at one call site — that is what step 2 made possible.
- [ ] **10. Make every screen's content column fluid**, replacing `max-w-sm`/`max-w-xs` with the step-2 content token. Check the three cases where a fixed column is currently visible as a defect: the HUD and notice banner not matching the card's width on a wide screen, the landing screen's suggested-playlist list at 320px, and `Hud`'s `truncate` on a long user-created playlist name.
- [ ] **11. Update the component tests that name the values that just moved**, then add the new assertions. Any test asserting `w-72`, `h-[28rem]` or a literal `176` will fail; that is the token change working, not a regression.
- [ ] **12. Verify the visual diff is a non-diff.** Before and after screenshots of all five screens at one width, compared by eye. Steps 2 and 3 were scoped as "extract existing values only"; any visible change is either an accident or a decision that belongs in Phase 8, and both need to be caught here.
- [ ] **13. Run the four checks** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — and confirm the CSS bundle's growth is proportionate. A `@theme` block adds custom properties to the output; `15.23 kB` (4.00 kB gzip) is the pre-change baseline measured 2026-08-05.

---

## Unit Tests

All new DOM tests need the `/** @vitest-environment jsdom */` docblock as the first thing in the file and their own `afterEach(cleanup)` — Testing Library does not auto-clean in this repo (`toolchain.md` §5).

- [ ] `should render the card at the token-backed size rather than a literal` — covers step 3 in `src/components/Card.test.tsx`. Asserts the token utility is present; a card sized by a hardcoded pair is the regression.
- [ ] `should size the stack wrapper from the same token as the card` — covers the duplication removal in `src/components/CardStack.test.tsx`. The point of the test is that the two cannot drift; assert the same class string in both.
- [ ] `should keep the back offsets proportional at the smallest card size` — covers step 3's sub-decision in `CardStack.test.tsx`, only if step 3 makes the offsets relative. Skip if the decision is to leave them fixed, and say so in the plan's notes.
- [ ] `should expose the input's accessible name as its visible label` — covers step 7 in `src/components/LandingScreen.test.tsx`. Query by the visible label text; the current `aria-label` makes that query fail, which is the defect.
- [ ] `should associate the error message with the input via aria-describedby` — covers step 7 in `LandingScreen.test.tsx`. Assert both that the id link exists while an error shows and that it is absent when there is none.
- [ ] `should announce the reveal politely when the card is flipped` — covers step 8 in `src/components/CardRevealSide.test.tsx`. Assert the live region wraps the title, artist and year.
- [ ] `should not put a live region on the hidden side` — covers step 8's negative half in `src/components/CardHiddenSide.test.tsx`. Joins the existing leak assertions: a live region on an unflipped card would announce a card the player is meant to guess.
- [ ] `should give every interactive element a focus-visible style` — covers step 6, one test each in `LandingScreen.test.tsx`, `CardControls.test.tsx`, `NoticeBanner.test.tsx` and `EndScreen.test.tsx`. Asserting a class name is a weak test; it is the only automatable guard, and it catches the common regression of a new button added without one.
- [ ] `should meet the touch-target minimum on the three card controls and Dismiss` — covers step 6 in `CardControls.test.tsx` and `NoticeBanner.test.tsx`. Class-name level, same caveat.
- [ ] `should hide the spinner rather than freeze it under reduced motion` — covers step 4 in `src/components/PreparingScreen.test.tsx`, only if the mechanism ends up being a class the component renders. If it is pure CSS, this belongs in the canary below instead, because jsdom does not evaluate media queries — say which in the notes rather than writing a test that asserts nothing.
- [ ] `should still render the count and the status line under reduced motion` — covers step 4's information-preservation claim in `PreparingScreen.test.tsx`. The spinner going away must not take the progress report with it.
- [ ] `should declare a prefers-reduced-motion block covering the flip, the spinner and the placeholder` — covers step 4 in a new `src/index.css.test.ts`, a **`node`** test that reads the stylesheet as text. This is a canary, not a behaviour test, and the file header must say so: jsdom cannot evaluate a media query, so the only thing assertable in this repo is that the block exists and names the three surfaces. It is here because the alternative is that reduced motion is covered by nothing at all.
- [ ] `should render the QR at the display size while generating at the fixed bitmap size` — covers decision 4 in `src/components/QrCode.test.tsx`. Assert the generation call receives the bitmap size and the rendered element carries the display size, since conflating the two is what would make the code regenerate on every resize.
- [ ] Update `src/App.test.tsx` if `MotionConfig` changes what the container renders. It drives the whole flow and is the first place a `matchMedia` problem from step 5 will surface.

---

## Documentation Updates

- [ ] `docs/architecture.md` §3 — a subsection for the token layer: what `@theme` holds, that components consume tokens rather than literals, and that Phase 8 redesigns by changing token values. Plus the reduced-motion strategy and why it is split across CSS and `MotionConfig`.
- [ ] `docs/toolchain.md` — the Tailwind section says v4 is CSS-first with no `tailwind.config.js`; add that the design surface is the `@theme` block in `src/index.css` and that this is where a v3 reader would expect a config file.
- [ ] `docs/development.md` §5 — a manual-verification table for what this plan cannot close locally: the reduced-motion pass with the OS preference set (and via the devtools emulation), the three-width responsive pass, a keyboard-only pass through a whole deck, and a screen-reader pass over the flip. Mark each Pending, in the same shape as the existing card and gesture tables.
- [ ] `docs/development.md` §8 — a known limitation if the screen-reader pass is not performed. The repo already carries two honest gaps of this shape; a third is better than an implied claim.
- [ ] `docs/agent_findings.md` — dated entries for: the measured contrast ratios from step 9, the `aria-label`-overriding-the-visible-label defect (a general React/a11y trap, not a one-off), the silent-flip finding from step 8, and whether jsdom needed a `matchMedia` stub for `MotionConfig`. Tell the developer these were added.
- [ ] `docs/plans/plan.md` §5 — tick the responsive and a11y checkboxes, and add a completion note in the style of Phases 3–6, including anything deferred.
- [ ] `AGENTS.md` — the Conventions bullet reading "`@theme` tokens are Phase 7" becomes a statement of where tokens live and the rule that a new component consumes them rather than inventing literals. Update the current-phase line.
- [ ] Component header comments that name Phase 7 by name and must not be left stale: `src/index.css` (the "deliberately deferred to Phase 7" note), `PreparingScreen.tsx` (the spinner block), `Card.tsx` (the "`@theme` tokens, which are Phase 7's job" note), `QrCode.tsx` (the lazy-load note — that one is plan 2's, so leave it), `CardStack.tsx` (the QR cost note).

---

## Testing Strategy

- **Unit tests:** the list above. Note honestly what they do and do not cover — a class-name assertion proves a utility is present, not that the rendered result is legible or that the ring is visible. The contrast work in step 9 is verified by calculation, recorded in findings, and not by a test.
- **Integration tests:** `src/App.test.tsx` continues to drive the whole flow and is the guard that `MotionConfig` and the token changes did not break the container. No new integration test is needed; this plan changes no behaviour it does not also change a component test for.
- **Manual verification** — the part no local check reaches:
  - Reduced motion, with the OS preference actually set as well as via devtools emulation. Confirm: the flip is instant, the spinner is gone rather than frozen, the QR placeholder is static, a committed card fades instead of flying, and **the drag still works**. That last one is the regression this step could plausibly introduce.
  - Three widths — 320px, tablet, and a wide desktop — for all five screens. Specifically: the card and its controls both fit at 320px, the HUD and notice line up with the card when wide, and a long playlist name still truncates.
  - A keyboard-only pass: Tab order through the landing screen, Start, then Space to flip and → to advance through several cards, then Exit. Confirm every stop shows a visible ring and that Space on a focused button does not also flip the card — Phase 5 guards that, and this plan changes focus styling around it.
  - A screen-reader pass over one flip, confirming the reveal is announced and an unflipped card announces nothing about its track.
  - The before/after screenshot comparison from step 12.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                                                                                                                                                                                                                                                                                                                                     | Rationale                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Tokens name existing values only. No visual redesign.** Considered: (a) extract only; (b) extract plus a light restyle for contrast and typography; (c) skip `@theme`. **Chose (a)**, developer-confirmed 2026-08-05.                                                                                                                                                                                                                     | Phase 8 owns "card visual design", and a restyle here would overlap it while making the token extraction unreviewable — a diff that changes both structure and appearance cannot be checked for accidental change. Contrast fixes (step 9) are the one exception, and they are corrections rather than design.                                  |
| 2   | **Fluid `clamp()` tokens, not breakpoint variants.** Considered: (a) one fluid token pair; (b) `sm:`/`lg:` variants; (c) container queries. **Chose (a)**, developer-confirmed 2026-08-05.                                                                                                                                                                                                                                                 | The card's size is written twice and the two must agree; breakpoints would multiply that from two literals to six. Container queries would need a constraining wrapper invented for no other reason. A clamp also covers the sizes between the breakpoints anyone would have picked.                                                            |
| 3   | **Reduced motion via one global CSS block plus `MotionConfig`, not `useReducedMotion()` per component.** Considered: (a) CSS + `MotionConfig`; (b) the hook in three components; (c) CSS only. **Chose (a)**, developer-confirmed 2026-08-05.                                                                                                                                                                                               | Four animation surfaces, two declarations, and no presentational component gains a media query. (b) puts a preference read into three components and silently misses the next animation added. (c) leaves the largest motion in the app — the 600px card exit — fully animated.                                                                 |
| 4   | **The QR's generated bitmap size stays fixed while its displayed size becomes fluid.** `QrCode` currently takes one `size` used as both.                                                                                                                                                                                                                                                                                                   | `toDataURL` is asynchronous, so a size that tracks the viewport would regenerate the code on every resize frame — needing a debounce, extra state, and a placeholder flash mid-resize. Generating once at a size adequate for the largest card and letting CSS scale it down costs nothing: downscaling a QR does not harm scannability, and error correction is already `M`. This keeps the existing generation-counter logic untouched. |
| 5   | **The reveal gets a live region; nothing else does.** The card face, the backs and the hidden side stay silent.                                                                                                                                                                                                                                                                                                                            | Announcing track data is correct exactly once — after a flip the player asked for. The reveal side is mounted only while flipped, so the region cannot exist on a card that is still a mystery. Anywhere else it would be the leak the whole app is built to avoid.                                                                             |
| 6   | **A `node` test asserts the reduced-motion CSS block exists, as a canary.**                                                                                                                                                                                                                                                                                                                                                               | jsdom does not evaluate media queries, so there is no behavioural test available. The choice is between a text-level canary and no coverage at all. It is labelled as a canary in its own header so nobody mistakes it for proof the styles work.                                                                                               |
| 7   | **The spinner is hidden under reduced motion, not stopped.**                                                                                                                                                                                                                                                                                                                                                                              | A stationary spinner reads as a hung app. It is already `aria-hidden`, and the screen's status line and resolved/total count carry every piece of information it conveys, so removing it loses nothing.                                                                                                                                        |
| 8   | **Fixing the `aria-label` on the landing input changes an accessible name that a test may assert.** Treated as a defect fix, not a breaking change.                                                                                                                                                                                                                                                                                        | An accessible name that does not match the visible label fails WCAG 2.5.3 and breaks speech control. The wrapping `<label>` already supplies a correct name, so the attribute is redundant as well as harmful.                                                                                                                                 |
| 9   | **No `select-none` on the card unless the iOS check happens.** Left as `development.md` §5 records it.                                                                                                                                                                                                                                                                                                                                     | It is listed there as an open question pending a real-device pass that was waived. Adding it blind would close a question nobody measured; it costs one utility to add later if a device shows text selection or a long-press menu on the card.                                                                                                 |

---

## Open Questions

- [ ] **Does `MotionConfig` need a `matchMedia` stub under jsdom?** Resolved in step 5 by running the suite, not by reading. It determines whether up to fourteen jsdom files need a change, so it is the first thing to find out and the reason step 5 sits before the test work.
- [ ] **Do `BACK_OFFSET_PX` and `BACK_SCALE_STEP` become relative once the card is fluid?** A fixed 10px offset is a much larger proportion of a small card. `CardStack`'s header documents both as chosen by eye, and neither has ever been seen on a phone — the same gap `development.md` §5 records for the gesture thresholds.
- [ ] **Is `VISIBLE_BACKS = 2` or 3 right?** Carried over from Phase 5's waived device pass and unanswerable locally. Out of scope to change; noted because it lives in the file this plan edits, and `CardStack.test.tsx` asserts "up to two backs", so changing it means changing two test expectations.
- [ ] **Does the card's aspect ratio survive a short, wide viewport** — a phone in landscape? A clamp on width alone can produce a card taller than the viewport. Decide during step 3 whether the height clamp also needs a `dvh` term, and record which.

---

## Out of Scope

- **Card visual design** — the neon-ring aesthetic, new typography, any change to how the app looks. Phase 8, `plan.md` §5. This plan's success condition is that it changes nothing visible except the contrast fixes.
- **Empty, error and offline states, the error boundary, lazy-loading, the Lighthouse pass, and the README** — all in [`plan.phase-7-robustness.md`](plan.phase-7-robustness.md).
- **"Added by" attribution** — plan 2 re-spikes the data availability and relocates it; no UI is built for it in either plan.
- **A dark/light theme toggle.** The app is dark-only and nothing has asked for a light mode. Tokens make it possible later without being an argument for doing it now.
- **A component library or a CSS reset beyond Tailwind's preflight.**
- **Retuning the five gesture thresholds in `src/game/gestures.ts`.** They need a thumb, not a token. `development.md` §8 records the gap.
- **PWA, offline caching, service workers.** Phase 8.

---

## Execution Notes

Written during execution, 2026-08-05. Everything the plan asked to be "recorded either way" is here.

### 1. The inventory (step 1)

Every value in `src/` that step 2 had to name, and how many places it appeared in. Counts are call
sites, not files.

**Surfaces and borders**

| Value                    | Uses | Where                                                                       |
| ------------------------ | ---: | --------------------------------------------------------------------------- |
| `bg-neutral-950`         |    4 | `LandingScreen`, `PreparingScreen`, `EndScreen`, `GameScreen` — the page     |
| `bg-neutral-900`         |    4 | card hidden face, card back, the URL input, the suggestion buttons          |
| `bg-neutral-800`         |    3 | card reveal face, the three control buttons, the QR placeholder             |
| `hover:bg-neutral-700`   |    3 | the three control buttons                                                   |
| `border-neutral-800`     |    2 | card back, suggestion button                                                |
| `border-neutral-700`     |    3 | the URL input, the New-playlist button, the spinner ring                     |
| `hover:border-neutral-700` | 1  | suggestion button                                                           |
| `hover:border-neutral-600` | 1  | New-playlist button                                                         |

**Text**

| Value               | Uses | Where                                                                                                            |
| ------------------- | ---: | ---------------------------------------------------------------------------------------------------------------- |
| `text-neutral-100`  |    4 | three screens' page text, the control glyphs                                                                     |
| `text-neutral-50`   |    1 | the resolved year                                                                                                |
| `text-neutral-300`  |    1 | "Year unknown"                                                                                                   |
| `text-neutral-200`  |    1 | the New-playlist label                                                                                           |
| `text-neutral-400`  |    6 | landing blurb ×2, the artist, "Still looking up the year…", the preparing count, the end-screen subtitle          |
| `text-neutral-500`  |    6 | "Scan to play the full song", "No preview available", the HUD, "Same tracks, new order", a suggestion blurb, the preparing explanation |
| `text-neutral-600`  |    2 | the `····` pending dots, `placeholder:` in the URL input                                                          |
| `text-white`        |    2 | Start, Play again                                                                                                |

**Accents**

| Value                                       | Uses | Where                                    |
| ------------------------------------------- | ---: | ---------------------------------------- |
| `bg-emerald-600` + `hover:bg-emerald-500`   |    2 | Start, Play again                        |
| `border-t-emerald-500`                      |    1 | the spinner's leading arc                |
| `text-amber-300`                            |    2 | "Unconfirmed year", "Check this one yourself" |
| `text-amber-200` / `bg-amber-950/40` / `border-amber-900/60` / `text-amber-400` | 1 each | the notice banner |
| `text-red-400`                              |    1 | the landing error message                |

**Dimensions, durations and JS constants**

| Value                     | Uses | Where                                                            |
| ------------------------- | ---: | ---------------------------------------------------------------- |
| `h-[28rem] w-72`          |    2 | `Card.tsx` and `CardStack.tsx` — **the duplication step 3 removes** |
| `max-w-sm` (24rem)        |    6 | `LandingScreen` ×3, `EndScreen`, `Hud`, `NoticeBanner`            |
| `max-w-xs` (20rem)        |    1 | the preparing explanation                                        |
| `size-8`                  |    1 | the spinner                                                      |
| `duration-500`            |    1 | the flip                                                         |
| `disabled:opacity-40`     |    2 | Play/Pause, Restart                                              |
| `disabled:opacity-50`     |    3 | the URL input, Start, the suggestion buttons                     |
| `DEFAULT_QR_SIZE = 176`   |    1 | `CardHiddenSide`                                                 |
| `EXIT_DISTANCE_PX = 600`  |    1 | `Card`                                                           |
| exit `duration: 0.25`     |    1 | `Card`                                                           |
| `BACK_OFFSET_PX = 10`     |    1 | `CardStack`                                                      |
| `BACK_SCALE_STEP = 0.04`  |    1 | `CardStack`                                                      |
| `VISIBLE_BACKS = 2`       |    1 | `CardStack` — out of scope, open question 3                      |

The values a token genuinely protects are the ones above 1: the card pair, `max-w-sm`, the four
neutral surface shades, `text-neutral-400`/`500`, the emerald pair, and `text-amber-300`.

### 2. `max-w-sm` is two concepts, not one (step 1)

Step 2 proposed one content-column token for all five screens, and step 1 asked whether that is
right. It is not — the same utility is doing two different jobs:

1. **A content column.** `LandingScreen`'s blurb, form and suggestion list, `EndScreen`'s button
   column, `PreparingScreen`'s explanation. These are reading-measure constraints and have no
   relationship to the card.
2. **Matching the card.** `Hud` and `NoticeBanner` sit directly above the card and are supposed to
   line up with it. `max-w-sm` is 24rem; the card is `w-72` = 18rem. **They have never lined up** at
   any viewport wide enough for either to reach its cap — which is the defect step 10 names.

So there are two tokens: `--container-content` (24rem ceiling, today's value, for group 1) and the
card-width token reused for group 2. Group 2 is the one visible change outside the contrast fixes,
and step 10 asks for it explicitly.
