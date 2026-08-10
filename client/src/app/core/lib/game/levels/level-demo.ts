import type { Level } from '../level';
import { DEMO_MAP } from './demo-map';
// NOTE: enemies are TEMP-disabled below; re-add `import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC }
// from '../enemy';` when restoring the enemy list.

export const DEMO_LEVEL: Level = {
  map: DEMO_MAP,
  spawn: { x: 2, y: 10, angle: 0 },
  // TEMP: enemies disabled so the ammo/pickups can be inspected in peace. Restore the list below when done.
  enemies: [],
  // enemies: [
  //   { spec: PINKY_SPEC, x: 2, y: 4 },
  //   { spec: PINKY_SPEC, x: 9, y: 11 },
  //   { spec: SHOTGUNGUY_SPEC, x: 18, y: 5 },
  //   { spec: SHOTGUNGUY_SPEC, x: 13, y: 11 },
  //   { spec: IMP_SPEC, x: 6, y: 2 },
  //   { spec: IMP_SPEC, x: 16, y: 10 },
  //   { spec: LOSTSOUL_SPEC, x: 5, y: 9 },
  //   { spec: LOSTSOUL_SPEC, x: 12, y: 8 },
  // ],
  health: [
    [2, 6],
    [11, 11],
    [18, 7],
  ],
  armor: [
    [8, 1],
    [14, 10],
  ],
  // TEMP inspection row — order = AMMO_BOX_SPECS: staples · nails · canisters · cells · batteries · server-cell
  ammo: [
    [5, 11.5],
    [7, 11.5],
    [9, 11.5],
    [11, 11.5],
    [13, 11.5],
    [15, 11.5],
  ],
  weapons: [
    [3, 11, 'pistol'],
    [4.5, 11, 'shotgun'],
  ],
  keycards: [[17.75, 1.75, 'red']],
  exit: [40, 7],
  doors: [{ sector: 7, triggerX: 19, triggerY: 4.5, requiresCard: 'red' }],
};
