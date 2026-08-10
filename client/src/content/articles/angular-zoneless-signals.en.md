This app runs without zone.js. Not behind an experimental flag: the package is
neither in `package.json` nor in `node_modules`, and `angular.json` declares `"polyfills": []`. Change
detection is driven by signals, and by them alone. What follows describes how that's
wired in this portfolio, and the four or five places where the absence of zone genuinely changes the
way code is written.

## What zone.js used to do, and what takes over

zone.js patched every asynchronous browser API (`setTimeout`, promises, DOM
listeners) to notify Angular as soon as a callback finished. On every notification, a
detection cycle restarted from the root and re-checked the entire tree, including components
where nothing had moved.

In zoneless, this monkey-patch disappears. A component is marked for checking when a signal
it reads in its template notifies a change. A few explicit triggers are added on top:
an event handler in the template, a `markForCheck`, an `input()` update.

The consequence is direct. A `setTimeout` that rewrites an ordinary field no longer triggers any
refresh. With zone.js, the global tick caught this kind of mutation without anyone thinking about it.
Without it, every source of change has to go through a signal, otherwise the view stays frozen.

It's a stricter contract, but also a more readable one: reactivity stops being a side
effect of the runtime environment and becomes a property of the code itself.

## Activation, a single provider

Everything happens in `app.config.ts`. `provideZonelessChangeDetection()` replaces the old
`provideZoneChangeDetection`, and the rest of the configuration follows that choice.

```typescript
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
  ],
};
```

`withComponentInputBinding()` binds route parameters to components' `input()`: the
`:slug` of the article page arrives directly in an `input.required<string>()`, without manually
reading the snapshot. `provideClientHydration(withEventReplay())` replays events that happened
during hydration, which matters more without zone: nothing is silently absorbing in the background a
click that arrived before the app became interactive.

## The reactive backbone

