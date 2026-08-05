/**
 * The card's host: one `<audio>` element for the whole session, the notice slot, the HUD, the
 * stacked deck, the control bar, and the keyboard controls.
 *
 * It is the integration seam of Phases 4-5 and stays PRESENTATIONAL: every callback arrives as
 * a prop and nothing here calls `useGameSession()`. Plan 3 builds the container that does, and
 * adds the HUD and the notices to this file.
 *
 * ## The audio element lives here, not in the card
 *
 * `useCardAudio` explains the reasoning in full; the short version is that a single element
 * makes "a track never bleeds into the next card and never doubles up" structurally
 * impossible rather than a rule to enforce. `CardStack` renders 3 cards at once, which is
 * exactly the window where per-card elements would overlap and play together.
 *
 * ## Two stop rules, both effects
 *
 * Audio stops when the card is FLIPPED and when the CARD CHANGES. The flip rule is the less
 * obvious of the two and it is Phase 4's own: once the answer is on screen the preview has no
 * job left, and leaving it running means the next card starts against the previous track's
 * audio if the player advances quickly.
 *
 * The card-change rule is also what covers a SWIPE, which is why `useCardGestures` does not
 * stop audio itself: one owner of the stop rule, not two.
 */

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { CardControls } from './CardControls';
import { CardStack } from './CardStack';
import { Hud } from './Hud';
import { useCardAudio } from '../hooks/useCardAudio';
import type { Card as CardData } from '../../shared/types';

/** `KeyboardEvent.key` for the flip. A literal because `'Space'` is the *code*, not the key. */
const FLIP_KEY = ' ';

/** `KeyboardEvent.key` for advancing. `ArrowLeft` is deliberately unhandled -- see below. */
const NEXT_KEY = 'ArrowRight';

export interface GameScreenProps {
  /** The shuffled deck, straight from `GameState.deck`. */
  deck: CardData[];
  /** Index of the current card, straight from `GameState.currentIndex`. */
  currentIndex: number;
  isFlipped: boolean;
  /** True only for `year === undefined` — from `isCurrentYearPending`. */
  isYearPending: boolean;
  onFlip: () => void;
  onNext: () => void;
  onExit: () => void;
  /**
   * Whether the session can actually be played right now -- `status === 'playing'`.
   *
   * Gates both the gestures and the key handler. The container owns the answer; deriving it
   * here would mean this component knowing about `GameStatus`, which is exactly the session
   * knowledge it is supposed not to have.
   */
  isPlayable: boolean;
  /** Cards still to come after the current one, from `cardsRemaining`. Straight to the HUD. */
  cardsRemaining: number;
  /** The playlist's name, from `state.playlist`. Playlist-level only — never track data. */
  playlistName: string;
  /**
   * The notice banner, or null.
   *
   * Passed in as a NODE rather than as three booleans, because dismissal is container state
   * (decision 9): the banner has to survive a card change and disappear for good when dismissed,
   * and neither is something this component should be tracking. It renders whatever it is given
   * above the HUD and has no opinion about the contents.
   */
  notice?: ReactNode;
}

/**
 * Is focus somewhere that owns its own keystrokes?
 *
 * Plan 3 puts a playlist-URL input on the landing screen, and this handler must not eat its
 * spaces. `isContentEditable` is checked as well as the tag names because a rich-text host is
 * a `div` as far as `tagName` is concerned.
 */
function isTextEntryElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  return (
    element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
  );
}

