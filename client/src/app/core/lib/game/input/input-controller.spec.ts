import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MutableCamera } from '../world/zone-runtime';
import { RESTART_DELAY, TOUCH_LOOK_SENS } from '../game-tuning';
import { InputController, type InputCombat, type InputControllerHooks } from './input-controller';

interface CombatSpy extends InputCombat {
  dead: boolean;
  won: boolean;
  deadClock: number;
  wonClock: number;
}

function makeCombat(): CombatSpy {
  return {
    dead: false,
    won: false,
    deadClock: 0,
    wonClock: 0,
    hurtPlayer: vi.fn(),
    heal: vi.fn(),
    selectWeapon: vi.fn(),
    reload: vi.fn(),
    toggleStress: vi.fn(),
    beginFire: vi.fn(),
    endFire: vi.fn(),
    cycleWeapon: vi.fn(),
  };
}

function makeController(): {
  controller: InputController;
  canvas: HTMLCanvasElement;
  camera: MutableCamera;
  combat: CombatSpy;
  hooks: {
    isMantling: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    toggleFullscreen: ReturnType<typeof vi.fn>;
    queueResolution: ReturnType<typeof vi.fn>;
    onJoystick: ReturnType<typeof vi.fn>;
  };
} {
  const canvas = document.createElement('canvas');

  (canvas as unknown as { requestPointerLock: () => Promise<void> }).requestPointerLock = vi
    .fn()
    .mockResolvedValue(undefined);
  // jsdom returns a zero-size rect by default — pin one so the left/right touch split has a real midpoint.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect;
  const camera: MutableCamera = { x: 0, y: 0, angle: 0, z: 0, pitch: 0 };
  const combat = makeCombat();
  const hooks = {
    isMantling: vi.fn(() => false),
    restart: vi.fn(),
    toggleFullscreen: vi.fn(),
    queueResolution: vi.fn(),
    onJoystick: vi.fn(),
  };
  const controllerHooks: InputControllerHooks = {
    camera,
    combat,
    canvas: () => canvas,
    isMantling: hooks.isMantling,
    restart: hooks.restart,
    toggleFullscreen: hooks.toggleFullscreen,
    queueResolution: hooks.queueResolution,
    onJoystick: hooks.onJoystick,
  };

  return { controller: new InputController(controllerHooks), canvas, camera, combat, hooks };
}

function setPointerLock(element: Element | null): void {
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: element });
}

function setFullscreen(element: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element });
}

function keyEvent(key: string): KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

function mouseEvent(init: {
  button?: number;
  ctrlKey?: boolean;
  movementX?: number;
  movementY?: number;
}): MouseEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    button: init.button ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    movementX: init.movementX ?? 0,
    movementY: init.movementY ?? 0,
    preventDefault: vi.fn(),
  } as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

function wheelEvent(
  deltaY: number,
  cancelable = true,
): WheelEvent & {
  preventDefault: ReturnType<typeof vi.fn>;
} {
  return { deltaY, cancelable, preventDefault: vi.fn() } as unknown as WheelEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

function touchEvent(
  points: { id: number; x: number; y: number }[],
): TouchEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    changedTouches: points.map((point) => ({
      identifier: point.id,
      clientX: point.x,
      clientY: point.y,
    })),
    preventDefault: vi.fn(),
  } as unknown as TouchEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  setPointerLock(null);
  setFullscreen(null);
});

