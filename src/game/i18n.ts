/**
 * Every language's catalogue, in one table (2026-09-28).
 *
 * `Record<Locale, ...>` so a locale added to `LOCALES` without a catalogue fails the typecheck
 * here, the same exhaustiveness `copy.ts`'s `Copy` gives each catalogue's keys.
 */

import { COPY, type Copy } from './copy';
import { COPY_CA } from './copy.ca';
import { COPY_ES } from './copy.es';
import type { Locale } from './locale';
import { PLAYLIST_ERROR_MESSAGES, type ErrorMessages } from './messages';
import { PLAYLIST_ERROR_MESSAGES_CA } from './messages.ca';
import { PLAYLIST_ERROR_MESSAGES_ES } from './messages.es';

export interface Catalogue {
  readonly copy: Copy;
  readonly errorMessages: ErrorMessages;
}

export const CATALOGUES: Record<Locale, Catalogue> = {
  en: { copy: COPY, errorMessages: PLAYLIST_ERROR_MESSAGES },
  es: { copy: COPY_ES, errorMessages: PLAYLIST_ERROR_MESSAGES_ES },
  ca: { copy: COPY_CA, errorMessages: PLAYLIST_ERROR_MESSAGES_CA },
};
