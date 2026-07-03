import { describe, it, expect } from 'vitest';
import { buildBsp, locateSubSector, movePlayer, type CompiledMap } from '../../core/lib/bsp-engine';
import { ACCUEIL } from './level-accueil';

const RADIUS = 0.3;
const STEP_MAX = 1.1;
const HEADROOM = 0.8;

/** Walk the player through a sequence of straight-line-clear waypoints, returning the final position — proves
 *  two points are connected (collisions block it short of the goal if a wall is in the way). */
function walkLegs(
  map: CompiledMap,
  start: readonly [number, number],
  legs: readonly [number, number][],
) {
  let [x, y] = start;

  for (const [tx, ty] of legs) {
    for (let i = 0; i < 400; i++) {
      const dx = tx - x;
      const dy = ty - y;
      const d = Math.hypot(dx, dy);

      if (d < 0.15) {
        break;
      }
      const reach = Math.min(0.12, d);
      const moved = movePlayer(
        map,
        x,
        y,
        (dx / d) * reach,
        (dy / d) * reach,
        RADIUS,
        STEP_MAX,
        HEADROOM,
      );

      x = moved.x;
      y = moved.y;
    }
  }

  return { x, y };
}

describe('L1 Accueil', () => {
  const map = buildBsp(ACCUEIL.map);
  const floorAt = (x: number, y: number): number =>
    ACCUEIL.map.sectors[locateSubSector(map.root, x, y).sector].floorZ;

  it('compiles into a non-empty BSP', () => {
    expect(map.subsectors.length).toBeGreaterThan(0);
  });

  it('seats the spawn, the badge dais (mantle) and the atrium (sunken) at their intended heights', () => {
    const [exitX, exitY] = ACCUEIL.exit ?? [Number.NaN, Number.NaN]; // legacy exit — present on this level

    expect(floorAt(ACCUEIL.spawn.x, ACCUEIL.spawn.y)).toBe(0); // réception floor
    expect(floorAt(ACCUEIL.keycards[0][0], ACCUEIL.keycards[0][1])).toBe(1.6); // badge dais — a mantle ledge
    expect(floorAt(exitX, exitY)).toBe(-0.8); // sunken octagonal atrium
  });

  it('places every enemy + pickup on a real, sensible floor (none stranded in the void)', () => {
    const points = [
      ...ACCUEIL.enemies.map((e) => [e.x, e.y] as const),
      ...ACCUEIL.health,
      ...ACCUEIL.armor,
      ...ACCUEIL.ammo,
    ];

    for (const [x, y] of points) {
      const z = floorAt(x, y);

      expect(Number.isFinite(z)).toBe(true);
      expect(z).toBeGreaterThanOrEqual(-0.8); // on the courtyard/atrium floor band, never below the map
      expect(z).toBeLessThanOrEqual(0); // flat-floor entities (the dais/keycard is the only raised pickup)
    }
  });

  it('connects spawn → through the (open) door → atrium, and spawn → cubicles (the badge branch)', () => {
    const toAtrium = walkLegs(
      map,
      [ACCUEIL.spawn.x, ACCUEIL.spawn.y],
      [
        [24, 7],
        [31, 9.5],
        [36, 9.5],
        [44, 9],
      ],
    );

    expect(toAtrium.x).toBeGreaterThan(40); // reached deep into the atrium → door slab is passable when open
    expect(floorAt(toAtrium.x, toAtrium.y)).toBe(-0.8);

    const toCubicles = walkLegs(
      map,
      [ACCUEIL.spawn.x, ACCUEIL.spawn.y],
      [
        [24, 7],
        [24, 15],
        [24, 18],
        [24, 23],
      ],
    );

    expect(toCubicles.y).toBeGreaterThan(20); // crossed the north corridor into the cubicles (key branch)
  });

  it('puts the badge in the cubicle branch — reachable WITHOUT crossing the locked door (key before lock)', () => {
    // The door gates the ATRIUM (east); the badge dais is north in the cubicles, so the key is always
    // obtainable before the lock matters.
    expect(ACCUEIL.doors[0].sector).not.toBe(
      locateSubSector(map.root, ACCUEIL.keycards[0][0], ACCUEIL.keycards[0][1]).sector,
    );
  });
});
