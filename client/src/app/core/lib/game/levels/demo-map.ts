import type { LineDef, MapSource, SideDef } from '../../bsp-engine';

// Winding: outer walls one-sided fronting their sector (on the wall's RIGHT); a portal's FRONT is its
// HIGHER sector. Dais rings wound CW (higher inner sector on the front); bowl rings wound CCW (higher
// OUTER side on the front) — the inverse, since the low floor sits inside.

const ROOM = 0;
const TOP = 1;
const STEP1 = 2;
const STEP2 = 3;
const PIT = 4;
const PIT2 = 5;
const PED = 6;
const CORRIDOR = 7;
const BALCONY = 8;
const HALL = 9;
const STAIR1 = 10;
const STAIR2 = 11;

function side(sector: number, tex: string): SideDef {
  return { sector, xOffset: 0, yOffset: 0, upperTex: tex, lowerTex: tex, middleTex: tex };
}

/** One-sided outer wall fronting `sector`, wound so the sector sits on its RIGHT. */
function solid(v1: number, v2: number, sector: number = ROOM, tex = 'BRICK'): LineDef {
  return { v1, v2, front: side(sector, tex), back: null };
}

function wall(v1: number, v2: number): LineDef {
  return solid(v1, v2, ROOM);
}

/** Two-sided step/pit edge — front = the HIGHER sector, back = the lower. */
function portal(v1: number, v2: number, front: number, back: number): LineDef {
  return { v1, v2, front: side(front, 'METAL'), back: side(back, 'METAL') };
}

