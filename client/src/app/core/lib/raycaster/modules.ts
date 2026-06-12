import { parseModule } from './module';
import type { Module, ModuleDef } from './module';

/** A flat 13×13 path room with a door top + bottom and the player spawn — the simplest connectable piece. */
export const FLAT_ROOM: ModuleDef = {
  name: 'flat_room',
  role: 'path',
  layout: `######DD#####
           #...........#
           #...........#
           #...........#
           #...........#
           #...........#
           #.....S.....#
           #...........#
           #...........#
           #...........#
           #...........#
           #...........#
           ######DD#####`,
};

/** A 13×13 room: you spawn on open base floor facing a raised STAGE at the far end (a step z 0.3 up to a
 *  platform z 0.45) with an enemy standing ON it, plus a pickup on the base floor. Heights + varied SHAPES
 *  (diagonals) now COEXIST — the height render path renders diagonal walls correctly (`raycast.ts`
 *  `marchDiagFace`). Heights stay ≤ 0.45 so the flat ceiling (`WALL_HEIGHT`) keeps player headroom. */
export const LEDGE_ROOM: ModuleDef = {
  name: 'ledge_room',
  role: 'side',
  layout: `######DD#####
           #.....S.....#
           #...........#
           #....P......#
           #...........#
           #...........#
           #...........#
           #..3333333..#
           #..6666666..#
           #..6666666..#
           #..66g6666..#
           #...........#
           ######DD#####`,
  legend: {
    '3': { floorZ: 0.3 },
    '6': { floorZ: 0.45 },
    g: { enemy: 'manager', floorZ: 0.45 }, // enemy standing ON the 0.45 stage (carries floorZ so it isn't in a z0 hole)
  },
};

/** PROOF fixture for the diagonal pipeline (NOT in `MODULE_LIBRARY` — the varied-shape authoring is a later
 *  task): a 13×13 OCTAGON whose four corner cells are 45° chamfers via the `q`/`e`/`z`/`c` legend chars
 *  (NW/NE/SW/SE), with N + S centre doorways so it still stitches like any path module. The solid triangle of
 *  each chamfer faces its outside corner, so the hypotenuses open the room inward into an octagon. */
export const OCTAGON_TEST: ModuleDef = {
  name: 'octagon_test',
  role: 'path',
  layout: `q#####DD####e
           #...........#
           #...........#
           #...........#
           #...........#
           #...........#
           #.....S.....#
           #...........#
           #...........#
           #...........#
           #...........#
           #...........#
           z#####DD####c`,
};

// -- assembler library: connectable 13×13 prefabs with 2-cell CENTRE doorways (indices 6–7 of each edge:
// N=(6/7,0), S=(6/7,12), W=(0,6/7), E=(12,6/7)) so a 0.4-radius player passes; doors of facing modules align --
//
// The TUNED BACKBONE: every (role, exitMask) the path generator emits is covered by a content-bearing `path`
// module here, so the main route a player walks is a running fight — a tuned mix per room (a drone or two as
// the staple + a husk `E` for melee pressure, a `m` middle-manager bruiser in the BIGGER rooms), an `A` ammo
// box every room, and a `P` health pickup in roughly half (the bigger ones), never a synthesized empty
// corridor. Per-module counts are kept light (caps/corners ~2, hall/tees ~3, cross 4) so a level totals
// ~12–20 enemies. The path generator (`carveGrid`) emits exactly these path masks
// (verified by `modules.spec` over a seed sweep): the two single-door END CAPS (E, W — the entrance/exit can
// step sideways along a row), the four L-CORNERS (NE, ES, NW, SW), the straight HALL (E|W), the four
// T-JUNCTIONS (NES, NEW, NSW, ESW), and the 4-way CROSS — twelve in all. (N-only, S-only and the straight
// N|S never arise: a path cell always opens to its side-room neighbours, and a vertical run keeps `FLAT_ROOM`
// — kept as the N|S safety net + the documented simplest piece — from being the only thing in the library
// for that mask.) Every room keeps a clear z=0 walkable route between its doors; a `3` step (z 0.3 ≤
// STEP_UP_MAX) is cover only, never a wall across the route.

