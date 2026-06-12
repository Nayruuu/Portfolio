# Conventions — Testing

Canonical rulebook for the test contract. `CLAUDE.md` and the skills **reference** this file;
they never restate the numbers. The code wins: every threshold/path below was read from the
actual `client/` sources, not paraphrased.

Two layers protect the app:

- **Unit / component** — **Vitest** (zoneless), run by the `@angular/build:unit-test` builder.
- **E2E + visual regression** — **Playwright** (a desktop **chromium** project for the full suite, a
  **mobile** Pixel 5 project that re-runs only the visual specs, and a **webkit** iPhone project that
  guards the player on the real iOS Safari engine), the net that guarantees a pixel-identical render
  across a refactor.

Plus two **build-time guard scripts** in `client/scripts/` (not part of the test runners):
`check-core-coverage.mjs` (100 % on `core/`) and `check-prerender.mjs` (static-HTML article guard).

---

## Commands (single source: the `Makefile` / `client/package.json`)

| Task | `make` | npm (from `client/`) | Underlying |
| --- | --- | --- | --- |
| Unit/component | `make test` | `npm test` | `ng test` |
| Unit + coverage + core guard | `make test-cov` | `npm run test:cov` | `ng test --coverage && node scripts/check-core-coverage.mjs` |
| Watch | — | `npm run test:watch` | `ng test --watch` |
| E2E + visual | `make e2e` | `npm run e2e` | `playwright test` |
| Re-baseline snapshots | — | `npm run e2e:update` | `playwright test --update-snapshots` |
| Static build + prerender guard | `make build-ssg` | `npm run build:ssg` | `ng build --configuration production && npm run gen:seo && node scripts/check-prerender.mjs` |

The prerender guard (`check-prerender.mjs`) runs **inside** `build:ssg`, after the static build and
SEO generation. The core-coverage guard runs **inside** `test:cov`, after coverage is produced.

---

## TDD (mandatory: red → green → commit)

Write the failing test **first**, watch it fail (red), implement the minimum to pass (green),
then commit. The kit's `core/lib` pure functions and the SignalStore/services were built this way;
their 100 % coverage is a consequence, not a retrofit. Do not write implementation before its test
exists and fails for the right reason.

---

## Vitest — unit / component (zoneless)

Configured in `client/angular.json` under `architect.test` (builder `@angular/build:unit-test`):

- `runner: "vitest"`, `tsConfig: "tsconfig.spec.json"`, `include: ["src/**/*.spec.ts"]`.
- `providersFile: "src/test-providers.ts"` — the global test providers (see below).
- `coverageReporters: ["text", "json-summary"]` — the `json-summary` reporter is what the
  core-coverage guard reads.
- `tsconfig.spec.json` includes `src/**/*.d.ts` (picks up the ambient `*.md` type),
  `src/**/*.spec.ts`, and `src/test-providers.ts`; `types: ["node"]`.

### `src/test-providers.ts` — what it supplies

The `providersFile` `default`-exports a flat provider array merged into **every** test's
`TestBed`, so specs don't repeat the baseline wiring. Today it supplies exactly two:

- **`provideZonelessChangeDetection()`** — the test env runs zoneless like the app, which is *why*
  `await fixture.whenStable()` (not `fixture.detectChanges()` under Zone) is the flush before DOM
  asserts.
