/**
 * The three session controls -- Exit, Play/Pause, Restart -- as a bar BESIDE the card rather
 * than on its face.
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
 * be exactly so.
 */

import type { ReactNode } from 'react';

import type { CardAudioControls } from '../hooks/useCardAudio';

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
 */
const BUTTON_CLASSES =
  'flex touch-target items-center justify-center rounded-full bg-surface-raised px-4 py-2 ' +
  'hover:bg-surface-raised-hover focus-visible:focus-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

/** Play/Pause and Restart: the app's ordinary foreground. */
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
 *  The four controls were ■ ▶ ❙❙ ↺, and a codepoint's rendered size, stroke
 *  weight and baseline are decided by whichever font the OS resolves it in.
 *  ▶ (U+25B6) is emoji-capable, so on a machine whose fallback chain reaches an
 *  emoji font first it renders coloured and oversized; even when it does not, it
 *  is a solid triangle at a different optical weight from ↺'s hairline arrow,
 *  sitting on a different baseline. No amount of `text-*` sizing fixes that,
 *  because there is nothing common to size.
 *
 *  One viewBox, one length (`--size-control-icon`), one stroke width, and the
 *  four icons are the same size and weight on every platform.
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

/** Replays from 0:00, so the arrow turns BACK -- anticlockwise, not a clockwise "next". */
function RestartIcon() {
  return (
    <ControlIcon>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </ControlIcon>
  );
}

export interface CardControlsProps {
  /** From `useCardAudio`, owned by `GameScreen`. This component never touches the element. */
  audio: CardAudioControls;
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

export function CardControls({ audio, onExit }: CardControlsProps) {
  const { canPlay, isPlaying, play, pause, restart } = audio;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-3">
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
        */}
        <button
          type="button"
          onClick={isPlaying ? pause : play}
          disabled={!canPlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className={AUDIO_BUTTON_CLASSES}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        {/* Restart replays from 0:00. It is NOT next-card -- that is a swipe. */}
        <button
          type="button"
          onClick={restart}
          disabled={!canPlay}
          aria-label="Restart"
          className={AUDIO_BUTTON_CLASSES}
        >
          <RestartIcon />
        </button>
      </div>

      {canPlay ? null : (
        // Generic on purpose: it says the preview is missing, never which track it is missing
        // for. The QR still works, so this is a note rather than an error.
        <p className="text-xs text-fg-muted">No preview available — scan to play</p>
      )}
    </div>
  );
}
