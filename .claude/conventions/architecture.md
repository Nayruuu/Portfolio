# Architecture conventions

Canonical rules for the **layered, screaming architecture** of the super-dev app (Angular 21, `sd-`
prefix). This is the single source of truth for *layer boundaries, the dependency rule, barrels &
import style, folder layout, and the one-declaration-per-file rule*. Other docs (CLAUDE.md, the
`angular-rules` skill, the design/test convention docs) **reference** this file; they never restate
its rules.

> Scope: where code lives and which way imports may point. Component-authoring mechanics (signals,
> `input()`/`output()`, OnPush, native control flow, separate templates/styles, i18n) and the
> styling/SCSS rules live in their own convention docs — not here.

---

## 1. The five layers

The app lives under `client/src/app/`. Every file belongs to exactly one of these layers. The layers
are ordered from innermost (depends on nothing) to outermost (depends on everything inward):

| Layer | Path | Role | May import |
|---|---|---|---|
| **domain** | `client/src/app/domain/` | Types, interfaces, value sets (incl. the `LANG` set). The multilingual `Content` contract. **The innermost layer.** | **nothing** (no Angular, no RxJS, no other layer) |
| **core** | `client/src/app/core/` | UI-less client/infra logic: `api/`, `services/`, `lib/`, `content/`. **One bounded exception** — `core/lib/game` is a self-contained embedded game engine that owns browser host code (callout below). | `domain` (+ Angular/3rd-party infra) |
| **shared** | `client/src/app/shared/` | Cross-feature *presentational* components (`icon`, `code-block`, `inline-runs`). | `core`, `domain` |
| **layout** | `client/src/app/layout/` | The app shell: `nav`, `prefs`, `channel-header`, `tabs-bar`. | `core`, `domain`, `shared` |
| **features** | `client/src/app/features/` | One folder per feature (`home`, `articles`, `series`, `about`, `stack`, `contact`), **lazy-loaded**. | `core`, `domain`, `shared` |

The root files (`app.component.*`, `app.config.ts`, `app.config.server.ts`, `app.routes.ts`,
`app.routes.server.ts`) compose the shell and wire routing; they sit above `layout`/`features`.

**Screaming architecture**: the folder names announce *what the app is* (a domain layer full of
articles/series/player/contact types; features named after the pages), not *what framework it uses*.

### Core is UI-less — with one bounded, documented exception: `core/lib/game`

The rest of `core` (`api/`, `services/`, the other `lib/` pure functions, `content/`) is strictly UI-less
infra logic, as the table says. `core/lib/game` is the deliberate exception: it is a **self-contained,
framework-agnostic embedded game engine** — a portable module that owns its **own rendering and browser
host adapters** (canvas, WebGPU, `SharedArrayBuffer` `Worker`s, DOM-input, `Image`). That browser code
lives in `core/lib/game` (not in the feature) *because* the engine is portable and owns its host seam; the
feature is only a mount point (§4). This is an **intentional, bounded exception, not a layering violation** —
three guardrails keep it honest:

1. **Honest test split.** The pure game *logic* stays **100 %-unit-covered** by the `core/` guard; the
   browser/canvas *host adapters* — the `render/` worker pool + WebGPU backend + host/texture code, the four
   `painters/`, and `presentation/`'s `DoomHud` / `WeaponView` / `loaded-image` — ride `coverageExclude`: they
   are dropped from the 100 % *threshold*, **not** from the test run. Their irreducible `Worker` / GPU /
   raw-canvas paths have no DOM-free seam and are proven by running the engine in a real browser; several of
   them (`render-host`, `load-textures`, the two composited painters, `DoomHud`, `WeaponView`) still carry unit
   specs on their mockable seams — they simply aren't held to 100 %. A documented split, **not** a coverage
   dodge. (Exact list → `testing.md`.)
2. **Off the barrel.** Those browser modules (`render/`, `input/`, `boot/`, `painters/`) are kept **off**
   both the `game/` sub-barrel and the `core/lib` root barrel; the mount component imports them by
   **direct path** (§3). So the ~11 SSR-prerendered components — which pull `core/lib` through its barrel —
   never transitively evaluate a `Worker` / `navigator.gpu` at prerender, and `make build-ssg` stays green.
