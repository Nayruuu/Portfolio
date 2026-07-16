import { expandRgba, palettizeRgba } from './palettize';
import type { Texture } from './texture';

// Carves a directional rotation sheet into a coloured VOXEL GRID by visual-hull intersection (a voxel
// survives only where EVERY view's silhouette has matter), drawn world-anchored by the renderer.
//
// View wheel (orientSprite's contract): cell k is the view at θk = k·2π/N; the viewer stands along
// (sin θk, −cos θk), so cardinals live at {0, N/4, N/2, 3N/4} (front · +x flank · back · −x flank) and
// N=8 adds the diagonals. TRAP: asset pipelines label the flank cells "left"/"right" the OPPOSITE way;
// the wheel here is the one the billboard renders with, which the volume must match.
//
// Grid axes (renderer world-anchoring contract): x = front view left→right (world (−sin facing, cos
// facing)); y = DEPTH, 0 at the front face growing away (world −(cos facing, sin facing)); z = height,
// 0 at bottom. Encoding rides an ordinary Texture: width=n, height=voxelDepth·nz, voxel (x,y,z) at
// pixel (x, z·voxelDepth+y), index 0 = empty.
//
// The carve itself reasons in RGBA (alpha thresholds + colour averaging), so the palettized inputs are
// expanded ONCE at entry and the finished grid re-palettizes on the way out.

export const VOXEL_GRID = 64;

// Sheets are chroma-keyed with hard-ish edges.
const SOLID_ALPHA = 128;

// A flip combo is rejected when it empties a z-slice the front silhouette fills beyond this.
const HOLE_COVERAGE = 0.05;

// Normal dots span [−2, 2], so a seeing view outranks every occluded one except at the exact extremes.
const SEES_BONUS = 4;

// Anchor search ± this fraction of the cell width — wide enough to re-centre edge-clipped 45° cells.
const ANCHOR_RANGE = 0.2;

// A diagonal view overlapping the hull below this IoU is SKIPPED (better an untrimmed corner than a
// misplaced silhouette).
const IOU_MIN = 0.5;

// Looser floor: a top footprint legitimately SHRINKS a boxy hull, so this only rejects outright junk.
const TOP_IOU_MIN = 0.3;

// Cardinal indices into the per-cardinal arrays. The wheel cell of cardinal i is i · cells/4.
const FRONT = 0;
const RIGHT = 1; // the +x flank (wheel's 90° view) — see the naming-convention trap above
const BACK = 2;
const LEFT = 3;

export interface VoxelCarveViews {
  readonly cells?: number; // multiple of 4; 4 = cardinals only, 8 adds the diagonals
  readonly top?: Texture; // a separate top-down image: stamps the plan footprint + colours upward faces
}

