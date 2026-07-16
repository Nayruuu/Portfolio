/// <reference types="@webgpu/types" />

import {
  buildFrameCommands,
  createFrameCommands,
  missingTexture,
  SPAN_STRIDE,
  TEX_ANCHOR,
  type Camera,
  type CompiledMap,
  type RenderConfig,
  type Sprite,
  type Texture,
  type ZoneNeighbor,
} from '../../bsp-engine';
import { GPU_WGSL } from './gpu-shader';

/**
 * The DEFAULT backend (`?renderer=cpu` forces the CPU worker-pool path, also the automatic fallback). The
 * DOOM algorithm stays on the CPU: `buildFrameCommands` emits the per-column span + deferred-phase buffers,
 * and this module runs a WGSL COMPUTE shader (one invocation per pixel) that replays the CPU renderer's
 * EXACT per-pixel sequence — NO triangle rasterization anywhere.
 *
 * Texture storage is a flat STORAGE-BUFFER texel pool + info table, NOT a `texture_2d_array`, because the
 * library mixes sizes: POT walls/flats keep the integer `& (size−1)` wrap; sprites/glass sample by division.
 * Present reads the output buffer back into the caller's `ImageData` (the 2D overlay stack works unchanged).
 * Browser-only: SSR / any init failure resolves `null` and the caller stays on the CPU renderer.
 */

/** Last frame's timings: command build (CPU) and submit→readback-mapped (GPU + readback). */
export interface GpuStats {
  buildMs: number;
  gpuMs: number;
}

export interface GpuRenderer {
  /** A STABLE object mutated in place each frame — safe to expose once (e.g. on the perf ring). */
  readonly stats: GpuStats;
  render(
    map: CompiledMap,
    camera: Camera,
    target: Uint8ClampedArray,
    sprites?: readonly Sprite[],
    slides?: readonly number[],
    neighbors?: ReadonlyMap<string, ZoneNeighbor>,
  ): Promise<void>;
  setTextures(textures: ReadonlyMap<string, Texture>): void;
  /** Re-point the buffers at a new resolution — between frames only, like the pool. */
  resize(config: RenderConfig): void;
  dispose(): void;
}

const INITIAL_SPAN_CAPACITY = 8192; // records — grows by doubling when a frame outgrows it
const INITIAL_AUX_CAPACITY = 8192; // words (phases + glass layers + sprites) — grows by doubling

/** `null` when the platform can't (SSR, no `navigator.gpu`, no adapter/device) — the caller keeps the CPU renderer. */
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
    // The default binding cap is 128 MB — the texel pool (all atlases + every voxel grid) can exceed it.
    // Ask for what the adapter really offers, capped at 1 GB; setTextures still guards the granted limit.
    const gib = 1 << 30;

    device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, gib),
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, gib),
      },
    });
  } catch {
    return null;
  }

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: GPU_WGSL }), entryPoint: 'main' },
  });
  const uniformData = new ArrayBuffer(32);
  const uniformU32 = new Uint32Array(uniformData);
  const uniformI32 = new Int32Array(uniformData);
  const uniformF32 = new Float32Array(uniformData);
  const uniformBuf = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const cmds = createFrameCommands();
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

  // Id 0 is always MISSING; the rest follow in insertion order (POT walls/flats sample by `&`-wrap off
  // perUnit/invWorld, non-POT atlases by division into their cell).
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
    // Both granted limits bind the pool buffer (spec-legal adapters may order them either way).
    const bufferCap = Math.min(
      device.limits.maxStorageBufferBindingSize,
      device.limits.maxBufferSize,
    );

    if (texels.byteLength > bufferCap) {
      // WebGPU would NOT throw here — createBuffer just goes invalid and every later submit fails
      // validation, a silent per-frame death with no fallback. Throw so the host can drop to CPU.
      throw new Error(
        `gpu texel pool ${texels.byteLength} B exceeds the granted limit ${bufferCap} B`,
      );
    }
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
