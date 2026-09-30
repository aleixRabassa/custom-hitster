/**
 * Captured MusicBrainz responses for `api/_lib/musicbrainz.test.ts`.
 *
 * These are RAW responses — they pin the JSON shape the adapter parses. The NORMALIZED
 * candidates that the scorer consumes live in `shared/__fixtures__/year-candidates.ts`
 * instead, because `tsconfig.app.json` covers `src` + `shared` only and a `shared/` test
 * importing from `api/` would drag Node-side code into the browser typecheck.
 *
 * ## Provenance
 *
 * Captured 2026-08-04 from `musicbrainz.org/ws/2` with
 * `User-Agent: custom-hitster/0.1.0 ( … )`, paced at 1 req/s, using exactly the two
 * requests the adapter makes:
 *
 * ```
 * GET /ws/2/recording?query=recording:"No Woman No Cry" AND artist:"Bob Marley & The Wailers"
 *                            AND dur:[245000 TO 265000]&fmt=json&limit=100
 * GET /ws/2/release-group?query=rgid:(<the eligible ids from that response>)&fmt=json&limit=100
 * ```
 *
 * "No Woman No Cry" was chosen because it is one of the smallest of the Phase 0
 * known-tricky tracks (12 recordings) while still exercising everything that matters: a
 * famous ~7-minute live version that must NOT win over the ~3:45 studio take, several
 * Compilation release groups, and an artist credit ("Bob Marley & The Wailers") whose
 * ampersand is exactly the kind `shared/artists.ts` warns against splitting.
 *
 * **Trimmed, not verbatim, and trimmed in two specific ways.** Each recording keeps at most
 * three of its inlined releases, and every field the adapter does not read was dropped —
 * `score`, `video`, `artist-credit-id`, the full `artist` sub-object with its aliases,
 * `release-events`, `media`, `track-count`, `country`, `barcode`, and so on. A verbatim
 * capture of this one query is ~180 kB and unreadable. Nothing was invented: every value
 * here came off the wire.
 *
 * The remaining fixtures below are SYNTHESISED, and each says why -- except the Olvidarnos
 * capture at the end of the file, which is real and carries its own provenance header.
 */

export const NO_WOMAN_NO_CRY = {
  title: 'No Woman No Cry',
  artist: 'Bob Marley & The Wailers',
  durationMs: 255000,
  expectedYear: 1974,
};

