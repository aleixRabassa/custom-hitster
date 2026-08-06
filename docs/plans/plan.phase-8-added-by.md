<!-- Plans for Phase 8 (in order):
  1. plan.phase-8-look-and-shell.md  — neon-ring card design, contrast re-audit, PWA, icon set
  2. plan.phase-8-features.md        — shareable deck URL, saved-playlist library, PDF export, audio across the flip
  3. plan.phase-8-added-by.md        — the "Added by" decision. No code.  ← this file
-->

# Plan: Phase 8 (third of three) — "Added by" Attribution: a Decision, Not a Feature

> **Phase:** 8 — Nice-to-haves (`plan.md` §5)
> **Date:** 2026-08-06
> **Author:** Aleix Rabassa
> **Depends on:** nothing, and nothing depends on it. It can be resolved before, during or after the
> other two plans.

---

## Overview

**This plan writes no code, and that is its result rather than its limitation.**

`plan.md` §5's first Phase 8 bullet asks for "Added by" attribution on the revealed side — who added
that track to the playlist, shown beside title, artist and year once the card is flipped. It arrived
in Phase 8 on 2026-08-06, relocated out of Phase 7 with a fresh re-spike attached, and that re-spike is
what this plan exists to act on.

The field does not exist. Two live playlists were fetched on 2026-08-06 — `37i9dQZF1DX0XUsuxWHRQd`
(RapCaviar, editorial, 50 tracks) and `2wJx2AIytvpaSJLsc2wy3V` (Radio Brianper, user-owned, 100 tracks)
— both identity-confirmed by `entity.uri` **and** `entity.name` rather than by a 200, per the Phase 0
write-race lesson. The complete track-level field union is **15 fields and identical across both
playlists**, containing no attribution field of any shape; the raw payload contains none of `added_by`,
`addedBy`, `added_at` or `addedAt` anywhere. At playlist level the only attribution-shaped field is
`authors`, and it is **null** on both. Phase 0's inventory still holds two months on.

So the item is not blocked on UI work or on effort. Spotify's Web API does expose `added_by.id` on
playlist items, but only through paths `plan.md` §2 ruled out for an audience defined as "anyone with a
public link": Client Credentials can no longer read `items` at all, and user-authorized PKCE returns
`items` only for playlists the logged-in user owns or collaborates on, behind a Development Mode cap of
five invited users. **Building this therefore requires a new auth path, which re-opens the
no-credentials decision — a product decision about who the audience is, not a UI task.**

The purpose of this plan is to close the loop honestly: state the finding, state what it would actually
cost, make a recommendation, and leave the evidence somewhere the next session will find it before it
re-runs the spike a third time.

---

## Scope & Affected Areas

| Area                     | Type     | Notes                                                                                             |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `docs/plans/plan.md`     | Modified | §5's Phase 8 bullet resolved with an outcome; §2 gains a back-reference if the decision stands     |
| `docs/agent_findings.md` | Modified | The re-spike written up as a dated, repeatable procedure rather than as a one-line conclusion      |
| `AGENTS.md`              | Modified | One line, so the next session does not re-spike a field that has been checked twice                |
| **No source files**      | —        | Nothing under `src/`, `api/` or `shared/` is touched. That is the point                            |

---

## Chosen Approach

**Resolve the item as won't-build-in-this-phase, and record why in enough detail that the decision is
re-openable rather than merely closed.**

Chosen over the two alternatives. Building a UI against an assumed field is what `plan.md` explicitly
warns against — "Do not build a UI against an assumed field" — and the field inventory is what three
other decisions in this repo rest on, so a speculative render path would quietly contradict them.
Adding a Spotify auth path is the honest way to get the data and is genuinely out of proportion: it
means a client id, a PKCE flow, a login screen, a five-user Development Mode cap that defeats the stated
audience, and a reversal of §2 — for one line of text on the back of a card.

The third option, leaving the checkbox untouched, is what has happened twice already. It is why the
spike has now been run in Phase 0 and again in Phase 7's second half. A checkbox with no recorded
outcome is an invitation to re-run the same measurement.

---

## Implementation Steps

