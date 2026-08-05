import { describe, it, expect } from 'vitest';
import { buildBsp } from './node-builder';
import { castRay, nearestTargetHit, type Target } from './raycast';
import type { MapSource, SideDef } from './types';

const side: SideDef = {
  sector: 0,
  xOffset: 0,
  yOffset: 0,
  upperTex: 'w',
  lowerTex: 'w',
  middleTex: 'w',
};

const FIXTURE: MapSource = {
  sectors: [{ floorZ: 0, ceilZ: 3, floorTex: 'f', ceilTex: 'c', light: 200 }],
  things: [],
  vertices: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 7, y: 0 },
    { x: 7, y: 10 },
    { x: 8, y: 8 },
    { x: 8, y: 9 },
    { x: 8, y: 1 },
    { x: 8, y: 2 },
    { x: 14, y: 0 },
    { x: 14, y: 10 },
  ],
  linedefs: [
    { v1: 0, v2: 1, front: side, back: null },
    { v1: 1, v2: 2, front: side, back: null },
    { v1: 2, v2: 3, front: side, back: null },
    { v1: 3, v2: 0, front: side, back: null },
    { v1: 4, v2: 5, front: side, back: side },
    { v1: 6, v2: 7, front: side, back: null },
    { v1: 8, v2: 9, front: side, back: null },
    { v1: 10, v2: 11, front: side, back: null },
  ],
};
const MAP = buildBsp(FIXTURE);

describe('castRay', () => {
  it('returns the nearest solid wall, ignoring portals, parallel/behind walls, and out-of-segment crossings', () => {
    const hit = castRay(MAP, 5, 5, 1, 0, 100);

    expect(hit).not.toBeNull();
    expect(hit?.dist).toBeCloseTo(5);
    expect(hit?.x).toBeCloseTo(10);
    expect(hit?.y).toBeCloseTo(5);
  });

  it('returns null when the nearest wall is beyond maxDist', () => {
    expect(castRay(MAP, 5, 5, 1, 0, 4)).toBeNull();
  });

  it('treats a LIVE zone-portal seam as a solid wall — shots never cross zones', () => {
    const seam = { zone: 'next', dx: 0, dy: 0 };
    const twoSided = buildBsp({
      ...FIXTURE,
      linedefs: FIXTURE.linedefs.map((l, i) => (i === 4 ? { ...l, zonePortal: seam } : l)),
    });
    const hit = castRay(twoSided, 5, 5, 1, 0, 100);

    expect(hit?.dist).toBeCloseTo(2);
    expect(hit?.x).toBeCloseTo(7);

    const oneSided = buildBsp({
      ...FIXTURE,
      linedefs: FIXTURE.linedefs.map((l, i) =>
        i === 4 ? { ...l, back: null, zonePortal: seam } : l,
      ),
    });

    expect(castRay(oneSided, 5, 5, 1, 0, 100)?.x).toBeCloseTo(7);

    const passable = buildBsp({
      ...FIXTURE,
      linedefs: FIXTURE.linedefs.map((l, i) =>
        i === 4 ? { ...l, back: null, zonePortal: { ...seam, passable: true } } : l,
      ),
    });

    expect(castRay(passable, 5, 5, 1, 0, 100)?.x).toBeCloseTo(7);
  });
});

describe('castRay — glass stops a projectile but not a sight line', () => {
  const room = (flags: { glass?: boolean; sliding?: boolean }): MapSource => ({
    sectors: [{ floorZ: 0, ceilZ: 3, floorTex: 'f', ceilTex: 'c', light: 200 }],
    things: [],
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 7, y: 0 },
      { x: 7, y: 10 },
    ],
    linedefs: [
      { v1: 0, v2: 1, front: side, back: null },
      { v1: 1, v2: 2, front: side, back: null },
      { v1: 2, v2: 3, front: side, back: null },
      { v1: 3, v2: 0, front: side, back: null },
      { v1: 4, v2: 5, front: side, back: side, ...flags },
    ],
  });

  it('a sight line (blockGlass off) passes through glass to the far wall', () => {
    expect(castRay(buildBsp(room({ glass: true })), 5, 5, 1, 0, 100)?.x).toBeCloseTo(10);
  });

  it('a projectile (blockGlass on) stops at the glass', () => {
    expect(castRay(buildBsp(room({ glass: true })), 5, 5, 1, 0, 100, true)?.x).toBeCloseTo(7);
  });

  it('a projectile passes an OPEN sliding door but stops at a shut one', () => {
    const map = buildBsp(room({ glass: true, sliding: true }));

    expect(castRay(map, 5, 5, 1, 0, 100, true, [0, 0, 0, 0, 1])?.x).toBeCloseTo(10);
    expect(castRay(map, 5, 5, 1, 0, 100, true, [0, 0, 0, 0, 0])?.x).toBeCloseTo(7);
  });
});

describe('nearestTargetHit', () => {
  const A: Target = { x: 5, y: 0, radius: 0.5 };
  const B: Target = { x: 8, y: 0, radius: 0.5 };
  const behind: Target = { x: -3, y: 0, radius: 0.5 };
  const offToTheSide: Target = { x: 5, y: 2, radius: 0.5 };

  it('returns the nearest target the ray passes through', () => {
    const hit = nearestTargetHit(0, 0, 1, 0, 100, [B, A]);

    expect(hit).toEqual({ index: 1, dist: 5 });
  });

  it('ignores targets behind the shooter or wide of the ray', () => {
    expect(nearestTargetHit(0, 0, 1, 0, 100, [behind])).toBeNull();
    expect(nearestTargetHit(0, 0, 1, 0, 100, [offToTheSide])).toBeNull();
  });

  it('hits POINT-BLANK: a centre just behind the origin whose body still contains it (a pressed-in rusher)', () => {
    const pressedIn: Target = { x: -0.1, y: 0, radius: 0.4 };

    expect(nearestTargetHit(0, 0, 1, 0, 100, [pressedIn])).toEqual({ index: 0, dist: 0 });
  });

  it('ignores a target beyond maxDist (e.g. behind the wall the shot already hit)', () => {
    expect(nearestTargetHit(0, 0, 1, 0, 4, [A])).toBeNull();
  });

  it("widens the hit by the weapon's cone so an off-centre target still connects", () => {
    const offCentre: Target = { x: 5, y: 1, radius: 0.5 };

    expect(nearestTargetHit(0, 0, 1, 0, 100, [offCentre])).toBeNull();
    expect(nearestTargetHit(0, 0, 1, 0, 100, [offCentre], 0.2)).toEqual({ index: 0, dist: 5 });
  });

  it('respects the vertical aim when a target has a height (zMin/zMax)', () => {
    const tall: Target = { x: 5, y: 0, radius: 0.5, zMin: 0, zMax: 1 };

    expect(nearestTargetHit(0, 0, 1, 0, 100, [tall], 0, 0.5, 0)).toEqual({ index: 0, dist: 5 });
    expect(nearestTargetHit(0, 0, 1, 0, 100, [tall], 0, 2, 0)).toBeNull();
    expect(nearestTargetHit(0, 0, 1, 0, 100, [tall], 0, 2, -0.3)).toEqual({ index: 0, dist: 5 });
  });
});
