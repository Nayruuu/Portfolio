/// <reference lib="webworker" />

import { palettizeRgba } from '../../bsp-engine';

// Texture decoder. The canvas raster, the per-pixel alpha harden and the palette quantization are the
// boot's worst main-thread costs (a species' four sheets back to back drop frames the player feels;
// a lossy 512² WebP quantizes in tens of ms), so they run HERE: fetch → createImageBitmap →
// OffscreenCanvas → harden (atlas mode) → palettize, then the index + palette buffers come back as
// TRANSFERS (zero copy). Two modes:
//  - 'atlas': sprite sheets — cell-height clamp + alpha harden (mirrors `rasterizeAtlas`, keep in step)
//  - 'env':   world surfaces — natural size, NO harden (glass keeps its semi-alpha glints), POT-gated
//             like the main-thread `loadImageTexture` fallback.

const EDGE_ALPHA_THRESHOLD = 140; // MUST match load-textures.ts — a mismatch fringes the sprites differently per machine

interface DecodeRequest {
  readonly id: number;
  readonly url: string;
  readonly mode: 'atlas' | 'env';
  readonly rows: number; // atlas only
  readonly maxCellH: number; // atlas only
  readonly worldSize?: number; // env only — threaded onto the decoded texture
}

const post = (message: unknown, transfer: Transferable[] = []): void =>
  (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<DecodeRequest>): Promise<void> => {
  const { id, url, mode, rows, maxCellH, worldSize } = event.data;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(String(response.status));
    }
    const bitmap = await createImageBitmap(await response.blob());

    if (mode === 'env') {
      const pot = (bitmap.width & (bitmap.width - 1)) === 0 && (bitmap.height & (bitmap.height - 1)) === 0; // prettier-ignore

      if (!pot) {
        throw new Error('non-power-of-two env texture'); // the `& (size−1)` wrap would garble it
      }
    }
    // NEAREST + the same cell-height clamp as the main-thread path, or the two decoders would disagree.
    const scale = mode === 'env' ? 1 : Math.min(1, maxCellH / (bitmap.height / rows));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const context = new OffscreenCanvas(width, height).getContext('2d');

    if (context === null) {
      throw new Error('no 2d context');
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height).data;

    if (mode === 'atlas') {
      for (let i = 3; i < pixels.length; i += 4) {
        pixels[i] = pixels[i] >= EDGE_ALPHA_THRESHOLD ? 255 : 0;
      }
    }
    const tex = palettizeRgba(width, height, pixels, { worldSize });

    post({ id, width, height, pixels: tex.pixels, palette: tex.palette, worldSize }, [
      tex.pixels.buffer,
      tex.palette.buffer,
    ]);
  } catch {
    post({ id, failed: true });
  }
};
