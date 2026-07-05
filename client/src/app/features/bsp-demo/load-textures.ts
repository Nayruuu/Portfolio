import {
  barrelTexture,
  brickTexture,
  ceilTexture,
  floorTexture,
  metalTexture,
  type Texture,
} from '../../core/lib/bsp-engine';
import { projectileEffect } from '../../shared/game/effects';

/** A placeholder DECOR billboard (a potted plant) — a "bidon" stand-in until real prop art lands. Transparent
 *  background + a green bush in a terracotta pot; feature-layer, so not bound by the core-coverage guard. */
function plantPlaceholder(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4); // transparent by default

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      if (y >= 44 && y < 60 && x >= 24 && x < 40) {
        pixels[i] = 96; // terracotta pot
        pixels[i + 1] = 62;
        pixels[i + 2] = 42;
        pixels[i + 3] = 255;
      } else {
        const dx = x - 32;
        const dy = y - 24;

        if (dx * dx + dy * dy < 380) {
          const k = (x * 7 + y * 3) % 11 < 3 ? 0.65 : 1; // leafy speckle

          pixels[i] = 44 * k; // green foliage
          pixels[i + 1] = 122 * k;
          pixels[i + 2] = 52 * k;
          pixels[i + 3] = 255;
        }
      }
    }
  }

  return { width: size, height: size, pixels };
}

/** A placeholder WHITEBOARD on casters — a "bidon" stand-in until real prop art lands. A white panel in a
 *  grey frame on two legs, with coloured marker scribbles; transparent around. Feature-layer, coverage-exempt. */
function boardPlaceholder(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4); // transparent by default

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

        pixels[i] = onFrame ? 110 : onScribble ? (x < 34 ? 40 : 190) : 236; // frame · marker · board
        pixels[i + 1] = onFrame ? 114 : onScribble ? 60 : 238;
        pixels[i + 2] = onFrame ? 120 : onScribble ? (x < 34 ? 160 : 60) : 240;
        pixels[i + 3] = 255;
      } else if (y >= 44 && ((x >= 14 && x < 18) || (x >= 46 && x < 50))) {
        pixels[i] = 90; // caster legs
        pixels[i + 1] = 92;
        pixels[i + 2] = 98;
        pixels[i + 3] = 255;
      }
    }
  }

  return { width: size, height: size, pixels };
}

/** A placeholder OFFICE SWIVEL CHAIR — a "bidon" stand-in until real prop art lands. Dark backrest + seat
 *  over a centre pole and a star base; transparent around. Feature-layer, coverage-exempt. */
function chairPlaceholder(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4); // transparent by default

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const onBack = y >= 6 && y < 34 && x >= 20 && x < 44;
      const onSeat = y >= 34 && y < 42 && x >= 14 && x < 50;
      const onPole = y >= 42 && y < 54 && x >= 30 && x < 34;
      const onBase = y >= 54 && y < 58 && x >= 16 && x < 48;

      if (onBack || onSeat || onPole || onBase) {
        const k = onBack && x >= 24 && x < 40 && y >= 10 ? 1.25 : 1; // padded centre highlight

        pixels[i] = Math.min(255, 38 * k);
        pixels[i + 1] = Math.min(255, 40 * k);
        pixels[i + 2] = Math.min(255, 46 * k);
        pixels[i + 3] = 255;
      }
    }
  }

  return { width: size, height: size, pixels };
}

/** A placeholder WATER COOLER — a "bidon" stand-in until real prop art lands. A translucent blue bottle on
 *  a white column with a drip tray; transparent around. Feature-layer, coverage-exempt. */
function coolerPlaceholder(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4); // transparent by default

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const onBottle = y >= 4 && y < 24 && x >= 22 && x < 42;
      const onColumn = y >= 24 && y < 58 && x >= 18 && x < 46;

      if (onBottle) {
        const k = x < 27 ? 1.2 : 1; // a light sheen on the bottle's left edge

        pixels[i] = Math.min(255, 110 * k); // water blue
        pixels[i + 1] = Math.min(255, 170 * k);
        pixels[i + 2] = Math.min(255, 210 * k);
        pixels[i + 3] = 255;
      } else if (onColumn) {
        const onTray = y >= 34 && y < 38 && x >= 24 && x < 40;

        pixels[i] = onTray ? 70 : 228; // dark drip tray on the white body
        pixels[i + 1] = onTray ? 72 : 230;
        pixels[i + 2] = onTray ? 76 : 232;
        pixels[i + 3] = 255;
      }
    }
  }

  return { width: size, height: size, pixels };
}

