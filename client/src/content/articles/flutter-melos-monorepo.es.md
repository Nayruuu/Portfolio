Un producto Flutter serio nunca es un solo package: está la app móvil, un design
system, un cliente API, quizás un módulo de funcionalidad por equipo. Mantenerlos en
repositorios separados impone, para cada cambio transversal, una serie de `pub publish` y de
bumps de versión en el orden correcto. **Melos** gestiona este monorepo Dart/Flutter: un repositorio,
varios packages, comandos que se ejecutan en todos a la vez.

## Dividir en packages

Se ordenan los packages bajo una carpeta (a menudo `packages/`) y se declaran en la raíz.
Cada uno mantiene su propio `pubspec.yaml`; la app referencia los demás como **dependencias de
ruta**, y Melos conecta todo localmente:

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

La frontera entre packages se convierte en una **frontera de arquitectura**: `feature_auth` depende
de `core_api`, nunca al revés. El grafo de dependencias es explícito, verificable, y rompe
la compilación en cuanto se infringe.

## El archivo melos.yaml

El núcleo de la configuración declara los packages y unos **scripts** reutilizables, ejecutados sobre
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
    description: Lanza los tests de cada package que los tenga.
```

`melos exec` lanza un comando en cada package; los filtros como `--dir-exists=test` o
`--diff` apuntan a un subconjunto: por ejemplo **solo los packages modificados** desde la
rama principal, lo que acelera mucho la CI.

## Bootstrap y vinculación

`melos bootstrap` (o `melos bs`) es el comando clave: instala las dependencias de todos
los packages **y** resuelve las dependencias de ruta entre ellos. Ya no hace falta lanzar
`flutter pub get` package por package ni resincronizar las versiones a mano. Se
ejecuta después de cada `git clone` y después de cualquier cambio en `pubspec.yaml`. La
[documentación de Melos](https://melos.invertase.dev/) describe cada filtro y cada hook.

## Versionado y CI

Melos se apoya en los **commits convencionales**: `melos version` lee el historial, calcula
el bump de cada package afectado, actualiza los `CHANGELOG.md` y propaga las nuevas
versiones a los packages dependientes. Un `fix:` en `core_api` hace subir `core_api` **y** todo
lo que depende de él, de forma coherente.

- `melos bootstrap` → instala y conecta el conjunto
- `melos run analyze` → análisis estático en todas partes
- `melos run test` → tests sobre todo el grafo
- `melos version` → bumps + changelogs a partir de los commits

En CI, la secuencia típica es `bootstrap`, luego `analyze`, luego `test`, a menudo restringida a
los packages modificados mediante `--diff=origin/main` para no repetir todo en cada push.

> El interés de un monorepo se mide en un cambio transversal: **un solo commit, un solo
> build, una sola revisión**. Melos hace que este funcionamiento sea sostenible para Flutter.
