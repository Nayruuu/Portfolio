Not all of an app's state belongs in a `signal()` buried at the bottom of a component. As
soon as a piece of state is shared, derived and mutated from several places, you want a clear
boundary: read-only selectors, methods to evolve it. **NgRx SignalStore** (`@ngrx/signals`)
gives you exactly that, without the action/reducer boilerplate of classic NgRx.

## Anatomy of a signalStore

A store is built from chained **features**. `withState` declares the initial state,
`withComputed` the derived values, `withMethods` the operations. Each state field
automatically becomes a signal exposed on the instance.

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
update and notifies the affected signals.

## Selectors that are signals

`store.total` and `store.count` aren't functions you call inside the service: they are
`computed`s, so full-fledged signals. In a component you read them like any other signal, and
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

`withMethods` can integrate `rxMethod` (from `@ngrx/signals/rxjs-interop`) to wire an RxJS
stream, or simply `async`/`await` for a `fetch`. You keep orchestration logic inside the
store, and the component stays a view. That's also where you place a `loading` state for a
stale-while-revalidate pattern.

## Store or plain signal?

Not everything needs a store. State **local** to a component — an active tab, an open menu —
stays a private `signal()`: a store would add pointless indirection. The SignalStore earns
its place when state is:

- **shared** across several components or routes;
- **derived** by several `computed`s you want to centralize;
- **mutated** by operations you want to test in isolation.

The practical rule: start with local signals, extract a store the day you copy the same state
into a second component. The docs cover every feature in the
[SignalStore guide](https://ngrx.io/guide/signals/signal-store).

> The SignalStore isn't yesterday's "actions everywhere" NgRx. It's a façade of signals:
> read-only out, methods in, zero reducers. You keep the discipline of a store without paying
> its ceremony.
