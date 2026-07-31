// Ping IndexNow (Bing / DuckDuckGo / Yandex / Naver) with every URL of the freshly
// built sitemap — runs in the deploy-client workflow AFTER a successful SWA deploy, so the key
// file is live when the engines validate it. Google does not support IndexNow; it follows the
// sitemap's real lastmod dates instead. `--dry-run` prints the payload without sending.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const HOST = 'super-dev.app';
const KEY_FILE = resolve(here, '../public/475d3d1210914c7095f78771c1829e2c.txt');
const SITEMAP = resolve(here, '../dist/super-dev-portfolio/browser/sitemap.xml');

const key = readFileSync(KEY_FILE, 'utf8').trim();
const urlList = (readFileSync(SITEMAP, 'utf8').match(/<loc>([^<]+)<\/loc>/g) ?? []).map((tag) =>
  tag.slice('<loc>'.length, -'</loc>'.length),
);

if (urlList.length === 0) {
  console.error('✗ IndexNow: no <loc> found in the built sitemap — run the SSG build first');
  process.exit(1);
}

const payload = {
  host: HOST,
  key,
  keyLocation: `https://${HOST}/${basename(KEY_FILE)}`,
  urlList,
};

if (process.argv.includes('--dry-run')) {
  console.log(`✓ IndexNow dry-run: ${urlList.length} urls, key ${key.slice(0, 8)}…`);
  console.log(`  ${urlList[0]} … ${urlList.at(-1)}`);
  process.exit(0);
}

// A failed hint must never fail a deploy that already succeeded: warn and exit 0.
try {
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    console.log(`✓ IndexNow: ${urlList.length} urls submitted (HTTP ${response.status})`);
  } else {
    console.warn(`⚠ IndexNow answered HTTP ${response.status} — non-blocking, deploy unaffected`);
  }
} catch (error) {
  console.warn(`⚠ IndexNow unreachable (${error.message}) — non-blocking, deploy unaffected`);
}
