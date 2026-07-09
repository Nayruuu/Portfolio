import { describe, it, expect } from 'vitest';
import {
  impactEffect,
  normalizeWeaponEffect,
  projectileEffect,
  projectileWidth,
  projectileWidthOr,
  weaponEffects,
} from './effects';

describe('effects bridge', () => {
  it('maps a projectile kind to its served sprite + source dimensions', () => {
    expect(projectileEffect('staple')).toEqual({
      sprite: '/game/weapons/pistol/effects/proj_staple.webp',
      width: 171, // the Nerf dart (slot-2 weapon's projectile)
      height: 376,
      size: 0.4, // draws smaller than the canvas-relative default (rocket/plasma/BFG at 1)
      anchorX: 0.5, // already centred in its frame (the plasma/BFG sit at 0.6)
      drop: 0.24, // the slot-2 dart rides lower than the rocket/plasma/BFG (0.12)
    });
    expect(projectileEffect('bfg')?.sprite).toBe('/game/weapons/bfg/effects/proj_bfg.webp');
    expect(projectileEffect('nope')).toBeUndefined(); // an unknown kind → no sprite
  });

  it('derives a projectile kind world width (scale × size × art aspect), undefined for an unknown kind', () => {
    const staple = projectileEffect('staple')!;

    expect(projectileWidth('staple')).toBeCloseTo(
      0.42 * staple.size * (staple.width / staple.height),
    );
    expect(projectileWidth('nope')).toBeUndefined(); // an unknown kind → no width
  });

  it('sizes a known projectile kind, or falls back for an unknown one (the total-lookup form)', () => {
    expect(projectileWidthOr('staple', 0.45)).toBe(projectileWidth('staple'));
    expect(projectileWidthOr('nope', 0.45)).toBe(0.45); // unknown kind → the caller's fallback
  });

  it('maps an impact kind to its served strip + frame layout', () => {
    expect(impactEffect('explosion')).toEqual({
      sheet: '/game/effects/impacts/explosion_strip.webp',
      frames: 4,
      frameWidth: 141,
      frameHeight: 129,
      size: 1, // default; only the BFG blast (`explosion_bfg`) is scaled up
      widthScale: 1, // no horizontal stretch; only the BFG blast spreads wide
      frameDuration_s: 0.05,
    });
    expect(impactEffect('impact_metal')?.frames).toBe(3);
    expect(impactEffect('nope')).toBeUndefined(); // an unknown kind → no strip
  });

  it('maps a weapon id to its projectile/impact, normalizing the kit `hitEffect` to `impact`', () => {
    expect(weaponEffects('pistol')).toEqual({
      projectile: 'staple',
      impact: 'impact_metal',
      hitscan: false,
      melee: false,
      aoe: false,
    });
    // The two melee weapons declare the kit's `hitEffect` key — the bridge folds it into `impact`.
    expect(weaponEffects('fist')).toEqual({
      projectile: null,
      impact: 'impact_metal',
      hitscan: false,
      melee: true,
      aoe: false,
    });
    expect(weaponEffects('rocket')?.aoe).toBe(true); // an AOE projectile
    expect(weaponEffects('shotgun')?.hitscan).toBe(true); // a hitscan spread
    expect(weaponEffects('nope')).toBeUndefined(); // an unmapped weapon
  });

  it('normalizes a raw mapping entry, folding hitEffect → impact and defaulting every absent field', () => {
    // A melee-style entry: only `hitEffect` present → folds into `impact`, flags default off.
    expect(normalizeWeaponEffect({ hitEffect: 'impact_metal', melee: true })).toEqual({
      projectile: null,
      impact: 'impact_metal',
      hitscan: false,
      melee: true,
      aoe: false,
    });
    // An entirely empty entry: neither `impact` nor `hitEffect` → the empty-string fallback, all flags off.
    expect(normalizeWeaponEffect({})).toEqual({
      projectile: null,
      impact: '',
      hitscan: false,
      melee: false,
      aoe: false,
    });
  });
});
