Charger des données asynchrones a longtemps été synonyme de `subscribe()` manuel, de gestion
d'état à la main (`loading`, `error`, `data`) et de fuites mémoire quand on oubliait un
`unsubscribe`. Depuis Angular 21, `resource()` et `httpResource()` encapsulent tout ça dans
une primitive réactive bâtie sur les **signals**.

## Le modèle resource()

Un `resource()` lie une **requête** réactive à un **loader** asynchrone. Quand un signal lu
dans le `params` change, Angular relance automatiquement le loader et annule la requête en
vol via un `AbortSignal`. Le résultat est un objet de signals : `value()`, `error()`,
`status()`, plus `isLoading()`.

```typescript
import { resource, signal } from '@angular/core';

export class UserCard {
  private readonly userId = signal(1);

  protected readonly user = resource({
    params: () => ({ id: this.userId() }),
    loader: ({ params, abortSignal }) =>
      fetch(`/api/users/${params.id}`, { abortSignal }).then((response) =>
        response.json(),
      ),
  });

  protected next(): void {
    this.userId.update((id) => id + 1);
  }
}
```

Changer `userId` suffit : pas de `subscribe`, pas de `takeUntilDestroyed`. Le `resource`
recharge, expose `isLoading()` pendant l'appel, et annule la requête précédente.

## httpResource pour les appels REST

`httpResource()` est la variante taillée pour `HttpClient` : elle traverse les intercepteurs,
gère le typage de la réponse et réagit aux changements d'URL. On lui passe une fonction qui
retourne l'URL (ou un objet de requête complet) dérivée de signals.

```typescript
import { httpResource } from '@angular/common/http';
import { signal } from '@angular/core';

export class ArticleList {
  protected readonly tag = signal<string | undefined>(undefined);

  protected readonly articles = httpResource<Article[]>(() => ({
    url: '/api/articles',
    params: this.tag() ? { tag: this.tag() } : {},
  }));
}
```

Dans le template, on consomme les états directement, sans pipe `async` :

```typescript
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

### Les états et leurs pièges

`status()` renvoie une valeur parmi `idle`, `loading`, `reloading`, `resolved`, `error` et
`local`. Deux subtilités méritent l'attention :

- pendant un **rechargement**, `value()` garde l'ancienne donnée (`reloading`), ce qui évite
  un écran blanc — pratique pour un pattern stale-while-revalidate.
- `httpResource` est pensé pour la **lecture** (GET). Pour un POST/PUT, on reste sur
  `HttpClient` classique : un resource se relance dès que sa requête change, ce qui n'a pas
  de sens pour une mutation.

## Pourquoi abandonner les souscriptions manuelles

Le code RxJS impératif mélange trois préoccupations : déclencher l'appel, mapper le flux,
et nettoyer. Avec `resource`, la **dépendance** devient déclarative — le loader se relance
parce qu'un signal a changé, point. On supprime les `BehaviorSubject` de pagination, les
`switchMap` défensifs et les `finalize` pour remettre `loading` à `false`. La doc officielle
détaille l'API dans le [guide async avec resource](https://angular.dev/guide/signals/resource).

> `resource()` ne remplace pas RxJS : il remplace la **plomberie**. Tu décris quoi charger et
> de quoi ça dépend ; Angular s'occupe du quand, de l'annulation et de l'état. Le composant
> redevient une simple lecture de signals.
