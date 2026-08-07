/**
 * The one React-aware file in the game layer, and deliberately the thinnest.
 *
 * It wires four already-tested modules together and contains no game logic of its own:
 * `reducer.ts` decides every transition, `resolver.ts` owns all the timing, `year-client.ts`
 * owns the HTTP, `persistence.ts` owns the storage format. This is the single entry point
 * Phase 6 uses.
 *
 * ===========================================================================
 *  IT IS NOT UNIT-TESTED, AND THAT IS ONLY SAFE WHILE IT STAYS THIS THIN.
 *
 *  Testing it would mean pulling the Phase 4 jsdom decision forward for effect
 *  wiring over four modules that are already covered (the same call made for
 *  `api/year.ts` and `api/playlist.ts`). The rule that keeps the trade honest:
 *  **any logic that starts accumulating here belongs in the reducer or the
 *  resolver instead.** A branch added here is a branch nothing tests.
 * ===========================================================================
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';

import { clearSession, loadSession, saveSession } from './persistence';
import {
  cardsRemaining,
  currentCard,
  gameReducer,
  initialGameState,
  isCurrentYearPending,
  pendingYearCount,
  resolvedCount,
} from './reducer';
import { createYearResolver } from './resolver';
import { lookupYear } from './year-client';
import type { StorageLike } from './persistence';
import type { YearResolver } from './resolver';
import type { GameState } from './types';
import type { Card, PlaylistSummary } from '../../shared/types';

export interface UseGameSessionOptions {
  /**
   * Defaults to `localStorage`. Injectable so Phase 4's component tests can hand in a stub
   * instead of depending on a DOM environment's storage.
   */
  storage?: StorageLike;
}

/**
 * What Phase 4 and Phase 6 get.
 *
 * `dispatch` is deliberately NOT exposed: four narrow callbacks mean a screen cannot invent a
 * transition (a `YEAR_RESOLVED` from a component, a `RESUME` mid-game) that the reducer's tests
 * never considered.
 */
export interface GameSession {
  state: GameState;
  /** Derived, never stored -- see the selector block in `reducer.ts`. */
  currentCard: Card | undefined;
  isCurrentYearPending: boolean;
  cardsRemaining: number;
  resolvedCount: number;
  /**
   * Lookups still in flight. Zero means every card in the deck carries a real year, which is what
   * the PDF export waits for -- see the selector's own block in `reducer.ts`.
   */
  pendingYearCount: number;
  start: (cards: Card[], playlist: PlaylistSummary, seed?: string) => void;
  flip: () => void;
  next: () => void;
  end: () => void;
}

/** Real time for the resolver's back-off. The resolver takes it injected so tests do not wait. */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Restore a saved session, or start from `idle`.
 *
 * Runs ONCE, as `useReducer`'s lazy initializer, and goes through `RESUME` rather than building
 * a state object here -- so the reducer stays the only place that knows how a session is shaped.
 */
function initializeSession(storage: StorageLike): GameState {
  const session = loadSession(storage);
  if (!session) return initialGameState;

  return gameReducer(initialGameState, { type: 'RESUME', session });
}

