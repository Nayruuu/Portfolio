import { describe, it, expect } from 'vitest';
import { castColumns } from './raycast';
import { CAMERA_Z, WALL_HEIGHT, surfaceScreenY } from './floor-cast';
import { GLASS_BASE, SAMPLE_LEVEL } from './game-map';
import { sectorize } from './sector';
import type { GameMap } from './game-map';
import type { Sector } from './sector';
import type { ColumnProfile, FlatSpan, Pose, StepSpan } from './types';

const FOV = Math.PI / 3; // 60°
const H = 200; // a concrete backing height so the core can project span edges

describe('castColumns', () => {
  it('returns one hit per column', () => {
    const pose: Pose = { x: 1.5, y: 1.5, dir: 0 };

    expect(castColumns(pose, FOV, SAMPLE_LEVEL, 64, H)).toHaveLength(64);
  });

  it('sees THROUGH a glass cell: records the pane, then casts on to the opaque wall behind', () => {
    // Row 1: player(1) · GLASS(2) · open(3) · wall(4). Facing +x from (1.5, 1.5).
    const map: GameMap = {
      width: 6,
      height: 3,
      // prettier-ignore
      cells: [
        1, 1, 1, 1, 1, 1,
        1, 0, GLASS_BASE, 0, 1, 1,
        1, 1, 1, 1, 1, 1,
      ],
    };
    const center = castColumns({ x: 1.5, y: 1.5, dir: 0 }, FOV, map, 64, H)[32]; // cameraX 0 → straight +x

    expect(center.terminal.cell).toBe(1); // the OPAQUE wall behind the pane, not the glass
    expect(center.terminal.dist).toBeCloseTo(2.5, 5); // wall face at x=4, from x=1.5
    expect(center.glass).toHaveLength(1); // one pane crossed before the wall
    expect(center.glass[0].cell).toBe(GLASS_BASE); // the glass id (selects the pane texture)
    expect(center.glass[0].dist).toBeCloseTo(0.5, 5); // pane face at x=2
    expect(center.glass[0].dist).toBeLessThan(center.terminal.dist); // the pane is IN FRONT of the wall
  });

  it('sees through a glass cell crossed on the Y axis too (side 1)', () => {
    // Column 1: player(y1) · GLASS(y2) · open(y3) · wall(y4). Facing +y from (1.5, 1.5).
    const map: GameMap = {
      width: 3,
      height: 6,
      // prettier-ignore
      cells: [
        1, 1, 1,
        1, 0, 1,
        1, GLASS_BASE, 1,
        1, 0, 1,
        1, 1, 1,
        1, 1, 1,
      ],
    };
    const center = castColumns({ x: 1.5, y: 1.5, dir: Math.PI / 2 }, FOV, map, 64, H)[32]; // straight +y

    expect(center.terminal.side).toBe(1); // the opaque wall met on a Y step
    expect(center.terminal.dist).toBeCloseTo(2.5, 5); // wall face at y=4
    expect(center.glass).toHaveLength(1);
    expect(center.glass[0].side).toBe(1); // the pane crossed on the Y axis
    expect(center.glass[0].dist).toBeCloseTo(0.5, 5); // pane face at y=2
  });

  it('the center ray facing +x reaches the far wall (~5.5 cells)', () => {
    const pose: Pose = { x: 1.5, y: 1.5, dir: 0 }; // facing +x toward the x=7 wall
    const hits = castColumns(pose, FOV, SAMPLE_LEVEL, 64, H);
    const center = hits[32]; // cameraX === 0 → straight ahead, down open row 1

    expect(center.terminal.dist).toBeGreaterThan(5);
    expect(center.terminal.dist).toBeLessThan(6);
    expect(center.terminal.cell).toBe(1);
  });

  it('a ray into an adjacent wall is short and positive (no fish-eye blow-up)', () => {
    const pose: Pose = { x: 1.2, y: 1.5, dir: Math.PI }; // facing -x toward the x=0 wall
    const hits = castColumns(pose, FOV, SAMPLE_LEVEL, 3, H);

    expect(hits[1].terminal.dist).toBeGreaterThan(0);
    expect(hits[1].terminal.dist).toBeLessThan(0.5);
    expect(hits[1].terminal.texX).toBeGreaterThanOrEqual(0);
    expect(hits[1].terminal.texX).toBeLessThanOrEqual(1);
    // `wallU` is the CONTINUOUS hit coordinate; `texX` is its fraction (so they agree mod 1).
    expect(hits[1].terminal.wallU - Math.floor(hits[1].terminal.wallU)).toBeCloseTo(
      hits[1].terminal.texX,
      5,
    );
  });
});

