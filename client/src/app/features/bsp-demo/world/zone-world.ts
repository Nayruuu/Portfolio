import type { Barrel, EnemyShot, KeycardColor } from '../../../core/lib';
import type { CompiledMap, MapSource, MutableSector, Obstacle } from '../../../core/lib/bsp-engine';
import type { Level } from '../../../core/lib';
import type { Foe } from './enemy-runtime';
import type { AmmoBox, Keycard, Marker, Vital, WeaponPickup } from './pickups';

/**
 * The live per-zone world state of the BSP demo — everything one loaded floor holds (its animated sectors,
 * compiled map, entities, doors, seams and exit) — kept feature-side because it composes feature types
 * (`Level`, the pickups, the art-carrying {@link Foe}).
 */

/** A zone-graph exit placed in the world: walk into it → transition to zone `to` at its named `entry`. */
export interface ZoneExit {
  readonly x: number;
  readonly y: number;
  readonly z: number; // seated on its floor (the marker's base)
  readonly to: string;
  readonly entry: string;
}

/** A locked DOOR — a sector whose `ceilZ` animates between closed (== its floor, impassable) and open. Approach
 *  the trigger point holding the matching badge (if `requiresCard`) to open it; once opened it stays open (an unlock). */
export interface Door {
  readonly sector: number; // the door sector whose ceilZ animates
  readonly triggerX: number; // approach within DOOR_TRIGGER_RADIUS of this point to open
  readonly triggerY: number;
  readonly closedCeilZ: number; // ceilZ when shut (== floorZ → no headroom → physics blocks it)
  readonly openCeilZ: number; // ceilZ when fully open (the sector's authored ceiling)
  readonly requiresCard: KeycardColor | null; // the badge colour needed to open (null = no badge required)
  openness: number; // 0 shut .. 1 open
}

/** A PASSABLE live seam of the active map, pre-resolved for the per-frame crossing test: the seam segment,
 *  its unit normal pointing OUT of the room (the crossing direction — the seam's back side), and the zone
 *  transform (neighbor point + (`dx`,`dy`) = this map's point). */
export interface SeamEdge {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly len: number;
  readonly nx: number; // unit normal toward the seam's BACK side (into the neighbor zone)
  readonly ny: number;
  readonly zone: string;
  readonly dx: number;
  readonly dy: number;
}

/** A sliding glass door's proximity trigger: its linedef index + the segment midpoint the player nears to
 *  open it. Derived from the active level's linedefs (never persisted — re-indexed on every zone adopt). */
export interface SlidingDoor {
  readonly line: number;
  readonly mx: number;
  readonly my: number;
}

/**
 * One zone's full LIVE world state — the reified GAME WORLD the zone runtime owns. The SAME
 * shape backs BOTH the active floor (the world the player stands in) and the WARM neighbor (the zone behind a
 * visible passable seam, kept alive one at a time): the warm world's enemies simulate each frame in THEIR
 * map and its sprites show through the seam, and on a crossing the two references simply SWAP — the warm
 * world becomes active (continuity — nothing reloads) while the outgoing world becomes the new warm zone
 * (the reverse portal). Location-derived indexes (seams, graph exits, sliding-door triggers) are NOT bundled
 * here — the runtime re-derives them from the active world after every load/swap.
 */
export interface WarmZone {
  readonly key: string;
  readonly level: Level;
  // Entities exist only once the atlases have decoded: a bare (unpopulated) world is geometry-only, and
  // its snapshot must never be persisted — takenFlags would read its empty pickup lists as "all taken".
  // Mutable: the active world is built bare on the first (pre-atlas) load, then populated in place once the
  // atlases decode (the deferred spawn), which flips this true so a later demotion-to-warm snapshots it.
  populated: boolean;
  readonly sectors: MutableSector[];
  readonly mapSource: MapSource;
  readonly map: CompiledMap;
  readonly targets: Barrel[];
  enemies: Foe[];
  readonly enemyShots: EnemyShot[];
  vitals: (Vital & { idx: number })[];
  ammoBoxes: (AmmoBox & { idx: number })[];
  keycards: (Keycard & { idx: number })[];
  weaponPickups: (WeaponPickup & { idx: number })[];
  readonly doors: Door[];
  readonly slides: number[];
  readonly obstacles: readonly Obstacle[];
  exit: Marker | null;
}