/** End cap — one door E (mask E). A single-door path room (the entrance/exit stepping sideways along a row);
 *  a drone + a husk (melee) + an ammo box guard it. */
const PATH_CAP_E: ModuleDef = {
  name: 'path_cap_e',
  role: 'path',
  layout: `#############
           #...........#
           #..d........#
           #.....A.....#
           #...........#
           #...........#
           #...........D
           #...........D
           #....E......#
           #...........#
           #...........#
           #...........#
           #############`,
};

/** End cap — one door W (mask W). The mirror of `PATH_CAP_E`; a drone + a husk + ammo. */
const PATH_CAP_W: ModuleDef = {
  name: 'path_cap_w',
  role: 'path',
  layout: `#############
           #...........#
           #........d..#
           #.....A.....#
           #...........#
           #...........#
           D...........#
           D...........#
           #......E....#
           #...........#
           #...........#
           #...........#
           #############`,
};

/** L-corner — doors N + E (mask N|E). Turns a vertical run into a horizontal one; a drone + a husk, ammo, and
 *  a 0.3 cover step tucked clear of the doorways. */
const PATH_CORNER_NE: ModuleDef = {
  name: 'path_corner_ne',
  role: 'path',
  layout: `######DD#####
           #...........#
           #...d.......#
           #.......A...#
           #...........#
           #...........#
           #...........D
           #...........D
           #...E.......#
           #.......33..#
           #.......33..#
           #...........#
           #############`,
  legend: { '3': { floorZ: 0.3 } },
};

/** L-corner — doors E + S (mask E|S). A drone + a husk, ammo, a 0.3 cover step */
const PATH_CORNER_ES: ModuleDef = {
  name: 'path_corner_es',
  role: 'path',
  layout: `#############
           #...........#
           #......d....#
           #...A.......#
           #...........#
           #...........#
           #...........D
           #...........D
           #...E.......#
           #...........#
           #..33.......#
           #..33.......#
           ######DD#####`,
  legend: { '3': { floorZ: 0.3 } },
};

/** L-corner — doors N + W (mask N|W). A drone + a husk, ammo, a 0.3 cover step */
const PATH_CORNER_NW: ModuleDef = {
  name: 'path_corner_nw',
  role: 'path',
  layout: `######DD#####
           #...........#
           #.......d...#
           #.....A.....#
           #...........#
           #...........#
           D...........#
           D...........#
           #......E....#
           #.......33..#
           #.......33..#
           #...........#
           #############`,
  legend: { '3': { floorZ: 0.3 } },
};

/** L-corner — doors S + W (mask S|W). A drone + a husk, ammo, a 0.3 cover step */
const PATH_CORNER_SW: ModuleDef = {
  name: 'path_corner_sw',
  role: 'path',
  layout: `#############
           #...........#
           #......d....#
           #...A.......#
           #...........#
           #...........#
           D...........#
           D...........#
           #....E......#
           #.......33..#
           #.......33..#
           #...........#
           ######DD#####`,
  legend: { '3': { floorZ: 0.3 } },
};

/** A flat horizontal hall — doors W + E (mask W|E). A bigger room: a drone + a husk + a middle-manager bruiser
 *  + a health pickup + a central ammo box; the route runs clean across the middle rows. */
const PATH_HALL_H: ModuleDef = {
  name: 'path_hall_h',
  role: 'path',
  layout: `#############
           #...........#
           #...d...G...#
           #...........#
           #...P.A.....#
           #...........#
           D...........D
           D...........D
           #...........#
           #.....E.....#
           #...........#
           #...........#
           #############`,
};

/** T-junction — doors N + E + S (mask N|E|S). Re-shaped as a bold OCTAGON (all four corners bevelled ~3 cells
 *  via the `q`/`e`/`z`/`c` chamfers + solid corner triangles): a drone + a husk + a middle-manager + a health
 *  pickup + ammo; the N–S corridor and the E spur stay open through the centre, clear of the bevelled corners. */
const PATH_TEE_NES: ModuleDef = {
  name: 'path_tee_nes',
  role: 'path',
  layout: `######DD#####
           ###q.....e###
           ##q.d.....e##
           #q......m..e#
           #...P.A.....#
           #...........#
           #...........D
           #...........D
           #....E......#
           #z.........c#
           ##z.......c##
           ###z.....c###
           ######DD#####`,
};

