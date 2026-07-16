import type { KeycardColor } from '../types';
import atlas from './doom-hud-atlas.json';
import { LoadedImage } from './loaded-image';

/**
 * `DoomHud` — composites the whole DOOM-1993 status bar into one `<canvas>` from the artist's image
 * atlas (`doom-hud-atlas.json` is the single source of every strip order and — now — *normalized* zone
 * rectangle; no pixel coordinate is hardcoded here). The owning component sizes its canvas backing store
 * to the bar's DISPLAYED pixel size, so this class reads `canvas.width`/`height` every frame and resolves
 * each zone from its `0..1` fraction (`zone_px = norm × {W,H}`) — it draws correctly at ANY scale, with
 * the bar filling `(0,0,W,H)`. It absorbs the old `FaceRenderer`: the face mugshot is just one zone.
 *
 * The art ships pre-rendered at three TIERS (native bar widths 2117 / 1270 / 740). Each frame it picks
 * the smallest tier whose native width still covers the displayed width — so the chosen asset is ≥ the
 * display resolution and downscales (never upscales), staying crisp — loads that tier's images once
 * (cached per tier in `tiers`, created lazily on first selection), and derives every strip/face cell
 * size from the LOADED image dimensions (each tier's strips differ, so nothing is hardcoded). Loads are
 * async + browser-only (the `LoadedImage` helper); a tier swap keeps painting the last fully-drawn tier
 * until the new tier's bar decodes, so there is never a blank frame. Nearest-neighbour blitting
 * (`imageSmoothingEnabled = false`, near 1:1) keeps it crisp and free of interpolation fringe.
 *
 * Public API (driven each frame by the component): `setHealth`/`setMental`/`setAmmo`/`setArms`/
 * `setWeapon`/`lookAt`/`onHit`/`addCard`/`clearCards`, then `render(canvas, dt)` advances the grimace
 * timer and repaints **only** when a state signature changed — the signature now folds in the chosen
 * tier + the canvas size, so a resize / tier swap repaints. A late image decode self-heals via `onReady`.
 */

/** Root of the deployed, tiered HUD art (under `client/public/`). The atlas' `file` fields describe the
 *  artist's source layout; only the per-tier folder + filenames below are the served paths. */
const HUD_ROOT = '/game/hud/sizes';

// Atlas slices, read once. Zones are NORMALIZED (`0..1` fractions of the bar); each strip carries its
// glyph order only — its cell size is derived per tier from the loaded image, never hardcoded.
const NORM = atlas.hud_bar.zones_normalized;
const FACES = atlas.faces;
const DIGITS = atlas.digits_red;
const ARMS_GREY = atlas.arms_grey;
const ARMS_YELLOW = atlas.arms_yellow;
const BAR_NATIVE_WIDTH = atlas.hud_bar.size[0];

/** The render tiers, smallest native bar width first (derived from the atlas `sizes` scales, so the bar
 *  width is never restated). Tier selection walks this ascending and takes the first that covers the
 *  displayed width, else the largest. */
const TIERS = Object.entries(atlas.sizes)
  .map(([key, info]) => ({ key, nativeWidth: BAR_NATIVE_WIDTH * info.scale }))
  .sort((first, second) => first.nativeWidth - second.nativeWidth);

/** How long the face holds its "hit" grimace column after a hit before reverting to the gaze frame. */
const HIT_GRIMACE_DURATION = 0.35; // seconds

/** Digit/face glyphs scale to this fraction of their zone height (then clamped to fit the zone width). */
const VALUE_HEIGHT_RATIO = 0.75;

/** A rectangle in bar pixels: a resolved zone, and the sub-rects we derive while laying glyphs out. */
interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One tier's served image paths (the face is tiered too now, with its own per-tier cell size). */
interface TierPaths {
  bar: string;
  face: string;
  digits: string;
  armsGrey: string;
  armsYellow: string;
  cards: Record<KeycardColor, string>;
}

