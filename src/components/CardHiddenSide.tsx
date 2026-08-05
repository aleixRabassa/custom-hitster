/**
 * The hidden side of a card: the QR code, and the three controls.
 *
 * ===========================================================================
 *  THIS FACE MUST LEAK NOTHING. IT IS THE WHOLE GAME.
 *
 *  Nothing rendered here may DERIVE from `title`, `artist`, `year`, or
 *  `durationMs` -- not visible text, not an `aria-label`, not a `title`
 *  attribute, not a `key`, not a `data-*` attribute, not a tooltip. An
 *  accessible name of "Play Bohemian Rhapsody" leaks to a screen-reader user
 *  exactly as body text leaks to an eye, and a leak audit that only greps for
 *  visible text will not catch it.
 *
 *  `Card.id` is the ONE exception, and it is not really one: a Spotify track id
 *  is 22 opaque base62 characters, and the QR code encodes it BY DESIGN --
 *  scanning the card is how a player gets to the full song.
 *
 *  A duration would be a genuine leak, incidentally: "3:54" plus a QR is
 *  enough to identify a track, and it is the kind of thing that gets added as
 *  a helpful progress bar.
 * ===========================================================================
 */

import { QrCode } from './QrCode';
import { spotifyTrackUrl } from '../../shared/spotify-url';
import type { CardAudioControls } from '../hooks/useCardAudio';
import type { Card } from '../../shared/types';

export interface CardHiddenSideProps {
  card: Card;
  /** From `useCardAudio`, owned by `GameScreen`. The card never touches the element itself. */
  audio: CardAudioControls;
  /** Ends the session and returns to the landing screen. Wired by plan 3's container. */
  onExit: () => void;
  /** QR edge length in CSS pixels. */
  qrSize?: number;
}

const DEFAULT_QR_SIZE = 176;

export function CardHiddenSide({
  card,
  audio,
  onExit,
  qrSize = DEFAULT_QR_SIZE,
}: CardHiddenSideProps) {
  const { canPlay, isPlaying, play, pause, restart } = audio;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-6">
      {/* Always rendered, for every card, whatever the state of audio. plan.md §2. */}
      <QrCode url={spotifyTrackUrl(card.id)} size={qrSize} />

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

        {/* Restart replays from 0:00. It is NOT next-card -- that is a swipe (plan 2). */}
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
