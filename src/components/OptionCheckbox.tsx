/**
 * One labelled on/off option: a native checkbox, restyled, inside its own `<label>` (2026-10-01).
 *
 * Shared by the picker's deal options ("Deal cards with no year found", "Deal cards with an
 * unconfirmed year") and the PDF export's "Leave unconfirmed years blank", so the three read as one
 * control and the rules below live in one place. Presentational: the value and its change callback
 * are the host's.
 *
 * ===========================================================================
 *  A REAL `<input type="checkbox">` WITH `appearance-none`, NOT A PAINTED DIV.
 *
 *  The native control keeps everything that matters -- the checked state a
 *  screen reader announces, Space to toggle, the label's press area,
 *  `disabled` -- and only its PAINT is replaced: a rounded box that fills with
 *  the accent when checked, and a tick drawn by an `aria-hidden` SVG that the
 *  input's `peer-checked:` state shows. The box IS the input, so
 *  `focus-visible:focus-ring` sits on the element that takes focus.
 *
 *  Four rules carried over from the checkbox this replaced:
 *
 *  - The caption is the accessible NAME through the wrapping label -- no
 *    `aria-label`, WCAG 2.5.3, the same rule `LandingScreen`'s row inputs follow.
 *  - `touch-target` is on the LABEL, which is the press area: on the input it
 *    would grow the painted box to 44px.
 *  - `text-sm` is on the caption `<span>` and NOT on the label -- the preflight
 *    trap (2026-09-21): an `<input>` has `font: inherit`, so a type scale on the
 *    wrapper would size the control too.
 *  - No `value` attribute: the leak audit reads `value`, and a checkbox needs none.
 * ===========================================================================
 */

export interface OptionCheckboxProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * The classes of the box a host groups its options in: the row inputs' own shape (`rounded-lg`, a
 * border, `bg-surface`) with a divider between options. Exported so every host draws the same box.
 */
export const OPTION_GROUP_CLASS_NAME =
  'flex flex-col divide-y divide-border rounded-lg border border-border bg-surface';

export function OptionCheckbox({
  label,
  checked,
  disabled = false,
  onChange,
}: OptionCheckboxProps) {
  return (
    <label className="group touch-target flex cursor-pointer items-center gap-3 px-4 py-3 text-left has-disabled:cursor-not-allowed">
      <span className="relative flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
          disabled={disabled}
          className="peer size-5 cursor-pointer appearance-none rounded-md border-2 border-border-strong bg-page group-hover:enabled:border-border-hover checked:border-accent checked:bg-accent group-hover:enabled:checked:border-accent-hover group-hover:enabled:checked:bg-accent-hover focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute inset-0 m-auto hidden size-3.5 text-on-accent peer-checked:block peer-disabled:opacity-(--opacity-disabled)"
        >
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
      {/*
        `text-fg-secondary`, the picker's other captions' colour ("Playlist link", "+ Add another
        playlist", the section headings) -- the developer's request, 2026-10-01: in `text-fg` the
        two options read brighter than everything around them.
      */}
      <span className="text-sm text-fg-secondary">{label}</span>
    </label>
  );
}
