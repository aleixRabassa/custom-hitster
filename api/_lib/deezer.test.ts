import { describe, expect, it, vi } from 'vitest';

import {
  YEAR_FIXTURES,
  YEAR_LIMITATION_FIXTURES,
} from '../../shared/__fixtures__/year-candidates.js';
import { primaryArtistGuess } from '../../shared/artists.js';
import { isVerifiedStoreRow } from '../../shared/store-match.js';
import { cleanTrackTitle } from '../../shared/year.js';
import { DEEZER_CAPTURES, DEEZER_QUOTA_EXCEEDED } from './__fixtures__/deezer-payloads.js';
import {
  DEEZER_TRACK_FETCH_LIMIT,
  createDeezerLookup,
  deezerSearchRows,
  deezerSearchUrl,
  deezerTrackUrl,
} from './deezer.js';
import type { ProviderLookupInput } from './provider-lookup.js';
import type { RateLimitGate } from './rate-limit.js';
import type { StoreFetch } from './store-http.js';

// Every test here runs over the payloads captured live on 2026-09-30 (see the fixture's
// header) or over a one-field variation of them. No test simulates Deezer from scratch.

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
  const capture = DEEZER_CAPTURES.find((c) => c.key === key);
  if (!capture) throw new Error(`no capture ${key}`);
  return capture;
}

/** Serves the captured bodies by URL; `overrides` replaces a response for one URL. */
function servedFrom(
  key: string,
  overrides: Record<string, () => ReturnType<StoreFetch>> = {},
): { fetchImpl: StoreFetch & ReturnType<typeof vi.fn>; urls: string[] } {
  const capture = captureFor(key);
  const bodies = new Map<string, unknown>([
    [capture.search.url, capture.search.body],
    ...capture.tracks.map((t) => [t.url, t.body] as [string, unknown]),
  ]);
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    const override = overrides[url];
    if (override) return override();
    if (!bodies.has(url)) throw new Error(`unexpected request ${url}`);
    return { ok: true, status: 200, json: async () => bodies.get(url) };
  });
  return { fetchImpl: fetchImpl as unknown as StoreFetch & typeof fetchImpl, urls };
}

function openGate(): RateLimitGate & { acquire: ReturnType<typeof vi.fn> } {
  return { kind: 'instance', acquire: vi.fn(async () => ({ ok: true as const })) };
}

describe('deezerSearchUrl / deezerTrackUrl', () => {
  it('should build the free-text search the spike measured, never the advanced syntax', () => {
    expect(deezerSearchUrl('Michael Jackson', 'Billie Jean')).toBe(
      'https://api.deezer.com/search?q=Michael%20Jackson%20Billie%20Jean&limit=10',
    );
    expect(deezerSearchUrl('a', 'b')).not.toMatch(/artist%3A|track%3A/);
    expect(deezerTrackUrl(4603408)).toBe('https://api.deezer.com/track/4603408');
  });

  it('should be the URL every capture was taken with', () => {
    for (const capture of DEEZER_CAPTURES) {
      const input = inputFor(capture.key);
      expect(deezerSearchUrl(input.primaryArtist, input.cleaned.title), capture.key).toBe(
        capture.search.url,
      );
    }
  });
});