3. **Scoped to `core/lib/game`.** Nothing else in `core` may hold browser/UI code; the exception does not
   widen.

Note this exception is about the layer's *nature* (it may contain browser host code), **not** its import
direction: the engine still imports only inward (§2) — it reaches nothing in `features` / `layout` / `shared`.

---

## 2. The dependency rule (inward-only)

> **Imports point inward, never outward.** `features` / `layout` / `shared` → `core` → `domain`.

This is the one rule that makes the architecture hold together. State it exactly:

### Allowed import directions

- `features` → `core`, `domain`, `shared` ✅
- `layout` → `core`, `domain`, `shared` ✅
- `shared` → `core`, `domain` ✅
- `core` → `domain` ✅
- `domain` → **nothing** (production code imports zero modules; only `.spec.ts` files import the
  `vitest` test runner) ✅
- Intra-layer imports within `core` are allowed but follow the inward spirit:
  `services/` → `lib/`, `api/`, `content/`, `domain`; `content/` (bridge) → `domain`;
  `lib/` → `domain` only. A `lib/` pure function never imports a `service`.

### Forbidden import directions

- `core` → `features` / `layout` / `shared` ❌ (core never reaches up into the UI layers — even the
  `core/lib/game` engine, the one layer that owns browser host code (§1), imports nothing outward)
- `domain` → anything ❌ (it would no longer be the innermost layer)
- `shared` → `features` / `layout` ❌
- `layout` → `features` ❌
- **`feature` → `feature`** ❌ — **the cardinal forbidden edge.** No feature ever imports from a
  sibling feature folder.

### Why feature → feature is banned, and what to do instead

Features are independent, lazy-loaded islands. If two features need the same type, **that type is not
a feature concern — it is a domain concern**: lift it into `domain/` (which is exactly why *all*
content types live there). If two features need the same logic, lift the pure function into
`core/lib/` or the stateful behavior into a `core/services/<name>/` service. The rule of thumb:

> **A type or helper used by ≥ 2 features belongs in `domain` (types) or `core` (logic) — never
> copied, never imported sideways.**

A type used by exactly **one** feature may stay private to that feature's folder; promote it to
`domain` the moment a second feature needs it.

### Enforcement

There is **no ESLint boundary plugin** wired today (no `eslint-plugin-boundaries` /
`no-restricted-imports` path rules). The dependency rule is **convention-enforced**: it lives in this
doc and is upheld in review. Treat a violating import as a defect even though the linter is silent.
(If a guard is ever added, it belongs in `client/eslint.config.mjs` and this paragraph updates to point
at it.)

---

## 3. Barrels and import style

Two layers expose a public surface through a **barrel**; everything else is imported by its **direct
file path**. Get this exactly right — it is load-bearing for both ergonomics and cycle-avoidance.

### `domain/` — a single top-level barrel

- **One** barrel only: `domain/index.ts`. It `export *` from **every** domain file (one
  `export * from './sub/file';` line per file), plus the root `content.ts` contract.
- The sub-domain folders (`about/`, `article/`, `code/`, `comment/`, `contact/`, `i18n/`, `player/`,
  `project/`, `series/`, `stack/`, `aria/`) are **internal organization only** — there is **no
  per-folder barrel**.
- **Consumers** (anything in `core`/`shared`/`layout`/`features`) import from the folder:
  `import { Article, Lang, Content } from '…/domain';` — never from a deep file path.
- **Intra-domain** imports go **file → file directly** (`from './article-tag'`), **never through the
  barrel** — importing the barrel from inside the layer it defines creates a cycle.

### `core/lib/` — a single barrel for pure functions

