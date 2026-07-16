import { PICKUP_SPIN_MS, VITAL_LARGE, VITAL_SMALL } from '../game-tuning';
import type { KeycardColor } from '../types';
import type { ZoneSnapshot } from '../zone';
import { ammoTypeMax, WEAPON_IDS, requireWeapon, type WeaponId } from '../presentation/weapons';
import type { Level } from '../level';

// 'armor' is shown as MENTAL in the HUD.
export type VitalKind = 'health' | 'armor';
export type VitalSize = 'large' | 'small';

export interface VitalSpec {
  readonly kind: VitalKind;
  readonly size: VitalSize;
  readonly texName: string;
  readonly url: string;
  readonly frames: number;
  readonly frameMs: number;
  readonly worldHeight: number;
  readonly aspect: number;
  readonly amount: number;
  readonly spin: boolean; // false = hold frame 0
}

export const HEALTH_LARGE_SPEC: VitalSpec = {
  kind: 'health',
  size: 'large',
  texName: 'PICKUP_HEALTH_LARGE',
  url: '/game/pickups/health_large_medkit_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.6,
  aspect: 359 / 269,
  amount: VITAL_LARGE,
  spin: true,
};

export const HEALTH_SMALL_SPEC: VitalSpec = {
  kind: 'health',
  size: 'small',
  texName: 'PICKUP_HEALTH_SMALL',
  url: '/game/pickups/health_small_plant_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.45,
  aspect: 240 / 379,
  amount: VITAL_SMALL,
  spin: true,
};

export const MENTAL_LARGE_SPEC: VitalSpec = {
  kind: 'armor',
  size: 'large',
  texName: 'PICKUP_MENTAL_LARGE',
  url: '/game/pickups/mental_large_figurine_rot.webp',
  frames: 7,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.8,
  aspect: 377 / 688,
  amount: VITAL_LARGE,
  spin: true,
};

export const MENTAL_SMALL_SPEC: VitalSpec = {
  kind: 'armor',
  size: 'small',
  texName: 'PICKUP_MENTAL_SMALL',
  url: '/game/pickups/mental_small_card_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.3,
  aspect: 369 / 353,
  amount: VITAL_SMALL,
  spin: true,
};

const VITAL_SPECS: Readonly<Record<VitalKind, Readonly<Record<VitalSize, VitalSpec>>>> = {
  health: { large: HEALTH_LARGE_SPEC, small: HEALTH_SMALL_SPEC },
  armor: { large: MENTAL_LARGE_SPEC, small: MENTAL_SMALL_SPEC },
};

export function vitalSpec(kind: VitalKind, size: VitalSize = 'large'): VitalSpec {
  return VITAL_SPECS[kind][size];
}

export interface AmmoBoxSpec {
  readonly id: string;
  readonly texName: string;
  readonly url: string;
  readonly frames: number;
  readonly frameMs: number;
  readonly worldHeight: number;
  readonly aspect: number;
  readonly ammoType: string;
  readonly amount: number;
  readonly max: number;
}

const AMMO_WORLD_HEIGHT = 0.5;

function box(
  id: string,
  ammoType: string,
  amount: number,
  url: string,
  frames: number,
  frameMs: number,
  cellW: number,
  cellH: number,
): AmmoBoxSpec {
  return {
    id,
    texName: `AMMO_${id.toUpperCase()}`, // keyed by the unique box id (two boxes can share an ammoType)
    url,
    frames,
    frameMs,
    worldHeight: AMMO_WORLD_HEIGHT,
    aspect: cellW / cellH,
    ammoType,
    amount,
    max: ammoTypeMax(ammoType),
  };
}

export const AMMO_BOX_SPECS: readonly AmmoBoxSpec[] = [
  box(
    'box_staples',
    'bullets',
    20,
    '/game/weapons/pistol/ammo/staples_turn_strip.webp',
    7,
    PICKUP_SPIN_MS,
    150,
    168,
  ),
  box(
    'box_nails',
    'bullets',
    20,
    '/game/weapons/chaingun/ammo/nails_turn_strip.webp',
    7,
    PICKUP_SPIN_MS,
    157,
    148,
  ),
  box(
    'gas_canister',
    'shells',
    5,
    '/game/weapons/shotgun/ammo/canister_turn_strip.webp',
    7,
    PICKUP_SPIN_MS,
    144,
    140,
  ),
  box(
    'energy_cell',
    'cells',
    40,
    '/game/weapons/plasma/ammo/cell_turn_strip.webp',
    7,
    PICKUP_SPIN_MS,
    138,
    211,
  ),
  box(
    'battery_pack',
    'rockets',
    2,
    '/game/weapons/rocket/ammo/battery_turn_strip.webp',
    7,
    PICKUP_SPIN_MS,
    149,
    256,
  ),
  box(
    'server_cell',
    'cells',
    80,
    '/game/weapons/bfg/ammo/cell_large_turn_strip.webp',
    6,
    PICKUP_SPIN_MS,
    156,
    232,
  ),
];

