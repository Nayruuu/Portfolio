This portfolio hides a DOOM-style FPS, a real 3D engine in the browser, **without Three.js
or WebGL**. No graphics library: a hand-written *software renderer* that computes
each pixel in TypeScript, exactly the way id Software did it in 1993.

The modern part: the same pixel comes out of **three interchangeable backends** (a single-thread CPU,
a worker pool, a WebGPU compute shader), and a test proves they all render
**the same image**.

## BSP rendering, 1993-style

The map is compiled into a **BSP** (Binary Space Partitioning) tree: a recursive partitioning of the
plane that gives, for any camera position, the exact order of walls from nearest
to farthest.

Rendering is a simple *front-to-back* traversal: walk the tree, project each
wall segment into a vertical column of the screen, texture it, and a per-column **z-buffer**
stops anything that's already hidden. There's no over-draw or object sorting.

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
It's the reference, and also the last resort. On top of it, two accelerators.

The first splits the screen into row bands distributed across a **worker pool**, all wired
to the **same** `SharedArrayBuffer`: the framebuffer is shared without copying. Eight threads, ~4.5 ms
per frame, a steady 120 fps. The cost of entry: shared memory requires **COOP/COEP** headers
on *every* response, otherwise `SharedArrayBuffer` is unavailable and the worker renders a black canvas.

```typescript
// each worker renders its band [rowStart, rowEnd) into the shared framebuffer
renderFrame(map, camera, shared, zbuffer, band.rowStart, band.rowEnd);
```

The second pushes everything to the **GPU in compute**. The CPU no longer rasterizes there: it *records*
the BSP traversal as per-column command buffers (wall spans, glass layers,
sprites), and a **WGSL** shader executes them in parallel before reading the result back into the
framebuffer. No swap chain or WebGL canvas: pure compute, and an image in return.

## The same pixel, proven

Three render paths also means three implementations that can diverge. The guarantee
rests on a test: render **the same scene** via the CPU renderer and the WebGPU backend, into two
buffers, then compare them.

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
not bit-exact.

A Playwright test runs this diff on a real browser and requires fewer than **2%** of pixels
out of tolerance. Where `navigator.gpu` doesn't exist (any *headless* CI browser), it
**skips** rather than naively comparing the CPU to itself. Parity is an assertion that
runs.

## Degrade without ever going black

The stack is a fallback cascade. If WebGPU is available, rendering starts on the GPU.
Otherwise, the worker pool takes over. And without COOP/COEP, hence without `SharedArrayBuffer`, there's
still the single-thread `renderFrame` on the main thread: slower, but universal.

Every browser gets an image; the most capable holds 120 fps. The software renderer serves
two roles: the baseline that runs everywhere, and the reference that the parity test pits against the GPU.

> Rewriting a rasterizer by hand in 2026 serves a specific goal: making the three backends
> **pixel-comparable**. The CPU defines the truth, the GPU accelerates it, and a test refuses to
> let them diverge.
