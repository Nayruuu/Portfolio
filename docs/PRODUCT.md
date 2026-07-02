# Product spec — what super-dev.app *is*

Companion to `CLAUDE.md` (the *how*: stack, architecture). This doc is the ***what***: the concept,
the route/tab inventory, the distinctive mechanisms, the data tables, **and the design source of
truth** — exact token **values**, per-screen pixel spacing, the font-size ladder, and keyframes. It is
exhaustive enough that, given the visual design, a from-scratch rebuild lands **pixel-identical**.

Division of labour (single-source — each fact lives in exactly one place):

- **`.claude/conventions/design.md`** owns the SCSS/design **rules** (BEM nesting, tabs, `@use` order,
  shared-vs-co-located, `:host-context` overrides). It does **not** restate any value below.
- **This file** owns every **value**: the token palette (dark + light), spacing/px, font sizes,
  layout grids, keyframes, and the data tables (chapters, slugs, tags, series mapping).
- All user-facing **copy** lives in the multilingual content store; this doc describes **structure +
  behavior + measurements**, not the strings.
- This is a **product/design spec, in prose** — not a code transcript. Each screen, route, and
  capability is described by its behavior and structure, never by its source.

---

## 1. Concept

A multilingual (FR/EN/ES/DE, extensible via `LANG`) **"YouTube-channel" portfolio** for a full-stack **.NET / Angular / Azure** dev
(brand `super-dev` + `.app` TLD, warm-red "play button" identity). The home page mimics a
YouTube **watch page**; its "video" is a **simulated, autoplaying, looping player** whose frames are
five timed, animated **scenes** — there is no real video element. Aesthetic: dark "cinema" + terminal/
code-editor motifs (shell prompts, traffic-light window dots, monospace, a faint scanline texture).

**Default theme is LIGHT** (warm paper). Dark ("cinema") is opt-in — but the player stage, the
code-block panel, and the contact form stay dark in both themes on purpose (see §4.1, §7, §8, §9).

---

## 2. App shell & navigation

The app shell (`sd-app`) is: a top progress bar (shown only while content is loading), the nav, the
channel header, the tabs bar, then the routed page inside a `.main` wrapper, the mini-player, the
functional `.konami` keyboard-shortcut hint at the bottom (home route only), and the mobile-only
`.prefs-dock` (the floating theme + language pill, §2.1.1). The theme is applied on load (writing `data-theme` onto the document)
and **baseline SEO** is wired: on every navigation the page title becomes `super-dev.app — {first 48
chars of the bio}`, the description is the bio, the page type is `website`, and any leftover article
structured-data is cleared — **except** on an article-detail URL (`/{lang}/articles/{slug}`), which
sets its own SEO. (This runs during prerendering too, so the static build captures it.)

The `.konami` hint (`tip: [k] play/pause · [j/l] ±10s · [/] search`) is **functional**: global
keydown handlers wire `[k]` (play/pause) and `[j]`/`[l]` (seek ∓10 s) on the player and `[/]` (focus the
search) on the nav — all ignored while typing in a field. The player keys only exist where the player
does, so the hint is rendered **only on the home route** (`app.isHome`). Keyboard-only, so it is also
**hidden on phones** (restored at `md`), and uses `--text-faint` so it stays legible.

### 2.1 Nav (`sd-nav`, `.nav`) — desktop only

Sticky `top:0 z-index:50`, `height:56px`, flex, `gap:24px`, `padding:0 24px`, dark
`background:rgb(10 10 11 / 86%)` + `backdrop-filter:blur(12px)`, bottom border `--border-soft`. Light
theme: `background:rgb(250 249 246 / 88%)`. **Hidden below `md`** (`display:none`) — on phones the top
bar is dropped so the player owns the top of the screen; theme + language relocate to the floating
`.prefs-dock` (§2.1.1) and the search/brand/avatar are desktop-only. The sticky bar returns at
`bp.from(md)`.

Members left→right (visual notes):

- **Brand** (`.nav__brand`, mono 14px, `letter-spacing:-0.01em`): a 28px accent-filled square mark
  `>_` (`--r-sm`, `color:#0a0a0b`, a `::after` white→transparent gloss gradient) + the word `super-dev`
  (a fixed literal, like the `>_` glyph) + a `--text-faint` TLD span (the `.app` TLD comes from
  content).
- **Search** (`.nav__search`, `flex:1; max-width:560px; margin-left:auto`, pill, `height:36px`,
  `--surface` bg, mono 12.5px): search icon (16px) + input (placeholder from content) + a `/` kbd chip
  (`.nav__search-kbd`, 10.5px, bordered, `--bg`; the `/` shortcut focuses it). **Functional** — typing
  updates the shared `SearchService.query` (the articles grid filters its cards live on title/tag/
  description) and routes to `/articles` from any other screen so results show as you type; an empty
  query shows all. Focus ring `border-color:--accent-deep`.
- **Actions** (`.nav__actions`, gap 8px): the **`<sd-prefs>`** cluster (theme toggle + language picker,
  §2.1.1) then the **`S` avatar** (32px circle, the brand-red sphere
  `radial-gradient(circle at 30% 25%, oklch(72% .18 22deg), oklch(32% .12 22deg) 70%)` over `--surface`
  — same identity as the channel-header avatar — `#0a0a0b` glyph, 2px border).

### 2.1.1 Preferences — theme + language (`sd-prefs`, `.prefs__*`)

One reusable cluster (`:host{display:inline-flex; gap:8px}`), rendered **twice**: inline in the desktop
nav's actions, and in the mobile `.prefs-dock`. It holds, left→right:

- **Theme toggle** (`.prefs__icon-btn`, 36px circle, transparent → hover `--surface`): moon icon in
  light / sun in dark, title + aria from content; flips `<html data-theme>`.
- **Language picker** (`.prefs__lang`, a **dropdown**: a `.prefs__lang-toggle` showing the current lang +
  `chevron-down`, opening a `.prefs__lang-menu` of `.prefs__lang-item`s built `@for` over `LANGS` — one
  per `Lang`, the active one accent-colored; closes on select, Escape, or an outside click). Selecting
  one **navigates** to the same path in the chosen language by replacing only the first URL segment (the
  destination tree then syncs the language before render), it does **not** switch the language directly.

**Mobile dock** (`.prefs-dock`, owned by `_layout.scss`): a `position:fixed` rounded pill bottom-right,
`bottom:calc(72px + env(safe-area-inset-bottom))` (above the fixed tab bar), `right:12px`, `--surface-2`
bg / `--border` / `--sh-2`; its `.prefs__lang-menu` opens **upward** (it sits near the bottom).
`display:none` at `bp.from(md)` (the nav hosts the prefs there) and while a player is fullscreen.

### 2.2 Channel header (`sd-channel-header`, `.channel`)

A two-part section: a banner and a profile card. It tracks a subscribed/not-subscribed state (toggled
by the Subscribe button) plus two fixed pieces of brand art — the ASCII status box below and a
prompt/value terminal readout (only the uptime value is from content; the other rows are literals).

- **Banner** (`.banner`, `height:200px`, `--r-lg`): two radial gradients (warm-red ellipse at 80% 50%
  + a blue ellipse at 10% 100%) over `#0e0e10`; a masked grid overlay (`.banner__grid`, alternating
  1px lines at **32px** intervals); a fixed **ASCII status box** (`.banner__ascii`, `<pre>`,
  `user-select:none`):

  ```
     ┌─────────────────────┐
     │  $ super-dev.app  │
     │  > status: online   │
     │  > role: full-stack │
     └─────────────────────┘
  ```

  and a right-aligned **terminal readout** (`.banner__terminal`):
  `$ uptime` / `{uptime value from content}` / `$ stack --top` / `  .net  angular  azure  flutter`.
- **Profile** (`.profile`, grid `128px | 1fr | auto`): 128px avatar (`.profile__avatar`, radial
  gradient `circle at 30% 25%, oklch(72% .18 22deg)→oklch(32% .12 22deg) 70%`, 4px `--bg` border,
  `--sh-2`, **`margin-top:-64px`** overlap, green status dot `::after` 18px bottom-right) · meta:
  `h1 "{author} — <span>full-stack</span>"` (the `full-stack` span is accent, fixed brand art),
  handle line (`@super-dev · {featured category without #} · ★ {open-to-work}`), stats line
  (vanity numbers from content: `<b>{subscribers count}</b> {subscribers} · <b>{videos count}</b>
  {videos} · {joined} <b>{joined year}</b>`), bio paragraph · actions: **Share** + **Download-CV**
  (both `btn btn--ghost btn--sm`, 14px icons) + **Subscribe** toggle (primary `Subscribe` no-icon ↔
  neutral `btn` `Subscribed` + bell).