describe('createDeezerLookup over the captures', () => {
  it('should search, then fetch only the VERIFIED rows, and answer the earliest year', async () => {
    // Billie Jean: ten rows, one verified (the others are remixes, the long version, other
    // artists). One search plus one track fetch, and the answer is that row's edition.
    const { fetchImpl, urls } = servedFrom('billieJean');
    const gate = openGate();
    const outcome = await createDeezerLookup({ fetchImpl, gate }).lookup(inputFor('billieJean'));

    expect(outcome).toEqual({
      kind: 'answer',
      answer: { provider: 'deezer', year: 2009, isrcYear: 1999 },
      cached: false,
      requestCount: 2,
    });
    expect(urls).toEqual([captureFor('billieJean').search.url, deezerTrackUrl(4603408)]);
    // One permit per request, from Deezer's own gate.
    expect(gate.acquire).toHaveBeenCalledTimes(2);
  });

  it('should take the ISRC year as the earliest over the fetched rows, independently', async () => {
    // Bohemian Rhapsody: the album row gives 1975 by date and 2010 by ISRC; the second
    // verified row (a live release) gives 1992 by date and 2003 by ISRC. The date answer is
    // the album's 1975, the ISRC answer the live row's 2003 -- the spike's rule.
    const { fetchImpl } = servedFrom('bohemianRhapsody');
    const outcome = await createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(
      inputFor('bohemianRhapsody'),
    );

    expect(outcome).toMatchObject({
      kind: 'answer',
      answer: { provider: 'deezer', year: 1975, isrcYear: 2003 },
      requestCount: 3,
    });
  });

  it('should respect DEEZER_TRACK_FETCH_LIMIT when more rows verify', async () => {
    // Smells Like Teen Spirit verifies FOUR rows (positions 0, 7, 8, 9): only the first
    // three, in Deezer's order, are fetched.
    const capture = captureFor('smellsLikeTeenSpirit');
    const input = inputFor('smellsLikeTeenSpirit');
    const verified = deezerSearchRows(capture.search.body as Record<string, unknown>)!.filter(
      (row) =>
        isVerifiedStoreRow(row, {
          rawTitle: input.rawTitle,
          primaryArtist: input.primaryArtist,
          durationMs: input.durationMs,
        }),
    );
    expect(verified.length).toBeGreaterThan(DEEZER_TRACK_FETCH_LIMIT);

    const { fetchImpl, urls } = servedFrom('smellsLikeTeenSpirit');
    const outcome = await createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(input);

    expect(urls.slice(1)).toEqual(
      verified.slice(0, DEEZER_TRACK_FETCH_LIMIT).map((row) => deezerTrackUrl(row.id)),
    );
    expect(outcome).toMatchObject({ requestCount: 1 + DEEZER_TRACK_FETCH_LIMIT });
  });

  it('should answer null, after one request, when no row verifies', async () => {
    // Under Pressure: "Queen & David Bowie" against rows credited to "Queen" alone.
    const { fetchImpl, urls } = servedFrom('underPressure');
    const outcome = await createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(
      inputFor('underPressure'),
    );

    expect(outcome).toEqual({
      kind: 'answer',
      answer: { provider: 'deezer', year: null, isrcYear: null },
      cached: false,
      requestCount: 1,
    });
    expect(urls).toHaveLength(1);
  });

  it('should answer that same null with NO request and NO permit when the card has no length', async () => {
    // `shared/store-match.ts` verifies a row only when both lengths are known, so a length-less
    // target can verify nothing: the search would only buy the null above. Billie Jean is used
    // because WITH its length it verifies a row and answers 2009 -- so the null here is the
    // missing length's doing, not the capture's.
    const searched = await createDeezerLookup({
      fetchImpl: servedFrom('underPressure').fetchImpl,
      gate: openGate(),
    }).lookup(inputFor('underPressure'));

    const { fetchImpl } = servedFrom('billieJean');
    const gate = openGate();
    const { durationMs, ...withoutLength } = inputFor('billieJean');
    void durationMs;
    const outcome = await createDeezerLookup({ fetchImpl, gate }).lookup(withoutLength);

    expect(outcome).toEqual({ ...searched, requestCount: 0 });
    expect(outcome).toEqual({
      kind: 'answer',
      answer: { provider: 'deezer', year: null, isrcYear: null },
      cached: false,
      requestCount: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gate.acquire).not.toHaveBeenCalled();
  });

  it('should drop a row whose track fetch says the track no longer exists (code 800)', async () => {
    // Bohemian Rhapsody with its second verified row gone: the answer is the album row's alone.
    const { fetchImpl } = servedFrom('bohemianRhapsody', {
      [deezerTrackUrl(captureRowId('bohemianRhapsody', 1))]: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ error: { type: 'DataException', message: 'no data', code: 800 } }),
      }),
    });
    const outcome = await createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(
      inputFor('bohemianRhapsody'),
    );

    expect(outcome).toMatchObject({
      kind: 'answer',
      answer: { provider: 'deezer', year: 1975, isrcYear: 2010 },
    });
  });
});

