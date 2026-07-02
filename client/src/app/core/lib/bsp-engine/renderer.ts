import { focalFor, projectColumn, toCamera, type Camera, type CamPoint } from './camera';
import { locateSubSector, signedSide } from './node-builder';
import { missingTexture, TEX_WORLD, type Texture, type TextureLibrary } from './texture';
import type { CompiledMap, NodeChild, Sector, Seg, ThingType } from './types';

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

const CEILING: Rgb = [34, 36, 46];
const FLOOR: Rgb = [54, 48, 42];
const NEAR = 0.02; // near clip plane (forward distance)
const TEX_ANCHOR = 64; // world-Z anchor for wall vertical tiling, above any ceiling → texture row ≥ 0
const FLAT_ANCHOR = 1024; // world-XY anchor for floor/ceiling tiling (a whole number of tiles) → UV ≥ 0

/** How a thing type renders as a billboard sprite: its texture name + world size (none = not a sprite). */
interface SpriteDef {
  readonly tex: string;
  readonly width: number;
  readonly height: number;
}
const SPRITES: Partial<Record<ThingType, SpriteDef>> = {
  barrel: { tex: 'BARREL', width: 0.8, height: 1.1 },
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

/**
 * Deferred GLASS pass: wash a cool translucent tint over each recorded glass-pane span (a see-through
 * two-sided glass line's opening), run AFTER the wall pass drew the back sector through it — the single
 * front-to-back pass can't blend over content it hasn't drawn yet. `top[x]`/`bot[x]` are the pane's span in
 * column `x`; `bot` defaults to -1 (`bot < top` = no glass there, or the span is off this worker's row band).
 */
function blendGlass(buf32: Uint32Array, dims: Dims, top: Int32Array, bot: Int32Array): void {
  const { width, rowStart, rowEnd } = dims;

  for (let x = 0; x < width; x++) {
    const y0 = Math.max(rowStart, top[x]);
    const y1 = Math.min(rowEnd - 1, bot[x]);

    if (y1 < y0) {
      continue;
    }
    let i = y0 * width + x;

    for (let y = y0; y <= y1; y++) {
      const c = buf32[i];
      const r = (((c & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_R;
      const g = ((((c >> 8) & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_G;
      const b = ((((c >> 16) & 0xff) * GLASS_KEEP) | 0) + GLASS_TINT_B;

      buf32[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      i += width;
    }
  }
}

/**
 * Draw billboard sprites (things) after the walls: face-camera quads, sorted far-to-near, depth-tested
 * PER PIXEL against the wall z-buffer (so steps/canopies occlude correctly), with per-texel alpha.
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
): void {
  const { width } = dims;
  const visible: { spr: Sprite; cam: CamPoint }[] = [];

  for (const spr of sprites) {
    const cam = toCamera(camera, spr);

    if (cam.forward <= NEAR) {
      continue;
    }
    visible.push({ spr, cam });
  }
  visible.sort((a, b) => b.cam.forward - a.cam.forward); // far first → nearer sprites overdraw

  for (const s of visible) {
    const invF = 1 / s.cam.forward;
    const centerX = projectColumn(s.cam, width, focal);
    const sector = map.source.sectors[locateSubSector(map.root, s.spr.x, s.spr.y).sector];
    const yBottom = Math.round(horizon - (s.spr.z - camera.z) * focal * invF);
    const yTop = Math.round(horizon - (s.spr.z + s.spr.height - camera.z) * focal * invF);
    const halfW = s.spr.width * 0.5 * focal * invF;
    const left = Math.round(centerX - halfW);
    const right = Math.round(centerX + halfW);
    const tex = resolve(textures, s.spr.tex);
    const tw = tex.width;
    const th = tex.height;
    const px = tex.pixels;
    // The cell to sample: a whole-texture billboard (cols=rows=1) or one cell of a `cols`×`rows` atlas.
    const cols = s.spr.cols ?? 1;
    const rows = s.spr.rows ?? 1;
    const cellW = (tw / cols) | 0;
    const cellH = (th / rows) | 0;
    const u0 = (s.spr.col ?? 0) * cellW;
    const v0 = (s.spr.row ?? 0) * cellH;
    const colSpan = right - left + 1;
    const rowSpan = yBottom - yTop + 1;
    // Additive hit-flash: brighten the sprite's OWN colours toward white (×(1+flash), clipped per channel) —
    // mirrors the grid's `lighter` re-blit, not a flat white wash.
    const flash = Math.max(0, Math.min(1, s.spr.flash ?? 0));
    const shade =
      (sector.light / 255) * Math.max(0.25, Math.min(1, 6 / s.cam.forward)) * (1 + flash);
    const yLo = Math.max(dims.rowStart, yTop);
    const yHi = Math.min(dims.rowEnd - 1, yBottom);

    for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x++) {
      const texCol = u0 + ((((x - left) / colSpan) * cellW) | 0);
      let i = yLo * width + x;

      for (let y = yLo; y <= yHi; y++) {
        const ti = ((v0 + ((((y - yTop) / rowSpan) * cellH) | 0)) * tw + texCol) << 2;

        // Per-pixel depth + alpha test: skip pixels behind a wall/step or transparent in the sprite.
        if (s.cam.forward < zbuf[i] && px[ti + 3] !== 0) {
          buf32[i] =
            0xff000000 |
            (Math.min(255, (px[ti + 2] * shade) | 0) << 16) |
            (Math.min(255, (px[ti + 1] * shade) | 0) << 8) |
            Math.min(255, (px[ti] * shade) | 0);
        }
        i += width;
      }
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
  const cosA = Math.cos(camera.angle);
  const sinA = Math.sin(camera.angle);

  // Background fallback for columns no wall reaches (e.g. viewed from outside); flats overdraw it in-room.
  // `skyEnd` is the ceiling/floor split row, CLAMPED into the band: a horizon off the top fills all-floor, off
  // the bottom all-ceiling. (Unclamped, a negative end makes `TypedArray.fill` wrap to `length + end` and paint
  // garbage bands — the look-down glitch.)
  const bandLo = rowStart * width;
  const bandHi = rowEnd * width;
  const skyEnd = Math.max(bandLo, Math.min(bandHi, horizon * width));

  buf32.fill(packRgb(CEILING), bandLo, skyEnd);
  buf32.fill(packRgb(FLOOR), skyEnd, bandHi);

  // Per-row world distance scale (focal / (y − horizon)); the horizon row is unused (gaps exclude it).
  const rowScale = new Float64Array(height);

  for (let y = 0; y < height; y++) {
    rowScale[y] = focal / (y - horizon);
  }

  const topClip = new Int16Array(width); // 0
  const botClip = new Int16Array(width).fill(height - 1);

  // A see-through GLASS line records its opening span per column here during the wall pass; `blendGlass` then
  // washes a tint over it (deferred — the back sector must be drawn through the opening first). Only allocated
  // when the map has glass, so glass-free levels pay nothing. `bot` defaults to -1 = "no glass in this column".
  const glass = map.source.linedefs.some((l) => l.glass === true)
    ? { top: new Int32Array(width), bot: new Int32Array(width).fill(-1) }
    : null;

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
        castSky(buf32, zbuf, dims, x, top, Math.min(bot, yCeil - 1), horizon);
      } else {
        castFlat(
          buf32,
          zbuf,
          dims,
          x,
          top,
          Math.min(bot, yCeil - 1),
          ceilImg,
          near.ceilZ,
          camera,
          rowScale,
          rayX,
          rayY,
          horizon,
          ceilFalloff,
          light,
        );
      }
      castFlat(
        buf32,
        zbuf,
        dims,
        x,
        Math.max(top, yFloor + 1),
        bot,
        floorImg,
        near.floorZ,
        camera,
        rowScale,
        rayX,
        rayY,
        horizon,
        floorFalloff,
        light,
      );

      if (neighbour === null) {
        paintWall(
          buf32,
          zbuf,
          dims,
          x,
          Math.max(top, yCeil),
          Math.min(bot, yFloor),
          midImg,
          u,
          zPerRow,
          camera.z,
          horizon,
          shade,
          forward,
        );
        topClip[x] = 1;
        botClip[x] = 0;
        continue;
      }

      const yNeighCeil = Math.round(horizon - (neighbour.ceilZ - camera.z) * focal * invF);
      const yNeighFloor = Math.round(horizon - (neighbour.floorZ - camera.z) * focal * invF);

      // GLASS: record this pane's see-through opening (between the neighbour's ceiling and floor, clipped to
      // the column's open window) so `blendGlass` can wash a tint over it once the back sector is drawn. A
      // SLIDING door only records the still-COVERED fraction — the panel retracts toward v1 as it opens, so
      // columns past `(1 − openness) × linedef length` are clear (no pane).
      if (line.glass && glass) {
        let covered = true;

        if (line.sliding) {
          const v2 = map.source.vertices[line.v2];
          const lineLen = Math.hypot(v2.x - lineStart.x, v2.y - lineStart.y);

          covered = u < (1 - (slides?.[seg.linedef] ?? 0)) * lineLen;
        }
        if (covered) {
          glass.top[x] = Math.max(top, yNeighCeil);
          glass.bot[x] = Math.min(bot, yNeighFloor);
        }
      }

      if (yNeighCeil > yCeil) {
        paintWall(
          buf32,
          zbuf,
          dims,
          x,
          Math.max(top, yCeil),
          Math.min(bot, yNeighCeil - 1),
          upperImg,
          u,
          zPerRow,
          camera.z,
          horizon,
          shade,
          forward,
        );
      }
      if (yNeighFloor < yFloor) {
        paintWall(
          buf32,
          zbuf,
          dims,
          x,
          Math.max(top, yNeighFloor + 1),
          Math.min(bot, yFloor),
          lowerImg,
          u,
          zPerRow,
          camera.z,
          horizon,
          shade * 0.85,
          forward,
        );
      }

      topClip[x] = Math.max(top, yNeighCeil);
      botClip[x] = Math.min(bot, yNeighFloor);
    }
  });

  // Deferred glass tint over each recorded pane (after the walls drew the back through it, before sprites so a
  // sprite in front of the pane still occludes it).
  if (glass) {
    blendGlass(buf32, dims, glass.top, glass.bot);
  }

  drawSprites(buf32, zbuf, dims, sprites ?? mapSprites(map), map, camera, focal, horizon, textures);

  return buf;
}
