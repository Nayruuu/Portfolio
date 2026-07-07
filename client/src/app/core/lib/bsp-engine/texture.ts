/**
 * A texture = an RGBA bitmap the renderer samples per wall pixel. For now textures are **procedural**
 * (generated in code) so we can see + unit-test texturing without an asset pipeline; loading real images
 * is a later step. Textures tile every {@link TEX_WORLD} world units in both axes.
 */
export interface Texture {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray; // RGBA, row-major, width*height*4
  readonly worldSize?: number; // world units one tile spans (default 1); larger = the art repeats less often
  // Present on a carved VOXEL GRID (see `voxel-carve.ts`): the pixels are not a flat image but stacked
  // horizontal slices — `width` lateral cells × `voxelDepth` depth rows per slice × height/voxelDepth
  // slices bottom-up (alpha 0 = empty cell). Marks the entry so the sprite pass renders its prop as a
  // world-anchored voxel VOLUME instead of a billboard; plain textures never carry it.
  readonly voxelDepth?: number;
}

/** World units spanned by one texture tile (so 1 = the texture repeats every world unit along a wall). */
export const TEX_WORLD = 1;

/** A deterministic 64×64 brick texture: offset brick rows, mortar gaps, subtle per-brick tint. */
export function brickTexture(): Texture {
  const width = 64;
  const height = 64;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const brickH = 16;
  const brickW = 32;
  const mortar = 3;

  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / brickH);
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    const mortarY = y % brickH < mortar;

    for (let x = 0; x < width; x++) {
      const shifted = (x + offset) % brickW;
      const i = (y * width + x) * 4;

      if (mortarY || shifted < mortar) {
        pixels[i] = 94;
        pixels[i + 1] = 90;
        pixels[i + 2] = 84;
      } else {
        const brick = row * 2 + Math.floor((x + offset) / brickW);
        const tint = ((brick * 37) % 24) - 12; // deterministic −12..+11 per brick

        pixels[i] = 150 + tint;
        pixels[i + 1] = 74 + (tint >> 1);
        pixels[i + 2] = 58 + (tint >> 2);
      }
      pixels[i + 3] = 255;
    }
  }

  return { width, height, pixels };
}

/** A deterministic 64×64 grid texture: square tiles of `tile` px with `grout`-px seams + per-tile tint. */
function tiledTexture(
  baseR: number,
  baseG: number,
  baseB: number,
  tile: number,
  grout: number,
): Texture {
  const width = 64;
  const height = 64;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const seam = x % tile < grout || y % tile < grout;

      if (seam) {
        pixels[i] = baseR * 0.6;
        pixels[i + 1] = baseG * 0.6;
        pixels[i + 2] = baseB * 0.6;
      } else {
        const cell = Math.floor(y / tile) * (width / tile) + Math.floor(x / tile);
        const tint = ((cell * 41) % 20) - 10; // deterministic −10..+9 per tile

        pixels[i] = baseR + tint;
        pixels[i + 1] = baseG + tint;
        pixels[i + 2] = baseB + tint;
      }
      pixels[i + 3] = 255;
    }
  }

  return { width, height, pixels };
}

/** A tan stone-tile floor. */
export function floorTexture(): Texture {
  return tiledTexture(122, 112, 96, 32, 2);
}

/** Dark acoustic-panel ceiling. */
export function ceilTexture(): Texture {
  return tiledTexture(60, 63, 72, 16, 1);
}

/** Bluish metal panelling (platform walls + step). */
export function metalTexture(): Texture {
  return tiledTexture(92, 100, 116, 32, 2);
}

/** A 64×64 green barrel SPRITE: opaque body (with hoop bands + cylinder shading), transparent surround. */
export function barrelTexture(): Texture {
  const width = 64;
  const height = 64;
  const pixels = new Uint8ClampedArray(width * height * 4); // all 0 → fully transparent by default

  for (let y = 4; y < 60; y++) {
    for (let x = 16; x < 48; x++) {
      const i = (y * width + x) * 4;
      const band = y % 12 < 2 ? 0.6 : 1; // darker metal hoops
      const round = x < 22 || x > 42 ? 0.7 : 1; // cylinder edge shading
      const k = band * round;

      pixels[i] = 70 * k;
      pixels[i + 1] = 132 * k;
      pixels[i + 2] = 58 * k;
      pixels[i + 3] = 255; // opaque body
    }
  }

  return { width, height, pixels };
}

/** A 2×2 magenta/black "missing texture" — drawn when a surface names a texture the library lacks. */
export function missingTexture(): Texture {
  const pixels = new Uint8ClampedArray([
    255, 0, 220, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 220, 255,
  ]);

  return { width: 2, height: 2, pixels };
}

/** A level's texture assets, keyed by the names used in its sidedefs/sectors. */
export type TextureLibrary = ReadonlyMap<string, Texture>;
