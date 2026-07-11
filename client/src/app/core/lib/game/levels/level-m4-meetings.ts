import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC, KNIGHT_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M4 "Salles de réunion / Meeting hell" — the mid-boss floor: the DIRECTOR (red) badge is taken here,
// the arena ships boss-less (empty dais slot + placeholder wave). y increases DOWN (arrival at the EAST).

const GROUND = { floorZ: 0, floorTex: 'CARPET', ceilTex: 'TECHNICAL' };

function buildMap(): {
  map: MapSource;
  gateSector: number;
  everestDoorSector: number;
  regieDoorSector: number;
  reserveDoorSector: number;
} {
  const b = new RoomBuilder();

  const PALIER = b.room(poly([74, 52, 88, 52, 90, 54, 90, 60, 88, 62, 74, 62]), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'CUBICLE',
  });

  // The stepped alcove dressing the M3 return pad as "stairs back up" (the fade covers the flight).
  const STUB = b.stairs([90, 54], [90, 60], {
    depth: 1.5,
    count: 2,
    zBase: 0,
    dz: 0.4,
    ceilZ: 3.4,
    light: 160,
    wallTex: 'CUBICLE',
    ceilTex: 'TECHNICAL',
  });

  b.connect(PALIER, STUB[0], { tex: 'CUBICLE' });
  const PAD = b.room(rect(93, 54, 96, 60), {
    floorZ: 0.8,
    ceilZ: 3.4,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 170,
    wallTex: 'CUBICLE',
  });

  b.connect(PAD, STUB[1], { tex: 'CUBICLE' });

  const FOYER = b.room(poly([46, 44, 66, 44, 74, 50, 74, 62, 66, 68, 48, 68, 40, 62, 40, 50]), {
    ...GROUND,
    ceilZ: 5.2,
    light: 195,
    wallTex: 'SCREEN',
    walls: { 0: 'WOOD' },
  });

  b.connect(FOYER, PALIER, { at: [74, 54, 74, 60], tex: 'CUBICLE' });
  const counter = { floorZ: 1.3, ceilZ: 5.2, floorTex: 'COUNTER_TOP', ceilTex: 'TECHNICAL' };

  b.island(FOYER, rect(42, 53, 45, 59), { ...counter, light: 195, wallTex: 'RECEPTION' });
  const bench = { floorZ: 0.5, ceilZ: 5.2, floorTex: 'STEP', ceilTex: 'TECHNICAL', light: 195 };

  b.island(FOYER, rect(56, 50, 64, 51.5), { ...bench, wallTex: 'WOOD' });
  b.island(FOYER, rect(56, 62, 64, 63.5), { ...bench, wallTex: 'WOOD' });

  const GATE = b.room(rect(52, 40, 58, 44), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 210,
    wallTex: 'SCREEN',
  });

  b.connect(FOYER, GATE, { tex: 'DOOR_RED' });
  const ANTI = b.room(poly([50, 30, 58, 30, 58, 40, 52, 40, 50, 36]), {
    floorZ: 0,
    ceilZ: 3.2,
    floorTex: 'FLOOR',
    ceilTex: 'NEON',
    light: 120,
    wallTex: 'SCREEN',
  });

  b.connect(GATE, ANTI, { tex: 'DOOR_RED' });

  const ARENA = b.room(poly([42, 2, 68, 2, 76, 10, 76, 24, 68, 30, 42, 30, 34, 24, 34, 10]), {
    ...GROUND,
    ceilZ: 7.2,
    light: 145,
    wallTex: 'SCREEN',
  });

  b.connect(ANTI, ARENA, { at: [51, 30, 57, 30], tex: 'SCREEN' });
  b.island(ARENA, poly([48, 12, 62, 12, 64, 14, 64, 19, 62, 21, 48, 21, 46, 19, 46, 14]), {
    floorZ: 0.5,
    ceilZ: 7.2,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'WOOD',
  });
  // The empty BOSS SLOT: the dais at (55, 6) stays clear (≥8-unit moat to the table) until the
  // Middle-Manager ships — the placeholder wave's knights flank it as "the co-chairs".
  b.island(ARENA, rect(48, 4, 62, 8.5), {
    floorZ: 1.1,
    ceilZ: 7.2,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 155,
    wallTex: 'WOOD',
  });
  const gallery = { floorZ: 1.6, ceilZ: 7.2, floorTex: 'STEP', ceilTex: 'TECHNICAL', light: 150 };

  b.island(ARENA, rect(35, 12, 39, 22), { ...gallery, wallTex: 'METAL' });
  b.island(ARENA, rect(71, 12, 75, 22), { ...gallery, wallTex: 'METAL' });
  b.hole(ARENA, rect(43, 25, 45, 27), 'PILLAR');
  b.hole(ARENA, rect(65, 25, 67, 27), 'PILLAR');

  const EXH = b.room(rect(76, 13, 82, 19), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 150,
    wallTex: 'CUBICLE',
  });

  b.connect(ARENA, EXH, { at: [76, 14, 76, 18], tex: 'SCREEN' });
  const DSTEP = b.stairs([88, 19], [88, 13], {
    depth: 1.5,
    count: 4,
    zBase: -1.6,
    dz: 0.4,
    ceilZ: 3.4,
    light: 140,
    wallTex: 'CUBICLE',
    ceilTex: 'TECHNICAL',
  });

  b.connect(EXH, DSTEP[3], { tex: 'CUBICLE' });
  const SORTIE = b.room(rect(88, 13, 93, 19), {
    floorZ: -1.6,
    ceilZ: 3.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 160,
    wallTex: 'CUBICLE',
    walls: { 3: 'ELEVATOR' },
  });

  b.connect(SORTIE, DSTEP[0], { tex: 'CUBICLE' });

  const GALERIE = b.room(poly([66, 44, 74, 50, 82, 38, 76, 33]), {
    ...GROUND,
    ceilZ: 3.6,
    light: 175,
    wallTex: 'CUBICLE',
  });

  b.connect(FOYER, GALERIE, { tex: 'CUBICLE' });
  const JCT = b.room(poly([76, 33, 82, 38, 101, 38, 101, 28, 80, 28]), {
    ...GROUND,
    ceilZ: 3.8,
    light: 175,
    wallTex: 'CUBICLE',
  });

  b.connect(GALERIE, JCT, { tex: 'CUBICLE' });

  const bocal = { ...GROUND, ceilZ: 3.2, light: 190, wallTex: 'SCREEN' };
  const B1 = b.room(rect(90, 38, 97, 44), bocal);

  b.connect(JCT, B1, { kind: 'glassPane', at: [90, 38, 92.5, 38] });
  b.connect(JCT, B1, { at: [92.5, 38, 94.5, 38], tex: 'CUBICLE' });
  b.connect(JCT, B1, { kind: 'glassPane', at: [94.5, 38, 97, 38] });
  const B2 = b.room(rect(101, 29, 108, 35), bocal);

  b.connect(JCT, B2, { kind: 'glassPane', at: [101, 29, 101, 31] });
  b.connect(JCT, B2, { at: [101, 31, 101, 33], tex: 'CUBICLE' });
  b.connect(JCT, B2, { kind: 'glassPane', at: [101, 33, 101, 35] });
  const table = { floorZ: 0.5, floorTex: 'COUNTER_TOP', ceilTex: 'TECHNICAL', wallTex: 'WOOD' };

  b.island(B1, rect(91.5, 40, 95.5, 42), { ...table, ceilZ: 3.2, light: 190 });
  b.island(B2, rect(103, 31, 106, 33), { ...table, ceilZ: 3.2, light: 190 });

  const ECORR = b.room(rect(94, 14, 98, 28), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 140,
    wallTex: 'CUBICLE',
  });

  b.connect(JCT, ECORR, { tex: 'CUBICLE' });
  // Thematic yellow door — the player already holds M3's manager badge, so it OPENS: the beat is that
  // manager doors no longer stop you, the red one does.
  const EVDOOR = b.room(rect(94, 11, 98, 14), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 170,
    wallTex: 'CUBICLE',
  });

  b.connect(ECORR, EVDOOR, { tex: 'DOOR_YELLOW' });
  const EVEREST = b.room(poly([84, 0, 100, 0, 104, 4, 104, 11, 88, 11, 84, 7]), {
    ...GROUND,
    ceilZ: 4.2,
    light: 160,
    wallTex: 'SCREEN',
    walls: { 1: 'METAL' },
  });

  b.connect(EVDOOR, EVEREST, { tex: 'DOOR_YELLOW' });
  b.island(EVEREST, rect(88, 3, 98, 6.5), { ...table, ceilZ: 4.2, light: 160 });

  const CORR = b.room(rect(97, 38, 101, 66), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 140,
    wallTex: 'CUBICLE',
  });

  b.connect(JCT, CORR, { tex: 'CUBICLE' });
  const CAT = b.room(poly([30, 70, 92, 70, 97, 66, 101, 66, 101, 69, 95, 73, 30, 73]), {
    floorZ: 0,
    ceilZ: 3.2,
    floorTex: 'FLOOR',
    ceilTex: 'CONCRETE',
    light: 140,
    wallTex: 'CUBICLE',
  });

  b.connect(CORR, CAT, { tex: 'CUBICLE' });
  const FSTUB = b.room(rect(54, 68, 58, 70), {
    ...GROUND,
    ceilZ: 3.2,
    light: 160,
    wallTex: 'SCREEN',
  });

  b.connect(FOYER, FSTUB, { tex: 'SCREEN' });
  b.connect(FSTUB, CAT, { tex: 'CUBICLE' });

  const BAIE = b.room(rect(56, 73, 68, 81), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 150,
    wallTex: 'KITCHEN',
  });

  b.connect(CAT, BAIE, { at: [58, 73, 66, 73], tex: 'KITCHEN' });
  // Secret 2 — the walled-off catering pantry. Unmarked KITCHEN door; tells: the bright TILE light-leak
  // secret tell: the bright TILE light-leak strip + the two BAIE barrels by the panel's south corner
  const RDOOR = b.room(rect(54, 74.5, 56, 78.5), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 200,
    wallTex: 'KITCHEN',
  });

  b.connect(BAIE, RDOOR, { tex: 'KITCHEN' });
  b.island(BAIE, rect(56.2, 74.5, 56.8, 78.5), {
    floorZ: 0.05,
    ceilZ: 3.4,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 235,
    wallTex: 'KITCHEN',
  });
  const RES = b.room(rect(48, 73, 54, 80), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 130,
    wallTex: 'KITCHEN',
  });

  b.connect(RDOOR, RES, { tex: 'KITCHEN' });

  // The amphi: entry landing z0, three long tiers stepping down westward to the sunken scène (-1.2)
  // under the giant screen — the projection gloom (dark hall, lit stage).
  const AMPHI_TOP = b.room(poly([32, 44, 36, 44, 40, 48, 40, 66, 36, 70, 32, 70]), {
    ...GROUND,
    ceilZ: 5.6,
    light: 140,
    wallTex: 'SCREEN',
  });

  b.connect(FOYER, AMPHI_TOP, { at: [40, 53, 40, 59], tex: 'SCREEN' });
  const tier = { ceilZ: 5.6, floorTex: 'CARPET', ceilTex: 'TECHNICAL', light: 130 };
  const TIER1 = b.room(rect(27, 44, 32, 70), { ...tier, floorZ: -0.4, wallTex: 'SCREEN' });

  b.connect(AMPHI_TOP, TIER1, { tex: 'SCREEN' });
  const TIER2 = b.room(rect(22, 44, 27, 70), { ...tier, floorZ: -0.8, wallTex: 'SCREEN' });

  b.connect(TIER1, TIER2, { tex: 'SCREEN' });
  const SCENE = b.room(poly([6, 50, 10, 44, 22, 44, 22, 70, 10, 70, 6, 64]), {
    floorZ: -1.2,
    ceilZ: 5.6,
    floorTex: 'FLOOR',
    ceilTex: 'NEON',
    light: 150,
    wallTex: 'SCREEN',
  });

  b.connect(TIER2, SCENE, { tex: 'SCREEN' });
  b.connect(AMPHI_TOP, CAT, { at: [32.5, 70, 35.5, 70], tex: 'CUBICLE' });

  const BSTEP = b.stairs([10, 44], [16, 44], {
    depth: 1,
    count: 3,
    zBase: -1.2,
    dz: 0.4,
    ceilZ: 3.4,
    light: 130,
    wallTex: 'METAL',
    ceilTex: 'TECHNICAL',
  });

  b.connect(SCENE, BSTEP[0], { tex: 'METAL' });
  const BACKSTAGE = b.room(rect(8, 33, 18, 41), {
    floorZ: 0,
    ceilZ: 3.4,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 120,
    wallTex: 'METAL',
  });

  b.connect(BACKSTAGE, BSTEP[2], { tex: 'METAL' });
  const OSTAIR = b.stairs([18, 33], [18, 41], {
    depth: 1.25,
    count: 8,
    zBase: 0,
    dz: 0.35,
    ceilZ: 5.8,
    light: 150,
    wallTex: 'CUBICLE',
    ceilTex: 'TECHNICAL',
  });

  b.connect(BACKSTAGE, OSTAIR[0], { tex: 'CUBICLE' });
  const OFFICE = b.room(poly([28, 30, 38, 28, 42, 32, 42, 44, 28, 44]), {
    floorZ: 2.8, // the mezzanine: entered up OSTAIR, left by the one-way drop
    ceilZ: 5.8,
    floorTex: 'CARPET',
    ceilTex: 'TECHNICAL',
    light: 185,
    wallTex: 'CUBICLE',
    walls: { 0: 'WOOD', 1: 'WOOD' },
  });

  b.connect(OSTAIR[7], OFFICE, { tex: 'CUBICLE' });
  b.connect(OFFICE, TIER1, { kind: 'fence', at: [28, 44, 32, 44], tex: 'METAL' });
  b.connect(OFFICE, AMPHI_TOP, { at: [32, 44, 36, 44], tex: 'CUBICLE' }); // one-way DROP: 2.8 > the 2.4 mantle ceiling
  b.island(OFFICE, rect(30, 33, 36, 36.5), {
    floorZ: 4.1, // 1.3 above the office floor — the red badge desk is a mantle move
    ceilZ: 5.8,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'TECHNICAL',
    light: 185,
    wallTex: 'WOOD',
  });

  // Secret 1 — the AV control booth over the tiers. Unmarked SCREEN door off TIER2; tells: the raised
  // glassPane band seen from the scène (armor glimpsed through it) + the bright threshold strip.
  const RGDOOR = b.room(rect(23.5, 70, 26, 72), {
    floorZ: 0.2,
    ceilZ: 3.6,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 200,
    wallTex: 'SCREEN',
  });

  b.connect(TIER2, RGDOOR, { tex: 'SCREEN' });
  b.island(TIER2, rect(23.5, 69.3, 26, 69.9), {
    floorZ: -0.75,
    ceilZ: 5.6,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 235,
    wallTex: 'SCREEN',
  });
  const REGIE = b.room(poly([22, 70, 23.5, 70, 23.5, 72, 26, 72, 26, 70, 29, 70, 29, 78, 22, 78]), {
    floorZ: 1.2,
    ceilZ: 4.2,
    floorTex: 'FLOOR',
    ceilTex: 'TECHNICAL',
    light: 110,
    wallTex: 'SCREEN',
  });

  b.connect(RGDOOR, REGIE, { tex: 'SCREEN' });
  b.connect(REGIE, TIER2, { kind: 'glassPane', at: [22, 70, 23.5, 70] });
  b.connect(REGIE, TIER1, { kind: 'glassPane', at: [27, 70, 29, 70] });

  b.thing(86, 57, Math.PI, 'player_start');
  b.thing(47, 66, 0, 'barrel');
  b.thing(48.5, 64.8, 0, 'barrel');
  b.thing(55, 71.5, 0, 'barrel');
  b.thing(53.8, 72.2, 0, 'barrel');
  b.thing(59.5, 79.5, 0, 'barrel');
  b.thing(58, 78.6, 0, 'barrel');
  b.thing(46, 25.5, 0, 'barrel');
  b.thing(64, 25.5, 0, 'barrel');
  b.thing(92, 14.2, 0, 'barrel');

  // Directional props carry a MEANINGFUL facing; symmetric plants/coolers keep angle 0.
  b.thing(75.5, 60, 0, 'prop_totem');
  b.thing(75, 53, 0, 'prop');
  b.thing(50, 46.5, 1.57, 'prop_totem');
  b.thing(43.5, 55, 0.2, 'prop_screen');
  b.thing(43.5, 57.5, 6.0, 'prop_screen');
  b.thing(60, 53.5, 2.1, 'prop_chair');
  b.thing(53, 64, 5.0, 'prop_chair');
  b.thing(65, 47, 4.0, 'prop_board');
  b.thing(72.5, 51, 0, 'prop');
  b.thing(86, 36.5, 4.71, 'prop_board');
  b.thing(93.5, 41, 4.71, 'prop_screen');
  b.thing(95.8, 42.8, 2.3, 'prop_chair');
  b.thing(104.5, 32, 3.14, 'prop_screen');
  b.thing(103, 34, 1.0, 'prop_chair');
  b.thing(93, 4.5, 1.57, 'prop_screen');
  b.thing(92, 8.5, 1.8, 'prop_chair');
  b.thing(99, 9, 3.5, 'prop_chair');
  b.thing(102, 6.5, 3.14, 'prop_board');
  b.thing(67, 74, 0, 'prop_cooler');
  b.thing(10, 52, 0.3, 'prop_board');
  b.thing(29, 54.5, 3.14, 'prop_chair');
  b.thing(24, 60.5, 3.0, 'prop_chair');
  b.thing(29.5, 61, 3.5, 'prop_chair');
  b.thing(38, 67.5, 0, 'prop');
  b.thing(9.5, 34.5, 0, 'prop_cooler');
  b.thing(31.5, 35, 4.71, 'prop_screen');
  b.thing(36.5, 39.5, 2.6, 'prop_chair');
  b.thing(40.5, 31.8, 0, 'prop');
  b.thing(52, 13.5, 4.2, 'prop_screen');
  b.thing(59, 28.5, 4.71, 'prop_totem');
  b.thing(44.5, 13, 0, 'prop_chair');
  b.thing(44.5, 20, 0.5, 'prop_chair');
  b.thing(65.5, 13, 3.14, 'prop_chair');
  b.thing(65.5, 20, 2.6, 'prop_chair');
  b.thing(50, 23, 1.2, 'prop_chair');
  b.thing(60, 23, 1.9, 'prop_chair');
  b.thing(51.2, 38, 2.0, 'prop_board');

  return {
    map: b.build(),
    gateSector: GATE,
    everestDoorSector: EVDOOR,
    regieDoorSector: RGDOOR,
    reserveDoorSector: RDOOR,
  };
}

