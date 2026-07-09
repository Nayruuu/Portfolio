import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M2 "Open-space" — the employee floor above the lobby; first BADGE floor (blue). Authored via RoomBuilder.
// y increases DOWN (the seam to M1 is at the SOUTH).

const GROUND = { floorZ: 0, floorTex: 'CARPET', ceilTex: 'CONCRETE' };
const UPPER = { floorZ: 2.8, floorTex: 'CARPET', ceilTex: 'CONCRETE' };

function buildMap(): { map: MapSource; gateSector: number; secretSector: number } {
  const b = new RoomBuilder();

  const STUB = b.room(rect(24, 124, 28, 130), {
    ...GROUND,
    ceilZ: 4.6,
    light: 190,
    wallTex: 'CUBICLE',
  });

  // M2⇄M1 live passable seam: translation (dx,dy)=(0,+100) maps M1's seam line (24..28,30) onto ours
  // (24..28,130); widths/heights MUST match the M1 side exactly.
  b.zonePortal(STUB, [24, 130, 28, 130], { zone: 'm1', dx: 0, dy: 100, passable: true });

  const VEST = b.room(poly([18, 112, 14, 116, 14, 124, 40, 124, 42, 120, 42, 112]), {
    ...GROUND,
    ceilZ: 3.4,
    light: 190,
    wallTex: 'CUBICLE',
  });

  b.connect(VEST, STUB, { tex: 'CUBICLE' });

  const GDOOR = b.room(rect(12, 117, 14, 121), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'CONCRETE',
    light: 210,
    wallTex: 'CUBICLE',
  });

  b.connect(VEST, GDOOR, { tex: 'DOOR_BLUE' });
  const SWELL = b.room(poly([0, 108, 0, 126, 9, 125, 9, 109]), {
    floorZ: -1.6,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'CONCRETE',
    light: 210,
    wallTex: 'CUBICLE',
  });
  const GSTEP = b.stairs([9, 117], [9, 121], {
    depth: 1,
    count: 3,
    zBase: -1.6,
    dz: 0.4,
    ceilZ: 3.4,
    light: 210,
    wallTex: 'CUBICLE',
    ceilTex: 'CONCRETE',
  });

  b.connect(SWELL, GSTEP[0], { tex: 'CUBICLE' });
  b.connect(GDOOR, GSTEP[2], { tex: 'CUBICLE' });

  const FARM = b.room(poly([20, 70, 14, 76, 14, 112, 46, 112, 52, 106, 72, 106, 72, 84, 64, 70]), {
    ...GROUND,
    ceilZ: 4.8,
    light: 176,
    wallTex: 'CUBICLE',
  });

  b.connect(VEST, FARM, { at: [25, 112, 31, 112], tex: 'CUBICLE' });

  const FIELD = b.island(FARM, rect(28, 76, 36, 110), {
    ...GROUND,
    ceilZ: 5.6,
    light: 204,
    wallTex: 'WOOD',
  });

  b.hole(FIELD, rect(29, 78, 30.5, 79.5), 'PILLAR');
  b.hole(FIELD, rect(33.5, 106, 35, 107.5), 'PILLAR');

  // z1.3 = mantle height: enemies can't follow you up, hopping one is a deliberate move
  const cubicle = { floorZ: 1.3, ceilZ: 4.8, floorTex: 'STEP', ceilTex: 'CONCRETE', light: 176 };
  const desk = { ...cubicle, wallTex: 'CUBICLE' };

  b.island(FARM, rect(16, 76, 24, 80), desk);
  b.island(FARM, rect(16, 84, 24, 88), desk);
  b.island(FARM, rect(16, 92, 24, 96), desk);
  b.island(FARM, rect(16, 100, 24, 104), desk);
  b.island(FARM, rect(40, 76, 46, 80), desk);
  b.island(FARM, rect(40, 84, 46, 88), desk);
  b.island(FARM, rect(40, 92, 46, 96), desk);
  b.island(FARM, poly([50, 92, 56, 88, 60, 92, 54, 96]), desk);
  b.island(FARM, rect(40, 100, 46, 104), desk);

  const WSTEP = b.stairs([6, 92], [14, 92], {
    depth: 2,
    count: 7,
    zBase: 0,
    dz: 0.4,
    ceilZ: 5.6,
    light: 186,
    wallTex: 'CUBICLE',
    ceilTex: 'CONCRETE',
  });

  b.connect(FARM, WSTEP[0], { tex: 'CUBICLE' });
  const LANDW = b.room(rect(6, 74, 14, 78), {
    ...UPPER,
    ceilZ: 5.6,
    light: 186,
    wallTex: 'CUBICLE',
  });

  b.connect(LANDW, WSTEP[6], { tex: 'CUBICLE' });

  const MEZZ = b.room(
    poly([6, 64, 6, 74, 14, 74, 14, 70, 60, 70, 60, 64, 54, 64, 46, 62, 34, 64, 20, 64]),
    { ...UPPER, ceilZ: 5.6, light: 186, wallTex: 'CUBICLE' },
  );

  b.connect(MEZZ, LANDW, { tex: 'CUBICLE' });
  b.connect(FARM, MEZZ, { at: [20, 70, 24, 70], tex: 'CUBICLE' }); // one-way DROP: 2.8 > the 2.4 mantle ceiling (down only)
  b.connect(FARM, MEZZ, { kind: 'fence', at: [24, 70, 60, 70], tex: 'METAL' });

  const office = { ...UPPER, ceilZ: 5.6, light: 196, wallTex: 'CUBICLE' };
  const OFF1 = b.room(rect(20, 50, 34, 64), office);

  b.connect(OFF1, MEZZ, { kind: 'glassPane', at: [20, 64, 25, 64] });
  b.connect(OFF1, MEZZ, { at: [25, 64, 29, 64], tex: 'CUBICLE' });
  b.connect(OFF1, MEZZ, { kind: 'glassPane', at: [29, 64, 34, 64] });
  const OFF2 = b.room(poly([34, 50, 34, 64, 46, 62, 46, 50]), office);

  b.connect(OFF2, MEZZ, { kind: 'glassPane', at: [34, 64, 40, 63] });
  b.connect(OFF2, MEZZ, { at: [40, 63, 43, 62.5], tex: 'CUBICLE' });
  b.connect(OFF2, MEZZ, { kind: 'glassPane', at: [43, 62.5, 46, 62] });
  const OFF3 = b.room(poly([46, 50, 46, 62, 54, 64, 60, 64, 60, 50]), {
    ...office,
    light: 210,
    walls: { 4: 'WOOD' },
  });

  b.connect(OFF3, MEZZ, { kind: 'glassPane', at: [46, 62, 54, 64] });
  b.connect(OFF3, MEZZ, { at: [54, 64, 57, 64], tex: 'CUBICLE' });
  b.connect(OFF3, MEZZ, { kind: 'glassPane', at: [57, 64, 60, 64] });
  b.island(OFF3, rect(49, 53, 55, 56), {
    floorZ: 4.1, // 1.3 above the office floor — a mantle island mid-fight
    ceilZ: 5.6,
    floorTex: 'STEP',
    ceilTex: 'CONCRETE',
    light: 210,
    wallTex: 'WOOD',
  });

  const ESTEP = b.stairs([68, 70], [68, 64], {
    depth: 1,
    count: 8,
    zBase: -0.4,
    dz: 0.4,
    ceilZ: 5.6,
    light: 170,
    wallTex: 'CUBICLE',
    ceilTex: 'CONCRETE',
  });

  b.connect(MEZZ, ESTEP[7], { tex: 'CUBICLE' });
  const LANDE = b.room(rect(68, 58, 78, 74), {
    ...GROUND,
    ceilZ: 3.4,
    light: 170,
    wallTex: 'CUBICLE',
  });

  b.connect(LANDE, ESTEP[0], { tex: 'CUBICLE' });

  const NOOK = b.room(poly([62, 44, 62, 58, 74, 58, 74, 48, 70, 44]), {
    floorZ: 0,
    ceilZ: 3.2,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 190,
    wallTex: 'KITCHEN',
  });

  b.connect(LANDE, NOOK, { at: [69, 58, 73, 58], tex: 'KITCHEN' });

  const PLAZA = b.room(rect(62, 43.9, 70, 44), {
    floorZ: 0,
    ceilZ: 8, // worldSize-8 v-anchor (z0..8): the 0..3.2 opening shows the backdrop's composed bottom band
    floorTex: 'CONCRETE',
    ceilTex: 'CONCRETE',
    light: 255,
    wallTex: 'GLASS_INT',
    walls: { 3: 'CITY_PLAZA' },
  });

  b.connect(NOOK, PLAZA, { kind: 'glassPane', at: [62, 44, 70, 44] });

  const PRINT = b.room(poly([78, 44, 78, 66, 92, 66, 92, 58, 100, 58, 100, 44]), {
    floorZ: 0,
    ceilZ: 4.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 140,
    wallTex: 'SCREEN',
    walls: { 5: 'METAL' },
  });

  b.connect(LANDE, PRINT, { at: [78, 60, 78, 64], tex: 'CUBICLE' });
  b.hole(PRINT, rect(82, 50, 86, 54), 'METAL');
  b.island(PRINT, rect(86, 44.1, 92, 44.7), {
    floorZ: 0.05,
    ceilZ: 4.0,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 235,
    wallTex: 'METAL',
  });
  const SDOOR = b.room(rect(86, 42, 92, 44), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'METAL',
  });

  b.connect(PRINT, SDOOR, { tex: 'METAL' });
  const CLOS = b.room(rect(84, 36, 94, 42), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'METAL',
  });

  b.connect(SDOOR, CLOS, { tex: 'METAL' });

  const ring = { ...GROUND, ceilZ: 4.2, light: 170, wallTex: 'CUBICLE' };
  const RN = b.room(
    poly([80, 76, 76, 82, 82, 88, 86, 84, 100, 84, 104, 88, 110, 82, 104, 76]),
    ring,
  );
  const RW = b.room(poly([76, 82, 76, 110, 82, 116, 86, 110, 82, 104, 82, 88]), ring);
  const RS = b.room(poly([82, 116, 104, 116, 110, 110, 104, 106, 100, 110, 86, 110]), ring);
  const RE = b.room(poly([110, 82, 110, 110, 104, 106, 104, 88]), ring);

  b.connect(RN, RW, { tex: 'CUBICLE' });
  b.connect(RN, RE, { tex: 'CUBICLE' });
  b.connect(RW, RS, { tex: 'CUBICLE' });
  b.connect(RS, RE, { tex: 'CUBICLE' });
  const PIT = b.room(
    poly([
      86, 84, 82, 88, 82, 92, 85, 92, 85, 100, 82, 100, 82, 104, 86, 110, 100, 110, 104, 106, 104,
      88, 100, 84,
    ]),
    { floorZ: -1.2, ceilZ: 4.2, floorTex: 'TILE', ceilTex: 'NEON', light: 150, wallTex: 'METAL' },
  );

  b.connect(PIT, RN, { tex: 'METAL' });
  b.connect(PIT, RW, { tex: 'METAL' });
  b.connect(PIT, RS, { tex: 'METAL' });
  b.connect(PIT, RE, { tex: 'METAL' });
  const PSTEP = b.stairs([85, 100], [85, 92], {
    depth: 1,
    count: 3,
    zBase: -1.2,
    dz: 0.4,
    ceilZ: 4.2,
    light: 160,
    wallTex: 'METAL',
    ceilTex: 'NEON',
  });

  b.connect(PIT, PSTEP[0], { tex: 'METAL' });
  b.connect(RW, PSTEP[2], { tex: 'CUBICLE' });
  b.island(PIT, rect(90, 92, 96, 97), {
    floorZ: 0.1,
    ceilZ: 4.2,
    floorTex: 'STEP',
    ceilTex: 'NEON',
    light: 150,
    wallTex: 'METAL',
  });
  b.island(PIT, rect(102, 92, 103.6, 100), {
    floorZ: 1.0,
    ceilZ: 4.2,
    floorTex: 'GRATING',
    ceilTex: 'NEON',
    light: 180,
    wallTex: 'METAL',
  });

  const neck = { ...GROUND, ceilZ: 3.0, light: 160, wallTex: 'CUBICLE' };
  const CONNA = b.room(rect(72, 86, 76, 92), neck);
  const CONNB = b.room(rect(72, 98, 76, 104), neck);
  const CONNP = b.room(rect(80, 66, 86, 76), neck);

  b.connect(FARM, CONNA, { tex: 'CUBICLE' });
  b.connect(CONNA, RW, { tex: 'CUBICLE' });
  b.connect(FARM, CONNB, { tex: 'CUBICLE' });
  b.connect(CONNB, RW, { tex: 'CUBICLE' });
  b.connect(PRINT, CONNP, { tex: 'CUBICLE' });
  b.connect(CONNP, RN, { tex: 'CUBICLE' });

  b.thing(26, 118, Math.PI * 1.5, 'player_start');
  b.thing(20, 120, 0, 'barrel');
  b.thing(26, 84, 0, 'barrel');
  b.thing(38, 92, 0, 'barrel');
  b.thing(79, 86, 0, 'barrel');
  b.thing(84.5, 45, 0, 'barrel');
  b.thing(85.2, 46.2, 0, 'barrel');

  // Directional props (4-rotation billboards) carry a MEANINGFUL facing — the angles vary on purpose.
  // Symmetric props (plants, coolers) keep angle 0.
  b.thing(16, 114, 0.5, 'prop_totem');
  b.thing(20, 86, 0.4, 'prop_screen');
  b.thing(42, 78, 2.8, 'prop_screen');
  b.thing(18, 94.8, 0.6, 'prop_screen');
  b.thing(43.5, 85.2, 4.2, 'prop_screen');
  b.thing(55, 92, 2.6, 'prop_screen');
  b.thing(8, 66, 0, 'prop');
  b.thing(22, 52, 0, 'prop');
  b.thing(64, 46, 0, 'prop');
  b.thing(90, 113, 0, 'prop');
  b.thing(24.9, 86.8, 0.9, 'prop_chair');
  b.thing(39.1, 94.6, 3.6, 'prop_chair');
  b.thing(25.2, 103.4, 5.5, 'prop_chair');
  b.thing(48.6, 90.8, 2.2, 'prop_chair');
  b.thing(23.5, 58.5, 0.7, 'prop_chair');
  b.thing(47.8, 57.6, 5.9, 'prop_chair');
  b.thing(65.5, 47.5, 2.4, 'prop_chair');
  b.thing(89, 56, 3.9, 'prop_chair');
  b.thing(91.5, 106.5, 1.8, 'prop_chair');
  b.thing(92, 108.8, 4.71, 'prop_board');
  b.thing(102.8, 89.7, 3.14, 'prop_board');
  b.thing(30, 51.2, 1.57, 'prop_board');
  b.thing(10, 75.2, 1.57, 'prop_board');
  b.thing(72.8, 49.6, 0, 'prop_cooler');
  b.thing(15.2, 110.8, 0, 'prop_cooler');

  return { map: b.build(), gateSector: GDOOR, secretSector: SDOOR };
}

