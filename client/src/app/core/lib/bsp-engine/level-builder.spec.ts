import { describe, it, expect } from 'vitest';
import { buildBsp, locateSubSector } from './node-builder';
import { MapBuilder } from './level-builder';

describe('MapBuilder', () => {
  it('dedups shared vertices (a square room reuses 4 corners across its 4 walls)', () => {
    const b = new MapBuilder();
    const s = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.solid(0, 0, 0, 4, s);
    b.solid(0, 4, 4, 4, s);
    b.solid(4, 4, 4, 0, s);
    b.solid(4, 0, 0, 0, s);
    const map = b.build();

    expect(map.vertices).toHaveLength(4);
    expect(map.linedefs).toHaveLength(4);
    expect(map.sectors[s].ceilZ).toBe(4);
  });

  it('builds a two-room map a player can be located inside (front = sector on the right)', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.solid(0, 0, 0, 4, a);
    b.solid(0, 4, 4, 4, a);
    b.portal(4, 4, 4, 0, a, c);
    b.solid(4, 0, 0, 0, a);
    b.solid(4, 4, 8, 4, c);
    b.solid(8, 4, 8, 0, c);
    b.solid(8, 0, 4, 0, c);
    const map = buildBsp(b.build());

    expect(locateSubSector(map.root, 2, 2).sector).toBe(a);
    expect(locateSubSector(map.root, 6, 2).sector).toBe(c);
  });

  it('emits a glass wall as a two-sided line flagged `glass`, with the overlay on the middle band', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.glass(4, 4, 4, 0, a, c, 'GLASS');
    const line = b.build().linedefs[0];

    expect(line.back).not.toBeNull();
    expect(line.glass).toBe(true);
    expect(line.front.middleTex).toBe('GLASS');
  });

  it('emits a FENCE as a two-sided line flagged `fence` (renders open, blocks crossing)', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 1.1, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 200 });

    b.fence(4, 4, 4, 0, c, a, 'LOBBY');
    const line = b.build().linedefs[0];

    expect(line.back).not.toBeNull();
    expect(line.fence).toBe(true);
    expect(line.glass).toBeUndefined();
  });

  it('emits a glass PANE as a two-sided line flagged both `glass` and `pane`, overlay on the middle band', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.glassPane(4, 4, 4, 0, a, c, 'GLASS_PANE');
    const line = b.build().linedefs[0];

    expect(line.back).not.toBeNull();
    expect(line.glass).toBe(true);
    expect(line.pane).toBe(true);
    expect(line.front.middleTex).toBe('GLASS_PANE');
  });

  it('emits a sliding door as a two-sided line flagged both `glass` and `sliding`', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.slidingDoor(4, 4, 4, 0, a, c);
    const line = b.build().linedefs[0];

    expect(line.back).not.toBeNull();
    expect(line.glass).toBe(true);
    expect(line.sliding).toBe(true);
  });

  it('emits a zone-portal seam as a ONE-SIDED line carrying its zone + translation', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.zonePortal(0, 8, 8, 8, a, { zone: 'hangar', dx: 10, dy: -30 }, 'LOBBY');
    b.zonePortal(0, 0, 8, 0, a, { zone: 'm2', dx: 0, dy: 0 });
    const map = b.build();

    expect(map.linedefs[0].back).toBeNull();
    expect(map.linedefs[0].zonePortal).toEqual({ zone: 'hangar', dx: 10, dy: -30 });
    expect(map.linedefs[0].front.sector).toBe(a);
    expect(map.linedefs[0].front.middleTex).toBe('LOBBY');
    expect(map.linedefs[1].front.middleTex).toBe('BRICK');
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
