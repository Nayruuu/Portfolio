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
├── app.routes.ts               ← routes (language = URL prefix: /fr, /en — generated from LANGS)
├── app.routes.server.ts        ← prerender (SSG) routes
│
├── domain/                     ← types + value sets (incl. LANG) + the multilingual Content contract; depends on nothing
│
├── core/                       ← UI-less client/infra logic
│   ├── api/                    ← the seam to the .NET API (content-api.service, contact-api.service, feedback-api.service, api.token)
│   ├── services/               ← signal / SignalStore state (content, game, i18n, palette, player, search, seo, share, theme)
│   ├── lib/                    ← 100 %-tested pure functions (markdown, tokenize, site…)
│   └── content/                ← one content.<lang>.json per language + the shared typed bridge + the generated article-bodies.ts
│
├── shared/                     ← cross-feature UI components (icon, code-block, inline-runs; like-bar — the vote bar; reviews — Malt recos, home + about; command-palette — the desktop ⌘K palette; content-tabs — the Articles|Séries toggle)
├── layout/                     ← the shell (nav, prefs, channel-header, tabs-bar)
│
└── features/                   ← one lazy-loaded folder per feature
    ├── home/                   ← player (+ scenes, floating mini-player), video-meta, lets-talk, up-next
    ├── articles/               ← filterable list (+ article-detail)
    ├── series/                 ← themed cards (+ series-detail)
    ├── projects/               ← open-source project pages (list + project-detail; SoftwareSourceCode JSON-LD; the Réalisations tab)
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

- Multilingual (FR/EN, extensible through the `LANG` value set), language picker in the `sd-prefs` cluster (nav on desktop, floating dock on mobile)
- Driven by `I18nService` (a facade over `ContentStore`: `lang()` + `content()` signals)
- One `core/content/content.<lang>.json` per language (+ one typed `.ts` bridge each, sharing `json-content.ts`)
- The `Content` type (in `domain/`) guarantees that **all** locales stay aligned
- Non-FR locales are **AI-translated** from FR via `make i18n LANGS="en"` (committed)

## Deployment — GitHub Actions

Two workflows under `.github/workflows/`, push-triggered on `main` (paths filtered to `client/**` /
`api/**`): the client SSG build (`npm run build:ssg`) deploys to **Azure Static Web Apps**, and the
API (`dotnet test` + `dotnet publish`) deploys to **Azure Functions**. Both authenticate to Azure via
**OIDC** — no long-lived secrets are stored in the repo, and a failing build fails the job before any
deployment.

The Azure **infrastructure** (Terraform) is managed in a **separate private repo**; these workflows
only deploy code to the resources it provisions.

## Notes

- The IBM Plex Sans + JetBrains Mono fonts are loaded from Google Fonts (see `index.html`). To go self-hosted, download the `.woff2` files and declare them as `@font-face` in a partial under `styles/` (e.g. `_base.scss`).
- The player intentionally stays dark even in the light theme (the expected look for a video player).
- The contact form and the per-page vote bar are backed by the .NET API (spam-protected).

---

Built as a **technical showcase** of the advertised stack (.NET / Angular / Azure), beyond a simple portfolio.
