import { castFloorCeil, castRay, nearestTargetHit } from '../../bsp-engine';
import { MUZZLE_CLEAR, PROJECTILE_SPAWN_AHEAD } from '../game-tuning';
import type { WeaponCombat } from '../types';
import { collectHittables } from './hittables';
import type { PlayerCombatFrame } from './player-combat-frame';

export function fireWeapon(frame: PlayerCombatFrame, combat: WeaponCombat): void {
  const dx = Math.cos(frame.angle);
  const dy = Math.sin(frame.angle);

  if (combat.projectile !== null) {
    const width = frame.projectileWidth(combat.projectile.kind);

    if (width !== undefined) {
      const vSlope = frame.vSlope;

      frame.projectiles.push({
        x: frame.cameraX + dx * PROJECTILE_SPAWN_AHEAD,
        y: frame.cameraY + dy * PROJECTILE_SPAWN_AHEAD,
        z: frame.cameraZ + vSlope * PROJECTILE_SPAWN_AHEAD,
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
    fireSpread(frame, combat);

    return;
  }
  resolveHitscan(frame, dx, dy, combat.cone, combat.range, combat.impactKind, combat.damage);
}

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

export function resolveHitscan(
  frame: PlayerCombatFrame,
  dx: number,
  dy: number,
  cone: number,
  range: number,
  impactKind: string,
  damage: number,
): boolean {
  const vSlope = frame.vSlope;
  const wall = castRay(frame.map, frame.cameraX, frame.cameraY, dx, dy, range);
  const reach = wall === null ? range : wall.dist;
  // muzzle grace lets a steep shot off a raised platform clear its own lip
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
    frame.addImpact(impactKind, ground.x, ground.y, ground.z);
  } else if (wall !== null) {
    frame.addImpact(impactKind, wall.x, wall.y, frame.cameraZ + vSlope * reach);
  }

  return hit !== null;
}
