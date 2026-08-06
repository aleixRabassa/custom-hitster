/**
 * The printable sheet's geometry: every millimetre, the grid, and the duplex column mirror.
 *
 * ===========================================================================
 *  PURE ARITHMETIC OVER NUMBERS, WITH THE PDF LIBRARY NOWHERE NEAR IT.
 *
 *  The same decision/binding split the repo uses for gestures (`gestures.ts` vs
 *  `useCardGestures`) and for year resolution (`resolver.ts` vs the hook). Every
 *  position on the page is decided here and node-tested; `usePdfExport` only
 *  loads jsPDF, generates a QR per card, and draws what this module returns.
 *
 *  The reason is specific rather than stylistic: **getting the duplex mirror
 *  wrong is the defect that wastes a whole ream.** A Hitster card is a QR on one
 *  face and the year on the other, so a front/back misalignment does not look
 *  slightly off -- it pairs every card with the wrong answer, and the only way to
 *  find out is to print, cut, and turn one over. That is exactly the kind of
 *  arithmetic a unit test pins and a person does not.
 * ===========================================================================
 *
 * ## The sizes, and where they come from
 *
 * A4 portrait, **65 mm square cards, 3 × 4 = 12 per sheet** (decided 2026-08-06, open question 2).
 * 65 mm square is the real Hitster card, so a printed deck shuffles into a bought one. The content
 * block is then 195 × 260 mm, which leaves 7.5 mm at the sides and 18.5 mm top and bottom -- inside
 * the ~5 mm unprintable border of every consumer printer, with room to spare for the cut.
 *
 * ## Why the numbers live here and not in the `@theme` block
 *
 * `src/index.css` owns the SCREEN's dimensions. These are millimetres on paper: they answer to A4
 * and to a pair of scissors, not to a viewport, and nothing in CSS can consume them. The print
 * palette is separate from the screen's for the same reason (decision 6) -- a near-black card with
 * a neon ring is ink-expensive, and a QR scans as dark modules on a light field with a quiet zone,
 * so inverting or tinting it is how a printed deck fails at the one job the QR has.
 */

/** A4 portrait, in millimetres. `jsPDF` is constructed with `{ unit: 'mm', format: 'a4' }`. */
export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;

/** The real Hitster card: a 65 mm square. See the header block. */
export const CARD_SIZE_MM = 65;

export const GRID_COLUMNS = 3;
export const GRID_ROWS = 4;

/** 12. Derived rather than written down, so the two above cannot disagree with it. */
export const CARDS_PER_SHEET = GRID_COLUMNS * GRID_ROWS;

/**
 * The margins, centring the grid on the page.
 *
 * Derived, not chosen: a hand-written margin plus a hand-written card size is two numbers that have
 * to be kept in sync with the page, and the first change to either would push the last column off
 * the paper. Centring also means the duplex mirror is a reflection about the page's own centre
 * line, which is what makes `backPlacement` a subtraction rather than a table.
 */
export const MARGIN_X_MM = (PAGE_WIDTH_MM - GRID_COLUMNS * CARD_SIZE_MM) / 2;
export const MARGIN_Y_MM = (PAGE_HEIGHT_MM - GRID_ROWS * CARD_SIZE_MM) / 2;

/**
 * The quiet zone plus cut allowance inside a card, in millimetres.
 *
 * The QR is drawn inside this inset, which is what keeps a scannable margin around the code even if
 * the cut wanders by a millimetre or two. `qrcode` is also asked for `margin: 1` module of its own;
 * the two are additive and both are wanted -- one is part of the symbol, this one is paper.
 */
export const CARD_PADDING_MM = 6;

/** Where one card sits on one sheet. Millimetres from the page's top-left, as jsPDF measures. */
export interface CardPlacement {
  /** Index into the deck being printed. */
  cardIndex: number;
  /** Zero-based sheet number. Front sheet `n` is printed on the same paper as back sheet `n`. */
  sheet: number;
  /** Zero-based grid position, for tests and for reasoning. */
  column: number;
  row: number;
  /** The card's top-left corner. */
  xMm: number;
  yMm: number;
}

/** A rectangle, for the QR and for anything else drawn inside a card. */
export interface Box {
  xMm: number;
  yMm: number;
  sizeMm: number;
}

/** How many sheets of paper a deck needs. One physical sheet carries one front and one back. */
export function sheetCount(cardCount: number): number {
  if (cardCount <= 0) return 0;

  return Math.ceil(cardCount / CARDS_PER_SHEET);
}

/**
 * Where card `cardIndex` goes on the FRONT sheets -- the QR side.
 *
 * Reading order: left to right, top to bottom, which is the order the deck is in and the order
 * somebody cutting the sheet expects.
 */
