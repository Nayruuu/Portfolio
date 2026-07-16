import { focalFor, projectColumn, toCamera, type Camera, type CamPoint } from './camera';
import { locateSubSector, signedSide } from './node-builder';
import { missingTexture, TEX_WORLD, type Texture, type TextureLibrary } from './texture';
import type { CompiledMap, NodeChild, Sector, Seg, ThingType, ZonePortalDef } from './types';

// Walks the BSP front-to-back and per column draws ceiling / wall / floor (sampled + distance-shaded,
// per-column occlusion window), then sprites (billboards + world-anchored voxel volumes) z-tested per
// pixel. Pure: (map, camera, config, textures, target?) -> Uint8ClampedArray; the canvas blit is outside.
// ZONE PORTALS: a one-sided ZonePortalDef line is a LIVE window; the primary walk records its per-column
// opening, a NEIGHBOR pass re-walks that zone with the camera translated by (−dx, −dy). Translation
// preserves distances, so depth stays coherent for sprites and glass. Depth capped at 1.

export interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number; // radians
}

type Rgb = readonly [number, number, number];

interface WallVert {
  readonly forward: number;
  readonly side: number;
  readonly u: number; // texture coordinate = distance along the linedef
}

// [rowStart, rowEnd): a worker renders only its horizontal slice, so writes clamp to the band.
interface Dims {
  readonly width: number;
  readonly height: number;
  readonly rowStart: number;
  readonly rowEnd: number;
}

// Background fallback (columns no wall reaches). Exported so the GPU command path reproduces it exactly.
export const BG_CEILING: Rgb = [34, 36, 46];
export const BG_FLOOR: Rgb = [54, 48, 42];
export const NEAR = 0.02; // near clip plane (forward distance); the GPU voxel replay clamps its DDA to it

// Wall/flat tiling anchors: large offsets keeping texture UV ≥ 0. The GPU compute shader MUST anchor the
// same way for pixel parity.
export const TEX_ANCHOR = 64;
export const FLAT_ANCHOR = 1024;

// `rotations` marks a directional prop (a 1×N view-angle sheet); `voxel` upgrades it to a world-anchored
// volume when its texture resolves to a carved grid, else it falls back to the rotation billboard.
interface SpriteDef {
  readonly tex: string;
  readonly width: number;
  readonly height: number;
  readonly rotations?: number;
  readonly voxel?: true;
}
// A voxel prop's box maps the TRIMMED grid onto (width, height): cubic voxels require
// width == height × (n/nz) of the trimmed grid — restate the width when a sculpt's box changes.
// (The weapon pickups derive this ratio at load via voxAspects; props still pin it here.)
const SPRITES: Partial<Record<ThingType, SpriteDef>> = {
  barrel: { tex: 'BARREL', width: 0.8, height: 1.1 },
  prop: { tex: 'PROP', width: 0.8, height: 1.6 }, // potted plant — symmetric, one frame
  prop_screen: { tex: 'PROP_SCREEN', width: 0.64, height: 0.6, rotations: 8, voxel: true }, // trimmed 160×95×150 → 0.6 × 1.0667
  prop_totem: { tex: 'PROP_TOTEM', width: 1.25, height: 2.0, rotations: 4, voxel: true },
  prop_board: { tex: 'PROP_BOARD', width: 1.49, height: 1.7, rotations: 4, voxel: true },
  prop_chair: { tex: 'PROP_CHAIR', width: 1.108, height: 1.2, rotations: 4, voxel: true }, // trimmed 108×110×117 → 1.2 × 0.9231
  prop_cooler: { tex: 'PROP_COOLER', width: 0.6, height: 1.5 }, // water cooler — symmetric, one frame
};

// `z` is the world height of the sprite's bottom (sector floor for decor, eye height for a shot in flight).
export interface Sprite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tex: string;
  readonly width: number;
  readonly height: number;
  // Atlas cell: only cell (col,row) of a cols×rows grid is drawn. Omitted → the whole texture.
  readonly cols?: number;
  readonly rows?: number;
  readonly col?: number;
  readonly row?: number;
  // Directional prop: `rotations` = a 1×N view-angle sheet, `facing` the authored heading — orientSprite
  // re-picks `col` for the frame's viewpoint.
  readonly rotations?: number;
  readonly facing?: number;
  // When the texture resolves to a carved grid (voxelDepth), render as a world-anchored VOLUME (col
  // ignored); without a grid the flag is inert and the rotation billboard is the fallback.
  readonly voxel?: boolean;
  readonly flash?: number; // 0..1 white hit-flash blend
}

