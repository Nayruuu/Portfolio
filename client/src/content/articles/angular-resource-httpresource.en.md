Loading data asynchronously has long meant manual `subscribe()`, hand-rolled state management (`loading`, `error`, `data`), and memory leaks whenever an `unsubscribe` was forgotten. Since Angular 21, `resource()` and `httpResource()` wrap all of that in a reactive primitive built on **signals**.

## The resource() model

A `resource()` binds a reactive **request** to an asynchronous **loader**. When a signal read
in `params` changes, Angular automatically reruns the loader and cancels the in-flight
request via an `AbortSignal`. The result is an object of signals: `value()`, `error()`,
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

Changing `userId` is enough: no `subscribe`, no `takeUntilDestroyed`. The `resource`
reloads, exposes `isLoading()` during the call, and cancels the previous request.

## httpResource for REST calls

`httpResource()` is the variant tailored for `HttpClient`: it goes through the interceptors,
handles response typing, and reacts to URL changes. You pass it a function that
returns the URL (or a full request object) derived from signals.

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

In the template, the states are consumed directly, without an `async` pipe:

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

### States and their pitfalls

`status()` returns one of `idle`, `loading`, `reloading`, `resolved`, `error`, and
`local`. Two subtleties:

- during a **reload**, `value()` keeps the old data (`reloading`), which avoids
  a blank screen. Handy for a stale-while-revalidate pattern.
- `httpResource` is designed for **reads** (GET). For a POST/PUT, stick with
  plain `HttpClient`: a resource reruns as soon as its request changes, which doesn't
  make sense for a mutation.

## Why drop manual subscriptions

Imperative RxJS code mixes three concerns: triggering the call, mapping the stream,
and cleaning up.

With `resource`, the **dependency** becomes declarative: the loader reruns because a
signal changed. This removes pagination `BehaviorSubject`s, defensive `switchMap`s,
and `finalize` calls to reset `loading` back to `false`. The official docs cover the API in the
[async guide with resource](https://angular.dev/guide/signals/resource).

> `resource()` replaces the **plumbing**, not RxJS. You describe what to load and what it
> depends on; Angular handles the when, the cancellation, and the state. The component becomes
> a simple read of signals again.
