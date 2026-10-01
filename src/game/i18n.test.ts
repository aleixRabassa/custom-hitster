/**
 * Properties every catalogue must have, in every language (2026-09-28).
 *
 * GENERIC ON PURPOSE: the tests walk each catalogue as an object rather than naming its keys, so a
 * key added later -- in any language -- is covered by every rule here with no edit to this file.
 * Nothing asserts what a string SAYS; the checks are the ones a translation can break silently:
 * an empty value, a function that no longer returns text, the registered trademark on a surface
 * the store listing shows, a year-shaped number on a pre-reveal surface, and two strings that must
 * stay distinct collapsing into one.
 */

import { describe, expect, it } from 'vitest';

import { CATALOGUES } from './i18n';
import { LOCALES } from './locale';
import { PLAYLIST_ERROR_MESSAGES } from './messages';

/** One string reached in a catalogue, with where it came from for the failure message. */
interface Leaf {
  readonly path: string;
  readonly value: unknown;
}

/**
 * Representative arguments: `1` and `3` exercise both sides of every English and Romance
 * singular/plural split, and `'X'` covers the string parameters (a name, a slug). Template literals
 * coerce either, so every signature in the catalogue accepts all three.
 */
const ARGUMENT_FILLS: readonly unknown[] = [1, 3, 'X'];

/** Every string in `node`, and every function's output under each fill, keyed by dotted path. */
function leaves(node: unknown, path: string): Leaf[] {
  if (typeof node === 'function') {
    const fn = node as (...args: unknown[]) => unknown;
    return ARGUMENT_FILLS.map((fill) => ({
      path: `${path}(${JSON.stringify(fill)})`,
      value: fn(...Array<unknown>(fn.length).fill(fill)),
    }));
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, child]) =>
      leaves(child, path === '' ? key : `${path}.${key}`),
    );
  }
  return [{ path, value: node }];
}

/**
 * The paths allowed to carry a year-shaped number, and why: the printed range lives in the year
 * cards' file name and its start year in the sentence beside it (both describe a PDF on disk, not
 * a deck), and the footer's "2026-present". Every leak proxy subtracts exactly these.
 */
const YEAR_ALLOWED_PREFIXES = [
  'copy.welcome.printDetail',
  'copy.welcome.yearCardsFileName',
  'copy.footer.',
];

function isYearAllowed(path: string): boolean {
  return YEAR_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

describe.each(LOCALES)('the %s catalogue', (locale) => {
  const catalogue = CATALOGUES[locale];
  const all = leaves(catalogue, '');

  it('should have something to walk', () => {
    // A guard on the walk itself: an empty result would pass every assertion below.
    expect(all.length).toBeGreaterThan(50);
  });

  it('should hold only non-empty strings, and functions that return them', () => {
    for (const { path, value } of all) {
      expect(typeof value, path).toBe('string');
      expect((value as string).trim(), path).not.toBe('');
    }
  });

  it('should never carry the registered trademark', () => {
    // A Play listing may not carry the mark, and every screenshot shows copy.
    for (const { path, value } of all) {
      expect(String(value), path).not.toMatch(/hitster/i);
    }
  });

  it('should carry no year-shaped number outside the strings that describe the printed range', () => {
    for (const { path, value } of all) {
      if (isYearAllowed(path)) continue;
      expect(String(value), path).not.toMatch(/\b(19|20)\d{2}\b/);
    }
  });

  it('should keep the welcome button distinct from the picker Start', () => {
    // No session may meet two buttons with one name.
    expect(catalogue.copy.welcome.enter).not.toBe(catalogue.copy.landing.start);
  });

  it('should keep the three year-slot notices distinct', () => {
    // They share one slot under the year (plan.year-fetch-rework-ui.md): "confirming" is
    // progress, "unconfirmed" a warning, "pending" no year yet. A translation that collapsed two
    // of them would tell a player a year is final when it is not, or the reverse.
    const { yearProvisional, yearUnconfirmed, yearUnverified, yearPending } = catalogue.copy.card;

    expect(new Set([yearProvisional, yearUnconfirmed, yearUnverified, yearPending]).size).toBe(4);
  });

  it('should keep the two deal options distinct', () => {
    // Two checkboxes with one name are two boxes a screen-reader player cannot tell apart.
    expect(catalogue.copy.landing.dealYearless).not.toBe(catalogue.copy.landing.dealUnconfirmed);
  });

  it('should give each of the five playlist rows a distinct label', () => {
    const labels = [0, 1, 2, 3, 4].map((index) => catalogue.copy.landing.playlistLinkLabel(index));

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('should have a sentence for every start-failure code', () => {
    // The code list comes from the English map, whose `Record<StartFailureCode, string>` type is
    // exhaustive; the union itself is not enumerable at runtime.
    const codes = Object.keys(PLAYLIST_ERROR_MESSAGES);

    expect(Object.keys(catalogue.errorMessages).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      const message = catalogue.errorMessages[code as keyof typeof PLAYLIST_ERROR_MESSAGES];
      expect(typeof message, code).toBe('string');
      expect(message.trim(), code).not.toBe('');
    }
  });

  it('should keep offline distinct from network', () => {
    // One is a certainty, the other a guess; `messages.ts` records why they must differ.
    expect(catalogue.errorMessages.offline).not.toBe(catalogue.errorMessages.network);
  });
});
