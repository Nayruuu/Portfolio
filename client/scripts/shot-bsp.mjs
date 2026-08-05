// Dumb, reliable BSP-game capture: open a /bsp URL in headless chromium (software GL), wait for the game
// canvas to exist + settle, screenshot the LARGEST such canvas. Pairs with the dev URL params
// (?level=&spawn=&noenemies=1 — see level-select.ts) for spawn-anywhere captures without a rebuild.
//   Usage: node scripts/shot-bsp.mjs <url> <outPng> [waitMs=9000]
import { chromium } from '@playwright/test';

const [url, outPng, waitArg] = process.argv.slice(2);
if (!url || !outPng) {
  console.error('usage: node scripts/shot-bsp.mjs <url> <outPng> [waitMs=9000]');
  process.exit(1);
}
const waitMs = Number.parseInt(waitArg ?? '9000', 10);

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('sd-bsp-demo canvas');
await page.waitForTimeout(waitMs); // let assets preload + the render loop settle

// Several canvases can exist (HUD face, weapon view…) — the game viewport is the largest one.
const canvases = await page.locator('sd-bsp-demo canvas').all();
let best = null;
let bestArea = -1;
for (const c of canvases) {
  const box = await c.boundingBox();
  const area = box ? box.width * box.height : 0;
  if (area > bestArea) {
    bestArea = area;
    best = c;
  }
}
await best.scrollIntoViewIfNeeded();
await best.screenshot({ path: outPng });
await browser.close();
console.log(outPng);
