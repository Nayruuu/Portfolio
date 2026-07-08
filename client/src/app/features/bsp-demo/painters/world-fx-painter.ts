import { ARC_DURATION, type Arc, type Impact, type Projectile } from '../../../core/lib';
import { impactEffect, projectileEffect } from '../../../shared/game/effects';
import type { WeaponView } from '../../../shared/game/weapon-view';

// Screen-space projectile painting, mirroring the grid's blitEffect so a shot reads as leaving the weapon:
const PROJECTILE_SCREEN_SCALE = 0.42; // on-screen height = this × effects size, relative to a same-distance wall
const PROJECTILE_MAX_HEIGHT_FRACTION = 0.28; // cap a close shot's height at this fraction of the canvas (no screen-fill)
const PROJECTILE_MAX_DROP_FRACTION = 0.28; // cap how far below the crosshair a close shot rides (toward the weapon)
const PROJECTILE_CROSSHAIR_BLEND = 2; // cells: within this a shot is pulled to the crosshair, so it leaves from centre
const IMPACT_SCREEN_SCALE = 0.9; // on-screen size of an impact burst vs a same-distance wall (mirrors the grid)
const IMPACT_MAX_HEIGHT_FRACTION = 0.5; // cap a point-blank burst at this fraction of the canvas height

/** The internal render resolution + field-of-view the FX are projected against — the component's live `config`,
 *  passed BY REFERENCE (it is mutated in place by the resolution switch), read-only here. */
interface RenderConfig {
  readonly width: number;
  readonly height: number;
  readonly fov: number;
}

/** The camera pose the FX are projected from — the component's live `camera` (mutated in place), read-only here.
 *  A concrete shape (every field present) since the FX always run with a fully-placed camera. */
interface ViewCamera {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly z: number;
  readonly pitch: number;
}

/**
 * The in-world transient combat FX painter: projectiles in flight, impact bursts, and plasma chain-arcs, each
 * drawn SCREEN-SPACE on top of the blitted 3D frame. Stateful only in that it OWNS the two lazily-decoded image
 * caches (one `Image` per projectile / impact kind, reused across frames). The FX arrays themselves stay owned by
 * the component's step loop and are passed BY REFERENCE each call — never copied here.
 */
export class WorldFxPainter {
  private readonly projectileImages = new Map<string, HTMLImageElement>(); // projectile sprite art, lazily decoded
  private readonly impactImages = new Map<string, HTMLImageElement>(); // impact strip sheets, lazily decoded

  /** Paint the in-flight projectiles SCREEN-SPACE, mirroring the grid's `blitEffect`: the sprite face-cameras
   *  at the shot's world point — projected at its actual HEIGHT `z` so it climbs/dives with the firing pitch —
   *  distance-scaled (height capped so a close shot doesn't fill the screen), pulled to the crosshair near the
   *  muzzle, and DROPPED below the aim line (depth-attenuated + capped) so it reads as leaving the weapon. No
   *  wall occlusion (a shot detonates on contact, so it is never behind the wall it heads for). */
  public drawProjectiles(
    ctx: CanvasRenderingContext2D,
    config: RenderConfig,
    camera: ViewCamera,
    projectiles: readonly Projectile[],
    weaponView: WeaponView,
    bob: number,
  ): void {
    if (projectiles.length === 0) {
      return;
    }
    const { width, height, fov } = config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + camera.pitch * (height / 2);
    const cos = Math.cos(camera.angle);
    const sin = Math.sin(camera.angle);
    // The gun's current walk-bob offset — near the muzzle a fresh shot is anchored to the SWAYING barrel tip
    // (centre + this), not the screen centre, so it leaves from where the weapon actually is.
    const sway = weaponView.bobOffset(height, bob);
    const muzzleX = width / 2 + sway.x;

    for (const p of projectiles) {
      const effect = projectileEffect(p.kind);
      const image = imageFromCache(this.projectileImages, p.kind, effect?.sprite);

      if (effect === undefined || image === undefined) {
        continue; // unmapped kind or not decoded yet
      }
      const rx = p.x - camera.x;
      const ry = p.y - camera.y;
      const depth = rx * cos + ry * sin;

      if (depth <= 0.1) {
        continue; // behind the camera
      }
      const side = -rx * sin + ry * cos;
      const drawHeight = Math.min(
        (height / depth) * (PROJECTILE_SCREEN_SCALE * effect.size),
        height * (PROJECTILE_MAX_HEIGHT_FRACTION * effect.size),
      );
      const drawWidth = drawHeight * (effect.width / effect.height);
      const worldScreenX = width / 2 - (side / depth) * focal;
      const blend = Math.max(0, 1 - depth / PROJECTILE_CROSSHAIR_BLEND);
      const screenX = worldScreenX + (muzzleX - worldScreenX) * blend; // near the muzzle → the swaying barrel tip
      const left = screenX - drawWidth * effect.anchorX; // align the sprite's CONTENT centre to the firing line
      const drop = Math.min(height * PROJECTILE_MAX_DROP_FRACTION, (height * effect.drop) / depth);
      const centerY = horizon - ((p.z - camera.z) * focal) / depth; // the shot's actual height on screen

      ctx.drawImage(
        image,
        left,
        centerY - drawHeight / 2 + drop + sway.y * blend,
        drawWidth,
        drawHeight,
      );
    }
  }

