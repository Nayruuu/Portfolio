// Ad-hoc top-down renderer + reachability checker for a BSP level — bundles the real Level module (tiny
// value-only graph, no engine runtime) via esbuild, rasterises an SVG schematic with sharp, then flood-fills
// the walkable space with the REAL movement physics (`movePlayer`) to assert every badge / door trigger /
// exit is reachable from the spawn.
//   Usage: node render-level-topdown.mjs [name] [--strict]
//   `name` (default `m1-lobby`) picks src/app/core/lib/game/levels/level-<name>.ts → docs/levels/<name>-map.png.
//   Reachability failures WARN by default; `--strict` turns them into exit(1) (the CI-able mode).
import { build } from 'esbuild';
import sharp from 'sharp';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => a !== '--strict');
const STRICT = process.argv.includes('--strict');
const NAME = args[0] ?? 'm1-lobby';
const SRC = resolve(HERE, `../src/app/core/lib/game/levels/level-${NAME}.ts`);
const OUT_PNG = resolve(HERE, `../../docs/levels/${NAME}-map.png`);
const TMP = resolve(HERE, '.level-bundle.mjs');
const TMP_ENTRY = resolve(HERE, '.level-entry.ts');

// Bundle the level PLUS the two engine functions the reachability flood needs (type-only engine imports in
// the level erase; buildBsp/movePlayer are pure value modules, so the bundle stays tiny and node-runnable).
writeFileSync(
  TMP_ENTRY,
  `export * from ${JSON.stringify(SRC)};
export { buildBsp } from ${JSON.stringify(resolve(HERE, '../src/app/core/lib/bsp-engine/node-builder.ts'))};
export { movePlayer } from ${JSON.stringify(resolve(HERE, '../src/app/core/lib/bsp-engine/physics.ts'))};
`,
);
await build({
  entryPoints: [TMP_ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: TMP,
  logLevel: 'error',
});
rmSync(TMP_ENTRY);

const mod = await import(pathToFileURL(TMP).href);
// Each level file exports its Level under its own name (M1_LOBBY, HANGAR, …) — find it by shape.
const LEVEL = Object.values(mod).find(
  (v) => v && typeof v === 'object' && v.map?.sectors && v.spawn,
);
if (!LEVEL) {
  console.error(`no Level export found in ${SRC}`);
  process.exit(1);
}
const { buildBsp, movePlayer } = mod;
const { map } = LEVEL;
const V = map.vertices;

// --- bounds ---
let minX = Infinity,
  minY = Infinity,
  maxX = -Infinity,
  maxY = -Infinity;
for (const v of V) {
  minX = Math.min(minX, v.x);
  maxX = Math.max(maxX, v.x);
  minY = Math.min(minY, v.y);
  maxY = Math.max(maxY, v.y);
}
const SC = 9; // px per world unit
const PAD = 30;
const LEGEND_W = 190;
const W = Math.ceil((maxX - minX) * SC) + PAD * 2 + LEGEND_W;
const H = Math.ceil((maxY - minY) * SC) + PAD * 2;
const px = (x) => (x - minX) * SC + PAD;
const py = (y) => (y - minY) * SC + PAD;

const parts = [`<rect width="${W}" height="${H}" fill="#0b0f14"/>`];

// --- linedefs ---
for (const ld of map.linedefs) {
  const a = V[ld.v1],
    b = V[ld.v2];
  let stroke = '#e8edf2',
    dash = '',
    w = 2; // solid = white
  if (ld.sliding) {
    stroke = '#39d353';
    dash = '4,3';
    w = 2.5;
  } // sliding glass door = green
  else if (ld.glass) {
    stroke = '#7fd6ff';
    dash = '3,3';
    w = 2.5;
  } // glass window = light blue
  else if (ld.back != null) {
    stroke = '#22c3d6';
    dash = '5,4';
    w = 1.6;
  } // portal = cyan
  parts.push(
    `<line x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
  );
}

const dot = (x, y, r, fill, label, lc = '#0b0f14') =>
  `<circle cx="${px(x)}" cy="${py(y)}" r="${r}" fill="${fill}"/>` +
  (label
    ? `<text x="${px(x)}" y="${py(y) + 3}" font-family="monospace" font-size="9" font-weight="bold" fill="${lc}" text-anchor="middle">${label}</text>`
    : '');

// --- map things (barrels / decor props) ---
const PROP_STYLE = {
  prop: ['#2e8b57', 'P'],
  prop_screen: ['#7a5cd6', 'm'],
  prop_totem: ['#7a5cd6', 'T'],
  prop_board: ['#7a5cd6', 'W'],
  prop_chair: ['#7a5cd6', 'c'],
  prop_cooler: ['#7a5cd6', 'o'],
};
for (const t of map.things) {
  if (t.type === 'barrel') parts.push(dot(t.x, t.y, 4, '#b5651d', 'b', '#fff'));
  else if (PROP_STYLE[t.type]) {
    const [fill, glyph] = PROP_STYLE[t.type];
    parts.push(dot(t.x, t.y, 4, fill, glyph, '#fff'));
  }
}

// --- Level payload markers ---
const S = LEVEL.spawn;
parts.push(dot(S.x, S.y, 7, '#39d353', 'S'));
for (const e of LEVEL.enemies) {
  const k = e.spec?.name || '';
  const c = /Guard/i.test(k)
    ? '#ff9b21'
    : /Drone|Junior/i.test(k)
      ? '#ffe14d'
      : /Remote|Consultant/i.test(k)
        ? '#c77dff'
        : '#ff4d4d';
  parts.push(dot(e.x, e.y, 5, c, '', ''));
}
for (const h of LEVEL.health) parts.push(dot(h[0], h[1], 4.5, '#ff6ea8', '+', '#fff'));
for (const a of LEVEL.armor) parts.push(dot(a[0], a[1], 4.5, '#4d7cff', 'A', '#fff'));
for (const a of LEVEL.ammo) parts.push(dot(a[0], a[1], 4, '#e8d44d', 'a'));
for (const w of LEVEL.weapons ?? []) parts.push(dot(w[0], w[1], 5.5, '#c2f04c', 'G')); // G(un) — W is the whiteboard prop
for (const k of LEVEL.keycards) parts.push(dot(k[0], k[1], 5, k[2], 'K', '#fff'));
for (const d of LEVEL.doors) parts.push(dot(d.triggerX, d.triggerY, 5, '#ff9b21', 'D', '#fff'));
// Goals: the legacy exit (X) and/or the open-building graph exits (Z → a sibling zone).
const goals = [
  ...(LEVEL.exit
    ? [
        {
          label: `exit @ ${LEVEL.exit[0]},${LEVEL.exit[1]}`,
          x: LEVEL.exit[0],
          y: LEVEL.exit[1],
          glyph: 'X',
        },
      ]
    : []),
  ...(LEVEL.exits ?? []).map((e) => ({
    label: `exit→${e.to} @ ${e.x},${e.y}`,
    x: e.x,
    y: e.y,
    glyph: 'Z',
  })),
];
for (const g of goals) parts.push(dot(g.x, g.y, 6, '#ff33cc', g.glyph));

// --- legend ---
const legendX = W - LEGEND_W + 10;
const rows = [
  ['#e8edf2', 'solid wall'],
  ['#22c3d6', 'portal (dashed)'],
  ['#7fd6ff', 'glass window'],
  ['#39d353', 'sliding door / spawn(S)'],
  ['#ff4d4d', 'enemy (Husk/Guard/Drone)'],
  ['#ff6ea8', 'health (+)'],
  ['#4d7cff', 'armor (A)'],
  ['#e8d44d', 'ammo (a)'],
  ['#c2f04c', 'weapon pickup (W)'],
  ['#b5651d', 'barrel (b)'],
  ['#2e8b57', 'prop plant (P)'],
  ['#7a5cd6', 'decor (m/T/W/c/o)'],
  ['#ff9b21', 'door trigger (D)'],
  ['#ff33cc', 'exit (X) / zone exit (Z)'],
];
parts.push(
  `<text x="${legendX}" y="${PAD}" font-family="monospace" font-size="12" font-weight="bold" fill="#e8edf2">${NAME.toUpperCase().replace(/-/g, ' ')} — top-down</text>`,
);
parts.push(
  `<text x="${legendX}" y="${PAD + 16}" font-family="monospace" font-size="9" fill="#8aa">y increases DOWN (south)</text>`,
);
rows.forEach((r, i) => {
  const yy = PAD + 40 + i * 18;
  parts.push(`<rect x="${legendX}" y="${yy - 8}" width="12" height="12" fill="${r[0]}"/>`);
  parts.push(
    `<text x="${legendX + 18}" y="${yy + 2}" font-family="monospace" font-size="10" fill="#cdd">${r[1]}</text>`,
  );
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
mkdirSync(dirname(OUT_PNG), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(OUT_PNG);
console.log(`wrote ${OUT_PNG} (${W}x${H})  bounds x[${minX},${maxX}] y[${minY},${maxY}]`);

// --- reachability check --------------------------------------------------------------------------
// Flood-fill the walkable space from the spawn on a 0.5-unit grid, moving with the REAL physics
// (movePlayer, player radius 0.3, headroom 0.8 — the component's constants). Permissive on gates the
// live game opens dynamically: sliding doors are treated fully open (slides = all 1s), and stepMax is
// the AUTO-MANTLE ceiling 2.4 (not the walking 1.1), so a mantle-able ledge counts as walkable.
// Animated `doors[]` sectors are open in the authored map data (the component shuts them at init), so
// the flood crosses them; their triggers also get a looser ADJACENT tolerance in case a variant closes
// them. A move "works" when the resolved position advanced ≥ 0.4 of the 0.5 step toward the target.
const GRID = 0.5;
const RADIUS = 0.3;
const CLIMB_MAX = 2.4; // component CLIMB_MAX — approximates walk (1.1) + auto-mantle in one stepMax
const HEADROOM = 0.8;
const ADVANCE_MIN = 0.4;
const TOLERANCE = 1.0; // a target is "reached" when a flooded cell is within this range
const DOOR_TOLERANCE = 1.5; // door triggers: adjacent-to-the-door is good enough
const CELL_CAP = 400_000; // runaway guard (a leak into the void)

const compiled = buildBsp(map);
const slides = map.linedefs.map(() => 1); // every sliding door fully open
const key = (x, y) => `${Math.round(x / GRID)},${Math.round(y / GRID)}`;
const visited = new Map([[key(S.x, S.y), { x: S.x, y: S.y }]]);
const queue = [{ x: S.x, y: S.y }];
const DIRS = [
  [GRID, 0],
  [-GRID, 0],
  [0, GRID],
  [0, -GRID],
];

const t0 = performance.now();
while (queue.length > 0 && visited.size < CELL_CAP) {
  const p = queue.pop();
  for (const [dx, dy] of DIRS) {
    const r = movePlayer(compiled, p.x, p.y, dx, dy, RADIUS, CLIMB_MAX, HEADROOM, slides);
    const advance = ((r.x - p.x) * dx + (r.y - p.y) * dy) / GRID;
    if (advance < ADVANCE_MIN) continue;
    const k = key(r.x, r.y);
    if (visited.has(k)) continue;
    visited.set(k, { x: r.x, y: r.y });
    queue.push({ x: r.x, y: r.y });
  }
}
const cells = [...visited.values()];
const distTo = (x, y) =>
  cells.reduce((m, c) => Math.min(m, Math.hypot(c.x - x, c.y - y)), Infinity);

const targets = [
  ...LEVEL.keycards.map(([x, y, color]) => ({
    label: `badge(${color}) @ ${x},${y}`,
    x,
    y,
    tol: TOLERANCE,
  })),
  ...LEVEL.doors.map((d, i) => ({
    label: `door[${i}] trigger @ ${d.triggerX},${d.triggerY}`,
    x: d.triggerX,
    y: d.triggerY,
    tol: DOOR_TOLERANCE,
  })),
  ...(LEVEL.weapons ?? []).map(([x, y, id]) => ({
    label: `weapon(${id}) @ ${x},${y}`,
    x,
    y,
    tol: TOLERANCE,
  })),
  ...goals.map((g) => ({ label: g.label, x: g.x, y: g.y, tol: TOLERANCE })),
];
const misses = targets.map((t) => ({ ...t, dist: distTo(t.x, t.y) })).filter((t) => t.dist > t.tol);

// Placement audit: every authored entity must stand in walkable space. A coordinate inside a
// hole/dead space is never flooded — an entombed spawn is invisible, unkillable, uncollectable,
// and fails SILENTLY in-game, so it must fail HERE.
const placements = [
  ...LEVEL.enemies.map((e, i) => ({ label: `enemy[${i}] @ ${e.x},${e.y}`, x: e.x, y: e.y })),
  ...LEVEL.ammo.map(([x, y], i) => ({ label: `ammo[${i}] @ ${x},${y}`, x, y })),
  ...LEVEL.health.map(([x, y], i) => ({ label: `health[${i}] @ ${x},${y}`, x, y })),
  ...LEVEL.armor.map(([x, y], i) => ({ label: `armor[${i}] @ ${x},${y}`, x, y })),
];
const entombed = placements
  .map((p) => ({ ...p, dist: distTo(p.x, p.y) }))
  .filter((p) => p.dist > TOLERANCE);
misses.push(...entombed.map((p) => ({ ...p, label: `placement ${p.label}` })));
const ms = Math.round(performance.now() - t0);

if (misses.length === 0) {
  console.log(
    `✓ reachability: spawn → badges/doors/exit (${targets.length} targets, ${placements.length} placements, ${visited.size} cells flooded, ${ms}ms)`,
  );
} else {
  for (const m of misses) {
    console.error(
      `✗ UNREACHABLE from spawn: ${m.label} (closest flooded cell ${m.dist === Infinity ? '∞' : m.dist.toFixed(2)} away)`,
    );
  }
  if (STRICT) process.exit(1);
  console.warn(
    `⚠ reachability failed for level-${NAME} (non-strict: warning only — pass --strict to fail)`,
  );
}
