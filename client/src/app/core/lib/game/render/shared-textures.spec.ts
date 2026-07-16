import { describe, expect, it } from 'vitest';
import { packSharedTextures, unpackSharedTextures } from './shared-textures';
import type { Texture } from '../../bsp-engine';

const tex = (grey: number, extras: Partial<Texture> = {}): Texture => ({
  width: 2,
  height: 2,
  pixels: new Uint8ClampedArray([
    grey,
    0,
    0,
    255,
    0,
    grey,
    0,
    255,
    0,
    0,
    grey,
    255,
    grey,
    grey,
    grey,
    255,
  ]),
  ...extras,
});

describe('packSharedTextures / unpackSharedTextures', () => {
  it('round-trips a library byte-for-byte, metadata included', () => {
    const lib = new Map<string, Texture>([
      ['WALL', tex(10, { worldSize: 4 })],
      ['CHAIR', tex(20, { voxelDepth: 2, worldSize: 1.2 })],
    ]);
    const packed = packSharedTextures(lib);
    const out = unpackSharedTextures(packed.sab, packed.entries);

    expect([...out.keys()]).toEqual(['WALL', 'CHAIR']);
    expect(out.get('WALL')?.worldSize).toBe(4);
    expect(out.get('WALL')?.voxelDepth).toBeUndefined();
    expect(out.get('CHAIR')?.voxelDepth).toBe(2);
    expect(Array.from(out.get('WALL')?.pixels ?? [])).toEqual(Array.from(lib.get('WALL')!.pixels));
    expect(Array.from(out.get('CHAIR')?.pixels ?? [])).toEqual(
      Array.from(lib.get('CHAIR')!.pixels),
    );
  });

  it('backs every unpacked view by the ONE shared buffer — the whole point (no per-worker clone)', () => {
    const packed = packSharedTextures(
      new Map([
        ['A', tex(1)],
        ['B', tex(2)],
      ]),
    );
    const first = unpackSharedTextures(packed.sab, packed.entries);
    const second = unpackSharedTextures(packed.sab, packed.entries);

    expect(first.get('A')?.pixels.buffer).toBe(packed.sab);
    expect(second.get('B')?.pixels.buffer).toBe(packed.sab);
    // shared memory: a write through one consumer's view is seen by the other (textures are
    // write-once in practice — this only PROVES the sharing)
    first.get('A')!.pixels[0] = 77;
    expect(second.get('A')?.pixels[0]).toBe(77);
  });

  it('lays entries out back-to-back with no overlap', () => {
    const packed = packSharedTextures(
      new Map([
        ['A', tex(1)],
        ['B', tex(2)],
      ]),
    );

    expect(packed.entries[0].offset).toBe(0);
    expect(packed.entries[1].offset).toBe(16); // 2×2×4 bytes
    expect(packed.sab.byteLength).toBe(32);
  });

  it('packs an empty library into an empty (but valid) buffer', () => {
    const packed = packSharedTextures(new Map());

    expect(packed.entries).toHaveLength(0);
    expect(unpackSharedTextures(packed.sab, packed.entries).size).toBe(0);
  });
});
