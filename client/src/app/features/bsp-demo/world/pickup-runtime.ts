import type { Camera, MutableSector } from '../../../core/lib/bsp-engine';
import {
  DOOR_TRIGGER_RADIUS,
  EXIT_RADIUS,
  HINT_DURATION,
  PICKUP_FX_DURATION,
  PICKUP_RADIUS,
  SLIDE_TRIGGER_RADIUS,
  shouldAutoEquip,
  stepDoorOpenness,
  stepSlideOpenness,
  type KeycardColor,
} from '../../../core/lib';
import { weaponAmmoDose, type WeaponPickupSpec } from './pickups';
import { ARSENAL, ammoTypeMax } from '../../../shared/game/weapons';
import type { DoomHud } from '../../../shared/game/doom-hud';
import type { Door, SlidingDoor, WarmZone, ZoneExit } from './zone-world';

/** When true, ammo boxes spin but are never collected (art-inspection mode) — mirrors the old component flag. */
const INSPECT_PICKUPS: boolean = false;

/** The player-grant seam the pickup runtime drives — the subset of {@link CombatRuntime} a collected item
 *  actuates: refill vitals/ammo (capped), query the reserve/ownership, unlock + auto-equip a weapon, drop the
 *  held trigger on a zone exit, and win the legacy exit. Narrowed to a structural interface so the pickup loop
 *  never reaches into the combat runtime's wider surface (and a test can pass a real runtime or a spy). */
export interface PickupGrant {
  heal(amount: number): void;
  addArmor(amount: number): void;
  addAmmo(ammoType: string, amount: number, max: number): void;
  reserveOf(ammoType: string): number;
  owns(id: string): boolean;
  grantWeapon(id: string): void;
  selectWeapon(index: number): void;
  endFire(): void;
  win(): void;
}

/** The zone-world seam the pickup runtime reads + drives — the subset of {@link ZoneRuntime} the pickup /
 *  objective / door loops touch: the MUTABLE active world (its pickup + door + slide arrays, collected/animated
 *  in place BY REFERENCE), the derived exit/slide indexes, the in-flight transition (null-checked), the arrival
 *  guard, and the transition + door-stamp drivers. Structurally satisfied by {@link ZoneRuntime}; a test seats
 *  a light fixture. */
export interface PickupZone {
  /** The active floor's live world — pickups/doors/slides mutated in place (no copies). */
  readonly world: WarmZone;
  /** The active zone's graph exits — walk into one to fade to the next floor. */
  readonly exits: readonly ZoneExit[];
  /** The active zone's sliding glass doors (line + trigger midpoint) for the proximity drive. */
  readonly slidingDoors: readonly SlidingDoor[];
  /** The in-flight FADE transition (null outside one) — the objective step only arms a new one when idle. */
  readonly transition: object | null;
  /** Arrival guard — exits re-arm only once the player has left every exit radius (read + written here). */
  exitsLocked: boolean;
  /** Arm a FADE transition to zone `to` at its named `entry` (a walk-into exit). */
  beginTransition(to: string, entry: string): void;
  /** Stamp each door's current ceilZ into the live sector heights (render + physics read them the same frame). */
  applyDoors(doors: readonly Door[], sectors: MutableSector[]): void;
}

/** The between-subsystem seams the pickup runtime needs but does NOT own: the SHARED player camera (read for
 *  proximity), the {@link DoomHud} (a collected badge lights its card bay), the player-grant API, and the
 *  zone world it collects over. */
export interface PickupRuntimeHooks {
  /** The shared player camera — read-only here (proximity to floor items / exits / door + slide triggers). */
  readonly camera: Camera;
  /** The DOOM status bar — a collected badge lights its HUD card; a new-game reset clears the bay. */
  readonly hud: DoomHud;
  /** The player-grant API a collected item actuates (health/armour/ammo/weapon + the exit flow). */
  readonly combat: PickupGrant;
  /** The active zone world + its exit/slide indexes + transition drivers, all by reference. */
  readonly zone: PickupZone;
}