// The carve's working form of a sheet: same dims, pixels EXPANDED back to RGBA.
interface RgbaSheet {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

function toRgbaSheet(tex: Texture): RgbaSheet {
  return { width: tex.width, height: tex.height, pixels: expandRgba(tex) };
}

// A cell's DOMINANT column-run (the gap-separated run containing the cell centre, else the most
// massive) — never the raw bbox, which neighbour bleed and edge clipping poison.
function cellSpan(sheet: RgbaSheet, cw: number, cell: number): readonly [number, number] | null {
  const columnMass = new Array<number>(cw).fill(0);

  for (let x = 0; x < cw; x++) {
    for (let y = 0; y < sheet.height; y++) {
      if (sheet.pixels[(y * sheet.width + cell * cw + x) * 4 + 3] > SOLID_ALPHA) {
        columnMass[x]++;
      }
    }
  }
  let best: { first: number; last: number; mass: number; centred: boolean } | null = null;
  let first = -1;
  let mass = 0;

  for (let x = 0; x <= cw; x++) {
    if (x < cw && columnMass[x] > 0) {
      if (first < 0) {
        first = x;
        mass = 0;
      }
      mass += columnMass[x];
    } else if (first >= 0) {
      const run = { first, last: x - 1, mass, centred: first <= cw / 2 && x - 1 >= cw / 2 };

      if (
        best === null ||
        (run.centred && !best.centred) ||
        (run.centred === best.centred && run.mass > best.mass)
      ) {
        best = run;
      }
      first = -1;
    }
  }

  return best === null ? null : [best.first, best.last];
}

// t runs across the CELL'S OWN span (per-view recentring), v down the sheet.
function sheetIndex(
  sheet: RgbaSheet,
  cw: number,
  span: readonly [number, number],
  cell: number,
  t: number,
  v: number,
): number {
  const [first, last] = span;
  const x = Math.min(cw - 1, Math.max(0, Math.round(first + t * (last - first))));
  const y = Math.min(sheet.height - 1, Math.max(0, Math.round(v * (sheet.height - 1))));

  return (y * sheet.width + cell * cw + x) * 4;
}

// Rasterises view `cell`'s silhouette into a w × nz mask (row = image v, TOP-down).
function viewMask(
  sheet: RgbaSheet,
  cw: number,
  span: readonly [number, number],
  cell: number,
  w: number,
  nz: number,
): Uint8Array {
  const mask = new Uint8Array(w * nz);

  for (let z = 0; z < nz; z++) {
    const v = z / (nz - 1);

    for (let t = 0; t < w; t++) {
      const i = sheetIndex(sheet, cw, span, cell, t / (w - 1), v);

      mask[z * w + t] = sheet.pixels[i + 3] > SOLID_ALPHA ? 1 : 0;
    }
  }

  return mask;
}

// Averages the OPAQUE sheet pixels under a voxel's footprint (supersampling), or the nearest pixel when
// sub-pixel / empty. Writes RGB straight into `pixels` — runs once per solid voxel, so no tuple garbage.
function sampleCell(
  sheet: RgbaSheet,
  cellLeft: number,
  cw: number,
  px: number,
  py: number,
  fx: number,
  fy: number,
  pixels: Uint8ClampedArray,
  out: number,
): void {
  const x0 = Math.max(cellLeft, Math.ceil(px - fx / 2));
  const x1 = Math.min(cellLeft + cw - 1, Math.floor(px + fx / 2));
  const y0 = Math.max(0, Math.ceil(py - fy / 2));
  const y1 = Math.min(sheet.height - 1, Math.floor(py + fy / 2));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * sheet.width + x) * 4;

      if (sheet.pixels[i + 3] > SOLID_ALPHA) {
        r += sheet.pixels[i];
        g += sheet.pixels[i + 1];
        b += sheet.pixels[i + 2];
        count++;
      }
    }
  }
  if (count > 0) {
    pixels[out] = r / count;
    pixels[out + 1] = g / count;
    pixels[out + 2] = b / count;

    return;
  }
  const nx = Math.min(cellLeft + cw - 1, Math.max(cellLeft, Math.round(px)));
  const ny = Math.min(sheet.height - 1, Math.max(0, Math.round(py)));
  const i = (ny * sheet.width + nx) * 4;

  pixels[out] = sheet.pixels[i];
  pixels[out + 1] = sheet.pixels[i + 1];
  pixels[out + 2] = sheet.pixels[i + 2];
}

// kept: voxel (x,y,z) at (z·ny+y)·n+x, z TOP-down like the sheet.
interface Hull {
  readonly kept: Uint8Array;
  readonly total: number;
  readonly perZ: readonly number[];
}

