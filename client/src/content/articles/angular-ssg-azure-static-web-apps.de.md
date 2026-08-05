Ein Angular-SPA liefert zunächst eine leere Hülle. Das initiale HTML enthält nur ein `<app-root>` und
ein herunterzuladendes Bundle; der Inhalt erscheint erst, nachdem das JavaScript ausgeführt wurde. Für einen Crawler,
der dieses JS nicht ausführt, oder der es mit knappem Budget ausführt, ist die Seite in dem Moment weiß,
in dem er entscheidet, was indexiert werden soll.

Static Site Generation (SSG) verlagert das Rendering auf den Build-Zeitpunkt: Jede Route wird
zu vollständigem HTML vorgerendert, in eine Datei geschrieben und unverändert ausgeliefert. Dieses Portfolio treibt das
Prinzip auf die Spitze. Keine Route hängt zur Laufzeit von einem Node-Server ab, und ein Guard-Skript
verweigert die Auslieferung eines Builds, bei dem ein Artikel seinen Inhalt verloren hätte. Die Verdrahtung reicht von `angular.json`
bis zum GitHub-Workflow, der auf Azure Static Web Apps deployt.

## Natives Prerendering, ohne Node-Server

Angular bietet Prerendering über `@angular/ssr`. Der Hebel liegt im Build-Ziel.

```json
// angular.json — build options (excerpt)
"server": "src/main.server.ts",
"outputMode": "static"
```

`outputMode: "static"` verlangt vom Builder, jede deklarierte Route vorzurendern und nur
Dateien auszugeben: `main.server.ts` dient dem Rendering zur Kompilierzeit, nicht zur Laufzeit. Die Ausgabe
landet in `dist/super-dev-portfolio/browser/`, einem Ordner mit statischem HTML, CSS und JS. Nichts, was
serverseitig laufen müsste — genau das, was ein Datei-Hoster wie Azure SWA erwartet.

Die Hydration bleibt clientseitig aktiv. `provideClientHydration(withEventReplay())` startet die
Anwendung auf dem bereits vorhandenen HTML neu, ohne das DOM neu zu rendern. Die erste Anzeige stammt
aus der Datei, die Interaktivität aus dem Bundle, sobald es geladen ist.

## Ein statischer Baum pro Sprache, niemals ein `:lang`-Parameter

Die Sprache ist ein URL-Präfix (`/fr`, `/en`, `/es`, `/de`). Die naheliegende Versuchung ist eine
parametrisierte Elternroute `:lang` mit einem `redirectTo`. Sie bricht das native Prerendering: Der
`<router-outlet>` bleibt im generierten HTML leer.

Die Lösung besteht darin, pro Sprache einen expliziten statischen Baum auszugeben. Eine `LANGS.map`-Konstruktion baut eine
Elternroute pro Sprache, deren `path` eine literale Zeichenkette ist (`fr`, `en`…), kein Parameter; zwei
Fallback-Routen vervollständigen das Ganze, ein `''`, das zur Standardsprache umleitet, und ein `**`-
Catch-all zum selben Ziel.

Das Prerendering sieht dann konkrete Routen, die eingefroren werden können. Eine Sprache hinzuzufügen bleibt eine einzige Zeile in
`LANGS`: Die Bäume, die Sitemap und die `hreflang`s leiten sich alle aus dieser Liste ab.

Der `langResolver` setzt die Locale, bevor die Komponente gerendert wird, damit Prerendering und erster
Paint mit der richtigen Sprache starten.

## Die einzufrierenden Slugs auflisten

Die Detailseiten (Artikel, Serien, Projekte) tragen einen `:slug`. Das Prerendering kann diese
Werte nicht erraten, sie müssen ihm geliefert werden. `getPrerenderParams` liefert die Liste, die direkt
aus dem FR-Content gelesen wird.

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

