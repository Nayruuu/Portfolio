Incluir el SDK de .NET y `node_modules` en la imagen que desplegamos en producción es enviar
800 MB de herramientas que nunca se usarán en la ejecución. El **build multi-stage** separa lo
que compila de lo que se ejecuta: obtenemos una imagen final diminuta, que contiene solo lo
estrictamente necesario para el runtime.

## El principio: compilar y descartar

Un `Dockerfile` multi-stage declara varios `FROM`. Cada `FROM` abre un stage aislado; solo
el **último** stage se convierte en la imagen entregada. Copiamos selectivamente los artefactos de un stage de
build hacia un stage de runtime, y todo lo demás — SDK, fuentes, cachés — se descarta.

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

## Caché de layers: ordenar para no reconstruir todo

Docker pone en caché cada instrucción y la invalida en cuanto cambia una capa anterior. De ahí la
regla de oro: **copiar los archivos de dependencias antes que el código fuente**. Al hacer `COPY
*.csproj` y luego `dotnet restore` **antes** de copiar el resto, el `restore` solo se vuelve a ejecutar si
el `.csproj` cambia — no en cada modificación de un archivo C#. La misma lógica en el lado de Angular con
`package.json` y `npm ci` antes del `COPY` de las fuentes: un cambio de código nunca reinvalida
la instalación de dependencias, lo que divide los tiempos de build por diez.

## Una imagen final diminuta

La elección de la imagen base de runtime marca toda la diferencia. Las imágenes **chiseled** de
Microsoft (`aspnet:9.0-noble-chiseled`) eliminan la shell, el gestor de paquetes y los binarios
superfluos: superficie de ataque reducida, imagen frecuentemente por debajo de los 110 MB, ejecución como usuario
no-root por defecto. Para servir el frontend de Angular, **nginx alpine** desempeña el papel de stage final.

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

El build de Angular solo produce archivos estáticos: no se necesita ningún runtime de Node en
producción. Copiamos la carpeta `dist/browser` en la raíz de nginx y añadimos un `try_files
$uri /index.html` en la configuración para el **fallback SPA**.

## Orquestar en local con Compose

Para ejecutar la API y el frontend juntos durante el desarrollo, un `docker-compose.yml` conecta los dos
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
detalla los builds dirigidos (`--target build`) y la compartición de stages, útiles para aislar una
etapa de test en el pipeline CI.

> Una imagen de prod solo debería contener lo que se ejecuta. El multi-stage hace que esta
> disciplina sea gratuita: **el SDK permanece en el stage de build, nunca en lo que desplegáis**.
