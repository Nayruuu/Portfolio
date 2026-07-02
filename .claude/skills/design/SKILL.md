---
name: design
description: Reproduce the super-dev portfolio's SCSS to render-identity — CSS token table (dark + light), the cascade-significant @use order, shared-vs-co-located placement, grouped-selector hoisting, and how to turn PRODUCT.md's visual anatomy into a component .scss. TRIGGER when writing or editing any .scss (component or global partial), adding/overriding a CSS token, theming (data-theme/light), the styles.scss @use list, or reproducing a screen's visual design. SKIP for TS/HTML logic with no styling.
---

# Design / SCSS reproduction

Operational guide to rebuild the styling to **pixel-identical render**. The **rules** are canonical in
**`.claude/conventions/design.md`** — **apply it**; this skill does not restate them. This skill carries
only what reproduction needs that the rulebook intentionally omits: the **exact token values**, the
**`@use` order**, the **shared-vs-co-located map**, the **grouped-selector hoists**, and the
**recipe** for turning PRODUCT.md's visual anatomy into a component `.scss`.

Token values, per-screen pixel spacing, and the font-size ladder are owned by **PRODUCT.md** + this
skill — never by `.claude/conventions/design.md`. Verify with **`make lint`** (ESLint + Stylelint) and,
for any visual-sensitive change, **`make e2e`** (Playwright visual regression — the net for
pixel-identity).

## Before you write SCSS

1. **Read `.claude/conventions/design.md`** — it owns the 11 SCSS/design rules (tokens-only §1, one-level
   BEM nesting §2, blank line §3, tabs §4, thin `@use` entry §5, shared-vs-co-located §6,
   grouped-selector hoisting §7, `:host-context` theme overrides §8, no static inline styles §9,
   verify §10, breakpoints & mobile-first §11). Apply them; this skill does not restate them.
2. Pick **placement** from the map below ("Shared vs co-located") and the rule in design.md §6.
3. Reach for the **token values** in the table below; use `var(--…)` per design.md §1 (sanctioned
   raw-value exceptions are listed there).

## Token table — copy verbatim into `styles/_tokens.scss` (`:root`, dark = default)

| Token | Value | Group |
|---|---|---|
| `--bg` | `#0a0a0b` | surfaces |
| `--surface` | `#131316` | surfaces |
| `--surface-2` | `#1a1a1e` | surfaces |
| `--surface-3` | `#232328` | surfaces |
| `--border` | `#2a2a30` | surfaces |
| `--border-soft` | `#1f1f24` | surfaces |
| `--text` | `#f1f1ef` | text |
| `--text-dim` | `#a4a4a8` | text |
| `--text-faint` | `#85858c` | text |
| `--text-mute` | `#45454a` | text |
| `--accent` | `oklch(66% 0.22 22deg)` | accents (warm red, our own) |
| `--accent-hot` | `oklch(74% 0.24 28deg)` | accents |
| `--accent-deep` | `oklch(42% 0.18 22deg)` | accents |
| `--accent-glow` | `oklch(66% 0.22 22deg / 18%)` | accents |
| `--ok` | `oklch(78% 0.16 145deg)` | status |
| `--warn` | `oklch(82% 0.16 80deg)` | status |
| `--info` | `oklch(72% 0.13 230deg)` | status |
| `--f-sans` | `'IBM Plex Sans', system-ui, sans-serif` | type |
| `--f-mono` | `'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace` | type |
| `--page-w` | `1440px` | layout |
| `--pad` | `16px` (mobile-first base; `32px` at `bp.from(md)`) | layout |
| `--r-sm` | `6px` | radii |
| `--r-md` | `10px` | radii |
| `--r-lg` | `14px` | radii |
| `--r-xl` | `18px` | radii |
| `--sh-1` | `0 1px 2px rgb(0 0 0 / 40%)` | shadows |
| `--sh-2` | `0 6px 24px rgb(0 0 0 / 50%)` | shadows |

Keep the comment lines (`/* surfaces */`, `/* warm red, our own */`, …) and the blank line between
groups; they're stylistic but match source.

## `[data-theme='light']` overrides — `styles/_theme-light.scss`