// f2 mirrors the back view's axis, f3 the −x flank's (the calibration's search space). The +x flank is
// the UNFLIPPED reference on purpose: mirroring it is provably inert (flipping both flanks only mirrors
// the hull in depth — same volume/counts; depth orientation is the visual hull's inherent ambiguity).
function carveHull(
  front: Uint8Array,
  right: Uint8Array,
  back: Uint8Array,
  left: Uint8Array,
  n: number,
  ny: number,
  nz: number,
  f2: number,
  f3: number,
): Hull {
  const kept = new Uint8Array(n * ny * nz);
  const perZ = new Array<number>(nz).fill(0);
  let total = 0;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const leftT = f3 === 1 ? ny - 1 - y : y;

      if (right[z * ny + y] === 0 || left[z * ny + leftT] === 0) {
        continue; // both flanks gate the whole (z, y) row — skip its x sweep
      }
      for (let x = 0; x < n; x++) {
        const backT = f2 === 1 ? n - 1 - x : x;

        if (front[z * n + x] === 1 && back[z * n + backT] === 1) {
          kept[(z * ny + y) * n + x] = 1;
          total++;
          perZ[z]++;
        }
      }
    }
  }

  return { kept, total, perZ };
}

// 1 = covers matter, 0 = inside the cell on transparency, -1 = fully OUTSIDE the cell (clipped art says
// nothing about it). rowSums are per-row PREFIX SUMS (O(1) range test). Shared by the diagonal scoring
// AND its trim so both judge a voxel identically — else a half-bin anchor shift drifts the whole cut.
function footprintHit(
  rowSums: Int32Array,
  rowStart: number,
  cw: number,
  p: number,
  s: number,
): number {
  if (p + s / 2 < 0 || p - s / 2 > cw - 1) {
    return -1;
  }
  let x0 = Math.max(0, Math.ceil(p - s / 2));
  let x1 = Math.min(cw - 1, Math.floor(p + s / 2));

  if (x1 < x0) {
    x0 = Math.min(cw - 1, Math.max(0, Math.round(p))); // sub-pixel footprint → nearest column
    x1 = x0;
  }

  return rowSums[rowStart + x1 + 1] - rowSums[rowStart + x0] > 0 ? 1 : 0;
}

interface DiagonalView {
  readonly cell: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly axisX: number;
  readonly axisY: number;
  readonly span: readonly [number, number];
  readonly anchor: number;
  readonly flip: number;
  readonly adjacentA: number; // the two cardinals flanking this view — their axis rays "seeing" a voxel
  readonly adjacentB: number; // is the cheap stand-in for a true 45° visibility test
}

interface HullState {
  readonly kept: Uint8Array;
  readonly perZ: number[];
  total: number;
}

