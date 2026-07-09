/// <reference lib="webworker" />
import {
  buildBsp,
  renderFrame,
  type Camera,
  type CompiledMap,
  type MapSource,
  type Sprite,
  type Texture,
  type ZoneNeighbor,
} from '../../bsp-engine';
import { proceduralTextures } from './load-textures';

// Owns one horizontal BAND, painted into the SHARED framebuffer + z-buffer (a SharedArrayBuffer viewed
// directly — no copy). Every zone ever built is CACHED by key, which makes a seamless crossing free: a
// `swap` just promotes the held neighbor to primary. See `render-pool.ts`.

interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number;
}

/** Only `floorZ`/`ceilZ` change at runtime (animated doors). */
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
  | {
      readonly type: 'map';
      readonly key: string;
      readonly source: MapSource;
      // The maps of every zone the source's LIVE portals look into (rendered through the seams).
      readonly neighbors?: ReadonlyMap<string, MapSource>;
    }
  | {
      // The SEAMLESS crossing: promote held zone `key` to primary.
      readonly type: 'swap';
      readonly key: string;
      readonly neighbors?: ReadonlyMap<string, MapSource>;
    }
  | {
      readonly type: 'render';
      readonly camera: Camera;
      readonly sprites: readonly Sprite[];
      readonly sectors: SectorHeights;
      readonly slides: readonly number[]; // per-linedef sliding-door openness (0 shut … 1 open)
      // The warm neighbor's live billboards by zone key, in that zone's own coordinates.
      readonly neighborSprites?: ReadonlyMap<string, readonly Sprite[]>;
    }
  | { readonly type: 'textures'; readonly textures: ReadonlyMap<string, Texture> };

/** A held zone with its AUTHORED sector heights, restored when the zone is demoted from primary to neighbor
 *  (live door mutations must not linger in a neighbor render). */
interface HeldZone {
  readonly map: CompiledMap;
  readonly base: readonly { readonly floorZ: number; readonly ceilZ: number }[];
}

const zones = new Map<string, HeldZone>(); // every zone this worker has ever built, by key
let primary = ''; // '' until the first 'map' message — renders report done without painting
const textures = proceduralTextures();
let config: RenderConfig;
let rowStart = 0;
let rowEnd = 0;
let frame: Uint8ClampedArray;
let zbuf: Float32Array;

/** Build (and hold) a zone, recording the authored heights for later restore. */
function hold(key: string, source: MapSource): void {
  zones.set(key, {
    map: buildBsp(source),
    base: source.sectors.map((s) => ({ floorZ: s.floorZ, ceilZ: s.ceilZ })),
  });
}

/** Undo the primary-time door mutations — reset a held zone's sector heights to the authored ones. */
function restoreHeights(zone: HeldZone): void {
  const secs = zone.map.source.sectors as unknown as { floorZ: number; ceilZ: number }[];

  for (let i = 0; i < zone.base.length; i++) {
    secs[i].floorZ = zone.base[i].floorZ;
    secs[i].ceilZ = zone.base[i].ceilZ;
  }
}

addEventListener('message', ({ data }: MessageEvent<Inbound>) => {
  if (data.type === 'init') {
    config = data.config;
    rowStart = data.rowStart;
    rowEnd = data.rowEnd;
    frame = new Uint8ClampedArray(data.frameSab);
    zbuf = new Float32Array(data.zbufSab);
  } else if (data.type === 'map') {
    hold(data.key, data.source);
    for (const [key, source] of data.neighbors ?? []) {
      if (!zones.has(key)) {
        hold(key, source); // neighbors are registry-static — build each once, ever
      }
    }
    primary = data.key;
  } else if (data.type === 'swap') {
    const demoted = zones.get(primary);

    if (demoted !== undefined) {
      restoreHeights(demoted); // as a neighbor it renders the authored geometry again
    }
    for (const [key, source] of data.neighbors ?? []) {
      if (!zones.has(key)) {
        hold(key, source); // only never-seen neighbors compile — a reciprocal pair compiles nothing
      }
    }
    if (zones.has(data.key)) {
      primary = data.key;
    }
  } else if (data.type === 'textures') {
    for (const [name, texture] of data.textures) {
      textures.set(name, texture);
    }
  } else {
    const zone = zones.get(primary);

    if (zone === undefined) {
      postMessage('done'); // not yet pointed at a map — report done so the pool's frame doesn't hang

      return;
    }

    // Sync the live sector heights (animated doors mutate `ceilZ`); the renderer reads these straight off.
    const secs = zone.map.source.sectors as unknown as { floorZ: number; ceilZ: number }[];

    for (let i = 0; i < data.sectors.length && i < secs.length; i++) {
      secs[i].floorZ = data.sectors[i].floorZ;
      secs[i].ceilZ = data.sectors[i].ceilZ;
    }
    // Every held zone but the primary is offered as a portal neighbor (unused keys cost nothing); the warm
    // one carries this frame's live sprites.
    const neighbors = new Map<string, ZoneNeighbor>();

    for (const [key, held] of zones) {
      if (key !== primary) {
        neighbors.set(key, { map: held.map, sprites: data.neighborSprites?.get(key) });
      }
    }
    renderFrame(
      zone.map,
      data.camera,
      config,
      textures,
      frame,
      zbuf,
      rowStart,
      rowEnd,
      data.sprites,
      data.slides,
      neighbors,
    );
    postMessage('done');
  }
});
