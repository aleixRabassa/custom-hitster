/**
 * The notice banner's slot, floated just above the block it is anchored to (2026-10-01).
 *
 * Shared by `GameScreen` (anchored to the HUD) and `PreparingScreen` (anchored to the status
 * block), so the anchoring is written once. The developer's request was the same on both screens:
 * the content keeps one fixed position whether a notice is up, fading or gone. A banner that is a
 * row of a `justify-center` column moves everything below it when it comes and goes; one placed
 * ABSOLUTELY on the anchor's top edge (`bottom-full`) grows UPWARD into the space above, and the
 * column lays out exactly as if there were no banner.
 *
 * The cost, stated in `GameScreen.tsx` and as a row in docs/development.md §5: on a phone short
 * enough that the column already fills the screen, the banner can reach past the top padding.
 *
 * `gap` is a closed union rather than a class name, so a caller can pick a spacing but cannot
 * hand the slot a different position and reopen the drift this component exists to close.
 */

import type { ReactNode } from 'react';

interface FloatingNoticeProps {
  /** The notice banner, or null -- with no notice the slot is not rendered at all. */
  notice?: ReactNode;
  /** The space between the banner and the top of `children`. */
  gap: 'mb-3' | 'mb-4';
  /** The block the banner sits on top of. */
  children: ReactNode;
}

export function FloatingNotice({ notice, gap, children }: FloatingNoticeProps) {
  return (
    <div className="relative flex w-full flex-col items-center">
      {notice == null ? null : (
        <div
          data-testid="notice-slot"
          className={`absolute inset-x-0 bottom-full ${gap} flex justify-center`}
        >
          {notice}
        </div>
      )}

      {children}
    </div>
  );
}
