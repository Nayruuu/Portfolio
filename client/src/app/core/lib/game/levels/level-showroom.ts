import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { rect } from './poly';

// SHOWROOM — the dev inspection gallery (URL-only, ?level=showroom): every decor prop, pickup and weapon
// laid out in rows under bright light, ZERO enemies. The eyeball bench for art/mesh/voxel work.

function buildMap(): MapSource {
  const b = new RoomBuilder();

  const HALL = b.room(rect(2, 2, 50, 24), {
    floorZ: 0,
    ceilZ: 4.5,
    floorTex: 'MARBLE',
    ceilTex: 'CEIL_LUX',
    light: 235,
    wallTex: 'LOBBY',
  });

  // one mantle island (z1.3) — verifies climbing + a prop rendered on raised ground
  b.island(HALL, rect(38, 8, 46, 14), {
    floorZ: 1.3,
    ceilZ: 4.5,
    floorTex: 'STEP',
    ceilTex: 'CEIL_LUX',
    light: 235,
    wallTex: 'WOOD',
  });

  b.thing(26, 17, Math.PI * 1.5, 'player_start');

  // decor row (north wall) — varied angles so rotation cells/volumes are inspectable by strafing
  b.thing(6, 6, 0, 'barrel');
  b.thing(10, 6, 0, 'prop');
  b.thing(14, 6, 0.9, 'prop_screen');
  b.thing(18, 6, 0.5, 'prop_totem');
  b.thing(26, 6, 0.9, 'prop_chair');
  b.thing(34, 6, 5.8, 'prop_board');
  b.thing(38, 6, 0, 'prop_cooler');
  b.thing(41, 15.5, 3.6, 'prop_chair'); // beside the island — chair at ground level next to raised ground

  return b.build();
}

export const SHOWROOM: Level = {
  map: buildMap(),
  spawn: { x: 26, y: 17, angle: Math.PI * 1.5 },
  enemies: [],
  health: [
    [6, 12],
    [9, 12, 'small'],
  ],
  armor: [
    [12, 12],
    [15, 12, 'small'],
  ],
  ammo: [
    [6, 15],
    [9, 15],
    [12, 15],
    [15, 15],
    [18, 15],
    [21, 15],
  ],
  weapons: [
    [6, 18, 'chainsaw'],
    [9, 18, 'pistol'],
    [12, 18, 'shotgun'],
    [15, 18, 'chaingun'],
    [18, 18, 'rocket'],
    [21, 18, 'plasma'],
    [24, 18, 'bfg'],
  ],
  keycards: [
    [18, 12, 'blue'],
    [21, 12, 'yellow'],
    [24, 12, 'red'],
  ],
  exit: [48, 22],
  doors: [],
};
