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
  /**
   * The QR's GENERATED bitmap edge length in pixels. Not its displayed size — see below.
   *
   * Overridable for tests and for a future caller that needs a different bitmap; the displayed
   * size is not a prop, because it is a property of the card's layout rather than of this face.
   */
  qrSize?: number;
}

/**
 * The bitmap the QR is encoded at, in pixels.
 *
 * Sized for the LARGEST the code is ever displayed at, which is 224px — `--qr-display-size` is
 * 14/18 of the card's width and the card's width tops out at 288px. Fixed, and it stays fixed
 * (Phase 7 decision 4): the displayed size became fluid, the generated one must not follow it,
 * because `toDataURL` is asynchronous and a viewport-derived size would re-encode on every frame
 * of a resize. Downscaling a finished code in CSS is free.
 *
 * **This number has to move with `--qr-display-size`, and it is the direction that matters.**
 * It was 176 while the code displayed at 11/18; the code is now 14/18, so a 176px bitmap would be
 * scaled UP by 27% and a QR is exactly the kind of image that must not be — upscaling blurs the
 * module edges a camera is looking for. Encoding above the displayed size is harmless (the browser
 * downsamples), encoding below it is not.
 */
const QR_BITMAP_SIZE = 224;

/**
 * The CSS length the code is DRAWN at, tracking the card. Defined in `src/index.css`.
 *
 * A string handed straight to `QrCode`'s `displaySize`, and deliberately not something this file
 * computes: the card's geometry lives in one `@theme` block and this is one more consumer of it.
 */
const QR_DISPLAY_SIZE = 'var(--qr-display-size)';

export function CardHiddenSide({ card, qrSize = QR_BITMAP_SIZE }: CardHiddenSideProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-6">
      {/* Always rendered, for every card, whatever the state of audio. plan.md §2. */}
      <QrCode url={spotifyTrackUrl(card.id)} size={qrSize} displaySize={QR_DISPLAY_SIZE} />

      {/*
        Generic on purpose, and it is the only text this face may carry: it says how the card is
        used, never anything about the track. Kept short because the face has to stay readable
        on a phone.

        ===========================================================================
         `text-fg`, AND THE CLASS IT REPLACED WAS NOT A DIM COLOUR -- IT WAS NO
         COLOUR AT ALL.

         This line read `text-text-muted`, and there is no `--color-text-muted`
         token: the app's is `--color-fg-muted`, so the utility Tailwind was asked
         for did not exist and no rule was emitted. Nothing in the chain above sets
         a colour either -- the hidden face is `bg-surface` with no `text-*`, and
         `GameScreen`'s `<main>` sets none -- so the line fell back to the UA
         default of near-black on a near-black card. That is why it looked like a
         contrast bug rather than a typo, and why it is worth spelling out: an
         unknown Tailwind colour utility fails SILENTLY, at build time, with no
         error anywhere.

         Full `--color-fg` rather than the muted token now that it renders at all:
         this is the one instruction on the card, at 12px, read across a table in
         whatever light the room has.
        ===========================================================================
      */}
      <p className="text-xs text-fg">Scan to play the full song</p>
    </div>
  );
}
