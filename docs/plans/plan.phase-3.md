# Plan: phase-3 — Deck & Game State

> **Task:** phase-3 — the client-side game layer
> **Date:** 2026-08-04
> **Author:** Aleix Rabassa
> **Source:** [plan.md](./plan.md) §5 — Phase 3, all four checkboxes
> **Depends on:** [plan.phase-2-playlist.md](./plan.phase-2-playlist.md) and [plan.phase-2-year.md](./plan.phase-2-year.md) — both complete; this plan is their first client-side consumer

---

## Overview

Phase 2 produced two endpoints and a normalized `Card`. Phase 3 turns them into a game: a shuffled
deck, a reducer that moves through it, a background loop that fills in years while play proceeds, and
a `localStorage` save so a reload does not lose the session. It covers all four Phase 3 checkboxes in
[plan.md](./plan.md) §5.

The hard part is not the reducer — it is the loading model. A cold year lookup costs **1.3–3.6 s** and
the MusicBrainz budget of 1 req/s is **global across every user of the app**, so a cold 100-card deck
takes minutes. `plan.md` §1 makes the consequence a non-negotiable: **Start waits on exactly one year,
card 1's, and never on the deck.** Everything else resolves in the background while the player is
looking at a card. `/api/year` already provides the back-pressure signal this needs — a 429 carrying
`retryAfterMs`, which is designed behaviour and not an error.

This phase is **headless**. It ships no UI: `src/App.tsx` stays the Phase 1 placeholder, and Phase 4
(card UI) and Phase 6 (screens) are the first things to render any of it. Everything here is driven by
tests.

---

## Dependency Contract

### Requires from Phase 2

| Input                                            | Description                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Card` in `shared/types.ts`                      | The deck element. `year` is already three-state (`undefined` = not looked up, `null` = looked up and nothing found, number = resolved) |
| `PlaylistSummary` / `PlaylistResult`             | What a started session records about the deck it is playing                                                                          |
| `TrackRef` in `shared/types.ts`                  | A `Card` is structurally a valid `TrackRef`, so the resolver passes cards straight to the lookup                                     |
| `GET /api/year` — one track per request          | The only endpoint this phase calls. Query: `title`, `artist`, `durationMs`                                                           |
| `YearLookupResult` / `YearErrorCode`             | The response and error unions the year client maps onto                                                                              |
| 429 + `retryAfterMs` (and the `Retry-After` header) | The back-pressure contract the resolver backs off on                                                                                 |
| `YearConfidence` (`high` / `low` / `none`)       | Recorded on the card; consumed by Phase 6's revealed side, not here                                                                  |

### Produces for downstream phases

| Output                                                 | Consumed by                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `GameState` / `GameAction` in `src/game/types.ts`      | Phase 4's card component and Phase 6's screens                                            |
| `useGameSession()` in `src/game/use-game-session.ts`   | Phase 6 — the single entry point that wires reducer, resolver and persistence together    |
| `shuffleDeck()` in `src/game/shuffle.ts`               | Phase 8's shareable deck URL (playlist id + seed reproduces the deck exactly)             |
| Derived selectors (`isCurrentYearPending`, `cardsRemaining`, `resolvedCount`) | Phase 4's year slot, Phase 6's HUD and loading state                    |
| `status: 'preparing'`                                  | Phase 6's loading screen — the only place a pre-Start wait may be rendered                |
| The `localStorage` session format and its version key  | Phase 6's resume affordance; Phase 8 if a saved-decks feature ever lands                  |

---

## Scope & Affected Areas

| Area                                | Type     | Notes                                                                                                                                                            |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/game/types.ts`                 | New      | `GameState`, `GameStatus`, `GameAction`, the persisted-session shape. Client-only, so deliberately **not** added to `shared/types.ts`                              |
| `src/game/shuffle.ts`               | New      | String-seeded PRNG plus Fisher–Yates. Pure                                                                                                                       |
| `src/game/shuffle.test.ts`          | New      | Reproducibility, permutation correctness, distribution sanity                                                                                                    |
| `src/game/reducer.ts`               | New      | `gameReducer` and the derived selectors. Pure                                                                                                                    |
| `src/game/reducer.test.ts`          | New      | The transition table, plus the card-1 gate invariant                                                                                                             |
| `src/game/year-client.ts`           | New      | `GET /api/year` wrapper: builds the query, maps HTTP status onto a typed outcome union, never throws. `fetch` injected                                           |
| `src/game/year-client.test.ts`      | New      | Query construction and every status branch, against an injected fetch                                                                                            |
| `src/game/resolver.ts`              | New      | The sequential background loop: ordering, priority jump, 429 back-off, error retry, abort. Framework-free; clock and sleep injected                              |
| `src/game/resolver.test.ts`         | New      | The bulk of this plan's test surface — sequencing, back-off, and the never-blocks invariant                                                                      |
| `src/game/persistence.ts`           | New      | Serialize, validate, load, clear. `Storage` injected so it runs under the node test environment                                                                  |
| `src/game/persistence.test.ts`      | New      | Round-trip, version mismatch, corrupt payload, quota failure                                                                                                     |
| `src/game/use-game-session.ts`      | New      | The React hook. Deliberately thin — wiring only, no logic, and therefore not unit-tested (see Testing Strategy)                                                  |
| `docs/architecture.md`              | Modified | New client-side game-layer section; mark Phase 3 `[built]` in §1 and §7; record the `src/game/` boundary                                                          |
| `docs/api.md`                       | Modified | Note that `/api/year`'s 429 contract now has a documented client, and cross-reference the resolver as the reference consumer                                     |
| `docs/development.md`               | Modified | How to exercise the resolver locally, and the Upstash warning that applies when resolving a whole deck                                                           |
| `docs/agent_findings.md`            | Modified | Dated entries — see Documentation Updates                                                                                                                        |
| `docs/plans/plan.md`                | Modified | Tick the Phase 3 checkboxes; **close §6's follow-on question** about `confidence: 'none'` cards                                                                   |
| `docs/plans/plan.phase-3.md`        | Modified | Tick steps and append execution notes as they land                                                                                                               |
| `AGENTS.md`                         | Modified | Phase status → "Phase 3 complete, Phase 4 next"; add this file to the documentation index                                                                        |
| `src/App.tsx`                       | Unchanged | Stays the Phase 1 placeholder. This phase renders nothing                                                                                                        |
| `vite.config.ts`                    | Unchanged | `environment: 'node'` holds; `include` already covers `src/**`. jsdom stays a Phase 4 decision                                                                    |

