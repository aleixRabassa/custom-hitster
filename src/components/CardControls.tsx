/**
 * The three session controls -- Exit, Play/Pause, Keep this deck -- as a bar BESIDE the card
 * rather than on its face.
 *
 * ===========================================================================
 *  THERE WAS A FOURTH, AND IT WAS REMOVED ON 2026-08-11: RESTART SONG.
 *
 *  It seeked to 0:00 and replayed. Two reasons it went, and the second is the
 *  one that makes re-adding it a regression rather than a preference:
 *
 *  1. It was the only control that duplicated another one. A preview runs to its
 *     natural end and `useCardAudio` now rewinds to 0:00 on `ended`, so Play IS
 *     the replay -- pressing it on a finished track starts the song again. A
 *     second button for the same outcome is a third of the bar spent twice.
 *  2. The bar sits under a thumb that is mid-swipe. Fewer, bigger targets is the
 *     whole point of the resize that landed with this, and Restart was the least
 *     used of the four while being adjacent to Play.
 *
 *  The hook's `restart()` went with it rather than being left as dead API.
 *  Reinstating the button means reinstating that too -- and re-checking the
 *  `ended` rewind, which is where its behaviour now lives.
 * ===========================================================================
 *
 * ===========================================================================
 *  THEY LIVE OUTSIDE THE CARD BECAUSE A BUTTON PRESS IS A TAP, AND A TAP IS A
 *  FLIP.
 *
 *  Phase 4 put these three on the card's hidden face and Phase 5 then made the
 *  card tap-to-flip, with `gestureProps.onPointerUp` bound to the card's OUTER
 *  element. A pointer-up on a button inside the card bubbles to that handler,
 *  and `isTap()` sees exactly what a genuine tap looks like -- a few pixels of
 *  movement over a couple of hundred milliseconds, with no drag recognised --
 *  so pressing Play both started the audio AND revealed the answer.
 *
 *  This is the pointer twin of the Space-on-a-focused-button double-action
 *  Phase 5 guarded against for the keyboard, and it was missed because the two
 *  halves shipped in different phases: the buttons were harmless until the
 *  card became tappable.
 *
 *  It could have been patched with a `closest('button')` check inside the
 *  gesture hook. Moving the controls out is the structural fix instead: there
 *  is no interactive element inside the draggable surface at all, so the class
 *  of bug is gone rather than guarded. The card's face is now the QR code and
 *  nothing else, which is also the honest shape -- the QR is the only thing on
 *  that face a player is meant to touch, and they touch it with a phone camera.
 * ===========================================================================
 *
 * Presentational, like every other component here: `audio` and `onExit` arrive as props and
 * nothing in this file knows a session exists. `GameScreen` owns the audio element and renders
 * this next to the stack.
 *
 * ## The bar is visible on both sides of the flip, and that is deliberate
 *
 * On the hidden face it was unreachable once the card was flipped. Now it is always there.
 * Phase 4's stop-on-flip rule is unchanged -- flipping still stops the preview -- but a player
 * who deliberately presses Play after the reveal gets audio, which is a reasonable thing to
 * want and not a leak: nothing here derives from the card's data.
 *
 * ## Nothing here may leak
 *
 * The same rule `CardHiddenSide` documents applies, for the same reason: this bar sits next to
 * an unflipped card. No label, `aria-label`, `title` or `data-*` attribute may derive from
 * `title`, `artist`, `year` or `durationMs`. All three names below are generic and asserted to
 * be exactly so -- including "Keep this deck", which names the DECK rather than the card.
 */

import type { ReactNode } from 'react';

import type { CardAudioControls } from '../hooks/useCardAudio';
import { Spinner } from './Spinner';

/**
 * Every button here carries the same utilities, so they live in one string. Only the glyph
 * COLOUR differs between them, and it differs for exactly one button -- see below.
 *
 * `touch-target` is 44px square (`--size-touch-target`) and it is a fix, not a nicety: `px-4 py-2`
 * around a single glyph is roughly 40px tall and narrower than that wide, on the surface a thumb
 * is most likely to be near while swiping a card. `focus-visible:focus-ring` is the app's one ring
 * -- `focus-visible` rather than `focus` so a mouse click does not leave a ring behind. Both are
 * defined as `@utility` in `src/index.css`.
 *
 * `disabled:opacity-(--opacity-disabled)` replaces `disabled:opacity-40`, which put the glyph at
 * 3.46:1 against `--color-surface-raised` -- the dimmest text in the app, on the one card a player
 * most wants to act on. The token measures 5.94:1.
 *
 * `size-(--size-control-button)` (2026-08-11) replaced `px-4 py-2`. The buttons are a SQUARE --
 * with `rounded-full`, a circle -- rather than a pill sized by its padding, which is what lets
 * three of them be visibly bigger without the row drifting off-centre. The token is `card / 5`
 * above a 3.5rem floor, so the buttons grow with the card and the row's spacing below stays the
 * same design at every viewport; `src/index.css` carries that arithmetic. `touch-target` stays
 * beside it and is not redundant: it is a `min-height`/`min-width` floor, so it keeps guaranteeing
 * the WCAG 2.5.5 minimum if the button token is ever lowered.
 */
