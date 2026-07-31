Ein manueller Deploy ist nie zweimal derselbe. Eine **CI/CD**-Pipeline auf
GitHub Actions eliminiert diese Variable: Jeder `git push` wird zu einem getesteten Build und
anschließend zu einem reproduzierbaren Deployment nach Azure, ohne jemals ein Portal anzufassen.

## Ein deklarativer Workflow

Alles lebt in `.github/workflows/`. Ein Workflow wird durch ein Ereignis ausgelöst (`push`,
`pull_request`), reiht **Jobs** aneinander, und jeder Job ist eine Abfolge von `steps`:

```yaml
name: deploy
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: npm run build:ssg
```

### Die Authentifizierung per OIDC

Statt eines langlebigen Secrets, das in GitHub kopiert wird, nutzt man die **federated identity**
(OIDC): Azure vertraut dem kurzlebigen Token, das GitHub für dieses Repository ausstellt. Es gibt
also keinen Schlüssel, den man rotieren müsste, und nichts, was durchsickern könnte.

```yaml
permissions:
  id-token: write
  contents: read
```

## Deployment nach Azure

Sobald der Build als Artefakt vorliegt, schiebt die offizielle Action den statischen Ordner nach Azure
Static Web Apps (oder App Service für eine .NET-API):

- `azure/login@v2` mit den föderierten Anmeldeinformationen
- `Azure/static-web-apps-deploy@v1` für das vorgerenderte Frontend
- ein Smoke-Test-Schritt, der direkt danach die Prod-URL mit `curl` abfragt

## Schutzmechanismen

Eine Pipeline, die eigenständig deployt, braucht explizite Grenzen. Man schützt den `main`-Branch
(verpflichtendes Review, grüne CI erforderlich) und platziert das Deployment hinter einem
GitHub-**Environment** mit **required reviewers** für die Produktion. Die Dokumentation zu
[GitHub-Environments](https://docs.github.com/actions/deployment/targeting-different-environments)
beschreibt die manuellen Freigaben im Detail.

> Eine gute Pipeline misst sich am **Vertrauen**, das man ihr entgegenbringt, nicht an ihrer
> Geschwindigkeit: genug, um an einem Dienstag um 17 Uhr ohne Krisensitzung zu deployen.