/**
 * PLACEHOLDER — synthesize a 1×4 DIRECTIONAL ROTATION SHEET (front · right · back · left) from a single
 * frame, until the real 1×4 green-screen sheets land: right/left are the frame mirrored with a warm/cool
 * tint, back is darkened — so walking around a prop VISIBLY cycles its cells in-game. DELETE this (and its
 * call sites) when the real art arrives: a served 1×4 sheet needs no synthesis.
 */
function directionalSheetPlaceholder(base: Texture): Texture {
  const { width: w, height: h, pixels: src } = base;
  const out = new Uint8ClampedArray(4 * w * h * 4);
  // Per-cell (r,g,b) gains + horizontal mirror: front as-is · right warm+mirrored · back dark · left cool+mirrored.
  const cells: readonly { gain: readonly [number, number, number]; mirror: boolean }[] = [
    { gain: [1, 1, 1], mirror: false },
    { gain: [1, 0.8, 0.6], mirror: true },
    { gain: [0.55, 0.55, 0.55], mirror: false },
    { gain: [0.6, 0.8, 1], mirror: true },
  ];

  cells.forEach((cell, c) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + (cell.mirror ? w - 1 - x : x)) * 4;
        const d = (y * 4 * w + c * w + x) * 4;

        out[d] = src[s] * cell.gain[0];
        out[d + 1] = src[s + 1] * cell.gain[1];
        out[d + 2] = src[s + 2] * cell.gain[2];
        out[d + 3] = src[s + 3];
      }
    }
  });

  return { width: 4 * w, height: h, pixels: out };
}

/** A placeholder GLASS PANE — a "bidon" stand-in until real glass art lands (see `prompts/glass_pane.md`). Mostly
 *  clear (alpha 0 → see-through + cool tint), with an opaque aluminium mullion frame (border + central cross) and
 *  a couple of diagonal reflection glints. Sampled per pixel like a door leaf; feature-layer, coverage-exempt. */
function glassPaneTexture(): Texture {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4); // clear by default
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
        pixels[i] = 150; // opaque aluminium mullion (alpha ≥ 128 → stamped as the frame)
        pixels[i + 1] = 156;
        pixels[i + 2] = 164;
        pixels[i + 3] = 255;
      } else if ((x + y) % 26 < 4) {
        pixels[i] = 214; // a soft diagonal reflection glint (semi-opaque → still stamped over the tint)
        pixels[i + 1] = 228;
        pixels[i + 2] = 242;
        pixels[i + 3] = 150;
      }
      // else: left at alpha 0 → clear glass (see-through + the cool tint from blendGlass)
    }
  }

  return { width: size, height: size, pixels };
}

