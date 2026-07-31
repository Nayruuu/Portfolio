Ein ernsthaftes Flutter-Produkt ist nie ein einziges Package: Es gibt die Mobile-App, ein Design
System, einen API-Client, vielleicht ein Feature-Modul pro Team. Sie in separaten
Repositories zu halten, erzwingt bei jeder übergreifenden Änderung eine Abfolge von `pub publish` und
Versions-Bumps in der richtigen Reihenfolge. **Melos** verwaltet dieses Dart/Flutter-Monorepo: ein Repository,
mehrere Packages, Befehle, die überall auf einmal ausgeführt werden.

## In Packages aufteilen

Man ordnet die Packages unter einem Ordner an (oft `packages/`) und deklariert sie im Root.
Jedes behält seine eigene `pubspec.yaml`; die App referenziert die anderen als
**Path-Dependencies**, und Melos verknüpft alles lokal:

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

Die Grenze zwischen Packages wird zu einer **Architekturgrenze**: `feature_auth` hängt
von `core_api` ab, niemals umgekehrt. Der Abhängigkeitsgraph ist explizit, überprüfbar und
bricht den Build, sobald man dagegen verstößt.

## Die Datei melos.yaml

Der Kern der Konfiguration deklariert die Packages und wiederverwendbare **Scripts**, die auf
dem gesamten Graphen ausgeführt werden:

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
    description: Führt die Tests jedes Packages aus, das welche hat.
```

`melos exec` führt einen Befehl in jedem Package aus; Filter wie `--dir-exists=test` oder
`--diff` zielen auf eine Teilmenge ab: zum Beispiel **nur die geänderten Packages** seit dem
Hauptbranch, was die CI erheblich beschleunigt.

## Bootstrap und Verknüpfung

`melos bootstrap` (oder `melos bs`) ist der Schlüsselbefehl: Er installiert die Abhängigkeiten aller
Packages **und** löst die Path-Dependencies zwischen ihnen auf. Man muss `flutter pub get`
nicht mehr Package für Package ausführen und die Versionen nicht mehr von Hand
resynchronisieren. Man führt ihn nach jedem `git clone` und nach jeder Änderung einer
`pubspec.yaml` aus. Die
[Dokumentation von Melos](https://melos.invertase.dev/) beschreibt jeden Filter und jeden Hook.

## Versionierung und CI

Melos stützt sich auf **Conventional Commits**: `melos version` liest die Historie, berechnet
den Bump jedes betroffenen Packages, aktualisiert die `CHANGELOG.md` und propagiert die neuen
Versionen an die abhängigen Packages. Ein `fix:` in `core_api` erhöht `core_api` **und** alles,
was davon abhängt, konsistent.

- `melos bootstrap` → installiert und verknüpft alles
- `melos run analyze` → statische Analyse überall
- `melos run test` → Tests über den gesamten Graphen
- `melos version` → Bumps + Changelogs aus den Commits

In der CI ist die typische Abfolge `bootstrap`, dann `analyze`, dann `test`, oft beschränkt auf die
geänderten Packages via `--diff=origin/main`, um nicht bei jedem Push alles neu durchzuspielen.

> Der Nutzen eines Monorepos zeigt sich bei einer übergreifenden Änderung: **ein einziger Commit, ein
> einziger Build, ein einziges Review**. Melos macht diese Arbeitsweise für Flutter tragfähig.