// Projects the hull onto the view's axis in whole-cell bins, searches anchor × mirror for the best
// silhouette IoU at shared scale `s`, then trims the hull in place. Returns null (hull untouched) when
// the best IoU stays under IOU_MIN or the trim would empty an occupied z-slice.
function registerDiagonal(
  sheet: RgbaSheet,
  cw: number,
  cell: number,
  cells: number,
  hull: HullState,
  n: number,
  ny: number,
  nz: number,
  s: number,
): DiagonalView | null {
  const span = cellSpan(sheet, cw, cell);

  if (span === null) {
    return null;
  }
  const theta = (cell * 2 * Math.PI) / cells;
  const axisX = Math.cos(theta);
  const axisY = Math.sin(theta);
  const cx = (n - 1) / 2;
  const cy = (ny - 1) / 2;
  // The view silhouette as per-row prefix sums, columns outside the dominant run FORCED empty (bleed
  // must not read as matter).
  const rowSums = new Int32Array(nz * (cw + 1));

  for (let z = 0; z < nz; z++) {
    const row = Math.round((z / (nz - 1)) * (sheet.height - 1));
    const base = z * (cw + 1);

    for (let x = 0; x < cw; x++) {
      const solid =
        x >= span[0] &&
        x <= span[1] &&
        sheet.pixels[(row * sheet.width + cell * cw + x) * 4 + 3] > SOLID_ALPHA;

      rowSums[base + x + 1] = rowSums[base + x] + (solid ? 1 : 0);
    }
  }
  // The hull's projection onto the view axis, in whole-cell u-bins per slice (anchor-independent).
  const off = Math.ceil((n * Math.abs(axisX) + ny * Math.abs(axisY)) / 2) + 1;
  const bins = 2 * off + 1;
  const proj = new Uint8Array(nz * bins);
  let maskArea = 0; // silhouette area in BIN units (columns / s), for the IoU's union term

  for (let z = 0; z < nz; z++) {
    maskArea += rowSums[z * (cw + 1) + cw];
  }
  maskArea /= s;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < n; x++) {
        if (hull.kept[(z * ny + y) * n + x] === 1) {
          proj[z * bins + Math.round((x - cx) * axisX + (y - cy) * axisY) + off] = 1;
        }
      }
    }
  }
  // EVERY hull bin counts toward the union (even ones an anchor pushes outside the cell), or an extreme
  // anchor could inflate its score by shoving the hull past the clip edge.
  const mid = (span[0] + span[1]) / 2;
  const step = Math.max(1, s / 2);
  let hullArea = 0;

  for (let i = 0; i < proj.length; i++) {
    hullArea += proj[i];
  }
  let best = { iou: -1, anchor: mid, flip: 1 };
  const consider = (anchor: number, flip: number): number => {
    let inter = 0;

    for (let z = 0; z < nz; z++) {
      for (let b = 0; b < bins; b++) {
        if (
          proj[z * bins + b] === 1 &&
          footprintHit(rowSums, z * (cw + 1), cw, anchor + flip * (b - off) * s, s) === 1
        ) {
          inter++;
        }
      }
    }
    // hullArea ≥ 1 (the hull has voxels), so the denominator never zeroes.
    const iou = inter / (hullArea + maskArea - inter);
    // IoU-plateau tie-break toward the CENTRED anchor (else a flat maximum drifts to the plateau edge).
    const closer = iou === best.iou && Math.abs(anchor - mid) < Math.abs(best.anchor - mid);

    if (iou > best.iou || closer) {
      best = { iou, anchor, flip };
    }

    return iou;
  };

  // Two-stage sweep per mirror: coarse probe over ± ANCHOR_RANGE at 4·step, then refine this mirror's
  // coarse winner at `step` — a quarter of a flat sweep's evaluations for the same optimum.
  for (const flip of [1, -1]) {
    const coarse = 4 * step;
    let around = mid;
    let aroundIou = -1;

    for (let k = -Math.floor((ANCHOR_RANGE * cw) / coarse); k * coarse <= ANCHOR_RANGE * cw; k++) {
      const anchor = mid + k * coarse;
      const iou = consider(anchor, flip);

      if (
        iou > aroundIou ||
        (iou === aroundIou && Math.abs(anchor - mid) < Math.abs(around - mid))
      ) {
        aroundIou = iou;
        around = anchor;
      }
    }
    for (let k = -4; k <= 4; k++) {
      consider(around + k * step, flip);
    }
  }
  if (best.iou < IOU_MIN) {
    return null;
  }
  // Trial-trim (pass 1): reject the whole view if trimming would EMPTY a z-slice the hull occupies. A
  // voxel dies only on a definite miss (inside the cell, no matter); a footprint outside the cell (−1)
  // keeps the benefit of the doubt.
  const removedPerZ = new Array<number>(nz).fill(0);
  const doomed = (x: number, y: number, z: number): boolean =>
    footprintHit(
      rowSums,
      z * (cw + 1),
      cw,
      best.anchor + best.flip * ((x - cx) * axisX + (y - cy) * axisY) * s,
      s,
    ) === 0;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < n; x++) {
        if (hull.kept[(z * ny + y) * n + x] === 1 && doomed(x, y, z)) {
          removedPerZ[z]++;
        }
      }
    }
  }
  if (removedPerZ.some((removed, z) => hull.perZ[z] > 0 && removed === hull.perZ[z])) {
    return null;
  }
  // Commit (pass 2).
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < n; x++) {
        if (hull.kept[(z * ny + y) * n + x] === 1 && doomed(x, y, z)) {
          hull.kept[(z * ny + y) * n + x] = 0;
          hull.perZ[z]--;
          hull.total--;
        }
      }
    }
  }

  return {
    cell,
    dirX: Math.sin(theta),
    dirY: -Math.cos(theta),
    axisX,
    axisY,
    span,
    anchor: best.anchor,
    flip: best.flip,
    adjacentA: Math.floor(cell / (cells / 4)) % 4,
    adjacentB: Math.ceil(cell / (cells / 4)) % 4,
  };
}

