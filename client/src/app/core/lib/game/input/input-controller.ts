import { movementDelta, type MovementDelta } from '../controls';
import {
  JOYSTICK_DEADZONE,
  JOYSTICK_RADIUS,
  MOUSE_SENS,
  RESTART_DELAY,
  TOUCH_LOOK_SENS,
} from '../game-tuning';
import type { MutableCamera } from '../world/zone-runtime';
import { joystickAxes } from './joystick';
import { applyLook } from './look';

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

/** The floating-joystick render state — canvas-local px so the component draws it absolute over the viewport. */
export interface JoystickView {
  readonly baseX: number;
  readonly baseY: number;
  readonly thumbDx: number;
  readonly thumbDy: number;
}

export interface InputControllerHooks {
  /** The shared player camera — mouse look writes `angle` / `pitch` in place (by reference, no copy). */
  readonly camera: MutableCamera;
  readonly combat: InputCombat;
  /** Read live by the owner check + the click's lock request + touch left/right split — no copy. */
  canvas(): HTMLCanvasElement;
  /** True while an auto-mantle hoist owns the body — look is frozen so the vault always clears the lip. */
  isMantling(): boolean;
  restart(): void;
  toggleFullscreen(): void;
  queueResolution(width: number, height: number): void;
  /** Left-thumb joystick moved (a view) or released (null) — the component mirrors it into a signal. */
  onJoystick(view: JoystickView | null): void;
}

/**
 * The INPUT boundary: held-keys set + every DOM input handler + the derived movement axes. The handlers are
 * stored as stable BOUND references so the component can remove the EXACT same references on teardown — an
 * identity mismatch would leak the listeners (the CLAUDE.md leak/SSR gotcha). Mutates shared state by
 * reference: the camera on look, the combat runtime's edges on fire/reload/weapon, the held set the axes read.
 */
export class InputController {
  public readonly held = new Set<string>();

  // Twin-stick touch state, routed by `Touch.identifier` so a move-thumb + look-thumb (+ fire) coexist.
  private moveTouchId: number | null = null;
  private moveOriginX = 0; // client px — the delta origin for the joystick vector
  private moveOriginY = 0;
  private moveBaseX = 0; // canvas-local px — where the joystick base is drawn
  private moveBaseY = 0;
  private touchAxes: { forward: number; strafe: number } = { forward: 0, strafe: 0 };
  private lookTouchId: number | null = null;
  private lookLastX = 0; // client px — previous sample, so drags feed relative deltas like the mouse
  private lookLastY = 0;

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
    this.look(event.movementX, event.movementY, MOUSE_SENS);
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

  // Twin-stick start (canvas only, so the fixed buttons keep their own touches): left canvas half = the
  // floating move joystick, right half = the look drag, routed per `identifier`. On the dead/won screen a
  // tap past the settle delay restarts instead (the synthetic click is suppressed by preventDefault).
  public readonly onTouchStart = (event: TouchEvent): void => {
    event.preventDefault();
    const combat = this.hooks.combat;

    if (combat.dead || combat.won) {
      if ((combat.dead ? combat.deadClock : combat.wonClock) >= RESTART_DELAY) {
        this.hooks.restart();
      }

      return;
    }
    const rect = this.hooks.canvas().getBoundingClientRect();

    for (const touch of Array.from(event.changedTouches)) {
      const localX = touch.clientX - rect.left;

      if (localX < rect.width / 2 && this.moveTouchId === null) {
        this.moveTouchId = touch.identifier;
        this.moveOriginX = touch.clientX;
        this.moveOriginY = touch.clientY;
        this.moveBaseX = localX;
        this.moveBaseY = touch.clientY - rect.top;
        this.touchAxes = { forward: 0, strafe: 0 };
        this.emitJoystick(0, 0);
      } else if (localX >= rect.width / 2 && this.lookTouchId === null) {
        this.lookTouchId = touch.identifier;
        this.lookLastX = touch.clientX;
        this.lookLastY = touch.clientY;
      }
    }
  };

  public readonly onTouchMove = (event: TouchEvent): void => {
    event.preventDefault();

    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.moveTouchId) {
        const dx = touch.clientX - this.moveOriginX;
        const dy = touch.clientY - this.moveOriginY;

        this.touchAxes = joystickAxes(dx, dy, JOYSTICK_RADIUS, JOYSTICK_DEADZONE);
        this.emitJoystick(dx, dy);
      } else if (touch.identifier === this.lookTouchId) {
        const dx = touch.clientX - this.lookLastX;
        const dy = touch.clientY - this.lookLastY;

        this.lookLastX = touch.clientX;
        this.lookLastY = touch.clientY;
        // drop the delta mid-mantle (the last sample still advances, so no jump when the hoist ends)
        if (!this.hooks.isMantling()) {
          this.look(dx, dy, TOUCH_LOOK_SENS);
        }
      }
    }
  };

  // Bound to both `touchend` and `touchcancel` — a lifted / cancelled thumb releases its stick.
  public readonly onTouchEnd = (event: TouchEvent): void => {
    event.preventDefault();

    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.moveTouchId) {
        this.moveTouchId = null;
        this.touchAxes = { forward: 0, strafe: 0 };
        this.hooks.onJoystick(null);
      } else if (touch.identifier === this.lookTouchId) {
        this.lookTouchId = null;
      }
    }
  };

  public readonly onFireDown = (event: Event): void => {
    event.preventDefault();
    this.hooks.combat.beginFire();
  };

  public readonly onFireUp = (event: Event): void => {
    event.preventDefault();
    this.hooks.combat.endFire();
  };

  public readonly onWeaponButton = (event: Event): void => {
    event.preventDefault();
    this.hooks.combat.cycleWeapon(1);
  };

  /** Live analog touch axes while a move-thumb is down; otherwise the held-key axes (turning is look-only). */
  public movementAxes(): { forward: number; strafe: number } {
    if (this.moveTouchId !== null) {
      return this.touchAxes;
    }
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

  // Shared look math for the mouse + touch paths — turns the shared camera in place by a screen-space delta.
  private look(dx: number, dy: number, sens: number): void {
    const next = applyLook(this.hooks.camera.angle, this.hooks.camera.pitch, dx, dy, sens);

    this.hooks.camera.angle = next.angle;
    this.hooks.camera.pitch = next.pitch;
  }

  // Publish the joystick view in canvas-local px: the fixed base + the thumb offset clamped to the ring.
  private emitJoystick(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy);
    const scale = dist > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / dist : 1;

    this.hooks.onJoystick({
      baseX: this.moveBaseX,
      baseY: this.moveBaseY,
      thumbDx: dx * scale,
      thumbDy: dy * scale,
    });
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
