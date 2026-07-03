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

// A 10×10 room of one-sided walls, plus three deliberate distractors a forward ray must reject:
// a two-sided portal at x=7 (a shot passes through it), two stub walls whose *lines* the ray
// crosses outside their span (u<0 and u>1), and an outer wall at x=14 behind the near one.
const FIXTURE: MapSource = {
  sectors: [{ floorZ: 0, ceilZ: 3, floorTex: 'f', ceilTex: 'c', light: 200 }],
  things: [],
  vertices: [
    { x: 0, y: 0 }, // 0
    { x: 10, y: 0 }, // 1
    { x: 10, y: 10 }, // 2
    { x: 0, y: 10 }, // 3
    { x: 7, y: 0 }, // 4  portal
    { x: 7, y: 10 }, // 5
    { x: 8, y: 8 }, // 6  stub → ray line crosses below it (u < 0)
    { x: 8, y: 9 }, // 7
    { x: 8, y: 1 }, // 8  stub → ray line crosses above it (u > 1)
    { x: 8, y: 2 }, // 9
    { x: 14, y: 0 }, // 10 outer wall, farther than x=10
    { x: 14, y: 10 }, // 11
  ],
  linedefs: [
    { v1: 0, v2: 1, front: side, back: null }, // bottom — parallel to a +x ray
    { v1: 1, v2: 2, front: side, back: null }, // right wall x=10 — the nearest hit
    { v1: 2, v2: 3, front: side, back: null }, // top — parallel
    { v1: 3, v2: 0, front: side, back: null }, // left — behind a +x ray
    { v1: 4, v2: 5, front: side, back: side }, // two-sided portal — does not block
    { v1: 6, v2: 7, front: side, back: null }, // stub → u < 0
    { v1: 8, v2: 9, front: side, back: null }, // stub → u > 1
    { v1: 10, v2: 11, front: side, back: null }, // outer wall x=14 — loses to x=10
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
    // The x=7 line, normally a pass-through two-sided portal, becomes a zone-portal seam. Even two-sided
    // (defensive — the builders author seams one-sided) it must now stop the ray short of the x=10 wall.
    const seam = { zone: 'next', dx: 0, dy: 0 };
    const twoSided = buildBsp({
      ...FIXTURE,
      linedefs: FIXTURE.linedefs.map((l, i) => (i === 4 ? { ...l, zonePortal: seam } : l)),
    });
    const hit = castRay(twoSided, 5, 5, 1, 0, 100);

    expect(hit?.dist).toBeCloseTo(2);
    expect(hit?.x).toBeCloseTo(7);

    // The authored shape — a ONE-SIDED seam — blocks like any solid edge of the world.
    const oneSided = buildBsp({
      ...FIXTURE,
      linedefs: FIXTURE.linedefs.map((l, i) =>
        i === 4 ? { ...l, back: null, zonePortal: seam } : l,
      ),
    });

    expect(castRay(oneSided, 5, 5, 1, 0, 100)?.x).toBeCloseTo(7);

    // Even a PASSABLE seam (the player walks through it) stops the ray: the crossing is a movement
    // feature only — cross-zone ballistics stay out of scope.
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
  // A room x[0..10] with a two-sided divider at x=7 (linedef index 4) + the far wall at x=10.
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
      { v1: 1, v2: 2, front: side, back: null }, // far wall x=10 (the fallback hit)
      { v1: 2, v2: 3, front: side, back: null },
      { v1: 3, v2: 0, front: side, back: null },
      { v1: 4, v2: 5, front: side, back: side, ...flags }, // index 4 = the x=7 divider
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

    expect(castRay(map, 5, 5, 1, 0, 100, true, [0, 0, 0, 0, 1])?.x).toBeCloseTo(10); // index 4 open → through
    expect(castRay(map, 5, 5, 1, 0, 100, true, [0, 0, 0, 0, 0])?.x).toBeCloseTo(7); // shut → stops
  });
});

describe('nearestTargetHit', () => {
  // Shooting from the origin straight along +x.
  const A: Target = { x: 5, y: 0, radius: 0.5 }; // dead ahead, in range
  const B: Target = { x: 8, y: 0, radius: 0.5 }; // ahead but farther than A
  const behind: Target = { x: -3, y: 0, radius: 0.5 };
  const offToTheSide: Target = { x: 5, y: 2, radius: 0.5 };

  it('returns the nearest target the ray passes through', () => {
    const hit = nearestTargetHit(0, 0, 1, 0, 100, [B, A]);

    expect(hit).toEqual({ index: 1, dist: 5 }); // A (index 1) is nearer than B
  });

  it('ignores targets behind the shooter or wide of the ray', () => {
    expect(nearestTargetHit(0, 0, 1, 0, 100, [behind])).toBeNull();
    expect(nearestTargetHit(0, 0, 1, 0, 100, [offToTheSide])).toBeNull();
  });

  it('hits POINT-BLANK: a centre just behind the origin whose body still contains it (a pressed-in rusher)', () => {
    // A launched shot spawns AHEAD of the camera; a melee rusher pressed into the player can put its centre
    // just behind that spawn point while its body still surrounds it — that is a hit at distance 0, not a miss.
    const pressedIn: Target = { x: -0.1, y: 0, radius: 0.4 };

    expect(nearestTargetHit(0, 0, 1, 0, 100, [pressedIn])).toEqual({ index: 0, dist: 0 });
  });

  it('ignores a target beyond maxDist (e.g. behind the wall the shot already hit)', () => {
    expect(nearestTargetHit(0, 0, 1, 0, 4, [A])).toBeNull();
  });

  it("widens the hit by the weapon's cone so an off-centre target still connects", () => {
    const offCentre: Target = { x: 5, y: 1, radius: 0.5 }; // 1 unit off the +x axis at 5 forward

    // A precise shot (no cone) passes it — perp 1 > radius 0.5.
    expect(nearestTargetHit(0, 0, 1, 0, 100, [offCentre])).toBeNull();
    // A wide cone opens the tolerance to 0.5 + 5·tan(0.2) ≈ 1.5, so the same shot connects.
    expect(nearestTargetHit(0, 0, 1, 0, 100, [offCentre], 0.2)).toEqual({ index: 0, dist: 5 });
  });

  it('respects the vertical aim when a target has a height (zMin/zMax)', () => {
    const tall: Target = { x: 5, y: 0, radius: 0.5, zMin: 0, zMax: 1 }; // a card spanning z 0..1 at x=5

    // Eye level with the card, looking flat → aim height 0.5 at the card → HIT.
    expect(nearestTargetHit(0, 0, 1, 0, 100, [tall], 0, 0.5, 0)).toEqual({ index: 0, dist: 5 });
    // Eye well above it, looking flat → aim height 2 at the card → over the top → MISS.
    expect(nearestTargetHit(0, 0, 1, 0, 100, [tall], 0, 2, 0)).toBeNull();
    // Same high eye but pitched DOWN (slope −0.3) → aim height 2 − 0.3·5 = 0.5 → back on the card → HIT.
    expect(nearestTargetHit(0, 0, 1, 0, 100, [tall], 0, 2, -0.3)).toEqual({ index: 0, dist: 5 });
  });
});
