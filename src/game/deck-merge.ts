/**
 * Folding up to five already-fetched playlists into ONE deck.
 *
 * Pure over outcomes the caller already has: no `fetch`, no `window`, no storage. The fan-out
 * itself is `usePlaylist`'s -- this module only decides what the results MEAN together, which is
 * the same decision/binding split `gestures.ts`, `resolver.ts` and `pdf-sheet.ts` already follow,
 * and for the same reason: a wrong dedupe or a wrong label is invisible to every DOM test. Every
 * rule below is a node-environment unit test.
 *
 * ===========================================================================
 *  WHY THE FAN-OUT IS CLIENT-SIDE AND `api/playlist.ts` IS UNTOUCHED
 *  (decision 1).
 *
 *  The obvious alternative -- one request carrying five `url` params -- has no
 *  way to say "four of these worked". Partial success is not in
 *  `PlaylistErrorCode`, so a 200 body carrying per-playlist failures would be a
 *  NEW response shape: it widens `shared/types.ts` and the handler's
 *  documented-exhaustive status table, and it puts merge logic in `api/`, which
 *  is deliberately thin, untested, and where both deploy-only hazards live (the
 *  `@/` alias and the `.js` extension rule).
 *
 *  It would also stretch one function invocation across five sequential embed
 *  fetches and make the edge cache key the exact COMBINATION of playlists -- so
 *  two decks sharing four playlists out of five would share no cache entry.
 *
 *  Fanning out in the browser keeps every playlist a separately cached
 *  `/api/playlist?url=` request and keeps each failure attributable to the row
 *  it came from.
 * ===========================================================================
 */

import type { PlaylistClientErrorCode, PlaylistOutcome } from './playlist-client';
import type { Card, PlaylistSummary } from '../../shared/types';

/**
 * How many playlists one deck may be dealt from.
 *
 * A CLIENT-SIDE INPUT RULE, so it lives here rather than in `shared/constants.ts` -- nothing under
 * `api/` needs it, and the endpoint still answers one playlist per request whatever this says.
 * `deck-link.ts` and the landing screen both import it, so the number exists exactly once.
 */
export const MAX_DECK_PLAYLISTS = 5;

/** One deck dealt from one or more playlists, plus everything the notices need. */
export interface MergedDeck {
  /** The playlists that LOADED, in the order the player entered their rows. Never empty. */
  playlists: PlaylistSummary[];
  /** Every card from every loaded playlist, concatenated in row order and deduped. Never empty. */
  cards: Card[];
  /** True when ANY playlist came back at the embed cap. One notice covers all of them. */
  truncated: boolean;
  /** The SUM of the per-playlist skipped counts. */
  skippedCount: number;
  /**
   * The codes of the playlists that did NOT load, in row order.
   *
   * Non-empty here means a PARTIAL failure, which is a notice rather than an error (decision 4):
   * one dead editorial playlist must not cost a five-playlist deck. A TOTAL failure never reaches
   * this shape -- `mergePlaylists` returns a bare code instead.
   */
  failures: PlaylistClientErrorCode[];
}

/**
 * A merge that produced a deck, or the one code the landing screen's single error slot shows.
 *
 * Shaped like `PlaylistOutcome` on purpose: the caller is a hook that already branches on `ok`.
 */
export type MergeOutcome =
  { ok: true; deck: MergedDeck } | { ok: false; code: PlaylistClientErrorCode };

/**
 * Fold the outcomes of one fan-out into a single deck.
 *
 * @param outcomes one per playlist, **in the order the player entered the rows**. The shuffle makes
 *   that order irrelevant to play; it is here so the tests are exact and so the failure reported
 *   below is the first row's.
 *
 * ===========================================================================
 *  NO NEW `StartFailureCode` (decision 5).
 *
 *  A partial failure is a NOTICE, and a total failure is already exactly one of
 *  the codes `fetchPlaylist` can return -- so `messages.ts`'s exhaustive `Record`
 *  is untouched by this whole feature.
 * ===========================================================================
 */
