import { describe, expect, it } from 'vitest';

import { isSpotifyShortLink, parsePlaylistUrl, spotifyTrackUrl } from './spotify-url';

/**
 * A real playlist ID (Today's Top Hits), used everywhere below so that a failure is
 * never about a hand-invented ID being the wrong length.
 */
const ID = '37i9dQZF1DXcBWIGoYBM5M';

/** A real track ID (Bohemian Rhapsody), for the same reason `ID` is a real playlist ID. */
const TRACK_ID = '3z8h0TU7ReDPLIbEnYhWZb';

describe('spotifyTrackUrl', () => {
  it('should build an open.spotify.com track URL from a bare id', () => {
    // This exact string is what the card's QR code encodes, so the shape is the contract.
    expect(spotifyTrackUrl(TRACK_ID)).toBe(`https://open.spotify.com/track/${TRACK_ID}`);
  });

  it('should output a track link that parsePlaylistUrl rejects as unsupported-entity', () => {
    // The two helpers must agree about what a track link is. `unsupported-entity` rather
    // than `invalid-url` is the whole point: a track link is recognisably Spotify, so
    // pasting one into the landing form deserves "that's a track, not a playlist".
    expect(parsePlaylistUrl(spotifyTrackUrl(TRACK_ID))).toEqual({
      ok: false,
      code: 'unsupported-entity',
    });
  });
});

