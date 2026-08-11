/**
 * The copyright line, as a `contentinfo` landmark.
 *
 * ===========================================================================
 *  IT IS RENDERED ON THE LANDING, PREPARING AND END SCREENS -- AND THE TWO
 *  SCREENS IT IS KEPT OFF ARE THE ONLY INTERESTING DECISIONS IN THIS FILE.
 *
 *  Every screen in this app is its own `min-h-dvh flex flex-col
 *  justify-center` column, so there is no shell to hang a footer on: a footer
 *  rendered once in `App.tsx` or `main.tsx` would be a SIBLING of a
 *  full-viewport column, which makes the page 100dvh + the footer's height and
 *  gives every screen a permanent scrollbar. Rendering it as the last child of
 *  each `<main>` costs nothing and keeps each screen self-contained -- the same
 *  reason `NoticeBanner` is passed in as a node rather than positioned globally.
 *
 *  THE GAME SCREEN IS EXCLUDED BECAUSE ITS COLUMN IS A HEIGHT BUDGET, NOT A
 *  PAGE. `--card-height` is `clamp(15rem, min(62dvh, 80vw), 24rem)` -- the card
 *  is sized against the viewport precisely so the HUD, the notice, the card, its
 *  caption and the control bar fit a phone without scrolling. A footer there
 *  spends about 40px of that budget (a 16px line plus the column's `gap-6`) on
 *  a legal line nobody reads mid-game, and on a short viewport it is the card
 *  that pays. It is also the one screen where the player is doing something
 *  continuous, and a `mt-auto` variant that pinned it to the bottom would be
 *  worse: auto margins beat `justify-center`, so the card would stop being
 *  centred.
 *
 *  THE CRASH SCREEN IS EXCLUDED FOR A DIFFERENT REASON: `ErrorBoundary`'s
 *  fallback is a `role="alert"`, so its WHOLE SUBTREE is what gets announced
 *  when the page silently becomes something else. A copyright line inside that
 *  is read out to a screen-reader user in the middle of being told the game
 *  crashed, which is the one place where adding text has a cost beyond pixels.
 *
 *  So the footer marks the app's screens at rest -- landing, preparing and the
 *  end screen -- which is also every screen a first-time visitor sees before
 *  they start playing.
 * ===========================================================================
 *
 * Presentational and propless, deliberately: the year is part of the string the developer
 * specified ("2026-present"), not something derived from the clock. A `new Date().getFullYear()`
 * here would be a value that changes underneath the tests once a year and cannot be asserted
 * without mocking time, in exchange for a range whose left end is fixed anyway.
 *
 * `text-fg-muted` is the app's audited dimmest text -- 6.12:1 on `--color-page` -- because a
 * copyright line is the lowest-priority text on any of these screens but is still content, so it
 * has to clear 4.5:1. Not an `opacity-*` on a brighter token: that would put a real ratio nowhere
 * in the repo. And named from the token rather than written as a literal grey, because an unknown
 * Tailwind colour utility in this app emits NO rule at all and fails silently (`CardHiddenSide`'s
 * history has the full story) -- `Footer.test.tsx` asserts the class for exactly that reason.
 */

/**
 * The exact string the developer asked for, as a constant so the test and the render cannot drift.
 *
 * The `©` is written literally, which is the convention in this repo already -- `—` and `…` appear
 * as literal characters in several components -- and is safe because every source file is UTF-8 and
 * Vite emits UTF-8. **It would NOT be safe on the PDF path**: `sanitizeForPdf` exists in
 * `src/game/pdf-text.ts` because jsPDF's standard fonts are WinAnsi-encoded, so a character outside
 * that set becomes mojibake in a printed deck. This string is screen-only and never reaches it.
 */
export const COPYRIGHT_NOTICE = 'Copyright © 2026-present Aleix Rabassa. All rights reserved.';

export function Footer() {
  return (
    /*
      A `<footer>` inside `<main>` is NOT a `contentinfo` landmark -- the role applies only when the
      element's nearest sectioning ancestor is the body -- and here that is the honest outcome rather
      than a compromise: each screen owns its own `<main>`, so this is that screen's footer and it
      should not claim to be the document's. It therefore stays out of the landmark list a
      screen-reader user navigates by, where a copyright line is noise.

      NO EXPLICIT `role`, and that is the part a future edit could get wrong: adding
      `role="contentinfo"` would make the landmark real in every browser, and three screens render
      this component. `Footer.test.tsx` asserts the absence -- and records that Testing Library maps
      `footer` to `contentinfo` regardless of ancestry, so a role QUERY cannot be used to check any
      of this.
    */
    <footer className="text-center text-xs text-fg-muted">{COPYRIGHT_NOTICE}</footer>
  );
}
