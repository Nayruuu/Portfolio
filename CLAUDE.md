# CLAUDE.md

A multilingual (FR/EN/ES/DE — extensible via the `LANG` value set) **"YouTube-channel" portfolio** for
a full-stack **.NET / Angular / Azure** developer — brand `super-dev` / `.app`, selector prefix
**`sd-`**. First and foremost a **technical showcase**: the code must stay exemplary against the latest
Angular 21 patterns. (Non-FR locales are **AI-translated** from FR via `make i18n`, committed.)

This file is the **map**, not the rulebook. It gives the stack, the commands, an architecture
summary, the known gotchas, and the Git rule — then **points at the canonical docs**. Every detailed
convention lives in **`.claude/conventions/`** (the rulebook) and every product/design **value** lives in
**`docs/PRODUCT.md`** (the spec). Do not look for rules here that those docs already own.

## Where things live (read these first)

| Doc | Owns (single source of truth) |
|---|---|
| [`.claude/conventions/architecture.md`](.claude/conventions/architecture.md) | The five layers, the inward-only **dependency rule**, barrels & import style, folder layout, one-declaration-per-file, the typed content bridge, routing/SEO **placement**. |
| [`.claude/conventions/code.md`](.claude/conventions/code.md) | TS/Angular code shape: standalone · OnPush · zoneless · signals · `input()`/`output()`/`model()`/`viewChild()` · `inject()` · member accessibility & order · native control flow · the ESLint rule set (incl. custom `local/prefer-signal-primitives`) · no-`enum`/derived-union/naming rules. |
| [`.claude/conventions/design.md`](.claude/conventions/design.md) | SCSS/design **rules**: CSS-tokens-only, one-level BEM nesting, blank-line-between-blocks (Stylelint), tabs indentation, the cascade-significant `@use` order, shared-vs-co-located placement, grouped-selector hoisting, `:host-context` theme overrides, when `[style.x]` is allowed, **mobile-first breakpoints** (the `from()` mixin + `$breakpoints` map). (Token **values** live in `docs/PRODUCT.md`.) |
| [`.claude/conventions/testing.md`](.claude/conventions/testing.md) | The test contract: Vitest patterns + exact coverage thresholds, the `core/` 100 % guard, Playwright config (chromium + **mobile** + **webkit** projects) + the 17 specs + 16 visual baselines (8 desktop + 8 mobile) + re-baseline discipline, the prerender guard. |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | The ***what***: product concept, route/tab inventory, the simulated player-scenes mechanism, the data tables (chapters, slugs, tags, series ↔ article mapping), and **the design source of truth** — exact token palette (dark + light), per-screen pixel spacing, font ladder, keyframes. |

> **Single-source principle**: each rule lives in exactly one of the docs above; this file and the
> skills/agents **reference** them, never restate them. If a rule seems to be missing here, it is on
> purpose — it is in `.claude/conventions/`.

## Quality bar

Treat every change as if a **meticulous perfectionist** authored it: exemplary and idiomatic,
internally consistent, **no loose ends** — no stale docs/comments, no dead code, no half-done
migration. **Verify end-to-end before calling anything done** (`make lint` · `make test` /
`make test-cov` · `make e2e` visual regression · `make build-ssg`) — evidence over assertions. When
something adjacent is wrong (a stale claim, a contradiction, a pre-existing smell in code you're
touching), **fix it or flag it explicitly — never step over it**. Keep the docs (this file, the
`.claude/conventions/*` rulebook, the `angular-rules` skill, the agents) in sync with the code: a
convention that lives only in someone's head doesn't exist.

## Stack

- **Angular 21** — signals everywhere; **`@angular/build`** builder. (Code shape → `code.md`.)
- **TypeScript 5.9** — `strict`, `strictTemplates`.
- **SCSS** — Emulated encapsulation; `client/src/styles.scss` is a thin `@use` entry over focused
  partials under `client/src/styles/` (the shared layer); each component owns its own `.scss`.
  (Rules → `design.md`; values → `PRODUCT.md`.)
- **State** — plain signal services for local state; **NgRx SignalStore** (`@ngrx/signals`) for the
  content store. No NGXS / observable-store.
- **RxJS 7.8** — present but barely used (everything goes through signals).
- **Tests** — **Vitest** (unit/component, zoneless) + **Playwright** (E2E + visual regression).
- **Deploy** — **Azure Static Web Apps** (static), shipped **via GitHub Actions**
  (`.github/workflows/deploy-{client,infra,api}.yml`; no `make deploy`). SEO via **native Angular SSG**:
  every route prerendered to static HTML at build (`@angular/ssr`, `outputMode: 'static'`).

## Commands

Driven by the root **`Makefile`** (each target delegates to an `client/` npm script):

