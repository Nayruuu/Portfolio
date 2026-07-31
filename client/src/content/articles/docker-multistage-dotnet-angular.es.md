Embarcar el SDK de .NET y `node_modules` en la imagen que se despliega en producción supone enviar
800 MB de herramientas que nunca se usarán en tiempo de ejecución. El **build multi-stage** separa lo que
compila de lo que se ejecuta: se obtiene una imagen final minúscula, que contiene solo lo estrictamente
necesario para el runtime.

## El principio: compilar y luego descartar

Un `Dockerfile` multi-stage declara varios `FROM`. Cada `FROM` abre un stage aislado; solo
el **último** stage se convierte en la imagen entregada. Se copian selectivamente los artefactos de un stage de
build hacia un stage de runtime, y todo lo demás (SDK, fuentes, cachés) se descarta.

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

## Caché de layers: ordenar para no reconstruir todo

Docker pone en caché cada instrucción y la invalida en cuanto una capa anterior cambia. De ahí la
regla: **copiar los archivos de dependencias antes que el código fuente**.

Al hacer `COPY *.csproj` y luego `dotnet restore` **antes** de copiar el resto, el `restore`
solo se vuelve a ejecutar si el `.csproj` cambia, no en cada modificación de un archivo C#.

Misma lógica en el lado de Angular con `package.json` y `npm ci` antes del `COPY` de las fuentes: un
cambio de código nunca vuelve a invalidar la instalación de dependencias, lo que divide los tiempos de
build por diez.

## Una imagen final minúscula

El peso final depende sobre todo de la imagen base de runtime. Las imágenes **chiseled** de
Microsoft (`aspnet:9.0-noble-chiseled`) eliminan shell, gestor de paquetes y binarios
superfluos: superficie de ataque reducida, imagen a menudo por debajo de los 110 MB, ejecución con usuario
no-root por defecto.

Para servir el front de Angular, **nginx alpine** hace de stage final.

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

El build de Angular solo produce archivos estáticos: no se necesita ningún runtime de Node en
producción. Se copia la carpeta `dist/browser` en la raíz de nginx y se añade un `try_files
$uri /index.html` en la conf para el **fallback SPA**.

## Orquestar en local con Compose

Para hacer funcionar la API y el front juntos durante el desarrollo, un `docker-compose.yml` conecta ambos
servicios y su red:

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

La [documentación de los builds multi-stage](https://docs.docker.com/build/building/multi-stage/)
detalla los builds dirigidos (`--target build`) y el uso compartido de stages, útiles para aislar una
etapa de test en el pipeline CI.

> Una imagen de producción no debería contener más que lo que se ejecuta. El multi-stage hace que esta
> disciplina sea gratuita: **el SDK se queda en el stage de build, nunca en lo que se
> despliega**.
