import { describe, expect, it } from 'vitest';
import {
  buildFrameCommands,
  createFrameCommands,
  GLASS_STRIDE,
  PHASE_STRIDE,
  SPAN_FLAT,
  SPAN_SKY,
  SPAN_STRIDE,
  SPAN_WALL,
  SPRITE_STRIDE,
  type FrameCommands,
} from './frame-commands';
import { buildBsp } from './node-builder';
import {
  BG_CEILING,
  BG_FLOOR,
  coolGlassTint,
  FLAT_ANCHOR,
  renderFrame,
  TEX_ANCHOR,
  type Sprite,
  type ZoneNeighbor,
} from './renderer';
import {
  brickTexture,
  ceilTexture,
  floorTexture,
  metalTexture,
  missingTexture,
  type Texture,
  type TextureLibrary,
} from './texture';
import { SAMPLE_MAP } from './sample-map';
import type { Camera } from './camera';
import type { MapSource, SideDef } from './types';

const MAP = buildBsp(SAMPLE_MAP);
const CONFIG = { width: 120, height: 80, fov: Math.PI / 2 };
const TEX = new Map([
  ['BRICK', brickTexture()],
  ['METAL', metalTexture()],
  ['FLOOR', floorTexture()],
  ['STEP', metalTexture()],
  ['CEIL', ceilTexture()],
]);

/** The GPU texture-pool convention: id 0 = MISSING, then the library entries in insertion order. */
function texturePool(lib: ReadonlyMap<string, Texture>): {
  ids: Map<string, number>;
  pool: Texture[];
} {
  const pool: Texture[] = [missingTexture()];
  const ids = new Map<string, number>();

  for (const [name, tex] of lib) {
    ids.set(name, pool.length);
    pool.push(tex);
  }

  return { ids, pool };
}

/**
 * A REFERENCE executor: replays a command buffer into a framebuffer with the renderer's EXACT per-pixel
 * math (same f64 expressions, same integer truncations, same accumulation order, same strict `<` depth
 * test over the same paint order) — what the WGSL compute shader does in f32. It covers the FULL stage-2
 * format: the merged geometry stream, then each recorded PHASE in order (a glass set blended farthest-
 * first, then its sprites far-to-near, window-clipped and glass-tinted). Byte-identity between this and
 * `renderFrame` proves the command buffer carries EVERYTHING the per-pixel work needs.
 */
