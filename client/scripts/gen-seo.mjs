import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const OUT = resolve(APP_ROOT, 'dist/super-dev-portfolio/browser');
const ORIGIN = process.env.SITE_ORIGIN ?? 'https://super-dev.app';

const read = (lang) =>
  JSON.parse(readFileSync(resolve(APP_ROOT, `src/app/core/content/content.${lang}.json`), 'utf8'));
const content = { fr: read('fr'), en: read('en') };

// --- concept routes (one <url>, hreflang alternates inside) ---
const STATIC = ['', 'articles', 'series', 'about', 'stack', 'contact'];
const concepts = [];
for (const p of STATIC) concepts.push({ fr: p ? `/fr/${p}` : '/fr', en: p ? `/en/${p}` : '/en' });
content.fr.articles.forEach((article) =>
  concepts.push({ fr: `/fr/articles/${article.slug}`, en: `/en/articles/${article.slug}` }),
);
content.fr.series.forEach((series) =>
  concepts.push({ fr: `/fr/series/${series.slug}`, en: `/en/series/${series.slug}` }),
);

const today = new Date().toISOString().slice(0, 10);
const urls = concepts
  .map((concept) => {
    const alts = [
      `    <xhtml:link rel="alternate" hreflang="fr" href="${ORIGIN}${concept.fr}"/>`,
      `    <xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}${concept.en}"/>`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${concept.fr}"/>`,
    ].join('\n');

    return `  <url>\n    <loc>${ORIGIN}${concept.fr}</loc>\n    <lastmod>${today}</lastmod>\n${alts}\n  </url>`;
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
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
];
writeFileSync(
  resolve(OUT, 'robots.txt'),
  `${AGENTS.map((ua) => `User-agent: ${ua}\nAllow: /`).join('\n\n')}

User-agent: *
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`,
);

// --- llms.txt ---
const bullets = (content, lang) =>
  content.articles
    .map(
      (article) =>
        `- [${article.title}](${ORIGIN}/${lang}/articles/${article.slug}) — ${article.tag}, ${article.readTime}`,
    )
    .join('\n');
writeFileSync(
  resolve(OUT, 'llms.txt'),
  `# super-dev.app

> ${content.en.bio}

Portfolio of a full-stack .NET / Angular / Azure developer, presented as a "YouTube channel".
Bilingual (FR/EN); language is a URL prefix (\`/fr\`, \`/en\`).

## Articles (EN)

${bullets(content.en, 'en')}

## Articles (FR)

${bullets(content.fr, 'fr')}

## Sections

- [About](${ORIGIN}/en/about)
- [Stack](${ORIGIN}/en/stack)
- [Series](${ORIGIN}/en/series)
- [Contact](${ORIGIN}/en/contact)
`,
);

console.log(`✓ sitemap.xml (${concepts.length} urls), robots.txt, llms.txt → ${OUT}`);
