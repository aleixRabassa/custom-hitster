/**
 * The active language, read by every component that renders copy (2026-09-28).
 *
 * ===========================================================================
 *  THE CONTEXT'S DEFAULT IS ENGLISH, AND THAT IS WHAT KEEPS THE SUITE UNCHANGED.
 *
 *  A component rendered with no `LocaleProvider` above it -- which is every
 *  component test in the repo -- gets the English catalogue, i.e. exactly the
 *  `COPY` object those tests import and assert against. So routing components
 *  through `useCopy()` changes nothing a test can see until a test opts in by
 *  rendering inside a provider with another locale.
 * ===========================================================================
 *
 * The provider is `src/components/LocaleProvider.tsx`, mounted by `main.tsx` OUTSIDE
 * `ErrorBoundary` so the crash screen is translated too.
 */

import { createContext, useContext } from 'react';
import type { Copy } from '../game/copy';
import { CATALOGUES } from '../game/i18n';
import { DEFAULT_LOCALE, type Locale } from '../game/locale';
import type { ErrorMessages } from '../game/messages';

export interface LocaleContextValue {
  readonly locale: Locale;
  readonly copy: Copy;
  readonly errorMessages: ErrorMessages;
  /** Switches the app's language and remembers it. A no-op with no provider. */
  readonly setLocale: (locale: Locale) => void;
}

export const DEFAULT_LOCALE_CONTEXT: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  ...CATALOGUES[DEFAULT_LOCALE],
  setLocale: () => {},
};

export const LocaleContext = createContext<LocaleContextValue>(DEFAULT_LOCALE_CONTEXT);

/** The active locale, its catalogue and the setter. */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** The active language's copy -- what a component reads instead of importing `COPY`. */
export function useCopy(): Copy {
  return useContext(LocaleContext).copy;
}
