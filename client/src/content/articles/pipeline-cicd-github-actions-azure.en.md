Deploying by hand means deploying on a Friday night with a knot in your stomach. A **CI/CD**
pipeline on GitHub Actions turns every `git push` into a tested build, then a reproducible
deployment to Azure — without ever touching a portal.

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

### Secrets without secrets: OIDC

Rather than a long-lived secret copied into GitHub, use **federated identity** (OIDC): Azure
trusts the short-lived token GitHub mints for this repository. No key to rotate, nothing to
leak.

```yaml
permissions:
  id-token: write
  contents: read
```

## Deploying to Azure

Once the build is artifacted, the official action pushes the static folder to Azure Static
Web Apps (or App Service for a .NET API):

- `azure/login@v2` with the federated credentials
- `Azure/static-web-apps-deploy@v1` for the prerendered front end
- a smoke-test step that `curl`s the production URL right after

## Guardrails

A pipeline that deploys without a net is a loaded gun. Protect the `main` branch (required
review, green CI required) and put the deployment behind a GitHub **Environment** with
**required reviewers** for production. GitHub's
[environments docs](https://docs.github.com/actions/deployment/targeting-different-environments)
cover manual approvals.

> A good pipeline isn't the one that ships fastest — it's the one you trust **enough** to
> deploy on a Tuesday at 5 p.m. without an emergency meeting.