/** The procedural fallback library (no assets needed) — what renders before, or instead of, the WebP art. */
export function proceduralTextures(): Map<string, Texture> {
  return new Map<string, Texture>([
    ['BRICK', brickTexture()],
    ['METAL', metalTexture()],
    ['FLOOR', floorTexture()],
    ['STEP', metalTexture()],
    ['CEIL', ceilTexture()],
    ['BARREL', barrelTexture()],
    ['PROP', plantPlaceholder()], // potted lobby plant — real art in ENV_ASSETS (this is the offline fallback)
    // Directional (4-rotation) props: their engine defs sample a 1×4 view-angle sheet, so EVERY texture
    // registered under these names — fallback or served — must be one (see `directionalSheetPlaceholder`).
    ['PROP_SCREEN', directionalSheetPlaceholder(metalTexture())], // crashed desk monitor — real art in ENV_ASSETS
    ['PROP_TOTEM', directionalSheetPlaceholder(metalTexture())], // directory totem — real art in ENV_ASSETS
    ['PROP_BOARD', directionalSheetPlaceholder(boardPlaceholder())], // whiteboard — art pending (ENV url 404s → this shows)
    ['PROP_CHAIR', directionalSheetPlaceholder(chairPlaceholder())], // office chair — art pending
    ['PROP_COOLER', coolerPlaceholder()], // water cooler (symmetric, single frame) — art pending
    // Extended palette (WebP swaps in via `loadEnvTextures`; these are the pre-decode / SSR fallbacks).
    ['CUBICLE', brickTexture()],
    ['SCREEN', metalTexture()],
    ['PILLAR', brickTexture()],
    ['DAMAGED', brickTexture()],
    ['RACKS', metalTexture()],
    ['GLASS', metalTexture()],
    ['GLASS_INT', metalTexture()],
    ['GLASS_PANE', glassPaneTexture()], // textured see-through pane (mullions + reflections + clear), sampled like a door leaf
    ['ELEVATOR', metalTexture()], // closed corporate elevator doors (dead) — real art in ENV_ASSETS
    ['WOOD', brickTexture()], // warm wood veneer accent wall (premium lobby) — real art in ENV_ASSETS
    ['CEIL_LUX', ceilTexture()], // white luminous cornice ceiling (premium lobby) — real art in ENV_ASSETS
    ['CONCRETE', ceilTexture()],
    ['TECHNICAL', ceilTexture()],
    ['NEON', ceilTexture()],
    ['CEIL_DAMAGED', ceilTexture()],
    // Doors (plain + colour-keyed for badge doors).
    ['DOOR', metalTexture()],
    ['DOOR_RED', metalTexture()],
    ['DOOR_BLUE', metalTexture()],
    ['DOOR_YELLOW', metalTexture()],
    // Themed floors (per-zone identity for the episode).
    ['CARPET', floorTexture()],
    ['TILE', floorTexture()],
    ['MARBLE', floorTexture()],
    ['GRATING', floorTexture()],
    ['SLAB', floorTexture()],
    ['LOBBY_FLOOR', floorTexture()],
    ['CITY', brickTexture()],
    ['CITY_STREET', brickTexture()], // entrance frontage — ground-level deserted street backdrop
    ['CITY_PLAZA', brickTexture()], // M2 break-nook window — the deserted plaza backdrop
    ['DOOR_GLASS', metalTexture()], // sliding glass door leaf (WebP carries alpha: opaque frame + clear glass)
    // Themed walls (per-zone identity for the episode).
    ['LOBBY', brickTexture()],
    ['KITCHEN', brickTexture()],
    ['EXEC', brickTexture()],
  ]);
}

/**
 * Browser-side asset bridge for the BSP demo: decodes served WebP images into the engine's {@link Texture}
 * format (an RGBA pixel buffer the software renderer samples directly). This is DOM code (Image + canvas),
 * so it lives in the feature layer — NOT in `core/`, whose engine stays pure + headless-testable.
 *
 * Wires the whole environment — flats (floor / ceiling / dais tops) AND walls. Each entry carries a
 * `worldSize` — how many world units one texture tile spans — because a detailed 512² panel tiled every
 * 1 unit (the default) repeats far too densely; for walls it also sets the panel's height (worldSize 4 =
 * one full panel over a 4-tall wall, no vertical repeat). Power-of-two sources only (the renderer's
 * `& (size−1)` texel wrap needs it); a non-POT or missing image is skipped → the procedural fallback shows.
 */

