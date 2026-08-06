/**
 * @vitest-environment jsdom
 *
 * One case, and it needs a file of its own: what the card does when the `qrcode` CHUNK never
 * arrives.
 *
 * ===========================================================================
 *  WHY THIS IS NOT IN `QrCode.test.tsx`.
 *
 *  Phase 7 moved `qrcode` behind a dynamic `import()` and `QrCode.tsx` MEMOIZES
 *  that promise -- one shared load for every card, and a rejected load stays
 *  rejected rather than being retried per advance (see its header block for why
 *  retrying would be worse). A settled promise cannot be un-settled, so a file
 *  whose other tests load the library successfully can never afterwards observe
 *  a failed load. Flipping a flag plus `vi.resetModules()` was tried on
 *  2026-08-06 and does not work: the mocker hands back the module it already
 *  built, and the test silently asserts against a working library.
 *
 *  So the mock factory here ALWAYS throws, which is exactly what a failed chunk
 *  fetch looks like from the call site: the `import()` rejects rather than the
 *  generation.
 * ===========================================================================
 *
 * The case is real rather than theoretical. A flaky connection mid-game -- the same one the year
 * resolver retries through -- means the browser fails to fetch this chunk, and that has to land in
 * the same place a failed generation lands: placeholder held, no image, nothing thrown. The card
 * stays fully playable, because neither the reveal nor the audio goes through this component.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QrCode } from './QrCode';

const { toDataURLMock } = vi.hoisted(() => ({
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => {
  // Never reached, and asserted below: the point is that generation is not attempted at all when
  // the library is missing. The export exists only so the shape of the mock is honest.
  void toDataURLMock;
  throw new Error('Failed to fetch dynamically imported module: /assets/browser-DFBgVuWK.js');
});

describe('QrCode when the library fails to load', () => {
  // Required in every DOM file here: Testing Library registers no auto-cleanup because this repo
  // imports `describe`/`it`/`expect` explicitly rather than enabling Vitest globals.
  afterEach(cleanup);

  it('should keep the placeholder when the library fails to load', async () => {
    render(<QrCode url="https://open.spotify.com/track/x" size={160} />);

    // A macrotask turn, so the rejected import and the component's `.catch` have both settled.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole('img')).toBeNull();
    // Never called: there was no library to call it on. This is what distinguishes this case from
    // "generation rejected", which is covered in `QrCode.test.tsx`.
    expect(toDataURLMock).not.toHaveBeenCalled();

    /*
      The box is still holding the card's layout at the right size, which is its OTHER job and the
      one that does not depend on a code ever arriving. A collapsed placeholder here would shrink
      the hidden face of every card for the rest of the session.
    */
    const placeholder = document.querySelector('[data-motion="qr-placeholder"]') as HTMLElement;
    expect(placeholder).not.toBeNull();
    expect(placeholder.style.width).toBe('160px');
    expect(placeholder.style.height).toBe('160px');
  });

  it('should not surface the failure as text on the card', async () => {
    // The hidden face must leak nothing, and an error message is text like any other -- but the
    // sharper reason is that a chunk URL or a stack on the card is noise the player cannot act on.
    // Silence is the designed behaviour here, so it is asserted rather than assumed.
    const { container } = render(<QrCode url="https://open.spotify.com/track/x" size={160} />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toBe('');
  });
});
