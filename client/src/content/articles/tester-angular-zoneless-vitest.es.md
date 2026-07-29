Una app Angular zoneless ya no tiene `zone.js` para saber cuándo la vista es estable — y tanto mejor para los tests. Se acabaron los `fakeAsync`/`tick` esotéricos: se espera explícitamente a que el renderizado se estabilice. Así es como se prueba un componente zoneless con **Vitest**.

## Configurar Vitest

Desde Angular 21, el builder `@angular/build:unit-test` lanza **Vitest** sin configuración separada: todo vive en `angular.json`. El archivo de providers de test activa el modo zoneless de una vez por todas:

```typescript
// src/test-providers.ts
import { provideZonelessChangeDetection } from '@angular/core';

export const testProviders = [provideZonelessChangeDetection()];
```

### Controlar los inputs signal

Con los `input()` signal, ya no se reasigna una propiedad: se usa `componentRef.setInput()`, luego se espera la estabilización:

```typescript
import { describe, expect, it } from 'vitest';

it('rend le total', async () => {
  const fixture = TestBed.createComponent(CartComponent);

  fixture.componentRef.setInput('items', [{ price: 10, quantity: 2 }]);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('20');
});
```

## Reemplazar fakeAsync por whenStable

Sin zona, `fakeAsync`/`tick()` ya no tienen sentido. La regla es simple: **toda** espera asíncrona se resuelve con `await fixture.whenStable()`, que devuelve el control cuando la detección de cambios se ha estabilizado. Es más legible y más cercano al ciclo de vida real.

- antes: `tick(); fixture.detectChanges();`
- después: `await fixture.whenStable();`

## Probar sin TestBed

Un `computed()` o una función pura no necesita `TestBed` en absoluto: se llama directamente, y el test es instantáneo. Se reserva `TestBed` para el renderizado real del template. La [guía de testing de Angular](https://angular.dev/guide/testing) cubre ambos enfoques.

> El zoneless simplifica los tests: ya no se espera a una magia invisible, se espera a una **estabilidad explícita**. Un test que pasa entonces significa lo que afirma significar.
