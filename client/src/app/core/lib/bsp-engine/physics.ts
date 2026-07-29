import { locateSubSector, signedSide } from './node-builder';
import { castRay } from './raycast';
import type { CompiledMap, LineDef, ThingType } from './types';

export interface MoveResult {
  readonly x: number;
  readonly y: number;
  readonly floorZ: number;
}

// Enemies reuse this as their footprint (same solver).
export const PLAYER_RADIUS = 0.3;

// A rise up to STEP_MAX is climbed in stride; taller (up to climbMax) becomes an auto-mantle ledge.
export const STEP_MAX = 1.1;

// Min sector clearance (ceil − floor) a body needs to pass through.
export const HEADROOM = 0.8;

export interface Obstacle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

// `prop_screen` is absent on purpose — the monitor sits ON furniture whose edges already block.
export const PROP_OBSTACLE_RADII: Partial<Record<ThingType, number>> = {
  barrel: 0.35,
  prop: 0.3, // potted plant
  prop_totem: 0.5,
  prop_chair: 0.26,
  prop_board: 0.45,
  prop_cooler: 0.26,
};

// Compute once per zone (the list is static).
export function mapObstacles(map: CompiledMap): Obstacle[] {
  const out: Obstacle[] = [];

  for (const thing of map.source.things) {
    const radius = PROP_OBSTACLE_RADII[thing.type];

    if (radius !== undefined) {
      out.push({ x: thing.x, y: thing.y, radius });
    }
  }

  return out;
}

// `clamped` = the perpendicular foot fell beyond an endpoint; the caller depenetrates differently there so
// a wall whose infinite line passes near the player but whose segment does not cannot phantom-push.
function closestOnSeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): { x: number; y: number; clamped: boolean } {
  const abx = bx - ax;
  const aby = by - ay;
  const raw = ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby);
  const t = Math.max(0, Math.min(1, raw));

  return { x: ax + t * abx, y: ay + t * aby, clamped: raw !== t };
}

// A sliding door blocks until it is at least this open (0..1).
export const SLIDE_OPEN = 0.7;

// `crossSeams` opens PASSABLE zone-portal seams for this body (the player only).
function isBlocking(
  map: CompiledMap,
  line: LineDef,
  lineIndex: number,
  fromX: number,
  fromY: number,
  fromFloor: number,
  stepMax: number,
  headroom: number,
  slides: readonly number[] | undefined,
  crossSeams: boolean,
): boolean {
  if (line.back === null) {
    // Only a crossSeams body (the player) passes a passable seam — enemies never cross zones.
    return !(crossSeams && line.zonePortal?.passable === true);
  }
  if (line.sliding) {
    return (slides?.[lineIndex] ?? 0) < SLIDE_OPEN;
  }
  if (line.glass) {
    return true; // see-through but still blocks
  }
  if (line.fence === true) {
    return true; // renders open, never crossable
  }

  const a = map.source.vertices[line.v1];
  const b = map.source.vertices[line.v2];
  const onFront = signedSide({ x: a.x, y: a.y, dx: b.x - a.x, dy: b.y - a.y }, fromX, fromY) < 0;
  const far = map.source.sectors[onFront ? line.back.sector : line.front.sector];

  return far.floorZ - fromFloor > stepMax || far.ceilZ - far.floorZ < headroom;
}