/** T-junction — doors N + E + W (mask N|E|W). Re-shaped as an L-ROOM — the solid S edge's bottom-RIGHT quadrant
 *  is filled with `#`, so the open floor turns the corner into an L while the N spur and the W↔E run stay clear:
 *  a drone + a husk (tucked in the surviving bottom-left alcove) + a middle-manager + a health pickup + ammo. */
const PATH_TEE_NEW: ModuleDef = {
  name: 'path_tee_new',
  role: 'path',
  layout: `######DD#####
           #...........#
           #...d.......#
           #.......m...#
           #...P.A.....#
           #...........#
           D...........D
           D...........D
           #....E.######
           #......######
           #......######
           #......######
           #############`,
};

/** T-junction — doors N + S + W (mask N|S|W). A bigger room broken up with four free-standing `#` PILLARS in the
 *  open interior (off the N–S spine and the W spur, so they're cover, never a wall across a route): a drone + a
 *  husk + a middle-manager + a health pickup + ammo. */
const PATH_TEE_NSW: ModuleDef = {
  name: 'path_tee_nsw',
  role: 'path',
  layout: `######DD#####
           #...........#
           #.......d...#
           #..#m....#..#
           #...P.A.....#
           #...........#
           D...........#
           D...........#
           #.......E...#
           #..#.....#..#
           #...........#
           #...........#
           ######DD#####`,
};

/** T-junction — doors E + S + W (mask E|S|W). Re-shaped as a bold OCTAGON (all four corners bevelled ~3 cells via
 *  the `q`/`e`/`z`/`c` chamfers + solid corner triangles): a drone + a husk + a middle-manager + a health pickup +
 *  ammo; the S spur and the W↔E run stay open through the centre, clear of the bevelled corners. */
const PATH_TEE_ESW: ModuleDef = {
  name: 'path_tee_esw',
  role: 'path',
  layout: `#############
           ###q.....e###
           ##q.d...m.e##
           #q.........e#
           #...P.A.....#
           #...........#
           D...........D
           D...........D
           #....E......#
           #z.........c#
           ##z.......c##
           ###z.....c###
           ######DD#####`,
};

/** 4-way cross — doors N + E + S + W (mask N|E|S|W). The busiest backbone fight, re-shaped as a bold OCTAGON
 *  (all four corners bevelled ~3 cells deep via the `q`/`e`/`z`/`c` chamfers + their solid corner triangles, so
 *  the room reads as 8-sided): two drones + a husk + a middle-manager bruiser at the corners + a health pickup +
 *  a central ammo box; both corridors run clean through the middle, well clear of the bevelled corners. */
const PATH_CROSS: ModuleDef = {
  name: 'path_cross',
  role: 'path',
  layout: `######DD#####
           ###q.....e###
           ##q.d...G.e##
           #q.........e#
           #...P.A.....#
           #...........#
           D...........D
           D...........D
           #...........#
           #z..d...E..c#
           ##z.......c##
           ###z.....c###
           ######DD#####`,
};

/** A side room off the route — one door N (mask N) — with a raised 0.3 dais, an enemy standing ON it (the `g`
 *  legend char carries `floorZ` so it doesn't punch a z0 hole into the dais), and a health pickup on the base
 *  floor. Exercises content-on-a-raised-tile inside the assembled level. */
const SIDE_CONTENT: ModuleDef = {
  name: 'side_content',
  role: 'side',
  layout: `######DD#####
           #...........#
           #.....P.....#
           #...........#
           #...........#
           #..3333333..#
           #..3333333..#
           #..333g333..#
           #..3333333..#
           #..3333333..#
           #...........#
           #...........#
           #############`,
  legend: {
    '3': { floorZ: 0.3 },
    g: { enemy: 'manager', floorZ: 0.3 }, // enemy on the 0.3 dais (carries floorZ so it isn't in a z0 hole)
  },
};

/** A side ammo cache off the route — one door S (mask S) — with two staple boxes on the base floor. */
const SIDE_AMMO: ModuleDef = {
  name: 'side_ammo',
  role: 'side',
  layout: `#############
           #...........#
           #...........#
           #...........#
           #...........#
           #...........#
           #...A...A...#
           #...........#
           #...........#
           #...........#
           #...........#
           #...........#
           ######DD#####`,
};

