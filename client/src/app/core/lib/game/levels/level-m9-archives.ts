import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC, KNIGHT_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M9 "Archives condamnées" — the secret derelict floor off M3's condemned-archives stub. Light LIES here:
// NEON pools mark ambushes, the true path is dim and marked by raised STEP threshold strips. y grows DOWN.

const DERELICT = { floorZ: 0, floorTex: 'SLAB', ceilTex: 'CEIL_DAMAGED' };
const RAISED = { floorZ: 1.0, floorTex: 'SLAB', ceilTex: 'CEIL_DAMAGED' };

function buildMap(): { map: MapSource; closetDoorSector: number } {
  const b = new RoomBuilder();

  const LIFT = b.room(poly([18, 4, 34, 4, 38, 8, 38, 16, 14, 16, 14, 8]), {
    ...DERELICT,
    ceilZ: 3.2,
    ceilTex: 'NEON', // the green freight-lift glow — anchor 1, visible from the maze's north junctions
    light: 120,
    wallTex: 'DAMAGED',
    walls: { 0: 'ELEVATOR' },
  });

  const REG = b.room(poly([14, 16, 38, 16, 44, 22, 44, 32, 36, 38, 20, 38, 10, 32, 10, 22]), {
    ...DERELICT,
    ceilZ: 4.4,
    light: 100,
    wallTex: 'DAMAGED',
  });

  b.connect(LIFT, REG, { at: [21, 16, 31, 16], tex: 'DAMAGED' });
  b.island(REG, poly([20, 22, 30, 20, 34, 26, 28, 32, 20, 30]), {
    floorZ: -0.8, // the reading pit — E1's melee bowl, walk-out on every side
    ceilZ: 4.4,
    floorTex: 'STEP',
    ceilTex: 'CEIL_DAMAGED',
    light: 100,
    wallTex: 'DAMAGED',
  });
  // Collapsed stack shielding the E7 drop-landing pack from the lift entrance sightline.
  b.hole(REG, poly([14, 21, 18, 22, 17, 25, 13.5, 24]), 'METAL');

  const stacks = { ceilZ: 2.8, light: 75, wallTex: 'DAMAGED' };
  const WSTACKS = b.room(poly([14, 38, 36, 38, 33, 50, 36, 64, 26, 64, 10, 58, 10, 44]), {
    ...DERELICT,
    ...stacks,
  });

  b.connect(REG, WSTACKS, { at: [24, 38, 29, 38], tex: 'DAMAGED' });

  // Rotated variants of one trapezoid shelf module — the repeated geometry that disorients.
  b.hole(WSTACKS, poly([13, 42, 19, 42.5, 18.5, 44.5, 13, 44]), 'METAL');
  b.hole(WSTACKS, poly([21.5, 44.5, 27.5, 44, 28, 46, 22, 46.5]), 'METAL');
  b.hole(WSTACKS, poly([12, 49, 18, 48.5, 18.5, 50.5, 12.5, 51]), 'METAL');
  b.hole(WSTACKS, poly([21, 51.5, 26, 53.5, 25, 55.5, 20, 53.5]), 'METAL');
  b.hole(WSTACKS, poly([27.5, 48.5, 30.5, 48, 31, 50, 28, 50.5]), 'METAL');
  b.hole(WSTACKS, poly([14, 55, 20, 55.5, 19.5, 57.5, 13.5, 57]), 'METAL');

  // Light lies: NEON pools are the BRIGHT sectors and host the ambushes (E2 in P0, health bait in P1).
  const pool = { floorTex: 'SLAB', ceilTex: 'NEON', light: 175, wallTex: 'DAMAGED' };

  b.island(WSTACKS, poly([24.5, 40.5, 27.5, 40, 29, 41.5, 27.5, 43.3, 25, 43]), {
    ...pool,
    floorZ: 0,
    ceilZ: 2.8,
  });
  b.island(WSTACKS, poly([22, 58, 25, 57.5, 26.5, 59, 25, 60.8, 22.5, 60.5]), {
    ...pool,
    floorZ: 0,
    ceilZ: 2.8,
  });
  // True-path tell: dim raised STEP threshold strips at the honest junctions.
  const strip = { floorZ: 0.05, ceilZ: 2.8, floorTex: 'STEP', ceilTex: 'CEIL_DAMAGED', light: 95 };

  b.island(WSTACKS, rect(24.5, 38.3, 28.5, 38.9), { ...strip, wallTex: 'METAL' });
  b.island(WSTACKS, rect(28, 62.5, 31, 63.1), { ...strip, wallTex: 'METAL' });
  b.island(WSTACKS, rect(31.5, 42.5, 32.5, 44.5), { ...strip, wallTex: 'METAL' });

  const shaft = { ceilZ: 4.6, wallTex: 'DAMAGED' };
  const ENORTH = b.room(poly([36, 38, 44, 32, 58, 32, 58, 34, 54, 34, 54, 42, 40, 56, 33, 50]), {
    ...RAISED,
    ...shaft,
    light: 90,
  });

  b.connect(REG, ENORTH, { at: [38.4, 36.2, 41.6, 33.8], tex: 'DAMAGED' });
  b.connect(WSTACKS, ENORTH, { at: [35.1, 41.6, 34.2, 45.2], tex: 'DAMAGED' }); // step line C1 (+1.0)
  b.hole(ENORTH, poly([40, 41, 46, 41.5, 45.5, 43.5, 40, 43]), 'METAL');
  b.hole(ENORTH, poly([44, 44, 49, 42.5, 49.8, 44.5, 44.8, 46]), 'METAL');
  b.hole(ENORTH, poly([38, 46, 43, 48, 42, 50, 37, 48]), 'METAL');
  b.island(ENORTH, poly([46, 37, 49, 36.2, 51, 38, 49.5, 40, 46.5, 39.6]), {
    ...pool,
    floorZ: 1.0,
    ceilZ: 4.6,
  });

  const ESOUTH = b.room(
    poly([33, 50, 40, 56, 42, 58, 56, 44, 58, 44, 58, 52, 50, 62, 44, 66, 36, 64]),
    { ...RAISED, ...shaft, light: 80 },
  );

  b.connect(WSTACKS, ESOUTH, { at: [34.05, 54.9, 34.8, 58.4], tex: 'DAMAGED' }); // step line C2 (+1.0)
  b.connect(ENORTH, ESOUTH, { at: [35.45, 52.1, 38.25, 54.5], tex: 'DAMAGED' });
  b.hole(ESOUTH, poly([48, 54, 53, 55, 52, 57, 47, 56]), 'METAL');

  // The catwalk shaft — the designed RELEASE: the maze finally read from above, behind fence rails.
  const CAT = b.room(poly([40, 56, 54, 42, 54, 37, 58, 37, 58, 44, 56, 44, 42, 58]), {
    floorZ: 2.2,
    ceilZ: 4.6,
    floorTex: 'GRATING',
    ceilTex: 'TECHNICAL',
    light: 110,
    wallTex: 'METAL',
  });
  const SSTEP = b.stairs([58, 34], [54, 34], {
    depth: 1,
    count: 3,
    zBase: 1.0,
    dz: 0.4,
    ceilZ: 4.6,
    light: 130,
    wallTex: 'METAL',
    ceilTex: 'TECHNICAL',
  });

  b.connect(ENORTH, SSTEP[0], { tex: 'METAL' });
  b.connect(CAT, SSTEP[2], { tex: 'METAL' });
  b.connect(ENORTH, CAT, { kind: 'fence', tex: 'METAL' });
  b.connect(ESOUTH, CAT, { at: [40, 56, 42, 58], tex: 'METAL' }); // the broken end — onto the rubble mound
  b.connect(ESOUTH, CAT, { kind: 'fence', at: [42, 58, 56, 44], tex: 'METAL' });
  b.connect(ESOUTH, CAT, { kind: 'fence', at: [56, 44, 58, 44], tex: 'METAL' });

  // S2 "Overlook cache": mound 1.3 above the maze, cache 1.2 above the mound — 3.5 clears the 2.4
  // direct-mantle ceiling from the floor, so the chain (or the catwalk end) is the only way up.
  const MOUND = b.island(ESOUTH, poly([39.7, 56.3, 41.9, 58.5, 40.8, 59.6, 38.6, 57.4]), {
    floorZ: 2.3,
    ceilZ: 4.6,
    floorTex: 'STEP',
    ceilTex: 'CEIL_DAMAGED',
    light: 100,
    wallTex: 'DAMAGED',
  });

  b.island(MOUND, poly([40, 57.2, 41.3, 58.5, 40.5, 59.3, 39.2, 58]), {
    floorZ: 3.5,
    ceilZ: 4.6,
    floorTex: 'STEP',
    ceilTex: 'CEIL_DAMAGED',
    light: 140,
    wallTex: 'METAL',
  });

  // Secret 1 — microfiche closet. Tell: one intact CUBICLE panel among DAMAGED + the light-leak strip.
  const SDOOR = b.room(rect(58, 46, 60, 49), {
    floorZ: 1.0,
    ceilZ: 3.0,
    floorTex: 'CARPET',
    ceilTex: 'CEIL_DAMAGED',
    light: 140,
    wallTex: 'CUBICLE',
  });

  b.connect(ESOUTH, SDOOR, { tex: 'CUBICLE' });
  b.island(ESOUTH, rect(57.3, 46, 57.9, 49), {
    floorZ: 1.05,
    ceilZ: 4.6,
    floorTex: 'CARPET',
    ceilTex: 'CEIL_DAMAGED',
    light: 235,
    wallTex: 'METAL',
  });
  const CLOSET = b.room(rect(60, 44, 65, 52), {
    floorZ: 1.0,
    ceilZ: 3.0,
    floorTex: 'CARPET',
    ceilTex: 'CEIL_DAMAGED',
    light: 140,
    wallTex: 'CUBICLE',
  });

  b.connect(SDOOR, CLOSET, { tex: 'CUBICLE' });

  const ANTE = b.room(poly([26, 64, 36, 64, 36, 72, 28, 72]), {
    floorZ: -0.6,
    ceilZ: 3.4,
    floorTex: 'SLAB',
    ceilTex: 'CEIL_DAMAGED',
    light: 70, // anchor 2: the vault shaft's 200 leaks through the opening below
    wallTex: 'DAMAGED',
  });

  b.connect(WSTACKS, ANTE, { at: [27, 64, 33, 64], tex: 'DAMAGED' });

  const VAULT = b.room(poly([20, 72, 40, 72, 46, 78, 46, 92, 38, 96, 22, 96, 14, 92, 14, 78]), {
    floorZ: -1.2,
    ceilZ: 4.8,
    floorTex: 'SLAB',
    ceilTex: 'CEIL_DAMAGED',
    light: 90,
    wallTex: 'DAMAGED',
    walls: { 4: 'LOBBY' }, // the buried fragment of the tower's ORIGINAL lobby
  });

  b.connect(ANTE, VAULT, { at: [29, 72, 35, 72], tex: 'DAMAGED' });
  b.hole(VAULT, rect(19, 79, 22, 82), 'PILLAR_LOBBY');
  b.hole(VAULT, rect(38, 79, 41, 82), 'PILLAR_LOBBY');
  b.island(VAULT, poly([27, 80, 33, 80, 35, 83, 33, 86, 27, 86, 25, 83]), {
    floorZ: -0.7, // the PX-1 dais under the light shaft
    ceilZ: 4.8,
    floorTex: 'STEP',
    ceilTex: 'CEIL_DAMAGED',
    light: 200,
    wallTex: 'LOBBY',
  });
  b.island(VAULT, rect(24, 90, 36, 95), {
    floorZ: -1.2,
    ceilZ: 4.8,
    floorTex: 'MARBLE',
    ceilTex: 'CEIL_DAMAGED',
    light: 110,
    wallTex: 'LOBBY',
  });

  const VBASE = b.room(rect(6, 88, 14, 92), {
    floorZ: -1.2,
    ceilZ: 3.4,
    floorTex: 'SLAB',
    ceilTex: 'CEIL_DAMAGED',
    light: 110,
    wallTex: 'DAMAGED',
  });

  b.connect(VAULT, VBASE, { tex: 'DAMAGED' });
  const RSTAIR = b.stairs([6, 88], [10, 88], {
    depth: 1,
    count: 10,
    zBase: -1.2,
    dz: 0.4,
    ceilZ: 5.4,
    light: 120,
    wallTex: 'DAMAGED',
    ceilTex: 'CEIL_DAMAGED',
  });

  b.connect(VBASE, RSTAIR[0], { tex: 'DAMAGED' });
  const LEDGE = b.room(rect(6, 24, 10, 78), {
    floorZ: 2.8, // one-way return: 2.8 > the 2.4 mantle ceiling — the drop into REG can't be climbed back
    ceilZ: 5.4,
    floorTex: 'SLAB',
    ceilTex: 'CEIL_DAMAGED',
    light: 130,
    wallTex: 'DAMAGED',
  });

  b.connect(LEDGE, RSTAIR[9], { tex: 'DAMAGED' });
  b.connect(LEDGE, REG, { at: [10, 25, 10, 31], tex: 'DAMAGED' });

  b.thing(26, 9, Math.PI / 2, 'player_start');
  // Barricade of barrels at the dead lift — the floor the tower sealed off.
  b.thing(35, 13, 0, 'barrel');
  b.thing(36, 14.2, 0, 'barrel');
  b.thing(16.5, 13.5, 0.5, 'prop_totem');
  b.thing(32, 30.5, 2.4, 'prop_screen');
  b.thing(30, 35, 0, 'barrel');
  b.thing(16, 35, 0, 'barrel');
  b.thing(30, 45.5, 0, 'barrel');
  b.thing(13, 46.5, 0, 'barrel');
  b.thing(34, 60, 0, 'barrel');
  b.thing(18, 46.8, 1.2, 'prop_chair');
  b.thing(45, 62, 5.5, 'prop_board');
  b.thing(57, 45.2, 0, 'prop_cooler');
  b.thing(50, 47.5, 0, 'barrel');
  b.thing(27.5, 66, 0, 'barrel');
  b.thing(18, 88, 0, 'barrel');
  b.thing(19.3, 89.2, 0, 'barrel');
  b.thing(30, 94, 4.71, 'prop_screen');
  b.thing(43.5, 84, 3.6, 'prop_totem');
  b.thing(63.5, 50.8, 2.6, 'prop_chair');
  b.thing(8, 40, 0, 'barrel');
  b.thing(8.5, 41.5, 0, 'barrel');
  b.thing(7, 91.2, 0, 'barrel');

  return { map: b.build(), closetDoorSector: SDOOR };
}

