/**
 * @vitest-environment jsdom
 *
 * A segmented control over `LOCALES`: one pressed button, the rest a tap away, and the names in
 * their own language. Asserted against `COPY`/`LANGUAGE_NAMES`, never a literal.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageSelector } from './LanguageSelector';
import { COPY } from '../game/copy';
import { LANGUAGE_NAMES, LOCALES, type Locale } from '../game/locale';

function renderSelector(locale: Locale = 'en') {
  const onChange = vi.fn();
  render(<LanguageSelector locale={locale} onChange={onChange} />);

  return { onChange, group: screen.getByRole('group', { name: COPY.language.label }) };
}

describe('LanguageSelector', () => {
  afterEach(cleanup);

  it('should render one button per locale, in order, each named in its own language', () => {
    const { group } = renderSelector();
    const buttons = within(group).getAllByRole('button');

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(
      LOCALES.map((locale) => LANGUAGE_NAMES[locale]),
    );
    // `lang` is what makes a screen reader pronounce each name in its own language.
    expect(buttons.map((button) => button.getAttribute('lang'))).toEqual([...LOCALES]);
    for (const button of buttons) expect(button.getAttribute('type')).toBe('button');
  });

  it.each(LOCALES)('should mark only the active locale as pressed (%s)', (active) => {
    renderSelector(active);

    for (const locale of LOCALES) {
      const button = screen.getByRole('button', { name: LANGUAGE_NAMES[locale] });
      expect(button.getAttribute('aria-pressed')).toBe(String(locale === active));
    }
  });

  it('should report another locale when it is pressed', () => {
    const { onChange } = renderSelector('en');

    fireEvent.click(screen.getByRole('button', { name: LANGUAGE_NAMES.es }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('es');
  });

  it('should do nothing when the active locale is pressed again', () => {
    const { onChange } = renderSelector('ca');

    fireEvent.click(screen.getByRole('button', { name: LANGUAGE_NAMES.ca, pressed: true }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should draw each option as a decorative SVG flag with no text of its own', () => {
    const { group } = renderSelector();

    for (const button of within(group).getAllByRole('button')) {
      // An emoji flag renders as two letters on Windows; the flag must be an inline SVG.
      expect(button.textContent).toBe('');
      const flag = button.querySelector('svg');
      expect(flag).not.toBeNull();
      expect(flag?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('should give every button a focus-visible style and a touch target', () => {
    const { group } = renderSelector();

    for (const button of within(group).getAllByRole('button')) {
      expect(button.className).toContain('focus-visible:focus-ring');
      expect(button.className).toContain('touch-target');
    }
  });

  it('should disable every option when asked, and enable them by default', () => {
    // The picker passes `disabled` while a request is loading; the welcome screen never does.
    const onChange = vi.fn();
    const { rerender } = render(<LanguageSelector locale="en" onChange={onChange} disabled />);

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }

    rerender(<LanguageSelector locale="en" onChange={onChange} />);

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });
});