// No axis TRANSPOSITION in the search space: the per-axis bbox stretch would absorb a transposed image's
// aspect and make it undetectable — the delivered convention pins which image axis is which.
interface TopView {
  readonly tex: RgbaSheet;
  readonly flipU: boolean;
  readonly flipV: boolean;
  readonly spanX: readonly [number, number];
  readonly spanY: readonly [number, number];
}

function topPixel(
  top: TopView,
  n: number,
  ny: number,
  x: number,
  y: number,
): readonly [number, number] {
  const u = top.flipU ? 1 - x / (n - 1) : x / (n - 1);
  const v = top.flipV ? 1 - y / (ny - 1) : y / (ny - 1);

  // Base convention: v = 0 (the object's FRONT, grid y = 0) sits at the image BOTTOM (spanY[1]).
  return [
    top.spanX[0] + u * (top.spanX[1] - top.spanX[0]),
    top.spanY[1] - v * (top.spanY[1] - top.spanY[0]),
  ];
}

// Stamps the plan FOOTPRINT (a column survives only where the top image is opaque), separating what four
// profile silhouettes fuse. The 4 mirror transforms are scored by IoU against the hull footprint (base
// convention wins ties; a cardinal-only footprint is a rectangle where the HOLE guard is the real
// discriminator). Ignores the top under TOP_IOU_MIN or on a degenerate image; trims in place.
function applyTop(
  tex: RgbaSheet,
  hull: HullState,
  n: number,
  ny: number,
  nz: number,
): TopView | null {
  let x0 = -1;
  let x1 = -1;
  let y0 = -1;
  let y1 = -1;

  for (let y = 0; y < tex.height; y++) {
    for (let x = 0; x < tex.width; x++) {
      if (tex.pixels[(y * tex.width + x) * 4 + 3] > SOLID_ALPHA) {
        if (x0 < 0 || x < x0) {
          x0 = x;
        }
        if (x > x1) {
          x1 = x;
        }
        if (y0 < 0) {
          y0 = y;
        }
        y1 = y;
      }
    }
  }
  if (x0 < 0 || x1 === x0 || y1 === y0) {
    return null; // empty or degenerate top image — carve on without it
  }
  const footprint = new Uint8Array(n * ny); // the hull's own plan occupancy (any solid z)

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < n; x++) {
        if (hull.kept[(z * ny + y) * n + x] === 1) {
          footprint[y * n + x] = 1;
        }
      }
    }
  }
  let best: { iou: number; view: TopView; mask: Uint8Array } | null = null;

  for (const flipV of [false, true]) {
    for (const flipU of [false, true]) {
      const view: TopView = { tex, flipU, flipV, spanX: [x0, x1], spanY: [y0, y1] };
      const mask = new Uint8Array(n * ny);
      let inter = 0;
      let union = 0;

      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < n; x++) {
          const [px, py] = topPixel(view, n, ny, x, y);
          const solid =
            tex.pixels[(Math.round(py) * tex.width + Math.round(px)) * 4 + 3] > SOLID_ALPHA;

          mask[y * n + x] = solid ? 1 : 0;
          if (solid && footprint[y * n + x] === 1) {
            inter++;
          }
          if (solid || footprint[y * n + x] === 1) {
            union++;
          }
        }
      }
      const holed = hull.perZ.some((count, z) => {
        if (count === 0) {
          return false;
        }
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < n; x++) {
            if (hull.kept[(z * ny + y) * n + x] === 1 && mask[y * n + x] === 1) {
              return false;
            }
          }
        }

        return true;
      });
      // The hull has voxels, so its footprint (⊆ union) is non-empty — no zero denominator.
      const iou = inter / union;

      if (!holed && (best === null || iou > best.iou)) {
        best = { iou, view, mask };
      }
    }
  }
  if (best === null || best.iou < TOP_IOU_MIN) {
    return null;
  }
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < n; x++) {
        if (hull.kept[(z * ny + y) * n + x] === 1 && best.mask[y * n + x] === 0) {
          hull.kept[(z * ny + y) * n + x] = 0;
          hull.perZ[z]--;
          hull.total--;
        }
      }
    }
  }

  return best.view;
}

