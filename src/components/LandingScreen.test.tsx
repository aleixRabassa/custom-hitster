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
  const onRemoveSaved = props.onRemoveSaved ?? vi.fn();
  const rendered = render(
    <LandingScreen
      onSubmit={onSubmit}
      isLoading={props.isLoading ?? false}
      {...(props.errorCode ? { errorCode: props.errorCode } : {})}
      // Defaults to empty, which is the first-time visitor's screen and the one every assertion
      // written before the library existed was written against.
      savedPlaylists={props.savedPlaylists ?? []}
      onRemoveSaved={onRemoveSaved}
    />,
  );

  return { ...rendered, onSubmit, onRemoveSaved };
}

/** Two saved playlists, most-recent-first as the library stores them. */
const SAVED = [
  { id: '2zmXlpkOMN92NlQaE2M62c', name: 'Party Mix', savedAt: 2_000 },
  { id: '37i9dQZF1DX1HCSfq0nSal', name: 'Road Trip', savedAt: 1_000 },
];

/**
 * Query a suggestion button by its label.
 *
 * The label is ESCAPED before it becomes a pattern, and that is load-bearing rather than
 * defensive: "This is Duki (all songs)" contains parentheses, and an unescaped `new RegExp()`
 * turns them into a capture group -- the pattern then matches "This is Duki all songs", which
 * appears nowhere, and the query fails on a button that renders perfectly. A plain string is not
 * an option either, because the accessible name is the label AND the blurb.
 */
function suggestionButton(label: string) {
  return screen.getByRole('button', {
    name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  });
}