export function mergePlaylists(outcomes: readonly PlaylistOutcome[]): MergeOutcome {
  // Nothing was even asked for. Not reachable from the landing screen -- an all-blank submit is
  // rejected per-row before it gets here -- but a merge over nothing has no honest deck to return,
  // and `empty-playlist` is the code whose copy already says "there is nothing to play".
  if (outcomes.length === 0) return { ok: false, code: 'empty-playlist' };

  const playlists: PlaylistSummary[] = [];
  const failures: PlaylistClientErrorCode[] = [];
  let truncated = false;
  let skippedCount = 0;

  /*
    Deduped by `Card.id`, FIRST OCCURRENCE WINS, order preserved.

    Nothing else needs merging, and that is a property of where these cards come from rather than a
    simplification: a card from `/api/playlist` never carries a year (the embed payload has no
    release date at track level), so two copies of one track differ in NOTHING the game reads --
    same title, same artist, same duration, same preview, same QR target. Keeping the first is
    therefore the same as keeping either.

    Two identical cards in one deck read as a bug to the player, and the same track appearing in two
    of someone's five playlists is the ordinary case rather than the exotic one.
  */
  const cards: Card[] = [];
  const seen = new Set<string>();

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failures.push(outcome.code);
      continue;
    }

    const { result } = outcome;
    playlists.push(result.playlist);
    truncated = truncated || result.truncated;
    skippedCount += result.skippedCount;

    for (const card of result.cards) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      cards.push(card);
    }
  }

  // Not one playlist loaded. The FIRST failure is reported, so the landing screen's single error
  // slot describes the first row that went wrong rather than an arbitrary one -- which is also why
  // this function insists on row order.
  if (playlists.length === 0) {
    // Non-null by construction: every outcome was a failure, and `outcomes` is non-empty.
    return { ok: false, code: failures[0]! };
  }

  // Every playlist loaded and between them they hold nothing. Reachable through the merge even
  // though `fetchPlaylist` rejects an empty deck on its own, because a future caller could hand in
  // a filtered outcome -- and `START` on an empty deck is the case the reducer's own comment says
  // nothing above it owns.
  if (cards.length === 0) return { ok: false, code: 'empty-playlist' };

  return { ok: true, deck: { playlists, cards, truncated, skippedCount, failures } };
}

/**
 * What to call a deck: the first playlist's name, plus a count of the rest.
 *
 * ===========================================================================
 *  ONE FUNCTION, FOUR SURFACES, SO THEY CANNOT DISAGREE (decision 6).
 *
 *  The HUD, the end screen's count line, the PDF filename and the saved-library
 *  row all read this. Short enough for the HUD -- which already truncates a long
 *  name -- and it still names a deck the player recognises, which "3 playlists"
 *  would not.
 *
 *  PLAYLIST-LEVEL DATA ONLY. A playlist title is the same class of string the
 *  suggestion buttons already render, so this is safe on a pre-reveal surface;
 *  no track title, artist or year can reach it, because a `PlaylistSummary`
 *  holds none.
 *
 *  The `"+N more"` suffix goes through `pdfFileName`, which slugs it: "Rock
 *  Classics +2 more" becomes `hitster-rock-classics-2-more.pdf`. Checked
 *  2026-08-07 (plan 1, open question 1) -- readable, and the `+` cannot reach a
 *  filesystem.
 * ===========================================================================
 *
 * Empty in for empty out, so a caller rendering an `idle` session gets `''` rather than a crash --
 * that is the case the dropped `playlist: null` sentinel used to cover.
 */
export function deckLabel(playlists: readonly PlaylistSummary[]): string {
  const first = playlists[0];
  if (!first) return '';

  const others = playlists.length - 1;

  return others === 0 ? first.name : `${first.name} +${others} more`;
}
