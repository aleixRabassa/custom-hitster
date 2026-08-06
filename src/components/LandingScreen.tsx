/**
 * The landing screen: paste a playlist link, or pick one of the suggestions.
 *
 * ===========================================================================
 *  THIS IS A PRE-START SURFACE, SO IT MUST LEAK NOTHING ABOUT ANY DECK.
 *
 *  The person pasting the link is a PLAYER -- there is no host role in this app
 *  (plan.md §6). So the suggested playlists are labelled by genre and era, never
 *  by what is in them, and nothing here ever renders a track title, an artist or
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
 */

import { useState } from 'react';

import { playlistErrorMessage } from '../game/messages';

/**
 * The id `aria-describedby` points at while an error is on screen.
 *
 * A module constant rather than a `useId()`: there is exactly one landing screen in the app at any
 * moment (`App.tsx`'s status switch renders one screen), so a collision is not reachable, and a
 * stable literal is what makes the test assertion readable.
 */
const ERROR_MESSAGE_ID = 'playlist-url-error';
import { isSpotifyShortLink, parsePlaylistUrl, spotifyPlaylistUrl } from '../../shared/spotify-url';
import type { StartFailureCode } from '../game/messages';
import type { SavedPlaylist } from '../game/playlist-library';

/**
 * The nine ready-to-try playlists, so a first-time visitor does not need a playlist of their own
 * to see the app work.
 *
 * ===========================================================================
 *  VERIFIED 2026-08-06, when this set replaced the five Phase 0 ids (RapCaviar
 *  is the one that survived). All nine resolve to the intended playlist, checked
 *  by `entity.uri` AND `entity.name` in the embed payload rather than by a 200
 *  response -- editorial playlists get their contents refreshed by Spotify, so a
 *  200 is not evidence that an id still means the same playlist (plan.md §5).
 *
 *  Track counts at that check, in the order below: 100, 40, 100, 100, 50, 100,
 *  50, 50, 50. FOUR return exactly MAX_EMBED_TRACKS -- Éxitos Verano, Radio
 *  BrianPer, Electro Latino and This is Duki -- so all four raise the truncation
 *  notice by design. Preview coverage was total except Electro Latino (2 of 100
 *  without one) and This is Duki (8 of 100).
 *
 *  Re-verify the same way before shipping any future change here.
 * ===========================================================================
 *
 * The labels are Spotify's own playlist titles and the blurbs are genre/era names. None of them
 * describes a track or a year, which is what keeps this section leak-free.
 *
 * "This is Duki (all songs)" is the one label that says something about a deck's contents -- it is
 * a single-artist playlist, so picking it tells the player every card is by the same artist. That
 * is not a leak in the sense this screen guards against: the game is guessing the YEAR, and the
 * artist gives none of them away. Naming a track or a year still would.
 *
 * Stored as ids and turned into full links at the click, via `spotifyPlaylistUrl()`. The id is the
 * thing that was verified above and the thing a re-verification checks, so it stays the constant;
 * the URL is derived so the two can never disagree.
 */
export const SUGGESTED_PLAYLISTS: readonly { id: string; label: string; blurb: string }[] = [
  {
    id: '2zmXlpkOMN92NlQaE2M62c',
    label: 'Éxitos Verano 2000s & 2010s',
    blurb: 'Spanish summer hits',
  },
  { id: '37i9dQZF1DX1HCSfq0nSal', label: 'PEGAO', blurb: 'Reggaeton' },
  { id: '2wJx2AIytvpaSJLsc2wy3V', label: 'Radio Brianper', blurb: 'Mixed radio' },
  { id: '7nnjdGCdCe24vVeSlFpGQV', label: 'Electro Latino Mejores Temazos', blurb: 'Latin electro' },
  { id: '37i9dQZEVXbNFJfN1Vw8d9', label: 'Top 50 España', blurb: 'Spain chart' },
  { id: '2ASgmy04ZIcIXLBn8nkmKj', label: 'This is Duki (all songs)', blurb: 'Argentine trap' },
  { id: '37i9dQZEVXbMDoHDwVN2tF', label: 'Top 50 Global', blurb: 'Global chart' },
  { id: '37i9dQZF1DXaxEKcoCdWHD', label: 'Exitos España', blurb: 'Spanish hits' },
  { id: '37i9dQZF1DX0XUsuxWHRQd', label: 'RapCaviar', blurb: 'Hip-hop' },
];