function execute(cmds: FrameCommands, pool: readonly Texture[]): Uint8ClampedArray {
  const { width, height, focal, horizon, camZ } = cmds;
  const buf = new Uint8ClampedArray(width * height * 4);
  const buf32 = new Uint32Array(buf.buffer);
  const zbuf = new Float32Array(width * height).fill(Infinity);
  const skyEnd = Math.max(0, Math.min(width * height, horizon * width));

  buf32.fill(
    (0xff000000 | (BG_CEILING[2] << 16) | (BG_CEILING[1] << 8) | BG_CEILING[0]) >>> 0,
    0,
    skyEnd,
  );
  buf32.fill((0xff000000 | (BG_FLOOR[2] << 16) | (BG_FLOOR[1] << 8) | BG_FLOOR[0]) >>> 0, skyEnd);

  for (let x = 0; x < width; x++) {
    const off = cmds.columns[2 * x];
    const count = cmds.columns[2 * x + 1];

    for (let s = 0; s < count; s++) {
      const base = (off + s) * SPAN_STRIDE;
      const kind = cmds.spanWords[base];
      const y0 = cmds.spanWords[base + 2];
      const y1 = cmds.spanWords[base + 3];
      const tex = pool[cmds.spanWords[base + 1]];

      if (kind === SPAN_WALL) {
        const u = cmds.spanFloats[base + 4];
        const zPerRow = cmds.spanFloats[base + 5];
        const shade = cmds.spanFloats[base + 6];
        const forward = cmds.spanFloats[base + 7];
        const { width: tw, height: th, pixels: px } = tex;
        const perUnit = th / (tex.worldSize ?? 1);
        const texCol = (u * perUnit) & (tw - 1);
        let vRaw = (TEX_ANCHOR - (camZ + (horizon - y0) * zPerRow)) * perUnit;
        const vStep = zPerRow * perUnit;
        let i = y0 * width + x;

        for (let y = y0; y <= y1; y++) {
          if (forward < zbuf[i]) {
            const ti = (((vRaw & (th - 1)) * tw + texCol) << 2) | 0;

            buf32[i] =
              0xff000000 |
              ((px[ti + 2] * shade) << 16) |
              ((px[ti + 1] * shade) << 8) |
              (px[ti] * shade);
            zbuf[i] = forward;
          }
          i += width;
          vRaw += vStep;
        }
      } else if (kind === SPAN_FLAT) {
        const dz = cmds.spanFloats[base + 4];
        const rayX = cmds.spanFloats[base + 5];
        const rayY = cmds.spanFloats[base + 6];
        const falloff = cmds.spanFloats[base + 7];
        const light = cmds.spanFloats[base + 8];
        const camX = cmds.spanFloats[base + 9]; // the RECORDING pass's camera (translated on a seam)
        const camY = cmds.spanFloats[base + 10];
        const { width: tw, height: th, pixels: px } = tex;
        const inv = 1 / (tex.worldSize ?? 1);
        let i = y0 * width + x;

        for (let y = y0; y <= y1; y++) {
          const dist = dz * (focal / (y - horizon));

          if (dist < zbuf[i]) {
            const tcx = (((camX + dist * rayX) * inv + FLAT_ANCHOR) * tw) & (tw - 1);
            const tcy = (((camY + dist * rayY) * inv + FLAT_ANCHOR) * th) & (th - 1);
            const shade = light * Math.max(0.25, Math.min(1, falloff * (y - horizon)));
            const ti = (tcy * tw + tcx) << 2;

            buf32[i] =
              0xff000000 |
              ((px[ti + 2] * shade) << 16) |
              ((px[ti + 1] * shade) << 8) |
              (px[ti] * shade);
            zbuf[i] = dist;
          }
          i += width;
        }
      } else {
        let i = y0 * width + x;

        for (let y = y0; y <= y1; y++) {
          if (zbuf[i] === Infinity) {
            const t = Math.max(0, Math.min(1, y / horizon));
            const r = (40 + 130 * t) | 0;
            const g = (70 + 130 * t) | 0;
            const b = (140 + 95 * t) | 0;

            buf32[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
          }
          i += width;
        }
      }
    }
  }

  // The deferred PHASES, in recorded order: seam phases (neighbour glass, then its window-clipped
  // sprites), then the primary phase (primary glass, then the frame's sprites) — `renderFrame`'s exact
  // deferred sequence, replayed per pixel off the serialized records.
  const asI32 = (w: number): number => cmds.auxWords[w] | 0;

  for (let ph = 0; ph < cmds.phaseCount; ph++) {
    const pb = ph * PHASE_STRIDE;
    const glassSet = asI32(pb);
    const spriteBase = cmds.auxWords[pb + 1];
    const spriteCount = cmds.auxWords[pb + 2];
    const windowSeam = asI32(pb + 3);

    if (glassSet >= 0) {
      // The set's layers blend FARTHEST → NEAREST per column (blendGlass's k-descending walk).
      for (let x = 0; x < width; x++) {
        const table = 5 * width + 2 * (glassSet * width + x);
        const off = cmds.columns[table];
        const count = cmds.columns[table + 1];

        for (let k = count - 1; k >= 0; k--) {
          const g = off + k * GLASS_STRIDE;
          const y0 = Math.max(0, cmds.auxWords[g] | 0);
          const y1 = Math.min(height - 1, cmds.auxWords[g + 1] | 0);

          if (y1 < y0) {
            continue;
          }
          const vt = cmds.auxWords[g + 2] | 0;
          const vh = (cmds.auxWords[g + 3] | 0) - vt;
          const tu = cmds.auxFloats[g + 4];
          const sh = cmds.auxFloats[g + 5];
          const depth = cmds.auxFloats[g + 6];
          const tex = pool[cmds.auxWords[g + 7]];
          const layerTex = tu >= 0 ? tex.pixels : null;
          const col = layerTex !== null ? Math.min(tex.width - 1, tu | 0) : 0;
          let i = y0 * width + x;

          for (let y = y0; y <= y1; y++) {
            if (zbuf[i] < depth) {
              i += width;
              continue;
            }
            let framed = false;
            let cr = 0;
            let cg = 0;
            let cb = 0;

            if (layerTex !== null) {
              const v = Math.min(tex.height - 1, Math.max(0, (((y - vt) / vh) * tex.height) | 0));
              const ti = (v * tex.width + col) << 2;

              if (layerTex[ti + 3] >= 128) {
                framed = true;
                cr = (layerTex[ti] * sh) | 0;
                cg = (layerTex[ti + 1] * sh) | 0;
                cb = (layerTex[ti + 2] * sh) | 0;
              }
            }
            if (framed) {
              buf32[i] = (0xff000000 | (cb << 16) | (cg << 8) | cr) >>> 0;
              zbuf[i] = depth;
            } else {
              buf32[i] = coolGlassTint(buf32[i]);
            }
            i += width;
          }
        }
      }
    }
    for (let si = 0; si < spriteCount; si++) {
      const sb = spriteBase + si * SPRITE_STRIDE;
      const left = asI32(sb);
      const right = asI32(sb + 1);
      const yTop = asI32(sb + 2);
      const yBottom = asI32(sb + 3);
      const tex = pool[cmds.auxWords[sb + 4]];
      const u0 = cmds.auxWords[sb + 5];
      const v0 = cmds.auxWords[sb + 6];
      const cellW = cmds.auxWords[sb + 7];
      const cellH = cmds.auxWords[sb + 8];
      const forward = cmds.auxFloats[sb + 9];
      const shade = cmds.auxFloats[sb + 10];
      const { width: tw, pixels: px } = tex;
      const colSpan = right - left + 1;
      const rowSpan = yBottom - yTop + 1;
      const yLo = Math.max(0, yTop);
      const yHi = Math.min(height - 1, yBottom);

      for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x++) {
        let colLo = yLo;
        let colHi = yHi;

        if (windowSeam >= 0) {
          const wb = 2 * width + 3 * x;

          if ((cmds.columns[wb] | 0) !== windowSeam) {
            continue;
          }
          colLo = Math.max(colLo, cmds.columns[wb + 1] | 0);
          colHi = Math.min(colHi, cmds.columns[wb + 2] | 0);
        }
        const texCol = u0 + ((((x - left) / colSpan) * cellW) | 0);
        let i = colLo * width + x;

        for (let y = colLo; y <= colHi; y++) {
          const ti = ((v0 + ((((y - yTop) / rowSpan) * cellH) | 0)) * tw + texCol) << 2;

          if (forward < zbuf[i] && px[ti + 3] !== 0) {
            buf32[i] =
              0xff000000 |
              (Math.min(255, (px[ti + 2] * shade) | 0) << 16) |
              (Math.min(255, (px[ti + 1] * shade) | 0) << 8) |
              Math.min(255, (px[ti] * shade) | 0);
            if (glassSet >= 0) {
              const table = 5 * width + 2 * (glassSet * width + x);
              const goff = cmds.columns[table];
              const gcount = cmds.columns[table + 1];

              for (let k = 0; k < gcount; k++) {
                const g = goff + k * GLASS_STRIDE;

                if (forward <= cmds.auxFloats[g + 6]) {
                  break;
                }
                if (y >= (cmds.auxWords[g] | 0) && y <= (cmds.auxWords[g + 1] | 0)) {
                  buf32[i] = coolGlassTint(buf32[i]);
                }
              }
            }
          }
          i += width;
        }
      }
    }
  }

  return buf;
}