// `url`/`frames`/`aspect` describe the 2D icon billboard — the fallback when a weapon has no pickup.vox yet
// (the vox path renders a rotating VOLUME instead and ignores frames; see loadWeaponPickupVox).
export interface WeaponPickupSpec {
  readonly id: WeaponId;
  readonly texName: string;
  readonly url: string;
  readonly frames: number;
  readonly frameMs: number;
  readonly worldHeight: number;
  /** Display height of the VOX collectible (the 2D icon billboard keeps `worldHeight`). */
  readonly voxHeight: number;
  readonly aspect: number;
  readonly ammoType: string | null;
}

const WEAPON_ICON_ASPECTS: Readonly<Record<WeaponId, number>> = {
  fist: 338 / 259,
  chainsaw: 456 / 134,
  pistol: 266 / 300,
  shotgun: 600 / 469,
  chaingun: 460 / 246,
  rocket: 360 / 193,
  plasma: 416 / 223,
  bfg: 699 / 375,
};

const WEAPON_WORLD_HEIGHT = 0.55;

// Display height of the VOX collectible per weapon (the 2D icon keeps WEAPON_WORLD_HEIGHT): with the
// model's own ratio driving the width, the height is the one size knob — a pistol is a small thing,
// a chainsaw is not. Unlisted weapons default to WEAPON_WORLD_HEIGHT.
const WEAPON_VOX_HEIGHTS: Partial<Record<WeaponId, number>> = {
  pistol: 0.38,
};

export const WEAPON_PICKUP_SPECS: readonly WeaponPickupSpec[] = WEAPON_IDS.map((id) => {
  const weapon = requireWeapon(id);

  return {
    id,
    texName: `PICKUP_WEAPON_${id.toUpperCase()}`,
    url: weapon.icon,
    frames: 1,
    frameMs: PICKUP_SPIN_MS,
    worldHeight: WEAPON_WORLD_HEIGHT,
    voxHeight: WEAPON_VOX_HEIGHTS[id] ?? WEAPON_WORLD_HEIGHT,
    aspect: WEAPON_ICON_ASPECTS[id],
    ammoType: weapon.ammoType,
  };
});

export function weaponPickupSpec(id: WeaponId): WeaponPickupSpec {
  const spec = WEAPON_PICKUP_SPECS.find((candidate) => candidate.id === id);

  if (spec === undefined) {
    throw new Error(`weapon pickup: no spec for weapon id "${id}"`);
  }

  return spec;
}

export function weaponAmmoDose(ammoType: string | null): number {
  if (ammoType === null) {
    return 0;
  }

  return AMMO_BOX_SPECS.find((box) => box.ammoType === ammoType)?.amount ?? 0;
}

export interface Vital {
  x: number;
  y: number;
  z: number;
  age: number;
  spec: VitalSpec;
}

export interface AmmoBox {
  x: number;
  y: number;
  z: number;
  age: number;
  spec: AmmoBoxSpec;
}

export interface WeaponPickup {
  x: number;
  y: number;
  z: number;
  age: number;
  spec: WeaponPickupSpec;
}

export interface Keycard {
  x: number;
  y: number;
  z: number;
  age: number;
  spec: KeycardSpec;
}

export interface MarkerSpec {
  readonly texName: string;
  readonly url: string;
  readonly worldHeight: number;
  readonly aspect: number;
}

export interface Marker {
  x: number;
  y: number;
  z: number;
  spec: MarkerSpec;
}

export interface KeycardSpec {
  readonly color: KeycardColor;
  readonly texName: string;
  readonly url: string;
  readonly frames: number;
  readonly frameMs: number;
  readonly worldHeight: number;
  readonly aspect: number;
}

export const KEYCARD_EMPLOYEE: KeycardSpec = {
  color: 'blue',
  texName: 'PICKUP_KEYCARD_EMPLOYEE',
  url: '/game/pickups/keycard_employee_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.65,
  aspect: 358 / 678,
};

export const KEYCARD_MANAGER: KeycardSpec = {
  color: 'yellow',
  texName: 'PICKUP_KEYCARD_MANAGER',
  url: '/game/pickups/keycard_manager_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.65,
  aspect: 360 / 678,
};

