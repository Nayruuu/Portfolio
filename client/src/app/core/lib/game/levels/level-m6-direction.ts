import { PINKY_SPEC, SHOTGUNGUY_SPEC, IMP_SPEC, LOSTSOUL_SPEC, KNIGHT_SPEC } from '../enemy';
import { RoomBuilder } from '../../bsp-engine';
import type { MapSource } from '../../bsp-engine';
import type { Level } from '../level';
import { poly, rect } from './poly';

// M6 "Direction / C-suite" — the executive floor. No badge objective (colours were spent by M4): rank =
// altitude — z0 services/atrium, +0.8 senior wing, +2.8 CEO tier — and the goal is VISIBLE from the hub
// (the lit red door through the terrace rail + antechamber glass, the boardroom knights through its glass
// wall). The way down to M7 is the CEO's private stair. y increases DOWN (arrival at the EAST monte-charge).

const MARBRE = { floorZ: 0, floorTex: 'MARBLE', ceilTex: 'TECHNICAL' };
const SENIOR = { floorZ: 0.8, floorTex: 'CARPET', ceilTex: 'TECHNICAL' };
const CEO_TIER = { floorZ: 2.8, floorTex: 'MARBLE', ceilTex: 'TECHNICAL' };

function buildMap(): {
  map: MapSource;
  redDoorSector: number;
  s1DoorSector: number;
  s2DoorSector: number;
} {
  const b = new RoomBuilder();

  const QUAI = b.room(poly([108, 50, 120, 50, 123, 53, 123, 63, 120, 66, 108, 66]), {
    floorZ: 0,
    ceilZ: 3.2,
    floorTex: 'SLAB',
    ceilTex: 'CONCRETE',
    light: 120,
    wallTex: 'METAL',
    walls: { 1: 'ELEVATOR', 2: 'ELEVATOR', 3: 'ELEVATOR' },
  });

  const OFFICE = b.room(poly([86, 44, 108, 50, 108, 62, 86, 56]), {
    floorZ: 0,
    ceilZ: 3.2,
    floorTex: 'TILE',
    ceilTex: 'CONCRETE',
    light: 118,
    wallTex: 'METAL',
  });

  b.connect(QUAI, OFFICE, { at: [108, 54, 108, 60], tex: 'METAL' });

  const GALERIE = b.room(poly([72, 40, 86, 46, 86, 58, 72, 58]), {
    ...MARBRE,
    ceilZ: 4.4,
    light: 145,
    wallTex: 'EXEC',
    walls: { 0: 'WOOD' },
  });

  b.connect(OFFICE, GALERIE, { at: [86, 49, 86, 53], tex: 'WOOD' });

  const ATRIUM = b.room(poly([40, 22, 66, 22, 72, 28, 72, 54, 64, 58, 44, 58, 36, 52, 36, 28]), {
    ...MARBRE,
    ceilZ: 7,
    ceilTex: 'CEIL_LUX',
    light: 170,
    wallTex: 'EXEC',
    walls: { 1: 'WOOD', 3: 'WOOD', 7: 'WOOD' },
  });

  b.connect(GALERIE, ATRIUM, { at: [72, 42, 72, 50], tex: 'EXEC' });

  // 0.1-deep exterior box — the skyline sits IN the glass plane (8-wide = one clean copy, high floor)
  const ext = {
    floorZ: 0,
    ceilZ: 8,
    floorTex: 'CONCRETE',
    ceilTex: 'CONCRETE',
    light: 255,
    wallTex: 'GLASS_INT',
  };
  const EXTA = b.room(rect(72, 30, 72.1, 38), { ...ext, walls: { 2: 'CITY' } });

  b.connect(ATRIUM, EXTA, { kind: 'glassPane', at: [72, 30, 72, 38] });

  const counter = {
    floorZ: 1.3,
    ceilZ: 7,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'CEIL_LUX',
    light: 170,
  };

  b.island(ATRIUM, rect(46, 38, 54, 41), { ...counter, wallTex: 'RECEPTION' });
  b.island(ATRIUM, rect(56, 44, 60, 48), {
    floorZ: 0.4,
    ceilZ: 7,
    floorTex: 'STEP',
    ceilTex: 'CEIL_LUX',
    light: 170,
    wallTex: 'LOBBY',
  });
  b.hole(ATRIUM, rect(42, 30, 44, 32), 'PILLAR_LOBBY');
  b.hole(ATRIUM, rect(62, 30, 64, 32), 'PILLAR_LOBBY');
  b.hole(ATRIUM, rect(42, 48, 44, 50), 'PILLAR_LOBBY');
  b.hole(ATRIUM, rect(62, 48, 64, 50), 'PILLAR_LOBBY');

  const STAIRW = b.stairs([36, 52], [36, 48], {
    depth: 3,
    count: 2,
    zBase: 0,
    dz: 0.4,
    ceilZ: 4.2,
    light: 160,
    wallTex: 'EXEC',
  });

  b.connect(ATRIUM, STAIRW[0], { tex: 'EXEC' });

  const SPINE = b.room(poly([20, 44, 26, 44, 30, 48, 30, 64, 26, 68, 20, 68]), {
    ...SENIOR,
    ceilZ: 4.0,
    light: 130,
    wallTex: 'EXEC',
  });

  b.connect(STAIRW[1], SPINE, { tex: 'EXEC' });

  // Glass office fronts: sight crosses, shots don't — the imps track you before you can touch them.
  const bureau = { ...SENIOR, ceilZ: 3.8, light: 128, wallTex: 'EXEC' };
  const desk = {
    floorZ: 1.3,
    ceilZ: 3.8,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'TECHNICAL',
    light: 128,
    wallTex: 'WOOD',
  };
  const B1 = b.room(rect(8, 46, 20, 52), bureau);

  b.connect(SPINE, B1, { kind: 'glassPane', at: [20, 46.5, 20, 49.5] });
  b.connect(SPINE, B1, { at: [20, 50, 20, 51.5], tex: 'EXEC' });
  b.island(B1, rect(9, 47, 13, 48.5), desk);
  const B2 = b.room(rect(8, 54, 20, 60), bureau);

  b.connect(SPINE, B2, { kind: 'glassPane', at: [20, 54.5, 20, 57.5] });
  b.connect(SPINE, B2, { at: [20, 58, 20, 59.5], tex: 'EXEC' });
  const B3 = b.room(rect(8, 62, 20, 68), bureau);

  b.connect(SPINE, B3, { kind: 'glassPane', at: [20, 62.5, 20, 65.5] });
  b.connect(SPINE, B3, { at: [20, 66, 20, 67.5], tex: 'EXEC' });
  b.island(B3, rect(9, 65.5, 13, 67), desk);

  const CFO = b.room(poly([4, 68, 26, 68, 26, 74, 20, 82, 10, 84, 4, 78]), {
    ...SENIOR,
    ceilZ: 4.2,
    light: 140,
    wallTex: 'WOOD',
  });

  b.connect(SPINE, CFO, { at: [21, 68, 25, 68], tex: 'WOOD' });
  b.island(CFO, rect(12, 71, 18, 73.5), { ...desk, ceilZ: 4.2 });

  // Secret 1 — the CFO's cache. Unmarked WOOD panel; tells: the desk chair faces the panel, not the desk,
  // and the bright threshold light-leak strip.
  const S1DOOR = b.room(rect(2.5, 70, 4, 74), {
    ...SENIOR,
    ceilZ: 3.2,
    light: 200,
    wallTex: 'WOOD',
  });

  b.connect(CFO, S1DOOR, { tex: 'WOOD' });
  b.island(CFO, rect(4.1, 70, 4.6, 74), {
    ...SENIOR,
    floorZ: 0.85,
    ceilZ: 4.2,
    light: 235,
    wallTex: 'WOOD',
  });
  const S1 = b.room(rect(-3, 69, 2.5, 75), {
    floorZ: 0.8,
    ceilZ: 3.2,
    floorTex: 'SLAB',
    ceilTex: 'TECHNICAL',
    light: 130,
    wallTex: 'METAL',
  });

  b.connect(S1DOOR, S1, { tex: 'WOOD' });

  const CONSEIL = b.room(poly([16, 26, 36, 26, 36, 42, 26, 44, 16, 44]), {
    ...SENIOR,
    ceilZ: 5.4,
    ceilTex: 'CEIL_LUX',
    light: 160,
    wallTex: 'WOOD',
    walls: { 4: 'SCREEN' },
  });

  b.connect(CONSEIL, SPINE, { at: [21, 44, 25, 44], tex: 'WOOD' });
  // the atrium reads the boardroom (and its knights) through the glass long before entering
  b.connect(CONSEIL, ATRIUM, { kind: 'glassPane', at: [36, 29, 36, 41] });
  b.island(CONSEIL, rect(20, 31, 32, 37), {
    floorZ: 1.3,
    ceilZ: 5.4,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'CEIL_LUX',
    light: 160,
    wallTex: 'WOOD',
  });
  const alcove = { ...SENIOR, ceilZ: 3.6, light: 105, wallTex: 'SCREEN' };
  const ALC1 = b.room(rect(13, 28, 16, 32), alcove);

  b.connect(CONSEIL, ALC1, { tex: 'SCREEN' });
  const ALC2 = b.room(rect(13, 38, 16, 42), alcove);

  b.connect(CONSEIL, ALC2, { tex: 'SCREEN' });

  const ESCH = b.stairs([28, 26], [36, 26], {
    depth: 0.8,
    count: 5,
    zBase: 0.8,
    dz: 0.4,
    ceilZ: 5.6,
    light: 155,
    wallTex: 'EXEC',
  });

  b.connect(CONSEIL, ESCH[0], { tex: 'EXEC' });

  const ANTI = b.room(poly([27.5, 12, 38, 14, 38, 22, 27.5, 22]), {
    ...CEO_TIER,
    ceilZ: 5.6,
    light: 150,
    wallTex: 'EXEC',
    walls: { 0: 'PILLAR' },
  });

  b.connect(ESCH[4], ANTI, { tex: 'EXEC' });

  const TERR = b.room(poly([38, 14, 66, 14, 66, 22, 38, 22]), {
    ...CEO_TIER,
    ceilZ: 5.6,
    light: 150,
    wallTex: 'EXEC',
  });

  // door + glass to the terrace: from the atrium floor the sight crosses the rail then this pane and
  // lands on the RED door — the goal visible from the first minute
  b.connect(ANTI, TERR, { at: [38, 15, 38, 18], tex: 'EXEC' });
  b.connect(ANTI, TERR, { kind: 'glassPane', at: [38, 18, 38, 21.5] });
  b.connect(TERR, ATRIUM, { kind: 'fence', at: [40, 22, 52, 22], tex: 'METAL' });
  b.connect(TERR, ATRIUM, { at: [52, 22, 56, 22], tex: 'EXEC' }); // shattered balustrade: 2.8 one-way DROP
  b.connect(TERR, ATRIUM, { kind: 'fence', at: [56, 22, 66, 22], tex: 'METAL' });

  // Thematic red door — held since M4, so it OPENS: executive clearance as world-building.
  const RDOOR = b.room(rect(26, 14, 27.5, 20), {
    ...CEO_TIER,
    ceilZ: 5.2,
    light: 160,
    wallTex: 'EXEC',
  });

  b.connect(RDOOR, ANTI, { tex: 'DOOR_RED' });

  const CEO = b.room(poly([10, 6, 26, 6, 26, 24, 8, 24, 6, 20, 6, 10]), {
    ...CEO_TIER,
    ceilZ: 6.4,
    ceilTex: 'CEIL_LUX',
    light: 175,
    wallTex: 'WOOD',
  });

  b.connect(CEO, RDOOR, { tex: 'DOOR_RED' });
  const EXTN = b.room(rect(12, 5.9, 20, 6), { ...ext, walls: { 3: 'CITY' } });

  b.connect(CEO, EXTN, { kind: 'glassPane', at: [12, 6, 20, 6] });
  const EXTW = b.room(rect(5.9, 12, 6, 20), { ...ext, walls: { 0: 'CITY' } });

  b.connect(CEO, EXTW, { kind: 'glassPane', at: [6, 12, 6, 20] });
  b.island(CEO, rect(10, 10, 16, 13), {
    floorZ: 3.3,
    ceilZ: 6.4,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'CEIL_LUX',
    light: 175,
    wallTex: 'WOOD',
  });

  const PSTEPS = b.stairs([8, 38], [12, 38], {
    depth: 2,
    count: 7,
    zBase: 0,
    dz: 0.4,
    ceilZ: 5.6,
    light: 125,
    wallTex: 'PILLAR',
    ceilTex: 'TECHNICAL',
  });

  b.connect(PSTEPS[6], CEO, { tex: 'WOOD' });
  // x stops at 13: ALC2 owns [13,16]×[38,42] — overlapping it made the shared span solid+portal at once
  const PALIER = b.room(rect(6, 38, 13, 46), {
    floorZ: 0,
    ceilZ: 3.0,
    floorTex: 'SLAB',
    ceilTex: 'TECHNICAL',
    light: 118,
    wallTex: 'PILLAR',
    walls: { 1: 'METAL' },
  });

  b.connect(PALIER, PSTEPS[0], { tex: 'PILLAR' });

  // The fault: a collapsed slab section — the Algorithm's cabling chewed up through the executive floor.
  // Walk-off drop 1.4 (mantle out anywhere), crossed by the surviving marble beam.
  const fault = {
    floorZ: -1.4,
    ceilZ: 4.4,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 95,
    wallTex: 'DAMAGED',
  };
  const FAULTW = b.room(poly([44, 58, 52, 58, 52, 72, 42, 72, 40, 68, 40, 62]), fault);
  const FAULTE = b.room(poly([54, 58, 64, 58, 68, 62, 68, 70, 64, 72, 54, 72]), fault);
  const BEAM = b.room(rect(52, 58, 54, 72), {
    floorZ: 0,
    ceilZ: 4.4,
    floorTex: 'MARBLE',
    ceilTex: 'NEON',
    light: 110,
    wallTex: 'DAMAGED',
  });

  b.connect(ATRIUM, FAULTW, { at: [44, 58, 52, 58], tex: 'DAMAGED' });
  b.connect(ATRIUM, BEAM, { at: [52, 58, 54, 58], tex: 'EXEC' });
  b.connect(ATRIUM, FAULTE, { at: [54, 58, 64, 58], tex: 'DAMAGED' });
  b.connect(BEAM, FAULTW, { tex: 'DAMAGED' });
  b.connect(BEAM, FAULTE, { tex: 'DAMAGED' });

  const SLEDGE = b.room(rect(42, 72, 71, 76), {
    ...MARBRE,
    ceilZ: 4.4,
    light: 130,
    wallTex: 'EXEC',
  });

  b.connect(FAULTW, SLEDGE, { tex: 'DAMAGED' });
  b.connect(BEAM, SLEDGE, { tex: 'EXEC' });
  b.connect(FAULTE, SLEDGE, { tex: 'DAMAGED' });

  // Secret 2 — the summit conduit. Unmarked DAMAGED panel in the fault's west wall; tells: the NEON
  // light-leak threshold strip down in the gash (the risk/reward dip guards it).
  const S2DOOR = b.room(rect(38.5, 63, 40, 66.5), {
    floorZ: -1.4,
    ceilZ: 1.2,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 200,
    wallTex: 'DAMAGED',
  });

  b.connect(FAULTW, S2DOOR, { tex: 'DAMAGED' });
  b.island(FAULTW, rect(40.1, 63, 40.6, 66.5), {
    floorZ: -1.35,
    ceilZ: 4.4,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 235,
    wallTex: 'DAMAGED',
  });
  const S2 = b.room(rect(33, 62, 38.5, 68), {
    floorZ: -1.4,
    ceilZ: 1.2,
    floorTex: 'SLAB',
    ceilTex: 'NEON',
    light: 125,
    wallTex: 'METAL',
  });

  b.connect(S2DOOR, S2, { tex: 'DAMAGED' });

  const DEBRIS = b.stairs([68, 63], [68, 69], {
    depth: 0.75,
    count: 4,
    zBase: -1.4,
    dz: 0.35,
    ceilZ: 3.0,
    light: 105,
    wallTex: 'DAMAGED',
    ceilTex: 'TECHNICAL',
  });

  b.connect(FAULTE, DEBRIS[0], { tex: 'DAMAGED' });

  const LOUNGE = b.room(poly([72, 58, 90, 58, 94, 62, 94, 76, 74, 78, 71, 76, 71, 63]), {
    floorZ: 0,
    ceilZ: 3.6,
    floorTex: 'CARPET',
    ceilTex: 'TECHNICAL',
    light: 135,
    wallTex: 'EXEC',
    walls: { 3: 'WOOD' },
  });

  b.connect(DEBRIS[3], LOUNGE, { tex: 'DAMAGED' });
  b.connect(SLEDGE, LOUNGE, { tex: 'EXEC' });
  b.connect(GALERIE, LOUNGE, { at: [76, 58, 80, 58], tex: 'EXEC' });
  b.island(LOUNGE, rect(84, 62, 90, 65), {
    floorZ: 1.3,
    ceilZ: 3.6,
    floorTex: 'COUNTER_TOP',
    ceilTex: 'TECHNICAL',
    light: 135,
    wallTex: 'RECEPTION',
  });
  const sofa = {
    floorZ: 0.9,
    ceilZ: 3.6,
    floorTex: 'STEP',
    ceilTex: 'TECHNICAL',
    light: 135,
    wallTex: 'WOOD',
  };

  b.island(LOUNGE, rect(76, 66, 80, 68), sofa);
  b.island(LOUNGE, rect(76, 71, 80, 73), sofa);

  b.thing(116, 58, Math.PI, 'player_start');
  b.thing(109.5, 64.5, 0, 'barrel');
  b.thing(111, 65, 0, 'barrel');
  b.thing(89, 55.5, 0, 'barrel');
  b.thing(91, 56.5, 0, 'barrel');
  b.thing(90, 54.2, 0, 'barrel');
  b.thing(66, 36, 0, 'barrel');
  b.thing(42, 44, 0, 'barrel');
  b.thing(27, 66, 0, 'barrel');
  b.thing(18, 80, 0, 'barrel');
  b.thing(58, 68, 0, 'barrel');
  b.thing(46, 74, 0, 'barrel');
  b.thing(7.5, 44.5, 0, 'barrel');

  // Directional props carry a MEANINGFUL facing; symmetric plants/coolers keep angle 0. The boardroom
  // chairs still ring the table facing the SCREEN wall — a last all-hands frozen mid-meeting; the CEO's
  // chair is turned to the skyline.
  b.thing(110.5, 51.5, Math.PI / 2, 'prop_totem');
  b.thing(94, 54, 2.1, 'prop_chair');
  b.thing(98, 56, 4.5, 'prop_chair');
  b.thing(105, 60, 0, 'prop_cooler');
  b.thing(74, 56, 0, 'prop');
  b.thing(84, 56.5, 0, 'prop');
  b.thing(82, 50, 0, 'prop_totem');
  b.thing(50, 39.5, Math.PI / 2, 'prop_screen');
  b.thing(58, 52, 0.8, 'prop_board');
  b.thing(45, 42, 2.4, 'prop_chair');
  b.thing(55, 42, 5.0, 'prop_chair');
  b.thing(49, 46, 1.2, 'prop_chair');
  b.thing(45, 33, 0, 'prop');
  b.thing(61, 47, 0, 'prop');
  b.thing(58, 46, 0, 'prop');
  b.thing(25, 48, 3.5, 'prop_board');
  b.thing(11, 47.7, 1.57, 'prop_screen');
  b.thing(16, 58, 1.0, 'prop_chair');
  b.thing(11, 66.2, 4.71, 'prop_screen');
  b.thing(15, 72.2, 1.57, 'prop_screen');
  b.thing(6, 72, Math.PI, 'prop_chair'); // the S1 tell: the chair faces the wainscot panel, not the desk
  b.thing(22, 70, 0, 'prop');
  b.thing(24, 34, 0, 'prop_screen');
  b.thing(17, 27.5, 0.5, 'prop_board');
  b.thing(19, 32, 0.3, 'prop_chair');
  b.thing(19, 36, 6.0, 'prop_chair');
  b.thing(23, 38.5, 1.6, 'prop_chair');
  b.thing(28, 38.5, 4.6, 'prop_chair');
  b.thing(33, 32, 3.2, 'prop_chair');
  b.thing(23, 29.5, 2.0, 'prop_chair');
  b.thing(28, 29.5, 5.2, 'prop_chair');
  b.thing(34, 20.5, 2.6, 'prop_board');
  b.thing(28.5, 13.5, 0, 'prop');
  b.thing(64, 16, 0, 'prop');
  b.thing(13, 11.5, Math.PI / 2, 'prop_screen');
  b.thing(14.5, 14.2, 5.0, 'prop_chair');
  b.thing(24.5, 8.5, 0, 'prop');
  b.thing(24.5, 21.5, 0, 'prop');
  b.thing(87, 63.5, Math.PI / 2, 'prop_screen');
  b.thing(82, 68, 2.2, 'prop_chair');
  b.thing(74, 64, 4.0, 'prop_chair');
  b.thing(92, 74, 0, 'prop_cooler');
  b.thing(73, 60.5, 0, 'prop');

  return {
    map: b.build(),
    redDoorSector: RDOOR,
    s1DoorSector: S1DOOR,
    s2DoorSector: S2DOOR,
  };
}