/**
 * Assert `got` matches `want` within the command format's f32-QUANTIZATION bound. Span params are stored
 * f32 (what the GPU consumes) while `renderFrame` computes in f64, so a shade truncation sitting exactly
 * on an integer boundary can flip a channel by one — nothing else. The bound is therefore TIGHT: every
 * channel within ±1, and ≥ 99% of pixels bit-identical (measured ~0.2% of bytes at ±1 on the fixtures).
 * A LIVE-SEAM scene widens the flip surface (its flats re-project off an f32-stored translated camera,
 * and tints stack over quantized pixels) — those pass a wider identity ratio, the ±1 bound unchanged.
 */
function expectQuantized(
  got: Uint8ClampedArray,
  want: Uint8ClampedArray,
  maxDiffRatio = 0.01,
): void {
  expect(got.length).toBe(want.length);
  let diffPixels = 0;

  for (let p = 0; p < got.length; p += 4) {
    let same = true;

    for (let c = 0; c < 4; c++) {
      const d = Math.abs(got[p + c] - want[p + c]);

      if (d > 1) {
        expect.fail(`channel diff ${d} > 1 at byte ${p + c} (pixel ${p >> 2})`);
      }
      same &&= d === 0;
    }
    if (!same) {
      diffPixels++;
    }
  }
  expect(diffPixels / (got.length / 4)).toBeLessThan(maxDiffRatio);
}

/** `renderFrame` over the same inputs — what the command buffer + executor must reproduce within the
 *  f32 bound. Defaults to a sprite-free frame (the geometry fixtures). */
function reference(
  map = MAP,
  camera: Camera,
  lib: TextureLibrary = TEX,
  sprites: readonly Sprite[] = [],
  slides?: readonly number[],
  neighbors?: ReadonlyMap<string, ZoneNeighbor>,
): Uint8ClampedArray {
  const target = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);

  renderFrame(
    map,
    camera,
    CONFIG,
    lib,
    target,
    undefined,
    0,
    CONFIG.height,
    sprites,
    slides,
    neighbors,
  );

  return target;
}

