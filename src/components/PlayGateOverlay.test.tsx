/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlayGateOverlay } from './PlayGateOverlay';
import { COPY } from '../game/copy';
import { PLAY_STORE_URL } from '../game/launcher';
import { fixtureDeck } from './__fixtures__/cards';

afterEach(cleanup);

function renderOverlay(onEndGame = vi.fn()) {
  render(<PlayGateOverlay onEndGame={onEndGame} />);

  return { onEndGame };
}

const link = () => screen.getByRole('link', { name: COPY.playGate.install });
const endButton = () => screen.getByRole('button', { name: COPY.playGate.endGame });

describe('PlayGateOverlay', () => {
  it('should be a modal dialog named and described by the copy', () => {
    renderOverlay();

    const dialog = screen.getByRole('dialog', { name: COPY.playGate.title });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBe('play-gate-description');
    expect(document.getElementById('play-gate-description')?.textContent).toBe(COPY.playGate.body);
  });

  it('should link to the Play listing in the same tab', () => {
    renderOverlay();

    expect(link().getAttribute('href')).toBe(PLAY_STORE_URL);
    expect(link().hasAttribute('target')).toBe(false);
  });

  it('should call back when End game is pressed', () => {
    const { onEndGame } = renderOverlay();

    fireEvent.click(endButton());

    expect(onEndGame).toHaveBeenCalledTimes(1);
  });

  it('should focus the install link on mount', () => {
    renderOverlay();

    expect(document.activeElement).toBe(link());
  });

  it('should keep Tab and Shift+Tab inside the two controls', () => {
    renderOverlay();

    fireEvent.keyDown(link(), { key: 'Tab' });
    expect(document.activeElement).toBe(endButton());

    fireEvent.keyDown(endButton(), { key: 'Tab' });
    expect(document.activeElement).toBe(link());

    fireEvent.keyDown(link(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(endButton());
  });

  it('should not dismiss on Escape or on a backdrop press', () => {
    const { onEndGame } = renderOverlay();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(link(), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('play-gate-backdrop'));

    expect(onEndGame).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: COPY.playGate.title })).not.toBeNull();
  });

  it('should blur the page behind it, below the dialogs', () => {
    renderOverlay();

    const classes = screen.getByTestId('play-gate-backdrop').className.split(/\s+/);
    expect(classes).toContain('backdrop-blur-md');
    expect(classes).toContain('z-40');
    expect(classes).not.toContain('z-50');
  });

  it('should not name any track', () => {
    const { container } = render(<PlayGateOverlay onEndGame={vi.fn()} />);
    const text = container.textContent ?? '';

    for (const card of fixtureDeck) {
      expect(text).not.toContain(card.title);
      expect(text).not.toContain(card.artist);
      if (typeof card.year === 'number') expect(text).not.toContain(String(card.year));
    }

    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
