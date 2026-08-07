<!-- Plans for multi-playlist (in order):
  1. plan.multi-playlist-core.md  — the merge, the state shape, persistence, the link and the library  ← this file
  2. plan.multi-playlist-ui.md    — the landing rows, the fan-out hook, the container wiring and the labels
-->

# Plan: multi-playlist — a deck from up to 5 playlists (core: merge, state, link, library)

> **Jira:** multi-playlist
> **Date:** 2026-08-07
> **Author:** Aleix Rabassa
> **Depends on:** nothing — this is plan 1 of 2

---

## Overview

Today a session is one playlist: `GameState.playlist` is a single `PlaylistSummary`, the share link is
`?playlist={id}&seed={hex}`, and a library entry is one Spotify id. This task lets a player name up
to **five** playlists on the landing screen and play one combined, shuffled deck that is savable and
shareable exactly as a single playlist is.

This plan builds everything **below React**: the pure merge module, the widened `GameState` and
persistence format, the multi-id share link, and the multi-id saved-deck library. It writes no
component and no hook. Plan 2 consumes all of it.

The split exists because plan 2 is a strict consumer: `LandingScreen`, `usePlaylist` and `App.tsx`
cannot be written against `state.playlists`, `mergePlaylists()` or a multi-id `DeckLink` until those
exist. Doing them in one pass would mean a working tree that neither type-checks nor tests until the
very end.

---

## Dependency Contract

### Requires from predecessors

Nothing.

### Produces for downstream plans

