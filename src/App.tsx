/**
 * The game container: the ONE place in the app that calls `useGameSession()`.
 *
 * Replaces the Phase 4/5 fixture harness wholesale. Everything below is wiring -- the screens are
 * presentational, the reducer owns every transition, the resolver owns every bit of timing, and the
 * playlist client owns the HTTP. This file decides which screen is on screen and holds the two
 * pieces of state that belong to neither the session nor a screen.
 *
 * ===========================================================================
 *  FOUR STATUSES, FOUR SCREENS, NO ROUTER (decision 1).
 *
 *  `GameState.status` already models exactly `idle` / `preparing` / `playing` /
 *  `ended`, and each maps onto one screen. A router would add a dependency plus
 *  a SECOND source of truth to keep in sync -- and a browser Back mid-deck is a
 *  transition Phase 3's reducer never modelled, so the two would disagree the
 *  first time anyone pressed it. No screen in v1 is worth deep-linking to; the
 *  shareable deck URL is Phase 8 and enters through `start`'s optional seed,
 *  not through history.
 * ===========================================================================
 *
 * ## `dispatch` is deliberately out of reach
 *
 * `useGameSession` exposes four callbacks and no dispatcher, so no screen can invent a transition
 * the reducer's tests never considered. Nothing here should want one: if a screen seems to need a
 * fifth action, the reducer is the place to add it, with its tests.
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

import { EndScreen } from './components/EndScreen';
import { LandingScreen } from './components/LandingScreen';
import { NoticeBanner } from './components/NoticeBanner';
import { PreparingScreen } from './components/PreparingScreen';
import { useGameSession } from './game/use-game-session';
import { usePlaylist } from './hooks/usePlaylist';
import type { StartFailureCode } from './game/messages';
import type { PlaylistFetch } from './game/playlist-client';
import type { StorageLike } from './game/persistence';
import type { PlaylistResult } from '../shared/types';

/**
 * The game screen, and everything only it needs, in a separate chunk.
 *
 * ===========================================================================
 *  THIS SPLIT WAS MEASURED, NOT ASSUMED (Phase 7, step 8).
 *
 *  `motion` is 125.16 kB of the pre-split 373.39 kB bundle -- 33.7%, across
 *  `motion-dom`, `framer-motion` and `motion-utils` -- attributed by decoding the
 *  build's own source map on 2026-08-06. It is imported by exactly two files,
 *  `Card.tsx` and `CardStack.tsx`, and both live below this screen. So a third of
 *  the JavaScript on the landing screen was an animation library for cards that
 *  had not been dealt.
 *
 *  `lazy` on the SCREEN rather than a dynamic import inside it, which is the
 *  opposite of the call made for `qrcode` in `QrCode.tsx` -- and the difference is
 *  whether a loading state already exists. The QR had one (a same-size
 *  placeholder), so an import could join an await already there. `motion` is used
 *  as JSX by two components, which cannot be awaited in place at all; it needs a
 *  boundary, and this is the boundary where the card tree becomes necessary.
 *
 *  THE FALLBACK IS THE PREPARING SCREEN, which is the reason this costs nothing
 *  visible: the transition into `playing` is always FROM `preparing`, so a chunk
 *  still in flight leaves the screen the player is already looking at exactly
 *  where it is, notice and all. No spinner was invented for this.
 * ===========================================================================
 *
 * `.then` unwrapping the named export because `lazy` requires a module whose `default` is the
 * component, and this repo's components are all named exports -- there is no default anywhere under
 * `src/components/`.
 */
const GameScreen = lazy(() =>
  import('./components/GameScreen').then((module) => ({ default: module.GameScreen })),
);

/**
 * Which screen the `ended` status should render.
 *
 * ===========================================================================
 *  BOTH EXIT AND DECK-EXHAUSTION PRODUCE `status: 'ended'` (`reducer.ts` 127
 *  and 137), AND `currentIndex` CANNOT SEPARATE THEM EITHER -- an Exit on the
 *  last card is indistinguishable from finishing. So the distinction lives here.
 *
 *  A container-local flag rather than an `endReason` field on `GameState`
 *  (decision 2). That keeps Phase 3's reducer, its types, its persistence format
 *  and its passing test suite untouched for what is purely a presentation
 *  question -- a phase declared complete does not get reopened to decide which
 *  screen to show.
 *
 *  It is phrased as a DESTINATION rather than as the plan's `'exited' |
 *  'finished' | null` reason, because the reason turned out to have a third
 *  case it could not express: "New playlist" from the end screen also has to
 *  reach the landing screen, and the reducer has no action that returns
 *  `ended` to `idle` -- deliberately, since there is nothing to un-end. Naming
 *  the destination instead makes all three paths one concept: Exit and New
 *  playlist both mean `landing`, and only a deck that ran out means `end-screen`.
 *
 *  Ephemeral by design either way. `END` already clears the saved session, so
 *  after a refresh there is nothing to resume and the landing screen is correct
 *  whichever way the game ended. Losing this on reload loses nothing.
 * ===========================================================================
 */
