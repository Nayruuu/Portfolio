/// <reference lib="webworker" />

// Sprite-sheet decoder. The canvas raster + the per-pixel alpha harden are the boot's worst main-thread
// cost (a species' four sheets back to back drop frames the player feels), so they run HERE: fetch →
// createImageBitmap → OffscreenCanvas → harden, then the pixel buffer comes back as a TRANSFER (zero copy).
// Mirrors `rasterizeAtlas` in load-textures.ts — the main-thread fallback when workers/OffscreenCanvas
// are unavailable. Keep the two in step.

const EDGE_ALPHA_THRESHOLD = 140; // MUST match load-textures.ts — a mismatch fringes the sprites differently per machine

interface DecodeRequest {
  readonly id: number;
  readonly url: string;
  readonly rows: number;
  readonly maxCellH: number;
}

const post = (message: unknown, transfer: Transferable[] = []): void =>
  (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<DecodeRequest>): Promise<void> => {
  const { id, url, rows, maxCellH } = event.data;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(String(response.status));
    }
    const bitmap = await createImageBitmap(await response.blob());
    // NEAREST + the same cell-height clamp as the main-thread path, or the two decoders would disagree.
    const scale = Math.min(1, maxCellH / (bitmap.height / rows));
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

    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = pixels[i] >= EDGE_ALPHA_THRESHOLD ? 255 : 0;
    }
    post({ id, width, height, pixels }, [pixels.buffer]);
  } catch {
    post({ id, failed: true });
  }
};
