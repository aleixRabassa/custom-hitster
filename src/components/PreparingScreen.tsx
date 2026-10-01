/**
 * The card-1 gate's loading screen -- and the ONLY status a loading screen may render for.
 *
 * ===========================================================================
 *  COUNT-ONLY. NO TITLES, NO ARTISTS, NO YEARS, EVER.
 *
 *  A loading screen is a leak surface exactly as a card face is (findings #6
 *  names loading screens and progress text explicitly), and it is the one most
 *  likely to be forgotten -- "Looking up Bohemian Rhapsody…" is the natural,
 *  helpful thing to write, and it spoils the first card before the game starts.
 *
 *  A NUMBER would be safe -- "3 of 42 years found" says nothing about which
 *  tracks or which years -- and this screen showed exactly that until it was
 *  REMOVED as a product call: the count read as a progress bar that had to reach
 *  the total, when the wait is one lookup. Nothing replaced it, because the only
 *  other vocabulary available here is a smaller number.
 * ===========================================================================
 *
 * ## What this screen is actually waiting for, and what it is not
 *
 * ONE lookup. `preparing` ends when card 1's lookup COMPLETES -- not when it produces a year, and
 * not when the deck is resolved (`reducer.ts`'s card-1 gate). So the wait is 1.3–3.6 s on a cold
 * cache and 0 ms on a warm one, never the minutes a whole deck takes. The copy below promises
 * exactly that and no more, because a loading screen that implies a longer wait than it has is how
 * a player closes the tab.
 *
 * It also must NOT assume it will only ever leave on a resolved year. A deployment with no
 * `MUSICBRAINZ_USER_AGENT` dispatches `YEAR_LOOKUPS_UNAVAILABLE`, and the reducer moves to
 * `playing` anyway with `yearLookupsUnavailable` set -- so this screen can be replaced by the game
 * having resolved nothing at all. Nothing here may block on `resolvedCount > 0`.
 */

import { useCopy } from '../hooks/useLocale';
import { FloatingNotice } from './FloatingNotice';
import { Footer } from './Footer';
import { Spinner } from './Spinner';
import type { ReactNode } from 'react';

export interface PreparingScreenProps {
  /**
   * The notice banner, or null.
   *
   * Rendered here as well as on the game screen, and the container owns the dismissal state so it
   * survives the transition between the two. A notice shown only on this screen would frequently
   * appear and vanish inside a second (decision 9).
   */
  notice?: ReactNode;
}

export function PreparingScreen({ notice }: PreparingScreenProps) {
  const copy = useCopy();
  return (
    /*
      `relative pb-20` is `Footer`'s contract, and the band is the SAME on all four screens as of
      2026-08-12: the footer is `absolute bottom-8` and 80px is what puts 32px above the line and
      32px below it. See `Footer.tsx`; `PreparingScreen.test.tsx` asserts both.
    */
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-4 bg-page p-6 pb-20 text-fg">
      {/*
        OUT OF FLOW since 2026-10-01, as on the game screen and for the same reason (the developer's
        request: the content keeps one fixed position whether a notice is up or not). As the
        column's first row the banner pushed the spinner and both lines down by half its height,
        and they jumped back up when it was closed or faded. `FloatingNotice` anchors it to the
        status block's top edge, so it grows UPWARD and the column lays out exactly as if it were
        not there. `GameScreen.tsx` records the cost on a short phone; here the content is three
        short lines, so the space above is far larger.
      */}
      <FloatingNotice notice={notice} gap="mb-4">
        {/*
          `role="status"` rather than `role="alert"`: this is a progress report, so it should be
          announced politely without interrupting whatever a screen reader is already saying.
        */}
        <div role="status" className="flex flex-col items-center gap-3 text-center">
          {/*
          Under `prefers-reduced-motion: reduce` this is HIDDEN rather than stopped (decision 7) --
          `Spinner` holds the reasoning and the `data-motion` hook. What matters HERE is the
          consequence: the two lines below have to carry every piece of information it conveys,
          because a reduced-motion player sees no spinner at all. They do -- "Dealing your deck…" is
          itself the statement that work is in progress, which is what let the resolved/total count
          decision 7 originally leaned on be removed without weakening the claim.
        */}
          <Spinner />

          <p className="text-lg font-medium">{copy.preparing.heading}</p>

          {/*
          Sets the expectation honestly: the wait is one lookup, not the whole deck.

          It used to sit under an "N of M years found" line and exists BECAUSE of it -- without the
          sentence, a count that starts at 0 of 42 reads as a progress bar that has to fill, which
          makes a one-second wait feel like a stalled forty-two-step one. The count is gone now and
          the sentence stays: it is the only thing on the screen that says the game is about to
          start rather than that a long job is running.
        */}
          <p className="max-w-narrow text-xs text-fg-muted">{copy.preparing.detail}</p>
        </div>
      </FloatingNotice>

      {/*
        Rendered here as well as on the landing and end screens, even though this screen lives for
        about a second: leaving it out would make the copyright line FLICKER as the player moves
        landing -> preparing -> back, which is more noticeable than the line itself. The game screen
        is the one deliberate omission -- `Footer` explains why.
      */}
      <Footer />
    </main>
  );
}
