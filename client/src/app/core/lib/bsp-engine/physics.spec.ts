import { describe, it, expect } from 'vitest';
import { buildBsp } from './node-builder';
import { castFloorCeil, climbTarget, mantleStep, mapObstacles, movePlayer } from './physics';
import { SAMPLE_MAP } from './sample-map';
import type { MapSource, SideDef } from './types';

const MAP = buildBsp(SAMPLE_MAP);
const R = 0.3;
const STEP = 1.1;
const HEAD = 0.8;

describe('movePlayer', () => {
  it('moves freely through open floor', () => {
    const r = movePlayer(MAP, 3, 5, 0.5, 0, R, STEP, HEAD);

    expect(r.x).toBeCloseTo(3.5, 5);
    expect(r.y).toBeCloseTo(5, 5);
    expect(r.floorZ).toBe(0);
  });

  it('slides off a solid wall instead of crossing it', () => {
    const r = movePlayer(MAP, 1, 5, -2, 0, R, STEP, HEAD);

    expect(r.x).toBeGreaterThan(0);
    expect(r.x).toBeCloseTo(R, 1);
    expect(r.y).toBeCloseTo(5, 1);
    expect(r.floorZ).toBe(0);
  });

  it('climbs the staircase onto the top dais when each step is climbable', () => {
    const r = movePlayer(MAP, 3, 5, 5, 0, R, STEP, HEAD);

    expect(r.floorZ).toBe(1);
  });

  it('is blocked by a step that is too high', () => {
    const r = movePlayer(MAP, 3, 5, 3, 0, R, 0.2, HEAD);

    expect(r.floorZ).toBe(0);
    expect(r.x).toBeLessThan(5);
  });

  it('is blocked by too little headroom', () => {
    const r = movePlayer(MAP, 3, 5, 3, 0, R, STEP, 5);

    expect(r.floorZ).toBe(0);
  });

  it('steps DOWN off the platform (the far-side wall orientation)', () => {
    const r = movePlayer(MAP, 8, 5, 5, 0, R, STEP, HEAD);

    expect(r.floorZ).toBe(0);
  });

  describe('solid decor obstacles (props block movement — DOOM: things block things)', () => {
    const TOTEM = { x: 4, y: 5, radius: 0.5 };

    it('mapObstacles collects exactly the SOLID decor things (screen and non-props excluded)', () => {
      const dressed = buildBsp({
        ...SAMPLE_MAP,
        things: [
          { x: 2, y: 2, angle: 0, type: 'barrel' },
          { x: 3, y: 7, angle: 0, type: 'prop_totem' },
          { x: 4, y: 7, angle: 0, type: 'prop_screen' },
          { x: 5, y: 8, angle: 0, type: 'player_start' },
        ],
      });

      expect(mapObstacles(dressed)).toEqual([
        { x: 2, y: 2, radius: 0.35 },
        { x: 3, y: 7, radius: 0.5 },
      ]);
    });

    it('crossing the centre PLANE while passing BESIDE the prop stays free (no phantom clamp)', () => {
      const r = movePlayer(MAP, 2.5, 3.6, 3, 0, R, STEP, HEAD, undefined, false, [TOTEM]);

      expect(r.x).toBeCloseTo(5.5, 1);
      expect(r.y).toBeCloseTo(3.6, 1);
    });

    it('walking INTO a prop stops at the summed radii, never inside', () => {
      const r = movePlayer(MAP, 2.5, 5, 3, 0, R, STEP, HEAD, undefined, false, [TOTEM]);

      const dist = Math.hypot(r.x - TOTEM.x, r.y - TOTEM.y);

      expect(dist).toBeGreaterThanOrEqual(R + TOTEM.radius - 1e-6);
      expect(r.x).toBeLessThan(4);
    });

    it('a grazing path SLIDES around the prop (tangential progress preserved)', () => {
      const r = movePlayer(MAP, 2.5, 4.5, 2, 0, R, STEP, HEAD, undefined, false, [TOTEM]);

      const dist = Math.hypot(r.x - TOTEM.x, r.y - TOTEM.y);

      expect(dist).toBeGreaterThanOrEqual(R + TOTEM.radius - 1e-6);
      expect(r.x).toBeGreaterThan(2.6);
    });

    it('a prop AGAINST a wall cannot squeeze the mover through the wall (co-resolution)', () => {
      const plant = { x: 0.5, y: 5, radius: 0.3 };
      const r = movePlayer(MAP, 1.2, 5, -2, 0, R, STEP, HEAD, undefined, false, [plant]);

      expect(r.x).toBeGreaterThan(0);
      expect(Math.hypot(r.x - plant.x, r.y - plant.y)).toBeGreaterThanOrEqual(
        R + plant.radius - 0.05,
      );
    });

    it('a dead-centre overlap depenetrates opposite the motion (no NaN, no tunnel)', () => {
      const r = movePlayer(MAP, 4, 5, 0, 0, R, STEP, HEAD, undefined, false, [TOTEM]);

      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.y)).toBe(true);
      expect(Math.hypot(r.x - TOTEM.x, r.y - TOTEM.y)).toBeGreaterThanOrEqual(
        R + TOTEM.radius - 1e-6,
      );
    });

    it('without obstacles the same path walks straight through (the lever is real)', () => {
      const r = movePlayer(MAP, 2.5, 5, 3, 0, R, STEP, HEAD);

      expect(r.x).toBeCloseTo(5.5, 1);
    });
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
    const blockMap = buildBsp({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 4, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 6 },
        { x: 4, y: 6 },
      ],
      sectors: [
        { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 },
        { floorZ: 5, ceilZ: 10, floorTex: 'F', ceilTex: 'C', light: 200 },
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
      const r = movePlayer(blockMap, 3.5, 3.5, 0.4, 0.4, R, STEP, HEAD);

      expect(r.floorZ).toBe(0);
      expect(r.x).toBeLessThan(4);
      expect(r.y).toBeLessThan(4);
      expect(Math.hypot(r.x - 4, r.y - 4)).toBeCloseTo(R, 5);
    });

    it('leaves the player untouched when the nearby corner is farther than the radius', () => {
      const r = movePlayer(blockMap, 1, 1, 0.4, 0.4, R, STEP, HEAD);

      expect(r.x).toBeCloseTo(1.4, 5);
      expect(r.y).toBeCloseTo(1.4, 5);
    });
  });
});