/** One tier's lazily-loaded image set, cached in `DoomHud.tiers` and reused across resizes. `key` is the
 *  atlas tier key (e.g. `x0.6`), used in the dirty-check signature so a tier swap repaints. */
interface TierAssets {
  key: string;
  bar: LoadedImage;
  face: LoadedImage;
  digits: LoadedImage;
  armsGrey: LoadedImage;
  armsYellow: LoadedImage;
  cards: Record<KeycardColor, LoadedImage>;
}

/** Gaze direction the game asks for: −2 far-left · −1 left · 0 centre · +1 right · +2 far-right. */
export type Gaze = -2 | -1 | 0 | 1 | 2;

export class DoomHud {
  // The per-tier asset sets, created + loaded lazily on first selection and cached: a resize that
  // re-selects a tier reuses these images (no re-fetch, no flicker after the first decode).
  private readonly tiers = new Map<string, TierAssets>();

  private healthPct = 100;
  private mentalPct = 0;
  private ammo: number | null = 0; // primary count: a magazine weapon's loaded mag, or a flat weapon's pool. `null` = melee → no digits
  private reserve: number | null = null; // secondary count: a magazine weapon's reserve, drawn smaller + dimmer. `null` = none
  private arms = new Set<number>();
  private gaze: Gaze = 0;
  private hitTimer = 0; // seconds left on the grimace column (0 = show the gaze frame)
  private weapon: HTMLCanvasElement | HTMLImageElement | null = null;
  private heldCards = new Set<KeycardColor>();
  private activeTier?: string; // the tier we last completed a paint with (its art is fully decoded)
  private lastKey = ''; // dirty-check signature of the last paint
  private lastCanvas?: HTMLCanvasElement;

  /** Set the current health (0..100); drives the right-aligned red digits + the face row. */
  public setHealth(percent: number): void {
    this.healthPct = percent;
  }

  /** Set the current "mental" gauge (0..100); drawn as right-aligned red digits in the mental zone. */
  public setMental(percent: number): void {
    this.mentalPct = percent;
  }

  /** Set the ammo readout. `mag` is the loaded count — a magazine weapon's chambered rounds, or a flat-pool
   *  weapon's pool — or `null` for an ammo-less (melee) weapon (the bay then shows the icon only, no digits).
   *  `reserve` is the OPTIONAL second count (a magazine weapon's remaining pool): when present the bay reads
   *  "loaded / reserve" as one slash fraction (e.g. 40/120); omit it (or pass `null`) for a flat-pool / melee
   *  weapon, which then shows the single count with no slash. Big right-aligned red digits along the bay bottom. */
  public setAmmo(mag: number | null, reserve: number | null = null): void {
    this.ammo = mag;
    this.reserve = reserve;
  }

  /** Set which weapons (1..8) are owned; an owned slot uses the yellow strip, the rest grey. */
  public setArms(owned: number[]): void {
    this.arms = new Set(owned);
  }

  /** Aim the face gaze (−2 far-left … +2 far-right); selects the face column on the next `render`. */
  public lookAt(gaze: Gaze): void {
    this.gaze = gaze;
  }

  /** Flash the face "hit" grimace column for `HIT_GRIMACE_DURATION`, overriding the gaze until it ends. */
  public onHit(): void {
    this.hitTimer = HIT_GRIMACE_DURATION;
  }

  /** Set the weapon icon drawn in the upper weapon zone (a framed placeholder when `null`). */
  public setWeapon(icon: HTMLCanvasElement | HTMLImageElement | null): void {
    this.weapon = icon;
  }

  /** Mark a keycard colour as held — its card art shows in the matching card zone. */
  public addCard(color: KeycardColor): void {
    this.heldCards.add(color);
  }

  /** Drop every held keycard (fresh-run reset only — badges persist across floors and death). */
  public clearCards(): void {
    this.heldCards.clear();
  }

