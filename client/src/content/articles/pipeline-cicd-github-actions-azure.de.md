Von Hand zu deployen heißt, freitagabends mit einem mulmigen Gefühl im Magen zu deployen. Eine
**CI/CD**-Pipeline auf GitHub Actions verwandelt jeden `git push` in ein getestetes Build und
anschließend in ein reproduzierbares Deployment nach Azure — ohne jemals ein Portal anzufassen.

## Ein deklarativer Workflow

Alles lebt in `.github/workflows/`. Ein Workflow wird durch ein Ereignis ausgelöst (`push`,
`pull_request`), verkettet **Jobs**, und jeder Job ist eine Abfolge von `steps` :

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

### Secrets ohne Secrets: OIDC

Anstatt eines langlebigen Secrets, das in GitHub hinterlegt wird, verwendet man **federated identity**
(OIDC): Azure vertraut dem kurzlebigen Token, den GitHub für dieses Repository ausstellt. Kein
Schlüssel muss rotiert werden, nichts kann durchsickern.

```yaml
permissions:
  id-token: write
  contents: read
```

## Deployment nach Azure

Sobald das Build als Artefakt vorliegt, pusht die offizielle Action den statischen Ordner zu Azure
Static Web Apps (oder App Service für eine .NET-API):

- `azure/login@v2` mit den föderierten Anmeldedaten
- `Azure/static-web-apps-deploy@v1` für das vorgerenderte Frontend
- ein Smoke-Test-Schritt, der direkt danach die Prod-URL per `curl` abfragt

## Sicherheitsnetz

Eine Pipeline, die ohne Sicherheitsnetz deployed, ist eine geladene Waffe. Man schützt den
`main`-Branch (Pflicht-Review, grüne CI erforderlich) und stellt das Deployment hinter ein GitHub-**Environment**
mit **required reviewers** für die Prod. Die Dokumentation zu
[GitHub Environments](https://docs.github.com/actions/deployment/targeting-different-environments)
erläutert die manuellen Genehmigungen.

> Eine gute Pipeline ist nicht die, die am schnellsten deployed — sondern die, der man **genug
> vertraut**, um an einem Dienstag um 17 Uhr ohne Krisenmeeting zu deployen.