// -- side set-pieces: the rooms that hang OFF the backbone. The `path` generator opens every side slot that
// touches the route with a doorway, so each DOORED `side` mask the carver emits over a seed sweep
// (single-door N/E/S/W = 1/2/4/8, the L-corners N|E/E|S/S|W/N|W = 3/6/12/9, the N|S straight = 5, and the
// T-junctions N|E|S/N|S|W = 7/13) gets a real prefab below, so a side slot stops synthesizing an empty
// auto-corridor. (A fully SEALED side slot — `needs` 0, no neighbour on the route — has no doorway to author
// against and stays a sealed `corridor-0` box; those are the only side fallbacks left.) The backbone already
// carries the swarm, so each side room is LIGHT (0–4 enemies) and trades raw density for VARIETY + pacing —
// four flavours, reused across masks where the layout allows: a SUPPLY CACHE (health + ammo, a breather,
// 0 enemies), a HUSK AMBUSH (3 melee husks behind a 0.3 cover step + ammo), a MINI-ARENA (an open drone
// cluster + ammo + health), and a LANDMARK (a raised 0.3 dais bearing a P+A reward, 0 enemies). Every room
// keeps a clear z=0 walkable route from each of its doors (a `3` step is crossable cover, also bypassable at
// z0 along the edges — never a wall across the route).

/** Supply cache — one door E (mask E). A breather: a health pack + an ammo box on the base floor, no enemies
 *  (distinct from `SIDE_AMMO`, which stocks ammo only). */
const SIDE_CACHE_E: ModuleDef = {
  name: 'side_cache_e',
  role: 'side',
  layout: `#############
           #...........#
           #...........#
           #....P......#
           #...........#
           #...........#
           #.....A.....D
           #...........D
           #...........#
           #...........#
           #...........#
           #...........#
           #############`,
};

/** Supply cache — doors E + S (mask E|S). The corner variant of `SIDE_CACHE_E`; a health pack + an ammo box,
 *  no enemies. */
const SIDE_CACHE_ES: ModuleDef = {
  name: 'side_cache_es',
  role: 'side',
  layout: `#############
           #...........#
           #...........#
           #....P......#
           #...........#
           #...........#
           #.....A.....D
           #...........D
           #...........#
           #...........#
           #...........#
           #...........#
           ######DD#####`,
};

/** Husk ambush — one door W (mask W). Three husks (`E`, melee) wait past a 0.3 cover step (`3`, crossable but
 *  also bypassable at z0 down the edges), with an ammo box to refill before the rush. */
const SIDE_AMBUSH_W: ModuleDef = {
  name: 'side_ambush_w',
  role: 'side',
  layout: `#############
           #...........#
           #...........#
           #.......A...#
           #...........#
           #...........#
           D...........#
           D...........#
           #..3333333..#
           #...........#
           #...E.E.E...#
           #...........#
           #############`,
  legend: { '3': { floorZ: 0.3 } },
};

/** Husk ambush — doors N + W (mask N|W). The corner variant: two husks past a 0.3 cover step + an ammo box. */
const SIDE_AMBUSH_NW: ModuleDef = {
  name: 'side_ambush_nw',
  role: 'side',
  layout: `######DD#####
           #...........#
           #...........#
           #.......A...#
           #...........#
           #...........#
           D...........#
           D...........#
           #..3333333..#
           #...........#
           #....E.E....#
           #...........#
           #############`,
  legend: { '3': { floorZ: 0.3 } },
};

/** Mini-arena — doors N + E (mask N|E). An open room broken up with four free-standing `#` PILLARS (off the
 *  N→E route, so they're cover, never a wall) around a three-drone (`d`) cluster guarded by a lone tough
 *  security guard (`G`), a central ammo box and a health pack — a short flare-up, not a grind. */
const SIDE_ARENA_NE: ModuleDef = {
  name: 'side_arena_ne',
  role: 'side',
  layout: `######DD#####
           #...........#
           #..d.....d..#
           #.....G.....#
           #.....A.....#
           #..#.....#..#
           #...........D
           #...........D
           #..#.....#..#
           #....d......#
           #......P....#
           #...........#
           #############`,
};