// Slides off blocking walls AND solid decor obstacles in the same corner passes. With `crossSeams`, the
// caller detects the line crossing and performs the zone swap.
export function movePlayer(
  map: CompiledMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  stepMax: number,
  headroom: number,
  slides?: readonly number[],
  crossSeams = false,
  obstacles?: readonly Obstacle[],
): MoveResult {
  const fromFloor = map.source.sectors[locateSubSector(map.root, x, y).sector].floorZ;
  let px = x + dx;
  let py = y + dy;

  // Pre-resolve each blocking wall to its segment + inward normal (pointing to the player's side).
  const blockers = [];
  const lines = map.source.linedefs;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    if (!isBlocking(map, line, li, x, y, fromFloor, stepMax, headroom, slides, crossSeams)) {
      continue;
    }

    const a = map.source.vertices[line.v1];
    const b = map.source.vertices[line.v2];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let nx = -(b.y - a.y) / length;
    let ny = (b.x - a.x) / length;

    if ((x - a.x) * nx + (y - a.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    blockers.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, nx, ny });
  }

  // A few passes resolve corners (a push off one wall can press into another — or into a prop).
  for (let pass = 0; pass < 3; pass++) {
    if (obstacles !== undefined) {
      for (const o of obstacles) {
        const minDist = radius + o.radius;
        const endD = Math.hypot(px - o.x, py - o.y);
        const startD = Math.hypot(x - o.x, y - o.y);
        // Past the centre plane → resolve on the START side, or the radial ejects the mover out the FAR
        // side (a tunnel).
        const sameSide = (px - o.x) * (x - o.x) + (py - o.y) * (y - o.y) >= 0;

        if (endD < minDist) {
          // Depenetrate radially — this is what makes grazes SLIDE.
          let nx: number;
          let ny: number;

          if (sameSide && endD > 1e-6) {
            nx = (px - o.x) / endD;
            ny = (py - o.y) / endD;
          } else if (startD > 1e-6) {
            nx = (x - o.x) / startD;
            ny = (y - o.y) / startD;
          } else {
            const ml = Math.hypot(dx, dy) || 1; // dead-centre overlap with no history: back off the motion

            nx = -dx / ml || 1;
            ny = -dy / ml;
          }
          px = o.x + nx * minDist;
          py = o.y + ny * minDist;
        } else if (!sameSide && startD > 1e-6) {
          // Outside but on the far side: a large step tunnelled through — only count a real crossing whose
          // path segment actually dips inside the cylinder.
          const cp = closestOnSeg(x, y, px, py, o.x, o.y);

          if (Math.hypot(cp.x - o.x, cp.y - o.y) < minDist) {
            px = o.x + ((x - o.x) / startD) * minDist; // stop on the NEAR face, the way we came
            py = o.y + ((y - o.y) / startD) * minDist;
          }
        }
      }
    }
    for (const blk of blockers) {
      const cp = closestOnSeg(blk.ax, blk.ay, blk.bx, blk.by, px, py);

      if (cp.clamped) {
        // Off the end: only the CORNER blocks, within the true radius — no phantom push from a far wall's
        // infinite line.
        const toX = px - cp.x;
        const toY = py - cp.y;
        const dist = Math.hypot(toX, toY);

        if (dist < radius && dist > 1e-6) {
          px = cp.x + (toX / dist) * radius;
          py = cp.y + (toY / dist) * radius;
        }
      } else {
        // Signed (not absolute) so a player who crossed through the line is pushed back to the right side.
        const signedDist = (px - cp.x) * blk.nx + (py - cp.y) * blk.ny;

        if (signedDist < radius) {
          px += blk.nx * (radius - signedDist);
          py += blk.ny * (radius - signedDist);
        }
      }
    }
  }

  const floorZ = map.source.sectors[locateSubSector(map.root, px, py).sector].floorZ;

  return { x: px, y: py, floorZ };
}

// Returns the floor height to auto-mantle up to when the spot `reach` ahead is a too-tall-but-climbable
// ledge (rise > stepMax, ≤ climbMax, with headroom); null otherwise. A one-sided wall within reach is a
// Does the segment cross a categorically uncrossable two-sided line (fence / glass)?
function barrierCrossed(map: CompiledMap, ax: number, ay: number, bx: number, by: number): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number): number =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);

  for (const line of map.source.linedefs) {
    if (line.back === null || (line.fence !== true && line.glass !== true)) {
      continue;
    }
    const v1 = map.source.vertices[line.v1];
    const v2 = map.source.vertices[line.v2];
    const d1 = cross(ax, ay, bx, by, v1.x, v1.y);
    const d2 = cross(ax, ay, bx, by, v2.x, v2.y);
    const d3 = cross(v1.x, v1.y, v2.x, v2.y, ax, ay);
    const d4 = cross(v1.x, v1.y, v2.x, v2.y, bx, by);

    if (d1 * d2 < 0 && d3 * d4 < 0) {
      return true;
    }
  }

  return false;
}

