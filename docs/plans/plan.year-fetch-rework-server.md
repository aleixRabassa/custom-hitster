<!-- Plans for year-fetch-rework (in order):
  1. plan.year-fetch-rework-mb-fixes.md  — licence-clean MusicBrainz fixes: the cleaner bug, new cleaner families, no silent degradation, the tokenised rescue rung
  2. plan.year-fetch-rework-server.md    — the provider vote in shared/, the Deezer/iTunes adapters, per-provider gates and cache, /api/year stages  ← this file
  3. plan.year-fetch-rework-game.md      — the game layer: provisional years, keepYearless, the two-lane resolver, persistence, the PDF gate
  4. plan.year-fetch-rework-ui.md        — the reveal's year slot, the picker checkbox and its remembered preference, copy in three languages, the blank PDF year
-->

# Plan: year-fetch-rework — 2. Server: three providers, one vote, two stages

> **Source:** [`docs/spikes/spike.year-fetch-rework.md`](../spikes/spike.year-fetch-rework.md) §4.1, §11, §12, §13.9–13.12
> **Date:** 2026-09-30
> **Author:** aleix.rabassa
> **Depends on:** [plan.year-fetch-rework-mb-fixes.md](plan.year-fetch-rework-mb-fixes.md), **softly**. That plan owns the year-cache `v5` bump, and this plan must not bump the MusicBrainz key again.

---

## Overview

The developer settled on a provider order on 2026-09-30 (spike §12.1–12.2), and **removed Discogs
from it the same day** (spike §13.10–13.12):

- **Deezer**, for speed, asked **in parallel** with
- **MusicBrainz**, for coverage;
- then **iTunes**, for precision.

A year is **confirmed** once two independent providers agree on it, and no further provider is asked
for that song.

- **iTunes and Deezer count as two voters**, even though both carry the record label's metadata.
  Counting them as one was measured and rejected (§13.11): on the 542 it undid three corrections that
  §5.3 had verified by hand.
- **When MusicBrainz and Deezer agree, their year stands, and iTunes is never asked.** Measured on the
  24 of 804 cards where iTunes disagrees with that pair: the pair was right 11 times, iTunes 4 (§13.12).
- **When nobody agrees**, the card keeps one provider's year, marked unconfirmed and still shown, in
  this order: **MusicBrainz `high`, then iTunes, then MusicBrainz `low`, then Deezer** (only when its
  release-date year equals its ISRC year). iTunes goes before a `low` but never before a `high`
  (§13.12, accepted by the developer).
- **The year is the RECORDING's**, not the film's or the original song's (the developer's answer in
  §13.9). A cover's own year and a dub's own year are the right answers.

Replayed without Discogs over the 542 measured tracks (`drop-eval.ts`, spike §13.10), this takes cards
without a year from 115 to 5. The result is 474 confirmed, 63 unconfirmed and 342/343 exact against
the consensus.

This plan builds the server half:

- the pure vote and planner in `shared/`;
- the two store adapters;
- a gate and an answer cache per provider;
- `/api/year` split into a `resolve` stage and a `verify` stage.

It changes nothing in `src/` except the shared types.

**Starting point: nothing from spike §12.7 exists.** The server files that section lists as
"Written" (`shared/year-providers.ts`, `api/_lib/provider-lookup.ts`, `deezer.ts`, `itunes.ts`,
`discogs.ts`, and the edits to `rate-limit.ts` and `cache.ts`) are in no commit, stash, dangling
object or working tree. They were lost with an uncommitted working tree. **Everything below is new
work.** The only survivors are the earlier sessions' replay scripts (see step 12). This plan builds
**no Discogs adapter**: §12.7's `discogs.ts` is not rebuilt.

---

## Dependency Contract

### Requires from plan.year-fetch-rework-mb-fixes

| Output                                                          | Why                                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `YEAR_CACHE_SCHEMA_VERSION` = `v5`                              | This plan keeps the MusicBrainz cache key it finds. If plan 1 has not landed, it keeps `v4`, and that is equally valid |
| The corrected `cleanTrackTitle`                                 | Store-hit verification compares cleaned titles                                                                         |
| `upstream-unavailable` from a failed release-group request (P6) | The MusicBrainz provider maps it to a transient failure. Without P6 a degraded `low` would vote                        |

### Produces for downstream plans

| Output                                                                                                                                         | Consumed by                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `/api/year?stage=resolve\|verify`, and the stage-less legacy path unchanged                                                                    | plan 3, `src/game/year-client.ts`                             |
| `YearLookupResult` gains `final: boolean` (required), `agreedBy?` and `skipped?`; `YearSource` widened                                         | plan 3: the client's response check and the reducer's payload |
| 429 + `retryAfterMs` per stage (back-pressure from whichever gate was busy); 502 `upstream-unavailable` when every provider failed transiently | plan 3: the resolver's per-lane back-off                      |
| `YearStage` and `YearProviderId` in `shared/types.ts`                                                                                          | plan 3                                                        |

---

## Scope & Affected Areas