- **One** barrel: `core/lib/index.ts`, `export *` from each `lib/` file (one line per file). A cohesive
  multi-file engine may live in a **sub-folder with its own sub-barrel**. The BSP game uses two:
  - `core/lib/game/` — **the whole self-contained embedded game engine** (§1 callout), grouped into **17**
    sub-folders by concern. The **pure logic** (100 %-tested): `enemy/` (the roster + the pure AI), `combat/`
    (hitscan / projectile / per-frame combat), `doors/`, `controls/`, `zone/` (the zone snapshot), `level/`
    (the `Level` contract), `levels/` (the hand-authored floors + `demo-map`), `registry/` (`level-select`),
    `weapons/` (the magazine / fire-rate / reload subsystem + the fists-only ownership progression),
    `telemetry/` (frame-stats + the render governor), `world/` (the state-owning runtimes — zone / combat /
    pickup / motion / enemy — + the feature model types), `sprites/` (world → `Sprite[]`). The
    **presentation** helpers in `presentation/` (the `DoomHud` / `WeaponView` / `ClimbView` imperative canvas
    classes + the `weapons` / `effects` JSON-bridge data + the `gaze` turn-EMA helper + `climb-frames` /
    `loaded-image`) — engine-agnostic, formerly `shared/game`. And the **browser host adapters** kept off the
    barrel: `render/` (the `SharedArrayBuffer` worker pool `render-pool` + `render.worker`, the WebGPU
    `gpu-renderer`, `render-host`, `load-textures`), `input/` (the DOM-event `input-controller`), `boot/`
    (the `Image` `asset-loader`), `painters/` (the `<canvas>` painters). Plus the top-level `types.ts`
    (`KeycardColor` / `KEYCARD_COLORS`, …) and **`game-tuning.ts`** — the central gameplay balance/feel sheet
    (movement / look / combat / enemy / pickup / door / timing constants). The barrel (`game/index.ts`)
    re-exports the logic + presentation, and is itself **re-exported through the `core/lib` root barrel** as
    one line — `export * from './game'` — so consumers import them from `…/core/lib`. The **browser host
    modules (`render/`, `input/`, `boot/`, `painters/`) are deliberately kept off both barrels** and imported
    by direct path (§1 guardrail 2 — this keeps `Worker` / WebGPU out of the SSR-prerendered bundle). The
    `presentation/` helpers, by contrast, sit **on** the barrel and are SSR-safe *by construction* — plain
    classes whose `<canvas>` / `new Image()` calls are runtime-only and DOM-guarded, never run at import.
    Barrel placement is orthogonal to the coverage split: `DoomHud` / `WeaponView` / `loaded-image` ride the
    barrel yet are still `coverageExclude`d as canvas/`Image` adapters. `loaded-image` is left off the
    `presentation/` **sub**-barrel purely for **encapsulation** — an internal helper of `DoomHud` /
    `WeaponView` / `ClimbView`, imported directly by them, needed by nothing outside `presentation/` — **not**
    for SSR (the class is SSR-safe and already reachable transitively through those three).
  - `core/lib/bsp-engine/` — the from-scratch DOOM-style **BSP software engine**: the map data model +
    node builder (the BSP compiler), the front-to-back BSP walk + textured wall/floor/ceiling `renderer`
    (incl. the transparent-glass pass — tinted panes, textured windows, double sliding doors — and the
    live **zone-portal** pass: a seam's opening renders a neighbouring zone's map via a translated
    depth-1 recursive walk), `frame-commands` (the same walk recording GPU-ready per-column span/glass/
    sprite command buffers for the WebGPU backend), `camera` projection, hitscan `raycast` (with a
    glass-blocking mode for projectiles), player `physics` (slide + step-up + auto-mantle + opt-in
    seamless crossing of passable zone-portal seams), the directional-prop rendering (`sprite-rotation`
    view-angle cells, `voxel-carve` visual-hull grids for the voxel-volume props), and procedural `texture`s.
    Big and feature-scoped, it is **not** folded into the root barrel; consumers import it directly through
    its own sub-barrel, `…/core/lib/bsp-engine`.
- **Consumers** import from the folder: `import { parseMarkdown, STORAGE_KEYS } from '…/core/lib';`.
- **Intra-`lib`** imports go **file → file directly** (`select-articles.ts` →
  `import { readCount } from './read-count';`), **never the barrel**.

### Everything else in `core` — no barrel; import the file directly

- **Services**: import the service file directly —
  `import { I18nService } from '…/core/services/i18n/i18n.service';`. There is **no**
  `core/index.ts` and **no** `core/services/index.ts` barrel.
- **API**: `import { ContentApiService } from '…/core/api/content-api.service';`,
  `import { API_BASE_URL } from '…/core/api/api.token';`.
- **Content bridge**: `import { FR } from '…/core/content/content.fr';` etc.

### Components (`shared` / `layout` / `features`) — no barrels

Components are imported by their direct file path into a parent's `imports: […]` array
(`import { PlayerComponent } from './player/player.component';`). Feature sub-components are imported
by relative path within the feature.

