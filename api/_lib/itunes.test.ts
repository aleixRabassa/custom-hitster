import { describe, expect, it, vi } from 'vitest';

import {
  YEAR_FIXTURES,
  YEAR_LIMITATION_FIXTURES,
} from '../../shared/__fixtures__/year-candidates.js';
import { primaryArtistGuess } from '../../shared/artists.js';
import { failedStoreRules } from '../../shared/store-match.js';
import { cleanTrackTitle } from '../../shared/year.js';
import { ITUNES_CAPTURES } from './__fixtures__/itunes-payloads.js';
import { ITUNES_STOREFRONT, createItunesLookup, itunesRows, itunesSearchUrl } from './itunes.js';
import type { ProviderLookupInput } from './provider-lookup.js';
import type { RateLimitGate } from './rate-limit.js';
import type { StoreFetch } from './store-http.js';

// Every test runs over the payloads captured live on 2026-09-30 (see the fixture's header),
// or over a one-response variation of them.

const FIXTURES = [...YEAR_FIXTURES, ...YEAR_LIMITATION_FIXTURES];

function inputFor(key: string): ProviderLookupInput {
  const fixture = FIXTURES.find((f) => f.key === key);
  if (!fixture) throw new Error(`no fixture ${key}`);
  return {
    rawTitle: fixture.title,
    cleaned: cleanTrackTitle(fixture.title),
    rawArtist: fixture.artist,
    primaryArtist: primaryArtistGuess(fixture.artist),
    durationMs: fixture.durationMs,
  };
}

function captureFor(key: string) {
  const capture = ITUNES_CAPTURES.find((c) => c.key === key);
  if (!capture) throw new Error(`no capture ${key}`);
  return capture;
}

type FetchResponse = Awaited<ReturnType<StoreFetch>>;

function serving(response: () => Promise<FetchResponse>) {
  return vi.fn(async (url: string, init: Parameters<StoreFetch>[1]) => {
    void url;
    void init;
    return response();
  });
}

function capturedBody(key: string) {
  return serving(async () => ({
    ok: true,
    status: 200,
    json: async () => captureFor(key).search.body,
  }));
}

function openGate(): RateLimitGate & { acquire: ReturnType<typeof vi.fn> } {
  return { kind: 'instance', acquire: vi.fn(async () => ({ ok: true as const })) };
}

describe('itunesSearchUrl', () => {
  it('should name entity=song and the ES storefront', () => {
    expect(ITUNES_STOREFRONT).toBe('ES');
    expect(itunesSearchUrl('Michael Jackson', 'Billie Jean')).toBe(
      'https://itunes.apple.com/search?term=Michael%20Jackson%20Billie%20Jean&entity=song&limit=10&country=ES',
    );
  });

  it('should be the URL every capture was taken with', () => {
    for (const capture of ITUNES_CAPTURES) {
      const input = inputFor(capture.key);
      expect(itunesSearchUrl(input.primaryArtist, input.cleaned.title), capture.key).toBe(
        capture.search.url,
      );
    }
  });
});

