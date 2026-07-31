A manual deployment is never the same twice. A **CI/CD** pipeline on
GitHub Actions removes that variable: every `git push` becomes a tested build, then a
reproducible deployment to Azure, without ever touching a portal.

## A declarative workflow

Everything lives in `.github/workflows/`. A workflow triggers on an event (`push`,
`pull_request`), chains **jobs**, and each job is a sequence of `steps`:

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

### Authentication via OIDC

Rather than a long-lived secret copied into GitHub, we use **federated identity**
(OIDC): Azure trusts the ephemeral token that GitHub issues for this repo. There is
therefore no key to rotate, and nothing that can leak.

```yaml
permissions:
  id-token: write
  contents: read
```

## Deploying to Azure

Once the build is packaged as an artifact, the official action pushes the static folder to Azure
Static Web Apps (or App Service for a .NET API):

- `azure/login@v2` with federated credentials
- `Azure/static-web-apps-deploy@v1` for the prerendered front end
- a smoke-test step that `curl`s the prod URL right after

## Guardrails

A pipeline that deploys on its own needs explicit boundaries. We protect the `main` branch
(mandatory review, green CI required) and place the deployment behind a GitHub **Environment**
with **required reviewers** for prod. The
[GitHub environments](https://docs.github.com/actions/deployment/targeting-different-environments)
docs cover manual approvals in detail.

> A good pipeline is measured by the **confidence** it earns, not its speed: enough
> to deploy on a Tuesday at 5 p.m. without a crisis meeting.
