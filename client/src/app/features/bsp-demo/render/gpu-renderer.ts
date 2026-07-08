import {
  BG_CEILING,
  BG_FLOOR,
  buildFrameCommands,
  createFrameCommands,
  FLAT_ANCHOR,
  GLASS_TINT,
  missingTexture,
  NEAR,
  PHASE_STRIDE,
  GLASS_STRIDE,
  SPAN_FLAT,
  SPAN_STRIDE,
  SPAN_WALL,
  SPRITE_VOXEL,
  SPRITE_STRIDE,
  TEX_ANCHOR,
  VOXEL_MAX_STEPS,
  VOXEL_SHADE,
  type Camera,
  type CompiledMap,
  type RenderConfig,
  type Sprite,
  type Texture,
  type ZoneNeighbor,
} from '../../../core/lib/bsp-engine';

/**
 * The WEBGPU COMPUTE render backend — the DEFAULT when WebGPU is available (`?renderer=cpu` forces the CPU
 * worker-pool path, which also remains the automatic fallback). The DOOM algorithm stays
 * OURS and stays on the CPU: `buildFrameCommands` walks the BSP (primary + one translated walk per live
 * zone-portal seam), clips, projects the sprites, and emits the per-column span command buffer + the
 * deferred-phase buffer (the smart, cheap part). This module uploads them and runs a WGSL COMPUTE shader —
 * one invocation per pixel, over local colour/depth registers: the merged geometry stream nearest-wins,
 * then each PHASE in order (a glass set blended farthest-first, then its sprites far-to-near, window-
 * clipped and glass-tinted) — the CPU renderer's exact per-pixel sequence. NO triangle rasterization
 * pipeline anywhere: geometry never becomes vertices, portals need no recursion concept.
 *
 * Texture storage: a flat STORAGE-BUFFER texel pool (one packed u32 per texel) + a per-texture info table,
 * NOT a `texture_2d_array` — the library mixes sizes (the 2×2 MISSING fallback, 64² procedural, 512×256
 * and 512² art, NON-power-of-two sprite atlases). Walls/flats keep the engine's integer `& (size−1)` wrap
 * (their art is POT by construction); sprites/glass sample by division into their atlas cell, so any size
 * is exact. The pool uploads `Texture.pixels` as decoded — for atlases that is ALREADY the hardened
 * (alpha-thresholded) RGBA `loadAtlasTexture` produced, so the alpha tests match the CPU per texel.
 *
 * Present: the output storage buffer is copied to a MAP_READ staging buffer and read back into the
 * caller's `ImageData` — the existing `putImageData` blit + 2D overlay stack (weapon, HUD, projectiles,
 * effects) then work unchanged. A zero-copy canvas present is a later stage; if one ever lands, that
 * fullscreen blit is the ONLY place a render pipeline is allowed.
 *
 * Per-frame flow: build commands (CPU) → `writeBuffer` uploads (reused buffers, grown only when a frame
 * outgrows them — never per-frame allocation) → one compute dispatch → copy → `mapAsync` → blit.
 * Browser-only (feature layer): SSR never touches `navigator.gpu` — `createGpuRenderer` resolves `null`
 * there, as it does on any init failure, and the caller stays on the CPU renderer.
 */

/** Last frame's timings: command build (CPU, main thread) and submit→readback-mapped (GPU + readback). */
export interface GpuStats {
  buildMs: number;
  gpuMs: number;
}

export interface GpuRenderer {
  /** A STABLE object mutated in place each frame — safe to expose once (e.g. on the perf ring). */
  readonly stats: GpuStats;
  /** Render one frame into `target` (an `ImageData.data` at the current config's resolution) — the full
   *  `renderFrame` surface: live sprites, sliding-door openness, zone-portal neighbours (warm sprites). */
  render(
    map: CompiledMap,
    camera: Camera,
    target: Uint8ClampedArray,
    sprites?: readonly Sprite[],
    slides?: readonly number[],
    neighbors?: ReadonlyMap<string, ZoneNeighbor>,
  ): Promise<void>;
  /** Rebuild + upload the texel pool from the library (ALL entries — POT walls/flats + sprite atlases). */
  setTextures(textures: ReadonlyMap<string, Texture>): void;
  /** Re-point the output/staging/columns buffers at a new resolution (between frames, like the pool). */
  resize(config: RenderConfig): void;
  dispose(): void;
}

