import { describe, expect, it } from 'vitest';

import { carveVoxelProp, VOXEL_GRID } from './voxel-carve';
import type { Texture } from './texture';

type Rgba = readonly [number, number, number, number];

const CLEAR: Rgba = [0, 0, 0, 0];
const BLUE: Rgba = [20, 20, 250, 255];
const RED: Rgba = [250, 20, 20, 255];
const GREEN: Rgba = [20, 250, 20, 255];
const YELLOW: Rgba = [250, 250, 20, 255];

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

function box(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  color: Rgba = BLUE,
): (x: number, y: number) => Rgba {
  return (x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? color : CLEAR);
}

function voxelAt(grid: Texture, x: number, y: number, z: number): Rgba {
  const ny = grid.voxelDepth ?? 0;
  const i = ((z * ny + y) * grid.width + x) * 4;

  return [grid.pixels[i], grid.pixels[i + 1], grid.pixels[i + 2], grid.pixels[i + 3]];
}

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
    const sheet = makeSheet(16, 16, [box(0, 8, 0, 16), box(8, 16, 0, 16), box(4, 12, 0, 16), box(8, 16, 0, 16)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid).not.toBeNull();
    expect(solidCount(grid as Texture)).toBe(8 * 8 * 8);
  });

  it('derives the grid DEPTH from the side/front bbox ratio and the height from the cell aspect', () => {
    const sheet = makeSheet(16, 32, [box(0, 16, 0, 32), box(0, 8, 0, 32), box(0, 16, 0, 32), box(0, 8, 0, 32)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid?.voxelDepth).toBe(4);
    expect((grid as Texture).height).toBe(4 * 16);
  });

  it('clamps the depth to the lateral resolution and the height to a minimum of 2 slices', () => {
    const sheet = makeSheet(16, 2, [box(4, 12, 0, 2), box(0, 16, 0, 2), box(4, 12, 0, 2), box(0, 16, 0, 2)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid?.voxelDepth).toBe(8);
    expect((grid as Texture).height).toBe(8 * 2);
  });

  it('guards a degenerate 1-px front span (depth ratio over a zero-width bbox)', () => {
    const sheet = makeSheet(16, 16, [box(7, 8, 0, 16), box(0, 4, 0, 16), box(7, 8, 0, 16), box(0, 4, 0, 16)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8);

    expect(grid).not.toBeNull();
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
      expect(slice).toBeGreaterThan(0);
    }
  });

  it('returns null when every flip combo holes the hull and the fallback carves to nothing', () => {
    const topOnly = (x: number, y: number): Rgba => (y < 8 ? BLUE : CLEAR);
    const bottomOnly = (x: number, y: number): Rgba => (y >= 8 ? BLUE : CLEAR);
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16), topOnly, box(0, 16, 0, 16), bottomOnly]);

    expect(carveVoxelProp(sheet, 8)).toBeNull();
  });

  it('projects colours by SURFACE NORMAL among the views that see the voxel (sides beat front on edges)', () => {
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16, BLUE), box(0, 16, 0, 16, RED), box(0, 16, 0, 16, YELLOW), box(0, 16, 0, 16, GREEN)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8) as Texture;
    const last = 7;

    expect(voxelAt(grid, 3, 0, 3)).toEqual(BLUE);
    expect(voxelAt(grid, last, 3, 3)).toEqual(RED);
    expect(voxelAt(grid, 0, 3, 3)).toEqual(GREEN);
    expect(voxelAt(grid, 3, last, 3)).toEqual(YELLOW);
    // Corner columns: seen by front AND a side, the normal dots equally into both — the side must win
    // (fail-without: the prototype's front-first pick stripes blue down the flank edges).
    expect(voxelAt(grid, last, 0, 3)).toEqual(RED);
    expect(voxelAt(grid, 0, 0, 3)).toEqual(GREEN);
  });

  it('projects THROUGH for voxels no view sees (no grey interiors on exposed faces)', () => {
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16, BLUE), box(0, 16, 0, 16, RED), box(0, 16, 0, 16, YELLOW), box(0, 16, 0, 16, GREEN)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8) as Texture;

    expect(voxelAt(grid, 3, 3, 3)).toEqual(RED);
  });

  it('encodes slices BOTTOM-up: the sheet TOP row lands in the grid top slice', () => {
    const bicolor = (x: number, y: number): Rgba => (y < 8 ? RED : BLUE);
    const sheet = makeSheet(16, 16, [bicolor, box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8) as Texture;
    const nz = grid.height / (grid.voxelDepth as number);

    expect(voxelAt(grid, 3, 0, nz - 1)).toEqual(RED);
    expect(voxelAt(grid, 3, 0, 0)).toEqual(BLUE);
  });

  it('applies the calibrated flip to the colour projection, not just the hull', () => {
    const halfTop = (x: number, y: number): Rgba => (y < 8 ? box(0, 8, 0, 16, RED)(x, y) : box(8, 16, 0, 16, YELLOW)(x, y)); // prettier-ignore
    const halfBottom = (x: number, y: number): Rgba => (y < 8 ? box(8, 16, 0, 16)(x, y) : box(0, 8, 0, 16)(x, y)); // prettier-ignore
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16), halfTop, box(0, 16, 0, 16), halfBottom]);
    const grid = carveVoxelProp(sheet, 8) as Texture;
    const ny = grid.voxelDepth as number;
    const nz = grid.height / ny;
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
    expect(flankColor).toEqual(RED);
  });

  it('returns null on malformed input: a non-1×4 sheet width, a sub-2 grid, an empty view', () => {
    const good = makeSheet(16, 16, [box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore

    expect(carveVoxelProp({ ...good, width: 30 }, 8)).toBeNull();
    expect(carveVoxelProp(good, 1)).toBeNull();
    const noBack = makeSheet(16, 16, [box(0, 16, 0, 16), box(0, 16, 0, 16), () => CLEAR, box(0, 16, 0, 16)]); // prettier-ignore

    expect(carveVoxelProp(noBack, 8)).toBeNull();
  });

  it('is deterministic: the same sheet carves to the same bytes', () => {
    const sheet = makeSheet(16, 16, [box(2, 14, 1, 15), box(4, 10, 0, 16), box(2, 14, 2, 16), box(4, 10, 1, 14)]); // prettier-ignore
    const a = carveVoxelProp(sheet, 8) as Texture;
    const b = carveVoxelProp(sheet, 8) as Texture;

    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });

  it('rejects a malformed cell count: not a multiple of 4, zero, or one the width cannot split', () => {
    const good = makeSheet(16, 16, [box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16), box(0, 16, 0, 16)]); // prettier-ignore

    expect(carveVoxelProp(good, 8, { cells: 6 })).toBeNull();
    expect(carveVoxelProp(good, 8, { cells: 0 })).toBeNull();
    expect(carveVoxelProp({ ...good, width: 36 }, 8, { cells: 8 })).toBeNull();
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
    expect(solidCount(grid)).toBe(4 * 4 * 8 + 4 * 8 * 8);
    expect(voxelAt(grid, 2, 3, 7)[3]).toBe(255);
    expect(voxelAt(grid, 5, 3, 7)[3]).toBe(0);
    expect(voxelAt(grid, 2, 7, 7)).toEqual(YELLOW);
  });

  it('SUPERSAMPLES colours: a face voxel averages the art pixels its footprint covers', () => {
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
    const sheet = makeSheet(8, 8, [box(0, 8, 0, 8, RED), box(0, 8, 0, 8, RED), box(0, 8, 0, 8, RED), box(0, 8, 0, 8, RED)]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 16) as Texture;

    expect(grid).not.toBeNull();
    expect(voxelAt(grid, 7, 0, 7)).toEqual(RED);
  });
});