describe('InputController — movement keys → held set', () => {
  it('adds a movement key on keydown and removes it on keyup (WASD)', () => {
    const { controller } = makeController();

    controller.onDown(keyEvent('w'));
    expect(controller.held.has('w')).toBe(true);

    controller.onUp(keyEvent('w'));
    expect(controller.held.has('w')).toBe(false);
  });

  it('lower-cases the key and consumes it (preventDefault) for AZERTY + arrow controls', () => {
    const { controller } = makeController();

    for (const key of ['Z', 'ArrowUp', 'Q', 'ArrowRight']) {
      const event = keyEvent(key);

      controller.onDown(event);
      expect(controller.held.has(key.toLowerCase())).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
  });

  it('ignores an unknown key: no held change, no routing, no preventDefault', () => {
    const { controller, combat } = makeController();
    const event = keyEvent('p');

    controller.onDown(event);

    expect(controller.held.size).toBe(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(combat.selectWeapon).not.toHaveBeenCalled();
    expect(combat.reload).not.toHaveBeenCalled();
  });
});

describe('InputController — movement axes derivation', () => {
  it('resolves forward/back from W/Z/ArrowUp vs S/ArrowDown', () => {
    const { controller } = makeController();

    controller.onDown(keyEvent('w'));
    expect(controller.movementAxes()).toEqual({ forward: 1, strafe: 0 });

    controller.onDown(keyEvent('s'));
    expect(controller.movementAxes()).toEqual({ forward: 0, strafe: 0 });

    controller.onUp(keyEvent('w'));
    expect(controller.movementAxes()).toEqual({ forward: -1, strafe: 0 });
  });

  it('resolves strafe from D/ArrowRight vs A/Q/ArrowLeft', () => {
    const { controller } = makeController();

    controller.onDown(keyEvent('d'));
    expect(controller.movementAxes()).toEqual({ forward: 0, strafe: 1 });

    controller.onDown(keyEvent('q'));
    expect(controller.movementAxes()).toEqual({ forward: 0, strafe: 0 });

    controller.onUp(keyEvent('d'));
    expect(controller.movementAxes()).toEqual({ forward: 0, strafe: -1 });
  });

  it('maps a diagonal held combo through movementWant (core movementDelta)', () => {
    const { controller } = makeController();

    expect(controller.movementWant(0, 1, 0, 2)).toEqual({ x: 2, y: 0 });
    expect(controller.movementWant(0, 0, 1, 2)).toEqual({ x: 0, y: -2 });
  });
});

describe('InputController — mouse look', () => {
  it('turns the camera by movementX·SENS and clamps pitch when locked', () => {
    const { controller, canvas, camera } = makeController();

    setPointerLock(canvas);
    controller.onMouse(mouseEvent({ movementX: 100, movementY: 10 }));

    expect(camera.angle).toBeCloseTo(-0.35, 6);
    expect(camera.pitch).toBeCloseTo(-0.035, 6);
  });

  it('clamps pitch to the look-up / look-down limits', () => {
    const up = makeController();

    setPointerLock(up.canvas);
    up.controller.onMouse(mouseEvent({ movementY: -1000 }));
    expect(up.camera.pitch).toBeCloseTo(0.85, 6);

    const down = makeController();

    setPointerLock(down.canvas);
    down.controller.onMouse(mouseEvent({ movementY: 1000 }));
    expect(down.camera.pitch).toBeCloseTo(-2.0, 6);
  });

  it('freezes look when not pointer-locked', () => {
    const { controller, camera } = makeController();

    setPointerLock(null);
    controller.onMouse(mouseEvent({ movementX: 100, movementY: 100 }));

    expect(camera.angle).toBe(0);
    expect(camera.pitch).toBe(0);
  });

  it('freezes look mid-mantle even while locked', () => {
    const { controller, canvas, camera, hooks } = makeController();

    setPointerLock(canvas);
    hooks.isMantling.mockReturnValue(true);
    controller.onMouse(mouseEvent({ movementX: 100, movementY: 100 }));

    expect(camera.angle).toBe(0);
    expect(camera.pitch).toBe(0);
  });
});

describe('InputController — action / debug keys', () => {
  it('routes number keys 1–8 to selectWeapon (0-indexed) and consumes them', () => {
    const { controller, combat } = makeController();

    for (let n = 1; n <= 8; n++) {
      const event = keyEvent(String(n));

      controller.onDown(event);
      expect(combat.selectWeapon).toHaveBeenCalledWith(n - 1);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(controller.held.size).toBe(0);
  });

  it('routes R to reload, G to the stress toggle, F to the fullscreen callback', () => {
    const { controller, combat, hooks } = makeController();

    controller.onDown(keyEvent('r'));
    expect(combat.reload).toHaveBeenCalledOnce();

    controller.onDown(keyEvent('g'));
    expect(combat.toggleStress).toHaveBeenCalledOnce();

    controller.onDown(keyEvent('f'));
    expect(hooks.toggleFullscreen).toHaveBeenCalledOnce();
  });

  it('routes the debug vitals keys H (hurt 15) and J (heal 15)', () => {
    const { controller, combat } = makeController();

    controller.onDown(keyEvent('h'));
    expect(combat.hurtPlayer).toHaveBeenCalledWith(15);

    controller.onDown(keyEvent('j'));
    expect(combat.heal).toHaveBeenCalledWith(15);
  });

  it('ignores the action keys on key UP (they are press-only)', () => {
    const { controller, combat, hooks } = makeController();

    controller.onUp(keyEvent('r'));
    controller.onUp(keyEvent('g'));
    controller.onUp(keyEvent('1'));
    controller.onUp(keyEvent('f'));

    expect(combat.reload).not.toHaveBeenCalled();
    expect(combat.toggleStress).not.toHaveBeenCalled();
    expect(combat.selectWeapon).not.toHaveBeenCalled();
    expect(hooks.toggleFullscreen).not.toHaveBeenCalled();
  });
});

describe('InputController — mouse buttons', () => {
  it('fires on the primary button down and releases on its up (when locked)', () => {
    const { controller, canvas, combat } = makeController();

    setPointerLock(canvas);
    controller.onMousedown(mouseEvent({ button: 0 }));
    expect(combat.beginFire).toHaveBeenCalledOnce();

    controller.onMouseup(mouseEvent({ button: 0 }));
    expect(combat.endFire).toHaveBeenCalledOnce();
  });

  it('reloads on the secondary button (right) and on Ctrl+click, preventing the default', () => {
    const { controller, canvas, combat } = makeController();

    setPointerLock(canvas);
    const right = mouseEvent({ button: 2 });

    controller.onMousedown(right);
    expect(combat.reload).toHaveBeenCalledOnce();
    expect(right.preventDefault).toHaveBeenCalledOnce();
    expect(combat.beginFire).not.toHaveBeenCalled();

    const ctrl = mouseEvent({ button: 0, ctrlKey: true });

    controller.onMousedown(ctrl);
    expect(combat.reload).toHaveBeenCalledTimes(2);
    expect(ctrl.preventDefault).toHaveBeenCalledOnce();
  });

  it('ignores a non-primary, non-secondary button (e.g. middle-click) when locked', () => {
    const { controller, canvas, combat } = makeController();

    setPointerLock(canvas);
    controller.onMousedown(mouseEvent({ button: 1 }));

    expect(combat.beginFire).not.toHaveBeenCalled();
    expect(combat.reload).not.toHaveBeenCalled();
  });

  it('ignores mouse-down when not pointer-locked', () => {
    const { controller, combat } = makeController();

    setPointerLock(null);
    controller.onMousedown(mouseEvent({ button: 0 }));

    expect(combat.beginFire).not.toHaveBeenCalled();
    expect(combat.reload).not.toHaveBeenCalled();
  });

  it('only the primary button releases the auto-fire on mouse-up', () => {
    const { controller, combat } = makeController();

    controller.onMouseup(mouseEvent({ button: 2 }));

    expect(combat.endFire).not.toHaveBeenCalled();
  });

  it('blocks the context menu over the canvas', () => {
    const { controller } = makeController();
    const event = { preventDefault: vi.fn() } as unknown as Event & {
      preventDefault: ReturnType<typeof vi.fn>;
    };

    controller.onContextMenu(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe('InputController — wheel weapon cycle', () => {
  it('cycles the weapon by the scroll direction and blocks the page scroll when locked', () => {
    const { controller, canvas, combat } = makeController();

    setPointerLock(canvas);
    const down = wheelEvent(5);

    controller.onWheel(down);
    expect(combat.cycleWeapon).toHaveBeenCalledWith(1);
    expect(down.preventDefault).toHaveBeenCalledOnce();

    controller.onWheel(wheelEvent(-5));
    expect(combat.cycleWeapon).toHaveBeenCalledWith(-1);
  });

  it('still cycles but skips preventDefault on a non-cancelable wheel event', () => {
    const { controller, canvas, combat } = makeController();

    setPointerLock(canvas);
    const event = wheelEvent(5, false);

    controller.onWheel(event);

    expect(combat.cycleWeapon).toHaveBeenCalledWith(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not cycle on a zero-delta wheel event', () => {
    const { controller, canvas, combat } = makeController();

    setPointerLock(canvas);
    controller.onWheel(wheelEvent(0));

    expect(combat.cycleWeapon).not.toHaveBeenCalled();
  });

  it('leaves the page scroll untouched when not locked', () => {
    const { controller, combat } = makeController();

    setPointerLock(null);
    const event = wheelEvent(5);

    controller.onWheel(event);

    expect(combat.cycleWeapon).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('InputController — resize → render tier', () => {
  it('queues the windowed tier when not in fullscreen', () => {
    const { controller, hooks } = makeController();

    setFullscreen(null);
    controller.onResize();

    expect(hooks.queueResolution).toHaveBeenCalledWith(1280, 720);
  });

  it('queues the full 1080p tier in fullscreen', () => {
    const { controller, canvas, hooks } = makeController();

    setFullscreen(canvas);
    controller.onResize();

    expect(hooks.queueResolution).toHaveBeenCalledWith(1920, 1080);
  });
});

describe('InputController — click: restart vs pointer-lock', () => {
  it('requests the pointer lock while playing', () => {
    const { controller, canvas, hooks } = makeController();

    controller.onClick();

    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    expect(hooks.restart).not.toHaveBeenCalled();
  });

  it('swallows a rejected pointer-lock request (browser re-lock rate-limit)', async () => {
    const { controller, canvas } = makeController();

    (canvas as unknown as { requestPointerLock: () => Promise<void> }).requestPointerLock = vi
      .fn()
      .mockRejectedValue(new DOMException('rate limited', 'SecurityError'));

    expect(() => controller.onClick()).not.toThrow();
    await Promise.resolve();
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
  });

  it('restarts on the game-over screen only after the settle delay', () => {
    const { controller, combat, hooks } = makeController();

    combat.dead = true;
    combat.deadClock = RESTART_DELAY - 0.01;
    controller.onClick();
    expect(hooks.restart).not.toHaveBeenCalled();

    combat.deadClock = RESTART_DELAY;
    controller.onClick();
    expect(hooks.restart).toHaveBeenCalledOnce();
  });

  it('restarts on the win screen after the settle delay (reads the won clock)', () => {
    const { controller, canvas, combat, hooks } = makeController();

    combat.won = true;
    combat.wonClock = RESTART_DELAY;
    controller.onClick();

    expect(hooks.restart).toHaveBeenCalledOnce();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });
});

function plainEvent(): Event & { preventDefault: ReturnType<typeof vi.fn> } {
  return { preventDefault: vi.fn() } as unknown as Event & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

describe('InputController — touch: movement joystick (left half)', () => {
  it('drives analog movementAxes from the left-half thumb and falls back to keys on release', () => {
    const { controller } = makeController();

    controller.onDown(keyEvent('d')); // held key = the fallback (strafe right)
    controller.onTouchStart(touchEvent([{ id: 1, x: 50, y: 150 }]));
    controller.onTouchMove(touchEvent([{ id: 1, x: 50, y: 90 }])); // 60px up = full forward

    expect(controller.movementAxes()).toEqual({ forward: 1, strafe: 0 }); // touch overrides the key

    controller.onTouchEnd(touchEvent([{ id: 1, x: 50, y: 90 }]));
    expect(controller.movementAxes()).toEqual({ forward: 0, strafe: 1 }); // back to key 'd'
  });

  it('prevents default on every touch phase (kills scroll / pinch-zoom)', () => {
    const { controller } = makeController();
    const start = touchEvent([{ id: 1, x: 50, y: 150 }]);
    const move = touchEvent([{ id: 1, x: 60, y: 140 }]);
    const end = touchEvent([{ id: 1, x: 60, y: 140 }]);

    controller.onTouchStart(start);
    controller.onTouchMove(move);
    controller.onTouchEnd(end);

    expect(start.preventDefault).toHaveBeenCalledOnce();
    expect(move.preventDefault).toHaveBeenCalledOnce();
    expect(end.preventDefault).toHaveBeenCalledOnce();
  });

  it('publishes the joystick base in canvas-local px and clamps the thumb to the ring', () => {
    const { controller, hooks } = makeController();

    controller.onTouchStart(touchEvent([{ id: 1, x: 50, y: 150 }]));
    expect(hooks.onJoystick).toHaveBeenLastCalledWith({
      baseX: 50,
      baseY: 150,
      thumbDx: 0,
      thumbDy: 0,
    });

    controller.onTouchMove(touchEvent([{ id: 1, x: 50, y: 90 }])); // 60px up = on the ring
    expect(hooks.onJoystick).toHaveBeenLastCalledWith({
      baseX: 50,
      baseY: 150,
      thumbDx: 0,
      thumbDy: -60,
    });

    controller.onTouchMove(touchEvent([{ id: 1, x: 50, y: -50 }])); // 200px up → clamped to radius 60
    expect(hooks.onJoystick).toHaveBeenLastCalledWith({
      baseX: 50,
      baseY: 150,
      thumbDx: 0,
      thumbDy: -60,
    });

    controller.onTouchEnd(touchEvent([{ id: 1, x: 50, y: -50 }]));
    expect(hooks.onJoystick).toHaveBeenLastCalledWith(null);
  });
});

describe('InputController — touch: look drag (right half)', () => {
  it('turns the camera from a right-half drag by TOUCH_LOOK_SENS', () => {
    const { controller, camera } = makeController();

    controller.onTouchStart(touchEvent([{ id: 2, x: 300, y: 150 }])); // right half (≥ 200)
    controller.onTouchMove(touchEvent([{ id: 2, x: 400, y: 160 }])); // +100x, +10y

    expect(camera.angle).toBeCloseTo(-100 * TOUCH_LOOK_SENS, 6);
    expect(camera.pitch).toBeCloseTo(-10 * TOUCH_LOOK_SENS, 6);
  });

  it('freezes mid-mantle but keeps sampling, so there is no jump when the hoist ends', () => {
    const { controller, camera, hooks } = makeController();

    controller.onTouchStart(touchEvent([{ id: 2, x: 300, y: 150 }]));

    hooks.isMantling.mockReturnValue(true);
    controller.onTouchMove(touchEvent([{ id: 2, x: 400, y: 150 }])); // frozen: this delta is dropped
    expect(camera.angle).toBe(0);

    hooks.isMantling.mockReturnValue(false);
    controller.onTouchMove(touchEvent([{ id: 2, x: 500, y: 150 }])); // only this 100px delta applies
    expect(camera.angle).toBeCloseTo(-100 * TOUCH_LOOK_SENS, 6);
  });
});

describe('InputController — touch: multi-touch routing by identifier', () => {
  it('routes a move-thumb and a look-thumb simultaneously', () => {
    const { controller, camera } = makeController();

    controller.onTouchStart(
      touchEvent([
        { id: 1, x: 50, y: 150 }, // left = move
        { id: 2, x: 300, y: 150 }, // right = look
      ]),
    );
    controller.onTouchMove(
      touchEvent([
        { id: 2, x: 340, y: 150 }, // look +40x
        { id: 1, x: 50, y: 90 }, // move full forward
      ]),
    );

    expect(controller.movementAxes()).toEqual({ forward: 1, strafe: 0 });
    expect(camera.angle).toBeCloseTo(-40 * TOUCH_LOOK_SENS, 6);
  });

  it('ignores extra thumbs once each half already has an owner', () => {
    const { controller, camera, hooks } = makeController();

    controller.onTouchStart(
      touchEvent([
        { id: 1, x: 40, y: 150 },
        { id: 2, x: 300, y: 150 },
      ]),
    );
    controller.onTouchStart(
      touchEvent([
        { id: 3, x: 80, y: 150 }, // 2nd left → ignored
        { id: 4, x: 360, y: 150 }, // 2nd right → ignored
      ]),
    );
    hooks.onJoystick.mockClear();

    controller.onTouchMove(
      touchEvent([
        { id: 3, x: 80, y: 40 }, // not the move owner → no joystick update
        { id: 4, x: 380, y: 150 }, // not the look owner → no camera turn
      ]),
    );

    expect(hooks.onJoystick).not.toHaveBeenCalled();
    expect(camera.angle).toBe(0);
  });

  it('releases only the lifted thumb and no-ops on an unknown id', () => {
    const { controller } = makeController();

    controller.onTouchStart(
      touchEvent([
        { id: 1, x: 40, y: 150 },
        { id: 2, x: 300, y: 150 },
      ]),
    );
    controller.onTouchMove(touchEvent([{ id: 1, x: 40, y: 90 }])); // forward 1
    controller.onTouchEnd(touchEvent([{ id: 2, x: 300, y: 150 }])); // lift the look thumb only

    expect(controller.movementAxes()).toEqual({ forward: 1, strafe: 0 }); // move still owned

    controller.onTouchEnd(touchEvent([{ id: 99, x: 0, y: 0 }])); // unknown → no-op
    expect(controller.movementAxes()).toEqual({ forward: 1, strafe: 0 });
  });
});

describe('InputController — touch: fire + weapon buttons', () => {
  it('begins fire on press and ends on release, preventing default', () => {
    const { controller, combat } = makeController();
    const down = plainEvent();
    const up = plainEvent();

    controller.onFireDown(down);
    expect(combat.beginFire).toHaveBeenCalledOnce();
    expect(down.preventDefault).toHaveBeenCalledOnce();

    controller.onFireUp(up);
    expect(combat.endFire).toHaveBeenCalledOnce();
    expect(up.preventDefault).toHaveBeenCalledOnce();
  });

  it('cycles the weapon forward on the weapon button', () => {
    const { controller, combat } = makeController();
    const tap = plainEvent();

    controller.onWeaponButton(tap);

    expect(combat.cycleWeapon).toHaveBeenCalledWith(1);
    expect(tap.preventDefault).toHaveBeenCalledOnce();
  });
});

describe('InputController — touch: restart tap on the end screen', () => {
  it('restarts on a tap once the dead settle delay passes, not before', () => {
    const { controller, combat, hooks } = makeController();

    combat.dead = true;
    combat.deadClock = RESTART_DELAY - 0.01;
    controller.onTouchStart(touchEvent([{ id: 1, x: 50, y: 150 }]));
    expect(hooks.restart).not.toHaveBeenCalled();

    combat.deadClock = RESTART_DELAY;
    controller.onTouchStart(touchEvent([{ id: 1, x: 50, y: 150 }]));
    expect(hooks.restart).toHaveBeenCalledOnce();
  });

  it('reads the won clock on the win screen', () => {
    const { controller, combat, hooks } = makeController();

    combat.won = true;
    combat.wonClock = RESTART_DELAY;
    controller.onTouchStart(touchEvent([{ id: 1, x: 50, y: 150 }]));

    expect(hooks.restart).toHaveBeenCalledOnce();
  });

  it('does not start a joystick while dead (returns before the touch loop)', () => {
    const { controller, combat, hooks } = makeController();

    combat.dead = true;
    combat.deadClock = 0;
    controller.onTouchStart(touchEvent([{ id: 1, x: 50, y: 150 }]));

    expect(hooks.restart).not.toHaveBeenCalled();
    expect(hooks.onJoystick).not.toHaveBeenCalled();
  });
});