// true wall, never a ledge.
export function climbTarget(
  map: CompiledMap,
  px: number,
  py: number,
  fromZ: number,
  dx: number,
  dy: number,
  reach: number,
  stepMax: number,
  climbMax: number,
  headroom: number,
): number | null {
  if (castRay(map, px, py, dx, dy, reach) !== null) {
    return null; // a solid one-sided wall — not a ledge
  }
  // castRay skips ALL two-sided lines, and every pre-M5 fence was safe only by height (≥2.8 > CLIMB_MAX):
  // a fence/glass line inside the mantle window must still refuse the vault — "renders open, never
  // crossable". Shut sliders are exempt: they auto-open at player proximity before a mantle can matter.
  if (barrierCrossed(map, px, py, px + dx * reach, py + dy * reach)) {
    return null;
  }
  const ahead =
    map.source.sectors[locateSubSector(map.root, px + dx * reach, py + dy * reach).sector];
  const rise = ahead.floorZ - fromZ;

  if (rise <= stepMax || rise > climbMax || ahead.ceilZ - ahead.floorZ < headroom) {
    return null;
  }

  return ahead.floorZ;
}

export interface MantleState {
  readonly progress: number;
  readonly startZ: number;
  readonly targetZ: number;
  readonly dirX: number;
  readonly dirY: number;
}

export interface MantleStep {
  readonly progress: number;
  readonly dx: number;
  readonly dy: number;
  readonly z: number;
  readonly done: boolean;
}

// Heading is frozen so the vault always clears the lip; on `done` the eye snaps exactly onto the ledge.
export function mantleStep(
  m: MantleState,
  dt: number,
  duration: number,
  advance: number,
  eyeHeight: number,
): MantleStep {
  const progress = m.progress + dt / duration;
  const stride = advance * Math.min(dt / duration, 1 - m.progress);
  const dx = m.dirX * stride;
  const dy = m.dirY * stride;

  if (progress >= 1) {
    return { progress, dx, dy, z: m.targetZ + eyeHeight, done: true };
  }

  return {
    progress,
    dx,
    dy,
    z: m.startZ + (m.targetZ - m.startZ) * progress + eyeHeight,
    done: false,
  };
}

export interface FloorCeilHit {
  readonly dist: number;
  readonly x: number;
  readonly y: number;
  readonly z: number; // clamped to the surface it struck (floorZ or ceilZ)
  readonly surface: 'floor' | 'ceil';
}

// Where a pitched shot/projectile line first leaves the room vertically (below floor / above the live
// ceilZ) within `maxDist`, sampled every `step`; null if it stays between floor and ceiling. `muzzle` is a
// grace distance before floor/ceiling collision begins, so a steep shot off a raised platform clears its
// own lip. For a frame-by-frame projectile, pass the grace REMAINING after its travel so far.
export function castFloorCeil(
  map: CompiledMap,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  z0: number,
  vSlope: number,
  maxDist: number,
  step = 0.2,
  muzzle = 0,
): FloorCeilHit | null {
  const samples = Math.max(1, Math.ceil(maxDist / step));

  for (let i = 1; i <= samples; i++) {
    const dist = (maxDist * i) / samples;

    if (dist < muzzle) {
      continue; // still within the muzzle grace
    }
    const x = ox + dx * dist;
    const y = oy + dy * dist;
    const z = z0 + vSlope * dist;
    const sector = map.source.sectors[locateSubSector(map.root, x, y).sector];

    if (z < sector.floorZ) {
      return { dist, x, y, z: sector.floorZ, surface: 'floor' };
    }
    if (z > sector.ceilZ) {
      return { dist, x, y, z: sector.ceilZ, surface: 'ceil' };
    }
  }

  return null;
}
