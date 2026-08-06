/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EndScreen } from './EndScreen';
import { fixtureDeck } from './__fixtures__/cards';
import type { EndScreenProps } from './EndScreen';

const PLAYLIST_ID = '37i9dQZF1DXcBWIGoYBM5M';
const SEED = 'a1b2c3d4e5f60718';
const ORIGIN = 'https://hitster.example/';

/**
 * The share props are required, so every render needs them. Defaulted here rather than repeated in
 * a dozen renders -- a test that cares about one of them overrides just that one.
 */
function renderEnd(overrides: Partial<EndScreenProps> = {}) {
  const props: EndScreenProps = {
    cardsPlayed: 42,
    playlistName: 'Rock Classics',
    onRestart: vi.fn(),
    onNewPlaylist: vi.fn(),
    playlistId: PLAYLIST_ID,
    seed: SEED,
    shareOrigin: ORIGIN,
    onSavePlaylist: vi.fn(),
    isPlaylistSaved: false,
    // A resolved deck, so the export has something to print. The fixture deck's yearless cards are
    // what the exclusion count is about, and one test uses them deliberately.
    deck: fixtureDeck.filter((card) => typeof card.year === 'number'),
    ...overrides,
  };

  return { ...render(<EndScreen {...props} />), props };
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

describe('EndScreen', () => {
  afterEach(() => {
    cleanup();
    // Leaves jsdom's own `navigator.clipboard` shape behind rather than a stub from the last test.
    stubClipboard(undefined);
    vi.restoreAllMocks();
  });

  it('should render cards played and both actions', () => {
    renderEnd();

    expect(screen.getByText(/42 cards played/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /play again/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /new playlist/i })).not.toBeNull();
  });

  it('should use the singular for a one-card deck', () => {
    renderEnd({ cardsPlayed: 1 });

    expect(screen.getByText(/1 card played/i)).not.toBeNull();
  });

  it('should invoke restart and new-playlist callbacks', () => {
    const onRestart = vi.fn();
    const onNewPlaylist = vi.fn();
    renderEnd({ onRestart, onNewPlaylist });

    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /new playlist/i }));
    expect(onNewPlaylist).toHaveBeenCalledTimes(1);
  });

  it('should say that a restart reshuffles', () => {
    // A player who has just heard forty songs wants to know whether "play again" means the same
    // order. It does not -- `start` with no seed generates a fresh one.
    const { container } = renderEnd();

    expect(container.textContent ?? '').toMatch(/new order/i);
  });

  it('should give every action a focus-visible style', () => {
    // Class-name level, with the caveat given in full in `LandingScreen.test.tsx`. The count is
    // asserted as well, so a button added without a ring fails here.
    renderEnd();

    const buttons = screen.getAllByRole('button');
    // Play again, New playlist, Copy share link, Save this playlist, Print as PDF cards.
    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button.className).toContain('focus-visible:focus-ring');
    }
  });

  it('should not render any track information', () => {
    // The deck is over, so this is the ONE screen where a leak would cost nothing -- and the
    // assertion is here anyway, because "here is what you played" is the obvious thing to add and
    // Restart deals the same tracks again immediately afterwards. A track list on this screen would
    // spoil the rematch.
    const { container } = renderEnd();
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
    }
  });

  describe('the share link', () => {
    it('should offer a copy control and confirm the copy', async () => {
      // Typed, so `mock.calls[0]?.[0]` is the string this asserts on rather than `never`.
      const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
      stubClipboard(writeText);
      renderEnd();

      fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]?.[0]).toBe(
        `https://hitster.example?playlist=${PLAYLIST_ID}&seed=${SEED}`,
      );
      // Confirmed in a live region, which is safe here: the link names a playlist and a seed.
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
      const { rerender, props } = renderEnd();

      fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));
      expect(writeText.mock.calls[0]?.[0]).toContain(`seed=${SEED}`);

      const nextSeed = '0f0e0d0c0b0a0908';
      rerender(<EndScreen {...props} seed={nextSeed} />);
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
      renderEnd();

      fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

      const field = (await screen.findByLabelText('Share link')) as HTMLInputElement;
      expect(field.value).toBe(`https://hitster.example?playlist=${PLAYLIST_ID}&seed=${SEED}`);
      expect(field.readOnly).toBe(true);
    });

    it('should fall back when there is no clipboard API at all', () => {
      // `navigator.clipboard` is undefined outside a secure context, so reading `.writeText` off it
      // would throw rather than reject. The guard is not padding.
      stubClipboard(undefined);
      renderEnd();

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
      const { container } = renderEnd();
      const text = container.textContent ?? '';

      expect(text).toMatch(/same playlist, same shuffle/i);
      expect(text).not.toMatch(/same deck/i);
    });

    it('should say nothing before the copy button is pressed', () => {
      // The live region must not exist while it has no news: an empty `role="status"` on mount is
      // an announcement of nothing, and on this screen it would be the only one.
      renderEnd();

      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByLabelText('Share link')).toBeNull();
    });
  });

  describe('saving the playlist', () => {
    it('should offer a save control and invoke it once', () => {
      // Explicit, and on THIS screen (decision 10): a playlist the player actually played through,
      // rather than every URL anyone pasted.
      const onSavePlaylist = vi.fn();
      renderEnd({ onSavePlaylist });

      fireEvent.click(screen.getByRole('button', { name: /save this playlist/i }));

      expect(onSavePlaylist).toHaveBeenCalledTimes(1);
    });

    it('should confirm in the label once it is saved', () => {
      // The label IS the confirmation, and the control is disabled rather than hidden: a button that
      // vanishes on press leaves the player unsure whether it worked.
      renderEnd({ isPlaylistSaved: true });

      const button = screen.getByRole('button', {
        name: /saved to your playlists/i,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(screen.queryByRole('button', { name: /^save this playlist$/i })).toBeNull();
    });
  });

  describe('the printable export', () => {
    it('should offer copy, save and export on the end screen', () => {
      // The three things a finished deck can become, asserted together: this is the check that fails
      // if one of them is dropped in a later edit of this screen.
      renderEnd();

      expect(screen.queryByRole('button', { name: /copy share link/i })).not.toBeNull();
      expect(screen.queryByRole('button', { name: /save this playlist/i })).not.toBeNull();
      expect(screen.queryByRole('button', { name: /print as pdf cards/i })).not.toBeNull();
    });

    it('should say how many sheets and which duplex setting before the press', () => {
      // Nine sheets is a thing to know BEFORE committing paper, and long-edge is the setting the
      // column mirror in `pdf-sheet.ts` assumes -- short-edge would invert the correction, so the
      // instruction is on screen rather than guessed at in code.
      const { container } = renderEnd();
      const text = container.textContent ?? '';

      expect(text).toMatch(/A4 sheets?/);
      expect(text).toMatch(/double-sided on the long edge/i);
      expect(text).toMatch(/12 cards each/i);
    });

    it('should report that there is nothing to print when no card has a year', () => {
      // The pending-year case, and it is not a failure: the answer for the player is "wait a moment",
      // which is why it has its own status rather than sharing `failed`.
      const pending = { ...(fixtureDeck[0] as (typeof fixtureDeck)[number]) };
      delete pending.year;
      renderEnd({ deck: [pending] });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

      expect(screen.getByRole('status').textContent).toMatch(/nothing to print/i);
      // Nothing was loaded and nothing was downloaded -- the check happens before the import.
      expect(screen.queryByText(/building pdf/i)).toBeNull();
    });

    it('should name no excluded card', () => {
      // ===================================================================
      //  A COUNT, NEVER A LIST (step 20). The end screen is one press from
      //  re-dealing the same deck, so a list of left-out titles here would
      //  spoil the rematch -- the same reason this screen's other leak test
      //  exists.
      // ===================================================================
      const { container } = renderEnd({ deck: fixtureDeck });

      fireEvent.click(screen.getByRole('button', { name: /print as pdf cards/i }));

      const text = container.textContent ?? '';
      for (const card of fixtureDeck) {
        expect(text).not.toContain(card.title);
        expect(text).not.toContain(card.artist);
      }
    });
  });
});