describe('parsePlaylistUrl', () => {
  it('should parse a plain open.spotify.com playlist URL', () => {
    expect(parsePlaylistUrl(`https://open.spotify.com/playlist/${ID}`)).toEqual({
      ok: true,
      id: ID,
    });
  });

  it('should parse a URL carrying an ?si= share parameter', () => {
    // The form users actually paste: Spotify's own share button appends `?si=`.
    expect(parsePlaylistUrl(`https://open.spotify.com/playlist/${ID}?si=8f3a1c0d4e5b4f6a`)).toEqual(
      {
        ok: true,
        id: ID,
      },
    );
  });

  it('should ignore additional query parameters and a URL fragment', () => {
    expect(
      parsePlaylistUrl(`https://open.spotify.com/playlist/${ID}?si=abc&utm_source=copy-link&pt=x`),
    ).toEqual({
      ok: true,
      id: ID,
    });
    expect(parsePlaylistUrl(`https://open.spotify.com/playlist/${ID}#anything`)).toEqual({
      ok: true,
      id: ID,
    });
    expect(parsePlaylistUrl(`https://open.spotify.com/playlist/${ID}?si=abc#anything`)).toEqual({
      ok: true,
      id: ID,
    });
  });

  it('should parse a locale-prefixed path', () => {
    // Spotify serves these to localised clients, so a shared link can carry the
    // prefix. Works fine in an English locale either way, which is what makes it
    // easy to miss.
    expect(parsePlaylistUrl(`https://open.spotify.com/intl-es/playlist/${ID}`)).toEqual({
      ok: true,
      id: ID,
    });
    expect(parsePlaylistUrl(`https://open.spotify.com/intl-pt/playlist/${ID}?si=abc`)).toEqual({
      ok: true,
      id: ID,
    });
    expect(parsePlaylistUrl(`https://open.spotify.com/intl-pt-br/playlist/${ID}`)).toEqual({
      ok: true,
      id: ID,
    });
  });

  it('should parse a URL with a trailing slash, http scheme, and surrounding whitespace', () => {
    expect(parsePlaylistUrl(`https://open.spotify.com/playlist/${ID}/`)).toEqual({
      ok: true,
      id: ID,
    });
    expect(parsePlaylistUrl(`http://open.spotify.com/playlist/${ID}`)).toEqual({
      ok: true,
      id: ID,
    });
    expect(parsePlaylistUrl(`  \n https://open.spotify.com/playlist/${ID}  \t `)).toEqual({
      ok: true,
      id: ID,
    });
    expect(parsePlaylistUrl(`open.spotify.com/playlist/${ID}`)).toEqual({ ok: true, id: ID });
    expect(parsePlaylistUrl(`https://www.open.spotify.com/playlist/${ID}`)).toEqual({
      ok: true,
      id: ID,
    });
  });

  it('should parse a spotify:playlist: URI', () => {
    // The desktop client's "Copy Spotify URI" form.
    expect(parsePlaylistUrl(`spotify:playlist:${ID}`)).toEqual({ ok: true, id: ID });
  });

  it('should parse a bare 22-character ID', () => {
    // The form Phase 6's suggested-playlist buttons pass.
    expect(parsePlaylistUrl(ID)).toEqual({ ok: true, id: ID });
    expect(parsePlaylistUrl(`  ${ID}  `)).toEqual({ ok: true, id: ID });
  });

  it('should accept a legacy /user/{user}/playlist/{id} URL', () => {
    // The form Spotify emitted for years, and the one the 2026-08-04 findings called the
    // clearest real bug that spike found: it carries a perfectly good playlist ID and was
    // rejected as `unsupported-entity` because `user` sat in the entity position.
    expect(parsePlaylistUrl(`https://open.spotify.com/user/spotify/playlist/${ID}`)).toEqual({
      ok: true,
      id: ID,
    });
    // A real-looking owner id rather than the editorial `spotify` one -- the segment is
    // skipped wholesale, so its contents must not matter.
    expect(parsePlaylistUrl(`https://open.spotify.com/user/1122334455/playlist/${ID}`)).toEqual({
      ok: true,
      id: ID,
    });
  });

  it('should accept the legacy path with a locale prefix and query params', () => {
    // Both prefixes at once, which is what a localised client copying an old link produces.
    // The order the two strips happen in is exactly what this pins.
    expect(
      parsePlaylistUrl(`https://open.spotify.com/intl-es/user/spotify/playlist/${ID}?si=abc123`),
    ).toEqual({ ok: true, id: ID });
    expect(parsePlaylistUrl(`http://open.spotify.com/user/spotify/playlist/${ID}/`)).toEqual({
      ok: true,
      id: ID,
    });
  });

  it('should still reject a legacy path whose id is not 22 base62 characters', () => {
    // The strict ID check must survive the new path. 22 is arithmetic, not convention
    // (`SPOTIFY_ID_PATTERN`'s own comment), so the legacy form gets no relaxation.
    expect(parsePlaylistUrl('https://open.spotify.com/user/spotify/playlist/nope')).toEqual({
      ok: false,
      code: 'invalid-url',
    });
    expect(
      parsePlaylistUrl('https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5'),
    ).toEqual({ ok: false, code: 'invalid-url' });
  });

  it('should still reject a bare /user/{user} profile URL as unsupported-entity', () => {
    // The other side of the length guard. A profile link is a plausible paste and is NOT a
    // playlist; stripping the prefix unconditionally would leave nothing and report the
    // vaguer `invalid-url` instead.
    expect(parsePlaylistUrl('https://open.spotify.com/user/spotify')).toEqual({
      ok: false,
      code: 'unsupported-entity',
    });
    // And a legacy path to something that is not a playlist stays an entity complaint.
    expect(parsePlaylistUrl(`https://open.spotify.com/user/spotify/album/${ID}`)).toEqual({
      ok: false,
      code: 'unsupported-entity',
    });
  });

  it('should reject an album, track, artist, and show URL as unsupported-entity', () => {
    // Asserting the CODE, not just the failure: Phase 6 renders a different message
    // for "that's an album, not a playlist" than for "that isn't a Spotify link", so
    // collapsing this into `invalid-url` would silently degrade the landing page.
    for (const entity of ['album', 'track', 'artist', 'show', 'episode']) {
      expect(parsePlaylistUrl(`https://open.spotify.com/${entity}/${ID}`)).toEqual({
        ok: false,
        code: 'unsupported-entity',
      });
      expect(parsePlaylistUrl(`spotify:${entity}:${ID}`)).toEqual({
        ok: false,
        code: 'unsupported-entity',
      });
    }

    // Also through a locale prefix, which is where a naive segment index would slip.
    expect(parsePlaylistUrl(`https://open.spotify.com/intl-es/album/${ID}`)).toEqual({
      ok: false,
      code: 'unsupported-entity',
    });
  });

  it('should reject a non-Spotify host as invalid-url', () => {
    expect(parsePlaylistUrl(`https://example.com/playlist/${ID}`)).toEqual({
      ok: false,
      code: 'invalid-url',
    });
    expect(parsePlaylistUrl(`https://music.apple.com/playlist/${ID}`)).toEqual({
      ok: false,
      code: 'invalid-url',
    });
    // Spotify's own site, but not the link-sharing host we know how to read.
    expect(parsePlaylistUrl(`https://spotify.com/playlist/${ID}`)).toEqual({
      ok: false,
      code: 'invalid-url',
    });
  });

  it('should reject a look-alike host containing open.spotify.com as a substring', () => {
    // Every one of these would pass a naive `includes('open.spotify.com')` check.
    expect(parsePlaylistUrl(`https://open.spotify.com.evil.example/playlist/${ID}`)).toEqual({
      ok: false,
      code: 'invalid-url',
    });
    expect(parsePlaylistUrl(`https://notopen.spotify.com/playlist/${ID}`)).toEqual({
      ok: false,
      code: 'invalid-url',
    });
    expect(parsePlaylistUrl(`https://evil.example/open.spotify.com/playlist/${ID}`)).toEqual({
      ok: false,
      code: 'invalid-url',
    });
    // Userinfo trick: the real host here is evil.example.
    expect(parsePlaylistUrl(`https://open.spotify.com@evil.example/playlist/${ID}`)).toEqual({
      ok: false,
      code: 'invalid-url',
    });
  });

  it('should reject an ID of the wrong length or with non-base62 characters', () => {
    expect(parsePlaylistUrl('37i9dQZF1DXcBWIGoYBM5')).toEqual({ ok: false, code: 'invalid-url' }); // 21
    expect(parsePlaylistUrl('37i9dQZF1DXcBWIGoYBM5MM')).toEqual({ ok: false, code: 'invalid-url' }); // 23
    expect(parsePlaylistUrl('37i9dQZF1DXcBWIGoYBM5-')).toEqual({ ok: false, code: 'invalid-url' }); // hyphen
    expect(parsePlaylistUrl('https://open.spotify.com/playlist/not-an-id')).toEqual({
      ok: false,
      code: 'invalid-url',
    });
    expect(parsePlaylistUrl('https://open.spotify.com/playlist/')).toEqual({
      ok: false,
      code: 'invalid-url',
    });
    expect(parsePlaylistUrl('spotify:playlist:nope')).toEqual({ ok: false, code: 'invalid-url' });
  });

  it('should reject empty and whitespace-only input', () => {
    // The landing form's initial state, and what a cleared input box sends.
    expect(parsePlaylistUrl('')).toEqual({ ok: false, code: 'invalid-url' });
    expect(parsePlaylistUrl('   ')).toEqual({ ok: false, code: 'invalid-url' });
    expect(parsePlaylistUrl('\n\t')).toEqual({ ok: false, code: 'invalid-url' });
  });

  it('should never throw for arbitrary input', () => {
    // Phase 6 calls this on every keystroke, so half-typed and pasted-garbage input
    // is the normal case rather than an edge case.
    const junk = [
      'h',
      'ht',
      'https:',
      'https://',
      'https://open',
      'https://open.spotify.com',
      'https://open.spotify.com/',
      'open.spotify.com',
      'spotify:',
      'spotify::',
      'spotify:playlist:',
      'spotify:playlist:a:b',
      'playlist',
      '../../etc/passwd',
      '<script>alert(1)</script>',
      'https://open.spotify.com/playlist/%20',
      `https://open.spotify.com/playlist/${ID} ${ID}`,
      'null',
      '0',
      '🎵',
      'x'.repeat(10_000),
      // Deliberately not a string: this arrives from a repeated query parameter.
      undefined as unknown as string,
      null as unknown as string,
      123 as unknown as string,
      {} as unknown as string,
      [] as unknown as string,
    ];

    for (const input of junk) {
      expect(() => parsePlaylistUrl(input)).not.toThrow();
      const result = parsePlaylistUrl(input);
      expect(result.ok).toBe(false);
    }
  });
});