type EndedView = 'end-screen' | 'landing';

export interface AppProps {
  /**
   * Both injectable for `App.test.tsx`, which drives the whole flow from a stubbed fetch and a
   * stubbed storage. Undefined in the real app, where the hooks fall back to `localStorage` and the
   * global `fetch` -- the same shape `useGameSession` already uses for storage.
   */
  storage?: StorageLike;
  fetchImpl?: PlaylistFetch;
}

export default function App({ storage, fetchImpl }: AppProps = {}) {
  const {
    state,
    currentCard,
    isCurrentYearPending,
    cardsRemaining,
    // `resolvedCount` is deliberately NOT taken from the hook any more: the preparing screen's
    // "N of M years found" line was removed, and it was this container's only consumer. The
    // selector stays exported beside the reducer with its own tests -- a progress readout is an
    // obvious thing for a later phase to want back, and it would want it from there.
    start,
    flip,
    next,
    end,
  } = useGameSession(storage ? { storage } : {});
  const {
    state: requestState,
    request,
    reset: resetRequest,
  } = usePlaylist(fetchImpl ? { fetchImpl } : {});

  const [endedView, setEndedView] = useState<EndedView>('end-screen');

  /**
   * The notices from the fetch, held here rather than read from `requestState`.
   *
   * Two reasons. `requestState` is reset when the player asks for another playlist, which would
   * take a notice with it mid-game; and DISMISSAL has to live above the game screen so it survives
   * every card change (decision 9) -- a banner that reappeared on each advance would be worse than
   * no banner at all.
   */
  const [notice, setNotice] = useState<{ truncated: boolean; skippedCount: number } | null>(null);

  /**
   * The result already dealt, by identity.
   *
   * The guard cannot be `status === 'idle'`, which is the obvious version and is wrong: after an
   * Exit the session sits at `ended` while the landing screen is on screen, so a deck fetched from
   * there would never be dealt. Comparing the RESULT OBJECT instead is right regardless of what the
   * session's status happens to be, and it is also what makes the effect idempotent under
   * StrictMode's double invocation.
   */
  const dealtResultRef = useRef<PlaylistResult | null>(null);

  /**
   * Deal the deck once a fetch succeeds.
   *
   * In an effect, not in the render body: `start()` calls `clearSession()`, which touches
   * `localStorage`, and a side effect during render is exactly what StrictMode's double render
   * exists to expose. The cost is one extra frame of the landing screen -- with its submit button
   * already showing its loading state, so nothing looks stalled.
   */
  useEffect(() => {
    if (requestState.status !== 'loaded') return;

    const { result } = requestState;
    if (dealtResultRef.current === result) return;
    dealtResultRef.current = result;

    setNotice({ truncated: result.truncated, skippedCount: result.skippedCount });
    setEndedView('end-screen');
    start(result.cards, result.playlist);
  }, [requestState, start]);

  const handleExit = useCallback(() => {
    // Order matters: the destination must be set before the status changes, or the end screen
    // renders for one frame on the way to the landing screen.
    //
    // `GameScreen` has already stopped the audio by the time this runs -- it calls `stop()` before
    // `onExit` for exactly this reason, so a pending `play()` cannot outlive the screen.
    setEndedView('landing');
    end();
  }, [end]);

  const handleRestart = useCallback(() => {
    // From `state.deck`, NOT from a remembered fetch result (decision 10). Reshuffling an already
    // shuffled deck with a fresh seed is equally random, it costs ZERO year lookups because the
    // resolved years travel with the cards, and it works after a RESUMED session -- where the
    // original `/api/playlist` response no longer exists in memory.
    //
    // No seed argument, so `START` generates a new one and the order actually changes.
    if (state.playlist) start(state.deck, state.playlist);
  }, [start, state.deck, state.playlist]);

  const handleNewPlaylist = useCallback(() => {
    setEndedView('landing');
    setNotice(null);
    // The session is already `ended` and its save already cleared by `END`, so clearing the request
    // is all that is left. `endedView` is what actually puts the landing screen on screen.
    resetRequest();
  }, [resetRequest]);

  /**
   * A deck that ended with nothing in it, which is not a game that finished.
   *
   * ===========================================================================
   *  THE PLAYER GETS THE LANDING SCREEN AND A WARNING, NOT THE END SCREEN.
   *
   *  A card whose year lookup finds nothing is REMOVED from the deck
   *  (`gameReducer`, `YEAR_RESOLVED`). When that happens to every card the deck
   *  empties and the reducer moves to `ended` -- correctly, since there is
   *  nothing left to play -- but `ended` previously meant the end screen, which
   *  then read **"Deck finished"** over `cardsPlayed={0}`. That announces a
   *  completed game to somebody who never saw a single card, and it says nothing
   *  about why.
   *
   *  `state.deck.length === 0` is the whole condition and it is exact: every
   *  other route to `ended` leaves the cards that were played in the deck --
   *  natural exhaustion stops on the last card, and Exit does not empty it. So
   *  an empty deck at `ended` can only mean "there was never anything to play".
   *
   *  Derived here rather than added to `GameState` as an `endReason`, for the
   *  same reason `endedView` is a container flag (decision 2): which screen an
   *  ended session shows is a presentation question, and Phase 3's reducer, its
   *  types, its persistence format and its passing tests do not get reopened to
   *  answer one. The reducer already carries the fact; this reads it.
   *
   *  All three of the reducer's empty-deck exits land here, which is what makes
   *  it worth deriving rather than special-casing: `YEAR_RESOLVED` (the common
   *  one), `START` with nothing dealable, and `RESUME` of a pre-reversal save
   *  whose every card was yearless.
   * ===========================================================================
   */
  const deckCollapsed = state.status === 'ended' && state.deck.length === 0;

  /**
   * The landing screen, shared by the states that show it: a fresh session, a session that has ended
   * with the player heading back, and a deck that collapsed. Extracted so the loading and error
   * props cannot drift between them -- the exit path submits playlists too.
   *
   * The three error sources are mutually exclusive in practice and ordered anyway. A fetch error
   * wins, because it describes the request the player just made; `no-years-found` describes the one
   * before it. And both are suppressed while a new request is in flight, so a warning about the last
   * playlist does not sit over a spinner for the next one.
   */
  const startFailureCode: StartFailureCode | undefined =
    requestState.status === 'error'
      ? requestState.code
      : deckCollapsed && requestState.status !== 'loading'
        ? 'no-years-found'
        : undefined;

  const landing = (
    <LandingScreen
      onSubmit={request}
      isLoading={requestState.status === 'loading'}
      {...(startFailureCode ? { errorCode: startFailureCode } : {})}
    />
  );

  /**
   * The notice banner, or null. Built once and given to whichever screen is showing, because it has
   * to appear on `preparing` AND survive into `playing`: the card-1 gate can be shorter than the
   * time it takes to read a sentence, and a notice nobody can read is not a notice (decision 9).
   */
  const noticeBanner =
    (notice === null || (!notice.truncated && notice.skippedCount === 0)) &&
    !state.yearLookupsUnavailable ? null : (
      <NoticeBanner
        truncated={notice?.truncated ?? false}
        skippedCount={notice?.skippedCount ?? 0}
        // The one notice that comes from game state rather than from the fetch: no
        // `MUSICBRAINZ_USER_AGENT` on the server means no card will ever get a year.
        yearLookupsUnavailable={state.yearLookupsUnavailable}
        onDismiss={() => {
          setNotice(null);
        }}
      />
    );

  // =========================================================================
  //  THE STATUS SWITCH
  // =========================================================================

  if (state.status === 'idle') return landing;

  if (state.status === 'ended') {
    // Checked BEFORE `endedView`, because a collapsed deck is not a destination the player chose --
    // `endedView` is still `end-screen` from the `START` that dealt it, and honouring that would
    // show "Deck finished" for a game that never began. See `deckCollapsed`.
    if (deckCollapsed) return landing;

    // Exit and "New playlist" both mean `landing`; only a deck that ran out gets the end screen.
    if (endedView === 'landing') return landing;

    return (
      <EndScreen
        // The deck's length, not `currentIndex + 1`: a natural finish means every card was played,
        // and the reducer leaves `currentIndex` on the LAST card rather than one past the end.
        cardsPlayed={state.deck.length}
        playlistName={state.playlist?.name ?? ''}
        onRestart={handleRestart}
        onNewPlaylist={handleNewPlaylist}
      />
    );
  }

  if (state.status === 'preparing') {
    return <PreparingScreen notice={noticeBanner} />;
  }

  // `playing`. `currentCard` is guarded because `noUncheckedIndexedAccess` makes the selector
  // genuinely optional -- the reducer clamps `currentIndex`, so an empty deck is the only way
  // here, and the client rejects an empty deck before `start` is ever called.
  if (!currentCard) return landing;

  return (
    /*
      The fallback is the screen the player is ALREADY on: `playing` is only ever entered from
      `preparing`, so a game chunk still in flight simply leaves the preparing screen up -- same
      notice, same spinner, no flash of anything new. In practice the chunk is usually already
      warm, because the card-1 gate gives it the whole year lookup to arrive in.
    */
    <Suspense fallback={<PreparingScreen notice={noticeBanner} />}>
      <GameScreen
        deck={state.deck}
        currentIndex={state.currentIndex}
        isFlipped={state.isFlipped}
        isYearPending={isCurrentYearPending}
        onFlip={flip}
        onNext={next}
        onExit={handleExit}
        // `status === 'playing'` is the whole condition, and reaching this line is that condition.
        // Derived here because `GameScreen` deliberately knows nothing about `GameStatus`.
        isPlayable
        cardsRemaining={cardsRemaining}
        playlistName={state.playlist?.name ?? ''}
        notice={noticeBanner}
      />
    </Suspense>
  );
}