**Below `md` on non-home pages** the header collapses to a **slim identity row**: the banner, the terminal readout, the handle line, the stats line, the bio, and the Share/CV ghost actions are all hidden; only a **40px avatar**, the `{author} — full-stack` name, and the Subscribe button remain. All of these are restored at `md` (the full two-part section described above).

**On the home route below `md`** the whole channel-header is **hidden** (`_layout.scss`:
`:root:has(sd-home) sd-channel-header { display: none }`, restored to `block` at `md` — route-aware
via `:has()`, no TS): the phone home reads like the YouTube-app **watch page** (§4), where the
channel info lives in `video-meta` (incl. the mobile-only bio) instead.

### 2.3 Tabs bar (`sd-tabs-bar`, `.tabs`, `role="tablist"`)

The `.tabs`/`.tab` chrome is global (in `styles/_tabs.scss`), so the component carries no styles of
its own. It renders six language-aware tab links from the fixed segment order, each highlighting when
its route is active (Home matched exactly, the rest fuzzy) and exposing `aria-selected` accordingly.

**6 tabs, fixed order = route order**. Segments `['', 'articles', 'series', 'about', 'stack',
'contact']`; labels from content (FR: `Accueil`, `Articles`, `Séries`, `À propos`, `Stack`,
`Contact`). The Home tab links to `/{lang}`; each other tab to `/{lang}/{segment}`.

**Below `md`** the bar becomes a **fixed bottom navigation bar** (`position: fixed; bottom: 0; z-index: 40`, `env(safe-area-inset-bottom)` inset): each of the 6 tabs is an `<sd-icon>` over a `.tab__label`, active tab highlighted with accent, background override in `_theme-light.scss` for the light theme. Each tab carries a section icon that is **hidden at `md`** (`.tab .tab__icon { display: none }`). At `md`+ the bar returns to the top text row exactly as described above (the `overflow-x:auto` §3.5 chrome, labels only, no icons).

### 2.4 Cross-cutting

- **`data-screen-label`**: every screen-level section carries a numbered authoring marker (`00 Top
  nav`, `01 Channel header`, `02 Channel tabs`, `03 Video meta`, `04 Comments`, `05 Recent articles
  sidebar`, `08/09/10 Tab — about/stack/contact`, …). **No CSS, renders nothing** — keep it.
- **Theme**: light unless the stored theme preference is `'dark'`; applied as `<html data-theme>`;
  `index.html` carries a pre-paint anti-flash script (same stored key, defaults light).
- **Baseline SEO**: on each navigation **except** an article-detail URL (which sets its own), the
  title becomes `super-dev.app — {first 48 chars of the bio}`, the description is the bio, the type is
  `website`, and any article structured-data is cleared.

### 2.5 Routing & app config (the param-less static-tree shell)

Language is a **URL prefix via one explicit static tree per `Lang`** (`/fr`, `/en`, `/es`, `/de`, …),
**generated from `LANGS`** — **never** a `:lang` param (a parameter-first parent route breaks Angular's
native prerenderer → empty `<router-outlet>`). Adding a language is a one-line change to the `LANG` set.

- **Routes**: one top-level tree per `Lang` (built by `LANGS.map(...)`, literal paths), each reading its
  own leading path segment to sync the language before the routed component renders (the **only** place
  routing changes the language), and sharing the **same lazy children**, built fresh per tree, in order:
  Home `''` (lazy component), `articles` and `series` (lazy sub-trees — each a list + detail), then
  `about`, `stack`, `contact` (lazy components). Root `''` and any unknown path redirect to
  `/${DEFAULT_LANG}` with a **const-template static** string (build-evaluable for the static prerender).
- **Nested feature routes** (articles and series, both lazy): a list at `''` and a detail at
  `':slug'`; the `:slug` segment feeds the detail page as a required string input via
  component-input-binding.
- **App config**: zoneless change detection, the router (with component-input-binding), and client
  hydration with event replay. The server config merges in server rendering with the prerender
  routes.
- **Prerender manifest**: the detail routes (`<lang>/{articles,series}/:slug`, looped over `LANGS`) are
  prerendered with their slugs enumerated from the **FR** content; a final catch-all prerenders the
  explicit static pages (`/fr`, `/en`, `/es/about`, …). `setLang` swaps content synchronously (`peek`)
  so each prerendered route is captured **in its own language**.

---

## 3. Design system — tokens & primitives (the visual source of truth)

### 3.1 Color tokens (`styles/_tokens.scss` `:root` = dark default; `_theme-light.scss` = light)

| Token | Dark (`:root`) | Light (`[data-theme='light']`) |
|---|---|---|
| `--bg` | `#0a0a0b` | `#faf9f6` |
| `--surface` | `#131316` | `#fff` |
| `--surface-2` | `#1a1a1e` | `#f3f1ec` |
| `--surface-3` | `#232328` | `#e7e4dc` |
| `--border` | `#2a2a30` | `#d4d0c7` |
| `--border-soft` | `#1f1f24` | `#e6e3d9` |
| `--text` | `#f1f1ef` | `#1a1a1a` |
| `--text-dim` | `#a4a4a8` | `#555` |
| `--text-faint` | `#85858c` | `#6b6b6b` |
| `--text-mute` | `#45454a` | `#b0aea7` |
| `--accent` | `oklch(66% 0.22 22deg)` | `oklch(56% 0.21 22deg)` |
| `--accent-hot` | `oklch(74% 0.24 28deg)` | `oklch(62% 0.23 28deg)` |
| `--accent-deep` | `oklch(42% 0.18 22deg)` | `oklch(38% 0.18 22deg)` |
| `--accent-glow` | `oklch(66% 0.22 22deg / 18%)` | `oklch(56% 0.21 22deg / 12%)` |
| `--ok` | `oklch(78% 0.16 145deg)` | (inherited) |
| `--warn` | `oklch(82% 0.16 80deg)` | (inherited) |
| `--info` | `oklch(72% 0.13 230deg)` | (inherited) |
| `--sh-1` | `0 1px 2px rgb(0 0 0 / 40%)` | `0 1px 2px rgb(20 18 12 / 6%)` |
| `--sh-2` | `0 6px 24px rgb(0 0 0 / 50%)` | `0 8px 28px rgb(20 18 12 / 8%)` |

### 3.2 Non-color tokens (theme-invariant)

- **Fonts**: `--f-sans: 'IBM Plex Sans', system-ui, sans-serif` · `--f-mono: 'JetBrains Mono', 'IBM
  Plex Mono', ui-monospace, monospace` (Google Fonts, weights 400/500/600/700, `display=swap`).
- **Layout**: `--page-w: 1440px` · `--pad: 16px` **mobile-first base** → restored to **`32px` from
  `md`** (900px up).
- **Breakpoints** (mobile-first tiers; **Sass map**, not CSS tokens — the mechanism and the
  `var()`-in-`@media` rationale are in `design.md §11`): `sm 600px` (large phones) · `md 900px` (tablet —
  stacked sidebars and 2-col grids return) · `lg 1100px` (desktop — the main content + 380px-sidebar grid
  returns).
- **Radii**: `--r-sm: 6px` · `--r-md: 10px` · `--r-lg: 14px` · `--r-xl: 18px`.

### 3.3 Base / global primitives

- **Body**: `margin:0`, `font-family:--f-sans`, **`font-size:13px` mobile-first base → `14px` from
  `md`**, `line-height:1.5`, `-webkit-font-smoothing:antialiased`,
  `text-rendering:optimizeLegibility`. `* { box-sizing:border-box }`.
- **Scanline overlay** (`body::before`): fixed full-viewport, `pointer-events:none`,
  `repeating-linear-gradient(0deg, rgb(255 255 255 / 1.2%) 0 1px, transparent 1px 3px)`,
  `z-index:999`, `opacity:0.6`. Light flips it to **black** lines at `opacity:0.5`.
