import { clampPitch } from '../../../core/lib/bsp-engine';
import {
  movementDelta,
  MOUSE_SENS,
  PITCH_DOWN_MAX,
  PITCH_UP_MAX,
  RESTART_DELAY,
  type MovementDelta,
} from '../../../core/lib';
import type { MutableCamera } from '../world/zone-runtime';

const CONTROLS = new Set([
  'w',
  'z',
  'arrowup',
  's',
  'arrowdown',
  'a',
  'q',
  'arrowleft',
  'd',
  'arrowright',
]);

const WINDOWED_RENDER = { width: 1280, height: 720 } as const;
const FULLSCREEN_RENDER = { width: 1920, height: 1080 } as const;

export interface InputCombat {
  readonly dead: boolean;
  readonly won: boolean;
  readonly deadClock: number;
  readonly wonClock: number;
  hurtPlayer(amount: number): void;
  heal(amount: number): void;
  selectWeapon(index: number): void;
  reload(): void;
  toggleStress(): void;
  beginFire(): void;
  endFire(): void;
  cycleWeapon(direction: number): void;
}

export interface InputControllerHooks {
  /** The shared player camera — mouse look writes `angle` / `pitch` in place (by reference, no copy). */
  readonly camera: MutableCamera;
  readonly combat: InputCombat;
  /** Read live by the owner check + the click's lock request — no copy. */
  canvas(): HTMLCanvasElement;
  /** True while an auto-mantle hoist owns the body — look is frozen so the vault always clears the lip. */
  isMantling(): boolean;
  restart(): void;
  toggleFullscreen(): void;
  queueResolution(width: number, height: number): void;
}

/**
 * The INPUT boundary: held-keys set + every DOM input handler + the derived movement axes. The handlers are
 * stored as stable BOUND references so the component can remove the EXACT same references on teardown — an
 * identity mismatch would leak the listeners (the CLAUDE.md leak/SSR gotcha). Mutates shared state by
 * reference: the camera on look, the combat runtime's edges on fire/reload/weapon, the held set the axes read.
 */
export class InputController {
  public readonly held = new Set<string>();

  constructor(private readonly hooks: InputControllerHooks) {}

  public readonly onDown = (event: KeyboardEvent): void => this.onKey(event, true);

  public readonly onUp = (event: KeyboardEvent): void => this.onKey(event, false);

  public readonly onClick = (): void => {
    const combat = this.hooks.combat;

    if (combat.dead || combat.won) {
      if ((combat.dead ? combat.deadClock : combat.wonClock) >= RESTART_DELAY) {
        this.hooks.restart();
      }

      return;
    }
    // requestPointerLock can reject with SecurityError when re-locked too soon after Escape (browser
    // rate-limit) — harmless (the next click locks), so swallow it.
    Promise.resolve(this.hooks.canvas().requestPointerLock()).catch(() => undefined);
  };

  public readonly onMouse = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.hooks.canvas() || this.hooks.isMantling()) {
      return; // look is frozen mid-mantle so the vault always clears the lip
    }
    this.hooks.camera.angle -= event.movementX * MOUSE_SENS;
    this.hooks.camera.pitch = clampPitch(
      this.hooks.camera.pitch - event.movementY * MOUSE_SENS,
      PITCH_DOWN_MAX,
      PITCH_UP_MAX,
    );
  };

  public readonly onMousedown = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.hooks.canvas()) {
      return;
    }
    if (event.button === 2 || event.ctrlKey) {
      event.preventDefault();
      this.hooks.combat.reload();

      return;
    }
    if (event.button === 0) {
      this.hooks.combat.beginFire();
    }
  };

  public readonly onMouseup = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.hooks.combat.endFire();
    }
  };

  public readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  public readonly onWheel = (event: WheelEvent): void => {
    if (document.pointerLockElement !== this.hooks.canvas()) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const direction = Math.sign(event.deltaY);

    if (direction !== 0) {
      this.hooks.combat.cycleWeapon(direction);
    }
  };

  public readonly onResize = (): void => {
    const tier = document.fullscreenElement !== null ? FULLSCREEN_RENDER : WINDOWED_RENDER;

    this.hooks.queueResolution(tier.width, tier.height);
  };

  /** `forward` (+1 ahead / −1 back) and `strafe` (+1 right / −1 left) from the held keys; turning is mouse-only. */
  public movementAxes(): { forward: number; strafe: number } {
    const held = this.held;
    const forward =
      (held.has('w') || held.has('z') || held.has('arrowup') ? 1 : 0) -
      (held.has('s') || held.has('arrowdown') ? 1 : 0);
    const strafe =
      (held.has('d') || held.has('arrowright') ? 1 : 0) -
      (held.has('a') || held.has('q') || held.has('arrowleft') ? 1 : 0);

    return { forward, strafe };
  }

  public movementWant(
    angle: number,
    forward: number,
    strafe: number,
    reach: number,
  ): MovementDelta {
    return movementDelta(angle, forward, strafe, reach);
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    const key = event.key.toLowerCase();

    if (down && this.routeActionKey(key)) {
      event.preventDefault();

      return;
    }
    if (!CONTROLS.has(key)) {
      return;
    }

    if (down) {
      this.held.add(key);
    } else {
      this.held.delete(key);
    }
    event.preventDefault();
  }

  private routeActionKey(key: string): boolean {
    if (key === 'h') {
      this.hooks.combat.hurtPlayer(15); // DEBUG

      return true;
    }
    if (key === 'j') {
      this.hooks.combat.heal(15); // DEBUG

      return true;
    }
    if (key === 'f') {
      this.hooks.toggleFullscreen();

      return true;
    }
    if (key >= '1' && key <= '8') {
      this.hooks.combat.selectWeapon(Number(key) - 1);

      return true;
    }
    if (key === 'r') {
      this.hooks.combat.reload();

      return true;
    }
    if (key === 'g') {
      this.hooks.combat.toggleStress(); // DEBUG: stress load

      return true;
    }

    return false;
  }
}
