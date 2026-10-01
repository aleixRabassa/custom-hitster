/**
 * Tests for the `/api/year` handler (`api/year.ts`).
 *
 * They live HERE, under `api/_lib/`, and not beside the handler as `api/year.test.ts`, on
 * purpose: `vercel.json` routes every `api/*.ts` as a function, so a test file there would be
 * deployed as `/api/year.test`, importing Vitest at runtime. `_`-prefixed paths are not routed
 * (docs/api.md, measured 2026-08-04).
 *
 * The handler builds its cache, gates and registry at module scope (once per cold start), so
 * each test imports a FRESH copy of the module after `vi.resetModules()`, with the
 * environment and the global `fetch` stubbed first. The two store adapters and the
 * MusicBrainz provider are replaced by controllable doubles for the staged path -- what is
 * under test is the routing, the status mapping and the headers, not the providers, which
 * have suites of their own. The legacy path runs the REAL `resolveYear()` over fixture
 * payloads, because "byte for byte unchanged" is only worth asserting end to end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  NO_WOMAN_NO_CRY,
  noWomanNoCryReleaseGroups,
  noWomanNoCrySearch,
} from './__fixtures__/musicbrainz-payloads.js';
import type { ProviderLookup, ProviderOutcome } from './provider-lookup.js';
import type { ProviderAnswer, YearProviderId } from '../../shared/types.js';
import { cleanTrackTitle } from '../../shared/year.js';

/** What each provider double answers next. Set per test; read at CALL time. */
const control = vi.hoisted(() => ({
  outcomes: {} as Partial<Record<string, () => Promise<unknown>>>,
  calls: {} as Record<string, number>,
}));

function doubleFor(id: YearProviderId): ProviderLookup {
  return {
    id,
    lookup() {
      control.calls[id] = (control.calls[id] ?? 0) + 1;
      const next = control.outcomes[id];
      if (next === undefined) return Promise.reject(new Error(`${id} was not scripted`));
      return next() as Promise<ProviderOutcome>;
    },
  };
}

vi.mock('./deezer.js', () => ({ createDeezerLookup: () => doubleFor('deezer') }));
vi.mock('./itunes.js', () => ({ createItunesLookup: () => doubleFor('itunes') }));
vi.mock('./musicbrainz-provider.js', async (importOriginal) => ({
  // Everything else is real -- the driver imports `musicBrainzAnswerFrom` from here.
  ...(await importOriginal<typeof import('./musicbrainz-provider.js')>()),
  createMusicBrainzLookup: () => doubleFor('musicbrainz'),
}));

const USER_AGENT = 'custom-jitster/0.1.0 ( test@example.com )';
const CLEANED = cleanTrackTitle(NO_WOMAN_NO_CRY.title);

function script(id: YearProviderId, outcome: ProviderOutcome): void {
  control.outcomes[id] = () => Promise.resolve(outcome);
}
const answer = (value: ProviderAnswer): ProviderOutcome => ({
  kind: 'answer',
  answer: value,
  cached: false,
  requestCount: 1,
});

interface Captured {
  status: number | undefined;
  body: unknown;
  headers: Record<string, string>;
}

/** A minimal request and response pair: exactly what the handler touches. */
function call(query: Record<string, string | string[]>, method = 'GET') {
  const captured: Captured = { status: undefined, body: undefined, headers: {} };
  const res = {
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return res;
    },
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
  };
  return {
    req: { method, query } as unknown as VercelRequest,
    res: res as unknown as VercelResponse,
    captured,
  };
}

async function request(
  query: Record<string, string | string[]>,
  method?: string,
): Promise<Captured> {
  const { default: handler } = await import('../year.js');
  const { req, res, captured } = call(query, method);
  await handler(req, res);
  return captured;
}

const TRACK_QUERY = {
  title: NO_WOMAN_NO_CRY.title,
  artist: NO_WOMAN_NO_CRY.artist,
  durationMs: String(NO_WOMAN_NO_CRY.durationMs),
};

let musicBrainzFetches = 0;

