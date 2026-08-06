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
  MARGIN_X_MM,
  MARGIN_Y_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  backPlacement,
  frontPlacement,
  planSheets,
  qrBox,
  selectPrintableCards,
  sheetCount,
} from './pdf-sheet';

describe('pdf-sheet', () => {
  it('should place every card on the grid within the page margins', () => {
    // A full sheet, every card checked against the paper rather than against a remembered number:
    // a card whose right edge runs past `PAGE_WIDTH_MM` is a card the printer clips.
    for (let cardIndex = 0; cardIndex < CARDS_PER_SHEET; cardIndex++) {
      const placement = frontPlacement(cardIndex);

      expect(placement.xMm).toBeGreaterThanOrEqual(MARGIN_X_MM);
      expect(placement.yMm).toBeGreaterThanOrEqual(MARGIN_Y_MM);
      expect(placement.xMm + CARD_SIZE_MM).toBeLessThanOrEqual(PAGE_WIDTH_MM - MARGIN_X_MM);
      expect(placement.yMm + CARD_SIZE_MM).toBeLessThanOrEqual(PAGE_HEIGHT_MM - MARGIN_Y_MM);
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
    //  Asserted as the reflection IDENTITY rather than as three literal x
    //  positions: `xFront + xBack === PAGE_WIDTH_MM - CARD_SIZE_MM` holds for
    //  every card at any card size, so this test survives a change of card
    //  size while still failing if the mirror is dropped.
    // ===================================================================
    for (let cardIndex = 0; cardIndex < CARDS_PER_SHEET; cardIndex++) {
      const front = frontPlacement(cardIndex);
      const back = backPlacement(cardIndex);

      expect(back.column).toBe(GRID_COLUMNS - 1 - front.column);
      expect(front.xMm + back.xMm).toBe(PAGE_WIDTH_MM - CARD_SIZE_MM);
    }

    // And the middle column of an odd-width grid is its own mirror, which is the case a
    // "reverse the array" implementation gets right by accident and a wrong subtraction does not.
    expect(backPlacement(1).xMm).toBe(frontPlacement(1).xMm);
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
      expect(backFromRight).toBe(frontFromLeft);
    }
  });

  it('should paginate a deck larger than one sheet', () => {
    expect(sheetCount(0)).toBe(0);
    expect(sheetCount(1)).toBe(1);
    expect(sheetCount(CARDS_PER_SHEET)).toBe(1);
    expect(sheetCount(CARDS_PER_SHEET + 1)).toBe(2);
    // A realistic deck: 40 cards over 12 to a sheet is four sheets, the last one part-full.
    expect(sheetCount(40)).toBe(4);

    // Card 12 is the first card of sheet 1, back in the top-left slot.
    expect(frontPlacement(CARDS_PER_SHEET)).toMatchObject({ sheet: 1, column: 0, row: 0 });
    expect(frontPlacement(CARDS_PER_SHEET).xMm).toBe(frontPlacement(0).xMm);
    expect(frontPlacement(CARDS_PER_SHEET).yMm).toBe(frontPlacement(0).yMm);
  });

  it('should interleave front and back pages so a duplex printer needs no reloading', () => {
    // Page 2 must be the reverse of page 1. All the fronts followed by all the backs would need the
    // player to put the stack back in the tray by hand, in the right order, upside down.
    const pages = planSheets(CARDS_PER_SHEET + 3);

    expect(pages.map((page) => `${page.sheet}${page.side[0]}`)).toEqual(['0f', '0b', '1f', '1b']);
    // The part-full sheet carries only its own cards -- three, not twelve.
    expect(pages[2]?.placements).toHaveLength(3);
    expect(pages[3]?.placements).toHaveLength(3);
    expect(pages[0]?.placements).toHaveLength(CARDS_PER_SHEET);
    // And every page's placements are the cards of that sheet, in deck order.
    expect(pages[2]?.placements.map((placement) => placement.cardIndex)).toEqual([12, 13, 14]);
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
