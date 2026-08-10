This portfolio embeds a playable FPS in a hidden tab. Behind it, a DOOM-style 3D engine
written by hand, without Three.js or WebGL: a *software renderer* that computes every pixel in
TypeScript, exactly the way id Software did it in 1993. The default internal resolution is
1280×720, the field of view 90°, and none of it goes through a classic hardware graphics
pipeline.

The constraint I set for myself lies elsewhere. The same engine powers a CPU backend distributed
across multiple threads and a WebGPU compute backend, and a test proves that both render the
same image, within two levels per channel. This parity is the whole reason for everything else:
it's what allows optimizations to be stacked without ever losing the reference image.

## From raycaster to BSP tree

The first version of the game was a grid raycaster, Wolfenstein-style: right-angle walls, a cell
or emptiness. As soon as 45° rooms, variable floor and ceiling heights, and windows were needed,
the grid model became a ceiling. I rewrote everything on an older and more capable structure: the
**BSP** (Binary Space Partitioning), the tree that DOOM compiled into its `.wad` files.

A map is a set of wall segments (`linedefs`) and sectors (flat zones with a floor and ceiling
height). The compiler recursively splits the plane: at each node it picks a segment as the
partition, sorts the others in front of or behind it, and cuts in two any that cross the line.
The choice of splitter minimizes cuts and balances the tree. The leaves are convex cells, each
belonging to a single sector.

The point isn't storage, it's ordering. For any camera position, a traversal of the tree yields
the walls sorted from nearest to farthest, without sorting anything at runtime. All it takes, at
each node, is descending first into the side where the camera sits.

```typescript
// Walk the BSP: at each node the side the camera sits on is nearer, so recurse there first.
function eachSegFrontToBack(child: NodeChild, camera: Camera, visit: (seg: Seg) => void): void {
  if (child.kind === 'leaf') {
    for (const seg of child.subsector.segs) visit(seg);
    return;
  }
  const node = child.node;
  const cameraInFront = signedSide(node.partition, camera.x, camera.y) < 0;

  eachSegFrontToBack(cameraInFront ? node.front : node.back, camera, visit);
  eachSegFrontToBack(cameraInFront ? node.back : node.front, camera, visit);
}
```

## The front-to-back traversal

Rendering a frame is a single walk of this tree. Each visible segment projects into a vertical
slice of screen columns. The projection is DOOM's: a fixed focal distance
(`largeur / 2 / tan(fov / 2)`), a wall height inversely proportional to depth, and looking up/down
achieved by shifting the horizon, not by an actual camera rotation.

Two occlusion mechanisms work together. For walls, each column carries an opening window
(`topClip[x]`, `botClip[x]`) that the walk progressively closes: as soon as a solid wall fills the
column, it closes and farther walls no longer write to it. That's the classic technique, with no
over-draw. For everything resolved by depth (floors, ceilings, sprites, glass, voxel volumes), a
per-pixel **z-buffer** in `Float32` arbitrates every point: it only writes if the new depth beats
the one already there.

The horizontal texture coordinate of a wall is the distance traveled along the original
`linedef`, not along the segment. Since the BSP splits a wall into several pieces, measuring from
the parent line keeps the texture continuous across the cuts: no visible seam where the compiler
sliced it. This coordinate's interpolation is done in `u/z`, perspective-corrected, like the rest
of the projection.

Floors and ceilings aren't raycast per pixel. Each screen row carries a world-to-screen scale
(`focal / (y − horizon)`) that converts its height into depth in one shot, and distance shading
becomes a simple per-row factor instead of a per-pixel division.

## One walk, two outputs

Here's the joint that makes the dual implementation possible. The tree walk (the BSP order, the
clipping, the projection) is written exactly once. What it does with each computed slice goes
through an interface, `WalkSink`. A CPU *sink* paints the slice right away; a GPU *sink* records
it into a command buffer, without drawing.

