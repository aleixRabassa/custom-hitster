import { describe, expect, it } from 'vitest';

import { parsePlaylistUrl } from './spotify-url';

/**
 * A real playlist ID (Today's Top Hits), used everywhere below so that a failure is
 * never about a hand-invented ID being the wrong length.
 */
const ID = '37i9dQZF1DXcBWIGoYBM5M';

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