/** Mini-arena — doors S + W (mask S|W). The corner variant, re-shaped as a bold OCTAGON (all four corners
 *  bevelled ~3 cells via the `q`/`e`/`z`/`c` chamfers + solid corner triangles): a three-drone cluster + a lone
 *  tough security guard (`G`) + ammo + health, with the S spur and W↔centre route open through the middle,
 *  clear of the bevelled corners. */
const SIDE_ARENA_SW: ModuleDef = {
  name: 'side_arena_sw',
  role: 'side',
  layout: `#############
           ###q.....e###
           ##qd.....de##
           #q.........e#
           #.....A.....#
           #.....G.....#
           D...........#
           D...........#
           #...........#
           #z...d.....c#
           ##z....P..c##
           ###z.....c###
           ######DD#####`,
};

/** Mini-arena — doors N + S + W (mask N|S|W). The T-junction variant, re-shaped as a bold OCTAGON (all four
 *  corners bevelled ~3 cells via the `q`/`e`/`z`/`c` chamfers + solid corner triangles): a three-drone cluster +
 *  ammo + health, with the N–S spine (cols 6–7) and the W spur kept clear of the bevelled corners. */
const SIDE_ARENA_NSW: ModuleDef = {
  name: 'side_arena_nsw',
  role: 'side',
  layout: `######DD#####
           ###q.....e###
           ##qd.....de##
           #q.........e#
           #.....A.....#
           #...........#
           D...........#
           D...........#
           #...........#
           #z...d.....c#
           ##z....P..c##
           ###z.....c###
           ######DD#####`,
};

/** Landmark — doors N + E + S (mask N|E|S). A visually distinct set-piece: a raised 0.3 dais (`3`) bearing a
 *  health pack + ammo as a reward (the `p`/`a` legend chars carry `floorZ` so the pickups sit ON the dais
 *  instead of punching a z0 hole). No enemies — a calm, memorable corner. The dais sits left of the N–S spine
 *  (cols 6–7) so the through-route stays clear. */
const SIDE_LANDMARK_NES: ModuleDef = {
  name: 'side_landmark_nes',
  role: 'side',
  layout: `######DD#####
           #...........#
           #...........#
           #.3333......#
           #.3pa3......#
           #.3333......#
           #...........D
           #...........D
           #...........#
           #...........#
           #...........#
           #...........#
           ######DD#####`,
  legend: {
    '3': { floorZ: 0.3 },
    p: { pickup: 'health', floorZ: 0.3 }, // reward ON the 0.3 dais (carries floorZ so it isn't in a z0 hole)
    a: { ammo: 'box_staples', floorZ: 0.3 },
  },
};

/** The hand-authored prefab library the slot-grid assembler draws from. The twelve `path` prefabs cover EVERY
 *  exit mask the path generator emits, so the main route is always a content-bearing fight (never an empty
 *  auto-corridor); `FLAT_ROOM` is the N|S safety net. The `side` set-pieces cover every DOORED `side` mask the
 *  carver emits — supply caches, husk ambushes, mini-arenas and a landmark — so a side slot that touches the
 *  route is a real (light) room, not an auto-corridor. Only a fully SEALED side slot (`needs` 0, no doorway to
 *  author against) still falls back to a sealed `corridor-0`. */
export const MODULE_LIBRARY: Module[] = [
  FLAT_ROOM,
  LEDGE_ROOM,
  PATH_CAP_E,
  PATH_CAP_W,
  PATH_CORNER_NE,
  PATH_CORNER_ES,
  PATH_CORNER_NW,
  PATH_CORNER_SW,
  PATH_HALL_H,
  PATH_TEE_NES,
  PATH_TEE_NEW,
  PATH_TEE_NSW,
  PATH_TEE_ESW,
  PATH_CROSS,
  SIDE_CONTENT,
  SIDE_AMMO,
  SIDE_CACHE_E,
  SIDE_CACHE_ES,
  SIDE_AMBUSH_W,
  SIDE_AMBUSH_NW,
  SIDE_ARENA_NE,
  SIDE_ARENA_SW,
  SIDE_ARENA_NSW,
  SIDE_LANDMARK_NES,
].map(parseModule);
