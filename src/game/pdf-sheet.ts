/**
 * The printable sheet's geometry: every millimetre, the grid, the duplex column mirror, and the
 * answer side's type.
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
 *  wrong is the defect that wastes a whole ream.** A card is a QR on one face and
 *  the year on the other, so a front/back misalignment does not look slightly
 *  off -- it pairs every card with the wrong answer, and the only way to find out
 *  is to print, cut, and turn one over. That is exactly the kind of arithmetic a
 *  unit test pins and a person does not.
 * ===========================================================================
 *
 * ===========================================================================
 *  THE CARD IS 48.97 mm AND THE GRID IS 4 x 4 AS OF 2026-09-21, AND THAT
 *  REVERSES THE 2026-08-06 DECISION THIS HEADER USED TO ARGUE FOR. READ THIS
 *  BEFORE "RESTORING" 65 mm.
 *
 *  What was here: **65 mm square, 3 x 4 = 12 per sheet**, chosen because 65 mm is
 *  the real shop-bought Hitster card, "so a printed deck shuffles into a bought
 *  one".
 *
 *  What reversed it: a developer request. The app SHIPS its own printable year
 *  cards -- `public/year-cards-1970-2033.pdf`, offered on the welcome screen --
 *  and a deck printed from this module has to be interchangeable with THOSE, not
 *  with a boxed game nobody in this flow owns. Two different card sizes in one
 *  player's hands is the actual failure: a year card and a song card that do not
 *  stack. Matching the app's own template is therefore strictly better than
 *  matching a third party's, and it is also the only one of the two this repo can
 *  verify -- the template is a committed file that can be measured, where 65 mm
 *  was a remembered number.
 *
 *  Where the numbers come from: the template's own content streams, decoded with
 *  Python (it is ReportLab output re-saved by PDFsharp 6.2.4; the procedure is
 *  written up in `docs/agent_findings.md`). Every one of its pages carries the
 *  same grid, and the first slot is drawn by
 *
 *      n 20 559.7638 138.8189 138.8189 re S
 *
 *  a 138.8189 pt square at x = 20 pt. The four column origins are 20 / 158.8189 /
 *  297.6378 / 436.4567 pt and the four row origins (PDF measures from the BOTTOM)
 *  are 559.7638 / 420.9449 / 282.126 / 143.3071 pt -- so the grid is centred on
 *  both axes, with 20 pt at the sides and 143.3071 pt top and bottom. In
 *  millimetres: a 48.9722 mm card, 7.0556 mm side margins, 50.5556 mm top and
 *  bottom.
 *
 *  What did NOT change: the duplex mirror below, which still works because the
 *  grid is still centred, and `planSheets`' front/back interleaving. The template
 *  is not laid out that way -- its ten pages are eight year fronts followed by two
 *  pages of a repeated decorative back -- but that is a single-sided artefact with
 *  no per-card pairing to get wrong. A deck card has an answer on its reverse, so
 *  it needs the interleave.
 * ===========================================================================
 *
 * ## Why the numbers live here and not in the `@theme` block
 *
 * `src/index.css` owns the SCREEN's dimensions. These are millimetres on paper: they answer to A4
 * and to a pair of scissors, not to a viewport, and nothing in CSS can consume them. The print
 * palette is separate from the screen's for the same reason (decision 6) -- a near-black card with
 * a neon ring is ink-expensive, and a QR scans as dark modules on a light field with a quiet zone,
 * so inverting or tinting it is how a printed deck fails at the one job the QR has.
 */

/**
 * Points to millimetres. The template is measured in points and this module speaks millimetres, so
 * the conversion is named once rather than written out at each of its uses.
 */
const MM_PER_PT = 25.4 / 72;

/** A4 portrait, in millimetres. `jsPDF` is constructed with `{ unit: 'mm', format: 'a4' }`. */
export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;

export const GRID_COLUMNS = 4;
export const GRID_ROWS = 4;

/** 16. Derived rather than written down, so the two above cannot disagree with it. */
export const CARDS_PER_SHEET = GRID_COLUMNS * GRID_ROWS;

/**
 * The template's outer margin: a flat 20 pt at each side of the page.
 *
 * This is the one number read off `year-cards-1970-2033.pdf` that is not derived from another --
 * everything else on the page follows from it and from A4. See the header block.
 */
export const SHEET_MARGIN_X_MM = 20 * MM_PER_PT;

/**
 * The card: a 48.9722 mm square, which is the template's 138.8189 pt exactly.
 *
 * DERIVED from the page and the margin rather than written down, so this file cannot hold a card
 * size that disagrees with the margin it is supposed to sit inside. `(210 - 2 x 7.0556) / 4`.
 */
export const CARD_SIZE_MM = (PAGE_WIDTH_MM - 2 * SHEET_MARGIN_X_MM) / GRID_COLUMNS;

