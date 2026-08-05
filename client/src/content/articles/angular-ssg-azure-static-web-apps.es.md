Un SPA de Angular sirve primero una carcasa vacía. El HTML inicial solo contiene un `<app-root>` y
un bundle por descargar; el contenido no aparece hasta que se ejecuta el JavaScript. Para un crawler
que no ejecuta ese JS, o que lo ejecuta con un presupuesto ajustado, la página está en blanco en el
momento en que decide qué indexar.

La generación de sitio estático (SSG) traslada el renderizado al momento del build: cada ruta se
prerrenderiza en HTML completo, se escribe en un archivo, se sirve tal cual. Este portfolio lleva el
principio hasta el final. Ninguna ruta depende de un servidor Node en ejecución, y un script de guardia
se niega a entregar un build en el que un artículo hubiera perdido su contenido. El cableado va desde `angular.json`
hasta el workflow de GitHub que despliega en Azure Static Web Apps.

## El prerrenderizado nativo, sin servidor Node

Angular expone el prerrenderizado a través de `@angular/ssr`. La palanca está en la configuración de build.

```json
// angular.json — build options (excerpt)
"server": "src/main.server.ts",
"outputMode": "static"
```

`outputMode: "static"` le pide al builder que prerrenderice cada ruta declarada y que emita únicamente
archivos: `main.server.ts` sirve para el renderizado en tiempo de compilación, no en ejecución. La salida
aterriza en `dist/super-dev-portfolio/browser/`, una carpeta de HTML, CSS y JS estáticos. Nada que
ejecutar en el servidor, que es exactamente lo que espera un hosting de archivos como Azure SWA.

La hidratación sigue activa en el cliente. `provideClientHydration(withEventReplay())` reactiva
la aplicación sobre el HTML ya presente, sin volver a renderizar el DOM. La primera visualización viene
del archivo, la interactividad viene del bundle una vez cargado.

## Un árbol estático por idioma, nunca un parámetro `:lang`

El idioma es un prefijo de URL (`/fr`, `/en`, `/es`, `/de`). La tentación natural es una ruta
padre parametrizada `:lang` con un `redirectTo`. Eso rompe el prerrenderizado nativo: el
`<router-outlet>` sale vacío en el HTML generado.

La solución es emitir un árbol estático explícito por idioma. Un `LANGS.map` construye una ruta
padre por idioma cuyo `path` es una cadena literal (`fr`, `en`…), no un parámetro; dos
rutas de respaldo completan el conjunto, una `''` que redirige al idioma por defecto y una `**`
comodín hacia el mismo destino.

El prerrenderizado ve entonces rutas concretas que fijar. Añadir un idioma sigue siendo una sola línea en
`LANGS`: los árboles, el sitemap y los `hreflang` se deducen todos de esa lista.

El `langResolver` fija la locale antes del renderizado del componente, para que el prerrenderizado y el primer
paint arranquen con el idioma correcto.

## Enumerar los slugs a fijar

Las páginas de detalle (artículos, series, proyectos) llevan un `:slug`. El prerrenderizado no puede
adivinar esos valores, hay que proporcionárselos. `getPrerenderParams` devuelve la lista, leída
directamente del contenido FR.

```ts
const articleParams = async () => contentFr.articles.map((a) => ({ slug: a.slug }));

export const serverRoutes: ServerRoute[] = [
  ...LANGS.flatMap((lang): ServerRoute[] => [
    {
      path: `${lang}/articles/:slug`,
      renderMode: RenderMode.Prerender,
      getPrerenderParams: articleParams,
    },
    // …series, projects
  ]),
  { path: '**', renderMode: RenderMode.Prerender },
];
```

El `flatMap` sobre `LANGS` produce un conjunto de rutas por idioma; para cada una, cada slug de artículo
se convierte en una página. El catch-all `**` en `RenderMode.Prerender` cubre las páginas estáticas restantes
(`/fr`, `/en/about`…). Todo se prerrenderiza, sin excepción: es la condición para que `outputMode:
static` no tenga ningún servidor que mantener en ejecución.

Los componentes de detalle leen su `:slug` mediante `input()` (`withComponentInputBinding`), así que
la misma página se rehidrata correctamente en el cliente.

## La guardia que rechaza un build mudo

Prerrenderizar el HTML no garantiza que contenga algo. Un componente que falla en
silencio al renderizarse en el servidor, un parser de Markdown que no se ejecuta, una tarjeta social ausente: el
build pasa de todos modos, y el artículo sale en línea vaciado de su contenido.

Los tests e2e no lo detectan. El `webServer` de Playwright es `ng serve`, que no prerrenderiza
nada: un test «JS desactivado» vería ahí la carcasa SPA, nunca el HTML fijado. La garantía
«descubrible sin JS» es, por tanto, una aserción sobre la salida del build, no un test de navegador.

`check-prerender.mjs` cubre ese hueco. Para cada slug de artículo y cada idioma, lee
el `index.html` producido y plantea cuatro exigencias. El JSON-LD debe contener `"@type":"BlogPosting"`
y la `datePublished` exacta extraída del contenido. La tarjeta social `og/<slug>.<lang>.jpg` debe existir
en el build y estar referenciada por la página. La región `article-detail__body` debe llevar al menos
200 caracteres de texto una vez eliminadas las etiquetas, prueba de que el Markdown se ha renderizado. Por último,
ningún `**` debe subsistir en la prosa, lo cual delataría Markdown sin convertir; el control
excluye primero los bloques de código, donde `**` es un operador o un glob legítimo.