/** Build + execute against the SAME inputs as {@link reference} — the round-trip under test. */
function roundTrip(
  map = MAP,
  camera: Camera,
  lib: TextureLibrary = TEX,
  sprites: readonly Sprite[] = [],
  slides?: readonly number[],
  neighbors?: ReadonlyMap<string, ZoneNeighbor>,
): { cmds: FrameCommands; pixels: Uint8ClampedArray } {
  const { ids, pool } = texturePool(lib);
  const cmds = buildFrameCommands(map, camera, CONFIG, lib, ids, sprites, slides, neighbors);

  return { cmds, pixels: execute(cmds, pool) };
}

describe('buildFrameCommands', () => {
  const CAMERAS: readonly Camera[] = [
    { x: 4, y: 5, angle: 0.3, z: 1.6 }, // the renderer suite's reference viewpoint
    { x: 13, y: 7, angle: Math.PI * 0.8, z: 1.6 }, // across the dais, free-angle wall in view
    { x: 4, y: 5, angle: 0.3, z: 1.6, pitch: 0.5 }, // looking up (horizon shifted down… up-screen)
    { x: 8, y: 5, angle: 1.2, z: 2.2, pitch: -0.6 }, // looking down from above the steps
    { x: 4, y: 5, angle: 0.3, z: 1.6, pitch: -2 }, // horizon off the top — all-floor backdrop
  ];

  it('executes to renderFrame within the f32 bound (walls + flats), across angles and pitches', () => {
    for (const camera of CAMERAS) {
      expectQuantized(roundTrip(MAP, camera).pixels, reference(MAP, camera));
    }
  });

  it('executes to renderFrame within the f32 bound on an open-SKY ceiling', () => {
    const sky = buildBsp({
      ...SAMPLE_MAP,
      sectors: SAMPLE_MAP.sectors.map((s, i) => (i === 0 ? { ...s, ceilTex: 'SKY' } : s)),
    });
    const camera: Camera = { x: 4, y: 5, angle: 0.3, z: 1.6, pitch: 0.3 };
    const { cmds, pixels } = roundTrip(sky, camera);

    expect(cmds.spanWords.filter((_, i) => i % SPAN_STRIDE === 0).includes(SPAN_SKY)).toBe(true);
    expectQuantized(pixels, reference(sky, camera));
    // A steep look-down clips most ceiling spans empty — the sky sink must skip them, not record them.
    const down: Camera = { ...camera, pitch: -0.9 };

    expectQuantized(roundTrip(sky, down).pixels, reference(sky, down));
  });

  it('falls back to texture id 0 (the MISSING slot) for names absent from the id map', () => {
    const camera: Camera = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const empty = new Map<string, Texture>();
    const cmds = buildFrameCommands(MAP, camera, CONFIG, empty, new Map(), []);

    for (let s = 0; s < cmds.spanCount; s++) {
      expect(cmds.spanWords[s * SPAN_STRIDE + 1]).toBe(0);
    }
    // …and executing over a MISSING-only pool matches renderFrame over an empty library.
    expectQuantized(execute(cmds, [missingTexture()]), reference(MAP, camera, empty));
  });

  it('keeps every span inside the frame with a consistent per-column grouping', () => {
    const { cmds } = roundTrip(MAP, { x: 4, y: 5, angle: 0.3, z: 1.6 });
    let total = 0;

    expect(cmds.spanCount).toBeGreaterThan(64); // more than the initial capacity → the growth path ran
    for (let x = 0; x < CONFIG.width; x++) {
      expect(cmds.columns[2 * x]).toBe(total); // offsets are the running prefix sum — contiguous groups
      total += cmds.columns[2 * x + 1];
    }
    expect(total).toBe(cmds.spanCount);
    for (let s = 0; s < cmds.spanCount; s++) {
      const base = s * SPAN_STRIDE;

      expect([SPAN_WALL, SPAN_FLAT, SPAN_SKY]).toContain(cmds.spanWords[base]);
      expect(cmds.spanWords[base + 2]).toBeLessThanOrEqual(cmds.spanWords[base + 3]); // y0 ≤ y1
      expect(cmds.spanWords[base + 3]).toBeLessThan(CONFIG.height);
    }
  });

  it('reuses a provided FrameCommands without changing the output (allocation-free frames)', () => {
    const { ids } = texturePool(TEX);
    const a: Camera = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const b: Camera = { x: 13, y: 7, angle: Math.PI * 0.8, z: 1.6, pitch: 0.2 };
    const reused = createFrameCommands();

    buildFrameCommands(MAP, a, CONFIG, TEX, ids, [], undefined, undefined, reused);
    const again = buildFrameCommands(MAP, b, CONFIG, TEX, ids, [], undefined, undefined, reused);
    const fresh = buildFrameCommands(MAP, b, CONFIG, TEX, ids, []);

    expect(again).toBe(reused); // rendered in place
    expect(again.spanCount).toBe(fresh.spanCount);
    expect(Array.from(again.columns.subarray(0, again.columnsWordCount))).toEqual(
      Array.from(fresh.columns.subarray(0, fresh.columnsWordCount)),
    );
    expect(Array.from(again.spanWords.subarray(0, again.spanCount * SPAN_STRIDE))).toEqual(
      Array.from(fresh.spanWords.subarray(0, fresh.spanCount * SPAN_STRIDE)),
    );
    expect(Array.from(again.auxWords.subarray(0, again.auxWordCount))).toEqual(
      Array.from(fresh.auxWords.subarray(0, fresh.auxWordCount)),
    );
    expectQuantized(execute(again, texturePool(TEX).pool), reference(MAP, b));
  });

  it('re-arms its scratch when the render width changes', () => {
    const { ids, pool } = texturePool(TEX);
    const camera: Camera = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const narrow = { width: 64, height: 48, fov: Math.PI / 2 };

    buildFrameCommands(MAP, camera, narrow, TEX, ids, []); // resize the module scratch down…
    const cmds = buildFrameCommands(MAP, camera, CONFIG, TEX, ids, []); // …and back up

    expect(cmds.columnsWordCount).toBe(CONFIG.width * 7); // geometry + windows + one glass set
    expectQuantized(execute(cmds, pool), reference(MAP, camera));
  });

  it('defaults its sprite list to the map decor, exactly like renderFrame', () => {
    const camera: Camera = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const { ids, pool } = texturePool(TEX);
    const cmds = buildFrameCommands(MAP, camera, CONFIG, TEX, ids); // no sprites argument
    const target = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);

    renderFrame(MAP, camera, CONFIG, TEX, target); // no sprites argument either → mapSprites
    expectQuantized(execute(cmds, pool), target);
  });
});