Der `flatMap` über `LANGS` erzeugt einen Satz Routen pro Sprache; für jede wird jeder Artikel-Slug
zu einer Seite. Der Catch-all `**` mit `RenderMode.Prerender` deckt die übrigen statischen Seiten ab
(`/fr`, `/en/about`…). Alles wird vorgerendert, ohne Ausnahme: Das ist die Bedingung dafür, dass `outputMode:
static` keinen laufenden Server benötigt.

Die Detail-Komponenten lesen ihren `:slug` über `input()` (`withComponentInputBinding`), sodass
dieselbe Seite sich clientseitig sauber rehydriert.

## Der Guard, der einen stummen Build verweigert

Das Vorrendern des HTML garantiert nicht, dass es etwas enthält. Eine Komponente, die beim serverseitigen
Rendering still fehlschlägt, ein Markdown-Parser, der nicht läuft, eine fehlende Social Card: Der
Build läuft trotzdem durch, und der Artikel geht seines Inhalts entleert online.

Die e2e-Tests fangen das nicht ab. Der `webServer` von Playwright ist `ng serve`, der nichts vorrendert:
Ein Test „JS abgeschaltet“ würde dort nur die SPA-Hülle sehen, nie das eingefrorene HTML. Die Garantie
„ohne JS auffindbar“ ist also eine Assertion auf die Build-Ausgabe, kein Browser-Test.

`check-prerender.mjs` schließt diese Lücke. Für jeden Artikel-Slug und jede Sprache liest es die
erzeugte `index.html` und stellt vier Anforderungen. Das JSON-LD muss `"@type":"BlogPosting"`
und das exakte `datePublished` aus dem Content enthalten. Die Social Card `og/<slug>.<lang>.jpg` muss im
Build existieren und von der Seite referenziert werden. Der Bereich `article-detail__body` muss mindestens
200 Zeichen Text tragen, nachdem die Tags entfernt wurden — der Beweis, dass das Markdown gerendert wurde. Schließlich
darf kein `**` im Fließtext übrig bleiben, was auf nicht konvertiertes Markdown hindeuten würde; die Prüfung
schließt zunächst Codeblöcke aus, wo `**` ein legitimer Operator oder Glob ist.

```js
// Fail the build the moment a prerendered article loses its body.
const text = region.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
if (text.length < MIN_BODY_TEXT) {
  failures.push(`  ${label} → corps trop court (${text.length} < ${MIN_BODY_TEXT} car.)`);
}
```

Beim geringsten Fehler folgt `process.exit(1)`, und der Build bricht. Dieses Skript ist der letzte Schritt von
`build:ssg`, dessen Reihenfolge zählt: `gen:read-times` berechnet die Lesezeiten aus der echten
Wortzahl neu, bevor kompiliert wird, `ng build --configuration production` rendert vor, `gen:seo` schreibt
Sitemap, robots und llms in den ausgelieferten Ordner, und `check-prerender.mjs` validiert das Ganze. Genau diese
Kette startet der Deployment-Workflow.

## Das SEO, eingefroren im `<head>`

Das Prerendering erfasst nur das, was im `<head>` vorhanden ist, sobald die Route bereit ist. Der
`SeoService` schreibt daher Titel, Beschreibung, Open Graph, `canonical`, `hreflang` und JSON-LD idempotent:
Jedes Tag wird gesetzt oder ersetzt, niemals dupliziert, damit eine erneute Navigation
genau ein Exemplar jedes Tags hinterlässt.

Für einen Artikel injiziert der Service einen JSON-LD-Graphen `BlogPosting` (headline, dates, auteur,
éditeur, image), ergänzt um eine `BreadcrumbList`. Die Detail-Komponente steuert ihn in einem `effect`, der
auf den aktuellen Artikel und die Sprache reagiert: Bei jeder Änderung schreibt `seo.update` die Tags neu und
`seo.setArticleJsonLd` ersetzt den Graphen, immer nach dem Prinzip Setzen-oder-Ersetzen.

