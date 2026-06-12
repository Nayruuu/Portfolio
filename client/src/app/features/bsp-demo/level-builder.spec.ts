import { describe, it, expect } from 'vitest';
import { buildBsp, locateSubSector } from '../../core/lib/bsp-engine';
import { MapBuilder } from './level-builder';

describe('MapBuilder', () => {
  it('dedups shared vertices (a square room reuses 4 corners across its 4 walls)', () => {
    const b = new MapBuilder();
    const s = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.solid(0, 0, 0, 4, s); // W
    b.solid(0, 4, 4, 4, s); // N
    b.solid(4, 4, 4, 0, s); // E
    b.solid(4, 0, 0, 0, s); // S
    const map = b.build();

    expect(map.vertices).toHaveLength(4); // 4 corners, not 8 — endpoints deduped
    expect(map.linedefs).toHaveLength(4);
    expect(map.sectors[s].ceilZ).toBe(4);
  });

  it('builds a two-room map a player can be located inside (front = sector on the right)', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    // Room A = x[0..4], Room C = x[4..8], sharing the x=4 edge as a portal.
    b.solid(0, 0, 0, 4, a);
    b.solid(0, 4, 4, 4, a);
    b.portal(4, 4, 4, 0, a, c); // shared edge: right of (4,4)→(4,0) is -x = room A
    b.solid(4, 0, 0, 0, a);
    b.solid(4, 4, 8, 4, c);
    b.solid(8, 4, 8, 0, c);
    b.solid(8, 0, 4, 0, c);
    const map = buildBsp(b.build());

    expect(locateSubSector(map.root, 2, 2).sector).toBe(a); // inside room A
    expect(locateSubSector(map.root, 6, 2).sector).toBe(c); // inside room C
  });

  it('records things verbatim', () => {
    const b = new MapBuilder();

    b.thing(3, 5, 0, 'player_start');
    b.thing(7, 2, 1, 'barrel');
    const map = b.build();

    expect(map.things).toEqual([
      { x: 3, y: 5, angle: 0, type: 'player_start' },
      { x: 7, y: 2, angle: 1, type: 'barrel' },
    ]);
  });
});