describe('passable zone-portal seams (the seamless crossing)', () => {
  const stex = (sector: number): SideDef => ({
    sector,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'S',
    lowerTex: 'S',
    middleTex: 'S',
  });
  const seamRoom = (passable: boolean | undefined): MapSource => ({
    sectors: [{ floorZ: 0, ceilZ: 4, floorTex: 'F', ceilTex: 'C', light: 200 }],
    things: [],
    vertices: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 0, y: 8 },
      { x: 8, y: 8 },
    ],
    linedefs: [
      { v1: 0, v2: 2, front: stex(0), back: null },
      {
        v1: 2,
        v2: 3,
        front: stex(0),
        back: null,
        zonePortal: {
          zone: 'next',
          dx: 0,
          dy: -8,
          ...(passable === undefined ? {} : { passable }),
        },
      },
      { v1: 3, v2: 1, front: stex(0), back: null },
      { v1: 1, v2: 0, front: stex(0), back: null },
    ],
  });

  it('lets a body allowed to crossSeams walk straight through a passable seam', () => {
    const r = movePlayer(buildBsp(seamRoom(true)), 4, 7, 0, 2, R, STEP, HEAD, undefined, true);

    expect(r.y).toBeCloseTo(9, 5);
    expect(r.x).toBeCloseTo(4, 5);
  });

  it('still blocks a body NOT allowed to crossSeams (enemies never cross zones)', () => {
    const r = movePlayer(buildBsp(seamRoom(true)), 4, 7, 0, 2, R, STEP, HEAD);

    expect(r.y).toBeCloseTo(8 - R, 5);
  });

  it('keeps a NON-passable seam solid even for a crossSeams body (stage-2 windows stay windows)', () => {
    for (const passable of [false, undefined]) {
      const r = movePlayer(
        buildBsp(seamRoom(passable)),
        4,
        7,
        0,
        2,
        R,
        STEP,
        HEAD,
        undefined,
        true,
      );

      expect(r.y).toBeCloseTo(8 - R, 5);
    }
  });
});