/** Type a value into the URL box and press Start. */
function submit(value: string) {
  fireEvent.change(screen.getByLabelText('Playlist link'), { target: { value } });
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

  it('should render the new offline and empty-playlist copy in the same alert slot', () => {
    // ===================================================================
    //  THE POINT OF PHASE 7's ERROR WORK: two new failures, NO NEW SCREEN.
    //
    //  `offline` and `empty-playlist` are codes on the existing union, so
    //  they flow through `messages.ts` into the slot that was already here.
    //  One test covers both because the slot is shared -- what it guards is
    //  that neither code renders blank, which is what a code with no copy
    //  would do at the exact moment the player needs telling something.
    //
    //  `App.tsx` needs no case for either, and that is the design: a fifth
    //  view outside its four-status model would be the second source of
    //  truth its header block exists to prevent.
    // ===================================================================
    renderLanding({ errorCode: 'offline' });
    expect(screen.getByRole('alert').textContent).toBe(PLAYLIST_ERROR_MESSAGES['offline']);

    cleanup();

    renderLanding({ errorCode: 'empty-playlist' });
    expect(screen.getByRole('alert').textContent).toBe(PLAYLIST_ERROR_MESSAGES['empty-playlist']);
    // The regression this code exists for: an empty playlist used to render the
    // `unexpected-payload` apology, which blamed our parser for a perfectly readable answer.
    expect(screen.getByRole('alert').textContent).not.toContain('our side');

    cleanup();

    /*
      And the one code in the union that is NOT a fetch failure. `no-years-found` comes from the
      session — the playlist loaded, then every card's year lookup came back empty and the deck
      emptied — and `App.tsx` sends the player back here rather than to an end screen reading
      "Deck finished" over a count of zero. Same slot, same copy source, no extra prop: that this
      screen cannot tell the difference is the point of widening the union rather than adding a
      second channel.
    */
    renderLanding({ errorCode: 'no-years-found' });
    expect(screen.getByRole('alert').textContent).toBe(PLAYLIST_ERROR_MESSAGES['no-years-found']);
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

    fireEvent.change(screen.getByLabelText('Playlist link'), {
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
    expect((screen.getByLabelText('Playlist link') as HTMLInputElement).disabled).toBe(true);
    for (const playlist of SUGGESTED_PLAYLISTS) {
      expect((suggestionButton(playlist.label) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('should render nine suggested playlists', () => {
    // Nine, so a first-time visitor with no playlist of their own can still see the app work.
    renderLanding();

    expect(SUGGESTED_PLAYLISTS).toHaveLength(9);
    for (const playlist of SUGGESTED_PLAYLISTS) {
      expect(screen.queryByText(playlist.label)).not.toBeNull();
    }
  });

  it('should submit the full playlist URL when a suggestion is clicked', () => {
    // Fill AND submit, exactly as if the link had been pasted -- including leaving the value in the
    // box, which is how a player learns what a valid link looks like. The FULL link, not the bare
    // id: the id parsed fine but put a 22-character string where the placeholder promises a URL.
    const { onSubmit } = renderLanding();

    fireEvent.click(suggestionButton('Top 50 Global'));

    const expected = 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF';
    expect(onSubmit).toHaveBeenCalledWith(expected);
    expect((screen.getByLabelText('Playlist link') as HTMLInputElement).value).toBe(expected);
  });

  it('should submit a full URL for every suggestion', () => {
    // Every one, not just the sampled Top 50 Global above: a suggestion whose id were mistyped to
    // the wrong length would still fill the box, and only the submission would reveal it.
    for (const playlist of SUGGESTED_PLAYLISTS) {
      const { onSubmit } = renderLanding();

      fireEvent.click(suggestionButton(playlist.label));

      expect(onSubmit).toHaveBeenCalledWith(`https://open.spotify.com/playlist/${playlist.id}`);
      // Submitted at all, which means the client-side parse passed -- so the id really is a
      // well-formed 22-character Spotify id and the derived link is one the server will accept.
      expect(screen.queryByRole('alert')).toBeNull();
      cleanup();
    }
  });

  it("should expose the input's accessible name as its visible label", () => {
    // ===================================================================
    //  A WCAG 2.5.3 (LABEL IN NAME) FIX, ASSERTED BY THE QUERY ITSELF.
    //
    //  The input carried `aria-label="Spotify playlist link"` alongside the
    //  visible `Playlist link` from the wrapping `<label>`. `aria-label`
    //  WINS, so the accessible name did not match the visible text -- which
    //  breaks speech control outright ("click Playlist link" matched nothing
    //  on screen) and is a straight 2.5.3 failure.
    //
    //  Querying by the VISIBLE text is the assertion: it is the query that
    //  fails the moment an `aria-label` comes back. The attribute check
    //  below says the same thing directly, because a future `aria-label`
    //  that HAPPENED to read "Playlist link" would satisfy the query while
    //  still being the redundant attribute that caused this.
    // ===================================================================
    renderLanding();

    const input = screen.getByRole('textbox', { name: 'Playlist link' });
    expect(input.hasAttribute('aria-label')).toBe(false);
    // And the name really is coming from the label element a sighted player reads.
    expect(screen.getByText('Playlist link').tagName).toBe('SPAN');
    expect(screen.getByLabelText('Playlist link')).toBe(input);
  });

  it('should associate the error message with the input via aria-describedby', () => {
    // `aria-invalid` alone says only THAT the value is wrong. The reason was announced once by
    // `role="alert"` and then unreachable, so a player who tabbed back to the field heard
    // "invalid" and no explanation.
    renderLanding();

    // No error yet: the attribute must be ABSENT rather than pointing at nothing. A describedby
    // naming an element that is not in the document is a dangling reference, which some screen
    // readers report as an error of their own.
    const before = screen.getByRole('textbox', { name: 'Playlist link' });
    expect(before.hasAttribute('aria-describedby')).toBe(false);
    expect(before.getAttribute('aria-invalid')).toBe('false');

    submit('nonsense');

    const input = screen.getByRole('textbox', { name: 'Playlist link' });
    const alert = screen.getByRole('alert');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // The link is real: the id it names is the element actually carrying the message.
    expect(input.getAttribute('aria-describedby')).toBe(alert.getAttribute('id'));
    expect(alert.getAttribute('id')).toBeTruthy();
  });

  it('should give every interactive element a focus-visible style', () => {
    // ===================================================================
    //  A CLASS-NAME ASSERTION, AND A DELIBERATELY WEAK ONE.
    //
    //  It proves the utility is present. It cannot prove the ring is
    //  visible, legible, or the right colour -- jsdom applies no stylesheet
    //  and computes no layout, so there is nothing stronger available here.
    //  The contrast is verified by calculation (recorded in
    //  `agent_findings.md`) and the appearance by the keyboard pass in
    //  `development.md` §5.
    //
    //  What it DOES catch is the common regression: a button added later
    //  without one. Before Phase 7 all eleven interactive elements in the
    //  app fell back to the browser default over a near-black page.
    //
    //  `focus-visible`, not `focus`: the suggestion buttons submit and
    //  replace the screen, so a `focus:` ring would be the last thing a
    //  mouse user saw of the landing screen.
    // ===================================================================
    const { container } = renderLanding();

    const interactive = [...container.querySelectorAll('button, input')];
    // The input, Start, and one button per suggestion.
    expect(interactive).toHaveLength(2 + SUGGESTED_PLAYLISTS.length);

    for (const element of interactive) {
      expect(element.className).toContain('focus-visible:focus-ring');
    }
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

    // And no year-shaped string anywhere: the labels are Spotify's own titles and the blurbs are
    // genre/era names. "Éxitos Verano 2000s & 2010s" is the case this pins -- a decade written as
    // "2000s" is not a release year, and the `\b` after the digits is what tells the two apart.
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });

  describe('the saved-playlist library', () => {
    it('should render saved playlists and submit one on click', () => {
      // A saved row submits by exactly the path a suggestion does -- the id becomes a full URL and
      // goes through the same `submit`, which also fills the input. There is no second entry point.
      const { onSubmit } = renderLanding({ savedPlaylists: SAVED });

      expect(screen.getByText('Your playlists')).not.toBeNull();
      // EXACT names, not patterns: the remove control beside each row names the same playlist, so a
      // `/party mix/i` regex matches both buttons in the row. The row's own name is the name alone.
      expect(screen.getByRole('button', { name: 'Party Mix' })).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Road Trip' }));

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        'https://open.spotify.com/playlist/37i9dQZF1DX1HCSfq0nSal',
      );
      // And the input shows what was submitted, which is how a player learns the shape of a link.
      expect((screen.getByLabelText('Playlist link') as HTMLInputElement).value).toBe(
        'https://open.spotify.com/playlist/37i9dQZF1DX1HCSfq0nSal',
      );
    });

    it('should keep the library order it was given', () => {
      // The library is most-recent-first and this screen must not re-sort it: the player's mental
      // model is "the one I saved last is at the top".
      renderLanding({ savedPlaylists: SAVED });

      const names = screen
        .getAllByRole('button')
        .map((button) => button.textContent ?? '')
        .filter((text) => text.includes('Party Mix') || text.includes('Road Trip'));
      expect(names[0]).toContain('Party Mix');
      expect(names[1]).toContain('Road Trip');
    });

    it('should render nothing when the library is empty', () => {
      // NOTHING, not a placeholder (step 14): a first-time visitor already has the form and nine
      // suggestions, and a block explaining an empty list is noise on the app's front door.
      renderLanding({ savedPlaylists: [] });

      expect(screen.queryByText('Your playlists')).toBeNull();
      // The suggestions are untouched, so the count is the pre-library one.
      expect(screen.getAllByRole('button')).toHaveLength(1 + SUGGESTED_PLAYLISTS.length);
    });

    it('should remove a saved playlist', () => {
      const { onRemoveSaved, onSubmit } = renderLanding({ savedPlaylists: SAVED });

      fireEvent.click(screen.getByRole('button', { name: 'Remove Party Mix from your playlists' }));

      expect(onRemoveSaved).toHaveBeenCalledExactlyOnceWith('2zmXlpkOMN92NlQaE2M62c');
      // And removing did NOT submit. The two buttons are siblings rather than nested for exactly
      // this reason -- a remove control inside the play button would activate both.
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should name the playlist in every remove control', () => {
      // A screen with four rows of "Remove" gives a screen-reader user no way to tell which row
      // they are on. The name carries the playlist; the ✕ is `aria-hidden` decoration.
      renderLanding({ savedPlaylists: SAVED });

      for (const saved of SAVED) {
        expect(
          screen.getByRole('button', { name: `Remove ${saved.name} from your playlists` }),
        ).not.toBeNull();
      }
    });

    it('should give every library control a focus-visible style and a touch target', () => {
      // Same class-name caveat as the assertion above: it catches a control added without a ring,
      // which is the regression that actually happens. Both buttons per row are checked.
      const { container } = renderLanding({ savedPlaylists: SAVED });

      const interactive = [...container.querySelectorAll('button, input')];
      // The input, Start, two buttons per saved row, and one per suggestion.
      expect(interactive).toHaveLength(2 + SAVED.length * 2 + SUGGESTED_PLAYLISTS.length);

      for (const element of interactive) {
        expect(element.className).toContain('focus-visible:focus-ring');
      }
      for (const button of screen.getAllByRole('button')) {
        expect(button.className).toContain('touch-target');
      }
    });

    it('should disable the library while a request is in flight', () => {
      // Consistent with the suggestions and with Start: a second submission mid-request is what the
      // disabled state exists to stop, and a remove that lands mid-deal is a confusing race.
      renderLanding({ savedPlaylists: SAVED, isLoading: true });

      for (const button of screen.getAllByRole('button')) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
      }
    });

    it('should render no track information for a saved playlist either', () => {
      // The library stores a playlist NAME, which is the same class of data the suggestions show.
      // This is the assertion that fails if an entry ever grows a track list.
      const { container } = renderLanding({ savedPlaylists: SAVED });
      const text = container.textContent ?? '';

      for (const card of fixtureDeck) {
        expect(text).not.toContain(card.title);
        expect(text).not.toContain(card.artist);
      }
      expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
    });
  });
});