export function GameScreen({
  deck,
  currentIndex,
  isFlipped,
  isYearPending,
  onFlip,
  onNext,
  onExit,
  isPlayable,
  cardsRemaining,
  playlistName,
  notice,
}: GameScreenProps) {
  const currentCard = deck[currentIndex];
  const audio = useCardAudio(currentCard?.previewUrl);
  const { audioRef, stop } = audio;

  /**
   * Stop on flip.
   *
   * Keyed on the transition INTO flipped rather than on `isFlipped` being true, so a re-render
   * while already flipped does not keep re-stopping -- harmless today, but it would silently
   * make playback impossible if a later phase ever allowed audio from the revealed side.
   */
  const wasFlippedRef = useRef(isFlipped);
  useEffect(() => {
    const wasFlipped = wasFlippedRef.current;
    wasFlippedRef.current = isFlipped;

    if (isFlipped && !wasFlipped) stop();
  }, [isFlipped, stop]);

  /**
   * Stop on card change.
   *
   * Belt and braces with `useCardAudio`'s own src-swap effect, and deliberately so: that
   * effect keys on `previewUrl`, and two different cards can share one (a duplicated track in
   * the deck -- which Phase 3 handles explicitly because playlists really do that). Keying on
   * the ID here is what covers that case, and it is also what makes a swipe stop the audio
   * without `useCardGestures` having to know about audio at all.
   */
  const cardId = currentCard?.id;
  useEffect(() => {
    stop();
  }, [cardId, stop]);

  /**
   * Keyboard controls: Space flips, → advances.
   *
   * ===================================================================
   *  A WINDOW-LEVEL HANDLER, NOT A HANDLER ON A FOCUSED ELEMENT.
   *
   *  The card is not a control and nobody's hands are on it -- a player
   *  on a laptop is sitting back. A handler bound to a focusable card
   *  would be dead for as long as focus was anywhere else, which is most
   *  of the time, and "the keyboard works only after you click the card
   *  first" is indistinguishable from broken.
   *
   *  The cost of window level is that this handler sees keystrokes meant
   *  for other things, hence the three guards below. Each one is a real
   *  bug, not defensive padding:
   *
   *  1. AUTO-REPEAT. Leaning on → deals the entire deck, and the deck is
   *     one-directional -- there is no way back from that.
   *  2. TEXT ENTRY. Plan 3's landing input would lose every space to the
   *     flip handler, so typing a playlist URL would silently flip cards.
   *  3. SPACE ON A FOCUSED BUTTON. The subtle one, and invisible until
   *     someone plays with a keyboard after clicking Play: Space is how a
   *     button is activated, so one press would BOTH toggle audio and
   *     flip the card -- revealing the answer as a side effect of
   *     pressing play.
   * ===================================================================
   */
  useEffect(() => {
    if (!isPlayable) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Guard 1. Held keys.
      if (event.repeat) return;

      const active = document.activeElement;

      // Guard 2. Applies to both keys: an input is entitled to every keystroke it gets.
      if (isTextEntryElement(active)) return;

      if (event.key === FLIP_KEY) {
        // Guard 3. Space only -- ArrowRight does nothing to a focused button, so there is no
        // double-action to avoid there. Focus is deliberately NOT stolen from the button
        // after a click: silently moving a keyboard user's focus is a worse bug than the one
        // it would paper over, and this guard already closes it.
        if (active instanceof HTMLButtonElement) return;

        // Space scrolls the page by default, and the card is viewport-sized.
        event.preventDefault();
        onFlip();
        return;
      }

      if (event.key === NEXT_KEY) {
        onNext();
      }

      // ArrowLeft is intentionally unhandled. There is no previous card -- the deck is
      // one-directional by design -- so the safe response to a player pressing it is nothing
      // at all. A "no going back" hint is a Phase 7 call.
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlayable, onFlip, onNext]);

  const handleExit = () => {
    // Stop BEFORE handing control away: `onExit` unmounts this screen in plan 3, and a
    // pending play() on a disappearing element is how a stray sound outlives its card.
    stop();
    onExit();
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page p-6">
      {/*
        THE session audio element. `preload="none"` so nothing is fetched until the player
        actually asks -- a 100-card deck must not pull 100 previews for cards nobody reaches.
        No `controls` attribute: `CardControls` is the interface, and the native control bar
        would show a seek position the game has no reason to expose.
      */}
      <audio ref={audioRef} preload="none" data-testid="session-audio" />

      {/*
        Above the card rather than below it. A notice is read once and then ignored, so it belongs
        out of the thumb's way -- the bottom of a phone screen is where the card and its controls
        are, and a banner there would be dismissed by accident mid-swipe.
      */}
      {notice}

      <Hud cardsRemaining={cardsRemaining} playlistName={playlistName} />

      <CardStack
        deck={deck}
        currentIndex={currentIndex}
        isFlipped={isFlipped}
        isYearPending={isYearPending}
        onFlip={onFlip}
        onNext={onNext}
        isEnabled={isPlayable}
      />

      {/*
        OUTSIDE the stack, and that placement is a bug fix rather than a layout preference.
        These three buttons were on the card's hidden face until the card became tappable in
        Phase 5, at which point a pointer-up on any of them bubbled into the card's gesture
        handler and flipped the card -- so pressing Play revealed the answer. `CardControls`
        documents it in full.
      */}
      <CardControls audio={audio} onExit={handleExit} />
    </main>
  );
}
