/**
 * The front door: what the game is, how a round goes, one big button into the playlist picker, and
 * the printable year cards for playing the same game on a table.
 *
 * ===========================================================================
 *  THIS IS A PRE-START SURFACE, SO IT MUST LEAK NOTHING ABOUT ANY DECK.
 *
 *  Same rule as `LandingScreen` and `PreparingScreen`: no track title, no
 *  artist, no year that came from a card -- and this screen takes no `Card` at
 *  all, which is what makes the rule cheap to keep. The ONE year-shaped text on
 *  it is the printed range in `COPY.welcome.printDetail`, which derives from a
 *  PDF on disk rather than from any deck; `WelcomeScreen.test.tsx` subtracts it
 *  by exact string, exactly as every leak proxy subtracts `COPYRIGHT_NOTICE`.
 *  The decorative card below draws a `?`, never a number, for the same reason.
 * ===========================================================================
 *
 * ## It is a container FLAG, not a fifth status (2026-09-18)
 *
 * `GameState.status` still models exactly four things and `App.tsx` still switches on it. This
 * screen renders for `idle` until the player presses the big button, from a `useState` in the
 * container with the same shape as `endedView`. That is what gives the three edge cases for free:
 * a share link never sees this screen (it deals immediately, as it always did), a saved session
 * resumes past it, and Exit / Home still land on the PICKER -- those paths go through `ended`, and
 * a player who just quit a game does not need the rules explained again.
 *
 * ## Naming
 *
 * The developer called this "the landing page". In code it is `WelcomeScreen`, because
 * `LandingScreen` -- the playlist picker -- is named in forty-odd places across the docs and the
 * tests, and renaming it for a word would be churn with no behaviour in it. Where the docs say
 * "landing screen" they still mean the picker.
 *
 * ## The PDF is a static asset, and two things about that are load-bearing
 *
 * It ships from `public/`, so `vercel.json`'s SPA rewrite has to let it through -- it does, because
 * that rewrite excludes any path containing a dot. And it must NOT be precached: the service
 * worker's `globPatterns` deliberately has no `pdf`, so a 240 kB file is not downloaded by every
 * install of an app whose whole JavaScript is under 100 kB. What the worker WOULD do is serve
 * `index.html` for a navigation to a URL it has not cached -- so `vite.config.ts` denylists `.pdf`
 * beside `/api/`. Neither half can be observed under any dev server (`devOptions` is absent), which
 * is why both are Pending rows in `docs/development.md` §5.
 */

import { COPY } from '../game/copy';
import { MAX_DECK_PLAYLISTS } from '../game/deck-merge';
import { Footer } from './Footer';
import type { ReactNode } from 'react';

/**
 * Where the printable year cards live under `public/`.
 *
 * A path, not copy: the player never reads it. The name they DO see is the `download` attribute,
 * which is `COPY.welcome.yearCardsFileName`. Renaming the file means changing this and nothing else.
 */
export const YEAR_CARDS_PDF_PATH = '/year-cards-1970-2033.pdf';

export interface WelcomeScreenProps {
  /** The big button. Takes the player to the playlist picker; nothing else happens. */
  onStart: () => void;
}

/**
 * The one `<svg>` wrapper the step icons share -- same shape as `CardControls`' `ControlIcon`,
 * for the same reason: one viewBox, one stroke, one size, so three icons drawn separately read as
 * one set. Decoration only, so `aria-hidden`; the step's title carries the meaning.
 */
function StepIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      {children}
    </svg>
  );
}

/** A list with a note: the playlists. */
function PlaylistIcon() {
  return (
    <StepIcon>
      <path d="M4 6h10M4 12h10M4 18h6" />
      <path d="M18 5v9.5" />
      <circle cx="16" cy="15.5" r="2.5" />
    </StepIcon>
  );
}

/** A play triangle inside a ring: the preview, or the scan. */
function PlayCardIcon() {
  return (
    <StepIcon>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l5.5-3.5z" />
    </StepIcon>
  );
}

/** A card being flipped: the reveal. */
function FlipIcon() {
  return (
    <StepIcon>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M12 5v14" />
      <path d="M8 12h.01M16 10.5v3" />
    </StepIcon>
  );
}

/** The download arrow on the PDF link. */
function DownloadIcon() {
  return (
    <StepIcon>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19h14" />
    </StepIcon>
  );
}

/**
 * One "how it works" step: a numbered badge, an icon, a title and a sentence.
 *
 * The number is a single digit rendered as text, which the leak proxy's `\b(19|20)\d{2}\b` cannot
 * mistake for a year; `PreparingScreen`'s stricter "no digit at all" rule is that screen's own and
 * exists because a count there read as a progress bar.
 */
function Step({
  number,
  icon,
  title,
  body,
}: {
  number: number;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-on-accent"
        >
          {number}
        </span>
        <span aria-hidden="true" className="text-fg-secondary">
          {icon}
        </span>
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-fg-secondary">{body}</p>
    </li>
  );
}

