import { describe, it, expect } from 'vitest';
import { buildBsp } from './node-builder';
import { castFloorCeil, climbTarget, movePlayer } from './physics';
import { SAMPLE_MAP } from './sample-map';
import type { MapSource, SideDef } from './types';

const MAP = buildBsp(SAMPLE_MAP);
const R = 0.3;
const STEP = 1.1; // the sample platform is a 1.0 step → climbable with this
const HEAD = 0.8;

describe('movePlayer', () => {
  it('moves freely through open floor', () => {
    const r = movePlayer(MAP, 3, 5, 0.5, 0, R, STEP, HEAD);

    expect(r.x).toBeCloseTo(3.5, 5);
    expect(r.y).toBeCloseTo(5, 5);
    expect(r.floorZ).toBe(0); // still in the room
  });

  it('slides off a solid wall instead of crossing it', () => {
    const r = movePlayer(MAP, 1, 5, -2, 0, R, STEP, HEAD); // charge the west wall at x=0

    expect(r.x).toBeGreaterThan(0); // never crossed
    expect(r.x).toBeCloseTo(R, 1); // parked a radius off the wall
    expect(r.y).toBeCloseTo(5, 1); // tangential position preserved
    expect(r.floorZ).toBe(0);
  });

  it('climbs the staircase onto the top dais when each step is climbable', () => {
    const r = movePlayer(MAP, 3, 5, 5, 0, R, STEP, HEAD); // walk in to the centre, up all three rings

    expect(r.floorZ).toBe(1); // now standing on the top dais (each 0.33 step ≤ stepMax)
  });

  it('is blocked by a step that is too high', () => {
    const r = movePlayer(MAP, 3, 5, 3, 0, R, 0.2, HEAD); // stepMax 0.2 < the first 0.33 step

    expect(r.floorZ).toBe(0); // could not even climb the first ring
    expect(r.x).toBeLessThan(5); // pushed back at the dais edge
  });

  it('is blocked by too little headroom', () => {
    const r = movePlayer(MAP, 3, 5, 3, 0, R, STEP, 5); // needs 5 of clearance; the first ring offers < 4

    expect(r.floorZ).toBe(0);
  });

  it('steps DOWN off the platform (the far-side wall orientation)', () => {
    const r = movePlayer(MAP, 8, 5, 5, 0, R, STEP, HEAD); // from on the platform, out east into the room

    expect(r.floorZ).toBe(0);
  });

  describe('corner depenetration (no phantom push from off the end of a wall)', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'M',
      lowerTex: 'M',
      middleTex: 'M',
    });
    // A 10×10 room (floor 0) with a raised square BLOCK (floor 5 → un-climbable) at x∈[4,6], y∈[4,6].
    // The block's four edges are short, so a player off their ends is blocked only by a CORNER.
    const blockMap = buildBsp({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 }, // 0..3 room
        { x: 4, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 6 },
        { x: 4, y: 6 }, // 4..7 block (wound CCW → front = room, back = block)
      ],
      sectors: [
        { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 }, // 0 room
        { floorZ: 5, ceilZ: 10, floorTex: 'F', ceilTex: 'C', light: 200 }, // 1 raised block
      ],
      linedefs: [
        { v1: 0, v2: 1, front: tex(0), back: null },
        { v1: 1, v2: 2, front: tex(0), back: null },
        { v1: 2, v2: 3, front: tex(0), back: null },
        { v1: 3, v2: 0, front: tex(0), back: null },
        { v1: 4, v2: 5, front: tex(0), back: tex(1) },
        { v1: 5, v2: 6, front: tex(0), back: tex(1) },
        { v1: 6, v2: 7, front: tex(0), back: tex(1) },
        { v1: 7, v2: 4, front: tex(0), back: tex(1) },
      ],
      things: [],
    });

    it('pushes the player radially out of a block corner (not along a distant edge normal)', () => {
      // Walk NE at the SW corner (4,4) from just outside it: the foot of the perpendicular falls off the end
      // of both adjacent edges, so the player is depenetrated radially to a full radius from the corner.
      const r = movePlayer(blockMap, 3.5, 3.5, 0.4, 0.4, R, STEP, HEAD);

      expect(r.floorZ).toBe(0); // never climbed onto the un-climbable block
      expect(r.x).toBeLessThan(4); // stayed in the SW quadrant — no phantom shove past the corner
      expect(r.y).toBeLessThan(4);
      expect(Math.hypot(r.x - 4, r.y - 4)).toBeCloseTo(R, 5); // parked exactly a radius off the corner
    });

    it('leaves the player untouched when the nearby corner is farther than the radius', () => {
      // Same heading but starting well clear of the corner — the true distance exceeds the radius, so the
      // off-the-end branch makes no correction (the move applies in full).
      const r = movePlayer(blockMap, 1, 1, 0.4, 0.4, R, STEP, HEAD);

      expect(r.x).toBeCloseTo(1.4, 5);
      expect(r.y).toBeCloseTo(1.4, 5);
    });
  });
});

