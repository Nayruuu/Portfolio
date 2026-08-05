Compiler une API .NET demande le SDK complet : le compilateur, MSBuild, les paquets NuGet de
restauration, les sources. Compiler un front Angular demande Node et un `node_modules` qui pèse
souvent plusieurs centaines de mégaoctets. Aucun de ces outils ne sert à l'exécution. Les
embarquer dans l'image qu'on déploie, c'est expédier une chaîne de compilation entière pour
lancer un binaire qui n'en a plus besoin.

Le build multi-stage sépare la machine qui compile de celle qui tourne, et ne livre que la
seconde.

## Le principe : compiler puis jeter

Un `Dockerfile` multi-stage déclare plusieurs `FROM`. Chaque `FROM` ouvre un stage isolé, avec sa
propre image de base et son propre système de fichiers. Seul le **dernier** stage devient l'image
livrée ; tous les précédents servent uniquement à produire des artefacts.

On copie sélectivement ce qui compte d'un stage vers un autre avec `COPY --from`. Le SDK, les
sources, les caches de restauration restent en arrière et n'atteignent jamais l'image finale. Le
stage de build fait le gros du travail ; le stage final ne reçoit que le résultat.

## Le Dockerfile de l'API .NET

Un seul fichier, deux stages : le SDK compile, l'image de runtime reçoit le binaire publié et rien
d'autre.

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

L'ordre des instructions décide de ce que Docker peut mettre en cache. Chaque instruction produit
une couche, réutilisée tant que ni elle ni aucune couche au-dessus n'a changé. Dès qu'une couche
est invalidée, toutes les suivantes le sont aussi.

D'où l'ordre du stage de build : copier les `.csproj` et restaurer **avant** de copier le code. Le
`restore` n'est alors rejoué que si une dépendance change. Une modification dans un fichier C#
n'invalide que le `publish`, qui repart d'un cache NuGet déjà chaud. Sur une base de code réelle,
ça fait la différence entre un build de quelques secondes et une restauration complète à chaque
commit.

Le `--no-restore` sur `dotnet publish` évite qu'il relance une restauration : la couche précédente
s'en est déjà chargée. Attention au piège des solutions multi-projets : si `Api` référence
`Domain`, il faut copier les deux `.csproj` à leur emplacement avant le `restore`, sinon la
restauration échoue faute de retrouver le graphe de références.

Le stage final, lui, décide du poids de l'image. Les images **chiseled** de Microsoft partent d'un
Ubuntu réduit à l'essentiel : ni shell, ni gestionnaire de paquets, ni binaires système
superflus. Moins de surface d'attaque, et un compte d'exécution non-root par défaut (l'utilisateur
`app`, UID 1654). Sur une image aspnet standard, le processus tourne en root sauf mention
contraire ; on bascule alors explicitement avec `USER $APP_UID`, la variable que ces images
définissent déjà.

## Le Dockerfile du front Angular

Même schéma côté front, avec une différence utile : le build Angular ne produit que des fichiers
statiques, donc aucun runtime Node n'est nécessaire en production.

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

`npm ci` n'est pas `npm install`. Il exige un `package-lock.json` présent et cohérent, supprime le
`node_modules` existant, et installe exactement les versions verrouillées. C'est reproductible et
plus rapide, ce qui est précisément ce qu'on veut dans une image. Un changement de composant
n'invalide ni le lockfile ni la couche `npm ci` : l'install reste en cache, seul le `build` se
rejoue.

`ng build` dépose le bundle dans `dist/<app>/browser`. Le stage final ne copie que ce dossier dans
la racine nginx.

L'image officielle `nginx` lance son processus maître en root. La variante `nginx-unprivileged`
tourne entièrement sous un compte non-root et écoute sur le port 8080, ce qui évite d'ouvrir un
port privilégié dans le conteneur. La `nginx.conf` a besoin d'une seule directive côté
application : `try_files $uri $uri/ /index.html`, pour que le routage Angular prenne le relais au
lieu de renvoyer un 404 sur une URL profonde rechargée.

## Le `.dockerignore`, sans lequel le cache ment

Avant même de lire le `Dockerfile`, Docker envoie le contexte de build au démon. Sans filtre, ce
contexte inclut votre `bin/`, votre `obj/`, votre `node_modules` local, le dossier `.git`. Des
centaines de mégaoctets transférés pour rien, et pire : un `COPY . .` recopie ces artefacts de
build de l'hôte dans le stage, où ils peuvent contredire ce que le conteneur vient de restaurer.

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

La syntaxe est celle du `.gitignore`. En excluant les répertoires de sortie et les artefacts
locaux, on garantit que le build part des seules sources et que le cache reflète la réalité. Un
`obj/` traîné depuis la machine de dev est une cause classique de builds qui « marchent chez moi »
et cassent en CI.

## Orchestrer les deux en local

Pendant le développement, un `docker-compose.yml` câble l'API et le front sur un même réseau et les
construit d'un seul `docker compose up`.

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

La [documentation des builds multi-stage](https://docs.docker.com/build/building/multi-stage/)
détaille deux leviers qui prolongent tout ceci : les builds ciblés avec `--target`, pour arrêter
la construction à un stage précis (par exemple un stage de test lancé en CI sans produire l'image
de runtime), et les montages de cache BuildKit (`RUN --mount=type=cache`) qui persistent les
caches NuGet et npm entre deux builds.

> Une image de production ne devrait contenir que ce qui s'exécute. Le multi-stage rend cette
> discipline gratuite : le SDK et Node restent dans les stages de build, jamais dans ce que vous
> déployez.