beforeEach(() => {
  vi.resetModules();
  control.outcomes = {};
  control.calls = {};
  musicBrainzFetches = 0;
  // No Upstash, so the cold start picks the memory cache and per-instance gates.
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubEnv('MUSICBRAINZ_USER_AGENT', USER_AGENT);
  // The legacy path's real MusicBrainz adapter reads the global `fetch` per request.
  vi.stubGlobal('fetch', (url: string) => {
    musicBrainzFetches += 1;
    const body = url.includes('/release-group?') ? noWomanNoCryReleaseGroups : noWomanNoCrySearch;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
  // Cold-start adapter lines ("using in-memory cache", "per-instance pacing").
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/year without a stage (the legacy path)', () => {
  it("should return today's MusicBrainz-only body and headers, unchanged", async () => {
    const response = await request(TRACK_QUERY);

    expect(response.status).toBe(200);
    // `toEqual` on the whole body: no `final`, no `agreedBy`, no `skipped` -- the old client
    // has never read them, and nothing new may appear on this path.
    expect(response.body).toEqual({
      year: NO_WOMAN_NO_CRY.expectedYear,
      confidence: 'high',
      source: 'release-group',
      cached: false,
      cleanedTitle: CLEANED.title,
      stripped: CLEANED.stripped,
    });
    expect(response.headers).toEqual({
      'Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=86400',
    });
    expect(musicBrainzFetches).toBe(2);
    // The provider registry is never consulted on this path.
    expect(control.calls).toEqual({});
  });

  it('should keep the loud not-configured 500 for a missing User-Agent', async () => {
    // One provider, so "skipped with a warning" would be "every provider skipped".
    vi.stubEnv('MUSICBRAINZ_USER_AGENT', '');

    const response = await request(TRACK_QUERY);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      code: 'not-configured',
      message: 'MUSICBRAINZ_USER_AGENT is not set on the server, so year lookups cannot run.',
    });
  });

  it('should keep the legacy invalid-request message', async () => {
    expect(await request({ title: '', artist: 'Someone' })).toMatchObject({
      status: 400,
      body: { code: 'invalid-request', message: 'A title and an artist are required.' },
    });
  });
});

