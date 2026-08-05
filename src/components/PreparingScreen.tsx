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
 *  A NUMBER is safe: "3 of 42 years found" says nothing about which tracks or
 *  which years. That is the whole vocabulary available here.
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

import type { ReactNode } from 'react';

export interface PreparingScreenProps {
  /** How many cards have a completed lookup, from `resolvedCount`. Resolved or not-found alike. */
  resolvedCount: number;
  /** The deck's size, from `state.deck.length`. */
  totalCount: number;
  /**
   * The notice banner, or null.
   *
   * Rendered here as well as on the game screen, and the container owns the dismissal state so it
   * survives the transition between the two. A notice shown only on this screen would frequently
   * appear and vanish inside a second (decision 9).
   */
  notice?: ReactNode;
}

export function PreparingScreen({ resolvedCount, totalCount, notice }: PreparingScreenProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page p-6 text-fg">
      {notice}

      {/*
        `role="status"` rather than `role="alert"`: this is a progress report, so it should be
        announced politely without interrupting whatever a screen reader is already saying.
      */}
      <div role="status" className="flex flex-col items-center gap-3 text-center">
        {/*
          A plain CSS spin, and under `prefers-reduced-motion: reduce` it is HIDDEN rather than
          stopped (decision 7). A stationary spinner is a dead grey circle that reads as a hung
          app, and this element is already `aria-hidden` -- so removing it costs nothing, because
          the status line and the resolved/total count below carry every piece of information it
          conveys. The rule itself is in `src/index.css`, keyed on `data-motion="spinner"`; no
          component in this app reads the preference (decision 3), which is what stops the next
          animation added from being silently unhandled.
        */}
        <div
          aria-hidden="true"
          data-motion="spinner"
          className="size-(--size-spinner) animate-spin rounded-full border-2 border-border-strong border-t-accent-bright"
        />

        <p className="text-lg font-medium">Dealing your deck…</p>

        {/*
          Count-only, and the number is the ONLY thing this screen knows how to say about the deck.
          Rendered even at 0 so the line does not appear and shift the layout a moment later.
        */}
        <p className="text-sm text-fg-secondary">
          {resolvedCount} of {totalCount} years found
        </p>

        {/*
          Sets the expectation honestly: the wait is one lookup, not the whole deck. Without this
          the count above reads as a progress bar that has to reach the total, which would make a
          one-second wait feel like a stalled forty-two-step one.
        */}
        <p className="max-w-narrow text-xs text-fg-muted">
          The game starts as soon as the first card is ready — the rest fill in while you play.
        </p>
      </div>
    </main>
  );
}
