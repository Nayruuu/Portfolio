Una app Flutter que crece siempre acaba planteando la misma pregunta: ¿dónde vive el estado y cómo se prueba sin arrancar un widget? `setState` mezcla lógica e interfaz en la misma clase; `InheritedWidget` propaga bien el dato pero no dice nada de su creación ni de su reemplazo en pruebas. **Riverpod** responde a ambas: un contenedor de inyección de dependencias que produce valores reactivos, independientes del árbol de widgets.

## Providers y notifiers

Un `Provider` expone un valor; un `Notifier` expone un valor **mutable** acompañado de la lógica que lo hace evolucionar. Con la generación de código (`riverpod_generator`), se anota una clase y el `build()` devuelve el estado inicial:

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

El `ref.watch` dentro de un provider crea una **dependencia**: si `apiClientProvider` cambia, `currentUser` se recalcula automáticamente. Es el grafo de dependencias lo que reemplaza los `setState` manuales en cascada.

## Separar la interfaz de la lógica

La regla de oro: un widget no contiene **ninguna** lógica de negocio. Lee el estado y llama a métodos. Toda la mecánica vive en el notifier, testeable sin `WidgetTester`:

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

En cuanto a la lectura asíncrona, un `ref.watch(currentUserProvider)` devuelve un `AsyncValue`, cuyo `.when(data:, loading:, error:)` cubre los tres estados **sin un booleano `isLoading` vagabundo**.

## Inyección de dependencias y overrides en pruebas

Aquí es donde Riverpod supera a `InheritedWidget`: cada provider es **reemplazable** al montar el `ProviderContainer`. En pruebas, se inyecta un cliente API falso sin tocar el código de producción:

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

Sin mock global, sin singleton que reinicializar entre pruebas: cada container está aislado, y `addTearDown` garantiza que se libere. La [documentación de pruebas de Riverpod](https://riverpod.dev/docs/essentials/testing) detalla los patrones de `pump` y de listeners.

## Por qué no setState ni InheritedWidget

`setState` reconstruye todo el `State` y mantiene la lógica soldada a la interfaz — imposible de probar sin renderizar el widget. `InheritedWidget` comparte un valor pero obliga a escribir manualmente el `updateShouldNotify`, no gestiona ni la asincronía ni el reemplazo, y se escapa en cuanto se toca el `BuildContext`. Riverpod desplaza el estado **fuera del árbol**, lo hace perezoso, memoizado y auto-eliminado (`autoDispose`), y convierte el override en la vía normal de prueba.

> Una buena arquitectura Flutter no se mide por el número de providers, sino por esto: ¿se puede probar la lógica **sin montar nunca un widget**? Con Riverpod, la respuesta es sí por construcción.