| Output                                                                              | Consumed by                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/game/deck-merge.ts` — `mergePlaylists()`, `deckLabel()`, `MergedDeck`, `MAX_DECK_PLAYLISTS` | plan.multi-playlist-ui (`usePlaylist`, `LandingScreen`)    |
| `GameState.playlists` and the `START` action's `playlists` argument                  | plan.multi-playlist-ui (`App.tsx` deal + restart + labels) |
| `useGameSession().start(cards, playlists, seed?)`                                    | plan.multi-playlist-ui (`App.tsx`)                        |
| `parseDeckLink()` returning `playlistIds`, `buildDeckLink(origin, ids, seed)`        | plan.multi-playlist-ui (`App.tsx`, `DeckActions`)          |
| `SavedPlaylist.ids`, `savedDeckKey()`, `savePlaylist()`, `removePlaylist(key)`       | plan.multi-playlist-ui (`App.tsx`, `LandingScreen`)        |

---

## Scope & Affected Areas

| Area                              | Type     | Notes                                                                                                    |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `src/game/deck-merge.ts`          | New      | Pure merge of N playlist outcomes into one deck, plus the deck label and `MAX_DECK_PLAYLISTS`             |
| `src/game/deck-merge.test.ts`     | New      | Node environment. Dedupe, notice aggregation, partial failure, total failure, label                        |
| `src/game/types.ts`               | Modified | `GameState.playlist` → `playlists`; `START` takes `playlists`                                              |
| `src/game/reducer.ts`             | Modified | `START` / `RESUME` write `playlists`; `initialGameState` starts empty                                      |
| `src/game/reducer.test.ts`        | Modified | Every `START`/`RESUME` fixture and assertion moves to the array                                            |
| `src/game/persistence.ts`         | Modified | `SESSION_VERSION` → 2, `PersistedSession.playlists`, and a v1 read that lifts `playlist` into `[playlist]` |
| `src/game/persistence.test.ts`    | Modified | New v2 round trip plus a v1-payload migration test                                                         |
| `src/game/deck-link.ts`           | Modified | `?playlist=` accepts a comma list and repeated params; `DeckLink.playlistIds`; builder takes ids           |
| `src/game/deck-link.test.ts`      | Modified | Multi-id parse/build, the single-id back-compat case, the over-cap rejection                               |
| `src/game/playlist-library.ts`    | Modified | `SavedPlaylist.ids`, `LIBRARY_VERSION` → 2 with a v1 lift, `savedDeckKey()`, key-based remove              |
| `src/game/playlist-library.test.ts` | Modified | Multi-id save/dedupe/remove, the v1 migration, the leak test against the new shape                       |
| `src/game/use-game-session.ts`    | Modified | `start(cards, playlists, seed?)` signature only — no new logic                                             |
| `docs/architecture.md`            | Modified | §3: the combined deck, the merge module, both storage version bumps                                        |
| `docs/agent_findings.md`          | Modified | Dated entry for the decisions and anything measured while building                                         |
| `AGENTS.md`                       | Modified | New bullet: the deck is 1..5 playlists, and what that means for the leak rules and the two storage keys    |

---

## Chosen Approach

**Client-side fan-out with a pure merge module, and `GameState` widened to hold the playlist list.**
`api/playlist.ts` is untouched: the browser fires up to five requests against the existing
`?url=` endpoint (plan 2) and a new pure module, `src/game/deck-merge.ts`, folds the outcomes into
one `MergedDeck` — deduping cards by track id, aggregating the truncation and skipped-track notices,
counting the playlists that failed, and deriving the deck's display label. `GameState.playlist`
becomes `playlists: readonly PlaylistSummary[]`, so a single playlist is simply the `n = 1` case
everywhere and no consumer carries a permanent two-shape branch.

Chosen over a **server-side fan-out** (one request, repeated `url` params) because partial success has
no representation in `PlaylistErrorCode`: a 200 body carrying per-playlist failures is a new response
shape, which would widen `shared/types.ts` and the handler's documented-exhaustive status table. It
would also put merge logic in `api/`, where the handler is deliberately thin and untested and where
the two deploy-only hazards live (the `@/` alias and the `.js` extension rule), stretch one function
invocation across five sequential embed fetches, and make the edge cache key the exact combination of
playlists — so two decks sharing four playlists out of five would share no cache entry. The client
fan-out keeps every playlist a separately cached `/api/playlist?url=` request, keeps each failure
naturally attributable to its own row, and puts every merge rule in a node-environment unit test,
which is the same decision/binding split `gestures.ts`, `resolver.ts` and `pdf-sheet.ts` already
follow.

Chosen over **keeping `playlist` singular and adding a sibling id list** because the id is not
decorative: it feeds the share link and the library key, so a second field would mean every consumer
had to know which of two overlapping fields to read, forever.

---

## Implementation Steps

- [x] **Step 1 — Create `src/game/deck-merge.ts`: the merge, the label and the cap.** One pure module
      over already-fetched outcomes. It imports `PlaylistOutcome` / `PlaylistClientErrorCode` from
      `playlist-client.ts` and touches no `fetch`, no `window` and no storage, so its tests are node
      tests like the two HTTP clients' are.
  - [x] Export `MAX_DECK_PLAYLISTS` as 5. It is a client-side input rule, so it lives here rather
        than in `shared/constants.ts` — nothing in `api/` needs it. `deck-link.ts` and (plan 2)
        `LandingScreen` both import it, so the number exists once.
  - [x] Export a `MergedDeck` interface: the ordered `playlists` that loaded, the merged `cards`,
        `truncated` (true if ANY playlist truncated), `skippedCount` (the sum), and `failures` —
        the ordered list of `PlaylistClientErrorCode`s for the playlists that did not load.
  - [x] Export `mergePlaylists(outcomes)`, taking the outcomes **in the order the player entered the
        rows** and returning either a `MergedDeck` or a single failure code. Concatenate the loaded
        decks in row order (the shuffle makes order irrelevant to play, but a deterministic input is
        what makes the tests exact), then dedupe.
  - [x] Dedupe by `Card.id`, first occurrence wins, preserving order. Record in the module header WHY
        it is safe not to merge any other field: a card from `/api/playlist` never carries a year, so
        two copies of one track differ in nothing the game reads.
  - [x] When **no** playlist loaded, return the FIRST failure's code, so the landing screen's single
        error slot describes the first row that went wrong. No new code is added to
        `StartFailureCode` — a partial failure is a notice, not an error, and a total failure is
        already exactly one of the existing codes.
  - [x] Guard the degenerate cases explicitly: an empty outcome list, and every playlist loading but
        the merged deck being empty. The second one must return the existing `empty-playlist` code,
        because `START` on an empty deck is what the reducer's own comment says nothing above it owns.
  - [x] Export `deckLabel(playlists)`: the first playlist's name for one playlist, and `"<first> +N
        more"` beyond that. Pure over the array, so the HUD, the end screen, the PDF filename and the
        library row all read one function and cannot disagree. Document that it is playlist-level data
        only — the same class of string the suggestion buttons already render.

