A Flutter app that keeps growing always ends up asking the same question: where does the state
live, and how do you test it without spinning up a widget? `setState` mixes logic and UI in the
same class; `InheritedWidget` does propagate data but says nothing about its creation or its
replacement in tests. **Riverpod** answers both: a dependency-injection container that produces
reactive values, independent of the widget tree.

## Providers and notifiers

A `Provider` exposes a value; a `Notifier` exposes a **mutable** value along with the logic that
evolves it. With code generation (`riverpod_generator`), you annotate a class and `build()`
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
`currentUser` recomputes automatically. It's the dependency graph that replaces manual cascading
`setState` calls.

## Separating UI from logic

A widget contains **no** business logic: it reads state and calls methods. All the mechanics
live in the notifier, testable without a `WidgetTester`:

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

For async reads, a `ref.watch(currentUserProvider)` returns an `AsyncValue`, whose
`.when(data:, loading:, error:)` covers all three states **without a stray `isLoading` boolean**.

## Dependency injection and overrides in tests

This is where Riverpod beats `InheritedWidget`: every provider is **replaceable** when the
`ProviderContainer` is mounted. In tests, you inject a fake API client without touching
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
`addTearDown` guarantees it gets disposed. The [Riverpod testing
documentation](https://riverpod.dev/docs/essentials/testing) details the `pump` and listener
patterns.

## Why not setState or InheritedWidget

`setState` rebuilds the whole `State` and keeps logic welded to the UI: impossible to test
without rendering the widget. `InheritedWidget` shares a value but forces you to hand-write
`updateShouldNotify`, handles neither async nor replacement, and leaks as soon as you touch
`BuildContext`.

Riverpod moves state **outside the tree**, makes it lazy, memoized and self-disposing
(`autoDispose`), and turns overriding into the normal way to test.

> No matter how many providers you have: a Flutter architecture is judged by whether the logic
> can be tested **without ever mounting a widget**. With Riverpod, that's true by construction.
