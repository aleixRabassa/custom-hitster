/**
 * The vocabulary of the client-side game layer (plan.phase-3.md).
 *
 * DELIBERATELY NOT IN `shared/types.ts`. Everything here is browser-only: no function
 * under `api/` needs to know which card is current or how the deck was shuffled.
 * `shared/types.ts` already reserves `GameState` for this phase while forbidding any of
 * it from widening `Card` -- keeping these declarations here honours both halves at once
 * (decision 12). A `Card` stays playlist data: cacheable, comparable, and free of session
 * state.
 */

import type { Card, PlaylistSummary, YearConfidence } from '../../shared/types';

/**
 * Where a session is in its life cycle.
 *
 * - `idle`:      nothing started. The landing screen's state (Phase 6).
 * - `preparing`: THE CARD-1 GATE. `START` has run and the deck is shuffled, but the START
 *                card's answer is not FINAL yet -- a provisional `resolve` year does not open
 *                it (plan.year-fetch-rework-game.md). Card 1, except for a deal from a shared
 *                mid-game link, which starts on the sender's card (2026-09-29). Never entered
 *                when the session can drop nothing -- it keeps yearless cards (`keepYearless`)
 *                and keeps unconfirmed ones (`skipUnconfirmed` false): nothing waits then.
 *                **The only status Phase 6 may render a loading screen for** -- a wait here is
 *                one lookup (1.3-3.6 s cold), never the whole deck (minutes; see `resolver.ts`
 *                for the measurements).
 * - `playing`:   playable. Cards 2..n may still be unresolved; that is normal, not a wait.
 * - `ended`:     the deck ran out, or the player hit Exit. The resolver is stopped and the
 *                saved session is cleared.
 */
export type GameStatus = 'idle' | 'preparing' | 'playing' | 'ended';

/**
 * The whole client-side session.
 *
 * Derived values are NOT fields here on purpose -- `currentCard`, `isCurrentYearPending`,
 * `cardsRemaining`, `cardsPlayed`, `resolvedCount` and `pendingYearCount` are exported as
 * functions beside the reducer, so they cannot go stale against the deck they describe.
 */
