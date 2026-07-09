import { describe, it, expect } from 'vitest';
import { buildBsp } from './node-builder';
import {
  mapSprites,
  projectSprites,
  renderFrame,
  type Sprite,
  type ZoneNeighbor,
} from './renderer';
import {
  barrelTexture,
  brickTexture,
  ceilTexture,
  floorTexture,
  metalTexture,
  type Texture,
} from './texture';
import { SAMPLE_MAP } from './sample-map';
import { focalFor, type Camera } from './camera';
import type { CompiledMap, MapSource, SideDef } from './types';

const MAP = buildBsp(SAMPLE_MAP);
const TEX = new Map([
  ['BRICK', brickTexture()],
  ['METAL', metalTexture()],
  ['FLOOR', floorTexture()],
  ['STEP', metalTexture()],
  ['CEIL', ceilTexture()],
  ['BARREL', barrelTexture()],
]);

function hasGreen(buf: Uint8ClampedArray): boolean {
  for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
    const r = buf[p * 4];
    const g = buf[p * 4 + 1];
    const b = buf[p * 4 + 2];

    if (g > r + 15 && g > b + 15 && g > 50) {
      return true;
    }
  }

  return false;
}
const CONFIG = { width: 120, height: 80, fov: Math.PI / 2 };

function pixel(buf: Uint8ClampedArray, x: number, y: number): [number, number, number, number] {
  const i = (y * CONFIG.width + x) * 4;

  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}

function coloursIn(buf: Uint8ClampedArray, y0: number, y1: number): number {
  const seen = new Set<string>();

  for (let y = Math.floor(y0); y < y1; y++) {
    for (let x = 0; x < CONFIG.width; x += 2) {
      seen.add(pixel(buf, x, y).slice(0, 3).join(','));
    }
  }

  return seen.size;
}

