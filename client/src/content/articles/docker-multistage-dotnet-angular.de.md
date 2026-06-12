## Das Prinzip: kompilieren, dann verwerfen

Ein Multi-Stage-`Dockerfile` deklariert mehrere `FROM`-Anweisungen. Jedes `FROM` öffnet einen isolierten Stage; nur der **letzte** Stage wird zum ausgelieferten Image. Die Artefakte werden selektiv vom Build-Stage in den Runtime-Stage kopiert — alles andere, SDK, Quellcode, Caches, wird verworfen.

```bash
# Stage 1 : build de l'API .NET
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . ./
RUN dotnet publish -c Release -o /app/publish

# Stage 2 : runtime seul (pas de SDK)
FROM mcr.microsoft.com/dotnet/aspnet:9.0-noble-chiseled AS final
WORKDIR /app
COPY --from=build /app/publish ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]
```

## Layer-Cache: Reihenfolge, um nicht alles neu zu bauen

Docker legt jede Anweisung im Cache ab und invalidiert ihn, sobald eine vorgelagerte Schicht sich ändert. Daher die goldene Regel: **Abhängigkeitsdateien vor dem Quellcode kopieren**. Mit `COPY *.csproj` gefolgt von `dotnet restore` **bevor** der Rest kopiert wird, wird das `restore` nur bei einer Änderung der `.csproj`-Datei erneut ausgeführt — nicht bei jeder Änderung einer C#-Datei. Gleiche Logik auf Angular-Seite mit `package.json` und `npm ci` vor dem `COPY` der Quellen: Eine Codeänderung invalidiert niemals die Dependency-Installation, was die Build-Zeiten um das Zehnfache reduziert.

## Ein winziges finales Image

Die Wahl des Runtime-Basis-Images macht den entscheidenden Unterschied. Die **chiseled**-Images von Microsoft (`aspnet:9.0-noble-chiseled`) entfernen Shell, Paketmanager und überflüssige Binärdateien: reduzierte Angriffsfläche, Images oft unter 110 MB, Ausführung standardmäßig als Non-Root-Benutzer. Für den Angular-Frontend-Service übernimmt **nginx alpine** die Rolle des finalen Stage.

```bash
# Build Angular puis service par nginx
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

Der Angular-Build erzeugt ausschließlich statische Dateien: Kein Node-Runtime wird in der Produktion benötigt. Der `dist/browser`-Ordner wird in das nginx-Root kopiert, und ein `try_files $uri /index.html` in der Konfiguration sorgt für den **SPA-Fallback**.

## Lokal mit Compose orchestrieren

Um API und Frontend gemeinsam während der Entwicklung zu betreiben, verbindet eine `docker-compose.yml` beide Services und ihr Netzwerk:

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

Die [Dokumentation zu Multi-Stage-Builds](https://docs.docker.com/build/building/multi-stage/) beschreibt zielgerichtete Builds (`--target build`) und das Teilen von Stages — nützlich, um einen Testschritt in der CI-Pipeline zu isolieren.

> Ein Produktions-Image sollte nur enthalten, was auch ausgeführt wird. Multi-Stage macht diese
> Disziplin kostenlos: **Das SDK bleibt im Build-Stage, niemals in dem, was Sie deployen**.
