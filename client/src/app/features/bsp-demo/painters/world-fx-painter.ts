import { ARC_DURATION, type Arc, type Impact, type Projectile } from '../../../core/lib';
import { impactEffect, projectileEffect } from '../../../shared/game/effects';
import type { WeaponView } from '../../../shared/game/weapon-view';
import type { ViewState } from '../render/view-state';

const PROJECTILE_SCREEN_SCALE = 0.42; // on-screen height = this × effects size, relative to a same-distance wall
const PROJECTILE_MAX_HEIGHT_FRACTION = 0.28;
const PROJECTILE_MAX_DROP_FRACTION = 0.28;
const PROJECTILE_CROSSHAIR_BLEND = 2; // cells: within this a shot is pulled to the crosshair
const IMPACT_SCREEN_SCALE = 0.9;
const IMPACT_MAX_HEIGHT_FRACTION = 0.5;

interface ProjectilesPaint {
  readonly ctx: CanvasRenderingContext2D;
  readonly view: ViewState;
  readonly projectiles: readonly Projectile[];
  readonly weaponView: WeaponView;
  readonly bob: number;
}

interface ImpactsPaint {
  readonly ctx: CanvasRenderingContext2D;
  readonly view: ViewState;
  readonly impacts: readonly Impact[];
}

interface ArcsPaint {
  readonly ctx: CanvasRenderingContext2D;
  readonly view: ViewState;
  readonly arcs: readonly Arc[];
}

/** OWNS the two lazily-decoded image caches (one `Image` per kind, reused across frames). The FX arrays stay
 *  owned by the component's step loop and are passed BY REFERENCE each call — never copied here. */
export class WorldFxPainter {
  private readonly projectileImages = new Map<string, HTMLImageElement>();
  private readonly impactImages = new Map<string, HTMLImageElement>();

  public drawProjectiles(inputs: ProjectilesPaint): void {
    const { ctx, view, projectiles, weaponView, bob } = inputs;

    if (projectiles.length === 0) {
      return;
    }
    const camera = view.camera;
    const { width, height, fov } = view.config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + (camera.pitch ?? 0) * (height / 2);
    const cos = Math.cos(camera.angle);
    const sin = Math.sin(camera.angle);
    const sway = weaponView.bobOffset(height, bob);
    const muzzleX = width / 2 + sway.x;

    for (const p of projectiles) {
      const effect = projectileEffect(p.kind);
      const image = imageFromCache(this.projectileImages, p.kind, effect?.sprite);

      if (effect === undefined || image === undefined) {
        continue; // not decoded yet
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
      const screenX = worldScreenX + (muzzleX - worldScreenX) * blend;
      const left = screenX - drawWidth * effect.anchorX;
      const drop = Math.min(height * PROJECTILE_MAX_DROP_FRACTION, (height * effect.drop) / depth);
      const centerY = horizon - ((p.z - camera.z) * focal) / depth;

      ctx.drawImage(
        image,
        left,
        centerY - drawHeight / 2 + drop + sway.y * blend,
        drawWidth,
        drawHeight,
      );
    }
  }

  public drawImpacts(inputs: ImpactsPaint): void {
    const { ctx, view, impacts } = inputs;

    if (impacts.length === 0) {
      return;
    }
    const camera = view.camera;
    const { width, height, fov } = view.config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + (camera.pitch ?? 0) * (height / 2);
    const cos = Math.cos(camera.angle);
    const sin = Math.sin(camera.angle);

    for (const impact of impacts) {
      const effect = impactEffect(impact.kind);
      const image = imageFromCache(this.impactImages, impact.kind, effect?.sheet);

      if (effect === undefined || image === undefined) {
        continue; // not decoded yet
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
        frame * effect.frameWidth,
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

  /** Screen-space, no wall occlusion on purpose — brief bright flashes, so an arc crossing a wall edge is fine. */
  public drawArcs(inputs: ArcsPaint): void {
    const { ctx, view, arcs } = inputs;

    if (arcs.length === 0) {
      return;
    }
    const camera = view.camera;
    const { width, height, fov } = view.config;
    const focal = width / 2 / Math.tan(fov / 2);
    const horizon = height / 2 + (camera.pitch ?? 0) * (height / 2);
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

/** Lazily kicks off the load; `undefined` when there is no source, no `Image` (SSR), or it has not decoded yet. */
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
  const jag = Math.min(22, length * 0.16);
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
  ctx.strokeStyle = '#2f6bff';
  ctx.globalAlpha = fade * 0.4;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = '#cfe0ff';
  ctx.globalAlpha = fade * 0.9;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}
