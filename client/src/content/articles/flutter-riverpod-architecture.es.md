Una app Flutter que crece siempre termina planteando la misma pregunta: ¿dónde vive el estado, y
cómo probarlo sin arrancar un widget? `setState` mezcla lógica y UI en la misma
clase; `InheritedWidget` propaga bien el dato pero no dice nada sobre su creación ni sobre su
sustitución en pruebas. **Riverpod** responde a ambas cuestiones: un contenedor de inyección de dependencias
que produce valores reactivos, independientes del árbol de widgets.

## Providers y notifiers

Un `Provider` expone un valor; un `Notifier` expone un valor **mutable** junto con la
lógica que lo hace evolucionar. Con la generación de código (`riverpod_generator`), se anota una
clase y el `build()` devuelve el estado inicial:

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

El `ref.watch` dentro de un provider crea una **dependencia**: si `apiClientProvider`
cambia, `currentUser` se recalcula automáticamente. Es el grafo de dependencias el que
sustituye a los `setState` manuales en cascada.

## Separar la UI de la lógica

Un widget no contiene **ninguna** lógica de negocio: lee el estado y llama a métodos.
Toda la mecánica vive en el notifier, comprobable sin `WidgetTester`:

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

En cuanto a la lectura asíncrona, un `ref.watch(currentUserProvider)` devuelve un `AsyncValue`, cuyo
`.when(data:, loading:, error:)` cubre los tres estados **sin un booleano `isLoading` errante**.

## Inyección de dependencias y overrides en pruebas

Aquí es donde Riverpod supera a `InheritedWidget`: cada provider es **sustituible** al
montar el `ProviderContainer`. En pruebas, se inyecta un cliente API falso sin tocar el código de
producción:

```dart
test('carga el usuario actual', () async {
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

Sin mock global, sin singleton que reinicializar entre pruebas: cada container está
aislado, y `addTearDown` garantiza que se libera. La [documentación de pruebas de
Riverpod](https://riverpod.dev/docs/essentials/testing) detalla los patrones de `pump` y de
listeners.

## Por qué no setState o InheritedWidget

`setState` reconstruye todo el `State` y mantiene la lógica soldada a la UI: imposible de probar
sin renderizar el widget. `InheritedWidget` comparte un valor pero obliga a escribir a mano el
`updateShouldNotify`, no gestiona ni lo asíncrono ni la sustitución, y tiene fugas en cuanto se
toca el `BuildContext`.

Riverpod desplaza el estado **fuera del árbol**, lo hace perezoso y memoizado, lo libera
automáticamente (`autoDispose`) y convierte el override en la vía normal de las pruebas.

> Da igual el número de providers: una arquitectura Flutter se juzga por la posibilidad de
> probar la lógica **sin montar jamás un widget**. Con Riverpod, es así por
> construcción.