| Area                                                             | Type     | Notes                                                                                                                                                                         |
| ---------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/types.ts`                                                | Modified | `YearProviderId`, `YearStage`, `MusicBrainzYearSource`, widened `YearSource`, `YearLookupResult.final/agreedBy/skipped`, a provider answer value type                         |
| `shared/year.ts`                                                 | Modified | Export `compareDates`, `parseYear` and `isPlausibleYear`, which are private today. No scoring change and no version bump                                                      |
| `shared/year-providers.ts`                                       | **New**  | `YEAR_PROVIDER_PLAN`, `UNCONFIRMED_TRUST`, plan validity, voter years, `findConfirmation`, `decideYear`, `nextFrontier`, the Deezer signature, `isrcYear`, `providerCacheKey` |
| `shared/year-providers.test.ts`                                  | **New**  | The vote-engine suite                                                                                                                                                         |
| `shared/store-match.ts` (+ test)                                 | **New**  | Pure store-hit verification shared by the two store adapters                                                                                                                  |
| `shared/__fixtures__/year-votes.ts`                              | **New**  | One answer per provider for each of the 22 ground-truth tracks                                                                                                                |
| `api/_lib/provider-lookup.ts`                                    | **New**  | The `ProviderLookup` contract: input, and the outcomes answer / skipped / failed / busy                                                                                       |
| `api/_lib/deezer.ts`, `itunes.ts` (+ tests)                      | **New**  | Adapters with an injected `fetch` and gate                                                                                                                                    |
| `api/_lib/musicbrainz-provider.ts` (+ test)                      | **New**  | Wraps `resolveYear` whole as a `ProviderLookup`, without changing its behaviour                                                                                               |
| `api/_lib/__fixtures__/deezer-payloads.ts`, `itunes-payloads.ts` | **New**  | Live-captured, trimmed, with provenance headers                                                                                                                               |
| `api/_lib/year-pipeline.ts` (+ test)                             | **New**  | The thin driver: runs the frontiers `nextFrontier` returns, merges the outcomes, applies the cache                                                                            |
| `api/_lib/rate-limit.ts` (+ test)                                | Modified | Gates take a key, an interval and a maximum wait. `PROVIDER_GATES`. MusicBrainz defaults unchanged (`mbgate:v1`, 1.1 s)                                                       |
| `api/_lib/cache.ts` (+ test)                                     | Modified | The per-provider answer cache (`yearprov:<provider>:v1:`), a batched read, per-provider TTLs. The MusicBrainz year cache is untouched                                         |
| `api/year.ts` (+ test)                                           | Modified | The `stage` parameter, the legacy stage-less path, the registry, error mapping, edge `Cache-Control`                                                                          |
| `.env.example`                                                   | Modified | The Upstash comment; `MUSICBRAINZ_USER_AGENT` is now skippable with a warning. No new variable: neither store needs a key                                                     |

`api/` imports `shared/` by **relative path with an explicit `.js` extension** everywhere, never
through `@/`. `shared/` gains no DOM and no Node API.

---

## Chosen Approach

**A pure planner in `shared/`, a thin driver in `api/_lib/`, and one endpoint with two stages.**
Every provider answer is cached on its own, and the vote is recomputed on each call from a batched
cache read.

**The planner decides which providers to ask next.** `nextFrontier(plan, stage, answers)` returns the
set of providers to ask now, or "done". It uses three rules:

- with no usable answers and no `finalWhenCertain`, it asks the next **two** remaining providers of
  the stage;
- with one answer, it asks the next one;
- a provider with `finalWhenCertain` on is asked alone.

Deezer and MusicBrainz running in parallel therefore **falls out of the constant** instead of being
hand-wired. So does the sequential saving the spike measured if Deezer's switch is ever turned on,
and reordering stays a one-line edit.

**The driver is about 60 lines.** It runs each frontier, merges the outcomes, and maps busy, skipped
and failed providers.

**One `/api/year` with `stage=resolve|verify`.** `verify` reads `resolve`'s answers from the shared
cache, never from the client, so a client cannot poison the cache.

**Each provider's answer is cached separately.** Reordering the plan therefore invalidates nothing,
and the MusicBrainz entries already cached stay valid.

The alternatives were rejected for these reasons:

- **A generic sequential walker** cannot express the parallel pair.
- **A hand-coded pipeline** turns the plan constant into documentation that drifts from the code.
- **Caching the final vote (`yearfinal:`)** needs a bump on every plan change, and keeps a final
  reached while a provider was skipped for days.
- **Two handlers** cost a second cold start.
- **One do-everything call** withholds the provisional year that §12.5 was designed around.

**The developer's decision on unconfigured providers:** every provider is skippable, with a warning,
MusicBrainz included. The endpoint fails loudly only when **all** providers fail.

---

## Implementation Steps

- [x] **Step 1: shared types.** In `shared/types.ts`:
  - [x] Add `YearProviderId` (`deezer`, `musicbrainz`, `itunes`) and `YearStage`
        (`resolve`, `verify`).
  - [x] Rename today's `'release-group' | 'recording'` to `MusicBrainzYearSource` and keep it on
        `YearResult`, which is the cached MusicBrainz value and is otherwise unchanged. Widen
        `YearSource` to `MusicBrainzYearSource`, `deezer`, `itunes` or `vote`:
    - `vote` when two providers confirmed the year;
    - otherwise the provider whose year was kept.
  - [x] `YearLookupResult` gains:
    - `final: boolean`, required;
    - `agreedBy?`, a pair of provider ids, present only when confirmed;
    - `skipped?`, the provider ids skipped for configuration or failure, present only when non-empty.

    `cached` is redefined as "this call made no provider request". `confidence` keeps its three
    values:
    - `high` means final and confirmed;
    - a final unconfirmed answer is `low`;
    - a provisional answer is `low`, or `none` with no year.

    The client derives pending, provisional or dropped from `final`, never from `confidence`.

  - [x] Add a `ProviderAnswer` value type: provider id and year (or null). Deezer carries its
        release-date year and its ISRC year separately. MusicBrainz carries its tier confidence,
        `source` and `viaTitle`. Never widen `YearResult` for this.
- [x] **Step 2: export the date helpers.** Export `compareDates`, `parseYear` and `isPlausibleYear`
      from `shared/year.ts` rather than copying them into the new modules. Their comments say they
      are shared now.
- [x] **Step 3: the pure planner and vote, `shared/year-providers.ts`.**
  - [x] `YEAR_PROVIDER_PLAN`: an ordered list of steps (provider id, `phase` of fast / coverage /
        precision, HTTP `stage`, `finalWhenCertain` off for all three): Deezer and MusicBrainz in
        `resolve`, iTunes in `verify`.
  - [x] `UNCONFIRMED_TRUST`: the order in which a lone answer is kept when nobody agrees. Its entries
        are **tiers**, not providers, because MusicBrainz appears twice: `musicbrainz:high`, `itunes`,
        `musicbrainz:low`, `deezer`.
    - The header records why: iTunes before a `low` recovered A Whole New World (2014 → 1992) and
      The Time of My Life (2024 → 1987). iTunes before a `high` too was measured and rejected, because
      it made 6 known years worse (Killing In The Name 1992 → 2001, L'Empordà 1989 → 2010, three dubs
      moved to compilation dates…) against 2–3 better (spike §13.12).
    - The header also says that reordering, adding or removing a provider is an edit to these two
      constants plus a registry entry, and nothing else. Re-adding Discogs is such an edit plus its
      adapter; its measured cost and benefit are in spike §13.10.
  - [x] `validatePlan`: each provider appears exactly once in the steps; each tier in the trust order
        names a provider of the plan, and every provider has at least one tier; and every `resolve`
        step comes before every `verify` step. It runs as a test, never at runtime.
  - [x] `voterYears(answer)`: the years one provider contributes. Deezer's two dates are **one** voter.
        iTunes and Deezer are **two** voters (spike §13.11). Say so in the comment, with the rejected
        alternative and its measured cost, so nobody "fixes" it back.
  - [x] `findConfirmation(answers)`: the earliest year on which two **different** providers agree, and
        which two they were.
  - [x] `decideYear(answers, plan)`:
    - a confirmed year gives `high`, final, source `vote`;
    - otherwise the first answer in `UNCONFIRMED_TRUST` gives `low`, where a lone Deezer counts only
      when its release-date year equals its ISRC year;
    - otherwise no year.

    It does not decide finality. The driver does, from whether any provider is left to ask.

  - [x] `deezerRecentSignature(answer, rawTitle)`: release-date year equals ISRC year, the year is at
        least 2015, and the raw Spotify title has no remaster or live suffix (`La Grange - 2005 Remaster`
        must not fire). Only `finalWhenCertain` reads it, and that switch is off, so it is dormant but
        tested.
  - [x] `isrcYear(isrc)`: characters 6–7 as a year. Two-digit pivot: a value at or below the current
        two-digit year plus one reads as 20xx, otherwise 19xx. A malformed ISRC gives null.
  - [x] `nextFrontier(plan, stage, answers)`: the rules in Chosen Approach. Providers already answered
        or skipped are never asked again. A confirmation returns "done". It never returns a provider
        from the other stage.
  - [x] `providerCacheKey(provider, artist, cleanedTitle)`: the prefix `yearprov:<provider>:v1:`
        followed by `normalizeForCacheKey` of each part. The version is per provider, so a change to
        one adapter's logic discards only that provider's entries.
- [x] **Step 4: pure store-hit verification, `shared/store-match.ts`.** Input: the rows an adapter has
      already normalised (title, credit, duration in ms or unknown, date, an `excluded` flag) and the
      target (raw title, primary artist, duration). A row passes when all of these hold:
  - [x] the cleaned, normalised titles are equal (`cleanTrackTitle` on both sides, then
        `normalizeForCacheKey`);
  - [x] every token of the primary Spotify artist appears in the credit. This is the rule the spike
        measured, not `artistMatchesExact`;
  - [x] the duration is within `DURATION_TOLERANCE_MS`, and a row without a duration does not pass.
        (The per-call "duration optional" option existed only for Discogs, and goes with it.)

  The answer is the **earliest** verified row's year, using `compareDates`.

- [x] **Step 5: the adapter contract, `api/_lib/provider-lookup.ts`.**
  - [x] Input: the raw title, the `CleanedTitle`, the raw artist, the primary artist, the duration and
        an `AbortSignal`.
  - [x] Outcome, one of:
    - an answer, with `cached` and a request count;
    - skipped, as `not-configured`;
    - failed, a transient error with its code;
    - busy, with `retryAfterMs`.
  - [x] The registry is a typed `Record<YearProviderId, ProviderLookup>` built in `api/year.ts`, so a
        plan step with no adapter is a compile error.
- [x] **Step 6: the two store adapters.** Each takes an injected `fetch` and its gate, never throws
      for an upstream problem, and parses tolerantly:
  - [x] `api/_lib/deezer.ts`:
    - a free-text `search?q=<artist> <title>`; the advanced syntax returns nothing (§4.1);
    - then `track/{id}` for verified hits, up to a named constant bound, which gives `release_date` and
      the ISRC;
    - read the **body** for `{"error":{"code":4}}` returned with HTTP 200 and map it to busy (§11.2).
    - Reconcile the "2 requests per card" figure against the CSV when capturing, and record the result
      in the header.
  - [x] `api/_lib/itunes.ts`:
    - `search?term=<artist> <title>&entity=song&country=ES`;
    - the storefront is a named constant, not an environment variable;
    - a 403 or 429 maps to busy.
  - [x] Each adapter's permits go through its own gate (step 8).
- [x] **Step 7: the MusicBrainz provider, `api/_lib/musicbrainz-provider.ts`.**
  - [x] Wrap `resolveYear` **whole**, passing the raw title, because it cleans the title itself and
        owns cache-before-gate and the `mbyear:` entry.
  - [x] Map the outcome:
    - a result becomes a `ProviderAnswer` with its confidence, `source` and `viaTitle`;
    - `upstream-unavailable` becomes failed;
    - `rate-limited` becomes busy;
    - a missing `MUSICBRAINZ_USER_AGENT` becomes skipped as `not-configured`, **not** a 500.
  - [x] It is never wrapped in the store answer cache.
  - [x] `resolve-year.test.ts` stays untouched and green. That is the proof its behaviour did not
        change.
- [x] **Step 8: gates per provider, `api/_lib/rate-limit.ts`.**
  - [x] `createRateLimitGate` and the instance gate take a gate key, a minimum interval and a maximum
        wait. The refusal's `retryAfterMs` derives from that gate.
  - [x] `PROVIDER_GATES`:
    - MusicBrainz: `mbgate:v1`, 1.1 s, today's wait (defaults unchanged);
    - Deezer: 120 ms;
    - iTunes: 3 s.
  - [x] The header says why these gates are global: Vercel's egress IPs are shared, so a per-IP limit
        is effectively a limit across all players.
- [x] **Step 9: the provider answer cache, `api/_lib/cache.ts`.**
  - [x] A `ProviderAnswerCache` beside the unchanged `YearCache`, keyed by `providerCacheKey`, with
        TTLs per provider: 30 days for an answer with a year, 1 day for a null. Validated on read like
        `isYearResult`.
  - [x] A batched read of several keys (Upstash `MGET`), which is the widening `YearCache`'s own
        comment asks to wait for until something needs it. A warm card then costs one Redis command.
        Extend the memory cache used under `vercel dev` with the same method.
  - [x] `withAnswerCache(lookup, cache)`: a wrapper applied to the two **store** adapters only, so
        the plan's order never touches a key.
- [x] **Step 10: the driver, `api/_lib/year-pipeline.ts`.** `runStage(stage, input, registry, cache, plan)`:
  - [x] **Read first.** One batched read (`MGET`) of every provider's cached answer, **including the
        MusicBrainz `mbyear:` key**, computed with the same key helper `resolveYear` uses and
        validated with `isYearResult`. On an `mbyear:` hit, the MusicBrainz provider is not called at
        all. On a miss, `resolveYear` runs and repeats its own cache check, so a cold card pays one
        extra GET and a warm card costs exactly one Redis command. If the cached answers are enough to
        confirm, or no provider is left to ask, return the final answer without a provider request.
        This is what lets a warm deck cost one call per card, and what lets `resolve` decide the final
        answer alone.
  - [x] **Ask.** Loop: `nextFrontier`, run that frontier concurrently with `Promise.all`, merge the
        outcomes, stop at a confirmation or when the stage has no provider left.
  - [x] **Finality.** An answer is final when any of these holds:
    - a confirmation was reached;
    - `verify` has asked every remaining provider;
    - `resolve` was answered entirely from cache and no provider remains unasked in either stage.

    **A transient failure never produces a final "no year"**, or a short outage would drop cards from
    the deck. When a provider failed transiently and no confirmation was reached, the answer is **not**
    final. When **every** asked provider failed transiently, the stage returns `upstream-unavailable`.
    Providers skipped as `not-configured` count as absent, so a final can still be reached without
    them.

  - [x] **Busy.** A busy provider stops the loop and returns busy with its `retryAfterMs`. The answers
        already obtained stay cached, and the next call picks up from them.
  - [x] **Warnings.** Log `console.warn` **once per cold start** for each provider skipped as
        `not-configured`, naming the missing variable and never its value. List skipped providers in
        the response's `skipped`. If **every** provider in the plan is `not-configured`, the endpoint
        returns the existing loud `not-configured` 500.
- [x] **Step 11: the endpoint, `api/year.ts`.**
  - [x] **No `stage` parameter:** today's MusicBrainz-only path, byte for byte, with its 30-day edge
        cache. Tabs still running the old client (the service worker waits rather than calling
        `skipWaiting`) keep calling it, and an old client drops any card that comes back `null`. The
        comment names this reason. **This path still returns the loud `not-configured` 500 on a
        missing `MUSICBRAINZ_USER_AGENT`, on purpose**: it has only one provider, so "skipped with a
        warning" would be "every provider skipped". Say so in the comment, so nobody "fixes" one path
        to match the other.
  - [x] **`stage=resolve` or `stage=verify`:** build the registry from the environment and call
        `runStage`. Any other `stage` value is `invalid-request`.
  - [x] **Status mapping:** busy is 429 with `retryAfterMs`; every provider failing is 502
        `upstream-unavailable`; every provider `not-configured` is 500 `not-configured`.
  - [x] **Edge `Cache-Control`:**
    - a final answer with nothing skipped gets at most the shortest TTL among the cache entries it was
      built from;
    - a provisional answer, or a final one reached with a provider skipped, gets about 60 s.

    Rewrite the `cache.test.ts` mirror test ("Redis TTL ≥ edge TTL") to state that rule rather than
    extending it.

  > **Later, 2026-10-01: steps 10 and 11 were amended by the branch review**
  > ([`review.year-fetch-rework.md`](../reviews/review.year-fetch-rework.md), the developer's rulings).
  > The boxes above stay ticked as the record of what was built.
  >
  > - **Busy (step 10).** A `resolve` that has an answer in hand when a provider is busy no longer
  >   returns busy. It decides, as a `200` with `final: false` (final only if the answers in hand
  >   confirm). It carries the busy provider's `retryAfterMs` in the body, and the client's resolve
  >   lane sleeps on it (W2, W4). `verify` keeps the 429, because the client counts a non-final verify
  >   200 as a transient attempt.
  > - **Two kinds of busy.** Only OUR OWN gate being full is busy, and it is retried with no cap. A
  >   provider SAYING it is busy (Deezer code 700, a Deezer or iTunes 429) is retried the same way. A
  >   provider shutting us out (an iTunes 403, Deezer's quota error code 4) is now a SKIP. That
  >   provider is left out of the call like a `not-configured` one and listed in `skipped`, and the
  >   vote decides without it, so a card is never stuck waiting for a provider that has shut us out.
  > - **The edge (step 11).** A non-final answer built on a failed or busy provider is
  >   `Cache-Control: no-store`, not ~60 s (B1). The verify lane retries the same URL within a second,
  >   so an edge copy turned a short outage into a dropped card.
  > - **A store lookup with no `durationMs`** sends no request and writes nothing to the answer cache
  >   (W3, W6).

- [x] **Step 12: capture fixtures and re-run the replay.**
  - [x] Capture Deezer and iTunes responses for the 22 ground-truth tracks with the adapters' exact
        requests, from a scratch script, **never pointed at Upstash**.
  - [x] Trim the captures without inventing anything, show that trimming changes no answer, and add
        provenance headers in the style of `musicbrainz-payloads.ts`. Include one real Deezer
        quota-exceeded body served with HTTP 200.
  - [x] Build `shared/__fixtures__/year-votes.ts`: one `ProviderAnswer` per provider per track, with
        ground truth. The MusicBrainz column is computed in the test from `YEAR_FIXTURES` through
        `YEAR_TIER_ORDER` and pinned.
  - [x] Use `docs/spikes/spike.year-fetch-rework.data.csv` as the drift reference. Any provider answer
        that differs from the CSV is investigated before it is pinned.
  - [x] Re-run a replay against the new module. The surviving scripts live only in two previous
        sessions' scratchpads:
    - `C:\Users\AleixRabassa\AppData\Local\Temp\claude\C--repos-custom-hitster\342d46e9-7dce-4952-ad35-8c2301633e30\scratchpad\impl\replay.ts`,
      which imports `shared/year-providers.ts` by `file:///` URL and reads its data through the
      sibling `yh/` directory. It was written for the four-provider plan and must be adapted.
    - `C:\Users\AleixRabassa\AppData\Local\Temp\claude\C--repos-custom-hitster\36cc2d43-9e4e-4400-b5d3-bbe81f9ec851\scratchpad\yh3\`,
      whose `drop-eval.ts` and `tie-eval.ts` simulate exactly this plan. They include the soundtrack
      decks and the 542 (a copy of the old data is in `yh3/old/`), with the rule re-implemented
      inline, so the new module can be checked against them.

    **The temp directory can be cleaned at any time. The developer must copy `impl/`, `yh/` and
    `yh3/` somewhere durable outside the repo before implementation starts.** Planning did not copy
    them, because it may only write the plan files. If they are gone, rebuild the replay from spike
    §9 and the two CSVs.

    The replay must reproduce spike §13.10's "without Discogs" row on the 542: 474 confirmed, 63
    unconfirmed, 5 without a year, 342/343 against the consensus, and 21/22 fixtures. With §13.12's
    trust order it must also reproduce 112/125 on the labelled cards. Any difference is explained in
    `docs/agent_findings.md`.
- [x] **Step 13: environment.** In `.env.example`:
  - [x] mark `MUSICBRAINZ_USER_AGENT` as skipped-with-a-warning rather than required;
  - [x] update the Upstash comment: Redis now backs three gates and the provider cache, and without it
        `vercel dev` leaves iTunes unpaced from the developer's own IP.
  - [x] Add no Discogs variable. Neither store needs a key.
- [x] **Step 14: grep and run the four checks.**
  - [x] Grep for `@/` under `api/` (must be none) and for relative imports without `.js` under `api/`
        and in `shared/` runtime imports.
  - [x] Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] **Step 15: preview deploy smoke test**, with Upstash set:
  - [ ] one `resolve` and one `verify` for a recent song and an old song;
  - [ ] confirm `mbyear:` entries are hit rather than re-fetched;
  - [ ] confirm a stage-less request still answers as before.

---

## Unit Tests

**`shared/year-providers.test.ts`**

- [x] `should not confirm on Deezer's release year and ISRC year alone`: one voter (the Killing In The Name shape).
- [x] `should confirm when either Deezer year agrees with another provider`.
- [x] `should take the earliest year when Deezer's two years each agree with a different provider`.
- [x] `should take the earliest year when two separate pairs agree`.
- [x] `should confirm Personal Jesus at 1990 at step 2 and never ask iTunes`: the stop rule. MusicBrainz and Deezer agree on 1990, so iTunes' correct 1989 is never asked for. This is the accepted price of "the pair beats iTunes" (spike §13.12: the pair was right 11 times to iTunes' 4).
- [x] `should keep the MusicBrainz and Deezer year when iTunes disagrees`: the Men In Black shape (pair 1997, iTunes 1988), decided with every answer present, so the rule and not the stop is what is pinned.
- [x] `should count iTunes and Deezer as two voters`: the Pink Panther Theme shape (MusicBrainz `high` 1963, iTunes 2006, Deezer 2006) confirms 2006. That is a known wrong answer, pinned **on purpose** with a comment pointing at §13.11.
- [x] `should ignore a skipped or null provider and still ask the next one`.
- [x] `should return no year when every answer is null`.
- [x] `should fall back in the order MusicBrainz high, iTunes, MusicBrainz low, Deezer`:
  - a lone MusicBrainz `high` beats a lone iTunes (the Killing In The Name shape: 1992 `high`, iTunes 2001);
  - a lone iTunes beats a MusicBrainz `low` (the A Whole New World shape: 2014 `low`, iTunes 1992);
  - a MusicBrainz `low` beats a lone Deezer.
