Un SPA Angular classique envoie une page blanche aux crawlers : tant que le JS n'a pas
tourné, il n'y a rien à indexer. La **génération de site statique** (SSG) règle ça en
prérendant chaque route en HTML au build. Couplée à **Azure Static Web Apps**, on obtient un
site sans serveur, instantané, et parfaitement référencé.

## Prerender natif, sans serveur Node

Depuis `@angular/ssr`, le mode `outputMode: 'static'` prérend **toutes les routes** à la
compilation et n'émet que des fichiers statiques — aucun serveur Node à héberger. C'est ce
qui rend le déploiement sur Azure SWA trivial : on pousse un dossier `browser/`.

```yaml
# angular.json — extrait de la cible de build
"outputMode": "static",
"prerender": true,
"ssr": {
  "entry": "src/server.ts"
}
```

### Le piège des routes paramétrées

Une route parente `:lang` avec un `redirectTo` fonctionnel **casse** le prérendu : le
`<router-outlet>` ressort vide. La parade est d'exposer deux arbres statiques explicites
(`/fr` et `/en`) plutôt qu'un paramètre. La langue devient un préfixe d'URL, pas un param.

## Configurer Azure Static Web Apps

Azure SWA lit un fichier `staticwebapp.config.json` à la racine du déploiement. Le fallback
SPA y est essentiel pour que le routing client prenne le relais sur les routes non
prérendues, sans renvoyer un 404.

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

## SEO complet à la compilation

Un script post-build génère `sitemap.xml`, `robots.txt` et `llms.txt`, pendant que le
`SeoService` pose les `<title>`, balises **Open Graph**, `canonical`, `hreflang` et le
JSON-LD `BlogPosting` route par route. Comme tout est dans le HTML prérendu, crawlers et IA
récupèrent le contenu **sans exécuter une ligne de JS**. La doc Azure détaille la config dans
le guide [Static Web Apps configuration](https://learn.microsoft.com/azure/static-web-apps/configuration).

> Le SSG n'est pas qu'une optimisation SEO : c'est un site qui s'affiche avant même que le
> JS soit téléchargé. Le **time-to-content** devient indépendant de la connexion du visiteur.