/** Pack an opaque RGB triple into the little-endian RGBA word the framebuffer uses. */
function packRgb(c: readonly [number, number, number]): number {
  return ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
}

/**
 * The compute shader: executes one frame's commands (see `frame-commands.ts` for the buffer layouts).
 * Each pixel scans its column's geometry spans nearest-wins (strict `<` + emission-order tie-break — the
 * CPU z-buffer over the same paint order), then replays the deferred phases over its local colour/depth.
 * The sampling math is the CPU renderer's, transcribed: same anchors, same integer truncation, same
 * shade/tint constants — the only divergence is f32 vs f64 rounding (measured 99.4-99.98 % pixel-identical
 * per scene by a Playwright CPU-vs-GPU diff at integration time; the in-repo contract is the f64 command
 * EXECUTOR in `frame-commands.spec.ts`, which pins the buffers against `renderFrame`'s output).
 */
const SHADER = /* wgsl */ `
struct Uniforms {
  width: u32,
  height: u32,
  horizon: i32,
  phaseCount: u32,
  focal: f32,
  camZ: f32,
  pad0: u32,
  pad1: u32,
}

struct TexInfo {
  offset: u32,   // first texel in the pool
  width: u32,
  height: u32,
  pad0: u32,
  perUnit: f32,   // wall texels per world unit (height / worldSize) — POT wall art only
  invWorld: f32,  // flat tiles per world unit (1 / worldSize) — POT flat art only
  anchorMod: f32, // (TEX_ANCHOR · perUnit) mod height, f64-precomputed — the wall-V anchor, phase only
  pad1: f32,
}

@group(0) @binding(0) var<uniform> uni: Uniforms;
@group(0) @binding(1) var<storage, read> columns: array<u32>; // per-column tables (geometry|windows|glass)
@group(0) @binding(2) var<storage, read> spans: array<u32>;   // SPAN_STRIDE words per geometry record
@group(0) @binding(3) var<storage, read> texInfo: array<TexInfo>;
@group(0) @binding(4) var<storage, read> texels: array<u32>;  // packed RGBA texel pool
@group(0) @binding(5) var<storage, read> aux: array<u32>;     // phases + glass layers + sprites
@group(0) @binding(6) var<storage, read_write> outPix: array<u32>;

const SENTINEL: f32 = 3.0e38; // the CPU z-buffer's Infinity: any real surface depth beats it

fn shadePack(texel: u32, shade: f32) -> u32 {
  let r = u32(f32(texel & 0xffu) * shade);
  let g = u32(f32((texel >> 8u) & 0xffu) * shade);
  let b = u32(f32((texel >> 16u) & 0xffu) * shade);

  return 0xff000000u | (b << 16u) | (g << 8u) | r;
}

// Sprite shading: the hit-flash multiplies shade beyond 1, so channels clamp at 255 (the CPU's min()).
fn shadePackClamp(texel: u32, shade: f32) -> u32 {
  let r = min(255u, u32(f32(texel & 0xffu) * shade));
  let g = min(255u, u32(f32((texel >> 8u) & 0xffu) * shade));
  let b = min(255u, u32(f32((texel >> 16u) & 0xffu) * shade));

  return 0xff000000u | (b << 16u) | (g << 8u) | r;
}

// The cool glass wash — coolGlassTint's constants verbatim (keep ${GLASS_TINT.keep} of the pixel + the
// pre-multiplied tint). Max channel 198 + ${GLASS_TINT.b} < 256, so no clamp is needed.
fn coolTint(c: u32) -> u32 {
  let r = u32(f32(c & 0xffu) * ${GLASS_TINT.keep}) + ${GLASS_TINT.r}u;
  let g = u32(f32((c >> 8u) & 0xffu) * ${GLASS_TINT.keep}) + ${GLASS_TINT.g}u;
  let b = u32(f32((c >> 16u) & 0xffu) * ${GLASS_TINT.keep}) + ${GLASS_TINT.b}u;

  return 0xff000000u | (b << 16u) | (g << 8u) | r;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= uni.width || gid.y >= uni.height) {
    return;
  }
  let x = gid.x;
  let xi = i32(gid.x);
  let yi = i32(gid.y);
  // Background fallback split at the horizon (the CPU pre-fill), overdrawn by any span below.
  var color: u32 = ${packRgb(BG_FLOOR)}u;
  if (yi < uni.horizon) {
    color = ${packRgb(BG_CEILING)}u;
  }
  var best: f32 = SENTINEL;
  let off = columns[2u * x];
  let count = columns[2u * x + 1u];

  // GEOMETRY — the merged span stream (primary walk + the clipped neighbour walks), nearest-wins.
  for (var s = 0u; s < count; s = s + 1u) {
    let base = (off + s) * ${SPAN_STRIDE}u;

    if (yi < i32(spans[base + 2u]) || yi > i32(spans[base + 3u])) {
      continue;
    }
    let kind = spans[base];

    if (kind == ${SPAN_WALL}u) {
      let depth = bitcast<f32>(spans[base + 7u]);

      if (depth < best) {
        let t = texInfo[spans[base + 1u]];
        let u = bitcast<f32>(spans[base + 4u]);
        let zPerRow = bitcast<f32>(spans[base + 5u]);
        let shade = bitcast<f32>(spans[base + 6u]);
        let col = u32(i32(u * t.perUnit) & i32(t.width - 1u));
        // The CPU's vRaw = (TEX_ANCHOR − (camZ + (horizon−y)·zPerRow)) · perUnit reaches ~10⁴ texels,
        // where one f32 ulp is ~2·10⁻³ texels — axis-aligned walls at neat distances sit ~10⁻⁴ from
        // texel boundaries, so computing it directly in f32 flips whole rows. Summing REDUCED terms
        // (the anchor pre-wrapped mod height on the CPU in f64 — dropping exact multiples of the
        // height, so the wrapped phase is untouched) keeps every f32 term small; floor()+& is the
        // two's-complement modulo, correct for the (now possibly negative) reduced value.
        let vRaw = t.anchorMod - uni.camZ * t.perUnit + f32(yi - uni.horizon) * (zPerRow * t.perUnit);
        let v = u32(i32(floor(vRaw)) & i32(t.height - 1u));

        color = shadePack(texels[t.offset + v * t.width + col], shade);
        best = depth;
      }
    } else if (kind == ${SPAN_FLAT}u) {
      let dz = bitcast<f32>(spans[base + 4u]);
      let dist = dz * uni.focal / f32(yi - uni.horizon);

      if (dist < best) {
        let t = texInfo[spans[base + 1u]];
        let rayX = bitcast<f32>(spans[base + 5u]);
        let rayY = bitcast<f32>(spans[base + 6u]);
        let falloff = bitcast<f32>(spans[base + 7u]);
        let light = bitcast<f32>(spans[base + 8u]);
        let camX = bitcast<f32>(spans[base + 9u]);  // the RECORDING pass's camera — a zone-portal
        let camY = bitcast<f32>(spans[base + 10u]); // neighbour walk records its translated position
        // The CPU adds FLAT_ANCHOR (${FLAT_ANCHOR} — an INTEGER tile count, so the wrapped phase is
        // identical without it) purely to make truncation act as floor. In f32 that addition would cost
        // ~10 bits of texel precision (visible one-texel jitter on dense art); floor()-wrap keeps them —
        // i32(floor(x)) & mask is the two's-complement modulo the CPU's positive-anchored & computes.
        let wx = (camX + dist * rayX) * t.invWorld;
        let wy = (camY + dist * rayY) * t.invWorld;
        let tcx = u32(i32(floor(wx * f32(t.width))) & i32(t.width - 1u));
        let tcy = u32(i32(floor(wy * f32(t.height))) & i32(t.height - 1u));
        let shade = light * clamp(falloff * f32(yi - uni.horizon), 0.25, 1.0);

        color = shadePack(texels[t.offset + tcy * t.width + tcx], shade);
        best = dist;
      }
    } else if (best == SENTINEL) {
      // SKY: paints only while nothing nearer holds the pixel, and leaves the depth at the sentinel —
      // any later finite span still wins, exactly like the CPU's untouched-z-buffer sky.
      let grad = clamp(f32(yi) / f32(uni.horizon), 0.0, 1.0);
      let r = u32(40.0 + 130.0 * grad);
      let g = u32(70.0 + 130.0 * grad);
      let b = u32(140.0 + 95.0 * grad);

      color = 0xff000000u | (b << 16u) | (g << 8u) | r;
    }
  }

  // DEFERRED PHASES, in recorded order — per seam: its glass set farthest-first, then its window-clipped
  // sprites; finally the primary glass, then the frame's sprites. The CPU's exact deferred sequence.
  for (var p = 0u; p < uni.phaseCount; p = p + 1u) {
    let pb = p * ${PHASE_STRIDE}u;
    let glassSet = bitcast<i32>(aux[pb]);
    let spriteBase = aux[pb + 1u];
    let spriteCount = aux[pb + 2u];
    let windowSeam = bitcast<i32>(aux[pb + 3u]);
    var goff = 0u;
    var gcount = 0u;

    if (glassSet >= 0) {
      let table = 5u * uni.width + 2u * (u32(glassSet) * uni.width + x);

      goff = columns[table];
      gcount = columns[table + 1u];
      // GLASS: blend this column's layers FARTHEST → NEAREST; an opaque frame texel stamps + writes
      // depth (sprites behind a mullion stay occluded), a clear texel / plain window gets the cool tint.
      for (var k = i32(gcount) - 1; k >= 0; k = k - 1) {
        let g = goff + u32(k) * ${GLASS_STRIDE}u;

        if (yi < bitcast<i32>(aux[g]) || yi > bitcast<i32>(aux[g + 1u])) {
          continue;
        }
        let depth = bitcast<f32>(aux[g + 6u]);

        if (best < depth) {
          continue; // a NEARER opaque surface holds this pixel — the glass is behind it
        }
        let tu = bitcast<f32>(aux[g + 4u]);
        var framed = false;

        if (tu >= 0.0) {
          let t = texInfo[aux[g + 7u]];
          let col = min(t.width - 1u, u32(tu));
          let vt = bitcast<i32>(aux[g + 2u]);
          let vh = bitcast<i32>(aux[g + 3u]) - vt; // the pane's TRUE extent — the texture's V anchor
          let v = clamp(i32((f32(yi - vt) / f32(vh)) * f32(t.height)), 0, i32(t.height) - 1);
          let texel = texels[t.offset + u32(v) * t.width + col];

          if ((texel >> 24u) >= 128u) {
            framed = true;
            color = shadePack(texel, bitcast<f32>(aux[g + 5u]));
            best = depth;
          }
        }
        if (!framed) {
          color = coolTint(color);
        }
      }
    }
    // SPRITES: the phase's records are already far-to-near; z-tested and alpha-tested per pixel,
    // window-clipped on a seam phase, tinted once per glass layer of THIS phase's set in front of them.
    // A record is a camera-facing BILLBOARD (constant depth/span) or a world-anchored VOXEL VOLUME —
    // ray-marched per pixel through its carved grid (an n × ny·nz image in the texel pool) with an
    // exact 3D DDA off the grid-space camera/axes in words 12+, WRITING each hit's depth (the CPU
    // z-buffer rule for volumes).
    for (var s = 0u; s < spriteCount; s = s + 1u) {
      let sb = spriteBase + s * ${SPRITE_STRIDE}u;
      let left = bitcast<i32>(aux[sb]);
      let right = bitcast<i32>(aux[sb + 1u]);
      let yTop = bitcast<i32>(aux[sb + 2u]);
      let yBottom = bitcast<i32>(aux[sb + 3u]);

      if (xi < left || xi > right || yi < yTop || yi > yBottom) {
        continue;
      }
      if (windowSeam >= 0) {
        let wb = 2u * uni.width + 3u * x;

        if (bitcast<i32>(columns[wb]) != windowSeam) {
          continue; // this column shows no opening of the seam — the sprite must not leak past it
        }
        if (yi < bitcast<i32>(columns[wb + 1u]) || yi > bitcast<i32>(columns[wb + 2u])) {
          continue;
        }
      }
      if (aux[sb + 11u] == ${SPRITE_VOXEL}u) {
        // VOXEL VOLUME — drawVoxel's math transcribed: the pixel's ray in GRID SPACE, a slab entry
        // window over the grid box, then an Amanatides & Woo march to the first solid cell.
        let n = i32(aux[sb + 5u]);
        let nyG = i32(aux[sb + 6u]);
        let nzG = i32(aux[sb + 7u]);
        let camGX = bitcast<f32>(aux[sb + 12u]);
        let camGY = bitcast<f32>(aux[sb + 13u]);
        let camGZ = bitcast<f32>(aux[sb + 14u]);
        let offCol = (f32(uni.width) / 2.0 - f32(xi)) / uni.focal;
        let dx = bitcast<f32>(aux[sb + 15u]) + offCol * bitcast<f32>(aux[sb + 17u]);
        let dy = bitcast<f32>(aux[sb + 16u]) + offCol * bitcast<f32>(aux[sb + 18u]);
        let dz = (f32(uni.horizon - yi) / uni.focal) * bitcast<f32>(aux[sb + 19u]);
        var tEnter: f32 = ${NEAR};
        var tExit: f32 = SENTINEL;
        var axis = 1;
        var missed = false;

        if (dx != 0.0) {
          let tx0 = (0.0 - camGX) / dx;
          let tx1 = (f32(n) - camGX) / dx;

          if (min(tx0, tx1) > tEnter) {
            tEnter = min(tx0, tx1);
            axis = 0;
          }
          tExit = max(tx0, tx1);
        } else if (camGX < 0.0 || camGX >= f32(n)) {
          missed = true;
        }
        if (dy != 0.0) {
          let ty0 = (0.0 - camGY) / dy;
          let ty1 = (f32(nyG) - camGY) / dy;

          if (min(ty0, ty1) > tEnter) {
            tEnter = min(ty0, ty1);
            axis = 1;
          }
          tExit = min(tExit, max(ty0, ty1));
        } else if (camGY < 0.0 || camGY >= f32(nyG)) {
          missed = true;
        }
        if (dz != 0.0) {
          let tz0 = (0.0 - camGZ) / dz;
          let tz1 = (f32(nzG) - camGZ) / dz;

          if (min(tz0, tz1) > tEnter) {
            tEnter = min(tz0, tz1);
            axis = 2;
          }
          tExit = min(tExit, max(tz0, tz1));
        } else if (camGZ < 0.0 || camGZ >= f32(nzG)) {
          missed = true;
        }
        if (missed || tEnter >= tExit || tEnter >= best) {
          continue; // misses the box, or the box entry is already behind the nearest surface here
        }
        let grid = texInfo[aux[sb + 4u]];
        var t = tEnter;
        var ix = clamp(i32(floor(camGX + t * dx)), 0, n - 1);
        var iy = clamp(i32(floor(camGY + t * dy)), 0, nyG - 1);
        var iz = clamp(i32(floor(camGZ + t * dz)), 0, nzG - 1);
        var stepX = -1;
        var tDeltaX: f32 = SENTINEL;
        var tMaxX: f32 = SENTINEL;
        var stepY = -1;
        var tDeltaY: f32 = SENTINEL;
        var tMaxY: f32 = SENTINEL;
        var stepZ = -1;
        var tDeltaZ: f32 = SENTINEL;
        var tMaxZ: f32 = SENTINEL;

        if (dx != 0.0) {
          stepX = select(-1, 1, dx > 0.0);
          tDeltaX = abs(1.0 / dx);
          tMaxX = (f32(ix + select(0, 1, dx > 0.0)) - camGX) / dx;
        }
        if (dy != 0.0) {
          stepY = select(-1, 1, dy > 0.0);
          tDeltaY = abs(1.0 / dy);
          tMaxY = (f32(iy + select(0, 1, dy > 0.0)) - camGY) / dy;
        }
        if (dz != 0.0) {
          stepZ = select(-1, 1, dz > 0.0);
          tDeltaZ = abs(1.0 / dz);
          tMaxZ = (f32(iz + select(0, 1, dz > 0.0)) - camGZ) / dz;
        }
        for (var stepI = 0u; stepI < ${VOXEL_MAX_STEPS}u; stepI = stepI + 1u) {
          if (t >= best) {
            break; // everything from here on is occluded (t only grows)
          }
          let texel = texels[grid.offset + u32((iz * nyG + iy) * n + ix)];

          if ((texel >> 24u) != 0u) {
            var face: f32 = ${VOXEL_SHADE.sideY};

            if (axis == 2) {
              face = select(${VOXEL_SHADE.bottom}, ${VOXEL_SHADE.top}, dz < 0.0);
            } else if (axis == 0) {
              face = ${VOXEL_SHADE.sideX};
            }
            color = shadePackClamp(texel, bitcast<f32>(aux[sb + 10u]) * face);
            best = t; // the volume writes depth — real geometry to every later surface
            for (var k = 0u; k < gcount; k = k + 1u) {
              let g = goff + k * ${GLASS_STRIDE}u;

              if (t <= bitcast<f32>(aux[g + 6u])) {
                break;
              }
              if (yi >= bitcast<i32>(aux[g]) && yi <= bitcast<i32>(aux[g + 1u])) {
                color = coolTint(color);
              }
            }
            break;
          }
          if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
            t = tMaxX;
            tMaxX = tMaxX + tDeltaX;
            ix = ix + stepX;
            axis = 0;
            if (ix < 0 || ix >= n) {
              break;
            }
          } else if (tMaxY <= tMaxZ) {
            t = tMaxY;
            tMaxY = tMaxY + tDeltaY;
            iy = iy + stepY;
            axis = 1;
            if (iy < 0 || iy >= nyG) {
              break;
            }
          } else {
            t = tMaxZ;
            tMaxZ = tMaxZ + tDeltaZ;
            iz = iz + stepZ;
            axis = 2;
            if (iz < 0 || iz >= nzG) {
              break;
            }
          }
        }
        continue;
      }
      // BILLBOARD — division-based atlas-cell sampling (non-POT art — no &-wrap): the cell coordinates
      // stay inside [u0, u0+cellW) × [v0, v0+cellH) by construction, the CPU's exact truncations.
      let forward = bitcast<f32>(aux[sb + 9u]);
      let texCol = aux[sb + 5u] + u32((f32(xi - left) / f32(right - left + 1)) * f32(aux[sb + 7u]));
      let t = texInfo[aux[sb + 4u]];
      let v = aux[sb + 6u] + u32((f32(yi - yTop) / f32(yBottom - yTop + 1)) * f32(aux[sb + 8u]));
      let texel = texels[t.offset + v * t.width + texCol];

      if (forward < best && (texel >> 24u) != 0u) {
        color = shadePackClamp(texel, bitcast<f32>(aux[sb + 10u]));
        // Seen THROUGH glass: one tint per layer of this phase's set in front of the sprite (layers are
        // nearest-first → stop at the first layer at/beyond the sprite's own depth).
        for (var k = 0u; k < gcount; k = k + 1u) {
          let g = goff + k * ${GLASS_STRIDE}u;

          if (forward <= bitcast<f32>(aux[g + 6u])) {
            break;
          }
          if (yi >= bitcast<i32>(aux[g]) && yi <= bitcast<i32>(aux[g + 1u])) {
            color = coolTint(color);
          }
        }
      }
    }
  }
  outPix[gid.y * uni.width + x] = color;
}
`;

