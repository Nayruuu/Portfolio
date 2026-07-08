import type { LineDef, MapSource, SideDef } from '../../bsp-engine';

/**
 * The BSP demo's playable showcase map — richer than the engine's `SAMPLE_MAP` test fixture (which stays
 * frozen for the byte-identical renderer tests). An open-air courtyard exercising the engine's geometry:
 *
 *   • a **free-angle** chamfered NE corner (slope ≠ axis, ≠ 45°),
 *   • a **stepped dais** (three concentric diamond portals, floors 0.33 → 0.66 → 1.0) you climb UP, under a
 *     low CEIL canopy (the rest of the map is open SKY),
 *   • a **stepped bowl** (two concentric −0.8 steps down to −1.6): you walk DOWN into it and back out
 *     (each step ≤ stepMax), the inverse of the dais,
 *   • a **tall pedestal** (floor 1.6): too high to step, so walking into it AUTO-MANTLES you up over the lip,
 *   • an **east annex** through a doorway: a corridor → a mezzanine **balcony** that overlooks a sunken grand
 *     **hall** (−2.7, tall ceiling) — the balcony's edge is a one-way 2.7 drop, too deep to mantle back up —
 *     with a **staircase** (the only way back up) stepping 0 → −0.9 → −1.8 → −2.7 down into the hall.
 *
 * Winding: outer walls one-sided fronting their sector (on the wall's RIGHT); a portal's FRONT is its HIGHER
 * sector. The dais rings are wound CW (higher inner sector on the front); the bowl rings are wound CCW (higher
 * OUTER side on the front) — the inverse, since the low floor sits inside.
 */

const ROOM = 0;
const TOP = 1; // raised dais top
const STEP1 = 2; // dais outer ring (lowest step)
const STEP2 = 3; // dais middle ring
const PIT = 4; // sunken floor (outer ring of the stepped bowl — climbable in/out)
const PIT2 = 5; // bowl centre (deeper, darker)
const PED = 6; // a tall free-standing pedestal — too high to step (rise 1.6 > stepMax), you auto-MANTLE onto it
// The east annex (reached through a doorway in the room's east wall): a covered wing showing a connecting
// corridor, a mezzanine balcony that OVERLOOKS a sunken grand hall, and a stepped staircase down into it.
const CORRIDOR = 7; // the vestibule between the room and the balcony
const BALCONY = 8; // the mezzanine walkway (floor 0) overlooking the hall — its east edge is a 1.6 drop
const HALL = 9; // the sunken grand hall (floor −1.6, tall ceiling)
const STAIR1 = 10; // staircase step 1 (−0.55)
const STAIR2 = 11; // staircase step 2 (−1.1) → the hall floor (−1.6)

function side(sector: number, tex: string): SideDef {
  return { sector, xOffset: 0, yOffset: 0, upperTex: tex, lowerTex: tex, middleTex: tex };
}

/** A one-sided outer wall fronting `sector` (default the room), wound so the sector sits on its RIGHT. */
function solid(v1: number, v2: number, sector: number = ROOM, tex = 'BRICK'): LineDef {
  return { v1, v2, front: side(sector, tex), back: null };
}

/** A one-sided outer wall fronting the room — brick. */
function wall(v1: number, v2: number): LineDef {
  return solid(v1, v2, ROOM);
}

/** A two-sided step/pit edge (front = the higher sector, back = the lower) — metal both sides. */
function portal(v1: number, v2: number, front: number, back: number): LineDef {
  return { v1, v2, front: side(front, 'METAL'), back: side(back, 'METAL') };
}

