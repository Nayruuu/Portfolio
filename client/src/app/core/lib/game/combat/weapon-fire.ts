// core/lib/game/combat/weapon-fire — the player's FIRING resolution, extracted from the BSP-game shell. Given
// the weapon's derived {@link WeaponCombat} and one {@link PlayerCombatFrame}, it either LAUNCHES a travelling
// projectile (into the shared pool the stepper drains), fans a shotgun spread, or resolves an instant hitscan
// ray — widened by the weapon's cone both horizontally and VERTICALLY (the aim line rises/falls with the
// pitch). The firing DECISION (inventory / magazine / ammo) stays in the shell; this is the shot's geometry.
// The engine deps (`castRay` / `castFloorCeil` / `nearestTargetHit`) are core → core.

import { castFloorCeil, castRay, nearestTargetHit } from '../../bsp-engine';
import { MUZZLE_CLEAR, PROJECTILE_SPAWN_AHEAD } from '../combat-constants';
import type { WeaponCombat } from '../types';
import { collectHittables } from './hittables';
import type { PlayerCombatFrame } from './player-combat-frame';

/** Fire the active weapon along the crosshair: a projectile weapon LAUNCHES a travelling shot (straight, no
 *  cone); every other kind resolves an instant hitscan ray widened by the weapon's `cone`. */
export function fireWeapon(frame: PlayerCombatFrame, combat: WeaponCombat): void {
  const dx = Math.cos(frame.angle);
  const dy = Math.sin(frame.angle);

  if (combat.projectile !== null) {
    const width = frame.projectileWidth(combat.projectile.kind);

    if (width !== undefined) {
      const vSlope = frame.vSlope; // the firing pitch → the shot's vertical climb per cell

      frame.projectiles.push({
        x: frame.cameraX + dx * PROJECTILE_SPAWN_AHEAD, // close, so the shot leaves from the gun
        y: frame.cameraY + dy * PROJECTILE_SPAWN_AHEAD,
        z: frame.cameraZ + vSlope * PROJECTILE_SPAWN_AHEAD, // on the aim line at the spawn point
        dx,
        dy,
        vSlope,
        speed: combat.projectile.speed,
        kind: combat.projectile.kind,
        impactKind: combat.impactKind,
        damage: combat.damage,
        radius: width / 2,
        splashR: combat.projectile.splashRadius,
        chain: combat.projectile.chain,
        traveled: 0,
        alive: true,
      });
    }

    return;
  }
  if (combat.pellets > 1) {
    fireSpread(frame, combat); // a shotgun: a fan of pellets across the cone

    return;
  }
  resolveHitscan(frame, dx, dy, combat.cone, combat.range, combat.impactKind, combat.damage);
}

/** A shotgun blast: `pellets` tight rays fanned evenly across ±`cone`, each culling the nearest barrel it
 *  crosses within range (a centred barrel eats several pellets). */
export function fireSpread(frame: PlayerCombatFrame, combat: WeaponCombat): void {
  for (let pellet = 0; pellet < combat.pellets; pellet++) {
    const fraction = combat.pellets === 1 ? 0.5 : pellet / (combat.pellets - 1);
    const angle = frame.angle + (-combat.cone + 2 * combat.cone * fraction);

    resolveHitscan(
      frame,
      Math.cos(angle),
      Math.sin(angle),
      0,
      combat.range,
      combat.impactKind,
      combat.damage,
    );
  }
}

/** Resolve an instant hitscan ray along `(dx, dy)`, capped at the weapon's `range` (so a fist reaches only as
 *  far as its reach) AND the first wall, culling the nearest target within `cone` — both horizontally and
 *  VERTICALLY (the aim line rises/falls with the pitch, so a shot over/under a target misses). Returns whether
 *  it hit (so a shotgun blast can tally its pellets). */
export function resolveHitscan(
  frame: PlayerCombatFrame,
  dx: number,
  dy: number,
  cone: number,
  range: number,
  impactKind: string,
  damage: number,
): boolean {
  const vSlope = frame.vSlope; // how much the aim line climbs per cell of depth (from the pitch)
  const wall = castRay(frame.map, frame.cameraX, frame.cameraY, dx, dy, range);
  const reach = wall === null ? range : wall.dist;
  // The aim line can leave the room through the floor/ceiling before the wall — a downward shot sparks on the
  // ground, an upward one on the ceiling, rather than on a wall it never visually reaches. The muzzle grace
  // lets a steep shot off a raised platform clear its own lip instead of sparking at the shooter's feet.
  const ground = castFloorCeil(
    frame.map,
    frame.cameraX,
    frame.cameraY,
    dx,
    dy,
    frame.cameraZ,
    vSlope,
    reach,
    undefined,
    MUZZLE_CLEAR,
  );
  const targetReach = ground === null ? reach : Math.min(reach, ground.dist);
  const hittables = collectHittables(frame);
  const hit = nearestTargetHit(
    frame.cameraX,
    frame.cameraY,
    dx,
    dy,
    targetReach,
    hittables.map((h) => h.target),
    cone,
    frame.cameraZ,
    vSlope,
  );

  if (hit !== null) {
    const h = hittables[hit.index];

    h.hit(damage);
    frame.addImpact(impactKind, h.x, h.y, h.z);
  } else if (ground !== null) {
    frame.addImpact(impactKind, ground.x, ground.y, ground.z); // sparks on the floor/ceiling
  } else if (wall !== null) {
    frame.addImpact(impactKind, wall.x, wall.y, frame.cameraZ + vSlope * reach); // sparks on the wall
  }

  return hit !== null;
}
