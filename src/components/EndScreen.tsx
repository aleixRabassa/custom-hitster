/**
 * The end screen: how many cards were played, and the two ways onward.
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
 */

export interface EndScreenProps {
  /** The deck's size. A natural finish means every card was played, so this is `deck.length`. */
  cardsPlayed: number;
  /** The playlist just finished, from `state.playlist`. Playlist-level only -- no track data. */
  playlistName: string;
  /** Re-deal the same tracks in a fresh order. */
  onRestart: () => void;
  /** Back to the landing screen. */
  onNewPlaylist: () => void;
}

export function EndScreen({ cardsPlayed, playlistName, onRestart, onNewPlaylist }: EndScreenProps) {
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

        <button
          type="button"
          onClick={onNewPlaylist}
          className="touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring"
        >
          New playlist
        </button>
      </div>
    </main>
  );
}
