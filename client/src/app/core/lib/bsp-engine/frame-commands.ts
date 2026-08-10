import { focalFor, type Camera } from './camera';
import {
  makeGlass,
  makePortals,
  mapSprites,
  projectSprites,
  resetGlass,
  resetPortals,
  wallPass,
  GLASS_LAYERS,
  type GlassPanes,
  type PortalSpans,
  type RenderConfig,
  type Sprite,
  type SpriteQuad,
  type WalkSink,
  type ZoneNeighbor,
} from './renderer';
import type { TextureLibrary } from './texture';
import type { CompiledMap } from './types';

// The CPU half of the WebGPU compute backend: runs the software renderer's passes but RECORDS spans/
// glass/sprites into flat typed arrays a WGSL shader replays per pixel. No recursion for portals — seam
// windows are COLUMN-DISJOINT, so every span merges into one per-column stream whose emission order IS
// the CPU paint order, and deferred work is a flat PHASE list. Pure; buffers live in a reused scratch.

export const SPAN_STRIDE = 12; // u32 header + f32 params + padding — a fixed GPU storage stride

// Span kinds (word 0 of a record).
export const SPAN_WALL = 0;
export const SPAN_FLAT = 1;
export const SPAN_SKY = 2;

export const GLASS_STRIDE = 8;
// Billboards and voxel volumes share the stride — words 12+ are the voxel tail, zeroed on a billboard.
export const SPRITE_STRIDE = 20;
// SPRITE record kinds (word 11).
export const SPRITE_BILLBOARD = 0;
export const SPRITE_VOXEL = 1;
export const PHASE_STRIDE = 4;

/**
 * One built frame's command buffer. `spanWords`/`spanFloats` (and `auxWords`/`auxFloats`) are two views
 * over the SAME buffer — a span record is `SPAN_STRIDE` words at `index * SPAN_STRIDE`:
 *
 * | word | wall (`SPAN_WALL`)        | flat (`SPAN_FLAT`)          | sky (`SPAN_SKY`) |
 * |------|---------------------------|-----------------------------|------------------|
 * | 0    | kind (u32)                | kind                        | kind             |
 * | 1    | texture id (u32)          | texture id                  | 0                |
 * | 2    | y0 (u32, inclusive)       | y0                          | y0               |
 * | 3    | y1 (u32, inclusive)       | y1                          | y1               |
 * | 4    | u — wall texture column   | dz = camZ − planeZ (f32)    | 0                |
 * | 5    | zPerRow (f32)             | rayX (f32)                  | 0                |
 * | 6    | shade (f32)               | rayY (f32)                  | 0                |
 * | 7    | depth = forward (f32)     | falloff (f32)               | 0                |
 * | 8    | 0                         | light (f32)                 | 0                |
 * | 9    | 0                         | camX (f32 — ITS pass's cam) | 0                |
 * | 10   | 0                         | camY (f32)                  | 0                |
 * | 11   | 0 (reserved)              | 0 (reserved)                | 0 (reserved)     |
 *
 * A flat span carries its OWN camera x/y (words 9–10) because a zone-portal NEIGHBOUR pass records with
 * the camera translated into the neighbour's coordinates — `camX`/`camY` below describe the primary pass
 * only. Records are GROUPED per column in emission (= paint) order: column `x`'s spans live at indices
 * `columns[2x] .. columns[2x] + columns[2x+1] − 1`. A flat span's per-row depth is `dz · focal/(y −
 * horizon)`; a wall's is its constant `depth` — ties resolve to the EARLIER record, mirroring the CPU
 * z-buffer's strict `<` test over the same paint order.
 *
 * `columns` holds three sections (all per column, `columnsWordCount` words used):
 *
 * | words                      | content |
 * |----------------------------|---------|
 * | `[0, 2w)`                  | geometry `[offset, count]` (span-record indices) |
 * | `[2w, 5w)`                 | zone-portal windows `[seam (i32, −1 = none), top, bot]` |
 * | `[5w, 5w + 2w·setCount)`   | glass tables — set `s`, column `x` at `5w + 2(s·w + x)`: `[aux word offset, layer count]` |
 *
 * Glass SET 0 is the primary pass's; set `s + 1` is seam `s`'s neighbour glass. `aux` holds the deferred
 * work (`auxWordCount` words used): first `phaseCount` PHASE records `[glassSet (i32, −1 = none),
 * spriteBase (aux word offset), spriteCount, windowSeam (i32, −1 = none)]` — seam phases in seam order,
 * the primary phase last — then the glass-layer records, then the sprite records:
 *
 * | GLASS word | content            | SPRITE word | content |
 * |------------|--------------------|-------------|---------|
 * | 0–3        | top, bot, vTop, vBot (i32) | 0–3 | left, right, yTop, yBottom (i32) |
 * | 4          | tu (f32, −1 = plain window)| 4–8 | texId, u0, v0, cellW, cellH (u32) — a voxel record repurposes 5–8 as n, ny, nz, 0 |
 * | 5          | shade (f32)        | 9           | forward (f32) |
 * | 6          | depth (f32)        | 10          | shade (f32) |
 * | 7          | texId (u32)        | 11          | kind (u32 — `SPRITE_BILLBOARD` / `SPRITE_VOXEL`) |
 * |            |                    | 12–19       | voxel only (else 0): camGX, camGY, camGZ, fwdGX, fwdGY, rightGX, rightGY, zScale (f32) |
 *
 * A VOXEL record's `left`/`right`/`yTop`/`yBottom` are the volume's screen ENVELOPE (early reject);
 * the shader ray-marches the carved grid per pixel off words 5–7 + 12–19 (see {@link VoxelQuad} — the
 * grid rides the ordinary texel pool as an n × ny·nz image) and — unlike a billboard — writes each
 * hit's depth into the pixel's depth register.
 *
 * Glass layers are stored nearest-first per column (the walk's front-to-back order): the shader blends
 * them in REVERSE (farthest-first) and scans them forward for the sprite tint — the CPU's exact orders.
 */