export interface GameState {
  status: GameStatus;
  /**
   * The playlists this deck was dealt from, ordered as the player entered the rows.
   *
   * ===========================================================================
   *  1..5 ENTRIES WHENEVER THE STATUS IS NOT `idle`, AND EMPTY EXACTLY WHILE IT
   *  IS. THE `null` SENTINEL IS GONE DELIBERATELY (decision 2).
   *
   *  This was `playlist: PlaylistSummary | null` until multi-playlist. Widening
   *  it to an array makes ONE playlist the `n = 1` case, so no consumer carries a
   *  permanent two-shape branch -- and an empty array carries the same
   *  information the `null` did without being a SECOND empty state to test for
   *  beside `status === 'idle'`.
   *
   *  The obvious cheaper change -- keep `playlist` singular and add a sibling id
   *  list -- was rejected because the id is not decorative: it feeds the share
   *  link and the library key, so every consumer would have to know which of two
   *  overlapping fields to read, forever.
   *
   *  Never invented; every entry comes from `/api/playlist`, folded together by
   *  `deck-merge.ts`. `deckLabel()` is the one function that turns this into a
   *  string, so the HUD, the end screen, the PDF filename and the library row
   *  cannot disagree about what the deck is called.
   * ===========================================================================
   */
  playlists: readonly PlaylistSummary[];
  /**
   * The shuffle seed this deck was dealt with. Persisted, and accepted as an override on
   * `START`, which is what made Phase 8's shareable URL (playlist id + seed) a caller change; a
   * mid-game link adds the start card (2026-09-29). Only meaningful together with the exact
   * function that deals it -- see `shuffleDeck` in `shuffle.ts`. Empty string while `idle`.
   */
  seed: string;
  /**
   * The SHUFFLED deck. Years are filled in place as the resolver reports them, which is why
   * `Card.year` is three-state: `undefined` = not looked up, `null` = a FINAL "no year", a
   * number = resolved -- provisionally while `yearProvisional` is set (`yearStateOf()`).
   *
   * ===========================================================================
   *  `null` APPEARS HERE ONLY WHEN `keepYearless` IS TRUE (reversal 2026-08-05,
   *  narrowed 2026-09-30).
   *
   *  With the option OFF, a card whose FINAL answer is no year is REMOVED from
   *  the deck instead of being stored with `year: null` -- there is nothing to
   *  place on a timeline, so there is nothing to play. `gameReducer`'s
   *  `YEAR_RESOLVED` branch carries the decision and its consequences; `RESUME`
   *  filters the same way, so a save written before the reversal cannot smuggle
   *  one back in. A provisional answer never drops a card.
   *
   *  So with the option off every card in a live deck has `year: undefined`
   *  (still crawling) or a number, and the deck SHRINKS over a session, by
   *  roughly a third on a real playlist before the provider vote -- anything
   *  deriving a total from `deck.length` should expect it to fall as well as to
   *  be reached. With it ON the deck never shrinks and a yearless card plays.
   *
   *  `null` remains in `Card.year`'s type because that is the shape of the lookup
   *  RESULT, which is a different thing from the shape of a playable deck.
   * ===========================================================================
   */
  deck: Card[];
  /** Index into `deck`. Clamped to the last card when the deck ends -- never out of bounds. */
  currentIndex: number;
  /**
   * The LOWEST index the player has been on this game (2026-09-29). Zero for every deal except one
   * that starts from a shared link's `card` param, where it is that card's index; `PREVIOUS` lowers
   * it, and dropped yearless cards before it move it back exactly as they move `currentIndex`.
   * Always `<= currentIndex`. It exists so the end screen counts the cards this player actually
   * played (`cardsPlayed` in `reducer.ts`) rather than the whole deck.
   */
  startIndex: number;
  /** Whether the current card is showing its revealed side. Reset by `NEXT`. */
  isFlipped: boolean;
  /**
   * The picker's "Keep cards with no year found" -- "Skip cards with no year found" UNTICKED since
   * 2026-10-01, see below -- (plan.year-fetch-rework-game.md, spike
   * §12.8), fixed for the whole session at `START`. When true, a final null KEEPS the card
   * with `year: null` and nothing gates on a year, so the game starts at once; when false,
   * a final null drops the card and the start card's answer must be FINAL before play.
   * Restart re-deals with this value, never the picker's current preference.
   *
   * THE PICKER SHOWS THE INVERSE since 2026-10-01: its checkbox reads "Skip cards with no year
   * found", checked exactly when this is FALSE. Only the binding in `App.tsx` inverts; the model,
   * the save and `prefs.ts` keep this polarity, so no stored value changed meaning.
   */
  keepYearless: boolean;
  /**
   * The picker's "Skip cards with an unconfirmed year" (2026-10-01), fixed for the session at
   * `START` exactly like `keepYearless`. When true, a card whose FINAL answer is a year at `low`
   * confidence -- a year no second provider confirmed, which the reveal labels "Unconfirmed year"
   * -- is REMOVED from the deck, by the same rule and at the same three entry points as a final
   * null; and the start card's answer must be final before play, since a provisional year may
   * still settle at `low`. A PROVISIONAL year is never dropped by it: it is always `low` and its
   * confidence is not final until the card is. Independent of `keepYearless` -- a final null is
   * not "unconfirmed", it has no year to confirm.
   */
  skipUnconfirmed: boolean;
  /**
   * Set when year lookups cannot work at all for this deployment (`not-configured`, i.e. no
   * `MUSICBRAINZ_USER_AGENT` on the server). A hard stop, not a retry signal: the deck stays
   * playable and yearless rather than hanging in `preparing` forever.
   */
  yearLookupsUnavailable: boolean;
}

/**
 * Everything that can happen to a session, as a discriminated union on `type`.
 *
 * `plan.md` §5 names only `START`, `FLIP`, `NEXT` and `END`. The other three exist because
 * the surrounding machinery has to talk to the reducer somehow, and each has exactly one
 * caller:
 *
 * - `YEAR_RESOLVED`            -- how `resolver.ts` reports a completed lookup back in. The
 *                                 reducer never calls the resolver; it only records.
 * - `RESUME`                   -- how a validated `PersistedSession` re-enters after a reload.
 * - `YEAR_LOOKUPS_UNAVAILABLE` -- the deployment-fault stop described on
 *                                 `GameState.yearLookupsUnavailable`.
 */