describe('createItunesLookup over the captures', () => {
  it('should make ONE request and answer the earliest verified row', async () => {
    // Billie Jean: nine of ten rows verify; they span 1982 to later compilations, and the
    // answer is the earliest.
    const fetchImpl = capturedBody('billieJean');
    const gate = openGate();
    const outcome = await createItunesLookup({ fetchImpl, gate }).lookup(inputFor('billieJean'));

    expect(outcome).toEqual({
      kind: 'answer',
      answer: { provider: 'itunes', year: 1982 },
      cached: false,
      requestCount: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(captureFor('billieJean').search.url);
    expect(gate.acquire).toHaveBeenCalledTimes(1);
  });

  it('should reject the unverified rows and keep the verified ones (Personal Jesus)', async () => {
    const input = inputFor('personalJesus');
    const rows = itunesRows(captureFor('personalJesus').search.body)!;
    const target = {
      rawTitle: input.rawTitle,
      primaryArtist: input.primaryArtist,
      durationMs: input.durationMs,
    };
    const verified = rows.filter((row) => failedStoreRules(row, target).length === 0);

    expect(verified.length).toBeGreaterThan(0);
    expect(verified.length).toBeLessThan(rows.length);

    // The 1989 single is what iTunes gets right and MusicBrainz cannot reach (see
    // YEAR_LIMITATION_FIXTURES).
    await expect(
      createItunesLookup({ fetchImpl: capturedBody('personalJesus'), gate: openGate() }).lookup(
        input,
      ),
    ).resolves.toMatchObject({ answer: { provider: 'itunes', year: 1989 } });
  });

  it('should answer null when no row verifies (Creep: only the acoustic take and covers)', async () => {
    await expect(
      createItunesLookup({ fetchImpl: capturedBody('creep'), gate: openGate() }).lookup(
        inputFor('creep'),
      ),
    ).resolves.toEqual({
      kind: 'answer',
      answer: { provider: 'itunes', year: null },
      cached: false,
      requestCount: 1,
    });
  });

  it('should answer that same null with NO request and NO permit when the card has no length', async () => {
    // `shared/store-match.ts` verifies a row only when both lengths are known, so a length-less
    // target can verify nothing: the request would only buy the null above, off the 3 s gate
    // every player shares. Billie Jean is used because WITH its length it answers 1982 -- so the
    // null here is the missing length's doing, not the capture's.
    const searched = await createItunesLookup({
      fetchImpl: capturedBody('creep'),
      gate: openGate(),
    }).lookup(inputFor('creep'));

    const fetchImpl = capturedBody('billieJean');
    const gate = openGate();
    const { durationMs, ...withoutLength } = inputFor('billieJean');
    void durationMs;
    const outcome = await createItunesLookup({ fetchImpl, gate }).lookup(withoutLength);

    expect(outcome).toEqual({ ...searched, requestCount: 0 });
    expect(outcome).toEqual({
      kind: 'answer',
      answer: { provider: 'itunes', year: null },
      cached: false,
      requestCount: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gate.acquire).not.toHaveBeenCalled();
  });
});

describe('createItunesLookup failure mapping', () => {
  it('should map 403 and 429 to a refused skip, never to busy', async () => {
    // Apple ITSELF refusing us (the developer's decision, 2026-10-01): iTunes is left out of the
    // call and the vote decides without it, instead of being retried from the egress IP every
    // player shares. `busy` is kept for OUR gate refusing a permit -- the next test.
    for (const status of [403, 429]) {
      const fetchImpl = serving(async () => ({ ok: false, status, json: async () => ({}) }));
      await expect(
        createItunesLookup({ fetchImpl, gate: openGate() }).lookup(inputFor('billieJean')),
      ).resolves.toEqual({ kind: 'skipped', reason: 'refused', detail: `HTTP ${status}` });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('should map a refused permit to busy with the gate retryAfterMs, making no request', async () => {
    const fetchImpl = capturedBody('billieJean');
    const gate: RateLimitGate = {
      kind: 'redis',
      acquire: async () => ({ ok: false, retryAfterMs: 3_000 }),
    };

    await expect(
      createItunesLookup({ fetchImpl, gate }).lookup(inputFor('billieJean')),
    ).resolves.toEqual({ kind: 'busy', retryAfterMs: 3_000 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should map a network error and a 5xx to failed, never throwing', async () => {
    const network = serving(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      createItunesLookup({ fetchImpl: network, gate: openGate() }).lookup(inputFor('billieJean')),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });

    const outage = serving(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(
      createItunesLookup({ fetchImpl: outage, gate: openGate() }).lookup(inputFor('billieJean')),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });
  });

  it('should map a body without results, or unreadable JSON, to unexpected-payload', async () => {
    for (const json of [
      async () => ({ errorMessage: 'Invalid value(s) for key(s): [country]' }),
      async () => {
        throw new SyntaxError('Unexpected token');
      },
    ]) {
      const fetchImpl = serving(async () => ({ ok: true, status: 200, json }));
      await expect(
        createItunesLookup({ fetchImpl, gate: openGate() }).lookup(inputFor('billieJean')),
      ).resolves.toEqual({ kind: 'failed', code: 'unexpected-payload' });
    }
  });

  it('should make no request at all for an already-aborted signal', async () => {
    const fetchImpl = capturedBody('billieJean');
    const gate = openGate();
    const controller = new AbortController();
    controller.abort();

    await expect(
      createItunesLookup({ fetchImpl, gate }).lookup({
        ...inputFor('billieJean'),
        signal: controller.signal,
      }),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gate.acquire).not.toHaveBeenCalled();
  });

  it('should not ask once the signal aborts while waiting for a permit', async () => {
    const fetchImpl = capturedBody('billieJean');
    const controller = new AbortController();
    const gate: RateLimitGate = {
      kind: 'redis',
      acquire: async () => {
        controller.abort();
        return { ok: true };
      },
    };

    await expect(
      createItunesLookup({ fetchImpl, gate }).lookup({
        ...inputFor('billieJean'),
        signal: controller.signal,
      }),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('itunesRows', () => {
  it('should parse tolerantly and normalise the ISO releaseDate to a calendar date', () => {
    expect(
      itunesRows({
        results: [
          {
            wrapperType: 'track',
            kind: 'song',
            trackName: 'A',
            artistName: 'X',
            trackTimeMillis: 200_000,
            releaseDate: '1982-11-29T12:00:00Z',
          },
          { trackName: '' },
          { artistName: 'no title' },
          { wrapperType: 'track', kind: 'music-video', trackName: 'B', releaseDate: 'soon' },
          null,
        ],
      }),
    ).toEqual([
      { titles: ['A'], credit: 'X', durationMs: 200_000, excluded: false, date: '1982-11-29' },
      { titles: ['B'], credit: '', durationMs: undefined, excluded: true, date: '' },
    ]);
    expect(itunesRows({ resultCount: 0 })).toBeUndefined();
  });

  it('should never have flagged a captured row as excluded, nor seen one without a length', () => {
    // Both recorded as facts: the first says the excluded rule has no captured bite (see
    // year-votes.test.ts); the second, that failing length-less rows moved no measured answer.
    for (const capture of ITUNES_CAPTURES) {
      const rows = itunesRows(capture.search.body)!;
      expect(
        rows.some((row) => row.excluded),
        capture.key,
      ).toBe(false);
      expect(
        rows.some((row) => row.durationMs === undefined),
        capture.key,
      ).toBe(false);
    }
  });
});
