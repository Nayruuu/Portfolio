import { describe, expect, it } from 'vitest';
import { hitsPlayer, stepProjectile } from './projectile';

const OPEN = { width: 3, height: 3, cells: [1, 1, 1, 1, 0, 1, 1, 1, 1] }; // only the centre cell is open

describe('stepProjectile', () => {
  it('advances along its velocity, carrying its skin', () => {
    const result = stepProjectile(
      { x: 1.5, y: 1.5, velocityX: 1, velocityY: 0, skin: 'invite' },
      OPEN,
      0.1,
    );

    expect(result).not.toBeNull();
    expect(result?.x).toBeCloseTo(1.6, 5);
    expect(result?.y).toBeCloseTo(1.5, 5);
    expect(result?.skin).toBe('invite');
  });

  it('despawns (null) when it enters a wall', () => {
    expect(
      stepProjectile({ x: 1.5, y: 1.5, velocityX: 10, velocityY: 0, skin: 'paper' }, OPEN, 0.1),
    ).toBeNull(); // lands in cell x=2 (wall)
  });
});

describe('hitsPlayer', () => {
  it('true within the hit radius, false outside', () => {
    expect(
      hitsPlayer(
        { x: 1.5, y: 1.5, velocityX: 0, velocityY: 0, skin: 'invite' },
        { x: 1.6, y: 1.5, dir: 0 },
      ),
    ).toBe(true);
    expect(
      hitsPlayer(
        { x: 1.5, y: 1.5, velocityX: 0, velocityY: 0, skin: 'invite' },
        { x: 2.5, y: 1.5, dir: 0 },
      ),
    ).toBe(false);
  });
});
