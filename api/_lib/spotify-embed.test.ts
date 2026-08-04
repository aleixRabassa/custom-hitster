import { describe, expect, it } from 'vitest';

import {
  FIXTURE_ACCESS_TOKEN,
  HEALTHY_PLAYLIST_ID,
  HEALTHY_TRACK_COUNT,
  NONEXISTENT_PLAYLIST_ID,
  embedPageForWrongPlaylist,
  embedPageWithDegenerateTracks,
  embedPageWithExactlyMaxTracks,
  embedPageWithoutTrackList,
  healthyEmbedPage,
  notFoundEmbedPage,
  pageWithoutNextData,
} from './__fixtures__/embed-payloads.js';
import { fetchPlaylistFromEmbed } from './spotify-embed.js';
import type { FetchLike } from './spotify-embed.js';
import { MAX_EMBED_TRACKS } from '../../shared/constants.js';

/** A fetch double that always succeeds with the given page. Records what it was called with. */
function stubFetch(
  body: string,
  status = 200,
): { fetch: FetchLike; calls: { url: string; headers?: Record<string, string> }[] } {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, headers: init?.headers });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    });
  };
  return { fetch, calls };
}

/** A fetch double that rejects, as a real network failure would. */
const rejectingFetch: FetchLike = () => Promise.reject(new Error('socket hang up'));