/**
 * The PICKUP + OBJECTIVE + DOOR stepping of the BSP game: the behaviour collaborator that READS the zone world
 * (pickups / doors / slides / sectors / exits, owned by {@link ZoneRuntime}) and, on proximity, GRANTS to the
 * player through the {@link PickupGrant} API + lights HUD badge cards + drives the zone-exit transition. It owns
 * the player's collected BADGE set (so the locked-door gate reads it internally by reference — zero coupling)
 * plus the two collect-feedback timers (the green pickup flash + the transient "badge requis" hint) the overlay
 * painter reads. Every array it mutates lives on the zone world and is written IN PLACE (a collected pickup is
 * filtered out of its list, a door writes its sector's live ceilZ, a slide writes the `slides` array the
 * renderer reads the same frame) — no copies. The component stays the coordinator: it calls {@link decayFx}
 * then, in play, {@link stepPickups} → {@link stepObjective} → {@link stepDoors} → {@link stepSliding} at the
 * same points its old inline steppers ran, so the frame order is byte-identical.
 */
export class PickupRuntime {
  private readonly badges = new Set<KeycardColor>(); // collected access-badge colours → unlock the matching doors
  private flash = 0; // seconds left on the green pickup flash (collected an item) — the overlay reads it
  private hintClock = 0; // seconds left on the transient "badge requis" hint — the overlay reads it

  constructor(private readonly hooks: PickupRuntimeHooks) {}

  /** Seconds left on the green pickup flash — the overlay painter's `drawPickupFx` reads this each frame. */
  public get pickupFx(): number {
    return this.flash;
  }

  /** Seconds left on the transient objective hint — the overlay painter's `drawHint` reads this each frame. */
  public get hint(): number {
    return this.hintClock;
  }

  /** Fade the green pickup flash. Runs every frame — including while dead / won / mid-transition — exactly as
   *  the monolithic `advance` faded it at its top, before the end-state early-returns. */
  public decayFx(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
  }

  /** Spin + collect every floor pickup the player overlaps: coffee/RAM refill health/armour (capped at the
   *  player ceiling), a box tops up its OWN ammo type's reserve (capped, KEPT if already full), and a weapon
   *  pickup unlocks its weapon (see {@link collectWeapon}). Each list is mutated in place on the zone world. */
  public stepPickups(dt: number): void {
    this.collectVitals(dt);
    this.collectAmmoBoxes(dt);
    this.collectWeaponPickups(dt);
  }

  /** The level objective: spin + collect each access badge on proximity (→ the HUD card bay + this runtime's
   *  badge set; each unlocks its colour-matched DOOR), walk into a graph exit to fade to the next floor (the
   *  arrival side stays LOCKED until the player has left every exit radius — no instant bounce-back), and win
   *  on reaching the legacy single exit (levels outside the graph). */
  public stepObjective(dt: number): void {
    const zone = this.hooks.zone;
    const world = zone.world;
    const camera = this.hooks.camera;

    this.hintClock = Math.max(0, this.hintClock - dt);
    world.keycards = world.keycards.filter((k) => {
      k.age += dt; // advance the badge turntable spin whether or not it is collected
      if (Math.hypot(k.x - camera.x, k.y - camera.y) >= PICKUP_RADIUS) {
        return true; // out of reach — keep it
      }
      this.badges.add(k.spec.color);
      this.hooks.hud.addCard(k.spec.color); // light its card in the HUD bay
      this.flash = PICKUP_FX_DURATION;

      return false; // collected — drop it
    });
    if (zone.transition === null) {
      const inside = zone.exits.find(
        (e) => Math.hypot(e.x - camera.x, e.y - camera.y) < EXIT_RADIUS,
      );

      if (zone.exitsLocked) {
        zone.exitsLocked = inside !== undefined;
      } else if (inside !== undefined) {
        zone.beginTransition(inside.to, inside.entry);
        this.hooks.combat.endFire();
      }
    }
    if (
      world.exit !== null &&
      Math.hypot(world.exit.x - camera.x, world.exit.y - camera.y) < EXIT_RADIUS
    ) {
      this.hooks.combat.win();
    }
  }

  /** Drive each door's animation: a player in trigger range (holding the badge, for a locked door) opens it; a
   *  locked door with no badge just flashes the "badge requis" hint. Once open it stays open (a permanent unlock);
   *  the runtime then stamps every door's ceilZ back into the live sectors the renderer + physics read. */
  public stepDoors(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    for (const door of world.doors) {
      const near =
        Math.hypot(door.triggerX - camera.x, door.triggerY - camera.y) < DOOR_TRIGGER_RADIUS;
      const mayOpen = door.requiresCard === null || this.badges.has(door.requiresCard);

      door.openness = stepDoorOpenness(door.openness, dt, near, mayOpen);
      if (near && !mayOpen && door.openness === 0) {
        this.hintClock = HINT_DURATION; // locked — the badge is needed
      }
    }
    this.hooks.zone.applyDoors(world.doors, world.sectors);
  }

