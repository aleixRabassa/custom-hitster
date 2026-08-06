/**
 * Offline tests for the playlist client. NODE environment -- no jsdom, no network, exactly like
 * `year-client.test.ts`, which is the whole payoff of the injected `fetch`.
 *
 * Every status branch, every code, and the shape validation are covered here rather than through
 * a rendered screen, because a discriminated result is cheap to assert and a screen is not.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPlaylist, isBrowserOnline } from './playlist-client';
import type { PlaylistFetch, PlaylistFetchResponse } from './playlist-client';
import type { Card, PlaylistErrorCode, PlaylistResult } from '../../shared/types';

const PLAYLIST_URL = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

const CARD: Card = {
  id: '3z8h0TU7ReDPLIbEnYhWZb',
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  durationMs: 354320,
  previewUrl: 'https://p.scdn.co/mp3-preview/bohemian',
  isPlayable: true,
};

const RESULT: PlaylistResult = {
  playlist: { id: '37i9dQZF1DXcBWIGoYBM5M', name: 'Today’s Top Hits', owner: 'Spotify' },
  cards: [CARD],
  truncated: false,
  skippedCount: 0,
};

/** A response double carrying the three fields the client reads. */
function response(status: number, body: unknown, bodyThrows = false): PlaylistFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (bodyThrows ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)),
  };
}

function fetchReturning(scripted: PlaylistFetchResponse): PlaylistFetch {
  return vi.fn<PlaylistFetch>(() => Promise.resolve(scripted));
}

/**
 * A `fetch` double that BRAND-CHECKS its receiver, the way the browser's native one does.
 *
 * ===========================================================================
 *  THIS MODELS THE ONE BUG NO OTHER TEST IN THIS REPO COULD SEE.
 *
 *  The native `fetch` throws `TypeError: Failed to execute 'fetch' on 'Window':
 *  Illegal invocation` when its receiver is not the global object -- and calling
 *  it as `options.fetchImpl(...)` hands it the options object. The client's
 *  `catch` then turned that into `network`, so every Start reported "Could not
 *  reach the server" for a request that never left the page.
 *
 *  Neither environment this suite can run in reproduces that on its own: every
 *  other stub here is a plain function, and node's `fetch` is not brand-checked
 *  either. So the check is written out explicitly. A `function` declaration, not
 *  an arrow -- an arrow has no `this` to inspect, which is exactly what made
 *  this class of bug invisible.
 * ===========================================================================
 */
function brandCheckedFetch(scripted: PlaylistFetchResponse): PlaylistFetch {
  return function (this: unknown) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }

    return Promise.resolve(scripted);
  };
}

