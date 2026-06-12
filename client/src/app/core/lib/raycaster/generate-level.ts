import { EXIT_SWITCH, GLASS_BASE, doorCell, isLockedDoor } from './game-map';
import { sectorize } from './sector';
import type { GameMap } from './game-map';
import { ENEMY_CONFIG } from './enemy';
import { makeRng, randInt } from './rng';
import type { AmmoSpawn, Level, Theme } from './levels';
import { KEYCARD_COLORS } from './types';
import type { Enemy, EnemyKind, Keycard, Pickup, Pose } from './types';

// Grid + partition: 48 = 4×12 and 36 = 3×12 — twelve 12×12 partition cells.
export const GRID_W = 48;
export const GRID_H = 36;
const ROOM_MIN = 6; // min room side; max side = 10 (6 + randInt(rng, 5))

export const FRONT_GAP = 2; // cells ahead of the spawn kept open + spawn-visible (game-renderer.spec relies on it)
const BASE_ENEMIES = 8;

export const MAX_ENEMIES = 28;

/** Wall material ids — must match the renderer's `WALL_MATERIAL_IDS` (1-based index into it). 1-3 are the
 *  AMBIENT zone materials (one per room, by district); 4-8 are PLACED feature accents. */
const MATERIAL_TECHBASE = 1; // clean riveted base — the hub (foyer/atrium) + the mid district
const MATERIAL_CUBICLE = 2; // grey-blue acoustic partitions — the open-space district
const MATERIAL_DAMAGED = 3; // burnt-out panels — the sinistré district
const MATERIAL_SERVER = 4; // server-rack wall (emissive) — the server room ring, variant A
const MATERIAL_SCREEN = 5; // recessed dashboard/monitor (emissive) — a sparse accent
const MATERIAL_DOOR = 6; // sealed airlock segment (tile:none) — one per room, decorative
const MATERIAL_PILLAR = 7; // structural column — only on large rooms
const MATERIAL_SERVER_B = 8; // server-rack wall variant B (emissive) — alternates with 4 along the ring

/** Ceiling material ids — must match the renderer's `CEILING_MATERIAL_IDS` (1-based). No 0 (open sky): the
 *  level is a fully indoor office, so every room is ceilinged. */
const CEIL_ACOUSTIC = 1; // white acoustic tiles — clean hub
const CEIL_NEON_BROKEN = 2; // flickering broken fluorescent — the server room
const CEIL_TECHNICAL = 3; // exposed ducts/pipes — open-space lofts
const CEIL_STAINED = 4; // water-stained collapsing tiles — the burnout zone
const CEIL_CONCRETE = 5; // raw concrete slab — the atrium hall

const PICKUP_BASE = 8;
const PICKUP_MAX = 12;

/** The coherent IDENTITY of a room — one ambient wall material + a matching ceiling + whether its floor is
 *  scorched. Every cell of the room reads as the same office zone, so a wall never changes material mid-room
 *  and the ceiling fits the walls. Zones are grouped into DISTRICTS by the snake's partition row (open-space
 *  cubicles up top, the clean techbase hub in the middle, a burnt-out zone down low); the foyer + atrium are
 *  the hub, and the (deterministically chosen) server room is dressed as flickering tech. */
interface RoomIdentity {
  wall: number;
  ceil: number;
  hazard: boolean;
}

function roomIdentity(roomIndex: number, roomCount: number, serverRoomIndex: number): RoomIdentity {
  if (roomIndex === 0) {
    return { wall: MATERIAL_TECHBASE, ceil: CEIL_ACOUSTIC, hazard: false }; // foyer — clean entry hub
  }
  if (roomIndex === roomCount - 1) {
    return { wall: MATERIAL_TECHBASE, ceil: CEIL_CONCRETE, hazard: false }; // atrium — raw-concrete hall
  }
  if (roomIndex === serverRoomIndex) {
    return { wall: MATERIAL_TECHBASE, ceil: CEIL_NEON_BROKEN, hazard: false }; // server room (ring dressed in 13c)
  }
  const row = NORMAL_ORDER[roomIndex - 1][1];

  if (row === 0) {
    return { wall: MATERIAL_CUBICLE, ceil: CEIL_TECHNICAL, hazard: false }; // open-space lofts, exposed ducts
  }
  if (row === 1) {
    return { wall: MATERIAL_TECHBASE, ceil: CEIL_ACOUSTIC, hazard: false }; // the clean mid district
  }

  return { wall: MATERIAL_DAMAGED, ceil: CEIL_STAINED, hazard: true }; // burnout zone, scorched floor
}

export interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const ENEMY_KINDS = ['manager', 'printer', 'hr'] as const;
const PICKUP_KINDS = ['health', 'armor'] as const; // floor vitals; ammo is emitted as an `AmmoSpawn` (below)
/** The ammo boxes the scattered ammo slots cycle through (content ids the shell resolves to descriptors;
 *  the engine has no per-type logic). Adding the next type is data-only: give it an `ammo-pickups.json`
 *  entry + an `ammo_types` max, then append its id here. Index 0 is the guaranteed foyer starter. */
const AMMO_PICKUP_IDS = [
  'box_staples',
  'battery_pack',
  'gas_canister',
  'box_nails',
  'energy_cell',
  'server_cell',
] as const;

// Partition cells (col,row) for the nine normal rooms, walked as a SNAKE — load-bearing twice over:
// (1) chaining consecutive cells L-by-L links the whole map into one component (connectivity), and
// (2) no link ever has BOTH a low-x (≤6) and a low-y (≤6) leg, so no corridor ever enters box B (the
// sealed spawn nook). Excludes (0,0) [foyer + box B] and (1,1)/(2,1) [merged into the atrium].
const NORMAL_ORDER: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [3, 2],
  [3, 1],
  [3, 0],
  [2, 0],
  [1, 0],
];

// Box B = the spawn nook (cols 0..6 × rows 0..6), sealed LAST; these eight cells stay floor: the
// spawn pocket along row 1, then a one-wide throat jogging down column 3 to the foyer at (3,7).
const NOOK_FLOOR: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 1],
  [3, 1],
  [3, 2],
  [3, 3],
  [3, 4],
  [3, 5],
  [3, 6],
];

const alive = (x: number, y: number, kind: EnemyKind): Enemy => ({
  x,
  y,
  dir: 0,
  state: 'alive',
  deathTime: 0,
  hp: ENEMY_CONFIG[kind].hp,
  fireCooldown: ENEMY_CONFIG[kind].fireCooldown, // Slice-0 grace: never throws on the first tick
  hitFlash: 0,
  windup: 0,
  kind,
});

/**
 * The eleven room rectangles for a seed, drawn in the load-bearing order the generator depends on: the
 * fixed foyer, the nine snake-ordered normal rooms (the r2 slot pinned to a fixed box, the other eight
 * random), then the always-present atrium (last). Pure — it consumes only `rng`, and `generateLevel`
 * calls it FIRST, so the same seed replays the identical layout. Exported so the geometry tests can
 * locate each room rather than re-derive its random rect.
 */
