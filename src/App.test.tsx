/**
 * @vitest-environment jsdom
 *
 * The container's integration tests, and the real integration seam of this phase: a stubbed fetch
 * and a stubbed storage drive the whole flow from landing, through preparing and playing, and out
 * both ways.
 *
 * Three things are faked and nothing else:
 *
 * - `qrcode`, because jsdom has no canvas (same fake as every other component test here).
 * - `HTMLMediaElement.play`/`pause`, which jsdom does not implement.
 * - **`/api/year`**, through the global `fetch`. The year RESOLVER is real -- it is what moves the
 *   session out of `preparing`, so stubbing it out would mean never reaching the game screen. The
 *   playlist client gets its own injected `fetchImpl` instead, so the two are independently
 *   controllable: the resolver's requests go to the global stub, the playlist's to the prop.
 *
 * `StorageLike` is a plain in-memory object, which is what lets the resume test write a save
 * directly and mount into it.
 */

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { fixtureDeck, highConfidenceCard, pendingYearCard } from './components/__fixtures__/cards';
import { PLAYLIST_ERROR_MESSAGES } from './game/messages';
import { SESSION_STORAGE_KEY, SESSION_VERSION } from './game/persistence';
import type { PlaylistFetch } from './game/playlist-client';
import type { StorageLike } from './game/persistence';
import type { PersistedSession } from './game/types';
import type { Card, PlaylistResult } from '../shared/types';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

const PLAYLIST_URL = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

const PLAYLIST = { id: '37i9dQZF1DXcBWIGoYBM5M', name: 'Test Playlist', owner: 'Spotify' };

/** A deck with no years at all, so the resolver has real work to do and the gate really gates. */
const UNRESOLVED_DECK: Card[] = fixtureDeck.map(({ year, yearConfidence, ...card }) => {
  void year;
  void yearConfidence;
  return card;
});

function playlistResult(overrides: Partial<PlaylistResult> = {}): PlaylistResult {
  return {
    playlist: PLAYLIST,
    cards: UNRESOLVED_DECK,
    truncated: false,
    skippedCount: 0,
    ...overrides,
  };
}

/** An in-memory `StorageLike`. Exposes its map so a test can seed or inspect a save. */
function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();

  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** A playlist `fetch` double that always answers with one scripted response. */
function playlistFetch(status: number, body: unknown): PlaylistFetch {
  return vi.fn<PlaylistFetch>(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

/**
 * Stub the global `fetch`, which is what the year RESOLVER uses.
 *
 * ===========================================================================
 *  IT HAS TO ANSWER WITH A REAL YEAR, AND IT USED TO ANSWER WITH `null`.
 *
 *  `year: null, confidence: 'none'` was the minimum response that opened the
 *  card-1 gate without inventing any years -- a null year being a completed
 *  lookup rather than a pending one.
 *
 *  Since the 2026-08-05 reversal a null result REMOVES its card from the deck, so
 *  this stub answered every lookup by deleting the card that asked: the deck
 *  emptied, the session went straight to `ended`, and eight tests that only
 *  wanted to reach the game screen found the end screen instead. The stub now
 *  resolves every card to one year, which is the shape of a normal deck.
 *
 *  The invented year is safe here BECAUSE of what these tests assert: the leak
 *  checks below are about titles and artists on pre-reveal surfaces, and the year
 *  never appears until a card is deliberately flipped. A test that needs the
 *  yearless path has `stubDroppingYearApi` instead.
 * ===========================================================================
 */
function stubYearApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            year: 1975,
            confidence: 'high',
            source: 'release-group',
            cached: true,
            cleanedTitle: 'x',
            stripped: { remaster: false, live: false, feature: false, version: false },
          }),
      }),
    ),
  );
}

/**
 * The yearless path: every lookup completes having found nothing, so every card is dropped.
 *
 * The container's side of the reversal, and it is a real user-visible path rather than a synthetic
 * one -- a third of an ordinary playlist resolves to `none`, and a deck of obscure tracks can
 * resolve to nothing at all.
 */
function stubDroppingYearApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () =>
          Promise.resolve({
            year: null,
            confidence: 'none',
            reason: 'no-candidates',
            cached: true,
            cleanedTitle: 'x',
            stripped: { remaster: false, live: false, feature: false, version: false },
          }),
      }),
    ),
  );
}

/** Never-resolving year lookups, so the session stays in `preparing` for the duration of a test. */
function stubHangingYearApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
}

function renderApp(fetchImpl: PlaylistFetch, storage = memoryStorage()) {
  render(<App storage={storage} fetchImpl={fetchImpl} />);

  return { storage };
}

/** Paste a URL and press Start. */
function startPlaylist(url = PLAYLIST_URL) {
  fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: /start/i }));
}

describe('App', () => {
  /**
   * Warm the game-screen chunk before any test needs it.
   *
   * ===========================================================================
   *  THIS IS ABOUT VITE'S TRANSFORM COST, NOT ABOUT THE APP'S BEHAVIOUR.
   *
   *  `App.tsx` reaches `GameScreen` through `React.lazy` so that `motion` --
   *  a third of the bundle, and 250-odd modules -- leaves the landing screen's
   *  chunk. In production that resolves from a warm HTTP cache in milliseconds.
   *  In this suite the FIRST test to reach `playing` pays Vite's first-time
   *  transform of every one of those modules, and it pays it INSIDE a
   *  `waitFor`, whose default timeout is one second. That test failed while the
   *  fifteen after it passed against the now-warm module cache -- which reads
   *  as a broken game screen rather than as a cold cache, and would have
   *  reappeared as a flake in whichever test happened to run first.
   *
   *  Awaiting the import here moves the cost outside every timeout and makes
   *  the order of the tests below irrelevant. It asserts nothing, and it is not
   *  a substitute for the real check: that the chunk is ABSENT from the landing
   *  screen, which is verified in the build output and the network tab.
   * ===========================================================================
   */
  beforeAll(async () => {
    await import('./components/GameScreen');
  });

  beforeEach(() => {
    toDataURLMock.mockReset();
    toDataURLMock.mockImplementation((text) =>
      Promise.resolve(`data:image/png;base64,QR(${text})`),
    );

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should render the landing screen when idle', () => {
    stubHangingYearApi();
    renderApp(playlistFetch(200, playlistResult()));

    expect(screen.queryByLabelText('Playlist link')).not.toBeNull();
    expect(screen.queryByTestId('hud')).toBeNull();
  });

  it('should render the preparing screen while preparing', async () => {
    // The card-1 gate, with the year lookup hanging so the screen stays put and can be asserted on.
    stubHangingYearApi();
    renderApp(playlistFetch(200, playlistResult()));

    startPlaylist();

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Dealing your deck');
    });
    // Count-only: the deck is in memory by now, and none of it may be on screen.
    for (const card of UNRESOLVED_DECK) {
      expect(screen.queryByText(card.title)).toBeNull();
    }
  });

  it('should render the game screen while playing', async () => {
    stubYearApi();
    renderApp(playlistFetch(200, playlistResult()));

    startPlaylist();

    // The HUD is the game screen's signature, and it is what proves the gate actually opened.
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: 'Exit game' })).not.toBeNull();
  });

  it('should show the landing error copy when the playlist request fails', async () => {
    stubHangingYearApi();
    renderApp(playlistFetch(404, { code: 'not-found-or-private', message: 'nope' }));

    startPlaylist();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/private, deleted/i);
    });
    // And it stayed on the landing screen: a failed fetch must never deal a deck.
    expect(screen.queryByTestId('hud')).toBeNull();
  });

  it('should return to the landing screen with a warning when no card has a year', async () => {
    // ===================================================================
    //  THE REVERSAL, END TO END THROUGH THE CONTAINER.
    //
    //  A yearless card is dropped from the deck (2026-08-05), so a deck of
    //  tracks MusicBrainz knows nothing about drains to nothing. The reducer
    //  answers `ended`; what this pins is that the container then sends the
    //  player back to the LANDING SCREEN with a warning.
    //
    //  It used to show the end screen, which read "Deck finished" over a
    //  count of zero -- announcing a completed game to somebody who never saw
    //  a card, and explaining nothing. The regression to guard against is
    //  either that copy coming back, or the preparing spinner hanging: the
    //  gate would wait forever on card 1, since every lookup here completes
    //  and every card leaves.
    // ===================================================================
    stubDroppingYearApi();
    renderApp(playlistFetch(200, playlistResult()));

    startPlaylist();

    /*
      Awaited on the ALERT, not on the input. The landing screen is already on screen at `idle`, so
      `findByLabelText('Playlist link')` resolves on the first frame — before a single lookup has
      returned — and every assertion after it would then run against the pre-Start screen and pass
      for the wrong reason. The warning is the thing that only exists after the collapse.
    */
    expect((await screen.findByRole('alert')).textContent).toBe(
      PLAYLIST_ERROR_MESSAGES['no-years-found'],
    );
    // And it is the landing screen the warning is on.
    expect(screen.queryByLabelText('Playlist link')).not.toBeNull();

    // Not the end screen, and not the preparing spinner.
    expect(screen.queryByText(/deck finished/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /play again/i })).toBeNull();
    expect(screen.queryByTestId('hud')).toBeNull();

    // And nothing about the tracks it dropped is on screen -- the player is being sent away from a
    // deck they never played, so it must not leak what was in it on the way out.
    for (const card of UNRESOLVED_DECK) {
      expect(screen.queryByText(card.title)).toBeNull();
    }
  });

  it('should let the player start a different playlist after a collapsed deck', async () => {
    // The warning is only useful if the screen it appears on still works. A dead end here would be
    // worse than the end screen it replaced, because the end screen at least had "New playlist".
    stubDroppingYearApi();
    const fetchImpl = vi.fn<PlaylistFetch>(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(playlistResult()) }),
    );
    render(<App storage={memoryStorage()} fetchImpl={fetchImpl} />);

    startPlaylist();
    // Awaited on the alert for the same reason as the test above: the input is there from frame one.
    expect((await screen.findByRole('alert')).textContent).toBe(
      PLAYLIST_ERROR_MESSAGES['no-years-found'],
    );

    // A second submission goes through, and the warning about the previous deck does not sit over it.
    stubYearApi();
    startPlaylist();

    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should keep playing the cards that do have a year when others are dropped', async () => {
    // The realistic shape of the reversal: SOME cards resolve, some do not. Phase 3 measured
    // `none` on roughly a third of a real 42-card playlist, so this is the ordinary case and not an
    // edge one -- the deck shrinks under the player and the game carries on.
    let lookups = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        lookups += 1;
        // Every other lookup finds nothing, so half the deck leaves.
        const found = lookups % 2 === 1;

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () =>
            Promise.resolve({
              year: found ? 1975 : null,
              confidence: found ? 'high' : 'none',
              source: 'release-group',
              cached: true,
              cleanedTitle: 'x',
              stripped: { remaster: false, live: false, feature: false, version: false },
            }),
        });
      }),
    );

    renderApp(playlistFetch(200, playlistResult()));
    startPlaylist();

    // The gate opened on a card that HAS a year -- the first lookup found one.
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });

    // The HUD's count falls as the crawl drops cards, which is the visible consequence. It must
    // land strictly between "nothing dropped" and "nothing left".
    await waitFor(() => {
      const hud = screen.getByTestId('hud').textContent ?? '';
      expect(hud).toMatch(/\d+ cards? left/);
      const remaining = Number(/(\d+) cards? left/.exec(hud)?.[1] ?? '-1');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThan(UNRESOLVED_DECK.length - 1);
    });

    // And the game is still playable on a shrinking deck.
    expect(await screen.findByRole('img')).not.toBeNull();
  });

  it('should keep the game playable while cards 2..n have no year', async () => {
    // ===================================================================
    //  THE INVARIANT `plan.md` WARNS REGRESSES SILENTLY, asserted at the UI
    //  level as well as in the reducer.
    //
    //  Only card 1's lookup gates Start. Cards 2..n being unresolved is the
    //  NORMAL state for most of a game, and flip, audio, QR and Exit must all
    //  work regardless. The failure this catches is a screen that decides to
    //  wait for a year -- which the reducer's own tests cannot see, because
    //  the reducer is not what would be waiting.
    // ===================================================================
    let resolvedFirst = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        // Card 1's lookup completes; every later one hangs forever.
        if (resolvedFirst) return new Promise(() => {});
        resolvedFirst = true;

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () =>
            Promise.resolve({
              year: 1975,
              confidence: 'high',
              source: 'release-group',
              cached: true,
              cleanedTitle: 'x',
              stripped: { remaster: false, live: false, feature: false, version: false },
            }),
        });
      }),
    );

    renderApp(playlistFetch(200, playlistResult()));
    startPlaylist();

    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });

    // Advance to card 2, whose year will never arrive.
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    // Everything still works: the QR rendered, the controls are live, and Exit is enabled.
    expect(await screen.findByRole('img')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Exit game' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    // And a flip is not blocked on the pending year.
    //
    // `getAllBy`, not `getBy`: the card just swiped away is still mounted while `AnimatePresence`
    // animates it out, so two `card-inner` elements coexist for a moment. Asserting that ONE of
    // them is flipped is the honest version of this check -- the same reason `CardStack.test.tsx`
    // asserts on identity rather than on a count.
    fireEvent.keyDown(window, { key: ' ' });
    const inners = screen.getAllByTestId('card-inner');
    expect(inners.some((inner) => inner.getAttribute('data-flipped') === 'true')).toBe(true);
  });

  it('should render the end screen when the deck runs out', async () => {
    stubYearApi();
    // A one-card deck, so one advance exhausts it.
    renderApp(playlistFetch(200, playlistResult({ cards: [{ ...pendingYearCard }] })));

    startPlaylist();
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(await screen.findByText(/deck finished/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /play again/i })).not.toBeNull();
  });

  it('should render the landing screen after exit', async () => {
    // ===================================================================
    //  THE END-REASON FLAG -- the decision this plan made instead of touching
    //  the reducer.
    //
    //  Exit and deck-exhaustion BOTH produce `status: 'ended'`, and
    //  `currentIndex` cannot separate them either. Without the container's
    //  flag, an Exit would land on the end screen congratulating the player
    //  for finishing a deck they walked out of.
    // ===================================================================
    stubYearApi();
    renderApp(playlistFetch(200, playlistResult()));

    startPlaylist();
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });

    // Two presses, because Exit now asks first: `ExitConfirmDialog` stands between the button and
    // the container, and the container hears nothing until the player confirms.
    fireEvent.click(screen.getByRole('button', { name: 'Exit game' }));
    fireEvent.click(screen.getByRole('button', { name: 'End game' }));

    expect(await screen.findByLabelText('Playlist link')).not.toBeNull();
    expect(screen.queryByText(/deck finished/i)).toBeNull();
  });

  it('should stay in the game when the exit is cancelled', async () => {
    // The container's side of the confirmation: cancelling must leave the session exactly where it
    // was, with the save intact. `END` clears the save, so a cancel that reached the reducer would
    // be invisible on screen but would have destroyed the resume.
    stubYearApi();
    const { storage } = renderApp(playlistFetch(200, playlistResult()));

    startPlaylist();
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Exit game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));

    expect(screen.queryByTestId('hud')).not.toBeNull();
    expect(screen.queryByLabelText('Playlist link')).toBeNull();
    expect(storage.map.has(SESSION_STORAGE_KEY)).toBe(true);
  });

  it('should reset the end reason when a new game starts', async () => {
    // The flag must not leak into the next session: a stale `landing` would send the NEXT finished
    // deck straight past its end screen.
    stubYearApi();
    renderApp(playlistFetch(200, playlistResult({ cards: [{ ...pendingYearCard }] })));

    // Game 1: exit early, which sets the flag.
    startPlaylist();
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Exit game' }));
    fireEvent.click(screen.getByRole('button', { name: 'End game' }));
    await screen.findByLabelText('Playlist link');

    // Game 2: play it out. The end screen must appear.
    startPlaylist();
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(await screen.findByText(/deck finished/i)).not.toBeNull();
  });

  it('should return to the landing screen from the end screen', async () => {
    // "New playlist" has to reach `idle`'s screen even though the reducer has no action that
    // un-ends a session -- which is why the container's flag is a DESTINATION rather than a reason.
    stubYearApi();
    renderApp(playlistFetch(200, playlistResult({ cards: [{ ...pendingYearCard }] })));

    startPlaylist();
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await screen.findByText(/deck finished/i);

    fireEvent.click(screen.getByRole('button', { name: /new playlist/i }));

    expect(await screen.findByLabelText('Playlist link')).not.toBeNull();
  });

  it('should resume a persisted session on mount', async () => {
    // Resume works for free: `useGameSession` restores the save in its lazy initializer, so the
    // container lands on the game screen without knowing that resuming is a thing.
    stubYearApi();
    const storage = memoryStorage();
    const session: PersistedSession = {
      version: SESSION_VERSION,
      playlist: PLAYLIST,
      seed: 'seed-1',
      deck: [highConfidenceCard],
      currentIndex: 0,
      isFlipped: false,
      status: 'playing',
    };
    storage.map.set(SESSION_STORAGE_KEY, JSON.stringify(session));

    renderApp(playlistFetch(200, playlistResult()), storage);

    // Straight to the game screen -- no landing screen, and no playlist request.
    expect(screen.queryByTestId('hud')).not.toBeNull();
    expect(screen.queryByLabelText('Playlist link')).toBeNull();
    await screen.findByRole('img');
  });

  it('should restart from the current deck', async () => {
    // ===================================================================
    //  Restart re-deals `state.deck`, NOT a remembered fetch result -- which
    //  is what makes it work after a RESUME, where the original
    //  `/api/playlist` response no longer exists anywhere in memory.
    //
    //  This test resumes a two-card session and then restarts it, so there
    //  has never been a fetch at all. A container that kept the result
    //  instead would have nothing to re-deal here.
    // ===================================================================
    stubYearApi();
    const storage = memoryStorage();
    const deck = [highConfidenceCard, { ...highConfidenceCard, id: 'aaaaaaaaaaaaaaaaaaaaaa' }];
    storage.map.set(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        version: SESSION_VERSION,
        playlist: PLAYLIST,
        seed: 'seed-1',
        deck,
        currentIndex: 0,
        isFlipped: false,
        status: 'playing',
      } satisfies PersistedSession),
    );

    // A fetch that would FAIL if it were called, so a restart that secretly re-fetches fails here.
    renderApp(playlistFetch(500, { code: 'internal-error' }), storage);

    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });

    // Play the resumed deck out.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await screen.findByText(/deck finished/i);
    expect(screen.getByText(/2 cards played/i)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /play again/i }));

    // Back in a game, with the same deck size and no request having been made.
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });
    expect(screen.getByTestId('hud').textContent).toContain('1 card left');
  });

  it('should show the truncation notice on the game screen and keep it dismissed', async () => {
    // Dismissal is container state, so it must survive a card change. A banner that came back on
    // every advance would be worse than no banner.
    stubYearApi();
    renderApp(playlistFetch(200, playlistResult({ truncated: true, skippedCount: 2 })));

    startPlaylist();

    await waitFor(() => {
      expect(screen.queryByTestId('notice-banner')).not.toBeNull();
    });
    expect(screen.getByTestId('notice-banner').textContent).toContain('2 tracks');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(screen.queryByTestId('notice-banner')).toBeNull();

    // Advance a card. It must stay gone.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.queryByTestId('notice-banner')).toBeNull();
  });

  it('should not render a notice when nothing applies', async () => {
    // The common case. A banner rendering an empty container would still take layout space above
    // every card for the whole game.
    stubYearApi();
    renderApp(playlistFetch(200, playlistResult()));

    startPlaylist();
    await waitFor(() => {
      expect(screen.queryByTestId('hud')).not.toBeNull();
    });

    expect(screen.queryByTestId('notice-banner')).toBeNull();
  });
});
