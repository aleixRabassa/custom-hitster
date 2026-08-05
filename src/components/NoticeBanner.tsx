/**
 * The three non-blocking notices, as a dismissible banner.
 *
 * ===========================================================================
 *  NO NOTICE HERE MAY EVER GATE START.
 *
 *  Every one of these describes a deck that is already dealt and already
 *  playable: a playlist that may hold more tracks than we could read, a handful
 *  of unreadable entries left out, or a deployment with no year lookups at all.
 *  None of them is a reason to stop. A modal, a confirm step, or a disabled
 *  Start button here would turn three footnotes into three obstacles.
 * ===========================================================================
 *
 * Count-only, like every other pre-reveal surface: "3 tracks could not be read" names no track.
 *
 * ## Why this renders on the preparing screen AND the game screen
 *
 * `preparing` is ONE lookup -- 0 ms on a warm cache. A notice shown only there would frequently
 * appear and vanish faster than a sentence can be read, which is not a notice. So the container
 * keeps it visible into `playing` until the player dismisses it, and dismissal is container state
 * so it cannot reappear on the next card (decision 9).
 */

import { MAX_EMBED_TRACKS } from '../../shared/constants';

export interface NoticeBannerProps {
  /**
   * From `PlaylistResult.truncated`. True when the track list came back at exactly
   * `MAX_EMBED_TRACKS`, which means the deck MAY be incomplete -- it cannot mean more than
   * "may", because the embed payload carries no total, no offset and no `hasMore`.
   */
  truncated: boolean;
  /** From `PlaylistResult.skippedCount`. Normally 0, so normally nothing renders. */
  skippedCount: number;
  /**
   * From `state.yearLookupsUnavailable`. The one notice derived from GAME state rather than from
   * the fetch: it means the server has no `MUSICBRAINZ_USER_AGENT`, so no card will ever get a
   * year. The deck is still playable -- the QR always works.
   */
  yearLookupsUnavailable: boolean;
  onDismiss: () => void;
}

export function NoticeBanner({
  truncated,
  skippedCount,
  yearLookupsUnavailable,
  onDismiss,
}: NoticeBannerProps) {
  const notices: string[] = [];

  if (truncated) {
    notices.push(
      `This playlist may have more tracks than shown — only the first ${MAX_EMBED_TRACKS} could be loaded.`,
    );
  }

  if (skippedCount > 0) {
    // Pluralised, because "1 tracks" in a message about data quality undermines the message.
    notices.push(
      skippedCount === 1
        ? '1 track could not be read and was left out.'
        : `${skippedCount} tracks could not be read and were left out.`,
    );
  }

  if (yearLookupsUnavailable) {
    notices.push(
      'Years are unavailable on this deployment, so cards will not show one. The deck is still playable — scan a card to hear the song.',
    );
  }

  // The common case: nothing applies, so nothing renders. Returning null rather than an empty
  // container matters because the caller lays this out in a flex column.
  if (notices.length === 0) return null;

  return (
    <div
      /*
        `role="status"`, not `alert`: these are footnotes about a working deck, and an assertive
        announcement would interrupt a screen reader mid-card to deliver a caveat.
      */
      role="status"
      data-testid="notice-banner"
      /*
        `max-w-(--card-width)` for the same reason as `Hud`: this banner sits above the card and
        was `max-w-sm` (24rem) against a card of 18rem, so on a wide screen it overhung the deck
        on both sides. Sharing the card's own width token makes them agree at every viewport.
      */
      className="flex w-full max-w-(--card-width) items-start gap-3 rounded-lg border border-warning-border/60 bg-warning-surface/40 px-3 py-2 text-xs text-warning-text"
    >
      <ul className="flex flex-1 flex-col gap-1">
        {notices.map((notice) => (
          // Keyed on the text itself: the list is derived from three independent booleans, so
          // there is no id to key on, and the strings are distinct by construction.
          <li key={notice}>{notice}</li>
        ))}
      </ul>

      {/*
        `touch-target` matters most here of anywhere in the app. This was `px-1` around a single ✕
        -- the smallest target in the app -- sitting above the card, which is the surface a thumb
        is nearest while swiping. A 44px square is the WCAG 2.5.5 minimum; `-my-1` absorbs the
        extra height back out of the banner's own box so the row does not grow.
      */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="-my-1 flex shrink-0 touch-target items-center justify-center rounded text-warning-glyph hover:text-warning-text focus-visible:focus-ring"
      >
        ✕
      </button>
    </div>
  );
}