export interface LandingScreenProps {
  /**
   * Fetch a deck for this URL. Receives the input's value RAW -- the server owns every question
   * about what a link means, and a client that normalised a little is how the two drift apart.
   */
  onSubmit: (url: string) => void;
  /**
   * The player's saved playlists, most-recent-first, from `playlist-library.ts` via the container.
   *
   * Playlist-level data only, which is what makes this section safe on a pre-start surface: an
   * entry is an id, a name and a timestamp, and the name is the same class of data the suggestions
   * below already show. Empty renders NOTHING -- see the section itself.
   */
  savedPlaylists?: readonly SavedPlaylist[];
  /** Forget one saved playlist. The container owns the storage write. */
  onRemoveSaved?: (id: string) => void;
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
  isLoading,
  errorCode,
  savedPlaylists = [],
  onRemoveSaved,
}: LandingScreenProps) {
  const [value, setValue] = useState('');
  /**
   * A client-side parse failure, kept SEPARATE from `errorCode`.
   *
   * Two sources of error with one slot to render them in, and the local one has to win while it
   * is set: a stale server error from a previous submission must not sit underneath a fresh "that
   * is not a playlist link". Clearing it on every edit is what keeps the two from fighting.
   */
  const [localErrorCode, setLocalErrorCode] = useState<StartFailureCode | undefined>(undefined);

  const shownErrorCode = localErrorCode ?? errorCode;

  const submit = (candidate: string) => {
    const trimmed = candidate.trim();

    // A short link cannot be parsed here -- only a redirect can resolve it -- so it skips
    // straight to the server. See the header block.
    if (!isSpotifyShortLink(trimmed)) {
      const parsed = parsePlaylistUrl(trimmed);
      if (!parsed.ok) {
        // NOT submitted: there is nothing for the server to add, and a round trip to be told the
        // same thing is just latency in front of the same sentence.
        setLocalErrorCode(parsed.code);
        return;
      }
    }

    setLocalErrorCode(undefined);
    onSubmit(trimmed);
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-page p-6 text-fg">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold">Playlist Hitster</h1>
        <p className="max-w-content text-sm text-fg-secondary">
          Paste a public Spotify playlist link to deal a deck. Scan a card to hear the song, then
          guess the year.
        </p>
      </div>

      <form
        className="flex w-full max-w-content flex-col gap-3"
        onSubmit={(event) => {
          // The page must not navigate: this is a single-page app and a real form submission
          // would reload it back to `idle`, throwing away the session that is being started.
          event.preventDefault();
          submit(value);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-fg-secondary">Playlist link</span>
          {/*
            ===================================================================
             NO `aria-label` ON THIS INPUT, AND ADDING ONE BACK IS A DEFECT.

             It carried `aria-label="Spotify playlist link"` through Phase 6,
             alongside the visible `Playlist link` above. `aria-label` WINS over
             a wrapping label, so the accessible name did not match the visible
             text -- which is a WCAG 2.5.3 (Label in Name) failure and breaks
             speech control outright: "click Playlist link" matched nothing on
             the screen, because the only name the browser knew was the hidden
             one.

             The wrapping `<label>` already supplies a correct name, so the
             attribute was redundant as well as harmful. `LandingScreen.test.tsx`
             queries by the VISIBLE text, which is the query that fails if the
             attribute ever comes back.
            ===================================================================
          */}
          <input
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              // Cleared on edit, not on submit: an error about the PREVIOUS value sitting beside
              // a half-typed new one reads as an error about what is currently in the box.
              setLocalErrorCode(undefined);
            }}
            placeholder="https://open.spotify.com/playlist/…"
            aria-invalid={shownErrorCode !== undefined}
            /*
              `aria-describedby` pointed at the error message WHILE ONE EXISTS, and undefined
              otherwise -- a describedby naming an element that is not in the document is a
              dangling reference some screen readers report as an error.

              `aria-invalid` alone was the Phase 6 state, and it says only THAT the value is
              wrong. The reason was announced once by `role="alert"` and then unreachable: a
              player who tabbed back to the field heard "invalid" and no explanation. This is
              what makes the reason available on focus as well as at the moment it arrives.
            */
            aria-describedby={shownErrorCode === undefined ? undefined : ERROR_MESSAGE_ID}
            /*
              `autoComplete="off"` and `spellCheck={false}`: this is a URL, and a spell-check
              underline plus an autofill dropdown over a pasted link is noise. `inputMode="url"`
              gets the right phone keyboard, which matters because a phone is the primary device.
            */
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            disabled={isLoading}
            className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-fg placeholder:text-fg-muted focus-visible:focus-ring disabled:opacity-(--opacity-disabled)"
          />
        </label>

        {shownErrorCode === undefined ? null : (
          /*
            `role="alert"` so the message is announced rather than only drawn -- a player using a
            screen reader otherwise gets no signal that a submission failed at all. The copy comes
            from the client-side map; the server's own `message` field is deliberately not
            rendered (see `messages.ts`).

            The `id` is the other half of the input's `aria-describedby`. Both exist only while
            there is an error, so the reference is never dangling.
          */
          <p id={ERROR_MESSAGE_ID} role="alert" className="text-sm text-danger">
            {playlistErrorMessage(shownErrorCode)}
          </p>
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
            primary action at 16px. The background is unchanged; only the label darkens, to
            5.40:1 at rest and 8.03:1 on hover.
          */
          className="touch-target rounded-lg bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
        >
          {isLoading ? 'Loading…' : 'Start'}
        </button>
      </form>

      {/*
        ===================================================================
         THE SAVED LIBRARY, AND THE EMPTY STATE IS *NOTHING AT ALL*.

         Not a placeholder, not "you have no saved playlists yet" (step 14). A
         first-time visitor already has the form and nine suggestions; a fourth
         block explaining an empty list is noise on the screen that has to make
         the app's one job obvious.

         Above the suggestions because these are the player's own, and in the
         same button shape so a click submits by exactly the path a suggestion
         does -- `spotifyPlaylistUrl(id)` through `submit`, which fills the input
         as well. There is no second entry into the session for a saved
         playlist.
        ===================================================================
      */}
      {savedPlaylists.length === 0 ? null : (
        <section className="flex w-full max-w-content flex-col gap-2">
          <h2 className="text-sm text-fg-secondary">Your playlists</h2>

          <ul className="flex flex-col gap-2">
            {savedPlaylists.map((saved) => (
              /*
                Two buttons side by side rather than a remove control INSIDE the play button: a
                nested button is invalid HTML and, more to the point, a press on the inner one
                would activate both -- the same class of bug that moved `CardControls` off the
                card in Phase 5.
              */
              <li key={saved.id} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const url = spotifyPlaylistUrl(saved.id);
                    setValue(url);
                    submit(url);
                  }}
                  disabled={isLoading}
                  className="flex flex-1 touch-target items-baseline gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-border-strong focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
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
                  <span className="text-sm">{saved.name}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onRemoveSaved?.(saved.id)}
                  disabled={isLoading}
                  /*
                    The name carries the playlist, because a screen with four rows of "Remove"
                    gives a screen-reader user no way to tell which one they are on. The ✕ is
                    `aria-hidden` decoration -- same split as `NoticeBanner`'s Dismiss.
                  */
                  aria-label={`Remove ${saved.name} from your playlists`}
                  className="touch-target rounded-lg border border-border px-3 text-fg-muted hover:border-border-strong hover:text-fg focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex w-full max-w-content flex-col gap-2">
        <h2 className="text-sm text-fg-secondary">Or try one of these</h2>

        <ul className="flex flex-col gap-2">
          {SUGGESTED_PLAYLISTS.map((playlist) => (
            <li key={playlist.id}>
              <button
                type="button"
                // Fills the input with the FULL link AND submits, so the suggestion behaves
                // exactly as if that link had been pasted -- including leaving it visible, which
                // is how a player learns what a valid link looks like. It used to fill in the
                // bare id, which parsed but taught the wrong shape.
                onClick={() => {
                  const url = spotifyPlaylistUrl(playlist.id);
                  setValue(url);
                  submit(url);
                }}
                disabled={isLoading}
                /*
                  `focus-visible`, not `focus`. These are the buttons that make the
                  distinction visible: they submit and the screen is replaced, so a `focus:` ring
                  would be the last thing a mouse user saw of the landing screen. With
                  `focus-visible` a click leaves no ring and a Tab still shows one.
                */
                className="flex w-full touch-target items-baseline justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-border-strong focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
              >
                <span className="text-sm">{playlist.label}</span>
                {/* Genre/era only. Never a track, an artist or a year -- see the header block. */}
                <span className="text-xs text-fg-muted">{playlist.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
