import { signal } from '@angular/core';
import { type MoveIntent } from '../../../../core/lib';

const LOOK_SENSITIVITY = 0.0025; // mouse/touch px → radians
const JOYSTICK_RANGE = 50; // px of thumb travel for full deflection

/** Keys the game owns — the caller `preventDefault`s them so they never scroll the page or trigger
 *  browser actions. */
const GAME_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'z',
  'q',
  'e',
  'r',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  ' ',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]);

/**
 * `GameInput` — collects desktop (fist + pointer-lock mouse) and mobile (floating joystick +
 * look-drag) input into a per-frame `MoveIntent`. Co-located plain class (no Angular DI, but holds the
 * two bare signals the template reads for the joystick visual). The owning component is the DOM
 * boundary: it forwards events here and `preventDefault`s the game keys; it also fires the audio
 * gesture, kept out of here so input stays free of any audio dependency.
 */
export class GameInput {
  /** Mobile joystick visual: the base position (null = inactive) + the clamped knob offset (px). */
  public readonly joyBase = signal<{ x: number; y: number } | null>(null);
  public readonly joyKnob = signal({ x: 0, y: 0 });

  private readonly keys = new Set<string>();
  private lookDelta = 0; // accumulated turn (radians) since the last `intent()`
  private touchMove = { forward: 0, strafe: 0 };
  private joyId: number | null = null;
  private lookId: number | null = null;
  private lookLastX = 0;
  /** True on a portrait phone, where the overlay is CSS-rotated 90° to landscape (touch coords swapped). */
  private portrait = false;
  private fireQueued = false; // a shot waiting to be consumed by the next `intent()` (the SEMI edge)
  private fireHeld = false; // the trigger is currently held down (drives the AUTO continuous burst)
  private useQueued = false; // a "use" (open exit) waiting to be consumed
  private switchQueued = false; // a weapon-switch (cycle next) waiting to be consumed
  private reloadQueued = false; // a reload waiting to be consumed
  private selectSlot: number | null = null; // a direct weapon-select (1-based number) waiting to be consumed

  /** Tell input which layout it's in, so `localPoint()` can inverse-transform the rotation. */
  public setPortrait(portrait: boolean): void {
    this.portrait = portrait;
  }

  /** Trigger pressed: raise the held flag (the AUTO burst reads it via `firing()`) AND queue a single
   *  edge (the SEMI one-shot reads it via `intent().fire`). A tap = down + up = one queued edge; a hold
   *  keeps `firing()` true for the auto loop while the edge stays a single shot for a semi weapon. */
  public fireDown(): void {
    this.fireHeld = true;
    this.fireQueued = true;
  }

  /** Trigger released: drop the held flag (the AUTO burst stops; the SEMI edge was already consumed). */
  public fireUp(): void {
    this.fireHeld = false;
  }

  /** Whether the trigger is held — the AUTO (held-burst) weapons fire continuously while this is true. */
  public firing(): boolean {
    return this.fireHeld;
  }

  /** Queue a single "use" (consumed once by the next `consumeUse()`). Used by the mobile button. */
  public triggerUse(): void {
    this.useQueued = true;
  }

  /** Read and clear the queued "use" (edge-triggered: true once per press). */
  public consumeUse(): boolean {
    const used = this.useQueued;

    this.useQueued = false;

    return used;
  }

  /** Queue a single weapon-switch (cycle to the next arsenal weapon), consumed once by `consumeSwitch()`.
   *  Fed by the mobile switch button + a pointer-locked mouse-wheel notch (the number keys SELECT a weapon
   *  directly instead — see `consumeSelect`). */
  public triggerSwitch(): void {
    this.switchQueued = true;
  }

  /** Read and clear the queued weapon-switch (edge-triggered: true once per request). */
  public consumeSwitch(): boolean {
    const switched = this.switchQueued;

    this.switchQueued = false;

    return switched;
  }

  /** Read and clear the queued direct weapon-select — its 1-based number, or `null` if none. Edge-triggered
   *  (one per physical press); fed by the number keys 1..8. The wheel + mobile button CYCLE instead. */
  public consumeSelect(): number | null {
    const slot = this.selectSlot;

    this.selectSlot = null;

    return slot;
  }

  /** Queue a single reload, consumed once by `consumeReload()`. Fed by the mobile button + the `r` key. */
  public triggerReload(): void {
    this.reloadQueued = true;
  }