**No dependency changes.** No jsdom, no Testing Library, no Zustand, no PRNG library.

---

## Chosen Approach

**A framework-free resolver engine feeding a pure reducer, with React reduced to a wiring hook.**

`src/game/resolver.ts` owns everything about the background fill: it walks the shuffled deck in order,
one `/api/year` call at a time, honours a 429's `retryAfterMs`, jumps the queue when the player lands
on an unresolved card, and stops when the session ends. It takes its `fetch`, its `sleep` and its
result callback as injected dependencies, so the whole loop — including timing and back-off — is
testable under the existing node environment with a fake clock. The reducer never calls it; it only
records what the resolver reports, via a `YEAR_RESOLVED` action.

That split is chosen over **putting the loop in a `useEffect` that drains a queue held in the
reducer**, which is fewer moving parts but makes the timing logic reachable only through React —
unavailable in a node-only test environment, and awkward even with jsdom, because fake timers and
React's scheduler fight each other. It is also chosen over **Zustand with persist middleware**
([plan.md](./plan.md) §3 lists it as the alternative): it would give persistence for free, but adds a
dependency the plan already decided against, and the resolver would still have to live outside the
store, so the main structural problem is unchanged.

**Pacing is a continuous full-deck crawl**, exactly as [plan.md](./plan.md) §5 specifies: the loop
keeps running for the whole session rather than maintaining a small lookahead window. A window would
spend less of the global 1 req/s budget on decks nobody finishes, but it deviates from the plan, can
be outrun by a fast player, and gives up the side benefit that matters most — a completed crawl warms
the shared server-side cache, so the next person who plays that playlist gets it at 0 ms.

**The card-1 gate is refined from the plan's wording, deliberately.** [plan.md](./plan.md) §5 says
"`START` dispatches as soon as card 1 has a year". As built, `START` dispatches immediately and puts
the session in a `preparing` status; the transition to `playing` happens when card 1's lookup
**completes**, whatever it returns. Two reasons. First, a card with `year: null` is playable
(decided 2026-08-04) — gating on "has a year" would hang forever on a card that legitimately has
none. Second, holding the pre-Start wait inside the reducer makes "playable while cards 2..n are
`undefined`" a reducer invariant that a unit test can assert, which is exactly the test
[plan.md](./plan.md) §5 asks for and warns "regresses silently".

**When the player outruns the resolver, only the year slot waits.** The resolver exposes
`prioritize(cardId)`; the hook calls it whenever `currentIndex` changes, and the loop resolves that
card next before resuming deck order. Flip, swipe, QR, audio and Exit are never blocked — a derived
`isCurrentYearPending` selector is all Phase 4 needs to render a pending state in the year area. The
wait is therefore one lookup, not a queue drain.

---

## Implementation Steps

- [ ] **Define the game types in `src/game/types.ts`** — client-only, so they stay out of
      `shared/types.ts`, whose comment already reserves `GameState` for this phase while forbidding
      any of it from widening `Card`.
  - [ ] `GameStatus` as `'idle' | 'preparing' | 'playing' | 'ended'`. `preparing` is the card-1 gate
        and the only state Phase 6 may render a loading screen for
  - [ ] `GameState` holding: `status`, `playlist` (the `PlaylistSummary`, or null when idle), `seed`,
        `deck` (the shuffled `Card[]`, with years filled in place as they arrive), `currentIndex`,
        `isFlipped`, and `yearLookupsUnavailable` (a hard-stop flag — see the resolver step)
  - [ ] `GameAction` as a discriminated union on `type`: `START`, `YEAR_RESOLVED`, `YEAR_LOOKUPS_UNAVAILABLE`,
        `FLIP`, `NEXT`, `RESUME`, `END`. [plan.md](./plan.md) names only the first, `FLIP`, `NEXT` and
        `END`; document beside the union why the other three exist — `YEAR_RESOLVED` is how the
        resolver reports back, `RESUME` is how a persisted session re-enters, and
        `YEAR_LOOKUPS_UNAVAILABLE` is the deployment-fault stop
  - [ ] `PersistedSession` as the serialized shape, with an explicit numeric `version` field. Keep it
        structurally separate from `GameState` even where they currently coincide, so a future state
        field can be added without silently changing the storage format

