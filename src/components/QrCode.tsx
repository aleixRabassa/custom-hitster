/**
 * A QR code as an `<img>`, generated in the browser from a URL.
 *
 * This is the component the whole product degrades to. If audio is unavailable, if the
 * preview is missing, if the embed scrape breaks tomorrow -- the QR still gets a player to
 * the full song on their phone. plan.md §2 makes it non-negotiable: it renders on every
 * card, unconditionally.
 *
 * ## Three things here are load-bearing
 *
 * **The `alt` text is generic and must stay that way.** An `alt` attribute is read by screen
 * readers and shown when the image fails, which makes it a leak surface exactly like body
 * text. "Scan to play Bohemian Rhapsody in Spotify" would hand the answer to anyone using a
 * screen reader. Nothing derived from the track may appear in any attribute of this
 * component -- see `CardHiddenSide.tsx` for the same rule applied to the controls.
 *
 * **Generation is asynchronous, so a placeholder of the SAME size holds the space.** Without
 * it the card's layout jumps when the code resolves, which is most visible on the card that
 * matters most -- the first one.
 *
 * ## The generated size and the displayed size are two props, and that is Phase 7 decision 4
 *
 * `size` is the bitmap `toDataURL` encodes and it is a FIXED number of pixels. `displaySize` is
 * any CSS length and may be fluid -- `CardHiddenSide` passes a token that tracks the card.
 *
 * Conflating them, which is what this component did through Phase 6, is what would make the code
 * regenerate on every frame of a resize once the card became fluid: `toDataURL` returns a promise,
 * so a viewport-derived generation size would need a debounce, extra state, and would flash the
 * placeholder mid-resize. Downscaling a finished QR in CSS costs nothing instead -- it does not
 * harm scannability, and the error correction level is already `M`.
 *
 * The consequence to preserve: `size` is what the cache key and the generation counter are built
 * from, and `displaySize` must never enter either, or the two come back together.
 *
 * **A superseded result is dropped.** `qrcode` resolves a promise; a fast card advance can
 * therefore resolve the PREVIOUS card's code after the new URL is already on screen. The
 * generation counter below is what stops that from painting the wrong track's code, which
 * would be a leak of a kind (the QR is scannable) and not merely a glitch.
 *
 * The `qrcode` import is deliberately STATIC. Lazy-loading it is an explicit Phase 7 item
 * (`plan.md` §5) and doing it here would mean a second loading state for no measured gain.
 */

import { useEffect, useRef, useState } from 'react';
// A NAMED import, not a default one: `@types/qrcode` declares named exports only, and
// `verbatimModuleSyntax` is on with no `esModuleInterop`, so `import QRCode from 'qrcode'`
// does not typecheck here even though most examples online write it that way.
import { toDataURL } from 'qrcode';

export interface QrCodeProps {
  /** The URL to encode. For a card this is `spotifyTrackUrl(card.id)`. */
  url: string;
  /**
   * The GENERATED bitmap's edge length in pixels.
   *
   * A fixed number, chosen for the largest size the code will ever be shown at. It feeds
   * `toDataURL` and the cache key, so changing it re-encodes; it must never be derived from the
   * viewport. See the header block.
   */
  size: number;
  /**
   * The RENDERED edge length, as any CSS length — a token, a `calc()`, or a plain `px` string.
   *
   * Applied to the image and to the placeholder alike, so the layout is stable across the async
   * generation. Defaults to `size` in pixels, which is the pre-Phase-7 behaviour and what every
   * caller other than `CardHiddenSide` still wants.
   */
  displaySize?: string;
  /**
   * Generic by default and generic in every override. Never interpolate a track title,
   * artist, or year into it.
   */
  alt?: string;
}

const DEFAULT_ALT = 'Scan to play in Spotify';

/** Identifies what a generated code was generated FOR, so a stale one can be spotted. */
function cacheKey(url: string, size: number): string {
  return `${size}|${url}`;
}

export function QrCode({ url, size, displaySize, alt = DEFAULT_ALT }: QrCodeProps) {
  const renderedSize = displaySize ?? `${size}px`;

  /**
   * The generated code TOGETHER WITH the key it belongs to.
   *
   * Storing the key alongside the value is what lets staleness be DERIVED during render
   * instead of cleared by a `setState` in the effect body -- which is both a cascading render
   * and an ESLint error under `react-hooks/set-state-in-effect`. A card advance therefore
   * paints the placeholder on the very first render of the new URL, with no intermediate frame
   * showing the previous card's code.
   */
  const [generated, setGenerated] = useState<{ key: string; dataUrl: string } | null>(null);

  /**
   * Which generation the latest effect run belongs to. A ref rather than state: it is read
   * inside an async continuation and must not itself cause a render.
   *
   * This is NOT made redundant by the derived key above. Without it, a superseded promise
   * resolving late would overwrite a newer, correct result with an older one -- and the derived
   * check would then fall back to the placeholder, throwing away a code that was already
   * right. The counter drops the stale result instead of storing it.
   */
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const key = cacheKey(url, size);

    toDataURL(url, {
      // `margin` is in modules, not pixels. The default of 4 is a lot of white space at
      // card size; 1 keeps the quiet zone valid while the code stays large enough to scan.
      margin: 1,
      width: size,
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        if (generationRef.current !== generation) return;
        setGenerated({ key, dataUrl });
      })
      .catch(() => {
        // A failed generation leaves the placeholder in place. There is nothing useful to
        // say to the player here and nothing to retry -- the input is a URL built from an
        // opaque id, so a failure means the library itself is broken, not the data.
        if (generationRef.current !== generation) return;
        setGenerated(null);
      });
  }, [url, size]);

  // Derived, not stored: a code generated for a different URL or size is not this card's.
  const dataUrl = generated?.key === cacheKey(url, size) ? generated.dataUrl : null;

  if (dataUrl === null) {
    return (
      <div
        aria-hidden="true"
        /*
          `data-motion="qr-placeholder"` is the reduced-motion hook: the block in `src/index.css`
          drops the pulse and keeps the box, because the box's job is to hold the card's layout
          while `toDataURL` resolves and it goes on doing that perfectly well while still.
        */
        data-motion="qr-placeholder"
        className="animate-pulse rounded bg-surface-raised"
        style={{ width: renderedSize, height: renderedSize }}
      />
    );
  }

  return (
    /*
      `width`/`height` carry the BITMAP's size, so the intrinsic dimensions and the aspect ratio
      the browser reserves are the real ones; the inline style is what the code is actually drawn
      at. When `displaySize` is omitted the two agree, which is the pre-Phase-7 behaviour.
    */
    <img
      src={dataUrl}
      alt={alt}
      width={size}
      height={size}
      style={{ width: renderedSize, height: renderedSize }}
      className="rounded bg-white"
    />
  );
}
