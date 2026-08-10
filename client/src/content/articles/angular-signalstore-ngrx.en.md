This app has only one store. All the rest of its state lives in local `signal()`s, deep in the
components that own them. The store exists for the one piece of data that escapes a single
component: the active language and the content tree it resolves.

This data is read everywhere (every title, every label, every breadcrumb consults it), derived by
views that recompute from it, and mutated from two places (the route resolver and startup). That's
the job description of a store. **NgRx SignalStore** (`@ngrx/signals`) fills it without classic
NgRx's actions or reducers: read-only signals out, methods in.

## Composing features

A `signalStore` is assembled from chained features. `withState` declares the shape and initial
state, `withComputed` the derived values, `withMethods` the operations. Every state field becomes
a signal exposed on the instance: declaring `lang` produces `store.lang`, a `Signal<Lang>` that any
component can read.

The content store holds three fields: `lang`, `content`, `loading`.

State is never mutated directly. You go through `patchState`, which applies an immutable update
and only notifies signals whose value actually changed. `loading` can flip without re-rendering
anything that depends on `content`.

This particular store doesn't use `withComputed`. Its derived values (a page title, a breadcrumb, a
filtered list of articles) are specific to each screen, so they live in the components that
display them, not in shared state. The rule that emerges: only centralize what several views
derive identically.

## Building state in an injection context

`withState` accepts two forms: a literal object, or a factory that returns one. The factory runs
in the store's injection context, which lets it `inject()` a service and read `localStorage` at
construction time.

```typescript
export const ContentStore = signalStore(
  { providedIn: 'root' },
  withState<ContentState>(() => {
    const lang = readInitialLang();

    // Seed content synchronously so first paint + prerender already have the right locale.
    return { lang, content: inject(ContentApiService).peek(lang), loading: false };
  }),
  // withMethods / withHooks below
);
```

`readInitialLang` reads the persisted preference, validates it as a `Lang`, and falls back to the
default language if `localStorage` is unavailable or throws. Deliberately, there's no sniffing of
`navigator.language`: native prerendering and tests start on a deterministic language, never on
that of the build machine. It's a choice that costs something elsewhere (a first SSG render always
in French) but keeps static generation reproducible.

## Stale-while-revalidate, concretely

The store displays a known value right away, then goes and checks behind it. Two methods of the
content service carry this contract.

`peek(lang)` returns the cached value synchronously: it's what seeds the state, so that the first
render and static generation already have content. `getContent(lang)` does the asynchronous fetch,
the real network call eventually.

Today this service is a mock over the content bundled into the app. It's the only seam between the
app and "where content comes from": the day a .NET API serves the locales, it's the only file that
changes.

```typescript
export const FETCH_DELAY_MS = 300;

public peek(lang: Lang): Content {
  return this.bundled[lang];
}

public getContent(lang: Lang): Promise<Content> {
  // Mock: a real client would fetch(this.contentUrl(lang)); we serve bundled content after a delay.
  return new Promise((resolve) => setTimeout(() => resolve(this.peek(lang)), FETCH_DELAY_MS));
}
```

On a language change, `setLang` first swaps the content via `peek` (synchronous, so the next
render is already in the right locale), then kicks off revalidation. The `loading` flag flips to
`true` for the duration of the fetch, which lets a view show a loading state during the switch.

The `bundled` dictionary is typed `Record<Lang, Content>`. Adding a language to the `LANG` value
set no longer compiles until its bundle is wired in here. The compiler keeps the list up to date.

## Cancelling a stale result

As soon as a method is asynchronous, two calls can overlap. A visitor switches to English, then to
German before the English call has come back. Without a guard, the English result would arrive
last and overwrite German.

`reload` protects itself with a last-wins check: before applying a result, it verifies that the
current language is still the one it requested.

```typescript
const reload = async (lang: Lang): Promise<void> => {
  patchState(store, { loading: true });
  const content = await api.getContent(lang);

  // Last-wins: a newer language switch has moved store.lang() on; drop this stale result.
  if (store.lang() === lang) {
    patchState(store, { content, loading: false });
  }
};
```

A test locks this behavior in: it fires a `reload('en')` while the store stays on `fr`, advances
simulated time by `FETCH_DELAY_MS`, and checks that the final content is still `FR`. The English
result is indeed dropped.

## An effect inside the store

`withHooks` gives the store a lifecycle. Its `onInit` runs in the store's injection context, which
lets it open an `effect`.

```typescript
withHooks({
  onInit(store) {
    const doc = inject(DOCUMENT);

    // Revalidate the seeded content once at startup.
    void store.reload(store.lang());

    // Persist the language and reflect it on <html lang="…"> reactively.
    effect(() => {
      const lang = store.lang();

      try {
        localStorage.setItem(STORAGE_KEYS.LANG, lang);
      } catch {
        /* localStorage unavailable */
      }
      doc.documentElement.setAttribute('lang', lang);
    });
  },
});
```

The effect depends on `store.lang()`. On every change, it re-persists the preference and updates
the `lang` attribute on `<html>`, the one read by screen readers and search engines. The
`localStorage` write is wrapped in a `try` that swallows the error: a full quota shouldn't break
rendering. A test verifies this by making `setItem` throw, making sure the `tick` doesn't throw,
and that `<html lang>` still gets updated.

Since the effect is born in the store's context, it's cleaned up with it. No `Subscription` to
tear down by hand.

## A facade above the store

No component injects `ContentStore` directly. They go through `I18nService`, a facade that only
re-exposes four things: `lang`, `content`, `loading`, `setLang`.

```typescript
@Injectable({ providedIn: 'root' })
export class I18nService {
  public readonly lang: Signal<Lang>;
  public readonly content: Signal<Content>;
  public readonly loading: Signal<boolean>;

  private readonly store = inject(ContentStore);

  constructor() {
    this.lang = this.store.lang;
    this.content = this.store.content;
    this.loading = this.store.loading;
  }

  public setLang(lang: Lang): void {
    this.store.setLang(lang);
  }
}
```

The surface is stable. If the store gains an internal field or changes its feature composition,
the dozens of components that read the language don't move. They depend on a contract, not a
shape.

The language change is triggered by the URL, never by a direct call. The language selector
navigates to the same page with a different prefix (`/fr`, `/en`, …). It's the route resolver that
calls `setLang` from that prefix, before the component renders. The URL remains the sole source of
truth for the language: a shared link to `/de/articles` opens the page in German without any state
needing to be synced by hand.

## The threshold for a store

Not everything needs a store, and this app shows it by having only one. An active tab, a menu
being open: that stays a private `signal()` in the component. Adding a store there would bring
nothing but indirection.

A SignalStore is justified when state ticks the boxes that language ticks here: shared across
several screens, derived by views that recompute from it, mutated by operations you want to test
in isolation. Last-wins, persistence, the synchronous seed each get tested in isolation, without
mounting a component.

In practice: start with local signals, extract a store the day you'd copy the same state into a
second component. The [SignalStore guide](https://ngrx.io/guide/signals/signal-store) details
every feature, `rxMethod` included (which this store doesn't use: an `async`/`await` was enough to
orchestrate a single fetch).

> A SignalStore is a facade of signals: read-only out, methods in, zero reducers. You keep the
> discipline of a store, and its lifecycle, without yesterday's NgRx ceremony of actions.
