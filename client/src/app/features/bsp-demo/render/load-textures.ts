import {
  bakeVoxelAo,
  barrelTexture,
  brickTexture,
  carveVoxelProp,
  ceilTexture,
  floorTexture,
  metalTexture,
  parseVox,
  type Texture,
} from '../../../core/lib/bsp-engine';
import { ENEMY_SPECS, PICKUP_TEXTURE_JOBS } from '../../../core/lib';

function plantPlaceholder(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      if (y >= 44 && y < 60 && x >= 24 && x < 40) {
        pixels[i] = 96;
        pixels[i + 1] = 62;
        pixels[i + 2] = 42;
        pixels[i + 3] = 255;
      } else {
        const dx = x - 32;
        const dy = y - 24;

        if (dx * dx + dy * dy < 380) {
          const k = (x * 7 + y * 3) % 11 < 3 ? 0.65 : 1;

          pixels[i] = 44 * k;
          pixels[i + 1] = 122 * k;
          pixels[i + 2] = 52 * k;
          pixels[i + 3] = 255;
        }
      }
    }
  }

  return { width: size, height: size, pixels };
}

function boardPlaceholder(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      if (y >= 4 && y < 44 && x >= 2 && x < 62) {
        const onFrame = y < 7 || y >= 41 || x < 5 || x >= 59;
        const onScribble =
          (y === 14 && x >= 10 && x < 42) ||
          (y === 20 && x >= 10 && x < 52) ||
          (y === 26 && x >= 10 && x < 34) ||
          (y === 33 && x >= 38 && x < 54);

        pixels[i] = onFrame ? 110 : onScribble ? (x < 34 ? 40 : 190) : 236;
        pixels[i + 1] = onFrame ? 114 : onScribble ? 60 : 238;
        pixels[i + 2] = onFrame ? 120 : onScribble ? (x < 34 ? 160 : 60) : 240;
        pixels[i + 3] = 255;
      } else if (y >= 44 && ((x >= 14 && x < 18) || (x >= 46 && x < 50))) {
        pixels[i] = 90;
        pixels[i + 1] = 92;
        pixels[i + 2] = 98;
        pixels[i + 3] = 255;
      }
    }
  }

  return { width: size, height: size, pixels };
}

function chairPlaceholder(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const onBack = y >= 6 && y < 34 && x >= 20 && x < 44;
      const onSeat = y >= 34 && y < 42 && x >= 14 && x < 50;
      const onPole = y >= 42 && y < 54 && x >= 30 && x < 34;
      const onBase = y >= 54 && y < 58 && x >= 16 && x < 48;

      if (onBack || onSeat || onPole || onBase) {
        const k = onBack && x >= 24 && x < 40 && y >= 10 ? 1.25 : 1;

        pixels[i] = Math.min(255, 38 * k);
        pixels[i + 1] = Math.min(255, 40 * k);
        pixels[i + 2] = Math.min(255, 46 * k);
        pixels[i + 3] = 255;
      }
    }
  }

  return { width: size, height: size, pixels };
}

function coolerPlaceholder(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const onBottle = y >= 4 && y < 24 && x >= 22 && x < 42;
      const onColumn = y >= 24 && y < 58 && x >= 18 && x < 46;

      if (onBottle) {
        const k = x < 27 ? 1.2 : 1;

        pixels[i] = Math.min(255, 110 * k);
        pixels[i + 1] = Math.min(255, 170 * k);
        pixels[i + 2] = Math.min(255, 210 * k);
        pixels[i + 3] = 255;
      } else if (onColumn) {
        const onTray = y >= 34 && y < 38 && x >= 24 && x < 40;

        pixels[i] = onTray ? 70 : 228;
        pixels[i + 1] = onTray ? 72 : 230;
        pixels[i + 2] = onTray ? 76 : 232;
        pixels[i + 3] = 255;
      }
    }
  }

  return { width: size, height: size, pixels };
}

/** Fallback for a prop whose real rotation sheet failed to load: tint one frame into `cells` cardinal looks
 *  (a count above 4 repeats each look over its span) so the sheet always matches the def's `cols`. */