- **`::selection`** = `--accent-glow` on `--text`.
- **Explicit `display`** on every `sd-*`: most `block`; **`display:contents`** on `sd-home`,
  `sd-up-next`, and all five `sd-scene-*` (so they don't break the parent grid).
- **`.main` grid** (`_layout.scss`): `max-width:--page-w`, `margin:0 auto`, **`gap:28px`**; the
  `<router-outlet>` itself is `display:none`. Padding is `24px --pad` on the sides; the **bottom**
  padding is mobile-first `calc(72px + env(safe-area-inset-bottom))` to clear the fixed bottom nav bar
  (§2.3), reset to **`80px`** at `md`. **Mobile-first**: the base is a
  **single column** (`grid-template-columns: minmax(0, 1fr)` — NEVER bare `1fr`: a `1fr` track can't
  shrink below its content's min-content, so one long unbreakable code line would widen the page past
  the phone viewport); the content + **380px** sidebar 2-col grid (`minmax(0,1fr) 380px`) returns only
  at **`lg`** (1100px up), so on the phone the sidebar stacks under the content. A **`.tab-pane`**
  child (`grid-column:1/-1`) collapses `.main` to a single `minmax(0, 1fr)` column at every width
  (`:has(.tab-pane)`) — that host class is on every simple/list/detail tab page.
- **`.cursor`** (typewriter caret): `8px` wide, `currentcolor`, `height:1em`, `vertical-align:-3px`,
  `animation: blink 1s steps(1) infinite`. `@keyframes blink { 50% { opacity:0 } }`.
- **`.loadbar`**: fixed top, `height:2px`, `z-index:100`, accent sweep gradient
  (`background-size:40% 100%`), `@keyframes loadbar` translating `-40%→140%` over `0.9s`.
- **Favicon**: rounded dark square + warm-red play triangle.

### 3.4 Buttons (`.btn`, `_buttons.scss`)

Pill: `--bg:--surface-2; --bd:--border; --fg:--text`, `display:inline-flex`, `gap:8px`,
`padding:0 16px`, **`height:38px`**, `border-radius:999px`, `font-weight:500`, **`font-size:13px`**,
`transition:all 0.15s`; hover `filter:brightness(1.15)`. Modifiers: `--primary` (`--bg:--text;
--fg:#0a0a0b; weight 600`; light flip → `--bg:#1a1a1a; --fg:#fff`, hover `#000`); `--accent`
(`--bg/--bd:--accent; --fg:#0a0a0b`; light → `color:#fff`); `--ghost` (`--bg:transparent`); `--sm`
(`height:32px; font-size:12px; padding:0 12px`).

### 3.5 Tabs / tabview chrome (shared `_tabs.scss` + `_tabview.scss`)

- `.tabs`: `padding:4px --pad 0`, flex `gap:4px`, bottom `1px --border-soft`, `overflow-x:auto`.
- `.tab`: `padding:12px 16px`, mono 12px, uppercase, `letter-spacing:0.06em`, `--text-faint`, 2px
  transparent bottom border, `margin-bottom:-1px`; hover `--text-dim`; selected `--text` +
  accent bottom border.
- `.tabview` (every simple/list page header): `padding:8px 4px 40px`; `&__head` flex space-between,
  `gap:24px`, `margin-bottom:24px`, `padding-bottom:18px`, bottom border `--border-soft`;
  `&__title` mono **22px** weight 600 (a `<span>` inside = accent); `&__sub` mono 12.5px `--text-dim`;
  `&__count-v` mono **32px** weight 700 accent; `&__count-lbl` 11px uppercase faint.

### 3.6 Shared window dots (`_dots.scss`)

macOS traffic lights, shared verbatim by the code-block head and the contact form:
`10px` circles — `--red #ff5f57` · `--yellow #febc2e` · `--green #28c840`.

---

## 4. Home — the watch page + the player (centerpiece)

**Layout**: the home page stacks `<sd-player>` + `<sd-video-meta>` + `<sd-comments>` as the main
column and a sibling `<sd-up-next>` aside — both `display:contents`, so the `.main` 2-col grid
(`1fr / 380px`) owns the placement. The home page itself has no logic beyond composing those four.

**On phones** (below `md`) the home reads like the **YouTube-app watch page**: the shell
channel-header is hidden on this route (§2.2), so the column is `nav → tabs → full-bleed 16/9 player
→ video-meta (one info block, incl. the mobile-only bio) → comments (collapsed) → up-next` — the
single-column `.main` stacking from §3.3, with the watch-page specifics below.

### 4.1 The simulated player

- **The player clock**: a single source of truth for the playhead time (starting at 0) and a
  playing/paused state (autoplay on). The chapter list and total duration come from content; the
  current chapter is the last chapter whose start time is at or before the playhead, and the
  per-chapter elapsed time is the playhead minus that chapter's start. While playing, the playhead
  advances in **0.1s steps every 100ms**, wrapping back to 0 at the total duration. It can be
  toggled, played, paused, sought (clamped to the valid range), or advanced to the next chapter
  (wrapping past the last).
- **Chapters / timeline** (from content, **total duration = 158s**; the dense scenes' windows are
  sized to absorb the per-card `SCENE_CARD_DWELL`):

  | id | seconds | timestamp | scene |
  |---|---|---|---|
  | `intro` | 0 | `00:00` | `sd-scene-intro` |
  | `stack` | 15 | `00:15` | `sd-scene-stack` |
  | `projects` | 48 | `00:48` | `sd-scene-projects` |
  | `timeline` | 93 | `01:33` | `sd-scene-timeline` |
  | `outro` | 128 | `02:08` | `sd-scene-outro` |

  The set of valid scene ids is exactly those 5; each matches its `sd-scene-{id}` element.
- **Scene switching**: all 5 scenes are mounted simultaneously, absolutely stacked, and crossfaded —
  `.scene` (`position:absolute; inset:0; place-items:center; padding:24px 32px 70px; opacity:0;
  pointer-events:none; transition:opacity 0.35s`) → `.scene--on` (`opacity:1`). Each scene is told
  whether it is active (its id is the current chapter) and how far into the chapter it is — **inactive
  scenes get an elapsed of 0**, so their typewriter/reveal effects reset and replay each loop.
- **Mobile scale-to-fit** (`.scene--fit`, on **all five** scene roots): on phones the scenes are a
  "downscaled video" — each keeps its fixed desktop layout at a `760px`-wide, `16/9` reference box
  and is shrunk to the real player width with `transform: scale(tan(atan2(var(--scene-fit), 1px)))`
  (`transform-origin: top left`, `bottom: auto`). The `tan(atan2(a, b)) = a/b` trick divides the
  container width by `760` to get the scale: `@property --scene-fit` (a registered `<length>`) carries
  `calc(100cqw / 760)` — `100cqw` reads the player's width via its `container-type: size`, and the
  registration forces it to a concrete length **before** `atan2` runs, which sidesteps a WebKit/iOS
  Safari bug that miscomputes a container-query unit fed straight into `atan2` (it blanked the player on
  iPhone). At `md` every one of those properties is reset (`inset:0; width:auto;
  aspect-ratio:auto; transform:none; transform-origin:initial`), collapsing `.scene--fit` back to a
  plain `.scene` — desktop identical.
- **Mobile "montage" for the dense scenes** (`projects`, `stack`, `timeline`): within that same
  downscaled `16/9` box, packing every card/row at once stayed illegible on a phone — so on mobile
  these three scenes show **one item at a time, blown up to fill the frame**, advancing card-by-card
  like a video montage (the player aspect is unchanged). Each scene derives the focused item from the
  playhead — `focusIndex = focusedIndex(elapsed, [each item's start offset])` (a pure `core/lib`
  helper, so it stays scrub-deterministic) — and renders `[class.is-focus]` on the active card/row;
  the scene SCSS is **mobile-first** (base = only `.is-focus` shown at ~2× type; the full compact
  grid/list returns at `bp.from(md)`). `intro` and `outro` are lighter and keep plain scale-to-fit.
  Each card/row is also pushed past the previous by `SCENE_CARD_DWELL` (its start += `cardIndex ×
  dwell`), so a finished item lingers before the montage advances — it never flicks to the next too
  fast (and the desktop reveal paces likewise); the chapter windows above are sized to absorb it.
  And **within** a card, each sub-element carries `[class.is-pending]` until its own typing starts
  (`elapsed < at`) — on mobile it's `display:none`, so the card **grows item-by-item** (the frame
  appears little by little) instead of standing as a half-empty box; restored at `bp.from(md)`,
  where the full reserved layout shows at once. (The typewriter reserves each line's final height to
  avoid reflow, which is why the collapse is needed to make the frame track the typed content.)
- **Animation behavior** (shared, deterministic from the elapsed time):
  - **Reveal**: an element fades in (opacity only — no vertical motion, since the text itself now
    types in character-by-character) over a fixed fraction of the elapsed time past a per-element
    start offset, with a short ease. Used to stagger each scene's pieces into view.
  - **Typewriter**: text types in left-to-right at a fixed characters-per-second rate, empty before
    its start offset. Each scene's headline types shortly after the scene becomes active (at 0.2 s,
    30 cps). The scene **body** types **strictly sequentially — one element at a time, a single caret
    walking the scene** (the `sd-typed` component, `SCENE_BODY_CPS` = 30 cps): start times are
    computed by the `typingSchedule` chain (`core/lib`) — each text starts when the previous finishes
    at 30 cps, plus a 0.15 s breath; the chain begins when the headline finishes
    (`0.2 s + headline length / 30 cps + 0.4 s`). The untyped remainder is held
    invisible-but-space-holding so the layout never reflows. Structural containers
    (cards/rows/pills) and the decoration-prefixed lines (`→` subtitles, `•`/`›`/`▸` items) fade in
    via `reveal()` exactly as their first text starts typing — 0.3 s; the intro tagline and the outro
    subtitle/cta/sign type only (no fade). The whole animation is a pure function of the playhead, so
    **seeking the timeline lands mid-frappe** — finished texts full, the in-flight one partial with
    its caret, later ones empty (and it un-types backward).
  - **Time display**: the playhead and total are shown as zero-padded `MM:SS`.