describe('carveVoxelProp — 8-view sheets (diagonal silhouettes)', () => {
  const empty = (): Rgba => CLEAR;

  it('reads the cardinals off the rotation wheel: front 0 · +x flank 2 · back 4 · −x flank 6', () => {
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16, BLUE), empty, box(0, 8, 0, 16, RED), empty, box(0, 16, 0, 16, YELLOW), empty, box(0, 8, 0, 16, GREEN), empty]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull(); // fail-without: a 0/1/2/3 read hits the EMPTY cell 1 and carves null
    expect(grid.voxelDepth).toBe(4);
    expect(voxelAt(grid, 3, 0, 3)).toEqual(BLUE);
    expect(voxelAt(grid, 7, 2, 3)).toEqual(RED);
    expect(voxelAt(grid, 0, 2, 3)).toEqual(GREEN);
    expect(voxelAt(grid, 3, 3, 3)).toEqual(YELLOW);
  });

  it('chamfers the plan corners a 4-view hull leaves square (the octagon carve)', () => {
    const card = box(8, 24, 0, 32);
    const sheet = makeSheet(32, 32, [card, card, card, card, card, card, card, card]);
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull();
    const nz = grid.height / (grid.voxelDepth as number);

    for (let z = 0; z < nz; z++) {
      expect(voxelAt(grid, 0, 0, z)[3]).toBe(0);
      expect(voxelAt(grid, 7, 0, z)[3]).toBe(0);
      expect(voxelAt(grid, 0, 7, z)[3]).toBe(0);
      expect(voxelAt(grid, 7, 7, z)[3]).toBe(0);
      expect(voxelAt(grid, 3, 0, z)[3]).toBe(255);
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
    expect(solidCount(grid)).toBe(4 * 4 * 8 + 4 * 64);
    expect(voxelAt(grid, 0, 0, 7)[3]).toBe(255);
  });

  it('skips a diagonal whose best registration stays under the IoU floor (junk art)', () => {
    const card = box(8, 24, 0, 32);
    const sliver = box(15, 17, 0, 32);
    const sheet = makeSheet(32, 32, [card, sliver, card, empty, card, empty, card, empty]);
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(solidCount(grid)).toBe(8 * 8 * 8);
  });

  it('skips a diagonal whose trim would EMPTY an occupied z-slice (a holed band)', () => {
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
    expect(voxelAt(grid, 0, 0, 8)[3]).toBe(0);
    expect(voxelAt(grid, 15, 15, 8)[3]).toBe(0);
    expect(voxelAt(grid, 7, 7, 8)[3]).toBe(255);
  });

  it('gives a voxel projecting OUTSIDE the cell the benefit of the doubt (clipped art)', () => {
    const card = box(1, 15, 0, 16);
    const diag = box(0, 13, 0, 16);
    const sheet = makeSheet(16, 16, [card, diag, card, empty, card, empty, card, empty]);
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull();
    expect(voxelAt(grid, 0, 0, 3)[3]).toBe(255);
    expect(voxelAt(grid, 7, 7, 3)[3]).toBe(0);
  });

  it('colours 45° edges from the diagonal view that sees them (no cardinal bleed)', () => {
    const MAGENTA: Rgba = [250, 20, 250, 255];
    const diag = box(8, 24, 0, 32, MAGENTA);
    const sheet = makeSheet(32, 32, [box(8, 24, 0, 32, BLUE), diag, box(8, 24, 0, 32, RED), diag, box(8, 24, 0, 32, YELLOW), diag, box(8, 24, 0, 32, GREEN), diag]); // prettier-ignore
    const grid = carveVoxelProp(sheet, 8, { cells: 8 }) as Texture;

    expect(grid).not.toBeNull();
    expect(voxelAt(grid, 5, 0, 3)[3]).toBe(255);
    expect(voxelAt(grid, 5, 0, 3)).toEqual(MAGENTA);
    expect(voxelAt(grid, 3, 0, 3)).toEqual(BLUE);
    expect(voxelAt(grid, 7, 3, 3)).toEqual(RED);
  });
});

