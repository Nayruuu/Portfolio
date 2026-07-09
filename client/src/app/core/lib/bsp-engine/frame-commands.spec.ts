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
  SPRITE_BILLBOARD,
  SPRITE_VOXEL,
  SPRITE_STRIDE,
  type FrameCommands,
} from './frame-commands';
import { buildBsp } from './node-builder';
import {
  BG_CEILING,
  BG_FLOOR,
  coolGlassTint,
  FLAT_ANCHOR,
  NEAR,
  renderFrame,
  TEX_ANCHOR,
  VOXEL_SHADE,
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
        const camX = cmds.spanFloats[base + 9];
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

  const asI32 = (w: number): number => cmds.auxWords[w] | 0;

  for (let ph = 0; ph < cmds.phaseCount; ph++) {
    const pb = ph * PHASE_STRIDE;
    const glassSet = asI32(pb);
    const spriteBase = cmds.auxWords[pb + 1];
    const spriteCount = cmds.auxWords[pb + 2];
    const windowSeam = asI32(pb + 3);

    if (glassSet >= 0) {
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

      const tintThroughGlass = (x: number, y: number, i: number, depth: number): void => {
        if (glassSet >= 0) {
          const table = 5 * width + 2 * (glassSet * width + x);
          const goff = cmds.columns[table];
          const gcount = cmds.columns[table + 1];

          for (let k = 0; k < gcount; k++) {
            const g = goff + k * GLASS_STRIDE;

            if (depth <= cmds.auxFloats[g + 6]) {
              break;
            }
            if (y >= (cmds.auxWords[g] | 0) && y <= (cmds.auxWords[g + 1] | 0)) {
              buf32[i] = coolGlassTint(buf32[i]);
            }
          }
        }
      };

      if (cmds.auxWords[sb + 11] === SPRITE_VOXEL) {
        const n = cmds.auxWords[sb + 5];
        const nyG = cmds.auxWords[sb + 6];
        const nzG = cmds.auxWords[sb + 7];
        const camGX = cmds.auxFloats[sb + 12];
        const camGY = cmds.auxFloats[sb + 13];
        const camGZ = cmds.auxFloats[sb + 14];
        const fwdGX = cmds.auxFloats[sb + 15];
        const fwdGY = cmds.auxFloats[sb + 16];
        const rightGX = cmds.auxFloats[sb + 17];
        const rightGY = cmds.auxFloats[sb + 18];
        const zScale = cmds.auxFloats[sb + 19];
        const origin3 = [camGX, camGY, camGZ] as const;
        const size3 = [n, nyG, nzG] as const;
        const dir3 = new Float64Array(3);
        const cell = new Int32Array(3);
        const stepDir = new Int32Array(3);
        const tDelta = new Float64Array(3);
        const tMax = new Float64Array(3);

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
          const offset = (width / 2 - x) / focal;

          dir3[0] = fwdGX + offset * rightGX;
          dir3[1] = fwdGY + offset * rightGY;
          let planEnter = NEAR;
          let planExit = Infinity;
          let planAxis = 1;
          let planMiss = false;

          for (let a = 0; a < 2; a++) {
            const dir = dir3[a];

            if (dir !== 0) {
              const t0 = (0 - origin3[a]) / dir;
              const t1 = (size3[a] - origin3[a]) / dir;

              if (Math.min(t0, t1) > planEnter) {
                planEnter = Math.min(t0, t1);
                planAxis = a;
              }
              planExit = Math.min(planExit, Math.max(t0, t1));
            } else if (origin3[a] < 0 || origin3[a] >= size3[a]) {
              planMiss = true;
            }
          }
          if (planMiss || planEnter >= planExit) {
            continue;
          }
          for (let y = colLo, i = colLo * width + x; y <= colHi; y++, i += width) {
            const dz = ((horizon - y) / focal) * zScale;
            let tEnter = planEnter;
            let tExit = planExit;
            let axis = planAxis;

            dir3[2] = dz;
            if (dz !== 0) {
              const tz0 = (0 - camGZ) / dz;
              const tz1 = (nzG - camGZ) / dz;

              if (Math.min(tz0, tz1) > tEnter) {
                tEnter = Math.min(tz0, tz1);
                axis = 2;
              }
              tExit = Math.min(tExit, Math.max(tz0, tz1));
            } else if (camGZ < 0 || camGZ >= nzG) {
              continue;
            }
            if (tEnter >= tExit || tEnter >= zbuf[i]) {
              continue;
            }
            let t = tEnter;

            for (let a = 0; a < 3; a++) {
              const dir = dir3[a];

              cell[a] = Math.min(size3[a] - 1, Math.max(0, Math.floor(origin3[a] + t * dir)));
              stepDir[a] = dir > 0 ? 1 : -1;
              tDelta[a] = dir !== 0 ? Math.abs(1 / dir) : Infinity;
              tMax[a] = dir !== 0 ? (cell[a] + (dir > 0 ? 1 : 0) - origin3[a]) / dir : Infinity;
            }
            for (;;) {
              if (t >= zbuf[i]) {
                break;
              }
              const ti = ((cell[2] * nyG + cell[1]) * n + cell[0]) << 2;

              if (px[ti + 3] !== 0) {
                const face =
                  axis === 2
                    ? dz < 0
                      ? VOXEL_SHADE.top
                      : VOXEL_SHADE.bottom
                    : axis === 0
                      ? VOXEL_SHADE.sideX
                      : VOXEL_SHADE.sideY;
                const lit = shade * face;

                buf32[i] =
                  0xff000000 |
                  (Math.min(255, (px[ti + 2] * lit) | 0) << 16) |
                  (Math.min(255, (px[ti + 1] * lit) | 0) << 8) |
                  Math.min(255, (px[ti] * lit) | 0);
                zbuf[i] = t;
                tintThroughGlass(x, y, i, t);
                break;
              }
              const axisNext =
                tMax[0] <= tMax[1] && tMax[0] <= tMax[2] ? 0 : tMax[1] <= tMax[2] ? 1 : 2;

              t = tMax[axisNext];
              tMax[axisNext] += tDelta[axisNext];
              cell[axisNext] += stepDir[axisNext];
              axis = axisNext;
              if (cell[axisNext] < 0 || cell[axisNext] >= size3[axisNext]) {
                break;
              }
            }
          }
        }
        continue;
      }

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
            tintThroughGlass(x, y, i, forward);
          }
          i += width;
        }
      }
    }
  }

  return buf;
}

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
    { x: 4, y: 5, angle: 0.3, z: 1.6 },
    { x: 13, y: 7, angle: Math.PI * 0.8, z: 1.6 },
    { x: 4, y: 5, angle: 0.3, z: 1.6, pitch: 0.5 },
    { x: 8, y: 5, angle: 1.2, z: 2.2, pitch: -0.6 },
    { x: 4, y: 5, angle: 0.3, z: 1.6, pitch: -2 },
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
    expectQuantized(execute(cmds, [missingTexture()]), reference(MAP, camera, empty));
  });

  it('keeps every span inside the frame with a consistent per-column grouping', () => {
    const { cmds } = roundTrip(MAP, { x: 4, y: 5, angle: 0.3, z: 1.6 });
    let total = 0;

    expect(cmds.spanCount).toBeGreaterThan(64);
    for (let x = 0; x < CONFIG.width; x++) {
      expect(cmds.columns[2 * x]).toBe(total);
      total += cmds.columns[2 * x + 1];
    }
    expect(total).toBe(cmds.spanCount);
    for (let s = 0; s < cmds.spanCount; s++) {
      const base = s * SPAN_STRIDE;

      expect([SPAN_WALL, SPAN_FLAT, SPAN_SKY]).toContain(cmds.spanWords[base]);
      expect(cmds.spanWords[base + 2]).toBeLessThanOrEqual(cmds.spanWords[base + 3]);
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

    expect(again).toBe(reused);
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

    buildFrameCommands(MAP, camera, narrow, TEX, ids, []);
    const cmds = buildFrameCommands(MAP, camera, CONFIG, TEX, ids, []);

    expect(cmds.columnsWordCount).toBe(CONFIG.width * 7);
    expectQuantized(execute(cmds, pool), reference(MAP, camera));
  });

  it('defaults its sprite list to the map decor, exactly like renderFrame', () => {
    const camera: Camera = { x: 4, y: 5, angle: 0.3, z: 1.6 };
    const { ids, pool } = texturePool(TEX);
    const cmds = buildFrameCommands(MAP, camera, CONFIG, TEX, ids);
    const target = new Uint8ClampedArray(CONFIG.width * CONFIG.height * 4);

    renderFrame(MAP, camera, CONFIG, TEX, target);
    expectQuantized(execute(cmds, pool), target);
  });
});

