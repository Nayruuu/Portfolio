import { describe, expect, it } from 'vitest';
import { SHOWROOM } from './level-showroom';

describe('showroom (dev inspection gallery)', () => {
  const things = SHOWROOM.map.things;

  it('keeps the whole decor row present, and the island chair a plain prop_chair', () => {
    const row = things.filter((t) => t.y === 6);

    expect(row.map((t) => [t.type, t.x])).toEqual([
      ['barrel', 6],
      ['prop', 10],
      ['prop_screen', 14],
      ['prop_totem', 18],
      ['prop_chair', 26],
      ['prop_board', 34],
      ['prop_cooler', 38],
    ]);
    expect(things.filter((t) => t.type === 'prop_chair' && t.y !== 6)).toEqual([
      { x: 41, y: 15.5, angle: 3.6, type: 'prop_chair' },
    ]);
  });
});
