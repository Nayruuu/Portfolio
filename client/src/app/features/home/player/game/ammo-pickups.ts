import ammoPickups from './ammo-pickups.json';

/**
 * The data-driven AMMO-PICKUP bridge — a typed surface over `ammo-pickups.json`, exactly as `effects.ts`
 * bridges `effects.json`. Each entry is one rotating ammo box: which ammo type it refills, how much it
 * grants, and the camera-facing turntable STRIP the renderer spins (one frame per `frame_ms`, the spin
 * faked by advancing the frame index — the quad is never rotated). The per-type reserve CAP is NOT here:
 * it is sourced once from `weapons.json` `ammo_types[ammoType].max` (`weapons.ts` `ammoTypeMax`), so the
 * cap stays single-sourced with the weapons.
 *
 * To add the next ammo type: drop its strip in `public/game/weapons/ammo/<type>/`, add an entry here + its
 * `ammo_types` max in `weapons.json`, and emit its `AmmoSpawn` from the level — the SAME code renders +
 * collects it (no per-type branch in the engine or the renderer).
 */

/** One ammo box's turntable sprite strip: `frames` cells of `cellW × cellH`, advanced over `frameMs`. */
export interface AmmoPickupSprite {
  strip: string; // served strip WebP URL (`/game/weapons/ammo/<type>/..._turn_strip.webp`)
  frames: number; // cells across the strip (one full 360° turntable)
  cellW: number; // source cell width (px) — drives the billboard aspect
  cellH: number; // source cell height (px)
  frameMs: number; // ms each spin frame holds
  anchorX: number; // horizontal centre of the sprite's content (0..1)
  anchorY: number; // vertical centre of the sprite's content (0..1)
}

/** One ammo-pickup descriptor: the ammo type it refills, the amount it grants, and its turntable sprite. */
export interface AmmoPickupDescriptor {
  id: string; // the `ammo-pickups.json` key (an `AmmoSpawn.pickupId` / `AmmoPickup.kind`)
  ammoType: string; // which `playerAmmo` reserve it refills (an `ammo_types` key)
  amount: number; // rounds granted on collect
  sprite: AmmoPickupSprite;
}

const DESCRIPTORS: ReadonlyMap<string, AmmoPickupDescriptor> = new Map(
  Object.entries(ammoPickups).map(([id, spec]) => [
    id,
    {
      id,
      ammoType: spec.ammoType,
      amount: spec.amount,
      sprite: {
        strip: spec.sprite.strip,
        frames: spec.sprite.frames,
        cellW: spec.sprite.cellW,
        cellH: spec.sprite.cellH,
        frameMs: spec.sprite.frame_ms,
        anchorX: spec.sprite.anchorX,
        anchorY: spec.sprite.anchorY,
      },
    },
  ]),
);

/** Every ammo-pickup descriptor, in registry order. */
export const AMMO_PICKUPS: readonly AmmoPickupDescriptor[] = [...DESCRIPTORS.values()];

/** The descriptor for a pickup id (`box_staples` …), or `undefined` for an unknown id. */
export function ammoPickupById(id: string): AmmoPickupDescriptor | undefined {
  return DESCRIPTORS.get(id);
}
