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
 *    `completed/total` and an EXCLUDED COUNT, and the share link names the
 *    playlists and a seed -- plus, MID-GAME ONLY since
 *    2026-09-29, the current card's TRACK ID (see `currentCardId`). That id is
 *    the one piece of card data this component can put in the DOM, and only in
 *    the copy-failed fallback's `value`. It is not new information -- the QR on
 *    the card the player is looking at already encodes exactly that id -- and it
 *    is not a title, an artist or a year. `DeckActions.test.tsx` asserts those
 *    three against the whole fixture deck, which is what makes this safe to
 *    mount beside an unflipped card rather than merely believed to be.
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
 *  It is (playlist ids + seed, and mid-game the current card),
 *  and a RESTART DEALS A FRESH SEED. A link captured in a `useMemo` or in state
 *  at mount would therefore be the wrong link for any deck reached by pressing
 *  "Play again" -- it would point at the shuffle before it -- and mid-game it
 *  would name a card the player has since swiped past. Building inside the
 *  handler means the props read at that instant are the ones that go into the
 *  URL.
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
import type { ReactNode } from 'react';

import { OPTION_GROUP_CLASS_NAME, OptionCheckbox } from './OptionCheckbox';
import { Spinner } from './Spinner';
import { useCopy } from '../hooks/useLocale';
import { buildDeckLink } from '../game/deck-link';
import { sheetsForDeck, usePdfExport } from '../hooks/usePdfExport';
import type { PdfExportState } from '../hooks/usePdfExport';
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
  /**
   * The track id of the card the player is on, or absent (2026-09-29, D3).
   *
   * ===========================================================================
   *  PRESENT MID-GAME ONLY, AND THE END SCREEN'S ABSENCE IS THE DECISION.
   *
   *  A link carrying it starts the recipient on that card instead of card 1.
   *  The end screen passes nothing: the deck has run out, the reducer leaves
   *  `currentIndex` on the LAST card, and a position there would drop the
   *  recipient on the final card of a deck they have never played.
   *
   *  A track ID, never an index: the sender's deck has already shed its yearless
   *  cards while the recipient starts from the full fetch, so an index would
   *  land on a different card. It is the one card-derived value this component
   *  holds, and it can reach the DOM only through the copy-failed fallback's
   *  `value` -- see the header block for why that is not a leak.
   * ===========================================================================
   */
  currentCardId?: string;
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
   *  "nothing printed can still change": a PROVISIONAL year counts as pending
   *  there, so the wait also covers verification (plan.year-fetch-rework-game.md),
   *  and a final "no year" either removes its card or -- when the session keeps
   *  yearless cards -- is itself final.
   *
   *  The wait offers "PRINT SO FAR" (2026-08-07), which is the informed version
   *  of the thing the gate rules out: it exports the resolved cards NOW, says how
   *  many were left out, and leaves the wait running so the complete deck still
   *  arrives. What the gate refuses is a short deck nobody was told about.
   *
   *  Zero on the end screen in the ordinary case, so nothing changes there.
   * ===========================================================================
   */
  pendingYearCount: number;
  /**
   * Whether this SESSION keeps cards with no year found, from `state.keepYearless`.
   *
   * The session's value, never the picker's current preference: a player who changes the checkbox
   * after dealing has not changed the deck they are holding, and the sheet count above the press
   * has to describe the file the press produces. On, a final `year: null` card is printed with its
   * year left blank (`usePdfExport`'s `drawBack`); off, it is left out and counted like any other
   * excluded card. A provisional year is left out either way.
   */
  keepYearless: boolean;
  /**
   * Whether this SESSION drops cards with an unconfirmed year, from `state.skipUnconfirmed`
   * (the picker's "Deal cards with an unconfirmed year", UNticked).
   *
   * On, the print view does not offer "Leave unconfirmed years blank" (2026-10-01, the developer's
   * call): the session has already removed every card whose final year is `low`, so the box would
   * change nothing in the file -- a control with no effect. The one exception is a card marked
   * `yearUnverified`, which the session keeps (its year could not be checked, see `Card`): while the
   * deck holds one, the box can blank it, so it is offered. The session's value, never the picker's
   * current preference, for the same reason as `keepYearless`.
   */
  skipUnconfirmed: boolean;
  /**
   * The host's heading for the view on show, or nothing (2026-10-01).
   *
   * The print view is titled "Print this deck" while it is open, and only then -- the developer's
   * choice: the panel keeps its own title ("Keep this deck") for the three actions. The heading is
   * the HOST's element (the dialog's `<h2>` is what its `aria-labelledby` names; the end screen's
   * is a small section heading), so this component cannot render it; and the view is THIS
   * component's state, so the host cannot know it without a second copy that could disagree. A
   * render prop is the one shape with a single owner for each half. Rendered as the first sibling
   * of the view, inside a fragment, so the host's own flex gap sits between the two exactly as it
   * did when the heading was the host's child.
   */
  renderHeading?: (view: DeckActionsView) => ReactNode;
}

