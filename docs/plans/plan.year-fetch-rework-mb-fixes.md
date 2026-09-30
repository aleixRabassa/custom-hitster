<!-- Plans for year-fetch-rework (in order):
  1. plan.year-fetch-rework-mb-fixes.md  — licence-clean MusicBrainz fixes: the cleaner bug, new cleaner families, no silent degradation, the tokenised rescue rung  ← this file
  2. plan.year-fetch-rework-server.md    — the provider vote in shared/, the Deezer/iTunes adapters, per-provider gates and cache, /api/year stages
  3. plan.year-fetch-rework-game.md      — the game layer: provisional years, keepYearless, the two-lane resolver, persistence, the PDF gate
  4. plan.year-fetch-rework-ui.md        — the reveal's year slot, the picker checkbox and its remembered preference, copy in three languages, the blank PDF year
-->

# Plan: year-fetch-rework — 1. MusicBrainz fixes that need no decision

> **Source:** [`docs/spikes/spike.year-fetch-rework.md`](../spikes/spike.year-fetch-rework.md) §3, §8 (P1, P2, P6), §10.6, §13.6
> **Date:** 2026-09-30
> **Author:** aleix.rabassa
> **Depends on:** nothing. Plan 2 depends on this one only **softly** (see the Dependency Contract).

---

## Overview

The spike found four improvements to the existing MusicBrainz pipeline that need no licence decision,
no new provider and no client change. Together they took the 542-track sample from 115 to 108
yearless cards (§10.6).

- **P1:** a real defect in `cleanTrackTitle`. `TRAILING_SEGMENT_PATTERN` has a lazy head, so a title
  with two bracketed tails (`X (REMIX) (feat. Y)`) is read as one unclassifiable segment and left
  unchanged.
- **P2:** the cleaner lacks several families that occur in real Latin, urban and Catalan titles.
- **P6:** a failed release-group request silently degrades a would-be `high` answer to the relaxed
  rungs, which is a precision leak.
- **The `tokenised` rescue rung:** the most productive query rewrite measured.

This plan lands first because it is independent, small and measurable on its own. It also owns the
year-cache version bump, so plan 2 can leave the MusicBrainz cache entries untouched.

---

## Dependency Contract

### Requires

Nothing.

### Produces for downstream plans

| Output                                                                                          | Consumed by                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `YEAR_CACHE_SCHEMA_VERSION` = `v5` in `shared/year.ts`                                          | plan 2: its MusicBrainz provider wraps `resolveYear` and keeps whatever version this plan leaves. **Plan 2 must not bump it again**                    |
| The corrected `cleanTrackTitle` and its new families                                            | plan 2: the store adapters and `shared/store-match.ts` compare titles through `cleanTrackTitle`, so their verification benefits from the same cleaning |
| `upstream-unavailable` returned by the MusicBrainz adapter when the release-group request fails | plan 2: the MusicBrainz provider wrapper maps it to a transient provider failure, never to a null answer                                               |

If plan 2 lands first by accident, nothing breaks. This plan's bump then simply happens later.

---

## Scope & Affected Areas

