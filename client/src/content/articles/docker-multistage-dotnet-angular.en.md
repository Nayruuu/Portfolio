Embedding the .NET SDK and `node_modules` in the image you deploy to prod means shipping
800 MB of tooling that will never be used at runtime. The **multi-stage build** separates what
compiles from what runs: you get a tiny final image, containing only what's strictly
necessary at runtime.

## The principle: compile then discard

A multi-stage `Dockerfile` declares several `FROM`. Each `FROM` opens an isolated stage; only
the **last** stage becomes the shipped image. You selectively copy artifacts from a build
stage into a runtime stage, and everything else (SDK, sources, caches) is discarded.

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

## Layer cache: ordering to avoid rebuilding everything

Docker caches each instruction and invalidates it as soon as an upstream layer changes. Hence
the rule: **copy dependency files before source code**.

By doing `COPY *.csproj` then `dotnet restore` **before** copying the rest, the `restore` is
only replayed if the `.csproj` changes, not on every modification of a C# file.

Same logic on the Angular side with `package.json` and `npm ci` before the `COPY` of the
sources: a code change never re-invalidates the dependency install, which cuts build times by
a factor of ten.

## A tiny final image

The final weight depends mostly on the runtime base image. Microsoft's **chiseled** images
(`aspnet:9.0-noble-chiseled`) strip out the shell, package manager, and superfluous binaries:
reduced attack surface, image often under 110 MB, running as a non-root user by default.

To serve the Angular front end, **nginx alpine** plays the role of final stage.

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

The Angular build only produces static files: no Node runtime is needed in prod. You copy
the `dist/browser` folder into the nginx root and add a `try_files
$uri /index.html` in the config for the **SPA fallback**.

## Orchestrating locally with Compose

To run API and front end together during dev, a `docker-compose.yml` wires the two
services and their network:

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

The [multi-stage build documentation](https://docs.docker.com/build/building/multi-stage/)
covers targeted builds (`--target build`) and stage sharing, useful for isolating a
test step in the CI pipeline.

> A prod image should contain only what runs. Multi-stage makes this discipline free:
> **the SDK stays in the build stage, never in what you deploy**.