/**
 * Which of the two views is on show: the three actions, or the print view that the Print press
 * opens (2026-10-01).
 */
export type DeckActionsView = 'actions' | 'print';

/**
 * What the copy button last did. `idle` renders no message at all, which is what keeps a
 * `role="status"` region from announcing anything before it has news.
 */
type CopyState = 'idle' | 'copied' | 'failed';

/**
 * What the last export did, or nothing at all.
 *
 * ===========================================================================
 *  THE EXPORT'S OWN LIVE REGION, SEPARATE FROM THE COPY'S: the two can both
 *  have news, and one region rewritten by two features announces the wrong
 *  thing at the wrong time. Every message here is a COUNT -- never the title of
 *  an excluded card (step 20).
 *
 *  Extracted from the resolved view on 2026-08-07 because "Print so far" gave
 *  the WAIT an export to report too, and a partial export is precisely the case
 *  the excluded count was written for. One component, so the two views cannot
 *  describe the same `PdfExportState` in two different sets of words.
 *
 *  The `excludedCount` and `nothing-to-print` branches survived the year gate
 *  and are NOT dead code: the gate waits for pending AND provisional years to
 *  clear, while `selectPrintableCards` also drops `year === null` unless the
 *  session keeps yearless cards. With the option off a live deck holds no null
 *  years since the 2026-08-05 reversal, but a RESUMED pre-reversal save does --
 *  so the two conditions are not the same condition. Under "Print so far" both
 *  are ordinary rather than residual, and a provisional card is always among
 *  the excluded.
 * ===========================================================================
 */
function ExportMessage({ state }: { state: PdfExportState }) {
  const copy = useCopy();
  // `idle` and `working` say nothing: the button label is already carrying the progress, and an
  // empty region is what keeps this from announcing before it has news.
  if (state.status === 'idle' || state.status === 'working') return null;

  return (
    <p
      role="status"
      className={`text-center text-xs ${state.status === 'done' ? 'text-fg-secondary' : 'text-warning'}`}
    >
      {state.status === 'done'
        ? state.excludedCount === 0
          ? copy.deckActions.exportDone
          : copy.deckActions.exportDonePartial(state.excludedCount)
        : state.status === 'nothing-to-print'
          ? copy.deckActions.exportEmpty
          : copy.deckActions.exportFailed}
    </p>
  );
}

/** Every button here is the app's secondary button. One string, so they cannot drift apart. */
const BUTTON_CLASSES =
  'touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg ' +
  'hover:border-border-hover focus-visible:focus-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