Parallel dazu erzeugt `gen:seo` die Site-Artefakte nach dem Build. Die `sitemap.xml` gibt jedes
Konzept (Seite, Artikel, Serie) einmal pro Sprache aus, wobei jede `<url>` ihre vollständige Gruppe von
`hreflang` sowie ein echtes `lastmod` trägt: das Datum des Artikels auf seiner eigenen Seite, das jüngste
auf Seiten, die sich weiterentwickeln, kein erfundenes Datum auf statischen Seiten (ein falsches `lastmod` ist weniger wert als
gar kein `lastmod`). Die `robots.txt` erlaubt explizit KI-Crawler (GPTBot, ClaudeBot,
PerplexityBot…) zusätzlich zu den klassischen Suchmaschinen, und eine `llms.txt` listet die Artikel auf und beschreibt
den Autor als Entität.

Da all dieser Inhalt im vorgerenderten HTML lebt, erhält ein Crawler ihn, ohne eine einzige Zeile
JavaScript auszuführen.

## Die Edge-Konfiguration von Azure SWA

Azure Static Web Apps liest eine `staticwebapp.config.json` an der Wurzel des Deployments. Hier kommt sie mit
siebzehn Zeilen aus.

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

Die Wurzel `/` leitet mit 301 auf `/fr` um: Die kanonische Startseite ist lokalisiert. Die beiden globalen
Header `Cross-Origin-Opener-Policy` und `Cross-Origin-Embedder-Policy` isolieren das Dokument
(Cross-Origin-Isolation), Voraussetzung dafür, dass der `SharedArrayBuffer` der eingebetteten Spiel-Engine
in ihrem Worker funktioniert. Sie müssen global bleiben, nicht auf eine Route beschränkt, sonst verliert der Worker
den Zugriff auf den geteilten Buffer. Die gehashten Bundles (`*.css`, `*.js`, `*.mjs`) erhalten einen
unveränderlichen Ein-Jahres-Cache, sicher, weil `outputHashing: all` den Dateinamen ändert, sobald sich dessen Inhalt
ändert.

Ein Punkt, der durch seine Abwesenheit auffällt: kein `navigationFallback`. Der klassische SPA-Umschalter
(unbekannte Route wird zu `index.html` umgeschrieben) hat hier keine Daseinsberechtigung, da jede Route bereits in
ihrer eigenen `index.html` vorgerendert ist. SWA liefert die Datei direkt, und eine wirklich unbekannte URL landet
über `responseOverrides` auf `404.html`. Die Details zu den Schlüsseln stehen im Leitfaden
[configuration Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/configuration).

## Das Deployment, ohne gespeichertes Secret

Der Workflow `deploy-client.yml` löst aus, wenn sich `client/**` auf `main` ändert. Er speichert
kein Azure-Secret: Die Verbindung läuft über OIDC (`azure/login` mit `id-token: write`), und selbst das
SWA-Deployment-Token wird zur Laufzeit gelesen, über `az staticwebapp secrets list … --query
properties.apiKey`, und anschließend in die Umgebung des Jobs injiziert. Kein Schlüssel ist in den
Secrets des Repos festgeschrieben.

Der Rest ist direkt. `npm ci`, `npm run build:ssg` (die vollständige Kette, Guard inklusive), dann
`swa deploy dist/super-dev-portfolio/browser` mit dem frisch gelesenen Token. Der Ordner `browser/`
ist die gesamte Site: Es gibt kein Server-Artefakt daneben.

Ein letzter Schritt pingt IndexNow an, nach dem Deployment und niemals davor, damit die Key-Datei
online ist, wenn die Suchmaschinen sie validieren. Er ist von Natur aus nicht blockierend: ein fehlgeschlagener Hint
darf ein bereits erfolgreiches Deployment nicht scheitern lassen.

> SSG geht über die reine Frage des Rankings hinaus. Jede Seite existiert in HTML, bevor überhaupt
> JavaScript läuft, ihre Sprache und ihre strukturierten Daten sind zum Build-Zeitpunkt eingefroren, und ein Skript bricht die Auslieferung
> ab, wenn eine davon leer bleibt. Die Time-to-Content hängt nicht mehr von der Verbindung des Besuchers oder
> der Ausführung eines Bundles ab.