- [x] `should accept a lone Deezer only when its two years agree`.
- [x] `should not confirm a MusicBrainz high alone`, and `should confirm a MusicBrainz low with one agreeing provider`.
- [x] `should fire the recent-release signature only from 2015 and without a remaster or live suffix`: the La Grange case, `deezerRecentSignature`.
- [x] `nextFrontier`: with nothing answered it returns Deezer and MusicBrainz together; with one answer it returns the next provider; with `finalWhenCertain` switched on in a test plan it returns Deezer alone; it never returns a provider from the other stage or one already answered or skipped; it returns done on a confirmation.
- [x] `validatePlan`: the shipped plan is valid; a duplicate step, a trust tier naming a provider outside the plan, a provider with no tier, and a verify step before a resolve step are each rejected.
- [x] `isrcYear`: the century pivot, and a malformed ISRC giving null.
- [x] `providerCacheKey`: the prefix per provider, and normalisation of both parts.
- [x] `should come out 21/22 exact over the 22 fixtures`, pinning the confirmed-at-step counts (a reorder changes them, which is intended).

**`shared/store-match.test.ts`**

- [x] One test per rule: the title rule, the artist-token rule, the duration rule (a row without a duration fails), the `excluded` flag, and earliest-wins.
- [x] A mutation guard, the same shape as the existing `artistMatchesExact` guard: for each rule, at least one **captured** fixture row where dropping that rule changes the year.

