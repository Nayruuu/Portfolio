Eine Flutter-App, die wächst, stellt am Ende immer dieselbe Frage: Wo lebt der State, und
wie testet man ihn, ohne ein Widget zu starten? `setState` vermischt Logik und UI in derselben
Klasse; `InheritedWidget` verteilt die Daten zwar gut, sagt aber nichts über ihre Erstellung oder
ihren Austausch im Test aus. **Riverpod** beantwortet beides: ein Dependency-Injection-Container,
der reaktive Werte erzeugt, unabhängig vom Widget-Baum.

## Providers und Notifiers

Ein `Provider` stellt einen Wert bereit; ein `Notifier` stellt einen **veränderlichen** Wert
zusammen mit der Logik bereit, die ihn verändert. Mit Codegenerierung (`riverpod_generator`)
annotiert man eine Klasse, und `build()` liefert den initialen State zurück:

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

Das `ref.watch` innerhalb eines Providers erzeugt eine **Abhängigkeit**: Ändert sich
`apiClientProvider`, wird `currentUser` automatisch neu berechnet. Es ist der
Abhängigkeitsgraph, der die manuellen, kaskadierenden `setState`-Aufrufe ersetzt.

## UI und Logik trennen

Ein Widget enthält **keine** Geschäftslogik: Es liest den State und ruft Methoden auf. Die
gesamte Mechanik lebt im Notifier, testbar ohne `WidgetTester`:

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

Beim asynchronen Lesen liefert ein `ref.watch(currentUserProvider)` einen `AsyncValue`, dessen
`.when(data:, loading:, error:)` alle drei Zustände abdeckt, **ohne herumirrenden
`isLoading`-Boolean**.

## Dependency Injection und Overrides im Test

Genau hier übertrifft Riverpod `InheritedWidget`: Jeder Provider ist beim Aufbau des
`ProviderContainer` **austauschbar**. Im Test injiziert man einen Fake-API-Client, ohne den
Produktionscode anzufassen:

```dart
test('lädt den aktuellen Benutzer', () async {
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

Kein globaler Mock, kein Singleton, das zwischen Tests zurückgesetzt werden muss: Jeder
Container ist isoliert, und `addTearDown` garantiert, dass er freigegeben wird. Die
[Riverpod-Testdokumentation](https://riverpod.dev/docs/essentials/testing) beschreibt die
`pump`- und Listener-Patterns im Detail.

## Warum nicht setState oder InheritedWidget

`setState` baut den gesamten `State` neu auf und lässt die Logik an die UI geschweißt:
unmöglich zu testen, ohne das Widget zu rendern. `InheritedWidget` teilt zwar einen Wert,
zwingt aber dazu, `updateShouldNotify` von Hand zu schreiben, behandelt weder Asynchronität
noch Austausch und wird undicht, sobald man den `BuildContext` anfasst.

Riverpod verlagert den State **aus dem Baum heraus**, macht ihn lazy, memoisiert ihn und gibt
ihn automatisch frei (`autoDispose`), und macht das Override zum normalen Weg im Test.

> Egal wie viele Provider es gibt: Eine Flutter-Architektur bemisst sich daran, ob sich die
> Logik testen lässt, **ohne jemals ein Widget aufzubauen**. Mit Riverpod ist das per
> Konstruktion der Fall.
