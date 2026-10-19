/**
 * Binding half of the logo's hidden triple click: collects clicks into a ref and hands the timing
 * decision to `registerLogoClick` (`src/game/dev-mode.ts`). `Date.now()` rather than
 * `performance.now()` so fake timers drive it in tests.
 *
 * The returned handler is stable as long as `onTriple` is, and a render never resets the sequence.
 */

import { useCallback, useRef } from 'react';
import { registerLogoClick } from '../game/dev-mode';
import type { LogoClickSequence } from '../game/dev-mode';

export function useTripleClick(onTriple: (() => void) | undefined): () => void {
  const sequenceRef = useRef<LogoClickSequence | null>(null);

  return useCallback(() => {
    const result = registerLogoClick(sequenceRef.current, Date.now());
    sequenceRef.current = result.sequence;
    if (result.triggered) onTriple?.();
  }, [onTriple]);
}
