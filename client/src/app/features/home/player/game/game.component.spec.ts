import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameComponent } from './game.component';
import { GameAudio } from './game-audio';
import { GameInput } from './game-input';
import type { GameState, MoveIntent } from '../../../../core/lib';

describe('GameComponent', () => {
  let fixture: ComponentFixture<GameComponent>;

  beforeEach(async () => {
    // jsdom has no real RAF/canvas rendering — stub RAF so the loop schedules without drawing.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    await TestBed.configureTestingModule({ imports: [GameComponent] }).compileComponents();
    fixture = TestBed.createComponent(GameComponent);
  });

  it('mounts and renders a canvas + exit button', async () => {
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('canvas.game__canvas')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.game__exit')).not.toBeNull();
  });

  it('keydown updates input without throwing', async () => {
    await fixture.whenStable();

    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))).not.toThrow();
  });

  it('replaces the DOM status bar with a single responsive HUD canvas', async () => {
    await fixture.whenStable();
    const hud = fixture.nativeElement.querySelector('canvas.game__hud') as HTMLCanvasElement | null;

    // The backing store is now sized dynamically to the displayed pixel size (DPR-aware), so the canvas
    // carries no fixed width/height attribute — just assert the single HUD canvas exists.
    expect(hud).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.game__statusbar')).toBeNull(); // old DOM bar is gone
  });

  it('blocks iOS pinch-zoom by preventing the gesturestart event', async () => {
    await fixture.whenStable();
    const gesture = new Event('gesturestart', { cancelable: true });

    document.dispatchEvent(gesture);

    expect(gesture.defaultPrevented).toBe(true);
  });

  it('drops a held trigger when pointer-lock exits (no mouseup fires) so auto-fire cannot stick', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as { input: GameInput };

    instance.input.fireDown();
    expect(instance.input.firing()).toBe(true); // trigger held → an auto weapon bursts

    document.dispatchEvent(new Event('pointerlockchange')); // lock forced out with the button still down

    expect(instance.input.firing()).toBe(false); // the hold is dropped — no runaway auto-fire
  });

  it('saws continuously while held — the mag-less chainsaw auto-fires + grinds with no magazine', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      selectWeapon(slot: number): void;
      input: GameInput;
      audio: GameAudio;
      weaponUsesMag: () => boolean;
      stepAutoFire(intent: MoveIntent, dt: number): void;
      sawClock: number;
      state: GameState;
    };

    instance.selectWeapon(2); // → the chainsaw (auto, mag-less melee)
    expect(instance.weaponUsesMag()).toBe(false);

    const sawSpy = vi.spyOn(instance.audio, 'playSaw');

    instance.input.fireDown(); // hold the trigger
    const intent = instance.input.intent();

    instance.stepAutoFire(intent, 0.2); // one big step past the 0.11s cooldown → a grind tick

    expect(intent.fire).toBe(true); // a mag-less melee always fires while held (no `mag > 0` gate)
    expect(sawSpy).toHaveBeenCalled(); // the grind buzz, paced off the saw clock (no mag delta to read)

    instance.input.fireUp(); // release → the saw stops and its clock resets
    const idle = instance.input.intent();

    instance.stepAutoFire(idle, 0.05);

    expect(idle.fire).toBe(false);
    expect(instance.sawClock).toBe(0);
  });

  it('opens a keycard door on proximity (with the badge), freezes during the animation, then clears the seam', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      liveCells: number[];
      liveMap: { width: number };
      state: GameState;
      doorAnim: { cells: number[]; progress: number; colorIndex: number } | null;
      startDoorIfFacing(): void;
      advanceDoorAnim(dt: number): void;
    };

    // Put a RED locked door (cell 10 = DOOR_BASE + 0) one step ahead of the spawn (1.5,1.5 facing +x → cell 2,1).
    const doorIdx = 1 * instance.liveMap.width + 2;

    instance.liveCells[doorIdx] = 10;
    instance.state = { ...instance.state, pose: { x: 1.5, y: 1.5, dir: 0 }, heldKeys: 0 };

    instance.startDoorIfFacing();
    expect(instance.doorAnim).toBeNull(); // facing it WITHOUT the red badge → stays locked

    instance.state = { ...instance.state, heldKeys: 0b001 }; // pick up the red keycard (KEYCARD_COLORS index 0)
    instance.startDoorIfFacing();
    expect(instance.doorAnim?.colorIndex).toBe(0); // proximity + badge → the red door starts opening

    const pose = instance.state.pose;

    instance.advanceDoorAnim(0.15); // mid-animation (< 0.3 s): still frozen, seam still solid
    expect(instance.doorAnim).not.toBeNull();
    expect(instance.state.pose.x).toBeCloseTo(pose.x, 5); // player FROZEN — no movement while the door opens
    expect(instance.liveCells[doorIdx]).toBe(10); // door still solid mid-open

    instance.advanceDoorAnim(0.2); // crosses the 0.3 s total → completes
    expect(instance.doorAnim).toBeNull(); // control returns
    expect(instance.liveCells[doorIdx]).toBe(0); // the seam is now open floor — passable
  });

  it('runs the zone-exit airlock transition on proximity: freeze → fade out → next level → fade in → control', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      liveCells: number[];
      liveMap: { width: number };
      state: GameState;
      exitFade: { phase: 'out' | 'in'; progress: number } | null;
      startExitIfFacing(): void;
      advanceExitFade(dt: number): void;
    };

    // Put the EXIT_SWITCH (cell 9) one step ahead of the spawn (1.5,1.5 facing +x → cell 2,1).
    const exitIdx = 1 * instance.liveMap.width + 2;

    instance.liveCells[exitIdx] = 9;
    instance.state = { ...instance.state, pose: { x: 1.5, y: 1.5, dir: 0 } };

    instance.startExitIfFacing();
    expect(instance.exitFade?.phase).toBe('out'); // proximity → the airlock opens + the screen fades to black

    const pose = instance.state.pose;

    instance.advanceExitFade(0.2); // mid fade-out: still frozen
    expect(instance.state.pose.x).toBeCloseTo(pose.x, 5); // player FROZEN during the transition
    expect(instance.exitFade?.phase).toBe('out');

    instance.advanceExitFade(0.5); // crosses the 0.55 s fade-out → loads the next level, flips to fade-in
    expect(instance.exitFade?.phase).toBe('in');

    instance.advanceExitFade(0.5); // crosses the 0.45 s fade-in → control returns on the new zone
    expect(instance.exitFade).toBeNull();
  });

  it('switchWeapon cycles the active arsenal weapon, rebuilding its view + combat', async () => {
    const switchSfx = vi.spyOn(GameAudio.prototype, 'playMelee');

    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      activeWeapon: number;
      weaponView: object;
      combat: { damage: number };
      switchWeapon(): void;
    };

    expect(instance.activeWeapon).toBe(0); // spawns on the fist (ARSENAL[0])
    const firstView = instance.weaponView;
    const firstCombat = instance.combat;

    instance.switchWeapon();

    expect(instance.activeWeapon).toBe(1); // advanced to the chainsaw
    expect(instance.weaponView).not.toBe(firstView); // a fresh viewmodel for the new weapon's strip + icon
    expect(instance.combat).not.toBe(firstCombat);
    expect(instance.combat.damage).toBe(16); // the chainsaw's per-tick combat numbers are now active
    expect(switchSfx).toHaveBeenCalledTimes(1); // the swap blip

    instance.switchWeapon();
    expect(instance.activeWeapon).toBe(2); // advanced to the pistol (the third arsenal weapon)
    expect(instance.combat.damage).toBe(18); // the pistol's combat numbers are now active

    instance.switchWeapon();
    expect(instance.activeWeapon).toBe(3); // advanced to the shotgun (the fourth arsenal weapon)
    expect(instance.combat.damage).toBe(9); // the shotgun's combat numbers are now active

    instance.switchWeapon();
    expect(instance.activeWeapon).toBe(4); // advanced to the chaingun (the fifth arsenal weapon)
    expect(instance.combat.damage).toBe(11); // the chaingun's combat numbers are now active

    instance.switchWeapon();
    expect(instance.activeWeapon).toBe(5); // advanced to the lithium launcher (the sixth arsenal weapon)
    expect(instance.combat.damage).toBe(55); // the rocket's direct-hit damage is now active

    instance.switchWeapon();
    expect(instance.activeWeapon).toBe(6); // advanced to the plasma cable (the seventh arsenal weapon)
    expect(instance.combat.damage).toBe(16); // the plasma's direct-hit damage is now active

    instance.switchWeapon();
    expect(instance.activeWeapon).toBe(7); // advanced to the datacenter BFG (the eighth arsenal weapon)
    expect(instance.combat.damage).toBe(450); // the BFG's direct-hit damage is now active

    instance.switchWeapon();
    expect(instance.activeWeapon).toBe(0); // wraps back to the fist after all eight
    expect(instance.combat.damage).toBe(35);
  });

  it('selectWeapon jumps directly to an arted weapon by its 1-based number, ignoring an empty slot', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      activeWeapon: number;
      combat: { damage: number };
      selectWeapon(slot: number): void;
    };

    expect(instance.activeWeapon).toBe(0); // spawns on the fist

    instance.selectWeapon(3); // → the pistol directly (no cycling through the chainsaw)
    expect(instance.activeWeapon).toBe(2);
    expect(instance.combat.damage).toBe(18);

    instance.selectWeapon(8); // → the datacenter BFG directly (the eighth, last arted weapon)
    expect(instance.activeWeapon).toBe(7);
    expect(instance.combat.damage).toBe(450);

    instance.selectWeapon(1); // → back to the fist
    expect(instance.activeWeapon).toBe(0);
    expect(instance.combat.damage).toBe(35);

    instance.selectWeapon(9); // no arted weapon at number 9 → ignored (the roster ends at 8)
    expect(instance.activeWeapon).toBe(0);
  });

  it('refuses to switch weapons mid-swing (a swing always finishes on its own weapon)', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      activeWeapon: number;
      weaponView: { tryTrigger(): boolean; swinging(): boolean };
      switchWeapon(): void;
    };

    expect(instance.weaponView.tryTrigger()).toBe(true); // start a swing → mid-animation
    expect(instance.weaponView.swinging()).toBe(true);
    const midSwingView = instance.weaponView;

    instance.switchWeapon();

    expect(instance.activeWeapon).toBe(0); // unchanged — the switch was refused
    expect(instance.weaponView).toBe(midSwingView); // same viewmodel kept (no rebuild)
  });

  it('plays the matching combat SFX when kills/hits rise on a frame', async () => {
    const killSpy = vi.spyOn(GameAudio.prototype, 'playKill');
    const hitSpy = vi.spyOn(GameAudio.prototype, 'playHit');

    await fixture.whenStable();
    // The rAF loop is stubbed, so drive the delta-based SFX hook directly off a one-frame increment.
    const instance = fixture.componentInstance as unknown as {
      state: GameState;
      playCombatSfx(): void;
    };

    instance.state.kills += 1;
    instance.state.hits += 1;
    instance.playCombatSfx();

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(hitSpy).toHaveBeenCalledTimes(1);
  });

  it('queues a reload on the R key and consumes it edge-triggered (one-shot)', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as { input: GameInput };

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));

    expect(instance.input.consumeReload()).toBe(true); // queued by the fresh press
    expect(instance.input.consumeReload()).toBe(false); // edge — only consumed once
  });

  it('seeds the magazine from the ACTIVE weapon — 0 on spawn (the fist is melee)', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as { state: GameState };

    expect(instance.state.mag).toBe(0); // spawns on the fist (no magazine)
    expect(instance.state.reloadClock).toBe(0); // not reloading on spawn
  });

  it('switching to the pistol turns on magazine mode and activates its combat', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      weaponUsesMag: () => boolean;
      switchWeapon(): void;
      state: GameState;
      combat: { magSize: number; reloadTime: number };
    };

    expect(instance.weaponUsesMag()).toBe(false); // spawns on the fist (melee)
    instance.switchWeapon(); // → chainsaw (melee)
    expect(instance.weaponUsesMag()).toBe(false);

    instance.switchWeapon(); // → pistol (magazine)
    expect(instance.weaponUsesMag()).toBe(true);
    expect(instance.combat.magSize).toBe(24); // the pistol's combat is now active
    expect(instance.combat.reloadTime).toBeCloseTo(1.1, 5);
    expect(instance.state.mag).toBe(24); // the magazine, seeded loaded, persisted across the switches
  });

  it('cancels an in-progress reload when switching weapons', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      state: GameState;
      switchWeapon(): void;
    };

    instance.state = { ...instance.state, reloadClock: 0.9 }; // pretend a reload is mid-flight

    instance.switchWeapon();

    expect(instance.state.reloadClock).toBe(0); // the swap abandons the reload
  });

  it('selectWeapon(4) reaches the shotgun with its own full magazine', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      activeWeapon: number;
      weaponUsesMag: () => boolean;
      combat: { magSize: number; pellets: number; selfKnockback: number };
      selectWeapon(slot: number): void;
      state: GameState;
    };

    instance.selectWeapon(4); // → the fourth arted weapon

    expect(instance.activeWeapon).toBe(3);
    expect(instance.weaponUsesMag()).toBe(true);
    expect(instance.combat.magSize).toBe(6); // the shotgun's magazine
    expect(instance.combat.pellets).toBe(9); // a shotgun blast
    expect(instance.combat.selfKnockback).toBeCloseTo(0.4, 5); // the CO2 recoil
    expect(instance.state.mag).toBe(6); // its own mag, seeded full on the first selection
  });

  it('keeps a separate magazine per weapon across switches (no two-mag-weapon clash)', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      selectWeapon(slot: number): void;
      state: GameState;
    };

    instance.selectWeapon(3); // → the pistol, first selection loads a full mag
    expect(instance.state.mag).toBe(24);

    instance.state = { ...instance.state, mag: 20 }; // pretend it fired four staples

    instance.selectWeapon(4); // → the shotgun: its OWN full mag of 6, NOT the pistol's 20
    expect(instance.state.mag).toBe(6);

    instance.selectWeapon(3); // → back to the pistol: its own stashed count (20), not a fresh 24
    expect(instance.state.mag).toBe(20);
  });

  it('refills every weapon’s magazine to full on respawn', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      selectWeapon(slot: number): void;
      respawnRun(): void;
      state: GameState;
    };

    instance.selectWeapon(3); // → pistol
    instance.state = { ...instance.state, mag: 5 }; // run it down
    instance.selectWeapon(4); // → shotgun (stashes the pistol's depleted 5)
    instance.state = { ...instance.state, mag: 1 }; // run it down too

    instance.respawnRun(); // death → whole-run reset

    expect(instance.state.mag).toBe(6); // the active weapon (shotgun) re-seeded to a full mag
    instance.selectWeapon(3); // → pistol: its stashed depletion was cleared → full again
    expect(instance.state.mag).toBe(24);
  });

  it('selecting the chaingun (number 5) turns on auto-fire and activates its chaingun combat', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      autoFire: boolean;
      activeWeapon: number;
      weaponUsesMag: () => boolean;
      combat: { damage: number; fireCooldown: number; magSize: number };
      selectWeapon(slot: number): void;
      state: GameState;
    };

    expect(instance.autoFire).toBe(false); // spawns on the fist (semi)

    instance.selectWeapon(5); // → the chaingun (the fifth arted weapon)

    expect(instance.activeWeapon).toBe(4);
    expect(instance.autoFire).toBe(true); // held-trigger burst mode is on
    expect(instance.weaponUsesMag()).toBe(true);
    expect(instance.combat.damage).toBe(11);
    expect(instance.combat.fireCooldown).toBeCloseTo(0.07, 5);
    expect(instance.combat.magSize).toBe(80);
    expect(instance.state.mag).toBe(80); // its own full magazine on first selection
  });

  it('auto-fires continuously while the trigger is held — draining the chaingun magazine over frames', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      input: GameInput;
      state: GameState;
      selectWeapon(slot: number): void;
      stepAutoFire(intent: MoveIntent, deltaTime: number): void;
    };

    instance.selectWeapon(5); // chaingun: mag 80, fireCooldown 0.07
    const startMag = instance.state.mag;

    instance.input.fireDown(); // hold the trigger down (never released)

    // Drive several frames at ~the fire cadence: each cleared cooldown spends one nail while held.
    for (let frame = 0; frame < 5; frame++) {
      instance.stepAutoFire(instance.input.intent(), 0.07);
    }

    expect(instance.state.mag).toBeLessThan(startMag); // the held trigger kept firing across frames
    expect(startMag - instance.state.mag).toBeGreaterThanOrEqual(4); // ~one nail per 0.07 s frame

    // Release the trigger → the next frame fires nothing (the burst stops).
    instance.input.fireUp();
    const magAfterRelease = instance.state.mag;

    instance.stepAutoFire(instance.input.intent(), 0.07);
    expect(instance.state.mag).toBe(magAfterRelease); // no shot once the trigger is up
  });

  it('selecting the plasma cable (number 7) turns on auto-fire with a chaining projectile spec', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      autoFire: boolean;
      activeWeapon: number;
      combat: {
        projectile: { chain: { targets: number; range: number; falloff: number } | null } | null;
      };
      selectWeapon(slot: number): void;
    };

    instance.selectWeapon(7); // → the plasma cable (the seventh arted weapon)

    expect(instance.activeWeapon).toBe(6);
    expect(instance.autoFire).toBe(true); // a held-trigger stream, like the chaingun
    expect(instance.combat.projectile?.chain).toEqual({ targets: 4, range: 4, falloff: 0.75 });
  });

  it('selecting the datacenter BFG (number 8) turns on charge-fire and activates its big-AOE combat', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      chargeFire: boolean;
      autoFire: boolean;
      activeWeapon: number;
      weaponUsesMag: () => boolean;
      combat: {
        ammoPerShot: number;
        magSize: number;
        projectile: { splashRadius: number; selfDamage: boolean } | null;
      };
      selectWeapon(slot: number): void;
      state: GameState;
    };

    instance.selectWeapon(8); // → the datacenter BFG (the eighth, ultimate arted weapon)

    expect(instance.activeWeapon).toBe(7);
    expect(instance.chargeFire).toBe(true); // the spin-up-then-discharge path is on
    expect(instance.autoFire).toBe(false); // NOT a held-trigger burst
    expect(instance.weaponUsesMag()).toBe(true);
    expect(instance.combat.ammoPerShot).toBe(40); // one shot drains the whole mag
    expect(instance.combat.magSize).toBe(40);
    expect(instance.combat.projectile?.splashRadius).toBeCloseTo(7.5, 5);
    expect(instance.combat.projectile?.selfDamage).toBe(true);
    expect(instance.state.mag).toBe(40); // its own full magazine on first selection
  });

  it('charges the BFG only with a full magazine, then the discharge drains the whole 40-round mag', async () => {
    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      input: GameInput;
      state: GameState;
      weaponView: { charging(): boolean };
      selectWeapon(slot: number): void;
      stepChargeFire(intent: MoveIntent, deltaTime: number): void;
    };

    instance.selectWeapon(8); // BFG: mag 40, chargeTime 0.7
    expect(instance.state.mag).toBe(40);

    instance.input.fireDown(); // press → starts the spin-up (full mag)
    instance.stepChargeFire(instance.input.intent(), 0.016);
    expect(instance.weaponView.charging()).toBe(true); // spinning up

    // Drive frames through the 0.7 s charge until the discharge fires (drains the mag in one shot).
    for (let frame = 0; frame < 60 && instance.state.mag === 40; frame++) {
      instance.stepChargeFire(instance.input.intent(), 0.05);
    }

    expect(instance.state.mag).toBe(0); // the discharge spent the WHOLE 40-round charge at once
    // The big shot is in the world — either a travelling projectile or its detonation impact.
    expect(instance.state.playerProjectiles.length + instance.state.impacts.length).toBeGreaterThan(
      0,
    );
  });

  it('does not start the BFG charge on a press with an insufficient magazine (a fail blip, no spin-up)', async () => {
    const failSfx = vi.spyOn(GameAudio.prototype, 'playHurt');

    await fixture.whenStable();
    const instance = fixture.componentInstance as unknown as {
      input: GameInput;
      state: GameState;
      weaponView: { charging(): boolean };
      selectWeapon(slot: number): void;
      stepChargeFire(intent: MoveIntent, deltaTime: number): void;
    };

    instance.selectWeapon(8); // BFG
    instance.state = { ...instance.state, mag: 39 }; // one short of a full 40-round charge

    instance.input.fireDown();
    instance.stepChargeFire(instance.input.intent(), 0.016);

    expect(instance.weaponView.charging()).toBe(false); // not enough rounds → no spin-up started
    expect(instance.state.mag).toBe(39); // the magazine is untouched
    expect(failSfx).toHaveBeenCalledTimes(1); // the empty-charge fail blip
  });
});
