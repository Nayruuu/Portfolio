Compiling a .NET API requires the full SDK: the compiler, MSBuild, the NuGet restore packages,
the sources. Compiling an Angular front end requires Node and a `node_modules` that often weighs
several hundred megabytes. None of these tools are needed at runtime. Embedding them in the image
you deploy means shipping an entire compilation toolchain to launch a binary that no longer needs
it.

The multi-stage build separates the machine that compiles from the one that runs, and only ships
the latter.

## The principle: compile then discard

A multi-stage `Dockerfile` declares several `FROM`. Each `FROM` opens an isolated stage, with its
own base image and its own filesystem. Only the **last** stage becomes the shipped image; all the
preceding ones serve solely to produce artifacts.

You selectively copy what matters from one stage to another with `COPY --from`. The SDK, the
sources, the restore caches stay behind and never reach the final image. The build stage does the
heavy lifting; the final stage receives only the result.

## The .NET API Dockerfile

A single file, two stages: the SDK compiles, the runtime image receives the published binary and
nothing else.

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

The order of instructions decides what Docker can cache. Each instruction produces a layer,
reused as long as neither it nor any layer above it has changed. As soon as one layer is
invalidated, every following one is too.

Hence the order in the build stage: copy the `.csproj` files and restore **before** copying the
code. The `restore` is then only replayed when a dependency changes. A change in a C# file only
invalidates the `publish`, which starts from an already-warm NuGet cache. On a real codebase, that
makes the difference between a build that takes a few seconds and a full restore on every commit.

The `--no-restore` flag on `dotnet publish` prevents it from triggering another restore: the
previous layer already handled it. Watch out for the multi-project solution trap: if `Api`
references `Domain`, both `.csproj` files need to be copied to their location before the
`restore`, otherwise the restore fails because it can't find the reference graph.

The final stage, meanwhile, decides the weight of the image. Microsoft's **chiseled** images start
from an Ubuntu stripped down to the essentials: no shell, no package manager, no superfluous
system binaries. Less attack surface, and a non-root execution account by default (the `app` user,
UID 1654). On a standard aspnet image, the process runs as root unless stated otherwise; you then
switch explicitly with `USER $APP_UID`, the variable these images already define.

## The Angular front end Dockerfile

Same pattern on the front-end side, with one useful difference: the Angular build only produces
static files, so no Node runtime is needed in production.

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

`npm ci` is not `npm install`. It requires a present and consistent `package-lock.json`, removes
the existing `node_modules`, and installs exactly the locked versions. It's reproducible and
faster, which is precisely what you want in an image. A component change invalidates neither the
lockfile nor the `npm ci` layer: the install stays cached, only the `build` is replayed.

`ng build` drops the bundle into `dist/<app>/browser`. The final stage copies only that folder
into the nginx root.

The official `nginx` image launches its master process as root. The `nginx-unprivileged` variant
runs entirely under a non-root account and listens on port 8080, which avoids opening a privileged
port inside the container. The `nginx.conf` needs a single application-side directive:
`try_files $uri $uri/ /index.html`, so that Angular's routing takes over instead of returning a
404 on a deep URL that gets reloaded.

## The `.dockerignore`, without which the cache lies

Even before reading the `Dockerfile`, Docker sends the build context to the daemon. Without a
filter, this context includes your `bin/`, your `obj/`, your local `node_modules`, the `.git`
folder. Hundreds of megabytes transferred for nothing, and worse: a `COPY . .` copies these
build artifacts from the host into the stage, where they can contradict what the container just
restored.

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

The syntax is that of `.gitignore`. By excluding output directories and local artifacts, you
guarantee that the build starts from the sources alone and that the cache reflects reality. An
`obj/` dragged over from the dev machine is a classic cause of builds that "work on my machine"
and break in CI.

## Orchestrating both locally

During development, a `docker-compose.yml` wires the API and the front end on the same network
and builds them with a single `docker compose up`.

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

The [multi-stage build documentation](https://docs.docker.com/build/building/multi-stage/)
details two levers that extend all of this: targeted builds with `--target`, to stop the build at
a specific stage (for example a test stage run in CI without producing the runtime image), and
BuildKit cache mounts (`RUN --mount=type=cache`) that persist NuGet and npm caches between two
builds.

> A production image should only contain what runs. Multi-stage makes this discipline free: the
> SDK and Node stay in the build stages, never in what you deploy.
