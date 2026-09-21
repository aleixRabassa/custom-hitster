/**
 * The landing screen: paste up to five playlist links, or pick one of the suggestions.
 *
 * Reached from `WelcomeScreen` since 2026-09-18 -- the front door explains the game and its big button
 * lands here. This file kept its name because the docs and the tests name it in forty-odd places;
 * where they say "landing screen" they mean this picker.
 *
 * ===========================================================================
 *  THIS IS A PRE-START SURFACE, SO IT MUST LEAK NOTHING ABOUT ANY DECK.
 *
 *  The person pasting the link is a PLAYER -- there is no host role in this app
 *  (plan.md §6). So the suggested playlists are labelled by genre and era -- or,
 *  for the first row since 2026-09-19, by a name this app chose -- never by what
 *  is in them, and nothing here ever renders a track title, an artist or
 *  a year. That rule is why there is no "preview the deck" affordance and no
 *  pre-Start year review: either would hand the player the answers to the whole
 *  game before it started.
 * ===========================================================================
 *
 * Presentational, like every other component in this directory: the URL goes out through
 * `onSubmit` and the request state comes in as props. `App.tsx` owns `usePlaylist`.
 *
 * ## Validation happens twice, and that is not duplication
 *
 * `parsePlaylistUrl()` runs here to avoid a pointless round trip and to give an instant, specific
 * error -- and it runs again on the server, because the server cannot trust a client. Both call
 * the SAME function in `shared/`, which is the entire reason that function lives there.
 *
 * A `spotify.link` short URL is the exception: it carries no playlist id, so no client-side check
 * can parse it. `isSpotifyShortLink()` recognises one and it is submitted for the server to
 * resolve. Rejecting it here would break the commonest way a phone user obtains a link at all.
 *
 * ## The form is a LIST of rows, and every error is a row's own
 *
 * A deck can be dealt from 1..`MAX_DECK_PLAYLISTS` playlists, so the single input became a list
 * with a "+" under it. Each row owns its message, wired to its own input through
 * `aria-describedby` and `aria-invalid` -- chosen over one shared error slot because with five
 * boxes on screen a single sentence names none of them, and over a chip/token input because a row
 * is what the suggestion and saved-playlist buttons already fill.
 *
 * The container-level `errorCode` prop keeps its own slot below the form. It describes the
 * REQUEST -- a total failure, or `no-years-found` from the session -- rather than a row.
 *
 * ## The suggestions are SELECTABLE, and the selection IS the rows
 *
 * Holding a suggestion -- or Ctrl/Cmd/Shift-activating it, which is the keyboard's only route --
 * puts it in the form instead of dealing a deck from it, so several can be combined and Start
 * plays all of them at once.
 *
 * ===========================================================================
 *  THERE IS NO SET OF SELECTED IDS IN THIS COMPONENT, AND ADDING ONE IS THE
 *  CHANGE THAT BREAKS THIS.
 *
 *  A suggestion is highlighted exactly when some row holds a link naming it.
 *  That single fact is what makes the row's ✕ a deselect (it removes the row,
 *  and the highlight is a function of the rows), what makes a hand-pasted link
 *  light up the suggestion it names, and what leaves no second copy of the truth
 *  to drift out of step with the boxes the player can see.
 *
 *  Every rule -- membership, the cap, which row a toggle touches -- is in
 *  `src/game/playlist-selection.ts`, because all of them fail INVISIBLY here: a
 *  wrong cap is a six-playlist deck and a wrong index is a box that emptied
 *  itself, and neither is a rendering difference a jsdom test would notice.
 * ===========================================================================
 *
 * A press with nothing selected still deals a deck immediately and still replaces whatever was
 * typed -- decision 5, unchanged, and the reason the hold and the modifier exist at all.
 */

import { useRef, useState } from 'react';

import { Footer } from './Footer';
import { SuggestionButton } from './SuggestionButton';
import { COPY } from '../game/copy';
import { MAX_DECK_PLAYLISTS } from '../game/deck-merge';
import { playlistErrorMessage } from '../game/messages';
import { savedDeckKey } from '../game/playlist-library';
import { planSelectionToggle, selectedPlaylistIds } from '../game/playlist-selection';
import { isSpotifyShortLink, parsePlaylistUrl, spotifyPlaylistUrl } from '../../shared/spotify-url';
import type { StartFailureCode } from '../game/messages';
import type { SavedPlaylist } from '../game/playlist-library';

/**
 * One input box: its value, its identity, and its own error.
 *
 * ===========================================================================
 *  THE `id` IS STABLE PER ROW AND IS NEVER THE INDEX (decision 6).
 *
 *  Removing a middle row with index keys makes React re-use the removed row's
 *  DOM node for the one that shifted up: the value under the player's cursor
 *  changes, focus stays on a box that is now a different row, and the
 *  `aria-describedby` association points at the wrong message. Keyed on this
 *  instead, React removes the node that actually went and the survivors keep
 *  their state.
 *
 *  It also derives the error message's `id`, which is what replaced the single
 *  `ERROR_MESSAGE_ID` module constant: there are now up to five messages on
 *  screen at once, so one literal cannot address them.
 * ===========================================================================
 */
interface PlaylistRow {
  id: string;
  value: string;
  /** A CLIENT-SIDE parse failure for this row only, or undefined. */
  errorCode?: StartFailureCode;
}

