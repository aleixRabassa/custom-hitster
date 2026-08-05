/**
 * @vitest-environment jsdom
 *
 * The notices are three independent booleans in one banner, and the common case is that none of them
 * applies -- so "renders nothing" is as much a requirement as any of the messages.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoticeBanner } from './NoticeBanner';
import { MAX_EMBED_TRACKS } from '../../shared/constants';

function renderBanner(props: Partial<Parameters<typeof NoticeBanner>[0]> = {}) {
  const onDismiss = props.onDismiss ?? vi.fn();
  const rendered = render(
    <NoticeBanner
      truncated={props.truncated ?? false}
      skippedCount={props.skippedCount ?? 0}
      yearLookupsUnavailable={props.yearLookupsUnavailable ?? false}
      onDismiss={onDismiss}
    />,
  );

  return { ...rendered, onDismiss };
}

describe('NoticeBanner', () => {
  afterEach(cleanup);

  it('should render nothing when no notice applies', () => {
    // The COMMON case: a playlist under 100 tracks, nothing skipped, years working. A banner that
    // rendered an empty container here would still take layout space above every card.
    const { container } = renderBanner();

    expect(container.firstChild).toBeNull();
  });

  it('should render the truncation notice only when truncated', () => {
    renderBanner({ truncated: true });

    const text = screen.getByTestId('notice-banner').textContent ?? '';
    // The number comes from the shared constant, so the copy cannot drift from the actual cap.
    expect(text).toContain(String(MAX_EMBED_TRACKS));
    // "MAY have more" -- it cannot promise more than that, because the payload carries no total,
    // no offset and no `hasMore`, so 100 tracks returned is indistinguishable from 100 tracks held.
    expect(text).toMatch(/may have more/i);

    cleanup();
    renderBanner({ truncated: false });
    expect(screen.queryByTestId('notice-banner')).toBeNull();
  });

  it('should render the skipped-track notice only when the count is above zero', () => {
    // Normally 0, so normally nothing renders -- which is why the zero case is asserted rather than
    // assumed.
    renderBanner({ skippedCount: 0 });
    expect(screen.queryByTestId('notice-banner')).toBeNull();

    cleanup();
    renderBanner({ skippedCount: 3 });
    expect(screen.getByTestId('notice-banner').textContent).toContain('3 tracks');
  });

  it('should use the singular for exactly one skipped track', () => {
    // "1 tracks could not be read" undermines a message about data quality.
    renderBanner({ skippedCount: 1 });

    const text = screen.getByTestId('notice-banner').textContent ?? '';
    expect(text).toContain('1 track could not be read');
    expect(text).not.toContain('1 tracks');
  });

  it('should render the years-unavailable notice from game state', () => {
    // The misconfigured deployment: no `MUSICBRAINZ_USER_AGENT`, so no card will ever get a year.
    // The one notice derived from game state rather than from the fetch.
    renderBanner({ yearLookupsUnavailable: true });

    const text = (screen.getByTestId('notice-banner').textContent ?? '').toLowerCase();
    expect(text).toContain('years are unavailable');
    // And it must say the deck still works, because it does -- the QR is always live.
    expect(text).toContain('still playable');
  });

  it('should render all three notices together', () => {
    // They are independent, so all three can apply at once and the banner must not pick one.
    renderBanner({ truncated: true, skippedCount: 2, yearLookupsUnavailable: true });

    expect(screen.getByTestId('notice-banner').querySelectorAll('li')).toHaveLength(3);
  });

  it('should invoke the dismiss callback', () => {
    // Dismissal is CONTAINER state (decision 9), so this component only reports the click. That
    // split is what stops the banner reappearing on every card.
    const { onDismiss } = renderBanner({ truncated: true });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should never gate anything: it renders no confirm or blocking control', () => {
    // No notice here may ever gate Start. Every one of them describes a deck that is already dealt
    // and already playable, so the only control is dismissal.
    renderBanner({ truncated: true, skippedCount: 2, yearLookupsUnavailable: true });

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual(['Dismiss notice']);
  });
});