describe('castColumns — diagonal walls', () => {
  // 5×5: border walls, interior floor, one diagonal per orientation (each backed by a wall).
  //   (3,2) = orientation 2 (SE, `/`) id 2 — behind: east border
  //   (2,3) = orientation 3 (NE, `\`) id 3 — behind: south border
  //   (1,3) = orientation 1 (NW, `/`) id 4 — the start-cell fixture
  //   (1,1) = orientation 4 (SW, `\`) id 5 — backed by the north/west borders
  //   (3,1) = plain wall id 1 — the pass-through target behind (3,2)
  const FIXTURE: GameMap = {
    width: 5,
    height: 5,
    // prettier-ignore
    cells: [
      1, 1, 1, 1, 1,
      1, 5, 0, 1, 1,
      1, 0, 0, 2, 1,
      1, 4, 3, 0, 1,
      1, 1, 1, 1, 1,
    ],
    // prettier-ignore
    diagonals: [
      0, 0, 0, 0, 0,
      0, 4, 0, 0, 0,
      0, 0, 0, 2, 0,
      0, 1, 3, 0, 0,
      0, 0, 0, 0, 0,
    ],
  };

  const COLUMNS = 64;
  // The column at index COLUMNS/2 has cameraX === 0 → its ray is exactly `pose.dir`.
  const center = (pose: Pose) => castColumns(pose, FOV, FIXTURE, COLUMNS, H)[COLUMNS / 2];

  it('hits a `/` (SE, orientation 2) face head-on at the true camera distance', () => {
    // pose(1.5,2.5) +x → enters (3,2) open NW, meets the hypotenuse at its midpoint.
    const hit = center({ x: 1.5, y: 2.5, dir: 0 });

    expect(hit.terminal.dist).toBeCloseTo(2.0, 5); // t = (3+2+1 - 1.5 - 2.5) / 1
    expect(hit.terminal.texX).toBeCloseTo(0.5, 5); // `/`-family → texX = v
    expect(hit.terminal.wallU).toBeCloseTo(5.5, 5); // continuous: cell anchor (mapX 3 + mapY 2) + the in-cell U 0.5
    expect(hit.terminal.cell).toBe(2); // the wall id carried by the diagonal cell
    expect(hit.terminal.side).toBe(0); // orientation ≤ 2 → side 0
  });

  it('marches the occlusion window to the 45° FACE depth, not the cell boundary (height-path fix)', () => {
    // The diagonal face sits DEEPER than the cell boundary the DDA breaks on. The window must follow it to
    // the face, else the height render path draws the wall into the (nearer, larger) boundary window → the
    // 45° face renders as blocky steps. `terminalBottom` (the floor clip) must equal the floor's screen-Y at
    // the FACE distance.
    const hit = center({ x: 1.5, y: 2.5, dir: 0 });

    expect(hit.terminal.dist).toBeCloseTo(2.0, 5); // the face is at 2.0; the cell boundary is at 1.5
    expect(hit.terminalBottom).toBeCloseTo(surfaceScreenY(CAMERA_Z, hit.terminal.dist, H), 5);
    // the open-half floor strip the fix emits sits at the face depth (a `floor` span clipped to the window)
    expect(hit.spans.some((s) => s.kind === 'floor' && s.yTop === hit.terminalBottom)).toBe(true);
  });

  it('hits a `\\` (NE, orientation 3) face, taking texX from u', () => {
    // pose(2.5,1.5) +y → enters (2,3), meets the v=u hypotenuse at its midpoint.
    const hit = center({ x: 2.5, y: 1.5, dir: Math.PI / 2 });

    expect(hit.terminal.dist).toBeCloseTo(2.0, 5); // t = (mapY - mapX - pose.y + pose.x) / (rayY - rayX)
    expect(hit.terminal.texX).toBeCloseTo(0.5, 5); // `\`-family → texX = u
    expect(hit.terminal.cell).toBe(3);
    expect(hit.terminal.side).toBe(1); // orientation ≥ 3 → side 1
  });

  it('passes through the open half and hits the wall behind (the loop must continue)', () => {
    // A ray clipping (3,2)'s open NW corner never meets its hypotenuse → it must keep stepping
    // and land on the plain wall at (3,1), NOT register the diagonal cell.
    const hit = center({ x: 2.1, y: 2.84, dir: Math.atan2(-0.6, 1) });

    expect(hit.terminal.cell).toBe(1); // the plain wall behind, not the diagonal (id 2)
    expect(hit.terminal.cell).not.toBe(2);
    expect(hit.terminal.dist).toBeGreaterThan(1); // clearly past the diagonal cell's near edge
  });

  it('hits the diagonal of the cell the camera already stands in (start-cell hit)', () => {
    // pose inside (1,3)'s open SE half, facing the NW solid corner → a hit before any DDA step.
    const hit = center({ x: 1.7, y: 3.7, dir: (5 * Math.PI) / 4 });

    expect(hit.terminal.dist).toBeCloseTo(0.28284, 4); // 0.4 / √2
    expect(hit.terminal.texX).toBeCloseTo(0.5, 5);
    expect(hit.terminal.cell).toBe(4);
    expect(hit.terminal.side).toBe(0);
  });

  it('falls through a start-cell diagonal when the ray runs parallel to its face', () => {
    // Same open cell (1,3), but facing -45° (parallel to its `/` face) → the start-cell test
    // misses, the DDA runs, and the ray lands on the next diagonal (2,3).
    const hit = center({ x: 1.7, y: 3.7, dir: -Math.PI / 4 });

    expect(hit.terminal.cell).toBe(3); // the (2,3) diagonal, NOT the start cell (id 4)
    expect(hit.terminal.cell).not.toBe(4);
    expect(hit.terminal.dist).toBeGreaterThan(0.5);
  });

  it('registers a start-cell hit when the ray faces the diagonal face (t > 0)', () => {
    // pose inside (3,2)'s open NW half (orientation 2, SE `/`) facing the solid corner → t > 0 hit.
    const hit = center({ x: 3.3, y: 2.3, dir: Math.PI / 4 });

    expect(hit.terminal.dist).toBeCloseTo(0.28284, 4); // t = (3+2+1 - 3.3 - 2.3) / √2
    expect(hit.terminal.texX).toBeCloseTo(0.5, 5);
    expect(hit.terminal.cell).toBe(2);
    expect(hit.terminal.side).toBe(0);
  });

  it('ignores a start-cell diagonal the ray faces away from (t ≤ 0) and reaches the wall behind', () => {
    // Same open half of (1,3), but facing +x+y AWAY from its NW `/` face → t = −0.4/√2 ≤ 0. Without the
    // guard that negative `t` would clamp to 1e-4 and paint the start cell (id 4) flush with the eye; the
    // guard drops it so the ray falls through to the plain south-border wall (id 1).
    const hit = center({ x: 1.7, y: 3.7, dir: Math.PI / 4 });

    expect(hit.terminal.cell).toBe(1); // the wall behind, not the skipped start diagonal
    expect(hit.terminal.cell).not.toBe(4);
    expect(hit.terminal.dist).toBeGreaterThan(0.1); // a real distance, never the 1e-4 spurious clamp
    expect(hit.terminal.side).toBe(1);
  });

  it('is byte-identical for a normal (non-diagonal) wall hit', () => {
    // From floor (2,2) straight up (-y) into the north border — no diagonal in the path.
    const hit = center({ x: 2.5, y: 2.5, dir: (3 * Math.PI) / 2 });

    expect(hit.terminal.cell).toBe(1);
    expect(hit.terminal.dist).toBeCloseTo(1.5, 5); // from y=2.5 to the y=1 wall face
    expect(hit.terminal.side).toBe(1);
    expect(hit.terminal.texX).toBeGreaterThanOrEqual(0);
    expect(hit.terminal.texX).toBeLessThanOrEqual(1);
    // The flat column now carries floor strips (the wall is too close — 1.5 cells — for the ceiling to
    // clear the screen top, so only floor shows); the terminal/dist/side above stay byte-identical.
    const floor = hit.spans.filter((s): s is FlatSpan => s.kind === 'floor');

    expect(floor.length).toBeGreaterThan(0);
    expect(floor[0].yBottom).toBeCloseTo(H, 5); // the nearest floor strip tiles to the bottom of the screen
  });
});

