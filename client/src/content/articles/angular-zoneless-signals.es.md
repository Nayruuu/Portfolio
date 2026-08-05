Cette aplicación funciona sin zone.js. No está detrás de un flag experimental: el paquete no
está ni en el `package.json`, ni en `node_modules`, y `angular.json` declara `"polyfills": []`. El
change detection está gobernado por los signals, y solo por ellos. Lo que sigue describe cómo está
cableado en este portfolio, y los cuatro o cinco lugares donde la ausencia de zone cambia de verdad
la forma de escribir código.

## Lo que hacía zone.js, y lo que toma el relevo

zone.js parcheaba todas las API asíncronas del navegador (`setTimeout`, las promesas, los
listeners DOM) para avisar a Angular en cuanto terminaba un callback. En cada notificación, un
ciclo de detección volvía a partir de la raíz y revisaba de nuevo todo el árbol, incluidos los
componentes en los que nada se había movido.

En zoneless, este monkey-patch desaparece. Un componente se marca para verificación cuando un
signal que lee en su template notifica un cambio. Se suman algunos disparadores explícitos: un
handler de evento en el template, un `markForCheck`, la actualización de un `input()`.

La consecuencia es directa. Un `setTimeout` que reescribe un campo ordinario ya no provoca ningún
refresco. Con zone.js, el tick global recuperaba este tipo de mutación sin que hubiera que
pensarlo. Sin él, cada fuente de cambio debe pasar por un signal, o la vista se queda congelada.

Es un contrato más estricto, pero también más legible: la reactividad deja de ser un efecto
colateral del entorno de ejecución para convertirse en un dato del código.

## La activación, un único provider

Todo se juega en `app.config.ts`. `provideZonelessChangeDetection()` reemplaza al antiguo
`provideZoneChangeDetection`, y el resto de la configuración acompaña esa elección.

```typescript
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
  ],
};
```

`withComponentInputBinding()` vincula los parámetros de ruta a los `input()` de los componentes: el
`:slug` de la página de artículo llega directamente a un `input.required<string>()`, sin lectura
manual del snapshot. `provideClientHydration(withEventReplay())` reproduce los eventos ocurridos
durante la hidratación, algo que importa aún más sin zone: ya no hay nada que absorba en segundo
plano un clic llegado antes de que la app sea interactiva.

## La columna vertebral reactiva

