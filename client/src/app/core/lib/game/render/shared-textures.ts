import { PALETTE_BYTES, type Texture } from '../../bsp-engine';

// The render farm clones the whole texture library into EVERY worker (structured clone ×8 ≈ 1.2 GB
// once the voxel doctrine landed). Packing the pixels once into a SharedArrayBuffer and shipping
// VIEWS costs one copy total: the SAB handle crosses postMessage without cloning, and the pixels
// are write-once-then-read, so plain reads after the message need no Atomics (postMessage is the
// happens-before edge). Layout per texture: width×height index bytes, then its 1024 B palette.

export interface PackedTextureEntry {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly worldSize?: number;
  readonly voxelDepth?: number;
  readonly offset: number; // first index byte in the SAB
  readonly paletteOffset: number; // first palette byte (PALETTE_BYTES long)
}

export interface PackedTextures {
  readonly sab: SharedArrayBuffer;
  readonly entries: readonly PackedTextureEntry[];
}

export function packSharedTextures(textures: ReadonlyMap<string, Texture>): PackedTextures {
  let total = 0;

  for (const texture of textures.values()) {
    total += texture.width * texture.height + PALETTE_BYTES;
  }
  const sab = new SharedArrayBuffer(total);
  const bytes = new Uint8ClampedArray(sab);
  const entries: PackedTextureEntry[] = [];
  let offset = 0;

  for (const [name, texture] of textures) {
    const paletteOffset = offset + texture.width * texture.height;

    bytes.set(texture.pixels, offset);
    bytes.set(texture.palette, paletteOffset);
    entries.push({
      name,
      width: texture.width,
      height: texture.height,
      worldSize: texture.worldSize,
      voxelDepth: texture.voxelDepth,
      offset,
      paletteOffset,
    });
    offset = paletteOffset + PALETTE_BYTES;
  }

  return { sab, entries };
}

export function unpackSharedTextures(
  sab: SharedArrayBuffer,
  entries: readonly PackedTextureEntry[],
): Map<string, Texture> {
  const out = new Map<string, Texture>();

  for (const entry of entries) {
    out.set(entry.name, {
      width: entry.width,
      height: entry.height,
      worldSize: entry.worldSize,
      voxelDepth: entry.voxelDepth,
      pixels: new Uint8ClampedArray(sab, entry.offset, entry.width * entry.height),
      palette: new Uint8ClampedArray(sab, entry.paletteOffset, PALETTE_BYTES),
    });
  }

  return out;
}
