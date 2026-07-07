import { describe, expect, it } from 'vitest';

import { carveVoxelProp, VOXEL_GRID } from './voxel-carve';
import type { Texture } from './texture';

type Rgba = readonly [number, number, number, number];

const CLEAR: Rgba = [0, 0, 0, 0];
const BLUE: Rgba = [20, 20, 250, 255];
const RED: Rgba = [250, 20, 20, 255];
const GREEN: Rgba = [20, 250, 20, 255];
const YELLOW: Rgba = [250, 250, 20, 255];

/** Build a 1×N rotation sheet (N = the painter count) from one painter per view cell ((x, y) in
 *  CELL-local pixels). */
function makeSheet(
  cellWidth: number,
  height: number,
  cells: readonly ((x: number, y: number) => Rgba)[],
): Texture {
  const width = cells.length * cellWidth;
  const pixels = new Uint8ClampedArray(width * height * 4);

  cells.forEach((paint, cell) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const [r, g, b, a] = paint(x, y);
        const i = (y * width + cell * cellWidth + x) * 4;

        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = a;
      }
    }
  });

  return { width, height, pixels };
}

/** A painter filling one axis-aligned box of the cell with `color`, clear elsewhere. */
function box(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  color: Rgba = BLUE,
): (x: number, y: number) => Rgba {
  return (x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? color : CLEAR);
}

/** Decode voxel (x, y, z) of a carved grid (z bottom-up — the encoding contract under test). */
function voxelAt(grid: Texture, x: number, y: number, z: number): Rgba {
  const ny = grid.voxelDepth ?? 0;
  const i = ((z * ny + y) * grid.width + x) * 4; // slice z (from the bottom), depth row y, lateral x

  return [grid.pixels[i], grid.pixels[i + 1], grid.pixels[i + 2], grid.pixels[i + 3]];
}

/** Count the solid voxels of a carved grid. */
function solidCount(grid: Texture): number {
  let total = 0;

  for (let i = 3; i < grid.pixels.length; i += 4) {
    if (grid.pixels[i] !== 0) {
      total++;
    }
  }

  return total;
}