describe('renderFrame', () => {
  it('produces a fully opaque RGBA buffer of the right size', () => {
    const buf = renderFrame(MAP, { x: 4, y: 5, angle: 0.3, z: 1.6 }, CONFIG, TEX);

    expect(buf.length).toBe(CONFIG.width * CONFIG.height * 4);
    for (let i = 3; i < buf.length; i += 4) {
      expect(buf[i]).toBe(255);
    }
  });

  it('renders in place into provided target + z-buffer (no allocation)', () => {
    const target = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);
    const zbuf = new Float32Array(CONFIG.width * CONFIG.height);
    const out = renderFrame(MAP, { x: 4, y: 5, angle: 0.3, z: 1.6 }, CONFIG, TEX, target, zbuf);

    expect(out).toBe(target);
    expect(target[3]).toBe(255);
  });

  it('keeps a steep look-down (horizon off the top) inside its render band — no fill overflow', () => {
    const target = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4).fill(7);
    const zbuf = new Float32Array(CONFIG.width * CONFIG.height);

    renderFrame(
      MAP,
      { x: 4, y: 5, angle: 0.3, z: 1.6, pitch: -2 },
      CONFIG,
      TEX,
      target,
      zbuf,
      30,
      50,
    );

    expect(pixel(target, 10, 10)).toEqual([7, 7, 7, 7]);
    expect(pixel(target, 10, 70)).toEqual([7, 7, 7, 7]);
    expect(pixel(target, 60, 40)[3]).toBe(255);
  });

  it('falls back to the MISSING texture for surface names absent from the library', () => {
    const empty = new Map();
    const cam = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const buf = renderFrame(MAP, cam, CONFIG, empty);

    expect(buf.length).toBe(CONFIG.width * CONFIG.height * 4);
    for (let i = 3; i < buf.length; i += 4) {
      expect(buf[i]).toBe(255);
    }
    expect(Array.from(buf)).not.toEqual(Array.from(renderFrame(MAP, cam, CONFIG, TEX)));
  });

  it("renders a 'SKY' ceiling as a blue gradient instead of a textured flat", () => {
    const sky = buildBsp({
      ...SAMPLE_MAP,
      sectors: SAMPLE_MAP.sectors.map((s, i) => (i === 0 ? { ...s, ceilTex: 'SKY' } : s)),
    });
    const buf = renderFrame(sky, { x: 4, y: 5, angle: 0.3, z: 1.6 }, CONFIG, TEX);
    let foundSky = false;

    for (let y = 0; y < CONFIG.height >> 1; y++) {
      for (let x = 0; x < CONFIG.width; x++) {
        const px = pixel(buf, x, y);

        if (px[2] > px[0] + 40) {
          foundSky = true;
        }
      }
    }
    expect(foundSky).toBe(true);
  });

  it('washes a cool GLASS tint over a see-through pane (blended over the back sector)', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'BRICK',
    });
    const corridor = (glass: boolean): MapSource => ({
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 8 },
        { x: 8, y: 8 },
        { x: 0, y: 16 },
        { x: 8, y: 16 },
      ],
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0), back: null },
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass },
        { v1: 3, v2: 1, front: tex(0), back: null },
        { v1: 1, v2: 0, front: tex(0), back: null },
        { v1: 2, v2: 4, front: tex(1), back: null },
        { v1: 4, v2: 5, front: tex(1), back: null },
        { v1: 5, v2: 3, front: tex(1), back: null },
      ],
      things: [],
    });
    const cam: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
    const plain = renderFrame(buildBsp(corridor(false)), cam, CONFIG, TEX);
    const glassed = renderFrame(buildBsp(corridor(true)), cam, CONFIG, TEX);

    expect(Array.from(glassed)).not.toEqual(Array.from(plain));
    let cooler = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const dPlain = plain[p * 4 + 2] - plain[p * 4];
      const dGlass = glassed[p * 4 + 2] - glassed[p * 4];

      if (dGlass > dPlain + 12) {
        cooler = true;
        break;
      }
    }
    expect(cooler).toBe(true);
  });

  it('two STACKED glass panes: the one behind does not overwrite the nearer one (no break)', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'BRICK',
    });
    const stacked = (glass: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
      ],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
        { x: 0, y: 12 },
        { x: 8, y: 12 },
        { x: 0, y: 18 },
        { x: 8, y: 18 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0), back: null },
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass },
        { v1: 3, v2: 1, front: tex(0), back: null },
        { v1: 1, v2: 0, front: tex(0), back: null },
        { v1: 2, v2: 4, front: tex(1), back: null },
        { v1: 4, v2: 5, front: tex(1), back: tex(2), glass },
        { v1: 5, v2: 3, front: tex(1), back: null },
        { v1: 4, v2: 6, front: tex(2), back: null },
        { v1: 6, v2: 7, front: tex(2), back: null },
        { v1: 7, v2: 5, front: tex(2), back: null },
      ],
    });
    const cam: Camera = { x: 4, y: 3, angle: Math.PI / 2, z: 1.6 };
    const glazed = renderFrame(buildBsp(stacked(true)), cam, CONFIG, TEX);

    for (let i = 3; i < glazed.length; i += 4) {
      expect(glazed[i]).toBe(255);
    }
    expect(Array.from(glazed)).not.toEqual(
      Array.from(renderFrame(buildBsp(stacked(false)), cam, CONFIG, TEX)),
    );
  });

  it('LAYERED glass: an inner sliding door still shows its leaf THROUGH the outer door (the entrance sas)', () => {
    const tex = (sector: number, middleTex: string): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex,
    });
    const clearLeaf = { width: 2, height: 2, pixels: new Uint8ClampedArray(16) };
    const greenLeaf = {
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray([
        30, 220, 30, 255, 30, 220, 30, 255, 30, 220, 30, 255, 30, 220, 30, 255,
      ]),
    };
    const TEXD = new Map(TEX).set('CLEARLEAF', clearLeaf).set('GREENLEAF', greenLeaf);
    const map = buildBsp({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
      ],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
        { x: 0, y: 12 },
        { x: 8, y: 12 },
        { x: 0, y: 18 },
        { x: 8, y: 18 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0, 'BRICK'), back: null },
        {
          v1: 2,
          v2: 3,
          front: tex(0, 'CLEARLEAF'),
          back: tex(1, 'CLEARLEAF'),
          glass: true,
          sliding: true,
        },
        { v1: 3, v2: 1, front: tex(0, 'BRICK'), back: null },
        { v1: 1, v2: 0, front: tex(0, 'BRICK'), back: null },
        { v1: 2, v2: 4, front: tex(1, 'BRICK'), back: null },
        {
          v1: 4,
          v2: 5,
          front: tex(1, 'GREENLEAF'),
          back: tex(2, 'GREENLEAF'),
          glass: true,
          sliding: true,
        },
        { v1: 5, v2: 3, front: tex(1, 'BRICK'), back: null },
        { v1: 4, v2: 6, front: tex(2, 'BRICK'), back: null },
        { v1: 6, v2: 7, front: tex(2, 'BRICK'), back: null },
        { v1: 7, v2: 5, front: tex(2, 'BRICK'), back: null },
      ],
    });
    const buf = renderFrame(map, { x: 4, y: 3, angle: Math.PI / 2, z: 1.6 }, CONFIG, TEXD);
    let green = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (buf[i + 1] > 150 && buf[i] < 100 && buf[i + 2] < 100) {
        green = true;
        break;
      }
    }
    expect(green).toBe(true);
  });

  it('caps the stack at GLASS_LAYERS: a fifth aligned pane is dropped without breaking the render', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'BRICK',
    });
    const sector = { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 };
    const vertices = [];
    const linedefs = [];

    for (let r = 0; r <= 6; r++) {
      vertices.push({ x: 0, y: r * 4 }, { x: 8, y: r * 4 });
    }
    for (let r = 0; r < 6; r++) {
      linedefs.push(
        { v1: 2 * r, v2: 2 * r + 2, front: tex(r), back: null },
        { v1: 2 * r + 3, v2: 2 * r + 1, front: tex(r), back: null },
      );
      if (r > 0) {
        linedefs.push({ v1: 2 * r, v2: 2 * r + 1, front: tex(r - 1), back: tex(r), glass: true });
      }
    }
    linedefs.push({ v1: 1, v2: 0, front: tex(0), back: null });
    linedefs.push({ v1: 12, v2: 13, front: tex(5), back: null });
    const map = buildBsp({
      sectors: Array.from({ length: 6 }, () => sector),
      things: [],
      vertices,
      linedefs,
    });
    const buf = renderFrame(map, { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 }, CONFIG, TEX);

    for (let i = 3; i < buf.length; i += 4) {
      expect(buf[i]).toBe(255);
    }

    const band = renderFrame(map, { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 }, CONFIG, TEX, undefined, undefined, 0, 1); // prettier-ignore

    expect(band[3]).toBe(255);
  });

  it('does NOT tint a sprite standing IN FRONT of a pane (only layers nearer than the sprite tint it)', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'BRICK',
    });
    const red = {
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray([
        255, 20, 20, 255, 255, 20, 20, 255, 255, 20, 20, 255, 255, 20, 20, 255,
      ]),
    };
    const TEXR = new Map(TEX).set('REDSPR', red);
    const scene = (glass: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
      ],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
        { x: 0, y: 12 },
        { x: 8, y: 12 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0), back: null },
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass },
        { v1: 3, v2: 1, front: tex(0), back: null },
        { v1: 1, v2: 0, front: tex(0), back: null },
        { v1: 2, v2: 4, front: tex(1), back: null },
        { v1: 4, v2: 5, front: tex(1), back: null },
        { v1: 5, v2: 3, front: tex(1), back: null },
      ],
    });
    const cam: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
    const spr: Sprite = { x: 4, y: 4.5, z: 0, tex: 'REDSPR', width: 2, height: 2.5 };
    const glazed = renderFrame(buildBsp(scene(true)), cam, CONFIG, TEXR, undefined, undefined, undefined, undefined, [spr]); // prettier-ignore
    const plain = renderFrame(buildBsp(scene(false)), cam, CONFIG, TEXR, undefined, undefined, undefined, undefined, [spr]); // prettier-ignore
    let sawRed = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (plain[i] > 230 && plain[i + 1] < 50 && plain[i + 2] < 50) {
        sawRed = true;
        expect(glazed[i]).toBe(plain[i]);
        expect(glazed[i + 2]).toBe(plain[i + 2]);
      }
    }
    expect(sawRed).toBe(true);
  });

  it("does NOT tint a sprite OUTSIDE a nearer pane's span (floating in the open sky above the window)", () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'BRICK',
    });
    const red = {
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray([
        255, 20, 20, 255, 255, 20, 20, 255, 255, 20, 20, 255, 255, 20, 20, 255,
      ]),
    };
    const TEXR = new Map(TEX).set('REDSPR', red);
    const scene = (glass: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'SKY', light: 255 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
      ],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
        { x: 0, y: 12 },
        { x: 8, y: 12 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0), back: null },
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass },
        { v1: 3, v2: 1, front: tex(0), back: null },
        { v1: 1, v2: 0, front: tex(0), back: null },
        { v1: 2, v2: 4, front: tex(1), back: null },
        { v1: 4, v2: 5, front: tex(1), back: null },
        { v1: 5, v2: 3, front: tex(1), back: null },
      ],
    });
    const cam: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
    const spr: Sprite = { x: 4, y: 9, z: 6, tex: 'REDSPR', width: 2, height: 2 };
    const glazed = renderFrame(buildBsp(scene(true)), cam, CONFIG, TEXR, undefined, undefined, undefined, undefined, [spr]); // prettier-ignore
    const plain = renderFrame(buildBsp(scene(false)), cam, CONFIG, TEXR, undefined, undefined, undefined, undefined, [spr]); // prettier-ignore
    let sawRed = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (plain[i] > 190 && plain[i + 1] < 50 && plain[i + 2] < 50) {
        sawRed = true;
        expect(glazed[i + 2]).toBe(plain[i + 2]);
      }
    }
    expect(sawRed).toBe(true);
  });

  it('a glass pane does not paint over NEARER geometry — a raised counter in front of it', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'BRICK',
    });
    const withCounter = (counter: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
        { floorZ: 1.2, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 220 },
      ],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
        { x: 0, y: 12 },
        { x: 8, y: 12 },
        { x: 2, y: 3 },
        { x: 6, y: 3 },
        { x: 6, y: 4 },
        { x: 2, y: 4 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0), back: null },
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass: true },
        { v1: 3, v2: 1, front: tex(0), back: null },
        { v1: 1, v2: 0, front: tex(0), back: null },
        { v1: 2, v2: 4, front: tex(1), back: null },
        { v1: 4, v2: 5, front: tex(1), back: null },
        { v1: 5, v2: 3, front: tex(1), back: null },
        ...(counter
          ? [
              { v1: 6, v2: 9, front: tex(2), back: tex(0) },
              { v1: 9, v2: 8, front: tex(2), back: tex(0) },
              { v1: 8, v2: 7, front: tex(2), back: tex(0) },
              { v1: 7, v2: 6, front: tex(2), back: tex(0) },
            ]
          : []),
      ],
    });
    const cam: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
    const buf = renderFrame(buildBsp(withCounter(true)), cam, CONFIG, TEX);

    for (let i = 3; i < buf.length; i += 4) {
      expect(buf[i]).toBe(255);
    }
    expect(Array.from(buf)).not.toEqual(
      Array.from(renderFrame(buildBsp(withCounter(false)), cam, CONFIG, TEX)),
    );
  });

  it('a glass PANE samples its texture like a door leaf (opaque texels stamped, not a flat tint)', () => {
    const tex = (sector: number, middleTex: string): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex,
    });
    const paneTex = {
      width: 4,
      height: 4,
      pixels: new Uint8ClampedArray([
        30, 220, 30, 255, 30, 220, 30, 255, 30, 220, 30, 255, 30, 220, 30, 255, 30, 220, 30, 255,
        30, 220, 30, 255, 30, 220, 30, 255, 30, 220, 30, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    };
    const TEXD = new Map(TEX).set('PANE', paneTex);
    const map = buildBsp({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
      ],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
        { x: 0, y: 14 },
        { x: 8, y: 14 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0, 'BRICK'), back: null },
        { v1: 2, v2: 3, front: tex(0, 'PANE'), back: tex(1, 'PANE'), glass: true, pane: true },
        { v1: 3, v2: 1, front: tex(0, 'BRICK'), back: null },
        { v1: 1, v2: 0, front: tex(0, 'BRICK'), back: null },
        { v1: 2, v2: 4, front: tex(1, 'BRICK'), back: null },
        { v1: 4, v2: 5, front: tex(1, 'BRICK'), back: null },
        { v1: 5, v2: 3, front: tex(1, 'BRICK'), back: null },
      ],
    });
    const buf = renderFrame(map, { x: 4, y: 3, angle: Math.PI / 2, z: 1.6 }, CONFIG, TEXD);
    let green = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (buf[i + 1] > 150 && buf[i] < 100 && buf[i + 2] < 100) {
        green = true;
        break;
      }
    }
    expect(green).toBe(true);
  });

  it('washes the cool glass tint over a SPRITE seen through a pane (an enemy behind glass, not full colour)', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'BRICK',
    });
    const red = {
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray([
        255, 20, 20, 255, 255, 20, 20, 255, 255, 20, 20, 255, 255, 20, 20, 255,
      ]),
    };
    const TEXR = new Map(TEX).set('REDSPR', red);
    const scene = (glass: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 },
      ],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
        { x: 0, y: 14 },
        { x: 8, y: 14 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0), back: null },
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass },
        { v1: 3, v2: 1, front: tex(0), back: null },
        { v1: 1, v2: 0, front: tex(0), back: null },
        { v1: 2, v2: 4, front: tex(1), back: null },
        { v1: 4, v2: 5, front: tex(1), back: null },
        { v1: 5, v2: 3, front: tex(1), back: null },
      ],
    });
    const cam: Camera = { x: 4, y: 3, angle: Math.PI / 2, z: 1.6 };
    const spr: Sprite = { x: 4, y: 9, z: 0, tex: 'REDSPR', width: 2, height: 2.5 };
    const glazed = renderFrame(buildBsp(scene(true)), cam, CONFIG, TEXR, undefined, undefined, undefined, undefined, [spr]); // prettier-ignore
    const plain = renderFrame(buildBsp(scene(false)), cam, CONFIG, TEXR, undefined, undefined, undefined, undefined, [spr]); // prettier-ignore
    let tinted = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (
        plain[i] > 230 &&
        plain[i + 1] < 50 &&
        plain[i + 2] < 50 &&
        glazed[i + 2] > plain[i + 2] + 8
      ) {
        tinted = true;
        break;
      }
    }
    expect(tinted).toBe(true);
  });

  it('retracts a SLIDING glass panel as it opens (more open → less of the pane is tinted)', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'DOORGLASS',
    });
    const doorGlass = {
      width: 2,
      height: 2,
      worldSize: 4,
      pixels: new Uint8ClampedArray([90, 90, 90, 255, 0, 0, 0, 0, 0, 0, 0, 0, 90, 90, 90, 255]),
    };
    const TEXD = new Map(TEX).set('DOORGLASS', doorGlass);
    const doorMap = buildBsp({
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 8 },
        { x: 8, y: 8 },
        { x: 0, y: 16 },
        { x: 8, y: 16 },
      ],
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0), back: null },
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass: true, sliding: true },
        { v1: 3, v2: 1, front: tex(0), back: null },
        { v1: 1, v2: 0, front: tex(0), back: null },
        { v1: 2, v2: 4, front: tex(1), back: null },
        { v1: 4, v2: 5, front: tex(1), back: null },
        { v1: 5, v2: 3, front: tex(1), back: null },
      ],
      things: [],
    });
    const cam: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
    const at = (open: number): Uint8ClampedArray =>
      renderFrame(doorMap, cam, CONFIG, TEXD, undefined, undefined, 0, CONFIG.height, undefined, [
        0,
        open,
        0,
        0,
        0,
        0,
        0,
      ]);
    const openFull = at(1);
    const tintedVs = (buf: Uint8ClampedArray): number => {
      let n = 0;

      for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
        const i = p * 4;

        if (
          buf[i] !== openFull[i] ||
          buf[i + 1] !== openFull[i + 1] ||
          buf[i + 2] !== openFull[i + 2]
        ) {
          n++;
        }
      }

      return n;
    };

    expect(tintedVs(at(0))).toBeGreaterThan(tintedVs(at(0.5)));
    expect(tintedVs(at(0.5))).toBeGreaterThan(0);
    expect(tintedVs(renderFrame(doorMap, cam, CONFIG, TEXD))).toBeGreaterThan(0);

    const shut = at(0);
    const row = CONFIG.height >> 1;
    const isCovered = (x: number): boolean => {
      const i = (row * CONFIG.width + x) * 4;

      return (
        shut[i] !== openFull[i] ||
        shut[i + 1] !== openFull[i + 1] ||
        shut[i + 2] !== openFull[i + 2]
      );
    };
    let lo = -1;
    let hi = -1;

    for (let x = 0; x < CONFIG.width; x++) {
      if (isCovered(x)) {
        lo = lo < 0 ? x : lo;
        hi = x;
      }
    }

    let hole = false;

    for (let x = lo; x <= hi; x++) {
      hole = hole || !isCovered(x);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hole).toBe(false);
  });

  it('textures the whole view — ceiling, walls and floor are all cast/sampled (no flat bands)', () => {
    const buf = renderFrame(MAP, { x: 4, y: 5, angle: 0.3, z: 1.6 }, CONFIG, TEX);

    expect(coloursIn(buf, 0, CONFIG.height * 0.3)).toBeGreaterThan(4);
    expect(coloursIn(buf, CONFIG.height * 0.4, CONFIG.height * 0.6)).toBeGreaterThan(4);
    expect(coloursIn(buf, CONFIG.height * 0.7, CONFIG.height)).toBeGreaterThan(4);
  });

  it('selects per-surface textures: brick room walls vs the metal platform (its step/canopy bands)', () => {
    const buf = renderFrame(MAP, { x: 2, y: 5, angle: 0.2, z: 1.4 }, CONFIG, TEX);
    let metal = false;
    let brick = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const r = buf[p * 4];
      const b = buf[p * 4 + 2];

      if (b > r + 15 && b > 70) {
        metal = true;
      }
      if (r > b + 50 && r > 70) {
        brick = true;
      }
    }

    expect(metal).toBe(true);
    expect(brick).toBe(true);
  });

  it('scales a flat texture by its worldSize (tiles at a larger world period)', () => {
    const cam = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const base = renderFrame(MAP, cam, CONFIG, TEX);
    const scaled = new Map(TEX);

    scaled.set('FLOOR', { ...floorTexture(), worldSize: 4 });
    const out = renderFrame(MAP, cam, CONFIG, scaled);

    expect(Array.from(out)).not.toEqual(Array.from(base));
  });

  it('scales a wall texture by its worldSize (one full-height panel, not a vertical repeat)', () => {
    const cam = { x: 2, y: 5, angle: 0.2, z: 1.4 };
    const base = renderFrame(MAP, cam, CONFIG, TEX);
    const scaled = new Map(TEX);

    scaled.set('BRICK', { ...brickTexture(), worldSize: 4 });
    const out = renderFrame(MAP, cam, CONFIG, scaled);

    expect(Array.from(out)).not.toEqual(Array.from(base));
  });

  it('renders in row bands that tile into the identical whole frame (the worker split)', () => {
    const cam = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const whole = renderFrame(MAP, cam, CONFIG, TEX);
    const banded = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);
    const zb = new Float32Array(CONFIG.width * CONFIG.height);
    const mid = Math.floor(CONFIG.height / 2);

    renderFrame(MAP, cam, CONFIG, TEX, banded, zb, 0, mid);
    renderFrame(MAP, cam, CONFIG, TEX, banded, zb, mid, CONFIG.height);

    expect(Array.from(banded)).toEqual(Array.from(whole));
  });

  it('draws billboard sprites (a barrel) in view', () => {
    const buf = renderFrame(MAP, { x: 5, y: 1, angle: Math.PI / 2, z: 1.4 }, CONFIG, TEX);

    expect(hasGreen(buf)).toBe(true);
  });

  it('occludes sprites behind solid walls but shows them when unobstructed (depth test)', () => {
    const map = buildBsp({ ...SAMPLE_MAP, things: [{ x: 5, y: -1, angle: 0, type: 'barrel' }] });
    const inside = renderFrame(map, { x: 5, y: 2, angle: -Math.PI / 2, z: 1.4 }, CONFIG, TEX);
    const outside = renderFrame(map, { x: 5, y: -3, angle: Math.PI / 2, z: 1.4 }, CONFIG, TEX);

    expect(hasGreen(inside)).toBe(false);
    expect(hasGreen(outside)).toBe(true);
  });

  it('pitch shears the view vertically (look up/down)', () => {
    const base = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const level = renderFrame(MAP, base, CONFIG, TEX);
    const lookUp = renderFrame(MAP, { ...base, pitch: 0.5 }, CONFIG, TEX);

    expect(Array.from(lookUp)).not.toEqual(Array.from(level));
  });

  it('handles a camera centred among walls (near-plane straddle + back-face culling)', () => {
    const buf = renderFrame(MAP, { x: 8, y: 5, angle: 0, z: 1.6 }, CONFIG, TEX);

    expect(buf.length).toBe(CONFIG.width * CONFIG.height * 4);
  });

  it('is deterministic', () => {
    const camera: Camera = { x: 6, y: 4, angle: 1.2, z: 1.6 };

    expect(Array.from(renderFrame(MAP, camera, CONFIG, TEX))).toEqual(
      Array.from(renderFrame(MAP, camera, CONFIG, TEX)),
    );
  });

  it('renders from many viewpoints — inside AND outside the room — across all facings', () => {
    const positions = [
      { x: 6, y: 5 },
      { x: -5, y: 5 },
      { x: 20, y: 5 },
      { x: 8, y: -5 },
      { x: 8, y: 15 },
    ];

    for (const p of positions) {
      for (let i = 0; i < 8; i++) {
        const buf = renderFrame(MAP, { ...p, angle: (i * Math.PI) / 4, z: 1.6 }, CONFIG, TEX);

        expect(buf.length).toBe(CONFIG.width * CONFIG.height * 4);
      }
    }
  });
});

