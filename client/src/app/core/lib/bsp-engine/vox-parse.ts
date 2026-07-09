import type { Texture } from './texture';

// Decodes a MagicaVoxel .vox into the SAME voxel-grid Texture voxel-carve.ts produces (byte-identical
// encoding: voxel (gx,gy,gz) at pixel (gx, gz·ny+gy), slices bottom-up; alpha 0 = empty / 255 = solid).
// Reads the FIRST model only — unknown chunks (scene graph, MATL, LAYR…) are skipped by size.
// Axis mapping (MV is Z-up like our grid): gx = MV x (lateral), gy = MV y (depth, 0 = FRONT the player
// meets), gz = MV z (height, 0 = bottom). RGBA chunk is SHIFTED (see buildPalette).

// MagicaVoxel's built-in 256-colour palette (no RGBA chunk). Each entry 0xAABBGGRR, INDEX-ALIGNED: entry
// `c` is the colour for colorIndex `c` ([0] unused).
const DEFAULT_PALETTE = new Uint32Array([
  0x00000000, 0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff, 0xff00ffff, 0xffffccff,
  0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff, 0xff00ccff, 0xffff99ff, 0xffcc99ff, 0xff9999ff,
  0xff6699ff, 0xff3399ff, 0xff0099ff, 0xffff66ff, 0xffcc66ff, 0xff9966ff, 0xff6666ff, 0xff3366ff,
  0xff0066ff, 0xffff33ff, 0xffcc33ff, 0xff9933ff, 0xff6633ff, 0xff3333ff, 0xff0033ff, 0xffff00ff,
  0xffcc00ff, 0xff9900ff, 0xff6600ff, 0xff3300ff, 0xff0000ff, 0xffffffcc, 0xffccffcc, 0xff99ffcc,
  0xff66ffcc, 0xff33ffcc, 0xff00ffcc, 0xffffcccc, 0xffcccccc, 0xff99cccc, 0xff66cccc, 0xff33cccc,
  0xff00cccc, 0xffff99cc, 0xffcc99cc, 0xff9999cc, 0xff6699cc, 0xff3399cc, 0xff0099cc, 0xffff66cc,
  0xffcc66cc, 0xff9966cc, 0xff6666cc, 0xff3366cc, 0xff0066cc, 0xffff33cc, 0xffcc33cc, 0xff9933cc,
  0xff6633cc, 0xff3333cc, 0xff0033cc, 0xffff00cc, 0xffcc00cc, 0xff9900cc, 0xff6600cc, 0xff3300cc,
  0xff0000cc, 0xffffff99, 0xffccff99, 0xff99ff99, 0xff66ff99, 0xff33ff99, 0xff00ff99, 0xffffcc99,
  0xffcccc99, 0xff99cc99, 0xff66cc99, 0xff33cc99, 0xff00cc99, 0xffff9999, 0xffcc9999, 0xff999999,
  0xff669999, 0xff339999, 0xff009999, 0xffff6699, 0xffcc6699, 0xff996699, 0xff666699, 0xff336699,
  0xff006699, 0xffff3399, 0xffcc3399, 0xff993399, 0xff663399, 0xff333399, 0xff003399, 0xffff0099,
  0xffcc0099, 0xff990099, 0xff660099, 0xff330099, 0xff000099, 0xffffff66, 0xffccff66, 0xff99ff66,
  0xff66ff66, 0xff33ff66, 0xff00ff66, 0xffffcc66, 0xffcccc66, 0xff99cc66, 0xff66cc66, 0xff33cc66,
  0xff00cc66, 0xffff9966, 0xffcc9966, 0xff999966, 0xff669966, 0xff339966, 0xff009966, 0xffff6666,
  0xffcc6666, 0xff996666, 0xff666666, 0xff336666, 0xff006666, 0xffff3366, 0xffcc3366, 0xff993366,
  0xff663366, 0xff333366, 0xff003366, 0xffff0066, 0xffcc0066, 0xff990066, 0xff660066, 0xff330066,
  0xff000066, 0xffffff33, 0xffccff33, 0xff99ff33, 0xff66ff33, 0xff33ff33, 0xff00ff33, 0xffffcc33,
  0xffcccc33, 0xff99cc33, 0xff66cc33, 0xff33cc33, 0xff00cc33, 0xffff9933, 0xffcc9933, 0xff999933,
  0xff669933, 0xff339933, 0xff009933, 0xffff6633, 0xffcc6633, 0xff996633, 0xff666633, 0xff336633,
  0xff006633, 0xffff3333, 0xffcc3333, 0xff993333, 0xff663333, 0xff333333, 0xff003333, 0xffff0033,
  0xffcc0033, 0xff990033, 0xff660033, 0xff330033, 0xff000033, 0xffffff00, 0xffccff00, 0xff99ff00,
  0xff66ff00, 0xff33ff00, 0xff00ff00, 0xffffcc00, 0xffcccc00, 0xff99cc00, 0xff66cc00, 0xff33cc00,
  0xff00cc00, 0xffff9900, 0xffcc9900, 0xff999900, 0xff669900, 0xff339900, 0xff009900, 0xffff6600,
  0xffcc6600, 0xff996600, 0xff666600, 0xff336600, 0xff006600, 0xffff3300, 0xffcc3300, 0xff993300,
  0xff663300, 0xff333300, 0xff003300, 0xffff0000, 0xffcc0000, 0xff990000, 0xff660000, 0xff330000,
  0xff0000ee, 0xff0000dd, 0xff0000bb, 0xff0000aa, 0xff000088, 0xff000077, 0xff000055, 0xff000044,
  0xff000022, 0xff000011, 0xff00ee00, 0xff00dd00, 0xff00bb00, 0xff00aa00, 0xff008800, 0xff007700,
  0xff005500, 0xff004400, 0xff002200, 0xff001100, 0xffee0000, 0xffdd0000, 0xffbb0000, 0xffaa0000,
  0xff880000, 0xff770000, 0xff550000, 0xff440000, 0xff220000, 0xff110000, 0xffeeeeee, 0xffdddddd,
  0xffbbbbbb, 0xffaaaaaa, 0xff888888, 0xff777777, 0xff555555, 0xff444444, 0xff222222, 0xff111111,
]);

