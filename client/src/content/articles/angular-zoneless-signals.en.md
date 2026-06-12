For years, Angular relied on **zone.js** to know when to re-run change detection: a monkey
patch over every async browser API. It works, but it's an expensive black box. Since Angular
21, you can drop it entirely with `provideZonelessChangeDetection()` and let **signals**
drive reactivity instead.

## Why ditch zone.js

zone.js intercepts `setTimeout`, promises, DOM events, and triggers a **global** detection
cycle every time. On a large app, you re-check thousands of bindings when only three
changed. Zoneless flips the logic: **nothing** re-renders until a signal read in the template
has notified its change.

- lighter bundle: you remove a ~100 kB dependency
- readable stack traces: no more `zone.run` frames everywhere
- targeted detection: only the components that depend on the changed signal get marked

## Enabling zoneless

It all happens in the application config. You remove `provideZoneChangeDetection` and wire
the zoneless provider:

```typescript
import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
  ],
});
```

### Thinking in fine-grained reactivity

Once zoneless, **all state must be a signal** or the template stops updating. You replace
mutable fields with `signal()`, derived values with `computed()`, and side effects with
`effect()`:

```typescript
@Component({
  selector: 'app-cart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `Total: {{ total() }} €`,
})
export class CartComponent {
  protected readonly items = signal<CartItem[]>([]);
  protected readonly total = computed(() =>
    this.items().reduce((sum, item) => sum + item.price * item.quantity, 0),
  );
}
```

## Gotchas to know

Legacy code that does `setTimeout(() => this.value = x)` **without** going through a signal
will no longer refresh the view. Same for RxJS subscriptions: you either use `toSignal()` or
call `signal.set()` inside the `subscribe`. On the test side, switch Vitest to zoneless and
replace `fakeAsync`/`tick` with `await fixture.whenStable()`. The official docs cover each
case in the [zoneless guide](https://angular.dev/guide/zoneless).

> Zoneless doesn't magically make an app faster. It makes reactivity **explicit**: you know
> exactly why something re-renders, and that's what changes everything when debugging.
