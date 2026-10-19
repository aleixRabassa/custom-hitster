/**
 * The web player's wall: a blurred overlay over the game, from the second card on, outside the
 * Google Play app (2026-10-19). `GameScreen` decides when it shows (`isPlayGated`); this file only
 * draws it and holds the keyboard inside it.
 *
 * Modelled on `ExitConfirmDialog`, with three deliberate differences:
 *
 * - **Nothing dismisses it.** No Escape, no backdrop press. The ways out are the install link,
 *   "End game", and the exit dialog a back press opens (its Restart deals card 1, which lifts the
 *   derived gate). There is no in-page step back: Guard 4 kills ArrowLeft and this covers the swipe.
 * - **`z-40`, below the dialogs' `z-50`.** The back press (`useBackNavigation`, deliberately
 *   unchanged) still opens `ExitConfirmDialog`, and that dialog has to stay reachable on top.
 * - **The install control is a link**, not a button, with no `target="_blank"`: it leaves for the
 *   Play listing (or the Play app) in the same tab, like the PDF download link.
 *
 * It names no track and takes no `Card`, so it is safe over an unflipped card.
 */

import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { PLAY_STORE_URL } from '../game/launcher';
import { useCopy } from '../hooks/useLocale';

export interface PlayGateOverlayProps {
  /** "End game": ends the session at once -- nothing to confirm, the player cannot play on. */
  onEndGame: () => void;
}

export function PlayGateOverlay({ onEndGame }: PlayGateOverlayProps) {
  const copy = useCopy();
  const installRef = useRef<HTMLAnchorElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);

  // Focus the install link on mount, and give focus back on unmount (a detached element ignores it,
  // so the same line serves an End game).
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    installRef.current?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  // `aria-modal` does not make Tab skip the page behind: a cycle over the two controls.
  const handleTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    event.preventDefault();
    const order = [installRef.current, endRef.current];
    const index = order.findIndex((control) => control === event.target);
    const step = event.shiftKey ? order.length - 1 : 1;
    const target = index === -1 ? order[0] : order[(index + step) % order.length];
    target?.focus();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-page/60 p-6 backdrop-blur-md"
      data-testid="play-gate-backdrop"
      onKeyDown={handleTab}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-gate-title"
        aria-describedby="play-gate-description"
        className="flex w-full max-w-content flex-col gap-4 rounded-lg border border-border-strong bg-surface p-5 text-fg"
      >
        <h2 id="play-gate-title" className="text-lg font-semibold">
          {copy.playGate.title}
        </h2>

        <p id="play-gate-description" className="text-sm text-fg-secondary">
          {copy.playGate.body}
        </p>

        <div className="flex flex-col gap-3">
          <a
            ref={installRef}
            href={PLAY_STORE_URL}
            className="touch-target rounded-lg bg-accent px-4 py-2 text-center font-medium text-on-accent hover:bg-accent-hover focus-visible:focus-ring"
          >
            {copy.playGate.install}
          </a>

          <button
            ref={endRef}
            type="button"
            onClick={onEndGame}
            className="touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring"
          >
            {copy.playGate.endGame}
          </button>
        </div>
      </div>
    </div>
  );
}