// ---------------------------------------------------------------------------------------------
// Stage-2 fixtures: glass, zone portals, sprites — compact authored maps in the renderer suite's
// style, each executed against `renderFrame` over the SAME inputs.
// ---------------------------------------------------------------------------------------------

/** A sidedef fronting `sector` (compact fixture builder). */
function side(sector: number, middleTex = 'BRICK'): SideDef {
  return { sector, xOffset: 0, yOffset: 0, upperTex: 'METAL', lowerTex: 'METAL', middleTex };
}

/** A 2×2 half-opaque glass texture: TOP row opaque green "mullion", BOTTOM row clear — exercises both
 *  blend branches of a textured pane / door leaf. */
function halfGlassTexture(): Texture {
  return {
    width: 2,
    height: 2,
    pixels: new Uint8ClampedArray([
      40,
      200,
      60,
      255,
      40,
      200,
      60,
      255, // opaque green frame row
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // clear row
    ]),
  };
}

/** A NON-power-of-two 12×10 sprite texture with alpha holes — the atlas-style art the GPU pool must
 *  sample by division (the walls' `&`-wrap would garble it). Two 6×10 cells: left red, right blue. */
function nonPotSprite(): Texture {
  const width = 12;
  const height = 10;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      if ((x + y) % 4 === 0) {
        continue; // an alpha hole
      }
      pixels[i] = x < 6 ? 230 : 30;
      pixels[i + 1] = 40;
      pixels[i + 2] = x < 6 ? 30 : 230;
      pixels[i + 3] = 255;
    }
  }

  return { width, height, pixels };
}

/** Rooms A[y0..6] | B[y6..12] | C[y12..18]: A|B glass (plain, pane, or sliding by `kind`), B|C plain
 *  glass — a two-layer stack from a camera in A looking +y. */
