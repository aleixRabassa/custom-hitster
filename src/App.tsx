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
 *
 * Tap-to-flip, swipe-to-advance and the keyboard controls ARE live as of Phase 5 — they come
 * from `GameScreen` and `CardStack`, not from here. The buttons below stayed because they are
 * the only way to exercise a flip and an advance on a desktop with no keyboard focus in the
 * page, and because `pnpm dev` on a laptop is where the card gets looked at.
 *
 * The fixture deck is walked in order on purpose: its cards are one-per-interesting-shape
 * (`high` / `low` / `none` / pending year, a preview-less card, an unplayable card, a
 * duplicated id — the last two adjacent, which is what makes the stack's key collision
 * reachable by hand), so stepping through all eight is the manual check.
 */

import { useState } from 'react';

import { GameScreen } from './components/GameScreen';
import { fixtureDeck } from './components/__fixtures__/cards';
import type { Card } from '../shared/types';

/**
 * A real, local, playable file — so Play/Pause/Restart can actually be verified by hand.
 *
 * ===========================================================================
 *  THE FIXTURE DECK'S `previewUrl`s ARE INVENTED, AND THAT IS CORRECT.
 *
 *  `https://p.scdn.co/mp3-preview/bohemian` is not a real Spotify preview
 *  URL (a real one ends in a long hash). For the unit tests that is exactly
 *  right: they stub `HTMLMediaElement.play` and assert on WHICH url the
 *  element was pointed at, so a fake-but-recognisable value reads better in
 *  a failure message than a real 200-character one — and a fixture that
 *  reached the network would not be a unit test.
 *
 *  In a BROWSER those URLs simply fail to load. `play()` then rejects,
 *  `useCardAudio` catches it (an unloadable source and a blocked autoplay
 *  reject the same way) and puts the button back to Play. The controls look
 *  broken while behaving exactly as designed — which is a genuinely
 *  confusing thing to hit during manual verification, so the harness
 *  substitutes a file that really plays.
 * ===========================================================================
 *
 * `public/dev-preview.wav` is a generated 15-second arpeggio: no licensing question, no
 * network, and deliberately not silent — the notes ascend so the playback POSITION is
 * audible, which is what makes Restart distinguishable from Play and Pause distinguishable
 * from a stall. It is a development asset and ships only because the harness is one; Phase 6
 * deletes both.
 */
const DEV_PREVIEW_URL = '/dev-preview.wav';

/**
 * The fixture deck with every real preview swapped for the local file.
 *
 * `noPreviewCard` is left ALONE — a card with no preview is one of the shapes this harness
 * exists to check by hand (Play/Pause and Restart disabled, Exit and the QR still live), and
 * handing it a working URL would delete the only case that proves the disabled path.
 */
const harnessDeck: Card[] = fixtureDeck.map((card) =>
  card.previewUrl === undefined ? card : { ...card, previewUrl: DEV_PREVIEW_URL },
);

export default function App() {
  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const card = harnessDeck[index];

  const next = () => {
    setIsFlipped(false);
    setIndex((current) => (current + 1) % harnessDeck.length);
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
        deck={harnessDeck}
        currentIndex={index}
        isFlipped={isFlipped}
        // The pending year state is a property of a fixture card here, not of a live lookup:
        // `pendingYearCard` has no `year`, which is exactly what the reducer's
        // `isCurrentYearPending` reports for a card the resolver has not reached.
        isYearPending={card.year === undefined}
        onFlip={() => setIsFlipped((flipped) => !flipped)}
        onNext={next}
        onExit={exit}
        // Always playable in the harness: there is no `GameStatus` here, because there is no
        // session. Phase 6's container passes `status === 'playing'`.
        isPlayable
      />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-neutral-800/90 px-3 py-2 text-xs text-neutral-300">
          <span className="px-1 font-mono">
            {index + 1}/{harnessDeck.length}
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
          <span className="px-1 text-neutral-500">Phase 5 harness</span>
        </div>
      </div>
    </div>
  );
}
