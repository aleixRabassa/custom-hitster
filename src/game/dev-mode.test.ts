import { describe, expect, it } from 'vitest';
import {
  DEV_MODE_STORAGE_KEY,
  LOGO_CLICK_WINDOW_MS,
  loadDevMode,
  registerLogoClick,
  saveDevMode,
} from './dev-mode';
import type { LogoClickSequence } from './dev-mode';
import type { StorageLike } from './persistence';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };

  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('loadDevMode / saveDevMode', () => {
  it('is off with nothing stored', () => {
    expect(loadDevMode(memoryStorage())).toBe(false);
  });

  it('round-trips on and off, removing the key when off', () => {
    const storage = memoryStorage();

    saveDevMode(storage, true);
    expect(storage.data[DEV_MODE_STORAGE_KEY]).toBe('on');
    expect(loadDevMode(storage)).toBe(true);

    saveDevMode(storage, false);
    expect(DEV_MODE_STORAGE_KEY in storage.data).toBe(false);
    expect(loadDevMode(storage)).toBe(false);
  });

  it.each(['true', '1', 'ON', 'off', '', '{"on":true}'])('reads %j as off', (garbage) => {
    expect(loadDevMode(memoryStorage({ [DEV_MODE_STORAGE_KEY]: garbage }))).toBe(false);
  });

  it('never throws on a throwing storage', () => {
    expect(loadDevMode(throwingStorage)).toBe(false);
    expect(() => {
      saveDevMode(throwingStorage, true);
      saveDevMode(throwingStorage, false);
    }).not.toThrow();
  });
});

describe('registerLogoClick', () => {
  function run(times: number[]): number {
    let sequence: LogoClickSequence | null = null;
    let triggers = 0;

    for (const at of times) {
      const result = registerLogoClick(sequence, at);
      sequence = result.sequence;
      if (result.triggered) triggers += 1;
    }

    return triggers;
  }

  it('triggers on the third fast click', () => {
    expect(run([0, 100, 200])).toBe(1);
  });

  it('does not trigger on two clicks', () => {
    expect(run([0, 100])).toBe(0);
  });

  it('accepts a gap of exactly the window', () => {
    expect(run([0, LOGO_CLICK_WINDOW_MS, LOGO_CLICK_WINDOW_MS * 2])).toBe(1);
  });

  it('restarts when a gap exceeds the window', () => {
    expect(run([0, 100, 100 + LOGO_CLICK_WINDOW_MS + 1])).toBe(0);
    expect(run([0, 100, 1000, 1100, 1200])).toBe(1);
  });

  it('triggers twice on six fast clicks', () => {
    expect(run([0, 50, 100, 150, 200, 250])).toBe(2);
  });

  it('resets the sequence after a trigger', () => {
    expect(registerLogoClick({ count: 2, lastAtMs: 0 }, 10)).toEqual({
      sequence: null,
      triggered: true,
    });
  });
});
