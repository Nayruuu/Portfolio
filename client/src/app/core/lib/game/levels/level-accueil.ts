import type { Level } from '../level';
import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC } from '../enemy';
import { MapBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';

// L1 "Accueil" — worked-example campaign level. Winding: front = the sector to the RIGHT of v1→v2; shared
// edges are emitted ONCE as portals. The badge dais is a +1.6 mantle ledge, the atrium a −0.8 sunken step.

function buildMap(): { map: MapSource; doorSector: number } {
  const b = new MapBuilder();

  const R = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 });
  const LOBBY = b.sector({ floorZ: 0, ceilZ: 5, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 212 });
  const CRL = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 180 });
  const CLC = b.sector({ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 180 });
  const CUB = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 198 });
  const KD = b.sector({ floorZ: 1.6, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 228 }); // badge dais (mantle)
  const DOOR = b.sector({ floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 190 });
  const ATR = b.sector({ floorZ: -0.8, ceilZ: 6, floorTex: 'METAL', ceilTex: 'CEIL', light: 232 });

  // shared edges (each emitted ONCE as a portal; front = sector on the right of v1→v2)
  b.portal(14, 9, 14, 6, R, CRL);
  b.portal(18, 9, 18, 6, CRL, LOBBY);
  b.portal(22, 16, 26, 16, LOBBY, CLC);
  b.portal(22, 20, 26, 20, CLC, CUB);
  b.portal(32, 11, 32, 8, LOBBY, DOOR);
  b.portal(34, 8, 34, 11, ATR, DOOR);
  b.portal(23, 25, 23, 29, KD, CUB);
  b.portal(23, 29, 27, 29, KD, CUB);
  b.portal(27, 29, 27, 25, KD, CUB);
  b.portal(27, 25, 23, 25, KD, CUB);

  // one-sided walls (interior on the right)
  b.solid(2, 2, 2, 12, R);
  b.solid(2, 12, 14, 12, R);
  b.solid(14, 12, 14, 9, R);
  b.solid(14, 6, 14, 2, R);
  b.solid(14, 2, 2, 2, R);
  b.solid(14, 9, 18, 9, CRL);
  b.solid(18, 6, 14, 6, CRL);
  b.solid(18, 2, 18, 6, LOBBY);
  b.solid(18, 9, 18, 16, LOBBY);
  b.solid(18, 16, 22, 16, LOBBY);
  b.solid(26, 16, 32, 16, LOBBY);
  b.solid(32, 16, 32, 11, LOBBY);
  b.solid(32, 8, 32, 2, LOBBY);
  b.solid(32, 2, 18, 2, LOBBY);
  b.solid(22, 16, 22, 20, CLC);
  b.solid(26, 20, 26, 16, CLC);
  b.solid(32, 20, 26, 20, CUB);
  b.solid(22, 20, 18, 20, CUB);
  b.solid(18, 20, 18, 32, CUB);
  b.solid(18, 32, 32, 32, CUB);
  b.solid(32, 32, 32, 20, CUB);
  b.solid(32, 11, 34, 11, DOOR);
  b.solid(34, 8, 32, 8, DOOR);
  b.solid(34, 6, 34, 8, ATR);
  b.solid(34, 11, 34, 12, ATR);
  b.solid(34, 12, 39, 17, ATR);
  b.solid(39, 17, 49, 17, ATR);
  b.solid(49, 17, 54, 12, ATR);
  b.solid(54, 12, 54, 6, ATR);
  b.solid(54, 6, 49, 1, ATR);
  b.solid(49, 1, 39, 1, ATR);
  b.solid(39, 1, 34, 6, ATR);

  b.thing(5, 7, 0, 'player_start');
  b.thing(28, 4, 0, 'barrel');
  b.thing(20, 14, 0, 'barrel');

  return { map: b.build(), doorSector: DOOR };
}

const built = buildMap();

export const ACCUEIL: Level = {
  map: built.map,
  spawn: { x: 5, y: 7, angle: 0 },
  enemies: [
    { spec: IMP_SPEC, x: 24, y: 6 },
    { spec: IMP_SPEC, x: 28, y: 12 },
    { spec: PINKY_SPEC, x: 24, y: 18 },
    { spec: SHOTGUNGUY_SPEC, x: 25, y: 23 },
    { spec: LOSTSOUL_SPEC, x: 44, y: 9 },
  ],
  health: [
    [8, 10],
    [44, 13],
  ],
  armor: [[20, 30]],
  ammo: [
    [22, 4], // staples
    [30, 30], // nails
    [40, 5], // canisters
    [12, 5], // cells
    [50, 9], // batteries
    [44, 5], // server cell
  ],
  weapons: [
    [7, 7, 'pistol'],
    [10, 7, 'shotgun'],
  ],
  keycards: [[25, 27, 'red']], // on the dais top (+1.6)
  exit: [49, 9],
  doors: [{ sector: built.doorSector, triggerX: 31, triggerY: 9.5, requiresCard: 'red' }],
};
