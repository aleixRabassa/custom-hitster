import { describe, expect, it } from 'vitest';

import { primaryArtistGuess } from './artists';

describe('primaryArtistGuess', () => {
  it('should return the sole artist unchanged for a single-artist subtitle', () => {
    expect(primaryArtistGuess('Ariana Grande')).toBe('Ariana Grande');
    expect(primaryArtistGuess('Ramones')).toBe('Ramones');
    expect(primaryArtistGuess('  Nirvana  ')).toBe('Nirvana');
  });

  it('should take the first artist from a comma-joined subtitle', () => {
    expect(primaryArtistGuess('Calvin Harris, Dua Lipa')).toBe('Calvin Harris');
    expect(primaryArtistGuess('Kendrick Lamar, SZA, Blxst')).toBe('Kendrick Lamar');
  });

  it('should not split artist names that themselves contain a separator', () => {
    // `&` and `+` are never treated as separators, so these two are exactly right --
    // which is the reason the plan's "trim a trailing &-joined tail" step was
    // narrowed rather than implemented literally.
    expect(primaryArtistGuess('Simon & Garfunkel')).toBe('Simon & Garfunkel');
    expect(primaryArtistGuess('Florence + The Machine')).toBe('Florence + The Machine');
    expect(primaryArtistGuess('Bob Marley & The Wailers')).toBe('Bob Marley & The Wailers');

    // KNOWN LIMITATION, asserted rather than fixed: a comma inside a real artist name
    // is indistinguishable from Spotify's own multi-artist join, so the guess truncates
    // these. It is harmless only because plan.phase-2-year.md queries the FULL joined
    // string first and reaches the guess only after that returns zero results --
    // "Earth, Wind & Fire" matches on the full string and never gets here. If that
    // ordering is ever reversed, these two lines become wrong years on real cards.
    expect(primaryArtistGuess('Earth, Wind & Fire')).toBe('Earth');
    expect(primaryArtistGuess('Tyler, The Creator')).toBe('Tyler');
  });

  it('should strip a feat./with tail from the guess', () => {
    // A featured artist in the subtitle harms the MusicBrainz artist match.
    expect(primaryArtistGuess('Drake feat. Rihanna')).toBe('Drake');
    expect(primaryArtistGuess('Eminem ft. Dido')).toBe('Eminem');
    expect(primaryArtistGuess('Mark Ronson featuring Bruno Mars')).toBe('Mark Ronson');
    expect(primaryArtistGuess('Kanye West (feat. Jay-Z)')).toBe('Kanye West');
    expect(primaryArtistGuess('Santana (with Rob Thomas)')).toBe('Santana');
    expect(primaryArtistGuess('Post Malone with Swae Lee, Someone Else')).toBe('Post Malone');

    // A name that merely ends in the letters "ft" is not a feature tail.
    expect(primaryArtistGuess('Daft Punk')).toBe('Daft Punk');
  });

  it('should handle an empty subtitle without throwing', () => {
    expect(primaryArtistGuess('')).toBe('');
    expect(primaryArtistGuess('   ')).toBe('');
    expect(primaryArtistGuess(undefined as unknown as string)).toBe('');

    // Degenerate but real-shaped: stripping must never leave an empty query term.
    expect(primaryArtistGuess('(feat. Rihanna)')).toBe('(feat. Rihanna)');
    expect(primaryArtistGuess(',')).toBe(',');
  });
});