- **`provideRouter([])`** — an **empty** route table so any component using `routerLink` /
  `routerLinkActive` mounts without per-test router setup. The empty routes are deliberate: unit
  tests never navigate (real navigation is Playwright's job in E2E), they only need the router
  *directives* to resolve.

Add a provider here only when it's genuinely global; component- or service-specific providers stay
in the individual spec's `configureTestingModule`.

### Patterns (match the existing specs exactly)

- Import from `vitest` (`describe, it, expect, beforeEach, vi, afterEach`) and Angular
  (`TestBed`, `ComponentFixture` from `@angular/core/testing`).
- **Standalone components**: `await TestBed.configureTestingModule({ imports: [TheComponent] }).compileComponents()`,
  then `fixture = TestBed.createComponent(TheComponent)`.
- **Set inputs** via the component ref signal API: `fixture.componentRef.setInput('name', value)` —
  never assign to a field, never `@Input()`.
- **Zoneless flush**: `await fixture.whenStable()` before asserting on rendered DOM (this is *why*
  zoneless change detection is provided in the test env).
- **Services**: `TestBed.inject(TheService)`; the bundled `ContentApiService` is real and
  synchronous (`peek()` returns the seed `FR`/`EN`; `getContent()` resolves the same) — no HTTP mock
  needed for the content path.
- **Timers**: `vi.useFakeTimers()` for the `PlayerService` 100 ms tick / contact-form `setTimeout`;
  always restore with `afterEach(() => vi.useRealTimers())`.
- **Storage / browser APIs**: `vi.spyOn(Storage.prototype, 'getItem' | 'setItem')` to mock
  localStorage (e.g. the quota/read-failure branches in the content store and theme service);
  `localStorage.clear()` in `beforeEach` for determinism.

### Coverage thresholds — **global** (exact, from `angular.json` `coverageThresholds`)

| Metric | Threshold |
| --- | --- |
| Statements | **85** |
| Branches | **78** |
| Functions | **67** |
| Lines | **88** |

These are enforced by the Vitest runner across the whole project. A run under any threshold fails.

### Coverage — **`core/` 100 % guard** (`client/scripts/check-core-coverage.mjs`)

The `@angular/build:unit-test` builder supports only **global** thresholds, so a separate script
enforces **100 %** on the pure-logic layer.

**Mechanics (exact):** the guard runs **inside `npm run test:cov`** (`make test-cov`), chained
**after** `ng test --coverage` produces the summary. It walks the coverage summary and, for **every
file whose path `includes('/core/')` and does *not* end in `.spec.ts`**, requires **`pct === 100`**
on **all four** metrics — `statements`, `branches`, `functions`, `lines`. If any such file is below
100 % on any metric, the script `process.exit(1)` and **the build fails**; a plain `ng test` (no
`--coverage`) never invokes it. Concretely:

- Reads `coverage/super-dev-portfolio/coverage-summary.json` (the `json-summary` reporter output) —
  so the `json-summary` reporter must be configured for the guard to have an input.
- Iterates the summary's per-file entries, skipping the `total` key, any path **not** containing
  `/core/`, and any `*.spec.ts` (a spec tests its sibling — it isn't held to the bar itself).
- On any qualifying file below 100: prints each offender as `relPath → metric:pct%, …` and
  `process.exit(1)`.
- On success: prints `✓ core/ couvert à 100% (statements, branches, functions, lines)`, exit 0.

Net effect: `domain/` (no logic) and the UI layers ride the *global* thresholds, while **everything
under `core/`** — `lib/` pure functions, the SignalStore, every service — is held to **100 %**.
Every new `core/` file must arrive with tests that keep it there, or `test:cov` goes red.

---

## Playwright — E2E + visual regression

Config: `client/playwright.config.ts`. Specs in `client/e2e/*.spec.ts`; baselines under
`client/e2e/__screenshots__/`.

### Configuration (exact)

- `testDir: './e2e'`; `snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{-projectName}{ext}'`
  — the trailing `{-projectName}` suffixes each baseline per project (`…-chromium.png` / `…-mobile.png`),
  so desktop and mobile snapshots coexist under one screenshot dir.
- `fullyParallel: false`, `workers: 1` — **serial**; full-page captures flake under parallel CPU/font
  contention. Keep it serial.
- `forbidOnly: !!process.env['CI']` — `.only` is rejected in CI, allowed locally.
- `retries: CI ? 1 : 0`; `reporter: 'list'`; `trace: 'on-first-retry'`.
- `use.baseURL: 'http://localhost:${port}'` where `port` = **`PW_PORT` env or 4200** — override it
  (`PW_PORT=4201 npx playwright test …`) whenever another project occupies :4200, because
  `reuseExistingServer` would otherwise silently reuse the WRONG app and every spec would probe it.
  `use.locale: 'fr-FR'` — deterministic: `/` redirects to `/fr`, so baselines and text assertions are
  FR by default. EN is reached by clicking the `.nav .prefs__lang-toggle` "EN" picker or via an `/en/...` deep link.
- `expect.toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.01 }` — animations frozen,
  **1 % pixel-diff tolerance**.
- `projects`: **three** — `chromium` (`devices['Desktop Chrome']`, runs every spec except the iOS ones,
  via `testIgnore: /(player|game)-ios\.spec\.ts/`), `mobile` (`devices['Pixel 5']`, 393×851) with
  `testMatch: /visual(-detail)?\.spec\.ts/`, so the mobile project **only re-runs the visual specs** to
  capture phone baselines, and `webkit` (`devices['iPhone 13']`) with
  `testMatch: /(player|game)-ios\.spec\.ts/` — the real **iOS Safari engine**, which
  the Chromium-based `mobile` project (device *emulation*, not WebKit) can't exercise. The behavioural specs
  drive nav controls (search + the `<sd-prefs>` theme/language picker), and the **nav is hidden below `md`**
  (theme + language relocate to the floating `.prefs-dock` on phones), so they stay desktop-only. **Setup:**
  the `webkit` project needs `npx playwright install webkit` (the others use chromium).
- `webServer: { command: 'npm start -- --port ${port}', url: 'http://localhost:${port}',
  reuseExistingServer: !CI, timeout: 120_000 }` — auto-starts `ng serve` (no prerender) on the same
  `PW_PORT`-driven port, up to 120 s; CI gets a fresh server, local reuses a running one.

### The 19 specs (behavioral + visual)

Behavioral (target by ARIA role / stable class, FR text, case-insensitive regex where noted):

- `navigation.spec.ts` — 6 tabs by `role: tab` (`/accueil|articles|séries|propos|stack|contact/i`);
  each gains `aria-selected="true"` on click.
- `preferences.spec.ts` — theme toggle (`aria-label="Changer de thème"` → `<html data-theme="dark">`,
  default `light`); language switch (`.nav .prefs__lang-toggle` "EN" → "Home" visible, "Accueil" count 0).
- `seo.spec.ts` — `/fr/articles/etrangler-le-monolithe-dotnet`: title `/super-dev\.app/`, one
  `og:title`, `og:type="article"`, canonical ending the slug, **5 hreflang** alternates (one per `Lang`
  + `x-default`) and one `og:locale:alternate` per other language, and
  `<script id="sd-jsonld">` with `@type "BlogPosting"`, `inLanguage "fr"`, non-empty `headline`.
- `article-body.spec.ts` — real Markdown prose (`.article-detail__body` contains "anti-corruption",
  first `<strong>` visible, **no literal `**`**); inline code → `<code>` on
  `angular-ssg-azure-static-web-apps`.
- `player.spec.ts` — auto-play shows `.player__btn[aria-label="Pause"]`; click → `aria-label="Lecture"`.
  Plus the advertised **`k` keyboard shortcut** toggles play/pause both ways (`body.press('k')`).
  Plus fullscreen: the full button enters **native** fullscreen (`document.fullscreenElement`), exit via
  the toggled button (headless Esc can't reach the browser keybinding); and the **CSS-fallback** path
  (`addInitScript` forces `fullscreenEnabled` → `false`) toggles `.player.is-fullscreen` and exits on
  a real `Escape` through the component's own handler; and scrub determinism — seeking into a chapter
  settles on exactly **one** caret with a non-empty strict prefix (atomic in-page sample), the ≤1-caret
  sequential invariant sampled over time.
- `player-ios.spec.ts` — **WebKit-only** (the `webkit` project), two tests: (1) the scaled `.scene--fit`
  keeps a sane positive downscale (`0 < scaleX < 1.2`) and stays inside the player box — a regression net
  for the WebKit `atan2(<cqw>)` miscompute that scaled scenes negatively and blanked the player on iPhone;
  (2) the fallback fullscreen (`addInitScript` forces `fullscreenEnabled` → `false`) rotates the player 90°
  in portrait (computed-transform matrix `a ≈ 0`, `|b| ≈ 1`) for forced landscape. The Chromium-based
  `mobile` emulation can't catch engine bugs, and `home` masks the player in its visual baseline anyway.
- `game-ios.spec.ts` — **WebKit-only** (the `webkit` project), two tests guarding the game on iPhone: (1)
  in **landscape**, entering the game is a **non-rotated** fixed viewport overlay (`.player` `transform:none`
  + `position:fixed`) and a touch on `.game__joystick` spawns the visible `.game__stick` **centred at the
  touch point** (< 4px) — a regression net for the iOS CSS-rotation that offset the touch coordinates and
  made the game unplayable; (2) in **portrait**, the game **forces landscape** — the overlay is CSS-rotated
  90° (`.player` `transform` ≠ `none`) yet the joystick still lands at the touch point (< 4px), proving the
  `localPoint()` touch-coordinate compensation round-trips the rotation correctly.
- `article.spec.ts` — list → first `a.vgrid-card` (cards are real anchors) → `article.article-detail` →
  back link (`/retour aux articles|back to articles/i`) → card visible again.
- `series.spec.ts` — list → first `a.pcard` → `article.series-detail` → back link
  (`/retour aux séries|back to series/i`) → card visible again.
- `i18n-routing.spec.ts` — root → `/fr`; "EN" → `/en` + "Home"; `/en/articles` deep link
  (tab `aria-selected`, card visible); language preserved on tab click (`/en/series`).
- `contact.spec.ts` — two cases: (1) fills name/email/message, submits; `.contact-form` stays visible,
  URL still `/contact`, `.contact-form__status` live-region confirms (mock, no navigation); (2) an empty
  submit is blocked — inline `.contact-form__error` shown, status stays empty, `aria-invalid` set.
- `search.spec.ts` — `/` focuses `.nav__search-input`; typing routes to `/fr/articles` and filters
  `a.vgrid-card` live; a no-match query surfaces `.vgrid-empty` with zero cards.
- `overflow.spec.ts` — the mobile-first guard: at a **360px** viewport, asserts **no horizontal scroll**
  (`document.scrollingElement.scrollWidth <= clientWidth`) on every public route (the **6** FR routes
  `/fr`, `/fr/{articles,series,about,stack,contact}`) **and on every article detail page in FR + EN**
  (a sufficient sample across locales: the overflow risk is unbreakable **code** lines, which are
  **identical in every language** — code is never translated — while prose wraps; slugs read from
  `content.fr.json` at runtime, so new articles are covered
  automatically — article bodies are content-dependent: one long unbreakable code line can widen a
  bare-`1fr` grid track past the phone viewport, which is exactly the bug this caught). It sets its
  own 360px viewport and runs under **chromium** (it isn't a visual spec, so the `mobile` project's
  `testMatch` skips it).
- `bottom-nav.spec.ts` — at a **360px** viewport (chromium): the `.tabs` nav has `position: fixed`,
  is bottom-anchored, and tapping a section tab routes to that section and sets `aria-selected="true"`
  on the tapped tab.
- `prefs-dock.spec.ts` — **Pixel 5 viewport** (`test.use(devices['Pixel 5'])`, runs under chromium): the
  mobile theme/language dock — opening `.prefs-dock .prefs__lang-toggle` shows a 4-item picker that opens
  **upward** (menu bottom ≤ toggle top, full height on-screen — guards the specificity-tie regression that
  collapsed it downward off-screen); selecting "EN" routes to `/en` and the toggle reads `EN`.
- `game.spec.ts` — the DOOM-like game mode (chromium): the player's gamepad button enters game mode
  (`sd-game canvas` visible, `sd-player-stage` gone); the game's movement keys (arrows/space) **don't
  scroll the page** (`preventDefault` — `window.scrollY` unchanged); the **mute** button toggles its
  `aria-label`; **Esc** returns to the video. A second test guards a fixed bug: exiting via the in-game
  **exit button** must **resume** the video (`.player` loses `is-paused`) — the click must not bubble to
  the player's toggle-play; a desktop assertion also checks the composited `.game__hud` canvas renders. A
  third test drives the **damage loop**: the game's first **manager** throws an **invite** — once it
  contacts the player the **health drops below 100** (read off the component's `playerHp` via the
  dev-mode `ng` global — the HUD is a canvas, not DOM text — confirming the invite → `vitals` →
  `playerHp` pipeline end-to-end). The pure raycaster engine
  (`core/lib/raycaster/*` — map/DDA/collision + `enemy` (per-kind `ENEMY_CONFIG` — rush/turret/kite
  AI), `fire` parameterised hitscan (`resolveFire(pose, enemies, map, range, cone)`),
  `floor-cast` projection, `projectile` (step + hit-player; carries `ProjectileSkin`
  `'invite'|'paper'|'memo'`), `vitals` (damage model), `pickup` (collect — incl. `'ammo'` kind: +20,
  capped at 200), `rng` (seeded PRNG — mulberry32 `makeRng`/`randInt`/`pick`, 100 % tested),
  `generate-level` (seed-sweep invariant test: determinism, enclosed map, reachable exit via
  flood-fill, front enemy is always a manager, all three kinds covered across a seed sweep, flats in
  palette range, difficulty scaling), `levels`/theme data (`THEME_CYCLE`; office themes
  openspace/meeting/executive; the ASCII `LEVELS`/`parseCells` are gone — `levels.spec` now asserts
  the office theme names), `isFacingExit`,
  the combat `step` (now **data-driven by a `WeaponCombat`** — per-weapon `range`/`cone`/`damage`/
  `fireCooldown`/`knockback`/`costsAmmo`; the specs drive **both** `costsAmmo` arms via a melee + a
  synthetic ranged fixture; the shared `MELEE_RANGE`/`MELEE_CONE`/`AIM_CONE` + `AMMO_START` are exported
  from `game-step.ts` for the shell to fold in; + HR slow decay (`HR_SLOW_DURATION`/`SLOW_FACTOR`) +
  memo-vs-paper skin dispatch) + the pure `knockback` (a hit enemy shoved straight back, **axis-separated
  + wall-clamped** — clear-push + each-axis wall-block arms covered) + `GameService`
  are unit-tested under the `core/` 100 % guard, and the co-located `sd-game` helpers each have a
  `.spec.ts` (`game-input` — intent/joystick/fire + `use` one-shot + the portrait touch-coord
  inverse-transform; `game-renderer` — floor/ceiling cast + paint + per-kind enemy billboards +
  per-skin projectile billboards + pickup billboards + hurt flash + the weapon blit **delegated to the
  `WeaponView`** (spied) via a stubbed 2-D context; the spec asserts hybrid smoothing ends `false` after
  the sprite pass; `game-textures` — the per-theme procedural texture/flat/switch builders +
  `buildEnemyFrames()` (per-kind: manager/printer/hr) + `buildProjectiles()` (per-skin:
  invite/paper/memo) + `buildPickups()` (coffee/headphones/RAM); `weapons` — the JSON registry bridge
  (field parsing + `weaponById` + `weaponCombat` for a melee + a ranged weapon); `weapon-view` — the
  FPS sprite animation (idle → trigger → strike-frame-fires-once → idle, cooldown blocks re-trigger, SSR
  no-throw + transparent fallback, bottom-centre NEAREST blit); `game-audio` — the Web Audio scheduler +
  `playMelee` (the key-clack swing); `doom-hud` — the atlas-driven HUD compositor (per-tier asset
  selection + normalized zones; the health/mental digits, the burnt-out-dev face mugshot zone, arms,
  weapon bay, keycards; SSR fallback)), so the e2e only covers the wiring;
  the live `<canvas>` is **never** screenshotted.
- `game-mobile.spec.ts` — **Pixel 5 viewport** (`test.use(devices['Pixel 5'])`, runs under chromium): on a
  coarse-pointer device, entering the game shows the dual-thumb touch overlay (`.game__joystick` /
  `.game__look` visible), and a touch on the joystick zone **spawns the visible `.game__stick`** under the
  thumb. A second test drives the touch controls to **close into melee range** of the sentinel printer
  down the throat (forward to the corner → turn ~90° → a **column-centring back-nudge** then a **brisk**
  descent held while tapping fire, so a swing's strike frame lands in the full reach despite the slower
  0.8 s cadence) and asserts the **kill counter increments** — one 25-damage swing one-shots the 6-hp
  printer (the melee keyboard replaced the long-range gun). A third
  test taps the fire button and asserts **`playerAmmo` stays at its start** — the keyboard is ammo-less,
  so a swing spends nothing (the behavioural inverse of the old "firing spends ammo" gun test; state is
  read off the component, the HUD being a canvas). Its own file because `isMobile` must be set at file scope.

Visual baselines (captured under **both** projects — `chromium` desktop and `mobile` Pixel 5):

- `visual.spec.ts` — one full-page snapshot per screen, parameterized over
  `home` (masks `.player` — continuous `setInterval` animation), `articles`, `series`, `about`,
  `stack`, `contact`. Each: `goto('/')` → `waitForLoadState('networkidle')` → click tab (if any) →
  `toHaveScreenshot('<name>.png', { fullPage: true, mask: [...] })`.
- `visual-detail.spec.ts` — `article-detail.png` and `series-detail.png` (navigate in, wait for the
  detail element + `networkidle`, full-page snapshot). These detail screens drift most during a
  refactor; the snapshot separates intended change from accidental regression.

**16 baseline PNGs** total under `e2e/__screenshots__/` — the same 8 screens captured twice (once per
project, per the `{-projectName}` suffix): **8 desktop** `…-chromium.png` + **8 mobile** `…-mobile.png`,
across `visual.spec.ts/{home,articles,series,about,stack,contact}-{chromium,mobile}.png` and
`visual-detail.spec.ts/{article-detail,series-detail}-{chromium,mobile}.png`.

### Snapshot re-baseline discipline

- A visual diff failure means **either** a regression **or** an intended UI change. Investigate the
  diff first — never re-baseline reflexively.
- Re-baseline **only when the change is deliberate and reviewed**, with
  `npm run e2e:update` (`playwright test --update-snapshots`), and commit the regenerated PNGs in the
  **same** change as the code that justifies them (so the diff is auditable).
- Re-baseline on the **same engine/config** each set was captured on — desktop on Chromium
  `Desktop Chrome`, mobile on `Pixel 5` (both `locale: 'fr-FR'`, `animations: 'disabled'`). Different
  OS/font rendering will spuriously rewrite every PNG — don't.
- **Desktop baselines are never re-baselined to absorb a mobile change.** Because the layout is
  mobile-first, a *desktop* (`…-chromium.png`) diff after a responsive edit means the phone styles
  **leaked upward** past their breakpoint — a bug to fix at the source, not a baseline to update.
  `npm run e2e:update` is reserved for genuinely new/intended **mobile** (`…-mobile.png`) baselines.
- The 1 % `maxDiffPixelRatio` already absorbs sub-pixel/font noise; a real diff above it is signal,
  not flake — don't widen the tolerance to make a failure go away.

---

## Prerender guard — `client/scripts/check-prerender.mjs`

A **build guard**, not an E2E test. Playwright's `webServer` is `ng serve` (no prerender), where a
"JS-off" client would see an empty SPA shell — so the "discoverable without JS" guarantee is asserted
on the **build output** instead. Run **after** `ng build --configuration production && npm run gen:seo`
(chained inside `build:ssg`).

Inputs: articles from `src/app/core/content/content.fr.json`; languages **discovered by globbing
`content.*.json`** (fr/en/es/de — no hardcoded list); output dir `dist/super-dev-portfolio/browser`.

For **each article × each language**, at
`dist/super-dev-portfolio/browser/<lang>/articles/<slug>/index.html`, it asserts:

1. The prerendered `index.html` **exists** (else `fichier prérendu manquant`).
2. HTML contains the literal `"@type":"BlogPosting"` (JSON-LD present).
3. HTML contains `"datePublished":"<article.date>"` (date from the content JSON).
4. The body region (`class="article-detail__body"` up to the `article-detail__signature` marker),
   stripped of tags/entities and whitespace-normalized, is **≥ 200 characters** (the Markdown parser
   actually ran at prerender — not a shell).
5. **No leaked Markdown**: the body region contains **no literal `**`** — checked on **prose only**
   (strips `<sd-code-block>…</sd-code-block>` and `<code>…</code>` first, since `**` is legitimate
   inside rendered code like `packages/**` or operators).

Outcome: any failure → prints each offender and `process.exit(1)`. Success →
`✓ <N> pages d'article prérendues (JSON-LD + corps Markdown rendu, sans JS)`, where
**N = articles.length × 2** (one per language), exit 0.

---

## Doc-verification guard — `.claude/scripts/check-docs.mjs` + the kit hooks

A deterministic guard keeps the kit docs honest (the *mechanical* class of issues; semantic ones are
the `claude-auditor` LLM audit's job). `make check-docs` (`.claude/scripts/check-docs.mjs`, unit-tested) verifies,
across `CLAUDE.md` + `.claude/conventions/*` + `docs/PRODUCT.md` + the skills:

- cross-doc `X.md §N` references resolve to a real section;
- relative markdown links resolve to a real file;
- `PRODUCT.md` stays **prose-only** (no language-tagged code fences);
- no stale config filenames (the Prettier config must be referenced as `.prettierrc.json`, never the
  bare extensionless form).

Two Claude Code hooks (`.claude/settings.json`) make it automatic:

- **`Stop` → `stop-docs.mjs`** runs `check-docs` after every iteration and **blocks** until any doc issue
  is fixed.
- **`PostToolUse` → `mark-kit-dirty.mjs`** drops `.claude/.kit-dirty` when a kit file changes; the `Stop`
  hook then **blocks once to require the `claude-auditor` LLM audit** that iteration (auto-trigger; a hook
  runs shell, not the agent itself).

---

## Done means verified (evidence over assertions)

Before calling anything done, run the relevant gates end-to-end and read the output:

- `make lint` (ESLint + Stylelint)
- `make test` / `make test-cov` (unit + global thresholds + `core/` 100 %)
- `make e2e` (behavioral + visual regression)
- `make build-ssg` (static build + SEO + prerender guard)

Before a big refactor, run `make test` + `make e2e` first to capture the green baseline — the visual
regression is what proves the post-refactor render is pixel-identical.
