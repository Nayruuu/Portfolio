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
    ['PROP_SCREEN', metalTexture()], // crashed reception monitor — real art in ENV_ASSETS
    ['PROP_TOTEM', metalTexture()], // lobby directory totem — real art in ENV_ASSETS
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
  DOOR_GLASS: { url: '/game/textures/door_glass_512.webp', worldSize: 4 }, // sliding glass door leaf; ALPHA = clear glass, opaque = alu frame + handle (mapped per-panel by the glass pass, not tiled)
  GLASS_PANE: { url: '/game/textures/glass_pane_512.webp', worldSize: 4 }, // curtain-wall window; ALPHA = clear glass, opaque = alu mullions + reflections (mapped once across each window by the glass pass)
  ELEVATOR: { url: '/game/textures/elevator_512.webp', worldSize: 4 }, // dead corporate elevator doors (one door unit per 4-wide car opening)
  WOOD: { url: '/game/textures/wall_wood_512.webp', worldSize: 4 }, // warm wood veneer accent panels (reception / lounge / elevator surrounds)
  CEIL_LUX: { url: '/game/textures/ceiling_lux_512.webp', worldSize: 4 }, // white luminous cornice ceiling (LED cove grid + spots)
  // Decor prop billboards (green-screen art keyed to alpha offline; worldSize is unused by sprites).
  PROP: { url: '/game/props/prop_plant.webp', worldSize: 4 }, // potted lobby plant
  PROP_SCREEN: { url: '/game/props/prop_screen.webp', worldSize: 4 }, // crashed reception monitor
  PROP_TOTEM: { url: '/game/props/prop_totem.webp', worldSize: 4 }, // lobby directory totem
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
        out.set(asset.name, texture);
      }
      loaded += 1;
      onProgress?.(loaded, assets.length);
    }),
  );

  return out;
}