**Adapters** (`api/_lib/deezer.test.ts`, `itunes.test.ts`)

- [x] Each over its captured payloads: the request URLs and parameters, verified versus unverified rows, the answer's year(s).
- [x] Deezer: the quota-exceeded body served with HTTP 200 maps to busy; the `track/{id}` bound is respected.
- [x] iTunes: `country=ES`; 403 and 429 map to busy.
- [x] Every adapter: a network error or a 5xx maps to failed and never throws; an aborted signal stops it.
- [x] Cross-layer test (in `api/_lib/`, because `shared/` may not import `api/`): for each of the 22 tracks, each adapter over its raw payload equals that track's row in `year-votes.ts`.

**`api/_lib/musicbrainz-provider.test.ts`**

- [x] Each `resolveYear` outcome maps to the right provider outcome.
- [x] A missing User-Agent is skipped, not a 500.
- [x] It is not wrapped in the store cache.

**`api/_lib/rate-limit.test.ts`**

- [x] Gates with different keys do not block each other.
- [x] `retryAfterMs` derives from the gate.
- [x] The MusicBrainz defaults are unchanged.

**`api/_lib/cache.test.ts`**

- [x] The provider cache round-trips each answer shape.
- [x] Invalid stored values are rejected on read.
- [x] TTL is 30 days for a year and 1 day for a null.
- [x] The batched read returns hits and misses in order.
- [x] The memory cache under `vercel dev` behaves the same.
- [x] The rewritten edge-TTL rule.

