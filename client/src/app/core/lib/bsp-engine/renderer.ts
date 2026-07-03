import { focalFor, projectColumn, toCamera, type Camera, type CamPoint } from './camera';
import { locateSubSector, signedSide } from './node-builder';
import { missingTexture, TEX_WORLD, type Texture, type TextureLibrary } from './texture';
import type { CompiledMap, NodeChild, Sector, Seg, ThingType, ZonePortalDef } from './types';

/**
 * The software renderer (SP2–SP5). Walks the BSP front-to-back from the camera and, per column, draws the
 * near sector's textured CEILING (above), the wall (solid, or a portal's upper/lower bands), and the
 * textured FLOOR (below) — each sampled + distance-shaded, with a per-column occlusion window. It then
 * draws billboard SPRITES (things), depth-tested per pixel against the wall z-buffer, with alpha.
 *
 * Walls texture by U along the wall (perspective-correct) and V by world height. Floors/ceilings are cast
 * per pixel: a precomputed per-row distance table gives the world point under each screen pixel, which
 * samples the flat's texture (no per-pixel divide for depth). Pitch shears the horizon (look up/down).
 * Pure: `(map, camera, config, textures, target?) -> Uint8ClampedArray`; the canvas blit lives outside.
 *
 * ZONE PORTALS: a one-sided linedef carrying {@link ZonePortalDef} is a LIVE window into another zone's
 * map. The primary walk records its per-column opening (like glass records panes) and closes the column;
 * a NEIGHBOR pass then re-walks that zone's BSP with the camera translated by (−dx, −dy), restricted to
 * the recorded windows, into the same framebuffer + z-buffer (translation preserves distances, so depth
 * stays coherent for sprites and the glass blend). Depth is capped at 1 — see {@link renderNeighbors}.
 */

/** Internal framebuffer dimensions + horizontal field of view. */
export interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number; // radians
}

type Rgb = readonly [number, number, number];

/** A wall endpoint in camera space, carrying the texture coordinate `u` (distance along the linedef). */
interface WallVert {
  readonly forward: number;
  readonly side: number;
  readonly u: number;
}

/**
 * Framebuffer dimensions + the row band this pass is responsible for, `[rowStart, rowEnd)`. A full-frame
 * render uses `[0, height)`; a worker renders only its horizontal slice, so writes clamp to the band.
 */
interface Dims {
  readonly width: number;
  readonly height: number;
  readonly rowStart: number;
  readonly rowEnd: number;
}

/** Background fallback colours (columns no wall reaches): ceiling above the horizon, floor below.
 *  Exported so the GPU command path reproduces the exact same backdrop. */
export const BG_CEILING: Rgb = [34, 36, 46];
export const BG_FLOOR: Rgb = [54, 48, 42];
const NEAR = 0.02; // near clip plane (forward distance)

/** World-Z anchor for wall vertical tiling, above any ceiling → texture row ≥ 0. (Exported: the GPU
 *  compute shader must anchor its wall V exactly the same way for pixel parity.) */
export const TEX_ANCHOR = 64;
/** World-XY anchor for floor/ceiling tiling (a whole number of tiles) → UV ≥ 0. (Exported for the GPU
 *  compute shader — same parity contract as {@link TEX_ANCHOR}.) */
export const FLAT_ANCHOR = 1024;

/** How a thing type renders as a billboard sprite: its texture name + world size (none = not a sprite). */
interface SpriteDef {
  readonly tex: string;
  readonly width: number;
  readonly height: number;
}
const SPRITES: Partial<Record<ThingType, SpriteDef>> = {
  barrel: { tex: 'BARREL', width: 0.8, height: 1.1 },
  prop: { tex: 'PROP', width: 0.8, height: 1.6 }, // potted lobby plant
  prop_screen: { tex: 'PROP_SCREEN', width: 0.6, height: 0.6 }, // crashed reception monitor (sits on a counter block)
  prop_totem: { tex: 'PROP_TOTEM', width: 0.7, height: 2.0 }, // free-standing lobby directory totem
};

/**
 * A billboard to paint this frame: a world position + base height `z` + the texture/size to draw there. `z`
 * is the world height of the sprite's bottom — the sector floor for decor (so a barrel rests on the ground),
 * or eye height for a shot in flight. The static decor of a map comes from {@link mapSprites}; the game
 * passes its own list each frame for moving/dying entities.
 */
export interface Sprite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tex: string;
  readonly width: number;
  readonly height: number;
  // Optional atlas cell: the texture is a `cols`×`rows` grid and only cell (`col`,`row`) is drawn (an animated
  // directional enemy frame). Omitted → the whole texture is drawn (a plain billboard — barrels, projectiles).
  readonly cols?: number;
  readonly rows?: number;
  readonly col?: number;
  readonly row?: number;
  readonly flash?: number; // 0..1 white hit-flash blend (0 / omitted = normal shading)
}

/**
 * One zone visible through this map's LIVE zone portals: its compiled map plus (optionally) the billboards
 * ALIVE in it this frame, in ITS OWN coordinates — a warm neighbor's enemies/pickups/decor, drawn through
 * the seam windows, z-tested like local sprites. Without `sprites` the neighbor renders geometry only.
 */
export interface ZoneNeighbor {
  readonly map: CompiledMap;
  readonly sprites?: readonly Sprite[];
}

/** The static billboards authored into a map: every thing whose type has a sprite def, resting on its floor. */
export function mapSprites(map: CompiledMap): Sprite[] {
  const sprites: Sprite[] = [];

  for (const thing of map.source.things) {
    const def = SPRITES[thing.type];

    if (def !== undefined) {
      const z = map.source.sectors[locateSubSector(map.root, thing.x, thing.y).sector].floorZ;

      sprites.push({
        x: thing.x,
        y: thing.y,
        z,
        tex: def.tex,
        width: def.width,
        height: def.height,
      });
    }
  }

  return sprites;
}

/** The "missing texture" drawn when a surface names a texture absent from the library. */
const MISSING = missingTexture();

/** A sector whose `ceilTex` is this renders its ceiling as open SKY (a gradient) instead of a textured flat. */
export const SKY = 'SKY';

// A see-through GLASS line renders the back sector through its opening, then `blendGlass` washes this cool
// translucent tint over that opening so it reads as a PANE, not a hole. `out = src*KEEP + TINT` per channel.
const GLASS_ALPHA = 0.22;
const GLASS_KEEP = 1 - GLASS_ALPHA;
const GLASS_TINT_R = (150 * GLASS_ALPHA) | 0; // a light cool blue, pre-multiplied by alpha
const GLASS_TINT_G = (195 * GLASS_ALPHA) | 0;
const GLASS_TINT_B = (225 * GLASS_ALPHA) | 0;

/** The glass-wash parameters, exported for the GPU compute shader (its WGSL transcribes
 *  {@link coolGlassTint} with these exact constants — same keep factor, same pre-multiplied tint). */
export const GLASS_TINT = {
  keep: GLASS_KEEP,
  r: GLASS_TINT_R,
  g: GLASS_TINT_G,
  b: GLASS_TINT_B,
} as const;

