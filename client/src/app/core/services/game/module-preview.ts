import { generateLevel, parseModule, THEME_CYCLE, type Level, type ModuleDef } from '../../lib';

/**
 * TEMPORARY (B1): turn ONE prefab module into a renderable `Level` so a hand-made module can be eyeballed
 * live with its heights + content. Reuses a generated level for the theme + valid floor/ceil flat ids (the
 * parser leaves sector materials as placeholders); revert before shipping — the real path is the B2 slot-grid
 * assembler.
 */
export function moduleToLevel(def: ModuleDef): Level {
  const m = parseModule(def);
  const base = generateLevel(1, THEME_CYCLE[0], 0);
  const floorId = base.floorFlats[0];
  const ceilId = base.ceilFlats.find((id) => id > 0)!;
  const sectors = m.sectors.map((sector) => ({ ...sector, floorMat: floorId, ceilMat: ceilId }));

  return {
    map: {
      width: m.width,
      height: m.height,
      cells: m.cells,
      diagonals: m.diagonals,
      sectors,
      sectorId: m.sectorId,
    },
    floorFlats: m.cells.map(() => floorId),
    ceilFlats: m.cells.map(() => ceilId),
    spawn: { x: (m.spawn?.x ?? 1) + 0.5, y: (m.spawn?.y ?? 1) + 0.5, z: 0, dir: Math.PI / 2 },
    enemies: m.enemies.map((enemy) => ({
      x: enemy.x + 0.5,
      y: enemy.y + 0.5,
      dir: 0,
      state: 'alive' as const,
      deathTime: 0,
      hp: 4,
      fireCooldown: 2,
      hitFlash: 0,
      windup: 0,
      kind: enemy.kind,
    })),
    pickups: m.pickups.map((pickup) => ({
      x: pickup.x + 0.5,
      y: pickup.y + 0.5,
      kind: pickup.kind,
    })),
    ammoSpawns: m.ammo.map((box) => ({ x: box.x + 0.5, y: box.y + 0.5, pickupId: box.pickupId })),
    keys: m.keycards.map((key) => ({ x: key.x + 0.5, y: key.y + 0.5, color: key.color })),
    theme: base.theme,
  };
}
