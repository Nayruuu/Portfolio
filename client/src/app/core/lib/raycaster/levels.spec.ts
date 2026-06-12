import { describe, it, expect } from 'vitest';
import { THEME_CYCLE } from './levels';

describe('THEME_CYCLE', () => {
  it('lists the three themes in order', () => {
    expect(THEME_CYCLE.map((theme) => theme.name)).toEqual(['openspace', 'meeting', 'executive']);
  });

  it('each theme has wall, floor, and ceiling palettes', () => {
    for (const theme of THEME_CYCLE) {
      expect(theme.walls.length).toBeGreaterThanOrEqual(2);
      expect(theme.floors.length).toBeGreaterThanOrEqual(2);
      expect(theme.ceils.length).toBeGreaterThanOrEqual(2);
    }
  });
});
