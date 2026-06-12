import { describe, it, expect } from 'vitest';
import { stepAmmoPickups } from './ammo-pickup';
import type { AmmoPickup } from './types';

const pose = { x: 2, y: 2, dir: 0 };
const box = (over: Partial<AmmoPickup> = {}): AmmoPickup => ({
  x: 2,
  y: 2,
  kind: 'box_staples',
  ammoType: 'staples',
  amount: 20,
  max: 200,
  age: 0,
  ...over,
});

describe('stepAmmoPickups', () => {
  it('collects an overlapping box, refilling its ammo type, and drops it', () => {
    const out = stepAmmoPickups(pose, [box()], { staples: 50 }, 0.1);

    expect(out.playerAmmo['staples']).toBe(70); // 50 + 20
    expect(out.ammoPickups).toHaveLength(0); // consumed
  });

  it('caps the refill at the type max', () => {
    const out = stepAmmoPickups(pose, [box({ amount: 20, max: 200 })], { staples: 190 }, 0.1);

    expect(out.playerAmmo['staples']).toBe(200); // min(200, 190 + 20)
    expect(out.ammoPickups).toHaveLength(0);
  });

  it('treats a missing ammo-type reserve as 0', () => {
    const out = stepAmmoPickups(pose, [box()], {}, 0.1);

    expect(out.playerAmmo['staples']).toBe(20); // (undefined ?? 0) + 20
    expect(out.ammoPickups).toHaveLength(0);
  });

  it('KEEPS a box on a full type (no waste) and leaves the reserve untouched', () => {
    const out = stepAmmoPickups(pose, [box()], { staples: 200 }, 0.1);

    expect(out.playerAmmo['staples']).toBe(200); // already at max — nothing added
    expect(out.ammoPickups).toHaveLength(1); // the box is kept for later
  });

  it('leaves a distant box on the floor, reserve unchanged', () => {
    const out = stepAmmoPickups(pose, [box({ x: 9, y: 9 })], { staples: 50 }, 0.1);

    expect(out.playerAmmo['staples']).toBe(50);
    expect(out.ammoPickups).toHaveLength(1);
  });

  it('advances each surviving box age by dt (the spin clock)', () => {
    const out = stepAmmoPickups(pose, [box({ x: 9, y: 9, age: 0.5 })], { staples: 50 }, 0.25);

    expect(out.ammoPickups[0].age).toBeCloseTo(0.75, 5);
  });
});
