Switching an Angular app to zoneless removes `zone.js`, and with it the implicit signal that
used to say "the view is stable, you can inspect the DOM." The testing contract changes: instead
of waiting for a zone to quiet down on its own, each test asks for stability at the exact moment
it needs it.

This portfolio runs that way. 104 `.spec.ts` files, over a thousand test cases, no `fakeAsync`,
no manual `detectChanges()`. Here are the patterns that hold the suite together, and the traps
that come with them.

## Zoneless mode, once and for all

Since Angular 21, the `@angular/build:unit-test` builder ships with **Vitest**: the runner and
its options live in `angular.json`, not in a separate `vitest.config.ts`. A single key matters
for the whole suite, `providersFile`, which points to the providers injected into every test's
environment.

This file enables zoneless (`provideZonelessChangeDetection`) once and for all:

```typescript
// src/test-providers.ts: injected into every test's environment
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

export default [provideZonelessChangeDetection(), provideRouter([])];
```

`provideRouter([])` with empty routes avoids reconfiguring a router in every `beforeEach`:
components that use `routerLink` mount without ceremony, and real navigation stays covered by
the Playwright tests. The [Angular testing guide](https://angular.dev/guide/testing) works from
the same principle: mount the real component, then check what it renders.

## Driving a component through its signal inputs

An `input()` signal is read-only from the outside. You don't reassign the property: you go
through `fixture.componentRef.setInput()`, then wait for the value to propagate through to the
render with `await fixture.whenStable()`.

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

No `detectChanges()`: across the whole suite, the count is zero. The render is triggered because
the component reacts to its signals, and `whenStable()` returns control once change detection
has settled.

The player's `Typed` component pushes the approach further. Its output is a pure function of
three inputs (`elapsed`, `at`, `text`); the test fixes all three values, waits for stability, and
checks the displayed text letter by letter. At 40 characters per second, `elapsed = 1.05` with
`at = 1` gives exactly two visible letters. Timing becomes a deterministic assertion, with no
clock to trip over.

## whenStable, and what it actually waits for

`whenStable()` replaces `fakeAsync`/`tick()` for ordinary async work, but you need to know what
it waits for: the application becoming stable again. A task still in flight keeps it busy, and
the promise never resolves.

The concrete case comes from the article page. Its vote bar fires a `GET` to the API on mount;
left as is, that pending fetch spins `whenStable()` forever. The test cuts the dependency:

```typescript
// The like-bar fetches its tally on render; stub the API so the pending HTTP GET
// can't leave whenStable() hanging.
const feedback: Pick<FeedbackApiService, 'count' | 'cast'> = {
  count: () => Promise.resolve({ up: 0, down: 0, mine: null }),
  cast: () => Promise.resolve({ up: 0, down: 0, mine: null }),
};
```

The stub returns already-resolved promises: no more pending request, `whenStable()` completes,
and the real tally logic stays tested at its own level in `like-bar.component.spec.ts`. The
general rule: anything that keeps the app busy (a timer, a request, a microtask) has to be
controlled, or the explicit wait works against the test.

## Timers don't go through stability

A `setInterval` isn't a task `whenStable()` knows how to drain: it keeps running until you stop
it. For these cases, we keep Vitest's fake timers.

`PlayerService` is the repo's example of this. Its playback loop lives in an `effect` that reads
the `playing` signal: on activation, the effect schedules a `setInterval` that advances time by
`0.1 × rate` every 100 ms; on stop, an `onCleanup` releases the interval. This is exactly the
kind of code where forgetting the cleanup leaks a timer and skews the next test.

The test first has to trigger the effect, which `appRef.tick()` does, then advance the simulated
clock. It then checks that pausing does run the `onCleanup`:

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

`appRef.tick()` is the move that replaces the old `detectChanges()`: it pushes Angular to run its
effects. The rest is standard Vitest, `vi.advanceTimersByTime()` where you used to write
`tick()`, plus an `afterEach(() => vi.useRealTimers())` so it doesn't contaminate the next case.

## Most tests don't mount any component

Out of the suite's 104 files, 73 don't even import `TestBed`. A pure function or a `computed()`
gets called directly, no fixture, no DOM, no waiting: the test is immediate.

`truncateAtWord`, which trims a bio at the last word boundary, is checked with inputs and
outputs, nothing else:
`truncateAtWord('Full-stack developer building serious things', 20)` should return
`'Full-stack developer'`, and a single word longer than the limit gets cut clean. `TestBed` is
reserved for actually rendering a template; everything that's logic gets tested without it, and
that's most of the code.

## The safety net: core/ at 100%

The global coverage thresholds, in `angular.json`, are deliberately below 100% (statements 85,
branches 78, functions 67, lines 88). They cover UI components and the game's browser host, its
canvas and its workers, which aren't meant to be covered line by line; these files are in fact
excluded from the report via `coverageExclude`.

The logic core, though, has to stay complete. The builder has no way to enforce a per-folder
threshold, so a small script handles it after the fact. `check-core-coverage.mjs` reads the
`json-summary` reporter's output, walks every file, and fails (`exit 1`) as soon as a `core/`
file (excluding `.spec.ts`) drops below 100% on any of the four metrics.

Since the game's rendering adapters don't show up in the report, the 100% rule applies exactly
to the pure logic that remains. The coverage script chains the two steps:
`ng test --coverage && node scripts/check-core-coverage.mjs`. A `core/` file under 100% breaks
the command, not a log line that eventually gets ignored.

> Without `zone.js`, a test can no longer assume the view is ready: it has to ask for it. That's
> a bit more code per case, and in exchange a green test means what it claims, timers and
> requests included.
