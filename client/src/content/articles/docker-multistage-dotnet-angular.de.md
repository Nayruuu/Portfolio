Eine .NET-API zu kompilieren erfordert das vollständige SDK: den Compiler, MSBuild, die
NuGet-Pakete für die Wiederherstellung, die Quellen. Ein Angular-Frontend zu kompilieren erfordert
Node und ein `node_modules`, das oft mehrere hundert Megabyte wiegt. Keines dieser Tools wird zur
Laufzeit benötigt. Sie in das Image einzubetten, das man deployt, bedeutet, eine komplette
Toolchain zu verschicken, um eine Binärdatei zu starten, die sie nicht mehr braucht.

Der Multi-Stage-Build trennt die Maschine, die kompiliert, von der Maschine, die läuft, und
liefert nur Letztere aus.

## Das Prinzip: kompilieren, dann wegwerfen

Ein `Dockerfile` mit Multi-Stage deklariert mehrere `FROM`-Anweisungen. Jedes `FROM` öffnet einen
isolierten Stage mit eigenem Basis-Image und eigenem Dateisystem. Nur der **letzte** Stage wird
zum ausgelieferten Image; alle vorherigen dienen ausschließlich dazu, Artefakte zu erzeugen.

Man kopiert selektiv das, was zählt, von einem Stage in den anderen mit `COPY --from`. Das SDK,
die Quellen, die Restore-Caches bleiben zurück und erreichen niemals das finale Image. Der
Build-Stage erledigt die schwere Arbeit; der finale Stage erhält nur das Ergebnis.

## Das Dockerfile der .NET-API

Eine einzige Datei, zwei Stages: das SDK kompiliert, das Runtime-Image erhält die veröffentlichte
Binärdatei und sonst nichts.

```dockerfile
# syntax=docker/dockerfile:1

# Build stage: full SDK, discarded at the end
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Project files first, then restore: this layer stays cached
# as long as the .csproj files don't change
COPY Api/*.csproj Api/
COPY Domain/*.csproj Domain/
RUN dotnet restore Api/Api.csproj

# Source last. A code change invalidates from here down,
# never the restore above
COPY . .
RUN dotnet publish Api/Api.csproj -c Release -o /app/publish --no-restore

# Runtime stage: no SDK, no shell, non-root by default
FROM mcr.microsoft.com/dotnet/aspnet:9.0-noble-chiseled AS final
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]
```

Die Reihenfolge der Anweisungen entscheidet darüber, was Docker cachen kann. Jede Anweisung
erzeugt eine Schicht, die wiederverwendet wird, solange sich weder sie noch eine darüberliegende
Schicht geändert hat. Sobald eine Schicht ungültig wird, sind es auch alle folgenden.

Daher die Reihenfolge im Build-Stage: die `.csproj`-Dateien kopieren und restaurieren, **bevor**
der Code kopiert wird. Der `restore` wird dann nur neu ausgeführt, wenn sich eine Abhängigkeit
ändert. Eine Änderung in einer C#-Datei invalidiert nur den `publish`, der von einem bereits
warmen NuGet-Cache ausgeht. Bei einer echten Codebasis macht das den Unterschied zwischen einem
Build von wenigen Sekunden und einer vollständigen Wiederherstellung bei jedem Commit.

Das `--no-restore` bei `dotnet publish` verhindert, dass es eine erneute Wiederherstellung
anstößt: Die vorherige Schicht hat sich bereits darum gekümmert. Vorsicht bei der Falle mit
Multi-Projekt-Solutions: Wenn `Api` auf `Domain` verweist, müssen beide `.csproj`-Dateien an ihrem
Ort kopiert werden, bevor der `restore` erfolgt, sonst schlägt die Wiederherstellung fehl, weil
der Referenzgraph nicht gefunden wird.

Der finale Stage wiederum entscheidet über das Gewicht des Images. Die **chiseled**-Images von
Microsoft basieren auf einem auf das Wesentliche reduzierten Ubuntu: kein Shell, kein
Paketmanager, keine überflüssigen Systembinärdateien. Weniger Angriffsfläche, und ein
Ausführungskonto ohne Root-Rechte standardmäßig (der Benutzer `app`, UID 1654). Bei einem
Standard-aspnet-Image läuft der Prozess sofern nicht anders angegeben als Root; man wechselt dann
explizit mit `USER $APP_UID`, der Variable, die diese Images bereits definieren.