function glassCorridor(kind: 'plain' | 'pane' | 'sliding'): MapSource {
  return {
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
    sectors: [
      { floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 },
      { floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 200 },
      { floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 180 },
    ],
    linedefs: [
      { v1: 1, v2: 0, front: side(0), back: null }, // A south
      { v1: 3, v2: 1, front: side(0), back: null }, // A east
      { v1: 0, v2: 2, front: side(0), back: null }, // A west
      {
        v1: 2,
        v2: 3,
        front: side(0, 'GLASSTEX'),
        back: side(1, 'GLASSTEX'),
        glass: true,
        pane: kind === 'pane',
        sliding: kind === 'sliding',
      }, // A|B
      { v1: 5, v2: 3, front: side(1), back: null }, // B east
      { v1: 2, v2: 4, front: side(1), back: null }, // B west
      { v1: 4, v2: 5, front: side(1), back: side(2), glass: true }, // B|C plain glass
      { v1: 7, v2: 5, front: side(2), back: null }, // C east
      { v1: 4, v2: 6, front: side(2), back: null }, // C west
      { v1: 6, v2: 7, front: side(2), back: null }, // C north
    ],
    things: [],
  };
}

const GLASS_TEX: TextureLibrary = new Map([...TEX, ['GLASSTEX', halfGlassTexture()]]);
const GLASS_CAM: Camera = { x: 4.3, y: 2.7, angle: Math.PI / 2 + 0.13, z: 1.6 };

describe('buildFrameCommands — layered glass', () => {
  it('reproduces stacked plain glass (two tint layers) within the f32 bound', () => {
    const map = buildBsp(glassCorridor('plain'));
    const { cmds, pixels } = roundTrip(map, GLASS_CAM, GLASS_TEX);

    expectQuantized(pixels, reference(map, GLASS_CAM, GLASS_TEX));
    // The primary glass set (set 0) recorded layered columns — and a PLAIN window records tu < 0.
    let layered = 0;

    for (let x = 0; x < CONFIG.width; x++) {
      const table = 5 * CONFIG.width + 2 * x;

      if (cmds.columns[table + 1] >= 2) {
        layered++;
        expect(cmds.auxFloats[cmds.columns[table] + 4]).toBeLessThan(0); // plain → flat tint
      }
    }
    expect(layered).toBeGreaterThan(0);
  });

  it('reproduces a textured PANE (opaque mullion texels stamped + z-written) within the f32 bound', () => {
    const map = buildBsp(glassCorridor('pane'));

    expectQuantized(
      roundTrip(map, GLASS_CAM, GLASS_TEX).pixels,
      reference(map, GLASS_CAM, GLASS_TEX),
    );
    // A pane whose texture the library LACKS falls back to the MISSING art on both paths (glass texId 0).
    expectQuantized(roundTrip(map, GLASS_CAM, TEX).pixels, reference(map, GLASS_CAM, TEX));
  });

  it('reproduces a SLIDING door leaf at several openness values, sliding its texture U', () => {
    const map = buildBsp(glassCorridor('sliding'));
    // linedef 3 is the sliding door; index the slides array accordingly.
    const shut = [0, 0, 0, 0];
    const half = [0, 0, 0, 0.5];
    const open = [0, 0, 0, 0.95];

    for (const slides of [undefined, shut, half, open]) {
      expectQuantized(
        roundTrip(map, GLASS_CAM, GLASS_TEX, [], slides).pixels,
        reference(map, GLASS_CAM, GLASS_TEX, [], slides),
      );
    }
    // The leaf texture SLIDES with the door: openness shifts the recorded tu on a still-covered column.
    const { ids } = texturePool(GLASS_TEX);
    const at = (slides: readonly number[]): FrameCommands =>
      buildFrameCommands(map, GLASS_CAM, CONFIG, GLASS_TEX, ids, [], slides);
    const tuAt = (cmds: FrameCommands): number => {
      for (let x = 0; x < CONFIG.width; x++) {
        const table = 5 * CONFIG.width + 2 * x;

        if (cmds.columns[table + 1] > 0) {
          const tu = cmds.auxFloats[cmds.columns[table] + 4];

          if (tu >= 0) {
            return tu;
          }
        }
      }

      return -1;
    };
    const tuShut = tuAt(at(shut));
    const tuHalf = tuAt(at(half));

    expect(tuShut).toBeGreaterThanOrEqual(0);
    expect(tuHalf).toBeGreaterThanOrEqual(0);
    expect(tuHalf).not.toBe(tuShut);
  });

  it('washes a sprite seen THROUGH glass and occludes one behind an opaque mullion', () => {
    const map = buildBsp(glassCorridor('pane'));
    const sprites: Sprite[] = [
      { x: 4.3, y: 9, z: 0, tex: 'REDGUY', width: 1, height: 2.6 }, // in B, behind the pane
      { x: 4.1, y: 4.5, z: 0, tex: 'REDGUY', width: 0.7, height: 1.2 }, // in A, in FRONT of the pane
    ];
    const red: Texture = {
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray([
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
      ]),
    };
    const lib = new Map([...GLASS_TEX, ['REDGUY', red]]);

    expectQuantized(
      roundTrip(map, GLASS_CAM, lib, sprites).pixels,
      reference(map, GLASS_CAM, lib, sprites),
    );
  });
});