#### Per-scene scripts (typing order and schedule rule — load-bearing for the look)

All five scenes share the **same skeleton** — a `sd-scene-{id}` element, told whether it is active and
how far into its chapter, reading its own slice of content, with a typed headline. Each renders a
single `.scene` block that gains `.scene--on` when active, with the typed headline followed by a
blinking `cursor` span. Body text types strictly sequentially via `sd-typed` (30 cps); starts are
computed by the `typingSchedule` chain, beginning when the red headline finishes
(`0.2 s + headline length / 30 cps + 0.4 s`). Structural containers (cards/rows/pills) and the
decoration-prefixed `→`/`•`/`›`/`▸` lines fade via `reveal()` exactly when their first text starts
typing (0.3 s); the intro tagline and the outro subtitle/cta/sign are reveal-free (type only). The
typing order (body chain in visual order, headlines at 0.2 / 30 cps):

- **intro** (`scene-intro`, max-width 720px): `hi` headline (accent mono 14px) → **name** (`h2`
  `.scene-intro__name`, **64px** weight 700, `letter-spacing:-0.04em`, `#fff→#888` clipped gradient;
  h2 fades when name starts) → **role** (`<span>` accent) → **tagline** (type only, no fade) →
  **tags** in order (each `.tag` bordered pill, fades when text starts) → per metric: **value**,
  **label** (each `.metric` fades when value starts).
- **stack** (`scene-stack-rich`, 720px): `title` headline → **subtitle** (`→` prefix, fades when
  text starts) → per card: **title** (card fades when title starts; accent border `accent + '40'`,
  accent-colored header) → **main label** → **items** (each `li` `•` accent, fades when text starts).
- **projects** (`scene-projects-rich`, 760px): `heading` headline → **subtitle** (fades when text
  starts) → per project: **number** (project card fades when number starts), **tag**, **name**,
  **metric**, **role**, **description**, **chips** (each pill fades as its text starts).
- **timeline** (`scene-timeline-rich`, 720px): `title` headline → **subtitle** (`→` prefix, fades
  when text starts) → a rail (`.tl-rich__rail`) + per row: **year** (row fades when year starts),
  **role**, **company**, **bullets** (each `li` `›`, fades when text starts).
- **outro** (`scene-outro-rich`, centered): `#` headline → **subtitle** (`.scene-outro-rich__sub`,
  **26px** weight 600, type only) → **CTA** (type only) → **links** (`.scene-outro__link`, bordered
  pill, `▸` accent; each fades when text starts) → **sign-off** (type only).

Shared rich-scene chrome (`_scene-rich.scss`): `__cmd` (mono 13px accent) + `__sub span` (`--text-
mute`). `_scenes.scss` holds the cross-component scene element styles.

#### Player chrome & timeline (`.player`, `player.component.scss`)

The player (`sd-player`) tracks a chrome auto-hide (idle) state and a progress-bar scrub-preview
position; from the scrub position it derives the hovered chapter and the hover percent, and it
displays the play progress as a percentage. Clicking the stage toggles play **except** when the click
lands inside the controls row, the live badge, or the quality badge; mouse movement wakes the chrome
(resetting a 4500ms idle timer); the progress bar maps clicks to a seek (the click fraction of the
total duration) and hover to the scrub-preview position. Global keydown shortcuts (`[k]` play/pause,
`[j]`/`[l]` seek ∓10 s) drive it, ignored while a field is focused.

- **Stage** (`.player`): `aspect-ratio:16/9`, `background:#000`, 1px `--border-soft`, `--sh-2`.
  **Mobile-first base = full-bleed** (the YouTube-app watch look): `margin-inline:
  calc(-1 * var(--pad))` cancels the `.main` side padding, `border-radius:0`, and
  `container-type:size` makes the player the query container `.scene--fit` scales against; at `md`
  the rounded card returns (`margin-inline:0`, `--r-lg`, `container-type:normal`). **Stays dark in
  light theme** (`:host-context([data-theme='light']) .player` re-declares the full dark palette).
  `__bg` = radial ellipse over `#060607`; `__bg-grid` = 1px lines at **40px**.
- **Live/quality badges**: top-left `.player__live` (`14px` inset, mono 10.5px uppercase,
  `rgb(0 0 0 / 50%)`, blur 8px, a pulsing 7px accent `__live-dot` with glow) shows `LIVE`/`PAUSED`;
  top-right `.player__quality` static `4K · HDR`. Both are **hidden on the full-bleed phone player**
  (they would overlap the scaled-down scene header) and restored at `bp.from(md)` — note this is `md`,
  not the `sm` of the control-row trim below.
- **Center play** (`.player__center-play`): 72px circle, visible when `.is-paused` **and not**
  `.is-resting` (opacity 0→1); hover `scale(1.05)`. Clicking it resumes playback. It fades once the
  viewer goes idle (even while paused) so it never permanently occludes the scene's centered content
  (e.g. the outro CTAs); a mouse move brings it back.
- **Chrome auto-hide**: waking on `mousemove` resets a **4500ms** idle timer. The idle flag drives two
  classes: `.is-idle` (idle **and** playing) fades `__chrome` `opacity:0` (`transition 0.25s`), and
  `.is-resting` (idle, any play state) fades the center-play. `__chrome-bg` = 120px bottom gradient.
- **Progress** (`.player__progress`, 14px tall hit area): `__progress-track` 4px (→6px on hover)
  `rgb(255 255 255 / 18%)`; `__progress-fill` accent, width = the play-progress percent; `__progress-
  thumb` 12px accent (scales 0→1 on hover) positioned at the play-progress percent; **hover-scrub**
  `__progress-hover` width = the scrub-preview percent; **chapter ticks** for every chapter after the
  first, at `(seconds / total duration)·100%` (2px×8px); **tooltip** `__chapter-tooltip` (hovered
  chapter title + `<small>` timestamp) at the scrub-preview percent. Click → seek to the click
  fraction of the total duration.
- **Controls row** (`.player__row`, gap 8px → **12px at `sm`**, `color:#fff`): play/pause (22px) ·
  next-chapter (20px, wraps) · `mm:ss / mm:ss` time + `· <b>{current chapter title}</b>` (accent-hot,
  `__chapter-now`) · spacer · two `__btn--aux`: **⚙️ settings** — opens a **playback-speed menu**
  (`.player__settings`, popover above the row: `0.5× / 1× / 1.5× / 2×`, active one accent-hot) that drives
  `PlayerService.rate`, which scales the tick increment (`0.1 × rate`); closes on select, on Escape, or
  on a stage click — and **⛶ pip** (`aria.pip`), which **detaches the player into the floating
  mini-player** (`player.toggleMini()`) · the **🎮 gamepad** button (`aria.gameStart`, a plain
  `player__btn`, **not** an `--aux` control, so it survives the phone trim — the game must be reachable on
  mobile) which **enters game mode** (`enterGame()` → `GameService`) · the **working
  fullscreen toggle** (icon `full` ↔ `full-exit`, label `aria.fullscreen` ↔ `aria.exitFullscreen`;
  native `requestFullscreen`, **falling back to the CSS fullscreen** if the browser rejects/lacks it —
  so the button always responds). **Phone trim** (all restored at `sm`): the chapter-now label and the
  two aux buttons (`__btn--aux`: settings, pip) are hidden so play/next/time/**gamepad**/fullscreen fit
  unclipped. All icon-button accessibility labels come from content.
  (The former inert **captions** button was removed — language is changed via the prefs picker: the nav
  on desktop, the floating `.prefs-dock` on mobile, §2.1.1.)
- **Fullscreen** (the `full` button): native Fullscreen API where available; iOS Safari (no
  `requestFullscreen` on a `<div>`) gets a fixed-overlay CSS fallback. One state class
  (`.player.is-fullscreen`, a signal synced from `fullscreenchange`) drives everything: black
  full-viewport room, stage letterboxed to a centered 16/9 size-container
  (`min(100cqw, 100cqh·16/9)`), scenes upscaled by the same `.scene--fit` math at every width,
  body scroll locked behind (`body:has(…)`, `_layout.scss`). Esc exits (native, or the scoped
  fallback handler). **Landscape**: entering *native* fullscreen best-effort-locks landscape
  (`screen.orientation.lock`, Android — rejected and ignored elsewhere), unlocked on exit; iOS
  Safari has no orientation lock, so the *fallback* path forces it visually — in portrait,
  `.player.is-fullscreen:not(:fullscreen)` rotates the player 90° (`transform: rotate`, sized
  `100dvh × 100dvw`) so the 16/9 fills the screen sideways like the YouTube app (the box is
  measured pre-transform, so the letterbox/scale still hold); turning the device drops the
  rotation and the overlay fills the now-landscape viewport.
