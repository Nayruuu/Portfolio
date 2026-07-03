import { locateSubSector, signedSide } from './node-builder';
import { castRay } from './raycast';
import type { CompiledMap, LineDef } from './types';

/**
 * Player movement against the world: slide along solid walls, and step UP through a two-sided portal when
 * the floor difference is climbable and there is headroom. Pure: `(map, pos, delta, …) -> resolved pos +
 * floor height`. The caller drives camera height from `floorZ`.
 *
 * A linedef BLOCKS the player when it is one-sided (the edge of the world — unless it is a PASSABLE
 * zone-portal seam and the mover may `crossSeams`), or two-sided but the far floor is too high to step
 * onto (`> stepMax`) or the far sector is too short to fit (`ceil - floor < headroom`).
 * Resolution pushes the player to `radius` away from each blocking wall along its normal (so crossing is
 * prevented and tangential motion is preserved — sliding).
 */
export interface MoveResult {
  readonly x: number;
  readonly y: number;
  readonly floorZ: number;
}

/**
 * Closest point to (`px`,`py`) on the segment a→b. `clamped` is true when the foot of the perpendicular
 * fell beyond an endpoint (the player is off the end of the segment) — the caller depenetrates differently
 * in that case, so a wall whose *infinite line* passes near the player but whose *segment* does not cannot
 * phantom-push.
 */
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

/** A sliding door blocks until it is at least this open (0..1) — below it, the panel still bars the way. */
export const SLIDE_OPEN = 0.7;

/** Does `line` block a player standing on floor `fromFloor` at (`fromX`,`fromY`)? `slides[lineIndex]` is a
 *  sliding door's openness (0 shut … 1 fully retracted); absent = shut. `crossSeams` opens PASSABLE
 *  zone-portal seams for this body (the player — the game swaps zones as he steps over the line). */
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
    // A PASSABLE live seam is an open doorway into the next zone — but only for a body allowed to
    // `crossSeams` (the player). Everyone else (enemies) keeps treating every seam as a solid wall:
    // entities never cross zones.
    return !(crossSeams && line.zonePortal?.passable === true);
  }
  if (line.sliding) {
    return (slides?.[lineIndex] ?? 0) < SLIDE_OPEN; // a sliding door bars the way until it is mostly open
  }
  if (line.glass) {
    return true; // a see-through glass wall (window / partition) still blocks the player
  }
  if (line.fence === true) {
    return true; // blocking furniture edge (counter / turnstile rail) — renders open, never crossable
  }

  const a = map.source.vertices[line.v1];
  const b = map.source.vertices[line.v2];
  const onFront = signedSide({ x: a.x, y: a.y, dx: b.x - a.x, dy: b.y - a.y }, fromX, fromY) < 0;
  const far = map.source.sectors[onFront ? line.back.sector : line.front.sector];

  return far.floorZ - fromFloor > stepMax || far.ceilZ - far.floorZ < headroom;
}

/** Move the player by (`dx`,`dy`) from (`x`,`y`), sliding off blocking walls; returns the resolved pose.
 *  With `crossSeams`, PASSABLE zone-portal seams stop blocking this body (see {@link isBlocking}) — the
 *  caller detects the line crossing and performs the zone swap. */
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

  // A few passes resolve corners (a push off one wall can press into another).
  for (let pass = 0; pass < 3; pass++) {
    for (const blk of blockers) {
      const cp = closestOnSeg(blk.ax, blk.ay, blk.bx, blk.by, px, py);

      if (cp.clamped) {
        // Off the end of this wall: only its CORNER can block, and only within the true radius — so a far
        // wall whose infinite line happens to run near us no longer shoves the player (the phantom push).
        const toX = px - cp.x;
        const toY = py - cp.y;
        const dist = Math.hypot(toX, toY);

        if (dist < radius && dist > 1e-6) {
          px = cp.x + (toX / dist) * radius;
          py = cp.y + (toY / dist) * radius;
        }
      } else {
        // Foot of the perpendicular is on the segment: push along the wall normal. Signed (not absolute) so
        // a player who has crossed through the line is pushed back out to the correct side.
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

/**
 * Classify a forward probe for an auto-MANTLE: from `(px,py)` standing on floor `fromZ`, look `reach` cells
 * along the UNIT direction `(dx,dy)`. Return the floor height to climb up to when the spot ahead is a
 * too-tall-but-climbable LEDGE — its floor rises by more than `stepMax` but at most `climbMax`, and it has
 * `headroom` to stand in — otherwise `null` (a normal step `movePlayer` already handles, open ground, or a
 * solid wall). A one-sided wall within `reach` makes it a true wall, never a ledge.
 */
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
    return null; // a solid one-sided wall blocks the probe — not a climbable ledge
  }
  const ahead =
    map.source.sectors[locateSubSector(map.root, px + dx * reach, py + dy * reach).sector];
  const rise = ahead.floorZ - fromZ;

  if (rise <= stepMax || rise > climbMax || ahead.ceilZ - ahead.floorZ < headroom) {
    return null; // a normal step / level ground, too tall to climb, or no room to stand at the top
  }

  return ahead.floorZ;
}

/** Where a pitched shot / flight line leaves the room VERTICALLY, as forward distance + world point. */
export interface FloorCeilHit {
  readonly dist: number;
  readonly x: number;
  readonly y: number;
  readonly z: number; // clamped to the surface it struck (its floorZ or ceilZ)
  readonly surface: 'floor' | 'ceil';
}

/**
 * March a pitched shot / projectile line — origin (`ox`,`oy`) at height `z0`, climbing `vSlope` per cell along
 * the UNIT direction (`dx`,`dy`) — and return where it first leaves the room vertically within `maxDist`:
 * dropping BELOW the floor (aimed at the ground, or into a step that rises above it) or rising ABOVE the
 * ceiling (aimed up, or into a closing door, since the door's live `ceilZ` is read here). Sampled every `step`
 * cells so a stepped floor stops the line at the step it meets — not the far wall, which is the caller's job
 * to cap `maxDist` with. Returns null when the line stays between floor and ceiling the whole way.
 *
 * This is what makes a downward shot land on the ground instead of sailing through it, and a shot at an
 * enemy on a low step strike the step rather than flying on under the world.
 *
 * `muzzle` is a grace distance the shot clears before floor/ceiling collision begins: a steep shot off a
 * raised platform would otherwise graze the platform's OWN floor at your feet, so the muzzle lets it clear the
 * lip and reach the lower ground beyond (targets, hit separately, are never affected — this only moves where a
 * shot bursts). For a projectile stepped frame-by-frame, pass the grace REMAINING after its travel so far.
 */
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
      continue; // still within the muzzle grace — let the shot clear the surface right in front of it
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
