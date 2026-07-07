import type { Texture } from './texture';

/**
 * VOXEL-PROP CARVING — sculpts a directional rotation sheet (the art the billboards already ship) into
 * a coloured VOXEL GRID by visual-hull intersection: a voxel survives only where EVERY view's silhouette
 * has matter. No new assets — the carve runs once at load, off the served sheets, and the renderer then
 * draws the grid as a WORLD-ANCHORED VOLUME (the prop never turns with the camera; orbiting it shows
 * every intermediate angle in true perspective, Minecraft-style).
 *
 * VIEW WHEEL — the sheet contract is `orientSprite`'s (the in-game-proven rotation billboard): a 1×N
 * sheet's cell k is the view at wheel angle θk = k·2π/N. In GRID coordinates (see the axes below) the
 * viewer of cell k stands along (sin θk, −cos θk) — so the CARDINALS live at cells {0, N/4, N/2, 3N/4}
 * (front · +x flank · back · −x flank) and, at N = 8, the four DIAGONAL views in between tighten the
 * hull's corners (four planes leave a box; eight cut the 45° chamfers a real object has). NOTE: asset
 * pipelines label the flank cells "left"/"right" from the OPPOSITE convention; the wheel above is the
 * one the billboard renders with, which is what the volume must match.
 *
 * The lessons the validated prototype paid for (kept here on purpose — do not "simplify" them away):
 * - Generated frames are NOT centred consistently → each cardinal view maps its grid axis over ITS OWN
 *   horizontal alpha bbox (per-view recentring), never over the raw cell width.
 * - Cells BLEED into their neighbours (a view's art overflowing its 512px column) and some views are
 *   CLIPPED at a cell edge → a cell's span is its DOMINANT column-run (the gap-separated run containing
 *   the cell centre, else the most massive), not the raw alpha bbox — the bleed poisoned the whiteboard's
 *   depth ratio (a full-width "profile") and carved it degenerate.
 * - Mirror conventions vary per sheet → AUTO-CALIBRATION: try the flip combinations of the back and
 *   −x-flank views (the +x flank stays the unflipped reference — flipping it is provably inert, see
 *   `carveHull`), reject any that empties a z-slice where the front silhouette has >5 % matter, keep
 *   the most voluminous survivor.
 * - The grid's DEPTH span comes from the side views' own bbox ratio (side span / front span), so a flat
 *   whiteboard carves thin and an office chair carves deep.
 * - DIAGONAL views cannot be bbox-stretched (their art is exactly the clipped/bled kind): they carve at
 *   the turntable's SHARED SCALE (px per grid cell, measured off the front + flank spans) and are
 *   REGISTERED against the hull — an anchor (± {@link ANCHOR_RANGE} of the cell) × mirror search scored
 *   by silhouette IoU. A view that agrees below {@link IOU_MIN}, or whose trim would EMPTY an occupied
 *   z-slice, is skipped (the hull just stays cardinal there); a voxel projecting OUTSIDE the cell keeps
 *   the benefit of the doubt (clipped art says nothing about it).
 * - An optional TOP view (a separate single top-down image) stamps the plan FOOTPRINT: a column (x, y)
 *   survives only where the top silhouette is opaque — separating what profile views fuse (a chair
 *   base's star legs). Base orientation: IMAGE BOTTOM = OBJECT FRONT (y = 0), image x = grid +x; the
 *   mirror transforms are auto-calibrated against the hull footprint (IoU, base convention wins ties)
 *   with a hole guard and a loose IoU floor (a top legitimately SHRINKS a boxy hull).
 * - Colours project from the view that best matches each voxel's SURFACE NORMAL among ALL views (a
 *   decisive bonus for views whose ray actually SEES the voxel): the diagonals colour the 45° edges the
 *   cardinal-only pick striped, the top view colours upward faces (no more flank-tinted seat tops). A
 *   voxel NO view sees projects THROUGH the best-aligned view — the renderer's DDA exposes those faces.
 * - Every projection SUPERSAMPLES: a voxel averages the opaque sheet pixels its footprint covers
 *   (falling back to the nearest pixel when the footprint is sub-pixel or fully transparent) instead of
 *   point-sampling — at high grid resolutions the point pick sparkled noise across flat faces.
 *
 * GRID AXES (the renderer's world-anchoring contract): `x` runs along the front view's left→right
 * (world direction `(−sin facing, cos facing)` — the billboard's head-on U axis), `y` is the DEPTH,
 * 0 at the front face growing AWAY from the front viewer (world `−(cos facing, sin facing)`), `z` is
 * the height, 0 at the BOTTOM.
 *
 * ENCODING: the grid rides the ordinary {@link Texture} format — and therefore every existing texture
 * channel: the workers' structured clone and the GPU texel pool, with no new buffer or binding. `width`
 * = `n` (lateral cells), `height` = `voxelDepth · nz` (bottom-up slices of `voxelDepth` rows each):
 * voxel (x, y, z) lives at pixel (x, z · voxelDepth + y). Alpha 0 = empty, 255 = solid. RGBA8 direct —
 * no occupancy bitmask / palette indirection: the four shipped props total ≈ 6 MB (the 96³-class grids
 * ≈ 1.5–2.2 MB each), and the pool samples it exactly like any sprite texel, byte-identically on both
 * backends.
 */

