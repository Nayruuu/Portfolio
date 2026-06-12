import { describe, it, expect } from 'vitest';
import { GameInput } from './game-input';

type FakeTouch = { identifier: number; clientX: number; clientY: number };

function touchEvent(touches: FakeTouch[]): TouchEvent {
  return { changedTouches: touches, touches } as unknown as TouchEvent;
}

function keydown(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key });
}

describe('GameInput', () => {
  it('maps WASD / ZQSD / arrows to a forward+strafe intent, opposites cancelling', () => {
    const input = new GameInput();

    input.keyDown(keydown('w'));
    expect(input.intent()).toMatchObject({ forward: 1, strafe: 0 });

    input.keyDown(keydown('d'));
    expect(input.intent()).toMatchObject({ forward: 1, strafe: 1 });

    input.keyDown(keydown('s')); // forward + back cancel
    input.keyDown(keydown('q')); // strafe-left cancels strafe-right (ZQSD)
    expect(input.intent()).toMatchObject({ forward: 0, strafe: 0 });

    input.keyUp(keydown('w'));
    input.keyUp(keydown('s'));
    input.keyUp(keydown('q'));
    expect(input.intent()).toMatchObject({ forward: 0, strafe: 1 }); // only 'd' remains
  });

  it('reports whether a key is game-owned so the caller can preventDefault it', () => {
    const input = new GameInput();

    expect(input.keyDown(keydown('ArrowUp'))).toBe(true);
    expect(input.keyDown(keydown(' '))).toBe(true);
    expect(input.keyDown(keydown('p'))).toBe(false);
  });

  it('accumulates look then resets it once consumed by intent()', () => {
    const input = new GameInput();

    input.look(40);
    input.look(40);
    expect(input.intent().look).toBeCloseTo(0.2); // 80 px × 0.0025 rad/px
    expect(input.intent().look).toBe(0); // reset after the previous frame consumed it
  });

  it('fireDown queues a one-shot edge AND raises the held flag; fireUp drops the hold', () => {
    const input = new GameInput();

    input.fireDown();
    expect(input.firing()).toBe(true); // held → an auto weapon bursts while this stays true
    expect(input.intent().fire).toBe(true); // the SEMI one-shot edge
    expect(input.intent().fire).toBe(false); // edge consumed by the previous intent()
    expect(input.firing()).toBe(true); // …but the hold persists across frames (not edge-consumed)

    input.fireUp();
    expect(input.firing()).toBe(false); // released → an auto burst stops
  });

  it('a semi tap (down + up) still yields exactly one fire edge', () => {
    const input = new GameInput();

    input.fireDown();
    input.fireUp(); // a quick tap
    expect(input.intent().fire).toBe(true); // the single queued edge survives the release
    expect(input.intent().fire).toBe(false); // …and is consumed only once
  });

  it('drives forward from the floating joystick and clamps the knob to its range', () => {
    const input = new GameInput();

    input.setPortrait(false);
    input.joyStart(touchEvent([{ identifier: 0, clientX: 100, clientY: 100 }]));
    expect(input.joyBase()).toEqual({ x: 100, y: 100 });

    // Drag straight up beyond the 50 px range → full forward, knob clamped to the range.
    input.joyMove(touchEvent([{ identifier: 0, clientX: 100, clientY: 20 }]));
    expect(input.intent().forward).toBeCloseTo(1);
    expect(input.joyKnob().y).toBeCloseTo(-50);

    input.joyEnd();
    expect(input.joyBase()).toBeNull();
    expect(input.intent().forward).toBe(0);
  });

  it('inverse-transforms touch coords when the portrait overlay is CSS-rotated 90°', () => {
    const input = new GameInput();

    input.setPortrait(true);
    input.joyStart(touchEvent([{ identifier: 0, clientX: 10, clientY: 20 }]));

    // Screen (x, y) → local (y, innerWidth − x): the inverse of the overlay's rotation.
    expect(input.joyBase()).toEqual({ x: 20, y: window.innerWidth - 10 });
  });
});

describe('use action', () => {
  it('triggerUse → consumeUse is true once, then false', () => {
    const input = new GameInput();

    input.triggerUse();
    expect(input.consumeUse()).toBe(true);
    expect(input.consumeUse()).toBe(false);
  });

  it('a fresh E keydown queues a use (one per physical press)', () => {
    const input = new GameInput();

    input.keyDown({ key: 'e', preventDefault() {} } as unknown as KeyboardEvent);
    expect(input.consumeUse()).toBe(true);
  });

  it('keyDown returns true for E so the component preventDefaults it', () => {
    const input = new GameInput();

    expect(input.keyDown({ key: 'e', preventDefault() {} } as unknown as KeyboardEvent)).toBe(true);
  });
});

describe('weapon switch (cycle — wheel / mobile button)', () => {
  it('triggerSwitch → consumeSwitch is true once, then false', () => {
    const input = new GameInput();

    input.triggerSwitch();
    expect(input.consumeSwitch()).toBe(true);
    expect(input.consumeSwitch()).toBe(false);
  });
});

describe('weapon select (number keys)', () => {
  it('a fresh number keydown queues that 1-based slot, consumed once', () => {
    const input = new GameInput();

    input.keyDown(keydown('2'));
    expect(input.consumeSelect()).toBe(2);
    expect(input.consumeSelect()).toBeNull(); // edge-triggered: consumed once

    input.keyDown(keydown('3'));
    expect(input.consumeSelect()).toBe(3);
  });

  it('holding a number key does not re-queue (one select per physical press)', () => {
    const input = new GameInput();

    input.keyDown(keydown('2'));
    expect(input.consumeSelect()).toBe(2);
    input.keyDown(keydown('2')); // auto-repeat while held → no re-queue
    expect(input.consumeSelect()).toBeNull();

    input.keyUp(keydown('2'));
    input.keyDown(keydown('2')); // a fresh press queues again
    expect(input.consumeSelect()).toBe(2);
  });

  it('keyDown returns true for a slot number so the component preventDefaults it', () => {
    const input = new GameInput();

    expect(input.keyDown(keydown('1'))).toBe(true);
    expect(input.keyDown(keydown('3'))).toBe(true);
  });
});

describe('reload', () => {
  it('triggerReload → consumeReload is true once, then false', () => {
    const input = new GameInput();

    input.triggerReload();
    expect(input.consumeReload()).toBe(true);
    expect(input.consumeReload()).toBe(false);
  });

  it('a fresh R keydown queues a reload (one per physical press)', () => {
    const input = new GameInput();

    input.keyDown(keydown('r'));
    expect(input.consumeReload()).toBe(true);
    expect(input.consumeReload()).toBe(false); // holding the key down doesn't re-queue

    input.keyUp(keydown('r'));
    input.keyDown(keydown('r')); // a fresh press queues again
    expect(input.consumeReload()).toBe(true);
  });

  it('keyDown returns true for R so the component preventDefaults it', () => {
    const input = new GameInput();

    expect(input.keyDown(keydown('r'))).toBe(true);
  });
});
