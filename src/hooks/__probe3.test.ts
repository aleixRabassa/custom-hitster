/**
 * @vitest-environment jsdom
 * TEMPORARY PROBE — delete after use.
 */

import { describe, expect, it } from 'vitest';

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('re-push inside popstate', () => {
  it('traces positions', async () => {
    window.history.replaceState({ base: true }, '');
    const onPop = () => {
      console.log('  pop: state before repush =', JSON.stringify(window.history.state));
      window.history.pushState({ marker: true }, '');
      console.log('  pop: state after repush  =', JSON.stringify(window.history.state));
    };
    window.addEventListener('popstate', onPop);

    window.history.pushState({ marker: true }, '');
    console.log('mounted, state =', JSON.stringify(window.history.state), 'len', window.history.length);

    for (let i = 1; i <= 3; i += 1) {
      window.history.back();
      await wait(50);
      console.log(`after press ${i}: state =`, JSON.stringify(window.history.state), 'len', window.history.length);
    }

    window.removeEventListener('popstate', onPop);
    window.history.back();
    await wait(50);
    console.log('after cleanup back: state =', JSON.stringify(window.history.state), 'len', window.history.length);

    expect(true).toBe(true);
  });
});
