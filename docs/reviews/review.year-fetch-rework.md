# Review: year-fetch-rework

**Plan:** four parts, built in order —
[mb-fixes](../plans/plan.year-fetch-rework-mb-fixes.md) ·
[server](../plans/plan.year-fetch-rework-server.md) ·
[game](../plans/plan.year-fetch-rework-game.md) ·
[ui](../plans/plan.year-fetch-rework-ui.md)
**Last run:** 2026-10-01 — mode: `branch` (`year-fetch-rework` vs `origin/develop`, 12 commits, merge-base `b6d3286`, plus the uncommitted `--fix` changes)
**PR:** not created yet

---

## Summary

The implementation covers every ticked Implementation Step in all four plans. Nothing out of scope
slipped in: there is no Discogs, `finalWhenCertain` is off for all three providers, there is no
`isrc:` rung, no loading-screen line, no PDF write-in guide, no option carried in the link, and no
visual asset was touched. The tokenised rung's removal and the query-ladder reorder (2026-10-01) are
recorded later decisions, not deviations.

The first pass found one Blocker (B1): a non-final staged answer was edge-cacheable, so the client's
retries of `verify` got the cached body, and a short outage could settle and drop a card. `--fix`
corrected it, together with every Warning and most Suggestions, over three review passes. Three
fixes needed the developer's ruling and **change two plans' text**:

- W2/W4 change plan 2 step 10. A busy provider beside an answer on `resolve` is now a non-final 200
  that carries `retryAfterMs`, not a 429.
- S1 reverses plan 3 step 4. An exhausted resolve now goes to verify instead of settling null.
- W1 keeps plan 2's design and corrects the docs instead.

