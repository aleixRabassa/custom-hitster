/**
 * @vitest-environment jsdom
 *
 * The notices are five independent conditions in one banner, and the common case is that none of
 * them applies -- so "renders nothing" is as much a requirement as any of the messages.
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
      failedPlaylistCount={props.failedPlaylistCount ?? 0}
      deckSize={props.deckSize ?? 0}
      // Defaults to zero rather than one, so the combined-deck line is opt-in per test. The
      // container passes the real count; a test that does not care gets no line.
      loadedPlaylistCount={props.loadedPlaylistCount ?? 0}
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

  it('should render all five notices together', () => {
    // They are independent, so all five can apply at once and the banner must not pick one. A
    // five-playlist deck with a dead playlist, a truncated one and no year lookups is the worst
    // realistic case, and it is still a list of footnotes rather than a blocker.
    renderBanner({
      truncated: true,
      skippedCount: 2,
      failedPlaylistCount: 1,
      deckSize: 240,
      loadedPlaylistCount: 4,
      yearLookupsUnavailable: true,
    });

    expect(screen.getByTestId('notice-banner').querySelectorAll('li')).toHaveLength(5);
  });

  it('should report one playlist that could not be loaded', () => {
    // The visible half of "a playlist that fails is dropped with a count, and only a TOTAL failure
    // blocks Start": one private or deleted playlist among five costs a line, not the deck.
    renderBanner({ failedPlaylistCount: 1, deckSize: 180, loadedPlaylistCount: 4 });

    const text = screen.getByTestId('notice-banner').textContent ?? '';
    expect(text).toContain('1 playlist could not be loaded and was left out.');
    // Singular throughout, because "1 playlists ... were left out" undermines the sentence.
    expect(text).not.toContain('1 playlists');
  });

  it('should report several playlists that could not be loaded', () => {
    renderBanner({ failedPlaylistCount: 3, deckSize: 90, loadedPlaylistCount: 2 });

    expect(screen.getByTestId('notice-banner').textContent).toContain(
      '3 playlists could not be loaded and were left out.',
    );
  });

  it('should report the deck size and playlist count', () => {
    // The "say the size out loud" half of the no-cap decision (plan 1, decision 12): five playlists
    // can merge to several hundred cards, and a count is safe on a pre-reveal surface.
    renderBanner({ deckSize: 214, loadedPlaylistCount: 3 });

    expect(screen.getByTestId('notice-banner').textContent).toContain(
      '214 cards from 3 playlists, shuffled into one deck.',
    );
  });

  it('should render nothing for a single successful playlist', () => {
    /*
      THE SINGLE-PLAYLIST SCREEN IS UNCHANGED BY THIS WHOLE FEATURE. One playlist that loaded, no
      failures, nothing truncated or skipped: the deck size was never worth a line before
      multi-playlist and saying it now would put a banner on a screen that had none.
    */
    const { container } = renderBanner({ deckSize: 42, loadedPlaylistCount: 1 });

    expect(container.firstChild).toBeNull();
  });

  it('should not name a playlist that failed', () => {
    /*
      COUNT ONLY (decision 7). A playlist title is safe data -- the suggestions render nine of them
      -- but the failures are ordered by the ROW they came from and the rows are gone by the time
      this renders, so a name here is information the player cannot act on. This asserts the
      component has no way to receive one: a name would have to arrive as a prop.
    */
    renderBanner({ failedPlaylistCount: 2, deckSize: 60, loadedPlaylistCount: 3 });

    const text = screen.getByTestId('notice-banner').textContent ?? '';
    expect(text).toContain('2 playlists could not be loaded');
    // No quoting, no colon-then-list: the shapes a name would arrive in.
    expect(text).not.toMatch(/["“”]/);
    expect(text).not.toContain('left out:');
  });

  it('should invoke the dismiss callback', () => {
    // Dismissal is CONTAINER state (decision 9), so this component only reports the click. That
    // split is what stops the banner reappearing on every card.
    const { onDismiss } = renderBanner({ truncated: true });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should give the dismiss control a focus-visible style and a touch target', () => {
    // Dismiss was the SMALLEST target in the app -- `px-1` around a single ✕ -- and it sits above
    // the card, which is the surface a thumb is nearest while swiping. Of everywhere the
    // touch-target minimum was applied, this is the one that was most likely to be missed by a
    // real finger and hit by accident mid-gesture.
    //
    // Class-name level, with the caveat given in full in `LandingScreen.test.tsx`.
    renderBanner({ truncated: true });

    const dismiss = screen.getByRole('button', { name: 'Dismiss notice' });
    expect(dismiss.className).toContain('touch-target');
    expect(dismiss.className).toContain('focus-visible:focus-ring');
  });

  it('should match the card width rather than a content column', () => {
    // This banner sits directly above the card. It was `max-w-sm` (24rem) against a card of `w-72`
    // (18rem), so on any viewport wide enough for either to reach its cap it overhung the deck by
    // 3rem on each side. Sharing `--card-width` is what makes them agree at every viewport instead
    // of at none. `Hud` does the same, for the same reason.
    renderBanner({ truncated: true });

    const banner = screen.getByTestId('notice-banner');
    expect(banner.className).toContain('max-w-(--card-width)');
    expect(banner.className).not.toContain('max-w-sm');
  });

  it('should never gate anything: it renders no confirm or blocking control', () => {
    // No notice here may ever gate Start. Every one of them describes a deck that is already dealt
    // and already playable, so the only control is dismissal.
    renderBanner({
      truncated: true,
      skippedCount: 2,
      failedPlaylistCount: 1,
      deckSize: 240,
      loadedPlaylistCount: 4,
      yearLookupsUnavailable: true,
    });

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual(['Dismiss notice']);
  });
});
