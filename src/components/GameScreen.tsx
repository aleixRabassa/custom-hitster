/**
 * The card's host: one `<audio>` element for the whole session, one card, and the wiring
 * between them.
 *
 * It is the integration seam of Phase 4 and stays PRESENTATIONAL: every callback arrives as a
 * prop and nothing here calls `useGameSession()`. Plan 3 builds the container that does, and
 * adds the HUD and the notices to this file.
 *
 * ## The audio element lives here, not in the card
 *
 * `useCardAudio` explains the reasoning in full; the short version is that a single element
 * makes "a track never bleeds into the next card and never doubles up" structurally
 * impossible rather than a rule to enforce. Plan 2 renders 2-3 stacked cards at once, and
 * per-card elements would overlap and play together in exactly that window.
 *
 * ## Two stop rules, both effects
 *
 * Audio stops when the card is FLIPPED and when the CARD CHANGES. The flip rule is the less
 * obvious of the two and it is Phase 4's own: once the answer is on screen the preview has no
 * job left, and leaving it running means the next card starts against the previous track's
 * audio if the player advances quickly.
 */

import { useEffect, useRef } from 'react';

import { Card } from './Card';
import { useCardAudio } from '../hooks/useCardAudio';
import type { Card as CardData } from '../../shared/types';

export interface GameScreenProps {
  card: CardData;
  isFlipped: boolean;
  /** True only for `year === undefined` — from `isCurrentYearPending`. */
  isYearPending: boolean;
  onFlip: () => void;
  /**
   * Part of the contract and not read in Phase 4, exactly like `Card.onFlip`: advancing is a
   * swipe, and plan 2 owns gestures. Declared now so plan 2 adds a handler rather than a prop.
   */
  onNext: () => void;
  onExit: () => void;
}

export function GameScreen({ card, isFlipped, isYearPending, onFlip, onExit }: GameScreenProps) {
  const audio = useCardAudio(card.previewUrl);
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
   * the ID here is what covers that case.
   */
  useEffect(() => {
    stop();
  }, [card.id, stop]);

  const handleExit = () => {
    // Stop BEFORE handing control away: `onExit` unmounts this screen in plan 3, and a
    // pending play() on a disappearing element is how a stray sound outlives its card.
    stop();
    onExit();
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-neutral-950 p-6">
      {/*
        THE session audio element. `preload="none"` so nothing is fetched until the player
        actually asks -- a 100-card deck must not pull 100 previews for cards nobody reaches.
        No `controls` attribute: the card's own buttons are the interface, and the native
        control bar would show a seek position the game has no reason to expose.
      */}
      <audio ref={audioRef} preload="none" data-testid="session-audio" />

      <Card
        card={card}
        isFlipped={isFlipped}
        isYearPending={isYearPending}
        audio={audio}
        onFlip={onFlip}
        onExit={handleExit}
      />
    </main>
  );
}
