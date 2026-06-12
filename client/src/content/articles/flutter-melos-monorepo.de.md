## In Packages aufteilen

Die Packages werden in einem Ordner (oft `packages/`) abgelegt und im Root deklariert. Jedes behält seine eigene `pubspec.yaml`; die App referenziert die anderen als **Pfadabhängigkeiten**, und Melos verknüpft alles lokal:

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

Die Grenze zwischen Packages wird zur **Architekturgrenze**: `feature_auth` hängt von `core_api` ab, nie umgekehrt. Der Abhängigkeitsgraph ist explizit, überprüfbar und bricht die Kompilierung, sobald er verletzt wird.

## Die melos.yaml-Datei

Der Kern der Konfiguration deklariert die Packages und wiederverwendbare **Scripts**, die über den gesamten Graphen ausgeführt werden:

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

`melos exec` führt einen Befehl in jedem Package aus; Filter wie `--dir-exists=test` oder `--diff` zielen auf eine Teilmenge ab — beispielsweise **nur die seit dem Hauptbranch geänderten Packages**, was die CI erheblich beschleunigt.

## Bootstrap und Verknüpfung

`melos bootstrap` (oder `melos bs`) ist der Schlüsselbefehl: Er installiert die Abhängigkeiten aller Packages **und** löst die Pfadabhängigkeiten zwischen ihnen auf. Kein manuelles `flutter pub get` Package für Package, keine desynchronisierten Versionen mehr. Man führt ihn nach jedem `git clone` und nach jeder Änderung an `pubspec.yaml` aus. Die [Melos-Dokumentation](https://melos.invertase.dev/) beschreibt jeden Filter und jeden Hook.

## Versionierung und CI

Melos setzt auf **Conventional Commits**: `melos version` liest die Historie, berechnet den Bump für jedes betroffene Package, aktualisiert die `CHANGELOG.md` und propagiert die neuen Versionen an abhängige Packages. Ein `fix:` in `core_api` erhöht `core_api` **und** alles, was davon abhängt, konsistent.

- `melos bootstrap` → installiert und verknüpft alles
- `melos run analyze` → statische Analyse überall
- `melos run test` → Tests über den gesamten Graphen
- `melos version` → Bumps + Changelogs aus den Commits

In der CI ist die typische Abfolge `bootstrap`, dann `analyze`, dann `test` — oft auf die geänderten Packages via `--diff=origin/main` beschränkt, um nicht bei jedem Push alles erneut durchzuführen.

> Ein Monorepo ist nicht nur eine Ordnerstruktur: Es ist das Versprechen, dass eine übergreifende Änderung **ein einziger Commit, ein einziger Build, ein einziges Review** bleibt. Melos hält dieses Versprechen für Flutter.
