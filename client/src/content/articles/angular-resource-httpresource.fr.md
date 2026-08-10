Charger des données asynchrones en Angular a longtemps voulu dire un `subscribe()` manuel, un
triplet d'état tenu à la main (`loading`, `error`, `value`) et une fuite mémoire dès qu'un
`unsubscribe` manquait. Angular 21 range cette plomberie derrière deux primitives réactives
bâties sur les **signals** : `resource()` et sa variante HTTP `httpResource()`.

## Le modèle resource()

Un `resource()` lie une fonction `params` réactive à un `loader` asynchrone. `params` retourne
la requête à exécuter ; le `loader` la transforme en donnée. Dès qu'un signal lu dans `params`
change, Angular relance le `loader` et annule l'appel encore en vol.

Le `loader` reçoit trois choses : les `params` résolus, un `abortSignal`, et `previous` (le
statut du chargement précédent). L'`abortSignal` est le point clé : câblé sur le `fetch`, il
coupe la requête obsolète au lieu de la laisser courir.

```typescript
import { resource, signal } from '@angular/core';

export class UserCard {
  private readonly userId = signal(1);

  protected readonly user = resource({
    params: () => ({ id: this.userId() }),
    loader: ({ params, abortSignal }) =>
      // The fetch option is `signal`, not `abortSignal`: wiring it lets a stale request abort.
      fetch(`/api/users/${params.id}`, { signal: abortSignal }).then((response) =>
        response.json(),
      ),
  });

  protected next(): void {
    this.userId.update((id) => id + 1);
  }
}
```

Changer `userId` suffit : pas de `subscribe`, pas de `takeUntilDestroyed`. Le resource recharge,
expose `isLoading()` pendant l'appel, et abandonne la requête précédente. Le résultat est un objet
de signals à lire : `value()`, `error()`, `status()`, `isLoading()`.

## httpResource pour les appels REST

`httpResource()` est la variante taillée pour `HttpClient` : elle passe par les intercepteurs,
type la réponse et réagit aux changements d'URL. On lui donne une fonction qui retourne l'URL, ou
un objet de requête complet, dérivés de signals.

Une contrainte concrète : `httpResource` s'appuie sur le backend `fetch`, donc il faut
`provideHttpClient(withFetch())` à la racine. Ce portfolio l'active déjà dans `app.config.ts`,
même s'il n'appelle pas encore `httpResource` lui-même (ses écritures restent sur `HttpClient`,
voir plus bas). Si la fonction de requête retourne `undefined`, aucun appel n'est déclenché, ce
qui donne un fetch conditionnel sans `*ngIf` ni garde manuelle.

```typescript
import { httpResource } from '@angular/common/http';
import { signal } from '@angular/core';

export class ArticleList {
  protected readonly tag = signal<string | undefined>(undefined);

  // Re-fetches whenever tag() changes; interceptors and response typing still apply.
  protected readonly articles = httpResource<Article[]>(() => ({
    url: '/api/articles',
    params: this.tag() ? { tag: this.tag() } : {},
  }));
}
```

L'option `parse` mérite d'être connue : elle reçoit la réponse brute et retourne le type final,
ce qui permet de valider le contrat serveur avec un schéma runtime (Zod, par exemple) au lieu de
faire confiance à un `as`. La réponse est vérifiée à l'exécution, pas seulement typée à la
compilation.

Par défaut la réponse est parsée en JSON. Pour un autre format, `httpResource.text()`,
`.blob()` et `.arrayBuffer()` exposent la même mécanique réactive sur du texte ou du binaire. Et
`defaultValue` fixe ce que renvoie `value()` avant le premier chargement : passer `[]` ici évite la
branche `idle` dans le template, la liste part vide puis se remplit.

Dans le template, on consomme les états directement, sans pipe `async` :

```html
@if (articles.isLoading()) {
  <p>Chargement…</p>
} @else if (articles.error()) {
  <p>Échec du chargement.</p>
} @else {
  @for (article of articles.value(); track article.id) {
    <h3>{{ article.title }}</h3>
  }
}
```

## Les états, et ce qu'ils gardent en mémoire

`status()` renvoie une valeur parmi `idle`, `loading`, `reloading`, `resolved`, `error` et
`local`. Quelques détails changent la façon d'écrire un composant.

Pendant un rechargement, `value()` conserve l'ancienne donnée et `status()` passe à `reloading`
plutôt qu'à `loading`. L'écran ne se vide pas : on affiche la donnée périmée, la fraîche la
remplace quand elle arrive. C'est du stale-while-revalidate sans code supplémentaire.

`hasValue()` est un garde de type. Dans une branche `@if (user.hasValue())`, TypeScript sait que
`value()` n'est plus `undefined`, ce qui évite le `?.` défensif qui se glisse partout quand la
valeur peut manquer.

L'option `equal` complète le tableau : elle compare l'ancienne et la nouvelle donnée, et si elles
sont jugées égales, le signal ne notifie pas ses lecteurs. Un rechargement qui renvoie une réponse
identique ne relance alors aucun rendu inutile en aval.

## Recharger et annuler

`reload()` force un nouvel appel sans changer les `params`, pour un bouton « rafraîchir » ou une
invalidation après une action. Il retourne un booléen : `false` si le resource est déjà en train
de charger.

L'annulation résout une classe de bugs discrets. Avec un `switchMap`, on annulait manuellement la
souscription précédente pour qu'une réponse lente et périmée n'écrase pas une réponse récente. Le
resource fait ça par construction : quand `params` change, l'`abortSignal` de l'appel en cours se
déclenche. La course où une vieille réponse arrive après la nouvelle n'existe plus, et on supprime
au passage les `switchMap` défensifs, les `finalize` qui remettent `loading` à `false`, et les
`BehaviorSubject` de pagination.

## Écrire dans un resource, et où il s'arrête

`value` est un signal accessible en écriture. `set()`, `update()` ou `value.set()` remplacent la
donnée localement, et `status()` bascule alors sur `local` jusqu'au prochain rechargement. C'est
ce qui rend l'optimistic UI simple : on affiche le résultat attendu tout de suite, l'appel réseau
réconcilie ensuite.

```typescript
// Local write: the value updates immediately and status() becomes 'local'.
this.cart.update((items) => [...items, product]);

// The persistence itself is a plain HttpClient call, not a resource.
await firstValueFrom(this.http.post('/api/cart', product));
```

C'est aussi la limite de la primitive. `httpResource` est pensé pour la **lecture** : il se
relance dès que sa requête change, ce qui n'a aucun sens pour un POST déclenché une fois. Les
écritures restent sur `HttpClient`. Le seam API de ce portfolio le montre : `FeedbackApiService`
poste un vote et `ContactApiService` envoie un formulaire via `http.post(...)` enveloppé dans
`firstValueFrom` et un `timeout`, parce que ce sont des mutations qui renvoient l'état serveur
frais. Un resource n'aurait rien apporté là.

La règle qui en découle est nette : une lecture qui dépend de signals passe par `resource` ou
`httpResource` ; une écriture reste un appel `HttpClient` explicite. La [documentation officielle](https://angular.dev/guide/signals/resource)
détaille l'API complète.

> `resource()` remplace la plomberie, pas RxJS. On décrit quoi charger et de quoi ça dépend ;
> Angular gère le quand, l'annulation et l'état. Le composant redevient une lecture de signals, et
> les mutations gardent le seul endroit où elles ont toujours eu leur place, un appel HTTP assumé.
