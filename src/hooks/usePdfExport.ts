/**
 * The PDF export's binding half: load the library, generate a QR per card, draw, download.
 *
 * ===========================================================================
 *  EVERY MILLIMETRE IS IN `src/game/pdf-sheet.ts` AND EVERY STRING RULE IS IN
 *  `src/game/pdf-text.ts`. This file decides nothing about the page.
 *
 *  The house split, for the third time (gestures, the resolver, now this). What
 *  is left here is exactly what cannot be unit-tested offline: a dynamic
 *  `import()`, canvas-backed QR generation, a jsPDF document, and a browser
 *  download. Anything that starts to look like a rule belongs in one of those two
 *  modules instead.
 * ===========================================================================
 *
 * ## Both heavy modules are lazy, and the second one shares Phase 7's chunk
 *
 * `jspdf` is imported dynamically here so it is absent from the landing screen -- the same
 * reasoning as `motion` behind `React.lazy` and `qrcode` behind its own `import()`. `qrcode` comes
 * through `src/game/qrcode-loader.ts`, which is the SAME memoized promise `QrCode.tsx` uses, so an
 * export in a session that has already shown a card loads no new QR chunk at all (step 18).
 *
 * ## Progress is reported because a hundred codes is real work
 *
 * Each `toDataURL` is awaited in turn, which yields to the event loop between cards -- so the tab
 * stays responsive and the count can climb visibly. A frozen tab reads as a crash, and a 100-card
 * deck is the normal size of a truncated playlist.
 *
 * ## The printed palette is LIGHT, and that is not a style preference (decision 6)
 *
 * A near-black card with a neon ring is ink-expensive, and more importantly **a QR scans as dark
 * modules on a light field with a quiet zone** -- inverting or tinting it is how a printed deck
 * fails at the one job the QR has. So this file uses its own three greys and nothing from the
 * screen's `@theme` block. `pdf-sheet.ts` explains why the geometry is not in CSS either.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CARD_SIZE_MM,
  MAX_ARTIST_LINES,
  MAX_TITLE_LINES,
  backLayout,
  planSheets,
  qrBox,
  selectPrintableCards,
  sheetCount,
} from '../game/pdf-sheet';
import { pdfFileName, sanitizeForPdf } from '../game/pdf-text';
import { loadQrcode } from '../game/qrcode-loader';
import { spotifyTrackUrl } from '../../shared/spotify-url';
import type { CardPlacement } from '../game/pdf-sheet';
import type { Card } from '../../shared/types';

/**
 * Where an export is.
 *
 * - `idle`: nothing asked for yet, or the last one is over and acknowledged.
 * - `working`: generating codes and assembling the document. `completed`/`total` climb.
 * - `done`: the download was handed to the browser. `excludedCount` is worth showing.
 * - `nothing-to-print`: no card had a year yet. Its own status because it is not a failure and the
 *   answer for the player is "wait a moment and try again", not "something broke".
 * - `failed`: the chunk did not load, or jsPDF threw. Nothing was downloaded.
 */
export type PdfExportStatus = 'idle' | 'working' | 'done' | 'nothing-to-print' | 'failed';

export interface PdfExportState {
  status: PdfExportStatus;
  /** QR codes generated so far. Only meaningful while `working`. */
  completed: number;
  /** Cards that will be printed. Zero until the selection has been made. */
  total: number;
  /** Cards left out because their year had not arrived. A COUNT, never a list -- see `pdf-sheet`. */
  excludedCount: number;
}

export interface UsePdfExportResult {
  state: PdfExportState;
  /** Generate and download. Safe to call again after it settles; a no-op while `working`. */
  exportDeck: (deck: readonly Card[], playlistName: string) => void;
}

const IDLE: PdfExportState = { status: 'idle', completed: 0, total: 0, excludedCount: 0 };

/** The print palette. Three greys, and the QR's field stays paper-white. See the header block. */
const INK = { text: 20, muted: 110, rule: 170 } as const;

/**
 * The QR bitmap's edge in pixels.
 *
 * Printed at 39.93 mm, 512 px is about 326 dpi -- comfortably scannable, and small enough that a
 * 100-card document stays a few megabytes. The number of MODULES is what governs scannability, and
 * that comes from the URL's length and the `M` error-correction level, not from this.
 */