| Area                                            | Type     | Notes                                                                                                                                           |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/year.ts`                                | Modified | `TRAILING_SEGMENT_PATTERN` (≈ line 54) and its two callers, `cleanTrackTitle` and `stripRemixSuffix`; new families; `YEAR_CACHE_SCHEMA_VERSION` |
| `shared/types.ts`                               | Modified | Only if a new `TitleStripFlags` member turns out to be needed. The recommendation maps every new family to an existing flag                     |
| `shared/year.test.ts`                           | Modified | P1 and P2 cases, the negatives, and the literal `'mbyear:v4:'` check (≈ line 278)                                                               |
| `api/_lib/musicbrainz.ts`                       | Modified | The tokenised rung at the end of `buildAttempts`; P6 at the release-group failure branch; the result reports which rung matched                 |
| `api/_lib/musicbrainz.test.ts`                  | Modified | P6 tests and tokenised query-shape tests; the `stubFetch` helper learns to tell requests apart by query text                                    |
| `api/_lib/resolve-year.ts`                      | Modified | The remix fallback re-runs `cleanTrackTitle` on the stripped title; a tokenised hit is capped at `low`                                          |
| `api/_lib/resolve-year.test.ts`                 | Modified | The confidence cap and the remix re-clean                                                                                                       |
| `api/_lib/__fixtures__/musicbrainz-payloads.ts` | Modified | One live-captured tokenised case, with a provenance header                                                                                      |

---

## Chosen Approach

Every change stays inside the existing MusicBrainz pipeline, and each is shaped so that a card which
resolves today resolves **identically**:

- **P1: rewrite the regex.** The head becomes greedy and each inner alternative becomes bracket-free,
  so the last segment is examined first. When that last segment is unrecognised, `cleanTrackTitle`
  retries with the old lazy pattern, so the cleaner never strips **less** than today. Fixing one
  constant also repairs `stripRemixSuffix`, which today turns `A - B - Remix` into `A`.
- **The tokenised query becomes the last rung of `buildAttempts`.** The rung loop stops at the first
  rung that returns recordings, so the new rung fires only on a total miss, and a first-try card still
  costs exactly two MusicBrainz requests. A tokenised hit is capped at `low`, the developer's decision.
- **P6 reuses the existing `upstream-unavailable` code**, which every downstream layer already handles,
  instead of degrading silently.
- **The cache goes to `v5`.** By the module's own rule this is required rather than strictly necessary.

The alternatives were rejected for these reasons:

- A bracket scanner for P1 would have to re-create the "spaced dash only" rule and be threaded into
  two call sites.
- A second full lookup for the tokenised query would re-run rungs that had already failed, and costs
  2–4 requests.
- A new error code for P6 would widen three tables with no change in behaviour.

---

## Implementation Steps

- [ ] **Step 1: fix the lazy head (P1).** In `shared/year.ts`:
  - [ ] Rewrite `TRAILING_SEGMENT_PATTERN` so the head is greedy and no inner alternative can contain an
        opening or closing bracket. The last trailing segment is then matched first. Keep the "spaced
        dash only" rule that the comment above the constant describes.
  - [ ] In `cleanTrackTitle`, loop from the last segment inward. If the last segment is unrecognised,
        retry once with the previous (lazy) pattern kept as a private constant, so the result is never
        a longer title than today's. Document the two cases that need the fallback:
    - `Song - Live at Wembley - 1986`: the last segment `1986` is unrecognised;
    - nested brackets such as `(From "Movie (Part 2)")`.
  - [ ] `stripRemixSuffix` uses the new pattern with no fallback. Its test pins that `A - B - Remix`
        now strips to `A - B`.
  - [ ] Rewrite the constant's comment: the lazy head was the bug, and the fallback is why the fix
        cannot regress.
- [ ] **Step 2: re-clean after the remix strip.** In `api/_lib/resolve-year.ts`'s remix fallback,
      pass the stripped title through `cleanTrackTitle` again before querying. `Tumbando el Club (feat. …) - Remix`
      otherwise keeps its `(feat. …)` after `- Remix` is removed.
- [ ] **Step 3: extend the cleaner (P2).** Add the families from spike §3.2 and §8, each mapped to an
      existing `TitleStripFlags` member:
  - [ ] under `version`: `Sped Up`, `Slowed` (with or without `+ Reverb`), `prod.` / `prod. by` tails;
  - [ ] under `version`: an unquoted `from …` tail **only** when it carries a hint word (film, movie,
        soundtrack, album, película, pel·lícula, BSO), and the `Original song from the film …` shape;
  - [ ] under `feature`: Spanish `con` and Catalan `amb` featuring tails, **only** in the spaced-dash
        or bracketed form (`Sangría - con WOS`), never as a bare word inside a title;
  - [ ] under `version`, as insurance: the Spanish and Catalan edition words (`En Vivo`, `En Directe`,
        `Remasterizado`, `Remasteritzat`, `Versión …`, `Versió …`, `Acústico`, `Acústic`).
  - [ ] **The soundtrack tails of spike §13.6** (2026-09-30). The developer ruled that a card shows
        the **recording's** year (§13.9), so a soundtrack title has to find its own recording, and
        these tails stop it doing so. All 22 measured titles are MusicBrainz misses today:
    - under `version`: the Spanish film tail, a spaced dash plus `de` / `del` plus a **quoted** film
      name, optionally followed by `/Banda Sonora Original`. Measured on 9 titles, for example
      `Bella - de "La Bella y La Bestia"/Banda Sonora Original`. It fires only with the quotes or the
      `Banda Sonora` words, never on a bare `- de …`;
    - under `version`: doubled apostrophes used as quotes in a `from` tail
      (`From Walt Disney's ''Mary Poppins''`, `From Disney's ''Tangled''`). Measured on 2 titles;
    - under `version`: `Soundtrack Version`, `LP Soundtrack Version from …`, `Re-Recorded`, and a
      remaster tail that carries more words (`2007 Remastered Version Saturday Night Fever`).
      Measured on 5 titles;
    - under `version`: `Love Theme from "…"` after a spaced dash (`Take My Breath Away - Love Theme
