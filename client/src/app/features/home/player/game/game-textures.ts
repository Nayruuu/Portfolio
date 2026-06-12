import { KEYCARD_COLORS } from '../../../../core/lib';
import type {
  EnemyKind,
  KeycardColor,
  Palette,
  ProjectileSkin,
  Theme,
  WallStyle,
} from '../../../../core/lib';

/**
 * Procedural game art on offscreen canvases (browser-only, zero asset): per-theme wall textures, floor
 * & ceiling flats, the enemy sprite frames, the pickups/keycards/projectiles, and the exit switch.
 * Theme-invariant raw colours — like the code-block syntax palette, this is art, not UI tokens. Consumed
 * by `GameRenderer`. (The weapon viewmodel is a real WebP sprite now — see `WeaponView`, not here.)
 */
const SIZE = 64;

/** Enemy / pickup / projectile sprite frame size (px). Exported so the renderer's billboard floor-bias
 *  (`4 / ENEMY_SIZE` — the transparent padding below every kind's feet at `baseY = 44`) stays in sync. */
export const ENEMY_SIZE = 48;

/** The three keycard / locked-door tints, keyed by colour (parallel to `KEYCARD_COLORS`). Raw art
 *  colours like the rest of this file — NOT UI tokens (the HUD pips own the token-driven version). */
const KEYCARD_TINTS: Record<KeycardColor, { base: string; light: string; dark: string }> = {
  red: { base: '#c83232', light: '#ff6a5a', dark: '#7a1414' },
  blue: { base: '#2f6fd0', light: '#6fa8ff', dark: '#16356a' },
  yellow: { base: '#d8b020', light: '#ffe070', dark: '#7a6008' },
};

/** All canvases for one theme: walls indexed by wall id, floor flats by floor id, ceiling flats by
 *  ceil id (index 0 is the unsampled sky placeholder). */
export function buildThemeArt(theme: Theme): {
  walls: HTMLCanvasElement[];
  floorFlats: HTMLCanvasElement[];
  ceilFlats: HTMLCanvasElement[];
} {
  return {
    walls: theme.walls.map((wall, id) =>
      id === 0 ? blank() : buildWall(wall.style, wall.palette),
    ),
    floorFlats: theme.floors.map((floor) => buildFlat(floor.palette, floor.glow)),
    ceilFlats: theme.ceils.map((ceil, id) => (id === 0 ? blank() : buildFlat(ceil.palette, false))),
  };
}

/** LOGOUT exit panel: dark monitor/door with a pixel-art power-symbol in green. */
export function buildSwitchTexture(): HTMLCanvasElement {
  const texture = canvas(SIZE, SIZE);
  const ctx = texture.getContext('2d');

  if (!ctx) {
    return texture;
  }
  // Dark casing
  ctx.fillStyle = '#0d1a10';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#122018';
  ctx.fillRect(6, 6, 52, 52);
  // Screen / panel inset
  ctx.fillStyle = '#080f0a';
  ctx.fillRect(10, 10, 44, 44);
  // Power symbol — green
  ctx.fillStyle = '#3ad14a';
  ctx.fillRect(30, 12, 4, 14); // vertical stem
  // Ring (open at top-centre, approximate with eight fillRect segments)
  ctx.fillRect(20, 24, 4, 4); // top-left corner
  ctx.fillRect(16, 28, 4, 10); // left side
  ctx.fillRect(20, 38, 4, 4); // bottom-left corner
  ctx.fillRect(24, 42, 16, 4); // bottom
  ctx.fillRect(40, 38, 4, 4); // bottom-right corner
  ctx.fillRect(44, 28, 4, 10); // right side
  ctx.fillRect(40, 24, 4, 4); // top-right corner
  // Soft ambient glow behind the symbol
  ctx.fillStyle = 'rgba(58, 209, 74, 0.12)';
  ctx.fillRect(12, 18, 40, 32);

  return texture;
}

/** The three locked-door wall textures, indexed by `doorColorIndex` (0 = red, 1 = blue, 2 = yellow).
 *  Procedural placeholders: a coloured steel leaf with a centre seam + a card reader that signals
 *  "tap your badge to open". */
export function buildDoorTextures(): HTMLCanvasElement[] {
  return KEYCARD_COLORS.map((color) => buildDoor(KEYCARD_TINTS[color]));
}

/** The three keycard billboards, indexed by `KEYCARD_COLORS`. Procedural placeholders: a coloured
 *  access card with a magnetic stripe + a chip. */
