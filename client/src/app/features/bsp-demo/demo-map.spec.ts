import { describe, it, expect } from 'vitest';
import { buildBsp, climbTarget, locateSubSector, movePlayer } from '../../core/lib/bsp-engine';
import { DEMO_MAP } from './demo-map';

describe('DEMO_MAP', () => {
  const map = buildBsp(DEMO_MAP);
  const floorAt = (x: number, y: number): number =>
    DEMO_MAP.sectors[locateSubSector(map.root, x, y).sector].floorZ;

  it('compiles into a non-empty BSP', () => {
    expect(map.subsectors.length).toBeGreaterThan(0);
  });

  it('lands the spawn on the room floor, the dais raised, the stepped bowl sunken (winding correct)', () => {
    expect(floorAt(2, 10)).toBe(0); // spawn — room floor
    expect(floorAt(12, 6)).toBe(1); // dais top centre — raised
    expect(floorAt(3.5, 2.5)).toBe(-0.8); // pit outer ring — first step down
    expect(floorAt(5, 4)).toBe(-1.6); // bowl centre — deeper step
  });

  it('lets the player climb OUT of the −1.6 bowl centre in every direction (no trap)', () => {
    // Regression guard: the deep bowl used to wedge the player on diagonal headings, because a dais corner
    // 3.7 cells away phantom-pushed them (the engine measured wall distance along the infinite line, not the
    // segment). Push 120 frames from the centre in 16 directions; every one must surface to a non-sunken floor.
    const reach = 0.066; // ≈ MOVE_SPEED (4) · dt (1/60)

    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const dx = Math.cos(ang) * reach;
      const dy = Math.sin(ang) * reach;
      let x = 4.83;
      let y = 4; // the pose the player reported being stuck at

      for (let i = 0; i < 120; i++) {
        const m = movePlayer(map, x, y, dx, dy, 0.3, 1.1, 0.8);

        x = m.x;
        y = m.y;
      }

      expect(floorAt(x, y)).toBeGreaterThanOrEqual(0); // climbed out of the bowl (room or up onto the dais)
    }
  });

  it('makes the pedestal a too-tall-but-climbable mantle ledge (not a step, not a wall)', () => {
    const px = 16; // just west of the pedestal's west face (x=16.5)
    const py = 1.75; // mid-height of that face (its y-span is 0.5..3)

    expect(floorAt(px, py)).toBe(0); // standing on the room floor

    // Stepping cannot climb it — the 1.6 rise exceeds stepMax (1.1), so movePlayer parks the player off it.
    const m = movePlayer(map, px, py, 1, 0, 0.3, 1.1, 0.8); // walk east into the face

    expect(m.floorZ).toBe(0); // never stepped up
    expect(m.x).toBeLessThan(16.5); // parked west of the face

    // …but the climb probe classifies that same obstacle as a vaultable ledge → the pedestal floor.
    expect(climbTarget(map, m.x, m.y, 0, 1, 0, 0.45, 1.1, 2.4, 0.8)).toBe(1.6);
  });

  describe('east annex (corridor · balcony · sunken hall · staircase)', () => {
    const R = 0.3;
    const STEP = 1.1;
    const HEAD = 0.8;

    it('places each annex sector at the right floor (winding correct)', () => {
      expect(floorAt(21.5, 4.5)).toBe(0); // corridor
      expect(floorAt(25.5, 9)).toBe(0); // balcony (mezzanine, level 0)
      expect(floorAt(36, 9)).toBe(-2.7); // sunken hall (deep)
      expect(floorAt(29, 2.5)).toBe(-0.9); // staircase step 1
      expect(floorAt(31, 2.5)).toBe(-1.8); // staircase step 2
    });

    it('lets the player walk through the doorway into the annex', () => {
      let x = 19;
      let y = 4.5; // in the room, facing the doorway (y 3–6)

      for (let i = 0; i < 90; i++) {
        const m = movePlayer(map, x, y, 0.066, 0, R, STEP, HEAD); // walk east

        x = m.x;
        y = m.y;
      }

      expect(x).toBeGreaterThan(23); // crossed the corridor into the balcony — the doorway is passable
      expect(floorAt(x, y)).toBe(0);
    });

    it('lets the player climb OUT of the sunken hall via the staircase', () => {
      let x = 35;
      let y = 3; // on the hall floor, in line with the staircase (y 1–4)

      for (let i = 0; i < 200; i++) {
        const m = movePlayer(map, x, y, -0.066, 0, R, STEP, HEAD); // walk west, up the steps

        x = m.x;
        y = m.y;
      }

      expect(floorAt(x, y)).toBe(0); // back up on the balcony — the stairs are a real route out
    });

    it('makes the balcony edge a ONE-WAY drop — neither stepped nor mantled back up', () => {
      let x = 30;
      let y = 9; // on the hall floor, below the overlook (the balcony edge at x=28, north of the stairs)

      for (let i = 0; i < 120; i++) {
        const m = movePlayer(map, x, y, -0.066, 0, R, STEP, HEAD); // try to walk west, up onto the balcony

        x = m.x;
        y = m.y;
      }

      expect(floorAt(x, y)).toBe(-2.7); // blocked below the lip — the 2.7 rise is not climbable here
      expect(x).toBeGreaterThan(28); // parked against the overlook wall, never crossed onto the balcony
      // …and the auto-mantle probe REFUSES it too: 2.7 > climbMax (2.4), so the staircase is the only way up.
      expect(climbTarget(map, x, y, -2.7, -1, 0, 0.45, 1.1, 2.4, 0.8)).toBeNull();
    });
  });
});
