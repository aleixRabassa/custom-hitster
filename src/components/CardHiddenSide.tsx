/**
 * The hidden side of a card: the QR code, and nothing else.
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
 *
 * ## The three controls used to be here, and moving them out was a bug fix
 *
 * Exit, Play/Pause and Restart lived on this face through Phase 4. Phase 5 then made the card
 * tap-to-flip with a pointer handler on the card's outer element, and a pointer-up on a button
 * inside the card bubbles straight into it -- so pressing Play flipped the card and revealed
 * the answer. They now live in `CardControls`, rendered by `GameScreen` beside the stack, which
 * removes every interactive element from the draggable surface rather than guarding against
 * one. See `CardControls`'s header for the full account.
 *
 * What is left is a face with exactly one thing on it, which is the honest shape: the QR code
 * is the only part of a hidden card a player is meant to touch, and they touch it with a phone
 * camera rather than a finger.
 */

import { QrCode } from './QrCode';
import { spotifyTrackUrl } from '../../shared/spotify-url';
import type { Card } from '../../shared/types';

export interface CardHiddenSideProps {
  card: Card;
  /** QR edge length in CSS pixels. */
  qrSize?: number;
}

const DEFAULT_QR_SIZE = 176;

export function CardHiddenSide({ card, qrSize = DEFAULT_QR_SIZE }: CardHiddenSideProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-6">
      {/* Always rendered, for every card, whatever the state of audio. plan.md §2. */}
      <QrCode url={spotifyTrackUrl(card.id)} size={qrSize} />

      {/*
        Generic on purpose, and it is the only text this face may carry: it says how the card is
        used, never anything about the track. Kept short because the face has to stay readable
        on a phone.
      */}
      <p className="text-xs text-neutral-500">Scan to play the full song</p>
    </div>
  );
}
