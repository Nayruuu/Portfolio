Embarquer le SDK .NET et `node_modules` dans l'image qu'on déploie en prod, c'est expédier
800 Mo d'outillage qui ne servira jamais à l'exécution. Le **build multi-stage** sépare ce qui
compile de ce qui tourne : on obtient une image finale minuscule, ne contenant que le strict
nécessaire au runtime.

## Le principe : compiler puis jeter

Un `Dockerfile` multi-stage déclare plusieurs `FROM`. Chaque `FROM` ouvre un stage isolé ; seul
le **dernier** stage devient l'image livrée. On copie sélectivement les artefacts d'un stage de
build vers un stage de runtime, et tout le reste — SDK, sources, caches — est abandonné.

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

## Cache de layers : ordonner pour ne pas tout reconstruire

Docker met chaque instruction en cache et l'invalide dès qu'une couche en amont change. D'où la
règle d'or : **copier les fichiers de dépendances avant le code source**. En faisant `COPY
*.csproj` puis `dotnet restore` **avant** de copier le reste, le `restore` n'est rejoué que si
le `.csproj` change — pas à chaque modification d'un fichier C#. Même logique côté Angular avec
`package.json` et `npm ci` avant le `COPY` des sources : un changement de code ne réinvalide
jamais l'install des dépendances, ce qui divise les temps de build par dix.

## Une image finale minuscule

Le choix de l'image de base de runtime fait toute la différence. Les images **chiseled** de
Microsoft (`aspnet:9.0-noble-chiseled`) suppriment shell, gestionnaire de paquets et binaires
superflus : surface d'attaque réduite, image souvent sous les 110 Mo, exécution en utilisateur
non-root par défaut. Pour servir le front Angular, **nginx alpine** joue le rôle de stage final.

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

Le build Angular ne produit que des fichiers statiques : aucun runtime Node n'est nécessaire en
prod. On copie le dossier `dist/browser` dans la racine nginx et on ajoute un `try_files
$uri /index.html` dans la conf pour le **fallback SPA**.

## Orchestrer en local avec Compose

Pour faire tourner API et front ensemble pendant le dev, un `docker-compose.yml` câble les deux
services et leur réseau :

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

La [documentation des builds multi-stage](https://docs.docker.com/build/building/multi-stage/)
détaille les builds ciblés (`--target build`) et le partage de stages, utiles pour isoler une
étape de test dans le pipeline CI.

> Une image de prod ne devrait contenir que ce qui s'exécute. Le multi-stage rend cette
> discipline gratuite : **le SDK reste dans le stage de build, jamais dans ce que vous
> déployez**.