/**
 * The margins, centring the grid on the page.
 *
 * Derived, not chosen: a hand-written margin plus a hand-written card size is two numbers that have
 * to be kept in sync with the page, and the first change to either would push the last column off
 * the paper. Centring also means the duplex mirror is a reflection about the page's own centre
 * line, which is what makes `backPlacement` a subtraction rather than a table.
 *
 * Both reproduce the template: `MARGIN_X_MM` comes back out at 7.0556 mm -- the same 20 pt that
 * went into `CARD_SIZE_MM`, which is what makes the derivation above consistent rather than
 * circular -- and `MARGIN_Y_MM` at 50.5556 mm, the template's 143.3071 pt. `pdf-sheet.test.ts`
 * pins both against the template's own numbers.
 */
export const MARGIN_X_MM = (PAGE_WIDTH_MM - GRID_COLUMNS * CARD_SIZE_MM) / 2;
export const MARGIN_Y_MM = (PAGE_HEIGHT_MM - GRID_ROWS * CARD_SIZE_MM) / 2;

/**
 * The 65 mm card the answer side's type and insets were drawn for, kept only as a SCALE reference.
 *
 * The card shrank by a quarter when it moved to the template's size, and every inset and point size
 * below was tuned against the old one. Scaling them all by one ratio keeps the proportions that
 * were already looked at, instead of re-inventing five numbers by eye. The year is the one
 * exception -- see `YEAR_POINT_SIZE`, which copies the template rather than the old card.
 */
const TYPE_REFERENCE_CARD_SIZE_MM = 65;

/** How much smaller the card is than the size the back's type was drawn for. 0.7534. */
const TYPE_SCALE = CARD_SIZE_MM / TYPE_REFERENCE_CARD_SIZE_MM;

/**
 * The quiet zone plus cut allowance inside a card, in millimetres. 4.52 mm.
 *
 * The QR is drawn inside this inset, which is what keeps a scannable margin around the code even if
 * the cut wanders by a millimetre or two. `qrcode` is also asked for `margin: 1` module of its own;
 * the two are additive and both are wanted -- one is part of the symbol, this one is paper.
 *
 * SCALED with the card rather than left at the old flat 6 mm, and the choice is deliberate: 6 mm on
 * a 48.97 mm card is 12.3% a side where it was 9.2%, so keeping it would have shrunk the code by
 * 30% while the card shrank by 25%. At 4.52 mm the symbol is 39.93 mm. A Spotify track URL encodes
 * as a 33-module version-4 symbol at level `M`, so with the one built-in margin module that is 35
 * modules across 39.93 mm -- 1.14 mm a module, and the paper inset is a further 3.96, for 4.96
 * modules of quiet zone a side against the 4 the spec asks for. Bigger is strictly better for a
 * camera, and this is the larger of the two options.
 */
export const CARD_PADDING_MM = 6 * TYPE_SCALE;

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
 *  wrong answer -- four columns wrong on every one of sixteen cards, discovered
 *  only after printing and cutting.
 *
 *  `GRID_COLUMNS - 1 - column` is the correction, and because the grid is CENTRED
 *  on the page it is also exactly a reflection: `xFront + xBack` is constant at
 *  `PAGE_WIDTH_MM - CARD_SIZE_MM` for every card. `pdf-sheet.test.ts` asserts that
 *  identity rather than the individual numbers, which is what makes the test
 *  survive a change of card size -- as it just did, when the card went from 65 mm
 *  and three columns to the template's 48.97 mm and four.
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

/**
 * The year's point size, copied from the template and NOT scaled. `/F2 28 Tf`, where `F2` is
 * Helvetica-Bold.
 *
 * ===========================================================================
 *  THE ONE NUMBER ON THE ANSWER SIDE THAT IS THE TEMPLATE'S RATHER THAN THIS
 *  APP'S, AND IT HAS TO BE.
 *
 *  A year card and a deck card end up in the same hand, face up, side by side on
 *  a timeline. The card is now the same square, so the year printed on it should
 *  be the same year in the same place at the same size, or the two read as two
 *  different games. The template draws it in Helvetica-Bold at 28 pt with its
 *  baseline exactly 10 pt below the card's centre (card 559.7638..698.5827,
 *  baseline 619.1732), horizontally centred -- so that is what
 *  `YEAR_BASELINE_BELOW_CENTRE_PT` and this constant reproduce.
 *
 *  It is NOT scaled by `TYPE_SCALE`, because it is not one of the old 65 mm card's
 *  numbers. The old card set it at 34 pt; that is gone.
 * ===========================================================================
 */
const YEAR_POINT_SIZE = 28;

/** The template's baseline offset: 10 pt below the card's vertical centre. See above. */
const YEAR_BASELINE_BELOW_CENTRE_PT = 10;

/** jsPDF's default line-height factor, which is what `doc.text(lines, ...)` advances by. */
const LINE_HEIGHT_FACTOR = 1.15;

/** The most lines of each the answer side will draw. Anything longer is truncated by the caller. */
export const MAX_TITLE_LINES = 3;
export const MAX_ARTIST_LINES = 2;