from "Top Gun"`).
    - **Not** proposed: a bare film name after a dash (`You Sexy Thing - Full Monty`). Nothing marks
      it as a tail, and stripping it would eat real titles.
    - What these recover is **unmeasured**: the spike did not re-run its §3.3 variants on these
      titles. Step 8 measures it.
  - [ ] Each family's comment says that it is insurance or cites the measured example.
- [ ] **Step 4: add the tokenised rung.** In `api/_lib/musicbrainz.ts`:
  - [ ] Append one attempt to `buildAttempts` that queries `recording:(…)` as an AND of the cleaned
        title's words, keeping the same artist clause as the other rungs.
  - [ ] Quote every word, so query operators (`(`, `)`, `?`, `!`, `-`, `/`) and title words that are
        Lucene keywords (AND, OR, NOT) are literals.
  - [ ] Skip the rung when fewer than two words remain.
  - [ ] Before choosing whether the rung carries the `dur:` bound, re-run the six tracks the spike
        recovered (§3.3) with a scratch harness at 1 req/s, **never against Upstash**. Record the
        result in the rung's comment.
  - [ ] The adapter's result records which attempt matched, as a small tagged field, so the scoring
        layer can decide the cap without the adapter making a scoring decision (the module header
        forbids that).
  - [ ] In `resolve-year.ts`, cap a result that came from the tokenised attempt at `low`, next to the
        existing rewritten-title cap, and name the loose-artist fallback as the precedent.
  - [ ] **The remix fallback re-enters `fetchYearCandidates`**, so a remix-titled card that misses both
        ways runs the tokenised query twice, which is up to two extra recording requests. That is
        **accepted**: it only happens on a double total miss, which is rare and already the most
        expensive path. Record it in the fallback's comment. Do not add a flag to suppress it.
- [ ] **Step 5: stop degrading silently (P6).** In `api/_lib/musicbrainz.ts`:
  - [ ] Where the release-group request fails (≈ lines 255–258), return the failed result as
        `upstream-unavailable` (or `unexpected-payload` for a non-JSON 200) instead of falling back to
        the relaxed rungs.
  - [ ] Treat the "gate busy before the release-group request" branch (≈ lines 246–252) the same way,
        returning `upstream-unavailable` and **not** `rate-limited`. The client treats a 429 as free,
        and would spend request 1 again in a loop.
  - [ ] Keep the single 503 retry after 1.2 s in `getJson` unchanged.
  - [ ] Nothing new reaches the cache: `resolve-year.ts` already skips caching failures. Confirm this
        with a test, not by reading the code.
  - [ ] The remix fallback still swallows its own errors. Leave that as is and record it in its
        comment: a release-group failure inside the fallback still caches a one-day null.
- [ ] **Step 6: bump the cache version.** Set `YEAR_CACHE_SCHEMA_VERSION` to `v5`.
  - [ ] Add a paragraph to the history comment above it: P1 and P2 change the cache key for the titles
        they affect, the tokenised rung turns cached nulls into years, and P6 removes degraded `low`
        entries. Each would wash out within 7 days, and the bump is made by the unconditional rule, as
        v2 and v4 were.
  - [ ] Update the literal prefix check in `shared/year.test.ts`.
- [ ] **Step 7: capture the tokenised fixture live.** Using the adapter's exact requests, capture one
      real §3.2 track that only the tokenised rung finds (for example `Olvidarnos De To' :)`). Capture
      the empty phrase-rung responses, the tokenised response and its release-group response, and
      trim them without inventing anything. Add a provenance header in the file's existing style,
      recording the User-Agent actually used.
