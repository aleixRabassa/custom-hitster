/**
 * Node environment, no docblock needed: this module touches no DOM, which is the whole point of
 * it living in `src/game/` rather than in a component or a hook.
 */

import { describe, expect, it } from 'vitest';

import {
  CARD_PARAM,
  PLAYLIST_PARAM,
  SEED_PARAM,
  buildDeckLink,
  linkArrivalIntent,
  parseDeckLink,
  type DeckLink,
  type LinkArrival,
} from './deck-link';
import { MAX_DECK_PLAYLISTS } from './deck-merge';
import { generateSeed } from './shuffle';
import type { PlaylistSummary } from '../../shared/types';

/** A real 22-character base62 id, and the shape `parsePlaylistUrl` accepts bare. */
const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';

/** More of them, all 22 base62 characters, so a multi-playlist link is a realistic one. */
const SECOND_ID = '37i9dQZF1DX0XUsuxWHRQd';
const THIRD_ID = '37i9dQZEVXbMDoHDwVN2tF';

/** Enough distinct ids to walk past the cap. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${'0'.repeat(21 - `${i}`.length)}${i}a`);
}

/** 16 lowercase hex characters — exactly what `generateSeed()` mints. */
const SEED = 'a1b2c3d4e5f60718';

/** Another one, for "a different deck". */
const OTHER_SEED = '0f1e2d3c4b5a6978';

/**
 * A real-shaped 22-character track id, MIXED CASE on purpose: base62 is case-sensitive, so a
 * lowercased copy of it names a different track, and the case-preservation assertions need a value
 * where lowercasing would change something.
 */
const TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';

describe('parseDeckLink', () => {
  it('should parse a link carrying a playlist id and a seed', () => {
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`)).toEqual({
      playlistIds: [PLAYLIST_ID],
      seed: SEED,
      cardId: null,
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
      playlistIds: [PLAYLIST_ID],
      seed: SEED,
      cardId: null,
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
    ).toEqual({ playlistIds: [PLAYLIST_ID], seed: SEED, cardId: null });
  });
});

// ===========================================================================
//  1..5 PLAYLISTS IN ONE LINK
//
//  The canonical form is one `playlist` param holding a comma list. A single id
//  is the one-element case, so every link shared before multi-playlist parses
//  identically -- which is why there is no back-compat branch in the module.
// ===========================================================================

describe('parseDeckLink with several playlists', () => {
  it('should parse a comma-separated list of ids', () => {
    expect(
      parseDeckLink(
        `?${PLAYLIST_PARAM}=${PLAYLIST_ID},${SECOND_ID},${THIRD_ID}&${SEED_PARAM}=${SEED}`,
      ),
      // In LINK order, which is row order, which is the order the merge concatenates in.
    ).toEqual({
      playlistIds: [PLAYLIST_ID, SECOND_ID, THIRD_ID],
      seed: SEED,
      cardId: null,
    });
  });

  it('should still parse a single-id link', () => {
    // Back-compat with every link already shared, and it costs no branch: one id is a comma list
    // with no commas in it.
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`)).toEqual({
      playlistIds: [PLAYLIST_ID],
      seed: SEED,
      cardId: null,
    });
  });

  it('should parse repeated playlist params', () => {
    // `getAll` tolerance, one line of it, for a link a chat client or a future build reshaped. The
    // builder only ever emits the comma form, so the round trip is unaffected.
    expect(
      parseDeckLink(
        `?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${PLAYLIST_PARAM}=${SECOND_ID}&${SEED_PARAM}=${SEED}`,
      ),
    ).toEqual({
      playlistIds: [PLAYLIST_ID, SECOND_ID],
      seed: SEED,
      cardId: null,
    });
  });

  it('should accept full playlist URLs inside the list', () => {
    // `parsePlaylistUrl` runs PER ELEMENT, so every form it accepts is accepted in every position.
    const encoded = encodeURIComponent(`https://open.spotify.com/intl-es/playlist/${SECOND_ID}`);

    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID},${encoded}&${SEED_PARAM}=${SEED}`),
    ).toEqual({
      playlistIds: [PLAYLIST_ID, SECOND_ID],
      seed: SEED,
      cardId: null,
    });
  });

  it('should reject a link whose list holds an album link', () => {
    // ONE bad element fails the WHOLE link, so an album buried at position two cannot quietly deal
    // a smaller deck than the sender described.
    const album = encodeURIComponent(`https://open.spotify.com/album/${SECOND_ID}`);

    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID},${album}&${SEED_PARAM}=${SEED}`),
    ).toBeNull();
  });

  it('should drop empty elements produced by stray commas', () => {
    // A trailing or doubled comma is punctuation, not a playlist somebody meant to name.
    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${PLAYLIST_ID},,${SECOND_ID},&${SEED_PARAM}=${SEED}`),
    ).toEqual({
      playlistIds: [PLAYLIST_ID, SECOND_ID],
      seed: SEED,
      cardId: null,
    });
    // ...but a value of NOTHING but commas names no playlist at all.
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=,,,&${SEED_PARAM}=${SEED}`)).toBeNull();
  });

  it('should reject a link with more than the maximum number of playlists', () => {
    // ===================================================================
    //  A REJECTION, NOT A TRUNCATION (decision 9).
    //
    //  Truncating would deal a deck the link did not describe, silently, with
    //  a seed that makes it look deliberate. `null` is the plain landing
    //  screen with no error -- identical to every other rejection here.
    // ===================================================================
    const over = ids(MAX_DECK_PLAYLISTS + 1).join(',');
    expect(parseDeckLink(`?${PLAYLIST_PARAM}=${over}&${SEED_PARAM}=${SEED}`)).toBeNull();

    // Exactly at the cap still parses, so the boundary is inclusive.
    const atCap = ids(MAX_DECK_PLAYLISTS);
    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${atCap.join(',')}&${SEED_PARAM}=${SEED}`)?.playlistIds,
    ).toEqual(atCap);
  });

  it('should dedupe repeated ids before the cap check', () => {
    // The ORDER of those two rules is the assertion: a link repeating one id is not punished for it,
    // so six entries naming five distinct playlists is a five-playlist link rather than a rejection.
    const withRepeat = [...ids(MAX_DECK_PLAYLISTS), ids(MAX_DECK_PLAYLISTS)[0]!].join(',');

    expect(
      parseDeckLink(`?${PLAYLIST_PARAM}=${withRepeat}&${SEED_PARAM}=${SEED}`)?.playlistIds,
    ).toEqual(ids(MAX_DECK_PLAYLISTS));

    // And a plain duplicate collapses to one, keeping the first position.
    expect(
      parseDeckLink(
        `?${PLAYLIST_PARAM}=${PLAYLIST_ID},${SECOND_ID},${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`,
      )?.playlistIds,
    ).toEqual([PLAYLIST_ID, SECOND_ID]);
  });
});

