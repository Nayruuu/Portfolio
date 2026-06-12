import { cellAt, diagAt, isGlass } from './game-map';
import type { GameMap } from './game-map';
import { CAMERA_Z, WALL_HEIGHT, surfaceScreenY } from './floor-cast';
import { ceilZAt, floorZAt, sectorAt } from './sector';
import type { ColumnProfile, ColumnSpan, Pose, SurfaceHit } from './types';

/** Riser-face material id (A2b): every inter-sector step face textures with the base wall material — a
 *  per-sector step material is deferred, so one constant id keeps the riser self-similar to the walls. */
const RISER_CELL = 1;

/** A 45°-face intersection: the camera-space distance `t` plus the texture coordinate along it. */
interface DiagHit {
  t: number;
  texX: number;
}

/** The flat heights + materials of the sector traversed by one DDA segment — the strip march reads these
 *  off the cell the ray is currently crossing. A globally-flat map (no `sectors`) yields the base floor (0)
 *  / ceiling (`WALL_HEIGHT`) and material 0, so the strips still tile the column from the eye to the wall. */
interface SectorProfile {
  floorZ: number;
  ceilZ: number;
  floorMat: number;
  ceilMat: number;
}

/** Read the sector profile under a cell (sampled at its centre): heights from `floorZAt`/`ceilZAt` (which
 *  default to the flat base when the map carries no sectors), materials from the sector itself (`0` when
 *  none). Pure — the projection lives in `floor-cast`, the heights in `sector`. */
function sectorProfile(map: GameMap, cellX: number, cellY: number): SectorProfile {
  const cx = cellX + 0.5;
  const cy = cellY + 0.5;
  const sector = sectorAt(map, cx, cy);

  return {
    floorZ: floorZAt(map, cx, cy),
    ceilZ: ceilZAt(map, cx, cy),
    floorMat: sector?.floorMat ?? 0,
    ceilMat: sector?.ceilMat ?? 0,
  };
}

/** The VISIBLE texture V-range (0 = ceiling, 1 = floor) of a terminal wall standing in `sector`, given the
 *  residual occlusion window `[ceilClip, floorClip]` (screen-Y) the march left at the wall. The wall's FULL
 *  projection spans `surfaceScreenY(camZ − ceilZ)` … `surfaceScreenY(camZ − floorZ)`; the window reveals only
 *  a sub-range, so the renderer blits that slice at TRUE scale instead of squashing the whole texture into the
 *  window (the wall-stretch bug). On a flat, fully-visible wall the window equals the full projection → 0..1. */
function terminalVRange(
  camZ: number,
  sector: SectorProfile,
  dist: number,
  screenHeight: number,
  ceilClip: number,
  floorClip: number,
): { vTop: number; vBottom: number } {
  const wallTop = surfaceScreenY(camZ - sector.ceilZ, dist, screenHeight);
  const wallBottom = surfaceScreenY(camZ - sector.floorZ, dist, screenHeight);
  const span = wallBottom - wallTop; // > 0 — a lower floor projects below a higher ceiling
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

  return {
    vTop: clamp01((ceilClip - wallTop) / span),
    vBottom: clamp01((floorClip - wallTop) / span),
  };
}

/** The column's occlusion window in screen-Y — the band still open for surfaces (`ceilClip` top, `floorClip`
 *  bottom). Floor surfaces march `floorClip` UP, ceiling surfaces march `ceilClip` DOWN; the band seals when
 *  the two meet. The riser emitter both reads it (to clip a face) and returns it jumped past the step. */
interface ClipWindow {
  ceilClip: number;
  floorClip: number;
}

/** Everything one riser emission needs about the boundary the ray is crossing: the sector left (`cur`) and
 *  entered (`nb`), the boundary distance `d` + axis `side`, the eye altitude, the backing height, and the
 *  riser's tangential texture coordinate (`texX`/`wallU`, computed like a wall hit). */
interface RiserBoundary {
  cur: SectorProfile;
  nb: SectorProfile;
  d: number;
  camZ: number;
  screenHeight: number;
  side: 0 | 1;
  texX: number;
  wallU: number;
}