export function buildKeycards(): HTMLCanvasElement[] {
  return KEYCARD_COLORS.map((color) => buildKeycard(KEYCARD_TINTS[color]));
}

/** One coloured locked-door panel (SIZE×SIZE wall texture). */
function buildDoor(tint: { base: string; light: string; dark: string }): HTMLCanvasElement {
  const texture = canvas(SIZE, SIZE);
  const ctx = texture.getContext('2d');

  if (!ctx) {
    return texture;
  }
  const mid = SIZE / 2;

  // Dark steel jamb, then the coloured door leaf inset into it
  ctx.fillStyle = '#15171c';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = tint.dark;
  ctx.fillRect(6, 4, SIZE - 12, SIZE - 4);
  ctx.fillStyle = tint.base;
  ctx.fillRect(9, 6, SIZE - 18, SIZE - 8);
  // Centre seam (double-leaf hint) + bright top/left bevels
  ctx.fillStyle = tint.dark;
  ctx.fillRect(mid - 1, 6, 2, SIZE - 8);
  ctx.fillStyle = tint.light;
  ctx.fillRect(9, 6, SIZE - 18, 2);
  ctx.fillRect(9, 6, 2, SIZE - 8);
  // Card reader panel — the "locked, needs a badge" cue
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(mid + 6, 26, 12, 16);
  ctx.fillStyle = tint.light;
  ctx.fillRect(mid + 8, 29, 8, 3); // card slot glow
  ctx.fillStyle = '#e8e8ec';
  ctx.fillRect(mid + 9, 36, 6, 2); // status LED row
  // Caution chevrons across the foot
  ctx.fillStyle = tint.light;
  for (let cx = 8; cx < SIZE - 8; cx += 12) {
    ctx.fillRect(cx, SIZE - 8, 6, 4);
  }

  return texture;
}

/** One coloured keycard billboard (ENEMY_SIZE×ENEMY_SIZE, seated low so the renderer's floor-bias
 *  grounds it like a pickup). */
function buildKeycard(tint: { base: string; light: string; dark: string }): HTMLCanvasElement {
  const frame = canvas(ENEMY_SIZE, ENEMY_SIZE);
  const ctx = frame.getContext('2d');

  if (!ctx) {
    return frame;
  }
  const x = 14;
  const y = 18;
  const w = 20;
  const h = 22;

  // Card body with a dark outline
  ctx.fillStyle = tint.dark;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = tint.base;
  ctx.fillRect(x, y, w, h);
  // Magnetic stripe
  ctx.fillStyle = '#1a1a1e';
  ctx.fillRect(x, y + 3, w, 4);
  // Chip + a photo block
  ctx.fillStyle = tint.light;
  ctx.fillRect(x + 3, y + 11, 6, 5);
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(x + 4, y + 12, 4, 3);
  ctx.fillStyle = tint.light;
  ctx.fillRect(x + 12, y + 11, 5, 7);
  // Top edge highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(x, y, w, 2);

  return frame;
}

/** Per-kind office antagonist frames: [idle, throw, death1, death2], each 48×48 chunky pixel-art. */
export function buildEnemyFrames(): Record<EnemyKind, HTMLCanvasElement[]> {
  return {
    manager: [
      drawManager(1, 1, false),
      drawManager(1, 1, true),
      drawManager(0.6, 0.7, false),
      drawManager(0.25, 0.3, false),
    ],
    // Procedural fallback only — `manager` (husk), `middle_manager`, `junior_office_drone` and
    // `security_guard` all render via their directional atlases (`enemy-sprite.ts`); these frames show only
    // until the atlas decodes.
    middle_manager: [
      drawManager(1, 1, false),
      drawManager(1, 1, true),
      drawManager(0.6, 0.7, false),
      drawManager(0.25, 0.3, false),
    ],
    junior_office_drone: [
      drawManager(1, 1, false),
      drawManager(1, 1, true),
      drawManager(0.6, 0.7, false),
      drawManager(0.25, 0.3, false),
    ],
    security_guard: [
      drawManager(1, 1, false),
      drawManager(1, 1, true),
      drawManager(0.6, 0.7, false),
      drawManager(0.25, 0.3, false),
    ],
    printer: [
      drawPrinter(1, 1, false),
      drawPrinter(1, 1, true),
      drawPrinter(0.6, 0.7, false),
      drawPrinter(0.25, 0.3, false),
    ],
    hr: [
      drawHr(1, 1, false),
      drawHr(1, 1, true),
      drawHr(0.6, 0.7, false),
      drawHr(0.25, 0.3, false),
    ],
  };
}