export interface FrameCommands {
  spanWords: Uint32Array<ArrayBuffer>; // plain-ArrayBuffer-backed: uploadable as-is via GPUQueue.writeBuffer
  spanFloats: Float32Array<ArrayBuffer>;
  spanCount: number;
  /** Per-column tables (geometry + windows + glass) — see the layout above; grow-only. */
  columns: Uint32Array<ArrayBuffer>;
  columnsWordCount: number;
  /** The deferred-work buffer (phases + glass layers + sprites) — see the layout above; grow-only. */
  auxWords: Uint32Array<ArrayBuffer>;
  auxFloats: Float32Array<ArrayBuffer>;
  auxWordCount: number;
  setCount: number; // glass sets (1 + seam count — set 0 = primary)
  phaseCount: number;
  width: number;
  height: number;
  focal: number;
  horizon: number;
  camX: number; // the PRIMARY camera (flat spans carry their own pass camera)
  camY: number;
  camZ: number;
}

export function createFrameCommands(): FrameCommands {
  return {
    spanWords: new Uint32Array(0),
    spanFloats: new Float32Array(0),
    spanCount: 0,
    columns: new Uint32Array(0),
    columnsWordCount: 0,
    auxWords: new Uint32Array(0),
    auxFloats: new Float32Array(0),
    auxWordCount: 0,
    setCount: 1,
    phaseCount: 0,
    width: 0,
    height: 0,
    focal: 0,
    horizon: 0,
    camX: 0,
    camY: 0,
    camZ: 0,
  };
}

// Deliberately small so the doubling growth path stays exercised by ordinary test frames.
const INITIAL_CAPACITY = 64;