const BUTTON_CLASSES =
  'relative flex touch-target size-(--size-control-button) items-center justify-center ' +
  'rounded-full bg-surface-raised ' +
  'hover:bg-surface-raised-hover focus-visible:focus-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

/** Play/Pause: the app's ordinary foreground. */
const AUDIO_BUTTON_CLASSES = `${BUTTON_CLASSES} text-fg`;

/**
 * Exit, in red, because it is the one control here that ENDS something.
 *
 * `--color-danger` measures 5.7:1 on `--color-surface-raised`, so it clears 1.4.3 as text would --
 * comfortably more than the 3:1 WCAG 1.4.11 asks of a non-text indicator. The fill and the hover
 * fill are the same as the other two: the colour is doing the signalling, and giving this one
 * button a red BACKGROUND as well would make the loudest thing in the control bar the button a
 * player is least often meant to press.
 */
const EXIT_BUTTON_CLASSES = `${BUTTON_CLASSES} text-danger`;

/**
 * The one `<svg>` wrapper all four icons share.
 *
 * ===========================================================================
 *  ICONS, NOT TEXT GLYPHS -- AND THAT IS WHAT MAKES THEM MATCH.
 *
 *  The controls were ■ ▶ ❙❙ ↺, and a codepoint's rendered size, stroke
 *  weight and baseline are decided by whichever font the OS resolves it in.
 *  ▶ (U+25B6) is emoji-capable, so on a machine whose fallback chain reaches an
 *  emoji font first it renders coloured and oversized; even when it does not, it
 *  is a solid triangle at a different optical weight from ↺'s hairline arrow,
 *  sitting on a different baseline. No amount of `text-*` sizing fixes that,
 *  because there is nothing common to size.
 *
 *  One viewBox, one length (`--size-control-icon`), one stroke width, and the
 *  icons are the same size and weight on every platform.
 * ===========================================================================
 *
 * `aria-hidden` on every one of them, and that is not decoration-by-default: each button already
 * carries a generic `aria-label`, so an icon that announced itself would either duplicate the
 * label or contradict it.
 */
function ControlIcon({ children, filled = false }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      // Keeps the SVG out of the tab order in the browsers that still put it there.
      focusable="false"
      // `filled` icons are stroked in the same colour as they are filled, so their corners take
      // the round join below and read at the same weight as the outlined pair.
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-(--size-control-icon)"
    >
      {children}
    </svg>
  );
}

/**
 * The emergency-exit pictogram: a doorway, and an arrow leaving through it.
 *
 * The ISO 7010 running figure was the other option and is deliberately not drawn -- at 20px a
 * stick figure is a smudge, while a doorway and an arrow are legible at any size and carry the
 * same meaning. What makes it read as an exit sign rather than as a log-out chevron is that the
 * door is drawn as three sides with the fourth OPEN, so the arrow passes through an opening
 * instead of pointing at a panel.
 */
function ExitIcon() {
  return (
    <ControlIcon>
      <path d="M14 3.5h4A1.5 1.5 0 0 1 19.5 5v14a1.5 1.5 0 0 1-1.5 1.5h-4" />
      <path d="M4.5 12h7.5" />
      <path d="m8.75 8.25 3.25 3.75-3.25 3.75" />
    </ControlIcon>
  );
}

function PlayIcon() {
  return (
    <ControlIcon filled>
      <path d="M8.75 5.75 18.25 12l-9.5 6.25z" />
    </ControlIcon>
  );
}

function PauseIcon() {
  return (
    <ControlIcon filled>
      <rect x="8" y="6" width="3" height="12" rx="1.25" />
      <rect x="13" y="6" width="3" height="12" rx="1.25" />
    </ControlIcon>
  );
}

/**
 * Share / save / print, drawn as the standard "out of a box, upwards" export arrow.
 *
 * Not a cluster of cards and not a three-dot overflow menu: what the button opens is the three ways
 * a deck LEAVES this session -- a link, the library, a sheet of paper -- and the export arrow is
 * the one pictogram every platform already spends that meaning on. The tray below the arrow is
 * open-topped for the same reason the exit door is: the shape has to read at 20px.
 */
function KeepDeckIcon() {
  return (
    <ControlIcon>
      <path d="M12 3.5v11" />
      <path d="m8.25 7.25 3.75-3.75 3.75 3.75" />
      <path d="M5.5 13.5v5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5v-5" />
    </ControlIcon>
  );
}