/** Manager: navy suit, white shirt + red tie, peach face, briefcase; throw = envelope raised. */
function drawManager(squash: number, alpha: number, throwing: boolean): HTMLCanvasElement {
  const frame = canvas(ENEMY_SIZE, ENEMY_SIZE);
  const ctx = frame.getContext('2d');

  if (!ctx) {
    return frame;
  }
  ctx.globalAlpha = alpha;
  const cx = ENEMY_SIZE / 2;
  const baseY = 44;
  const bodyH = Math.round(20 * squash);
  const faceH = Math.round(10 * squash);

  if (squash > 0.4) {
    ctx.fillStyle = '#141c30';
    ctx.fillRect(cx - 8, baseY - Math.round(8 * squash), 5, Math.round(8 * squash));
    ctx.fillRect(cx + 3, baseY - Math.round(8 * squash), 5, Math.round(8 * squash));
  }
  ctx.fillStyle = '#1c2740';
  ctx.fillRect(cx - 10, baseY - bodyH - 8, 20, bodyH + 8);
  if (squash > 0.4) {
    ctx.fillStyle = '#e8e8ec';
    ctx.fillRect(cx - 3, baseY - bodyH - 4, 6, bodyH + 2);
    ctx.fillStyle = '#c81a1a';
    ctx.fillRect(cx - 2, baseY - bodyH - 2, 4, bodyH - 2);
  }
  if (!throwing && squash > 0.4) {
    ctx.fillStyle = '#8a6030';
    ctx.fillRect(cx + 10, baseY - bodyH + 2, 8, 8);
    ctx.fillStyle = '#6a4820';
    ctx.fillRect(cx + 12, baseY - bodyH, 4, 3);
  }
  if (squash > 0.3) {
    ctx.fillStyle = '#e8c49a';
    ctx.fillRect(cx - 7, baseY - bodyH - faceH - 8, 14, faceH + 2);
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(cx - 7, baseY - bodyH - faceH - 8, 14, 4);
  }
  if (throwing && squash > 0.4) {
    ctx.fillStyle = '#1c2740';
    ctx.fillRect(cx + 10, baseY - bodyH - 12, 5, 12);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(cx + 8, baseY - bodyH - 16, 10, 6);
    ctx.fillStyle = '#c0b8a8';
    ctx.fillRect(cx + 9, baseY - bodyH - 16, 8, 3);
  }
  ctx.globalAlpha = 1;

  return frame;
}

/** Printer: grey machine body, green LED, paper tray; throw = sheet half-ejected. */
function drawPrinter(squash: number, alpha: number, throwing: boolean): HTMLCanvasElement {
  const frame = canvas(ENEMY_SIZE, ENEMY_SIZE);
  const ctx = frame.getContext('2d');

  if (!ctx) {
    return frame;
  }
  ctx.globalAlpha = alpha;
  const cx = ENEMY_SIZE / 2;
  const baseY = 44; // shared by all four kinds so the renderer's single 4/ENEMY_SIZE floor-bias is exact
  const bodyH = Math.round(24 * squash);

  if (squash > 0.4) {
    ctx.fillStyle = '#6a6e74';
    ctx.fillRect(cx - 10, baseY - Math.round(6 * squash), 6, Math.round(6 * squash));
    ctx.fillRect(cx + 4, baseY - Math.round(6 * squash), 6, Math.round(6 * squash));
  }
  ctx.fillStyle = '#b8bcc2';
  ctx.fillRect(cx - 14, baseY - bodyH - 4, 28, bodyH + 4);
  ctx.fillStyle = '#8a8e96';
  ctx.fillRect(cx - 12, baseY - bodyH, 24, bodyH);
  if (squash > 0.3) {
    ctx.fillStyle = '#3ad14a';
    ctx.fillRect(cx + 6, baseY - bodyH + 4, 4, 4);
  }
  if (squash > 0.4) {
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(cx - 10, baseY - 12, 20, 4);
    ctx.fillStyle = '#f0f0f0';
    const sheetOut = throwing ? 14 : 6;

    ctx.fillRect(cx - 6, baseY - 12 - sheetOut, 12, sheetOut + 2);
  }
  ctx.globalAlpha = 1;

  return frame;
}