export function buildRooms(rng: () => number): Room[] {
  const foyer: Room = { x: 1, y: 7, width: 6, height: 4, centerX: 4, centerY: 9 };
  const rooms: Room[] = [foyer];

  for (const [col, row] of NORMAL_ORDER) {
    // r2 — the partition slot (0,2), the grid's SW corner — is PINNED to a fixed centred 8×8 box so its
    // west + south margins stay uncarved wall and all four corners are wall-backed by construction. This
    // lets r2 join the octagon set (its 45° corners are visible with zero keycards). NO rng is drawn for
    // the pinned slot (one slot pinned, eight random → both arms run on every seed). Trade-off: r2 loses
    // its random size/offset variety — acceptable for an early, always-octagonal room.
    if (col === 0 && row === 2) {
      rooms.push({ x: 2, y: 26, width: 8, height: 8, centerX: 6, centerY: 30 });
      continue;
    }
    const width = ROOM_MIN + randInt(rng, 5);
    const height = ROOM_MIN + randInt(rng, 5);
    const x = col * 12 + 1 + randInt(rng, 11 - width);
    const y = row * 12 + 1 + randInt(rng, 11 - height);

    rooms.push({ x, y, width, height, centerX: x + (width >> 1), centerY: y + (height >> 1) });
  }

  // The atrium ALWAYS exists (no rng existence roll), merging partition cells (1,1)+(2,1) into a hall.
  const atriumWidth = 14 + randInt(rng, 7);
  const atriumHeight = 6 + randInt(rng, 5);
  const atriumX = 13 + randInt(rng, 23 - atriumWidth);
  const atriumY = 13 + randInt(rng, 11 - atriumHeight);

  rooms.push({
    x: atriumX,
    y: atriumY,
    width: atriumWidth,
    height: atriumHeight,
    centerX: atriumX + (atriumWidth >> 1),
    centerY: atriumY + (atriumHeight >> 1),
  });

  return rooms;
}

/**
 * Generate a deterministic, fully-connected level from a seed. Pure (no `Math.random`/`Date`).
 *
 * The safe-spawn guarantee is achieved by OPERATION ORDER, not by any predicate: the enemy/pickup
 * floor-pool is gathered (step 11) while box B and the whole throat are STILL SOLID WALL — the nook is
 * carved only LAST (step 13). So the pool can never contain a cell the spawn is able to see, and no
 * enemy ever has line-of-sight to the spawn. Do NOT add an `x≤6 && y≤6` exclusion or a spawn-radius
 * test: its "inside" branch would be permanently dead and drop core/ below 100% coverage.
 */