function directionalSheetPlaceholder(base: Texture, cells = 4): Texture {
  const { width: w, height: h, pixels: src } = base;
  const out = new Uint8ClampedArray(cells * w * h * 4);
  const looks: readonly { gain: readonly [number, number, number]; mirror: boolean }[] = [
    { gain: [1, 1, 1], mirror: false },
    { gain: [1, 0.8, 0.6], mirror: true },
    { gain: [0.55, 0.55, 0.55], mirror: false },
    { gain: [0.6, 0.8, 1], mirror: true },
  ];

  for (let c = 0; c < cells; c++) {
    const look = looks[Math.floor((c * looks.length) / cells)];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + (look.mirror ? w - 1 - x : x)) * 4;
        const d = (y * cells * w + c * w + x) * 4;

        out[d] = src[s] * look.gain[0];
        out[d + 1] = src[s + 1] * look.gain[1];
        out[d + 2] = src[s + 2] * look.gain[2];
        out[d + 3] = src[s + 3];
      }
    }
  }

  return { width: cells * w, height: h, pixels: out };
}

/** Sampled per pixel like a door leaf: alpha ≥ 128 → stamped as opaque frame, alpha 0 → clear glass (tinted). */
function glassPaneTexture(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const frame = 3;
  const mid = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const onMullion =
        x < frame ||
        x >= size - frame ||
        y < frame ||
        y >= size - frame ||
        Math.abs(x - mid) < frame ||
        Math.abs(y - mid) < frame;

      if (onMullion) {
        pixels[i] = 150;
        pixels[i + 1] = 156;
        pixels[i + 2] = 164;
        pixels[i + 3] = 255;
      } else if ((x + y) % 26 < 4) {
        pixels[i] = 214;
        pixels[i + 1] = 228;
        pixels[i + 2] = 242;
        pixels[i + 3] = 150; // semi-opaque glint — still stamped over the tint
      }
    }
  }

  return { width: size, height: size, pixels };
}

/** The procedural fallback library — what renders before, or instead of, the WebP art. */
export function proceduralTextures(): Map<string, Texture> {
  return new Map<string, Texture>([
    ['BRICK', brickTexture()],
    ['METAL', metalTexture()],
    ['FLOOR', floorTexture()],
    ['STEP', metalTexture()],
    ['CEIL', ceilTexture()],
    ['BARREL', barrelTexture()],
    ['PROP', plantPlaceholder()],
    // Directional props: their engine defs sample a 1×N view-angle sheet, so EVERY texture registered under
    // these names — fallback or served — must be one (see `directionalSheetPlaceholder`).
    ['PROP_SCREEN', directionalSheetPlaceholder(metalTexture(), 8)], // 8-view def
    ['PROP_TOTEM', directionalSheetPlaceholder(metalTexture())],
    ['PROP_BOARD', directionalSheetPlaceholder(boardPlaceholder())],
    ['PROP_CHAIR', directionalSheetPlaceholder(chairPlaceholder())],
    ['PROP_COOLER', coolerPlaceholder()],
    // Extended palette (WebP swaps in via `loadEnvTextures`; these are the pre-decode / SSR fallbacks).
    ['CUBICLE', brickTexture()],
    ['SCREEN', metalTexture()],
    ['PILLAR', brickTexture()],
    ['DAMAGED', brickTexture()],
    ['RACKS', metalTexture()],
    ['GLASS', metalTexture()],
    ['GLASS_INT', metalTexture()],
    ['GLASS_PANE', glassPaneTexture()],
    ['ELEVATOR', metalTexture()],
    ['WOOD', brickTexture()],
    ['RECEPTION', brickTexture()],
    ['COUNTER_TOP', ceilTexture()],
    ['PILLAR_LOBBY', brickTexture()],
    ['TURNSTILE', metalTexture()],
    ['CEIL_LUX', ceilTexture()],
    ['CONCRETE', ceilTexture()],
    ['TECHNICAL', ceilTexture()],
    ['NEON', ceilTexture()],
    ['CEIL_DAMAGED', ceilTexture()],
    ['DOOR', metalTexture()],
    ['DOOR_RED', metalTexture()],
    ['DOOR_BLUE', metalTexture()],
    ['DOOR_YELLOW', metalTexture()],
    ['CARPET', floorTexture()],
    ['TILE', floorTexture()],
    ['MARBLE', floorTexture()],
    ['GRATING', floorTexture()],
    ['SLAB', floorTexture()],
    ['LOBBY_FLOOR', floorTexture()],
    ['CITY', brickTexture()],
    ['CITY_STREET', brickTexture()],
    ['CITY_PLAZA', brickTexture()],
    ['DOOR_GLASS', metalTexture()],
    ['LOBBY', brickTexture()],
    ['KITCHEN', brickTexture()],
    ['EXEC', brickTexture()],
  ]);
}