export const DEMO_MAP: MapSource = {
  vertices: [
    { x: 0, y: 0 }, // 0  room outer
    { x: 0, y: 12 }, // 1
    { x: 15, y: 12 }, // 2
    { x: 20, y: 8 }, // 3  chamfer (free angle, slope -4/5)
    { x: 20, y: 0 }, // 4
    { x: 3, y: 2 }, // 5  pit (bottom-left)
    { x: 7, y: 2 }, // 6  pit (bottom-right)
    { x: 7, y: 6 }, // 7  pit (top-right)
    { x: 3, y: 6 }, // 8  pit (top-left)
    { x: 12, y: 3 }, // 9  dais outer diamond — bottom
    { x: 8, y: 6 }, // 10 outer — left
    { x: 12, y: 9 }, // 11 outer — top
    { x: 16, y: 6 }, // 12 outer — right
    { x: 12, y: 3.7 }, // 13 dais middle — bottom
    { x: 9, y: 6 }, // 14 middle — left
    { x: 12, y: 8.3 }, // 15 middle — top
    { x: 15, y: 6 }, // 16 middle — right
    { x: 12, y: 4.4 }, // 17 dais inner — bottom
    { x: 10, y: 6 }, // 18 inner — left
    { x: 12, y: 7.6 }, // 19 inner — top
    { x: 14, y: 6 }, // 20 inner — right
    { x: 4.2, y: 3.2 }, // 21 bowl centre (bottom-left)
    { x: 5.8, y: 3.2 }, // 22 bowl centre (bottom-right)
    { x: 5.8, y: 4.8 }, // 23 bowl centre (top-right)
    { x: 4.2, y: 4.8 }, // 24 bowl centre (top-left)
    { x: 16.5, y: 0.5 }, // 25 pedestal (SW) — wound CW so the higher PED sits on each edge's front
    { x: 16.5, y: 3 }, // 26 pedestal (NW)
    { x: 19, y: 3 }, // 27 pedestal (NE)
    { x: 19, y: 0.5 }, // 28 pedestal (SE)
    // East annex. Doorway jambs in the room's east wall (x=20):
    { x: 20, y: 6 }, // 29 doorway (north jamb)
    { x: 20, y: 3 }, // 30 doorway (south jamb)
    // Corridor (x 20–23, y 3–6):
    { x: 23, y: 3 }, // 31 corridor SE
    { x: 23, y: 6 }, // 32 corridor NE
    // Balcony (x 23–28, y 1–13):
    { x: 23, y: 1 }, // 33 balcony SW
    { x: 23, y: 13 }, // 34 balcony NW
    { x: 28, y: 13 }, // 35 balcony NE / hall NW
    { x: 28, y: 1 }, // 36 balcony SE / stair1 SW
    { x: 28, y: 4 }, // 37 balcony east edge: overlook (north) ↔ stair top (south)
    // Staircase (x 28–32, y 1–4), two steps down into the hall:
    { x: 30, y: 1 }, // 38 stair1|stair2 (south)
    { x: 30, y: 4 }, // 39 stair1|stair2 (north)
    { x: 32, y: 1 }, // 40 stair2|hall (south)
    { x: 32, y: 4 }, // 41 stair2|hall (north)
    // Hall outer (x up to 42):
    { x: 42, y: 13 }, // 42 hall NE
    { x: 42, y: 1 }, // 43 hall SE
  ],
  sectors: [
    // Open-air courtyard: every sector's ceiling is SKY (a gradient roof) EXCEPT the dais peak, which keeps a
    // solid low CEIL — a canopy/pavilion over the centre (also the engine's variable-ceiling-height showcase).
    { floorZ: 0, ceilZ: 5, floorTex: 'FLOOR', ceilTex: 'SKY', light: 200 }, // 0 room
    { floorZ: 1, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 228 }, // 1 dais top (canopy roof)
    { floorZ: 0.33, ceilZ: 5, floorTex: 'STEP', ceilTex: 'SKY', light: 208 }, // 2 step 1
    { floorZ: 0.66, ceilZ: 5, floorTex: 'STEP', ceilTex: 'SKY', light: 218 }, // 3 step 2
    { floorZ: -0.8, ceilZ: 5, floorTex: 'METAL', ceilTex: 'SKY', light: 150 }, // 4 pit outer ring
    { floorZ: -1.6, ceilZ: 5, floorTex: 'METAL', ceilTex: 'SKY', light: 132 }, // 5 bowl centre (deeper, darker)
    { floorZ: 1.6, ceilZ: 5, floorTex: 'STEP', ceilTex: 'SKY', light: 232 }, // 6 pedestal top (mantle target)
    // The covered east annex — solid CEIL ceilings (indoors), contrasting the open-SKY courtyard.
    { floorZ: 0, ceilZ: 5, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 205 }, // 7 corridor
    { floorZ: 0, ceilZ: 6, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 212 }, // 8 balcony (mezzanine)
    { floorZ: -2.7, ceilZ: 7, floorTex: 'METAL', ceilTex: 'CEIL', light: 160 }, // 9 sunken grand hall (deep: 2.7 > climbMax, the overlook is a pure drop)
    { floorZ: -0.9, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 192 }, // 10 staircase step 1
    { floorZ: -1.8, ceilZ: 7, floorTex: 'STEP', ceilTex: 'CEIL', light: 176 }, // 11 staircase step 2
  ],
  linedefs: [
    // Outer room walls (one-sided, front = room). The east wall carries the annex doorway (y 3–6).
    wall(0, 1),
    wall(1, 2),
    wall(2, 3),
    wall(3, 29), // east wall, above the doorway
    portal(29, 30, ROOM, CORRIDOR), // the doorway (same floor → an open passage)
    wall(30, 4), // east wall, below the doorway
    wall(4, 0),
    // Pit ring — a −0.8 step DOWN, wound CCW so the higher room is on the front of every edge (climbable
    // back out: 0.8 ≤ stepMax).
    portal(5, 6, ROOM, PIT), // south
    portal(6, 7, ROOM, PIT), // east
    portal(7, 8, ROOM, PIT), // north
    portal(8, 5, ROOM, PIT), // west
    // Bowl centre — a second −0.8 step DOWN (−0.8 → −1.6), wound CCW so the higher ring is on the front.
    portal(21, 22, PIT, PIT2), // south
    portal(22, 23, PIT, PIT2), // east
    portal(23, 24, PIT, PIT2), // north
    portal(24, 21, PIT, PIT2), // west
    // Dais rings — wound CW (higher inner sector on the front), three concentric diamonds.
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
    // Pedestal — four edges of a free-standing +1.6 block, wound CW (higher PED on the front), so each face
    // is a too-tall-but-climbable ledge you auto-mantle over (and drop back off any side).
    portal(25, 26, PED, ROOM),
    portal(26, 27, PED, ROOM),
    portal(27, 28, PED, ROOM),
    portal(28, 25, PED, ROOM),
    // === East annex ===
    // Corridor (sector 7): top + bottom one-sided walls, east edge a same-floor portal to the balcony.
    solid(29, 32, CORRIDOR), // north wall (20,6)→(23,6)
    portal(32, 31, CORRIDOR, BALCONY), // east passage to the balcony
    solid(31, 30, CORRIDOR), // south wall (23,3)→(20,3)
    // Balcony (sector 8): west wall (split by the corridor portal), north + south walls, and the east edge —
    // a 1.6 overlook drop to the hall (north of the stairs) then the stair top (south).
    solid(33, 31, BALCONY), // west wall below the corridor (23,1)→(23,3)
    solid(32, 34, BALCONY), // west wall above the corridor (23,6)→(23,13)
    solid(34, 35, BALCONY), // north wall (23,13)→(28,13)
    portal(35, 37, BALCONY, HALL), // OVERLOOK — balcony (0) over the hall (−1.6): a one-way 1.6 drop
    portal(37, 36, BALCONY, STAIR1), // the top of the staircase (a −0.55 step)
    solid(36, 33, BALCONY), // south wall (28,1)→(23,1)
    // Staircase: step 1 (sector 10) then step 2 (sector 11), each a one-sided south wall + portals down.
    portal(39, 38, STAIR1, STAIR2), // step1 → step2 (east edge, −0.55 → −1.1)
    portal(37, 39, STAIR1, HALL), // step1's north edge drops to the hall floor
    solid(38, 36, STAIR1), // step1 south wall (30,1)→(28,1)
    portal(41, 40, STAIR2, HALL), // step2 → hall floor (east edge, −1.1 → −1.6)
    portal(39, 41, STAIR2, HALL), // step2's north edge drops to the hall floor
    solid(40, 38, STAIR2), // step2 south wall (32,1)→(30,1)
    // Hall (sector 9): the three outer walls (north, east, south arm) — the rest of its boundary is the
    // balcony/stair portals above.
    solid(35, 42, HALL), // north wall (28,13)→(42,13)
    solid(42, 43, HALL), // east wall (42,13)→(42,1)
    solid(43, 40, HALL), // south wall (42,1)→(32,1)
  ],
  things: [
    { x: 2, y: 10, angle: 0, type: 'player_start' },
    { x: 10, y: 2, angle: 0, type: 'barrel' },
    { x: 17, y: 4, angle: 0, type: 'barrel' },
    // a tight cluster (clear room floor, NW) so the plasma chain has nearby hops
    { x: 4, y: 9, angle: 0, type: 'barrel' },
    { x: 5, y: 9, angle: 0, type: 'barrel' },
    { x: 4, y: 10, angle: 0, type: 'barrel' },
    { x: 5, y: 10, angle: 0, type: 'barrel' },
    // down in the sunken hall (shoot from the balcony, or after descending the stairs)
    { x: 37, y: 8, angle: 0, type: 'barrel' },
    { x: 39, y: 5, angle: 0, type: 'barrel' },
  ],
};