// A zone visible through this map's live portals, plus (optionally) the sprites ALIVE in it this frame in
// ITS OWN coordinates. Without `sprites` the neighbor renders geometry only.
export interface ZoneNeighbor {
  readonly map: CompiledMap;
  readonly sprites?: readonly Sprite[];
}

// A directional prop rests on FRONT (column 0); the game's per-frame list re-picks the cell via
// orientSprite. A voxel prop also renders as a volume wherever its carved grid is in the library.
export function mapSprites(map: CompiledMap): Sprite[] {
  const sprites: Sprite[] = [];

  for (const thing of map.source.things) {
    const def = SPRITES[thing.type];

    if (def !== undefined) {
      const z = map.source.sectors[locateSubSector(map.root, thing.x, thing.y).sector].floorZ;
      const base: Sprite = {
        x: thing.x,
        y: thing.y,
        z,
        tex: def.tex,
        width: def.width,
        height: def.height,
      };

      if (def.rotations === undefined) {
        sprites.push(base);
      } else {
        sprites.push({
          ...base,
          cols: def.rotations,
          rows: 1,
          col: 0,
          row: 0,
          rotations: def.rotations,
          facing: thing.angle,
          voxel: def.voxel,
        });
      }
    }
  }

  return sprites;
}

const MISSING = missingTexture();

// A sector whose `ceilTex` is this renders its ceiling as open SKY (a gradient).
export const SKY = 'SKY';

// Glass wash washed over the see-through opening so it reads as a PANE, not a hole: out = src*KEEP + TINT.
const GLASS_ALPHA = 0.22;
const GLASS_KEEP = 1 - GLASS_ALPHA;
const GLASS_TINT_R = (150 * GLASS_ALPHA) | 0; // light cool blue, pre-multiplied by alpha
const GLASS_TINT_G = (195 * GLASS_ALPHA) | 0;
const GLASS_TINT_B = (225 * GLASS_ALPHA) | 0;

// Exported so the GPU shader transcribes coolGlassTint with these exact constants.
export const GLASS_TINT = {
  keep: GLASS_KEEP,
  r: GLASS_TINT_R,
  g: GLASS_TINT_G,
  b: GLASS_TINT_B,
} as const;