/** Default lateral grid resolution (cells per side; the height follows the sheet's cell aspect). */
export const VOXEL_GRID = 64;

/** Above this alpha a sheet pixel is matter (the sheets are chroma-keyed with hard-ish edges). */
const SOLID_ALPHA = 128;

/** A flip combination is rejected when it empties a z-slice the front silhouette fills beyond this. */
const HOLE_COVERAGE = 0.05;

/** Scoring bonus for a view whose axis ray actually SEES the voxel (first hit): normal dots span
 *  [−2, 2], so a seeing view outranks every occluded one except at the exact extremes. */
const SEES_BONUS = 4;

/** The diagonal registration searches anchors ± this fraction of the cell width around the span
 *  middle — wide enough to re-centre the measured edge-clipped 45° cells (~9 % off), cheap enough
 *  to stay a load-time blip. */
const ANCHOR_RANGE = 0.2;

/** A diagonal view whose best registration overlaps the hull below this IoU is SKIPPED — the guard
 *  against mis-scaled art, a wrong axis, or plain junk: better an untrimmed corner than a silhouette
 *  stamped somewhere it doesn't belong. */
const IOU_MIN = 0.5;

/** The top view's own (much looser) IoU floor: a top footprint legitimately SHRINKS a boxy hull —
 *  a star base against a square plan sits near 0.4 — so this only rejects outright junk. */
const TOP_IOU_MIN = 0.3;

/** The cardinal views, as indices into the per-cardinal arrays (spans/masks/flips). The wheel cell of
 *  cardinal i is `i · cells/4`. */
const FRONT = 0;
const RIGHT = 1; // the +x flank (the wheel's 90° view) — see the module doc on the naming convention
const BACK = 2;
const LEFT = 3;

/** The optional extra views of {@link carveVoxelProp}. */
export interface VoxelCarveViews {
  /** The sheet's view-cell count (a multiple of 4; 4 = cardinals only, 8 adds the diagonals). */
  readonly cells?: number;
  /** A separate top-down image: stamps the plan footprint + colours upward faces. */
  readonly top?: Texture;
}

/** One view cell's DOMINANT column-run `[first, last]` in cell-local pixels, or null when empty:
 *  gap-separated runs of occupied columns, keeping the one containing the cell centre (turntable art
 *  is centred) or, when the centre falls in a gap, the most massive — never the raw bbox, which
 *  neighbour-cell bleed and edge clipping poison (see the module doc). */