  /** Advance the grimace timer by `dt` (seconds), then repaint the whole bar — but only when the state
   *  signature changed since the last paint (which folds in the chosen tier + the backing-store size, so
   *  a resize / tier swap repaints) or an image just loaded (via `repaint`). Reads `canvas.width`/
   *  `height` to resolve every zone from its normalized fraction; transparent until a tier's bar decodes. */
  public render(canvas: HTMLCanvasElement, dt: number): void {
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.lastCanvas = canvas;
    const width = canvas.width;
    const height = canvas.height;

    if (width < 1 || height < 1) {
      return; // a 0-size backing store (not laid out yet) — the next frame / resize will paint it
    }
    const assets = this.drawableTier(width);

    if (!assets) {
      return; // no tier's bar decoded yet → leave the canvas transparent (SSR also lands here)
    }
    const key = this.signature(assets.key, width, height);

    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return;
    }
    // Smooth scaling: blends the digit art's glossy speckles instead of magnifying them into harsh
    // light dots at large (fullscreen) sizes. Safe now that every transparent pixel's RGB is black, so
    // edge interpolation pulls toward black (invisible on the dark bar), never white.
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    this.paint(ctx, assets, width, height);
  }

  /** Kick off the tier's decodes now, WITHOUT drawing: LoadedImage only fetches on its first ready(),
   *  so a bar first painted when the loading card lifts is a bar missing from the player's first seconds.
   *  The card must warm it, never show it. */
  public preload(width: number): void {
    const assets = this.ensureTier(this.selectTierKey(width));

    assets.bar.ready();
    assets.face.ready();
    assets.digits.ready();
    assets.armsGrey.ready();
    assets.armsYellow.ready();
    assets.cards.red.ready();
    assets.cards.blue.ready();
    assets.cards.yellow.ready();
  }

  /** Force the next `render` to repaint (an image just decoded) and re-run it on the last canvas. */
  private repaint(): void {
    this.lastKey = '';
    if (this.lastCanvas) {
      this.render(this.lastCanvas, 0);
    }
  }

  /** Resolve which tier's assets to draw this frame: the selected tier once its bar is decoded (also
   *  marked active), else the last fully-drawn tier (its art is all decoded — kept until the new tier's
   *  bar is ready, so no blank frame), else `undefined` while nothing has decoded. Triggers the selected
   *  tier's loads on the way (browser-only; SSR no-ops). */
  private drawableTier(width: number): TierAssets | undefined {
    const wanted = this.ensureTier(this.selectTierKey(width));
    const bar = wanted.bar.ready();

    wanted.face.ready();
    wanted.digits.ready();
    wanted.armsGrey.ready();
    wanted.armsYellow.ready();
    if (bar) {
      this.activeTier = wanted.key;

      return wanted;
    }
    if (this.activeTier !== undefined && this.activeTier !== wanted.key) {
      const previous = this.tiers.get(this.activeTier);

      if (previous?.bar.ready()) {
        return previous; // keep painting the old tier until the new tier's bar decodes
      }
    }

    return undefined;
  }

  /** The smallest tier whose native bar width still covers `width` (≥ display → crisp downscale), else
   *  the largest tier (don't upscale past the biggest asset). */
  private selectTierKey(width: number): string {
    const covering = TIERS.find((tier) => tier.nativeWidth >= width);

    return (covering ?? TIERS[TIERS.length - 1]).key;
  }

  /** Get-or-create the cached `LoadedImage` set for a tier (lazy: the art is only fetched once the tier
   *  is first selected). Each image's `onReady` forces a repaint, so a late decode self-heals. */
  private ensureTier(key: string): TierAssets {
    const cached = this.tiers.get(key);

    if (cached) {
      return cached;
    }
    const paths = tierPaths(key);
    const repaint = (): void => this.repaint();
    const assets: TierAssets = {
      key,
      bar: new LoadedImage(paths.bar, repaint),
      face: new LoadedImage(paths.face, repaint),
      digits: new LoadedImage(paths.digits, repaint),
      armsGrey: new LoadedImage(paths.armsGrey, repaint),
      armsYellow: new LoadedImage(paths.armsYellow, repaint),
      cards: {
        red: new LoadedImage(paths.cards.red, repaint),
        blue: new LoadedImage(paths.cards.blue, repaint),
        yellow: new LoadedImage(paths.cards.yellow, repaint),
      },
    };

    this.tiers.set(key, assets);

    return assets;
  }

  /** A compact string that changes whenever anything visible changes — the dirty-check key. Folds in the
   *  drawn tier + the backing-store size so a tier swap / resize forces a repaint. */
  private signature(tierKey: string, width: number, height: number): string {
    return [
      tierKey,
      width,
      height,
      Math.round(this.healthPct),
      Math.round(this.mentalPct),
      this.ammo === null ? 'none' : Math.round(this.ammo),
      this.reserve === null ? 'none' : Math.round(this.reserve),
      [...this.arms].sort((first, second) => first - second).join(','),
      this.gaze,
      this.hitTimer > 0 ? 1 : 0,
      this.weapon ? 1 : 0,
      [...this.heldCards].sort().join(','),
    ].join('|');
  }

  /** Composite the bar + every overlay for `assets` at the current backing-store size: the bar fills
   *  `(0,0,W,H)`, then each zone is resolved from its normalized fraction × `W,H`. */
  private paint(
    ctx: CanvasRenderingContext2D,
    assets: TierAssets,
    width: number,
    height: number,
  ): void {
    const bar = assets.bar.ready();

    if (!bar) {
      return; // already guaranteed by `drawableTier`; keeps the type narrow
    }
    ctx.drawImage(bar, 0, 0, width, height);
    this.drawValue(ctx, assets, this.healthPct, scaleZone(NORM.health, width, height));
    this.drawValue(ctx, assets, this.mentalPct, scaleZone(NORM.mental, width, height));
    this.drawFace(ctx, assets, scaleZone(NORM.face, width, height));
    this.drawArms(ctx, assets, scaleZone(NORM.arms, width, height));
    this.drawWeapon(ctx, assets, scaleZone(NORM.weapon, width, height));
    this.drawCards(ctx, assets, width, height);
  }

  /** Draw a percentage value (digits + the `pct` glyph) right-aligned in `zone`. */
  private drawValue(
    ctx: CanvasRenderingContext2D,
    assets: TierAssets,
    value: number,
    zone: Zone,
  ): void {
    const sheet = assets.digits.ready();

    if (!sheet) {
      return;
    }
    const cellW = sheet.naturalWidth / DIGITS.order.length;
    const glyphs = [...String(Math.round(this.clampPct(value))).split(''), '%'];

    this.drawGlyphs(
      ctx,
      sheet,
      cellW,
      sheet.naturalHeight,
      DIGITS.order,
      glyphs,
      zone,
      zone.h * VALUE_HEIGHT_RATIO,
    );
  }

  /** Blit a right-aligned glyph run from a horizontal strip, scaled to `glyphH` but clamped so the whole
   *  run fits the zone width, vertically centred. Each glyph maps to its strip cell via `order`. */
  private drawGlyphs(
    ctx: CanvasRenderingContext2D,
    sheet: HTMLImageElement,
    cellW: number,
    cellH: number,
    order: string[],
    glyphs: string[],
    zone: Zone,
    glyphH: number,
  ): void {
    const ratio = cellW / cellH;
    const rightPad = zone.w * 0.04;
    const drawW = Math.min(glyphH * ratio, (zone.w - rightPad) / glyphs.length);
    const drawH = drawW / ratio;
    const y = zone.y + (zone.h - drawH) / 2;
    let x = zone.x + zone.w - rightPad;

    for (let glyphIndex = glyphs.length - 1; glyphIndex >= 0; glyphIndex--) {
      const idx = order.indexOf(glyphName(glyphs[glyphIndex]));

      if (idx < 0) {
        continue;
      }
      x -= drawW;
      ctx.drawImage(sheet, idx * cellW, 0, cellW, cellH, x, y, drawW, drawH);
    }
  }

  /** Blit the face cell: row from health (full → near-death), column from the gaze (or the hit column
   *  while the grimace timer is live), contain-fitted into the face zone. Cell size is derived from the
   *  loaded face sheet (each tier's face has its own cell). */
  private drawFace(ctx: CanvasRenderingContext2D, assets: TierAssets, zone: Zone): void {
    const sheet = assets.face.ready();

    if (!sheet) {
      return;
    }
    const cellW = sheet.naturalWidth / FACES.cols;
    const cellH = sheet.naturalHeight / FACES.rows;
    const row = Math.round(((100 - this.clampPct(this.healthPct)) / 100) * (FACES.rows - 1));
    const center = FACES.col_order.indexOf('look_center');
    const hit = FACES.col_order.indexOf('hit');
    const col = this.hitTimer > 0 ? hit : center + this.gaze;

    this.contain(ctx, sheet, col * cellW, row * cellH, cellW, cellH, zone);
  }

  /** Blit weapons 1..8 in a 4×2 grid (1-4 top, 5-8 bottom): the yellow strip when owned, else grey. Each
   *  strip's cell width is derived from its own loaded image. */
  private drawArms(ctx: CanvasRenderingContext2D, assets: TierAssets, zone: Zone): void {
    const grey = assets.armsGrey.ready();
    const yellow = assets.armsYellow.ready();
    const cols = 4;
    const slotW = zone.w / cols;
    const slotH = zone.h / 2;

    for (let slotNumber = 1; slotNumber <= 8; slotNumber++) {
      const owned = this.arms.has(slotNumber);
      const sheet = owned ? yellow : grey;
      const strip = owned ? ARMS_YELLOW : ARMS_GREY;

      if (!sheet) {
        continue;
      }
      const idx = strip.order.indexOf(String(slotNumber));

      if (idx < 0) {
        continue;
      }
      const cellW = sheet.naturalWidth / strip.order.length;
      const slot: Zone = {
        x: zone.x + ((slotNumber - 1) % cols) * slotW,
        y: zone.y + Math.floor((slotNumber - 1) / cols) * slotH,
        w: slotW,
        h: slotH,
      };

      this.contain(ctx, sheet, idx * cellW, 0, cellW, sheet.naturalHeight, slot);
    }
  }

  /** Contain-fit the weapon icon into the bay — the FULL bay for an ammo-less (melee) weapon, else the
   *  upper ~70 % (reserving the lower zone for the ammo digits). Placeholder when no icon is set. */
  private drawWeapon(ctx: CanvasRenderingContext2D, assets: TierAssets, zone: Zone): void {
    const iconZone: Zone =
      this.ammo === null ? zone : { x: zone.x, y: zone.y, w: zone.w, h: zone.h * 0.7 };

    if (this.weapon) {
      this.contain(ctx, this.weapon, 0, 0, this.weapon.width, this.weapon.height, iconZone);
    } else {
      this.placeholder(ctx, iconZone);
    }
    if (this.ammo === null) {
      return; // an ammo-less melee weapon — the bay shows the icon only, no ammo digits
    }
    const sheet = assets.digits.ready();

    if (!sheet) {
      return;
    }
    const cellW = sheet.naturalWidth / DIGITS.order.length;
    const lower: Zone = { x: zone.x, y: zone.y + zone.h * 0.7, w: zone.w, h: zone.h * 0.3 };

    // Ammo readout in the lower bay: a magazine weapon reads "loaded / reserve" as a single slash fraction
    // (e.g. 40/120 — what's chambered over the type's remaining pool); a flat-pool weapon shows just its pool
    // count (no reserve → no slash). Big red digits, right-aligned, auto-shrinking to fit the extra glyphs.
    const mag = String(Math.round(Math.max(0, this.ammo))).split('');
    const glyphs =
      this.reserve === null
        ? mag
        : [...mag, '/', ...String(Math.round(Math.max(0, this.reserve))).split('')];

    this.drawGlyphs(
      ctx,
      sheet,
      cellW,
      sheet.naturalHeight,
      DIGITS.order,
      glyphs,
      lower,
      lower.h * 0.8,
    );
  }

  /** Contain-fit each held keycard's art into its card zone (resolved from the normalized fractions). */
  private drawCards(
    ctx: CanvasRenderingContext2D,
    assets: TierAssets,
    width: number,
    height: number,
  ): void {
    const cardZones: Record<KeycardColor, Zone> = {
      red: scaleZone(NORM.card_red, width, height),
      blue: scaleZone(NORM.card_blue, width, height),
      yellow: scaleZone(NORM.card_yellow, width, height),
    };

    for (const color of this.heldCards) {
      const sheet = assets.cards[color].ready();

      if (!sheet) {
        continue;
      }
      this.contain(ctx, sheet, 0, 0, sheet.naturalWidth, sheet.naturalHeight, cardZones[color]);
    }
  }

  /** A simple framed placeholder for the weapon zone when no icon is set. */
  private placeholder(ctx: CanvasRenderingContext2D, zone: Zone): void {
    const inset = Math.min(zone.w, zone.h) * 0.12;
    const x = zone.x + inset;
    const y = zone.y + inset;
    const w = zone.w - inset * 2;
    const h = zone.h - inset * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(220, 220, 220, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  /** Aspect-preserving (contain) blit of source rect `(sx,sy,sw,sh)`, centred inside `zone`. */
  private contain(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    zone: Zone,
  ): void {
    const ratio = sw / sh;
    const byHeight = zone.w / zone.h > ratio;
    const drawW = byHeight ? zone.h * ratio : zone.w;
    const drawH = byHeight ? zone.h : zone.w / ratio;
    const dx = zone.x + (zone.w - drawW) / 2;
    const dy = zone.y + (zone.h - drawH) / 2;

    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, drawW, drawH);
  }

  private clampPct(value: number): number {
    return Math.max(0, Math.min(100, value));
  }
}

