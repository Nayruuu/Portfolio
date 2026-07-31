An app's whole state doesn't fit in a single `signal()` buried inside a component. Once
state is shared, derived, and mutated from multiple places, you want a clear boundary:
read-only selectors, methods to make it evolve. **NgRx SignalStore**
(`@ngrx/signals`) offers exactly that, without the boilerplate of actions/reducers from classic
NgRx.

## Anatomy of a signalStore

A store is made up of chained **features**. `withState` declares the initial state,
`withComputed` the derived values, `withMethods` the operations. Each state field automatically
becomes a signal exposed on the instance.

```typescript
import { signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { computed } from '@angular/core';

export const CartStore = signalStore(
  { providedIn: 'root' },
  withState<{ items: CartItem[] }>({ items: [] }),
  withComputed(({ items }) => ({
    total: computed(() => items().reduce((sum, item) => sum + item.price * item.quantity, 0)),
    count: computed(() => items().length),
  })),
  withMethods((store) => ({
    add(item: CartItem): void {
      patchState(store, { items: [...store.items(), item] });
    },
    clear(): void {
      patchState(store, { items: [] });
    },
  })),
);
```

State is never mutated directly: you go through `patchState`, which applies an immutable
update and notifies the relevant signals.

## Selectors that are signals

`store.total` and `store.count` are `computed`, so full-fledged signals, not service
functions to call. In a component, you read them like any other signal, and
zoneless change detection only re-renders what depends on them.

```typescript
export class CartBadge {
  private readonly store = inject(CartStore);

  protected readonly count = this.store.count;
  protected readonly total = this.store.total;

  protected checkout(): void {
    this.store.clear();
  }
}
```

### Composing with async calls

`withMethods` can integrate `rxMethod` (from `@ngrx/signals/rxjs-interop`) to wire in an
RxJS stream, or simply `async`/`await` for a `fetch`. You keep the orchestration logic
in the store, the component stays a view. This is also where you set a `loading` state for a
stale-while-revalidate pattern.

## Store or plain signal?

Not everything needs a store. State that's **local** to a component (an active tab, a menu
being open) stays a private `signal()`: a store would add unnecessary indirection there. The
SignalStore is justified when the state is:

- **shared** across multiple components or routes;
- **derived** by several `computed` you want to centralize;
- **mutated** by operations you want to test in isolation.

The practical rule: start with local signals, extract a store the day you copy the
same state into a second component. The docs cover every feature in the
[SignalStore guide](https://ngrx.io/guide/signals/signal-store).

> The SignalStore is a signals facade: read-only on the way out, methods on the way in, zero
> reducers. You keep the discipline of a store without the ceremony of yesterday's
> "actions everywhere" classic NgRx.