/**
 * Emit the vertical riser FACE(s) standing at a sector boundary where the floor or ceiling height changes,
 * and return the occlusion window jumped past the step. Mirrors the flat-strip clamps in the march:
 *
 * - FLOOR STEP UP (`nb.floorZ > cur.floorZ`): a front face from the lower floor edge (`yA`, the current
 *   `floorClip`) up to the higher one (`yB`, smaller screen-Y) is visible; `floorClip` rises to `yB`.
 * - FLOOR STEP DOWN (a pit): no near face — `floorClip` is untouched, and the existing flat strips clamp the
 *   lower floor on later boundaries (you see DOWN into the pit).
 * - CEILING DROP (`nb.ceilZ < cur.ceilZ`): a face hangs from the higher ceiling edge (`yA`) down to the lower
 *   one (`yB`, larger screen-Y); `ceilClip` lowers to `yB`.
 * - CEILING RISE: no near face — symmetric to the pit, auto-clamped by later flat strips.
 *
 * Each face is clipped to the live window, so a riser fully outside it emits no span but still jumps the
 * window. The continuous `wallU` / per-cell `texX` come from the caller (computed exactly like a wall hit),
 * and `vTop`/`vBottom` carry the world heights as `worldZ / WALL_HEIGHT` so step textures align across risers.
 */
function emitRisers(spans: ColumnSpan[], b: RiserBoundary, win: ClipWindow): ClipWindow {
  let { ceilClip, floorClip } = win;

  if (b.nb.floorZ > b.cur.floorZ) {
    const yA = surfaceScreenY(b.camZ - b.cur.floorZ, b.d, b.screenHeight); // lower floor (current edge)
    const yB = surfaceScreenY(b.camZ - b.nb.floorZ, b.d, b.screenHeight); // higher floor → smaller y
    const faceTop = Math.max(yB, ceilClip);
    const faceBot = Math.min(yA, floorClip);

    if (faceTop < faceBot) {
      spans.push({
        kind: 'stepFloor',
        depth: b.d,
        yTop: faceTop,
        yBottom: faceBot,
        vTop: b.nb.floorZ / WALL_HEIGHT,
        vBottom: b.cur.floorZ / WALL_HEIGHT,
        side: b.side,
        cell: RISER_CELL,
        texX: b.texX,
        wallU: b.wallU,
      });
    }
    floorClip = Math.min(floorClip, Math.max(yB, ceilClip));
  }

  if (b.nb.ceilZ < b.cur.ceilZ) {
    const yA = surfaceScreenY(b.camZ - b.cur.ceilZ, b.d, b.screenHeight); // higher ceiling (current edge)
    const yB = surfaceScreenY(b.camZ - b.nb.ceilZ, b.d, b.screenHeight); // lower ceiling → larger y
    const faceTop = Math.max(yA, ceilClip);
    const faceBot = Math.min(yB, floorClip);

    if (faceTop < faceBot) {
      spans.push({
        kind: 'stepCeil',
        depth: b.d,
        yTop: faceTop,
        yBottom: faceBot,
        vTop: b.cur.ceilZ / WALL_HEIGHT,
        vBottom: b.nb.ceilZ / WALL_HEIGHT,
        side: b.side,
        cell: RISER_CELL,
        texX: b.texX,
        wallU: b.wallU,
      });
    }
    ceilClip = Math.max(ceilClip, Math.min(yB, floorClip));
  }

  return { ceilClip, floorClip };
}

/**
 * March the occlusion window across a diagonal cell's OPEN HALF — the wedge the ray crosses between the cell
 * boundary and the 45° face at `faceDist` — emitting the room sector `sec`'s floor + ceiling strips so the
 * terminal window lands at the FACE depth, not the (nearer) cell boundary. Without this the 45° terminal is
 * drawn into the larger boundary window and renders as BLOCKY STEPS on the height path (a flat level ignores
 * the window via the legacy render path, so the bug only shows once a level has any sector). Mirrors the
 * per-segment floor/ceiling clamps in the main march.
 */