describe('isSpotifyShortLink', () => {
  it('should recognise a spotify.link URL as a short link', () => {
    // The shape the phone share sheet produces, which is how most players get a link at all.
    expect(isSpotifyShortLink('https://spotify.link/aBcDeF12345')).toBe(true);
    // The same permissiveness `parsePlaylistUrl` grants: optional scheme, optional `www.`,
    // a trailing slash, a query string, and surrounding whitespace from a paste.
    expect(isSpotifyShortLink('spotify.link/aBcDeF12345')).toBe(true);
    expect(isSpotifyShortLink('http://www.spotify.link/aBcDeF12345/')).toBe(true);
    expect(isSpotifyShortLink('  https://spotify.link/aBcDeF12345?si=xyz  ')).toBe(true);
    // The legacy short host. Measured dead on 2026-08-05 (ENOTFOUND) and matched anyway --
    // see the pattern's comment for why `upstream-unavailable` beats `invalid-url` there.
    expect(isSpotifyShortLink('https://link.tospotify.com/aBcDeF12345')).toBe(true);
  });

  it('should not recognise an open.spotify.com URL as a short link', () => {
    // The negative case that matters: a normal link must take the parse path, not the
    // server-side redirect path, or every Start would cost an extra round trip.
    expect(isSpotifyShortLink(`https://open.spotify.com/playlist/${ID}`)).toBe(false);
    expect(isSpotifyShortLink(`spotify:playlist:${ID}`)).toBe(false);
    expect(isSpotifyShortLink(ID)).toBe(false);
  });

  it('should reject a short-link host with no code to resolve', () => {
    // Nothing for the server to follow, so this is better reported as an invalid link
    // immediately than sent on a round trip that can only fail.
    expect(isSpotifyShortLink('https://spotify.link')).toBe(false);
    expect(isSpotifyShortLink('https://spotify.link/')).toBe(false);
    expect(isSpotifyShortLink('https://spotify.link/?si=abc')).toBe(false);
  });

  it('should reject look-alike short-link hosts', () => {
    // The same anchoring `SPOTIFY_WEB_URL_PATTERN` needs, and for the same reason: this
    // predicate is what decides that a URL is worth handing to an outbound request.
    expect(isSpotifyShortLink('https://spotify.link.evil.example/aBcDeF12345')).toBe(false);
    expect(isSpotifyShortLink('https://notspotify.link/aBcDeF12345')).toBe(false);
    expect(isSpotifyShortLink('https://evil.example/spotify.link/aBcDeF12345')).toBe(false);
    expect(isSpotifyShortLink('https://spotify.link@evil.example/aBcDeF12345')).toBe(false);
    expect(isSpotifyShortLink('https://link.tospotify.com.evil.example/aBcDeF12345')).toBe(false);
  });

  it('should never throw for arbitrary input', () => {
    // Called from the same keystroke path `parsePlaylistUrl` is.
    for (const input of [
      '',
      '   ',
      'spotify.link',
      '🎵',
      undefined as unknown as string,
      null as unknown as string,
      123 as unknown as string,
    ]) {
      expect(() => isSpotifyShortLink(input)).not.toThrow();
      expect(isSpotifyShortLink(input)).toBe(false);
    }
  });
});