### Summary of the barrel rule

> **Two barrels exist: `domain/index.ts` and `core/lib/index.ts`.** Import *across* a folder boundary
> through its barrel; import *within* the barrelled folder by direct relative path. Everywhere else,
> import the concrete file.

---

## 4. Folder layout

### Group by category — nest, don't dump

A folder holds **a few files or sub-folders grouped by category**, never a flat pile. As a unit grows,
split it into named sub-folders by concern — the way `domain/` already groups by sub-domain and
`core/services/` by service. Rule of thumb: **past ~4–5 files in one folder, group them.** The game module
was decomposed into this shape: `core/lib/game/` — the whole embedded engine — splits into **17** categorized
sub-folders (`boot/ combat/ controls/ doors/ enemy/ input/ level/ levels/ painters/ presentation/ registry/
render/ sprites/ telemetry/ weapons/ world/ zone/`), while `features/bsp-demo/` is now just the thin **mount
component** (`bsp-demo.component.{ts,html,scss}` — nothing else). `core/lib/bsp-engine/` (~15 source files) is
the one remaining FLAT module — a cohesive engine kept whole for now; it may yet split by concern
(walk / geometry / voxel / gpu). Every new file lands grouped, not at
the root. Sub-folders are wired through the module's **existing sub-barrel** (§3): the barrel re-exports the
nested files, so consumers still import from the one barrel — the nesting is internal organization, not
new public surface. (Folder-level companion to the one-file-one-responsibility rule in `code.md §1`.)

### `domain/` — one file per type, grouped by sub-domain

One **type / interface / value-set** per file. Files are grouped into sub-domain folders so the
domain reads like a glossary:

```
domain/
  index.ts                         # the single public barrel
  content.ts                       # the Content contract (root)
  about/    about.ts about-detail.ts about-link.ts
  aria/     aria.ts
  article/  article.ts article-block.ts article-tag.ts articles-ui.ts indexed-article.ts inline-run.ts
  code/     code-lang.ts token.ts
  comment/  comment.ts
  contact/  contact.ts contact-kind.ts contact-method.ts availability.ts form-labels.ts
  game/     weapon-id.ts                   # WEAPON_IDS value-set + the derived WeaponId union (the game domain)
  i18n/     lang.ts theme.ts
  player/   chapter.ts metric.ts scene-id.ts scene-{intro,stack,projects,timeline,outro}.ts stack-card.ts timeline-row.ts up-next.ts
  project/  project-scene.ts project-thumb.ts
  series/   series.ts series-ui.ts
  stack/    stack-tab.ts stack-tech.ts stack-tier.ts
```

`Content` (in `content.ts`) is the multilingual contract: the master interface **every**
`content.<lang>.json` must satisfy. FR is the human-authored source; the other locales are
**AI-translated** from it (`make i18n`, committed) and validated by the same shared bridge
(`json-content.ts` → `satisfies Content`), so a missing/extra key fails the build.

### `core/` — organized by nature, one folder per service/unit

```
core/
  api/        api.token.ts  content-api.service.ts          # the API module (the .NET-API seam)
  services/   content/  game/  i18n/  player/  reviews/  search/  seo/  theme/  viewport/  # one folder per service (+ its .spec)
  content/    content.<lang>.ts + content.<lang>.json (one per Lang)  json-content.ts  article-bodies.ts (generated)
  lib/        index.ts + one pure function per file (+ constants.ts, + the bsp-engine/ engine and the game/ embedded-engine sub-modules) — 100 % tested, except game's browser host adapters (§1 callout / testing.md)
```

- `core/api/` holds **everything API-related**, kept separate from `services/`. To wire a real .NET
  API, the single file to change is `content-api.service.ts`.
- `core/services/<name>/` — reactive DI state, **one folder per service**, each with its `.spec.ts`.
- `core/content/` — **all text lives here as JSON** (one `content.<lang>.json` per `Lang`), exposed
  through a typed bridge (§5). Article **bodies** are real Markdown kept *out* of the JSON, under
  `client/src/content/articles/<slug>.<lang>.md`, imported as text by the **generated** `article-bodies.ts`
  (`make gen-article-bodies`). Non-FR locales are AI-translated from FR (`make i18n`, committed).