function captureRowId(key: string, index: number): number {
  const rows = deezerSearchRows(captureFor(key).search.body as Record<string, unknown>)!;
  return rows[index]!.id;
}

describe('createDeezerLookup failure mapping', () => {
  const quotaResponse = async () => ({
    ok: true,
    status: DEEZER_QUOTA_EXCEEDED.status,
    json: async () => DEEZER_QUOTA_EXCEEDED.body,
  });

  // Deezer ITSELF refusing us is a `refused` skip, never `busy` (the developer's decision,
  // 2026-10-01): retrying it from the egress IP every player shares is how a throttle becomes a
  // block. `busy` is kept for OUR gate refusing a permit -- the test after these three.
  const quotaSkip = { kind: 'skipped', reason: 'refused', detail: 'quota error code 4' };

  it('should map the REAL quota body, served with HTTP 200, on the search to a refused skip', async () => {
    expect(DEEZER_QUOTA_EXCEEDED.status).toBe(200);
    const { fetchImpl, urls } = servedFrom('billieJean', {
      [captureFor('billieJean').search.url]: quotaResponse,
    });

    await expect(
      createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(inputFor('billieJean')),
    ).resolves.toEqual(quotaSkip);
    // Stopped asking: no track fetch follows a refused search.
    expect(urls).toHaveLength(1);
  });

  it('should map the quota body on a TRACK fetch to a refused skip, not to a partial answer', async () => {
    const { fetchImpl, urls } = servedFrom('bohemianRhapsody', {
      [deezerTrackUrl(captureRowId('bohemianRhapsody', 1))]: quotaResponse,
    });

    // The first verified row WAS dated (1975); answering from it alone would be the partial
    // answer the header refuses, so the refusal wins.
    await expect(
      createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(inputFor('bohemianRhapsody')),
    ).resolves.toEqual(quotaSkip);
    expect(urls).toHaveLength(3);
  });

  it('should map an HTTP 429 and the documented SERVICE_BUSY code to refused skips', async () => {
    // Neither has been observed. The detail is fixed text per status or code, so nothing the
    // body says can reach the warning it is logged in.
    const url = captureFor('billieJean').search.url;
    const cases = [
      {
        response: async () => ({ ok: false, status: 429, json: async () => ({}) }),
        detail: 'HTTP 429',
      },
      {
        response: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ error: { type: 'Exception', message: 'secret text', code: 700 } }),
        }),
        detail: 'service-busy error code 700',
      },
    ];
    for (const { response, detail } of cases) {
      const { fetchImpl } = servedFrom('billieJean', { [url]: response });
      await expect(
        createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(inputFor('billieJean')),
      ).resolves.toEqual({ kind: 'skipped', reason: 'refused', detail });
    }
  });

  it('should map a refused permit to busy with the gate retryAfterMs, making no request', async () => {
    const { fetchImpl } = servedFrom('billieJean');
    const gate: RateLimitGate = {
      kind: 'redis',
      acquire: async () => ({ ok: false, retryAfterMs: 120 }),
    };

    await expect(
      createDeezerLookup({ fetchImpl, gate }).lookup(inputFor('billieJean')),
    ).resolves.toEqual({ kind: 'busy', retryAfterMs: 120 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should map a network error and a 5xx to failed, never throwing', async () => {
    const url = captureFor('billieJean').search.url;
    const network = servedFrom('billieJean', {
      [url]: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(
      createDeezerLookup({ fetchImpl: network.fetchImpl, gate: openGate() }).lookup(
        inputFor('billieJean'),
      ),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });

    const outage = servedFrom('billieJean', {
      [url]: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    await expect(
      createDeezerLookup({ fetchImpl: outage.fetchImpl, gate: openGate() }).lookup(
        inputFor('billieJean'),
      ),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });
  });

  it('should map a 5xx on a track fetch to failed rather than answering from fewer rows', async () => {
    const { fetchImpl } = servedFrom('bohemianRhapsody', {
      [deezerTrackUrl(captureRowId('bohemianRhapsody', 1))]: async () => ({
        ok: false,
        status: 502,
        json: async () => ({}),
      }),
    });

    await expect(
      createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(inputFor('bohemianRhapsody')),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });
  });

  it('should map an unreadable body, a body without data, and an unknown error to unexpected-payload', async () => {
    const url = captureFor('billieJean').search.url;
    for (const response of [
      async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
      async () => ({ ok: true, status: 200, json: async () => ({ total: 0 }) }),
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ error: { type: 'ParameterException', code: 500 } }),
      }),
      async () => ({ ok: false, status: 400, json: async () => ({}) }),
    ]) {
      const { fetchImpl } = servedFrom('billieJean', { [url]: response });
      await expect(
        createDeezerLookup({ fetchImpl, gate: openGate() }).lookup(inputFor('billieJean')),
      ).resolves.toEqual({ kind: 'failed', code: 'unexpected-payload' });
    }
  });

  it('should make no request at all for an already-aborted signal', async () => {
    const { fetchImpl } = servedFrom('billieJean');
    const gate = openGate();
    const controller = new AbortController();
    controller.abort();

    await expect(
      createDeezerLookup({ fetchImpl, gate }).lookup({
        ...inputFor('billieJean'),
        signal: controller.signal,
      }),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gate.acquire).not.toHaveBeenCalled();
  });

  it('should stop before the track fetches when the signal aborts after the search', async () => {
    const controller = new AbortController();
    const capture = captureFor('billieJean');
    const { fetchImpl, urls } = servedFrom('billieJean', {
      [capture.search.url]: async () => {
        controller.abort();
        return { ok: true, status: 200, json: async () => capture.search.body };
      },
    });

    await expect(
      createDeezerLookup({ fetchImpl, gate: openGate() }).lookup({
        ...inputFor('billieJean'),
        signal: controller.signal,
      }),
    ).resolves.toEqual({ kind: 'failed', code: 'upstream-unavailable' });
    expect(urls).toEqual([capture.search.url]);
  });

  it('should pass the signal through to fetch', async () => {
    const { fetchImpl } = servedFrom('billieJean');
    const controller = new AbortController();
    await createDeezerLookup({ fetchImpl, gate: openGate() }).lookup({
      ...inputFor('billieJean'),
      signal: controller.signal,
    });

    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });
});