export const KEYCARD_DIRECTOR: KeycardSpec = {
  color: 'red',
  texName: 'PICKUP_KEYCARD_DIRECTOR',
  url: '/game/pickups/keycard_director_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.65,
  aspect: 397 / 678,
};

const KEYCARD_SPECS: Readonly<Record<KeycardColor, KeycardSpec>> = {
  blue: KEYCARD_EMPLOYEE,
  yellow: KEYCARD_MANAGER,
  red: KEYCARD_DIRECTOR,
};

export function keycardSpec(color: KeycardColor): KeycardSpec {
  return KEYCARD_SPECS[color];
}

export const EXIT_SPEC: MarkerSpec = {
  texName: 'EXIT_SIGN',
  url: '/game/pickups/exit.webp',
  worldHeight: 1.6,
  aspect: 240 / 320,
};

export const PICKUP_TEXTURE_JOBS: readonly { name: string; url: string }[] = [
  ...[HEALTH_LARGE_SPEC, HEALTH_SMALL_SPEC, MENTAL_LARGE_SPEC, MENTAL_SMALL_SPEC].map((spec) => ({
    name: spec.texName,
    url: spec.url,
  })),
  ...AMMO_BOX_SPECS.map((spec) => ({ name: spec.texName, url: spec.url })),
  ...WEAPON_PICKUP_SPECS.map((spec) => ({ name: spec.texName, url: spec.url })),
  ...[KEYCARD_EMPLOYEE, KEYCARD_MANAGER, KEYCARD_DIRECTOR].map((spec) => ({
    name: spec.texName,
    url: spec.url,
  })),
  { name: EXIT_SPEC.texName, url: EXIT_SPEC.url },
];

export interface BuiltPickups {
  readonly vitals: (Vital & { idx: number })[];
  readonly ammoBoxes: (AmmoBox & { idx: number })[];
  readonly keycards: (Keycard & { idx: number })[];
  readonly weaponPickups: (WeaponPickup & { idx: number })[];
  readonly exit: Marker | null;
}

// ⚠️ Each pickup's idx is its persistence key — it MUST stay index-aligned with the taken arrays takenFlags
// produces (vitals = health then armor in spawn order; ammo follows AMMO_BOX_SPECS; keycards/weapons follow
// authoring order). A drift respawns a collected pickup (or vanishes a fresh one) across a zone crossing.
export function buildPickups(
  level: Level,
  snap: ZoneSnapshot | null,
  floorAt: (x: number, y: number) => number,
): BuiltPickups {
  const vitals = [
    ...level.health.map(([x, y, size]) => ({ spec: vitalSpec('health', size), x, y })),
    ...level.armor.map(([x, y, size]) => ({ spec: vitalSpec('armor', size), x, y })),
  ]
    .map((v, idx) => ({ ...v, idx, z: floorAt(v.x, v.y), age: 0 }))
    .filter((v) => snap?.vitalsTaken[v.idx] !== true);
  const ammoBoxes = AMMO_BOX_SPECS.map((spec, idx) => ({
    spec,
    idx,
    x: level.ammo[idx][0],
    y: level.ammo[idx][1],
    z: floorAt(level.ammo[idx][0], level.ammo[idx][1]),
    age: 0,
  })).filter((b) => snap?.ammoTaken[b.idx] !== true);
  const keycards = level.keycards
    .map(([x, y, color], idx) => ({
      spec: keycardSpec(color),
      idx,
      x,
      y,
      z: floorAt(x, y),
      age: 0,
    }))
    .filter((k) => snap?.cardsTaken[k.idx] !== true);
  const weaponPickups = (level.weapons ?? [])
    .map(([x, y, id], idx) => ({ spec: weaponPickupSpec(id), idx, x, y, z: floorAt(x, y), age: 0 }))
    .filter((p) => snap?.weaponsTaken[p.idx] !== true);
  const exit = level.exit;

  return {
    vitals,
    ammoBoxes,
    keycards,
    weaponPickups,
    exit:
      exit === undefined
        ? null
        : { spec: EXIT_SPEC, x: exit[0], y: exit[1], z: floorAt(exit[0], exit[1]) },
  };
}

// Before the atlases decode nothing has spawned, so every flag is false (not "all taken").
export function takenFlags(
  count: number,
  remaining: readonly { idx: number }[],
  atlasesReady: boolean,
): boolean[] {
  if (!atlasesReady) {
    return Array.from({ length: count }, () => false);
  }
  const left = new Set(remaining.map((p) => p.idx));

  return Array.from({ length: count }, (_, i) => !left.has(i));
}

export function pickupFrame(age: number, frameMs: number, frames: number, spin = true): number {
  return spin ? Math.floor(age / (frameMs / 1000)) % frames : 0;
}