  /** Paint each live impact as a WORLD billboard at its hit point: face-camera, distance-scaled, the strip
   *  cell chosen from the impact's `age`. Like the barrels it sits at a true world (x,y,z), so a burst on a
   *  far wall reads small and one on a near barrel large. Drawn on top of the scene (brief bright flashes). */
  public drawImpacts(
    ctx: CanvasRenderingContext2D,
    config: RenderConfig,
    camera: ViewCamera,
    impacts: readonly Impact[],
  ): void {
    if (impacts.length === 0) {
      return;
    }
    const { width, height, fov } = config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + camera.pitch * (height / 2);
    const cos = Math.cos(camera.angle);
    const sin = Math.sin(camera.angle);

    for (const impact of impacts) {
      const effect = impactEffect(impact.kind);
      const image = imageFromCache(this.impactImages, impact.kind, effect?.sheet);

      if (effect === undefined || image === undefined) {
        continue; // unmapped kind or not decoded yet
      }
      const rx = impact.x - camera.x;
      const ry = impact.y - camera.y;
      const depth = rx * cos + ry * sin;

      if (depth <= 0.1) {
        continue; // behind the camera
      }
      const side = -rx * sin + ry * cos;
      const drawHeight = Math.min(
        (height / depth) * (IMPACT_SCREEN_SCALE * effect.size),
        height * IMPACT_MAX_HEIGHT_FRACTION,
      );
      const drawWidth = drawHeight * (effect.frameWidth / effect.frameHeight) * effect.widthScale;
      const screenX = width / 2 - (side / depth) * focal;
      const frame = Math.min(Math.floor(impact.age / effect.frameDuration_s), effect.frames - 1);
      const centerY = horizon - ((impact.z - camera.z) * focal) / depth;

      ctx.drawImage(
        image,
        frame * effect.frameWidth, // source cell — the strip frame for this age
        0,
        effect.frameWidth,
        effect.frameHeight,
        screenX - drawWidth / 2,
        centerY - drawHeight / 2,
        drawWidth,
        drawHeight,
      );
    }
  }

  /** Draw the live chain-lightning arcs, each endpoint projected to the barrel's mid-body. Screen-space, no
   *  wall occlusion — they are brief bright flashes, so an arc crossing a wall edge is acceptable. */
  public drawArcs(
    ctx: CanvasRenderingContext2D,
    config: RenderConfig,
    camera: ViewCamera,
    arcs: readonly Arc[],
  ): void {
    if (arcs.length === 0) {
      return;
    }
    const { width, height, fov } = config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + camera.pitch * (height / 2);
    const cos = Math.cos(camera.angle);
    const sin = Math.sin(camera.angle);
    const project = (x: number, y: number, z: number): { sx: number; sy: number } | null => {
      const rx = x - camera.x;
      const ry = y - camera.y;
      const forward = rx * cos + ry * sin;

      if (forward <= 0.1) {
        return null; // behind the camera
      }
      const side = -rx * sin + ry * cos;

      return {
        sx: width / 2 - (side / forward) * focal,
        sy: horizon - ((z - camera.z) * focal) / forward,
      };
    };

    for (const arc of arcs) {
      const a = project(arc.ax, arc.ay, arc.az);
      const b = project(arc.bx, arc.by, arc.bz);

      if (a === null || b === null) {
        continue;
      }
      strokeArc(ctx, a.sx, a.sy, b.sx, b.sy, Math.max(0, 1 - arc.age / ARC_DURATION));
    }
  }
}

/** The decoded sprite for a kind, from a per-kind cache, lazily kicking off the load (one `Image` per kind,
 *  reused across frames). Returns `undefined` when there is no source, no `Image` (SSR), or it has not decoded
 *  yet (first frames) — the caller then simply draws nothing. Shared by the projectile + impact caches. */
export function imageFromCache(
  cache: Map<string, HTMLImageElement>,
  kind: string,
  src: string | undefined,
): HTMLImageElement | undefined {
  if (src === undefined || typeof Image === 'undefined') {
    return undefined;
  }
  let image = cache.get(kind);

  if (image === undefined) {
    image = new Image();
    image.src = src;
    cache.set(kind, image);
  }

  return image.complete && image.naturalWidth > 0 ? image : undefined;
}

/** Stroke one jagged blue lightning segment (a 3-segment polyline kinked at the thirds, a soft glow under a
 *  bright core, additive), faded by `fade`. Mirrors the grid's plasma arc. */
function strokeArc(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  fade: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  const perpX = -dy / length;
  const perpY = dx / length;
  const jag = Math.min(22, length * 0.16); // perpendicular kink (px), capped on a long segment
  const firstX = ax + dx / 3 + perpX * jag;
  const firstY = ay + dy / 3 + perpY * jag;
  const secondX = ax + (dx * 2) / 3 - perpX * jag;
  const secondY = ay + (dy * 2) / 3 - perpY * jag;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(firstX, firstY);
  ctx.lineTo(secondX, secondY);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = '#2f6bff'; // outer blue glow
  ctx.globalAlpha = fade * 0.4;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = '#cfe0ff'; // bright inner core
  ctx.globalAlpha = fade * 0.9;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}
