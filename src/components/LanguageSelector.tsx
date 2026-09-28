/**
 * The language switch: one button per locale, the active one pressed (2026-09-28).
 *
 * Presentational, like every component here: the locale comes in, the choice goes out through
 * `onChange`, and `LocaleProvider` owns storing it.
 *
 * - **A segmented control, not a `<select>`.** A native select on Android opens a full-screen
 *   dialog to choose between three words; three buttons are one tap, and all three options are
 *   visible without opening anything.
 * - **Each option is the language's name IN THAT LANGUAGE** (`LANGUAGE_NAMES`), never translated,
 *   so a player who landed in a language they cannot read still recognises theirs. Its `lang`
 *   attribute is what makes a screen reader pronounce "Español" as Spanish under an English page.
 * - **Only the group's name is copy** (`copy.language.label`), and it is the `role="group"`'s
 *   `aria-label`: the buttons need a context, and a visible heading for three self-explanatory
 *   words would be noise.
 * - **`aria-pressed`, not `disabled`, marks the active one**, so it stays in the tab order and
 *   announces as "pressed". Pressing it again is a no-op rather than a redundant write.
 */

import { LANGUAGE_NAMES, LOCALES, type Locale } from '../game/locale';
import { useCopy } from '../hooks/useLocale';

export interface LanguageSelectorProps {
  locale: Locale;
  onChange: (locale: Locale) => void;
}

const BUTTON_BASE =
  'touch-target rounded-lg border px-4 py-2 text-sm font-medium focus-visible:focus-ring';
const BUTTON_PRESSED = 'border-accent bg-accent text-on-accent';
const BUTTON_UNPRESSED =
  'border-border-strong text-fg-secondary hover:border-border-hover hover:text-fg';

export function LanguageSelector({ locale, onChange }: LanguageSelectorProps) {
  const copy = useCopy();

  return (
    <div
      role="group"
      aria-label={copy.language.label}
      className="flex flex-wrap justify-center gap-2"
    >
      {LOCALES.map((option) => {
        const isActive = option === locale;

        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={isActive}
            onClick={() => {
              if (!isActive) onChange(option);
            }}
            className={`${BUTTON_BASE} ${isActive ? BUTTON_PRESSED : BUTTON_UNPRESSED}`}
          >
            {LANGUAGE_NAMES[option]}
          </button>
        );
      })}
    </div>
  );
}
