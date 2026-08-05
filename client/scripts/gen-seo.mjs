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

// --- concept routes: one <url> PER LOCALE (each carrying the full hreflang cluster), with a
// real lastmod — the article's own date on its page, the newest member date on a series page,
// the newest article date on the evolving pages (home + the two lists), none on the static
// pages (about/stack/contact: an invented date is worse than no claim).
const articles = content[DEFAULT_LANG].articles;
const newest = articles.map((article) => article.date).sort().at(-1);
const seriesLastmod = (series) => {
  const dates = articles
    .filter((article) => article.series === series.slug)
    .map((article) => article.date);

  return dates.length > 0 ? dates.sort().at(-1) : null;
};

const projectSlugs = content[DEFAULT_LANG].projectScenes
  .filter((project) => project.slug)
  .map((project) => project.slug);

const localized = (path) =>
  Object.fromEntries(LANGS.map((lang) => [lang, path ? `/${lang}/${path}` : `/${lang}`]));
const concepts = [
  ...['', 'articles', 'series'].map((path) => ({ paths: localized(path), lastmod: newest })),
  // Static/index pages carry no lastmod — an invented date is worse than no claim.
  ...['about', 'stack', 'contact', 'projects'].map((path) => ({
    paths: localized(path),
    lastmod: null,
  })),
  ...articles.map((article) => ({
    paths: localized(`articles/${article.slug}`),
    lastmod: article.date,
  })),
  ...content[DEFAULT_LANG].series.map((series) => ({
    paths: localized(`series/${series.slug}`),
    lastmod: seriesLastmod(series),
  })),
  ...projectSlugs.map((slug) => ({ paths: localized(`projects/${slug}`), lastmod: null })),
];

const urls = concepts
  .flatMap((concept) => {
    const alts = LANGS.map(
      (lang) =>
        `    <xhtml:link rel="alternate" hreflang="${lang}" href="${ORIGIN}${concept.paths[lang]}"/>`,
    )
      .concat(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${concept.paths[DEFAULT_LANG]}"/>`,
      )
      .join('\n');
    const lastmod = concept.lastmod ? `\n    <lastmod>${concept.lastmod}</lastmod>` : '';

    return LANGS.map(
      (lang) => `  <url>\n    <loc>${ORIGIN}${concept.paths[lang]}</loc>${lastmod}\n${alts}\n  </url>`,
    );
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

// The person as an entity (name → handle → role → projects → profiles), so an assistant reading
// llms.txt learns WHO this is, not only the article catalogue. Facts derived from the content;
// "since 2017" is the content-consistent start year.
const person = content[primary];
const projectList = person.projectScenes
  .map((project) =>
    project.slug
      ? `- [${project.name}](${ORIGIN}/${primary}/projects/${project.slug}) — ${project.metric} (${project.stack.join(', ')})`
      : `- **${project.name}** — ${project.metric} (${project.stack.join(', ')})`,
  )
  .join('\n');

writeFileSync(
  resolve(OUT, 'llms.txt'),
  `# super-dev.app

> ${person.bio}

Portfolio of a .NET / Angular / Azure technical lead, presented as a "YouTube channel".
Language is a URL prefix (${LANGS.map((lang) => `\`/${lang}\``).join(', ')}).

## About ${person.author}

${person.author} (also **Nayruuu** on GitHub) — ${person.metaTitle}. Active since 2017; designs,
industrialises and operates SaaS platforms on Azure, and publishes open-source software engines.

- Role: ${person.metaTitle}
- Active since: 2017
- Core stack: .NET, C#, Angular, TypeScript, Azure, Terraform, GraphQL
- GitHub: https://github.com/Nayruuu
- LinkedIn: https://www.linkedin.com/in/st%C3%A9phane-d-930048b3/
- Malt: https://www.malt.fr/profile/stephanedetodaro1
- CV: ${ORIGIN}/cv/stephane-de-todaro-fr.pdf

### Projects & open source

${projectList}

${articleSections}

## Sections

- [About](${ORIGIN}/${primary}/about)
- [Projects](${ORIGIN}/${primary}/projects)
- [Stack](${ORIGIN}/${primary}/stack)
- [Series](${ORIGIN}/${primary}/series)
- [Contact](${ORIGIN}/${primary}/contact)
`,
);

console.log(
  `✓ sitemap.xml (${concepts.length} concepts × ${LANGS.length} langs = ${concepts.length * LANGS.length} urls), robots.txt, llms.txt → ${OUT}`,
);
