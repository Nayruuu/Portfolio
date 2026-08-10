An Angular SPA first serves an empty shell. The initial HTML contains only an `<app-root>` and
a bundle to download; content only appears once the JavaScript runs. For a crawler
that doesn't execute this JS, or executes it under a tight budget, the page is blank at the moment
it decides what to index.

Static site generation (SSG) moves rendering to build time: each route is
prerendered into complete HTML, written to a file, served as-is. This portfolio pushes the
principle to its limit. No route depends on a Node server at runtime, and a guard script
refuses to ship a build where an article would have lost its content. The wiring runs from `angular.json`
all the way to the GitHub workflow that deploys to Azure Static Web Apps.

## Native prerendering, no Node server

Angular exposes prerendering via `@angular/ssr`. The lever sits in the build target.

```json
// angular.json — build options (excerpt)
"server": "src/main.server.ts",
"outputMode": "static"
```

`outputMode: "static"` tells the builder to prerender every declared route and emit only
files: `main.server.ts` is used for rendering at compile time, not at runtime. The output
lands in `dist/super-dev-portfolio/browser/`, a folder of static HTML, CSS and JS. Nothing to
run server-side, exactly what a file host like Azure SWA expects.

Hydration stays active on the client. `provideClientHydration(withEventReplay())` reboots
the application on top of the already-present HTML, without re-rendering the DOM. The first paint comes
from the file, interactivity comes from the bundle once loaded.

## A static tree per language, never a `:lang` param

The language is a URL prefix (`/fr`, `/en`, `/es`, `/de`). The natural temptation is a parameterized
parent route `:lang` with a `redirectTo`. It breaks native prerendering: the
`<router-outlet>` comes out empty in the generated HTML.

The workaround is to emit an explicit static tree per language. A `LANGS.map` builds a parent route
per language whose `path` is a literal string (`fr`, `en`…), not a parameter; two
fallback routes complete the set, a `''` that redirects to the default language and a `**`
catch-all to the same target.

Prerendering then sees concrete routes to freeze. Adding a language stays a single line in
`LANGS`: the trees, the sitemap and the `hreflang` tags all get derived from this list.

The `langResolver` sets the locale before the component renders, so that prerendering and the first
paint start from the right language.

## Enumerating slugs to freeze

Detail pages (articles, series, projects) carry a `:slug`. Prerendering cannot
guess these values, they have to be supplied. `getPrerenderParams` returns the list, read
directly from the FR content.

```ts
const articleParams = async () => contentFr.articles.map((a) => ({ slug: a.slug }));

export const serverRoutes: ServerRoute[] = [
  ...LANGS.flatMap((lang): ServerRoute[] => [
    {
      path: `${lang}/articles/:slug`,
      renderMode: RenderMode.Prerender,
      getPrerenderParams: articleParams,
    },
    // …series, projects
  ]),
  { path: '**', renderMode: RenderMode.Prerender },
];
```

