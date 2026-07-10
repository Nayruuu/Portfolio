Une app Angular zoneless n'a plus `zone.js` pour savoir quand la vue est stable — et c'est
tant mieux pour les tests. Fini les `fakeAsync`/`tick` ésotériques : on attend explicitement
que le rendu se stabilise. Voici comment tester un composant zoneless avec **Vitest**.

## Configurer Vitest

Depuis Angular 21, le builder `@angular/build:unit-test` lance **Vitest** sans config
séparée : tout vit dans `angular.json`. Le fichier de providers de test active le mode
zoneless une fois pour toutes :

```typescript
// src/test-providers.ts
import { provideZonelessChangeDetection } from '@angular/core';

export const testProviders = [provideZonelessChangeDetection()];
```

### Piloter les inputs signal

Avec les `input()` signal, on ne réaffecte plus une propriété : on passe par
`componentRef.setInput()`, puis on attend la stabilisation :

```typescript
import { describe, expect, it } from 'vitest';

it('rend le total', async () => {
  const fixture = TestBed.createComponent(CartComponent);

  fixture.componentRef.setInput('items', [{ price: 10, quantity: 2 }]);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('20');
});
```

## Remplacer fakeAsync par whenStable

Sans zone, `fakeAsync`/`tick()` n'ont plus de sens. La règle est simple : **toute** attente
asynchrone se résout par `await fixture.whenStable()`, qui rend la main quand le change
detection s'est stabilisé. C'est plus lisible et plus proche du vrai cycle de vie.

- avant : `tick(); fixture.detectChanges();`
- après : `await fixture.whenStable();`

## Tester sans TestBed

Un `computed()` ou une fonction pure n'a pas besoin de `TestBed` du tout : on l'appelle
directement, et le test est instantané. On réserve `TestBed` au rendu réel du template. Le
[guide de test Angular](https://angular.dev/guide/testing) couvre les deux approches.

> Le zoneless simplifie les tests : on n'attend plus une magie invisible, on attend une
> **stabilité explicite**. Un test qui passe veut alors dire ce qu'il prétend dire.
