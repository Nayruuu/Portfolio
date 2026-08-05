Angular 21 incorpora su control flow en el compilador: `@if`, `@for`, `@switch`, además de `@let` y
`@defer`. Este portfolio lo usa por todas partes, hasta el punto de que ningún componente importa ya
`CommonModule`, `NgIf` ni `NgForOf`.

El «menos JS al arrancar» del título abarca dos palancas separadas: la división por ruta, y
un `@defer` colocado sobre el único bloque grande que la página de inicio transportaba sin ejecutarlo
nunca. Esta segunda palanca retira aproximadamente 260 KB de JavaScript en bruto de la carga de la home,
medido en el build de producción. Trato ambos temas por separado, porque no resuelven el mismo problema.

## El control flow vive en el compilador

`@if` y `@for` no son directivas: el compilador de templates los reconoce directamente.
Un componente que muestra una lista condicional no tiene nada que declarar en su array `imports`. Un
`grep` sobre `CommonModule`, `NgIf`, `NgForOf` o `NgSwitch` en `client/src/app` no encuentra nada:
estos símbolos han desaparecido del código de la aplicación.

La otra novedad discreta es `@let`. Casi todos los templates del proyecto empiezan con la
misma línea, `@let content = i18n.content();`: una variable local al template, de solo lectura,
reevaluada cuando el signal cambia. Evita repetir `i18n.content()` en cada interpolación y
sirve de punto de entrada único hacia el contenido traducido de la locale actual.

## `@if`, `@else if`, `@else`

El reproductor de video de la página de inicio es una bifurcación de tres vías. Según el estado, renderiza el
botón de restauración del modo mini, el juego, o la escena por defecto:

```html
@if (player.mini()) {
  <button class="player__popped" (click)="player.closeMini()">…</button>
} @else if (game.running()) {
  <sd-bsp-demo (exited)="exitGame()" [fullscreen]="fullscreen()" />
} @else {
  <sd-player-stage />
  <!-- controls, progress bar, settings… -->
}
```

La condición toma un signal invocado como una función (`player.mini()`, `game.running()`). El `@if`
también acepta un alias que captura el valor no nulo para el resto del bloque. La página de proyecto lo emplea
así, `@if (articleSlug(); as slug)`, para trabajar únicamente sobre un identificador garantizado presente.

## `@for` y el `track` obligatorio

`@for` impone una expresión `track`. Le indica a Angular cómo identificar un elemento de un renderizado a
otro, es decir, qué nodos del DOM reutilizar en lugar de recrearlos todos. El compilador rechaza un `@for`
que no la tenga.

En este repositorio, se repiten tres elecciones de clave, según la naturaleza de los datos.

Cuando el elemento tiene un identificador estable, se sigue ese identificador:
`track chapter.id` para los capítulos del reproductor, `track review.who` para las reseñas, `track tech.name`
para las tecnologías de un nivel del stack. Dos renderizados sucesivos encuentran el mismo objeto aunque
su posición cambie.

Cuando la lista está compuesta por cadenas o números, se sigue el propio valor: `track tech` en los
tags de un proyecto, `track lang` en los idiomas, `track speed` en las velocidades de reproducción. El valor
hace las veces de clave.

Queda `track $index`, para las listas posicionales que nunca se reordenan. El cuerpo de un
artículo renderizado desde su Markdown es el ejemplo: los bloques analizados conservan su orden, el índice
es por tanto una clave legítima.

```html
@for (block of body(); track $index) {
  @switch (block.type) {
    @case ('h2') { <h2><sd-inline-runs [runs]="block.runs" /></h2> }
    @case ('p') { <p><sd-inline-runs [runs]="block.runs" /></p> }
    @case ('ul') {
      <ul>
        @for (item of block.items; track $index) {
          <li><sd-inline-runs [runs]="item" /></li>
        }
      </ul>
    }
    @case ('code') { <sd-code-block [code]="block.text" [lang]="block.lang" /> }
    @case ('quote') { <blockquote><sd-inline-runs [runs]="block.runs" /></blockquote> }
  }
}
```

`@for` también sabe exponer `$index` bajo un nombre: `@for (filter of content.articleFilters; track
filter; let index = $index)` mantiene el índice a mano para marcar el filtro activo. El bloque
`@empty`, por su parte, no aparece en ningún lugar del proyecto. El caso «lista vacía» se trata con un `@if`
separado colocado antes de la grilla, `@if (filtered().length === 0)`, porque el mensaje de ausencia de
resultados vive en otro lugar del layout distinto de la propia grilla.

## `@switch` para renderizar el Markdown

El fragmento anterior muestra el uso real de `@switch` en el proyecto: proyectar un árbol de bloques
Markdown hacia los elementos correctos. `@switch (block.type)` dirige cada nodo (`h2`, `p`, `ul`,
`code`, `quote`) hacia su componente de renderizado. Un segundo `@switch (run.kind)` hace el mismo trabajo un
nivel más abajo, en `sd-inline-runs`, para distinguir texto, enlace y código inline dentro de un
párrafo.

