import { describe, expect, it } from 'vitest';

import { lookupYear } from './year-client';
import type { YearFetch, YearFetchResponse } from './year-client';
import type { TrackRef, YearLookupResult } from '../../shared/types';

const TRACK: TrackRef = {
  title: 'Bohemian Rhapsody - Remastered 2011',
  artist: 'Queen',
  durationMs: 354_320,
};

const SUCCESS: YearLookupResult = {
  year: 1975,
  confidence: 'high',
  source: 'release-group',
  cached: false,
  cleanedTitle: 'Bohemian Rhapsody',
  stripped: { remaster: true, live: false, feature: false, version: false },
};

/** No `Headers` class in the node environment, and none needed: the client only reads `get`. */
function headers(values: Record<string, string> = {}): YearFetchResponse['headers'] {
  return { get: (name) => values[name] ?? null };
}

interface StubOptions {
  status?: number;
  body?: unknown;
  /** Simulates a body that is not JSON at all -- an HTML error page from an edge, say. */
  unparseableBody?: boolean;
  headerValues?: Record<string, string>;
}

/** A fetch double that records every URL it was called with. */
function stubFetch(options: StubOptions = {}): { fetchImpl: YearFetch; urls: string[] } {
  const status = options.status ?? 200;
  const urls: string[] = [];

  const fetchImpl: YearFetch = (url) => {
    urls.push(url);

    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: headers(options.headerValues),
      json: () =>
        options.unparseableBody
          ? Promise.reject(new Error('Unexpected token < in JSON'))
          : Promise.resolve(options.body ?? SUCCESS),
    });
  };

  return { fetchImpl, urls };
}

/**
 * A `fetch` double that brand-checks its receiver, as the browser's native one does.
 *
 * The twin of `brandCheckedFetch` in `playlist-client.test.ts`, and it guards the same bug: called
 * as `options.fetchImpl(...)`, the real `fetch` gets the options object as `this` and throws
 * "Illegal invocation" before any request is made -- which this client's `catch` reported as
 * `network`, so every year lookup in a real browser failed and no card ever got a year. A
 * `function`, not an arrow, because an arrow has no `this` to check.
 */
function brandCheckedFetch(): YearFetch {
  return function (this: unknown) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      headers: headers(),
      json: () => Promise.resolve(SUCCESS),
    });
  };
}

function queryOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

