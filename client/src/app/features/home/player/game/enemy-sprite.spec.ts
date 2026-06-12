import { describe, it, expect, vi, afterEach } from 'vitest';
import { enemyView, viewRotation, ENEMY_ATLAS_URLS, EnemyView, HUSK } from './enemy-sprite';
import type { Enemy } from '../../../../core/lib';

const CELL_W = 512; // the husk (kind 'manager') cell
const CELL_H = 716;

function enemy(over: Partial<Enemy> = {}): Enemy {
  return {
    x: 0,
    y: 0,
    dir: 0,
    state: 'alive',
    deathTime: 0,
    hp: 3,
    fireCooldown: 0,
    hitFlash: 0,
    windup: 0,
    kind: 'manager',
    ...over,
  };
}

/** A loadable `Image` stand-in (jsdom never fetches) — mirrors the other sprite specs' fakes. */
class FakeImage {
  public static readonly instances: FakeImage[] = [];
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public complete = false;
  public naturalWidth = 0;
  public naturalHeight = 0;
  public src = '';

  constructor() {
    FakeImage.instances.push(this);
  }
}

/** Decode the FakeImage whose src contains `part` at a grid of `cols`×`rows` cells. The views are module
 *  singletons, so an atlas decoded by an earlier test stays loaded — no fresh FakeImage is created and there
 *  is nothing to decode (it is already ready), so a missing instance is a no-op rather than an error. */
function decode(part: string, cols: number, rows: number): void {
  const img = FakeImage.instances.find((i) => i.src.includes(part));

  if (!img) {
    return; // already loaded by a prior test (singleton view)
  }
  img.complete = true;
  img.naturalWidth = cols * CELL_W;
  img.naturalHeight = rows * CELL_H;
  img.onload?.();
}

describe('viewRotation', () => {
  const rot = (camX: number, camY: number, dir = 0): number => viewRotation(0, 0, dir, camX, camY);

  it('is FRONT (1) in front of the facing, BACK (5) behind, SIDE (3/7) perpendicular', () => {
    expect(rot(1, 0)).toBe(1);
    expect(rot(-1, 0)).toBe(5);
    expect(rot(0, -1)).toBe(3);
    expect(rot(0, 1)).toBe(7);
  });

  it('maps the diagonals to the ¾ octants (2/4/6/8) and always returns 1..8', () => {
    expect(rot(1, -1)).toBe(2);
    expect(rot(-1, -1)).toBe(4);
    expect(rot(-1, 1)).toBe(6);
    expect(rot(1, 1)).toBe(8);
    for (let d = 0; d < Math.PI * 2; d += 0.3) {
      const r = viewRotation(0, 0, d, 1, 0);

      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(8);
    }
  });
});

describe('enemyView registry', () => {
  it('has a directional view for the arted kinds, none for procedural kinds', () => {
    expect(enemyView('manager')).toBeDefined(); // the husk
    expect(enemyView('middle_manager')).toBeDefined();
    expect(enemyView('junior_office_drone')).toBeDefined(); // the ranged junior
    expect(enemyView('security_guard')).toBeDefined(); // the tough ranged guard
    expect(enemyView('printer')).toBeUndefined();
    expect(enemyView('hr')).toBeUndefined();
  });

  it('preloads atlases for every arted enemy + its projectile strip, all under /game/enemies/', () => {
    expect(ENEMY_ATLAS_URLS.length).toBeGreaterThanOrEqual(8); // 4 states × ≥2 enemies
    expect(ENEMY_ATLAS_URLS.every((u) => u.startsWith('/game/enemies/'))).toBe(true);
    expect(ENEMY_ATLAS_URLS.some((u) => u.includes('/pinky/'))).toBe(true);
    expect(ENEMY_ATLAS_URLS.some((u) => u.includes('/middle_manager/'))).toBe(true);
    expect(ENEMY_ATLAS_URLS.some((u) => u.includes('/shotgunguy/'))).toBe(true);
    // The security guard's spinning staple-spray projectile strip is preloaded with the atlases.
    expect(ENEMY_ATLAS_URLS).toContain('/game/enemies/shotgunguy/spread_strip.webp');
  });

  it('keeps the shared 5-frame attack for the standard packs (the security guard ships a cropped 4)', () => {
    expect(HUSK.states.attack.frames).toBe(5); // the `attackFrames` default must not regress the husk
  });
});

describe('EnemyView (husk)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeImage.instances.length = 0;
  });

  const view = () => new EnemyView(HUSK); // a FRESH view per call → no cross-test cache leak

  it('returns null until the atlas decodes (SSR-safe)', () => {
    vi.stubGlobal('Image', undefined);
    expect(view().frameFor(enemy(), 1)).toBeNull();
  });

  it('walks: front octant → row 0 no flip; a mirrored octant flips; carries the cell draw geometry', () => {
    vi.stubGlobal('Image', FakeImage);
    const v = view();

    v.frameFor(enemy(), 1); // triggers the walk atlas load
    decode('pinky_walk', 4, 5);

    const front = v.frameFor(enemy(), 1)!;

    expect(front).toMatchObject({ sx: 0, sy: 0, sw: CELL_W, sh: CELL_H, flip: false });
    expect(front.drawScale).toBeCloseTo(0.85, 5);
    expect(front.aspect).toBeCloseTo(CELL_W / CELL_H, 5);

    const sideMirror = v.frameFor(enemy(), 7)!; // rotation 7 → row 'side' (index 2), flipped

    expect(sideMirror).toMatchObject({ sy: 2 * CELL_H, flip: true });
  });

  it('walk frame is DISTANCE-driven (world position), so the stride tracks movement', () => {
    vi.stubGlobal('Image', FakeImage);
    const v = view();

    v.frameFor(enemy(), 1);
    decode('pinky_walk', 4, 5);

    // frame = floor((x + y) × walkStepRate(4.5)) mod 4
    expect(v.frameFor(enemy({ x: 0, y: 0 }), 1)!.sx).toBe(0); // 0
    expect(v.frameFor(enemy({ x: 0.25, y: 0 }), 1)!.sx).toBe(1 * CELL_W); // floor(1.125)=1
    expect(v.frameFor(enemy({ x: 0.5, y: 0 }), 1)!.sx).toBe(2 * CELL_W); // floor(2.25)=2
  });

  it('dying → the death atlas, frame advanced by deathTime and clamped to the last (corpse)', () => {
    vi.stubGlobal('Image', FakeImage);
    const v = view();

    v.frameFor(enemy({ state: 'dying', deathTime: 0 }), 1);
    decode('pinky_death', 6, 1);

    expect(v.frameFor(enemy({ state: 'dying', deathTime: 0 }), 1)!.sx).toBe(0);
    expect(v.frameFor(enemy({ state: 'dead', deathTime: 10 }), 1)!.sx).toBe(5 * CELL_W); // clamped
  });

  it('a fresh hit shows the pain frame (front, no flip) for any octant', () => {
    vi.stubGlobal('Image', FakeImage);
    const v = view();

    v.frameFor(enemy({ hitFlash: 0.1 }), 3);
    decode('pinky_pain', 1, 1);

    expect(v.frameFor(enemy({ hitFlash: 0.1 }), 3)!).toMatchObject({ sx: 0, sy: 0, flip: false });
  });
});
