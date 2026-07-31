Angular ha reemplazado `*ngIf` y `*ngFor` por un nuevo control flow, incorporado junto con `@defer`.
La combinación cambia lo que termina en el bundle inicial: al arrancar solo se envía el
JavaScript realmente necesario para el primer renderizado, el resto llega bajo demanda.

## @if, @for, @switch

La sintaxis `@` está integrada en el compilador: sin importación de directiva, y un `track`
**obligatorio** en `@for` que obliga a pensar en la identidad de los elementos. Es ese `track`
el que evita recrear todo en el DOM en cada cambio de lista.

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

El bloque `@empty` de `@for` y el `@case` exhaustivo de `@switch` cubren casos que a menudo
se olvidaban con las directivas estructurales.

## @defer: cargar más tarde

`@defer` envuelve un fragmento de template cuyo código se saca del bundle principal y se carga
en un **chunk separado** en el momento deseado. El disparador decide cuándo: `on viewport` carga
cuando el bloque entra en la pantalla, `on interaction` en el primer clic/foco, `on idle` cuando
el navegador está inactivo, `on hover`, o `on timer`.

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

### Los bloques anexos

- `@placeholder`: se renderiza **antes** de cualquier disparo, es el que puede llevar el trigger
  `on viewport`/`on interaction`. El `minimum` evita un parpadeo demasiado breve.
- `@loading`: durante la recuperación del chunk; `after` retrasa su visualización para no
  parpadear en una conexión rápida.
- `@error`: si el chunk no carga (conexión cortada, por ejemplo).

También se puede precargar sin mostrar con `prefetch on hover`, para que el clic sea
instantáneo sin sobrecargar el arranque.

## El impacto en el bundle

Todo componente, directiva o pipe usado **únicamente** dentro de un bloque `@defer` se extrae
en su propio chunk.

Una página pesada (editor de código, gráficos, mapa) puede así sacar 100 a 200 KB del
bundle inicial, que solo se descargan si el usuario hace scroll hasta ahí. La ganancia se
mide directamente en el **Largest Contentful Paint** y en el tiempo de interactividad.

La documentación detalla cada disparador en la
[guía de carga diferida](https://angular.dev/guide/templates/defer).

Cuidado, sin embargo: un `@defer (on viewport)` colocado por encima de la línea de flotación se
dispara inmediatamente y no aporta nada. El diferido solo tiene sentido para lo que está
**fuera de pantalla** o es condicional.

> El control flow hace legible la intención, y `@defer` asocia un coste explícito a cada
> fragmento de template. En lugar de cargarlo todo «por si acaso», se declara cuándo cada bloque
> merece su JavaScript, y el arranque se aligera.