/** HR: teal/grey business-casual, lanyard + badge, clipboard; throw = clipboard raised. */
function drawHr(squash: number, alpha: number, throwing: boolean): HTMLCanvasElement {
  const frame = canvas(ENEMY_SIZE, ENEMY_SIZE);
  const ctx = frame.getContext('2d');

  if (!ctx) {
    return frame;
  }
  ctx.globalAlpha = alpha;
  const cx = ENEMY_SIZE / 2;
  const baseY = 44;
  const bodyH = Math.round(20 * squash);
  const faceH = Math.round(10 * squash);

  if (squash > 0.4) {
    ctx.fillStyle = '#3a5050';
    ctx.fillRect(cx - 8, baseY - Math.round(8 * squash), 5, Math.round(8 * squash));
    ctx.fillRect(cx + 3, baseY - Math.round(8 * squash), 5, Math.round(8 * squash));
  }
  ctx.fillStyle = '#4a6460';
  ctx.fillRect(cx - 10, baseY - bodyH - 8, 20, bodyH + 8);
  if (squash > 0.4) {
    ctx.fillStyle = '#e84a1a';
    ctx.fillRect(cx - 1, baseY - bodyH - 4, 2, bodyH - 2);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(cx - 4, baseY - bodyH + 4, 8, 6);
    ctx.fillStyle = '#2060b0';
    ctx.fillRect(cx - 2, baseY - bodyH + 6, 4, 2);
  }
  if (squash > 0.4) {
    const clipX = throwing ? cx - 6 : cx + 10;
    const clipY = throwing ? baseY - bodyH - 18 : baseY - bodyH;

    ctx.fillStyle = '#c8a870';
    ctx.fillRect(clipX, clipY, 10, 12);
    ctx.fillStyle = '#6a4020';
    ctx.fillRect(clipX + 3, clipY - 2, 4, 3);
    ctx.fillStyle = '#e0d8c4';
    ctx.fillRect(clipX + 1, clipY + 2, 8, 8);
  }
  if (squash > 0.3) {
    ctx.fillStyle = '#e8c49a';
    ctx.fillRect(cx - 7, baseY - bodyH - faceH - 8, 14, faceH + 2);
    ctx.fillStyle = '#704a38';
    ctx.fillRect(cx - 7, baseY - bodyH - faceH - 8, 14, 4);
  }
  ctx.globalAlpha = 1;

  return frame;
}

/** Dispatch a wall texture by style, recoloured to the theme's palette. */
function buildWall(style: WallStyle, palette: Palette): HTMLCanvasElement {
  if (style === 'panel') {
    return buildPanelWall(palette);
  }
  if (style === 'plate') {
    return buildPlateWall(palette);
  }

  return buildBrickWall(palette);
}

/** A SIZE×SIZE flat. Non-glow = carpet/lino subtle 4-px noise; glow = lit screen/projector bands. */
function buildFlat(palette: Palette, glow: boolean): HTMLCanvasElement {
  const texture = canvas(SIZE, SIZE);
  const ctx = texture.getContext('2d');

  if (!ctx) {
    return texture;
  }
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Carpet/lino: fine 4-px noise tiles (three-tone threshold for subtle texture)
  for (let y = 0; y < SIZE; y += 4) {
    for (let x = 0; x < SIZE; x += 4) {
      const n = noise(x, y);

      ctx.fillStyle = n > 0.66 ? palette.light : n < 0.33 ? palette.dark : palette.base;
      ctx.fillRect(x, y, 4, 4);
    }
  }
  if (glow) {
    // Screen/projector glow: accent horizontal bands + overall tint
    ctx.fillStyle = palette.accent;
    ctx.globalAlpha = 0.4;
    for (let y = 0; y < SIZE; y += 8) {
      ctx.fillRect(0, y + Math.round(noise(0, y) * 4), SIZE, 2);
    }
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = palette.light;
    ctx.fillRect(0, 0, SIZE, SIZE); // screen wash
    ctx.globalAlpha = 1;
  }

  return texture;
}

