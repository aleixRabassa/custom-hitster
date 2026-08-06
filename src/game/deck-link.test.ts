/**
 * Node environment, no docblock needed: this module touches no DOM, which is the whole point of
 * it living in `src/game/` rather than in a component or a hook.
 */

import { describe, expect, it } from 'vitest';

import { PLAYLIST_PARAM, SEED_PARAM, buildDeckLink, parseDeckLink } from './deck-link';
import { generateSeed } from './shuffle';

/** A real 22-character base62 id, and the shape `parsePlaylistUrl` accepts bare. */
const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';

/** 16 lowercase hex characters — exactly what `generateSeed()` mints. */
const SEED = 'a1b2c3d4e5f60718';

describe('parseDeckLink', () => {
  it('should parse a link carrying a playlist id and a seed', () => {
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`)).toEqual({
      playlistId: PLAYLIST_ID,
      seed: SEED,
    });
  });

  it('should accept the query string with or without its leading question mark', () => {
    // `location.search` carries the `?`; a test or a caller splitting a URL by hand often does not.
    const withMark = parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`);
    const without = parseDeckLink(`${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`);

    expect(without).toEqual(withMark);
  });

  it('should accept a full playlist URL in the parameter, through the shared parser', () => {
    // Reuse rather than a second regex (step 6): whatever `parsePlaylistUrl` accepts, a link
    // accepts, so a share link that someone rebuilt by hand out of a real Spotify URL still works.
    const encoded = encodeURIComponent(`https://open.spotify.com/playlist/${PLAYLIST_ID}?si=abc`);

    expect(parseDeckLink(`?${PLAYLIST_PARAM}=${encoded}&${SEED_PARAM}=${SEED}`)).toEqual({
      playlistId: PLAYLIST_ID,
      seed: SEED,
    });
  });

  it('should lowercase a hex seed that arrived shouting', () => {
    // Hex is hex. A chat client or a manual retype that upper-cased it should still deal the same
    // deck, and `hashSeed` is case-sensitive — so the normalisation has to happen here.
    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED.toUpperCase()}`)?.seed,
    ).toBe(SEED);
  });

  it('should reject a link with a malformed playlist id', () => {
    // Judged by `parsePlaylistUrl`, so all three of these fail for its reasons rather than for a
    // reason invented here: too short, an album, and a bare word.
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=tooshort&${SEED_PARAM}=${SEED}`)).toBeNull();
    expect(
      parseDeckLink(
        `?${PLAYLIST_PARAM}=${encodeURIComponent(
          `https://open.spotify.com/album/${PLAYLIST_ID}`,
        )}&${SEED_PARAM}=${SEED}`,
      ),
    ).toBeNull();
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=&${SEED_PARAM}=${SEED}`)).toBeNull();
  });

  it('should reject a seed outside the generated alphabet or over the length bound', () => {
    // ===================================================================
    //  THE BOUND EXISTS BECAUSE THE SEED IS PERSISTED, NOT BECAUSE IT IS
    //  DANGEROUS.
    //
    //  An accepted seed goes into `hashSeed()` and then into the
    //  `localStorage` payload, where it survives reloads. `generateSeed()`
    //  mints exactly 16 lowercase hex characters, so anything else did not
    //  come from this app.
    // ===================================================================
    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=nothex0000000000`),
    ).toBeNull();
    // One character short, and one long.
    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=a1b2c3d4e5f6071`),
    ).toBeNull();
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}0`)).toBeNull();
    // And the case the bound is really for: something enormous.
    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${'a'.repeat(5000)}`),
    ).toBeNull();
  });

  it('should require both parameters', () => {
    // A playlist with no seed would deal a RANDOM order, which is what the landing form already
    // does and not what the link promised. A seed with no playlist addresses nothing.
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}`)).toBeNull();
    expect(parseDeckLink(`?${SEED_PARAM}=${SEED}`)).toBeNull();
  });

  it('should return null rather than throwing on a mangled query string', () => {
    // Every one of these is a real thing a chat client, a URL shortener or a hand-edited address
    // bar produces, and none of them is a failure state worth a banner: the caller shows the plain
    // landing screen for `null`.
    for (const mangled of [
      '',
      '?',
      '???',
      '%',
      '%zz',
      `?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}`,
      `?&&&=${SEED}`,
      '?playlist=%E0%A4%A',
      'not a query string at all',
    ]) {
      expect(() => parseDeckLink(mangled)).not.toThrow();
      expect(parseDeckLink(mangled)).toBeNull();
    }
  });

  it('should ignore unrelated parameters', () => {
    // A link that has been through a tracker keeps working.
    expect(
      parseDeckLink(
        `?utm_source=whatsapp&${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}&x=1`,
      ),
    ).toEqual({ playlistId: PLAYLIST_ID, seed: SEED });
  });
});

describe('buildDeckLink', () => {
  it('should build a link that round-trips through the parser', () => {
    const url = buildDeckLink('https://hitster.example', PLAYLIST_ID, SEED);

    expect(url).toBe(
      `https://hitster.example?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`,
    );
    // The round trip is the assertion that matters: whatever the build format is, the parser must
    // read it back. These two functions are the only pair in the app that has to agree exactly.
    const search = url.slice(url.indexOf('?'));
    expect(parseDeckLink(search)).toEqual({ playlistId: PLAYLIST_ID, seed: SEED });
  });

  it('should round-trip a freshly generated seed', () => {
    // Pins the two halves together: `generateSeed()` is the only producer of seeds in the app, and
    // `SEED_PATTERN` is the only consumer that can reject one. If either changes alone, this fails.
    const seed = generateSeed();
    const search = buildDeckLink('https://hitster.example/', PLAYLIST_ID, seed);

    expect(parseDeckLink(search.slice(search.indexOf('?')))).toEqual({
      playlistId: PLAYLIST_ID,
      seed,
    });
  });

  it('should normalise a trailing slash on the origin', () => {
    // `location.origin + location.pathname` produces one for a root-served app, so this is the
    // ordinary input rather than an edge case.
    expect(buildDeckLink('https://hitster.example/', PLAYLIST_ID, SEED)).toBe(
      `https://hitster.example?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`,
    );
  });

  it('should keep a sub-path so an app served from one stays reachable', () => {
    expect(buildDeckLink('https://example.com/hitster/', PLAYLIST_ID, SEED)).toBe(
      `https://example.com/hitster?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`,
    );
  });
});