The re-declared values (see design.md §1, §8 for the mechanism). Tokens NOT listed below (radii, fonts,
layout, the warm-status `--ok/--warn/--info`) **do not flip** — light inherits the `:root` value.

| Token | Light value |
|---|---|
| `--bg` | `#faf9f6` |
| `--surface` | `#fff` |
| `--surface-2` | `#f3f1ec` |
| `--surface-3` | `#e7e4dc` |
| `--border` | `#d4d0c7` |
| `--border-soft` | `#e6e3d9` |
| `--text` | `#1a1a1a` |
| `--text-dim` | `#555` |
| `--text-faint` | `#6b6b6b` |
| `--text-mute` | `#b0aea7` |
| `--accent` | `oklch(56% 0.21 22deg)` |
| `--accent-hot` | `oklch(62% 0.23 28deg)` |
| `--accent-deep` | `oklch(38% 0.18 22deg)` |
| `--accent-glow` | `oklch(56% 0.21 22deg / 12%)` |
| `--sh-1` | `0 1px 2px rgb(20 18 12 / 6%)` |
| `--sh-2` | `0 8px 28px rgb(20 18 12 / 8%)` |

Plus these **global cross-component** light rules in the same file (top-level `[data-theme='light'] …`,
not `:host-context` — the file is global):
- Body texture flip: `[data-theme='light'] body::before` → `repeating-linear-gradient(0deg, rgb(0 0 0 / 1.2%) 0, rgb(0 0 0 / 1.2%) 1px, transparent 1px, transparent 3px)` at `opacity: 0.5` (dark `_base.scss` uses `rgb(255 255 255 / 1.2%)` at `opacity: 0.6`).
- `.btn--primary` solid-dark on light: local component-vars `--bg: #1a1a1a; --bd: #1a1a1a; --fg: #fff` (hover → `#000`). `.btn--accent` → `color: #fff; --fg: #fff`. (These `#1a1a1a/#000/#fff` are theme-flip literals, **not** a new palette.)
- `.likebar button:hover` → `background: rgb(0 0 0 / 5%)`; `::selection` → `var(--accent-glow)`/`var(--text)`; `.boot`/`.konami b` → `var(--accent)`; `.konami` → `var(--text-mute)`; `.comment__name-tag` → `var(--surface)`/`var(--border)`; `.tab[aria-selected='true']` → `border-bottom-color: var(--accent)`.

## `@use` order — `client/src/styles.scss` (cascade-significant, do not reorder)

Copy this list verbatim (the cascade rule and why the order is load-bearing: design.md §5):

```
tokens → base → boot → buttons → tabs → layout → tabview → feature-bits
       → theme-light → overlays → scenes → scene-rich → code-block → dots
       → likebar → comment → cards → symbol-box → loadbar
```

### Exact partial inventory (`client/src/styles/_*.scss`)

Twenty partials. The `@use` name drops the leading `_` and `.scss` (`@use 'styles/tokens'` ⇒
`_tokens.scss`). Each is one cohesive concern; sizes below are the original byte counts (a sanity check
that you reproduced the whole file, not a fragment). Nineteen are in the cascade-significant `styles.scss`
`@use` chain; `_breakpoints.scss` is the exception — a mixin/map utility (no CSS output) consumed via
`@use 'breakpoints' as bp` from components and `_tokens.scss`, never added to that chain (design.md §11).

