/**
 * The React seam over `fetchPlaylist`: one request at a time, with its state.
 *
 * ===========================================================================
 *  DELIBERATELY THIN, AND NOT UNIT-TESTED FOR THAT REASON.
 *
 *  Every decision worth asserting -- which status maps to which code, what a
 *  valid 200 body looks like, what happens to a 200 that is not JSON -- lives
 *  in `playlist-client.ts`, where it is covered offline in the node
 *  environment with no jsdom. This file adds a `useState`, an `AbortController`
 *  and a stale-response guard, and nothing else.
 *
 *  The same rule `use-game-session.ts` states about itself applies here:
 *  **any logic that starts accumulating here belongs in the client instead.**
 *  A branch added here is a branch nothing tests. `App.test.tsx` exercises this
 *  file end to end through the container, which is the right altitude for
 *  wiring -- but it is not a substitute for the client's own coverage.
 * ===========================================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPlaylist } from '../game/playlist-client';
import type { PlaylistClientErrorCode, PlaylistFetch } from '../game/playlist-client';
import type { PlaylistResult } from '../../shared/types';

/**
 * The request's state, as a discriminated union rather than three booleans.
 *
 * `idle` and `loading` are distinguishable because the landing screen renders differently for
 * "you have not asked yet" and "we are asking" -- and a `loading` flag plus an `error` field
 * permits the impossible combination of both at once.
 */
export type PlaylistRequestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: PlaylistClientErrorCode }
  | { status: 'loaded'; result: PlaylistResult };

export interface UsePlaylistOptions {
  /**
   * Defaults to the global `fetch`. Injectable so `App.test.tsx` can drive the whole flow from
   * a stub -- the same reason `useGameSession` takes an injectable `storage`.
   */
  fetchImpl?: PlaylistFetch;
}

export interface UsePlaylistResult {
  state: PlaylistRequestState;
  /** Fetch a deck for this URL. Aborts any request already in flight. */
  request: (url: string) => void;
  /** Back to `idle`, without firing a request. What the landing screen calls on a fresh edit. */
  reset: () => void;
}

export function usePlaylist(options: UsePlaylistOptions = {}): UsePlaylistResult {
  const [state, setState] = useState<PlaylistRequestState>({ status: 'idle' });

  /**
   * The controller for the request in flight, so a second submission can cancel the first.
   *
   * Without this, two submissions race and the SLOWER one wins by landing last -- the player
   * pastes playlist A, changes their mind, submits B, and gets A's deck. The abort makes the
   * ordering irrelevant rather than merely unlikely.
   */
  const controllerRef = useRef<AbortController | null>(null);

  /**
   * Whether this hook is still mounted.
   *
   * An abort makes the client return `network`, which would otherwise be written into state
   * after unmount. Harmless in React 19 (no warning any more) but still a wasted render on a
   * dead tree, and the guard is what makes the abort's meaning unambiguous: "we no longer care",
   * not "the network failed".
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  /**
   * `fetch` read through a ref rather than captured in the callback's closure, so passing a fresh
   * inline `fetchImpl` cannot change `request`'s identity on every render and re-trigger whatever
   * effect a caller has hung off it.
   *
   * Written in an EFFECT, not during render: `eslint-plugin-react-hooks` rejects a ref write in a
   * render body, correctly -- it makes the render impure. The initial `useRef` argument already
   * captures the first value, and `request` is only ever called from an event handler, so there is
   * no window in which the ref is behind. Same pattern `use-game-session.ts` uses for its
   * `stateRef`.
   */
  const fetchImplRef = useRef(options.fetchImpl);
  useEffect(() => {
    fetchImplRef.current = options.fetchImpl;
  });

  const request = useCallback((url: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState({ status: 'loading' });

    void (async () => {
      const outcome = await fetchPlaylist(url, {
        // BOUND to the global. The native `fetch` is brand-checked, and passing it unbound made
        // every Start fail as `network` ("Could not reach the server") for a request that never
        // left the page. `fetchPlaylist` no longer calls it as a method either; both halves stay.
        fetchImpl: fetchImplRef.current ?? (globalThis.fetch.bind(globalThis) as PlaylistFetch),
        signal: controller.signal,
      });

      // Two guards, and they answer different questions: is this hook still alive, and is this
      // response the one we are still waiting for. A response from an aborted request can
      // arrive after a newer one has already resolved.
      if (!isMountedRef.current) return;
      if (controllerRef.current !== controller) return;

      setState(
        outcome.ok
          ? { status: 'loaded', result: outcome.result }
          : { status: 'error', code: outcome.code },
      );
    })();
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: 'idle' });
  }, []);

  return { state, request, reset };
}
