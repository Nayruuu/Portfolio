# Design & SCSS conventions

> **Canonical rulebook** for styling. This file owns the SCSS/design **rules**; it does **not** own the
> token **values**. Exact token values (the `--bg`/`--accent`/`--r-md`/… palette, per-screen pixel
> spacing, font-size ladder, keyframes) live in **`docs/PRODUCT.md`** and the **design skill** — never
> restate them here.

Encapsulation is **Emulated** (Angular default) everywhere. Every component owns a **separate
`.component.scss`** (never inline `styles`/`styleUrl`-less, never `style="…"`). The global
`client/src/styles.scss` holds **only** the shared layer. These rules apply equally to component SCSS and
the global partials.

---

## 1. CSS tokens only — no hardcoded values

All color / radius / shadow / font / layout values flow through **CSS custom properties** declared in
`styles/_tokens.scss` (`:root`). At a call site use the token, **never** the literal:

```scss
/* yes */            /* no */
color: var(--text);   color: #f1f1ef;
border-radius: var(--r-md);   border-radius: 10px;
box-shadow: var(--sh-2);   box-shadow: 0 6px 24px rgb(0 0 0 / 50%);
```

A token's **value** is written in **exactly two** places: `_tokens.scss` (`:root`, dark = default) and
`_theme-light.scss` (`[data-theme='light']`, the re-declaration). Everywhere else is `var(--…)`.

**Narrow, sanctioned exceptions** (a raw value is allowed only when it is genuinely not a token):
- The token **definitions** themselves (`_tokens.scss`, `_theme-light.scss`).
- **Theme-flip literals** that have no token — e.g. a button that goes solid-dark on light
  (`--bg: #1a1a1a` in `_theme-light.scss`), `#0a0a0b` as `--fg` on `.btn--primary`/`--accent` (dark text
  baked into a button), `#fff`/`#000` hover ends. These are local component-vars (`--bg`/`--bd`/`--fg`),
  not a new palette.
- **Structural numbers** that aren't design tokens: pixel sizes of one-off geometry (a `4px` tier bar,
  `64px` symbol tile, `999px` pill radius, grid track widths, `aspect-ratio`, `letter-spacing`,
  `line-height`, opacity, `translate`/`scale` amounts). Reach for an existing radius/shadow/space token
  when one fits; invent a raw number only for true one-offs.
- **`rgb(… / x%)`** overlays computed off black/white (scanlines, thumb grids, scrims) where no surface
  token applies.
- **Breakpoint values** — the responsive tiers are **Sass** variables (a `$breakpoints` map), not CSS
  custom properties, because `var()` is invalid inside a `@media` condition (the one structural-Sass
  exception; the system is owned by §11).

When in doubt, if a value would need to change **between themes**, it must be a token (so the
`[data-theme='light']` block can override it once).

---

## 2. One-level BEM nesting

Each block nests its BEM **elements** (`&__el`), **modifiers** (`&--mod`), **pseudo-classes**
(`&:hover`), and **descendant tags** (`a`, `span`) **exactly one level** under the block:

```scss
.block {
	/* base */

	&:hover {
	}

	&__el {
	}

	&--mod {
	}

	a {
	}
}
```

**One level only.** BEM elements stay **siblings** via `&__` — **never** nest an element inside an
element:

```scss
/* no — never &__a { &__b } */
.block {
	&__head {
		&__title {
		}
	}
}

/* yes — siblings */
.block {
	&__head {
	}

	&__head-title {
	}
}
```

This compiles to identical flat-BEM CSS (same low specificity) but reads better. **Flat BEM is also
valid** — leave a run flat rather than reorder cascade-significant rules just to nest it. Do not reorder
rules to enable nesting unless the move is provably **cascade-neutral**.

Keep these blocks **top-level** (not nested inside a block), even though they belong to it:
- `:host-context([data-theme='light'])` light overrides (see §6).
- `@media` queries — including the `@include bp.from()` breakpoint blocks, which expand to one (see §11).
- `@keyframes`.

---

## 3. Blank line between rule blocks

