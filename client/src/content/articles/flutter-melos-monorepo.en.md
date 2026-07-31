A serious Flutter product is never a single package: there's the mobile app, a design
system, an API client, maybe a feature module per team. Keeping them in separate
repositories forces, for every cross-cutting change, a chain of `pub publish` and version
bumps in the right order. **Melos** manages this Dart/Flutter monorepo: one repository,
multiple packages, commands that run everywhere at once.

## Splitting into packages

Packages are arranged under a folder (often `packages/`) and declared at the root.
Each keeps its own `pubspec.yaml`; the app references the others as **path
dependencies**, and Melos links everything locally:

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

The boundary between packages becomes an **architectural boundary**: `feature_auth`
depends on `core_api`, never the other way around. The dependency graph is explicit,
verifiable, and breaks the build as soon as it's violated.

## The melos.yaml file

The core of the configuration declares the packages and reusable **scripts**, run
across the whole graph:

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

`melos exec` runs a command in each package; filters like `--dir-exists=test` or
`--diff` target a subset: for example **only the packages changed** since the main
branch, which speeds up CI a lot.

## Bootstrap and linking

`melos bootstrap` (or `melos bs`) is the key command: it installs the dependencies of
all the packages **and** resolves the path dependencies between them. No more running
`flutter pub get` package by package or resyncing versions by hand. It's run after
every `git clone` and after any change to a `pubspec.yaml`. The
[Melos documentation](https://melos.invertase.dev/) describes every filter and every hook.

## Versioning and CI

Melos relies on **conventional commits**: `melos version` reads the history, computes
the bump for each touched package, updates the `CHANGELOG.md` files and propagates the
new versions to dependent packages. A `fix:` in `core_api` bumps `core_api` **and**
everything that depends on it, consistently.

- `melos bootstrap` → installs and links everything
- `melos run analyze` → static analysis everywhere
- `melos run test` → tests across the whole graph
- `melos version` → bumps + changelogs from the commits

In CI, the typical sequence is `bootstrap`, then `analyze`, then `test`, often
restricted to the changed packages via `--diff=origin/main` so as not to replay
everything on every push.

> The value of a monorepo is measured on a cross-cutting change: **a single commit, a
> single build, a single review**. Melos makes this workflow sustainable for Flutter.
