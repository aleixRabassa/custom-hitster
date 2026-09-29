/**
 * The question asked when a share link is opened over a saved game: keep it, or play the link.
 *
 * ===========================================================================
 *  DECISION D4 OF THE SHUFFLE-SYSTEM REVIEW (2026-09-29), AND IT REVERSES
 *  "A SAVED SESSION OUTRANKS A LINK, SILENTLY".
 *
 *  Before this, a link opened over a game in progress was ignored: the saved
 *  game resumed and the link did nothing, so a player sent a mid-game link
 *  never saw the shared position at all. Now they are asked. The container
 *  decides WHEN -- only for a link that is not the saved deck's own, so a reload
 *  of a link-opened tab mid-game resumes with no question (D2) -- and this
 *  screen only asks.
 * ===========================================================================
 *
 * ## A SCREEN, not an overlay
 *
 * The container renders it as its own branch, before the status switch, so no game screen is
 * mounted underneath: there is no card behind a backdrop, no key handler to suspend and no audio
 * element to silence. That is why it is a `<main>` with `Footer`'s `relative pb-20` contract like
 * every other screen, rather than a `fixed` panel like `ExitConfirmDialog`.
 *
 * ## Keep is the safe default, as Cancel is in the exit dialog
 *
 * "Keep my game" is first in the DOM and takes focus on mount, so an Enter pressed reflexively on a
 * page that has just loaded keeps the game the player already had. Replacing is one deliberate
 * press away -- and even that press does not destroy anything by itself: the saved game is replaced
 * only when the shared deck actually DEALS, so a link whose fetch fails leaves it intact, and this
 * screen says so under the error.
 *
 * ## Nothing here may leak, and there is nothing to leak
 *
 * It takes no card, no deck and no playlist name -- only two callbacks, a flag and an error code --
 * so every string below comes from the copy catalogue. `ReplaceSessionPrompt.test.tsx` audits the
 * rendered text and attributes anyway, because "it has nothing to leak" is exactly the property a
 * later "show which playlist the link is for" edit would quietly change.
 */

import { useEffect, useRef } from 'react';

import { Footer } from './Footer';
import { Spinner } from './Spinner';
import { playlistErrorMessage } from '../game/messages';
import type { StartFailureCode } from '../game/messages';
import { useLocale } from '../hooks/useLocale';

export interface ReplaceSessionPromptProps {
  /** Keep my saved game -- the container resumes it. */
  onKeep: () => void;
  /**
   * Play the shared deck. The container fetches the link; the saved game is replaced only when the
   * new deck deals, never on the press itself.
   */
  onReplace: () => void;
  /** The link's fetch is in flight after `onReplace`. */
  isLoading: boolean;
  /**
   * The link's fetch failed. The saved game is intact, "Keep my game" still works, and the replace
   * button becomes a retry.
   */
  errorCode?: StartFailureCode;
}

/** The disabled pair both buttons share, because both are disabled for the whole of a request. */
const DISABLED_CLASSES = 'disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';

export function ReplaceSessionPrompt({
  onKeep,
  onReplace,
  isLoading,
  errorCode,
}: ReplaceSessionPromptProps) {
  const { copy, errorMessages } = useLocale();
  const keepRef = useRef<HTMLButtonElement>(null);

  /**
   * Focus the safe answer on arrival.
   *
   * No restore on the way out, unlike `ExitConfirmDialog`: this screen appears on page load, so
   * there is no opener to give focus back to -- the next screen is a different screen.
   */
  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    /*
      `relative pb-20` is `Footer`'s contract, the same band as on every other screen: the footer
      is `absolute bottom-8` and 80px is what puts 32px above the line and 32px below it. See
      `Footer.tsx`; `ReplaceSessionPrompt.test.tsx` asserts both.
    */
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-8 bg-page p-6 pb-20 text-fg">
      <section className="flex w-full max-w-content flex-col gap-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{copy.replaceSession.heading}</h1>
          <p className="text-sm text-fg-secondary">{copy.replaceSession.body}</p>
        </div>

        <div className="flex flex-col gap-3">
          {/*
            First in the DOM and filled, so reading order, tab order and visual weight all point at
            the answer that loses nothing. Disabled while the link loads: a press mid-request would
            race the fetch it did not cancel.
          */}
          <button
            ref={keepRef}
            type="button"
            onClick={onKeep}
            disabled={isLoading}
            className={`touch-target rounded-lg bg-accent px-6 py-4 text-lg font-semibold text-on-accent hover:bg-accent-hover focus-visible:focus-ring ${DISABLED_CLASSES}`}
          >
            {copy.replaceSession.keep}
          </button>

          <button
            type="button"
            onClick={onReplace}
            disabled={isLoading}
            className={`touch-target flex items-center justify-center gap-3 rounded-lg border border-border-strong px-4 py-3 font-medium text-fg hover:border-border-hover focus-visible:focus-ring ${DISABLED_CLASSES}`}
          >
            {/*
              The spinner is HIDDEN under reduced motion (see `Spinner`), so the label beside it
              carries the whole of "loading" on its own -- a spinner-only button would render empty.
            */}
            {isLoading ? <Spinner /> : null}
            <span>
              {isLoading
                ? copy.replaceSession.replacing
                : errorCode === undefined
                  ? copy.replaceSession.replace
                  : copy.replaceSession.retry}
            </span>
          </button>

          {/*
            The link's failure, in the same words and the same slot shape as the picker's own
            request error -- `role="alert"`, because otherwise a screen-reader user gets no signal
            that the press failed at all. Hidden while a retry is loading, since it describes the
            attempt before it.

            The second sentence answers the question a player has next: the fetch failed, so the
            deck was never dealt, so nothing replaced their game.
          */}
          {errorCode === undefined || isLoading ? null : (
            <div role="alert" className="flex flex-col gap-1 text-sm">
              <p className="text-danger">{playlistErrorMessage(errorCode, errorMessages)}</p>
              <p className="text-fg-secondary">{copy.replaceSession.savedGameIntact}</p>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
