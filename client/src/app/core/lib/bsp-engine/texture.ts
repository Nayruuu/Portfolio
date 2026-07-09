export interface Texture {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray; // RGBA, row-major, width*height*4
  readonly worldSize?: number; // world units one tile spans (default 1)
  // Present on a carved VOXEL GRID (voxel-carve.ts): pixels are stacked horizontal slices, not a flat
  // image (alpha 0 = empty cell). Marks the entry so the sprite pass renders a voxel VOLUME, not a billboard.
  readonly voxelDepth?: number;
}

export const TEX_WORLD = 1;

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

export function floorTexture(): Texture {
  return tiledTexture(122, 112, 96, 32, 2);
}

export function ceilTexture(): Texture {
  return tiledTexture(60, 63, 72, 16, 1);
}

export function metalTexture(): Texture {
  return tiledTexture(92, 100, 116, 32, 2);
}

export function barrelTexture(): Texture {
  const width = 64;
  const height = 64;
  const pixels = new Uint8ClampedArray(width * height * 4); // all 0 → transparent surround by default

  for (let y = 4; y < 60; y++) {
    for (let x = 16; x < 48; x++) {
      const i = (y * width + x) * 4;
      const band = y % 12 < 2 ? 0.6 : 1;
      const round = x < 22 || x > 42 ? 0.7 : 1;
      const k = band * round;

      pixels[i] = 70 * k;
      pixels[i + 1] = 132 * k;
      pixels[i + 2] = 58 * k;
      pixels[i + 3] = 255;
    }
  }

  return { width, height, pixels };
}

// Drawn when a surface names a texture the library lacks.
export function missingTexture(): Texture {
  const pixels = new Uint8ClampedArray([
    255, 0, 220, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 220, 255,
  ]);

  return { width: 2, height: 2, pixels };
}

// Keyed by the names used in a level's sidedefs/sectors.
export type TextureLibrary = ReadonlyMap<string, Texture>;
