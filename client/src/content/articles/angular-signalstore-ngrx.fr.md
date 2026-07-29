Tout l'état d'une app ne tient pas dans un `signal()` perdu au fond d'un composant. Dès qu'un
état est partagé, dérivé et muté depuis plusieurs endroits, on veut une frontière claire :
des sélecteurs en lecture seule, des méthodes pour le faire évoluer. **NgRx SignalStore**
(`@ngrx/signals`) offre exactement ça, sans le boilerplate des actions/reducers du NgRx
classique.

## Anatomie d'un signalStore

Un store se compose de **features** chaînées. `withState` déclare l'état initial,
`withComputed` les valeurs dérivées, `withMethods` les opérations. Chaque champ d'état devient
automatiquement un signal exposé sur l'instance.

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

L'état n'est jamais muté directement : on passe par `patchState`, qui applique une mise à jour
immuable et notifie les signals concernés.

## Des sélecteurs qui sont des signals

`store.total` et `store.count` ne sont pas des fonctions à appeler dans le service : ce sont
des `computed`, donc des signals à part entière. Dans un composant, on les lit comme
n'importe quel signal, et le change detection zoneless ne re-rend que ce qui en dépend.

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

### Composer avec des appels async

`withMethods` peut intégrer `rxMethod` (depuis `@ngrx/signals/rxjs-interop`) pour brancher un
flux RxJS, ou simplement `async`/`await` pour un `fetch`. On garde la logique d'orchestration
dans le store, le composant reste une vue. C'est aussi là qu'on pose un état `loading` pour un
pattern stale-while-revalidate.

## Store ou simple signal ?

Tout n'a pas besoin d'un store. Un état **local** à un composant — un onglet actif, l'ouverture
d'un menu — reste un `signal()` privé : un store y ajouterait de l'indirection inutile. Le
SignalStore se justifie quand l'état est :

- **partagé** entre plusieurs composants ou routes ;
- **dérivé** par plusieurs `computed` qu'on veut centraliser ;
- **muté** par des opérations qu'on veut tester en isolation.

La règle pratique : commence avec des signals locaux, extrais un store le jour où tu copies le
même état dans un deuxième composant. La doc couvre chaque feature dans le
[guide SignalStore](https://ngrx.io/guide/signals/signal-store).

> Le SignalStore n'est pas le NgRx « actions partout » d'hier. C'est une façade de signals :
> lecture seule en sortie, méthodes en entrée, zéro reducer. Tu gardes la discipline d'un store
> sans payer son cérémonial.
