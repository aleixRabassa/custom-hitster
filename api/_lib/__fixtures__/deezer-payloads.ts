/**
 * Captured Deezer responses for `api/_lib/deezer.test.ts` and the cross-layer
 * `api/_lib/year-votes.test.ts`: one capture per ground-truth track of
 * `shared/__fixtures__/year-candidates.ts` (the 21 `YEAR_FIXTURES` and Personal Jesus), keyed
 * by that file's `key`, plus one real quota refusal.
 *
 * These are RAW responses, trimmed -- they pin the JSON shape `deezer.ts` parses. The answers
 * they produce live in `shared/__fixtures__/year-votes.ts`, for the same reason the
 * MusicBrainz split exists: a `shared/` test importing from `api/` would drag Node-side code
 * into the browser typecheck.
 *
 * ## Provenance
 *
 * Captured 2026-09-30, 18:51-18:53 UTC, from `https://api.deezer.com`, keyless, from one
 * machine in Spain, by a scratch script (`.scratch/plan2/capture.ts`, git-ignored) that
 * builds its URLs exactly as the adapter does -- `deezerSearchUrl()` over
 * `primaryArtistGuess(artist)` and `cleanTrackTitle(title).title`, then `deezerTrackUrl(id)`
 * -- with 150 ms between requests. Never pointed at Upstash.
 *
 * ```
 * GET /search?q=<primary artist> <cleaned title>&limit=10
 * GET /track/<id>                     -- for EVERY search row, not only the verified ones
 * ```
 *
 * The capture fetched a track body for every row (22 searches + 218 tracks = 240 requests)
 * so the `track/{id}` bound could be measured rather than assumed; the adapter itself spends
 * **56** requests over these 22 tracks (1 search plus at most `DEEZER_TRACK_FETCH_LIMIT`
 * verified rows each). The extra bodies are kept because the mutation guard in
 * `year-votes.test.ts` needs the dates of rows the adapter would never fetch.
 *
 * **Trimmed, not verbatim, and trimmed by FIELD only.** Every search row is kept, in Deezer's
 * order, verified or not -- the unverified ones are what the verification tests and the
 * mutation guards bite on. Search rows keep `id`, `title`, `title_short`, `duration`, `isrc`,
 * `type` and `artist.name`; track bodies keep `release_date` and `isrc`. Everything else was
 * dropped: `link`, `rank`, the signed `preview` URL, `md5_image`, the `explicit_*` flags, the
 * inlined `album`, the artist pictures, `contributors`, `available_countries`, `track_token`,
 * `bpm`, `gain`, and the search's `total`/`next`. Nothing was invented: every value came off
 * the wire. The scratch generator (`.scratch/plan2/gen.ts`) ran both adapters over the raw and
 * the trimmed bodies and got identical outcomes and identical request logs for all 22 tracks.
 *
 * ## Drift against the spike
 *
 * The spike CSV (`docs/spikes/spike.year-fetch-rework.data.csv`) holds the 542 playlist
 * tracks, and none of the 22 fixtures is among them (its one "Layla" is a different Spotify
 * track, credited "Derek & The Dominos"). So these were checked against the spike's own
 * per-track answers for the 22 (spike §4.3, `fixtures-check.json` in the spike session's
 * scratchpad, same requests, every verified row of ten fetched), and the adapter was ALSO run
 * live the same day over a seeded 30-track sample of the CSV (mulberry32(20260930); captured
 * with the same script, not committed).
 *
 * - **The 22:** 20 identical in both years. Two differ, both from Deezer's catalogue moving:
 *   - `sweetChild`: 1988 / ISRC 1987 then, 2016 / ISRC 1929 now. The row dated 1988 is no
 *     longer among the ten; the top verified row is the 2018 Super Deluxe, and the third
 *     fetched (row 9) is a "Legendary FM Broadcasts" live bootleg dated 2016-01-01 whose
 *     length is within 10 s of the studio take. Its ISRC, `GBSMU2955085`, has the two-digit
 *     year `29`, which `isrcYear()`'s pivot reads as 1929 (the spike harness read it as 2029,
 *     which its minimum then ignored). The `GBSMU` registrant emits nonsense years (26, 29,
 *     34, 39, 46 and 64 across these captures), and as the MINIMUM this 1929 masks the first
 *     fetched row's correct back-coded `USGF18714809` (1987) -- so the card now confirms at
 *     `verify` rather than at `resolve`, with the same year. It is deliberately NOT floored
 *     at 1986: back-coded pre-1986 years are routine and correct (see `isrcYear()` in
 *     `shared/year-providers.ts`, where the replay that measured it is cited).
 *     **The 1929 is read at a FROZEN clock.** `isrcYear()` pivots on next year's two digits,
 *     so from 2028-01-01 the same code would read 2029; `api/_lib/year-votes.test.ts` fakes
 *     `Date` at this capture's day, so the pinned row stays what these bytes produced on
 *     2026-09-30 instead of going red on a calendar date.
 *   - `bohemianRhapsody`: ISRC year 2001 then, 2003 now. The release-date year (1975) is
 *     unchanged; the second verified row is now the 2003-coded Wembley live release, and
 *     whatever row carried a 2001 code is gone from the ten.
 * - **The CSV sample of 30:** the release-date year equals the CSV's `deezer_year` 30 of 30
 *   times; the ISRC year equals `deezer_isrc_year` 29 times. The miss is AC/DC's "T.N.T."
 *   (1934 now, 1976 in the CSV): a `GBSMU3417186` FM-broadcast bootleg is the third verified
 *   row, and the same pivot reads its `34` as 1934 where the harness read 2034. (The CSV's
 *   1976 is itself a back-coded `AUAP07600012`, the recording's real year -- which a 1986
 *   floor would also have discarded.)
 *
 * **The two nulls are expected, and pinned rather than fixed.** `layla`: the fixture's
 * artist is "Derek and the Dominos" and every Deezer credit is "Derek & The Dominos"; `&`
 * normalises to a space, so the token "and" is never in the credit. `underPressure`:
 * `primaryArtistGuess("Queen & David Bowie")` keeps all three names, and Deezer credits the
 * studio rows to "Queen" alone. Both are the token rule doing what the spike measured; the
 * spike's own run was null on both too.
 *
 * ## The quota body
 *
 * `DEEZER_QUOTA_EXCEEDED` is REAL: captured 2026-09-30 at 19:00:21 UTC from a burst of 60
 * parallel searches (`.scratch/plan2/burst.ts`), of which 5 came back with it -- served with
 * **HTTP 200** and `application/json`, which is why the adapter reads the body. It carries a
 * `type` field that spike §11.2's quotation omitted.
 */

/** One track's capture: the search, and a `track/{id}` body for EVERY search row. */
export interface DeezerCapture {
  /** The `YEAR_FIXTURES` / `YEAR_LIMITATION_FIXTURES` key. */
  key: string;
  search: { url: string; body: unknown };
  tracks: readonly { url: string; body: unknown }[];
}