// Each entry's `worldSize` = how many world units one tile/panel spans (a detailed 512² panel tiled every
// 1 unit repeats far too densely; for walls it also sets the panel height). Power-of-two sources only — the
// renderer's `& (size−1)` texel wrap needs it; a non-POT or missing image is skipped → procedural fallback.
const ENV_ASSETS: Readonly<Record<string, { url: string; worldSize: number }>> = {
  FLOOR: { url: '/game/textures/floor_techbase_512.webp', worldSize: 4 },
  CEIL: { url: '/game/textures/ceiling_techbase_512.webp', worldSize: 4 },
  STEP: { url: '/game/textures/floor_techbase_512.webp', worldSize: 2 }, // dais tops — tighter so steps read
  BRICK: { url: '/game/textures/wall_techbase_512x256.webp', worldSize: 4 },
  METAL: { url: '/game/textures/wall_servers_512.webp', worldSize: 2 },
  CUBICLE: { url: '/game/textures/wall_cubicle_512.webp', worldSize: 4 },
  SCREEN: { url: '/game/textures/wall_screen_512.webp', worldSize: 3 },
  PILLAR: { url: '/game/textures/wall_pillar_512.webp', worldSize: 4 },
  DAMAGED: { url: '/game/textures/wall_damaged_512.webp', worldSize: 4 },
  RACKS: { url: '/game/textures/wall_servers_b_512.webp', worldSize: 2 },
  GLASS: { url: '/game/textures/glass_techbase_512.webp', worldSize: 4 },
  GLASS_INT: { url: '/game/textures/glass_interior_512.webp', worldSize: 4 },
  CONCRETE: { url: '/game/textures/ceiling_concrete_512.webp', worldSize: 4 },
  TECHNICAL: { url: '/game/textures/ceiling_technical_512.webp', worldSize: 4 },
  NEON: { url: '/game/textures/ceiling_neon_broken_512.webp', worldSize: 4 },
  CEIL_DAMAGED: { url: '/game/textures/ceiling_damaged_512.webp', worldSize: 4 },
  DOOR: { url: '/game/textures/wall_door_512.webp', worldSize: 3 },
  DOOR_RED: { url: '/game/textures/wall_door_red_512.webp', worldSize: 3 },
  DOOR_BLUE: { url: '/game/textures/wall_door_blue_512.webp', worldSize: 3 },
  DOOR_YELLOW: { url: '/game/textures/wall_door_yellow_512.webp', worldSize: 3 },
  CARPET: { url: '/game/textures/floor_carpet_512.webp', worldSize: 4 },
  TILE: { url: '/game/textures/floor_tile_512.webp', worldSize: 4 },
  MARBLE: { url: '/game/textures/floor_marble_512.webp', worldSize: 4 },
  GRATING: { url: '/game/textures/floor_grating_512.webp', worldSize: 4 },
  SLAB: { url: '/game/textures/floor_slab_512.webp', worldSize: 4 },
  LOBBY_FLOOR: { url: '/game/textures/floor_lobby_512.webp', worldSize: 4 },
  CITY: { url: '/game/textures/backdrop_city_512.webp', worldSize: 8 }, // worldSize 8 = one copy over an 8-tall/8-wide far wall, anchored to TEX_ANCHOR (no tiling)
  CITY_STREET: { url: '/game/textures/city_street_512.webp', worldSize: 8 },
  CITY_PLAZA: { url: '/game/textures/city_plaza_512.webp', worldSize: 8 },
  DOOR_GLASS: { url: '/game/textures/door_glass_512.webp', worldSize: 4 }, // ALPHA = clear glass, opaque = alu frame; mapped per-panel by the glass pass, not tiled
  GLASS_PANE: { url: '/game/textures/glass_pane_512.webp', worldSize: 4 }, // ALPHA = clear glass, opaque = mullions; mapped once across each window
  ELEVATOR: { url: '/game/textures/elevator_512.webp', worldSize: 4 },
  WOOD: { url: '/game/textures/wall_wood_512.webp', worldSize: 4 },
  RECEPTION: { url: '/game/textures/counter_reception_512.webp', worldSize: 1.28 }, // sized so the full design fits the 1.3-high counter face (64/1.28 keeps the z0 anchor)
  COUNTER_TOP: { url: '/game/textures/counter_top_512.webp', worldSize: 2 },
  PILLAR_LOBBY: { url: '/game/textures/pillar_lobby_512.webp', worldSize: 4 },
  TURNSTILE: { url: '/game/textures/turnstile_512.webp', worldSize: 2 },
  CEIL_LUX: { url: '/game/textures/ceiling_lux_512.webp', worldSize: 4 },
  // Decor prop billboards (green-screen art keyed to alpha offline; worldSize is unused by sprites).
  PROP: { url: '/game/props/prop_plant.webp', worldSize: 4 },
  PROP_SCREEN: { url: '/game/props/prop_screen.webp', worldSize: 4 }, // REAL 1×8 rotation sheet
  PROP_TOTEM: { url: '/game/props/prop_totem.webp', worldSize: 4 }, // REAL 1×4 rotation sheet
  PROP_BOARD: { url: '/game/props/prop_board.webp', worldSize: 4 }, // REAL 1×4 rotation sheet
  PROP_CHAIR: { url: '/game/props/prop_chair.webp', worldSize: 4 }, // REAL 1×4 rotation sheet
  PROP_COOLER: { url: '/game/props/prop_cooler.webp', worldSize: 4 },
  // OPTIONAL top-down views: extra carve constraints (footprint + top-face colours, see `voxel-carve.ts`).
  // CARVE INPUTS, not renderable surfaces — `loadEnvTextures` consumes and drops them; a missing file 404s
  // to `null` and the carve runs without it.
  PROP_SCREEN_TOP: { url: '/game/props/prop_screen_top.webp', worldSize: 4 }, // bezel at the image bottom = the front
  PROP_TOTEM_TOP: { url: '/game/props/prop_totem_top.webp', worldSize: 4 },
  PROP_BOARD_TOP: { url: '/game/props/prop_board_top.webp', worldSize: 4 },
  PROP_CHAIR_TOP: { url: '/game/props/prop_chair_top.webp', worldSize: 4 },
  LOBBY: { url: '/game/textures/wall_lobby_512.webp', worldSize: 4 },
  KITCHEN: { url: '/game/textures/wall_kitchen_512.webp', worldSize: 4 },
  EXEC: { url: '/game/textures/wall_exec_512.webp', worldSize: 4 },
};