function marchDiagFace(
  spans: ColumnSpan[],
  sec: SectorProfile,
  faceDist: number,
  nearDepth: number,
  camZ: number,
  screenHeight: number,
  win: ClipWindow,
): ClipWindow {
  let { ceilClip, floorClip } = win;
  const yFloor = surfaceScreenY(camZ - sec.floorZ, faceDist, screenHeight);
  const floorTop = Math.max(yFloor, ceilClip);

  if (floorTop < floorClip) {
    spans.push({
      kind: 'floor',
      yTop: floorTop,
      yBottom: floorClip,
      worldZ: sec.floorZ,
      material: sec.floorMat,
      nearDepth,
    });
    floorClip = floorTop;
  }
  const yCeil = surfaceScreenY(camZ - sec.ceilZ, faceDist, screenHeight);
  const ceilBot = Math.min(yCeil, floorClip);

  if (ceilBot > ceilClip) {
    spans.push({
      kind: 'ceil',
      yTop: ceilClip,
      yBottom: ceilBot,
      worldZ: sec.ceilZ,
      material: sec.ceilMat,
      nearDepth,
    });
    ceilClip = ceilBot;
  }

  return { ceilClip, floorClip };
}

/**
 * Intersect a ray with the 45° face of cell (mapX, mapY) of orientation `diag`.
 * The face is the `/` line `u+v=1` for orientations 1..2, the `\` line `v=u` for 3..4. Solve for
 * the camera-space `t`, then keep the hit only when it is ahead of the camera and lands inside the
 * cell square — testing `u` is enough because `v` is pinned to `u` on the face (`v=1-u` or `v=u`), so
 * `u`'s range carries `v`'s. The `t <= 0` guard drops a face behind (or at) the camera: a player
 * standing in the open half of a diagonal cell facing AWAY from the face yields a negative `t` that
 * would otherwise clamp to `1e-4` and paint a spurious wall flush with the eye; rejecting it lets the
 * ray fall through to the wall behind. It also catches the parallel ray whose denominator is 0 → its
 * `num < 0` branch is `t = -Infinity <= 0` here, and the `num > 0` branch is `t = +Infinity` → `u` out
 * of range — so no explicit zero-guard is needed (matching the file's `1 / 0 = Infinity` rationale).
 */
function diagonalHit(
  pose: Pose,
  rayX: number,
  rayY: number,
  mapX: number,
  mapY: number,
  diag: number,
): DiagHit | null {
  const t =
    diag <= 2
      ? (mapX + mapY + 1 - pose.x - pose.y) / (rayX + rayY)
      : (mapY - mapX - pose.y + pose.x) / (rayY - rayX);

  if (t <= 0) {
    return null;
  }
  const u = pose.x + t * rayX - mapX;
  const v = pose.y + t * rayY - mapY;

  if (u < 0 || u > 1) {
    return null;
  }

  return { t, texX: diag <= 2 ? v : u };
}

/**
 * Cast `columns` rays across the field of view and return one wall hit per column.
 * Grid DDA (lodev-style): step cell-by-cell to the first wall, return perpendicular
 * (fish-eye-corrected) distance, the hit side, the wall id, and the texture coordinate.
 * Diagonal cells carry a 45° face: a ray that meets the face hits at its true camera `t`, while a
 * ray crossing only the open half passes through and keeps stepping to the wall behind.
 *
 * Alongside the wall hit, each column emits the floor + ceiling STRIPS of every sector the ray crosses,
 * clamped to a per-column occlusion window (`ceilClip`..`floorClip`, in screen-Y). The window opens to the
 * full `screenHeight` and closes inward as each segment's strips are emitted; when the ray stops at the
 * opaque wall the residual window is exactly the wall slice. (FLAT today — every sector shares the base
 * floor/ceiling height, so the strips simply tile the column; the projection needs `screenHeight`.)
 */
