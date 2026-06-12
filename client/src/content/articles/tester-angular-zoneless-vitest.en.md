A zoneless Angular app no longer has `zone.js` to know when the view is stable — and that's
good news for tests. No more esoteric `fakeAsync`/`tick`: you explicitly wait for the render
to settle. Here's how to test a zoneless component with **Vitest**.

## Configuring Vitest

Since Angular 21, the `@angular/build:unit-test` builder runs **Vitest** with no separate
config: it all lives in `angular.json`. The test-providers file turns on zoneless mode once
and for all:

```typescript
// src/test-providers.ts
import { provideZonelessChangeDetection } from '@angular/core';

export const testProviders = [provideZonelessChangeDetection()];
```

### Driving signal inputs

With signal `input()`s, you no longer reassign a property: you go through
`componentRef.setInput()`, then wait for stabilization:

```typescript
import { describe, expect, it } from 'vitest';

it('renders the total', async () => {
  const fixture = TestBed.createComponent(CartComponent);
  fixture.componentRef.setInput('items', [{ price: 10, quantity: 2 }]);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('20');
});
```

## Replacing fakeAsync with whenStable

Without a zone, `fakeAsync`/`tick()` no longer make sense. The rule is simple: **every** async
wait resolves with `await fixture.whenStable()`, which returns once change detection has
settled. It's more readable and closer to the real lifecycle.

- before: `tick(); fixture.detectChanges();`
- after: `await fixture.whenStable();`

## Testing without TestBed

A `computed()` or a pure function needs no `TestBed` at all: call it directly and the test is
instant. Reserve `TestBed` for real template rendering. The
[Angular testing guide](https://angular.dev/guide/testing) covers both approaches.

> Zoneless simplifies tests: you no longer wait on invisible magic, you wait on **explicit
> stability**. A passing test then means what it claims to mean.
