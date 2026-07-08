import type { KeycardColor, ZoneSnapshot } from '../../core/lib';
import { AMMO_MAX, WEAPON_IDS, requireWeapon, type WeaponId } from '../../shared/game/weapons';
import type { Level } from '../../core/lib';

/**
 * Pickup + objective registry for the BSP demo — VITALS (health / armour), spinning AMMO boxes, the 3-tier
 * access BADGES (keycards), and the EXIT marker. This stays a FEATURE file: it imports the weapon runtime
 * from {@link ../../shared/game/weapons}, and core may not import shared (inward-only), so it cannot move
 * to `core/lib` the way the enemy roster did.
 *
 * The single source of truth still holds: each ammo box's reserve CAP is read from {@link AMMO_MAX}
 * (`weapons.json` `ammo_types`). Vitals + badges + the exit carry their own served sprites
 * (`/game/pickups/*.webp`).
 */

/** `armor` is the second vital — shown as MENTAL in the HUD (the burnt-out-dev's sanity buffer). */
export type VitalKind = 'health' | 'armor';
export type VitalSize = 'large' | 'small';

/** Walk this close (world units) to collect any pickup — mirrors the grid's `PICKUP_RADIUS`. */
export const PICKUP_RADIUS = 0.6;
/** Grants: a SMALL vital tops up +25, a LARGE one +50; both cap at 100 (the grid's vitals tuning). */
export const VITAL_SMALL = 25;
export const VITAL_LARGE = 50;
export const VITAL_MAX = 100;

/** A vitals pickup's rotating-turntable billboard + grant. Health = a first-aid medkit (large) / desk plant
 *  (small); MENTAL = a desk figurine (large) / morale card (small) — the office-satire re-theme. */
export interface VitalSpec {
  readonly kind: VitalKind;
  readonly size: VitalSize;
  readonly texName: string;
  readonly url: string; // served turntable strip (a `frames`×1 horizontal atlas, center-bottom anchored)
  readonly frames: number; // turntable cells (the rotation atlas)
  readonly frameMs: number; // ms each spin frame holds
  readonly worldHeight: number; // billboard height in world units
  readonly aspect: number; // source cell width : height
  readonly amount: number; // hp/mental granted on collect
  readonly spin: boolean; // animate the turntable (false = hold frame 0, a static billboard)
}

/** Shared spin cadence for EVERY rotating floor pickup — vitals AND ammo boxes — so they turn coherently
 *  (400 ms/frame ≈ 2.4–2.8 s per full turn depending on the strip's frame count). Single source of truth. */
const PICKUP_SPIN_MS = 400;

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
  spin: true, // medkit
};

export const HEALTH_SMALL_SPEC: VitalSpec = {
  kind: 'health',
  size: 'small',
  texName: 'PICKUP_HEALTH_SMALL',
  url: '/game/pickups/health_small_plant_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.45, // deliberately SMALLER than the medkit (0.6) — a minor health top-up
  aspect: 240 / 379,
  amount: VITAL_SMALL,
  spin: true, // plant
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
  spin: true, // figurine keeps rotating
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
  spin: true, // card
};

const VITAL_SPECS: Readonly<Record<VitalKind, Readonly<Record<VitalSize, VitalSpec>>>> = {
  health: { large: HEALTH_LARGE_SPEC, small: HEALTH_SMALL_SPEC },
  armor: { large: MENTAL_LARGE_SPEC, small: MENTAL_SMALL_SPEC },
};

/** Resolve the vitals spec for a kind + size (a level's placement picks the size; default `large`). */
export function vitalSpec(kind: VitalKind, size: VitalSize = 'large'): VitalSpec {
  return VITAL_SPECS[kind][size];
}

/** A rotating ammo box: its turntable strip (`frames` cells advanced over `frameMs`) + which reserve it refills.
 *  `max` is single-sourced from {@link AMMO_MAX}; `amount`/`frameMs`/art mirror the shared `ammo-pickups.json`. */
export interface AmmoBoxSpec {
  readonly id: string;
  readonly texName: string;
  readonly url: string; // served turn strip (a `frames`×1 horizontal strip)
  readonly frames: number;
  readonly frameMs: number; // ms each spin frame holds
  readonly worldHeight: number;
  readonly aspect: number; // source cell width : height
  readonly ammoType: string; // which reserve it refills (an `ammo_types` key)
  readonly amount: number; // rounds granted on collect
  readonly max: number; // reserve cap for this type — a full type never consumes the box
}

/** Ammo boxes read as the smallest floor items (well under an enemy or a vitals pickup). */
const AMMO_WORLD_HEIGHT = 0.5;

/** Build one ammo-box spec; `aspect` follows the source cell, `max` is sourced from {@link AMMO_MAX}. */
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
    texName: `AMMO_${id.toUpperCase()}`, // keyed by the unique box id (two boxes can share an ammoType — cells)
    url,
    frames,
    frameMs,
    worldHeight: AMMO_WORLD_HEIGHT,
    aspect: cellW / cellH,
    ammoType,
    amount,
    max: AMMO_MAX[ammoType] ?? 0,
  };
}