/**
 * Everything the answer side needs, in millimetres and points, for a card at `placement`.
 *
 * ===========================================================================
 *  THIS INTERFACE EXISTS BECAUSE THE HOOK'S HEADER WAS LYING (2026-09-21).
 *
 *  `usePdfExport` claims "every millimetre is in `src/game/pdf-sheet.ts`", and
 *  until this landed `drawBack` held six of them inline -- `yMm + 28`, `yMm + 40`,
 *  `CARD_SIZE_MM - 12`, `title.length * 5 + 2`, and the 34/11/9 pt type sizes.
 *  Every one was tuned against a 65 mm card, and every one is an ABSOLUTE
 *  millimetre offset rather than a proportion, so shrinking the card to 48.97 mm
 *  pushed the artist's baseline to roughly 52-57 mm -- off the bottom of its own
 *  card and onto the next one down the sheet. A green build, and discoverable only
 *  by printing.
 *
 *  So the layout moved here, where it is derived from `CARD_SIZE_MM` and where a
 *  test can assert the thing that actually matters: that the WORST case --
 *  `MAX_TITLE_LINES` of title plus `MAX_ARTIST_LINES` of artist -- still ends
 *  inside the card. It does, with about 2.2 mm to spare.
 * ===========================================================================
 *
 * The vertical order is the same as `CardRevealSide`: the year, then the title, then the artist.
 * The gaps are expressed in TITLE LINE HEIGHTS rather than in millimetres, so they scale with the
 * type they separate instead of having to be re-chosen with it.
 */
export interface BackLayout {
  /** The horizontal centre of the card. Every line on this face is centred on it. */
  centreXMm: number;
  /** How wide a line may be before `splitTextToSize` wraps it. */
  textWidthMm: number;
  /** Baseline of the year, in millimetres from the page's top. */
  yearBaselineMm: number;
  /** Baseline of the FIRST title line. Later lines advance by `titleLineHeightMm`. */
  titleBaselineMm: number;
  /** How far `doc.text` advances between two title lines. */
  titleLineHeightMm: number;
  /** How far the first artist line sits below the LAST title line drawn. */
  artistGapMm: number;
  /** How far `doc.text` advances between two artist lines. */
  artistLineHeightMm: number;
  /** Point sizes, as jsPDF's `setFontSize` takes them. */
  yearPointSize: number;
  titlePointSize: number;
  artistPointSize: number;
}

/**
 * Helvetica's cap height and descender depth as fractions of the point size.
 *
 * Only the TEST uses these, and only to check that two lines of type do not collide -- a baseline
 * is a position, not a bounding box, so "the last baseline is inside the card" is not the same
 * claim as "the ink is". Exported rather than duplicated in the test file so the layout above and
 * the assertion about it cannot drift apart. Read off Helvetica's AFM metrics (718 and -207 per
 * 1000 em), rounded to the two digits the assertion needs.
 */
export const HELVETICA_CAP_HEIGHT_RATIO = 0.717;
export const HELVETICA_DESCENDER_RATIO = 0.21;

/** Points to millimetres, for a caller reasoning about type sizes against the card. */
export const pointsToMm = (points: number): number => points * MM_PER_PT;

export function backLayout(placement: CardPlacement): BackLayout {
  const titlePointSize = 11 * TYPE_SCALE;
  const artistPointSize = 9 * TYPE_SCALE;
  const titleLineHeightMm = titlePointSize * LINE_HEIGHT_FACTOR * MM_PER_PT;

  const yearBaselineMm =
    placement.yMm + CARD_SIZE_MM / 2 + YEAR_BASELINE_BELOW_CENTRE_PT * MM_PER_PT;

  return {
    centreXMm: placement.xMm + CARD_SIZE_MM / 2,
    // The same inset the QR gets, spelled as the constant rather than as a second copy of it.
    textWidthMm: CARD_SIZE_MM - 2 * CARD_PADDING_MM,
    yearBaselineMm,
    /*
      1.7 and 0.9 title line heights, and both are the loosest pair that fits rather than round
      numbers. The budget below a year centred on the card is 20.96 mm, and the worst case has to
      spend it on three title lines, two artist lines and two clearances -- the artist's CAP height
      must clear the last title line's DESCENDER, which is the collision a "fits inside the card"
      test alone would miss. At 1.7 / 0.9 the gap between those two is 0.70 mm and the last artist
      descender still ends 2.24 mm above the cut. `pdf-sheet.test.ts` pins both.
    */
    titleBaselineMm: yearBaselineMm + 1.7 * titleLineHeightMm,
    titleLineHeightMm,
    artistGapMm: 0.9 * titleLineHeightMm,
    artistLineHeightMm: artistPointSize * LINE_HEIGHT_FACTOR * MM_PER_PT,
    yearPointSize: YEAR_POINT_SIZE,
    titlePointSize,
    artistPointSize,
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