describe('atlas sprites', () => {
  const SIDE: SideDef = {
    sector: 0,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'BRICK',
    lowerTex: 'BRICK',
    middleTex: 'BRICK',
  };
  const ROOM: MapSource = {
    vertices: [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ],
    sectors: [{ floorZ: 0, ceilZ: 5, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 }],
    linedefs: [
      { v1: 0, v2: 1, front: SIDE, back: null },
      { v1: 1, v2: 2, front: SIDE, back: null },
      { v1: 2, v2: 3, front: SIDE, back: null },
      { v1: 3, v2: 0, front: SIDE, back: null },
    ],
    things: [],
  };
  const room = buildBsp(ROOM);
  const atlas = {
    width: 2,
    height: 2,
    // prettier-ignore
    pixels: new Uint8ClampedArray([
      250, 20, 20, 255,   20, 250, 20, 255,
      20, 20, 250, 255,   250, 250, 20, 255,
    ]),
  };
  const tex = new Map([...TEX, ['ATLAS', atlas]]);
  const cam = { x: 5, y: 5, angle: 0, z: 1.6 };
  const sprite = { x: 8, y: 5, z: 0, tex: 'ATLAS', width: 1, height: 2, cols: 2, rows: 2 };

  function has(buf: Uint8ClampedArray, r: number, g: number, b: number): boolean {
    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      if (
        Math.abs(buf[p * 4] - r) < 12 &&
        Math.abs(buf[p * 4 + 1] - g) < 12 &&
        Math.abs(buf[p * 4 + 2] - b) < 12
      ) {
        return true;
      }
    }

    return false;
  }

  function render(s: Sprite): Uint8ClampedArray {
    return renderFrame(room, cam, CONFIG, tex, undefined, undefined, undefined, undefined, [s]);
  }

  it('draws only the selected atlas cell (col,row) of a billboard', () => {
    const yellow = render({ ...sprite, col: 1, row: 1 });

    expect(has(yellow, 250, 250, 20)).toBe(true);
    expect(has(yellow, 250, 20, 20)).toBe(false);

    const red = render({ ...sprite, col: 0, row: 0 });

    expect(has(red, 250, 20, 20)).toBe(true);
    expect(has(red, 250, 250, 20)).toBe(false);
  });

  it('brightens a billboard additively at full hit-flash (×2, clipped), not a flat white', () => {
    const flashed = render({ ...sprite, col: 0, row: 0, flash: 1 });

    expect(has(flashed, 255, 40, 40)).toBe(true);
    expect(has(flashed, 250, 20, 20)).toBe(false);
  });

  describe('mapSprites (directional props)', () => {
    const north = Math.PI * 1.5;
    const dressed = buildBsp({
      ...ROOM,
      things: [
        { x: 2, y: 2, angle: 0, type: 'prop' },
        { x: 5, y: 5, angle: north, type: 'prop_totem' },
        { x: 3, y: 7, angle: 0, type: 'prop_board' },
        { x: 7, y: 3, angle: Math.PI, type: 'prop_chair' },
        { x: 8, y: 8, angle: 0, type: 'prop_cooler' },
        { x: 5, y: 8, angle: 0, type: 'player_start' },
      ],
    });

    it('emits rotation-sheet BILLBOARDS for directional props, plain billboards for symmetric ones', () => {
      const sprites = mapSprites(dressed);

      expect(sprites).toHaveLength(5);
      const [plant, totem, board, chair, cooler] = sprites;

      expect(plant).toEqual({ x: 2, y: 2, z: 0, tex: 'PROP', width: 0.8, height: 1.6 });
      expect(cooler).toEqual({ x: 8, y: 8, z: 0, tex: 'PROP_COOLER', width: 0.6, height: 1.5 });
      for (const s of [totem, board, chair]) {
        expect(s).toMatchObject({ cols: 4, rows: 1, col: 0, row: 0, rotations: 4, voxel: true });
      }
      expect(totem.facing).toBe(north);
      expect(chair.facing).toBe(Math.PI);
      expect(board).toMatchObject({ tex: 'PROP_BOARD', width: 1.49, height: 1.7 });
    });
  });
});

