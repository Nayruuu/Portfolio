El estado completo de una app no cabe en un `signal()` perdido en el fondo de un componente. En cuanto un
estado se comparte, se deriva y se muta desde varios sitios, se necesita una frontera clara:
selectores de solo lectura, métodos para hacerlo evolucionar. **NgRx SignalStore**
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
inmutable y notifica a los signals afectados.

## Selectores que son signals

`store.total` y `store.count` son `computed`, es decir, signals de pleno derecho, no funciones
de servicio que haya que invocar. En un componente, se leen como cualquier signal, y
la detección de cambios zoneless solo re-renderiza lo que depende de ellos.

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
flujo RxJS, o simplemente `async`/`await` para un `fetch`. La lógica de orquestación se mantiene
en el store, y el componente sigue siendo una vista. Es también ahí donde se define un estado
`loading` para un patrón stale-while-revalidate.

## ¿Store o simple signal?

No todo necesita un store. Un estado **local** de un componente (una pestaña activa, la
apertura de un menú) sigue siendo un `signal()` privado: un store añadiría ahí una indirección
innecesaria. El SignalStore se justifica cuando el estado es:

- **compartido** entre varios componentes o rutas;
- **derivado** por varios `computed` que se quieren centralizar;
- **mutado** por operaciones que se quieren testear de forma aislada.

La regla práctica: empieza con signals locales, extrae un store el día en que copies el
mismo estado en un segundo componente. La documentación cubre cada feature en la
[guía de SignalStore](https://ngrx.io/guide/signals/signal-store).

> El SignalStore es una fachada de signals: solo lectura en la salida, métodos en la entrada, cero
> reducers. Mantienes la disciplina de un store sin el ceremonial del NgRx «actions en todas
> partes» de antes.
