import { describe, expect, it } from 'vitest';
import { DATA_THEME_ATTR, STORAGE_KEYS } from './constants';

describe('constants', () => {
  it('exposes storage keys and the data-theme attribute', () => {
    expect(STORAGE_KEYS.LANG).toBe('super-dev-lang');
    expect(STORAGE_KEYS.THEME).toBe('super-dev-theme');
    expect(STORAGE_KEYS.REVIEWS).toBe('super-dev-reviews');
    expect(DATA_THEME_ATTR).toBe('data-theme');
  });
});
