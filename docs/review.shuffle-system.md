# Review: the shuffle system

**Date:** 2026-09-29 · **Commit reviewed:** `5b181c4` · **Scope:** read-only. Nothing was implemented, including
the two wrong comments and the missing tests listed below.

The developer's three requirements, as stated:

1. The songs from 1–5 playlists are mixed randomly into **one** deck.
2. Every time a playlist (or set of playlists) is played, the deck has a **different order**.
3. When a deck is shared by link, the recipient gets the deck **in the same order and at the current position**.

| #   | Requirement                  | Verdict                                                                                         |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | One randomly mixed deck      | **Met.** Measured uniform.                                                                      |
| 2   | A different order every game | **Met on every in-tab path**, with one exception: reloading a tab opened from a link.           |
| 3a  | Link keeps the order         | **Met only when the recipient's fetch is identical**, and **never after "Play again"** (a bug). |
| 3b  | Link keeps the position      | **Not met at all.** The link carries no position; the recipient always starts at card 1.        |

Four decisions were needed from the developer; they are collected in [§5](#5-decisions-for-the-developer).
**D2 and D4 were taken on 2026-09-29** ([§5.1](#51-decisions-taken-2026-09-29)); D1 and D3 are still open.

---

## 1. How a deck is built today

1. **Fetch.** `src/hooks/usePlaylist.ts:147-149` runs `Promise.all(urls.map(fetchPlaylist))` under one
   `AbortController`. Results come back in **row order**, not completion order; a failure is an `ok: false`
   outcome, never a rejection.
2. **Merge.** `src/game/deck-merge.ts:112-131` concatenates the loaded playlists in row order and dedupes by
   `Card.id`, first occurrence wins. Failed playlists are left out **before** the shuffle.
3. **Deal.** `src/App.tsx:357-384` → `useGameSession.start()` (`src/game/use-game-session.ts:191-204`) →
   `START`.
4. **Shuffle.** `src/game/reducer.ts:38` takes `action.seed ?? generateSeed()`; `reducer.ts:50-53` runs
   `shuffleDeck(cards.filter(year !== null), seed)` over the **whole merged list**, once. The filter is a no-op on
   a fresh fetch (no card has a year yet).
5. **Year lookups** (`src/game/resolver.ts`) walk the deck in play order and never move a card.
6. **After the shuffle,** only two things touch the order:
   - yearless cards are dropped at `YEAR_RESOLVED` (`reducer.ts:162-181`) and `RESUME` (`reducer.ts:349`) —
     both are filters, so the survivors keep their relative order;
   - "Play again" (`App.tsx:469-477`) reshuffles `state.deck` with a fresh seed.

The seed is 64 random bits from `crypto.getRandomValues` (`src/game/shuffle.ts:107-125`), hashed to 32 bits by
`hashSeed` (FNV-1a plus an avalanche, `shuffle.ts:41-56`), which seeds mulberry32. The shuffle is a downward
Fisher-Yates with the inclusive `j = floor(r * (i + 1))` (`shuffle.ts:86-105`).

A share link is `?playlist=<id>[,<id>…]&seed=<16 hex>` (`src/game/deck-link.ts:208-217`), built at click time
from `state.playlists` (the playlists that **loaded**, in row order) and `state.seed`.

---

## 2. Requirement 1 — one randomly mixed deck: met

- **Fisher-Yates is correct** (`shuffle.ts:93-102`): `i` runs from n−1 down to 1, `j` can equal `i`, and the
  input is copied rather than mutated. The `floor` rounding bias is at most (i+1)/2³², about 1.2e-7 at i = 499.
- **Playlists are shuffled together, not concatenated.** There is one `shuffleDeck` call, over the merged and
  deduped list. Nothing sorts the deck afterwards (the only non-test `.sort()` is `playlist-library.ts:139`,
  which builds a lookup key).
- **Dropping yearless cards does not bias the result.** The drop depends on which track it is, not where it
  sits, so the survivors are still uniformly shuffled.

### Measured

Node 25, calling the real `src/game/shuffle.ts` with seeds from `generateSeed()`. `z` is the Wilson-Hilferty
approximation of the χ² statistic; |z| < 2 is consistent with uniform.

| Test                                                                                            | Result                                                                                                                |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| n = 4, 1M deals                                                                                 | All 24 orders reached; χ² = 24.9 on 23 d.f. (z = 0.37)                                                                |
| n = 10, 500k deals, card × position                                                             | χ² = 81.4 against ≈81 effective d.f.; every cell 49,554–50,492 around 50,000                                          |
| n = 500, 500k deals                                                                             | First card χ² = 492 on 499 (z = −0.2); last card χ² = 550 (z = 1.58)                                                  |
| n = 100, 300k deals                                                                             | Mean fixed points 1.0038 (expected 1); original neighbours still adjacent 1.978 (expected 1.980)                      |
| Low-entropy seeds `game-0…game-299999`, n = 52                                                  | First card z = −1.1; consecutive seeds share a first card 0.0191 of the time (expected 0.0192)                        |
| Five playlists (100/100/50/20/5, 2 shared tracks), 50k deals through `mergePlaylists` + `START` | 273 cards; each playlist's share of the first 10 equals its share of the deck; mean normalised position 0.4999–0.5005 |
| Adjacent cards from different playlists                                                         | 0.695 (≈0.693 expected)                                                                                               |

### Notes, not defects

- **Only 2³² distinct deals exist for a given input list**, because `hashSeed` reduces the 64-bit seed to 32 bits
  and mulberry32 has 32 bits of state. From 13 cards up most orders are unreachable. Everything a player can
  observe (first card, per-card position, neighbours, fixed points) is still uniform, and 4.3e9 deals is more
  games than anyone will play. Birthday bound: a 50% chance that _some_ two games anywhere share a deal after
  about 77k games.
- **The comment at `shuffle.ts:107` ("~2^64 decks") is wrong by a factor of 2³².** Harmless — links and saves
  store the full 64-bit seed string — but the comment should say 2³².
- **Big playlists dominate small ones, by design.** Each playlist's share of the deck is its share of the
  deduped union: a 5-track playlist beside two 100-track ones has roughly a 1-in-10 chance of placing _any_ card
  in the first 10. `docs/plans/plan.multi-playlist-core.md:368-369` puts weighting explicitly out of scope; not
  recommended without a product decision.

---

## 3. Requirement 2 — a different order every game: met, with one exception

Every deal goes through `START` and there are only three callers (`App.tsx:382`, `:383`, `:476`).

| Deal path                                           | Seed                                                                 | Fresh order?               |
| --------------------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| Picker Start, typed URLs                            | `generateSeed()`                                                     | **Yes**                    |
| Tap a suggested playlist                            | `generateSeed()`                                                     | **Yes**                    |
| Hold-select several suggestions, then Start         | `generateSeed()`                                                     | **Yes**                    |
| Saved-library row                                   | `generateSeed()`                                                     | **Yes**                    |
| End → Home → same playlist                          | `generateSeed()` (new `MergedDeck` object, so `dealtDeckRef` passes) | **Yes**                    |
| Exit → picker → same playlist                       | `generateSeed()`                                                     | **Yes**                    |
| End screen "Play again" (`handleRestart`)           | `generateSeed()`, reshuffling `state.deck`                           | **Yes**                    |
| First open of a share link                          | the link's seed                                                      | No — by design             |
| Link game ended/exited → pick again in the same tab | `generateSeed()` (`pendingSeedRef` consumed)                         | **Yes**                    |
| Link fetch failed → pick a playlist                 | `generateSeed()` (tested, `App.test.tsx:1251-1290`)                  | **Yes**                    |
| **Reload a link-opened tab after End or Exit**      | **the same link seed**                                               | **No — repeats the order** |
| Resume a saved session                              | the saved seed and the saved deck                                    | Keeps the order — correct  |

No generated seed is cached anywhere (no module variable, `useMemo` or `useState`); only the link's seed is, in a
lazy `useState`, and it is consumed once. StrictMode's double effect is covered by `dealtDeckRef`
(`App.test.tsx:1154-1196`).

Correction to a premise: the Restart removed on 2026-08-11 was the **game screen's** control-bar button. The end
screen's "Play again" (`COPY.end.restart`) still exists and is a real deal path.

### The exception: reloading a link-opened tab

`END` clears the save (`use-game-session.ts:183-186`), but the URL still carries `?playlist=…&seed=…` — the
address bar is deliberately never touched (`App.tsx:413-417`), and `useBackNavigation.ts:242-249` pushes the
full href. So a reload parses the link again and deals the **identical** order, even in a tab where the player
has since finished a different, picker-dealt game. It affects browser tabs only: a TWA/PWA launch uses
`start_url`, which has no query.

The code calls this intended (`App.tsx:264-271`: "a player who finishes or exits can reload to use them"). It
conflicts with requirement 2 as worded, and the only fix — consuming the params after the link deals — collides
with the container's "no `pushState`/`replaceState` in `App.tsx`" rule. **Decision D2 — taken 2026-09-29: this
stays as it is. After End or Exit the game no longer exists, so re-dealing the link on a reload is accepted. See
[§5.1](#51-decisions-taken-2026-09-29).**

### Minor

- **`gameReducer` is not pure**: `generateSeed()` runs inside it (`reducer.ts:38`) while the file header says
  "all of it pure", and StrictMode calls the reducer twice in development. Harmless — seed and deck come from
  the same call and land as one state object. Generating the seed in `start()` before dispatch would restore
  purity.
- **"Different" is probable, not guaranteed**: nothing compares the new order with the previous one. The repeat
  chance is 1/n! — negligible for real decks, 1/2 for a 2-card deck.

---

## 4. Requirement 3 — the share link keeps order and position

### 4a. Order: holds only for an identical fetch, and never after "Play again"

Given identical fetch results, the recipient's shuffle input is bit-identical to the sender's: the link keeps
the playlist order (`deck-link.ts:156-185` preserves order and drops repeats), lists only the playlists that
loaded, and the merge is deterministic. Yearless removal happens after the shuffle and keeps relative order.

**Bug — a link copied after "Play again" never reproduces the deck.** Found independently by three of the four
reviews and measured by two. `handleRestart` (`App.tsx:469-477`) reshuffles `state.deck` — already shuffled,
already missing its yearless cards — with a fresh seed s2, and the link then carries s2. The recipient applies
s2 to the **raw fetch order**. Same seed, different input:

- only 0.0172 of positions match (chance is 1/60 = 0.0167); the pre-Restart control matched 2000 of 2000 runs;
- 49.9% of card pairs in the same relative order — identical to an unrelated seed.

It affects both share points (the end screen, and the mid-game dialog in a game reached through Play again). The
comment at `App.tsx:699-703` ("these props can never describe a deck other than the one just played") is false
on this path, and `DeckActions.test.tsx:231-252` checks only that the new seed reaches the URL, not that the URL
reproduces the deck. `App.tsx:470-473` explains why Restart reshuffles `state.deck`: after a resumed session
the original fetch order no longer exists. **Decision D1.**

**Fragility — any change in length re-randomises everything.** A property of the current Fisher-Yates: with the
same length it applies exactly the same permutation, so a one-for-one substitution leaves every other card in
place; but one track added or removed anywhere changes the permutation wholesale. 300 seeds per row:

| n = 50 / 100 / 250           | Pairs in same order | First 10 matching (of 10) |
| ---------------------------- | ------------------- | ------------------------- |
| Identical input              | 100%                | 10                        |
| Replace one track            | 100%                | 9.8–9.9                   |
| Swap two adjacent tracks     | 97–99.5%            | 9.6–9.9                   |
| Remove the middle track      | 76%                 | 0.45 / 0.30 / 0.17        |
| Append one track             | 63%                 | 0.27 / 0.16 / 0.12        |
| One of two playlists missing | ~50%                | ~0.1                      |
| _Unrelated seed_             | _50%_               | _~0.1_                    |

For every length change, not one run in 300 had the first 10 cards all matching. Realistic triggers: an
editorial playlist (Top 50, Viral) netting an add or a remove; a user adding a song to their own playlist; one
of several playlists failing for the recipient; Spotify reordering across the 100-track embed cap. The edge
cache (`api/playlist.ts:69`, `s-maxage=300, stale-while-revalidate=600`) masks this only if both people open
within ~15 minutes from the same region. The copy already promises no more than "same playlist(s), same
shuffle — the deck can differ slightly" (`copy.ts:297-298` and the two translations), so this is documented
drift — but "slightly" undersells a length change.

**The alternative that fixes both at once: sort by `hashSeed(seed + ':' + card.id)`, ties broken by id.** The
order then depends only on the _set_ of cards, not on their input order:

| Change to the input                 | Pairs in same order | First 10 all matching (n = 50 / 100 / 250) |
| ----------------------------------- | ------------------- | ------------------------------------------ |
| Remove, append or prepend one track | 100%                | 78–80% / 88–92% / 95–96%                   |
| Replace one track                   | 100%                | 60% / 82% / 92%                            |
| Rows reordered                      | 100%                | 100% (Fisher-Yates: 49%)                   |

It also removes the Play-again bug for free, because reshuffling `state.deck` with s2 equals shuffling the raw
fetch with s2. A 32-bit key collision is ~3e-5 at n = 500 and the id tie-break covers it. `persistence.ts`
needs nothing (a save stores the dealt deck, not the algorithm). **The cost:** every link already in the wild
would silently deal a different order, because links carry no version — a `v=` param or a distinguishable
seed format is the migration lever. See D1.

Other options considered and rejected: the whole ordered id list in the URL (~11.5 kB for 5 × 100 tracks, and
a full answer key before card 1 — every id resolves publicly at `open.spotify.com/track/{id}`); a compact
permutation (Lehmer code — indexes the recipient's list, so exactly as fragile as the seed); storing the dealt
deck in Upstash behind a short token (exact, but a new write endpoint, a TTL and abuse policy, and the end of
the "a link is ids + seed" design). A cheap complement to any of them: an ~8-character fingerprint of the
sender's sorted id set, so the recipient can be told "this playlist changed since it was shared".

### 4b. Position: not met

The link is `playlist` + `seed` and nothing else: no index, no card id. `START` hard-codes `currentIndex: 0`
(`reducer.ts:95-103`) and its action has no position field (`types.ts:123`). Whatever card the sender is on, the
recipient starts at card 1. The copy does not promise a position either.

**An index is the wrong representation in any form.** A live-deck index is wrong because the sender's deck has
already shrunk (~a third of cards drop as yearless) while the recipient starts from the full deck — and as the
recipient's crawl drops those same cards, `YEAR_RESOLVED`'s `droppedBeforeCurrent` (`reducer.ts:204-215`) moves
their index back, so they drift further behind. A pre-removal index cannot be computed by the sender at all
(`GameState` and `PersistedSession` keep only the live deck), and any index breaks silently under an editorial
refresh.

**Recommended: the current card's track id, `&card=<trackId>`, optional.** It is stable, unique in the deck
(the merge dedupes by `Card.id`), survives yearless removal and editorial reshuffles, and an absent id is
_detectable_ (fall back to card 1, ideally with a notice). What it touches — each verified in the code:

- **Link:** `buildDeckLink(origin, ids, seed)` gains an optional fourth parameter; `SPOTIFY_ID_PATTERN`
  (`shared/spotify-url.ts:46`) must be exported. A present-but-malformed `card` rejects the whole link (the
  one-bad-element rule, `deck-link.ts:169-171`); never lowercase it (base62 is case-sensitive, unlike the seed).
- **Only mid-game links carry it.** `NEXT` past the end leaves `currentIndex` on the last card
  (`reducer.ts:272-274`), so an end-screen position would drop the recipient on the final card.
- **Reducer:** `START.startCardId?`; the card-1 gate reads `deck[0]` (`reducer.ts:89` and `:240`) and must become
  "the current card has a year". A start card that is last and resolves yearless while `preparing` would return
  `ended` with a non-empty deck (`reducer.ts:211-213`) — "Deck finished" for a game that never started.
- **Resolver:** the crawl's first lookup is always `deck[0]`: `start()` calls `crawl()`, whose
  `takePriority() ?? takeNext()` runs synchronously before the first `await` (`resolver.ts:154-195`), and the
  priority effect (`use-game-session.ts:171-175`) runs after the crawl effect (`:133`). `cursor` never rewinds,
  so a recipient at card 20 would outrun the crawl on every advance. Needs a start offset (k..n, then 0..k−1).
- **Invariant comment:** `reducer.ts:300-303` ("every card before `currentIndex` already has a year") becomes
  false. Not a crash — the pending-year UI and the priority jump cover it — but the comment must change.
- **End screen:** `cardsPlayed={state.deck.length}` (`App.tsx:692`) over-counts for a mid-deck start.
- **Leak surface:** the copy-failed fallback `<input value>` in `DeckActions` would now hold a track id beside an
  unflipped card. That is not new information (the on-screen QR already encodes it), but `GameScreen.tsx:143-148`
  ("not one of them derives from a card") and `DeckActions.tsx:509` ("never a track") would need rewording.
- **A saved session still outranks a link** (`App.tsx:264-276`): a recipient with any game in progress resumes
  their own and never sees the position — including a TWA game, since the TWA shares Chrome's `localStorage`.
  Recommend accepting and documenting it; a "replace your saved game?" prompt is a separate UX decision.
  _Superseded 2026-09-29: D4 chose the prompt, so a mid-game recipient is asked and can take the shared deck.
  See [§5.1](#51-decisions-taken-2026-09-29)._
- **Persistence:** no format change. `currentIndex` is already saved and range-checked
  (`persistence.ts:205-207`).
- **Copy:** `shareCaption` in all three catalogues.

**Decision D3.**

---

## 5. Decisions for the developer

- **D1 — Keep Fisher-Yates or switch to the hash sort?** These two recommendations from the review are opposites:
  - _Switch_ (`hashSeed(seed + ':' + card.id)`): fixes the Play-again bug for free and makes shared order robust
    to playlist drift, at the cost of silently re-dealing every existing link unless a `v=` param is added.
  - _Keep_, and then pin the current output as a stored format (see test gap 1). The Play-again bug then needs
    its own fix: remember the fetch order and reshuffle from it (impossible after a resume), or disable the
    share link after Play again.
- **D2 — Reloading a link-opened tab replays the same order.** Accept it as the documented exception, or strip
  the params after the link deals (which breaks the "no history manipulation in `App.tsx`" rule).
  **Taken 2026-09-29 — see §5.1.**
- **D3 — Share the position?** Build `&card=<trackId>` as described in §4b, or keep links starting at card 1 and
  say so in the caption ("same playlists, same shuffle, from the top").
- **D4 — A saved session outranks a link**, so a recipient mid-game never sees a shared position. Recommend
  accepting it. **Taken 2026-09-29, against the recommendation — see §5.1.**

### 5.1 Decisions taken (2026-09-29)

Nothing below is implemented; these are the decisions and what they imply for the code, verified against
`5b181c4`.

**D4 — show a prompt.** When a link is opened over a saved session, the player is asked whether to replace
their saved game with the shared deck, instead of the link being silently ignored.

**D2 — in the developer's words:** _"recargar la página siempre debe seguir la partida en el mismo estado que
estaba justo antes de recargar. Si el enlace es el mismo, nunca se debe modificar la partida."_ (A reload must
always continue the game in exactly the state it was in just before the reload. If the link is the same, the
game must never be modified.)

**How D2 is read.** This is broader than the review's D2, and its second sentence is a constraint on D4. Correct
this reading if it is wrong:

1. **Mid-game reload: already met.** The save carries `currentIndex` and `isFlipped` (`persistence.ts:100-101`),
   and a saved session is resumed before the link is considered, so a reload returns to the same card, flipped
   or not. It must stay that way when D4 is built.
2. **Same link over its own game → no prompt, no re-deal, resume.** Reloading a link-opened tab mid-game
   presents a saved session _and_ the link in the URL at once. A naive D4 would ask "replace your game?" on
   every reload, which the second sentence forbids. The rule: when the URL's link describes the saved deck —
   the same playlist ids in the same order and the same seed — resume silently. **Position is not part of the
   comparison:** if D3 adds `&card=`, the sender's card must never move the reloader off their own card.
3. **A different link over a saved session → the D4 prompt.**
4. **After End or Exit, a reload deals the link again, as it does today.** Clarified by the developer: _"después
   de terminar o salir, la partida ya no existe así que no hay que continuar ninguna partida, puedes reiniciarla
   y remezclar."_ (After ending or exiting, the game no longer exists, so there is no game to continue; it may be
   restarted and reshuffled.) `END` clears the save (`use-game-session.ts:183-186`), so there is nothing for
   D2 to protect, and §3's exception is **accepted**. No code changes for this case: the params stay in the
   address bar and nothing has to mark the link as used, so neither `replaceState` nor a `sessionStorage` marker
   is needed.

**Implications for the implementation:**

- **`deckLink` has to be parsed even when a session is restored.** Today it is read only when
  `state.status === 'idle'` (`App.tsx:274-276`). D4 needs the link in every case, to choose between resume,
  prompt and deal. The comment on `hasEnteredPicker` (`App.tsx:278-284`, "the two terms are exclusive by
  construction") stops being true.
- **The "reload later to use the link" escape hatch** (`App.tsx:270-271`) still works under rule 4, but it is
  no longer the only way to reach a link opened over a saved game. The comment must mention the prompt.
- **Declining the prompt does not consume the link.** Every later reload of that tab during the player's own
  game shows the prompt again, because the link still differs from the saved deck. That is not a modification
  of the game, but it is repeated. Accept it, or remember the refusal per tab (e.g. in `sessionStorage`). This is
  a detail of the prompt's implementation, not a new decision about D2. After the player's own game ends, a
  reload deals the declined link, per rule 4.
- **The TWA and the browser share `localStorage`**, so the prompt also appears in the browser for a game started
  in the installed app. That is the design working.
- **D3 interacts with D4:** if `&card=` is built, a mid-game recipient gets the shared position only by
  accepting the prompt.
- **§3's table row "Reload a link-opened tab after End or Exit" stays "repeats the order"**, now as an accepted
  exception to requirement 2 rather than an open question.

---

## 6. Test gaps

In priority order. None were added.

1. **No test pins the shuffle's output.** Seeds live in saved sessions and share URLs, so `shuffleDeck`'s output
   is effectively a stored format — yet no test compares `shuffleDeck(literal, 'literal-seed')` with a literal
   array (`reducer.test.ts:103` compares the reducer with `shuffleDeck` itself, which is circular). Changing any
   FNV, avalanche or mulberry32 constant passes the whole suite while re-dealing every saved game and link.
   _Depends on D1._
2. **The off-by-one the source warns about is not caught.** The `* i` variant (Sattolo's algorithm: single-cycle
   permutations only) passes every existing test. Either check would catch it: all n! orders appear for a small n
   over many seeds (Sattolo reaches 2 of 6 at n = 3), or the mean number of fixed points over ~1000 seeds is
   within 0.7–1.3 (Sattolo: 0).
3. **No test that a share link reproduces the sharer's deck** — neither after Play again (it would fail today)
   nor for a multi-playlist deck.
4. **Mixing across playlists is never asserted.** No test shows that cards from two playlists are interleaved
   after `START`; today it is guaranteed only by how the code is structured.
5. **No test that two deals get different seeds.** `reducer.test.ts:87-95` checks the seed's format only. Cheapest
   additions: two seedless `START`s produce different seeds; and in `App.test.tsx:1070-1116` (resumed with
   `seed: 'seed-1'`) assert the saved seed after Play again is no longer `'seed-1'`.
6. **No test for End → Home or Exit → picker → same playlist giving a new seed**, nor for a link-dealt game
   followed by a picker deal.
7. **No test for reloading after End with the link params still present.** Whichever way D2 goes, pin it.
   Now that D2 and D4 are taken (§5.1), pin: a mid-game reload with the link present resumes on the same card
   with the same flip state; the same link over its own saved game resumes with no prompt; a different link
   over a saved game shows the prompt; a reload after End or Exit with the link present deals the link again
   from card 1 (today's behaviour, now intended).
8. **`hashSeed` is only checked for determinism and range**; its avalanche is covered indirectly.

Already covered: order-preserving drops (`reducer.test.ts:232-235`), the `RESUME` filter (`reducer.test.ts:559`),
the input not being mutated, and resume keeping the saved seed (`App.test.tsx:1198-1230`).

## 7. Comments that are wrong today

- `src/App.tsx:699-703` — "these props can never describe a deck other than the one just played": false after
  Play again.
- `src/game/shuffle.ts:107` — "~2^64 decks": 2³² after `hashSeed`.

---

_Method: four parallel read-only reviews (the merge and algorithm; per-game freshness; the link's position; the
link's reproducibility under input drift), each cross-checked against the code. The measurements came from
throwaway scripts importing the real `shuffle.ts` and `deck-merge.ts`, run with the repo's `tsx`; they lived in a
session scratchpad (`sensitivity.ts`, `shuffle-check.mts`, `merge-check.ts`, `restart-check.ts`, `sattolo.mts`)
and are not in the repository._