## Das Dockerfile des Angular-Frontends

Dasselbe Schema auf der Frontend-Seite, mit einem nützlichen Unterschied: Der Angular-Build
erzeugt nur statische Dateien, sodass in Produktion keine Node-Runtime nötig ist.

```dockerfile
# Build stage: Node only for compiling the bundle
FROM node:22-alpine AS build
WORKDIR /app

# Dependency manifests first: npm ci is cached until the lockfile moves
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage: static files behind nginx, no Node
FROM nginxinc/nginx-unprivileged:1.27-alpine AS final
COPY --from=build /app/dist/app/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
```

`npm ci` ist nicht `npm install`. Es erfordert eine vorhandene und konsistente
`package-lock.json`, entfernt das bestehende `node_modules` und installiert exakt die
festgeschriebenen Versionen. Das ist reproduzierbar und schneller, was genau das ist, was man in
einem Image will. Eine Änderung an einer Komponente invalidiert weder die Lockfile noch die
`npm ci`-Schicht: Die Installation bleibt im Cache, nur der `build` wird neu ausgeführt.

`ng build` legt das Bundle in `dist/<app>/browser` ab. Der finale Stage kopiert nur diesen Ordner
in das nginx-Wurzelverzeichnis.

Das offizielle `nginx`-Image startet seinen Master-Prozess als Root. Die Variante
`nginx-unprivileged` läuft vollständig unter einem Nicht-Root-Konto und lauscht auf Port 8080,
was das Öffnen eines privilegierten Ports im Container vermeidet. Die `nginx.conf` benötigt nur
eine einzige anwendungsseitige Direktive: `try_files $uri $uri/ /index.html`, damit das
Angular-Routing übernimmt, statt bei einer neu geladenen tiefen URL ein 404 zurückzugeben.

## Die `.dockerignore`, ohne die der Cache lügt

Noch bevor das `Dockerfile` gelesen wird, sendet Docker den Build-Kontext an den Daemon. Ohne
Filter enthält dieser Kontext Ihr `bin/`, Ihr `obj/`, Ihr lokales `node_modules`, den
`.git`-Ordner. Hunderte Megabyte werden umsonst übertragen, und schlimmer: Ein `COPY . .` kopiert
diese Build-Artefakte vom Host in den Stage, wo sie dem widersprechen können, was der Container
gerade wiederhergestellt hat.

```
# .dockerignore
**/bin
**/obj
**/node_modules
**/dist
.git
.vs
Dockerfile
docker-compose.yml
```

Die Syntax entspricht der von `.gitignore`. Durch den Ausschluss von Ausgabeverzeichnissen und
lokalen Artefakten stellt man sicher, dass der Build nur von den Quellen ausgeht und der Cache die
Realität widerspiegelt. Ein aus der Dev-Maschine mitgeschlepptes `obj/` ist eine klassische
Ursache für Builds, die „bei mir funktionieren" und in der CI scheitern.

## Beide lokal orchestrieren

Während der Entwicklung verkabelt eine `docker-compose.yml` die API und das Frontend im selben
Netzwerk und baut beide mit einem einzigen `docker compose up`.

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Api/Dockerfile
    ports:
      - "8080:8080"
  web:
    build: ./web
    ports:
      - "4200:8080"
    depends_on:
      - api
```

Die [Dokumentation zu Multi-Stage-Builds](https://docs.docker.com/build/building/multi-stage/)
beschreibt zwei Hebel, die dies erweitern: gezielte Builds mit `--target`, um den Build an einem
bestimmten Stage zu stoppen (zum Beispiel ein Test-Stage, der in der CI läuft, ohne das
Runtime-Image zu erzeugen), und BuildKit-Cache-Mounts (`RUN --mount=type=cache`), die die
NuGet- und npm-Caches zwischen zwei Builds persistieren.

> Ein Produktions-Image sollte nur das enthalten, was zur Laufzeit läuft. Multi-Stage macht diese
> Disziplin kostenlos: Das SDK und Node bleiben in den Build-Stages, niemals in dem, was Sie
> deployen.