/** The `id` of the `<p>` a row's input points `aria-describedby` at. */
function rowErrorId(rowId: string): string {
  return `playlist-url-error-${rowId}`;
}

/**
 * The ready-to-try playlists, so a first-time visitor does not need a playlist of their own to see
 * the app work.
 *
 * ===========================================================================
 *  THE ROWS THEMSELVES ARE NOT DOCUMENTED ANYWHERE, DELIBERATELY. The set is
 *  edited on request and its contents drift on their own, so a comment naming
 *  the entries -- or recording their track counts, owners or preview coverage --
 *  is stale the day after it is written, and a stale comment about a verified id
 *  is worse than none: it reads as evidence. The array below IS the record. What
 *  survives here is only what stays true across any edit:
 *
 *  1. VERIFY BEFORE SHIPPING ANY CHANGE HERE, and verify by `entity.uri` AND
 *     `entity.name` in the embed payload -- never by a 200 response. Spotify
 *     refreshes an editorial playlist's contents and an owner can re-point,
 *     empty or hide a personal one, so a 200 is not evidence that an id still
 *     means the same playlist (plan.md §5). Re-verify the rows that stayed, not
 *     just the ones that arrived: a survivor is exactly the row nobody rechecks.
 *  2. A PERSONAL PLAYLIST IS A WEAKER PROMISE THAN AN EDITORIAL ONE. Its owner
 *     can make it private at any time, and the player then meets
 *     `not-found-or-private` on a row the app itself suggested. That is a
 *     trade to make knowingly, not a reason the set must be editorial.
 *  3. ANY ROW MAY RETURN EXACTLY MAX_EMBED_TRACKS, which raises the truncation
 *     notice by design -- correct behaviour, not a defect in the suggestion.
 * ===========================================================================
 *
 * The labels are readable renderings of Spotify's own titles -- real titles carry emoji, stray
 * punctuation and the occasional typo -- and the blurbs are genre/era names. **The first row is the
 * one exception, and it is labelled for the APP rather than for its Spotify title (2026-09-19):**
 * its real title is "Hitser", and rendering that readably produced "Hitster", which is a registered
 * mark the Google Play listing may not carry (`docs/store/listing.md` §1). So it reads
 * "Jitster official" -- a label this app chose, verified as owned by the developer's own account at
 * the time of the change. The rule the other rows follow is unchanged; this row is a deliberate
 * departure from it with a reason that is not about readability. Nothing in either field names
 * a track or a year, which is what keeps this pre-Start section leak-free. A single-artist row is
 * allowed: it tells the player every card shares an artist, and the game is guessing the YEAR, which
 * an artist gives nothing away about. Naming a track or a year would still be a leak.
 *
 * Stored as ids and turned into full links at the click, via `spotifyPlaylistUrl()`. The id is the
 * thing a verification checks, so it stays the constant; the URL is derived so the two can never
 * disagree.
 */
export const SUGGESTED_PLAYLISTS: readonly { id: string; label: string; blurb: string }[] = [
  { id: '34cIJlWIX9TEoA8bpI2UBu', label: 'Jitster official', blurb: 'Mixed hits' },
  { id: '0Bq6Ofk5drHQKzevbnPzW2', label: 'Trap Argentino Prime', blurb: 'Argentine trap' },
  { id: '4wZA7zbfDuTi9yqZy8WY4y', label: 'Hits Catalans', blurb: 'Catalan hits' },
  { id: '6xrNthbRvaWedC81pc78xo', label: 'Openings Català', blurb: 'Anime openings in Catalan' },
  {
    id: '3iANnuxueS6wustAWPbCgW',
    label: 'Disney: las 100 mejores',
    blurb: 'Disney soundtracks',
  },
  { id: '5y50Cn8dw3C25s2mwnCWQJ', label: 'Mejores BSO del cine', blurb: 'Film and TV scores' },
  { id: '7m1C1eHUC2kJQL69dGMjaz', label: 'EDM Hits of All Time', blurb: 'EDM' },
  { id: '37i9dQZF1DX8FwnYE6PRvL', label: 'Rock Party', blurb: 'Rock' },
  { id: '37i9dQZF1DX1HCSfq0nSal', label: 'PEGAO', blurb: 'Reggaeton' },
  { id: '7nnjdGCdCe24vVeSlFpGQV', label: 'Electro Latino Mejores Temazos', blurb: 'Latin electro' },
  { id: '37i9dQZEVXbMDoHDwVN2tF', label: 'Top 50 Global', blurb: 'Global chart' },
  { id: '37i9dQZF1DXaxEKcoCdWHD', label: 'Exitos España', blurb: 'Spanish hits' },
  { id: '37i9dQZF1DX0XUsuxWHRQd', label: 'RapCaviar', blurb: 'Hip-hop' },
];