Esto es contenido, no UI de aplicación: cada `@case` corresponde a una variante cerrada del
modelo de datos, y el compilador verifica los templates de cada rama.

## Lo que significa aquí «menos JS al arrancar»

El control flow hace que los templates sean legibles, pero no reduce por sí solo el JavaScript
descargado en la primera carga. Ese trabajo pasa por dos mecanismos: el router, y un
`@defer`.

Cada feature se carga bajo demanda. `app.routes.ts` declara catorce puntos de `loadComponent`
o `loadChildren`; las páginas `articles`, `series` y `projects` tienen incluso su propio subárbol de
rutas lazy:

```typescript
{
  path: 'articles',
  loadChildren: () =>
    import('./features/articles/articles.routes').then((m) => m.ARTICLES_ROUTES),
},
```

El `import()` dinámico es lo que el bundler sigue para crear un chunk separado. Mientras un visitante no
vaya a `/articles`, el código de esa página no viaja por la red. La primera carga solo
transporta la ruta mostrada.

`@defer` traslada esa misma idea bajo la ruta, dentro de un template. Envuelve un fragmento
cuyo código sale del chunk actual y no llega hasta el disparador elegido: `on viewport`,
`on interaction`, `on idle`, `on hover`, `on immediate` o `on timer`. Viene con sus bloques
auxiliares, descritos en la [guía de carga diferida](https://angular.dev/guide/templates/defer):

```html
@defer (on interaction) {
  <heavy-widget />
} @placeholder {
  <p>…</p>
} @loading (after 100ms; minimum 300ms) {
  <skeleton />
} @error {
  <p>Chargement impossible.</p>
}
```

El `@placeholder` se renderiza antes de cualquier disparo y puede portar el trigger. El `@loading` cubre
el tiempo de recuperación del chunk, con un `after` que retrasa su aparición para no parpadear
en una conexión rápida. El `@error` toma el relevo si el chunk no carga.

## El `@defer` colocado sobre el motor de juego

El componente del juego, `sd-bsp-demo`, arrastra todo el motor detrás de sí: `asset-loader`,
`combat-runtime`, `pickup-runtime`, los painters, la IA de los enemigos. El build lo convierte en un chunk aparte,
`bsp-demo-component`, de 261 KB en bruto, 69 KB una vez comprimido en gzip.

Este código solo sirve tras un clic en el mando del reproductor, y la inmensa mayoría de los visitantes nunca lo
activa. El `@if (game.running())` solo condicionaba el **renderizado**: el motor, por su parte,
se iba en el chunk de la home y se quedaba ahí, cargado para nada.

El bloque ahora está envuelto en un `@defer`, dentro de la rama ya protegida por la
condición:

```html
@else if (game.running()) {
  @defer (on immediate) {
    <sd-bsp-demo
      (exited)="exitGame()"
      [fullscreen]="fullscreen()"
      [fullscreenAvailable]="nativeFullscreen"
      (fullscreenToggle)="toggleFullscreen()"
    />
  }
}
```

El disparador `on immediate` carga el chunk en cuanto el bloque entra en el DOM. Como este bloque vive
bajo `@else if (game.running())`, solo entra en el DOM una vez lanzado el juego: la condición ya hace
la selección, `on immediate` solo se encarga de tirar del código en el momento preciso en que la rama se muestra. Mientras
el juego no esté corriendo, es la rama `@else` la que se renderiza, es decir, el reproductor normal; no
hay por tanto nada que poner en un `@placeholder`, y la visualización no cambia.

`BspDemoComponent` permanece en el array `imports` del reproductor. Angular difiere automáticamente un
componente standalone cuyo único punto de uso está dentro de un `@defer`: no hace falta un
`import()` dinámico manual ni retirar la declaración.

El resultado se lee en el build de producción. Al cargar `/fr` y registrar el resource-timing
(`performance.getEntriesByType('resource')`), el JavaScript de la home pasa de 774.534 a 514.771
bytes en bruto, y de doce a once archivos. Son 259.763 bytes menos, aproximadamente −260 KB en bruto,
cerca del 33 % del JS de la página de inicio; en la red, el chunk retirado pesa 69 KB una vez
comprimido. La medición es puntual, tomada una vez sobre un build real, no un banco de pruebas promediado.

La distinción se mantiene. El control flow decide qué se muestra; la división por ruta y
`@defer` deciden qué se descarga. El proyecto aplica el primero por todas partes, el segundo a las
rutas, y ahora a este bloque en concreto.

> El nuevo control flow ha aplanado los templates y ha sacado `CommonModule` del código. Aligerar el
> arranque sigue siendo un trabajo distinto: pasa por el router, y por un `@defer` sobre el motor del
> juego, que retira un tercio del JavaScript de la página de inicio para enviarlo solo al visitante que
> lanza la partida.
