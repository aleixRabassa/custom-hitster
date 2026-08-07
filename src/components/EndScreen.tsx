/**
 * The end screen: how many cards were played, the two ways onward, and the three things a
 * finished deck can be turned into — a link, a saved playlist, a printed deck.
 *
 * Reached only when the deck RAN OUT. An Exit mid-deck also produces `status: 'ended'` -- the
 * reducer cannot tell the two apart, which is exactly why the container carries an end-reason flag
 * (decision 2) -- and the container routes an exit to the landing screen instead. So this screen
 * never has to answer "what does cards played mean if they quit early": the case does not reach it.
 *
 * ## Restart costs zero lookups, and that is the point
 *
 * Restart re-deals `state.deck` with a fresh seed rather than re-fetching the playlist. The already
 * resolved years travel with the cards, so a rematch spends nothing from MusicBrainz's global
 * budget -- and it works after a RESUMED session too, where the original `/api/playlist` response
 * no longer exists anywhere in memory (decision 10).
 *
 * ## The three deck actions are no longer this screen's, and that is the 2026-08-06 reversal
 *
 * They live in `DeckActions`, which the game screen also mounts (behind `DeckActionsDialog`). Plan
 * 2's decision 7 put the trigger here AND NOWHERE ELSE; the complaint that reversed it is that
 * ending the game was the only way to reach it, and ending the game is irreversible. Both of that
 * decision's reasons are answered in `DeckActions`' header rather than dropped.
 */

import { DeckActions } from './DeckActions';
import type { Card } from '../../shared/types';

export interface EndScreenProps {
  /** The deck's size. A natural finish means every card was played, so this is `deck.length`. */
  cardsPlayed: number;
  /** The playlist just finished, from `state.playlist`. Playlist-level only -- no track data. */
  playlistName: string;
  /** Re-deal the same tracks in a fresh order. */
  onRestart: () => void;
  /**
   * Back to the landing screen.
   *
   * The button says "Home" rather than "New playlist" (2026-08-06): the landing screen is where the
   * saved-playlist library lives and where a share link is pasted, so "new playlist" named only one
   * of the three things pressing it is for. The container's `EndedView` flag is unchanged -- it was
   * already phrased as the DESTINATION `landing` rather than as a reason, which is why the rename
   * is a label and a prop name and nothing else.
   */
  onHome: () => void;
  /** The playlist's Spotify id, from `state.playlist`. One half of the share link. */
  playlistId: string;
  /** The seed this deck was dealt with, from `state.seed`. The other half. */
  seed: string;
  /** Where the link should point -- `origin + pathname`, supplied by the container. */
  shareOrigin: string;
  /**
   * Save this playlist to the landing screen's library.
   *
   * ===========================================================================
   *  SAVING IS EXPLICIT, AND THAT IS DECISION 10 RATHER THAN AN OMISSION.
   *
   *  Auto-saving every URL anyone pastes turns the landing screen into a history
   *  log nobody asked for -- including the playlist somebody tried once and did
   *  not like. This button is on the END screen precisely so the player saves a
   *  playlist they actually played through.
   * ===========================================================================
   */
  onSavePlaylist: () => void;
  /** True once this playlist is in the library. Turns the button into its own confirmation. */
  isPlaylistSaved: boolean;
  /**
   * The deck just played, for the printable export. Passed straight through to `DeckActions`.
   *
   * Holding it is not rendering it: this screen's own leak test asserts that no title or artist
   * reaches the DOM, and the cards go into a PDF the player asked for.
   */
  deck: readonly Card[];
  /**
   * Lookups still in flight, from `pendingYearCount`. Straight through to `DeckActions`, which
   * makes the PDF export wait for it to reach zero.
   *
   * Usually zero by the time this screen renders -- a deck that ran out has had the whole game to
   * finish its crawl -- but not always: a player who swipes fast can outrun the 1 req/s gate.
   */
  pendingYearCount: number;
}

export function EndScreen({
  cardsPlayed,
  playlistName,
  onRestart,
  onHome,
  playlistId,
  seed,
  shareOrigin,
  onSavePlaylist,
  isPlaylistSaved,
  deck,
  pendingYearCount,
}: EndScreenProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-page p-6 text-fg">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold">Deck finished</h1>
        <p className="text-sm text-fg-secondary">
          {cardsPlayed === 1 ? '1 card played' : `${cardsPlayed} cards played`} from {playlistName}
        </p>
      </div>

      <div className="flex w-full max-w-content flex-col gap-3">
        <button
          type="button"
          onClick={onRestart}
          // `text-on-accent`, not `text-white`: see `LandingScreen`'s Start button. White on the
          // accent measured 3.67:1 and is a 1.4.3 failure; the background is unchanged.
          className="touch-target rounded-lg bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover focus-visible:focus-ring"
        >
          Play again
        </button>

        {/*
          Worth saying out loud: a player who has just heard forty songs wants to know whether
          "play again" means the same order. It does not -- a fresh seed reshuffles.
        */}
        <p className="text-center text-xs text-fg-muted">Same tracks, new order</p>

        {/*
          "Home", not "New playlist": the landing screen is also where the saved-playlist library
          is and where a shared link is pasted, so naming it after only one of those understated
          where the button goes. See the prop's doc block.
        */}
        <button
          type="button"
          onClick={onHome}
          className="touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring"
        >
          Home
        </button>
      </div>

      {/*
        The three things a finished deck can become, kept visually secondary to the two ways onward
        above: they are what a player does with a deck they liked, not what they do next.

        The same component the game screen mounts inside `DeckActionsDialog`, so the two offer
        exactly the same three actions with exactly the same copy -- which is the point of the
        extraction rather than a side effect of it.
      */}
      <section className="flex w-full max-w-content flex-col gap-3">
        <h2 className="text-sm text-fg-secondary">Keep this deck</h2>

        <DeckActions
          playlistId={playlistId}
          playlistName={playlistName}
          seed={seed}
          shareOrigin={shareOrigin}
          onSavePlaylist={onSavePlaylist}
          isPlaylistSaved={isPlaylistSaved}
          deck={deck}
          pendingYearCount={pendingYearCount}
        />
      </section>
    </main>
  );
}