  /** Read and clear the queued reload (edge-triggered: true once per request). */
  public consumeReload(): boolean {
    const reloaded = this.reloadQueued;

    this.reloadQueued = false;

    return reloaded;
  }

  // ---- desktop input -------------------------------------------------------
  /** Track the key; returns `true` if it's a game key, so the caller can `preventDefault` it. */
  public keyDown(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();

    if (key === 'e' && !this.keys.has('e')) {
      this.useQueued = true; // queue on a fresh press only, so holding E doesn't repeat
    }
    const slot = Number(key);

    if (slot >= 1 && slot <= 8 && !this.keys.has(key)) {
      this.selectSlot = slot; // a fresh number-key press selects that weapon directly (no auto-repeat)
    }
    if (key === 'r' && !this.keys.has('r')) {
      this.reloadQueued = true; // queue a reload on a fresh press only (no auto-repeat)
    }
    this.keys.add(key);

    return GAME_KEYS.has(key);
  }

  public keyUp(event: KeyboardEvent): void {
    this.keys.delete(event.key.toLowerCase());
  }

  /** Accumulate a pointer-lock mouse turn (the component gates this on the lock being on the canvas). */
  public look(movementX: number): void {
    this.lookDelta += movementX * LOOK_SENSITIVITY;
  }

  // ---- mobile input (visible floating joystick + look-drag) ----------------
  public joyStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];

    this.joyId = touch.identifier;
    this.joyBase.set(this.localPoint(touch));
    this.joyKnob.set({ x: 0, y: 0 });
  }

  public joyMove(event: TouchEvent): void {
    const base = this.joyBase();
    const touch = this.findTouch(event, this.joyId);

    if (!base || !touch) {
      return;
    }
    const point = this.localPoint(touch);
    const dx = point.x - base.x;
    const dy = point.y - base.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > JOYSTICK_RANGE ? JOYSTICK_RANGE / distance : 1;
    const knobX = dx * scale;
    const knobY = dy * scale;

    this.joyKnob.set({ x: knobX, y: knobY });
    this.touchMove = { forward: -knobY / JOYSTICK_RANGE, strafe: knobX / JOYSTICK_RANGE };
  }

  public joyEnd(): void {
    this.joyId = null;
    this.joyBase.set(null);
    this.touchMove = { forward: 0, strafe: 0 };
  }

  public lookStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];

    this.lookId = touch.identifier;
    this.lookLastX = this.localPoint(touch).x;
  }

  public lookMove(event: TouchEvent): void {
    const touch = this.findTouch(event, this.lookId);

    if (!touch) {
      return;
    }
    const pointX = this.localPoint(touch).x;

    this.lookDelta += (pointX - this.lookLastX) * LOOK_SENSITIVITY;
    this.lookLastX = pointX;
  }

  public lookEnd(): void {
    this.lookId = null;
  }

  // ---- per-frame ------------------------------------------------------------
  /** Build this frame's intent (keys take priority over the joystick), then reset the look accumulator. */
  public intent(): MoveIntent {
    const forwardKey =
      (this.keys.has('w') || this.keys.has('z') || this.keys.has('arrowup') ? 1 : 0) -
      (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const strafeKey =
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) -
      (this.keys.has('a') || this.keys.has('q') || this.keys.has('arrowleft') ? 1 : 0);
    const intent: MoveIntent = {
      forward: forwardKey || this.touchMove.forward,
      strafe: strafeKey || this.touchMove.strafe,
      look: this.lookDelta,
      fire: this.fireQueued,
      reload: false, // the edge-triggered reload is consumed separately (`consumeReload`), like the switch
    };

    this.lookDelta = 0;
    this.fireQueued = false;

    return intent;
  }

  private findTouch(event: TouchEvent, id: number | null): Touch | null {
    if (id === null) {
      return null;
    }
    for (let touchIndex = 0; touchIndex < event.touches.length; touchIndex++) {
      if (event.touches[touchIndex].identifier === id) {
        return event.touches[touchIndex];
      }
    }

    return null;
  }

  /**
   * Map a touch's screen coords into the game's local space. In portrait the overlay is CSS-rotated
   * 90° (`translate(-50%,-50%) rotate(90deg)`) to fill landscape, so screen `(x, y)` maps to local
   * `(y, viewportWidth - x)` — the inverse of that rotation. Otherwise screen == local.
   */
  private localPoint(touch: Touch): { x: number; y: number } {
    if (this.portrait) {
      return { x: touch.clientY, y: window.innerWidth - touch.clientX };
    }

    return { x: touch.clientX, y: touch.clientY };
  }
}
