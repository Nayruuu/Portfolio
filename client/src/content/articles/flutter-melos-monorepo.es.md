## Dividir en packages

Los packages se organizan bajo una carpeta (habitualmente `packages/`) y se declaran en la raíz.
Cada uno conserva su propio `pubspec.yaml`; la app referencia los demás como **dependencias de
ruta**, y Melos los enlaza todos localmente:

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

El límite entre packages se convierte en una **frontera de arquitectura**: `feature_auth` depende
de `core_api`, nunca al revés. El grafo de dependencias es explícito, verificable, y rompe
la compilación en cuanto se infringe.

## El archivo melos.yaml

El núcleo de la configuración declara los packages y los **scripts** reutilizables, ejecutados sobre
el conjunto del grafo:

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

`melos exec` lanza un comando en cada package; los filtros como `--dir-exists=test` o
`--diff` apuntan a un subconjunto — por ejemplo **únicamente los packages modificados** desde la
rama principal, lo que acelera considerablemente la CI.

## Bootstrap y enlace

`melos bootstrap` (o `melos bs`) es el comando clave: instala las dependencias de todos
los packages **y** resuelve las dependencias de ruta entre ellos. Sin más `flutter pub get`
manuales package por package, sin versiones desincronizadas. Se ejecuta después de cada
`git clone` y tras cualquier cambio en `pubspec.yaml`. La [documentación de
Melos](https://melos.invertase.dev/) describe cada filtro y cada hook.

## Versionado y CI

Melos se apoya en los **commits convencionales**: `melos version` lee el historial, calcula
el bump de cada package afectado, actualiza los `CHANGELOG.md` y propaga las nuevas
versiones a los packages dependientes. Un `fix:` en `core_api` incrementa `core_api` **y** todo
lo que depende de él, de forma coherente.

- `melos bootstrap` → instala y enlaza el conjunto
- `melos run analyze` → análisis estático en todos
- `melos run test` → tests sobre todo el grafo
- `melos version` → bumps + changelogs desde los commits

En CI, la secuencia típica es `bootstrap`, luego `analyze`, luego `test` — habitualmente restringida a los
packages modificados mediante `--diff=origin/main` para no reejecutar todo en cada push.

> Un monorepo no es solo una organización de carpetas: es la promesa de que un cambio
> transversal sigue siendo **un único commit, un único build, una única revisión**. Melos hace
> que esa promesa se cumpla para Flutter.
