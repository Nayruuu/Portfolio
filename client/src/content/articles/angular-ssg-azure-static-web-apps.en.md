A classic Angular SPA sends crawlers a blank page: until the JS has run, there's nothing
to index. **Static site generation** (SSG) fixes this by prerendering every route to HTML
at build time. Paired with **Azure Static Web Apps**, you get a site with no server to
host. Every page ships as complete HTML, already indexable.

## Native prerendering, no Node server

Since `@angular/ssr`, the `outputMode: 'static'` mode prerenders **every route** at
compile time and emits only static files, with no Node server to host at all. This is
what makes deploying to Azure SWA trivial: you push a `browser/` folder.

```yaml
# angular.json — build target excerpt
"outputMode": "static",
"prerender": true,
"ssr": {
  "entry": "src/server.ts"
}
```

### The parameterized-route trap

A parent `:lang` route with a functional `redirectTo` **breaks** prerendering: the
`<router-outlet>` comes out empty. The fix is to expose two explicit static trees
(`/fr` and `/en`) instead of a parameter. The language becomes a URL prefix, not a param.

## Configuring Azure Static Web Apps

Azure SWA reads a `staticwebapp.config.json` file at the root of the deployment. The SPA
fallback is essential there so client-side routing can take over on routes that weren't
prerendered, instead of returning a 404.

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

A post-build script generates `sitemap.xml`, `robots.txt`, and `llms.txt`, while the
`SeoService` sets `<title>`, **Open Graph** tags, `canonical`, `hreflang`, and the
`BlogPosting` JSON-LD, route by route.

Since everything is in the prerendered HTML, crawlers and AI retrieve the content
**without executing a single line of JS**. The Azure docs cover the config in the
[Static Web Apps configuration](https://learn.microsoft.com/azure/static-web-apps/configuration) guide.

> SSG does more than SEO: the page renders before the JS is even downloaded.
> **Time-to-content** becomes independent of the visitor's connection.
