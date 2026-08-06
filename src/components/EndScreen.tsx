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
 * ===========================================================================
 *  THE SHARE LINK IS BUILT AT CLICK TIME, AND THAT IS NOT A MICRO-OPTIMISATION.
 *
 *  It is (playlist id + seed), and RESTART DEALS A FRESH SEED. A link captured in
 *  a `useMemo` or in state at mount would therefore be the wrong link for any
 *  deck reached by pressing "Play again" -- it would point at the shuffle before
 *  it. Building inside the handler means the props read at that instant are the
 *  ones that go into the URL.
 *
 *  THE COPY MUST NOT PROMISE AN IDENTICAL DECK (decision 4). "Same playlist, same
 *  shuffle" is true. "The same deck" is not: yearless cards are dropped at play
 *  time and editorial playlists refresh, so the shuffle is exact while the list it
 *  shuffles is not. The caption under the button says so, and it is the honest
 *  alternative to the opaque token that could have pinned the card set.
 *
 *  The link is leak-free: it names a playlist and a seed, never a track. That is
 *  what makes the `role="status"` confirmation below safe on a screen that is
 *  one press away from re-dealing the same cards.
 * ===========================================================================
 */

import { useState } from 'react';

import { buildDeckLink } from '../game/deck-link';
import { sheetsForDeck, usePdfExport } from '../hooks/usePdfExport';
import type { Card } from '../../shared/types';

export interface EndScreenProps {
  /** The deck's size. A natural finish means every card was played, so this is `deck.length`. */
  cardsPlayed: number;
  /** The playlist just finished, from `state.playlist`. Playlist-level only -- no track data. */
  playlistName: string;
  /** Re-deal the same tracks in a fresh order. */
  onRestart: () => void;
  /** Back to the landing screen. */
  onNewPlaylist: () => void;
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
   * The deck just played, for the printable export.
   *
   * ===========================================================================
   *  THIS IS THE ONE SCREEN THAT MAY HOLD THE DECK, AND THE EXPORT IS WHY.
   *
   *  Every other pre-reveal surface in the app is handed counts and names rather
   *  than cards, and this screen's own leak test asserts that no title or artist
   *  is RENDERED. Both stay true: the deck goes into a PDF the player asked for,
   *  and nothing from it reaches the DOM.
   *
   *  The trigger is here and nowhere else (step 21, decision 7). Not the landing
   *  screen -- there is no deck. Not the game screen -- a progress dialog over a
   *  live card is a spoiler risk and an interaction conflict with the swipe.
   * ===========================================================================
   */
  deck: readonly Card[];
}

/**
 * What the copy button last did. `idle` renders no message at all, which is what keeps a
 * `role="status"` region from announcing anything before it has news.
 */
type CopyState = 'idle' | 'copied' | 'failed';