describe('voxel props (world-anchored volumes)', () => {
  const SIDE: SideDef = {
    sector: 0,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'BRICK',
    lowerTex: 'BRICK',
    middleTex: 'BRICK',
  };
  const ROOM: MapSource = {
    vertices: [
      { x: 0, y: 0 },
      { x: 0, y: 12 },
      { x: 12, y: 12 },
      { x: 12, y: 0 },
    ],
    sectors: [{ floorZ: 0, ceilZ: 5, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 }],
    linedefs: [
      { v1: 0, v2: 1, front: SIDE, back: null },
      { v1: 1, v2: 2, front: SIDE, back: null },
      { v1: 2, v2: 3, front: SIDE, back: null },
      { v1: 3, v2: 0, front: SIDE, back: null },
    ],
    things: [],
  };
  const room = buildBsp(ROOM);
  const GREEN = [20, 250, 20] as const;
  const RED = [250, 20, 20] as const;
  const YELLOW = [250, 250, 20] as const;
  const BLUE = [20, 20, 250] as const;

  function grid(
    n: number,
    ny: number,
    nz: number,
    cell: (x: number, y: number, z: number) => readonly [number, number, number] | null,
  ): Texture {
    const pixels = new Uint8ClampedArray(n * ny * nz * 4);

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < n; x++) {
          const colour = cell(x, y, z);

          if (colour !== null) {
            const i = ((z * ny + y) * n + x) * 4;

            pixels[i] = colour[0];
            pixels[i + 1] = colour[1];
            pixels[i + 2] = colour[2];
            pixels[i + 3] = 255;
          }
        }
      }
    }

    return { width: n, height: ny * nz, pixels, voxelDepth: ny };
  }

  const magenta = {
    width: 2,
    height: 2,
    pixels: new Uint8ClampedArray(Array.from({ length: 4 }, () => [230, 20, 230, 255]).flat()),
  };
  const tex = new Map([
    ...TEX,
    ['DEPTH', grid(2, 2, 2, (_x, y) => (y === 0 ? BLUE : YELLOW))],
    ['LATERAL', grid(2, 2, 2, (x) => (x === 0 ? GREEN : RED))],
    ['CORNER', grid(2, 2, 2, (x, y) => (y === 0 ? (x === 0 ? GREEN : RED) : x === 1 ? YELLOW : null))], // prettier-ignore
    ['GREY', grid(2, 2, 2, () => [100, 100, 100])],
    ['SOLIDRED', grid(2, 2, 2, () => RED)],
    ['LONE', grid(3, 3, 3, (x, y, z) => (x === 0 && y === 0 && z === 0 ? RED : null))],
    ['FARROW', grid(3, 3, 3, (_x, y) => (y === 2 ? RED : null))],
    ['MAG', magenta],
  ]);
  const voxel: Sprite = {
    x: 8,
    y: 6,
    z: 0,
    tex: 'DEPTH',
    width: 1.4,
    height: 2,
    cols: 4,
    rows: 1,
    col: 0,
    row: 0,
    rotations: 4,
    facing: 0,
    voxel: true,
  };

  function present(buf: Uint8ClampedArray, [r, g, b]: readonly [number, number, number]): boolean {
    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      if (buf[p * 4] === r && buf[p * 4 + 1] === g && buf[p * 4 + 2] === b) {
        return true;
      }
    }

    return false;
  }

  function meanColumn(
    buf: Uint8ClampedArray,
    pred: (r: number, g: number, b: number) => boolean,
  ): number {
    let sum = 0;
    let count = 0;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      if (pred(buf[p * 4], buf[p * 4 + 1], buf[p * 4 + 2])) {
        sum += p % CONFIG.width;
        count++;
      }
    }

    return sum / count;
  }
  const isYellowish = (r: number, g: number, b: number): boolean => r > 150 && g > 150 && b < 60;
  const isGreenish = (r: number, g: number, b: number): boolean => g > 150 && r < 60 && b < 60;
  const isReddish = (r: number, g: number, b: number): boolean => r > 150 && g < 60 && b < 60;

  function render(
    camera: Camera,
    sprites: readonly Sprite[],
    zbuf?: Float32Array,
  ): Uint8ClampedArray {
    return renderFrame(room, camera, CONFIG, tex, undefined, zbuf, undefined, undefined, sprites);
  }

  it('anchors the volume in the WORLD: the far row hides head-on and swaps with the viewpoint', () => {
    const fromFront = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [voxel]);

    expect(present(fromFront, BLUE)).toBe(true);
    expect(meanColumn(fromFront, isYellowish)).toBeNaN();

    const fromBehind = render({ x: 5, y: 6, angle: 0, z: 1.6 }, [voxel]);

    expect(present(fromBehind, YELLOW)).toBe(true);
    expect(meanColumn(fromBehind, (r, g, b) => b > 150 && r < 60 && g < 60)).toBeNaN();
  });

  it('keeps the head-on art chirality and mirrors with the WORLD when viewed from behind', () => {
    const lateral: Sprite = { ...voxel, tex: 'LATERAL' };
    const fromFront = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [lateral]);

    expect(meanColumn(fromFront, isGreenish)).toBeLessThan(meanColumn(fromFront, isReddish));

    const fromBehind = render({ x: 5, y: 6, angle: 0, z: 1.6 }, [lateral]);

    expect(meanColumn(fromBehind, isGreenish)).toBeGreaterThan(meanColumn(fromBehind, isReddish));
  });

  it('reveals a flank voxel at a diagonal that stays hidden head-on (a true volume, no cell snap)', () => {
    const corner: Sprite = { ...voxel, tex: 'CORNER' };
    const headOn = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [corner]);

    expect(meanColumn(headOn, isGreenish)).not.toBeNaN();
    expect(meanColumn(headOn, isReddish)).not.toBeNaN();
    expect(meanColumn(headOn, isYellowish)).toBeNaN();

    const diagonal = render({ x: 10.5, y: 8.5, angle: -Math.PI * 0.75, z: 1.6 }, [corner]);

    expect(meanColumn(diagonal, isYellowish)).not.toBeNaN();
    expect(meanColumn(diagonal, isReddish)).not.toBeNaN();
  });

  it('shades per face: top ×1.18, lateral ×0.82, underside ×0.55, depth faces ×1.0', () => {
    const grey: Sprite = { ...voxel, tex: 'GREY', height: 1 };
    const fromFront = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [grey]);

    expect(present(fromFront, [100, 100, 100])).toBe(true);
    expect(present(fromFront, [118, 118, 118])).toBe(true);

    const fromDiagonal = render({ x: 10.5, y: 8.5, angle: -Math.PI * 0.75, z: 1.6 }, [grey]);

    expect(present(fromDiagonal, [82, 82, 82])).toBe(true);

    const floating: Sprite = { ...grey, z: 2.5 };
    const fromBelow = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [floating]);

    expect(present(fromBelow, [55, 55, 55])).toBe(true);
  });

  it('WRITES its depth: a nearer-sorted billboard inside the volume cannot paint through it', () => {
    const solid: Sprite = { ...voxel, tex: 'SOLIDRED' };
    const inside: Sprite = { x: 8.45, y: 6, z: 0.5, tex: 'MAG', width: 0.2, height: 0.5 };
    const cam: Camera = { x: 11, y: 6, angle: Math.PI, z: 1.6 };

    const magentaIn = (buf: Uint8ClampedArray): boolean => {
      for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
        if (buf[p * 4] === 230 && buf[p * 4 + 1] === 20 && buf[p * 4 + 2] === 230) {
          return true;
        }
      }

      return false;
    };

    expect(magentaIn(render(cam, [inside]))).toBe(true);
    expect(magentaIn(render(cam, [solid, inside]))).toBe(false);
  });

  it('is occluded by nearer walls: columns behind a pillar never march the grid', () => {
    const walled = buildBsp({
      ...ROOM,
      vertices: [...ROOM.vertices, { x: 9.5, y: 5.6 }, { x: 9.5, y: 6.4 }],
      linedefs: [...ROOM.linedefs, { v1: 4, v2: 5, front: SIDE, back: null }],
    });
    const cam: Camera = { x: 11, y: 6, angle: Math.PI, z: 1.6 };
    const solid: Sprite = { ...voxel, tex: 'SOLIDRED' };
    const clear = renderFrame(room, cam, CONFIG, tex, undefined, undefined, undefined, undefined, [solid]); // prettier-ignore
    const behind = renderFrame(walled, cam, CONFIG, tex, undefined, undefined, undefined, undefined, [solid]); // prettier-ignore
    const count = (buf: Uint8ClampedArray): number => {
      let n = 0;

      for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
        if (isReddish(buf[p * 4], buf[p * 4 + 1], buf[p * 4 + 2])) {
          n++;
        }
      }

      return n;
    };

    expect(count(behind)).toBeGreaterThan(0);
    expect(count(behind)).toBeLessThan(count(clear));
  });

  it('marches through empty cells and exits the grid on every axis', () => {
    const lone: Sprite = { ...voxel, tex: 'LONE' };
    const reds = (buf: Uint8ClampedArray): number => {
      let count = 0;

      for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
        if (isReddish(buf[p * 4], buf[p * 4 + 1], buf[p * 4 + 2])) {
          count++;
        }
      }

      return count;
    };

    expect(reds(render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [lone]))).toBeGreaterThan(0);
    expect(reds(render({ x: 10.5, y: 8.5, angle: -Math.PI * 0.75, z: 2.5 }, [lone]))).toBeGreaterThan(0); // prettier-ignore
  });

  it('skips axis-parallel rays that start outside the footprint (or above the grid) entirely', () => {
    const solid: Sprite = { ...voxel, tex: 'SOLIDRED' };
    const reds = (buf: Uint8ClampedArray): number => {
      let count = 0;

      for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
        if (isReddish(buf[p * 4], buf[p * 4 + 1], buf[p * 4 + 2])) {
          count++;
        }
      }

      return count;
    };

    expect(reds(render({ x: 7.29, y: 6.75, angle: 0, z: 1.6 }, [solid]))).toBeGreaterThan(0);
    expect(reds(render({ x: 7.29, y: 5.25, angle: 0, z: 1.6 }, [solid]))).toBeGreaterThan(0);
    expect(reds(render({ x: 11, y: 6, angle: Math.PI, z: 2 }, [solid]))).toBeGreaterThan(0);
  });

  it('stops a march midway when a nearer wall depth already owns the pixel', () => {
    const cut = buildBsp({
      ...ROOM,
      vertices: [...ROOM.vertices, { x: 8, y: 5.6 }, { x: 8, y: 6.4 }],
      linedefs: [...ROOM.linedefs, { v1: 4, v2: 5, front: SIDE, back: null }],
    });
    const farRow: Sprite = { ...voxel, tex: 'FARROW' };
    const cam: Camera = { x: 11, y: 6, angle: Math.PI, z: 1.6 };
    const reds = (buf: Uint8ClampedArray): number => {
      let count = 0;

      for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
        if (isReddish(buf[p * 4], buf[p * 4 + 1], buf[p * 4 + 2])) {
          count++;
        }
      }

      return count;
    };
    const clear = reds(renderFrame(room, cam, CONFIG, tex, undefined, undefined, undefined, undefined, [farRow])); // prettier-ignore
    const cutOff = reds(renderFrame(cut, cam, CONFIG, tex, undefined, undefined, undefined, undefined, [farRow])); // prettier-ignore

    expect(cutOff).toBeGreaterThan(0);
    expect(cutOff).toBeLessThan(clear);
  });

  it('renders byte-identically split into worker bands', () => {
    const cam: Camera = { x: 10.5, y: 8.5, angle: -Math.PI * 0.75, z: 1.6 };
    const sprites: Sprite[] = [{ ...voxel, tex: 'CORNER' }];
    const whole = renderFrame(room, cam, CONFIG, tex, undefined, undefined, undefined, undefined, sprites); // prettier-ignore
    const banded = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);
    const zbuf = new Float32Array(CONFIG.width * CONFIG.height);

    renderFrame(room, cam, CONFIG, tex, banded, zbuf, 0, 33, sprites);
    renderFrame(room, cam, CONFIG, tex, banded, zbuf, 33, CONFIG.height, sprites);
    expect(Array.from(banded)).toEqual(Array.from(whole));
  });

  it('tints a volume behind glass ONLY inside the pane span, and stops at layers behind it', () => {
    const glassSide = (sector: number): SideDef => ({ ...SIDE, sector });
    const scene = (glass: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'SKY', light: 255 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'SKY', light: 255 },
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'SKY', light: 255 },
      ],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
        { x: 0, y: 12 },
        { x: 8, y: 12 },
        { x: 0, y: 18 },
        { x: 8, y: 18 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: glassSide(0), back: null },
        { v1: 2, v2: 3, front: glassSide(0), back: glassSide(1), glass },
        { v1: 3, v2: 1, front: glassSide(0), back: null },
        { v1: 1, v2: 0, front: glassSide(0), back: null },
        { v1: 2, v2: 4, front: glassSide(1), back: null },
        { v1: 4, v2: 5, front: glassSide(1), back: glassSide(2), glass },
        { v1: 5, v2: 3, front: glassSide(1), back: null },
        { v1: 4, v2: 6, front: glassSide(2), back: null },
        { v1: 6, v2: 7, front: glassSide(2), back: null },
        { v1: 7, v2: 5, front: glassSide(2), back: null },
      ],
    });
    const cam: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
    const floating: Sprite = {
      ...voxel,
      tex: 'SOLIDRED',
      x: 4,
      y: 9,
      z: 4.2,
      facing: -Math.PI / 2,
    };
    const glazed = renderFrame(buildBsp(scene(true)), cam, CONFIG, tex, undefined, undefined, undefined, undefined, [floating]); // prettier-ignore
    const plain = renderFrame(buildBsp(scene(false)), cam, CONFIG, tex, undefined, undefined, undefined, undefined, [floating]); // prettier-ignore
    let tinted = 0;
    let untouched = 0;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (plain[i] > 190 && plain[i + 1] < 50 && plain[i + 2] < 50) {
        if (glazed[i] === plain[i] && glazed[i + 2] === plain[i + 2]) {
          untouched++;
        } else if (glazed[i + 2] > plain[i + 2] + 30 && glazed[i] < plain[i]) {
          tinted++;
        }
      }
    }
    expect(tinted).toBeGreaterThan(20);
    expect(untouched).toBeGreaterThan(20);
  });

  it('projects a voxel quad with the grid-space camera/axes and a conservative envelope', () => {
    const focal = focalFor(CONFIG.width, CONFIG.fov);
    const [quad] = projectSprites([voxel], room, { x: 11, y: 6, angle: Math.PI, z: 1.6 }, CONFIG.width, focal, CONFIG.height >> 1, tex); // prettier-ignore
    const vox = quad.vox;
    const scale = 2 / 1.4;

    expect(vox).toBeDefined();
    expect(vox).toMatchObject({ n: 2, ny: 2, nz: 2 });
    expect(vox?.camGX).toBeCloseTo(1, 10);
    expect(vox?.camGY).toBeCloseTo(1 - 3 * scale, 10);
    expect(vox?.camGZ).toBeCloseTo(1.6, 10);
    expect(vox?.fwdGX).toBeCloseTo(0, 10);
    expect(vox?.fwdGY).toBeCloseTo(scale, 10);
    expect(vox?.rightGX).toBeCloseTo(-scale, 10);
    expect(vox?.rightGY).toBeCloseTo(0, 10);
    expect(quad.left).toBeLessThan(60);
    expect(quad.right).toBeGreaterThan(60);
    expect(quad.yTop).toBeLessThan(quad.yBottom);
    const cam: Camera = { x: 11, y: 8, angle: Math.PI * 0.9, z: 1.6 };

    expect(projectSprites([{ ...voxel, facing: undefined }], room, cam, CONFIG.width, focal, 40, tex)) // prettier-ignore
      .toEqual(projectSprites([{ ...voxel, facing: 0 }], room, cam, CONFIG.width, focal, 40, tex));
  });

  it('falls back to the plain billboard quad when the texture carries no carved grid', () => {
    const focal = focalFor(CONFIG.width, CONFIG.fov);
    const flat = new Map([...tex, ['DEPTH', { ...magenta }]]);
    const cam: Camera = { x: 11, y: 6, angle: Math.PI, z: 1.6 };
    const project = (sprites: readonly Sprite[], lib: Map<string, Texture>) =>
      projectSprites(sprites, room, cam, CONFIG.width, focal, CONFIG.height >> 1, lib);
    const [fallback] = project([voxel], flat);

    expect(fallback.vox).toBeUndefined();
    expect(project([voxel], flat)).toEqual(project([{ ...voxel, voxel: undefined }], flat));

    expect(project([{ ...voxel, x: 11.5 }], tex)).toEqual([]);
  });

  it('widens the envelope to the whole screen when a footprint corner crosses the near plane', () => {
    const focal = focalFor(CONFIG.width, CONFIG.fov);
    const cam: Camera = { x: 8.71, y: 6, angle: Math.PI, z: 1.6 };
    const [quad] = projectSprites([{ ...voxel, tex: 'SOLIDRED' }], room, cam, CONFIG.width, focal, CONFIG.height >> 1, tex); // prettier-ignore

    expect(quad.left).toBe(0);
    expect(quad.right).toBe(CONFIG.width - 1);
    const buf = render(cam, [{ ...voxel, tex: 'SOLIDRED' }]);
    let reds = 0;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      if (isReddish(buf[p * 4], buf[p * 4 + 1], buf[p * 4 + 2])) {
        reds++;
      }
    }
    expect(reds).toBeGreaterThan(100);
  });
});

