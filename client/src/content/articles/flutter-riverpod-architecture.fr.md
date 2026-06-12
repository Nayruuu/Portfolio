Une app Flutter qui grossit finit toujours par poser la même question : où vit l'état, et
comment le tester sans démarrer un widget ? `setState` mélange logique et UI dans la même
classe ; `InheritedWidget` propage bien la donnée mais ne dit rien de sa création ni de son
remplacement en test. **Riverpod** répond aux deux : un conteneur d'injection de dépendances
qui produit des valeurs réactives, indépendantes de l'arbre de widgets.

## Providers et notifiers

Un `Provider` expose une valeur ; un `Notifier` expose une valeur **mutable** assortie de la
logique qui la fait évoluer. Avec la génération de code (`riverpod_generator`), on annote une
classe et le `build()` renvoie l'état initial :

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

Le `ref.watch` à l'intérieur d'un provider crée une **dépendance** : si `apiClientProvider`
change, `currentUser` se recalcule automatiquement. C'est le graphe de dépendances qui
remplace les `setState` manuels en cascade.

## Séparer l'UI de la logique

La règle d'or : un widget ne contient **aucune** logique métier. Il lit l'état et appelle des
méthodes. Toute la mécanique vit dans le notifier, testable sans `WidgetTester` :

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

Côté lecture asynchrone, un `ref.watch(currentUserProvider)` renvoie un `AsyncValue`, dont le
`.when(data:, loading:, error:)` couvre les trois états **sans booléen `isLoading` baladeur**.

## Injection de dépendances et overrides en test

C'est là que Riverpod surpasse `InheritedWidget` : chaque provider est **remplaçable** au
montage du `ProviderContainer`. En test, on injecte un faux client API sans toucher au code de
production :

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

Pas de mock global, pas de singleton à réinitialiser entre les tests : chaque container est
isolé, et `addTearDown` garantit qu'il est libéré. La [documentation des tests
Riverpod](https://riverpod.dev/docs/essentials/testing) détaille les patterns de `pump` et de
listeners.

## Pourquoi pas setState ou InheritedWidget

`setState` reconstruit tout le `State` et garde la logique soudée à l'UI — impossible à tester
sans rendre le widget. `InheritedWidget` partage une valeur mais impose d'écrire à la main le
`updateShouldNotify`, ne gère ni l'asynchrone ni le remplacement, et fuit dès qu'on touche au
`BuildContext`. Riverpod déplace l'état **hors de l'arbre**, le rend paresseux, mémoïsé et
auto-disposé (`autoDispose`), et fait de l'override la voie normale du test.

> Une bonne architecture Flutter ne se mesure pas au nombre de providers, mais à ceci :
> peut-on tester la logique **sans jamais monter un widget** ? Avec Riverpod, la réponse est
> oui par construction.