export type GameAction =
  /**
   * Deal a new deck. Shuffles synchronously (decision 15: shuffle first, then resolve), so
   * the resolver is only ever handed an already-shuffled deck and "card 1" always means the
   * first card of the SHUFFLED deck. `seed` is generated when omitted, and `startCardId` (a
   * shared link's `card` param) starts the player on that card instead of card 1 -- looked up in
   * the SHUFFLED deck, and ignored when no card there has that id.
   */
  | {
      type: 'START';
      cards: Card[];
      playlists: readonly PlaylistSummary[];
      seed?: string;
      startCardId?: string;
      /** See `GameState.keepYearless`. Required, so no call site can forget to decide it. */
      keepYearless: boolean;
      /** See `GameState.skipUnconfirmed`. Required, for the same reason. */
      skipUnconfirmed: boolean;
    }
  /**
   * One completed lookup -- final or provisional, see `YearResolvedAction`. Matched onto the deck BY CARD ID, never by index (decision 13):
   * the resolver's priority jump makes its ordering and the deck's ordering diverge
   * routinely, and index matching would corrupt the deck the first time it did.
   */
  | YearResolvedAction
  | { type: 'YEAR_LOOKUPS_UNAVAILABLE' }
  | { type: 'FLIP' }
  | { type: 'NEXT' }
  /**
   * Step back one card (2026-09-18). A LEFT swipe or ArrowLeft; a no-op on card 1. The deck is
   * no longer one-directional -- see the `PREVIOUS` case in `reducer.ts` for what that did and did
   * not change.
   */
  | { type: 'PREVIOUS' }
  | { type: 'RESUME'; session: PersistedSession }
  | { type: 'END' };

/**
 * One completed lookup, as a union of two arms (plan.year-fetch-rework-game.md step 1).
 *
 * - The FINAL arm is the pre-provider-vote payload unchanged: a number or null, plus
 *   confidence. It has no `provisional` field at all, so every existing literal still
 *   type-checks as a final answer.
 * - The PROVISIONAL arm is a `resolve`-stage year awaiting `verify`: always a number, always
 *   `low` (the server never marks a provisional answer `high`).
 *
 * There is NO provisional null: a `resolve` that found nothing dispatches nothing and the card
 * stays pending. That is only expressible because this action cannot carry it.
 */
export type YearResolvedAction =
  | { type: 'YEAR_RESOLVED'; cardId: string; year: number | null; confidence: YearConfidence }
  | { type: 'YEAR_RESOLVED'; cardId: string; year: number; confidence: 'low'; provisional: true };

/**
 * The `localStorage` shape, kept structurally separate from `GameState` even where the two
 * currently coincide.
 *
 * That separation is the point: a new state field can then be added without silently
 * changing the storage format, and every field here is one `loadSession()` validates before
 * trusting. `version` is checked on read -- see `persistence.ts` for the key's `v1` segment,
 * which is the same invalidation lever `api/_lib/cache.ts` uses.
 *
 * `yearLookupsUnavailable` is deliberately absent: it describes the SERVER's configuration
 * at the time of the crawl, not the session, and re-deriving it on the next crawl is both
 * cheap and more likely to be right.
 */
export interface PersistedSession {
  version: number;
  /**
   * The deck's playlists, in row order. Non-empty -- a saved session always describes a dealt deck.
   *
   * Deliberately NOT capped at `MAX_DECK_PLAYLISTS` on read: the cap governs what the landing screen
   * accepts as INPUT, and this describes a deck that already exists. See `validateSession`.
   */
  playlists: PlaylistSummary[];
  seed: string;
  /** The shuffled deck INCLUDING every year already resolved -- so a reload costs zero lookups. */
  deck: Card[];
  currentIndex: number;
  /** See `GameState.startIndex`. Optional in storage (absent = 0), required here. */
  startIndex: number;
  isFlipped: boolean;
  /** Never `idle`: there would be nothing to save. */
  status: GameStatus;
  /** See `GameState.keepYearless`. Optional in storage (absent = false), required here. */
  keepYearless: boolean;
  /** See `GameState.skipUnconfirmed`. Optional in storage (absent = false), required here. */
  skipUnconfirmed: boolean;
}
