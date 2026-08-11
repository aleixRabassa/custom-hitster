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
 *
 * ## `sizeClassName`, and why it is a size hole rather than a `className` hole
 *
 * The third caller (2026-08-11) is the Play button's buffering state, and a control button is
 * 2.5rem across the whole bar -- the 2rem default would fill it edge to edge. So the SIZE is
 * parameterised and nothing else is: the border, the roundness, `animate-spin` and above all
 * `data-motion="spinner"` stay welded in, because the whole point of this component is that the
 * reduced-motion hook cannot be forgotten. A general `className` prop would let a caller pass
 * `animate-none` or drop the border and re-open exactly the drift this file exists to close.
 *
 * NOTE for the button caller specifically: because reduced motion HIDES this, a button whose only
 * content is a spinner renders EMPTY. `CardControls` keeps the Play/Pause icon rendered underneath
 * and overlays the spinner on top, so the button always has a glyph.
 */

export interface SpinnerProps {
  /**
   * Tailwind size utility, e.g. `size-(--size-control-spinner)`. Defaults to the 2rem
   * full-screen size both original callers use.
   */
  sizeClassName?: string;
}

export function Spinner({ sizeClassName = 'size-(--size-spinner)' }: SpinnerProps = {}) {
  return (
    <div
      aria-hidden="true"
      data-motion="spinner"
      className={`${sizeClassName} animate-spin rounded-full border-2 border-border-strong border-t-accent-bright`}
    />
  );
}
