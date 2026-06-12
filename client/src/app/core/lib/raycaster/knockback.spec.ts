import { describe, it, expect } from 'vitest';
import { knockback, recoil } from './knockback';
import type { Enemy, Pose } from './types';

// A 4×4 room with a 2×2 open core (cells (1,1)(2,1)(1,2)(2,2)); a wall on +x at column 3 lets us drive
// both the clear-push and wall-clamped arms.
const MAP = {
  width: 4,
  height: 4,
  cells: [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1],
};
const foe = (x: number, y: number): Enemy => ({
  x,
  y,
  dir: 0,
  state: 'alive',
  deathTime: 0,
  hp: 3,
  fireCooldown: 0,
  hitFlash: 0,
  windup: 0,
  kind: 'manager',
});

describe('knockback', () => {
  it('shoves the enemy straight away from the player by `distance` cells', () => {
    const pose: Pose = { x: 1.5, y: 1.5, dir: 0 };
    const pushed = knockback(pose, foe(1.9, 1.5), MAP, 0.6);

    expect(pushed.x).toBeCloseTo(2.5, 5); // pushed +x (away from the player) by the full distance
    expect(pushed.y).toBeCloseTo(1.5, 5);
  });

  it('clamps the push at a wall so the enemy never enters solid space', () => {
    const pose: Pose = { x: 1.5, y: 1.5, dir: 0 };
    // The enemy sits at x=2.6 with a wall at cell (3,1); a 0.6 push would land at x=3.2 (inside the wall).
    const pushed = knockback(pose, foe(2.6, 1.5), MAP, 0.6);

    expect(pushed.x).toBe(2.6); // the +x push is blocked by the wall — stays put
    expect(pushed.y).toBeCloseTo(1.5, 5);
  });

  it('clamps a +y push at a wall too (the other axis is checked independently)', () => {
    const pose: Pose = { x: 1.5, y: 1.5, dir: 0 };
    // The enemy sits at y=2.6 with a wall at cell (1,3); a 0.6 push would land at y=3.2 (inside the wall).
    const pushed = knockback(pose, foe(1.5, 2.6), MAP, 0.6);

    expect(pushed.y).toBe(2.6); // the +y push is blocked by the wall — stays put
    expect(pushed.x).toBeCloseTo(1.5, 5);
  });

  it('slides along the open axis when only one axis is wall-blocked (axis-separated)', () => {
    const pose: Pose = { x: 1.5, y: 0.5, dir: 0 }; // below-left → the push has a +x and a +y component
    const pushed = knockback(pose, foe(2.6, 1.4), MAP, 0.6);

    expect(pushed.x).toBe(2.6); // +x blocked by the wall at column 3
    expect(pushed.y).toBeGreaterThan(1.4); // +y slides freely within the open room
  });

  it('leaves an enemy sitting exactly on the player untouched (no divide-by-zero)', () => {
    const pose: Pose = { x: 1.5, y: 1.5, dir: 0 };
    const pushed = knockback(pose, foe(1.5, 1.5), MAP, 0.6);

    expect(pushed).toEqual({ x: 1.5, y: 1.5 });
  });
});

describe('recoil', () => {
  it('shoves the player straight back, opposite their facing, preserving the heading', () => {
    const pose: Pose = { x: 2.5, y: 1.5, dir: 0 }; // facing +x
    const recoiled = recoil(pose, MAP, 0.6);

    expect(recoiled.x).toBeCloseTo(1.9, 5); // pushed −x (straight back) by the full distance
    expect(recoiled.y).toBeCloseTo(1.5, 5);
    expect(recoiled.dir).toBe(0); // facing preserved
  });

  it('clamps the recoil at a wall on the blocked axis', () => {
    // Facing −x → the recoil pushes +x, where the column-3 wall sits; the blocked axis holds.
    const pose: Pose = { x: 2.4, y: 1.5, dir: Math.PI };
    const recoiled = recoil(pose, MAP, 0.6);

    expect(recoiled.x).toBeCloseTo(2.4, 5); // +x recoil into the wall is clamped
    expect(recoiled.y).toBeCloseTo(1.5, 5); // the open axis is unchanged
  });

  it('leaves the player put for a zero recoil distance', () => {
    const pose: Pose = { x: 1.5, y: 1.5, dir: 0.7 };

    expect(recoil(pose, MAP, 0)).toEqual(pose);
  });

  it('checks the y-recoil at the RESOLVED x, so a diagonal recoil never clips a wall corner', () => {
    // A solid block at cell (3,2); cells (3,1) and (2,2) are open. Facing down-left so the recoil pushes
    // +x and +y toward that corner: the x-move into (3,1) is free, but the y-move must be tested at the
    // resolved column 3 — where (3,2) is solid — not the original column 2 (open), or the player clips in.
    const cornerMap = {
      width: 5,
      height: 5,
      cells: [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    };
    const pose: Pose = { x: 2.5, y: 1.5, dir: (5 * Math.PI) / 4 };
    const recoiled = recoil(pose, cornerMap, 1);

    expect(recoiled.x).toBeCloseTo(3.20710678, 5); // the +x recoil into the open (3,1) is free
    expect(recoiled.y).toBeCloseTo(1.5, 5); // the +y recoil is clamped at the resolved column (3,2 is solid)
  });
});