- [ ] **Step 8: live acceptance diff.** P2 changes the **first** query for every track it touches, not
      just for misses. With a scratch harness, re-run the tracks in
      `docs/spikes/spike.year-fetch-rework.data.csv` **and**
      `docs/spikes/spike.year-fetch-rework.soundtracks.csv` whose cleaned title changes under the new
      cleaner (in one process at 1 req/s, with an in-memory cache).
  - [ ] Diff their answers against the CSVs' MusicBrainz columns. For the soundtrack tracks, also
        check the answer against `label_year` where `label_kind` is `original` or `predates`. Those
        are the only labels that are ground truth under the recording-year rule.
  - [ ] Any answer that moves, as opposed to a null that turns into a year, is investigated before
        merging.
  - [ ] Record the counts in `docs/agent_findings.md`.
- [ ] **Step 9: run the four checks:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## Unit Tests

- [ ] `should strip both tails from a title with a bracketed remix and a bracketed featuring`: P1 in `cleanTrackTitle` (`shared/year.test.ts`).
- [ ] `should strip the last recognised segment first`: the new pattern's order, one case per existing family.
- [ ] `should never strip less than the previous pattern`: `Song - Live at Wembley - 1986` and `(From "Movie (Part 2)")` give today's result via the fallback.
- [ ] `should strip only the remix tail from a title with two spaced dashes`: `stripRemixSuffix("A - B - Remix")` gives `A - B`.
- [ ] One positive test per new P2 family: `Sped Up`, `Slowed + Reverb`, `prod.`, hinted unquoted `from`, `Original song from the film`, `con`, `amb`, each edition word.
- [ ] One negative test per new P2 family: `Con Calma` keeps its words, `from` without a hint word is kept, `con` inside a title is kept, and `Slow` is not `Slowed`.
- [ ] The soundtrack tails: one positive test per measured shape of spike §13.6 (the Spanish `- de "…"/Banda Sonora Original` tail, doubled-apostrophe quotes, `Soundtrack Version`, `LP Soundtrack Version from …`, `Re-Recorded`, a remaster tail with more words, `Love Theme from "…"`), and the negatives: an unquoted `- de …` without `Banda Sonora` is kept, and `You Sexy Thing - Full Monty` is kept.
- [ ] `should set the expected strip flag for each new family`: `TitleStripFlags` mapping.
- [ ] `should re-clean the title after stripping a remix tail`: remix fallback in `resolve-year.test.ts`.
- [ ] `should append the tokenised attempt last and only once` and `should quote every token and skip the rung under two tokens`: `buildAttempts` (`musicbrainz.test.ts`).
- [ ] `should not issue the tokenised request when an earlier rung returned recordings`: the request count for a first-try card stays exactly two.
- [ ] `should cap a tokenised hit at low`: `resolve-year.test.ts`.
- [ ] `should resolve the captured tokenised track`: end to end over the live-captured fixture, asserting the year.
- [ ] `should return upstream-unavailable when the release-group request fails` and `should return upstream-unavailable when the gate is busy before the release-group request`: P6, over the real captured No Woman No Cry payloads with `stubFetch`'s `statuses` option. This replaces the assertion at ≈ `musicbrainz.test.ts:411` that the busy path degrades.
- [ ] `should not cache a result when the release-group request fails`: `resolve-year.test.ts`.
- [ ] `should key the cache under v5`: the updated literal check.
- [ ] The 22 accuracy fixtures in `shared/__fixtures__/year-candidates.ts` pass **unchanged**. That is the regression guard, and no fixture is re-captured for it.

---

## Documentation Updates