/** Fetch + decode a `.vox` model into a voxel-grid Texture (BINARY, so `fetch` not `loadImageTexture`), or
 *  `null` on SSR / 404 / corrupt file — every failure falls back to the silhouette carve. */
async function loadVoxFile(url: string): Promise<Texture | null> {
  if (typeof fetch === 'undefined' || typeof document === 'undefined') {
    return null; // SSR / prerender — no DOM
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return null; // 404 → keep the carve
    }

    return parseVox(await response.arrayBuffer());
  } catch {
    return null; // network error or malformed model — fall back to the carve
  }
}

/** Decode one image URL into a Texture via a canvas, or `null` (SSR, load error, or non-power-of-two). */
function loadImageTexture(url: string, worldSize: number): Promise<Texture | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null); // SSR / prerender — no DOM
  }

  return new Promise<Texture | null>((resolve) => {
    const image = new Image();

    image.onerror = (): void => resolve(null); // a 404 just falls back to procedural
    image.onload = (): void => {
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      // Power-of-two only: the renderer's `& (size−1)` texel wrap would garble any other size.
      const pot = (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
      const context = pot ? document.createElement('canvas').getContext('2d') : null;

      if (context === null) {
        resolve(null);

        return;
      }
      context.canvas.width = w;
      context.canvas.height = h;
      context.drawImage(image, 0, 0);
      resolve({ width: w, height: h, pixels: context.getImageData(0, 0, w, h).data, worldSize });
    };
    image.src = url;
  });
}

/** Below this alpha an edge pixel drops to fully transparent (green-screen key leaves an AA fringe — hardening
 *  it kills the green halo). */
const EDGE_ALPHA_THRESHOLD = 140;

/** Decode a sprite ATLAS (`rows` cells stacked vertically, alpha-keyed, typically NON-POT), downscaled so each
 *  cell is at most `maxCellH` px (the full atlas cloned to every worker would be huge). Sprites sample by
 *  division, not the walls' POT `&`-wrap, so any size is fine. `null` on SSR / load error. */