  /** Sliding glass doors: proximity-driven + AUTO-CLOSING (a real automatic door). Each animates toward open
   *  when the player is within range and back toward shut when they leave; the world's `slides` feed render +
   *  physics the same frame. */
  public stepSliding(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    for (const s of this.hooks.zone.slidingDoors) {
      const near = Math.hypot(s.mx - camera.x, s.my - camera.y) < SLIDE_TRIGGER_RADIUS;

      world.slides[s.line] = stepSlideOpenness(world.slides[s.line], dt, near);
    }
  }

  /** Restart the objective half of a NEW GAME: drop every collected badge, clear the HUD card bay, and reset
   *  the collect-feedback timers. The component pairs this with the combat + zone resets. */
  public reset(): void {
    this.badges.clear();
    this.hintClock = 0;
    this.hooks.hud.clearCards();
    this.flash = 0;
  }

  /** Spin + collect vitals: coffee (health) / RAM (armour) top the matching pool up, capped by the grant API. */
  private collectVitals(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    world.vitals = world.vitals.filter((v) => {
      v.age += dt; // advance the turntable spin whether or not it is collected
      if (Math.hypot(v.x - camera.x, v.y - camera.y) >= PICKUP_RADIUS) {
        return true; // out of reach — keep it
      }
      if (v.spec.kind === 'health') {
        this.hooks.combat.heal(v.spec.amount);
      } else {
        this.hooks.combat.addArmor(v.spec.amount);
      }
      this.flash = PICKUP_FX_DURATION;

      return false; // collected — drop it
    });
  }

  /** Spin + collect ammo boxes: a box tops up its OWN ammo type's reserve (capped), and is KEPT if that type
   *  is already full. `INSPECT_PICKUPS` holds every box (spinning) for close art inspection. */
  private collectAmmoBoxes(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    world.ammoBoxes = world.ammoBoxes.filter((b) => {
      b.age += dt; // advance its spin clock whether or not it is collected

      if (INSPECT_PICKUPS) {
        return true; // TEMP: keep every box (spinning) so the ammo art can be inspected up close
      }
      const reserve = this.hooks.combat.reserveOf(b.spec.ammoType);

      if (Math.hypot(b.x - camera.x, b.y - camera.y) >= PICKUP_RADIUS || reserve >= b.spec.max) {
        return true; // out of reach, or this type is already full → keep the box
      }
      this.hooks.combat.addAmmo(b.spec.ammoType, b.spec.amount, b.spec.max);
      this.flash = PICKUP_FX_DURATION;

      return false; // collected — drop it
    });
  }

  /** Spin + collect weapon pickups: always collectible — a repeat pickup is still an ammo top-up. */
  private collectWeaponPickups(dt: number): void {
    const world = this.hooks.zone.world;
    const camera = this.hooks.camera;

    world.weaponPickups = world.weaponPickups.filter((p) => {
      p.age += dt; // advance its (future) turntable spin whether or not it is collected
      if (Math.hypot(p.x - camera.x, p.y - camera.y) >= PICKUP_RADIUS) {
        return true; // out of reach — keep it
      }
      this.collectWeapon(p.spec); // always collectible — a repeat pickup is still an ammo top-up

      return false; // collected — drop it
    });
  }

  /** Unlock a collected weapon (the DOOM progression): own it for the rest of the run, grant its starter ammo
   *  dose (ONE standard box of its type — {@link weaponAmmoDose} — capped at the reserve max), and AUTO-EQUIP it
   *  when it is a FIRST pickup into a strictly better arsenal position (finding a pistol while holding the
   *  shotgun never downgrades; a repeat pickup only tops the reserve up). */
  private collectWeapon(spec: WeaponPickupSpec): void {
    const index = ARSENAL.findIndex((weapon) => weapon.id === spec.id);
    const alreadyOwned = this.hooks.combat.owns(spec.id);

    this.hooks.combat.grantWeapon(spec.id);
    const dose = weaponAmmoDose(spec.ammoType);

    if (spec.ammoType !== null && dose > 0) {
      this.hooks.combat.addAmmo(spec.ammoType, dose, ammoTypeMax(spec.ammoType));
    }
    if (shouldAutoEquip(alreadyOwned)) {
      this.hooks.combat.selectWeapon(index);
    }
    this.flash = PICKUP_FX_DURATION;
  }
}
