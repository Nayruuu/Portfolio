import { describe, it, expect } from 'vitest';
import {
  ARSENAL,
  CURRENT_WEAPON,
  RANGE_CELLS,
  RELOAD_VIEW_CONFIG,
  STARTING_WEAPON_IDS,
  WEAPONS,
  WEAPON_IDS,
  WEAPON_VIEW_CONFIG,
  ammoTypeMax,
  asFireMode,
  asRangeName,
  asWeaponType,
  requireWeapon,
  weaponById,
  weaponCombat,
  weaponViewConfig,
  reloadViewConfig,
  type Weapon,
} from './weapons';
import { AIM_CONE, MELEE_CONE, MELEE_RANGE } from '../game-tuning';

/** A bare weapon carrying only the required registry fields — every optional left absent so a test can
 *  assert the `weaponCombat` / `weaponViewConfig` defaults the frozen JSON never exercises on its own. */
function syntheticWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    slot: 9,
    id: 'synthetic',
    name: 'Synthetic',
    type: 'hitscan',
    damage: 10,
    range: 'medium',
    ammoType: null,
    sprite_fps: '/game/weapons/synthetic/fps.webp',
    icon: '/game/weapons/synthetic/icon.webp',
    ...overrides,
  };
}

describe('weapons registry', () => {
  it('keeps the WEAPON_IDS value set and the JSON registry in lockstep (order included)', () => {
    expect(WEAPONS.map((weapon) => weapon.id)).toEqual([...WEAPON_IDS]);
  });

  it('starts the run FISTS-ONLY — every other weapon (chainsaw included) is a level pickup', () => {
    expect(STARTING_WEAPON_IDS).toEqual(['fist']);
  });

  it('resolves a required weapon by id, failing loud on an id the registry does not declare', () => {
    expect(requireWeapon('shotgun').id).toBe('shotgun');
    expect(() => requireWeapon('bazooka')).toThrowError(/must declare a weapon with id "bazooka"/);
  });

  it('parses the slot-1 mechanical fist with its re-balanced fields', () => {
    expect(CURRENT_WEAPON.slot).toBe(1);
    expect(CURRENT_WEAPON.id).toBe('fist');
    expect(CURRENT_WEAPON.type).toBe('melee');
    expect(CURRENT_WEAPON.damage).toBe(35);
    expect(CURRENT_WEAPON.fireRate_s).toBeCloseTo(0.6, 5);
    expect(CURRENT_WEAPON.range).toBe('melee');
    expect(CURRENT_WEAPON.ammoType).toBeNull();
    expect(CURRENT_WEAPON.knockback).toBeCloseTo(0.6, 5);
    expect(CURRENT_WEAPON.sprite_fps).toBe('/game/weapons/fist/fps.webp');
    expect(CURRENT_WEAPON.sprite_run).toBe('/game/weapons/fist/run.webp'); // the hand-drawn guard walk cycle
    expect(CURRENT_WEAPON.run_frames).toBe(4); // its four bob cells
    expect(CURRENT_WEAPON.run_scale).toBeCloseTo(0.6, 5); // resting guard trimmed under the taller 9-frame jab cell
    expect(CURRENT_WEAPON.icon).toBe('/game/weapons/fist/icon.webp');
  });

  it('derives the shared FPS view config from the global animation metadata', () => {
    expect(WEAPON_VIEW_CONFIG.frameCount).toBe(4); // idle + fire_start + fire_peak + recoil
    expect(WEAPON_VIEW_CONFIG.frameDuration_s).toBeCloseTo(0.06, 5); // frame_ms 60 → 0.06 s
    expect(WEAPON_VIEW_CONFIG.heightRatio).toBeCloseTo(0.6, 5); // fps_sprite_height_frac
    expect(WEAPON_VIEW_CONFIG.baseOffset).toBe(0); // no vertical nudge by default
    expect(WEAPON_VIEW_CONFIG.swingTravel).toBe(0); // a gun doesn't arc through its shot
    expect(WEAPON_VIEW_CONFIG.anchorX).toBe(0.5); // frame-centred by default
    expect(WEAPON_VIEW_CONFIG.idleFrame).toBe(0);
    expect(WEAPON_VIEW_CONFIG.fireSequence).toEqual([1, 2, 3, 0]); // fire frames, then back to idle
    expect(WEAPON_VIEW_CONFIG.strikeIndex).toBe(1); // position of `fire_peak` within the sequence
  });

  it('uses a weapon’s own `anim` override when declared (the fist’s 3-cell two-hand jab — keyboard hand + a descending left fist), else the shared default (the pistol)', () => {
    const fist = weaponViewConfig(CURRENT_WEAPON);

    expect(fist.frameCount).toBe(3); // the widened jab strip: keyboard hand (right, full size) + a left fist that drops away
    expect(fist.frameDuration_s).toBeCloseTo(0.085, 5); // 85 ms/frame — a snappy jab rhythm
    // the 3-frame sequence runs in 3 × 85 ms = 0.255 s, inside the fist's 0.6 s cooldown
    expect(fist.fireSequence).toEqual([0, 1, 2]); // keyboard extends → thrust → contact, the left fist recoiling lower each frame
    expect(fist.idleFrame).toBe(2); // the last sequence entry — only a brief fallback before the `sprite_run` guard decodes (the real resting base)
    expect(fist.strikeIndex).toBe(2); // `damage_frame` 2 (the spark contact) is the last frame, position 2
    expect(fist.heightRatio).toBeCloseTo(0.6 * 0.62, 5); // global × view_scale — sizes the jab (the resting guard is trimmed separately via `run_scale`)
    expect(fist.baseOffset).toBe(0); // this art's wrist reaches the box bottom → seats on the bar, no nudge
    expect(fist.swingTravel).toBe(0); // no procedural arc — the jab's travel lives in the art frames
    expect(fist.anchorX).toBeCloseTo(0.5, 5); // the two-hand pair (left fist + keyboard) is centred as a group under the crosshair

    const pistol = weaponById('pistol');

    if (!pistol) {
      throw new Error('weapons.json must declare the pistol');
    }
    const pistolConfig = weaponViewConfig(pistol);

    // No `anim` → the shared 4-frame layout, but its on-screen size is scaled by `view_scale` (0.52) so the
    // slot-2 weapon's drawn body sits in the shared size band.
    expect(pistolConfig.frameCount).toBe(WEAPON_VIEW_CONFIG.frameCount);
    expect(pistolConfig.fireSequence).toEqual(WEAPON_VIEW_CONFIG.fireSequence);
    expect(pistolConfig.idleFrame).toBe(WEAPON_VIEW_CONFIG.idleFrame);
    expect(pistolConfig.strikeIndex).toBe(WEAPON_VIEW_CONFIG.strikeIndex);
    expect(pistolConfig.heightRatio).toBeCloseTo(0.6 * 0.52, 5); // global × view_scale
    expect(pistolConfig.baseOffset).toBe(0); // no view_offset → shared anchor
    expect(pistolConfig.swingTravel).toBe(0); // a gun doesn't arc
    expect(pistolConfig.anchorX).toBe(0.5); // no view_anchor_x → frame-centred default
  });

  it('derives the reload view config from the global reload-animation metadata', () => {
    expect(RELOAD_VIEW_CONFIG.frameCount).toBe(3); // the reload strip's down → insert → up cells
  });

  it('overrides the reload frame count + scale per weapon (the Hilti ships 4 cells, others fall back to 3)', () => {
    const hilti = weaponById('shotgun');
    const chaingun = weaponById('chaingun');
    const nerf = weaponById('pistol');

    if (!hilti || !chaingun || !nerf) {
      throw new Error('weapons.json must declare the shotgun + chaingun + pistol');
    }
    expect(reloadViewConfig(hilti).frameCount).toBe(4); // its own reload strip (reach → feed → feed → idle)
    expect(reloadViewConfig(chaingun).frameCount).toBe(3); // no override → the shared count
    expect(reloadViewConfig(nerf).scale).toBeCloseTo(1.5, 5); // the Nerf's zoomed-out reload is drawn larger
    expect(reloadViewConfig(chaingun).scale).toBe(1); // no override → drawn at the fire-frame scale
  });

  it('resolves a weapon by id (and `undefined` for an unknown id)', () => {
    expect(weaponById('fist')).toBe(CURRENT_WEAPON);
    expect(weaponById('nope')).toBeUndefined();
    expect(WEAPONS).toContain(CURRENT_WEAPON);
  });

  it('derives the fist’s melee combat view: `melee` reach + wide cone, no ammo cost', () => {
    const combat = weaponCombat(CURRENT_WEAPON);

    expect(combat.damage).toBe(35);
    expect(combat.range).toBeCloseTo(RANGE_CELLS.melee, 5);
    expect(combat.range).toBeCloseTo(MELEE_RANGE, 5); // 1.4 — the engine's shared swing reach
    expect(combat.cone).toBe(MELEE_CONE); // `melee` kind → the wide swing cone
    expect(combat.fireCooldown).toBeCloseTo(0.6, 5);
    expect(combat.knockback).toBeCloseTo(0.6, 5);
    expect(combat.costsAmmo).toBe(false); // ammoType === null
  });

  it('exposes the full arted arsenal: fist → chainsaw → pistol → shotgun → chaingun → lithium → plasma → datacenter BFG, in order', () => {
    expect(ARSENAL.map((weapon) => weapon.id)).toEqual([
      'fist',
      'chainsaw',
      'pistol',
      'shotgun',
      'chaingun',
      'rocket',
      'plasma',
      'bfg',
    ]);
    expect(ARSENAL).toHaveLength(8); // every slot is now arted (HUD 1..8)
    expect(ARSENAL[0]).toBe(CURRENT_WEAPON); // index 0 is the default, active-on-spawn weapon
    // Every weapon is arted now, so the whole registry is switchable (the `sprite_fps` guard still holds).
    expect(ARSENAL.every((weapon) => weapon.sprite_fps !== '')).toBe(true);
    expect(ARSENAL).toHaveLength(WEAPONS.length); // no un-arted weapon left out
  });

  it('derives the chainsaw alt’s melee combat view: fast continuous tick, wide cone, ammo-less', () => {
    const chainsaw = weaponById('chainsaw');

    if (!chainsaw) {
      throw new Error('weapons.json must declare the chainsaw');
    }

    expect(chainsaw.fireMode).toBe('auto'); // continuous hold-to-saw — the held trigger keeps it running

    expect(weaponCombat(chainsaw)).toEqual({
      damage: 16, // per tick — the held auto melee shreds at the 0.11s cadence
      range: MELEE_RANGE,
      cone: MELEE_CONE, // `melee_alt` still starts with `melee` → the wide swing cone
      fireCooldown: 0.11, // the continuous-saw tick interval (110 ms), held-auto via `fireMode`
      knockback: 0.2,
      costsAmmo: false, // ammoType === null
      ammoType: null, // ammo-less melee weapon
      ammoPerShot: 1, // ammo-less melee declares none → the default 1 (inert: magazine-less)
      magSize: 0, // magazine-less melee weapon
      reloadTime: 0,
      pellets: 1, // no `pellets` → a single hitscan ray (the unchanged path)
      selfKnockback: 0, // no `selfKnockback` → no self-recoil
      projectile: null, // a melee weapon → no projectile launch
      impactKind: 'impact_metal', // its melee hit plays metal sparks
    });
  });

  it('parses the slot-2 pistol with its magazine fields + reload strip', () => {
    const pistol = weaponById('pistol');

    if (!pistol) {
      throw new Error('weapons.json must declare the pistol');
    }

    expect(pistol.slot).toBe(2);
    expect(pistol.type).toBe('hitscan');
    expect(pistol.magSize).toBe(24);
    expect(pistol.reloadTime_s).toBeCloseTo(1.1, 5);
    expect(pistol.sprite_fps).toBe('/game/weapons/pistol/fps.webp');
    expect(pistol.sprite_reload).toBe('/game/weapons/pistol/reload.webp');
    expect(pistol.icon).toBe('/game/weapons/pistol/icon.webp');
  });

  it('derives the pistol’s ranged combat view: medium reach, narrow cone, magazine + reload, spends ammo', () => {
    const pistol = weaponById('pistol');

    if (!pistol) {
      throw new Error('weapons.json must declare the pistol');
    }
    const combat = weaponCombat(pistol);

    expect(combat.range).toBe(RANGE_CELLS.medium); // its `medium` bucket reach, not a melee reach
    expect(combat.cone).toBe(AIM_CONE); // a non-melee kind → the narrow aim cone
    expect(combat.knockback).toBe(0); // no `knockback` field → defaults to 0
    expect(combat.costsAmmo).toBe(true); // ammoType !== null (it spends bullets)
    expect(combat.fireCooldown).toBeCloseTo(0.32, 5); // its `fireRate_s`
    expect(combat.magSize).toBe(24); // a magazine weapon
    expect(combat.reloadTime).toBeCloseTo(1.1, 5);
  });

  it('leaves the magazine fields at 0 for a magazine-less weapon (the fist)', () => {
    const combat = weaponCombat(CURRENT_WEAPON);

    expect(combat.magSize).toBe(0); // no `magSize` → defaults to 0 (melee / flat pool)
    expect(combat.reloadTime).toBe(0);
  });

  it('leaves a single-ray weapon at pellets 1 with no self-recoil (the pistol)', () => {
    const pistol = weaponById('pistol');

    if (!pistol) {
      throw new Error('weapons.json must declare the pistol');
    }
    const combat = weaponCombat(pistol);

    expect(combat.pellets).toBe(1); // no `pellets` → a single hitscan ray
    expect(combat.selfKnockback).toBe(0); // no `selfKnockback` → no recoil
    expect(combat.cone).toBe(AIM_CONE); // no `spread_deg` → the narrow aim cone (not a spread fan)
  });

  it('parses the slot-3 shotgun with its spread + magazine fields', () => {
    const shotgun = weaponById('shotgun');

    if (!shotgun) {
      throw new Error('weapons.json must declare the shotgun');
    }

    expect(shotgun.slot).toBe(3);
    expect(shotgun.type).toBe('hitscan_spread');
    expect(shotgun.pellets).toBe(9);
    expect(shotgun.spread_deg).toBe(16);
    expect(shotgun.selfKnockback).toBeCloseTo(0.4, 5);
    expect(shotgun.magSize).toBe(6);
    expect(shotgun.reloadTime_s).toBeCloseTo(1.4, 5);
    expect(shotgun.sprite_fps).toBe('/game/weapons/shotgun/fps.webp');
    expect(shotgun.sprite_reload).toBe('/game/weapons/shotgun/reload.webp');
    expect(shotgun.icon).toBe('/game/weapons/shotgun/icon.webp');
  });

  it('derives the shotgun’s shotgun combat view: short reach, a spread fan, recoil, magazine + reload', () => {
    const shotgun = weaponById('shotgun');

    if (!shotgun) {
      throw new Error('weapons.json must declare the shotgun');
    }

    expect(weaponCombat(shotgun)).toEqual({
      damage: 9,
      range: RANGE_CELLS.short,
      cone: (16 * Math.PI) / 180, // `spread_deg` 16° → the fan half-angle (≈ 0.279 rad)
      fireCooldown: 0.85,
      knockback: 2.2,
      costsAmmo: true, // ammoType !== null (it spends shells)
      ammoType: 'shells', // the shotgun's shells reserve
      ammoPerShot: 1, // one canister per blast
      magSize: 6,
      reloadTime: 1.4,
      pellets: 9, // a multi-pellet shotgun blast
      selfKnockback: 0.4, // the CO2 self-recoil
      projectile: null, // a hitscan shotgun → no projectile launch
      impactKind: 'impact_metal', // hot sparks/embers per struck enemy (the heat-gun retheme)
    });
  });

  it('parses the slot-4 chaingun as a full-auto chaingun: fireMode + fast frame duration + magazine', () => {
    const chaingun = weaponById('chaingun');

    if (!chaingun) {
      throw new Error('weapons.json must declare the chaingun');
    }

    expect(chaingun.slot).toBe(4);
    expect(chaingun.type).toBe('hitscan'); // still a single-ray hitscan per nail
    expect(chaingun.fireMode).toBe('auto'); // the held-trigger burst mode
    expect(chaingun.fireFrameDuration_s).toBeCloseTo(0.035, 5); // the faster burst-loop frame duration
    expect(chaingun.magSize).toBe(80);
    expect(chaingun.reloadTime_s).toBeCloseTo(1.6, 5);
    expect(chaingun.spread_deg).toBe(4);
    expect(chaingun.ammoType).toBe('bullets');
    expect(chaingun.sprite_fps).toBe('/game/weapons/chaingun/fps.webp');
    expect(chaingun.sprite_reload).toBe('/game/weapons/chaingun/reload.webp');
    expect(chaingun.icon).toBe('/game/weapons/chaingun/icon.webp');
  });

  it('derives the chaingun’s combat view: medium reach, a tight spread cone, magazine, single ray, spends ammo', () => {
    const chaingun = weaponById('chaingun');

    if (!chaingun) {
      throw new Error('weapons.json must declare the chaingun');
    }
    const combat = weaponCombat(chaingun);

    expect(combat.damage).toBe(11);
    expect(combat.range).toBe(RANGE_CELLS.medium);
    expect(combat.cone).toBeCloseTo((4 * Math.PI) / 180, 6); // `spread_deg` 4° → a tight cone (≈ 0.07 rad)
    expect(combat.fireCooldown).toBeCloseTo(0.07, 5); // its `fireRate_s` — the engine cadences the burst off it
    expect(combat.pellets).toBe(1); // a single hitscan ray per nail (not a shotgun spread)
    expect(combat.magSize).toBe(80);
    expect(combat.reloadTime).toBeCloseTo(1.6, 5);
    expect(combat.costsAmmo).toBe(true); // ammoType !== null (it spends bullets)
    expect(combat.selfKnockback).toBe(0); // no self-recoil
  });

  it('derives the slot-5 lithium rocket as a projectile-AOE weapon: a launch spec instead of a hitscan ray', () => {
    const rocket = weaponById('rocket');

    if (!rocket) {
      throw new Error('weapons.json must declare the rocket');
    }
    const combat = weaponCombat(rocket);

    expect(combat.damage).toBe(55); // the direct-hit damage
    expect(combat.knockback).toBeCloseTo(3, 5); // the blast shove
    expect(combat.magSize).toBe(1); // a single rocket per reload
    expect(combat.reloadTime).toBeCloseTo(1.5, 5);
    expect(combat.selfKnockback).toBeCloseTo(1.6, 5); // the launch recoil (separate from the blast self-damage)
    expect(combat.projectile).toEqual({
      speed: 11,
      splashDamage: 90,
      splashRadius: 2.6,
      selfDamage: true,
      chain: null, // an AOE rocket — no chain rider
      kind: 'rocket', // billboards the proj_rocket sprite
    });
    expect(combat.projectile?.chain).toBeNull();
  });

  it('parses the slot-6 plasma cable as an auto beam_chain with its chain + magazine fields', () => {
    const plasma = weaponById('plasma');

    if (!plasma) {
      throw new Error('weapons.json must declare the plasma');
    }

    expect(plasma.slot).toBe(6);
    expect(plasma.type).toBe('beam_chain');
    expect(plasma.fireMode).toBe('auto');
    expect(plasma.chainTargets).toBe(4);
    expect(plasma.chainRange).toBe(4);
    expect(plasma.chainFalloff).toBeCloseTo(0.75, 5);
    expect(plasma.magSize).toBe(40);
    expect(plasma.ammoType).toBe('cells');
    expect(plasma.sprite_fps).toBe('/game/weapons/plasma/fps.webp');
    expect(plasma.sprite_reload).toBe('/game/weapons/plasma/reload.webp');
    expect(plasma.icon).toBe('/game/weapons/plasma/icon.webp');
  });

  it('derives the slot-6 plasma cable as a beam_chain projectile: a chain rider on the launch spec', () => {
    const plasma = weaponById('plasma');

    if (!plasma) {
      throw new Error('weapons.json must declare the plasma');
    }
    const combat = weaponCombat(plasma);

    expect(combat.damage).toBe(16); // the direct-hit damage
    expect(combat.magSize).toBe(40);
    expect(combat.reloadTime).toBeCloseTo(1.5, 5);
    expect(combat.projectile).toEqual({
      speed: 14,
      splashDamage: 0, // a chain, not an AOE — the splash is zeroed
      splashRadius: 0,
      selfDamage: false,
      chain: { targets: 4, range: 4, falloff: 0.75 },
      kind: 'plasma', // billboards the proj_plasma sprite (intentionally blue)
    });
  });

  it('parses the slot-7 datacenter BFG as a charge weapon with its big-AOE + magazine fields', () => {
    const bfg = weaponById('bfg');

    if (!bfg) {
      throw new Error('weapons.json must declare the bfg');
    }

    expect(bfg.slot).toBe(7);
    expect(bfg.type).toBe('projectile_aoe'); // a projectile + splash, NOT a screen nuke
    expect(bfg.fireMode).toBe('charge'); // the spin-up-then-discharge mode
    expect(bfg.chargeTime_s).toBeCloseTo(0.7, 5);
    expect(bfg.ammoPerShot).toBe(40); // one shot drains the whole magazine
    expect(bfg.magSize).toBe(40);
    expect(bfg.ammoType).toBe('cells'); // the shared pool with the plasma
    expect(bfg.sprite_fps).toBe('/game/weapons/bfg/fps.webp');
    expect(bfg.sprite_reload).toBe('/game/weapons/bfg/reload.webp');
    expect(bfg.icon).toBe('/game/weapons/bfg/icon.webp');
  });

  it('derives the datacenter BFG’s combat view: a huge self-damaging AOE projectile draining 40 rounds/shot', () => {
    const bfg = weaponById('bfg');

    if (!bfg) {
      throw new Error('weapons.json must declare the bfg');
    }
    const combat = weaponCombat(bfg);

    expect(combat.damage).toBe(450); // the direct-hit damage (buffed — the ultimate weapon)
    expect(combat.ammoPerShot).toBe(40); // a full-magazine charge per shot
    expect(combat.magSize).toBe(40);
    expect(combat.reloadTime).toBeCloseTo(2, 5);
    expect(combat.fireCooldown).toBeCloseTo(1.6, 5);
    expect(combat.knockback).toBeCloseTo(6, 5);
    expect(combat.selfKnockback).toBeCloseTo(1.2, 5);
    expect(combat.projectile).toEqual({
      speed: 8, // a SLOW travelling projectile
      splashDamage: 900,
      splashRadius: 7.5, // a HUGE blast (buffed)
      selfDamage: true, // it can rocket-jump / hurt its own firer
      chain: null, // an AOE blast — no chain rider
      kind: 'bfg', // billboards the proj_bfg sprite (intentionally green)
    });
  });

  it('keeps `projectile` null for a hitscan / melee weapon (the fist)', () => {
    expect(weaponCombat(CURRENT_WEAPON).projectile).toBeNull();
  });

  it('defaults fireMode to undefined (semi) for a weapon that declares none (the fist)', () => {
    expect(CURRENT_WEAPON.fireMode).toBeUndefined(); // absent in the JSON → the implicit one-shot trigger
  });
});