/** Initial span-buffer capacity (records) — grows by doubling when a frame outgrows it. */
const INITIAL_SPAN_CAPACITY = 8192;
/** Initial aux-buffer capacity (words: phases + glass layers + sprites) — grows by doubling. */
const INITIAL_AUX_CAPACITY = 8192;

/**
 * Init WebGPU and build the backend, or `null` when the platform can't (SSR, no `navigator.gpu`, no
 * adapter/device) — the caller then keeps the CPU renderer, silently.
 */
export async function createGpuRenderer(config: RenderConfig): Promise<GpuRenderer | null> {
  if (typeof navigator === 'undefined' || navigator.gpu === undefined) {
    return null;
  }
  let device: GPUDevice;

  try {
    const adapter = await navigator.gpu.requestAdapter();

    if (adapter === null) {
      return null;
    }
    device = await adapter.requestDevice();
  } catch {
    return null;
  }

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: 'main' },
  });
  const uniformData = new ArrayBuffer(32);
  const uniformU32 = new Uint32Array(uniformData);
  const uniformI32 = new Int32Array(uniformData);
  const uniformF32 = new Float32Array(uniformData);
  const uniformBuf = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const cmds = createFrameCommands(); // the reused CPU-side command buffer
  const stats: GpuStats = { buildMs: 0, gpuMs: 0 };
  let cfg: RenderConfig = config;
  let lib: ReadonlyMap<string, Texture> = new Map(); // the live library (glass/sprite metrics need it)
  let ids = new Map<string, number>(); // surface name → texel-pool id (0 = MISSING)
  let spanCapacity = INITIAL_SPAN_CAPACITY;
  let auxCapacity = INITIAL_AUX_CAPACITY;
  let columnsCapacity = 0; // words — depends on width AND the frame's glass-set count (grow-only)
  let bindGroup: GPUBindGroup | null = null; // rebuilt lazily after any buffer swap
  let columnsBuf!: GPUBuffer;
  let outputBuf!: GPUBuffer;
  let stagingBuf!: GPUBuffer;
  let spansBuf = device.createBuffer({
    size: spanCapacity * SPAN_STRIDE * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let auxBuf = device.createBuffer({
    size: auxCapacity * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let texInfoBuf!: GPUBuffer;
  let texelsBuf!: GPUBuffer;

  const growColumns = (words: number): void => {
    columnsCapacity = Math.max(words, cfg.width * 7); // geometry + windows + one glass set minimum
    columnsBuf?.destroy();
    columnsBuf = device.createBuffer({
      size: columnsCapacity * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    bindGroup = null;
  };

  const configure = (next: RenderConfig): void => {
    const pixels = next.width * next.height;

    cfg = next;
    outputBuf?.destroy();
    stagingBuf?.destroy();
    growColumns(next.width * 7);
    outputBuf = device.createBuffer({
      size: pixels * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    stagingBuf = device.createBuffer({
      size: pixels * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    bindGroup = null;
  };

  // Upload a texture set as the pooled texel buffer + info table. Id 0 is always MISSING; the WHOLE
  // library follows in insertion order — POT walls/flats sample by `&`-wrap off perUnit/invWorld,
  // non-POT sprite atlases by division into their cell (their perUnit fields are simply unused).
  const upload = (textures: ReadonlyMap<string, Texture>): void => {
    const pool: Texture[] = [missingTexture()];
    const nextIds = new Map<string, number>();

    for (const [name, tex] of textures) {
      nextIds.set(name, pool.length);
      pool.push(tex);
    }
    const total = pool.reduce((sum, t) => sum + t.width * t.height, 0);
    const texels = new Uint32Array(total);
    const info = new ArrayBuffer(pool.length * 32);
    const infoU32 = new Uint32Array(info);
    const infoF32 = new Float32Array(info);
    let offset = 0;

    pool.forEach((tex, i) => {
      const words = new Uint32Array(
        tex.pixels.buffer,
        tex.pixels.byteOffset,
        tex.width * tex.height,
      );

      texels.set(words, offset);
      const perUnit = tex.height / (tex.worldSize ?? 1);

      infoU32[i * 8] = offset;
      infoU32[i * 8 + 1] = tex.width;
      infoU32[i * 8 + 2] = tex.height;
      infoF32[i * 8 + 4] = perUnit;
      infoF32[i * 8 + 5] = 1 / (tex.worldSize ?? 1);
      infoF32[i * 8 + 6] = (TEX_ANCHOR * perUnit) % tex.height; // f64 here — see the shader's vRaw note
      offset += tex.width * tex.height;
    });
    texInfoBuf?.destroy();
    texelsBuf?.destroy();
    texInfoBuf = device.createBuffer({
      size: info.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    texelsBuf = device.createBuffer({
      size: texels.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(texInfoBuf, 0, info);
    device.queue.writeBuffer(texelsBuf, 0, texels);
    lib = textures;
    ids = nextIds;
    bindGroup = null;
  };

  configure(config);
  upload(new Map()); // a valid (MISSING-only) pool until the caller supplies the real library

  return {
    stats,
    render(
      map: CompiledMap,
      camera: Camera,
      target: Uint8ClampedArray,
      sprites?: readonly Sprite[],
      slides?: readonly number[],
      neighbors?: ReadonlyMap<string, ZoneNeighbor>,
    ): Promise<void> {
      const buildStart = performance.now();

      buildFrameCommands(map, camera, cfg, lib, ids, sprites, slides, neighbors, cmds);
      stats.buildMs = performance.now() - buildStart;
      if (cmds.spanCount > spanCapacity) {
        while (cmds.spanCount > spanCapacity) {
          spanCapacity *= 2;
        }
        spansBuf.destroy();
        spansBuf = device.createBuffer({
          size: spanCapacity * SPAN_STRIDE * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        bindGroup = null;
      }
      if (cmds.auxWordCount > auxCapacity) {
        while (cmds.auxWordCount > auxCapacity) {
          auxCapacity *= 2;
        }
        auxBuf.destroy();
        auxBuf = device.createBuffer({
          size: auxCapacity * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        bindGroup = null;
      }
      if (cmds.columnsWordCount > columnsCapacity) {
        growColumns(cmds.columnsWordCount); // a zone with more visible seams → more glass-set tables
      }
      uniformU32[0] = cmds.width;
      uniformU32[1] = cmds.height;
      uniformI32[2] = cmds.horizon;
      uniformU32[3] = cmds.phaseCount;
      uniformF32[4] = cmds.focal;
      uniformF32[5] = cmds.camZ;
      device.queue.writeBuffer(uniformBuf, 0, uniformData);
      device.queue.writeBuffer(columnsBuf, 0, cmds.columns, 0, cmds.columnsWordCount);
      if (cmds.spanCount > 0) {
        device.queue.writeBuffer(spansBuf, 0, cmds.spanWords, 0, cmds.spanCount * SPAN_STRIDE);
      }
      if (cmds.auxWordCount > 0) {
        device.queue.writeBuffer(auxBuf, 0, cmds.auxWords, 0, cmds.auxWordCount);
      }
      bindGroup ??= device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuf } },
          { binding: 1, resource: { buffer: columnsBuf } },
          { binding: 2, resource: { buffer: spansBuf } },
          { binding: 3, resource: { buffer: texInfoBuf } },
          { binding: 4, resource: { buffer: texelsBuf } },
          { binding: 5, resource: { buffer: auxBuf } },
          { binding: 6, resource: { buffer: outputBuf } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();

      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(cmds.width / 8), Math.ceil(cmds.height / 8));
      pass.end();
      encoder.copyBufferToBuffer(outputBuf, 0, stagingBuf, 0, cmds.width * cmds.height * 4);
      const gpuStart = performance.now();

      device.queue.submit([encoder.finish()]);

      return stagingBuf.mapAsync(GPUMapMode.READ).then(() => {
        stats.gpuMs = performance.now() - gpuStart;
        target.set(new Uint8ClampedArray(stagingBuf.getMappedRange(), 0, target.length));
        stagingBuf.unmap();
      });
    },
    setTextures(textures: ReadonlyMap<string, Texture>): void {
      upload(textures);
    },
    resize(next: RenderConfig): void {
      configure(next);
    },
    dispose(): void {
      device.destroy();
    },
  };
}
