Un SPA Angular sert d'abord une coquille vide. Le HTML initial ne contient qu'un `<app-root>` et
un bundle à télécharger ; le contenu n'apparaît qu'une fois le JavaScript exécuté. Pour un crawler
qui n'exécute pas ce JS, ou qui l'exécute avec un budget serré, la page est blanche au moment où
il décide quoi indexer.

La génération de site statique (SSG) déplace le rendu au moment du build : chaque route est
prérendue en HTML complet, écrite dans un fichier, servie telle quelle. Ce portfolio pousse le
principe au bout. Aucune route ne dépend d'un serveur Node à l'exécution, et un script de garde
refuse de livrer un build où un article aurait perdu son contenu. Le câblage va d'`angular.json`
jusqu'au workflow GitHub qui déploie sur Azure Static Web Apps.

## Le prérendu natif, sans serveur Node

Angular expose le prérendu via `@angular/ssr`. Le levier tient dans la cible de build.

```json
// angular.json — build options (excerpt)
"server": "src/main.server.ts",
"outputMode": "static"
```

`outputMode: "static"` demande au builder de prérendre chaque route déclarée et de n'émettre que
des fichiers : `main.server.ts` sert au rendu à la compilation, pas à l'exécution. La sortie
atterrit dans `dist/super-dev-portfolio/browser/`, un dossier de HTML, CSS et JS statiques. Rien à
faire tourner côté serveur, ce qu'attend exactement un hébergeur de fichiers comme Azure SWA.

L'hydratation reste active côté client. `provideClientHydration(withEventReplay())` réamorce
l'application sur le HTML déjà présent, sans re-rendre le DOM. Le premier affichage vient du
fichier, l'interactivité vient du bundle une fois chargé.

## Un arbre statique par langue, jamais de param `:lang`

La langue est un préfixe d'URL (`/fr`, `/en`, `/es`, `/de`). La tentation naturelle est une route
parente paramétrée `:lang` avec un `redirectTo`. Elle casse le prérendu natif : le
`<router-outlet>` ressort vide dans le HTML généré.

La parade est d'émettre un arbre statique explicite par langue. Un `LANGS.map` construit une route
parente par langue dont le `path` est une chaîne littérale (`fr`, `en`…), pas un paramètre ; deux
routes de repli complètent l'ensemble, un `''` qui redirige vers la langue par défaut et un `**`
attrape-tout vers la même cible.

Le prérendu voit alors des routes concrètes à figer. Ajouter une langue reste une seule ligne dans
`LANGS` : les arbres, le sitemap et les `hreflang` se déduisent tous de cette liste.

Le `langResolver` pose la locale avant le rendu du composant, pour que le prérendu et le premier
paint partent sur la bonne langue.

## Énumérer les slugs à figer

Les pages de détail (articles, séries, projets) portent un `:slug`. Le prérendu ne peut pas
deviner ces valeurs, il faut les lui fournir. `getPrerenderParams` renvoie la liste, lue
directement dans le contenu FR.

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

Le `flatMap` sur `LANGS` produit un jeu de routes par langue ; pour chacune, chaque slug d'article
devient une page. Le catch-all `**` en `RenderMode.Prerender` couvre les pages statiques restantes
(`/fr`, `/en/about`…). Tout est prérendu, sans exception : c'est la condition pour qu'`outputMode:
static` n'ait aucun serveur à laisser tourner.

Les composants de détail lisent leur `:slug` via `input()` (`withComponentInputBinding`), donc la
même page se réhydrate proprement côté client.

## La garde qui refuse un build muet

Prérender le HTML ne garantit pas qu'il contienne quelque chose. Un composant qui échoue en
silence au rendu serveur, un parser Markdown qui ne tourne pas, une carte sociale absente : le
build passe quand même, et l'article part en ligne vidé de sa substance.

Les tests e2e ne l'attrapent pas. Le `webServer` de Playwright est `ng serve`, qui ne prérend
rien : un test « JS coupé » y verrait la coquille SPA, jamais le HTML figé. La garantie
« découvrable sans JS » est donc une assertion sur la sortie de build, pas un test de navigateur.

`check-prerender.mjs` comble ce trou. Pour chaque slug d'article et chaque langue, il lit
l'`index.html` produit et pose quatre exigences. Le JSON-LD doit contenir `"@type":"BlogPosting"`
et la `datePublished` exacte tirée du contenu. La carte sociale `og/<slug>.<lang>.jpg` doit exister
dans le build et être référencée par la page. La région `article-detail__body` doit porter au moins
200 caractères de texte une fois les balises retirées, preuve que le Markdown a été rendu. Enfin,
aucun `**` ne doit subsister dans la prose, ce qui trahirait du Markdown non converti ; le contrôle
exclut d'abord les blocs de code, où `**` est un opérateur ou un glob légitime.