const built = buildMap();

export const M6_DIRECTION: Level = {
  map: built.map,
  spawn: { x: 116, y: 58, angle: Math.PI },
  enemies: [
    { spec: PINKY_SPEC, x: 96, y: 56 },
    { spec: PINKY_SPEC, x: 100, y: 58 },
    { spec: PINKY_SPEC, x: 47, y: 36 },
    { spec: PINKY_SPEC, x: 53, y: 36 },
    { spec: PINKY_SPEC, x: 50, y: 44 },
    { spec: KNIGHT_SPEC, x: 66, y: 46 },
    { spec: IMP_SPEC, x: 52.5, y: 17.5 },
    { spec: IMP_SPEC, x: 55.5, y: 16.5 },
    { spec: IMP_SPEC, x: 14, y: 50 },
    { spec: IMP_SPEC, x: 14, y: 57 },
    { spec: IMP_SPEC, x: 14, y: 64 },
    { spec: SHOTGUNGUY_SPEC, x: 22, y: 51 },
    { spec: SHOTGUNGUY_SPEC, x: 22, y: 63 },
    { spec: KNIGHT_SPEC, x: 12, y: 75 },
    { spec: LOSTSOUL_SPEC, x: 9, y: 79 },
    { spec: KNIGHT_SPEC, x: 18, y: 28.5 },
    { spec: KNIGHT_SPEC, x: 33, y: 34 },
    { spec: KNIGHT_SPEC, x: 21, y: 41 },
    { spec: LOSTSOUL_SPEC, x: 14.5, y: 30 },
    { spec: LOSTSOUL_SPEC, x: 14.5, y: 40 },
    { spec: PINKY_SPEC, x: 80, y: 64 },
    { spec: PINKY_SPEC, x: 84, y: 70 },
    { spec: LOSTSOUL_SPEC, x: 91, y: 64 },
    { spec: LOSTSOUL_SPEC, x: 90, y: 73 },
    { spec: SHOTGUNGUY_SPEC, x: 86, y: 67 },
    { spec: KNIGHT_SPEC, x: 78, y: 74 },
    { spec: LOSTSOUL_SPEC, x: 60, y: 66 },
    { spec: IMP_SPEC, x: 44, y: 69 },
    { spec: SHOTGUNGUY_SPEC, x: 30, y: 17 },
    { spec: SHOTGUNGUY_SPEC, x: 35, y: 19 },
    { spec: KNIGHT_SPEC, x: 14, y: 14 },
    { spec: KNIGHT_SPEC, x: 20, y: 18 },
    { spec: LOSTSOUL_SPEC, x: 10, y: 21 },
    { spec: SHOTGUNGUY_SPEC, x: 41, y: 18 },
  ],
  health: [
    [16, 75],
    [61, 18, 'small'],
  ],
  armor: [
    [0, 72],
    [47, 68, 'small'],
  ],
  ammo: [
    [78, 52], // staples
    [24, 56], // nails
    [23, 45.5], // canisters — staged at the boardroom door
    [92, 63.5], // cells
    [30.5, 20.5], // batteries
    [35.5, 65], // server-cell — the M7 tease in the summit conduit
  ],
  // no weapons: the arsenal pause — all six non-BFG weapons are seeded M1-M5, the tower stops giving
  keycards: [], // no badge objective — rank = altitude, the routing IS the objective
  entries: {
    main: { x: 116, y: 58, angle: Math.PI },
    'from-m5': { x: 116, y: 58, angle: Math.PI },
    'from-m7': { x: 7.5, y: 40, angle: -Math.PI / 2 }, // faces the stairs — facing the exit pad re-triggers the return
  },
  exits: [
    { x: 122.3, y: 58, to: 'm5', entry: 'from-m6' },
    { x: 11, y: 42, to: 'm7', entry: 'from-m6' },
  ],
  doors: [
    { sector: built.redDoorSector, triggerX: 26.75, triggerY: 17, requiresCard: 'red' },
    { sector: built.s1DoorSector, triggerX: 3.25, triggerY: 72, requiresCard: null },
    { sector: built.s2DoorSector, triggerX: 39.25, triggerY: 64.75, requiresCard: null },
  ],
};
