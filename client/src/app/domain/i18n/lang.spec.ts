import { describe, expect, it } from 'vitest';
import { LANG } from './lang';

describe('LANG', () => {
  it('exposes the supported language values', () => {
    expect(LANG.FR).toBe('fr');
    expect(LANG.EN).toBe('en');
  });
});