describe('glass walls block the player (see-through but solid)', () => {
  const gtex = (sector: number): SideDef => ({
    sector,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'G',
    lowerTex: 'G',
    middleTex: 'G',
  });
  const twoRoom = (glass: boolean): MapSource => ({
    vertices: [
      { x: 0, y: 0 },
      { x: 0, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 0 },
      { x: 8, y: 4 },
      { x: 8, y: 0 },
    ],
    sectors: [
      { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 },
      { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 },
    ],
    linedefs: [
      { v1: 0, v2: 1, front: gtex(0), back: null },
      { v1: 1, v2: 2, front: gtex(0), back: null },
      { v1: 2, v2: 3, front: gtex(0), back: gtex(1), glass },
      { v1: 3, v2: 0, front: gtex(0), back: null },
      { v1: 2, v2: 4, front: gtex(1), back: null },
      { v1: 4, v2: 5, front: gtex(1), back: null },
      { v1: 5, v2: 3, front: gtex(1), back: null },
    ],
    things: [],
  });

  it('lets the player cross a plain two-sided opening (same floor)', () => {
    const r = movePlayer(buildBsp(twoRoom(false)), 3, 2, 2, 0, R, STEP, HEAD);

    expect(r.x).toBeGreaterThan(4);
  });

  it('BLOCKS the player at a glass wall', () => {
    const r = movePlayer(buildBsp(twoRoom(true)), 3, 2, 2, 0, R, STEP, HEAD);

    expect(r.x).toBeLessThan(4);
  });

  it('BLOCKS the player at a FENCE edge (blocking furniture), even though the far floor is walkable', () => {
    const src = twoRoom(false);
    const fenced: MapSource = {
      ...src,
      linedefs: src.linedefs.map((l, i) => (i === 2 ? { ...l, fence: true } : l)),
    };
    const r = movePlayer(buildBsp(fenced), 3, 2, 2, 0, R, STEP, HEAD);

    expect(r.x).toBeLessThan(4);
  });
});

