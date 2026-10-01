/**
 * Generate `src/game/preloaded-years.json`: the final year of every track of the given playlists.
 *
 *   pnpm preload-years [--refresh] <playlistId>...
 *
 * With no ids, the playlists already in the file are used. RUN ONLY WHEN THE DEVELOPER ASKS
 * (`src/game/preloaded-years.ts` says why).
 *
 * THE SAME PATH AS THE APP, not a copy of it: the playlist is fetched by `fetchPlaylist` and every
 * year by `createYearResolver` + `lookupYear` -- the browser's own modules -- through a `fetch`
 * that calls the real `api/playlist.ts` and `api/year.ts` handlers in process. So the vote, the
 * provider gates (Upstash, shared with production) and the caches are exactly the deployed ones,
 * and a cold run is paced like a real deck: expect tens of minutes.
 *
 * WHAT IS KEPT: only an answer some `/api/year` call returned as `final: true` with no provider
 * `skipped`. A card the resolver settled after its retries ran out (a null, or a `yearUnverified`
 * year) is left out, so a later run asks again. An entry with a `note` is never overwritten.
 *
 * ONLY MISSING TRACKS ARE ASKED, unless `--refresh` re-asks every entry without a `note`. The file
 * is written every few answers, so an interrupted run resumes where it stopped.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import playlistHandler from '../api/playlist.js';
import yearHandler from '../api/year.js';
import { fetchPlaylist } from '../src/game/playlist-client.js';
import { createYearResolver } from '../src/game/resolver.js';
import { lookupYear } from '../src/game/year-client.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Card, YearLookupResult } from '../shared/types.js';
import type { PreloadedYear, PreloadedYearsFile } from '../src/game/preloaded-years.js';

const FILE = fileURLToPath(new URL('../src/game/preloaded-years.json', import.meta.url));
const WRITE_EVERY = 10;

interface InProcessResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

/** A `fetch` for relative `/api/*` URLs that runs the matching handler in this process. */
async function inProcessFetch(url: string): Promise<InProcessResponse> {
  const parsed = new URL(url, 'http://localhost');
  const handler =
    parsed.pathname === '/api/year'
      ? yearHandler
      : parsed.pathname === '/api/playlist'
        ? playlistHandler
        : undefined;
  if (handler === undefined) throw new Error(`No handler for ${parsed.pathname}`);

  const headers = new Map<string, string>();
  let status = 200;
  let body: unknown;
  const res = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return res;
    },
    status(code: number) {
      status = code;
      return res;
    },
    json(value: unknown) {
      body = value;
      return res;
    },
  };
  const req = { method: 'GET', query: Object.fromEntries(parsed.searchParams) };

  await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    json: async () => body,
  };
}

/**
 * The file as it is, or an empty one ONLY when it does not exist yet. Anything else -- a stray
 * comma after a hand edit -- throws: read as empty, the next `writeFile` would overwrite the real
 * file and lose every entry with a `note`.
 */
function readFile(): PreloadedYearsFile {
  let text: string;
  try {
    text = readFileSync(FILE, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { generatedAt: '', playlists: {}, tracks: {} };
    }
    throw error;
  }
  return JSON.parse(text) as PreloadedYearsFile;
}

/** A `note` is what marks the developer's hand correction (since 2026-10-01; before, `source`). */
function isManual(entry: PreloadedYear | undefined): boolean {
  return entry?.note !== undefined;
}

/**
 * Write the file with its tracks in playlist order, so a reviewer reads them playlist by playlist.
 * An entry no playlist holds any more is dropped, unless it has a `note`.
 */
function writeFile(file: PreloadedYearsFile): void {
  const tracks: Record<string, PreloadedYear> = {};
  for (const { tracks: ids } of Object.values(file.playlists)) {
    for (const id of ids) {
      const entry = file.tracks[id];
      if (entry !== undefined) tracks[id] = entry;
    }
  }
  for (const [id, entry] of Object.entries(file.tracks)) {
    if (isManual(entry) && tracks[id] === undefined) tracks[id] = entry;
  }

  file.generatedAt = new Date().toISOString();
  file.tracks = tracks;
  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const file = readFile();
  const ids = args.filter((arg) => !arg.startsWith('--'));
  const playlistIds = ids.length > 0 ? ids : Object.keys(file.playlists);
  if (playlistIds.length === 0) throw new Error('No playlist ids given and none in the file.');

  // ---- The playlists, through the app's own client --------------------------------------
  const pending = new Map<string, Card>();
  for (const id of playlistIds) {
    const outcome = await fetchPlaylist(`https://open.spotify.com/playlist/${id}`, {
      fetchImpl: inProcessFetch,
      isOnline: () => true,
    });
    if (!outcome.ok) {
      console.error(`playlist ${id}: ${outcome.code} -- left as it was`);
      continue;
    }

    const { playlist, cards } = outcome.result;
    file.playlists[id] = { name: playlist.name, tracks: cards.map((card) => card.id) };
    console.log(`playlist ${id} "${playlist.name}": ${cards.length} tracks`);

    for (const card of cards) {
      const known = file.tracks[card.id];
      if (isManual(known)) continue;
      if (known !== undefined && !refresh) continue;
      pending.set(card.id, card);
    }
  }
  writeFile(file);

  const deck = [...pending.values()];
  console.log(`${deck.length} tracks to look up`);
  if (deck.length === 0) return;

  // ---- The years, through the app's own resolver ----------------------------------------
  /** The last final, nothing-skipped 200 per card: the only answers worth keeping. */
  const finalAnswer = new Map<string, YearLookupResult>();
  let settled = 0;
  let kept = 0;
  let sinceWrite = 0;

  await new Promise<void>((resolve, reject) => {
    const resolver = createYearResolver(deck, {
      lookup: async (track, stage, signal) => {
        const outcome = await lookupYear(track, { fetchImpl: inProcessFetch, stage, signal });
        // A final `low` is kept too: any year in the table reads as confirmed (2026-10-01).
        if (outcome.ok && outcome.result.final && outcome.result.skipped === undefined) {
          finalAnswer.set(track.id, outcome.result);
        }
        return outcome;
      },
      sleep: (ms) => new Promise((wake) => setTimeout(wake, ms)),
      onResolved: (resolved) => {
        if ('provisional' in resolved) return;
        settled += 1;

        const card = pending.get(resolved.cardId)!;
        const answer = finalAnswer.get(resolved.cardId);
        const label = `[${settled}/${deck.length}] ${card.artist} - ${card.title}`;
        if (answer === undefined || answer.year !== resolved.year || resolved.unverified) {
          console.log(`${label}: not final (${resolved.year ?? 'null'}), left out`);
        } else {
          const entry: PreloadedYear = {
            title: card.title,
            artist: card.artist,
            year: answer.year,
          };
          file.tracks[card.id] = entry;
          kept += 1;
          console.log(`${label}: ${entry.year ?? 'null'}`);
          sinceWrite += 1;
          if (sinceWrite >= WRITE_EVERY) {
            writeFile(file);
            sinceWrite = 0;
          }
        }

        if (settled === deck.length) {
          resolver.stop();
          resolve();
        }
      },
      onLookupsUnavailable: () => {
        resolver.stop();
        reject(new Error('not-configured: no year provider is configured'));
      },
    });
    resolver.start();
  });

  writeFile(file);
  console.log(`done: ${kept} of ${deck.length} kept`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
