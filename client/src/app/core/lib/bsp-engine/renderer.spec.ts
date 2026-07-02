import { describe, it, expect } from 'vitest';
import { buildBsp } from './node-builder';
import { renderFrame, type Sprite } from './renderer';
import { barrelTexture, brickTexture, ceilTexture, floorTexture, metalTexture } from './texture';
import { SAMPLE_MAP } from './sample-map';
import type { Camera } from './camera';
import type { MapSource, SideDef } from './types';

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

  it('retracts a SLIDING glass panel as it opens (more open → less of the pane is tinted)', () => {
    const tex = (sector: number): SideDef => ({
      sector,
      xOffset: 0,
      yOffset: 0,
      upperTex: 'BRICK',
      lowerTex: 'BRICK',
      middleTex: 'BRICK',
    });
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
      renderFrame(doorMap, cam, CONFIG, TEX, undefined, undefined, 0, CONFIG.height, undefined, [
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
    expect(tintedVs(renderFrame(doorMap, cam, CONFIG, TEX))).toBeGreaterThan(0);
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
});