const QR_PIXELS = 512;

export function usePdfExport(): UsePdfExportResult {
  const [state, setState] = useState<PdfExportState>(IDLE);

  /**
   * Which export the running async work belongs to, and whether the hook is still mounted.
   *
   * The same pair of guards `QrCode` and `usePlaylist` use, for the same reason: this work is a
   * chain of awaits, and a `setState` after unmount is a render on a dead tree. The counter also
   * drops a superseded export rather than letting an older one report over a newer one.
   */
  const generationRef = useRef(0);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      // Bumped on unmount as well, so anything still in flight stops reporting.
      generationRef.current += 1;
    };
  }, []);

  const exportDeck = useCallback((deck: readonly Card[], playlistName: string) => {
    const generation = ++generationRef.current;
    const publish = (next: PdfExportState) => {
      if (!isMountedRef.current || generationRef.current !== generation) return;
      setState(next);
    };

    const { cards, excludedCount } = selectPrintableCards(deck);

    if (cards.length === 0) {
      publish({ status: 'nothing-to-print', completed: 0, total: 0, excludedCount });
      return;
    }

    publish({ status: 'working', completed: 0, total: cards.length, excludedCount });

    void (async () => {
      try {
        /*
          Both loads started together, then awaited: they are independent, and a QR chunk that is
          already warm from the game screen means this is effectively one request for jsPDF.

          A NAMED import of `jsPDF`, not a default one -- `verbatimModuleSyntax` is on with no
          `esModuleInterop`, which is the same constraint that made `qrcode`'s import named.
        */
        const [{ jsPDF }, { toDataURL }] = await Promise.all([import('jspdf'), loadQrcode()]);

        const codes: string[] = [];
        for (const card of cards) {
          const dataUrl = await toDataURL(spotifyTrackUrl(card.id), {
            // `margin` is in MODULES, not pixels. One module is a valid quiet zone; the paper
            // margin around it is `CARD_PADDING_MM` in `pdf-sheet.ts`, and the two are additive.
            margin: 1,
            width: QR_PIXELS,
            errorCorrectionLevel: 'M',
          });
          codes.push(dataUrl);

          publish({
            status: 'working',
            completed: codes.length,
            total: cards.length,
            excludedCount,
          });

          // The loop is already yielding on every `await`, so the count above actually paints. That
          // is the whole reason generation is sequential rather than a `Promise.all` over 100 cards:
          // a parallel burst would finish sooner and show nothing until it did.
          if (generationRef.current !== generation) return;
        }

        const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        // A standard font, hence `pdf-text.ts`: WinAnsi cannot draw Cyrillic or CJK, and embedding a
        // font that could costs more than the whole rest of this chunk.
        doc.setFont('helvetica', 'normal');

        const pages = planSheets(cards.length);
        pages.forEach((page, pageIndex) => {
          if (pageIndex > 0) doc.addPage();

          for (const placement of page.placements) {
            drawCutOutline(doc, placement);

            if (page.side === 'front') drawFront(doc, placement, codes[placement.cardIndex] ?? '');
            else drawBack(doc, placement, cards[placement.cardIndex]);
          }
        });

        doc.save(pdfFileName(playlistName));

        publish({
          status: 'done',
          completed: cards.length,
          total: cards.length,
          excludedCount,
        });
      } catch (error) {
        // A failed chunk fetch and a jsPDF throw land in the same place, and neither has anything
        // useful to say to the player: nothing was downloaded, and pressing the button again is the
        // whole remedy. The detail goes to the console, which is not a rendered surface.
        console.error('[pdf] export failed:', error);
        publish({ status: 'failed', completed: 0, total: 0, excludedCount });
      }
    })();
  }, []);

  return { state, exportDeck };
}

/**
 * The document the draw helpers below take.
 *
 * `import('jspdf')` in TYPE position, which erases completely -- so naming jsPDF's own instance type
 * costs no static import and keeps the library out of the landing screen's chunk. A hand-written
 * structural type was tried first and rejected: jsPDF's real signatures are wider than the six calls
 * used here (`setTextColor` alone has four overloads), so the structural version failed to accept an
 * actual `jsPDF` instance -- a type that describes the caller rather than the library.
 */
