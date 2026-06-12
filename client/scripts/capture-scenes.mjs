// Capture the 6 player scenes as mockups. The player auto-plays via setInterval (so it's masked in the
// normal visual snapshot); here we pause it and seek each chapter to a settled moment (reveals/typed done),
// then screenshot the scene stage. Run against a served app (ng serve). Outputs docs/mockups/scene-<id>.png.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.OUTDIR || resolve(here, '../../docs/mockups');
const BASE = process.env.BASE || 'http://localhost:4300';

// chapter start seconds (from PRODUCT.md §4); +11s lands past every reveal/typed offset for that scene
const CHAPTERS = [
  ['intro', 0],
  ['stack', 15],
  ['code', 45],
  ['projects', 70],
  ['timeline', 110],
  ['outro', 145],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('sd-player .player__stage', { timeout: 30000 });

for (const [id, start] of CHAPTERS) {
  await page.evaluate((seconds) => {
    const component = window.ng.getComponent(document.querySelector('sd-player'));
    component.player.pause();
    component.player.seek(seconds);
  }, start + 11);
  await page.waitForTimeout(900);
  await page.locator('sd-player .player__stage').screenshot({ path: `${outDir}/scene-${id}.png` });
  console.log(`captured scene-${id}`);
}

await browser.close();
