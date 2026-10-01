/**
 * The language switch: one flag button per locale, the active one pressed (2026-09-28).
 *
 * Presentational, like every component here: the locale comes in, the choice goes out through
 * `onChange`, and `LocaleProvider` owns storing it.
 *
 * - **A segmented control, not a `<select>`.** A native select on Android opens a full-screen
 *   dialog to choose between three words; three buttons are one tap, and all three options are
 *   visible without opening anything.
 * - **Each option shows a FLAG, and is NAMED in its own language** (2026-09-29). The flag is an
 *   inline SVG, never an emoji: Windows renders flag emoji as two letters, and Catalonia has no
 *   flag emoji most platforms draw at all -- the same "resolves to an emoji font" hazard the
 *   control bar's icons were moved off text glyphs for. The flag is `aria-hidden` decoration; the
 *   button's name is `LANGUAGE_NAMES` as its `aria-label` (and `title`, for a sighted hover),
 *   never translated, so a player who landed in a language they cannot read still recognises
 *   theirs. Its `lang` attribute is what makes a screen reader pronounce "Español" as Spanish
 *   under an English page. English is the Union flag, since the copy is British English.
 * - **The group's name is copy** (`copy.language.label`), and since the buttons stopped carrying
 *   words it is a VISIBLE heading too -- rendered by each host (`WelcomeScreen` and, since
 *   2026-10-01, `LandingScreen`) in the same shape as its other section headings -- as well as the
 *   `role="group"`'s `aria-label`.
 * - **`disabled` is the picker's**: every control there is disabled while a request is loading, and
 *   this joins them. The welcome screen has no loading state and never passes it.
 * - **`aria-pressed`, not `disabled`, marks the active one**, so it stays in the tab order and
 *   announces as "pressed". Pressing it again is a no-op rather than a redundant write.
 */

import { useId, type ReactNode } from 'react';

import { LANGUAGE_NAMES, LOCALES, type Locale } from '../game/locale';
import { useCopy } from '../hooks/useLocale';

export interface LanguageSelectorProps {
  locale: Locale;
  onChange: (locale: Locale) => void;
  disabled?: boolean;
}

const BUTTON_BASE =
  'touch-target flex items-center justify-center rounded-lg border-2 px-3 py-2 focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)';
const BUTTON_PRESSED = 'border-accent bg-surface-raised';
const BUTTON_UNPRESSED =
  'border-border-strong opacity-60 hover:border-border-hover hover:opacity-100';

/**
 * Every flag is drawn into the same 3:2 box, so the three buttons are one size. The flags' colours
 * are hex literals on purpose, the one exception to "consume a token": they are the flags' own
 * colours, not the app's palette, and no redesign should ever move them.
 */
const FLAG_CLASS = 'h-6 w-9 rounded-sm';

/** The Union flag, cropped from its native 2:1 to the shared 3:2 box. */
function UnionFlag() {
  // Unique per instance: two selectors on one page must not share a `clipPath` id.
  const clipId = useId();

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 60 30"
      preserveAspectRatio="xMidYMid slice"
      className={FLAG_CLASS}
    >
      <clipPath id={clipId}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path
        d="M0,0 L60,30 M60,0 L0,30"
        clipPath={`url(#${clipId})`}
        stroke="#C8102E"
        strokeWidth="4"
      />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

/** Spain's civil flag: red, yellow twice the height, red -- without the coat of arms. */
function SpainFlag() {
  return (
    <svg aria-hidden="true" viewBox="0 0 3 2" className={FLAG_CLASS}>
      <rect width="3" height="2" fill="#AA151B" />
      <rect y="0.5" width="3" height="1" fill="#F1BF00" />
    </svg>
  );
}

/** The senyera: nine equal stripes, yellow first and last, four red between. */
function CataloniaFlag() {
  return (
    <svg aria-hidden="true" viewBox="0 0 9 6" preserveAspectRatio="none" className={FLAG_CLASS}>
      <rect width="9" height="6" fill="#FCDD09" />
      {[1, 3, 5, 7].map((stripe) => (
        <rect key={stripe} y={(stripe * 6) / 9} width="9" height={6 / 9} fill="#DA121A" />
      ))}
    </svg>
  );
}

const FLAGS: Record<Locale, () => ReactNode> = {
  en: UnionFlag,
  es: SpainFlag,
  ca: CataloniaFlag,
};

export function LanguageSelector({ locale, onChange, disabled = false }: LanguageSelectorProps) {
  const copy = useCopy();

  return (
    <div
      role="group"
      aria-label={copy.language.label}
      className="flex flex-wrap justify-center gap-3"
    >
      {LOCALES.map((option) => {
        const isActive = option === locale;
        const Flag = FLAGS[option];

        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-label={LANGUAGE_NAMES[option]}
            title={LANGUAGE_NAMES[option]}
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => {
              if (!isActive) onChange(option);
            }}
            className={`${BUTTON_BASE} ${isActive ? BUTTON_PRESSED : BUTTON_UNPRESSED}`}
          >
            <Flag />
          </button>
        );
      })}
    </div>
  );
}
