No todo el estado de una app cabe en un `signal()` perdido en el fondo de un componente. En
cuanto un estado se comparte, se deriva y se muta desde varios lugares, se quiere una frontera
clara: selectores de solo lectura, métodos para hacerlo evolucionar. **NgRx SignalStore**
(`@ngrx/signals`) ofrece exactamente eso, sin el boilerplate de las actions/reducers del NgRx
clásico.

## Anatomía de un signalStore

Un store se compone de **features** encadenadas. `withState` declara el estado inicial,
`withComputed` los valores derivados, `withMethods` las operaciones. Cada campo de estado se
convierte automáticamente en un signal expuesto en la instancia.

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

El estado nunca se muta directamente: se pasa por `patchState`, que aplica una actualización
inmutable y notifica a los signals implicados.

## Selectores que son signals

`store.total` y `store.count` no son funciones que se llaman en el servicio: son
`computed`, es decir, signals de pleno derecho. En un componente, se leen como
cualquier signal, y el change detection zoneless solo re-renderiza lo que depende de ellos.

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

### Componer con llamadas async

`withMethods` puede integrar `rxMethod` (desde `@ngrx/signals/rxjs-interop`) para conectar un
flujo RxJS, o simplemente `async`/`await` para un `fetch`. Se mantiene la lógica de orquestación
en el store, el componente permanece como una vista. También es aquí donde se añade un estado
`loading` para un patrón stale-while-revalidate.

## ¿Store o simple signal?

No todo necesita un store. Un estado **local** a un componente — una pestaña activa, la apertura
de un menú — sigue siendo un `signal()` privado: un store añadiría indirección innecesaria. El
SignalStore se justifica cuando el estado es:

- **compartido** entre varios componentes o rutas;
- **derivado** por varios `computed` que se quieren centralizar;
- **mutado** por operaciones que se quieren probar en aislamiento.

La regla práctica: empieza con signals locales, extrae un store el día en que copies el
mismo estado en un segundo componente. La documentación cubre cada feature en la
[guía SignalStore](https://ngrx.io/guide/signals/signal-store).

> El SignalStore no es el NgRx «actions en todas partes» de ayer. Es una fachada de signals:
> solo lectura en salida, métodos en entrada, cero reducers. Mantienes la disciplina de un store
> sin pagar su ceremonial.
