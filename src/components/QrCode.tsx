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
 * **The image is not draggable.** A native image drag pre-empts pointer events, so pressing the
 * QR and moving would lift a ghost of the code instead of swiping the card -- over most of the
 * hidden face's area. See the attribute's own comment below.
 *
 * **A superseded result is dropped.** `qrcode` resolves a promise; a fast card advance can
 * therefore resolve the PREVIOUS card's code after the new URL is already on screen. The
 * generation counter below is what stops that from painting the wrong track's code, which
 * would be a leak of a kind (the QR is scannable) and not merely a glitch.
 *
 * ## The `qrcode` import is DYNAMIC, and it costs no loading state
 *
 * ===========================================================================
 *  MEASURED BEFORE AND AFTER, 2026-08-06.
 *
 *  `qrcode` (plus its `dijkstrajs` dependency) is 23.28 kB of a 373.39 kB
 *  single-chunk bundle -- attributed by decoding the build's own source map. It
 *  is needed only once a deck has been dealt, and the LANDING SCREEN, which is
 *  every visitor's first paint, was downloading a QR encoder it never calls.
 *
 *  The comment that used to sit here said lazy-loading "would mean a second
 *  loading state for no measured gain". Both halves are now answered. There is
 *  no second loading state, because the import joins an await THAT ALREADY
 *  EXISTS -- generation was always asynchronous and the same-size placeholder
 *  below has always covered that window, so a chunk fetch simply widens a gap
 *  the layout already handled. And the gain is the number above.
 *
 *  This is why it is a dynamic `import()` rather than `React.lazy` on the
 *  component: `lazy` would stack a `Suspense` fallback on top of a placeholder
 *  that already exists, inside one 176px square (decision 8).
 * ===========================================================================
 */

import { useEffect, useRef, useState } from 'react';

import { qrCacheKey, readQrCache, writeQrCache } from '../game/qr-cache';
import { loadQrcode } from '../game/qrcode-loader';

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

/**
 * The memoized `import('qrcode')` moved to `src/game/qrcode-loader.ts` on 2026-08-06, when the PDF
 * export became a second consumer of the same chunk. Everything that made it memoized -- including
 * the overlapping-imports race measured in this component -- is documented there.
 */

/**
 * ## A generated code outlives the element that generated it (2026-08-06)
 *
 * ===========================================================================
 *  THE MODULE-LEVEL CACHE IN `src/game/qr-cache.ts` IS WHAT MAKES THE DECK'S
 *  PRELOAD WORTH ANYTHING, AND IT HAS TO BE READ DURING RENDER.
 *
 *  `CardStack` now renders the next card's hidden face behind the current one,
 *  so its code is generated early. But the back and the front card are DIFFERENT
 *  elements -- a plain div in `CardStack` versus a `Card` inside an
 *  `AnimatePresence` keyed on card id -- and an advance unmounts one and mounts
 *  the other. Per-element state therefore throws the preloaded code away at
 *  exactly the moment it was preloaded for.
 *
 *  Reading the shared cache in an EFFECT would not fix it either: `useEffect`
 *  runs after paint, so the new front card would still paint the pulsing
 *  placeholder for one frame. The read below is a pure lookup of a write-once
 *  map, which is the standard resource-cache shape and is safe to do while
 *  rendering.
 * ===========================================================================
 */

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
    const key = qrCacheKey(url, size);

    /*
      Already generated -- by the card behind this one, or by this card before a remount. The
      render below reads the same cache, so there is nothing to set and nothing to await.

      The counter is bumped FIRST, before the early return: a slower generation for a previous
      url may still be in flight on this element, and bailing without claiming a generation
      would let it resolve and store its result over a card that has already moved on.
    */
    if (readQrCache(key) !== null) return;

    /*
      The library and the code it generates are awaited as ONE chain, so the generation counter
      guards both halves with the same check -- a chunk that resolves late is dropped exactly as a
      slow `toDataURL` is. That matters more here than before the split: the import widens the
      window in which a card can be superseded, which makes the race more likely rather than
      different in kind.

      A NAMED import, not a default one: `@types/qrcode` declares named exports only, and
      `verbatimModuleSyntax` is on with no `esModuleInterop`, so `qrcode`'s default does not
      typecheck even though most examples online write it that way.
    */
    loadQrcode()
      .then(({ toDataURL }) =>
        toDataURL(url, {
          // `margin` is in modules, not pixels. The default of 4 is a lot of white space at
          // card size; 1 keeps the quiet zone valid while the code stays large enough to scan.
          margin: 1,
          width: size,
          errorCorrectionLevel: 'M',
        }),
      )
      .then((dataUrl) => {
        /*
          Cached BEFORE the staleness check, and deliberately. A superseded generation produced a
          perfectly good code for the url it was asked about -- it is only wrong for the element
          that is now showing something else. Throwing it away would mean regenerating it when
          that card comes round, which on a fast advance is the common case.
        */
        writeQrCache(key, dataUrl);

        if (generationRef.current !== generation) return;
        setGenerated({ key, dataUrl });
      })
      .catch(() => {
        // A failed generation leaves the placeholder in place. There is nothing useful to
        // say to the player here and nothing to retry -- the input is a URL built from an
        // opaque id, so a failure means the library itself is broken, not the data.
        //
        // This now also covers a FAILED CHUNK FETCH, which is a real case rather than a
        // theoretical one: a flaky connection mid-game means the import rejects instead of the
        // generation. Same outcome, same place, and the card stays playable -- the reveal and the
        // audio do not depend on this component.
        if (generationRef.current !== generation) return;
        setGenerated(null);
      });
  }, [url, size]);

  /*
    Derived, not stored: a code generated for a different URL or size is not this card's.

    The cache is the second source, and it is what removes the placeholder frame on a card
    advance -- this element may be mounting for the first time onto a url whose code another
    element already generated. Own state first, because it is the fresher of two writers to the
    same key.
  */
  const key = qrCacheKey(url, size);
  const dataUrl = generated?.key === key ? generated.dataUrl : readQrCache(key);

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
      /*
        ===========================================================================
         `draggable={false}` IS A SWIPE FIX, NOT A STYLE CHOICE.

         An `<img>` is natively draggable, and the browser's native image drag wins
         over pointer events: pressing on the QR and moving lifts a translucent
         ghost of the code, `pointercancel` fires, and the card never moves. Since
         the QR fills most of the hidden face, that is most of the card's swipe
         surface -- the deck reads as broken exactly where a player is most likely
         to put a thumb.

         `select-none` closes the same hole for the mouse: without it a drag across
         the card starts a text selection instead, which also steals the gesture.

         Neither has any effect on scanning -- a phone camera reads pixels, not the
         drag API.
        ===========================================================================
      */
      draggable={false}
      style={{ width: renderedSize, height: renderedSize }}
      className="rounded bg-white select-none"
    />
  );
}
