/**
 * Node environment. The whole point of the module: paper geometry with no jsPDF, no DOM and no
 * canvas anywhere near it, so the duplex arithmetic is pinned offline.
 */

import { describe, expect, it } from 'vitest';

import {
  CARDS_PER_SHEET,
  CARD_PADDING_MM,
  CARD_SIZE_MM,
  GRID_COLUMNS,
  GRID_ROWS,
  HELVETICA_CAP_HEIGHT_RATIO,
  HELVETICA_DESCENDER_RATIO,
  MARGIN_X_MM,
  MARGIN_Y_MM,
  MAX_ARTIST_LINES,
  MAX_TITLE_LINES,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  SHEET_MARGIN_X_MM,
  backLayout,
  backPlacement,
  frontPlacement,
  planSheets,
  pointsToMm,
  qrBox,
  selectPrintableCards,
  sheetCount,
} from './pdf-sheet';

/** Floating point: every dimension here is a division, so nothing is compared with `toBe`. */
const MM = 4;

describe('pdf-sheet', () => {
  it('should reproduce the year-cards template grid exactly', () => {
    // ===================================================================
    //  THE TEMPLATE IS THE SPECIFICATION (2026-09-21).
    //
    //  A deck printed from this module has to be interchangeable with
    //  `public/year-cards-1970-2033.pdf`, which the welcome screen offers --
    //  same square, same slots, so the two stack in one hand. These four
    //  numbers are read straight off that file's content streams, whose first
    //  card is drawn by
    //
    //      n 20 559.7638 138.8189 138.8189 re S
    //
    //  with column origins 20 / 158.8189 / 297.6378 / 436.4567 pt and row
    //  origins 559.7638 / 420.9449 / 282.126 / 143.3071 pt (PDF measures from
    //  the bottom). At 25.4/72 mm per point that is a 48.9722 mm card, 7.0556 mm
    //  at the sides and 50.5556 mm top and bottom.
    //
    //  Pinned as literals on purpose. Everything else in this file asserts an
    //  identity that survives a change of card size -- which is exactly why
    //  something has to pin the size itself, or the module could drift away from
    //  the template with every other test still green.
    // ===================================================================
    expect(GRID_COLUMNS).toBe(4);
    expect(GRID_ROWS).toBe(4);
    expect(CARDS_PER_SHEET).toBe(16);

    expect(CARD_SIZE_MM).toBeCloseTo(48.9722, MM);
    expect(MARGIN_X_MM).toBeCloseTo(7.0556, MM);
    expect(MARGIN_Y_MM).toBeCloseTo(50.5556, MM);

    // The derivation is consistent rather than circular: the 20 pt that goes into `CARD_SIZE_MM`
    // is the same margin that centring the grid gives back.
    expect(MARGIN_X_MM).toBeCloseTo(SHEET_MARGIN_X_MM, 10);

    // And in points, against the template's own units, so a future reader can compare by eye.
    expect(CARD_SIZE_MM / pointsToMm(1)).toBeCloseTo(138.8189, 3);
    expect(MARGIN_X_MM / pointsToMm(1)).toBeCloseTo(20, 3);
    expect(MARGIN_Y_MM / pointsToMm(1)).toBeCloseTo(143.3071, 3);
  });

  it('should place every card on the grid within the page margins', () => {
    // A full sheet, every card checked against the paper rather than against a remembered number:
    // a card whose right edge runs past `PAGE_WIDTH_MM` is a card the printer clips.
    for (let cardIndex = 0; cardIndex < CARDS_PER_SHEET; cardIndex++) {
      const placement = frontPlacement(cardIndex);

      expect(placement.xMm).toBeGreaterThanOrEqual(MARGIN_X_MM);
      expect(placement.yMm).toBeGreaterThanOrEqual(MARGIN_Y_MM);
      expect(placement.xMm + CARD_SIZE_MM).toBeLessThanOrEqual(PAGE_WIDTH_MM - MARGIN_X_MM + 1e-9);
      expect(placement.yMm + CARD_SIZE_MM).toBeLessThanOrEqual(PAGE_HEIGHT_MM - MARGIN_Y_MM + 1e-9);
      expect(placement.column).toBeLessThan(GRID_COLUMNS);
      expect(placement.row).toBeLessThan(GRID_ROWS);
    }
  });

  it('should lay the first sheet out in reading order', () => {
    // Left to right, top to bottom -- the order the deck is in and the order somebody cutting the
    // sheet expects. A column-major layout would put card 2 under card 1.
    expect(frontPlacement(0)).toMatchObject({ sheet: 0, column: 0, row: 0 });
    expect(frontPlacement(1)).toMatchObject({ sheet: 0, column: 1, row: 0 });
    expect(frontPlacement(GRID_COLUMNS)).toMatchObject({ sheet: 0, column: 0, row: 1 });
    expect(frontPlacement(0).xMm).toBe(MARGIN_X_MM);
    expect(frontPlacement(1).xMm).toBe(MARGIN_X_MM + CARD_SIZE_MM);
  });

  it('should place no two cards on a sheet in the same slot', () => {
    // Cheap, and it catches an off-by-one in either the column or the row arithmetic that the
    // margin test above would let through.
    const slots = new Set<string>();
    for (let cardIndex = 0; cardIndex < CARDS_PER_SHEET; cardIndex++) {
      const { xMm, yMm } = frontPlacement(cardIndex);
      slots.add(`${xMm}|${yMm}`);
    }

    expect(slots.size).toBe(CARDS_PER_SHEET);
  });

  it('should mirror the columns on the back sheet', () => {
    // ===================================================================
    //  THE DUPLEX ASSERTION, AND THE MOST VALUABLE TEST IN THIS PLAN.
    //
    //  Long-edge duplex flips the paper about its VERTICAL centre line, so a
    //  back sheet laid out in reading order pairs every card with the wrong
    //  answer -- and printing is the only way to notice.
    //
    //  Asserted as the reflection IDENTITY rather than as four literal x
    //  positions: `xFront + xBack === PAGE_WIDTH_MM - CARD_SIZE_MM` holds for
    //  every card at any card size, so this test survived the move from a 65 mm
    //  three-column grid to the template's 48.97 mm four-column one without
    //  being touched, while still failing if the mirror is dropped.
    // ===================================================================
    for (let cardIndex = 0; cardIndex < CARDS_PER_SHEET; cardIndex++) {
      const front = frontPlacement(cardIndex);
      const back = backPlacement(cardIndex);

      expect(back.column).toBe(GRID_COLUMNS - 1 - front.column);
      expect(front.xMm + back.xMm).toBeCloseTo(PAGE_WIDTH_MM - CARD_SIZE_MM, 10);
    }

    // An EVEN number of columns has no self-mirroring middle, which the old three-column grid did
    // -- so the case a "reverse the array" implementation gets right by accident is now that every
    // column moves. Column 0 goes to the far side of the page, and nothing stays put.
    expect(backPlacement(0).column).toBe(GRID_COLUMNS - 1);
    for (let column = 0; column < GRID_COLUMNS; column++) {
      expect(backPlacement(column).xMm).not.toBeCloseTo(frontPlacement(column).xMm, 6);
    }
  });

  it('should not mirror the rows', () => {
    // Short-edge binding would mirror the rows instead, and supporting both would mean guessing at
    // a printer setting the app cannot read. The docs name the setting; the code assumes long edge.
    for (let cardIndex = 0; cardIndex < CARDS_PER_SHEET; cardIndex++) {
      expect(backPlacement(cardIndex).yMm).toBe(frontPlacement(cardIndex).yMm);
      expect(backPlacement(cardIndex).row).toBe(frontPlacement(cardIndex).row);
    }
  });

  it('should pair each front position with the matching back position', () => {
    // The pairing property stated from the printer's point of view: for every card, the front and
    // the back land on the SAME sheet, in the same row, and at mirrored horizontal offsets from
    // their respective page edges -- which is what "the same physical square of paper" means.
    for (let cardIndex = 0; cardIndex < CARDS_PER_SHEET * 3 + 5; cardIndex++) {
      const front = frontPlacement(cardIndex);
      const back = backPlacement(cardIndex);

      expect(back.sheet).toBe(front.sheet);
      expect(back.cardIndex).toBe(front.cardIndex);
      expect(back.row).toBe(front.row);

      const frontFromLeft = front.xMm;
      const backFromRight = PAGE_WIDTH_MM - (back.xMm + CARD_SIZE_MM);
      expect(backFromRight).toBeCloseTo(frontFromLeft, 10);
    }
  });

  it('should paginate a deck larger than one sheet', () => {
    expect(sheetCount(0)).toBe(0);
    expect(sheetCount(1)).toBe(1);
    expect(sheetCount(CARDS_PER_SHEET)).toBe(1);
    expect(sheetCount(CARDS_PER_SHEET + 1)).toBe(2);
    // A realistic deck: 40 cards over 16 to a sheet is three sheets, the last one part-full.
    expect(sheetCount(40)).toBe(3);

    // Card 16 is the first card of sheet 1, back in the top-left slot.
    expect(frontPlacement(CARDS_PER_SHEET)).toMatchObject({ sheet: 1, column: 0, row: 0 });
    expect(frontPlacement(CARDS_PER_SHEET).xMm).toBe(frontPlacement(0).xMm);
    expect(frontPlacement(CARDS_PER_SHEET).yMm).toBe(frontPlacement(0).yMm);
  });

  it('should interleave front and back pages so a duplex printer needs no reloading', () => {
    // Page 2 must be the reverse of page 1. All the fronts followed by all the backs would need the
    // player to put the stack back in the tray by hand, in the right order, upside down.
    const pages = planSheets(CARDS_PER_SHEET + 3);

    expect(pages.map((page) => `${page.sheet}${page.side[0]}`)).toEqual(['0f', '0b', '1f', '1b']);
    // The part-full sheet carries only its own cards -- three, not sixteen.
    expect(pages[2]?.placements).toHaveLength(3);
    expect(pages[3]?.placements).toHaveLength(3);
    expect(pages[0]?.placements).toHaveLength(CARDS_PER_SHEET);
    // And every page's placements are the cards of that sheet, in deck order.
    expect(pages[2]?.placements.map((placement) => placement.cardIndex)).toEqual([16, 17, 18]);
  });

  it('should plan nothing for an empty deck', () => {
    expect(planSheets(0)).toEqual([]);
  });

  it('should inset the QR inside its card on both sides', () => {
    // The inset is the paper's quiet zone: it keeps a scannable margin around the code even if the
    // cut wanders a millimetre or two.
    const front = qrBox(frontPlacement(0));
    expect(front.xMm).toBe(MARGIN_X_MM + CARD_PADDING_MM);
    expect(front.sizeMm).toBe(CARD_SIZE_MM - CARD_PADDING_MM * 2);
    expect(front.sizeMm).toBeGreaterThan(0);

    // And it follows the mirror, because it is derived from the placement rather than recomputed.
    const back = qrBox(backPlacement(0));
    expect(back.xMm).toBe(backPlacement(0).xMm + CARD_PADDING_MM);
  });

  it('should keep the QR a scannable size on the smaller card', () => {
    // The card lost a quarter of its width to the template, and the inset was scaled with it so
    // the code did not lose a third. A Spotify track URL is a 33-module version-4 symbol at `M`;
    // with the one margin module `qrcode` adds, 35 modules have to fit the box.
    const symbol = qrBox(frontPlacement(0)).sizeMm;

    expect(symbol).toBeCloseTo(39.9312, MM);

    // The two quiet zones are ADDITIVE and the spec asks for four modules: one is inside the
    // bitmap (`qrcode` is called with `margin: 1`), the rest is paper. 1.14 mm a module, so the
    // 4.52 mm inset is a further 3.96 -- 4.96 in total, on every side.
    const moduleMm = symbol / 35;
    expect(moduleMm).toBeGreaterThan(1);
    expect((moduleMm + CARD_PADDING_MM) / moduleMm).toBeGreaterThan(4);
  });

  describe('backLayout', () => {
    it('should centre the year exactly where the year-cards template centres its own', () => {
      // The template draws `/F2 28 Tf` -- Helvetica-Bold at 28 pt -- with its baseline 10 pt below
      // the card's vertical centre (card 559.7638..698.5827, baseline 619.1732). A deck card and a
      // year card sit side by side on the same timeline, so the digits have to land in the same
      // place at the same size or the two read as two different games.
      const placement = frontPlacement(0);
      const layout = backLayout(placement);

      expect(layout.yearPointSize).toBe(28);
      expect(layout.centreXMm).toBeCloseTo(placement.xMm + CARD_SIZE_MM / 2, 10);
      expect(layout.yearBaselineMm - (placement.yMm + CARD_SIZE_MM / 2)).toBeCloseTo(
        pointsToMm(10),
        10,
      );
    });

    it('should keep the worst case inside the card', () => {
      // ===================================================================
      //  THE TEST THE 65 mm OFFSETS NEVER HAD, AND THE ONE THAT WOULD HAVE
      //  CAUGHT THE SHRINK (2026-09-21).
      //
      //  `drawBack` used to place the artist at `yMm + 40 + lines * 5 + 2`,
      //  which on a 48.97 mm card is 52-57 mm -- past the bottom edge, onto the
      //  next card down the sheet, with every check green. Printing was the
      //  only way to find out.
      //
      //  Asserted against the INK rather than against the baselines: a baseline
      //  is a position, so "the last baseline is inside the card" would still
      //  pass with the descenders hanging over the cut.
      // ===================================================================
      const placement = frontPlacement(0);
      const layout = backLayout(placement);
      const cardBottom = placement.yMm + CARD_SIZE_MM;

      const lastTitleBaseline =
        layout.titleBaselineMm + (MAX_TITLE_LINES - 1) * layout.titleLineHeightMm;
      const artistBaseline = lastTitleBaseline + layout.artistGapMm;
      const lastArtistBaseline =
        artistBaseline + (MAX_ARTIST_LINES - 1) * layout.artistLineHeightMm;
      const lastArtistInk =
        lastArtistBaseline + HELVETICA_DESCENDER_RATIO * pointsToMm(layout.artistPointSize);

      expect(lastArtistInk).toBeLessThan(cardBottom);
      // And with room for the scissors, not merely inside by a hair.
      expect(cardBottom - lastArtistInk).toBeGreaterThan(2);

      // The year's cap height has to clear the top of the card by the same kind of margin.
      const yearInkTop =
        layout.yearBaselineMm - HELVETICA_CAP_HEIGHT_RATIO * pointsToMm(layout.yearPointSize);
      expect(yearInkTop - placement.yMm).toBeGreaterThan(2);
    });

    it('should keep the artist clear of the title in the worst case', () => {
      // The collision the "inside the card" assertion above cannot see: the artist's CAP height
      // against the last title line's DESCENDER. They are 0.7 mm apart, which is the whole reason
      // the two gaps are 1.7 and 0.9 line heights rather than round numbers.
      const layout = backLayout(frontPlacement(0));

      const lastTitleInk =
        layout.titleBaselineMm +
        (MAX_TITLE_LINES - 1) * layout.titleLineHeightMm +
        HELVETICA_DESCENDER_RATIO * pointsToMm(layout.titlePointSize);
      const artistInkTop =
        layout.titleBaselineMm +
        (MAX_TITLE_LINES - 1) * layout.titleLineHeightMm +
        layout.artistGapMm -
        HELVETICA_CAP_HEIGHT_RATIO * pointsToMm(layout.artistPointSize);

      expect(artistInkTop).toBeGreaterThan(lastTitleInk);

      // And the title itself clears the year's baseline.
      const titleInkTop =
        layout.titleBaselineMm - HELVETICA_CAP_HEIGHT_RATIO * pointsToMm(layout.titlePointSize);
      expect(titleInkTop).toBeGreaterThan(layout.yearBaselineMm);
    });

    it('should inset the text block inside the card and scale its type with the card', () => {
      const layout = backLayout(frontPlacement(0));

      expect(layout.textWidthMm).toBeLessThan(CARD_SIZE_MM);
      expect(layout.textWidthMm).toBeCloseTo(39.9312, MM);
      // Scaled from the 65 mm card's 11 pt and 9 pt, so the proportions that were already looked
      // at survive the shrink instead of being re-chosen by eye.
      expect(layout.titlePointSize).toBeCloseTo((11 * CARD_SIZE_MM) / 65, 10);
      expect(layout.artistPointSize).toBeCloseTo((9 * CARD_SIZE_MM) / 65, 10);
      expect(layout.artistPointSize).toBeLessThan(layout.titlePointSize);
      expect(layout.titlePointSize).toBeLessThan(layout.yearPointSize);
    });

    it('should follow the placement rather than recompute the grid', () => {
      // The back's layout is relative to whichever slot the card landed in, including the mirrored
      // one -- so a change to the mirror cannot leave the type behind on the front's coordinates.
      const back = backPlacement(5);
      const layout = backLayout(back);

      expect(layout.centreXMm).toBeCloseTo(back.xMm + CARD_SIZE_MM / 2, 10);
      expect(layout.yearBaselineMm).toBeGreaterThan(back.yMm);
      expect(layout.yearBaselineMm).toBeLessThan(back.yMm + CARD_SIZE_MM);
    });
  });

  it('should exclude cards whose year is still pending and report the count', () => {
    // ===================================================================
    //  A COUNT, NEVER A LIST (step 20). "3 cards had no year yet" is
    //  leak-free; naming them is the spoiler the app exists to avoid, on the
    //  one screen that is a press away from re-dealing the same deck.
    //
    //  `undefined` is the case that actually happens -- the resolver had not
    //  reached that card when the player pressed export. `null` cannot reach a
    //  live deck since the 2026-08-05 reversal, and is excluded anyway: a
    //  printed card with no year cannot be placed on a timeline.
    // ===================================================================
    const deck = [
      { year: 1975 },
      { year: undefined },
      { year: null },
      { year: 1999 },
      {}, // no `year` key at all, which is what `JSON.parse` of a save produces
    ];

    const { cards, excludedCount } = selectPrintableCards(deck);

    expect(cards).toEqual([{ year: 1975 }, { year: 1999 }]);
    expect(excludedCount).toBe(3);
  });

  it('should keep deck order among the printable cards', () => {
    // The printed sheet is in deck order, so cutting it produces a stack in the order played.
    const deck = [{ year: 2001 }, { year: undefined }, { year: 1969 }, { year: 1984 }];

    expect(selectPrintableCards(deck).cards.map((card) => card.year)).toEqual([2001, 1969, 1984]);
  });

  it('should report nothing excluded for a fully resolved deck', () => {
    const deck = [{ year: 1975 }, { year: 1976 }];

    expect(selectPrintableCards(deck)).toEqual({ cards: deck, excludedCount: 0 });
  });
});
