/**
 * The last line of defence: a render exception anywhere in the tree becomes a screen a player can
 * act on, instead of a white page.
 *
 * ===========================================================================
 *  THE FALLBACK MUST NEVER RENDER THE ERROR'S MESSAGE OR ITS STACK.
 *
 *  This is the same leak rule `CardHiddenSide.tsx` and `Hud.tsx` carry, applied
 *  to the one surface that only exists once something has already gone wrong --
 *  which is precisely when nobody is auditing.
 *
 *  Every prop and every piece of state in this app flows through the tree this
 *  component is catching, and the deck is in it. So an error string can quote a
 *  track title, an artist or a YEAR:
 *
 *    "Cannot read properties of undefined (reading 'x')" is harmless, but
 *    "Invalid year 1975 for Bohemian Rhapsody" is the answer to the card the
 *    player is looking at, and a stack trace can carry a serialized prop.
 *
 *  "Show the error so the player can report it" is the natural next change, and
 *  it is the one that turns a crash screen into a spoiler. THE CONSOLE IS WHERE
 *  THE DETAIL GOES -- `componentDidCatch` logs it below. That is not a rendered
 *  surface, so a developer keeps everything they need while the page stays
 *  generic. `ErrorBoundary.test.tsx` throws an error whose message contains a
 *  track title and asserts the string is absent from the document.
 * ===========================================================================
 *
 * ## Why this is a class, and the only one in the app
 *
 * `componentDidCatch` and `getDerivedStateFromError` have NO hook equivalent -- React has never
 * shipped one -- and the alternative was a dependency (`react-error-boundary`) for something that
 * is thirty lines. So the house rule "presentational React, props in and callbacks out" holds here
 * in spirit while the file is a class by necessity.
 *
 * ## Why it wraps `<App />` from OUTSIDE, in `main.tsx`
 *
 * Inside `App` it would be unmounted by the very error it exists to catch -- a boundary can only
 * catch what is BELOW it, and an exception thrown in `App`'s own render would pass straight through
 * a boundary rendered by that same render. Outside, the boundary's own render never depends on
 * anything the game touches, so there is nothing in it left to break.
 *
 * ## The two recovery actions are not the same button
 *
 * **Reload** for a transient failure -- a bad frame, a race -- and it PRESERVES the saved session,
 * so a player drops back into the deck they were playing.
 *
 * **Start over** clears the save first. This is the one that matters: a corrupt or unexpected
 * persisted session is the most plausible cause of a crash that recurs on EVERY reload, and without
 * this button that state is unescapable except through devtools. The cost is real -- it destroys a
 * game in progress -- so the consequence is written next to the button rather than hidden in it.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { clearSession } from '../game/persistence';
import type { StorageLike } from '../game/persistence';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Where the session save lives. Defaults to `localStorage`.
   *
   * Injected exactly as `useGameSession` injects it, and for the same reason: it is what lets the
   * Start over path be asserted against a three-line in-memory double. Read LAZILY, inside the
   * handler, so that a `localStorage` that throws on access (Safari private mode) cannot take out
   * the error screen itself.
   */
  storage?: StorageLike;
  /**
   * How to reload the page. Defaults to `window.location.reload()`.
   *
   * Injected because jsdom implements no navigation: a real `reload()` in a test logs a
   * "Not implemented" error and does nothing, which would make both button tests assert against a
   * page that never reloaded.
   */
  reload?: () => void;
}

interface ErrorBoundaryState {
  /**
   * A BOOLEAN, not the error.
   *
   * Holding the `Error` in state would make it one `{state.error.message}` away from being
   * rendered, and that is the whole leak. Nothing about the error survives past the console log,
   * which is a constraint enforced by the type rather than by remembering.
   */
  hasCrashed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasCrashed: false };

  /** Flips to the fallback. Takes the error only to discard it -- see `ErrorBoundaryState`. */
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasCrashed: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    // THE ONE PLACE THE DETAIL BELONGS. A console is not a rendered surface, so the full error and
    // the component stack are both safe here and both are what a developer actually needs.
    console.error('[error-boundary] render failed:', error, errorInfo.componentStack);
  }

  private handleReload = (): void => {
    // The save is deliberately left alone: this path is for a transient failure, and a player who
    // was mid-deck should land back in it.
    this.doReload();
  };

  private handleStartOver = (): void => {
    /*
      Cleared through `persistence.ts`'s own function rather than by touching `localStorage` here.
      It owns the key -- including the `v1` segment -- and it already swallows a storage that
      throws, which matters more here than anywhere else: this is the escape hatch, so it must not
      be able to fail in a way that leaves the player stuck on this screen.
    */
    const storage = this.props.storage ?? readLocalStorage();
    if (storage) clearSession(storage);

    this.doReload();
  };

  private doReload(): void {
    const reload = this.props.reload ?? (() => window.location.reload());
    reload();
  }

  render(): ReactNode {
    if (!this.state.hasCrashed) return this.props.children;

    return (
      <main
        /*
          `role="alert"` so the screen is ANNOUNCED. A crash replaces the whole page with no
          keystroke and no focus change, so without it a screen-reader user is left on a page that
          silently became something else.
        */
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page p-6 text-fg"
      >
        <div className="flex max-w-content flex-col gap-3 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>

          {/*
            GENERIC, and it stays generic. No message, no stack, no code -- see the header block.
            It says what happened, what to try, and where a developer should look, which is
            everything that can be said without quoting the error.
          */}
          <p className="text-sm text-fg-secondary">
            The game hit an unexpected problem and had to stop. Reloading usually fixes it. Details
            were written to the browser console.
          </p>
        </div>

        {/*
          Reload first in the DOM, so reading order, visual order and tab order agree and the
          destructive action is last in all three -- the same ordering `ExitConfirmDialog` uses.
        */}
        <div className="flex w-full max-w-content flex-col gap-3">
          <button
            type="button"
            onClick={this.handleReload}
            className="touch-target rounded-lg bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover focus-visible:focus-ring"
          >
            Reload
          </button>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={this.handleStartOver}
              className="touch-target rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring"
            >
              Start over
            </button>

            {/*
              The consequence, next to the button rather than inside it. A label long enough to
              carry it ("Start over and delete the saved game") stops looking like a button, and a
              player who has just been shown a crash screen is not reading carefully -- so the
              short label goes on the control and the cost goes underneath it, where it is still
              read out with the button by a screen reader following the same reading order.
            */}
            <p className="text-xs text-fg-muted">
              Clears the saved game first. Use this if reloading keeps failing — any game in
              progress is lost.
            </p>
          </div>
        </div>
      </main>
    );
  }
}

/**
 * `localStorage`, or nothing.
 *
 * Reading the property can THROW rather than return null -- Safari in private mode has historically
 * done exactly that -- and a throw here would be an exception inside the error screen, i.e. a white
 * page in the one component whose job is to prevent one. Failing to clear a save is a much better
 * outcome than that.
 */
function readLocalStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
