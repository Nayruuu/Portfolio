import { describe, it, expect } from 'vitest';
import { moduleToLevel } from './module-preview';
import type { ModuleDef } from '../../lib';
import { isWall } from '../../lib';

/** A content-rich module exercising every adapter branch: spawn, all entity kinds, and a raised sector. */
const RICH: ModuleDef = {
  name: 'rich',
  role: 'arena',
  layout: `#####
           #SAE#
           #PK1#
           ##X##`,
  legend: { '1': { floorZ: 0.3 } },
};

describe('moduleToLevel', () => {
  it('renders a module into a valid Level with theme + flat ids and a spawn on open floor', () => {
    const level = moduleToLevel(RICH);

    expect(level.map.width).toBe(5);
    expect(level.theme).toBeDefined();
    expect(level.floorFlats).toHaveLength(level.map.cells.length);
    expect(level.ceilFlats).toHaveLength(level.map.cells.length);
    expect(level.map.sectors!.every((s) => s.floorMat >= 0 && s.ceilMat >= 0)).toBe(true);
    expect(isWall(level.map, level.spawn.x, level.spawn.y)).toBe(false);
  });

  it('maps every content marker into the matching Level entity (offset to cell centres)', () => {
    const level = moduleToLevel(RICH);

    expect(level.enemies).toHaveLength(1);
    expect(level.enemies[0]).toMatchObject({ x: 3.5, y: 1.5, kind: 'manager', state: 'alive' });
    expect(level.pickups).toContainEqual({ x: 1.5, y: 2.5, kind: 'health' });
    expect(level.ammoSpawns).toContainEqual({ x: 2.5, y: 1.5, pickupId: 'box_staples' });
    expect(level.keys).toContainEqual({ x: 2.5, y: 2.5, color: 'red' });
  });

  it('falls back to (1,1) when the module has no spawn marker', () => {
    const level = moduleToLevel({ name: 'no-spawn', role: 'side', layout: `###\n#.#\n###` });

    expect(level.spawn).toMatchObject({ x: 1.5, y: 1.5 });
  });
});