/** Whiteboard/tile grid: near-uniform light tiles with 1-px grout lines and a faint top highlight. */
function buildBrickWall(palette: Palette): HTMLCanvasElement {
  const texture = canvas(SIZE, SIZE);
  const ctx = texture.getContext('2d');

  if (!ctx) {
    return texture;
  }
  const tileW = 32;
  const tileH = 16;
  const grout = 1;

  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let row = 0; row * tileH < SIZE; row++) {
    const y = row * tileH;
    const offset = row % 2 === 0 ? 0 : -tileW / 2;

    for (let x = offset; x < SIZE; x += tileW) {
      const col = Math.round((x - offset) / tileW);

      // Tile face — subtle noise keeps tiles distinguishable without looking grungy
      ctx.fillStyle = mix(palette.light, palette.base, noise(row, col) * 0.35);
      ctx.fillRect(x + grout, y + grout, tileW - grout, tileH - grout);
      // Top-edge highlight (whiteboard sheen)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(x + grout, y + grout, tileW - grout, 1);
    }
  }

  return texture;
}

/** Cubicle/glass partition panelling: vertical strip seams with subtle accent glazing bar. */
function buildPanelWall(palette: Palette): HTMLCanvasElement {
  const texture = canvas(SIZE, SIZE);
  const ctx = texture.getContext('2d');

  if (!ctx) {
    return texture;
  }
  const stripW = 16;

  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let col = 0; col < SIZE / stripW; col++) {
    const x = col * stripW;

    // Panel face — toned by noise so adjacent strips differ slightly
    ctx.fillStyle = mix(palette.dark, palette.light, noise(col, 3));
    ctx.fillRect(x + 1, 0, stripW - 2, SIZE);
    // Right-edge seam shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(x + stripW - 2, 0, 2, SIZE);
    // Left-edge seam highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(x + 1, 0, 1, SIZE);
    // Glazing bar / LED accent (faint vertical strip at centre)
    ctx.fillStyle = palette.accent;
    ctx.globalAlpha = 0.2;
    ctx.fillRect(x + stripW / 2 - 1, 4, 2, SIZE - 8);
    ctx.globalAlpha = 1;
  }

  return texture;
}

/** Smooth marble/glass/metal slab: larger 32-px cells, soft vein highlight, single corner detail. */
function buildPlateWall(palette: Palette): HTMLCanvasElement {
  const texture = canvas(SIZE, SIZE);
  const ctx = texture.getContext('2d');

  if (!ctx) {
    return texture;
  }
  const cellW = 32;
  const cellH = 32;

  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let cy = 0; cy < SIZE; cy += cellH) {
    for (let cx = 0; cx < SIZE; cx += cellW) {
      const col = cx / cellW;
      const row = cy / cellH;

      // Slab face — blends toward light with gentle noise variation
      ctx.fillStyle = mix(palette.dark, palette.light, noise(cx, cy) * 0.55 + 0.2);
      ctx.fillRect(cx + 1, cy + 1, cellW - 2, cellH - 2);
      // Subtle gloss vein
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(cx + 4, cy + 4, cellW - 14, 1);
      // Corner accent (brass pin / marble inlay)
      ctx.fillStyle = mix(palette.light, palette.accent, noise(col, row));
      ctx.fillRect(cx + 3, cy + 3, 2, 2);
    }
  }

  return texture;
}

/** Linear-interpolate two #rrggbb colours, `t` in 0..1. */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((value, i) => Math.round(value + (pb[i] - value) * t));

  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Deterministic 0..1 hash (no `Math.random` — keeps the art stable). */
function noise(row: number, column: number): number {
  const value = Math.sin(row * 12.9898 + column * 78.233) * 43758.5453;

  return value - Math.floor(value);
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement('canvas');

  element.width = width;
  element.height = height;

  return element;
}

function blank(): HTMLCanvasElement {
  return canvas(1, 1);
}

/** Per-skin office projectile sprites, each 32×32 chunky pixel-art. `tps` (TPS report), `clip` (binder
 *  clip) and `spread` (staple spray) fall back to the paper wad until their served spin strips decode (see
 *  `drawProjectiles`). */
export function buildProjectiles(): Record<ProjectileSkin, HTMLCanvasElement> {
  return {
    invite: buildInvite(),
    paper: buildPaper(),
    memo: buildMemo(),
    tps: buildPaper(),
    clip: buildPaper(),
    spread: buildPaper(),
  };
}

