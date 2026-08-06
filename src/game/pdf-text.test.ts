/** Node environment: string arithmetic, no jsPDF and no DOM. */

import { describe, expect, it } from 'vitest';

import { pdfFileName, sanitizeForPdf } from './pdf-text';

describe('sanitizeForPdf', () => {
  it('should leave Spanish and other Latin-1 titles untouched', () => {
    // ===================================================================
    //  THE MEASUREMENT BEHIND THE SANITISE-RATHER-THAN-EMBED DECISION.
    //
    //  WinAnsi already covers every Spanish, Portuguese, French, German and
    //  Italian glyph, and these are the playlists this app is actually built
    //  for -- four of the nine suggestions are Spanish or Latin. So the
    //  common case must be a NO-OP, and if this test ever fails the decision
    //  itself is wrong.
    // ===================================================================
    for (const title of [
      'Cariño',
      'Bailando',
      '¿Dónde Están los Ladrones?',
      'Là-bas',
      'Über den Wolken',
      'Ça plane pour moi',
      'Não Vou Ficar',
      'AC/DC — Highway',
    ]) {
      // The em dash is the one character transformed here, and only to a hyphen.
      expect(sanitizeForPdf(title)).toBe(title.replace('—', '-'));
    }
  });

  it('should strip diacritics it cannot draw', () => {
    // Polish and Turkish: outside WinAnsi, but every one of them has an obvious Latin base letter.
    //
    // Note what is NOT transformed: `ó` survives, because WinAnsi can draw it. Only the characters
    // outside the encoding are touched, which is why the Spanish case above is a no-op.
    expect(sanitizeForPdf('Zażółć gęślą jaźń')).toBe('Zazólc gesla jazn');
    expect(sanitizeForPdf('Şarkı')).toBe('Sarki');
  });

  it('should map stroked letters that have no combining mark', () => {
    // ===================================================================
    //  A STROKED LETTER DOES NOT DECOMPOSE, so NFD cannot help and it would
    //  fall through to `?`. This test failed against the first version of the
    //  sanitiser, which printed Polish as `Zaz?c`.
    // ===================================================================
    expect(sanitizeForPdf('Łódź')).toBe('Lódz');
    expect(sanitizeForPdf('Đorđe')).toBe('Dorde');
    expect(sanitizeForPdf('Cœur')).toBe('Coeur');
  });

  it('should replace a script with no Latin fallback', () => {
    // Cyrillic, Greek, CJK and emoji: `?` per CHARACTER, and one `?` for an astral emoji rather than
    // two -- iteration is by code point precisely so a surrogate pair is not counted twice.
    expect(sanitizeForPdf('Дискотека')).toBe('?????????');
    expect(sanitizeForPdf('夜に駆ける')).toBe('?????');
    expect(sanitizeForPdf('party 🎉')).toBe('party ?');
  });

  it('should map typographic punctuation to ASCII', () => {
    expect(sanitizeForPdf('Don’t Stop Me Now')).toBe("Don't Stop Me Now");
    expect(sanitizeForPdf('“Heroes”')).toBe('"Heroes"');
    expect(sanitizeForPdf('Rock … Roll')).toBe('Rock ... Roll');
    // A non-breaking space becomes a plain one, and a zero-width joiner disappears entirely: it is
    // invisible on screen and a stray box on paper.
    expect(sanitizeForPdf('A B‍')).toBe('A B');
  });

  it('should drop control characters rather than drawing them', () => {
    // A newline inside a title would break the card's layout, and 0x7F-0x9F is exactly where WinAnsi
    // and Latin-1 disagree -- nothing in that range may be emitted raw.
    expect(sanitizeForPdf('Line\nBreak')).toBe('Line?Break');
    expect(sanitizeForPdf('Tab\tHere')).toBe('Tab?Here');
  });

  it('should never throw, for any input', () => {
    for (const input of ['', 'x'.repeat(5000), '\u{10FFFF}', '\ud800']) {
      expect(() => sanitizeForPdf(input)).not.toThrow();
    }
    expect(sanitizeForPdf('')).toBe('');
  });
});

describe('pdfFileName', () => {
  it('should build an ASCII slug from the playlist name', () => {
    expect(pdfFileName('Éxitos Verano 2000s & 2010s')).toBe(
      'hitster-exitos-verano-2000s-2010s.pdf',
    );
    expect(pdfFileName('This is Duki (all songs)')).toBe('hitster-this-is-duki-all-songs.pdf');
  });

  it('should never produce an empty or path-bearing name', () => {
    // A filename reaches the OS, and `/` or `:` is rejected outright by some of them.
    expect(pdfFileName('')).toBe('hitster-deck.pdf');
    expect(pdfFileName('///')).toBe('hitster-deck.pdf');
    expect(pdfFileName('夜に駆ける')).toBe('hitster-deck.pdf');
    expect(pdfFileName('a/b:c')).toBe('hitster-a-b-c.pdf');
  });

  it('should bound the length', () => {
    const name = pdfFileName('x'.repeat(500));

    expect(name.length).toBeLessThanOrEqual('hitster-.pdf'.length + 60);
  });
});