export function frontPlacement(cardIndex: number): CardPlacement {
  const sheet = Math.floor(cardIndex / CARDS_PER_SHEET);
  const indexOnSheet = cardIndex % CARDS_PER_SHEET;
  const column = indexOnSheet % GRID_COLUMNS;
  const row = Math.floor(indexOnSheet / GRID_COLUMNS);

  return {
    cardIndex,
    sheet,
    column,
    row,
    xMm: MARGIN_X_MM + column * CARD_SIZE_MM,
    yMm: MARGIN_Y_MM + row * CARD_SIZE_MM,
  };
}

/**
 * Where the same card goes on the BACK sheets -- the year side.
 *
 * ===========================================================================
 *  THE COLUMNS MIRROR. THE ROWS DO NOT. THIS IS THE WHOLE FEATURE.
 *
 *  Printing double-sided **on the long edge** (the default for portrait A4, and
 *  what the docs tell the player to select) flips the paper about its VERTICAL
 *  centre line. So the sheet's left-hand column comes out behind its right-hand
 *  column, and a back sheet laid out in reading order pairs every card with the
 *  wrong answer -- three columns wrong on every one of twelve cards, discovered
 *  only after printing and cutting.
 *
 *  `GRID_COLUMNS - 1 - column` is the correction, and because the grid is CENTRED
 *  on the page it is also exactly a reflection: `xFront + xBack` is constant at
 *  `PAGE_WIDTH_MM - CARD_SIZE_MM` for every card. `pdf-sheet.test.ts` asserts
 *  that identity rather than the individual numbers, which is what makes the test
 *  survive a change of card size.
 *
 *  SHORT-EDGE binding would mirror the ROWS instead. It is not supported, and the
 *  reason it is not is that a printer setting the app cannot read would silently
 *  invert the correction -- so the docs name the setting instead of the code
 *  guessing at it.
 * ===========================================================================
 */
export function backPlacement(cardIndex: number): CardPlacement {
  const front = frontPlacement(cardIndex);
  const column = GRID_COLUMNS - 1 - front.column;

  return {
    ...front,
    column,
    xMm: MARGIN_X_MM + column * CARD_SIZE_MM,
  };
}

/**
 * Every placement for a deck, front sheets then back sheets, in the order jsPDF should draw them.
 *
 * Front sheet 0, back sheet 0, front sheet 1, back sheet 1 -- interleaved, because that is the page
 * order a duplex printer needs: page 2 is the reverse of page 1. Printing all the fronts and then
 * all the backs would need the player to reload the stack by hand.
 */
export function planSheets(
  cardCount: number,
): { sheet: number; side: 'front' | 'back'; placements: CardPlacement[] }[] {
  const pages: { sheet: number; side: 'front' | 'back'; placements: CardPlacement[] }[] = [];

  for (let sheet = 0; sheet < sheetCount(cardCount); sheet++) {
    const first = sheet * CARDS_PER_SHEET;
    const last = Math.min(first + CARDS_PER_SHEET, cardCount);
    const indexes: number[] = [];
    for (let cardIndex = first; cardIndex < last; cardIndex++) indexes.push(cardIndex);

    pages.push({ sheet, side: 'front', placements: indexes.map(frontPlacement) });
    pages.push({ sheet, side: 'back', placements: indexes.map(backPlacement) });
  }

  return pages;
}

/** The QR's box inside a card: the card inset by `CARD_PADDING_MM` on all four sides. */
export function qrBox(placement: CardPlacement): Box {
  return {
    xMm: placement.xMm + CARD_PADDING_MM,
    yMm: placement.yMm + CARD_PADDING_MM,
    sizeMm: CARD_SIZE_MM - CARD_PADDING_MM * 2,
  };
}

/** The subset of `Card` this module needs. Structural, so the tests need no fixture deck. */
interface PrintableCandidate {
  year?: number | null;
}

/**
 * Split a deck into the cards that can be printed and a COUNT of the ones that cannot.
 *
 * ===========================================================================
 *  A COUNT, NEVER A LIST (step 20).
 *
 *  "3 cards had no year yet and were left out" is leak-free. "Left out: Bohemian
 *  Rhapsody, ..." is the same spoiler the whole app is built to avoid, on the one
 *  screen where the player is about to play the deck again.
 *
 *  The only exclusion this can produce in practice is a card the RESOLVER has not
 *  reached yet: a card whose lookup found nothing is already removed from the deck
 *  by `gameReducer` (2026-08-05), so `year: null` cannot reach a live deck. Both
 *  are excluded anyway -- a printed card with no year is a card that cannot be
 *  placed on a timeline, which is the whole game.
 * ===========================================================================
 */
export function selectPrintableCards<T extends PrintableCandidate>(
  deck: readonly T[],
): { cards: T[]; excludedCount: number } {
  const cards = deck.filter((card) => typeof card.year === 'number');

  return { cards, excludedCount: deck.length - cards.length };
}