describe('fetchPlaylistFromEmbed', () => {
  it('should normalize a healthy payload into cards', async () => {
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(healthyEmbedPage).fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards).toHaveLength(HEALTHY_TRACK_COUNT);
    expect(result.skippedCount).toBe(0);
    expect(result.playlist).toEqual({
      id: HEALTHY_PLAYLIST_ID,
      name: 'Today’s Top Hits',
      owner: 'Spotify',
    });
    expect(result.cards[0]).toEqual({
      id: '70pVCVMGjmIWPbWXDwf11e',
      title: 'petal',
      artist: 'Ariana Grande',
      durationMs: 184248,
      previewUrl: 'https://p.scdn.co/mp3-preview/30dc1adb43c170165bb8091e788b55f26f2fc672',
      isPlayable: true,
    });
    // No year is set anywhere by this layer -- the embed payload has none at track level.
    expect(result.cards.every((card) => card.year === undefined)).toBe(true);
  });

  it('should derive the track id from the spotify:track: uri', async () => {
    // Asserted on its own because the payload has NO bare `id` at track level: the URI is
    // the only source, and the QR code Phase 4 renders is built from this value.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(healthyEmbedPage).fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards.map((card) => card.id)).toEqual([
      '70pVCVMGjmIWPbWXDwf11e',
      '0kosUz0jePvjiz4ctmR6wL',
      '2xLMifQCjDGFmkHkpNLD9h',
      '3n3Ppam7vgaVa1iaRUc9Lp',
    ]);
    expect(result.cards.every((card) => !card.id.includes('spotify:'))).toBe(true);
  });

  it('should keep the joined subtitle verbatim as the display artist', async () => {
    // Guards against a future "improvement" that splits on ", " -- which would render
    // "Earth, Wind & Fire" as three artists and corrupt the reveal side of the card.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(healthyEmbedPage).fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards[1]?.artist).toBe('Shakira, Burna Boy');
  });

  it('should set previewUrl when audioPreview is present and leave it undefined when absent', async () => {
    // The branch Phase 4's disabled Play/Pause depends on. Coverage is ~99.5%, so the
    // absent case is rare enough to regress unnoticed without this test.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(healthyEmbedPage).fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards[0]?.previewUrl).toBe(
      'https://p.scdn.co/mp3-preview/30dc1adb43c170165bb8091e788b55f26f2fc672',
    );

    const withoutPreview = result.cards[2];
    expect(withoutPreview?.title).toBe('Uptown Top Ranking – Remastered 2001');
    expect(withoutPreview?.previewUrl).toBeUndefined();
    // Absent, not present-and-undefined, so the JSON response omits the key entirely.
    expect(Object.hasOwn(withoutPreview ?? {}, 'previewUrl')).toBe(false);
  });

  it('should keep tracks whose isPlayable is false', async () => {
    // NOT filtered out: the QR code is always rendered and always works, so an unplayable
    // track is still a fully playable card. Filtering would shrink decks for no reason.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(healthyEmbedPage).fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unplayable = result.cards.find((card) => card.isPlayable === false);
    expect(unplayable).toBeDefined();
    expect(unplayable?.title).toBe('Mr. Brightside');
    expect(result.cards).toHaveLength(HEALTHY_TRACK_COUNT);
  });

  it('should skip entries with no track id or no title and report the skipped count', async () => {
    // Defensive normalization WITHOUT silent deck shrinkage: the count is what stops a
    // shorter deck from being mysterious.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(embedPageWithDegenerateTracks).fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards).toHaveLength(2);
    expect(result.skippedCount).toBe(2);
    expect(result.cards.map((card) => card.title)).toEqual(['petal', 'Dai Dai']);
  });

  it('should return not-found-or-private for a 200 response whose pageProps has no state key', async () => {
    // ========================================================================
    //  THE MOST IMPORTANT TEST IN THIS PLAN.
    //
    //  A playlist that does not exist returns **HTTP 200** with `pageProps`
    //  carrying `{status: 404, …}` and no `state`. Measured in Phase 0 and
    //  re-confirmed live 2026-08-04.
    //
    //  If this regresses, a bad or private link produces an EMPTY DECK instead of
    //  an error, and the failure is silent all the way to the player.
    // ========================================================================
    const { fetch, calls } = stubFetch(notFoundEmbedPage, 200);
    const result = await fetchPlaylistFromEmbed(NONEXISTENT_PLAYLIST_ID, fetch);

    expect(result).toEqual({ ok: false, code: 'not-found-or-private' });
    // The upstream really did answer 200 -- i.e. the code above cannot have come from
    // status-based handling.
    expect(calls).toHaveLength(1);
  });

  it('should return upstream-unavailable for a non-200 response', async () => {
    for (const status of [429, 500, 502, 503]) {
      const result = await fetchPlaylistFromEmbed(HEALTHY_PLAYLIST_ID, stubFetch('', status).fetch);
      expect(result).toEqual({ ok: false, code: 'upstream-unavailable' });
    }
  });

  it('should return upstream-unavailable when fetch itself rejects', async () => {
    // Kept distinct from `unexpected-payload` because the operational response differs:
    // this one may work on a retry, that one means the scrape broke.
    const result = await fetchPlaylistFromEmbed(HEALTHY_PLAYLIST_ID, rejectingFetch);

    expect(result).toEqual({ ok: false, code: 'upstream-unavailable' });
  });

  it('should return unexpected-payload when the __NEXT_DATA__ script is absent', async () => {
    // What a Spotify redesign, an interstitial, or a captcha wall looks like.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(pageWithoutNextData).fetch,
    );

    expect(result).toEqual({ ok: false, code: 'unexpected-payload' });
  });

  it('should return unexpected-payload when the trackList path is missing', async () => {
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(embedPageWithoutTrackList).fetch,
    );

    expect(result).toEqual({ ok: false, code: 'unexpected-payload' });
  });

  it('should return unexpected-payload when entity.uri does not match the requested id', async () => {
    // The wrong-playlist class of bug Phase 0 hit in its own spike, where a shared-file
    // write race made two agents analyse a different playlist than they thought.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(embedPageForWrongPlaylist).fetch,
    );

    expect(result).toEqual({ ok: false, code: 'unexpected-payload' });
  });

  it('should set truncated when the track list length equals MAX_EMBED_TRACKS', async () => {
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(embedPageWithExactlyMaxTracks).fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards).toHaveLength(MAX_EMBED_TRACKS);
    expect(result.truncated).toBe(true);
  });

  it('should leave truncated false below the cap', async () => {
    // The other side of the boundary, so the Phase 6 warning cannot fire on every playlist.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(healthyEmbedPage).fetch,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cards.length).toBeLessThan(MAX_EMBED_TRACKS);
    expect(result.truncated).toBe(false);
  });

  it('should send a browser User-Agent header', async () => {
    // Phase 0 got HTTP 200 with a browser agent and never tested a default or absent one,
    // so this is a real request-shaping requirement rather than a courtesy.
    const { fetch, calls } = stubFetch(healthyEmbedPage);
    await fetchPlaylistFromEmbed(HEALTHY_PLAYLIST_ID, fetch);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://open.spotify.com/embed/playlist/${HEALTHY_PLAYLIST_ID}`);
    expect(calls[0]?.headers?.['User-Agent']).toMatch(/Mozilla\/5\.0/);
  });

  it('should not include the upstream access token anywhere in its result', async () => {
    // The embed payload leaks a short-lived anonymous Spotify bearer token at
    // `state.settings.session.accessToken` (Phase 0). It must never reach the client, so
    // this asserts against the SERIALIZED result rather than a field-by-field check --
    // that is what catches a future change that passes the raw payload through.
    const result = await fetchPlaylistFromEmbed(
      HEALTHY_PLAYLIST_ID,
      stubFetch(healthyEmbedPage).fetch,
    );

    expect(result.ok).toBe(true);
    expect(healthyEmbedPage).toContain(FIXTURE_ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain(FIXTURE_ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain('accessToken');
    // Nor any of the raw upstream HTML.
    expect(JSON.stringify(result)).not.toContain('<script');
  });
});