| File | Owns (selectors) | Keyframes |
|---|---|---|
| `_breakpoints.scss` | the `$breakpoints` map (`sm 600 / md 900 / lg 1100`) + `@mixin from($bp)` (mobile-first `min-width`). **Not** in the `styles.scss` `@use` chain. (design.md §11) | — |
| `_tokens.scss` | `:root { … }` — the dark token table (verbatim above). Comment lines + blank lines between groups. `@use`s `breakpoints` and overrides `--pad` to `32px` at `bp.from(md)`. | — |
| `_base.scss` | `* { box-sizing }`, `html, body` (reset + mobile-first `font-size: 13px` → `14px` at `bp.from(md)` / `line-height: 1.5`), `body::before` (scanline), `::selection`, the two `sd-*` `display` groups (`block` list; `display: contents` on `sd-home, sd-up-next, sd-scene-*`). | — |
| `_boot.scss` | `.boot` (+ `&__pre`, `&__caret`). | `blink` (`50% { opacity: 0 }`) |
| `_buttons.scss` | `.btn` (+ `&--primary/--accent/--ghost/--sm/--grow`). | — |
| `_tabs.scss` | `.tabs`, `.tab`, `.tab__label`, the link-neutralize group (`.btn, .rel-card, .series-row, .series-ribbon__btn, .series-ribbon__title, .vgrid-card, .pcard, .vid-card { text-decoration: none }` — the card grids render as real `<a>` anchors), `.tab:hover`, `.tab[aria-selected='true']`. Mobile-first: `.tabs` is a **fixed bottom bar** (`bp.from(md)` restores the top text row, byte-identical); `.tab` is icon-over-`.tab__label` on mobile, `.tab .tab__icon` hidden at `md`; light bg override (+ its `md` reset) in `_theme-light.scss`. | — |
| `_layout.scss` | `.main`, `.main > router-outlet`, `.cursor`, `.tab-pane`, `.main:has(.tab-pane)`, `:root:has(sd-home) sd-channel-header` (hidden on mobile home, `block` restored at `bp.from(md)`), `body:has(.player.is-fullscreen)` (fullscreen scroll-lock) + `@media (pointer:coarse) body:has(.player sd-bsp-demo)` (the mobile game overlay's scroll-lock + hiding `.tabs`/`.prefs-dock` behind it). Single-column tracks are `minmax(0, 1fr)` — never bare `1fr` (min-content of long code lines would widen the page on phones); 2-col grid restored at `bp.from(lg)`. `.main` bottom padding clears the fixed bottom bar on mobile (reset to `80px` at `bp.from(md)`). Also `.prefs-dock` — the mobile-only floating theme + language pill (`position:fixed` bottom-right above the tab bar), `display:none` at `bp.from(md)` and while fullscreen. (The dock's picker opens **upward**, but that rule is owned by `sd-prefs` via `:host-context(.prefs-dock)` — see `layout/prefs` — not here.) | — |
| `_tabview.scss` | `.tabview` (+ `&__head/__title/__sub/__count/__count-v/__count-lbl`). | — |
| `_feature-bits.scss` | `.article-detail__topbar` (+ `&-arrow/&-actions`), `.video-meta__author-av` (40px gradient avatar). | — |
| `_theme-light.scss` | `[data-theme='light'] { … }` re-declaration + the global light overrides (see the light table above). **Must load after `_tokens`.** | — |
| `_overlays.scss` | `.reveal`, `.reveal.is-in`, `.egg` (+ `.egg b`), `.konami` (+ `.konami b`; keyboard-only → hidden on phones, `block` at `bp.from(md)`). | `eggIn` |
| `_scenes.scss` | `.scene`, `.scene--on`, `.scene--fit` (mobile scale-to-fit on all five scene roots — `760px`/`16/9` reference box scaled by `tan(atan2(var(--scene-fit), 1px))` where `@property --scene-fit` (registered `<length>`) carries `calc(100cqw / 760)` — the registration forces the `cqw` to a concrete length *before* `atan2`, sidestepping a WebKit/iOS bug; fully reset at `bp.from(md)`; PRODUCT.md §4.1; re-asserted (grouped, same math) by `.player.is-fullscreen .scene--fit` (upscaling into the letterboxed stage) **and** `.mini-player .scene--fit` (downscaling into the floating mini-player frame)), and the **base** `.scene-intro*` / `.scene-projects*` / `.scene-timeline*` / `.scene-outro*` classes (the largest partial — reconstruct from the scene mockups + PRODUCT.md anatomy). | — |
| `_scene-rich.scss` | grouped `…-rich__cmd` + `…-rich__sub span` hoist (below). | — |
| `_code-block.scss` | `.code-block*` + the `.k/.s/.c/.n/.a` syntax classes (**theme-invariant raw values** — the code panel never flips, so it uses literal `oklch()`/hex, not `var(--…)`; the deliberate §1 exception). `.code-block__body` has `overflow-x:auto; max-width:100%` (no page widen on mobile). | — |
| `_dots.scss` | grouped traffic-light dots hoist (below). | — |
| `_likebar.scss` | `.likebar`, `.likebar button` (+ `:hover`/`.is-on`), `.likebar__divider`. | — |
| `_comment.scss` | `.comment*` (avatar, head, name, tags, body, actions). | — |
| `_cards.scss` | grouped `.vgrid-card, .pcard { cursor }` + `__thumb-grid` backdrop hoist (below). | — |
| `_symbol-box.scss` | grouped 64px `__sym` tile hoist (below). | — |
| `_loadbar.scss` | `.loadbar`. | `loadbar` |

