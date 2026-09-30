# Spike — Year fetch rework: fewer yearless cards, without losing precision

**Status: MEASURED (2026-09-29); PROVIDER ORDER DECIDED (2026-09-30); BUILT 2026-09-30 from the four `plan.year-fetch-rework-*.md` plans** (see [§12](#12-fourth-pass-the-provider-order-as-decided-and-partly-built-2026-09-30) and `docs/plans/`; the preview-deployment checks are outstanding). A spike, not a plan: it records what the current
year pipeline does on real decks, what each candidate improvement recovers, and what it would cost.
The decisions it needs are listed in [§7](#7-decisions-for-the-developer). Per-track data for every
number below is in [`spike.year-fetch-rework.data.csv`](./spike.year-fetch-rework.data.csv).

> **Read [§10](#10-second-pass-licences-provider-ranking-and-the-no-override-queue) first.** A
> second pass the same day found that **neither Deezer nor the iTunes Search API may be used in a
> paid app**, and that **the public MusicBrainz web service is free only for non-commercial use**.
> The developer also ruled that a year MusicBrainz is certain about is **never** corrected. That
> retires the override half of §5 and answers decisions 1–3 of §7.
>
> **Then read [§11](#11-third-pass-discogs-latency-and-the-best-combination-licences-set-aside)**: Discogs
> measured, per-provider latency, and the recommended combination with licences set aside (Deezer →
> MusicBrainz → iTunes → Discogs: cards without a year 108 → 4 of 542, MusicBrainz requests halved).
>
> **And [§13](#13-fifth-pass-film-scores-disney-and-anime-openings-2026-09-30)** for the film-score,
> Disney and anime-openings playlists, where the §12 rule keeps far more cards but only 54–76% of
> the years it shows match the film, because every provider dates the recording, not the film.
> **§13.9–13.12 then record the developer's decisions of 2026-09-30, which supersede §12.2's order:**
> Discogs is dropped, the card shows the recording's year, and a lone answer is kept in the order
> MusicBrainz `high` > iTunes > MusicBrainz `low` > Deezer. The summary table is at the end of §13.12.

The developer's brief, verbatim in intent:

1. **As few cards as possible without a year.**
2. **The year must be precise.**
3. **Extra requests may go into a queue**, so they never slow down the cards that find their year on
   the first try.
4. Think about **title cleaning strategies** and about **retrying with alternatives**.

---

## 1. Method

A throwaway harness (not committed; see [§9](#9-reproducing-this)) ran the **real** code over eight
real playlists. It used `fetchPlaylistFromEmbed`, then `resolveYear` with an in-memory cache and the
per-instance 1.1 s gate. **The production Upstash cache was not touched**: nothing was read from it or
written to it. Separately, it queried Deezer and iTunes for every track, and ran eight title/query
variants against MusicBrainz for every track the pipeline left without a year.

| Playlist (`LandingScreen` suggestion) | Tracks | Character                       |
| ------------------------------------- | -----: | ------------------------------- |
| Jitster official                      |    100 | Mixed, mostly anglophone hits   |
| Rock Party                            |    100 | Classic rock                    |
| Hits Catalans                         |    100 | Catalan pop, 1990s–2020s        |
| Trap Argentino Prime                  |    100 | Argentine trap, 2017–2023       |
| Exitos España                         |     50 | Current Spanish chart           |
| Viva Latino                           |     50 | Current Latin chart             |
| Openings Català                       |     47 | Catalan TV dubs of anime themes |
| PEGAO                                 |     40 | Current reggaeton               |

**542 unique tracks**, after de-duplicating across playlists. The MusicBrainz half of the run took **about an hour of the 1 req/s budget**, which is why the CSV
exists.

**"Precise" needs a reference, and there are two in this document, of different strength:**

- **Ground truth:** the 22 tracks in `shared/__fixtures__/year-candidates.ts`, whose `expectedYear` is
  a known original release year. It is the only true ground truth here, and it is all classic
  catalogue.
- **Hand labels:** for the 29 answers the proposed rule would change, each was labelled from general
  knowledge as _confident_, _closer but still wrong_, or _cannot verify_. The last group is reported
  as unknown, never as a win.

---

## 2. Where the pipeline stands today

### Outcome per playlist

| Playlist             | `high` | `low` |   **no year** |
| -------------------- | -----: | ----: | ------------: |
| Rock Party           |     99 |     1 |         **0** |
| Jitster official     |     87 |    12 |         **1** |
| Hits Catalans        |     82 |     7 |        **11** |
| Exitos España        |     38 |     1 |        **11** |
| Viva Latino          |     34 |     6 |        **10** |
| Trap Argentino Prime |     65 |     6 |        **29** |
| PEGAO                |     23 |     1 |        **16** |
| Openings Català      |      3 |     0 |        **44** |
| **All 542**          |    394 |    33 | **115 (21%)** |

(A track in two playlists counts in both rows, so the rows do not sum to the total.)

Every one of the 115 is a card **dropped from the deck** at play time.

### Why they fail: coverage, almost entirely

- **~109 of 115 had an EMPTY candidate pool.** MusicBrainz returned zero recordings on every query
  rung, so no scoring or artist-matching change can touch them. This confirms the 2026-08-11 finding
  (10 of 18) at six times the sample size.
- 6 had candidates: 4 × `no-dated-candidates` and 2 × `no-candidates` (the artist filter).
- What is missing is **new Latin/urban releases (2019–2026)** and **Catalan catalogue**: the SX3
  anime openings alone are 44 of Openings Català's 47.

### Latency and request cost (one client, cold, per-instance gate)

| Case                         | Lookups | p50   | p90   | max   | MB requests (p50 / p90) |
| ---------------------------- | ------: | ----- | ----- | ----- | ----------------------- |
| Year found, first try        |     422 | 2.3 s | 4.6 s | 5.9 s | 2 / 5                   |
| No year                      |     115 | 2.4 s | 3.7 s | 6.0 s | 3 / 4                   |
| Year found by remix fallback |       5 | 6.9 s | 7.7 s | 7.7 s | —                       |

**A side finding: 46 of 542 lookups (8.5%) got a `503` from MusicBrainz**, even at the gate's 1.1 s
spacing. The adapter retries each once after 1.2 s, and all but one retry succeeded. One
release-group request failed outright and fell back to the relaxed rungs (`"falling back to
relaxed"` in the log). That silently turns what would have been a `high` answer into a `low` one,
which is a precision leak worth closing on its own (proposal P6).

### MusicBrainz `high` is not ground truth

This was not the question, but the data forces it. On the 394 `high` answers, **at least 13 are
confidently wrong**, for example Self Esteem 2002 (1994), Dark Horse 2016 (2013), Bad Romance 2008
(2009) and Lay All Your Love On Me 1977 (1980). A further **8 of the 33 `low` answers** are wrong,
for example Get Lucky 2021 (2013), Layla 2010 (1970) and Iris 2017 (1998). All of them are in the
table in §4.

That puts the present `high` tier at roughly **≤ 96.7% precise** on this sample: 13 known wrong, plus
any error no second source caught.

---

## 3. Title cleaning and query alternatives

### 3.1 A real defect in `cleanTrackTitle`, fixable today

`TRAILING_SEGMENT_PATTERN` has a **lazy** head, `^(.*?)\s+…\((.+)\)$`, so the first `(` the regex
reaches starts the segment, and the greedy `(.+)` swallows everything up to the final `)`:

```
"SI ME HICIERA EL DE LA LENGUA (REMIX) (feat. Luar La L)"
  -> one segment "REMIX) (feat. Luar La L"  -> unclassifiable -> loop stops -> title unchanged
```

The same shape blocks the remix fallback on `Tumbando el Club (feat. …) - Remix`: stripping
`- Remix` leaves `(feat. …)` in place, and the rewritten query still returns nothing. The fix is to
examine the **last** segment first (a greedy head, and an inner class that cannot contain a bracket),
then loop. It needs its own test, and it is independent of everything else here (proposal P1).

### 3.2 What the cleaner leaves behind (scan of all 542 titles)

52 titles are changed by the cleaner. Of the ones it leaves with a trailing segment, the recurring
shapes are:

| Shape                                                               | Examples                                                              | Count |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | ----: |
| Remix tail (already handled by the fallback)                        | `De Lejitos - Remix`, `C90 (Remix)`                                   |     8 |
| Anime theme with its Japanese title in brackets                     | `Mazinger Z (Majingaa Zetto)`                                         |    10 |
| Colon-titled series                                                 | `Duki: Bzrp Music Sessions, Vol. 50/66`                               |    14 |
| Spanish featuring / producer tag                                    | `Sangría - con WOS`, `FULL ICE (prod. ORODEMBOW)`                     |     2 |
| Film tail with no quotes                                            | `La Nieve - Original song from the film …`, `(from GTAVI: The Album)` |     2 |
| TikTok variant                                                      | `MUSSEGU - Sped Up`                                                   |     1 |
| Emoticon / punctuation in the title                                 | `Olvidarnos De To' :)`                                                |     1 |
| Other (`(merengueton)`, `(Freestyle)`, `- W Sound 05`, `(uy_como)`) | —                                                                     |    ~7 |

**No Spanish or Catalan edition suffix** (`En Vivo`, `Remasterizado`, `Versión …`) occurred in this
sample. So adding those families is cheap insurance, not a measured gain.

### 3.3 What each alternative recovers (the 115 yearless tracks, MusicBrainz only)

Every variant was run as an independent MusicBrainz lookup (both requests plus the full tier ladder),
and its answer compared against the store years of §4:

| Variant                                                     |     Recovers | …of which `high` | Disagrees with a store |
| ----------------------------------------------------------- | -----------: | ---------------: | ---------------------: |
| `extended-clean` — the §3.2 families, same query            |            3 |                3 |                      0 |
| `extended-clean+remix` — the above plus the remix strip     |            4 |                3 |                      0 |
| `drop-all-tails` — strip every trailing segment             |            2 |                2 |                      0 |
| `inner-paren` — the bracketed text alone                    |            0 |                0 |                      — |
| `tokenised` — `recording:(w1 AND w2 …)` instead of a phrase |            6 |                5 |                      0 |
| `fuzzy` — the tokenised query with `~1` on long words       |            5 |                5 |                      0 |
| `title-only` — no artist in the query, artist filter local  |            4 |                2 |                      0 |
| **`isrc`** — Deezer's ISRC → MusicBrainz `isrc:` search     |        **5** |            **5** |                  **0** |
| **Union**                                                   | **8 of 115** |                  |                        |

Three conclusions:

1. **Title work recovers 7% of the misses, and never a wrong year.** That is worth having, but it
   cannot move the headline, because the misses are not in MusicBrainz under _any_ title.
2. **`tokenised` is the most productive rewrite.** It tolerates what a quoted phrase does not:
   emoticons (`To' :)` becomes a stray `)` inside the phrase), a word order that differs from
   MusicBrainz's, apostrophe variants.
3. **The ISRC rung is the most interesting**, because it matches by the recording's **identity**
   rather than its name. It costs one Deezer request plus the usual two MusicBrainz requests, and it
   only runs for tracks that already failed.

`inner-paren` found nothing, and `title-only` is the riskiest (2 of its 4 answers were `low`), so
neither is proposed. **Already measured at zero on 2026-08-11 and not re-proposed:** repeating the
`dur:`-bounded query without the bound.

---

## 4. A second and third source: Deezer and iTunes

### 4.1 How they were queried

Both are keyless.

- **Deezer:** free-text `search?q=<artist> <title>`, then `track/{id}` for each verified hit, which
  carries `release_date` and the **ISRC**. The advanced syntax `artist:"…" track:"…"` returned
  nothing for **540 of 542** tracks, so free text is the only form that works.
- **iTunes:** `search?term=<artist> <title>&entity=song&country=ES`.

A result counts only after **verification**:

- the cleaned, normalised title is equal (`normalizeForCacheKey(cleanTrackTitle(…))`);
- every token of the primary Spotify artist is in the store's credit;
- the duration is within `DURATION_TOLERANCE_MS`.

The year is the **earliest** verified row. That is the same earliest-wins rule `pickBestRecording`
applies, for the same reason: errors in a store are reissues, and reissues are late.

- **ISRC year:** characters 6–7 of the ISRC are the year the code was assigned, which for a new
  recording is its release year.

### 4.2 Precision against MusicBrainz `high`, by era

| Source                  | Coverage | Exact, MB ≥ 2015 | Exact, MB < 2015 |
| ----------------------- | -------: | ---------------: | ---------------: |
| Deezer `release_date`   |  386/394 |          **94%** |          **40%** |
| Deezer ISRC year        |  386/394 |              76% |              64% |
| iTunes `releaseDate`    |  305/394 |              89% |          **86%** |
| Deezer and iTunes agree |  185/394 |              95% |              89% |

"Exact" means agreement with MusicBrainz, which §2 shows is itself wrong sometimes. So these are
lower bounds, and most of the "misses" in the iTunes row are MusicBrainz's errors.

**Deezer is a catalogue of editions**: its `release_date` is the album it is sold on, so for old
catalogue it reports the remaster. This is exactly the objection `plan.year-accuracy.md` recorded
("the same disease as Spotify"), and it is real, but only for old catalogue. **iTunes is
surprisingly strong on old catalogue.**

### 4.3 Against ground truth: the 22 fixtures

| Source                         | Exact                                                   |
| ------------------------------ | ------------------------------------------------------- |
| MusicBrainz (current pipeline) | 21/22 (Personal Jesus pinned at 1990)                   |
| iTunes alone                   | **19/19** covered, **Personal Jesus included**          |
| Deezer `release_date` alone    | 6/20                                                    |
| Deezer ISRC year alone         | 5/20                                                    |
| **The vote in §5.1**           | **21/22, zero regressions** (Personal Jesus stays 1990) |

### 4.4 Coverage of the 115 yearless tracks

| Rule                                     | Recovered |
| ---------------------------------------- | --------: |
| Deezer verified                          |       105 |
| iTunes verified (`country=ES`)           |        76 |
| Deezer or iTunes                         |       113 |
| Two of (Deezer, iTunes, ISRC year) agree |        95 |

The two kinds of source fail in opposite directions: MusicBrainz is an archive (strong on old, weak on
new), and a store is a shop (strong on new, weak on old). That is what makes combining them work.

---

## 5. The proposed resolution rule: a vote between independent providers

### 5.1 The rule

The vote has four voters and **three providers**:

- `mb`, the answer of the current MusicBrainz pipeline plus the §3 rescue rungs;
- `it`, iTunes;
- `dz`, Deezer's release date;
- `isrc`, the ISRC year.

`dz` and `isrc` both come from Deezer, so they count as **one** provider.

1. **Two independent providers agree** on a year → take the **earliest** such year, `high`.
2. Otherwise, **MusicBrainz answered** → keep its answer and its confidence, exactly as today.
3. Otherwise, **Deezer's `release_date` equals its ISRC year** → that year, `low`. This is the
   "new release" signature: a fresh recording gets its ISRC the year it comes out.
4. Otherwise → no year, and the card is dropped, as today.

The independence requirement is not decoration: it is what blocked the only regressions an earlier
draft of the rule produced. `Killing In The Name` (Deezer 2012 plus ISRC 2012, both from its 20th
anniversary edition), `Hypnotize` (2007) and `The Bard's Song` (2024) were all single-provider
agreements overriding a correct or better MusicBrainz answer.

### 5.2 Simulated result on the 542

|                            | Today           | With the vote |
| -------------------------- | --------------- | ------------- |
| `high`                     | 394             | **492**       |
| `low`                      | 33              | 32            |
| **No year (card dropped)** | **115 (21.2%)** | **18 (3.3%)** |

| Playlist             | No year today | With the vote |
| -------------------- | ------------: | ------------: |
| Openings Català      |            44 |        **14** |
| Trap Argentino Prime |            29 |             2 |
| PEGAO                |            16 |             1 |
| Hits Catalans        |            11 |             1 |
| Exitos España        |            11 |             0 |
| Viva Latino          |            10 |             0 |
| Jitster official     |             1 |             0 |
| Rock Party           |             0 |             0 |

How the 542 were decided:

- 391 by MusicBrainz corroborated by at least one store;
- 89 by two stores with MusicBrainz silent or outvoted;
- 15 by MusicBrainz alone;
- 29 by Deezer plus ISRC, all `low`;
- 18 not at all.

### 5.3 The 29 answers the rule changes

| Label                | Count | Tracks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Confident correction |    21 | All The Small Things 1997→1999, Self Esteem 2002→1994, Renegades Of Funk 1992→2000, H.I.E.L.O. 2010→2020, She Don't Give a FO 2018→2017, Lay All Your Love On Me 1977→1980, All Star 1997→1999, Bad Romance 2008→2009, Get Lucky 2021→2013 (×2), Happy Together 1966→1967, Dark Horse 2016→2013, Somebody That I Used To Know 2012→2011, Centuries 2015→2014, The Real Slim Shady 1999→2000, International Love 2012→2011, TiK ToK 2010→2009, Zombie 1993→1994, Layla 2010→1970, Under Control 2014→2013, Iris 2017→1998 |
| Closer, still wrong  |     1 | Abracadabra (Alaska y Dinarama) 1996→1985; truth 1984                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Cannot verify**    | **7** | Rock & Roll (Els Catarres) 2023→2013, Tant de Bo 2020→2019, Supermercat 2023→2022, QUE NO S'ACABI 2024→2022, COQUETA 2025→2024, Acapella 2022→2020, Hola Señorita 2018→2019                                                                                                                                                                                                                                                                                                                                              |
| Known regression     |     0 | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 5.4 The residual risk: the rule moves years in BOTH directions

The loose artist match and the store fallback for an empty pool can only turn a null into a year.
**This rule is different**: when MusicBrainz says `high` and two stores agree on another year, it
**overrides** MusicBrainz, and the new year can be **later**.

- **Later than MusicBrainz, 10 times:** All The Small Things, Renegades Of Funk, H.I.E.L.O., Lay All
  Your Love On Me, All Star, Bad Romance, Happy Together, The Real Slim Shady and Zombie are
  confident corrections, and Hola Señorita cannot be verified.
- **The failure it cannot see:** Apple and Deezer both list **only** a reissue of a song, and the
  reissue got a fresh ISRC (a remaster, an anniversary edition). Then two providers agree on a late
  year, and a correct MusicBrainz answer is replaced. `Killing In The Name` is one iTunes row away from
  it: Deezer and the ISRC say 2012 (one provider), iTunes said 2001, so no two providers agreed and
  MusicBrainz's correct 1992 stood. Had iTunes listed only the 2012 edition, 1992 would have been
  replaced. **The fixtures bound this risk (0 of
  22), but they are 22 tracks.**

Three possible guards, none free:

- **(a) Earlier only:** stores may override MusicBrainz only with an **earlier** year. That is
  one-directional and safe, and it would lose 9 of the 21 confident corrections.
- **(b) Later only with a unanimous store vote:** a later override needs Apple, Deezer's release date
  **and** the ISRC year all agreeing. Bad Romance, Renegades Of Funk and H.I.E.L.O. pass; All The
  Small Things does not (only Apple and the ISRC year agree). This is not bulletproof: a remaster can
  carry a new ISRC too.
- **(c) Report `low` instead of `high`** whenever the vote contradicts MusicBrainz. The card then
  carries the amber "Unconfirmed year" marker, which is honest about the disagreement.

### 5.5 The optional single-source rung (off by default)

Accepting iTunes **alone**, as `low`, would take the no-year count from **18 to 4**. iTunes alone
measured 86–89% against MusicBrainz and 19 of 19 on the fixtures. But it is one uncorroborated
source, and the brief says "precise", so it is listed as a decision, not proposed.

---

## 6. Proposed architecture: two stages, two workers

### 6.1 The shape

```
                         ┌─ stage A: /api/year            (MusicBrainz gate, 1 req/s global)
 client resolver ─ worker 1 ─ current pipeline, unchanged cost: 2–5 MB requests
                  │           returns a PROVISIONAL answer, or "no year yet"
                  │
                  └─ worker 2 ─ stage B: /api/year?stage=verify   (Deezer + iTunes gates)
                              votes; the §3 rescue rungs run only when A found nothing
                              returns the FINAL answer, cached under v5
```

- **Stage A is today's lookup** and costs exactly what it costs today, so a card that resolves on the
  first try is **never** delayed. That is the brief's third point, met by construction.
- **Stage B runs in its own worker, in parallel.** Its store requests use rate limits that are not
  MusicBrainz's, so they cost stage A nothing.
  - Its MusicBrainz requests (`isrc:`, `tokenised`, the extended cleaning, the remix fallback moved
    here) run only for cards stage A left empty. They go through the same global gate, at the back
    of the queue.
- **Stage B reads stage A's result from the shared cache and never from the client.** A client that
  sends its own "MusicBrainz said 1999" could otherwise poison the shared cache for every player.
- **The cache:** stage A's first check is the FINAL key. So a warm deck costs one call per card, and
  stage B never runs for it. `YEAR_CACHE_SCHEMA_VERSION` goes to `v5`, by the module's own
  unconditional rule. The price is the one it always is: the first play of every deck after the
  deploy re-resolves at 1 req/s.
- **Scheduling in the client:**
  - priority first: the card the player is on;
  - then stage B's rescue work within a small window ahead of the player;
  - then stage A's crawl;
  - then stage B's verification.
  - A card whose stage A answer is empty is urgent in stage B only when the player is waiting for it.
    The card-1 gate is that case.

### 6.2 Where the design breaks silently: the game layer

The server half is mechanical. The client half changes what a value **means**, and that is the shape
of the 2026-08-05 "dropping yearless cards has a long tail" finding. Each of these is a real change:

| What                        | Today                                      | Needed                                                                                                                                 |
| --------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `YEAR_RESOLVED` with `null` | **Removes the card**                       | A stage A null must leave the card **pending**. Only a stage B null removes it.                                                        |
| A revised year              | No such event                              | A new action (or a widened `YEAR_RESOLVED`). Its tests must cover a card the player has already revealed: do not change it under them. |
| The card-1 gate             | "The current card has a year"              | Unchanged wording, but a stage A null on the start card must run stage B at once.                                                      |
| The PDF export gate         | Waits for `year === undefined`             | Provisional years would print unverified, so the gate must wait for **final**.                                                         |
| Persistence                 | Saves years; `RESUME` skips resolved cards | A provisional year is never verified after a reload unless the save carries a flag. Needs a v3 save format reading v2.                 |
| `no-years-found`            | Fires on a collapsed deck                  | Only after stage B, or it fires on decks the stores would have saved.                                                                  |
| `YearSource`                | `'release-group' \| 'recording'`           | Gains a store/vote value, which ripples through `shared/types.ts`, `year-client.ts` and `CardRevealSide`.                              |

### 6.3 Operational risks

- **The iTunes rate limit is about 20 requests per minute, per IP**, and Vercel functions leave from
  shared egress IPs. It needs a Redis gate like MusicBrainz's. When the gate is busy, the vote must
  degrade rather than fail: MusicBrainz plus Deezer, or Deezer plus ISRC as `low`. The harness paced
  iTunes at 3.2 s and saw **zero** errors in 564 requests; nothing about a shared IP was measured.
- **Deezer's limit** is 50 requests per 5 s. A lookup costs 1 search plus one `track/{id}` per
  verified hit: 1 hit for 421 of 542 tracks, 2 for 80.
- **iTunes coverage depends on the country:** `country=ES` left 136 of 542 with no verified row.
  Trying a second storefront is untested.
- **Terms of use.** Both APIs are use-restricted. Apple's Search API is meant for promoting store
  content, and Deezer's terms govern its public API. **A read of both is a precondition**, not a
  detail.

---

## 7. Decisions for the developer

1. **Build the store vote at all?** It is the only lever with a measured ceiling above ~7% of the
   misses: 21% → 3.3% of cards dropped. It needs the terms-of-use read in §6.3 first.
2. **May the stores override a `high` MusicBrainz answer, and in which direction?** §5.4 gives
   options (a), (b) and (c); the numbers favour (b) or (c).
3. **The iTunes-alone rung (§5.5)?** It takes cards dropped from 18 to 4, with one uncorroborated
   source. Off by default.
4. **Ship the independent pieces first?** P1 and P6 below need no decision at all.

## 8. Proposals, in the order they could land

**Status (2026-09-30): P1, P2, P6 and the `tokenised` rung are built**, in
[`plan.year-fetch-rework-mb-fixes.md`](../plans/plan.year-fetch-rework-mb-fixes.md). The `tokenised`
rung landed as the last attempt of the adapter's query ladder, not in a stage B, and its hits are
capped at `low`. That plan also took the cache to `v5`. The `isrc:` rung of P4, and P3 and P5, are
not built. The measurements in this spike are unchanged.

| #   | What                                                                                                                                                                         | Needs                       | Moves                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------- |
| P1  | Fix the lazy-head bug in `TRAILING_SEGMENT_PATTERN` (§3.1), with a test                                                                                                      | nothing                     | 1–2 titles in this sample              |
| P2  | Extend the cleaner: `Sped Up`/`Slowed`, `con`/`amb` featuring, `prod.`, unquoted `from …` / `Original song from the film …`, plus Spanish/Catalan edition words as insurance | nothing                     | 3 of 115 measured                      |
| P3  | Stage A/B split, the two workers and the game-layer changes of §6.2, with no new provider yet: the remix fallback and P2's variants move into stage B                        | design review               | Latency of misses; 4 of 115 via rescue |
| P4  | The `tokenised` and `isrc:` rescue rungs in stage B                                                                                                                          | P3, and Deezer for the ISRC | 8 of 115 with P2                       |
| P5  | The Deezer + iTunes vote (§5), with gates and verification, `YearSource` widened, cache `v5`                                                                                 | P3; decisions 1–3           | 115 → 18 dropped; 29 answers changed   |
| P6  | A failed release-group request returns a transient error instead of silently degrading to the relaxed rungs                                                                  | nothing                     | Precision; 1 case in this run          |

Where things land follows the house rule:

- adapters in `api/_lib/` with an injected `fetch`;
- the verification and vote as pure functions in `shared/year.ts`;
- the scheduling in `src/game/resolver.ts`, which stays framework-free;
- the fixtures **re-captured** with store rows beside the MusicBrainz ones. Otherwise the suite passes
  both before and after the change, the same false-comfort shape as 2026-08-11.

`plan.year-accuracy.md`'s "deliberately not done — a second provider" is superseded by this
measurement. That file was left unchanged, because it records what was decided at the time.

## 9. Reproducing this

The harness was scratch code and was not committed. To re-run it:

1. Fetch the eight playlists above with `fetchPlaylistFromEmbed`, and de-duplicate by track id.
2. For each track, run `resolveYear` with `createMemoryCache()`, `createInstanceGate()` and a
   `fetchImpl` wrapper that records each MusicBrainz URL and result count. **Never point it at
   Upstash.**
3. In parallel (these are not MusicBrainz):
   - Deezer free-text search plus `track/{id}` at a 150 ms pace;
   - iTunes search with `country=ES` at a 3.2 s pace.
4. For each yearless track, run the §3.3 variants through `fetchYearCandidates` and `YEAR_TIER_ORDER`,
   **in one process**: two processes with per-instance gates exceed 1 req/s together.
5. Verify and vote as in §4.1 and §5.1.

Run with `node_modules/.bin/tsx` from the repo root, importing repo modules by `file:///` URL. The
CSV holds every per-track input and output, so steps 2–4 only need re-running to measure a
**change**.

---

## 10. Second pass: licences, provider ranking, and the no-override queue

The developer's follow-up, in intent:

1. Keep only the providers that can be used **free of charge in a paid app**.
2. **Never correct a year that was obtained with certainty**, only an imprecise one. A card that did
   not get a precise year the first time goes to a **retry queue** with the other providers, and
   requests are **combined** where they can be.
3. Rank the providers: which is best as the first option, the second and the third.

### 10.1 Licences: who may be used in a paid app

The terms were read on 2026-09-29. **This is not legal advice**, and every page below can change.

| Provider                         | Free?                                        | In a paid app?                                                                                                                                                                                                                                                                                                                               | Verdict                             |
| -------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Deezer API**                   | Yes                                          | **No.** "The use of the Services is strictly limited for a non-commercial purpose and in a non-commercial environment". The developer may not receive "any moneys, incomes, revenues … in connection with the use" of them.                                                                                                                  | **Excluded**                        |
| **iTunes Search API** (Apple)    | Yes                                          | **No.** The content may be used only "for the purposes of promoting the subject of the Promo Content", "proximate to a 'Download on iTunes' … badge", and must not be "used for independent entertainment value apart from its promotional purpose". A game's year card is exactly that.                                                     | **Excluded**                        |
| **MusicBrainz web service**      | Only for non-commercial use                  | "Non-commercial use of this web service is free; please see our commercial plans or contact us if you would like to use this service commercially." The Stealth Start-Up tier ($0) is only for services "not publicly offering their services". Bronze starts at $100/month, "for popular mobile apps and … start-ups with public products". | **Needs a plan, or a mirror**       |
| **MusicBrainz data** (the dumps) | Yes                                          | Recordings, releases, release groups and ISRCs are **CC0 core data**. The dumps page says "Commercial use: Allowed, but financial support strongly urged, even for CC0 data". The prebuilt **search indexes** are supplementary data under CC BY-NC-SA, so a mirror must build its own.                                                      | **Allowed** as a self-hosted mirror |
| **Discogs API**                  | Yes (a free token, 60 req/min)               | Commercial use is "generally permitted", **but** charging a fee for an app that integrates Content Discogs provides free needs Discogs's **express written permission**. The monthly dumps are CC0.                                                                                                                                          | **Ask Discogs**, or use the dumps   |
| **Wikidata**                     | Yes                                          | CC0; commercial use is allowed.                                                                                                                                                                                                                                                                                                              | Allowed, but useless (below)        |
| Apple Music API (MusicKit)       | **No** (Apple Developer Program, $99 a year) | Not read in detail; excluded by the "free" criterion.                                                                                                                                                                                                                                                                                        | Not considered                      |

**Consequence 1: the app as it is today is affected, not only this proposal.** A paid build already
calls the public MusicBrainz web service for every card that is not in the cache. As written, that
needs either a commercial plan with MetaBrainz or a self-hosted mirror.

- The mirror is licence-clean (CC0). It costs infrastructure instead of a subscription.
- A mirror also **removes the 1 req/s global limit**, which changes the economics of everything in
  §3: every rewrite rung becomes free to run.
- Where the playlists come from (the Spotify embed scrape) is a separate licensing question that this
  spike did not open.

**Consequence 2: Wikidata was measured, and it is not a provider.** The lookup used the Spotify track
id every card already carries (property `P2207`), batched 100 ids per SPARQL request, so all 542
tracks cost 6 requests. It found **37 items, only 9 of them with a date, and none among the 115
yearless tracks.**

**Consequence 3: the only free, licence-clean provider left is MusicBrainz itself**, through a plan
or a mirror. Discogs is the one possible addition, if Discogs agrees or its dumps are self-hosted.
Discogs coverage is **unmeasured**, because its search endpoint needs an authenticated token; a free
account provides one.

### 10.2 Provider ranking, on technical merit

These figures come from the 542 tracks and the 22 ground-truth fixtures.

The "leave-one-out" column judges each provider only on the tracks where the **other two** agree with
each other. That is the fairest reference available without ground truth, because the provider being
judged has no say in it.

| Provider    | Coverage          | Leave-one-out exact | …before 2015 | …2015 on | Fixtures (ground truth) | Own confidence signal                                       | Throughput                               | Batchable                          |
| ----------- | ----------------- | ------------------: | -----------: | -------: | ----------------------: | ----------------------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| MusicBrainz | 427/542 (79%)     |     188/207 **91%** |          82% |      97% |           21/22 **95%** | **Yes**: `high` is 93%, `low` 73% (leave-one-out)           | 1 req/s **global**, 2–5 requests a card  | The release-group step only (10.4) |
| iTunes      | 406/542 (75%)     |     188/199 **94%** |      **96%** |      94% |          19/19 **100%** | None                                                        | ~20 req/min **per IP**, 1 request a card | No                                 |
| Deezer      | **524/542 (97%)** |     188/279 **67%** |      **44%** |  **98%** |            6/20 **30%** | Weak: release-date year = ISRC year (88% against MB `high`) | 50 requests per 5 s, 2 requests a card   | No                                 |

**The ranking on technical merit alone, ignoring licences:**

1. **First: MusicBrainz.** It is the only provider whose date **means** "first release" (the release
   group's `first-release-date`). It is also the only one with a confidence signal the new policy
   needs: "certain" is `high`, and only `high` is exempt from correction. iTunes is marginally more
   precise, but it cannot go first, for three reasons:
   - it has no confidence signal, so every one of its answers would need a second opinion;
   - it covers 4 points fewer tracks;
   - at ~20 req/min per IP it could not serve every uncached card of every player.
2. **Second: iTunes.** It is the most precise single source, and the only store that is precise on
   **old** catalogue (96%, against Deezer's 44%). That makes it the right voter to confirm or
   overturn a `low` MusicBrainz answer, and most of those are old songs (Layla, Iris, Get Lucky).
3. **Third: Deezer.** It has the widest coverage and is 98% exact on releases from 2015 on, which is
   exactly the new Latin and urban catalogue MusicBrainz lacks. But its dates are edition dates for
   anything older. So it is the **rescue** provider for empty pools, and the least trustworthy voter
   on old songs.

**The licences exclude #2 and #3 (10.1).** The ranking that can actually ship is:

- **first:** MusicBrainz, through a plan or a mirror;
- **second:** Discogs, once its coverage is measured and Discogs has given permission (or from its
  CC0 dumps);
- **third:** nothing measured yet.

### 10.3 The retry queue under the new policy

The developer's rule, stated as code would state it:

- **A MusicBrainz `high` answer is final.** It is never sent to another provider and never
  overwritten. The 13 `high` answers §2 showed to be wrong stay wrong; that is the accepted price of
  the rule.
- **A MusicBrainz `low` answer, or no year at all, goes to the retry queue.** The card is not dropped
  while it waits.
- In the queue, a card becomes `high` when two **independent** providers agree; MusicBrainz's `low`
  answer counts as one of them. Otherwise it keeps its best single answer as `low`, with the amber
  marker, or it has no year.

Simulated on the 542. The queue holds the same 148 cards in every row: 33 `low` plus 115 with no year.

| Providers in the queue                          | `high` | `low` | **No year** | `low` answers corrected | Requests spent on the queue     |
| ----------------------------------------------- | -----: | ----: | ----------: | ----------------------: | ------------------------------- |
| Today (no queue)                                |    394 |    33 |     **115** |                       — | —                               |
| MusicBrainz title rewrites only (licence-clean) |    400 |    34 |     **108** |                       0 | ~1–2 MusicBrainz per empty card |
| + iTunes                                        |    416 |    18 |         108 |                       0 | 142 iTunes                      |
| + Deezer                                        |    423 |    69 |      **50** |                       0 | 292 Deezer                      |
| + iTunes + Deezer                               |    491 |    33 |      **18** |                       8 | 142 iTunes + 292 Deezer         |

How to read the rows:

- **Only the title rewrites are licence-clean today**, and they move 115 to 108.
- **One store on its own** gives a card with no MusicBrainz answer exactly one opinion, never two.
  - With iTunes such a card stays yearless, so "+ iTunes" rescues nothing: it only confirms `low`
    answers up to `high`.
  - With Deezer it becomes `low` when Deezer's release date and ISRC year agree.
- **The two stores together** are what turn empty cards into `high` ones.

### 10.4 Combining requests: what can and cannot be batched

**Measured and rejected: several cards in one recording search.**

- Tested on 100 tracks (50 from Rock Party, 25 from Hits Catalans, 25 from Trap Argentino). The query
  was `(recording:"A" AND artist:"X" AND dur:[…]) OR (…)`, and each card kept only the candidates
  whose normalised title matched its own.
- **5 cards per request lost 33 of the 100 years, and 10 cards per request lost 40.** The 100-result
  page is shared: a popular song fills it (20 of the 5-card pages and 50 of the 10-card pages hit
  the cap), and the other cards' originals are ranked out of it.
- The page limit that `SEARCH_LIMIT`'s comment calls "load-bearing" is load-bearing here too.

**Safe by construction, but not measured: several cards in one release-group request.**

- Request 2 is an **id lookup** (`rgid:(a OR b OR …)`), not a ranked search. As long as the combined
  ids fit in the page, the answers cannot change. Today a request carries up to 50 ids, and the page
  holds 100.
- Pairing two or three consecutive cards of the background crawl would cut the crawl's MusicBrainz
  cost by up to about a third.
- The price is that a card waits for its neighbour's first request. So the card the player is waiting
  on must never be paired.

**Everything else:**

- The iTunes and Deezer searches cannot batch: one search term per request.
- Wikidata batches 100 ids per request, but has no coverage.
- The ISRC rung (§3.3) needs an ISRC. With Deezer excluded, **nothing left supplies one**; the Spotify
  embed carries none. **So the `isrc:` rung is dead under the licence constraint.**

### 10.5 "The single-source rung", explained

A **single-source** year is a year only one provider gives, with no second provider to confirm or
contradict it.

- Every MusicBrainz `low` answer is already single-source today. It is shown with the amber
  "Unconfirmed year" marker, and on this sample 73% of them match the stores' consensus.
- §5.5 asked whether a card MusicBrainz cannot place **at all** should likewise take a lone second
  provider's year, marked `low`, instead of being dropped from the deck.

The trade-off:

- **For:** it is the difference between a card in the deck and a card removed from it. With iTunes it
  was 18 → 4 cards dropped, at the ~94% that source measured on its own.
- **Against:** roughly 1 card in 15 of those would show a wrong year, printed as confidently as any
  other, and nothing on the table would say which one.

**The licence result makes this question concrete, not moot.** With the stores excluded, the first
candidate for a lone second source is Discogs. Its precision is unmeasured, so the question cannot be
answered until it is.

### 10.6 Decisions, revised

1. ~~Build the store vote?~~ **Answered by the licences: no.** Deezer and the iTunes Search API are
   out.
2. ~~May the stores override `high`?~~ **Answered: never.** Only `low` and yearless cards enter the
   queue.
3. **MusicBrainz in a paid app: a MetaBrainz plan, or a self-hosted mirror of the CC0 dumps?** This
   now gates the app itself, not only this rework. A mirror also removes the rate limit, which makes
   every §3 rewrite rung free.
4. **Discogs:** create a free account token so its coverage can be measured. If it measures well, ask
   Discogs for written permission, or plan on its CC0 dumps.
5. **Single-source years:** should a card take a lone second provider's year as `low`, or be dropped?
   Decide once Discogs has a number (10.5).

P1 (the cleaner bug), P2 (the missing families), P6 (the silent degradation) and the `tokenised`
rescue rung need **none** of these decisions. They are the licence-clean part of this spike, and
together they take this sample from 115 to 108 yearless cards.

---

## 11. Third pass: Discogs, latency, and the best combination (licences set aside)

On 2026-09-29 the developer supplied a Discogs API key and asked for three things: measure Discogs,
compare it with the other three providers, and find the combination that covers the most songs at the
highest speed and precision. **Licences are set aside for this section** (the app may become free), so
§10.1 still stands but does not constrain the ranking. The policy of §10.3 is kept: **a certain answer
is final, and only uncertain or missing cards go to the retry queue.**

### 11.1 Discogs, measured

**The lookup strategy** was tuned on the fixtures first:

- **Q1:** `type=master&artist=<primary>&track=<title>&sort=year&sort_order=asc`. The `sort` parameter
  is undocumented but works, and it is what makes the lookup cheap: without it, the top 10 masters for
  Billie Jean do not include _Thriller_.
- **Q2:** `type=release&release_title=<title>`, sorted the same way. This catches singles. Without Q2
  only 18 of 22 fixtures are exact.
- **Tracklist check:** a bounded check (at most 3 fetches) when a master is an album rather than the
  song itself.
- **Q3 fallback:** releases with no master, for local Catalan releases that exist only as releases.

**How a result is verified:**

- the title is equal after normalisation;
- every artist token matches;
- the duration is within 10 s whenever the tracklist gives one;
- "Unofficial Release" formats are excluded;
- the answer is the **earliest** verified year.

**Results:**

- **Cost:** 2.82 requests per card at a 60 req/min limit, so about **21 cards/min**. Latency per
  request is 253 ms p50 and 336 ms p90; per card 3.2 s p50, most of it pacing. Zero 429s over the whole
  run (~27 min).
- **Fixtures:** **21/22**. Personal Jesus is right at **1989**, the one year MusicBrainz is pinned
  wrong on. The miss is Mr. Brightside, dated 2001 from a demo EP.
- **Coverage:** **323/542 (60%)**. By playlist: Rock Party 100/100, Jitster official 99/100, Hits
  Catalans 67/100, Trap Argentino 30/100, Exitos España 20/50, Viva Latino 18/50, Openings Català 5/47,
  PEGAO 3/40. **It found a year for only 9 of the 115 cards MusicBrainz misses.** Discogs catalogues
  _physical_ releases, so it is weak on streaming-only reggaeton and trap.

**Data-shape traps**, recorded so nobody re-learns them:

- A master's `year` is its **main release's** year, not the earliest version's (the Billie Jean
  single master says 1983 while 1982 pressings exist).
- `track=` matching is fuzzy and returns compilations and bootlegs.
- Tracklist durations are often empty strings.

### 11.2 Latency and throughput, measured

The measurement used one fixed 40-track sample (seed 20260929), timed until the response body was
parsed.

| Provider    | Requests per card | Per-request p50 / p90                                         | Throttling observed                                                                                                                                                      | Cards per minute (one IP)                              |
| ----------- | ----------------: | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| MusicBrainz |              2.82 | 128 / 451 ms (recording), 388 / 909 ms (release group)        | **503 on 16% of requests** even at the permitted 1.1 s spacing (10.5% in the baseline run)                                                                               | **~19**, and this limit is **global** across all users |
| Deezer      |                 2 | 119 / 302 ms                                                  | None at 6.7 req/s. A burst of 80 parallel requests got 15 × `{"error":{"code":4,"message":"Quota limit exceeded"}}` **with HTTP 200**, so the client must read the body. | **~300**                                               |
| iTunes      |                 1 | ~176 / 358 ms (cautious figure; many repeats were cache hits) | None, even at 60/min, three times the documented rate                                                                                                                    | **~20** documented                                     |
| Discogs     |              2.82 | 253 / 336 ms                                                  | None at 60/min                                                                                                                                                           | **~21**                                                |

What bounds speed is the rate limit, not the latency. MusicBrainz is the only **global** limit, so it
is the number to spend carefully.

### 11.3 The four providers side by side

"Leave-one-out" judges a provider only on cards where **all three other** providers agree on one year.
It is the strictest reference available on the 542 tracks without ground truth.

| Provider    | Coverage          | Leave-one-out exact |  …before 2015 |       …2015 on | Fixtures  | Own "certain" signal                      |   Cards/min |
| ----------- | ----------------- | ------------------: | ------------: | -------------: | --------- | ----------------------------------------- | ----------: |
| MusicBrainz | 427/542 (79%)     |         139/151 92% |     67/78 86% |      72/73 99% | 21/22     | `high` tier                               | 19 (global) |
| iTunes      | 406/542 (75%)     |     **139/144 97%** | **67/69 97%** |      72/75 96% | **19/19** | none                                      |          20 |
| Deezer      | **524/542 (97%)** |         139/221 63% |    67/149 45% | **72/72 100%** | 6/20      | release-date year = ISRC year, and ≥ 2015 |     **300** |
| Discogs     | 323/542 (60%)     |     **139/145 96%** | **67/69 97%** |      72/76 95% | **21/22** | none                                      |          21 |

**The finding that reorders everything:** Deezer's **"recent release" signature** makes it a certain
source on new songs. The signature is release-date year = ISRC year, the year ≥ 2015, and no
remaster/live suffix on the Spotify title (a remaster gets a fresh ISRC in its own year, which is how
`La Grange - 2005 Remaster` would otherwise read 2019).

- It fires for **239 of 542** cards (44%).
- It agrees with the three-provider consensus on **129 of the 129** that have one.
- **Known wrong:** `The Bard's Song` (2024; truth 1992) and probably `Tanca els Ulls` (2021, where
  MusicBrainz and iTunes both say 2018). Neither has a three-provider consensus to score against.

MusicBrainz's `high` tier, by contrast, is **86% on old catalogue** by the same measure. It has 11
confident errors among the cards the consensus can score (Self Esteem 2002, Dark Horse 2016, Bad
Romance 2008 …).

### 11.4 The combinations, simulated with the policy applied literally

Rules:

- A stage's certain answer is final.
- A card that reaches the queue gets `high` if ≥ 2 **independent** providers agree (Deezer's release
  date and ISRC year count as one provider), and takes the earliest such year.
- Otherwise the card takes a single source as `low`, in trust order MusicBrainz > Discogs > iTunes >
  Deezer (the last only if its two dates agree), or has no year.
- MusicBrainz includes the licence-clean title-rewrite rescues of §3.3.
- "vs consensus" scores `high` answers against a year on which ≥ 3 of the 4 providers agree.

| Pipeline (stages → retry queue)                                 | With year       | No year | `high` / `low` | Fixtures  | `high` vs consensus | MB requests (542 cards) | Speed bound           |
| --------------------------------------------------------------- | --------------- | ------: | -------------- | --------- | ------------------- | ----------------------: | --------------------- |
| **Today:** MusicBrainz                                          | 434 (80.1%)     |     108 | 394 / 40       | 21/22     | 304/316 (96.2%)     |                   1 757 | MB, ~17 cards/min     |
| MB → Discogs                                                    | 440             |     102 | 405 / 35       | 21/22     | 315/327             |                   1 757 | MB 17                 |
| MB → Discogs + iTunes                                           | 508             |      34 | 425 / 83       | 21/22     | 333/345             |                   1 757 | MB 17                 |
| MB → Deezer                                                     | 492             |      50 | 422 / 70       | 21/22     | 323/335             |                   1 757 | MB 17                 |
| MB → Deezer + iTunes                                            | 538             |       4 | 491 / 47       | 21/22     | 333/345             |                   1 757 | MB 17                 |
| MB → Deezer + Discogs + iTunes                                  | 538             |       4 | 493 / 45       | 21/22     | 333/345             |                   1 757 | MB 17                 |
| **Deezer → MB → iTunes (+ Discogs)**                            | **538 (99.3%)** |   **4** | **523 / 15**   | 21/22     | **334/345 (96.8%)** |                 **855** | **MB, ~35 cards/min** |
| Deezer → MB → iTunes + Discogs, single-source dropped           | 523             |      19 | 523 / 0        | 21/22     | 334/345             |                     855 | MB 35                 |
| Deezer → MB (`high` **not** final) → vote with iTunes + Discogs | 538             |       4 | 519 / 19       | **22/22** | **343/345 (99.4%)** |                     855 | MB 35                 |

The same comparison run by the combination evaluator (`evaluate.ts`, all 826 ordered subsets and
variants, with a stricter leave-one-out reference) ranks the same family first. Its Pareto front is
led by `Deezer(recent) → MB → iTunes → Discogs`: 99.8% coverage, 22/22 fixtures, a 100-card cold deck
in ~167 s against today's ~318 s.

### 11.5 Recommendation: the optimal combination

**First: Deezer, for every card.**

- 2 requests, ~0.25 s.
- Final **only** when the recent-release signature holds (§11.3). That covers ~44% of a real deck,
  almost all of it the new Latin/urban catalogue MusicBrainz is missing.
- Its rate limit (~300 cards/min per IP) is never the bottleneck.

**Second: MusicBrainz, for the rest.**

- The existing pipeline, unchanged. A `high` answer is final.
- It now sees about **half** the cards, so the one **global** limit goes twice as far: ~35 cards/min
  instead of ~17. The first card of a recent-heavy deck becomes playable in a quarter of a second
  instead of ~2.3 s.

**Retry queue: iTunes, then Discogs only if still undecided.**

- For every card without a certain answer: MusicBrainz `low`, or nothing.
- Run iTunes (1 request) first. Two independent agreeing providers make the card `high`.
- Discogs is called only for the ~21 cards per 542 that iTunes did not settle. It costs ~60 requests,
  and it is the one voter that is precise on **old** catalogue besides iTunes.
- A card no two providers agree on keeps a single source as `low`, with the amber "Unconfirmed year"
  marker. That is 15 cards in this sample, 14 of them iTunes-only.

**Result on the 542 tracks:**

| Measure                       | Today         | Recommended    |
| ----------------------------- | ------------- | -------------- |
| Cards without a year          | 108 (19.9%)   | **4 (0.7%)**   |
| `high` answers                | 394           | **523**        |
| Scorable `high` answers exact | 96.2%         | **96.8%**      |
| Fixtures                      | 21/22         | 21/22          |
| MusicBrainz requests          | 1 757         | **855 (−51%)** |
| Cold-deck throughput          | ~17 cards/min | ~35 cards/min  |

**The one change that buys the most precision is the one the policy rules out.** Every error left in
the recommended pipeline's `high` answers is a MusicBrainz `high` kept final by the rule (11 of
them). Letting a MusicBrainz `high` be overturned **only** when two other independent providers agree
on a different year fixes all but two of those errors:

- 343/345 exact;
- 22/22 fixtures, Personal Jesus included.

The cost is that the voters must run for every MusicBrainz card, not only the uncertain ones: ~776
Discogs requests and ~302 iTunes requests per 542 cards, and iTunes' ~20/min becomes the pacing
limit. It is recorded here as an option for the developer, not recommended over the rule they set.

### 11.6 What the ranking is now

1. **Deezer first**, for its speed and its certain signal on new releases. Its dates are not to be
   trusted on old songs, and the signature is what keeps them out.
2. **MusicBrainz second:** the only provider whose date means "first release" for old catalogue, and
   the only one with a confidence tier.
3. **iTunes third:** the most precise single source across both eras, 1 request, the cheapest decisive
   voter.
4. **Discogs fourth:** as precise as iTunes on old catalogue, but slower, with 60% coverage and almost
   nothing on streaming-only music. It earns its place only as the last tie-breaker, or as the voter
   that makes the "overturn a contradicted `high`" option possible.

The implementation shape does not change from §6: stage workers, a queue that never delays a card
settled on its first try, and the game-layer changes of §6.2. The stages and the queue simply swap
order and membership. The Discogs harness (`dg-lib.ts`, `dg-run.ts`), the latency harness and
`evaluate.ts` are in the session scratchpad and were not committed. The key must stay out of the repo.

---

## 12. Fourth pass: the provider order, as decided and partly built (2026-09-30)

**Status: implementation STARTED and PAUSED at the developer's request; the partial work was lost and the whole design was BUILT on 2026-09-30 from `docs/plans/plan.year-fetch-rework-*.md`.** The design below is
settled; its last open questions (§12.5) were answered the same day. The server-side pieces listed in §12.7 are
written but **not wired, not tested and not type-checked**; nothing on the client has been touched.

### 12.1 The developer's decisions, in intent

1. **A provider order that is easy to change.** Three phases, in this order:
   - a first pass with the **fastest** provider;
   - then the provider that covers the **widest range**, for the years still missing;
   - then a **verification** phase that puts **precision** first.
2. **A year is confirmed when two providers agree on it. Once two providers have confirmed it, no
   more requests are made for that song.**
3. **When the game starts depends on the picker's new "Keep cards with no year found" option
   (decision 5, §12.8).**
   - **Option ON:** the game starts as soon as the first card's QR, title and artist are ready,
     without waiting for any year. While a card has no year to show, its revealed side shows a
     loading animation in place of the year; as soon as one arrives it is shown by itself, with
     "Confirmando año" while it is provisional and "Año sin confirmar" if it ends unconfirmed
     (§12.5).
   - **Option OFF, the default:** the earlier behaviour. The game does not start until the first
     card's year is **final**, so a card cannot be dropped while the player is playing or listening
     to it. A final year that could not be confirmed starts the game marked "Año sin confirmar"
     (option A).
     This is the fourth wording of the day; §12.5 and §12.8 record the ones it replaced.
4. A MusicBrainz `high` may be overturned when two other independent providers agree on a different
   year (accepted on 2026-09-30, after §11.5 recorded it as an option). Decision 2 makes this
   automatic: a MusicBrainz `high` on its own no longer confirms anything.
5. **A checkbox on the playlist picker, "Keep cards with no year found"** (§12.8). ON keeps the
   cards no provider can date, so a player can print the whole deck and write those years by hand;
   the PDF prints such a card exactly like the others, with **no year**. It also switches off the
   first-card wait (decision 3). OFF is today's behaviour: a card with no year is dropped.

### 12.2 The order, and why each provider sits where it does

The whole order is one constant, `YEAR_PROVIDER_PLAN` in `shared/year-providers.ts`. Reordering,
adding or removing a provider is an edit to that list and nothing else.

| Step | Phase     | Provider    | Why here (from §11.2–11.3)                                                                                                                                   | HTTP stage |
| ---: | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
|    1 | fast      | Deezer      | 2 requests, ~0.25 s, ~300 cards/min per IP. It gives the player a year almost at once.                                                                       | `resolve`  |
|    2 | coverage  | MusicBrainz | Covers the widest **range** of years: the only source whose date means "first release" on old catalogue (86%), and 99% on new. 1 req/s **global**.           | `resolve`  |
|    3 | precision | iTunes      | The most precise single source: 97% leave-one-out, 19/19 fixtures, 1 request. ~20/min per IP, which is global on Vercel's shared egress.                     | `verify`   |
|    4 | precision | Discogs     | 96% leave-one-out, 21/22 fixtures, the only one right on Personal Jesus. ~2.8 requests at 60/min per token. Almost nothing on streaming-only music, so last. | `verify`   |

Two more fields in the constant:

- **`finalWhenCertain`**, per provider, is **off for all four**. It is the switch that would let a
  provider's own self-signal confirm a year alone: MusicBrainz's `high` tier, or Deezer's
  recent-release signature (§11.3). Decision 2 says confirmation takes two providers, so both stay
  off. Turning Deezer's on is the lever for the MusicBrainz saving §11.5 measured (see §12.3).
- **`unconfirmedTrust`** decides which single year a card keeps when nobody agrees: MusicBrainz,
  then Discogs, then iTunes, then Deezer. A lone Deezer answer counts only when its release-date
  year equals its ISRC year.

**Deezer's release date and its ISRC year are one voter, never two.** Both come from the same
catalogue.

**Licences.** §10.1 still stands: Deezer and iTunes may not be used in a paid app. The developer
set that aside on 2026-09-29 because the app may be free. Dropping either provider is deleting its
line from the plan.

### 12.3 What the rule does, replayed on the measured data

`shared/year-providers.ts` was run over the 542 tracks and the 22 fixtures, using each provider's
answers exactly as §2–§11 recorded them. The script, `impl/replay.ts`, is in the session scratchpad
and was not committed. **MusicBrainz is the pipeline as built, without the §3.3 title-rewrite
rungs.** "vs consensus" is §11.4's reference: a year on which at least 3 of the 4 providers agree.

| Measure                        | Today (MusicBrainz only) | **Built: stop at the first agreement** | Same, Deezer signature confirms alone |
| ------------------------------ | -----------------------: | -------------------------------------: | ------------------------------------: |
| Confirmed (`high`)             |                      394 |                                **485** |                                   518 |
| …exact vs consensus            |          304/316 (96.2%) |                    **342/343 (99.7%)** |                       342/343 (99.7%) |
| Unconfirmed (`low`)            |                       33 |                                 **52** |                                    19 |
| **No year (card dropped)**     |                  **115** |                                  **5** |                                     5 |
| Fixtures exact                 |                    21/22 |                                  21/22 |                                 21/22 |
| MusicBrainz requests           |                    1 757 |                              **1 527** |                               **751** |
| Deezer / iTunes / Discogs req. |                    0/0/0 |                          1 084/196/199 |                          1 084/124/91 |

Where the 485 were confirmed: 346 at step 2 (Deezer and MusicBrainz agree), 128 at step 3 (iTunes),
and 11 at step 4 (Discogs). **Stopping at the first agreement cost no precision**, measured against
§11.4's "voters run for every card" variant (343/345). Its one confirmed error, `Centuries` 2015 →
2014, was confirmed by Deezer and MusicBrainz together. The fixture miss is still Personal Jesus:
Deezer and MusicBrainz agree on 1990 at step 2, so Discogs' correct 1989 is never asked for. That is
the price of the stop rule, and it is paid on this card alone.

**What decision 2 costs:** while Deezer's recent-release signature cannot confirm on its own, recent
songs spend MusicBrainz requests to reach a second provider. MusicBrainz requests come out at 1 527
instead of 751. Precision is the same either way.

### 12.4 When a card's year appears, measured

The same numbers answer two questions, one per setting of the §12.8 option (decision 3):

- **"Keep cards with no year found" ON:** the game starts as soon as the first card's QR, title and
  artist are ready. The numbers are how long the revealed side of a card flipped **at once** shows
  the loading animation, and then "Confirmando año".
- **OFF (default):** the loading screen waits for the start card's **final** year. The "final year"
  row is the loading screen's length.

**Measured on 2026-09-30.**

- **Sample:** 60 tracks drawn from the 542 (seed 20260930), each treated as the first card of a new
  game.
- **Conditions:** cold cache, idle gates, one player, from one machine in Spain.
- **Code:** the **real** adapters in `api/_lib/` (Deezer, iTunes, Discogs) and the real
  `resolveYear` for MusicBrainz, walked in plan order and stopping at the first agreement.
- **Pacing:** 3.2 s between cards, outside the timed region, so every provider stayed under its
  limit.
- **Harness:** `first-card-latency.mts` and `first-card-analyze.mts` in the session scratchpad, not
  committed.
- **Results:** no request failed, and the live answers matched the spike's recorded answers in
  **151 of 151** provider calls. That also validates the port of the harness logic into the
  adapters.

| Time from the deal to…, ms                                    |   p50 |   p90 |   max |  mean |
| ------------------------------------------------------------- | ----: | ----: | ----: | ----: |
| **Today:** the year (one MusicBrainz lookup, behind the gate) | 1 238 | 3 449 | 5 844 | 1 807 |
| A year to show: Deezer and MusicBrainz in parallel            | 1 254 | 3 449 | 5 844 | 1 817 |
| The final year, Deezer and MusicBrainz in parallel            | 1 658 | 4 626 | 5 844 | 2 227 |
| The final year, Deezer then MusicBrainz in order              | 1 930 | 4 815 | 6 123 | 2 526 |

**Today, that first row is loading screen**: the card-1 gate holds the game until the year is
there. **With the option ON, the same time is spent on a playable card** with the audio already
available, and it is only visible to a player who flips before it has passed. **With it OFF**, the
loading screen lasts until the "final year" row: ~0.4 s longer than today at the median, up to
~3.3 s longer.

How long the final year takes after the first one depends on where it was settled (providers asked
in order):

| Settled at                           | Cards | After the first year, p50 | …max     |
| ------------------------------------ | ----: | ------------------------: | -------- |
| Step 2, Deezer and MusicBrainz agree |    36 |                    272 ms | 1 451 ms |
| Step 3, iTunes                       |    17 |                    699 ms | 1 217 ms |
| Step 4, Discogs                      |     1 |                  2 029 ms | 2 029 ms |
| All four asked, unconfirmed          |     5 |                  2 942 ms | 3 289 ms |
| All four asked, no year              |     1 |                  2 894 ms | 2 894 ms |

Per-step latency when a step ran:

- Deezer: 265 ms p50, for 2 requests.
- iTunes: 383 ms p50, for 1 request.
- Discogs: 2 377 ms p50. That is mostly its own 1.05 s spacing between its 2–4 requests.
- MusicBrainz is the same lookup as today.

**One design change the measurement buys: Deezer and MusicBrainz are asked in parallel.** They are
the first two voters, and a confirmation always needs both, since Deezer alone never confirms
(`finalWhenCertain` is off). So asking them at once does not break the rule "no more requests once
two agree", and it makes the first year arrive in MusicBrainz's own time: 1 254 ms p50, against
1 715 ms asked in order. iTunes and Discogs stay sequential, because each one runs only when nobody
has agreed yet.

**What this does not measure:**

- **How soon players flip.** That decides whether anyone ever sees the animation.
- **The second HTTP round trip.** The client calls `/api/year` twice (`resolve`, then `verify`) for
  the ~40% of cards the `resolve` stage does not confirm. A warm Vercel function adds tens of
  milliseconds; a cold start adds more.
- **Contention between players.** The iTunes gate spaces requests 3 s apart and the Discogs gate
  1.05 s apart, across **all** players, because Vercel's egress IPs are shared. A card that needs
  iTunes just after another player used it waits up to 3 s more for its final year. The client
  retries on the 429 (`retryAfterMs`). Only production traffic can measure this.

### 12.5 What the card shows while its year is looked up (decided 2026-09-30)

**The developer's decision, final wording:** the game starts when the QR, title and artist are
ready. While there is **no year to show**, the revealed side shows a **loading animation in place of
the year**. As soon as there is a year to show, it appears **by itself**, with the notice
**"Confirmando año"** or **"Año sin confirmar"** when it applies.

**Scope since decision 5 (§12.8):** everything in this section applies to **every card** when
"Keep cards with no year found" is ON. When it is OFF, the first card is dealt only once its year is
final, so it opens straight on a final year. Every card after it behaves as described here.

This replaces two earlier wordings of the same day. Both are recorded because each changed what is
built:

- "The game does not start until the first card's year is confirmed." That kept the loading screen
  up for the whole verification.
- "Start on a provisional year, but hide the year behind a spinner until it is final." That hid a
  year the player could already have.

The card's year slot, on the **revealed side only**, has four states:

| Card state                               | Year slot shows                                     | Notice below it                                                                  |
| ---------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| No year yet (`year === undefined`)       | The existing loading spinner, in its fixed-size box | The existing `COPY.card.yearPending` line                                        |
| **Provisional** year (`yearProvisional`) | **The year**                                        | **"Confirmando año"**: new copy, a `COPY.card.*` key translated like every other |
| Final, confirmed (`high`)                | The year                                            | None, as today                                                                   |
| Final, unconfirmed (`low`)               | The year                                            | **"Año sin confirmar"**: the existing `COPY.card.yearUnconfirmed`                |

- **Automatic.** The slot re-renders when the reducer records a year. A player looking at the
  revealed side sees the spinner turn into the year, and later "Confirmando año" either disappear
  or turn into "Año sin confirmar". No action is needed.
- **A provisional year can change on screen.** If verification settles on a different year, the new
  year replaces the old one wherever it is shown, the current card included. That is what
  "Confirmando año" is there to say. Counted with `provisional-changes.mts` (scratchpad): **27 of
  542** cards in the replay (5%), and 4 of 60 live. They are mostly the confident corrections of
  §5.3, for example Self Esteem 2002 → 1994 and Lay All Your Love On Me 1977 → 1980.
- **The hidden face (the QR) never changes.** It says nothing about the year and may say nothing,
  because the hidden face must leak nothing.
- **A card whose lookups find nothing at all** (5 of 542 in the replay, 1 of 60 live) depends on the
  option (§12.8). ON: it **stays** and shows the existing "Year unknown" state. OFF: it is dropped
  when its answer is final, as today, and the first card is protected from that by the gate.
- **Accessibility:** the reveal is the app's only live region (`role="status"`). It will announce
  the year when it arrives, and the notice with it. Nothing about it has been checked with a screen
  reader; that joins the existing manual row.

**How often each state appears**, replay of the 542 (live sample of 60 in brackets):

- **Confirmed by the `resolve` stage**, so the slot goes straight from the spinner to a plain year:
  346 (36).
- **A provisional year with "Confirmando año"** until verification: 144 (21). Of those, 27 (4)
  change year when final.
- **The spinner until verification**, because the `resolve` stage found no usable year: 52 (3).
- **"Año sin confirmar" at the end:** 52 (5), against 33 `low` today. Most of them are cards that
  are dropped today: the replay drops 5, against 115.

**Rejected on the way** (they answered a gate that no longer exists):

- **B. Move the start card to the next confirmed one.** It would change which card a shared link
  starts on.
- **C. Drop every unconfirmed card.** 57 cards dropped per 542, against 5.

### 12.6 The rest of the design, as it will be built

**Server.**

- `/api/year` gains `stage=resolve|verify`.
  - `resolve` asks the `resolve`-stage providers. Deezer and MusicBrainz go **in parallel**,
    because a confirmation always needs both (§12.4).
  - `verify` asks the rest, and stops at the first agreement.
- **Every provider's answer is cached separately**: `yearprov:v1:<provider>:<artist>|<title>` for
  Deezer, iTunes and Discogs, and the existing `mbyear:v4:` entry for MusicBrainz. As a result:
  - The order does not affect any cache entry. Reordering the plan needs no version bump and
    discards nothing.
  - **The MusicBrainz answers already cached stay valid**, so the deploy does not force every deck
    to re-resolve at 1 req/s. That was the cost §6.1 expected from a `v5` bump.
  - `verify` reads `resolve`'s answers from the shared cache, never from the client. Under
    `vercel dev`, where the cache never hits, it simply asks again.
  - When every provider is already cached, `resolve` can decide the final answer on its own.
- **One gate per provider** in Redis, from `PROVIDER_GATES` in `rate-limit.ts`: Deezer 120 ms,
  iTunes 3 s, Discogs 1.05 s, MusicBrainz 1.1 s as before.
- A provider that fails or is not configured (for example Discogs without `DISCOGS_KEY` /
  `DISCOGS_SECRET`) is **skipped** rather than failing the card. A busy gate is back-pressure: a 429
  with `retryAfterMs`, and the answers already obtained stay cached.
- The response gains `final: boolean`. A provisional answer gets a short edge cache, never the 30
  days a final `high` gets.

**Client** (the changes §6.2 lists, in the form now decided):

- **Two resolver workers**: one runs `resolve`, the other `verify`, each in play order.
  - The verification queue serves the current card first.
  - A card whose `resolve` stage found nothing stays **pending**; it is not dropped. Only a final
    `null` removes it.
- `YEAR_RESOLVED` gains a provisional flag, stored as `Card.yearProvisional`.
  - A provisional year is **shown**, with "Confirmando año" (§12.5).
  - A final answer replaces it on **every** card, the current one included.
- **The card-1 gate depends on the option** (§12.8):
  - **OFF (default):** it stays, and it waits for the start card's **final** answer instead of the
    first MusicBrainz answer. `preparing` and `PreparingScreen` stay.
  - **ON:** `START` goes straight to `playing`, and nothing waits for a year.
  - Every sentence in `AGENTS.md`, `src/` and the top-level docs that describes the card-1 gate as
    unconditional becomes stale and is updated with the build.
- `CardRevealSide`'s year slot gains the "Confirmando año" line for a provisional year, beside the
  existing pending spinner and the existing "Año sin confirmar" marker.
- `pendingYearCount` counts provisional cards as pending, so **the PDF waits for verification**.
- **Saves:** a saved card without `yearProvisional` reads as final. Old saves need no format bump,
  following the `startIndex` precedent. A resumed provisional card goes straight to the verification
  queue.

### 12.7 What is written so far (not wired, not tested)

> **Status (2026-09-30): superseded. Do not read this table as the state of the code.** The files it
> lists as "Written" and "Edited" were **lost with an uncommitted working tree**: none of them is in
> any commit, stash or checkout ([§13.8](#138-a-note-on-127) records the discovery).
> [Plan 2](../plans/plan.year-fetch-rework-server.md) rebuilt all of them from scratch on
> 2026-09-30, and wired and tested them: `shared/year-providers.ts`, `api/_lib/provider-lookup.ts`,
> `deezer.ts`, `itunes.ts`, `rate-limit.ts`, `cache.ts`, plus `shared/store-match.ts`,
> `api/_lib/store-http.ts`, `musicbrainz-provider.ts`, `year-pipeline.ts` and the staged
> `api/year.ts`. It rebuilt them **without `discogs.ts`**, because Discogs was dropped (§13.12).

| File                                               | State                                                                                                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/year-providers.ts`                         | Written: `YEAR_PROVIDER_PLAN`, the vote (`findConfirmation`, `decideYear`), Deezer's signature, `providerCacheKey`. The only piece that has been exercised, through the replay in §12.3. |
| `api/_lib/provider-lookup.ts`                      | Written: the shared adapter input, output and error shapes.                                                                                                                              |
| `api/_lib/deezer.ts`, `itunes.ts`, `discogs.ts`    | Written: the harness's query and verification logic ported. Two cheaper deviations are recorded in `deezer.ts`'s header.                                                                 |
| `api/_lib/rate-limit.ts`                           | Edited: gates take a key and an interval, with MusicBrainz's as the default, plus `PROVIDER_GATES`.                                                                                      |
| `api/_lib/cache.ts`                                | Edited: a per-provider answer cache beside the unchanged year cache.                                                                                                                     |
| `api/_lib/year-pipeline.ts`, `api/year.ts`, client | **Not started.**                                                                                                                                                                         |
| Tests, the four checks, AGENTS.md, `.env.example`  | **Not started.**                                                                                                                                                                         |

### 12.8 The "Keep cards with no year found" option (decided 2026-09-30)

**The developer's decision.** The playlist picker gets a checkbox, **"Keep cards with no year
found"**. It exists for a player who wants to **print the whole deck**, including the cards no
provider can date: those cards print exactly like the others but **without a year**, so the player
can write it by hand.

**The option changes two things at once, and both are the point:**

| Behaviour                              | **OFF (default)**                                                                  | **ON**                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A card whose final answer is "no year" | **Dropped** from the deck, as today (the 2026-08-05 reversal)                      | **Kept.** Its revealed side shows the existing "Year unknown" state                   |
| When the game starts                   | When the **start card's year is final**: the loading screen waits for verification | As soon as the first card's **QR, title and artist** are ready; no year is waited for |
| The start card ends unconfirmed        | The game starts on it, marked "Año sin confirmar" (option A)                       | The same marker, whenever the year becomes final                                      |
| Cards after the first                  | §12.5: spinner, then the provisional year with "Confirmando año", then final       | §12.5, identical                                                                      |
| The PDF                                | Every card has a year; unchanged                                                   | Yearless cards print **with the year left blank**                                     |

**Why OFF keeps the gate.** With the gate gone, a card whose lookups end with no year is dropped
**while the player is on it**, possibly mid-preview: "the card goes away". That can only happen when
yearless cards are dropped, i.e. only when the option is OFF. With the option ON a card never
leaves the deck, so there is nothing to protect the player from and the game can start at once.

**The first card when OFF: what the wait is.** It is the time to the **final** year, measured in
§12.4 with Deezer and MusicBrainz in parallel: **1 658 ms p50, 4 626 ms p90, 5 844 ms max**, against
1 238 / 3 449 / 5 844 ms for today's one MusicBrainz lookup. That is **~0.4 s more at the median and
up to ~3.3 s more** on the cards that go all the way to Discogs. A start card whose final answer is
"no year" is dropped **before** the game starts, and the gate moves to the card that took its place.
The loading screen itself needs no new copy. Showing a "Confirmando año" line there once the start
card has a provisional year, as proposed earlier, remains possible but was not asked for.

**A residual when OFF: ACCEPTED by the developer (2026-09-30).** The gate protects the **first**
card only. A later card is dropped under the player only if they reach it **before** its lookups
finish **and** those lookups end with no year. The crawl normally runs ahead of the player, and a
yearless ending is ~1% of cards (5 of 542), so this needs both an outrun crawl and a rare card. It
is exactly today's behaviour, since today's reducer already drops a current card mid-game.

The developer accepted the risk: a player normally spends long enough on each card for the next
ones to load. **Nothing is built for it.** Do not add a per-card wait or a "keep once reached"
exception to "fix" it. Should it ever prove to matter, keeping a yearless card once the player has
reached it, even with the option OFF, is the fix to design then.

**What the build needs, below React:**

- **Where the option lives.** `START` gains `keepYearless: boolean`, and `GameState` records it for
  the whole session.
  - The reducer reads it in the three places that filter `year: null` today: `START`,
    `YEAR_RESOLVED` and `RESUME`. So the invariant "no card in a live deck holds `year: null`"
    becomes "…unless the session keeps yearless cards". Every comment that states the invariant
    flatly is updated with it.
  - `PersistedSession` saves it as an **optional** field: absent means `false`, so every existing
    save resumes exactly as it does today, with no format bump (the `startIndex` precedent).
- **The gate:** `START` and `YEAR_RESOLVED` open it on "the current card's answer is final" when the
  option is OFF, and never close it when ON. `START` goes straight to `playing` when ON.
- **The reveal:** `CardRevealSide`'s `none` branch ("Year unknown", "Check this one yourself") is
  kept today only for pre-reversal saves, and becomes a **live** branch again. Its comments say it
  is vestigial and must be updated.
- **The PDF:** `selectPrintableCards` keeps `year: null` cards when the session keeps them, and
  `drawBack` draws the title and artist exactly where it always does and **leaves the year area
  empty**. No line or box is drawn, to keep the print palette unchanged. A box to write in is a
  one-line addition if the developer wants one. `pendingYearCount` still counts only
  `year === undefined` and provisional cards, so the export still **waits** for the crawl: a card
  printed blank that later found a year would be the "quietly short deck" the wait exists to
  prevent. `excludedCount` and `nothing-to-print` are unchanged when OFF.
- **The HUD and the end screen:** when ON, the deck never shrinks, so "cards left" only falls.
  `deckCollapsed` / `no-years-found` can no longer fire, because a deck of yearless cards is still a
  deck.

**What the build needs in the picker:**

- **The control:** a checkbox in `LandingScreen`, between the playlist rows and Start. It is a
  native `<input type="checkbox">` inside its `<label>`, with `focus-visible:focus-ring` and
  `touch-target`, as the design surface requires of every interactive element.
- **The copy:** new keys in `COPY.landing`, a label plus an optional one-line hint ("Useful to print
  the whole deck and write missing years by hand"). They are translated in `copy.es.ts` and
  `copy.ca.ts`, or the typecheck fails. The English label is the developer's own wording. The
  Spanish and Catalan are to be proposed, for example "Mantener cartas sin año" and "Mantenir cartes
  sense any".
- **Remembered per viewer:** the choice is stored under a new key, `jitster:prefs:v1` (never a
  renamed old key), read with the same guarded `localStorage` access as the locale. Default OFF.
  Storing it is a proposal: it is a per-viewer convenience, which is what browser storage is for
  here.
- **A share link and a resumed game.** A link deals **without** passing through the picker, so it
  uses the recipient's remembered choice. It never uses the sender's: the link format stays as it
  is. The shuffle is a hash sort over the card **set**, so the cards two players have in common come
  out in the same order either way; a link promises "same playlist, same shuffle" and never "the
  same deck". A resumed game uses the option it was dealt with, from the save.

**Not measured and not decided:** the checkbox's exact position and wording on a 320 px screen
(rows in `docs/development.md` §5, with the rest of the picker), and whether a printed blank year
needs a guide to write on.

---

## 13. Fifth pass: film scores, Disney and anime openings (2026-09-30)

The developer asked for the provider statistics on three playlists from the picker: **Mejores BSO**
(film scores), **Disney: top 100** and **Openings Català** (anime themes). None of them looks like
the chart and catalogue decks that §2–§12 were measured on, so the numbers there do not carry over.
Per-track data is in
[`spike.year-fetch-rework.soundtracks.csv`](./spike.year-fetch-rework.soundtracks.csv).

### 13.1 Method

- **The same harness as §1–§11**, run from a new scratchpad and not committed. MusicBrainz is the
  real `resolveYear`, with an in-memory cache and the per-instance gate; **Upstash was not touched**.
  Deezer, iTunes (`country=ES`) and Discogs use the same queries and verification as §4.1 and §11.1.
- **The four providers ran in parallel**, one process each, so each stayed under its own limit.
  There was exactly one MusicBrainz process. Nothing failed: no 429s, no Discogs errors, and no
  MusicBrainz 503 that the retry did not absorb.
- **Tracks:** Mejores BSO 99, Disney: top 100 100 (the embed's cap; the playlist is longer),
  Openings Català 47. Six tracks are in both BSO and Disney, so **240 unique**. **Openings Català
  reused its 2026-09-29 rows**: its 47 tracks are unchanged, and the numbers reproduce §2's figures
  for it (3 `high`, 44 no year).
- **The §12 rule** is simulated as decided: ask Deezer, MusicBrainz, iTunes, then Discogs, and stop
  at the first year two independent providers agree on. Deezer's release date and ISRC year are one
  voter. With no agreement, the card keeps a single source as unconfirmed (MusicBrainz, then
  Discogs, then iTunes, then Deezer only if its two dates agree). `shared/year-providers.ts` was
  **not** used: see §13.8.

### 13.2 A new reference: the year a player expects

§11's leave-one-out reference (the other providers agree) is **not enough here**, and this pass
shows why (§13.5). So the BSO and Disney tracks were **hand-labelled** from general knowledge with
the year a player would expect on the card: **the year of the film** the track is from. When a film
reuses an older song in its original recording (Oh, Pretty Woman in _Pretty Woman_), the label is
the song's year. **179 of the 193 tracks got a label**; the other 14 are unknown and are left out of
every precision figure. Each track was also given a **kind**:

| Kind       | What it is                                                                                    | BSO | Disney |
| ---------- | --------------------------------------------------------------------------------------------- | --: | -----: |
| `original` | The original soundtrack recording or single                                                   |  57 |     16 |
| `predates` | An older song the film reused, in its original recording                                      |   7 |      0 |
| `dub`      | A Spanish or Latin-American dubbed performance of a Disney song                               |   8 |     73 |
| `cover`    | A re-recording by a generic act ("Animation Soundtrack Ensemble", "The Film Score Orchestra") |  21 |      3 |

(The six shared tracks count in both columns.) Openings Català could **not** be labelled: the
question there is when each Catalan theme **aired on TV3**, and that is not general knowledge.

### 13.3 Where the pipeline stands today

| Playlist      | Tracks | `high` | `low` | **No year (dropped)** | …with an empty MusicBrainz pool |
| ------------- | -----: | -----: | ----: | --------------------: | ------------------------------: |
| Mejores BSO   |     99 |     53 |     8 |          **38 (38%)** |                              27 |
| Disney        |    100 |     27 |    11 |          **62 (62%)** |                              43 |
| Openings      |     47 |      3 |     0 |          **44 (94%)** |                              36 |
| _The 542, §2_ |    542 |    394 |    33 |             115 (21%) |                            ~109 |

**These are the three worst decks measured so far.** A Disney game today loses almost two cards in
three before it is dealt. The cards it keeps are exact against the labels in **41 of 56 (73%)** on
BSO and **27 of 34 (79%)** on Disney.

### 13.4 The four providers on these playlists

**Coverage** (a verified year from that provider):

| Playlist | MusicBrainz | iTunes    | Deezer   | Discogs  | Any of them |
| -------- | ----------- | --------- | -------- | -------- | ----------- |
| BSO      | 61 (62%)    | 70 (71%)  | 68 (69%) | 57 (58%) | 81 (82%)    |
| Disney   | 38 (38%)    | **86**    | 61 (61%) | **8**    | 93 (93%)    |
| Openings | 3 (6%)      | **45/47** | 39/47    | 5/47     | 46/47       |

**Precision against the labels**, BSO and Disney together (exact / answers given):

| Kind (tracks)   | MusicBrainz     | iTunes           | Deezer date  | Deezer ISRC  | Discogs         |
| --------------- | --------------- | ---------------- | ------------ | ------------ | --------------- |
| `original` (73) | 41/52 (79%)     | **57/65 (88%)**  | 24/61 (39%)  | 33/61 (54%)  | **45/51 (88%)** |
| `predates` (7)  | 6/7             | 4/7              | 0/7          | 5/7          | **7/7**         |
| `dub` (75)      | 20/28 (71%)     | 28/64 (44%)      | 10/43 (23%)  | 12/43 (28%)  | none answered   |
| `cover` (24)    | 0/2             | 1/8              | 0/7          | 0/7          | 1/2             |
| **All (179)**   | **67/89 (75%)** | **90/144 (63%)** | 34/118 (29%) | 50/118 (42%) | **53/60 (88%)** |

Read by provider:

- **MusicBrainz** is still the most trustworthy source that answers often. Its `high` tier is exact
  in 40 of 49 on BSO and 21 of 25 on Disney. But it has **no answer for 63% of the dubs** and almost
  none for the covers.
- **iTunes** covers nearly everything, and on original recordings it is as good as Discogs (88%).
  **On dubs it is right less than half the time (44%)**, and when it is wrong it is late: a Spanish
  Disney song is sold on a compilation, and iTunes dates the compilation. All three of its answers
  for Peter Pan songs, for example, read **2002**; the film is from 1953.
- **Deezer** is worse here than anywhere else in the spike: **29%** exact. It is a catalogue of
  editions (§4.2), and these playlists are almost all old catalogue sold on reissues. Its ISRC year
  is better (42%), but still poor.
- **Discogs** is the most precise (88%), and the only provider that got every `predates` song
  right. But it catalogues physical records and has **nothing for the Spanish dubs**: 8 of 100
  Disney tracks, 5 of 47 openings.

### 13.5 The §12 rule on these playlists

| Playlist | Confirmed | Unconfirmed                    | **No year** | Confirmed at (MB / iTunes / Discogs) |
| -------- | --------: | ------------------------------ | ----------: | ------------------------------------ |
| BSO      |        58 | 22 (MB 7, iTunes 11, Deezer 4) |      **19** | 28 / 24 / 6                          |
| Disney   |        41 | 50 (MB 8, iTunes 39, other 3)  |       **9** | 11 / 29 / 1                          |
| Openings |        32 | 14 (iTunes 13, Deezer 1)       |       **1** | 1 / 31 / 0                           |

Exact against the labels (labelled tracks only, so the counts are smaller than above):

| Playlist | Confirmed       | Unconfirmed | Every card with a year |
| -------- | --------------- | ----------- | ---------------------- |
| BSO      | **53/56 (95%)** | 3/18 (17%)  | 56/74 (76%)            |
| Disney   | 29/35 (83%)     | 16/48 (33%) | **45/83 (54%)**        |
| Openings | not labelled    | —           | —                      |

What the rule does here:

1. **It keeps far more cards.** Dropped cards go from 38 to 19 (BSO), from 62 to 9 (Disney) and from
   44 to 1 (Openings). On the 542 it was 115 to 5.
2. **But the extra cards are mostly unconfirmed, and unconfirmed is mostly wrong.** On Disney 50
   cards end unconfirmed, 39 of them on iTunes alone, and only a third of the unconfirmed years
   match the film. They would carry the amber "Año sin confirmar" marker. That is honest, but on
   this deck it means "probably wrong" two times in three.
3. **The consensus reference hides this.** Against "3 of 4 providers agree", every confirmed answer
   on all three playlists scores 58 of 58. Against the labels, confirmed is 90% (82 of 91). The
   consensus can only score the 58 cards it covers, and those are the easy ones.
4. **The errors all point the same way: late.** Of the 53 answers that miss their label, **52 are
   later** than the film. They are reissues, compilations and re-recordings, never an earlier year.
5. **The stores are not always independent.** The rule counts iTunes and Deezer as two providers,
   but both receive the label's release metadata.
   - Two Disney tracks show §5.4's failure for real. `Bella` and `Asalto al castillo` are
     **confirmed as 2006** by iTunes plus Deezer's ISRC, both taken from the 2006 special edition of
     _La Bella y la Bestia_ (1991).
   - On Openings Català, **29 of the 32 confirmations are iTunes plus Deezer alone** agreeing on the
     release date of the SX3 CD that carries the theme (1992, 2001, 2002…), which is not when it
     aired. For example, `Bola De Drac (Makafushigi Adventure)` is confirmed as **2002**, and _Bola
     de Drac_ was on TV3 from 1990.
   - **Decision 4 (§12.1) is measured here for the first time.** The rule overturned a MusicBrainz
     `high` on 8 cards. **5 were corrections** (Schindler's List 2026 → 1993, I Don't Want To Miss A
     Thing 1997 → 1998, Up 2008 → 2009, Bad Boys 1986 → 1987, The Goonies 'R' Good Enough
     1983 → 1985), **2 broke a correct year**, and 1 is unlabelled. The two breaks are
     `Pink Panther Theme`, 1963 → **2006** (iTunes and Deezer both list a 2006 reissue), and
     `Legends of the Fall`, 1994 → 1995.
6. **MusicBrainz requests do not go down.** Deezer never confirms alone, so MusicBrainz is asked for
   every card: 637 requests for the 240, exactly as today. Letting Deezer's recent-release signature
   confirm alone (§12.2's `finalWhenCertain`) saves only 29, because the signature needs a year from
   2015 on and these playlists are old catalogue.

### 13.6 Why these playlists fail

**The year of the recording is not the year of the film.** Every provider answers "when was this
recording released", and on these decks that is often not what the card should say:

| Kind       | What the providers date                                         | Result under §12                                                            |
| ---------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `original` | The soundtrack album, usually the film's year                   | **60/67 (90%)** exact                                                       |
| `predates` | The original single                                             | 7/7 exact                                                                   |
| `dub`      | The Spanish recording or, more often, a later compilation of it | **32/68 (47%)** exact; 36 of the misses are later                           |
| `cover`    | A cheap re-recording from 1990–2013                             | 13 of 24 get **no year**; of the 11 that get one, only 1 is the film's year |

A cover is the clearest case. `Theme From 2001: A Space Odyssey` by "Movie Sounds Unlimited" was
recorded decades after 1968, so no provider can give 1968 for **that** recording: it is not from 1968. A dub is a milder case: the Spanish performance comes months or years after the film, and its
compilations come later still.

**The title cleaner leaves film tails in place.** Among the 193 BSO and Disney titles:

| Shape                                                                                                    | Titles | No year from MusicBrainz |
| -------------------------------------------------------------------------------------------------------- | -----: | -----------------------: |
| Spanish film tail: `Bella - de "La Bella y La Bestia"/Banda Sonora Original`                             |      9 |                        9 |
| A dash and a film name: `Take My Breath Away - Love Theme from "Top Gun"`, `You Sexy Thing - Full Monty` |      6 |                        6 |
| Edition words: `Soundtrack Version`, `2007 Remastered Version Saturday Night Fever`, `Re-Recorded`       |      5 |                        5 |
| Doubled apostrophes as quotes: `From Walt Disney's ''Mary Poppins''`                                     |      2 |                        2 |

All 22 are MusicBrainz misses. They belong in P2 (§8). **What stripping them would recover is
unmeasured**: the §3.3 variants were not re-run on these titles.

**Cast credits instead of artists.** 13 tracks are credited to "Chorus - Peter Pan", "Coro - La
Bella y La Bestia", "Cast - Frozen" and the like, and 12 of them get no year from MusicBrainz. The
stores match them because they carry the same odd credit; MusicBrainz credits the real singers.

### 13.7 What this changes

- **§12's figures are an average over a mixed deck, and they do not hold for these playlists.** On
  them the rule drops fewer cards but shows a wrong year far more often.
  - Confirmed years match the film in 95% (BSO) and 83% (Disney) of cases, against §12.3's 99.7%.
    (That figure was measured against the consensus, which §13.5 point 3 shows is the kinder
    reference.)
  - Counting unconfirmed years too, only 76% (BSO) and 54% (Disney) of the years shown are the
    film's.
- **A question for the developer: what should a soundtrack card say?** The pipeline answers "the
  year of this recording"; a player expects "the year of the film". No provider in this spike
  answers the second question. A fix would be a different lookup, of the film rather than the
  recording, and that is beyond a spike. It is recorded here as the reason these decks will stay
  imprecise.
- **Also for the developer: the single-source fallback on these decks.** Disney's unconfirmed years
  are right one time in three. Showing them marked or dropping them is §10.5's question, with a much
  worse number attached.
- **The independent fixes still stand**, and this pass adds shapes to P2: the Spanish `- de "…"`
  tail, `Soundtrack Version`, doubled-apostrophe quotes and a trailing film name.

### 13.8 A note on §12.7

§12.7 lists `shared/year-providers.ts`, `api/_lib/provider-lookup.ts`, `deezer.ts`, `itunes.ts` and
`discogs.ts` as written, and `api/_lib/rate-limit.ts` and `cache.ts` as edited. **On 2026-09-30
none of it is in the checkout**: the five files do not exist, `rate-limit.ts` has no
`PROVIDER_GATES`, and `cache.ts` has no per-provider cache. The working tree is clean, and no branch,
stash or commit contains any of it. So the whole of §12.7 is stale, and the build starts from
nothing. This pass re-implemented the §12 decision rule inside the harness (`analyze3.ts`), from
§12.2's description.

One more MusicBrainz oddity turned up: two `high` answers are **2026** (Theme From Schindler's List
and the E.T. Flying Theme), a year that cannot be a first release for either. The rule corrected the
first; the second stays 2026, unconfirmed, because no other provider agreed on anything.

### 13.9 The developer's answers, and the provider order for these playlists (2026-09-30)

The developer answered §13.7's two questions:

1. **A card shows the year of the RECORDING**, not the year of the film. So a cover's own year and a
   dub's own year are the right answers. The §13.2 film labels stay valid as ground truth only for
   `original` and `predates` tracks (74 labelled), where the recording's year is the film's (or the
   song's). **A dub or a cover now has no ground truth in this spike.** A compilation date is still
   wrong for them, because a compilation is not the recording's first release, but that can no
   longer be measured here.
2. **Single-source years are shown, marked "Año sin confirmar"**, which is what §12 already does.
   So a card is dropped only when no provider answers at all.

Then the developer asked which order the providers should be asked in for these playlists.

**The order does not decide how many cards are confirmed.** With "stop at the first agreement", a
card is confirmed whenever some pair of providers agrees, and the rule keeps asking until one does.
The order only decides **which year wins** when two pairs agree on different years, and **what it
costs**. All 24 orders were simulated (`order-eval.ts`, scratchpad), with the first two providers
asked in parallel and §12.4's per-step p50 latencies:

| Order (first two in parallel)            | Soundtracks: exact, `original`+`predates` | Mean time to the final year | MB / iTunes / Discogs requests (240) | The 542: exact vs consensus | Fixtures |
| ---------------------------------------- | ----------------------------------------: | --------------------------: | -----------------------------------: | --------------------------: | -------: |
| **Deezer ∥ MB → iTunes → Discogs (§12)** |                                     67/74 |                       2.7 s |                      637 / 200 / 368 |                     342/343 |    21/22 |
| Deezer ∥ MB → Discogs → iTunes           |                                 **69/74** |                       3.5 s |                      637 / 177 / 626 |                     342/343 |    21/22 |
| MB ∥ Discogs → Deezer → iTunes           |                                 **69/74** |                       2.9 s |                      637 / 177 / 738 |                 **343/343** |    21/22 |
| Deezer ∥ iTunes → MB → Discogs (fastest) |                                     67/74 |                   **2.3 s** |                      421 / 240 / 368 |                     339/343 |    21/22 |
| Deezer ∥ iTunes → Discogs → MB           |                                     68/74 |                       2.6 s |                      368 / 240 / 474 |                     339/343 |    22/22 |

Every order confirms the same 131 of the 240 and drops the same 27. **Only 2 of the 240 cards change
year between orders**, both BSO originals: `Out Of Reach` (MusicBrainz and iTunes agree on 1999; the
single is from 2001) and `Legends of the Fall` (iTunes and Deezer agree on 1995; the film is from
1994). Putting Discogs before iTunes fixes both, at 0.8 s more per card and three times the Discogs
requests. Throughput is ~19–21 cards a minute in every order, because MusicBrainz, iTunes and
Discogs are all global limits of about the same size per card.

**Recommendation: keep the §12 order, and do not give these playlists an order of their own.**

- The best order for these playlists wins 2 cards in 74, and on one of the two the label is
  arguable. It does not justify a second constant, and a per-deck order needs the app to know what
  kind of deck it holds, which it does not.
- The one order to refuse is **the two stores first** (Deezer ∥ iTunes). It is the fastest, but it
  lets their correlated reissue dates confirm before MusicBrainz is asked: 3 more errors on the 542 than the §12 order.
- ~~**The bigger lever is not the order but the vote**: counting iTunes and Deezer as one voter
  raises the soundtracks to 69/74 and costs nothing on the 542.~~ **Wrong, corrected in §13.11:**
  the consensus reference cannot see the cards it changes, and on the 542 it undoes three
  corrections §5.3 verified by hand.

### 13.10 iTunes or Discogs, if only one stays (2026-09-30)

The developer asked which of the two to keep, for performance and speed. Simulated
(`drop-eval.ts`, scratchpad) in the §12 order with the other one removed, stores counted as two
voters. Latency is §12.4's per-step p50, summed; Discogs' figure includes its own 1.05 s spacing.

| Pipeline                                   | Soundtracks: no year / 240 | …exact, originals (74) | The 542: no year | …exact vs consensus | Time to the final year, mean / p90 (240) | Discogs requests (240 / 542) |
| ------------------------------------------ | -------------------------: | ---------------------: | ---------------: | ------------------: | ---------------------------------------: | ---------------------------: |
| All four (§12)                             |                         27 |                     67 |                5 |             342/343 |                            2.7 s / 4.0 s |                    368 / 199 |
| **Without Discogs** (Deezer ∥ MB → iTunes) |                     **28** |                     64 |            **5** |         **342/343** |                        **1.6 s / 1.6 s** |                        0 / 0 |
| Without iTunes (Deezer ∥ MB → Discogs)     |                    **120** |             60 (of 65) |           **49** |             342/343 |                            3.2 s / 3.6 s |                    626 / 546 |

**Keep iTunes.**

- **Without iTunes the decks collapse.** Discogs has nothing for Spanish dubs, anime openings or
  streaming-only music, so dropped cards go from 27 to 120 of 240 (Disney 9 → 55, Openings 1 → 41),
  and from 5 to 49 on the 542. It is also the slowest provider: 2 to 4 requests a card behind its
  1.05 s spacing.
- **Without Discogs little is lost, but not nothing.** One more card dropped of 240 and none on the
  542, with the same 342/343 against the consensus and the same 21/22 fixtures. But the consensus
  cannot score the cards whose year changes (§13.11), so they were checked one by one:
  - on the soundtracks, 3 labelled originals get worse, all to a lone MusicBrainz `low`:
    A Whole New World 1992 → 2014, (I've Had) The Time of My Life 1987 → 2024, Bad Boys 1987 → 1986;
  - on the 542, 3 years change, and 2 of them are known wrong: Bulls On Parade 1996 → 1992 and
    GOSSIP 2023 → 2024.

  That is about 5 known-wrong years per ~780 cards. In exchange the final year arrives **~1.1 s
  sooner on average and ~2.4 s sooner at p90**, because Discogs was the long last step.

- **Throughput does not change** (~19–21 cards a minute either way): the bound is MusicBrainz's
  global limit, not the third provider.
- **Dropping Discogs one: one fewer key, gate and adapter** to build and operate.

**So: keep iTunes over Discogs.** Whether to drop Discogs at all is a trade-off between ~0.6% of
cards and ~1 s. Without Discogs, counting the stores as one voter would be much worse (342 → 324 of
343 on the 542), but §13.11 rejects that rule anyway.

A cheaper patch for the three soundtrack losses was also measured: when nobody agrees, rank iTunes
above a MusicBrainz `low`. Without Discogs it recovers A Whole New World and The Time of My Life,
but it moves three dubs to iTunes' compilation dates (for example, La Bella y la Bestia (Dueto)
1992 → 2006, the reissue). It is not proposed.

### 13.11 Stores as one voter, keeping all four providers (2026-09-30)

The developer asked whether counting iTunes and Deezer as one voter is worth its cost while keeping
both. **No.** Measured with `voter-eval.ts` (scratchpad), all four providers in the §12 order:

- **The consensus figure was blind.** "342/343 on the 542" did not change because the rule only
  changes cards on which three providers do **not** agree, and those are exactly the cards the
  consensus cannot score. Checked one by one instead:
  - **The 542: 9 years change, and it gets worse.** Three are corrections §5.3 labelled as
    confident, and the rule undoes them: H.I.E.L.O. 2020 → 2010, Happy Together 1967 → 1966 and
    Iris 1998 → 2017. Abracadabra moves further from its 1984 (1985 → 1996). The other five cannot
    be verified.
  - **The soundtracks: 5 years change**, two of them to known-right years (Pink Panther Theme
    2006 → 1963, Legends of the Fall 1995 → 1994) and three unverifiable.
  - **Net: +2 known-right on the soundtracks, −4 known-right on the 542.**
- **It costs requests and time.** Fewer cards stop early, so Discogs requests go 368 → 535 on the
  240 and 199 → 446 on the 542, and the final year arrives ~0.5 s later on average.
- **The extra markers are mostly false alarms.** 39 soundtrack cards and 54 of the 542 lose their
  confirmation with the same year. Of the 4 that can be scored, 3 were right; most of the rest are
  Openings Català's SX3 dates, which cannot be checked.

**Keep iTunes and Deezer as two voters.** The correlated-reissue failure is real (Pink Panther,
Bella, Asalto al castillo), but on this data this rule causes more errors than it fixes.

### 13.12 Decided: Discogs is dropped, and iTunes wins a tie (2026-09-30)

**The developer's decision:** remove Discogs from the plan, and when no two providers agree,
prefer iTunes' year. The plan is now **Deezer ∥ MusicBrainz → iTunes**, stop at the first
agreement, iTunes and Deezer counted as two voters. Two follow-ups were measured with
`conflict-eval.ts` and `tie-eval.ts` (scratchpad), on the 240 soundtrack tracks, the 542 and the
fixtures (804 cards). Discogs, now out of the plan, served as an **independent referee**, beside the
hand labels: the soundtrack originals, the fixtures, §5.3's confident corrections, and six more
labelled for this question.

**Question 1: MusicBrainz and Deezer agree, iTunes says something else. Which wins?**
The pair.

- It happens on **24 of 804** cards (3%).
- **Labelled: the pair is right 11 times, iTunes 4, and 9 cannot be verified.** iTunes was right on
  Personal Jesus (1989), Centuries (2014), She Don't Give a FO (2017) and Lemon Tree (1995). It was
  wrong on, for example, Unchained Melody (1955: a different recording), You Can Leave Your Hat On
  (1972), Friday I'm in Love (1984, twice) and Men In Black (1988).
- **Discogs sides with the pair 15 times and with iTunes 3 times.**
- iTunes' answer is earlier in 21 of the 24. "Trust iTunes when it is exactly one year earlier" was
  checked and is **not** a rule: it is right on Centuries, She Don't Give a FO and Personal Jesus,
  and wrong on Iko Iko, Summer Of '69 and Fortunate Son.
- **So the rule needs no change, and it stays cheap.** Under "stop at the first agreement", iTunes
  is never asked once MusicBrainz and Deezer agree. That is also what spares iTunes' global
  ~20-a-minute limit on about half of all cards.

**Question 2: "iTunes wins a tie". Over a MusicBrainz `high` too?** Only over a `low`.

| Lone-answer order, when nobody agrees      | Labelled cards exact | Shown years changed vs §12 |
| ------------------------------------------ | -------------------: | -------------------------: |
| MusicBrainz > iTunes > Deezer (§12)        |              110/125 |                          — |
| **MB `high` > iTunes > MB `low` > Deezer** |          **112/125** |                          7 |
| iTunes > MusicBrainz > Deezer              |              113/125 |                         18 |

"iTunes first, even over a `high`" scores one more on the labelled set, but the 11 extra cards it
changes are mostly unlabelled, and they were checked by hand:

- **6 get worse:** Killing In The Name 1992 → 2001, L'Empordà 1989 → 2010, Whistle Stop
  1973 → 2013, and three Spanish dubs moved to compilation dates. For example, La Bella y La Bestia
  (Marta Martorell) goes 1992 → 2006 and Preparaos 1994 → 2003.
- **2–3 get better:** As Time Goes By 1997 → 1942, Bad Boys 1986 → 1987, and probably the E.T.
  Flying Theme, whose MusicBrainz year is an impossible 2026.
- **2 are wrong either way:** Bulls On Parade and The Bard's Song.

**Lone-answer order, ACCEPTED by the developer (2026-09-30): MusicBrainz `high`, then iTunes, then
MusicBrainz `low`, then Deezer only if its two dates agree.** Over a `low`, iTunes recovers A Whole
New World 2014 → 1992 and (I've Had) The Time of My Life 2024 → 1987, which are the losses §13.10
charged to dropping Discogs. It also moves three dubs to compilation or reissue dates: Hakuna Matata
1994 → 2003, La Bella y la Bestia (Dueto) 1992 → 2006, and Parte De Tu Mundo 2019 → 2002, where
neither year is likely right.

**The design as it now stands**, and as it is written into the plans:

| Rule                  | Decided                                                                                   | Where          |
| --------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| Providers and order   | Deezer ∥ MusicBrainz (`resolve`), then iTunes (`verify`). **No Discogs**                  | §13.10, §13.12 |
| Confirmation          | Two independent providers agree; stop there. Deezer's two dates are one voter             | §12.1          |
| iTunes vs Deezer      | **Two voters**                                                                            | §13.11         |
| MB + Deezer vs iTunes | The pair stands; iTunes is not asked                                                      | §13.12         |
| Nobody agrees         | Shown marked "Año sin confirmar": MB `high` > iTunes > MB `low` > Deezer (dates agree)    | §13.9, §13.12  |
| What the year means   | The **recording's** year                                                                  | §13.9          |
| Expected on the 542   | 474 confirmed, 63 unconfirmed, 5 without a year, 342/343 vs the consensus, 21/22 fixtures | §13.10         |

This supersedes §12.2's four-step table and its `unconfirmedTrust` order. The plans updated on
2026-09-30 to match are
[`plan.year-fetch-rework-server.md`](../plans/plan.year-fetch-rework-server.md) (Discogs removed, the
trust tiers, the two-voter rule, the new replay targets) and
[`plan.year-fetch-rework-mb-fixes.md`](../plans/plan.year-fetch-rework-mb-fixes.md) (the soundtrack
title tails of §13.6 added to P2, now that the recording's own title must find it).