describe('carveVoxelProp', () => {
  it('carves a full box: n×ny×nz all solid, encoded as an n × (ny·nz) texture with voxelDepth', () => {
    // Every view a full 16×16 silhouette → the hull is the whole grid; side span = front span → ny = n.
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid).not.toBeNull();
    expect(grid).toMatchObject({ width: 8, height: 8 * 8, voxelDepth: 8 });
    expect(solidCount(grid as Texture)).toBe(8 * 8 * 8);
  });

  it('defaults the lateral resolution to VOXEL_GRID', () => {
    const sheet = makeSheet(128, 128, [box(0, 128, 0, 128), box(0, 128, 0, 128), box(0, 128, 0, 128), box(0, 128, 0, 128)]); // prettier-ignore
    const grid = carveVoxelProp(sheet);

    expect(grid?.width).toBe(VOXEL_GRID);
  });

  it('recenters each view over ITS OWN alpha bbox (off-centre frames still carve the full hull)', () => {
    // The front silhouette hugs the cell's LEFT edge, the sides its RIGHT edge, the back its centre —
    // without per-view recentring their raw-cell intersections would miss each other almost entirely.
    const sheet = makeSheet(16, 16, [box(0, 8, 0, 16), box(8, 16, 0, 16), box(4, 12, 0, 16), box(8, 16, 0, 16)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid).not.toBeNull();
    expect(solidCount(grid as Texture)).toBe(8 * 8 * 8); // every bbox maps to the FULL grid axis
  });

  it('derives the grid DEPTH from the side/front bbox ratio and the height from the cell aspect', () => {
    // Front 16 px wide, side 8 px wide → depthRatio 7/15 ≈ 0.47 → ny = round(8 × 7/15) = 4; the sheet is
    // twice as tall as one cell → nz = 16.
    const sheet = makeSheet(16, 32, [box(0, 16, 0, 32), box(0, 8, 0, 32), box(0, 16, 0, 32), box(0, 8, 0, 32)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid?.voxelDepth).toBe(4);
    expect((grid as Texture).height).toBe(4 * 16);
  });

  it('clamps the depth to the lateral resolution and the height to a minimum of 2 slices', () => {
    // Side bbox WIDER than the front's (ratio > 1) → ny caps at n; a 2-px-tall sheet → nz floors at 2.
    const sheet = makeSheet(16, 2, [box(4, 12, 0, 2), box(0, 16, 0, 2), box(4, 12, 0, 2), box(0, 16, 0, 2)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid?.voxelDepth).toBe(8);
    expect((grid as Texture).height).toBe(8 * 2);
  });

  it('guards a degenerate 1-px front span (depth ratio over a zero-width bbox)', () => {
    const sheet = makeSheet(16, 16, [box(7, 8, 0, 16), box(0, 4, 0, 16), box(7, 8, 0, 16), box(0, 4, 0, 16)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid).not.toBeNull(); // a 1-px-wide silhouette still carves (t maps over a single column)
    expect(solidCount(grid as Texture)).toBeGreaterThan(0);
  });

  it('auto-calibrates the mirror convention: a flip combo that holes a slice is rejected', () => {
    // Right and left views disagree (top-vs-bottom halves on opposite sides): unflipped, their depth
    // ranges are DISJOINT in every slice — carving would empty slices the front fills. Flipping one
    // side view aligns them; the calibration must find that combo (fail-without: the unflipped
    // fallback carve leaves the top half of the grid empty).
    const halfTop = (x: number, y: number): Rgba => (y < 8 ? box(0, 8, 0, 16)(x, y) : box(8, 16, 0, 16)(x, y)); // prettier-ignore
    const halfBottom = (x: number, y: number): Rgba => (y < 8 ? box(8, 16, 0, 16)(x, y) : box(0, 8, 0, 16)(x, y)); // prettier-ignore
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16), halfTop, box(0, 16, 0, 16), halfBottom]);
    const grid = carveVoxelProp(sheet, 8) as Texture;

    expect(grid).not.toBeNull();
    const ny = grid.voxelDepth as number;
    const nz = grid.height / ny;

    for (let z = 0; z < nz; z++) {
      let slice = 0;

      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < grid.width; x++) {
          slice += voxelAt(grid, x, y, z)[3] === 0 ? 0 : 1;
        }
      }
      expect(slice).toBeGreaterThan(0); // no slice may go empty where the front silhouette has matter
    }
  });

  it('returns null when every flip combo holes the hull and the fallback carves to nothing', () => {
    // The side views split along Z (top half vs bottom half) — flips only mirror the horizontal axis,
    // so EVERY combo leaves half the slices empty; the unflipped fallback intersects to zero voxels.
    const topOnly = (x: number, y: number): Rgba => (y < 8 ? BLUE : CLEAR);
    const bottomOnly = (x: number, y: number): Rgba => (y >= 8 ? BLUE : CLEAR);
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16), topOnly, box(0, 16, 0, 16), bottomOnly]);

    expect(carveVoxelProp(sheet, 8)).toBeNull();
  });

  it('projects colours by SURFACE NORMAL among the views that see the voxel (sides beat front on edges)', () => {
    // A full box with one colour per view: blue front · red right · green left · yellow back.
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16, BLUE), box(0, 16, 0, 16, RED), box(0, 16, 0, 16, YELLOW), box(0, 16, 0, 16, GREEN)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8) as Texture;
    const last = 7;

    // Face interiors: the only view whose axis ray hits them first → their own view's colour.
    expect(voxelAt(grid, 3, 0, 3)).toEqual(BLUE); // front face (y = 0), interior x
    expect(voxelAt(grid, last, 3, 3)).toEqual(RED); // right flank (x = last), interior y
    expect(voxelAt(grid, 0, 3, 3)).toEqual(GREEN); // left flank (x = 0)
    expect(voxelAt(grid, 3, last, 3)).toEqual(YELLOW); // back face (y = last)
    // Corner columns: seen by front AND a side, the normal dots equally into both — the side must win
    // (fail-without: the prototype's front-first pick stripes blue down the flank edges).
    expect(voxelAt(grid, last, 0, 3)).toEqual(RED); // front-right corner → the flank's colour
    expect(voxelAt(grid, 0, 0, 3)).toEqual(GREEN); // front-left corner
  });

  it('projects THROUGH for voxels no view sees (no grey interiors on exposed faces)', () => {
    // The distinct-colour box again: its dead-centre voxel is enclosed on all four axis rays. The
    // prototype painted it flat grey — which the in-game DDA then showed on seat tops/undersides as
    // grey blobs. Now it takes the best-aligned view's colour (a flat normal → the side-first
    // tie-break → the right view).
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16, BLUE), box(0, 16, 0, 16, RED), box(0, 16, 0, 16, YELLOW), box(0, 16, 0, 16, GREEN)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8) as Texture;

    expect(voxelAt(grid, 3, 3, 3)).toEqual(RED);
  });

  it('encodes slices BOTTOM-up: the sheet TOP row lands in the grid top slice', () => {
    // Front view: red on the image's top half, blue below (all views share the silhouette).
    const bicolor = (x: number, y: number): Rgba => (y < 8 ? RED : BLUE);
    const sheet = makeSheet(16, 16, [bicolor, box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8) as Texture;
    const nz = grid.height / (grid.voxelDepth as number);

    expect(voxelAt(grid, 3, 0, nz - 1)).toEqual(RED); // image top → HIGH z (the grid's top)
    expect(voxelAt(grid, 3, 0, 0)).toEqual(BLUE); // image bottom → z = 0 (the grid's floor)
  });

  it('applies the calibrated flip to the colour projection, not just the hull', () => {
    // The right view carves aligned only when FLIPPED (same construction as the calibration test),
    // with a colour split along its horizontal axis: the flip must mirror the sampling too, so the
    // half that fronts each depth row keeps its own colour.
    const halfTop = (x: number, y: number): Rgba => (y < 8 ? box(0, 8, 0, 16, RED)(x, y) : box(8, 16, 0, 16, YELLOW)(x, y)); // prettier-ignore
    const halfBottom = (x: number, y: number): Rgba => (y < 8 ? box(8, 16, 0, 16)(x, y) : box(0, 8, 0, 16)(x, y)); // prettier-ignore
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16), halfTop, box(0, 16, 0, 16), halfBottom]);
    const grid = carveVoxelProp(sheet, 8) as Texture;
    const ny = grid.voxelDepth as number;
    const nz = grid.height / ny;
    // Find a right-flank voxel in a TOP slice (image top half = RED there) — flank = max solid x.
    const topZ = nz - 1;
    let flankColor: Rgba | null = null;

    for (let x = grid.width - 1; x >= 0 && flankColor === null; x--) {
      for (let y = 0; y < ny; y++) {
        const c = voxelAt(grid, x, y, topZ);

        if (c[3] !== 0) {
          flankColor = c;
          break;
        }
      }
    }
    expect(flankColor).toEqual(RED); // sampled from the right view's own (possibly mirrored) half
  });

  it('returns null on malformed input: a non-1×4 sheet width, a sub-2 grid, an empty view', () => {
    const good = makeSheet(16, 16, [box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore

    expect(carveVoxelProp({ ...good, width: 30 }, 8)).toBeNull(); // width not divisible by 4
    expect(carveVoxelProp(good, 1)).toBeNull(); // grid too small to carve
    const noBack = makeSheet(16, 16, [box(0, 16, 0, 16), box(0, 16, 0, 16), () => CLEAR, box(0, 16, 0, 16)]); // prettier-ignore

    expect(carveVoxelProp(noBack, 8)).toBeNull(); // an empty view silhouette carves nothing
  });

  it('is deterministic: the same sheet carves to the same bytes', () => {
    const sheet = makeSheet(16, 16, [box(2, 14, 1, 15), box(4, 10, 0, 16), box(2, 14, 2, 16), box(4, 10, 1, 14)]); // prettier-ignore
    const a = carveVoxelProp(sheet, 8) as Texture;
    const b = carveVoxelProp(sheet, 8) as Texture;

    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });

  it('rejects a malformed cell count: not a multiple of 4, zero, or one the width cannot split', () => {
    const good = makeSheet(16, 16, [box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore

    expect(carveVoxelProp(good, 8, { cells: 6 })).toBeNull(); // 6 % 4 ≠ 0
    expect(carveVoxelProp(good, 8, { cells: 0 })).toBeNull(); // degenerate
    expect(carveVoxelProp({ ...good, width: 36 }, 8, { cells: 8 })).toBeNull(); // 36 % 8 ≠ 0
  });

  it('picks each cell’s CENTRED column-run over neighbour-cell bleed (the whiteboard lesson)', () => {
    // The flank cell holds bleed strips at BOTH edges around its real profile (centred, spanning the
    // cell middle). The raw bbox [1, 30] would claim a full-depth ratio; the centred run [11, 21]
    // must displace the left bleed AND hold off the right one → ny = round(8 · 10/23) = 3
    // (fail-without: 8).
    const card = box(4, 28, 0, 32);
    const flank = (x: number, y: number): Rgba =>
      box(1, 6, 0, 8)(x, y)[3] !== 0 || box(26, 31, 0, 8)(x, y)[3] !== 0
        ? BLUE
        : box(11, 22, 0, 32)(x, y);
    const sheet = makeSheet(32, 32, [card, flank, card, card]);

    expect(carveVoxelProp(sheet, 8)?.voxelDepth).toBe(3);
  });

  it('falls back to the most MASSIVE run when no run spans the cell centre', () => {
    // Two detached runs, neither crossing the centre: a short-height near strip [2, 10) and a
    // full-height far one [20, 31) — the mass pick takes the far run → ny = round(8 · 10/23) = 3
    // (fail-without: the first run gives 2, the raw bbox caps at 8).
    const card = box(4, 28, 0, 32);
    const flank = (x: number, y: number): Rgba =>
      box(2, 10, 0, 8)(x, y)[3] !== 0 ? BLUE : box(20, 31, 0, 32)(x, y);
    const sheet = makeSheet(32, 32, [card, flank, card, card]);

    expect(carveVoxelProp(sheet, 8)?.voxelDepth).toBe(3);
  });

  it('calibrates the BACK view’s mirror: an L-front only carves against the flipped back', () => {
    // The front is an L (upper half only left), the back cell holds the MIRRORED L (a rear camera
    // sees the same shape flipped): unflipped they intersect to nothing on the upper slices (holed),
    // so the calibration must pick the back flip — and the colour projection must sample the back
    // cell through that same mirror (fail-without: the back face reads a transparent region).
    const frontL = (x: number, y: number): Rgba => (y < 8 ? (x < 8 ? BLUE : CLEAR) : BLUE);
    const backL = (x: number, y: number): Rgba => (y < 8 ? (x >= 8 ? YELLOW : CLEAR) : YELLOW);
    const side = box(0, 16, 0, 16, RED);
    const sheet = makeSheet(16, 16, [frontL, side, backL, side]);
    const grid = carveVoxelProp(sheet, 8) as Texture;

    expect(grid).not.toBeNull();
    expect(solidCount(grid)).toBe(4 * 4 * 8 + 4 * 8 * 8); // upper half x ≤ 3, lower half full
    expect(voxelAt(grid, 2, 3, 7)[3]).toBe(255); // the L's upper arm stands…
    expect(voxelAt(grid, 5, 3, 7)[3]).toBe(0); // …its notch is carved away
    expect(voxelAt(grid, 2, 7, 7)).toEqual(YELLOW); // back face sampled through the calibrated flip
  });

  it('SUPERSAMPLES colours: a face voxel averages the art pixels its footprint covers', () => {
    // The front face is striped BLUE/RED in 1 px columns; at n = 8 a voxel's footprint spans ≈ 2 px,
    // so its colour must be a BLEND of both stripes — a point sample would return one pure stripe.
    const stripes = (x: number): Rgba => (x % 2 === 0 ? BLUE : RED);
    const sheet = makeSheet(16, 16, [stripes, box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8) as Texture;
    const [r, g, b] = voxelAt(grid, 3, 0, 3);

    expect(r).toBeGreaterThan(60);
    expect(r).toBeLessThan(200);
    expect(b).toBeGreaterThan(60);
    expect(b).toBeLessThan(200);
    expect(g).toBeLessThan(60);
  });

  it('falls back to the nearest pixel when the footprint is SUB-pixel (grid finer than the art)', () => {
    // A 16-cell grid over 8 px cells: the footprint is 7/15 px wide, often straddling no whole pixel —
    // the nearest-pixel fallback must still land the art colour, never a zeroed sample.
    const sheet = makeSheet(8, 8, [box(0, 8, 0, 8, RED), box(0, 8, 0, 8, RED), box(0, 8, 0, 8, RED), box(0, 8, 0, 8, RED)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 16) as Texture;

    expect(grid).not.toBeNull();
    expect(voxelAt(grid, 7, 0, 7)).toEqual(RED);
  });
});

describe('carveVoxelProp — 8-view sheets (diagonal silhouettes)', () => {
  /** A cardinal-only 1×8 sheet: cardinals on the wheel cells {0, 2, 4, 6}, diagonals empty. */
  const empty = (): Rgba => CLEAR;

  it('reads the cardinals off the rotation wheel: front 0 · +x flank 2 · back 4 · −x flank 6', () => {
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16, BLUE), empty, box(0, 8, 0, 16, RED), empty, box(0, 16, 0, 16, YELLOW), empty, box(0, 8, 0, 16, GREEN), empty]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull(); // fail-without: a 0/1/2/3 read hits the EMPTY cell 1 and carves null
    expect(grid.voxelDepth).toBe(4); // depth from the +x flank's OWN span (8 px vs the front's 16)
    expect(voxelAt(grid, 3, 0, 3)).toEqual(BLUE); // front face → cell 0
    expect(voxelAt(grid, 7, 2, 3)).toEqual(RED); // +x flank → cell 2 (the wheel's 90° view)
    expect(voxelAt(grid, 0, 2, 3)).toEqual(GREEN); // −x flank → cell 6
    expect(voxelAt(grid, 3, 3, 3)).toEqual(YELLOW); // back face → cell 4
  });

  it('chamfers the plan corners a 4-view hull leaves square (the octagon carve)', () => {
    const card = box(8, 24, 0, 32);
    const sheet = makeSheet(32, 32, [card, card, card, card, card, card, card, card]);
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull();
    const nz = grid.height / (grid.voxelDepth as number);

    for (let z = 0; z < nz; z++) {
      expect(voxelAt(grid, 0, 0, z)[3]).toBe(0); // all four corners cut at every height…
      expect(voxelAt(grid, 7, 0, z)[3]).toBe(0);
      expect(voxelAt(grid, 0, 7, z)[3]).toBe(0);
      expect(voxelAt(grid, 7, 7, z)[3]).toBe(0);
      expect(voxelAt(grid, 3, 0, z)[3]).toBe(255); // …while the face middles and centre survive
      expect(voxelAt(grid, 0, 3, z)[3]).toBe(255);
      expect(voxelAt(grid, 3, 3, z)[3]).toBe(255);
    }
    expect(solidCount(grid)).toBeLessThan(8 * 8 * 8);
  });

  it('registers a MIRRORED diagonal cell (the anchor × flip search must pick the flip)', () => {
    // The hull is an L-prism (the front view loses its top-right quadrant). The 45° cell holds the
    // true silhouette MIRRORED: registered as-is it would cut the top-left corner the hull owns;
    // flipped it matches exactly and cuts nothing (fail-without: the corner column empties).
    const front = (x: number, y: number): Rgba => (y < 16 ? box(8, 16, 0, 32)(x, y) : box(8, 24, 0, 32)(x, y)); // prettier-ignore
    const card = box(8, 24, 0, 32);
    const mirrored = (x: number, y: number): Rgba => (y < 16 ? box(11, 27, 0, 32)(x, y) : box(5, 27, 0, 32)(x, y)); // prettier-ignore
    const sheet = makeSheet(32, 32, [front, mirrored, card, empty, card, empty, card, empty]);
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull();
    expect(solidCount(grid)).toBe(4 * 4 * 8 + 4 * 64); // the L-prism, untouched by the aligned view
    expect(voxelAt(grid, 0, 0, 7)[3]).toBe(255); // the top-left corner the unflipped trim would cut
  });

  it('skips a diagonal whose best registration stays under the IoU floor (junk art)', () => {
    // A 2 px sliver can never explain a full box hull: the view must be ignored — its trim would
    // otherwise carve the box down to a thin diagonal wafer without ever emptying a slice.
    const card = box(8, 24, 0, 32);
    const sliver = box(15, 17, 0, 32);
    const sheet = makeSheet(32, 32, [card, sliver, card, empty, card, empty, card, empty]);
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(solidCount(grid)).toBe(8 * 8 * 8);
  });

  it('skips a diagonal whose trim would EMPTY an occupied z-slice (a holed band)', () => {
    // The 45° cell matches the box well (IoU passes) but is transparent across one z-band: applying
    // it would wipe that slice — the hole guard must reject the view, keeping the full box.
    const card = box(8, 24, 0, 32);
    const banded = (x: number, y: number): Rgba => (y >= 12 && y < 16 ? CLEAR : box(8, 24, 0, 32)(x, y)); // prettier-ignore
    const sheet = makeSheet(32, 32, [card, banded, card, empty, card, empty, card, empty]);
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(solidCount(grid)).toBe(8 * 8 * 8);
  });

  it('chamfers with SUB-pixel footprints when the grid outresolves the art', () => {
    const card = box(4, 12, 0, 16);
    const sheet = makeSheet(16, 16, [card, card, card, card, card, card, card, card]);
    const grid = carveVoxelProp(sheet, 16, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull();
    expect(voxelAt(grid, 0, 0, 8)[3]).toBe(0); // corners still cut…
    expect(voxelAt(grid, 15, 15, 8)[3]).toBe(0);
    expect(voxelAt(grid, 7, 7, 8)[3]).toBe(255); // …the body survives
  });

  it('gives a voxel projecting OUTSIDE the cell the benefit of the doubt (clipped art)', () => {
    // The hull's 45° projection (≈ 18 px) overflows the 16 px cell, and the diagonal art is CLIPPED
    // at the left cell edge: the corner projecting past that edge must be KEPT (the art says nothing
    // about it) while the opposite corner lands in-cell on transparency and is cut — the octagon
    // goes lopsided on purpose.
    const card = box(1, 15, 0, 16);
    const diag = box(0, 13, 0, 16);
    const sheet = makeSheet(16, 16, [card, diag, card, empty, card, empty, card, empty]);
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull();
    expect(voxelAt(grid, 0, 0, 3)[3]).toBe(255); // projects past the clipped edge → kept
    expect(voxelAt(grid, 7, 7, 3)[3]).toBe(0); // projects in-cell onto transparency → cut
  });

  it('colours 45° edges from the diagonal view that sees them (no cardinal bleed)', () => {
    // Octagon carve with a MAGENTA 45° cell between the front and the +x flank: the chamfer voxel
    // (whose normal dots equally into front and flank) must sample the diagonal art, not stripe a
    // cardinal face around the corner.
    const MAGENTA: Rgba = [250, 20, 250, 255];
    const diag = box(8, 24, 0, 32, MAGENTA);
    const sheet = makeSheet(32, 32, [box(8, 24, 0, 32, BLUE), diag, box(8, 24, 0, 32, RED), diag, box(8, 24, 0, 32, YELLOW), diag, box(8, 24, 0, 32, GREEN), diag]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull();
    // (5, 0) survives the chamfer with a (+x, −y) normal → the front/+x diagonal (cell 1) colours it.
    expect(voxelAt(grid, 5, 0, 3)[3]).toBe(255);
    expect(voxelAt(grid, 5, 0, 3)).toEqual(MAGENTA);
    // Face interiors keep their cardinal colours.
    expect(voxelAt(grid, 3, 0, 3)).toEqual(BLUE);
    expect(voxelAt(grid, 7, 3, 3)).toEqual(RED);
  });
});

describe('carveVoxelProp — top view (plan footprint + upward faces)', () => {
  /** A single-image top view from a painter ((x, y) in image pixels). */
  function makeTop(w: number, h: number, paint: (x: number, y: number) => Rgba): Texture {
    const pixels = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = paint(x, y);
        const i = (y * w + x) * 4;

        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = a;
      }
    }

    return { width: w, height: h, pixels };
  }

  const fullBox = makeSheet(16, 16, [box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore

  it('stamps the plan footprint: a PLUS top separates what the four profiles fuse into a box', () => {
    // Every profile of a plus-shaped plan is the same full box — cardinal carving keeps all 64
    // columns. The top view alone cuts the four corner quadrants (the chair-star-base case).
    const plus = makeTop(16, 16, (x, y) =>
      Math.abs(x - 7.5) < 2 || Math.abs(y - 7.5) < 2 ? BLUE : CLEAR,
    );
    const grid = carveVoxelProp(fullBox, 8, { top: plus }) as Texture;

    expect(grid).not.toBeNull();
    expect(solidCount(grid)).toBe(28 * 8); // 2·8 + 2·8 − 4 arm columns, full height
    expect(voxelAt(grid, 0, 0, 3)[3]).toBe(0); // corner quadrants gone…
    expect(voxelAt(grid, 1, 1, 3)[3]).toBe(0);
    expect(voxelAt(grid, 3, 0, 3)[3]).toBe(255); // …the arms and centre stand
    expect(voxelAt(grid, 0, 3, 3)[3]).toBe(255);
    expect(voxelAt(grid, 4, 4, 3)[3]).toBe(255);
  });

  it('maps the delivered convention: image BOTTOM = object FRONT, image x = grid +x', () => {
    // A square footprint missing its image bottom-left quadrant: the notch must land at the object's
    // front-left (x low, y low) — a v-flip would put it at the back, a u-flip at the right. All four
    // mirrors tie on IoU here, so this also pins "the base convention wins ties".
    const notched = makeTop(16, 16, (x, y) => (x < 8 && y >= 8 ? CLEAR : BLUE));
    const grid = carveVoxelProp(fullBox, 8, { top: notched }) as Texture;

    expect(grid).not.toBeNull();
    expect(solidCount(grid)).toBe(48 * 8);
    expect(voxelAt(grid, 0, 0, 3)[3]).toBe(0); // the front-left quadrant is the notch
    expect(voxelAt(grid, 7, 0, 3)[3]).toBe(255); // front-right stands
    expect(voxelAt(grid, 0, 7, 3)[3]).toBe(255); // back-left stands
  });

  it('auto-calibrates the mirrors: an inverted-convention top is rescued by the hole guard', () => {
    // The hull is a wedding cake (full plan below, front slab y ≤ 2 on top, from staircase flanks).
    // The top art paints the band at the image TOP (the inverted convention) plus an alpha-bbox pin
    // no grid column samples: read as delivered it keeps only the BACK columns and EMPTIES the top
    // slices → holed → the v-flip candidate must win instead (fail-without: the front slab dies).
    const staircase = (x: number, y: number): Rgba => (y < 8 ? box(0, 6, 0, 16)(x, y) : box(0, 12, 0, 16)(x, y)); // prettier-ignore
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16), staircase, box(0, 16, 0, 16), staircase]);
    const banded = makeTop(16, 16, (x, y) => (y <= 6 || (x === 8 && y === 15) ? BLUE : CLEAR));
    const grid = carveVoxelProp(sheet, 8, { top: banded }) as Texture;

    expect(grid).not.toBeNull();
    expect(grid.voxelDepth).toBe(6);
    expect(solidCount(grid)).toBe(8 * 3 * 8); // y ∈ {0, 1, 2} kept at every slice
    expect(voxelAt(grid, 3, 1, 0)[3]).toBe(255); // the front survives…
    expect(voxelAt(grid, 3, 4, 0)[3]).toBe(0); // …the back band is the trim
  });

  it('ignores a top whose footprint cannot explain the hull (the IoU floor)', () => {
    // A single-column sliver (with a bbox pin no grid column samples) explains an 8×8 plan at
    // IoU 0.125 — junk. The top is dropped and the box carves untouched.
    const sliver = makeTop(16, 16, (x, y) => (x <= 1 || (x === 15 && y === 8) ? BLUE : CLEAR));
    const grid = carveVoxelProp(fullBox, 8, { top: sliver }) as Texture;

    expect(solidCount(grid)).toBe(8 * 8 * 8);
  });

  it('colours upward faces from the top view (and only those)', () => {
    const ORANGE: Rgba = [250, 150, 20, 255];
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16, BLUE), box(0, 16, 0, 16, RED), box(0, 16, 0, 16, YELLOW), box(0, 16, 0, 16, GREEN)]); // prettier-ignore
    const orange = makeTop(16, 16, () => ORANGE);
    const grid = carveVoxelProp(sheet, 8, { top: orange }) as Texture;

    expect(voxelAt(grid, 3, 3, 7)).toEqual(ORANGE); // top-face interior → the top art
    expect(voxelAt(grid, 3, 3, 0)).toEqual(RED); // the underside projects THROUGH a flank as before
    expect(voxelAt(grid, 7, 3, 3)).toEqual(RED); // flank faces keep the wheel art
    expect(voxelAt(grid, 3, 0, 7)).toEqual(BLUE); // a top-front rim edge keeps the wheel art (tie)
  });

  it('tolerates hulls with EMPTY slices and plan columns no view fills (gappy art)', () => {
    // Front/back are two towers joined only by a 1 px bridge row the nz sampling never reads: the
    // hull ends up with EMPTY z-slices (the transparent mid band) and plan columns solid at NO
    // height (the tower gap). A matching two-bar top must still calibrate and apply cleanly — its
    // guards skip the empty slices, and the dead columns sit outside both mask and footprint.
    const towers = (x: number, y: number): Rgba =>
      ((x < 6 || x >= 10) && (y < 6 || y >= 10)) || y === 7 ? BLUE : CLEAR;
    const side = box(0, 16, 0, 16);
    const sheet = makeSheet(16, 16, [towers, side, towers, side]);
    const bars = makeTop(16, 16, (x) => (x < 6 || x >= 10 ? BLUE : CLEAR));
    const grid = carveVoxelProp(sheet, 8, { top: bars }) as Texture;

    expect(grid).not.toBeNull();
    expect(solidCount(grid)).toBe(6 * 6 * 8); // 6 tower slices × 6 tower columns × full depth
    expect(voxelAt(grid, 3, 3, 0)[3]).toBe(0); // the gap column stays empty…
    expect(voxelAt(grid, 0, 3, 0)[3]).toBe(255); // …the towers stand
  });

  it('carries on without a top that is empty or degenerate', () => {
    const clear = makeTop(16, 16, () => CLEAR);
    const line = makeTop(16, 16, (x) => (x === 5 ? BLUE : CLEAR));

    expect(solidCount(carveVoxelProp(fullBox, 8, { top: clear }) as Texture)).toBe(512);
    expect(solidCount(carveVoxelProp(fullBox, 8, { top: line }) as Texture)).toBe(512);
  });
});