**Animation ownership** (the `@keyframes` a blind rebuild must NOT duplicate): `blink` → `_boot.scss`;
`eggIn` → `_overlays.scss`; `loadbar` → `_loadbar.scss`. The player owns `pulse`
(in `player.component.scss`).

## Shared vs co-located — placement map (per component)

The which-class-goes-where inventory (the rule, and why a cross-component class must be global:
design.md §6). **This is the single most load-bearing fix: it tells the blind rebuild which components
have NO `.scss` of their own — do not invent one for them.** There are **25** component `.scss` files
and **6** components with **no `styleUrl`** (they render only global-partial classes).

### Components with NO `.component.scss` (styled entirely by global partials)

| Component | Renders | Styled by |
|---|---|---|
| `app.component` (shell) | `.loadbar`, `.main`, `.konami` (+ `<router-outlet>`) | `_loadbar`, `_layout`, `_overlays` |
| `home.component` | no classes of its own — pure composition under `.main` | `_layout` (the grid) |
| `tabs-bar.component` | `.tabs`, `.tab`, `.tab__icon`, `.tab__label` | `_tabs` |
| `code-block.component` | `.code-block*`, `.code-block__dot*` | `_code-block`, `_dots` |
| `like-bar.component` | `.likebar`, `.likebar__divider` | `_likebar` |
| `comment.component` | `.comment*` | `_comment` |

Do **not** generate a `.scss` (or `styleUrl`) for any of these six. The `pulse`
keyframe lives in `player.component.scss` — see Animation ownership.

### Components WITH a `.component.scss` (single-component classes — co-located)