- **Mini-player / PiP** (the `pip` button → `PlayerService.mini`): the player **detaches into a floating
  bottom-right frame** (`sd-mini-player`, rendered at the app shell so it persists across navigation,
  `z-index 100`, `min(480px, 92vw)` 16/9, a **seekable progress bar** (`.mini-player__progress`, click →
  `seek`) pinned to the frame bottom, and a play/pause + restore control bar). The frame is a
  **size-query container**, so the `.scene--fit` math is re-asserted to **downscale** the fixed-width
  scenes into it (the same mechanism fullscreen uses to *upscale* — see §4.1). The animated **scene
  layer is an extracted `sd-player-stage`** (bg + the five scenes, driven by `PlayerService`) reused by
  both the inline player and the mini — so there is no duplicated scene wiring. While the mini is active the
  inline player shows a **`.player__popped` placeholder** (click → `closeMini`, label `playerRestore`).
  Conditional (`@if player.mini()`, default off) → zero prerender/baseline impact.
- **Game mode — OPEN SPACE.EXE** (the hidden game behind the player's `gamepad` button →
  `enterGame()` → `GameService.enter()`): a hidden **DOOM-style corporate-satire FPS**, tone **straight
  horror** — the humour lives only in the office↔hell juxtaposition (a possessed printer, a demonic
  manager), never in jokey UI. Premise: a burnt-out developer, force-recalled by a **Return-To-Office
  mandate**, finds MegaCorp's tower — the **Universal Algorithmic Corporation (UAC)**, a DOOM homage —
  fallen to a rogue corporate AI, **the Overseer** (a.k.a. *The Algorithm*), which has turned the
  open-space into hell and enslaved colleagues as demons; the player descends floor by floor to the
  datacenter to destroy it. In the player, the frame **swaps the scene layer** (`sd-player-stage`) for the
  game component **`sd-bsp-demo`**, mounted `@if (game.running())`; the same component is also served
  standalone at **`/bsp`** (a dev harness with an FPS/thread readout). Entering **pauses** playback;
  **Esc** or the in-canvas **exit button** returns to the video, resuming if it was playing —
  `GameService` is now a thin toggle (`enter` / `exit` / `running`, pausing then resuming `PlayerService`),
  and the game component owns its own level lifecycle. **Browser-only**: `mode` stays `'video'` on the
  server, so the game canvas never prerenders — the static HTML keeps the video poster (no-JS + SEO
  intact) and the live canvas is masked in the visual baselines.

  The engine is a **from-scratch DOOM-style BSP software renderer** — not the old uniform-grid raycaster.
  A level is authored as **vertices / linedefs / sidedefs / sectors / things** (a `MapSource`) and
  compiled by a **node builder** into a **BSP tree of convex subsectors**; the renderer walks the tree
  **front-to-back** and, per screen column, paints the near sector's **textured ceiling**, the **wall** (a
  one-sided solid, or a two-sided portal's upper/lower bands), and the **textured floor** — each
  distance-shaded through a per-column occlusion window — then draws **billboard sprites** (enemies,
  pickups, projectiles) depth-tested per pixel against the wall z-buffer. Because every **sector carries
  its own floor and ceiling height**, the world has real **steps, raised daises, sunken pits and
  variable-height rooms**, and walls sit at **any free angle** (no grid); the camera also supports
  **pitch** (look up/down via a horizon shear). **Physics** slides the player along solid walls and
  **steps up** through a climbable portal; a too-tall-but-still-climbable ledge **auto-mantles** — the
  two-handed pull `ClimbView` overlay plays over the vault.

  Rendering is a **multi-threaded software rasteriser**: a **`SharedArrayBuffer` worker pool** splits the
  frame into N horizontal bands, each worker painting straight into one shared framebuffer + z-buffer,
  composited once all report done. It needs **cross-origin isolation** (COOP/COEP) + `SharedArrayBuffer`;
  when those are unavailable (or during SSR) it **falls back to single-threaded** main-thread rendering, so
  `/bsp` always works. The framebuffer renders **below display resolution** and is upscaled **pixelated**
  for the authentic software look; on `/bsp` a readout shows **FPS · frame ms · thread count · texture
  source** (WebP vs procedural). Textures have a **procedural fallback** baked in code (brick / metal /
  floor / ceiling / …) so the world renders with no assets, and the real **WebP art is decoded and swapped
  in over that base** at runtime; assets **preload** up front so nothing pops in mid-play.

  Systems already built: a **per-zone texture palette** (walls BRICK / METAL / RACKS / CUBICLE / SCREEN /
  PILLAR / DAMAGED / GLASS; floors FLOOR / CARPET / TILE / MARBLE / GRATING / SLAB; ceilings CEIL /
  CONCRETE / TECHNICAL / NEON; doors DOOR_RED / DOOR_BLUE / DOOR_YELLOW), so each floor reads as its own
  office district; a **3-tier keycard/badge** access system (employee = blue, manager = yellow, director =
  red) gating colour-matched doors, with a **HUD card bay**; rotating **turntable pickups** — health
  (medkit / plant) and mental (figurine / card) **vitals** plus **ammo boxes** (each box's cap read from
  `weapons.json`); a **data-driven arsenal** of eight DOOM-archetype weapons (fist / pistol / shotgun /
  chaingun / plasma / rocket / bfg / chainsaw) with per-weapon **magazine + reload** (`stepArsenal`), a
  shared FPS **`WeaponView`** sprite/animation, **weapon switching** (1–8 / mouse wheel) and **reload** (R
  / right-click); an **office bestiary** of enemies; and **animated doors** (keycard doors open in place;
  the zone-exit airlock fades to black then advances the level). The status bar is the composited DOOM-1993
  image HUD (**`DoomHud`**): the **health / mental** red-digit screens, the **burnt-out-developer reactive
  face** (its gaze tracks your turn, grimacing when you take damage), the **ARMS** weapon grid, the weapon
  bay, and the **keycard** slots.

  Controls: desktop uses **WASD/ZQSD + arrows** to move/strafe with **pointer-lock mouse-look**, **click**
  to fire, **1–8 / wheel** to switch weapons, **R / right-click** to reload, and **E** to use/activate; the
  game's movement + wheel are `preventDefault`ed so they never scroll the page, and inside the player an
  in-canvas **controls recap** (from the `gameControls` string, split on ` · `) is shown. On a
  coarse-pointer device the game becomes a **fixed full-viewport overlay** (`.player:has(sd-bsp-demo)`)
  that **forces landscape** — CSS-rotated 90° in portrait, since an FPS needs width — with the page behind
  **scroll-locked** and the bottom bars (tabs + prefs-dock) hidden (`body:has(.player sd-bsp-demo)`).

  **Built vs planned.** Built today: the BSP engine + the systems above + a few **worked-example levels**
  — `level-accueil` (a hand-authored reception→climax techbase), the wired **`level-hangar`** (a large
  original techbase showcasing a spiral staircase + verticality) and the engine-showcase `demo-map`.
  Planned: the full **9-level episode** — M1 Lobby → M2 Open-space → M3 RH (with a secret exit to M9) → M4
  Meeting rooms (**mid-boss: the Middle-Manager**) → M5 Cafétéria → M6 Direction/C-suite → M7 Server room →
  M8 Datacenter (**final boss: the Overseer's spider**, a Spider-Mastermind homage) → M9 Archives (secret)
  — plus the **two bosses**, **audio** (music + SFX), and the **menu / intertitle screens**. The full
  per-level canon lives in the `level-designer` agent.

### 4.2 Video-meta · like-bar · comments · up-next

- **video-meta** (`sd-video-meta`): the featured title as an `h2`; author row (`S` avatar
  `.video-meta__author-av` 40px radial-gradient, `super-dev` + `✓`, `{subscribers count} {subscribers}`)
  + actions (`<sd-like-bar>`, **Share**, **Download-CV** — the two buttons are `btn btn--sm`). **Mobile-only bio** (`.video-meta__bio`, between the
  author row and the description card: `margin:8px 0 0`, `--text-dim`, 13px / 1.55, hidden at `md`)
  — the same `content.bio` the channel-header shows; on the phone watch page (§2.2 hides the
  channel-header on home) this makes `video-meta` the **single** channel-info block.
  **Description card**: a mono meta strip pairing each
  description-meta label with its value + a `tags:` row (the featured tags joined as `#tag …`) + the
  description body + the **chapters list** — each `.chap` row seeks to its chapter's start time and
  gets `.is-active` (accent) while it is the current chapter.
- **like-bar** (`sd-like-bar`, `.likebar`): pill `height:36px`, `--surface-2`, two buttons split by a
  1px `__divider`; a local vote state (`up`/`down`/none, re-click clears, active → accent). The up
  button shows a base count of **248** plus 1 when upvoted; the down button is count-less. Icons 16px.
- **comments** (`sd-comments`/`sd-comment`): a header **toggle button** (`.comments__head` — comments
  count + sort label + a `chevron-up`/`chevron-down` 16px icon, `aria-expanded`, full-width reset
  button) + a **post-a-review** input row (a `<form>`: `S` avatar + bound input; a `commentSend`
  button — "Publier"/"Post" — surfaces only once the field holds text, and Enter submits too) + a list
  of `<sd-comment>`; the input + list render only while expanded. A submitted review is **prepended**
  to the seeded testimonials as a `Comment` (`who`=`commentYou`, `__name-tag`=`commentYouTag`, brand-red
  avatar, `when`=`commentJustNow`, 0 likes) and **persisted to localStorage** by `ReviewsService`
  (newest-first — the client-only seam the real .NET API replaces next phase). The empty/default row keeps
  the original 2-column grid (a `--posting` modifier adds the send-button track only while typing), so the
  desktop home baseline is byte-identical. **Collapsed by default on phones** (the initial
  state is `!ViewportService.isCompact()` — expanded on desktop, where the section reads exactly as
  before; the chevron is hidden at `md`). Seed = **4 comments, 1 pinned**.
  Each `.comment` (grid `40px 1fr`, gap 14px): colored 40px avatar (the author's first letter on the
  comment's color), `@{handle}` (author name lowercased, spaces stripped) + uppercase `__name-tag`
  pill, an optional `📌 {pinned label}`, a `__when` mono 11px timestamp, body 13.5px, and a single
  **like toggle** showing the base likes plus the user's vote (mono 11px).
- **up-next** aside (`sd-up-next`): header (up-next title · `<b>{read-next}</b>`) + the **first 5**
  articles as `.vid-card` rows
  (grid `168px 1fr`, gap 12px) linking to each article's detail. Thumb 16:9: background
  `radial-gradient(circle at 30% 30%, {accent}40, transparent 60%), #0a0a0c` + `__thumb-grid` (16px
  dotted overlay, shared `_cards.scss`) + 32px symbol + tag + a `__thumb-dur` read-time badge; then a
  tag pill, a 2-line title, `{author} ✓`, and `{reads} • {ago}`.

---

## 5. Articles

A lazy list at `''` and a detail at `':slug'`, where **`:slug` = the article's slug** (kebab-case,
ASCII, identical across locales, = the Markdown filename stem), bound as a required string input; the detail
page resolves the matching article (falling back to the first).

**20 articles, 9 filter pills** (3 semantic + 6 tag); source order = `date` descending (newest first).

- **Filtering**: pill 0 = ALL (source order), pill 1 = RECENT (first 6), pill 2 = POPULAR (descending
  by parsed read count), pills ≥3 = TAG, matched by **pill position** (locale-independent) against the
  tag list at `index − 3`.
- **Tag set** (a fixed, closed list): `['.NET', 'ANGULAR', 'AZURE', 'FLUTTER', 'DEVOPS', 'TUTO']`.
  Distribution `.NET`×5, `ANGULAR`×4, `AZURE`×3, `FLUTTER`×3, `DEVOPS`×3, `TUTO`×2. Localized pill
  labels (FR `Tout/Récent/Populaire/.NET/Angular/Azure/Flutter/DevOps/Tuto`) match by **position**,
  not text.
- **Read-count parsing**: a string like `'2,4k lectures'` / `'1.2M reads'` reads as a number — comma
  becomes a dot, the leading number is parsed, then multiplied by a million if it carries `M`, by a
  thousand if it carries `k` (so `2,4k` = 2400 outranks `892`).
- **Per-tag accent color** (one tag per article): `.NET #b4451c` · `ANGULAR #a2261c` · `AZURE
  #1c5fb4` · `FLUTTER #1c8fb4` · `DEVOPS #1c7e4a` · `TUTO #a26b1c`. Each article also has a mono
  **glyph symbol**, a read time, a reads count, a fuzzy "ago", plus routing/SEO fields (slug, ISO
  date, description) and an optional series slug + 1-based series order. Author identity is the fixed
  `super-dev ✓` / `S` avatar everywhere.

### 5.1 Article slug → tag → symbol table (source order, newest-first)

| # | slug | tag | symbol | series · order |
|---|---|---|---|---|
| 0 | `etrangler-le-monolithe-dotnet` | .NET | `{ }` | dotnet-moderne · 1 |
| 1 | `angular-zoneless-signals` | ANGULAR | `◆` | angular-21-en-pratique · 1 |
| 2 | `angular-ssg-azure-static-web-apps` | AZURE | `↻` | azure-devops-de-zero · 1 |
| 3 | `angular-resource-httpresource` | ANGULAR | `⟐` | angular-21-en-pratique · 2 |
| 4 | `pipeline-cicd-github-actions-azure` | DEVOPS | `>_` | azure-devops-de-zero · 2 |
| 5 | `azure-container-apps-dotnet` | AZURE | `⬢` | azure-devops-de-zero · 3 |
| 6 | `flutter-firebase-offline-first` | FLUTTER | `■` | flutter-en-production · 1 |
| 7 | `docker-multistage-dotnet-angular` | DEVOPS | `⬚` | azure-devops-de-zero · 5 |
| 8 | `angular-defer-control-flow` | ANGULAR | `⧉` | angular-21-en-pratique · 3 |
| 9 | `tester-angular-zoneless-vitest` | TUTO | `▲` | — |
| 10 | `flutter-riverpod-architecture` | FLUTTER | `≋` | flutter-en-production · 2 |
| 11 | `minimal-api-ef-core-dotnet8` | .NET | `ƒ()` | dotnet-moderne · 2 |
| 12 | `angular-signalstore-ngrx` | ANGULAR | `◈` | angular-21-en-pratique · 4 |
| 13 | `cqrs-vertical-slices-dotnet` | .NET | `⊕` | dotnet-moderne · 3 |
| 14 | `opentelemetry-observabilite-dotnet` | DEVOPS | `◎` | azure-devops-de-zero · 6 |
| 15 | `azure-key-vault-managed-identity` | AZURE | `⚿` | azure-devops-de-zero · 4 |
| 16 | `dotnet-grpc-microservices` | .NET | `⇄` | dotnet-moderne · 4 |
| 17 | `tuto-git-rebase-interactif` | TUTO | `⌥` | — |
| 18 | `flutter-melos-monorepo` | FLUTTER | `⬡` | flutter-en-production · 3 |
| 19 | `dotnet-source-generators` | .NET | `λ` | dotnet-moderne · 5 |

(Note the deliberate gap: azure-devops-de-zero series order jumps 4→5→6, no 5-collision.)

### 5.2 List & visual anatomy (`articles.component`)

The list page (`sd-articles`, `tab-pane` host) holds a **language-stable** selected filter index
(default ALL) and shows the articles filtered by it; the filter pills change the selection; each card
links to that article's detail.

Filter pills `.vfilter` (mono 11.5px, pill, `--surface`; `.is-on` = inverted `--text`/`--bg` fill)
wrap with 6px gap, 24px bottom margin. **`.vgrid`** = `repeat(auto-fill, minmax(280px, 1fr))`,
`gap:18px 14px`. Each `.vgrid-card` (a real `<a>` link — the whole card navigates, keyboard-focusable):
16:9 `__thumb` (`--r-md`, radial accent gradient via per-card `--accent` + `color-mix 25%` over
`#0a0a0c`, + 16px dotted `__thumb-grid`, **56px** `__thumb-sym`, tag, `__dur` read-time badge, a 54px
accent `__play` overlay (decorative `aria-hidden` span) scaling in on hover); meta row (tag chip +
decorative `__more`), 2-line `__title` (14px), `__sub` (`{author} ✓`), `__stats` (`{reads} • {ago}`).
When the active filter **and** the channel-search query leave no match, the grid is replaced by a
`.vgrid-empty` line (`articlesUi.noResults`, mono 13px `--text-dim`).

### 5.3 Detail (`article-detail`, `tab-pane`, `max-width:880px`)

The detail page (`sd-article-detail`, `tab-pane` host) resolves the current article from the route
slug, derives its parsed-Markdown body, its position within its series and the series' member list,
up to 3 same-tag suggested articles, and a scroll-progress value. In the browser it listens for scroll
to feed the progress and, on each article change, smooth-scrolls the article just under the sticky nav.
It also drives per-article SEO (title `{title} — super-dev.app`, an article-flavored description, the
`article` type, and `BlogPosting` structured-data with the article's own ISO date); the
structured-data is cleared when the page is left.

- **3px sticky reading-progress bar** `.article-detail__progress` pinned to the viewport top on phones
  (no nav there) and slid to **`top:56px`** under the sticky nav at `bp.from(md)`; accent, width = the
  scroll position over the scrollable height, capped at 100% (browser-only).
- On each article change, the page **smooth-scrolls** `.article-detail` to just under the sticky nav —
  measured from the live `.nav` height, which is `0` on phones (the nav is hidden), so it scrolls flush
  to the top there (browser-only).
- **Topbar** `.article-detail__topbar` (flex **wrap**, gap 8px — the actions wrap under the back
  link on phones — `padding:8px 0 16px`): a Back link (to the articles
  list) + `__actions` (a single **Share** button, label from content).
- **Hero**: `__art` **280px** tall (accent bg + 32px dotted grid + **96px** centered symbol + tag);
  `__hero-inner` `padding:28px 32px` → tag pill (bordered, accent) + `__title` **36px** weight 700
  (`letter-spacing:-0.025em`) + byline (36px `S` avatar, `super-dev ✓` name, mono meta in order **ago •
  readTime read • reads**).
- **Series ribbon** `.series-ribbon` (only when the article is in a series): 40px `__sym` tile +
  `__label` (`Article n of N`) + `__title` link (accent, links to the series detail) + `__sub`; a
  `__nav` row (dashed top) with prev/next article pills (drawn from the series order, hidden at
  boundaries via empty placeholder spans that keep the flex layout).
- **Body** `.article-detail__body` (`max-width:680px`, centered): the article's Markdown rendered
  block by block — headings, paragraphs, and quotes render as inline runs, lists render as accent
  `›`-prefixed items, fenced code renders as a code-block panel. Type ladder: `h2` mono 14px accent
  with `'## '` `::before` + dashed underline; `p` **16px** `line-height:1.72`, first `p` **44px**
  accent mono drop-cap; `ul li` 15px; blockquote `border-left:3px --accent`, italic, 15px. A
  `__signature` line (`• {author} — portfolio{brand TLD}`, mono 12px, dashed top).
- **"More in {tag}"** `__related` (only when there are same-tag suggestions): up to 3 `.rel-card`s
  (grid `64px 1fr`, the 64px `__sym` tile from `_symbol-box.scss`).
- **SEO**: per-article title `{title} — super-dev.app`, an article-flavored description, and a
  `BlogPosting` record whose publish/modified dates come from the article's own ISO date; cleared when
  the page is left. The article description is `{tag} · {title without a leading "$ "} · {readTime}`,
  capped at 160 characters.
- **Bodies are real Markdown**: stored as raw `.md` files (one per slug **per `Lang`**, `<slug>.<lang>.md`),
  imported as text and indexed by slug via the generated `article-bodies.ts`. An in-house Markdown subset is parsed into typed blocks — headings,
  paragraphs, quotes, and list items as inline runs (plain / bold / inline-code / link), and fenced
  code as a language + text. The same index feeds the runtime render and the prerender guard.

---

## 6. Series

A lazy list at `''` and a detail at `':slug'` (resolved by matching the slug). **4 fixed series**,
each with a slug, title, description, three layer colors, and a symbol. **The member count and total
read time are derived, not stored.**

### 6.1 Series table + colors (the 3-layer stacked-card gradient, `colors[0..2]`)

| slug | symbol | colors `[0, 1, 2]` | members (by slug, ordered) | count |
|---|---|---|---|---|
| `dotnet-moderne` | `▣` | `#7e1c1c · #b4451c · #5b2d1c` | etrangler-le-monolithe-dotnet, minimal-api-ef-core-dotnet8, cqrs-vertical-slices-dotnet, dotnet-grpc-microservices, dotnet-source-generators | 5 |
| `angular-21-en-pratique` | `◆` | `#a2261c · #7e1c1c · #5a1f1c` | angular-zoneless-signals, angular-resource-httpresource, angular-defer-control-flow, angular-signalstore-ngrx | 4 |
| `azure-devops-de-zero` | `↻` | `#1c7e4a · #1c5fb4 · #1c4a6f` | angular-ssg-azure-static-web-apps, pipeline-cicd-github-actions-azure, azure-container-apps-dotnet, azure-key-vault-managed-identity, docker-multistage-dotnet-angular, opentelemetry-observabilite-dotnet | 6 |
| `flutter-en-production` | `■` | `#1c5fb4 · #2d4a8c · #1c8fb4` | flutter-firebase-offline-first, flutter-riverpod-architecture, flutter-melos-monorepo | 3 |

`tester-angular-zoneless-vitest` and `tuto-git-rebase-interactif` belong to no series. Members are
**derived** from each article's series slug + series order (grouping articles under their series and
sorting each group by series order); the per-series member count and total read time build on that
grouping. The count is the number of members; the total read time sums each member's leading
read-time minutes → `"MM min"` if under 60, else `"Xh YY"` (zero-padded).

### 6.2 List & detail visual (the 3D stacked-card)

The list page (`sd-series`, `tab-pane` host) shows each series augmented with its derived count and
total read time, links each card to the series detail, and uses the card position to drive the
"updated N days ago" vanity text. The detail page (`sd-series-detail`, `tab-pane` host) resolves the
current series from the route slug, lists its member articles in order, derives the total read time,
and runs the same browser-only auto-scroll-under-nav as the article detail.

The card art is a 3D **stacked-card** motif: three layers (`l3`/`l2`/`l1`) tinted `colors[2]`/`[1]`/`[0]`,
offset down-right, with a centered mono symbol tinted `colors[0]` and a `text-shadow` glow (the top
`l1` layer holds the symbol over a radial gradient; `l3`/`l2` use the raw colors).

- **List** (`series.component`, `.pgrid` = `repeat(auto-fill, minmax(360px, 1fr))`, gap 16px): each
  `.pcard` grid `200px 1fr`; `__thumb` 16:11, stack layers (`l3` inset `-6px -14px 14px 6px`
  opacity .35; `l2` inset `-3px -7px 7px 3px` opacity .55; `l1` inset 0), **38px** `__stack-sym`, a
  `__badge` (count + icon); body = `__title` 15px, mono `__meta`, 3-line clamped `__desc`, a `__cta`
  pill.
- **Detail** (`series-detail`, `max-width:920px`): hero grid `240px 1fr` (16:11 stack with **64px**
  `__sym`, overline, **32px** `__title`, desc, stats `{count} articles · {total read}`); a
  `Commencer` CTA **only if non-empty** (links to the first member); list `__list` of `.series-row`
  (grid `48px 64px 1fr 24px`): **1-based zero-padded** ordinal `__n` (`01`, `02`…) + article symbol
  tile (own accent color, 64px from `_symbol-box.scss`) + tag pill + mono meta (tag · readTime · reads ·
  ago) + hover `→` `__arrow`. Empty series → dashed `__empty`, no CTA. **Mobile-first**: on the phone the
  hero stacks to one column and the per-row symbol tile is hidden; the `240px 1fr` hero and the symbol
  column both return at `md`.

---

## 7. Stack · About · Contact (simple tabs)

All three are simple `tab-pane` tabs (`sd-*`) rendering a `<section class="tabview">`.

- **Stack** (`sd-stack`, `09 Tab — stack`, `$ cat stack.full`): a heading-only `tabview__head` (**no
  `__count` block**), then mastery tiers (seeded EXPERT / CONFIRMÉ / FAMILIER) — each a tier color
  (4px bar / name / years), a subtitle, a tech count + label, and a tech grid
  `repeat(auto-fill, minmax(260px, 1fr))` of cards (name 13.5px, colored years mono, a mono note).
  `.stack-tier__head` grid `4px 1fr auto`.
- **About** (`sd-about`, `08 Tab — about`, `$ cat about.md`): `.about-grid` 2-col `minmax(0,1fr) /
  320px`, gap 32px (**mobile-first: one column on the phone** — the aside stacks under the bio — the
  2-col split returns at `md`). Bio paragraphs (`.about-bio__p` 15px `line-height:1.65`, max-width 65ch, **38px**
  accent mono drop-cap on the first letter) + a `• {author} — portfolio{brand TLD}` signature (dashed
  top). Aside `.about-side` (14px gap): an **INFOS** card (a definition list of details, each row grid
  `110px 1fr`) + a **LIENS** card (links rendered as **inert `#` anchors**, `›` accent prefix; each
  link's icon field is unused).
- **Contact** (`sd-contact`, `10 Tab — contact`, `$ ./contact.sh`): a heading-only `tabview__head`
  (no `__count`), then `.contact-grid` 2-col `minmax(0,1fr) / 300px`, gap 28px (**mobile-first: one column on the phone**,
  so the terminal-window form runs **full-width**; the 2-col split returns at `md`). Left: an
  availability banner (`.contact-avail` grid `1fr auto`, green gradient,
  **pulsing 8px green dot** `pulse 1.6s`, response time) + a **terminal-window MOCK form**
  (`.contact-form`, traffic-light dots, `$`-sigil labels: name / email / subject `<select>` / message
  `<textarea rows=6>`). Submit is **client-side validated first** (`NgForm` (`ngSubmit`): required
  name/message + Angular `email` validator; an invalid submit is blocked and surfaces inline
  `.contact-form__error` `role="alert"` messages with `aria-invalid` on the field). A valid submit is a
  **mock**: idle → sending → (after 1100ms) → sent (button disabled, **one-shot, never resets**), with
  an `aria-live` `.contact-form__status` confirmation; the states show mail-icon + Send / Sending… /
  `✔ {short sent label}`.
  **The form stays dark in light theme on purpose** (its `:host-context` overrides re-apply dark:
  `#131316`/`#0a0a0b`/`#f1f1ef`). Right `.contact-side`: an other-channels head + alt-method rows
  (grid `36px 1fr`) — a glyph per channel kind (`mail '@'` · `linkedin 'in'` · `github 'gh'` · `cal
  '▽'` · fallback `'•'`, with an exhaustiveness check) + label + subtitle + a `// {pgp}` hint. These
  channel links are real (`mailto:` for the email, `https://` for the rest — `linkOf()`); only the
  form **submit** is a mock (see §9).

---

## 8. Shared: code-block, inline-runs, icon

- **`sd-code-block`** (a code string + a language) = a **macOS-window panel**, **hardcoded dark
  chrome in both themes** (`#131316` body, `#1a1a1e` head, `#2a2a30` borders, `#a4a4a8` text): 3
  traffic-light dots + an uppercase language label (`csharp→C#`, `typescript→TypeScript`, `yaml→YAML`,
  `dart→Dart`, `bash→Bash`) + a **copy** button (copies to the clipboard, label flips to `✓ copied`
  for **1400ms**, both labels from content). Body lines (`12.5px`, `line-height:1.6`): each line is
  shown with a right-aligned, 2-space-padded line number (`__no`, `min-width:28px`) and
  syntax-highlighted token spans. Token colors (`_code-block.scss`): `.k` `oklch(78% .16 22deg)`
  (red), `.s` `oklch(82% .13 145deg)` (green), `.c` `#6a6a70` italic, `.n` `oklch(78% .14 250deg)`
  (blue), `.a` `oklch(78% .14 280deg)` (purple).
- **Code highlighting**: a shared, line-based, per-language highlighter (csharp / typescript / yaml /
  dart / bash, each with its own hand-curated keyword set; an unknown language falls back to csharp)
  classifies each fragment as a comment, string, number, keyword, decorator, or plain identifier — the
  classes the token colors above are keyed to.
- **`sd-inline-runs`** (a list of inline runs, `display:contents`): renders each run by kind — plain
  text, bold (→ `<strong>`), inline-code (→ `.inline-runs__code`, `--surface-2` bg, mono 0.9em), or
  link (→ `.inline-runs__link` accent underline; external `http(s)` links get
  `target=_blank rel=noopener noreferrer`).
- **Markdown content model** (the parser's output): an **inline run** is plain text, bold, inline
  code, or a link (with an optional href). A **block** is one of: a paragraph, an `h2` or `h3`
  heading, or a quote (each carrying inline runs); an unordered list (carrying a list of inline-run
  items); or a fenced code block (carrying a language + text).
- **`sd-icon`** = a fixed inline-SVG set of **28** names: play, pause, next, gear, pip,
  full, full-exit, thumbs-up, thumbs-down, share, download, search, bell, mail, more, menu, sun, moon,
  chevron-up, chevron-down, home, articles, series, about, layers, gamepad, volume, volume-off — `viewBox 0 0 24 24`, a size input (default **18**), 2px `currentColor`
  strokes (play/pause/more are `fill`), no fallback for unknown names. The SVG bodies are a
  **PROVIDED design asset** — seeded into the workspace verbatim and never authored (un-inventable
  vector paths, exactly like the token palette); the component only does the name → `<svg>` lookup.

---

## 9. Known quirks & intentional brand art (reproduce deliberately)

- **No convention debt remains.** Article filler was replaced by **real per-article Markdown**; the
  i18n / vanity-number / filter-vocabulary / series-count / og-image loose ends were closed in the
  2026-06-04 sweep. Remaining dynamic style bindings are data-driven, pointer-tracked (the game joystick), or the deliberate reveal fade-in.
- **Intentional, not debt** (fixed brand art / data — reproduce as-is): the channel-header h1 role
  word `full-stack`, the decorative ASCII status box + terminal readout, the `@super-dev` handle
  row, the `contact@super-dev.app` contact address, and the player's `4K · HDR` badge (the player's two
  aux buttons are both wired now — ⚙️ gear → speed menu, ⛶ pip → mini-player).
- **Deliberately dark in light theme**: the player stage, the code-block chrome, and the contact form
  (each re-applies the dark palette via `:host-context([data-theme='light'])`).
- **The contact form's submit is a mock** (one-shot, never wired) — but its channel links are real:
  `mailto:` for the email, `https://` for the alt channels (GitHub / LinkedIn / Calendly).

---

## 10. Pure helpers (capability note)

A set of small, pure, fully-tested helpers backs the screens above; this section is a capability
note, not an interface spec.

- **Player / animation**: the reveal (opacity fade-in), the typewriter (left-to-right text slice at a
  fixed rate), the sequential `typingSchedule`, the mobile-montage `focusedIndex` (active item from the
  playhead), and the `MM:SS` time formatter described in §4.1.
- **Articles**: read-count parsing (k/M → number), the all/recent/popular/tag filter selection, and
  the capped article description, all described in §5.
- **Series ↔ article mapping**: the derived series→members grouping and the per-series total read time
  described in §6.
- **Markdown**: an in-house Markdown subset is parsed into the typed blocks of §8 (blank lines
  skipped; fenced code, then `h3`/`h2`, then quotes, then lists, then paragraphs, in that precedence;
  inline parsing prefers inline-code, then bold, then links).
- **Code highlighting**: the per-language line tokenizer of §8 plus the language display labels.
- **SEO / site**: a fixed site origin/name, the default OG image, the author identity, and per-language
  OG locales (`OG_LOCALE` over all `LANGS`), plus helpers to absolutize a path and to swap a URL's
  leading language segment to any `Lang` (`pathInLang`).
- **Infra constants**: the localStorage keys for language + theme and the `data-theme` attribute name.

---

## 11. Reactive state & content gateway (capability note)

A small set of always-available reactive services backs the UI; this is a capability note, not an
interface spec.

- **Content gateway**: the single API seam, **mocked** today — it exposes a synchronous peek that
  returns the bundled per-locale content (a `Record<Lang, Content>` map) and an async fetch that
  resolves the same after a ~300ms delay. This is the one place to change for a real .NET API. It reads
  its base URL from the build environment.
- **Content store**: a signal store holding the current language + content + a loading flag, seeded
  from the stored language preference (localStorage-only; any persisted `Lang` via `isLang`, else
  `DEFAULT_LANG` (FR) — so prerender and tests default deterministically to FR). `setLang` swaps the
  content **synchronously** via peek (so each route prerenders in its own language), then revalidates
  asynchronously (**stale-while-revalidate**, last-write-wins so a stale fetch can't clobber a newer
  language). The language is persisted and mirrored onto `<html lang>`.
- **i18n facade**: a thin facade re-exposing the store's language / content / loading and forwarding
  language changes; consumers never touch the store directly.
- **Theme**: a theme state seeded from the stored preference (DARK only if explicitly stored, else
  **default LIGHT**), written onto `<html data-theme>` and persisted, with a toggle and a setter.
- **Player clock**: the simulated playhead described in §4.1 (time + playing state, derived current
  chapter and elapsed, the 100ms tick, and toggle/play/pause/seek/next-chapter).
- **Viewport**: a single reactive "below `md`?" flag from a `matchMedia` listener — `false` on the
  server (SSR/prerender-safe), live in the browser. Drives the comments' collapsed-by-default start on
  phones (its sole consumer); pure-CSS responsive behavior never goes through it.
- **SEO**: sets the title, Open Graph / Twitter / canonical / hreflang tags per route plus optional
  `BlogPosting` structured-data on articles. All writes are idempotent (add-or-replace) so
  re-running per navigation leaves exactly one tag, and the prerenderer freezes the result. Hreflang
  emits **one alternate per `Lang`** (the same path in each language, looped over `LANGS`) plus
  `x-default` at the default-language path, and one `og:locale:alternate` per other language.
  Structured-data is injected into a single script element via text
  content (no XSS) and removed on demand.
