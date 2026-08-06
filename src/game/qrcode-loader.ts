/**
 * The one shared, memoized `import('qrcode')`.
 *
 * ===========================================================================
 *  ONE LOADER, BECAUSE THERE IS ONE CHUNK AND ONE SETTLED PROMISE.
 *
 *  Extracted from `QrCode.tsx` when `usePdfExport` became a second consumer
 *  (2026-08-06). Two files each holding their own `let module: Promise | null`
 *  would load the same chunk twice on the export path -- and, worse, would make
 *  "a rejected load stays rejected" true per file rather than per app.
 *
 *  MEMOIZED, AND IT IS NOT A MICRO-OPTIMISATION. `QrCode`'s effect re-runs on
 *  every card advance, so a bare `import()` in its body issues a fresh import
 *  call per card -- and TWO OF THEM OVERLAP whenever a card is superseded before
 *  its code resolves, which is exactly the fast-advance race the component's
 *  generation counter exists for. Measured 2026-08-06: with two imports in flight
 *  at once under Vitest's module mocker, the SECOND one's continuation never ran,
 *  so the new card kept the old card's placeholder forever. One shared promise
 *  makes every later caller await the already-settled load instead.
 *
 *  A REJECTED LOAD STAYS CACHED, deliberately. A chunk that failed to fetch will
 *  fail again on the next card, and retrying it per advance would be a request
 *  loop on exactly the flaky connection that broke it. The consequence is that a
 *  session which loses this chunk keeps the QR placeholder for the rest of the
 *  game -- and stays fully playable, because the reveal and the audio do not go
 *  through it. It is also why the load-failure case has its own test file: once
 *  this promise is settled, nothing in a process can un-settle it.
 * ===========================================================================
 */

let qrcodeModule: Promise<typeof import('qrcode')> | null = null;

export function loadQrcode(): Promise<typeof import('qrcode')> {
  qrcodeModule ??= import('qrcode');

  return qrcodeModule;
}
