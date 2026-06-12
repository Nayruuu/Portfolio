import {
  barrelTexture,
  brickTexture,
  ceilTexture,
  floorTexture,
  metalTexture,
  type Texture,
} from '../../core/lib/bsp-engine';
import { projectileEffect } from '../../shared/game/effects';

/** The procedural fallback library (no assets needed) — what renders before, or instead of, the WebP art. */
export function proceduralTextures(): Map<string, Texture> {
  return new Map<string, Texture>([
    ['BRICK', brickTexture()],
    ['METAL', metalTexture()],
    ['FLOOR', floorTexture()],
    ['STEP', metalTexture()],
    ['CEIL', ceilTexture()],
    ['BARREL', barrelTexture()],
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
