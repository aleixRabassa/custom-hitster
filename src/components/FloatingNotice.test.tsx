/**
 * @vitest-environment jsdom
 *
 * jsdom computes no layout, so the classes are what is observable: the slot is out of flow
 * (`absolute`) on the anchor's top edge (`bottom-full`), and the anchor is the positioned parent.
 * `GameScreen.test.tsx` and `PreparingScreen.test.tsx` assert which block each screen anchors to.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FloatingNotice } from './FloatingNotice';

describe('FloatingNotice', () => {
  afterEach(() => {
    cleanup();
  });

  it('should float the notice above its children, out of the flow', () => {
    render(
      <FloatingNotice notice={<p data-testid="test-notice" />} gap="mb-3">
        <div data-testid="anchored" />
      </FloatingNotice>,
    );

    const slot = screen.getByTestId('notice-slot');
    expect(slot.contains(screen.getByTestId('test-notice'))).toBe(true);
    expect(slot.className).toContain('absolute');
    expect(slot.className).toContain('bottom-full');
    expect(slot.className).toContain('mb-3');

    const anchor = slot.parentElement;
    expect(anchor?.className).toContain('relative');
    expect(anchor?.contains(screen.getByTestId('anchored'))).toBe(true);
  });

  it('should render only its children when there is no notice', () => {
    render(
      <FloatingNotice gap="mb-4">
        <div data-testid="anchored" />
      </FloatingNotice>,
    );

    expect(screen.queryByTestId('notice-slot')).toBeNull();
    expect(screen.queryByTestId('anchored')).not.toBeNull();
  });
});