/** Every ammo-box kind the demo places (one per ammo type), mirroring `ammo-pickups.json` grants + strips. */
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
  // The shotgun is the Hilti DX 460 now, so its ammo box (ammoType 'shells') is the Hilti .22 cal box: a
  // 7-frame turntable (the metal-back duplicates trimmed so the label/cartridges always show), landscape cell,
  // baseline-aligned to seat flush like the other boxes.
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
  // The big "server cell" — a richer cells box (the BFG-datacenter flavour): grants more rounds than the
  // standard energy cell.
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

/** A WEAPON pickup's floor billboard + identity — the DOOM progression rewards (`Level.weapons`): the run
 *  starts fists-only and each of these unlocks its weapon on collect (+ one standard ammo box of its type,
 *  see {@link weaponAmmoDose}). Shaped like the ammo-box turntable so future rotation art is a drop-in;
 *  v1 ART PLACEHOLDER: the weapon's HUD bay icon (`weapons.json` `icon`, alpha-cut) as a single-frame
 *  billboard — replace `url`/`frames`/`aspect` with a real `_rot` strip when each weapon's turntable ships. */
export interface WeaponPickupSpec {
  readonly id: WeaponId;
  readonly texName: string;
  readonly url: string; // served art (v1: the HUD icon; later a `frames`×1 turntable strip)
  readonly frames: number; // turntable cells (1 = the static v1 placeholder)
  readonly frameMs: number; // ms each spin frame holds
  readonly worldHeight: number; // billboard height in world units
  readonly aspect: number; // source cell width : height
  readonly ammoType: string | null; // the reserve the starter dose tops up (null = an ammo-less melee weapon)
}

/** The v1 icon cells' width:height (measured from the served `icon.webp` files) — dies with the
 *  placeholder art: a real turntable strip carries its own cell aspect. */
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

/** Weapon pickups read bigger than an ammo box, under the vitals — a reward the eye finds across a room. */
const WEAPON_WORLD_HEIGHT = 0.55;

/** One pickup spec per registry weapon, in arsenal order (`requireWeapon` fails loud on a drifted id). */
export const WEAPON_PICKUP_SPECS: readonly WeaponPickupSpec[] = WEAPON_IDS.map((id) => {
  const weapon = requireWeapon(id);

  return {
    id,
    texName: `PICKUP_WEAPON_${id.toUpperCase()}`,
    url: weapon.icon,
    frames: 1,
    frameMs: PICKUP_SPIN_MS,
    worldHeight: WEAPON_WORLD_HEIGHT,
    aspect: WEAPON_ICON_ASPECTS[id],
    ammoType: weapon.ammoType,
  };
});

/** Resolve the pickup spec for a weapon id — the placement side of `Level.weapons`. */
export function weaponPickupSpec(id: WeaponId): WeaponPickupSpec {
  const spec = WEAPON_PICKUP_SPECS.find((candidate) => candidate.id === id);

  if (spec === undefined) {
    throw new Error(`weapon pickup: no spec for weapon id "${id}"`); // unreachable while WEAPON_IDS covers the registry
  }

  return spec;
}

/** The starter ammo DOSE a weapon pickup grants its ammo type: exactly ONE standard ammo box of that type
 *  (the first {@link AMMO_BOX_SPECS} entry for it — 20 bullets / 5 shells / 40 cells / 2 rockets), so the
 *  weapon-pickup grant reuses the box economy instead of inventing its own; 0 for an ammo-less melee weapon. */
export function weaponAmmoDose(ammoType: string | null): number {
  if (ammoType === null) {
    return 0;
  }

  return AMMO_BOX_SPECS.find((box) => box.ammoType === ammoType)?.amount ?? 0;
}

/** A placed vitals pickup on the floor. */
export interface Vital {
  x: number;
  y: number;
  z: number;
  age: number; // spin clock (advances the turntable frame)
  spec: VitalSpec;
}

/** A placed, spinning ammo box on the floor (`age` is its spin clock). */
export interface AmmoBox {
  x: number;
  y: number;
  z: number;
  age: number;
  spec: AmmoBoxSpec;
}

/** A placed weapon pickup on the floor (`age` is its spin clock — held at frame 0 while the v1
 *  single-frame placeholder art stands in for the future turntable strip). */
export interface WeaponPickup {
  x: number;
  y: number;
  z: number;
  age: number;
  spec: WeaponPickupSpec;
}

/** A placed, spinning access badge on the floor (`age` is its spin clock, like {@link Vital}). */
export interface Keycard {
  x: number;
  y: number;
  z: number;
  age: number;
  spec: KeycardSpec;
}

/** A single-sprite floor billboard (the exit sign): art + world sizing, no animation. */
export interface MarkerSpec {
  readonly texName: string;
  readonly url: string;
  readonly worldHeight: number;
  readonly aspect: number;
}