- [x] **Step 2 — Widen `GameState` and the `START` action in `src/game/types.ts`.** Replace
      `playlist: PlaylistSummary | null` with `playlists: readonly PlaylistSummary[]`, empty while
      `idle`, and change `START`'s `playlist` field to `playlists`.
  - [x] Say in the field's doc comment that the array is ordered as the player entered the rows, that
        it holds 1..5 entries whenever the status is not `idle`, and that the `null` sentinel is gone
        deliberately — an empty array is the same information without a second empty state.
  - [x] Leave `Card`, `PlaylistSummary` and everything in `shared/types.ts` untouched. Nothing about
        the server contract changes in this task, which is the point of the client fan-out.

- [x] **Step 3 — Update `src/game/reducer.ts`.** Mechanical, and it must stay mechanical: no merge
      logic enters the reducer.
  - [x] `initialGameState.playlists` is an empty array.
  - [x] `START`'s two exits (the empty-deck `ended` branch and the normal one) write
        `playlists: action.playlists`. The wholesale-replacement comment still applies verbatim —
        starting a new set of playlists mid-game must not merge into the old deck.
  - [x] `RESUME` writes `session.playlists`.
  - [x] Confirm no other action reads the field, so `FLIP`, `NEXT`, `END` and `YEAR_RESOLVED` need no
        edit.

- [x] **Step 4 — Bump the session format in `src/game/persistence.ts`, and read v1.**
  - [x] `SESSION_VERSION` becomes 2 and `PersistedSession.playlist` becomes `playlists`.
  - [x] `toPersistedSession` guards on `state.playlists.length === 0` instead of the null check.
  - [x] `validateSession` accepts **version 2** natively and **version 1** by lifting its single
        `playlist` object into a one-element array. This is the one migration the module permits,
        because it is exact rather than a guess: a v1 save described exactly one playlist. Note it in
        the header block beside the existing "a version mismatch is not corruption" reasoning, and say
        that a v3 will drop the v1 lift.
  - [x] Validate `playlists` as a **non-empty array** of summaries, reusing the existing per-summary
        validator. Deliberately do **not** cap it at `MAX_DECK_PLAYLISTS` on read: the cap governs
        what the landing screen accepts as INPUT, and a stored session describes a deck that already
        exists — rejecting it would throw away a game in progress if the cap ever rises.
  - [x] Keep every other contract untouched: a read failure is a miss, a write failure is a no-op,
        nothing throws, and validation rebuilds field by field rather than casting.

- [x] **Step 5 — Make the share link carry 1..5 ids in `src/game/deck-link.ts`.**
  - [x] `DeckLink.playlistId` becomes `playlistIds: string[]`, ordered and deduped.
  - [x] Parse the canonical form — one `playlist` param holding a comma-separated list — and also
        accept **repeated** `playlist` params via `getAll`, flattening both into one list before
        validation. Cheap tolerance for a link a chat client or a future build reshaped; the builder
        only ever emits the comma form, so the round trip stays exact.
  - [x] Run **every** element through `parsePlaylistUrl` exactly as today, so a bare id, a full URL
        and a locale-prefixed URL are all still accepted, and an album link in any position rejects
        the whole link. Trim each element; drop empty elements produced by a trailing comma.
  - [x] Reject — return `null`, which means the plain landing screen with **no error** — for: no
        usable element, or more than `MAX_DECK_PLAYLISTS` distinct ids. Over-cap is a rejection rather
        than a silent truncation because truncating would deal a deck the link did not describe, and
        every other rejection in this module already looks identical to "no link at all". Record the
        choice in the header block.
  - [x] Dedupe ids before the cap check, so a link that repeats one id is not punished for it.
  - [x] `buildDeckLink(origin, playlistIds, seed)` joins with a literal comma. A comma is a legal
        query-value character, so nothing needs escaping — say so in the comment, next to the existing
        note about why the id and seed are not validated here.
  - [x] Update the header block: the promise is still "same playlists, same shuffle", never "the same
        deck", and it now has a third reason to be — a playlist that has become private since the link
        was made is dropped with a notice rather than blocking, so the recipient can get a smaller
        deck than the sender had.