function side(sector: number, middleTex = 'BRICK'): SideDef {
  return { sector, xOffset: 0, yOffset: 0, upperTex: 'METAL', lowerTex: 'METAL', middleTex };
}

function halfGlassTexture(): Texture {
  return {
    width: 2,
    height: 2,
    pixels: new Uint8ClampedArray([40, 200, 60, 255, 40, 200, 60, 255, 0, 0, 0, 0, 0, 0, 0, 0]),
  };
}

function nonPotSprite(): Texture {
  const width = 12;
  const height = 10;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      if ((x + y) % 4 === 0) {
        continue;
      }
      pixels[i] = x < 6 ? 230 : 30;
      pixels[i + 1] = 40;
      pixels[i + 2] = x < 6 ? 30 : 230;
      pixels[i + 3] = 255;
    }
  }

  return { width, height, pixels };
}

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
      { v1: 1, v2: 0, front: side(0), back: null },
      { v1: 3, v2: 1, front: side(0), back: null },
      { v1: 0, v2: 2, front: side(0), back: null },
      {
        v1: 2,
        v2: 3,
        front: side(0, 'GLASSTEX'),
        back: side(1, 'GLASSTEX'),
        glass: true,
        pane: kind === 'pane',
        sliding: kind === 'sliding',
      },
      { v1: 5, v2: 3, front: side(1), back: null },
      { v1: 2, v2: 4, front: side(1), back: null },
      { v1: 4, v2: 5, front: side(1), back: side(2), glass: true },
      { v1: 7, v2: 5, front: side(2), back: null },
      { v1: 4, v2: 6, front: side(2), back: null },
      { v1: 6, v2: 7, front: side(2), back: null },
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
    let layered = 0;

    for (let x = 0; x < CONFIG.width; x++) {
      const table = 5 * CONFIG.width + 2 * x;

      if (cmds.columns[table + 1] >= 2) {
        layered++;
        expect(cmds.auxFloats[cmds.columns[table] + 4]).toBeLessThan(0);
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
    expectQuantized(roundTrip(map, GLASS_CAM, TEX).pixels, reference(map, GLASS_CAM, TEX));
  });

  it('reproduces a SLIDING door leaf at several openness values, sliding its texture U', () => {
    const map = buildBsp(glassCorridor('sliding'));
    const shut = [0, 0, 0, 0];
    const half = [0, 0, 0, 0.5];
    const open = [0, 0, 0, 0.95];

    for (const slides of [undefined, shut, half, open]) {
      expectQuantized(
        roundTrip(map, GLASS_CAM, GLASS_TEX, [], slides).pixels,
        reference(map, GLASS_CAM, GLASS_TEX, [], slides),
      );
    }
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
      { x: 4.3, y: 9, z: 0, tex: 'REDGUY', width: 1, height: 2.6 },
      { x: 4.1, y: 4.5, z: 0, tex: 'REDGUY', width: 0.7, height: 1.2 },
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
      { v1: 1, v2: 0, front: side(0), back: null },
      { v1: 2, v2: 1, front: side(1), back: null },
      { v1: 5, v2: 2, front: side(1), back: null },
      { v1: 4, v2: 5, front: side(1), back: null },
      { v1: 3, v2: 4, front: side(0), back: null },
      { v1: 0, v2: 3, front: side(0), back: null },
      { v1: 4, v2: 1, front: side(0), back: side(1), glass: true },
    ],
    things: [],
  };
}

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
      { v1: 1, v2: 0, front: side(0), back: null },
      { v1: 0, v2: 2, front: side(0), back: null },
      { v1: 2, v2: 3, front: side(0), back: null },
      {
        v1: 3,
        v2: 1,
        front: side(0, 'METAL'),
        back: null,
        zonePortal: { zone: 'n', dx: 8, dy: 0 },
      },
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
    expect(cmds.setCount).toBe(2);
    expect(cmds.phaseCount).toBe(2);
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
        cmds.spanFloats[base + 9] === Math.fround(PORTAL_CAM.x - 8)
      ) {
        translated++;
      }
    }
    expect(windows).toBeGreaterThan(0);
    expect(translated).toBeGreaterThan(0);
  });

  it('draws a warm neighbour sprite through the seam, clipped to its windows and z-tested', () => {
    const sprite: Sprite[] = [{ x: 2, y: 3, z: 0, tex: 'REDGUY', width: 1, height: 2.4 }];
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
    expect(cmds.auxWords[2]).toBe(1);
    expect(cmds.auxWords[3] | 0).toBe(0);
  });

  it('runs a GLASS-FREE neighbour without arming its glass set (glass-free zones pay nothing)', () => {
    const bare = buildBsp({
      ...neighbourZone(),
      linedefs: neighbourZone().linedefs.map((l) => ({ ...l, glass: undefined })),
    });
    const neighbors = new Map<string, ZoneNeighbor>([['n', { map: bare }]]);
    const { cmds, pixels } = roundTrip(PMAP, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors);

    expectQuantized(pixels, reference(PMAP, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors), 0.02);
    expect(cmds.auxWords[0] | 0).toBe(-1);
  });

  it('skips a registered seam whose every column a nearer wall already occluded', () => {
    const source = mainZone();
    const blocked = buildBsp({
      ...source,
      vertices: [...source.vertices, { x: 6, y: 0 }, { x: 6, y: 6 }],
      linedefs: [...source.linedefs, { v1: 5, v2: 4, front: side(0), back: null }],
    });
    const neighbors = new Map<string, ZoneNeighbor>([['n', { map: NMAP }]]);
    const { cmds, pixels } = roundTrip(blocked, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors);

    expectQuantized(pixels, reference(blocked, PORTAL_CAM, GLASS_TEX, [], undefined, neighbors));
    expect(cmds.setCount).toBe(2);
    expect(cmds.auxWords[2]).toBe(0);
    expect(cmds.auxWords[0] | 0).toBe(-1);
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
      { x: 8.5, y: 5.5, z: 0, tex: 'ABSENT', width: 0.8, height: 1 },
    ];

    expectQuantized(roundTrip(MAP, CAM, lib, sprites).pixels, reference(MAP, CAM, lib, sprites));
  });

  it('reproduces VOXEL props (per-pixel DDA volumes) within the f32 bound, head-on and oblique', () => {
    const grid: Texture = {
      width: 4,
      height: 16,
      pixels: new Uint8ClampedArray(
        Array.from({ length: 4 * 16 }, () => [200, 90, 40, 255]).flat(),
      ),
      voxelDepth: 4,
    };
    const lib = new Map([...TEX, ['VOXGRID', grid]]);
    const vox: Sprite = {
      x: 8,
      y: 6,
      z: 0,
      tex: 'VOXGRID',
      width: 1.2,
      height: 1.8,
      cols: 4,
      rows: 1,
      col: 0,
      row: 0,
      rotations: 4,
      facing: 0.4,
      voxel: true,
    };

    for (const camera of [
      CAM,
      { x: 6.5, y: 4.2, angle: 0.9, z: 1.6 },
      { x: 7, y: 5, angle: 0.6, z: 2.2, pitch: -0.3 },
    ]) {
      expectQuantized(
        roundTrip(MAP, camera, lib, [vox]).pixels,
        reference(MAP, camera, lib, [vox]),
      );
    }
  });

  it('serializes a voxel record (kind + grid dims + grid-space tail) and zeroes it on billboards', () => {
    const grid: Texture = {
      width: 2,
      height: 6,
      pixels: new Uint8ClampedArray(Array.from({ length: 2 * 6 }, () => [200, 90, 40, 255]).flat()),
      voxelDepth: 2,
    };
    const sprites: Sprite[] = [
      { x: 6, y: 5, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 },
      {
        x: 8,
        y: 6,
        z: 0,
        tex: 'VOXGRID',
        width: 1.2,
        height: 1.8,
        cols: 4,
        rows: 1,
        col: 0,
        row: 0,
        rotations: 4,
        facing: 0.4,
        voxel: true,
      },
    ];
    const lib = new Map([...TEX, ['VOXGRID', grid], ['BARREL', metalTexture()]]); // prettier-ignore
    const { cmds } = roundTrip(MAP, CAM, lib, sprites);
    const pb = (cmds.phaseCount - 1) * PHASE_STRIDE;
    const base = cmds.auxWords[pb + 1];
    const count = cmds.auxWords[pb + 2];
    const kinds: number[] = [];

    for (let s = 0; s < count; s++) {
      const sb = base + s * SPRITE_STRIDE;
      const kind = cmds.auxWords[sb + 11];

      kinds.push(kind);
      if (kind === SPRITE_VOXEL) {
        expect(cmds.auxWords[sb + 5]).toBe(2);
        expect(cmds.auxWords[sb + 6]).toBe(2);
        expect(cmds.auxWords[sb + 7]).toBe(3);
        expect(cmds.auxWords[sb + 8]).toBe(0);
        expect(cmds.auxFloats[sb + 14]).toBeCloseTo(1.6 * (3 / 1.8), 5);
        expect(cmds.auxFloats[sb + 19]).toBeCloseTo(3 / 1.8, 5);
      } else {
        for (let w = 12; w < SPRITE_STRIDE; w++) {
          expect(cmds.auxWords[sb + w]).toBe(0);
        }
      }
    }
    expect(kinds).toContain(SPRITE_VOXEL);
    expect(kinds).toContain(SPRITE_BILLBOARD);
  });

  it('records sprites far-to-near (the CPU overdraw order) in the primary phase', () => {
    const sprites: Sprite[] = [
      { x: 6, y: 5, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 },
      { x: 10, y: 6, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 },
      { x: 8, y: 5.5, z: 0, tex: 'BARREL', width: 0.8, height: 1.1 },
    ];
    const lib = new Map([...TEX, ['BARREL', metalTexture()]]);
    const { cmds } = roundTrip(MAP, CAM, lib, sprites);
    const pb = (cmds.phaseCount - 1) * PHASE_STRIDE;
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