const built = buildMap();

export const M9_ARCHIVES: Level = {
  map: built.map,
  spawn: { x: 26, y: 9, angle: Math.PI / 2 },
  enemies: [
    // E1 — reading pit
    { spec: PINKY_SPEC, x: 24, y: 25 },
    { spec: PINKY_SPEC, x: 27, y: 27 },
    // E2 — first lit pool (the light lies)
    { spec: LOSTSOUL_SPEC, x: 26, y: 41.5 },
    { spec: LOSTSOUL_SPEC, x: 28, y: 42 },
    // E3 — shelving-gap choke at C1; the imp holds its lane FROM the lit pool on the raised half
    // (every NEON pool must carry a threat, or the floor's own "bright = ambush" rule teaches a lie)
    { spec: SHOTGUNGUY_SPEC, x: 36.5, y: 44 },
    { spec: IMP_SPEC, x: 48, y: 38 },
    // E4 — topping the shelf-stair onto the catwalk
    { spec: LOSTSOUL_SPEC, x: 56, y: 41.5 },
    { spec: IMP_SPEC, x: 48, y: 49.5 },
    // E5 — the nails-bait ambush, retreat lane north stays open
    { spec: LOSTSOUL_SPEC, x: 15, y: 53.5 },
    { spec: LOSTSOUL_SPEC, x: 16, y: 58.5 },
    { spec: PINKY_SPEC, x: 19, y: 58.8 },
    // E6 — vault climax, guards read from the antechamber steps
    { spec: KNIGHT_SPEC, x: 30, y: 91 },
    { spec: SHOTGUNGUY_SPEC, x: 20.5, y: 83.5 },
    { spec: SHOTGUNGUY_SPEC, x: 39.5, y: 83.5 },
    // E7 — the drop landing, seen from the ledge BEFORE committing
    { spec: SHOTGUNGUY_SPEC, x: 13, y: 28 },
    { spec: LOSTSOUL_SPEC, x: 12.5, y: 24.5 },
  ],
  health: [
    [24, 59.2, 'small'],
    [9, 90],
  ],
  armor: [[62.5, 50]],
  ammo: [
    [33, 20], // staples
    [11.5, 53], // nails — the E5 bait in the dead-end alcove
    [62.5, 46.5], // canisters
    [40.25, 58.25], // cells — S2 cache
    [26, 92.5], // batteries
    [34, 92.5], // server-cell
  ],
  weapons: [[30, 83, 'plasma']], // the PX-1 prototype on the dais — a repeat pickup (ammo top-up)
  keycards: [], // badge-free: the secret floor gates by geometry, not clearance
  entries: {
    main: { x: 26, y: 9, angle: Math.PI / 2 },
    'from-m3': { x: 26, y: 9, angle: Math.PI / 2 },
  },
  exits: [{ x: 26, y: 5.2, to: 'm3', entry: 'from-m9' }],
  doors: [{ sector: built.closetDoorSector, triggerX: 58.5, triggerY: 47.5, requiresCard: null }],
};
