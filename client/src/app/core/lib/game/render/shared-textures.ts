import type { Texture } from '../../bsp-engine';

// The render farm clones the whole texture library into EVERY worker (structured clone ×8 ≈ 1.2 GB
// once the voxel doctrine landed). Packing the pixels once into a SharedArrayBuffer and shipping
// VIEWS costs one copy total: the SAB handle crosses postMessage without cloning, and the pixels
// are write-once-then-read, so plain reads after the message need no Atomics (postMessage is the
// happens-before edge).

export interface PackedTextureEntry {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly worldSize?: number;
  readonly voxelDepth?: number;
  readonly offset: number;
}

export interface PackedTextures {
  readonly sab: SharedArrayBuffer;
  readonly entries: readonly PackedTextureEntry[];
}

export function packSharedTextures(textures: ReadonlyMap<string, Texture>): PackedTextures {
  let total = 0;

  for (const texture of textures.values()) {
    total += texture.width * texture.height * 4;
  }
  const sab = new SharedArrayBuffer(total);
  const bytes = new Uint8ClampedArray(sab);
  const entries: PackedTextureEntry[] = [];
  let offset = 0;

  for (const [name, texture] of textures) {
    bytes.set(texture.pixels, offset);
    entries.push({
      name,
      width: texture.width,
      height: texture.height,
      worldSize: texture.worldSize,
      voxelDepth: texture.voxelDepth,
      offset,
    });
    offset += texture.width * texture.height * 4;
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
      pixels: new Uint8ClampedArray(sab, entry.offset, entry.width * entry.height * 4),
    });
  }

  return out;
}