```js
// Fail the build the moment a prerendered article loses its body.
const text = region.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
if (text.length < MIN_BODY_TEXT) {
  failures.push(`  ${label} → corps trop court (${text.length} < ${MIN_BODY_TEXT} car.)`);
}
```

Ante el menor fallo, `process.exit(1)`, y el build se rompe. Este script es el último paso de
`build:ssg`, cuyo orden importa: `gen:read-times` recalcula los tiempos de lectura a partir del número
real de palabras antes de la compilación, `ng build --configuration production` prerrenderiza, `gen:seo` escribe
sitemap, robots y llms en la carpeta entregada, y `check-prerender.mjs` valida todo el conjunto. Es esa
cadena exacta la que lanza el workflow de despliegue.

## El SEO fijado en el `<head>`

El prerrenderizado solo captura lo que está presente en el `<head>` en el momento en que la ruta está lista. El
`SeoService` escribe entonces título, descripción, Open Graph, `canonical`, `hreflang` y JSON-LD de forma
idempotente: cada etiqueta se coloca o se reemplaza, nunca se duplica, para que una re-navegación
deje exactamente un ejemplar de cada una.

Para un artículo, el servicio inyecta un grafo JSON-LD `BlogPosting` (headline, fechas, autor,
editor, imagen) junto con un `BreadcrumbList`. El componente de detalle lo pilota en un `effect` que
reacciona al artículo actual y al idioma: en cada cambio, `seo.update` reescribe las etiquetas y
`seo.setArticleJsonLd` reemplaza el grafo, siempre bajo el esquema colocar-o-reemplazar.

En paralelo, `gen:seo` produce los artefactos del sitio después del build. El `sitemap.xml` emite cada
concepto (página, artículo, serie) una vez por idioma, cada `<url>` con su grupo completo de
`hreflang` y un `lastmod` real: la fecha del artículo en su propia página, la más reciente en las
páginas que evolucionan, ninguna fecha inventada en las páginas estáticas (un `lastmod` falso vale menos que
ningún `lastmod`). El `robots.txt` autoriza explícitamente a los crawlers de IA (GPTBot, ClaudeBot,
PerplexityBot…) además de los motores clásicos, y un `llms.txt` enumera los artículos y describe
al autor como entidad.

Como todo este contenido vive en el HTML prerrenderizado, un crawler lo recupera sin ejecutar una sola
línea de JavaScript.

## La configuración de edge de Azure SWA

Azure Static Web Apps lee un `staticwebapp.config.json` en la raíz del despliegue. Aquí cabe en
diecisiete líneas.

```json
{
  "trailingSlash": "never",
  "globalHeaders": {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp"
  },
  "routes": [
    { "route": "/", "redirect": "/fr", "statusCode": 301 },
    { "route": "/bsp", "headers": { "X-Robots-Tag": "noindex" } },
    {
      "route": "/*.{css,js,mjs}",
      "headers": { "Cache-Control": "public, max-age=31536000, immutable" }
    }
  ],
  "responseOverrides": { "404": { "rewrite": "/404.html" } },
  "mimeTypes": { ".json": "application/json", ".webp": "image/webp", ".svg": "image/svg+xml" }
}
```

La raíz `/` redirige a `/fr` en 301: la home canónica está localizada. Los dos encabezados
globales `Cross-Origin-Opener-Policy` y `Cross-Origin-Embedder-Policy` aíslan el documento
(cross-origin isolation), condición para que el `SharedArrayBuffer` del motor de juego embebido
funcione en su worker. Deben permanecer globales, no limitados a una ruta, o el worker
perdería el acceso al buffer compartido. Los bundles con hash (`*.css`, `*.js`, `*.mjs`) salen con una caché
inmutable de un año, segura porque `outputHashing: all` cambia el nombre del archivo en cuanto su contenido
cambia.

Un punto notable por su ausencia: ningún `navigationFallback`. La conmutación SPA clásica (ruta
desconocida reescrita hacia `index.html`) no tiene razón de ser, puesto que cada ruta ya está prerrenderizada
en su propio `index.html`. SWA sirve el archivo directamente, y una URL realmente desconocida cae
en el `404.html` vía `responseOverrides`. El detalle de las claves está en la guía de
[configuración de Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/configuration).

## El despliegue, sin secreto almacenado

El workflow `deploy-client.yml` se dispara cuando `client/**` cambia en `main`. No almacena
ningún secreto de Azure: la conexión pasa por OIDC (`azure/login` con `id-token: write`), e incluso el
token de despliegue de SWA se lee en tiempo de ejecución, vía `az staticwebapp secrets list … --query
properties.apiKey`, y luego se inyecta en el entorno del job. Ninguna clave queda fijada en los
secretos del repositorio.

El resto es directo. `npm ci`, `npm run build:ssg` (la cadena completa, guardia incluida), luego
`swa deploy dist/super-dev-portfolio/browser` con el token recién leído. La carpeta `browser/`
es la totalidad del sitio: no hay artefacto de servidor aparte.

Un último paso hace ping a IndexNow, después del despliegue y nunca antes, para que el archivo de clave
esté en línea cuando los motores lo validen. Es no bloqueante por construcción: un hint fallido
no debe hacer fracasar un despliegue ya exitoso.

> El SSG va más allá de la sola cuestión del posicionamiento. Cada página existe en HTML antes de cualquier
> JavaScript, con su idioma y sus datos estructurados fijados en el build, y un script rompe la entrega
> si alguno de ellos sale vacío. El time-to-content ya no depende de la conexión del visitante ni de
> la ejecución de un bundle.
