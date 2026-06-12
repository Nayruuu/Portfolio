import { describe, expect, it } from 'vitest';
import { THEME } from './theme';

describe('THEME', () => {
  it('exposes the supported theme values', () => {
    expect(THEME.LIGHT).toBe('light');
    expect(THEME.DARK).toBe('dark');
  });
});
