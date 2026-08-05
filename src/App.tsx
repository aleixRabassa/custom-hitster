/**
 * PHASE 4 HARNESS. Replaced wholesale by plan.phase-4-6-screens.md (Phase 6).
 *
 * There is no screen yet from which to reach a card: the landing page, the `/api/playlist`
 * client, and the container that calls `useGameSession()` are all Phase 6. This mounts
 * `GameScreen` over the FIXTURE deck with local state so the card is reachable in `pnpm dev` —
 * enough to flip it, play it, and check the hidden side in devtools, which is what Phase 4's
 * manual verification asks for.
 *
 * It is expected to be deleted, not grown into the game container. Two things are deliberately
 * missing and must not be added here:
 *
 * - **No `useGameSession()`.** The session, resume, and the year resolver belong to Phase 6's
 *   container. Wiring them here would mean writing that container twice.
 * - **No tap-to-flip and no swipe.** Distinguishing a tap from a drag is Phase 5's job
 *   (plan.phase-4-6-gestures.md). The buttons below are scaffolding for a developer, not the
 *   product's controls — in the real game the card itself is the control surface.
 *
 * The fixture deck is walked in order on purpose: its cards are one-per-interesting-shape
 * (`high` / `low` / `none` / pending year, a preview-less card, an unplayable card, a
 * duplicated id), so stepping through all eight is the manual check.
 */

import { useState } from 'react';

import { GameScreen } from './components/GameScreen';
import { fixtureDeck } from './components/__fixtures__/cards';

export default function App() {
  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const card = fixtureDeck[index];

  const next = () => {
    setIsFlipped(false);
    setIndex((current) => (current + 1) % fixtureDeck.length);
  };

  const exit = () => {
    setIsFlipped(false);
    setIndex(0);
  };

  // `noUncheckedIndexedAccess` makes this genuinely possibly-undefined, and the guard is
  // cheap. The real container gets `currentCard` from the reducer's selector instead.
  if (!card) return null;

  return (
    <div className="relative">
      <GameScreen
        card={card}
        isFlipped={isFlipped}
        // The pending year state is a property of a fixture card here, not of a live lookup:
        // `pendingYearCard` has no `year`, which is exactly what the reducer's
        // `isCurrentYearPending` reports for a card the resolver has not reached.
        isYearPending={card.year === undefined}
        onFlip={() => setIsFlipped((flipped) => !flipped)}
        onNext={next}
        onExit={exit}
      />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-neutral-800/90 px-3 py-2 text-xs text-neutral-300">
          <span className="px-1 font-mono">
            {index + 1}/{fixtureDeck.length}
          </span>
          <button
            type="button"
            onClick={() => setIsFlipped((flipped) => !flipped)}
            className="rounded-full bg-neutral-700 px-3 py-1 hover:bg-neutral-600"
          >
            Flip
          </button>
          <button
            type="button"
            onClick={next}
            className="rounded-full bg-neutral-700 px-3 py-1 hover:bg-neutral-600"
          >
            Next
          </button>
          <span className="px-1 text-neutral-500">Phase 4 harness</span>
        </div>
      </div>
    </div>
  );
}