// One neighbour-glass slot per seam — unlike the CPU's sequential reuse, every seam's layers must survive
// until serialization.
interface BuilderScratch {
  width: number;
  capacity: number;
  rawWords: Uint32Array;
  rawFloats: Float32Array;
  rawCol: Int32Array;
  counts: Uint32Array;
  cursor: Uint32Array;
  topClip: Int16Array;
  botClip: Int16Array;
  glass: GlassPanes;
  neighborGlass: GlassPanes[];
  portals: PortalSpans;
}

let scratch: BuilderScratch | null = null;

// (Re)allocated only when the render width changes.
function builderScratch(width: number): BuilderScratch {
  if (scratch === null || scratch.width !== width) {
    scratch = {
      width,
      capacity: scratch?.capacity ?? INITIAL_CAPACITY,
      rawWords: scratch?.rawWords ?? new Uint32Array(INITIAL_CAPACITY * SPAN_STRIDE),
      rawFloats: scratch?.rawFloats ?? new Float32Array(0),
      rawCol: scratch?.rawCol ?? new Int32Array(INITIAL_CAPACITY),
      counts: new Uint32Array(width),
      cursor: new Uint32Array(width),
      topClip: new Int16Array(width),
      botClip: new Int16Array(width),
      glass: makeGlass(width),
      neighborGlass: [],
      portals: makePortals(width),
    };
    scratch.rawFloats = new Float32Array(scratch.rawWords.buffer);
  }

  return scratch;
}

function grow(scr: BuilderScratch): void {
  scr.capacity *= 2;
  const words = new Uint32Array(scr.capacity * SPAN_STRIDE);
  const col = new Int32Array(scr.capacity);

  words.set(scr.rawWords);
  col.set(scr.rawCol);
  scr.rawWords = words;
  scr.rawFloats = new Float32Array(words.buffer);
  scr.rawCol = col;
}

// Grow-only.
function fitWords(current: Uint32Array<ArrayBuffer>, words: number): Uint32Array<ArrayBuffer> {
  return current.length >= words ? current : new Uint32Array(words);
}

function glassTotal(panes: GlassPanes | null, width: number): number {
  if (panes === null) {
    return 0;
  }
  let total = 0;

  for (let x = 0; x < width; x++) {
    total += panes.count[x];
  }

  return total;
}