// Used by blendGlass on the clear pane and by drawSprites on a sprite seen THROUGH a pane; the GPU parity
// executor replays this as its f64 reference.
export function coolGlassTint(c: number): number {
  const r = (((c & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_R;
  const g = ((((c >> 8) & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_G;
  const b = ((((c >> 16) & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_B;

  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

// Little-endian RGBA uint32 for bulk framebuffer fills.
function packRgb(c: Rgb): number {
  return ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
}

function resolve(textures: TextureLibrary, name: string): Texture {
  return textures.get(name) ?? MISSING;
}

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

// Clip a camera-space wall to the near plane (interpolating u), or null if fully behind.
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

// Z-tested against zbuf so a far wall seen past a portal can't repaint over a nearer flat a window already
// filled — one arbiter (the z-buffer) for all surfaces.
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
  // SQUARE texels: HEIGHT spans `worldSize` world units, and the same texels/unit drive U so art keeps aspect.
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

// rowScale[y] = focal/(y−horizon) turns plane height into world distance per row. That distance IS the
// pixel's camera-forward depth (same metric as walls), z-tested so adjacent flats resolve by depth.
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

// A vertical gradient where nothing nearer was drawn. Leaves the z-buffer untouched (the sky is infinitely
// far), so sprites + nearer flats still paint in front.
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

// Glass surfaces STACK per column, front-to-back (ascending depth); a fifth farther surface is dropped.
// The GPU command builder records the same per-column cap.
export const GLASS_LAYERS = 4;

// Nearest layer first (front-to-back walk). Layer k of column x is at index x·GLASS_LAYERS + k.
export interface GlassPanes {
  readonly count: Uint8Array; // live layers per column (0 = no glass there)
  readonly top: Int32Array; // CLIPPED (on-screen) span to paint, per layer
  readonly bot: Int32Array;
  readonly vTop: Int32Array; // UNCLIPPED pane top/bottom (may run off-screen) — the texture's V anchor
  readonly vBot: Int32Array;
  readonly tu: Float32Array; // texture column (−1 = a plain window → flat tint)
  readonly shade: Float32Array; // per-layer shade for opaque texels
  readonly depth: Float32Array; // wall distance → z-buffered at opaque texels so sprites occlude
  readonly tex: (Texture | null)[]; // per-layer glass image; null = plain window
  readonly name: string[]; // library name (the command builder keys GPU ids off it)
}

// Held in frameScratch and REUSED across frames; resetGlass re-arms it per pass.
export function makeGlass(width: number): GlassPanes {
  return {
    count: new Uint8Array(width),
    top: new Int32Array(width * GLASS_LAYERS),
    bot: new Int32Array(width * GLASS_LAYERS),
    vTop: new Int32Array(width * GLASS_LAYERS),
    vBot: new Int32Array(width * GLASS_LAYERS),
    tu: new Float32Array(width * GLASS_LAYERS),
    shade: new Float32Array(width * GLASS_LAYERS),
    depth: new Float32Array(width * GLASS_LAYERS),
    tex: new Array<Texture | null>(width * GLASS_LAYERS).fill(null),
    name: new Array<string>(width * GLASS_LAYERS).fill(''),
  };
}

// Zeroing the per-column COUNTS is the whole reset — every other slot is read only below count[x], so
// stale entries are unreachable.
export function resetGlass(panes: GlassPanes): GlassPanes {
  panes.count.fill(0);

  return panes;
}

// seam[x] indexes `seams` (−1 = none); top/bot is the column's open span into the neighbor. `columns`
// counts a seam's recorded columns (0 → its pass is skipped).
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

// Held in frameScratch and REUSED across frames; resetPortals re-arms it per frame.
export function makePortals(width: number): PortalSpans {
  return {
    seam: new Int16Array(width).fill(-1),
    top: new Int32Array(width),
    bot: new Int32Array(width),
    seams: [],
  };
}

// top/bot are read only where seam[x] points at a seam registered THIS frame, so they need no refill.
export function resetPortals(spans: PortalSpans): PortalSpans {
  spans.seam.fill(-1);
  spans.seams.length = 0;

  return spans;
}

// Allocated ONCE and REUSED frame after frame (a JS context is single-threaded and never nests
// renderFrame calls, so reuse is safe). renderFrame stays externally pure — the scratch is re-armed on use.
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

// (Re)allocated only when the render resolution changes.
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

// null = recording off (no neighbors, or the pass IS a neighbor render — the depth-1 cap: a portal seen
// through a portal paints its solid middle texture instead).
export interface PortalPass {
  readonly spans: PortalSpans;
  readonly neighbors: ReadonlyMap<string, ZoneNeighbor>;
}

// Returns −1 when `neighbors` carries no zone for the key — the seam paints its solid middle texture.
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

// Deferred: run AFTER the wall pass drew the back sector through each opening (a single front-to-back pass
// can't blend over content it hasn't drawn yet). Layers blend FARTHEST → NEAREST.
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
      const vt = vTop[l]; // texture V anchored to the FULL pane extent (may be off-screen), not the
      const vh = vBot[l] - vt; // clipped span, so the art keeps world scale up close
      const sh = shade[l];
      let i = y0 * width + x;

      for (let y = y0; y <= y1; y++) {
        if (zbuf[i] < depth[l]) {
          i += width;
          continue; // a NEARER opaque surface occupies this pixel — the glass is behind it
        }
        let framed = false;
        let cr = 0;
        let cg = 0;
        let cb = 0;

        if (layerTex !== null) {
          const v = Math.min(th - 1, Math.max(0, (((y - vt) / vh) * th) | 0));
          const ti = (v * tw + col) << 2;

          if (layerTex[ti + 3] >= 128) {
            framed = true; // an opaque frame / mullion / handle texel
            cr = (layerTex[ti] * sh) | 0;
            cg = (layerTex[ti + 1] * sh) | 0;
            cb = (layerTex[ti + 2] * sh) | 0;
          }
        }
        if (framed) {
          buf32[i] = (0xff000000 | (cb << 16) | (cg << 8) | cr) >>> 0;
          zbuf[i] = depth[l]; // opaque at the layer's depth → sprites behind it are now occluded
        } else {
          buf32[i] = coolGlassTint(buf32[i]); // clear glass → cool tint
        }
        i += width;
      }
    }
  }
}

// Restricts a NEIGHBOR pass's sprites to seam `index`'s windows — outside the window the z-buffer holds
// LOCAL depths a translated neighbor sprite must never compete with.
interface SpriteWindow {
  readonly seam: Int16Array;
  readonly top: Int32Array;
  readonly bot: Int32Array;
  readonly index: number;
}

// The DDA's entry axis names the face a pixel shows; its factor multiplies the sprite's shade. Exported:
// the WGSL shader interpolates these EXACT constants (CPU/GPU parity).
export const VOXEL_SHADE = {
  top: 1.18, // entered descending z — the sunlit face
  bottom: 0.55, // entered ascending z — the underside
  sideX: 0.82, // entered along the grid's lateral axis
  sideY: 1.0, // entered along the depth axis (the front/back the art was authored from)
} as const;

// A ray crosses at most n+ny+nz cells before a bounds-exit break, so this cap NEVER binds — it exists only
// so the shader loop is provably finite to the GPU. The CPU march needs no cap.
export const VOXEL_MAX_STEPS = 512;

// Everything the per-pixel 3D DDA needs, pre-resolved into GRID SPACE so the march is camera-free (a
// translated NEIGHBOR pass records exactly like a local one). Grid space: x lateral (n cells over
// Sprite.width), y depth (ny, same plan scale), z up (nz over Sprite.height); the ray parameter IS the
// camera-forward depth. fwdG/rightG are the unit camera axes rotated/scaled into the grid.
export interface VoxelQuad {
  readonly n: number; // grid cells: lateral × depth × up
  readonly ny: number;
  readonly nz: number;
  readonly camGX: number; // camera position in grid coordinates
  readonly camGY: number;
  readonly camGZ: number;
  readonly fwdGX: number; // camera FORWARD axis in grid units per world unit (plan)
  readonly fwdGY: number;
  readonly rightGX: number; // screen-column offset axis, same units
  readonly rightGY: number;
  readonly zScale: number; // grid z cells per world unit (nz / world height)
}

// The seam between projection (shared, cheap) and per-pixel work: the CPU paints these quads; the GPU
// builder serializes the SAME quads. A BILLBOARD (vox absent) has constant depth; a VOXEL VOLUME (vox
// present) has per-pixel depth, and its left/right/yTop/yBottom are the conservative screen ENVELOPE.
export interface SpriteQuad {
  readonly tex: Texture;
  readonly name: string; // library name (the command builder keys GPU ids off it)
  readonly forward: number; // camera depth of the centre — the far-to-near sort key
  readonly left: number; // screen quad, inclusive (may run off-screen — painters clamp)
  readonly right: number;
  readonly yTop: number;
  readonly yBottom: number;
  readonly u0: number; // atlas cell origin + size in texels (the whole texture for a plain billboard)
  readonly v0: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly shade: number; // sector light × falloff × (1 + hit-flash) — channels clamp at 255
  readonly vox?: VoxelQuad;
}

// A billboard carries its atlas `cell`; a voxel surface carries its grid + depth-cell count instead.
type SpriteSurface = {
  readonly spr: Sprite;
  readonly depth: number;
  readonly cam: CamPoint;
} & (
  | { readonly kind: 'billboard'; readonly cell: number }
  | { readonly kind: 'voxel'; readonly grid: Texture; readonly ny: number }
);

// Cull behind the near plane, sort far-to-near (nearer overdraws), resolve texture/cell/shade. Pure —
// shared by the CPU painter and the GPU command builder, so both derive identical quads.
export function projectSprites(
  sprites: readonly Sprite[],
  map: CompiledMap,
  camera: Camera,
  width: number,
  focal: number,
  horizon: number,
  textures: TextureLibrary,
): SpriteQuad[] {
  const visible: SpriteSurface[] = [];

  for (const spr of sprites) {
    const cam = toCamera(camera, spr);

    if (cam.forward <= NEAR) {
      continue;
    }
    if (spr.voxel === true) {
      const grid = resolve(textures, spr.tex);

      if (grid.voxelDepth !== undefined) {
        visible.push({ spr, depth: cam.forward, kind: 'voxel', cam, grid, ny: grid.voxelDepth });
        continue;
      }
      // No carved grid (SSR / failed decode / procedural fallback): fall through to the rotation billboard.
    }
    visible.push({ spr, depth: cam.forward, kind: 'billboard', cam, cell: spr.col ?? 0 });
  }
  visible.sort((a, b) => b.depth - a.depth); // far first → nearer surfaces overdraw

  const cosA = Math.cos(camera.angle);
  const sinA = Math.sin(camera.angle);
  const quads: SpriteQuad[] = [];

  for (const s of visible) {
    const sector = map.source.sectors[locateSubSector(map.root, s.spr.x, s.spr.y).sector];
    const tex = resolve(textures, s.spr.tex);
    // Additive hit-flash: brighten the sprite's OWN colours toward white (×(1+flash)), not a flat wash.
    const flash = Math.max(0, Math.min(1, s.spr.flash ?? 0));
    const shade = (sector.light / 255) * Math.max(0.25, Math.min(1, 6 / s.depth)) * (1 + flash);
    const common = { tex, name: s.spr.tex, forward: s.depth, shade };

    if (s.kind === 'voxel') {
      // Resolve the camera + ray axes into GRID SPACE once, then project a CONSERVATIVE screen envelope
      // off the footprint corners for early rejection (the DDA decides exact coverage per pixel).
      const grid = s.grid;
      const n = grid.width;
      const ny = s.ny;
      const nz = grid.height / ny;
      const facing = s.spr.facing ?? 0;
      // Grid axes in world space: x = front view left→right, y = away from the front viewer, z up.
      const uX = -Math.sin(facing);
      const uY = Math.cos(facing);
      const vX = -Math.cos(facing);
      const vY = -Math.sin(facing);
      const planScale = n / s.spr.width; // grid cells per world unit — plan cells are square (carve contract)
      const zBottom = s.spr.z;
      const zTop = s.spr.z + s.spr.height;
      const zScale = nz / s.spr.height;
      const relX = camera.x - s.spr.x;
      const relY = camera.y - s.spr.y;
      // Footprint corners → the horizontal envelope + the near/far depths the vertical envelope needs.
      const halfU = s.spr.width / 2;
      const halfV = ny / planScale / 2;
      let minCol = Infinity;
      let maxCol = -Infinity;
      let nearest = Infinity;
      let farthest = -Infinity;
      let clipped = false;

      for (const [su, sv] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        // prettier-ignore
        const corner = toCamera(camera, {
          x: s.spr.x + uX * halfU * su + vX * halfV * sv,
          y: s.spr.y + uY * halfU * su + vY * halfV * sv,
        });

        nearest = Math.min(nearest, corner.forward);
        farthest = Math.max(farthest, corner.forward);
        if (corner.forward <= NEAR) {
          clipped = true; // a corner behind the near plane projects nonsense — widen to the full screen
          continue;
        }
        const col = projectColumn(corner, width, focal);

        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
      }
      // The centre is inside the footprint and passed the NEAR cull, so at least one corner projected.
      const invNear = 1 / Math.max(NEAR, nearest);
      const invFar = 1 / farthest;
      const topNear = horizon - (zTop - camera.z) * focal * invNear;
      const topFar = horizon - (zTop - camera.z) * focal * invFar;
      const botNear = horizon - (zBottom - camera.z) * focal * invNear;
      const botFar = horizon - (zBottom - camera.z) * focal * invFar;

      quads.push({
        ...common,
        u0: 0, // a voxel quad samples the whole grid — no atlas cell
        v0: 0,
        cellW: grid.width,
        cellH: grid.height,
        left: clipped ? 0 : Math.floor(minCol),
        right: clipped ? width - 1 : Math.ceil(maxCol),
        yTop: Math.floor(Math.min(topNear, topFar)),
        yBottom: Math.ceil(Math.max(botNear, botFar)),
        vox: {
          n,
          ny,
          nz,
          camGX: (relX * uX + relY * uY) * planScale + n / 2,
          camGY: (relX * vX + relY * vY) * planScale + ny / 2,
          camGZ: (camera.z - zBottom) * zScale,
          fwdGX: (cosA * uX + sinA * uY) * planScale,
          fwdGY: (cosA * vX + sinA * vY) * planScale,
          rightGX: (-sinA * uX + cosA * uY) * planScale,
          rightGY: (-sinA * vX + cosA * vY) * planScale,
          zScale,
        },
      });
      continue;
    }
    // The cell to sample: a whole-texture billboard (cols=rows=1) or one cell of a `cols`×`rows` atlas.
    const cellW = (tex.width / (s.spr.cols ?? 1)) | 0;
    const cellH = (tex.height / (s.spr.rows ?? 1)) | 0;
    const invF = 1 / s.cam.forward;
    const centerX = projectColumn(s.cam, width, focal);
    const halfW = s.spr.width * 0.5 * focal * invF;

    quads.push({
      ...common,
      u0: s.cell * cellW,
      v0: (s.spr.row ?? 0) * cellH,
      cellW,
      cellH,
      left: Math.round(centerX - halfW),
      right: Math.round(centerX + halfW),
      yTop: Math.round(horizon - (s.spr.z + s.spr.height - camera.z) * focal * invF),
      yBottom: Math.round(horizon - (s.spr.z - camera.z) * focal * invF),
    });
  }

  return quads;
}

// Per pixel of the screen envelope, walks the grid with an EXACT 3D DDA (Amanatides & Woo — cell-crossing
// distances are computed, not accumulated by sampling, which keeps the f32 GPU replay aligned with this
// f64 reference). The ray parameter is the camera-forward depth; the FIRST solid voxel wins. Pixels z-test
// AND WRITE their depth — the volume is real geometry to later sprites.
function drawVoxel(
  buf32: Uint32Array,
  zbuf: Float32Array,
  dims: Dims,
  q: SpriteQuad,
  vox: VoxelQuad,
  focal: number,
  horizon: number,
  glass: GlassPanes | null,
  window: SpriteWindow | null,
): void {
  const { width } = dims;
  const { tex, shade } = q;
  const px = tex.pixels;
  const { n, ny, nz, camGX, camGY, camGZ, fwdGX, fwdGY, rightGX, rightGY, zScale } = vox;
  const halfW = width / 2;
  // Per-axis march state (grid axes 0 = lateral, 1 = depth, 2 = up). One shared code path per axis keeps
  // the exact-zero-direction guard testable — a ray is EXACTLY axis-parallel only where the trig is exact.
  const origin3 = [camGX, camGY, camGZ] as const;
  const size3 = [n, ny, nz] as const;
  const dir3 = new Float64Array(3);
  const cell = new Int32Array(3);
  const stepDir = new Int32Array(3);
  const tDelta = new Float64Array(3);
  const tMax = new Float64Array(3);

  for (let x = Math.max(0, q.left); x <= Math.min(width - 1, q.right); x++) {
    let winTop = dims.rowStart;
    let winBot = dims.rowEnd - 1;

    if (window !== null) {
      if (window.seam[x] !== window.index) {
        continue; // no opening of the seam here — the volume must not leak past it
      }
      winTop = Math.max(winTop, window.top[x]);
      winBot = Math.min(winBot, window.bot[x]);
    }
    // The column's PLAN ray (constant down the column) and its slab window over the grid footprint.
    const offset = (halfW - x) / focal;

    dir3[0] = fwdGX + offset * rightGX;
    dir3[1] = fwdGY + offset * rightGY;
    let planEnter = NEAR;
    let planExit = Infinity;
    let planAxis = 1; // the face a ray STARTING inside the footprint shows (a depth-axis default)
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
        planMiss = true; // an axis-parallel ray outside the footprint never enters it
      }
    }
    if (planMiss || planEnter >= planExit) {
      continue; // the column's ray misses the footprint entirely
    }
    const yLo = Math.max(winTop, q.yTop);
    const yHi = Math.min(winBot, q.yBottom);
    let i = yLo * width + x;

    for (let y = yLo; y <= yHi; y++, i += width) {
      // The pixel's vertical slope closes the 3D ray; the z slab narrows the plan window.
      const dz = ((horizon - y) / focal) * zScale;
      let tEnter = planEnter;
      let tExit = planExit;
      let axis = planAxis;

      dir3[2] = dz;
      if (dz !== 0) {
        const tz0 = (0 - camGZ) / dz;
        const tz1 = (nz - camGZ) / dz;

        if (Math.min(tz0, tz1) > tEnter) {
          tEnter = Math.min(tz0, tz1);
          axis = 2;
        }
        tExit = Math.min(tExit, Math.max(tz0, tz1));
      } else if (camGZ < 0 || camGZ >= nz) {
        continue;
      }
      if (tEnter >= tExit || tEnter >= zbuf[i]) {
        continue; // misses the box, or the box entry is already behind the nearest surface here
      }
      // Amanatides & Woo march from the entry point, in whole grid cells.
      let t = tEnter;

      for (let a = 0; a < 3; a++) {
        const dir = dir3[a];

        cell[a] = Math.min(size3[a] - 1, Math.max(0, Math.floor(origin3[a] + t * dir)));
        stepDir[a] = dir > 0 ? 1 : -1;
        tDelta[a] = dir !== 0 ? Math.abs(1 / dir) : Infinity;
        tMax[a] = dir !== 0 ? (cell[a] + (dir > 0 ? 1 : 0) - origin3[a]) / dir : Infinity;
      }

      // Terminates unconditionally: every pass either breaks (hit / occluded / out of bounds) or
      // advances exactly one cell toward a bound. (The WGSL twin adds VOXEL_MAX_STEPS on top.)
      for (;;) {
        if (t >= zbuf[i]) {
          break; // everything from here on is occluded (t only grows)
        }
        const ti = ((cell[2] * ny + cell[1]) * n + cell[0]) << 2;

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
          zbuf[i] = t; // the volume writes depth — real geometry to every later surface

          // Seen THROUGH glass: same wash as billboards, at this PIXEL's depth (layers nearest-first).
          if (glass !== null) {
            for (let k = 0; k < glass.count[x]; k++) {
              const l = x * GLASS_LAYERS + k;

              if (t <= glass.depth[l]) {
                break; // this layer (and all farther ones) sits behind the voxel surface
              }
              if (y >= glass.top[l] && y <= glass.bot[l]) {
                buf32[i] = coolGlassTint(buf32[i]);
              }
            }
          }
          break;
        }
        // Step into the adjacent cell across the nearest boundary (tie-break order x → y → z).
        const axisNext = tMax[0] <= tMax[1] && tMax[0] <= tMax[2] ? 0 : tMax[1] <= tMax[2] ? 1 : 2;

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
}

// Billboard + voxel-volume quads, depth-tested PER PIXEL against the wall z-buffer, with per-texel alpha.
// A NEIGHBOR pass passes its seam's SpriteWindow so its sprites stay inside the portal opening.
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
    if (q.vox !== undefined) {
      drawVoxel(buf32, zbuf, dims, q, q.vox, focal, horizon, glass, window);
      continue;
    }
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

          // Seen THROUGH glass → wash the cool tint ONCE PER PANE in front (layers nearest-first, so stop
          // at the first layer at/beyond the sprite's own depth).
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

// The seam between the walk (BSP order, clipping, projection) and per-pixel work: a CPU sink paints
// immediately, a GPU sink RECORDS spans. Each span carries the resolved texture AND its library name.
// Ranges may be empty (y1 < y0) — sinks skip those.
export interface WalkSink {
  sky(x: number, y0: number, y1: number): void;
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

// A NEIGHBOR pass reuses the same framebuffer/z-buffer/projection with clip windows pre-loaded and
// `portals: null` (the recursion cap). Painting goes through `sink` — the walk never touches a framebuffer.
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

// One front-to-back wall walk, narrowing the per-column clip windows; all visible spans go to ctx.sink.
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
    // A live zone portal (one-sided): seamSpans stays null when recording is off or the zone has no map —
    // the seam then paints its solid middle texture below, like a plain wall.
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

      // Ceiling above + floor below are this sector's, wall or portal. An open SKY ceiling is a gradient.
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
          // Record the column's open window instead of painting (rows clamped into Int16 range). The
          // z-buffer stays untouched — the neighbor pass writes its own true depths into the window.
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

      // GLASS: record this pane's see-through opening so blendGlass can wash a tint once the back sector is
      // drawn. A sliding door records only its two still-covered edge bands; the clear gap grows from centre.
      if (line.glass && glass) {
        let covered = line.sliding !== true; // a plain window always records; a sliding leaf only where covered
        let leafU = -1; // the door-leaf texture column for this covered pixel (−1 = plain window)

        if (line.sliding) {
          const v2 = map.source.vertices[line.v2];
          const lineLen = Math.hypot(v2.x - lineStart.x, v2.y - lineStart.y);
          const halfClosed = lineLen / 2;
          const open = slides?.[seg.linedef] ?? 0;
          const half = (1 - open) * halfClosed; // each leaf's remaining covered width

          // Texture SLIDES with the leaf so the handle keeps its size and translates (no stretch in place).
          if (u <= half) {
            leafU = (u / halfClosed + open) * midImg.width; // left leaf, retracting toward the pocket at u=0
            covered = true;
          } else if (u >= lineLen - half) {
            leafU = ((lineLen - u) / halfClosed + open) * midImg.width; // right leaf, mirrored
            covered = true;
          }
          // `<=`/`>=` (not `<`/`>`): shut, the two leaves must MEET at the exact centre — a strict compare
          // leaves that column uncovered → a see-through hole that slides as you strafe.
        } else if (line.pane === true) {
          const v2 = map.source.vertices[line.v2];
          const lineLen = Math.hypot(v2.x - lineStart.x, v2.y - lineStart.y);

          leafU = (u / lineLen) * midImg.width; // fixed pane: the glass image maps once across the window
        }
        // TRUE opening = the INTERSECTION of both sectors (not the neighbour's raw extent), else a door
        // between a low and a tall room maps its leaf to the tall side's height from the low side.
        const openTop = Math.max(yCeil, yNeighCeil);
        const openBot = Math.min(yFloor, yNeighFloor);

        // APPEND as the column's next glass layer (front-to-back → nearest-first). A surface beyond a full
        // column is dropped — invisible behind GLASS_LAYERS tinted panes.
        if (covered && glass.count[x] < GLASS_LAYERS) {
          const l = x * GLASS_LAYERS + glass.count[x];

          glass.count[x]++;
          glass.depth[l] = forward;
          glass.top[l] = Math.max(top, openTop);
          glass.bot[l] = Math.min(bot, openBot);
          glass.tu[l] = leafU;
          glass.vTop[l] = openTop; // TRUE extent (unclipped by the screen) — identical from either side,
          glass.vBot[l] = openBot; // so the art keeps world scale up close
          glass.shade[l] = shade;
          glass.tex[l] = leafU >= 0 ? midImg : null; // null = plain flat-tint window
          glass.name[l] = side.middleTex; // library name — the GPU builder keys texel-pool ids off it
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

// Routes each walked span straight to the software painters — the immediate-mode twin of the GPU sink.
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

// For each recorded seam, re-walk that zone's BSP with the camera TRANSLATED into its space, restricted to
// the seam's windows, into the same framebuffer + z-buffer. Translation preserves distances, so the depths
// written are true camera-forward depths. Each neighbor's own glass blends INSIDE its pass (farther than
// the primary glass). Depth cap = 1: the pass runs with `portals: null`. Sliding doors render shut.
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
      continue; // visited but every column already occluded — nothing to fill
    }
    // Open exactly this seam's recorded windows; every other column stays closed (top 1 > bot 0).
    for (let x = 0; x < width; x++) {
      const mine = spans.seam[x] === s;

      topClip[x] = mine ? spans.top[x] : 1;
      botClip[x] = mine ? spans.bot[x] : 0;
    }
    // Our camera translated by (−dx,−dy) — translation only, no rotation (angle/z/pitch carry over).
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
    // The neighbor's LIVE billboards (in ITS coordinates), CLIPPED to this seam's windows — outside them
    // the z-buffer holds local depths a translated sprite must not fight.
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

// Pass `target` (e.g. an ImageData.data) to render in place. `rowStart`/`rowEnd` restrict writes to a
// horizontal band (geometry still walked in full) so many workers share ONE framebuffer/z-buffer.
// `neighbors` lights up the map's live zone portals; without it a seam paints its solid middle texture.
// Externally PURE — the reused scratch is re-armed on entry, so identical calls produce identical output.
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
  // Pitch is a horizon y-shear that may leave the screen on a steep look, so nothing here may assume it
  // sits in [0, height).
  const horizon = (height >> 1) + Math.round((camera.pitch ?? 0) * (height >> 1));
  const dims = { width, height, rowStart, rowEnd };

  // skyEnd (the ceiling/floor split) is CLAMPED into the band — unclamped, a negative end makes
  // TypedArray.fill wrap to length+end and paint garbage bands (the look-down glitch).
  const bandLo = rowStart * width;
  const bandHi = rowEnd * width;
  const skyEnd = Math.max(bandLo, Math.min(bandHi, horizon * width));

  buf32.fill(packRgb(BG_CEILING), bandLo, skyEnd);
  buf32.fill(packRgb(BG_FLOOR), skyEnd, bandHi);

  const scr = frameScratch(width, height);
  // Per-row world distance scale (focal / (y − horizon)); the horizon row is unused (gaps exclude it).
  const rowScale = scr.rowScale;

  for (let y = 0; y < height; y++) {
    rowScale[y] = focal / (y - horizon);
  }

  const topClip = scr.topClip.fill(0);
  const botClip = scr.botClip.fill(height - 1);

  // Re-armed only when the map has glass, so glass-free levels pay nothing per frame.
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

  // AFTER the local walk (windows + z-buffer final) and BEFORE the local glass blend — a local pane in
  // front of a seam must tint what the seam shows.
  if (portals !== null && portals.spans.seams.length > 0) {
    renderNeighbors(portals.spans, camera, textures, buf32, zbuf, dims, focal, horizon, rowScale);
  }

  // Deferred: after the walls drew the back through each pane, before sprites (so a sprite in front still occludes).
  if (glass) {
    blendGlass(buf32, zbuf, dims, glass);
  }

  drawSprites(
    buf32,
    zbuf,
    dims,
    sprites ?? mapSprites(map), // fallback: the map's static decor (mirrored by the GPU builder)
    map,
    camera,
    focal,
    horizon,
    textures,
    glass,
  );

  return buf;
}