describe('sliding doors bar the way until mostly open (openness ≥ SLIDE_OPEN)', () => {
  const stex = (sector: number): SideDef => ({
    sector,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'S',
    lowerTex: 'S',
    middleTex: 'S',
  });
  const twoRoom = () =>
    buildBsp({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 0 },
        { x: 8, y: 4 },
        { x: 8, y: 0 },
      ],
      sectors: [
        { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 },
        { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 },
      ],
      linedefs: [
        { v1: 0, v2: 1, front: stex(0), back: null },
        { v1: 1, v2: 2, front: stex(0), back: null },
        { v1: 2, v2: 3, front: stex(0), back: stex(1), sliding: true },
        { v1: 3, v2: 0, front: stex(0), back: null },
        { v1: 2, v2: 4, front: stex(1), back: null },
        { v1: 4, v2: 5, front: stex(1), back: null },
        { v1: 5, v2: 3, front: stex(1), back: null },
      ],
      things: [],
    });

  it('blocks when shut — no slides at all, or an openness below the threshold', () => {
    const map = twoRoom();

    expect(movePlayer(map, 3, 2, 2, 0, R, STEP, HEAD).x).toBeLessThan(4);
    expect(movePlayer(map, 3, 2, 2, 0, R, STEP, HEAD, [0, 0, 0.5, 0, 0, 0, 0]).x).toBeLessThan(4);
  });

  it('lets the player through once open past the threshold', () => {
    const r = movePlayer(twoRoom(), 3, 2, 2, 0, R, STEP, HEAD, [0, 0, 1, 0, 0, 0, 0]);

    expect(r.x).toBeGreaterThan(4);
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
      { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 },
      { floorZ: eastFloor, ceilZ: eastCeil, floorTex: 'F', ceilTex: 'C', light: 200 },
    ],
    linedefs: [
      { v1: 0, v2: 1, front: sideTex(0), back: null },
      { v1: 1, v2: 2, front: sideTex(0), back: null },
      { v1: 2, v2: 4, front: sideTex(1), back: null },
      { v1: 4, v2: 5, front: sideTex(1), back: null },
      { v1: 5, v2: 3, front: sideTex(1), back: null },
      { v1: 3, v2: 0, front: sideTex(0), back: null },
      { v1: 3, v2: 2, front: sideTex(1), back: sideTex(0) },
    ],
    things: [],
  });

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
    expect(climb(0.8, 1.2)).toBeNull();
  });

  it('returns null when a one-sided wall blocks the probe (a true wall, not a ledge)', () => {
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
      { floorZ: 0, ceilZ: 5, floorTex: 'F', ceilTex: 'C', light: 200 },
      { floorZ: eastFloor, ceilZ: eastCeil, floorTex: 'F', ceilTex: 'C', light: 200 },
    ],
    linedefs: [
      { v1: 0, v2: 1, front: sideTex(0), back: null },
      { v1: 1, v2: 2, front: sideTex(0), back: null },
      { v1: 2, v2: 4, front: sideTex(1), back: null },
      { v1: 4, v2: 5, front: sideTex(1), back: null },
      { v1: 5, v2: 3, front: sideTex(1), back: null },
      { v1: 3, v2: 0, front: sideTex(0), back: null },
      { v1: 3, v2: 2, front: sideTex(1), back: sideTex(0) },
    ],
    things: [],
  });
  const FLAT = buildBsp(mapWith(0));

  it('stops a downward shot at the floor it dives into', () => {
    const hit = castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, -1.0, 5);

    expect(hit?.surface).toBe('floor');
    expect(hit?.z).toBe(0);
    expect(hit?.dist).toBeGreaterThan(1.4);
    expect(hit?.dist).toBeLessThanOrEqual(1.6);
    expect(hit?.x).toBeCloseTo(3 + (hit?.dist ?? 0), 5);
  });

  it('stops an upward shot at the ceiling it climbs into', () => {
    const hit = castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, 2.0, 3);

    expect(hit?.surface).toBe('ceil');
    expect(hit?.z).toBe(5);
    expect(hit?.dist).toBeGreaterThan(1.8);
    expect(hit?.dist).toBeLessThanOrEqual(2.0);
  });

  it('lets a level shot fly clear when it stays between floor and ceiling', () => {
    expect(castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, 0, 5)).toBeNull();
  });

  it('strikes a step that rises above the shot, even when level (a too-tall step blocks the shot)', () => {
    const hit = castFloorCeil(buildBsp(mapWith(2)), 3, 4, 1, 0, 1.4, 0, 6);

    expect(hit?.surface).toBe('floor');
    expect(hit?.z).toBe(2);
    expect(hit?.dist).toBeGreaterThan(3);
  });

  it('clears a low step when level, then lands on it once the shot dips below its height', () => {
    const LOW = buildBsp(mapWith(0.5));

    expect(castFloorCeil(LOW, 3, 4, 1, 0, 1.4, 0, 6)).toBeNull();
    const dip = castFloorCeil(LOW, 3, 4, 1, 0, 1.4, -0.15, 7);

    expect(dip?.surface).toBe('floor');
    expect(dip?.z).toBe(0.5);
    expect(dip?.x).toBeGreaterThan(6);
  });

  it('reads the live ceiling, so a shut door (ceil lowered to the floor) stops a shot', () => {
    const hit = castFloorCeil(buildBsp(mapWith(0, 0)), 3, 4, 1, 0, 1.4, 0, 5);

    expect(hit?.surface).toBe('ceil');
    expect(hit?.dist).toBeGreaterThan(3);
  });

  it('takes at least one sample even at zero range (origin inside the room → no hit)', () => {
    expect(castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, 0, 0)).toBeNull();
  });

  it('clears floor/ceiling within the muzzle grace, colliding only beyond it', () => {
    expect(castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, -1.0, 5)?.dist).toBeLessThan(2);
    const graced = castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, -1.0, 5, undefined, 2.5);

    expect(graced?.surface).toBe('floor');
    expect(graced?.dist).toBeGreaterThanOrEqual(2.5);
    expect(castFloorCeil(FLAT, 3, 4, 1, 0, 1.4, -1.0, 5, undefined, 6)).toBeNull();
  });
});

describe('mantleStep', () => {
  const M = { progress: 0, startZ: 0, targetZ: 2, dirX: 1, dirY: 0 } as const;

  it('advances progress by dt/duration and glides the covered slice of the forward advance', () => {
    const step = mantleStep(M, 0.2, 0.4, 0.5, 1.4);

    expect(step.progress).toBeCloseTo(0.5, 12);
    expect(step.dx).toBeCloseTo(0.25, 12);
    expect(step.dy).toBe(0);
    expect(step.done).toBe(false);
    expect(step.z).toBeCloseTo(2.4, 12);
  });

  it('glides along the captured heading direction', () => {
    const step = mantleStep({ ...M, dirX: 0, dirY: 1 }, 0.2, 0.4, 0.5, 1.4);

    expect(step.dx).toBe(0);
    expect(step.dy).toBeCloseTo(0.25, 12);
  });

  it('caps the stride by the remaining progress and snaps the eye onto the ledge on completion', () => {
    const step = mantleStep({ ...M, progress: 0.9 }, 0.2, 0.4, 0.5, 1.4);

    expect(step.done).toBe(true);
    expect(step.dx).toBeCloseTo(0.05, 12);
    expect(step.z).toBe(2 + 1.4);
  });
});
