Ein klassisches Angular-SPA schickt Crawlern eine leere Seite: Solange das JS nicht
gelaufen ist, gibt es nichts zu indexieren. Die **statische Site-Generierung** (SSG) löst
das, indem jede Route beim Build zu HTML vorgerendert wird. Kombiniert mit **Azure Static
Web Apps** erhält man eine Website ohne zu hostenden Server. Jede Seite kommt als
vollständiges HTML an, bereits indexierbar.

## Natives Prerendering, ohne Node-Server

Seit `@angular/ssr` rendert der Modus `outputMode: 'static'` **alle Routen** bei der
Kompilierung vor und liefert nur statische Dateien aus, ganz ohne zu hostenden Node-Server.
Das macht das Deployment auf Azure SWA trivial: Man pusht einen `browser/`-Ordner.

```yaml
# angular.json — build target excerpt
"outputMode": "static",
"prerender": true,
"ssr": {
  "entry": "src/server.ts"
}
```

### Die Falle der parametrisierten Routen

Eine übergeordnete `:lang`-Route mit einem funktionalen `redirectTo` **bricht** das
Prerendering: Das `<router-outlet>` bleibt leer. Die Abhilfe besteht darin, zwei explizite
statische Bäume (`/fr` und `/en`) statt eines Parameters bereitzustellen. Die Sprache wird
zu einem URL-Präfix, nicht zu einem Parameter.

## Azure Static Web Apps konfigurieren

Azure SWA liest eine Datei `staticwebapp.config.json` im Stammverzeichnis des Deployments.
Der SPA-Fallback ist dort essenziell, damit das clientseitige Routing bei nicht
vorgerenderten Routen übernimmt, ohne einen 404 zurückzugeben.

```yaml
# staticwebapp.config.json (Äquivalent)
navigationFallback:
  rewrite: /index.html
  exclude:
    - /assets/*
    - /*.{css,js,png,svg}
mimeTypes:
  .json: application/json
```

## Vollständiges SEO zur Kompilierzeit

Ein Post-Build-Skript generiert `sitemap.xml`, `robots.txt` und `llms.txt`, während der
`SeoService` die `<title>`, **Open-Graph**-Tags, `canonical`, `hreflang` und das JSON-LD
`BlogPosting` Route für Route setzt.

Da alles im vorgerenderten HTML steckt, holen sich Crawler und KI den Inhalt, **ohne eine
einzige Zeile JS auszuführen**. Die Azure-Dokumentation beschreibt die Konfiguration im
Leitfaden [Static Web Apps configuration](https://learn.microsoft.com/azure/static-web-apps/configuration).

> SSG leistet mehr als nur SEO: Die Seite wird angezeigt, noch bevor das JS überhaupt
> heruntergeladen wurde. Die **Time-to-Content** wird unabhängig von der Verbindung des
> Besuchers.
