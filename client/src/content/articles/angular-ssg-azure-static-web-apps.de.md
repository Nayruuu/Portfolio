Eine klassische Angular-SPA liefert Crawlern eine leere Seite: Solange das JS nicht ausgeführt wurde, gibt es nichts zu indexieren. Die **statische Site-Generierung** (SSG) löst das, indem sie jede Route beim Build zu HTML vorrendert. In Kombination mit **Azure Static Web Apps** erhält man eine serverlose, sofort verfügbare und perfekt indexierte Website.

## Natives Prerendering, ohne Node-Server

Mit `@angular/ssr` rendert der Modus `outputMode: 'static'` **alle Routen** beim Kompilieren vor und gibt ausschließlich statische Dateien aus — kein Node-Server muss gehostet werden. Das macht das Deployment auf Azure SWA trivial: Man pusht lediglich einen `browser/`-Ordner.

```yaml
# angular.json — extrait de la cible de build
"outputMode": "static",
"prerender": true,
"ssr": {
  "entry": "src/server.ts"
}
```

### Die Falle der parametrisierten Routen

Eine übergeordnete Route `:lang` mit einem funktionalen `redirectTo` **zerstört** das Prerendering: der `<router-outlet>` wird leer ausgegeben. Die Lösung besteht darin, zwei explizite statische Bäume (`/fr` und `/en`) statt eines Parameters zu verwenden. Die Sprache wird zu einem URL-Präfix, kein Parameter.

## Azure Static Web Apps konfigurieren

Azure SWA liest eine `staticwebapp.config.json`-Datei im Stammverzeichnis des Deployments. Der SPA-Fallback ist dort unverzichtbar, damit das Client-Routing bei nicht vorgerenderten Routen einspringt, ohne einen 404-Fehler zurückzugeben.

```yaml
# staticwebapp.config.json (équivalent)
navigationFallback:
  rewrite: /index.html
  exclude:
    - /assets/*
    - /*.{css,js,png,svg}
mimeTypes:
  .json: application/json
```

## Vollständiges SEO zur Kompilierzeit

Ein Post-Build-Skript generiert `sitemap.xml`, `robots.txt` und `llms.txt`, während der `SeoService` die `<title>`-Tags, **Open Graph**-Tags, `canonical`, `hreflang` und das JSON-LD `BlogPosting` Route für Route setzt. Da alles im vorgerenderten HTML enthalten ist, können Crawler und KI den Inhalt abrufen, **ohne eine einzige Zeile JS auszuführen**. Die Azure-Dokumentation erläutert die Konfiguration im Leitfaden [Static Web Apps configuration](https://learn.microsoft.com/azure/static-web-apps/configuration).

> SSG ist nicht nur eine SEO-Optimierung: Es ist eine Website, die sich anzeigt, noch bevor JS heruntergeladen wurde. Die **Time-to-Content** wird unabhängig von der Verbindung des Besuchers.
