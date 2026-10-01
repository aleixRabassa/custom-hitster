/**
 * @vitest-environment jsdom
 *
 * The deck actions, tested on their own rather than through either screen that mounts them.
 *
 * Most of these moved here verbatim from `EndScreen.test.tsx` when the component was extracted on
 * 2026-08-06 so the GAME screen could offer the same three actions. That move is what makes the
 * leak test below load-bearing rather than belt-and-braces: on the end screen a leaked title would
 * only spoil a rematch, but this component now mounts beside an UNFLIPPED card, where a title, an
 * artist or a year in the DOM is the answer to the card the player is looking at.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeckActions } from './DeckActions';
import { auditableText } from './__fixtures__/auditable-text';
import {
  fixtureDeck,
  highConfidenceCard,
  lowConfidenceCard,
  noYearCard,
} from './__fixtures__/cards';
import { COPY } from '../game/copy';
import { CATALOGUES } from '../game/i18n';
import { pdfFileName, sanitizeForPdf } from '../game/pdf-text';
import { LOCALES } from '../game/locale';
import { LocaleContext } from '../hooks/useLocale';
import { sheetsForDeck } from '../hooks/usePdfExport';
import type { DeckActionsProps, DeckActionsView } from './DeckActions';

/**
 * Both halves of the export are doubled, and neither is doubled for speed.
 *
 * `qrcode`'s browser build draws through `<canvas>`, which jsdom does not implement, and jsPDF
 * assembles a real document and hands it to a download jsdom has nowhere to put. Between them, an
 * un-doubled export fails for reasons that have nothing to do with this component -- which is why
 * every test here before 2026-08-07 stopped at `nothing-to-print`, the one outcome reached before
 * either import. "Print so far" made a FINISHED export something the player can see mid-wait, so
 * the happy path had to become assertable.
 *
 * `vi.mock` intercepts by specifier rather than by import form, so the same doubles serve the
 * dynamic `import()`s in `usePdfExport` -- the finding `QrCode.test.tsx` records.
 */
const { toDataURLMock, saveMock, textMock } = vi.hoisted(() => ({
  // `vi.hoisted` is required: the factories below are hoisted above ordinary `const` declarations.
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
  saveMock: vi.fn<(fileName: string) => void>(),
  // Every string `drawBack` puts on a card's answer side, which is how the blank year is observed.
  textMock: vi.fn<(text: string | string[], x: number, y: number, options?: unknown) => void>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

vi.mock('jspdf', () => {
  /** Every call `usePdfExport` makes, with only the two that RETURN anything doing any work. */
  class FakeDoc {
    setFont() {}
    setDrawColor() {}
    setLineWidth() {}
    setTextColor() {}
    setFontSize() {}
    rect() {}
    addImage() {}
    addPage() {}

    text(text: string | string[], x: number, y: number, options?: unknown): void {
      textMock(text, x, y, options);
    }

    // The real one wraps to the card's width. One line per string is enough for a test that never
    // measures the page -- `pdf-sheet.ts` owns the geometry and has its own tests.
    splitTextToSize(text: string): string[] {
      return [text];
    }

    save(fileName: string): void {
      saveMock(fileName);
    }
  }

  return { jsPDF: FakeDoc };
});

const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';
const SECOND_PLAYLIST_ID = '2zmXlpkOMN92NlQaE2M62c';
const SEED = 'a1b2c3d4e5f60718';
const ORIGIN = 'https://jitster.example/';
/** A real fixture card's id, standing in for the card the player is on mid-game. */
const CURRENT_CARD_ID = fixtureDeck[2]?.id ?? '';

/**
 * The query of a copied link, as parameters rather than as one string.
 *
 * ORDER-FREE ON PURPOSE (2026-09-29). The link grew, mid-game, a card, and
 * which order `buildDeckLink` writes them in is `deck-link.ts`'s decision -- its own tests pin the
 * exact string. What THIS component owns is which values go in, so that is what these assert.
 */
function linkParams(link: string | undefined): URLSearchParams {
  return new URL(link ?? 'about:blank').searchParams;
}

function renderActions(overrides: Partial<DeckActionsProps> = {}) {
  const props: DeckActionsProps = {
    playlistIds: [PLAYLIST_ID],
    playlistName: 'Rock Classics',
    seed: SEED,
    shareOrigin: ORIGIN,
    onSavePlaylist: vi.fn(),
    isPlaylistSaved: false,
    // A resolved deck, so the export has something to print. The fixture deck's yearless cards are
    // what the exclusion count is about, and one test uses them deliberately.
    deck: fixtureDeck.filter((card) => typeof card.year === 'number'),
    // A finished crawl, which is the state the export's own tests want. The gate has its own block.
    pendingYearCount: 0,
    // The option off, which is the default a fresh profile deals with. Its own block turns it on.
    keepYearless: false,
    skipUnconfirmed: false,
    ...overrides,
  };

  return { ...render(<DeckActions {...props} />), props };
}

/**
 * Print a resolved deck: the actions view's Print OPENS the print view (2026-10-01), and the print
 * view's own Print -- the same label -- is the press that exports.
 */
function printDeck(label: string = COPY.deckActions.print): void {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: label }));
}

