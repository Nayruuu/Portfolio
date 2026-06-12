import { describe, it, expect } from 'vitest';
import {
  CAMERA_Z,
  EYE_FRACTION,
  floorRow,
  floorScreenY,
  surfaceScreenY,
  VIEW_PITCH_STRETCH,
  WALL_HEIGHT,
} from './floor-cast';
import { floorZAt } from './sector';
import type { GameMap } from './game-map';

const FOV = Math.PI / 3;
const W = 320;
const H = 200;

// rowDistance at the screen bottom (p = H/2): VIEW_PITCH_STRETCH·CAMERA_Z·H / (H/2) = 2·STRETCH·CAMERA_Z.
const BOTTOM_DIST = 2 * VIEW_PITCH_STRETCH * CAMERA_Z;

describe('floorRow', () => {
  it('puts the screen-bottom row at the stretched, eye-low distance ahead', () => {
    // Pose at origin facing +x: at the screen bottom (p = H/2) rowDistance = 2·STRETCH·CAMERA_Z, so the
    // row's left-edge world point is that far ahead (+x), offset to the side by the FOV plane. Symbolic so
    // the assertions track the eye-height + stretch tuning rather than a baked-in number.
    const row = floorRow({ x: 0, y: 0, dir: 0 }, FOV, H, W, H);

    expect(row.worldX).toBeCloseTo(BOTTOM_DIST, 5); // forward (+x)
    expect(row.worldY).toBeCloseTo(-BOTTOM_DIST * Math.tan(FOV / 2), 5); // left edge is to -y
    expect(row.stepX).toBeCloseTo(0, 5); // along +x, forward distance is constant across the row
    expect(row.stepY).toBeCloseTo((BOTTOM_DIST * 2 * Math.tan(FOV / 2)) / W, 5);
  });

  it('row distance grows toward the horizon (smaller p)', () => {
    const near = floorRow({ x: 0, y: 0, dir: 0 }, FOV, H, W, H).worldX; // bottom
    const far = floorRow({ x: 0, y: 0, dir: 0 }, FOV, H / 2 + 1, W, H).worldX; // near horizon

    expect(far).toBeGreaterThan(near); // farther forward
  });

  it('casts a higher surface (the ceiling) FARTHER at the same screen row — the asymmetric low eye', () => {
    const floor = floorRow({ x: 0, y: 0, dir: 0 }, FOV, H, W, H); // surfaceZ = CAMERA_Z (eye → floor)
    const ceil = floorRow({ x: 0, y: 0, dir: 0 }, FOV, H, W, H, WALL_HEIGHT - CAMERA_Z); // eye → ceiling

    expect(ceil.worldX).toBeGreaterThan(floor.worldX); // the taller ceiling reaches a farther world point
    expect(ceil.worldX / floor.worldX).toBeCloseTo((WALL_HEIGHT - CAMERA_Z) / CAMERA_Z, 5);
  });

  it('the row centre sits dead ahead of the player (worldY === pose.y when facing +x)', () => {
    const row = floorRow({ x: 0, y: 0, dir: 0 }, FOV, H, W, H);
    const centreY = row.worldY + row.stepY * (W / 2);

    expect(centreY).toBeCloseTo(0, 5);
  });

  it('shifts with the player position', () => {
    const a = floorRow({ x: 0, y: 0, dir: 0 }, FOV, H, W, H);
    const b = floorRow({ x: 5, y: 3, dir: 0 }, FOV, H, W, H);

    expect(b.worldX - a.worldX).toBeCloseTo(5, 5);
    expect(b.worldY - a.worldY).toBeCloseTo(3, 5);
  });
});

describe('floorScreenY', () => {
  it('sits below the horizon and recedes toward it with depth', () => {
    expect(floorScreenY(2, H)).toBeGreaterThan(H / 2); // the floor is below the horizon
    expect(floorScreenY(8, H)).toBeLessThan(floorScreenY(2, H)); // a farther floor rises toward the horizon
  });

  it('matches the stretched, eye-low projection so a billboard’s feet meet the floor cast', () => {
    const depth = 3;

    expect(floorScreenY(depth, H)).toBeCloseTo(
      H / 2 + (VIEW_PITCH_STRETCH * CAMERA_Z * H) / depth,
      5,
    );
  });
});