export function castColumns(
  pose: Pose,
  fov: number,
  map: GameMap,
  columns: number,
  screenHeight: number,
): ColumnProfile[] {
  const hits: ColumnProfile[] = [];
  const dirX = Math.cos(pose.dir);
  const dirY = Math.sin(pose.dir);
  const planeScale = Math.tan(fov / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;

  for (let col = 0; col < columns; col++) {
    const cameraX = (2 * col) / columns - 1; // -1 .. 1 across the FOV
    const rayX = dirX + planeX * cameraX;
    const rayY = dirY + planeY * cameraX;

    let mapX = Math.floor(pose.x);
    let mapY = Math.floor(pose.y);
    // A zero ray component yields `1 / 0 === Infinity` (then `Math.abs`), so that axis is never
    // stepped — no explicit guard needed (and floats are never exactly 0 here anyway).
    const deltaX = Math.abs(1 / rayX);
    const deltaY = Math.abs(1 / rayY);

    let stepX: number;
    let stepY: number;
    let sideDistX: number;
    let sideDistY: number;

    if (rayX < 0) {
      stepX = -1;
      sideDistX = (pose.x - mapX) * deltaX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - pose.x) * deltaX;
    }
    if (rayY < 0) {
      stepY = -1;
      sideDistY = (pose.y - mapY) * deltaY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - pose.y) * deltaY;
    }

    let side: 0 | 1 = 0;
    let cell = 0;
    let diagHit: DiagHit | null = null;
    let diagOrient = 0;
    const glass: SurfaceHit[] = []; // see-through panes crossed before the opaque wall (near→far)
    const spans: ColumnSpan[] = []; // floor/ceil strips of the sectors crossed, near→far

    // The occlusion window the strips fill, in screen-Y: the top edge marches DOWN as ceiling strips are
    // emitted, the bottom edge marches UP as floor strips are emitted; the gap left at the wall is its slice.
    const camZ = (pose.z ?? 0) + CAMERA_Z;
    let ceilClip = 0;
    let floorClip = screenHeight;
    let dPrev = 0; // perpendicular distance at the near edge of the segment being emitted
    let cur = sectorProfile(map, mapX, mapY); // the sector the ray is currently traversing

    // The camera can already stand inside a diagonal cell — meet its face before any DDA step.
    const startDiag = diagAt(map, mapX, mapY);

    if (startDiag !== 0) {
      const hit = diagonalHit(pose, rayX, rayY, mapX, mapY, startDiag);

      if (hit) {
        diagHit = hit;
        diagOrient = startDiag;
        cell = cellAt(map, mapX, mapY);
        // March the window from the camera (depth 0) to the 45° face so the terminal lands at the face depth.
        const w = marchDiagFace(spans, cur, hit.t, dPrev, camZ, screenHeight, {
          ceilClip,
          floorClip,
        });

        ceilClip = w.ceilClip;
        floorClip = w.floorClip;
      }
    }

    // Bounded by the map diagonal so a malformed map can never hang the frame.
    if (!diagHit) {
      for (let guard = 0; guard <= map.width + map.height; guard++) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaY;
          mapY += stepY;
          side = 1;
        }
        cell = cellAt(map, mapX, mapY);

        // Perpendicular distance to the boundary just crossed — the FAR edge of the segment the ray
        // spent in `cur`'s sector (the same value the wall/glass hit distance uses).
        const segFar = side === 0 ? sideDistX - deltaX : sideDistY - deltaY;

        // FLOOR strip: from the floor's screen-Y at the far edge down to the window's current bottom.
        const yFloorFar = surfaceScreenY(camZ - cur.floorZ, segFar, screenHeight);
        const floorTop = Math.max(yFloorFar, ceilClip);

        if (floorTop < floorClip) {
          spans.push({
            kind: 'floor',
            yTop: floorTop,
            yBottom: floorClip,
            worldZ: cur.floorZ,
            material: cur.floorMat,
            nearDepth: dPrev,
          });
          floorClip = floorTop;
        }
        // CEILING strip: from the window's current top down to the ceiling's screen-Y at the far edge.
        const yCeilFar = surfaceScreenY(camZ - cur.ceilZ, segFar, screenHeight);
        const ceilBot = Math.min(yCeilFar, floorClip);

        if (ceilBot > ceilClip) {
          spans.push({
            kind: 'ceil',
            yTop: ceilClip,
            yBottom: ceilBot,
            worldZ: cur.ceilZ,
            material: cur.ceilMat,
            nearDepth: dPrev,
          });
          ceilClip = ceilBot;
        }
        // The floor + ceiling have met on screen — no wall slice remains, so seal the column here (the
        // post-loop terminal then lands at this boundary). On a flat map a normal eye never reaches this.
        if (ceilClip >= floorClip) {
          break;
        }

        if (cell > 0) {
          const d = diagAt(map, mapX, mapY);

          if (d === 0) {
            if (isGlass(cell)) {
              // See-through glass: record the pane (same geometry as a wall hit) and KEEP stepping to the
              // opaque wall behind, so the next room — and enemies in it — show through the pane.
              const glassDist = side === 0 ? sideDistX - deltaX : sideDistY - deltaY;
              const glassHit = side === 0 ? pose.y + glassDist * rayY : pose.x + glassDist * rayX;

              glass.push({
                dist: Math.max(glassDist, 1e-4),
                side,
                cell,
                texX: glassHit - Math.floor(glassHit),
                wallU: glassHit,
              });
              // The glass cell is part of the marched space — carry its sector into the next segment.
              cur = sectorProfile(map, mapX, mapY);
              dPrev = segFar;
              continue; // not a stop — keep casting to the opaque wall behind
            }
            break; // ordinary opaque wall
          }
          const hit = diagonalHit(pose, rayX, rayY, mapX, mapY, d);

          if (hit) {
            // March the window across the diagonal cell's open half (boundary `segFar` → 45° face) so the
            // terminal window matches the FACE depth — else the wall fills the larger boundary window and the
            // 45° face renders as blocky steps on the height path.
            const w = marchDiagFace(spans, cur, hit.t, segFar, camZ, screenHeight, {
              ceilClip,
              floorClip,
            });

            ceilClip = w.ceilClip;
            floorClip = w.floorClip;
            diagHit = hit;
            diagOrient = d;
            break;
          }
          // The ray crossed only the open half — keep stepping to the wall behind.
        }
        // Stepped into another open (or open-diagonal-half) cell — its sector drives the next segment. When
        // its floor/ceiling height differs from the one just left, a riser FACE stands at this boundary:
        // emit it (clipped to the window) and jump the window past the step BEFORE adopting the new sector.
        const nb = sectorProfile(map, mapX, mapY);
        const stepHit = side === 0 ? pose.y + segFar * rayY : pose.x + segFar * rayX;
        const win = emitRisers(
          spans,
          {
            cur,
            nb,
            d: segFar,
            camZ,
            screenHeight,
            side,
            texX: stepHit - Math.floor(stepHit),
            wallU: stepHit,
          },
          { ceilClip, floorClip },
        );

        ceilClip = win.ceilClip;
        floorClip = win.floorClip;

        // A high floor rising into a low ceiling closes the window → the column seals here (opaque-like stop).
        if (ceilClip >= floorClip) {
          break;
        }
        cur = nb;
        dPrev = segFar;
      }
    }

    if (diagHit) {
      const terminal: SurfaceHit = {
        dist: Math.max(diagHit.t, 1e-4),
        side: diagOrient <= 2 ? 0 : 1,
        cell,
        texX: diagHit.texX,
        // A continuous tangential coordinate along the diagonal run (the cell anchor + its in-cell U) so a
        // wall texture tiles smoothly across adjacent 45° segments instead of restarting each cell.
        wallU: mapX + mapY + diagHit.texX,
      };

      const vRange = terminalVRange(camZ, cur, terminal.dist, screenHeight, ceilClip, floorClip);

      hits.push({
        terminal,
        glass,
        spans,
        terminalTop: ceilClip,
        terminalBottom: floorClip,
        terminalVTop: vRange.vTop,
        terminalVBottom: vRange.vBottom,
      });
    } else {
      const perpDist = side === 0 ? sideDistX - deltaX : sideDistY - deltaY;
      const wallHit = side === 0 ? pose.y + perpDist * rayY : pose.x + perpDist * rayX;
      const texX = wallHit - Math.floor(wallHit);

      // `wallHit` is the CONTINUOUS world coordinate where the ray met the wall (the per-cell `texX` is just
      // its fraction) — kept whole so a texture can tile across many cells at a fixed world width.
      const terminal: SurfaceHit = {
        dist: Math.max(perpDist, 1e-4),
        side,
        cell,
        texX,
        wallU: wallHit,
      };

      const vRange = terminalVRange(camZ, cur, terminal.dist, screenHeight, ceilClip, floorClip);

      hits.push({
        terminal,
        glass,
        spans,
        terminalTop: ceilClip,
        terminalBottom: floorClip,
        terminalVTop: vRange.vTop,
        terminalVBottom: vRange.vBottom,
      });
    }
  }

  return hits;
}
