/**
 * The SELECTION decisions for the landing screen's suggested playlists, as pure functions over
 * strings and numbers: which suggestions the form already holds, what a toggle should do to the
 * rows, and whether an activation means "select" or "start a game".
 *
 * ===========================================================================
 *  WHY THIS IS A MODULE AND NOT THREE HELPERS INSIDE `LandingScreen`.
 *
 *  Every rule here fails INVISIBLY in jsdom. A cap that is off by one deals a
 *  six-playlist deck; a toggle that removes the wrong index empties a box the
 *  player typed into; a membership test that compares strings instead of ids
 *  leaves a suggestion highlighted that is not in the deck, or in the deck and
 *  not highlighted. None of those is a rendering difference a component test
 *  would notice -- they are wrong ANSWERS, and the way to test an answer is a
 *  function that returns one.
 *
 *  Same split as `gestures.ts` / `useCardGestures.ts` and `resolver.ts`: the
 *  decision is framework-free and exhaustively tested in the node environment,
 *  and the React seam is thin enough that reading it is sufficient review.
 * ===========================================================================
 *
 * ## The selection is DERIVED FROM THE ROWS, never stored
 *
 * There is no `Set` of selected ids in component state, and adding one is the change that breaks
 * this. A suggestion is selected exactly when some row of the form holds a link to it, which buys
 * three things for free:
 *
 * 1. The row's ✕ deselects. It removes the row, and the highlight is a function of the rows.
 * 2. A hand-pasted link to a suggested playlist highlights that suggestion, because it IS in the
 *    deck the player is about to deal.
 * 3. The highlight and the form cannot disagree, because there is only one fact.
 *
 * Same shape as `App.tsx` deriving `deckCollapsed` and `usePdfExport` deriving its wait rather than
 * holding a flag an effect has to clear.
 */

import { parsePlaylistUrl, spotifyPlaylistUrl } from '../../shared/spotify-url';

/**
 * Which playlist IDs the current row values hold, in no particular order.
 *
 * Parsed with the SHARED parser rather than string-compared against `spotifyPlaylistUrl(id)`,
 * because the two disagree on every form a player actually pastes: `?si=` tails (Spotify's own
 * share button appends one), `intl-es/` locale prefixes, `spotify:playlist:` URIs, the legacy
 * `/user/{u}/playlist/` path and a bare 22-character id all name the same playlist and none of
 * them is the canonical string.
 *
 * A blank row, an unparseable row and a `spotify.link` short URL all contribute nothing. The short
 * link is the interesting one: it carries no playlist id at all, so only the server can say what
 * it points at -- a player who pastes one gets a working deck and an unhighlighted suggestion, and
 * that is the honest answer rather than a guess.
 */
export function selectedPlaylistIds(rowValues: readonly string[]): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const value of rowValues) {
    const parsed = parsePlaylistUrl(value);
    if (parsed.ok) ids.add(parsed.id);
  }

  return ids;
}

/**
 * What a toggle should do to the rows, expressed as an instruction rather than as new rows.
 *
 * The caller applies it. That is deliberate: rows carry a stable per-row `id` minted from a ref
 * that lives in the component (see `PlaylistRow` in `LandingScreen.tsx`), and a module that
 * returned finished rows would have to own that counter -- which is exactly the piece of React
 * state this file exists to stay out of.
 *
 * `intoIndex: null` means "append a new row"; a number means "put it in this existing blank row".
 */
export type SelectionPlan =
  | { action: 'add'; url: string; intoIndex: number | null }
  | { action: 'remove'; atIndex: number }
  | { action: 'at-cap' };

/**
 * Plan the toggle of one suggested playlist against the current rows.
 *
 * The order of the three questions is the whole behaviour:
 *
 * 1. **Already there?** Then this is a deselect, and it names the FIRST row holding it. A second
 *    copy could only arrive by the player pasting the same link twice, and removing one of two
 *    identical rows per press is the least surprising reading of "press it again to remove it".
 * 2. **Is there a blank row?** Fill it. Without this, the very first selection on a pristine
 *    screen leaves the empty starting row above a new one, and the form grows a hole per press.
 * 3. **Is there room?** Append, or report `at-cap`.
 *
 * `maxPlaylists` is a parameter rather than an import of `MAX_DECK_PLAYLISTS`, so the boundary can
 * be tested at 2 instead of at 5 -- a test that has to build five rows to reach the interesting
 * case tends not to get written.
 *
 * The cap counts ROWS, not filled rows: a blank row is a box the player is about to type into, and
 * a selection that silently overwrote it would be the one destructive thing this feature does.
 * Since question 2 already consumed any blank, reaching question 3 means every row is spoken for.
 */
export function planSelectionToggle(
  rowValues: readonly string[],
  playlistId: string,
  maxPlaylists: number,
): SelectionPlan {
  const existingIndex = rowValues.findIndex((value) => {
    const parsed = parsePlaylistUrl(value);

    return parsed.ok && parsed.id === playlistId;
  });

  if (existingIndex !== -1) return { action: 'remove', atIndex: existingIndex };

  const url = spotifyPlaylistUrl(playlistId);

  const blankIndex = rowValues.findIndex((value) => value.trim() === '');
  if (blankIndex !== -1) return { action: 'add', url, intoIndex: blankIndex };

  if (rowValues.length < maxPlaylists) return { action: 'add', url, intoIndex: null };

  return { action: 'at-cap' };
}

/** What pressing a suggestion means right now. */
export type SuggestionIntent = 'toggle' | 'start';

/**
 * Does this activation select the playlist, or deal a deck from it?
 *
 * ===========================================================================
 *  `start` IS STILL THE DEFAULT, AND THAT IS A DELIBERATE ASYMMETRY.
 *
 *  A press on a suggestion with nothing selected deals a single-playlist deck
 *  immediately, exactly as it did before this feature existed -- including
 *  replacing whatever was typed. That is the one-click demo path and the entire
 *  reason the suggestions are on the screen (decision 5 of
 *  `plan.multi-playlist-ui.md`), and making every press require a second press
 *  on Start would spend it.
 *
 *  So the three ways to say "select instead" are all EXPLICIT:
 *
 *  - `wasLongPress` -- the finger held it. The gesture that enters selection
 *    mode, and the one this feature was asked for.
 *  - `hasModifier` -- Ctrl, Cmd or Shift. The standard multi-select idiom, and
 *    the only route a KEYBOARD user has: a long press is unreachable without a
 *    pointer, and Enter and Space both carry modifier flags.
 *  - `isSelecting` -- something is already selected, so the screen is visibly in
 *    selection mode and a plain press adds to it. This is what makes the second
 *    through fifth picks a single tap each.
 * ===========================================================================
 */
export function suggestionIntent({
  wasLongPress,
  hasModifier,
  isSelecting,
}: {
  wasLongPress: boolean;
  hasModifier: boolean;
  isSelecting: boolean;
}): SuggestionIntent {
  return wasLongPress || hasModifier || isSelecting ? 'toggle' : 'start';
}