function cellSpan(sheet: Texture, cw: number, cell: number): readonly [number, number] | null {
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

/** The sheet pixel index of view `cell` at (t, v) ∈ [0,1]² — t across the CELL'S OWN span (the
 *  per-view recentring), v down the sheet. */
function sheetIndex(
  sheet: Texture,
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

/** Rasterise view `cell`'s silhouette into a `w × nz` mask (row = image v, TOP-down). */
function viewMask(
  sheet: Texture,
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

/** Average the OPAQUE sheet pixels under a voxel's image footprint (a `fx × fy` px rect centred on
 *  (`px`, `py`), clamped to the cell), or the nearest pixel when the footprint is sub-pixel or covers
 *  no matter — the supersampling every colour projection goes through. `px` is sheet-absolute.
 *  Writes RGB straight into `pixels` at `out` (this runs once per solid voxel — no tuple garbage). */
function sampleCell(
  sheet: Texture,
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

/** One carved hull: the kept flags (voxel (x,y,z) at `(z·ny + y)·n + x`, z TOP-down like the sheet),
 *  the voxel total, and the per-z-slice counts the hole check reads. */
interface Hull {
  readonly kept: Uint8Array;
  readonly total: number;
  readonly perZ: readonly number[];
}

/** Intersect the four cardinal silhouettes into a hull under one flip combination (`f2` mirrors the
 *  back view's axis, `f3` the −x flank's — the auto-calibration's search space). The +x flank is the
 *  UNFLIPPED reference on purpose: mirroring it is provably inert. Flipping BOTH flanks only mirrors
 *  the hull in depth (a bijection — same volume, same per-slice counts, so the calibration could
 *  never strictly prefer it over the unflipped twin it iterates first), and flipping the +x flank
 *  alone is congruent to flipping the −x one; depth orientation is the visual hull's inherent mirror
 *  ambiguity, which silhouettes alone cannot resolve. */
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
        continue; // both flank silhouettes gate the whole (z, y) row — skip its x sweep outright
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

/** Test a projected voxel footprint `[p − s/2, p + s/2]` against one row of a cell-local silhouette
 *  (as per-row PREFIX SUMS, `cw + 1` entries per row — the O(1) range test the registration's
 *  anchor × mirror sweep leans on): `1` = covers matter, `0` = lies inside the cell on transparency,
 *  `-1` = fully OUTSIDE the cell (clipped art says nothing about it). Shared by the diagonal
 *  registration's scoring and its trim so both judge a voxel identically — scoring on bin CENTRES
 *  instead lets a half-bin anchor shift win on rounding phase alone and drift the whole cut. */
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

/** A diagonal view REGISTERED against the hull (see {@link registerDiagonal}) — everything its trim
 *  applied and its colour sampling replays: the wheel direction (the outward normal it sees), the
 *  projection axis, and the calibrated anchor/flip mapping grid-centre u onto cell-local pixels. */
interface DiagonalView {
  readonly cell: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly axisX: number;
  readonly axisY: number;
  readonly span: readonly [number, number];
  readonly anchor: number;
  readonly flip: number;
  readonly adjacentA: number; // the two cardinals flanking this view on the wheel — their axis rays
  readonly adjacentB: number; // "seeing" a voxel is the cheap stand-in for a true 45° visibility test
}

/** The mutable hull state the extra views trim in place (the cardinal calibration built it). */
interface HullState {
  readonly kept: Uint8Array;
  readonly perZ: number[];
  total: number;
}

/**
 * Register + apply one DIAGONAL view: rasterise its silhouette (dominant-run columns only — bleed is
 * transparent), project the hull onto the view's axis in whole-cell bins, then search anchor × mirror
 * for the best silhouette IoU at the turntable's shared scale `s` (px per grid cell). Skips the view
 * (returns null, hull untouched) when the best agreement stays under {@link IOU_MIN} or the trim would
 * empty an occupied z-slice; otherwise trims the hull in place and returns the view for colouring.
 * A voxel whose footprint projects fully OUTSIDE the cell is kept — clipped art says nothing about it.
 */
function registerDiagonal(
  sheet: Texture,
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
  // The view silhouette at working resolution: nz rows (nearest sheet row per slice) × cw columns as
  // per-row PREFIX SUMS (cw + 1 entries each — {@link footprintHit}'s O(1) range test), with columns
  // outside the dominant run FORCED empty (neighbour bleed must not read as matter).
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
  let maskArea = 0; // the silhouette's area in BIN units (columns / s), for the IoU's union term

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
  // Registration: anchor (the pixel the grid centre projects to) × mirror, scored by silhouette IoU.
  // EVERY hull bin counts toward the union — including the ones an anchor pushes outside the cell —
  // or an extreme anchor could inflate its score by shoving the hull past the clip edge. `hullArea`
  // is anchor-independent; only the intersection is sampled (out-of-cell bins can't match anything).
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
    // Strict improvement, with an IoU plateau tie-broken toward the CENTRED anchor (turntable art
    // is centred; without this, a flat maximum would let the anchor drift to the plateau's edge).
    const closer = iou === best.iou && Math.abs(anchor - mid) < Math.abs(best.anchor - mid);

    if (iou > best.iou || closer) {
      best = { iou, anchor, flip };
    }

    return iou;
  };

  // TWO-STAGE sweep per mirror: probe the whole ± ANCHOR_RANGE window at a coarse 4·step (mid itself
  // included), then refine THIS mirror's own coarse winner at `step` across one coarse cell either
  // side — a quarter of a flat sweep's evaluations for the same optimum.
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
  // Trial-trim (pass 1): a voxel dies when its projected footprint lies inside the cell yet covers no
  // matter. Reject the whole view if that would EMPTY a z-slice the hull occupies.
  const removedPerZ = new Array<number>(nz).fill(0);
  // A voxel dies only on a definite miss: a footprint fully outside the cell (−1) keeps the benefit
  // of the doubt — the clipped art says nothing about it.
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

/** The TOP view CALIBRATED against the hull footprint (see {@link applyTop}): the mirror transform
 *  over the base "image bottom = object front, image x = grid +x" convention plus the image's alpha
 *  bboxes the footprint mapping stretches over. (No axis TRANSPOSITION in the search space: the
 *  per-axis bbox stretch would absorb a transposed image's aspect and make it structurally
 *  undetectable — the delivered convention pins which image axis is which.) */
interface TopView {
  readonly tex: Texture;
  readonly flipU: boolean;
  readonly flipV: boolean;
  readonly spanX: readonly [number, number];
  readonly spanY: readonly [number, number];
}

/** The top image pixel (sheet-absolute x, y) under a top view's transform for grid column (x, y). */
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

/**
 * Calibrate + apply the optional TOP view: its silhouette (each axis stretched over its own alpha
 * bbox) stamps the plan FOOTPRINT — a column (x, y) survives only where the top-down image is opaque,
 * separating what four profile silhouettes fuse (a star base's legs). The 4 mirror transforms are
 * scored by IoU against the hull's own footprint (base convention first, strict improvement to
 * replace — so a symmetric tie keeps the documented orientation; note a cardinal-only hull's
 * footprint is a rectangle, where every mirror ties and the HOLE guard is the real discriminator);
 * a transform that would empty an occupied z-slice is invalid, and a best score under
 * {@link TOP_IOU_MIN} (or a degenerate/empty image) ignores the top entirely. Trims the hull in
 * place; returns the view for colouring, or null.
 */
function applyTop(
  tex: Texture,
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

/**
 * Carve a directional prop's rotation sheet into its voxel-grid {@link Texture} (see the module doc
 * for the axes + encoding), or `null` when the sheet can't produce a volume (a malformed width, a cell
 * count not a multiple of 4, any empty cardinal silhouette, or a hull that intersects to nothing) —
 * the caller then simply keeps the billboard sheet, the zero-regression fallback. `views` opts extra
 * silhouettes in: `cells: 8` reads the four diagonal cells, `top` stamps the plan footprint; both are
 * individually skipped (never fatal) when their art can't be trusted. Pure and deterministic: same
 * sheet, same grid.
 */
export function carveVoxelProp(
  sheet: Texture,
  n = VOXEL_GRID,
  views: VoxelCarveViews = {},
): Texture | null {
  const cells = views.cells ?? 4;

  if (cells < 4 || cells % 4 !== 0 || sheet.width % cells !== 0 || n < 2) {
    return null;
  }
  const cw = sheet.width / cells;
  const quarter = cells / 4; // the wheel cell of cardinal i is i·quarter
  const spans = [FRONT, RIGHT, BACK, LEFT].map((i) => cellSpan(sheet, cw, i * quarter));
  const [frontSpan, rightSpan, backSpan, leftSpan] = spans;

  if (frontSpan == null || rightSpan == null || backSpan == null || leftSpan == null) {
    return null;
  }
  const nz = Math.max(2, Math.round((sheet.height / cw) * n));
  // Depth from the flank view's own extent: flank span / front span (the prototype's lesson) — a
  // plan-isotropic grid (ny cells over width·ratio world units, same cell size as x) the renderer
  // relies on to use ONE plan scale for both axes.
  const depthRatio = (rightSpan[1] - rightSpan[0]) / Math.max(1, frontSpan[1] - frontSpan[0]);
  const ny = Math.max(2, Math.min(n, Math.round(n * depthRatio)));
  const front = viewMask(sheet, cw, frontSpan, FRONT * quarter, n, nz);
  const right = viewMask(sheet, cw, rightSpan, RIGHT * quarter, ny, nz);
  const back = viewMask(sheet, cw, backSpan, BACK * quarter, n, nz);
  const left = viewMask(sheet, cw, leftSpan, LEFT * quarter, ny, nz);
  // The front view's per-slice coverage — the reference for "no slice may go empty".
  const ref = new Array<number>(nz).fill(0);

  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < n; x++) {
      ref[z] += front[z * n + x];
    }
  }

  // AUTO-CALIBRATION: try the 4 flip combos (back × −x flank — mirroring the +x flank is provably
  // inert, see {@link carveHull}); reject any that empties a z-slice the front silhouette fills
  // (> HOLE_COVERAGE); keep the most voluminous survivor. All rejected → the unflipped carve.
  // The cardinal intersection is SEPARABLE — kept(z,y,x) = X-gate(z,x) ∧ Y-gate(z,y), so a combo's
  // per-slice count is |X(z)| · |Y(z)| — which scores every combo in O(nz·(n + ny)); only the
  // WINNER's hull is actually built ({@link carveHull}).
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
  // The turntable's shared pixel scale (px per grid cell) — front + flank agree by construction
  // (ny derives from their span ratio), the mean just splits their rounding.
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
  const top = views.top === undefined ? null : applyTop(views.top, hull, n, ny, nz);

  // Per-axis first/last solid maps: a voxel is VISIBLE to a cardinal iff it is that axis ray's first
  // hit (front sees ascending y, the +x flank descending x, …), and to the TOP view iff it is its
  // column's highest solid — O(cells) once, instead of a scan per voxel. Diagonal visibility is the
  // conjunction of the two flanking cardinals' (the cheap stand-in for a true 45° ray test).
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

  // Colour + encode. Output slices are BOTTOM-up (the renderer's z), so the image row order flips.
  // The per-voxel machinery (the score accumulator, the sampling helpers) is HOISTED out of the
  // ~10⁵-voxel loop — per-voxel closures/arrays were a fifth of the whole carve's time.
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
        // The voxel's surface normal, from its empty neighbours (out of bounds = empty; mask z runs
        // TOP-down, so "up" is z − 1), and the views that actually see it.
        const normalX = (solid(x + 1, y, z) ? 0 : 1) - (solid(x - 1, y, z) ? 0 : 1);
        const normalY = (solid(x, y + 1, z) ? 0 : 1) - (solid(x, y - 1, z) ? 0 : 1);
        const normalUp = (solid(x, y, z - 1) ? 0 : 1) - (solid(x, y, z + 1) ? 0 : 1);
        const seesFront = firstY[z * n + x] === y;
        const seesRight = lastX[z * ny + y] === x; // the +x flank
        const seesBack = lastY[z * n + x] === y;
        const seesLeft = firstX[z * ny + y] === x; // the −x flank

        // The view whose direction best matches the normal, with a decisive bonus for views whose
        // ray actually SEES the voxel. A corner column's normal dots EQUALLY into its two faces, so
        // the iteration order is the tie-break — flanks BEFORE front (the cardinal-only striping
        // lesson), wheel views BEFORE the top (a rim edge keeps the rotation art's own edge pixels).
        // The diagonals outscore both their cardinals on 45° edges (dot √2 vs 1), which is exactly
        // where the cardinal pick used to bleed a face across its corner. A voxel NO view sees (a
        // seat top's interior, an underside) projects THROUGH from the best-aligned view instead of
        // a flat grey — the in-game DDA exposes those faces, and grey read as blobs there.
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

  return { width: n, height: ny * nz, pixels, voxelDepth: ny };
}
