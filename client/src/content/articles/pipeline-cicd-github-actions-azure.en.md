Ce dépôt se déploie sur Azure sans que quiconque ouvre le portail ou tape une commande `az`. Let me translate this article now, preserving all code and technical identifiers exactly.

This repository deploys to Azure without anyone opening the portal or typing an `az` command
by hand. Two YAML files in `.github/workflows/` do all the work: one publishes the static
front end, the other the .NET API. A `git push` to `main` triggers whichever one matches the
files that were touched, and only that one.

## Two workflows, two triggers

`deploy-client.yml` and `deploy-api.yml` share the same shape and nothing more. Each listens
to `push` on `main` and `workflow_dispatch` (the manual button in the Actions tab), with a path
filter that confines it to its own territory:

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: [client/**]
```

Fixing a typo in an article therefore doesn't trigger the API deployment, and a C# code
change doesn't rebuild the front end. Two domains that move at different paces deserve
separate pipelines.

The filter has a known limitation. On a force-push, GitHub can see every file as modified
and re-trigger the client deployment even though only the API changed. That's harmless
here: rebuilding the same static site and pushing it again is idempotent.

## Accessing Azure without a stored secret

Neither workflow stores an Azure password. Authentication goes through OIDC
(federated identity): Azure trusts a short-lived token issued by GitHub for this specific
repository, for the duration of the job. The workflow requests permission to issue this
token, then logs in with three credentials that aren't secrets in the strong sense (a client
ID, a tenant, a subscription):

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

`AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` designate the application
and the subscription; on their own, they open nothing. The trust is declared on the Azure
side, in a federated credential that only accepts tokens carrying the identity of this
repository and its branch. There's no key to rotate or to see leak into a log.

One detail that matters: each action is pinned to a full commit SHA, with the readable
version in a comment. `@v3` would follow a mobile tag that an attacker could move out from
under us; the SHA locks down exactly which code runs.

## The front end: build, then push static files

The runner starts on predictable ground: `actions/setup-node` on Node 22, with the npm cache
keyed on `client/package-lock.json`, then `npm ci` rather than `npm install`. `ci` installs
exactly what the lockfile describes, without ever rewriting it; two runs a month apart
produce the same dependency tree.

The client job then boils down to building the site and shipping its folder. The build
fits in a single script, `npm run build:ssg`, which first derives read times from the
actual word count, runs the production build (Angular prerenders every route to static
HTML), generates the sitemap and robots files, then runs a guard: `check-prerender.mjs`
fails if an article page has lost its JSON-LD or its rendered Markdown body.

That's the only check in the front-end pipeline, and it's enough for what gets deployed.
A strict TypeScript compile that breaks, or an article that no longer appears in the
prerendered HTML, stops the job before any deployment. The Vitest and Playwright suites
run locally before the merge, not in this workflow.

Once `dist/super-dev-portfolio/browser` is ready, it needs to be pushed to the Static Web
App. The deployment token isn't stored either: it's fetched at runtime, via the OIDC
connection already established.

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

The app is targeted by its name (`swa-sd-web` in `rg-infra-web`); the workflow doesn't
create any resource, it deploys into infrastructure that already exists. The last step,
placed after the deployment so the key file is live by the time search engines validate
it, is an IndexNow ping that notifies Bing and the engines that follow the protocol. It's
non-blocking by choice, since a failed crawl notification should never fail an already
successful deployment.

## The API: test before publishing

The API job has a step the front end doesn't: it runs its tests inside the pipeline, and
refuses to publish if any of them fail.

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

`dotnet test` on the whole solution runs before `dotnet publish`. A failing test stops
right there, before publication. The binary (a .NET 10 isolated worker) then ships as a
zip-deploy to `afu-sd-api`, a Function App on the Flex Consumption plan, via the official
`Azure/functions-action`.

The difference with the front end isn't an oversight. A static site proves itself by
compiling; an API needs its behavior exercised, hence tests inside the pipeline.

## The guardrails

A pipeline that deploys on its own deserves explicit limits, and there are few of them
here. The `main` branch is protected: code arrives via pull request, never a direct push.
The path filter bounds each workflow's blast radius. The build fails before deployment,
never after.

And the API job runs inside a GitHub Environment named `api`, while the front end has
none. An Environment is where protection rules are hung (mandatory review, wait timer,
reserved secrets) before a job can deploy into it. Putting the API behind one and leaving
the front end without translates a deliberate risk asymmetry.

What these workflows don't do matters just as much. They provision nothing. The Static
Web App, the Function App, storage, monitoring and budget live in a separate, private
Terraform repository. The pipelines deploy code to named resources; they have no right to
create any. The boundary between deploying an application and building its infrastructure
stays sharp, and that's what makes every `push` legible.

> The pipeline fits in two short files, with no stored secret and no manual step. That's
> enough for a push on a Tuesday afternoon to go to production without ceremony.