describe('buildDeckLink', () => {
  it('should build a link joining the ids with commas', () => {
    // A comma is a legal query-value character, so nothing is escaped and the link stays readable
    // in the chat clients these get pasted into.
    expect(buildDeckLink('https://jitster.example', [PLAYLIST_ID, SECOND_ID], SEED)).toBe(
      `https://jitster.example?${PLAYLIST_PARAM}=${PLAYLIST_ID},${SECOND_ID}&${SEED_PARAM}=${SEED}`,
    );
  });

  it('should round-trip a built multi link back through the parser', () => {
    // The pair together: whatever the build format is, the parser must read it back exactly. These
    // two functions are the only pair in the app that has to agree.
    const playlistIds = [PLAYLIST_ID, SECOND_ID, THIRD_ID];
    const url = buildDeckLink('https://jitster.example/', playlistIds, SEED);

    expect(parseDeckLink(url.slice(url.indexOf('?')))).toEqual({
      playlistIds,
      seed: SEED,
      cardId: null,
    });
  });

  it('should build a link that round-trips through the parser', () => {
    const url = buildDeckLink('https://jitster.example', [PLAYLIST_ID], SEED);

    expect(url).toBe(
      `https://jitster.example?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`,
    );
    // The round trip is the assertion that matters: whatever the build format is, the parser must
    // read it back. These two functions are the only pair in the app that has to agree exactly.
    const search = url.slice(url.indexOf('?'));
    expect(parseDeckLink(search)).toEqual({
      playlistIds: [PLAYLIST_ID],
      seed: SEED,
      cardId: null,
    });
  });

  it('should round-trip a freshly generated seed', () => {
    // Pins the two halves together: `generateSeed()` is the only producer of seeds in the app, and
    // `SEED_PATTERN` is the only consumer that can reject one. If either changes alone, this fails.
    const seed = generateSeed();
    const search = buildDeckLink('https://jitster.example/', [PLAYLIST_ID], seed);

    expect(parseDeckLink(search.slice(search.indexOf('?')))).toEqual({
      playlistIds: [PLAYLIST_ID],
      seed,
      cardId: null,
    });
  });

  it('should normalise a trailing slash on the origin', () => {
    // `location.origin + location.pathname` produces one for a root-served app, so this is the
    // ordinary input rather than an edge case.
    expect(buildDeckLink('https://jitster.example/', [PLAYLIST_ID], SEED)).toBe(
      `https://jitster.example?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`,
    );
  });

  it('should keep a sub-path so an app served from one stays reachable', () => {
    expect(buildDeckLink('https://example.com/jitster/', [PLAYLIST_ID], SEED)).toBe(
      `https://example.com/jitster?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`,
    );
  });
});