- [x] **Step 6 — Make a library entry hold 1..5 ids in `src/game/playlist-library.ts`.**
  - [x] `SavedPlaylist.id` becomes `ids: string[]`; `name` becomes the `deckLabel()` output the
        container passes in; `savedAt` is unchanged.
  - [x] Export `savedDeckKey(entry)` — the entry's ids **sorted and joined** — as the dedupe key, the
        remove argument and (plan 2) the React list key. Sorted so the same set saved twice in a
        different row order updates one row instead of creating a second, indistinguishable one.
        Derived on demand and never stored: a stored key is a second source of truth that can
        disagree with the ids beside it.
  - [x] `savePlaylist` dedupes on `savedDeckKey`, keeps most-recent-first, and keeps
        `LIBRARY_MAX_ENTRIES` at 20. The field-by-field rebuild on the WRITE stays, and now rebuilds
        the ids array element by element — a spread of a larger object is exactly the leak the
        module's own test caught once, and an array field is a new way to smuggle one in.
  - [x] `removePlaylist(storage, key)` takes the deck key rather than a single id.
  - [x] `LIBRARY_VERSION` becomes 2, and `validateLibrary` accepts version 1 by lifting each entry's
        `id` into `[id]`. Same reasoning as the session lift, and here it matters more: a v1 rejection
        would silently empty a library the player curated, on the landing screen, with no message.
  - [x] Validate `ids` as a non-empty array of non-empty strings, cap it at `MAX_DECK_PLAYLISTS` on
        read (unlike the session, this IS input to a future fetch), and keep rejecting the whole store
        on one bad entry or one duplicate key.
  - [x] Keep the header block's leak rule verbatim and extend it: an entry is now up to five ids and
        one label, still playlist-level only, still read on a pre-start surface.

- [x] **Step 7 — Update the `start` signature in `src/game/use-game-session.ts`.** `start(cards,
      playlists, seed?)` forwarding to `START`. Nothing else in the hook changes: the resolver already
      takes the deck rather than the playlist, so a 500-card crawl needs no new code — only the
      documentation in step 8's note about how long it runs.

- [x] **Step 8 — Run the four checks and record the decisions.** `pnpm typecheck && pnpm lint && pnpm
      test && pnpm build`, all four green, before this plan is considered done — plan 2 starts from a
      clean tree.
  - [x] Grep for `state.playlist` and `.playlist?.` across `src/` and confirm every remaining hit is
        in plan 2's files, so plan 2's scope is known rather than discovered.

---

## Unit Tests

`src/game/deck-merge.test.ts` — new, node environment (no docblock needed; node is the default):

- [x] `should merge two loaded playlists into one deck in row order` — covers `mergePlaylists`
- [x] `should drop a track that appears in two playlists` — covers the dedupe, asserting the card
      count and that the surviving copy is the first one
- [x] `should keep two different tracks that share a title` — covers that the dedupe key is the id
- [x] `should report truncated when any playlist truncated` — covers the OR aggregation
- [x] `should sum skippedCount across playlists` — covers the additive aggregation
- [x] `should list the failures of the playlists that did not load` — covers partial failure with at
      least one success
- [x] `should return the first failure code when no playlist loaded` — covers the total-failure exit
      and its ordering
- [x] `should return empty-playlist when every playlist loaded empty` — covers the guard that keeps an
      empty deck away from `START`
- [x] `should label a single playlist with its own name` — covers `deckLabel` at n=1
- [x] `should label three playlists as the first plus a count` — covers `deckLabel` beyond n=1

`src/game/reducer.test.ts` — modified:

- [x] `should carry every playlist into state on START` — covers the widened action
- [x] `should replace the playlists wholesale when START runs mid-game` — covers that a new set does
      not merge into the old one
- [x] `should restore every playlist on RESUME` — covers the resumed array

`src/game/persistence.test.ts` — modified:

- [x] `should round-trip a session with three playlists` — covers the v2 format end to end
- [x] `should read a v1 payload by lifting its single playlist` — covers the migration
- [x] `should reject a payload whose playlists array is empty` — covers the non-empty rule
- [x] `should reject a payload whose playlists array holds a malformed summary` — covers per-entry
      validation
- [x] `should not cap the playlists on read` — covers the deliberate asymmetry with the library, so a
      later cap change cannot silently drop a saved game

`src/game/deck-link.test.ts` — modified:

- [x] `should parse a comma-separated list of ids` — covers the canonical multi form
- [x] `should still parse a single-id link` — covers back-compat with every link already shared
- [x] `should parse repeated playlist params` — covers the `getAll` tolerance
- [x] `should accept full playlist URLs inside the list` — covers that `parsePlaylistUrl` runs per
      element
- [x] `should reject a link whose list holds an album link` — covers one bad element failing the whole
      link
- [x] `should reject a link with more than the maximum number of playlists` — covers the cap as a
      rejection rather than a truncation
- [x] `should dedupe repeated ids before the cap check` — covers the ordering of those two rules
- [x] `should build a link joining the ids with commas` — covers `buildDeckLink`
- [x] `should round-trip a built multi link back through the parser` — covers the pair together

`src/game/playlist-library.test.ts` — modified:

- [x] `should save an entry holding several ids` — covers the widened shape
- [x] `should dedupe an entry whose ids match an existing one in a different order` — covers
      `savedDeckKey`'s sort
- [x] `should remove an entry by its deck key` — covers the new remove argument
- [x] `should read a v1 library by lifting each entry's id` — covers the migration
- [x] `should reject an entry whose ids array is empty` — covers the validator
- [x] `should cap the ids of a stored entry on read` — covers the read-side cap
- [x] `should not write any field beyond ids, name and savedAt` — the existing leak test, re-pointed
      at the array shape

---

## Documentation Updates

- [x] `docs/architecture.md` §3 — a subsection for the combined deck: the client fan-out, the merge
      module's place in `src/game/`, why `api/` is untouched, and the two storage version bumps with
      their v1 lifts.
- [x] `docs/architecture.md` §2 — the `src/game/` inventory gains `deck-merge.ts`, described as a
      decision module with no I/O.
- [x] `AGENTS.md` — one new bullet in the same voice as the existing ones: a deck is now **1..5
      playlists**; `GameState.playlists` replaces `playlist`; both `localStorage` keys are at v2 and
      read v1; the share link's `playlist` param is a comma list; and the merge lives in a pure module
      because a wrong dedupe or a wrong label is invisible to every DOM test.
- [x] `docs/plans/plan.md` §5 — record multi-playlist as a post-Phase-8 item with a pointer to both
      plan files, and note that it **supersedes** the "Multiple decks / saved playlists" bullet's
      "there is still exactly one resumable game" only in the number of playlists, not in the number
      of sessions: there is still exactly one resumable game.
- [x] `docs/agent_findings.md` — a dated (2026-08-07) entry per decision below, plus anything measured
      while building (in particular: what a five-playlist deck actually merges to after the dedupe).
- [x] Module header blocks — the reasoning lives next to the code as it does everywhere in this repo:
      `deck-merge.ts`'s dedupe and label rules, `deck-link.ts`'s over-cap rejection and its third
      reason the link cannot promise the same deck, `persistence.ts`'s and `playlist-library.ts`'s v1
      lifts, and `types.ts`'s note on why the `null` sentinel is gone.

---

## Testing Strategy

- **Unit tests:** everything above, all in the **node** environment. No file in this plan needs jsdom
  — that is the property that makes the merge, the dedupe, the label, the link format and both
  migrations cheap to assert, and it is why they are in `src/game/` rather than in a hook.
- **Integration tests:** none in this plan. `App.test.tsx` is plan 2's, and it will exercise the whole
  path from a stubbed fetch and a stubbed storage.
- **Manual verification:** none owed by this plan on its own. Once plan 2 lands, the paper and device
  checks it adds to `docs/development.md` §5 cover this plan's output too — the share link, the
  library round trip and the PDF label all become observable only through the UI.

---

## Assumptions & Decisions