const built = buildMap();

export const M2_OPENSPACE: Level = {
  map: built.map,
  spawn: { x: 26, y: 118, angle: Math.PI * 1.5 },
  enemies: [
    { spec: PINKY_SPEC, x: 30, y: 108 },
    { spec: PINKY_SPEC, x: 26, y: 90 },
    { spec: PINKY_SPEC, x: 37.5, y: 90 },
    { spec: IMP_SPEC, x: 43, y: 102 },
    { spec: SHOTGUNGUY_SPEC, x: 86, y: 52 },
    { spec: LOSTSOUL_SPEC, x: 96, y: 48 },
    { spec: IMP_SPEC, x: 107, y: 90 },
    { spec: IMP_SPEC, x: 107, y: 102 },
    { spec: PINKY_SPEC, x: 90, y: 103 },
    { spec: PINKY_SPEC, x: 18, y: 67 },
    { spec: IMP_SPEC, x: 34, y: 67 },
    { spec: SHOTGUNGUY_SPEC, x: 56, y: 58 },
    { spec: LOSTSOUL_SPEC, x: 27, y: 56 },
    { spec: LOSTSOUL_SPEC, x: 40, y: 56 },
    { spec: PINKY_SPEC, x: 17, y: 108 },
    { spec: PINKY_SPEC, x: 20, y: 110 },
  ],
  health: [
    [68, 51, 'small'],
    [10, 68],
  ],
  armor: [
    [95, 104, 'small'],
    [89, 39],
  ],
  ammo: [
    [26, 120], // staples
    [96, 52], // nails
    [32, 96], // canisters
    [102.8, 96], // cells
    [30, 67], // batteries
    [5, 122], // server-cell
  ],
  weapons: [[83, 71, 'shotgun']],
  keycards: [[52, 54.5, 'blue']], // on the manager's desk island (z4.1)
  entries: {
    main: { x: 26, y: 118, angle: Math.PI * 1.5 },
    'from-m1': { x: 26, y: 128, angle: Math.PI * 1.5 },
  },
  // no graph exits yet: onward is the TEMP win exit on the stairwell landing (→ M3 when it ships); the M1
  // edge is the passable live seam in the stub — walking through the window IS the crossing.
  exit: [4, 119],
  doors: [
    { sector: built.gateSector, triggerX: 13, triggerY: 119, requiresCard: 'blue' },
    { sector: built.secretSector, triggerX: 89, triggerY: 43, requiresCard: null },
  ],
};