const RGBA_BYTES = 256 * 4;

// INDEX-ALIGNED palette (pal[c·4…] = colour for colorIndex c). The file's RGBA chunk is SHIFTED — stored
// entry i is colour i+1.
function buildPalette(raw: Uint8Array | null): Uint8Array {
  const pal = new Uint8Array(256 * 4);

  if (raw === null) {
    for (let c = 0; c < 256; c++) {
      const v = DEFAULT_PALETTE[c];

      pal[c * 4] = v & 0xff;
      pal[c * 4 + 1] = (v >> 8) & 0xff;
      pal[c * 4 + 2] = (v >> 16) & 0xff;
      pal[c * 4 + 3] = (v >> 24) & 0xff;
    }

    return pal;
  }
  // Fills palette indices 1..255 (the 256th stored entry maps to index 256 and is unused).
  for (let i = 0; i < 255; i++) {
    pal[(i + 1) * 4] = raw[i * 4];
    pal[(i + 1) * 4 + 1] = raw[i * 4 + 1];
    pal[(i + 1) * 4 + 2] = raw[i * 4 + 2];
    pal[(i + 1) * 4 + 3] = raw[i * 4 + 3];
  }

  return pal;
}

export function parseVox(input: ArrayBuffer | Uint8Array): Texture {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Bounds-guarded readers — a read past the buffer is a truncated file, not a silent NaN/0.
  const int32 = (off: number): number => {
    if (off + 4 > bytes.length) {
      throw new Error('vox: truncated (reading past end of buffer)');
    }

    return view.getInt32(off, true);
  };
  const tag = (off: number): string => {
    if (off + 4 > bytes.length) {
      throw new Error('vox: truncated (reading past end of buffer)');
    }

    return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  };

  if (bytes.length < 8 || tag(0) !== 'VOX ') {
    throw new Error("vox: not a MagicaVoxel file (missing 'VOX ' header)");
  }
  if (tag(8) !== 'MAIN') {
    throw new Error("vox: missing 'MAIN' chunk");
  }
  // Walk MAIN's children, keeping the first SIZE / XYZI / RGBA (a single-object export).
  let p = 20 + int32(12); // 20 = header(8) + MAIN id(4) + sizes(8); skip MAIN content
  const end = p + int32(16);
  let dims: readonly [number, number, number] | null = null;
  let voxels: { readonly count: number; readonly off: number } | null = null;
  let rgba: Uint8Array | null = null;

  while (p + 12 <= end) {
    const id = tag(p);
    const contentSize = int32(p + 4);
    const childrenSize = int32(p + 8);

    if (Math.min(contentSize, childrenSize) < 0) {
      throw new Error('vox: corrupt chunk (negative size)');
    }
    const content = p + 12;

    if (id === 'SIZE' && dims === null) {
      dims = [int32(content), int32(content + 4), int32(content + 8)];
    } else if (id === 'XYZI' && voxels === null) {
      const count = int32(content);

      if (content + 4 + count * 4 > bytes.length) {
        throw new Error('vox: truncated XYZI chunk');
      }
      voxels = { count, off: content + 4 };
    } else if (id === 'RGBA' && rgba === null) {
      if (content + RGBA_BYTES > bytes.length) {
        throw new Error('vox: truncated RGBA chunk');
      }
      rgba = bytes.subarray(content, content + RGBA_BYTES);
    }
    p = content + contentSize + childrenSize;
  }
  if (dims === null || voxels === null) {
    throw new Error("vox: missing 'SIZE' or 'XYZI' chunk");
  }
  const [n, ny, nz] = dims;

  if (Math.min(n, ny, nz) <= 0) {
    throw new Error('vox: degenerate model size');
  }
  const palette = buildPalette(rgba);
  const pixels = new Uint8ClampedArray(n * ny * nz * 4); // all 0 → every cell empty until filled

  for (let k = 0; k < voxels.count; k++) {
    const base = voxels.off + k * 4;
    const gx = bytes[base]; // MV x → grid lateral
    const gy = bytes[base + 1]; // MV y → grid depth (0 = front)
    const gz = bytes[base + 2]; // MV z → grid height (0 = bottom)
    const c = bytes[base + 3]; // 1-based colour index

    if (Math.max(gx - n, gy - ny, gz - nz) >= 0) {
      throw new Error('vox: voxel outside the model box');
    }
    const out = ((gz * ny + gy) * n + gx) * 4;

    pixels[out] = palette[c * 4];
    pixels[out + 1] = palette[c * 4 + 1];
    pixels[out + 2] = palette[c * 4 + 2];
    pixels[out + 3] = 255; // alpha = occupancy: a solid voxel is always opaque
  }

  return { width: n, height: ny * nz, pixels, voxelDepth: ny };
}