export function generateLevel(seed: number, theme: Theme, depth: number): Level {
  const rng = makeRng(seed);
  const cells: number[] = new Array(GRID_W * GRID_H).fill(1); // 1. start all wall
  const floorFlats: number[] = new Array(GRID_W * GRID_H).fill(0);
  const ceilFlats: number[] = new Array(GRID_W * GRID_H).fill(1); // 1 = flat ceiling; 0 = sky
  const index = (x: number, y: number): number => y * GRID_W + x;
  const carve = (room: Room): void => {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        cells[index(x, y)] = 0;
      }
    }
  };
  const corners = (room: Room): readonly (readonly [number, number])[] => [
    [room.x, room.y], // NW
    [room.x + room.width - 1, room.y], // NE
    [room.x, room.y + room.height - 1], // SW
    [room.x + room.width - 1, room.y + room.height - 1], // SE
  ];

  // 2. Rooms from `buildRooms` (drawn FIRST so a seed replays the identical layout), then carved into
  //    `cells`. rooms = [foyer, ...nine snake-ordered normal rooms, atrium]; the atrium is always last.
  const rooms = buildRooms(rng);
  const foyer = rooms[0];
  const atrium = rooms[rooms.length - 1];

  for (const room of rooms) {
    carve(room);
  }

  // 3. Connect rooms with 3-wide L-corridors. The foyer→r1 link (corridor 1) is HOISTED out of the
  //    generic chain and carved VERTICAL-FIRST at the foyer's FIXED centre axis: the stub drops cols
  //    foyer.centerX±1 (= 3,4,5) from foyer.centerY down to r1.centerY, then a 3-wide horizontal leg at
  //    r1.centerY (deep in r1, row ≥ 16 — clear of the foyer rows 7-10) runs over to r1.centerX. Because
  //    the stub lives at the centre columns it NEVER touches the foyer's corner columns (1, 6) — that is
  //    what leaves all four foyer corners wall-backed for the octagon pass (step 7). No rng → rng-neutral
  //    (r1.centerY ≥ 16 > foyer.centerY, so the stub always descends).
  const r1 = rooms[1];

  for (let y = foyer.centerY; y <= r1.centerY; y++) {
    cells[index(foyer.centerX - 1, y)] = 0;
    cells[index(foyer.centerX, y)] = 0;
    cells[index(foyer.centerX + 1, y)] = 0;
  }
  for (let x = Math.min(foyer.centerX, r1.centerX); x <= Math.max(foyer.centerX, r1.centerX); x++) {
    cells[index(x, r1.centerY - 1)] = 0;
    cells[index(x, r1.centerY)] = 0;
    cells[index(x, r1.centerY + 1)] = 0;
  }

  // The remaining links run the generic horizontal-then-vertical L-loop from i=2, each leg carved at its
  // centre and the two parallel ±1 lanes. Snake order keeps every leg out of box B: no link ever reaches
  // BOTH a low-col (≤6) and a low-row (≤6) — any leg touching low cols runs at rows ≥ 8 and any leg
  // touching low rows runs at cols ≥ 12 — so even the widened lanes stay clear of the sealed spawn nook
  // (the no-LOS-to-spawn sweep is the net). The column-3 throat stays 1-wide (step 12).
  for (let i = 2; i < rooms.length; i++) {
    const previous = rooms[i - 1];
    const current = rooms[i];

    for (
      let x = Math.min(previous.centerX, current.centerX);
      x <= Math.max(previous.centerX, current.centerX);
      x++
    ) {
      cells[index(x, previous.centerY - 1)] = 0;
      cells[index(x, previous.centerY)] = 0;
      cells[index(x, previous.centerY + 1)] = 0;
    }
    for (
      let y = Math.min(previous.centerY, current.centerY);
      y <= Math.max(previous.centerY, current.centerY);
      y++
    ) {
      cells[index(current.centerX - 1, y)] = 0;
      cells[index(current.centerX, y)] = 0;
      cells[index(current.centerX + 1, y)] = 0;
    }
  }

  // 4. Exit switch on the wall just past the atrium's right edge (adjacent to atrium floor → reachable).
  cells[index(atrium.x + atrium.width, atrium.centerY)] = EXIT_SWITCH;

  // 5. WALL MATERIALS BY ROOM IDENTITY — each room's perimeter ring takes the room's single ambient material
  //    (techbase / cubicle / damaged, by district) so a wall never changes material mid-room; corridors + the
  //    outer shell keep the base techbase. A randInt is still drawn + discarded per wall cell so the
  //    downstream Fisher-Yates placement stays byte-identical (rng-neutral). The material itself is
  //    position-based (`wallMaterialOf`, stamped per room below) → deterministic.
  const wallVariants = theme.walls.length - 1; // walls[0] is the unused placeholder
  const serverRoomIndex = 1 + (seed % Math.max(1, rooms.length - 2)); // a deterministic non-foyer/atrium room
  const wallMaterialOf: number[] = new Array(GRID_W * GRID_H).fill(MATERIAL_TECHBASE);
  // A room's perimeter ring is always interior (room.x-1 ≥ 0, room.x+width ≤ GRID_W-1, likewise y), so
  // `index` is in bounds by construction — no guard (which would be a permanently-dead branch).
  const stampRing = (room: Room, material: number): void => {
    for (let x = room.x - 1; x <= room.x + room.width; x++) {
      wallMaterialOf[index(x, room.y - 1)] = material;
      wallMaterialOf[index(x, room.y + room.height)] = material;
    }
    for (let y = room.y - 1; y <= room.y + room.height; y++) {
      wallMaterialOf[index(room.x - 1, y)] = material;
      wallMaterialOf[index(room.x + room.width, y)] = material;
    }
  };

  // Later rooms win on a shared wall (deterministic by room order) — a wall reads as the room it backs.
  for (let r = 0; r < rooms.length; r++) {
    stampRing(rooms[r], roomIdentity(r, rooms.length, serverRoomIndex).wall);
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] > 0 && cells[i] !== EXIT_SWITCH) {
      randInt(rng, wallVariants); // consume one rng (preserve placement); the material below is position-based
      cells[i] = wallMaterialOf[i];
    }
  }

  // 6. PER-ROOM FLATS matched to the room's identity (no rng): a ceiling that fits the zone (acoustic tiles
  //    in the clean hub, exposed ducts over the open-space lofts, flickering neon in the server room,
  //    water-stained panels in the burnout zone, raw concrete over the atrium) and a scorched hazard floor
  //    only in the burnt-out zone. NO open sky — it's an indoor office, so every room is ceilinged; corridors
  //    + outside keep the base acoustic ceiling (id 1, the `ceilFlats` init).
  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
    const room = rooms[roomIndex];
    const id = roomIdentity(roomIndex, rooms.length, serverRoomIndex);

    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (id.hazard) {
          floorFlats[index(x, y)] = 1;
        }
        ceilFlats[index(x, y)] = id.ceil;
      }
    }
  }

  // 7. Less-boxy geometry, applied before any entity is placed so none lands on a new wall:
  //    (a) THREE octagon rooms — the foyer (its octagon is visible the instant you leave the spawn nook),
  //        r2 (reachable with zero keycards), and the atrium — get all four square corners replaced by
  //        true 45° half-walls: the solid triangle faces the room's OUTSIDE corner so the hypotenuse opens
  //        inward. Every corner is wall-backed BY CONSTRUCTION — the foyer is fixed and its mouth is
  //        hoisted to the centre cols 3,4,5 (step 3), r2 is pinned 8×8 in the grid's SW partition
  //        (buildRooms), and the atrium sits in the x∈[12,36] gap the perimeter corridors never cross — so
  //        no runtime guard is needed. LOAD-BEARING INVARIANTS: the foyer mouth at cols 3,4,5
  //        (foyer.centerX±1) and ROOM_MIN ≥ 6 keep the centred corridor stubs clear of every corner
  //        column; the pass order below is FIXED so the rng wall-variant draw sequence stays deterministic.
  //    (b) every OTHER normal room (rooms[1] + rooms[3..9], not an octagon) gets all four interior corners
  //        chamfered to plain solid wall — a cheap deterministic "stair-step". Safe by construction:
  //        corridors join room centres, never corners, so a chamfer can neither block a corridor nor
  //        disconnect a room.
  const diagonals: number[] = new Array(GRID_W * GRID_H).fill(0);
  const cornerOrients = [1, 3, 4, 2]; // NW, NE, SW, SE → solid triangle toward each outside corner
  const octagonIndices = [0, 2, rooms.length - 1]; // foyer, r2, atrium

  for (const ri of octagonIndices) {
    const roomCorners = corners(rooms[ri]);
    const material = roomIdentity(ri, rooms.length, serverRoomIndex).wall; // corner reads as its own room

    for (let c = 0; c < roomCorners.length; c++) {
      const [cornerX, cornerY] = roomCorners[c];

      randInt(rng, wallVariants); // preserve the rng draw order; material is room-based (position-only)
      cells[index(cornerX, cornerY)] = material;
      diagonals[index(cornerX, cornerY)] = cornerOrients[c];
    }
  }
  for (let r = 1; r <= NORMAL_ORDER.length; r++) {
    if (r === 2) {
      continue; // r2 is an octagon (handled above), not a plain solid chamfer
    }
    const material = roomIdentity(r, rooms.length, serverRoomIndex).wall;

    for (const [cornerX, cornerY] of corners(rooms[r])) {
      randInt(rng, wallVariants); // preserve the rng draw order; material is room-based (position-only)
      cells[index(cornerX, cornerY)] = material;
    }
  }

  // 8. LOCK-AND-KEY (deterministic — depth + geometry only, NO rng, so the Fisher-Yates draw order is
  //    untouched). Stamped AFTER the geometry passes (5,7) so it overwrites carved corridor floor, and
  //    BEFORE the pool gather (11) so door cells (now nonzero) and key cells drop out of the pool.
  //    The generator already emits a linear chain foyer(0)→r1→…→r9→atrium(10): cutting corridor `c`
  //    with a 3-cell locked-door seam at its partition boundary is a min-cut, so the exit (atrium, sole
  //    entrance = corridor 10) is gated STRUCTURALLY — no runtime "is the door open?" branch.
  const cuts = depth <= 1 ? [10] : depth <= 3 ? [5, 10] : [4, 7, 10];
  const keys: Keycard[] = [];
  const keyCells = new Set<number>();

  for (let j = 0; j < cuts.length; j++) {
    const previous = rooms[cuts[j] - 1];
    const current = rooms[cuts[j]];
    const color = KEYCARD_COLORS[j];

    // Seal the boundary the corridor crosses: the dominant centre-axis picks vertical vs horizontal.
    if (
      Math.abs(previous.centerX - current.centerX) > Math.abs(previous.centerY - current.centerY)
    ) {
      const boundaryX = 12 * Math.round((previous.centerX + current.centerX) / 2 / 12);

      for (let dy = -1; dy <= 1; dy++) {
        cells[index(boundaryX, previous.centerY + dy)] = doorCell(color);
      }
    } else {
      const boundaryY = 12 * Math.round((previous.centerY + current.centerY) / 2 / 12);

      for (let dx = -1; dx <= 1; dx++) {
        cells[index(current.centerX + dx, boundaryY)] = doorCell(color);
      }
    }

    // The keycard sits at the centre of the room just before its door (open floor, in the zone the
    // previous lock gates) — collect key j → open door j → reach the next zone.
    keys.push({ x: previous.centerX + 0.5, y: previous.centerY + 0.5, color });
    keyCells.add(index(previous.centerX, previous.centerY));
  }

  // 9. Spawn sealed in the nook, facing +x down the pocket.
  const spawn: Pose = { x: 1.5, y: 1.5, dir: 0 };

  // 10. The sentinel — a stationary turret on the foyer floor straight down column 3, holding the
  //    doorway. Out of the spawn's sight while box B is solid, it gains LOS up the throat (and engages)
  //    the moment the player reaches the corner (3,1). A turret, not a rushing kind, is deliberate: a
  //    mobile enemy would wander off the column before the player arrives, leaving the doorway unguarded.
  const enemies: Enemy[] = [alive(3.5, 9.5, 'printer')];

  // 11. SAFE-SPAWN BY OPERATION ORDER (load-bearing — gather BEFORE the nook is carved, see step 13):
  //     pool = every open-floor cell except the sentinel's and the keycard cells. Box B (incl. the
  //     spawn cell and the whole throat) is STILL SOLID WALL here, so it can never enter the pool → no
  //     placed enemy/pickup is ever a cell the spawn can see (the seal is the carving order alone), and
  //     skipping keyCells keeps an enemy/pickup off a keycard (door cells, now nonzero, drop out too).
  const pool: { x: number; y: number }[] = [];

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (cells[index(x, y)] === 0 && !(x === 3 && y === 9) && !keyCells.has(index(x, y))) {
        pool.push({ x, y });
      }
    }
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);

    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let cursor = 0;
  const nextCell = (): { x: number; y: number } => pool[cursor++ % pool.length];

  // 12. Extra enemies + pickups, both scaling with depth (capped). Enemy kinds random; pickups cycled.
  const enemyCount = Math.min(MAX_ENEMIES, BASE_ENEMIES + depth);

  for (let i = 1; i < enemyCount; i++) {
    const cell = nextCell();

    enemies.push(alive(cell.x + 0.5, cell.y + 0.5, ENEMY_KINDS[randInt(rng, 3)]));
  }
  const pickupCount = Math.min(PICKUP_MAX, PICKUP_BASE + depth);
  const pickups: Pickup[] = [];
  const ammoSpawns: AmmoSpawn[] = [];

  for (let i = 0; i < pickupCount; i++) {
    const cell = nextCell();
    const x = cell.x + 0.5;
    const y = cell.y + 0.5;

    // Keep the old three-slot cadence (health, armor, ammo): every third slot drops a descriptor-driven
    // ammo box (an `AmmoSpawn` the shell resolves), the other two thirds floor vitals cycled health/armor.
    if (i % 3 === 2) {
      ammoSpawns.push({
        x,
        y,
        pickupId: AMMO_PICKUP_IDS[ammoSpawns.length % AMMO_PICKUP_IDS.length],
      });
    } else {
      pickups.push({ x, y, kind: PICKUP_KINDS[i % 3 === 0 ? 0 : 1] });
    }
  }

  // PREVIEW (temporary): one of EVERY ammo type, lined up across the foyer throat — the carved 3-wide
  // corridor down from the spawn (cols centerX±1 × rows centerY..+1 are always carved open) — so all the
  // rotating-ammo art is on the map from the start. Revert to a single guaranteed box for normal play.
  AMMO_PICKUP_IDS.forEach((pickupId, k) => {
    ammoSpawns.push({
      x: foyer.centerX + ((k % 3) - 1) + 0.5,
      y: foyer.centerY + Math.floor(k / 3) + 0.5,
      pickupId,
    });
  });

  // 13. STAMP BOX B LAST (load-bearing — see step 11): seal cols 0..6 × rows 0..6 to solid wall, then
  //     carve only the pocket + throat. (3,7) is already foyer floor, so the throat joins the foyer —
  //     the spawn's single, sight-sealed exit.
  for (let y = 0; y <= 6; y++) {
    for (let x = 0; x <= 6; x++) {
      cells[index(x, y)] = 2;
    }
  }
  for (const [x, y] of NOOK_FLOOR) {
    cells[index(x, y)] = 0;
  }

  // 13b. GLASS BAIES (the open-office look, kept SOBER): convert a plain 1-thick wall into SEE-THROUGH glass
  //      ONLY where it sits on a ROOM's perimeter AND has open FLOOR on both opposite sides — i.e. a real
  //      window between a room and the open space next door, not every interior wall. You see the next room
  //      and its enemies through the pane. Glass stays SOLID (you bump into it) and OPAQUE to line-of-sight +
  //      fire (`isWall`), so the spawn-safety + AI-sight invariants are untouched; only the renderer casts
  //      THROUGH it. Skips the sealed spawn nook (cols/rows ≤ 6), the border, diagonal + switch/door cells.
  //      The kind (tinted partition 13 / clear window 14) alternates by parity. Position-only → no rng.
  const roomPerimeter = new Set<number>();

  for (const room of rooms) {
    for (let x = room.x - 1; x <= room.x + room.width; x++) {
      roomPerimeter.add(index(x, room.y - 1));
      roomPerimeter.add(index(x, room.y + room.height));
    }
    for (let y = room.y - 1; y <= room.y + room.height; y++) {
      roomPerimeter.add(index(room.x - 1, y));
      roomPerimeter.add(index(room.x + room.width, y));
    }
  }
  for (let y = 1; y < GRID_H - 1; y++) {
    for (let x = 1; x < GRID_W - 1; x++) {
      if (x <= 6 && y <= 6) {
        continue; // the sealed spawn nook stays opaque
      }
      const i = index(x, y);
      const cell = cells[i];

      if (cell === 0 || cell === EXIT_SWITCH || isLockedDoor(cell) || diagonals[i] !== 0) {
        continue; // only a plain solid wall becomes glass
      }
      if (!roomPerimeter.has(i)) {
        continue; // a baie is a ROOM window, not a corridor-flanking wall
      }
      const openLeftRight = cells[index(x - 1, y)] === 0 && cells[index(x + 1, y)] === 0;
      const openUpDown = cells[index(x, y - 1)] === 0 && cells[index(x, y + 1)] === 0;

      if (openLeftRight || openUpDown) {
        cells[i] = GLASS_BASE + ((x + y) % 2); // alternate partition / window for variety
      }
    }
  }

  // 13c. FEATURE ACCENTS — distinctive wall MATERIALS placed at chosen cells (like DOOM's COMP / screens), NOT
  //      tiled across a zone, all INTENTIONAL and sparse: one SERVER ROOM per level (its perimeter ring → the
  //      two server-rack variants, plus a few recessed dashboard SCREENS), one sealed AIRLOCK door per room
  //      (a decorative segment on its south wall), and structural PILLARS only at the corners of LARGE rooms.
  //      Cosmetic only — `setFeature` overrides just a PLAIN interior wall (never a door/switch/glass/
  //      diagonal), so collision + every safety invariant is untouched. Position/seed-based → consumes no rng.
  //      A material with no `present` PNG falls back to the base techbase in the renderer.
  const setFeature = (x: number, y: number, material: number): void => {
    if (x < 1 || x >= GRID_W - 1 || y < 1 || y >= GRID_H - 1) {
      return; // interior only — the border stays opaque base wall
    }
    const i = index(x, y);
    const cell = cells[i];

    if (cell > 0 && cell < EXIT_SWITCH && diagonals[i] === 0) {
      cells[i] = material; // override a plain ambient wall (1..3 / an earlier feature); never a special cell
    }
  };

  const serverRoom = rooms[serverRoomIndex];
  // The two rack variants (4 / 8) alternate along the ring by cell parity → a denser, less repetitive wall.
  const rack = (x: number, y: number): number =>
    (x + y) % 2 === 0 ? MATERIAL_SERVER : MATERIAL_SERVER_B;

  for (let x = serverRoom.x - 1; x <= serverRoom.x + serverRoom.width; x++) {
    setFeature(x, serverRoom.y - 1, rack(x, serverRoom.y - 1));
    setFeature(x, serverRoom.y + serverRoom.height, rack(x, serverRoom.y + serverRoom.height));
  }
  for (let y = serverRoom.y; y < serverRoom.y + serverRoom.height; y++) {
    setFeature(serverRoom.x - 1, y, rack(serverRoom.x - 1, y));
    setFeature(serverRoom.x + serverRoom.width, y, rack(serverRoom.x + serverRoom.width, y));
  }
  // A few recessed dashboards on the server room's wall midpoints — the only SCREEN accents on the level.
  setFeature(serverRoom.centerX, serverRoom.y - 1, MATERIAL_SCREEN);
  setFeature(serverRoom.centerX, serverRoom.y + serverRoom.height, MATERIAL_SCREEN);
  setFeature(serverRoom.x - 1, serverRoom.centerY, MATERIAL_SCREEN);
  setFeature(serverRoom.x + serverRoom.width, serverRoom.centerY, MATERIAL_SCREEN);

  // One sealed AIRLOCK door per room — a decorative segment centred on the room's south wall (skipped where
  // that cell is a carved opening / special, by `setFeature`'s guard), so every room reads as having a door.
  for (const room of rooms) {
    setFeature(room.centerX, room.y + room.height, MATERIAL_DOOR);
  }

  // Structural PILLARS only at the four outer corners of LARGE rooms (the atrium + the bigger rooms) — the
  // small rooms stay clean, so columns read as a deliberate accent rather than noise on every corner.
  for (const room of rooms) {
    if (room.width * room.height >= 60) {
      setFeature(room.x - 1, room.y - 1, MATERIAL_PILLAR);
      setFeature(room.x + room.width, room.y - 1, MATERIAL_PILLAR);
      setFeature(room.x - 1, room.y + room.height, MATERIAL_PILLAR);
      setFeature(room.x + room.width, room.y + room.height, MATERIAL_PILLAR);
    }
  }

  // 14. Assemble the level. The map gains a flat SECTOR model derived from the per-cell flats (one flat
  //     sector per distinct floor/ceiling-material pair) — populated for sub-project A2 to consume, but no
  //     consumer reads it yet, so the renderer/component/`Level` seam stays byte-identical (`diagonals` +
  //     `sectors`/`sectorId` are all optional).
  const { sectors, sectorId } = sectorize(floorFlats, ceilFlats);
  const map: GameMap = { width: GRID_W, height: GRID_H, cells, diagonals, sectors, sectorId };

  return { map, floorFlats, ceilFlats, spawn, enemies, pickups, ammoSpawns, keys, theme };
}