// ===========================================================================
//  THE START CARD (`card`), AND THE `v` PARAM THAT IS NO LONGER READ, 2026-09-29.
//
//  `card` is optional and follows the module's one-bad-element rule:
//  present-and-malformed rejects the whole link. `v` is the opposite: links
//  minted while the shuffle was versioned carry `v=2`, and with one algorithm
//  left the param carries no information, so ANY value of it is ignored.
// ===========================================================================

describe('parseDeckLink with a v param', () => {
  const base = `?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`;

  it('should parse a link carrying v exactly as the same link without it', () => {
    // `v=2` is what every link minted by the versioned build carries, and it must keep working.
    // `v=1` and garbage are ignored the same way rather than rejected: the param names a choice
    // this build no longer has, so no value of it can change the deal.
    const without = parseDeckLink(base);
    expect(without).not.toBeNull();

    for (const value of ['2', '1', 'abc', '', '3']) {
      expect(parseDeckLink(`${base}&v=${value}`)).toEqual(without);
    }
    // A bare `v` with no `=` is `v=` to `URLSearchParams`, and is ignored too.
    expect(parseDeckLink(`${base}&v`)).toEqual(without);
  });

  it('should ignore v on a link that also carries a card', () => {
    expect(parseDeckLink(`${base}&v=2&${CARD_PARAM}=${TRACK_ID}`)).toEqual(
      parseDeckLink(`${base}&${CARD_PARAM}=${TRACK_ID}`),
    );
  });
});

describe('parseDeckLink with a start card', () => {
  const base = `?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`;

  it('should read the card param as a track id', () => {
    expect(parseDeckLink(`${base}&${CARD_PARAM}=${TRACK_ID}`)).toEqual({
      playlistIds: [PLAYLIST_ID],
      seed: SEED,
      cardId: TRACK_ID,
    });
  });

  it('should report null when the link carries no card', () => {
    // An end-screen link, and every link minted before 2026-09-29.
    expect(parseDeckLink(base)?.cardId).toBeNull();
  });

  it('should preserve the case of the card id', () => {
    // The seed is lowercased and this must NOT be: base62 is case-sensitive, so a lowercased track
    // id is a different track or none at all.
    expect(parseDeckLink(`${base}&${CARD_PARAM}=${TRACK_ID}`)?.cardId).toBe(TRACK_ID);
    expect(parseDeckLink(`${base}&${CARD_PARAM}=${TRACK_ID.toUpperCase()}`)?.cardId).toBe(
      TRACK_ID.toUpperCase(),
    );
  });

  it('should trim whitespace around the card id', () => {
    expect(parseDeckLink(`${base}&${CARD_PARAM}=%20${TRACK_ID}+`)?.cardId).toBe(TRACK_ID);
  });

  it('should reject the whole link when the card is malformed', () => {
    // The one-bad-element rule: a mangled position must not quietly deal from card 1, as if the
    // sender had sent none.
    for (const value of [
      '',
      'tooshort',
      `${TRACK_ID}X`,
      TRACK_ID.slice(1),
      `${TRACK_ID.slice(0, 21)}-`,
      encodeURIComponent(`https://open.spotify.com/track/${TRACK_ID}`),
    ]) {
      expect(parseDeckLink(`${base}&${CARD_PARAM}=${value}`)).toBeNull();
    }
  });
});

