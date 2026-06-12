A Flutter app that grows always ends up asking the same question: where does state live, and
how do you test it without spinning up a widget? `setState` mixes logic and UI in the same
class; `InheritedWidget` propagates data well but says nothing about how it's created or
swapped out in a test. **Riverpod** answers both: a dependency-injection container that
produces reactive values, independent of the widget tree.

## Providers and notifiers

A `Provider` exposes a value; a `Notifier` exposes a **mutable** value along with the logic
that drives it. With code generation (`riverpod_generator`), you annotate a class and `build()`
returns the initial state:

```dart
@riverpod
class Counter extends _$Counter {
  @override
  int build() => 0;

  void increment() => state = state + 1;
}

@riverpod
Future<User> currentUser(CurrentUserRef ref) {
  final api = ref.watch(apiClientProvider);

  return api.fetchMe();
}
```

The `ref.watch` inside a provider creates a **dependency**: if `apiClientProvider` changes,
`currentUser` recomputes automatically. This dependency graph is what replaces cascading manual
`setState` calls.

## Separating UI from logic

The golden rule: a widget holds **no** business logic. It reads state and calls methods. All
the machinery lives in the notifier, testable without a `WidgetTester`:

```dart
class CounterView extends ConsumerWidget {
  const CounterView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(counterProvider);

    return Text('$count');
  }
}
```

On the async read side, `ref.watch(currentUserProvider)` returns an `AsyncValue`, whose
`.when(data:, loading:, error:)` covers all three states **without a stray `isLoading`
boolean**.

## Dependency injection and test overrides

This is where Riverpod beats `InheritedWidget`: every provider is **overridable** when the
`ProviderContainer` is built. In a test, you inject a fake API client without touching
production code:

```dart
test('loads the current user', () async {
  final container = ProviderContainer(
    overrides: [
      apiClientProvider.overrideWithValue(FakeApiClient()),
    ],
  );
  addTearDown(container.dispose);

  final user = await container.read(currentUserProvider.future);
  expect(user.name, 'Ada');
});
```

No global mock, no singleton to reset between tests: each container is isolated, and
`addTearDown` guarantees it's disposed. The [Riverpod testing
docs](https://riverpod.dev/docs/essentials/testing) cover the `pump` and listener patterns in
detail.

## Why not setState or InheritedWidget

`setState` rebuilds the whole `State` and welds logic to the UI — impossible to test without
rendering the widget. `InheritedWidget` shares a value but forces you to hand-write
`updateShouldNotify`, handles neither async nor swapping, and leaks the moment you touch
`BuildContext`. Riverpod moves state **out of the tree**, makes it lazy, memoized and
auto-disposed (`autoDispose`), and turns overriding into the normal path for tests.

> Good Flutter architecture isn't measured by the number of providers, but by this: can you
> test the logic **without ever mounting a widget**? With Riverpod, the answer is yes by
> design.
