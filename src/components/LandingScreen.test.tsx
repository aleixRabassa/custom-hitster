/**
 * @vitest-environment jsdom
 *
 * The landing screen's job is to reject what the server would reject anyway, submit what it cannot
 * judge, and never say anything about a deck. All three are asserted below.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LandingScreen, SUGGESTED_PLAYLISTS } from './LandingScreen';
import { fixtureDeck } from './__fixtures__/cards';
import { PLAYLIST_ERROR_MESSAGES } from '../game/messages';

const PLAYLIST_URL = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

function renderLanding(props: Partial<Parameters<typeof LandingScreen>[0]> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const rendered = render(
    <LandingScreen
      onSubmit={onSubmit}
      isLoading={props.isLoading ?? false}
      {...(props.errorCode ? { errorCode: props.errorCode } : {})}
    />,
  );

  return { ...rendered, onSubmit };
}

/** Type a value into the URL box and press Start. */
function submit(value: string) {
  fireEvent.change(screen.getByLabelText('Spotify playlist link'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /start/i }));
}

describe('LandingScreen', () => {
  afterEach(cleanup);

  it('should show an inline error for an unparseable URL without submitting', () => {
    // NOT submitted: the server would say the same thing, so a round trip would only add latency
    // in front of an identical sentence.
    const { onSubmit } = renderLanding();

    submit('https://music.apple.com/playlist/whatever');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(PLAYLIST_ERROR_MESSAGES['invalid-url']);
  });

  it('should show the entity-specific error for an album link', () => {
    // `unsupported-entity`, not `invalid-url`. The distinction is the whole reason
    // `parsePlaylistUrl` returns a code rather than a boolean: "that is an album, not a playlist"
    // is an actionable complaint and "that is not a Spotify link" is not.
    const { onSubmit } = renderLanding();

    submit('https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      PLAYLIST_ERROR_MESSAGES['unsupported-entity'],
    );
  });

  it('should submit a valid playlist URL', () => {
    const { onSubmit } = renderLanding();

    submit(PLAYLIST_URL);

    // RAW, exactly as typed (bar the trim). The server owns normalisation.
    expect(onSubmit).toHaveBeenCalledWith(PLAYLIST_URL);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should submit a legacy /user/ playlist URL', () => {
    // The form that was rejected as `unsupported-entity` until this phase fixed it.
    const { onSubmit } = renderLanding();
    const legacy = 'https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M';

    submit(legacy);

    expect(onSubmit).toHaveBeenCalledWith(legacy);
  });

  it('should submit a spotify.link URL instead of rejecting it', () => {
    // ===================================================================
    //  A short link carries NO playlist id -- only a redirect does -- so no
    //  client-side check can parse it. It has to be submitted for the server
    //  to resolve.
    //
    //  This is the most consequential case on the screen: `spotify.link` is
    //  what the phone share sheet produces, which makes it the commonest way
    //  a player obtains a link at all. Rejecting it inline would make the app
    //  look broken to almost every first-time visitor on a phone.
    // ===================================================================
    const { onSubmit } = renderLanding();
    const short = 'https://spotify.link/aBcDeF12345';

    submit(short);

    expect(onSubmit).toHaveBeenCalledWith(short);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should render server error copy from the error code', () => {
    // The client's map, not the server's `message` field -- one wording source (see `messages.ts`).
    renderLanding({ errorCode: 'not-found-or-private' });

    expect(screen.getByRole('alert').textContent).toBe(
      PLAYLIST_ERROR_MESSAGES['not-found-or-private'],
    );
  });

  it('should let a client-side error replace a server error', () => {
    // Two error sources, one slot. A stale server error must not sit underneath a fresh "that is
    // not a playlist link" about what is currently in the box.
    renderLanding({ errorCode: 'upstream-unavailable' });
    expect(screen.getByRole('alert').textContent).toBe(
      PLAYLIST_ERROR_MESSAGES['upstream-unavailable'],
    );

    submit('nonsense');

    expect(screen.getByRole('alert').textContent).toBe(PLAYLIST_ERROR_MESSAGES['invalid-url']);
  });

  it('should clear the inline error when the input is edited', () => {
    renderLanding();
    submit('nonsense');
    expect(screen.queryByRole('alert')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Spotify playlist link'), {
      target: { value: PLAYLIST_URL },
    });

    // An error about the previous value, sitting beside a half-typed new one, reads as an error
    // about the new one.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should disable the submit control while loading', () => {
    // The visible half of the double-submit guard. `usePlaylist` aborts the first request anyway,
    // so this is about not inviting the second click rather than about correctness.
    renderLanding({ isLoading: true });

    expect((screen.getByRole('button', { name: /loading/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText('Spotify playlist link') as HTMLInputElement).disabled).toBe(
      true,
    );
    for (const playlist of SUGGESTED_PLAYLISTS) {
      expect(
        (screen.getByRole('button', { name: new RegExp(playlist.label, 'i') }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }
  });

  it('should render five suggested playlists', () => {
    // Five, so a first-time visitor with no playlist of their own can still see the app work.
    renderLanding();

    expect(SUGGESTED_PLAYLISTS).toHaveLength(5);
    for (const playlist of SUGGESTED_PLAYLISTS) {
      expect(screen.queryByText(playlist.label)).not.toBeNull();
    }
  });

  it('should submit the corresponding URL when a suggestion is clicked', () => {
    // Fill AND submit, exactly as if the link had been pasted -- including leaving the value in the
    // box, which is how a player learns what a valid link looks like.
    const { onSubmit } = renderLanding();

    fireEvent.click(screen.getByRole('button', { name: /Rock Classics/i }));

    expect(onSubmit).toHaveBeenCalledWith('37i9dQZF1DWXRqgorJj26U');
    expect((screen.getByLabelText('Spotify playlist link') as HTMLInputElement).value).toBe(
      '37i9dQZF1DWXRqgorJj26U',
    );
  });

  it('should not render any track information', () => {
    // ===================================================================
    //  THE LANDING SCREEN'S LEAK ASSERTION.
    //
    //  This is a PRE-START surface and the person using it is a player --
    //  there is no host role in this app. So the suggested playlists are
    //  labelled by genre and era, and nothing here may name a track, an
    //  artist or a year. "Featuring Bohemian Rhapsody and 41 more" is the
    //  tempting thing to add to a suggestion card, and it would spoil the
    //  deck before the game began.
    // ===================================================================
    const { container } = renderLanding();
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
    }

    // And no year-shaped string anywhere: the labels are genre/era names, and "All Out 80s" is a
    // decade rather than a release year, which is exactly the distinction this pins.
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
