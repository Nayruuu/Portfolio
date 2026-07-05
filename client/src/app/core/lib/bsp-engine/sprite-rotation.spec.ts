import { describe, expect, it } from 'vitest';

import { orientSprite, PROP_ROTATIONS, rotationCell } from './sprite-rotation';
import type { Sprite } from './renderer';

const N = Math.PI * 1.5; // "north" in the maps' y-DOWN convention (direction (0, −1))

describe('rotationCell', () => {
  it('picks the four cardinal cells around a north-facing thing (y-down convention)', () => {
    // Thing at the origin facing north (1.5π). Front = seen from the north; the viewer standing to
    // the EAST is on the thing's right hand (facing north, y down → east is the right side).
    expect(rotationCell(N, 0, 0, 0, -5)).toBe(0); // viewer north → FRONT
    expect(rotationCell(N, 0, 0, 5, 0)).toBe(1); // viewer east → RIGHT
    expect(rotationCell(N, 0, 0, 0, 5)).toBe(2); // viewer south → BACK
    expect(rotationCell(N, 0, 0, -5, 0)).toBe(3); // viewer west → LEFT
  });

  it('splits quadrants on the ±45° diagonals, half-open toward +rel', () => {
    // Thing facing +x: the −45° diagonal BELONGS to front, the +45° diagonal opens the next cell.
    expect(rotationCell(0, 0, 0, 1, -1)).toBe(0); // rel = −45° → still FRONT
    expect(rotationCell(0, 0, 0, 1, 1)).toBe(1); // rel = +45° → RIGHT
    expect(rotationCell(0, 0, 0, -1, 1)).toBe(2); // rel = 135° → BACK
    expect(rotationCell(0, 0, 0, -1, -1)).toBe(3); // rel = 225° → LEFT
  });

  it('is anchored to the thing, not the origin (bearing from the thing position)', () => {
    // Same viewer point, two thing positions → opposite sides of an east-facing prop.
    expect(rotationCell(0, 10, 10, 20, 10)).toBe(0); // viewer due east of (10,10) → FRONT
    expect(rotationCell(0, 30, 10, 20, 10)).toBe(2); // viewer due west of (30,10) → BACK
  });

  it('wraps any facing into range (negative, beyond 2π, equivalent aliases agree)', () => {
    // −π/2 and 1.5π are the same north facing; 7π is the same as π (west).
    expect(rotationCell(-Math.PI / 2, 0, 0, 0, -5)).toBe(rotationCell(N, 0, 0, 0, -5));
    expect(rotationCell(-Math.PI / 2, 0, 0, 5, 0)).toBe(rotationCell(N, 0, 0, 5, 0));
    expect(rotationCell(7 * Math.PI, 0, 0, -5, 0)).toBe(0); // facing ≡ π (west), viewer west → FRONT
    expect(rotationCell(7 * Math.PI, 0, 0, 5, 0)).toBe(2); // viewer east → BACK
  });

  it('wraps the bearing across the atan2 ±π cut (west-facing thing, viewer almost due west)', () => {
    // The thing→viewer bearing flips sign across the −x axis (π vs −π); both sides must read FRONT.
    expect(rotationCell(Math.PI, 10, 10, 0, 10.001)).toBe(0); // bearing ≈ +π − ε
    expect(rotationCell(Math.PI, 10, 10, 0, 9.999)).toBe(0); // bearing ≈ −π + ε
  });

  it('reads a viewer exactly on the thing as front (atan2(0,0) = 0)', () => {
    expect(rotationCell(0, 4, 4, 4, 4)).toBe(0);
  });

  it('covers all four cells over a full circle of viewpoints', () => {
    // Sweep 360 viewpoints around an arbitrarily-facing thing: every cell shows, each ~90° worth.
    const counts = [0, 0, 0, 0];

    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * 2 * Math.PI;

      counts[rotationCell(0.7, 3, -2, 3 + Math.cos(a), -2 + Math.sin(a))]++;
    }
    expect(counts).toHaveLength(PROP_ROTATIONS);
    for (const n of counts) {
      expect(n).toBe(90);
    }
  });
});

describe('orientSprite', () => {
  const plain: Sprite = { x: 2, y: 3, z: 0, tex: 'PROP', width: 0.8, height: 1.6 };
  const rot: Sprite = {
    x: 2,
    y: 3,
    z: 0,
    tex: 'PROP_TOTEM',
    width: 0.7,
    height: 2,
    cols: PROP_ROTATIONS,
    rows: 1,
    col: 0,
    row: 0,
    rotations: PROP_ROTATIONS,
    facing: N,
  };

  it('returns a view-independent sprite UNCHANGED (same reference — no per-frame copies)', () => {
    expect(orientSprite(plain, 50, 50)).toBe(plain);
  });

  it('re-picks the rotation cell of a directional sprite for the viewpoint, without mutating it', () => {
    expect(orientSprite(rot, 2, -7).col).toBe(0); // viewer north of the north-facing totem → FRONT
    expect(orientSprite(rot, 12, 3).col).toBe(1); // viewer east → RIGHT
    expect(orientSprite(rot, 2, 13).col).toBe(2); // viewer south → BACK
    expect(orientSprite(rot, -8, 3).col).toBe(3); // viewer west → LEFT
    expect(rot.col).toBe(0); // the source sprite is untouched
  });

  it('defaults a missing facing to 0 (+x)', () => {
    const unfaced: Sprite = { ...rot, facing: undefined };

    expect(orientSprite(unfaced, 12, 3).col).toBe(0); // viewer east of an east-facing default → FRONT
    expect(orientSprite(unfaced, -8, 3).col).toBe(2); // viewer west → BACK
  });
});