- `core/lib/` — **pure** functions + infra constants, one declaration per file, barrelled, held to
  **100 % coverage** (the `core/` guard).

### `features/` — folder-per-feature, then folder-per-component

One folder per feature. Inside a feature, the **feature-root component stays flat** at the feature
root (`home.component.*`, `articles.component.*`, `series.component.*`); every **sub-component lives
in its own folder** with its co-located template + styles (+ spec):

```
features/home/
  home.component.{ts,html}                 # feature root — flat (no own scss)
  comment/  comments/  like-bar/  up-next/  video-meta/   # one folder per sub-component
  player/   player.component.{ts,html,scss}
            player-stage/  player-stage.component.{ts,html,scss}  # bg + scenes, reused inline + in the mini
            mini-player/   mini-player.component.{ts,html,scss}   # floating PiP, rendered at the shell
            typed/   typed.component.{ts,html,scss}      # no-reflow per-string typewriter (sd-typed)
            scenes/  intro-scene/ stack-scene/ projects-scene/ timeline-scene/ outro-scene/
features/bsp-demo/                                 # the hidden BSP game (OPEN SPACE.EXE) — a top-level lazy feature
  bsp-demo.component.{ts,html,scss}                # sd-bsp-demo — the thin MOUNT component, and NOTHING else; served at /bsp AND mounted in the player. The whole engine (logic + render + input + boot + painters + presentation) lives in core/lib/game; the component imports each module it needs by direct path.
```

Features with internal routing keep a `*.routes.ts` at the feature root and a `*-detail/` folder for
the detail component (`articles/articles.routes.ts` + `article-detail/`; same for `series/`).

> **Rule:** each component lives in its own folder with its template, styles, and spec co-located —
> except a *feature-root* component, which sits flat at the feature root.

### `shared/` and `layout/` — folder per component

`shared/icon/`, `shared/code-block/`, `shared/inline-runs/`; `layout/nav/`, `layout/prefs/`,
`layout/channel-header/`, `layout/tabs-bar/`. Each is a folder holding the component + its
co-located template/styles/spec. `shared/` holds **only** these cross-feature `sd-` presentational
components — there is **no `shared/game/`**. The game's presentational helpers (the `DoomHud` /
`WeaponView` / `ClimbView` imperative classes + the `weapons` / `effects` JSON-bridge data + the `gaze`
turn-EMA helper + the `climb-frames` / `loaded-image` support modules, each with its `.spec.ts` where
DOM-light) now live inside the embedded engine at **`core/lib/game/presentation/`** (§1 callout, §3
barrel) — engine-agnostic still, but owned by the engine that draws with them.

---

## 5. The typed content bridge

Text content is JSON, but consumed as the strongly-typed `Content`. The bridge in
`core/content/content.<lang>.ts` (one per `Lang`, all sharing `json-content.ts`) is the seam:

```ts
export const FR = data satisfies JsonContent as Content;
```

where `JsonContent` is `Content` with the closed-union fields (`Article['tag']`, `Chapter['id']`,
`ContactMethod['kind']`) widened back to `string` (what a JSON import yields). This pattern is
**mandatory** and must not be simplified:

- `satisfies JsonContent` (the shared `JsonContent` lives in `core/content/json-content.ts`, imported by
  every per-locale bridge) keeps the **compile-time completeness + cross-locale alignment** check (every
  field present, all languages structurally identical).
- `as Content` **recovers** the closed unions the JSON import widens to `string`.
- Do **not** drop to a bare `as Content` (loses the missing-field check) nor a plain
  `satisfies Content` (won't compile — `string` isn't assignable to `SceneId`/`ContactKind`/…).

### The `I18nService` facade — the consumed surface

Consumers never touch the `FR`/`EN` bridge or the `ContentStore` directly. They read everything
through **`I18nService`** (`core/services/i18n/`), a thin facade over the `ContentStore` NgRx
SignalStore that re-exposes four members and nothing else:

- `lang: Signal<Lang>` — the active language.
- `content: Signal<Content>` — the active-language `Content` (always present; the store seeds it
  synchronously, so there is no `null`/loading hole to guard in templates).
- `loading: Signal<boolean>` — `true` while the store revalidates against the API.
- `setLang(lang: Lang): void` — delegates to the store.