describe('weapons — world-effects mapping', () => {
  const requireWeapon = (id: string) => {
    const weapon = weaponById(id);

    if (!weapon) {
      throw new Error(`weapons.json must declare ${id}`);
    }

    return weapon;
  };

  it('converts the pistol from hitscan to a travelling staple projectile (splash-less, fast)', () => {
    const projectile = weaponCombat(requireWeapon('pistol')).projectile;

    expect(projectile).not.toBeNull(); // it now TRAVELS — no longer a hitscan target
    expect(projectile?.kind).toBe('staple');
    expect(projectile?.splashDamage).toBe(0); // a direct-hit traveller, no AOE
    expect(projectile?.splashRadius).toBe(0);
    expect(projectile?.chain).toBeNull();
    expect(projectile?.speed).toBe(18); // fast cells/s so it reads near-instant
  });

  it('converts the chaingun from hitscan to a travelling nail projectile (splash-less, fast)', () => {
    const projectile = weaponCombat(requireWeapon('chaingun')).projectile;

    expect(projectile).not.toBeNull();
    expect(projectile?.kind).toBe('nail');
    expect(projectile?.splashDamage).toBe(0);
    expect(projectile?.speed).toBe(22);
  });

  it('sets impactKind from the mapping for every weapon (melee, hitscan, projectile, AOE)', () => {
    const impactOf = (id: string): string => weaponCombat(requireWeapon(id)).impactKind;

    expect(impactOf('fist')).toBe('impact_metal'); // kit `hitEffect`, normalized to `impact`
    expect(impactOf('chainsaw')).toBe('impact_metal');
    expect(impactOf('pistol')).toBe('impact_metal');
    expect(impactOf('chaingun')).toBe('impact_metal');
    expect(impactOf('shotgun')).toBe('impact_metal');
    expect(impactOf('rocket')).toBe('explosion');
    expect(impactOf('plasma')).toBe('impact_plasma');
    expect(impactOf('bfg')).toBe('explosion_bfg');
  });
});