```js
// Fail the build the moment a prerendered article loses its body.
const text = region.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
if (text.length < MIN_BODY_TEXT) {
  failures.push(`  ${label} → corps trop court (${text.length} < ${MIN_BODY_TEXT} car.)`);
}
```

Au moindre échec, `process.exit(1)`, et le build casse. Ce script est la dernière étape de
`build:ssg`, dont l'ordre compte : `gen:read-times` recalcule les temps de lecture depuis le vrai
nombre de mots avant la compilation, `ng build --configuration production` prérend, `gen:seo` écrit
sitemap, robots et llms dans le dossier livré, et `check-prerender.mjs` valide le tout. C'est cette
chaîne exacte que lance le workflow de déploiement.

## Le SEO figé dans le `<head>`

Le prérendu ne capture que ce qui est présent dans le `<head>` au moment où la route est prête. Le
`SeoService` écrit donc titre, description, Open Graph, `canonical`, `hreflang` et JSON-LD de façon
idempotente : chaque balise est posée ou remplacée, jamais dupliquée, pour qu'une re-navigation
laisse exactement un exemplaire de chacune.

Pour un article, le service injecte un graphe JSON-LD `BlogPosting` (headline, dates, auteur,
éditeur, image) doublé d'un `BreadcrumbList`. Le composant de détail le pilote dans un `effect` qui
réagit à l'article courant et à la langue : à chaque changement, `seo.update` réécrit les balises et
`seo.setArticleJsonLd` remplace le graphe, toujours en poser-ou-remplacer.

En parallèle, `gen:seo` produit les artefacts de site après le build. Le `sitemap.xml` émet chaque
concept (page, article, série) une fois par langue, chaque `<url>` portant sa grappe complète de
`hreflang` et un `lastmod` réel : la date de l'article sur sa propre page, la plus récente sur les
pages qui évoluent, aucune date inventée sur les pages statiques (un `lastmod` faux vaut moins que
pas de `lastmod`). Le `robots.txt` autorise explicitement les crawlers d'IA (GPTBot, ClaudeBot,
PerplexityBot…) en plus des moteurs classiques, et un `llms.txt` liste les articles et décrit
l'auteur comme entité.

Comme tout ce contenu vit dans le HTML prérendu, un crawler le récupère sans exécuter une ligne de
JavaScript.

## La configuration d'edge d'Azure SWA

Azure Static Web Apps lit un `staticwebapp.config.json` à la racine du déploiement. Ici il tient en
dix-sept lignes.

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

La racine `/` redirige vers `/fr` en 301 : la home canonique est localisée. Les deux en-têtes
globaux `Cross-Origin-Opener-Policy` et `Cross-Origin-Embedder-Policy` isolent le document
(cross-origin isolation), condition pour que le `SharedArrayBuffer` du moteur de jeu embarqué
fonctionne dans son worker. Ils doivent rester globaux, pas limités à une route, sinon le worker
perd l'accès au buffer partagé. Les bundles hashés (`*.css`, `*.js`, `*.mjs`) partent avec un cache
immuable d'un an, sûr parce qu'`outputHashing: all` change le nom du fichier dès que son contenu
bouge.

Un point notable par son absence : aucun `navigationFallback`. La bascule SPA classique (route
inconnue réécrite vers `index.html`) n'a pas lieu d'être, puisque chaque route est déjà prérendue
dans son propre `index.html`. SWA sert le fichier directement, et une URL réellement inconnue tombe
sur le `404.html` via `responseOverrides`. Le détail des clés est dans le guide de
[configuration Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/configuration).

## Le déploiement, sans secret stocké

Le workflow `deploy-client.yml` se déclenche quand `client/**` change sur `main`. Il ne stocke
aucun secret Azure : la connexion passe par OIDC (`azure/login` avec `id-token: write`), et même le
jeton de déploiement SWA est lu à l'exécution, via `az staticwebapp secrets list … --query
properties.apiKey`, puis injecté dans l'environnement du job. Aucune clé n'est figée dans les
secrets du dépôt.

Le reste est direct. `npm ci`, `npm run build:ssg` (la chaîne complète, garde comprise), puis
`swa deploy dist/super-dev-portfolio/browser` avec le jeton fraîchement lu. Le dossier `browser/`
est l'intégralité du site : il n'y a pas d'artefact serveur à côté.

Une dernière étape ping IndexNow, après le déploiement et jamais avant, pour que le fichier de clé
soit en ligne quand les moteurs le valident. Elle est non bloquante par construction : un hint raté
ne doit pas faire échouer un déploiement déjà réussi.

> Le SSG dépasse la seule question du référencement. Chaque page existe en HTML avant tout
> JavaScript, sa langue et ses données structurées figées au build, et un script casse la livraison
> si l'une d'elles part vide. Le time-to-content ne dépend plus de la connexion du visiteur ni de
> l'exécution d'un bundle.
