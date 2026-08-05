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

import type { CardAudioControls } from '../hooks/useCardAudio';

export interface CardControlsProps {
  /** From `useCardAudio`, owned by `GameScreen`. This component never touches the element. */
  audio: CardAudioControls;
  /** Ends the session and returns to the landing screen. Wired by the container. */
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
          className="rounded-full bg-neutral-800 px-4 py-2 text-neutral-100 hover:bg-neutral-700"
        >
          ■
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
          className="rounded-full bg-neutral-800 px-4 py-2 text-neutral-100 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? '❙❙' : '▶'}
        </button>

        {/* Restart replays from 0:00. It is NOT next-card -- that is a swipe. */}
        <button
          type="button"
          onClick={restart}
          disabled={!canPlay}
          aria-label="Restart"
          className="rounded-full bg-neutral-800 px-4 py-2 text-neutral-100 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↺
        </button>
      </div>

      {canPlay ? null : (
        // Generic on purpose: it says the preview is missing, never which track it is missing
        // for. The QR still works, so this is a note rather than an error.
        <p className="text-xs text-neutral-500">No preview available — scan to play</p>
      )}
    </div>
  );
}