```typescript
// One walk of the BSP, two possible sinks. The CPU sink paints the span now;
// the GPU sink records it into a per-column command buffer for the WGSL shader.
export interface WalkSink {
  sky(x: number, y0: number, y1: number): void;
  flat(x: number, y0: number, y1: number, tex: Texture, name: string,
       planeZ: number, rayX: number, rayY: number, falloff: number, light: number): void;
  wall(x: number, y0: number, y1: number, tex: Texture, name: string,
       u: number, zPerRow: number, shade: number, forward: number): void;
}
```

The CPU backend wires up a sink that calls the software painters directly. The GPU backend wires
up a sink that serializes each slice into flat typed arrays: spans grouped by column in their
paint order, deferred phases (glass, sprites) in a separate list. These buffers go straight to
the GPU as they are, and a compute **WGSL** shader, one invocation per pixel, replays the exact
same sequence per column. No triangle rasterization anywhere: the GPU redoes DOOM's job, pixel by
pixel, in parallel.

This split has a discipline cost. The WGSL shader must reproduce the same texture anchors, the
same truncations, the same shading and tint constants as the TypeScript code. A handful of
renderer constants (the tiling anchor, the glass tint, the voxel face shading factors) are
exported precisely so the shader can transcribe them identically.

## The same pixel, proven

Two implementations that must produce the same image always end up diverging if nothing watches
them. The guarantee rests on one test: rendering **the same scene** with the CPU renderer and
with the WebGPU backend, into two separate buffers, then comparing them channel by channel.

```typescript
// The GPU walks the columns in f32; the CPU renderer mixes i32/f64. Identical geometry still lands
// a channel or two apart from rounding, so parity is "within tolerance", never bit-exact.
export const RENDER_PARITY_TOLERANCE = 2;

export function diffFrames(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance: number): FrameDiff {
  let maxChannelDiff = 0;
  let mismatchCount = 0;

  for (let i = 0; i < a.length; i += 4) {
    let exceeds = false;

    for (let c = 0; c < 3; c++) {           // RGB only: both backends write opaque frames
      const d = Math.abs(a[i + c] - b[i + c]);

      if (d > maxChannelDiff) maxChannelDiff = d;
      if (d > tolerance) exceeds = true;
    }
    if (exceeds) mismatchCount++;
  }

  return { pixelCount: a.length >> 2, maxChannelDiff, mismatchCount };
}
```

The agreement is within a tolerance, not bit-exact. The GPU computes in `f32`, the CPU renderer
mixes integers and double-precision floats: the same geometry lands one or two levels apart from
rounding. A Playwright test drives this diff in a real browser and requires fewer than **2%** of
pixels out of tolerance. Where `navigator.gpu` doesn't exist, on headless Chromium in CI for
instance, the test declares itself unexercised rather than comparing the CPU against itself.

The software renderer thus carries two roles. It's the universal foundation that runs everywhere,
and it's the truth the test holds the GPU against. Every optimization of the WebGPU path is
measured against it.

## One byte per texel

The engine stores its textures like DOOM did: **one byte per texel**, an index into a 256-color
palette (1024 bytes of RGBA). The invariant running through the whole engine is that index 0 is
the only transparent entry. Every source pixel with zero alpha falls back to 0, and the test
`index ≠ 0` becomes the sole transparency test across every sampling path: wall, floor, sprite,
glass, voxel.

```typescript
// A textured wall column: sample a 1-byte palette index, resolve it, shade, pack little-endian RGBA.
// Index 0 is the transparent slot, so `index !== 0` is the whole alpha test.
const pi = px[(vRaw & (th - 1)) * tw + texCol] << 2;

buf32[i] =
  0xff000000 |
  ((pal[pi + 2] * shade) << 16) |
  ((pal[pi + 1] * shade) << 8) |
  (pal[pi] * shade);
```

The memory gain is a factor of 3.6 across the texture library. Procedural textures lose nothing
from it: they only use a few dozen colors, palettized exactly (the render stays bit-for-bit
identical to the RGBA era). Richer sources (compressed WebP, baked ambient occlusion, a few
thousand to a few tens of thousands of colors per 512² sheet) go through a deterministic *median
cut*.

