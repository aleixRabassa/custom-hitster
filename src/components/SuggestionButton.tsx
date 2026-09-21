/**
 * One suggested playlist, as a button that does two different things.
 *
 * ===========================================================================
 *  A PRE-START SURFACE. It renders a playlist's own title and a genre blurb and
 *  NOTHING else -- never a track, an artist or a year. Same rule, and the same
 *  reasoning, as the header of `LandingScreen.tsx`, which owns the list this is
 *  rendered from.
 * ===========================================================================
 *
 * ## Why this is its own component
 *
 * The press-and-hold needs `useLongPress`, and a hook cannot be called inside the `.map()` that
 * renders thirteen of these. Splitting it out is what makes the hook legal -- and it is also what
 * makes the gesture testable without standing up the whole landing screen, its form, its library
 * and its footer.
 *
 * ## The two things a press can mean
 *
 * `suggestionIntent()` decides, and it lives in `src/game/playlist-selection.ts` with its truth
 * table pinned in the node environment. This file only supplies the three signals:
 *
 * - the hold, from `useLongPress`
 * - the modifier, off the event -- Ctrl, Cmd or Shift. This is the KEYBOARD path: a hold cannot
 *   be performed without a pointer, and Enter and Space both carry these flags.
 * - `isSelecting`, from the caller, which is true once anything is selected
 *
 * The default is still `start`, because a first press on a suggestion has dealt a deck since
 * Phase 6 and that is the reason the suggestions exist at all.
 */

import { suggestionIntent } from '../game/playlist-selection';
import { useLongPress } from '../hooks/useLongPress';

export interface SuggestionButtonProps {
  /** The playlist's title, as the accessible name's first half. */
  label: string;
  /** Genre/era only. Never a track, an artist or a year. */
  blurb: string;
  /** Is this playlist already in the form? Derived from the rows by the caller, never stored. */
  isSelected: boolean;
  /** Is anything at all selected? A plain press then toggles instead of dealing a deck. */
  isSelecting: boolean;
  /** True while a request is in flight. */
  disabled: boolean;
  /** Put this playlist in the form, or take it out. */
  onToggle: () => void;
  /** Deal a single-playlist deck from it, right now. */
  onStart: () => void;
}

export function SuggestionButton({
  label,
  blurb,
  isSelected,
  isSelecting,
  disabled,
  onToggle,
  onStart,
}: SuggestionButtonProps) {
  const { pressProps, consumeLongPress } = useLongPress({
    onLongPress: onToggle,
    isEnabled: !disabled,
  });

  return (
    <button
      type="button"
      {...pressProps}
      onClick={(event) => {
        // FIRST, and it must return: `click` fires after `pointerup`, so a hold that has already
        // selected is followed by a click that would otherwise deal a deck from the playlist the
        // player was in the middle of picking.
        if (consumeLongPress()) return;

        const intent = suggestionIntent({
          wasLongPress: false,
          hasModifier: event.ctrlKey || event.metaKey || event.shiftKey,
          isSelecting,
        });

        if (intent === 'toggle') onToggle();
        else onStart();
      }}
      disabled={disabled}
      /*
        A real toggle button to assistive technology, and unconditional rather than only while
        selecting: an attribute that comes and goes changes the control's announced ROLE halfway
        through the screen, so a player who tabbed past it once would meet a different widget on
        the way back.
      */
      aria-pressed={isSelected}
      className={[
        /*
          `p-4` and `text-sm`, matching `WelcomeScreen`'s step cards (2026-09-21): the developer's
          note was that the picker's components read a size smaller than the front door's, and
          these are the pair that sit in the same slot -- a grid of bordered cards under a
          `text-sm text-fg-secondary` heading. Only the padding and the type scale moved; the
          press, the two border strings and the tick are untouched.
        */
        'flex h-full w-full touch-target items-baseline justify-between gap-3 rounded-lg border p-4 text-left',
        /*
          `select-none` and the iOS callout suppression are what make a 500ms hold a GESTURE
          rather than a text selection: without them the browser's own "you are selecting text"
          affordance appears at almost exactly the threshold and covers the button. Every one is
          load-bearing on touch and invisible on a desktop, which is why they are commented here
          rather than trusted to be obvious.
        */
        'touch-manipulation select-none [-webkit-touch-callout:none]',
        /*
          The selected and unselected borders are MUTUALLY EXCLUSIVE strings, never both emitted
          with one overriding the other. Two `border-*` utilities in one class list are the same
          property at the same specificity, so which one wins is their order in the generated
          stylesheet -- a thing no test can see and nothing in this file controls.

          `border-accent` is the app's action colour, 5.26:1 on `--color-page` and 4.76:1 on
          `--color-surface`, both well clear of the 3:1 non-text floor (WCAG 1.4.11). Hover is
          dropped while selected: a hover that dulls the accent reads as the selection coming
          undone under the cursor.
        */
        isSelected
          ? 'border-accent bg-surface'
          : 'border-border hover:border-border-strong hover:bg-surface',
        'focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)',
      ].join(' ')}
    >
      <span className="flex min-w-0 items-baseline gap-1.5 text-sm text-fg-secondary">
        {/*
          NOT decoration, despite being `aria-hidden`. WCAG 1.4.1 forbids colour as the only
          thing distinguishing a state, and a changed border colour is exactly that -- so the
          tick is the non-colour half, and the `aria-pressed` above is the non-visual half.

          `invisible` rather than unmounted, so selecting does not shove the label sideways by a
          character. It keeps its box either way.
        */}
        <span aria-hidden="true" className={isSelected ? 'text-accent' : 'invisible'}>
          ✓
        </span>
        {label}
      </span>
      {/* Genre/era only. Never a track, an artist or a year -- see the header block. */}
      <span className="text-sm text-fg-muted">{blurb}</span>
    </button>
  );
}