The `flatMap` over `LANGS` produces a set of routes per language; for each one, every article slug
becomes a page. The `**` catch-all in `RenderMode.Prerender` covers the remaining static pages
(`/fr`, `/en/about`…). Everything is prerendered, no exceptions: that's the condition for `outputMode:
static` to have no server left running.

Detail components read their `:slug` via `input()` (`withComponentInputBinding`), so the
same page rehydrates cleanly on the client.

## The guard that refuses a silent build

Prerendering the HTML doesn't guarantee it contains anything. A component that fails
silently during server-side rendering, a Markdown parser that doesn't run, a missing social
card: the build still passes, and the article ships live emptied of its substance.

The e2e tests don't catch it. Playwright's `webServer` is `ng serve`, which doesn't prerender
anything: a "JS off" test would see the SPA shell there, never the frozen HTML. The
"discoverable without JS" guarantee is therefore an assertion on the build output, not a browser test.

`check-prerender.mjs` fills this gap. For every article slug and every language, it reads
the produced `index.html` and enforces four requirements. The JSON-LD must contain `"@type":"BlogPosting"`
and the exact `datePublished` drawn from the content. The `og/<slug>.<lang>.jpg` social card must exist
in the build and be referenced by the page. The `article-detail__body` region must carry at least
200 characters of text once tags are stripped, proof that the Markdown was rendered. Finally,
no `**` should remain in the prose, which would betray unconverted Markdown; the check first
excludes code blocks, where `**` is a legitimate operator or glob.

```js
// Fail the build the moment a prerendered article loses its body.
const text = region.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
if (text.length < MIN_BODY_TEXT) {
  failures.push(`  ${label} → corps trop court (${text.length} < ${MIN_BODY_TEXT} car.)`);
}
```

At the slightest failure, `process.exit(1)`, and the build breaks. This script is the last step in
`build:ssg`, whose order matters: `gen:read-times` recomputes reading times from the actual
word count before compilation, `ng build --configuration production` prerenders, `gen:seo` writes
the sitemap, robots and llms into the shipped folder, and `check-prerender.mjs` validates the whole thing. This is the exact
chain the deployment workflow runs.

## SEO frozen in the `<head>`

Prerendering only captures what's present in the `<head>` at the moment the route is ready. The
`SeoService` therefore writes title, description, Open Graph, `canonical`, `hreflang` and JSON-LD in an
idempotent way: each tag is set or replaced, never duplicated, so that re-navigating
leaves exactly one copy of each.

For an article, the service injects a `BlogPosting` JSON-LD graph (headline, dates, author,
publisher, image) paired with a `BreadcrumbList`. The detail component drives it in an `effect` that
reacts to the current article and the language: on every change, `seo.update` rewrites the tags and
`seo.setArticleJsonLd` replaces the graph, always set-or-replace.

In parallel, `gen:seo` produces the site artifacts after the build. The `sitemap.xml` emits each
concept (page, article, series) once per language, each `<url>` carrying its full cluster of
`hreflang` tags and a real `lastmod`: the article's own date on its own page, the most recent one on
pages that evolve, no invented date on static pages (a fake `lastmod` is worse than
no `lastmod`). The `robots.txt` explicitly allows AI crawlers (GPTBot, ClaudeBot,
PerplexityBot…) alongside traditional search engines, and an `llms.txt` lists the articles and describes
the author as an entity.

Since all this content lives in the prerendered HTML, a crawler retrieves it without executing a single line of
JavaScript.

## Azure SWA's edge configuration

Azure Static Web Apps reads a `staticwebapp.config.json` at the root of the deployment. Here it fits in
seventeen lines.

```json
{
  "trailingSlash": "never",
  "globalHeaders": {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp"
  },
  "routes": [
    { "route": "/", "redirect": "/fr", "statusCode": 301 },
    { "route": "/bsp", "headers": { "X-Robots-Tag": "noindex" } },
    {
      "route": "/*.{css,js,mjs}",
      "headers": { "Cache-Control": "public, max-age=31536000, immutable" }
    }
  ],
  "responseOverrides": { "404": { "rewrite": "/404.html" } },
  "mimeTypes": { ".json": "application/json", ".webp": "image/webp", ".svg": "image/svg+xml" }
}
```

The `/` root redirects to `/fr` with a 301: the canonical home is localized. The two global
headers `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` isolate the document
(cross-origin isolation), a requirement for the embedded game engine's `SharedArrayBuffer` to
work inside its worker. They must stay global, not scoped to a single route, otherwise the worker
loses access to the shared buffer. Hashed bundles (`*.css`, `*.js`, `*.mjs`) ship with a one-year
immutable cache, safe because `outputHashing: all` changes the file name as soon as its content
changes.

One notable thing by its absence: no `navigationFallback`. The classic SPA fallback (unknown
route rewritten to `index.html`) has no reason to exist, since every route is already prerendered
into its own `index.html`. SWA serves the file directly, and a truly unknown URL falls
through to `404.html` via `responseOverrides`. The details of the keys are in the
[Static Web Apps configuration guide](https://learn.microsoft.com/azure/static-web-apps/configuration).

## Deployment, with no stored secret

The `deploy-client.yml` workflow triggers when `client/**` changes on `main`. It stores
no Azure secret: the connection goes through OIDC (`azure/login` with `id-token: write`), and even the
SWA deployment token is read at runtime, via `az staticwebapp secrets list … --query
properties.apiKey`, then injected into the job's environment. No key is frozen in the repo's
secrets.

The rest is direct. `npm ci`, `npm run build:ssg` (the full chain, guard included), then
`swa deploy dist/super-dev-portfolio/browser` with the freshly-read token. The `browser/` folder
is the entire site: there's no server artifact alongside it.

A final step pings IndexNow, after deployment and never before, so that the key file
is live when the search engines validate it. It's non-blocking by design: a failed hint
shouldn't fail an already-successful deployment.

> SSG goes beyond the sole question of ranking. Every page exists as HTML before any
> JavaScript, its language and structured data frozen at build time, and a script breaks the delivery
> if any of them come out empty. Time-to-content no longer depends on the visitor's connection nor
> on a bundle's execution.