const built = buildMap();

export const M4_MEETINGS: Level = {
  map: built.map,
  spawn: { x: 86, y: 57, angle: Math.PI },
  enemies: [
    { spec: PINKY_SPEC, x: 59, y: 56 },
    { spec: IMP_SPEC, x: 49, y: 59 },
    { spec: SHOTGUNGUY_SPEC, x: 93.5, y: 39.5 },
    { spec: IMP_SPEC, x: 79, y: 31 },
    { spec: IMP_SPEC, x: 98, y: 30 },
    { spec: KNIGHT_SPEC, x: 96, y: 7.5 },
    { spec: LOSTSOUL_SPEC, x: 86, y: 2 },
    { spec: LOSTSOUL_SPEC, x: 89.5, y: 1.5 },
    { spec: KNIGHT_SPEC, x: 62, y: 77.5 },
    { spec: PINKY_SPEC, x: 58, y: 75 },
    { spec: PINKY_SPEC, x: 66, y: 75.5 },
    { spec: IMP_SPEC, x: 29, y: 50 },
    { spec: IMP_SPEC, x: 24.5, y: 57 },
    { spec: IMP_SPEC, x: 29, y: 64 },
    { spec: PINKY_SPEC, x: 12, y: 54 },
    { spec: PINKY_SPEC, x: 13, y: 61 },
    { spec: SHOTGUNGUY_SPEC, x: 13, y: 45.5 },
    { spec: KNIGHT_SPEC, x: 34, y: 40.5 },
    { spec: LOSTSOUL_SPEC, x: 29.5, y: 31.5 },
    { spec: LOSTSOUL_SPEC, x: 40.5, y: 33.5 },
    { spec: KNIGHT_SPEC, x: 55, y: 37.5 },
    { spec: SHOTGUNGUY_SPEC, x: 52.5, y: 32.5 },
    { spec: KNIGHT_SPEC, x: 45.5, y: 6.5 },
    { spec: KNIGHT_SPEC, x: 64.5, y: 6.5 },
    { spec: PINKY_SPEC, x: 44, y: 16 },
    { spec: PINKY_SPEC, x: 55, y: 23.5 },
    { spec: PINKY_SPEC, x: 66, y: 16 },
    { spec: IMP_SPEC, x: 37, y: 17 },
    { spec: IMP_SPEC, x: 73, y: 17 },
    { spec: LOSTSOUL_SPEC, x: 50, y: 10.5 },
    { spec: LOSTSOUL_SPEC, x: 60, y: 10.5 },
  ],
  health: [
    [56, 34.5],
    [62, 79.5, 'small'],
  ],
  armor: [
    [25.5, 75],
    [40, 42.5, 'small'],
  ],
  ammo: [
    [61, 58], // staples
    [85.5, 4.5], // nails
    [51, 76.5], // canisters
    [8.5, 57], // cells
    [52, 31.5], // batteries
    [55, 16.5], // server-cell
  ],
  weapons: [[54, 32.5, 'rocket']],
  keycards: [[33, 34.75, 'red']], // on the Middle-Manager's desk island (z4.1) — director clearance
  entries: {
    main: { x: 86, y: 57, angle: Math.PI },
    'from-m3': { x: 86, y: 57, angle: Math.PI },
  },
  exits: [{ x: 94.5, y: 57, to: 'm3', entry: 'from-m4' }],
  // onward is the TEMP win exit at the post-arena service landing (→ M5 when it ships)
  exit: [90.5, 16],
  doors: [
    { sector: built.gateSector, triggerX: 55, triggerY: 42, requiresCard: 'red' },
    { sector: built.everestDoorSector, triggerX: 96, triggerY: 12.5, requiresCard: 'yellow' },
    { sector: built.regieDoorSector, triggerX: 24.75, triggerY: 71, requiresCard: null },
    { sector: built.reserveDoorSector, triggerX: 55, triggerY: 76.5, requiresCard: null },
  ],
};
