Angular replaced `*ngIf` and `*ngFor` with a new control flow, shipped alongside `@defer`.
The combination changes what ends up in the initial bundle: only the JavaScript actually
needed for the first render is shipped at startup, the rest arrives on demand.

## @if, @for, @switch

The `@` syntax is built into the compiler: no directive import, and a **mandatory** `track`
on `@for` that forces you to think about element identity. It's this `track` that avoids
re-creating everything in the DOM on every list change.

```typescript
@if (user(); as currentUser) {
  <p>Bonjour {{ currentUser.name }}</p>
} @else {
  <p>Invité</p>
}

@for (item of items(); track item.id) {
  <li>{{ item.label }}</li>
} @empty {
  <li>Aucun élément</li>
}

@switch (status()) {
  @case ('loading') { <spinner /> }
  @case ('error') { <error-banner /> }
  @default { <content /> }
}
```

The `@empty` block of `@for` and the exhaustive `@case` of `@switch` cover cases that were
often forgotten with structural directives.

## @defer: loading later

`@defer` wraps a piece of template whose code is pulled out of the main bundle and loaded
as a **separate chunk** at the right moment. The trigger decides when: `on viewport` loads
when the block enters the screen, `on interaction` on the first click/focus, `on idle` when
the browser is idle, `on hover`, or `on timer`.

```typescript
@defer (on viewport) {
  <heavy-comments [postId]="postId()" />
} @placeholder (minimum 200ms) {
  <p>Commentaires</p>
} @loading (after 100ms; minimum 300ms) {
  <skeleton-list />
} @error {
  <p>Impossible de charger les commentaires.</p>
}
```

### The auxiliary blocks

- `@placeholder`: rendered **before** any trigger fires, it's the one that can carry the
  `on viewport`/`on interaction` trigger. The `minimum` avoids too brief a flash.
- `@loading`: while the chunk is being fetched; `after` delays its display so it doesn't
  flicker on a fast connection.
- `@error`: if the chunk fails to load (network cut off, for example).

You can also preload without displaying, using `prefetch on hover`, so the click is instant
without weighing down startup.

## The impact on the bundle

Any component, directive, or pipe used **only** within an `@defer` block is extracted into
its own chunk.

A heavy page (code editor, charts, map) can thus shed 100 to 200 KB from the initial
bundle, which only get downloaded if the user scrolls that far. The gain is measured
directly on the **Largest Contentful Paint** and time to interactivity.

The docs detail each trigger in the
[deferred loading guide](https://angular.dev/guide/templates/defer).

One caveat though: an `@defer (on viewport)` placed above the fold triggers immediately and
gains you nothing. Deferring only makes sense for what's **off-screen** or conditional.

> Control flow makes intent readable, and `@defer` attaches an explicit cost to each piece
> of template. Rather than loading everything "just in case," you declare when each block
> earns its JavaScript, and startup gets lighter.
