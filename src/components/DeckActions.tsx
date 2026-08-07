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
 *  THE COPY MUST NOT PROMISE AN IDENTICAL DECK (decision 4). "Same playlist(s),
 *  same shuffle" is true. "The same deck" is not, and it now has THREE reasons
 *  not to be: yearless cards are dropped at play time, editorial playlists
 *  refresh their tracks, and -- since multi-playlist -- a playlist that has gone
 *  private since the link was made is DROPPED WITH A NOTICE rather than blocking,
 *  so the recipient can get a strictly smaller deck than the sender had. The
 *  caption under the button says so, and it is the honest alternative to the
 *  opaque token that could have pinned the card set.
 * ===========================================================================
 */

import { useEffect, useRef, useState } from 'react';

import { Spinner } from './Spinner';
import { buildDeckLink } from '../game/deck-link';
import { sheetsForDeck, usePdfExport } from '../hooks/usePdfExport';
import type { Card } from '../../shared/types';

export interface DeckActionsProps {
  /**
   * The deck's 1..5 Spotify playlist ids, in row order. One half of the share link.
   *
   * The whole set, because a link that named only the first would deal a deck the sender never
   * played -- and `buildDeckLink` joins them with commas, which is the form `parseDeckLink` reads.
   */
  playlistIds: readonly string[];
  /** The deck's label, from `deckLabel()`. Playlist-level only -- never track data. */
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
  /**
   * How many cards are still waiting on a year lookup, from `pendingYearCount`.
   *
   * ===========================================================================
   *  THE PDF WAITS FOR THIS TO REACH ZERO. THE OTHER TWO ACTIONS DO NOT, AND
   *  THE ASYMMETRY IS THE POINT (2026-08-07).
   *
   *  A share link is (playlist id + seed) and a save is (id + name): both are
   *  complete the moment a deck exists, and both survive the years arriving
   *  afterwards because the recipient looks them up again. THE PDF IS THE ONE
   *  ARTEFACT THAT IS FINISHED WHEN IT IS MADE. Cards without a year are dropped
   *  from the sheet, so exporting mid-crawl prints a deck that is quietly short
   *  -- and the omission is discoverable only by counting a stack of printed
   *  paper, after the ink.
   *
   *  So a press with lookups outstanding does not export and does not refuse: it
   *  WAITS, on a screen shaped like the one that dealt the deck, and exports
   *  itself the moment the last year lands. `pendingYearCount === 0` is exactly
   *  "every card in this deck can be printed", because a lookup that finds
   *  nothing removes its card rather than leaving it yearless.
   *
   *  Zero on the end screen in the ordinary case, so nothing changes there.
   * ===========================================================================
   */
  pendingYearCount: number;
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
  playlistIds,
  playlistName,
  seed,
  shareOrigin,
  onSavePlaylist,
  isPlaylistSaved,
  deck,
  pendingYearCount,
}: DeckActionsProps) {
  const { state: pdf, exportDeck } = usePdfExport();
  const sheets = sheetsForDeck(deck);
  const isDeckResolved = pendingYearCount === 0;

  /**
   * Whether the player has ASKED to print. Not whether they are waiting -- see below.
   *
   * A boolean rather than a fourth `PdfExportStatus`, deliberately: `usePdfExport` describes work
   * the HOOK is doing, and this describes work it has not been asked to start. Putting it in that
   * union would mean the hook owning a condition it cannot observe, and every existing branch
   * having to say what it does about it.
   */
  const [hasAskedToPrint, setHasAskedToPrint] = useState(false);

  /**
   * The wait is DERIVED, not stored, and that is what keeps the effect below free of `setState`.
   *
   * The obvious shape is an `isWaiting` flag the effect clears when the last year lands -- and
   * `react-hooks/set-state-in-effect` rejects it, correctly: clearing state from an effect is a
   * cascading render, and the state was redundant anyway. "The player asked, and the deck is not
   * ready" is a fact about two values that are already here. The wait therefore ENDS BY ITSELF, on
   * the render where `pendingYearCount` reaches zero, with nothing to keep in step.
   */
  const isWaitingForYears = hasAskedToPrint && !isDeckResolved;

  /**
   * The wait's Cancel button, so focus can follow the view.
   *
   * Pressing Print unmounts the button that was focused. Without this, focus falls to `<body>`, and
   * inside `DeckActionsDialog` that also means the Tab trap has nothing to cycle FROM -- the panel
   * would still hold focus, but a keyboard player would have lost their place in it.
   */
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isWaitingForYears) cancelRef.current?.focus();
  }, [isWaitingForYears]);

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
    // Built here, from the props as they are NOW -- every id, in row order. See the header block.
    const link = buildDeckLink(shareOrigin, playlistIds, seed);

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

  /**
   * Print, or start waiting for the years that make printing honest.
   *
   * The gate is checked HERE rather than by disabling the button, because a disabled Print with no
   * explanation is indistinguishable from a broken one -- and the explanation ("6 cards are still
   * looking up a year") is a sentence nobody reads off a greyed-out control.
   */
  const handlePrint = () => {
    if (!isDeckResolved) {
      hasAutoExportedRef.current = false;
      setHasAskedToPrint(true);
      return;
    }

    exportDeck(deck, playlistName);
  };

  /**
   * Whether the wait that is currently running has already handed off to the export.
   *
   * The effect below cannot clear `hasAskedToPrint` to make itself idempotent -- that is the
   * `setState`-in-an-effect the derivation above exists to avoid -- so the guard is a ref instead.
   * Reset when a NEW wait begins, in `handlePrint`.
   */
  const hasAutoExportedRef = useRef(false);

  /**
   * The last year landed while the player was waiting: export now.
   *
   * ===========================================================================
   *  THE DEPENDENCIES LOOK UNSTABLE AND THE EXPORT STILL HAPPENS ONCE.
   *
   *  `deck` is a NEW ARRAY on every resolved year -- the reducer rebuilds it --
   *  so this effect re-runs perhaps a hundred times during a crawl. Every one of
   *  those runs returns at the first line, because `hasAskedToPrint` is false
   *  unless the player pressed Print and `pendingYearCount` is above zero until
   *  the crawl ends. The ref then closes the remaining case: `hasAskedToPrint`
   *  STAYS true after the handoff (nothing clears it), so without the ref a
   *  later re-render with a fresh `deck` identity would export a second time.
   *  `exportDeck`'s own generation counter is a third line of defence rather
   *  than the first.
   *
   *  StrictMode is not a hazard for a different reason again: this is an UPDATE
   *  effect, React double-invokes on MOUNT, and on mount the flag is false.
   * ===========================================================================
   */
  useEffect(() => {
    if (!hasAskedToPrint || pendingYearCount > 0 || hasAutoExportedRef.current) return;

    hasAutoExportedRef.current = true;
    exportDeck(deck, playlistName);
  }, [hasAskedToPrint, pendingYearCount, exportDeck, deck, playlistName]);

  /**
   * The wait, shaped like the screen that dealt the deck.
   *
   * It REPLACES the three actions rather than sitting under them, which is the honest shape: this
   * is a job the player started and is now watching, not a fourth thing they can do. Cancel is
   * inside it because the end screen has no other way out -- the game screen's dialog has its own
   * Close, but this component cannot assume one exists.
   *
   * A COUNT, never a list. The cards still looking up a year are the ones whose answer the player
   * has not seen, so naming one here would spoil the card they are looking at.
   */
  if (isWaitingForYears) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-2 text-center">
        <Spinner />

        <p className="text-sm font-medium text-fg">Waiting for the last years…</p>

        {/*
          Says what the wait actually is, in the same spirit as the preparing screen's second line.
          The crawl is paced at one lookup a second by the shared rate gate, so a number here is a
          rough number of seconds -- which is the only honest expectation available.
        */}
        <p className="max-w-narrow text-xs text-fg-muted">
          {pendingYearCount === 1 ? '1 card is' : `${pendingYearCount} cards are`} still looking up
          a year.
        </p>

        {/*
          Takes focus when the wait begins -- see `cancelRef`. The button that was focused (Print)
          has just been unmounted, and focus falling to `<body>` would leave a keyboard player with
          nothing selected in a panel they cannot see the state of.
        */}
        <button
          ref={cancelRef}
          type="button"
          onClick={() => {
            setHasAskedToPrint(false);
          }}
          className={BUTTON_CLASSES}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={handleCopy} className={BUTTON_CLASSES}>
        Copy share link
      </button>

      {/*
        Deliberately careful wording. The seeded shuffle is exact; the track list it shuffles is
        not, because yearless cards are dropped at play time, editorial playlists refresh, and a
        playlist that has gone private since is dropped with a notice. See the header block --
        promising "the same deck" here is the one thing this copy must not do.

        Pluralised on the id count rather than left as "playlist(s)": the caption is the sentence
        that has to be read and believed, and a slash in it reads as boilerplate.
      */}
      <p className="text-center text-xs text-fg-muted">
        {playlistIds.length === 1 ? 'Same playlist' : 'Same playlists'}, same shuffle — the years
        are looked up again, so the deck can differ slightly
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
        // Never disabled by the year gate -- see `handlePrint`. Disabled only while working: a
        // finished or failed export is repeatable, and the commonest reason to press it twice is a
        // printer that ate the first one.
        onClick={handlePrint}
        disabled={pdf.status === 'working'}
        className={BUTTON_CLASSES}
      >
        {pdf.status === 'working'
          ? `Building PDF… ${pdf.completed}/${pdf.total}`
          : 'Print as PDF cards'}
      </button>

      {/*
        Two different sentences, because there are two different things worth knowing before the
        press.

        RESOLVED: the sheet count and the duplex setting. Nine sheets is a thing to know before
        committing paper, and the binding edge is the one instruction that decides whether the sheet
        is usable at all -- `pdf-sheet.ts` mirrors the columns for LONG-edge binding, and short-edge
        would invert the correction, so it is named here rather than guessed at in code.

        PENDING: no sheet count at all. `sheetsForDeck` counts only the cards that already have a
        year, so mid-crawl it is a number that would climb while the player read it -- and since the
        press now WAITS for the rest, it would also be describing a deck nobody is going to print.
        Saying what the press will do is more useful than a figure that is about to be wrong.
      */}
      <p className="text-center text-xs text-fg-muted">
        {isDeckResolved
          ? `${sheets === 1 ? '1 A4 sheet' : `${sheets} A4 sheets`}, 12 cards each — print double-sided on the long edge`
          : `${pendingYearCount === 1 ? '1 card is' : `${pendingYearCount} cards are`} still looking up a year — printing waits for them all`}
      </p>

      {/*
        The export's own live region, separate from the copy's: the two can both have news, and one
        region rewritten by two features announces the wrong thing at the wrong time. Every message
        here is a COUNT -- never the title of an excluded card (step 20).

        The `excludedCount` and `nothing-to-print` branches survived the year gate and are NOT dead
        code: the gate waits for `year === undefined` to clear, while `selectPrintableCards` also
        drops `year === null`. A live deck holds no null years since the 2026-08-05 reversal, but a
        RESUMED pre-reversal save does -- so the two conditions are not the same condition.
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
