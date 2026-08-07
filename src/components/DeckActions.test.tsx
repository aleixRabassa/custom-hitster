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
import { fixtureDeck } from './__fixtures__/cards';
import type { DeckActionsProps } from './DeckActions';

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
const { toDataURLMock, saveMock } = vi.hoisted(() => ({
  // `vi.hoisted` is required: the factories below are hoisted above ordinary `const` declarations.
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
  saveMock: vi.fn<(fileName: string) => void>(),
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
    text() {}

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
const ORIGIN = 'https://hitster.example/';

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
    ...overrides,
  };

  return { ...render(<DeckActions {...props} />), props };
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

    expect(screen.queryByRole('button', { name: /copy share link/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /save this playlist/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /print as pdf cards/i })).not.toBeNull();
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

      fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]?.[0]).toBe(
        `https://hitster.example?playlist=${PLAYLIST_ID}&seed=${SEED}`,
      );
      // Confirmed in a live region, which is safe even beside an unflipped card: the link names a
      // playlist and a seed.
      await waitFor(() => {
        expect(screen.getByRole('status').textContent).toMatch(/copied/i);
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

      fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

      expect(writeText.mock.calls[0]?.[0]).toBe(
        `https://hitster.example?playlist=${PLAYLIST_ID},${SECOND_PLAYLIST_ID}&seed=${SEED}`,
      );
      await waitFor(() => {
        expect(screen.getByRole('status').textContent).toMatch(/copied/i);
      });
    });

    it('should say playlists rather than playlist for a combined deck', () => {
      // The caption is the sentence that has to be read and believed, so it agrees with the deck it
      // describes. "Same playlist" over a three-playlist deck reads as a link to one of them.
      renderActions({ playlistIds: [PLAYLIST_ID, SECOND_PLAYLIST_ID] });

      const text = document.body.textContent ?? '';
      expect(text).toMatch(/same playlists, same shuffle/i);
      // And still never the one promise it cannot keep -- which now has a third reason: a playlist
      // that has gone private since is dropped with a notice rather than blocking.
      expect(text).not.toMatch(/same deck/i);
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

      fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));
      expect(writeText.mock.calls[0]?.[0]).toContain(`seed=${SEED}`);

      const nextSeed = '0f0e0d0c0b0a0908';
      rerender(<DeckActions {...props} seed={nextSeed} />);
      fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

      expect(writeText.mock.calls[1]?.[0]).toContain(`seed=${nextSeed}`);
    });

    it('should show the link as selectable text when the clipboard rejects', async () => {
      // A rejection is the ordinary case on an insecure origin, and a silent no-op there reads as a
      // broken button. The fallback has to be copyable BY HAND, hence an input rather than a
      // sentence.
      stubClipboard(
        vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error('denied'))),
      );
      renderActions();

      fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

      const field = (await screen.findByLabelText('Share link')) as HTMLInputElement;
      expect(field.value).toBe(`https://hitster.example?playlist=${PLAYLIST_ID}&seed=${SEED}`);
      expect(field.readOnly).toBe(true);
    });

    it('should fall back when there is no clipboard API at all', () => {
      // `navigator.clipboard` is undefined outside a secure context, so reading `.writeText` off it
      // would throw rather than reject. The guard is not padding.
      stubClipboard(undefined);
      renderActions();

      expect(() => {
        fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));
      }).not.toThrow();
      expect((screen.getByLabelText('Share link') as HTMLInputElement).value).toContain(
        `seed=${SEED}`,
      );
    });

    it('should not promise an identical deck', () => {
      // Decision 4, asserted as copy. The link reproduces a SHUFFLE, not a card set -- yearless
      // cards are dropped at play time and editorial playlists refresh. "The same deck" here would
      // be a promise the app cannot keep.
      const { container } = renderActions();
      const text = container.textContent ?? '';

      expect(text).toMatch(/same playlist, same shuffle/i);
      expect(text).not.toMatch(/same deck/i);
    });

    it('should say nothing before the copy button is pressed', () => {
      // The live region must not exist while it has no news: an empty `role="status"` on mount is
      // an announcement of nothing.
      renderActions();

      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByLabelText('Share link')).toBeNull();
    });
  });

  describe('saving the playlist', () => {
    it('should offer a save control and invoke it once', () => {
      // Explicit (decision 10): a playlist the player chose to keep, rather than every URL anyone
      // pasted.
      const onSavePlaylist = vi.fn();
      renderActions({ onSavePlaylist });

      fireEvent.click(screen.getByRole('button', { name: /save this playlist/i }));

      expect(onSavePlaylist).toHaveBeenCalledTimes(1);
    });

    it('should confirm in the label once it is saved', () => {
      // The label IS the confirmation, and the control is disabled rather than hidden: a button that
      // vanishes on press leaves the player unsure whether it worked.
      renderActions({ isPlaylistSaved: true });

      const button = screen.getByRole('button', {
        name: /saved to your playlists/i,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(screen.queryByRole('button', { name: /^save this playlist$/i })).toBeNull();
    });
  });

  describe('the printable export', () => {
    it('should say how many sheets and which duplex setting before the press', () => {
      // Nine sheets is a thing to know BEFORE committing paper, and long-edge is the setting the
      // column mirror in `pdf-sheet.ts` assumes -- short-edge would invert the correction, so the
      // instruction is on screen rather than guessed at in code.
      const { container } = renderActions();
      const text = container.textContent ?? '';

      expect(text).toMatch(/A4 sheets?/);
      expect(text).toMatch(/double-sided on the long edge/i);
      expect(text).toMatch(/12 cards each/i);
    });

    it('should report that there is nothing to print when no card has a year', () => {
      // The pending-year case, and it is not a failure: the answer for the player is "wait a moment",
      // which is why it has its own status rather than sharing `failed`. Mid-game this is the
      // COMMON case rather than an edge one -- a deck's years are still arriving on card 1.
      const pending = { ...(fixtureDeck[0] as (typeof fixtureDeck)[number]) };
      delete pending.year;
      renderActions({ deck: [pending] });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

      expect(screen.getByRole('status').textContent).toMatch(/nothing to print/i);
      // Nothing was loaded and nothing was downloaded -- the check happens before the import.
      expect(screen.queryByText(/building pdf/i)).toBeNull();
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

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

      const text = container.textContent ?? '';
      expect(text).toMatch(/waiting for the last years/i);
      expect(text).toMatch(/3 cards are still looking up a year/i);
      // Nothing was started: no progress count, and the export's own statuses are all silent.
      expect(screen.queryByText(/building pdf/i)).toBeNull();
      expect(screen.queryByText(/nothing to print/i)).toBeNull();
    });

    it('should export by itself once the last year lands', () => {
      // The wait ENDS on its own. A player who has to press Print a second time after watching a
      // spinner has been made to do the app's bookkeeping.
      const { rerender, props } = renderActions({ pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));
      expect(screen.queryByText(/waiting for the last years/i)).not.toBeNull();

      // One more year arrives -- still waiting.
      rerender(<DeckActions {...props} pendingYearCount={1} />);
      expect(screen.queryByText(/waiting for the last years/i)).not.toBeNull();
      expect(screen.queryByText(/1 card is still looking up a year/i)).not.toBeNull();

      // The last one lands: the wait is over and the export has taken over the panel.
      rerender(<DeckActions {...props} pendingYearCount={0} />);
      expect(screen.queryByText(/waiting for the last years/i)).toBeNull();
      expect(
        screen.queryByRole('button', { name: /print as pdf cards|building pdf/i }),
      ).not.toBeNull();
    });

    it('should carry the reduced-motion hook and say everything in text', () => {
      // Under `prefers-reduced-motion: reduce` the spinner is HIDDEN, not stopped, so the two lines
      // beside it have to carry everything it conveys. jsdom evaluates no media query, so this
      // asserts the hook is present and that removing the element loses no information -- the same
      // pair of checks `PreparingScreen.test.tsx` makes, for the same reason.
      const { container } = renderActions({ pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

      const spinner = container.querySelector('[data-motion="spinner"]');
      expect(spinner).not.toBeNull();
      expect(spinner?.getAttribute('aria-hidden')).toBe('true');

      spinner?.remove();
      expect(container.textContent ?? '').toMatch(/waiting for the last years/i);
      expect(container.textContent ?? '').toMatch(/2 cards are still looking up a year/i);
    });

    it('should move focus to Cancel when the wait begins', () => {
      // The press unmounts the button that was focused. Without this, focus falls to `<body>` --
      // and inside the dialog that leaves a keyboard player with no place in a panel whose state
      // they cannot see.
      renderActions({ pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

      expect(document.activeElement?.textContent).toMatch(/^cancel$/i);
    });

    it('should let the player cancel the wait', () => {
      // The end screen has no other way out of it -- the game screen's dialog has its own Close,
      // but this component cannot assume a host that provides one.
      renderActions({ pendingYearCount: 5 });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(screen.queryByText(/waiting for the last years/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /copy share link/i })).not.toBeNull();
    });

    it('should not resume a cancelled wait when the years arrive', () => {
      // The flag is cleared by Cancel, so the effect's first line returns -- a deck that finishes
      // its crawl a second later must not spring a download on somebody who backed out.
      const { rerender, props } = renderActions({ pendingYearCount: 4 });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
      rerender(<DeckActions {...props} pendingYearCount={0} />);

      expect(screen.queryByText(/building pdf/i)).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('should say what is outstanding instead of a sheet count while years are pending', () => {
      // `sheetsForDeck` counts only the cards that already have a year, so mid-crawl it is a figure
      // that would climb while the player read it -- and it would be describing a deck nobody is
      // going to print, since the press waits for the rest.
      const { container } = renderActions({ pendingYearCount: 7 });
      const text = container.textContent ?? '';

      expect(text).toMatch(/7 cards are still looking up a year — printing waits for them all/i);
      expect(text).not.toMatch(/A4 sheets?/);
    });

    it('should keep copy and save available while years are pending', () => {
      // The asymmetry is the whole design: a link and a save are complete the moment a deck exists.
      // Only the PDF is finished when it is made.
      renderActions({ pendingYearCount: 9 });

      expect(
        (screen.getByRole('button', { name: /copy share link/i }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(
        (screen.getByRole('button', { name: /save this playlist/i }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    it('should name no card while it waits', () => {
      // The waiting panel mounts beside an unflipped card, and the cards it is waiting FOR are
      // precisely the ones whose answer the player has not seen. A count, never a list.
      const { container } = renderActions({ deck: fixtureDeck, pendingYearCount: 2 });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

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

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

      const text = container.textContent ?? '';
      for (const card of fixtureDeck) {
        expect(text).not.toContain(card.title);
        expect(text).not.toContain(card.artist);
      }
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

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

      return rendered;
    }

    it('should offer the partial print beside Cancel', () => {
      startWait();

      expect(screen.queryByRole('button', { name: /print so far/i })).not.toBeNull();
      expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeNull();
    });

    it('should export the resolved cards and report how many were left out', async () => {
      // The fixture deck holds 6 cards with a year, one with `null` and one with `undefined`. Both
      // of the latter are dropped by `selectPrintableCards`, and the count is the honest part.
      startWait();

      fireEvent.click(screen.getByRole('button', { name: /print so far/i }));

      // Synchronous, because `usePdfExport` publishes `working` before it awaits either import.
      expect(screen.queryByRole('button', { name: /building pdf… 0\/6/i })).not.toBeNull();

      await waitFor(() => {
        expect(screen.getByText(/pdf downloaded/i).textContent).toMatch(
          /2 cards left out, no year yet/i,
        );
      });

      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(toDataURLMock).toHaveBeenCalledTimes(6);
    });

    it('should keep waiting after the partial print, then export the full deck by itself', async () => {
      // "El modal continúa el proceso": the press is not an exit. `hasAskedToPrint` is untouched, so
      // the wait survives its own export and the complete deck still arrives -- two files, both
      // asked for.
      const { rerender, props } = startWait();

      fireEvent.click(screen.getByRole('button', { name: /print so far/i }));
      await waitFor(() => {
        expect(screen.queryByText(/pdf downloaded/i)).not.toBeNull();
      });

      expect(screen.queryByText(/waiting for the last years/i)).not.toBeNull();
      expect(screen.queryByRole('button', { name: /print so far/i })).not.toBeNull();

      // The crawl finishes: the wait ends on its own and the auto-export takes over, exactly as it
      // does for a player who never pressed this.
      rerender(<DeckActions {...props} deck={fixtureDeck} pendingYearCount={0} />);

      expect(screen.queryByText(/waiting for the last years/i)).toBeNull();
      await waitFor(() => {
        expect(saveMock).toHaveBeenCalledTimes(2);
      });
    });

    it('should refuse politely when no year has arrived at all', () => {
      // The common case on card 1, and it is not a failure: the whole deck is still in flight.
      startWait({ deck: fixtureDeck.filter((card) => typeof card.year !== 'number') });

      fireEvent.click(screen.getByRole('button', { name: /print so far/i }));

      expect(screen.getByText(/nothing to print/i)).not.toBeNull();
      // Still waiting -- a refusal is not an exit either.
      expect(screen.queryByText(/waiting for the last years/i)).not.toBeNull();
      expect(saveMock).not.toHaveBeenCalled();
    });

    it('should name no card while a partial export runs or reports', async () => {
      // The wait mounts beside an UNFLIPPED card, and the cards this export leaves out are exactly
      // the ones whose answer the player has not seen. A count, never a list -- and the leak rule
      // covers the DONE message as much as the pending one.
      const { container } = startWait();

      fireEvent.click(screen.getByRole('button', { name: /print so far/i }));
      await waitFor(() => {
        expect(screen.queryByText(/pdf downloaded/i)).not.toBeNull();
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
