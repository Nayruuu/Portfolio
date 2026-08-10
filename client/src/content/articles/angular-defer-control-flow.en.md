Angular 21 bakes its control flow into the compiler: `@if`, `@for`, `@switch`, plus `@let` and
`@defer`. This portfolio uses them everywhere, to the point that no component imports `CommonModule`,
`NgIf`, or `NgForOf` anymore.

The "less JS at startup" in the title covers two separate levers: route-based code-splitting, and a
`@defer` placed on the one large block the home page shipped without ever running it. This second
lever removes about 260 KB of raw JavaScript from the home load, measured on the production build. I
treat the two subjects separately, because they don't solve the same problem.

## Control flow lives in the compiler

`@if` and `@for` aren't directives: the template compiler recognizes them directly. A component
displaying a conditional list has nothing to declare in its `imports` array. A `grep` for
`CommonModule`, `NgIf`, `NgForOf`, or `NgSwitch` in `client/src/app` turns up nothing: those symbols
have left the application code.

The other quiet addition is `@let`. Almost every template in the project starts with the same line,
`@let content = i18n.content();`: a template-local variable, read-only, re-evaluated when the signal
changes. It avoids repeating `i18n.content()` on every interpolation and serves as the single entry
point into the current locale's translated content.

## `@if`, `@else if`, `@else`

The home page's video player is a three-way branch. Depending on state, it renders the mini-mode
restore button, the game, or the default scene:

```html
@if (player.mini()) {
  <button class="player__popped" (click)="player.closeMini()">…</button>
} @else if (game.running()) {
  <sd-bsp-demo (exited)="exitGame()" [fullscreen]="fullscreen()" />
} @else {
  <sd-player-stage />
  <!-- controls, progress bar, settings… -->
}
```

The condition takes a signal called as a function (`player.mini()`, `game.running()`). `@if` also
accepts an alias that captures the non-null value for the rest of the block. The project page uses it
this way, `@if (articleSlug(); as slug)`, to only work with an identifier guaranteed to be present.

## `@for` and the mandatory `track`

`@for` requires a `track` expression. It tells Angular how to identify an item across renders, hence
which DOM nodes to reuse instead of recreating everything. The compiler rejects a `@for` that lacks
one.

Three key choices recur in this repo, depending on the nature of the data.

When the item carries a stable identifier, we follow that identifier: `track chapter.id` for the
player's chapters, `track review.who` for reviews, `track tech.name` for the technologies of a stack
level. Two successive renders will find the same object even if its position shifts.

When the list is made of strings or numbers, we follow the value itself: `track tech` on a project's
tags, `track lang` on languages, `track speed` on playback speeds. The value acts as the key.

That leaves `track $index`, for positional lists that never reorder. An article's body rendered from
its Markdown is the example: the parsed blocks keep their order, so the index is a legitimate key.

```html
@for (block of body(); track $index) {
  @switch (block.type) {
    @case ('h2') { <h2><sd-inline-runs [runs]="block.runs" /></h2> }
    @case ('p') { <p><sd-inline-runs [runs]="block.runs" /></p> }
    @case ('ul') {
      <ul>
        @for (item of block.items; track $index) {
          <li><sd-inline-runs [runs]="item" /></li>
        }
      </ul>
    }
    @case ('code') { <sd-code-block [code]="block.text" [lang]="block.lang" /> }
    @case ('quote') { <blockquote><sd-inline-runs [runs]="block.runs" /></blockquote> }
  }
}
```

`@for` also knows how to expose `$index` under a name: `@for (filter of content.articleFilters; track
filter; let index = $index)` keeps the index handy to mark the active filter. The `@empty` block, on
the other hand, appears nowhere in the project. The "empty list" case is handled by a separate `@if`
placed before the grid, `@if (filtered().length === 0)`, because the no-results message lives
elsewhere in the layout than the grid itself.

## `@switch` for rendering Markdown

The excerpt above shows the real use of `@switch` in the project: projecting a tree of Markdown blocks
onto the right elements. `@switch (block.type)` routes each node (`h2`, `p`, `ul`, `code`, `quote`) to
its rendering component. A second `@switch (run.kind)` does the same job one level down, inside
`sd-inline-runs`, to distinguish text, link, and inline code within a paragraph.