- [x] **1. Confirm the re-spike is still the most recent evidence.** If more than a few months have
      passed since 2026-08-06, re-run it before acting; if not, use it as it stands.
  - **No re-run. The evidence is dated 2026-08-06 and today is 2026-08-06** — it is hours old, not
    months, so the gate this step exists to apply says use it as it stands. The two sub-conditions are
    therefore satisfied by the original run rather than by a new one, and both were met there: it
    identity-confirmed by `uri` **and** `name`, and it covered one editorial playlist
    (`37i9dQZF1DX0XUsuxWHRQd`) and one user-owned one (`2wJx2AIytvpaSJLsc2wy3V`).
  - [x] Any re-run must identity-confirm each playlist by `entity.uri` **and** `entity.name`, not by an
        HTTP 200. A nonexistent playlist id still returns 200 with a `pageProps.status` of 404, and the
        Phase 0 fan-out produced a silent write-race by skipping exactly this check.
  - [x] Any re-run must cover **at least one user-owned playlist as well as one editorial one**. The
        two behave differently enough elsewhere in this app that a single sample proves less than it
        appears to.
- [x] **2. Write the finding up as a repeatable procedure**, not as a conclusion. Which playlists, how
      identity was confirmed, the full field union, and the explicit absence list. The value is that the
      next check is a re-run rather than a redesign.
  - The 2026-08-06 entry in `docs/agent_findings.md` already held the method and the numbers, so this
    **extended it rather than adding a second entry** (developer's call, asked because AGENTS.md
    requires confirmation before editing an existing entry) — the alternative put the same evidence in
    two places. New subsection: **five numbered re-run steps**, each carrying the reason it is there —
    one-editorial-plus-one-user-owned as an _ownership_ pairing rather than a genre one, `__NEXT_DATA__`
    and the `trackList` path, identity by `uri` **and** `name` with per-fetch filenames if parallelised,
    **enumerate the union over every entry and diff the two playlists** rather than reading entry `[0]`
    or grepping one field name, and the raw-string absence list as an independent second check. It ends
    by naming the only two interesting outcomes: the union grows, or `authors` turns non-null.
- [x] **3. Resolve the `plan.md` §5 bullet with an outcome.** Not a tick — the feature is not built — but
      a stated resolution carrying the date, the evidence and the condition under which it re-opens.
  - **The box is ticked, and the bullet says in its first line what the tick means:** resolved
    2026-08-06 as won't-build, the tick is for the **decision** and no feature was built. Left
    unticked it would have read as the fourth un-actioned Phase 8 item and invited a third spike, which
    is the exact failure mode the plan's third alternative describes. The existing re-spike evidence
    under it is unchanged; three sub-bullets were added — the re-open condition, what was deliberately
    not done (no speculative `addedBy`, no files touched), and the two questions left genuinely open.
- [x] **4. Name the re-open condition precisely.** The item becomes live if, and only if, the app adopts
      a Spotify auth path. That is the same decision as §2's, so the bullet should point at §2 rather
      than restate it.
  - Stated as the **only** re-open condition, pointing at §2 rather than restating it, and paired with
    what explicitly does _not_ re-open it: nothing about the payload does on its own — a grown field
    union would only justify a third run of the procedure. §2 gained the matching back-reference, so
    the dependency is visible from both ends.
