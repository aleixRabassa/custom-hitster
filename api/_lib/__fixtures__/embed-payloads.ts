/**
 * Trimmed captures of the Spotify embed page, for `api/_lib/spotify-embed.test.ts`.
 *
 * Provenance, and exactly which parts are real versus synthesised, is in the README
 * beside this file. Read it before trusting a field here as evidence of what Spotify
 * does. Everything is a plain TypeScript module rather than `.json`/`.html` files
 * because `resolveJsonModule` is off and there is no HTML loader — and adding either
 * for fixtures alone is not worth a toolchain change.
 *
 * This lives under `api/_lib/`, which a probe deploy on 2026-08-04 confirmed Vercel
 * does not route (see `docs/agent_findings.md`), so it never becomes an endpoint.
 */

/** Today's Top Hits — the playlist the healthy fixture was captured from. */
export const HEALTHY_PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';

/** A well-formed ID that does not exist, as used to capture the 404-shaped body. */
export const NONEXISTENT_PLAYLIST_ID = '0000000000000000000000';

/** The `buildId` the 2026-08-04 captures carried. Nothing reads it; kept for fidelity. */
const BUILD_ID = '8e22cee0-0fd5-41ef-b733-74bfdc5642cb';

/**
 * One entry as it really appears in `entity.trackList`. Loosely typed on purpose: the
 * whole point of the fixtures is to feed the adapter shapes it must survive, including
 * ones its own types would forbid.
 */
type FixtureTrack = Record<string, unknown>;

/** Real track, captured verbatim: preview present, playable, single artist. */
export const trackNormal: FixtureTrack = {
  uri: 'spotify:track:70pVCVMGjmIWPbWXDwf11e',
  uid: '424f774c71596762514867',
  title: 'petal',
  subtitle: 'Ariana Grande',
  isExplicit: true,
  isNineteenPlus: false,
  contentRatings: { labels: ['EXPLICIT'] },
  duration: 184248,
  isPlayable: true,
  playabilityReason: 'PLAYABLE',
  audioPreview: {
    format: 'MP3_96',
    url: 'https://p.scdn.co/mp3-preview/30dc1adb43c170165bb8091e788b55f26f2fc672',
  },
  entityType: 'track',
};

/**
 * Real track, captured verbatim. The `subtitle` is TWO artists joined with ", " —
 * indistinguishable in shape from a single artist whose name contains a comma, which is
 * the whole reason `shared/artists.ts` refuses to split it for display.
 */
export const trackMultipleArtists: FixtureTrack = {
  uri: 'spotify:track:0kosUz0jePvjiz4ctmR6wL',
  uid: '3854616b4f6a5578664b31',
  title: 'Dai Dai',
  subtitle: 'Shakira, Burna Boy',
  isExplicit: false,
  isNineteenPlus: false,
  contentRatings: { labels: [] },
  duration: 223448,
  isPlayable: true,
  playabilityReason: 'PLAYABLE',
  audioPreview: {
    format: 'MP3_96',
    url: 'https://p.scdn.co/mp3-preview/a6955a6725dcf614e9915396987847ea0b509580',
  },
  entityType: 'track',
};

/**
 * SYNTHESISED: `audioPreview` absent entirely (not `{url: null}` — the key is missing).
 * Title and artist are a real Phase 0 preview gap, so the case is real even though this
 * capture is not. Phase 4 disables Play/Pause and Restart for such a card; the QR still
 * works, which is why the card stays in the deck.
 */
export const trackWithoutPreview: FixtureTrack = {
  uri: 'spotify:track:2xLMifQCjDGFmkHkpNLD9h',
  uid: '4d5a6b7c8d9e0f1a2b3c4d',
  title: 'Uptown Top Ranking – Remastered 2001',
  subtitle: 'Althea and Donna',
  isExplicit: false,
  isNineteenPlus: false,
  contentRatings: { labels: [] },
  duration: 217826,
  isPlayable: true,
  playabilityReason: 'PLAYABLE',
  entityType: 'track',
};

/**
 * SYNTHESISED: never observed live, but Spotify documents the field and Phase 4 branches
 * on it. This track MUST survive normalisation — the QR code is always rendered and
 * always works (`plan.md` §2, non-negotiable), so an unplayable track is still a
 * playable card.
 */
export const trackUnplayable: FixtureTrack = {
  uri: 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp',
  uid: '5e6f708192a3b4c5d6e7f8',
  title: 'Mr. Brightside',
  subtitle: 'The Killers',
  isExplicit: false,
  isNineteenPlus: false,
  contentRatings: { labels: [] },
  duration: 222586,
  isPlayable: false,
  playabilityReason: 'NOT_AVAILABLE_IN_MARKET',
  audioPreview: {
    format: 'MP3_96',
    url: 'https://p.scdn.co/mp3-preview/1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
  },
  entityType: 'track',
};