**Busy versus refused, decided after the review** (the developer: "no cap while busy; if the IP is
refused, stop"). Only our own gate being full is busy, and it is retried with no limit. A provider
refusing us itself (an iTunes 403/429, a Deezer quota error or 429) is now a skip: that provider is
left out of the call and the vote decides without it, so a card can no longer wait for ever on a
provider that has shut us out.

The preview smoke tests are unticked: server step 15, game step 11 and ui step 10. They are manual and
already listed in `AGENTS.md`.

## Changed Files

| File                                                                                                | Status | Notes                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `api/_lib/cache.ts`                                                                                 | OK     | B1 (`transient` → `no-store`), W3 (no write without a duration); S3 justified                                     |
| `api/_lib/year-pipeline.ts`                                                                         | OK     | B1 `transient`, W2/W4 busy-resolve decides with `retryAfterMs`, S2 plan threaded, S7 labelled break; S6 justified |
| `api/year.ts`                                                                                       | OK     | B1: `stagedCacheControl(0)` is `no-store`                                                                         |
| `api/_lib/deezer.ts`, `api/_lib/itunes.ts`                                                          | OK     | W6: no permit and no fetch when the lookup has no duration; S10 justified                                         |
| `shared/year-providers.ts`                                                                          | OK     | S2: `findConfirmation` / `decideYear` take the plan                                                               |
| `shared/types.ts`                                                                                   | OK     | W4: optional `YearLookupResult.retryAfterMs`                                                                      |
| `src/game/year-client.ts`                                                                           | OK     | W4: passes `retryAfterMs` through, drops junk                                                                     |
| `src/game/resolver.ts`                                                                              | OK     | S1 hand-off to verify, W4 sleep after a busy 200, W1/W5/W8 header, S13 comment                                    |
| `src/game/use-game-session.ts`                                                                      | OK     | S4 field removed; W7 guarded session storage                                                                      |
| `src/game/browser-storage.ts` (new, + test)                                                         | OK     | S5: the one `readLocalStorage` guard                                                                              |
| `src/App.tsx`, `src/components/LocaleProvider.tsx`, `src/components/ErrorBoundary.tsx`              | OK     | S5/W7: all go through the guard; S11 justified                                                                    |
| `src/App.test.tsx`                                                                                  | OK     | A flaky `waitFor` on the saved session; a throwing-getter test (W7)                                               |
| Every other file of the branch diff                                                                 | OK     | No finding                                                                                                        |
| `AGENTS.md`, `docs/api.md`, `docs/architecture.md`, `docs/development.md`, `docs/agent_findings.md` | OK     | Updated for every behaviour change above; new dated finding (B1)                                                  |

## Plan Completeness

| Implementation Step                                                                                                                                   | Status                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| mb-fixes 1–3: lazy-head fix, re-clean after the remix strip, P2 and soundtrack families                                                               | Done                                                                  |
| mb-fixes 4: tokenised rung                                                                                                                            | Done, then removed 2026-10-01 by a recorded decision (cache `v6`)     |
| mb-fixes 5–9: P6, cache bump, fixture, live diff, checks                                                                                              | Done                                                                  |
| server 1–14: types, helpers, planner/vote, store-match, contract, adapters, MB provider, gates, cache, driver, endpoint, fixtures/replay, env, checks | Done (step 10's busy rule amended by W2/W4, developer's ruling)       |
| server 15: preview smoke test                                                                                                                         | Missing (manual, outstanding by design)                               |
| game 1–10: types, reducer, year client, two-lane resolver, hook, persistence, PDF selector, container, comments, checks                               | Done (step 4's deferred-pass rule reversed by S1, developer's ruling) |
| game 11: preview smoke test                                                                                                                           | Missing (manual, outstanding by design)                               |
| ui 1–9: copy, year slot, prefs, checkbox, container, threading, blank PDF year, leak proxies, CSS grep, checks                                        | Done                                                                  |
| ui 10: preview deployment                                                                                                                             | Missing (manual, outstanding by design)                               |

## Issues Found

### Blockers

| ID  | File:Line             | Issue                                                                                                                                                                                                                                                                                                                     | State |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| B1  | api/_lib/cache.ts:206 | A non-final staged 200 got `public, s-maxage=60, stale-while-revalidate=60`. The verify lane retries a non-final answer on the same URL after ~0.5 s and ~1 s, so every retry got the edge copy and the card was settled exhausted: a final null that drops it with the option OFF, or a provisional year frozen at `low` | Fixed |

### Warnings

| ID  | File:Line                     | Issue                                                                                                                                                                                    | State                                                                                |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| W1  | api/_lib/year-pipeline.ts:137 | `verify` re-runs `resolve`'s frontiers. With no `mbyear:` entry, one client holds two MusicBrainz lookups, against `resolver.ts`'s header (developer: keep the design, correct the docs) | Fixed                                                                                |
| W2  | api/_lib/year-pipeline.ts:237 | One busy provider in the parallel frontier made a `resolve` that already had Deezer's year a 429 (developer: decide, non-final)                                                          | Fixed                                                                                |
| W3  | api/_lib/cache.ts:442         | A lookup with no `durationMs` cached a store null for a day under a key with no duration, which was then served to cards that have one                                                   | Fixed                                                                                |
| W4  | api/_lib/year-pipeline.ts:270 | (pass 2) W2 dropped `retryAfterMs`, so the resolve lane stopped backing off on a full MusicBrainz gate (developer: carry `retryAfterMs` on the 200)                                      | Fixed                                                                                |
| W5  | src/game/resolver.ts:29       | (pass 2) The W1 wording left out "MusicBrainz busy during resolve", the case W2 makes common                                                                                             | Fixed                                                                                |
| W6  | api/_lib/cache.ts:500         | (pass 2) After W3 the adapters still spent a Deezer search and an iTunes slot on a null known in advance                                                                                 | Fixed                                                                                |
| W7  | src/App.tsx:356               | (pass 2) S5 left two bare `localStorage` reads on the first render (`App` library storage, `useGameSession`), so a throwing getter still crashed every reload                            | Fixed                                                                                |
| W8  | src/game/resolver.ts:43       | (pass 3) The new docs claimed the verify re-ask is "the one lookup waiting" while resolve sleeps. Both lanes usually sleep about as long, so they can wake together                      | Fixed (claim corrected in the code comments, `AGENTS.md` and `docs/architecture.md`) |

### Suggestions

| ID  | File:Line                        | Issue                                                                                                            | State                                                          |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| S1  | src/game/resolver.ts:497         | An exhausted resolve settled a final null without trying `verify` (developer: hand off to verify)                | Fixed                                                          |
| S2  | shared/year-providers.ts:234     | `planRank` read the shipped plan, not the plan in use                                                            | Fixed                                                          |
| S3  | api/_lib/cache.ts:207            | `stagedEdgeMaxAgeSeconds` uses full TTL constants, not each entry's remaining TTL                                | Justified                                                      |
| S4  | src/game/use-game-session.ts:273 | `isCurrentYearPending` exposed with no consumer                                                                  | Fixed                                                          |
| S5  | src/App.tsx:168                  | A third hand-copied `readLocalStorage`                                                                           | Fixed                                                          |
| S6  | api/_lib/year-pipeline.ts:317    | (pass 2) `sourceTtlsSeconds` counts the 1-day null TTL of a duration-less store answer that is no longer written | Justified                                                      |
| S7  | api/_lib/year-pipeline.ts:219    | (pass 2) Dead `if (sawBusy) break;`                                                                              | Fixed                                                          |
| S8  | src/game/reducer.ts:619          | (pass 2) `isCurrentYearPending` has no production caller, and the docs read as if one does                       | Fixed (docs note; the selector is kept, as plan 3 step 2 says) |
| S9  | src/game/resolver.test.ts:848    | (pass 2) The "urgent" hand-off test never called `prioritize()`                                                  | Fixed                                                          |
| S10 | api/_lib/deezer.ts:256           | (pass 3) "No duration means nothing verifies" is restated in `deezer.ts`, `itunes.ts` and `cache.ts`             | Justified                                                      |
| S11 | src/App.tsx:359                  | (pass 3) `storage ?? readLocalStorage()` is derived three times on the first-render path                         | Justified                                                      |
| S12 | AGENTS.md:686                    | (pass 3) The two-lane bullet named only the 429 as a back-off trigger                                            | Fixed                                                          |
| S13 | docs/development.md:972          | (pass 3) "500 → 1000 → 2000 ms": with three attempts a pass, 2000 never happens                                  | Fixed (and in `resolver.ts`'s comment)                         |

## Justifications

| ID  | Justification (developer)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Ack required |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| S3  | [task-review --fix] Out of scope: bounding the edge by each entry's REMAINING TTL needs a per-key TTL read (an extra Redis round trip per call, or `PTTL` beside the `MGET`), which no plan asks for. Plan 2 step 11 says "the shortest TTL among the cache entries", the constants implement that, and a deploy purges Vercel's edge, which bounds the drift.                                                                                                                                                | No           |
| S6  | [task-review --fix] Not fixed, deliberately: the 1-day bound is the same as the null would have had in Redis before W3, and for a URL without `durationMs` both stores now answer null with no request, so the vote is reproducible for that URL. The only drift is a duration-bearing lookup later caching a store year that the duration-less URL could borrow, delayed by at most a day. Excluding the TTL would let the edge hold such a vote for 30 days on the MusicBrainz entry alone, which is worse. | No           |
| S10 | [task-review --fix] Not fixed: a cleanup beyond the plan. Both adapter comments name `store-match.ts`'s rule and say they go with it. Moving the short-circuit into `withAnswerCache` would make it depend on the wrapper being applied, and the adapters' own tests pin the no-request behaviour. Worth doing if `store-match` ever changes that rule.                                                                                                                                                       | No           |
| S11 | [task-review --fix] Not fixed: a cleanup beyond the plan. All three copies go through the one guard, so the defect W7 fixed cannot come back from them, and `App.test.tsx` renders with a throwing getter. The per-render call reads one property inside a try/catch.                                                                                                                                                                                                                                         | No           |

## Out-of-Scope Changes

None detected. The `--fix` changes to plan 2 step 10 (W2/W4) and plan 3 step 4 (S1) were made on
the developer's rulings during this review. The docs record each reversal; the plan files have not
been annotated yet (task-review adds no steps or checkboxes to a plan, but a dated note is the
developer's call).

## Verdict

- [ ] Approved — matches the plan, no open blockers.
- [x] Approved with comments — warnings only.
- [ ] Changes requested — open blockers.

## History

| Date       | Mode   | Blockers | Warnings | Suggestions | Notes                                                                                                                                                                                                                        |
| ---------- | ------ | -------- | -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-01 | branch | 1        | 3        | 5           | First run. Developer's rulings before `--fix`: W1 keep the design and correct the docs; W2 a 200 non-final instead of 429; S1 hand off to verify                                                                             |
| 2026-10-01 | branch | 0        | 4        | 4           | Re-review of the pass-1 fixes (W4–W7, S6–S9). Developer's ruling: W4 carry `retryAfterMs` on the 200                                                                                                                         |
| 2026-10-01 | branch | 0        | 1        | 4           | Re-review of the pass-2 fixes (W8, S10–S13). Four checks green: 1480 tests and the build. The W8/S12/S13 fixes are documentation-only and were not re-reviewed. --fix: 18 fixed, 4 justified (22 findings over three passes) |
| 2026-10-01 | branch | 0        | 0        | 0           | Post-review developer decisions: a provider's own refusal is a skip (busy stays uncapped); dated notes added to plans 2 and 3. Four checks green: 1489 tests and the build                                                   |
