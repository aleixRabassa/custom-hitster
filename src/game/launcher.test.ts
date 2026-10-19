import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  LAUNCHER_STORAGE_KEY,
  PLAY_PACKAGE_ID,
  PLAY_STORE_URL,
  isPlayGated,
  launcherFromReferrer,
  resolveLauncher,
} from './launcher';

const here = dirname(fileURLToPath(import.meta.url));

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));

  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

const APP_REFERRER = `android-app://${PLAY_PACKAGE_ID}/`;

describe('launcherFromReferrer', () => {
  it.each([
    [APP_REFERRER, 'play'],
    [`android-app://${PLAY_PACKAGE_ID}`, 'play'],
    [`android-app://${PLAY_PACKAGE_ID}/anything/else`, 'play'],
    ['android-app://com.other.app/', 'web'],
    [`android-app://${PLAY_PACKAGE_ID}.evil/`, 'web'],
    [`android-app://x${PLAY_PACKAGE_ID}/`, 'web'],
    ['', 'web'],
    ['https://playlistjitster.vercel.app/', 'web'],
    [`https://${PLAY_PACKAGE_ID}/`, 'web'],
  ])('should read %j as %s', (referrer, expected) => {
    expect(launcherFromReferrer(referrer)).toBe(expected);
  });
});

describe('resolveLauncher', () => {
  it('should remember a play referrer in storage', () => {
    const storage = memory();

    expect(resolveLauncher({ referrer: APP_REFERRER, storage })).toBe('play');
    expect(storage.data.get(LAUNCHER_STORAGE_KEY)).toBe('play');
  });

  it('should stay play on a reload that has lost the referrer', () => {
    const storage = memory({ [LAUNCHER_STORAGE_KEY]: 'play' });

    expect(resolveLauncher({ referrer: '', storage })).toBe('play');
  });

  it('should be web with no referrer and nothing remembered, and write nothing', () => {
    const storage = memory();

    expect(resolveLauncher({ referrer: '', storage })).toBe('web');
    expect(storage.data.size).toBe(0);
  });

  it('should only trust the exact stored value', () => {
    expect(
      resolveLauncher({ referrer: '', storage: memory({ [LAUNCHER_STORAGE_KEY]: 'yes' }) }),
    ).toBe('web');
  });

  it('should still return play from the referrer when the write throws', () => {
    expect(resolveLauncher({ referrer: APP_REFERRER, storage: throwing })).toBe('play');
  });

  it('should be web when the read throws', () => {
    expect(resolveLauncher({ referrer: '', storage: throwing })).toBe('web');
  });

  it('should work with no storage at all', () => {
    expect(resolveLauncher({ referrer: APP_REFERRER, storage: null })).toBe('play');
    expect(resolveLauncher({ referrer: '', storage: null })).toBe('web');
  });
});

describe('isPlayGated', () => {
  it.each([
    [0, 'web', false],
    [1, 'web', true],
    [2, 'web', true],
    [99, 'web', true],
    [0, 'play', false],
    [1, 'play', false],
    [99, 'play', false],
  ] as const)('should read index %i on %s as %s', (currentIndex, launcher, expected) => {
    expect(isPlayGated({ currentIndex, launcher })).toBe(expected);
  });
});

describe('the Play listing', () => {
  it('should name the committed package id', () => {
    // Joins the gate's link and referrer check to the shell: a drifted id would send app players
    // to the gate (the referrer never matches) and everyone else to the wrong listing.
    const raw = readFileSync(join(here, '..', '..', 'android', 'twa-manifest.json'), 'utf8');

    expect((JSON.parse(raw) as { packageId?: unknown }).packageId).toBe(PLAY_PACKAGE_ID);
  });

  it('should link to the listing of that package', () => {
    expect(PLAY_STORE_URL).toBe(
      'https://play.google.com/store/apps/details?id=aleixrabassa.playlistjitster',
    );
  });
});
