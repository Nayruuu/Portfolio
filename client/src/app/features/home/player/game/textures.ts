import { WALL_HEIGHT } from '../../../../core/lib';
import manifest from './textures.json';

/**
 * The data-driven ENVIRONMENT-TEXTURE bridge — a typed surface over `textures.json`, exactly as
 * `effects.ts` bridges `effects.json`. It feeds the level renderer the tileable surface textures, resolving
 * the manifest `defaults` (nearest filtering) and the served `file` URL; the renderer loads the art and
 * samples it per the `tile` rule. An entry marked `present: false` (a planned variant whose art is not yet
 * generated) is SKIPPED — its `id`/`surface` simply resolve to `undefined`, so the renderer falls back to
 * the base texture until the art is dropped in and `present` flipped. Pure descriptor module (no DOM).
 */

/** Tiling rule. `horizontal` repeats along U only (a full-height wall panel, never tiled on V); `both`
 *  repeats on U and V (a ceiling/floor field); `none` is a UNIQUE segment placed once, never repeated. */
export type TileMode = 'horizontal' | 'both' | 'none';

/** The raw shape of a `textures.json` entry before narrowing — `tile` arrives as a widened `string`; the
 *  per-entry flags (`present`, `has_alpha`, `emissive`) are optional. */
interface RawTexture {
  id: string;
  surface: string;
  file: string;
  size: number[];
  tile: string;
  present?: boolean;
  has_alpha?: boolean;
  emissive?: boolean;
}

/** One PRESENT environment texture, parsed with the manifest `defaults` folded in — the pure descriptor the
 *  renderer reads (the art itself is loaded by its served `file` URL). */
export interface EnvTexture {
  id: string; // unique texture id (e.g. `wall_cubicle`) — the variant key the renderer selects by
  surface: string; // 'wall' | 'ceiling' | 'floor' | 'glass_partition' | 'glass_window' | 'wall_door' — the surface KIND
  file: string; // served WebP URL (`/game/textures/<file>`)
  width: number; // source pixel width (drives the tile aspect)
  height: number; // source pixel height
  tile: TileMode;
  hasAlpha: boolean; // a transparent texture (glass) → drawn in a back-to-front alpha pass, depth-write off
  emissive: boolean; // full-bright (LEDs / screens / live tubes baked in) → the renderer skips depth fog on it
  nearest: boolean; // nearest-neighbour sampling (retro pixel art) vs smooth bilinear
}

const DEFAULT_FILTER = manifest.defaults.filter;
const RAW_TEXTURES = manifest.textures as readonly RawTexture[];

/** `textures.json` → typed `EnvTexture[]`: entries with `present: false` are dropped (their art isn't
 *  generated yet), the rest get the `defaults` folded in and the `file` resolved to a served URL. */
export const ENV_TEXTURES: readonly EnvTexture[] = RAW_TEXTURES.filter(
  (raw) => raw.present !== false,
).map((raw) => ({
  id: raw.id,
  surface: raw.surface,
  file: `/game/${raw.file}`,
  width: raw.size[0],
  height: raw.size[1],
  tile: raw.tile === 'both' ? 'both' : raw.tile === 'none' ? 'none' : 'horizontal',
  hasAlpha: raw.has_alpha ?? false,
  emissive: raw.emissive ?? false,
  nearest: DEFAULT_FILTER === 'nearest',
}));

/** The PRESENT texture with this exact `id` (e.g. `'wall_cubicle'`), or `undefined` if it is absent /
 *  not yet generated — the renderer then falls back to the base surface texture. */
export function textureById(id: string): EnvTexture | undefined {
  return ENV_TEXTURES.find((texture) => texture.id === id);
}

/** The first PRESENT texture dressing `surface` (e.g. `'wall'`), or `undefined` if none is declared yet. */
export function textureForSurface(surface: string): EnvTexture | undefined {
  return ENV_TEXTURES.find((texture) => texture.surface === surface);
}

/** World width (in cells) one horizontal tile spans so its pixels stay SQUARE: the texture's aspect ratio
 *  scaled by the wall's world height. A 2:1 panel on a `WALL_HEIGHT` (1.4) wall tiles every 2.8 cells, so
 *  the riveted panels read at their true proportions instead of being squashed into a single cell. Falls
 *  back to `WALL_HEIGHT` (a 1:1 tile, per-cell) when no texture is given. */
export function wallTileWorldWidth(texture: EnvTexture | undefined): number {
  return texture ? (texture.width / texture.height) * WALL_HEIGHT : WALL_HEIGHT;
}

/** The base wall texture's square-pixel horizontal tile width — the constant the renderer scales wall UVs by. */
export const WALL_TILE_WORLD_WIDTH = wallTileWorldWidth(textureForSurface('wall'));

/** The served URL of the door-open ANIMATION strip — an anim asset (not a tileable manifest surface), so it
 *  lives beside the door textures but carries no manifest entry. Derived from the `wall_door` file's served
 *  directory so the path is stated once (the renderer + the asset preloader both read it). */
export const DOOR_OPEN_STRIP_URL = `${
  textureById('wall_door')?.file.replace(/[^/]+$/, '') ?? '/game/textures/'
}door_open_strip.webp`;

/** World size (cells) of one `tile: both` floor/ceiling tile — matched to the WALL's texels-per-cell so
 *  floor, ceiling and walls all share a uniform pixel density (no surface looks higher- or lower-res than
 *  its neighbours). Derived generically from the texture widths; falls back to the wall tile width. */
export const FLAT_TILE_WORLD_SIZE = flatTileWorldSize(
  textureForSurface('floor') ?? textureForSurface('ceiling'),
);

function flatTileWorldSize(flat: EnvTexture | undefined): number {
  const wall = textureForSurface('wall');

  return flat && wall ? (flat.width / wall.width) * WALL_TILE_WORLD_WIDTH : WALL_TILE_WORLD_WIDTH;
}