export function loadAtlasTexture(
  url: string,
  rows: number,
  maxCellH = 256,
): Promise<Texture | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null); // SSR / prerender — no DOM
  }

  return new Promise<Texture | null>((resolve) => {
    const image = new Image();

    image.onerror = (): void => resolve(null);
    image.onload = (): void => {
      const scale = Math.min(1, maxCellH / (image.naturalHeight / rows));
      const w = Math.max(1, Math.round(image.naturalWidth * scale));
      const h = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = document.createElement('canvas').getContext('2d');

      if (context === null) {
        resolve(null);

        return;
      }
      context.canvas.width = w;
      context.canvas.height = h;
      // NEAREST (no smoothing): smoothing would bleed the green chroma fringe / neighbouring cells; then HARDEN
      // the alpha to drop the AA green fringe (mirrors the grid's `hardenEdges`).
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, w, h);
      const data = context.getImageData(0, 0, w, h);
      const px = data.data;

      for (let i = 3; i < px.length; i += 4) {
        px[i] = px[i] >= EDGE_ALPHA_THRESHOLD ? 255 : 0;
      }
      resolve({ width: w, height: h, pixels: px });
    };
    image.src = url;
  });
}

export interface AtlasJob {
  readonly name: string;
  readonly url: string;
  readonly rows: number;
}

/** The ORDER is load-significant — the caller zips the decoded textures back by index (`jobs[i]` ↔ the i-th decode). */
export function buildAtlasJobs(): AtlasJob[] {
  return [
    ...ENEMY_SPECS.flatMap((spec) => [
      { name: spec.texName, url: spec.atlasUrl, rows: spec.walkRows },
      { name: spec.deathTexName, url: spec.deathUrl, rows: 1 },
      { name: spec.attackTexName, url: spec.attackUrl, rows: 1 },
      { name: spec.painTexName, url: spec.painUrl, rows: 1 },
      ...(spec.thrower ? [{ name: spec.thrower.texName, url: spec.thrower.url, rows: 1 }] : []),
    ]),
    ...PICKUP_TEXTURE_JOBS.map((job) => ({ name: job.name, url: job.url, rows: 1 })),
  ];
}

/** Props whose rotation sheets are CARVED into voxel grids at load (see `voxel-carve.ts`); a failed carve keeps
 *  the sheet (billboard fallback). `n` = lateral grid resolution — detail-dense props (screen, board) carve at
 *  96 (64 turned them to mush), simple silhouettes keep 64 (grids clone to every worker). `cells` = the sheet's
 *  view count. */
const VOXEL_PROPS: Readonly<Record<string, { n: number; cells: number }>> = {
  PROP_TOTEM: { n: 64, cells: 4 },
  PROP_CHAIR: { n: 64, cells: 4 },
  PROP_SCREEN: { n: 96, cells: 8 },
  PROP_BOARD: { n: 96, cells: 4 },
};

/** Returns a name → Texture map to MERGE over the procedural library (failed entries stay absent → procedural
 *  fallback). The directional prop sheets are additionally SCULPTED into voxel grids here ({@link VOXEL_PROPS}),
 *  once per load, before the map fans out to the workers and the GPU texel pool. */
export async function loadEnvTextures(
  onProgress?: (loaded: number, total: number) => void,
): Promise<Map<string, Texture>> {
  const assets = Object.entries(ENV_ASSETS).map(([name, a]) => ({
    name,
    url: a.url,
    worldSize: a.worldSize,
  }));
  const out = new Map<string, Texture>();
  let loaded = 0;

  await Promise.all(
    assets.map(async (asset) => {
      const texture = await loadImageTexture(asset.url, asset.worldSize);

      if (texture !== null) {
        out.set(asset.name, texture);
      }
      loaded += 1;
      onProgress?.(loaded, assets.length);
    }),
  );

  for (const [name, config] of Object.entries(VOXEL_PROPS)) {
    // A hand-sculpted `.vox` wins over the carve when present; absent / 404 / parse-fail → the carve runs.
    const voxel = await loadVoxFile(`/game/props/${name.toLowerCase()}.vox`);
    const sheet = out.get(name);
    const top = out.get(`${name}_TOP`);
    const grid =
      voxel ?? (sheet !== undefined ? carveVoxelProp(sheet, config.n, { cells: config.cells, top }) : null); // prettier-ignore

    out.delete(`${name}_TOP`); // a carve input, never a surface to ship to the workers/GPU pool
    // Bake per-voxel AO BEFORE the grid fans out, so both backends sample the shadowed RGB identically.
    if (grid !== null) {
      out.set(name, bakeVoxelAo(grid));
    }
  }

  return out;
}