| Component `.scss` | Block(s) it owns | Has light `:host-context`? |
|---|---|---|
| `layout/nav` | `.nav*` (brand, search, avatar) — hosts `<sd-prefs>` in `.nav__actions`. Hidden below `md` (`display:none`; the player owns the top of the phone screen), the sticky top bar returns at `bp.from(md)` | yes (7 rules) |
| `layout/prefs` | `.prefs__icon-btn` (theme toggle) + `.prefs__lang*` (the language picker dropdown, default opening **downward**). One `<sd-prefs>` reused twice: in the desktop nav and in the mobile `.prefs-dock` (`_layout`); in the dock it opens **upward** via `:host-context(.prefs-dock) .prefs__lang-menu` (out-specifies its own base `top` rule, which a global override would only tie). `:host{display:inline-flex}` | yes (`.prefs__icon-btn:hover`) |
| `layout/channel-header` | `.channel`, `.banner*`, `.profile*` — compact slim identity row below `md` on non-home (banner/handle/stats/bio + ghost actions hidden, 40px avatar, restored at `md`) | yes (banner, grid, terminal, ascii, avatar) |
| `features/home/player/player` | `.player*` (mobile base = full-bleed 16/9: negative `--pad` margins, no radius, `container-type:size` for `.scene--fit`; rounded card + `container-type:normal` restored at `bp.from(md)`; control row reflows / `__chapter-now` shown at `bp.from(sm)`); the **scene layer is delegated to `sd-player-stage`** (below); owns `.player__popped` (the mini-player placeholder); fullscreen = `is-fullscreen` modifier targeting `.player.is-fullscreen sd-player-stage` (fixed black room + centered 16/9 letterboxed stage, both size containers); iOS forced-landscape = `is-fullscreen:not(:fullscreen)` rotated 90° (`100dvh × 100dvw`) in a top-level `@media (orientation: portrait)` — **video only**; the game opts out (next row); plus `@media (pointer:coarse) .player:has(sd-bsp-demo) { position:fixed; inset:0; … }` makes the **game** a full-viewport overlay (un-rotated in landscape; **CSS-rotated 90° in portrait** to force landscape) | yes (re-pins dark tokens on `.player`) |
| `features/home/player/player-stage` | `.player-stage__bg` + `.player-stage__grid` (radial bg + 40px grid); `:host{position:absolute;inset:0;overflow:hidden}`; mounts the 5 scene components — driven by `PlayerService`, reused by the inline player **and** the mini | no |
| `features/home/player/mini-player` | `.mini-player*` (fixed bottom-right floating frame `z-index:100`; 16/9 `__frame` size-container holding `sd-player-stage`; `__progress`/`__progress-fill` seekable bar at the frame bottom; `__bar`/`__btn`/`__title` control bar) — rendered `@if (player.mini())` at the app shell | no |
| `features/bsp-demo` | `.bsp-demo` (the standalone `/bsp` debug layout — flex column, centred, `gap`/`padding`); `&__viewport` (`position:relative`, `min(92vw,960px)`); `&__canvas` (`width:100%`, `image-rendering:pixelated` — the below-display framebuffer upscales crisp for the software-renderer look); `&__hud` (the composited **DOOM image HUD** `<canvas>`, `aria-hidden`; `inset:auto 0 0`, `height:22%`, `aspect-ratio:2117/404`, `margin-inline:auto`, `pointer-events:none` — the whole bar drawn in JS by `DoomHud`); grouped `&__exit, &__fullscreen` (top-right circular corner buttons — exit-door + native-fullscreen toggle, `right:10px`/`54px`; the fullscreen button only renders when the player passes `fullscreenAvailable`, never on `/bsp`); `&__fps` (top-left dev readout — FPS/ms/threads/texture source, mono green); `&__hint` (dev keyboard hint, mono); `&__controls` (top-left semi-transparent keyboard-controls recap, `display:none` by default) + `&__control` (`white-space:nowrap`). `:host-context(.player)` overrides make the game fill the player box (`:host` + `.bsp-demo` + `&__viewport`/`&__canvas` → `position:absolute; inset:0`, dropping the standalone centring/padding), **hide** the dev `&__fps`/`&__hint`, and **show** `&__controls`. Mounted `@if (game.running())` in place of `sd-player-stage`, and served standalone at `/bsp` | no |
| `features/home/video-meta` | `.video-meta*`, `.description*`, `.chap*` | yes (`.description`) |
| `features/home/up-next` | `.up-next*`, `.vid-card*` (NOT `__thumb-grid` — hoisted; thumb track widens at `bp.from(sm)`) | yes (`.vid-card:hover`, top-level `@media (hover:hover)`) |
| `features/home/comments` | `.comments*` (head = full-width reset toggle button + `__chevron` hidden at `bp.from(md)`; input — NOT `.comment*`, that's global) | yes (input-field) |
| `features/articles/articles` | `.vfilters`, `.vfilter`, `.vgrid`, `.vgrid-card*` (NOT `__thumb-grid`) | yes (`.vfilter.is-on`) |
| `features/articles/article-detail` | `.article-detail*`, `.article-hero*`, `.series-ribbon*`, `.rel-card*` (NOT `.rel-card__sym` — hoisted) | no |
| `features/series/series` | `.pgrid`, `.pcard*` (NOT `.pcard { cursor }` — hoisted; `.pcard` 2-col at `bp.from(md)`) | yes (`.pcard:hover` shadow) |
| `features/series/series-detail` | `.series-detail*`, `.series-row*` (NOT `.series-row__sym` geometry — hoisted; but toggles its `display` locally per breakpoint). Hero un-stacks at `bp.from(md)`. | no |
| `features/about/about` | `.about-grid` (2-col at `bp.from(md)`), `.about-bio*`, `.about-side*` | no |
| `features/stack/stack` | `.stack-tab`, `.stack-tier*`, `.stack-tech*` | yes (`.stack-tech:hover`, top-level `@media (hover:hover)`) |
| `features/contact/contact` | `.contact-grid`, `.contact-avail*`, `.contact-form*`, `.contact-side*` (NOT `__head-dot` — hoisted). 2-col grid restored at `bp.from(md)`. | yes (large — keeps form **dark** on light) |
| `home/player/scenes/intro-scene` | `.scene-intro__*` overrides + `.scene-intro__tagline/__tags/__metrics`, `.metric*` | no |
| `home/player/scenes/stack-scene` | `.scene-stack-rich*`, `.stack-card*` (NOT `__cmd/__sub span` — hoisted). **Mobile-first montage**: base shows only `.stack-card.is-focus` at ~2× type; items carry `.is-pending` (`display:none` until typed) so the card grows item-by-item; the compact 2-col grid (all cards) returns at `bp.from(md)` (PRODUCT.md §4.1). | no |
| `home/player/scenes/projects-scene` | `.scene-projects-rich*`, `.proj-card*`, `.stack-chip` (NOT `__cmd/__sub span`). **Mobile-first montage**: base shows only `.proj-card.is-focus` blown up; head/role/desc/stack carry `.is-pending` so the card grows row-by-row; the compact list returns at `bp.from(md)`. | no |
| `home/player/scenes/timeline-scene` | `.scene-timeline-rich*`, `.tl-rich*` (NOT `__cmd/__sub span`). **Mobile-first montage**: base shows only `.tl-rich__row.is-focus` (rail/dot hidden); role/co/bullets carry `.is-pending` so the row grows line-by-line; the full rail with all rows returns at `bp.from(md)`. | no |
| `home/player/scenes/outro-scene` | `.scene-outro-rich*` (reuses global `.scene-outro__link`) | no |
| `home/player/typed/typed` | `:host` inline + `.typed__shown`/`__caret`/`__ghost` — no-reflow per-string typewriter (`__ghost` `visibility:hidden` reserves space; zero-width `__caret::after` reuses the global `blink`) | no |
| `shared/icon` | `:host`, `svg` (2 trivial rules) | no |
| `shared/inline-runs` | `:host { display: contents }`, `.inline-runs__code/__link` | no |

**Global partials** (rendered by ≥2 components, so they MUST be global — Emulated scoping would break
them otherwise): `.btn*`, `.tabs`/`.tab`, `.tabview*`, `.scene*` (base intro/projects/
timeline/outro), `.scene-*-rich__cmd`/`__sub span`, `.code-block*` + `.k/.s/.c/.n/.a`, `.comment*`,
`.likebar*`, `.boot*`, `.reveal`/`.egg`/`.konami`, `.loadbar`, `.article-detail__topbar`,
`.video-meta__author-av`, plus the four grouped hoists below.

**Cross-component class that lives in a *component* file, not a partial:** `.scene-outro__link` is
defined in `_scenes.scss` (global) but **re-used + tweaked** by `outro-scene.component.scss`
(`.scene-outro-rich__links .scene-outro__link { … }`) — the base stays global, the rich variant
reaches into it locally. `.video-meta__author-av` is global (`_feature-bits`) yet **resized** locally
inside `article-detail.component.scss` (`.article-detail__byline .video-meta__author-av { width: 36px }`).

## Grouped-selector hoists (byte-identical only)

The inventory of what's already hoisted (the byte-identical-only rule: design.md §7):

- **`_scene-rich.scss`** — `.scene-stack-rich__cmd, .scene-timeline-rich__cmd, .scene-projects-rich__cmd` (mono 13px accent, `margin-bottom: 2px`) and the `…__sub span` → `var(--text-mute)`.
- **`_symbol-box.scss`** — `.series-row__sym, .rel-card__sym`: `64px` grid tile, `place-items: center`, `border-radius: 6px`, mono `28px`/`700`, `1px var(--border-soft)`.
- **`_dots.scss`** — macOS traffic-light dots `.contact-form__head-dot, .code-block__dot` (`10px`, `999px`) + `--red #ff5f57` / `--yellow #febc2e` / `--green #28c840`.
- **`_cards.scss`** — `.vid-card__thumb-grid, .vgrid-card__thumb-grid` grid backdrop (two `linear-gradient(rgb(255 255 255 / 6%) 1px, transparent 1px)`, `background-size: 16px 16px`), plus `.vgrid-card, .pcard { cursor: pointer }`.

Value-drift families (e.g. the mono-caption sizes that differ per use) **stay per-component**
(design.md §7).

The grouped-selector inventory above is the **structural contract** (which selectors share a hoisted
rule, in which partial, and the geometry/token notes per group). The exact properties are reconstructed
from those notes + the token table per the one-level-BEM / blank-line / tabs rules — the bullets above
name every value that isn't a token (`64px`/`28px` tile, `10px`/`999px` dots, the three traffic-light
hex modifiers `#ff5f57`/`#febc2e`/`#28c840`, the `16px` grid backdrop). Do **not** keep copied SCSS
bodies here.