A **blank line separates adjacent rule blocks** — sibling `&__el`s, consecutive top-level rules,
`@media`, `@keyframes`. Enforced by **Stylelint** (`client/.stylelintrc.json`, extends
`stylelint-config-standard-scss`):

- **`rule-empty-line-before`**: `["always", { "except": ["first-nested"], "ignore": ["after-comment"] }]`
  — a blank line before every rule, **except** the first rule nested in a block, and **not** required
  after a comment.
- **`at-rule-empty-line-before`**: `["always", { "except": ["first-nested",
  "blockless-after-same-name-blockless"], "ignore": ["after-comment"] }]` — same, for `@media`/`@keyframes`/`@use`.

No blank line is required **before** a declaration (`declaration-empty-line-before` and
`custom-property-empty-line-before` are `null`), nor before/after `//` comments
(`comment-empty-line-before`, `scss/double-slash-comment-empty-line-before` are `null`). Blank lines
inside a token group (grouping `--surface-*` vs `--text-*`) are stylistic and allowed.

---

## 4. Indentation: tabs (SCSS only)

SCSS is indented with **tabs**. Prettier config (`client/.prettierrc.json`) **omits** `useTabs` globally
(Prettier defaults to `false`) and only the `*.scss` override sets it:
`{ "files": "*.scss", "options": { "useTabs": true } }`. **TS and HTML stay 2-space.**
`make format` enforces this — never hand-indent SCSS with spaces.

---

## 5. `styles.scss` is a thin `@use` entry — cascade-significant order

`client/src/styles.scss` contains **no rules of its own** — it is a list of `@use` of focused partials
under `client/src/styles/` (`_tokens`, `_base`, `_buttons`, `_tabs`, `_tabview`, `_theme-light`, `_scenes`,
`_code-block`, …). Each partial is one cohesive concern.

**The `@use` order is cascade-significant** and mirrors the original source order. The load-bearing
constraint: `_theme-light` re-declares the `:root` tokens inside `[data-theme='light']` at **equal
specificity**, so under CSS source-order tie-breaking it must come **after** `_tokens` to win. The
established order is:

```
tokens → base → boot → buttons → tabs → layout → tabview → feature-bits
       → theme-light → overlays → scenes → scene-rich → code-block → dots
       → likebar → comment → cards → symbol-box → loadbar
```

Adding a partial: insert it where its cascade demands (overrides after what they override, theme
re-declarations after the base tokens), then add the matching `@use`. Do not reorder existing lines.

---

## 6. Shared vs co-located placement

Decide where a class's rules live by **how many components render it**:

| Rendered by… | Lives in… |
|---|---|
| a **single** component | that component's `.component.scss` |
| **several** components | a **global** partial under `client/src/styles/` |

- **Single-component classes** (`.player`, `.articles`, `.series-row`, `.vgrid-card`, `.about-side`, …)
  → the component's own `.scss`. Scoping (Emulated) keeps them local.
- **Cross-component classes** (`.btn*`, `.tabs`/`.tab`, `.tabview*`, `.scene*`, `.code-block*`,
  `.comment*`, `.likebar*`, `.article-detail__topbar`, `.video-meta__author-av`) → a global partial.
  Emulated scoping would **break** these if declared in one component, so they must be global.

A class that starts single-component but gets rendered by a second component **moves up** to a global
partial — do not duplicate it.

---

## 7. Grouped-selector hoisting

When the **same rule block** appears in **two or more** components, hoist it to a shared partial as a
**grouped selector** rather than copying it:

```scss
/* styles/_symbol-box.scss — the 64px tile shared by series-row + rel-card */
.series-row__sym,
.rel-card__sym {
	width: 64px;
	height: 64px;
	/* … */
}
```

Existing hoists: `_scene-rich.scss` (rich-scene `__cmd`/`__sub` chrome), `_symbol-box.scss` (64px
`__sym` tile), `_dots.scss` (macOS window dots), `_cards.scss` (the `__thumb-grid` backdrop).

**Hoist only when byte-identical.** Patterns that *look* similar but have **value drift** (e.g. the
mono-caption family — same shape, different sizes per use) **stay per-component**. Do not factor a
near-match into a grouped selector and parameterize away the differences; copies that genuinely differ
are correct.

