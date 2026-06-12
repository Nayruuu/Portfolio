Shipping the .NET SDK and `node_modules` inside the image you deploy to production means
shipping 800 MB of tooling that will never run at execution time. **Multi-stage builds**
separate what compiles from what runs: you end up with a tiny final image containing only what
the runtime strictly needs.

## The principle: compile, then throw away

A multi-stage `Dockerfile` declares several `FROM` lines. Each `FROM` opens an isolated stage;
only the **last** stage becomes the shipped image. You selectively copy the build artefacts
from a build stage into a runtime stage, and everything else — SDK, sources, caches — is
discarded.

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

## Layer caching: order to avoid rebuilding everything

Docker caches each instruction and invalidates it the moment an upstream layer changes. Hence
the golden rule: **copy the dependency files before the source code**. By running `COPY
*.csproj` then `dotnet restore` **before** copying the rest, the `restore` only re-runs when the
`.csproj` changes — not on every C# edit. The same logic applies on the Angular side, with
`package.json` and `npm ci` before the source `COPY`: a code change never re-invalidates the
dependency install, which cuts build times tenfold.

## A tiny final image

The choice of runtime base image makes all the difference. Microsoft's **chiseled** images
(`aspnet:9.0-noble-chiseled`) strip out the shell, package manager and superfluous binaries:
smaller attack surface, images often under 110 MB, and execution as a non-root user by default.
To serve the Angular front end, **nginx alpine** plays the role of the final stage.

```bash
# Build Angular, then serve it with nginx
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

The Angular build produces only static files: no Node runtime is needed in production. You copy
the `dist/browser` folder into the nginx root and add a `try_files $uri /index.html` to the
config for the **SPA fallback**.

## Orchestrate locally with Compose

To run the API and front end together during development, a `docker-compose.yml` wires up both
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
covers targeted builds (`--target build`) and stage sharing, both handy for isolating a test
stage in the CI pipeline.

> A production image should contain only what runs. Multi-stage builds make that discipline
> free: **the SDK stays in the build stage, never in what you deploy**.
