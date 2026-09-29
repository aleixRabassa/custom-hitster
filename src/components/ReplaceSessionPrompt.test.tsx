/**
 * @vitest-environment jsdom
 *
 * The keep-or-replace question asked when a share link is opened over a saved game (D4). What these
 * pin is the part that protects the saved game: Keep is the focused default, both answers are
 * refused while the link loads, and a failed fetch leaves Keep working and says the game is intact.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReplaceSessionPrompt } from './ReplaceSessionPrompt';
import type { ReplaceSessionPromptProps } from './ReplaceSessionPrompt';
import { auditableText } from './__fixtures__/auditable-text';
import { COPY, COPYRIGHT_NOTICE } from '../game/copy';
import { CATALOGUES } from '../game/i18n';
import { PLAYLIST_ERROR_MESSAGES } from '../game/messages';
import { LocaleContext } from '../hooks/useLocale';

function renderPrompt(overrides: Partial<ReplaceSessionPromptProps> = {}) {
  const props: ReplaceSessionPromptProps = {
    onKeep: vi.fn(),
    onReplace: vi.fn(),
    isLoading: false,
    ...overrides,
  };

  return { ...render(<ReplaceSessionPrompt {...props} />), props };
}

function keepButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: COPY.replaceSession.keep }) as HTMLButtonElement;
}

describe('ReplaceSessionPrompt', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should ask the question with both answers', () => {
    renderPrompt();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(COPY.replaceSession.heading);
    expect(screen.queryByText(COPY.replaceSession.body)).not.toBeNull();
    expect(keepButton()).not.toBeNull();
    expect(screen.queryByRole('button', { name: COPY.replaceSession.replace })).not.toBeNull();
    // Nothing has failed, so there is nothing to announce.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should put Keep first and give it focus on arrival', () => {
    // The safe answer, as Cancel is in `ExitConfirmDialog`: this screen appears on page load, and an
    // Enter pressed reflexively must keep the game the player already had.
    renderPrompt();

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toBe(keepButton());
    expect(document.activeElement).toBe(keepButton());
  });

  it('should call onKeep and onReplace from their own buttons only', () => {
    const { props } = renderPrompt();

    fireEvent.click(keepButton());
    expect(props.onKeep).toHaveBeenCalledTimes(1);
    expect(props.onReplace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: COPY.replaceSession.replace }));
    expect(props.onReplace).toHaveBeenCalledTimes(1);
    expect(props.onKeep).toHaveBeenCalledTimes(1);
  });

  it('should disable both answers and show a spinner beside a label while the link loads', () => {
    const { container, props } = renderPrompt({ isLoading: true });

    const replacing = screen.getByRole('button', {
      name: COPY.replaceSession.replacing,
    }) as HTMLButtonElement;

    expect(replacing.disabled).toBe(true);
    expect(keepButton().disabled).toBe(true);
    // The spinner is inside the button that is loading, and the LABEL is still there beside it:
    // reduced motion hides the spinner, so the text is what carries the state.
    expect(replacing.querySelector('[data-motion="spinner"]')).not.toBeNull();
    expect(replacing.textContent).toBe(COPY.replaceSession.replacing);
    expect(container.querySelectorAll('[data-motion="spinner"]')).toHaveLength(1);

    fireEvent.click(replacing);
    fireEvent.click(keepButton());
    expect(props.onReplace).not.toHaveBeenCalled();
    expect(props.onKeep).not.toHaveBeenCalled();
  });

  it('should render no spinner when nothing is loading', () => {
    const { container } = renderPrompt();

    expect(container.querySelector('[data-motion="spinner"]')).toBeNull();
  });

  it('should report a failed fetch, keep Keep working and offer a retry', () => {
    const { props } = renderPrompt({ errorCode: 'not-found-or-private' });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(PLAYLIST_ERROR_MESSAGES['not-found-or-private']);
    // The deck never dealt, so the saved game was never replaced -- and the screen says so.
    expect(alert.textContent).toContain(COPY.replaceSession.savedGameIntact);

    expect(keepButton().disabled).toBe(false);
    fireEvent.click(keepButton());
    expect(props.onKeep).toHaveBeenCalledTimes(1);

    // The replace button is a retry now, and pressing it asks again.
    expect(screen.queryByRole('button', { name: COPY.replaceSession.replace })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: COPY.replaceSession.retry }));
    expect(props.onReplace).toHaveBeenCalledTimes(1);
  });

  it('should drop the old error while a retry loads', () => {
    // The alert describes the attempt BEFORE the one in flight; leaving it up under a spinner would
    // say the new attempt had already failed.
    renderPrompt({ errorCode: 'upstream-unavailable', isLoading: true });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: COPY.replaceSession.replacing })).not.toBeNull();
  });

  it('should render the error in the active language', () => {
    render(
      <LocaleContext.Provider value={{ locale: 'ca', ...CATALOGUES.ca, setLocale: () => {} }}>
        <ReplaceSessionPrompt
          onKeep={vi.fn()}
          onReplace={vi.fn()}
          isLoading={false}
          errorCode="offline"
        />
      </LocaleContext.Provider>,
    );

    const { copy, errorMessages } = CATALOGUES.ca;
    expect(screen.getByRole('alert').textContent).toContain(errorMessages.offline);
    expect(screen.getByRole('alert').textContent).toContain(copy.replaceSession.savedGameIntact);
    expect(screen.queryByRole('button', { name: copy.replaceSession.keep })).not.toBeNull();
    expect(screen.queryByRole('button', { name: copy.replaceSession.retry })).not.toBeNull();
  });

  it('should give every button a focus-visible style and a touch target', () => {
    // Class-name level, with the caveat given in full in `LandingScreen.test.tsx`.
    renderPrompt();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.className).toContain('focus-visible:focus-ring');
      expect(button.className).toContain('touch-target');
    }
  });

  it('should host the footer: positioned, with the bottom band reserved', () => {
    // The screen's half of `Footer`'s contract: the footer is `absolute bottom-8`, so this `<main>`
    // must be `relative` and reserve `pb-20`. jsdom computes no layout, so the classes are the
    // whole of what is observable.
    const { container } = renderPrompt();
    const main = container.querySelector('main');

    expect(main?.className).toContain('relative');
    expect(main?.className).toContain('pb-20');
    expect(main?.className).toContain('justify-center');
    expect(container.querySelector('footer')).not.toBeNull();
  });

  it('should carry no year-shaped number', () => {
    // It takes no card, so nothing here can come from one -- and the audit is what makes adding a
    // "the link is for <playlist>" line a decision rather than an accident. The copyright line and
    // the author's URL are subtracted by exact string, the same way every leak proxy subtracts them.
    const { container } = renderPrompt({ errorCode: 'not-found-or-private' });

    const text = auditableText(container)
      .replace(COPYRIGHT_NOTICE, '')
      .replace(COPY.footer.authorUrl, '');

    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