---

## 8. Theme overrides via `:host-context`, co-located

A component's **light-theme** overrides live in **its own `.scss`**, scoped with
`:host-context([data-theme='light'])`, and **co-located at the bottom of the file** as top-level rules
(not nested inside the dark block — see §2):

```scss
.pcard {
	/* dark defaults */
}

/* … rest of component … */

:host-context([data-theme='light']) .pcard:hover {
	/* light override */
}
```

**Global** light overrides (for cross-component classes) live in `_theme-light.scss` using the
**`[data-theme='light']`** prefix instead (it is global, not behind `:host`). The theme is driven by a
single `data-theme` attribute on `<html>` (`ThemeService` + the anti-flash inline script in
`index.html`); SCSS never branches on a JS flag.

Both selectors stay at the **bottom** of their file, after the dark rules they amend — co-location keeps
each component's light story next to its dark one.

---

## 9. No static inline styles; when `[style.x]` is allowed

**Never** a static `style="…"` attribute in a template. Presentational CSS lives in the component
`.scss` (or a global partial for cross-component classes), expressed via tokens.

`[style.x]` / `[style]` **bindings** are allowed **only** for genuinely **dynamic, per-instance**
values that cannot be a static class:
- progress widths (player progress fill, article read-progress bar),
- data-driven colors (an accent/tier color carried on the content model),
- live pointer-tracked positions (the game's floating joystick base/knob follow the thumb),
- the deliberate `reveal()` fade-in.

If a value is the **same for every instance**, it is **not** dynamic — make it a class in the `.scss`,
not a `[style]` binding.

---

## 10. Verify

After any SCSS change, run **`make lint`** (ESLint **+ Stylelint**) and, before a visual-sensitive
change, **`make e2e`** (Playwright visual regression — the net that guarantees a pixel-identical
render). `make format` applies the tabs override. Evidence over assertions — a green lint + unchanged
snapshots is the proof a style change is correct.

---

## 11. Breakpoints & mobile-first

The app is **mobile-first**: the base, unscoped rules target the **phone**; wider layouts are layered on
at breakpoints — never the reverse. All responsive logic flows through **one** shared partial,
`styles/_breakpoints.scss`:

- It declares a Sass **map** `$breakpoints` of three named tiers — `sm` · `md` · `lg` (the px values
  live in `docs/PRODUCT.md`) — and a single `@mixin from($bp)` that emits `@media (min-width: …)`.
  Map-based **by design**: a `@if`/`@else` chain would trip Stylelint's `at-rule-empty-line-before` on
  `@else`.
- A file opts in with `@use 'breakpoints' as bp;`, then `@include bp.from(md) { … }`. This is enabled by
  `stylePreprocessorOptions.includePaths: ["src/styles"]` in `client/angular.json`, and is the **first
  and only** `@use` inside component SCSS — components otherwise consume the global `var(--…)` tokens
  and never `@use` anything.
- `_breakpoints.scss` is **not** part of the cascade-significant `styles.scss` `@use` chain (§5): it
  emits **no CSS of its own** (only a map + a mixin), so it carries no source order — it is pulled into
  each file that needs it, including `_tokens.scss`.

**Direction.** The base rule is the phone; the desktop layout lives inside `@include bp.from(md | lg)`
blocks. Multi-column grids collapse to one column on the phone and are restored at the right tier — the
main content + 380px-sidebar grid returns at `lg`. The `--pad` token follows the same shape (a smaller
mobile base, restored at `md`). Per-screen mobile anatomy and the exact tier/padding px live in
`docs/PRODUCT.md` (the design source of truth).

**Breakpoint values are Sass, not CSS tokens** — the single sanctioned exception to §1's
"CSS-tokens-only" rule: a `var(--…)` is **invalid inside a `@media` condition**, so the tiers must be a
compile-time `$breakpoints` map.

Keep every `@include bp.from()` block at SCSS **top-level**, never nested inside a selector — it expands
to a `@media` query (§2).
