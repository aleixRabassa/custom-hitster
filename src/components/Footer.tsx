/**
 * The copyright line, pinned to the bottom of the screen.
 *
 * ===========================================================================
 *  IT IS ABSOLUTELY POSITIONED IN ITS HOST'S BOTTOM PADDING, AND THE CONTRACT
 *  IS THAT THE CALLER IS POSITIONED AND RESERVES THE BAND.
 *
 *  Every host carries `relative pb-20`, and the two numbers in that band are
 *  PAIRED rather than chosen: `bottom-8` is 32px, the line is ~16px tall, so a
 *  band of 80px leaves exactly 32px above the line and 32px below it. THE LINE IS
 *  CENTRED IN ITS OWN BAND, which is what the developer asked for on 2026-08-12
 *  ("margen debajo igual al margen superior") -- before it, `bottom-4` inside a
 *  `pb-12`/`pb-20` band put the copyright 16px off the screen's edge with anything
 *  from 16px to 48px of air above it. Change `bottom-8` without changing `pb-20`
 *  on all five hosts, or the reverse, and the symmetry is silently gone: jsdom
 *  computes no layout, so nothing here can measure it.
 *
 *  That is the same shape of contract as `card-ring` in `src/index.css` -- the
 *  utility positions itself against an ancestor it does not create -- and it is
 *  asserted at both ends: `Footer.test.tsx` pins the classes here, and each
 *  screen's own test pins `relative` and `pb-20` on its `<main>`. Drop `relative`
 *  from a screen and the footer silently anchors to the nearest positioned
 *  ancestor or the viewport, which is a bug nothing else would catch.
 *
 *  WHY OUT OF FLOW, when "put it last and give it `mt-auto`" is the textbook
 *  sticky footer: every screen here centres a column -- the preparing and end
 *  screens with `justify-center` on `<main>`, the landing screen on its own
 *  `min-h-[88dvh]` hero `<section>` (its `<main>` deliberately has no
 *  `justify-center`: that column outgrows the viewport, so it never had free
 *  space to distribute) -- and an auto margin BEATS `justify-content`. The
 *  first `mt-auto` swallows all the free space, so the content stops being
 *  centred and packs to the top -- most visible on the preparing screen, whose
 *  content is a spinner and two lines. Making that work needs a second auto
 *  margin on the first child of every screen (fragile: the preparing screen's
 *  first child is a CONDITIONAL notice) or a wrapper element around all of each
 *  screen's children, which changes their `gap-*` semantics. Positioning is one
 *  class here and two on each host, and it moves nothing.
 *
 *  It rides in the PADDING because that band is already empty: `pb-20` gives 80px
 *  below the content box and the line occupies the middle 16px of it, so there is
 *  no overlap to guard against even at the 320px width where the landing screen's
 *  column is tallest.
 *
 *  BOTTOM OF THE PAGE, WHICH IS THE BOTTOM OF THE SCREEN WHENEVER THE SCREEN IS
 *  THE PAGE. On the landing screen -- the one column that outgrows the viewport,
 *  with eight suggestions and a library -- `<main>` grows past `min-h-dvh` and
 *  this goes with it, so it is at the end of the scroll rather than hovering
 *  over it. `fixed` would keep it in view at all times, which is the other
 *  reading of "always at the bottom"; it is deliberately not used, because a
 *  copyright line floating over the suggestions a player is scrolling through
 *  costs more than it gives.
 * ===========================================================================
 *
 * ===========================================================================
 *  IT IS RENDERED ON ALL FIVE OF THE APP'S SCREENS (the welcome screen joined
 *  on 2026-09-18), INCLUDING THE GAME SCREEN
 *  (2026-08-12) -- AND THE ONE SCREEN IT IS KEPT OFF IS THE ONLY INTERESTING
 *  DECISION LEFT IN THIS FILE.
 *
 *  Every screen in this app is its own `min-h-dvh` column, so there is no shell
 *  to hang a footer on: a footer rendered once in `App.tsx` or `main.tsx` would
 *  be a SIBLING of a full-viewport column, which makes the page 100dvh + the
 *  footer's height and gives every screen a permanent scrollbar. Rendering it as
 *  the last child of each `<main>` costs nothing and keeps each screen
 *  self-contained -- the same reason `NoticeBanner` is passed in as a node rather
 *  than positioned globally.
 *
 *  THE GAME SCREEN USED TO BE EXCLUDED, AND THE REASON IT GAVE IS STILL TRUE --
 *  IT WAS OVERRULED, NOT REFUTED. That column is a HEIGHT BUDGET rather than a
 *  page: `--card-height` is `clamp(15rem, min(62dvh, 80vw), 24rem)` precisely so
 *  the HUD, the notice, the card, its caption and the control bar fit a phone
 *  without scrolling, and the `pb-20` band this footer requires takes 56px out of
 *  that budget on every viewport. On a short phone the column can therefore
 *  overflow and the screen scrolls -- which is the cost the developer accepted on
 *  2026-08-12 when they asked for the line to be visible at all times, including
 *  mid-game. IF THAT TURNS OUT TO HURT ON A REAL DEVICE, the fix is `--card-height`
 *  (its `62dvh` term), not a re-exclusion by hand.
 *
 *  What did NOT change is HOW it is placed there: still `absolute`, never
 *  `mt-auto`. The game screen is `justify-center`, auto margins beat
 *  `justify-content`, and an `mt-auto` footer would swallow the free space and
 *  stop the card being centred -- see the block above.
 *
 *  THE CRASH SCREEN IS STILL EXCLUDED, and for a reason that has nothing to do
 *  with pixels: `ErrorBoundary`'s fallback is a `role="alert"`, so its WHOLE
 *  SUBTREE is what gets announced when the page silently becomes something else.
 *  A copyright line inside that is read out to a screen-reader user in the middle
 *  of being told the game crashed, which is the one place where adding text has a
 *  cost beyond layout.
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

import { COPY } from '../game/copy';

/**
 * Re-exported for the leak proofs, which subtract this exact string from a screen's `textContent`
 * before asserting no year-shaped number is left. It lives in `src/game/copy.ts` with every other
 * sentence in the app; the alias is here because that is where its importers already look.
 */
