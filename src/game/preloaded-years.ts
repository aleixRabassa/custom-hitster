/**
 * The suggested playlists' years, looked up ahead of time (2026-10-01), and the two places they are
 * read -- A CACHE BY TRACK ID, ASKED BEFORE ANY REQUEST:
 *
 * - `applyPreloadedYears` puts them on a freshly fetched deck, in `usePlaylist`, before the merged
 *   deck reaches the deal -- so `START` sees a final start card and the gate opens at once;
 * - `withPreloadedYears` wraps the resolver's lookup in `use-game-session.ts`, so every lookup of
 *   a known track, on every path into the crawl (a resume, Restart, Play again included), answers
 *   from the table and sends nothing.
 *
 * ===========================================================================
 *  THE JSON IS GENERATED, REVIEWED BY HAND, AND NEVER REFRESHED BY AN AGENT
 *  ON ITS OWN INITIATIVE.
 *
 *  `preloaded-years.json` is written by `scripts/preload-years.ts`, which runs
 *  the app's own client path -- `fetchPlaylist`, `lookupYear` and
 *  `createYearResolver` -- against the real `/api/playlist` and `/api/year`
 *  handlers in process, and keeps only answers the server marked FINAL with no
 *  provider skipped. The developer then corrects entries by hand (an entry
 *  with a `note`), and a regeneration keeps those. It changes only when the
 *  developer asks: see AGENTS.md, "Decks, links, library, shuffle".
 * ===========================================================================
 *
 * KEYED BY TRACK ID, which is what makes a playlist that changed since the file was written cost
 * nothing: a track that arrived is simply absent and the crawl looks it up as before; a track
 * that left is an entry nobody reads. The resolver already treats a card that arrives with a
 * final year as done (`stageOf` in `resolver.ts`) and `START` already opens the card-1 gate for a
 * final start card. The table also applies to the same track in a playlist the player pasted -- a
 * track's year does not depend on the playlist.
 *
 * ONLY A CARD STILL OWED WORK IS ANSWERED. `applyPreloadedYears` stamps only a pending card
 * (`year === undefined`); `withPreloadedYears` answers whatever the resolver asks for, which is a
 * pending or a provisional card, never a final one. A card that already holds a final answer came
 * from a save or a Restart, and that answer is the session's.
 *
 * A stamped answer is FINAL by construction: no `yearProvisional`, no `yearUnverified`. And EVERY
 * year in the table is CONFIRMED (`high`, the developer's decision, 2026-10-01): it holds only
 * final answers, reviewed by hand, so an entry carries no confidence of its own. So
 * `isDroppedAnswer` never drops a preloaded year when the session skips unconfirmed years; a
 * preloaded `null` is still dropped at `START` unless the session keeps yearless cards.
 */

import type { ResolverLookup } from './resolver';
import type { Card } from '../../shared/types';

/** One track's answer. `title` and `artist` are for the person reviewing the file; nothing reads them. */
export interface PreloadedYear {
  title: string;
  artist: string;
  /** Always confirmed (`high`) when a number; `null` is a final "no year". */
  year: number | null;
  /**
   * Why the developer's hand correction differs from the providers. ITS PRESENCE IS WHAT MARKS A
   * MANUAL ENTRY, which `scripts/preload-years.ts` keeps on regeneration.
   */
  note?: string;
  /** On a manual entry: what the providers answered, so the correction stays auditable. */
  providerYear?: number | null;
}

export interface PreloadedYearsFile {
  generatedAt: string;
  /** Each playlist the file was generated from: its Spotify title and its track ids, in order. */
  playlists: Record<string, { name: string; tracks: string[] }>;
  tracks: Record<string, PreloadedYear>;
}

/** A `YearResult`-shaped answer, in `Card`'s field names. */
type PreloadedAnswer =
  { year: number; yearConfidence: 'high' } | { year: null; yearConfidence: 'none' };