describe('fetchPlaylist', () => {
  it('should return the playlist result for a 200 body', async () => {
    const outcome = await fetchPlaylist(PLAYLIST_URL, {
      fetchImpl: fetchReturning(response(200, RESULT)),
    });

    expect(outcome).toEqual({ ok: true, result: RESULT });
  });

  it('should not call fetch with the options object as its receiver', async () => {
    // The regression test for the "Could not reach the server" bug. If this client ever goes back
    // to `options.fetchImpl(...)`, the native `fetch` gets `options` as `this` and throws before a
    // request is made -- and the failure reads as the player's Wi-Fi rather than as our call site.
    const outcome = await fetchPlaylist(PLAYLIST_URL, {
      fetchImpl: brandCheckedFetch(response(200, RESULT)),
    });

    expect(outcome).toEqual({ ok: true, result: RESULT });
  });

  it('should send the URL raw as a query parameter', async () => {
    // RAW, exactly as typed. The server owns every question about what a URL means; a client
    // that normalised a little is how the two ideas of a valid link drift apart.
    const fetchImpl = fetchReturning(response(200, RESULT));
    await fetchPlaylist(PLAYLIST_URL, { fetchImpl });

    const requested = vi.mocked(fetchImpl).mock.calls[0]?.[0] ?? '';
    expect(requested.startsWith('/api/playlist?')).toBe(true);
    expect(new URL(requested, 'https://example.test').searchParams.get('url')).toBe(PLAYLIST_URL);
  });

  it('should preserve truncated and skippedCount from the body', async () => {
    // Both drive a non-blocking notice, and neither may ever gate Start -- so they have to
    // survive the trip rather than being normalised away as uninteresting.
    const body: PlaylistResult = { ...RESULT, truncated: true, skippedCount: 3 };
    const outcome = await fetchPlaylist(PLAYLIST_URL, {
      fetchImpl: fetchReturning(response(200, body)),
    });

    expect(outcome).toEqual({ ok: true, result: body });
  });

  it('should keep an absent year absent rather than null', async () => {
    // `Card.year`'s three states: absent = not looked up, null = looked up and nothing found.
    // `isCurrentYearPending` reads exactly that difference, so a client that normalised absent
    // to null would spin the pending state forever on every card.
    const outcome = await fetchPlaylist(PLAYLIST_URL, {
      fetchImpl: fetchReturning(response(200, RESULT)),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect('year' in (outcome.result.cards[0] ?? {})).toBe(false);
  });

  it('should map each typed error code to a result', async () => {
    // One case per `PlaylistErrorCode`. The status is deliberately the WRONG one in each pairing
    // below so the assertion proves the body's `code` wins over the status fallback.
    const codes: PlaylistErrorCode[] = [
      'invalid-url',
      'unsupported-entity',
      'not-found-or-private',
      'upstream-unavailable',
      'unexpected-payload',
    ];

    for (const code of codes) {
      const outcome = await fetchPlaylist(PLAYLIST_URL, {
        fetchImpl: fetchReturning(response(418, { code, message: 'whatever' })),
      });

      expect(outcome).toEqual({ ok: false, code });
    }
  });

  it('should distinguish upstream-unavailable from unexpected-payload on a 502', async () => {
    // ===================================================================
    //  Both codes map to 502 server-side and they mean OPPOSITE things:
    //  one is transient and worth retrying, the other means the embed
    //  scrape broke and retrying is pointless. The body's `code` is the
    //  only thing that separates them, which is exactly why 502 is absent
    //  from the client's status-fallback table.
    // ===================================================================
    expect(
      await fetchPlaylist(PLAYLIST_URL, {
        fetchImpl: fetchReturning(response(502, { code: 'upstream-unavailable', message: 'x' })),
      }),
    ).toEqual({ ok: false, code: 'upstream-unavailable' });

    expect(
      await fetchPlaylist(PLAYLIST_URL, {
        fetchImpl: fetchReturning(response(502, { code: 'unexpected-payload', message: 'x' })),
      }),
    ).toEqual({ ok: false, code: 'unexpected-payload' });

    // And a 502 with NO usable body guesses neither -- it degrades to a code whose copy
    // promises nothing, rather than picking one of two opposite diagnoses at random.
    expect(
      await fetchPlaylist(PLAYLIST_URL, { fetchImpl: fetchReturning(response(502, undefined)) }),
    ).toEqual({ ok: false, code: 'unknown-error' });
  });

  it('should fall back to the status when the body has no recognisable code', async () => {
    // `method-not-allowed` (405) and `internal-error` (500) are real codes `api/playlist.ts`
    // sends and are NOT in `PlaylistErrorCode` -- the union is about playlist failures, not
    // about every way a handler can answer. Neither may be trusted as a code.
    expect(
      await fetchPlaylist(PLAYLIST_URL, {
        fetchImpl: fetchReturning(
          response(405, { code: 'method-not-allowed', message: 'Use GET.' }),
        ),
      }),
    ).toEqual({ ok: false, code: 'unknown-error' });

    expect(
      await fetchPlaylist(PLAYLIST_URL, {
        fetchImpl: fetchReturning(response(500, { code: 'internal-error', message: 'x' })),
      }),
    ).toEqual({ ok: false, code: 'unknown-error' });

    // The two statuses the table DOES cover, with no body at all.
    expect(
      await fetchPlaylist(PLAYLIST_URL, { fetchImpl: fetchReturning(response(400, undefined)) }),
    ).toEqual({ ok: false, code: 'invalid-url' });
    expect(
      await fetchPlaylist(PLAYLIST_URL, { fetchImpl: fetchReturning(response(404, undefined)) }),
    ).toEqual({ ok: false, code: 'not-found-or-private' });
  });

  it('should report unexpected-payload for a 200 whose body is not JSON', async () => {
    // ===================================================================
    //  THE `pnpm dev` TRAP, and it is not theoretical.
    //
    //  Vite does not run functions: it serves `api/playlist.ts` as a module,
    //  so the response is the TRANSPILED SOURCE of the handler with status
    //  200. Anyone who runs `pnpm dev` instead of `npx vercel dev` hits this
    //  on their first Start, and a readable error beats a raw SyntaxError
    //  surfacing from inside a promise chain.
    // ===================================================================
    const outcome = await fetchPlaylist(PLAYLIST_URL, {
      fetchImpl: fetchReturning(response(200, undefined, true)),
    });

    expect(outcome).toEqual({ ok: false, code: 'unexpected-payload' });
  });

  it('should report unexpected-payload for a 200 missing cards or playlist', async () => {
    const bad: unknown[] = [
      undefined,
      null,
      'a string',
      [],
      {},
      // Missing `cards`.
      { playlist: RESULT.playlist, truncated: false, skippedCount: 0 },
      // Missing `playlist`.
      { cards: [CARD], truncated: false, skippedCount: 0 },
      // `cards` not an array. An EMPTY array is deliberately NOT in this list any more -- it is a
      // well-formed payload and gets `empty-playlist`; see the two tests below.
      { ...RESULT, cards: { 0: CARD } },
      // A malformed card. Rejected wholesale rather than skipped, because a silently shrinking
      // deck breaks the reproducibility the shuffle seed exists for.
      { ...RESULT, cards: [{ id: 'x', title: 'y' }] },
      { ...RESULT, cards: [{ ...CARD, isPlayable: 'yes' }] },
      { ...RESULT, cards: [{ ...CARD, durationMs: 'long' }] },
      { ...RESULT, cards: [{ ...CARD, yearConfidence: 'medium' }] },
      // Playlist summary with the wrong field types.
      { ...RESULT, playlist: { id: '', name: 'x', owner: 'y' } },
      { ...RESULT, playlist: { id: 'x', name: 1, owner: 'y' } },
      // The notice fields, which the landing screen reads directly.
      { ...RESULT, truncated: 'no' },
      { ...RESULT, skippedCount: null },
    ];

    for (const body of bad) {
      expect(
        await fetchPlaylist(PLAYLIST_URL, { fetchImpl: fetchReturning(response(200, body)) }),
      ).toEqual({ ok: false, code: 'unexpected-payload' });
    }
  });

  it('should report empty-playlist for a well-formed response with zero cards', async () => {
    // ===================================================================
    //  THE REGRESSION IS `unexpected-payload`, WHICH IS WHAT THIS RETURNED
    //  THROUGH PHASE 6 -- i.e. "Spotify returned something we could not read.
    //  This is a problem on our side, not with your link." The payload was
    //  perfectly readable and said, correctly, that there is nothing to play.
    //
    //  Reachable in production, not only through this stub: the embed adapter
    //  accepts an empty `trackList` and `api/playlist.ts` forwards it as a 200.
    // ===================================================================
    const outcome = await fetchPlaylist(PLAYLIST_URL, {
      fetchImpl: fetchReturning(response(200, { ...RESULT, cards: [] })),
    });

    expect(outcome).toEqual({ ok: false, code: 'empty-playlist' });
  });

  it('should still report unexpected-payload when cards is not an array', async () => {
    // The other half of the split. One branch became two, and this is the case that gets lost when
    // that happens: everything non-array must keep landing on the malformed code, including the
    // values that are falsy or that look empty.
    for (const cards of [undefined, null, 0, '', 'none', {}, { 0: CARD }, { length: 0 }]) {
      expect(
        await fetchPlaylist(PLAYLIST_URL, {
          fetchImpl: fetchReturning(response(200, { ...RESULT, cards })),
        }),
      ).toEqual({ ok: false, code: 'unexpected-payload' });
    }
  });

  it('should report offline without attempting a fetch when the predicate says so', async () => {
    // ===================================================================
    //  THE IMPORTANT HALF IS THAT THE FETCH DOUBLE IS NEVER CALLED.
    //
    //  A code returned AFTER a pointless request is not the behaviour being
    //  built: the player would still watch "Loading…" until the browser gave
    //  up, and only then be told about a connection the browser already knew
    //  was missing. The answer is available synchronously.
    // ===================================================================
    const fetchImpl = fetchReturning(response(200, RESULT));

    const outcome = await fetchPlaylist(PLAYLIST_URL, { fetchImpl, isOnline: () => false });

    expect(outcome).toEqual({ ok: false, code: 'offline' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should default to online when no predicate is injected', async () => {
    // Guards the REAL app path, which passes nothing: a default that resolved to offline would make
    // every Start fail with no request, and no other test here would notice because they all inject.
    const outcome = await fetchPlaylist(PLAYLIST_URL, {
      fetchImpl: fetchReturning(response(200, RESULT)),
    });

    expect(outcome).toEqual({ ok: true, result: RESULT });
  });

  it('should proceed when the injected predicate says online', async () => {
    // The other direction, so the short-circuit cannot become unconditional.
    const fetchImpl = fetchReturning(response(200, RESULT));

    expect(await fetchPlaylist(PLAYLIST_URL, { fetchImpl, isOnline: () => true })).toEqual({
      ok: true,
      result: RESULT,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should report network for a request that fails while the browser thinks it is online', async () => {
    // WHY BOTH CODES EXIST. `navigator.onLine` reports a network INTERFACE, not reachability, so a
    // captive portal -- hotel Wi-Fi, a train -- reports online and fails every request. If this
    // ever returned `offline`, the fallback would have been merged away and one of the two
    // sentences would be a lie.
    const fetchImpl = vi.fn<PlaylistFetch>(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await fetchPlaylist(PLAYLIST_URL, { fetchImpl, isOnline: () => true })).toEqual({
      ok: false,
      code: 'network',
    });
  });

  it('should report network when the fetch rejects', async () => {
    const fetchImpl = vi.fn<PlaylistFetch>(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await fetchPlaylist(PLAYLIST_URL, { fetchImpl })).toEqual({
      ok: false,
      code: 'network',
    });
  });

  it('should pass the abort signal through and honour it', async () => {
    // The signal is what makes a second submission safe: without it the slower of two requests
    // wins by landing last, and the player gets the deck they changed their mind about.
    const controller = new AbortController();
    const fetchImpl = vi.fn<PlaylistFetch>((_url, init) =>
      init?.signal?.aborted
        ? Promise.reject(new DOMException('Aborted', 'AbortError'))
        : Promise.resolve(response(200, RESULT)),
    );

    // Passed through untouched.
    await fetchPlaylist(PLAYLIST_URL, { fetchImpl, signal: controller.signal });
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[1]?.signal).toBe(controller.signal);

    // And an abort is a `network` result rather than a rejection escaping to the caller.
    controller.abort();
    expect(await fetchPlaylist(PLAYLIST_URL, { fetchImpl, signal: controller.signal })).toEqual({
      ok: false,
      code: 'network',
    });
  });

  it('should never throw for any response shape', async () => {
    // The landing screen has no catch around this: the contract is a result, always.
    const shapes: PlaylistFetchResponse[] = [
      response(200, undefined, true),
      response(500, undefined, true),
      response(0, undefined),
      response(999, { code: 42 }),
      { ok: true, status: 200, json: () => Promise.reject(new Error('boom')) },
    ];

    for (const scripted of shapes) {
      await expect(
        fetchPlaylist(PLAYLIST_URL, { fetchImpl: fetchReturning(scripted) }),
      ).resolves.toBeDefined();
    }
  });
});

describe('isBrowserOnline', () => {
  /**
   * Restored after every case: `navigator` is a real global in this environment, and a test that
   * left it stubbed would change what the DEFAULT-predicate tests above are measuring.
   */
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should treat an absent navigator as online', () => {
    // ===================================================================
    //  THIS IS THE NODE ENVIRONMENT'S OWN CASE, so the test runs in the
    //  situation it describes rather than simulating a distant one.
    //
    //  Every test in this file runs with no jsdom -- that is the property the
    //  injected `fetch` exists to preserve -- so there is no DOM `navigator`
    //  here. Refusing to fetch because a DOM global is missing would be a
    //  false negative in the one environment that cannot be offline, and it
    //  would fail every other test in this file at once.
    // ===================================================================
    vi.stubGlobal('navigator', undefined);

    expect(isBrowserOnline()).toBe(true);
  });

  it('should treat a navigator without onLine as online', () => {
    // What node ACTUALLY gives you, as of node 25: a `navigator` with `userAgent`, `platform` and
    // `hardwareConcurrency` and no `onLine` key at all. "Cannot tell" has to resolve to online, and
    // the read has to be a `typeof === 'boolean'` check rather than a truthiness test to get there.
    vi.stubGlobal('navigator', { userAgent: 'node' });

    expect(isBrowserOnline()).toBe(true);
  });

  it('should report the browser value when navigator.onLine is a boolean', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isBrowserOnline()).toBe(false);

    vi.stubGlobal('navigator', { onLine: true });
    expect(isBrowserOnline()).toBe(true);
  });

  it('should ignore a non-boolean onLine rather than coerce it', () => {
    // A truthiness check would read `''` or `0` as offline and refuse to make a request that would
    // have worked. Only a real boolean is an answer.
    for (const onLine of ['', 0, null, 'yes', undefined]) {
      vi.stubGlobal('navigator', { onLine });
      expect(isBrowserOnline()).toBe(true);
    }
  });
});
