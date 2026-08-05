/**
 * The fixture deck every component test in Phases 4-6 renders from.
 *
 * One card per interesting SHAPE rather than one card per pretty example. The shapes are
 * enumerated once, here, so that a test asserting "a preview-less card disables Play" and a
 * test asserting "a `none` year prompts the player" cannot quietly disagree about what those
 * cards look like. Plans 2 (gestures) and 3 (screens) import the same deck.
 *
 * ## What each card is for
 *
 * | Card                 | Shape                                        | Covers                          |
 * | -------------------- | -------------------------------------------- | ------------------------------- |
 * | `highConfidenceCard` | `year: 1975`, `confidence: 'high'`           | Year slot state 1               |
 * | `lowConfidenceCard`  | `year: 1979`, `confidence: 'low'`            | Year slot state 2 (unconfirmed) |
 * | `noYearCard`         | `year: null`, `confidence: 'none'`           | Year slot state 3 (check it)    |
 * | `pendingYearCard`    | `year: undefined`, no `yearConfidence`       | Year slot state 4 (pending)     |
 * | `noPreviewCard`      | no `previewUrl`                              | Disabled Play/Pause + Restart   |
 * | `unplayableCard`     | `isPlayable: false` but HAS a `previewUrl`   | That the flag alone changes nothing |
 * | `duplicateIdCardA/B` | the same `id`, different `title`             | Duplicate tracks in one deck    |
 *
 * ## Two deliberate details
 *
 * **`year: null` and `year: undefined` are different cards, not one card tested twice.**
 * `undefined` means "the lookup has not come back"; `null` means "it came back with nothing".
 * `src/game/reducer.ts`'s `isCurrentYearPending` is true for exactly the first, and the year
 * slot must not collapse the two -- one resolves, the other never will.
 *
 * **`unplayableCard` carries a `previewUrl` on purpose.** Spotify's `isPlayable: false` is
 * about the track in Spotify's own client (region, takedown); it says nothing about whether
 * the 30-second MP3 plays. Pairing the flag with a working preview is what makes a test able
 * to prove the UI keys off `previewUrl` and not off `isPlayable` -- and the card is dealt
 * either way, because the QR always works (plan.md §2).
 *
 * Titles and artists are real tracks so that a leak assertion searching the DOM for
 * "Bohemian Rhapsody" is searching for something a person would recognise on screen.
 * `artist` values include two of the names `shared/artists.ts` warns about, so the
 * render-verbatim rule has something to fail against.
 */

import type { Card } from '../../../shared/types';

/** State 1: a confirmed year. The ordinary case. */
export const highConfidenceCard: Card = {
  id: '3z8h0TU7ReDPLIbEnYhWZb',
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  durationMs: 354320,
  previewUrl: 'https://p.scdn.co/mp3-preview/bohemian',
  isPlayable: true,
  year: 1975,
  yearConfidence: 'high',
};

/**
 * State 2: a year that is probably right and must always be marked as unconfirmed.
 *
 * The artist is one of `shared/artists.ts`'s hazard names: "Earth, Wind & Fire" is ONE
 * artist containing both separators Spotify joins with, so a component that splits the
 * string for display renders three artists and corrupts the reveal.
 */
export const lowConfidenceCard: Card = {
  id: '4pAu5C1PVBOhCJPQ8fBZWK',
  title: 'September',
  artist: 'Earth, Wind & Fire',
  durationMs: 214893,
  previewUrl: 'https://p.scdn.co/mp3-preview/september',
  isPlayable: true,
  year: 1979,
  yearConfidence: 'low',
};

/**
 * State 3: the lookup completed and found nothing.
 *
 * A third of an ordinary deck lands here (15 of 42 on the real playlist Phase 3 measured),
 * so this is a common card, not an edge case. It stays in the deck and stays playable.
 */
export const noYearCard: Card = {
  id: '5ghIJDpPoe3CfHMGu71E6T',
  title: 'Smells Like Teen Spirit',
  artist: 'Nirvana',
  durationMs: 301920,
  previewUrl: 'https://p.scdn.co/mp3-preview/teen-spirit',
  isPlayable: true,
  year: null,
  yearConfidence: 'none',
};

/**
 * State 4: the lookup has not come back yet.
 *
 * Both `year` and `yearConfidence` are ABSENT rather than set to anything -- that absence is
 * the state. Normal for cards 2..n while the resolver crawls the deck.
 */
export const pendingYearCard: Card = {
  id: '7ouMYWpwJ422jRcDASZB7P',
  title: 'Knights of Cydonia',
  artist: 'Muse',
  durationMs: 366213,
  previewUrl: 'https://p.scdn.co/mp3-preview/cydonia',
  isPlayable: true,
};

/**
 * No `previewUrl` -- the ~0.5% of tracks Phase 0 measured (2 of 400).
 *
 * Play/Pause and Restart must be disabled for this card; the QR and Exit must not be.
 * "Tyler, The Creator" is a second hazard name for the verbatim-artist rule.
 */
export const noPreviewCard: Card = {
  id: '2CqYPfCJDbLGMzY0nUWHJ0',
  title: 'EARFQUAKE',
  artist: 'Tyler, The Creator',
  durationMs: 190240,
  isPlayable: false,
  year: 2019,
  yearConfidence: 'high',
};

/** `isPlayable: false` WITH a working preview -- see the header note on why. */
export const unplayableCard: Card = {
  id: '1301WleyT98MSxVHPZCA6M',
  title: 'HUMBLE.',
  artist: 'Kendrick Lamar',
  durationMs: 177000,
  previewUrl: 'https://p.scdn.co/mp3-preview/humble',
  isPlayable: false,
  year: 2017,
  yearConfidence: 'high',
};

/**
 * A duplicated track id, as two cards.
 *
 * A playlist may legitimately hold the same track twice, and Phase 3 handles it explicitly:
 * the resolver looks the id up once and `YEAR_RESOLVED` updates EVERY card carrying it. The
 * titles differ so that a test can tell which copy it rendered; the ids are what matter.
 */
export const duplicateIdCardA: Card = {
  id: '0eGsygTp906u18L0Oimnem',
  title: 'Mr. Brightside',
  artist: 'The Killers',
  durationMs: 222973,
  previewUrl: 'https://p.scdn.co/mp3-preview/brightside',
  isPlayable: true,
  year: 2003,
  yearConfidence: 'high',
};

/** The second copy of `duplicateIdCardA`'s id. */
export const duplicateIdCardB: Card = {
  ...duplicateIdCardA,
  title: 'Mr. Brightside (second copy)',
};

/**
 * The whole deck, in a stable order.
 *
 * Exported as one array so plan 2's stacked deck and plan 3's session have something to
 * page through. Tests that care about a specific shape should import that card BY NAME --
 * indexing into this array both reads worse and trips `noUncheckedIndexedAccess`.
 */
export const fixtureDeck: Card[] = [
  highConfidenceCard,
  lowConfidenceCard,
  noYearCard,
  pendingYearCard,
  noPreviewCard,
  unplayableCard,
  duplicateIdCardA,
  duplicateIdCardB,
];
