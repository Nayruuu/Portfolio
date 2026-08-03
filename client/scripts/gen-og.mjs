// Generate the social cards (og:image) with Playwright. On-brand: dark "cinema" background,
// warm-red play button. Two kinds: the default brand card (og-default.png) and one card per
// article × locale (og/<slug>.<lang>.jpg — YouTube-thumbnail look: tag pill in the tag's accent
// color, title, read-time badge). Run on demand (`make og`); the images are committed — the Azure
// build does not run Playwright. `check-prerender.mjs` fails the build if an article card is missing.
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');
const contentDir = resolve(here, '../src/app/core/content');
const ogDir = resolve(publicDir, 'og');

const defaultHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
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
  <h1>technical lead <span>.NET / Angular / Azure</span></h1>
  <div class="role">$ role: lead technique — architecture · infra · dev</div>
</body></html>`;

const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Long titles step down so they never overflow the 1020px column on two lines.
const titleSize = (title) => (title.length <= 40 ? 68 : title.length <= 55 ? 58 : 50);

const articleHtml = (article) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: radial-gradient(circle at 30% 20%, #1a1a1e, #0a0a0b 70%);
    color: #f1f1ef; font-family: 'Segoe UI', system-ui, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between; padding: 70px 90px 60px;
    position: relative;
  }
  .symbol {
    position: absolute; right: 80px; top: 50%; transform: translateY(-50%);
    font-family: 'JetBrains Mono', monospace; font-size: 200px; font-weight: 700;
    color: ${article.accentColor}; opacity: 0.16; white-space: nowrap;
  }
  .mark { display: flex; align-items: center; gap: 16px; }
  .play {
    width: 52px; height: 52px; border-radius: 13px;
    background: oklch(66% 0.22 22deg); display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 40px oklch(66% 0.22 22deg / 0.45);
  }
  .play::after { content: ''; border-left: 18px solid #0a0a0b; border-top: 11px solid transparent;
    border-bottom: 11px solid transparent; margin-left: 4px; }
  .brand { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; }
  .brand b { color: oklch(66% 0.22 22deg); }
  .middle { max-width: 1020px; position: relative; }
  .tag {
    display: inline-block; padding: 8px 22px; border-radius: 999px;
    background: ${article.accentColor}; color: #fff;
    font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 700;
    letter-spacing: 1px; margin-bottom: 28px;
  }
  h1 {
    font-size: ${titleSize(article.title)}px; font-weight: 700; line-height: 1.12;
    letter-spacing: -1px;
  }
  .bottom {
    display: flex; align-items: center; justify-content: space-between;
    font-family: 'JetBrains Mono', monospace; font-size: 26px; color: #a4a4a8;
  }
  .time { background: rgb(0 0 0 / 72%); padding: 6px 16px; border-radius: 8px; color: #f1f1ef; }
</style></head><body>
  <div class="symbol">${escapeHtml(article.symbol)}</div>
  <div class="mark"><div class="play"></div><div class="brand">&gt;_ super-dev<b>.app</b></div></div>
  <div class="middle">
    <div class="tag">${escapeHtml(article.tag)}</div>
    <h1>${escapeHtml(article.title)}</h1>
  </div>
  <div class="bottom"><span>${escapeHtml(article.date)}</span><span class="time">▶ ${escapeHtml(article.readTime)}</span></div>
</body></html>`;

mkdirSync(ogDir, { recursive: true });

const locales = readdirSync(contentDir)
  .filter((file) => /^content\.[a-z]{2}\.json$/.test(file))
  .map((file) => ({
    lang: basename(file, '.json').split('.')[1],
    articles: JSON.parse(readFileSync(resolve(contentDir, file), 'utf8')).articles,
  }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

await page.setContent(defaultHtml, { waitUntil: 'networkidle' });
await page.screenshot({ path: resolve(publicDir, 'og-default.png'), type: 'png' });
console.log(`✓ og-default.png (1200×630)`);

let cards = 0;

for (const { lang, articles } of locales) {
  for (const article of articles) {
    await page.setContent(articleHtml(article), { waitUntil: 'networkidle' });
    await page.screenshot({
      path: resolve(ogDir, `${article.slug}.${lang}.jpg`),
      type: 'jpeg',
      quality: 82,
    });
    cards += 1;
  }
}

await browser.close();
console.log(`✓ ${cards} article cards (1200×630 jpeg) → ${ogDir}`);