The whole app reads multilingual content through a single signal. `I18nService` is a thin
facade over an [NgRx](https://ngrx.io/guide/signals) `SignalStore` and exposes only three
read-only signals: `lang`, `content` and `loading`, typed `Signal<Lang>` / `Signal<Content>` /
`Signal<boolean>`. Consumers never depend on the store's internal shape.

The store follows a stale-while-revalidate logic. On startup, a synchronous `peek()` populates the
content (instant first render, compatible with static prerendering), then an asynchronous
`getContent()` revalidates it. A language change is protected by a last-wins policy: if a more
recent language has been requested in the meantime, the older result is discarded.

The DOM side effect lives in a `withHooks` of the store, through an `effect` that reacts to `lang()`:
it persists the preference in `localStorage` and reflects the value on `<html lang="…">`. Nobody
calls this code, it re-runs when the signal changes.

The benefit shows in practice. Changing the language updates `content()`, and every `computed` or
template that reads it recomputes without a single manual subscription.

## Derived state computes itself

The article page illustrates the full chain. The route parameter is an `input`, everything else
flows from it via `computed`:

```typescript
/** Route param `:slug`, bound via withComponentInputBinding. */
protected readonly slug = input.required<string>();

protected readonly article = computed<Article>(() => {
  const articles = this.i18n.content().articles;
  const index = articles.findIndex((a) => a.slug === this.slug());

  return articles[index] ?? articles[0];
});

protected readonly body = computed(() =>
  parseMarkdown(ARTICLE_BODIES[this.article().slug]?.[this.i18n.lang()] ?? ''),
);
```

`article` depends on `slug()` and `content()`; `body` depends on `article()` and `lang()`.
Navigating to another article, or switching languages, recomposes everything without any
synchronization code. `computed` values are memoized: `body` only re-parses the Markdown if the slug or the
language actually changed.

The same principle structures `PlayerService`, which drives the simulated player on the home
page. Playback time (`time`) and the play/pause state (`playing`) are writable signals. The list
of chapters derives from the language via `this.i18n.content().chapters`, the current chapter derives from the
time, and the elapsed time within that chapter derives from both. The template displays `currentChapter()`
and follows automatically, without `ngOnChanges` or a manually triggered recalculation.

Component inputs and outputs are also signals. Player scenes
receive their clock via `input.required<number>()` and their active state via
`input.required<boolean>()`, two values that feed directly into `computed` values. The BSP demo
bubbles its events up to the parent via `output<void>()`. For truly trivial local state, a
service can be reduced to a single line: the nav bar's search is a simple
`public readonly query = signal('')`, written by the nav bar, read by the articles grid.

Every component in the app uses `ChangeDetectionStrategy.OnPush`. In zoneless this is coherent
end to end: a view is only checked when a signal it consumes asks for it.

## An interval driven by a signal

The tricky point of zoneless is imperative asynchronous code. `PlayerService` advances a
playback clock with a `setInterval`, but the `setInterval` lives inside an `effect`
governed by the `playing` signal.

```typescript
constructor() {
  // Drive the tick loop reactively from `playing`.
  effect((onCleanup) => {
    if (!this.playing()) {
      return;
    }
    const intervalId = setInterval(() => {
      const next = this.time() + 0.1 * this.rate();

      this.time.set(next >= this.totalSec() ? 0 : next);
    }, 100);

    onCleanup(() => clearInterval(intervalId));
  });
}
```

When `playing` switches to `false`, the effect re-runs, `onCleanup` runs first, and
`clearInterval` stops the loop. The `rate()` read inside the tick changes the step without rebuilding
anything.

Forgetting this `onCleanup` is the classic trap. The interval would survive the pause, run
several times in parallel after multiple toggles, and leak in tests as well as during
SSR prerendering, where the timer would never have a reason to stop. The `set()` on `time` remains the
only channel through which the tick informs the view: without zone.js, Angular only wakes up on
the signal write, never on the `setInterval` itself.

## When RxJS needs to feed a signal

RxJS still exists in the app, but at the margins, and it never drives a template directly. The
vote bar needs to reload its counters on every navigation between articles: it subscribes to
`router.events` with a `filter` on `NavigationEnd` and a `takeUntilDestroyed()`, then in the
`subscribe` it calls a `load()` that ends with a `this.tally.set(...)`.

The stream serves as the trigger, the signal carries the state. `takeUntilDestroyed()` unsubscribes on
component destruction without a manual `ngOnDestroy`. The `toSignal()` API would build the same bridge in a
declarative way, but this portfolio never needed it: here, the rare streams boil down to a
`set()` inside the `subscribe`.

## The rule that prevents drift

"Everything is a signal" is easy to say and easy to betray: all it takes is one developer writing
`public loading = false` out of habit. A homegrown ESLint rule, `local/prefer-signal-primitives`,
keeps the discipline.

It inspects every public field whose type or initial value is primitive (boolean,
string, number, `bigint`, literal, or union of primitives) and flags an error if it isn't
initialized with `signal()`, `computed()`, `model()` or `input()`. The message is explicit:
`Public primitive field '{{name}}' should be a signal`. It's wired at `error` level for every
`src/app/**/*.ts` file, specs excluded.

The effect is that an exposed state field left as a mutable primitive no longer compiles under lint. The
convention doesn't depend on everyone's vigilance; it's checked on every build.

## Testing when there's no more zone

Without zone.js, there's no more `fakeAsync` or `tick()`: the project doesn't contain a single occurrence. Two
patterns replace them, described in the [zoneless guide](https://angular.dev/guide/zoneless).

For a component, you act, then wait for stability:
`await fixture.whenStable()` after an interaction, before asserting on the DOM. About twenty
component specs follow this pattern.

For `PlayerService`'s clock, change detection must be driven by hand. You force Vitest's
fake timers, flush the effect with `ApplicationRef.tick()` (which schedules the
`setInterval`), then advance time.

```typescript
it('the tick advances while playing, and onCleanup stops it on pause', () => {
  vi.useFakeTimers();
  const svc = TestBed.inject(PlayerService);
  const appRef = TestBed.inject(ApplicationRef);

  appRef.tick(); // flush the effect → schedules setInterval
  const before = svc.time();

  vi.advanceTimersByTime(100);
  expect(svc.time()).toBeCloseTo(before + 0.1, 5);

  svc.pause();
  appRef.tick(); // effect re-runs → onCleanup clears the interval
  const afterPause = svc.time();

  vi.advanceTimersByTime(1000);
  expect(svc.time()).toBe(afterPause);
});
```

The test checks both halves of the contract: the clock advances by 0.1 per hundred milliseconds while
playing, and after `pause()` plus `appRef.tick()`, advancing a full second no longer moves the
time. `onCleanup` did indeed cut the interval. This is zoneless code tested the way it runs: the
changes are explicit, you choose when they happen.

> Zoneless doesn't make the app faster by magic. What it changes is traceability:
> every redraw traces back to a specific signal, and a lint rule prevents state from escaping
> outside that model.
