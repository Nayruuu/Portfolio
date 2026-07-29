import { describe, it, expect } from 'vitest';
import { brickTexture, ceilTexture, floorTexture, type Texture } from './texture';
import { expandRgba } from './palettize';

function survey(tex: Texture): { colours: number; opaque: boolean } {
  const rgba = expandRgba(tex);
  const seen = new Set<string>();
  let opaque = true;

  for (let i = 0; i < rgba.length; i += 4) {
    seen.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
    if (rgba[i + 3] !== 255) {
      opaque = false;
    }
  }

  return { colours: seen.size, opaque };
}

describe('brickTexture', () => {
  it('is a 64×64 fully opaque palettized bitmap (1 byte per texel)', () => {
    const tex = brickTexture();
    const rgba = expandRgba(tex);

    expect(tex.width).toBe(64);
    expect(tex.height).toBe(64);
    expect(tex.pixels.length).toBe(64 * 64);
    for (let i = 3; i < rgba.length; i += 4) {
      expect(rgba[i]).toBe(255);
    }
  });

  it('carries both mortar and (tinted) brick pixels', () => {
    const rgba = expandRgba(brickTexture());
    const colours = new Set<string>();
    let mortar = false;

    for (let i = 0; i < rgba.length; i += 4) {
      const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`;

      colours.add(key);
      if (key === '94,90,84') {
        mortar = true;
      }
    }

    expect(mortar).toBe(true);
    expect(colours.size).toBeGreaterThan(4);
  });
});

describe('floor/ceiling textures', () => {
  it('the floor is a tinted, opaque 64×64 tile texture', () => {
    const tex = floorTexture();
    const { colours, opaque } = survey(tex);

    expect(tex.width).toBe(64);
    expect(tex.height).toBe(64);
    expect(opaque).toBe(true);
    expect(colours).toBeGreaterThan(4);
  });

  it('the ceiling is a distinct, opaque tile texture', () => {
    const floor = survey(floorTexture());
    const ceil = survey(ceilTexture());

    expect(ceil.opaque).toBe(true);
    expect(ceil.colours).toBeGreaterThan(4);
    // Compare RESOLVED colours — the first-appearance palette gives both textures index 1 first.
    expect(expandRgba(ceilTexture())[0]).not.toBe(expandRgba(floorTexture())[0]);
    expect(floor.colours).toBeGreaterThan(0);
  });
});