/** A placed single-sprite floor marker (the exit sign) — a {@link MarkerSpec} positioned in the world. */
export interface Marker {
  x: number;
  y: number;
  z: number;
  spec: MarkerSpec;
}

/** An access BADGE turntable — a corporate keycard that gates its colour-matched door; shows in the HUD card
 *  bay on collect. Rendered as a spinning turntable billboard (a `frames`×1 horizontal strip, center-bottom
 *  anchored), exactly like the vitals/ammo pickups. Its HUD card + door colour is {@link KeycardColor}. */
export interface KeycardSpec {
  readonly color: KeycardColor;
  readonly texName: string;
  readonly url: string; // served turntable strip (a `frames`×1 horizontal atlas, center-bottom anchored)
  readonly frames: number; // turntable cells (the rotation atlas)
  readonly frameMs: number; // ms each spin frame holds
  readonly worldHeight: number; // billboard height in world units
  readonly aspect: number; // source cell width : height
}

/** BLUE tier — the base "employee" badge (unlocks blue doors). */
export const KEYCARD_EMPLOYEE: KeycardSpec = {
  color: 'blue',
  texName: 'PICKUP_KEYCARD_EMPLOYEE',
  url: '/game/pickups/keycard_employee_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.65,
  aspect: 358 / 678,
};

/** YELLOW tier — the mid "manager" badge (unlocks yellow doors). */
export const KEYCARD_MANAGER: KeycardSpec = {
  color: 'yellow',
  texName: 'PICKUP_KEYCARD_MANAGER',
  url: '/game/pickups/keycard_manager_rot.webp',
  frames: 6,
  frameMs: PICKUP_SPIN_MS,
  worldHeight: 0.65,
  aspect: 360 / 678,
};

/** RED tier — the top "director" badge (unlocks red doors). */
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

/** Resolve the badge spec for a keycard colour (blue = employee, yellow = manager, red = director). */
export function keycardSpec(color: KeycardColor): KeycardSpec {
  return KEYCARD_SPECS[color];
}

/** The EXIT sign — the level goal; reaching it WITH the keycard completes the level. */
export const EXIT_SPEC: MarkerSpec = {
  texName: 'EXIT_SIGN',
  url: '/game/pickups/exit.webp',
  worldHeight: 1.6,
  aspect: 240 / 320,
};
/** Walk this close to the exit sign to trigger the finish (it sits flush against the hall's far wall). */
export const EXIT_RADIUS = 1.5;

/** Every pickup/marker texture to decode (vitals + ammo strips + weapon pickups + the 3 badge turntables
 *  + exit) — each a single-row sheet. */
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

// (Per-level pickup/objective PLACEMENTS live on the level — see `level-accueil.ts` `Level` — so a level owns
// where its entities sit; this file owns only the level-agnostic specs/art above.)

/** A zone's placed floor pickups (each carrying its spawn `idx`) + the legacy exit marker — the output of
 *  {@link buildPickups}, matching the pickup slots of `WarmZone`. */
export interface BuiltPickups {
  readonly vitals: (Vital & { idx: number })[];
  readonly ammoBoxes: (AmmoBox & { idx: number })[];
  readonly keycards: (Keycard & { idx: number })[];
  readonly weaponPickups: (WeaponPickup & { idx: number })[];
  readonly exit: Marker | null;
}

/**
 * Build a zone's floor pickups (coffee = health, RAM = armour, spinning boxes = ammo, weapon unlocks,
 * spinning access badges) + the legacy exit marker, each seated on its sector floor via `floorAt`. Each
 * pickup carries its spawn INDEX (`idx`) and anything the zone's `snap` flags as TAKEN is skipped — collected
 * items stay gone on return. Pure: `floorAt` is the only world seam (the shell resolves it from its map).
 *
 * ⚠️ The idx assigned here is the persistence key: it MUST stay index-aligned with the taken arrays
 * {@link takenFlags} produces — vitals are `health` then `armor` in spawn order, ammo boxes follow
 * {@link AMMO_BOX_SPECS} (one `level.ammo` coord per entry, in order), keycards/weapons follow their
 * authoring order. A drift here respawns a collected pickup (or vanishes a fresh one) across a zone crossing.
 */
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

/** Taken flags for an index-carrying pickup list: `true` at each index where no remaining pickup still
 *  carries it (i.e. it was collected). The counterpart to {@link buildPickups}'s idx scheme — feed the result
 *  into a {@link ZoneSnapshot}. Before the atlases decode nothing has spawned (`atlasesReady` false), so
 *  nothing can have been taken — every flag is `false`. */
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

/** The turntable cell a rotating floor pickup shows: `age` (seconds) advances one cell per `frameMs`, wrapping
 *  at `frames`. A non-spinning billboard (`spin` false — e.g. a static vitals variant) always holds cell 0. */
export function pickupFrame(age: number, frameMs: number, frames: number, spin = true): number {
  return spin ? Math.floor(age / (frameMs / 1000)) % frames : 0;
}