- [ ] `AGENTS.md`: change `YEAR_CACHE_SCHEMA_VERSION` is `v4` (the tier-ladder block) to `v5`. Add a
      short note that the cleaner examines the **last** trailing segment first, with a fallback so it
      never strips less, and that a tokenised hit is capped at `low` beside the loose-artist cap.
- [ ] `AGENTS.md` Documentation Index:
  - [ ] add four rows, one per `plan.year-fetch-rework-*.md`, in the table's style;
  - [ ] change the spike's row from "nothing built" to point at the four plans;
  - [ ] when each plan is built, mark its own row **Built** with the date. Plans 2–4 each carry the
        same item for their row;
  - [ ] add a pointer to these plans beside the "Current phase: 8, CODE COMPLETE" sentence.
- [ ] `docs/architecture.md` §3 (year resolution): the rung list gains the tokenised rung, and P6
      means a failed release-group request is a transient error.
- [ ] `docs/api.md`: `/api/year` may now return `upstream-unavailable` where it used to return a
      degraded `low`.
- [ ] `docs/agent_findings.md`: a dated entry (2026-09-30 or the build date) with the lazy-head
      finding, the `stripRemixSuffix` side effect, the step 8 diff counts and the tokenised `dur:`
      measurement.
- [ ] `docs/spikes/spike.year-fetch-rework.md`: a status line under §8 saying that P1, P2, P6 and the
      tokenised rung are built, linking to this plan. The spike's measurements stay unchanged.
- [ ] Inline comments: `TRAILING_SEGMENT_PATTERN`, each new family, `buildAttempts`' rung list, the
      P6 branches and the cache-version history, as listed in the steps.

---

## Testing Strategy

- **Unit tests:** the cleaner, the rung list and the P6 branches are all testable in the node
  environment with the existing `stubFetch` over real captured payloads.
- **Integration tests:** the one end-to-end tokenised case over a live capture.
- **Manual verification:** step 8's live diff is the acceptance check, because P2 changes queries for
  tracks that resolve today and the 22 fixtures cannot see that.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                    | Rationale                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | These four fixes are a separate plan that lands first                                                    | Developer's choice (2026-09-30). They need no decision, and the spike's §12.3 replay excluded them                                                                                                         |
| 2   | P1: a regex rewrite plus a lazy-pattern fallback, rather than a bracket scanner                          | One constant fixes both callers. The fallback makes "never strips less than today" hold by construction. The existing tests cannot tell the old and new behaviour apart, so the fallback is the safety net |
| 3   | The tokenised query is the last rung of `buildAttempts`, not a second lookup                             | It fires only on a total miss, keeps first-try cards at two requests, and costs one extra request                                                                                                          |
| 4   | A tokenised hit is capped at `low`                                                                       | Developer's choice. A looser query is weaker evidence, and under plan 2 a second provider can still confirm it                                                                                             |
| 5   | P6 reuses `upstream-unavailable`                                                                         | Its docstring already covers the case, and the server, client and resolver already retry it                                                                                                                |
| 6   | The busy-gate-before-request-2 branch is also P6, and returns `upstream-unavailable`, not `rate-limited` | A 429 is free to the resolver, so it would re-spend request 1 in a loop                                                                                                                                    |
| 7   | Cache bump to `v5` in this plan                                                                          | By the unconditional rule. Plan 2 then keeps the MusicBrainz entries it inherits                                                                                                                           |
| 8   | New P2 families map to existing `feature` / `version` flags                                              | No type change, and nothing reads the flags at finer granularity                                                                                                                                           |

---

## Open Questions

- [ ] Does the tokenised rung carry the `dur:` bound? The spike does not say. Step 4 measures it on
      the six recovered tracks before choosing.
- [ ] Does step 8's diff move any answer that resolved today? If it does, is the new answer better?
      Decide per case before merging.

---

## Out of Scope

- Any new provider, the vote, `/api/year` stages and every client change (plans 2–4).
- The `inner-paren`, `title-only` and `fuzzy` rewrites, which the spike measured and did not propose.
- The `isrc:` rung. It needs Deezer's ISRC, which belongs to plan 2, and the spike found it dead under
  the licence constraint.
- Making the remix fallback propagate its own errors.
- Work-level resolution for Personal Jesus.
