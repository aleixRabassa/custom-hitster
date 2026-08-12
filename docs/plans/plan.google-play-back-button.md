<!-- Plans for google-play (in order):
  1. plan.google-play-shell.md       — packaging the PWA as a Trusted Web Activity and getting it through Play to production
  2. plan.google-play-back-button.md — making Android's back gesture an in-app control instead of an app exit  ← this file
-->

# Plan: google-play — Android back button as an in-app control

> **Task:** `google-play`
> **Date:** 2026-08-11
> **Author:** Aleix Rabassa
> **Depends on:** [plan.google-play-shell.md](plan.google-play-shell.md) — **for verification only.** The code and its tests are independently implementable; the behaviour cannot be observed without an installed TWA, because a browser has its own back affordance and its own history stack.

---

## Overview

`App.tsx` never touches the address bar — no `pushState`, no `replaceState` — which is a recorded
decision and correct for the web. Inside a Trusted Web Activity it has a consequence that is not:
there is **no history entry to go back to**, so Android's back gesture closes the activity outright.
Mid-game that means a reflexive edge swipe ends the game, bypassing `ExitConfirmDialog` entirely —
and worse, it bypasses it _invisibly_, because the session survives in `localStorage` and a relaunch
resumes, so the player experiences it as the app randomly quitting rather than as a lost game.

The fix is to give the game screen one history entry to consume, and to interpret a back press as
the in-app action the player almost certainly meant: close the open dialog if one is open, otherwise
request an exit through the same confirmation the Exit button already goes through.

Two things this deliberately does **not** do. It does not intercept back on the landing, preparing or
end screens — there, closing the app is the correct behaviour and Android should be left alone. And
it does not make back a silent exit: back becomes a _request_, exactly like the Exit button, so the
irreversible act still needs a confirmation.

---

## Dependency Contract

### Requires from plan.google-play-shell

| Output                                | Description                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An installed, asset-link-verified TWA | The only environment where the behaviour is real. In Chrome the browser supplies its own back button and its own entries, so a browser test observes a different system. |
| The application id                    | Only for the device-install instructions in the manual checks below.                                                                                                     |

### Produces for downstream plans

| Output          | Consumed by |
| --------------- | ----------- |
| (no downstream) | —           |

**Recommended landing window:** inside plan 1's fourteen-day closed test, so the testers already
recruited exercise the fix and the calendar time is spent once rather than twice.

---

## Scope & Affected Areas

