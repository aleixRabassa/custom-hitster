/**
 * @vitest-environment jsdom
 *
 * The crash screen, and the leak rule that governs it.
 *
 * ===========================================================================
 *  THE MOST IMPORTANT TEST IN THIS FILE IS THE ONE ABOUT WHAT IS *NOT*
 *  RENDERED.
 *
 *  `ErrorBoundary` catches everything below `<App />`, and the deck is down
 *  there -- so an error's message can quote a track title, an artist or a year,
 *  and a stack can carry a serialized prop. Rendering the message is the natural
 *  next change somebody makes to a crash screen ("so the player can report it"),
 *  and it would turn this surface into a spoiler. So a test throws an error whose
 *  message contains a real fixture card's title, artist and year, and asserts
 *  none of the three reaches the document.
 *
 *  Same family as the hidden-side assertions in `CardHiddenSide.test.tsx` and
 *  `CardStack.test.tsx`.
 * ===========================================================================
 *
 * ## `console.error` is silenced per test, deliberately not globally
 *
 * React logs every error a boundary catches, and this file's whole job is to make errors happen --
 * so an un-silenced run buries the real output under stack traces and looks like a broken suite.
 * The spy is installed and restored around each case rather than in a global setup file, because
 * suppressing React's error logging repo-wide would hide a genuine crash in an unrelated test. The
 * boundary's OWN log is asserted in one case, which is what stops the silencing from also hiding
 * the fact that the log exists at all.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';
import { highConfidenceCard } from './__fixtures__/cards';
import { SESSION_STORAGE_KEY, SESSION_VERSION } from '../game/persistence';
import type { StorageLike } from '../game/persistence';

/** A child that throws during render, which is the only thing a boundary can catch. */
function Exploding({ message }: { message: string }): never {
  throw new Error(message);
}

/** An in-memory `StorageLike`, the same three-line double `persistence.ts`'s own tests use. */
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

/** A save that exists, so "was it cleared" is a real question rather than a vacuous one. */
function seededStorage(): StorageLike & { map: Map<string, string> } {
  const storage = memoryStorage();
  storage.map.set(SESSION_STORAGE_KEY, JSON.stringify({ version: SESSION_VERSION }));

  return storage;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should render children unchanged when nothing throws', () => {
    // Cheap, and it catches a boundary that renders its fallback unconditionally -- which would
    // replace the entire app with a crash screen and pass every other test in this file.
    render(
      <ErrorBoundary>
        <p>the game</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('the game')).not.toBeNull();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('should render fallback copy when a child throws', () => {
    render(
      <ErrorBoundary>
        <Exploding message="boom" />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: /something went wrong/i })).not.toBeNull();
    // Both recovery paths are offered. A crash screen with no way out is a white page with text.
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Start over' })).not.toBeNull();
  });

  it('should not render the error message or stack', () => {
    // ===================================================================
    //  THE LEAK TEST. See the header block.
    //
    //  The message is built from a REAL fixture card, so this asserts
    //  against the exact strings the game would put in front of a player if
    //  the crash screen ever started quoting what it caught.
    // ===================================================================
    const message = `Invalid year ${String(highConfidenceCard.year)} for ${highConfidenceCard.title} by ${highConfidenceCard.artist}`;

    const { container } = render(
      <ErrorBoundary>
        <Exploding message={message} />
      </ErrorBoundary>,
    );

    // `innerHTML`, not `textContent`: an attribute, a `title` or a `data-*` carrying the message
    // would leak just as effectively as body text, and only this catches those.
    const html = container.innerHTML;
    expect(html).not.toContain(highConfidenceCard.title);
    expect(html).not.toContain(highConfidenceCard.artist);
    expect(html).not.toContain(String(highConfidenceCard.year));
    expect(html).not.toContain(message);
    // Not the word either -- "Error: …" is how a rendered message usually announces itself.
    expect(container.textContent).not.toContain('Invalid year');
  });

  it('should log the error to the console for a developer', () => {
    // The counterpart to not rendering it: the detail has to go SOMEWHERE, and a console is not a
    // rendered surface. Without this, silencing `console.error` above would also hide the fact
    // that the boundary swallows everything it catches.
    render(
      <ErrorBoundary>
        <Exploding message="diagnostic detail" />
      </ErrorBoundary>,
    );

    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain('[error-boundary]');
    expect(logged).toContain('diagnostic detail');
  });

  it('should clear the saved session when Start over is pressed', () => {
    // ===================================================================
    //  WHY THIS BUTTON EXISTS AT ALL: a corrupt persisted session is the
    //  most plausible cause of a crash that recurs on every reload, and
    //  Reload alone cannot escape it -- the app would load the same bad
    //  save and crash again, forever, with devtools the only way out.
    // ===================================================================
    const storage = seededStorage();
    const reload = vi.fn();

    render(
      <ErrorBoundary storage={storage} reload={reload}>
        <Exploding message="boom" />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));

    expect(storage.map.has(SESSION_STORAGE_KEY)).toBe(false);
    // And it still reloads: clearing the save without reloading would leave the crash screen up
    // with no session behind it.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('should not clear the saved session when Reload is pressed', () => {
    // The distinction between the two buttons, and without this test they can silently become one.
    // Reload is for a transient failure, so a player mid-deck lands back in the deck they were on.
    const storage = seededStorage();
    const reload = vi.fn();

    render(
      <ErrorBoundary storage={storage} reload={reload}>
        <Exploding message="boom" />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(storage.map.has(SESSION_STORAGE_KEY)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('should say what Start over costs', () => {
    // The consequence is written next to the button rather than inside it, so the assertion is over
    // the screen rather than the label. A player who has just been shown a crash screen is not
    // reading carefully, and "Start over" alone does not say that a game in progress is destroyed.
    render(
      <ErrorBoundary>
        <Exploding message="boom" />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toMatch(/game in progress is lost/i);
  });

  it('should announce itself rather than only draw', () => {
    // A crash replaces the whole page with no keystroke and no focus change, so without a live
    // region a screen-reader user is left on a page that silently became something else.
    render(
      <ErrorBoundary>
        <Exploding message="boom" />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).not.toBeNull();
  });
});