describe('climbTarget', () => {
  const sideTex = (sector: number): SideDef => ({
    sector,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'M',
    lowerTex: 'M',
    middleTex: 'M',
  });

  // A 12×8 room split at x=6: WEST sector (floor 0) | a two-sided divider | EAST sector (floor `eastFloor`).
  const mapWith = (eastFloor: number, eastCeil = 5): MapSource => ({
    vertices: [
      { x: 0, y: 0 },
      { x: 0, y: 8 },
      { x: 6, y: 8 },
      { x: 6, y: 0 },
      { x: 12, y: 8 },
      { x: 12, y: 0 },
    ],
    sectors: [
      { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 }, // 0 WEST
      { floorZ: eastFloor, ceilZ: eastCeil, floorTex: 'F', ceilTex: 'C', light: 200 }, // 1 EAST
    ],
    linedefs: [
      { v1: 0, v2: 1, front: sideTex(0), back: null }, // outer walls (one-sided)
      { v1: 1, v2: 2, front: sideTex(0), back: null },
      { v1: 2, v2: 4, front: sideTex(1), back: null },
      { v1: 4, v2: 5, front: sideTex(1), back: null },
      { v1: 5, v2: 3, front: sideTex(1), back: null },
      { v1: 3, v2: 0, front: sideTex(0), back: null },
      { v1: 3, v2: 2, front: sideTex(1), back: sideTex(0) }, // the divider portal
    ],
    things: [],
  });

  // From WEST (3,4) on floor 0, probe +x 4 cells into EAST; STEP_UP 0.35, CLIMB 1.4, HEADROOM 0.9.
  const climb = (eastFloor: number, eastCeil = 5): number | null =>
    climbTarget(buildBsp(mapWith(eastFloor, eastCeil)), 3, 4, 0, 1, 0, 4, 0.35, 1.4, 0.9);

  it('returns the ledge floor for a too-tall-but-climbable rise (with headroom)', () => {
    expect(climb(0.8)).toBe(0.8);
  });

  it('returns null for a normal step (≤ stepMax) or a rise too tall to climb (> climbMax)', () => {
    expect(climb(0.2)).toBeNull();
    expect(climb(2)).toBeNull();
  });

  it('returns null when there is no headroom to stand on the ledge', () => {
    expect(climb(0.8, 1.2)).toBeNull(); // 1.2 − 0.8 = 0.4 < 0.9
  });

  it('returns null when a one-sided wall blocks the probe (a true wall, not a ledge)', () => {
    // probe −x toward the west wall (3 cells away, within reach 4) → a solid wall, no climb
    expect(climbTarget(buildBsp(mapWith(0.8)), 3, 4, 0, -1, 0, 4, 0.35, 1.4, 0.9)).toBeNull();
  });
});

