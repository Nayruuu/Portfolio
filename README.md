# super-dev — Angular 21 portfolio

A "YouTube channel" portfolio for a .NET / Angular / Azure technical lead.
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

**Monorepo** layout: the Angular app lives in `client/`; the config (`.claude/`, `CLAUDE.md`) and the docs (`docs/`) stay at the root. The Azure infrastructure (Terraform) lives in a separate private repo.

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
│   ├── api/                    ← the seam to the .NET API (content-api.service, contact-api.service, feedback-api.service, api.token)
│   ├── services/               ← signal / SignalStore state (content, game, i18n, player, search, seo, share, theme)
│   ├── lib/                    ← 100 %-tested pure functions (markdown, tokenize, site…) + bsp-engine/ + game/ (BSP engine + the embedded OPEN SPACE.EXE game: logic 100 % tested, browser host covered by the e2e net)
│   └── content/                ← one content.<lang>.json per language + the shared typed bridge + the generated article-bodies.ts
│
├── shared/                     ← cross-feature UI components (icon, code-block, inline-runs; like-bar — the vote bar)
├── layout/                     ← the shell (nav, prefs, channel-header, tabs-bar)
│
└── features/                   ← one lazy-loaded folder per feature
    ├── home/                   ← player (+ scenes, floating mini-player), video-meta, reviews (real Malt recommendations), lets-talk, up-next
    ├── bsp-demo/               ← sd-bsp-demo mount component for OPEN SPACE.EXE (engine in core/lib/game; mounted in the player + served at /bsp)
    ├── articles/               ← filterable list (+ article-detail)
    ├── series/                 ← themed cards (+ series-detail)
    ├── projects/               ← open-source project pages (list + project-detail; SoftwareSourceCode JSON-LD; no tab)
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

Deployment is driven by **GitHub Actions** (no more `make deploy` or manual `az`). Two workflows
under `.github/workflows/`, both push-triggered on `main` (plus `workflow_dispatch`), each filtered
to its own paths (`client/**` / `api/**`):

| Workflow | Trigger | Role |
|---|---|---|
| `deploy-client.yml` | **push `main`** (paths `client/**`, auto) + `workflow_dispatch` | SSG build (`npm run build:ssg`) → deploys the static output to the Azure Static Web App → pings IndexNow (non-blocking) |
| `deploy-api.yml` | **push `main`** (paths `api/**`, auto) + `workflow_dispatch` | `dotnet test` + `dotnet publish` the isolated-worker API → zip-deploys to the `afu-sd-api` Flex Consumption Function App (`Azure/functions-action`) |

Both filter on their own paths; on a force-push GitHub's path filtering can see every file as changed
and over-trigger the **client** redeploy — benign (an idempotent SSG rebuild). A failing `build:ssg`
fails the job before any deployment. Both authenticate to Azure via **OIDC** (secrets `AZURE_CLIENT_ID`
/ `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID`); `deploy-api` runs inside a gated environment
(`deploy-client` does not). They target existing resources **by name** — the `deploy-client` SWA token
is fetched at runtime, so no stored token.

The Azure **infrastructure** (the Static Web App, Function App, storage, monitoring, budget — Terraform)
is managed in a **separate private repo**; these workflows only deploy code to the resources it provisions.

## Quick customization

1. **Content / brand** — edit `core/content/content.fr.json` (the source), then `make i18n LANGS="es de…"` regenerates the non-FR locales
2. **Articles** — bodies as `<slug>.<lang>.md` in `client/src/content/articles/`; series mapping in `core/lib/series-map.ts`; `article-bodies.ts` is **generated** (`make gen-article-bodies`); read times are **derived from word count** (`gen-read-times`, run in the SSG build — never hand-set); then `make og` regenerates the committed social cards (the build guard fails without them)
3. **Your experience** — edit `sceneTimeline.rows`
4. **Your CV (PDF)** — replace the files under `client/public/cv/`; each locale points to a file through the `cvUrl` key of `core/content/content.<lang>.json` (ES/DE currently reuse the EN PDF; both download buttons — channel header and video meta — read the key)
5. **The avatar** — replace `client/public/avatar.jpg` (512px square; both avatars — channel header and video meta — load it as a CSS background)
6. **Your links** — `sceneOutro.links` + `about.links` + `contact.altMethods`

## Notes

- The IBM Plex Sans + JetBrains Mono fonts are loaded from Google Fonts (see `index.html`). To go self-hosted, download the `.woff2` files and declare them as `@font-face` in a partial under `styles/` (e.g. `_base.scss`).
- The player intentionally stays dark even in the light theme (the expected look for a video player).
- The contact form is wired to the .NET API (`ContactApiService` → `POST /api/contact` → Resend, behind a honeypot + invisible Altcha); the like-bar reads and posts per-page vote counts via `/api/feedback`.

---

Built as a **technical showcase** of the advertised stack (.NET / Angular / Azure), beyond a simple portfolio.
