import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import './index.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

/**
 * ===========================================================================
 *  `MotionConfig reducedMotion="user"` IS HALF OF THE REDUCED-MOTION STRATEGY.
 *
 *  The other half is the `@media (prefers-reduced-motion: reduce)` block at the
 *  bottom of `src/index.css`, which covers the three CSS animations -- the card
 *  flip, the preparing spinner and the QR placeholder's pulse. This line covers
 *  what CSS cannot reach: Motion's `drag` on the card and the 600px directional
 *  `exit` in `Card.tsx`, both of which are JS-driven transforms.
 *
 *  With the preference set, Motion animates OPACITY instead of transforms, so a
 *  committed card fades rather than flying off-screen. THE DRAG ITSELF KEEPS
 *  WORKING -- direct manipulation is not an animation, and Motion does not treat
 *  it as one. That is the regression this line could plausibly have introduced
 *  and the first thing the manual pass in `docs/development.md` §5 checks.
 *
 *  Two declarations for four animation surfaces, and no presentational component
 *  reads the preference. That is Phase 7 decision 3, and the reason is that the
 *  alternative -- `useReducedMotion()` in three components -- silently misses
 *  whatever animation the next phase adds.
 *
 *  Inside `StrictMode` and around `<App />`: it is a context provider, so every
 *  Motion component in the tree has to be beneath it, and there is exactly one
 *  tree.
 *
 *  Note that nothing in `src/App.test.tsx` renders THIS file -- the tests render
 *  `<App />` directly. `Card.test.tsx` carries a test that renders a card inside
 *  a `MotionConfig` for that reason: it is the only automated evidence that
 *  jsdom's `window.matchMedia` satisfies Motion's listener registration, which
 *  was an open question for this plan. It does, with no stub.
 * ===========================================================================
 *
 * ===========================================================================
 *  `ErrorBoundary` WRAPS `<App />` FROM HERE, AND THAT POSITION IS THE POINT.
 *
 *  A boundary only catches what is BELOW it, so one rendered INSIDE `App` would
 *  be unmounted by the very exception it exists to catch: a throw in `App`'s own
 *  render passes straight through a boundary that same render produced. Out here
 *  its render depends on nothing the game touches, so there is nothing left in
 *  it to break.
 *
 *  Inside `StrictMode` and outside `MotionConfig`, so a crash in Motion's own
 *  tree is caught too. Its fallback renders no error message by design -- see
 *  `ErrorBoundary.tsx`, the deck is in scope of anything it catches.
 * ===========================================================================
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
