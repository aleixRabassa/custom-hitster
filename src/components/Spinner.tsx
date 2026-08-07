/**
 * The app's one spinner, extracted on 2026-08-07 when the PDF export's year gate needed a second
 * one.
 *
 * ===========================================================================
 *  IT IS EXTRACTED FOR THE `data-motion` HOOK, NOT FOR THE FOUR CLASS NAMES.
 *
 *  Under `prefers-reduced-motion: reduce` this element is HIDDEN rather than
 *  stopped (Phase 7 plan 1, decision 7): a stationary spinner is a dead grey
 *  circle that reads as a hung app. The rule lives in `src/index.css`, keyed on
 *  `data-motion="spinner"`, and `index.css.test.ts` asserts the stylesheet names
 *  it -- no component in this app reads the preference (decision 3), which is
 *  what stops the next animation added from being silently unhandled.
 *
 *  A hand-rolled second copy of this markup is one typo away from an element the
 *  reduced-motion block does not match, and NOTHING WOULD FAIL: jsdom evaluates
 *  no media query, so the miss is invisible to every local check. One component
 *  makes the hook unmissable instead.
 *
 *  Because it is hidden, EVERY PIECE OF INFORMATION IT CONVEYS MUST ALSO BE IN
 *  TEXT beside it. It is `aria-hidden` and renders no characters, so that costs
 *  nothing here -- but it is the reason both callers put a line of copy next to
 *  it rather than leaning on the spinner to say "working".
 * ===========================================================================
 */

export function Spinner() {
  return (
    <div
      aria-hidden="true"
      data-motion="spinner"
      className="size-(--size-spinner) animate-spin rounded-full border-2 border-border-strong border-t-accent-bright"
    />
  );
}
