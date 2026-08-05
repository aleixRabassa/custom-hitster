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
      className="flex w-full max-w-sm items-start gap-3 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
    >
      <ul className="flex flex-1 flex-col gap-1">
        {notices.map((notice) => (
          // Keyed on the text itself: the list is derived from three independent booleans, so
          // there is no id to key on, and the strings are distinct by construction.
          <li key={notice}>{notice}</li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className="shrink-0 rounded px-1 text-amber-400 hover:text-amber-200"
      >
        ✕
      </button>
    </div>
  );
}
