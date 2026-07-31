Nicht der gesamte Zustand einer App passt in ein einzelnes `signal()`, das irgendwo tief in einer
Komponente vergraben ist. Sobald ein Zustand von mehreren Stellen aus geteilt, abgeleitet und
verändert wird, braucht man eine klare Grenze: schreibgeschützte Selektoren zum Lesen, Methoden,
um ihn weiterzuentwickeln. **NgRx SignalStore** (`@ngrx/signals`) bietet genau das, ohne das
Boilerplate der Actions/Reducer des klassischen NgRx.

## Anatomie eines signalStore

Ein Store besteht aus verketteten **Features**. `withState` deklariert den initialen Zustand,
`withComputed` die abgeleiteten Werte, `withMethods` die Operationen. Jedes Zustandsfeld wird
automatisch zu einem Signal, das auf der Instanz exponiert wird.

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

Der Zustand wird nie direkt verändert: Man geht über `patchState`, das ein unveränderliches
Update anwendet und die betroffenen Signals benachrichtigt.

## Selektoren, die Signals sind

`store.total` und `store.count` sind `computed`, also vollwertige Signals, keine
Service-Funktionen, die man aufrufen muss. In einer Komponente liest man sie wie jedes andere
Signal, und die zonenlose Change Detection rendert nur das neu, was davon abhängt.

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

### Mit asynchronen Aufrufen komponieren

`withMethods` kann `rxMethod` (aus `@ngrx/signals/rxjs-interop`) einbinden, um einen RxJS-Flow
anzuschließen, oder einfach `async`/`await` für einen `fetch`. Man behält die
Orchestrierungslogik im Store, die Komponente bleibt eine View. Hier setzt man auch einen
`loading`-Zustand für ein Stale-while-revalidate-Pattern.

## Store oder einfaches Signal?

Nicht alles braucht einen Store. Ein **lokaler** Zustand einer Komponente (ein aktiver Tab, das
Öffnen eines Menüs) bleibt ein privates `signal()`: Ein Store würde hier nur unnötige
Indirektion hinzufügen. Der SignalStore rechtfertigt sich, wenn der Zustand:

- **geteilt** wird zwischen mehreren Komponenten oder Routen;
- **abgeleitet** wird von mehreren `computed`, die man zentralisieren will;
- **verändert** wird durch Operationen, die man isoliert testen will.

Die praktische Regel: Beginne mit lokalen Signals, extrahiere einen Store an dem Tag, an dem du
denselben Zustand in eine zweite Komponente kopierst. Die Doku deckt jedes Feature im
[SignalStore-Guide](https://ngrx.io/guide/signals/signal-store) ab.

> Der SignalStore ist eine Fassade aus Signals: schreibgeschützt beim Auslesen, Methoden beim
> Verändern, null Reducer. Man behält die Disziplin eines Stores ohne das Zeremoniell des
> „Actions überall“-NgRx von gestern.
