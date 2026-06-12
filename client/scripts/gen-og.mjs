// Generate the 1200×630 social card (og:image) with Playwright. On-brand: dark "cinema"
// background, warm-red play button, brand + role. Run on demand (`make og`); the PNG is
// committed — the Azure build does not run Playwright.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/og-default.png');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: radial-gradient(circle at 30% 20%, #1a1a1e, #0a0a0b 70%);
    color: #f1f1ef; font-family: 'Segoe UI', system-ui, sans-serif;
    display: flex; flex-direction: column; justify-content: center; padding: 90px;
  }
  .mark { display: flex; align-items: center; gap: 22px; margin-bottom: 34px; }
  .play {
    width: 76px; height: 76px; border-radius: 18px;
    background: oklch(66% 0.22 22deg); display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 60px oklch(66% 0.22 22deg / 0.45);
  }
  .play::after { content: ''; border-left: 26px solid #0a0a0b; border-top: 16px solid transparent;
    border-bottom: 16px solid transparent; margin-left: 6px; }
  .brand { font-size: 40px; font-weight: 700; letter-spacing: -0.5px; }
  .brand b { color: oklch(66% 0.22 22deg); }
  h1 { font-size: 72px; font-weight: 700; line-height: 1.05; letter-spacing: -1.5px; max-width: 900px; }
  h1 span { color: oklch(66% 0.22 22deg); }
  .role { margin-top: 30px; font-family: 'JetBrains Mono', monospace; font-size: 30px; color: #a4a4a8; }
</style></head><body>
  <div class="mark"><div class="play"></div><div class="brand">&gt;_ super-dev<b>.app</b></div></div>
  <h1>full-stack <span>.NET / Angular / Azure</span> developer</h1>
  <div class="role">$ role: lead — full-stack · devops · mobile</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: out, type: 'png' });
await browser.close();
console.log(`✓ og-default.png (1200×630) → ${out}`);
