Compilar una API .NET requiere el SDK completo: el compilador, MSBuild, los paquetes NuGet de
restauración, las fuentes. Compilar un front Angular requiere Node y un `node_modules` que pesa
a menudo varios cientos de megabytes. Ninguna de estas herramientas sirve para la ejecución. 
Embarcarlas en la imagen que se despliega es enviar toda una cadena de compilación para
lanzar un binario que ya no las necesita.

El build multi-stage separa la máquina que compila de la que se ejecuta, y solo entrega la
segunda.

## El principio: compilar y luego descartar

Un `Dockerfile` multi-stage declara varios `FROM`. Cada `FROM` abre un stage aislado, con su
propia imagen base y su propio sistema de archivos. Solo el **último** stage se convierte en la imagen
entregada; todos los anteriores sirven únicamente para producir artefactos.

Se copia selectivamente lo que importa de un stage a otro con `COPY --from`. El SDK, las
fuentes, las cachés de restauración quedan atrás y nunca llegan a la imagen final. El
stage de build hace el grueso del trabajo; el stage final solo recibe el resultado.

## El Dockerfile de la API .NET

Un solo archivo, dos stages: el SDK compila, la imagen de runtime recibe el binario publicado y nada
más.

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

El orden de las instrucciones decide lo que Docker puede poner en caché. Cada instrucción produce
una capa, reutilizada mientras ni ella ni ninguna capa por encima haya cambiado. En cuanto una capa
se invalida, todas las siguientes también lo hacen.

De ahí el orden del stage de build: copiar los `.csproj` y restaurar **antes** de copiar el código. El
`restore` solo se vuelve a ejecutar entonces si una dependencia cambia. Una modificación en un archivo C#
solo invalida el `publish`, que parte de una caché NuGet ya caliente. Sobre una base de código real,
eso marca la diferencia entre un build de unos segundos y una restauración completa en cada
commit.

El `--no-restore` en `dotnet publish` evita que vuelva a lanzar una restauración: la capa anterior
ya se encargó de eso. Cuidado con la trampa de las soluciones multi-proyecto: si `Api` referencia
`Domain`, hay que copiar ambos `.csproj` en su ubicación antes del `restore`, o la
restauración fallará al no encontrar el grafo de referencias.

El stage final, por su parte, decide el peso de la imagen. Las imágenes **chiseled** de Microsoft parten de un
Ubuntu reducido a lo esencial: sin shell, sin gestor de paquetes, sin binarios de sistema
superfluos. Menos superficie de ataque, y una cuenta de ejecución non-root por defecto (el usuario
`app`, UID 1654). En una imagen aspnet estándar, el proceso corre como root salvo indicación
contraria; entonces se cambia explícitamente con `USER $APP_UID`, la variable que estas imágenes
ya definen.

## El Dockerfile del front Angular

Mismo esquema en el front, con una diferencia útil: el build de Angular solo produce archivos
estáticos, así que no se necesita ningún runtime de Node en producción.

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

`npm ci` no es `npm install`. Exige un `package-lock.json` presente y coherente, elimina el
`node_modules` existente, e instala exactamente las versiones bloqueadas. Es reproducible y
más rápido, que es precisamente lo que se busca en una imagen. Un cambio de componente
no invalida ni el lockfile ni la capa `npm ci`: la instalación se mantiene en caché, solo el `build` se
vuelve a ejecutar.

`ng build` deposita el bundle en `dist/<app>/browser`. El stage final solo copia esa carpeta en
la raíz de nginx.

La imagen oficial `nginx` lanza su proceso maestro como root. La variante `nginx-unprivileged`
corre completamente bajo una cuenta non-root y escucha en el puerto 8080, lo que evita abrir un
puerto privilegiado en el contenedor. El `nginx.conf` necesita una sola directiva del lado de la
aplicación: `try_files $uri $uri/ /index.html`, para que el enrutamiento de Angular tome el relevo en
lugar de devolver un 404 en una URL profunda recargada.

## El `.dockerignore`, sin el cual la caché miente

Antes incluso de leer el `Dockerfile`, Docker envía el contexto de build al demonio. Sin filtro, ese
contexto incluye tu `bin/`, tu `obj/`, tu `node_modules` local, la carpeta `.git`. Cientos de
megabytes transferidos para nada, y peor: un `COPY . .` vuelve a copiar esos artefactos de
build del host dentro del stage, donde pueden contradecir lo que el contenedor acaba de restaurar.

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

La sintaxis es la del `.gitignore`. Al excluir los directorios de salida y los artefactos
locales, se garantiza que el build parte únicamente de las fuentes y que la caché refleja la realidad. Un
`obj/` arrastrado desde la máquina de desarrollo es una causa clásica de builds que «funcionan en mi
máquina» y fallan en CI.

## Orquestar ambos localmente

Durante el desarrollo, un `docker-compose.yml` conecta la API y el front en una misma red y los
construye con un solo `docker compose up`.

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

La [documentación de los builds multi-stage](https://docs.docker.com/build/building/multi-stage/)
detalla dos palancas que amplían todo esto: los builds dirigidos con `--target`, para detener
la construcción en un stage preciso (por ejemplo, un stage de test lanzado en CI sin producir la imagen
de runtime), y los montajes de caché de BuildKit (`RUN --mount=type=cache`) que persisten las
cachés de NuGet y npm entre dos builds.

> Una imagen de producción no debería contener más que lo que se ejecuta. El multi-stage vuelve esta
> disciplina gratuita: el SDK y Node se quedan en los stages de build, nunca en lo que
> despliegas.