The facade exists so consumers (and the router) depend on a **stable, lightweight surface** rather
than the store's shape; the store stays free to evolve (stale-while-revalidate, extra state)
without rippling into every component. **The route — not `setLang` — is the source of truth for
language** (§7): `setLang` is called by the `langResolver`, not by UI toggles.

### State-layering decision rule

Pick the state primitive by **scope and surface**:

- **Plain signal service** — local/component-scoped reactive state (e.g. `PlayerService`,
  `ThemeService`): `signal()`/`computed()`/`effect()` on a `providedIn: 'root'` service.
- **Thin facade over a store** — when consumers need a **stable, lightweight surface** over a
  larger store (`I18nService` re-exposing four members over `ContentStore`).
- **NgRx SignalStore** (`@ngrx/signals`) — shared client/content state with non-trivial lifecycle
  (the content store: source of truth for `lang`/`content`, stale-while-revalidate over the API).

No NGXS / observable-store — they are off-paradigm here.

---

## 6. One declaration per file

> **A file holds a single interface / type / function / class / component.** Not a grab-bag.

- A component's `.ts`, `.html`, and `.scss` (and `.spec.ts`) together form **one** component — that
  is still "one declaration", spread across co-located files.
- A **`*.spec.ts` is not a separate declaration** — it *tests its sibling* (the `foo.ts` /
  `foo.component.ts` next to it), so it never counts against one-declaration-per-file and never gets
  its own folder; it lives co-located beside the file it covers.
- A value set and its derived type count as **one** declaration and share a file — the canonical
  pattern is an `as const` object immediately followed by its derived union, e.g.
  `domain/i18n/lang.ts`:

  ```ts
  export const LANG = { FR: 'fr', EN: 'en' } as const;
  export type Lang = (typeof LANG)[keyof typeof LANG];
  ```

  Likewise `domain/article/article-tag.ts` (`ARTICLE_TAGS` → `ArticleTag`).

### Allowed exceptions

A **cohesive constant group** may share one file when the constants are a single conceptual unit:

- `core/lib/constants.ts` — infra constants grouped together (`STORAGE_KEYS`, `DATA_THEME_ATTR`).
- `core/lib/site.ts` — the SEO/site constant set (`SITE_ORIGIN`, `SITE_NAME`, `DEFAULT_OG_IMAGE`,
  `AUTHOR`, `OG_LOCALE` over all `LANGS`) grouped as one site-config unit; `lang-path.ts` holds the
  `pathInLang` helper.

The content bridge (`content.fr.ts`) co-locating the private `JsonContent` helper type with the `FR`
export is also fine — the helper exists only to type the single export.

A **component's own tightly-coupled type stays with the component**, not in its own file — **domain**
types get their own file, but a component-local one does not: an exported **input-type union**
co-located with the component (e.g. `IconName`, the 29-name union, lives in the generated
`icon-set.ts` and is re-exported by `icon.component.ts`),
and a **local, non-exported** view-model interface inside the component file (e.g. code-block's
`interface Line { lineNumber: string; tokens: Token[] }`). Do **not** spin these into `icon-name.ts` /
`code-line.ts`.

These are *cohesive groups*, not grab-bags: every member shares one purpose. When constants drift
apart in concern, split them. A pure function never shares a file with another pure function — each
`core/lib/*.ts` holds exactly one (its `.spec.ts` co-located alongside).