| Area                                          | Type      | Notes                                                                                                                      |
| --------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/game/back-navigation.ts`                 | New       | The decision: what a back press means given the screen's dialog state. Pure, framework-free, no DOM.                       |
| `src/game/back-navigation.test.ts`            | New       | Node test over the decision. Total coverage of the state space is cheap here because the state space is tiny.              |
| `src/hooks/useBackNavigation.ts`              | New       | The binding: pushes one history entry on mount, listens for `popstate`, removes both on cleanup. Holds no branching logic. |
| `src/hooks/useBackNavigation.test.ts`         | New       | jsdom test over the binding — the entry count, the cleanup ordering, and the StrictMode double-mount.                      |
| `src/components/GameScreen.tsx`               | Modified  | Calls the hook. It is the only screen that should intercept back, and the only place that already holds both dialog flags. |
| `src/components/GameScreen.test.tsx`          | Modified  | Assert a back press opens the confirmation rather than calling `onExit`.                                                   |
| `src/App.tsx`                                 | Unchanged | Deliberately. See decision 2 — the "App.tsx never touches history" rule stays literally true.                              |
| `AGENTS.md`                                   | Modified  | Amend the history rule so it states what is now true rather than what was.                                                 |
| `docs/architecture.md`, `docs/development.md` | Modified  | See Documentation Updates.                                                                                                 |

---

## Chosen Approach

**A pure decision module in `src/game/` plus a thin binding hook in `src/hooks/`, called from
`GameScreen`.** `back-navigation.ts` maps the screen's dialog state to one of a small set of
actions; `useBackNavigation.ts` owns only the history entry and the `popstate` listener and contains
no branching of its own.

This is the decision/binding split AGENTS.md calls the house style, applied for the same reason it
was applied to `gestures.ts` and `resolver.ts`: the interesting part is a set of small comparisons
that are trivially testable in isolation, while the part that must touch a real API is
environment-dependent and awkward. Chosen over a **single hook** because that puts the branching
inside the thing that is hardest to test — and while jsdom does dispatch `popstate` (unlike a drag,
which Motion reads from geometry jsdom never computes), the precedence question "what if both
dialogs are somehow open" deserves a test that is a function call rather than a simulated event
sequence. Chosen over an **inline effect in `App.tsx`** for a structural reason as well as a testing
one: the dialog flags this decision reads (`isExitConfirmOpen`, `isDeckActionsOpen`) live in
`GameScreen`, so an `App.tsx` implementation would have to lift both — widening the container that
is deliberately the only file knowing all four statuses exist, in order to teach it about two flags
it currently has no reason to know about.

**Mounting the hook in `GameScreen` is itself the scoping mechanism.** The interception's lifetime is
exactly the `playing` status, because that is when the component is mounted. No status check is
needed anywhere, and on every other screen Android keeps its default behaviour by construction
rather than by an exclusion list somebody has to remember to update.

---

## Implementation Steps

- [x] **Step 1 — Write the decision module.** `src/game/back-navigation.ts` exports a function
      taking a description of the screen's dialog state and returning the action a back press should
      produce: close the deck-actions dialog, close the exit confirmation, or request an exit.
  - [x] Make the function **total** and fix the precedence for the case where both flags read open.
        It should not be reachable today — both dialogs open from the same control bar — but a
        function that returns nothing for a state is a crash waiting for a refactor, and choosing the
        precedence deliberately costs one line. _Precedence is DOM order: the deck-actions panel is
        rendered last in `GameScreen`, so with both mounted it is the one painting on top, and back
        dismisses what the player can see._
  - [x] Keep it free of React, of the DOM and of any history API. It takes plain data and returns a
        plain value.
  - [x] Document in the file header _why_ back is a request rather than an exit: ending the game is
        irreversible, which is the whole reason `ExitConfirmDialog` exists, and a hardware gesture is
        pressed more reflexively than a button.

- [x] **Step 2 — Write the binding hook.** `src/hooks/useBackNavigation.ts` takes the dialog state
      and the three callbacks, and does exactly three things: push one history entry on mount, run
      the decision on `popstate`, and undo both on cleanup.
  - [x] Push an entry that **does not change the visible URL** and does not discard the current query
        string. A shared deck link is read from `location.search`, and although `App.tsx` reads it
        only in a lazy initialiser that has long since run, clobbering it would break a reload
        mid-game. _`pushState(state, '')` with no URL argument — measured to keep the href, query and
        fragment in full._
  - [x] **Handle the StrictMode double-mount.** The effect runs twice in development, so a naive
        implementation pushes two entries and back then needs two presses. Note the recorded trap
        here: an "already done" ref is the reflex and it is what broke the deck-link effect, because
        StrictMode's simulated unmount runs cleanup for work the ref still records as done. A
        cleanup that genuinely undoes the push is the shape that survives — verify it does, in the
        hook's own test, rather than reasoning about it. _An undoing cleanup turned out to be
        necessary but not sufficient: the traversal is asynchronous, so the queued back lands on the
        SECOND effect's listener as a phantom press. `pendingCleanupTraversals` — a module-level
        count of traversals this hook itself queued — is what closes it._
  - [x] **Get the cleanup ordering right — this is the central hazard.** Removing a pushed history
        entry means navigating back, which fires `popstate` asynchronously. If the listener is still
        attached when cleanup navigates, the cleanup is read as a back press and the exit
        confirmation opens on a screen that is unmounting. Remove the listener **first**, then undo
        the entry.
  - [x] Decide and document what happens if the entry cannot be cleanly removed. The failure mode to
        avoid is a stray entry surviving the game: back on the landing screen would then do nothing
        visible instead of closing the app, which reads as a frozen back button. _A push that throws
        reports itself: `hasEntry` stays false, the cleanup navigates nowhere and leaves no stray,
        and back degrades to exactly the platform behaviour it has today._
  - [x] **Beyond the plan, and load-bearing: the entry is REPLACED after every press.** One entry
        consumed once would make the interception work only once per game — press back, cancel,
        press back again and the activity closes. The invariant is "exactly one outstanding entry
        for the life of the game", maintained by a synchronous re-push inside the handler.

- [x] **Step 3 — Wire it into `GameScreen`.** Call the hook, passing `isExitConfirmOpen`,
      `isDeckActionsOpen`, and handlers that reuse the existing ones — the exit request must go
      through the same path as the Exit button so the confirmation is shared rather than duplicated.
  - [x] Confirm **guard 4 needs no change.** It gates the window key handler on the two dialog flags
        and this adds no third dialog, so the OR stays as it is. Verify rather than assume, since
        that guard exists because → would otherwise deal a card behind a backdrop. _Verified: back
        either closes one of those two dialogs or opens the exit confirmation, so every state that
        puts a backdrop over the card is still one of the two the OR already reads._
  - [x] Add a note to the component header explaining that the hook's mounting _is_ the scoping, so a
        future reader does not go looking for the status check.

- [x] **Step 4 — Accept and record the browser-side consequence.** This is not TWA-only: it also
      makes the browser's own back button open the exit confirmation during play, on desktop and in
      mobile Chrome. That is arguably an improvement — a mis-swiped back currently loses the game
      there too — but it is a behaviour change for existing web players and must be a decision rather
      than a side effect. _Accepted. Recorded in `useBackNavigation.ts`'s header, which also states
      the two things not to add later: a user-agent sniff and a `display-mode: standalone` check._

- [ ] **Step 5 — Verify on the device.** Requires plan 1's installed build.
  - [ ] Start a game, press back → the confirmation appears, the deck is intact, cancelling returns
        to the same card.
  - [ ] Open the deck-actions dialog, press back → the dialog closes and the game is untouched.
  - [ ] Open the exit confirmation, press back → it closes without exiting.
  - [ ] Confirm back is **not** intercepted on the landing, preparing and end screens — one press
        closes the app.
  - [ ] Exit a game properly through the dialog, land on the landing screen, press back once → the
        app closes. A second press being needed means step 2's cleanup left an entry behind.
  - [ ] Test the **edge-swipe gesture** as well as the on-screen button; they are the same event but
        the animation differs.
  - [ ] Confirm the Android 13+ predictive-back animation does not show the app peeling away while
        the web app is in fact handling the press — see Open Questions.

---

## Unit Tests

- [x] `should request an exit when no dialog is open` — covers the decision in
      `src/game/back-navigation.test.ts`. The core case: back during play must produce a _request_,
      never a direct exit.
- [x] `should close the deck-actions dialog when it is open` — covers the decision in
      `src/game/back-navigation.test.ts`.
- [x] `should close the exit confirmation when it is open` — covers the decision in
      `src/game/back-navigation.test.ts`. Back inside the confirmation must dismiss it, not confirm
      it; a back press that answered "yes" to a confirmation would be strictly worse than no
      interception at all.
- [x] `should resolve a defined action for every state combination` — covers totality and the chosen
      precedence in `src/game/back-navigation.test.ts`.
- [x] `should push exactly one history entry on mount` — covers the binding in
      `src/hooks/useBackNavigation.test.ts`, including under a StrictMode double-mount. _Asserted as
      a NET — pushes minus traversals — because StrictMode legitimately pushes twice and traverses
      once, so a call count of 1 would be the wrong expectation._
- [x] `should leave the history length unchanged after unmount` — covers cleanup in
      `src/hooks/useBackNavigation.test.ts`. This is the assertion that catches the stray-entry
      failure, which on a device presents as a back button that does nothing. **Written as
      `should leave no history entry behind after unmount`, asserting POSITION rather than length:
      `history.length` cannot see this failure in jsdom or in a browser, because going back retains
      the forward entry and leaves the number unchanged either way. A sentinel in the base entry's
      state is the instrument instead.**
- [x] `should not run the decision when cleanup removes its own entry` — covers the listener-before-
      navigation ordering in `src/hooks/useBackNavigation.test.ts`. The hazard is real and the
      symptom is a dialog opening on an unmounting screen. **Measured caveat: this passes with the
      two cleanup lines in EITHER order, because the traversal is queued rather than synchronous, so
      the listener is always gone before the event lands. A second test,
      `should remove the listener before it navigates on cleanup`, pins the order as a CALL ORDER —
      the only instrument that can see it — and that one does fail when the lines are swapped
      (verified).**
- [x] `should preserve the query string` — covers the pushed entry in
      `src/hooks/useBackNavigation.test.ts`, so a mid-game reload of a shared link still works.
- [x] `should open the exit confirmation rather than calling onExit on a back press` — covers the
      wiring in `src/components/GameScreen.test.tsx`. The end-to-end assertion that back is a request.
      _Joined there by three more: back closing the exit confirmation, back closing the deck actions,
      and a second press still being intercepted._
- [x] `should not intercept a back press outside the game screen` — covers the mounting-is-scoping
      claim, in `src/components/GameScreen.test.tsx` or `src/App.test.tsx`, by asserting no entry is
      pushed for the landing and end screens. _Both: `App.test.tsx` walks landing → playing → end
      screen asserting the entry appears and disappears with the mount, and `GameScreen.test.tsx`
      asserts a press after unmount reaches nothing._

**Environment note.** The decision tests are node with no DOM. The hook and component tests need
jsdom via the per-file docblock, and both new DOM test files need their own `afterEach(cleanup)` —
Testing Library does not auto-clean here. Any file rendering a card also needs `clearQrCache()` in
its `beforeEach`.

**What these cannot prove:** that Android's gesture reaches the webview as `popstate` at all, and
that the predictive-back animation behaves. jsdom's history implementation is a model, not Chrome's.
Step 5 is the real check.

**What jsdom actually does, measured 2026-08-12 rather than guessed** (open question 3, answered):

| Question                                           | Answer                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does `history.back()` fire `popstate`?             | **Yes.** Unlike a drag, the traversal is really implemented, so the tests exercise the hook's own listener rather than a double.                                                                                                                                          |
| Synchronously?                                     | **No, and not within one macrotask either** — a `setTimeout(0)` is too early; observed at ~10 ms. Every assertion after a traversal waits on a real timer.                                                                                                                |
| Is the cleanup ordering observable?                | **No.** Both statements run in one tick, so the listener is gone before the event lands whichever order they are in. Pinned as a call order instead.                                                                                                                      |
| Is `history.length` a usable instrument?           | **No.** Going back retains the forward entry, so a stray entry and a cleanly removed one read as the same number — in jsdom _and_ in a browser.                                                                                                                           |
| Does the StrictMode phantom pop reproduce?         | **No.** A `pushState` that beats a queued traversal **discards** that traversal in jsdom; the spec has the traversal re-resolve its delta when the task runs, which is what makes it real in Chrome. So `pendingCleanupTraversals` is inert under Vitest by construction. |
| Does `pushState(state, '')` keep the query string? | **Yes** — href, search and hash all survive untouched.                                                                                                                                                                                                                    |

---

## Documentation Updates

- [ ] `AGENTS.md` — amend the rule that currently reads as "`App.tsx` never touches the address bar —
      no `pushState`, no `replaceState`". It stays **true of `App.tsx`**, and that is worth keeping
      rather than loosening; add that `GameScreen` now pushes exactly one entry for the duration of a
      game, via `useBackNavigation`, and why. A future reader finding a `pushState` in the codebase
      against a flat "never" rule will otherwise assume it is a bug and delete it.
- [ ] `docs/architecture.md` §3 — a short subsection: back as an in-app control, why the hook's
      mounting is the scoping mechanism, and the cleanup-ordering hazard, which is the kind of thing
      that gets reintroduced by a well-meaning refactor.
- [ ] `docs/development.md` §5 — new rows for step 5's device checks, marked Pending until the TWA
      exists. Note explicitly that these cannot be run in Chrome.
- [ ] `docs/agent_findings.md` — a dated entry recording whether jsdom's `history.back()` actually
      fires `popstate` and whether the cleanup ordering is observable in that environment. Both are
      load-bearing for how much the hook's tests are worth, and neither should be a guess.
- [ ] `src/game/back-navigation.ts` and `src/hooks/useBackNavigation.ts` — file headers carrying the
      reasoning: back is a request rather than an exit, and the split exists so the precedence is a
      function call rather than an event sequence.

---

## Testing Strategy

- **Unit tests:** the full decision state space as node tests; the history entry count, cleanup
  ordering and query-string preservation as jsdom tests.
- **Integration tests:** `GameScreen.test.tsx` covers the wiring — a dispatched `popstate` must
  surface the confirmation and must not call `onExit`. That is as far as this repo's environment
  reaches.
- **Manual verification:** step 5 in full, on the installed TWA. Nothing in this plan is
  _confirmed_ by a green test run; the tests guard the logic, the device confirms the behaviour.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                    | Rationale                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pure module plus thin hook, over a single hook or an inline effect.                      | The house style, for the reason it exists: the branching becomes a function call to test instead of a simulated event sequence. The dialog flags also live in `GameScreen`, so an `App.tsx` version would have to lift both. |
| 2   | `App.tsx` is not modified, and the "never touches history" rule stays true of it.        | The container is deliberately the only file that knows all four statuses exist. Scoping the reversal to `GameScreen` keeps the existing invariant intact rather than replacing it with a weaker one.                         |
| 3   | The hook's mounting is the scoping — no status check anywhere.                           | `GameScreen` is mounted exactly when the status is `playing`. An exclusion list of screens is a thing to forget to update; a mount is not.                                                                                   |
| 4   | Back is a **request**, routed through the existing confirmation.                         | Ending a game is irreversible. A hardware gesture is pressed more reflexively than a button, so if anything it needs the confirmation more, not less.                                                                        |
| 5   | Back inside a dialog closes that dialog and nothing else.                                | It is what every Android app does, and a back press that _confirmed_ an exit would be worse than no interception.                                                                                                            |
| 6   | The precedence for both-dialogs-open is chosen and tested even though it is unreachable. | A total function costs one line. A partial one is a crash waiting for a refactor that makes the state reachable.                                                                                                             |
| 7   | Listener removed before the cleanup navigation, always.                                  | Undoing the entry fires `popstate` asynchronously; with the listener still attached, cleanup is read as a back press and a dialog opens on an unmounting screen.                                                             |
| 8   | Cleanup must leave the history length as it found it.                                    | A stray entry means the first back press on the landing screen does nothing visible, which reads as a broken back button — a worse bug than the one being fixed.                                                             |
| 9   | The browser-side change is accepted, not suppressed.                                     | Desktop and mobile-Chrome back will also open the confirmation during play. That is a consistency win and a mis-swipe protection, and it is recorded as a decision rather than discovered later.                             |
| 10  | Guard 4 is verified unchanged rather than edited.                                        | No third dialog is added, so the OR over two flags still holds. Verifying is cheap and that guard prevents dealing a card behind a backdrop.                                                                                 |

---

## Open Questions

- [ ] Does Android's back gesture reach the TWA's webview as a `popstate` when a history entry
      exists, in the way a browser back does? This is the load-bearing assumption of the whole plan.
      If it does not, the fallback is a shell-side change in `android/` and this plan needs rewriting.
- [ ] Does the **Android 13+ predictive back** animation preview the app closing while the web app
      is actually handling the press? If it does, the gesture would show a peel-away animation and
      then not close, which looks broken. Check whether the generated shell opts into the new
      callback API and whether Bubblewrap exposes that.
- [x] Does jsdom's `history.back()` fire `popstate`, and is the cleanup ordering observable there? It
      decides how much the hook's tests actually prove — record the answer either way. **Answered
      2026-08-12: it fires, asynchronously at ~10 ms; the ordering is NOT observable; `history.length`
      is not an instrument; and the StrictMode phantom pop cannot be reproduced there at all. Full
      table under Testing Strategy, and each affected test says so in its own comment.**
- [ ] Should back on the **end screen** be intercepted to return to the landing screen rather than
      closing the app? Currently out of scope, and the end screen's own "Home" button already covers
      the intent, but it is the next thing a tester will ask about.

---

## Out of Scope

- **Everything in plan 1** — packaging, asset links, the listing, the store.
- **Intercepting back anywhere other than the game screen.** Landing, preparing and end keep
  Android's default behaviour deliberately; the end-screen variant is an open question, not a
  deliverable.
- **A general in-app navigation or routing layer.** The app is one screen at a time driven by
  `GameState.status`, and one history entry for one screen is the whole requirement. Adding a router
  to solve a back button would be the tail wagging the dog.
- **Changing `ExitConfirmDialog`'s copy or behaviour.** Back reuses it exactly as it is.
- **Any change to `gestures.ts` or the five gesture constants.** A hardware back press is not a
  swipe and shares nothing with that module.
