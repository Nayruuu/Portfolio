import { describe, it, expect } from 'vitest';
import { buildBsp, climbTarget, locateSubSector, movePlayer } from '../../bsp-engine';
import { DEMO_MAP } from './demo-map';

describe('DEMO_MAP', () => {
  const map = buildBsp(DEMO_MAP);
  const floorAt = (x: number, y: number): number =>
    DEMO_MAP.sectors[locateSubSector(map.root, x, y).sector].floorZ;

  it('compiles into a non-empty BSP', () => {
    expect(map.subsectors.length).toBeGreaterThan(0);
  });

  it('lands the spawn on the room floor, the dais raised, the stepped bowl sunken (winding correct)', () => {
    expect(floorAt(2, 10)).toBe(0);
    expect(floorAt(12, 6)).toBe(1);
    expect(floorAt(3.5, 2.5)).toBe(-0.8);
    expect(floorAt(5, 4)).toBe(-1.6);
  });

  it('lets the player climb OUT of the −1.6 bowl centre in every direction (no trap)', () => {
    const reach = 0.066;

    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const dx = Math.cos(ang) * reach;
      const dy = Math.sin(ang) * reach;
      let x = 4.83;
      let y = 4;

      for (let i = 0; i < 120; i++) {
        const m = movePlayer(map, x, y, dx, dy, 0.3, 1.1, 0.8);

        x = m.x;
        y = m.y;
      }

      expect(floorAt(x, y)).toBeGreaterThanOrEqual(0);
    }
  });

  it('makes the pedestal a too-tall-but-climbable mantle ledge (not a step, not a wall)', () => {
    const px = 16;
    const py = 1.75;

    expect(floorAt(px, py)).toBe(0);

    const m = movePlayer(map, px, py, 1, 0, 0.3, 1.1, 0.8);

    expect(m.floorZ).toBe(0);
    expect(m.x).toBeLessThan(16.5);

    expect(climbTarget(map, m.x, m.y, 0, 1, 0, 0.45, 1.1, 2.4, 0.8)).toBe(1.6);
  });

  describe('east annex (corridor · balcony · sunken hall · staircase)', () => {
    const R = 0.3;
    const STEP = 1.1;
    const HEAD = 0.8;

    it('places each annex sector at the right floor (winding correct)', () => {
      expect(floorAt(21.5, 4.5)).toBe(0);
      expect(floorAt(25.5, 9)).toBe(0);
      expect(floorAt(36, 9)).toBe(-2.7);
      expect(floorAt(29, 2.5)).toBe(-0.9);
      expect(floorAt(31, 2.5)).toBe(-1.8);
    });

    it('lets the player walk through the doorway into the annex', () => {
      let x = 19;
      let y = 4.5;

      for (let i = 0; i < 90; i++) {
        const m = movePlayer(map, x, y, 0.066, 0, R, STEP, HEAD);

        x = m.x;
        y = m.y;
      }

      expect(x).toBeGreaterThan(23);
      expect(floorAt(x, y)).toBe(0);
    });

    it('lets the player climb OUT of the sunken hall via the staircase', () => {
      let x = 35;
      let y = 3;

      for (let i = 0; i < 200; i++) {
        const m = movePlayer(map, x, y, -0.066, 0, R, STEP, HEAD);

        x = m.x;
        y = m.y;
      }

      expect(floorAt(x, y)).toBe(0);
    });

    it('makes the balcony edge a ONE-WAY drop — neither stepped nor mantled back up', () => {
      let x = 30;
      let y = 9;

      for (let i = 0; i < 120; i++) {
        const m = movePlayer(map, x, y, -0.066, 0, R, STEP, HEAD);

        x = m.x;
        y = m.y;
      }

      expect(floorAt(x, y)).toBe(-2.7);
      expect(x).toBeGreaterThan(28);
      expect(climbTarget(map, x, y, -2.7, -1, 0, 0.45, 1.1, 2.4, 0.8)).toBeNull();
    });
  });
});
