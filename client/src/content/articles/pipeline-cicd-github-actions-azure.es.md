Este repositorio se despliega en Azure sin que nadie abra el portal ni escriba un comando `az`
a mano. Dos archivos YAML en `.github/workflows/` hacen todo el trabajo: uno publica el
front estático, el otro la API .NET. Un `git push` a `main` dispara el que corresponde a los
archivos modificados, y solo ese.

## Dos workflows, dos disparadores

`deploy-client.yml` y `deploy-api.yml` comparten la misma forma y nada más. Cada uno escucha
`push` en `main` y `workflow_dispatch` (el botón manual de la pestaña Actions), con un filtro
de rutas que lo confina a su territorio:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: [client/**]
```

Corregir una falta en un artículo no relanza entonces el despliegue de la API, y un cambio
de código C# no reconstruye el front. Dos dominios que se mueven a ritmos diferentes
merecen pipelines separados.

El filtro tiene un límite conocido. Ante un force-push, GitHub puede ver todos los archivos como
modificados y relanzar el despliegue del cliente aunque solo la API haya cambiado. Esto no tiene
consecuencias aquí: reconstruir el mismo sitio estático y volver a publicarlo es idempotente.

## El acceso a Azure sin secreto almacenado

Ninguno de los dos workflows guarda una contraseña de Azure. La autenticación pasa por OIDC
(federated identity): Azure confía en un token de corta duración emitido por GitHub para este
repositorio concreto, durante la vida del job. El workflow solicita el permiso para emitir ese
token, y luego se conecta con tres identificadores que no son secretos en sentido estricto (un
client ID, un tenant, una suscripción):

```yaml
permissions:
  id-token: write # Azure OIDC login
  contents: read

steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - name: Azure Login via OIDC
    uses: azure/login@532459ea530d8321f2fb9bb10d1e0bcf23869a43 # v3.0.0
    with:
      client-id: ${{ secrets.AZURE_CLIENT_ID }}
      tenant-id: ${{ secrets.AZURE_TENANT_ID }}
      subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

`AZURE_CLIENT_ID`, `AZURE_TENANT_ID` y `AZURE_SUBSCRIPTION_ID` designan la aplicación y la
suscripción; por sí solos, no abren nada. La confianza se declara del lado de Azure, en un
federated credential que solo acepta tokens que llevan la identidad de este repositorio y de
su rama. No hay ninguna clave que rotar ni que ver filtrarse en un log.

Un detalle que importa: cada acción está fijada a un SHA de commit completo, con la versión
legible en comentario. `@v3` seguiría una etiqueta móvil que un atacante podría desplazar bajo
nuestros pies; el SHA fija exactamente el código ejecutado.

## El front: compilar, luego publicar lo estático

El runner parte de algo predecible: `actions/setup-node` en Node 22, con la caché npm indexada
en `client/package-lock.json`, y luego `npm ci` en lugar de `npm install`. `ci` instala
exactamente lo que describe el lockfile, sin reescribirlo nunca; dos ejecuciones separadas por
un mes plantan el mismo árbol de dependencias.

El job del cliente se resume después a construir el sitio y entregar su carpeta. La
construcción cabe en un único script, `npm run build:ssg`, que primero deriva los tiempos de
lectura a partir del número real de palabras, lanza el build de producción (Angular prerrenderiza
cada ruta en HTML estático), genera sitemap y robots, y luego ejecuta un guardián:
`check-prerender.mjs` falla si una página de artículo ha perdido su JSON-LD o su cuerpo
Markdown renderizado.

Es el único control del pipeline del front, y basta para lo que se despliega. Una compilación
TypeScript estricta que falla, o un artículo que ya no aparece en el HTML prerrenderizado,
detiene el job antes de cualquier despliegue. La suite Vitest y Playwright, por su parte, se
ejecuta en local antes del merge, no en este workflow.

Una vez que `dist/super-dev-portfolio/browser` está listo, hay que publicarlo hacia el Static
Web App. El token de despliegue tampoco se almacena: se obtiene en tiempo de ejecución, a través
de la conexión OIDC ya establecida.

```yaml
# SWA deploy token fetched at runtime via OIDC, never stored as a secret.
- name: Fetch SWA deployment token
  run: |
    TOKEN=$(az staticwebapp secrets list \
      --name swa-sd-web \
      --resource-group rg-infra-web \
      --query "properties.apiKey" -o tsv)
    echo "SWA_TOKEN=$TOKEN" >> $GITHUB_ENV

- name: Deploy with SWA CLI
  working-directory: client
  run: |
    swa deploy dist/super-dev-portfolio/browser \
      --deployment-token "$SWA_TOKEN" \
      --env production
```

La aplicación se identifica por su nombre (`swa-sd-web` en `rg-infra-web`); el workflow no crea
ningún recurso, despliega en una infraestructura que ya existe. Último paso, colocado después
del despliegue para que el archivo de clave esté en línea cuando los motores lo validen: un ping
IndexNow que avisa a Bing y a los motores que siguen el protocolo. Es no bloqueante por elección,
ya que un fallo de indicación de crawl nunca debe hacer fallar un despliegue ya logrado.

## La API: probar antes de publicar

El job de la API tiene un paso que el front no tiene: ejecuta sus pruebas dentro del pipeline, y
se niega a publicar si alguna falla.

```yaml
jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    environment: api # gated GitHub environment

    steps:
      - name: Test
        run: dotnet test api --configuration Release
      - name: Publish
        run: dotnet publish $PROJECT --configuration Release --output $PUBLISH_DIR
      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: afu-sd-api
          package: ${{ env.PUBLISH_DIR }}
```

`dotnet test` sobre toda la solución pasa antes de `dotnet publish`. Una prueba en rojo se
detiene ahí, antes de la publicación. El binario (worker aislado .NET 10) parte luego en
zip-deploy hacia `afu-sd-api`, una Function App en plan Flex Consumption, mediante la acción
oficial `Azure/functions-action`.

La diferencia con el front no es un olvido. Un sitio estático se demuestra compilándolo; para
una API hay que ejecutar su comportamiento, por lo tanto pruebas dentro del pipeline.

## Las salvaguardas

Un pipeline que se despliega solo merece límites explícitos, y aquí son pocos. La rama `main`
está protegida: el código llega mediante pull request, nunca en push directo. El filtro de
rutas acota el radio de acción de cada workflow. El build falla antes del despliegue, nunca
después.

Y el job de la API se ejecuta en un Environment de GitHub llamado `api`, mientras que el front
no tiene ninguno. Un Environment es el lugar donde se enganchan las reglas de protección
(revisión obligatoria, tiempo de espera, secretos reservados) antes de que un job pueda
desplegarse en él. Poner la API detrás de uno y dejar el front sin ninguno traduce una asimetría
de riesgo asumida.

Lo que estos workflows no hacen cuenta igual de importante. No aprovisionan nada. El Static Web
App, la Function App, el almacenamiento, la supervisión y el presupuesto viven en un repositorio
Terraform separado y privado. Los pipelines despliegan código hacia recursos con nombre; no
tienen derecho a crearlos. La frontera entre desplegar una aplicación y fabricar su
infraestructura sigue siendo nítida, y es ella la que hace legible cada `push`.

> El pipeline cabe en dos archivos cortos, sin secreto almacenado y sin paso manual. Es
> suficiente para que un push el martes por la tarde llegue a producción sin ceremonia.