export interface CardControlsProps {
  /** From `useCardAudio`, owned by `GameScreen`. This component never touches the element. */
  audio: CardAudioControls;
  /**
   * Open the deck actions -- the share link, the save, the PDF.
   *
   * Like `onExit` this only ASKS: `GameScreen` opens `DeckActionsDialog` on it, and nothing happens
   * to the deck or the session either way. It is here rather than on the end screen alone because
   * reaching the end screen means ENDING THE GAME, which is irreversible -- so before 2026-08-06
   * the price of copying a share link was the deck (see `DeckActions`).
   */
  onKeepDeck: () => void;
  /**
   * ASKS to end the session. It does not end it.
   *
   * `GameScreen` opens a confirmation dialog on this callback and only tells the container to end
   * the game once the player confirms -- exiting discards the deck and every year resolved so far,
   * and this button sits 44px from the surface a thumb swipes on. The name is unchanged because
   * from this component's side nothing has: it reports a press.
   */
  onExit: () => void;
}

export function CardControls({ audio, onExit, onKeepDeck }: CardControlsProps) {
  const { canPlay, isPlaying, isLoading, play, pause } = audio;

  return (
    /*
      ===========================================================================
       THE ROW IS EXACTLY AS WIDE AS THE CARD, AND THE SPACING IS `justify-evenly`
       RATHER THAN A GAP. Asked for on 2026-08-11: the gap between two buttons and
       the gap from the outer two to the CARD'S SIDES have to be the same.

       `gap-3` could not express that. It sets the two inner gaps and says nothing
       about the outer two, which were whatever centring a hug-width row inside the
       screen happened to leave -- a number that changed with the button size and
       had no relation to the card at all.

       `space-evenly` divides the leftover width into four equal parts: one before
       the first button, one between each pair, one after the last. So the
       requirement is met by construction at every viewport, and it stays met when
       the button token changes, which no hand-set gap would.

       `w-(--card-width)` is what makes "the sides of the card" mean anything here,
       and it is the same alignment convention `Hud` and `NoticeBanner` follow --
       everything in this column lines up with the card's edges rather than with
       the viewport's. The missing-preview note inherits the width too, which is
       why it carries `text-center`: at the 240px floor card it wraps.
      ===========================================================================
    */
    <div className="flex w-(--card-width) flex-col items-center gap-2">
      <div className="flex w-full items-center justify-evenly">
        {/*
          Exit is never disabled. A player must always be able to leave, including on a card
          whose audio does not work -- which is precisely the card they are most likely to
          want to leave on.
        */}
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit game"
          className={EXIT_BUTTON_CLASSES}
        >
          <ExitIcon />
        </button>

        {/*
          One button that toggles, not two. `aria-label` swaps with the state so a screen
          reader hears what the button will DO -- and both labels are generic.

          IT IS DISABLED ONLY FOR A CARD WITH NO PREVIEW, NEVER WHILE LOADING. A press during a
          cold fetch is the player asking to CANCEL, and it works: the button is showing Pause by
          then, so the press pauses and lowers the intent. Disabling it during the wait is the
          obvious-looking change that recreates the original bug in a new shape -- the press that
          gets ignored just moves from the first one to the second.

          `aria-busy` rather than a third label: the button's ACTION while loading is still
          "pause", so changing the label would misdescribe it, and a name that changed under a
          screen reader mid-press is worse than a busy state beside a stable one.
        */}
        <button
          type="button"
          onClick={isPlaying ? pause : play}
          disabled={!canPlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          aria-busy={isLoading}
          className={AUDIO_BUTTON_CLASSES}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}

          {/*
            The icon above stays rendered UNDERNEATH this. Reduced motion hides the spinner
            outright (`Spinner` has the reasoning), so a button whose only content were the
            spinner would render as an empty circle -- the overlay keeps a glyph in it either way.
            `pointer-events-none` so the ring never eats the press it is reporting on.
          */}
          {isLoading ? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Spinner sizeClassName="size-(--size-control-spinner)" />
            </span>
          ) : null}
        </button>

        {/*
          Last in the row, and never disabled: it depends on the DECK rather than on this card, so a
          card with no preview -- which disables the button before it -- has no bearing on it.
          Furthest from Exit as well, which is the position a button a player presses on purpose
          should have when the one that destroys the session is at the other end.
        */}
        <button
          type="button"
          onClick={onKeepDeck}
          aria-label="Keep this deck"
          className={AUDIO_BUTTON_CLASSES}
        >
          <KeepDeckIcon />
        </button>
      </div>

      {canPlay ? null : (
        // Generic on purpose: it says the preview is missing, never which track it is missing
        // for. The QR still works, so this is a note rather than an error.
        <p className="text-xs text-fg-muted text-center">No preview available — scan to play</p>
      )}
    </div>
  );
}
