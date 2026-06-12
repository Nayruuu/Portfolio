import { describe, it, expect } from 'vitest';
import { heightify } from './heightify';
import { generateLevel } from './generate-level';
import { THEME_CYCLE } from './levels';
import { STEP_UP_MAX, PLAYER_HEIGHT } from './sector';
import type { Level } from './levels';

const SEEDS = Array.from({ length: 21 }, (_, s) => s); // 0..20
const THEME = THEME_CYCLE[0];

/** A flat level for `seed`, plus its heightified twin — the two specs compare. */
function pair(seed: number): { flat: Level; hh: Level } {
  const flat = generateLevel(seed, THEME, seed % 5); // vary depth too (key/door layout differs)

  return { flat, hh: heightify(flat) };
}

describe('heightify', () => {
  it('keeps every ADJACENT open-floor step ≤ STEP_UP_MAX (the reachability invariant)', () => {
    let maxDelta = 0;

    for (const seed of SEEDS) {
      const { flat, hh } = pair(seed);
      const { width, height, cells, sectors, sectorId } = hh.map;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;

          if (cells[i] !== 0) {
            continue; // only open-floor cells matter for walkability
          }
          const floorZ = sectors![sectorId![i]].floorZ;

          for (const [nx, ny] of [
            [x + 1, y],
            [x, y + 1],
          ]) {
            if (nx >= width || ny >= height) {
              continue;
            }
            const ni = ny * width + nx;

            if (cells[ni] !== 0) {
              continue; // the neighbour must also be open floor
            }
            const delta = Math.abs(floorZ - sectors![sectorId![ni]].floorZ);

            maxDelta = Math.max(maxDelta, delta);
            expect(delta).toBeLessThanOrEqual(STEP_UP_MAX);
          }
        }
      }

      expect(flat).toBeDefined(); // (flat is the comparison baseline used by the other specs)
    }

    expect(maxDelta).toBeGreaterThan(0); // the field is genuinely varied, not all-zero
    expect(maxDelta).toBeLessThanOrEqual(STEP_UP_MAX);
  });

  it('gives every sector at least PLAYER_HEIGHT of ceiling clearance', () => {
    for (const seed of SEEDS) {
      const { hh } = pair(seed);

      for (const sector of hh.map.sectors!) {
        expect(sector.ceilZ - sector.floorZ).toBeGreaterThanOrEqual(PLAYER_HEIGHT);
      }
    }
  });

  it('actually varies the heights (not a flat no-op): some sector sits above the base', () => {
    for (const seed of SEEDS) {
      const { hh } = pair(seed);

      expect(hh.map.sectors!.some((sector) => sector.floorZ !== 0)).toBe(true);
    }
  });

  it('mirrors the per-cell flats into each cell sector floorMat/ceilMat', () => {
    const { hh } = pair(0);
    const { cells, sectors, sectorId } = hh.map;

    for (let i = 0; i < cells.length; i++) {
      const sector = sectors![sectorId![i]];

      expect(sector.floorMat).toBe(hh.floorFlats[i]);
      expect(sector.ceilMat).toBe(hh.ceilFlats[i]);
    }
  });

  it('leaves EVERYTHING but sectors/sectorId untouched (cells, flats, spawn, enemies, keys)', () => {
    for (const seed of SEEDS) {
      const { flat, hh } = pair(seed);

      expect(hh.map.cells).toBe(flat.map.cells); // same reference — not rebuilt
      expect(hh.map.diagonals).toBe(flat.map.diagonals);
      expect(hh.floorFlats).toBe(flat.floorFlats);
      expect(hh.ceilFlats).toBe(flat.ceilFlats);
      expect(hh.spawn).toBe(flat.spawn);
      expect(hh.enemies.length).toBe(flat.enemies.length);
      expect(hh.enemies).toEqual(flat.enemies);
      expect(hh.pickups).toEqual(flat.pickups);
      expect(hh.ammoSpawns).toEqual(flat.ammoSpawns);
      expect(hh.keys).toEqual(flat.keys);
      expect(hh.theme).toBe(flat.theme);
    }
  });

  it('only swaps the sector layer — sectorId is rebuilt, height-varied (not the flat table)', () => {
    const { flat, hh } = pair(0);

    expect(hh.map.sectorId).not.toBe(flat.map.sectorId); // a new table
    expect(hh.map.sectorId).toHaveLength(hh.map.cells.length);
    expect(hh.map.sectors).not.toBe(flat.map.sectors);
    // the flat input was all floorZ 0; the heightified output is not:
    expect(flat.map.sectors!.every((sector) => sector.floorZ === 0)).toBe(true);
    expect(hh.map.sectors!.some((sector) => sector.floorZ !== 0)).toBe(true);
  });

  it('does not mutate the input level (immutability)', () => {
    const flat = generateLevel(7, THEME, 2);
    const sectorsBefore = flat.map.sectors;
    const sectorIdBefore = flat.map.sectorId;
    const snapshot = JSON.parse(JSON.stringify(flat.map.sectors));

    heightify(flat);

    expect(flat.map.sectors).toBe(sectorsBefore); // same reference, unchanged
    expect(flat.map.sectorId).toBe(sectorIdBefore);
    expect(flat.map.sectors).toEqual(snapshot); // contents untouched
  });

  it('is deterministic — same input yields an identical sector layout', () => {
    const flat = generateLevel(3, THEME, 1);
    const a = heightify(flat);
    const b = heightify(flat);

    expect(a.map.sectors).toEqual(b.map.sectors);
    expect(a.map.sectorId).toEqual(b.map.sectorId);
  });

  it('dedupes sectors — fewer sectors than cells (the reuse path), parallel to cells', () => {
    const { hh } = pair(0);

    expect(hh.map.sectors!.length).toBeGreaterThan(0);
    expect(hh.map.sectors!.length).toBeLessThan(hh.map.cells.length); // many cells share a sector
    expect(hh.map.sectorId!.every((id) => id >= 0 && id < hh.map.sectors!.length)).toBe(true);
  });
});