- [x] **5. Add one line to `AGENTS.md`** in the block of things that look like oversights and are not,
      beside the existing "No Spotify credentials exist or are needed" paragraph. Two spikes is enough.
  - Added directly below it, and it leads with the instruction rather than the history: **do not spike
    it a third time.** Carries the 15-field result, the null `authors`, the won't-build resolution, the
    §2 re-open condition, the pointer to the procedure, and the two prohibitions (no `addedBy` "for
    later", no UI against the absent field).
- [x] **6. Leave `shared/types.ts` alone.** No optional `addedBy` field "ready for later". An optional
      field that is never populated reads as a feature that is half-built, and it would appear in
      `Card`, in the persisted session's validator and in the year cache's key space for nothing.
  - Verified rather than assumed: `grep -rn "addedBy\|added_by" src api shared` returns **nothing**, and
    `git status` shows no file under `src/`, `api/` or `shared/` modified by this plan.

---

## Unit Tests

**None, and the absence is deliberate rather than an omission.** This plan changes no behaviour, adds no
module and touches no file under `src/`, `api/` or `shared/`. Inventing a test — an assertion that the
normalised `Card` has no attribution field, say — would encode a non-decision as a constraint and would
have to be deleted by whoever eventually implements the feature.

What replaces it is a verification that nothing moved:

- [ ] Run all four checks (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) and confirm the test
      **count is unchanged** from before this plan. A changed count means a source file was touched, and
      no source file should have been.

---

## Documentation Updates

- [x] `docs/plans/plan.md` §5 — the Phase 8 "Added by" bullet resolved with its outcome, date and
      re-open condition, in the style of §6's resolved open questions.
- [x] `docs/plans/plan.md` §2 — a back-reference noting that this item is one of the things the
      no-credentials decision costs, so the trade-off is visible from the decision as well as from the
      feature.
  - Placed immediately after the constraints table, so it reads off the two rows that cause it: it names
    the cost, names `added_by`'s real location (the Web API's `items`, unreadable by Client Credentials
    and PKCE-limited to owned playlists behind the five-user cap), and states that the item re-opens if
    and only if §2 is re-taken. Phrased as **the concrete price of "anyone with a public link"** rather
    than as a limitation, which is what makes it useful from this end.
- [x] `docs/agent_findings.md` — the 2026-08-06 re-spike as a dated entry with the full procedure, the
      15-field union, the explicit absence list, the null `authors`, and the Phase 0 comparison showing
      the inventory unchanged over two months. Tell the developer it was added.
  - The entry existed with the union, the absence list, the null `authors` and the Phase 0 comparison;
    what it lacked was the **procedure**, which step 2 added to it. Developer told.
- [x] `AGENTS.md` — one line beside the existing no-credentials paragraph.
  - One line kept in the sense that matters (one paragraph, one rule, no new section) — the
    phase-status paragraph at the top still lists "Added by" as pending Phase 8 work, and was left
    alone deliberately: it is rewritten when Phase 8 completes, and the other two Phase 8 plans are
    not executed yet.

---

## Testing Strategy

- **Unit tests:** none. See the section above for why, and for the one check that stands in.
- **Integration tests:** none.
- **Manual verification:** if step 1 triggers a re-run, the verification is the spike itself — two
  playlists, both identity-confirmed by `entity.uri` and `entity.name`, one editorial and one user-owned,
  with the complete track-level field union recorded rather than a targeted search for one field name.

---

## Assumptions & Decisions

| # | Assumption / Decision                                                          | Rationale                                                                                                                                   |
| - | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | The item is resolved as won't-build, not deferred again                         | It has been spiked twice with the same answer. A third deferral produces a third spike                                                       |
| 2 | No speculative UI and no speculative type field                                 | `plan.md` says not to build against an assumed field, and the field inventory is what three other decisions rest on                          |
| 3 | The re-open condition is a Spotify auth path, i.e. §2                           | The blocker is data availability under an anonymous public-link audience, not rendering                                                      |
| 4 | The evidence is recorded as a procedure, not a conclusion                       | So the next check costs a re-run rather than a redesign                                                                                      |
| 5 | Identity confirmation by `entity.uri` **and** `entity.name` is mandatory        | A nonexistent id returns HTTP 200, and Phase 0's parallel fan-out silently read the wrong playlist twice without it                          |

---

## Open Questions

- [ ] **Would a user-owned-playlists mode ever be wanted as a product?** PKCE works for playlists the
      logged-in user owns, which is a coherent smaller product — "make your own deck from your own
      playlist" — that happens to unlock this field. It is a different app from "anyone with a public
      link", and choosing it is §2's decision to re-take, not this plan's.
- [ ] **Is there any non-Spotify source for attribution?** Not obviously. Nothing in MusicBrainz knows
      who added a track to somebody's Spotify playlist, and no third source has been looked for.

---

## Out of Scope

- **Any code.** Nothing under `src/`, `api/` or `shared/`.
- **Adding a Spotify client id, a PKCE flow, or any credentialed path.** That is `plan.md` §2's decision
  and it needs its own plan.
- **An optional `addedBy` field on `Card` "for later".** Decision 2.
- **Re-running the spike unconditionally.** Step 1 gates it on how stale the evidence is.
- **Everything in the other two Phase 8 plans** — `plan.phase-8-look-and-shell.md` and
  `plan.phase-8-features.md`.