/** Wash a packed RGBA pixel with the cool glass tint (keep `GLASS_KEEP` of it + add the pre-multiplied tint) —
 *  used both by `blendGlass` on the clear pane and by `drawSprites` on a sprite seen THROUGH a pane.
 *  (Exported as the f64 reference the GPU parity executor replays.) */
export function coolGlassTint(c: number): number {
  const r = (((c & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_R;
  const g = ((((c >> 8) & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_G;
  const b = ((((c >> 16) & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_B;

  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** Pack an opaque RGB into a little-endian RGBA uint32 for bulk framebuffer fills (all modern browsers). */
function packRgb(c: Rgb): number {
  return ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
}

/** Resolve a texture name against the library, falling back to the magenta MISSING texture. */
function resolve(textures: TextureLibrary, name: string): Texture {
  return textures.get(name) ?? MISSING;
}

/** Walk the tree front-to-back from the camera, visiting each leaf's segs nearest-first. */
function eachSegFrontToBack(child: NodeChild, camera: Camera, visit: (seg: Seg) => void): void {
  if (child.kind === 'leaf') {
    for (const seg of child.subsector.segs) {
      visit(seg);
    }

    return;
  }

  const node = child.node;
  const cameraInFront = signedSide(node.partition, camera.x, camera.y) < 0;

  eachSegFrontToBack(cameraInFront ? node.front : node.back, camera, visit);
  eachSegFrontToBack(cameraInFront ? node.back : node.front, camera, visit);
}

/** Clip a camera-space wall to the near plane (interpolating `u`), or null if fully behind. */
function clipNear(a: WallVert, b: WallVert): readonly [WallVert, WallVert] | null {
  if (a.forward < NEAR && b.forward < NEAR) {
    return null;
  }

  let na = a;
  let nb = b;

  if (na.forward < NEAR) {
    const t = (NEAR - na.forward) / (nb.forward - na.forward);

    na = { forward: NEAR, side: na.side + t * (nb.side - na.side), u: na.u + t * (nb.u - na.u) };
  }
  if (nb.forward < NEAR) {
    const t = (NEAR - nb.forward) / (na.forward - nb.forward);

    nb = { forward: NEAR, side: nb.side + t * (na.side - nb.side), u: nb.u + t * (na.u - nb.u) };
  }

  return [na, nb];
}

/**
 * Paint a vertical wall span in column `x`, rows `[y0,y1]`, sampling `tex` at column `texCol`. Writes one
 * packed RGBA word per pixel (`buf32`) instead of four clamped byte stores — fewer ops, no per-store clamp.
 *
 * Z-tested against `zbuf` (the wall's per-column `forward` depth): a span only writes where it is the
 * NEAREST surface so far. The occlusion window already culls most overdraw, but a far wall seen past a
 * portal can still reach rows a nearer flat already filled (a raised sector's top vs the wall behind it);
 * the z-test is what stops that wall repainting over the floor. One arbiter (the z-buffer) for all surfaces.
 */
function paintWall(
  buf32: Uint32Array,
  zbuf: Float32Array,
  dims: Dims,
  x: number,
  y0: number,
  y1: number,
  tex: Texture,
  u: number, // world distance along the wall at this column → the texture's horizontal coordinate
  zPerRow: number, // forward / focal — world-Z change per screen row
  camZ: number,
  horizon: number,
  shade: number,
  forward: number, // this column's wall distance → z-tested + written to the z-buffer
): void {
  const lo = Math.max(dims.rowStart, y0);
  const hi = Math.min(dims.rowEnd - 1, y1);
  const tw = tex.width;
  const th = tex.height;
  const px = tex.pixels;
  // SQUARE texels: the texture's HEIGHT spans `worldSize` world units, so a 4-tall wall with worldSize 4
  // shows one full panel (no vertical repeat); the same texels/unit drive U so the art keeps its aspect.
  const perUnit = th / (tex.worldSize ?? TEX_WORLD);
  const texCol = (u * perUnit) & (tw - 1); // constant down the column (tw/th are powers of two → & wraps)
  let vRaw = (TEX_ANCHOR - (camZ + (horizon - lo) * zPerRow)) * perUnit;
  const vStep = zPerRow * perUnit; // > 0; vRaw stays positive (anchored above any ceiling)
  let i = lo * dims.width + x;

  for (let y = lo; y <= hi; y++) {
    if (forward < zbuf[i]) {
      const ti = (((vRaw & (th - 1)) * tw + texCol) << 2) | 0;

      buf32[i] =
        0xff000000 | ((px[ti + 2] * shade) << 16) | ((px[ti + 1] * shade) << 8) | (px[ti] * shade);
      zbuf[i] = forward;
    }
    i += dims.width;
    vRaw += vStep;
  }
}

/**
 * Cast a textured floor/ceiling span in column `x`, rows `[y0,y1]`. `rowScale[y]` (= focal/(y−horizon))
 * turns the plane height into the world distance at that row, giving the world point under each pixel.
 *
 * That distance `dist` IS the pixel's camera-forward depth, in the same metric the walls write — so we
 * z-test it against `zbuf`: each pixel keeps the NEAREST flat. This makes adjacent sectors' floors/ceilings
 * (e.g. a raised platform's top vs the room behind it) resolve by depth, not draw order — no z-fighting.
 */
function castFlat(
  buf32: Uint32Array,
  zbuf: Float32Array,
  dims: Dims,
  x: number,
  y0: number,
  y1: number,
  tex: Texture,
  planeZ: number,
  camera: Camera,
  rowScale: Float64Array,
  rayX: number,
  rayY: number,
  horizon: number,
  falloff: number, // distance shade factor per row: shade = clamp(falloff·(y−horizon)) — no per-pixel divide
  light: number,
): void {
  const lo = Math.max(dims.rowStart, y0);
  const hi = Math.min(dims.rowEnd - 1, y1);
  const tw = tex.width;
  const th = tex.height;
  const px = tex.pixels;
  const dz = camera.z - planeZ;
  const inv = 1 / (tex.worldSize ?? TEX_WORLD); // 1 tile per `worldSize` world units (default 1)
  let i = lo * dims.width + x;

  for (let y = lo; y <= hi; y++) {
    const dist = dz * rowScale[y]; // = the floor/ceiling point's camera-forward depth (always > 0 here)

    if (dist < zbuf[i]) {
      // tw/th are powers of two → `& (size−1)` is the texel wrap (correct even for negative world coords).
      const tcx = (((camera.x + dist * rayX) * inv + FLAT_ANCHOR) * tw) & (tw - 1);
      const tcy = (((camera.y + dist * rayY) * inv + FLAT_ANCHOR) * th) & (th - 1);
      const shade = light * Math.max(0.25, Math.min(1, falloff * (y - horizon)));
      const ti = (tcy * tw + tcx) << 2;

      buf32[i] =
        0xff000000 | ((px[ti + 2] * shade) << 16) | ((px[ti + 1] * shade) << 8) | (px[ti] * shade);
      zbuf[i] = dist;
    }
    i += dims.width;
  }
}

/**
 * Fill a {@link SKY} ceiling span in column `x`, rows `[y0,y1]`, with a vertical gradient — deep blue
 * overhead fading to a hazy band at the horizon — only where nothing nearer was drawn (`zbuf` still
 * Infinity). It leaves the z-buffer untouched (the sky is infinitely far), so sprites + nearer flats still
 * paint in front. No texture sampling: an open roof, distance-independent.
 */
function castSky(
  buf32: Uint32Array,
  zbuf: Float32Array,
  dims: Dims,
  x: number,
  y0: number,
  y1: number,
  horizon: number,
): void {
  const lo = Math.max(dims.rowStart, y0);
  const hi = Math.min(dims.rowEnd - 1, y1);
  let i = lo * dims.width + x;

  for (let y = lo; y <= hi; y++) {
    if (zbuf[i] === Infinity) {
      const t = Math.max(0, Math.min(1, y / horizon)); // 0 overhead → 1 at the horizon (horizon is always > 0)
      const r = (40 + 130 * t) | 0;
      const g = (70 + 130 * t) | 0;
      const b = (140 + 95 * t) | 0;

      buf32[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    }
    i += dims.width;
  }
}

/** Up to this many glass surfaces STACK per column (an entrance axis: frontage pane + outer + inner sliding
 *  door + an interior partition). The BSP walk is front-to-back, so layers append in ascending depth; a fifth,
 *  farther surface behind a full column is dropped (invisible anyway behind four tinted panes). (Exported —
 *  the GPU command builder records the same per-column layer cap.) */
export const GLASS_LAYERS = 4;

/** Per-column LAYERED record of the visible glass a frame produced (nearest layer first — the front-to-back
 *  walk guarantees ascending depth), consumed by the deferred {@link blendGlass} pass. Layer `k` of column `x`
 *  lives at index `x * GLASS_LAYERS + k`; `count[x]` is the column's live layer count. (Exported with its
 *  make/reset pair: the GPU command builder records glass through the same structure, then serializes it.) */
export interface GlassPanes {
  readonly count: Uint8Array; // live layers per column (0 = no glass there)
  readonly top: Int32Array; // the CLIPPED (on-screen) span to paint, per layer
  readonly bot: Int32Array;
  readonly vTop: Int32Array; // the UNCLIPPED pane top/bottom (may run off-screen) — the texture's V anchor
  readonly vBot: Int32Array;
  readonly tu: Float32Array; // the layer's texture column (−1 = a plain window → flat tint)
  readonly shade: Float32Array; // per-layer shade for a leaf/pane's opaque texels
  readonly depth: Float32Array; // the layer's wall distance → z-buffered at opaque texels so sprites occlude
  readonly tex: (Texture | null)[]; // per-layer glass image (door leaf / window pane); null = plain window
  readonly name: string[]; // the layer texture's LIBRARY name (the command builder keys GPU ids off it)
}

/** Allocate an empty per-column glass-layer record (see {@link GlassPanes}) — held in the per-context
 *  {@link frameScratch} and REUSED across frames; {@link resetGlass} re-arms it per pass. */
export function makeGlass(width: number): GlassPanes {
  return {
    count: new Uint8Array(width), // live layers per column (0 = no glass)
    top: new Int32Array(width * GLASS_LAYERS), // CLIPPED (on-screen) span to actually paint, per layer
    bot: new Int32Array(width * GLASS_LAYERS),
    vTop: new Int32Array(width * GLASS_LAYERS), // UNCLIPPED pane top/bottom (may be off-screen) → texture-V
    vBot: new Int32Array(width * GLASS_LAYERS), // reference, so the art keeps world scale off-screen up close
    tu: new Float32Array(width * GLASS_LAYERS), // layer texture column (−1 = plain window → flat tint)
    shade: new Float32Array(width * GLASS_LAYERS), // per-layer shade for opaque frame texels
    depth: new Float32Array(width * GLASS_LAYERS), // layer wall distance → z-buffered at opaque texels
    tex: new Array<Texture | null>(width * GLASS_LAYERS).fill(null), // per-layer glass image (null = plain)
    name: new Array<string>(width * GLASS_LAYERS).fill(''), // per-layer texture name (GPU id lookup)
  };
}

/** Re-arm a reused glass record for a fresh wall pass: zeroing the per-column layer COUNTS is the whole
 *  reset — every other slot (spans, depths, textures…) is only ever read below `count[x]`, so stale
 *  entries from the previous frame are unreachable. O(width), instead of refilling eight arrays. */
export function resetGlass(panes: GlassPanes): GlassPanes {
  panes.count.fill(0);

  return panes;
}

/**
 * Per-column record of the LIVE zone-portal windows the primary wall pass hit: `seam[x]` indexes `seams`
 * (−1 = none) and `top`/`bot` is the column's open span into the neighbor. A seam entry is one zonePortal
 * LINEDEF whose neighbor map was provided — however many segs the BSP carved it into — with its zone record
 * (map + this frame's sprites) and world translation resolved once; `columns` counts its recorded columns
 * (0 → its pass is skipped). (Exported with its make/reset pair — the GPU command builder records portal
 * windows through the same structure, then serializes them.)
 */
export interface PortalSpans {
  readonly seam: Int16Array;
  readonly top: Int32Array;
  readonly bot: Int32Array;
  readonly seams: {
    readonly linedef: number;
    readonly neighbor: ZoneNeighbor;
    readonly dx: number;
    readonly dy: number;
    columns: number;
  }[];
}

/** Allocate an empty zone-portal record (see {@link PortalSpans}) — held in the per-context
 *  {@link frameScratch} and REUSED across frames; {@link resetPortals} re-arms it per frame. */
export function makePortals(width: number): PortalSpans {
  return {
    seam: new Int16Array(width).fill(-1),
    top: new Int32Array(width),
    bot: new Int32Array(width),
    seams: [],
  };
}

/** Re-arm a reused zone-portal record: close every column (−1) and drop the resolved seams. `top`/`bot`
 *  are only read where `seam[x]` points at a seam registered THIS frame, so they need no refill. */
export function resetPortals(spans: PortalSpans): PortalSpans {
  spans.seam.fill(-1);
  spans.seams.length = 0;

  return spans;
}

/**
 * The per-context render scratch: every buffer {@link renderFrame} needs per call, allocated ONCE and
 * REUSED frame after frame (resized only when the render resolution changes). A JS context — the main
 * thread, or one render worker — is single-threaded and never nests renderFrame calls, so reuse is safe;
 * without it, each frame allocated ~a dozen arrays per pass (× workers × fps = constant GC churn, the
 * intermittent frame-time spikes). `renderFrame` stays externally pure: its OUTPUT depends only on its
 * inputs — the scratch is re-armed on use ({@link resetGlass} / {@link resetPortals} / cheap fills), and
 * the primary and neighbor passes each own a dedicated glass/clip slot (a neighbor pass runs while the
 * primary records stay live; the sequential seam loop reuses the one neighbor slot safely).
 */
interface FrameScratch {
  width: number;
  height: number;
  rowScale: Float64Array; // per-row world distance scale — refilled each frame (horizon moves with pitch)
  topClip: Int16Array; // the primary pass's per-column occlusion window
  botClip: Int16Array;
  neighborTop: Int16Array; // a neighbor pass's clip windows (fully rewritten per seam)
  neighborBot: Int16Array;
  glass: GlassPanes; // the primary pass's glass record (live until the frame's final sprite pass)
  neighborGlass: GlassPanes; // the neighbor passes' glass record (one at a time — seams render sequentially)
  portals: PortalSpans; // the primary pass's zone-portal record
}

let scratch: FrameScratch | null = null;

/** The context's {@link FrameScratch}, (re)allocated only when the render resolution changes. */
function frameScratch(width: number, height: number): FrameScratch {
  if (scratch === null || scratch.width !== width) {
    scratch = {
      width,
      height: -1,
      rowScale: new Float64Array(0),
      topClip: new Int16Array(width),
      botClip: new Int16Array(width),
      neighborTop: new Int16Array(width),
      neighborBot: new Int16Array(width),
      glass: makeGlass(width),
      neighborGlass: makeGlass(width),
      portals: makePortals(width),
    };
  }
  if (scratch.height !== height) {
    scratch.height = height;
    scratch.rowScale = new Float64Array(height);
  }

  return scratch;
}

/** The zone-portal wiring of a PRIMARY wall pass: the per-column span record plus the available neighbor
 *  zones by key. `null` = recording off — no neighbors were provided, or the pass IS a neighbor render
 *  (the depth-1 cap: a portal seen through a portal paints its solid middle texture instead). */
export interface PortalPass {
  readonly spans: PortalSpans;
  readonly neighbors: ReadonlyMap<string, ZoneNeighbor>;
}

/** Find (or register) the seam slot for zone-portal `linedef`, or −1 when `neighbors` carries no zone for
 *  its key — the seam then paints its solid middle texture, the graceful fallback. */
function registerSeam(
  spans: PortalSpans,
  linedef: number,
  portal: ZonePortalDef,
  neighbors: ReadonlyMap<string, ZoneNeighbor>,
): number {
  for (let i = 0; i < spans.seams.length; i++) {
    if (spans.seams[i].linedef === linedef) {
      return i; // already resolved by an earlier seg of the same (BSP-split) linedef
    }
  }
  const neighbor = neighbors.get(portal.zone);

  if (neighbor === undefined) {
    return -1;
  }
  spans.seams.push({ linedef, neighbor, dx: portal.dx, dy: portal.dy, columns: 0 });

  return spans.seams.length - 1;
}

/**
 * Deferred GLASS pass, run AFTER the wall pass drew the back sector through each opening (the single
 * front-to-back pass can't blend over content it hasn't drawn yet). Each column's recorded layers blend
 * FARTHEST → NEAREST, so a nearer pane tints (or frames over) what already shows through a farther one.
 * A PLAIN window layer just gets a cool translucent tint. A TEXTURED layer (sliding-door leaf / window pane)
 * samples its texture per pixel: an opaque texel stamps the aluminium frame / mullion; a clear (alpha) texel
 * is see-through glass and gets the same tint.
 */
function blendGlass(buf32: Uint32Array, zbuf: Float32Array, dims: Dims, panes: GlassPanes): void {
  const { width, rowStart, rowEnd } = dims;
  const { count, top, bot, vTop, vBot, tu, shade, depth, tex } = panes;

  for (let x = 0; x < width; x++) {
    for (let k = count[x] - 1; k >= 0; k--) {
      const l = x * GLASS_LAYERS + k; // this column's layers, farthest (k = count-1) back to nearest (k = 0)
      const y0 = Math.max(rowStart, top[l]);
      const y1 = Math.min(rowEnd - 1, bot[l]);

      if (y1 < y0) {
        continue;
      }
      const img = tex[l];
      const layerTex = img !== null && tu[l] >= 0 ? img.pixels : null; // sampled layer; null = plain window
      const tw = img?.width ?? 0;
      const th = img?.height ?? 0;
      const col = layerTex !== null ? Math.min(tw - 1, tu[l] | 0) : 0;
      const vt = vTop[l]; // anchor the texture V to the FULL pane extent (may be off-screen), not the clipped
      const vh = vBot[l] - vt; // span, so the art keeps world scale + its top/bottom run off-screen up close
      const sh = shade[l];
      let i = y0 * width + x;

      for (let y = y0; y <= y1; y++) {
        if (zbuf[i] < depth[l]) {
          i += width;
          continue; // a NEARER opaque surface occupies this pixel (e.g. a counter in front of the pane) — the
          // glass is behind it, so neither its tint nor its frame may paint over it
        }
        let framed = false;
        let cr = 0;
        let cg = 0;
        let cb = 0;

        if (layerTex !== null) {
          const v = Math.min(th - 1, Math.max(0, (((y - vt) / vh) * th) | 0));
          const ti = (v * tw + col) << 2;

          if (layerTex[ti + 3] >= 128) {
            framed = true; // an opaque aluminium frame / mullion / handle texel
            cr = (layerTex[ti] * sh) | 0;
            cg = (layerTex[ti + 1] * sh) | 0;
            cb = (layerTex[ti + 2] * sh) | 0;
          }
        }
        if (framed) {
          buf32[i] = (0xff000000 | (cb << 16) | (cg << 8) | cr) >>> 0;
          zbuf[i] = depth[l]; // the frame is opaque at the layer's depth → sprites behind it are now occluded
        } else {
          buf32[i] = coolGlassTint(buf32[i]); // clear glass (plain window, or an alpha texel) → cool tint
        }
        i += width;
      }
    }
  }
}

/** Restrict a NEIGHBOR pass's sprites to seam `index`'s recorded portal windows: a pixel may only paint
 *  where `seam[x]` is this seam and the row falls inside its `[top[x], bot[x]]` span — outside the window
 *  the z-buffer holds LOCAL depths a translated neighbor sprite must never compete with. */
interface SpriteWindow {
  readonly seam: Int16Array;
  readonly top: Int32Array;
  readonly bot: Int32Array;
  readonly index: number;
}

/**
 * A billboard PROJECTED for one frame: the screen-space quad + the sampling/shading parameters the paint
 * loop needs — everything {@link drawSprites} derives per sprite before its pixel loops. Exported as the
 * seam between the projection (the smart, cheap part — shared) and the per-pixel work: the CPU paints the
 * quads immediately; the GPU command builder serializes the SAME quads into sprite records a compute
 * shader executes (the WalkSink split, for sprites).
 */
export interface SpriteQuad {
  readonly tex: Texture;
  readonly name: string; // the texture's library name (the command builder keys GPU ids off it)
  readonly forward: number; // the sprite's camera depth — z-tested per pixel
  readonly left: number; // screen quad, inclusive (may run off-screen — painters clamp)
  readonly right: number;
  readonly yTop: number;
  readonly yBottom: number;
  readonly u0: number; // the atlas cell: origin + size in texels (the whole texture for a plain billboard)
  readonly v0: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly shade: number; // sector light × distance falloff × (1 + hit-flash) — channels clamp at 255
}

/**
 * Project a frame's billboards to screen-space {@link SpriteQuad}s: cull behind the near plane, sort
 * far-to-near (nearer sprites overdraw), and resolve each sprite's texture/cell/shade. Pure — shared by
 * the CPU painter ({@link drawSprites}) and the GPU command builder, so both derive identical quads.
 */
export function projectSprites(
  sprites: readonly Sprite[],
  map: CompiledMap,
  camera: Camera,
  width: number,
  focal: number,
  horizon: number,
  textures: TextureLibrary,
): SpriteQuad[] {
  const visible: { spr: Sprite; cam: CamPoint }[] = [];

  for (const spr of sprites) {
    const cam = toCamera(camera, spr);

    if (cam.forward <= NEAR) {
      continue;
    }
    visible.push({ spr, cam });
  }
  visible.sort((a, b) => b.cam.forward - a.cam.forward); // far first → nearer sprites overdraw

  return visible.map((s) => {
    const invF = 1 / s.cam.forward;
    const centerX = projectColumn(s.cam, width, focal);
    const sector = map.source.sectors[locateSubSector(map.root, s.spr.x, s.spr.y).sector];
    const yBottom = Math.round(horizon - (s.spr.z - camera.z) * focal * invF);
    const yTop = Math.round(horizon - (s.spr.z + s.spr.height - camera.z) * focal * invF);
    const halfW = s.spr.width * 0.5 * focal * invF;
    const tex = resolve(textures, s.spr.tex);
    // The cell to sample: a whole-texture billboard (cols=rows=1) or one cell of a `cols`×`rows` atlas.
    const cellW = (tex.width / (s.spr.cols ?? 1)) | 0;
    const cellH = (tex.height / (s.spr.rows ?? 1)) | 0;
    // Additive hit-flash: brighten the sprite's OWN colours toward white (×(1+flash), clipped per channel) —
    // mirrors the grid's `lighter` re-blit, not a flat white wash.
    const flash = Math.max(0, Math.min(1, s.spr.flash ?? 0));

    return {
      tex,
      name: s.spr.tex,
      forward: s.cam.forward,
      left: Math.round(centerX - halfW),
      right: Math.round(centerX + halfW),
      yTop,
      yBottom,
      u0: (s.spr.col ?? 0) * cellW,
      v0: (s.spr.row ?? 0) * cellH,
      cellW,
      cellH,
      shade: (sector.light / 255) * Math.max(0.25, Math.min(1, 6 / s.cam.forward)) * (1 + flash),
    };
  });
}

/**
 * Draw billboard sprites (things) after the walls: face-camera quads (via {@link projectSprites} — sorted
 * far-to-near), depth-tested PER PIXEL against the wall z-buffer (so steps/canopies occlude correctly),
 * with per-texel alpha. A NEIGHBOR pass passes its seam's {@link SpriteWindow} so its sprites stay inside
 * the portal opening.
 */
function drawSprites(
  buf32: Uint32Array,
  zbuf: Float32Array,
  dims: Dims,
  sprites: readonly Sprite[],
  map: CompiledMap,
  camera: Camera,
  focal: number,
  horizon: number,
  textures: TextureLibrary,
  glass: GlassPanes | null, // so a sprite seen THROUGH a pane gets the same cool tint as the wall behind it
  window: SpriteWindow | null = null,
): void {
  const { width } = dims;

  for (const q of projectSprites(sprites, map, camera, width, focal, horizon, textures)) {
    const { tex, forward, left, right, yTop, yBottom, u0, v0, cellW, cellH, shade } = q;
    const tw = tex.width;
    const px = tex.pixels;
    const colSpan = right - left + 1;
    const rowSpan = yBottom - yTop + 1;
    const yLo = Math.max(dims.rowStart, yTop);
    const yHi = Math.min(dims.rowEnd - 1, yBottom);

    for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x++) {
      let colLo = yLo;
      let colHi = yHi;

      if (window !== null) {
        if (window.seam[x] !== window.index) {
          continue; // this column shows no opening of the seam — the sprite must not leak past it
        }
        colLo = Math.max(colLo, window.top[x]);
        colHi = Math.min(colHi, window.bot[x]);
      }
      const texCol = u0 + ((((x - left) / colSpan) * cellW) | 0);
      let i = colLo * width + x;

      for (let y = colLo; y <= colHi; y++) {
        const ti = ((v0 + ((((y - yTop) / rowSpan) * cellH) | 0)) * tw + texCol) << 2;

        // Per-pixel depth + alpha test: skip pixels behind a wall/step or transparent in the sprite.
        if (forward < zbuf[i] && px[ti + 3] !== 0) {
          buf32[i] =
            0xff000000 |
            (Math.min(255, (px[ti + 2] * shade) | 0) << 16) |
            (Math.min(255, (px[ti + 1] * shade) | 0) << 8) |
            Math.min(255, (px[ti] * shade) | 0);

          // Seen THROUGH glass (behind a layer, inside its recorded span) → wash the same cool tint over the
          // sprite, ONCE PER PANE in front of it (an enemy behind two panes tints twice, like the wall behind
          // it). Layers are nearest-first, so stop at the first layer at/beyond the sprite's own depth.
          if (glass !== null) {
            for (let k = 0; k < glass.count[x]; k++) {
              const l = x * GLASS_LAYERS + k;

              if (forward <= glass.depth[l]) {
                break; // this layer (and all farther ones) sits behind the sprite
              }
              if (y >= glass.top[l] && y <= glass.bot[l]) {
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

/**
 * Where a wall pass SENDS the per-column spans it computes — the seam between the walk (BSP order,
 * clipping, projection: the smart, cheap part) and the per-pixel work. The CPU renderer plugs in a sink
 * that paints immediately ({@link castSky} / {@link castFlat} / {@link paintWall}); the GPU command
 * builder plugs in one that RECORDS the same spans into a command buffer a compute shader executes.
 * Each span carries the resolved texture AND its library name (a paint sink samples the texture; a
 * command sink maps the name to a GPU texture id). Ranges may be empty (`y1 < y0`) — sinks skip those.
 */
export interface WalkSink {
  /** An open-SKY ceiling span (gradient — no texture, infinitely far). */
  sky(x: number, y0: number, y1: number): void;
  /** A floor/ceiling span of the near sector: per-row perspective cast off the plane height. */
  flat(
    x: number,
    y0: number,
    y1: number,
    tex: Texture,
    name: string,
    planeZ: number,
    rayX: number,
    rayY: number,
    falloff: number,
    light: number,
  ): void;
  /** A vertical wall band (solid middle, or a portal's upper/lower): constant depth down the column. */
  wall(
    x: number,
    y0: number,
    y1: number,
    tex: Texture,
    name: string,
    u: number,
    zPerRow: number,
    shade: number,
    forward: number,
  ): void;
}

/**
 * Everything one wall pass over one map needs. The PRIMARY pass owns the frame setup and records glass +
 * zone-portal spans; a NEIGHBOR pass (see {@link renderNeighbors}) reuses the same framebuffer, z-buffer
 * and projection, with the clip windows pre-loaded from the recorded portal columns and `portals: null`
 * (the recursion cap). Painting goes through `sink` — the walk itself never touches a framebuffer.
 */
export interface WallPassCtx {
  readonly map: CompiledMap;
  readonly camera: Camera;
  readonly textures: TextureLibrary;
  readonly dims: Dims;
  readonly focal: number;
  readonly horizon: number;
  readonly topClip: Int16Array;
  readonly botClip: Int16Array;
  readonly glass: GlassPanes | null;
  readonly slides: readonly number[] | undefined;
  readonly portals: PortalPass | null;
  readonly sink: WalkSink;
}

/** One front-to-back wall walk: per column, the near sector's flats + the wall (solid, portal bands, a
 *  recorded glass layer, or a recorded zone-portal window), narrowing the per-column clip windows. All
 *  visible spans go to `ctx.sink` — paint (CPU) or record (GPU command build). */
export function wallPass(ctx: WallPassCtx): void {
  const { map, camera, dims, focal, horizon, sink } = ctx;
  const { textures, topClip, botClip, glass, slides, portals } = ctx;
  const { width } = dims;
  const cosA = Math.cos(camera.angle);
  const sinA = Math.sin(camera.angle);

  eachSegFrontToBack(map.root, camera, (seg) => {
    const line = map.source.linedefs[seg.linedef];

    // Back-face cull: only the front (right) side of a wall is visible.
    if (
      signedSide(
        { x: seg.v1.x, y: seg.v1.y, dx: seg.v2.x - seg.v1.x, dy: seg.v2.y - seg.v1.y },
        camera.x,
        camera.y,
      ) >= 0
    ) {
      return;
    }

    // Texture U = distance along the linedef (continuous across splits → no seams).
    const lineStart = map.source.vertices[line.v1];
    const ca = toCamera(camera, seg.v1);
    const cb = toCamera(camera, seg.v2);
    const clipped = clipNear(
      { ...ca, u: Math.hypot(seg.v1.x - lineStart.x, seg.v1.y - lineStart.y) },
      { ...cb, u: Math.hypot(seg.v2.x - lineStart.x, seg.v2.y - lineStart.y) },
    );

    if (clipped === null) {
      return;
    }

    const [pa, pb] = clipped;
    const xa = projectColumn(pa, width, focal);
    const xb = projectColumn(pb, width, focal);
    const left = Math.max(0, Math.ceil(xa));
    const right = Math.min(width - 1, Math.floor(xb));

    if (right < left) {
      return;
    }

    const near = map.source.sectors[seg.sector];
    const light = near.light / 255;
    // Per-row distance-shade factors for this sector's flats (replaces a per-pixel 6/dist divide).
    const ceilFalloff = 6 / ((camera.z - near.ceilZ) * focal);
    const floorFalloff = 6 / ((camera.z - near.floorZ) * focal);
    const neighbour: Sector | null =
      line.back !== null
        ? map.source.sectors[seg.side === 0 ? line.back.sector : line.front.sector]
        : null;
    // Resolve each surface's texture by name (the sidedef facing the camera; this sector's flats).
    const side = line.back !== null && seg.side === 1 ? line.back : line.front;
    const ceilImg = resolve(textures, near.ceilTex);
    const floorImg = resolve(textures, near.floorTex);
    const midImg = resolve(textures, side.middleTex);
    const upperImg = resolve(textures, side.upperTex);
    const lowerImg = resolve(textures, side.lowerTex);
    const invFa = 1 / pa.forward;
    const invFb = 1 / pb.forward;
    const uOverZa = pa.u * invFa;
    const uOverZb = pb.u * invFb;
    const span = xb - xa;
    // A LIVE ZONE PORTAL (one-sided only): resolve the seg's seam slot once. `seamSpans` stays null when
    // recording is off (no neighbors provided / inside a neighbor pass) or the zone has no map — the seam
    // then paints its solid middle texture below, exactly like a plain wall.
    let seam = -1;
    let seamSpans: PortalSpans | null = null;

    if (line.zonePortal !== undefined && portals !== null) {
      seam = registerSeam(portals.spans, seg.linedef, line.zonePortal, portals.neighbors);
      seamSpans = seam >= 0 ? portals.spans : null;
    }

    for (let x = left; x <= right; x++) {
      const top = topClip[x];
      const bot = botClip[x];

      if (top > bot) {
        continue;
      } // column already closed

      const t = (x - xa) / span;
      const invF = invFa + t * (invFb - invFa);
      const forward = 1 / invF;
      const u = (uOverZa + t * (uOverZb - uOverZa)) / invF; // perspective-correct U along the wall
      const zPerRow = forward / focal;
      const shade = light * Math.max(0.25, Math.min(1, 6 / forward));
      const rayX = cosA - ((width / 2 - x) / focal) * sinA;
      const rayY = sinA + ((width / 2 - x) / focal) * cosA;
      const yCeil = Math.round(horizon - (near.ceilZ - camera.z) * focal * invF);
      const yFloor = Math.round(horizon - (near.floorZ - camera.z) * focal * invF);

      // Ceiling above + floor below are this sector's, regardless of wall vs portal. An open SKY ceiling
      // renders a gradient instead of a textured flat.
      if (near.ceilTex === SKY) {
        sink.sky(x, top, Math.min(bot, yCeil - 1));
      } else {
        sink.flat(
          x,
          top,
          Math.min(bot, yCeil - 1),
          ceilImg,
          near.ceilTex,
          near.ceilZ,
          rayX,
          rayY,
          ceilFalloff,
          light,
        );
      }
      sink.flat(
        x,
        Math.max(top, yFloor + 1),
        bot,
        floorImg,
        near.floorTex,
        near.floorZ,
        rayX,
        rayY,
        floorFalloff,
        light,
      );

      if (neighbour === null) {
        if (seamSpans !== null) {
          // ZONE PORTAL: record the column's open window into the neighbor instead of painting the middle
          // (rows clamped into Int16 range — the neighbor pass reloads them into the clip arrays). The
          // z-buffer stays untouched here: the neighbor pass writes its own true depths into the window.
          seamSpans.seam[x] = seam;
          seamSpans.top[x] = Math.max(top, Math.min(dims.height, yCeil));
          seamSpans.bot[x] = Math.min(bot, Math.max(-1, yFloor));
          seamSpans.seams[seam].columns++;
        } else {
          sink.wall(
            x,
            Math.max(top, yCeil),
            Math.min(bot, yFloor),
            midImg,
            side.middleTex,
            u,
            zPerRow,
            shade,
            forward,
          );
        }
        topClip[x] = 1;
        botClip[x] = 0;
        continue;
      }

      const yNeighCeil = Math.round(horizon - (neighbour.ceilZ - camera.z) * focal * invF);
      const yNeighFloor = Math.round(horizon - (neighbour.floorZ - camera.z) * focal * invF);

      // GLASS: record this pane's see-through opening (between the neighbour's ceiling and floor, clipped to
      // the column's open window) so `blendGlass` can wash a tint over it once the back sector is drawn. A
      // SLIDING door is a DOUBLE door — two panels meeting at the centre, each retracting to its own side —
      // so only the two still-covered edge bands are recorded; the clear gap grows from the middle outward.
      if (line.glass && glass) {
        let covered = line.sliding !== true; // a plain window always records; a sliding leaf only where covered
        let leafU = -1; // the door-leaf texture column for this covered pixel (−1 = plain window)

        if (line.sliding) {
          const v2 = map.source.vertices[line.v2];
          const lineLen = Math.hypot(v2.x - lineStart.x, v2.y - lineStart.y);
          const halfClosed = lineLen / 2;
          const open = slides?.[seg.linedef] ?? 0;
          const half = (1 - open) * halfClosed; // each leaf's remaining covered width

          // The texture SLIDES with the leaf (offset by `open × width`): the leaf's outer edge disappears into
          // the wall pocket first, so the handle keeps its size and translates — it does NOT stretch/clip in place.
          if (u <= half) {
            leafU = (u / halfClosed + open) * midImg.width; // left leaf, retracting toward the pocket at u=0
            covered = true;
          } else if (u >= lineLen - half) {
            leafU = ((lineLen - u) / halfClosed + open) * midImg.width; // right leaf, mirrored
            covered = true;
          }
          // NB `<=` / `>=` (not `<` / `>`): when shut, half === lineLen/2, so the two leaves must MEET at the
          // exact centre seam — a strict compare leaves that one column uncovered → a see-through hole that
          // slides across the door as you strafe.
        } else if (line.pane === true) {
          const v2 = map.source.vertices[line.v2];
          const lineLen = Math.hypot(v2.x - lineStart.x, v2.y - lineStart.y);

          leafU = (u / lineLen) * midImg.width; // a fixed textured pane: the glass image maps once across the window
        }
        // The pane's TRUE opening is the INTERSECTION of both sectors (capped by the NEAR ceiling/floor too),
        // not the neighbour's raw extent — otherwise a door between a low room and a tall one maps its leaf to
        // the tall side's height when viewed from the low side (handles bigger from behind than from the front).
        const openTop = Math.max(yCeil, yNeighCeil);
        const openBot = Math.min(yFloor, yNeighFloor);

        // APPEND this surface as the column's next glass layer: the walk is front-to-back, so layers arrive
        // nearest-first (an entrance axis stacks frontage pane + two sliding doors + a partition). A surface
        // beyond a full column is dropped — it sits behind GLASS_LAYERS tinted panes and reads invisible.
        if (covered && glass.count[x] < GLASS_LAYERS) {
          const l = x * GLASS_LAYERS + glass.count[x];

          glass.count[x]++;
          glass.depth[l] = forward;
          glass.top[l] = Math.max(top, openTop);
          glass.bot[l] = Math.min(bot, openBot);
          glass.tu[l] = leafU;
          glass.vTop[l] = openTop; // the pane's TRUE extent (unclipped by the screen) — the art anchors here,
          glass.vBot[l] = openBot; // identical from either side, and keeps world scale / runs off-screen up close
          glass.shade[l] = shade;
          glass.tex[l] = leafU >= 0 ? midImg : null; // this layer's glass image (null = plain flat-tint window)
          glass.name[l] = side.middleTex; // its library name — the GPU command builder keys texel-pool ids off it
        }
      }

      if (yNeighCeil > yCeil) {
        sink.wall(
          x,
          Math.max(top, yCeil),
          Math.min(bot, yNeighCeil - 1),
          upperImg,
          side.upperTex,
          u,
          zPerRow,
          shade,
          forward,
        );
      }
      if (yNeighFloor < yFloor) {
        sink.wall(
          x,
          Math.max(top, yNeighFloor + 1),
          Math.min(bot, yFloor),
          lowerImg,
          side.lowerTex,
          u,
          zPerRow,
          shade * 0.85,
          forward,
        );
      }

      topClip[x] = Math.max(top, yNeighCeil);
      botClip[x] = Math.min(bot, yNeighFloor);
    }
  });
}

/** The CPU paint sink: routes each walked span straight to the software painters over one framebuffer —
 *  the immediate-mode twin of the GPU command builder's recording sink. */
function paintSink(
  buf32: Uint32Array,
  zbuf: Float32Array,
  dims: Dims,
  camera: Camera,
  rowScale: Float64Array,
  horizon: number,
): WalkSink {
  return {
    sky: (x, y0, y1): void => castSky(buf32, zbuf, dims, x, y0, y1, horizon),
    flat: (x, y0, y1, tex, _name, planeZ, rayX, rayY, falloff, light): void =>
      castFlat(
        buf32,
        zbuf,
        dims,
        x,
        y0,
        y1,
        tex,
        planeZ,
        camera,
        rowScale,
        rayX,
        rayY,
        horizon,
        falloff,
        light,
      ),
    wall: (x, y0, y1, tex, _name, u, zPerRow, shade, forward): void =>
      paintWall(buf32, zbuf, dims, x, y0, y1, tex, u, zPerRow, camera.z, horizon, shade, forward),
  };
}

/**
 * The NEIGHBOR passes: for each zone-portal seam the primary walk recorded, re-walk that zone's BSP with
 * the camera TRANSLATED into its coordinate space, restricted to the seam's recorded columns/windows, into
 * the same framebuffer + z-buffer. A pure translation preserves distances, so the depths written are the
 * true camera-forward depths — nearer local geometry already excluded the windows, and sprites drawn later
 * depth-test correctly against neighbor pixels. Each neighbor's own glass blends INSIDE its pass, before
 * the (nearer) primary glass — deferred ordering stays farthest-first overall.
 *
 * Depth cap = 1: the neighbor pass runs with `portals: null`, so a zone portal seen through a zone portal
 * paints its solid middle texture. A neighbor's SPRITES (a warm zone's live enemies/pickups, supplied on
 * its {@link ZoneNeighbor}) draw after its glass blend, clipped to the seam's recorded windows and z-tested
 * like local sprites (translation preserves depth). Its sliding doors still render shut (`slides` unknown
 * across zones).
 */
function renderNeighbors(
  spans: PortalSpans,
  camera: Camera,
  textures: TextureLibrary,
  buf32: Uint32Array,
  zbuf: Float32Array,
  dims: Dims,
  focal: number,
  horizon: number,
  rowScale: Float64Array,
): void {
  const { width } = dims;
  const scr = frameScratch(width, dims.height);
  const topClip = scr.neighborTop; // fully rewritten below for each seam — no reset needed
  const botClip = scr.neighborBot;

  for (let s = 0; s < spans.seams.length; s++) {
    const seam = spans.seams[s];

    if (seam.columns === 0) {
      continue; // the seam was visited but every column was already occluded — nothing to fill
    }
    // Open exactly this seam's recorded windows; every other column stays closed (top 1 > bot 0).
    for (let x = 0; x < width; x++) {
      const mine = spans.seam[x] === s;

      topClip[x] = mine ? spans.top[x] : 1;
      botClip[x] = mine ? spans.bot[x] : 0;
    }
    // The neighbor's world is offset by (dx,dy) relative to ours, so its view is OUR camera translated the
    // other way (angle/z/pitch carry over — translation only, no rotation).
    const ncam: Camera = { ...camera, x: camera.x - seam.dx, y: camera.y - seam.dy };
    const map = seam.neighbor.map;
    const glass = map.source.linedefs.some((l) => l.glass === true)
      ? resetGlass(scr.neighborGlass)
      : null;

    wallPass({
      map,
      camera: ncam,
      textures,
      dims,
      focal,
      horizon,
      topClip,
      botClip,
      glass,
      slides: undefined,
      portals: null,
      sink: paintSink(buf32, zbuf, dims, ncam, rowScale, horizon),
    });
    if (glass !== null) {
      blendGlass(buf32, zbuf, dims, glass); // the neighbor's own panes, farther than any primary glass
    }
    // The neighbor's LIVE billboards (a warm zone's enemies/pickups/decor, in ITS coordinates): z-tested
    // against the window's true depths, tinted by the neighbor's own panes, and CLIPPED to this seam's
    // recorded windows — outside them the z-buffer holds local depths a translated sprite must not fight.
    const sprites = seam.neighbor.sprites;

    if (sprites !== undefined && sprites.length > 0) {
      drawSprites(buf32, zbuf, dims, sprites, map, ncam, focal, horizon, textures, glass, {
        seam: spans.seam,
        top: spans.top,
        bot: spans.bot,
        index: s,
      });
    }
  }
}

/**
 * Render one frame of the compiled map from `camera`, resolving each surface's texture by name. Pass
 * `target` (e.g. an `ImageData.data`) to render in place — avoids an 8 MB allocation + copy per frame.
 *
 * `rowStart`/`rowEnd` restrict the work to a horizontal band `[rowStart, rowEnd)` — geometry is still
 * walked in full (cheap), but every pixel write clamps to the band. Many workers each render their own
 * band into ONE shared framebuffer/z-buffer; default `[0, height)` is the single-threaded whole frame.
 *
 * `neighbors` (zone key → {@link ZoneNeighbor}: its compiled map + optional live sprites) lights up the
 * map's LIVE zone portals: without it — or for a zone key it lacks — a portal seam just paints its solid
 * middle texture.
 *
 * Internal working buffers live in a REUSED per-context scratch ({@link FrameScratch}) instead of being
 * reallocated per call; the function stays externally PURE — the returned pixels depend only on the
 * arguments, and two identical calls produce identical output (the scratch is re-armed on entry).
 */
export function renderFrame(
  map: CompiledMap,
  camera: Camera,
  config: RenderConfig,
  textures: TextureLibrary,
  target?: Uint8ClampedArray,
  zbuffer?: Float32Array,
  rowStart = 0,
  rowEnd = config.height,
  sprites?: readonly Sprite[],
  slides?: readonly number[], // per-linedef sliding-door openness (0 shut … 1 fully retracted); absent = shut
  neighbors?: ReadonlyMap<string, ZoneNeighbor>, // zone-portal neighbor zones by key; absent = seams solid
): Uint8ClampedArray {
  const { width, height, fov } = config;
  const focal = focalFor(width, fov);
  const buf = target ?? new Uint8ClampedArray(width * height * 4);
  const buf32 = new Uint32Array(buf.buffer); // a 32-bit view for bulk pixel fills
  const zbuf = zbuffer ?? new Float32Array(width * height); // per-pixel depth → flat/sprite occlusion

  zbuf.fill(Infinity, rowStart * width, rowEnd * width);
  // Pitch is a y-shear: shift the horizon up/down. It may leave the screen on a steep look (a sheared frustum
  // is still a valid projection — flats/walls/sprites all re-project off this horizon), so nothing here may
  // assume it sits in [0, height).
  const horizon = (height >> 1) + Math.round((camera.pitch ?? 0) * (height >> 1));
  const dims = { width, height, rowStart, rowEnd };

  // Background fallback for columns no wall reaches (e.g. viewed from outside); flats overdraw it in-room.
  // `skyEnd` is the ceiling/floor split row, CLAMPED into the band: a horizon off the top fills all-floor, off
  // the bottom all-ceiling. (Unclamped, a negative end makes `TypedArray.fill` wrap to `length + end` and paint
  // garbage bands — the look-down glitch.)
  const bandLo = rowStart * width;
  const bandHi = rowEnd * width;
  const skyEnd = Math.max(bandLo, Math.min(bandHi, horizon * width));

  buf32.fill(packRgb(BG_CEILING), bandLo, skyEnd);
  buf32.fill(packRgb(BG_FLOOR), skyEnd, bandHi);

  // Per-frame buffers come from the REUSED per-context scratch (see {@link FrameScratch}) — refilled or
  // re-armed here, never reallocated, so a 120fps × N-worker session stops churning the GC.
  const scr = frameScratch(width, height);
  // Per-row world distance scale (focal / (y − horizon)); the horizon row is unused (gaps exclude it).
  const rowScale = scr.rowScale;

  for (let y = 0; y < height; y++) {
    rowScale[y] = focal / (y - horizon);
  }

  const topClip = scr.topClip.fill(0);
  const botClip = scr.botClip.fill(height - 1);

  // A see-through GLASS line records its opening span per column here during the wall pass (LAYERED — up to
  // GLASS_LAYERS stacked surfaces per column, appended in the walk's front-to-back = ascending-depth order);
  // `blendGlass` then paints them farthest-first (deferred — the back sector must be drawn through the opening
  // first). Only re-armed when the map has glass, so glass-free levels pay nothing per frame.
  const glass: GlassPanes | null = map.source.linedefs.some((l) => l.glass === true)
    ? resetGlass(scr.glass)
    : null;
  // Zone-portal recording — only when neighbor maps were provided AND the map has portal seams.
  const portals: PortalPass | null =
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
    sink: paintSink(buf32, zbuf, dims, camera, rowScale, horizon),
  });

  // NEIGHBOR passes AFTER the local walk (the recorded windows + z-buffer are final) and BEFORE the local
  // glass blend — a local pane standing in front of a seam must tint what the seam shows.
  if (portals !== null && portals.spans.seams.length > 0) {
    renderNeighbors(portals.spans, camera, textures, buf32, zbuf, dims, focal, horizon, rowScale);
  }

  // Deferred glass tint over each recorded pane (after the walls drew the back through it, before sprites so a
  // sprite in front of the pane still occludes it).
  if (glass) {
    blendGlass(buf32, zbuf, dims, glass);
  }

  drawSprites(
    buf32,
    zbuf,
    dims,
    sprites ?? mapSprites(map),
    map,
    camera,
    focal,
    horizon,
    textures,
    glass,
  );

  return buf;
}
