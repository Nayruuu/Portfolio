# super-dev — Angular 21 portfolio

A "YouTube channel" portfolio for a full-stack .NET / Angular / Azure developer.
**Project stack:** Angular 21 standalone components, signals, zoneless change detection, SCSS.

---

## Quick start

```bash
# Prerequisites: Node 20.19+ / 22 (CI: 22) and npm
cd client
npm install
npm start
```

The dev server starts on `http://localhost:4200`. Everything is hot-reloaded.

## Production build

```bash
cd client && npm run build:prod
# → artifacts in client/dist/super-dev-portfolio/browser/
```

## Structure

**Monorepo** layout: the Angular app lives in `client/`; the config (`.claude/`, `CLAUDE.md`), the docs (`docs/`) and the infra (`infra/`, Terraform) stay at the root.

**Layered architecture** (*screaming architecture*) under `client/src/app/` — imports point **inward only**: `features` / `layout` / `shared` → `core` → `domain` (never the reverse, never feature → feature).

```
client/src/app/
├── app.component.ts            ← shell + <router-outlet>
├── app.config.ts               ← provideZonelessChangeDetection() + provideRouter
├── app.routes.ts               ← routes (language = URL prefix: /fr, /en, /es, /de — generated from LANGS)
├── app.routes.server.ts        ← prerender (SSG) routes
│
├── domain/                     ← types + value sets (incl. LANG) + the multilingual Content contract; depends on nothing
│
├── core/                       ← UI-less client/infra logic (one bounded exception: the game engine core/lib/game)
│   ├── api/                    ← the seam to the .NET API (content-api.service, api.token)
│   ├── services/               ← signal / SignalStore state (content, game, i18n, player, reviews, search, seo, theme, viewport)
│   ├── lib/                    ← 100 %-tested pure functions (markdown, tokenize, site…) + bsp-engine/ + game/ (BSP engine + the embedded OPEN SPACE.EXE game: logic 100 % tested, browser host covered by the e2e net)
│   └── content/                ← one content.<lang>.json per language + the shared typed bridge + the generated article-bodies.ts
│
├── shared/                     ← cross-feature presentational components (icon, code-block, inline-runs)
├── layout/                     ← the shell (nav, prefs, channel-header, tabs-bar)
│
└── features/                   ← one lazy-loaded folder per feature
    ├── home/                   ← player (+ scenes, floating mini-player), video-meta, comments, like-bar, up-next
    ├── bsp-demo/               ← sd-bsp-demo mount component for OPEN SPACE.EXE (engine in core/lib/game; mounted in the player + served at /bsp)
    ├── articles/               ← filterable list (+ article-detail)
    ├── series/                 ← themed cards (+ series-detail)
    └── about/ · stack/ · contact/
```

## Angular 21 patterns in use

- **Standalone components everywhere** — no NgModule
- **Zoneless change detection** (`provideZonelessChangeDetection()`)
- **Signals** for all local and global state:
  - `signal()` — mutable state
  - `computed()` — pure derivations
  - `effect()` — side effects (localStorage, DOM attributes)
- **Native control flow**: `@if`, `@for`, `@switch`, `@let`
- **Signal-based inputs/outputs**:
  - `input.required<T>()`, `input<T>(default)`
  - `output<T>()`
  - `viewChild<T>('ref')`
- **OnPush change detection** on every component
- **`inject()` function DI** instead of constructor injection

## Theming

- Light by default, dark reachable via the sun/moon button of the `sd-prefs` cluster (in the nav on desktop, in the floating `.prefs-dock` on mobile)
- Driven by `ThemeService`, which sets `<html data-theme="light|dark">`
- The anti-flash pre-render lives in `index.html` (reads localStorage before Angular boots)
- Every color variable is a CSS `--token` in `styles/_tokens.scss` (light overrides in `_theme-light.scss`), aggregated by `styles.scss`

## i18n

- Multilingual (FR/EN/ES/DE, extensible through the `LANG` value set), language picker in the `sd-prefs` cluster (nav on desktop, floating dock on mobile)
- Driven by `I18nService` (a facade over `ContentStore`: `lang()` + `content()` signals)
- One `core/content/content.<lang>.json` per language (+ one typed `.ts` bridge each, sharing `json-content.ts`)
- The `Content` type (in `domain/`) guarantees that **all** locales stay aligned
- Non-FR locales are **AI-translated** from FR via `make i18n LANGS="es de"` (committed)

## Deployment — GitHub Actions

Deployment is driven by **GitHub Actions** (no more `make deploy` or manual `az`). Three workflows
under `.github/workflows/`. The **client is automatic** (push to `main`); **infra/api stay manual**
(`workflow_dispatch`) during the mono-commit phase, so a force-push can never trigger a surprise
`terraform apply` or container deployment:

| Workflow | Trigger | Role |
|---|---|---|
| `deploy-client.yml` | **push `main`** (auto) + `workflow_dispatch` | SSG build (`npm run build:ssg`) → deploys the static output to the Azure Static Web App |
| `deploy-infra.yml` | `workflow_dispatch` (manual) | `terraform init/plan/apply` at the root of `infra/` |
| `deploy-api.yml` | `workflow_dispatch` (manual) | builds the .NET image → pushes to GHCR → `az containerapp update` |

No `paths:` filter on the client: a force-push rewrites history, which makes GitHub path filtering
unreliable (and every mono-commit ships `client/` anyway); the filters will be added to all three
once the git history is back to normal. A failing `build:ssg` fails the job before any deployment.
All three authenticate to Azure via **OIDC**; only `deploy-infra` runs inside the `infra` environment
(a deployment gate).

One-time manual prerequisites: Azure OIDC, the Terraform state backend, GHCR. (The `swa-sd-web` SWA
is created by Terraform through `deploy-infra`; its token is fetched at runtime by `deploy-client`.)

## Quick customization

1. **Content / brand** — edit `core/content/content.fr.json` (the source), then `make i18n LANGS="es de…"` regenerates the non-FR locales
2. **Articles** — bodies as `<slug>.<lang>.md` in `client/src/content/articles/`; series mapping in `core/lib/series-map.ts`; `article-bodies.ts` is **generated** (`make gen-article-bodies`); then `make og` regenerates the committed social cards (the build guard fails without them)
3. **Your experience** — edit `sceneTimeline.rows`
4. **Your CV (PDF)** — replace the files under `client/public/cv/`; each locale points to a file through the `cvUrl` key of `core/content/content.<lang>.json` (ES/DE currently reuse the EN PDF; both download buttons — channel header and video meta — read the key)
5. **The avatar** — replace `client/public/avatar.jpg` (512px square; both avatars — channel header and video meta — load it as a CSS background)
6. **Your links** — `sceneOutro.links` + `about.links` + `contact.altMethods`
7. **Your availability** — `contact.avail`

## Notes

- The IBM Plex Sans + JetBrains Mono fonts are loaded from Google Fonts (see `index.html`). To go self-hosted, download the `.woff2` files and declare them as `@font-face` in a partial under `styles/` (e.g. `_base.scss`).
- The player intentionally stays dark even in the light theme (the expected look for a video player).
- The contact form is a mock — wire it to your service (Formspree, an Azure Function HTTP endpoint, etc.) in `ContactComponent.submit()`.

---

Built as a **technical showcase** of the advertised stack (.NET / Angular / Azure), beyond a simple portfolio.