export interface LandingScreenProps {
  /**
   * Fetch ONE deck from these playlist URLs, in row order. Never empty, never a blank string.
   *
   * Receives each row's value RAW apart from a trim -- the server owns every question about what a
   * link means, and a client that normalised a little is how the two drift apart.
   */
  onSubmit: (urls: string[]) => void;
  /**
   * Go back to the welcome screen (2026-09-18).
   *
   * REQUIRED rather than optional, because this picker is never the app's front door any more: every
   * state that shows it -- a fresh `idle`, an Exit, Home, a collapsed deck -- has a welcome screen
   * behind it, and a picker with no way back to that screen is a dead end on a phone with no
   * browser chrome (the TWA). The container owns the flag this flips; see `App.tsx`.
   */
  onBack: () => void;
  /**
   * The player's saved playlists, most-recent-first, from `playlist-library.ts` via the container.
   *
   * Playlist-level data only, which is what makes this section safe on a pre-start surface: an
   * entry is 1..5 ids, a name and a timestamp, and the name is the same class of data the
   * suggestions below already show. Empty renders NOTHING -- see the section itself.
   */
  savedPlaylists?: readonly SavedPlaylist[];
  /** Forget one saved playlist. The container owns the storage write. */
  onRemoveSaved?: (deckKey: string) => void;
  /** True while a request is in flight. Disables the controls. */
  isLoading: boolean;
  /**
   * Why the player cannot play, or undefined when there is nothing to report.
   *
   * `StartFailureCode` rather than `PlaylistClientErrorCode`, because not every reason is a fetch
   * failure: `no-years-found` means the playlist loaded fine and then every card's year lookup came
   * back empty, which `App.tsx` turns into a return to this screen. One slot, one union, one
   * sentence source (`messages.ts`).
   */
  errorCode?: StartFailureCode;
}

