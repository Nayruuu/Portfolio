Une app Flutter qui grossit finit par poser la même question : où vit l'état, et comment le
tester sans démarrer un widget ? `setState` soude la logique à l'UI dans la même classe.
`InheritedWidget` propage bien la donnée mais ne dit rien de sa création ni de son remplacement
en test. **Riverpod** traite les deux problèmes d'un coup : c'est un conteneur d'injection de
dépendances qui produit des valeurs réactives, déclarées hors de l'arbre de widgets et reliées
entre elles par un graphe typé.

## Trois familles de providers

Riverpod expose la donnée par des `provider`, et trois formes couvrent la quasi-totalité des
besoins. Un `Provider` renvoie une valeur immuable (un client HTTP, un dépôt, une configuration).
Un `NotifierProvider` associe un état mutable à la logique qui le fait évoluer. Un
`AsyncNotifierProvider` fait la même chose quand l'état initial est asynchrone : un appel réseau,
une lecture de base.

Avec la génération de code ([`riverpod_generator`](https://pub.dev/packages/riverpod_generator)),
on n'instancie aucun de ces types à la main. On annote une fonction ou une classe avec
`@riverpod`, le générateur produit le provider, et le `build()` renvoie l'état de départ.

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

Chaque annotation génère un identifiant typé : `todoRepositoryProvider`, `counterProvider`,
`todoListProvider`. C'est cet identifiant que le reste de l'app consomme, jamais la classe
directement.

## Le graphe de dépendances

Le `ref.watch` à l'intérieur d'un provider crée une **dépendance**. `todoListProvider` observe
`todoRepositoryProvider`, qui observe `httpClientProvider`. Si l'un change, tout ce qui en dépend
se recalcule, sans câblage manuel en cascade. C'est un graphe orienté, et comme chaque provider a
un type de retour connu à la compilation, une erreur de branchement devient une erreur de
compilation plutôt qu'un crash à l'exécution.

Côté lecture, `ref` se décline en trois usages qu'il faut distinguer. `ref.watch` s'abonne : sa
place est dans un `build()`, de widget ou de provider, pour réagir au changement. `ref.read` lit
une fois, sans abonnement : on l'utilise dans un gestionnaire d'événement, pour déclencher une
méthode. `ref.listen` enregistre un effet de bord (afficher une erreur, naviguer) sans reconstruire.

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

Watcher le provider donne la valeur ; watcher son `.notifier` donne l'objet qui porte les
méthodes. Confondre les deux, par exemple watcher un notifier dans un callback, reste l'erreur la
plus fréquente chez les nouveaux venus.

## Lire l'asynchrone sans booléen baladeur

Un `AsyncNotifierProvider` ne renvoie pas un `Future` brut mais un `AsyncValue`, un type somme qui
encode les trois états possibles : donnée, chargement, erreur. Le `.when(data:, loading:, error:)`
force à traiter les trois, ce qui supprime le booléen `isLoading` qu'on oublie de remettre à
`false`.

Pour muter un état asynchrone, la méthode du notifier passe par `AsyncValue.guard`, qui capture
l'exception et la range dans un `AsyncError` au lieu de la laisser remonter.

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

L'UI n'a rien à changer : elle observe toujours le même `AsyncValue`, et son `.when` affiche le
spinner pendant le rechargement, puis la liste, puis un message si l'écriture a échoué.

## Des variables globales qui n'en sont pas

Un provider se déclare en `final` au niveau du fichier, ce qui ressemble à une variable globale.
La ressemblance s'arrête au premier coup d'œil. L'identifiant sert de clé ; l'état réel vit dans
un `ProviderContainer`. Deux containers, deux tests ou deux fenêtres, ne partagent aucun état même
s'ils lisent le même provider.

Avec la génération de code, `@riverpod` rend le provider `autoDispose` par défaut : dès que plus
rien ne l'écoute, son état est détruit, puis recréé paresseusement à la prochaine lecture. Pour
garder un état en vie, un cache ou une session, on l'annote `@Riverpod(keepAlive: true)`. Et
`ref.onDispose` libère une ressource, par exemple fermer un socket, au moment du nettoyage.

## L'override comme voie normale du test

C'est ici que Riverpod dépasse `InheritedWidget` : chaque provider est **remplaçable** au montage
du container. En test, on injecte un faux dépôt sans toucher au code de production.

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

Pas de mock global, pas de singleton à réinitialiser entre deux cas : chaque `ProviderContainer`
est isolé, et `addTearDown` garantit sa libération. Pour un test de widget, le même mécanisme
passe par `ProviderScope(overrides: [...])` au sommet de l'arbre. La [documentation des tests
Riverpod](https://riverpod.dev/docs/essentials/testing) détaille les patterns de `pump` et
d'écoute.

## Découper une feature

Le graphe de providers donne un plan de découpe. Une feature s'organise en trois couches, et les
providers sont les coutures qui les relient.

La couche donnée expose les dépôts par des `Provider`. La couche logique tient les notifiers, qui
`watch`ent ces dépôts. La couche présentation ne contient que des `ConsumerWidget` qui `watch`ent
les notifiers et appellent leurs méthodes. Un widget ne porte **aucune** logique métier : il lit
et il délègue.

La direction reste à sens unique, de la présentation vers la logique vers la donnée, comme une
architecture en couches classique, sauf que le câblage passe par `ref.watch` au lieu d'un
constructeur. Le test suit la même frontière : on remplace la couche du dessous par un override,
et on vérifie celle du dessus, isolément.

> Une architecture Flutter se mesure à sa testabilité : la logique doit se vérifier sans monter un
> seul widget. Riverpod place l'état hors de l'arbre et fait de l'override un mécanisme de première
> classe, ce qui rend cette vérification possible par défaut.