## Exact pixels: from the mockups + tokens, not pasted CSS

This skill does **not** ship the verbatim SCSS bodies. The exact pixels come from the **mockups** (the
rendered design) plus the **token table** above and **PRODUCT.md §4–§7 per-screen visual sections**
— reconstructed into a `.component.scss` (or global partial) by the rules: the placement map
decides global-vs-co-located, the `@use` order fixes cascade, and the one-level-BEM / blank-line / tabs
conventions (design.md §2–§4) fix the shape. Use the **token table** for every color/shadow/radius and
the recipe in **"Reproduce a component's SCSS from PRODUCT.md's visual anatomy"** below to turn an
anatomy line into a rule. The **visual regression** (`make e2e`) is the net that proves pixel-identity —
matching the mockup is the contract, not a pasted byte count.

## Reproduce a component's SCSS from PRODUCT.md's visual anatomy

PRODUCT.md §4–§7 per-screen visual sections give each screen's element tree
+ exact pixels. Turn it into a `.component.scss`:

1. **Map the anatomy to BEM.** Each `.block__el (…specs…)` line is one rule. Block = component root
   (`.player`, `.articles`, `.contact-form`); its `&__el` / `&--mod` / `&:hover` / descendant tags nest
   under it (nesting shape: design.md §2).
