import {
  BG_CEILING,
  BG_FLOOR,
  FLAT_ANCHOR,
  GLASS_STRIDE,
  GLASS_TINT,
  NEAR,
  PHASE_STRIDE,
  SPAN_FLAT,
  SPAN_STRIDE,
  SPAN_WALL,
  SPRITE_STRIDE,
  SPRITE_VOXEL,
  VOXEL_MAX_STEPS,
  VOXEL_SHADE,
} from '../../bsp-engine';

// little-endian RGBA word for the framebuffer
function packRgb(c: readonly [number, number, number]): number {
  return ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
}

// The compute shader: the CPU renderer's per-pixel math transcribed (same anchors, truncation, shade/tint
// constants); the only divergence is f32-vs-f64 rounding. Parity contract = the f64 executor in
// `frame-commands.spec.ts`, which pins the buffers against `renderFrame`'s output — keep this WGSL in step.
export const GPU_WGSL = /* wgsl */ `
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
  offset: u32,      // first index BYTE in the pool (indices pack 4 per word)
  width: u32,
  height: u32,
  paletteBase: u32, // first word of this texture's 256-entry palette
  perUnit: f32,   // wall texels per world unit (height / worldSize) — POT wall art only
  invWorld: f32,  // flat tiles per world unit (1 / worldSize) — POT flat art only
  anchorMod: f32, // (TEX_ANCHOR · perUnit) mod height, f64-precomputed — the wall-V anchor, phase only
  pad1: f32,
}

@group(0) @binding(0) var<uniform> uni: Uniforms;
@group(0) @binding(1) var<storage, read> columns: array<u32>; // per-column tables (geometry|windows|glass)
@group(0) @binding(2) var<storage, read> spans: array<u32>;   // SPAN_STRIDE words per geometry record
@group(0) @binding(3) var<storage, read> texInfo: array<TexInfo>;
@group(0) @binding(4) var<storage, read> texels: array<u32>;  // 1-byte palette-index pool, 4 per word
@group(0) @binding(5) var<storage, read> aux: array<u32>;     // phases + glass layers + sprites
@group(0) @binding(6) var<storage, read_write> outPix: array<u32>;
@group(0) @binding(7) var<storage, read> palettes: array<u32>; // 256 packed-RGBA words per texture

const SENTINEL: f32 = 3.0e38; // the CPU z-buffer's Infinity: any real surface depth beats it

// linear texel index → palette index byte → packed RGBA word. Index 0 IS transparent (palette[base]
// is 0x00000000), so callers keep their (texel >> 24u) alpha tests unchanged.
fn sampleTex(t: TexInfo, linear: u32) -> u32 {
  let byte = t.offset + linear;
  let index = (texels[byte >> 2u] >> ((byte & 3u) * 8u)) & 0xffu;

  return palettes[t.paletteBase + index];
}

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

        color = shadePack(sampleTex(t, v * t.width + col), shade);
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

        color = shadePack(sampleTex(t, tcy * t.width + tcx), shade);
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
          let texel = sampleTex(t, u32(v) * t.width + col);

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
          let texel = sampleTex(grid, u32((iz * nyG + iy) * n + ix));

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
      let texel = sampleTex(t, v * t.width + texCol);

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
