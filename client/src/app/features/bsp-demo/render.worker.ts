/// <reference lib="webworker" />
import {
  buildBsp,
  renderFrame,
  type Camera,
  type CompiledMap,
  type MapSource,
  type Sprite,
  type Texture,
} from '../../core/lib/bsp-engine';
import { proceduralTextures } from './load-textures';

/**
 * A render worker: it owns one horizontal BAND of the frame and paints it into the SHARED framebuffer +
 * z-buffer (a `SharedArrayBuffer` it views directly — no copy). The main thread sends it the level's
 * `MapSource` once (so every level renders, not a hard-coded one) and, each frame, the camera + the live
 * sector heights (so animated doors — a mutated `ceilZ` — show in the worker render too). The screen is split
 * across N of these and composited once all report `done`. See `render-pool.ts`.
 */

interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number;
}

/** The per-frame live sector heights (floorZ/ceilZ) — only these change at runtime (animated doors). */
type SectorHeights = readonly { readonly floorZ: number; readonly ceilZ: number }[];

type Inbound =
  | {
      readonly type: 'init';
      readonly config: RenderConfig;
      readonly rowStart: number;
      readonly rowEnd: number;
      readonly frameSab: SharedArrayBuffer;
      readonly zbufSab: SharedArrayBuffer;
    }
  | { readonly type: 'map'; readonly source: MapSource }
  | {
      readonly type: 'render';
      readonly camera: Camera;
      readonly sprites: readonly Sprite[];
      readonly sectors: SectorHeights;
      readonly slides: readonly number[]; // per-linedef sliding-door openness (0 shut … 1 open)
    }
  | { readonly type: 'textures'; readonly textures: ReadonlyMap<string, Texture> };

let map: CompiledMap | null = null; // built from the level's source on the 'map' message (null until then)
const textures = proceduralTextures();
let config: RenderConfig;
let rowStart = 0;
let rowEnd = 0;
let frame: Uint8ClampedArray;
let zbuf: Float32Array;

addEventListener('message', ({ data }: MessageEvent<Inbound>) => {
  if (data.type === 'init') {
    config = data.config;
    rowStart = data.rowStart;
    rowEnd = data.rowEnd;
    frame = new Uint8ClampedArray(data.frameSab);
    zbuf = new Float32Array(data.zbufSab);
  } else if (data.type === 'map') {
    map = buildBsp(data.source);
  } else if (data.type === 'textures') {
    for (const [name, texture] of data.textures) {
      textures.set(name, texture); // swap WebP art in over the procedural base
    }
  } else {
    if (map === null) {
      postMessage('done'); // not yet pointed at a map — report done so the pool's frame doesn't hang

      return;
    }

    // Sync the live sector heights (animated doors mutate `ceilZ`); the renderer reads these straight off.
    const secs = map.source.sectors as unknown as { floorZ: number; ceilZ: number }[];

    for (let i = 0; i < data.sectors.length && i < secs.length; i++) {
      secs[i].floorZ = data.sectors[i].floorZ;
      secs[i].ceilZ = data.sectors[i].ceilZ;
    }
    renderFrame(
      map,
      data.camera,
      config,
      textures,
      frame,
      zbuf,
      rowStart,
      rowEnd,
      data.sprites,
      data.slides,
    );
    postMessage('done');
  }
});
