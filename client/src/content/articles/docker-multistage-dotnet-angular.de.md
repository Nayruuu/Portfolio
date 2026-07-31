Das .NET-SDK und `node_modules` in das Image einzubetten, das man in Produktion deployt, bedeutet,
800 MB Tooling zu verschicken, das zur Laufzeit nie gebraucht wird. Der **Multi-Stage-Build** trennt das,
was kompiliert, von dem, was läuft: Man erhält ein winziges finales Image, das nur das für die Laufzeit
absolut Notwendige enthält.

## Das Prinzip: kompilieren, dann wegwerfen

Ein `Dockerfile` mit Multi-Stage deklariert mehrere `FROM`. Jedes `FROM` öffnet einen isolierten Stage;
nur der **letzte** Stage wird zum ausgelieferten Image. Man kopiert selektiv die Artefakte eines
Build-Stages in einen Runtime-Stage, und der Rest (SDK, Quellcode, Caches) wird verworfen.

```bash
# Stage 1: build the .NET API
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . ./
RUN dotnet publish -c Release -o /app/publish

# Stage 2: runtime only (no SDK)
FROM mcr.microsoft.com/dotnet/aspnet:9.0-noble-chiseled AS final
WORKDIR /app
COPY --from=build /app/publish ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]
```

## Layer-Cache: die Reihenfolge, um nicht alles neu zu bauen

Docker cacht jede Instruktion und invalidiert sie, sobald sich eine vorgelagerte Schicht ändert. Daher die
Regel: **Abhängigkeitsdateien vor dem Quellcode kopieren**.

Wenn man `COPY *.csproj` und dann `dotnet restore` **vor** dem Kopieren des restlichen Codes ausführt,
wird `restore` nur dann erneut ausgeführt, wenn sich die `.csproj` ändert, nicht bei jeder Änderung
einer C#-Datei.

Gleiche Logik auf Angular-Seite mit `package.json` und `npm ci` vor dem `COPY` der Quellen: Eine
Codeänderung invalidiert die Installation der Abhängigkeiten nie, was die Build-Zeiten um den Faktor
zehn reduziert.

## Ein winziges finales Image

Das finale Gewicht hängt vor allem vom Runtime-Basisimage ab. Die **chiseled**-Images von
Microsoft (`aspnet:9.0-noble-chiseled`) entfernen Shell, Paketmanager und überflüssige Binaries:
reduzierte Angriffsfläche, Image oft unter 110 MB, Ausführung standardmäßig als Non-Root-User.

Um das Angular-Frontend auszuliefern, übernimmt **nginx alpine** die Rolle des finalen Stages.

```bash
# Build Angular then serve with nginx
FROM node:22-alpine AS web
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM nginx:1.27-alpine AS final
COPY --from=web /app/dist/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

Der Angular-Build erzeugt ausschließlich statische Dateien: In Produktion ist keine Node-Runtime
notwendig. Man kopiert den Ordner `dist/browser` in das nginx-Root-Verzeichnis und fügt in der Konfiguration
ein `try_files $uri /index.html` für den **SPA-Fallback** hinzu.

## Lokal orchestrieren mit Compose

Um API und Frontend während der Entwicklung gemeinsam laufen zu lassen, verkabelt eine
`docker-compose.yml` beide Services und ihr Netzwerk:

```yaml
services:
  api:
    build: ./api
    ports:
      - "8080:8080"
  web:
    build: ./web
    ports:
      - "4200:80"
    depends_on:
      - api
```

Die [Dokumentation zu Multi-Stage-Builds](https://docs.docker.com/build/building/multi-stage/)
beschreibt detailliert gezielte Builds (`--target build`) und das Teilen von Stages, nützlich, um einen
Testschritt in der CI-Pipeline zu isolieren.

> Ein Produktions-Image sollte nur enthalten, was auch ausgeführt wird. Multi-Stage macht diese
> Disziplin kostenlos: **Das SDK bleibt im Build-Stage, niemals in dem, was Sie
> deployen**.