- [ ] **Write the seeded shuffle in `src/game/shuffle.ts`** — pure, no `Math.random()`, no `Date.now()`.
      It runs **before** year resolution, which is the ordering [plan.md](./plan.md) §3 spends a
      paragraph on: resolution must walk the deck in **play** order, or the first request is spent on a
      track that lands somewhere random in the deck.
  - [ ] Accept a **string** seed, not a number. A string is what a Phase 8 shareable URL would carry,
        and it costs nothing now
  - [ ] Derive the generator's 32-bit state from the seed with a small string-hash step, then use a
        mulberry32-style generator. Both are a handful of lines; do not add a dependency
  - [ ] Fisher–Yates, iterating downwards, returning a **new** array and never mutating the input
  - [ ] Add `generateSeed()` as a separate export that produces a short random string from
        `crypto.getRandomValues`. Keep it out of `shuffleDeck()` so the shuffle itself stays pure and
        the browser API sits in exactly one named place
  - [ ] Inline comment: why the shuffle is seeded at all (reproducible decks, resume, and Phase 8's
        shareable URL) and why it must precede resolution

- [ ] **Write `gameReducer` in `src/game/reducer.ts`** — pure, exhaustive over the action union, and
      never mutating state.
  - [ ] `START` takes `{cards, playlist, seed?}`. It **shuffles first**, synchronously, then sets
        `currentIndex` to 0, `isFlipped` false, and status to `preparing` — so the resolver is only
        ever handed an already-shuffled deck and "card 1" always means the first card of the shuffled
        deck (decision 15). Accepting an optional seed is what makes Phase 8 a caller change rather
        than a reducer change
  - [ ] `START` on an already-running session replaces it wholesale — starting a new playlist mid-game
        must not merge into the old deck
  - [ ] `YEAR_RESOLVED` matches **by card id, not by index**, and writes `year` and `yearConfidence`
        onto that card. Matching by index would corrupt the deck the moment the resolver's ordering and
        the deck's ordering diverge, which the priority jump makes routine
  - [ ] **The card-1 gate:** while status is `preparing`, a `YEAR_RESOLVED` for the card at index 0
        transitions status to `playing` — regardless of whether it carried a year. A `null` year is a
        completed lookup, and its card is playable
  - [ ] `YEAR_LOOKUPS_UNAVAILABLE` sets the flag and, if still `preparing`, transitions to `playing`
        anyway. A deployment with no `MUSICBRAINZ_USER_AGENT` must not leave the player staring at a
        loading screen forever — the deck is still playable, just yearless
  - [ ] `FLIP` toggles `isFlipped`. It is **never** gated on the year having arrived; the pending state
        belongs to the year slot alone
  - [ ] `NEXT` advances `currentIndex` and resets `isFlipped` to false. Advancing past the last card
        sets status to `ended` and leaves `currentIndex` at the last card rather than out of bounds
  - [ ] `END` sets status to `ended` — this is the Exit button's action, and Phase 6 redirects on it
  - [ ] `RESUME` replaces the whole state from a validated persisted session
  - [ ] Actions that do not apply to the current status are **no-ops that return the same object
        reference**, not throws. A late `YEAR_RESOLVED` arriving after `END` is normal, not an error
  - [ ] Export derived selectors as plain functions beside the reducer, not as state fields:
        `currentCard`, `isCurrentYearPending` (the current card's `year` is `undefined`),
        `cardsRemaining`, and `resolvedCount` (for Phase 6's count-only progress text). Deriving rather
        than storing is what stops them going stale

- [ ] **Write the year client in `src/game/year-client.ts`** — a thin, typed wrapper over
      `GET /api/year` with `fetch` injected, mirroring how the Phase 2 adapters were made testable.
  - [ ] Build the query from a `TrackRef` — `title`, `artist`, `durationMs` — URL-encoded. Pass the raw
        joined artist string; the server does the cleaning and the primary-artist fallback, and
        duplicating that here would let the two drift
  - [ ] Return a typed outcome union rather than throwing: success carrying the `YearLookupResult`, or
        a failure carrying the `YearErrorCode` plus `retryAfterMs` when present. Add a client-only
        `network` code for a rejected fetch, which has no HTTP status
  - [ ] Read `retryAfterMs` from the **body**, falling back to the `Retry-After` header (seconds) if
        the body is unparseable. The body is the primary contract; the header is the safety net
  - [ ] Accept an `AbortSignal` and pass it through, so ending a session cancels the request in flight
        instead of resolving into a dead reducer

- [ ] **Write the resolver in `src/game/resolver.ts`** — the heart of this plan. Framework-free, with
      the lookup function, a `sleep`, and the result callback all injected. It must never import React.
  - [ ] **Strictly sequential: exactly one lookup in flight at any moment.** [plan.md](./plan.md) §5
        calls this out explicitly — a `Promise.all` over 100 cards would stampede the global 1 req/s
        gate into ~99 rejections
  - [ ] Walk the deck in order from index 0, skipping cards that already carry a resolved year (a
        resumed session arrives with most of the deck already filled)
  - [ ] **Priority jump:** expose `prioritize(cardId)`. Before each iteration the loop checks for a
        pending priority card that is still unresolved and takes it next, then resumes ordered walking
        from where it was. Setting a priority must never restart the crawl from the beginning
  - [ ] **On 429: back off and retry the same card.** This is designed back-pressure, not a failure —
        the card is not marked resolved and not skipped. Wait the server's `retryAfterMs`, clamped into
        a sane range and with a little jitter so two tabs do not resynchronise onto the same gate
  - [ ] **On `upstream-unavailable`, `unexpected-payload` or `network`: retry a small number of times
        with exponential back-off**, then move the card to a deferred list and continue. Run the
        deferred list once more after the main crawl finishes; only then does the card settle at
        `year: null, confidence: 'none'`. A transient MusicBrainz blip must not permanently blank a
        third of the deck
  - [ ] **On `not-configured`: stop the entire crawl** and report `YEAR_LOOKUPS_UNAVAILABLE`. It is a
        deployment fault that will fail identically for every remaining card, and hammering 100 cards
        with 500s helps nobody. This is the one error that ends the loop
  - [ ] **On `invalid-request`: do not retry** — the input is wrong, so settle that card at `none` and
        move on
  - [ ] Expose `start()`, `prioritize()` and `stop()`. `stop()` aborts the in-flight request and
        guarantees no further callbacks fire, so a `YEAR_RESOLVED` can never land after `END`
  - [ ] The loop must survive a callback that throws — a consumer bug should not silently kill the
        crawl for the rest of the deck
  - [ ] Inline comment citing the measurements this design exists for: 1.3–3.6 s per cold lookup, 0 ms
        cached, and the budget being **global across all users**, not per user. Without that note the
        sequential loop reads like an obvious candidate for parallelisation

- [ ] **Write persistence in `src/game/persistence.ts`** — a `Storage`-shaped dependency injected, so
      the tests run under the node environment with a plain in-memory stub and no jsdom.
  - [ ] Key `hitster:session:v1`. The `v1` segment is the same deliberate invalidation lever
        `api/_lib/cache.ts` uses: when the persisted shape changes, bump it and every incompatible save
        is discarded in one edit instead of crashing a resume path
  - [ ] Persist the full session — playlist summary, seed, the shuffled deck **including every year
        already resolved**, `currentIndex`, `isFlipped`, `status`. Keeping the resolved years is the
        point: a reload then costs zero MusicBrainz requests
  - [ ] `loadSession()` validates before trusting: version match, expected fields present, deck a
        non-empty array, `currentIndex` in range. Anything else returns null and clears the key. It
        must **never throw** — a corrupt save should cost the player a game, not the whole app
  - [ ] `saveSession()` swallows and logs write failures (quota, private-mode restrictions). Same
        principle as the year cache: persistence is a convenience, never a correctness dependency
  - [ ] `clearSession()` on `END`, and before a `START` that replaces an existing session
  - [ ] Comment the leak surface honestly: the saved deck contains every title, artist and resolved
        year, so a player with devtools open can read the whole deck. That is the same exposure the
        in-memory deck already has and is not worth obfuscating — but the 2026-08-04 "leaks nothing is
        a property of the whole app" finding means it should be written down rather than discovered

- [ ] **Write the wiring hook in `src/game/use-game-session.ts`** — deliberately thin. Every branch it
      contains is a candidate to be pushed down into one of the tested modules.
  - [ ] `useReducer(gameReducer, …)` with a lazy initializer that attempts `loadSession()` once
  - [ ] One effect starts the resolver when status becomes `preparing`, feeding results in as
        `YEAR_RESOLVED`, and calls `stop()` on unmount or when status becomes `ended`
  - [ ] One effect calls `resolver.prioritize()` when `currentIndex` changes
  - [ ] One effect persists on state change and clears on `ended`
  - [ ] Return the state, the derived selectors, and narrow callbacks (`start`, `flip`, `next`, `end`)
        rather than the raw `dispatch`, so Phase 4 and Phase 6 cannot invent transitions
  - [ ] Guard against React 19 StrictMode's double-invoked effects starting two resolvers — an
        idempotent `start()` and a real cleanup, verified by watching the request count in the browser

- [ ] **Verify progressive loading against a real playlist** — the invariant that
      [plan.md](./plan.md) §5 warns "regresses silently, because a deck of cached years resolves fast
      enough to hide a blocking implementation in local testing".
  - [ ] Drive a real deck through the hook from a temporary scratch harness (not committed), against a
        **preview deployment** rather than `vercel dev` — the dev server adds ~4 s per request and does
        not persist the gate, so it measures the dev server and unpaces MusicBrainz (2026-08-04 finding)
  - [ ] Confirm the first card becomes playable in roughly one lookup, not one deck
  - [ ] Confirm cards 2..n fill in while the deck is being played, and that a rapid advance to an
        unresolved card resolves **that** card next
  - [ ] **Measure the wall clock for a 50-track cold deck.** This number is still owed from Phase 2,
        which could not measure it locally, and it belongs in `agent_findings.md`

- [ ] **Run the full local verification pass** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`,
      all four green. There are no hooks and no CI; the checks are ours to run.

- [ ] **Update the documentation** — see Documentation Updates, including closing
      [plan.md](./plan.md) §6's follow-on question.

- [ ] **Tick the Phase 3 checkboxes in `docs/plans/plan.md`**, annotating each with what execution
      actually produced, in the style Phase 2 established.

---

## Unit Tests

Vitest, node environment, no new dependencies. Import `describe`/`it`/`expect` from `vitest`
explicitly, matching `shared/year.test.ts`. `vite.config.ts` already includes `src/**` test files and
`tsconfig.app.json` already covers `src`, so no configuration changes are needed.

### `src/game/shuffle.test.ts`

- [ ] `should produce the same order for the same seed` — covers reproducibility, the property resume
      and Phase 8's shareable URL both rest on
- [ ] `should produce a different order for a different seed` — covers that the seed is actually
      threaded into the generator rather than ignored
- [ ] `should return a permutation containing every input card exactly once` — covers the classic
      Fisher–Yates off-by-one that silently duplicates or drops an element
- [ ] `should not mutate the input array` — covers purity, which the reducer relies on
- [ ] `should handle an empty deck and a single-card deck` — covers the degenerate bounds
- [ ] `should not leave most cards in their original position` — a coarse distribution sanity check
      that catches a generator returning a constant
- [ ] `should generate distinct seeds on repeated calls` — covers `generateSeed()`

### `src/game/reducer.test.ts` — transitions

- [ ] `should shuffle the deck on START and enter preparing` — covers the entry transition and that
      shuffling happens before any resolution
- [ ] `should use an explicitly supplied seed on START` — covers the Phase 8 forward-compatibility hook
- [ ] `should replace an existing session when START is dispatched again` — covers starting a new
      playlist mid-game, which must not merge decks
- [ ] `should record a resolved year on the matching card by id` — covers the core write path
- [ ] `should not disturb other cards when one year resolves` — covers immutable update correctness
- [ ] `should ignore a YEAR_RESOLVED for an unknown card id` — covers a stale callback after a deck swap
- [ ] `should toggle isFlipped on FLIP` — covers reveal and un-reveal
- [ ] `should advance the index and reset the flip on NEXT` — covers the card 4/5 will drive most often
- [ ] `should enter ended when NEXT is dispatched on the last card` — covers the natural deck end
- [ ] `should enter ended on END` — covers the Exit button's action
- [ ] `should treat a YEAR_RESOLVED arriving after END as a no-op returning the same reference` —
      covers the late-callback case, which is normal rather than exceptional
- [ ] `should restore a full session on RESUME` — covers the persistence re-entry path

### `src/game/reducer.test.ts` — the card-1 gate

- [ ] `should stay preparing until card 1 resolves` — covers the gate existing at all
- [ ] `should enter playing when card 1 resolves, even with a null year` — covers the refinement of
      `plan.md`'s wording; gating on "has a year" would hang forever on a legitimately yearless card
- [ ] `should stay preparing when a card other than card 1 resolves first` — covers that the gate is
      card 1 specifically, not "any year"
- [ ] `should enter playing on YEAR_LOOKUPS_UNAVAILABLE while preparing` — covers that a misconfigured
      deployment yields a yearless but playable deck, not an infinite loading screen
- [ ] **`should be fully playable while cards 2..n are still undefined`** — flip, next, and end all
      work on a deck where only card 1 has resolved. **This is the invariant `plan.md` §5 singles out
      as the one that regresses silently**; it is the most important test in this plan
- [ ] `should report the current card's year as pending when it is undefined` — covers
      `isCurrentYearPending`, which is the whole of Phase 4's blocking behaviour
- [ ] `should not report pending for a card resolved to a null year` — covers the distinction between
      "not looked up yet" and "looked up, nothing found"; collapsing them would spin forever on a
      `none` card

### `src/game/year-client.test.ts`

- [ ] `should build the query from title, artist and durationMs` — covers request construction against
      an injected fetch
- [ ] `should URL-encode titles and artists containing punctuation` — covers the very common
      apostrophe/ampersand case
- [ ] `should send the raw joined artist string unmodified` — covers that cleaning stays server-side
- [ ] `should return the parsed result on 200` — covers the success path
- [ ] `should surface retryAfterMs from a 429 body` — covers the back-pressure contract the resolver
      depends on
- [ ] `should fall back to the Retry-After header when the body is unparseable` — covers the safety net
- [ ] `should map each error status onto its typed code` — covers 400, 429, 500 and 502 mapping
- [ ] `should return a network outcome instead of throwing when fetch rejects` — covers the offline case
- [ ] `should abort an in-flight request when the signal fires` — covers session teardown

### `src/game/resolver.test.ts`

- [ ] `should resolve cards in deck order` — covers the ordering `plan.md` §3 insists on
- [ ] `should never have more than one lookup in flight` — asserted with a concurrency counter in the
      fake lookup. Directly guards against the `Promise.all` mistake the plan warns about
- [ ] `should skip cards that already have a resolved year` — covers the resumed-session path, which
      must not re-spend the global budget on work already done
- [ ] `should resolve a prioritized card next` — covers the player outrunning the crawl
- [ ] `should resume ordered walking after servicing a priority` — covers that the jump does not
      restart the crawl or lose its place
- [ ] `should ignore a priority for a card that is already resolved` — covers the common case where the
      player advances onto a card the crawl already handled
- [ ] `should wait the reported retryAfterMs and retry the same card on 429` — covers back-off, with a
      fake clock asserting the delay
- [ ] `should not mark a card resolved because of a 429` — covers that back-pressure is not failure.
      The single most likely misreading of the Phase 2 contract
- [ ] `should retry a transient upstream error with exponential back-off` — covers the retry policy
- [ ] `should defer a persistently failing card and retry it after the crawl` — covers the deferred
      pass that stops a blip from blanking the deck
- [ ] `should settle a card at null/none after the deferred pass also fails` — covers the terminal state
- [ ] `should stop the whole crawl on not-configured` — covers the deployment-fault stop, and that it
      does not burn the rest of the deck on guaranteed 500s
- [ ] `should not retry an invalid-request` — covers the non-transient client error
- [ ] `should emit no further callbacks after stop()` — covers teardown, guaranteeing nothing lands in
      a dead reducer
- [ ] `should abort the in-flight request on stop()` — covers cancellation rather than mere ignoring
- [ ] `should continue the crawl when a result callback throws` — covers consumer-bug resilience

### `src/game/persistence.test.ts`

- [ ] `should round-trip a full session` — covers the format end to end
- [ ] `should preserve resolved years and confidences through a round trip` — covers the reason
      persistence exists at all; losing them would silently re-spend the global budget on every reload
- [ ] `should return null and clear the key on a version mismatch` — covers the `v1` invalidation lever
- [ ] `should return null on unparseable JSON rather than throwing` — covers a corrupt save
- [ ] `should return null when the deck is missing or empty` — covers shape validation
- [ ] `should return null when currentIndex is out of range` — covers the validation most likely to
      prevent a crash on resume
- [ ] `should swallow and log a write failure` — covers quota and private-mode restrictions
- [ ] `should remove the key on clearSession` — covers teardown at `END`

`src/game/use-game-session.ts` is left to manual verification, exactly as `api/year.ts` and
`api/playlist.ts` were: it is effect wiring over four already-tested modules, and testing it would
require pulling the Phase 4 jsdom decision forward. **Any logic that starts accumulating there belongs
in the reducer or the resolver instead** — that rule is what keeps the untested surface honest.

---

## Documentation Updates

- [ ] `docs/architecture.md` — add a client-side game-layer section covering `src/game/`: the reducer
      is pure, the resolver is framework-free and injectable, React is wiring only. State the import
      boundary explicitly (`src/game/` may use DOM APIs and the `@/` alias; nothing under `api/` may
      ever import it). Mark Phase 3 `[built]` in §1 and §7, and add the progressive-loading path to the
      data-flow picture
- [ ] `docs/architecture.md` — record the **card-1 gate as an invariant of the app**, not an
      implementation detail: Start waits on one lookup, never on the deck. It is the thing most likely
      to be "simplified" away by someone who only ever tested a fully cached playlist
- [ ] `docs/api.md` — note that `/api/year`'s 429 + `retryAfterMs` contract now has a reference client
      in `src/game/resolver.ts`, and that a 429 is expected behaviour under a cold deck rather than an
      error to be alarmed by
- [ ] `docs/development.md` — how to exercise the resolver, and the warning that carries over from
      Phase 2: **configure Upstash before resolving a whole deck**, because without it nothing paces
      MusicBrainz locally and a 50-card deck is ~100 unthrottled requests against a service that blocks
      for it. Also that `vercel dev` cannot be used for any timing measurement
- [ ] `docs/development.md` — that Phase 3 adds no test dependencies and the environment is still
      `node`; jsdom remains a Phase 4 decision
- [ ] `docs/agent_findings.md` — dated (ISO 8601) entries for: the **measured wall clock of a 50-track
      cold deck against a preview deployment** (owed from Phase 2 and unmeasurable there); whether the
      strict pass or the relaxed pass dominates on an ordinary playlist rather than the curated tricky
      set (also still open from Phase 2, and a real deck finally answers it); how often a real session
      actually hits a 429; and any React 19 StrictMode double-start surprise in the hook. **Tell the
      developer when an entry is added**, per `AGENTS.md`
- [ ] `docs/plans/plan.md` — tick all four Phase 3 checkboxes with execution annotations, and **close
      §6's follow-on question**: a `confidence: 'none'` card stays in the deck and is playable, which
      also resolves the contradiction with the Phase 2 completion note in §5 that had already decided it
- [ ] `docs/plans/plan.phase-3.md` — tick steps as they complete and append an Execution Notes section
      where reality differed, in the style of [plan.phase-2-year.md](./plan.phase-2-year.md)
- [ ] `AGENTS.md` — phase status to "Phase 3 complete, Phase 4 next", and add this plan to the
      documentation index table
- [ ] Inline comment in `src/game/resolver.ts` — the measured numbers (1.3–3.6 s cold, 0 ms cached,
      budget **global across all users**) and therefore why the loop is sequential and why a 429 is not
      an error. Without this the loop is a prime candidate for "optimisation" into a `Promise.all`
- [ ] Inline comment in `src/game/reducer.ts` above the card-1 gate — that it waits for the lookup to
      **complete**, not to produce a year, and that a `null` year is a completed lookup
- [ ] Inline comment in `src/game/shuffle.ts` — that the shuffle must run before resolution, citing
      [plan.md](./plan.md) §3's reasoning about resolving in play order
- [ ] Inline comment in `src/game/persistence.ts` — the `v1` key segment as an invalidation lever, and
      the honest note that the saved deck is readable in devtools

---

## Testing Strategy

- **Unit tests:** everything above, under the existing node environment. The centre of gravity is
  `resolver.test.ts` (sequencing, back-off, priority, teardown) and the card-1 gate group in
  `reducer.test.ts`. Keeping the reducer pure, the resolver injectable and persistence
  `Storage`-agnostic is precisely what makes that possible without jsdom, fake React timers, or a
  network.
- **Integration tests:** none automated. An end-to-end test would need a live MusicBrainz call, which
  is rate-limited to 1 req/s globally, non-deterministic as the database improves, and slow enough to
  make the suite useless. The seam between the hook and the four modules is covered by manual
  verification instead.
- **Manual verification** (record outcomes in this file, as Phase 2 did):
  - Card 1 becomes playable after roughly one lookup on a **cold** deck — the invariant, checked
    against a preview deployment where the gate and cache are real
  - Cards 2..n visibly fill in during play
  - Advancing rapidly to an unresolved card resolves **that** card next, and only the year slot waits
  - A mid-game reload restores the same deck, the same position, and every year already resolved —
    with no new `/api/year` requests for cards that were already done
  - Ending the session clears the saved state and stops the resolver: no requests continue afterwards
  - A deck containing a track that resolves to `confidence: 'none'` stays playable and is never skipped
  - With `MUSICBRAINZ_USER_AGENT` unset, the deck still starts and plays, yearless, rather than hanging
    in `preparing`
  - Under React 19 StrictMode, exactly one resolver runs — count the requests, do not assume
  - **Wall clock for a 50-track cold deck**, measured against a preview deployment with Upstash
    configured. Not `vercel dev`: ~4 s per request of dev-server overhead dominates the measurement and
    the gate paces nothing there (2026-08-04 finding)

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                                        | Rationale                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Headless phase.** No UI ships; `src/App.tsx` stays the Phase 1 placeholder                                                                 | Keeps the Phase 3/4 boundary clean and avoids UI written to be deleted. Considered a throwaway debug harness and a minimal real landing input; both build ahead of the plan. A scratch harness may exist uncommitted for the manual checks |
| 2   | **Standalone resolver engine + reducer sink**, React as a wiring hook                                                                        | Chosen over a reducer-owned `useEffect` drain loop (timing logic only reachable through React, untestable in a node environment) and over Zustand + persist (adds a dependency `plan.md` chose against, and the resolver would still live outside the store) |
| 3   | **Continuous full-deck crawl**, not a lookahead window                                                                                       | Matches `plan.md` §5 verbatim, can never be outrun, and warms the shared server cache for the next player. A window would save global budget on abandoned decks but deviates from the plan and adds a resume trigger on every `NEXT`      |
| 4   | **`START` enters `preparing`; card 1's completed lookup transitions to `playing`** — a refinement of `plan.md`'s "dispatches as soon as card 1 has a year" | Gating on "has a year" would hang forever on a card that legitimately resolves to `null`. Holding the wait in the reducer also makes the playable-while-unresolved invariant unit-testable, which is the test `plan.md` explicitly asks for |
| 5   | **A `confidence: 'none'` card stays in the deck and is playable**                                                                            | Confirms the 2026-08-04 decision recorded in `plan.md` §5 and closes the contradicting open fork in §6. Same principle as an unplayable track: the QR always works, so the card still plays. Dropping cards would also mean removing them after they may already have been dealt |
| 6   | **Priority jump on outrun; only the year slot waits**                                                                                        | The player is looking at exactly one card, so the wait is one lookup (~1.3–3.6 s) rather than a queue drain. Chosen over strict deck order (potentially minutes) and over never blocking (a year appearing mid-guess changes the game)   |
| 7   | **Random seed per game, persisted, with `START` accepting an override**                                                                      | A party game must not deal the same order every time, which rules out deriving the seed from the playlist id. The optional override makes Phase 8's shareable deck URL a caller change with no reducer change, at zero cost today        |
| 8   | **Full session persisted, including resolved years, behind a versioned key**                                                                 | A reload then costs zero MusicBrainz requests against a globally shared budget. Chosen over persisting only seed + index (every year re-resolved, and a changed playlist silently changes the deck). No age cap: one less branch, and a stale deck is harmless |
| 9   | **Framework-free logic, node test environment, no new dependencies**                                                                         | Holds the jsdom decision at Phase 4 where `vite.config.ts` already documents it. The price is that the hook is manually verified rather than unit-tested — accepted, and bounded by the rule that logic must not accumulate there        |
| 10  | **429 is back-pressure, not failure**; a card is never marked resolved or skipped because of one                                             | Directly from Phase 2's contract and the `plan.md` §5 completion note. Encoded as its own test because it is the most likely misreading                                                                                                  |
| 11  | **`not-configured` stops the crawl entirely; other upstream errors get a deferred second pass**                                              | A missing `MUSICBRAINZ_USER_AGENT` fails identically for all 100 cards, so retrying is pure waste; a transient MusicBrainz blip is the opposite, and must not permanently blank a third of the deck                                       |
| 12  | **`GameState` lives in `src/game/types.ts`, not `shared/types.ts`**                                                                          | It is browser-only and no function needs it. `shared/types.ts` already reserves `GameState` for Phase 3 while forbidding it from widening `Card`; keeping it out of `shared/` honours both halves                                        |
| 13  | **`YEAR_RESOLVED` matches by card id, not by index**                                                                                         | The priority jump makes resolver order and deck order diverge routinely; index matching would corrupt the deck the first time it did                                                                                                     |
| 14  | **The saved deck is readable in devtools, and that is accepted**                                                                             | The same exposure the in-memory deck already has, so obfuscation buys nothing real. Written down rather than left to be discovered, per the 2026-08-04 "leaks nothing is a property of the whole app" finding                            |
| 15  | **Shuffle first, then request years.** `START` shuffles synchronously; the resolver is only ever handed an already-shuffled deck, and "card 1" always means the first card of the **shuffled** deck | `plan.md` §3 spends a paragraph on this because the two are easy to get backwards. Resolve-then-shuffle would spend the first (and slowest) request on a track that then lands somewhere random in the deck, leaving the actual card 1 unresolved and Start blocked on a lookup that already finished for a card nobody is looking at. The shuffle is pure and instant, so there is no reason to defer it |

---

## Open Questions

- [ ] **What does Phase 6 show while `preparing`?** A count-only progress line is safe; anything naming
      a track or a year is the spoiler surface the 2026-08-04 finding rules out. Phase 3 only has to
      expose `status` and `resolvedCount` — the wording is Phase 6's call
- [ ] **What is the real wall clock for a cold 50-track deck?** Owed from Phase 2, unmeasurable through
      `vercel dev`, and it decides whether the crawl genuinely stays ahead of ordinary play or whether
      the priority jump fires constantly. Answer it during the verification step
- [ ] **How often does the relaxed tier actually fire on an ordinary playlist?** Phase 2 measured 14/14
      strict on a set curated for difficulty and flagged the real ratio as unknown. Phase 3 is the first
      time whole real playlists get resolved, so it is the first chance to find out
- [ ] **Should a resumed session re-attempt cards that settled at `none`?** MusicBrainz data does
      improve, and the server caches negatives with a short TTL — but re-attempting spends global budget
      on lookups already known to fail. Defaulting to "no" unless the measurements above suggest
      otherwise
- [ ] **Two tabs, one saved session.** Both write the same `localStorage` key and the last write wins,
      silently clobbering the other game. Rare enough to accept for v1; worth a `storage`-event guard if
      it ever bites

---

## Out of Scope

- **All rendering.** The card component, the CSS 3D flip, the QR code and the audio element are Phase 4;
  the landing page, suggested playlists, the loading screen, the HUD and the end screen are Phase 6
- **Gestures.** Swipe, tap-vs-drag disambiguation and keyboard controls are Phase 5. Phase 3 exposes
  `flip` and `next` as callbacks and nothing more
- **The `/api/playlist` client.** Fetching a playlist belongs with the landing screen that collects the
  URL (Phase 6). `START` takes an already-fetched `Card[]`, and resume replays the persisted deck, so
  nothing in this phase needs it
- **The `truncated` and `skippedCount` notices.** Phase 6, per `plan.md` §5
- **Unconfirmed-year marking and any year-correction affordance.** Phase 6, on the revealed side only
- **jsdom, Testing Library, and any component test.** Phase 4
- **The shareable deck URL** (`plan.md` §5 Phase 8). This plan only keeps the door open by accepting an
  optional seed on `START`
- **Pagination past the 100-track embed cap**, and any manual-paste fallback. Deferred past v1 by the
  Phase 0 track-source decision
