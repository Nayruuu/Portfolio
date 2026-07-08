import { clampPitch } from '../../../core/lib/bsp-engine';
import { movementDelta, type MovementDelta } from '../../../core/lib';
import type { MutableCamera } from '../world/zone-runtime';

/** Keys we react to (lower-cased), covering both QWERTY (WASD) and AZERTY (ZQSD) + arrows. */
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

const MOUSE_SENS = 0.0035; // radians per pixel of mouse motion (turning is mouse-only)
const PITCH_UP_MAX = 0.85; // look-up limit (the camera pitch is a vertical y-shear, not a true rotation)
const PITCH_DOWN_MAX = 2.0; // look-DOWN limit — much deeper than up (aim down at enemies below a platform); the renderer handles the off-screen horizon, so this can exceed 1.0 (walls stay vertical, as in any sheared-frustum tilt)

/** Seconds after death/win before a click restarts (lets the end feedback settle). Exported: the game-over /
 *  win overlays gate their "click to restart" prompt on the same threshold. */
export const RESTART_DELAY = 1.2;
// Internal render resolution per display mode: 720p when the canvas is embedded in the ~960px viewport (a
// near-free quality match, ~2× cheaper), full 1080p when it fills the screen in fullscreen (native, no
// upscale blur). Each mode ALWAYS renders at 100% of its tier — sharpness is part of the product.
const WINDOWED_RENDER = { width: 1280, height: 720 } as const;
const FULLSCREEN_RENDER = { width: 1920, height: 1080 } as const;

/** The player-combat surface the input layer routes to — the exact edges a key / button / wheel drives, no
 *  more. {@link import('../world/combat-runtime').CombatRuntime} satisfies it structurally; the spec passes a
 *  spy object over the same shape. */
export interface InputCombat {
  /** Death latch — a click after {@link RESTART_DELAY} restarts instead of grabbing the pointer. */
  readonly dead: boolean;
  /** Level-complete latch — same click-to-restart branch as death. */
  readonly won: boolean;
  /** Seconds since death — the restart gate reads it against {@link RESTART_DELAY}. */
  readonly deadClock: number;
  /** Seconds since the win — the restart gate reads it against {@link RESTART_DELAY}. */
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

/** The between-subsystem seams the input controller needs but does NOT own: the SHARED player camera (mouse
 *  look turns it in place), the combat edge surface, the pointer-lock target canvas (owner check + lock
 *  request), the mantle freeze predicate (look is frozen mid-vault), and the three component-owned callbacks a
 *  key / click drives (restart, fullscreen toggle, render-resolution queue). */
export interface InputControllerHooks {
  /** The shared player camera — mouse look writes `angle` / `pitch` in place (by reference, no copy). */
  readonly camera: MutableCamera;
  /** The combat edges a key / mouse button / wheel routes to. */
  readonly combat: InputCombat;
  /** The pointer-lock target — the owner check for look/fire/wheel and the click's lock request read it live. */
  canvas(): HTMLCanvasElement;
  /** True while an auto-mantle hoist owns the body — look is frozen so the vault always clears the lip. */
  isMantling(): boolean;
  /** Restart the run — a click on the game-over / win screen after the settle delay. */
  restart(): void;
  /** Toggle viewport fullscreen (F key) — the component owns the Fullscreen API. */
  toggleFullscreen(): void;
  /** Queue a render-resolution switch (a resize / fullscreen change) — the host applies it between frames. */
  queueResolution(width: number, height: number): void;
}

/**
 * The INPUT boundary: it owns the held-keys set + every DOM input handler (keyboard movement + debug routing,
 * mouse look, fire / reload / weapon-cycle buttons, the wheel, the resize) and derives the movement axes the
 * component's `advance` integrates. The handlers are stored as stable BOUND references so the component can add
 * them to `window` / the canvas / `document` and remove the EXACT same references on teardown (an identity
 * mismatch would leak the listeners — the CLAUDE.md leak/SSR gotcha). It mutates shared state by reference: the
 * camera on look, the combat runtime's edges on fire / reload / weapon, and the held set the axes read.
 */
export class InputController {
  /** The pressed movement keys — mutated by the keyboard handlers, read every frame by {@link movementAxes}. */
  public readonly held = new Set<string>();

