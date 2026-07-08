import { describe, it, expect } from 'vitest';
import { buildBsp, locateSubSector } from './node-builder';
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

  it('emits a glass wall as a two-sided line flagged `glass`, with the overlay on the middle band', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.glass(4, 4, 4, 0, a, c, 'GLASS'); // a window between the two rooms
    const line = b.build().linedefs[0];

    expect(line.back).not.toBeNull(); // two-sided → see-through
    expect(line.glass).toBe(true); // but flagged glass → blocks the player
    expect(line.front.middleTex).toBe('GLASS'); // the translucent overlay
  });

  it('emits a FENCE as a two-sided line flagged `fence` (renders open, blocks crossing)', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 1.1, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 200 });

    b.fence(4, 4, 4, 0, c, a, 'LOBBY'); // a reception-counter rim: the raised top is visible, never walkable
    const line = b.build().linedefs[0];

    expect(line.back).not.toBeNull(); // two-sided → renders like a portal (you see the counter top over it)
    expect(line.fence).toBe(true); // but flagged fence → the step-up physics may never cross it
    expect(line.glass).toBeUndefined(); // not glass — no tint pass over the opening
  });

  it('emits a glass PANE as a two-sided line flagged both `glass` and `pane`, overlay on the middle band', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.glassPane(4, 4, 4, 0, a, c, 'GLASS_PANE'); // a textured window between the two rooms
    const line = b.build().linedefs[0];

    expect(line.back).not.toBeNull(); // two-sided → see-through
    expect(line.glass).toBe(true); // blocks the player like glass
    expect(line.pane).toBe(true); // and its texture is sampled per pixel (not a flat tint)
    expect(line.front.middleTex).toBe('GLASS_PANE'); // the glass image sampled over the opening
  });

  it('emits a sliding door as a two-sided line flagged both `glass` and `sliding`', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
    const c = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.slidingDoor(4, 4, 4, 0, a, c); // an automatic glass entrance
    const line = b.build().linedefs[0];

    expect(line.back).not.toBeNull(); // two-sided → see-through
    expect(line.glass).toBe(true); // tinted like glass
    expect(line.sliding).toBe(true); // and it slides / is proximity-driven
  });

  it('emits a zone-portal seam as a ONE-SIDED line carrying its zone + translation', () => {
    const b = new MapBuilder();
    const a = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });

    b.zonePortal(0, 8, 8, 8, a, { zone: 'hangar', dx: 10, dy: -30 }, 'LOBBY');
    b.zonePortal(0, 0, 8, 0, a, { zone: 'm2', dx: 0, dy: 0 }); // default fallback texture
    const map = b.build();

    expect(map.linedefs[0].back).toBeNull(); // one-sided → solid for physics + hitscan
    expect(map.linedefs[0].zonePortal).toEqual({ zone: 'hangar', dx: 10, dy: -30 });
    expect(map.linedefs[0].front.sector).toBe(a); // fronts the room on the RIGHT of v1 → v2
    expect(map.linedefs[0].front.middleTex).toBe('LOBBY'); // the solid fallback look
    expect(map.linedefs[1].front.middleTex).toBe('BRICK'); // the default fallback
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
