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

  it('should not be draggable, so a swipe starting on the code moves the card', async () => {
    // The QR covers most of the hidden face, and an `<img>` is natively draggable: the browser's
    // image drag pre-empts the pointer sequence, so pressing here and moving lifted a ghost of
    // the code and cancelled the swipe. jsdom fires no native drag, so this pins the ATTRIBUTE
    // rather than the behaviour -- the browser half is one swipe starting on the code.
    render(<QrCode url="https://open.spotify.com/track/x" size={160} />);

    const image = await screen.findByRole('img');
    expect(image.getAttribute('draggable')).toBe('false');
    // Same hole for the mouse: a drag across the card must not start a text selection either.
    expect(image.className).toContain('select-none');
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

  it('should render at the display size while generating at the fixed bitmap size', async () => {
    // ===================================================================
    //  THE TWO SIZES MUST STAY TWO SIZES. Phase 7 decision 4.
    //
    //  Through Phase 6 one `size` prop was both the generated bitmap and
    //  the rendered box. Once the card became fluid, keeping them
    //  conflated would mean `toDataURL` -- which returns a PROMISE -- being
    //  called again on every frame of a resize: a debounce, extra state,
    //  and the placeholder flashing mid-drag.
    //
    //  So the assertion is that the two travel separately. The generation
    //  call sees the fixed pixel count; the element carries the fluid CSS
    //  length. Conflating them again fails here.
    // ===================================================================
    const url = 'https://open.spotify.com/track/3z8h0TU7ReDPLIbEnYhWZb';
    const display = 'var(--qr-display-size)';

    render(<QrCode url={url} size={176} displaySize={display} />);

    // The placeholder holds the DISPLAY size, so the card's layout is stable across the async gap.
    const placeholder = document.querySelector('[data-motion="qr-placeholder"]');
    expect(placeholder).not.toBeNull();
    expect((placeholder as HTMLElement).style.width).toBe(display);

    const image = await screen.findByRole('img');
    // Generation got the BITMAP size and nothing else. `width` in the options is what `qrcode`
    // encodes at, and it must be the fixed number rather than the CSS length.
    expect(toDataURLMock).toHaveBeenCalledWith(url, expect.objectContaining({ width: 176 }));
    expect(toDataURLMock).toHaveBeenCalledTimes(1);

    // The element carries BOTH: the attributes are the intrinsic bitmap dimensions, so the browser
    // reserves the right aspect ratio, and the inline style is what it is actually drawn at.
    expect(image.getAttribute('width')).toBe('176');
    expect(image.getAttribute('height')).toBe('176');
    expect((image as HTMLElement).style.width).toBe(display);
    expect((image as HTMLElement).style.height).toBe(display);
  });

  it('should fall back to the bitmap size when no display size is given', () => {
    // The pre-Phase-7 behaviour, and what every caller other than `CardHiddenSide` still wants.
    // Asserted so that making `displaySize` required — or defaulting it to something fluid — does
    // not silently change what a bare `<QrCode url size>` renders.
    render(<QrCode url="https://open.spotify.com/track/x" size={160} />);

    const placeholder = document.querySelector('[data-motion="qr-placeholder"]') as HTMLElement;
    expect(placeholder.style.width).toBe('160px');
    expect(placeholder.style.height).toBe('160px');
  });

  it('should expose the reduced-motion hook on the placeholder', () => {
    // The component half of a contract with `src/index.css`, which drops the pulse and keeps the
    // box under `prefers-reduced-motion: reduce`. jsdom evaluates no media query, so the CSS half
    // is the canary in `src/index.css.test.ts`; renaming the attribute in one file and not the
    // other is what this catches.
    render(<QrCode url="https://open.spotify.com/track/x" size={160} />);

    const placeholder = document.querySelector('[data-motion="qr-placeholder"]');
    expect(placeholder).not.toBeNull();
    // The pulse is still declared -- reduced motion removes it, it is not absent by default.
    expect((placeholder as HTMLElement).className).toContain('animate-pulse');
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
