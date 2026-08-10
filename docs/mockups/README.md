# Mockups — the visual reference

These are the rendered screens of the app (default dark theme; the light theme is the token
palette's `[data-theme='light']` overrides applied to the same layout). They are the **visual source
of truth**: reconstruct each screen's SCSS so the rebuilt app renders to match these, using the token
palette + the placement map + the per-screen anatomy in `PRODUCT.md`.

- `home.png` — the watch page (player area masked; see PRODUCT.md §4 for the player/scenes)
- `articles.png` · `series.png` · `about.png` · `stack.png` · `contact.png` — the tab screens
- `article-detail.png` · `series-detail.png` — the detail pages

## Scene mockups (the player, frozen)

The player auto-plays so it's masked in `home.png`. These freeze each scene at a settled moment
(reveals/typewriter complete) — the visual reference for reconstructing the player scenes:
`scene-intro.png` · `scene-stack.png` · `scene-projects.png` ·
`scene-timeline.png` · `scene-outro.png`.