export function DeckActions({
  playlistIds,
  playlistName,
  seed,
  currentCardId,
  shareOrigin,
  onSavePlaylist,
  isPlaylistSaved,
  deck,
  pendingYearCount,
  keepYearless,
  skipUnconfirmed,
  renderHeading,
}: DeckActionsProps) {
  const copy = useCopy();
  const { state: pdf, exportDeck } = usePdfExport(keepYearless);
  const sheets = sheetsForDeck(deck, keepYearless);
  const isDeckResolved = pendingYearCount === 0;
  const offersBlankUnconfirmed =
    !skipUnconfirmed || deck.some((card) => card.yearUnverified === true);

  /**
   * "Leave unconfirmed years blank" (2026-10-01): print a card whose final year no second provider
   * confirmed with its year area EMPTY, for the player to write in by hand -- the same blank a kept
   * yearless card already prints with. Local state, default OFF, and NOT remembered: it is a choice
   * about the next file, not about the game, so it resets with the panel. It lives in the PRINT
   * VIEW, beside the presses it qualifies; the wait's auto-export reads it at the moment it fires.
   */
  const [blankUnconfirmed, setBlankUnconfirmed] = useState(false);

  /**
   * Whether the print view is open (2026-10-01, the developer's request).
   *
   * ===========================================================================
   *  PRINT ALWAYS OPENS A VIEW NOW -- EVEN ON A RESOLVED DECK, WHERE IT USED TO
   *  EXPORT AT ONCE.
   *
   *  The blank-years option was asked to sit beside "Print so far", i.e. in the
   *  wait. But the wait is reached only while years are pending, so on a deck
   *  that was already resolved the option would have been unreachable. The
   *  developer chose the extra press over that: Print opens "Print this deck",
   *  which holds the option and the sheet count (resolved) or the wait and
   *  "Print so far" (pending), plus the one press that exports, and Cancel.
   * ===========================================================================
   */
  const [isPrintViewOpen, setIsPrintViewOpen] = useState(false);

  /**
   * Whether the player has ASKED to print. Not whether they are waiting -- see below.
   *
   * Since 2026-10-01 that is "opened the print view while years were pending": the view's opening
   * is the press that used to start the wait, and the wait still exports by itself when the last
   * year lands. Opened on a resolved deck it stays false -- the view's own button is the press.
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
   *
   * It does not also read `isPrintViewOpen`: `hasAskedToPrint` is set only while opening the view
   * and cleared only while closing it, so it already implies the view is open.
   */
  const isWaitingForYears = hasAskedToPrint && !isDeckResolved;

  /**
   * The wait's Cancel button, so focus can follow the view.
   *
   * Pressing Print unmounts the button that was focused. Without this, focus falls to `<body>`, and
   * inside `DeckActionsDialog` that also means the Tab trap has nothing to cycle FROM -- the panel
   * would still hold focus, but a keyboard player would have lost their place in it.
   *
   * Cancel rather than the "Print so far" beside it, even though the dialog's own convention is that
   * the first ACTION takes focus: an Enter pressed reflexively on arrival should not spend paper on a
   * deck that is still filling in. Cancel is the reversible one -- Print is still one Tab away.
   */
  const cancelRef = useRef<HTMLButtonElement>(null);
  /**
   * And the actions view's Print, for the way back: Cancel unmounts the print view, and focus
   * falling to `<body>` there is the same lost place the paragraph above prevents on the way in.
   */
  const printButtonRef = useRef<HTMLButtonElement>(null);
  /**
   * The fallback for that: Print is DISABLED while an export started in the print view is still
   * working, and `.focus()` on a disabled button is a silent no-op -- so a Cancel pressed mid-export
   * would drop focus to `<body>` after all. The copy button is never disabled.
   */
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const wasPrintViewOpenRef = useRef(false);
  useEffect(() => {
    if (isPrintViewOpen) {
      cancelRef.current?.focus();
    } else if (wasPrintViewOpenRef.current) {
      const print = printButtonRef.current;
      if (print && !print.disabled) print.focus();
      else copyButtonRef.current?.focus();
    }
    wasPrintViewOpenRef.current = isPrintViewOpen;
  }, [isPrintViewOpen]);

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
    // Built here, from the props as they are NOW -- every id, in row order, and the card the player
    // is on at the moment of the press (a card advance re-renders this with a new id). See the
    // header block.
    const link = buildDeckLink(
      shareOrigin,
      playlistIds,
      seed,
      currentCardId === undefined ? {} : { cardId: currentCardId },
    );

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
   * Open the print view, and -- with years still pending -- start waiting for the ones that make
   * printing honest.
   *
   * The gate is checked HERE rather than by disabling the button, because a disabled Print with no
   * explanation is indistinguishable from a broken one -- and the explanation ("6 cards are still
   * looking up a year") is a sentence nobody reads off a greyed-out control.
   */
  const handleOpenPrintView = () => {
    setIsPrintViewOpen(true);
    if (!isDeckResolved) {
      hasAutoExportedRef.current = false;
      setHasAskedToPrint(true);
    }
  };

  /** Cancel: back to the three actions, and the wait (if any) ends with the view. */
  const handleClosePrintView = () => {
    setIsPrintViewOpen(false);
    setHasAskedToPrint(false);
  };

  /** The print view's own press: the whole deck when resolved, "Print so far" while waiting. */
  const handleExport = () => {
    exportDeck(deck, playlistName, { blankUnconfirmed });
  };

  /**
   * Whether the wait that is currently running has already handed off to the export.
   *
   * The effect below cannot clear `hasAskedToPrint` to make itself idempotent -- that is the
   * `setState`-in-an-effect the derivation above exists to avoid -- so the guard is a ref instead.
   * Reset when a NEW wait begins, in `handleOpenPrintView`.
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
    exportDeck(deck, playlistName, { blankUnconfirmed });
  }, [hasAskedToPrint, pendingYearCount, exportDeck, deck, playlistName, blankUnconfirmed]);

  /**
   * The print view (2026-10-01): "Print this deck", opened by the Print press.
   *
   * It REPLACES the three actions rather than sitting under them, which is the honest shape: this
   * is a job the player started, not a fourth thing they can do. Cancel is inside it because the
   * end screen has no other way out -- the game screen's dialog has its own Close, but this
   * component cannot assume one exists.
   *
   * Two states, one view. RESOLVED: the sheet count, the option, and Print. PENDING: the wait,
   * shaped like the screen that dealt the deck, the option, and "Print so far" -- and when the last
   * year lands the wait exports by itself and the view turns into the resolved one in place.
   *
   * The wait is a COUNT, never a list. The cards still looking up a year are the ones whose answer
   * the player has not seen, so naming one here would spoil the card they are looking at.
   *
   * ===========================================================================
   *  `role="status"` IS ON THE WAIT'S TEXT BLOCK, NOT ON THE WHOLE VIEW, AND THAT
   *  IS WHAT LETS "PRINT SO FAR" REPORT PROGRESS.
   *
   *  Its label counts codes as they are generated, and a count that climbs a
   *  hundred times inside a live region is a hundred announcements. So the region
   *  wraps exactly the two sentences that are the wait -- the option, the buttons
   *  and the export's own outcome sit outside it, and the outcome brings the
   *  SEPARATE region it already had in the actions view. Statuses in dedicated
   *  paragraphs, buttons plain.
   * ===========================================================================
   */
  if (isPrintViewOpen) {
    return (
      <>
        {renderHeading?.('print')}

        <div className="flex flex-col gap-3">
          {isWaitingForYears ? (
            <div role="status" className="flex flex-col items-center gap-3 text-center">
              <Spinner />

              <p className="text-sm font-medium text-fg">{copy.deckActions.waitingHeading}</p>

              {/*
                Says what the wait actually is, in the same spirit as the preparing screen's second
                line. The crawl is paced by the shared rate gates, so a number here is a rough
                number of seconds -- which is the only honest expectation available.
              */}
              <p className="max-w-narrow text-xs text-fg-muted">
                {copy.deckActions.waitingDetail(pendingYearCount)}
              </p>
            </div>
          ) : (
            /*
              The sheet count and the duplex setting. Seven sheets for a 100-card deck is a thing to
              know before committing paper, and the binding edge is the one instruction that decides
              whether the sheet is usable at all -- `pdf-sheet.ts` mirrors the columns for LONG-edge
              binding, and short-edge would invert the correction, so it is named here rather than
              guessed at in code. The blank-years option changes what is drawn, never which cards
              are printed, so it does not move this number.
            */
            <p className="text-center text-xs text-fg-muted">
              {copy.deckActions.sheetSummary(sheets)}
            </p>
          )}

          {/*
            The print option, directly above the press it qualifies, in the same box and control
            the picker's deal options use (`OptionCheckbox.tsx`). Disabled while an export is
            working, so the file being built cannot disagree with the box.

            ABSENT when the session skips unconfirmed years and holds no unverified card (see
            `skipUnconfirmed`): no card left in the deck has a `low` year. `blankUnconfirmed` then
            stays at its default `false`, since nothing can tick it.
          */}
          {!offersBlankUnconfirmed ? null : (
            <div className={OPTION_GROUP_CLASS_NAME}>
              <OptionCheckbox
                label={copy.deckActions.blankUnconfirmed}
                checked={blankUnconfirmed}
                disabled={pdf.status === 'working'}
                onChange={setBlankUnconfirmed}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3">
            {/*
              ===================================================================
               WHILE WAITING THIS IS "PRINT SO FAR" -- THE ESCAPE HATCH FROM THE
               2026-08-07 GATE, AND IT IS EXPLICIT RATHER THAN AUTOMATIC.

               The gate exists because an export taken mid-crawl prints a deck
               that is QUIETLY short -- the omission is discoverable only by
               counting printed paper. It does not exist because a short deck is
               never what the player wants: somebody printing 40 of 60 cards to
               start a game now is making an informed trade. What the gate rules
               out is the SILENT version, and what answers that here is the
               "N cards left out, no year yet" line below -- the label says what
               the button prints, so a caption repeating it was cut as noise.

               It does not touch `hasAskedToPrint`, so the wait survives the
               press and the full deck still exports itself when the last year
               lands. Two files, both asked for.
              ===================================================================
            */}
            <button
              type="button"
              onClick={handleExport}
              // Disabled only while working: `exportDeck` bumps its own generation counter, so a
              // second press would abandon the document the first one is half-way through. A
              // finished or failed export is repeatable -- the commonest reason to press it twice
              // is a printer that ate the first one.
              disabled={pdf.status === 'working'}
              className={BUTTON_CLASSES}
            >
              {pdf.status === 'working'
                ? copy.deckActions.printing(pdf.completed, pdf.total)
                : isDeckResolved
                  ? copy.deckActions.print
                  : copy.deckActions.printPartial}
            </button>

            {/*
              Takes focus when the view opens -- see `cancelRef`. The button that was focused
              (Print) has just been unmounted, and focus falling to `<body>` would leave a keyboard
              player with nothing selected in a panel they cannot see the state of.
            */}
            <button
              ref={cancelRef}
              type="button"
              onClick={handleClosePrintView}
              className={BUTTON_CLASSES}
            >
              {copy.deckActions.cancel}
            </button>
          </div>

          {/*
            The export's outcome, in the same words the actions view uses -- including the excluded
            count, which is the whole point of "Print so far" rather than an edge case. Still a
            COUNT.
          */}
          <ExportMessage state={pdf} />
        </div>
      </>
    );
  }

  return (
    <>
      {renderHeading?.('actions')}

      <div className="flex flex-col gap-3">
        <button ref={copyButtonRef} type="button" onClick={handleCopy} className={BUTTON_CLASSES}>
          {copy.deckActions.copyLink}
        </button>

        {/*
        Deliberately careful wording. The seeded shuffle is exact; the track list it shuffles is
        not, because yearless cards are dropped at play time, editorial playlists refresh, and a
        playlist that has gone private since is dropped with a notice. See the header block --
        promising "the same deck" here is the one thing this copy must not do.

        Pluralised on the id count rather than left as "playlist(s)": the caption is the sentence
        that has to be read and believed, and a slash in it reads as boilerplate. And it says
        whether the link starts on the current card, because only a mid-game link does.
      */}
        <p className="text-center text-xs text-fg-muted">
          {copy.deckActions.shareCaption(playlistIds.length, currentCardId !== undefined)}
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
          {isPlaylistSaved ? copy.deckActions.saved : copy.deckActions.save}
        </button>

        <button
          ref={printButtonRef}
          type="button"
          // Opens the print view (2026-10-01), which holds the blank-years option and the press that
          // exports. Never disabled by the year gate -- see `handleOpenPrintView`. Disabled only while
          // an export the print view started is still working, after a Cancel.
          onClick={handleOpenPrintView}
          disabled={pdf.status === 'working'}
          className={BUTTON_CLASSES}
        >
          {pdf.status === 'working'
            ? copy.deckActions.printing(pdf.completed, pdf.total)
            : copy.deckActions.print}
        </button>

        {/*
        Two different sentences, because there are two different things worth knowing before the
        press.

        RESOLVED: the sheet count and the duplex setting -- the print view repeats it beside its own
        press, where the reasoning for it is written down.

        PENDING: no sheet count at all. `sheetsForDeck` counts only the cards that are already
        printable -- a final year, or a kept yearless card -- so mid-crawl it is a number that would climb while the player read it -- and since the
        press now WAITS for the rest, it would also be describing a deck nobody is going to print.
        Saying what the press will do is more useful than a figure that is about to be wrong.
      */}
        <p className="text-center text-xs text-fg-muted">
          {isDeckResolved
            ? copy.deckActions.sheetSummary(sheets)
            : copy.deckActions.printWaitsForYears(pendingYearCount)}
        </p>

        <ExportMessage state={pdf} />

        {/*
        One live region for both copy outcomes, and it exists only once there is something to say --
        `idle` renders nothing, so nothing is announced before the player presses anything. Safe
        even beside an unflipped card: the region's TEXT is two fixed sentences, and the link in the
        fallback's `value` names playlists, a seed, a version and -- mid-game -- the current card's
        track id, which the QR on that card already encodes. Never a title, an artist or a year.
      */}
        {copyState === 'idle' ? null : (
          <div role="status" className="flex flex-col gap-2">
            {copyState === 'copied' ? (
              <p className="text-center text-xs text-fg-secondary">{copy.deckActions.linkCopied}</p>
            ) : (
              <>
                <p className="text-center text-xs text-warning">
                  {copy.deckActions.linkCopyFailed}
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
                  aria-label={copy.deckActions.shareLinkFieldLabel}
                  onFocus={(event) => event.currentTarget.select()}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg focus-visible:focus-ring"
                />
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
