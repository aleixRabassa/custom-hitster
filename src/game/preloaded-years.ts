/**
 * The suggested playlists' years, looked up ahead of time (2026-10-01), and the function that puts
 * them on a freshly fetched deck -- in `usePlaylist`, before the merged deck reaches the deal.
 *
 * ===========================================================================
 *  THE JSON IS GENERATED, REVIEWED BY HAND, AND NEVER REFRESHED BY AN AGENT
 *  ON ITS OWN INITIATIVE.
 *
 *  `preloaded-years.json` is written by `scripts/preload-years.ts`, which runs
 *  the app's own client path -- `fetchPlaylist`, `lookupYear` and
 *  `createYearResolver` -- against the real `/api/playlist` and `/api/year`
 *  handlers in process, and keeps only answers the server marked FINAL with no
 *  provider skipped. The developer then corrects entries by hand
 *  (`source: 'manual'`), and a regeneration keeps those. It changes only when
 *  the developer asks: see AGENTS.md, "Decks, links, library, shuffle".
 * ===========================================================================
 *
 * KEYED BY TRACK ID, which is what makes a playlist that changed since the file was written cost
 * nothing: a track that arrived is simply absent and the crawl looks it up as before; a track
 * that left is an entry nobody reads. The resolver needs no change at all, because it already
 * treats a card that arrives with a final year as done (`stageOf` in `resolver.ts`) and `START`
 * already opens the card-1 gate for a final start card. The table also applies to the same
 * track in a playlist the player pasted -- a track's year does not depend on the playlist.
 *
 * ONLY A PENDING CARD IS STAMPED (`year === undefined`). A card that already holds an answer came
 * from a save or a Restart, and that answer is the session's.
 *
 * A stamped answer is FINAL by construction: no `yearProvisional`, no `yearUnverified`. So
 * `isDroppedAnswer` treats it exactly as it would the crawl's answer -- a preloaded `null` is
 * dropped at `START` unless the session keeps yearless cards, a preloaded `low` unless it keeps
 * unconfirmed years.
 */

import type { Card, YearConfidence } from '../../shared/types';

/** One track's answer. `title` and `artist` are for the person reviewing the file; nothing reads them. */
export interface PreloadedYear {
  title: string;
  artist: string;
  year: number | null;
  confidence: YearConfidence;
  /** `providers`: the server's final vote. `manual`: corrected by the developer, kept on regeneration. */
  source: 'providers' | 'manual';
  /** Why a `manual` entry differs from the providers. */
  note?: string;
  /** On a `manual` entry: what the providers answered, so the correction stays auditable. */
  providerYear?: number | null;
}

export interface PreloadedYearsFile {
  generatedAt: string;
  /** Each playlist the file was generated from: its Spotify title and its track ids, in order. */
  playlists: Record<string, { name: string; tracks: string[] }>;
  tracks: Record<string, PreloadedYear>;
}

/**
 * The year and confidence an entry stands for, or `undefined` when it is not one a card may hold.
 *
 * Checked at runtime although the file is bundled, because it is edited by hand and a JSON import
 * is typed by inference (`confidence: string`), so the compiler cannot vouch for it. The rule is
 * `YearResult`'s: a number at `high` or `low`, or `null` at `none`.
 */
function answerOf(entry: unknown): Pick<Card, 'year' | 'yearConfidence'> | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { year, confidence } = entry as Record<string, unknown>;

  if (year === null)
    return confidence === 'none' ? { year: null, yearConfidence: 'none' } : undefined;
  if (typeof year !== 'number' || !Number.isInteger(year)) return undefined;
  if (confidence !== 'high' && confidence !== 'low') return undefined;

  return { year, yearConfidence: confidence };
}

/** The part of the file `applyPreloadedYears` reads. */
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
 * own chunk it is fetched in parallel with the playlists (`usePlaylist`) and precached by the
 * service worker like every other chunk. A chunk that fails to load (offline before the worker
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