| `make` | Does |
|---|---|
| `make dev` | dev server (`npm start`, http://localhost:4200) |
| `make build` / `make build-prod` | production build / explicit prod build |
| `make build-ssg` | prod build + native prerender + sitemap/robots/llms + SWA config (**what the `deploy-client` CI workflow runs**) |
| `make og` | regenerate the `og:image` social card |
| `make gen-icons` | regenerate the typed icon set (`icon-set.ts`) from `icons/*.svg` |
| `make i18n LANGS="es de"` | AI-translate `content.fr.json` + article bodies → `content.<lang>.json` / `<slug>.<lang>.md` via `claude -p` (committed) |
| `make gen-article-bodies` | regenerate `article-bodies.ts` from `content/articles/*.md` |
| `make format` / `make format-check` | Prettier (writes / checks) |
| `make lint` / `make lint-fix` | **ESLint + Stylelint** (fixes the auto-fixable) |
| `make check-docs` | deterministic kit-doc guard (broken §/links, prose-only `PRODUCT.md`, stale config names) — runs every iteration via the `Stop` hook |
| `make test` / `make test-cov` | Vitest / Vitest + coverage + `core/` 100 % guard |
| `make e2e` | Playwright (E2E + visual regression) |

Without make: from `client/`, the equivalent `npm` scripts (`npm start`, `npm run build`, `npm test`,
`npm run test:cov`, `npm run e2e`, …). Exact thresholds, builders, and the verify gates are in
[`.claude/conventions/testing.md`](.claude/conventions/testing.md).

## Architecture (summary)

Full rules — layers, dependency direction, barrels, folder layout — are in
[`.claude/conventions/architecture.md`](.claude/conventions/architecture.md). At a glance:

- **Monorepo layout**: the Angular app lives in `client/`; `CLAUDE.md` + `.claude/` + `docs/` stay at the
  root. `infra/` (Terraform — flat root config + `modules/`) is present; an `api/` (.NET) is the next slot.
- **Layered, screaming architecture** under `client/src/app/`, **imports point inward only**
  (`features` / `layout` / `shared` → `core` → `domain`; never the reverse, **never feature → feature**):
  - `domain/` — types/value-sets (incl. the `LANG` set) + the multilingual `Content` contract; **depends on nothing**.
  - `core/` — UI-less client/infra logic: `api/` (the .NET-API seam), `services/` (signal/SignalStore
    state), `lib/` (pure functions, 100 % tested), `content/` (one `content.<lang>.json` per `Lang` +
    the shared typed bridge + the generated `article-bodies.ts` over `.md` bodies). **One bounded
    exception to "UI-less"**: `core/lib/game` is the whole self-contained, framework-agnostic embedded
    game engine — it owns its own rendering + browser host code (canvas / WebGPU / `Worker` / DOM-input /
    `Image`), kept honest by three guardrails (pure game logic stays 100 %-tested; the browser/canvas
    host adapters are `coverageExclude`d + held off the barrel; the exception is scoped to
    `core/lib/game`) — see `architecture.md §1`.
  - `shared/` — cross-feature presentational components (`icon`, `code-block`, `inline-runs`) **only**.
    (The former `shared/game` helpers — `doom-hud`, `weapon-view`, `climb-view`, `climb-frames`,
    `weapons`, `effects`, `gaze`, `loaded-image` — moved into the engine at `core/lib/game/presentation`.)
  - `layout/` — the shell (`nav`, `prefs`, `channel-header`, `tabs-bar`).
  - `features/` — one **lazy-loaded** folder per feature (`home`, `articles`, `series`, `about`,
    `stack`, `contact`) — plus the hidden `bsp-demo` game, now just the thin **mount component**
    `sd-bsp-demo` (`bsp-demo.component.{ts,html,scss}` and nothing else; served at `/bsp` and mounted in
    the player); the whole game engine lives in `core/lib/game`.
- **Root composition**: `app.component.*` (shell + `<router-outlet>`), `app.config.ts`
  (`provideZonelessChangeDetection()` + `provideRouter`), `app.routes.ts`, `app.routes.server.ts`.
- **Routing & i18n**: language is a URL prefix (`/fr`, `/en`, `/es`, `/de`, …), route-driven; one static
  tree **per `Lang`** is generated from `LANGS` (still param-less — see gotcha). UI text comes from the
  typed per-locale `Content` bridge. Rules → `architecture.md` §7 (routing/SEO placement +
  route-as-language) + `code.md` §5 (the no-`lang()`-ternary text rule); route/SEO **content** → `PRODUCT.md`.

## Known gotchas

These are the sharp edges a rebuild trips on. Each is owned in depth by a linked doc.

- **Routing MUST stay param-less at the root** — get this wrong (a `:lang` param) and native
  prerendering silently breaks (empty `<router-outlet>`). (→ `architecture.md` §7.)
- **The typed content bridge** is fragile to "simplification" — collapsing it to a bare `as Content` or
  plain `satisfies Content` quietly drops a real safety check. (→ `architecture.md` §5.)
- **`PlayerService`** runs a `setInterval` inside an `effect` — forgetting to `onCleanup` it leaks the
  timer and breaks tests/SSR. (→ `code.md` §2.)
- **SEO / SSG**: `make build-ssg` runs the native Angular prerender plus a `check-prerender.mjs` build
  guard — it fails the build if an article page loses its JSON-LD or its rendered Markdown body, so the
  content stays discoverable without JS. (Guard assertions → `testing.md`, *Prerender guard*; SEO route
  content → `PRODUCT.md`.)
- **Before a big refactor**, run `make test` + `make e2e` to capture the green baseline — the
  Playwright visual regression is the net that guarantees a pixel-identical render. (→ `testing.md`.)
- **Mobile-first responsive**: base SCSS targets the phone; the desktop layout lives in
  `@include bp.from(md|lg)` blocks (the `$breakpoints` map + `from()` mixin, the *only* `@use` in
  component SCSS). Desktop visual baselines are **never** re-baselined to mask a mobile-first leak.
  (Breakpoint rules → `design.md §11`; mobile Playwright project / 16 baselines / 360px overflow guard →
  `testing.md`.)

## Git / commits

- Commit messages are **not co-authored by Claude**: never add a `Co-Authored-By: Claude …` trailer.