  constructor(private readonly hooks: InputControllerHooks) {}

  /** Key DOWN — a press: route the debug/action keys, else fold a movement key into the held set. */
  public readonly onDown = (event: KeyboardEvent): void => this.onKey(event, true);

  /** Key UP — a release: only the held movement keys care (they drop out of the set). */
  public readonly onUp = (event: KeyboardEvent): void => this.onKey(event, false);

  /** Canvas click: on the game-over / win screen (after the settle delay) it restarts; otherwise it grabs the
   *  pointer for mouse look. `requestPointerLock` can reject with a SecurityError when re-locked too soon after
   *  an Escape (a browser rate-limit) — harmless (the next click locks), so swallow it. */
  public readonly onClick = (): void => {
    const combat = this.hooks.combat;

    if (combat.dead || combat.won) {
      if ((combat.dead ? combat.deadClock : combat.wonClock) >= RESTART_DELAY) {
        this.hooks.restart();
      }

      return;
    }
    Promise.resolve(this.hooks.canvas().requestPointerLock()).catch(() => undefined);
  };

  /** Mouse motion: turn the camera (yaw from `movementX`, pitch from `movementY`) while pointer-locked and not
   *  mid-mantle. Writes the shared camera in place; pitch is clamped by the core {@link clampPitch}. */
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

  /** Mouse DOWN while locked: the secondary click (right button or macOS Ctrl+click) reloads (the desktop twin
   *  of R); the primary (left) button begins auto-fire. */
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

  /** Mouse UP: only the primary (fire) button releases the held auto-fire. */
  public readonly onMouseup = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.hooks.combat.endFire();
    }
  };

  /** Right-click over the canvas is the in-game reload, not a context menu. */
  public readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  /** Wheel WHILE PLAYING (pointer-locked): cycle the active weapon AND block the page scroll (`passive:false`
   *  is required for `preventDefault` on a wheel listener); when not locked the page scroll is untouched, so
   *  the embedded demo only traps the wheel during actual play. */
  public readonly onWheel = (event: WheelEvent): void => {
    if (document.pointerLockElement !== this.hooks.canvas()) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const direction = Math.sign(event.deltaY);

    if (direction !== 0) {
      // Cycle across OWNED weapons only — with the fists-only start the wheel stays put until pickups
      // light more of the arms row.
      this.hooks.combat.cycleWeapon(direction);
    }
  };

  /** A resize / fullscreen change: queue the render resolution for the display mode — full 1080p in fullscreen
   *  (the canvas fills the screen), the cheaper windowed tier otherwise, always 100% of the tier. */
  public readonly onResize = (): void => {
    const tier = document.fullscreenElement !== null ? FULLSCREEN_RENDER : WINDOWED_RENDER;

    this.hooks.queueResolution(tier.width, tier.height);
  };

  /** The current movement axes the held keys resolve to: `forward` (+1 ahead / −1 back) and `strafe` (+1 right
   *  / −1 left), across QWERTY (WASD) + AZERTY (ZQSD) + arrows. Turning is mouse-only, so there is no turn axis. */
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

  /** Map the movement axes + facing to the world-space want-displacement for one tick (before collision) via
   *  the core {@link movementDelta}. */
  public movementWant(
    angle: number,
    forward: number,
    strafe: number,
    reach: number,
  ): MovementDelta {
    return movementDelta(angle, forward, strafe, reach);
  }

  /** Fold one keyboard event into state: on a press, route the debug/action keys first (they preventDefault +
   *  consume); otherwise a movement key enters (down) or leaves (up) the held set. */
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

  /** Route a single-press action/debug key to its combat edge or component callback; returns whether the key
   *  was one (so {@link onKey} can consume it). H/J are debug vitals, F toggles fullscreen, 1–8 select a
   *  weapon, R reloads, G toggles the synthetic-enemy stress load. */
  private routeActionKey(key: string): boolean {
    if (key === 'h') {
      this.hooks.combat.hurtPlayer(15); // DEBUG: H = take a hit (routes through armour soak + the death check)

      return true;
    }
    if (key === 'j') {
      this.hooks.combat.heal(15); // DEBUG: J = heal

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
      this.hooks.combat.toggleStress(); // DEBUG: toggle the synthetic-enemy stress load

      return true;
    }

    return false;
  }
}
