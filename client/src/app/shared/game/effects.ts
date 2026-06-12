import effects from './effects.json';

/**
 * The data-driven WORLD-EFFECTS bridge — a typed surface over `effects.json`, exactly as `weapons.ts`
 * bridges `weapons.json`. It feeds two GENERIC systems reused by every weapon with NO per-weapon code:
 *  • `projectiles` — one billboard SPRITE per travelling-projectile kind (`staple` / `nail` / `rocket` /
 *    `plasma` / `bfg`); the renderer face-cameras it at the projectile's world point, distance-scaled.
 *  • `impacts` — one horizontal sprite STRIP per impact kind, played once at every hit (a projectile
 *    detonation, a hitscan ray, or a melee swing); the renderer animates the frame from the impact's age.
 * `weapon_mapping` ties a weapon id to its projectile kind (or none → a hitscan / melee weapon), the
 * impact kind it plays on a hit, and the combat-path flags (`hitscan` / `melee` / `aoe`). `weaponCombat`
 * (weapons.ts) reads it to set `impactKind` + the launched projectile spec; the renderer reads the
 * sprite/sheet paths. The kit names the two melee weapons' hit effect `hitEffect` and every other
 * weapon's `impact`; the bridge folds both into a single `impact` field.
 */

/** One travelling-projectile sprite: a single billboard frame, face-camera, distance-scaled at runtime. */
export interface ProjectileEffect {
  sprite: string; // served WebP URL (`/game/weapons/effects/projectiles/proj_<kind>.webp`)
  width: number; // source pixel width (drives the billboard aspect ratio)
  height: number; // source pixel height
  size: number; // on-screen size multiplier over the shared projectile scale (the small staple/nail draw smaller than the rocket/plasma/BFG despite the canvas-relative sizing); 1 = full
  anchorX: number; // horizontal centre of the sprite's CONTENT (0..1) — the billboard aligns this point to the firing line, so a ball drawn off-centre in its frame (the plasma/BFG sit at 0.6) reads centred on the weapon; 0.5 = already centred
  drop: number; // depth-attenuated downward shift (canvas-height fraction) — how far below the crosshair this projectile rides (bigger = lower; the one-handed staple/nail sit lower than the rocket/plasma/BFG)
}

/** One impact animation: a horizontal strip played ONCE on a hit (apparition → dissipation), then gone. */
export interface ImpactEffect {
  sheet: string; // served strip WebP URL (`/game/weapons/effects/impacts/<kind>_strip.webp`)
  frames: number; // cells across the strip
  frameWidth: number; // source cell width (px)
  frameHeight: number; // source cell height (px)
  size: number; // on-screen size multiplier over the shared impact scale (the BFG blast draws bigger than the rest); 1 = default
  widthScale: number; // extra HORIZONTAL stretch only (height unchanged) — a wide blast that spreads sideways; 1 = the sprite's own aspect
  frameDuration_s: number; // seconds each frame holds
}

/** What a weapon contributes to the world-effects layer: the optional projectile sprite kind (null = a
 *  hitscan / melee weapon), the impact kind played at every hit, and the combat-path flags mirroring the
 *  engine branch the weapon takes. Purely visual wiring — the combat numbers stay in `weapons.ts`. */
export interface WeaponEffect {
  projectile: string | null; // a `projectiles` key, or null for a hitscan / melee weapon
  impact: string; // an `impacts` key, played at every hit
  hitscan: boolean; // resolves as a hitscan ray (the shotgun spread)
  melee: boolean; // resolves as a melee swing (the fist / chainsaw)
  aoe: boolean; // the projectile detonates a splash blast (the rocket / BFG) vs a point impact
}

/** The raw `weapon_mapping` entry before normalization: the kit names the melee weapons' hit effect
 *  `hitEffect` and every other weapon's `impact` — `weaponEffects` folds both into `impact`. */
interface RawWeaponEffect {
  projectile?: string;
  impact?: string;
  hitEffect?: string;
  hitscan?: boolean;
  melee?: boolean;
  aoe?: boolean;
}

const RAW_WEAPON_MAPPING: Record<string, RawWeaponEffect> = effects.weapon_mapping;

const PROJECTILE_EFFECTS: ReadonlyMap<string, ProjectileEffect> = new Map(
  Object.entries(effects.projectiles).map(([kind, spec]) => [
    kind,
    {
      sprite: spec.sprite,
      width: spec.w,
      height: spec.h,
      size: spec.size,
      anchorX: spec.anchorX,
      drop: spec.drop,
    },
  ]),
);

const IMPACT_EFFECTS: ReadonlyMap<string, ImpactEffect> = new Map(
  Object.entries(effects.impacts).map(([kind, spec]) => [
    kind,
    {
      sheet: spec.sheet,
      frames: spec.frames,
      frameWidth: spec.frameWidth,
      frameHeight: spec.frameHeight,
      size: spec.size,
      widthScale: spec.widthScale,
      frameDuration_s: spec.frameDuration_s,
    },
  ]),
);

const WEAPON_EFFECTS: ReadonlyMap<string, WeaponEffect> = new Map(
  Object.entries(RAW_WEAPON_MAPPING).map(([id, raw]) => [
    id,
    {
      projectile: raw.projectile ?? null,
      impact: raw.impact ?? raw.hitEffect ?? '',
      hitscan: raw.hitscan ?? false,
      melee: raw.melee ?? false,
      aoe: raw.aoe ?? false,
    },
  ]),
);

/** The projectile sprite for a kind (`staple` … `bfg`), or `undefined` for an unknown kind. */
export function projectileEffect(kind: string): ProjectileEffect | undefined {
  return PROJECTILE_EFFECTS.get(kind);
}

/** The impact animation for a kind (`impact_metal` … `explosion_bfg`), or `undefined` for an unknown kind. */
export function impactEffect(kind: string): ImpactEffect | undefined {
  return IMPACT_EFFECTS.get(kind);
}

/** The world-effects mapping for a weapon id, or `undefined` if the kit declares none. */
export function weaponEffects(id: string): WeaponEffect | undefined {
  return WEAPON_EFFECTS.get(id);
}

/** Every served image the world-effects layer draws — each projectile billboard sprite + each impact strip
 *  sheet — for the asset preloader (so projectiles/impacts never pop in on their first hit). */
export function effectAssetUrls(): string[] {
  return [
    ...[...PROJECTILE_EFFECTS.values()].map((effect) => effect.sprite),
    ...[...IMPACT_EFFECTS.values()].map((effect) => effect.sheet),
  ];
}
