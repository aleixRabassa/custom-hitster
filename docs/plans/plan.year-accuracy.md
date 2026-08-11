# Plan — Year accuracy: first release date, not album-inclusion date

**Status: BUILT (2026-08-11).** Measured 21 of 22 known-tricky tracks exact against the live
database. Full measurement, including the twenty-second, is in
[`agent_findings.md`](../agent_findings.md) (2026-08-11).

---

## Why

Two accuracy complaints from real play:

1. **The year was often the album's, not the song's.** A song issued as a single before it landed on
   an album reported the album's year.
2. **`low` ("Unconfirmed year") answers were frequently wrong.**

Both had a precise cause, and neither needed a second data provider.

### Cause 1 — the strict pass only looked at Albums

```ts
const REQUIRED_PRIMARY_TYPE = 'album'; // shared/year.ts, before this change
```

A release group's `first-release-date` is the date of the **record**. Restricting the pool to
`primary-type: Album` therefore answers "when was this track first put on an album", which is not the
question the game asks. Creep read 1993 (single 1992-09, _Pablo Honey_ 1993-02); Mr. Brightside read
2004 (single 2003-09, _Hot Fuss_ 2004-06). A song never issued on a studio album had **no eligible
release group at all** — every one was a Single (excluded by primary type) or a compilation (excluded
by secondary type) — so "Hey Jude" fell through to the unfiltered pass.

The second MusicBrainz request was already fetching the right field. The filter simply refused to
look at the release groups carrying the earlier date.

### Cause 2 — the relaxed pass had no filter at all

```ts
const filtered = mode === 'strict' ? byArtist.filter(isOfficialStudioAlbum) : byArtist;
```

Nothing sat between "official studio album" and "anything whatsoever". When the strict pass missed,
live takes, compilations, remixes, demos and bootlegs were as eligible as the original. The problem
was never thin evidence — it was **actively misleading evidence**, and nothing distinguished the two.

---

## What was built

### The three-rung ladder — `shared/year.ts`

`PickBestRecordingOptions.mode: 'strict' | 'relaxed'` became `tier: YearTierId`, with an exported
ordered `YEAR_TIER_ORDER` that `api/_lib/resolve-year.ts` walks, stopping at the first rung to yield
a year.

| Rung                 | `accepts`                                                                                | `dateOf`                                   | Reports                  |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------ |
| ① `official-release` | `primary-type` ∈ **Album / Single / EP**, `status: Official`, no excluded secondary type | release-group `first-release-date`         | `high` / `release-group` |
| ② `studio-release`   | no excluded secondary type, `status` ≠ Bootleg                                           | release-group ?? recording ?? release date | `low` / `release-group`  |
| ③ `unfiltered`       | everything (the old relaxed pass, verbatim)                                              | recording ?? release-group ?? release date | `low` / `recording`      |

Steps 1 (artist plausibility), 4 (duration preference) and 5 (earliest wins) are unchanged and shared
by every rung. **The ladder is free**: all three are pure functions over the same already-fetched
pool, so a lookup still costs exactly two MusicBrainz requests.

`isOfficialStudioAlbum` was renamed **`isOfficialOriginalRelease`** — the old name would now be a
lie, and it is the predicate `api/_lib/musicbrainz.ts` shares to decide which release groups deserve
the second request.

### Why widening rung ① is safe in one direction only

Earliest-wins runs _after_ the filter, so admitting more release groups can only move the answer
**earlier** — which is the definition of "first release". A reissue single cannot beat the album it
postdates. Billie Jean has a January 1983 single over a November 1982 album and still resolves to
1982; `shared/year.test.ts` asserts that directly rather than leaving it as a prediction.

### Truncation ordering — `api/_lib/musicbrainz.ts`

`MAX_RELEASE_GROUPS = 50` bounds the batched second request, and Singles/EPs enlarge the pool
competing for those slots. Ids are now sorted **Album → EP → Single before the cap**, which makes
truncation non-regressive by construction: everything that survived the cap under the old rule still
survives it. The cap stayed at 50; its existing `console.warn` is what would say otherwise. (100
would still be one request, since `SEARCH_LIMIT` is 100.)

### Cache version

`YEAR_CACHE_SCHEMA_VERSION` **v2 → v3**. Necessary rather than merely required by the bump rule: the
change alters answers already cached at `high`, the 30-day tier. Cost: the first play of any playlist
after deploy re-resolves its whole deck against the global 1 req/s budget.

---

## Fixtures

**All 22 entries in `shared/__fixtures__/year-candidates.ts` were re-captured live on 2026-08-11**,
not just the new ones. The old captures carried Single candidates with **no
`releaseGroupFirstReleaseDate`**, because under the Album-only rule nothing had ever asked for one —
so the 14-track suite passed both before and after the code change while being structurally incapable
of testing it. That is the false comfort this re-capture removes.

Seven tracks were added, each first issued as a single at least a year before its album: Creep,
Relax, Under Pressure, Firestarter, Mr. Brightside, Rolling in the Deep, and Hey Jude (the album-less
case).

### The one track that is pinned as wrong

`YEAR_LIMITATION_FIXTURES` holds Depeche Mode's "Personal Jesus": ground truth 1989, `resolvesTo` 1990. **This is not a fixture waiting for better filtering.** Resolution is _recording_-scoped — the
adapter finds recordings, then asks which release groups they appear on. The album version is 4:55;
the correctly-dated 1989-08-29 single carries a **3:46 edit**, a separate recording MBID. Verified by
querying the recording search unbounded: the album recording never appears beside that release group,
so the `dur:` bound is not what hides it. Reaching it needs **work-level** resolution (MusicBrainz
`work` relationships group every recording of one song). Pinned so a future work-level lookup
announces itself by failing the test.

---

## Deliberately not done

- **A second provider.** iTunes and Deezer report the album edition's date — the same disease as
  Spotify, useful for coverage and harmful for accuracy. Discogs and Wikidata carry the right
  semantic but cost a new secret, a new adapter and a new rate limit. Revisit only if the fixture
  numbers regress.
- **Using the recording's own `first-release-date` to override rung ①.** It measures 10 of 13 alone
  and is wrong-_early_ on "No Woman No Cry" (1973 vs 1974), so a blind `min()` trades one error for
  another. **The open idea worth trying next** is using it as a _disagreement detector_ that
  downgrades confidence rather than changes the year.
- **Changing what happens to `low` cards.** They keep the amber "Unconfirmed year" warning and stay
  in the deck, unchanged.

---

## Blast radius

`shared/year.ts`, `api/_lib/musicbrainz.ts`, `api/_lib/resolve-year.ts`, their tests, and the fixture.
**No change to `shared/types.ts`** — `YearConfidence`, `YearSource` and `YearResult` all still
describe the ladder exactly — and therefore no change to `year-client.ts`, `resolver.ts`,
`reducer.ts`, `persistence.ts`, `CardRevealSide.tsx` or the cache TTL tiers.
