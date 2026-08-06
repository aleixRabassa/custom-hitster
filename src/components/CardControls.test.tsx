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
    play: vi.fn(),
    pause: vi.fn(),
    restart: vi.fn(),
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

  it('should disable play/pause and restart when the track has no preview', () => {
    render(controls({ audio: stubAudio({ canPlay: false }) }));

    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Restart' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
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

  it('should enable play/pause and restart when the track has a preview', () => {
    render(controls());

    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: 'Restart' }) as HTMLButtonElement).disabled).toBe(
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
    // "Keep this deck" is on the list for the same reason the other three are, and it passes the
    // same test: it names the DECK, which the player chose, rather than the card, which they have
    // not seen yet.
    render(controls());

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);

    expect(names).toEqual(['Exit game', 'Play', 'Restart', 'Keep this deck']);
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
    //  catches is the regression that matters -- a fifth control, or a
    //  replacement icon, sized by hand. The deck-actions button added on
    //  2026-08-06 is exactly that case, and it went through `ControlIcon`.
    // ===================================================================
    render(controls());

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);

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
    // must NOT pick the colour up: four red buttons signals nothing.
    //
    // `--color-danger` measures 5.7:1 on `--color-surface-raised`, comfortably past the 3:1 WCAG
    // 1.4.11 asks of a non-text indicator -- computed, not eyeballed, and not observable in jsdom.
    render(controls());

    expect(screen.getByRole('button', { name: 'Exit game' }).className).toContain('text-danger');

    for (const name of ['Play', 'Restart', 'Keep this deck']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('text-fg');
      expect(button.className).not.toContain('text-danger');
    }
  });

  it('should give every control a focus-visible style', () => {
    // Class-name level, with the caveat spelled out in `LandingScreen.test.tsx`: it proves the
    // utility is present, not that the ring is legible. What it catches is a fifth control added
    // without one. `focus-visible` rather than `focus` so a mouse press on Play does not leave a
    // ring sitting on the card for the rest of the game.
    render(controls());

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
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

  it('should invoke play, pause, and restart on their controls', () => {
    const audio = stubAudio();
    const { rerender } = render(controls({ audio }));

    screen.getByRole('button', { name: 'Play' }).click();
    expect(audio.play).toHaveBeenCalledTimes(1);

    screen.getByRole('button', { name: 'Restart' }).click();
    expect(audio.restart).toHaveBeenCalledTimes(1);

    const playing = stubAudio({ isPlaying: true });
    rerender(controls({ audio: playing }));
    screen.getByRole('button', { name: 'Pause' }).click();
    expect(playing.pause).toHaveBeenCalledTimes(1);
  });
});