export function useGameSession(options: UseGameSessionOptions = {}): GameSession {
  const storage = options.storage ?? localStorage;
  const [state, dispatch] = useReducer(gameReducer, storage, initializeSession);

  /**
   * The latest state, for effects that must NOT re-run when it changes.
   *
   * The resolver needs the deck once, at session start. Depending on `state.deck` directly
   * would restart the crawl on every resolved year -- roughly a hundred times a game -- because
   * the reducer (correctly) produces a new deck array each time.
   *
   * Declared FIRST so this effect runs before the ones below on every commit.
   */
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const resolverRef = useRef<YearResolver | null>(null);

  /**
   * Bumped by `start()` so a restart always produces a new session key, even when the caller
   * supplies the same seed twice (Phase 8's shareable deck URL makes that a real possibility).
   * Keying on the seed alone would leave the previous crawl running against a deck whose
   * resolved years have just been thrown away.
   */
  const [sessionId, bumpSessionId] = useReducer((n: number) => n + 1, 0);

  // A session is being crawled while it is `preparing` or `playing`. Both, not just
  // `preparing`: the crawl continues for the whole session (decision 3), and collapsing the two
  // into one dep is also what stops the card-1 gate transition from restarting the resolver.
  const isActive = state.status === 'preparing' || state.status === 'playing';

  // ---- The crawl ------------------------------------------------------------
  useEffect(() => {
    if (!isActive) return;

    const resolver = createYearResolver(stateRef.current.deck, {
      // `fetch` BOUND to the global: the native one is brand-checked, so handing it over
      // unbound and having it called as `options.fetchImpl(...)` threw "Illegal invocation"
      // and every year lookup came back `network`. See `playlist-client.ts`.
      lookup: (track, signal) =>
        lookupYear(track, { fetchImpl: globalThis.fetch.bind(globalThis), signal }),
      sleep: realSleep,
      onResolved: ({ cardId, year, confidence }) => {
        dispatch({ type: 'YEAR_RESOLVED', cardId, year, confidence });
      },
      onLookupsUnavailable: () => {
        dispatch({ type: 'YEAR_LOOKUPS_UNAVAILABLE' });
      },
    });

    resolverRef.current = resolver;
    resolver.start();

    // React 19's StrictMode mounts effects twice. This cleanup is what makes that harmless:
    // the first resolver is stopped (its in-flight request aborted, its callbacks silenced)
    // before the second is created, so exactly ONE crawl runs. Verify by counting `/api/year`
    // requests in the network tab, not by assuming.
    return () => {
      resolver.stop();
      resolverRef.current = null;
    };
    // `sessionId` is intentionally not read in the body: it is here to RE-KEY this effect on a
    // new session. The deck is read through `stateRef` for the reason documented on it.
  }, [isActive, sessionId]);

  // ---- The priority jump ----------------------------------------------------
  // When the player outruns the crawl, the card they are looking at goes to the front of the
  // queue. Fires on index change only; prioritizing an already-resolved card is a no-op in the
  // resolver, so there is no need to check that here.
  const currentCardId = currentCard(state)?.id;
  useEffect(() => {
    if (currentCardId === undefined) return;

    resolverRef.current?.prioritize(currentCardId);
  }, [currentCardId]);

  // ---- Persistence ---------------------------------------------------------
  // Saves on every state change, which includes every resolved year: that is the point --
  // a reload must not re-spend the global MusicBrainz budget on lookups already done.
  useEffect(() => {
    if (state.status === 'idle') return;

    if (state.status === 'ended') {
      clearSession(storage);
      return;
    }

    saveSession(state, storage);
  }, [state, storage]);

  const start = useCallback(
    (cards: Card[], playlist: PlaylistSummary, seed?: string) => {
      // Cleared before the new session is dealt, so a failure between here and the first save
      // cannot leave the previous game resumable.
      clearSession(storage);
      dispatch(
        seed === undefined
          ? { type: 'START', cards, playlist }
          : { type: 'START', cards, playlist, seed },
      );
      bumpSessionId();
    },
    [storage],
  );

  const flip = useCallback(() => {
    dispatch({ type: 'FLIP' });
  }, []);

  const next = useCallback(() => {
    dispatch({ type: 'NEXT' });
  }, []);

  const end = useCallback(() => {
    dispatch({ type: 'END' });
  }, []);

  return {
    state,
    currentCard: currentCard(state),
    isCurrentYearPending: isCurrentYearPending(state),
    cardsRemaining: cardsRemaining(state),
    resolvedCount: resolvedCount(state),
    pendingYearCount: pendingYearCount(state),
    start,
    flip,
    next,
    end,
  };
}