/** The NEIGHBOUR zone: rooms N1[x0..4] | N2[x4..8] with a glass divider — its own glass must blend
 *  inside the seam window, and its sprites must clip to it. */
function neighbourZone(): MapSource {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
      { x: 0, y: 6 },
      { x: 4, y: 6 },
      { x: 8, y: 6 },
    ],
    sectors: [
      { floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 210 },
      { floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 170 },
    ],
    linedefs: [
      { v1: 1, v2: 0, front: side(0), back: null }, // N1 south
      { v1: 2, v2: 1, front: side(1), back: null }, // N2 south
      { v1: 5, v2: 2, front: side(1), back: null }, // N2 east
      { v1: 4, v2: 5, front: side(1), back: null }, // N2 north
      { v1: 3, v2: 4, front: side(0), back: null }, // N1 north
      { v1: 0, v2: 3, front: side(0), back: null }, // N1 west (behind the seam viewer — back-face culled)
      { v1: 4, v2: 1, front: side(0), back: side(1), glass: true }, // N1|N2 glass divider
    ],
    things: [],
  };
}

/** The MAIN zone: one room x[0..8] y[0..6] whose EAST edge (x=8) is a live zone-portal seam onto
 *  {@link neighbourZone} — neighbour (0,y) + (8,0) = main (8,y). */
function mainZone(): MapSource {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 0, y: 6 },
      { x: 8, y: 6 },
    ],
    sectors: [{ floorZ: 0, ceilZ: 3, floorTex: 'FLOOR', ceilTex: 'CEIL', light: 220 }],
    linedefs: [
      { v1: 1, v2: 0, front: side(0), back: null }, // south
      { v1: 0, v2: 2, front: side(0), back: null }, // west
      { v1: 2, v2: 3, front: side(0), back: null }, // north
      {
        v1: 3,
        v2: 1,
        front: side(0, 'METAL'),
        back: null,
        zonePortal: { zone: 'n', dx: 8, dy: 0 },
      }, // east — the LIVE seam (solid METAL fallback without a neighbour map)
    ],
    things: [],
  };
}