type Doc = import('jspdf').jsPDF;

/**
 * The cut line: a hairline rectangle around every card, on both sides.
 *
 * Drawn on the back as well as the front, and that is deliberate -- a sheet cut from the front
 * leaves the back's lines to check the duplex alignment against. If the two do not line up when the
 * paper is held to a light, the printer used short-edge binding.
 */
function drawCutOutline(doc: Doc, placement: CardPlacement): void {
  doc.setDrawColor(INK.rule);
  doc.setLineWidth(0.1);
  doc.rect(placement.xMm, placement.yMm, CARD_SIZE_MM, CARD_SIZE_MM);
}

/** The QR side. Nothing else on it: a printed card must be as unrevealing as the on-screen one. */
function drawFront(doc: Doc, placement: CardPlacement, dataUrl: string): void {
  if (dataUrl === '') return;

  const box = qrBox(placement);
  doc.addImage(dataUrl, 'PNG', box.xMm, box.yMm, box.sizeMm, box.sizeMm);
}

/**
 * The answer side: the year large, then the title and the artist.
 *
 * ===========================================================================
 *  NOT ONE MILLIMETRE IS DECIDED HERE, AND UNTIL 2026-09-21 SIX OF THEM WERE.
 *
 *  This function used to carry `placement.yMm + 28`, `+ 40`, `CARD_SIZE_MM - 12`,
 *  `title.length * 5 + 2` and a `TYPE` table of 34/11/9 pt -- all tuned against a
 *  65 mm card and all written as ABSOLUTE offsets. When the card shrank to the
 *  year-cards template's 48.97 mm, the artist's baseline landed past the bottom
 *  edge and onto the card below. The header of this file already claimed every
 *  millimetre lived in `pdf-sheet.ts`; `backLayout` is what made that true, and
 *  it is where the worst-case fit is tested.
 * ===========================================================================
 *
 * The year is drawn in Helvetica-BOLD at the template's own 28 pt, centred on the card exactly as
 * the template centres its own -- see `YEAR_POINT_SIZE`. The font is put back to `normal` for the
 * title and the artist, because jsPDF's font state is per document and not per call.
 */
function drawBack(doc: Doc, placement: CardPlacement, card: Card | undefined): void {
  if (!card || typeof card.year !== 'number') return;

  const layout = backLayout(placement);

  doc.setTextColor(INK.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(layout.yearPointSize);
  doc.text(String(card.year), layout.centreXMm, layout.yearBaselineMm, { align: 'center' });
  doc.setFont('helvetica', 'normal');

  doc.setFontSize(layout.titlePointSize);
  // `splitTextToSize` wraps to the card's width. A long title is a real case -- "(feat. …)" and
  // "- Remastered 2011" both survive into `Card.title` -- and unwrapped text would run onto the
  // next card.
  const title = doc
    .splitTextToSize(sanitizeForPdf(card.title), layout.textWidthMm)
    .slice(0, MAX_TITLE_LINES);
  doc.text(title, layout.centreXMm, layout.titleBaselineMm, { align: 'center' });

  doc.setFontSize(layout.artistPointSize);
  doc.setTextColor(INK.muted);
  /*
    The artist string is drawn VERBATIM apart from the encoding fix. `shared/artists.ts` documents
    why splitting it is forbidden for display: the separators Spotify joins with also occur inside
    real artist names, so "Earth, Wind & Fire" would become three artists.
  */
  const artist = doc
    .splitTextToSize(sanitizeForPdf(card.artist), layout.textWidthMm)
    .slice(0, MAX_ARTIST_LINES);
  const artistBaseline =
    layout.titleBaselineMm + (title.length - 1) * layout.titleLineHeightMm + layout.artistGapMm;
  doc.text(artist, layout.centreXMm, artistBaseline, { align: 'center' });
}

/**
 * How many sheets of paper a deck needs.
 *
 * The end screen says this BEFORE the export runs, because 100 cards is seven sheets printed
 * double-sided and that is a thing to know before pressing a button. Composed from the two pure
 * functions rather than reimplemented.
 */
export function sheetsForDeck(deck: readonly Card[]): number {
  return sheetCount(selectPrintableCards(deck).cards.length);
}