export const noWomanNoCrySearch = {
  created: '2026-08-04T09:56:06.392Z',
  count: 12,
  offset: 0,
  recordings: [
    {
      id: '29853a10-6d7a-46ee-9a7e-78912a874195',
      title: 'No Woman, No Cry',
      length: 246000,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '1995',
      releases: [
        {
          status: 'Official',
          date: '1995',
          'release-group': {
            id: 'e776533c-4132-3b63-bfaa-94fe901951b5',
            'primary-type': 'Album',
          },
        },
      ],
    },
    {
      id: '2e6de09f-8de0-4817-83e4-e8f4d3ce19b4',
      title: 'No Woman No Cry',
      length: 251000,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '2002-01-01',
      releases: [
        {
          status: 'Official',
          date: '2002-01-01',
          'release-group': {
            id: '1a4c52cd-483a-347c-93f9-4d512767c7ba',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
        {
          status: 'Official',
          date: '2002-02-25',
          'release-group': {
            id: '1a4c52cd-483a-347c-93f9-4d512767c7ba',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
        {
          status: 'Official',
          date: '2002',
          'release-group': {
            id: '1a4c52cd-483a-347c-93f9-4d512767c7ba',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
    {
      id: '69502c22-4ea6-42ce-b6c9-142072e04b83',
      title: 'No Woman No Cry',
      length: 251000,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '2001',
      releases: [
        {
          status: 'Promotion',
          'release-group': {
            id: '09254155-8f6e-4a7a-ac0d-fc192636f7af',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
    {
      id: 'a4b7a14b-ae31-471e-8f0c-a3c706187c7c',
      title: 'No Woman No Cry',
      length: 245013,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '2000',
      releases: [
        {
          status: 'Bootleg',
          date: '2000',
          'release-group': {
            id: '668aa293-2f53-478c-adaf-2d2d5b3dbd29',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
    {
      id: '18376656-7ee3-4205-b337-3970ccef93d0',
      title: 'No Woman, No Cry',
      length: 245053,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      releases: [
        {
          status: 'Bootleg',
          'release-group': {
            id: 'a2f19e3a-7218-4f60-a56d-bde34eaec787',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
    {
      id: '44f83d78-1232-46ed-b3fc-755a491f310f',
      title: 'No Woman No Cry',
      length: 251066,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '2004',
      releases: [
        {
          status: 'Official',
          date: '2004',
          'release-group': {
            id: '1a4c52cd-483a-347c-93f9-4d512767c7ba',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
    {
      id: '51dd9628-5834-43c5-ad91-5e36949f23ba',
      title: 'No Woman, No Cry',
      length: 246000,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '1984',
      releases: [
        {
          status: 'Official',
          date: '1984',
          'release-group': {
            id: '1c132971-97eb-46f1-874b-d2aebfa6bd05',
            'primary-type': 'Single',
          },
        },
        {
          status: 'Official',
          date: '1990',
          'release-group': {
            id: 'e776533c-4132-3b63-bfaa-94fe901951b5',
            'primary-type': 'Album',
          },
        },
      ],
    },
    {
      id: '0991ba0f-9401-4960-aac5-f03dbfd7ac98',
      title: 'No Woman No Cry (live)',
      length: 247040,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '1987',
      releases: [
        {
          status: 'Official',
          date: '1987',
          'release-group': {
            id: '595a7f46-eac2-3b56-90e4-859fd6b7edbb',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
        {
          status: 'Official',
          date: '1987',
          'release-group': {
            id: '7a8a7813-b8eb-3de7-9eb1-8441486c37af',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
        {
          status: 'Official',
          date: '1987',
          'release-group': {
            id: '595a7f46-eac2-3b56-90e4-859fd6b7edbb',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
    {
      id: '5b76e34e-4443-4704-af82-ae07529d2626',
      title: 'No Woman, No Cry (live)',
      length: 245000,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
    },
    {
      id: '4f1c078d-4597-43c2-97bd-b5aeb7bd3c4b',
      title: 'No Woman No Cry (dub)',
      length: 262378,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      releases: [
        {
          'release-group': {
            id: '28207bc4-7238-49ec-85c7-e1f3ab93de29',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
    {
      id: 'c2ef5e71-97a3-4f08-90ce-b66dc3ef402c',
      title: 'No Woman No Cry (piano rehearsal)',
      length: 256000,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '2014',
      releases: [
        {
          status: 'Bootleg',
          'release-group': {
            id: '5327ee96-0bb8-415d-9a2d-626039e363ec',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
    {
      id: 'bd76e625-e2e0-4fdf-8dca-7fc2ba3379c7',
      title: 'No Woman No Cry (studio demo take two)',
      length: 251000,
      'artist-credit': [
        {
          name: 'Bob Marley & The Wailers',
        },
      ],
      'first-release-date': '2014',
      releases: [
        {
          status: 'Bootleg',
          'release-group': {
            id: '5327ee96-0bb8-415d-9a2d-626039e363ec',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
      ],
    },
  ],
};

export const noWomanNoCryReleaseGroups = {
  created: '2026-08-04T09:56:07.796Z',
  count: 1,
  offset: 0,
  'release-groups': [
    {
      id: 'e776533c-4132-3b63-bfaa-94fe901951b5',
      title: 'Natty Dread',
      'first-release-date': '1974-10-25',
    },
  ],
};

/**
 * A remaster-suffixed title returning nothing.
 *
 * REAL, and the reason `cleanTrackTitle()` exists at all: on 2026-08-04
 * `recording:"Bohemian Rhapsody - Remastered 2011" AND artist:"Queen"` returned exactly
 * this — `count: 0` — while the cleaned title returned 224. The literal suffix does not
 * rank badly, it breaks the query outright.
 */
export const emptySearch = {
  created: '2026-08-04T09:37:41.412Z',
  count: 0,
  offset: 0,
  recordings: [],
};

/**
 * A response whose releases carry no usable date, to pin the null guard.
 *
 * SYNTHESISED, but the shape is real: missing and empty `date` fields are common on
 * bootleg and compilation releases, which is exactly why the scorer filters before it
 * compares rather than taking a bare minimum over whatever dates are present. The matching
 * release-group response is empty, so nothing gets a `first-release-date` either.
 */
export const undatedSearch = {
  created: '2026-08-04T10:00:00.000Z',
  count: 1,
  offset: 0,
  recordings: [
    {
      id: 'undated-recording-0000-0000-000000000000',
      title: 'A Song With No Dates',
      length: 200000,
      'artist-credit': [{ name: 'A Band' }],
      releases: [
        {
          status: 'Official',
          date: '',
          'release-group': {
            id: 'undated-rg-0000-0000-0000-000000000000',
            'primary-type': 'Album',
          },
        },
        {
          status: 'Bootleg',
          'release-group': {
            id: 'bootleg-rg-0000-0000-0000-000000000000',
            'primary-type': 'Album',
            'secondary-types': ['Live'],
          },
        },
      ],
    },
  ],
};

/** An empty release-group answer, for the undated case above. */
export const emptyReleaseGroups = {
  created: '2026-08-04T10:00:00.000Z',
  count: 0,
  offset: 0,
  'release-groups': [],
};

/**
 * A recording whose artist credit is joined by `joinphrase` rather than a fixed separator.
 *
 * SYNTHESISED from the real shape. It exists because rebuilding the credit with a hardcoded
 * ", " would turn "Bob Marley & The Wailers" into "Bob Marley, The Wailers" and stop it
 * matching the string Spotify supplies — the same hazard `shared/artists.ts` documents.
 */
export const joinPhraseSearch = {
  created: '2026-08-04T10:00:00.000Z',
  count: 1,
  offset: 0,
  recordings: [
    {
      id: 'joinphrase-recording-0000-0000-000000000',
      title: 'Under Pressure',
      length: 248000,
      'first-release-date': '1981-10-26',
      'artist-credit': [{ name: 'Queen', joinphrase: ' & ' }, { name: 'David Bowie' }],
      releases: [],
    },
  ],
};

// ===========================================================================
//  A PINNED MISS: THE TRACK THE REMOVED TOKENISED RUNG WAS BUILT FOR
// ===========================================================================

/**
 * A track MusicBrainz ALONE cannot place, pinned as a miss. Captured live for
 * docs/plans/plan.year-fetch-rework-mb-fixes.md step 7, when the adapter still had a fourth,
 * `tokenised` rung (every title word quoted and ANDed) that found it; that rung was removed on
 * 2026-10-01, and this capture now pins what the three phrase queries do without it.
 *
 * ## Provenance
 *
 * Captured 2026-09-30 from `musicbrainz.org/ws/2` with
 * `User-Agent: custom-hitster/0.1.0 ( … )` (the value of `MUSICBRAINZ_USER_AGENT` in
 * `.env.local` at the time, recorded as it was actually sent), paced at one request per 1.5 s,
 * by calling the REAL `fetchYearCandidates()` with a recording `fetchImpl` -- so these are the
 * adapter's own requests, not a reconstruction of them. No cache of any kind was involved.
 *
 * **Reordered, not re-captured.** The capture ran the ladder of the time: duration-bounded,
 * unbounded, artist-guess (then tokenised). The ladder is now duration-bounded, artist-guess,
 * unbounded, so `OLVIDARNOS_QUERIES` lists the same three phrase queries in the order the
 * adapter makes them TODAY, each beside its own captured answer. That invents nothing: the three
 * responses were byte-identical apart from `created`, which still shows the capture order.
 *
 * "Olvidarnos De To' :)" is spike §3.2's emoticon row. `cleanTrackTitle()` neutralises the
 * colon, which leaves a stray `)` inside the quoted phrase, and all three phrase queries return
 * nothing -- even though MusicBrainz holds the recording, as "Olvidarnos de to' :)" by
 * "Cano & Justin Quiles" (recording `4d9fb260-6dca-4e7d-b735-362714e46663`, on the 2026-04-17
 * album "Anaís"). The tokenised rung found exactly that recording and scored it 2026, capped
 * at `low`. Its captured response and release-group response were deleted with the rung
 * (they are in commit 4197322, which added this section): no request the adapter makes can
 * reach them.
 *
 * WHY LOSING IT IS ACCEPTED: over the 782-card measurement the tokenised rung answered 5 cards,
 * every one a year Deezer already had -- this one included (iTunes, Deezer and Deezer's ISRC
 * all say 2026) -- so under the provider vote no shown year changes. See docs/agent_findings.md
 * 2026-10-01 and `buildAttempts()` in `api/_lib/musicbrainz.ts`.
 */
export const OLVIDARNOS = {
  title: "Olvidarnos De To' :)",
  artist: 'Cano, Justin Quiles',
  durationMs: 200625,
  /**
   * What iTunes, Deezer and Deezer's ISRC agree on. Asserted by NO test here: MusicBrainz
   * alone now returns no year, and this is kept only as the answer the vote shows instead.
   */
  expectedYear: 2026,
};

/** The `query` parameter of each recording request, in the order the adapter makes them. */
export const OLVIDARNOS_QUERIES = [
  `recording:"Olvidarnos De To' )" AND artist:"Cano, Justin Quiles" AND dur:[190625 TO 210625]`,
  `recording:"Olvidarnos De To' )" AND artist:"Cano"`,
  `recording:"Olvidarnos De To' )" AND artist:"Cano, Justin Quiles"`,
];

/** Each query's captured answer, index for index with `OLVIDARNOS_QUERIES`. */
export const olvidarnosPhraseSearches = [
  { created: '2026-09-30T18:20:11.403Z', count: 0, offset: 0, recordings: [] },
  { created: '2026-09-30T18:20:14.173Z', count: 0, offset: 0, recordings: [] },
  { created: '2026-09-30T18:20:12.666Z', count: 0, offset: 0, recordings: [] },
];