**`api/_lib/year-pipeline.test.ts`**

- [x] A cold `resolve` asks Deezer and MusicBrainz concurrently: both are in flight before either resolves.
- [x] A confirmation at `resolve` returns final and never asks a verify provider.
- [x] An unconfirmed `resolve` returns a provisional answer with `final: false`.
- [x] `verify` reads `resolve`'s answers from the cache and does not ask Deezer or MusicBrainz again.
- [x] `verify` asks iTunes once and returns a final answer whether or not it agrees: confirmed when it does, the trust order's single answer when it does not.
- [x] Everything cached means `resolve` returns the final answer with zero provider requests.
- [x] A busy provider returns busy, keeps the answers obtained, and the next call resumes from them.
- [x] A transient failure without a confirmation is not final, and all asked providers failing gives `upstream-unavailable`.
- [x] `not-configured` providers are skipped and listed in `skipped`, and all of them `not-configured` gives `not-configured`.
- [x] The warning is logged once per provider per cold start and never contains a secret.

**`api/year.test.ts`** (built as `api/_lib/year-endpoint.test.ts`: `vercel.json` would deploy a test beside the handler as a function)

- [x] A stage-less request returns today's response and headers unchanged.
- [x] `stage=resolve` and `stage=verify` are routed.
- [x] An unknown `stage` is 400.
- [x] The 429, 502 and 500 mappings.
- [x] `Cache-Control` for a final, a provisional, and a final with a provider skipped.