describe('weapons — JSON literal narrowing (the typed bridge)', () => {
  it('recovers the literal weapon type, failing loud on an unknown kind', () => {
    expect(asWeaponType('hitscan')).toBe('hitscan');
    expect(() => asWeaponType('railgun')).toThrowError(/unknown weapon type "railgun"/);
  });

  it('recovers the literal range bucket, failing loud on an unknown bucket', () => {
    expect(asRangeName('medium')).toBe('medium');
    expect(() => asRangeName('galactic')).toThrowError(/unknown range "galactic"/);
  });

  it('recovers the optional fire mode: absent stays undefined, a known mode narrows, an unknown fails loud', () => {
    expect(asFireMode(undefined)).toBeUndefined(); // absent → the implicit `semi`
    expect(asFireMode('auto')).toBe('auto');
    expect(() => asFireMode('burst')).toThrowError(/unknown fireMode "burst"/);
  });
});

describe('weapons — derivation defaults the frozen registry never exercises alone', () => {
  it('defaults every optional view-config field when a weapon declares none', () => {
    const config = weaponViewConfig(syntheticWeapon()); // no anim, no view_* overrides

    expect(config.frameCount).toBe(WEAPON_VIEW_CONFIG.frameCount); // no `anim` → the shared layout
    expect(config.heightRatio).toBeCloseTo(WEAPON_VIEW_CONFIG.heightRatio, 5); // view_scale ?? 1
    expect(config.baseOffset).toBe(0); // view_offset ?? 0
    expect(config.swingTravel).toBe(0); // swing_travel ?? 0
    expect(config.anchorX).toBe(0.5); // view_anchor_x ?? 0.5
  });

  it('defaults fireCooldown to 0 for a weapon that declares no fireRate_s', () => {
    expect(weaponCombat(syntheticWeapon({ fireRate_s: undefined })).fireCooldown).toBe(0);
  });

  it('leaves an unmapped weapon hitscan with no projectile and an empty impact kind', () => {
    const combat = weaponCombat(syntheticWeapon({ id: 'unmapped_kind' })); // no effects-mapping entry

    expect(combat.projectile).toBeNull(); // effects?.projectile ?? null → null → no launch
    expect(combat.impactKind).toBe(''); // effects?.impact ?? '' → the empty fallback
  });

  it('defaults a launcher’s projectile speed to 0 when it declares none', () => {
    const combat = weaponCombat(syntheticWeapon({ id: 'pistol', projectileSpeed: undefined }));

    expect(combat.projectile?.speed).toBe(0); // launches (staple) but projectileSpeed absent → 0
  });

  it('defaults an AOE launcher’s splash to 0 when it declares none', () => {
    const combat = weaponCombat(
      syntheticWeapon({ id: 'rocket', splashDamage: undefined, splashRadius: undefined }),
    );

    expect(combat.projectile?.splashDamage).toBe(0);
    expect(combat.projectile?.splashRadius).toBe(0);
  });

  it('defaults a chain launcher’s hop range to 0 and falloff to 1 when it declares neither', () => {
    const combat = weaponCombat(
      syntheticWeapon({
        id: 'plasma',
        chainTargets: 3,
        chainRange: undefined,
        chainFalloff: undefined,
      }),
    );

    expect(combat.projectile?.chain).toEqual({ targets: 3, range: 0, falloff: 1 });
  });

  it('caps an ammo type at its declared max, and 0 for an unknown type', () => {
    expect(ammoTypeMax('bullets')).toBeGreaterThan(0); // a declared ammo type → its `ammo_types` cap
    expect(ammoTypeMax('unobtainium')).toBe(0); // an unknown type → the 0 fallback
  });
});
