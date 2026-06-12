import { ARSENAL } from '../../../../shared/game/weapons';
import { effectAssetUrls } from '../../../../shared/game/effects';
import { DOOR_OPEN_STRIP_URL, ENV_TEXTURES } from './textures';
import { hudAssetUrls } from '../../../../shared/game/doom-hud';
import { CLIMB_FRAME_URLS } from '../../../../shared/game/climb-frames';
import { ENEMY_ATLAS_URLS } from './enemy-sprite';
import { AMMO_PICKUPS } from './ammo-pickups';

/** Every served strip of one arsenal weapon (FPS / idle / run / reload viewmodel + HUD bay icon). */
function weaponUrls(weapon: (typeof ARSENAL)[number]): readonly (string | undefined)[] {
  return [
    weapon.sprite_fps,
    weapon.sprite_idle,
    weapon.sprite_run,
    weapon.sprite_reload,
    weapon.icon,
  ];
}

/**
 * The CRITICAL set — what is on screen the instant the loop starts, so it MUST be decoded before launch (no
 * placeholder pop-in for anything immediately visible):
 *  • environment — every present wall / floor / ceiling / glass texture (`textures.json`),
 *  • enemies — the directional foes' state atlases (`enemy-sprite.ts`),
 *  • HUD — every tier's bar / face / digits / arms / keycard art (`doom-hud-atlas.json`),
 *  • the STARTING weapon's viewmodel + icon (`ARSENAL[0]`, the fist).
 * Deduped, pure (no DOM). Procedural art (theme walls, keycards, the exit switch) carries no URL.
 */
export function criticalAssetUrls(): readonly string[] {
  const all = [
    ...ENV_TEXTURES.map((texture) => texture.file),
    ...ENEMY_ATLAS_URLS,
    ...hudAssetUrls(),
    ...weaponUrls(ARSENAL[0]),
  ].filter((url): url is string => !!url);

  return [...new Set(all)];
}

/**
 * The DEFERRED set — art that only appears on a player ACTION, so it can stream in BEHIND the first frame
 * without ever popping in (the renderer draws nothing until a sprite decodes):
 *  • the OTHER weapons' strips + icons (seen only once you switch — `ARSENAL[1..]`),
 *  • effects — projectile billboards + impact bursts (first thrown report / first hit — `effects.json`),
 *  • the door-open animation strip (only at a door — `textures.json`),
 *  • hands — the first-person mantle/climb overlay frames (only mid-climb — `shared/game/climb-frames.ts`),
 *  • ammo-box turntables (only when a pickup is in view — `ammo-pickups.ts`).
 * Deduped, and with any URL already in the critical set removed (so the two lists never double-load).
 */
export function deferredAssetUrls(): readonly string[] {
  const all = [
    ...ARSENAL.slice(1).flatMap(weaponUrls),
    ...effectAssetUrls(),
    DOOR_OPEN_STRIP_URL,
    ...CLIMB_FRAME_URLS,
    ...AMMO_PICKUPS.map((pickup) => pickup.sprite.strip),
  ].filter((url): url is string => !!url);
  const critical = new Set(criticalAssetUrls());

  return [...new Set(all)].filter((url) => !critical.has(url));
}

/** The full served-image set (critical + deferred), deduped — the union both stages cover between them. */
export function gameAssetUrls(): readonly string[] {
  return [...new Set([...criticalAssetUrls(), ...deferredAssetUrls()])];
}