describe('zone portals', () => {
  const side = (sector: number, middleTex = 'BRICK'): SideDef => ({
    sector,
    xOffset: 0,
    yOffset: 0,
    upperTex: 'BRICK',
    lowerTex: 'BRICK',
    middleTex,
  });
  const flat = (
    r: number,
    g: number,
    b: number,
  ): { width: number; height: number; pixels: Uint8ClampedArray } => ({
    width: 2,
    height: 2,
    pixels: new Uint8ClampedArray([r, g, b, 255, r, g, b, 255, r, g, b, 255, r, g, b, 255]),
  });
  const TEXP = new Map(TEX).set('NGREEN', flat(20, 220, 20)).set('NMAG', flat(220, 20, 220));
  const sector = { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 };
  const CAM: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
  const SEAM = { zone: 'nb', dx: -100, dy: 0 } as const;

  function local(opts: { pillar?: boolean } = {}): CompiledMap {
    return buildBsp({
      sectors: [sector],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 8 },
        { x: 8, y: 8 },
        { x: 3.5, y: 5 },
        { x: 4.5, y: 5 },
        { x: 4.5, y: 6 },
        { x: 3.5, y: 6 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: side(0), back: null },
        { v1: 2, v2: 3, front: side(0), back: null, zonePortal: SEAM },
        { v1: 3, v2: 1, front: side(0), back: null },
        { v1: 1, v2: 0, front: side(0), back: null },
        ...(opts.pillar
          ? [
              { v1: 4, v2: 5, front: side(0), back: null },
              { v1: 5, v2: 6, front: side(0), back: null },
              { v1: 6, v2: 7, front: side(0), back: null },
              { v1: 7, v2: 4, front: side(0), back: null },
            ]
          : []),
      ],
    });
  }

  function neighbor(opts: { sky?: boolean; glass?: boolean; portalTo?: string } = {}): CompiledMap {
    const far =
      opts.portalTo !== undefined ? { zonePortal: { zone: opts.portalTo, dx: -100, dy: 0 } } : {};
    const secs = opts.glass
      ? [
          { ...sector, ceilTex: opts.sky === true ? 'SKY' : 'CEIL' },
          { ...sector, ceilTex: opts.sky === true ? 'SKY' : 'CEIL' },
        ]
      : [{ ...sector, ceilTex: opts.sky === true ? 'SKY' : 'CEIL' }];
    const backSector = opts.glass ? 1 : 0;

    return buildBsp({
      sectors: secs,
      things: [],
      vertices: [
        { x: 100, y: 8 },
        { x: 108, y: 8 },
        { x: 100, y: 16 },
        { x: 108, y: 16 },
        { x: 100, y: 12 },
        { x: 108, y: 12 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: side(0, 'NGREEN'), back: null },
        { v1: 2, v2: 3, front: side(backSector, 'NGREEN'), back: null, ...far },
        { v1: 3, v2: 1, front: side(backSector, 'NGREEN'), back: null },
        { v1: 1, v2: 0, front: side(0, 'NGREEN'), back: null },
        ...(opts.glass
          ? [{ v1: 4, v2: 5, front: side(0, 'NGREEN'), back: side(1, 'NGREEN'), glass: true }]
          : []),
      ],
    });
  }

  const FAR = buildBsp({
    sectors: [sector],
    things: [],
    vertices: [
      { x: 200, y: 16 },
      { x: 208, y: 16 },
      { x: 200, y: 24 },
      { x: 208, y: 24 },
    ],
    linedefs: [
      { v1: 0, v2: 2, front: side(0, 'NMAG'), back: null },
      { v1: 2, v2: 3, front: side(0, 'NMAG'), back: null },
      { v1: 3, v2: 1, front: side(0, 'NMAG'), back: null },
      { v1: 1, v2: 0, front: side(0, 'NMAG'), back: null },
    ],
  });

  const zone = (map: CompiledMap, sprites?: readonly Sprite[]): ZoneNeighbor => ({ map, sprites });

  function render(
    map: CompiledMap,
    neighbors?: ReadonlyMap<string, ZoneNeighbor>,
    sprites?: readonly Sprite[],
    cam: Camera = CAM,
  ): Uint8ClampedArray {
    return renderFrame(map, cam, CONFIG, TEXP, undefined, undefined, 0, CONFIG.height, sprites, undefined, neighbors); // prettier-ignore
  }

  function countWhere(
    buf: Uint8ClampedArray,
    pred: (r: number, g: number, b: number) => boolean,
  ): number {
    let n = 0;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      if (pred(buf[p * 4], buf[p * 4 + 1], buf[p * 4 + 2])) {
        n++;
      }
    }

    return n;
  }
  const isGreen = (r: number, g: number, b: number): boolean => g > r + 40 && g > b + 40 && g > 80;
  const isMag = (r: number, g: number, b: number): boolean => r > 120 && b > 120 && g < 80;

  it('renders the neighbor zone through the seam (translated, textured); solid fallback without it', () => {
    const map = local();
    const live = render(map, new Map([['nb', zone(neighbor())]]));

    expect(countWhere(live, isGreen)).toBeGreaterThan(50);

    const solid = render(map);

    expect(countWhere(solid, isGreen)).toBe(0);
    expect(Array.from(render(map, new Map()))).toEqual(Array.from(solid));
    expect(Array.from(renderFrame(MAP, CAM, CONFIG, TEXP, undefined, undefined, 0, CONFIG.height, undefined, undefined, new Map([['nb', zone(neighbor())]])))) // prettier-ignore
      .toEqual(Array.from(renderFrame(MAP, CAM, CONFIG, TEXP)));
  });

  it('ray-marches a warm neighbor VOXEL prop through the seam, clipped to its recorded windows', () => {
    const redGrid: Texture = {
      width: 2,
      height: 4,
      pixels: new Uint8ClampedArray(Array.from({ length: 8 }, () => [250, 20, 20, 255]).flat()),
      voxelDepth: 2,
    };
    const lib = new Map([...TEXP, ['REDGRID', redGrid]]);
    const voxSpr: Sprite = {
      x: 105,
      y: 10,
      z: 0,
      tex: 'REDGRID',
      width: 1.2,
      height: 2,
      cols: 4,
      rows: 1,
      col: 0,
      row: 0,
      rotations: 4,
      facing: -Math.PI / 2,
      voxel: true,
    };
    const nbs = new Map([['nb', zone(neighbor(), [voxSpr])]]);
    const isRed = (r: number, g: number, b: number): boolean => r > 150 && g < 60 && b < 60;
    const draw = (map: CompiledMap): Uint8ClampedArray =>
      renderFrame(map, CAM, CONFIG, lib, undefined, undefined, 0, CONFIG.height, undefined, undefined, nbs); // prettier-ignore
    const open = countWhere(draw(local()), isRed);
    const blocked = countWhere(draw(local({ pillar: true })), isRed);

    expect(open).toBeGreaterThan(30);
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(open);
  });

  it('reuses its per-context scratch without leaking state: interleaved heterogeneous renders stay byte-identical', () => {
    const map = local({ pillar: true });
    const nbSpr: Sprite[] = [{ x: 104, y: 10, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 }];
    const nbs = new Map([['nb', zone(neighbor({ glass: true }), nbSpr)]]);
    const spr: Sprite[] = [{ x: 3, y: 4, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 }];
    const first = Array.from(render(map, nbs, spr));

    renderFrame(MAP, CAM, { width: 64, height: 48, fov: Math.PI / 2 }, TEX);
    renderFrame(MAP, CAM, CONFIG, TEX);

    expect(Array.from(render(map, nbs, spr))).toEqual(first);
  });

  it('falls back to the solid middle when the seam names a zone the neighbors map lacks', () => {
    const map = local();

    expect(Array.from(render(map, new Map([['far', zone(FAR)]])))).toEqual(Array.from(render(map)));
  });

  it('occludes the portal behind nearer local geometry (a pillar in front of the seam)', () => {
    const map = local({ pillar: true });

    expect(map.segs.filter((s) => s.linedef === 1).length).toBeGreaterThan(1);

    const live = render(map, new Map([['nb', zone(neighbor())]]));
    const mid = CONFIG.height >> 1;
    let centreGreen = false;
    let flankGreen = false;

    for (let y = 0; y < CONFIG.height; y++) {
      const c = pixel(live, 60, y);
      const f = pixel(live, 25, y);

      centreGreen = centreGreen || isGreen(c[0], c[1], c[2]);
      flankGreen = flankGreen || isGreen(f[0], f[1], f[2]);
    }
    expect(centreGreen).toBe(false);
    expect(flankGreen).toBe(true);
    expect(pixel(live, 60, mid)[3]).toBe(255);
  });

  it('caps recursion at depth 1: a portal seen through a portal paints its solid middle, not the third zone', () => {
    const neighbors = new Map([
      ['nb', zone(neighbor({ portalTo: 'far' }))],
      ['far', zone(FAR)],
    ]);
    const live = render(local(), neighbors);

    expect(countWhere(live, isGreen)).toBeGreaterThan(50);
    expect(countWhere(live, isMag)).toBe(0);

    const inNb = render(neighbor({ portalTo: 'far' }), neighbors, undefined, {
      x: 104,
      y: 10,
      angle: Math.PI / 2,
      z: 1.6,
    });

    expect(countWhere(inNb, isMag)).toBeGreaterThan(50);
  });

  it('tints the portal view through a local glass pane standing in front of the seam', () => {
    const glazedLocal = buildBsp({
      sectors: [sector, sector],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 4 },
        { x: 8, y: 4 },
        { x: 0, y: 8 },
        { x: 8, y: 8 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: side(0), back: null },
        { v1: 2, v2: 3, front: side(0), back: side(1), glass: true },
        { v1: 3, v2: 1, front: side(0), back: null },
        { v1: 1, v2: 0, front: side(0), back: null },
        { v1: 2, v2: 4, front: side(1), back: null },
        { v1: 4, v2: 5, front: side(1), back: null, zonePortal: SEAM },
        { v1: 5, v2: 3, front: side(1), back: null },
      ],
    });
    const nb = new Map([['nb', zone(neighbor())]]);
    const plain = render(local(), nb);
    const glazed = render(glazedLocal, nb);
    let cooler = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (isGreen(plain[i], plain[i + 1], plain[i + 2]) && glazed[i + 2] > plain[i + 2] + 12) {
        cooler = true;
        break;
      }
    }
    expect(cooler).toBe(true);
  });

  it("blends the neighbor's OWN glass inside its pass (a pane beyond the seam still tints)", () => {
    const clear = render(local(), new Map([['nb', zone(neighbor())]]));
    const glazed = render(local(), new Map([['nb', zone(neighbor({ glass: true }))]]));
    let cooler = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (isGreen(clear[i], clear[i + 1], clear[i + 2]) && glazed[i + 2] > clear[i + 2] + 12) {
        cooler = true;
        break;
      }
    }
    expect(cooler).toBe(true);
  });

  it("casts the neighbor's SKY inside the window", () => {
    const live = render(local(), new Map([['nb', zone(neighbor({ sky: true }))]]));
    let sky = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (live[i + 2] > live[i] + 40) {
        sky = true;
        break;
      }
    }
    expect(sky).toBe(true);
  });

  it('keeps the z-buffer coherent: a local sprite in FRONT of the seam draws over the portal view', () => {
    const red: Sprite = { x: 4, y: 6, z: 0, tex: 'NMAG', width: 2, height: 2.5 };
    const live = render(local(), new Map([['nb', zone(neighbor())]]), [red]);

    expect(countWhere(live, isMag)).toBeGreaterThan(20);
    expect(countWhere(live, isGreen)).toBeGreaterThan(20);
  });

  it('handles SEVERAL seam linedefs in one frame — one registered seam and one pass each', () => {
    const split = buildBsp({
      sectors: [sector],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 8 },
        { x: 4, y: 8 },
        { x: 8, y: 8 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: side(0), back: null },
        { v1: 2, v2: 3, front: side(0), back: null, zonePortal: SEAM },
        { v1: 3, v2: 4, front: side(0), back: null, zonePortal: SEAM },
        { v1: 4, v2: 1, front: side(0), back: null },
        { v1: 1, v2: 0, front: side(0), back: null },
      ],
    });
    const nb = new Map([['nb', zone(neighbor())]]);

    expect(Array.from(render(split, nb))).toEqual(Array.from(render(local(), nb)));
  });

  it('renders in row bands that tile into the identical whole frame (the worker split, portals included)', () => {
    const map = local();
    const nb = new Map([['nb', zone(neighbor())]]);
    const whole = render(map, nb);
    const banded = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);
    const zb = new Float32Array(CONFIG.width * CONFIG.height);
    const mid = Math.floor(CONFIG.height / 2);

    renderFrame(map, CAM, CONFIG, TEXP, banded, zb, 0, mid, undefined, undefined, nb);
    renderFrame(map, CAM, CONFIG, TEXP, banded, zb, mid, CONFIG.height, undefined, undefined, nb);

    expect(Array.from(banded)).toEqual(Array.from(whole));
  });

  it('records nothing facing away from the seam, and skips a seam whose every column is occluded', () => {
    const map = local();
    const nb = new Map([['nb', zone(neighbor())]]);
    const away: Camera = { x: 4, y: 2, angle: -Math.PI / 2, z: 1.6 };

    expect(Array.from(render(map, nb, undefined, away))).toEqual(
      Array.from(render(map, undefined, undefined, away)),
    );

    const blocked = buildBsp({
      sectors: [sector],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 8 },
        { x: 8, y: 8 },
        { x: 0, y: 6 },
        { x: 8, y: 6 },
      ],
      linedefs: [
        { v1: 0, v2: 2, front: side(0), back: null },
        { v1: 2, v2: 3, front: side(0), back: null, zonePortal: SEAM },
        { v1: 3, v2: 1, front: side(0), back: null },
        { v1: 1, v2: 0, front: side(0), back: null },
        { v1: 4, v2: 5, front: side(0), back: null },
      ],
    });

    expect(Array.from(render(blocked, nb))).toEqual(Array.from(render(blocked)));
  });

  describe('neighbor sprites (a warm zone alive through the window)', () => {
    const foe: Sprite = { x: 104, y: 11, z: 0, tex: 'NMAG', width: 1.5, height: 2 };

    it('draws a neighbor sprite through the seam window, and none without the sprites channel', () => {
      const live = render(local(), new Map([['nb', zone(neighbor(), [foe])]]));

      expect(countWhere(live, isMag)).toBeGreaterThan(20);

      const calm = render(local(), new Map([['nb', zone(neighbor())]]));

      expect(countWhere(calm, isMag)).toBe(0);
      expect(Array.from(render(local(), new Map([['nb', zone(neighbor(), [])]])))).toEqual(
        Array.from(calm),
      );
    });

    it("z-tests a neighbor sprite against the neighbor's own geometry (drawn behind its far wall: absent)", () => {
      const buried: Sprite = { ...foe, y: 17 };
      const live = render(local(), new Map([['nb', zone(neighbor(), [buried])]]));

      expect(countWhere(live, isMag)).toBe(0);
    });

    it('occludes a neighbor sprite behind nearer LOCAL geometry (the pillar in front of the seam)', () => {
      const nbWith = (spr: Sprite): ReadonlyMap<string, ZoneNeighbor> =>
        new Map([['nb', zone(neighbor(), [spr])]]);

      expect(countWhere(render(local(), nbWith(foe)), isMag)).toBeGreaterThan(20);
      expect(countWhere(render(local({ pillar: true }), nbWith(foe)), isMag)).toBe(0);
      const west: Sprite = { ...foe, x: 100.5 };

      expect(countWhere(render(local({ pillar: true }), nbWith(west)), isMag)).toBeGreaterThan(0);
    });

    it('clips a neighbor sprite to the seam windows — no pixel outside a recorded portal column', () => {
      const lShaped = buildBsp({
        sectors: [sector],
        things: [],
        vertices: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 0, y: 8 },
          { x: 6, y: 8 },
          { x: 6, y: 16 },
          { x: 8, y: 16 },
        ],
        linedefs: [
          { v1: 0, v2: 2, front: side(0), back: null },
          { v1: 2, v2: 3, front: side(0), back: null, zonePortal: SEAM },
          { v1: 3, v2: 4, front: side(0), back: null },
          { v1: 4, v2: 5, front: side(0), back: null },
          { v1: 5, v2: 1, front: side(0), back: null },
          { v1: 1, v2: 0, front: side(0), back: null },
        ],
      });
      const straddling: Sprite = { x: 107, y: 9, z: 0, tex: 'NMAG', width: 2, height: 2.5 };
      const live = render(lShaped, new Map([['nb', zone(neighbor(), [straddling])]]));
      let inWindow = 0;
      let inCorridor = 0;

      for (let x = 0; x < CONFIG.width; x++) {
        for (let y = 0; y < CONFIG.height; y++) {
          const c = pixel(live, x, y);

          if (isMag(c[0], c[1], c[2])) {
            if (x >= 85) {
              inCorridor++;
            } else {
              inWindow++;
            }
          }
        }
      }
      expect(inWindow).toBeGreaterThan(0);
      expect(inCorridor).toBe(0);
    });

    it("tints a neighbor sprite behind the neighbor's OWN glass pane", () => {
      const behindPane: Sprite = { ...foe, y: 12.5 };
      const clear = render(local(), new Map([['nb', zone(neighbor(), [behindPane])]]));
      const glazed = render(
        local(),
        new Map([['nb', zone(neighbor({ glass: true }), [behindPane])]]),
      );
      let cooler = false;

      for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
        const i = p * 4;

        if (isMag(clear[i], clear[i + 1], clear[i + 2]) && glazed[i + 2] > clear[i + 2] + 12) {
          cooler = true;
          break;
        }
      }
      expect(cooler).toBe(true);
    });
  });
});