---

## Documentation Updates

- [x] `AGENTS.md` Documentation Index: mark this plan's row **Built**, with the date, once it lands. Plan 1 adds the row.
- [x] `AGENTS.md`: a new block on the provider plan:
  - the order and why, and that **Discogs was measured and dropped** (spike §13.10–13.12), so its
    absence is a decision, not an omission;
  - two agreeing providers confirm, and nothing more is asked, so a MusicBrainz + Deezer agreement
    stands against iTunes;
  - Deezer's two dates are one voter, but **iTunes and Deezer are two**, and counting them as one is
    the edit to refuse (§13.11);
  - the lone-answer order MusicBrainz `high` > iTunes > MusicBrainz `low` > Deezer, and why iTunes may
    not pass a `high`;
  - the card shows the **recording's** year (§13.9), so a cover or a dub dated by its own release is
    correct and not a bug to fix;
  - `finalWhenCertain` is off;
  - every provider is skippable with a warning and only "all fail" is loud;
  - a transient failure is never a final "no year";
  - the stage-less legacy path exists for tabs on the old client;
  - the per-provider cache means a reorder needs no bump;
  - the licences of §10.1 still stand and were set aside by the developer, so dropping a provider is
    deleting its line.

  Also add `shared/year-providers.ts` and `shared/store-match.ts` to the layout rules, and the new
  environment variables to the Key Rules.

