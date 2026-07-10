Cargar datos asíncronos fue durante mucho tiempo sinónimo de `subscribe()` manual, de gestión
de estado a mano (`loading`, `error`, `data`) y de fugas de memoria cuando se olvidaba un
`unsubscribe`. Desde Angular 21, `resource()` y `httpResource()` encapsulan todo eso en
una primitiva reactiva construida sobre **signals**.

## El modelo resource()

Un `resource()` une una **petición** reactiva a un **loader** asíncrono. Cuando un signal leído
en `params` cambia, Angular relanza automáticamente el loader y cancela la petición en vuelo
mediante un `AbortSignal`. El resultado es un objeto de signals: `value()`, `error()`,
`status()`, más `isLoading()`.

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

Cambiar `userId` es suficiente: sin `subscribe`, sin `takeUntilDestroyed`. El `resource`
recarga, expone `isLoading()` durante la llamada y cancela la petición anterior.

## httpResource para llamadas REST

`httpResource()` es la variante diseñada para `HttpClient`: atraviesa los interceptores,
gestiona el tipado de la respuesta y reacciona a los cambios de URL. Se le pasa una función que
devuelve la URL (o un objeto de petición completo) derivada de signals.

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

En el template, se consumen los estados directamente, sin pipe `async`:

```typescript
@if (articles.isLoading()) {
  <p>Cargando…</p>
} @else if (articles.error()) {
  <p>Error al cargar.</p>
} @else {
  @for (article of articles.value(); track article.id) {
    <h3>{{ article.title }}</h3>
  }
}
```

### Los estados y sus trampas

`status()` devuelve un valor entre `idle`, `loading`, `reloading`, `resolved`, `error` y
`local`. Dos sutilezas merecen atención:

- durante una **recarga**, `value()` conserva el dato anterior (`reloading`), lo que evita
  una pantalla en blanco — práctico para un patrón stale-while-revalidate.
- `httpResource` está pensado para **lectura** (GET). Para un POST/PUT, se sigue usando
  `HttpClient` clásico: un resource se relanza en cuanto cambia su petición, lo que no tiene
  sentido para una mutación.

## Por qué abandonar las suscripciones manuales

El código RxJS imperativo mezcla tres preocupaciones: disparar la llamada, mapear el flujo
y limpiar. Con `resource`, la **dependencia** se vuelve declarativa — el loader se relanza
porque un signal cambió, punto. Se eliminan los `BehaviorSubject` de paginación, los
`switchMap` defensivos y los `finalize` para volver a poner `loading` en `false`. La documentación oficial
detalla la API en la [guía async con resource](https://angular.dev/guide/signals/resource).

> `resource()` no reemplaza RxJS: reemplaza la **fontanería**. Describes qué cargar y
> de qué depende; Angular se encarga del cuándo, de la cancelación y del estado. El componente
> vuelve a ser una simple lectura de signals.