/** The served image paths for one tier folder (e.g. `x0.6`). The face is now tiered too (its own cell). */
function tierPaths(tier: string): TierPaths {
  const base = `${HUD_ROOT}/${tier}`;

  return {
    bar: `${base}/hud_bar.webp`,
    face: `${base}/face.webp`,
    digits: `${base}/digits/digits_red_strip.webp`,
    armsGrey: `${base}/digits/arms_grey_strip.webp`,
    armsYellow: `${base}/digits/arms_yellow_strip.webp`,
    cards: {
      red: `${base}/cards/card_red.webp`,
      blue: `${base}/cards/card_blue.webp`,
      yellow: `${base}/cards/card_yellow.webp`,
    },
  };
}

/** Every served HUD image across ALL tiers (bar / face / digits / arms / keycards) — for the asset preloader.
 *  The HUD picks one tier at runtime by display size, but the loading screen warms them all so a tier swap on
 *  resize never flickers either. */
export function hudAssetUrls(): string[] {
  return TIERS.flatMap(({ key }) => {
    const paths = tierPaths(key);

    return [
      paths.bar,
      paths.face,
      paths.digits,
      paths.armsGrey,
      paths.armsYellow,
      ...Object.values(paths.cards),
    ];
  });
}

/** Resolve a normalized zone (`0..1` fractions of the bar) to bar pixels for a `width`×`height` store. */
function scaleZone(norm: Zone, width: number, height: number): Zone {
  return { x: norm.x * width, y: norm.y * height, w: norm.w * width, h: norm.h * height };
}

/** Map a displayed character to its strip-`order` name: `%` → `pct`, `/` → `slash`, else itself. */
function glyphName(glyph: string): string {
  if (glyph === '%') {
    return 'pct';
  }
  if (glyph === '/') {
    return 'slash';
  }

  return glyph;
}
