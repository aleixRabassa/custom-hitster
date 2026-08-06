/**
 * Making a track title safe for a standard PDF font.
 *
 * ===========================================================================
 *  A STANDARD PDF FONT IS WinAnsi-ENCODED AND WILL THROW -- OR WORSE, EMIT
 *  MOJIBAKE -- ON A GLYPH OUTSIDE IT.
 *
 *  This is a likely failure rather than a hypothetical one: the decks this app
 *  is built for come from real Spanish, Latin and international playlists.
 *
 *  MEASURED BEFORE CHOOSING (2026-08-06). WinAnsi is Latin-1 plus a punctuation
 *  block, so it already covers **every Spanish, Portuguese, French, German and
 *  Italian glyph** -- á é í ó ú ü ñ ¡ ¿ ç ã õ are all in it, untouched by
 *  anything here. The real gap is non-Latin scripts (Cyrillic, Greek, CJK,
 *  Korean) and a handful of Latin extras (Polish ł ą, Turkish ğ ş ı).
 *
 *  SO THIS SANITISES RATHER THAN EMBEDDING A FONT (decided 2026-08-06, plan 2's
 *  open question 3). Embedding a Latin-Extended TTF costs 200-400 kB in the
 *  export chunk -- the largest new asset in the app -- to fix Polish and Turkish
 *  while still failing on Cyrillic and CJK, which need a much larger font again.
 *  Zero bytes for a transformation that, on the playlists this app suggests,
 *  never fires.
 *
 *  WHAT THE PLAYER LOSES, stated plainly because it is a real loss and it is
 *  documented in `docs/development.md` §8: a Cyrillic or CJK title prints as
 *  placeholder characters. THE YEAR AND THE QR ARE UNAFFECTED -- digits are
 *  ASCII and the QR is an image -- so the card still plays and still scans to
 *  the right track. The title is a label on a card whose answer is the year.
 * ===========================================================================
 */

/**
 * Typographic characters that have a plain-ASCII equivalent worth preferring.
 *
 * These are all IN WinAnsi, so this map is not about encoding -- it is about print quality and
 * predictability. A curly apostrophe in a real title (`Don't Stop Me Now` as Spotify sends it)
 * renders correctly either way; mapping it means the printed sheet is not at the mercy of which
 * standard font substitution a viewer picks for the 0x80-0x9F range, which is where WinAnsi and
 * Latin-1 disagree.
 */
const PUNCTUATION_REPLACEMENTS: readonly [RegExp, string][] = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[–—―−]/g, '-'],
  [/…/g, '...'],
  /*
    Exotic spaces -- non-breaking, en/em/thin, narrow no-break and ideographic -- written as ESCAPES
    rather than as literals. ESLint's `no-irregular-whitespace` rejects the literal characters in
    source, and rightly: they are indistinguishable from a normal space to anyone reading this file.
  */
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '],
  // Zero-width characters: invisible on screen, and a stray box on paper.
  [/[\u200B-\u200D\uFEFF]/g, ''],
];

/** What an unrepresentable character becomes. One `?` per character, so lengths stay comparable. */
const REPLACEMENT = '?';

/**
 * Letters that NFD cannot help with, mapped by hand.
 *
 * ===========================================================================
 *  A STROKED OR BARRED LETTER HAS NO COMBINING MARK TO DROP.
 *
 *  `ż` decomposes to `z` + a dot above, so step 2 handles it. `ł` does NOT
 *  decompose at all -- the stroke is part of the character -- so it would fall
 *  through to `?` and print Polish as `Zaz?c`. Measured by this module's own
 *  test, which failed against the first version of this function.
 *
 *  Deliberately short. Every entry is a letter whose Latin base is unambiguous
 *  and that turns up in real playlist metadata: Polish `ł`, Croatian/Vietnamese
 *  `đ`, Turkish dotless `ı` and dotted `İ`, Maltese `ħ`, Sami `ŧ`, and the `œ`
 *  ligature. Anything needing a judgement about a language stays a `?`.
 * ===========================================================================
 */
const LETTER_FALLBACKS: Readonly<Record<string, string>> = {
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ı: 'i',
  İ: 'I',
  ħ: 'h',
  Ħ: 'H',
  ŧ: 't',
  Ŧ: 'T',
  ŀ: 'l',
  Ŀ: 'L',
  œ: 'oe',
  Œ: 'OE',
  ſ: 's',
};

/**
 * Is this code point drawable by a standard PDF font?
 *
 * Latin-1 printable: 0x20-0x7E and 0xA0-0xFF. Control characters are excluded rather than passed
 * through -- a `\n` inside a title would break the layout, and 0x7F-0x9F is precisely the range
 * where WinAnsi and Latin-1 disagree, so nothing there may be emitted raw.
 */
function isDrawable(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;

  return codePoint >= 0xa0 && codePoint <= 0xff;
}

/**
 * Turn any string into one a standard PDF font can draw.
 *
 * Three steps, in order, and the order matters:
 *
 * 1. Map typographic punctuation to ASCII (see above).
 * 2. For a character outside the drawable range, take the hand-written fallback if there is one
 *    (`ł` → `l`; see `LETTER_FALLBACKS`), otherwise try NFD decomposition and drop the combining
 *    marks -- so `ș` becomes `s`, which is legible and right.
 * 3. Anything still outside the range becomes `?`. That is Cyrillic, Greek, CJK and emoji: there is
 *    no Latin fallback for them, and inventing a transliteration would be a guess about a language
 *    this app cannot detect.
 *
 * Never throws, for any input: it is called on data from an unofficial upstream payload.
 */
export function sanitizeForPdf(text: string): string {
  if (typeof text !== 'string' || text === '') return '';

  let normalized = text.normalize('NFC');
  for (const [pattern, replacement] of PUNCTUATION_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  let out = '';
  // `for..of` iterates by CODE POINT, so an astral character (an emoji) is one iteration rather
  // than two lone surrogates -- which would otherwise emit two `?` for one glyph.
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (isDrawable(codePoint)) {
      out += character;
      continue;
    }

    const fallback = LETTER_FALLBACKS[character];
    if (fallback !== undefined) {
      out += fallback;
      continue;
    }

    // Strip the accent and keep the letter. `\p{M}` is every combining mark, which is what NFD
    // produces for a precomposed accented character.
    const stripped = character.normalize('NFD').replace(/\p{M}/gu, '');
    const isStrippedDrawable =
      stripped !== '' && [...stripped].every((c) => isDrawable(c.codePointAt(0) ?? 0));

    out += isStrippedDrawable ? stripped : REPLACEMENT;
  }

  return out;
}

/**
 * A filename for the downloaded PDF, built from the playlist's name.
 *
 * ASCII, lowercase, hyphenated, bounded, and never empty -- a filename reaches the OS, and a name
 * containing `/` or `:` is rejected outright by some of them. The playlist name is playlist-level
 * data, so it is safe to put in a filename the player can see in their downloads list.
 *
 * ===========================================================================
 *  THE ACCENT STRIP HERE IS A SECOND, STRICTER PASS, AND IT IS NOT REDUNDANT.
 *
 *  `sanitizeForPdf` KEEPS `É`, correctly -- WinAnsi can draw it. A filename
 *  cannot: the `[^a-z0-9]` filter below would then delete it outright, and
 *  "Éxitos Verano" became `hitster-xitos-verano.pdf` with the first letter of the
 *  playlist silently missing. Measured by this module's own test.
 * ===========================================================================
 */
export function pdfFileName(playlistName: string): string {
  const slug = sanitizeForPdf(playlistName)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `hitster-${slug === '' ? 'deck' : slug}.pdf`;
}
