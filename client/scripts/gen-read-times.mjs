// GENERATOR: derive each article's `readTime` from the REAL word count of its body, per locale, and
// write it back into `content.<lang>.json`. Wired into `build:ssg` so the figure can never be
// hand-inflated again (it was: bodies read in ~2 s while claiming 8-11 min). Honest metric by
// construction — deepen a body and its read time grows on the next build. Idempotent: a locale file
// is rewritten only when one of its read times actually changes, so a rebuild produces no diff.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(here, '../src/app/core/content');
const BODIES = resolve(here, '../src/content/articles');
// Locales discovered from the committed content.<lang>.json files — mirrors gen-seo.mjs so a new
// locale is picked up automatically instead of silently keeping its hand-set readTime.
const LANGS = readdirSync(CONTENT)
  .map((file) => file.match(/^content\.([a-z]{2})\.json$/)?.[1])
  .filter(Boolean);
const WPM = 200; // ~200 words/min — gives the deepened DOOM article (2351 words) its honest 12 min.

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const label = (words) => `${Math.max(1, Math.round(words / WPM))} min`;

let touched = 0;
for (const lang of LANGS) {
  const path = `${CONTENT}/content.${lang}.json`;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  let changed = false;

  for (const article of data.articles ?? []) {
    const body = `${BODIES}/${article.slug}.${lang}.md`;

    if (!existsSync(body)) {
      console.warn(`  ⚠ ${article.slug}.${lang}.md missing — readTime left as-is`);
      continue;
    }
    const next = label(wordCount(readFileSync(body, 'utf8')));

    if (article.readTime !== next) {
      article.readTime = next;
      changed = true;
      touched++;
    }
  }
  if (changed) {
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  }
}

console.log(`✓ read times derived from word count (${WPM} wpm) — ${touched} updated across ${LANGS.length} locales`);
