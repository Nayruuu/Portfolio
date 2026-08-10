import { RenderMode, ServerRoute } from '@angular/ssr';
import contentFr from './core/content/content.fr.json';
import { PROJECT_SLUGS } from './core/lib';
import { LANGS } from './domain';

/** `[{ slug }, …]` — one prerendered page per article / series / project, keyed by slug. */
const articleParams = async () => contentFr.articles.map((article) => ({ slug: article.slug }));
const seriesParams = async () => contentFr.series.map((series) => ({ slug: series.slug }));
const projectParams = async () => PROJECT_SLUGS.map((slug) => ({ slug }));

/**
 * Full static SSG: every route is prerendered at build (no Node server at runtime →
 * deployable to Azure Static Web Apps). The parameterized detail routes enumerate their slugs for
 * each `Lang`; `**` covers the explicit static pages (`/fr`, `/en`, `/fr/about`, …).
 */
export const serverRoutes: ServerRoute[] = [
  ...LANGS.flatMap((lang): ServerRoute[] => [
    {
      path: `${lang}/articles/:slug`,
      renderMode: RenderMode.Prerender,
      getPrerenderParams: articleParams,
    },
    {
      path: `${lang}/series/:slug`,
      renderMode: RenderMode.Prerender,
      getPrerenderParams: seriesParams,
    },
    {
      path: `${lang}/projects/:slug`,
      renderMode: RenderMode.Prerender,
      getPrerenderParams: projectParams,
    },
  ]),
  { path: '**', renderMode: RenderMode.Prerender },
];
