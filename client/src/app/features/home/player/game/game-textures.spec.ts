import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildThemeArt,
  buildSwitchTexture,
  buildEnemyFrames,
  buildProjectiles,
  buildPickups,
} from './game-textures';
import { THEME_CYCLE } from '../../../../core/lib';

/** A recording 2-D context stub (jsdom has no canvas rendering). */
function fakeContext() {
  return {
    fillStyle: '',
    globalAlpha: 1,
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
}

describe('game-textures', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext() as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a wall/floor/ceiling art set for a theme', () => {
    const art = buildThemeArt(THEME_CYCLE[0]);

    expect(art.walls[1]).toBeInstanceOf(HTMLCanvasElement); // a wall per used id
    expect(art.walls[1].width).toBe(64);
    expect(art.floorFlats[0]).toBeInstanceOf(HTMLCanvasElement);
    expect(art.floorFlats.length).toBe(THEME_CYCLE[0].floors.length);
    expect(art.ceilFlats.length).toBe(THEME_CYCLE[0].ceils.length);
  });

  it('builds a non-blank switch texture', () => {
    expect(buildSwitchTexture()).toBeInstanceOf(HTMLCanvasElement);
    expect(buildSwitchTexture().width).toBe(64);
  });

  it('builds per-kind enemy frames (manager / printer / hr, 4 frames each)', () => {
    const frames = buildEnemyFrames();

    for (const kind of ['manager', 'printer', 'hr'] as const) {
      expect(frames[kind]).toHaveLength(4);
      for (const frame of frames[kind]) {
        expect(frame).toBeInstanceOf(HTMLCanvasElement);
        expect(frame.width).toBe(48);
        expect(frame.height).toBe(48);
      }
    }
  });

  it('builds per-skin office projectiles (invite / paper / memo, each 32×32)', () => {
    const projectiles = buildProjectiles();

    for (const skin of ['invite', 'paper', 'memo'] as const) {
      expect(projectiles[skin]).toBeInstanceOf(HTMLCanvasElement);
      expect(projectiles[skin].width).toBe(32);
      expect(projectiles[skin].height).toBe(32);
    }
  });

  it('builds health + armor pickup sprites, each 48×48', () => {
    const pickups = buildPickups();

    for (const key of ['health', 'armor'] as const) {
      expect(pickups[key]).toBeInstanceOf(HTMLCanvasElement);
      expect(pickups[key].width).toBe(48);
      expect(pickups[key].height).toBe(48);
    }
  });
});
