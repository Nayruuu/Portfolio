/// <reference lib="webworker" />
import {
  buildBsp,
  renderFrame,
  type Camera,
  type CompiledMap,
  type Sprite,
  type Texture,
} from '../../core/lib/bsp-engine';
import { DEMO_MAP } from './demo-map';
import { proceduralTextures } from './load-textures';

/**
 * A render worker: it owns one horizontal BAND of the frame and paints it into the SHARED framebuffer +
 * z-buffer (a `SharedArrayBuffer` it views directly — no copy). It rebuilds the map + procedural textures
 * itself (both deterministic / DOM-free), so the only per-frame traffic is the tiny camera. The main thread
 * splits the screen across N of these and composites once all report `done`. See `render-pool.ts`.
 */

interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number;
}

type Inbound =
  | {
      readonly type: 'init';
      readonly config: RenderConfig;
      readonly rowStart: number;
      readonly rowEnd: number;
      readonly frameSab: SharedArrayBuffer;
      readonly zbufSab: SharedArrayBuffer;
    }
  | { readonly type: 'render'; readonly camera: Camera; readonly sprites: readonly Sprite[] }
  | { readonly type: 'textures'; readonly textures: ReadonlyMap<string, Texture> };

const map: CompiledMap = buildBsp(DEMO_MAP);
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
  } else if (data.type === 'textures') {
    for (const [name, texture] of data.textures) {
      textures.set(name, texture); // swap WebP art in over the procedural base
    }
  } else {
    renderFrame(map, data.camera, config, textures, frame, zbuf, rowStart, rowEnd, data.sprites);
    postMessage('done');
  }
});
