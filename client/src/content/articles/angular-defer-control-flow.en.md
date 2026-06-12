Angular's new control flow doesn't just swap `*ngIf` and `*ngFor` for nicer syntax. Paired
with `@defer`, it changes what ends up in the initial bundle: at startup you ship only the
JavaScript actually needed for the first render, and the rest arrives on demand.

## @if, @for, @switch

The `@` syntax is built into the compiler: no directive import, and a **mandatory** `track`
on `@for` that forces you to think about element identity. That `track` is what avoids
re-creating the whole DOM on every list change.

```typescript
@if (user(); as currentUser) {
  <p>Hello {{ currentUser.name }}</p>
} @else {
  <p>Guest</p>
}

@for (item of items(); track item.id) {
  <li>{{ item.label }}</li>
} @empty {
  <li>No items</li>
}

@switch (status()) {
  @case ('loading') { <spinner /> }
  @case ('error') { <error-banner /> }
  @default { <content /> }
}
```

The `@empty` block on `@for` and the exhaustive `@case` on `@switch` cover cases that were
often forgotten with structural directives.

## @defer: load later

`@defer` wraps a slice of template whose code is pulled out of the main bundle and loaded as
a **separate chunk** at the right moment. The trigger decides when: `on viewport` loads when
the block enters the screen, `on interaction` on the first click/focus, `on idle` when the
browser is idle, `on hover`, or `on timer`.

```typescript
@defer (on viewport) {
  <heavy-comments [postId]="postId()" />
} @placeholder (minimum 200ms) {
  <p>Comments</p>
} @loading (after 100ms; minimum 300ms) {
  <skeleton-list />
} @error {
  <p>Couldn't load comments.</p>
}
```

### The companion blocks

- `@placeholder`: rendered **before** any trigger fires — it's the one that can carry the
  `on viewport`/`on interaction` trigger. The `minimum` avoids a too-brief flash.
- `@loading`: while the chunk is fetched; `after` delays its display so it doesn't flicker on
  a fast connection.
- `@error`: if the chunk fails to load (dropped network, for instance).

You can also prefetch without rendering using `prefetch on hover`, so the click is instant
without weighing down startup.

## The bundle impact

Any component, directive or pipe used **only** inside a `@defer` block is extracted into its
own chunk. A heavy page — code editor, charts, map — can thus pull 100 to 200 kB out of the
initial bundle, downloaded only if the user scrolls that far. The win shows up directly in
**Largest Contentful Paint** and time to interactive. The docs detail every trigger in the
[deferred loading guide](https://angular.dev/guide/templates/defer).

One caveat though: a `@defer (on viewport)` placed above the fold fires immediately and buys
you nothing. Deferring only makes sense for what is **off-screen** or conditional.

> Control flow makes intent readable, `@defer` makes cost explicit. Rather than loading
> everything "just in case", you declare when each piece earns its JavaScript — and startup
> gets lighter on its own.
