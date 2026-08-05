Una app Flutter que crece termina por plantear la misma pregunta: ¿dónde vive el estado, y cómo
probarlo sin arrancar un widget? `setState` suelda la lógica a la UI en la misma clase.
`InheritedWidget` propaga bien el dato pero no dice nada sobre su creación ni sobre su sustitución
en los tests. **Riverpod** aborda ambos problemas a la vez: es un contenedor de inyección de
dependencias que produce valores reactivos, declarados fuera del árbol de widgets y conectados
entre sí mediante un grafo tipado.

## Tres familias de providers

Riverpod expone el dato mediante `provider`, y tres formas cubren casi todas las
necesidades. Un `Provider` devuelve un valor inmutable (un cliente HTTP, un repositorio, una configuración).
Un `NotifierProvider` asocia un estado mutable a la lógica que lo hace evolucionar. Un
`AsyncNotifierProvider` hace lo mismo cuando el estado inicial es asíncrono: una llamada de red,
una lectura de base de datos.

Con la generación de código ([`riverpod_generator`](https://pub.dev/packages/riverpod_generator)),
no se instancia ninguno de estos tipos a mano. Se anota una función o una clase con
`@riverpod`, el generador produce el provider, y el `build()` devuelve el estado inicial.

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

Cada anotación genera un identificador tipado: `todoRepositoryProvider`, `counterProvider`,
`todoListProvider`. Es ese identificador el que consume el resto de la app, nunca la clase
directamente.

## El grafo de dependencias

El `ref.watch` dentro de un provider crea una **dependencia**. `todoListProvider` observa
`todoRepositoryProvider`, que observa `httpClientProvider`. Si uno cambia, todo lo que depende de él
se recalcula, sin cableado manual en cascada. Es un grafo dirigido, y como cada provider tiene
un tipo de retorno conocido en tiempo de compilación, un error de conexión se convierte en un error
de compilación en lugar de un fallo en tiempo de ejecución.

En cuanto a la lectura, `ref` se presenta en tres usos que hay que distinguir. `ref.watch` se suscribe: su
lugar está en un `build()`, ya sea de widget o de provider, para reaccionar al cambio. `ref.read` lee
una vez, sin suscripción: se usa en un manejador de eventos, para disparar un método. `ref.listen` registra un efecto
secundario (mostrar un error, navegar) sin reconstruir.

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

Observar el provider con `watch` da el valor; observar su `.notifier` da el objeto que lleva las
métodos. Confundir ambos, por ejemplo observar un notifier dentro de un callback, sigue siendo el error
más frecuente entre los recién llegados.

## Leer lo asíncrono sin un booleano suelto

Un `AsyncNotifierProvider` no devuelve un `Future` en bruto sino un `AsyncValue`, un tipo suma que
codifica los tres estados posibles: dato, carga, error. El `.when(data:, loading:, error:)`
obliga a tratar los tres, lo que elimina el booleano `isLoading` que se olvida devolver a
`false`.

Para mutar un estado asíncrono, el método del notifier pasa por `AsyncValue.guard`, que captura
la excepción y la guarda en un `AsyncError` en lugar de dejarla propagarse.

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

La UI no tiene que cambiar nada: sigue observando el mismo `AsyncValue`, y su `.when` muestra el
spinner durante la recarga, luego la lista, luego un mensaje si la escritura falló.

## Variables globales que no lo son

Un provider se declara en `final` a nivel de archivo, lo que parece una variable global.
El parecido se queda en la primera mirada. El identificador sirve de clave; el estado real vive en
un `ProviderContainer`. Dos containers, dos tests o dos ventanas, no comparten ningún estado aunque
lean el mismo provider.

Con la generación de código, `@riverpod` hace que el provider sea `autoDispose` por defecto: en cuanto
nada lo escucha, su estado se destruye, y luego se recrea de forma perezosa en la siguiente lectura. Para
mantener un estado con vida, una caché o una sesión, se anota `@Riverpod(keepAlive: true)`. Y
`ref.onDispose` libera un recurso, por ejemplo cerrar un socket, en el momento de la limpieza.

## El override como vía normal del test

Aquí es donde Riverpod supera a `InheritedWidget`: cada provider es **reemplazable** al montar
el container. En un test, se inyecta un repositorio falso sin tocar el código de producción.

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

Sin mock global, sin singleton que reinicializar entre dos casos: cada `ProviderContainer`
está aislado, y `addTearDown` garantiza su liberación. Para un test de widget, el mismo mecanismo
pasa por `ProviderScope(overrides: [...])` en la cima del árbol. La [documentación de los tests
de Riverpod](https://riverpod.dev/docs/essentials/testing) detalla los patrones de `pump` y
de escucha.

## Dividir una feature

El grafo de providers da un plano de división. Una feature se organiza en tres capas, y los
providers son las costuras que las conectan.

La capa de datos expone los repositorios mediante `Provider`. La capa de lógica contiene los notifiers, que
observan (`watch`) esos repositorios. La capa de presentación solo contiene `ConsumerWidget` que observan
los notifiers y llaman a sus métodos. Un widget no lleva **ninguna** lógica de negocio: lee
y delega.

La dirección sigue siendo de sentido único, de la presentación hacia la lógica hacia el dato, como una
arquitectura en capas clásica, salvo que el cableado pasa por `ref.watch` en lugar de un
constructor. El test sigue la misma frontera: se reemplaza la capa inferior con un override,
y se verifica la de arriba, de forma aislada.

> Una arquitectura Flutter se mide por su capacidad de prueba: la lógica debe poder verificarse sin montar un
> solo widget. Riverpod coloca el estado fuera del árbol y convierte el override en un mecanismo de primera
> clase, lo que hace posible esta verificación por defecto.
