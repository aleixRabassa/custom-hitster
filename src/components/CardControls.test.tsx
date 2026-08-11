/**
 * @vitest-environment jsdom
 *
 * The control-bar tests. Most of these moved here verbatim from `CardHiddenSide.test.tsx` when
 * the buttons moved out of the card -- a pointer-up on a button inside a tappable card bubbles
 * into the gesture handler and flips it, so pressing Play used to reveal the answer.
 *
 * No `qrcode` mock is needed: this component renders no QR, which is itself part of the split.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardControls } from './CardControls';
import { highConfidenceCard } from './__fixtures__/cards';
import type { CardAudioControls } from '../hooks/useCardAudio';

/** A stub `useCardAudio` return value. `canPlay` is the only interesting axis here. */
function stubAudio(overrides: Partial<CardAudioControls> = {}): CardAudioControls {
  return {
    canPlay: true,
    isPlaying: false,
    isLoading: false,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

/**
 * The two callbacks are required and almost never the thing under test, so they are defaulted here
 * -- a test that cares about one passes just that one.
 */
function controls(
  props: {
    audio?: CardAudioControls;
    onExit?: () => void;
    onKeepDeck?: () => void;
  } = {},
) {
  return (
    <CardControls
      audio={props.audio ?? stubAudio()}
      onExit={props.onExit ?? vi.fn()}
      onKeepDeck={props.onKeepDeck ?? vi.fn()}
    />
  );
}

describe('CardControls', () => {
  afterEach(cleanup);

  it('should disable play/pause when the track has no preview', () => {
    render(controls({ audio: stubAudio({ canPlay: false }) }));

    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('should keep exit enabled when the track has no preview', () => {
    // Exit is never affected by a missing preview -- and a card whose audio does not work is
    // exactly the card a player wants to leave.
    render(controls({ audio: stubAudio({ canPlay: false }) }));

    expect((screen.getByRole('button', { name: 'Exit game' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('should keep the deck actions enabled when the track has no preview', () => {
    // It depends on the DECK, not on this card: a missing preview says nothing about whether the
    // player can share the playlist, save it or print it.
    render(controls({ audio: stubAudio({ canPlay: false }) }));

    expect(
      (screen.getByRole('button', { name: 'Keep this deck' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('should enable play/pause when the track has a preview', () => {
    render(controls());

    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('should note a missing preview without naming the track', () => {
    render(controls({ audio: stubAudio({ canPlay: false }) }));

    expect(screen.queryByText(/no preview available/i)).not.toBeNull();
  });

  it('should not render the missing-preview note when a preview exists', () => {
    render(controls());

    expect(screen.queryByText(/no preview available/i)).toBeNull();
  });

  it('should give the controls generic accessible names', () => {
    // The names are asserted EXACTLY, not merely "does not contain the title": a generic
    // name is the requirement, and an exhaustive list is what catches a well-meaning
    // "Play preview of …" edit. This bar sits beside an UNFLIPPED card, so it is a leak
    // surface exactly as the card's own face is.
    //
    // "Keep this deck" is on the list for the same reason the other two are, and it passes the
    // same test: it names the DECK, which the player chose, rather than the card, which they have
    // not seen yet.
    //
    // "Restart" left the list on 2026-08-11 when the button was removed -- `CardControls`' header
    // has the reasoning, and Play now doubles as the replay.
    render(controls());

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);

    expect(names).toEqual(['Exit game', 'Play', 'Keep this deck']);
  });

  it('should not leak the current track anywhere in the DOM', () => {
    // The bar has no `card` prop at all, which is what makes this assertion cheap to keep
    // true -- but it is asserted anyway, because "add a now-playing label" is a natural
    // thing for someone to want here and it would spoil every unflipped card.
    const card = highConfidenceCard;
    const { container } = render(controls());

    for (const value of [card.title, card.artist, String(card.year), String(card.durationMs)]) {
      expect(container.textContent ?? '').not.toContain(value);
    }

    for (const element of Array.from(container.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.value).not.toContain(card.title);
        expect(attribute.value).not.toContain(card.artist);
      }
    }
  });

  it('should name the toggle Pause while playing', () => {
    render(controls({ audio: stubAudio({ isPlaying: true }) }));

    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('should invoke the exit callback on exit', () => {
    // Still exactly one call, and still on the press: what changed is what the CALLER does with
    // it -- `GameScreen` opens a confirmation instead of ending the game. From here it is a
    // press being reported, which is why the prop name did not change either.
    const onExit = vi.fn();
    render(controls({ onExit }));

    screen.getByRole('button', { name: 'Exit game' }).click();

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('should invoke the deck-actions callback and nothing else', () => {
    // Same shape as Exit: the press only ASKS. `GameScreen` opens `DeckActionsDialog` on it, and
    // the audio is deliberately untouched -- the player is sharing a deck, not leaving the game.
    const onKeepDeck = vi.fn();
    const audio = stubAudio();
    render(controls({ audio, onKeepDeck }));

    screen.getByRole('button', { name: 'Keep this deck' }).click();

    expect(onKeepDeck).toHaveBeenCalledTimes(1);
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
  });

  it('should draw every control as one uniformly sized icon', () => {
    // ===================================================================
    //  WHAT THIS PINS IS THAT THE ICONS CANNOT DRIFT APART.
    //
    //  They were text characters -- ■ ▶ ❙❙ ↺ -- and a codepoint's rendered
    //  size, weight and baseline belong to whichever font the OS resolves
    //  it in. ▶ came out heavier and larger than ↺, and on a machine whose
    //  fallback chain reaches an emoji font first it came out coloured.
    //  Nothing in CSS could equalise them, because there was nothing
    //  common to size.
    //
    //  jsdom renders none of this, so the assertion is at class-name level
    //  with the usual caveat: it proves each button holds one SVG carrying
    //  the shared size token, not that the result looks even. What it
    //  catches is the regression that matters -- a fourth control, or a
    //  replacement icon, sized by hand. The deck-actions button added on
    //  2026-08-06 is exactly that case, and it went through `ControlIcon`.
    //
    //  NOTE this runs in the DEFAULT state, where the Play button holds no
    //  spinner. The loading state deliberately puts a second element in that
    //  button -- see the buffering tests below, which pin that the icon stays
    //  beside it rather than being replaced.
    // ===================================================================
    render(controls());

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);

    for (const button of buttons) {
      // No text glyph left anywhere: a stray character beside an icon is how the old sizing
      // problem would come back.
      expect(button.textContent).toBe('');

      const icons = button.querySelectorAll('svg');
      expect(icons).toHaveLength(1);

      const icon = icons[0];
      expect(icon?.getAttribute('class')).toContain('size-(--size-control-icon)');
      // Each button already carries a generic `aria-label`, so an icon that announced itself
      // would either duplicate the label or contradict it.
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('should render the pause icon in place of the play icon while playing', () => {
    // The toggle swaps the ICON as well as the label. Asserted through the path count because the
    // two icons have no accessible difference by design -- both labels are generic.
    const { rerender } = render(controls());

    // Play is one filled triangle.
    expect(screen.getByRole('button', { name: 'Play' }).querySelectorAll('path')).toHaveLength(1);

    rerender(controls({ audio: stubAudio({ isPlaying: true }) }));

    // Pause is two bars.
    expect(screen.getByRole('button', { name: 'Pause' }).querySelectorAll('rect')).toHaveLength(2);
  });

  it('should colour the exit control as the destructive one and leave the others alone', () => {
    // Exit is the only control here that ENDS something, and red is how it says so. The others
    // must NOT pick the colour up: three red buttons signals nothing.
    //
    // `--color-danger` measures 5.7:1 on `--color-surface-raised`, comfortably past the 3:1 WCAG
    // 1.4.11 asks of a non-text indicator -- computed, not eyeballed, and not observable in jsdom.
    render(controls());

    expect(screen.getByRole('button', { name: 'Exit game' }).className).toContain('text-danger');

    for (const name of ['Play', 'Keep this deck']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('text-fg');
      expect(button.className).not.toContain('text-danger');
    }
  });

  it('should give every control a focus-visible style', () => {
    // Class-name level, with the caveat spelled out in `LandingScreen.test.tsx`: it proves the
    // utility is present, not that the ring is legible. What it catches is a fourth control added
    // without one. `focus-visible` rather than `focus` so a mouse press on Play does not leave a
    // ring sitting on the card for the rest of the game.
    render(controls());

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.className).toContain('focus-visible:focus-ring');
    }
  });

  it('should meet the touch-target minimum on every control', () => {
    // 44px square, from `--size-touch-target`. These were `px-4 py-2` around a single glyph --
    // roughly 40px tall and narrower than that wide -- on the surface a thumb is most likely to be
    // near while swiping a card.
    //
    // Class-name level again, and here the caveat bites hardest: jsdom computes no layout, so this
    // cannot measure 44 of anything. It asserts the utility is applied; that the utility MEANS
    // 44px is asserted in `src/index.css` and checked by the manual pass.
    render(controls());

    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('touch-target');
    }
  });

  it('should size every control from the button token as well as the touch floor', () => {
    // The enlargement of 2026-08-11. `touch-target` is a `min-*` FLOOR, so before this the buttons
    // were 44px because the floor said so rather than because anything chose a size -- which is
    // why "make them bigger" had nowhere to be written. Both are asserted: the token is the size,
    // the floor is the guarantee, and dropping either is a silent regression in jsdom.
    render(controls());

    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('size-(--size-control-button)');
      expect(button.className).toContain('touch-target');
    }
  });

  it('should space the row against the card rather than with a hand-set gap', () => {
    // ===================================================================
    //  THE 2026-08-11 SPACING REQUEST: the gap BETWEEN two buttons and the
    //  gap from the outer two to the CARD'S SIDES must be the same.
    //
    //  `gap-3` could not express it -- it sets the two inner gaps and says
    //  nothing about the outer two, which were whatever centring a
    //  hug-width row in the screen happened to leave. `justify-evenly` on a
    //  row that is exactly `--card-width` wide splits the leftover into
    //  four equal parts, so the requirement holds by construction and keeps
    //  holding when the button token changes.
    //
    //  jsdom computes no layout, so this is class-name level with the usual
    //  caveat: it cannot measure that the four gaps are equal. It catches
    //  the two edits that would break the rule while looking tidier -- a
    //  `gap-*` put back on the row, or the row's width dropped back to
    //  hug-content. The stylesheet end (button = card/5) is pinned in
    //  `src/index.css.test.ts`.
    // ===================================================================
    const { container } = render(controls());

    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('w-(--card-width)');

    const row = screen.getByRole('button', { name: 'Play' }).parentElement;
    expect(row?.className).toContain('w-full');
    expect(row?.className).toContain('justify-evenly');
    // A gap utility here would reintroduce the asymmetry: two gaps set by hand, two left over.
    expect(row?.className ?? '').not.toMatch(/(?:^|\s)gap-/);
  });

  it('should invoke play and pause on the toggle', () => {
    const audio = stubAudio();
    const { rerender } = render(controls({ audio }));

    screen.getByRole('button', { name: 'Play' }).click();
    expect(audio.play).toHaveBeenCalledTimes(1);

    const playing = stubAudio({ isPlaying: true });
    rerender(controls({ audio: playing }));
    screen.getByRole('button', { name: 'Pause' }).click();
    expect(playing.pause).toHaveBeenCalledTimes(1);
  });

  it('should not render a restart control', () => {
    // Removed 2026-08-11. Asserted by ABSENCE rather than left to the exhaustive-names test alone,
    // because a re-added Restart would also need `useCardAudio.restart` back and the `ended` rewind
    // re-checked -- this is the assertion that says the removal was a decision.
    render(controls());

    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
  });

  it('should show a spinner in the play button while the preview is loading', () => {
    // The fix for "the first press on Play does nothing". The element is `preload="none"`, so the
    // first press starts a cold fetch and there was no feedback for it at all.
    const { container } = render(
      controls({ audio: stubAudio({ isPlaying: true, isLoading: true }) }),
    );

    const play = screen.getByRole('button', { name: 'Pause' });
    expect(play.querySelector('[data-motion="spinner"]')).not.toBeNull();
    // Nowhere else: the other two controls are not waiting on anything.
    expect(container.querySelectorAll('[data-motion="spinner"]')).toHaveLength(1);
  });

  it('should render no spinner when the preview is not loading', () => {
    const { container } = render(controls());

    expect(container.querySelector('[data-motion="spinner"]')).toBeNull();
  });

  it('should keep the icon under the spinner so the button is never empty', () => {
    // ===================================================================
    //  THE REDUCED-MOTION TRAP, AND IT IS THE REASON THIS TEST EXISTS.
    //
    //  `prefers-reduced-motion: reduce` HIDES the spinner outright
    //  (`display: none`, keyed on `data-motion="spinner"`) rather than
    //  stopping it. A button whose only content was the spinner would
    //  therefore render as a completely EMPTY circle for those players --
    //  and jsdom evaluates no media query, so nothing else here could
    //  catch it. Removing the node is how both existing spinner callers
    //  test the same rule.
    // ===================================================================
    render(controls({ audio: stubAudio({ isPlaying: true, isLoading: true }) }));

    const play = screen.getByRole('button', { name: 'Pause' });
    play.querySelector('[data-motion="spinner"]')?.remove();

    expect(play.querySelectorAll('svg')).toHaveLength(1);
  });

  it('should keep the play control pressable while loading', () => {
    // "Always pressable" is the requirement, and disabling during the wait is the obvious-looking
    // change that recreates the original bug one press later: the press that gets swallowed simply
    // moves from the first to the second. A press here CANCELS, which is why it is `pause`.
    // `isPlaying` is true alongside `isLoading`: the hook sets the intent optimistically on the
    // press, so the button is already showing Pause while the fetch is in flight.
    const audio = stubAudio({ isPlaying: true, isLoading: true });
    render(controls({ audio }));

    const play = screen.getByRole('button', { name: 'Pause' });
    expect((play as HTMLButtonElement).disabled).toBe(false);
    expect(play.getAttribute('aria-busy')).toBe('true');

    play.click();
    expect(audio.pause).toHaveBeenCalledTimes(1);
  });
});