/**
 * Replace `navigator.clipboard`.
 *
 * `vi.stubGlobal('navigator', …)` would replace the whole object jsdom's DOM depends on, so the
 * property is redefined instead -- and it is `configurable` so `afterEach` can put it back. jsdom
 * does supply a `clipboard` object, but its `writeText` is unimplemented, which is exactly the
 * failure path one of these tests wants and the last thing the others do.
 */
function stubClipboard(writeText: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText === undefined ? undefined : { writeText },
    configurable: true,
    writable: true,
  });
}

describe('DeckActions', () => {
  beforeEach(() => {
    // Re-applied per test rather than set in the factory above, which runs once: `restoreAllMocks`
    // below would otherwise leave `toDataURL` returning `undefined` for every test but the first.
    toDataURLMock.mockReset();
    toDataURLMock.mockImplementation((text) =>
      Promise.resolve(`data:image/png;base64,QR(${text})`),
    );
    saveMock.mockReset();
    textMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    // Leaves jsdom's own `navigator.clipboard` shape behind rather than a stub from the last test.
    stubClipboard(undefined);
    vi.restoreAllMocks();
  });

  it('should offer copy, save and export', () => {
    // The three things a deck can become, asserted together: this is the check that fails if one of
    // them is dropped in a later edit.
    renderActions();

    expect(screen.queryByRole('button', { name: COPY.deckActions.copyLink })).not.toBeNull();
    expect(screen.queryByRole('button', { name: COPY.deckActions.save })).not.toBeNull();
    expect(screen.queryByRole('button', { name: COPY.deckActions.print })).not.toBeNull();
  });

  it('should give every action a focus-visible style', () => {
    // Class-name level, with the caveat given in full in `LandingScreen.test.tsx`. The count is
    // asserted as well, so a button added without a ring fails here.
    renderActions();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.className).toContain('focus-visible:focus-ring');
    }
  });

  it('should render no title, artist or year even with the copy fallback holding a mid-game link', async () => {
    // ===================================================================
    //  THE ONE CARD-DERIVED VALUE THIS COMPONENT CAN PUT IN THE DOM.
    //
    //  Since 2026-09-29 a mid-game link carries the current card's TRACK
    //  ID, and when the clipboard fails the link is rendered into an
    //  input's `value`. That id is SUBTRACTED below by exact string, and
    //  the subtraction is the decision, documented: the QR on the card the
    //  player is looking at already encodes that same id, so it is not new
    //  information on the screen, and it is not a title, an artist or a
    //  year. The proxy stays absolute for everything else.
    // ===================================================================
    stubClipboard(undefined);
    const { container } = renderActions({ deck: fixtureDeck, currentCardId: CURRENT_CARD_ID });

    fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));
    const field = (await screen.findByLabelText(
      COPY.deckActions.shareLinkFieldLabel,
    )) as HTMLInputElement;
    expect(field.value).toContain(CURRENT_CARD_ID);

    const text = auditableText(container).replaceAll(CURRENT_CARD_ID, '');
    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
      if (typeof card.year === 'number') expect(text).not.toContain(String(card.year));
    }
  });

  it('should render no track data even though it holds the deck', () => {
    // ===================================================================
    //  THE ASSERTION THE GAME SCREEN'S USE OF THIS COMPONENT RESTS ON.
    //
    //  It takes the whole deck, for the PDF, and mounts beside an unflipped
    //  card. Holding cards is fine; RENDERING one is the leak. Attributes
    //  are checked as well as text, because an `aria-label` or a `title`
    //  built from the current card is the plausible way this would break.
    // ===================================================================
    const { container } = renderActions({ deck: fixtureDeck });
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
    }

    for (const element of Array.from(container.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        for (const card of fixtureDeck) {
          expect(attribute.value).not.toContain(card.title);
          expect(attribute.value).not.toContain(card.artist);
        }
      }
    }
  });

  describe('the share link', () => {
    it('should offer a copy control and confirm the copy', async () => {
      // Typed, so `mock.calls[0]?.[0]` is the string this asserts on rather than `never`.
      const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
      stubClipboard(writeText);
      renderActions();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const link = writeText.mock.calls[0]?.[0];
      expect(link?.startsWith('https://jitster.example?')).toBe(true);
      expect(linkParams(link).get('playlist')).toBe(PLAYLIST_ID);
      expect(linkParams(link).get('seed')).toBe(SEED);
      expect(linkParams(link).has('v')).toBe(false);
      // Confirmed in a live region, which is safe even beside an unflipped card: the region's text
      // is a fixed sentence, whatever the link holds.
      await waitFor(() => {
        expect(screen.getByRole('status').textContent).toBe(COPY.deckActions.linkCopied);
      });
    });

    it('should copy a link holding every playlist id', async () => {
      /*
        A link that named only the first playlist would deal the recipient a deck the sender never
        played -- and it would do it silently, since a one-playlist deck is perfectly valid. The
        ids are joined with a literal comma, which needs no escaping in a query value and is the
        form `parseDeckLink` reads back.

        Built at CLICK time, from the props as they are then, exactly as the single-id link is.
      */
      const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
      stubClipboard(writeText);
      renderActions({ playlistIds: [PLAYLIST_ID, SECOND_PLAYLIST_ID] });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));

      expect(linkParams(writeText.mock.calls[0]?.[0]).get('playlist')).toBe(
        `${PLAYLIST_ID},${SECOND_PLAYLIST_ID}`,
      );
      expect(linkParams(writeText.mock.calls[0]?.[0]).get('seed')).toBe(SEED);
      expect(linkParams(writeText.mock.calls[0]?.[0]).has('v')).toBe(false);
      await waitFor(() => {
        expect(screen.getByRole('status').textContent).toBe(COPY.deckActions.linkCopied);
      });
    });

    it('should say playlists rather than playlist for a combined deck', () => {
      // The caption is the sentence that has to be read and believed, so it agrees with the deck it
      // describes. "Same playlist" over a three-playlist deck reads as a link to one of them.
      renderActions({ playlistIds: [PLAYLIST_ID, SECOND_PLAYLIST_ID] });

      expect(document.body.textContent ?? '').toContain(COPY.deckActions.shareCaption(2, false));
    });

    it('should carry the current card mid-game and no card without one', () => {
      // D3: a mid-game link starts the recipient on the sender's card. The end screen passes no
      // card, because after the last card a position would drop the recipient on the final card.
      const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
      stubClipboard(writeText);
      const { rerender, props } = renderActions({ currentCardId: CURRENT_CARD_ID });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));
      expect(linkParams(writeText.mock.calls[0]?.[0]).get('card')).toBe(CURRENT_CARD_ID);
      expect(linkParams(writeText.mock.calls[0]?.[0]).has('v')).toBe(false);

      // Built at click time, so the card is the one on screen AT THE PRESS -- a later card
      // re-renders this with a new id, exactly as a Play again re-renders it with a new seed.
      const nextCardId = fixtureDeck[3]?.id ?? '';
      rerender(<DeckActions {...props} currentCardId={nextCardId} />);
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));
      expect(linkParams(writeText.mock.calls[1]?.[0]).get('card')).toBe(nextCardId);

      cleanup();
      writeText.mockClear();
      renderActions();
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));
      expect(linkParams(writeText.mock.calls[0]?.[0]).get('card')).toBeNull();
    });

    it('should say when the link starts from the current card, and only then', () => {
      // The caption is the sentence that has to be believed, so it agrees with what the link does.
      renderActions({ currentCardId: CURRENT_CARD_ID });
      expect(document.body.textContent ?? '').toContain(COPY.deckActions.shareCaption(1, true));

      cleanup();
      renderActions();
      expect(document.body.textContent ?? '').toContain(COPY.deckActions.shareCaption(1, false));
    });

    it('should word the two captions differently in every language', () => {
      // `satisfies Copy` cannot catch a translation that ignores the second parameter -- a
      // one-parameter function is assignable to a two-parameter type -- so this does, per catalogue.
      for (const locale of LOCALES) {
        const { shareCaption } = CATALOGUES[locale].copy.deckActions;
        expect(shareCaption(1, true)).not.toBe(shareCaption(1, false));
        expect(shareCaption(2, true)).not.toBe(shareCaption(2, false));
        expect(shareCaption(1, false)).not.toBe(shareCaption(2, false));
      }
    });

    it('should build the share link from the current seed', () => {
      // ===================================================================
      //  THE RESTART-CHANGES-THE-SEED TRAP (step 11).
      //
      //  The link is (playlist id + seed) and "Play again" deals a FRESH
      //  seed. A link captured at mount -- in state, in a memo, in a ref --
      //  would point at the previous shuffle. This re-renders with a new seed
      //  and presses copy again: the second call must carry the second seed.
      // ===================================================================
      // Typed, so `mock.calls[0]?.[0]` is the string this asserts on rather than `never`.
      const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
      stubClipboard(writeText);
      const { rerender, props } = renderActions();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));
      expect(writeText.mock.calls[0]?.[0]).toContain(`seed=${SEED}`);

      const nextSeed = '0f0e0d0c0b0a0908';
      rerender(<DeckActions {...props} seed={nextSeed} />);
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));

      expect(writeText.mock.calls[1]?.[0]).toContain(`seed=${nextSeed}`);
      expect(linkParams(writeText.mock.calls[1]?.[0]).has('v')).toBe(false);
    });

    it('should show the link as selectable text when the clipboard rejects', async () => {
      // A rejection is the ordinary case on an insecure origin, and a silent no-op there reads as a
      // broken button. The fallback has to be copyable BY HAND, hence an input rather than a
      // sentence.
      stubClipboard(
        vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error('denied'))),
      );
      renderActions();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));

      const field = (await screen.findByLabelText(
        COPY.deckActions.shareLinkFieldLabel,
      )) as HTMLInputElement;
      expect(linkParams(field.value).get('playlist')).toBe(PLAYLIST_ID);
      expect(linkParams(field.value).get('seed')).toBe(SEED);
      expect(linkParams(field.value).has('v')).toBe(false);
      expect(field.readOnly).toBe(true);
    });

    it('should fall back when there is no clipboard API at all', () => {
      // `navigator.clipboard` is undefined outside a secure context, so reading `.writeText` off it
      // would throw rather than reject. The guard is not padding.
      stubClipboard(undefined);
      renderActions();

      expect(() => {
        fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.copyLink }));
      }).not.toThrow();
      const field = screen.getByLabelText(COPY.deckActions.shareLinkFieldLabel) as HTMLInputElement;
      expect(field.value).toContain(`seed=${SEED}`);
      expect(linkParams(field.value).has('v')).toBe(false);
    });

    it('should say nothing before the copy button is pressed', () => {
      // The live region must not exist while it has no news: an empty `role="status"` on mount is
      // an announcement of nothing.
      renderActions();

      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByLabelText(COPY.deckActions.shareLinkFieldLabel)).toBeNull();
    });
  });

  describe('saving the playlist', () => {
    it('should offer a save control and invoke it once', () => {
      // Explicit (decision 10): a playlist the player chose to keep, rather than every URL anyone
      // pasted.
      const onSavePlaylist = vi.fn();
      renderActions({ onSavePlaylist });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.save }));

      expect(onSavePlaylist).toHaveBeenCalledTimes(1);
    });

    it('should confirm in the label once it is saved', () => {
      // The label IS the confirmation, and the control is disabled rather than hidden: a button that
      // vanishes on press leaves the player unsure whether it worked.
      renderActions({ isPlaylistSaved: true });

      const button = screen.getByRole('button', {
        name: COPY.deckActions.saved,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(screen.queryByRole('button', { name: COPY.deckActions.save })).toBeNull();
    });
  });

  describe('the printable export', () => {
    it('should label, report and name the export in the active language', async () => {
      // `usePdfExport` reads the locale for the one string the document carries: its file name.
      const { copy } = CATALOGUES.es;
      render(
        <LocaleContext.Provider value={{ locale: 'es', ...CATALOGUES.es, setLocale: () => {} }}>
          <DeckActions
            playlistIds={[PLAYLIST_ID]}
            playlistName="Rock Classics"
            seed={SEED}
            shareOrigin={ORIGIN}
            onSavePlaylist={vi.fn()}
            isPlaylistSaved={false}
            deck={fixtureDeck.filter((card) => typeof card.year === 'number')}
            pendingYearCount={0}
            keepYearless={false}
            skipUnconfirmed={false}
          />
        </LocaleContext.Provider>,
      );

      printDeck(copy.deckActions.print);

      await waitFor(() => {
        expect(screen.queryByText(copy.deckActions.exportDone)).not.toBeNull();
      });
      expect(saveMock).toHaveBeenCalledWith(pdfFileName('Rock Classics', copy.pdf));
    });

    it('should say how many sheets and which duplex setting before the press', () => {
      // The sheet count is a thing to know BEFORE committing paper, and long-edge is the setting the
      // column mirror in `pdf-sheet.ts` assumes -- short-edge would invert the correction, so the
      // instruction is on screen rather than guessed at in code.
      const { container, props } = renderActions();

      expect(container.textContent ?? '').toContain(
        COPY.deckActions.sheetSummary(sheetsForDeck(props.deck, props.keepYearless)),
      );
    });

    it('should report that there is nothing to print when no card has a year', () => {
      // The pending-year case, and it is not a failure: the answer for the player is "wait a moment",
      // which is why it has its own status rather than sharing `failed`. Mid-game this is the
      // COMMON case rather than an edge one -- a deck's years are still arriving on card 1.
      const pending = { ...(fixtureDeck[0] as (typeof fixtureDeck)[number]) };
      delete pending.year;
      renderActions({ deck: [pending] });

      printDeck();

      expect(screen.getByRole('status').textContent).toBe(COPY.deckActions.exportEmpty);
      /*
        Nothing was loaded and nothing was downloaded -- the check happens before the import. Read
        off the button's LABEL rather than by searching for the progress wording: the label is
        `COPY.deckActions.print` while idle and `printing(done, total)` while working, so a button
        still wearing the idle name is exactly the claim "no export started", with no sentence
        pinned anywhere.
      */
      expect(screen.queryByRole('button', { name: COPY.deckActions.print })).not.toBeNull();
    });

    it('should wait for the outstanding years instead of exporting a short deck', () => {
      // ===================================================================
      //  THE 2026-08-07 GATE. The PDF is the one artefact here that is
      //  FINISHED WHEN IT IS MADE -- a share link and a saved playlist both
      //  survive the years arriving afterwards, because the recipient looks
      //  them up again. Exporting mid-crawl silently drops every card whose
      //  year is still in flight, and the omission is discoverable only by
      //  counting a printed stack.
      //
      //  So the press does not export and does not refuse: it waits.
      // ===================================================================
      const { container } = renderActions({ pendingYearCount: 3 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      const text = container.textContent ?? '';
      expect(text).toContain(COPY.deckActions.waitingHeading);
      expect(text).toContain(COPY.deckActions.waitingDetail(3));
      // Nothing was started: the wait's own button is still offering the partial print rather than
      // reporting progress, and the export's statuses are all silent.
      expect(screen.queryByRole('button', { name: COPY.deckActions.printPartial })).not.toBeNull();
      expect(screen.queryByText(COPY.deckActions.exportEmpty)).toBeNull();
    });

    it('should export by itself once the last year lands', () => {
      // The wait ENDS on its own. A player who has to press Print a second time after watching a
      // spinner has been made to do the app's bookkeeping.
      const { rerender, props } = renderActions({ pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      expect(screen.queryByText(COPY.deckActions.waitingHeading)).not.toBeNull();

      // One more year arrives -- still waiting.
      rerender(<DeckActions {...props} pendingYearCount={1} />);
      expect(screen.queryByText(COPY.deckActions.waitingHeading)).not.toBeNull();
      expect(screen.queryByText(COPY.deckActions.waitingDetail(1))).not.toBeNull();

      // The last one lands: the wait is over, the export has started, and the print view now
      // offers the full Print in place of "Print so far".
      rerender(<DeckActions {...props} pendingYearCount={0} />);
      expect(screen.queryByText(COPY.deckActions.waitingHeading)).toBeNull();
      /*
        Either label is correct here -- the panel is back and the auto-export may already have
        started -- so the name is matched with a predicate over the two strings the button can
        carry rather than with a regex over a phrase. `printing`'s counts are known: the default
        deck is the six resolved fixture cards.
      */
      expect(
        screen.queryByRole('button', {
          name: (name: string) =>
            name === COPY.deckActions.print || name === COPY.deckActions.printing(0, 6),
        }),
      ).not.toBeNull();
    });

    it('should carry the reduced-motion hook and say everything in text', () => {
      // Under `prefers-reduced-motion: reduce` the spinner is HIDDEN, not stopped, so the two lines
      // beside it have to carry everything it conveys. jsdom evaluates no media query, so this
      // asserts the hook is present and that removing the element loses no information -- the same
      // pair of checks `PreparingScreen.test.tsx` makes, for the same reason.
      const { container } = renderActions({ pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      const spinner = container.querySelector('[data-motion="spinner"]');
      expect(spinner).not.toBeNull();
      expect(spinner?.getAttribute('aria-hidden')).toBe('true');

      spinner?.remove();
      expect(container.textContent ?? '').toContain(COPY.deckActions.waitingHeading);
      expect(container.textContent ?? '').toContain(COPY.deckActions.waitingDetail(2));
    });

    it('should move focus to Cancel when the wait begins', () => {
      // The press unmounts the button that was focused. Without this, focus falls to `<body>` --
      // and inside the dialog that leaves a keyboard player with no place in a panel whose state
      // they cannot see.
      renderActions({ pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      expect(document.activeElement?.textContent).toBe(COPY.deckActions.cancel);
    });

    it('should let the player cancel the wait', () => {
      // The end screen has no other way out of it -- the game screen's dialog has its own Close,
      // but this component cannot assume a host that provides one.
      renderActions({ pendingYearCount: 5 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.cancel }));

      expect(screen.queryByText(COPY.deckActions.waitingHeading)).toBeNull();
      expect(screen.queryByRole('button', { name: COPY.deckActions.copyLink })).not.toBeNull();
    });

    it('should not resume a cancelled wait when the years arrive', () => {
      // The flag is cleared by Cancel, so the effect's first line returns -- a deck that finishes
      // its crawl a second later must not spring a download on somebody who backed out.
      const { rerender, props } = renderActions({ pendingYearCount: 4 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.cancel }));
      rerender(<DeckActions {...props} pendingYearCount={0} />);

      // Back to the resolved panel with its idle label: nothing sprang a download on somebody who
      // backed out. Same "ask the button, not a sentence" reading as above.
      expect(screen.queryByRole('button', { name: COPY.deckActions.print })).not.toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('should say what is outstanding instead of a sheet count while years are pending', () => {
      // `sheetsForDeck` counts only the cards that already have a year, so mid-crawl it is a figure
      // that would climb while the player read it -- and it would be describing a deck nobody is
      // going to print, since the press waits for the rest.
      const { container, props } = renderActions({ pendingYearCount: 7 });
      const text = container.textContent ?? '';

      expect(text).toContain(COPY.deckActions.printWaitsForYears(7));
      expect(text).not.toContain(
        COPY.deckActions.sheetSummary(sheetsForDeck(props.deck, props.keepYearless)),
      );
    });

    it('should keep copy and save available while years are pending', () => {
      // The asymmetry is the whole design: a link and a save are complete the moment a deck exists.
      // Only the PDF is finished when it is made.
      renderActions({ pendingYearCount: 9 });

      expect(
        (screen.getByRole('button', { name: COPY.deckActions.copyLink }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      expect(
        (screen.getByRole('button', { name: COPY.deckActions.save }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it('should name no card while it waits', () => {
      // The waiting panel mounts beside an unflipped card, and the cards it is waiting FOR are
      // precisely the ones whose answer the player has not seen. A count, never a list.
      const { container } = renderActions({ deck: fixtureDeck, pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      const text = container.textContent ?? '';
      for (const card of fixtureDeck) {
        expect(text).not.toContain(card.title);
        expect(text).not.toContain(card.artist);
      }
    });

    it('should name no excluded card', () => {
      // ===================================================================
      //  A COUNT, NEVER A LIST (step 20). Beside a live card this is the
      //  difference between a status line and a spoiler: the cards left out
      //  of an export are precisely the ones whose year has not arrived, and
      //  one of them can be the card on screen.
      // ===================================================================
      const { container } = renderActions({ deck: fixtureDeck });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      const text = container.textContent ?? '';
      for (const card of fixtureDeck) {
        expect(text).not.toContain(card.title);
        expect(text).not.toContain(card.artist);
      }
    });
  });

  describe('keeping yearless cards', () => {
    /**
     * ===================================================================
     *  THE SESSION'S "KEEP CARDS WITH NO YEAR FOUND" REACHES THE PDF
     *  (plan.year-fetch-rework-ui.md step 6).
     *
     *  On, a final `year: null` card is PRINTED, with its year left blank
     *  for the player to write in; off, it is left out and counted. The
     *  pending card in the fixture deck (`year` absent) is left out either
     *  way -- only a final "no year" is kept.
     * ===================================================================
     */

    /** The first argument of every `text` call `usePdfExport` made, in order. */
    function drawnTexts(): (string | string[])[] {
      return textMock.mock.calls.map((call) => call[0]);
    }

    it('should pass keepYearless through to selectPrintableCards', async () => {
      // ON: the null-year card is printed, so only the pending card is left out.
      const { container } = renderActions({ deck: fixtureDeck, keepYearless: true });
      expect(container.textContent ?? '').toContain(
        COPY.deckActions.sheetSummary(sheetsForDeck(fixtureDeck, true)),
      );

      printDeck();
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDonePartial(1))).not.toBeNull();
      });
      expect(toDataURLMock).toHaveBeenCalledTimes(7);

      // OFF: the same deck, and the null-year card is counted with the pending one.
      cleanup();
      toDataURLMock.mockClear();
      renderActions({ deck: fixtureDeck, keepYearless: false });

      printDeck();
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDonePartial(2))).not.toBeNull();
      });
      expect(toDataURLMock).toHaveBeenCalledTimes(6);
    });

    it('should draw title and artist but no year for a kept yearless card', async () => {
      renderActions({ deck: [noYearCard], keepYearless: true });

      printDeck();
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDone)).not.toBeNull();
      });

      // `splitTextToSize` returns lines, so the title and the artist arrive as one-line arrays.
      const texts = drawnTexts();
      expect(texts).toContainEqual([sanitizeForPdf(noYearCard.title)]);
      expect(texts).toContainEqual([sanitizeForPdf(noYearCard.artist)]);
      expect(texts).toHaveLength(2);
      // `String(null)` is what a missed guard draws, so the word itself is asserted absent, beside
      // anything year-shaped.
      for (const text of texts.flat()) {
        expect(text).not.toBe('null');
        expect(text).not.toMatch(/^\d{4}$/);
      }
      expect(toDataURLMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it('should draw the year for a final card as before', async () => {
      renderActions({ deck: [highConfidenceCard], keepYearless: true });

      printDeck();
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDone)).not.toBeNull();
      });

      expect(drawnTexts()).toEqual([
        String(highConfidenceCard.year),
        [sanitizeForPdf(highConfidenceCard.title)],
        [sanitizeForPdf(highConfidenceCard.artist)],
      ]);
    });
  });

  describe('leaving unconfirmed years blank', () => {
    /**
     * ===================================================================
     *  THE DIALOG'S "LEAVE UNCONFIRMED YEARS BLANK" (2026-10-01).
     *
     *  Ticked, a card whose FINAL year is `low` -- unconfirmed -- is printed
     *  with its title and artist and NO year, exactly as a kept yearless card
     *  is, for the player to write in. A confirmed (`high`) year is printed
     *  either way, and the box changes WHAT is drawn, never which cards are
     *  printed: the count is the same file with or without it.
     * ===================================================================
     */
    function drawnTexts(): (string | string[])[] {
      return textMock.mock.calls.map((call) => call[0]);
    }

    function blankUnconfirmedBox(): HTMLInputElement {
      return screen.getByRole('checkbox', {
        name: COPY.deckActions.blankUnconfirmed,
      }) as HTMLInputElement;
    }

    it('should render the option only in the print view, unticked, above its Print', () => {
      // 2026-10-01, the developer's request: the option sits in the print view, beside the press it
      // qualifies, and no longer among the three actions.
      renderActions();
      expect(
        screen.queryByRole('checkbox', { name: COPY.deckActions.blankUnconfirmed }),
      ).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      const box = blankUnconfirmedBox();
      expect(box.checked).toBe(false);
      expect(box.className).toContain('focus-visible:focus-ring');
      expect(box.closest('label')?.className).toContain('touch-target');
      expect(box.hasAttribute('value')).toBe(false);

      const print = screen.getByRole('button', { name: COPY.deckActions.print });
      expect(box.compareDocumentPosition(print) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('should not offer the option when the session skips unconfirmed years', async () => {
      // 2026-10-01, the developer's call: such a session has already dropped every card whose final
      // year is `low`, so the box could change nothing in the file. Absent in both states of the
      // view, and the export still runs with the year printed as usual.
      const { rerender, props } = renderActions({ skipUnconfirmed: true, pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      expect(
        screen.queryByRole('checkbox', { name: COPY.deckActions.blankUnconfirmed }),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: COPY.deckActions.printPartial })).not.toBeNull();

      rerender(<DeckActions {...props} pendingYearCount={0} />);
      expect(
        screen.queryByRole('checkbox', { name: COPY.deckActions.blankUnconfirmed }),
      ).toBeNull();
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDone)).not.toBeNull();
      });
    });

    it('should offer the option in such a session while it holds an unverified card', async () => {
      // An unverified year (verify could not be asked) survives `skipUnconfirmed`, so the box can
      // blank it, and is offered again (2026-10-01).
      const unchecked = { ...lowConfidenceCard, yearUnverified: true as const };
      renderActions({ skipUnconfirmed: true, deck: [unchecked, highConfidenceCard] });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      fireEvent.click(blankUnconfirmedBox());
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDone)).not.toBeNull();
      });

      expect(drawnTexts()).not.toContain(String(unchecked.year));
      expect(drawnTexts()).toContain(String(highConfidenceCard.year));
    });

    it('should sit beside "Print so far" while years are pending', () => {
      renderActions({ pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      const partial = screen.getByRole('button', { name: COPY.deckActions.printPartial });
      expect(
        blankUnconfirmedBox().compareDocumentPosition(partial) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('should print an unconfirmed year by default', async () => {
      renderActions({ deck: [lowConfidenceCard] });

      printDeck();
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDone)).not.toBeNull();
      });

      expect(drawnTexts()).toContain(String(lowConfidenceCard.year));
    });

    it('should leave only the unconfirmed year blank when ticked', async () => {
      renderActions({ deck: [lowConfidenceCard, highConfidenceCard] });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      fireEvent.click(blankUnconfirmedBox());
      expect(blankUnconfirmedBox().checked).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDone)).not.toBeNull();
      });

      const texts = drawnTexts();
      // Both cards printed -- the option is about what is DRAWN, not which cards.
      expect(toDataURLMock).toHaveBeenCalledTimes(2);
      expect(texts).toContainEqual([sanitizeForPdf(lowConfidenceCard.title)]);
      expect(texts).toContainEqual([sanitizeForPdf(lowConfidenceCard.artist)]);
      expect(texts).not.toContain(String(lowConfidenceCard.year));
      // The confirmed year is still printed.
      expect(texts).toContain(String(highConfidenceCard.year));
      for (const text of texts.flat()) expect(text).not.toBe('null');
    });
  });

  describe('the print view', () => {
    it('should open on a resolved deck without exporting', () => {
      // 2026-10-01: Print opens "Print this deck" even when every year is in -- the view is where
      // the blank-years option lives, so exporting at once would leave it unreachable.
      const { container, props } = renderActions();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      expect(saveMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: COPY.deckActions.copyLink })).toBeNull();
      expect(screen.queryByRole('button', { name: COPY.deckActions.cancel })).not.toBeNull();
      expect(screen.queryByText(COPY.deckActions.waitingHeading)).toBeNull();
      expect(container.textContent ?? '').toContain(
        COPY.deckActions.sheetSummary(sheetsForDeck(props.deck, props.keepYearless)),
      );
    });

    it('should ask the host for the heading of the view on show', () => {
      const renderHeading = (view: DeckActionsView) => <h2 data-testid="heading">{view}</h2>;
      renderActions({ renderHeading });
      expect(screen.getByTestId('heading').textContent).toBe('actions');

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      expect(screen.getByTestId('heading').textContent).toBe('print');

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.cancel }));
      expect(screen.getByTestId('heading').textContent).toBe('actions');
    });

    it('should move focus to Cancel on the way in and back to Print on the way out', () => {
      renderActions();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      expect(document.activeElement?.textContent).toBe(COPY.deckActions.cancel);

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.cancel }));
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: COPY.deckActions.print }),
      );
    });

    it('should keep the option across a Cancel, for as long as the panel is open', () => {
      // The option is the PANEL's state, not the view's: Cancel and Print again find it as left.
      renderActions();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));
      fireEvent.click(screen.getByRole('checkbox', { name: COPY.deckActions.blankUnconfirmed }));
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.cancel }));
      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      expect(
        (
          screen.getByRole('checkbox', {
            name: COPY.deckActions.blankUnconfirmed,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
    });
  });

  describe('printing what has already arrived', () => {
    /**
     * ===================================================================
     *  "PRINT SO FAR" IS THE INFORMED VERSION OF WHAT THE YEAR GATE
     *  REFUSES (2026-08-07).
     *
     *  The gate exists because an export taken mid-crawl prints a deck
     *  that is QUIETLY short. It does not exist because a short deck is
     *  never wanted: somebody who wants to start playing with 6 of 8
     *  cards is making a trade, and the "N cards left out" line is what
     *  makes it a trade rather than a surprise -- which is why the test
     *  below asserts that count rather than only the download.
     *
     *  The two properties these tests pin: the export HAPPENS, and the
     *  wait SURVIVES it -- the complete deck still arrives by itself.
     * ===================================================================
     */
    function startWait(overrides: Partial<DeckActionsProps> = {}) {
      const rendered = renderActions({ deck: fixtureDeck, pendingYearCount: 2, ...overrides });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.print }));

      return rendered;
    }

    it('should offer the partial print beside Cancel', () => {
      startWait();

      expect(screen.queryByRole('button', { name: COPY.deckActions.printPartial })).not.toBeNull();
      expect(screen.queryByRole('button', { name: COPY.deckActions.cancel })).not.toBeNull();
    });

    it('should export the resolved cards and report how many were left out', async () => {
      // The fixture deck holds 6 cards with a year, one with `null` and one with `undefined`. Both
      // of the latter are dropped by `selectPrintableCards`, and the count is the honest part.
      startWait();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.printPartial }));

      // Synchronous, because `usePdfExport` publishes `working` before it awaits either import.
      expect(
        screen.queryByRole('button', { name: COPY.deckActions.printing(0, 6) }),
      ).not.toBeNull();

      // The count is the honest half of the trade, so the DONE message is asserted in its
      // excluded-cards form rather than in its plain one.
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDonePartial(2))).not.toBeNull();
      });

      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(toDataURLMock).toHaveBeenCalledTimes(6);
    });

    it('should keep waiting after the partial print, then export the full deck by itself', async () => {
      // "El modal continúa el proceso": the press is not an exit. `hasAskedToPrint` is untouched, so
      // the wait survives its own export and the complete deck still arrives -- two files, both
      // asked for.
      const { rerender, props } = startWait();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.printPartial }));
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDonePartial(2))).not.toBeNull();
      });

      expect(screen.queryByText(COPY.deckActions.waitingHeading)).not.toBeNull();
      expect(screen.queryByRole('button', { name: COPY.deckActions.printPartial })).not.toBeNull();

      // The crawl finishes: the wait ends on its own and the auto-export takes over, exactly as it
      // does for a player who never pressed this.
      rerender(<DeckActions {...props} deck={fixtureDeck} pendingYearCount={0} />);

      expect(screen.queryByText(COPY.deckActions.waitingHeading)).toBeNull();
      await waitFor(() => {
        expect(saveMock).toHaveBeenCalledTimes(2);
      });
    });

    it('should refuse politely when no year has arrived at all', () => {
      // The common case on card 1, and it is not a failure: the whole deck is still in flight.
      startWait({ deck: fixtureDeck.filter((card) => typeof card.year !== 'number') });

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.printPartial }));

      expect(screen.getByText(COPY.deckActions.exportEmpty)).not.toBeNull();
      // Still waiting -- a refusal is not an exit either.
      expect(screen.queryByText(COPY.deckActions.waitingHeading)).not.toBeNull();
      expect(saveMock).not.toHaveBeenCalled();
    });

    it('should name no card while a partial export runs or reports', async () => {
      // The wait mounts beside an UNFLIPPED card, and the cards this export leaves out are exactly
      // the ones whose answer the player has not seen. A count, never a list -- and the leak rule
      // covers the DONE message as much as the pending one.
      const { container } = startWait();

      fireEvent.click(screen.getByRole('button', { name: COPY.deckActions.printPartial }));
      await waitFor(() => {
        expect(screen.queryByText(COPY.deckActions.exportDonePartial(2))).not.toBeNull();
      });

      const text = container.textContent ?? '';
      for (const card of fixtureDeck) {
        expect(text).not.toContain(card.title);
        expect(text).not.toContain(card.artist);
        if (typeof card.year === 'number') expect(text).not.toContain(String(card.year));
      }
    });
  });
});
