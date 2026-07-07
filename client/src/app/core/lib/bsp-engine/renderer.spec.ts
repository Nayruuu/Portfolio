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

/** Is there a barrel pixel (green-dominant) anywhere in the frame? */
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

/** Count distinct colours sampled across a band of rows — a flat fill gives ~1, a texture gives many. */
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
    } // alpha
  });

  it('renders in place into provided target + z-buffer (no allocation)', () => {
    const target = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);
    const zbuf = new Float32Array(CONFIG.width * CONFIG.height);
    const out = renderFrame(MAP, { x: 4, y: 5, angle: 0.3, z: 1.6 }, CONFIG, TEX, target, zbuf);

    expect(out).toBe(target); // the same buffer is reused + returned
    expect(target[3]).toBe(255); // it was actually drawn into
  });

  it('keeps a steep look-down (horizon off the top) inside its render band — no fill overflow', () => {
    // A worker renders one band into a SHARED buffer. On a steep down-pitch the horizon leaves the screen
    // (negative); the background fill must clamp to the band, or its negative `end` wraps to `length + end`
    // and paints over OTHER workers' rows. Render band [30,50) and assert rows outside stay the sentinel.
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

    expect(pixel(target, 10, 10)).toEqual([7, 7, 7, 7]); // a row above the band — untouched
    expect(pixel(target, 10, 70)).toEqual([7, 7, 7, 7]); // a row below the band — untouched
    expect(pixel(target, 60, 40)[3]).toBe(255); // the band itself was drawn
  });

  it('falls back to the MISSING texture for surface names absent from the library', () => {
    const empty = new Map(); // nothing registered → every surface resolves to the magenta MISSING tex
    const cam = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const buf = renderFrame(MAP, cam, CONFIG, empty);

    expect(buf.length).toBe(CONFIG.width * CONFIG.height * 4);
    for (let i = 3; i < buf.length; i += 4) {
      expect(buf[i]).toBe(255);
    } // still opaque
    // The fallback path actually ran → the frame differs from the properly-textured one.
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
          foundSky = true; // a clearly blue-dominant pixel up high — the sky gradient (b ≫ r)
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
    // Room A (near, y[0..8]) → a shared edge at y=8 → Room B (back, y[8..16]); camera in A looking +y at it.
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
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 }, // 0 = A (near)
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 }, // 1 = B (back)
      ],
      linedefs: [
        { v1: 0, v2: 2, front: tex(0), back: null }, // A west
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass }, // A|B shared (glass?)
        { v1: 3, v2: 1, front: tex(0), back: null }, // A east
        { v1: 1, v2: 0, front: tex(0), back: null }, // A south
        { v1: 2, v2: 4, front: tex(1), back: null }, // B west
        { v1: 4, v2: 5, front: tex(1), back: null }, // B north
        { v1: 5, v2: 3, front: tex(1), back: null }, // B east
      ],
      things: [],
    });
    const cam: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
    const plain = renderFrame(buildBsp(corridor(false)), cam, CONFIG, TEX);
    const glassed = renderFrame(buildBsp(corridor(true)), cam, CONFIG, TEX);

    // The tint pass ran → the frames differ ...
    expect(Array.from(glassed)).not.toEqual(Array.from(plain));
    // ... and the difference is a COOL shift: somewhere the glazed pixel's (b − r) is clearly higher.
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
    // Three rooms A[y0..6] | B[y6..12] | C[y12..18], with a glass pane at y=6 (A|B) AND y=12 (B|C). The camera
    // in A looks +y straight through BOTH — a column hits the near pane, then the far one (which must be dropped).
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
        { v1: 0, v2: 2, front: tex(0), back: null }, // A west
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass }, // A|B pane (near)
        { v1: 3, v2: 1, front: tex(0), back: null }, // A east
        { v1: 1, v2: 0, front: tex(0), back: null }, // A south
        { v1: 2, v2: 4, front: tex(1), back: null }, // B west
        { v1: 4, v2: 5, front: tex(1), back: tex(2), glass }, // B|C pane (far — must be dropped behind the near)
        { v1: 5, v2: 3, front: tex(1), back: null }, // B east
        { v1: 4, v2: 6, front: tex(2), back: null }, // C west
        { v1: 6, v2: 7, front: tex(2), back: null }, // C north
        { v1: 7, v2: 5, front: tex(2), back: null }, // C east
      ],
    });
    const cam: Camera = { x: 4, y: 3, angle: Math.PI / 2, z: 1.6 };
    const glazed = renderFrame(buildBsp(stacked(true)), cam, CONFIG, TEX);

    // It ran without breaking (opaque frame) AND the near pane still tinted (differs from the no-glass version).
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
    // Outer door leaf: FULLY CLEAR glass (all alpha 0). Inner door leaf: OPAQUE GREEN. Camera in room A looks
    // through the shut outer door at the shut inner one — the green frame must show through the clear leaf.
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
    const buf = renderFrame(map, { x: 4, y: 3, angle: Math.PI / 2, z: 1.6 }, CONFIG, TEXD); // both doors shut
    let green = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (buf[i + 1] > 150 && buf[i] < 100 && buf[i + 2] < 100) {
        green = true;
        break;
      }
    }
    expect(green).toBe(true); // single-layer glass dropped the far door entirely — layered glass keeps it
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
    // Six rooms in a row, the five shared edges ALL plain glass — the camera looks straight through five
    // stacked panes; the fifth (farthest) exceeds the per-column layer cap and must be dropped cleanly.
    const sector = { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 255 };
    const vertices = [];
    const linedefs = [];

    for (let r = 0; r <= 6; r++) {
      vertices.push({ x: 0, y: r * 4 }, { x: 8, y: r * 4 }); // row r → vertex indices 2r (west), 2r+1 (east)
    }
    for (let r = 0; r < 6; r++) {
      linedefs.push(
        { v1: 2 * r, v2: 2 * r + 2, front: tex(r), back: null }, // room r west wall
        { v1: 2 * r + 3, v2: 2 * r + 1, front: tex(r), back: null }, // room r east wall
      );
      if (r > 0) {
        linedefs.push({ v1: 2 * r, v2: 2 * r + 1, front: tex(r - 1), back: tex(r), glass: true }); // shared pane
      }
    }
    linedefs.push({ v1: 1, v2: 0, front: tex(0), back: null }); // south end wall
    linedefs.push({ v1: 12, v2: 13, front: tex(5), back: null }); // north end wall
    const map = buildBsp({
      sectors: Array.from({ length: 6 }, () => sector),
      things: [],
      vertices,
      linedefs,
    });
    const buf = renderFrame(map, { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 }, CONFIG, TEX);

    for (let i = 3; i < buf.length; i += 4) {
      expect(buf[i]).toBe(255); // rendered clean through all five panes (the overflow layer just dropped)
    }

    // A worker BAND that excludes the panes' on-screen rows: each recorded layer clips to an empty span there
    // (the band skips it) and the band still renders its own rows clean.
    const band = renderFrame(map, { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 }, CONFIG, TEX, undefined, undefined, 0, 1); // prettier-ignore

    expect(band[3]).toBe(255); // row 0 painted by the band
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
    // Rooms A|B with a glass pane at y=6; the red sprite stands in A at y=4.5 — BETWEEN the camera and the
    // pane. Its pixels must stay saturated red (the pane behind it may not wash it).
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
        expect(glazed[i]).toBe(plain[i]); // identical — the pane BEHIND the sprite must not tint it
        expect(glazed[i + 2]).toBe(plain[i + 2]);
      }
    }
    expect(sawRed).toBe(true); // the sprite really rendered saturated red somewhere
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
    // The VIEWER's courtyard is open to the SKY; a glass pane leads inside. A red sprite floats HIGH behind
    // the pane (an arcing rocket) — its pixels land in sky rows ABOVE the pane's span, nearer-layer present:
    // they must stay full red (the pane tints only its own span).
    const scene = (glass: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'SKY', light: 255 }, // courtyard (camera), open sky
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
    const spr: Sprite = { x: 4, y: 9, z: 6, tex: 'REDSPR', width: 2, height: 2 }; // high above the window
    const glazed = renderFrame(buildBsp(scene(true)), cam, CONFIG, TEXR, undefined, undefined, undefined, undefined, [spr]); // prettier-ignore
    const plain = renderFrame(buildBsp(scene(false)), cam, CONFIG, TEXR, undefined, undefined, undefined, undefined, [spr]); // prettier-ignore
    let sawRed = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      if (plain[i] > 190 && plain[i + 1] < 50 && plain[i + 2] < 50) {
        sawRed = true;
        expect(glazed[i + 2]).toBe(plain[i + 2]); // not washed cooler — the pane's span is below the sprite
      }
    }
    expect(sawRed).toBe(true); // the floating sprite really rendered against the sky
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
    // Room A → glass at y=6 → Room B, with a RAISED COUNTER block (floor 1.2) sitting in A at y[3..4], in front
    // of the glass. Looking down over the counter, the glass opening is recorded behind it — its tint must NOT
    // bleed onto the nearer counter top (the z-test).
    const withCounter = (counter: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 }, // 0 A
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 }, // 1 B (behind the glass)
        { floorZ: 1.2, ceilZ: 4, floorTex: 'STEP', ceilTex: 'CEIL', light: 220 }, // 2 counter (raised block in A)
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
        { v1: 0, v2: 2, front: tex(0), back: null }, // A west
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass: true }, // A|B glass
        { v1: 3, v2: 1, front: tex(0), back: null }, // A east
        { v1: 1, v2: 0, front: tex(0), back: null }, // A south
        { v1: 2, v2: 4, front: tex(1), back: null }, // B west
        { v1: 4, v2: 5, front: tex(1), back: null }, // B north
        { v1: 5, v2: 3, front: tex(1), back: null }, // B east
        // the raised counter block (front = block, back = A) — only when `counter`
        ...(counter
          ? [
              { v1: 6, v2: 9, front: tex(2), back: tex(0) }, // west
              { v1: 9, v2: 8, front: tex(2), back: tex(0) }, // south
              { v1: 8, v2: 7, front: tex(2), back: tex(0) }, // east
              { v1: 7, v2: 6, front: tex(2), back: tex(0) }, // north
            ]
          : []),
      ],
    });
    const cam: Camera = { x: 4, y: 2, angle: Math.PI / 2, z: 1.6 };
    const buf = renderFrame(buildBsp(withCounter(true)), cam, CONFIG, TEX);

    for (let i = 3; i < buf.length; i += 4) {
      expect(buf[i]).toBe(255); // ran + opaque
    }
    // the counter changed the frame vs a glass-only room (it drew + occluded), i.e. the counter is really there
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
    // pane texture: TOP half opaque GREEN (a mullion), BOTTOM half clear glass. A plain (non-pane) glass line
    // would wash a flat cool tint and never sample this → no green. A PANE line samples it → green is stamped.
    const paneTex = {
      width: 4,
      height: 4,
      pixels: new Uint8ClampedArray([
        30,
        220,
        30,
        255,
        30,
        220,
        30,
        255,
        30,
        220,
        30,
        255,
        30,
        220,
        30,
        255, // v row 0 opaque green
        30,
        220,
        30,
        255,
        30,
        220,
        30,
        255,
        30,
        220,
        30,
        255,
        30,
        220,
        30,
        255, // v row 1 opaque green
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0, // v row 2 clear
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0, // v row 3 clear
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
        { v1: 2, v2: 3, front: tex(0, 'PANE'), back: tex(1, 'PANE'), glass: true, pane: true }, // A|B textured pane
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
    expect(green).toBe(true); // the pane's opaque texels are stamped (real textured glass), not a flat wash
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
    // Room A (camera) → line at y=6 → Room B, with a saturated-RED sprite in B behind the line. glass on/off.
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
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass }, // A|B — glass pane vs plain see-through portal
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

      // a raw saturated-red sprite pixel (no glass) must turn COOLER (more blue) once seen through the glass
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
    expect(tinted).toBe(true); // the sprite behind the pane got the glass tint (drawn before it would be full red)
  });

  it('retracts a SLIDING glass panel as it opens (more open → less of the pane is tinted)', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'DOORGLASS', // the sliding leaf texture (alpha channel = clear glass)
    });
    // A 2×2 leaf texture, half opaque alu frame + half clear glass → exercises BOTH blend branches.
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
        { v1: 2, v2: 3, front: tex(0), back: tex(1), glass: true, sliding: true }, // index 1 = sliding glass door
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
    // openness 1 → the panel is fully retracted (no pane, no tint); use it as the baseline.
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

    expect(tintedVs(at(0))).toBeGreaterThan(tintedVs(at(0.5))); // shut tints the whole pane; half-open, half of it
    expect(tintedVs(at(0.5))).toBeGreaterThan(0); // half-open still tints part of the pane
    // No `slides` array at all → the sliding pane defaults to shut (exercises the `?? 0` fallback).
    expect(tintedVs(renderFrame(doorMap, cam, CONFIG, TEXD))).toBeGreaterThan(0);

    // A SHUT door must have NO see-through hole at the centre seam (the camera looks straight at u=lineLen/2,
    // so a column lands exactly there): scan a mid row and assert the covered span has no interior gap.
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
    expect(lo).toBeGreaterThanOrEqual(0); // the shut door was drawn at all
    expect(hole).toBe(false); // …and with no uncovered column between its edges (no centre-seam hole)
  });

  it('textures the whole view — ceiling, walls and floor are all cast/sampled (no flat bands)', () => {
    const buf = renderFrame(MAP, { x: 4, y: 5, angle: 0.3, z: 1.6 }, CONFIG, TEX);

    expect(coloursIn(buf, 0, CONFIG.height * 0.3)).toBeGreaterThan(4); // ceiling cast (+ some wall)
    expect(coloursIn(buf, CONFIG.height * 0.4, CONFIG.height * 0.6)).toBeGreaterThan(4); // walls
    expect(coloursIn(buf, CONFIG.height * 0.7, CONFIG.height)).toBeGreaterThan(4); // floor cast
  });

  it('selects per-surface textures: brick room walls vs the metal platform (its step/canopy bands)', () => {
    const buf = renderFrame(MAP, { x: 2, y: 5, angle: 0.2, z: 1.4 }, CONFIG, TEX);
    let metal = false; // bluish (B ≫ R) — the platform's metal panelling
    let brick = false; // strongly reddish (R ≫ B) — the room's brick (not the tan floor)

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

    expect(metal).toBe(true); // the platform's step + canopy render in metal
    expect(brick).toBe(true); // the walls render in brick
  });

  it('scales a flat texture by its worldSize (tiles at a larger world period)', () => {
    const cam = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const base = renderFrame(MAP, cam, CONFIG, TEX); // FLOOR tiles every 1 unit (no worldSize)
    const scaled = new Map(TEX);

    scaled.set('FLOOR', { ...floorTexture(), worldSize: 4 }); // same art, tiled every 4 units instead
    const out = renderFrame(MAP, cam, CONFIG, scaled);

    expect(Array.from(out)).not.toEqual(Array.from(base)); // the floor samples differently → frame differs
  });

  it('scales a wall texture by its worldSize (one full-height panel, not a vertical repeat)', () => {
    const cam = { x: 2, y: 5, angle: 0.2, z: 1.4 };
    const base = renderFrame(MAP, cam, CONFIG, TEX); // BRICK tiles every 1 unit (no worldSize)
    const scaled = new Map(TEX);

    scaled.set('BRICK', { ...brickTexture(), worldSize: 4 }); // span 4 world units per panel instead
    const out = renderFrame(MAP, cam, CONFIG, scaled);

    expect(Array.from(out)).not.toEqual(Array.from(base)); // the wall samples differently → frame differs
  });

  it('renders in row bands that tile into the identical whole frame (the worker split)', () => {
    const cam = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const whole = renderFrame(MAP, cam, CONFIG, TEX);
    const banded = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);
    const zb = new Float32Array(CONFIG.width * CONFIG.height);
    const mid = Math.floor(CONFIG.height / 2);

    renderFrame(MAP, cam, CONFIG, TEX, banded, zb, 0, mid); // top band
    renderFrame(MAP, cam, CONFIG, TEX, banded, zb, mid, CONFIG.height); // bottom band

    expect(Array.from(banded)).toEqual(Array.from(whole)); // bands compose to a pixel-identical frame
  });

  it('draws billboard sprites (a barrel) in view', () => {
    const buf = renderFrame(MAP, { x: 5, y: 1, angle: Math.PI / 2, z: 1.4 }, CONFIG, TEX);

    expect(hasGreen(buf)).toBe(true); // the barrel at (5,3) is ahead and visible
  });

  it('occludes sprites behind solid walls but shows them when unobstructed (depth test)', () => {
    const map = buildBsp({ ...SAMPLE_MAP, things: [{ x: 5, y: -1, angle: 0, type: 'barrel' }] });
    const inside = renderFrame(map, { x: 5, y: 2, angle: -Math.PI / 2, z: 1.4 }, CONFIG, TEX);
    const outside = renderFrame(map, { x: 5, y: -3, angle: Math.PI / 2, z: 1.4 }, CONFIG, TEX);

    expect(hasGreen(inside)).toBe(false); // hidden by the solid south wall
    expect(hasGreen(outside)).toBe(true); // directly visible from outside
  });

  it('pitch shears the view vertically (look up/down)', () => {
    const base = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const level = renderFrame(MAP, base, CONFIG, TEX);
    const lookUp = renderFrame(MAP, { ...base, pitch: 0.5 }, CONFIG, TEX);

    expect(Array.from(lookUp)).not.toEqual(Array.from(level)); // the horizon (and all of it) shifts
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
      { x: 6, y: 5 }, // inside
      { x: -5, y: 5 }, // west, outside (sees wall backs → back-face culling)
      { x: 20, y: 5 }, // east, outside
      { x: 8, y: -5 }, // south, outside
      { x: 8, y: 15 }, // north, outside
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
  // A 10×10 open room; camera at the centre facing +x, a billboard 3 cells ahead.
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
  // 2×2 atlas, one opaque texel per cell: (0,0) red · (1,0) green · (0,1) blue · (1,1) yellow.
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

  /** Is a colour close to (r,g,b) present anywhere in the frame? */
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

    expect(has(yellow, 250, 250, 20)).toBe(true); // cell (1,1) = yellow drawn
    expect(has(yellow, 250, 20, 20)).toBe(false); // cell (0,0) red NOT drawn

    const red = render({ ...sprite, col: 0, row: 0 });

    expect(has(red, 250, 20, 20)).toBe(true); // cell (0,0) = red drawn
    expect(has(red, 250, 250, 20)).toBe(false); // yellow NOT drawn
  });

  it('brightens a billboard additively at full hit-flash (×2, clipped), not a flat white', () => {
    const flashed = render({ ...sprite, col: 0, row: 0, flash: 1 });

    expect(has(flashed, 255, 40, 40)).toBe(true); // red (250,20,20) ×2 → R clips to 255, G/B doubled
    expect(has(flashed, 250, 20, 20)).toBe(false); // not the un-flashed colour (it brightened)
  });

  describe('mapSprites (directional props)', () => {
    // The same 10×10 room, dressed: a symmetric plant, a north-facing totem, and one of each new prop.
    const north = Math.PI * 1.5; // y-down convention — the totem faces the room's top edge
    const dressed = buildBsp({
      ...ROOM,
      things: [
        { x: 2, y: 2, angle: 0, type: 'prop' },
        { x: 5, y: 5, angle: north, type: 'prop_totem' },
        { x: 3, y: 7, angle: 0, type: 'prop_board' },
        { x: 7, y: 3, angle: Math.PI, type: 'prop_chair' },
        { x: 8, y: 8, angle: 0, type: 'prop_cooler' },
        { x: 5, y: 8, angle: 0, type: 'player_start' }, // no sprite def — must not emit
      ],
    });

    it('emits rotation-sheet BILLBOARDS for directional props, plain billboards for symmetric ones', () => {
      const sprites = mapSprites(dressed);

      expect(sprites).toHaveLength(5); // the player_start emits nothing
      const [plant, totem, board, chair, cooler] = sprites;

      // Symmetric props: whole-texture billboards, no atlas, no rotation metadata.
      expect(plant).toEqual({ x: 2, y: 2, z: 0, tex: 'PROP', width: 0.8, height: 1.6 });
      expect(cooler).toEqual({ x: 8, y: 8, z: 0, tex: 'PROP_COOLER', width: 0.6, height: 1.5 });
      // Directional props: a 1×4 sheet + the authored facing. EVERY directional prop opts into the
      // world-anchored `voxel` volume (the rotation sheet stays its billboard fallback wherever the
      // carved grid didn't decode — SSR, procedural library, a failed load).
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
  // A 12×12 open room. The grids are HAND-BUILT voxel textures (carving is voxel-carve's concern — the
  // renderer's contract starts at a grid) with one solid colour per voxel, so "which cells face the
  // screen" reads directly off the framebuffer.
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

  /** Hand-build an n×ny×nz voxel-grid texture (the `voxel-carve` encoding: bottom-up slices of ny
   *  rows; alpha 0 = empty) from a per-voxel colour function. */
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
    ['DEPTH', grid(2, 2, 2, (_x, y) => (y === 0 ? BLUE : YELLOW))], // front row blue, back row yellow
    ['LATERAL', grid(2, 2, 2, (x) => (x === 0 ? GREEN : RED))], // grid x: 0 green, 1 red
    // Three-voxel corner: front row green+red, back row only (1,1) yellow — (0,1) is EMPTY, so rays
    // can traverse the volume and the yellow flank hides behind red head-on.
    ['CORNER', grid(2, 2, 2, (x, y) => (y === 0 ? (x === 0 ? GREEN : RED) : x === 1 ? YELLOW : null))], // prettier-ignore
    ['GREY', grid(2, 2, 2, () => [100, 100, 100])], // uniform grey — the face-shading probe
    ['SOLIDRED', grid(2, 2, 2, () => RED)],
    ['LONE', grid(3, 3, 3, (x, y, z) => (x === 0 && y === 0 && z === 0 ? RED : null))], // one corner voxel
    ['FARROW', grid(3, 3, 3, (_x, y) => (y === 2 ? RED : null))], // only the far depth row is solid
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

  /** Is an exact (r,g,b) anywhere in the frame? (Full-light sector + near distance → shade 1.) */
  function present(buf: Uint8ClampedArray, [r, g, b]: readonly [number, number, number]): boolean {
    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      if (buf[p * 4] === r && buf[p * 4 + 1] === g && buf[p * 4 + 2] === b) {
        return true;
      }
    }

    return false;
  }

  /** Mean screen column of the pixels whose dominant colour matches, or NaN when none do. */
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
    // Facing 0 → the front row (blue) points +x. From the east the blue faces the camera and fully
    // occludes the yellow back row; from the west the roles swap. A billboard (any cell) would show
    // the same image from both sides.
    const fromFront = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [voxel]);

    expect(present(fromFront, BLUE)).toBe(true); // the depth-axis face shades ×1.0 — exact colour
    expect(meanColumn(fromFront, isYellowish)).toBeNaN();

    const fromBehind = render({ x: 5, y: 6, angle: 0, z: 1.6 }, [voxel]);

    expect(present(fromBehind, YELLOW)).toBe(true);
    expect(meanColumn(fromBehind, (r, g, b) => b > 150 && r < 60 && g < 60)).toBeNaN();
  });

  it('keeps the head-on art chirality and mirrors with the WORLD when viewed from behind', () => {
    // Grid x runs the front view's left→right: head-on from the east (the front viewer), grid x = 0
    // (green) must sit screen-LEFT — exactly where the billboard drew the sheet's left edge. From
    // the west the same world halves land on swapped screen sides (the object did not turn).
    const lateral: Sprite = { ...voxel, tex: 'LATERAL' };
    const fromFront = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [lateral]);

    expect(meanColumn(fromFront, isGreenish)).toBeLessThan(meanColumn(fromFront, isReddish));

    const fromBehind = render({ x: 5, y: 6, angle: 0, z: 1.6 }, [lateral]);

    expect(meanColumn(fromBehind, isGreenish)).toBeGreaterThan(meanColumn(fromBehind, isReddish));
  });

  it('reveals a flank voxel at a diagonal that stays hidden head-on (a true volume, no cell snap)', () => {
    const corner: Sprite = { ...voxel, tex: 'CORNER' };
    const headOn = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [corner]);

    expect(meanColumn(headOn, isGreenish)).not.toBeNaN(); // both front voxels face the camera…
    expect(meanColumn(headOn, isReddish)).not.toBeNaN();
    expect(meanColumn(headOn, isYellowish)).toBeNaN(); // …and the back voxel hides behind red

    // From the front-right diagonal (y-down: +y is the prop's right) the flank turns into view and
    // the yellow back voxel appears alongside the front faces — in perspective, not a swapped cell.
    const diagonal = render({ x: 10.5, y: 8.5, angle: -Math.PI * 0.75, z: 1.6 }, [corner]);

    expect(meanColumn(diagonal, isYellowish)).not.toBeNaN();
    expect(meanColumn(diagonal, isReddish)).not.toBeNaN();
  });

  it('shades per face: top ×1.18, lateral ×0.82, underside ×0.55, depth faces ×1.0', () => {
    // A uniform-grey volume under full light at < 6 units: the base shade is exactly 1, so each face
    // reads its factor directly (100 → 118 / 82 / 55 / 100).
    const grey: Sprite = { ...voxel, tex: 'GREY', height: 1 }; // short → the top is below eye height
    const fromFront = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [grey]);

    expect(present(fromFront, [100, 100, 100])).toBe(true); // the depth-axis face, ×1.0
    expect(present(fromFront, [118, 118, 118])).toBe(true); // the top, seen from above

    const fromDiagonal = render({ x: 10.5, y: 8.5, angle: -Math.PI * 0.75, z: 1.6 }, [grey]);

    expect(present(fromDiagonal, [82, 82, 82])).toBe(true); // the lateral flank

    const floating: Sprite = { ...grey, z: 2.5 }; // lifted above the eye → the underside shows
    const fromBelow = render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [floating]);

    expect(present(fromBelow, [55, 55, 55])).toBe(true);
  });

  it('WRITES its depth: a nearer-sorted billboard inside the volume cannot paint through it', () => {
    // The billboard's centre (≈2.55) is nearer than the volume's (3.0), so it paints AFTER the
    // volume — and it sits INSIDE the box, behind the near face (≈2.3): only the volume's per-pixel
    // depth WRITE rejects it. Without the write, the billboard tests against the far wall and bleeds.
    const solid: Sprite = { ...voxel, tex: 'SOLIDRED' };
    const inside: Sprite = { x: 8.45, y: 6, z: 0.5, tex: 'MAG', width: 0.2, height: 0.5 };
    const cam: Camera = { x: 11, y: 6, angle: Math.PI, z: 1.6 };

    /** Is the billboard's magenta anywhere in the frame? */
    const magentaIn = (buf: Uint8ClampedArray): boolean => {
      for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
        if (buf[p * 4] === 230 && buf[p * 4 + 1] === 20 && buf[p * 4 + 2] === 230) {
          return true;
        }
      }

      return false;
    };

    expect(magentaIn(render(cam, [inside]))).toBe(true); // sanity: visible without the volume
    expect(magentaIn(render(cam, [solid, inside]))).toBe(false); // fully hidden inside it
  });

  it('is occluded by nearer walls: columns behind a pillar never march the grid', () => {
    // A thin slab wall between the camera and the prop: its columns hold a nearer depth in the
    // z-buffer, so the volume's box entry fails the depth test there (and paints around its edges).
    const walled = buildBsp({
      ...ROOM,
      vertices: [...ROOM.vertices, { x: 9.5, y: 5.6 }, { x: 9.5, y: 6.4 }],
      linedefs: [
        ...ROOM.linedefs,
        { v1: 4, v2: 5, front: SIDE, back: null }, // faces the camera at x=11 (front = right of v1→v2)
      ],
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

    expect(count(behind)).toBeGreaterThan(0); // still peeks past the slab's edges…
    expect(count(behind)).toBeLessThan(count(clear)); // …but the covered columns stay the wall's
  });

  it('marches through empty cells and exits the grid on every axis', () => {
    // A 3×3×3 grid with ONE solid corner voxel: most envelope rays traverse empty cells and leave
    // through a bound (all three axes across these viewpoints); the few aimed at the voxel hit it.
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

    // Head-on: straight rays pierce the empty front cells and exit through the back.
    expect(reds(render({ x: 11, y: 6, angle: Math.PI, z: 1.6 }, [lone]))).toBeGreaterThan(0);
    // Oblique + above the box: rays enter through the top, step across x/y/z, exit the bottom/sides.
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

    // Tangential near-corner cameras at angle 0 — the one viewpoint whose trig is EXACT, so the
    // centre column's ray is exactly lateral-parallel (d = 0): a footprint corner behind the near
    // plane widens the envelope to the whole screen, and the camera sits just OUTSIDE the grid on
    // the lateral axis (above it, then below it).
    expect(reds(render({ x: 7.29, y: 6.75, angle: 0, z: 1.6 }, [solid]))).toBeGreaterThan(0);
    expect(reds(render({ x: 7.29, y: 5.25, angle: 0, z: 1.6 }, [solid]))).toBeGreaterThan(0);
    // Eye EXACTLY on the grid top (camGZ = nz): the horizon row's flat ray starts outside vertically.
    expect(reds(render({ x: 11, y: 6, angle: Math.PI, z: 2 }, [solid]))).toBeGreaterThan(0);
  });

  it('stops a march midway when a nearer wall depth already owns the pixel', () => {
    // A slab wall CUTTING THROUGH the box (between its near and far depth rows): rays enter the
    // empty near cells, march, and must stop at the wall's depth — the far row never paints at the
    // covered columns (it still shows past the slab's edges).
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
    // A SKY courtyard (camera) | glass | room B | glass | room C. The volume FLOATS in B, straddling
    // the pane's top edge (z 4.2..6.2 vs an opening up to z 4): its lower rows tint through the near
    // pane, its upper rows poke into the open sky ABOVE the pane's span (no tint), and the second
    // pane sits BEHIND the volume (the layer scan must stop there, not double-tint).
    const glassSide = (sector: number): SideDef => ({ ...SIDE, sector });
    const scene = (glass: boolean): MapSource => ({
      sectors: [
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'SKY', light: 255 }, // courtyard — open sky
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'SKY', light: 255 }, // B
        { floorZ: 0, ceilZ: 4, floorTex: 'FLOOR', ceilTex: 'SKY', light: 255 }, // C
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
    // All-red volume facing the camera (facing −y), floating HIGH: the pane's recorded span tops out
    // at the ceiling seen at the WALL's depth (screen row ~4 here), so the volume needs z beyond ~5.8
    // for its upper rows to clear it against the open sky.
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
        // A red volume pixel: through the pane it washes cooler (blue up, red down) ONCE; above the
        // pane's span it stays byte-identical.
        if (glazed[i] === plain[i] && glazed[i + 2] === plain[i + 2]) {
          untouched++;
        } else if (glazed[i + 2] > plain[i + 2] + 30 && glazed[i] < plain[i]) {
          tinted++;
        }
      }
    }
    expect(tinted).toBeGreaterThan(20); // rows inside the pane span, washed exactly once
    expect(untouched).toBeGreaterThan(20); // rows above the pane span, not washed
  });

  it('projects a voxel quad with the grid-space camera/axes and a conservative envelope', () => {
    const focal = focalFor(CONFIG.width, CONFIG.fov);
    const [quad] = projectSprites([voxel], room, { x: 11, y: 6, angle: Math.PI, z: 1.6 }, CONFIG.width, focal, CONFIG.height >> 1, tex); // prettier-ignore
    const vox = quad.vox;
    const scale = 2 / 1.4; // grid cells per world unit

    expect(vox).toBeDefined();
    expect(vox).toMatchObject({ n: 2, ny: 2, nz: 2 });
    // Facing 0, camera due east looking west: grid x runs +y (0 world offset), depth runs −x.
    expect(vox?.camGX).toBeCloseTo(1, 10); // laterally centred
    expect(vox?.camGY).toBeCloseTo(1 - 3 * scale, 10); // 3 units in FRONT of the grid (negative depth)
    expect(vox?.camGZ).toBeCloseTo(1.6, 10); // zScale = nz / height = 1
    expect(vox?.fwdGX).toBeCloseTo(0, 10);
    expect(vox?.fwdGY).toBeCloseTo(scale, 10); // looking straight INTO the depth axis
    expect(vox?.rightGX).toBeCloseTo(-scale, 10);
    expect(vox?.rightGY).toBeCloseTo(0, 10);
    // The envelope brackets the prop (centre column 60) without going degenerate.
    expect(quad.left).toBeLessThan(60);
    expect(quad.right).toBeGreaterThan(60);
    expect(quad.yTop).toBeLessThan(quad.yBottom);
    // A missing facing defaults to 0.
    const cam: Camera = { x: 11, y: 8, angle: Math.PI * 0.9, z: 1.6 };

    expect(projectSprites([{ ...voxel, facing: undefined }], room, cam, CONFIG.width, focal, 40, tex)) // prettier-ignore
      .toEqual(projectSprites([{ ...voxel, facing: 0 }], room, cam, CONFIG.width, focal, 40, tex));
  });

  it('falls back to the plain billboard quad when the texture carries no carved grid', () => {
    const focal = focalFor(CONFIG.width, CONFIG.fov);
    const flat = new Map([...tex, ['DEPTH', { ...magenta }]]); // same name, NO voxelDepth
    const cam: Camera = { x: 11, y: 6, angle: Math.PI, z: 1.6 };
    const project = (sprites: readonly Sprite[], lib: Map<string, Texture>) =>
      projectSprites(sprites, room, cam, CONFIG.width, focal, CONFIG.height >> 1, lib);
    const [fallback] = project([voxel], flat);

    expect(fallback.vox).toBeUndefined(); // a billboard quad…
    expect(project([voxel], flat)).toEqual(project([{ ...voxel, voxel: undefined }], flat)); // …exactly

    // And behind the near plane, a voxel sprite culls exactly like a billboard.
    expect(project([{ ...voxel, x: 11.5 }], tex)).toEqual([]);
  });

  it('widens the envelope to the whole screen when a footprint corner crosses the near plane', () => {
    const focal = focalFor(CONFIG.width, CONFIG.fov);
    // The camera stands INSIDE the footprint's x-range, a hair short of the near face: the closest
    // corners project behind the near plane while the centre is still visible.
    const cam: Camera = { x: 8.71, y: 6, angle: Math.PI, z: 1.6 };
    const [quad] = projectSprites([{ ...voxel, tex: 'SOLIDRED' }], room, cam, CONFIG.width, focal, CONFIG.height >> 1, tex); // prettier-ignore

    expect(quad.left).toBe(0);
    expect(quad.right).toBe(CONFIG.width - 1);
    // And the render still resolves per pixel (the DDA walks from the near plane, inside the box).
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
  // Solid-colour wall textures so neighbor pixels are unmistakable in the frame.
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
  const SEAM = { zone: 'nb', dx: -100, dy: 0 } as const; // neighbor point + (−100, 0) = local point

  /** The LOCAL room (x0..8, y0..8): camera inside, the whole north edge (y=8) is the live seam into 'nb'.
   *  `pillar` drops a solid block (x3.5..4.5, y5..6) in front of the seam's centre — a nearer occluder
   *  whose edges also split the seam linedef in the BSP. */
  function local(opts: { pillar?: boolean } = {}): CompiledMap {
    return buildBsp({
      sectors: [sector],
      things: [],
      vertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 0, y: 8 },
        { x: 8, y: 8 },
        { x: 3.5, y: 5 }, // 4 (pillar corners — unused without it)
        { x: 4.5, y: 5 }, // 5
        { x: 4.5, y: 6 }, // 6
        { x: 3.5, y: 6 }, // 7
      ],
      linedefs: [
        { v1: 0, v2: 2, front: side(0), back: null }, // west
        { v1: 2, v2: 3, front: side(0), back: null, zonePortal: SEAM }, // the SEAM (index 1)
        { v1: 3, v2: 1, front: side(0), back: null }, // east
        { v1: 1, v2: 0, front: side(0), back: null }, // south
        ...(opts.pillar
          ? [
              { v1: 4, v2: 5, front: side(0), back: null }, // pillar north face (outside = the room)
              { v1: 5, v2: 6, front: side(0), back: null }, // east
              { v1: 6, v2: 7, front: side(0), back: null }, // south
              { v1: 7, v2: 4, front: side(0), back: null }, // west
            ]
          : []),
      ],
    });
  }

  /** The NEIGHBOR zone 'nb' in its OWN coordinates (x100..108, y8..16 — offset (−100, 0) from local):
   *  all-green walls. `sky` opens its ceiling; `glass` splits it with a see-through pane at y=12;
   *  `portalTo` turns its far (north) wall into a further zone portal (the recursion-cap fixture). */
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
        { x: 100, y: 12 }, // 4 (glass split — unused otherwise)
        { x: 108, y: 12 }, // 5
      ],
      linedefs: [
        { v1: 0, v2: 2, front: side(0, 'NGREEN'), back: null }, // west
        { v1: 2, v2: 3, front: side(backSector, 'NGREEN'), back: null, ...far }, // north (far) wall
        { v1: 3, v2: 1, front: side(backSector, 'NGREEN'), back: null }, // east
        { v1: 1, v2: 0, front: side(0, 'NGREEN'), back: null }, // south (the seam plane; back-face → open)
        ...(opts.glass
          ? [{ v1: 4, v2: 5, front: side(0, 'NGREEN'), back: side(1, 'NGREEN'), glass: true }]
          : []),
      ],
    });
  }

  /** The third zone 'far' behind the neighbor's own portal (x200..208, y16..24): all-red walls. */
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

  /** Wrap a compiled map (+ optional live sprites) as the {@link ZoneNeighbor} the renderer takes. */
  const zone = (map: CompiledMap, sprites?: readonly Sprite[]): ZoneNeighbor => ({ map, sprites });

  function render(
    map: CompiledMap,
    neighbors?: ReadonlyMap<string, ZoneNeighbor>,
    sprites?: readonly Sprite[],
    cam: Camera = CAM,
  ): Uint8ClampedArray {
    return renderFrame(map, cam, CONFIG, TEXP, undefined, undefined, 0, CONFIG.height, sprites, undefined, neighbors); // prettier-ignore
  }

  /** Count the frame's pixels matching a dominant-colour predicate. */
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

    expect(countWhere(live, isGreen)).toBeGreaterThan(50); // the neighbor's green walls fill the window

    const solid = render(map);

    expect(countWhere(solid, isGreen)).toBe(0); // no neighbors given → the seam painted its middle texture
    // An EMPTY neighbors map behaves exactly like none (allocation differs, output must not).
    expect(Array.from(render(map, new Map()))).toEqual(Array.from(solid));
    // And neighbors on a map WITHOUT portal seams change nothing (no recording is even allocated).
    expect(Array.from(renderFrame(MAP, CAM, CONFIG, TEXP, undefined, undefined, 0, CONFIG.height, undefined, undefined, new Map([['nb', zone(neighbor())]])))) // prettier-ignore
      .toEqual(Array.from(renderFrame(MAP, CAM, CONFIG, TEXP)));
  });

  it('ray-marches a warm neighbor VOXEL prop through the seam, clipped to its recorded windows', () => {
    // An all-red 2×2×2 voxel grid: whichever faces show, their pixels read saturated red.
    const redGrid: Texture = {
      width: 2,
      height: 4,
      pixels: new Uint8ClampedArray(Array.from({ length: 8 }, () => [250, 20, 20, 255]).flat()),
      voxelDepth: 2,
    };
    const lib = new Map([...TEXP, ['REDGRID', redGrid]]);
    const voxSpr: Sprite = {
      x: 105, // local x = 5: the volume straddles the pillar's screen shadow — some columns are
      y: 10, // seam windows (painted), some are the pillar's (the volume must not leak there)
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

    expect(open).toBeGreaterThan(30); // the volume shows through the un-occluded seam…
    expect(blocked).toBeGreaterThan(0); // …still peeks past the pillar's edge…
    expect(blocked).toBeLessThan(open); // …but the pillar's columns clip it (no leak outside the windows)
  });

  it('reuses its per-context scratch without leaking state: interleaved heterogeneous renders stay byte-identical', () => {
    // The richest frame the scratch serves: a BSP-split seam (pillar), a glass-bearing neighbor, a local
    // sprite AND a neighbor sprite through the window — glass, portal and clip records all live.
    const map = local({ pillar: true });
    const nbSpr: Sprite[] = [{ x: 104, y: 10, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 }];
    const nbs = new Map([['nb', zone(neighbor({ glass: true }), nbSpr)]]);
    const spr: Sprite[] = [{ x: 3, y: 4, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 }];
    const first = Array.from(render(map, nbs, spr));

    // A DIFFERENT scene at a DIFFERENT resolution (scratch resize), then a glass-free portal-free render
    // back at the original resolution — both leave stale records a leaky reuse would replay.
    renderFrame(MAP, CAM, { width: 64, height: 48, fov: Math.PI / 2 }, TEX);
    renderFrame(MAP, CAM, CONFIG, TEX);

    expect(Array.from(render(map, nbs, spr))).toEqual(first); // identical inputs → identical pixels
  });

  it('falls back to the solid middle when the seam names a zone the neighbors map lacks', () => {
    const map = local();

    expect(Array.from(render(map, new Map([['far', zone(FAR)]])))).toEqual(Array.from(render(map)));
  });

  it('occludes the portal behind nearer local geometry (a pillar in front of the seam)', () => {
    const map = local({ pillar: true });

    // The pillar's edges split the seam linedef in the BSP — the seam registers ONCE even across segs.
    expect(map.segs.filter((s) => s.linedef === 1).length).toBeGreaterThan(1);

    const live = render(map, new Map([['nb', zone(neighbor())]]));
    const mid = CONFIG.height >> 1;
    let centreGreen = false;
    let flankGreen = false;

    for (let y = 0; y < CONFIG.height; y++) {
      const c = pixel(live, 60, y); // dead centre — the pillar blocks the seam here
      const f = pixel(live, 25, y); // flank — open window into the neighbor

      centreGreen = centreGreen || isGreen(c[0], c[1], c[2]);
      flankGreen = flankGreen || isGreen(f[0], f[1], f[2]);
    }
    expect(centreGreen).toBe(false);
    expect(flankGreen).toBe(true);
    expect(pixel(live, 60, mid)[3]).toBe(255); // the pillar column really painted (opaque)
  });

  it('caps recursion at depth 1: a portal seen through a portal paints its solid middle, not the third zone', () => {
    const neighbors = new Map([
      ['nb', zone(neighbor({ portalTo: 'far' }))],
      ['far', zone(FAR)],
    ]);
    const live = render(local(), neighbors);

    expect(countWhere(live, isGreen)).toBeGreaterThan(50); // depth 1 renders (incl. the capped seam's NGREEN middle)
    expect(countWhere(live, isMag)).toBe(0); // the third zone never renders through two seams

    // Sanity: the same 'far' zone DOES render when the camera stands in 'nb' itself (depth 1 from there).
    const inNb = render(neighbor({ portalTo: 'far' }), neighbors, undefined, {
      x: 104,
      y: 10,
      angle: Math.PI / 2,
      z: 1.6,
    });

    expect(countWhere(inNb, isMag)).toBeGreaterThan(50);
  });

  it('tints the portal view through a local glass pane standing in front of the seam', () => {
    // A0 (camera, y0..4) | glass pane at y=4 | A1 (y4..8) | seam at y=8 into 'nb'.
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
        { v1: 2, v2: 3, front: side(0), back: side(1), glass: true }, // the pane in front of the seam
        { v1: 3, v2: 1, front: side(0), back: null },
        { v1: 1, v2: 0, front: side(0), back: null },
        { v1: 2, v2: 4, front: side(1), back: null },
        { v1: 4, v2: 5, front: side(1), back: null, zonePortal: SEAM }, // the seam, beyond the pane
        { v1: 5, v2: 3, front: side(1), back: null },
      ],
    });
    const nb = new Map([['nb', zone(neighbor())]]);
    const plain = render(local(), nb); // same view, no pane
    const glazed = render(glazedLocal, nb);
    let cooler = false;

    for (let p = 0; p < CONFIG.width * CONFIG.height; p++) {
      const i = p * 4;

      // a green neighbor pixel (through the seam alone) must read COOLER once a pane stands in front
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
        sky = true; // a clearly blue-dominant pixel — the sky gradient through the seam
        break;
      }
    }
    expect(sky).toBe(true);
  });

  it('keeps the z-buffer coherent: a local sprite in FRONT of the seam draws over the portal view', () => {
    const red: Sprite = { x: 4, y: 6, z: 0, tex: 'NMAG', width: 2, height: 2.5 };
    const live = render(local(), new Map([['nb', zone(neighbor())]]), [red]);

    expect(countWhere(live, isMag)).toBeGreaterThan(20); // the sprite won the depth test over neighbor pixels
    expect(countWhere(live, isGreen)).toBeGreaterThan(20); // …while the window still shows the neighbor around it
  });

  it('handles SEVERAL seam linedefs in one frame — one registered seam and one pass each', () => {
    // The same opening authored as TWO independent seam linedefs (x0..4 + x4..8) into the same zone: the
    // passes tile per seam, and the frame is pixel-identical to the single-linedef seam.
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
        { v1: 2, v2: 3, front: side(0), back: null, zonePortal: SEAM }, // west half of the seam
        { v1: 3, v2: 4, front: side(0), back: null, zonePortal: SEAM }, // east half — a distinct linedef
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
    const away: Camera = { x: 4, y: 2, angle: -Math.PI / 2, z: 1.6 }; // back to the seam

    expect(Array.from(render(map, nb, undefined, away))).toEqual(
      Array.from(render(map, undefined, undefined, away)),
    );

    // A full-width wall at y=6 hides the seam entirely: the seam segs are still visited (registered), but
    // no column records → its neighbor pass is skipped, and the frame matches the no-neighbors render.
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
        { v1: 4, v2: 5, front: side(0), back: null }, // the blocker, nearer than the seam
      ],
    });

    expect(Array.from(render(blocked, nb))).toEqual(Array.from(render(blocked)));
  });

  describe('neighbor sprites (a warm zone alive through the window)', () => {
    // A magenta billboard standing in the NEIGHBOR's own coordinates, dead ahead through the seam.
    const foe: Sprite = { x: 104, y: 11, z: 0, tex: 'NMAG', width: 1.5, height: 2 };

    it('draws a neighbor sprite through the seam window, and none without the sprites channel', () => {
      const live = render(local(), new Map([['nb', zone(neighbor(), [foe])]]));

      expect(countWhere(live, isMag)).toBeGreaterThan(20); // the warm foe shows through the window

      const calm = render(local(), new Map([['nb', zone(neighbor())]]));

      expect(countWhere(calm, isMag)).toBe(0); // geometry-only neighbor (stage-2 behaviour) — no sprite
      // An explicit EMPTY sprite list renders exactly like the geometry-only neighbor.
      expect(Array.from(render(local(), new Map([['nb', zone(neighbor(), [])]])))).toEqual(
        Array.from(calm),
      );
    });

    it("z-tests a neighbor sprite against the neighbor's own geometry (drawn behind its far wall: absent)", () => {
      // Behind the neighbor's north wall (y=16 in nb coords) → every pixel loses the depth test.
      const buried: Sprite = { ...foe, y: 17 };
      const live = render(local(), new Map([['nb', zone(neighbor(), [buried])]]));

      expect(countWhere(live, isMag)).toBe(0);
    });

    it('occludes a neighbor sprite behind nearer LOCAL geometry (the pillar in front of the seam)', () => {
      const nbWith = (spr: Sprite): ReadonlyMap<string, ZoneNeighbor> =>
        new Map([['nb', zone(neighbor(), [spr])]]);

      // Open window: the centred foe (columns ~55..65) shows; the pillar (shadowing columns ~50..70)
      // then hides it COMPLETELY — its columns never record a portal window, so the sprite clips out.
      expect(countWhere(render(local(), nbWith(foe)), isMag)).toBeGreaterThan(20);
      expect(countWhere(render(local({ pillar: true }), nbWith(foe)), isMag)).toBe(0);
      // …while the window stays live beside the pillar: a foe standing west of its shadow still shows.
      const west: Sprite = { ...foe, x: 100.5 };

      expect(countWhere(render(local({ pillar: true }), nbWith(west)), isMag)).toBeGreaterThan(0);
    });

    it('clips a neighbor sprite to the seam windows — no pixel outside a recorded portal column', () => {
      // An L-shaped local room: the seam covers only x0..6 of the north wall; a corridor (x6..8) runs on
      // past it to y16, so columns right of the window see DEEP local floor/walls a translated neighbor
      // sprite would beat on depth alone — only the window clip keeps it inside the opening.
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
          { v1: 0, v2: 2, front: side(0), back: null }, // west
          { v1: 2, v2: 3, front: side(0), back: null, zonePortal: SEAM }, // seam: x0..6 of the north edge
          { v1: 3, v2: 4, front: side(0), back: null }, // corridor west wall
          { v1: 4, v2: 5, front: side(0), back: null }, // corridor far end (deep — y16)
          { v1: 5, v2: 1, front: side(0), back: null }, // east
          { v1: 1, v2: 0, front: side(0), back: null }, // south
        ],
      });
      // In nb coords (107, 9) = local (7, 9): INSIDE the neighbor, but its billboard projects into the
      // corridor's columns (right of the seam's edge) where the local depths are farther than the sprite.
      const straddling: Sprite = { x: 107, y: 9, z: 0, tex: 'NMAG', width: 2, height: 2.5 };
      const live = render(lShaped, new Map([['nb', zone(neighbor(), [straddling])]]));
      let inWindow = 0;
      let inCorridor = 0;

      for (let x = 0; x < CONFIG.width; x++) {
        for (let y = 0; y < CONFIG.height; y++) {
          const c = pixel(live, x, y);

          if (isMag(c[0], c[1], c[2])) {
            if (x >= 85) {
              inCorridor++; // the corridor's columns start well right of the seam's last column (~80)
            } else {
              inWindow++;
            }
          }
        }
      }
      expect(inWindow).toBeGreaterThan(0); // the sprite's window-side edge still shows through the seam
      expect(inCorridor).toBe(0); // …but not one pixel leaked past the opening into local geometry
    });

    it("tints a neighbor sprite behind the neighbor's OWN glass pane", () => {
      const behindPane: Sprite = { ...foe, y: 12.5 }; // just beyond nb's y=12 pane (near enough to read magenta)
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
