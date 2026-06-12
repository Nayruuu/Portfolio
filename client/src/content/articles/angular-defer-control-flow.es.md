## @if, @for, @switch

La sintaxis `@` está integrada en el compilador: sin importación de directivas, y un `track` **obligatorio** en `@for` que obliga a pensar en la identidad de los elementos. Es ese `track` el que evita recrear todo en el DOM en cada cambio de lista.

```typescript
@if (user(); as currentUser) {
  <p>Bonjour {{ currentUser.name }}</p>
} @else {
  <p>Invité</p>
}

@for (item of items(); track item.id) {
  <li>{{ item.label }}</li>
} @empty {
  <li>Aucun élément</li>
}

@switch (status()) {
  @case ('loading') { <spinner /> }
  @case ('error') { <error-banner /> }
  @default { <content /> }
}
```

El bloque `@empty` de `@for` y el `@case` exhaustivo de `@switch` cubren casos que a menudo se olvidaban con las directivas estructurales.

## @defer : cargar más tarde

`@defer` envuelve una parte del template cuyo código se extrae del bundle principal y se carga en un **chunk separado** en el momento oportuno. El disparador decide cuándo: `on viewport` carga cuando el bloque entra en pantalla, `on interaction` al primer clic/foco, `on idle` cuando el navegador está inactivo, `on hover`, o `on timer`.

```typescript
@defer (on viewport) {
  <heavy-comments [postId]="postId()" />
} @placeholder (minimum 200ms) {
  <p>Commentaires</p>
} @loading (after 100ms; minimum 300ms) {
  <skeleton-list />
} @error {
  <p>Impossible de charger les commentaires.</p>
}
```

### Los bloques auxiliares

- `@placeholder` : se renderiza **antes** de cualquier disparo, es el que puede llevar el trigger `on viewport`/`on interaction`. El `minimum` evita un flash demasiado breve.
- `@loading` : durante la recuperación del chunk; `after` retrasa su visualización para no parpadear en una conexión rápida.
- `@error` : si el chunk no carga (red cortada, por ejemplo).

También se puede precargar sin mostrar con `prefetch on hover`, para que el clic sea instantáneo sin penalizar el arranque.

## El impacto en el bundle

Todo componente, directiva o pipe usado **únicamente** en un bloque `@defer` se extrae en su propio chunk. Una página pesada — editor de código, gráficos, mapa — puede así sacar 100 a 200 KB del bundle inicial, que solo se descargan si el usuario hace scroll hasta allí. La ganancia se mide directamente en el **Largest Contentful Paint** y el tiempo de interactividad. La documentación detalla cada disparador en la [guía de carga diferida](https://angular.dev/guide/templates/defer).

Sin embargo, hay que tener cuidado: un `@defer (on viewport)` colocado por encima del pliegue se dispara inmediatamente y no aporta nada. El diferido solo tiene sentido para lo que está **fuera de pantalla** o es condicional.

> El control flow hace legible la intención, `@defer` hace explícito el coste. En lugar de cargar todo «por si acaso», declaras cuándo cada pieza merece su JavaScript — y el arranque se aligera solo.
