/**
 * The three things a deck can be turned into -- a link, a saved playlist, a printed sheet -- as one
 * component, so both screens that offer them offer exactly the same three.
 *
 * ===========================================================================
 *  EXTRACTED FROM `EndScreen` ON 2026-08-06, BECAUSE THE GAME SCREEN NOW
 *  OFFERS THEM TOO. THAT REVERSES HALF OF PLAN 2'S DECISION 7.
 *
 *  Decision 7 said the trigger belonged on the end screen AND NOWHERE ELSE,
 *  and it gave two reasons for keeping it off the game screen: a progress
 *  dialog over a live card is a spoiler risk, and it conflicts with the swipe.
 *  Neither reason survived contact with the actual complaint, which is that
 *  ENDING THE GAME IS THE ONLY WAY TO SHARE IT -- and ending the game is
 *  irreversible, so the price of copying a link was the deck.
 *
 *  Both reasons are answered rather than waved away:
 *
 *  - THE SPOILER RISK IS THE REASON EVERY MESSAGE HERE IS A COUNT. Nothing in
 *    this component renders a title, an artist or a year; the export reports
 *    `completed/total` and an EXCLUDED COUNT, and the share link names a
 *    playlist and a seed. `DeckActions.test.tsx` asserts that against the whole
 *    fixture deck, which is what makes this safe to mount beside an unflipped
 *    card rather than merely believed to be.
 *  - THE SWIPE CONFLICT IS ANSWERED BY WHERE IT MOUNTS, not by what it says:
 *    on the game screen this lives inside `DeckActionsDialog`, whose backdrop
 *    covers the card, and `GameScreen` suspends its own key handler while that
 *    dialog is open -- the same treatment `ExitConfirmDialog` gets, for the same
 *    reason. Nothing interactive is added inside `Card`, so the Phase 5
 *    tap-is-a-flip bug stays structurally impossible.
 * ===========================================================================
 *
 * Presentational like every other component here. It holds the copy's outcome and the export's
 * progress, which are both about a press that happened inside it, and it knows nothing about a
 * session: the playlist id, the seed and the deck all arrive as props.
 *
 * ===========================================================================
 *  THE SHARE LINK IS BUILT AT CLICK TIME, AND THAT IS NOT A MICRO-OPTIMISATION.
 *
 *  It is (playlist id + seed), and a RESTART DEALS A FRESH SEED. A link captured
 *  in a `useMemo` or in state at mount would therefore be the wrong link for any
 *  deck reached by pressing "Play again" -- it would point at the shuffle before
 *  it. Building inside the handler means the props read at that instant are the
 *  ones that go into the URL.
 *
 *  THE COPY MUST NOT PROMISE AN IDENTICAL DECK (decision 4). "Same playlist, same
 *  shuffle" is true. "The same deck" is not: yearless cards are dropped at play
 *  time and editorial playlists refresh, so the shuffle is exact while the list
 *  it shuffles is not. The caption under the button says so, and it is the honest
 *  alternative to the opaque token that could have pinned the card set.
 * ===========================================================================
 */

import { useState } from 'react';

import { buildDeckLink } from '../game/deck-link';
import { sheetsForDeck, usePdfExport } from '../hooks/usePdfExport';
import type { Card } from '../../shared/types';

export interface DeckActionsProps {
  /** The playlist's Spotify id, from `state.playlist`. One half of the share link. */
  playlistId: string;
  /** The playlist's name, from `state.playlist`. Playlist-level only -- never track data. */
  playlistName: string;
  /** The seed this deck was dealt with, from `state.seed`. The other half of the link. */
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
   *  not like. This is a button precisely so the player saves a playlist they
   *  chose to keep.
   * ===========================================================================
   */
  onSavePlaylist: () => void;
  /** True once this playlist is in the library. Turns the button into its own confirmation. */
  isPlaylistSaved: boolean;
  /**
   * The deck, for the printable export.
   *
   * ===========================================================================
   *  HOLDING THE DECK IS NOT THE SAME AS RENDERING IT, AND THE TEST IS THE PROOF.
   *
   *  Every pre-reveal surface in the app is handed counts and names rather than
   *  cards, and that rule is about the DOM: this component's own leak test
   *  asserts that no title, artist or year from the fixture deck reaches the
   *  document. The cards go into a PDF the player asked for, and nothing from
   *  them is rendered.
   * ===========================================================================
   */
  deck: readonly Card[];
}

/**
 * What the copy button last did. `idle` renders no message at all, which is what keeps a
 * `role="status"` region from announcing anything before it has news.
 */
type CopyState = 'idle' | 'copied' | 'failed';

/** Every button here is the app's secondary button. One string, so they cannot drift apart. */
const BUTTON_CLASSES =
  'touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg ' +
  'hover:border-border-hover focus-visible:focus-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

export function DeckActions({
  playlistId,
  playlistName,
  seed,
  shareOrigin,
  onSavePlaylist,
  isPlaylistSaved,
  deck,
}: DeckActionsProps) {
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
    <div className="flex flex-col gap-3">
      <button type="button" onClick={handleCopy} className={BUTTON_CLASSES}>
        Copy share link
      </button>

      {/*
        Deliberately careful wording. The seeded shuffle is exact; the track list it shuffles is
        not, because yearless cards are dropped at play time and editorial playlists refresh. See
        the header block -- promising "the same deck" here is the one thing this copy must not do.
      */}
      <p className="text-center text-xs text-fg-muted">
        Same playlist, same shuffle — the years are looked up again, so the deck can differ slightly
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
        className={BUTTON_CLASSES}
      >
        {isPlaylistSaved ? 'Saved to your playlists' : 'Save this playlist'}
      </button>

      <button
        type="button"
        onClick={() => exportDeck(deck, playlistName)}
        // Disabled only while working. A finished or failed export is repeatable -- the commonest
        // reason to press it twice is that the year of one more card arrived in the meantime.
        disabled={pdf.status === 'working'}
        className={BUTTON_CLASSES}
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

        Mid-game the count is a LIVE one: the deck's years are still arriving, so this climbs as
        `selectPrintableCards` finds more of them. That is honest rather than awkward -- it is
        exactly the number of cards a press right now would print.
      */}
      <p className="text-center text-xs text-fg-muted">
        {sheets === 1 ? '1 A4 sheet' : `${sheets} A4 sheets`}, 12 cards each — print double-sided on
        the long edge
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

      {/*
        One live region for both copy outcomes, and it exists only once there is something to say --
        `idle` renders nothing, so nothing is announced before the player presses anything. Safe
        even beside an unflipped card: a link names a playlist and a seed, never a track.
      */}
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
                an apology.
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
    </div>
  );
}