export { COPYRIGHT_NOTICE } from '../game/copy';

export function Footer() {
  return (
    /*
      A `<footer>` inside `<main>` is NOT a `contentinfo` landmark -- the role applies only when the
      element's nearest sectioning ancestor is the body -- and here that is the honest outcome rather
      than a compromise: each screen owns its own `<main>`, so this is that screen's footer and it
      should not claim to be the document's. It therefore stays out of the landmark list a
      screen-reader user navigates by, where a copyright line is noise.

      NO EXPLICIT `role`, and that is the part a future edit could get wrong: adding
      `role="contentinfo"` would make the landmark real in every browser, and all five screens render
      this component. `Footer.test.tsx` asserts the absence -- and records that Testing Library maps
      `footer` to `contentinfo` regardless of ancestry, so a role QUERY cannot be used to check any
      of this.

      `absolute inset-x-0 bottom-8` -- OUT OF FLOW, and the header block explains why that is the one
      arrangement of the four that keeps every screen's centring. `bottom-8` is half of the host's
      `pb-20` band minus half the line, i.e. the line sits in the MIDDLE of the band with equal air
      above and below; the two numbers move together or not at all.
    */
    <footer className="absolute inset-x-0 bottom-8 text-center text-xs text-fg-muted">
      {COPY.footer.prefix}
      {/*
        =========================================================================
         THE AUTHOR'S NAME CARRIES THE APP'S GREEN, ASKED FOR ON 2026-08-12.

         `text-accent` -- the SAME token as Start and Play again, which is what
         "the standard green of the app" means here. Not `--color-fg-year` (the
         card's neon, reserved for the game's payoff) and not `--color-ring-from`
         (a gradient stop, not a text colour): reusing an action colour for a
         word that is now a LINK is if anything more honest than it was when the
         name was inert, while inventing a fourth green would put a colour in the
         app that the theme block does not name.

         CONTRAST WAS THE ONLY REAL QUESTION, because this is the app's smallest
         text (`text-xs`, i.e. 12px, so the 4.5:1 floor applies rather than the
         3:1 large-text one) and it is the one place the accent appears as TEXT
         instead of as a filled background. Measured 5.13:1 on `--color-page`,
         which passes -- and it is brighter than the `text-fg-muted` (6.12:1)
         around it only in chroma, not in the audit. If the accent token is ever
         darkened, THIS is the usage that fails first: `--color-on-accent` exists
         precisely because white on that background measured 3.67:1.

         THE THREE PARTS CONCATENATE WITH NO SEPARATOR, so the element's
         `textContent` is still exactly `COPY.footer.notice` -- which is what the
         leak proofs subtract and what `Footer.test.tsx` queries for. Styling or
         linking the name must not split the string.
        =========================================================================

        =========================================================================
         IT WAS THE APP'S ONLY ANCHOR (2026-08-12) until the welcome screen's PDF
         download became the second on 2026-09-18, so the conventions every other
         interactive element here follows had to be applied by hand.

         `focus-visible:focus-ring` because the repo's rule is that EVERY
         interactive element gets one, and this is now interactive: it is
         reachable by Tab on all five screens, and a keyboard user who lands on
         an unringed link has no idea where they are. `font-bold` is what the
         developer asked for and also the non-colour half of "this is a link",
         which matters because colour alone is not an affordance.

         `target="_blank"` with `rel="noreferrer noopener"`: the game keeps state
         in the page -- a deck mid-crawl, an unsaved session -- so navigating the
         tab away from a footer link would be an expensive misclick, and `noopener`
         is what stops the opened page reaching back through `window.opener`.

         NO `aria-label`. The link's accessible name is its text, which is the
         author's name; an "opens in a new tab" label would put a second string in
         `copy.ts` for a fact the browser already conveys, and -- more to the point
         -- `Footer.test.tsx` asserts the footer carries no `aria-label`, because
         this component renders on every screen including mid-game.
        =========================================================================
      */}
      <a
        className="font-bold text-accent focus-visible:focus-ring"
        href={COPY.footer.authorUrl}
        target="_blank"
        rel="noreferrer noopener"
      >
        {COPY.footer.author}
      </a>
      {COPY.footer.suffix}
    </footer>
  );
}
