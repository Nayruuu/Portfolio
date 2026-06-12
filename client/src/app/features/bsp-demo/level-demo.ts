import type { Level } from './level-accueil';
import { DEMO_MAP } from './demo-map';
// NOTE: enemies are TEMP-disabled below; re-add `import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC }
// from './enemies';` when restoring the enemy list.

/**
 * The engine-showcase courtyard (`demo-map.ts`) wrapped as a {@link Level} — the known-good map the demo plays
 * while L1 "Accueil" is being finished. (L1 compiles + is reachable, but its first render leaks; this keeps the
 * demo playable meanwhile. Swap the component's level import back to `ACCUEIL` once L1's render is fixed.)
 */
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
  // TEMP: the 5 ammo boxes lined up ahead of spawn (north of the barrel cluster, so the sight line is clear)
  // for inspection. Order = AMMO_BOX_SPECS: staples · nails · canisters (Hilti box) · cells · batteries.
  ammo: [
    [5, 11.5],
    [7, 11.5],
    [9, 11.5],
    [11, 11.5],
    [13, 11.5],
    [15, 11.5],
  ],
  // ammo (scattered): [3,11] [7,11] [16,8] [2,3] [13,1] [+1 for server_cell]
  keycard: [17.75, 1.75], // on the pedestal (+1.6)
  exit: [40, 7], // in the sunken hall (−2.7)
  door: { sector: 7, triggerX: 19, triggerY: 4.5, requiresCard: true }, // the east-annex corridor
};