- [x] `AGENTS.md`: update the "CONFIDENCE IS THE WEAKEST OF TWO AXES" and tier-ladder blocks where
      they imply MusicBrainz's `high` is the final word. It is now one voter.
- [x] `docs/api.md`: `/api/year`'s `stage` parameter, the response fields `final`, `agreedBy` and
      `skipped`, the widened `source`, the status codes, the edge-cache rule, the legacy stage-less
      path, and the environment-variable reference (`MUSICBRAINZ_USER_AGENT` now optional with a
      warning).
- [x] `docs/architecture.md` §3: the three providers, the planner and driver split, the per-provider
      cache and gates, why `verify` reads from Redis and never from the client, and external services
      (Deezer, iTunes Search).
- [x] `docs/development.md` §4: without Upstash, `vercel dev` re-asks every provider on `verify` and
      paces iTunes per process only. §5: new manual rows for production contention on the shared
      iTunes gate, and the unmeasured second round trip (§12.4).
- [x] `docs/agent_findings.md`: a dated entry recording that the spike §12.7 files were lost with an
      uncommitted working tree on 2026-09-30 and rebuilt from this plan, the replay's reproduction of
      §12.3, the Deezer request-count reconciliation, and any drift against the CSV.
- [x] `docs/spikes/spike.year-fetch-rework.md` §12.7: a status line saying the table is superseded,
      the files listed as "Written" were lost, and this plan rebuilt them without `discogs.ts`.
- [x] `.env.example`: step 13.
- [x] Module headers: each new file states its place in the decision/binding split.

---

## Testing Strategy

- **Unit tests:** everything in `shared/` runs in the node environment with no HTTP. The adapters run
  over captured payloads with an injected `fetch`. The driver runs over fake `ProviderLookup`s and the
  memory cache.