This median cut has a trap I almost let slip through. It seeds a box per alpha class, on either
side of the full-glass / light-glass threshold (128), so that no quantization can average a color
from one side of the threshold to the other. Without this precaution, the first colored
semi-transparent asset would have seen an opaque texel silently flip to transparent.

## Eight workers, one framebuffer

The CPU backend doesn't render on a single thread. It splits the screen into horizontal bands
distributed across a pool of *workers*, up to eight depending on the machine (`min(8, cores −
1)`, one core left for the main thread). Each worker paints its band into the **same** framebuffer
and the same z-buffer, a `SharedArrayBuffer` seen directly, with no copy. The geometry is walked
in full by each of them, but writes are bounded to its band.

The entry price is known: shared memory requires cross-origin isolation, hence **COOP/COEP**
headers on *every* response. Without them, `SharedArrayBuffer` is unavailable and only
single-threaded rendering remains.

The sharing also applies to textures. Each worker originally received its own copy of the whole
library via *structured clone*: eight private copies of every atlas and every voxel grid, about
1.5 GB of duplicated pixels once the voxel doctrine was in place. The library is now packed once
into a `SharedArrayBuffer`, and workers receive views into it. `postMessage` transfers the handle
without cloning, and since the pixels are written once before sending, no `Atomics` are needed:
the workers only read. The measurement, in windowed Chromium on the process tree's RSS, dropped
from 2707 MB to 1197 MB, a −56% reduction in the browser's footprint.

A governor watches for contention between workers. Its only lever is the **number of active
workers**, never the resolution (which would buy blur, not framerate). A reduction is a measured
trial: at the end of its cooldown window, it compares join latency against the full-throttle
anchor, and rolls back if it's worse. It never drops below half the pool. This way it can never be
durably worse than doing nothing.

## Sprites in volume

Enemies, furniture, pickups aren't flat images. They're **voxel volumes**, anchored in the world.
A voxel grid rides an ordinary `Texture` (stacked horizontal slices, index 0 for an empty cell),
and the renderer walks it per pixel with an exact 3D DDA (the Amanatides & Woo algorithm): cell
traversal distances are computed, not accumulated by sampling, which keeps the GPU's `f32` replay
aligned with the `f64` reference. The first solid voxel encountered wins, and it writes its depth
into the z-buffer: the volume is real geometry for the sprites that follow.

The grids come from two sources that produce the same encoding, down to the byte. Some are
hand-sculpted in [MagicaVoxel](https://ephtracy.github.io/) and imported from their `.vox` files;
others are carved by silhouette intersection from a sheet of directional views. A `.vox` file is
already palettized, so parsing it keeps the file's indices without a ×4 expansion: a 256-color
sculpt weighs 16.7 MB instead of 67.

## Crossing zones seamlessly

The building is traversed with no visible loading. A *zone-portal* line type is a real window
onto another map. During the main walk, each column records its opening onto the portal; then, a
neighboring pass re-walks the tree of the facing zone with the camera **translated** into its
coordinates. The translation preserves distances, so the depths written stay consistent for the
z-buffer, the sprites, and the glass. The recursion is bounded to a single hop: a portal seen
through a portal paints its full texture.

On the worker side, every zone already built is cached by its key. Crossing a seam recompiles
nothing: a `swap` message promotes the already-held neighbor to primary zone, and only zones never
seen get compiled. On leaving a zone, a frozen snapshot captures everything the player may have
changed (enemies, barrels, items picked up, doors) and restores it on return, so nothing
reappears behind their back.

The whole thing stacks into a fallback cascade. If WebGPU is available, rendering starts on the
GPU. At the slightest failure (a lost device), the backend permanently falls back to the worker
pool. And without COOP/COEP, hence without a shared framebuffer, there's still the single-thread
renderer on the main thread: slower, but universal. Every browser gets an image.

> Rewriting a software rasterizer in 2026 came down to one reason: having an exact reference of
> the pixel. The CPU fixes the image, WebGPU accelerates it, a test compares them and refuses a
> gap of more than two levels per channel. Everything else (one byte per texel, a framebuffer
> shared across eight workers, sprites in volume, seamless zones) rests on this reference that
> holds.