Toda la app lee el contenido multilingüe a través de un único signal. `I18nService` es una fachada
delgada sobre un `SignalStore` [NgRx](https://ngrx.io/guide/signals) y solo expone tres signals de
lectura: `lang`, `content` y `loading`, tipados `Signal<Lang>` / `Signal<Content>` /
`Signal<boolean>`. Los consumidores nunca dependen de la forma interna del store.

El store sigue una lógica de stale-while-revalidate. Al arrancar, un `peek()` síncrono llena el
contenido (primer render instantáneo, compatible con el prerender estático), y luego un
`getContent()` asíncrono lo revalida. Un cambio de idioma está protegido por un last-wins: si
mientras tanto se ha pedido un idioma más reciente, el resultado antiguo se descarta.

El efecto colateral en el DOM vive en un `withHooks` del store, mediante un `effect` que reacciona
a `lang()`: persiste la preferencia en `localStorage` y refleja el valor en `<html lang="…">`.
Nadie llama a ese código, se reejecuta cuando el signal cambia.

El interés se ve en el uso. Cambiar de idioma actualiza `content()`, y cada `computed` o template
que lo lee se recalcula sin una sola suscripción manual.

## El estado derivado se calcula solo

La página de artículo ilustra la cadena completa. El parámetro de ruta es un `input`, todo lo demás
se deriva por `computed`:

```typescript
/** Route param `:slug`, bound via withComponentInputBinding. */
protected readonly slug = input.required<string>();

protected readonly article = computed<Article>(() => {
  const articles = this.i18n.content().articles;
  const index = articles.findIndex((a) => a.slug === this.slug());

  return articles[index] ?? articles[0];
});

protected readonly body = computed(() =>
  parseMarkdown(ARTICLE_BODIES[this.article().slug]?.[this.i18n.lang()] ?? ''),
);
```

`article` depende de `slug()` y de `content()`; `body` depende de `article()` y de `lang()`.
Navegar a otro artículo, o cambiar de idioma, recompone el conjunto sin código de sincronización.
Los `computed` están memoizados: `body` solo vuelve a parsear el Markdown si el slug o el idioma
realmente han cambiado.

El mismo principio estructura `PlayerService`, que gobierna el reproductor simulado de la página de
inicio. El tiempo de reproducción (`time`) y el estado play/pause (`playing`) son signals de
escritura. La lista de capítulos deriva del idioma vía `this.i18n.content().chapters`, el capítulo
actual deriva del tiempo, y el tiempo transcurrido en ese capítulo deriva de ambos. El template
muestra `currentChapter()` y sigue automáticamente, sin `ngOnChanges` ni recálculo disparado a
mano.

Las entradas y salidas de los componentes son, también ellas, signals. Las escenas del
reproductor reciben su reloj mediante `input.required<number>()` y su estado activo mediante
`input.required<boolean>()`, dos valores que alimentan directamente `computed`s. La demo BSP
propaga sus eventos al padre mediante `output<void>()`. Para los estados locales realmente
triviales, un servicio puede reducirse a una línea: la búsqueda de la barra es un simple
`public readonly query = signal('')`, escrito por la barra de navegación, leído por la grilla de
artículos.

Todos los componentes de la app están en `ChangeDetectionStrategy.OnPush`. En zoneless es coherente
de principio a fin: una vista solo se verifica cuando un signal que consume lo solicita.

## Un intervalo gobernado por un signal

El punto delicado de zoneless es el código asíncrono imperativo. `PlayerService` hace avanzar un
reloj de reproducción con un `setInterval`, pero el `setInterval` vive dentro de un `effect`
gobernado por el signal `playing`.

```typescript
constructor() {
  // Drive the tick loop reactively from `playing`.
  effect((onCleanup) => {
    if (!this.playing()) {
      return;
    }
    const intervalId = setInterval(() => {
      const next = this.time() + 0.1 * this.rate();

      this.time.set(next >= this.totalSec() ? 0 : next);
    }, 100);

    onCleanup(() => clearInterval(intervalId));
  });
}
```

Cuando `playing` pasa a `false`, el efecto se reejecuta, `onCleanup` se ejecuta antes y
`clearInterval` detiene el bucle. El `rate()` leído en el tick hace variar el paso sin reconstruir
nada.

Olvidar ese `onCleanup` es la trampa clásica. El intervalo sobreviviría a la pausa, correría varias
veces en paralelo tras varias alternancias, y se filtraría en los tests igual que en el prerender
SSR, donde el timer nunca tendría motivo para detenerse. El `set()` sobre `time` sigue siendo el
único canal por el que el tick informa a la vista: sin zone.js, Angular solo se despierta con la
escritura del signal, nunca con el `setInterval` en sí.

## Cuando RxJS debe alimentar un signal

RxJS todavía existe en la app, pero al margen, y nunca gobierna un template directamente. La barra
de votos debe recargar sus contadores en cada navegación entre artículos: engancha `router.events`
con un `filter` sobre `NavigationEnd` y un `takeUntilDestroyed()`, y luego en el `subscribe` llama
a un `load()` que termina con un `this.tally.set(...)`.

El flujo sirve de disparador, el signal porta el estado. `takeUntilDestroyed()` cancela la
suscripción al destruirse el componente sin `ngOnDestroy` manual. La API `toSignal()` haría el
mismo puente de forma declarativa, pero este portfolio no lo ha necesitado: aquí, los escasos
streams se resumen a un `set()` dentro del `subscribe`.

## La regla que impide la deriva

«Todo es un signal» es fácil de decir y fácil de traicionar: basta con que un desarrollador escriba
`public loading = false` por reflejo. Una regla ESLint propia, `local/prefer-signal-primitives`,
mantiene la disciplina.

Inspecciona cada campo público cuyo tipo o valor inicial sea primitivo (booleano, cadena, número,
`bigint`, literal, o unión de primitivos) y marca un error si no está inicializado con `signal()`,
`computed()`, `model()` o `input()`. El mensaje es explícito:
`Public primitive field '{{name}}' should be a signal`. Está activada en `error` sobre todo
`src/app/**/*.ts`, con los specs excluidos.

El efecto es que un campo de estado expuesto y dejado como primitivo mutable ya no compila en el
lint. La convención no depende de la vigilancia de cada uno; se verifica en cada build.

## Testear cuando ya no hay zone

Sin zone.js, ya no hay `fakeAsync` ni `tick()`: el proyecto no contiene ninguna ocurrencia. Dos
patrones lo sustituyen, descritos en la [guía zoneless](https://angular.dev/guide/zoneless).

Para un componente, se actúa y luego se espera la estabilidad:
`await fixture.whenStable()` después de una interacción, antes de afirmar sobre el DOM. Una
veintena de specs de componentes siguen este esquema.

Para el reloj de `PlayerService`, hay que gobernar el change detection a mano. Se fuerzan los
temporizadores de Vitest, se hace flush del efecto con `ApplicationRef.tick()` (lo que programa el
`setInterval`), y luego se avanza el tiempo.

```typescript
it('the tick advances while playing, and onCleanup stops it on pause', () => {
  vi.useFakeTimers();
  const svc = TestBed.inject(PlayerService);
  const appRef = TestBed.inject(ApplicationRef);

  appRef.tick(); // flush the effect → schedules setInterval
  const before = svc.time();

  vi.advanceTimersByTime(100);
  expect(svc.time()).toBeCloseTo(before + 0.1, 5);

  svc.pause();
  appRef.tick(); // effect re-runs → onCleanup clears the interval
  const afterPause = svc.time();

  vi.advanceTimersByTime(1000);
  expect(svc.time()).toBe(afterPause);
});
```

El test verifica las dos mitades del contrato: el reloj avanza 0,1 cada cien milisegundos en
reproducción, y tras `pause()` más `appRef.tick()`, avanzar un segundo entero ya no mueve el
tiempo. `onCleanup` ha cortado bien el intervalo. Es zoneless que se testea tal como funciona: los
cambios son explícitos, se elige cuándo se producen.

> Zoneless no hace la app más rápida por arte de magia. Lo que cambia es la trazabilidad:
> cada redibujado se remonta a un signal preciso, y una regla de lint impide que el estado se
> escape de ese modelo.
