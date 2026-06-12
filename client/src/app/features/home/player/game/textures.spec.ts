import { describe, it, expect } from 'vitest';
import { WALL_HEIGHT } from '../../../../core/lib';
import {
  ENV_TEXTURES,
  FLAT_TILE_WORLD_SIZE,
  WALL_TILE_WORLD_WIDTH,
  textureById,
  textureForSurface,
  wallTileWorldWidth,
} from './textures';

describe('environment textures bridge', () => {
  it('parses wall_techbase from the manifest with the defaults folded in', () => {
    const wall = textureForSurface('wall');

    expect(wall).toBeDefined();
    expect(wall?.id).toBe('wall_techbase');
    expect(wall?.file).toBe('/game/textures/wall_techbase_512x256.webp'); // served URL (defaults prefix)
    expect(wall?.width).toBe(512);
    expect(wall?.height).toBe(256);
    expect(wall?.tile).toBe('horizontal'); // full-height panel, repeats along U only
    expect(wall?.hasAlpha).toBe(false); // opaque (no transparent pass)
    expect(wall?.emissive).toBe(false); // not full-bright
    expect(wall?.nearest).toBe(true); // default filter = nearest (retro)
  });

  it('parses the tile:both floor + ceiling and the alpha glass surface', () => {
    const ceiling = textureForSurface('ceiling');
    const floor = textureForSurface('floor');
    const glass = textureForSurface('glass_partition');

    expect(ceiling?.tile).toBe('both'); // ceiling field repeats on U and V
    expect(floor?.tile).toBe('both'); // floor field repeats on U and V
    expect(glass?.tile).toBe('horizontal'); // panes line up side by side
    expect(glass?.hasAlpha).toBe(true); // transparent pane → drawn in the alpha pass
  });

  it('resolves the now-present wall + ceiling variants by id, with their flags folded in', () => {
    // Every variant is delivered (present:true), so each resolves by id with the right tiling/emissive.
    expect(textureById('wall_cubicle')?.surface).toBe('wall');
    expect(textureById('wall_damaged')?.tile).toBe('horizontal');
    expect(textureById('wall_servers')?.emissive).toBe(true); // glowing LEDs → full-bright
    expect(textureById('wall_servers_b')?.emissive).toBe(true); // denser rack variant, also emissive
    expect(textureById('wall_door')?.tile).toBe('none'); // unique airlock segment, placed once
    expect(textureById('ceiling_neon_broken')?.emissive).toBe(true);
    // The base textures still resolve by id too.
    expect(textureById('wall_techbase')?.surface).toBe('wall');
    expect(textureById('floor_techbase')?.surface).toBe('floor');
  });

  it('still drops a `present:false` entry (the loader guard survives even with the manifest fully delivered)', () => {
    // No manifest entry is dormant today, but the `present !== false` filter is what lets a future variant
    // ship as a planned-but-ungenerated stub. A made-up id stays absent regardless.
    expect(textureById('wall_does_not_exist')).toBeUndefined();
  });

  it('returns undefined for a surface / id the manifest does not declare', () => {
    expect(textureForSurface('lava')).toBeUndefined();
    expect(textureById('wall_does_not_exist')).toBeUndefined();
  });

  it('derives the square-pixel horizontal tile width: aspect × wall height', () => {
    // 512×256 = 2:1, on a WALL_HEIGHT-tall wall → one tile spans 2 × 1.4 = 2.8 cells, keeping pixels square.
    expect(WALL_TILE_WORLD_WIDTH).toBeCloseTo(2 * WALL_HEIGHT, 5);
    expect(wallTileWorldWidth(textureForSurface('wall'))).toBeCloseTo(2.8, 5);
  });

  it('falls back to a 1:1 (per-cell) tile when no wall texture is given', () => {
    expect(wallTileWorldWidth(undefined)).toBeCloseTo(WALL_HEIGHT, 5);
  });

  it('matches the floor/ceiling tile size to the wall texel density (uniform pixel scale)', () => {
    // floor + wall are both 512 px wide → one floor/ceiling tile spans the same world width as a wall tile.
    expect(FLAT_TILE_WORLD_SIZE).toBeCloseTo(WALL_TILE_WORLD_WIDTH, 5);
  });

  it('exposes every PRESENT entry as a parsed descriptor (the full 19-texture manifest is delivered)', () => {
    // All 19 manifest entries are present:true now — 7 `wall` materials + 4 `wall_door` (the base airlock +
    // 3 coloured locked-door variants), 5 ceilings, 1 floor and 2 glass panes. All files are served from /game/.
    expect(ENV_TEXTURES.length).toBe(19);
    expect(ENV_TEXTURES.every((texture) => texture.file.startsWith('/game/'))).toBe(true);
  });

  it('resolves each arted LOCKED-DOOR variant by id (the keycard-coloured doors)', () => {
    for (const color of ['red', 'blue', 'yellow']) {
      const door = textureById(`wall_door_${color}`);

      expect(door?.surface).toBe('wall_door'); // same surface kind as the base airlock, selected by id
      expect(door?.tile).toBe('none'); // a unique per-cell segment, never tiled
    }
    // The base unlocked airlock is still the FIRST wall_door surface (unaffected by the locked variants).
    expect(textureForSurface('wall_door')?.id).toBe('wall_door');
  });
});
