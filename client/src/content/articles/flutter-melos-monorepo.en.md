A serious Flutter product is never a single package: there's the mobile app, a design system,
an API client, maybe one feature module per team. Keeping them in separate repos turns every
cross-cutting change into a dance of `pub publish` and version bumps. **Melos** manages this
Dart/Flutter monorepo: one repo, many packages, commands that run across all of them at once.

## Splitting into packages

You put the packages under a folder (often `packages/`) and declare them at the root. Each
keeps its own `pubspec.yaml`; the app references the others as **path dependencies**, and Melos
links everything locally:

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

The boundary between packages becomes an **architectural boundary**: `feature_auth` depends on
`core_api`, never the other way around. The dependency graph is explicit, verifiable, and
breaks the build the moment you violate it.

## The melos.yaml file

The heart of the configuration declares the packages and reusable **scripts**, run across the
whole graph:

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
    description: Runs the tests of every package that has any.
```

`melos exec` runs a command in each package; filters like `--dir-exists=test` or `--diff` target
a subset — for example **only the packages changed** since the main branch, which speeds CI up
considerably.

## Bootstrap and linking

`melos bootstrap` (or `melos bs`) is the key command: it installs the dependencies of every
package **and** resolves the path dependencies between them. No more manual `flutter pub get`
package by package, no more drifting versions. You run it after every `git clone` and after any
`pubspec.yaml` change. The [Melos documentation](https://melos.invertase.dev/) describes every
filter and hook.

## Versioning and CI

Melos builds on **conventional commits**: `melos version` reads the history, computes the bump
for each touched package, updates the `CHANGELOG.md` files, and propagates the new versions to
dependent packages. A `fix:` in `core_api` bumps `core_api` **and** everything that depends on
it, consistently.

- `melos bootstrap` → install and link everything
- `melos run analyze` → static analysis everywhere
- `melos run test` → tests across the whole graph
- `melos version` → bumps + changelogs from commits

In CI, the typical chain is `bootstrap`, then `analyze`, then `test` — often restricted to the
changed packages via `--diff=origin/main` so you don't replay the whole graph on every push.

> A monorepo isn't just a tidy folder layout: it's the promise that a cross-cutting change stays
> **one commit, one build, one review**. Melos keeps that promise for Flutter.
