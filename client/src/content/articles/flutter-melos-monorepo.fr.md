Un produit Flutter sérieux n'est jamais un seul package : il y a l'app mobile, un design
system, un client API, peut-être un module de fonctionnalité par équipe. Les garder dans des
dépôts séparés transforme chaque changement transverse en valse de `pub publish` et de bumps
de version. **Melos** gère ce monorepo Dart/Flutter : un dépôt, plusieurs packages, des
commandes qui s'exécutent partout d'un coup.

## Découper en packages

On range les packages sous un dossier (souvent `packages/`) et on les déclare dans la racine.
Chacun garde son propre `pubspec.yaml` ; l'app référence les autres en **dépendances de
chemin**, et Melos relie tout localement :

```dart
// packages/feature_auth/lib/feature_auth.dart
import 'package:core_api/core_api.dart';

class AuthRepository {
  AuthRepository(this._api);
  final ApiClient _api;

  Future<Session> signIn(String email, String password) {
    return _api.post('/auth/login', {'email': email, 'password': password});
  }
}
```

La frontière entre packages devient une **frontière d'architecture** : `feature_auth` dépend
de `core_api`, jamais l'inverse. Le graphe de dépendances est explicite, vérifiable, et casse
la compilation dès qu'on l'enfreint.

## Le fichier melos.yaml

Le cœur de la configuration déclare les packages et des **scripts** réutilisables, exécutés sur
l'ensemble du graphe :

```yaml
name: my_app
packages:
  - app
  - packages/**

scripts:
  analyze:
    run: melos exec -- dart analyze .
  test:
    run: melos exec --dir-exists=test -- flutter test
    description: Lance les tests de chaque package qui en a.
```

`melos exec` lance une commande dans chaque package ; les filtres comme `--dir-exists=test` ou
`--diff` ciblent un sous-ensemble — par exemple **uniquement les packages modifiés** depuis la
branche principale, ce qui accélère beaucoup la CI.

## Bootstrap et liaison

`melos bootstrap` (ou `melos bs`) est la commande clé : elle installe les dépendances de tous
les packages **et** résout les dépendances de chemin entre eux. Plus de `flutter pub get`
manuel package par package, plus de versions désynchronisées. On l'exécute après chaque
`git clone` et après tout changement de `pubspec.yaml`. La [documentation de
Melos](https://melos.invertase.dev/) décrit chaque filtre et chaque hook.

## Versioning et CI

Melos s'appuie sur les **commits conventionnels** : `melos version` lit l'historique, calcule
le bump de chaque package touché, met à jour les `CHANGELOG.md` et propage les nouvelles
versions aux packages dépendants. Un `fix:` dans `core_api` fait monter `core_api` **et** tout
ce qui en dépend, de façon cohérente.

- `melos bootstrap` → installe et relie l'ensemble
- `melos run analyze` → analyse statique partout
- `melos run test` → tests sur tout le graphe
- `melos version` → bumps + changelogs depuis les commits

En CI, l'enchaînement type est `bootstrap`, puis `analyze`, puis `test` — souvent restreint aux
packages modifiés via `--diff=origin/main` pour ne pas rejouer l'ensemble à chaque push.

> Un monorepo n'est pas qu'un rangement de dossiers : c'est la promesse qu'un changement
> transverse reste **un seul commit, un seul build, une seule revue**. Melos fait tenir cette
> promesse pour Flutter.
