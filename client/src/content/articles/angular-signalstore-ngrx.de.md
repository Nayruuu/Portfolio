Nicht der gesamte Zustand einer App gehört in ein `signal()`, das tief unten in einer Komponente vergraben ist. Sobald ein Zustand von mehreren Stellen aus geteilt, abgeleitet und mutiert wird, möchte man eine klare Grenze: schreibgeschützte Selektoren, Methoden, um ihn weiterzuentwickeln. **NgRx SignalStore** (`@ngrx/signals`) bietet genau das, ohne das Actions/Reducer-Boilerplate des klassischen NgRx.

## Anatomie eines signalStore

Ein Store setzt sich aus verketteten **Features** zusammen. `withState` deklariert den initialen Zustand, `withComputed` die abgeleiteten Werte, `withMethods` die Operationen. Jedes Zustandsfeld wird automatisch zu einem Signal, das auf der Instanz verfügbar ist.

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

Der Zustand wird niemals direkt mutiert: Man verwendet `patchState`, das ein unveränderliches Update anwendet und die betroffenen Signals benachrichtigt.

## Selektoren als Signals

`store.total` und `store.count` sind keine Funktionen, die im Service aufgerufen werden: Sie sind `computed`, also vollwertige Signals. In einer Komponente liest man sie wie jedes andere Signal, und die zoneless Change Detection rendert nur das neu, was von ihnen abhängt.

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

### Komposition mit asynchronen Aufrufen

`withMethods` kann `rxMethod` (aus `@ngrx/signals/rxjs-interop`) einbinden, um einen RxJS-Stream anzubinden, oder einfach `async`/`await` für einen `fetch`. Die Orchestrierungslogik bleibt im Store, die Komponente bleibt eine View. Hier platziert man auch einen `loading`-Zustand für ein Stale-While-Revalidate-Pattern.

## Store oder einfaches Signal?

Nicht alles braucht einen Store. Ein **lokaler** Zustand einer Komponente — ein aktiver Tab, das Öffnen eines Menüs — bleibt ein privates `signal()`: Ein Store würde hier nur unnötige Indirektion hinzufügen. Der SignalStore ist sinnvoll, wenn der Zustand:

- zwischen mehreren Komponenten oder Routen **geteilt** wird;
- von mehreren `computed` **abgeleitet** wird, die man zentralisieren möchte;
- durch Operationen **mutiert** wird, die man isoliert testen möchte.

Die praktische Regel: Beginne mit lokalen Signals, extrahiere einen Store, wenn du denselben Zustand in eine zweite Komponente kopierst. Die Dokumentation behandelt jedes Feature im [SignalStore-Leitfaden](https://ngrx.io/guide/signals/signal-store).

> Der SignalStore ist nicht das NgRx „Actions überall" von gestern. Es ist eine Signal-Fassade:
> schreibgeschützt als Ausgabe, Methoden als Eingabe, kein Reducer. Man behält die Disziplin
> eines Stores, ohne dessen Zeremoniell zu bezahlen.
