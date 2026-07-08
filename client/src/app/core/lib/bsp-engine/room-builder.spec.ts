import { describe, it, expect } from 'vitest';
import { buildBsp, locateSubSector } from './node-builder';
import { RoomBuilder } from './room-builder';
import type { RoomPoint, RoomSpec } from './room-builder';
import type { LineDef, MapSource } from './types';

/** A plain room spec — geometry is what these tests exercise, the dressing is a constant. */
const SPEC: RoomSpec = {
  floorZ: 0,
  ceilZ: 4,
  floorTex: 'FLOOR',
  ceilTex: 'CEIL',
  light: 200,
  wallTex: 'WALL',
};

/** The 4-corner polygon of an axis-aligned rectangle, `(x1,y1)` = NW corner, `(x2,y2)` = SE. */
const rect = (x1: number, y1: number, x2: number, y2: number): readonly RoomPoint[] => [
  [x1, y1],
  [x1, y2],
  [x2, y2],
  [x2, y1],
];

/** A linedef with its endpoints resolved to coordinates, for geometry assertions. */
interface ResolvedLine {
  readonly line: LineDef;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function resolve(map: MapSource): ResolvedLine[] {
  return map.linedefs.map((line) => ({
    line,
    x1: map.vertices[line.v1].x,
    y1: map.vertices[line.v1].y,
    x2: map.vertices[line.v2].x,
    y2: map.vertices[line.v2].y,
  }));
}

/** All lines lying on the horizontal `y = value`, sorted by their west end. */
function onY(map: MapSource, value: number): ResolvedLine[] {
  return resolve(map)
    .filter((l) => l.y1 === value && l.y2 === value)
    .sort((l, m) => Math.min(l.x1, l.x2) - Math.min(m.x1, m.x2));
}

describe('RoomBuilder', () => {
  it('normalizes polygon winding: either orientation puts the interior on the right of every wall', () => {
    const clockwise = rect(0, 0, 4, 4); // the canonical hand-authored winding
    const counterClockwise = [...clockwise].reverse();

    for (const polygon of [clockwise, counterClockwise]) {
      const b = new RoomBuilder();
      const s = b.room(polygon, SPEC);
      const map = b.build();

      for (const { line, x1, y1, x2, y2 } of resolve(map)) {
        expect(line.front.sector).toBe(s);
        expect(line.back).toBeNull();
        // The interior centroid (2,2) on the RIGHT of v1→v2: cross(direction, centroid - v1) < 0.
        expect((x2 - x1) * (2 - y1) - (y2 - y1) * (2 - x1)).toBeLessThan(0);
      }
      expect(locateSubSector(buildBsp(map).root, 2, 2).sector).toBe(s); // and the BSP agrees
    }
  });

  it('keeps `walls` overrides on the same geometric edge when it reverses a mis-wound polygon', () => {
    const b = new RoomBuilder();

    // Counter-clockwise input; edge 1 = (4,0) → (4,4) is the EAST wall whatever the final winding.
    b.room(
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      { ...SPEC, walls: { 1: 'WOOD' } },
    );
    const east = resolve(b.build()).find((l) => l.x1 === 4 && l.x2 === 4);

    expect(east?.line.front.middleTex).toBe('WOOD');
  });

  it('splits a partial shared boundary into solid / opening / solid around the doorway', () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 8, 4), SPEC); // a long south wall y=4, x0..8
    const c = b.room(rect(2, 4, 6, 8), SPEC); // a narrower room below, x2..6

    b.connect(a, c);
    const boundary = onY(b.build(), 4);

    expect(boundary).toHaveLength(3); // solid before, opening within, solid after
    expect(boundary.map((l) => [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)])).toEqual([
      [0, 2],
      [2, 6],
      [6, 8],
    ]);
    expect(boundary[0].line.back).toBeNull();
    expect(boundary[1].line.back?.sector).toBe(c); // the doorway, fronting room a
    expect(boundary[1].line.front.sector).toBe(a);
    expect(boundary[2].line.back).toBeNull();
  });

  it("restricts the opening to the 'at' sub-span, walling up the rest on BOTH sides", () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 8, 4), SPEC);
    const c = b.room(rect(0, 4, 8, 8), SPEC); // full shared edge x0..8…

    b.connect(a, c, {
      at: [3, 4, 5, 4],
    }); // …but the door is only x3..5
    const boundary = onY(b.build(), 4);
    const openings = boundary.filter((l) => l.line.back !== null);
    const solids = boundary.filter((l) => l.line.back === null);

    expect(openings).toHaveLength(1);
    expect([
      Math.min(openings[0].x1, openings[0].x2),
      Math.max(openings[0].x1, openings[0].x2),
    ]).toEqual([3, 5]);
    expect(solids).toHaveLength(4); // x0..3 + x5..8, once per room — the unconnected rest stays walled
    expect(solids.filter((l) => l.line.front.sector === a)).toHaveLength(2);
    expect(solids.filter((l) => l.line.front.sector === c)).toHaveLength(2);
  });

  it('carves a zone-portal seam out of a wall: solid / live seam / solid, one-sided, fronting the room', () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 8, 8), SPEC);

    b.zonePortal(a, [3, 8, 5, 8], { zone: 'hangar', dx: 10, dy: -30 });
    const boundary = onY(b.build(), 8);

    expect(boundary).toHaveLength(3); // solid before, the live seam, solid after
    expect(boundary.map((l) => [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)])).toEqual([
      [0, 3],
      [3, 5],
      [5, 8],
    ]);
    expect(boundary[1].line.zonePortal).toEqual({ zone: 'hangar', dx: 10, dy: -30 });
    expect(boundary[1].line.back).toBeNull(); // one-sided → solid for physics + hitscan
    expect(boundary[1].line.front.sector).toBe(a); // fronts the room
    expect(boundary[1].line.front.middleTex).toBe('WALL'); // fallback look = the wall's own texture
    expect(boundary[0].line.zonePortal).toBeUndefined();
    expect(boundary[2].line.zonePortal).toBeUndefined();

    // An explicit `tex` overrides the fallback look.
    const b2 = new RoomBuilder();
    const a2 = b2.room(rect(0, 0, 8, 8), SPEC);

    b2.zonePortal(a2, [3, 8, 5, 8], { zone: 'hangar', dx: 0, dy: 0 }, 'DAMAGED');
    expect(onY(b2.build(), 8)[1].line.front.middleTex).toBe('DAMAGED');
  });

  it('rejects a zone-portal span off the boundary, and on a non-room (island) sector', () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 8, 8), SPEC);
    const portal = { zone: 'x', dx: 0, dy: 0 };

    // Not colinear with any wall.
    expect(() => b.zonePortal(a, [10, 10, 12, 10], portal)).toThrow(/lies on no boundary edge/);
    // Colinear with the y=8 wall's line, but outside the wall's span.
    expect(() => b.zonePortal(a, [10, 8, 12, 8], portal)).toThrow(/lies on no boundary edge/);

    const island = b.island(a, rect(2, 2, 4, 4), { ...SPEC, floorZ: 1 });

    expect(() => b.zonePortal(island, [2, 2, 4, 2], portal)).toThrow(/not a room/);
  });

  it('emits each connection kind with its MapBuilder flags and default texture', () => {
    const cases = [
      [
        'portal',
        { glass: undefined, pane: undefined, sliding: undefined, fence: undefined },
        'METAL',
      ],
      ['glass', { glass: true, pane: undefined, sliding: undefined, fence: undefined }, 'GLASS'],
      [
        'glassPane',
        { glass: true, pane: true, sliding: undefined, fence: undefined },
        'GLASS_PANE',
      ],
      [
        'slidingDoor',
        { glass: true, pane: undefined, sliding: true, fence: undefined },
        'DOOR_GLASS',
      ],
      ['fence', { glass: undefined, pane: undefined, sliding: undefined, fence: true }, 'METAL'],
    ] as const;

    for (const [kind, flags, tex] of cases) {
      const b = new RoomBuilder();
      const a = b.room(rect(0, 0, 4, 4), SPEC);
      const c = b.room(rect(0, 4, 4, 8), SPEC);

      b.connect(a, c, { kind });
      const opening = onY(b.build(), 4).find((l) => l.line.back !== null);

      expect(opening?.line.glass, kind).toBe(flags.glass);
      expect(opening?.line.pane, kind).toBe(flags.pane);
      expect(opening?.line.sliding, kind).toBe(flags.sliding);
      expect(opening?.line.fence, kind).toBe(flags.fence);
      expect(opening?.line.front.middleTex, kind).toBe(tex);
    }
  });

  it("dresses the connection with 'tex' when given", () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 4, 4), SPEC);
    const c = b.room(rect(0, 4, 4, 8), SPEC);

    b.connect(a, c, { tex: 'LOBBY' });
    const opening = onY(b.build(), 4).find((l) => l.line.back !== null);

    expect(opening?.line.front.middleTex).toBe('LOBBY');
  });

  it('leaves an UNCONNECTED shared boundary as two back-to-back one-sided solids', () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 4, 4), SPEC);
    const c = b.room(rect(0, 4, 4, 8), SPEC);
    const boundary = onY(b.build(), 4); // no connect() — an opaque dividing wall

    expect(boundary).toHaveLength(2);
    expect(boundary.every((l) => l.line.back === null)).toBe(true);
    expect(new Set(boundary.map((l) => l.line.front.sector))).toEqual(new Set([a, c]));
  });

  it('rings an island with portals fronting the island, and with fences when `fenced`', () => {
    for (const fenced of [false, true]) {
      const b = new RoomBuilder();
      const host = b.room(rect(0, 0, 10, 10), SPEC);
      const island = b.island(host, rect(4, 4, 6, 6), { ...SPEC, floorZ: 1 }, { fenced });
      const ring = resolve(b.build()).filter((l) => l.line.back !== null);

      expect(ring).toHaveLength(4);
      for (const { line } of ring) {
        expect(line.front.sector).toBe(island);
        expect(line.back?.sector).toBe(host);
        expect(line.fence).toBe(fenced ? true : undefined);
      }
      expect(locateSubSector(buildBsp(b.build()).root, 5, 5).sector).toBe(island);
    }
  });

  it('carves a hole as one-sided walls facing the host room on the outside', () => {
    const b = new RoomBuilder();
    const host = b.room(rect(0, 0, 10, 10), SPEC);

    b.hole(host, rect(4, 4, 6, 6), 'PILLAR');
    const walls = resolve(b.build()).filter((l) => l.line.front.middleTex === 'PILLAR');

    expect(walls).toHaveLength(4);
    for (const { line, x1, y1, x2, y2 } of walls) {
      expect(line.front.sector).toBe(host);
      expect(line.back).toBeNull();
      // The pillar's centre (5,5) sits on the LEFT of v1→v2 — the host outside is the front.
      expect((x2 - x1) * (5 - y1) - (y2 - y1) * (5 - x1)).toBeGreaterThan(0);
    }
  });

  it('chains a stair flight: rising floors, inter-step portals fronting the lower step', () => {
    const b = new RoomBuilder();
    const steps = b.stairs([0, 10], [4, 10], {
      depth: 2,
      count: 3,
      zBase: 0,
      dz: 0.4,
      ceilZ: 4,
      light: 200,
      wallTex: 'WALL',
    }); // base edge west→east ⇒ climbs NORTH (the right of the edge, y down)
    const map = b.build();

    expect(steps).toHaveLength(3);
    expect(steps.map((s) => map.sectors[s].floorZ)).toEqual([0.4, 0.8, 1.2]);
    const portals = resolve(map).filter((l) => l.line.back !== null);

    expect(portals).toHaveLength(2);
    expect(portals.map((l) => l.line.front.sector).sort()).toEqual([steps[0], steps[1]]); // fronts = lower steps
    const root = buildBsp(map).root;

    expect(locateSubSector(root, 2, 9).sector).toBe(steps[0]); // y10 → 8
    expect(locateSubSector(root, 2, 5).sector).toBe(steps[2]); // top step, y6 → 4
  });

  it('rejects degenerate polygons and impossible connections with clear messages', () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 4, 4), SPEC);
    const far = b.room(rect(20, 20, 24, 24), SPEC);
    const near = b.room(rect(0, 4, 4, 8), SPEC);
    const island = b.island(a, rect(1, 1, 2, 2), SPEC);

    expect(() =>
      b.room(
        [
          [0, 0],
          [4, 4],
        ],
        SPEC,
      ),
    ).toThrow(/at least 3 polygon points/);
    expect(() =>
      b.room(
        [
          [0, 0],
          [0, 0],
          [4, 4],
        ],
        SPEC,
      ),
    ).toThrow(/repeats the consecutive point/);
    expect(() =>
      b.room(
        [
          [0, 0],
          [2, 2],
          [4, 4],
        ],
        SPEC,
      ),
    ).toThrow(/zero area/);
    expect(() => b.room(rect(0, 0, 4, 4), { ...SPEC, walls: { 4: 'WOOD' } })).toThrow(
      /edges run 0\.\.3/,
    );
    expect(() => b.connect(a, a)).toThrow(/to itself/);
    expect(() => b.connect(a, far)).toThrow(/no colinear boundary overlap/);
    expect(() => b.connect(a, island)).toThrow(/not a room/);
    expect(() =>
      b.connect(a, near, {
        at: [6, 4, 7, 4],
      }),
    ).toThrow(/not inside a shared overlap/);
  });

  it('builds a 3-room map (door + island + column) a player can be located inside', () => {
    const b = new RoomBuilder();
    const lobby = b.room(rect(0, 0, 12, 8), SPEC);
    const corridor = b.room(rect(4, 8, 8, 12), SPEC); // a doorway in the lobby's long south wall
    const hall = b.room(rect(0, 12, 12, 20), SPEC);
    const dais = b.island(lobby, rect(1, 1, 3, 3), { ...SPEC, floorZ: 0.5 });

    b.connect(lobby, corridor, { kind: 'slidingDoor' });
    b.connect(corridor, hall);
    b.hole(hall, rect(5, 15, 7, 17), 'PILLAR');
    b.thing(6, 4, 0, 'player_start');
    const map = b.build();
    const root = buildBsp(map).root;

    expect(map.things).toEqual([{ x: 6, y: 4, angle: 0, type: 'player_start' }]);
    expect(locateSubSector(root, 6, 4).sector).toBe(lobby);
    expect(locateSubSector(root, 6, 10).sector).toBe(corridor);
    expect(locateSubSector(root, 2, 16).sector).toBe(hall); // west of the column
    expect(locateSubSector(root, 2, 2).sector).toBe(dais);
  });

  it('rejects a degenerate stair base edge (from == to)', () => {
    const b = new RoomBuilder();

    expect(() =>
      b.stairs([0, 10], [0, 10], {
        depth: 2,
        count: 3,
        zBase: 0,
        dz: 0.4,
        ceilZ: 4,
        light: 200,
        wallTex: 'WALL',
      }),
    ).toThrow(/base edge is degenerate/);
  });

  it('treats colinear walls that touch at a single point as no overlap', () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 4, 4), SPEC);
    const corner = b.room(rect(4, 4, 8, 8), SPEC); // shares only the corner (4,4): colinear walls meet at a point

    expect(() => b.connect(a, corner)).toThrow(/no colinear boundary overlap/);
  });

  it("skips a non-colinear overlap when 'at' selects a second shared wall on another line", () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 8, 8), SPEC);
    // An L-shaped room wrapping a's SE corner: shares a's south wall (y=8) AND its east wall (x=8).
    const wrap = b.room(
      [
        [8, 0],
        [12, 0],
        [12, 12],
        [0, 12],
        [0, 8],
        [8, 8],
      ],
      SPEC,
    );

    // The door is on the EAST wall, so `restrict` must skip the (first-found) south overlap before matching it.
    b.connect(a, wrap, { at: [8, 2, 8, 6] });
    const opening = resolve(b.build()).find((l) => l.line.back !== null);

    expect(opening?.x1).toBe(8);
    expect(opening?.x2).toBe(8);
    expect([Math.min(opening!.y1, opening!.y2), Math.max(opening!.y1, opening!.y2)]).toEqual([
      2, 6,
    ]);
    expect(opening?.line.front.sector).toBe(a);
    expect(opening?.line.back?.sector).toBe(wrap);
  });

  it('sorts the cuts when one wall carries two doorways given out of order', () => {
    const b = new RoomBuilder();
    const a = b.room(rect(0, 0, 12, 4), SPEC); // one long south wall y=4
    const west = b.room(rect(1, 4, 3, 8), SPEC);
    const east = b.room(rect(9, 4, 11, 8), SPEC);

    b.connect(a, east); // east door registered FIRST → the two cuts arrive out of order, so the sort comparator runs
    b.connect(a, west);
    const boundary = onY(b.build(), 4);
    const openings = boundary.filter((l) => l.line.back !== null);

    expect(
      openings.map((l) => [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)]).sort((p, q) => p[0] - q[0]),
    ).toEqual([
      [1, 3],
      [9, 11],
    ]);
    const aSolids = boundary
      .filter((l) => l.line.back === null && l.line.front.sector === a)
      .map((l) => [Math.min(l.x1, l.x2), Math.max(l.x1, l.x2)])
      .sort((p, q) => p[0] - q[0]);

    expect(aSolids).toEqual([
      [0, 1],
      [3, 9],
      [11, 12],
    ]); // solid / door / solid / door / solid
  });
});
