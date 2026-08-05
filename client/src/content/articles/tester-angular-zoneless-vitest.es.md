Pasar una app Angular a modo zoneless elimina `zone.js`, y con él la señal implícita que
avisaba «la vista es estable, puedes inspeccionar el DOM». El contrato de los tests cambia: en
lugar de esperar a que una zona se calle por sí sola, cada test reclama la estabilidad en el
momento preciso en que la necesita.

Este portfolio funciona así. 104 archivos `.spec.ts`, más de mil casos, ningún `fakeAsync`,
ningún `detectChanges()` manual. Estos son los patrones que sostienen la suite, y las trampas
que los acompañan.

## El modo zoneless, de una vez por todas

Desde Angular 21, el builder `@angular/build:unit-test` incorpora **Vitest**: el runner y sus
opciones viven en `angular.json`, no en un `vitest.config.ts` aparte. Solo una clave importa
para toda la suite, `providersFile`, que designa los providers inyectados en el entorno de
cada test.

Este archivo activa el zoneless (`provideZonelessChangeDetection`) de una vez por todas:

```typescript
// src/test-providers.ts: injected into every test's environment
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

export default [provideZonelessChangeDetection(), provideRouter([])];
```

El `provideRouter([])` con rutas vacías evita tener que reconfigurar un router en cada
`beforeEach`: los componentes que usan `routerLink` se montan sin ceremonia, y la navegación
real sigue cubierta por los tests de Playwright. La
[guía de testing de Angular](https://angular.dev/guide/testing) parte del mismo principio:
montar el componente real y luego verificar lo que renderiza.

## Pilotar un componente a través de sus inputs signal

Un `input()` signal es de solo lectura desde fuera. No se reasigna la propiedad: se pasa por
`fixture.componentRef.setInput()`, y luego se espera a que el valor se propague hasta el
renderizado con `await fixture.whenStable()`.

```typescript
beforeEach(async () => {
  await TestBed.configureTestingModule({ imports: [CodeBlockComponent] }).compileComponents();
  fixture = TestBed.createComponent(CodeBlockComponent);
  fixture.componentRef.setInput('code', 'const answer = 42;');
  fixture.componentRef.setInput('lang', 'typescript');
});

it('renders the provided code', async () => {
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('answer');
});
```

Sin `detectChanges()`: en toda la suite, el contador está en cero. El renderizado se dispara
porque el componente reacciona a sus signals, y `whenStable()` devuelve el control cuando la
detección de cambios se ha asentado.

El componente `Typed` del player lleva el procedimiento más lejos. Su salida es una función
pura de tres inputs (`elapsed`, `at`, `text`); el test fija los tres valores, espera la
estabilidad y verifica el texto mostrado letra por letra. A 40 caracteres por segundo,
`elapsed = 1.05` con `at = 1` da exactamente dos letras visibles. La temporización se convierte
en una aserción determinista, sin ningún reloj que atrapar.

## whenStable, y lo que realmente espera

`whenStable()` reemplaza a `fakeAsync`/`tick()` para el asíncrono ordinario, pero hay que saber
qué es lo que espera: que la aplicación vuelva a ser estable. Una tarea todavía en vuelo la
mantiene ocupada, y la promesa nunca se resuelve.

El caso concreto viene de la página de artículo. Su barra de voto dispara un `GET` a la API al
montarse; dejado tal cual, ese fetch pendiente hace girar `whenStable()` en el vacío. El test
corta la dependencia:

```typescript
// The like-bar fetches its tally on render; stub the API so the pending HTTP GET
// can't leave whenStable() hanging.
const feedback: Pick<FeedbackApiService, 'count' | 'cast'> = {
  count: () => Promise.resolve({ up: 0, down: 0, mine: null }),
  cast: () => Promise.resolve({ up: 0, down: 0, mine: null }),
};
```

El stub devuelve promesas ya resueltas: no queda ninguna petición pendiente, `whenStable()`
termina, y el recuento real sigue probado en su propio nivel en
`like-bar.component.spec.ts`. La regla general: todo lo que mantiene la app ocupada (un timer,
una petición, una microtarea) debe estar controlado, o la espera explícita se vuelve en contra
del test.

## Los timers no pasan por la estabilidad

Un `setInterval` no es una tarea que `whenStable()` sepa drenar: sigue corriendo mientras no se
lo detenga. Para estos casos, se mantienen los timers falsos de Vitest.

`PlayerService` es el ejemplo del repo. Su bucle de reproducción vive en un `effect` que lee la
signal `playing`: al activarse, el efecto programa un `setInterval` que avanza el tiempo en
`0.1 × rate` cada 100 ms; al detenerse, un `onCleanup` libera el intervalo. Es exactamente el
tipo de código en el que olvidar la limpieza deja fugar un timer y falsea el siguiente test.

El test debe primero disparar el efecto, lo que hace `appRef.tick()`, y luego avanzar el reloj
simulado. Después verifica que la pausa efectivamente ejecuta el `onCleanup`:

```typescript
it('the tick advances time while playing, and onCleanup stops it on pause', () => {
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

`appRef.tick()` es el gesto que reemplaza al antiguo `detectChanges()`: fuerza a Angular a hacer
correr sus efectos. El resto es Vitest estándar, `vi.advanceTimersByTime()` donde antes se
escribía `tick()`, más un `afterEach(() => vi.useRealTimers())` para no contaminar el caso
siguiente.

## La mayoría de los tests no monta ningún componente

De los 104 archivos de la suite, 73 ni siquiera importan `TestBed`. Una función pura o un
`computed()` se llama directamente, sin fixture, sin DOM, sin espera: el test es inmediato.

`truncateAtWord`, que corta una bio en la última frontera de palabra, se verifica con entradas
y salidas, nada más: `truncateAtWord('Full-stack developer building serious things', 20)` debe
devolver `'Full-stack developer'`, y una sola palabra más larga que el límite se corta en seco.
`TestBed` se reserva para el renderizado real de un template; todo lo que es lógica se testea
sin él, y eso es la mayoría del código.

## La salvaguarda: core/ al 100 %

Los umbrales globales de cobertura, en `angular.json`, están deliberadamente por debajo del
100 % (statements 85, branches 78, functions 67, lines 88). Engloban los componentes de UI y el
host de navegador del juego, su canvas y sus workers, que no se busca cubrir línea por línea;
estos archivos, de hecho, quedan fuera del informe vía `coverageExclude`.

El núcleo lógico, en cambio, debe permanecer íntegro. El builder no sabe imponer un umbral por
carpeta, así que un pequeño script se encarga a posteriori. `check-core-coverage.mjs` lee el
resumen del reporter `json-summary`, recorre cada archivo, y falla (`exit 1`) en cuanto un
archivo de `core/` (excluyendo `.spec.ts`) baja de 100 % en alguna de las cuatro métricas.

Como los adaptadores de renderizado del juego no figuran en el informe, la regla del 100 % se
aplica exactamente a la lógica pura que queda. El script de cobertura encadena las dos etapas:
`ng test --coverage && node scripts/check-core-coverage.mjs`. Un archivo de `core/` por debajo
del 100 % rompe el comando, no una línea de log que se termina ignorando.

> Sin `zone.js`, un test ya no puede suponer que la vista está lista: debe pedirlo. Es un poco
> más de código por caso, y a cambio un test verde significa lo que dice que significa, timers y
> peticiones incluidos.
