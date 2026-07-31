An Angular application without zones no longer has `zone.js` to know when the view is stable, and that's
a good thing for testing. No more esoteric `fakeAsync`/`tick` needed: we explicitly wait
for the render to stabilize. Here's how to test a zoneless component with
**Vitest**.

## Configuring Vitest

Since Angular 21, the `@angular/build:unit-test` builder runs **Vitest** with no separate
config: everything lives in `angular.json`. The test providers file enables zoneless
mode once and for all:

```typescript
// src/test-providers.ts
import { provideZonelessChangeDetection } from '@angular/core';

export const testProviders = [provideZonelessChangeDetection()];
```

### Driving signal inputs

With signal `input()`s, we no longer reassign a property: we go through
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

Without zones, `fakeAsync`/`tick()` no longer make sense. The rule is simple: **every**
asynchronous wait is resolved with `await fixture.whenStable()`, which returns control once
change detection has stabilized. This is more readable and closer to the real lifecycle.

- before: `tick(); fixture.detectChanges();`
- after: `await fixture.whenStable();`

## Testing without TestBed

A `computed()` or a pure function doesn't need `TestBed` at all: we call it
directly, and the test is instant. We reserve `TestBed` for actual template rendering. The
[Angular testing guide](https://angular.dev/guide/testing) covers both approaches.

> Zoneless simplifies testing: instead of depending on `zone.js`'s implicit mechanism,
> each test asks for **explicit stability**. A passing test then means what
> it claims to mean.