describe('castColumns — flat-sector spans', () => {
  // A roomy 10×10 box so the wall sits far enough (≈3.5 cells from the centre) for BOTH the floor and the
  // ceiling to clear the screen edges — a wall too close leaves the ceiling above the top of the screen.
  const openRoom = (width: number, height: number): number[] => {
    const cells: number[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        cells.push(x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 1 : 0);
      }
    }

    return cells;
  };

  const OPEN_ROOM: GameMap = { width: 10, height: 10, cells: openRoom(10, 10) };

  // The SAME geometry, sectorized to a single FLAT sector (floor flat 7, ceiling flat 3) — so the strips
  // carry the sector's materials at the base heights instead of the sector-less fallback (material 0).
  const flatFloors = new Array(100).fill(7);
  const flatCeils = new Array(100).fill(3);
  const { sectors, sectorId } = sectorize(flatFloors, flatCeils);
  const SECTORIZED_ROOM: GameMap = { ...OPEN_ROOM, sectors, sectorId };

  const SPAWN: Pose = { x: 5.5, y: 5.5, dir: 0 };
  const COLUMNS = 64;
  const CENTER = COLUMNS / 2; // cameraX === 0 → a pure +x ray with clean, axis-aligned segments

  const floorsOf = (col: ColumnProfile): FlatSpan[] =>
    col.spans.filter((s): s is FlatSpan => s.kind === 'floor');
  const ceilsOf = (col: ColumnProfile): FlatSpan[] =>
    col.spans.filter((s): s is FlatSpan => s.kind === 'ceil');

  // The shared projection (the core's own): floor sits at world height 0, ceiling at WALL_HEIGHT.
  const wallBottom = (dist: number, z = 0): number => surfaceScreenY(z + CAMERA_Z, dist, H);
  const wallTop = (dist: number, z = 0): number =>
    surfaceScreenY(z + CAMERA_Z - WALL_HEIGHT, dist, H);

  const cast = (map: GameMap, pose: Pose): ColumnProfile[] =>
    castColumns(pose, FOV, map, COLUMNS, H);

  it('every column carries at least one floor strip and one ceil strip', () => {
    const cols = cast(OPEN_ROOM, SPAWN);

    for (const col of cols) {
      expect(floorsOf(col).length).toBeGreaterThan(0);
      expect(ceilsOf(col).length).toBeGreaterThan(0);
    }
  });

  it('floor strips tile contiguously from the wall bottom down to the screen bottom', () => {
    const col = cast(OPEN_ROOM, SPAWN)[CENTER];
    const floors = floorsOf(col); // push order is near→far

    expect(floors[0].yBottom).toBeCloseTo(H, 5); // the nearest strip reaches the bottom of the screen
    expect(floors[floors.length - 1].yTop).toBeCloseTo(wallBottom(col.terminal.dist), 5);

    for (let i = 0; i + 1 < floors.length; i++) {
      expect(floors[i].yTop).toBeCloseTo(floors[i + 1].yBottom, 5); // touching → no gap, no overlap
    }
  });

  it('ceil strips tile contiguously from the screen top down to the wall top', () => {
    const col = cast(OPEN_ROOM, SPAWN)[CENTER];
    const ceils = ceilsOf(col);

    expect(ceils[0].yTop).toBeCloseTo(0, 5); // the nearest strip reaches the top of the screen
    expect(ceils[ceils.length - 1].yBottom).toBeCloseTo(wallTop(col.terminal.dist), 5);

    for (let i = 0; i + 1 < ceils.length; i++) {
      expect(ceils[i].yBottom).toBeCloseTo(ceils[i + 1].yTop, 5);
    }
  });

  it('the terminal wall window MEETS the floor + ceiling spans (the disappearing-floor fix)', () => {
    const col = cast(OPEN_ROOM, SPAWN)[CENTER];
    const floors = floorsOf(col);
    const ceils = ceilsOf(col);

    // The residual occlusion window the height-aware renderer draws the wall into = the wall slice on a flat
    // level (the floor at the wall = its bottom, the ceiling at the wall = its top)…
    expect(col.terminalBottom).toBeCloseTo(wallBottom(col.terminal.dist), 5);
    expect(col.terminalTop).toBeCloseTo(wallTop(col.terminal.dist), 5);
    // …and it is CONTIGUOUS with the spans: the farthest floor strip's top = the wall bottom, the farthest
    // ceiling strip's bottom = the wall top — so the wall meets the floor/ceiling with NO gap. Drawing the
    // wall with the legacy flat projection on a HEIGHT level would break this seam (the floor would vanish).
    expect(col.terminalBottom).toBeCloseTo(floors[floors.length - 1].yTop, 5);
    expect(col.terminalTop).toBeCloseTo(ceils[ceils.length - 1].yBottom, 5);
    // A fully-visible flat wall reveals its WHOLE texture (V 0 = ceiling … 1 = floor) — no stretch.
    expect(col.terminalVTop).toBeCloseTo(0, 5);
    expect(col.terminalVBottom).toBeCloseTo(1, 5);
  });

  it('no two strips of the same kind overlap in screen-Y', () => {
    const col = cast(OPEN_ROOM, SPAWN)[CENTER];

    for (const group of [floorsOf(col), ceilsOf(col)]) {
      const sorted = [...group].sort((a, b) => a.yTop - b.yTop);

      for (let i = 0; i + 1 < sorted.length; i++) {
        expect(sorted[i].yBottom).toBeLessThanOrEqual(sorted[i + 1].yTop + 1e-9);
      }
    }
  });

  it('a sector-less map reports the base heights (0 / WALL_HEIGHT) and material 0', () => {
    const col = cast(OPEN_ROOM, SPAWN)[CENTER];

    for (const f of floorsOf(col)) {
      expect(f.worldZ).toBe(0);
      expect(f.material).toBe(0);
    }

    for (const c of ceilsOf(col)) {
      expect(c.worldZ).toBe(WALL_HEIGHT);
      expect(c.material).toBe(0);
    }
  });

  it('a sectorized flat map reports the sector materials at the base heights', () => {
    const col = cast(SECTORIZED_ROOM, SPAWN)[CENTER];

    expect(floorsOf(col).length).toBeGreaterThan(0);
    expect(ceilsOf(col).length).toBeGreaterThan(0);

    for (const f of floorsOf(col)) {
      expect(f.worldZ).toBe(0);
      expect(f.material).toBe(7);
    }

    for (const c of ceilsOf(col)) {
      expect(c.worldZ).toBe(WALL_HEIGHT);
      expect(c.material).toBe(3);
    }
  });

  it('floor nearDepth is monotonically non-decreasing (near → far)', () => {
    const floors = floorsOf(cast(OPEN_ROOM, SPAWN)[CENTER]);

    expect(floors.length).toBeGreaterThan(1);

    for (let i = 0; i + 1 < floors.length; i++) {
      expect(floors[i + 1].nearDepth).toBeGreaterThanOrEqual(floors[i].nearDepth);
    }
  });

  it('a column through GLASS still emits floor + ceil strips (glass does not suppress them)', () => {
    // player(1) · GLASS(2) · open(3,4) · wall(5) — the wall sits 3.5 cells away so the ceiling clears.
    const glassRoom: GameMap = {
      width: 6,
      height: 3,
      // prettier-ignore
      cells: [
        1, 1, 1, 1, 1, 1,
        1, 0, GLASS_BASE, 0, 0, 1,
        1, 1, 1, 1, 1, 1,
      ],
    };
    const col = cast(glassRoom, { x: 1.5, y: 1.5, dir: 0 })[CENTER];

    expect(col.glass).toHaveLength(1); // the pane is still recorded
    expect(floorsOf(col).length).toBeGreaterThan(0);
    expect(ceilsOf(col).length).toBeGreaterThan(0);
  });

  it('raising pose.z lowers the wall bottom — more floor is visible', () => {
    const flat = cast(OPEN_ROOM, SPAWN)[CENTER];
    const raised = cast(OPEN_ROOM, { ...SPAWN, z: 0.5 })[CENTER];

    expect(raised.terminal.dist).toBeCloseTo(flat.terminal.dist, 5); // same wall, just a higher eye

    const flatSeam = floorsOf(flat).slice(-1)[0].yTop; // the floor/wall seam (the farthest floor strip's top)
    const raisedSeam = floorsOf(raised).slice(-1)[0].yTop;

    expect(raisedSeam).toBeGreaterThan(flatSeam); // the seam slides DOWN the screen → more floor below
    expect(raisedSeam).toBeCloseTo(wallBottom(raised.terminal.dist, 0.5), 5);
  });

  it('an eye ABOVE the ceiling seals the window with a full-screen ceiling strip (floor skipped)', () => {
    // camZ past WALL_HEIGHT: the floor far edge never rises above the window bottom (floorTop ≥ floorClip,
    // strip skipped), while the ceiling fills the whole column at the first boundary → ceilClip ≥ floorClip.
    const col = cast(OPEN_ROOM, { x: 5.5, y: 5.5, z: 5, dir: 0 })[CENTER];
    const ceils = ceilsOf(col);

    expect(floorsOf(col)).toHaveLength(0); // floorTop < floorClip is FALSE → no floor strip
    expect(ceils).toHaveLength(1); // sealed after the first boundary
    expect(ceils[0].yTop).toBeCloseTo(0, 5);
    expect(ceils[0].yBottom).toBeCloseTo(H, 5); // the ceiling covers the column → window closed
  });

  it('an eye BELOW the floor seals the window with a full-screen floor strip (ceil skipped)', () => {
    // camZ below 0: the floor fills the column at the first boundary (floorClip → 0), so the ceiling's
    // ceilBot ≤ ceilClip (strip skipped) and ceilClip ≥ floorClip closes the window.
    const col = cast(OPEN_ROOM, { x: 5.5, y: 5.5, z: -5, dir: 0 })[CENTER];
    const floors = floorsOf(col);

    expect(ceilsOf(col)).toHaveLength(0); // ceilBot > ceilClip is FALSE → no ceil strip
    expect(floors).toHaveLength(1);
    expect(floors[0].yTop).toBeCloseTo(0, 5);
    expect(floors[0].yBottom).toBeCloseTo(H, 5); // the floor covers the column → window closed
  });
});