This is content, not application UI: each `@case` corresponds to a closed variant of the data model,
and the compiler checks each branch's templates.

## What "less JS at startup" means here

Control flow makes templates readable, but on its own it doesn't reduce the JavaScript downloaded on
first load. That work goes through two mechanisms: the router, and a `@defer`.

Each feature is loaded on demand. `app.routes.ts` declares fourteen `loadComponent` or `loadChildren`
entry points; the `articles`, `series`, and `projects` pages even have their own lazy route subtree:

```typescript
{
  path: 'articles',
  loadChildren: () =>
    import('./features/articles/articles.routes').then((m) => m.ARTICLES_ROUTES),
},
```

The dynamic `import()` is what the bundler follows to create a separate chunk. As long as a visitor
doesn't go to `/articles`, that page's code doesn't go over the network. The first load only carries
the route being displayed.

`@defer` moves this same idea below the route, inside a template. It wraps a fragment whose code is
pulled out of the current chunk and only arrives at the chosen trigger: `on viewport`,
`on interaction`, `on idle`, `on hover`, `on immediate`, or `on timer`. It comes with its own auxiliary
blocks, described in the [lazy-loading guide](https://angular.dev/guide/templates/defer):

```html
@defer (on interaction) {
  <heavy-widget />
} @placeholder {
  <p>…</p>
} @loading (after 100ms; minimum 300ms) {
  <skeleton />
} @error {
  <p>Chargement impossible.</p>
}
```

The `@placeholder` is rendered before any trigger and can carry the trigger itself. The `@loading`
covers the chunk-fetch time, with an `after` that delays its display so it doesn't flash on a fast
connection. The `@error` takes over if the chunk fails to load.

## The `@defer` placed on the game engine

The game component, `sd-bsp-demo`, drags the whole engine behind it: `asset-loader`,
`combat-runtime`, `pickup-runtime`, the painters, the enemy AI. The build turns it into its own chunk,
`bsp-demo-component`, 261 KB raw, 69 KB once gzip-compressed.

This code is only useful after a click on the player's controller, and virtually no visitor ever
triggers it. The `@if (game.running())` only conditioned the **render**: the engine itself shipped in
the home chunk and stayed there, loaded for nothing.

The block is now wrapped in a `@defer`, inside the branch already guarded by the condition:

```html
@else if (game.running()) {
  @defer (on immediate) {
    <sd-bsp-demo
      (exited)="exitGame()"
      [fullscreen]="fullscreen()"
      [fullscreenAvailable]="nativeFullscreen"
      (fullscreenToggle)="toggleFullscreen()"
    />
  }
}
```

The `on immediate` trigger loads the chunk as soon as the block enters the DOM. Since that block lives
under `@else if (game.running())`, it only enters the DOM once the game has started: the condition
already does the sorting, `on immediate` merely pulls the code at the exact moment the branch is
rendered. As long as the game isn't running, the `@else` branch is rendered, i.e. the normal player;
there's therefore nothing to put in a `@placeholder`, and the display doesn't change.

`BspDemoComponent` stays in the player's `imports` array. Angular automatically defers a standalone
component whose only usage site is inside a `@defer`: no need for a manual dynamic `import()` or to
remove the declaration.

The result shows up in the production build. Loading `/fr` and reading the resource-timing entries
(`performance.getEntriesByType('resource')`), the home page's JavaScript drops from 774,534 to 514,771
raw bytes, and from twelve files to eleven. That's 259,763 fewer bytes, roughly −260 KB raw,
close to 33% of the home page's JS; over the network, the removed chunk weighs 69 KB once
compressed. The measurement is a one-off, taken once on a real build, not an averaged benchmark.

The distinction still holds. Control flow decides what gets displayed; route-splitting and
`@defer` decide what gets downloaded. The project applies the first everywhere, the second to
routes, and now to this specific block.

> The new control flow flattened the templates and removed `CommonModule` from the code. Lightening
> startup remains a separate effort: it goes through the router, and through a `@defer` on the game
> engine, which removes a third of the home page's JavaScript so it's only sent to the visitor who
> starts the game.
