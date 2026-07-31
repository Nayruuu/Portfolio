Ohne `zone.js` weiß eine zoneless Angular-App nicht mehr, wann die View stabil ist, und
das ist gut so für Tests. Keine esoterischen `fakeAsync`/`tick` mehr nötig: Man wartet
explizit, bis sich das Rendering stabilisiert. So testet man eine zoneless-Komponente mit
**Vitest**.

## Vitest konfigurieren

Seit Angular 21 startet der Builder `@angular/build:unit-test` **Vitest** ohne separate
Konfiguration: Alles lebt in `angular.json`. Die Test-Providers-Datei aktiviert den
zoneless-Modus ein für alle Mal:

```typescript
// src/test-providers.ts
import { provideZonelessChangeDetection } from '@angular/core';

export const testProviders = [provideZonelessChangeDetection()];
```

### Signal-Inputs steuern

Mit `input()`-Signalen weist man keine Eigenschaft mehr neu zu: Man geht über
`componentRef.setInput()` und wartet dann auf die Stabilisierung:

```typescript
import { describe, expect, it } from 'vitest';

it('rendert die Gesamtsumme', async () => {
  const fixture = TestBed.createComponent(CartComponent);

  fixture.componentRef.setInput('items', [{ price: 10, quantity: 2 }]);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('20');
});
```

## fakeAsync durch whenStable ersetzen

Ohne Zone ergeben `fakeAsync`/`tick()` keinen Sinn mehr. Die Regel ist einfach: **jedes**
asynchrone Warten wird über `await fixture.whenStable()` aufgelöst, das die Kontrolle
zurückgibt, sobald sich die Change Detection stabilisiert hat. Das ist lesbarer und näher
am echten Lebenszyklus.

- vorher: `tick(); fixture.detectChanges();`
- nachher: `await fixture.whenStable();`

## Ohne TestBed testen

Ein `computed()` oder eine reine Funktion braucht überhaupt kein `TestBed`: Man ruft sie
direkt auf, und der Test ist sofort fertig. `TestBed` bleibt dem echten Rendern des
Templates vorbehalten. Der [Angular-Testleitfaden](https://angular.dev/guide/testing) deckt
beide Ansätze ab.

> Zoneless vereinfacht Tests: Statt sich auf den impliziten Mechanismus von `zone.js` zu
> verlassen, verlangt jeder Test eine **explizite Stabilität**. Ein bestandener Test bedeutet
> dann auch tatsächlich das, was er behauptet.
