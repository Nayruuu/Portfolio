Dieses Repository wird auf Azure deployt, ohne dass jemand das Portal öffnet oder manuell einen
`az`-Befehl eingibt. Zwei YAML-Dateien in `.github/workflows/` erledigen die ganze Arbeit: eine
veröffentlicht das statische Frontend, die andere die .NET-API. Ein `git push` auf `main` löst
diejenige aus, die zu den geänderten Dateien passt – und nur diese.

## Zwei Workflows, zwei Trigger

`deploy-client.yml` und `deploy-api.yml` teilen sich dieselbe Form und nichts weiter. Jeder lauscht
auf `push` auf `main` und `workflow_dispatch` (der manuelle Button im Actions-Tab), mit einem
Pfad-Filter, der ihn auf sein Territorium beschränkt:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: [client/**]
```

Einen Tippfehler in einem Artikel zu korrigieren löst also nicht das Deployment der API aus, und
eine Änderung am C#-Code baut nicht das Frontend neu. Zwei Bereiche, die sich in unterschiedlichem
Tempo bewegen, verdienen getrennte Pipelines.

Der Filter hat eine bekannte Grenze. Bei einem Force-Push kann GitHub alle Dateien als geändert
ansehen und das Client-Deployment erneut auslösen, obwohl nur die API sich geändert hat. Das ist
hier folgenlos: dieselbe statische Site erneut zu bauen und zu pushen ist idempotent.

## Der Zugriff auf Azure ohne gespeichertes Secret

Keiner der beiden Workflows speichert ein Azure-Passwort. Die Authentifizierung läuft über OIDC
(federated identity): Azure vertraut einem kurzlebigen Token, das GitHub für genau dieses
Repository ausstellt, für die Dauer des Jobs. Der Workflow fordert die Berechtigung an, dieses
Token auszustellen, und meldet sich dann mit drei Identifikatoren an, die im engeren Sinn keine
Secrets sind (eine Client-ID, ein Tenant, ein Abonnement):

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

`AZURE_CLIENT_ID`, `AZURE_TENANT_ID` und `AZURE_SUBSCRIPTION_ID` bezeichnen die Anwendung und
das Abonnement; für sich allein öffnen sie nichts. Das Vertrauen wird auf Azure-Seite deklariert,
in einem Federated Credential, der nur Tokens akzeptiert, die die Identität dieses Repositorys
und seines Branches tragen. Es gibt keinen Schlüssel, der rotiert werden müsste oder in einem
Log durchsickern könnte.

Ein Detail, das zählt: Jede Action ist an einen vollständigen Commit-SHA gepinnt, die lesbare
Version steht im Kommentar. `@v3` würde einem beweglichen Tag folgen, den ein Angreifer unter
unseren Füßen verschieben könnte; der SHA legt exakt den ausgeführten Code fest.

## Das Frontend: kompilieren, dann Statisches pushen

Der Runner startet mit etwas Vorhersehbarem: `actions/setup-node` mit Node 22, mit einem
npm-Cache, der auf `client/package-lock.json` indiziert ist, dann `npm ci` statt `npm install`.
`ci` installiert exakt das, was die Lockfile beschreibt, ohne sie jemals neu zu schreiben; zwei
Ausführungen im Abstand eines Monats ergeben denselben Abhängigkeitsbaum.

Der Client-Job läuft dann darauf hinaus, die Site zu bauen und ihr Verzeichnis auszuliefern. Der
Build steckt in einem einzigen Skript, `npm run build:ssg`, das zunächst die Lesezeiten aus der
tatsächlichen Wortanzahl ableitet, den Produktions-Build startet (Angular prerendert jede Route
zu statischem HTML), Sitemap und robots generiert und dann einen Schutzmechanismus ausführt:
`check-prerender.mjs` schlägt fehl, wenn eine Artikelseite ihr JSON-LD oder ihren gerenderten
Markdown-Body verloren hat.

Das ist die einzige Prüfung der Frontend-Pipeline, und sie reicht für das, was hier deployt wird.
Eine strikte TypeScript-Kompilierung, die scheitert, oder ein Artikel, der im vorgerenderten HTML
nicht mehr auftaucht, stoppt den Job vor jedem Deployment. Die Vitest- und Playwright-Suite läuft
dagegen lokal vor dem Merge, nicht in diesem Workflow.

Sobald `dist/super-dev-portfolio/browser` bereit ist, muss es zur Static Web App gepusht werden.
Das Deployment-Token wird ebenfalls nicht gespeichert: Es wird zur Laufzeit über die bereits
etablierte OIDC-Verbindung abgerufen.

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

Die App wird über ihren Namen adressiert (`swa-sd-web` in `rg-infra-web`); der Workflow erstellt
keinerlei Ressource, er deployt in eine bereits bestehende Infrastruktur. Letzter Schritt, nach
dem Deployment platziert, damit die Key-Datei online ist, wenn die Suchmaschinen sie validieren:
ein IndexNow-Ping, der Bing und die Suchmaschinen benachrichtigt, die dem Protokoll folgen. Er
ist bewusst nicht blockierend, denn ein verpasster Crawl-Hinweis darf niemals ein bereits
erfolgreiches Deployment scheitern lassen.

## Die API: testen, bevor veröffentlicht wird

Der API-Job hat einen Schritt, den das Frontend nicht hat: Er führt seine Tests in der Pipeline
aus und verweigert die Veröffentlichung, wenn einer davon fehlschlägt.

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

`dotnet test` über die gesamte Solution läuft vor `dotnet publish`. Ein roter Test stoppt hier,
noch vor der Veröffentlichung. Die Binärdatei (isolierter .NET-10-Worker) geht anschließend per
Zip-Deploy an `afu-sd-api`, eine Function App im Flex-Consumption-Plan, über die offizielle
Action `Azure/functions-action`.

Der Unterschied zum Frontend ist kein Versehen. Eine statische Site beweist sich durch ihre
Kompilierung; für eine API muss man ihr Verhalten ausführen, also Tests innerhalb der Pipeline.

## Die Schutzmechanismen

Eine Pipeline, die selbstständig deployt, verdient explizite Grenzen, und davon gibt es hier nur
wenige. Der Branch `main` ist geschützt: Code kommt per Pull Request an, niemals per direktem
Push. Der Pfad-Filter begrenzt den Wirkungsradius jedes Workflows. Der Build schlägt vor dem
Deployment fehl, nie danach.

Und der API-Job läuft in einem GitHub Environment namens `api`, während das Frontend keines hat.
Ein Environment ist der Ort, an dem man Schutzregeln festmacht (Pflichtprüfung, Wartezeit,
reservierte Secrets), bevor ein Job dorthin deployen kann. Die API dahinter zu stellen und das
Frontend ohne zu lassen, übersetzt eine bewusst akzeptierte Risiko-Asymmetrie.

Was diese Workflows nicht tun, zählt genauso viel. Sie provisionieren nichts. Die Static Web App,
die Function App, der Speicher, die Überwachung und das Budget leben in einem separaten, privaten
Terraform-Repository. Die Pipelines deployen Code in benannte Ressourcen; sie dürfen keine
erstellen. Die Grenze zwischen dem Deployment einer Anwendung und dem Bau ihrer Infrastruktur
bleibt klar, und genau das macht jeden `push` nachvollziehbar.

> Die Pipeline besteht aus zwei kurzen Dateien, ohne gespeichertes Secret und ohne manuellen
> Schritt. Das reicht, damit ein Push am Dienstagnachmittag ohne Zeremonie in Produktion geht.