/**
 * The year and confidence an entry stands for, or `undefined` when it is not one a card may hold.
 *
 * Checked at runtime although the file is bundled, because it is edited by hand and the compiler
 * cannot vouch for a hand edit. An integer year is `high` -- every year in the table is confirmed
 * -- and `null` is a final "no year" at `none`; anything else (no year, a string, a fraction) is
 * not an answer. A leftover `confidence` field is not read.
 */
function answerOf(entry: unknown): PreloadedAnswer | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { year } = entry as Record<string, unknown>;

  if (year === null) return { year: null, yearConfidence: 'none' };
  if (typeof year !== 'number' || !Number.isInteger(year)) return undefined;

  return { year, yearConfidence: 'high' };
}

/** The part of the file `applyPreloadedYears` and `withPreloadedYears` read. */
export interface PreloadedYearsTable {
  readonly tracks: Readonly<Record<string, unknown>>;
}

const EMPTY_TABLE: PreloadedYearsTable = { tracks: {} };

/** The one value of `VITE_PRELOADED_YEARS` that turns the table off. */
export const PRELOADED_YEARS_OFF = 'off';

/**
 * Whether a deal reads the table, from the raw `VITE_PRELOADED_YEARS` (2026-10-01).
 *
 * A LOAD-TEST SWITCH, not a feature: with the table off, every card of a suggested playlist is
 * asked of `/api/year` again, which is the traffic a load test wants to see. ONLY THE EXACT
 * LITERAL `off` disables it; unset, empty, `false` or a typo all leave it on, because a mistyped
 * value in the Vercel dashboard must never silently turn the preload off for every player.
 */
export function isPreloadEnabled(flag: string | undefined): boolean {
  return flag !== PRELOADED_YEARS_OFF;
}

let tablePromise: Promise<PreloadedYearsTable> | undefined;

/**
 * The bundled table, loaded once per page and never rejected.
 *
 * A DYNAMIC import, because the file is ~170 kB of JSON: imported statically it took the entry
 * chunk from 226 kB to 395 kB (2026-10-01), on every visit, for a table only a deal reads. As its
 * own chunk it is requested when `usePlaylist` mounts (so it is usually in memory before the first
 * deal) and precached by the service worker like every other chunk; a deal waits for it at most
 * `PRELOADED_YEARS_MAX_WAIT_MS` (`preloadedYearsWithin`). A chunk that fails to load (offline before the worker
 * installed, a deploy that removed it) is an EMPTY table, which is exactly the behaviour before
 * the file existed -- the crawl asks for every card. Not cached on failure, so the next deal tries
 * again.
 *
 * `flag` is the raw `VITE_PRELOADED_YEARS`; at `off` this is the empty table at once and the chunk
 * is never fetched (`isPreloadEnabled`). The caller reads `import.meta.env`, not this module:
 * `scripts/preload-years.ts` imports its types, which puts it in `tsconfig.api.json`'s program,
 * and that program has no Vite types. Vite inlines the variable at BUILD time, so flipping it on
 * Vercel takes a redeploy, and a tab still on the old build keeps the old behaviour until its
 * service worker updates.
 */
export function loadPreloadedYears(flag: string | undefined): Promise<PreloadedYearsTable> {
  if (!isPreloadEnabled(flag)) return Promise.resolve(EMPTY_TABLE);

  tablePromise ??= import('./preloaded-years.json').then(
    (module) => ({ tracks: module.default.tracks }),
    () => {
      tablePromise = undefined;
      return EMPTY_TABLE;
    },
  );

  return tablePromise;
}

/**
 * How long a deal waits for the table once its playlists have arrived, and the crawl once at its
 * first lookup (2026-10-01, the developer's
 * choice of 2 s). Not measured: a guess at "long enough for the chunk on a slow phone, short enough
 * that a stalled one never strands the deal on loading".
 */
export const PRELOADED_YEARS_MAX_WAIT_MS = 2000;

