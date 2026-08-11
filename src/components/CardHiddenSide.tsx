/**
 * The hidden side of a card: the QR code, and nothing else -- and since 2026-08-11 that is
 * literally true rather than nearly true.
 *
 * ===========================================================================
 *  THE "Scan to play the full song" LINE LEFT THIS FACE AND IS NOW RENDERED
 *  BELOW THE CARD, BY `GameScreen`.
 *
 *  Asked for by the developer, and it buys three things beyond the look:
 *
 *  1. The code can be BIGGER. The caption shared the face's height with it, so
 *     the QR's ceiling was `card - padding - gap - caption`; now it is
 *     `card - padding`, which is what `--qr-display-size` at 3/4 spends.
 *  2. The instruction is said ONCE PER SCREEN rather than once per rendered
 *     face. `CardStack` mounts this component a second time for the next card's
 *     back, so the sentence was in the document twice -- and the back had to be
 *     `aria-hidden` partly to stop a screen reader reading it twice.
 *  3. It is dimmer where it now sits (`text-fg-muted` on the page) without
 *     touching the card, which is what the developer asked for.
 *
 *  The QR's `alt` text is unchanged and is still the accessible route to the
 *  same information ("Scan to play in Spotify"), so nothing was lost by the
 *  move -- see `GameScreen`'s note on why the visible line is not `aria-hidden`.
 * ===========================================================================
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
 * Sized for the LARGEST the code is ever displayed at, which is 288px — `--qr-display-size` is
 * 3/4 of the card's width and the card's width tops out at 384px. Fixed, and it stays fixed
 * (Phase 7 decision 4): the displayed size became fluid, the generated one must not follow it,
 * because `toDataURL` is asynchronous and a viewport-derived size would re-encode on every frame
 * of a resize. Downscaling a finished code in CSS is free.
 *
 * **This number has to move with `--qr-display-size`, and it is the direction that matters.**
 * It was 176 while the code displayed at 11/18 of a 288px card; the code then went to 14/18, so a
 * 176px bitmap would have been scaled UP by 27% and a QR is exactly the kind of image that must not
 * be — upscaling blurs the module edges a camera is looking for. Encoding above the displayed size
 * is harmless (the browser downsamples), encoding below it is not.
 *
 * **The square card of 2026-08-11 did not move it, and that was arithmetic rather than luck:** the
 * ratio went to 7/12 precisely so 7/12 of the new 384px ceiling was the same 224px the old 14/18 of
 * 288px had been. **The ENLARGEMENT later the same day did move it**, from 224 to 288, because the
 * caption leaving the face let the ratio go to 3/4 and 3/4 × 384 = 288. If either the ratio or the
 * card's ceiling is raised again, recompute their product and raise this with it.
 *
 * The cost is a bigger cached data URL per card and it was weighed: `src/game/qr-cache.ts` never
 * evicts and a deck is capped at 100 cards, so this is the one number in the app that multiplies by
 * the deck size. A QR is a two-colour PNG of a few hundred modules — the bitmap grows with the
 * square of the edge but the compressed payload grows far more slowly, and 100 codes is still well
 * inside a few hundred kB.
 */
const QR_BITMAP_SIZE = 288;

/**
 * The CSS length the code is DRAWN at, tracking the card. Defined in `src/index.css`.
 *
 * A string handed straight to `QrCode`'s `displaySize`, and deliberately not something this file
 * computes: the card's geometry lives in one `@theme` block and this is one more consumer of it.
 */
const QR_DISPLAY_SIZE = 'var(--qr-display-size)';

export function CardHiddenSide({ card, qrSize = QR_BITMAP_SIZE }: CardHiddenSideProps) {
  return (
    /*
      ONE CHILD, CENTRED, AND THE PADDING NO LONGER BINDS ANYTHING.

      `flex-col` and `gap-6` went with the caption -- a gap between one child and nothing is a
      declaration that cannot do anything, and this repo's rule is that a value which looks decided
      has to be. `items-center justify-center` is what centres the code on both axes and is the whole
      layout now.

      `p-6` STAYS, as a floor rather than as the constraint it used to be: `--qr-display-size` is 3/4
      of the card, so the code leaves card/8 of space on each side -- 48px at the card's ceiling and
      30px at its floor, both wider than this padding. It is kept because the face is
      `overflow-hidden`, which means a future ratio that overflows would CROP THE CODE rather than
      show it spilling; the padding is the visible margin of safety that makes an over-large value
      look wrong before it becomes unscannable.
    */
    <div className="flex h-full w-full items-center justify-center p-6">
      {/* Always rendered, for every card, whatever the state of audio. plan.md §2. */}
      <QrCode url={spotifyTrackUrl(card.id)} size={qrSize} displaySize={QR_DISPLAY_SIZE} />
    </div>
  );
}