| #   | Assumption / Decision                                                                                                                                                                                       | Rationale                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Client-side fan-out; `api/playlist.ts` is untouched.**                                                                                                                                                     | Partial success has no representation in `PlaylistErrorCode`, so a server merge would widen the shared response type and the handler's exhaustive status table, put untested logic in `api/`, and make the edge cache key the exact combination of playlists. |
| 2   | **`GameState.playlist` becomes `playlists: readonly PlaylistSummary[]`; the `null` sentinel is dropped.**                                                                                                     | One playlist becomes the `n = 1` case, so no consumer carries a permanent two-shape branch. The id is not decorative — it feeds the link and the library key — so a sibling id list would leave every consumer choosing between two overlapping fields. |
| 3   | **Cards are deduped by track id, first occurrence wins.**                                                                                                                                                    | Two identical cards in one deck read as a bug. Safe to merge on the id alone because a card from `/api/playlist` carries no year, so the copies differ in nothing the game reads.                                                    |
| 4   | **A playlist that fails is dropped with a count; only a total failure blocks Start.**                                                                                                                        | Matches the existing non-blocking notice pattern (`truncated`, `skippedCount`), and one dead editorial playlist must not cost a five-playlist deck. The total-failure case reports the FIRST row's code, so the single error slot describes the first thing that went wrong. |
| 5   | **No new `StartFailureCode`.**                                                                                                                                                                               | A partial failure is a notice, and a total failure is already exactly one of the existing codes. `messages.ts`'s exhaustive `Record` stays as it is.                                                                                 |
| 6   | **The deck label is `"<first> +N more"`, from one pure `deckLabel()`.**                                                                                                                                       | Short enough for the HUD, still names a deck the player recognises. One function means the HUD, the end screen, the PDF filename and the library row cannot disagree.                                                               |
| 7   | **Both storage versions bump to 2 and both read v1 by lifting the single id/playlist.**                                                                                                                       | Exact, not a guess — a v1 payload described exactly one playlist. Without the lift, deploying this would silently empty a curated library on a pre-start surface and discard a game in progress.                                     |
| 8   | **The share link is a comma list in one `playlist` param, and repeated params are also accepted.**                                                                                                            | A single id parses identically, so every link already shared keeps working. A comma needs no escaping in a query value, and `getAll` tolerance costs one line.                                                                        |
| 9   | **A link naming more than five playlists is rejected as `null` (the plain landing screen, no error), not truncated.**                                                                                          | Truncating deals a deck the link did not describe. Every other rejection in `deck-link.ts` already looks identical to "no link at all".                                                                                             |
| 10  | **The library caps ids on read; the session deliberately does not.**                                                                                                                                          | The cap governs INPUT. A library entry is input to a future fetch, so it is capped; a stored session describes a deck that already exists, so capping it would throw away a game in progress if the cap ever rises.                  |
| 11  | **The dedupe key for a saved deck is its ids sorted and joined, derived rather than stored.**                                                                                                                 | The same set saved in a different row order is one favourite, not two indistinguishable rows. A stored key is a second source of truth that can disagree with the ids beside it.                                                     |
| 12  | **No cap on the combined deck size, and the year resolver is untouched.**                                                                                                                                     | Five playlists can be ~500 cards and the crawl runs at roughly 1 req/s, but the card-1 gate means play still starts in seconds and the crawl is invisible unless the player outruns it. Plan 2 says the size out loud instead.        |

---

## Open Questions

- [x] `deckLabel`'s `"+N more"` suffix goes through `sanitizeForPdf` into the PDF **filename**. Confirm
      while building step 1 that the slug it produces is still readable (the sanitiser strips to a
      slug, so the risk is an awkward name, not a broken file).
      **Resolved 2026-08-07: readable, no change needed.** `pdfFileName("Rock Classics +2 more")` →
      `hitster-rock-classics-2-more.pdf`. The `+` is caught by the existing `[^a-z0-9]+` → `-`
      collapse, so it never reaches a filesystem, and the count survives as a digit. Recorded in
      `deck-merge.ts`'s `deckLabel` block.
- [ ] Whether the merged deck should be capped after all. Decision 12 says no; if a real five-playlist
      deck measures far past 400 cards and the HUD count reads as absurd, the remedy is a product
      decision and belongs in a follow-up, not a quiet cap here.

---

## Out of Scope

- Any change to `api/`, to `shared/types.ts`, or to the `/api/playlist` contract.
- Any component, hook or container change — all of it is plan 2.
- Pagination past `MAX_EMBED_TRACKS`. A truncated playlist is still one truncated playlist; five of
  them raise one notice.
- Multiple **resumable sessions**. There is still exactly one saved game, and this task does not
  reopen that decision — only the number of playlists inside it.
- Reordering or weighting the playlists in the deal (an interleaved or per-playlist-quota shuffle).
  The seeded shuffle over the concatenated deck is what ships.
