import type { Barrel } from '../combat';
import type { EnemyShot } from '../enemy';
import type { KeycardColor } from '../types';
import type { CompiledMap, MapSource, MutableSector, Obstacle } from '../../bsp-engine';
import type { Level } from '../level';
import type { Foe } from './enemy-runtime';
import type { AmmoBox, Keycard, Marker, Vital, WeaponPickup } from './pickups';

export interface ZoneExit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly to: string;
  readonly entry: string;
}

export interface Door {
  readonly sector: number;
  readonly triggerX: number;
  readonly triggerY: number;
  readonly closedCeilZ: number; // == floorZ → no headroom → physics blocks it
  readonly openCeilZ: number;
  readonly requiresCard: KeycardColor | null;
  openness: number; // 0 shut .. 1 open
}

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

export interface SlidingDoor {
  readonly line: number;
  readonly mx: number;
  readonly my: number;
}

// The SAME shape backs BOTH the active floor and the warm neighbor, so a seam crossing is a pointer SWAP.
export interface WarmZone {
  readonly key: string;
  readonly level: Level;
  // A bare (pre-atlas) world must never be snapshotted — its empty pickup lists would persist as "all taken".
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
