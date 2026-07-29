This portfolio hides a DOOM-style FPS — a real 3D engine, in the browser, **without Three.js
or WebGL**. No graphics library: a *software renderer* written by hand that computes
every pixel in TypeScript, exactly as id Software did in 1993. The modern twist:
the same pixel comes out of **three interchangeable backends** — a single-thread CPU, a
worker pool, and a WebGPU compute shader — and a test proves they all render **the same image**.

## BSP rendering, 1993-style

The map is compiled into a **BSP** (Binary Space Partitioning) tree: a recursive split of the
plane that gives, for any camera position, the exact order of walls from nearest to
farthest. Rendering is a simple *front-to-back* traversal: walk the tree, project each
wall segment into a vertical column of the screen, texture it, and a per-column
**z-buffer** stops anything already hidden. Zero over-draw, zero object sorting.

```typescript
// one wall wins per screen column x — the nearest unoccluded one
export function renderFrame(map: CompiledMap, cam: Camera, out: Uint8ClampedArray): void {
  walkBspFrontToBack(map.root, cam, (wall) => {
    const col = projectColumn(wall, cam); // screen height = focal / distance

    if (col.depth < zbuffer[col.x]) {
      drawTexturedColumn(out, col, map.textures);
      zbuffer[col.x] = col.depth; // this column is resolved for good
    }
  });
}
```

The projection is DOOM's: a fixed focal distance, a column height inversely
proportional to depth, and a vertical *shear* for looking up/down. Floors and ceilings
are filled in horizontal bands, each row carrying its own world-to-screen scale.

## One backend isn't enough

This `renderFrame` is **pure**: input data, an output pixel buffer, no browser API.
It's the reference — and the last resort. Above it, two accelerators.

The first splits the screen into row bands distributed across a **worker pool**, all wired
to the **same** `SharedArrayBuffer`: the framebuffer is shared without copying. Eight threads, ~4.5 ms
per frame, a sustained 120 fps. The entry price: shared memory requires **COOP/COEP** headers
on *all* responses, otherwise `SharedArrayBuffer` is unavailable and the worker renders a black canvas.

```typescript
// each worker renders its band [rowStart, rowEnd) into the shared framebuffer
renderFrame(map, camera, shared, zbuffer, band.rowStart, band.rowEnd);
```

The second pushes everything onto the **GPU in compute**. The CPU no longer rasterizes there: it
*records* the BSP traversal as per-column command buffers (wall spans, glass layers,
sprites), and a **WGSL** shader executes them in parallel before reading the result back into the
framebuffer. No swap-chain, no WebGL canvas: pure compute, an image returned.

## The same pixel, proven

Three render paths means three chances to diverge. The guarantee rests on a test: render
**the same scene** through the CPU renderer and the WebGPU backend, into two buffers, then compare them.

```typescript
export function diffFrames(a: Uint8ClampedArray, b: Uint8ClampedArray, tol: number): FrameDiff {
  let maxChannelDiff = 0;
  let mismatchCount = 0;

  for (let i = 0; i < a.length; i += 4) {
    // RGB only — alpha carries no visible signal
    for (let c = 0; c < 3; c++) {
      maxChannelDiff = Math.max(maxChannelDiff, Math.abs(a[i + c] - b[i + c]));
    }

    if (Math.abs(a[i] - b[i]) > tol) {
      mismatchCount++;
    }
  }

  return { pixelCount: a.length >> 2, maxChannelDiff, mismatchCount };
}
```

The GPU computes in `f32`, the CPU mixes integers and floats: agreement is *within a tolerance*,
not bit-exact. A Playwright test drives this diff on a real browser and requires less than **2 %**
of pixels out of tolerance. Where `navigator.gpu` doesn't exist — any *headless* CI browser — it
**skips** rather than naively comparing the CPU against itself. Parity isn't a wish; it's
an assertion that runs.

## Degrade gracefully, never a black screen

The stack is a fallback cascade. WebGPU available? Render on the GPU. Otherwise, the
worker pool. No COOP/COEP, so no `SharedArrayBuffer`? The single-thread `renderFrame` runs on the
main thread — slower, but universal. Every browser gets an image; the most
capable gets 120 fps. The software renderer is never a consolation prize: it's both
the foundation that runs everywhere **and** the oracle that keeps the GPU honest.

> Hand-writing a rasterizer in 2026 has nothing nostalgic about it: it's what makes the three
> backends **pixel-comparable**. The CPU defines the truth, the GPU accelerates it, and a test
> refuses to let them diverge.
