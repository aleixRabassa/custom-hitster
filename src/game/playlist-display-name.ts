/**
 * The name the APP shows for a playlist, which is its Spotify title except where this app has
 * chosen a label of its own.
 *
 * ===========================================================================
 *  WHY THIS EXISTS (2026-09-24)
 *
 *  The first suggested playlist's real Spotify title is "Hitser" -- one letter from "Hitster", a
 *  registered board-game mark the Google Play listing may not carry
 *  (`visual-assets/listing.md` §1). The 2026-09-19 relabel put "Jitster official" on the
 *  PICKER, but once that deck was dealt the HUD, the end screen, the PDF filename and a saved
 *  library row all rendered the fetched title again. This map is what makes the app's label win
 *  everywhere the name is SHOWN.
 *
 *  APPLIED ON READ, NEVER ON WRITE. The fetched name still enters `GameState.playlists` and the
 *  stored session unchanged; `deckLabel`, the end screen's list and `loadLibrary` substitute at
 *  the point of display. That is what fixes a session or a library entry saved BEFORE this
 *  existed -- a write-time rename would have left every one of those reading "Hitser".
 *
 *  KEYED BY ID, NOT BY TITLE. An editorial title changes when Spotify renames the playlist; the id
 *  is the thing the suggestion list verified.
 *
 *  Keep it to rows the app has deliberately labelled for itself. Every other suggestion's label is
 *  a rendering of its Spotify title (`LandingScreen.tsx`), and substituting those would make the
 *  HUD disagree with the playlist the player opens in Spotify.
 * ===========================================================================
 *
 * Lives in `src/game/` rather than beside `SUGGESTED_PLAYLISTS` because `deck-merge.ts` and
 * `playlist-library.ts` are pure modules that must not import a component; `LandingScreen` reads
 * the label from here, so the picker and the HUD cannot disagree.
 */

/** The developer-owned mixed-hits playlist whose Spotify title is "Hitser". */
export const JITSTER_OFFICIAL_PLAYLIST_ID = '34cIJlWIX9TEoA8bpI2UBu';

export const PLAYLIST_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  [JITSTER_OFFICIAL_PLAYLIST_ID]: 'Jitster official',
};

/**
 * Abbreviations whose stop belongs to the word, compared lowercased and without the stop. English,
 * Spanish and Catalan, the three languages the app speaks.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'vol',
  'vols',
  'no',
  'nº',
  'núm',
  'num',
  'nr',
  'pt',
  'ed',
  'op',
  'ep',
  'feat',
  'ft',
  'vs',
  'etc',
  'jr',
  'sr',
  'sra',
  'srta',
  'mr',
  'mrs',
  'ms',
  'dr',
  'dra',
  'st',
  'inc',
  'ltd',
  'co',
  'bros',
  'orig',
  'pàg',
  'pág',
  'pg',
  'aprox',
  'approx',
]);

/**
 * Whether the stop ending `trimmed` is part of its last word rather than punctuation added after
 * the title: an ellipsis ("Hits..."), an abbreviation ("Grandes Éxitos Vol."), an initial
 * ("Vitamin C.") or a word with inner stops ("U.S.A.", "a.m.").
 */
function stopBelongsToName(trimmed: string): boolean {
  if (trimmed.endsWith('..')) return true;

  const lastWord = trimmed.slice(trimmed.search(/\S+$/), -1);
  if (lastWord.includes('.')) return true;
  if ([...lastWord].length === 1 && /\p{L}/u.test(lastWord)) return true;

  return ABBREVIATIONS.has(lastWord.toLowerCase());
}

/**
 * A trailing full stop ADDED after the title is punctuation, not part of it: "Openings Català."
 * shows as "Openings Català". A stop that belongs to the name -- see `stopBelongsToName` -- stays.
 * Applied on read as well (`playlist-library.ts`), so a name already saved with it heals without a
 * migration. Trailing whitespace is ignored, since a Spotify title can carry it, and a name that is
 * nothing but a stop keeps it rather than becoming an empty label.
 */
export function withoutTrailingPeriod(name: string): string {
  const trimmed = name.trimEnd();
  if (!trimmed.endsWith('.') || stopBelongsToName(trimmed)) return name;

  const stripped = trimmed.slice(0, -1).trimEnd();
  return stripped === '' ? name : stripped;
}

/** The label to show for a playlist: the app's own where it has one, the Spotify title otherwise. */
export function playlistDisplayName(playlist: {
  readonly id: string;
  readonly name: string;
}): string {
  return withoutTrailingPeriod(PLAYLIST_NAME_OVERRIDES[playlist.id] ?? playlist.name);
}