describe('carveVoxelProp — top view (plan footprint + upward faces)', () => {
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
    const plus = makeTop(16, 16, (x, y) =>
      Math.abs(x - 7.5) < 2 || Math.abs(y - 7.5) < 2 ? BLUE : CLEAR,
    );
    const grid = carveVoxelProp(fullBox, 8, { top: plus }) as Texture;

    expect(grid).not.toBeNull();
    expect(solidCount(grid)).toBe(28 * 8);
    expect(voxelAt(grid, 0, 0, 3)[3]).toBe(0);
    expect(voxelAt(grid, 1, 1, 3)[3]).toBe(0);
    expect(voxelAt(grid, 3, 0, 3)[3]).toBe(255);
    expect(voxelAt(grid, 0, 3, 3)[3]).toBe(255);
    expect(voxelAt(grid, 4, 4, 3)[3]).toBe(255);
  });

  it('maps the delivered convention: image BOTTOM = object FRONT, image x = grid +x', () => {
    const notched = makeTop(16, 16, (x, y) => (x < 8 && y >= 8 ? CLEAR : BLUE));
    const grid = carveVoxelProp(fullBox, 8, { top: notched }) as Texture;

    expect(grid).not.toBeNull();
    expect(solidCount(grid)).toBe(48 * 8);
    expect(voxelAt(grid, 0, 0, 3)[3]).toBe(0);
    expect(voxelAt(grid, 7, 0, 3)[3]).toBe(255);
    expect(voxelAt(grid, 0, 7, 3)[3]).toBe(255);
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
    expect(solidCount(grid)).toBe(8 * 3 * 8);
    expect(voxelAt(grid, 3, 1, 0)[3]).toBe(255);
    expect(voxelAt(grid, 3, 4, 0)[3]).toBe(0);
  });

  it('ignores a top whose footprint cannot explain the hull (the IoU floor)', () => {
    const sliver = makeTop(16, 16, (x, y) => (x <= 1 || (x === 15 && y === 8) ? BLUE : CLEAR));
    const grid = carveVoxelProp(fullBox, 8, { top: sliver }) as Texture;

    expect(solidCount(grid)).toBe(8 * 8 * 8);
  });

  it('colours upward faces from the top view (and only those)', () => {
    const ORANGE: Rgba = [250, 150, 20, 255];
    const sheet = makeSheet(16, 16, [box(0, 16, 0, 16, BLUE), box(0, 16, 0, 16, RED), box(0, 16, 0, 16, YELLOW), box(0, 16, 0, 16, GREEN)]); // prettier-ignore
    const orange = makeTop(16, 16, () => ORANGE);
    const grid = carveVoxelProp(sheet, 8, { top: orange }) as Texture;

    expect(voxelAt(grid, 3, 3, 7)).toEqual(ORANGE);
    expect(voxelAt(grid, 3, 3, 0)).toEqual(RED);
    expect(voxelAt(grid, 7, 3, 3)).toEqual(RED);
    expect(voxelAt(grid, 3, 0, 7)).toEqual(BLUE);
  });

  it('tolerates hulls with EMPTY slices and plan columns no view fills (gappy art)', () => {
    const towers = (x: number, y: number): Rgba =>
      ((x < 6 || x >= 10) && (y < 6 || y >= 10)) || y === 7 ? BLUE : CLEAR;
    const side = box(0, 16, 0, 16);
    const sheet = makeSheet(16, 16, [towers, side, towers, side]);
    const bars = makeTop(16, 16, (x) => (x < 6 || x >= 10 ? BLUE : CLEAR));
    const grid = carveVoxelProp(sheet, 8, { top: bars }) as Texture;

    expect(grid).not.toBeNull();
    expect(solidCount(grid)).toBe(6 * 6 * 8);
    expect(voxelAt(grid, 3, 3, 0)[3]).toBe(0);
    expect(voxelAt(grid, 0, 3, 0)[3]).toBe(255);
  });

  it('carries on without a top that is empty or degenerate', () => {
    const clear = makeTop(16, 16, () => CLEAR);
    const line = makeTop(16, 16, (x) => (x === 5 ? BLUE : CLEAR));

    expect(solidCount(carveVoxelProp(fullBox, 8, { top: clear }) as Texture)).toBe(512);
    expect(solidCount(carveVoxelProp(fullBox, 8, { top: line }) as Texture)).toBe(512);
  });
});