describe('castColumns — height-sector risers', () => {
  // Hand-built HEIGHT maps (the sectors/sectorId carry VARYING floorZ/ceilZ — `sectorize` only makes flat
  // sectors, so the tables are authored by hand). A 1-tall open corridor along +x: row-1 cell `x = i + 1`
  // gets sector `i`, the end cap wall sits at `x = n + 1`, and the centre column (cameraX 0) casts a clean,
  // axis-aligned +x ray straight down it. So a height change at cell `x` shows up at perpendicular distance
  // `x − pose.x` with `side === 0`.
  const COLUMNS = 64;
  const CENTER = COLUMNS / 2;
  const camZ = CAMERA_Z;
  const WH = WALL_HEIGHT;

  interface CellHeights {
    floorZ: number;
    ceilZ: number;
  }
  const f = (floorZ: number): CellHeights => ({ floorZ, ceilZ: WH }); // vary the floor, flat ceiling
  const c = (ceilZ: number): CellHeights => ({ floorZ: 0, ceilZ }); // vary the ceiling, flat base floor

  // A horizontal (side-0) corridor; profiles drive row 1's per-cell sector heights.
  const corridor = (profiles: readonly CellHeights[]): GameMap => {
    const n = profiles.length;
    const width = n + 2;
    const sectors: Sector[] = profiles.map((p) => ({
      floorZ: p.floorZ,
      ceilZ: p.ceilZ,
      floorMat: 0,
      ceilMat: 0,
    }));
    const cells: number[] = [];
    const sectorId: number[] = [];

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < width; x++) {
        const border = y === 0 || y === 2 || x === 0 || x === width - 1;

        cells.push(border ? 1 : 0);
        sectorId.push(y === 1 && x >= 1 && x <= n ? x - 1 : 0); // interior open cell → its sector
      }
    }

    return { width, height: 3, cells, sectors, sectorId };
  };

  // The vertical (side-1) twin: a 1-wide open shaft along +y, column `y = i + 1` gets sector `i`.
  const shaft = (profiles: readonly CellHeights[]): GameMap => {
    const n = profiles.length;
    const height = n + 2;
    const sectors: Sector[] = profiles.map((p) => ({
      floorZ: p.floorZ,
      ceilZ: p.ceilZ,
      floorMat: 0,
      ceilMat: 0,
    }));
    const cells: number[] = [];
    const sectorId: number[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 3; x++) {
        const border = x === 0 || x === 2 || y === 0 || y === height - 1;

        cells.push(border ? 1 : 0);
        sectorId.push(x === 1 && y >= 1 && y <= n ? y - 1 : 0);
      }
    }

    return { width: 3, height, cells, sectors, sectorId };
  };

  const SPAWN: Pose = { x: 1.5, y: 1.5, dir: 0 };
  const center = (map: GameMap, pose: Pose = SPAWN): ColumnProfile =>
    castColumns(pose, FOV, map, COLUMNS, H)[CENTER];
  const floorsOf = (col: ColumnProfile): FlatSpan[] =>
    col.spans.filter((s): s is FlatSpan => s.kind === 'floor');
  const ceilsOf = (col: ColumnProfile): FlatSpan[] =>
    col.spans.filter((s): s is FlatSpan => s.kind === 'ceil');
  const stepFloorsOf = (col: ColumnProfile): StepSpan[] =>
    col.spans.filter((s): s is StepSpan => s.kind === 'stepFloor');
  const stepCeilsOf = (col: ColumnProfile): StepSpan[] =>
    col.spans.filter((s): s is StepSpan => s.kind === 'stepCeil');
  // The shared projection: a surface at world height `z` at perpendicular `d`, from eye altitude `camZ`.
  const yFloor = (z: number, d: number, eyeZ = camZ): number => surfaceScreenY(eyeZ - z, d, H);

  // 1 — STEP UP: floor 0 → 0.4 at the x=3 boundary (d = 1.5). A front riser appears; floorClip rises.
  it('emits a stepFloor riser at a floor step-up, then jumps the window up', () => {
    const map = corridor([f(0), f(0), f(0.4), f(0.4), f(0.4), f(0.4), f(0.4)]);
    const col = center(map);
    const steps = stepFloorsOf(col);

    expect(steps).toHaveLength(1);
    expect(steps[0].depth).toBeCloseTo(1.5, 5); // the x=3 boundary, 1.5 cells ahead
    expect(steps[0].side).toBe(0); // crossed on the x axis
    expect(steps[0].vBottom).toBeCloseTo(0, 5); // the lower (base) floor, as worldZ / WALL_HEIGHT
    expect(steps[0].vTop).toBeCloseTo(0.4 / WH, 5); // the raised floor
    expect(steps[0].cell).toBe(1); // RISER_CELL — the base wall material
    expect(steps[0].texX).toBeCloseTo(0.5, 5); // hit at world y = 1.5 → fraction 0.5
    expect(steps[0].wallU).toBeCloseTo(1.5, 5); // continuous tangential coordinate
    // The face runs from the raised-floor edge (top) down to the base-floor edge (bottom).
    expect(steps[0].yTop).toBeCloseTo(yFloor(0.4, 1.5), 5);
    expect(steps[0].yBottom).toBeCloseTo(yFloor(0, 1.5), 5);
    // floorClip ROSE: the raised sector's floor strip now starts higher on screen than the flat floor would.
    const raised = floorsOf(col).filter((s) => s.worldZ === 0.4);

    expect(raised.length).toBeGreaterThan(0);
    const seam = Math.max(...raised.map((s) => s.yBottom));

    expect(seam).toBeCloseTo(yFloor(0.4, 1.5), 5); // the strip meets the riser's TOP edge
    expect(seam).toBeLessThan(yFloor(0, 1.5)); // i.e. higher on screen than a flat floor at the same boundary
  });

  // 2 — PIT (step down): floor 0 → −0.4. NO near riser; the lower floor is auto-clamped (you see DOWN).
  it('emits NO stepFloor at a step-down, and the pit floor shows up clamped', () => {
    const map = corridor([f(0), f(0), f(-0.4), f(-0.4), f(-0.4), f(-0.4), f(-0.4), f(-0.4)]);
    const col = center(map);

    expect(stepFloorsOf(col)).toHaveLength(0); // nb.floorZ > cur.floorZ is FALSE → no near face

    const pit = floorsOf(col).filter((s) => s.worldZ === -0.4);

    expect(pit.length).toBeGreaterThan(0); // the pit floor IS visible (seeing down)
    // Its nearest visible edge is clamped to where the ledge's floor ended (the unchanged floorClip).
    expect(Math.max(...pit.map((s) => s.yBottom))).toBeCloseTo(yFloor(0, 1.5), 5);
    expect(Math.max(...pit.map((s) => s.yBottom))).toBeLessThan(H); // clamped — it does NOT tile to the bottom
    // The near ledge floor still tiles all the way down.
    const ledge = floorsOf(col).filter((s) => s.worldZ === 0);

    expect(Math.max(...ledge.map((s) => s.yBottom))).toBeCloseTo(H, 5);
  });

  // 3 — CEILING DROP (overhang): ceil 1.4 → 0.9. A face hangs down; ceilClip lowers.
  it('emits a stepCeil riser at a ceiling drop, then jumps the window down', () => {
    const map = corridor([c(WH), c(WH), c(0.9), c(0.9), c(0.9), c(0.9), c(0.9)]);
    const col = center(map);
    const steps = stepCeilsOf(col);

    expect(steps).toHaveLength(1);
    expect(steps[0].depth).toBeCloseTo(1.5, 5);
    expect(steps[0].side).toBe(0);
    expect(steps[0].vTop).toBeCloseTo(WH / WH, 5); // the higher (base) ceiling, == 1
    expect(steps[0].vBottom).toBeCloseTo(0.9 / WH, 5); // the dropped ceiling
    expect(steps[0].cell).toBe(1);
    expect(steps[0].yTop).toBeCloseTo(Math.max(yFloor(WH, 1.5), 0), 5); // clamped to the window top (0)
    expect(steps[0].yBottom).toBeCloseTo(yFloor(0.9, 1.5), 5); // down to the dropped-ceiling edge
    // ceilClip LOWERED: the dropped sector's ceiling strip now starts lower on screen than a flat ceiling.
    const dropped = ceilsOf(col).filter((s) => s.worldZ === 0.9);

    expect(dropped.length).toBeGreaterThan(0);
    const seam = Math.min(...dropped.map((s) => s.yTop));

    expect(seam).toBeCloseTo(yFloor(0.9, 1.5), 5);
    expect(seam).toBeGreaterThan(0); // pushed below the screen top → ceiling lowered
  });

  // 4 — CEILING RISE: ceil 0.9 → 1.4. No near face (symmetric to the pit).
  it('emits NO stepCeil at a ceiling rise', () => {
    const map = corridor([c(0.9), c(0.9), c(WH), c(WH), c(WH)]);
    const col = center(map);

    expect(stepCeilsOf(col)).toHaveLength(0); // nb.ceilZ < cur.ceilZ is FALSE → no near face
    expect(stepFloorsOf(col)).toHaveLength(0); // floors are flat
    const risen = ceilsOf(col).filter((s) => s.worldZ === WH);

    expect(risen.length).toBeGreaterThan(0); // the higher ceiling beyond IS reached (auto-clamped)
  });

  // 5 — WINDOW CLOSES: a far floor so high it meets the ceiling → ceilClip ≥ floorClip seals the column.
  it('seals the column when a high floor step closes the window', () => {
    const map = corridor([f(0), f(0), f(1.3), f(1.3), f(1.3)]); // 1.3 nearly meets the 1.4 ceiling
    const col = center(map);
    const steps = stepFloorsOf(col);

    expect(steps).toHaveLength(1); // the riser is emitted BEFORE the seal
    expect(steps[0].depth).toBeCloseTo(1.5, 5);
    // The column stops AT the closing boundary — terminal distance lands there (not at the far wall).
    expect(col.terminal.dist).toBeCloseTo(1.5, 5);
    // Nothing is emitted beyond the seal.
    for (const s of col.spans) {
      const depth = 'depth' in s ? s.depth : s.nearDepth;

      expect(depth).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });

  // 6 — RAISED pose.z threads camZ through both the strips and the riser screen-Y.
  it('a raised pose.z shifts the riser screen-Y (camZ threading)', () => {
    const map = corridor([f(0), f(0), f(0.4), f(0.4), f(0.4), f(0.4), f(0.4)]);
    const flat = stepFloorsOf(center(map))[0];
    const raised = stepFloorsOf(center(map, { ...SPAWN, z: 0.3 }))[0];

    expect(raised.depth).toBeCloseTo(flat.depth, 5); // same boundary, just a higher eye
    expect(raised.yTop).toBeGreaterThan(flat.yTop); // higher eye → the face shifts DOWN the screen
    expect(raised.yBottom).toBeGreaterThanOrEqual(flat.yBottom);
    expect(raised.yTop).toBeCloseTo(yFloor(0.4, 1.5, camZ + 0.3), 5); // exact camZ-threaded projection
  });

  // 7 — A step on the Y axis carries side 1 and a continuous, in-range tangential coordinate.
  it('a floor step-up crossed on the Y axis carries side 1 and a valid wallU/texX', () => {
    const map = shaft([f(0), f(0), f(0.4), f(0.4)]);
    const col = center(map, { x: 1.5, y: 1.5, dir: Math.PI / 2 }); // straight +y
    const steps = stepFloorsOf(col);

    expect(steps).toHaveLength(1);
    expect(steps[0].side).toBe(1); // crossed on the y axis
    expect(steps[0].depth).toBeCloseTo(1.5, 5);
    expect(steps[0].texX).toBeGreaterThanOrEqual(0);
    expect(steps[0].texX).toBeLessThan(1);
    expect(steps[0].wallU - Math.floor(steps[0].wallU)).toBeCloseTo(steps[0].texX, 5); // texX is wallU's fraction
  });

  // BRANCH: step-up whose face falls entirely BELOW the screen (a step too close/low) → the
  // `nb.floorZ > cur.floorZ` branch is TRUE but the inner `faceTop < faceBot` is FALSE → no span.
  it('a floor step-up whose face is off-screen emits no span (inner FALSE branch)', () => {
    const map = corridor([f(0), f(0), f(0.2), f(0.2), f(0.2)]);
    const col = center(map, { x: 2.7, y: 1.5, dir: 0 }); // boundary only 0.3 ahead → face below the screen

    expect(stepFloorsOf(col)).toHaveLength(0);
  });

  // BRANCH: ceiling drop whose face falls entirely ABOVE the screen → `nb.ceilZ < cur.ceilZ` TRUE,
  // inner `faceTop < faceBot` FALSE → no span.
  it('a ceiling drop whose face is off-screen emits no span (inner FALSE branch)', () => {
    const map = corridor([c(WH), c(WH), c(1.2), c(1.2), c(1.2)]);
    const col = center(map, { x: 2.7, y: 1.5, dir: 0 });

    expect(stepCeilsOf(col)).toHaveLength(0);
  });

  // GUARD: a flat sectorized corridor (no height change) emits NO risers — the legacy path is untouched.
  it('a flat height corridor emits no risers at all', () => {
    const map = corridor([f(0), f(0), f(0), f(0), f(0)]);
    const col = center(map);

    expect(stepFloorsOf(col)).toHaveLength(0);
    expect(stepCeilsOf(col)).toHaveLength(0);
    expect(floorsOf(col).length).toBeGreaterThan(0); // flat strips still tile the column
    expect(ceilsOf(col).length).toBeGreaterThan(0);
  });
});
