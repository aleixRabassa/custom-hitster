/**
 * @vitest-environment jsdom
 *
 * The landing screen's job is to reject what the server would reject anyway, submit what it cannot
 * judge, and never say anything about a deck. All three are asserted below.
 *
 * Since multi-playlist it is a LIST of rows, so a fourth thing is asserted: that a message about
 * one box is attached to that box. With five inputs on screen, a message in a shared slot names
 * none of them, and `aria-describedby` is the only association jsdom can actually see.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LandingScreen, SUGGESTED_PLAYLISTS } from './LandingScreen';
import { fixtureDeck } from './__fixtures__/cards';
import { MAX_DECK_PLAYLISTS } from '../game/deck-merge';
import { PLAYLIST_ERROR_MESSAGES } from '../game/messages';

const PLAYLIST_URL = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const SECOND_URL = 'https://open.spotify.com/playlist/2zmXlpkOMN92NlQaE2M62c';
const THIRD_URL = 'https://open.spotify.com/playlist/37i9dQZF1DX1HCSfq0nSal';

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

/** Two saved decks: one of a single playlist, one of three. */
const SAVED = [
  { ids: ['2zmXlpkOMN92NlQaE2M62c'], name: 'Party Mix', savedAt: 2_000 },
  {
    ids: ['37i9dQZF1DX1HCSfq0nSal', '37i9dQZEVXbMDoHDwVN2tF', '37i9dQZF1DX0XUsuxWHRQd'],
    name: 'Road Trip +2 more',
    savedAt: 1_000,
  },
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

/**
 * One row's input, by its VISIBLE label.
 *
 * The first row keeps Phase 6's wording and later rows are numbered, which is what gives every box
 * on the screen a unique accessible name. `getByLabelText` matches exactly, so "Playlist link"
 * does not also match "Playlist link 2".
 */
function rowInput(index: number): HTMLInputElement {
  const label = index === 0 ? 'Playlist link' : `Playlist link ${index + 1}`;

  return screen.getByLabelText(label) as HTMLInputElement;
}

function typeInRow(index: number, value: string) {
  fireEvent.change(rowInput(index), { target: { value } });
}

function pressStart() {
  fireEvent.click(screen.getByRole('button', { name: /start/i }));
}

function pressAdd() {
  fireEvent.click(screen.getByRole('button', { name: 'Add another playlist' }));
}

/** Type a value into the first row and press Start -- the single-playlist path, unchanged. */
function submit(value: string) {
  typeInRow(0, value);
  pressStart();
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

    // RAW, exactly as typed (bar the trim), and as an ARRAY -- one playlist is the `n = 1` case of
    // the same submission a five-row deck makes. The server owns normalisation.
    expect(onSubmit).toHaveBeenCalledWith([PLAYLIST_URL]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should submit a legacy /user/ playlist URL', () => {
    // The form that was rejected as `unsupported-entity` until this phase fixed it.
    const { onSubmit } = renderLanding();
    const legacy = 'https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M';

    submit(legacy);

    expect(onSubmit).toHaveBeenCalledWith([legacy]);
  });

  it('should submit a short link without parsing it', () => {
    // ===================================================================
    //  A short link carries NO playlist id -- only a redirect does -- so no
    //  client-side check can parse it. It has to be submitted for the server
    //  to resolve.
    //
    //  This is the most consequential case on the screen: `spotify.link` is
    //  what the phone share sheet produces, which makes it the commonest way
    //  a player obtains a link at all. Rejecting it inline would make the app
    //  look broken to almost every first-time visitor on a phone.
    //
    //  Re-run after the rewrite into rows, because the exception now lives
    //  inside a per-row loop rather than in one straight-line `submit`.
    // ===================================================================
    const { onSubmit } = renderLanding();
    const short = 'https://spotify.link/aBcDeF12345';

    submit(short);

    expect(onSubmit).toHaveBeenCalledWith([short]);
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
    //
    //  Multi-playlist added no code to the union either: a playlist that
    //  fails among several is a NOTICE, and a batch in which none loaded
    //  reports the first row's existing code.
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

  it('should keep a row error and the container error in separate slots', () => {
    /*
      Two error SOURCES with two slots since multi-playlist, and that is the reversal worth pinning.
      Before the rows they shared one, so a local parse failure had to overwrite the server's
      message; now the container's slot describes the REQUEST (a batch in which nothing loaded, or
      `no-years-found`) and a row's describes the box it sits under. Both can be true at once --
      the previous submission failed AND the value now typed is not a link -- and hiding either
      would be hiding something the player needs.
    */
    renderLanding({ errorCode: 'upstream-unavailable' });
    expect(screen.getByRole('alert').textContent).toBe(
      PLAYLIST_ERROR_MESSAGES['upstream-unavailable'],
    );

    submit('nonsense');

    const messages = screen.getAllByRole('alert').map((alert) => alert.textContent);
    expect(messages).toContain(PLAYLIST_ERROR_MESSAGES['invalid-url']);
    expect(messages).toContain(PLAYLIST_ERROR_MESSAGES['upstream-unavailable']);
    // And only the row's is wired to an input. The container's describes no single box.
    expect(rowInput(0).getAttribute('aria-describedby')).toBe(
      screen.getAllByRole('alert')[0]?.getAttribute('id'),
    );
  });

  it('should disable the submit control while loading', () => {
    // The visible half of the double-submit guard. `usePlaylist` aborts the first request anyway,
    // so this is about not inviting the second click rather than about correctness.
    renderLanding({ isLoading: true });

    expect((screen.getByRole('button', { name: /loading/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(rowInput(0).disabled).toBe(true);
    // Including the "+": adding a row mid-request is a row that cannot be submitted anyway.
    expect(
      (screen.getByRole('button', { name: 'Add another playlist' }) as HTMLButtonElement).disabled,
    ).toBe(true);
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

  it('should submit a suggestion immediately as a single playlist', () => {
    // Fill AND submit, exactly as if the link had been pasted -- including leaving the value in the
    // box, which is how a player learns what a valid link looks like. The FULL link, not the bare
    // id: the id parsed fine but put a 22-character string where the placeholder promises a URL.
    //
    // ONE id, so a suggestion still deals a single-playlist deck: the "+" is for the player, not
    // for the demo path (decision 5).
    const { onSubmit } = renderLanding();

    fireEvent.click(suggestionButton('Top 50 Global'));

    const expected = 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF';
    expect(onSubmit).toHaveBeenCalledWith([expected]);
    expect(rowInput(0).value).toBe(expected);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('should submit a full URL for every suggestion', () => {
    // Every one, not just the sampled Top 50 Global above: a suggestion whose id were mistyped to
    // the wrong length would still fill the box, and only the submission would reveal it.
    for (const playlist of SUGGESTED_PLAYLISTS) {
      const { onSubmit } = renderLanding();

      fireEvent.click(suggestionButton(playlist.label));

      expect(onSubmit).toHaveBeenCalledWith([`https://open.spotify.com/playlist/${playlist.id}`]);
      // Submitted at all, which means the client-side parse passed -- so the id really is a
      // well-formed 22-character Spotify id and the derived link is one the server will accept.
      expect(screen.queryByRole('alert')).toBeNull();
      cleanup();
    }
  });

  it('should replace typed rows when a suggestion is pressed', () => {
    /*
      Decision 5's cost, asserted rather than assumed: the one-click demo path wins, and a
      half-typed row is discarded by it. Nothing is lost SILENTLY -- the rows visibly become exactly
      what was submitted -- and the screen is replaced by the game a moment later anyway.
    */
    const { onSubmit } = renderLanding();

    pressAdd();
    typeInRow(0, PLAYLIST_URL);
    typeInRow(1, SECOND_URL);

    fireEvent.click(suggestionButton('Top 50 Global'));

    const expected = 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF';
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith([expected]);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(rowInput(0).value).toBe(expected);
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
    //
    //  It holds for EVERY row, which is why the numbering is visible text
    //  rather than a per-row `aria-label` -- the tempting shortcut would
    //  reintroduce exactly this failure four more times.
    // ===================================================================
    renderLanding();
    pressAdd();

    for (const [index, name] of ['Playlist link', 'Playlist link 2'].entries()) {
      const input = screen.getByRole('textbox', { name });
      expect(input.hasAttribute('aria-label')).toBe(false);
      // And the name really is coming from the label element a sighted player reads.
      expect(screen.getByText(name).tagName).toBe('SPAN');
      expect(rowInput(index)).toBe(input);
    }
  });

  it('should report an error on the row that failed to parse', () => {
    // `aria-invalid` alone says only THAT the value is wrong. The reason was announced once by
    // `role="alert"` and then unreachable, so a player who tabbed back to the field heard
    // "invalid" and no explanation. With five boxes it also has to say WHICH box.
    const { onSubmit } = renderLanding();

    // No error yet: the attribute must be ABSENT rather than pointing at nothing. A describedby
    // naming an element that is not in the document is a dangling reference, which some screen
    // readers report as an error of their own.
    expect(rowInput(0).hasAttribute('aria-describedby')).toBe(false);
    expect(rowInput(0).getAttribute('aria-invalid')).toBe('false');

    pressAdd();
    typeInRow(0, PLAYLIST_URL);
    typeInRow(1, 'nonsense');
    pressStart();

    expect(onSubmit).not.toHaveBeenCalled();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(PLAYLIST_ERROR_MESSAGES['invalid-url']);
    // The message belongs to the SECOND row, and the link is real: the id it names is the element
    // actually carrying the message.
    expect(rowInput(1).getAttribute('aria-invalid')).toBe('true');
    expect(rowInput(1).getAttribute('aria-describedby')).toBe(alert.getAttribute('id'));
    expect(alert.getAttribute('id')).toBeTruthy();
    // And the row that parsed is untouched -- a message under a valid box is a message about
    // nothing.
    expect(rowInput(0).getAttribute('aria-invalid')).toBe('false');
    expect(rowInput(0).hasAttribute('aria-describedby')).toBe(false);
  });

  it('should not submit when any row is invalid', () => {
    /*
      ALL OR NOTHING, and it is the deliberate half of the design. Dealing four of the five
      playlists somebody asked for gives them a deck that is wrong in a way nothing on the screen
      explains -- and a client-side parse failure is a typo, fixable in a second. A playlist that
      fails to LOAD is the other case entirely, and that one IS a notice.
    */
    const { onSubmit } = renderLanding();

    pressAdd();
    pressAdd();
    typeInRow(0, PLAYLIST_URL);
    typeInRow(1, SECOND_URL);
    typeInRow(2, 'https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M');
    pressStart();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      PLAYLIST_ERROR_MESSAGES['unsupported-entity'],
    );
  });

  it("should clear only the edited row's error", () => {
    // The existing "an error about the previous value must not sit beside a half-typed new one"
    // rule, applied PER ROW: clearing all of them would wipe messages about boxes nobody touched,
    // and the player would press Start again to be told the same thing about the same box.
    renderLanding();

    pressAdd();
    typeInRow(0, 'nonsense');
    typeInRow(1, 'also nonsense');
    pressStart();
    expect(screen.getAllByRole('alert')).toHaveLength(2);

    typeInRow(0, PLAYLIST_URL);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(rowInput(0).getAttribute('aria-invalid')).toBe('false');
    expect(rowInput(1).getAttribute('aria-invalid')).toBe('true');
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
    pressAdd();

    const interactive = [...container.querySelectorAll('button, input')];
    // Two inputs, two removes, the "+", Start, and one button per suggestion.
    expect(interactive).toHaveLength(2 + 2 + 1 + 1 + SUGGESTED_PLAYLISTS.length);

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
    //
    //  Re-run against the row markup, with the form grown to its maximum:
    //  five labels, five removes, the cap hint and the "+" are all new text
    //  on a pre-start surface.
    // ===================================================================
    const { container } = renderLanding();
    for (let index = 1; index < MAX_DECK_PLAYLISTS; index += 1) pressAdd();

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

  describe('the rows', () => {
    it('should start with one playlist row', () => {
      // The single-playlist screen is still the default one, because it is still the common case.
      renderLanding();

      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(rowInput(0).value).toBe('');
    });

    it('should add a row when the add button is pressed', () => {
      renderLanding();

      pressAdd();

      expect(screen.getAllByRole('textbox')).toHaveLength(2);
      // Numbered from the second, so every box on the screen has a unique accessible name.
      expect(screen.getByLabelText('Playlist link 2')).not.toBeNull();
    });

    it('should not add more rows than the maximum', () => {
      // The cap is `MAX_DECK_PLAYLISTS` -- the same constant `deck-link.ts` rejects an over-long
      // link with, so the form cannot build a deck the link format could not describe.
      //
      // Pressed exactly to the cap and no further, because THE BUTTON IS GONE at that point: the
      // "+" is unmounted rather than disabled, so a sixth press has nothing to click and
      // `pressAdd()` would fail on the query rather than on an assertion.
      renderLanding();

      for (let index = 1; index < MAX_DECK_PLAYLISTS; index += 1) pressAdd();

      expect(screen.getAllByRole('textbox')).toHaveLength(MAX_DECK_PLAYLISTS);
      expect(screen.queryByRole('button', { name: 'Add another playlist' })).toBeNull();
    });

    it('should explain the cap once the add button is gone', () => {
      // A control that vanishes with no explanation reads as broken just as a dead one does. This
      // is the sentence that says the cap out loud in the space the "+" left, and it is why the
      // button may be unmounted at all.
      renderLanding();

      expect(screen.queryByText(/is the maximum/i)).toBeNull();

      for (let index = 1; index < MAX_DECK_PLAYLISTS; index += 1) pressAdd();

      expect(screen.getByText(`${MAX_DECK_PLAYLISTS} playlists is the maximum for one deck.`))
        .not.toBeNull();
    });

    it('should not render a remove button when there is only one row', () => {
      // The form always has at least one box, so a remove beside a lone row offers an action that
      // cannot do anything.
      renderLanding();

      expect(screen.queryByRole('button', { name: /remove playlist/i })).toBeNull();

      pressAdd();

      expect(screen.getAllByRole('button', { name: /remove playlist/i })).toHaveLength(2);
    });

    it('should remove a row without disturbing the other values', () => {
      /*
        THE STABLE-KEY ASSERTION (decision 6). With index keys React re-uses the removed row's DOM
        node for the one that shifted up: the value under the player's cursor changes to somebody
        else's. Keyed on the row's own id, the node that actually went is the node removed.
      */
      renderLanding();

      pressAdd();
      pressAdd();
      typeInRow(0, PLAYLIST_URL);
      typeInRow(1, SECOND_URL);
      typeInRow(2, THIRD_URL);

      fireEvent.click(screen.getByRole('button', { name: 'Remove playlist 2' }));

      expect(screen.getAllByRole('textbox')).toHaveLength(2);
      expect(rowInput(0).value).toBe(PLAYLIST_URL);
      // The third row's value, now in the second position. The NUMBERING is positional and does
      // renumber -- it names where the box is; the key names which box it is.
      expect(rowInput(1).value).toBe(THIRD_URL);
    });

    it('should submit every non-blank row', () => {
      const { onSubmit } = renderLanding();

      pressAdd();
      pressAdd();
      typeInRow(0, PLAYLIST_URL);
      typeInRow(1, SECOND_URL);
      typeInRow(2, THIRD_URL);
      pressStart();

      // In ROW ORDER, which is what makes the merge's first-failure rule describe the first row.
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith([PLAYLIST_URL, SECOND_URL, THIRD_URL]);
    });

    it('should ignore blank rows', () => {
      // A player who pressed "+" once too often should not have to remove the row to start. The
      // trim is what makes a row of spaces blank too.
      const { onSubmit } = renderLanding();

      pressAdd();
      pressAdd();
      typeInRow(0, PLAYLIST_URL);
      typeInRow(2, '   ');
      pressStart();

      expect(onSubmit).toHaveBeenCalledExactlyOnceWith([PLAYLIST_URL]);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('should report an error when every row is blank', () => {
      // Reported on the FIRST row rather than in the container's slot, because it is about what is
      // (not) in the boxes -- and firing a request for nothing would spend a round trip to be told
      // the same thing.
      const { onSubmit } = renderLanding();

      pressAdd();
      pressStart();

      expect(onSubmit).not.toHaveBeenCalled();
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(PLAYLIST_ERROR_MESSAGES['invalid-url']);
      expect(rowInput(0).getAttribute('aria-describedby')).toBe(alert.getAttribute('id'));
    });
  });

  describe('the saved-playlist library', () => {
    it('should render saved playlists and submit one on click', () => {
      // A saved row submits by exactly the path a suggestion does -- the ids become full URLs and
      // go through the same validation. There is no second entry point.
      const { onSubmit } = renderLanding({ savedPlaylists: SAVED });

      expect(screen.getByText('Your playlists')).not.toBeNull();
      // EXACT names, not patterns: the remove control beside each row names the same playlist, so a
      // `/party mix/i` regex matches both buttons in the row. The row's own name is the name alone.
      expect(screen.getByRole('button', { name: 'Party Mix' })).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Party Mix' }));

      expect(onSubmit).toHaveBeenCalledExactlyOnceWith([
        'https://open.spotify.com/playlist/2zmXlpkOMN92NlQaE2M62c',
      ]);
      // And the rows show what was submitted, which is how a player learns the shape of a link.
      expect(rowInput(0).value).toBe(
        'https://open.spotify.com/playlist/2zmXlpkOMN92NlQaE2M62c',
      );
    });

    it('should submit every id of a saved multi-playlist deck', () => {
      /*
        An entry is 1..5 playlists, and it is the whole deck the player chose to keep. Submitting
        only the first id would deal a deck that is not the one the row is named after -- and the
        row's name ("Road Trip +2 more") is the label of all three.
      */
      const { onSubmit } = renderLanding({ savedPlaylists: SAVED });

      fireEvent.click(screen.getByRole('button', { name: 'Road Trip +2 more' }));

      expect(onSubmit).toHaveBeenCalledExactlyOnceWith([
        'https://open.spotify.com/playlist/37i9dQZF1DX1HCSfq0nSal',
        'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF',
        'https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd',
      ]);
      // And the form is visibly refilled with all three, in row order.
      expect(screen.getAllByRole('textbox')).toHaveLength(3);
      expect(rowInput(2).value).toBe(
        'https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd',
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
      // The "+", Start, and the suggestions. No remove button: there is one row.
      expect(screen.getAllByRole('button')).toHaveLength(2 + SUGGESTED_PLAYLISTS.length);
    });

    it('should remove a saved deck by its deck key', () => {
      /*
        The DECK key -- the ids sorted and joined -- rather than a single id. A three-playlist entry
        has no single id that identifies it, and `savedDeckKey` is what `savePlaylist` dedupes on,
        so removing by anything else would leave the two disagreeing about which row is which.
      */
      const { onRemoveSaved, onSubmit } = renderLanding({ savedPlaylists: SAVED });

      fireEvent.click(
        screen.getByRole('button', { name: 'Remove Road Trip +2 more from your playlists' }),
      );

      // Sorted, which is what makes the same set saved in a different row order one favourite.
      expect(onRemoveSaved).toHaveBeenCalledExactlyOnceWith(
        '37i9dQZEVXbMDoHDwVN2tF,37i9dQZF1DX0XUsuxWHRQd,37i9dQZF1DX1HCSfq0nSal',
      );
      // And removing did NOT submit. The two buttons are siblings rather than nested for exactly
      // this reason -- a remove control inside the play button would activate both.
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should name the playlist in every remove control', () => {
      // A screen with four rows of "Remove" gives a screen-reader user no way to tell which row
      // they are on. The name carries the deck's label; the ✕ is `aria-hidden` decoration.
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
      // One row's input, the "+", Start, two buttons per saved row, and one per suggestion.
      expect(interactive).toHaveLength(1 + 1 + 1 + SAVED.length * 2 + SUGGESTED_PLAYLISTS.length);

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
      // The library stores a deck LABEL, which is the same class of data the suggestions show.
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