describe('surfaceScreenY', () => {
  // Legacy wall slice height at `depth`: the height a full wall projects to on screen, split around the
  // horizon by the eye fraction — the expression game-renderer.ts uses for wall tops + bottoms today.
  const sliceHeight = (depth: number): number => (VIEW_PITCH_STRETCH * H * WALL_HEIGHT) / depth;

  it('reproduces floorScreenY for the floor (eye-to-surface = CAMERA_Z)', () => {
    for (const d of [2, 3, 8]) {
      expect(surfaceScreenY(CAMERA_Z, d, H)).toBeCloseTo(floorScreenY(d, H), 10);
    }
  });

  it('reproduces the legacy wall-TOP expression (eye-to-surface = CAMERA_Z − WALL_HEIGHT)', () => {
    const d = 4;

    expect(surfaceScreenY(CAMERA_Z - WALL_HEIGHT, d, H)).toBeCloseTo(
      H / 2 - sliceHeight(d) * (1 - EYE_FRACTION),
      10,
    );
  });

  it('reproduces the legacy wall-BOTTOM expression (eye-to-surface = CAMERA_Z)', () => {
    const d = 4;

    expect(surfaceScreenY(CAMERA_Z, d, H)).toBeCloseTo(H / 2 + sliceHeight(d) * EYE_FRACTION, 10);
  });

  it('projects a surface above the eye (eyeToSurface < 0) above the horizon', () => {
    expect(surfaceScreenY(-0.5, 4, H)).toBeLessThan(H / 2);
  });
});

// The grounded-billboard feet anchor the renderer uses: `surfaceScreenY(camZ − floorZAt, depth, H)` with
// `camZ = (pose.z ?? 0) + CAMERA_Z`. These assertions PIN the behaviour the renderer relies on — flat-level
// byte-identity (the math collapses to the legacy `floorScreenY`) plus the sector raise/pit direction.
describe('grounded-sprite floor anchor (surfaceScreenY ∘ floorZAt)', () => {
  // A 1-row height fixture, the same shape sector.spec.ts uses: one own sector per cell.
  const raised: GameMap = {
    width: 3,
    height: 1,
    cells: [0, 0, 0],
    sectors: [
      { floorZ: 0, ceilZ: WALL_HEIGHT, floorMat: 0, ceilMat: 0 }, // base
      { floorZ: 0.5, ceilZ: 0.5 + WALL_HEIGHT, floorMat: 0, ceilMat: 0 }, // raised dais
      { floorZ: -0.5, ceilZ: WALL_HEIGHT, floorMat: 0, ceilMat: 0 }, // pit
    ],
    sectorId: [0, 1, 2],
  };

  /** The renderer's exact feet expression for a sprite over world cell `cellX` at perpendicular `depth`. */
  function feetY(cellX: number, depth: number, poseZ = 0): number {
    const camZ = poseZ + CAMERA_Z;

    return surfaceScreenY(camZ - floorZAt(raised, cellX + 0.5, 0.5), depth, H);
  }

  it('is BYTE-IDENTICAL to floorScreenY on the base floor (floorZ 0, pose.z 0) — the flat collapse', () => {
    for (const depth of [2, 3, 8]) {
      expect(feetY(0, depth)).toBeCloseTo(floorScreenY(depth, H), 10);
    }
  });

  it('anchors a sprite on a RAISED floor HIGHER on screen (smaller Y) than on the base floor', () => {
    const depth = 3;

    expect(feetY(1, depth)).toBeLessThan(feetY(0, depth)); // raised dais → feet sit up
  });

  it('anchors a sprite in a PIT LOWER on screen (larger Y) than on the base floor', () => {
    const depth = 3;

    expect(feetY(2, depth)).toBeGreaterThan(feetY(0, depth)); // pit → feet sink
  });

  it('raising the camera (pose.z) lifts a same-floor sprite the same way a raised floor would lower it', () => {
    const depth = 3;

    // camZ grows with pose.z, so eye-to-floor grows → the feet project LOWER (the player looks down more).
    expect(feetY(0, depth, 0.5)).toBeGreaterThan(feetY(0, depth, 0));
  });
});
