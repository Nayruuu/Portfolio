Eine zoneless Angular-App hat kein `zone.js` mehr, um zu wissen, wann die Ansicht stabil ist — und das ist gut so für die Tests. Schluss mit esoterischem `fakeAsync`/`tick`: man wartet explizit darauf, dass das Rendering sich stabilisiert. So testet man eine zoneless-Komponente mit **Vitest**.

## Vitest konfigurieren

Ab Angular 21 startet der Builder `@angular/build:unit-test` **Vitest** ohne separate Konfiguration: alles lebt in `angular.json`. Die Test-Provider-Datei aktiviert den zoneless-Modus ein für allemal:

```typescript
// src/test-providers.ts
import { provideZonelessChangeDetection } from '@angular/core';

export const testProviders = [provideZonelessChangeDetection()];
```

### Signal-Inputs steuern

Mit `input()`-Signalen weist man keine Eigenschaft mehr direkt zu: man verwendet `componentRef.setInput()` und wartet anschließend auf die Stabilisierung:

```typescript
import { describe, expect, it } from 'vitest';

it('rend le total', async () => {
  const fixture = TestBed.createComponent(CartComponent);

  fixture.componentRef.setInput('items', [{ price: 10, quantity: 2 }]);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('20');
});
```

## fakeAsync durch whenStable ersetzen

Ohne Zone ergeben `fakeAsync`/`tick()` keinen Sinn mehr. Die Regel ist einfach: **jedes** asynchrone Warten wird durch `await fixture.whenStable()` aufgelöst, das die Kontrolle zurückgibt, sobald die Change Detection sich stabilisiert hat. Das ist lesbarer und näher am echten Lebenszyklus.

- vorher: `tick(); fixture.detectChanges();`
- nachher: `await fixture.whenStable();`

## Ohne TestBed testen

Ein `computed()` oder eine reine Funktion benötigt überhaupt kein `TestBed`: man ruft sie direkt auf, und der Test ist sofort fertig. `TestBed` bleibt dem echten Template-Rendering vorbehalten. Der [Angular-Testleitfaden](https://angular.dev/guide/testing) behandelt beide Ansätze.

> Zoneless vereinfacht Tests: Man wartet nicht mehr auf unsichtbare Magie, sondern auf eine **explizite Stabilität**. Ein bestandener Test bedeutet dann wirklich das, was er zu bedeuten vorgibt.
