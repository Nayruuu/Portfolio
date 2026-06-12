/**
 * Convert every served game PNG under `public/game/` to WebP (then delete the PNG), shrinking the in-player
 * game's image payload — the dominant cost of the first load. Reference paths are updated separately by a
 * `.png → .webp` sweep over the manifests + bridges; this script only touches the binary assets.
 *
 * Per-bucket quality:
 *  • textures/  — lossy q82 (tiled wall/floor/ceiling surfaces tolerate it; the biggest deletable variants live here),
 *  • hud/       — LOSSLESS (crisp digits / face / bars where a lossy edge would show),
 *  • everything else (enemies, weapons, effects, ammo, hands) — lossy q90 (near-transparent on these large
 *    painted sprites, with alpha preserved; the enemy silhouette is re-binarised by `hardenEdges` anyway).
 *
 * Run via `make optimize-game-art` (or `node scripts/optimize-game-art.mjs`). Idempotent-ish: a PNG with an
 * existing newer WebP sibling is reconverted; already-deleted PNGs are simply absent.
 */
import sharp from 'sharp';
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'public/game';

/** Every `.png` under `ROOT`, recursively. */
function pngFiles(dir) {
  const out = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...pngFiles(path));
    } else if (entry.name.toLowerCase().endsWith('.png')) {
      out.push(path);
    }
  }

  return out;
}

/** The sharp WebP options for a given served path (bucketed by directory). */
function webpOptions(path) {
  if (path.includes('/textures/')) {
    return { quality: 82, effort: 6 };
  }
  if (path.includes('/hud/')) {
    return { lossless: true, effort: 6 };
  }

  return { quality: 90, effort: 6, alphaQuality: 100 };
}

const files = pngFiles(ROOT);
let before = 0;
let after = 0;

for (const png of files) {
  const webp = png.replace(/\.png$/i, '.webp');

  before += statSync(png).size;
  await sharp(png).webp(webpOptions(png)).toFile(webp);
  after += statSync(webp).size;
  rmSync(png);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

console.log(
  `optimize-game-art: ${files.length} PNG → WebP   ${mb(before)} MB → ${mb(after)} MB   (−${(
    (1 - after / before) *
    100
  ).toFixed(0)}%)`,
);