/** Meeting invite: white envelope with a V flap and a red "!" urgency badge. */
function buildInvite(): HTMLCanvasElement {
  const orb = canvas(32, 32);
  const ctx = orb.getContext('2d');

  if (!ctx) {
    return orb;
  }
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(4, 10, 24, 16); // envelope body
  ctx.fillStyle = '#c8c0b0';
  ctx.fillRect(4, 10, 12, 6); // flap left half
  ctx.fillRect(16, 10, 12, 6); // flap right half
  ctx.fillStyle = '#a0988a';
  ctx.fillRect(12, 14, 8, 4); // V tip
  ctx.fillStyle = '#c81a1a'; // urgency badge
  ctx.fillRect(22, 6, 8, 8);
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(25, 7, 2, 4); // "!" stem
  ctx.fillRect(25, 12, 2, 2); // "!" dot

  return orb;
}

/** Crumpled paper wad: off-white lumpy blob built from offset light/shadow fillRects. */
function buildPaper(): HTMLCanvasElement {
  const orb = canvas(32, 32);
  const ctx = orb.getContext('2d');

  if (!ctx) {
    return orb;
  }
  ctx.fillStyle = '#dcdcd2';
  ctx.fillRect(8, 8, 16, 16); // main blob
  ctx.fillStyle = '#eaeae0';
  ctx.fillRect(6, 6, 10, 10); // lighter offset patch
  ctx.fillStyle = '#c4c4ba';
  ctx.fillRect(16, 14, 8, 10); // shadow right
  ctx.fillRect(10, 18, 8, 6); // shadow bottom
  ctx.fillStyle = '#f0f0e8';
  ctx.fillRect(8, 8, 5, 5); // highlight

  return orb;
}

/** Memo/document: page with grey text lines and a small blue clock (signals slow-debuff). */
function buildMemo(): HTMLCanvasElement {
  const orb = canvas(32, 32);
  const ctx = orb.getContext('2d');

  if (!ctx) {
    return orb;
  }
  ctx.fillStyle = '#eef0f4';
  ctx.fillRect(6, 4, 20, 24); // page
  ctx.fillStyle = '#9a9eaa';
  ctx.fillRect(9, 8, 14, 2); // text line 1
  ctx.fillRect(9, 12, 12, 2); // text line 2
  ctx.fillRect(9, 16, 14, 2); // text line 3
  ctx.fillRect(9, 20, 10, 2); // text line 4
  ctx.fillStyle = '#2a6fd0'; // blue clock face
  ctx.fillRect(18, 18, 10, 10);
  ctx.fillStyle = '#eef0f4';
  ctx.fillRect(22, 20, 2, 4); // hour hand
  ctx.fillRect(22, 20, 4, 2); // minute hand

  return orb;
}

/** Coffee cup (health) + headphones (armor) — each 48×48 chunky pixel-art. (Ammo is no longer a procedural
 *  vitals sprite: it is the descriptor-driven, sprite-strip `AmmoPickup`, drawn by `drawAmmoPickups`.) */
export function buildPickups(): {
  health: HTMLCanvasElement;
  armor: HTMLCanvasElement;
} {
  const health = canvas(ENEMY_SIZE, ENEMY_SIZE);
  const healthCtx = health.getContext('2d');

  if (healthCtx) {
    // Mug body
    healthCtx.fillStyle = '#e8e8ec';
    healthCtx.fillRect(14, 24, 22, 18);
    // Handle — two stacked fillRects forming a C
    healthCtx.fillRect(36, 26, 4, 4);
    healthCtx.fillRect(36, 34, 4, 4);
    // Coffee surface
    healthCtx.fillStyle = '#6f4326';
    healthCtx.fillRect(15, 25, 20, 12);
    // Steam wisps
    healthCtx.fillStyle = 'rgba(220, 220, 230, 0.5)';
    healthCtx.fillRect(18, 17, 2, 7);
    healthCtx.fillRect(24, 15, 2, 9);
    healthCtx.fillRect(30, 17, 2, 7);
  }

  const armor = canvas(ENEMY_SIZE, ENEMY_SIZE);
  const armorCtx = armor.getContext('2d');

  if (armorCtx) {
    // Headband arc
    armorCtx.fillStyle = '#2a2a30';
    armorCtx.fillRect(12, 16, 24, 5); // top band
    armorCtx.fillRect(12, 16, 4, 14); // left arm
    armorCtx.fillRect(32, 16, 4, 14); // right arm
    // Earcups (blocky)
    armorCtx.fillRect(8, 28, 10, 14);
    armorCtx.fillRect(30, 28, 10, 14);
    // Colored accent pads
    armorCtx.fillStyle = '#4a8aff';
    armorCtx.fillRect(10, 30, 6, 10);
    armorCtx.fillRect(32, 30, 6, 10);
  }

  return { health, armor };
}