/** SYNTHESISED: no `uri`, so no track ID can be derived. Must be skipped and counted. */
export const trackWithoutUri: FixtureTrack = {
  uid: '9f8e7d6c5b4a39281706f5',
  title: 'Track With No Uri',
  subtitle: 'Nobody',
  duration: 180000,
  isPlayable: true,
  entityType: 'track',
};

/** SYNTHESISED: empty `title`, so the card would render blank. Must be skipped and counted. */
export const trackWithoutTitle: FixtureTrack = {
  uri: 'spotify:track:1ABCdefGHIjkLMNopqRSTu',
  uid: 'a1b2c3d4e5f60718293a4b',
  title: '',
  subtitle: 'Nobody',
  duration: 180000,
  isPlayable: true,
  entityType: 'track',
};

/** Playlist-level fields, captured verbatim apart from the track list. */
function playlistEntity(id: string, trackList: FixtureTrack[]): Record<string, unknown> {
  return {
    type: 'playlist',
    name: 'Today’s Top Hits',
    uri: `spotify:playlist:${id}`,
    id,
    title: 'Today’s Top Hits',
    // The owner label. "Spotify" for editorial playlists, a display name otherwise.
    subtitle: 'Spotify',
    authors: [{ name: 'Spotify', uri: '' }],
    coverArt: {
      sources: [{ url: 'https://i.scdn.co/image/ab67706f00000002abcdef', width: 640, height: 640 }],
    },
    // Always null at playlist level -- one of the reasons the year must come from
    // MusicBrainz rather than from this payload.
    releaseDate: null,
    duration: 0,
    isPlayable: true,
    playabilityReason: 'PLAYABLE',
    isExplicit: false,
    hasVideo: false,
    relatedEntityUri: `spotify:playlist:${id}`,
    trackList,
    visualIdentity: { backgroundBase: { alpha: 255, blue: 32, green: 32, red: 32 } },
    attributes: [{ key: 'isAlgotorial', value: 'false' }],
    format: 'playlist',
  };
}

/** The full `__NEXT_DATA__` envelope for a playlist that resolved successfully. */
export function healthyPayload(id: string, trackList: FixtureTrack[]): Record<string, unknown> {
  return {
    props: {
      pageProps: {
        state: {
          data: {
            entity: playlistEntity(id, trackList),
            embeded_entity_uri: `spotify:playlist:${id}`,
            defaultAudioFileObject: {},
          },
          // The anonymous bearer token Phase 0 found. Present in the fixture ON PURPOSE:
          // one of the adapter's tests asserts this string never appears in its result.
          settings: {
            session: {
              accessToken: 'FIXTURE-LEAKED-TOKEN-must-not-be-returned',
              isAnonymous: true,
            },
          },
          machineState: { state: 'loading' },
        },
        config: {},
      },
      __N_SSP: true,
    },
    page: '/playlist/[id]',
    query: { id },
    buildId: BUILD_ID,
    assetPrefix: 'https://open.spotifycdn.com/cdn',
    isFallback: false,
    isExperimentalCompile: false,
    gssp: true,
    scriptLoader: [],
  };
}

/**
 * The 404-shaped envelope, captured verbatim from a request for a nonexistent playlist.
 *
 * THE IMPORTANT PART: this arrives with **HTTP 200**. `pageProps` carries `status: 404`
 * and has **no `state` key** at all. An adapter that branched on the HTTP status would
 * treat this as success and hand the UI an empty deck.
 */
export function notFoundPayload(id: string): Record<string, unknown> {
  return {
    props: {
      pageProps: {
        status: 404,
        title: 'Page not found',
        description: 'We can’t seem to find the page you are looking for.',
        links: [{ href: 'https://open.spotify.com', title: 'Home', isPrimaryStyle: true }],
        rtl: false,
      },
      __N_SSP: true,
    },
    page: '/playlist/[id]',
    query: { id },
    buildId: BUILD_ID,
    assetPrefix: 'https://open.spotifycdn.com/cdn',
    isFallback: false,
    isExperimentalCompile: false,
    gssp: true,
    scriptLoader: [],
  };
}

