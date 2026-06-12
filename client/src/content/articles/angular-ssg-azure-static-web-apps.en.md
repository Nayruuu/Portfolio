A plain Angular SPA serves a blank page to crawlers: until the JS runs, there's nothing to
index. **Static site generation** (SSG) fixes this by prerendering every route to HTML at
build time. Paired with **Azure Static Web Apps**, you get a serverless, instant, and
perfectly indexed site.

## Native prerender, no Node server

With `@angular/ssr`, the `outputMode: 'static'` mode prerenders **all routes** at compile
time and emits only static files — no Node server to host. That's what makes deploying to
Azure SWA trivial: you push a `browser/` folder.

```yaml
# angular.json — build target excerpt
"outputMode": "static",
"prerender": true,
"ssr": {
  "entry": "src/server.ts"
}
```

### The parameterized-route trap

A `:lang` parent route with a functional `redirectTo` **breaks** prerendering: the
`<router-outlet>` comes out empty. The fix is to expose two explicit static trees (`/fr` and
`/en`) rather than a parameter. Language becomes a URL prefix, not a param.

## Configuring Azure Static Web Apps

Azure SWA reads a `staticwebapp.config.json` file at the deployment root. The SPA fallback is
essential so that client routing takes over for non-prerendered routes, instead of returning
a 404.

```yaml
# staticwebapp.config.json (equivalent)
navigationFallback:
  rewrite: /index.html
  exclude:
    - /assets/*
    - /*.{css,js,png,svg}
mimeTypes:
  .json: application/json
```

## Full SEO at compile time

A post-build script generates `sitemap.xml`, `robots.txt` and `llms.txt`, while the
`SeoService` sets `<title>`, **Open Graph** tags, `canonical`, `hreflang` and the
`BlogPosting` JSON-LD route by route. Since everything lives in the prerendered HTML,
crawlers and AI grab the content **without running a single line of JS**. The Azure docs
cover the config in the [Static Web Apps configuration](https://learn.microsoft.com/azure/static-web-apps/configuration) guide.

> SSG isn't just an SEO optimization: it's a site that paints before the JS is even
> downloaded. **Time-to-content** becomes independent of the visitor's connection.
