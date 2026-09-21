/**
 * Every sentence, label and accessible name the player reads, in one place.
 *
 * ===========================================================================
 *  THIS FILE IS THE COPY SURFACE. A COMPONENT RENDERS `COPY.*`, NEVER A LITERAL,
 *  AND A TEST ASSERTS AGAINST `COPY.*`, NEVER A LITERAL EITHER.
 *
 *  The reason is one measured cost: before this module existed, the wording of
 *  the app was pinned in ~200 places across eighteen test files -- `getByText`
 *  with a full sentence, `getByRole('button', { name: /copy share link/i })`,
 *  `toContain('1 playlist could not be loaded and was left out.')`. Rewording a
 *  single button meant hunting its literal through the suite, and the natural
 *  response to that friction is to not reword it. Copy that is expensive to
 *  change is copy that stops being edited.
 *
 *  Routing both ends through the same constant keeps the BEHAVIOUR asserted --
 *  "the button that copies the link is on this screen", "the banner names the
 *  count", "the wait offers a way out" -- while making the WORDS free. Change a
 *  string here and every test that renders it follows automatically; no test
 *  fails, because no test ever knew what it said.
 *
 *  It also closes the drift the app already had two of: `DeckActions` is mounted
 *  by both the end screen and the game screen's dialog, and `Hud`, `EndScreen`
 *  and the PDF filename all describe the same deck. One constant each is what
 *  makes "the same copy in both places" true by construction rather than by
 *  review.
 * ===========================================================================
 *
 * ===========================================================================
 *  WHAT IS DELIBERATELY *NOT* HERE.
 *
 *  1. `PLAYLIST_ERROR_MESSAGES` stays in `messages.ts`. It is already a single
 *     keyed map, it is typed `Record<StartFailureCode, string>` so a new code
 *     fails the typecheck, and that exhaustiveness is the property that would be
 *     lost by folding it into a loose object here. `messages.ts` is the error
 *     half of this file; both are copy, neither is a literal in a component.
 *  2. Anything outside the app's own React tree: `index.html`'s `<title>` and
 *     `<meta description>` are shipped bytes on the critical path (see
 *     `AGENTS.md`) and `src/pwa/manifest.ts` is read by `vite.config.ts` at
 *     BUILD time, so neither can import a runtime module without dragging it
 *     somewhere it does not belong. They are named here as `app.name` only so
 *     the value has one home to copy from.
 * ===========================================================================
 *
 * ## Rules for editing
 *
 * - **A value that varies is a FUNCTION, not a template a caller assembles.** `cardsLeft(n)` owns
 *   its own pluralisation, so "1 card left" and "2 cards left" cannot drift apart and a test can
 *   ask for the exact string the component will render. A caller that concatenates is a caller that
 *   has copy in it.
 * - **No JSX and no React import.** This module is pure data, like every other file in `src/game/`,
 *   which is what lets a node-environment test read it. Where a component needs to style part of a
 *   sentence, the sentence is split into named parts here (see `footer`) rather than given markup.
 * - **The em dash, the ellipsis and the `©` are written literally.** Every source file is UTF-8 and
 *   Vite emits UTF-8. The one path that cannot take them is the PDF, and `sanitizeForPdf` in
 *   `src/game/pdf-text.ts` handles that -- nothing here reaches jsPDF unsanitised.
 */

/*
  THE ONE IMPORT IN THIS FILE, AND IT IS HERE SO A SENTENCE CANNOT LIE ABOUT THE PAPER.

  `sheetSummary` tells the player how many cards come off one A4 sheet. That number is not copy --
  it is `pdf-sheet.ts`'s grid, and until 2026-09-21 it was written into the sentence by hand as
  "12 cards each". When the grid moved to the year-cards template's 4 x 4 the string stayed behind,
  and nothing failed: the count is a plain number inside a template literal, invisible to the
  typecheck and to every test that asserts against `COPY.*`. Importing the constant is what makes
  the next grid change reach the sentence on its own. The words around it stay free, which is the
  whole point of this module.
*/
import { CARDS_PER_SHEET } from './pdf-sheet';