describe('deezerSearchRows', () => {
  it('should parse tolerantly: skip rows without an id or a title, keep a missing duration', () => {
    const rows = deezerSearchRows({
      data: [
        {
          id: 1,
          title: 'A',
          title_short: 'A',
          duration: 200,
          artist: { name: 'X' },
          type: 'track',
        },
        { title: 'no id' },
        { id: 2 },
        { id: 3, title: 'B', artist: 'not an object' },
        { id: 4, title: 'C', type: 'album' },
        'not a row',
      ],
    });

    expect(rows).toEqual([
      {
        id: 1,
        titles: ['A', 'A'],
        credit: 'X',
        durationMs: 200_000,
        excluded: false,
        isrc: undefined,
      },
      { id: 3, titles: ['B'], credit: '', durationMs: undefined, excluded: false, isrc: undefined },
      { id: 4, titles: ['C'], credit: '', durationMs: undefined, excluded: true, isrc: undefined },
    ]);
    expect(deezerSearchRows({ total: 0 })).toBeUndefined();
  });

  it('should never have flagged a captured row as excluded', () => {
    // Recorded as a fact, so a re-capture that DOES carry one says so here -- and it should
    // then join the mutation guard in year-votes.test.ts.
    for (const capture of DEEZER_CAPTURES) {
      const rows = deezerSearchRows(capture.search.body as Record<string, unknown>)!;
      expect(
        rows.some((row) => row.excluded),
        capture.key,
      ).toBe(false);
    }
  });
});
