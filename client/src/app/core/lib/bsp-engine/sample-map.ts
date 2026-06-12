import type { LineDef, MapSource, SideDef } from './types';

/**
 * A tiny hand-authored test map exercising the cases the node builder + renderer must handle: a
 * **free-angle** wall (the chamfered NE corner — not 0/45/90°), and a **stepped dais** built from three
 * **concentric diamond** portal loops, so a column can cross several sector heights in a row (the case
 * that exposes flat z-fighting). Walking in from the room you climb three even steps onto the top dais:
 *
 *      (0,10)──────────(12,10)
 *        │                   ╲
 *        │       ╱▒▒▒╲        ╲(16,6)   ← free-angle wall (slope -4/4 ≠ axis, ≠ 45°-grid)
 *        │      ▒ ╱█╲ ▒        │
 *        │      ▒ █▲█ ▒        │        ▒ = step rings (0.33, 0.66)   █▲ = top dais (1.0)
 *        │      ▒ ╲█╱ ▒        │
 *        │       ╲▒▒▒╱         │        three concentric diamonds, each a two-sided portal (a step up)
 *        │                     │
 *      (0,0)──────────────(16,0)
 *
 * Outer walls are one-sided (front = the room, sector 0). Each diamond ring is a two-sided portal loop,
 * wound so the HIGHER (inner) sector is on the FRONT of every edge; the room floor is tan, the dais metal.
 */

const ROOM = 0;
const TOP = 1; // the innermost diamond — the raised dais (kept as sector 1: the by-hand reference point)
const STEP1 = 2; // outer ring (lowest step)
const STEP2 = 3; // middle ring

/** A one-sided outer wall fronting the room — brick. */
function wall(v1: number, v2: number): LineDef {
  return { v1, v2, front: side(ROOM, 'BRICK'), back: null };
}

/** A two-sided dais-ring edge (front = the higher/inner sector, back = the lower/outer) — metal both sides. */
function portal(v1: number, v2: number, front: number, back: number): LineDef {
  return { v1, v2, front: side(front, 'METAL'), back: side(back, 'METAL') };
}

function side(sector: number, tex: string): SideDef {
  return { sector, xOffset: 0, yOffset: 0, upperTex: tex, lowerTex: tex, middleTex: tex };
}

export const SAMPLE_MAP: MapSource = {
  vertices: [
    { x: 0, y: 0 }, // 0
    { x: 0, y: 10 }, // 1
    { x: 12, y: 10 }, // 2
    { x: 16, y: 6 }, // 3  (chamfered corner → free angle)
    { x: 16, y: 0 }, // 4
    { x: 8, y: 2 }, // 5  outer diamond — bottom
    { x: 12, y: 5 }, // 6  outer — right
    { x: 8, y: 8 }, // 7  outer — top
    { x: 4, y: 5 }, // 8  outer — left
    { x: 8, y: 3 }, // 9  middle diamond — bottom
    { x: 11, y: 5 }, // 10 middle — right
    { x: 8, y: 7 }, // 11 middle — top
    { x: 5, y: 5 }, // 12 middle — left
    { x: 8, y: 4 }, // 13 inner diamond — bottom
    { x: 10, y: 5 }, // 14 inner — right
    { x: 8, y: 6 }, // 15 inner — top
    { x: 6, y: 5 }, // 16 inner — left
  ],
  sectors: [
    { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 }, // 0 room
    { floorZ: 1, ceilZ: 3, floorTex: 'STEP', ceilTex: 'CEIL', light: 224 }, // 1 top dais (lower ceiling = canopy)
    { floorZ: 0.33, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 208 }, // 2 step 1 (outer ring)
    { floorZ: 0.66, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 216 }, // 3 step 2 (middle ring)
  ],
  // Outer loop wound (CCW, y-up) so the room (sector 0) is on the FRONT — the right of each edge.
  linedefs: [
    wall(0, 1),
    wall(1, 2),
    wall(2, 3),
    wall(3, 4),
    wall(4, 0),
    // Each diamond wound (bottom→left→top→right) so the inner/higher sector is on the FRONT of each edge.
    portal(5, 8, STEP1, ROOM), // outer diamond: room → step 1
    portal(8, 7, STEP1, ROOM),
    portal(7, 6, STEP1, ROOM),
    portal(6, 5, STEP1, ROOM),
    portal(9, 12, STEP2, STEP1), // middle diamond: step 1 → step 2
    portal(12, 11, STEP2, STEP1),
    portal(11, 10, STEP2, STEP1),
    portal(10, 9, STEP2, STEP1),
    portal(13, 16, TOP, STEP2), // inner diamond: step 2 → top dais
    portal(16, 15, TOP, STEP2),
    portal(15, 14, TOP, STEP2),
    portal(14, 13, TOP, STEP2),
  ],
  things: [
    { x: 3, y: 5, angle: 0, type: 'player_start' },
    { x: 5, y: 3, angle: 0, type: 'barrel' },
    { x: 13, y: 7, angle: 0, type: 'barrel' },
    { x: 2, y: 8, angle: 0, type: 'barrel' },
  ],
};
