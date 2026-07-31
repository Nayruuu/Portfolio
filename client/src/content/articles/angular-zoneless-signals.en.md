For years, Angular relied on **zone.js** to know when to re-trigger change detection: a
monkey-patch of every asynchronous browser API. It works, but it's an expensive black box.
Since Angular 21, you can do without it entirely with `provideZonelessChangeDetection()` and
let **signals** drive reactivity.

## Why get rid of zone.js

zone.js intercepts `setTimeout`, promises, DOM events, and triggers a **global** detection
cycle every time. On a large app, you end up checking thousands of bindings when only three
actually changed. Zoneless mode flips the logic: **nothing** re-renders until a signal read
in the template has notified its change.

Along the way, the bundle loses a ~100 KB dependency. Stack traces become readable again,
without `zone.run` frames interleaved at every level. And detection becomes targeted: only
the components that depend on the modified signal get marked.

## Enabling zoneless mode

Activation happens in the application configuration. You remove
`provideZoneChangeDetection` and wire in the zoneless provider:

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

Once zoneless, **all state must be a signal** or the template will stop updating. You
replace mutable fields with `signal()`, derived values with `computed()`, and side effects
with `effect()`:

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

## Pitfalls to know about

Legacy code that does `setTimeout(() => this.value = x)` **without** going through a signal
will no longer refresh the view. Same for RxJS subscriptions: you need either `toSignal()`,
or to call `signal.set()` inside the `subscribe`.

On the testing side, you switch Vitest to zoneless and replace `fakeAsync`/`tick` with
`await fixture.whenStable()`. The official docs cover every case in the
[zoneless guide](https://angular.dev/guide/zoneless).

> Zoneless doesn't magically speed up an app. The gain shows up when debugging: reactivity
> has become **explicit**, and you know exactly which signal triggered each re-render of the
> view.