// Records the renderer's passes exactly (same projection/clipping/paint order). `textureIds` maps surface
// names to GPU pool ids; an absent name → id 0, the reserved MISSING slot. Pass the previous frame's `out`
// to render (almost) allocation-free.
export function buildFrameCommands(
  map: CompiledMap,
  camera: Camera,
  config: RenderConfig,
  textures: TextureLibrary,
  textureIds: ReadonlyMap<string, number>,
  sprites?: readonly Sprite[],
  slides?: readonly number[],
  neighbors?: ReadonlyMap<string, ZoneNeighbor>,
  out?: FrameCommands,
): FrameCommands {
  const { width, height, fov } = config;
  const focal = focalFor(width, fov);
  const horizon = (height >> 1) + Math.round((camera.pitch ?? 0) * (height >> 1));
  const scr = builderScratch(width);
  const dims = { width, height, rowStart: 0, rowEnd: height };
  const topClip = scr.topClip.fill(0);
  const botClip = scr.botClip.fill(height - 1);
  const counts = scr.counts.fill(0);
  let n = 0;

  // Reserve the next raw record slot (growing if full) and stamp its header; returns the word base.
  const open = (x: number, kind: number, texId: number, y0: number, y1: number): number => {
    if (n === scr.capacity) {
      grow(scr);
    }
    const base = n * SPAN_STRIDE;

    scr.rawWords.fill(0, base, base + SPAN_STRIDE);
    scr.rawWords[base] = kind;
    scr.rawWords[base + 1] = texId;
    scr.rawWords[base + 2] = y0;
    scr.rawWords[base + 3] = y1;
    scr.rawCol[n] = x;
    counts[x]++;
    n++;

    return base;
  };

  // A NEIGHBOUR walk re-points these at its translated camera, so its flat spans carry the coordinates
  // their world points project from (walls only need the shared camZ).
  let passCamX = camera.x;
  let passCamY = camera.y;

  const sink: WalkSink = {
    sky: (x, y0, y1): void => {
      if (y1 >= y0) {
        open(x, SPAN_SKY, 0, y0, y1);
      }
    },
    flat: (x, y0, y1, _tex, name, planeZ, rayX, rayY, falloff, light): void => {
      if (y1 >= y0) {
        const base = open(x, SPAN_FLAT, textureIds.get(name) ?? 0, y0, y1);

        scr.rawFloats[base + 4] = camera.z - planeZ;
        scr.rawFloats[base + 5] = rayX;
        scr.rawFloats[base + 6] = rayY;
        scr.rawFloats[base + 7] = falloff;
        scr.rawFloats[base + 8] = light;
        scr.rawFloats[base + 9] = passCamX;
        scr.rawFloats[base + 10] = passCamY;
      }
    },
    wall: (x, y0, y1, _tex, name, u, zPerRow, shade, forward): void => {
      if (y1 >= y0) {
        const base = open(x, SPAN_WALL, textureIds.get(name) ?? 0, y0, y1);

        scr.rawFloats[base + 4] = u;
        scr.rawFloats[base + 5] = zPerRow;
        scr.rawFloats[base + 6] = shade;
        scr.rawFloats[base + 7] = forward;
      }
    },
  };

  // PRIMARY pass — glass-free maps pay nothing.
  const glass = map.source.linedefs.some((l) => l.glass === true) ? resetGlass(scr.glass) : null;
  const portals =
    neighbors !== undefined && map.source.linedefs.some((l) => l.zonePortal !== undefined)
      ? { spans: resetPortals(scr.portals), neighbors }
      : null;

  wallPass({
    map,
    camera,
    textures,
    dims,
    focal,
    horizon,
    topClip,
    botClip,
    glass,
    slides,
    portals,
    sink,
  });

  // NEIGHBOUR passes: camera translated into the zone, clip windows pre-loaded from the seam's recorded
  // columns, no nested portals (depth-1 cap). Column-disjoint windows → merged order is the CPU paint order.
  const seams = portals?.spans.seams ?? [];
  const neighborQuads: SpriteQuad[][] = [];
  const neighborGlass: (GlassPanes | null)[] = [];

  for (let s = 0; s < seams.length; s++) {
    const seam = seams[s];

    if (scr.neighborGlass.length === s) {
      scr.neighborGlass.push(makeGlass(width)); // grow-only: one recording slot per seam index
    }
    if (seam.columns === 0) {
      neighborQuads.push([]);
      neighborGlass.push(null);
      continue; // visited but every column already occluded — nothing to record
    }
    const spans = scr.portals;

    for (let x = 0; x < width; x++) {
      const mine = spans.seam[x] === s;

      topClip[x] = mine ? spans.top[x] : 1;
      botClip[x] = mine ? spans.bot[x] : 0;
    }
    const ncam: Camera = { ...camera, x: camera.x - seam.dx, y: camera.y - seam.dy };
    const nglass = seam.neighbor.map.source.linedefs.some((l) => l.glass === true)
      ? resetGlass(scr.neighborGlass[s])
      : null;

    passCamX = ncam.x;
    passCamY = ncam.y;
    wallPass({
      map: seam.neighbor.map,
      camera: ncam,
      textures,
      dims,
      focal,
      horizon,
      topClip,
      botClip,
      glass: nglass,
      slides: undefined,
      portals: null,
      sink,
    });
    neighborGlass.push(nglass);
    neighborQuads.push(
      seam.neighbor.sprites !== undefined && seam.neighbor.sprites.length > 0
        ? projectSprites(
            seam.neighbor.sprites,
            seam.neighbor.map,
            ncam,
            width,
            focal,
            horizon,
            textures,
          )
        : [],
    );
  }
  const primaryQuads = projectSprites(
    sprites ?? mapSprites(map), // fallback: the map's static decor — the CPU path's twin
    map,
    camera,
    width,
    focal,
    horizon,
    textures,
  );

  // --- Serialize -------------------------------------------------------------------------------
  const cmds = out ?? createFrameCommands();
  const setCount = 1 + seams.length;
  const columnsWords = width * (5 + 2 * setCount);

  cmds.columns = fitWords(cmds.columns, columnsWords);

  // Prefix-sum counts into offsets, then a stable counting-sort scatter — within a column the merged
  // paint order (the CPU tie-breaker) is preserved.
  let offset = 0;

  for (let x = 0; x < width; x++) {
    cmds.columns[2 * x] = offset;
    cmds.columns[2 * x + 1] = counts[x];
    offset += counts[x];
  }
  if (cmds.spanWords.length < n * SPAN_STRIDE) {
    cmds.spanWords = new Uint32Array(scr.capacity * SPAN_STRIDE);
    cmds.spanFloats = new Float32Array(cmds.spanWords.buffer);
  }
  const cursor = scr.cursor.fill(0);

  for (let i = 0; i < n; i++) {
    const x = scr.rawCol[i];
    const src = i * SPAN_STRIDE;
    const dst = (cmds.columns[2 * x] + cursor[x]) * SPAN_STRIDE;

    cursor[x]++;
    for (let w = 0; w < SPAN_STRIDE; w++) {
      cmds.spanWords[dst + w] = scr.rawWords[src + w];
    }
  }

  // −1 = no seam window; negatives store two's-complement in the u32 array, the shader bitcasts back.
  for (let x = 0; x < width; x++) {
    const base = 2 * width + 3 * x;

    cmds.columns[base] = portals !== null ? scr.portals.seam[x] : -1;
    cmds.columns[base + 1] = portals !== null ? scr.portals.top[x] : 0;
    cmds.columns[base + 2] = portals !== null ? scr.portals.bot[x] : 0;
  }

  // Aux layout: phases, then the glass records (set 0 = primary, then per seam), then the sprites.
  const phaseCount = seams.length + 1; // one per seam (in order) + the primary phase, always last
  const glassSets: (GlassPanes | null)[] = [glass, ...neighborGlass];
  let glassWords = 0;

  for (const set of glassSets) {
    glassWords += glassTotal(set, width) * GLASS_STRIDE;
  }
  let spriteCount = primaryQuads.length;

  for (const quads of neighborQuads) {
    spriteCount += quads.length;
  }
  const auxWords = phaseCount * PHASE_STRIDE + glassWords + spriteCount * SPRITE_STRIDE;

  cmds.auxWords = fitWords(cmds.auxWords, auxWords);
  if (cmds.auxFloats.buffer !== cmds.auxWords.buffer) {
    cmds.auxFloats = new Float32Array(cmds.auxWords.buffer);
  }

  // Glass tables + records (nearest-first per column, the walk's recording order).
  let g = phaseCount * PHASE_STRIDE;

  for (let s = 0; s < glassSets.length; s++) {
    const set = glassSets[s];

    for (let x = 0; x < width; x++) {
      const table = 5 * width + 2 * (s * width + x);
      const count = set === null ? 0 : set.count[x];

      cmds.columns[table] = g;
      cmds.columns[table + 1] = count;
      for (let k = 0; k < count && set !== null; k++) {
        const l = x * GLASS_LAYERS + k;

        cmds.auxWords[g] = set.top[l];
        cmds.auxWords[g + 1] = set.bot[l];
        cmds.auxWords[g + 2] = set.vTop[l];
        cmds.auxWords[g + 3] = set.vBot[l];
        cmds.auxFloats[g + 4] = set.tu[l];
        cmds.auxFloats[g + 5] = set.shade[l];
        cmds.auxFloats[g + 6] = set.depth[l];
        cmds.auxWords[g + 7] = set.tu[l] >= 0 ? (textureIds.get(set.name[l]) ?? 0) : 0;
        g += GLASS_STRIDE;
      }
    }
  }

  // Phase order = the CPU's deferred order: each seam's [glass, sprites], then the primary [glass, sprites].
  const writeQuads = (quads: readonly SpriteQuad[], at: number): void => {
    let w = at;

    for (const q of quads) {
      cmds.auxWords[w] = q.left;
      cmds.auxWords[w + 1] = q.right;
      cmds.auxWords[w + 2] = q.yTop;
      cmds.auxWords[w + 3] = q.yBottom;
      cmds.auxWords[w + 4] = textureIds.get(q.name) ?? 0;
      cmds.auxFloats[w + 9] = q.forward;
      cmds.auxFloats[w + 10] = q.shade;
      if (q.vox === undefined) {
        cmds.auxWords[w + 5] = q.u0;
        cmds.auxWords[w + 6] = q.v0;
        cmds.auxWords[w + 7] = q.cellW;
        cmds.auxWords[w + 8] = q.cellH;
        // The voxel tail is zeroed explicitly — `cmds` buffers are REUSED across frames.
        cmds.auxWords.fill(0, w + 11, w + SPRITE_STRIDE);
      } else {
        // A voxel record repurposes the atlas-cell words as its grid dimensions.
        cmds.auxWords[w + 5] = q.vox.n;
        cmds.auxWords[w + 6] = q.vox.ny;
        cmds.auxWords[w + 7] = q.vox.nz;
        cmds.auxWords[w + 8] = 0;
        cmds.auxWords[w + 11] = SPRITE_VOXEL;
        cmds.auxFloats[w + 12] = q.vox.camGX;
        cmds.auxFloats[w + 13] = q.vox.camGY;
        cmds.auxFloats[w + 14] = q.vox.camGZ;
        cmds.auxFloats[w + 15] = q.vox.fwdGX;
        cmds.auxFloats[w + 16] = q.vox.fwdGY;
        cmds.auxFloats[w + 17] = q.vox.rightGX;
        cmds.auxFloats[w + 18] = q.vox.rightGY;
        cmds.auxFloats[w + 19] = q.vox.zScale;
      }
      w += SPRITE_STRIDE;
    }
  };
  let spriteBase = phaseCount * PHASE_STRIDE + glassWords;

  for (let s = 0; s < seams.length; s++) {
    const quads = neighborQuads[s];
    const p = s * PHASE_STRIDE;

    cmds.auxWords[p] = neighborGlass[s] !== null ? s + 1 : -1;
    cmds.auxWords[p + 1] = spriteBase;
    cmds.auxWords[p + 2] = quads.length;
    cmds.auxWords[p + 3] = s;
    writeQuads(quads, spriteBase);
    spriteBase += quads.length * SPRITE_STRIDE;
  }
  const p = seams.length * PHASE_STRIDE;

  cmds.auxWords[p] = glass !== null ? 0 : -1;
  cmds.auxWords[p + 1] = spriteBase;
  cmds.auxWords[p + 2] = primaryQuads.length;
  cmds.auxWords[p + 3] = -1;
  writeQuads(primaryQuads, spriteBase);

  cmds.spanCount = n;
  cmds.columnsWordCount = columnsWords;
  cmds.auxWordCount = auxWords;
  cmds.setCount = setCount;
  cmds.phaseCount = phaseCount;
  cmds.width = width;
  cmds.height = height;
  cmds.focal = focal;
  cmds.horizon = horizon;
  cmds.camX = camera.x;
  cmds.camY = camera.y;
  cmds.camZ = camera.z;

  return cmds;
}
