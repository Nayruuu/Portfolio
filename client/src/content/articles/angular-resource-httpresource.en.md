Loading async data long meant manual `subscribe()` calls, hand-rolled state (`loading`,
`error`, `data`) and memory leaks whenever you forgot an `unsubscribe`. Since Angular 21,
`resource()` and `httpResource()` wrap all of that into a reactive primitive built on
**signals**.

## The resource() model

A `resource()` ties a reactive **request** to an async **loader**. When a signal read in
`params` changes, Angular re-runs the loader automatically and cancels the in-flight request
through an `AbortSignal`. The result is an object of signals: `value()`, `error()`,
`status()`, plus `isLoading()`.

```typescript
import { resource, signal } from '@angular/core';

export class UserCard {
  private readonly userId = signal(1);

  protected readonly user = resource({
    params: () => ({ id: this.userId() }),
    loader: ({ params, abortSignal }) =>
      fetch(`/api/users/${params.id}`, { abortSignal }).then((response) =>
        response.json(),
      ),
  });

  protected next(): void {
    this.userId.update((id) => id + 1);
  }
}
```

Changing `userId` is enough: no `subscribe`, no `takeUntilDestroyed`. The `resource` reloads,
exposes `isLoading()` during the call, and aborts the previous request.

## httpResource for REST calls

`httpResource()` is the variant tailored for `HttpClient`: it runs through interceptors,
handles response typing and reacts to URL changes. You give it a function that returns the
URL (or a full request object) derived from signals.

```typescript
import { httpResource } from '@angular/common/http';
import { signal } from '@angular/core';

export class ArticleList {
  protected readonly tag = signal<string | undefined>(undefined);

  protected readonly articles = httpResource<Article[]>(() => ({
    url: '/api/articles',
    params: this.tag() ? { tag: this.tag() } : {},
  }));
}
```

In the template, you consume the states directly, with no `async` pipe:

```typescript
@if (articles.isLoading()) {
  <p>Loading…</p>
} @else if (articles.error()) {
  <p>Failed to load.</p>
} @else {
  @for (article of articles.value(); track article.id) {
    <h3>{{ article.title }}</h3>
  }
}
```

### States and their gotchas

`status()` returns one of `idle`, `loading`, `reloading`, `resolved`, `error` and `local`.
Two subtleties deserve attention:

- during a **reload**, `value()` keeps the previous data (`reloading`), which avoids a blank
  screen — handy for a stale-while-revalidate pattern.
- `httpResource` is meant for **reads** (GET). For a POST/PUT, stick with plain `HttpClient`:
  a resource re-runs as soon as its request changes, which makes no sense for a mutation.

## Why drop manual subscriptions

Imperative RxJS code mixes three concerns: triggering the call, mapping the stream, and
cleaning up. With `resource`, the **dependency** becomes declarative — the loader re-runs
because a signal changed, full stop. You delete the pagination `BehaviorSubject`s, the
defensive `switchMap`s and the `finalize` calls that reset `loading` to `false`. The official
docs cover the API in the [async resource guide](https://angular.dev/guide/signals/resource).

> `resource()` doesn't replace RxJS: it replaces the **plumbing**. You describe what to load
> and what it depends on; Angular handles the when, the cancellation and the state. The
> component goes back to being a plain read of signals.