export function LandingScreen({
  onSubmit,
  onBack,
  isLoading,
  errorCode,
  savedPlaylists = [],
  onRemoveSaved,
}: LandingScreenProps) {
  const [rows, setRows] = useState<PlaylistRow[]>(() => [{ id: 'row-1', value: '' }]);

  /**
   * The next row id to hand out.
   *
   * A ref written only from EVENT HANDLERS, never during render -- a ref write in a render body is
   * what `eslint-plugin-react-hooks` rejects, correctly, and it is the same reason `usePlaylist`
   * writes its `fetchImpl` ref in an effect. The first row's id is the literal above, so nothing
   * has to be counted before the first press.
   */
  const nextRowIdRef = useRef(2);

  /** Fresh rows for a set of values, each with an id nothing else has held. */
  const makeRows = (values: readonly string[]): PlaylistRow[] =>
    values.map((value) => ({ id: `row-${nextRowIdRef.current++}`, value }));

  const canAddRow = rows.length < MAX_DECK_PLAYLISTS;

  /**
   * Which playlists the form currently holds, and therefore which suggestions are lit.
   *
   * Recomputed on every render rather than memoised: it is five short strings through a regex, and
   * a `useMemo` here would cost a dependency array that has to stay right for no measurable gain.
   */
  const selectedIds = selectedPlaylistIds(rows.map((row) => row.value));

  /**
   * Is the screen in selection mode -- i.e. would a plain press add rather than deal a deck?
   *
   * ===========================================================================
   *  SCOPED TO THE SUGGESTIONS, NOT TO "ANY PARSEABLE ROW", AND THAT IS THE
   *  POINT.
   *
   *  The HIGHLIGHT is the only cue the player has for which of the two things a
   *  press will do, so the mode has to be exactly what is highlighted. A player
   *  who pasted their own link has nothing lit, so a press on a suggestion still
   *  deals a deck immediately -- which does discard that typed row, and is
   *  decision 5 unchanged rather than an oversight.
   *
   *  If this read `selectedIds.size > 0`, typing any valid link would silently
   *  change what every suggestion does, with nothing on screen to say so.
   * ===========================================================================
   */
  const isSelecting = SUGGESTED_PLAYLISTS.some((playlist) => selectedIds.has(playlist.id));

  /**
   * Drop one row, and never leave the form with none.
   *
   * The substitute blank row is what lets the ✕ appear beside a lone filled row at all: without
   * it, removing the only row would leave a form with nothing to type in.
   *
   * Reads `rows` and sets the finished array, rather than using the functional form -- `makeRows`
   * writes `nextRowIdRef`, and a ref write inside an updater React may invoke twice is exactly
   * what the ref's own comment warns about.
   */
  const removeRow = (rowId: string) => {
    const remaining = rows.filter((candidate) => candidate.id !== rowId);

    setRows(remaining.length === 0 ? makeRows(['']) : remaining);
  };

  /**
   * Put a suggested playlist in the form, or take it out again.
   *
   * Every decision belongs to `planSelectionToggle`; this applies the instruction it returns. The
   * `at-cap` case is deliberately silent: the form is already showing "N playlists is the maximum
   * for one deck" in exactly that state, and a second message about the same fact is noise.
   */
  const toggleSuggestion = (playlistId: string) => {
    const plan = planSelectionToggle(
      rows.map((row) => row.value),
      playlistId,
      MAX_DECK_PLAYLISTS,
    );

    if (plan.action === 'at-cap') return;

    if (plan.action === 'remove') {
      const target = rows[plan.atIndex];
      if (target) removeRow(target.id);

      return;
    }

    if (plan.intoIndex === null) {
      setRows([...rows, ...makeRows([plan.url])]);

      return;
    }

    // Rebuilt without `errorCode`, exactly as an edit to the box would: a message about the value
    // that used to be there must not sit under the one that just replaced it.
    setRows(
      rows.map((row, index) => (index === plan.intoIndex ? { id: row.id, value: plan.url } : row)),
    );
  };

  /**
   * Validate every row and submit the whole set, or submit nothing.
   *
   * ALL-OR-NOTHING (rather than "play the rows that parsed"), because a client-side parse failure
   * is a typo the player can fix in a second, and quietly dealing four of the five playlists they
   * asked for is a deck that is wrong in a way nothing on screen explains. A playlist that fails to
   * LOAD is the other case entirely and is a notice, not an error -- see `deck-merge.ts`.
   *
   * Takes the rows as an argument rather than reading state, so the suggestion and saved buttons
   * can submit the rows they are about to set without waiting a render for them.
   */
  const submitRows = (candidates: readonly PlaylistRow[]) => {
    const urls: string[] = [];
    let hasError = false;

    const validated = candidates.map((row) => {
      const trimmed = row.value.trim();

      // Blank rows are ignored, not rejected: a player who pressed "+" once too often should not
      // have to remove the row to start.
      if (trimmed === '') return { id: row.id, value: row.value };

      // A short link cannot be parsed here -- only a redirect can resolve it -- so it skips
      // straight to the server. See the header block.
      if (!isSpotifyShortLink(trimmed)) {
        const parsed = parsePlaylistUrl(trimmed);
        if (!parsed.ok) {
          // NOT submitted: there is nothing for the server to add, and a round trip to be told the
          // same thing is just latency in front of the same sentence.
          hasError = true;
          return { id: row.id, value: row.value, errorCode: parsed.code };
        }
      }

      urls.push(trimmed);
      return { id: row.id, value: row.value };
    });

    // Every row blank. Reported on the FIRST row rather than in the container's slot, because it
    // is about what is (not) in the boxes -- and firing a request for nothing would spend a round
    // trip to be told the same thing.
    const first = validated[0];
    if (!hasError && urls.length === 0 && first) {
      hasError = true;
      validated[0] = { ...first, errorCode: 'invalid-url' };
    }

    setRows(validated);

    if (hasError) return;

    onSubmit(urls);
  };

  /**
   * A suggestion or a saved deck: fill the rows with its ids and submit in the same press.
   *
   * ===========================================================================
   *  THIS DISCARDS WHATEVER WAS TYPED, AND THAT IS ACCEPTABLE (decision 5).
   *
   *  It is today's one-click demo path and the entire reason the suggestions
   *  exist -- a first-time visitor with no playlist of their own presses once and
   *  is in a game. Making the pick merely FILL a row, with Start as a second
   *  press, would cost that.
   *
   *  Nothing is lost silently: the rows are visibly replaced by exactly what was
   *  submitted, and the screen is replaced by the game a moment later anyway.
   * ===========================================================================
   */
  const submitPlaylistIds = (ids: readonly string[]) => {
    submitRows(makeRows(ids.map((id) => spotifyPlaylistUrl(id))));
  };

  return (
    /*
      `relative` and a bottom band of AT LEAST `pb-12` are the FOOTER'S CONTRACT, not decoration:
      `Footer` is `absolute bottom-4`, so it anchors to this element and rides in the padding band
      this reserves. Drop either and the line either escapes to the viewport or lands on the last
      suggestion. `Footer.tsx` has the reasoning; `LandingScreen.test.tsx` asserts both.
      Since 2026-09-18 `relative` has a SECOND dependent: the Back button below is `absolute` too.

      `pb-20` is the band every host now reserves, and it is sized by the footer rather than chosen:
      `Footer` is `absolute bottom-8` and its line is ~16px, so 80px of padding puts exactly 32px
      above the line and 32px below it. Symmetric, which is what the developer asked for on
      2026-08-12 -- see `Footer.tsx` for the arithmetic. Change one of the two numbers and the line
      stops being centred in its own band.

      =============================================================================
       NO `justify-center` HERE, AND NO VIEWPORT-SIZED HERO EITHER (2026-08-12).

       This column has ALWAYS outgrown the viewport -- eight suggestions plus a
       library -- so `justify-center` on it centred nothing: it only applies to the
       free space of a container that has some, and this one never did.

       The hero below briefly carried a `min-h-[88dvh]` so the form sat in the
       middle of the first screenful. That is gone, asked for the same day: the
       minimum turned the distance between Start and the suggestions into
       "whatever is left of the viewport", which on a desktop is several hundred
       pixels of nothing and reads as the page having ended. The hero is now its
       own natural height and the sections are separated by this column's `gap-8`
       like every other pair -- one standard margin, the same at every viewport.

       `pt-8` here rather than `py-8` on the hero: the top padding belongs to the
       page, and leaving it on the hero would add to the `gap-8` below it and make
       the hero's two neighbours unequal.

       IT IS `pt-8` AND NOT `pt-6` BECAUSE `WelcomeScreen` IS (2026-09-21). The
       Back button is out of flow on both screens, so the hero is the first
       in-flow child and the logo's top edge IS this padding -- which made the
       same 192px logo sit 8px higher here than on the front door, and the two
       screens visibly jump on the one press between them. The developer asked
       for the logo at exactly the same height on both, so this number and
       `WelcomeScreen`'s are ONE number: change one and change the other.
      =============================================================================
    */
    <main className="relative flex min-h-dvh flex-col items-center gap-8 bg-page px-6 pt-8 pb-20 text-fg">
      {/*
        ===========================================================================
         THE WAY BACK TO THE FRONT DOOR (2026-09-18).

         The welcome screen went in front of this picker on the same day, and a
         screen a player can walk INTO needs a way back OUT -- on a phone inside
         the TWA there is no browser chrome, so this button is the only route.
         Top-left corner, where a back control is expected to be, and
         ghost-styled so it does not compete with Start.

         OUT OF FLOW -- `absolute top-8 left-6`, anchored to `<main>`'s
         `relative`, on the padding edges `pt-8` / `px-6` already draw. It
         shipped first as `self-start` in the column, and that put ~76px of
         nothing above the logo: a `touch-target` row is 44px tall and the
         column's `gap-8` added 32px more before the hero. Out of flow, the
         hero sits exactly on the column's own top padding, which is where it
         sat before the button existed -- that padding is 32px as of
         2026-09-21 and was 24px when this was written; the point is that the
         button costs the hero NOTHING, not the number. It stays
         the FIRST DOM child so the tab order still reaches it first. Known
         cost: on a 320px viewport the button's right padding grazes the logo's
         top-left corner (the text clears it); a "three widths" row in
         `docs/development.md` §5.

         A `<button>`, NOT an `<a>`, and that is not a style choice: there is no
         router and no history entry to return to (`App.tsx`'s header commits to
         neither), so an anchor would have no `href` that means anything. It
         flips a container flag, exactly as the welcome screen's own button
         does in the other direction.

         The accessible name is the VISIBLE text -- no `aria-label`, for the
         WCAG 2.5.3 reason the inputs below give -- and the arrow is
         `aria-hidden` decoration, the same split as the "+" and the ✕.

         Disabled while a request is in flight, like every other control here:
         leaving mid-fetch would put the loading state and the error slot on a
         screen that no longer exists.
        ===========================================================================
      */}
      <button
        type="button"
        onClick={onBack}
        disabled={isLoading}
        className="touch-target absolute top-8 left-6 flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-fg-secondary hover:text-fg focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
      >
        <span aria-hidden="true">←</span>
        {COPY.landing.backToWelcome}
      </button>

      {/*
        ===========================================================================
         THE HERO: THE LOGO, THE ONE SENTENCE, AND THE FORM.

         NO MINIMUM HEIGHT. It carried `min-h-[88dvh] justify-center` for part of
         2026-08-12, to put the form in the middle of the first screenful, and the
         developer asked for it back out the same day: a viewport-sized minimum
         makes the distance between Start and the suggestions equal to whatever is
         left over, which on a desktop is a screenful of empty page between the
         two -- and the suggestions are the one-click demo path for a first-time
         visitor, i.e. the thing that must not read as absent.

         So the group is purely a GROUP now: it keeps `max-w-content` and its own
         `gap-8`, and the column outside it supplies the same `gap-8` to whatever
         comes next.
        ===========================================================================
      */}
      <section className="flex w-full max-w-content flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {/*
            ===================================================================
             THE LOGO IS THE HEADING (2026-08-12), REPLACING THE TEXT WORDMARK.

             The `<h1>` stays -- it is still the document's one top-level heading
             and the landmark a screen-reader user lands on -- and the `alt` is
             the APP'S NAME, so the accessible name is exactly the string
             `index.html`'s `<title>` and `src/pwa/manifest.ts` carry. An empty
             `alt` here would leave the h1 nameless.

             The artwork carries the wordmark, so the `alt` and the picture say
             the same thing -- which they did NOT while `logo.webp` still read
             "HITSTER" against an app renamed to Jitster. The 2026-08-12 logo
             fixed that, and it is the reason the identity was regenerated
             rather than merely reused.

             `width`/`height` are the intrinsic 384 x 384 of the file, set as
             attributes so the box is reserved before the image decodes: this is
             the largest element on the app's front door and a late-arriving
             logo would shove the form it is centred with. Displayed at 192px,
             which is exactly 2x on a retina phone -- the file was regenerated at
             384 when the display size grew, rather than upscaling a 240. Never
             swap this for one of the `pwa-*.png` icons: they are the same
             artwork at 512px and 68 kB, on the one screen every visitor pays
             for -- and the full 1254px master is in `docs/assets/`,
             deliberately outside `public/`, because everything in `public/`
             ships AND is precached.

             ===================================================================
              THE EDGES ARE SOFTENED IN THE ASSET, AND A CSS MASK WAS TRIED HERE
              AND REMOVED. Do not add one back without measuring first.

              The artwork is a neon card on a PURE BLACK backdrop and the page is
              `--color-page` (#0a0a0a), so the logo read as a square pasted onto
              the screen: a 4% luminance step across a hard straight edge is what
              an eye is built to find. The fix is in the FILE -- every derivative
              now has its black floor raised to exactly the page colour, so the
              backdrop and the page are the same colour and there is no step to
              see. It works in every browser and needs no CSS.

              `mask-x-from-90% mask-y-from-90%` was added on top of that and then
              measured out again. Two reasons, and the first is the trap:
              `mask-x-from-*` measures from the CENTRE as a fraction of the FULL
              axis, so a 90% stop fades the outer 10% of the width -- which is the
              outer 20% of the half-edge, twice what the reasoning assumed. The
              artwork's bright pixels span 11.0%..95.8% horizontally, so the band
              landed ON the neon frame: its right edge was attenuated to 0.44 and
              the bottom-right corner to ~0.3, ASYMMETRICALLY, because the artwork
              is not centred in its own canvas. The second reason is that it had
              nothing left to do -- from 96.6% outward every pixel is already
              exactly the page colour, so a mask there is a no-op by construction.
             ===================================================================
            ===================================================================
          */}
          <h1>
            <img
              src="/logo.webp"
              alt={COPY.landing.logoAlt}
              width={384}
              height={384}
              fetchPriority="high"
              className="size-48"
            />
          </h1>
          <p className="text-sm text-fg-secondary">{COPY.landing.intro(MAX_DECK_PLAYLISTS)}</p>
        </div>

        <form
          className="flex w-full flex-col gap-3"
          onSubmit={(event) => {
            // The page must not navigate: this is a single-page app and a real form submission
            // would reload it back to `idle`, throwing away the session that is being started.
            event.preventDefault();
            submitRows(rows);
          }}
        >
          {rows.map((row, index) => (
            /*
            Keyed on the row's own id, NEVER on the index -- see `PlaylistRow`. The visible
            NUMBERING is positional and does renumber when a row is removed, which is correct: it
            names where the box is on screen, while the key names which box it is.
          */
            <div key={row.id} className="flex flex-col gap-1">
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  {/*
                  The first row keeps Phase 6's wording; later rows are numbered, so every input on
                  the screen has a UNIQUE accessible name. Five boxes all called "Playlist link"
                  are five boxes a screen-reader user cannot tell apart, and one query in the tests
                  would match all of them.
                */}
                  <span className="text-sm text-fg-secondary">
                    {COPY.landing.playlistLinkLabel(index)}
                  </span>
                  {/*
                  ===============================================================
                   NO `aria-label` ON THESE INPUTS, AND ADDING ONE BACK IS A
                   DEFECT.

                   The first one carried `aria-label="Spotify playlist link"`
                   through Phase 6, alongside the visible `Playlist link` above.
                   `aria-label` WINS over a wrapping label, so the accessible name
                   did not match the visible text -- which is a WCAG 2.5.3 (Label
                   in Name) failure and breaks speech control outright: "click
                   Playlist link" matched nothing on the screen, because the only
                   name the browser knew was the hidden one.

                   The wrapping `<label>` already supplies a correct name, so the
                   attribute was redundant as well as harmful. That is also why
                   the numbering above is VISIBLE text rather than an
                   `aria-label` per row. `LandingScreen.test.tsx` queries by the
                   visible text, which is the query that fails if the attribute
                   ever comes back.
                  ===============================================================
                */}
                  <input
                    type="text"
                    value={row.value}
                    onChange={(event) => {
                      const { value } = event.target;
                      // Only THIS row's error is cleared. An error about the previous value sitting
                      // beside a half-typed new one reads as an error about what is currently in the
                      // box -- and clearing all five would wipe messages about boxes nobody touched.
                      setRows((current) =>
                        current.map((candidate) =>
                          candidate.id === row.id ? { id: candidate.id, value } : candidate,
                        ),
                      );
                    }}
                    placeholder={COPY.landing.playlistLinkPlaceholder}
                    aria-invalid={row.errorCode !== undefined}
                    /*
                    `aria-describedby` pointed at this row's error WHILE ONE EXISTS, and undefined
                    otherwise -- a describedby naming an element that is not in the document is a
                    dangling reference some screen readers report as an error.

                    `aria-invalid` alone was the Phase 6 state, and it says only THAT the value is
                    wrong. The reason was announced once by `role="alert"` and then unreachable: a
                    player who tabbed back to the field heard "invalid" and no explanation. This is
                    what makes the reason available on focus as well as at the moment it arrives.
                  */
                    aria-describedby={row.errorCode === undefined ? undefined : rowErrorId(row.id)}
                    /*
                    `autoComplete="off"` and `spellCheck={false}`: this is a URL, and a spell-check
                    underline plus an autofill dropdown over a pasted link is noise.
                    `inputMode="url"` gets the right phone keyboard, which matters because a phone
                    is the primary device.
                  */
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="url"
                    disabled={isLoading}
                    className="rounded-lg border border-border-strong bg-surface px-4 py-3 text-fg placeholder:text-fg-muted focus-visible:focus-ring disabled:opacity-(--opacity-disabled)"
                  />
                </label>

                {/*
                Only once there is something to remove -- which now means EITHER another row to
                fall back to OR something in this one. A lone EMPTY row still has no ✕, because
                removing it would do nothing observable; a lone FILLED row does, and removing it
                substitutes a fresh blank (see `removeRow`).

                That second case was added with the suggestion selection, and it is not cosmetic:
                the ✕ is one of the two documented ways to deselect a suggestion, and the first
                selection on a pristine screen lands in the single starting row. Without this it
                would be the one selection the ✕ could not undo.

                The name carries the row's POSITION, for the same reason the library's remove
                button carries its playlist name: five buttons all called "Remove" give a
                screen-reader user no way to tell which one they are on. The ✕ is `aria-hidden`
                decoration -- same split as `NoticeBanner`'s Dismiss.
              */}
                {rows.length === 1 && row.value === '' ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      removeRow(row.id);
                    }}
                    disabled={isLoading}
                    aria-label={COPY.landing.removeRow(index + 1)}
                    className="touch-target rounded-lg border border-border px-3 text-fg-muted hover:border-border-strong hover:text-fg focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                )}
              </div>

              {row.errorCode === undefined ? null : (
                /*
                `role="alert"` so the message is announced rather than only drawn -- a player using
                a screen reader otherwise gets no signal that a submission failed at all. The copy
                comes from the client-side map; the server's own `message` field is deliberately
                not rendered (see `messages.ts`).

                The `id` is the other half of this input's `aria-describedby`. Both exist only
                while there is an error, so the reference is never dangling.
              */
                <p id={rowErrorId(row.id)} role="alert" className="text-sm text-danger">
                  {playlistErrorMessage(row.errorCode)}
                </p>
              )}
            </div>
          ))}

          {/*
          The "+". `type="button"`, so it cannot submit the form it lives inside.

          =============================================================================
           A FULL-WIDTH GHOST ROW, NOT A SMALL SQUARE BUTTON (amended 2026-08-07).

           It was `self-start` with `px-3 py-1` and a bare `+`, which put a THIRD width
           into a column that otherwise has exactly one -- the full-width inputs -- and
           left it floating in its own slot between the rows and Start, belonging to
           neither. It now occupies the same slot shape as a playlist row (`w-full`,
           the input's own `rounded-lg` / `px-4` / `py-3`) with a DASHED border, so it
           reads as the next box the player can create, which is what pressing it does.

           The visible sentence is what lets the `aria-label` go: the accessible name
           now comes from the text content, so the name and the visible label MATCH.
           An `aria-label` duplicating visible text is the redundancy the inputs above
           were fixed for (WCAG 2.5.3), and a name of "+" was useless to anyone not
           looking at the screen. The glyph stays `aria-hidden` decoration.

           UNMOUNTED AT THE CAP RATHER THAN DISABLED: a control offering an action that
           can never succeed is noise on a pre-start surface, and it is also a button a
           screen-reader user has to walk past to reach Start. The sentence below takes
           over the same full-width slot, so the cap is still said out loud -- which is
           the half that must not be dropped with it -- and the layout barely moves.
          =============================================================================
        */}
          {!canAddRow ? null : (
            <button
              type="button"
              onClick={() => {
                setRows((current) => [...current, ...makeRows([''])]);
              }}
              disabled={isLoading}
              className="touch-target flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-fg-secondary hover:border-border-strong hover:bg-surface hover:text-fg focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
            >
              <span aria-hidden="true">+</span>
              {COPY.landing.addRow}
            </button>
          )}

          {/*
          A control that VANISHES with no explanation reads as broken just as a dead one does, so the
          cap says itself out loud in the space the "+" left. Not a `role="alert"`: nothing failed,
          and reaching five playlists is not an error.
        */}
          {canAddRow ? null : (
            <p className="text-xs text-fg-muted">{COPY.landing.atMaxRows(MAX_DECK_PLAYLISTS)}</p>
          )}

          <button
            type="submit"
            // Disabled while loading, which is what stops a double submission dealing two decks.
            // `usePlaylist` aborts the first request anyway, so this is the visible half of a
            // guarantee the hook already makes.
            disabled={isLoading}
            /*
            `text-on-accent` rather than `text-white`, and that is a contrast fix rather than a
            rename: white on `--color-accent` measured 3.67:1, a 1.4.3 failure on the app's
            primary action at 16px -- and at the 18px it is now, which is the LARGE-text
            threshold and so a 3:1 floor rather than 4.5:1: the fix is not made redundant by the
            size, it is simply further clear. The background is unchanged; only the label
            darkens, to 5.40:1 at rest and 8.03:1 on hover.

            IT IS `WelcomeScreen`'S BIG BUTTON, TO THE CLASS (2026-09-21). `px-6 py-4 text-lg
            font-semibold`, asked for so the picker and the front door read as one app rather
            than as two -- the front door's own reason for the size applies here unchanged: this
            is the one thing the screen asks the player to do. What is NOT copied from it is the
            disabled pair below: that button is never disabled and this one is, for the whole of
            a request.
          */
            className="touch-target rounded-lg bg-accent px-6 py-4 text-lg font-semibold text-on-accent hover:bg-accent-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
          >
            {isLoading ? COPY.landing.starting : COPY.landing.start}
          </button>

          {/*
          THE CONTAINER'S SLOT, AND IT IS NOT A ROW'S (decision 4). It describes the REQUEST -- a
          batch in which not one playlist loaded, or `no-years-found` from the session after a deck
          was dealt and every year lookup came back empty. Neither belongs under an input: the
          first is about all of them and the second is about a playlist that parsed perfectly.

          Below the Start button because that is the press it is about, and `role="alert"` for the
          same reason a row's message has one -- otherwise a screen-reader user gets no signal that
          a submission failed at all.
        */}
          {errorCode === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {playlistErrorMessage(errorCode)}
            </p>
          )}
        </form>
      </section>

      {/*
        ===================================================================
         THE SAVED LIBRARY, AND THE EMPTY STATE IS *NOTHING AT ALL*.

         Not a placeholder, not "you have no saved playlists yet" (step 14). A
         first-time visitor already has the form and eight suggestions; a fourth
         block explaining an empty list is noise on the screen that has to make
         the app's one job obvious.

         Above the suggestions because these are the player's own, and in the
         same button shape so a click submits by exactly the path a suggestion
         does -- `spotifyPlaylistUrl(id)` through `submit`, which fills the input
         as well. There is no second entry into the session for a saved
         playlist.

         BELOW THE HERO SINCE 2026-08-12, with the suggestions, and it stayed
         there when the hero's viewport minimum came back out later the same day:
         the form is the screen's one job, and a block whose height is however
         many decks the player happens to have saved is the wrong thing to put
         between the logo and Start. It keeps its full row shape, unlike the
         suggestions below, because these ARE the player's own.
        ===================================================================
      */}
      {savedPlaylists.length === 0 ? null : (
        <section className="flex w-full max-w-content flex-col gap-2">
          <h2 className="text-sm text-fg-secondary">{COPY.landing.savedHeading}</h2>

          <ul className="flex flex-col gap-2">
            {savedPlaylists.map((saved) => (
              /*
                Two buttons side by side rather than a remove control INSIDE the play button: a
                nested button is invalid HTML and, more to the point, a press on the inner one
                would activate both -- the same class of bug that moved `CardControls` off the
                card in Phase 5.
              */
              /*
                Keyed on the DECK key rather than on an id: an entry is 1..5 playlists, and
                `savedDeckKey` is the identity `savePlaylist` dedupes on, the argument
                `onRemoveSaved` takes, and therefore the one string that names this row
                unambiguously.
              */
              <li key={savedDeckKey(saved)} className="flex items-stretch gap-2">
                <button
                  type="button"
                  // EVERY id, not just the first: a saved entry is 1..5 playlists, and it is the
                  // whole deck the player chose to keep. The rows are replaced by exactly this set
                  // on the way through -- see `submitPlaylistIds`.
                  onClick={() => {
                    submitPlaylistIds(saved.ids);
                  }}
                  disabled={isLoading}
                  className="flex flex-1 touch-target items-baseline gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-border-strong focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
                >
                  {/*
                    The playlist's own title, and NOTHING beside it. Never a track, an artist or a
                    year -- and no second line either: a suggestion carries a genre blurb because
                    someone wrote one, and there is nothing equally safe to say about a saved
                    playlist. The saved-at timestamp sorts the list and is deliberately not shown.

                    It is also what keeps this button's accessible name exactly the playlist name,
                    which matters because the remove control beside it names the same playlist --
                    a badge here made every row's two buttons match one query.
                  */}
                  <span>{saved.name}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onRemoveSaved?.(savedDeckKey(saved))}
                  disabled={isLoading}
                  /*
                    The name carries the playlist, because a screen with four rows of "Remove"
                    gives a screen-reader user no way to tell which one they are on. The ✕ is
                    `aria-hidden` decoration -- same split as `NoticeBanner`'s Dismiss.
                  */
                  aria-label={COPY.landing.removeSaved(saved.name)}
                  className="touch-target rounded-lg border border-border px-3 text-fg-muted hover:border-border-strong hover:text-fg focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        ===========================================================================
         SECONDARY BY POSITION *AND* BY WEIGHT (2026-08-12).

         These were full-width `bg-surface` rows directly under the form, which
         made them the visual bulk of the app's front door -- the developer's
         note was that they are not a main element. They are now last, in a
         two-column grid on anything wider than a phone, with no filled surface and
         quieter type. What did NOT change is what a press does: still one click
         into a game, which is the entire reason they exist.

         "Last" and no longer "below the fold": the hero's `min-h-[88dvh]`, which
         is what put them there, came back out on the same day -- the empty band it
         created between Start and this heading was the developer's next note. The
         demotion here is entirely weight and order, which is what it should have
         been.

         THE HEADING IS STYLED AS A FORM LABEL, NOT AS DIMMED SMALL PRINT
         (2026-08-12, second pass). It is `text-sm text-fg-secondary` -- the exact
         pair the "Playlist link" `<span>` above carries -- because the developer
         asked for the two to match, and because they are the same KIND of thing:
         each names the control under it. It was `text-xs text-fg-muted`, which is
         the app's small-print pair (the cap hint, the footer), and which made the
         one-click demo path read as a footnote.

         Still not an `opacity-*` on a brighter token, for the reason `Footer.tsx`
         gives: an opacity modifier puts a real contrast ratio nowhere in the repo.
         `--color-fg-secondary` is audited like every other colour here.
        ===========================================================================
      */}
      <section className="flex w-full max-w-content flex-col gap-3 sm:max-w-2xl">
        {/*
          Left-aligned and in sentence case since 2026-08-12. It was centred and `uppercase`, which
          is a lot of emphasis for the section whose whole point is that it is NOT a main element --
          all-caps reads as a label on something important, and a centred heading over a
          left-aligned grid draws a second axis. The string itself is unchanged, so `uppercase`
          could simply go: it was a display transform, not the text.
        */}
        <h2 className="text-sm text-fg-secondary">{COPY.landing.suggestionsHeading}</h2>

        <ul className="grid gap-2 sm:grid-cols-2">
          {SUGGESTED_PLAYLISTS.map((playlist) => (
            <li key={playlist.id}>
              {/*
                `SuggestionButton` owns the press: a hold selects, a plain press deals a deck
                while nothing is selected and toggles once something is. It is a separate
                component because `useLongPress` is a hook and a hook cannot be called inside
                this `.map()` -- see its header for the rest.

                `onStart` is Phase 6's path, untouched: fill the rows with the FULL link AND
                submit, so the suggestion behaves exactly as if that link had been pasted --
                including leaving it visible, which is how a player learns what a valid link
                looks like. One id, so it deals a SINGLE-playlist deck and replaces whatever was
                typed.
              */}
              <SuggestionButton
                label={playlist.label}
                blurb={playlist.blurb}
                isSelected={selectedIds.has(playlist.id)}
                isSelecting={isSelecting}
                disabled={isLoading}
                onToggle={() => {
                  toggleSuggestion(playlist.id);
                }}
                onStart={() => {
                  submitPlaylistIds([playlist.id]);
                }}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* The app's front door, so the one screen where a copyright line is expected. */}
      <Footer />
    </main>
  );
}
