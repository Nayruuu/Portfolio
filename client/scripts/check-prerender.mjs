#!/usr/bin/env node
/**
 * Garde de contenu prérendu : prouve que chaque article est réellement servi en
 * HTML statique — corps Markdown rendu + données structurées — sans exécuter JS.
 *
 * Le `webServer` Playwright est `ng serve` (pas de prérendu) : un test « JS off »
 * y verrait la coquille SPA vide. La garantie « découvrable sans JS » est donc une
 * assertion sur la SORTIE de build (`dist/.../browser/<lang>/articles/<slug>/`),
 * pas un test e2e. Pour CHAQUE slug d'article × CHAQUE langue, ce script vérifie :
 *   - le fichier `index.html` existe ;
 *   - le JSON-LD contient `"@type":"BlogPosting"` et la `datePublished` du JSON ;
 *   - la région `article-detail__body` contient du texte substantiel (le parser
 *     Markdown a bien tourné au prérendu, pas juste une coquille) ;
 *   - aucun Markdown brut n'a fui dans le corps (pas de `**` littéral = le gras a
 *     été rendu) — vérifié SUR LA RÉGION DU CORPS, pas tout le HTML.
 * Affiche un résumé `✓`/`✗` et `process.exit(1)` au moindre échec. À lancer APRÈS
 * le build statique (`ng build --configuration production && npm run gen:seo`).
 */
import { readFileSync } from 'node:fs';

const BROWSER_DIR = 'dist/super-dev-portfolio/browser';
const CONTENT = 'src/app/core/content/content.fr.json';
const LANGS = ['fr', 'en'];
const BODY_MARKER = 'class="article-detail__body"';
const BODY_END_MARKER = 'article-detail__signature';
const MIN_BODY_TEXT = 200;

let articles;
try {
  articles = JSON.parse(readFileSync(CONTENT, 'utf8')).articles;
} catch {
  console.error(`✗ Contenu introuvable: ${CONTENT}`);
  process.exit(1);
}

/** Extrait le texte (balises retirées) de la région du corps de l'article. */
function bodyRegion(html) {
  const start = html.indexOf(BODY_MARKER);
  if (start < 0) {
    return null;
  }
  const end = html.indexOf(BODY_END_MARKER, start);

  return html.slice(start, end >= 0 ? end : undefined);
}

const failures = [];
let checked = 0;
for (const article of articles) {
  for (const lang of LANGS) {
    const path = `${BROWSER_DIR}/${lang}/articles/${article.slug}/index.html`;
    const label = `${lang}/${article.slug}`;
    let html;
    try {
      html = readFileSync(path, 'utf8');
    } catch {
      failures.push(`  ${label} → fichier prérendu manquant (${path})`);
      continue;
    }

    checked += 1;

    if (!html.includes('"@type":"BlogPosting"')) {
      failures.push(`  ${label} → JSON-LD BlogPosting absent`);
    }
    if (!html.includes(`"datePublished":"${article.date}"`)) {
      failures.push(`  ${label} → datePublished "${article.date}" absente du JSON-LD`);
    }

    const region = bodyRegion(html);
    if (region === null) {
      failures.push(`  ${label} → région ${BODY_MARKER} absente`);
      continue;
    }

    const text = region
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < MIN_BODY_TEXT) {
      failures.push(`  ${label} → corps trop court (${text.length} < ${MIN_BODY_TEXT} car.)`);
    }
    // Scan for leaked bold on PROSE only: `**` is legitimate inside rendered code
    // (globs like `packages/**`, operators), so strip code blocks + inline code first.
    const prose = region
      .replace(/<sd-code-block[\s\S]*?<\/sd-code-block>/gi, ' ')
      .replace(/<code[\s\S]*?<\/code>/gi, ' ');
    if (prose.includes('**')) {
      failures.push(`  ${label} → Markdown brut fuité (\`**\`) dans le corps (prose)`);
    }
  }
}

if (failures.length) {
  console.error('✗ Contenu prérendu invalide :');
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`✓ ${checked} pages d'article prérendues (JSON-LD + corps Markdown rendu, sans JS)`);
