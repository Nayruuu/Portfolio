Cargar datos asíncronos en Angular ha significado durante mucho tiempo un `subscribe()` manual, un
triplete de estado gestionado a mano (`loading`, `error`, `value`) y una fuga de memoria en cuanto
faltaba un `unsubscribe`. Angular 21 ordena esta plomería detrás de dos primitivas reactivas
construidas sobre los **signals**: `resource()` y su variante HTTP `httpResource()`.

## El modelo resource()

Un `resource()` vincula una función `params` reactiva a un `loader` asíncrono. `params` retorna
la solicitud a ejecutar; el `loader` la transforma en dato. En cuanto un signal leído en `params`
cambia, Angular relanza el `loader` y cancela la llamada aún en vuelo.

El `loader` recibe tres cosas: los `params` resueltos, un `abortSignal`, y `previous` (el
estado de la carga anterior). El `abortSignal` es el punto clave: cableado sobre el `fetch`,
corta la solicitud obsoleta en lugar de dejarla correr.

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

Basta con cambiar `userId`: sin `subscribe`, sin `takeUntilDestroyed`. El resource recarga,
expone `isLoading()` durante la llamada, y abandona la solicitud anterior. El resultado es un
objeto de signals a leer: `value()`, `error()`, `status()`, `isLoading()`.

## httpResource para las llamadas REST

`httpResource()` es la variante hecha a medida para `HttpClient`: pasa por los interceptores,
tipa la respuesta y reacciona a los cambios de URL. Se le da una función que retorna la URL, o
un objeto de solicitud completo, derivados de signals.

Una restricción concreta: `httpResource` se apoya en el backend `fetch`, así que hace falta
`provideHttpClient(withFetch())` en la raíz. Este portfolio ya lo activa en `app.config.ts`,
aunque todavía no llama a `httpResource` en sí mismo (sus escrituras siguen en `HttpClient`,
ver más abajo). Si la función de solicitud retorna `undefined`, no se dispara ninguna llamada,
lo que da un fetch condicional sin `*ngIf` ni guardia manual.

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

La opción `parse` merece conocerse: recibe la respuesta bruta y retorna el tipo final,
lo que permite validar el contrato del servidor con un esquema en runtime (Zod, por ejemplo) en
lugar de confiar en un `as`. La respuesta se verifica en ejecución, no solo se tipa en la
compilación.

Por defecto la respuesta se parsea como JSON. Para otro formato, `httpResource.text()`,
`.blob()` y `.arrayBuffer()` exponen la misma mecánica reactiva sobre texto o binario. Y
`defaultValue` fija lo que retorna `value()` antes de la primera carga: pasar `[]` aquí evita la
rama `idle` en la plantilla, la lista parte vacía y luego se llena.

En la plantilla, se consumen los estados directamente, sin pipe `async`:

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

## Los estados, y lo que conservan en memoria

`status()` retorna un valor entre `idle`, `loading`, `reloading`, `resolved`, `error` y
`local`. Algunos detalles cambian la forma de escribir un componente.

Durante una recarga, `value()` conserva el dato anterior y `status()` pasa a `reloading`
en lugar de `loading`. La pantalla no se vacía: se muestra el dato caducado, el fresco lo
reemplaza cuando llega. Es stale-while-revalidate sin código adicional.

`hasValue()` es una guardia de tipo. En una rama `@if (user.hasValue())`, TypeScript sabe que
`value()` ya no es `undefined`, lo que evita el `?.` defensivo que se cuela por todas partes
cuando el valor puede faltar.

La opción `equal` completa el cuadro: compara el dato anterior y el nuevo, y si se consideran
iguales, el signal no notifica a sus lectores. Una recarga que retorna una respuesta idéntica
no relanza entonces ningún renderizado inútil en cascada.

## Recargar y cancelar

`reload()` fuerza una nueva llamada sin cambiar los `params`, para un botón «actualizar» o una
invalidación tras una acción. Retorna un booleano: `false` si el resource ya está cargando.

La cancelación resuelve una clase de errores sutiles. Con un `switchMap`, se cancelaba
manualmente la suscripción anterior para que una respuesta lenta y caducada no sobrescribiera una
respuesta reciente. El resource hace eso por construcción: cuando `params` cambia, el
`abortSignal` de la llamada en curso se dispara. La carrera donde una respuesta vieja llega
después de la nueva ya no existe, y de paso se suprimen los `switchMap` defensivos, los
`finalize` que devuelven `loading` a `false`, y los `BehaviorSubject` de paginación.

## Escribir en un resource, y dónde se detiene

`value` es un signal accesible en escritura. `set()`, `update()` o `value.set()` reemplazan el
dato localmente, y `status()` entonces pasa a `local` hasta la próxima recarga. Es lo que hace
simple el optimistic UI: se muestra el resultado esperado de inmediato, la llamada de red
reconcilia después.

```typescript
// Local write: the value updates immediately and status() becomes 'local'.
this.cart.update((items) => [...items, product]);

// The persistence itself is a plain HttpClient call, not a resource.
await firstValueFrom(this.http.post('/api/cart', product));
```

Es también el límite de la primitiva. `httpResource` está pensado para la **lectura**: se
relanza en cuanto su solicitud cambia, lo que no tiene sentido para un POST disparado una sola
vez. Las escrituras siguen en `HttpClient`. El seam API de este portfolio lo muestra:
`FeedbackApiService` publica un voto y `ContactApiService` envía un formulario vía
`http.post(...)` envuelto en `firstValueFrom` y un `timeout`, porque son mutaciones que retornan
el estado del servidor recién actualizado. Un resource no habría aportado nada ahí.

La regla que se desprende es clara: una lectura que depende de signals pasa por `resource` o
`httpResource`; una escritura sigue siendo una llamada `HttpClient` explícita. La [documentación oficial](https://angular.dev/guide/signals/resource)
detalla la API completa.

> `resource()` reemplaza la plomería, no RxJS. Se describe qué cargar y de qué depende;
> Angular gestiona el cuándo, la cancelación y el estado. El componente vuelve a ser una lectura
> de signals, y las mutaciones conservan el único lugar donde siempre tuvieron su sitio, una
> llamada HTTP asumida.
