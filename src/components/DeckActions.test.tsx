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
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeckActions } from './DeckActions';
import { fixtureDeck } from './__fixtures__/cards';
import type { DeckActionsProps } from './DeckActions';

const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';
const SEED = 'a1b2c3d4e5f60718';
const ORIGIN = 'https://hitster.example/';

function renderActions(overrides: Partial<DeckActionsProps> = {}) {
  const props: DeckActionsProps = {
    playlistId: PLAYLIST_ID,
    playlistName: 'Rock Classics',
    seed: SEED,
    shareOrigin: ORIGIN,
    onSavePlaylist: vi.fn(),
    isPlaylistSaved: false,
    // A resolved deck, so the export has something to print. The fixture deck's yearless cards are
    // what the exclusion count is about, and one test uses them deliberately.
    deck: fixtureDeck.filter((card) => typeof card.year === 'number'),
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
});