export function EndScreen({
  cardsPlayed,
  playlistName,
  onRestart,
  onNewPlaylist,
  playlistId,
  seed,
  shareOrigin,
  onSavePlaylist,
  isPlaylistSaved,
  deck,
}: EndScreenProps) {
  const { state: pdf, exportDeck } = usePdfExport();
  const sheets = sheetsForDeck(deck);

  const [copyState, setCopyState] = useState<CopyState>('idle');
  /**
   * The link, held only once a copy has FAILED.
   *
   * The fallback is the whole point: `navigator.clipboard` needs a secure context and can reject
   * for reasons the player cannot do anything about (an insecure origin, a denied permission, a
   * browser that has no clipboard API at all). A silent no-op there would look like a broken
   * button, so the link is rendered as selectable text instead and the player copies it by hand.
   */
  const [failedLink, setFailedLink] = useState<string | null>(null);

  const handleCopy = () => {
    // Built here, from the props as they are NOW. See the header block.
    const link = buildDeckLink(shareOrigin, playlistId, seed);

    const fail = () => {
      setCopyState('failed');
      setFailedLink(link);
    };

    // `navigator.clipboard` is `undefined` outside a secure context, so this is an existence check
    // rather than defensive padding -- reading `.writeText` off it would throw.
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      fail();
      return;
    }

    clipboard.writeText(link).then(() => {
      setCopyState('copied');
      setFailedLink(null);
    }, fail);
  };

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

      {/*
        The three things a finished deck can become, kept visually secondary to the two ways onward
        above: they are what a player does with a deck they liked, not what they do next.
      */}
      <section className="flex w-full max-w-content flex-col gap-3">
        <h2 className="text-sm text-fg-secondary">Keep this deck</h2>

        <button
          type="button"
          onClick={handleCopy}
          className="touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring"
        >
          Copy share link
        </button>

        {/*
          Deliberately careful wording. The seeded shuffle is exact; the track list it shuffles is
          not, because yearless cards are dropped at play time and editorial playlists refresh. See
          the header block -- promising "the same deck" here is the one thing this copy must not do.
        */}
        <p className="text-center text-xs text-fg-muted">
          Same playlist, same shuffle — the years are looked up again, so the deck can differ
          slightly
        </p>

        <button
          type="button"
          onClick={onSavePlaylist}
          /*
            Disabled once it is saved rather than hidden, and the LABEL is the confirmation: a
            button that vanishes on press leaves the player unsure whether it worked, and a second
            press would only re-stamp the same entry's timestamp (`savePlaylist` dedupes by id).
          */
          disabled={isPlaylistSaved}
          className="touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
        >
          {isPlaylistSaved ? 'Saved to your playlists' : 'Save this playlist'}
        </button>

        {/*
          One live region for both outcomes, and it exists only once there is something to say --
          `idle` renders nothing, so nothing is announced before the player presses anything. Safe
          on this screen for the reason in the header: a link names a playlist and a seed, never a
          track.
        */}
        <button
          type="button"
          onClick={() => exportDeck(deck, playlistName)}
          // Disabled only while working. A finished or failed export is repeatable -- the commonest
          // reason to press it twice is that the year of one more card arrived in the meantime.
          disabled={pdf.status === 'working'}
          className="touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
        >
          {pdf.status === 'working'
            ? `Building PDF… ${pdf.completed}/${pdf.total}`
            : 'Print as PDF cards'}
        </button>

        {/*
          Said BEFORE the press, not after: nine sheets is a thing to know before committing paper,
          and the duplex setting is the one instruction that decides whether the sheet is usable at
          all. `pdf-sheet.ts` mirrors the columns for LONG-edge binding, and short-edge would invert
          the correction -- so the setting is named here rather than guessed at in code.
        */}
        <p className="text-center text-xs text-fg-muted">
          {sheets === 1 ? '1 A4 sheet' : `${sheets} A4 sheets`}, 12 cards each — print double-sided
          on the long edge
        </p>

        {/*
          The export's own live region, separate from the copy's: the two can both have news, and one
          region rewritten by two features announces the wrong thing at the wrong time. Every message
          here is a COUNT -- never the title of an excluded card (step 20).
        */}
        {pdf.status === 'idle' || pdf.status === 'working' ? null : (
          <p
            role="status"
            className={`text-center text-xs ${pdf.status === 'done' ? 'text-fg-secondary' : 'text-warning'}`}
          >
            {pdf.status === 'done'
              ? pdf.excludedCount === 0
                ? 'PDF downloaded'
                : `PDF downloaded — ${pdf.excludedCount} ${pdf.excludedCount === 1 ? 'card' : 'cards'} left out, no year yet`
              : pdf.status === 'nothing-to-print'
                ? 'No card has a year yet, so there is nothing to print'
                : 'Could not build the PDF'}
          </p>
        )}

        {copyState === 'idle' ? null : (
          <div role="status" className="flex flex-col gap-2">
            {copyState === 'copied' ? (
              <p className="text-center text-xs text-fg-secondary">Link copied</p>
            ) : (
              <>
                <p className="text-center text-xs text-warning">
                  Could not copy automatically — here is the link
                </p>
                {/*
                  `readOnly` and not a `<p>`: a text input can be selected with one keystroke and
                  is reachable by a keyboard, which is what makes this a real fallback rather than
                  an apology. `break-all` because the link is long and must not widen the layout.
                */}
                <input
                  type="text"
                  readOnly
                  value={failedLink ?? ''}
                  aria-label="Share link"
                  onFocus={(event) => event.currentTarget.select()}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg focus-visible:focus-ring"
                />
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