/** A `sample-map` surface name → its served art + tiling period (world units one tile/panel spans). */
const ENV_ASSETS: Readonly<Record<string, { url: string; worldSize: number }>> = {
  FLOOR: { url: '/game/textures/floor_techbase_512.webp', worldSize: 4 },
  CEIL: { url: '/game/textures/ceiling_techbase_512.webp', worldSize: 4 },
  STEP: { url: '/game/textures/floor_techbase_512.webp', worldSize: 2 }, // dais tops — tighter so steps read
  BRICK: { url: '/game/textures/wall_techbase_512x256.webp', worldSize: 4 }, // room walls — one panel, full height
  METAL: { url: '/game/textures/wall_servers_512.webp', worldSize: 2 }, // dais risers/canopy — server racks
  // Extended wall palette — per-zone variety (a level designer picks one per area for identity).
  CUBICLE: { url: '/game/textures/wall_cubicle_512.webp', worldSize: 4 }, // open-space partitions
  SCREEN: { url: '/game/textures/wall_screen_512.webp', worldSize: 3 }, // monitor/display walls
  PILLAR: { url: '/game/textures/wall_pillar_512.webp', worldSize: 4 }, // structural pillars / plain panels
  DAMAGED: { url: '/game/textures/wall_damaged_512.webp', worldSize: 4 }, // broken/derelict walls
  RACKS: { url: '/game/textures/wall_servers_b_512.webp', worldSize: 2 }, // dense server racks (variant)
  GLASS: { url: '/game/textures/glass_techbase_512.webp', worldSize: 4 }, // glass partition (opaque look for now)
  GLASS_INT: { url: '/game/textures/glass_interior_512.webp', worldSize: 4 }, // interior glass variant
  // Extended ceiling palette.
  CONCRETE: { url: '/game/textures/ceiling_concrete_512.webp', worldSize: 4 },
  TECHNICAL: { url: '/game/textures/ceiling_technical_512.webp', worldSize: 4 },
  NEON: { url: '/game/textures/ceiling_neon_broken_512.webp', worldSize: 4 }, // broken-neon ceiling accent
  CEIL_DAMAGED: { url: '/game/textures/ceiling_damaged_512.webp', worldSize: 4 },
  // Doors — plain + colour-keyed for badge doors (worldSize 3 ≈ one panel over a ~3-tall doorway).
  DOOR: { url: '/game/textures/wall_door_512.webp', worldSize: 3 },
  DOOR_RED: { url: '/game/textures/wall_door_red_512.webp', worldSize: 3 },
  DOOR_BLUE: { url: '/game/textures/wall_door_blue_512.webp', worldSize: 3 },
  DOOR_YELLOW: { url: '/game/textures/wall_door_yellow_512.webp', worldSize: 3 },
  // Themed floors — per-zone identity for the episode.
  CARPET: { url: '/game/textures/floor_carpet_512.webp', worldSize: 4 }, // offices
  TILE: { url: '/game/textures/floor_tile_512.webp', worldSize: 4 }, // cafeteria
  MARBLE: { url: '/game/textures/floor_marble_512.webp', worldSize: 4 }, // lobby + C-suite
  GRATING: { url: '/game/textures/floor_grating_512.webp', worldSize: 4 }, // servers + datacenter
  SLAB: { url: '/game/textures/floor_slab_512.webp', worldSize: 4 }, // sub-basement concrete
  LOBBY_FLOOR: { url: '/game/textures/floor_lobby_512.webp', worldSize: 4 }, // bright lobby terrazzo
  CITY: { url: '/game/textures/backdrop_city_512.webp', worldSize: 8 }, // exterior cityscape backdrop — worldSize 8 = an 8-tall/8-wide far wall shows exactly ONE copy, aligned to TEX_ANCHOR (64) at z0..z8 (no tiling)
  CITY_STREET: { url: '/game/textures/city_street_512.webp', worldSize: 8 }, // entrance frontage — deserted ground-level street (one clean copy)
  CITY_PLAZA: { url: '/game/textures/city_plaza_512.webp', worldSize: 8 }, // M2 break-nook window — deserted plaza (bottom band composed for the 8×3.2 opening)
  DOOR_GLASS: { url: '/game/textures/door_glass_512.webp', worldSize: 4 }, // sliding glass door leaf; ALPHA = clear glass, opaque = alu frame + handle (mapped per-panel by the glass pass, not tiled)
  GLASS_PANE: { url: '/game/textures/glass_pane_512.webp', worldSize: 4 }, // curtain-wall window; ALPHA = clear glass, opaque = alu mullions + reflections (mapped once across each window by the glass pass)
  ELEVATOR: { url: '/game/textures/elevator_512.webp', worldSize: 4 }, // dead corporate elevator doors (one door unit per 4-wide car opening)
  WOOD: { url: '/game/textures/wall_wood_512.webp', worldSize: 4 }, // warm wood veneer accent panels (reception / lounge / elevator surrounds)
  CEIL_LUX: { url: '/game/textures/ceiling_lux_512.webp', worldSize: 4 }, // white luminous cornice ceiling (LED cove grid + spots)
  // Decor prop billboards (green-screen art keyed to alpha offline; worldSize is unused by sprites).
  PROP: { url: '/game/props/prop_plant.webp', worldSize: 4 }, // potted lobby plant
  PROP_SCREEN: { url: '/game/props/prop_screen.webp', worldSize: 4 }, // crashed desk monitor (single frame TODAY — sheet-synthesized below)
  PROP_TOTEM: { url: '/game/props/prop_totem.webp', worldSize: 4 }, // directory totem (single frame TODAY — sheet-synthesized below)
  PROP_BOARD: { url: '/game/props/prop_board.webp', worldSize: 4 }, // whiteboard — future 1×4 rotation sheet (404 → procedural fallback)
  PROP_CHAIR: { url: '/game/props/prop_chair.webp', worldSize: 4 }, // office chair — future 1×4 rotation sheet
  PROP_COOLER: { url: '/game/props/prop_cooler.webp', worldSize: 4 }, // water cooler — future single frame
  // Themed walls — per-zone identity for the episode.
  LOBBY: { url: '/game/textures/wall_lobby_512.webp', worldSize: 4 }, // reception (M1)
  KITCHEN: { url: '/game/textures/wall_kitchen_512.webp', worldSize: 4 }, // cafeteria (M5)
  EXEC: { url: '/game/textures/wall_exec_512.webp', worldSize: 4 }, // C-suite (M6)
};

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

