# super-dev — Angular 21 portfolio

Portfolio "chaîne YouTube" pour un développeur full-stack .NET / Angular / Azure.
**Stack du projet :** Angular 21 standalone components, signals, zoneless change detection, SCSS.

---

## 🚀 Démarrage rapide

```bash
# Pré-requis : Node 20.19+ / 22 (CI : 22) et npm
cd client
npm install
npm start
```

Le serveur de développement démarre sur `http://localhost:4200`. Tout est hot-reloadé.

## 🏗️ Build de production

```bash
cd client && npm run build:prod
# → artefacts dans client/dist/super-dev-portfolio/browser/
```

## 🗂️ Structure

Layout **monorepo** : l'app Angular vit dans `client/` ; la config (`.claude/`, `CLAUDE.md`), la doc (`docs/`) et l'infra (`infra/` Terraform) restent à la racine.

**Architecture en couches** (*screaming architecture*) sous `client/src/app/` — les imports pointent **vers l'intérieur** : `features` / `layout` / `shared` → `core` → `domain` (jamais l'inverse, jamais feature → feature).

```
client/src/app/
├── app.component.ts            ← shell + <router-outlet>
├── app.config.ts               ← provideZonelessChangeDetection() + provideRouter
├── app.routes.ts               ← routes (la langue est un préfixe d'URL : /fr, /en)
├── app.routes.server.ts        ← routes de prerender (SSG)
│
├── domain/                     ← types + value-sets + contrat bilingue Content ; ne dépend de rien
│
├── core/                       ← logique client/infra, sans UI
│   ├── api/                    ← le seam vers l'API .NET (content-api.service, api.token)
│   ├── services/               ← state signal / SignalStore (content, i18n, player, seo, theme, viewport)
│   ├── lib/                    ← fonctions pures, testées à 100 % (markdown, tokenize, site, constants…)
│   └── content/                ← JSON FR/EN + bridge typé + corps d'articles
│
├── shared/                     ← présentationnel transverse (icon, code-block, inline-runs)
├── layout/                     ← le shell (nav, channel-header, tabs-bar)
│
└── features/                   ← un dossier lazy-loaded par feature
    ├── home/                   ← player + 5 scènes animées, video-meta, comments, like-bar, up-next
    ├── articles/               ← liste filtrable (+ article-detail)
    ├── series/                 ← cards thématiques (+ series-detail)
    └── about/ · stack/ · contact/
```

## 🧪 Patterns Angular 21 utilisés

- **Standalone components partout** — aucun NgModule
- **Zoneless change detection** (`provideZonelessChangeDetection()`)
- **Signals** pour tout le state local et global :
  - `signal()` — state mutable
  - `computed()` — dérivé pur
  - `effect()` — side effects (localStorage, DOM attr)
- **Nouvelle syntaxe de contrôle** : `@if`, `@for`, `@switch`, `@let`
- **API signal-based inputs/outputs** :
  - `input.required<T>()`, `input<T>(default)`
  - `output<T>()`
  - `viewChild<T>('ref')`
- **OnPush change detection** sur tous les composants
- **`inject()` function DI** plutôt que constructor injection

## 🎨 Theming

- Light par défaut, dark accessible via le bouton sun/moon dans la nav
- Géré par `ThemeService` qui pose `<html data-theme="light|dark">`
- Le pré-render anti-flash est dans `index.html` (lit localStorage avant Angular)
- Toutes les variables de couleur sont des `--tokens` CSS dans `styles/_tokens.scss` (overrides light dans `_theme-light.scss`), agrégés par `styles.scss`

## 🌐 i18n

- Bilingue FR / EN, switch via la nav
- Géré par `I18nService` (signal `lang()` + `computed content()`)
- Contenu structuré dans `core/content/content.fr.json` et `content.en.json` (+ le bridge typé `.ts`)
- Le type `Content` (dans `domain/`) garantit que les deux locales sont alignées

## ☁️ Déploiement — GitHub Actions

Le déploiement est piloté par **GitHub Actions** (plus de `make deploy` ni d'`az` manuel). Trois
workflows dans `.github/workflows/`. Le **client est automatique** (push sur `main`) ; **infra/api
restent manuels** (`workflow_dispatch`) pendant la phase mono-commit, pour qu'un force-push ne
déclenche jamais un `terraform apply` ou un déploiement de conteneur par surprise :

| Workflow | Déclencheur | Rôle |
|---|---|---|
| `deploy-client.yml` | **push `main`** (auto) + `workflow_dispatch` | build SSG (`npm run build:ssg`) → déploie le statique sur l'Azure Static Web App |
| `deploy-infra.yml` | `workflow_dispatch` (manuel) | `terraform init/plan/apply` à la racine de `infra/` |
| `deploy-api.yml` | `workflow_dispatch` (manuel) | build l'image .NET → push GHCR → `az containerapp update` |

Pas de filtre `paths:` sur le client : un force-push réécrit l'historique, donc le path-filtering
GitHub est non fiable (et chaque mono-commit embarque `client/`) ; on les rajoutera aux trois avec un
historique git normal. Un `build:ssg` qui échoue fait échouer le job avant le déploiement. Les 3
s'authentifient à Azure via **OIDC** ; seul `deploy-infra` tourne dans l'environnement `infra` (un gate de déploiement).

Prérequis one-time (à la main) : OIDC Azure, backend de state Terraform, GHCR. (La SWA `swa-sd-web` est créée par Terraform via `deploy-infra` ; son token est récupéré au runtime par `deploy-client`.)

## 🔧 Personnalisation rapide

1. **Le contenu / le brand** — édite `core/content/content.fr.json` + `content.en.json` (textes FR/EN, handles, bio)
2. **Les articles** — corps `.md` dans `client/src/content/articles/` ; mapping séries dans `core/lib/series-map.ts` ; rendu dans `core/content/article-bodies.ts`
3. **Ton expérience** — édite `sceneTimeline.rows`
4. **L'avatar** — remplace `.profile__avatar` (lettre `S`) par `<img src="…">` dans `layout/channel-header/channel-header.component.html`
5. **Tes liens** — `sceneOutro.links` + `about.links` + `contact.altMethods`
6. **Ton TJM / dispo** — `contact.avail`

## 📝 Notes

- La police IBM Plex Sans + JetBrains Mono est chargée depuis Google Fonts (voir `index.html`). Pour aller en self-hosted, télécharge les `.woff2` et déclare-les en `@font-face` dans un partial sous `styles/` (p. ex. `_base.scss`).
- Le player est volontairement laissé en dark même en thème light (c'est l'attendu pour un lecteur vidéo).
- Le formulaire de contact est mock — branche-le sur ton service (Formspree, Azure Function HTTP, etc.) dans `ContactComponent.submit()`.

---

Pensé comme une **vitrine technique** du stack annoncé (.NET / Angular / Azure), au-delà d'un simple portfolio.