export const DEEZER_CAPTURES: readonly DeezerCapture[] = [
  {
    key: 'billieJean',
    search: {
      url: 'https://api.deezer.com/search?q=Michael%20Jackson%20Billie%20Jean&limit=10',
      body: {
        data: [
          {
            id: 4603408,
            title: 'Billie Jean',
            title_short: 'Billie Jean',
            duration: 293,
            isrc: 'USSM19902991',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
          {
            id: 3362586621,
            title: 'Michael Jackson Billie Jean (DJ Ibrahim - Ali Shaa’ban Remix Remix)',
            title_short: 'Michael Jackson Billie Jean (DJ Ibrahim - Ali Shaa’ban Remix Remix)',
            duration: 186,
            isrc: 'QZNWW2562356',
            type: 'track',
            artist: { name: 'Ibrahim_theDJ' },
          },
          {
            id: 2015880647,
            title: 'Billie Jean (Long Version)',
            title_short: 'Billie Jean',
            duration: 380,
            isrc: 'USSM10800026',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
          {
            id: 555650,
            title:
              'Billie Jean (2008 Kanye West Mix) (feat. Kanye West) (Thriller 25th Anniversary Remix)',
            title_short: 'Billie Jean (2008 Kanye West Mix) (feat. Kanye West)',
            duration: 275,
            isrc: 'USSM10705931',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
          {
            id: 555655,
            title: 'Billie Jean (1981 Home Demo)',
            title_short: 'Billie Jean (1981 Home Demo)',
            duration: 140,
            isrc: 'USSM10107865',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
          {
            id: 395175042,
            title: 'Billie Jean (Live 1987 FM Broadcast)',
            title_short: 'Billie Jean (Live 1987 FM Broadcast)',
            duration: 374,
            isrc: 'GBSMU3962896',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
          {
            id: 3486697321,
            title: 'Billie Jean (live)',
            title_short: 'Billie Jean',
            duration: 375,
            isrc: 'FXR022502468',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
          {
            id: 555664,
            title: 'Billie Jean (Underground Mix)',
            title_short: 'Billie Jean',
            duration: 406,
            isrc: 'USSM10800117',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
          {
            id: 3581808611,
            title: 'Billie Jean (Live)',
            title_short: 'Billie Jean',
            duration: 428,
            isrc: 'GXFHP2599451',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
          {
            id: 14552224,
            title:
              "Immortal Megamix: Can You Feel It / Don't Stop 'Til You Get Enough / Billie Jean/Black or White (Immortal Version)",
            title_short:
              "Immortal Megamix: Can You Feel It / Don't Stop 'Til You Get Enough / Billie Jean/Black or White",
            duration: 550,
            isrc: 'USSM11105976',
            type: 'track',
            artist: { name: 'Michael Jackson' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/4603408',
        body: { release_date: '2009-10-26', isrc: 'USSM19902991' },
      },
      {
        url: 'https://api.deezer.com/track/3362586621',
        body: { release_date: '2025-05-01', isrc: 'QZNWW2562356' },
      },
      {
        url: 'https://api.deezer.com/track/2015880647',
        body: { release_date: '2022-11-18', isrc: 'USSM10800026' },
      },
      {
        url: 'https://api.deezer.com/track/555650',
        body: { release_date: '2008-02-08', isrc: 'USSM10705931' },
      },
      {
        url: 'https://api.deezer.com/track/555655',
        body: { release_date: '2008-02-08', isrc: 'USSM10107865' },
      },
      {
        url: 'https://api.deezer.com/track/395175042',
        body: { release_date: '2017-01-01', isrc: 'GBSMU3962896' },
      },
      {
        url: 'https://api.deezer.com/track/3486697321',
        body: { release_date: '1996-07-30', isrc: 'FXR022502468' },
      },
      {
        url: 'https://api.deezer.com/track/555664',
        body: { release_date: '2008-02-08', isrc: 'USSM10800117' },
      },
      {
        url: 'https://api.deezer.com/track/3581808611',
        body: { release_date: '2025-09-29', isrc: 'GXFHP2599451' },
      },
      {
        url: 'https://api.deezer.com/track/14552224',
        body: { release_date: '2011-11-21', isrc: 'USSM11105976' },
      },
    ],
  },
  {
    key: 'hotelCalifornia',
    search: {
      url: 'https://api.deezer.com/search?q=Eagles%20Hotel%20California&limit=10',
      body: {
        data: [
          {
            id: 426703682,
            title: 'Hotel California (2013 Remaster)',
            title_short: 'Hotel California',
            duration: 391,
            isrc: 'USEE11300353',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 642692332,
            title: 'Hotel California (Live On MTV, 1994)',
            title_short: 'Hotel California',
            duration: 432,
            isrc: 'USWWW0202466',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 1080659922,
            title: 'Hotel California (Live)',
            title_short: 'Hotel California',
            duration: 440,
            isrc: 'UKDNQ1542141',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 426703852,
            title: 'Hotel California (Live at The Forum, Los Angeles, CA, 10/20-22/1976)',
            title_short: 'Hotel California',
            duration: 409,
            isrc: 'USRH11703166',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 14611326,
            title: 'Hotel California (Live; 1999 Remaster)',
            title_short: 'Hotel California',
            duration: 420,
            isrc: 'USEE19900349',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 972434422,
            title: "Hotel California ('Live' at The Summit, Houston, 1976)",
            title_short: "Hotel California ('Live' at The Summit, Houston, 1976)",
            duration: 422,
            isrc: 'UKDNQ1545197',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 1107316982,
            title: 'Hotel California (Live From The Forum, Inglewood, CA, 9/12, 14, 15/2018)',
            title_short: 'Hotel California',
            duration: 507,
            isrc: 'USRH12000102',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 11858169,
            title: 'Hotel California',
            title_short: 'Hotel California',
            duration: 243,
            isrc: 'GBHFE0611362',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 73485610,
            title:
              'Hotel California (Live at the Millennium Concert, Staples Center, Los Angeles, CA, 12/31/1999; 2013 Remaster)',
            title_short: 'Hotel California',
            duration: 416,
            isrc: 'USEE11300799',
            type: 'track',
            artist: { name: 'Eagles' },
          },
          {
            id: 3521999871,
            title: 'Hotel California (live)',
            title_short: 'Hotel California',
            duration: 425,
            isrc: 'FXR022502858',
            type: 'track',
            artist: { name: 'Eagles' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/426703682',
        body: { release_date: '2017-11-24', isrc: 'USEE11300353' },
      },
      {
        url: 'https://api.deezer.com/track/642692332',
        body: { release_date: '2019-03-08', isrc: 'USWWW0202466' },
      },
      {
        url: 'https://api.deezer.com/track/1080659922',
        body: { release_date: '2020-07-31', isrc: 'UKDNQ1542141' },
      },
      {
        url: 'https://api.deezer.com/track/426703852',
        body: { release_date: '2017-11-24', isrc: 'USRH11703166' },
      },
      {
        url: 'https://api.deezer.com/track/14611326',
        body: { release_date: '2011-03-01', isrc: 'USEE19900349' },
      },
      {
        url: 'https://api.deezer.com/track/972434422',
        body: { release_date: '2020-05-18', isrc: 'UKDNQ1545197' },
      },
      {
        url: 'https://api.deezer.com/track/1107316982',
        body: { release_date: '2020-10-16', isrc: 'USRH12000102' },
      },
      {
        url: 'https://api.deezer.com/track/11858169',
        body: { release_date: '2007-06-15', isrc: 'GBHFE0611362' },
      },
      {
        url: 'https://api.deezer.com/track/73485610',
        body: { release_date: '2000-11-14', isrc: 'USEE11300799' },
      },
      {
        url: 'https://api.deezer.com/track/3521999871',
        body: { release_date: '1980-08-22', isrc: 'FXR022502858' },
      },
    ],
  },
  {
    key: 'sweetChild',
    search: {
      url: "https://api.deezer.com/search?q=Guns%20N'%20Roses%20Sweet%20Child%20O'%20Mine&limit=10",
      body: {
        data: [
          {
            id: 518458172,
            title: "Sweet Child O' Mine",
            title_short: "Sweet Child O' Mine",
            duration: 355,
            isrc: 'USGF18714809',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 1152042,
            title: "Sweet Child O' Mine (Live In Paris / 1992)",
            title_short: "Sweet Child O' Mine",
            duration: 445,
            isrc: 'USIR19915143',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 136212672,
            title: "Sweet Child O' Mine (Live at the Ritz, New York)",
            title_short: "Sweet Child O' Mine (Live at the Ritz, New York)",
            duration: 423,
            isrc: 'UK9FS1610530',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 2681795362,
            title: "Sweet Child O' Mine (Live 1988)",
            title_short: "Sweet Child O' Mine",
            duration: 349,
            isrc: 'GX8KD2473948',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 3655259372,
            title: "Sweet Child O' Mine (Live)",
            title_short: "Sweet Child O' Mine",
            duration: 445,
            isrc: 'USIR19915143',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 457021442,
            title: "Sweet Child O’ Mine (Live: Nakano Sun Plaza, Tokyo 7 Dec '88)",
            title_short: 'Sweet Child O’ Mine',
            duration: 406,
            isrc: 'GBSMU4687927',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 75813106,
            title: "Sweet Child O' Mine (Live In Paris / 1992)",
            title_short: "Sweet Child O' Mine",
            duration: 445,
            isrc: 'USIR19915143',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 1999303997,
            title:
              "Sweet Child O' Mine (Live In Las Vegas, Thomas & Mack Center - January 25, 1992)",
            title_short: "Sweet Child O' Mine",
            duration: 442,
            isrc: 'USUG12200411',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 122891348,
            title: "Sweet Child O' Mine",
            title_short: "Sweet Child O' Mine",
            duration: 386,
            isrc: 'GBSMU2685323',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
          {
            id: 130931054,
            title:
              "Sweet Child O' Mine (Live FM The Ritz 1988 Remastered) (Westwood One FM The Ritz NYC 2nd February 1988 Remastereed)",
            title_short: "Sweet Child O' Mine (Live FM The Ritz 1988 Remastered)",
            duration: 351,
            isrc: 'GBSMU2955085',
            type: 'track',
            artist: { name: "Guns N' Roses" },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/518458172',
        body: { release_date: '2018-06-29', isrc: 'USGF18714809' },
      },
      {
        url: 'https://api.deezer.com/track/1152042',
        body: { release_date: '1999-11-19', isrc: 'USIR19915143' },
      },
      {
        url: 'https://api.deezer.com/track/136212672',
        body: { release_date: '2016-05-01', isrc: 'UK9FS1610530' },
      },
      {
        url: 'https://api.deezer.com/track/2681795362',
        body: { release_date: '2024-02-12', isrc: 'GX8KD2473948' },
      },
      {
        url: 'https://api.deezer.com/track/3655259372',
        body: { release_date: '2025-11-21', isrc: 'USIR19915143' },
      },
      {
        url: 'https://api.deezer.com/track/457021442',
        body: { release_date: '2017-01-01', isrc: 'GBSMU4687927' },
      },
      {
        url: 'https://api.deezer.com/track/75813106',
        body: { release_date: '1999-11-30', isrc: 'USIR19915143' },
      },
      {
        url: 'https://api.deezer.com/track/1999303997',
        body: { release_date: '2022-11-11', isrc: 'USUG12200411' },
      },
      {
        url: 'https://api.deezer.com/track/122891348',
        body: { release_date: '2016-01-01', isrc: 'GBSMU2685323' },
      },
      {
        url: 'https://api.deezer.com/track/130931054',
        body: { release_date: '2016-01-01', isrc: 'GBSMU2955085' },
      },
    ],
  },
  {
    key: 'noWomanNoCry',
    search: {
      url: 'https://api.deezer.com/search?q=Bob%20Marley%20%26%20The%20Wailers%20No%20Woman%20No%20Cry&limit=10',
      body: {
        data: [
          {
            id: 1583148,
            title: 'No Woman No Cry',
            title_short: 'No Woman No Cry',
            duration: 226,
            isrc: 'GBAAN7490002',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 94360002,
            title: 'No Woman No Cry (Live At Music Hall, Boston / 1978)',
            title_short: 'No Woman No Cry',
            duration: 424,
            isrc: 'USUM71417818',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 62270694,
            title: 'No Woman No Cry (Live At The Stanley Theatre, 9/23/1980)',
            title_short: 'No Woman No Cry',
            duration: 365,
            isrc: 'USUM71029406',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 1123838,
            title: 'No Woman No Cry (Bill Laswell Remix)',
            title_short: 'No Woman No Cry',
            duration: 251,
            isrc: 'USIR29700285',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 1152707,
            title: 'No Woman No Cry (Live At The Roxy, 1976)',
            title_short: 'No Woman No Cry',
            duration: 322,
            isrc: 'USIR29200375',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 1390835602,
            title: 'No Woman No Cry (Live)',
            title_short: 'No Woman No Cry',
            duration: 431,
            isrc: 'UKDNQ1560317',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 66315769,
            title: 'No Woman No Cry (Live At Ahoy Hallen/1978)',
            title_short: 'No Woman No Cry',
            duration: 402,
            isrc: 'USUM71302816',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 2664375482,
            title: 'No Woman No Cry (Live)',
            title_short: 'No Woman No Cry',
            duration: 446,
            isrc: 'GX8KD2427380',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 1220247332,
            title: 'No Woman No Cry (Live)',
            title_short: 'No Woman No Cry',
            duration: 447,
            isrc: 'UKDNQ1560302',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
          {
            id: 905452502,
            title: 'No Woman No Cry',
            title_short: 'No Woman No Cry',
            duration: 314,
            isrc: 'UKDNQ1560287',
            type: 'track',
            artist: { name: 'Bob Marley & The Wailers' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/1583148',
        body: { release_date: '2001-06-18', isrc: 'GBAAN7490002' },
      },
      {
        url: 'https://api.deezer.com/track/94360002',
        body: { release_date: '2015-02-17', isrc: 'USUM71417818' },
      },
      {
        url: 'https://api.deezer.com/track/62270694',
        body: { release_date: '2011-02-01', isrc: 'USUM71029406' },
      },
      {
        url: 'https://api.deezer.com/track/1123838',
        body: { release_date: '1997-09-18', isrc: 'USIR29700285' },
      },
      {
        url: 'https://api.deezer.com/track/1152707',
        body: { release_date: '2003-06-24', isrc: 'USIR29200375' },
      },
      {
        url: 'https://api.deezer.com/track/1390835602',
        body: { release_date: '2020-03-17', isrc: 'UKDNQ1560317' },
      },
      {
        url: 'https://api.deezer.com/track/66315769',
        body: { release_date: '2013-04-23', isrc: 'USUM71302816' },
      },
      {
        url: 'https://api.deezer.com/track/2664375482',
        body: { release_date: '2024-02-02', isrc: 'GX8KD2427380' },
      },
      {
        url: 'https://api.deezer.com/track/1220247332',
        body: { release_date: '2021-01-24', isrc: 'UKDNQ1560302' },
      },
      {
        url: 'https://api.deezer.com/track/905452502',
        body: { release_date: '2020-03-17', isrc: 'UKDNQ1560287' },
      },
    ],
  },
  {
    key: 'wishYouWereHere',
    search: {
      url: 'https://api.deezer.com/search?q=Pink%20Floyd%20Wish%20You%20Were%20Here&limit=10',
      body: {
        data: [
          {
            id: 116914042,
            title: 'Wish You Were Here',
            title_short: 'Wish You Were Here',
            duration: 334,
            isrc: 'GBN9Y1100088',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 3697671542,
            title: 'Wish You Were Here (Take 1)',
            title_short: 'Wish You Were Here',
            duration: 301,
            isrc: 'USSM12503288',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 1520205182,
            title: 'Wish You Were Here (Live)',
            title_short: 'Wish You Were Here',
            duration: 395,
            isrc: 'GBN9X1800023',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 116914064,
            title: 'Wish You Were Here (Live)',
            title_short: 'Wish You Were Here',
            duration: 289,
            isrc: 'GBN9X1600010',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 3697671432,
            title: 'Wish You Were Here (feat. Stéphane Grappelli)',
            title_short: 'Wish You Were Here (feat. Stéphane Grappelli)',
            duration: 372,
            isrc: 'GBN9Y1100206',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 1352940262,
            title: 'Wish You Were Here (Live at Knebworth 1990)',
            title_short: 'Wish You Were Here',
            duration: 288,
            isrc: 'GBN9X1900053',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 3697671552,
            title: 'Wish You Were Here (Pedal Steel Instrumental Mix)',
            title_short: 'Wish You Were Here',
            duration: 361,
            isrc: 'USSM12503289',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 814851712,
            title: 'Wish You Were Here (Live at Knebworth 1990)',
            title_short: 'Wish You Were Here',
            duration: 288,
            isrc: 'GBN9X1900053',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 1122138182,
            title: 'Wish You Were Here (2019 remix Live)',
            title_short: 'Wish You Were Here',
            duration: 278,
            isrc: 'GBN9X1900027',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
          {
            id: 3697671372,
            title: 'Wine Glasses',
            title_short: 'Wine Glasses',
            duration: 133,
            isrc: 'GBN9Y1100204',
            type: 'track',
            artist: { name: 'Pink Floyd' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/116914042',
        body: { release_date: '1975-09-15', isrc: 'GBN9Y1100088' },
      },
      {
        url: 'https://api.deezer.com/track/3697671542',
        body: { release_date: '2025-12-12', isrc: 'USSM12503288' },
      },
      {
        url: 'https://api.deezer.com/track/1520205182',
        body: { release_date: '1995-05-29', isrc: 'GBN9X1800023' },
      },
      {
        url: 'https://api.deezer.com/track/116914064',
        body: { release_date: '1988-11-22', isrc: 'GBN9X1600010' },
      },
      {
        url: 'https://api.deezer.com/track/3697671432',
        body: { release_date: '2025-12-12', isrc: 'GBN9Y1100206' },
      },
      {
        url: 'https://api.deezer.com/track/1352940262',
        body: { release_date: '2021-04-30', isrc: 'GBN9X1900053' },
      },
      {
        url: 'https://api.deezer.com/track/3697671552',
        body: { release_date: '2025-12-12', isrc: 'USSM12503289' },
      },
      {
        url: 'https://api.deezer.com/track/814851712',
        body: { release_date: '2019-11-29', isrc: 'GBN9X1900053' },
      },
      {
        url: 'https://api.deezer.com/track/1122138182',
        body: { release_date: '2020-11-20', isrc: 'GBN9X1900027' },
      },
      {
        url: 'https://api.deezer.com/track/3697671372',
        body: { release_date: '2025-12-12', isrc: 'GBN9Y1100204' },
      },
    ],
  },
  {
    key: 'stairwayToHeaven',
    search: {
      url: 'https://api.deezer.com/search?q=Led%20Zeppelin%20Stairway%20to%20Heaven&limit=10',
      body: {
        data: [
          {
            id: 88003859,
            title: 'Stairway to Heaven (Remaster)',
            title_short: 'Stairway to Heaven',
            duration: 482,
            isrc: 'USAT21300959',
            type: 'track',
            artist: { name: 'Led Zeppelin' },
          },
          {
            id: 471132232,
            title: 'Stairway to Heaven (Live 1972; Remaster)',
            title_short: 'Stairway to Heaven',
            duration: 577,
            isrc: 'USRH11703899',
            type: 'track',
            artist: { name: 'Led Zeppelin' },
          },
          {
            id: 549954002,
            title: 'Stairway to Heaven (Live at MSG 1973 Remaster)',
            title_short: 'Stairway to Heaven',
            duration: 653,
            isrc: 'USRH11800510',
            type: 'track',
            artist: { name: 'Led Zeppelin' },
          },
          {
            id: 61929653,
            title: 'Stairway to Heaven (Live: O2 Arena, London - December 10, 2007)',
            title_short: 'Stairway to Heaven',
            duration: 529,
            isrc: 'USAT21204515',
            type: 'track',
            artist: { name: 'Led Zeppelin' },
          },
          {
            id: 88003875,
            title: 'Stairway to Heaven (Sunset Sound Mix)',
            title_short: 'Stairway to Heaven',
            duration: 483,
            isrc: 'USAT21402413',
            type: 'track',
            artist: { name: 'Led Zeppelin' },
          },
          {
            id: 131461454,
            title: 'Stairway to Heaven (Live: 1/4/71 Paris Theatre;Remaster)',
            title_short: 'Stairway to Heaven',
            duration: 529,
            isrc: 'GBCAD1600603',
            type: 'track',
            artist: { name: 'Led Zeppelin' },
          },
          {
            id: 3114282771,
            title: 'Stairway to Heaven',
            title_short: 'Stairway to Heaven',
            duration: 624,
            isrc: 'NLHR52177378',
            type: 'track',
            artist: { name: 'Led Zeppelin' },
          },
          {
            id: 63906377,
            title: 'Stairway to Heaven (Live At The Kennedy Center Honors)',
            title_short: 'Stairway to Heaven (Live At The Kennedy Center Honors)',
            duration: 478,
            isrc: 'USQY51306380',
            type: 'track',
            artist: { name: 'Heart' },
          },
          {
            id: 1955246,
            title: 'Stairway To Heaven (Led Zeppelin Cover)',
            title_short: 'Stairway To Heaven (Led Zeppelin Cover)',
            duration: 516,
            isrc: 'USA560649478',
            type: 'track',
            artist: { name: 'Great White' },
          },
          {
            id: 8631762,
            title: 'Stairway to Heaven (led zeppelin)',
            title_short: 'Stairway to Heaven (led zeppelin)',
            duration: 399,
            isrc: 'USCGH0613854',
            type: 'track',
            artist: { name: 'Scott D. Davis' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/88003859',
        body: { release_date: '1971-11-08', isrc: 'USAT21300959' },
      },
      {
        url: 'https://api.deezer.com/track/471132232',
        body: { release_date: '2003-05-27', isrc: 'USRH11703899' },
      },
      {
        url: 'https://api.deezer.com/track/549954002',
        body: { release_date: '1976-10-22', isrc: 'USRH11800510' },
      },
      {
        url: 'https://api.deezer.com/track/61929653',
        body: { release_date: '2012-11-16', isrc: 'USAT21204515' },
      },
      {
        url: 'https://api.deezer.com/track/88003875',
        body: { release_date: '1971-11-08', isrc: 'USAT21402413' },
      },
      {
        url: 'https://api.deezer.com/track/131461454',
        body: { release_date: '2016-09-16', isrc: 'GBCAD1600603' },
      },
      {
        url: 'https://api.deezer.com/track/3114282771',
        body: { release_date: '2025-01-24', isrc: 'NLHR52177378' },
      },
      {
        url: 'https://api.deezer.com/track/63906377',
        body: { release_date: '2015-02-19', isrc: 'USQY51306380' },
      },
      {
        url: 'https://api.deezer.com/track/1955246',
        body: { release_date: '2007-04-01', isrc: 'USA560649478' },
      },
      {
        url: 'https://api.deezer.com/track/8631762',
        body: { release_date: '2006-01-01', isrc: 'USCGH0613854' },
      },
    ],
  },
  {
    key: 'bohemianRhapsody',
    search: {
      url: 'https://api.deezer.com/search?q=Queen%20Bohemian%20Rhapsody&limit=10',
      body: {
        data: [
          {
            id: 4091937401,
            title: 'Bohemian Rhapsody',
            title_short: 'Bohemian Rhapsody',
            duration: 354,
            isrc: 'GBUM71029604',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 4092342471,
            title: 'Bohemian Rhapsody (Live At Wembley Stadium / July 1986)',
            title_short: 'Bohemian Rhapsody',
            duration: 351,
            isrc: 'GBCEE0300050',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 4091936771,
            title: 'Bohemian Rhapsody (Live Aid)',
            title_short: 'Bohemian Rhapsody',
            duration: 148,
            isrc: 'GBUM71805979',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 1306700592,
            title: 'Bohemian Rhapsody / Radio Ga Ga (Live at Wembley Stadium, 13th July 1985)',
            title_short: 'Bohemian Rhapsody / Radio Ga Ga',
            duration: 390,
            isrc: 'UK6821836636',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 4092335271,
            title: 'Bohemian Rhapsody (Live)',
            title_short: 'Bohemian Rhapsody',
            duration: 328,
            isrc: 'GBCEE0700025',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 4092314011,
            title: 'Bohemian Rhapsody (Live At Milton Keynes Bowl / June 1982)',
            title_short: 'Bohemian Rhapsody',
            duration: 338,
            isrc: 'GBCEE0400076',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 5055001,
            title: 'Bohemian Rhapsody',
            title_short: 'Bohemian Rhapsody',
            duration: 285,
            isrc: 'USWD10937466',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 4092345051,
            title: 'Bohemian Rhapsody (Live)',
            title_short: 'Bohemian Rhapsody',
            duration: 330,
            isrc: 'GBUM71205813',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 4091938531,
            title: 'Bohemian Rhapsody (Live At The Hammersmith Odeon, London / 1975)',
            title_short: 'Bohemian Rhapsody',
            duration: 148,
            isrc: 'GBUM71504419',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 1140885422,
            title:
              'Bohemian Rhapsody (Live At Fire Fight Australia, ANZ Stadium, Sydney, Australia, 2020)',
            title_short: 'Bohemian Rhapsody',
            duration: 143,
            isrc: 'GBUM72004114',
            type: 'track',
            artist: { name: 'Queen' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/4091937401',
        body: { release_date: '1975-11-21', isrc: 'GBUM71029604' },
      },
      {
        url: 'https://api.deezer.com/track/4092342471',
        body: { release_date: '1992-05-26', isrc: 'GBCEE0300050' },
      },
      {
        url: 'https://api.deezer.com/track/4091936771',
        body: { release_date: '2018-10-19', isrc: 'GBUM71805979' },
      },
      {
        url: 'https://api.deezer.com/track/1306700592',
        body: { release_date: '2021-04-26', isrc: 'UK6821836636' },
      },
      {
        url: 'https://api.deezer.com/track/4092335271',
        body: { release_date: '2007-10-09', isrc: 'GBCEE0700025' },
      },
      {
        url: 'https://api.deezer.com/track/4092314011',
        body: { release_date: '2004-11-04', isrc: 'GBCEE0400076' },
      },
      {
        url: 'https://api.deezer.com/track/5055001',
        body: { release_date: '2009-12-11', isrc: 'USWD10937466' },
      },
      {
        url: 'https://api.deezer.com/track/4092345051',
        body: { release_date: '2012-01-01', isrc: 'GBUM71205813' },
      },
      {
        url: 'https://api.deezer.com/track/4091938531',
        body: { release_date: '2015-11-13', isrc: 'GBUM71504419' },
      },
      {
        url: 'https://api.deezer.com/track/1140885422',
        body: { release_date: '2020-10-01', isrc: 'GBUM72004114' },
      },
    ],
  },
  {
    key: 'hallelujahBuckley',
    search: {
      url: 'https://api.deezer.com/search?q=Jeff%20Buckley%20Hallelujah&limit=10',
      body: {
        data: [
          {
            id: 108733464,
            title: 'Hallelujah',
            title_short: 'Hallelujah',
            duration: 414,
            isrc: 'USSM19400915',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 733728072,
            title: 'Hallelujah (Radio Edit)',
            title_short: 'Hallelujah',
            duration: 255,
            isrc: 'USSM10800937',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 733728092,
            title: 'Hallelujah (Live at Bearsville Studios, New York - 1993)',
            title_short: 'Hallelujah',
            duration: 400,
            isrc: 'USSM10701543',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 3019100,
            title: 'Hallelujah (Live at Sin-é, New York, NY - July/August 1993)',
            title_short: 'Hallelujah',
            duration: 555,
            isrc: 'USSM10306444',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 733736732,
            title: 'Hallelujah (Live At Wetlands, New York, NY, August 16, 1994)',
            title_short: 'Hallelujah',
            duration: 510,
            isrc: 'USSM11904241',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 894865,
            title: 'Hallelujah (Live at Olympia, Paris, France - July 1995)',
            title_short: 'Hallelujah',
            duration: 584,
            isrc: 'USSM10104708',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 733736422,
            title: 'Hallelujah (Live at Cabaret Metro, Chicago, IL, May 13, 1995)',
            title_short: 'Hallelujah',
            duration: 523,
            isrc: 'USSM11903219',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 663521032,
            title: 'Hallelujah (Live)',
            title_short: 'Hallelujah',
            duration: 368,
            isrc: 'UKDNQ1539681',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 3437899,
            title: 'Hallelujah (Live at MTV Japan, Tokyo, Japan - January 1995)',
            title_short: 'Hallelujah',
            duration: 452,
            isrc: 'USSM10902080',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
          {
            id: 733734892,
            title: 'Hallelujah (Live at the Bataclan, Paris, France - Feb 1995)',
            title_short: 'Hallelujah',
            duration: 568,
            isrc: 'USSM10101020',
            type: 'track',
            artist: { name: 'Jeff Buckley' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/108733464',
        body: { release_date: '1994-08-23', isrc: 'USSM19400915' },
      },
      {
        url: 'https://api.deezer.com/track/733728072',
        body: { release_date: '2007-05-22', isrc: 'USSM10800937' },
      },
      {
        url: 'https://api.deezer.com/track/733728092',
        body: { release_date: '2007-05-22', isrc: 'USSM10701543' },
      },
      {
        url: 'https://api.deezer.com/track/3019100',
        body: { release_date: '2001-07-03', isrc: 'USSM10306444' },
      },
      {
        url: 'https://api.deezer.com/track/733736732',
        body: { release_date: '2019-08-23', isrc: 'USSM11904241' },
      },
      {
        url: 'https://api.deezer.com/track/894865',
        body: { release_date: '2025-01-20', isrc: 'USSM10104708' },
      },
      {
        url: 'https://api.deezer.com/track/733736422',
        body: { release_date: '2000-05-09', isrc: 'USSM11903219' },
      },
      {
        url: 'https://api.deezer.com/track/663521032',
        body: { release_date: '2019-04-10', isrc: 'UKDNQ1539681' },
      },
      {
        url: 'https://api.deezer.com/track/3437899',
        body: { release_date: '2009-06-02', isrc: 'USSM10902080' },
      },
      {
        url: 'https://api.deezer.com/track/733734892',
        body: { release_date: '1995-10-01', isrc: 'USSM10101020' },
      },
    ],
  },
  {
    key: 'hallelujahCohen',
    search: {
      url: 'https://api.deezer.com/search?q=Leonard%20Cohen%20Hallelujah&limit=10',
      body: {
        data: [
          {
            id: 15218949,
            title: 'Hallelujah',
            title_short: 'Hallelujah',
            duration: 279,
            isrc: 'USSM10026643',
            type: 'track',
            artist: { name: 'Leonard Cohen' },
          },
          {
            id: 1565012,
            title: 'Hallelujah',
            title_short: 'Hallelujah',
            duration: 249,
            isrc: 'USDW10110179',
            type: 'track',
            artist: { name: 'Rufus Wainwright' },
          },
          {
            id: 910674,
            title: 'Hallelujah (Live)',
            title_short: 'Hallelujah',
            duration: 363,
            isrc: 'USUM70749432',
            type: 'track',
            artist: { name: 'Bon Jovi' },
          },
          {
            id: 2926418,
            title: 'Hallelujah (Live in London)',
            title_short: 'Hallelujah',
            duration: 440,
            isrc: 'CAC220900015',
            type: 'track',
            artist: { name: 'Leonard Cohen' },
          },
          {
            id: 1769271107,
            title: 'Hallelujah (Live at Glastonbury)',
            title_short: 'Hallelujah (Live at Glastonbury)',
            duration: 453,
            isrc: 'CAC222000006',
            type: 'track',
            artist: { name: 'Leonard Cohen' },
          },
          {
            id: 87518441,
            title: 'Hallelujah (Live in Dublin)',
            title_short: 'Hallelujah',
            duration: 445,
            isrc: 'CAC221400072',
            type: 'track',
            artist: { name: 'Leonard Cohen' },
          },
          {
            id: 7035215,
            title: 'Hallelujah (Live April 17, 2009; Coachella Music Festival, Indio, California)',
            title_short: 'Hallelujah',
            duration: 458,
            isrc: 'USSM11002879',
            type: 'track',
            artist: { name: 'Leonard Cohen' },
          },
          {
            id: 80869814,
            title: 'Hallelujah  (Live in Austin, 1988)',
            title_short: 'Hallelujah ',
            duration: 414,
            isrc: 'NLB638860001',
            type: 'track',
            artist: { name: 'Leonard Cohen' },
          },
          {
            id: 1080844462,
            title: 'Hallelujah (Live)',
            title_short: 'Hallelujah',
            duration: 479,
            isrc: 'UKDNQ1540202',
            type: 'track',
            artist: { name: 'Leonard Cohen' },
          },
          {
            id: 15218944,
            title: 'The Guests',
            title_short: 'The Guests',
            duration: 399,
            isrc: 'USSM19917391',
            type: 'track',
            artist: { name: 'Leonard Cohen' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/15218949',
        body: { release_date: '2002-10-22', isrc: 'USSM10026643' },
      },
      {
        url: 'https://api.deezer.com/track/1565012',
        body: { release_date: '2007-09-20', isrc: 'USDW10110179' },
      },
      {
        url: 'https://api.deezer.com/track/910674',
        body: { release_date: '2007-10-09', isrc: 'USUM70749432' },
      },
      {
        url: 'https://api.deezer.com/track/2926418',
        body: { release_date: '2009-03-30', isrc: 'CAC220900015' },
      },
      {
        url: 'https://api.deezer.com/track/1769271107',
        body: { release_date: '2022-06-03', isrc: 'CAC222000006' },
      },
      {
        url: 'https://api.deezer.com/track/87518441',
        body: { release_date: '2014-11-28', isrc: 'CAC221400072' },
      },
      {
        url: 'https://api.deezer.com/track/7035215',
        body: { release_date: '2010-09-10', isrc: 'USSM11002879' },
      },
      {
        url: 'https://api.deezer.com/track/80869814',
        body: { release_date: '2012-04-03', isrc: 'NLB638860001' },
      },
      {
        url: 'https://api.deezer.com/track/1080844462',
        body: { release_date: '2020-07-31', isrc: 'UKDNQ1540202' },
      },
      {
        url: 'https://api.deezer.com/track/15218944',
        body: { release_date: '2002-10-22', isrc: 'USSM19917391' },
      },
    ],
  },
  {
    key: 'freeBird',
    search: {
      url: 'https://api.deezer.com/search?q=Lynyrd%20Skynyrd%20Free%20Bird&limit=10',
      body: {
        data: [
          {
            id: 1559717,
            title: 'Free Bird',
            title_short: 'Free Bird',
            duration: 548,
            isrc: 'USMC17301722',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 4257056,
            title: 'Free Bird (Original Version)',
            title_short: 'Free Bird',
            duration: 444,
            isrc: 'USMC17158556',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 538670032,
            title: 'Free Bird (Extended Music Version)',
            title_short: 'Free Bird',
            duration: 606,
            isrc: 'USMC17646157',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 667939562,
            title: 'Free Bird (Live)',
            title_short: 'Free Bird',
            duration: 789,
            isrc: 'UKDNQ1540433',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 535579152,
            title: 'Free Bird (Live)',
            title_short: 'Free Bird',
            duration: 742,
            isrc: 'DEH841800463',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 538673202,
            title: 'Free Bird (Live At Oakland-Alameda County Coliseum/1977)',
            title_short: 'Free Bird',
            duration: 702,
            isrc: 'USMC17749709',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 3803607902,
            title: 'Free Bird (2003 / Live At Amsouth Amphitheatre, TN)',
            title_short: 'Free Bird',
            duration: 758,
            isrc: 'GBAJE0301174',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 788648952,
            title: 'Free Bird (Demo Version)',
            title_short: 'Free Bird',
            duration: 246,
            isrc: 'USMC17047078',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 731087442,
            title: 'Free Bird (Live)',
            title_short: 'Free Bird',
            duration: 757,
            isrc: 'UKDNQ1540419',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
          {
            id: 1414571092,
            title: 'Free Bird',
            title_short: 'Free Bird',
            duration: 858,
            isrc: 'UKDNQ1595118',
            type: 'track',
            artist: { name: 'Lynyrd Skynyrd' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/1559717',
        body: { release_date: '2001-11-20', isrc: 'USMC17301722' },
      },
      {
        url: 'https://api.deezer.com/track/4257056',
        body: { release_date: '1998-11-24', isrc: 'USMC17158556' },
      },
      {
        url: 'https://api.deezer.com/track/538670032',
        body: { release_date: '2018-08-10', isrc: 'USMC17646157' },
      },
      {
        url: 'https://api.deezer.com/track/667939562',
        body: { release_date: '2019-04-18', isrc: 'UKDNQ1540433' },
      },
      {
        url: 'https://api.deezer.com/track/535579152',
        body: { release_date: '2018-09-21', isrc: 'DEH841800463' },
      },
      {
        url: 'https://api.deezer.com/track/538673202',
        body: { release_date: '2018-08-10', isrc: 'USMC17749709' },
      },
      {
        url: 'https://api.deezer.com/track/3803607902',
        body: { release_date: '2026-01-28', isrc: 'GBAJE0301174' },
      },
      {
        url: 'https://api.deezer.com/track/788648952',
        body: { release_date: '2019-11-01', isrc: 'USMC17047078' },
      },
      {
        url: 'https://api.deezer.com/track/731087442',
        body: { release_date: '2019-08-13', isrc: 'UKDNQ1540419' },
      },
      {
        url: 'https://api.deezer.com/track/1414571092',
        body: { release_date: '2021-02-01', isrc: 'UKDNQ1595118' },
      },
    ],
  },
  {
    key: 'likeARollingStone',
    search: {
      url: 'https://api.deezer.com/search?q=Bob%20Dylan%20Like%20a%20Rolling%20Stone&limit=10',
      body: {
        data: [
          {
            id: 14477354,
            title: 'Like a Rolling Stone',
            title_short: 'Like a Rolling Stone',
            duration: 369,
            isrc: 'USSM19922509',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 15177565,
            title: 'Like a Rolling Stone (Live at Free Trade Hall, Manchester, UK - May 17, 1966)',
            title_short: 'Like a Rolling Stone',
            duration: 481,
            isrc: 'USSM16600540',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 1014132,
            title:
              'Like a Rolling Stone (Live at Sony Music Studios, New York, NY - November 1994)',
            title_short: 'Like a Rolling Stone',
            duration: 549,
            isrc: 'USSM19504346',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 71154363,
            title:
              'Like a Rolling Stone (Live at Nippon Budokan Hall, Tokyo, Japan - February/March 1978)',
            title_short: 'Like a Rolling Stone',
            duration: 397,
            isrc: 'USSM11304586',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 8146601,
            title: 'Like a Rolling Stone (Live at Free Trade Hall, Manchester, UK - May 17, 1966)',
            title_short: 'Like a Rolling Stone',
            duration: 550,
            isrc: 'USSM16600540',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 7511293,
            title: 'Like a Rolling Stone (Live at LA Forum, Inglewood, CA - February 1974)',
            title_short: 'Like a Rolling Stone',
            duration: 429,
            isrc: 'USSM10901434',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 137201126,
            title: 'Like a Rolling Stone (Live at Royal Albert Hall, London, UK - May 26, 1966)',
            title_short: 'Like a Rolling Stone',
            duration: 505,
            isrc: 'USSM11606467',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 1101269102,
            title: 'Like A Rolling Stone (Live)',
            title_short: 'Like A Rolling Stone',
            duration: 365,
            isrc: 'UKDNQ1546055',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 71154301,
            title: 'Like a Rolling Stone (Live at the Isle of Wight, UK - August 1969)',
            title_short: 'Like a Rolling Stone',
            duration: 315,
            isrc: 'USSM11303649',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
          {
            id: 2531245021,
            title:
              'Like a Rolling Stone (Live at Nippon Budokan Hall, Tokyo, Japan - February 28, 1978)',
            title_short: 'Like a Rolling Stone',
            duration: 392,
            isrc: 'USSM12305551',
            type: 'track',
            artist: { name: 'Bob Dylan' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/14477354',
        body: { release_date: '1965-08-27', isrc: 'USSM19922509' },
      },
      {
        url: 'https://api.deezer.com/track/15177565',
        body: { release_date: '1966-06-21', isrc: 'USSM16600540' },
      },
      {
        url: 'https://api.deezer.com/track/1014132',
        body: { release_date: '1995-04-25', isrc: 'USSM19504346' },
      },
      {
        url: 'https://api.deezer.com/track/71154363',
        body: { release_date: '1979-04-23', isrc: 'USSM11304586' },
      },
      {
        url: 'https://api.deezer.com/track/8146601',
        body: { release_date: '1966-06-23', isrc: 'USSM16600540' },
      },
      {
        url: 'https://api.deezer.com/track/7511293',
        body: { release_date: '1974-06-21', isrc: 'USSM10901434' },
      },
      {
        url: 'https://api.deezer.com/track/137201126',
        body: { release_date: '1966-06-22', isrc: 'USSM11606467' },
      },
      {
        url: 'https://api.deezer.com/track/1101269102',
        body: { release_date: '2020-09-28', isrc: 'UKDNQ1546055' },
      },
      {
        url: 'https://api.deezer.com/track/71154301',
        body: { release_date: '1970-06-08', isrc: 'USSM11303649' },
      },
      {
        url: 'https://api.deezer.com/track/2531245021',
        body: { release_date: '2023-11-17', isrc: 'USSM12305551' },
      },
    ],
  },
  {
    key: 'layla',
    search: {
      url: 'https://api.deezer.com/search?q=Derek%20and%20the%20Dominos%20Layla&limit=10',
      body: {
        data: [
          {
            id: 1175612,
            title: 'Layla',
            title_short: 'Layla',
            duration: 433,
            isrc: 'NLF057090038',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
          {
            id: 2370293715,
            title: 'Layla',
            title_short: 'Layla',
            duration: 168,
            isrc: 'GBA077025030',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
          {
            id: 2132790867,
            title: 'Layla',
            title_short: 'Layla',
            duration: 453,
            isrc: 'USY252026466',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
          {
            id: 37773291,
            title:
              'Layla (In the Style of Eric Clapton Derek & the Dominos) [Instrumental Version]',
            title_short:
              'Layla (In the Style of Eric Clapton Derek & the Dominos) [Instrumental Version]',
            duration: 250,
            isrc: 'TCAAY1176564',
            type: 'track',
            artist: { name: 'United Guitar Players' },
          },
          {
            id: 10101839,
            title: 'Bell Bottom Blues',
            title_short: 'Bell Bottom Blues',
            duration: 305,
            isrc: 'GBUM71028879',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
          {
            id: 10101848,
            title: 'Little Wing',
            title_short: 'Little Wing',
            duration: 333,
            isrc: 'GBUM71028888',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
          {
            id: 10101843,
            title: 'Anyday',
            title_short: 'Anyday',
            duration: 396,
            isrc: 'GBUM71028883',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
          {
            id: 10101840,
            title: 'Keep On Growing',
            title_short: 'Keep On Growing',
            duration: 383,
            isrc: 'GBUM71028880',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
          {
            id: 10101838,
            title: 'I Looked Away',
            title_short: 'I Looked Away',
            duration: 186,
            isrc: 'GBUM71028878',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
          {
            id: 10101842,
            title: 'I Am Yours',
            title_short: 'I Am Yours',
            duration: 215,
            isrc: 'GBUM71028882',
            type: 'track',
            artist: { name: 'Derek & The Dominos' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/1175612',
        body: { release_date: '1994-03-28', isrc: 'NLF057090038' },
      },
      {
        url: 'https://api.deezer.com/track/2370293715',
        body: { release_date: '2023-07-24', isrc: 'GBA077025030' },
      },
      {
        url: 'https://api.deezer.com/track/2132790867',
        body: { release_date: '2023-02-10', isrc: 'USY252026466' },
      },
      {
        url: 'https://api.deezer.com/track/37773291',
        body: { release_date: '2011-06-11', isrc: 'TCAAY1176564' },
      },
      {
        url: 'https://api.deezer.com/track/10101839',
        body: { release_date: '2011-03-21', isrc: 'GBUM71028879' },
      },
      {
        url: 'https://api.deezer.com/track/10101848',
        body: { release_date: '2011-03-21', isrc: 'GBUM71028888' },
      },
      {
        url: 'https://api.deezer.com/track/10101843',
        body: { release_date: '2011-03-21', isrc: 'GBUM71028883' },
      },
      {
        url: 'https://api.deezer.com/track/10101840',
        body: { release_date: '2011-03-21', isrc: 'GBUM71028880' },
      },
      {
        url: 'https://api.deezer.com/track/10101838',
        body: { release_date: '2011-03-21', isrc: 'GBUM71028878' },
      },
      {
        url: 'https://api.deezer.com/track/10101842',
        body: { release_date: '2011-03-21', isrc: 'GBUM71028882' },
      },
    ],
  },
  {
    key: 'allAlongTheWatchtower',
    search: {
      url: 'https://api.deezer.com/search?q=Jimi%20Hendrix%20All%20Along%20the%20Watchtower&limit=10',
      body: {
        data: [
          {
            id: 4952889,
            title: 'All Along the Watchtower',
            title_short: 'All Along the Watchtower',
            duration: 241,
            isrc: 'USQX90900749',
            type: 'track',
            artist: { name: 'Jimi Hendrix' },
          },
          {
            id: 4952964,
            title: 'All Along The Watchtower (previously unreleased alternate mix)',
            title_short: 'All Along The Watchtower',
            duration: 241,
            isrc: 'USQX90900890',
            type: 'track',
            artist: { name: 'Jimi Hendrix' },
          },
          {
            id: 45066171,
            title: 'All Along The Watchtower',
            title_short: 'All Along The Watchtower',
            duration: 248,
            isrc: 'DEBL61019956',
            type: 'track',
            artist: { name: 'Jimi Hendrix' },
          },
          {
            id: 4952990,
            title: 'All Along the Watchtower (Live at the Isle of Wight, UK)',
            title_short: 'All Along the Watchtower',
            duration: 340,
            isrc: 'USQX90900971',
            type: 'track',
            artist: { name: 'Jimi Hendrix' },
          },
          {
            id: 104995896,
            title: 'All Along the Watchtower (Live)',
            title_short: 'All Along the Watchtower',
            duration: 259,
            isrc: 'USQX91500922',
            type: 'track',
            artist: { name: 'Jimi Hendrix' },
          },
          {
            id: 69505634,
            title:
              'All Along The Watchtower (Live at the Isle Of Wight, England, UK, August 30, 1970)',
            title_short:
              'All Along The Watchtower (Live at the Isle Of Wight, England, UK, August 30, 1970)',
            duration: 262,
            isrc: 'USQX90900963',
            type: 'track',
            artist: { name: 'Jimi Hendrix' },
          },
          {
            id: 63186817,
            title: 'All Along the Watchtower (Bob Dylan / Jimi Hendrix - Instrumental)',
            title_short: 'All Along the Watchtower (Bob Dylan / Jimi Hendrix - Instrumental)',
            duration: 312,
            isrc: 'TCAAS1035197',
            type: 'track',
            artist: { name: 'Michael Marc' },
          },
          {
            id: 37773251,
            title:
              'All Along the Watchtower (In the Style of Jimi Hendrix Bob Dylan) [Instrumental Version]',
            title_short:
              'All Along the Watchtower (In the Style of Jimi Hendrix Bob Dylan) [Instrumental Version]',
            duration: 257,
            isrc: 'TCAAY1176556',
            type: 'track',
            artist: { name: 'United Guitar Players' },
          },
          {
            id: 2592425,
            title: 'All Along The Watchtower',
            title_short: 'All Along The Watchtower',
            duration: 228,
            isrc: 'GBMEZ0832473',
            type: 'track',
            artist: { name: 'Françis Lockwood' },
          },
          {
            id: 132233616,
            title: 'All Along the Watchtower (in the style of Jimi Hendrix)',
            title_short: 'All Along the Watchtower (in the style of Jimi Hendrix)',
            duration: 274,
            isrc: 'BGA261636108',
            type: 'track',
            artist: { name: 'Pop Music Workshop' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/4952889',
        body: { release_date: '2010-01-01', isrc: 'USQX90900749' },
      },
      {
        url: 'https://api.deezer.com/track/4952964',
        body: { release_date: '2010-01-01', isrc: 'USQX90900890' },
      },
      {
        url: 'https://api.deezer.com/track/45066171',
        body: { release_date: '2013-05-14', isrc: 'DEBL61019956' },
      },
      {
        url: 'https://api.deezer.com/track/4952990',
        body: { release_date: '2010-01-01', isrc: 'USQX90900971' },
      },
      {
        url: 'https://api.deezer.com/track/104995896',
        body: { release_date: '2015-08-28', isrc: 'USQX91500922' },
      },
      {
        url: 'https://api.deezer.com/track/69505634',
        body: { release_date: '2013-08-19', isrc: 'USQX90900963' },
      },
      {
        url: 'https://api.deezer.com/track/63186817',
        body: { release_date: '2010-10-15', isrc: 'TCAAS1035197' },
      },
      {
        url: 'https://api.deezer.com/track/37773251',
        body: { release_date: '2011-06-11', isrc: 'TCAAY1176556' },
      },
      {
        url: 'https://api.deezer.com/track/2592425',
        body: { release_date: '2008-01-01', isrc: 'GBMEZ0832473' },
      },
      {
        url: 'https://api.deezer.com/track/132233616',
        body: { release_date: '2016-07-28', isrc: 'BGA261636108' },
      },
    ],
  },
  {
    key: 'smellsLikeTeenSpirit',
    search: {
      url: 'https://api.deezer.com/search?q=Nirvana%20Smells%20Like%20Teen%20Spirit&limit=10',
      body: {
        data: [
          {
            id: 13791930,
            title: 'Smells Like Teen Spirit',
            title_short: 'Smells Like Teen Spirit',
            duration: 301,
            isrc: 'USGF19942501',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 1543592472,
            title: 'Smells Like Teen Spirit (Live In Del Mar, California/1991)',
            title_short: 'Smells Like Teen Spirit',
            duration: 289,
            isrc: 'USGF19610505',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 4601811,
            title: 'Smells Like Teen Spirit (1992/Live at Reading)',
            title_short: 'Smells Like Teen Spirit',
            duration: 285,
            isrc: 'USUM70995906',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 661518662,
            title: 'Smells Like Teen Spirit (Live At The Paramount/1991)',
            title_short: 'Smells Like Teen Spirit',
            duration: 285,
            isrc: 'USUM71113789',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 1105768,
            title: 'Smells Like Teen Spirit (Live In Del Mar, California/1991)',
            title_short: 'Smells Like Teen Spirit',
            duration: 287,
            isrc: 'USGF19610505',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 1543592292,
            title: 'Smells Like Teen Spirit (Live In Amsterdam, Netherlands/1991)',
            title_short: 'Smells Like Teen Spirit',
            duration: 289,
            isrc: 'USUG12104002',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 1166334,
            title: 'Smells Like Teen Spirit (Rehearsal Demo)',
            title_short: 'Smells Like Teen Spirit',
            duration: 338,
            isrc: 'USIR10400870',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 2506654421,
            title:
              'Smells Like Teen Spirit (Live In Los Angeles, Great Western Forum - December 30, 1993)',
            title_short: 'Smells Like Teen Spirit',
            duration: 293,
            isrc: 'USUM72303634',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 13693577,
            title: 'Smells Like Teen Spirit (Devonshire Mix)',
            title_short: 'Smells Like Teen Spirit',
            duration: 301,
            isrc: 'USUM71113532',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
          {
            id: 78933810,
            title: 'Smells Like Teen Spirit (Butch Vig Mix)',
            title_short: 'Smells Like Teen Spirit',
            duration: 299,
            isrc: 'USIR10400932',
            type: 'track',
            artist: { name: 'Nirvana' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/13791930',
        body: { release_date: '2011-09-26', isrc: 'USGF19942501' },
      },
      {
        url: 'https://api.deezer.com/track/1543592472',
        body: { release_date: '2021-11-12', isrc: 'USGF19610505' },
      },
      {
        url: 'https://api.deezer.com/track/4601811',
        body: { release_date: '2009-11-03', isrc: 'USUM70995906' },
      },
      {
        url: 'https://api.deezer.com/track/661518662',
        body: { release_date: '2019-04-12', isrc: 'USUM71113789' },
      },
      {
        url: 'https://api.deezer.com/track/1105768',
        body: { release_date: '1996-10-01', isrc: 'USGF19610505' },
      },
      {
        url: 'https://api.deezer.com/track/1543592292',
        body: { release_date: '2021-11-12', isrc: 'USUG12104002' },
      },
      {
        url: 'https://api.deezer.com/track/1166334',
        body: { release_date: '2007-06-07', isrc: 'USIR10400870' },
      },
      {
        url: 'https://api.deezer.com/track/2506654421',
        body: { release_date: '2023-10-27', isrc: 'USUM72303634' },
      },
      {
        url: 'https://api.deezer.com/track/13693577',
        body: { release_date: '2011-09-27', isrc: 'USUM71113532' },
      },
      {
        url: 'https://api.deezer.com/track/78933810',
        body: { release_date: '2011-03-22', isrc: 'USIR10400932' },
      },
    ],
  },
  {
    key: 'creep',
    search: {
      url: 'https://api.deezer.com/search?q=Radiohead%20Creep&limit=10',
      body: {
        data: [
          {
            id: 138547415,
            title: 'Creep',
            title_short: 'Creep',
            duration: 238,
            isrc: 'GBAYE9200070',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
          {
            id: 2215315187,
            title: 'Creep (Acoustic)',
            title_short: 'Creep',
            duration: 258,
            isrc: 'GBAYE9300465',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
          {
            id: 105083310,
            title: 'Creep (Cover of Radiohead)',
            title_short: 'Creep',
            duration: 236,
            isrc: 'USQX91300667',
            type: 'track',
            artist: { name: 'Glee Cast' },
          },
          {
            id: 138548053,
            title: 'Blow Out (Remix)',
            title_short: 'Blow Out',
            duration: 258,
            isrc: 'GBAYE9300436',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
          {
            id: 138548047,
            title: 'Inside My Head',
            title_short: 'Inside My Head',
            duration: 191,
            isrc: 'GBAYE9200468',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
          {
            id: 138548049,
            title: 'Million Dollar Question',
            title_short: 'Million Dollar Question',
            duration: 198,
            isrc: 'GBAYE9200469',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
          {
            id: 138548051,
            title: 'Yes I Am',
            title_short: 'Yes I Am',
            duration: 265,
            isrc: 'GBAYE9300698',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
          {
            id: 3472538191,
            title: '2 + 2 = 5 (Live)',
            title_short: '2 + 2 = 5',
            duration: 216,
            isrc: 'GBBKS2500285',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
          {
            id: 3472538281,
            title: 'Myxomatosis (Live)',
            title_short: 'Myxomatosis',
            duration: 244,
            isrc: 'GBBKS2500294',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
          {
            id: 3472538251,
            title: 'The Gloaming (Live)',
            title_short: 'The Gloaming',
            duration: 239,
            isrc: 'GBBKS2500291',
            type: 'track',
            artist: { name: 'Radiohead' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/138547415',
        body: { release_date: '1993-02-22', isrc: 'GBAYE9200070' },
      },
      {
        url: 'https://api.deezer.com/track/2215315187',
        body: { release_date: '1992-09-21', isrc: 'GBAYE9300465' },
      },
      {
        url: 'https://api.deezer.com/track/105083310',
        body: { release_date: '2014-01-14', isrc: 'USQX91300667' },
      },
      {
        url: 'https://api.deezer.com/track/138548053',
        body: { release_date: '1992-09-21', isrc: 'GBAYE9300436' },
      },
      {
        url: 'https://api.deezer.com/track/138548047',
        body: { release_date: '1992-09-21', isrc: 'GBAYE9200468' },
      },
      {
        url: 'https://api.deezer.com/track/138548049',
        body: { release_date: '1992-09-21', isrc: 'GBAYE9200469' },
      },
      {
        url: 'https://api.deezer.com/track/138548051',
        body: { release_date: '1992-09-21', isrc: 'GBAYE9300698' },
      },
      {
        url: 'https://api.deezer.com/track/3472538191',
        body: { release_date: '2025-08-13', isrc: 'GBBKS2500285' },
      },
      {
        url: 'https://api.deezer.com/track/3472538281',
        body: { release_date: '2025-08-13', isrc: 'GBBKS2500294' },
      },
      {
        url: 'https://api.deezer.com/track/3472538251',
        body: { release_date: '2025-08-13', isrc: 'GBBKS2500291' },
      },
    ],
  },
  {
    key: 'relax',
    search: {
      url: 'https://api.deezer.com/search?q=Frankie%20Goes%20to%20Hollywood%20Relax&limit=10',
      body: {
        data: [
          {
            id: 479307582,
            title: 'Relax',
            title_short: 'Relax',
            duration: 237,
            isrc: 'GBAHW0100371',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 2578349042,
            title: 'Relax (Original 7”)',
            title_short: 'Relax',
            duration: 236,
            isrc: 'GBAHW0900004',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 482177002,
            title: 'Relax (Come Fighting)',
            title_short: 'Relax (Come Fighting)',
            duration: 235,
            isrc: 'GBAHW9900051',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 482578002,
            title: 'Relax (New York Mix)',
            title_short: 'Relax',
            duration: 444,
            isrc: 'GBAHW9900043',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 1800102587,
            title: 'Relax (Ecotek Remix)',
            title_short: 'Relax',
            duration: 360,
            isrc: 'QZS642260767',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 3573824021,
            title: 'Relax (In Heaven) (Arista Demo / 11-13 September 1982)',
            title_short: 'Relax (In Heaven)',
            duration: 188,
            isrc: 'GBUM72500982',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 479307722,
            title: 'Relax (Club 69 Future Anthem Pt. 1)',
            title_short: 'Relax',
            duration: 688,
            isrc: 'GBAHW0000261',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 7286247,
            title: "Relax (Lockout's Radio Edit)",
            title_short: 'Relax',
            duration: 212,
            isrc: 'GBAHW0900033',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 479846812,
            title: 'Relax (Sex Mix)',
            title_short: 'Relax',
            duration: 984,
            isrc: 'GBAHW0100340',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
          {
            id: 482578012,
            title: 'Relax (Ollie J Mix)',
            title_short: 'Relax',
            duration: 387,
            isrc: 'GBAHW9900044',
            type: 'track',
            artist: { name: 'Frankie Goes to Hollywood' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/479307582',
        body: { release_date: '2018-04-01', isrc: 'GBAHW0100371' },
      },
      {
        url: 'https://api.deezer.com/track/2578349042',
        body: { release_date: '2023-12-16', isrc: 'GBAHW0900004' },
      },
      {
        url: 'https://api.deezer.com/track/482177002',
        body: { release_date: '2018-04-01', isrc: 'GBAHW9900051' },
      },
      {
        url: 'https://api.deezer.com/track/482578002',
        body: { release_date: '2018-04-01', isrc: 'GBAHW9900043' },
      },
      {
        url: 'https://api.deezer.com/track/1800102587',
        body: { release_date: '2022-07-08', isrc: 'QZS642260767' },
      },
      {
        url: 'https://api.deezer.com/track/3573824021',
        body: { release_date: '2025-10-03', isrc: 'GBUM72500982' },
      },
      {
        url: 'https://api.deezer.com/track/479307722',
        body: { release_date: '2018-04-01', isrc: 'GBAHW0000261' },
      },
      {
        url: 'https://api.deezer.com/track/7286247',
        body: { release_date: '2010-05-10', isrc: 'GBAHW0900033' },
      },
      {
        url: 'https://api.deezer.com/track/479846812',
        body: { release_date: '2018-04-01', isrc: 'GBAHW0100340' },
      },
      {
        url: 'https://api.deezer.com/track/482578012',
        body: { release_date: '2018-04-01', isrc: 'GBAHW9900044' },
      },
    ],
  },
  {
    key: 'underPressure',
    search: {
      url: 'https://api.deezer.com/search?q=Queen%20%26%20David%20Bowie%20Under%20Pressure&limit=10',
      body: {
        data: [
          {
            id: 4091932171,
            title: 'Under Pressure (feat. David Bowie)',
            title_short: 'Under Pressure (feat. David Bowie)',
            duration: 247,
            isrc: 'GBUM71029622',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 4092336411,
            title: 'Under Pressure (feat. David Bowie) (Rah Mix)',
            title_short: 'Under Pressure (feat. David Bowie)',
            duration: 248,
            isrc: 'GBUM71103753',
            type: 'track',
            artist: { name: 'Queen' },
          },
          {
            id: 1878929307,
            title: 'Under Pressure (In the Style of Queen & David Bowie)',
            title_short: 'Under Pressure (In the Style of Queen & David Bowie)',
            duration: 239,
            isrc: 'USK4W0708123',
            type: 'track',
            artist: { name: 'Stingray' },
          },
          {
            id: 86694079,
            title:
              'Under Pressure (Backing Track Minus Guitars) [In the Style of Queen and David Bowie]',
            title_short:
              'Under Pressure (Backing Track Minus Guitars) [In the Style of Queen and David Bowie]',
            duration: 234,
            isrc: 'GBG7W1473850',
            type: 'track',
            artist: { name: 'Zoom Entertainments Limited' },
          },
          {
            id: 75613394,
            title: 'Under Pressure (Originally Performed by David Bowie & Queen)',
            title_short: 'Under Pressure',
            duration: 239,
            isrc: 'DESN31315678',
            type: 'track',
            artist: { name: 'MIDIFine Systems' },
          },
          {
            id: 2875414312,
            title: 'Under Pressure (Karaoke Version Originally Performed by Queen & David Bowie)',
            title_short: 'Under Pressure',
            duration: 236,
            isrc: 'AUXN22475337',
            type: 'track',
            artist: { name: "Singer's Best" },
          },
          {
            id: 84104647,
            title: 'Under Pressure (Karaoke Version) [Originally Performed By Queen & David Bowie]',
            title_short:
              'Under Pressure (Karaoke Version) [Originally Performed By Queen & David Bowie]',
            duration: 230,
            isrc: 'FR10S1403845',
            type: 'track',
            artist: { name: 'Zoom Karaoke' },
          },
          {
            id: 660261762,
            title: 'Under Pressure (Originally Performed by Queen & David Bowie) (Karaoke Version)',
            title_short: 'Under Pressure (Originally Performed by Queen & David Bowie)',
            duration: 243,
            isrc: 'GBRBE0794766',
            type: 'track',
            artist: { name: 'Hit The Button Karaoke' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/4091932171',
        body: { release_date: '1982-05-03', isrc: 'GBUM71029622' },
      },
      {
        url: 'https://api.deezer.com/track/4092336411',
        body: { release_date: '2011-01-01', isrc: 'GBUM71103753' },
      },
      {
        url: 'https://api.deezer.com/track/1878929307',
        body: { release_date: '2022-09-06', isrc: 'USK4W0708123' },
      },
      {
        url: 'https://api.deezer.com/track/86694079',
        body: { release_date: '2014-09-26', isrc: 'GBG7W1473850' },
      },
      {
        url: 'https://api.deezer.com/track/75613394',
        body: { release_date: '2014-06-10', isrc: 'DESN31315678' },
      },
      {
        url: 'https://api.deezer.com/track/2875414312',
        body: { release_date: '2024-07-05', isrc: 'AUXN22475337' },
      },
      {
        url: 'https://api.deezer.com/track/84104647',
        body: { release_date: '2014-08-25', isrc: 'FR10S1403845' },
      },
      {
        url: 'https://api.deezer.com/track/660261762',
        body: { release_date: '2019-04-11', isrc: 'GBRBE0794766' },
      },
    ],
  },
  {
    key: 'firestarter',
    search: {
      url: 'https://api.deezer.com/search?q=The%20Prodigy%20Firestarter&limit=10',
      body: {
        data: [
          {
            id: 1095162692,
            title: 'Firestarter (Instrumental)',
            title_short: 'Firestarter',
            duration: 281,
            isrc: 'GBBKS9700108',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 1095162682,
            title: 'Firestarter (Edit)',
            title_short: 'Firestarter',
            duration: 227,
            isrc: 'GBBKS9700093',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 1783873247,
            title: 'Firestarter (Andy C Remix)',
            title_short: 'Firestarter',
            duration: 232,
            isrc: 'GBBKS2200081',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 1095162702,
            title: 'Firestarter (Empirion Mix)',
            title_short: 'Firestarter',
            duration: 471,
            isrc: 'GBBKS9700094',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 62126195,
            title: 'Firestarter (Alvin Risk Remix)',
            title_short: 'Firestarter',
            duration: 198,
            isrc: 'GBBKS1200169',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 3658499862,
            title: 'Firestarter (Live at Milton Keynes Bowl- 2020 Remaster)',
            title_short: 'Firestarter',
            duration: 280,
            isrc: 'GBCEJ1000177',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 3514819741,
            title: 'Firestarter (live)',
            title_short: 'Firestarter',
            duration: 349,
            isrc: 'FXR022502678',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 128973904,
            title: 'Firestarter (Live)',
            title_short: 'Firestarter',
            duration: 321,
            isrc: 'GBBKS0562627',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 1095162712,
            title: 'Molotov Bitch',
            title_short: 'Molotov Bitch',
            duration: 294,
            isrc: 'GBBKS9700095',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
          {
            id: 1285010402,
            title: 'Firestarter 縱火者',
            title_short: 'Firestarter 縱火者',
            duration: 84,
            isrc: 'FR59R2115842',
            type: 'track',
            artist: { name: 'The Prodigy' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/1095162692',
        body: { release_date: '1996-03-18', isrc: 'GBBKS9700108' },
      },
      {
        url: 'https://api.deezer.com/track/1095162682',
        body: { release_date: '1996-03-18', isrc: 'GBBKS9700093' },
      },
      {
        url: 'https://api.deezer.com/track/1783873247',
        body: { release_date: '2022-06-30', isrc: 'GBBKS2200081' },
      },
      {
        url: 'https://api.deezer.com/track/1095162702',
        body: { release_date: '1996-03-18', isrc: 'GBBKS9700094' },
      },
      {
        url: 'https://api.deezer.com/track/62126195',
        body: { release_date: '2012-12-03', isrc: 'GBBKS1200169' },
      },
      {
        url: 'https://api.deezer.com/track/3658499862',
        body: { release_date: '2011-05-23', isrc: 'GBCEJ1000177' },
      },
      {
        url: 'https://api.deezer.com/track/3514819741',
        body: { release_date: '1996-08-18', isrc: 'FXR022502678' },
      },
      {
        url: 'https://api.deezer.com/track/128973904',
        body: { release_date: '2005-10-17', isrc: 'GBBKS0562627' },
      },
      {
        url: 'https://api.deezer.com/track/1095162712',
        body: { release_date: '1996-03-18', isrc: 'GBBKS9700095' },
      },
      {
        url: 'https://api.deezer.com/track/1285010402',
        body: { release_date: '1995-02-01', isrc: 'FR59R2115842' },
      },
    ],
  },
  {
    key: 'mrBrightside',
    search: {
      url: 'https://api.deezer.com/search?q=The%20Killers%20Mr.%20Brightside&limit=10',
      body: {
        data: [
          {
            id: 953097,
            title: 'Mr. Brightside',
            title_short: 'Mr. Brightside',
            duration: 223,
            isrc: 'USIR20400274',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 689411472,
            title: "Mr. Brightside (Jacques Lu Cont's Thin White Duke Radio Remix)",
            title_short: 'Mr. Brightside',
            duration: 279,
            isrc: 'USIR20500155',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 1103289,
            title: "Mr. Brightside (Jacques Lu Cont's Thin White Duke Mix)",
            title_short: 'Mr. Brightside',
            duration: 528,
            isrc: 'USIR20500022',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 511061402,
            title: 'Mr. Brightside (Live From The Royal Albert Hall / 2009)',
            title_short: 'Mr. Brightside',
            duration: 233,
            isrc: 'USUM70997811',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 689411492,
            title: "Mr. Brightside (Jacques Lu Cont's Thin White Duke Short Version)",
            title_short: 'Mr. Brightside',
            duration: 374,
            isrc: 'USUM71906079',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 602459672,
            title: 'Mr. Brightside (Live At Connect / 2004)',
            title_short: 'Mr. Brightside',
            duration: 221,
            isrc: 'USIR20400748',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 689411482,
            title: "Mr. Brightside (Jacques Lu Cont's Thin White Duke Dub)",
            title_short: 'Mr. Brightside',
            duration: 465,
            isrc: 'USIR20500024',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 3503939101,
            title: 'Mr. Brightside (live)',
            title_short: 'Mr. Brightside',
            duration: 295,
            isrc: 'FXR022502642',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 71955269,
            title: 'Mr. Brightside (Original Demo)',
            title_short: 'Mr. Brightside',
            duration: 261,
            isrc: 'USUM71312340',
            type: 'track',
            artist: { name: 'The Killers' },
          },
          {
            id: 689411502,
            title: 'Mr. Brightside (The Lindbergh Palace Club Remix)',
            title_short: 'Mr. Brightside',
            duration: 502,
            isrc: 'USIR20500023',
            type: 'track',
            artist: { name: 'The Killers' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/953097',
        body: { release_date: '2007-09-17', isrc: 'USIR20400274' },
      },
      {
        url: 'https://api.deezer.com/track/689411472',
        body: { release_date: '2019-06-07', isrc: 'USIR20500155' },
      },
      {
        url: 'https://api.deezer.com/track/1103289',
        body: { release_date: '2007-11-13', isrc: 'USIR20500022' },
      },
      {
        url: 'https://api.deezer.com/track/511061402',
        body: { release_date: '2018-06-15', isrc: 'USUM70997811' },
      },
      {
        url: 'https://api.deezer.com/track/689411492',
        body: { release_date: '2019-06-07', isrc: 'USUM71906079' },
      },
      {
        url: 'https://api.deezer.com/track/602459672',
        body: { release_date: '2018-12-14', isrc: 'USIR20400748' },
      },
      {
        url: 'https://api.deezer.com/track/689411482',
        body: { release_date: '2019-06-07', isrc: 'USIR20500024' },
      },
      {
        url: 'https://api.deezer.com/track/3503939101',
        body: { release_date: '2025-08-11', isrc: 'FXR022502642' },
      },
      {
        url: 'https://api.deezer.com/track/71955269',
        body: { release_date: '2013-11-11', isrc: 'USUM71312340' },
      },
      {
        url: 'https://api.deezer.com/track/689411502',
        body: { release_date: '2019-06-07', isrc: 'USIR20500023' },
      },
    ],
  },
  {
    key: 'rollingInTheDeep',
    search: {
      url: 'https://api.deezer.com/search?q=Adele%20Rolling%20in%20the%20Deep&limit=10',
      body: {
        data: [
          {
            id: 8086126,
            title: 'Rolling in the Deep',
            title_short: 'Rolling in the Deep',
            duration: 228,
            isrc: 'GBBKS1000335',
            type: 'track',
            artist: { name: 'Adele' },
          },
          {
            id: 66539032,
            title: 'Rolling in the Deep (Jamie xx Shuffle)',
            title_short: 'Rolling in the Deep',
            duration: 257,
            isrc: 'GBBKS1000425',
            type: 'track',
            artist: { name: 'Adele' },
          },
          {
            id: 10149031,
            title: 'Rolling In The Deep (Adele Drum & Bass Re-Mix Party Tribute)',
            title_short: 'Rolling In The Deep (Adele Drum & Bass Re-Mix Party Tribute)',
            duration: 166,
            isrc: 'US6VQ1100138',
            type: 'track',
            artist: { name: 'The Drum & Bass Remixers' },
          },
          {
            id: 346975901,
            title: 'Rolling In The Deep',
            title_short: 'Rolling In The Deep',
            duration: 228,
            isrc: 'UKG8V1600025',
            type: 'track',
            artist: { name: "Hello I'm Adele" },
          },
          {
            id: 120726068,
            title:
              'Adele Medley (Someone Like You / Hello / Set Fire to the Rain / Rolling in the Deep)',
            title_short:
              'Adele Medley (Someone Like You / Hello / Set Fire to the Rain / Rolling in the Deep)',
            duration: 253,
            isrc: 'USCGJ1608616',
            type: 'track',
            artist: { name: 'Kevin Olusola' },
          },
          {
            id: 10183033,
            title: 'Rolling in the deep (Karaoke)',
            title_short: 'Rolling in the deep (Karaoke)',
            duration: 226,
            isrc: 'ARG991011073',
            type: 'track',
            artist: { name: "Adele's Karaoke Band" },
          },
          {
            id: 698820402,
            title: 'Rolling in the Deep (Live)',
            title_short: 'Rolling in the Deep',
            duration: 233,
            isrc: 'DEAR41933793',
            type: 'track',
            artist: { name: 'Rosita' },
          },
          {
            id: 840715802,
            title: 'Rolling In the Deep (Acoustic Tribute to Adele)',
            title_short: 'Rolling In the Deep (Acoustic Tribute to Adele)',
            duration: 207,
            isrc: 'TCABB1137734',
            type: 'track',
            artist: { name: 'Corey Gray' },
          },
          {
            id: 63018520,
            title: 'Rolling in the Deep (Originally By Adele Karaoke / Instrumental)',
            title_short: 'Rolling in the Deep',
            duration: 228,
            isrc: 'USI4R1118862',
            type: 'track',
            artist: { name: 'HOT 100' },
          },
          {
            id: 10128133,
            title: 'Rolling In The Deep (Adele 808 Re-Mix Party Tribute)',
            title_short: 'Rolling In The Deep (Adele 808 Re-Mix Party Tribute)',
            duration: 200,
            isrc: 'US6VQ1100114',
            type: 'track',
            artist: { name: 'The 808 Remixers' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/8086126',
        body: { release_date: '2011-01-24', isrc: 'GBBKS1000335' },
      },
      {
        url: 'https://api.deezer.com/track/66539032',
        body: { release_date: '2011-04-11', isrc: 'GBBKS1000425' },
      },
      {
        url: 'https://api.deezer.com/track/10149031',
        body: { release_date: '2011-01-26', isrc: 'US6VQ1100138' },
      },
      {
        url: 'https://api.deezer.com/track/346975901',
        body: { release_date: '2017-03-03', isrc: 'UKG8V1600025' },
      },
      {
        url: 'https://api.deezer.com/track/120726068',
        body: { release_date: '2016-03-11', isrc: 'USCGJ1608616' },
      },
      {
        url: 'https://api.deezer.com/track/10183033',
        body: { release_date: '2011-03-03', isrc: 'ARG991011073' },
      },
      {
        url: 'https://api.deezer.com/track/698820402',
        body: { release_date: '2019-06-20', isrc: 'DEAR41933793' },
      },
      {
        url: 'https://api.deezer.com/track/840715802',
        body: { release_date: '2011-10-18', isrc: 'TCABB1137734' },
      },
      {
        url: 'https://api.deezer.com/track/63018520',
        body: { release_date: '2011-05-05', isrc: 'USI4R1118862' },
      },
      {
        url: 'https://api.deezer.com/track/10128133',
        body: { release_date: '2011-01-26', isrc: 'US6VQ1100114' },
      },
    ],
  },
  {
    key: 'heyJude',
    search: {
      url: 'https://api.deezer.com/search?q=The%20Beatles%20Hey%20Jude&limit=10',
      body: {
        data: [
          {
            id: 116348632,
            title: 'Hey Jude (Remastered 2015)',
            title_short: 'Hey Jude',
            duration: 429,
            isrc: 'GBUM71505902',
            type: 'track',
            artist: { name: 'The Beatles' },
          },
          {
            id: 126848613,
            title: 'Hey Jude',
            title_short: 'Hey Jude',
            duration: 239,
            isrc: 'GBAYE0601566',
            type: 'track',
            artist: { name: 'The Beatles' },
          },
          {
            id: 116348108,
            title: 'Hey Jude (Remastered 2009)',
            title_short: 'Hey Jude',
            duration: 429,
            isrc: 'GBAYE0900596',
            type: 'track',
            artist: { name: 'The Beatles' },
          },
          {
            id: 122172010,
            title: 'Hey Jude (Take 2)',
            title_short: 'Hey Jude',
            duration: 259,
            isrc: 'GBAYE1100522',
            type: 'track',
            artist: { name: 'The Beatles' },
          },
          {
            id: 579901682,
            title: 'Hey Jude (Take 1)',
            title_short: 'Hey Jude',
            duration: 403,
            isrc: 'GBUM71802773',
            type: 'track',
            artist: { name: 'The Beatles' },
          },
          {
            id: 3668067182,
            title: 'Hey Jude (Take 2 - Remastered)',
            title_short: 'Hey Jude',
            duration: 259,
            isrc: 'GBUM72502649',
            type: 'track',
            artist: { name: 'The Beatles' },
          },
          {
            id: 13263579,
            title: 'Saudade dos Beatles (Hey Jude / Yesterday)',
            title_short: 'Saudade dos Beatles (Hey Jude / Yesterday)',
            duration: 214,
            isrc: 'BRSME9600375',
            type: 'track',
            artist: { name: 'Zezé Di Camargo & Luciano' },
          },
          {
            id: 19148901,
            title: 'Hey Jude',
            title_short: 'Hey Jude',
            duration: 423,
            isrc: 'DEHQ91117801',
            type: 'track',
            artist: { name: 'Re Beatles' },
          },
          {
            id: 10540202,
            title: 'Hey Jude (Originally By The Beatles)',
            title_short: 'Hey Jude (Originally By The Beatles)',
            duration: 242,
            isrc: 'USA371245092',
            type: 'track',
            artist: { name: 'Various Musique' },
          },
          {
            id: 1849334227,
            title: 'Hey Jude (live)',
            title_short: 'Hey Jude',
            duration: 372,
            isrc: 'DELM41903898',
            type: 'track',
            artist: { name: 'The Beatles Revival Band' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/116348632',
        body: { release_date: '2015-12-24', isrc: 'GBUM71505902' },
      },
      {
        url: 'https://api.deezer.com/track/126848613',
        body: { release_date: '2016-06-17', isrc: 'GBAYE0601566' },
      },
      {
        url: 'https://api.deezer.com/track/116348108',
        body: { release_date: '2015-12-24', isrc: 'GBAYE0900596' },
      },
      {
        url: 'https://api.deezer.com/track/122172010',
        body: { release_date: '2016-04-04', isrc: 'GBAYE1100522' },
      },
      {
        url: 'https://api.deezer.com/track/579901682',
        body: { release_date: '2018-11-09', isrc: 'GBUM71802773' },
      },
      {
        url: 'https://api.deezer.com/track/3668067182',
        body: { release_date: '2025-11-21', isrc: 'GBUM72502649' },
      },
      {
        url: 'https://api.deezer.com/track/13263579',
        body: { release_date: '1996-08-02', isrc: 'BRSME9600375' },
      },
      {
        url: 'https://api.deezer.com/track/19148901',
        body: { release_date: '2011-02-04', isrc: 'DEHQ91117801' },
      },
      {
        url: 'https://api.deezer.com/track/10540202',
        body: { release_date: '2011-04-19', isrc: 'USA371245092' },
      },
      {
        url: 'https://api.deezer.com/track/1849334227',
        body: { release_date: '2016-12-01', isrc: 'DELM41903898' },
      },
    ],
  },
  {
    key: 'personalJesus',
    search: {
      url: 'https://api.deezer.com/search?q=Depeche%20Mode%20Personal%20Jesus&limit=10',
      body: {
        data: [
          {
            id: 68513563,
            title: 'Personal Jesus',
            title_short: 'Personal Jesus',
            duration: 225,
            isrc: 'GBAJH0602195',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 136331376,
            title: 'Personal Jesus',
            title_short: 'Personal Jesus',
            duration: 296,
            isrc: 'GBAJH0600289',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 446327572,
            title: 'Personal Jesus (Acoustic)',
            title_short: 'Personal Jesus',
            duration: 207,
            isrc: 'GBAJH0400038',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 89735931,
            title: 'Personal Jesus (Live)',
            title_short: 'Personal Jesus',
            duration: 522,
            isrc: 'USQX91401931',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 3694956362,
            title: 'Personal Jesus (Live in Mexico City)',
            title_short: 'Personal Jesus',
            duration: 416,
            isrc: 'USQX92504703',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 68515474,
            title: 'Personal Jesus (The Stargate Mix)',
            title_short: 'Personal Jesus',
            duration: 235,
            isrc: 'GBAJH1100003',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 68515105,
            title: 'Personal Jesus (Live In Barcelona)',
            title_short: 'Personal Jesus',
            duration: 393,
            isrc: 'GBAJH1000539',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 68514479,
            title: 'Personal Jesus (Boys Noize Rework)',
            title_short: 'Personal Jesus (Boys Noize Rework)',
            duration: 413,
            isrc: 'GBAJH0602228',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 68515314,
            title: 'Personal Jesus (Pump Mix)',
            title_short: 'Personal Jesus',
            duration: 467,
            isrc: 'GBAJH0400042',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
          {
            id: 68515032,
            title: 'Personal Jesus (Eric Prydz Remix)',
            title_short: 'Personal Jesus',
            duration: 355,
            isrc: 'GBAJH1100020',
            type: 'track',
            artist: { name: 'Depeche Mode' },
          },
        ],
      },
    },
    tracks: [
      {
        url: 'https://api.deezer.com/track/68513563',
        body: { release_date: '2006-11-08', isrc: 'GBAJH0602195' },
      },
      {
        url: 'https://api.deezer.com/track/136331376',
        body: { release_date: '1990-03-19', isrc: 'GBAJH0600289' },
      },
      {
        url: 'https://api.deezer.com/track/446327572',
        body: { release_date: '2004-04-01', isrc: 'GBAJH0400038' },
      },
      {
        url: 'https://api.deezer.com/track/89735931',
        body: { release_date: '2014-11-17', isrc: 'USQX91401931' },
      },
      {
        url: 'https://api.deezer.com/track/3694956362',
        body: { release_date: '2025-12-05', isrc: 'USQX92504703' },
      },
      {
        url: 'https://api.deezer.com/track/68515474',
        body: { release_date: '2011-06-06', isrc: 'GBAJH1100003' },
      },
      {
        url: 'https://api.deezer.com/track/68515105',
        body: { release_date: '2010-11-05', isrc: 'GBAJH1000539' },
      },
      {
        url: 'https://api.deezer.com/track/68514479',
        body: { release_date: '2006-11-08', isrc: 'GBAJH0602228' },
      },
      {
        url: 'https://api.deezer.com/track/68515314',
        body: { release_date: '2025-01-01', isrc: 'GBAJH0400042' },
      },
      {
        url: 'https://api.deezer.com/track/68515032',
        body: { release_date: '2011-05-30', isrc: 'GBAJH1100020' },
      },
    ],
  },
];

/**
 * A REAL quota refusal, served with HTTP 200 -- see the header. Verbatim: nothing was trimmed,
 * because the whole body is the signal.
 */
export const DEEZER_QUOTA_EXCEEDED = {
  url: 'https://api.deezer.com/search?q=Def%20Leppard%20Pour%20Some%20Sugar%20On%20Me%20-%20Remastered%202017&limit=10',
  capturedAt: '2026-09-30T19:00:21.100Z',
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } },
} as const;