/** Below this alpha an atlas edge pixel is dropped to fully transparent (above → fully opaque): the enemy art
 *  is keyed off a green screen, leaving a soft anti-aliased fringe — hardening it kills the green halo. */
const EDGE_ALPHA_THRESHOLD = 140;

/**
 * Decode a sprite ATLAS (a grid of `rows` cells stacked vertically, alpha-keyed, typically NON power-of-two)
 * into a Texture, uniformly downscaled so each cell is at most `maxCellH` px tall — a Husk cell is 716px, far
 * more than its on-screen size, and the full atlas cloned to every worker would be huge. Sprites sample by
 * division (not the walls' POT `&`-wrap), so any size is fine. `null` on SSR / load error.
 */
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
      // NEAREST downscale (no smoothing): smoothing would blend the green chroma fringe into the figure edge
      // and bleed one atlas cell into its neighbour. Then HARDEN the alpha (threshold) to drop the soft green
      // anti-aliased fringe the art was keyed off a green screen with — mirrors the grid's `hardenEdges`.
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

/** The grid's `PROJECTILE_EFFECT_SCALE`: a projectile's on-screen height is this × its `effects.json` size,
 *  relative to a same-distance wall — i.e. its world height in cells. Reused so the BSP matches the grid. */
const PROJECTILE_SCALE = 0.42;

/** A projectile kind's world WIDTH in cells (its collision half-extent basis), derived from `effects.json`
 *  the way the grid sizes it (height = PROJECTILE_SCALE × size, width follows the art aspect). `undefined`
 *  for an unknown kind. (The sprite itself is decoded + painted screen-space in the demo, not as a Texture.) */
export function projectileWidth(kind: string): number | undefined {
  const effect = projectileEffect(kind);

  if (effect === undefined) {
    return undefined;
  }

  return PROJECTILE_SCALE * effect.size * (effect.width / effect.height);
}

/** PLACEHOLDER — the directional props whose SERVED art is still a single frame: their load is wrapped in
 *  {@link directionalSheetPlaceholder} so the engine's 1×4 sampling stays correct (and the rotation is
 *  visible in-game). Remove each name here the day its real 1×4 sheet ships. */
const SINGLE_FRAME_ROTATED = new Set(['PROP_SCREEN', 'PROP_TOTEM']);

/**
 * Load the real environment textures (POT walls/flats), reporting progress. Returns a name → Texture map to
 * MERGE over the procedural library — entries that fail to load are simply absent, leaving their procedural
 * fallback. (Projectiles are NOT here: their art is decoded + painted screen-space in the demo, not by a worker.)
 */
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
        out.set(
          asset.name,
          SINGLE_FRAME_ROTATED.has(asset.name) ? directionalSheetPlaceholder(texture) : texture,
        );
      }
      loaded += 1;
      onProgress?.(loaded, assets.length);
    }),
  );

  return out;
}