/**
 * Wrap a payload in a page skeleton shaped like the real one. Faithful in the ways that
 * can break an extractor:
 *
 * - `__NEXT_DATA__` is the **last** script tag, and the real page has 14 before it — so
 *   a regex that grabs the first `<script>` gets the wrong one.
 * - Those earlier scripts contain JSON-ish content and their own `</script>` closers, so
 *   a greedy match would swallow past the payload.
 * - The track list is ALSO rendered as visible `<h3>`/`<h4>` markup earlier in the
 *   document, so an extractor that scraped the DOM text instead of this JSON would
 *   appear to work while reading the wrong source.
 * - It ends `</script></body></html>` with no trailing newline, exactly as captured.
 */
export function wrapInEmbedPage(payload: unknown): string {
  const json = JSON.stringify(payload);
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8" data-next-head=""/>',
    '<title>Spotify Embed</title>',
    '<script src="https://open.spotifycdn.com/cdn/build/embed/vendor.js" defer=""></script>',
    '<script id="__NEXT_FONT_MANIFEST__" type="application/json">{"pages":{}}</script>',
    '</head><body><div id="__next"><div class="Embed">',
    // The rendered track list -- a decoy for anyone tempted to parse the markup.
    '<ol><li><h3 data-encore-id="text" dir="auto">petal</h3><h4 dir="auto">Ariana Grande</h4></li></ol>',
    '</div></div>',
    `<script id="__NEXT_DATA__" type="application/json">${json}</script>`,
    '</body></html>',
  ].join('');
}

/** A healthy page: four tracks, deliberately below the 100 cap. */
export const healthyEmbedPage = wrapInEmbedPage(
  healthyPayload(HEALTHY_PLAYLIST_ID, [
    trackNormal,
    trackMultipleArtists,
    trackWithoutPreview,
    trackUnplayable,
  ]),
);

/** How many tracks `healthyEmbedPage` should normalise to. */
export const HEALTHY_TRACK_COUNT = 4;

/** A healthy page that also carries two unusable entries, to pin the skip-and-count path. */
export const embedPageWithDegenerateTracks = wrapInEmbedPage(
  healthyPayload(HEALTHY_PLAYLIST_ID, [
    trackNormal,
    trackWithoutUri,
    trackWithoutTitle,
    trackMultipleArtists,
  ]),
);

/** HTTP 200, `pageProps.status: 404`, no `state` key. The trap, as a page. */
export const notFoundEmbedPage = wrapInEmbedPage(notFoundPayload(NONEXISTENT_PLAYLIST_ID));

/** Valid page, valid `__NEXT_DATA__`, but `state.data.entity` has no `trackList`. */
export const embedPageWithoutTrackList = (() => {
  const payload = healthyPayload(HEALTHY_PLAYLIST_ID, []) as {
    props: { pageProps: { state: { data: { entity: Record<string, unknown> } } } };
  };
  delete payload.props.pageProps.state.data.entity.trackList;
  return wrapInEmbedPage(payload);
})();

/** A page whose `entity.uri` is a DIFFERENT playlist than the one requested. */
export const embedPageForWrongPlaylist = wrapInEmbedPage(
  healthyPayload('37i9dQZF1DWXRqgorJj26U', [trackNormal, trackMultipleArtists]),
);

/**
 * What a Spotify redesign, an interstitial, or a captcha wall looks like: real HTML,
 * HTTP 200, no `__NEXT_DATA__` anywhere.
 */
export const pageWithoutNextData =
  '<!DOCTYPE html><html lang="en"><head><title>Spotify</title></head>' +
  '<body><div id="__next"><p>Something went wrong.</p></div>' +
  '<script src="https://open.spotifycdn.com/cdn/build/embed/vendor.js"></script></body></html>';

/**
 * Exactly 100 tracks — the observed cap — to exercise the truncation flag at its
 * boundary. Synthesised by repeating one real track with distinct IDs, since only the
 * length matters here.
 *
 * Note this is NOT a "playlist with more than 100 tracks": no such payload exists,
 * because the cap is invisible in the response. That is the entire reason `truncated` is
 * a boolean guess rather than a fact (Phase 0: no total, no offset, no `hasMore`).
 */
export const embedPageWithExactlyMaxTracks = wrapInEmbedPage(
  healthyPayload(
    HEALTHY_PLAYLIST_ID,
    Array.from({ length: 100 }, (_unused, index) => ({
      ...trackNormal,
      // Distinct 22-char base62 IDs, so a deduplicating bug cannot pass this test.
      uri: `spotify:track:${String(index).padStart(22, 'A')}`,
      title: `Track ${index + 1}`,
    })),
  ),
);

/** The token planted in `healthyPayload`, asserted absent from the adapter's output. */
export const FIXTURE_ACCESS_TOKEN = 'FIXTURE-LEAKED-TOKEN-must-not-be-returned';
