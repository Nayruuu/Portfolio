Eine Flutter-App, die wächst, wirft am Ende immer dieselbe Frage auf: Wo lebt der Zustand, und wie testet man ihn, ohne ein Widget zu starten? `setState` vermischt Logik und UI in derselben Klasse; `InheritedWidget` propagiert die Daten gut, sagt aber nichts über ihre Erstellung oder ihren Austausch im Test. **Riverpod** beantwortet beides: ein Dependency-Injection-Container, der reaktive Werte erzeugt, unabhängig vom Widget-Baum.

## Providers und Notifiers

Ein `Provider` stellt einen Wert bereit; ein `Notifier` stellt einen **veränderlichen** Wert zusammen mit der Logik bereit, die ihn weiterentwickelt. Mit Code-Generierung (`riverpod_generator`) annotiert man eine Klasse, und `build()` liefert den Anfangszustand:

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

Das `ref.watch` innerhalb eines Providers erzeugt eine **Abhängigkeit**: Ändert sich `apiClientProvider`, wird `currentUser` automatisch neu berechnet. Dieser Abhängigkeitsgraph ersetzt manuelle `setState`-Kaskaden.

## UI von Logik trennen

Die Grundregel: Ein Widget enthält **keine** Geschäftslogik. Es liest den Zustand und ruft Methoden auf. Die gesamte Mechanik lebt im Notifier, testbar ohne `WidgetTester`:

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

Beim asynchronen Lesen liefert `ref.watch(currentUserProvider)` einen `AsyncValue`, dessen `.when(data:, loading:, error:)` alle drei Zustände abdeckt — **ohne herumgereichten `isLoading`-Boolean**.

## Dependency Injection und Overrides im Test

Hier übertrifft Riverpod `InheritedWidget`: Jeder Provider ist beim Erstellen des `ProviderContainer` **austauschbar**. Im Test injiziert man einen gefälschten API-Client, ohne den Produktionscode anzufassen:

```dart
test('charge l_utilisateur courant', () async {
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

Kein globales Mock, kein Singleton, das zwischen Tests zurückgesetzt werden muss: Jeder Container ist isoliert, und `addTearDown` stellt sicher, dass er freigegeben wird. Die [Riverpod-Testdokumentation](https://riverpod.dev/docs/essentials/testing) beschreibt die `pump`- und Listener-Patterns im Detail.

## Warum nicht setState oder InheritedWidget

`setState` baut den gesamten `State` neu auf und koppelt die Logik fest an die UI — ohne Widget-Rendering kein Test möglich. `InheritedWidget` teilt einen Wert, erfordert aber manuelles Schreiben von `updateShouldNotify`, unterstützt weder Asynchronität noch Austausch und verliert sich sobald man den `BuildContext` berührt. Riverpod verschiebt den Zustand **aus dem Baum heraus**, macht ihn lazy, memoisiert und automatisch freigegeben (`autoDispose`), und macht den Override zum normalen Testweg.

> Eine gute Flutter-Architektur misst sich nicht an der Anzahl der Provider, sondern daran: Kann man die Logik **testen, ohne jemals ein Widget zu mounten**? Mit Riverpod lautet die Antwort per Konstruktion: ja.