describe('buildFrameCommands — zone portals', () => {
  const PORTAL_CAM: Camera = { x: 4.2, y: 3.1, angle: 0.11, z: 1.6 };
  const NMAP = buildBsp(neighbourZone());
  const PMAP = buildBsp(mainZone());

  it('renders the live neighbour zone (geometry + its own glass) through the seam windows', () => {
    const neighbors = new Map<string, ZoneNeighbor>([['n', { map: NMAP }]]);
    const { cmds, pixels } = roundTrip(PMAP, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors);

    expectQuantized(pixels, reference(PMAP, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors), 0.02);
    expect(cmds.setCount).toBe(2); // primary + one seam glass set
    expect(cmds.phaseCount).toBe(2); // the seam phase + the primary phase
    // The seam's window columns are recorded (seam id 0) and its flat spans carry the TRANSLATED camera.
    let windows = 0;
    let translated = 0;

    for (let x = 0; x < CONFIG.width; x++) {
      if ((cmds.columns[2 * CONFIG.width + 3 * x] | 0) === 0) {
        windows++;
      }
    }
    for (let s = 0; s < cmds.spanCount; s++) {
      const base = s * SPAN_STRIDE;

      if (
        cmds.spanWords[base] === SPAN_FLAT &&
        cmds.spanFloats[base + 9] === Math.fround(PORTAL_CAM.x - 8) // ncam.x = camera.x − dx (f32-stored)
      ) {
        translated++;
      }
    }
    expect(windows).toBeGreaterThan(0);
    expect(translated).toBeGreaterThan(0);
  });

  it('draws a warm neighbour sprite through the seam, clipped to its windows and z-tested', () => {
    const sprite: Sprite[] = [{ x: 2, y: 3, z: 0, tex: 'REDGUY', width: 1, height: 2.4 }]; // neighbour coords
    const red: Texture = {
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray([
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
      ]),
    };
    const lib = new Map([...GLASS_TEX, ['REDGUY', red]]);
    const neighbors = new Map<string, ZoneNeighbor>([['n', { map: NMAP, sprites: sprite }]]);
    const { cmds, pixels } = roundTrip(PMAP, PORTAL_CAM, lib, [], undefined, neighbors);

    expectQuantized(pixels, reference(PMAP, PORTAL_CAM, lib, [], undefined, neighbors));
    // The seam phase carries the neighbour sprite; its record is window-clipped by seam id 0.
    expect(cmds.auxWords[2]).toBe(1); // phase 0 spriteCount
    expect(cmds.auxWords[3] | 0).toBe(0); // phase 0 windowSeam
  });

  it('runs a GLASS-FREE neighbour without arming its glass set (glass-free zones pay nothing)', () => {
    const bare = buildBsp({
      ...neighbourZone(),
      linedefs: neighbourZone().linedefs.map((l) => ({ ...l, glass: undefined })),
    });
    const neighbors = new Map<string, ZoneNeighbor>([['n', { map: bare }]]);
    const { cmds, pixels } = roundTrip(PMAP, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors);

    expectQuantized(pixels, reference(PMAP, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors), 0.02);
    expect(cmds.auxWords[0] | 0).toBe(-1); // seam phase: no glass set to blend
  });

  it('skips a registered seam whose every column a nearer wall already occluded', () => {
    // The main zone plus a full-width interior wall at x=6, BETWEEN the camera and the seam: the walk
    // still registers the seam (its seg is visited, front-facing) but every column is already closed —
    // the neighbour pass must be skipped, exactly like renderNeighbors' `columns === 0` guard.
    const source = mainZone();
    const blocked = buildBsp({
      ...source,
      vertices: [...source.vertices, { x: 6, y: 0 }, { x: 6, y: 6 }],
      linedefs: [...source.linedefs, { v1: 5, v2: 4, front: side(0), back: null }],
    });
    const neighbors = new Map<string, ZoneNeighbor>([['n', { map: NMAP }]]);
    const { cmds, pixels } = roundTrip(blocked, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors);

    expectQuantized(pixels, reference(blocked, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors));
    expect(cmds.setCount).toBe(2); // the seam registered (its glass-set slot exists)…
    expect(cmds.auxWords[2]).toBe(0); // …but its phase carries no sprites
    expect(cmds.auxWords[0] | 0).toBe(-1); // …and no glass set (the neighbour walk never ran)
  });

  it('keeps a seam solid when its zone has no neighbour map (and when neighbors is absent)', () => {
    const camera = PORTAL_CAM;

    expectQuantized(roundTrip(PMAP, camera, GLASS_TEX).pixels, reference(PMAP, camera, GLASS_TEX));
    const wrongKey = new Map<string, ZoneNeighbor>([['other', { map: NMAP }]]);

    expectQuantized(
      roundTrip(PMAP, camera, GLASS_TEX, [], undefined, wrongKey).pixels,
      reference(PMAP, camera, GLASS_TEX, [], undefined, wrongKey),
    );
  });
});

describe('buildFrameCommands — sprites', () => {
  const CAM: Camera = { x: 4, y: 5, angle: 0.3, z: 1.6 };

  it('reproduces atlas-cell billboards (non-POT art, division sampling) with hit-flash clamping', () => {
    const lib = new Map([...TEX, ['NPOT', nonPotSprite()]]);
    const sprites: Sprite[] = [
      { x: 6.5, y: 6, z: 0, tex: 'NPOT', width: 1, height: 1.8, cols: 2, rows: 1, col: 1, row: 0 },
      {
        x: 6,
        y: 4.6,
        z: 0.4,
        tex: 'NPOT',
        width: 0.8,
        height: 1.2,
        cols: 2,
        rows: 1,
        col: 0,
        row: 0,
        flash: 0.8,
      },
      { x: 8.5, y: 5.5, z: 0, tex: 'ABSENT', width: 0.8, height: 1 }, // missing art → the magenta MISSING billboard
    ];

    expectQuantized(roundTrip(MAP, CAM, lib, sprites).pixels, reference(MAP, CAM, lib, sprites));
  });

  it('records sprites far-to-near (the CPU overdraw order) in the primary phase', () => {
    const sprites: Sprite[] = [
      { x: 6, y: 5, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 },
      { x: 10, y: 6, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 },
      { x: 8, y: 5.5, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 },
    ];
    const lib = new Map([...TEX, ['BARREL', metalTexture()]]);
    const { cmds } = roundTrip(MAP, CAM, lib, sprites);
    const pb = (cmds.phaseCount - 1) * PHASE_STRIDE; // the primary phase is last
    const base = cmds.auxWords[pb + 1];
    const count = cmds.auxWords[pb + 2];

    expect(count).toBe(3);
    let prev = Infinity;

    for (let s = 0; s < count; s++) {
      const forward = cmds.auxFloats[base + s * SPRITE_STRIDE + 9];

      expect(forward).toBeLessThanOrEqual(prev);
      prev = forward;
    }
  });
});