describe('lookupYear', () => {
  it('should build the query from title, artist and durationMs', () => {
    const { fetchImpl, urls } = stubFetch();

    return lookupYear(TRACK, { fetchImpl }).then(() => {
      const url = urls[0] ?? '';

      expect(url.startsWith('/api/year?')).toBe(true);
      expect(queryOf(url).get('title')).toBe(TRACK.title);
      expect(queryOf(url).get('artist')).toBe('Queen');
      expect(queryOf(url).get('durationMs')).toBe('354320');
    });
  });

  it('should not call fetch with the options object as its receiver', async () => {
    // The regression test for the browser-only "Illegal invocation" failure. Going back to
    // `options.fetchImpl(...)` here would silently disable every year lookup in the app while
    // leaving all sixteen tests below green.
    expect(await lookupYear(TRACK, { fetchImpl: brandCheckedFetch() })).toEqual({
      ok: true,
      result: SUCCESS,
    });
  });

  it('should URL-encode titles and artists containing punctuation', async () => {
    // The very common case: an apostrophe, an ampersand, a plus. Getting this wrong truncates
    // the query at the `&` and asks MusicBrainz about the wrong track.
    const { fetchImpl, urls } = stubFetch();

    await lookupYear(
      {
        title: "Sittin' On The Dock Of The Bay (Mono) & More",
        artist: 'Simon & Garfunkel',
        durationMs: 0,
      },
      { fetchImpl },
    );

    const url = urls[0] ?? '';

    expect(url).toContain('Simon+%26+Garfunkel');
    expect(queryOf(url).get('artist')).toBe('Simon & Garfunkel');
    expect(queryOf(url).get('title')).toBe("Sittin' On The Dock Of The Bay (Mono) & More");
  });

  it('should send the raw joined artist string unmodified', async () => {
    // Cleaning and the primary-artist fallback stay SERVER-side. Splitting here would let the
    // client's idea of a query drift from the server's cache key.
    const { fetchImpl, urls } = stubFetch();
    const artist = 'Bob Marley & The Wailers, Peter Tosh';

    await lookupYear({ ...TRACK, artist }, { fetchImpl });

    expect(queryOf(urls[0] ?? '').get('artist')).toBe(artist);
  });

  it('should omit durationMs when it is unknown', async () => {
    // Absent, zero and negative all mean "unknown" to the server, which then drops the `dur:`
    // bound rather than failing the request.
    const { fetchImpl, urls } = stubFetch();

    await lookupYear({ ...TRACK, durationMs: 0 }, { fetchImpl });

    expect(queryOf(urls[0] ?? '').has('durationMs')).toBe(false);
  });

  it('should return the parsed result on 200', async () => {
    const { fetchImpl } = stubFetch();

    const outcome = await lookupYear(TRACK, { fetchImpl });

    expect(outcome).toEqual({ ok: true, result: SUCCESS });
  });

  it('should accept a resolved null year with none confidence', async () => {
    // A `confidence: 'none'` card stays in the deck and is playable (decision 5), so this is a
    // SUCCESS, not an error.
    const body: YearLookupResult = {
      year: null,
      confidence: 'none',
      reason: 'no-dated-candidates',
      cached: true,
      cleanedTitle: 'Some Obscure Track',
      stripped: { remaster: false, live: false, feature: false, version: false },
    };
    const { fetchImpl } = stubFetch({ body });

    expect(await lookupYear(TRACK, { fetchImpl })).toEqual({ ok: true, result: body });
  });

  it('should surface retryAfterMs from a 429 body', async () => {
    // The back-pressure contract the whole resolver rests on: a 429 is designed behaviour, and
    // the body's `retryAfterMs` is its primary carrier.
    const { fetchImpl } = stubFetch({
      status: 429,
      body: {
        code: 'rate-limited',
        message: 'Too many year lookups at once.',
        retryAfterMs: 1_100,
      },
    });

    expect(await lookupYear(TRACK, { fetchImpl })).toEqual({
      ok: false,
      code: 'rate-limited',
      retryAfterMs: 1_100,
    });
  });

  it('should fall back to the Retry-After header when the body is unparseable', async () => {
    // The safety net: a 429 produced by an edge or proxy in front of the function has the
    // standard header and no body of ours at all. Header values are SECONDS.
    const { fetchImpl } = stubFetch({
      status: 429,
      unparseableBody: true,
      headerValues: { 'Retry-After': '2' },
    });

    expect(await lookupYear(TRACK, { fetchImpl })).toEqual({
      ok: false,
      code: 'rate-limited',
      retryAfterMs: 2_000,
    });
  });

  it('should report a 429 with no retry hint at all and let the resolver choose', async () => {
    // Inventing a default here would put the same number in two places.
    const { fetchImpl } = stubFetch({ status: 429, body: { code: 'rate-limited', message: '' } });

    expect(await lookupYear(TRACK, { fetchImpl })).toEqual({ ok: false, code: 'rate-limited' });
  });

  it('should map each error status onto its typed code', async () => {
    const cases: [number, string, string][] = [
      [400, 'invalid-request', 'invalid-request'],
      [429, 'rate-limited', 'rate-limited'],
      [500, 'not-configured', 'not-configured'],
      [502, 'upstream-unavailable', 'upstream-unavailable'],
      [502, 'unexpected-payload', 'unexpected-payload'],
    ];

    for (const [status, bodyCode, expected] of cases) {
      const { fetchImpl } = stubFetch({ status, body: { code: bodyCode, message: '' } });
      const outcome = await lookupYear(TRACK, { fetchImpl });

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? undefined : outcome.code).toBe(expected);
    }
  });

  it('should treat a 500 that does not say not-configured as transient', async () => {
    // `/api/year` returns 500 for the deployment fault AND from its catch-all, and the two want
    // opposite handling: `not-configured` stops the whole crawl. So it is recognized only from
    // the body -- guessing it from the status would let one unexpected 500 blank a whole deck.
    const { fetchImpl } = stubFetch({ status: 500, body: { code: 'internal-error', message: '' } });

    expect(await lookupYear(TRACK, { fetchImpl })).toEqual({
      ok: false,
      code: 'upstream-unavailable',
    });
  });

  it('should report an unrecognizable 200 body as unexpected-payload', async () => {
    // A rewritten route or an HTML error page served with a 200. Same meaning the code has
    // server-side: the endpoint is not answering what we parse.
    const { fetchImpl } = stubFetch({ body: { hello: 'world' } });

    expect(await lookupYear(TRACK, { fetchImpl })).toEqual({
      ok: false,
      code: 'unexpected-payload',
    });
  });

  it('should reject an impossible year and confidence combination', async () => {
    // `{year: 1975, confidence: 'none'}` would put a year on the card while telling Phase 6 not
    // to show one. The shared union rules it out server-side; this is the client-side guard.
    const { fetchImpl } = stubFetch({
      body: { ...SUCCESS, confidence: 'none' },
    });

    expect(await lookupYear(TRACK, { fetchImpl })).toEqual({
      ok: false,
      code: 'unexpected-payload',
    });
  });

  it('should return a network outcome instead of throwing when fetch rejects', async () => {
    // Offline, DNS failure, or a dropped connection. The caller is a loop over a hundred cards:
    // a rejected promise mid-crawl is a far worse shape to program against than a union.
    const fetchImpl: YearFetch = () => Promise.reject(new Error('Failed to fetch'));

    expect(await lookupYear(TRACK, { fetchImpl })).toEqual({ ok: false, code: 'network' });
  });

  it('should pass the abort signal through to fetch', async () => {
    // Ending a session must cancel the lookup in flight rather than let it resolve into a dead
    // reducer -- `resolver.stop()` is what fires this.
    const controller = new AbortController();
    let seen: AbortSignal | undefined;

    const fetchImpl: YearFetch = (_url, init) => {
      seen = init?.signal;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: headers(),
        json: () => Promise.resolve(SUCCESS),
      });
    };

    await lookupYear(TRACK, { fetchImpl, signal: controller.signal });

    expect(seen).toBe(controller.signal);
  });

  it('should abort an in-flight request when the signal fires', async () => {
    // The real `fetch` rejects with an AbortError, which surfaces as `network`: the request did
    // not happen, and the resolver ignores everything after a stop anyway.
    const controller = new AbortController();

    const fetchImpl: YearFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });

    const pending = lookupYear(TRACK, { fetchImpl, signal: controller.signal });
    controller.abort();

    expect(await pending).toEqual({ ok: false, code: 'network' });
  });
});
