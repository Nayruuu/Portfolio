Charger des données asynchrones... Let me translate this article about `resource()` and `httpResource()` in Angular 21, preserving all code blocks and technical identifiers exactly.

Loading asynchronous data in Angular used to mean a manual `subscribe()`, a hand-maintained state
triplet (`loading`, `error`, `value`), and a memory leak the moment an `unsubscribe` went missing.
Angular 21 tucks that plumbing behind two reactive primitives built on **signals**: `resource()`
and its HTTP variant `httpResource()`.

## The resource() model

A `resource()` binds a reactive `params` function to an asynchronous `loader`. `params` returns
the request to run; the `loader` turns it into data. As soon as a signal read inside `params`
changes, Angular reruns the `loader` and cancels the call still in flight.

The `loader` receives three things: the resolved `params`, an `abortSignal`, and `previous` (the
status of the previous load). The `abortSignal` is the key piece: wired into the `fetch`, it cuts
off the stale request instead of letting it keep running.

```typescript
import { resource, signal } from '@angular/core';

export class UserCard {
  private readonly userId = signal(1);

  protected readonly user = resource({
    params: () => ({ id: this.userId() }),
    loader: ({ params, abortSignal }) =>
      // The fetch option is `signal`, not `abortSignal`: wiring it lets a stale request abort.
      fetch(`/api/users/${params.id}`, { signal: abortSignal }).then((response) =>
        response.json(),
      ),
  });

  protected next(): void {
    this.userId.update((id) => id + 1);
  }
}
```

Changing `userId` is enough: no `subscribe`, no `takeUntilDestroyed`. The resource reloads,
exposes `isLoading()` during the call, and drops the previous request. The result is an object of
signals to read: `value()`, `error()`, `status()`, `isLoading()`.

## httpResource for REST calls

`httpResource()` is the variant tailored for `HttpClient`: it goes through interceptors, types the
response, and reacts to URL changes. It takes a function that returns the URL, or a full request
object, derived from signals.

One concrete constraint: `httpResource` relies on the `fetch` backend, so it needs
`provideHttpClient(withFetch())` at the root. This portfolio already enables it in
`app.config.ts`, even though it doesn't call `httpResource` itself yet (its writes stay on
`HttpClient`, see below). If the request function returns `undefined`, no call is triggered, which
gives a conditional fetch without `*ngIf` or a manual guard.

```typescript
import { httpResource } from '@angular/common/http';
import { signal } from '@angular/core';

export class ArticleList {
  protected readonly tag = signal<string | undefined>(undefined);

  // Re-fetches whenever tag() changes; interceptors and response typing still apply.
  protected readonly articles = httpResource<Article[]>(() => ({
    url: '/api/articles',
    params: this.tag() ? { tag: this.tag() } : {},
  }));
}
```

The `parse` option is worth knowing: it receives the raw response and returns the final type,
which lets you validate the server contract with a runtime schema (Zod, for instance) instead of
trusting an `as`. The response is checked at runtime, not just typed at compile time.

By default the response is parsed as JSON. For another format, `httpResource.text()`, `.blob()`
and `.arrayBuffer()` expose the same reactive mechanics over text or binary. And `defaultValue`
sets what `value()` returns before the first load: passing `[]` here avoids the `idle` branch in
the template, the list starts empty and then fills in.

In the template, you consume the states directly, without an `async` pipe:

```html
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

## The states, and what they keep in memory

`status()` returns one of `idle`, `loading`, `reloading`, `resolved`, `error` and `local`. A few
details change how you write a component.

During a reload, `value()` keeps the old data and `status()` moves to `reloading` rather than
`loading`. The screen doesn't go blank: the stale data stays displayed, the fresh one replaces it
once it arrives. That's stale-while-revalidate with no extra code.

`hasValue()` is a type guard. Inside an `@if (user.hasValue())` branch, TypeScript knows that
`value()` is no longer `undefined`, which avoids the defensive `?.` that creeps in everywhere when
the value might be missing.

The `equal` option rounds out the picture: it compares the old and new data, and if they're
judged equal, the signal doesn't notify its readers. A reload that returns an identical response
then triggers no unnecessary downstream re-render.

## Reloading and cancelling

`reload()` forces a new call without changing the `params`, for a "refresh" button or an
invalidation after an action. It returns a boolean: `false` if the resource is already loading.

Cancellation resolves a class of subtle bugs. With a `switchMap`, you used to manually cancel the
previous subscription so that a slow, stale response wouldn't overwrite a recent one. The resource
does this by construction: when `params` changes, the `abortSignal` of the in-flight call fires.
The race where an old response arrives after the new one no longer exists, and along the way you
drop the defensive `switchMap`s, the `finalize` blocks that reset `loading` to `false`, and the
pagination `BehaviorSubject`s.

## Writing to a resource, and where it stops

`value` is a writable signal. `set()`, `update()` or `value.set()` replace the data locally, and
`status()` then switches to `local` until the next reload. That's what makes optimistic UI simple:
you show the expected result right away, the network call reconciles afterwards.

```typescript
// Local write: the value updates immediately and status() becomes 'local'.
this.cart.update((items) => [...items, product]);

// The persistence itself is a plain HttpClient call, not a resource.
await firstValueFrom(this.http.post('/api/cart', product));
```

That's also the limit of the primitive. `httpResource` is designed for **reading**: it reruns as
soon as its request changes, which makes no sense for a POST triggered once. Writes stay on
`HttpClient`. This portfolio's API seam shows it: `FeedbackApiService` posts a vote and
`ContactApiService` sends a form via `http.post(...)` wrapped in `firstValueFrom` and a `timeout`,
because these are mutations that return fresh server state. A resource wouldn't have brought
anything there.

The rule that follows is clear-cut: a read that depends on signals goes through `resource` or
`httpResource`; a write stays an explicit `HttpClient` call. The [official documentation](https://angular.dev/guide/signals/resource)
covers the full API.

> `resource()` replaces the plumbing, not RxJS. You describe what to load and what it depends on;
> Angular handles the when, the cancellation, and the state. The component goes back to reading
> signals, and mutations keep the one place they've always belonged, a deliberate HTTP call.
