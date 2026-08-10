A Flutter app that grows eventually raises the same question: where does the state live, and how do
you test it without starting up a widget? `setState` welds the logic to the UI in the same class.
`InheritedWidget` does propagate the data but says nothing about its creation or its replacement
in tests. **Riverpod** addresses both problems at once: it's a dependency injection container
that produces reactive values, declared outside the widget tree and linked together
by a typed graph.

## Three families of providers

Riverpod exposes data through `provider`s, and three forms cover nearly all
needs. A `Provider` returns an immutable value (an HTTP client, a repository, a configuration).
A `NotifierProvider` pairs a mutable state with the logic that evolves it. An
`AsyncNotifierProvider` does the same thing when the initial state is asynchronous: a network call,
a database read.

With code generation ([`riverpod_generator`](https://pub.dev/packages/riverpod_generator)),
you never instantiate any of these types by hand. You annotate a function or a class with
`@riverpod`, the generator produces the provider, and `build()` returns the starting state.

```dart
// A plain value: the object other providers depend on.
@riverpod
TodoRepository todoRepository(Ref ref) {
  final client = ref.watch(httpClientProvider);
  return TodoRepository(client);
}

// Synchronous mutable state plus its logic.
@riverpod
class Counter extends _$Counter {
  @override
  int build() => 0;

  void increment() => state++;
}

// Asynchronous state: build() returns a Future.
@riverpod
class TodoList extends _$TodoList {
  @override
  Future<List<Todo>> build() {
    return ref.watch(todoRepositoryProvider).fetchAll();
  }
}
```

Each annotation generates a typed identifier: `todoRepositoryProvider`, `counterProvider`,
`todoListProvider`. It's this identifier that the rest of the app consumes, never the class
directly.

## The dependency graph

The `ref.watch` inside a provider creates a **dependency**. `todoListProvider` watches
`todoRepositoryProvider`, which watches `httpClientProvider`. If one changes, everything that depends
on it recomputes, with no manual cascading wiring. It's a directed graph, and since each provider has
a return type known at compile time, a wiring mistake becomes a compile error rather than a runtime
crash.

On the reading side, `ref` comes in three usages that must be distinguished. `ref.watch` subscribes: it
belongs inside a `build()`, of a widget or a provider, to react to change. `ref.read` reads
once, with no subscription: use it in an event handler, to trigger a method. `ref.listen` registers a side
effect (showing an error, navigating) without rebuilding.

```dart
class CounterView extends ConsumerWidget {
  const CounterView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // watch: rebuilds this widget when the value changes.
    final count = ref.watch(counterProvider);

    return ElevatedButton(
      // read: fires a method once, no subscription created here.
      onPressed: () => ref.read(counterProvider.notifier).increment(),
      child: Text('$count'),
    );
  }
}
```

Watching the provider gives you the value; watching its `.notifier` gives you the object that carries the
methods. Mixing up the two, for instance watching a notifier inside a callback, remains the most
common mistake among newcomers.

## Reading async state without a stray boolean

An `AsyncNotifierProvider` doesn't return a raw `Future` but an `AsyncValue`, a sum type that
encodes the three possible states: data, loading, error. `.when(data:, loading:, error:)`
forces you to handle all three, which removes the `isLoading` boolean you forget to reset to
`false`.

To mutate an async state, the notifier's method goes through `AsyncValue.guard`, which captures
the exception and stores it in an `AsyncError` instead of letting it propagate.

```dart
// A method on the TodoList notifier above.
Future<void> add(Todo todo) async {
  final repo = ref.read(todoRepositoryProvider);
  state = const AsyncValue.loading();

  // guard() turns a thrown exception into an AsyncError state.
  state = await AsyncValue.guard(() async {
    await repo.create(todo);
    return repo.fetchAll();
  });
}
```

The UI doesn't need to change anything: it still watches the same `AsyncValue`, and its `.when`
shows the spinner while reloading, then the list, then an error message if the write failed.

## Global variables that aren't

A provider is declared as `final` at file level, which looks like a global variable.
The resemblance stops at first glance. The identifier serves as a key; the actual state lives in
a `ProviderContainer`. Two containers, two tests or two windows, share no state even
if they read the same provider.

With code generation, `@riverpod` makes the provider `autoDispose` by default: as soon as
nothing is listening to it anymore, its state is destroyed, then lazily recreated on the next read. To
keep a state alive, a cache or a session, you annotate it `@Riverpod(keepAlive: true)`. And
`ref.onDispose` releases a resource, for instance closing a socket, at cleanup time.

## The override as the normal path for testing

This is where Riverpod goes beyond `InheritedWidget`: every provider is **replaceable** when the
container is mounted. In tests, you inject a fake repository without touching the production code.

```dart
test('loads the current todo list', () async {
  final container = ProviderContainer(
    overrides: [
      todoRepositoryProvider.overrideWithValue(FakeTodoRepository()),
    ],
  );
  addTearDown(container.dispose);

  final todos = await container.read(todoListProvider.future);
  expect(todos, hasLength(3));
});
```

No global mock, no singleton to reset between two cases: each `ProviderContainer`
is isolated, and `addTearDown` guarantees its release. For a widget test, the same mechanism
goes through `ProviderScope(overrides: [...])` at the top of the tree. The [Riverpod testing
documentation](https://riverpod.dev/docs/essentials/testing) details the `pump` and
listening patterns.

## Splitting up a feature

The provider graph gives you a blueprint for splitting things up. A feature is organized into three layers, and the
providers are the seams that connect them.

The data layer exposes repositories through `Provider`s. The logic layer holds the notifiers, which
`watch` these repositories. The presentation layer contains nothing but `ConsumerWidget`s that `watch`
the notifiers and call their methods. A widget carries **no** business logic: it reads
and it delegates.

The direction stays one-way, from presentation to logic to data, like a classic
layered architecture, except that the wiring goes through `ref.watch` instead of a
constructor. Testing follows the same boundary: you replace the layer below with an override,
and verify the one above, in isolation.

> A Flutter architecture is measured by its testability: the logic must be verifiable without mounting a
> single widget. Riverpod places state outside the tree and makes overriding a first-
> class mechanism, which makes this verification possible by default.