export const DEMO_MAP: MapSource = {
  vertices: [
    { x: 0, y: 0 }, // 0
    { x: 0, y: 12 }, // 1
    { x: 15, y: 12 }, // 2
    { x: 20, y: 8 }, // 3  chamfer (free angle)
    { x: 20, y: 0 }, // 4
    { x: 3, y: 2 }, // 5  pit
    { x: 7, y: 2 }, // 6
    { x: 7, y: 6 }, // 7
    { x: 3, y: 6 }, // 8
    { x: 12, y: 3 }, // 9  dais outer diamond
    { x: 8, y: 6 }, // 10
    { x: 12, y: 9 }, // 11
    { x: 16, y: 6 }, // 12
    { x: 12, y: 3.7 }, // 13 dais middle
    { x: 9, y: 6 }, // 14
    { x: 12, y: 8.3 }, // 15
    { x: 15, y: 6 }, // 16
    { x: 12, y: 4.4 }, // 17 dais inner
    { x: 10, y: 6 }, // 18
    { x: 12, y: 7.6 }, // 19
    { x: 14, y: 6 }, // 20
    { x: 4.2, y: 3.2 }, // 21 bowl centre
    { x: 5.8, y: 3.2 }, // 22
    { x: 5.8, y: 4.8 }, // 23
    { x: 4.2, y: 4.8 }, // 24
    { x: 16.5, y: 0.5 }, // 25 pedestal
    { x: 16.5, y: 3 }, // 26
    { x: 19, y: 3 }, // 27
    { x: 19, y: 0.5 }, // 28
    { x: 20, y: 6 }, // 29 doorway (north jamb)
    { x: 20, y: 3 }, // 30 doorway (south jamb)
    { x: 23, y: 3 }, // 31 corridor SE
    { x: 23, y: 6 }, // 32 corridor NE
    { x: 23, y: 1 }, // 33 balcony SW
    { x: 23, y: 13 }, // 34 balcony NW
    { x: 28, y: 13 }, // 35 balcony NE / hall NW
    { x: 28, y: 1 }, // 36 balcony SE / stair1 SW
    { x: 28, y: 4 }, // 37 balcony east edge: overlook (north) ↔ stair top (south)
    { x: 30, y: 1 }, // 38 stair1|stair2 (south)
    { x: 30, y: 4 }, // 39 stair1|stair2 (north)
    { x: 32, y: 1 }, // 40 stair2|hall (south)
    { x: 32, y: 4 }, // 41 stair2|hall (north)
    { x: 42, y: 13 }, // 42 hall NE
    { x: 42, y: 1 }, // 43 hall SE
  ],
  sectors: [
    { floorZ: 0, ceilZ: 5, floorTex: 'FLOOR', ceilTex: 'SKY', light: 200 }, // 0 room
    { floorZ: 1, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 228 }, // 1 dais top (canopy)
    { floorZ: 0.33, ceilZ: 5, floorTex: 'STEP', ceilTex: 'SKY', light: 208 }, // 2 step 1
    { floorZ: 0.66, ceilZ: 5, floorTex: 'STEP', ceilTex: 'SKY', light: 218 }, // 3 step 2
    { floorZ: -0.8, ceilZ: 5, floorTex: 'METAL', ceilTex: 'SKY', light: 150 }, // 4 pit outer ring
    { floorZ: -1.6, ceilZ: 5, floorTex: 'METAL', ceilTex: 'SKY', light: 132 }, // 5 bowl centre
    { floorZ: 1.6, ceilZ: 5, floorTex: 'STEP', ceilTex: 'SKY', light: 232 }, // 6 pedestal (mantle target)
    { floorZ: 0, ceilZ: 5, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 205 }, // 7 corridor
    { floorZ: 0, ceilZ: 6, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 212 }, // 8 balcony
    { floorZ: -2.7, ceilZ: 7, floorTex: 'METAL', ceilTex: 'CEIL', light: 160 }, // 9 hall (2.7 > climbMax: overlook is a pure drop)
    { floorZ: -0.9, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 192 }, // 10 staircase step 1
    { floorZ: -1.8, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 176 }, // 11 staircase step 2
  ],
  linedefs: [
    wall(0, 1),
    wall(1, 2),
    wall(2, 3),
    wall(3, 29),
    portal(29, 30, ROOM, CORRIDOR),
    wall(30, 4),
    wall(4, 0),
    // Pit ring — CCW (higher room on front), a −0.8 step climbable back out.
    portal(5, 6, ROOM, PIT),
    portal(6, 7, ROOM, PIT),
    portal(7, 8, ROOM, PIT),
    portal(8, 5, ROOM, PIT),
    // Bowl centre — a second −0.8 step, CCW (higher ring on front).
    portal(21, 22, PIT, PIT2),
    portal(22, 23, PIT, PIT2),
    portal(23, 24, PIT, PIT2),
    portal(24, 21, PIT, PIT2),
    // Dais rings — CW (higher inner sector on front), three concentric diamonds.
    portal(9, 10, STEP1, ROOM),
    portal(10, 11, STEP1, ROOM),
    portal(11, 12, STEP1, ROOM),
    portal(12, 9, STEP1, ROOM),
    portal(13, 14, STEP2, STEP1),
    portal(14, 15, STEP2, STEP1),
    portal(15, 16, STEP2, STEP1),
    portal(16, 13, STEP2, STEP1),
    portal(17, 18, TOP, STEP2),
    portal(18, 19, TOP, STEP2),
    portal(19, 20, TOP, STEP2),
    portal(20, 17, TOP, STEP2),
    // Pedestal — CW (higher PED on front): each face a too-tall-but-mantleable ledge.
    portal(25, 26, PED, ROOM),
    portal(26, 27, PED, ROOM),
    portal(27, 28, PED, ROOM),
    portal(28, 25, PED, ROOM),
    solid(29, 32, CORRIDOR),
    portal(32, 31, CORRIDOR, BALCONY),
    solid(31, 30, CORRIDOR),
    solid(33, 31, BALCONY),
    solid(32, 34, BALCONY),
    solid(34, 35, BALCONY),
    portal(35, 37, BALCONY, HALL), // OVERLOOK — one-way 1.6 drop
    portal(37, 36, BALCONY, STAIR1),
    solid(36, 33, BALCONY),
    portal(39, 38, STAIR1, STAIR2),
    portal(37, 39, STAIR1, HALL),
    solid(38, 36, STAIR1),
    portal(41, 40, STAIR2, HALL),
    portal(39, 41, STAIR2, HALL),
    solid(40, 38, STAIR2),
    solid(35, 42, HALL),
    solid(42, 43, HALL),
    solid(43, 40, HALL),
  ],
  things: [
    { x: 2, y: 10, angle: 0, type: 'player_start' },
    { x: 10, y: 2, angle: 0, type: 'barrel' },
    { x: 17, y: 4, angle: 0, type: 'barrel' },
    { x: 4, y: 9, angle: 0, type: 'barrel' },
    { x: 5, y: 9, angle: 0, type: 'barrel' },
    { x: 4, y: 10, angle: 0, type: 'barrel' },
    { x: 5, y: 10, angle: 0, type: 'barrel' },
    { x: 37, y: 8, angle: 0, type: 'barrel' },
    { x: 39, y: 5, angle: 0, type: 'barrel' },
  ],
};