- **Integration tests:** the cross-layer adapter-to-vote-fixture test, and the replay reproducing
  spike §12.3.
- **Manual verification:** step 15 on a preview deployment with Upstash. Real contention between
  players cannot be measured locally, so it is a row in `docs/development.md` §5.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                                      | Rationale                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rebuild every §12.7 file from scratch                                                                                                      | Developer's choice. The files are unrecoverable                                                                                                     |
| 2   | A pure planner (`nextFrontier`) plus a thin driver, over a generic walker or a hand-coded pipeline                                         | The parallel pair and the stop rule both come from the constant, so "reorder = one-line edit" stays true, and every decision is node-testable       |
| 3   | One endpoint with `stage`; per-provider cache; the vote recomputed on each call; a batched read                                            | No `yearfinal:` key to version, so a final reached with a provider skipped is not pinned, and a warm card costs one Redis command                   |
| 4   | The MusicBrainz cache key is not bumped here                                                                                               | Its value is unchanged. Plan 1 owns the `v5` bump                                                                                                   |
| 5   | Every provider, MusicBrainz included, is skippable with a warning; only "every provider failed" or "every provider not configured" is loud | Developer's decision, 2026-09-30                                                                                                                    |
| 6   | A transient failure makes an answer non-final; it never produces a final "no year"                                                         | A final null drops the card. An outage must not shrink decks                                                                                        |
| 7   | The stage-less request keeps today's MusicBrainz-only behaviour                                                                            | Tabs on the old client keep calling it until every tab is closed                                                                                    |
| 8   | Store verification uses "every primary-artist token in the credit", not `artistMatchesExact`                                               | The rule the spike measured (151/151 live matches in §12.4)                                                                                         |
| 9   | The iTunes storefront is a constant                                                                                                        | Fewer variables. It is a one-line change later                                                                                                      |
| 10  | ISRC two-digit pivot at the current year plus one                                                                                          | The signature only matters from 2015 on, and an old recording's ISRC year is late anyway                                                            |
| 11  | `confidence` keeps three values; finality is a separate `final` flag                                                                       | `confidence` is saved on the card and read by the reveal. Overloading it would change saved data's meaning                                          |
| 12  | **Discogs is not in the plan**                                                                                                             | Developer's decision, 2026-09-30 (spike §13.12). It cost ~1.1 s on average and ~2.4 s at p90, for about 5 known-right years per ~780 cards (§13.10) |
| 13  | iTunes and Deezer are two voters                                                                                                           | Developer's decision, 2026-09-30. Counting them as one cost 4 known-right years on the 542 for 2 on the soundtrack decks (§13.11)                   |
| 14  | Lone-answer order: MusicBrainz `high` > iTunes > MusicBrainz `low` > Deezer                                                                | Developer's decision, 2026-09-30 (§13.12). 112/125 labelled, against 110 for §12's order; iTunes before a `high` made 6 known years worse           |
| 15  | The card shows the recording's year                                                                                                        | Developer's decision, 2026-09-30 (§13.9). It is what every provider answers; the film's year would need a different lookup                          |

---

## Open Questions

- [x] How many `track/{id}` fetches does Deezer need per card? §4.1 says one per verified hit, and
      §11.2 measured two requests per card. Settle it at capture time (step 6).
      **Answered 2026-09-30:** one per verified hit, capped at `DEEZER_TRACK_FETCH_LIMIT` = 3. §11.2's
      "2" was an artifact: its harness fetched `track/{id}` for `data[0]`, verified or not. On the
      542's recorded rows a bound of 1 / 2 / 3 / 4 costs 1.97 / 2.15 / 2.20 / 2.20 requests per card
      and gets 382 / 385 / 389 / 389 of 514 release-date years exact against the CSV consensus, so 3
      takes every year a fourth fetch found. Live over the 22 fixtures plus 30 CSV tracks it spent
      122 requests on 52 cards (2.35 each). Full reasoning in `api/_lib/deezer.ts`'s header.
- [ ] Is a 60 s edge TTL right for provisional answers? It is a guess, and only production traffic
      will say.

---

## Out of Scope

- Everything in `src/` except `shared/types.ts`'s consumers compiling: `year-client.ts`, the
  resolver, the reducer and the UI are plans 3 and 4.
- The §10.1 licence question (a MetaBrainz plan or a mirror). The developer set it aside because
  the app may be free.
- **Discogs.** It was measured and dropped (spike §13.10–13.12). Re-adding it is a plan line, a trust
  tier and an adapter; §11.1 records its query strategy and data-shape traps.
- A lookup of the **film's** year for soundtrack cards. The developer chose the recording's year
  (§13.9).
- The `isrc:` MusicBrainz rung, now technically possible because Deezer supplies an ISRC. The spike
  measured it (5 of 115), and it can be added later as a MusicBrainz rescue rung.
- A second iTunes storefront, and making Deezer's recent-release signature confirm on its own
  (`finalWhenCertain`). Turning that on is the MusicBrainz saving (1 527 → 751 requests) the developer
  has not asked for.
- Batching several cards into one release-group request (§10.4).
