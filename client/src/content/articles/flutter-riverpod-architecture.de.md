Eine Flutter-App, die wächst, stellt irgendwann dieselbe Frage: Wo lebt der State, und wie testet
man ihn, ohne ein Widget zu starten? `setState` verschweißt die Logik mit der UI in derselben
Klasse. `InheritedWidget` propagiert die Daten zwar, sagt aber nichts über ihre Erzeugung oder
ihren Austausch im Test aus. **Riverpod** löst beide Probleme auf einmal: Es ist ein
Dependency-Injection-Container, der reaktive Werte erzeugt, die außerhalb des Widget-Baums
deklariert und über einen typisierten Graphen miteinander verbunden sind.

## Drei Provider-Familien

Riverpod stellt Daten über `provider` bereit, und drei Formen decken fast alle Bedürfnisse ab. Ein
`Provider` liefert einen unveränderlichen Wert (einen HTTP-Client, ein Repository, eine
Konfiguration). Ein `NotifierProvider` verbindet einen veränderlichen State mit der Logik, die ihn
weiterentwickelt. Ein `AsyncNotifierProvider` macht dasselbe, wenn der initiale State asynchron
ist: ein Netzwerkaufruf, ein Datenbankzugriff.

Mit der Codegenerierung ([`riverpod_generator`](https://pub.dev/packages/riverpod_generator))
instanziiert man keinen dieser Typen von Hand. Man annotiert eine Funktion oder eine Klasse mit
`@riverpod`, der Generator erzeugt den Provider, und `build()` liefert den Anfangszustand.

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

Jede Annotation erzeugt einen typisierten Identifier: `todoRepositoryProvider`,
`counterProvider`, `todoListProvider`. Diesen Identifier konsumiert der Rest der App, niemals die
Klasse direkt.

## Der Abhängigkeitsgraph

Das `ref.watch` innerhalb eines Providers erzeugt eine **Abhängigkeit**. `todoListProvider`
beobachtet `todoRepositoryProvider`, der wiederum `httpClientProvider` beobachtet. Ändert sich
einer, wird alles, was davon abhängt, neu berechnet, ohne manuelle Verkettung. Es handelt sich um
einen gerichteten Graphen, und da jeder Provider einen zur Kompilierzeit bekannten Rückgabetyp
hat, wird ein Verdrahtungsfehler zum Kompilierfehler statt zum Laufzeit-Crash.

Beim Lesen gliedert sich `ref` in drei Verwendungsarten, die man unterscheiden muss. `ref.watch`
abonniert: Sein Platz ist in einem `build()`, sei es von Widget oder Provider, um auf Änderungen
zu reagieren. `ref.read` liest einmalig, ohne Abonnement: Man verwendet es in einem
Event-Handler, um eine Methode auszulösen. `ref.listen` registriert einen Seiteneffekt (einen
Fehler anzeigen, navigieren), ohne neu zu bauen.

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

Den Provider zu watchen liefert den Wert; seinen `.notifier` zu watchen liefert das Objekt, das
die Methoden trägt. Beides zu verwechseln, etwa einen Notifier in einem Callback zu watchen,
bleibt der häufigste Fehler bei Neueinsteigern.

## Asynchrones lesen, ohne herumirrenden Booleschen Wert

Ein `AsyncNotifierProvider` liefert kein rohes `Future`, sondern einen `AsyncValue`, einen
Summentyp, der die drei möglichen Zustände kodiert: Daten, Laden, Fehler. Das `.when(data:,
loading:, error:)` zwingt dazu, alle drei zu behandeln, was den `isLoading`-Booleschen Wert
überflüssig macht, den man vergisst, wieder auf `false` zu setzen.

Um einen asynchronen State zu mutieren, geht die Methode des Notifiers über `AsyncValue.guard`,
das die Exception abfängt und sie in einen `AsyncError` einordnet, statt sie durchzureichen.

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

Die UI muss nichts ändern: Sie beobachtet weiterhin denselben `AsyncValue`, und ihr `.when` zeigt
den Spinner während des Neuladens, dann die Liste, dann eine Fehlermeldung, falls das Schreiben
fehlgeschlagen ist.

## Globale Variablen, die keine sind

Ein Provider wird als `final` auf Dateiebene deklariert, was auf den ersten Blick wie eine globale
Variable aussieht. Die Ähnlichkeit endet dort. Der Identifier dient als Schlüssel; der eigentliche
State lebt in einem `ProviderContainer`. Zwei Container, zwei Tests oder zwei Fenster, teilen sich
keinen State, selbst wenn sie denselben Provider lesen.

Mit der Codegenerierung macht `@riverpod` den Provider standardmäßig `autoDispose`: Sobald ihn
niemand mehr abhört, wird sein State zerstört und dann bei der nächsten Lektüre lazy neu erzeugt.
Um einen State am Leben zu halten, einen Cache oder eine Session, annotiert man ihn mit
`@Riverpod(keepAlive: true)`. Und `ref.onDispose` gibt eine Ressource frei, zum Beispiel einen
Socket zu schließen, im Moment der Bereinigung.

## Das Override als normaler Testweg

Hier übertrifft Riverpod `InheritedWidget`: Jeder Provider ist beim Aufbau des Containers
**ersetzbar**. Im Test injiziert man ein Fake-Repository, ohne den Produktionscode anzufassen.

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

Kein globaler Mock, kein Singleton, das zwischen zwei Fällen zurückgesetzt werden muss: Jeder
`ProviderContainer` ist isoliert, und `addTearDown` garantiert seine Freigabe. Für einen
Widget-Test läuft derselbe Mechanismus über `ProviderScope(overrides: [...])` an der Spitze des
Baums. Die [Riverpod-Testdokumentation](https://riverpod.dev/docs/essentials/testing) beschreibt
die `pump`- und Listening-Patterns im Detail.

## Ein Feature aufteilen

Der Provider-Graph liefert einen Aufteilungsplan. Ein Feature organisiert sich in drei Schichten,
und die Provider sind die Nähte, die sie verbinden.

Die Datenschicht stellt die Repositories über `Provider` bereit. Die Logikschicht hält die
Notifier, die diese Repositories `watch`en. Die Präsentationsschicht enthält nur
`ConsumerWidget`s, die die Notifier `watch`en und deren Methoden aufrufen. Ein Widget trägt
**keine** Geschäftslogik: Es liest und delegiert.

Die Richtung bleibt einseitig, von der Präsentation zur Logik zu den Daten, wie bei einer
klassischen Schichtenarchitektur, außer dass die Verdrahtung über `ref.watch` statt über einen
Konstruktor läuft. Der Test folgt derselben Grenze: Man ersetzt die darunterliegende Schicht durch
ein Override und überprüft die darüberliegende, isoliert.

> Eine Flutter-Architektur bemisst sich an ihrer Testbarkeit: Die Logik muss sich überprüfen
> lassen, ohne ein einziges Widget zu montieren. Riverpod platziert den State außerhalb des Baums
> und macht das Override zu einem erstklassigen Mechanismus, was diese Überprüfung standardmäßig
> möglich macht.