describe('/api/year?stage=', () => {
  it('should route stage=resolve to the provider vote', async () => {
    script('deezer', answer({ provider: 'deezer', year: 1974, isrcYear: 2001 }));
    script(
      'musicbrainz',
      answer({ provider: 'musicbrainz', year: 1974, confidence: 'high', source: 'release-group' }),
    );

    const response = await request({ ...TRACK_QUERY, stage: 'resolve' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      year: 1974,
      confidence: 'high',
      source: 'vote',
      agreedBy: ['deezer', 'musicbrainz'],
      cached: false,
      cleanedTitle: CLEANED.title,
      stripped: CLEANED.stripped,
      final: true,
    });
    expect(control.calls).toEqual({ deezer: 1, musicbrainz: 1 });
    // The legacy path's MusicBrainz was not the one asked.
    expect(musicBrainzFetches).toBe(0);
  });

  it('should route stage=verify to the vote, asking iTunes', async () => {
    script('deezer', answer({ provider: 'deezer', year: 1990, isrcYear: 2010 }));
    script(
      'musicbrainz',
      answer({ provider: 'musicbrainz', year: 1974, confidence: 'high', source: 'release-group' }),
    );
    script('itunes', answer({ provider: 'itunes', year: 1974 }));

    const response = await request({ ...TRACK_QUERY, stage: 'verify' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      year: 1974,
      agreedBy: ['musicbrainz', 'itunes'],
      final: true,
    });
    expect(control.calls['itunes']).toBe(1);
  });

  it('should answer 400 for an unknown or empty stage, never falling back to legacy', async () => {
    for (const stage of ['final', '', 'RESOLVE']) {
      const response = await request({ ...TRACK_QUERY, stage });
      expect(response).toMatchObject({ status: 400, body: { code: 'invalid-request' } });
    }
    expect(control.calls).toEqual({});
    expect(musicBrainzFetches).toBe(0);
  });

  it('should map a refused gate permit to 429 with retryAfterMs and Retry-After', async () => {
    // `verify`: any busy provider is a 429, answers in hand or not. Here `busy` is our own gate
    // refusing a permit (other players hold iTunes' shared slot); Apple's own 429 is the same
    // outcome (`api/_lib/itunes.test.ts`). Apple's 403 is a refused skip -- the test after the
    // next one.
    script('deezer', answer({ provider: 'deezer', year: 1990, isrcYear: 2010 }));
    script(
      'musicbrainz',
      answer({ provider: 'musicbrainz', year: 1974, confidence: 'high', source: 'release-group' }),
    );
    script('itunes', { kind: 'busy', retryAfterMs: 1_100 });

    const response = await request({ ...TRACK_QUERY, stage: 'verify' });

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ code: 'rate-limited', retryAfterMs: 1_100 });
    expect(response.headers['Retry-After']).toBe('2');
  });

  it('should answer a busy resolve with an answer in hand as a 200 the edge does not store', async () => {
    // Deezer's year is shown at once rather than thrown away with a 429; the busy MusicBrainz
    // is asked again by `verify`, so nothing may cache this body. The 429's wait rides in the
    // BODY, for the client's resolve lane to back off on -- never as a `Retry-After` on a 200.
    script('deezer', answer({ provider: 'deezer', year: 1990, isrcYear: 1990 }));
    script('musicbrainz', { kind: 'busy', retryAfterMs: 1_100 });

    const response = await request({ ...TRACK_QUERY, stage: 'resolve' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      year: 1990,
      source: 'deezer',
      final: false,
      retryAfterMs: 1_100,
    });
    expect(response.body).not.toHaveProperty('skipped');
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.headers['Retry-After']).toBeUndefined();
  });

  it("should answer iTunes' own 403 as a final 200 with iTunes skipped, never a 429", async () => {
    // The developer's decision (2026-10-01): Apple refusing us is a skip, not back-pressure.
    // The vote decides without iTunes at once -- MusicBrainz's `high`, unconfirmed -- and the
    // edge holds it only the short skipped window, so the card heals once Apple stops refusing.
    script('deezer', answer({ provider: 'deezer', year: 1990, isrcYear: 2010 }));
    script(
      'musicbrainz',
      answer({ provider: 'musicbrainz', year: 1974, confidence: 'high', source: 'release-group' }),
    );
    script('itunes', { kind: 'skipped', reason: 'refused', detail: 'HTTP 403' });

    const response = await request({ ...TRACK_QUERY, stage: 'verify' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      year: 1974,
      confidence: 'low',
      source: 'release-group',
      final: true,
      skipped: ['itunes'],
    });
    expect(response.body).not.toHaveProperty('retryAfterMs');
    expect(response.headers['Retry-After']).toBeUndefined();
    expect(response.headers['Cache-Control']).toBe(
      'public, s-maxage=60, stale-while-revalidate=60',
    );
    expect(control.calls['itunes']).toBe(1);
  });

  it('should map every provider failing to 502 upstream-unavailable', async () => {
    script('deezer', { kind: 'failed', code: 'upstream-unavailable' });
    script('musicbrainz', { kind: 'failed', code: 'unexpected-payload' });

    const response = await request({ ...TRACK_QUERY, stage: 'resolve' });

    expect(response).toMatchObject({
      status: 502,
      body: {
        code: 'upstream-unavailable',
        message: 'No year provider could be reached right now. Please try again.',
      },
    });
  });

  it('should not count a refused provider toward the not-configured 500', async () => {
    // Every provider skipped, one of them because it REFUSED us: a refusing provider is
    // configured, so "nothing can run" is false. Nothing answered and nothing failed, so the
    // finality rule makes it a final null, held the short skipped window.
    const notConfigured: ProviderOutcome = {
      kind: 'skipped',
      reason: 'not-configured',
      missingVariable: 'SOME_VARIABLE',
    };
    script('deezer', { kind: 'skipped', reason: 'refused', detail: 'quota error code 4' });
    script('musicbrainz', notConfigured);
    script('itunes', notConfigured);

    const response = await request({ ...TRACK_QUERY, stage: 'verify' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      year: null,
      confidence: 'none',
      final: true,
      skipped: ['deezer', 'musicbrainz', 'itunes'],
    });
    expect(response.headers['Cache-Control']).toBe(
      'public, s-maxage=60, stale-while-revalidate=60',
    );
  });

  it('should map every provider not-configured to 500 not-configured', async () => {
    const skipped: ProviderOutcome = {
      kind: 'skipped',
      reason: 'not-configured',
      missingVariable: 'SOME_VARIABLE',
    };
    script('deezer', skipped);
    script('musicbrainz', skipped);
    script('itunes', skipped);

    const response = await request({ ...TRACK_QUERY, stage: 'verify' });

    expect(response).toMatchObject({ status: 500, body: { code: 'not-configured' } });
  });

  it('should bound a final answer by the shortest TTL it was built from', async () => {
    // Deezer found nothing (a 1-day entry) and the pair still confirmed nothing, but iTunes
    // and MusicBrainz agree: final, nothing skipped, so the edge is held for at most one day.
    script('deezer', answer({ provider: 'deezer', year: null, isrcYear: null }));
    script(
      'musicbrainz',
      answer({ provider: 'musicbrainz', year: 1974, confidence: 'high', source: 'release-group' }),
    );
    script('itunes', answer({ provider: 'itunes', year: 1974 }));

    const response = await request({ ...TRACK_QUERY, stage: 'verify' });

    expect(response.body).toMatchObject({ final: true });
    expect(response.headers['Cache-Control']).toBe(
      'public, s-maxage=86400, stale-while-revalidate=86400',
    );
  });

  it('should hold a confirmed answer built from 30-day entries for 30 days', async () => {
    script('deezer', answer({ provider: 'deezer', year: 1974, isrcYear: 1974 }));
    script(
      'musicbrainz',
      answer({ provider: 'musicbrainz', year: 1974, confidence: 'high', source: 'release-group' }),
    );

    const response = await request({ ...TRACK_QUERY, stage: 'resolve' });

    expect(response.headers['Cache-Control']).toBe(
      'public, s-maxage=2592000, stale-while-revalidate=86400',
    );
  });

  it('should give a provisional answer about 60 seconds at the edge', async () => {
    script('deezer', answer({ provider: 'deezer', year: 1990, isrcYear: 2010 }));
    script(
      'musicbrainz',
      answer({ provider: 'musicbrainz', year: 1974, confidence: 'high', source: 'release-group' }),
    );

    const response = await request({ ...TRACK_QUERY, stage: 'resolve' });

    expect(response.body).toMatchObject({ final: false });
    expect(response.headers['Cache-Control']).toBe(
      'public, s-maxage=60, stale-while-revalidate=60',
    );
  });

  it('should never let the edge store a provisional answer built on a failed provider', async () => {
    // The client retries a non-final answer on the SAME URL within a second or two. An edge
    // copy would answer every retry with this body until the card was settled exhausted --
    // as a final null, which drops it -- so a failure this call means `no-store`.
    script('deezer', answer({ provider: 'deezer', year: 1990, isrcYear: 1990 }));
    script('musicbrainz', { kind: 'failed', code: 'upstream-unavailable' });

    const response = await request({ ...TRACK_QUERY, stage: 'resolve' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ final: false, skipped: ['musicbrainz'] });
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('should give a final answer reached with a provider skipped about 60 seconds', async () => {
    // Final only for as long as MusicBrainz stays unconfigured; pinning it for a month would
    // keep the degraded answer long after the variable is set.
    script('deezer', answer({ provider: 'deezer', year: 1990, isrcYear: 1990 }));
    script('musicbrainz', {
      kind: 'skipped',
      reason: 'not-configured',
      missingVariable: 'MUSICBRAINZ_USER_AGENT',
    });
    script('itunes', answer({ provider: 'itunes', year: 1985 }));

    const response = await request({ ...TRACK_QUERY, stage: 'verify' });

    expect(response.body).toMatchObject({ final: true, skipped: ['musicbrainz'] });
    expect(response.headers['Cache-Control']).toBe(
      'public, s-maxage=60, stale-while-revalidate=60',
    );
  });
});
