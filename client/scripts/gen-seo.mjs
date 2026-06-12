import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const CONTENT_DIR = resolve(APP_ROOT, 'src/app/core/content');
const OUT = resolve(APP_ROOT, 'dist/super-dev-portfolio/browser');
const ORIGIN = process.env.SITE_ORIGIN ?? 'https://super-dev.app';
const DEFAULT_LANG = 'fr';

/** Languages discovered from the committed `content.<lang>.json` files (default first). */
const LANGS = readdirSync(CONTENT_DIR)
  .map((file) => file.match(/^content\.([a-z]{2})\.json$/)?.[1])
  .filter(Boolean)
  .sort((a, b) => (a === DEFAULT_LANG ? -1 : b === DEFAULT_LANG ? 1 : a.localeCompare(b)));

const read = (lang) =>
  JSON.parse(readFileSync(resolve(CONTENT_DIR, `content.${lang}.json`), 'utf8'));
const content = Object.fromEntries(LANGS.map((lang) => [lang, read(lang)]));
const primary = content.en ? 'en' : DEFAULT_LANG;

// --- concept routes (one <url>, hreflang alternates per language inside) ---
const STATIC = ['', 'articles', 'series', 'about', 'stack', 'contact'];
const localized = (path) =>
  Object.fromEntries(LANGS.map((lang) => [lang, path ? `/${lang}/${path}` : `/${lang}`]));
const concepts = STATIC.map((path) => localized(path));

content[DEFAULT_LANG].articles.forEach((article) =>
  concepts.push(localized(`articles/${article.slug}`)),
);
content[DEFAULT_LANG].series.forEach((series) => concepts.push(localized(`series/${series.slug}`)));

const today = new Date().toISOString().slice(0, 10);
const urls = concepts
  .map((concept) => {
    const alts = LANGS.map(
      (lang) =>
        `    <xhtml:link rel="alternate" hreflang="${lang}" href="${ORIGIN}${concept[lang]}"/>`,
    )
      .concat(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${concept[DEFAULT_LANG]}"/>`,
      )
      .join('\n');

    return `  <url>\n    <loc>${ORIGIN}${concept[DEFAULT_LANG]}</loc>\n    <lastmod>${today}</lastmod>\n${alts}\n  </url>`;
  })
  .join('\n');

writeFileSync(
  resolve(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`,
);

// --- robots.txt ---
const AGENTS = [
  'Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-Web', 'PerplexityBot', 'Google-Extended', 'CCBot',
];
writeFileSync(
  resolve(OUT, 'robots.txt'),
  `${AGENTS.map((ua) => `User-agent: ${ua}\nAllow: /`).join('\n\n')}

User-agent: *
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`,
);

// --- llms.txt (one article section per language) ---
const bullets = (localeContent, lang) =>
  localeContent.articles
    .map(
      (article) =>
        `- [${article.title}](${ORIGIN}/${lang}/articles/${article.slug}) — ${article.tag}, ${article.readTime}`,
    )
    .join('\n');
const articleSections = LANGS.map(
  (lang) => `## Articles (${lang.toUpperCase()})\n\n${bullets(content[lang], lang)}`,
).join('\n\n');

writeFileSync(
  resolve(OUT, 'llms.txt'),
  `# super-dev.app

> ${content[primary].bio}

Portfolio of a full-stack .NET / Angular / Azure developer, presented as a "YouTube channel".
Language is a URL prefix (${LANGS.map((lang) => `\`/${lang}\``).join(', ')}).

${articleSections}

## Sections

- [About](${ORIGIN}/${primary}/about)
- [Stack](${ORIGIN}/${primary}/stack)
- [Series](${ORIGIN}/${primary}/series)
- [Contact](${ORIGIN}/${primary}/contact)
`,
);

console.log(
  `✓ sitemap.xml (${concepts.length} urls × ${LANGS.length} langs), robots.txt, llms.txt → ${OUT}`,
);