2. **Translate specs to declarations, tokens first.** `border-radius: var(--r-md)` for cards (10px),
   `var(--r-lg)` (14px) for hero/player; `1px var(--border-soft)` quiet borders → `var(--border)` on
   hover; `var(--surface)`/`--surface-2` fills; `var(--sh-2)` on hero/player. Use a raw pixel only for
   one-off geometry the anatomy spells out (a `4px` tier bar, `64px` tile, `999px` pill, `aspect-ratio`,
   grid track widths, `letter-spacing`, `line-height` — design.md §1 lists the sanctioned exceptions).
   Match font sizes to the ladder (`.title` 36/32px·700, card title 14–15px·600, mono labels 11–12px
   uppercase, captions 9.5–11px). Body/heading default `--f-sans`; all UI labels, timestamps, code,
   numbers use `--f-mono`.
3. **Co-locate the light story at the bottom.** For each value that flips, add a
   `:host-context([data-theme='light']) .block` (or `.block:hover`) rule after the dark rules
   (placement + co-location: design.md §8). Prefer overriding a token where one exists; use a
   theme-flip literal only when no token applies.
4. **Dynamic-only `[style]`.** Per-instance dynamic values (progress widths, data-driven accent/tier
   colors, the deliberate `reveal()` fade-in) are `[style.x]` bindings; anything identical across
   instances is a class (design.md §9). Keep `@media`/`@keyframes`/`:host-context` top-level (§2).

Shared animations to reuse (define `@keyframes` in the owning file, top-level): `blink` 1s `steps(1)`
(cursor/caret), `pulse` 1.6s ease-in-out (live/availability dots), `eggIn` 0.3s, `loadbar` 0.9s
ease-in-out. Standard transitions: `all 0.15s` (buttons/borders/bg), `0.35s ease` (scene opacity),
`0.05s linear` (progress fill).

Responsive is **mobile-first** via the `from()` mixin + `$breakpoints` map (rule → design.md §11);
tier values (sm/md/lg) → `PRODUCT.md`.

## Verify

`make lint` (ESLint + Stylelint) · `make format` (tabs override) · `make e2e` (Playwright visual
regression — the net for pixel-identity). The verify contract is design.md §10; for SCSS the
load-bearing proof is **unchanged snapshots** — evidence over assertions.