export function WelcomeScreen({ onStart }: WelcomeScreenProps) {
  return (
    /*
      `relative pb-20` is `Footer`'s contract, the same on every host: the footer is `absolute
      bottom-8`, and 80px of band puts 32px above the line and 32px below it. See `Footer.tsx`;
      `WelcomeScreen.test.tsx` asserts both.

      No `justify-center`, for the reason `LandingScreen` gives: this column outgrows a phone's
      viewport (a hero, three steps and a second section), so there is no free space to centre in,
      and a viewport-sized hero would put a screenful of nothing between the button and the steps.
    */
    <main className="relative flex min-h-dvh flex-col items-center gap-10 bg-page px-6 pt-8 pb-20 text-fg">
      {/*
        THE HERO: the logo as the heading, one sentence, and the one button this screen exists for.

        One sentence as of 2026-09-18: a lead paragraph used to sit under the tagline and was cut as
        redundant with the three "How it works" steps below, which say the same thing with more room.
        Do not refill the slot -- the tagline is the whole pitch, and the steps are the explanation.

        The logo is the SAME file and the same 192px as the picker's, so the two screens read as one
        app rather than as a site and an app -- and the `<h1>` is the image with the app's name as
        its `alt`, for the reasons `LandingScreen` records at length: it is the document's one
        top-level heading, and an empty `alt` would leave it nameless.
      */}
      <section className="flex w-full max-w-content flex-col items-center gap-6 text-center">
        <h1>
          <img
            src="/logo.webp"
            alt={COPY.welcome.logoAlt}
            width={384}
            height={384}
            fetchPriority="high"
            className="size-48"
          />
        </h1>

        <p className="text-xl font-semibold">{COPY.welcome.tagline}</p>

        {/*
          The big button. `text-on-accent`, not `text-white`, for the contrast reason the picker's
          Start records (white on the accent measured 3.67:1). Bigger than every other primary action
          in the app -- `py-4 text-lg` -- because it is the only thing this screen asks the player to
          do; the download below is deliberately the outlined secondary shape.
        */}
        <button
          type="button"
          onClick={onStart}
          className="touch-target w-full rounded-lg bg-accent px-6 py-4 text-lg font-semibold text-on-accent hover:bg-accent-hover focus-visible:focus-ring"
        >
          {COPY.welcome.enter}
        </button>
      </section>

      {/*
        HOW IT WORKS: three steps, one card each. A `<ol>` because the order is the game's order,
        and a screen reader announces it as a numbered list of three -- the visible badges say the
        same thing, which is why they are `aria-hidden`.
      */}
      <section className="flex w-full max-w-content flex-col gap-3 sm:max-w-2xl">
        <h2 className="text-sm text-fg-secondary">{COPY.welcome.howItWorksHeading}</h2>

        <ol className="grid gap-3 sm:grid-cols-3">
          <Step
            number={1}
            icon={<PlaylistIcon />}
            title={COPY.welcome.steps.pick.title}
            body={COPY.welcome.steps.pick.body(MAX_DECK_PLAYLISTS)}
          />
          <Step
            number={2}
            icon={<PlayCardIcon />}
            title={COPY.welcome.steps.play.title}
            body={COPY.welcome.steps.play.body}
          />
          <Step
            number={3}
            icon={<FlipIcon />}
            title={COPY.welcome.steps.guess.title}
            body={COPY.welcome.steps.guess.body}
          />
        </ol>
      </section>

      {/*
        PREFER PAPER: the printable year cards, with a decorative card beside the text.

        =====================================================================
         THE DECORATION IS `aria-hidden`, DRAWS A `?` AND NEVER A NUMBER, AND
         ITS WRAPPER IS `relative` BECAUSE `card-ring` REQUIRES A POSITIONED
         CALLER.

         The ring utility paints its gradient band as an `absolute` `::before`
         and deliberately declares no `position` of its own (`src/index.css`
         has the cascade-order reasoning). Every other call site is already
         `absolute inset-0`; this is the first that is not, so it carries
         `relative` -- drop it and the band anchors to `<main>` and paints a
         2px gradient around the whole screen. `rounded-card` because the band
         inherits the radius; `card-ring` alone on a square corner shows the
         gradient cutting the corner. And it is `hidden sm:flex`, because at a
         phone width the text is the content and a 112px decoration above it
         pushes the download link a screen further down.

         It does NOT animate, and nothing here may: the ring is static by
         decision (`index.css`), and a pulse on this screen would be a fifth
         reduced-motion surface.
        =====================================================================
      */}
      <section className="flex w-full max-w-content flex-col gap-3 sm:max-w-2xl">
        <h2 className="text-sm text-fg-secondary">{COPY.welcome.printHeading}</h2>

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:gap-6">
          <div
            aria-hidden="true"
            className="relative hidden size-28 shrink-0 items-center justify-center rounded-card card-ring bg-surface-raised sm:flex"
          >
            <span className="text-5xl font-semibold text-fg-year">?</span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-sm text-fg-secondary">{COPY.welcome.printDetail}</p>

            {/*
              THE APP'S SECOND `<a>`, after the footer's author link, and it follows the same
              hand-applied conventions: `focus-visible:focus-ring` because every interactive element
              gets one, `touch-target` because a phone is the primary device. NO `target="_blank"` --
              it is a same-origin download, and the `download` attribute is what asks the browser to
              save rather than navigate. Browsers that ignore the attribute (some in-app webviews) open
              the PDF in a viewer instead, which is the acceptable fallback rather than a bug.

              The visible text is the accessible name, so no `aria-label` -- the WCAG 2.5.3 rule the
              picker's inputs were fixed for. The icon is decoration.
            */}
            <a
              href={YEAR_CARDS_PDF_PATH}
              download={COPY.welcome.yearCardsFileName}
              className="touch-target flex items-center justify-center gap-2 self-start rounded-lg border border-border-strong px-4 py-2 font-medium text-fg hover:border-border-hover focus-visible:focus-ring"
            >
              <DownloadIcon />
              {COPY.welcome.printCards}
            </a>
          </div>
        </div>
      </section>

      {/* The app's actual front door now, so the one screen where a copyright line is most expected. */}
      <Footer />
    </main>
  );
}