// Returns null when the sheet can't produce a volume (malformed width, cells not a multiple of 4, an
// empty cardinal silhouette, or a hull intersecting to nothing) — the caller keeps the billboard sheet
// as the zero-regression fallback. Extra `views` are individually skipped, never fatal.
export function carveVoxelProp(
  source: Texture,
  n = VOXEL_GRID,
  views: VoxelCarveViews = {},
): Texture | null {
  const cells = views.cells ?? 4;

  if (cells < 4 || cells % 4 !== 0 || source.width % cells !== 0 || n < 2) {
    return null;
  }
  const sheet = toRgbaSheet(source);
  const cw = sheet.width / cells;
  const quarter = cells / 4; // wheel cell of cardinal i is i·quarter
  const spans = [FRONT, RIGHT, BACK, LEFT].map((i) => cellSpan(sheet, cw, i * quarter));
  const [frontSpan, rightSpan, backSpan, leftSpan] = spans;

  if (frontSpan == null || rightSpan == null || backSpan == null || leftSpan == null) {
    return null;
  }
  const nz = Math.max(2, Math.round((sheet.height / cw) * n));
  // Depth from flank span / front span — a plan-isotropic grid (same cell size as x) so the renderer
  // uses ONE plan scale for both axes.
  const depthRatio = (rightSpan[1] - rightSpan[0]) / Math.max(1, frontSpan[1] - frontSpan[0]);
  const ny = Math.max(2, Math.min(n, Math.round(n * depthRatio)));
  const front = viewMask(sheet, cw, frontSpan, FRONT * quarter, n, nz);
  const right = viewMask(sheet, cw, rightSpan, RIGHT * quarter, ny, nz);
  const back = viewMask(sheet, cw, backSpan, BACK * quarter, n, nz);
  const left = viewMask(sheet, cw, leftSpan, LEFT * quarter, ny, nz);
  // Front view per-slice coverage — the reference for "no slice may go empty".
  const ref = new Array<number>(nz).fill(0);

  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < n; x++) {
      ref[z] += front[z * n + x];
    }
  }

  // Auto-calibration: try the 4 flip combos, reject any emptying a z-slice the front fills (>
  // HOLE_COVERAGE), keep the most voluminous. The intersection is SEPARABLE — kept(z,y,x) = X-gate(z,x)
  // ∧ Y-gate(z,y), so a combo scores in O(nz·(n+ny)); only the WINNER's hull is actually built.
  let bestFlips: { total: number; f2: number; f3: number } | null = null;

  for (const f2 of [0, 1]) {
    for (const f3 of [0, 1]) {
      let total = 0;
      let holed = false;

      for (let z = 0; z < nz; z++) {
        let cols = 0;
        let rows = 0;

        for (let x = 0; x < n; x++) {
          if (front[z * n + x] === 1 && back[z * n + (f2 === 1 ? n - 1 - x : x)] === 1) {
            cols++;
          }
        }
        for (let y = 0; y < ny; y++) {
          if (right[z * ny + y] === 1 && left[z * ny + (f3 === 1 ? ny - 1 - y : y)] === 1) {
            rows++;
          }
        }
        total += cols * rows;
        holed ||= ref[z] > n * HOLE_COVERAGE && cols * rows === 0;
      }
      if (!holed && (bestFlips === null || total > bestFlips.total)) {
        bestFlips = { total, f2, f3 };
      }
    }
  }
  const { f2, f3 } = bestFlips ?? { f2: 0, f3: 0 };
  const best = carveHull(front, right, back, left, n, ny, nz, f2, f3);

  if (best.total === 0) {
    return null;
  }
  const { kept } = best;
  const hull: HullState = { kept, perZ: [...best.perZ], total: best.total };
  // Shared pixel scale (px per grid cell) — front + flank agree by construction; the mean splits rounding.
  const scale =
    ((frontSpan[1] - frontSpan[0]) / (n - 1) + (rightSpan[1] - rightSpan[0]) / (ny - 1)) / 2;
  const diagonals: DiagonalView[] = [];

  for (let cell = 0; cell < cells; cell++) {
    if (cell % quarter !== 0) {
      const view = registerDiagonal(sheet, cw, cell, cells, hull, n, ny, nz, scale);

      if (view !== null) {
        diagonals.push(view);
      }
    }
  }
  const top = views.top === undefined ? null : applyTop(toRgbaSheet(views.top), hull, n, ny, nz);

  // Per-axis first/last solid maps: a voxel is VISIBLE to a cardinal iff it is that axis ray's first hit
  // — built O(cells) once instead of a scan per voxel. Diagonal visibility = the two flanking cardinals'.
  const firstY = new Int32Array(n * nz).fill(-1);
  const lastY = new Int32Array(n * nz).fill(-1);
  const firstX = new Int32Array(ny * nz).fill(-1);
  const lastX = new Int32Array(ny * nz).fill(-1);
  const topMost = new Int32Array(n * ny).fill(-1); // smallest mask-z (the sheet is top-down)

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < n; x++) {
        if (kept[(z * ny + y) * n + x] === 1) {
          if (firstY[z * n + x] < 0) {
            firstY[z * n + x] = y;
          }
          lastY[z * n + x] = y;
          if (firstX[z * ny + y] < 0) {
            firstX[z * ny + y] = x;
          }
          lastX[z * ny + y] = x;
          if (topMost[y * n + x] < 0) {
            topMost[y * n + x] = z;
          }
        }
      }
    }
  }

  // Colour + encode. Output slices are BOTTOM-up (the renderer's z), so the image row order flips. The
  // per-voxel machinery is HOISTED out of the ~10⁵-voxel loop — per-voxel closures were a fifth of the time.
  const pixels = new Uint8ClampedArray(n * ny * nz * 4);
  const solid = (x: number, y: number, z: number): boolean =>
    x >= 0 && x < n && y >= 0 && y < ny && z >= 0 && z < nz && kept[(z * ny + y) * n + x] === 1;
  const fy = (sheet.height - 1) / (nz - 1); // every wheel view's vertical footprint (shared v axis)
  const cx = (n - 1) / 2;
  const cy = (ny - 1) / 2;
  let chosen: number; // 0..3 cardinal, 4 + i diagonal, -2 top (reset per voxel)
  let bestScore: number;
  const consider = (id: number, score: number): void => {
    if (score > bestScore) {
      chosen = id;
      bestScore = score;
    }
  };
  const lateral = (flip: number, w: number, cellIndex: number): number =>
    (flip === 1 ? w - 1 - cellIndex : cellIndex) / (w - 1);

  for (let z = 0; z < nz; z++) {
    const v = z / (nz - 1);
    const py = v * (sheet.height - 1);

    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < n; x++) {
        if (kept[(z * ny + y) * n + x] === 0) {
          continue;
        }
        // Surface normal from empty neighbours (mask z runs TOP-down, so "up" is z − 1).
        const normalX = (solid(x + 1, y, z) ? 0 : 1) - (solid(x - 1, y, z) ? 0 : 1);
        const normalY = (solid(x, y + 1, z) ? 0 : 1) - (solid(x, y - 1, z) ? 0 : 1);
        const normalUp = (solid(x, y, z - 1) ? 0 : 1) - (solid(x, y, z + 1) ? 0 : 1);
        const seesFront = firstY[z * n + x] === y;
        const seesRight = lastX[z * ny + y] === x; // the +x flank
        const seesBack = lastY[z * n + x] === y;
        const seesLeft = firstX[z * ny + y] === x; // the −x flank

        // Best view = direction most aligned with the normal, decisive bonus for views that SEE it.
        // A corner column dots EQUALLY into its two faces, so iteration order is the tie-break: flanks
        // BEFORE front, wheel views BEFORE top. Diagonals outscore their cardinals on 45° edges (√2 vs
        // 1). A voxel no view sees projects THROUGH the best-aligned view (the DDA exposes those faces).
        chosen = -1;
        bestScore = -Infinity;

        consider(RIGHT, (seesRight ? SEES_BONUS : 0) + normalX);
        consider(LEFT, (seesLeft ? SEES_BONUS : 0) - normalX);
        consider(BACK, (seesBack ? SEES_BONUS : 0) + normalY);
        consider(FRONT, (seesFront ? SEES_BONUS : 0) - normalY);
        for (let i = 0; i < diagonals.length; i++) {
          const diag = diagonals[i];
          const seesA = diag.adjacentA === FRONT ? seesFront : diag.adjacentA === RIGHT ? seesRight : diag.adjacentA === BACK ? seesBack : seesLeft; // prettier-ignore
          const seesB = diag.adjacentB === FRONT ? seesFront : diag.adjacentB === RIGHT ? seesRight : diag.adjacentB === BACK ? seesBack : seesLeft; // prettier-ignore

          consider(4 + i, (seesA && seesB ? SEES_BONUS : 0) + diag.dirX * normalX + diag.dirY * normalY); // prettier-ignore
        }
        if (top !== null) {
          consider(-2, (topMost[y * n + x] === z ? SEES_BONUS : 0) + normalUp);
        }
        const out = (((nz - 1 - z) * ny + y) * n + x) * 4;

        if (top !== null && chosen === -2) {
          const [px, pyTop] = topPixel(top, n, ny, x, y);
          const fxTop = (top.spanX[1] - top.spanX[0]) / (n - 1);
          const fyTop = (top.spanY[1] - top.spanY[0]) / (ny - 1);

          sampleCell(top.tex, 0, top.tex.width, px, pyTop, fxTop, fyTop, pixels, out);
        } else if (chosen >= 4) {
          const diag = diagonals[chosen - 4];
          const u = (x - cx) * diag.axisX + (y - cy) * diag.axisY;
          const px = diag.cell * cw + diag.anchor + diag.flip * u * scale;

          sampleCell(sheet, diag.cell * cw, cw, px, py, scale, fy, pixels, out);
        } else {
          const t =
            chosen === FRONT
              ? x / (n - 1)
              : chosen === BACK
                ? lateral(f2, n, x)
                : lateral(chosen === RIGHT ? 0 : f3, ny, y); // the +x flank is never mirrored
          const span = spans[chosen] as readonly [number, number];
          const across = chosen === FRONT || chosen === BACK ? n : ny;
          const px = chosen * quarter * cw + span[0] + t * (span[1] - span[0]);
          const fx = (span[1] - span[0]) / (across - 1);

          sampleCell(sheet, chosen * quarter * cw, cw, px, py, fx, fy, pixels, out);
        }
        pixels[out + 3] = 255;
      }
    }
  }

  // Averaged colours can exceed 255 uniques — palettize quantizes those; occupancy is exact either way.
  return palettizeRgba(n, ny * nz, pixels, { voxelDepth: ny });
}