describe('castFloorCeil', () => {
  const sideTex = (sector: number): SideDef => ({
    sector,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'M',
    lowerTex: 'M',
    middleTex: 'M',
  });

  // A 12×8 room split at x=6: WEST sector (floor 0, ceil 5) | divider portal | EAST sector (floor `eastFloor`).
  const mapWith = (eastFloor: number, eastCeil = 5): MapSource => ({
    vertices: [
      { x: 0, y: 0 },
      { x: 0, y: 8 },
      { x: 6, y: 8 },
      { x: 6, y: 0 },
      { x: 12, y: 8 },
      { x: 12, y: 0 },
    ],
    sectors: [
      { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 }, // 0 WEST
      { floorZ: eastFloor, ceilZ: eastCeil, floorTex: 'F', ceilTex: 'C', light: 200 }, // 1 EAST
    ],
    linedefs: [
      { v1: 0, v2: 1, front: sideTex(0), back: null },
      { v1: 1, v2: 2, front: sideTex(0), back: null },
      { v1: 2, v2: 4, front: sideTex(1), back: null },
      { v1: 4, v2: 5, front: sideTex(1), back: null },
      { v1: 5, v2: 3, front: sideTex(1), back: null },
      { v1: 3, v2: 0, front: sideTex(0), back: null },
      { v1: 3, v2: 2, front: sideTex(1), back: sideTex(0) }, // the divider portal
    ],
    things: [],
  });
  const FLAT = buildBsp(mapWith(0)); // a single-height room (EAST floor == WEST floor)

  it('stops a downward shot at the floor it dives into', () => {
    // From (3,4) eye-height 1.4, diving at −1.0/cell along +x: z hits 0 at ~1.4 cells, well inside the WEST room.
    const hit = castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, -1.0, 5);

    expect(hit?.surface).toBe('floor');
    expect(hit?.z).toBe(0); // clamped to the floor it struck
    expect(hit?.dist).toBeGreaterThan(1.4);
    expect(hit?.dist).toBeLessThanOrEqual(1.6); // within one sampling step of the true 1.4 crossing
    expect(hit?.x).toBeCloseTo(3 + (hit?.dist ?? 0), 5); // on the +x ray
  });

  it('stops an upward shot at the ceiling it climbs into', () => {
    const hit = castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, 2.0, 3); // climbing fast: z hits 5 at ~1.8 cells

    expect(hit?.surface).toBe('ceil');
    expect(hit?.z).toBe(5); // clamped to the ceiling
    expect(hit?.dist).toBeGreaterThan(1.8);
    expect(hit?.dist).toBeLessThanOrEqual(2.0);
  });

  it('lets a level shot fly clear when it stays between floor and ceiling', () => {
    expect(castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, 0, 5)).toBeNull();
  });

  it('strikes a step that rises above the shot, even when level (a too-tall step blocks the shot)', () => {
    // EAST floor raised to 2 (above eye height 1.4): a level shot from the WEST clears its own floor but
    // dies on the EAST step it reaches at x>6 (dist>3).
    const hit = castFloorCeil(buildBsp(mapWith(2)), 3, 4, 1, 0, 1.4, 0, 6);

    expect(hit?.surface).toBe('floor');
    expect(hit?.z).toBe(2); // the raised EAST floor
    expect(hit?.dist).toBeGreaterThan(3); // only after crossing the x=6 divider
  });

  it('clears a low step when level, then lands on it once the shot dips below its height', () => {
    const LOW = buildBsp(mapWith(0.5)); // EAST floor 0.5 — under eye height, so a level shot sails over it

    expect(castFloorCeil(LOW, 3, 4, 1, 0, 1.4, 0, 6)).toBeNull(); // level: clears the low step
    const dip = castFloorCeil(LOW, 3, 4, 1, 0, 1.4, -0.15, 7); // a shallow dive lands on the EAST step

    expect(dip?.surface).toBe('floor');
    expect(dip?.z).toBe(0.5);
    expect(dip?.x).toBeGreaterThan(6); // landed in the EAST sector
  });

  it('reads the live ceiling, so a shut door (ceil lowered to the floor) stops a shot', () => {
    const hit = castFloorCeil(buildBsp(mapWith(0, 0)), 3, 4, 1, 0, 1.4, 0, 5); // EAST ceil == floor == 0

    expect(hit?.surface).toBe('ceil');
    expect(hit?.dist).toBeGreaterThan(3); // strikes the shut EAST cell past the divider
  });

  it('takes at least one sample even at zero range (origin inside the room → no hit)', () => {
    expect(castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, 0, 0)).toBeNull();
  });

  it('clears floor/ceiling within the muzzle grace, colliding only beyond it', () => {
    // A dive that would burst on the floor at ~1.4 cells without a muzzle...
    expect(castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, -1.0, 5)?.dist).toBeLessThan(2);
    // ...clears the first 2.5 cells with a muzzle grace, bursting only past it (lets a shot off a lip escape).
    const graced = castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, -1.0, 5, undefined, 2.5);

    expect(graced?.surface).toBe('floor');
    expect(graced?.dist).toBeGreaterThanOrEqual(2.5);
    // A muzzle wider than the whole cast clears everything → no burst.
    expect(castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, -1.0, 5, undefined, 6)).toBeNull();
  });
});