/** The app's name, as the accessible name of the landing logo and in the install prompt. */
export const APP_NAME = 'Playlist Jitster';

/**
 * The copyright line, split so the author can be styled without markup living in this module.
 *
 * `NOTICE` is the whole sentence and is what a test queries for -- `<footer>`'s `textContent` is
 * exactly this, because the three parts concatenate with no separator.
 */
const FOOTER_AUTHOR = 'Aleix Rabassa';
const FOOTER_PREFIX = 'Copyright © 2026-present ';
const FOOTER_SUFFIX = '. All rights reserved.';
/**
 * The author's site, which the name links to. It lives here rather than in `Footer.tsx` for the
 * same reason the words do: it is a value the developer changes, not a decision the component
 * makes. It is NOT part of `notice` -- the sentence a leak proof subtracts must stay exactly the
 * text a player reads, and an `href` is not read out.
 */
const FOOTER_AUTHOR_URL = 'https://aleixrabassa.vercel.app/';

export const COPY = {
  app: {
    name: APP_NAME,
  },

  /**
   * The front door (2026-09-18): what the game is, how a round goes, one big button into the
   * playlist picker, and the printable year cards for playing without a screen.
   *
   * A PRE-START SURFACE like `landing` and `preparing`, so nothing here names a track, an artist or a
   * year that came from a card. Three strings here DO carry year-shaped numbers: `printDetail`
   * names the first printed year, and the printed range "1970-2033" lives in `yearCardsFileName`
   * (the download link's `download` attribute) and in the asset path beside the component (its
   * `href`). `WelcomeScreen.test.tsx` audits both attributes and subtracts all three by exact
   * string, the same way every leak proxy subtracts `COPYRIGHT_NOTICE`. Reword any of them
   * freely; a new home for the range needs a new subtraction, or the proxy fails -- on purpose.
   */
  welcome: {
    /** The `alt` of the logo, which is this screen's `<h1>` name too -- never empty. */
    logoAlt: APP_NAME,
    tagline: 'The music timeline game, now from your own Spotify playlists.',
    /** The big button. Distinct from `landing.start` so no screen ever has two buttons called "Start". */
    enter: 'Start playing',
    howItWorksHeading: 'How it works',
    steps: {
      pick: {
        title: 'Pick your playlists',
        body: (maxPlaylists: number) =>
          `Paste up to ${maxPlaylists} public Spotify playlist links, or start from one of the suggestions. The tracks are shuffled into one deck.`,
      },
      play: {
        title: 'Play the card',
        body: 'Press Play to hear a preview, or scan the QR code on the card to open the full song in Spotify.',
      },
      guess: {
        title: 'Guess the year',
        body: 'Say when it came out, then tap the card to flip it and see the answer. Swipe right to deal the next card, or left to go back one.',
      },
    },
    printHeading: 'Prefer paper?',
    /** The download link's accessible name and label. */
    printCards: 'Print your cards',
    /** Names the first printed year; the range itself is in `yearCardsFileName`. See the block above. */
    printDetail:
      'A printable PDF of year cards from 1970. Print it, cut them out, and lay out the timeline on a table.',
    /**
     * The saved file's name, user-visible in a downloads list -- which is why it is copy, exactly as
     * `pdf.fileName` is. The asset's path under `public/` is a different string and lives with the
     * component, as `/logo.webp` does.
     */
    yearCardsFileName: 'jitster-year-cards-1970-2033.pdf',
  },

  landing: {
    /** The `alt` of the logo, which is the `<h1>`'s accessible name -- never empty. */
    logoAlt: APP_NAME,
    intro: (maxPlaylists: number) =>
      `Paste or select up to ${maxPlaylists} Spotify playlists to deal a deck and start playing.`,
    /**
     * The visible label of row `index` (0-based).
     *
     * Numbered from the second row so every input on the screen has a UNIQUE accessible name --
     * five boxes all called "Playlist link" are five boxes a screen-reader user cannot tell apart.
     */
    playlistLinkLabel: (index: number) =>
      index === 0 ? 'Playlist link' : `Playlist link ${index + 1}`,
    playlistLinkPlaceholder: 'https://open.spotify.com/playlist/…',
    /** 1-based, because it names the box's position on screen. */
    removeRow: (position: number) => `Remove playlist ${position}`,
    addRow: 'Add another playlist',
    atMaxRows: (maxPlaylists: number) => `${maxPlaylists} playlists is the maximum for one deck.`,
    start: 'Start',
    starting: 'Loading…',
    /** The way back to the welcome screen (2026-09-18). The ← beside it is `aria-hidden` decoration. */
    backToWelcome: 'Back',
    savedHeading: 'Your playlists',
    removeSaved: (name: string) => `Remove ${name} from your playlists`,
    suggestionsHeading: 'Or try one of these',
  },

  preparing: {
    heading: 'Dealing your deck…',
    detail: 'The game starts as soon as the first card is ready — the rest fill in while you play.',
  },

  game: {
    /** Below the card, not on it -- the hidden face carries the QR and nothing else. */
    scanCaption: 'Scan to play the full song',
  },

  hud: {
    cardsLeft: (count: number) => (count === 1 ? '1 card left' : `${count} cards left`),
  },

  controls: {
    exit: 'Exit game',
    play: 'Play',
    pause: 'Pause',
    keepDeck: 'Keep this deck',
    noPreview: 'No preview available — scan to play',
  },

  card: {
    yearPending: 'Still looking up the year…',
    yearUnknown: 'Year unknown',
    yearUnknownDetail: 'Check this one yourself',
    yearUnconfirmed: 'Unconfirmed year',
  },

  qr: {
    /** Generic by default and generic in every override: never a track, artist or year. */
    alt: 'Scan to play in Spotify',
  },

  notice: {
    truncated: (maxTracks: number) =>
      `A playlist may have more tracks than shown — only the first ${maxTracks} of it could be loaded.`,
    skippedTracks: (count: number) =>
      count === 1
        ? '1 track could not be read and was left out.'
        : `${count} tracks could not be read and were left out.`,
    failedPlaylists: (count: number) =>
      count === 1
        ? '1 playlist could not be loaded and was left out.'
        : `${count} playlists could not be loaded and were left out.`,
    combinedDeck: (deckSize: number, playlistCount: number) =>
      `${deckSize} cards from ${playlistCount} playlists, shuffled into one deck.`,
    yearsUnavailable:
      'Years are unavailable on this deployment, so cards will not show one. The deck is still playable — scan a card to hear the song.',
    dismiss: 'Dismiss notice',
  },

  end: {
    heading: 'Deck finished',
    cardsPlayed: (count: number, playlistName: string) =>
      `${count === 1 ? '1 card played' : `${count} cards played`} from ${playlistName}`,
    restart: 'Play again',
    restartDetail: 'Same tracks, new order',
    /** Not "New playlist": the landing screen is also the library and where a link is pasted. */
    home: 'Home',
    keepDeckHeading: 'Keep this deck',
  },

  deckActions: {
    copyLink: 'Copy share link',
    /**
     * ===========================================================================
     *  IT PROMISES "SAME PLAYLIST, SAME SHUFFLE" AND MUST NEVER PROMISE THE SAME
     *  DECK.
     *
     *  Yearless cards are dropped at play time and editorial playlists refresh
     *  their tracks, so the seeded shuffle is exact while its INPUT is not. A link
     *  that claimed "the same deck" would be wrong in a way the player only finds
     *  out about by comparing two games.
     *
     *  Pluralised on the id count rather than left as "playlist(s)": this is the
     *  sentence that has to be read and believed, and a slash in it reads as
     *  boilerplate.
     * ===========================================================================
     */
    shareCaption: (playlistCount: number) =>
      `${playlistCount === 1 ? 'Same playlist' : 'Same playlists'}, same shuffle — the years are looked up again, so the deck can differ slightly`,
    save: 'Save this playlist',
    saved: 'Saved to your playlists',
    print: 'Print as PDF cards',
    printing: (completed: number, total: number) => `Building PDF… ${completed}/${total}`,
    sheetSummary: (sheets: number) =>
      `${sheets === 1 ? '1 A4 sheet' : `${sheets} A4 sheets`}, ${CARDS_PER_SHEET} cards each — print double-sided on the long edge`,
    printWaitsForYears: (pendingCount: number) =>
      `${pendingCount === 1 ? '1 card is' : `${pendingCount} cards are`} still looking up a year — printing waits for them all`,
    waitingHeading: 'Waiting for the last years…',
    waitingDetail: (pendingCount: number) =>
      `${pendingCount === 1 ? '1 card is' : `${pendingCount} cards are`} still looking up a year.`,
    printPartial: 'Print so far',
    cancel: 'Cancel',
    exportDone: 'PDF downloaded',
    /** The whole of the disclosure for a partial export -- do not weaken it. */
    exportDonePartial: (excludedCount: number) =>
      `PDF downloaded — ${excludedCount} ${excludedCount === 1 ? 'card' : 'cards'} left out, no year yet`,
    exportEmpty: 'No card has a year yet, so there is nothing to print',
    exportFailed: 'Could not build the PDF',
    linkCopied: 'Link copied',
    linkCopyFailed: 'Could not copy automatically — here is the link',
    shareLinkFieldLabel: 'Share link',
  },

  deckActionsDialog: {
    title: 'Keep this deck',
    close: 'Back to the game',
  },

  exitDialog: {
    title: 'End the game?',
    body: 'This ends the game and returns you to the start screen.',
    cancel: 'Keep playing',
    confirm: 'End game',
  },

  errorBoundary: {
    heading: 'Something went wrong',
    /** GENERIC, and it stays generic: no message, no stack, no code. See `ErrorBoundary.tsx`. */
    body: 'The game hit an unexpected problem and had to stop. Reloading usually fixes it. Details were written to the browser console.',
    reload: 'Reload',
    startOver: 'Start over',
    startOverDetail:
      'Clears the saved game first. Use this if reloading keeps failing — any game in progress is lost.',
  },

  footer: {
    author: FOOTER_AUTHOR,
    authorUrl: FOOTER_AUTHOR_URL,
    prefix: FOOTER_PREFIX,
    suffix: FOOTER_SUFFIX,
    notice: `${FOOTER_PREFIX}${FOOTER_AUTHOR}${FOOTER_SUFFIX}`,
  },

  deck: {
    /**
     * The ellipsis is the single character `…`, not three dots -- `sanitizeForPdf` maps it to "..."
     * for WinAnsi and `pdfFileName` then strips it to a hyphen, so it cannot reach a filesystem.
     */
    nameEllipsis: '…',
    /**
     * A deck's label: the first playlist's (already truncated) name, plus a count of the rest.
     *
     * ONLY THE NAME IS TRUNCATED, NEVER THE FINISHED LABEL -- a label that lost its "+2 more"
     * would claim the deck is one playlist.
     */
    label: (truncatedName: string, others: number) =>
      others === 0 ? truncatedName : `${truncatedName} +${others} more`,
  },

  pdf: {
    /**
     * The download's filename. `jitster-` followed the app's rename because a downloads list is
     * USER-VISIBLE -- which is exactly what separates it from the two `localStorage` keys, which
     * keep their `hitster:` names on purpose.
     */
    fileName: (slug: string) => `jitster-${slug === '' ? 'deck' : slug}.pdf`,
  },
} as const;

/**
 * The copyright line as one string.
 *
 * Still exported under its own name because it is what the leak-proof tests subtract from a
 * screen's `textContent`: it contains "2026", a year-shaped number, on surfaces whose whole job is
 * to carry no year. Subtracted by exact string rather than by loosening the `\b(19|20)\d{2}\b`
 * pattern those proofs use.
 */
export const COPYRIGHT_NOTICE = COPY.footer.notice;