/**
 * `table`, or the EMPTY table if it has not settled within `maxWaitMs` -- never a rejection.
 *
 * What a deal awaits instead of the bare load, because the chunk can stall (a first visit with no
 * service worker yet, a bad connection) and a deal must not wait on it with no limit, least of all
 * a pasted playlist the table knows nothing about. Giving up costs almost nothing: the resolver's
 * lookup reads the SAME memoised promise (`withPreloadedYears`, under its own one-off deadline),
 * so a late table still answers every card it knows from then on, final and with no request. Only
 * the card-1 gate stops opening at once, because `START` sees an unstamped card 1.
 */
export function preloadedYearsWithin(
  table: Promise<PreloadedYearsTable>,
  maxWaitMs: number,
): Promise<PreloadedYearsTable> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(EMPTY_TABLE);
    }, maxWaitMs);

    void table.then((loaded) => {
      clearTimeout(timer);
      resolve(loaded);
    });
  });
}

/**
 * The resolver's lookup, CACHE FIRST (2026-10-01, the developer's ask): every lookup of a track
 * the table knows -- by id, at either stage -- answers the table's year as FINAL and sends no
 * request; every other track goes to `lookup` unchanged.
 *
 * This is what makes the table the first answer on EVERY path into the crawl, not only on a
 * fetched deck: a resumed save, Restart and Play again never pass through `usePlaylist`, so a
 * pending card the table knows (a save from before the file, a deal whose chunk failed to load)
 * and a provisional one (owed a `verify`) both reach the resolver as work -- and settle here with
 * no request. `applyPreloadedYears` stays as well: it is what lets `START` open the card-1 gate
 * at once, before the resolver exists. A card already holding a final answer is never asked
 * (`stageOf` in `resolver.ts`), so this does not overwrite one.
 *
 * `table` is a PROMISE the caller passes (`loadPreloadedYears(...)`, so `VITE_PRELOADED_YEARS=off`
 * applies here too) rather than one this module loads, which keeps the env read in the hook and
 * lets `App.test.tsx` mock the load. It never rejects. `scripts/preload-years.ts` does NOT use
 * this: it generates the table, and reading its own output would make `--refresh` a no-op.
 *
 * The synthetic body carries only what the resolver reads (`year`, `confidence`, `final`) plus
 * honest values for the rest: `cached: true` (no provider was asked), no `source`, and the card's
 * own title, uncleaned, since nothing was searched for.
 */
export function withPreloadedYears(
  lookup: ResolverLookup,
  table: Promise<PreloadedYearsTable>,
): ResolverLookup {
  // ONE deadline per wrapped lookup, started by its first call: the crawl waits for a stalled
  // chunk at most `PRELOADED_YEARS_MAX_WAIT_MS` ONCE, not once per card (the lanes are serial),
  // and a table that lands later still wins every lookup after it -- with both settled, `race`
  // takes the first listed.
  let deadline: Promise<PreloadedYearsTable> | undefined;

  return async (track, stage, signal) => {
    deadline ??= preloadedYearsWithin(table, PRELOADED_YEARS_MAX_WAIT_MS);
    const { tracks } = await Promise.race([table, deadline]);
    const answer = Object.hasOwn(tracks, track.id) ? answerOf(tracks[track.id]) : undefined;
    if (answer === undefined) return lookup(track, stage, signal);

    return {
      ok: true,
      result: {
        year: answer.year,
        confidence: answer.yearConfidence,
        cached: true,
        cleanedTitle: track.title,
        stripped: { remaster: false, live: false, feature: false, version: false },
        final: true,
      },
    };
  };
}

/**
 * Stamp the table's answer onto every pending card it knows. Cards it does not know, and cards
 * that already hold an answer, are returned as the same objects.
 */
export function applyPreloadedYears(cards: readonly Card[], table: PreloadedYearsTable): Card[] {
  return cards.map((card) => {
    if (card.year !== undefined) return card;
    if (!Object.hasOwn(table.tracks, card.id)) return card;

    const answer = answerOf(table.tracks[card.id]);
    return answer === undefined ? card : { ...card, ...answer };
  });
}
