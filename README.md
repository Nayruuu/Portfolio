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
├── app.routes.ts               ← routes (langue = préfixe d'URL : /fr, /en, /es, /de — généré depuis LANGS)
├── app.routes.server.ts        ← routes de prerender (SSG)
│
├── domain/                     ← types + value-sets (dont LANG) + contrat multilingue Content ; ne dépend de rien
│
├── core/                       ← logique client/infra, sans UI (une exception bornée : le moteur de jeu core/lib/game)
│   ├── api/                    ← le seam vers l'API .NET (content-api.service, api.token)
│   ├── services/               ← state signal / SignalStore (content, game, i18n, player, reviews, search, seo, theme, viewport)
│   ├── lib/                    ← fonctions pures 100 % testées (markdown, tokenize, site…) + bsp-engine/ + game/ (moteur BSP + jeu embarqué OPEN SPACE.EXE : logique 100 % testée, host navigateur en filet e2e)
│   └── content/                ← un content.<lang>.json par langue + bridge typé partagé + article-bodies.ts généré
│
├── shared/                     ← présentationnel transverse (icon, code-block, inline-runs)
├── layout/                     ← le shell (nav, prefs, channel-header, tabs-bar)
│
└── features/                   ← un dossier lazy-loaded par feature
    ├── home/                   ← player (+ scènes, mini-player flottant), video-meta, comments, like-bar, up-next
    ├── bsp-demo/               ← composant de montage sd-bsp-demo du jeu OPEN SPACE.EXE (moteur dans core/lib/game ; monté dans le player + servi sur /bsp)
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

- Light par défaut, dark accessible via le bouton sun/moon du cluster `sd-prefs` (dans la nav sur desktop, dans le dock flottant `.prefs-dock` sur mobile)
- Géré par `ThemeService` qui pose `<html data-theme="light|dark">`
- Le pré-render anti-flash est dans `index.html` (lit localStorage avant Angular)
- Toutes les variables de couleur sont des `--tokens` CSS dans `styles/_tokens.scss` (overrides light dans `_theme-light.scss`), agrégés par `styles.scss`

## 🌐 i18n

- Multilingue (FR/EN/ES/DE, extensible via le value-set `LANG`), picker de langue dans le cluster `sd-prefs` (nav sur desktop, dock flottant `.prefs-dock` sur mobile)
- Géré par `I18nService` (façade sur `ContentStore` : signal `lang()` + `content()`)
- Un `core/content/content.<lang>.json` par langue (+ un bridge typé `.ts` chacun, partageant `json-content.ts`)
- Le type `Content` (dans `domain/`) garantit que **toutes** les locales sont alignées
- Les locales non-FR sont **traduites par IA** depuis FR via `make i18n LANGS="es de"` (committées)

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

1. **Le contenu / le brand** — édite `core/content/content.fr.json` (source), puis `make i18n LANGS="es de…"` régénère les locales non-FR
2. **Les articles** — corps `<slug>.<lang>.md` dans `client/src/content/articles/` ; mapping séries dans `core/lib/series-map.ts` ; `article-bodies.ts` est **généré** (`make gen-article-bodies`)
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