A unit may also own one or more **imperative helper modules** — each in its own file, a stateful
browser-only class or render module that is neither a pure `core/lib` function nor an Angular service (DI
would imply the wrong sharing). The BSP game is the reference: `sd-bsp-demo` stays a thin **mount** shell
(lifecycle + the `rAF` loop + the DOM/touch-event boundary + the run state) and delegates everything to the
self-contained engine in **`core/lib/game`** (§1 callout), importing each module it needs by direct path.
The **pure** engine + combat live in `core/lib/bsp-engine` + the logic sub-folders of `core/lib/game`
(100 %-tested, no DOM); the **browser host adapters** live in the engine's `render/` / `input/` / `boot/` /
`painters/` sub-folders — `render.worker.ts` (a worker painting one band of the frame), `render-pool.ts`
(`createRenderPool` — the `SharedArrayBuffer` multi-worker pool, with a single-threaded main-thread
fallback), `gpu-renderer.ts` (the WebGPU compute backend — the default execution, consuming `frame-commands`
buffers), and `load-textures.ts` (decoding the WebP art over the procedural base). For the on-screen chrome
the engine instantiates the **presentation** helper classes from `core/lib/game/presentation/` with `new` —
`DoomHud` (the composited image status bar, the burnt-out-developer face one of its zones), `WeaponView`
(the FPS weapon sprite + fire/reload animation) and `ClimbView` (the two-handed mantle overlay) — all built
on the `loaded-image` loader. One class/module per file, `.spec.ts` alongside wherever it is pure or
DOM-light; the mount component + the browser/canvas host adapters (`render-pool` / `render.worker` /
`gpu-renderer` / `render-host` / `load-textures`, the `painters/`, and `presentation/`'s `doom-hud` /
`weapon-view` / `loaded-image`) are coverage-excluded as browser-only code and proven in a real browser —
see `testing.md`. Splitting a unit this way (rather than letting the component grow) keeps each part small
and unit-testable in isolation.

---

## 7. Routing & SEO placement (architectural surface)

Routing and SEO are wired at the root and in `core` — they obey the same boundaries:

- **Language is a URL prefix via one explicit static tree per `Lang`** (`/fr`, `/en`, `/es`, `/de`, …),
  **generated from `LANGS`** in `app.routes.ts` (`LANGS.map(...)`), each running a `langResolver`
  (`resolve: { lang }`) that syncs `I18nService` before render. It is **not** a `:lang` param — a
  parameter-first parent route breaks Angular's native prerenderer (empty `<router-outlet>`). The
  generated trees keep **literal-path** configs, preserving this. `/` and unknown paths redirect to
  `/${DEFAULT_LANG}` (a const-template string, build-evaluable). All trees share the same **lazy**
  children (`langChildren()`). `app.routes.server.ts` enumerates prerender routes per `Lang` the same way.
- The **route is the source of truth for language**: `routerLink`s are prefixed with `i18n.lang()`;
  the language **picker** navigates to the same path in the chosen `Lang` (`pathInLang`, swap segment 0),
  it does not call `setLang` directly. `setLang` swaps content **synchronously** via `peek` so
  prerender/SSR snapshots each route in its own language.
- **Detail routes** read `:slug` through `input()` via `withComponentInputBinding()`; the feature
  resolves the entry by `findIndex(x.slug === slug())`.
- **SEO logic lives in `core`**: `core/services/seo/seo.service.ts` sets title/OG/canonical/hreflang
  + `BlogPosting` JSON-LD (hreflang alternates + `og:locale:alternate` looped over `LANGS`), using pure
  helpers in `core/lib/site.ts` / `abs-url.ts` / `lang-path.ts` / `article-description.ts`. `AppComponent`
  sets the baseline; article-detail sets its own. The SEO service depends inward (on `core/lib` +
  `domain`) like any other `core` service.
- **Build-time config**: `client/src/environments/environment{,.prod}.ts` (`apiBaseUrl`), swapped by
  `angular.json` `fileReplacements` for prod; `API_BASE_URL` (`core/api/api.token.ts`) self-provides
  from the active environment.

> The detailed *content* of routing/SEO (every route, the SSG scripts, JSON-LD shape) is specified in
> the routing/SEO product spec — this section fixes only **where** that code lives and **which way**
> it depends.

---

## 8. Quick checklist

Before adding or moving a file, verify:

- [ ] Does it import only **inward** (features/layout/shared → core → domain)? No outward, no
      `core → features`, no **feature → feature**.
- [ ] Does `domain/` code import **nothing** (production)?
- [ ] If a type/helper is needed by ≥ 2 features, is it in `domain` (type) or `core` (logic), not
      copied or imported sideways?
- [ ] Cross-folder import through a **barrel** only for `domain/` and `core/lib/`; intra-folder
      imports go **file → file directly** (never the own barrel).
- [ ] Every other import is a **direct file path** (services, api, content, components).
- [ ] **One declaration per file** (component = its co-located `.ts/.html/.scss/.spec`); shared files
      only for the value-set+derived-type pattern or a cohesive constant group.
- [ ] Component in its **own folder** with co-located template/styles/spec — unless it is a
      feature-root component (flat at the feature root).
