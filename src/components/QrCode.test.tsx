/**
 * @vitest-environment jsdom
 *
 * `qrcode` is mocked throughout, for two reasons rather than one. The obvious one is
 * control: the superseded-url test needs to resolve two generations out of order, which no
 * real library will do on request. The less obvious one is that the real `qrcode` browser
 * build draws through `<canvas>`, and jsdom does not implement canvas -- so a test using the
 * real thing would fail for a reason that has nothing to do with this component.
 *
 * The mock encodes the input into its fake data URL, so "the image source encodes the given
 * URL" is a literal assertion rather than a proxy for one.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QrCode } from './QrCode';
import { highConfidenceCard } from './__fixtures__/cards';

const { toDataURLMock } = vi.hoisted(() => ({
  // `vi.hoisted` is required: `vi.mock`'s factory is hoisted above ordinary `const`
  // declarations, so referencing a plain const inside it throws a TDZ error at import time.
  toDataURLMock: vi.fn<(text: string, options?: unknown) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({ toDataURL: toDataURLMock }));

/** A fake data URL that carries its input, so a test can read the encoded value back out. */
function fakeDataUrl(text: string): string {
  return `data:image/png;base64,QR(${text})`;
}

describe('QrCode', () => {
  beforeEach(() => {
    toDataURLMock.mockReset();
    toDataURLMock.mockImplementation((text) => Promise.resolve(fakeDataUrl(text)));
  });

  /**
   * EXPLICIT, and required. Testing Library auto-registers its own `afterEach(cleanup)` only
   * when Vitest's `globals` are enabled; this repo imports `describe`/`it`/`expect` from
   * `vitest` instead, so nothing unmounts between tests and every previous render stays in
   * `document.body`. The symptom is bizarre -- "found multiple elements with the role img",
   * or an assertion passing against the PREVIOUS test's DOM -- so it looks like a component
   * bug rather than missing teardown. Every DOM test file in this repo carries this line.
   */
  afterEach(cleanup);

  it('should render an image whose source encodes the given URL', async () => {
    const url = 'https://open.spotify.com/track/3z8h0TU7ReDPLIbEnYhWZb';
    render(<QrCode url={url} size={160} />);

    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toBe(fakeDataUrl(url));
    expect(toDataURLMock).toHaveBeenCalledWith(url, expect.anything());
  });

  it('should hold a same-sized placeholder until the code resolves', () => {
    // Generation is async, so the very first paint has no image. The placeholder must
    // occupy the final dimensions or the card's layout jumps when the code arrives.
    render(<QrCode url="https://open.spotify.com/track/x" size={160} />);

    expect(screen.queryByRole('img')).toBeNull();
    const placeholder = document.querySelector('[aria-hidden="true"]');
    expect(placeholder).not.toBeNull();
    expect((placeholder as HTMLElement).style.width).toBe('160px');
    expect((placeholder as HTMLElement).style.height).toBe('160px');
  });

  it('should not include the track title or artist in any attribute', async () => {
    // The alt text is the leak surface here: a screen reader reads it, and so does anyone
    // whose image fails to load. Assert over EVERY attribute, not just alt, because the
    // rule is about the whole element.
    render(<QrCode url={`https://open.spotify.com/track/${highConfidenceCard.id}`} size={160} />);

    const image = await screen.findByRole('img');
    for (const attribute of Array.from(image.attributes)) {
      expect(attribute.value).not.toContain(highConfidenceCard.title);
      expect(attribute.value).not.toContain(highConfidenceCard.artist);
      expect(attribute.value).not.toContain(String(highConfidenceCard.year));
    }

    expect(image.getAttribute('alt')).toBe('Scan to play in Spotify');
  });

  it('should regenerate when the url prop changes', async () => {
    const first = 'https://open.spotify.com/track/aaaaaaaaaaaaaaaaaaaaaa';
    const second = 'https://open.spotify.com/track/bbbbbbbbbbbbbbbbbbbbbb';

    const { rerender } = render(<QrCode url={first} size={160} />);
    expect((await screen.findByRole('img')).getAttribute('src')).toBe(fakeDataUrl(first));

    rerender(<QrCode url={second} size={160} />);
    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(fakeDataUrl(second));
    });

    expect(toDataURLMock).toHaveBeenCalledTimes(2);
  });

  it('should ignore a resolved code for a superseded url', async () => {
    // The fast-advance race: card 1's generation resolves AFTER card 2 is already on
    // screen. Painting it would put the previous track's scannable code on the new card.
    const slow = 'https://open.spotify.com/track/slowslowslowslowslowsl';
    const fast = 'https://open.spotify.com/track/fastfastfastfastfastfa';

    let resolveSlow: (value: string) => void = () => {};
    toDataURLMock.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSlow = resolve;
        }),
    );

    const { rerender } = render(<QrCode url={slow} size={160} />);
    rerender(<QrCode url={fast} size={160} />);

    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(fakeDataUrl(fast));
    });

    // Card 1's code finally arrives, long after its card is gone.
    resolveSlow(fakeDataUrl(slow));
    await Promise.resolve();

    expect(screen.getByRole('img').getAttribute('src')).toBe(fakeDataUrl(fast));
  });

  it('should keep the placeholder when generation fails', async () => {
    // Nothing useful to say to the player and nothing to retry: the input is a URL built
    // from an opaque id, so a rejection means the library is broken, not the data.
    toDataURLMock.mockImplementation(() => Promise.reject(new Error('boom')));

    render(<QrCode url="https://open.spotify.com/track/x" size={160} />);

    await waitFor(() => {
      expect(toDataURLMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