describe('buildDeckLink with a start card', () => {
  const origin = 'https://jitster.example';

  it('should never write a v param', () => {
    // One algorithm, so there is nothing for it to say (see the module header).
    for (const url of [
      buildDeckLink(origin, [PLAYLIST_ID], SEED),
      buildDeckLink(origin, [PLAYLIST_ID, SECOND_ID], SEED, {}),
      buildDeckLink(origin, [PLAYLIST_ID], SEED, { cardId: TRACK_ID }),
    ]) {
      expect(url).not.toContain('v=');
      expect(new URLSearchParams(url.slice(url.indexOf('?'))).has('v')).toBe(false);
    }
  });

  it('should append the card last, and only when given', () => {
    expect(buildDeckLink(origin, [PLAYLIST_ID], SEED, { cardId: TRACK_ID })).toBe(
      `${origin}?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}&${CARD_PARAM}=${TRACK_ID}`,
    );
    expect(buildDeckLink(origin, [PLAYLIST_ID], SEED, {})).toBe(
      `${origin}?${PLAYLIST_PARAM}=${PLAYLIST_ID}&${SEED_PARAM}=${SEED}`,
    );
  });

  it('should round-trip a link with and without a card exactly', () => {
    const playlistIds = [PLAYLIST_ID, SECOND_ID, THIRD_ID];

    for (const cardId of [undefined, TRACK_ID]) {
      const url = buildDeckLink(`${origin}/`, playlistIds, SEED, { cardId });

      expect(parseDeckLink(url.slice(url.indexOf('?')))).toEqual({
        playlistIds,
        seed: SEED,
        cardId: cardId ?? null,
      });
    }
  });

  it('should round-trip a freshly generated seed with a card', () => {
    const seed = generateSeed();
    const url = buildDeckLink(origin, [PLAYLIST_ID], seed, { cardId: TRACK_ID });

    expect(parseDeckLink(url.slice(url.indexOf('?')))).toEqual({
      playlistIds: [PLAYLIST_ID],
      seed,
      cardId: TRACK_ID,
    });
  });
});

// ===========================================================================
//  WHAT A LINK DOES ON ARRIVAL (D2 and D4).
//
//  A reload of a link-opened tab arrives with the saved game AND the link at
//  once, and must resume silently -- "si el enlace es el mismo, nunca se debe
//  modificar la partida". Only a link to a DIFFERENT deck asks.
// ===========================================================================

describe('linkArrivalIntent', () => {
  const playlist = (id: string): PlaylistSummary => ({
    id,
    name: `Playlist ${id}`,
    owner: 'Spotify',
  });

  const link: DeckLink = {
    playlistIds: [PLAYLIST_ID, SECOND_ID],
    seed: SEED,
    cardId: TRACK_ID,
  };

  type Session = Parameters<typeof linkArrivalIntent>[1];

  /** The saved game this link dealt: same playlists and seed. */
  const sameDeck: Session = {
    status: 'playing',
    playlists: [playlist(PLAYLIST_ID), playlist(SECOND_ID)],
    seed: SEED,
  };

  const cases: [label: string, session: Session, expected: LinkArrival][] = [
    [
      'idle: there is no game at all',
      { ...sameDeck, status: 'idle', playlists: [], seed: '' },
      'deal',
    ],
    // After End or Exit the save is cleared and the game no longer exists (D2, rule 4), so even
    // the link's own deck is dealt again from the top.
    [
      'ended: the game no longer exists, even for the same deck',
      { ...sameDeck, status: 'ended' },
      'deal',
    ],
    ['the same deck, playing: a reload of the link-opened tab', sameDeck, 'resume'],
    ['the same deck, still preparing', { ...sameDeck, status: 'preparing' }, 'resume'],
    [
      'a subset of the ids: one of the linked playlists failed to load',
      { ...sameDeck, playlists: [playlist(SECOND_ID)] },
      'resume',
    ],
    [
      'the same ids in another order',
      { ...sameDeck, playlists: [playlist(SECOND_ID), playlist(PLAYLIST_ID)] },
      'resume',
    ],
    ['a different seed', { ...sameDeck, seed: OTHER_SEED }, 'ask'],
    [
      'a playlist in the saved game that the link does not name',
      { ...sameDeck, playlists: [playlist(PLAYLIST_ID), playlist(SECOND_ID), playlist(THIRD_ID)] },
      'ask',
    ],
    [
      'a saved game from playlists the link does not name at all',
      { ...sameDeck, playlists: [playlist(THIRD_ID)] },
      'ask',
    ],
  ];

  it.each(cases)('should answer %s', (_label, session, expected) => {
    expect(linkArrivalIntent(link, session)).toBe(expected);
  });

  it('should resume the same deck whatever card the link names, including none', () => {
    // The sender's card is where THEY were. A reloader has moved on since, and honouring it would
    // move them off their own card -- so it cannot change the answer.
    for (const cardId of [null, TRACK_ID, '1111111111111111111111']) {
      expect(linkArrivalIntent({ ...link, cardId }, sameDeck)).toBe('resume');
    }
  });

  it('should still ask about a different deck whatever card the link names', () => {
    for (const cardId of [null, TRACK_ID]) {
      expect(linkArrivalIntent({ ...link, cardId }, { ...sameDeck, seed: OTHER_SEED })).toBe('ask');
    }
  });
});
